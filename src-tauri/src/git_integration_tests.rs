use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::time::Instant;

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

struct TempRepository {
    root: PathBuf,
}

impl TempRepository {
    fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "git-integration-{label}-{}-{nonce}",
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

    fn targets(&self, worktree: &Path) -> ShipTargets {
        resolve_ship_targets(&self.root, Some(worktree)).expect("resolve ship targets")
    }

    fn bare_remote(&self, name: &str) -> PathBuf {
        let remote = self.root.with_file_name(format!(
            "{}-remote-{name}",
            self.root.file_name().expect("root name").to_string_lossy()
        ));
        fs::create_dir_all(&remote).expect("create bare remote directory");
        run_git(&remote, &["init", "--bare", "--initial-branch=main"]);
        run_git(
            &self.root,
            &[
                "remote",
                "add",
                name,
                remote.to_str().expect("utf8 remote path"),
            ],
        );
        remote
    }
}

impl Drop for TempRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let parent = self.root.parent().expect("temp parent");
        let prefix = format!(
            "{}-remote-",
            self.root.file_name().expect("root name").to_string_lossy()
        );
        let Ok(entries) = fs::read_dir(parent) else {
            return;
        };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

fn run_git(root: &Path, arguments: &[&str]) {
    let output = git_output_raw(root, arguments);
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output_raw(root: &Path, arguments: &[&str]) -> std::process::Output {
    Command::new("git")
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
        .expect("run git fixture command")
}

fn git_stdout(root: &Path, arguments: &[&str]) -> String {
    let output = git_output_raw(root, arguments);
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn head_of(root: &Path) -> String {
    git_stdout(root, &["rev-parse", "HEAD"])
}

fn commit_file(root: &Path, name: &str, content: &str, message: &str) {
    fs::write(root.join(name), content).expect("write file");
    run_git(root, &["add", name]);
    run_git(root, &["commit", "-m", message]);
}

fn request(
    repository: &TempRepository,
    worktree: &Path,
    mode: GitIntegrationMode,
) -> IntegrationRequest {
    IntegrationRequest {
        mode,
        expected_primary_branch: "main".to_string(),
        expected_primary_head: head_of(&repository.root),
        expected_branch_head: head_of(worktree),
        merge_message: "Merge agent/alpha (title)".to_string(),
    }
}

#[test]
fn ship_status_reports_clean_ahead_worktree_without_remote() {
    let repository = TempRepository::create("status-clean");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");

    let status = ship_status(&repository.targets(&worktree)).expect("ship status");

    assert_eq!(status.worktree.branch, "agent/alpha");
    assert_eq!(status.worktree.head, head_of(&worktree));
    assert!(!status.worktree.dirty);
    assert_eq!(status.worktree.change_count, 0);
    assert_eq!(status.primary.branch.as_deref(), Some("main"));
    assert_eq!(status.primary.head, head_of(&repository.root));
    assert!(!status.primary.dirty);
    assert_eq!(status.relation.ahead_of_primary, 1);
    assert_eq!(status.relation.behind_primary, 0);
    assert!(status.relation.fast_forwardable);
    assert_eq!(status.remote, None);
}

#[test]
fn ship_status_counts_worktree_changes_and_ignores_untracked_primary_files() {
    let repository = TempRepository::create("status-dirty");
    let worktree = repository.add_agent_worktree("alpha");
    fs::write(worktree.join("README.md"), "changed\n").expect("modify tracked");
    fs::write(worktree.join("new.txt"), "new\n").expect("add untracked");
    fs::write(repository.root.join("scratch.txt"), "scratch\n").expect("primary untracked");

    let status = ship_status(&repository.targets(&worktree)).expect("ship status");

    assert!(status.worktree.dirty);
    assert_eq!(status.worktree.change_count, 2);
    assert!(!status.primary.dirty);

    fs::write(repository.root.join("README.md"), "primary edit\n").expect("modify primary");
    let status = ship_status(&repository.targets(&worktree)).expect("ship status");
    assert!(status.primary.dirty);
}

#[test]
fn ship_status_reports_detached_primary_and_divergence() {
    let repository = TempRepository::create("status-detached");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    commit_file(&repository.root, "main.txt", "main\n", "main moves on");
    let primary_head = head_of(&repository.root);
    run_git(
        &repository.root,
        &["checkout", "--detach", primary_head.as_str()],
    );

    let status = ship_status(&repository.targets(&worktree)).expect("ship status");

    assert_eq!(status.primary.branch, None);
    assert_eq!(status.relation.ahead_of_primary, 1);
    assert_eq!(status.relation.behind_primary, 1);
    assert!(!status.relation.fast_forwardable);
}

#[test]
fn ship_status_in_place_uses_the_repository_root_for_both_sides() {
    let repository = TempRepository::create("status-in-place");
    let targets = resolve_ship_targets(&repository.root, None).expect("in-place targets");

    let status = ship_status(&targets).expect("ship status");

    assert!(targets.in_place);
    assert_eq!(status.worktree.branch, "main");
    assert_eq!(status.worktree.head, status.primary.head);
    assert_eq!(status.relation.ahead_of_primary, 0);
    assert_eq!(status.relation.behind_primary, 0);
    assert!(status.relation.fast_forwardable);
}

#[test]
fn ship_status_reports_upstream_counts_and_compare_url() {
    let repository = TempRepository::create("status-upstream");
    let worktree = repository.add_agent_worktree("alpha");
    repository.bare_remote("origin");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    run_git(&worktree, &["push", "-u", "origin", "agent/alpha"]);
    commit_file(&worktree, "feature.txt", "two\n", "feature two");
    run_git(
        &worktree,
        &[
            "remote",
            "set-url",
            "--push",
            "origin",
            "git@github.com:acme/widgets.git",
        ],
    );

    let status = ship_status(&repository.targets(&worktree)).expect("ship status");
    let remote = status.remote.expect("remote present");

    assert_eq!(remote.name, "origin");
    assert_eq!(
        remote.upstream,
        Some(ShipUpstream {
            ahead: 1,
            behind: 0
        })
    );
    assert_eq!(
        remote.compare_url.as_deref(),
        Some("https://github.com/acme/widgets/compare/main...agent/alpha?expand=1")
    );
}

#[test]
fn ship_status_rejects_a_worktree_outside_the_agent_branch_namespace() {
    let repository = TempRepository::create("status-foreign-branch");
    let worktree = repository.add_agent_worktree("alpha");
    run_git(&worktree, &["checkout", "-b", "feature/manual"]);

    let error = ship_status(&repository.targets(&worktree)).expect_err("foreign branch refused");

    assert_eq!(error, "The worktree is not on an agent branch.");
}

#[test]
fn fast_forward_integration_moves_primary_to_the_branch_head() {
    let repository = TempRepository::create("integrate-ff");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    let branch_head = head_of(&worktree);
    let request = request(&repository, &worktree, GitIntegrationMode::FastForward);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(
        outcome,
        GitIntegrationOutcome::Integrated {
            merge_sha: branch_head.clone(),
            into_branch: "main".to_string(),
        }
    );
    assert_eq!(head_of(&repository.root), branch_head);
    assert!(repository.root.join("feature.txt").is_file());
}

#[test]
fn merge_integration_creates_a_merge_commit_with_the_given_message() {
    let repository = TempRepository::create("integrate-merge");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    let before = head_of(&repository.root);
    let branch_head = head_of(&worktree);
    let request = request(&repository, &worktree, GitIntegrationMode::Merge);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    let merge_sha = head_of(&repository.root);
    assert_eq!(
        outcome,
        GitIntegrationOutcome::Integrated {
            merge_sha: merge_sha.clone(),
            into_branch: "main".to_string(),
        }
    );
    assert_ne!(merge_sha, branch_head);
    let parents = git_stdout(&repository.root, &["log", "-1", "--format=%P"]);
    assert_eq!(parents, format!("{before} {branch_head}"));
    let subject = git_stdout(&repository.root, &["log", "-1", "--format=%s"]);
    assert_eq!(subject, "Merge agent/alpha (title)");
}

#[test]
fn conflicting_merge_is_aborted_and_reports_the_conflicted_files() {
    let repository = TempRepository::create("integrate-conflict");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "README.md", "agent\n", "agent edit");
    commit_file(&repository.root, "README.md", "human\n", "human edit");
    let before = head_of(&repository.root);
    let request = request(&repository, &worktree, GitIntegrationMode::Merge);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(
        outcome,
        GitIntegrationOutcome::Conflicted {
            files: vec!["README.md".to_string()],
            truncated: false,
        }
    );
    assert_eq!(head_of(&repository.root), before);
    assert_eq!(merge_in_progress(&repository.root), Ok(false));
    assert_eq!(
        fs::read_to_string(repository.root.join("README.md")).expect("read"),
        "human\n"
    );
}

#[test]
fn conflict_listing_failure_still_aborts_the_merge_and_fails_closed() {
    let repository = TempRepository::create("integrate-conflict-listing");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "README.md", "agent\n", "agent edit");
    commit_file(&repository.root, "README.md", "human\n", "human edit");
    let before = head_of(&repository.root);
    let request = request(&repository, &worktree, GitIntegrationMode::Merge);
    let failing_lister: ConflictLister = |_| Err(CommandError::TimedOut(INTEGRATION_LOCAL_TIMEOUT));

    let error = integrate_branch_with(&repository.targets(&worktree), &request, failing_lister)
        .expect_err("listing failure surfaces");

    assert!(
        error.starts_with(CONFLICT_LISTING_FAILED_ERROR),
        "unexpected error {error}"
    );
    assert!(error.contains("timed out"));
    assert_eq!(head_of(&repository.root), before);
    assert_eq!(merge_in_progress(&repository.root), Ok(false));
    assert_eq!(
        fs::read_to_string(repository.root.join("README.md")).expect("read"),
        "human\n"
    );
}

