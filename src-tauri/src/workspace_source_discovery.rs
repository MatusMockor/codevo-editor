use crate::run_blocking_command;
use crate::workspace_registry::{
    open_file_relative_to, opened_root_path, validate_relative_path, WorkspaceId, WorkspaceRegistry,
};
use ignore::WalkBuilder;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::{File, Metadata};
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

const MAX_FILES_CAP: usize = 2_000;
const MAX_PACKAGE_JSON_FILES_CAP: usize = 256;
const MAX_VISITED_CAP: usize = 50_000;
const MAX_TEXT_BYTES_CAP: usize = 2 * 1024 * 1024;
const MAX_CONCURRENT_SOURCE_READS: usize = 16;
const MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE: usize = 8;
const MAX_PENDING_SOURCE_READS: usize = 16;
const MAX_PENDING_SOURCE_READS_PER_WORKSPACE: usize = 8;
const SOURCE_READ_ADMISSION_TIMEOUT: Duration = Duration::from_secs(1);
const JAVASCRIPT_EXTENSIONS: &[&str] = &["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
const EXCLUDED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    "coverage",
];

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSourceFileEnumeration {
    files: Vec<String>,
    truncated: bool,
    visited: usize,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum BoundedWorkspaceSourceRead {
    Ok { content: String },
    NotFound,
    TooLarge,
    Changed,
}

#[derive(Default)]
struct SourceReadAdmission {
    active: usize,
    active_by_workspace: HashMap<String, usize>,
    pending: usize,
    pending_by_workspace: HashMap<String, usize>,
    pending_order: VecDeque<(u64, String)>,
    next_ticket: u64,
}

impl SourceReadAdmission {
    fn try_reserve(&mut self, workspace_key: &str) -> bool {
        let workspace_active = self
            .active_by_workspace
            .get(workspace_key)
            .copied()
            .unwrap_or_default();
        if self.active >= MAX_CONCURRENT_SOURCE_READS
            || workspace_active >= MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE
        {
            return false;
        }
        self.active += 1;
        self.active_by_workspace
            .insert(workspace_key.to_string(), workspace_active + 1);
        true
    }

    fn release(&mut self, workspace_key: &str) {
        self.active = self.active.saturating_sub(1);
        let Some(workspace_active) = self.active_by_workspace.get_mut(workspace_key) else {
            return;
        };
        *workspace_active = workspace_active.saturating_sub(1);
        if *workspace_active == 0 {
            self.active_by_workspace.remove(workspace_key);
        }
    }

    fn try_queue(&mut self, workspace_key: &str) -> Option<u64> {
        let workspace_pending = self
            .pending_by_workspace
            .get(workspace_key)
            .copied()
            .unwrap_or_default();
        if self.pending >= MAX_PENDING_SOURCE_READS
            || workspace_pending >= MAX_PENDING_SOURCE_READS_PER_WORKSPACE
        {
            return None;
        }
        let ticket = self.next_ticket;
        self.next_ticket = self.next_ticket.checked_add(1)?;
        self.pending += 1;
        self.pending_by_workspace
            .insert(workspace_key.to_string(), workspace_pending + 1);
        self.pending_order
            .push_back((ticket, workspace_key.to_string()));
        Some(ticket)
    }

    fn release_pending(&mut self, workspace_key: &str, ticket: u64) {
        let Some(index) = self
            .pending_order
            .iter()
            .position(|pending| pending.0 == ticket && pending.1 == workspace_key)
        else {
            return;
        };
        self.pending_order.remove(index);
        self.pending = self.pending.saturating_sub(1);
        let Some(workspace_pending) = self.pending_by_workspace.get_mut(workspace_key) else {
            return;
        };
        *workspace_pending = workspace_pending.saturating_sub(1);
        if *workspace_pending == 0 {
            self.pending_by_workspace.remove(workspace_key);
        }
    }

    fn try_promote(&mut self, workspace_key: &str, ticket: u64) -> bool {
        if self.active >= MAX_CONCURRENT_SOURCE_READS {
            return false;
        }
        let oldest_eligible = self.pending_order.iter().find(|pending| {
            self.active_by_workspace
                .get(&pending.1)
                .copied()
                .unwrap_or_default()
                < MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE
        });
        if !oldest_eligible.is_some_and(|pending| pending.0 == ticket && pending.1 == workspace_key)
        {
            return false;
        }
        if !self.try_reserve(workspace_key) {
            return false;
        }
        self.release_pending(workspace_key, ticket);
        true
    }
}

#[derive(Debug)]
struct SourceReadPermit {
    workspace_key: String,
}

impl Drop for SourceReadPermit {
    fn drop(&mut self) {
        let state = source_read_admission();
        if let Ok(mut admission) = state.admission.lock() {
            admission.release(&self.workspace_key);
            state.changed.notify_all();
        }
    }
}

struct SourceReadAdmissionState {
    admission: Mutex<SourceReadAdmission>,
    changed: Condvar,
}

fn source_read_admission() -> &'static SourceReadAdmissionState {
    static ADMISSION: OnceLock<SourceReadAdmissionState> = OnceLock::new();
    ADMISSION.get_or_init(|| SourceReadAdmissionState {
        admission: Mutex::new(SourceReadAdmission::default()),
        changed: Condvar::new(),
    })
}

