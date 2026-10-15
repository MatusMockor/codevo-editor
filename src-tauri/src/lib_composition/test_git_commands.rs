#[test]
fn get_git_status_reports_staged_changes_off_thread() {
    let root = temp_workspace("git-status-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
    run_test_git(&root, &["add", "tracked.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

    let status = tauri::async_runtime::block_on(get_git_status(path_string(&root), true))
        .expect("git status result");

    assert!(
        status
            .changes
            .iter()
            .any(|change| change.relative_path == "tracked.txt"),
        "expected the modified file in git status, got {:?}",
        status.changes
    );
}

#[test]
fn stage_git_files_off_thread_stages_only_requested_repository() {
    let root = temp_workspace("git-stage-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("tracked.txt"), "one\n").expect("write tracked");
    run_test_git(&root, &["add", "tracked.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("tracked.txt"), "two\n").expect("modify tracked");

    let change = crate::git::GitChangedFile {
        is_staged: false,
        is_unversioned: false,
        old_path: None,
        old_relative_path: None,
        path: path_string(&root.join("tracked.txt")),
        relative_path: "tracked.txt".to_string(),
        status: crate::git::GitChangeStatus::Modified,
    };

    let status =
        tauri::async_runtime::block_on(stage_git_files(path_string(&root), vec![change], true))
            .expect("stage result");

    assert!(
        status
            .changes
            .iter()
            .any(|entry| entry.relative_path == "tracked.txt" && entry.is_staged),
        "expected the file to be staged, got {:?}",
        status.changes
    );
}

#[test]
fn git_status_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-iso-a");
    let root_b = temp_workspace("git-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("only-in-a.txt"), "a\n").expect("file in a");
    fs::write(root_b.join("only-in-b.txt"), "b\n").expect("file in b");

    let status_a = tauri::async_runtime::block_on(get_git_status(path_string(&root_a), true))
        .expect("status a");
    let status_b = tauri::async_runtime::block_on(get_git_status(path_string(&root_b), true))
        .expect("status b");

    assert!(
        status_a
            .changes
            .iter()
            .any(|change| change.relative_path == "only-in-a.txt"),
        "root A should see its own file"
    );
    assert!(
        status_a
            .changes
            .iter()
            .all(|change| change.relative_path != "only-in-b.txt"),
        "root A must not see root B's file (no cross-root leakage)"
    );
    assert!(
        status_b
            .changes
            .iter()
            .any(|change| change.relative_path == "only-in-b.txt"),
        "root B should see its own file"
    );
    assert!(
        status_b
            .changes
            .iter()
            .all(|change| change.relative_path != "only-in-a.txt"),
        "root B must not see root A's file (no cross-root leakage)"
    );
}

#[test]
fn fetch_stays_isolated_per_workspace_root_off_thread() {
    let host = temp_workspace("git-remote-commands");
    let remote = host.join("remote.git");
    let seed = host.join("seed");
    let root_a = host.join("workspace-a");
    let root_b = host.join("workspace-b");
    fs::create_dir_all(&seed).expect("seed directory");
    run_test_git(
        &host,
        &["init", "--bare", remote.to_str().expect("remote path")],
    );
    init_test_git_repo(&seed);
    fs::write(seed.join("base.txt"), "base\n").expect("base file");
    run_test_git(&seed, &["add", "base.txt"]);
    run_test_git(&seed, &["commit", "-m", "initial"]);
    run_test_git(&seed, &["branch", "-M", "main"]);
    run_test_git(
        &seed,
        &[
            "remote",
            "add",
            "origin",
            remote.to_str().expect("remote path"),
        ],
    );
    run_test_git(&seed, &["push", "-u", "origin", "main"]);
    run_test_git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    run_test_git(
        &host,
        &[
            "clone",
            remote.to_str().expect("remote path"),
            root_a.to_str().expect("workspace A path"),
        ],
    );
    run_test_git(
        &host,
        &[
            "clone",
            remote.to_str().expect("remote path"),
            root_b.to_str().expect("workspace B path"),
        ],
    );
    fs::write(seed.join("remote.txt"), "remote\n").expect("remote file");
    run_test_git(&seed, &["add", "remote.txt"]);
    run_test_git(&seed, &["commit", "-m", "remote update"]);
    run_test_git(&seed, &["push"]);
    let old_b_head = test_git_output(&root_b, &["rev-parse", "HEAD"]);

    tauri::async_runtime::block_on(fetch_git_changes(path_string(&root_a), true))
        .expect("fetch workspace A");

    let seed_head = test_git_output(&seed, &["rev-parse", "HEAD"]);
    assert_eq!(
        test_git_output(&root_a, &["rev-parse", "origin/main"]),
        seed_head
    );
    assert_ne!(
        test_git_output(&root_b, &["rev-parse", "origin/main"]),
        seed_head
    );
    assert_eq!(test_git_output(&root_b, &["rev-parse", "HEAD"]), old_b_head);
}

#[test]
fn get_git_status_handles_concurrent_repositories_off_thread() {
    let root_a = temp_workspace("git-concurrent-a");
    let root_b = temp_workspace("git-concurrent-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("a.txt"), "a\n").expect("file a");
    fs::write(root_b.join("b.txt"), "b\n").expect("file b");

    let task_a = tauri::async_runtime::spawn(get_git_status(path_string(&root_a), true));
    let task_b = tauri::async_runtime::spawn(get_git_status(path_string(&root_b), true));

    let status_a = tauri::async_runtime::block_on(task_a)
        .expect("join a")
        .expect("status a");
    let status_b = tauri::async_runtime::block_on(task_b)
        .expect("join b")
        .expect("status b");

    assert!(status_a
        .changes
        .iter()
        .any(|change| change.relative_path == "a.txt"));
    assert!(status_b
        .changes
        .iter()
        .any(|change| change.relative_path == "b.txt"));
}

fn init_test_git_repo(root: &Path) {
    run_test_git(root, &["init"]);
    run_test_git(root, &["config", "user.email", "test@example.com"]);
    run_test_git(root, &["config", "user.name", "Test User"]);
}

fn run_test_git(root: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}

fn test_git_output(root: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