#[test]
fn merge_probe_distinguishes_absent_merge_head_from_runner_failure() {
    let repository = TempRepository::create("merge-probe");
    assert_eq!(merge_in_progress(&repository.root), Ok(false));

    let missing = repository.root.join("does-not-exist");
    assert!(matches!(
        merge_in_progress(&missing),
        Err(CommandError::Failed(message)) if message != GENERIC_FAILURE_MESSAGE
    ));
}

#[test]
fn fast_forward_failure_without_a_merge_state_is_only_not_fast_forward_when_git_says_so() {
    let repository = TempRepository::create("integrate-ff-untracked");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    fs::write(repository.root.join("feature.txt"), "untracked\n").expect("untracked clash");
    let before = head_of(&repository.root);
    let request = request(&repository, &worktree, GitIntegrationMode::FastForward);

    let error = integrate_branch(&repository.targets(&worktree), &request)
        .expect_err("untracked clash is not a fast-forward refusal");

    assert!(
        error.to_ascii_lowercase().contains("untracked"),
        "unexpected error {error}"
    );
    assert_eq!(head_of(&repository.root), before);
    assert_eq!(merge_in_progress(&repository.root), Ok(false));
}

#[test]
fn merge_failure_classification_uses_the_closed_marker() {
    assert_eq!(
        classify_merge_failure(
            GitIntegrationMode::FastForward,
            CommandError::Failed("fatal: Not possible to fast-forward, aborting.".to_string()),
        ),
        Ok(GitIntegrationOutcome::NotFastForward)
    );
    assert_eq!(
        classify_merge_failure(
            GitIntegrationMode::Merge,
            CommandError::Failed("fatal: Not possible to fast-forward, aborting.".to_string()),
        ),
        Err("fatal: Not possible to fast-forward, aborting.".to_string())
    );
    assert_eq!(
        classify_merge_failure(
            GitIntegrationMode::FastForward,
            CommandError::Failed("error: something else".to_string()),
        ),
        Err("error: something else".to_string())
    );
    assert!(matches!(
        classify_merge_failure(
            GitIntegrationMode::FastForward,
            CommandError::TimedOut(Duration::from_secs(1)),
        ),
        Err(message) if message.contains("timed out")
    ));
    let long = format!("fatal: {}", "x".repeat(MAX_MERGE_MESSAGE_BYTES * 2));
    let clipped = classify_merge_failure(GitIntegrationMode::Merge, CommandError::Failed(long))
        .expect_err("clipped");
    assert_eq!(clipped.len(), MAX_MERGE_MESSAGE_BYTES);
}

