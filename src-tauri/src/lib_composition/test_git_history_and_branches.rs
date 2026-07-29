#[test]
fn get_git_file_history_rejects_paths_outside_workspace_off_thread() {
    let root = temp_workspace("git-file-history-escape");
    init_test_git_repo(&root);

    assert!(tauri::async_runtime::block_on(get_git_file_history(
        path_string(&root),
        "../secret.txt".to_string(),
        true
    ))
    .is_err());
}

#[test]
fn git_stash_save_list_pop_round_trip_off_thread() {
    let root = temp_workspace("git-stash-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("file.txt"), "two\n").expect("write file");

    tauri::async_runtime::block_on(save_git_stash(path_string(&root), "wip".to_string(), true))
        .expect("stash save");

    let entries = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root), true))
        .expect("stash list");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].index, 0);

    let diff = tauri::async_runtime::block_on(get_git_stash_diff(
        path_string(&root),
        "0".to_string(),
        true,
    ))
    .expect("stash diff");
    assert!(diff.contains("file.txt"));

    tauri::async_runtime::block_on(stash_pop_git(path_string(&root), "0".to_string(), true))
        .expect("stash pop");

    assert_eq!(
        fs::read_to_string(root.join("file.txt")).expect("read"),
        "two\n"
    );
    let remaining = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root), true))
        .expect("stash list");
    assert!(remaining.is_empty());
}

#[test]
fn git_stash_apply_keeps_entry_and_drop_removes_it_off_thread() {
    let root = temp_workspace("git-stash-apply-drop-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    fs::write(root.join("file.txt"), "two\n").expect("write file");

    tauri::async_runtime::block_on(save_git_stash(path_string(&root), "wip".to_string(), true))
        .expect("stash save");
    tauri::async_runtime::block_on(stash_apply_git(path_string(&root), "0".to_string(), true))
        .expect("stash apply");

    // apply keeps the entry around.
    let entries = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root), true))
        .expect("stash list");
    assert_eq!(entries.len(), 1);

    tauri::async_runtime::block_on(stash_drop_git(path_string(&root), "0".to_string(), true))
        .expect("stash drop");

    let remaining = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root), true))
        .expect("stash list");
    assert!(remaining.is_empty());
}

#[test]
fn git_stash_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-stash-iso-a");
    let root_b = temp_workspace("git-stash-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    fs::write(root_a.join("shared.txt"), "base a\n").expect("file a");
    fs::write(root_b.join("shared.txt"), "base b\n").expect("file b");
    run_test_git(&root_a, &["add", "shared.txt"]);
    run_test_git(&root_a, &["commit", "-m", "a"]);
    run_test_git(&root_b, &["add", "shared.txt"]);
    run_test_git(&root_b, &["commit", "-m", "b"]);
    fs::write(root_a.join("shared.txt"), "wip a\n").expect("file a");

    // Only root A has a stash; root B's list must stay empty (no leakage).
    tauri::async_runtime::block_on(save_git_stash(
        path_string(&root_a),
        "wip a".to_string(),
        true,
    ))
    .expect("stash save a");

    let list_a = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root_a), true))
        .expect("list a");
    let list_b = tauri::async_runtime::block_on(get_git_stash_list(path_string(&root_b), true))
        .expect("list b");

    assert_eq!(list_a.len(), 1);
    assert!(list_b.is_empty(), "no cross-root stash leakage");
}

#[test]
fn git_stash_diff_rejects_non_numeric_index_off_thread() {
    let root = temp_workspace("git-stash-bad-index");
    init_test_git_repo(&root);

    assert!(tauri::async_runtime::block_on(get_git_stash_diff(
        path_string(&root),
        "0} --output=/etc/passwd".to_string(),
        true
    ))
    .is_err());
}

#[test]
fn git_branch_create_list_switch_round_trip_off_thread() {
    let root = temp_workspace("git-branch-off-thread");
    init_test_git_repo(&root);
    run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);

    tauri::async_runtime::block_on(create_git_branch(
        path_string(&root),
        "feature/login".to_string(),
        true,
    ))
    .expect("create branch");

    let branches =
        tauri::async_runtime::block_on(list_git_branches(path_string(&root), true)).expect("list");
    let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();
    assert!(names.contains(&"feature/login"));
    assert!(names.contains(&"main"));
    // create must NOT switch: HEAD is still on main.
    let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root), true))
        .expect("current");
    assert_eq!(current.as_deref(), Some("main"));

    tauri::async_runtime::block_on(switch_git_branch(
        path_string(&root),
        "feature/login".to_string(),
        true,
    ))
    .expect("switch branch");

    let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root), true))
        .expect("current");
    assert_eq!(current.as_deref(), Some("feature/login"));
}

#[test]
fn git_branch_switch_refuses_to_discard_uncommitted_changes_off_thread() {
    let root = temp_workspace("git-branch-switch-safety");
    init_test_git_repo(&root);
    run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    run_test_git(&root, &["checkout", "-b", "feature"]);
    fs::write(root.join("file.txt"), "feature\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "feature"]);
    run_test_git(&root, &["checkout", "main"]);
    // Dirty local change that conflicts with the feature branch content.
    fs::write(root.join("file.txt"), "dirty\n").expect("write file");

    let result = tauri::async_runtime::block_on(switch_git_branch(
        path_string(&root),
        "feature".to_string(),
        true,
    ));

    // The switch must FAIL rather than discard the uncommitted change.
    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(root.join("file.txt")).expect("read"),
        "dirty\n"
    );
    let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root), true))
        .expect("current");
    assert_eq!(current.as_deref(), Some("main"));
}