fn try_acquire_source_read_permit(
    workspace_id: &WorkspaceId,
) -> Result<Option<SourceReadPermit>, String> {
    let workspace_key = workspace_id.as_str().to_string();
    let mut admission = source_read_admission()
        .admission
        .lock()
        .map_err(|_| "Workspace source read admission is unavailable.".to_string())?;
    if admission.pending > 0 {
        return Ok(None);
    }
    if !admission.try_reserve(&workspace_key) {
        return Ok(None);
    }
    Ok(Some(SourceReadPermit { workspace_key }))
}

struct PendingSourceRead {
    workspace_key: String,
    ticket: u64,
    deadline: Instant,
    pending: bool,
}

impl PendingSourceRead {
    fn wait(mut self, canceled: Arc<AtomicBool>) -> Result<SourceReadPermit, String> {
        let state = source_read_admission();
        let mut admission = state
            .admission
            .lock()
            .map_err(|_| "Workspace source read admission is unavailable.".to_string())?;
        loop {
            if canceled.load(Ordering::Acquire) {
                admission.release_pending(&self.workspace_key, self.ticket);
                self.pending = false;
                state.changed.notify_all();
                return Err("Workspace source read was canceled.".to_string());
            }
            let Some(remaining) = self.deadline.checked_duration_since(Instant::now()) else {
                admission.release_pending(&self.workspace_key, self.ticket);
                self.pending = false;
                state.changed.notify_all();
                return Err("Timed out waiting for workspace source read capacity.".to_string());
            };
            if admission.try_promote(&self.workspace_key, self.ticket) {
                self.pending = false;
                state.changed.notify_all();
                return Ok(SourceReadPermit {
                    workspace_key: self.workspace_key.clone(),
                });
            }
            let (next_admission, timeout) = state
                .changed
                .wait_timeout(admission, remaining)
                .map_err(|_| "Workspace source read admission is unavailable.".to_string())?;
            admission = next_admission;
            if timeout.timed_out() {
                admission.release_pending(&self.workspace_key, self.ticket);
                self.pending = false;
                state.changed.notify_all();
                return Err("Timed out waiting for workspace source read capacity.".to_string());
            }
        }
    }
}

impl Drop for PendingSourceRead {
    fn drop(&mut self) {
        if !self.pending {
            return;
        }
        let state = source_read_admission();
        if let Ok(mut admission) = state.admission.lock() {
            admission.release_pending(&self.workspace_key, self.ticket);
            state.changed.notify_all();
        }
    }
}

fn queue_source_read(workspace_id: &WorkspaceId) -> Result<PendingSourceRead, String> {
    let workspace_key = workspace_id.as_str().to_string();
    let mut admission = source_read_admission()
        .admission
        .lock()
        .map_err(|_| "Workspace source read admission is unavailable.".to_string())?;
    let Some(ticket) = admission.try_queue(&workspace_key) else {
        return Err("Too many workspace source reads are already waiting.".to_string());
    };
    Ok(PendingSourceRead {
        workspace_key,
        ticket,
        deadline: Instant::now() + SOURCE_READ_ADMISSION_TIMEOUT,
        pending: true,
    })
}

struct PendingReadCancellation {
    canceled: Arc<AtomicBool>,
    workspace_key: String,
    ticket: u64,
    armed: bool,
}

impl Drop for PendingReadCancellation {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        self.canceled.store(true, Ordering::Release);
        let state = source_read_admission();
        if let Ok(mut admission) = state.admission.lock() {
            admission.release_pending(&self.workspace_key, self.ticket);
        }
        state.changed.notify_all();
    }
}

async fn acquire_source_read_permit(
    workspace_id: &WorkspaceId,
) -> Result<SourceReadPermit, String> {
    if let Some(permit) = try_acquire_source_read_permit(workspace_id)? {
        return Ok(permit);
    }
    let pending = queue_source_read(workspace_id)?;
    let canceled = Arc::new(AtomicBool::new(false));
    let worker_canceled = Arc::clone(&canceled);
    let mut cancellation = PendingReadCancellation {
        canceled,
        workspace_key: pending.workspace_key.clone(),
        ticket: pending.ticket,
        armed: true,
    };
    let (result_tx, mut result_rx) = tauri::async_runtime::channel(1);
    let _waiter = std::thread::Builder::new()
        .name("workspace-source-read-admission".to_string())
        .spawn(move || {
            let _ = result_tx.blocking_send(pending.wait(worker_canceled));
        })
        .map_err(|error| format!("Failed to start workspace source read admission: {error}"))?;
    let result = result_rx.recv().await.unwrap_or_else(|| {
        Err("Workspace source read admission stopped before completion.".to_string())
    });
    cancellation.armed = false;
    result
}