#[test]
fn integration_result_verification_pins_the_expected_parents() {
    let primary = "a".repeat(40);
    let branch = "b".repeat(40);
    let merge = "c".repeat(40);
    let other = "d".repeat(40);

    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::FastForward,
            &branch,
            &[],
            &primary,
            &branch
        ),
        Ok(())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::FastForward,
            &other,
            &[],
            &primary,
            &branch
        ),
        Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::Merge,
            &merge,
            &[primary.clone(), branch.clone()],
            &primary,
            &branch
        ),
        Ok(())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::Merge,
            &merge,
            &[other.clone(), branch.clone()],
            &primary,
            &branch
        ),
        Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::Merge,
            &merge,
            &[branch.clone(), primary.clone()],
            &primary,
            &branch
        ),
        Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::Merge,
            &merge,
            std::slice::from_ref(&primary),
            &primary,
            &branch
        ),
        Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
    );
    assert_eq!(
        verify_integration_result(
            GitIntegrationMode::Merge,
            &merge,
            &[primary.clone(), branch.clone(), other],
            &primary,
            &branch
        ),
        Err(PRIMARY_CHANGED_DURING_INTEGRATION_ERROR.to_string())
    );
}

#[test]
fn commit_parents_reports_merge_parents_in_order() {
    let repository = TempRepository::create("commit-parents");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    let before = head_of(&repository.root);
    let branch_head = head_of(&worktree);
    run_git(
        &repository.root,
        &["merge", "--no-ff", "-m", "merge", branch_head.as_str()],
    );

    let merge_sha = head_of(&repository.root);
    assert_eq!(
        commit_parents(&repository.root, &merge_sha),
        Ok(vec![before.clone(), branch_head])
    );
    assert_eq!(commit_parents(&repository.root, &before), Ok(Vec::new()));
}

