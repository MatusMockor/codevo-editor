use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::run_blocking_command;
use git_integration::{
    integrate_branch, push_branch_upstream, resolve_ship_targets, safe_branch_name,
    safe_merge_message, safe_object_id, ship_status, GitIntegrationMode, GitIntegrationOutcome,
    GitPushReceipt, GitShipStatus, IntegrationRequest, ShipTargets, IN_PLACE_INTEGRATION_ERROR,
};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use tauri::State;

#[path = "../git_integration.rs"]
pub(crate) mod git_integration;

pub(crate) const UNTRUSTED_INTEGRATION_REPOSITORY_ERROR: &str =
    "Shipping agent changes requires a trusted repository.";
pub(crate) const INTEGRATION_IN_PROGRESS_ERROR: &str =
    "Another integration is already running for this repository.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShipStatusRequest {
    repository_root: String,
    worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PushBranchUpstreamRequest {
    repository_root: String,
    worktree_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IntegrateWorktreeBranchRequest {
    repository_root: String,
    worktree_path: String,
    mode: GitIntegrationMode,
    expected_primary_branch: String,
    expected_primary_head: String,
    expected_branch_head: String,
    merge_message: String,
}

#[derive(Default)]
pub(crate) struct IntegrationLocks {
    roots: Mutex<HashSet<PathBuf>>,
}

pub(crate) struct IntegrationPermit {
    locks: Arc<IntegrationLocks>,
    root: PathBuf,
}

impl IntegrationLocks {
    pub(crate) fn acquire(self: &Arc<Self>, root: &Path) -> Result<IntegrationPermit, String> {
        let mut roots = self.roots.lock().unwrap_or_else(PoisonError::into_inner);
        if !roots.insert(root.to_path_buf()) {
            return Err(INTEGRATION_IN_PROGRESS_ERROR.to_string());
        }

        Ok(IntegrationPermit {
            locks: Arc::clone(self),
            root: root.to_path_buf(),
        })
    }
}

impl Drop for IntegrationPermit {
    fn drop(&mut self) {
        let mut roots = self
            .locks
            .roots
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        roots.remove(&self.root);
    }
}

fn ensure_integration_repository_trusted(trusted: bool) -> Result<(), String> {
    if trusted {
        return Ok(());
    }

    Err(UNTRUSTED_INTEGRATION_REPOSITORY_ERROR.to_string())
}

fn ship_targets_for(
    repository_root: &str,
    worktree_path: Option<&str>,
) -> Result<ShipTargets, String> {
    let root = canonicalize_workspace_root(repository_root)?;
    let worktree = worktree_path.map(Path::new);

    resolve_ship_targets(&root, worktree)
}

fn integration_request(
    request: &IntegrateWorktreeBranchRequest,
) -> Result<IntegrationRequest, String> {
    Ok(IntegrationRequest {
        mode: request.mode,
        expected_primary_branch: safe_branch_name(&request.expected_primary_branch)?,
        expected_primary_head: safe_object_id(&request.expected_primary_head)?,
        expected_branch_head: safe_object_id(&request.expected_branch_head)?,
        merge_message: safe_merge_message(&request.merge_message)?,
    })
}

#[tauri::command]
pub(crate) async fn get_git_ship_status(
    request: ShipStatusRequest,
    trust: GitTrustState<'_>,
) -> Result<GitShipStatus, String> {
    ensure_integration_repository_trusted(trusted_for(&trust, &request.repository_root)?)?;
    if let Some(worktree_path) = request.worktree_path.as_deref() {
        ensure_integration_repository_trusted(trusted_for(&trust, worktree_path)?)?;
    }
    run_blocking_command(move || {
        let targets = ship_targets_for(&request.repository_root, request.worktree_path.as_deref())?;
        ship_status(&targets)
    })
    .await
}

#[tauri::command]
pub(crate) async fn push_git_branch_upstream(
    request: PushBranchUpstreamRequest,
    trust: GitTrustState<'_>,
) -> Result<GitPushReceipt, String> {
    ensure_integration_repository_trusted(trusted_for(&trust, &request.repository_root)?)?;
    if let Some(worktree_path) = request.worktree_path.as_deref() {
        ensure_integration_repository_trusted(trusted_for(&trust, worktree_path)?)?;
    }
    run_blocking_command(move || {
        let targets = ship_targets_for(&request.repository_root, request.worktree_path.as_deref())?;
        push_branch_upstream(&targets).map_err(git_integration::PushFailure::into_error_string)
    })
    .await
}

#[tauri::command]
pub(crate) async fn integrate_git_worktree_branch(
    request: IntegrateWorktreeBranchRequest,
    trust: GitTrustState<'_>,
    locks: State<'_, Arc<IntegrationLocks>>,
) -> Result<GitIntegrationOutcome, String> {
    let locks = Arc::clone(&locks);
    integrate_git_worktree_branch_with_locks(request, &trust, locks).await
}

pub(crate) async fn integrate_git_worktree_branch_with_locks(
    request: IntegrateWorktreeBranchRequest,
    trust: &GitTrustState<'_>,
    locks: Arc<IntegrationLocks>,
) -> Result<GitIntegrationOutcome, String> {
    ensure_integration_repository_trusted(trusted_for(trust, &request.repository_root)?)?;
    ensure_integration_repository_trusted(trusted_for(trust, &request.worktree_path)?)?;
    run_blocking_command(move || {
        let targets = ship_targets_for(
            &request.repository_root,
            Some(request.worktree_path.as_str()),
        )?;
        if targets.in_place {
            return Err(IN_PLACE_INTEGRATION_ERROR.to_string());
        }
        let integration = integration_request(&request)?;
        let _permit = locks.acquire(&targets.repository_root)?;

        integrate_branch(&targets, &integration)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use git_integration::{
        EXPECTED_OBJECT_ID_ERROR, MERGE_MESSAGE_OUT_OF_BOUNDS_ERROR, UNSAFE_BRANCH_NAME_ERROR,
    };
    use std::fs;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    struct TempRepository {
        root: PathBuf,
    }

    impl TempRepository {
        fn create(label: &str) -> Self {
            let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!(
                "git-integration-commands-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create temp repository directory");
            run_git(&root, &["init", "--initial-branch=main"]);
            run_git(&root, &["config", "user.name", "Test"]);
            run_git(&root, &["config", "user.email", "test@example.com"]);
            run_git(&root, &["config", "commit.gpgsign", "false"]);
            fs::write(root.join("README.md"), "seed\n").expect("write seed file");
            run_git(&root, &["add", "README.md"]);
            run_git(&root, &["commit", "-m", "initial"]);
            Self {
                root: root.canonicalize().expect("canonical temp repository root"),
            }
        }

        fn add_agent_worktree(&self, task_id: &str) -> PathBuf {
            let target = self.root.join(".worktrees").join(task_id);
            fs::create_dir_all(self.root.join(".worktrees")).expect("create worktree base");
            let branch = format!("agent/{task_id}");
            run_git(
                &self.root,
                &[
                    "worktree",
                    "add",
                    "-b",
                    branch.as_str(),
                    target.to_str().expect("utf8 path"),
                ],
            );
            target.canonicalize().expect("canonical worktree path")
        }

        fn root_string(&self) -> String {
            self.root.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn run_git(root: &Path, arguments: &[&str]) -> String {
        let output = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
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
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit_file(root: &Path, name: &str, content: &str, message: &str) {
        fs::write(root.join(name), content).expect("write file");
        run_git(root, &["add", name]);
        run_git(root, &["commit", "-m", message]);
    }

    fn integrate_request(
        repository: &TempRepository,
        worktree: &Path,
        mode: GitIntegrationMode,
    ) -> IntegrateWorktreeBranchRequest {
        IntegrateWorktreeBranchRequest {
            repository_root: repository.root_string(),
            worktree_path: worktree.to_string_lossy().into_owned(),
            mode,
            expected_primary_branch: "main".to_string(),
            expected_primary_head: run_git(&repository.root, &["rev-parse", "HEAD"]),
            expected_branch_head: run_git(worktree, &["rev-parse", "HEAD"]),
            merge_message: "Merge agent/alpha".to_string(),
        }
    }

    #[test]
    fn requests_reject_unknown_fields() {
        let ship = serde_json::from_str::<ShipStatusRequest>(
            r#"{"repositoryRoot":"/r","worktreePath":null,"extra":1}"#,
        );
        assert!(ship.is_err());

        let push = serde_json::from_str::<PushBranchUpstreamRequest>(
            r#"{"repositoryRoot":"/r","worktreePath":"/r/.worktrees/a","shell":"rm"}"#,
        );
        assert!(push.is_err());

        let integrate = serde_json::from_str::<IntegrateWorktreeBranchRequest>(
            r#"{"repositoryRoot":"/r","worktreePath":"/w","mode":"fastForward","expectedPrimaryBranch":"main","expectedPrimaryHead":"a","expectedBranchHead":"b","mergeMessage":"m","force":true}"#,
        );
        assert!(integrate.is_err());

        let unknown_mode = serde_json::from_str::<IntegrateWorktreeBranchRequest>(
            r#"{"repositoryRoot":"/r","worktreePath":"/w","mode":"rebase","expectedPrimaryBranch":"main","expectedPrimaryHead":"a","expectedBranchHead":"b","mergeMessage":"m"}"#,
        );
        assert!(unknown_mode.is_err());

        let parsed = serde_json::from_str::<IntegrateWorktreeBranchRequest>(
            r#"{"repositoryRoot":"/r","worktreePath":"/w","mode":"merge","expectedPrimaryBranch":"main","expectedPrimaryHead":"a","expectedBranchHead":"b","mergeMessage":"m"}"#,
        )
        .expect("well-formed request");
        assert_eq!(parsed.mode, GitIntegrationMode::Merge);
    }

    #[test]
    fn untrusted_roots_are_refused_before_any_git_work() {
        let status = tauri::async_runtime::block_on(get_git_ship_status(
            ShipStatusRequest {
                repository_root: "/nonexistent-root".to_string(),
                worktree_path: None,
            },
            false,
        ))
        .expect_err("untrusted status");
        assert_eq!(status, UNTRUSTED_INTEGRATION_REPOSITORY_ERROR);

        let push = tauri::async_runtime::block_on(push_git_branch_upstream(
            PushBranchUpstreamRequest {
                repository_root: "/nonexistent-root".to_string(),
                worktree_path: None,
            },
            false,
        ))
        .expect_err("untrusted push");
        assert_eq!(push, UNTRUSTED_INTEGRATION_REPOSITORY_ERROR);

        let integrate = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            IntegrateWorktreeBranchRequest {
                repository_root: "/nonexistent-root".to_string(),
                worktree_path: "/nonexistent-root/.worktrees/a".to_string(),
                mode: GitIntegrationMode::FastForward,
                expected_primary_branch: "main".to_string(),
                expected_primary_head: "a".repeat(40),
                expected_branch_head: "b".repeat(40),
                merge_message: "m".to_string(),
            },
            &false,
            Arc::new(IntegrationLocks::default()),
        ))
        .expect_err("untrusted integrate");
        assert_eq!(integrate, UNTRUSTED_INTEGRATION_REPOSITORY_ERROR);
    }

    #[test]
    fn option_like_and_malformed_integration_values_are_rejected_before_git() {
        let repository = TempRepository::create("validate");
        let worktree = repository.add_agent_worktree("alpha");
        let locks = Arc::new(IntegrationLocks::default());

        let mut request = integrate_request(&repository, &worktree, GitIntegrationMode::Merge);
        request.expected_primary_branch = "--upload-pack=x".to_string();
        let error = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            request,
            &true,
            Arc::clone(&locks),
        ))
        .expect_err("option-like branch");
        assert_eq!(error, UNSAFE_BRANCH_NAME_ERROR);

        let mut request = integrate_request(&repository, &worktree, GitIntegrationMode::Merge);
        request.expected_branch_head = "HEAD".to_string();
        let error = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            request,
            &true,
            Arc::clone(&locks),
        ))
        .expect_err("malformed sha");
        assert_eq!(error, EXPECTED_OBJECT_ID_ERROR);

        let mut request = integrate_request(&repository, &worktree, GitIntegrationMode::Merge);
        request.merge_message = "\u{0}".to_string();
        let error = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            request,
            &true,
            Arc::clone(&locks),
        ))
        .expect_err("malformed message");
        assert_eq!(error, MERGE_MESSAGE_OUT_OF_BOUNDS_ERROR);

        let mut request = integrate_request(&repository, &worktree, GitIntegrationMode::Merge);
        request.worktree_path = repository.root_string();
        let error = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            request,
            &true,
            Arc::clone(&locks),
        ))
        .expect_err("root is not a worktree");
        assert_eq!(error, "The repository root is not an agent worktree.");
    }

    #[test]
    fn integration_permit_is_exclusive_and_released_on_drop_error_and_panic() {
        let locks = Arc::new(IntegrationLocks::default());
        let root = PathBuf::from("/repository");

        let permit = locks.acquire(&root).expect("first permit");
        let Err(second) = locks.acquire(&root) else {
            panic!("second permit must be refused");
        };
        assert_eq!(second, INTEGRATION_IN_PROGRESS_ERROR);
        assert!(locks.acquire(Path::new("/other")).is_ok());
        drop(permit);
        assert!(locks.acquire(&root).is_ok());

        let failing: Result<(), String> = (|| {
            let _permit = locks.acquire(&root)?;
            Err("git failed".to_string())
        })();
        assert!(failing.is_err());
        assert!(locks.acquire(&root).is_ok());

        let panic_locks = Arc::clone(&locks);
        let panic_root = root.clone();
        let unwound = std::panic::catch_unwind(move || {
            let _permit = panic_locks
                .acquire(&panic_root)
                .expect("permit before panic");
            panic!("integration panicked");
        });
        assert!(unwound.is_err());
        assert!(locks.acquire(&root).is_ok());
    }

    #[test]
    fn commands_round_trip_against_a_temp_repository() {
        let repository = TempRepository::create("round-trip");
        let worktree = repository.add_agent_worktree("alpha");
        commit_file(&worktree, "feature.txt", "one\n", "feature");

        let status = tauri::async_runtime::block_on(get_git_ship_status(
            ShipStatusRequest {
                repository_root: repository.root_string(),
                worktree_path: Some(worktree.to_string_lossy().into_owned()),
            },
            true,
        ))
        .expect("ship status");
        assert_eq!(status.worktree.branch, "agent/alpha");
        assert_eq!(status.relation.ahead_of_primary, 1);

        let push = tauri::async_runtime::block_on(push_git_branch_upstream(
            PushBranchUpstreamRequest {
                repository_root: repository.root_string(),
                worktree_path: Some(worktree.to_string_lossy().into_owned()),
            },
            true,
        ))
        .expect_err("no remote");
        assert!(push.starts_with("noRemote:"));

        let request = integrate_request(&repository, &worktree, GitIntegrationMode::FastForward);
        let outcome = tauri::async_runtime::block_on(integrate_git_worktree_branch_with_locks(
            request,
            &true,
            Arc::new(IntegrationLocks::default()),
        ))
        .expect("integrate");
        assert_eq!(
            outcome,
            GitIntegrationOutcome::Integrated {
                merge_sha: status.worktree.head.clone(),
                into_branch: "main".to_string(),
            }
        );
        let serialized = serde_json::to_value(&outcome).expect("serialize outcome");
        assert_eq!(serialized["kind"], "integrated");
        assert_eq!(serialized["mergeSha"], status.worktree.head);
        assert_eq!(serialized["intoBranch"], "main");
        assert_eq!(
            run_git(&repository.root, &["rev-parse", "HEAD"]),
            status.worktree.head
        );
    }
}
