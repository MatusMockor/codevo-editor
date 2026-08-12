use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::agent_task_supervisor::AgentTaskRegistry;
use crate::debug_adapter::DebugSessionRegistry;
use crate::eslint::EslintProcessRegistry;
use crate::git_worktree::{
    ensure_worktree_path_in_base, prunable_worktree_path_in_base,
    remove_agent_worktree_with_disposal, AgentWorktreeReceipt, CommandGitWorktreeGateway,
    GitWorktreeDescriptor, GitWorktreeGateway, WorktreeRemovalHooks,
};
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::lsp_session::{JavaScriptTypeScriptLanguageServerRegistry, PhpLanguageServerRegistry};
use crate::run_blocking_command;
use crate::terminal_session::TerminalSupervisor;
use crate::trust::WorkspaceTrustService;
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use crate::workspace_runtime::{self, WorkspaceRuntimeDisposal};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

pub(crate) const UNTRUSTED_WORKTREE_REPOSITORY_ERROR: &str =
    "Agent worktrees require a trusted repository.";

fn ensure_worktree_repository_trusted(trusted: bool) -> Result<(), String> {
    if trusted {
        return Ok(());
    }

    Err(UNTRUSTED_WORKTREE_REPOSITORY_ERROR.to_string())
}

fn set_worktree_trust(app: &AppHandle, worktree_path: &str, trusted: bool) -> Result<(), String> {
    let service = app.state::<Mutex<WorkspaceTrustService>>();
    let mut service = service.lock().map_err(|error| error.to_string())?;
    service
        .set(worktree_path, trusted)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn add_agent_worktree_receipt(
    gateway: &dyn GitWorktreeGateway,
    repository_root: &Path,
    task_id: &str,
    set_trust: impl FnOnce(&str) -> Result<(), String>,
) -> Result<AgentWorktreeReceipt, String> {
    let created = gateway.add_agent_worktree(repository_root, task_id)?;
    let worktree_path = created.worktree_path.to_string_lossy().into_owned();
    let trusted = set_trust(&worktree_path).is_ok();

    Ok(AgentWorktreeReceipt {
        worktree_path,
        branch: created.branch,
        trusted,
    })
}

fn remove_agent_worktree_in_repository(
    gateway: &dyn GitWorktreeGateway,
    hooks: &dyn WorktreeRemovalHooks,
    repository_root: &str,
    worktree_path: &str,
    force: bool,
) -> Result<(), String> {
    let root = canonicalize_workspace_root(repository_root)?;
    let target = ensure_worktree_path_in_base(&root, Path::new(worktree_path))?;

    remove_agent_worktree_with_disposal(gateway, hooks, &root, &target, force)
}

fn prune_git_worktrees_with_revoke(
    gateway: &dyn GitWorktreeGateway,
    repository_root: &str,
    mut revoke_trust: impl FnMut(&str),
) -> Result<Vec<String>, String> {
    let root = canonicalize_workspace_root(repository_root)?;
    let pruned = gateway.prune_worktrees(&root)?;

    for path in &pruned {
        if !prunable_worktree_path_in_base(&root, Path::new(path)) {
            continue;
        }
        revoke_trust(path);
    }

    Ok(pruned)
}

struct AppWorktreeRemovalHooks<'a> {
    app: &'a AppHandle,
}