#[test]
fn diverged_branch_is_not_fast_forwardable() {
    let repository = TempRepository::create("integrate-not-ff");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    commit_file(&repository.root, "main.txt", "main\n", "main moves on");
    let before = head_of(&repository.root);
    let request = request(&repository, &worktree, GitIntegrationMode::FastForward);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(outcome, GitIntegrationOutcome::NotFastForward);
    assert_eq!(head_of(&repository.root), before);
}

#[test]
fn stale_expectation_is_refused_before_any_merge() {
    let repository = TempRepository::create("integrate-stale");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    let mut request = request(&repository, &worktree, GitIntegrationMode::FastForward);
    let before = head_of(&repository.root);
    request.expected_primary_head = "0".repeat(40);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(outcome, GitIntegrationOutcome::StaleExpectation);
    assert_eq!(head_of(&repository.root), before);

    let mut request = self::request(&repository, &worktree, GitIntegrationMode::FastForward);
    request.expected_primary_branch = "develop".to_string();
    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");
    assert_eq!(outcome, GitIntegrationOutcome::StaleExpectation);
}

#[test]
fn dirty_primary_is_refused_and_left_untouched() {
    let repository = TempRepository::create("integrate-dirty");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    fs::write(repository.root.join("README.md"), "edited\n").expect("dirty primary");
    let before = head_of(&repository.root);
    let request = request(&repository, &worktree, GitIntegrationMode::FastForward);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(outcome, GitIntegrationOutcome::PrimaryDirty);
    assert_eq!(head_of(&repository.root), before);
    assert_eq!(
        fs::read_to_string(repository.root.join("README.md")).expect("read"),
        "edited\n"
    );
}

