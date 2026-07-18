use crate::debug_adapter::DebugSessionRegistry;
use crate::eslint::EslintProcessRegistry;
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::lsp_session::{JavaScriptTypeScriptLanguageServerRegistry, PhpLanguageServerRegistry};
use crate::terminal_session::TerminalSupervisor;
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use std::{
    ffi::OsString,
    path::{Component, Path, PathBuf},
};

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

pub trait WorkspaceProcessDisposer {
    fn stop_workspace_processes(&self, root_path: &Path);
}

pub trait DebugSessionDisposer {
    fn stop_debug_session(&self, root_path: &str);
}

pub struct WorkspaceRuntimeDisposal<'a> {
    pub index_lifecycle: &'a dyn WorkspaceIndexLifecycleDisposer,
    pub javascript_typescript_language_servers: &'a dyn LanguageServerDisposer,
    pub javascript_typescript_watch_registry: &'a dyn WorkspaceWatchDisposer,
    pub workspace_file_change_watch_registry: &'a dyn WorkspaceWatchDisposer,
    pub php_language_servers: &'a dyn LanguageServerDisposer,
    pub debug_sessions: &'a dyn DebugSessionDisposer,
    pub eslint_processes: &'a dyn WorkspaceProcessDisposer,
    pub terminal_sessions: &'a dyn TerminalSessionDisposer,
}

