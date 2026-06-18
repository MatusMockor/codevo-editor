use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::lsp_session::{JavaScriptTypeScriptLanguageServerRegistry, PhpLanguageServerRegistry};
use crate::terminal_session::TerminalSupervisor;
use std::path::Path;

pub trait WorkspaceIndexLifecycleDisposer {
    fn cancel_workspace_index_lifecycle(&self, root_path: &str);
}

pub trait WorkspaceWatchDisposer {
    fn stop_workspace_watch(&self, root_path: &str);
}

pub trait LanguageServerDisposer {
    fn stop_language_server(&self, root_path: &str);
}

pub trait TerminalSessionDisposer {
    fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String>;
}

pub struct WorkspaceRuntimeDisposal<'a> {
    pub index_lifecycle: &'a dyn WorkspaceIndexLifecycleDisposer,
    pub javascript_typescript_language_servers: &'a dyn LanguageServerDisposer,
    pub javascript_typescript_watch_registry: &'a dyn WorkspaceWatchDisposer,
    pub php_language_servers: &'a dyn LanguageServerDisposer,
    pub terminal_sessions: &'a dyn TerminalSessionDisposer,
}

pub fn dispose_workspace_root(
    root_path: &Path,
    runtime: WorkspaceRuntimeDisposal<'_>,
) -> Result<(), String> {
    let root_key = root_path.to_string_lossy().to_string();

    runtime
        .index_lifecycle
        .cancel_workspace_index_lifecycle(&root_key);
    runtime
        .javascript_typescript_watch_registry
        .stop_workspace_watch(&root_key);
    runtime
        .javascript_typescript_language_servers
        .stop_language_server(&root_key);
    runtime.php_language_servers.stop_language_server(&root_key);
    runtime.terminal_sessions.stop_terminal_sessions(root_path)
}

impl WorkspaceIndexLifecycleDisposer for WorkspaceIndexLifecycle {
    fn cancel_workspace_index_lifecycle(&self, root_path: &str) {
        self.cancel_workspace(root_path);
    }
}

impl WorkspaceWatchDisposer for JavaScriptTypeScriptWorkspaceWatchRegistry {
    fn stop_workspace_watch(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl LanguageServerDisposer for JavaScriptTypeScriptLanguageServerRegistry {
    fn stop_language_server(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl LanguageServerDisposer for PhpLanguageServerRegistry {
    fn stop_language_server(&self, root_path: &str) {
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
        dispose_workspace_root, LanguageServerDisposer, TerminalSessionDisposer,
        WorkspaceIndexLifecycleDisposer, WorkspaceRuntimeDisposal, WorkspaceWatchDisposer,
    };
    use std::{
        collections::HashSet,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };

    #[test]
    fn disposal_stops_requested_root_without_touching_other_roots() {
        let root_a = PathBuf::from("/workspace-a");
        let root_b = PathBuf::from("/workspace-b");
        let root_a_key = root_key(&root_a);
        let root_b_key = root_key(&root_b);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let index = RecordingRootDisposer::new("index", [&root_a_key, &root_b_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_a_key, &root_b_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_a_key, &root_b_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_a_key, &root_b_key], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root_a, &root_b], &calls);

        dispose_workspace_root(
            &root_a,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                php_language_servers: &php_lsp,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(!index.contains(&root_a_key));
        assert!(index.contains(&root_b_key));
        assert!(!watch.contains(&root_a_key));
        assert!(watch.contains(&root_b_key));
        assert!(!js_lsp.contains(&root_a_key));
        assert!(js_lsp.contains(&root_b_key));
        assert!(!php_lsp.contains(&root_a_key));
        assert!(php_lsp.contains(&root_b_key));
        assert!(!terminals.contains(&root_a));
        assert!(terminals.contains(&root_b));
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                "index:/workspace-a",
                "watch:/workspace-a",
                "js-lsp:/workspace-a",
                "php-lsp:/workspace-a",
                "terminal:/workspace-a",
            ]
        );
    }

    #[test]
    fn disposal_returns_terminal_stop_errors_after_cancelling_other_runtime_parts() {
        let root = PathBuf::from("/workspace");
        let root_key = root_key(&root);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let index = RecordingRootDisposer::new("index", [&root_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_key], &calls);
        let terminals =
            RecordingTerminalDisposer::failing("terminal", [&root], &calls, "terminal lock failed");

        let error = dispose_workspace_root(
            &root,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                php_language_servers: &php_lsp,
                terminal_sessions: &terminals,
            },
        )
        .expect_err("terminal stop should fail");

        assert_eq!(error, "terminal lock failed");
        assert!(!index.contains(&root_key));
        assert!(!watch.contains(&root_key));
        assert!(!js_lsp.contains(&root_key));
        assert!(!php_lsp.contains(&root_key));
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

    impl WorkspaceIndexLifecycleDisposer for RecordingRootDisposer {
        fn cancel_workspace_index_lifecycle(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl WorkspaceWatchDisposer for RecordingRootDisposer {
        fn stop_workspace_watch(&self, root_path: &str) {
            self.stop(root_path);
        }
    }

    impl LanguageServerDisposer for RecordingRootDisposer {
        fn stop_language_server(&self, root_path: &str) {
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
}
