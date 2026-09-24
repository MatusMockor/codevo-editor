use super::super::WORKTREE_BASE_DIR_NAME;
use super::*;
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
            "git-branch-worktree-{label}-{}-{nonce}",
            std::process::id()
        ));
        let root = container.join("repository");
        fs::create_dir_all(&root).expect("create repository directory");
        run_git(&root, &["init", "--initial-branch=main"]);
        run_git(&root, &["config", "user.name", "Test"]);
        run_git(&root, &["config", "user.email", "test@example.com"]);
        fs::write(root.join("README.md"), "seed\n").expect("write seed file");
        run_git(&root, &["add", "README.md"]);
        run_git(&root, &["commit", "-m", "initial"]);
        Self {
            container,
            root: root.canonicalize().expect("canonical repository root"),
        }
    }
}

impl Drop for TempRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.container);
    }
}

fn git_output(root: &Path, arguments: &[&str]) -> std::process::Output {
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
    let output = git_output(root, arguments);
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn assert_branch_absent(root: &Path, branch: &str) {
    assert_eq!(local_branch_head(root, branch).expect("query branch"), None);
}

#[test]
fn resolves_branch_and_remote_start_points_to_full_shas() {
    let repository = TempRepository::create("start-point");
    let head = local_branch_head(&repository.root, "main")
        .expect("head")
        .expect("main exists");
    run_git(
        &repository.root,
        &["update-ref", "refs/remotes/origin/main", "main"],
    );
    run_git(&repository.root, &["tag", "v1"]);

    assert_eq!(
        resolve_worktree_start_point(&repository.root, "main"),
        Ok(head.clone())
    );
    assert_eq!(
        resolve_worktree_start_point(&repository.root, "refs/heads/main"),
        Ok(head.clone())
    );
    assert_eq!(
        resolve_worktree_start_point(&repository.root, "origin/main"),
        Ok(head.clone())
    );
    assert_eq!(
        resolve_worktree_start_point(&repository.root, "refs/remotes/origin/main"),
        Ok(head)
    );
    for bad in [
        "-x",
        "--help",
        "a..b",
        "",
        "main lock",
        "refs/tags/v1",
        "v1",
        "does-not-exist",
        "@{-1}",
        "main^{tree}",
        "refs/heads/main^{tree}",
    ] {
        assert!(
            resolve_worktree_start_point(&repository.root, bad).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn creates_a_new_branch_in_a_managed_worktree() {
    let repository = TempRepository::create("branch-worktree");

    let created = add_branch_worktree(&repository.root, "feat/idempotency-ttl", Some("main"))
        .expect("created");

    assert_eq!(created.branch, "feat/idempotency-ttl");
    assert_eq!(
        created.worktree_path,
        repository
            .root
            .join(WORKTREE_BASE_DIR_NAME)
            .join("branch-feat-idempotency-ttl")
    );
    assert!(created.worktree_path.join("README.md").exists());
    assert!(local_branch_head(&repository.root, "feat/idempotency-ttl")
        .expect("lookup")
        .is_some());
    assert_eq!(
        git_output(&repository.root, &["branch", "--show-current"]).stdout,
        b"main\n"
    );
}

#[test]
fn checks_out_an_existing_branch_and_refuses_duplicates_and_bad_names() {
    let repository = TempRepository::create("existing-branch");
    run_git(&repository.root, &["branch", "fix/payments"]);

    assert!(add_branch_worktree(&repository.root, "fix/payments", None).is_ok());
    assert!(add_branch_worktree(&repository.root, "fix/payments", None).is_err());
    assert!(!repository
        .root
        .join(WORKTREE_BASE_DIR_NAME)
        .join(&branch_worktree_directory_candidates("fix/payments")[1])
        .exists());
    assert!(add_branch_worktree(&repository.root, "fix/payments", Some("main")).is_err());
    assert!(add_branch_worktree(&repository.root, "--force", None).is_err());
    assert!(add_branch_worktree(&repository.root, "a..b", None).is_err());
    assert!(add_branch_worktree(&repository.root, "main", None).is_err());
    assert!(add_branch_worktree(&repository.root, "feat/new", Some("--help")).is_err());
    assert_branch_absent(&repository.root, "feat/new");
    assert!(!repository
        .root
        .join(WORKTREE_BASE_DIR_NAME)
        .join("branch-main")
        .exists());
}

#[test]
fn names_branch_worktree_directories_inside_the_base() {
    assert_eq!(branch_worktree_directory_name("feat/x"), "branch-feat-x");
    assert_eq!(
        branch_worktree_directory_name("fix/über..ok"),
        "branch-fix--ber--ok"
    );
    assert_eq!(branch_worktree_directory_name("-x/"), "branch-x");
}

fn git_stdout(root: &Path, arguments: &[&str]) -> String {
    let output = git_output(root, arguments);
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[test]
fn keeps_branches_with_colliding_slugs_in_distinct_directories() {
    let repository = TempRepository::create("slug-collision");

    let slashed = add_branch_worktree(&repository.root, "feat/x", Some("main")).expect("feat/x");
    let dashed = add_branch_worktree(&repository.root, "feat-x", Some("main")).expect("feat-x");

    let base = repository.root.join(WORKTREE_BASE_DIR_NAME);
    assert_eq!(slashed.worktree_path, base.join("branch-feat-x"));
    assert_ne!(dashed.worktree_path, slashed.worktree_path);
    assert_eq!(
        dashed.worktree_path,
        base.join(&branch_worktree_directory_candidates("feat-x")[1])
    );
    assert_eq!(
        git_stdout(&slashed.worktree_path, &["branch", "--show-current"]),
        "feat/x"
    );
    assert_eq!(
        git_stdout(&dashed.worktree_path, &["branch", "--show-current"]),
        "feat-x"
    );
}

#[test]
fn names_the_occupied_directory_instead_of_the_branch_when_no_directory_is_free() {
    let repository = TempRepository::create("directory-in-use");
    let base = repository.root.join(WORKTREE_BASE_DIR_NAME);
    for directory in branch_worktree_directory_candidates("feat/y") {
        fs::create_dir_all(base.join(directory)).expect("occupy directory");
    }

    let result = add_branch_worktree(&repository.root, "feat/y", Some("main"));

    assert_eq!(result, Err(BRANCH_DIRECTORY_IN_USE_ERROR.to_string()));
    assert_branch_absent(&repository.root, "feat/y");
}

#[test]
fn derives_a_stable_hashed_fallback_directory() {
    let [readable, hashed] = branch_worktree_directory_candidates("feat/x");
    let [dashed_readable, dashed_hashed] = branch_worktree_directory_candidates("feat-x");

    assert_eq!(readable, "branch-feat-x");
    assert_eq!(dashed_readable, readable);
    assert_ne!(hashed, dashed_hashed);
    assert!(hashed.starts_with("branch-feat-x-"));
    assert_eq!(hashed.len(), "branch-feat-x-".len() + 8);
    assert_eq!(branch_worktree_directory_candidates("feat/x")[1], hashed);
}

#[test]
fn compensates_a_failed_worktree_add_without_leaking_the_branch_or_directory() {
    let repository = TempRepository::create("failed-add");
    let root = &repository.root;
    let blob = git_stdout_with_input(root, &["hash-object", "-w", "--stdin"], "poison\n");
    let inner = git_stdout_with_input(root, &["mktree"], &format!("100644 blob {blob}\tx\n"));
    let tree = git_stdout_with_input(root, &["mktree"], &format!("040000 tree {inner}\t.GIT\n"));
    let commit = git_stdout(root, &["commit-tree", &tree, "-p", "HEAD", "-m", "poison"]);
    run_git(root, &["branch", "poison", &commit]);

    let result = add_branch_worktree(root, "feat/bad", Some("poison"));

    let error = result.expect_err("checkout of an invalid path must fail");
    assert!(!error.contains("Cleanup could not be completed"), "{error}");
    assert_branch_absent(root, "feat/bad");
    let base = root.join(WORKTREE_BASE_DIR_NAME);
    for directory in branch_worktree_directory_candidates("feat/bad") {
        assert!(!base.join(directory).exists());
    }
    assert_eq!(
        CommandGitWorktreeGateway::new()
            .list_worktrees(root)
            .expect("list worktrees")
            .len(),
        1
    );
    let retry = add_branch_worktree(root, "feat/bad", Some("main")).expect("retry succeeds");
    assert_eq!(retry.worktree_path, base.join("branch-feat-bad"));
}

fn git_stdout_with_input(root: &Path, arguments: &[&str], input: &str) -> String {
    use std::io::Write;
    let mut child = Command::new("git")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("spawn git fixture command");
    child
        .stdin
        .take()
        .expect("fixture stdin")
        .write_all(input.as_bytes())
        .expect("write fixture stdin");
    let output = child.wait_with_output().expect("await git fixture command");
    assert!(
        output.status.success(),
        "git fixture command {arguments:?} failed"
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