fn validate_source_read_workspace(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
) -> Result<(), String> {
    registry
        .descriptor(workspace_id)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn workspace_enumerate_js_source_files(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    max_files: usize,
    max_visited: usize,
) -> Result<WorkspaceSourceFileEnumeration, String> {
    let max_files = require_positive_limit(max_files, "maxFiles")?;
    let max_visited = require_positive_limit(max_visited, "maxVisited")?;
    let root = registry
        .clone_root(&workspace_id)
        .map_err(|error| error.to_string())?;
    run_blocking_command(move || {
        enumerate_registered_js_source_files(&root, max_files, max_visited)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn workspace_enumerate_package_json_files(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    max_files: usize,
    max_visited: usize,
) -> Result<WorkspaceSourceFileEnumeration, String> {
    let max_files = require_positive_limit(max_files, "maxFiles")?;
    let max_visited = require_positive_limit(max_visited, "maxVisited")?;
    let root = registry
        .clone_root(&workspace_id)
        .map_err(|error| error.to_string())?;
    run_blocking_command(move || {
        enumerate_registered_package_json_files(&root, max_files, max_visited)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn workspace_read_source_text_bounded(
    registry: State<'_, WorkspaceRegistry>,
    workspace_id: WorkspaceId,
    relative_path: String,
    max_bytes: usize,
) -> Result<BoundedWorkspaceSourceRead, String> {
    let max_bytes = require_positive_limit(max_bytes, "maxBytes")?;
    let path = Path::new(&relative_path);
    validate_relative_path(path).map_err(|error| error.to_string())?;
    validate_source_read_workspace(&registry, &workspace_id)?;
    let permit = acquire_source_read_permit(&workspace_id).await?;
    let root = registry
        .clone_root(&workspace_id)
        .map_err(|error| error.to_string())?;
    let relative_path = path.to_path_buf();
    read_registered_source_text_bounded_with_permit(root, relative_path, max_bytes, permit).await
}

#[cfg(test)]
async fn read_registered_source_text_bounded(
    root: File,
    relative_path: std::path::PathBuf,
    max_bytes: usize,
) -> Result<BoundedWorkspaceSourceRead, String> {
    read_registered_source_text_bounded_with_hook(root, relative_path, max_bytes, None, || {}).await
}

async fn read_registered_source_text_bounded_with_permit(
    root: File,
    relative_path: std::path::PathBuf,
    max_bytes: usize,
    permit: SourceReadPermit,
) -> Result<BoundedWorkspaceSourceRead, String> {
    read_registered_source_text_bounded_with_hook(
        root,
        relative_path,
        max_bytes,
        Some(permit),
        || {},
    )
    .await
}

async fn read_registered_source_text_bounded_with_hook<F>(
    root: File,
    relative_path: std::path::PathBuf,
    max_bytes: usize,
    permit: Option<SourceReadPermit>,
    before_open: F,
) -> Result<BoundedWorkspaceSourceRead, String>
where
    F: FnOnce() + Send + 'static,
{
    run_blocking_command(move || {
        let _permit = permit;
        before_open();
        let file = match open_file_relative_to(&root, &relative_path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(BoundedWorkspaceSourceRead::NotFound);
            }
            Err(error) => return Err(error.to_string()),
        };
        read_source_text_bounded(file, max_bytes).map_err(|error| error.to_string())
    })
    .await
}

fn require_positive_limit(value: usize, field: &str) -> Result<usize, String> {
    if value == 0 {
        return Err(format!("{field} must be a positive integer."));
    }
    Ok(value)
}

fn enumerate_registered_js_source_files(
    root: &File,
    max_files: usize,
    max_visited: usize,
) -> io::Result<WorkspaceSourceFileEnumeration> {
    let root_path = opened_root_path(root)?;
    ensure_registered_root_identity(root, &root_path)?;
    let result = enumerate_js_source_files(&root_path, max_files, max_visited)?;
    if opened_root_path(root)? != root_path {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root moved during source discovery",
        ));
    }
    ensure_registered_root_identity(root, &root_path)?;
    Ok(result)
}

fn enumerate_registered_package_json_files(
    root: &File,
    max_files: usize,
    max_visited: usize,
) -> io::Result<WorkspaceSourceFileEnumeration> {
    let root_path = opened_root_path(root)?;
    ensure_registered_root_identity(root, &root_path)?;
    let result = enumerate_package_json_files(&root_path, max_files, max_visited)?;
    if opened_root_path(root)? != root_path {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root moved during package discovery",
        ));
    }
    ensure_registered_root_identity(root, &root_path)?;
    Ok(result)
}

fn enumerate_js_source_files(
    root: &Path,
    requested_max_files: usize,
    requested_max_visited: usize,
) -> io::Result<WorkspaceSourceFileEnumeration> {
    enumerate_workspace_files(
        root,
        requested_max_files,
        MAX_FILES_CAP,
        requested_max_visited,
        is_javascript_source_file,
        "source file escaped workspace root",
    )
}

fn enumerate_package_json_files(
    root: &Path,
    requested_max_files: usize,
    requested_max_visited: usize,
) -> io::Result<WorkspaceSourceFileEnumeration> {
    enumerate_workspace_files(
        root,
        requested_max_files,
        MAX_PACKAGE_JSON_FILES_CAP,
        requested_max_visited,
        |path| path.file_name().is_some_and(|name| name == "package.json"),
        "package manifest escaped workspace root",
    )
}

fn enumerate_workspace_files(
    root: &Path,
    requested_max_files: usize,
    max_files_cap: usize,
    requested_max_visited: usize,
    accepts_file: impl Fn(&Path) -> bool,
    escaped_message: &str,
) -> io::Result<WorkspaceSourceFileEnumeration> {
    let max_files = requested_max_files.clamp(1, max_files_cap);
    let max_visited = requested_max_visited.clamp(1, MAX_VISITED_CAP);
    let mut builder = WalkBuilder::new(root);
    builder
        .follow_links(false)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(true)
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_some_and(|kind| kind.is_dir())
                || !entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| EXCLUDED_DIRECTORY_NAMES.contains(&name))
        })
        .sort_by_file_path(|left, right| left.cmp(right));

    let mut entries = builder.build();
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut exhausted = false;
    let mut truncated_by_files = false;
    while visited < max_visited {
        let Some(entry) = entries.next() else {
            exhausted = true;
            break;
        };
        let entry = entry.map_err(|error| io::Error::other(error.to_string()))?;
        visited += 1;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) || !accepts_file(entry.path()) {
            continue;
        }
        if files.len() >= max_files {
            truncated_by_files = true;
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, escaped_message))?;
        files.push(relative_path_string(relative)?);
    }

    let truncated_by_visits = !exhausted && entries.next().is_some();
    files.sort();
    Ok(WorkspaceSourceFileEnumeration {
        files,
        truncated: truncated_by_visits || truncated_by_files,
        visited,
    })
}

