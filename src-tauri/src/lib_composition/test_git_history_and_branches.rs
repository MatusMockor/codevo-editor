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
fn git_branch_delete_stays_isolated_per_workspace_root_off_thread() {
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

    let list_a = tauri::async_runtime::block_on(list_git_branches(path_string(&root_a), true))
        .expect("list a");
    let list_b = tauri::async_runtime::block_on(list_git_branches(path_string(&root_b), true))
        .expect("list b");
    assert!(!list_a.iter().any(|branch| branch.name == "shared"));
    assert!(list_a.iter().any(|branch| branch.name == "old"));
    assert!(list_b.iter().any(|branch| branch.name == "shared"));
    assert!(list_b.iter().any(|branch| branch.name == "old"));
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