#[test]
fn git_branch_create_rejects_injection_off_thread() {
    let root = temp_workspace("git-branch-bad-name");
    init_test_git_repo(&root);
    run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);

    assert!(tauri::async_runtime::block_on(create_git_branch(
        path_string(&root),
        "--force".to_string(),
        true
    ))
    .is_err());
    assert!(tauri::async_runtime::block_on(switch_git_branch(
        path_string(&root),
        "foo; rm -rf /".to_string(),
        true
    ))
    .is_err());
}

#[test]
fn git_branches_stay_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-branch-iso-a");
    let root_b = temp_workspace("git-branch-iso-b");
    init_test_git_repo(&root_a);
    init_test_git_repo(&root_b);
    run_test_git(&root_a, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    run_test_git(&root_b, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root_a.join("a.txt"), "a\n").expect("file a");
    fs::write(root_b.join("b.txt"), "b\n").expect("file b");
    run_test_git(&root_a, &["add", "a.txt"]);
    run_test_git(&root_a, &["commit", "-m", "a"]);
    run_test_git(&root_b, &["add", "b.txt"]);
    run_test_git(&root_b, &["commit", "-m", "b"]);

    // A branch created in root A must never appear in root B's list.
    tauri::async_runtime::block_on(create_git_branch(
        path_string(&root_a),
        "only-in-a".to_string(),
        true,
    ))
    .expect("create in a");

    let list_a = tauri::async_runtime::block_on(list_git_branches(path_string(&root_a), true))
        .expect("list a");
    let list_b = tauri::async_runtime::block_on(list_git_branches(path_string(&root_b), true))
        .expect("list b");

    assert!(list_a.iter().any(|branch| branch.name == "only-in-a"));
    assert!(
        !list_b.iter().any(|branch| branch.name == "only-in-a"),
        "no cross-root branch leakage"
    );
}

#[test]
fn git_branch_delete_and_rename_stay_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("git-branch-mutate-iso-a");
    let root_b = temp_workspace("git-branch-mutate-iso-b");
    for root in [&root_a, &root_b] {
        init_test_git_repo(root);
        run_test_git(root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        fs::write(root.join("file.txt"), "base\n").expect("write file");
        run_test_git(root, &["add", "file.txt"]);
        run_test_git(root, &["commit", "-m", "initial"]);
        run_test_git(root, &["branch", "shared"]);
        run_test_git(root, &["branch", "old"]);
    }

    tauri::async_runtime::block_on(delete_git_branch(
        path_string(&root_a),
        "shared".to_string(),
        false,
        true,
    ))
    .expect("delete in a");
    tauri::async_runtime::block_on(rename_git_branch(
        path_string(&root_a),
        "old".to_string(),
        "new".to_string(),
        true,
    ))
    .expect("rename in a");

    let list_a = tauri::async_runtime::block_on(list_git_branches(path_string(&root_a), true))
        .expect("list a");
    let list_b = tauri::async_runtime::block_on(list_git_branches(path_string(&root_b), true))
        .expect("list b");
    assert!(!list_a.iter().any(|branch| branch.name == "shared"));
    assert!(list_a.iter().any(|branch| branch.name == "new"));
    assert!(list_b.iter().any(|branch| branch.name == "shared"));
    assert!(list_b.iter().any(|branch| branch.name == "old"));
    assert!(!list_b.iter().any(|branch| branch.name == "new"));
}

#[test]
fn git_branch_delete_refuses_current_and_requires_force_for_unmerged_off_thread() {
    let root = temp_workspace("git-branch-delete-safety");
    init_test_git_repo(&root);
    run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root.join("file.txt"), "base\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);

    let current_error = tauri::async_runtime::block_on(delete_git_branch(
        path_string(&root),
        "main".to_string(),
        true,
        true,
    ))
    .expect_err("current branch deletion must fail");
    assert!(current_error.to_lowercase().contains("cannot delete"));

    run_test_git(&root, &["checkout", "-b", "unmerged"]);
    fs::write(root.join("work.txt"), "work\n").expect("write work");
    run_test_git(&root, &["add", "work.txt"]);
    run_test_git(&root, &["commit", "-m", "unmerged"]);
    run_test_git(&root, &["checkout", "main"]);

    let unmerged_error = tauri::async_runtime::block_on(delete_git_branch(
        path_string(&root),
        "unmerged".to_string(),
        false,
        true,
    ))
    .expect_err("unmerged branch deletion must fail");
    assert!(unmerged_error.to_lowercase().contains("not fully merged"));
    tauri::async_runtime::block_on(delete_git_branch(
        path_string(&root),
        "unmerged".to_string(),
        true,
        true,
    ))
    .expect("forced delete");
}

#[test]
fn git_branch_rename_refuses_collision_and_allows_current_off_thread() {
    let root = temp_workspace("git-branch-rename-safety");
    init_test_git_repo(&root);
    run_test_git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(root.join("file.txt"), "base\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "initial"]);
    run_test_git(&root, &["branch", "existing"]);

    let collision = tauri::async_runtime::block_on(rename_git_branch(
        path_string(&root),
        "main".to_string(),
        "existing".to_string(),
        true,
    ))
    .expect_err("rename collision must fail");
    assert!(collision.to_lowercase().contains("already exists"));

    tauri::async_runtime::block_on(rename_git_branch(
        path_string(&root),
        "main".to_string(),
        "renamed".to_string(),
        true,
    ))
    .expect("rename current");
    let current = tauri::async_runtime::block_on(get_git_current_branch(path_string(&root), true))
        .expect("current branch");
    assert_eq!(current.as_deref(), Some("renamed"));
}