#[test]
fn detached_primary_is_refused() {
    let repository = TempRepository::create("integrate-detached");
    let worktree = repository.add_agent_worktree("alpha");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    let request = request(&repository, &worktree, GitIntegrationMode::FastForward);
    run_git(&repository.root, &["checkout", "--detach"]);

    let outcome = integrate_branch(&repository.targets(&worktree), &request).expect("integrate");

    assert_eq!(outcome, GitIntegrationOutcome::PrimaryDetached);
}

#[test]
fn in_place_targets_cannot_be_integrated() {
    let repository = TempRepository::create("integrate-in-place");
    let targets = resolve_ship_targets(&repository.root, None).expect("in-place targets");
    let request = IntegrationRequest {
        mode: GitIntegrationMode::FastForward,
        expected_primary_branch: "main".to_string(),
        expected_primary_head: head_of(&repository.root),
        expected_branch_head: head_of(&repository.root),
        merge_message: "message".to_string(),
    };

    let error = integrate_branch(&targets, &request).expect_err("in-place refused");

    assert_eq!(error, IN_PLACE_INTEGRATION_ERROR);
}

#[test]
fn push_sets_the_upstream_and_a_second_push_is_a_no_op() {
    let repository = TempRepository::create("push-ok");
    let worktree = repository.add_agent_worktree("alpha");
    let remote = repository.bare_remote("origin");
    commit_file(&worktree, "feature.txt", "one\n", "feature");

    let receipt = push_branch_upstream(&repository.targets(&worktree)).expect("push");

    assert_eq!(receipt.remote, "origin");
    assert_eq!(receipt.branch, "agent/alpha");
    assert_eq!(receipt.compare_url, None);
    assert_eq!(
        git_stdout(&worktree, &["config", "--get", "branch.agent/alpha.remote"]),
        "origin"
    );
    assert_eq!(
        git_stdout(&remote, &["rev-parse", "refs/heads/agent/alpha"]),
        head_of(&worktree)
    );

    let again = push_branch_upstream(&repository.targets(&worktree)).expect("second push");
    assert_eq!(again.remote, "origin");

    let status = ship_status(&repository.targets(&worktree)).expect("ship status");
    assert_eq!(
        status.remote.and_then(|remote| remote.upstream),
        Some(ShipUpstream {
            ahead: 0,
            behind: 0
        })
    );
}

#[test]
fn push_receipt_survives_an_unreadable_primary_branch() {
    let repository = TempRepository::create("push-primary-unreadable");
    let worktree = repository.add_agent_worktree("alpha");
    let remote = repository.bare_remote("origin");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    run_git(
        &repository.root,
        &["update-ref", "refs/heads/-dash", "HEAD"],
    );
    run_git(
        &repository.root,
        &["symbolic-ref", "HEAD", "refs/heads/-dash"],
    );
    assert!(current_branch(&repository.root).is_err());

    let receipt = push_branch_upstream(&repository.targets(&worktree)).expect("push succeeds");

    assert_eq!(receipt.remote, "origin");
    assert_eq!(receipt.branch, "agent/alpha");
    assert_eq!(receipt.compare_url, None);
    assert_eq!(
        git_stdout(&remote, &["rev-parse", "refs/heads/agent/alpha"]),
        head_of(&worktree)
    );
}

#[test]
fn push_without_any_remote_reports_no_remote() {
    let repository = TempRepository::create("push-no-remote");
    let worktree = repository.add_agent_worktree("alpha");

    let failure = push_branch_upstream(&repository.targets(&worktree)).expect_err("no remote");

    assert_eq!(failure, PushFailure::NoRemote);
    assert_eq!(
        failure.into_error_string(),
        "noRemote:No remote is configured for this repository."
    );
}

