use super::super::{local_branch_head, CommandGitWorktreeGateway, GitWorktreeGateway};
use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

struct TempRepository {
    container: PathBuf,
    root: PathBuf,
}

impl TempRepository {
    fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let container = std::env::temp_dir().join(format!(
            "git-worktree-start-{label}-{}-{nonce}",
            std::process::id()
        ));
        let root = container.join("repository");
        fs::create_dir_all(&root).expect("create repository directory");
        run_git(&root, &["init", "--initial-branch=main"]);
        run_git(&root, &["config", "user.name", "Test"]);
        run_git(&root, &["config", "user.email", "test@example.com"]);
        commit(&root, "README.md", "seed");
        Self {
            container,
            root: root.canonicalize().expect("canonical repository root"),
        }
    }

    fn head(&self) -> String {
        git_stdout(&self.root, &["rev-parse", "HEAD"])
    }
}

impl Drop for TempRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.container);
    }
}

fn commit(root: &Path, file: &str, contents: &str) {
    fs::write(root.join(file), contents).expect("write fixture file");
    run_git(root, &["add", file]);
    run_git(root, &["commit", "-m", contents]);
}

fn git_command(root: &Path, arguments: &[&str]) -> std::process::Output {
    Command::new("git")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .expect("run git fixture command")
}

