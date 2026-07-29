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
fn stage_git_hunk_off_thread_stages_only_requested_repository() {
    let root = temp_workspace("git-stage-hunk-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("f.txt"), "a\nb\nc\nd\ne\n").expect("write");
    run_test_git(&root, &["add", "f.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("f.txt"), "A\nb\nc\nd\nE\n").expect("modify");

    let hunks = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        false,
        true,
    ))
    .expect("hunks");
    assert_eq!(hunks.len(), 2, "expected two hunks, got {hunks:?}");

    tauri::async_runtime::block_on(stage_git_hunk(
        path_string(&root),
        "f.txt".to_string(),
        0,
        hunks[0].identity.clone(),
        true,
    ))
    .expect("stage hunk");

    // Partial staging: exactly the first hunk moved to the index while the
    // last hunk remains in the worktree diff. `git status --porcelain`
    // collapses both sides into one `MM` entry, so verify the split
    // directly through the staged/worktree hunk views.
    let staged = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        true,
        true,
    ))
    .expect("staged hunks");
    let worktree = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        false,
        true,
    ))
    .expect("worktree hunks");

    assert_eq!(staged.len(), 1, "expected one staged hunk, got {staged:?}");
    assert!(staged[0].lines.contains(&"+A".to_string()));
    assert_eq!(
        worktree.len(),
        1,
        "expected one remaining worktree hunk, got {worktree:?}"
    );
    assert!(worktree[0].lines.contains(&"+E".to_string()));
}

#[test]
fn unstage_git_hunk_off_thread_unstages_only_selected_hunk() {
    let root = temp_workspace("git-unstage-hunk-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("f.txt"), "a\nb\nc\nd\ne\n").expect("write");
    run_test_git(&root, &["add", "f.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("f.txt"), "A\nb\nc\nd\nE\n").expect("modify");
    run_test_git(&root, &["add", "f.txt"]);

    let before = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        true,
        true,
    ))
    .expect("staged hunks before unstage");

    tauri::async_runtime::block_on(unstage_git_hunk(
        path_string(&root),
        "f.txt".to_string(),
        0,
        before[0].identity.clone(),
        true,
    ))
    .expect("unstage hunk");

    // Only the first staged hunk dropped back to the worktree; the other
    // stays in the index. Verify via the staged/worktree hunk views since
    // porcelain collapses the file into a single entry.
    let staged = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        true,
        true,
    ))
    .expect("staged hunks");
    let worktree = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        false,
        true,
    ))
    .expect("worktree hunks");

    assert_eq!(
        staged.len(),
        1,
        "expected one staged hunk left, got {staged:?}"
    );
    assert!(staged[0].lines.contains(&"+E".to_string()));
    assert_eq!(
        worktree.len(),
        1,
        "expected the unstaged hunk back in the worktree, got {worktree:?}"
    );
    assert!(worktree[0].lines.contains(&"+A".to_string()));
}