#[test]
fn push_after_the_remote_advanced_is_rejected() {
    let repository = TempRepository::create("push-rejected");
    let worktree = repository.add_agent_worktree("alpha");
    let remote = repository.bare_remote("origin");
    commit_file(&worktree, "feature.txt", "one\n", "feature");
    push_branch_upstream(&repository.targets(&worktree)).expect("first push");

    let other = remote.with_file_name(format!(
        "{}-clone",
        remote.file_name().expect("remote name").to_string_lossy()
    ));
    run_git(
        &repository.root,
        &[
            "clone",
            "--branch",
            "agent/alpha",
            remote.to_str().expect("utf8"),
            other.to_str().expect("utf8"),
        ],
    );
    run_git(&other, &["config", "user.name", "Other"]);
    run_git(&other, &["config", "user.email", "other@example.com"]);
    commit_file(&other, "other.txt", "other\n", "remote moved");
    run_git(&other, &["push", "origin", "agent/alpha"]);
    let _ = fs::remove_dir_all(&other);
    commit_file(&worktree, "feature.txt", "two\n", "local moved");

    let failure = push_branch_upstream(&repository.targets(&worktree)).expect_err("rejected");

    assert!(
        matches!(failure, PushFailure::Rejected(_)),
        "expected rejected, got {failure:?}"
    );
    assert!(failure.into_error_string().starts_with("rejected:"));
}

#[test]
fn push_failure_classification_uses_closed_markers() {
    let auth = classify_push_failure(CommandError::Failed(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
            .to_string(),
    ));
    assert!(matches!(auth, PushFailure::AuthRequired(_)));

    let timeout = classify_push_failure(CommandError::TimedOut(Duration::from_secs(120)));
    assert_eq!(
        timeout,
        PushFailure::GitError("Push timed out.".to_string())
    );

    let other = classify_push_failure(CommandError::Failed("fatal: something else".to_string()));
    assert!(matches!(other, PushFailure::GitError(_)));

    let long = "x".repeat(MAX_MERGE_MESSAGE_BYTES + 50);
    let clipped = PushFailure::GitError(long).into_error_string();
    assert_eq!(clipped.len(), "gitError:".len() + MAX_MERGE_MESSAGE_BYTES);
}

#[test]
fn compare_url_normalises_hosted_remote_forms() {
    let cases: [(&str, Option<&str>); 12] = [
        (
            "https://github.com/acme/widgets.git",
            Some("https://github.com/acme/widgets/compare/main...agent/alpha?expand=1"),
        ),
        (
            "git@github.com:acme/widgets.git",
            Some("https://github.com/acme/widgets/compare/main...agent/alpha?expand=1"),
        ),
        (
            "ssh://git@GitHub.com:22/acme/widgets",
            Some("https://github.com/acme/widgets/compare/main...agent/alpha?expand=1"),
        ),
        (
            "https://user@github.com/acme/widgets/",
            Some("https://github.com/acme/widgets/compare/main...agent/alpha?expand=1"),
        ),
        (
            "https://gitlab.com/acme/widgets.git",
            Some("https://gitlab.com/acme/widgets/-/merge_requests/new?merge_request[source_branch]=agent/alpha&merge_request[target_branch]=main"),
        ),
        (
            "git@bitbucket.org:acme/widgets.git",
            Some("https://bitbucket.org/acme/widgets/pull-requests/new?source=agent/alpha&dest=main"),
        ),
        ("https://example.com/acme/widgets.git", None),
        ("https://github.com/acme/widgets/extra.git", None),
        ("https://github.com/acme", None),
        ("https://github.com/../widgets", None),
        ("https://evil.com/github.com/acme/widgets", None),
        ("git@github.com.evil.com:acme/widgets.git", None),
    ];

    for (remote, expected) in cases {
        assert_eq!(
            compare_url(remote, "main", "agent/alpha").as_deref(),
            expected,
            "remote {remote}"
        );
    }
}

