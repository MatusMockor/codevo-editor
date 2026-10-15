use crate::workspace_file_commands::{
    DescriptorFileEntry, DescriptorFileSearchResponse, FileCommandResult, MutationResult,
    WorkspaceFileIndexCache, WorkspaceFileRepository,
};
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::{
    collections::HashMap,
    io,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::State;

const SEARCH_RELATIVE_PATH_BYTE_LIMIT: usize = 16 * 1024;
const SEARCH_QUERY_BYTE_LIMIT: usize = 64 * 1024;
const SEARCH_REQUEST_GENERATION_BYTE_LIMIT: usize = 128;
const SEARCH_GLOBAL_CONCURRENCY_LIMIT: usize = 8;
const SEARCH_WORKSPACE_CONCURRENCY_LIMIT: usize = 4;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum WorkspaceSearchKind {
    Files,
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
    if let Err(error) = validate_search_payload(&relative_path, &query) {
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
    let execution = outcome?;
    owner_result?;
    Ok(DescriptorFileSearchResponse {
        results: execution.results,
        truncated: execution.truncated,
        request_generation,
    })
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

fn validate_search_payload(relative_path: &str, query: &str) -> Result<(), String> {
    if relative_path.len() > SEARCH_RELATIVE_PATH_BYTE_LIMIT {
        return Err("workspace search relativePath exceeds 16 KiB".to_string());
    }
    if query.len() > SEARCH_QUERY_BYTE_LIMIT {
        return Err("workspace search query exceeds 64 KiB".to_string());
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
        let foreign = lifecycle
            .begin(&second.workspace_id, WorkspaceSearchKind::Files, "a".into())
            .unwrap();
        let current = lifecycle
            .begin(&first.workspace_id, WorkspaceSearchKind::Files, "ab".into())
            .unwrap();

        assert!(!stale.is_current());
        assert!(current.is_current());
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
