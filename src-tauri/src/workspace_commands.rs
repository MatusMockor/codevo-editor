use crate::search::TextSearchOptions;
use crate::workspace_file_commands::{
    read_image_from_root, DescriptorFileEntry, DescriptorFileSearchResponse,
    DescriptorTextSearchResponse, FileCommandResult, FileRevision, MutationResult,
    WorkspaceFileIndexCache, WorkspaceFileRepository, WorkspaceImageFile, WorkspaceImageReadError,
    WorkspaceReplaceResult, WorkspaceTextFile,
};
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::{
    collections::HashMap,
    io,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

const SEARCH_RELATIVE_PATH_BYTE_LIMIT: usize = 16 * 1024;
const SEARCH_QUERY_BYTE_LIMIT: usize = 64 * 1024;
const SEARCH_FILE_MASK_BYTE_LIMIT: usize = 16 * 1024;
const SEARCH_REQUEST_GENERATION_BYTE_LIMIT: usize = 128;
const SEARCH_GLOBAL_CONCURRENCY_LIMIT: usize = 8;
const SEARCH_WORKSPACE_CONCURRENCY_LIMIT: usize = 4;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(5);
const WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT: usize = 10 * 1024 * 1024;
const WORKSPACE_SAVE_GLOBAL_CONCURRENCY_LIMIT: usize = 8;
const WORKSPACE_SAVE_CONCURRENCY_LIMIT_PER_WORKSPACE: usize = 2;

#[derive(Default)]
struct WorkspaceSaveAdmissionCounts {
    active_by_workspace: HashMap<WorkspaceId, usize>,
    active_global: usize,
}

static WORKSPACE_SAVE_ADMISSION_COUNTS: OnceLock<Mutex<WorkspaceSaveAdmissionCounts>> =
    OnceLock::new();

struct WorkspaceSavePermit {
    workspace_id: WorkspaceId,
}

impl WorkspaceSavePermit {
    fn acquire(workspace_id: &WorkspaceId) -> Result<Self, String> {
        let mut counts = WORKSPACE_SAVE_ADMISSION_COUNTS
            .get_or_init(|| Mutex::new(WorkspaceSaveAdmissionCounts::default()))
            .lock()
            .map_err(|_| "workspace save admission lock poisoned".to_string())?;
        let workspace_count = counts
            .active_by_workspace
            .get(workspace_id)
            .copied()
            .unwrap_or(0);
        if counts.active_global >= WORKSPACE_SAVE_GLOBAL_CONCURRENCY_LIMIT
            || workspace_count >= WORKSPACE_SAVE_CONCURRENCY_LIMIT_PER_WORKSPACE
        {
            return Err("workspace save concurrency limit reached".to_string());
        }
        counts.active_global += 1;
        counts
            .active_by_workspace
            .insert(workspace_id.clone(), workspace_count + 1);
        Ok(Self {
            workspace_id: workspace_id.clone(),
        })
    }
}

impl Drop for WorkspaceSavePermit {
    fn drop(&mut self) {
        let Ok(mut counts) = WORKSPACE_SAVE_ADMISSION_COUNTS
            .get_or_init(|| Mutex::new(WorkspaceSaveAdmissionCounts::default()))
            .lock()
        else {
            return;
        };
        counts.active_global = counts.active_global.saturating_sub(1);
        if let Some(active) = counts.active_by_workspace.get_mut(&self.workspace_id) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                counts.active_by_workspace.remove(&self.workspace_id);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum WorkspaceSearchKind {
    Files,
    Text,
}

#[derive(Clone)]
pub(crate) struct WorkspaceFileSearchLifecycle {
    inner: Arc<Mutex<SearchLifecycleState>>,
}

impl Default for WorkspaceFileSearchLifecycle {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SearchLifecycleState::default())),
        }
    }
}

#[derive(Default)]
struct SearchLifecycleState {
    entries: HashMap<(WorkspaceId, WorkspaceSearchKind), SearchGeneration>,
    active_global: usize,
    active_by_workspace: HashMap<WorkspaceId, usize>,
    next_generation: u64,
}

#[derive(Clone)]
struct SearchGeneration {
    generation: u64,
    query_key: String,
}

#[derive(Clone)]
struct WorkspaceSearchToken {
    authority: Arc<SearchAuthority>,
}