#[test]
fn compare_url_rejects_unsafe_or_oversize_inputs() {
    assert_eq!(
        compare_url("https://github.com/acme/widgets", "main", "-x"),
        None
    );
    assert_eq!(
        compare_url(
            "https://github.com/acme/widgets",
            "--upload-pack=x",
            "agent/a"
        ),
        None
    );
    let long_branch = format!("agent/{}", "a".repeat(MAX_INTEGRATION_BRANCH_BYTES));
    assert_eq!(
        compare_url("https://github.com/acme/widgets", "main", &long_branch),
        None
    );
    let long_remote = format!("https://github.com/{}/widgets", "o".repeat(3000));
    assert_eq!(compare_url(&long_remote, "main", "agent/a"), None);
    assert_eq!(
        compare_url("https://github.com/acme/widgets", "main", "agent/sp ace?x").as_deref(),
        Some("https://github.com/acme/widgets/compare/main...agent/sp%20ace%3Fx?expand=1")
    );
}

#[test]
fn choose_remote_follows_the_closed_rule() {
    let remotes =
        |names: &[&str]| -> Vec<String> { names.iter().map(|name| name.to_string()).collect() };

    assert_eq!(
        choose_remote(Some("fork"), &remotes(&["origin", "fork"])),
        Some("fork".to_string())
    );
    assert_eq!(
        choose_remote(Some("missing"), &remotes(&["origin", "fork"])),
        Some("origin".to_string())
    );
    assert_eq!(
        choose_remote(None, &remotes(&["upstream"])),
        Some("upstream".to_string())
    );
    assert_eq!(choose_remote(None, &remotes(&["a", "b"])), None);
    assert_eq!(choose_remote(None, &remotes(&[])), None);
    assert_eq!(choose_remote(Some("-bad"), &remotes(&["-bad"])), None);
}

#[test]
fn validators_reject_option_like_and_malformed_values() {
    assert_eq!(
        safe_branch_name("--upload-pack=x").expect_err("option-like branch"),
        UNSAFE_BRANCH_NAME_ERROR
    );
    assert!(safe_branch_name("agent/alpha").is_ok());
    assert!(safe_branch_name("a..b").is_err());
    assert!(safe_branch_name("a@{1}").is_err());
    assert!(safe_remote_name("-origin").is_err());
    assert!(safe_remote_name("origin").is_ok());
    assert!(safe_object_id("ABCDEF0123456789ABCDEF0123456789ABCDEF01").is_err());
    assert!(safe_object_id(&"a".repeat(40)).is_ok());
    assert!(safe_merge_message("   ").is_err());
    assert!(safe_merge_message("line one\nline two").is_ok());
    assert!(safe_merge_message("nul\0byte").is_err());
}

#[test]
fn status_entry_counting_handles_renames_and_the_cap() {
    assert_eq!(count_status_entries(""), 0);
    assert_eq!(count_status_entries(" M a.txt\0?? b.txt\0"), 2);
    assert_eq!(count_status_entries("R  new.txt\0old.txt\0 M c.txt\0"), 2);

    let many: String = (0..(MAX_INTEGRATION_CHANGE_COUNT + 10))
        .map(|index| format!("?? f{index}\0"))
        .collect();
    assert_eq!(count_status_entries(&many), MAX_INTEGRATION_CHANGE_COUNT);

    assert_eq!(parse_left_right_count("3\t5\n"), Ok((3, 5)));
    assert!(parse_left_right_count("nope").is_err());
}