#[test]
fn revert_git_hunk_off_thread_reverts_only_selected_worktree_hunk() {
    let root = temp_workspace("git-revert-hunk-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("f.txt"), "a\nb\nc\nd\ne\n").expect("write");
    run_test_git(&root, &["add", "f.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("f.txt"), "A\nb\nc\nd\ne\n").expect("stage change");
    run_test_git(&root, &["add", "f.txt"]);
    fs::write(root.join("f.txt"), "A\nb\nC\nd\nE\n").expect("worktree changes");

    let before = tauri::async_runtime::block_on(get_git_file_hunks(
        path_string(&root),
        "f.txt".to_string(),
        false,
        true,
    ))
    .expect("worktree hunks before revert");

    tauri::async_runtime::block_on(revert_git_hunk(
        path_string(&root),
        "f.txt".to_string(),
        0,
        before[0].identity.clone(),
        true,
    ))
    .expect("revert hunk");

    assert_eq!(
        fs::read_to_string(root.join("f.txt")).expect("worktree"),
        "A\nb\nc\nd\nE\n"
    );
    assert_eq!(test_git_output(&root, &["show", ":f.txt"]), "A\nb\nc\nd\ne");
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
fn amend_git_commit_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-amend-iso-a");
    let root_b = temp_workspace("git-amend-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("tracked.txt"), "one\n").expect("file a");
    fs::write(root_b.join("tracked.txt"), "one\n").expect("file b");
    run_test_git(&root_a, &["add", "tracked.txt"]);
    run_test_git(&root_b, &["add", "tracked.txt"]);
    run_test_git(&root_a, &["commit", "-m", "initial a"]);
    run_test_git(&root_b, &["commit", "-m", "initial b"]);
    let old_a_head = test_git_output(&root_a, &["rev-parse", "HEAD"]);
    let old_b_head = test_git_output(&root_b, &["rev-parse", "HEAD"]);
    fs::write(root_a.join("tracked.txt"), "two\n").expect("change a");
    run_test_git(&root_a, &["add", "tracked.txt"]);
    let change = crate::git::GitChangedFile {
        is_staged: true,
        is_unversioned: false,
        old_path: None,
        old_relative_path: None,
        path: path_string(&root_a.join("tracked.txt")),
        relative_path: "tracked.txt".to_string(),
        status: crate::git::GitChangeStatus::Modified,
    };

    tauri::async_runtime::block_on(amend_git_commit(
        path_string(&root_a),
        "amended a".to_string(),
        vec![change],
        true,
    ))
    .expect("amend workspace A");

    assert_ne!(test_git_output(&root_a, &["rev-parse", "HEAD"]), old_a_head);
    assert_eq!(test_git_output(&root_b, &["rev-parse", "HEAD"]), old_b_head);
    assert_eq!(
        test_git_output(&root_a, &["show", "HEAD:tracked.txt"]),
        "two"
    );
    assert_eq!(
        test_git_output(&root_b, &["show", "HEAD:tracked.txt"]),
        "one"
    );
}

#[test]
fn reword_git_commit_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-reword-iso-a");
    let root_b = temp_workspace("git-reword-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("tracked.txt"), "one\n").expect("file a");
    fs::write(root_b.join("tracked.txt"), "one\n").expect("file b");
    run_test_git(&root_a, &["add", "tracked.txt"]);
    run_test_git(&root_b, &["add", "tracked.txt"]);
    run_test_git(&root_a, &["commit", "-m", "initial a"]);
    run_test_git(&root_b, &["commit", "-m", "initial b"]);
    let old_a_head = test_git_output(&root_a, &["rev-parse", "HEAD"]);
    let old_b_head = test_git_output(&root_b, &["rev-parse", "HEAD"]);

    let commit = tauri::async_runtime::block_on(reword_git_commit(
        path_string(&root_a),
        old_a_head.clone(),
        "reworded a".to_string(),
        true,
    ))
    .expect("reword workspace A");

    assert_ne!(commit.hash, old_a_head);
    assert_eq!(test_git_output(&root_b, &["rev-parse", "HEAD"]), old_b_head);
    assert_eq!(
        test_git_output(&root_a, &["log", "-1", "--format=%B"]),
        "reworded a"
    );
    assert_eq!(
        test_git_output(&root_b, &["log", "-1", "--format=%B"]),
        "initial b"
    );
}

#[test]
fn fetch_and_pull_stay_isolated_per_workspace_root_off_thread() {
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
    tauri::async_runtime::block_on(pull_git_changes(path_string(&root_a), true))
        .expect("pull workspace A");

    assert_eq!(
        fs::read_to_string(root_a.join("remote.txt")).expect("workspace A file"),
        "remote\n"
    );
    assert!(!root_b.join("remote.txt").exists());
    assert_eq!(test_git_output(&root_b, &["rev-parse", "HEAD"]), old_b_head);

    run_test_git(&root_b, &["config", "user.email", "test@example.com"]);
    run_test_git(&root_b, &["config", "user.name", "Test User"]);
    fs::write(root_b.join("local.txt"), "local\n").expect("local file");
    run_test_git(&root_b, &["add", "local.txt"]);
    run_test_git(&root_b, &["commit", "-m", "local update"]);
    let diverged_head = test_git_output(&root_b, &["rev-parse", "HEAD"]);

    let error = tauri::async_runtime::block_on(pull_git_changes(path_string(&root_b), true))
        .expect_err("diverged pull must fail");

    assert!(error.to_lowercase().contains("fast-forward"));
    assert_eq!(
        test_git_output(&root_b, &["rev-parse", "HEAD"]),
        diverged_head
    );
    assert!(!root_b.join("remote.txt").exists());
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

#[test]
fn get_git_blame_reports_per_line_authors_off_thread() {
    let root = temp_workspace("git-blame-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("file.txt"), "alpha\nbeta\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);

    let lines = tauri::async_runtime::block_on(get_git_blame(
        path_string(&root),
        "file.txt".to_string(),
        true,
    ))
    .expect("blame result");

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line_number, 1);
    assert_eq!(lines[0].author, "Test User");
    assert!(!lines[0].sha.is_empty());
    assert_eq!(lines[1].line_number, 2);
}

#[test]
fn git_blame_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-blame-iso-a");
    let root_b = temp_workspace("git-blame-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    run_test_git(&root_a, &["config", "user.name", "Author A"]);
    run_test_git(&root_b, &["config", "user.name", "Author B"]);
    fs::write(root_a.join("shared.txt"), "from a\n").expect("file in a");
    fs::write(root_b.join("shared.txt"), "from b\n").expect("file in b");
    run_test_git(&root_a, &["add", "shared.txt"]);
    run_test_git(&root_a, &["commit", "-m", "a commit"]);
    run_test_git(&root_b, &["add", "shared.txt"]);
    run_test_git(&root_b, &["commit", "-m", "b commit"]);

    let blame_a = tauri::async_runtime::block_on(get_git_blame(
        path_string(&root_a),
        "shared.txt".to_string(),
        true,
    ))
    .expect("blame a");
    let blame_b = tauri::async_runtime::block_on(get_git_blame(
        path_string(&root_b),
        "shared.txt".to_string(),
        true,
    ))
    .expect("blame b");

    assert_eq!(blame_a[0].author, "Author A");
    assert_eq!(blame_b[0].author, "Author B");
    assert_ne!(blame_a[0].sha, blame_b[0].sha, "no cross-root leakage");
}

#[test]
fn get_git_file_history_lists_commits_off_thread() {
    let root = temp_workspace("git-file-history-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "first commit"]);
    fs::write(root.join("file.txt"), "one\ntwo\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "second commit"]);

    let entries = tauri::async_runtime::block_on(get_git_file_history(
        path_string(&root),
        "file.txt".to_string(),
        true,
    ))
    .expect("file history result");

    assert_eq!(entries.len(), 2);
    // Newest commit first (git log default ordering).
    assert_eq!(entries[0].subject, "second commit");
    assert_eq!(entries[1].subject, "first commit");
    assert_eq!(entries[0].author, "Test User");
    assert!(!entries[0].sha.is_empty());
}

#[test]
fn get_git_file_history_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-file-history-iso-a");
    let root_b = temp_workspace("git-file-history-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("shared.txt"), "from a\n").expect("file in a");
    fs::write(root_b.join("shared.txt"), "from b\n").expect("file in b");
    run_test_git(&root_a, &["add", "shared.txt"]);
    run_test_git(&root_a, &["commit", "-m", "a commit"]);
    run_test_git(&root_b, &["add", "shared.txt"]);
    run_test_git(&root_b, &["commit", "-m", "b commit"]);

    let history_a = tauri::async_runtime::block_on(get_git_file_history(
        path_string(&root_a),
        "shared.txt".to_string(),
        true,
    ))
    .expect("history a");
    let history_b = tauri::async_runtime::block_on(get_git_file_history(
        path_string(&root_b),
        "shared.txt".to_string(),
        true,
    ))
    .expect("history b");

    assert_eq!(history_a[0].subject, "a commit");
    assert_eq!(history_b[0].subject, "b commit");
    assert_ne!(history_a[0].sha, history_b[0].sha, "no cross-root leakage");
}