struct SearchAuthority {
    lifecycle: WorkspaceFileSearchLifecycle,
    workspace_id: WorkspaceId,
    kind: WorkspaceSearchKind,
    generation: u64,
    query_key: String,
    deadline: Instant,
}

impl WorkspaceFileSearchLifecycle {
    fn begin(
        &self,
        workspace_id: &WorkspaceId,
        kind: WorkspaceSearchKind,
        query_key: String,
    ) -> io::Result<WorkspaceSearchToken> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| io::Error::other("workspace search lifecycle lock poisoned"))?;
        let workspace_active = state
            .active_by_workspace
            .get(workspace_id)
            .copied()
            .unwrap_or(0);
        // Cancel the previous same-kind authority even when physical worker capacity is full.
        state.entries.remove(&(workspace_id.clone(), kind));
        if state.active_global >= SEARCH_GLOBAL_CONCURRENCY_LIMIT
            || workspace_active >= SEARCH_WORKSPACE_CONCURRENCY_LIMIT
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "workspace search concurrency limit reached",
            ));
        }
        state.next_generation = state.next_generation.checked_add(1).unwrap_or(1);
        let generation = state.next_generation;
        let key = (workspace_id.clone(), kind);
        state.entries.insert(
            key,
            SearchGeneration {
                generation,
                query_key: query_key.clone(),
            },
        );
        state.active_global += 1;
        *state
            .active_by_workspace
            .entry(workspace_id.clone())
            .or_insert(0) += 1;
        Ok(WorkspaceSearchToken {
            authority: Arc::new(SearchAuthority {
                lifecycle: self.clone(),
                workspace_id: workspace_id.clone(),
                kind,
                generation,
                query_key,
                deadline: Instant::now() + SEARCH_TIMEOUT,
            }),
        })
    }

    pub(crate) fn cancel_workspace(&self, workspace_id: &WorkspaceId) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        state.entries.retain(|(owner, _), _| owner != workspace_id);
    }
}

impl WorkspaceSearchToken {
    fn is_current(&self) -> bool {
        if Instant::now() >= self.authority.deadline {
            return false;
        }
        self.authority
            .lifecycle
            .inner
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .entries
                    .get(&(self.authority.workspace_id.clone(), self.authority.kind))
                    .cloned()
            })
            .is_some_and(|current| {
                current.generation == self.authority.generation
                    && current.query_key == self.authority.query_key
            })
    }

    fn finish(&self) {
        let Ok(mut state) = self.authority.lifecycle.inner.lock() else {
            return;
        };
        let key = (self.authority.workspace_id.clone(), self.authority.kind);
        let should_remove = state.entries.get(&key).is_some_and(|current| {
            current.generation == self.authority.generation
                && current.query_key == self.authority.query_key
        });
        if should_remove {
            state.entries.remove(&key);
        }
    }
}

impl Drop for SearchAuthority {
    fn drop(&mut self) {
        let Ok(mut state) = self.lifecycle.inner.lock() else {
            return;
        };
        let key = (self.workspace_id.clone(), self.kind);
        let should_remove = state.entries.get(&key).is_some_and(|current| {
            current.generation == self.generation && current.query_key == self.query_key
        });
        if should_remove {
            state.entries.remove(&key);
        }
        state.active_global = state.active_global.saturating_sub(1);
        if let Some(active) = state.active_by_workspace.get_mut(&self.workspace_id) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                state.active_by_workspace.remove(&self.workspace_id);
            }
        }
    }
}