impl WorktreeRemovalHooks for AppWorktreeRemovalHooks<'_> {
    fn stop_agent_tasks(&self, worktree_path: &Path) -> Result<(), String> {
        let Some(registry) = self.app.try_state::<AgentTaskRegistry>() else {
            return Ok(());
        };

        if !registry.stop_for_root_and_reap(worktree_path) {
            return Err(
                "Agent processes in this worktree could not be stopped in time.".to_string(),
            );
        }

        Ok(())
    }

    fn dispose_runtimes(&self, worktree_path: &Path) -> Result<(), String> {
        let index_lifecycle = self.app.state::<WorkspaceIndexLifecycle>();
        let javascript_typescript_language_servers =
            self.app
                .state::<JavaScriptTypeScriptLanguageServerRegistry>();
        let javascript_typescript_watch_registry =
            self.app
                .state::<JavaScriptTypeScriptWorkspaceWatchRegistry>();
        let workspace_file_change_watch_registry =
            self.app.state::<WorkspaceFileChangeWatchRegistry>();
        let php_language_servers = self.app.state::<PhpLanguageServerRegistry>();
        let debug_sessions = self.app.state::<Arc<DebugSessionRegistry>>();
        let eslint_processes = self.app.state::<Arc<EslintProcessRegistry>>();
        let terminal_sessions = self.app.state::<TerminalSupervisor>();

        workspace_runtime::dispose_workspace_root(
            worktree_path,
            WorkspaceRuntimeDisposal {
                index_lifecycle: &*index_lifecycle,
                javascript_typescript_language_servers: &*javascript_typescript_language_servers,
                javascript_typescript_watch_registry: &*javascript_typescript_watch_registry,
                workspace_file_change_watch_registry: &*workspace_file_change_watch_registry,
                php_language_servers: &*php_language_servers,
                debug_sessions: &**debug_sessions,
                eslint_processes: &**eslint_processes,
                terminal_sessions: &*terminal_sessions,
            },
        )
    }

    fn revoke_trust(&self, worktree_path: &Path) -> Result<(), String> {
        set_worktree_trust(self.app, &worktree_path.to_string_lossy(), false)
    }
}