#[test]
fn env_allowlist_forwards_network_and_credential_helpers_but_not_repository_overrides() {
    let required = [
        "PATH",
        "HOME",
        "SSH_AUTH_SOCK",
        "SSH_ASKPASS",
        "GIT_ASKPASS",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_EXEC_PATH",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "all_proxy",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
    ];
    for key in required {
        assert!(ENV_ALLOWLIST.contains(&key), "missing {key}");
    }

    let forbidden = [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_NAMESPACE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG_PARAMETERS",
        "GIT_CONFIG_COUNT",
        "GIT_EDITOR",
        "GIT_SEQUENCE_EDITOR",
        "GIT_PAGER",
        "GIT_TERMINAL_PROMPT",
        "GIT_OPTIONAL_LOCKS",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
    ];
    for key in forbidden {
        assert!(!ENV_ALLOWLIST.contains(&key), "must not forward {key}");
    }

    let mut seen = std::collections::HashSet::new();
    for key in ENV_ALLOWLIST {
        assert!(seen.insert(key), "duplicate allowlist entry {key}");
    }

    let command = integration_git_command(Path::new("."));
    let pinned: Vec<(String, Option<String>)> = command
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().to_string(),
                value.map(|value| value.to_string_lossy().to_string()),
            )
        })
        .collect();
    assert!(pinned.contains(&("GIT_TERMINAL_PROMPT".to_string(), Some("0".to_string()))));
    assert!(pinned.contains(&("GIT_OPTIONAL_LOCKS".to_string(), Some("0".to_string()))));
    assert!(pinned.iter().all(|(key, _)| {
        ENV_ALLOWLIST.contains(&key.as_str())
            || [
                "LC_ALL",
                "LANG",
                "GIT_TERMINAL_PROMPT",
                "GIT_OPTIONAL_LOCKS",
            ]
            .contains(&key.as_str())
    }));
}

#[test]
fn merge_commands_get_a_larger_budget_than_status_probes() {
    assert!(INTEGRATION_MERGE_TIMEOUT > INTEGRATION_LOCAL_TIMEOUT);
    assert_eq!(INTEGRATION_MERGE_TIMEOUT, Duration::from_secs(120));
    assert_eq!(INTEGRATION_LOCAL_TIMEOUT, Duration::from_secs(30));
}

#[cfg(unix)]
#[test]
fn timeout_kills_the_whole_process_group() {
    let mut command = Command::new("sh");
    command.args(["-c", "sleep 30 & echo $!; wait"]);
    let started = Instant::now();

    let error = run_bounded_command(command, Duration::from_millis(300)).expect_err("timed out");

    assert_eq!(error, CommandError::TimedOut(Duration::from_millis(300)));
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[cfg(unix)]
#[test]
fn timeout_reaps_the_grandchild_of_a_stalled_command() {
    let marker = std::env::temp_dir().join(format!(
        "git-integration-grandchild-{}-{}",
        std::process::id(),
        TEMP_NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    let script = format!(
        "sleep 30 & echo $! > '{}'; wait",
        marker.to_str().expect("utf8 marker path")
    );
    let mut command = Command::new("sh");
    command.args(["-c", script.as_str()]);

    let error = run_bounded_command(command, Duration::from_millis(300)).expect_err("timed out");
    assert!(matches!(error, CommandError::TimedOut(_)));

    let grandchild: i32 = fs::read_to_string(&marker)
        .expect("grandchild pid recorded")
        .trim()
        .parse()
        .expect("numeric pid");
    let _ = fs::remove_file(&marker);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        // SAFETY: signal 0 only probes for existence of the recorded pid.
        let alive = unsafe { libc::kill(grandchild, 0) } == 0;
        if !alive || Instant::now() > deadline {
            assert!(!alive, "grandchild {grandchild} survived the group kill");
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn oversized_output_fails_closed() {
    let mut command = Command::new("sh");
    command.args(["-c", "head -c 300000 /dev/zero | tr '\\0' 'a'"]);

    let error = run_bounded_command(command, Duration::from_secs(10)).expect_err("too large");

    assert!(matches!(error, CommandError::Io(message) if message.contains("exceeded")));
}

#[test]
fn failed_command_reports_trimmed_stderr() {
    let repository = TempRepository::create("runner-stderr");

    let error = run_integration_command(
        &repository.root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("nope"),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    )
    .expect_err("unknown revision");

    assert!(matches!(error, CommandError::Failed(message) if message.contains("fatal")));
}