#[tauri::command]
pub(crate) fn workspace_read_text_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<WorkspaceTextFile, String> {
    WorkspaceFileRepository::new(&registry)
        .read_text(&workspace_id, Path::new(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn workspace_read_image_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<WorkspaceImageFile, WorkspaceImageReadError> {
    let root = registry
        .clone_root(&workspace_id)
        .map_err(WorkspaceImageReadError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_image_from_root(&root, Path::new(&relative_path))
    })
    .await
    .map_err(|error| WorkspaceImageReadError::Io {
        message: format!("Command task failed: {error}"),
    })?
}

#[tauri::command]
pub(crate) fn workspace_read_directory(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> Result<Vec<DescriptorFileEntry>, String> {
    WorkspaceFileRepository::new(&registry)
        .read_directory(&workspace_id, Path::new(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn workspace_search_files(
    registry: State<'_, WorkspaceRegistry>,
    lifecycle: State<'_, WorkspaceFileSearchLifecycle>,
    file_index: State<'_, WorkspaceFileIndexCache>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    limit: usize,
    request_generation: String,
) -> Result<DescriptorFileSearchResponse, String> {
    validate_search_authority(&registry, &workspace_id, &request_generation)?;
    let token = match lifecycle.begin(
        &workspace_id,
        WorkspaceSearchKind::Files,
        request_generation.clone(),
    ) {
        Ok(token) => token,
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            return Ok(DescriptorFileSearchResponse {
                results: Vec::new(),
                truncated: true,
                request_generation,
            });
        }
        Err(error) => return Err(error.to_string()),
    };
    if let Err(error) = validate_search_payload(&relative_path, &query, None) {
        token.finish();
        return Err(error);
    }
    let prepared = match WorkspaceFileRepository::new(&registry).prepare_file_search(
        &file_index,
        &workspace_id,
        Path::new(&relative_path),
        &query,
        limit,
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            token.finish();
            return Err(error.to_string());
        }
    };
    let descriptor = prepared.descriptor().clone();
    let worker_token = token.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        prepared.execute(&|| worker_token.is_current())
    })
    .await
    .map_err(|error| format!("Command task failed: {error}"))
    .and_then(|result| result.map_err(|error| error.to_string()));
    let owner_result = ensure_search_owner(&registry, &descriptor, &token);
    token.finish();
    let results = outcome?;
    owner_result?;
    let truncated = results.iter().any(|result| result.truncated);
    Ok(DescriptorFileSearchResponse {
        results,
        truncated,
        request_generation,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn workspace_search_text(
    registry: State<'_, WorkspaceRegistry>,
    lifecycle: State<'_, WorkspaceFileSearchLifecycle>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    limit: usize,
    options: Option<TextSearchOptions>,
    request_generation: String,
) -> Result<DescriptorTextSearchResponse, String> {
    let options = options.unwrap_or_default();
    validate_search_authority(&registry, &workspace_id, &request_generation)?;
    let token = match lifecycle.begin(
        &workspace_id,
        WorkspaceSearchKind::Text,
        request_generation.clone(),
    ) {
        Ok(token) => token,
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            return Ok(DescriptorTextSearchResponse {
                results: Vec::new(),
                truncated: true,
                request_generation,
            });
        }
        Err(error) => return Err(error.to_string()),
    };
    if let Err(error) =
        validate_search_payload(&relative_path, &query, options.file_mask.as_deref())
    {
        token.finish();
        return Err(error);
    }
    if query.trim().is_empty() {
        token.finish();
        return Ok(WorkspaceFileRepository::empty_text_search_response(
            request_generation,
        ));
    }
    let prepared = match WorkspaceFileRepository::new(&registry).prepare_text_search(
        &workspace_id,
        Path::new(&relative_path),
        &query,
        limit,
        &options,
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            token.finish();
            return Err(error.to_string());
        }
    };
    let descriptor = prepared.descriptor().clone();
    let worker_token = token.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        prepared.execute(&|| worker_token.is_current())
    })
    .await
    .map_err(|error| format!("Command task failed: {error}"))
    .and_then(|result| result.map_err(|error| error.to_string()));
    let owner_result = ensure_search_owner(&registry, &descriptor, &token);
    token.finish();
    let mut response = outcome?;
    owner_result?;
    response.request_generation = request_generation;
    Ok(response)
}

fn ensure_search_owner(
    registry: &WorkspaceRegistry,
    expected: &crate::workspace_registry::ManagedWorkspaceDescriptor,
    token: &WorkspaceSearchToken,
) -> Result<(), String> {
    if !token.is_current() {
        return Err("workspace search was superseded".to_string());
    }
    let current = registry
        .descriptor(&expected.workspace_id)
        .map_err(|error| error.to_string())?;
    if &current != expected {
        return Err("workspace search owner changed before publication".to_string());
    }
    Ok(())
}

fn validate_search_authority(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    request_generation: &str,
) -> Result<(), String> {
    registry
        .descriptor(workspace_id)
        .map_err(|error| error.to_string())?;
    if request_generation.is_empty()
        || request_generation.len() > SEARCH_REQUEST_GENERATION_BYTE_LIMIT
        || !request_generation
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err("workspace search requestGeneration is invalid".to_string());
    }
    Ok(())
}

