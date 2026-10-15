use crate::terminal_session::TerminalSupervisor;
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use std::{
    ffi::OsString,
    path::{Component, Path, PathBuf},
};

pub trait WorkspaceWatchDisposer {
    fn stop_workspace_watch(&self, root_path: &str);
}

pub trait TerminalSessionDisposer {
    fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String>;
}

pub struct WorkspaceRuntimeDisposal<'a> {
    pub workspace_file_change_watch_registry: &'a dyn WorkspaceWatchDisposer,
    pub terminal_sessions: &'a dyn TerminalSessionDisposer,
}

pub fn dispose_workspace_root(
    root_path: &Path,
    runtime: WorkspaceRuntimeDisposal<'_>,
) -> Result<(), String> {
    let root_key = workspace_root_disposal_key(root_path);

    runtime
        .workspace_file_change_watch_registry
        .stop_workspace_watch(&root_key);
    runtime.terminal_sessions.stop_terminal_sessions(root_path)
}

fn workspace_root_disposal_key(root_path: &Path) -> String {
    path_key(
        &resolve_existing_or_parent_path(root_path).unwrap_or_else(|| normalize_path(root_path)),
    )
}

fn resolve_existing_or_parent_path(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }

    let mut cursor = path.to_path_buf();
    let mut missing_components: Vec<OsString> = Vec::new();

    while !cursor.exists() {
        missing_components.push(cursor.file_name()?.to_os_string());

        if !cursor.pop() {
            return None;
        }
    }

    let mut resolved = cursor.canonicalize().ok()?;

    while let Some(component) = missing_components.pop() {
        resolved.push(component);
    }

    Some(normalize_path(&resolved))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

impl WorkspaceWatchDisposer for WorkspaceFileChangeWatchRegistry {
    fn stop_workspace_watch(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl TerminalSessionDisposer for TerminalSupervisor {
    fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String> {
        self.stop_root(root_path)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dispose_workspace_root, TerminalSessionDisposer, WorkspaceRuntimeDisposal,
        WorkspaceWatchDisposer,
    };
    use std::{
        collections::HashSet,
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn disposal_stops_requested_root_without_touching_other_roots() {
        let root_a = PathBuf::from("/workspace-a");
        let root_b = PathBuf::from("/workspace-b");
        let root_a_key = root_key(&root_a);
        let root_b_key = root_key(&root_b);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let file_watch =
            RecordingRootDisposer::new("file-watch", [&root_a_key, &root_b_key], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root_a, &root_b], &calls);

        dispose_workspace_root(
            &root_a,
            WorkspaceRuntimeDisposal {
                workspace_file_change_watch_registry: &file_watch,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(!file_watch.contains(&root_a_key));
        assert!(file_watch.contains(&root_b_key));
        assert!(!terminals.contains(&root_a));
        assert!(terminals.contains(&root_b));
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &["file-watch:/workspace-a", "terminal:/workspace-a",]
        );
    }

    #[test]
    fn disposal_returns_terminal_stop_errors_after_cancelling_other_runtime_parts() {
        let root = PathBuf::from("/workspace");
        let root_key = root_key(&root);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let terminals =
            RecordingTerminalDisposer::failing("terminal", [&root], &calls, "terminal lock failed");

        let error = dispose_workspace_root(
            &root,
            WorkspaceRuntimeDisposal {
                workspace_file_change_watch_registry: &file_watch,
                terminal_sessions: &terminals,
            },
        )
        .expect_err("terminal stop should fail");

        assert_eq!(error, "terminal lock failed");
        assert!(!file_watch.contains(&root_key));
    }

    #[test]
    fn disposal_stops_runtime_parts_for_missing_roots() {
        let root = PathBuf::from("/missing-workspace");
        let root_key = root_key(&root);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root], &calls);

        dispose_workspace_root(
            &root,
            WorkspaceRuntimeDisposal {
                workspace_file_change_watch_registry: &file_watch,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose missing workspace root");

        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                "file-watch:/missing-workspace",
                "terminal:/missing-workspace",
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn disposal_resolves_missing_symlink_alias_roots_for_string_keyed_runtime_parts() {
        use std::os::unix::fs::symlink;

        let parent = temp_workspace("runtime-alias-parent");
        let root = parent.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");
        let root = root.canonicalize().expect("canonical workspace root");
        let root_key = root_key(&root);
        let alias_parent = temp_path("runtime-alias-link");
        symlink(&parent, &alias_parent).expect("workspace parent symlink");
        let alias_root = alias_parent.join("workspace");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&alias_root], &calls);

        fs::remove_dir_all(&root).expect("remove workspace root");

        dispose_workspace_root(
            &alias_root,
            WorkspaceRuntimeDisposal {
                workspace_file_change_watch_registry: &file_watch,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(!file_watch.contains(&root_key));
        assert!(!terminals.contains(&alias_root));
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                format!("file-watch:{root_key}"),
                format!("terminal:{}", alias_root.to_string_lossy()),
            ]
        );
    }

    struct RecordingRootDisposer {
        label: &'static str,
        roots: Mutex<HashSet<String>>,
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingRootDisposer {
        fn new<'a>(
            label: &'static str,
            roots: impl IntoIterator<Item = &'a String>,
            calls: &Arc<Mutex<Vec<String>>>,
        ) -> Self {
            Self {
                label,
                roots: Mutex::new(roots.into_iter().cloned().collect()),
                calls: Arc::clone(calls),
            }
        }

        fn contains(&self, root_path: &str) -> bool {
            self.roots.lock().expect("roots").contains(root_path)
        }

        fn stop(&self, root_path: &str) {
            self.calls
                .lock()
                .expect("calls")
                .push(format!("{}:{root_path}", self.label));
            self.roots.lock().expect("roots").remove(root_path);
        }
    }

    impl WorkspaceWatchDisposer for RecordingRootDisposer {
        fn stop_workspace_watch(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    struct RecordingTerminalDisposer {
        error: Option<&'static str>,
        label: &'static str,
        roots: Mutex<HashSet<PathBuf>>,
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingTerminalDisposer {
        fn new<'a>(
            label: &'static str,
            roots: impl IntoIterator<Item = &'a PathBuf>,
            calls: &Arc<Mutex<Vec<String>>>,
        ) -> Self {
            Self {
                error: None,
                label,
                roots: Mutex::new(roots.into_iter().cloned().collect()),
                calls: Arc::clone(calls),
            }
        }

        fn failing<'a>(
            label: &'static str,
            roots: impl IntoIterator<Item = &'a PathBuf>,
            calls: &Arc<Mutex<Vec<String>>>,
            error: &'static str,
        ) -> Self {
            Self {
                error: Some(error),
                ..Self::new(label, roots, calls)
            }
        }

        fn contains(&self, root_path: &Path) -> bool {
            self.roots.lock().expect("roots").contains(root_path)
        }
    }

    impl TerminalSessionDisposer for RecordingTerminalDisposer {
        fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String> {
            self.calls.lock().expect("calls").push(format!(
                "{}:{}",
                self.label,
                root_path.to_string_lossy()
            ));
            self.roots.lock().expect("roots").remove(root_path);

            match self.error {
                Some(error) => Err(error.to_string()),
                None => Ok(()),
            }
        }
    }

    fn root_key(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = temp_path(label);
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical temp workspace")
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("editor-runtime-{label}-{}", unique_suffix()))
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }
}