#[tauri::command]
pub(crate) async fn list_git_worktrees(
    repository_root: String,
    trust: GitTrustState<'_>,
) -> Result<Vec<GitWorktreeDescriptor>, String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &repository_root)?)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&repository_root)?;
        CommandGitWorktreeGateway::new().list_worktrees(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn add_git_worktree(
    repository_root: String,
    task_id: String,
    trust: GitTrustState<'_>,
    app: AppHandle,
) -> Result<AgentWorktreeReceipt, String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &repository_root)?)?;
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&repository_root)?;
        add_agent_worktree_receipt(
            &CommandGitWorktreeGateway::new(),
            &root,
            &task_id,
            |worktree_path| set_worktree_trust(&app, worktree_path, true),
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_git_worktree(
    repository_root: String,
    worktree_path: String,
    force: bool,
    trust: GitTrustState<'_>,
    app: AppHandle,
) -> Result<(), String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &repository_root)?)?;
    run_blocking_command(move || {
        remove_agent_worktree_in_repository(
            &CommandGitWorktreeGateway::new(),
            &AppWorktreeRemovalHooks { app: &app },
            &repository_root,
            &worktree_path,
            force,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn prune_git_worktrees(
    repository_root: String,
    trust: GitTrustState<'_>,
    app: AppHandle,
) -> Result<Vec<String>, String> {
    ensure_worktree_repository_trusted(trusted_for(&trust, &repository_root)?)?;
    run_blocking_command(move || {
        prune_git_worktrees_with_revoke(
            &CommandGitWorktreeGateway::new(),
            &repository_root,
            |worktree_path| {
                let _ = set_worktree_trust(&app, worktree_path, false);
            },
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex as StdMutex;

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    struct TempRepository {
        root: PathBuf,
    }

    impl TempRepository {
        fn create(label: &str) -> Self {
            let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!(
                "git-worktree-commands-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create temp repository directory");
            run_git(&root, &["init", "--initial-branch=main"]);
            fs::write(root.join("README.md"), "seed\n").expect("write seed file");
            run_git(&root, &["add", "README.md"]);
            run_git(&root, &["commit", "-m", "initial"]);
            Self {
                root: root.canonicalize().expect("canonical temp repository root"),
            }
        }
    }

    impl Drop for TempRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn run_git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git fixture command {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[derive(Default)]
    struct RecordingHooks {
        calls: StdMutex<Vec<String>>,
    }

    impl RecordingHooks {
        fn recorded(&self) -> Vec<String> {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }

        fn record(&self, call: &str) {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(call.to_string());
        }
    }

    impl WorktreeRemovalHooks for RecordingHooks {
        fn stop_agent_tasks(&self, _worktree_path: &Path) -> Result<(), String> {
            self.record("stop");
            Ok(())
        }

        fn dispose_runtimes(&self, _worktree_path: &Path) -> Result<(), String> {
            self.record("dispose");
            Ok(())
        }

        fn revoke_trust(&self, _worktree_path: &Path) -> Result<(), String> {
            self.record("revoke");
            Ok(())
        }
    }

    #[test]
    fn untrusted_repository_is_rejected_before_any_git_work() {
        let error = tauri::async_runtime::block_on(list_git_worktrees(
            "/nonexistent-root".to_string(),
            false,
        ))
        .expect_err("untrusted repository must be rejected");

        assert_eq!(error, UNTRUSTED_WORKTREE_REPOSITORY_ERROR);
    }

    #[test]
    fn trusted_list_reports_the_primary_worktree() {
        let repository = TempRepository::create("list");
        let listed = tauri::async_runtime::block_on(list_git_worktrees(
            repository.root.to_string_lossy().into_owned(),
            true,
        ))
        .expect("list worktrees");

        assert_eq!(listed.len(), 1);
        assert!(listed[0].is_primary);
    }

    #[test]
    fn add_receipt_reports_trusted_after_successful_trust_grant() {
        let repository = TempRepository::create("add-trusted");
        let granted = StdMutex::new(Vec::<String>::new());

        let receipt = add_agent_worktree_receipt(
            &CommandGitWorktreeGateway::new(),
            &repository.root,
            "agt-alpha-0001",
            |worktree_path| {
                granted
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(worktree_path.to_string());
                Ok(())
            },
        )
        .expect("add agent worktree");

        assert!(receipt.trusted);
        assert_eq!(receipt.branch, "agent/agt-alpha-0001");
        assert!(Path::new(&receipt.worktree_path).is_dir());
        assert_eq!(
            granted
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_slice(),
            std::slice::from_ref(&receipt.worktree_path)
        );
    }

    #[test]
    fn add_receipt_degrades_to_untrusted_when_trust_persist_fails() {
        let repository = TempRepository::create("add-untrusted");

        let receipt = add_agent_worktree_receipt(
            &CommandGitWorktreeGateway::new(),
            &repository.root,
            "agt-beta-0001",
            |_worktree_path| Err("persist failed".to_string()),
        )
        .expect("worktree creation must survive a trust persist failure");

        assert!(!receipt.trusted);
        assert!(Path::new(&receipt.worktree_path).is_dir());
    }

    #[test]
    fn add_rejects_an_invalid_task_id_without_creating_anything() {
        let repository = TempRepository::create("add-invalid-id");

        let error = add_agent_worktree_receipt(
            &CommandGitWorktreeGateway::new(),
            &repository.root,
            "Bad--Id",
            |_worktree_path| Ok(()),
        )
        .expect_err("invalid task id must be rejected");

        assert!(error.contains("task id"), "unexpected error: {error}");
        assert!(!repository.root.join(".worktrees").join("Bad--Id").exists());
    }

    #[test]
    fn remove_rejects_paths_outside_the_worktree_base_before_running_hooks() {
        let repository = TempRepository::create("remove-containment");
        fs::create_dir_all(repository.root.join(".worktrees"))
            .expect("create worktree base directory");
        let hooks = RecordingHooks::default();

        let error = remove_agent_worktree_in_repository(
            &CommandGitWorktreeGateway::new(),
            &hooks,
            &repository.root.to_string_lossy(),
            &repository.root.to_string_lossy(),
            false,
        )
        .expect_err("the repository root must never be removable");

        assert!(error.contains("not an agent worktree"), "got: {error}");
        assert!(hooks.recorded().is_empty());
        assert!(repository.root.join("README.md").exists());
    }

    #[test]
    fn remove_runs_hooks_in_disposal_order_and_removes_the_worktree() {
        let repository = TempRepository::create("remove-order");
        let gateway = CommandGitWorktreeGateway::new();
        let receipt = add_agent_worktree_receipt(
            &gateway,
            &repository.root,
            "agt-gamma-0001",
            |_path| Ok(()),
        )
        .expect("add agent worktree");
        let hooks = RecordingHooks::default();

        remove_agent_worktree_in_repository(
            &gateway,
            &hooks,
            &repository.root.to_string_lossy(),
            &receipt.worktree_path,
            false,
        )
        .expect("remove agent worktree");

        assert_eq!(hooks.recorded(), vec!["stop", "dispose", "revoke"]);
        assert!(!Path::new(&receipt.worktree_path).exists());
    }

    struct ScriptedPruneGateway {
        pruned: Vec<String>,
    }

    impl GitWorktreeGateway for ScriptedPruneGateway {
        fn list_worktrees(
            &self,
            _repository_root: &Path,
        ) -> Result<Vec<GitWorktreeDescriptor>, String> {
            Ok(Vec::new())
        }

        fn add_agent_worktree(
            &self,
            _repository_root: &Path,
            _task_id: &str,
        ) -> Result<crate::git_worktree::CreatedAgentWorktree, String> {
            Err("unused".to_string())
        }

        fn remove_worktree(
            &self,
            _repository_root: &Path,
            _worktree_path: &Path,
            _force: bool,
        ) -> Result<(), String> {
            Err("unused".to_string())
        }

        fn prune_worktrees(&self, _repository_root: &Path) -> Result<Vec<String>, String> {
            Ok(self.pruned.clone())
        }
    }

    #[test]
    fn prune_revokes_trust_only_for_paths_inside_the_worktree_base() {
        let repository = TempRepository::create("prune-filter");
        let inside = repository
            .root
            .join(".worktrees")
            .join("agt-okay-0001")
            .to_string_lossy()
            .into_owned();
        let gateway = ScriptedPruneGateway {
            pruned: vec![
                inside.clone(),
                "/elsewhere/registered-worktree".to_string(),
                repository.root.to_string_lossy().into_owned(),
            ],
        };
        let revoked = StdMutex::new(Vec::<String>::new());

        let pruned = prune_git_worktrees_with_revoke(
            &gateway,
            &repository.root.to_string_lossy(),
            |worktree_path| {
                revoked
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(worktree_path.to_string());
            },
        )
        .expect("prune worktrees");

        assert_eq!(pruned.len(), 3);
        assert_eq!(
            revoked
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_slice(),
            std::slice::from_ref(&inside)
        );
    }

    #[test]
    fn prune_revokes_trust_for_every_pruned_path() {
        let repository = TempRepository::create("prune");
        let gateway = CommandGitWorktreeGateway::new();
        let receipt = add_agent_worktree_receipt(
            &gateway,
            &repository.root,
            "agt-delta-0001",
            |_path| Ok(()),
        )
        .expect("add agent worktree");
        fs::remove_dir_all(&receipt.worktree_path).expect("simulate manual worktree deletion");
        let revoked = StdMutex::new(Vec::<String>::new());

        let pruned = prune_git_worktrees_with_revoke(
            &gateway,
            &repository.root.to_string_lossy(),
            |worktree_path| {
                revoked
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(worktree_path.to_string());
            },
        )
        .expect("prune worktrees");

        assert_eq!(pruned.len(), 1);
        assert_eq!(
            revoked
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_slice(),
            pruned.as_slice()
        );
    }
}