fn validate_search_payload(
    relative_path: &str,
    query: &str,
    file_mask: Option<&str>,
) -> Result<(), String> {
    if relative_path.len() > SEARCH_RELATIVE_PATH_BYTE_LIMIT {
        return Err("workspace search relativePath exceeds 16 KiB".to_string());
    }
    if query.len() > SEARCH_QUERY_BYTE_LIMIT {
        return Err("workspace search query exceeds 64 KiB".to_string());
    }
    if file_mask.is_some_and(|mask| mask.len() > SEARCH_FILE_MASK_BYTE_LIMIT) {
        return Err("workspace search fileMask exceeds 16 KiB".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod search_lifecycle_tests {
    use super::{WorkspaceFileSearchLifecycle, WorkspaceSearchKind};
    use crate::workspace_registry::WorkspaceRegistry;

    #[test]
    fn newer_query_supersedes_only_the_same_workspace_and_search_kind() {
        let registry = WorkspaceRegistry::new();
        let first_root = std::env::temp_dir().join(format!(
            "codevo-search-lifecycle-first-{}",
            std::process::id()
        ));
        let second_root = std::env::temp_dir().join(format!(
            "codevo-search-lifecycle-second-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&first_root);
        let _ = std::fs::remove_dir_all(&second_root);
        std::fs::create_dir_all(&first_root).unwrap();
        std::fs::create_dir_all(&second_root).unwrap();
        let first = registry.register(&first_root).unwrap();
        let second = registry.register(&second_root).unwrap();
        let lifecycle = WorkspaceFileSearchLifecycle::default();

        let stale = lifecycle
            .begin(&first.workspace_id, WorkspaceSearchKind::Files, "a".into())
            .unwrap();
        let text = lifecycle
            .begin(&first.workspace_id, WorkspaceSearchKind::Text, "a".into())
            .unwrap();
        let foreign = lifecycle
            .begin(&second.workspace_id, WorkspaceSearchKind::Files, "a".into())
            .unwrap();
        let current = lifecycle
            .begin(&first.workspace_id, WorkspaceSearchKind::Files, "ab".into())
            .unwrap();

        assert!(!stale.is_current());
        assert!(current.is_current());
        assert!(text.is_current());
        assert!(foreign.is_current());
        current.finish();
        assert!(!current.is_current());

        std::fs::remove_dir_all(first_root).unwrap();
        std::fs::remove_dir_all(second_root).unwrap();
    }

    #[test]
    fn saturation_cancels_previous_authority_and_drop_releases_admission() {
        let registry = WorkspaceRegistry::new();
        let root = std::env::temp_dir().join(format!(
            "codevo-search-lifecycle-saturation-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let descriptor = registry.register(&root).unwrap();
        let lifecycle = WorkspaceFileSearchLifecycle::default();
        let mut tokens = Vec::new();
        for index in 0..super::SEARCH_WORKSPACE_CONCURRENCY_LIMIT {
            tokens.push(
                lifecycle
                    .begin(
                        &descriptor.workspace_id,
                        WorkspaceSearchKind::Files,
                        index.to_string(),
                    )
                    .unwrap(),
            );
        }
        assert!(tokens.last().unwrap().is_current());

        let saturated = match lifecycle.begin(
            &descriptor.workspace_id,
            WorkspaceSearchKind::Files,
            "latest".into(),
        ) {
            Ok(_) => panic!("latest request must degrade at the workspace admission limit"),
            Err(error) => error,
        };
        assert_eq!(saturated.kind(), std::io::ErrorKind::WouldBlock);
        assert!(tokens.iter().all(|token| !token.is_current()));

        drop(tokens);
        let admitted = lifecycle
            .begin(
                &descriptor.workspace_id,
                WorkspaceSearchKind::Files,
                "after-drop".into(),
            )
            .unwrap();
        assert!(admitted.is_current());
        lifecycle.cancel_workspace(&descriptor.workspace_id);
        assert!(!admitted.is_current());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
pub(crate) fn workspace_replace_in_path(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    query: String,
    replacement: String,
    options: Option<TextSearchOptions>,
) -> WorkspaceReplaceResult {
    let repository = WorkspaceFileRepository::new(&registry);
    let options = options.unwrap_or_default();
    let store = match super::local_history_store(&app) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("Local History snapshot failed: {error}");
            return repository.replace_in_path(
                &workspace_id,
                Path::new(&relative_path),
                &query,
                &replacement,
                &options,
            );
        }
    };
    repository.replace_in_path_with_snapshot_sink(
        &workspace_id,
        Path::new(&relative_path),
        &query,
        &replacement,
        &options,
        &store,
    )
}

#[tauri::command]
pub(crate) async fn workspace_save_text_file(
    app: AppHandle,
    workspace_id: WorkspaceId,
    relative_path: String,
    content: String,
    expected_revision: FileRevision,
) -> FileCommandResult {
    let admission_owner = workspace_id.clone();
    run_workspace_save_job(admission_owner, move || {
        let registry = app.state::<WorkspaceRegistry>();
        Ok(save_text_file_blocking(
            &registry,
            &workspace_id,
            &relative_path,
            &content,
            &expected_revision,
        ))
    })
    .await
}

async fn run_workspace_save_job<F>(workspace_id: WorkspaceId, work: F) -> FileCommandResult
where
    F: FnOnce() -> Result<FileCommandResult, String> + Send + 'static,
{
    let permit = match WorkspaceSavePermit::acquire(&workspace_id) {
        Ok(permit) => permit,
        Err(message) => return FileCommandResult::Error { message },
    };
    let result = crate::run_blocking_command(move || {
        let _permit = permit;
        work()
    })
    .await;
    match result {
        Ok(result) => result,
        Err(message) => FileCommandResult::Error { message },
    }
}

fn save_text_file_blocking(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    relative_path: &str,
    content: &str,
    expected_revision: &FileRevision,
) -> FileCommandResult {
    if let Err(message) = validate_workspace_save_content(content) {
        return FileCommandResult::Error { message };
    }
    WorkspaceFileRepository::new(registry).save_text(
        workspace_id,
        Path::new(relative_path),
        content,
        expected_revision,
    )
}

fn validate_workspace_save_content(content: &str) -> Result<(), String> {
    validate_utf16_code_units(content, WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT).map_err(|_| {
        format!(
            "workspace save content exceeds {} UTF-16 code units",
            WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT
        )
    })
}

fn validate_utf16_code_units(content: &str, limit: usize) -> Result<(), ()> {
    let byte_length = content.len();
    // Every Unicode scalar occupies at least as many UTF-8 bytes as UTF-16 code
    // units, so this is an authoritative constant-time acceptance fast path.
    if byte_length <= limit {
        return Ok(());
    }
    // A single UTF-16 code unit can encode at most three UTF-8 bytes. Reject
    // beyond that ceiling without walking an adversarial oversized payload.
    if byte_length > limit.saturating_mul(3) {
        return Err(());
    }
    let mut utf16_length = 0usize;
    for character in content.chars() {
        utf16_length = utf16_length.saturating_add(character.len_utf16());
        if utf16_length > limit {
            return Err(());
        }
    }
    Ok(())
}

#[cfg(test)]
mod workspace_save_tests {
    use super::{
        run_workspace_save_job, save_text_file_blocking, validate_utf16_code_units,
        validate_workspace_save_content, WorkspaceSavePermit, WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT,
    };
    use crate::workspace_file_commands::{
        FileCommandResult, FileRevision, WorkspaceFileRepository,
    };
    use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
    use serde_json::json;
    use std::{
        fs,
        sync::mpsc,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    fn workspace_id(value: &str) -> WorkspaceId {
        serde_json::from_value(json!(value)).expect("workspace id")
    }

    fn revision() -> FileRevision {
        serde_json::from_value(json!({
            "device": "1",
            "inode": "1",
            "size": 0,
            "modifiedSeconds": 0,
            "modifiedNanoseconds": 0,
            "contentHash": "0",
        }))
        .expect("revision")
    }

    #[test]
    fn exact_utf16_boundary_saves_through_the_atomic_repository_path() {
        let root = std::env::temp_dir().join(format!(
            "codevo-workspace-save-boundary-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create fixture");
        fs::write(root.join("large.ts"), "old").expect("seed file");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register workspace");
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&descriptor.workspace_id, std::path::Path::new("large.ts"))
            .expect("read original")
            .revision;
        let exact = "a".repeat(WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT);

        let result = save_text_file_blocking(
            &registry,
            &descriptor.workspace_id,
            "large.ts",
            &exact,
            &expected,
        );

        assert!(matches!(result, FileCommandResult::Success { .. }));
        assert_eq!(
            fs::metadata(root.join("large.ts"))
                .expect("saved metadata")
                .len(),
            WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT as u64
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn save_content_accepts_exact_utf16_boundary_and_rejects_plus_one_before_fs() {
        let exact = "a".repeat(WORKSPACE_SAVE_UTF16_CODE_UNIT_LIMIT);
        assert!(validate_workspace_save_content(&exact).is_ok());

        let oversized = format!("{exact}a");
        assert!(validate_workspace_save_content(&oversized).is_err());
        let result = save_text_file_blocking(
            &WorkspaceRegistry::new(),
            &workspace_id("missing-workspace"),
            "missing.ts",
            &oversized,
            &revision(),
        );
        match result {
            FileCommandResult::Error { message } => {
                assert!(message.contains("UTF-16 code units"));
                assert!(!message.contains("unknown workspace"));
            }
            _ => panic!("oversized content must fail before workspace/filesystem access"),
        }
    }

    #[test]
    fn utf16_validation_handles_bmp_and_surrogate_pair_boundaries_exactly() {
        assert!(validate_utf16_code_units("€€", 2).is_ok());
        assert!(validate_utf16_code_units("€€€", 2).is_err());
        assert!(validate_utf16_code_units("😀", 2).is_ok());
        assert!(validate_utf16_code_units("😀a", 2).is_err());
        assert!(validate_utf16_code_units("€€", 1).is_err());
    }

    #[test]
    fn save_admission_is_bounded_per_workspace_and_released_on_drop() {
        let workspace_id = workspace_id("save-admission-workspace");
        let first = WorkspaceSavePermit::acquire(&workspace_id).expect("first permit");
        let second = WorkspaceSavePermit::acquire(&workspace_id).expect("second permit");
        assert_eq!(
            WorkspaceSavePermit::acquire(&workspace_id)
                .err()
                .expect("third permit rejected"),
            "workspace save concurrency limit reached"
        );
        drop(first);
        assert!(WorkspaceSavePermit::acquire(&workspace_id).is_ok());
        drop(second);
    }

    #[test]
    fn save_job_runs_blocking_work_off_the_async_caller_thread() {
        let caller_thread = thread::current().id();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let job = tauri::async_runtime::spawn(run_workspace_save_job(
            workspace_id("responsive-save-workspace"),
            move || {
                started_tx
                    .send(thread::current().id())
                    .expect("report worker");
                release_rx.recv().expect("release worker");
                Ok(FileCommandResult::Error {
                    message: "test complete".to_string(),
                })
            },
        ));
        let worker_thread = started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("blocking save work started");
        assert_ne!(worker_thread, caller_thread);
        release_tx.send(()).expect("release worker");
        let result = tauri::async_runtime::block_on(job).expect("save job joined");
        assert!(matches!(result, FileCommandResult::Error { .. }));
    }
}

#[tauri::command]
pub(crate) fn workspace_create_text_file(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).create_file(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_create_text_file_with_content(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    content: String,
) -> FileCommandResult {
    WorkspaceFileRepository::new(&registry).create_text_with_content(
        &workspace_id,
        Path::new(&relative_path),
        &content,
    )
}

#[tauri::command]
pub(crate) fn workspace_create_directory(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry)
        .create_directory(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_delete_path(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).delete(&workspace_id, Path::new(&relative_path))
}

#[tauri::command]
pub(crate) fn workspace_rename_path(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    from_relative_path: String,
    to_relative_path: String,
    overwrite: bool,
) -> MutationResult {
    WorkspaceFileRepository::new(&registry).rename(
        &workspace_id,
        Path::new(&from_relative_path),
        Path::new(&to_relative_path),
        overwrite,
    )
}
