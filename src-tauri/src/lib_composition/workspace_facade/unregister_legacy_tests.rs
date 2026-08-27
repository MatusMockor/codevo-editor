use super::unregister_workspace_with_runtime_cleanup;
use crate::workspace_registry::WorkspaceRegistry;
use crate::workspace_runtime::{
    DebugSessionDisposer, LanguageServerDisposer, TerminalSessionDisposer,
    WorkspaceIndexLifecycleDisposer, WorkspaceProcessDisposer, WorkspaceRuntimeDisposal,
    WorkspaceWatchDisposer,
};
use std::{
    collections::BTreeSet,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

struct RecordingDisposer {
    calls: Arc<Mutex<Vec<String>>>,
    label: &'static str,
    roots: Mutex<BTreeSet<String>>,
    terminal_error: Option<&'static str>,
}

impl RecordingDisposer {
    fn new(
        label: &'static str,
        roots: impl IntoIterator<Item = String>,
        calls: &Arc<Mutex<Vec<String>>>,
    ) -> Self {
        Self {
            calls: Arc::clone(calls),
            label,
            roots: Mutex::new(roots.into_iter().collect()),
            terminal_error: None,
        }
    }

    fn failing_terminal(
        label: &'static str,
        roots: impl IntoIterator<Item = String>,
        calls: &Arc<Mutex<Vec<String>>>,
        error: &'static str,
    ) -> Self {
        Self {
            terminal_error: Some(error),
            ..Self::new(label, roots, calls)
        }
    }

    fn stop(&self, root_path: &str) {
        self.calls
            .lock()
            .expect("calls")
            .push(format!("{}:{root_path}", self.label));
        self.roots.lock().expect("roots").remove(root_path);
    }

    fn contains(&self, root_path: &str) -> bool {
        self.roots.lock().expect("roots").contains(root_path)
    }
}

impl WorkspaceWatchDisposer for RecordingDisposer {
    fn stop_workspace_watch(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl LanguageServerDisposer for RecordingDisposer {
    fn stop_language_server(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl WorkspaceIndexLifecycleDisposer for RecordingDisposer {
    fn cancel_workspace_index_lifecycle(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl DebugSessionDisposer for RecordingDisposer {
    fn stop_debug_session(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl WorkspaceProcessDisposer for RecordingDisposer {
    fn stop_workspace_processes(&self, root_path: &Path) {
        self.stop(&root_path.to_string_lossy());
    }
}

impl TerminalSessionDisposer for RecordingDisposer {
    fn stop_terminal_sessions(&self, root_path: &Path) -> Result<(), String> {
        self.stop(&root_path.to_string_lossy());
        match self.terminal_error {
            Some(error) => Err(error.to_string()),
            None => Ok(()),
        }
    }
}

#[test]
fn unregister_stops_exact_language_services_before_descriptor_removal_and_reports_errors() {
    let registry = WorkspaceRegistry::new();
    let root_a = temporary_workspace("unregister-a");
    let root_b = temporary_workspace("unregister-b");
    let descriptor_a = registry.register(&root_a).expect("register A");
    let descriptor_b = registry.register(&root_b).expect("register B");
    let root_a_key = descriptor_a
        .canonical_root_path
        .to_string_lossy()
        .into_owned();
    let root_b_key = descriptor_b
        .canonical_root_path
        .to_string_lossy()
        .into_owned();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let index = RecordingDisposer::new("index", [root_a_key.clone(), root_b_key.clone()], &calls);
    let watcher = RecordingDisposer::new("watch", [root_a_key.clone(), root_b_key.clone()], &calls);
    let file_watcher = RecordingDisposer::new(
        "file-watch",
        [root_a_key.clone(), root_b_key.clone()],
        &calls,
    );
    let javascript_typescript =
        RecordingDisposer::new("js-lsp", [root_a_key.clone(), root_b_key.clone()], &calls);
    let php = RecordingDisposer::new("php-lsp", [root_a_key.clone(), root_b_key.clone()], &calls);
    let debug = RecordingDisposer::new("debug", [root_a_key.clone(), root_b_key.clone()], &calls);
    let eslint = RecordingDisposer::new("eslint", [root_a_key.clone(), root_b_key.clone()], &calls);
    let terminal = RecordingDisposer::failing_terminal(
        "terminal",
        [root_a_key.clone(), root_b_key.clone()],
        &calls,
        "terminal stop failed",
    );

    let errors = unregister_workspace_with_runtime_cleanup(
        &registry,
        &descriptor_a.workspace_id,
        WorkspaceRuntimeDisposal {
            index_lifecycle: &index,
            javascript_typescript_language_servers: &javascript_typescript,
            javascript_typescript_watch_registry: &watcher,
            workspace_file_change_watch_registry: &file_watcher,
            php_language_servers: &php,
            debug_sessions: &debug,
            eslint_processes: &eslint,
            terminal_sessions: &terminal,
        },
        |descriptor| {
            calls.lock().expect("calls").push(format!(
                "before:{}",
                descriptor.canonical_root_path.to_string_lossy()
            ));
        },
        |descriptor, errors| {
            calls.lock().expect("calls").push(format!(
                "after:{}",
                descriptor.canonical_root_path.to_string_lossy()
            ));
            errors.push("document cleanup failed".to_string());
        },
    )
    .expect("unregister after best-effort cleanup");

    assert_eq!(
        errors,
        vec![
            "Workspace runtime cleanup failed: terminal stop failed",
            "document cleanup failed",
        ]
    );
    assert!(registry.descriptor(&descriptor_a.workspace_id).is_err());
    assert!(registry.descriptor(&descriptor_b.workspace_id).is_ok());
    assert!(!index.contains(&root_a_key));
    assert!(index.contains(&root_b_key));
    assert!(!watcher.contains(&root_a_key));
    assert!(watcher.contains(&root_b_key));
    assert!(!file_watcher.contains(&root_a_key));
    assert!(file_watcher.contains(&root_b_key));
    assert!(!javascript_typescript.contains(&root_a_key));
    assert!(javascript_typescript.contains(&root_b_key));
    assert!(!php.contains(&root_a_key));
    assert!(php.contains(&root_b_key));
    assert!(!debug.contains(&root_a_key));
    assert!(debug.contains(&root_b_key));
    assert!(!eslint.contains(&root_a_key));
    assert!(eslint.contains(&root_b_key));
    assert!(!terminal.contains(&root_a_key));
    assert!(terminal.contains(&root_b_key));
    let retry_errors = unregister_workspace_with_runtime_cleanup(
        &registry,
        &descriptor_a.workspace_id,
        WorkspaceRuntimeDisposal {
            index_lifecycle: &index,
            javascript_typescript_language_servers: &javascript_typescript,
            javascript_typescript_watch_registry: &watcher,
            workspace_file_change_watch_registry: &file_watcher,
            php_language_servers: &php,
            debug_sessions: &debug,
            eslint_processes: &eslint,
            terminal_sessions: &terminal,
        },
        |_| panic!("an idempotent unregister retry must not repeat cleanup"),
        |_, _| panic!("an idempotent unregister retry must not repeat cleanup"),
    )
    .expect("already-unregistered workspace retry");
    assert!(retry_errors.is_empty());
    assert_eq!(
        calls.lock().expect("calls").as_slice(),
        &[
            format!("before:{root_a_key}"),
            format!("index:{root_a_key}"),
            format!("watch:{root_a_key}"),
            format!("file-watch:{root_a_key}"),
            format!("js-lsp:{root_a_key}"),
            format!("php-lsp:{root_a_key}"),
            format!("debug:{root_a_key}"),
            format!("eslint:{root_a_key}"),
            format!("terminal:{root_a_key}"),
            format!("after:{root_a_key}"),
        ]
    );

    fs::remove_dir_all(root_a).expect("cleanup A");
    fs::remove_dir_all(root_b).expect("cleanup B");
}

fn temporary_workspace(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codevo-{label}-{nonce}"));
    fs::create_dir_all(&root).expect("create workspace");
    root
}