fn run_git(root: &Path, arguments: &[&str]) {
    let output = git_command(root, arguments);
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(root: &Path, arguments: &[&str]) -> String {
    let output = git_command(root, arguments);
    assert!(output.status.success(), "git fixture {arguments:?} failed");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn wire(value: serde_json::Value) -> Result<WorktreeStartPointWire, serde_json::Error> {
    serde_json::from_value(value)
}

#[test]
fn agent_branch_ref_accepts_local_and_remote_branches() {
    for accepted in [
        "refs/heads/main",
        "refs/heads/feat/idempotency-keys",
        "refs/remotes/origin/release/2.4",
    ] {
        assert_eq!(
            AgentBranchRef::parse(accepted).expect(accepted).as_str(),
            accepted
        );
    }
    let at_limit = format!("refs/heads/{}", "a".repeat(MAX_AGENT_BRANCH_REF_BYTES - 11));
    assert!(AgentBranchRef::parse(&at_limit).is_ok());
}

#[test]
fn agent_branch_ref_rejects_hostile_and_non_branch_refs() {
    let oversized = format!("refs/heads/{}", "a".repeat(600));
    let one_over = format!("refs/heads/{}", "a".repeat(MAX_AGENT_BRANCH_REF_BYTES - 10));
    let hostile = [
        "-b",
        "--upload-pack=x",
        "refs/heads/--upload-pack=x",
        "refs/heads/-b",
        "HEAD~1",
        "refs/heads/HEAD~1",
        "refs/heads/HEAD",
        "refs/heads/a..b",
        "@{-1}",
        "refs/heads/@{-1}",
        "refs/heads/@",
        "refs/tags/v1",
        "main",
        "refs/heads/ma\u{7}in",
        "refs/heads/ma\u{7f}in",
        "refs/heads/my branch",
        "refs/heads/main/",
        "refs/heads/main.lock",
        "refs/heads/a//b",
        "refs/heads/.hidden",
        "refs/heads/main.",
        "refs/heads/",
        "refs/heads/a:b",
        "refs/heads/a*",
        "refs/heads/a\\b",
        oversized.as_str(),
        one_over.as_str(),
    ];
    for candidate in hostile {
        assert_eq!(
            AgentBranchRef::parse(candidate),
            Err(INVALID_START_POINT_ERROR.to_string()),
            "{candidate:?} must be rejected"
        );
    }
}

#[test]
fn start_point_wire_is_closed_and_validated() {
    let head = wire(serde_json::json!({ "kind": "head" })).expect("head");
    assert_eq!(
        WorktreeStartPoint::try_from(head),
        Ok(WorktreeStartPoint::Head)
    );
    let reference =
        wire(serde_json::json!({ "kind": "ref", "ref": "refs/heads/main" })).expect("ref");
    assert_eq!(
        WorktreeStartPoint::try_from(reference),
        Ok(WorktreeStartPoint::Ref(
            AgentBranchRef::parse("refs/heads/main").expect("main")
        ))
    );
    assert!(wire(serde_json::json!({ "kind": "sha", "ref": "abc" })).is_err());
    assert!(wire(serde_json::json!({ "kind": "head", "ref": "x" })).is_err());
    assert!(wire(serde_json::json!({ "kind": "ref" })).is_err());
    assert!(
        wire(serde_json::json!({ "kind": "ref", "ref": "refs/heads/main", "force": true }))
            .is_err()
    );
    let hostile = wire(serde_json::json!({ "kind": "ref", "ref": "refs/heads/--upload-pack=x" }))
        .expect("well-formed wire");
    assert_eq!(
        WorktreeStartPoint::try_from(hostile),
        Err(INVALID_START_POINT_ERROR.to_string())
    );
}

#[test]
fn agent_worktree_starts_from_a_selected_local_branch() {
    let repository = TempRepository::create("local");
    run_git(&repository.root, &["checkout", "-b", "feature"]);
    commit(&repository.root, "feature.txt", "feature");
    let feature_head = repository.head();
    run_git(&repository.root, &["checkout", "main"]);
    let start = WorktreeStartPoint::Ref(AgentBranchRef::parse("refs/heads/feature").expect("ref"));
    let created = CommandGitWorktreeGateway::new()
        .add_agent_worktree_from(&repository.root, "agt-base-0001", &start)
        .expect("worktree from feature");
    assert_eq!(
        git_stdout(&created.worktree_path, &["rev-parse", "HEAD"]),
        feature_head
    );
    assert_ne!(repository.head(), feature_head);
    assert_eq!(
        git_stdout(&repository.root, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "main"
    );
}

#[test]
fn agent_worktree_starts_from_a_remote_tracking_branch() {
    let repository = TempRepository::create("remote");
    let seed = repository.head();
    commit(&repository.root, "later.txt", "later");
    run_git(
        &repository.root,
        &["update-ref", "refs/remotes/origin/release/2.4", &seed],
    );
    let start = WorktreeStartPoint::Ref(
        AgentBranchRef::parse("refs/remotes/origin/release/2.4").expect("ref"),
    );
    let created = CommandGitWorktreeGateway::new()
        .add_agent_worktree_from(&repository.root, "agt-remote-0001", &start)
        .expect("worktree from remote branch");
    assert_eq!(
        git_stdout(&created.worktree_path, &["rev-parse", "HEAD"]),
        seed
    );
    assert_eq!(created.branch, "agent/agt-remote-0001");
}

#[test]
fn agent_worktree_head_start_point_keeps_the_checkout_head() {
    let repository = TempRepository::create("head");
    let created = CommandGitWorktreeGateway::new()
        .add_agent_worktree(&repository.root, "agt-head-0001")
        .expect("worktree from HEAD");
    assert_eq!(
        git_stdout(&created.worktree_path, &["rev-parse", "HEAD"]),
        repository.head()
    );
}

#[test]
fn agent_worktree_rejects_hostile_or_missing_start_points_without_creating_anything() {
    let repository = TempRepository::create("hostile");
    run_git(&repository.root, &["tag", "v1"]);
    for hostile in [
        "--upload-pack=x",
        "refs/heads/-b",
        "HEAD~1",
        "refs/tags/v1",
        "refs/heads/a..b",
    ] {
        let parsed = wire(serde_json::json!({ "kind": "ref", "ref": hostile }))
            .map_err(|error| error.to_string())
            .and_then(WorktreeStartPoint::try_from);
        assert_eq!(
            parsed,
            Err(INVALID_START_POINT_ERROR.to_string()),
            "{hostile}"
        );
    }
    let missing =
        WorktreeStartPoint::Ref(AgentBranchRef::parse("refs/heads/missing").expect("ref"));
    let error = CommandGitWorktreeGateway::new()
        .add_agent_worktree_from(&repository.root, "agt-missing-0001", &missing)
        .expect_err("a missing branch must be rejected");
    assert!(!error.is_empty());
    assert_eq!(
        local_branch_head(&repository.root, "agent/agt-missing-0001").expect("query branch"),
        None
    );
    assert!(!repository.root.join(".worktrees/agt-missing-0001").exists());
}