fn read_source_text_bounded(
    file: File,
    requested_max_bytes: usize,
) -> io::Result<BoundedWorkspaceSourceRead> {
    read_source_text_bounded_with_hook(file, requested_max_bytes, || {})
}

fn read_source_text_bounded_with_hook<F>(
    mut file: File,
    requested_max_bytes: usize,
    after_metadata: F,
) -> io::Result<BoundedWorkspaceSourceRead>
where
    F: FnOnce(),
{
    let max_bytes = requested_max_bytes.clamp(1, MAX_TEXT_BYTES_CAP);
    let before = file.metadata()?;
    if before.len() > max_bytes as u64 {
        return Ok(BoundedWorkspaceSourceRead::TooLarge);
    }
    after_metadata();

    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    if bytes.len() > max_bytes || after.len() > max_bytes as u64 {
        return Ok(BoundedWorkspaceSourceRead::TooLarge);
    }
    if !same_file_snapshot(&before, &after) {
        return Ok(BoundedWorkspaceSourceRead::Changed);
    }

    let content = String::from_utf8(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(BoundedWorkspaceSourceRead::Ok { content })
}

fn ensure_registered_root_identity(root: &File, path: &Path) -> io::Result<()> {
    let registered = root.metadata()?;
    let current = std::fs::metadata(path)?;
    if !same_file_identity(&registered, &current) || !current.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "registered workspace root identity changed",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn same_file_identity(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file_identity(_left: &Metadata, _right: &Metadata) -> bool {
    false
}

#[cfg(unix)]
fn same_file_snapshot(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    same_file_identity(left, right)
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_file_snapshot(_left: &Metadata, _right: &Metadata) -> bool {
    false
}

fn is_javascript_source_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") {
        return false;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| JAVASCRIPT_EXTENSIONS.contains(&extension))
}

fn relative_path_string(path: &Path) -> io::Result<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value.split('/').any(|part| part == "." || part == "..")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid workspace-relative source path",
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Seek, SeekFrom, Write};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;

    struct Fixture(PathBuf);

    impl std::ops::Deref for Fixture {
        type Target = Path;

        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(name: &str) -> Fixture {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "workspace-source-discovery-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create fixture");
        Fixture(root)
    }

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        fs::write(path, content).expect("write fixture");
    }

    fn source_read_admission_test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock source read admission test")
    }

    fn pending_source_reads(workspace_id: &WorkspaceId) -> usize {
        source_read_admission()
            .admission
            .lock()
            .expect("lock source read admission")
            .pending_by_workspace
            .get(workspace_id.as_str())
            .copied()
            .unwrap_or_default()
    }

    fn wait_for_pending_source_reads(workspace_id: &WorkspaceId, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if pending_source_reads(workspace_id) == expected {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(pending_source_reads(workspace_id), expected);
    }

    #[test]
    fn enumerates_all_supported_sources_deterministically_and_honors_ignore() {
        let root = fixture("order-ignore");
        write(&root, ".gitignore", "ignored/\n");
        for (index, extension) in JAVASCRIPT_EXTENSIONS.iter().enumerate() {
            write(&root, &format!("src/{index}.{extension}"), "export {};");
        }
        write(&root, "src/types.d.ts", "declare const value: string;");
        write(&root, "src/types.d.mts", "declare const value: string;");
        write(&root, "ignored/no.ts", "export {};");
        write(&root, "node_modules/pkg/no.js", "module.exports = {};");
        write(&root, "dist/no.js", "export {};");
        write(&root, "src/no.json", "{}");

        let result = enumerate_js_source_files(&root, 20, 100).expect("enumeration");

        assert_eq!(result.files.len(), JAVASCRIPT_EXTENSIONS.len());
        assert!(result.files.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(!result.truncated);
    }

    #[test]
    fn reports_file_and_visit_truncation_truthfully() {
        let root = fixture("truncation");
        write(&root, "only.ts", "export {};");
        let exact = enumerate_js_source_files(&root, 1, 100).expect("exact file cap");
        assert_eq!(exact.files, ["only.ts"]);
        assert!(!exact.truncated);

        write(&root, "two.ts", "export {};");
        let files = enumerate_js_source_files(&root, 1, 100).expect("file cap");
        assert_eq!(files.files.len(), 1);
        assert!(files.truncated);

        let visits = enumerate_js_source_files(&root, 20, 1).expect("visit cap");
        assert_eq!(visits.visited, 1);
        assert!(visits.truncated);
    }

    #[test]
    fn enumerates_root_and_nested_package_json_files_deterministically_with_a_bounded_result() {
        let root = fixture("package-json");
        write(&root, "package.json", "{}");
        for index in 0..=MAX_PACKAGE_JSON_FILES_CAP {
            write(&root, &format!("packages/{index:03}/package.json"), "{}");
        }
        write(&root, "node_modules/ignored/package.json", "{}");

        let result = enumerate_package_json_files(&root, 1_000, 1_000).expect("enumeration");

        assert_eq!(result.files.len(), MAX_PACKAGE_JSON_FILES_CAP);
        assert_eq!(
            result.files.first().map(String::as_str),
            Some("package.json")
        );
        assert!(result.files.iter().any(|path| path == "package.json"));
        assert!(result
            .files
            .iter()
            .any(|path| path == "packages/000/package.json"));
        assert!(result.files.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(!result
            .files
            .iter()
            .any(|path| path.starts_with("node_modules/")));
        assert!(result.truncated);
    }

    #[test]
    fn command_limits_reject_zero_instead_of_drifting_to_one() {
        assert_eq!(
            require_positive_limit(0, "maxFiles").unwrap_err(),
            "maxFiles must be a positive integer."
        );
        assert_eq!(require_positive_limit(1, "maxFiles").unwrap(), 1);
    }

    #[test]
    fn source_read_admission_enforces_workspace_and_global_caps_and_releases_capacity() {
        let mut workspace_admission = SourceReadAdmission::default();
        for _ in 0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE {
            assert!(workspace_admission.try_reserve("workspace-a"));
        }
        assert!(!workspace_admission.try_reserve("workspace-a"));
        assert!(workspace_admission.try_reserve("workspace-b"));
        workspace_admission.release("workspace-a");
        assert!(workspace_admission.try_reserve("workspace-a"));

        let mut global_admission = SourceReadAdmission::default();
        for index in 0..MAX_CONCURRENT_SOURCE_READS {
            assert!(global_admission.try_reserve(&format!("workspace-{index}")));
        }
        assert!(!global_admission.try_reserve("workspace-overflow"));
        global_admission.release("workspace-0");
        assert!(global_admission.try_reserve("workspace-overflow"));

        let mut pending_admission = SourceReadAdmission::default();
        let pending_tickets = (0..MAX_PENDING_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                pending_admission
                    .try_queue("workspace-a")
                    .expect("queue workspace waiter")
            })
            .collect::<Vec<_>>();
        assert!(pending_admission.try_queue("workspace-a").is_none());
        pending_admission.release_pending("workspace-a", pending_tickets[0]);
        assert!(pending_admission.try_queue("workspace-a").is_some());

        let mut global_pending_admission = SourceReadAdmission::default();
        let mut global_pending_tickets = Vec::new();
        for index in 0..MAX_PENDING_SOURCE_READS {
            global_pending_tickets.push(
                global_pending_admission
                    .try_queue(&format!("workspace-{index}"))
                    .expect("queue global waiter"),
            );
        }
        assert!(global_pending_admission
            .try_queue("workspace-overflow")
            .is_none());
        global_pending_admission.release_pending("workspace-0", global_pending_tickets[0]);
        assert!(global_pending_admission
            .try_queue("workspace-overflow")
            .is_some());
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn production_source_read_permits_match_the_eight_read_caller_batch() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-permits");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let mut permits = Vec::new();
        for _ in 0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE {
            permits.push(
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("admit supported caller batch"),
            );
        }
        assert_eq!(permits.len(), 8);
        assert!(try_acquire_source_read_permit(&descriptor.workspace_id)
            .expect("admission available")
            .is_none());

        permits.pop();
        permits.push(
            try_acquire_source_read_permit(&descriptor.workspace_id)
                .expect("admission available")
                .expect("released capacity is reusable"),
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn saturated_production_admission_waits_for_release_without_blocking_async_progress() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-backpressure");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let mut permits = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("fill active batch")
            })
            .collect::<Vec<_>>();
        let waiting_workspace = descriptor.workspace_id.clone();
        let (completed_tx, completed_rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            completed_tx
                .send(acquire_source_read_permit(&waiting_workspace).await)
                .expect("report waiting admission");
        });

        assert!(matches!(
            completed_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        let (responsive_tx, responsive_rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            responsive_tx.send(()).expect("report async progress");
        });
        responsive_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("async runtime remains responsive while admission waits");

        permits.pop();
        let promoted = completed_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("waiting admission completed")
            .expect("waiting admission promoted");
        drop(promoted);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn queued_source_reads_are_promoted_fifo_ahead_of_fresh_arrivals() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-fifo");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let mut permits = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("fill active batch")
            })
            .collect::<Vec<_>>();
        let (completed_tx, completed_rx) = mpsc::channel();

        for ordinal in 1..=2 {
            let workspace_id = descriptor.workspace_id.clone();
            let completed_tx = completed_tx.clone();
            tauri::async_runtime::spawn(async move {
                completed_tx
                    .send((ordinal, acquire_source_read_permit(&workspace_id).await))
                    .expect("report queued admission");
            });
            wait_for_pending_source_reads(&descriptor.workspace_id, ordinal);
        }
        let workspace_id = descriptor.workspace_id.clone();
        tauri::async_runtime::spawn(async move {
            completed_tx
                .send((3, acquire_source_read_permit(&workspace_id).await))
                .expect("report fresh admission");
        });
        wait_for_pending_source_reads(&descriptor.workspace_id, 3);

        permits.pop();
        for expected in 1..=3 {
            let (ordinal, result) = completed_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("queued admission completed");
            assert_eq!(ordinal, expected);
            drop(result.expect("queued admission promoted"));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn oldest_eligible_waiter_uses_cross_workspace_capacity_without_head_of_line_blocking() {
        let _test_lock = source_read_admission_test_lock();
        let root_a = fixture("source-read-hol-a");
        let root_b = fixture("source-read-hol-b");
        let registry = WorkspaceRegistry::new();
        let workspace_a = registry.register(&*root_a).expect("register workspace A");
        let workspace_b = registry.register(&*root_b).expect("register workspace B");
        let mut permits_a = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&workspace_a.workspace_id)
                    .expect("admission available")
                    .expect("fill workspace A")
            })
            .collect::<Vec<_>>();
        let _permits_b = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE - 1)
            .map(|_| {
                try_acquire_source_read_permit(&workspace_b.workspace_id)
                    .expect("admission available")
                    .expect("leave one global and workspace B slot")
            })
            .collect::<Vec<_>>();
        let (completed_tx, completed_rx) = mpsc::channel();

        let waiting_a = workspace_a.workspace_id.clone();
        let completed_a = completed_tx.clone();
        tauri::async_runtime::spawn(async move {
            completed_a
                .send(("a", acquire_source_read_permit(&waiting_a).await))
                .expect("report workspace A admission");
        });
        wait_for_pending_source_reads(&workspace_a.workspace_id, 1);

        let waiting_b = workspace_b.workspace_id.clone();
        tauri::async_runtime::spawn(async move {
            completed_tx
                .send(("b", acquire_source_read_permit(&waiting_b).await))
                .expect("report workspace B admission");
        });
        let (first_workspace, first_result) = completed_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("eligible workspace B admission completed");
        assert_eq!(first_workspace, "b");
        let permit_b = first_result.expect("workspace B promoted");
        assert_eq!(pending_source_reads(&workspace_a.workspace_id), 1);

        permits_a.pop();
        let (second_workspace, second_result) = completed_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("workspace A admission completed after release");
        assert_eq!(second_workspace, "a");
        drop(second_result.expect("workspace A promoted"));
        drop(permit_b);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn canceling_a_waiting_read_releases_its_pending_ticket_promptly() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-cancel");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let _permits = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("fill active batch")
            })
            .collect::<Vec<_>>();
        let waiting_workspace = descriptor.workspace_id.clone();
        let waiting = tauri::async_runtime::spawn(async move {
            acquire_source_read_permit(&waiting_workspace).await
        });
        wait_for_pending_source_reads(&descriptor.workspace_id, 1);

        waiting.abort();
        wait_for_pending_source_reads(&descriptor.workspace_id, 0);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn cancellation_and_timeout_start_before_the_blocking_waiter_runs() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-prestart-cancel");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let mut permits = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("fill active batch")
            })
            .collect::<Vec<_>>();

        let canceled_pending =
            queue_source_read(&descriptor.workspace_id).expect("queue canceled waiter");
        let canceled = Arc::new(AtomicBool::new(false));
        let cancellation = PendingReadCancellation {
            canceled: Arc::clone(&canceled),
            workspace_key: canceled_pending.workspace_key.clone(),
            ticket: canceled_pending.ticket,
            armed: true,
        };
        assert_eq!(pending_source_reads(&descriptor.workspace_id), 1);
        drop(cancellation);
        assert_eq!(pending_source_reads(&descriptor.workspace_id), 0);
        assert_eq!(
            canceled_pending
                .wait(canceled)
                .expect_err("pre-start cancellation must win"),
            "Workspace source read was canceled."
        );

        let mut expired_pending =
            queue_source_read(&descriptor.workspace_id).expect("queue expired waiter");
        expired_pending.deadline = Instant::now()
            .checked_sub(Duration::from_millis(1))
            .expect("past deadline");
        permits.pop();
        let started = Instant::now();
        assert_eq!(
            expired_pending
                .wait(Arc::new(AtomicBool::new(false)))
                .expect_err("pre-start timeout must win"),
            "Timed out waiting for workspace source read capacity."
        );
        assert!(started.elapsed() < Duration::from_millis(100));
        assert_eq!(pending_source_reads(&descriptor.workspace_id), 0);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn admission_timeout_bounds_async_wall_clock_independently_of_blocking_io_work() {
        let _test_lock = source_read_admission_test_lock();
        let root = fixture("source-read-wall-clock-timeout");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        let _permits = (0..MAX_CONCURRENT_SOURCE_READS_PER_WORKSPACE)
            .map(|_| {
                try_acquire_source_read_permit(&descriptor.workspace_id)
                    .expect("admission available")
                    .expect("fill active batch")
            })
            .collect::<Vec<_>>();
        let (blocking_started_tx, blocking_started_rx) = mpsc::channel();
        let (release_blocking_tx, release_blocking_rx) = mpsc::channel();
        let blocking = tauri::async_runtime::spawn(run_blocking_command(move || {
            blocking_started_tx.send(()).expect("report blocking work");
            release_blocking_rx.recv().expect("release blocking work");
            Ok(())
        }));
        blocking_started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("blocking work started");

        let started = Instant::now();
        let error =
            tauri::async_runtime::block_on(acquire_source_read_permit(&descriptor.workspace_id))
                .expect_err("saturated admission must time out");
        let elapsed = started.elapsed();
        assert_eq!(
            error,
            "Timed out waiting for workspace source read capacity."
        );
        assert!(elapsed >= Duration::from_millis(800));
        assert!(elapsed < Duration::from_millis(1_500));
        assert_eq!(pending_source_reads(&descriptor.workspace_id), 0);

        release_blocking_tx.send(()).expect("release blocking work");
        tauri::async_runtime::block_on(blocking)
            .expect("blocking task joined")
            .expect("blocking work completed");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn closed_workspace_is_rejected_before_source_read_admission() {
        let root = fixture("source-read-closed-workspace");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&*root).expect("register workspace");
        registry
            .unregister(&descriptor.workspace_id)
            .expect("unregister workspace");

        assert!(validate_source_read_workspace(&registry, &descriptor.workspace_id).is_err());
        assert_eq!(pending_source_reads(&descriptor.workspace_id), 0);
    }

    #[test]
    fn bounded_read_returns_ok_too_large_and_changed_without_overreading() {
        let root = fixture("bounded-read");
        write(&root, "small.ts", "1234");
        write(&root, "large.ts", "12345");
        assert_eq!(
            read_source_text_bounded(File::open(root.join("small.ts")).unwrap(), 4).unwrap(),
            BoundedWorkspaceSourceRead::Ok {
                content: "1234".to_string()
            }
        );
        assert_eq!(
            read_source_text_bounded(File::open(root.join("large.ts")).unwrap(), 4).unwrap(),
            BoundedWorkspaceSourceRead::TooLarge
        );

        let changed_path = root.join("small.ts");
        let changed = File::open(&changed_path).unwrap();
        assert_eq!(
            read_source_text_bounded_with_hook(changed, 4, || {
                let mut writer = File::options().write(true).open(&changed_path).unwrap();
                writer.seek(SeekFrom::Start(0)).unwrap();
                writer.write_all(b"5678").unwrap();
                writer.sync_all().unwrap();
            })
            .unwrap(),
            BoundedWorkspaceSourceRead::Changed
        );
    }

    #[test]
    fn missing_descriptor_relative_source_has_a_closed_not_found_wire_result() {
        let root = fixture("bounded-read-not-found");
        let retained_root = File::open(&*root).expect("open root descriptor");

        let result = tauri::async_runtime::block_on(read_registered_source_text_bounded(
            retained_root,
            PathBuf::from("missing/tsconfig.json"),
            64,
        ))
        .expect("missing descendant is a closed result");

        assert_eq!(result, BoundedWorkspaceSourceRead::NotFound);
        assert_eq!(
            serde_json::to_value(result).expect("serialize bounded read"),
            serde_json::json!({ "status": "notFound" })
        );
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_relative_authority_failures_are_not_reported_as_not_found() {
        use std::os::unix::fs::symlink;

        let root = fixture("bounded-read-authority-errors");
        let outside = fixture("bounded-read-authority-errors-outside");
        write(&outside, "secret.ts", "export const secret = true;");
        symlink(outside.join("secret.ts"), root.join("linked.ts")).expect("create leaf symlink");
        fs::create_dir(root.join("directory.ts")).expect("create directory");
        write(&root, "regular.ts", "export {};");

        for relative_path in ["linked.ts", "directory.ts", "regular.ts/child.ts"] {
            let retained_root = File::open(&*root).expect("open root descriptor");
            let result = tauri::async_runtime::block_on(read_registered_source_text_bounded(
                retained_root,
                PathBuf::from(relative_path),
                64,
            ));
            assert!(
                result.is_err(),
                "{relative_path} must remain an authority/type error"
            );
        }
    }

    #[test]
    fn registered_bounded_read_keeps_descriptor_io_off_the_async_caller() {
        let root = fixture("bounded-read-blocking-pool");
        write(&root, "source.ts", "export {};");
        let retained_root = File::open(&*root).expect("open root descriptor");
        let caller_thread = std::thread::current().id();
        let (executor_tx, executor_rx) = mpsc::channel();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let read = tauri::async_runtime::spawn(async move {
            executor_tx
                .send(std::thread::current().id())
                .expect("report async executor");
            read_registered_source_text_bounded_with_hook(
                retained_root,
                PathBuf::from("source.ts"),
                64,
                None,
                move || {
                    entered_tx
                        .send(std::thread::current().id())
                        .expect("report blocking worker");
                    release_rx.recv().expect("release blocking worker");
                },
            )
            .await
        });

        let executor_thread = executor_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("async task started");
        let worker_thread = entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("blocking read started");
        assert_ne!(executor_thread, caller_thread);
        assert_ne!(worker_thread, caller_thread);
        assert_ne!(worker_thread, executor_thread);

        let (responsive_tx, responsive_rx) = mpsc::channel();
        tauri::async_runtime::spawn(async move {
            responsive_tx.send(()).expect("report async progress");
        });
        responsive_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("async runtime remains responsive");

        release_tx.send(()).expect("release bounded read");
        let result = tauri::async_runtime::block_on(read)
            .expect("read task joined")
            .expect("bounded read");
        assert_eq!(
            result,
            BoundedWorkspaceSourceRead::Ok {
                content: "export {};".to_string()
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn registered_bounded_read_stays_bound_to_the_retained_root_descriptor() {
        let selected = fixture("bounded-read-retained-root");
        write(&selected, "source.ts", "original");
        let retained_root = File::open(&*selected).expect("open root descriptor");
        let moved = selected.with_extension("moved");
        fs::rename(&*selected, &moved).expect("move original root");
        fs::create_dir(&*selected).expect("replace selected path");
        write(&selected, "source.ts", "replacement");

        let result = tauri::async_runtime::block_on(read_registered_source_text_bounded(
            retained_root,
            PathBuf::from("source.ts"),
            64,
        ))
        .expect("bounded descriptor read");
        assert_eq!(
            result,
            BoundedWorkspaceSourceRead::Ok {
                content: "original".to_string()
            }
        );

        fs::remove_dir_all(&*selected).expect("remove replacement");
        fs::rename(&moved, &*selected).expect("restore selected root");
    }

    #[cfg(unix)]
    #[test]
    fn enumeration_does_not_follow_directory_symlinks() {
        use std::os::unix::fs::symlink;
        let root = fixture("symlink");
        let outside = fixture("outside");
        write(&outside, "secret.ts", "export const secret = true;");
        symlink(&*outside, root.join("linked")).expect("symlink");
        assert!(enumerate_js_source_files(&root, 20, 100)
            .expect("enumeration")
            .files
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn registered_enumeration_stays_bound_to_the_retained_root() {
        let selected = fixture("selected");
        write(&selected, "original.ts", "export {};");
        let retained = File::open(&*selected).expect("open root");
        let moved = selected.with_extension("moved");
        fs::rename(&*selected, &moved).expect("move original root");
        fs::create_dir(&*selected).expect("replace selected path");
        write(&selected, "replacement.ts", "export {};");

        let result = enumerate_registered_js_source_files(&retained, 20, 100)
            .expect("registered enumeration");
        assert_eq!(result.files, ["original.ts"]);

        fs::remove_dir_all(&*selected).expect("remove replacement");
        fs::rename(&moved, &*selected).expect("restore selected root");
    }
}