pub fn dispose_workspace_root(
    root_path: &Path,
    runtime: WorkspaceRuntimeDisposal<'_>,
) -> Result<(), String> {
    let root_key = workspace_root_disposal_key(root_path);

    runtime
        .index_lifecycle
        .cancel_workspace_index_lifecycle(&root_key);
    runtime
        .javascript_typescript_watch_registry
        .stop_workspace_watch(&root_key);
    runtime
        .workspace_file_change_watch_registry
        .stop_workspace_watch(&root_key);
    runtime
        .javascript_typescript_language_servers
        .stop_language_server(&root_key);
    runtime.php_language_servers.stop_language_server(&root_key);
    runtime.debug_sessions.stop_debug_session(&root_key);
    runtime.eslint_processes.stop_workspace_processes(root_path);
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

impl WorkspaceWatchDisposer for WorkspaceFileChangeWatchRegistry {
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

impl DebugSessionDisposer for DebugSessionRegistry {
    fn stop_debug_session(&self, root_path: &str) {
        self.stop(root_path);
    }
}

impl WorkspaceProcessDisposer for EslintProcessRegistry {
    fn stop_workspace_processes(&self, root_path: &Path) {
        self.stop_root(root_path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dispose_workspace_root, DebugSessionDisposer, LanguageServerDisposer,
        TerminalSessionDisposer, WorkspaceIndexLifecycleDisposer, WorkspaceProcessDisposer,
        WorkspaceRuntimeDisposal, WorkspaceWatchDisposer,
    };
    use crate::debug_adapter::{
        DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventSink, DebugScopeInfo,
        DebugSessionRegistry, DebugStackFrame, DebugVariableInfo, StepKind,
    };
    use std::{
        collections::HashSet,
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicBool, Ordering},
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
        let index = RecordingRootDisposer::new("index", [&root_a_key, &root_b_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_a_key, &root_b_key], &calls);
        let file_watch =
            RecordingRootDisposer::new("file-watch", [&root_a_key, &root_b_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_a_key, &root_b_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_a_key, &root_b_key], &calls);
        let debug = RecordingRootDisposer::new("debug", [&root_a_key, &root_b_key], &calls);
        let eslint = RecordingTerminalDisposer::new("eslint", [&root_a, &root_b], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root_a, &root_b], &calls);

        dispose_workspace_root(
            &root_a,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                workspace_file_change_watch_registry: &file_watch,
                php_language_servers: &php_lsp,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(!index.contains(&root_a_key));
        assert!(index.contains(&root_b_key));
        assert!(!watch.contains(&root_a_key));
        assert!(watch.contains(&root_b_key));
        assert!(!file_watch.contains(&root_a_key));
        assert!(file_watch.contains(&root_b_key));
        assert!(!js_lsp.contains(&root_a_key));
        assert!(js_lsp.contains(&root_b_key));
        assert!(!php_lsp.contains(&root_a_key));
        assert!(php_lsp.contains(&root_b_key));
        assert!(!debug.contains(&root_a_key));
        assert!(debug.contains(&root_b_key));
        assert!(!eslint.contains(&root_a));
        assert!(eslint.contains(&root_b));
        assert!(!terminals.contains(&root_a));
        assert!(terminals.contains(&root_b));
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                "index:/workspace-a",
                "watch:/workspace-a",
                "file-watch:/workspace-a",
                "js-lsp:/workspace-a",
                "php-lsp:/workspace-a",
                "debug:/workspace-a",
                "eslint:/workspace-a",
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
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_key], &calls);
        let debug = RecordingRootDisposer::new("debug", [&root_key], &calls);
        let eslint = RecordingTerminalDisposer::new("eslint", [&root], &calls);
        let terminals =
            RecordingTerminalDisposer::failing("terminal", [&root], &calls, "terminal lock failed");

        let error = dispose_workspace_root(
            &root,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                workspace_file_change_watch_registry: &file_watch,
                php_language_servers: &php_lsp,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminals,
            },
        )
        .expect_err("terminal stop should fail");

        assert_eq!(error, "terminal lock failed");
        assert!(!index.contains(&root_key));
        assert!(!watch.contains(&root_key));
        assert!(!file_watch.contains(&root_key));
        assert!(!js_lsp.contains(&root_key));
        assert!(!php_lsp.contains(&root_key));
        assert!(!debug.contains(&root_key));
    }

    #[test]
    fn disposal_stops_runtime_parts_for_missing_roots() {
        let root = PathBuf::from("/missing-workspace");
        let root_key = root_key(&root);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let index = RecordingRootDisposer::new("index", [&root_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_key], &calls);
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_key], &calls);
        let debug = RecordingRootDisposer::new("debug", [&root_key], &calls);
        let eslint = RecordingTerminalDisposer::new("eslint", [&root], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root], &calls);

        dispose_workspace_root(
            &root,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                workspace_file_change_watch_registry: &file_watch,
                php_language_servers: &php_lsp,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose missing workspace root");

        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                "index:/missing-workspace",
                "watch:/missing-workspace",
                "file-watch:/missing-workspace",
                "js-lsp:/missing-workspace",
                "php-lsp:/missing-workspace",
                "debug:/missing-workspace",
                "eslint:/missing-workspace",
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
        let index = RecordingRootDisposer::new("index", [&root_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_key], &calls);
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_key], &calls);
        let debug = RecordingRootDisposer::new("debug", [&root_key], &calls);
        let eslint = RecordingTerminalDisposer::new("eslint", [&alias_root], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&alias_root], &calls);

        fs::remove_dir_all(&root).expect("remove workspace root");

        dispose_workspace_root(
            &alias_root,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                workspace_file_change_watch_registry: &file_watch,
                php_language_servers: &php_lsp,
                debug_sessions: &debug,
                eslint_processes: &eslint,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(!index.contains(&root_key));
        assert!(!watch.contains(&root_key));
        assert!(!file_watch.contains(&root_key));
        assert!(!js_lsp.contains(&root_key));
        assert!(!php_lsp.contains(&root_key));
        assert!(!debug.contains(&root_key));
        assert!(!eslint.contains(&alias_root));
        assert!(!terminals.contains(&alias_root));
        assert_eq!(
            calls.lock().expect("calls").as_slice(),
            &[
                format!("index:{root_key}"),
                format!("watch:{root_key}"),
                format!("file-watch:{root_key}"),
                format!("js-lsp:{root_key}"),
                format!("php-lsp:{root_key}"),
                format!("debug:{root_key}"),
                format!("eslint:{}", alias_root.to_string_lossy()),
                format!("terminal:{}", alias_root.to_string_lossy()),
            ]
        );
    }

    #[test]
    fn disposal_terminates_debug_session_for_requested_root_only() {
        let root_a = PathBuf::from("/workspace-a");
        let root_b = PathBuf::from("/workspace-b");
        let root_a_key = root_key(&root_a);
        let root_b_key = root_key(&root_b);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let registry = DebugSessionRegistry::new();
        let terminated_a = start_inert_debug_session(&registry, &root_a_key);
        let terminated_b = start_inert_debug_session(&registry, &root_b_key);
        let index = RecordingRootDisposer::new("index", [&root_a_key], &calls);
        let watch = RecordingRootDisposer::new("watch", [&root_a_key], &calls);
        let file_watch = RecordingRootDisposer::new("file-watch", [&root_a_key], &calls);
        let js_lsp = RecordingRootDisposer::new("js-lsp", [&root_a_key], &calls);
        let php_lsp = RecordingRootDisposer::new("php-lsp", [&root_a_key], &calls);
        let eslint = RecordingTerminalDisposer::new("eslint", [&root_a], &calls);
        let terminals = RecordingTerminalDisposer::new("terminal", [&root_a], &calls);

        dispose_workspace_root(
            &root_a,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &index,
                javascript_typescript_language_servers: &js_lsp,
                javascript_typescript_watch_registry: &watch,
                workspace_file_change_watch_registry: &file_watch,
                php_language_servers: &php_lsp,
                debug_sessions: &registry,
                eslint_processes: &eslint,
                terminal_sessions: &terminals,
            },
        )
        .expect("dispose workspace root");

        assert!(terminated_a.load(Ordering::SeqCst));
        assert!(!terminated_b.load(Ordering::SeqCst));
        assert_eq!(registry.session_id_for_root(&root_a_key), None);
        assert!(registry.session_id_for_root(&root_b_key).is_some());
    }

    fn start_inert_debug_session(
        registry: &DebugSessionRegistry,
        root_key: &str,
    ) -> Arc<AtomicBool> {
        let terminated = Arc::new(AtomicBool::new(false));
        let adapter_terminated = Arc::clone(&terminated);
        registry
            .start_session(root_key, Arc::new(NullDebugEventSink), move |_emitter| {
                Ok(Box::new(InertDebugAdapter {
                    terminated: adapter_terminated,
                }))
            })
            .expect("start debug session");
        terminated
    }

    struct NullDebugEventSink;

    impl DebugEventSink for NullDebugEventSink {
        fn emit(&self, _event: DebugEvent) {}
    }

    struct InertDebugAdapter {
        terminated: Arc<AtomicBool>,
    }

    impl DebugAdapter for InertDebugAdapter {
        fn set_breakpoints(
            &mut self,
            _file_path: &str,
            _breakpoints: &[DebugBreakpoint],
        ) -> Result<Vec<DebugBreakpoint>, String> {
            Ok(Vec::new())
        }

        fn step(&mut self, _kind: StepKind) -> Result<(), String> {
            Ok(())
        }

        fn pause(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
            Ok(Vec::new())
        }

        fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
            Ok(Vec::new())
        }

        fn variables(&mut self, _reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
            Ok(Vec::new())
        }

        fn evaluate(
            &mut self,
            _frame_id: u64,
            _expression: &str,
        ) -> Result<DebugVariableInfo, String> {
            Err("Evaluation is not supported by the inert adapter.".to_string())
        }

        fn terminate(&mut self) {
            self.terminated.store(true, Ordering::SeqCst);
        }
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

    impl DebugSessionDisposer for RecordingRootDisposer {
        fn stop_debug_session(&self, root_path: &str) {
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

    impl WorkspaceProcessDisposer for RecordingTerminalDisposer {
        fn stop_workspace_processes(&self, root_path: &Path) {
            self.calls.lock().expect("calls").push(format!(
                "{}:{}",
                self.label,
                root_path.to_string_lossy()
            ));
            self.roots.lock().expect("roots").remove(root_path);
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
