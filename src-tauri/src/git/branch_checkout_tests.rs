#[test]
fn switch_branch_rejects_parent_repository_fallback() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["branch", "feature"]);
    fs::create_dir(repo.path().join("nested")).unwrap();
    let gateway = CommandGitRepositoryGateway::new(true);
    assert!(gateway
        .switch_branch(&repo.path().join("nested"), "feature")
        .is_err());
    assert_eq!(
        gateway.current_branch(repo.path()).unwrap().as_deref(),
        Some("main")
    );
}

#[test]
fn switch_branch_updates_only_the_selected_linked_worktree() {
    let repo = branch_repo();
    repo.write("file.txt", "main\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["branch", "feature"]);
    let worktree = repo.path().join("linked");
    repo.run(["worktree", "add", "-b", "other", worktree.to_str().unwrap()]);
    let gateway = CommandGitRepositoryGateway::new(true);
    gateway.switch_branch(&worktree, "feature").unwrap();
    assert_eq!(
        gateway.current_branch(&worktree).unwrap().as_deref(),
        Some("feature")
    );
    assert_eq!(
        gateway.current_branch(repo.path()).unwrap().as_deref(),
        Some("main")
    );
    assert!(gateway.switch_branch(repo.path(), "feature").is_err());
}

#[test]
fn switch_branch_never_guesses_a_remote_branch() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
    fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch"]);
    let gateway = CommandGitRepositoryGateway::new(true);
    assert!(gateway
        .switch_branch(&fixture.workspace_a, "feature-x")
        .is_err());
    assert_eq!(
        gateway
            .current_branch(&fixture.workspace_a)
            .unwrap()
            .as_deref(),
        Some("main")
    );
    assert!(gateway
        .checkout_remote_branch(&fixture.workspace_a, "origin/HEAD")
        .is_err());
}

#[test]
fn switch_branch_rejects_oversized_names_before_running_git() {
    assert!(CommandGitRepositoryGateway::new(true)
        .switch_branch(Path::new("/nonexistent"), &"x".repeat(1025))
        .unwrap_err()
        .to_string()
        .contains("branch name is invalid"));
}

#[test]
fn switch_branch_replaces_the_selected_repository_files() {
    let repo = branch_repo();
    repo.write("main.txt", "main\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["switch", "-c", "feature"]);
    repo.run(["rm", "main.txt"]);
    repo.write("feature.txt", "feature\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "feature files"]);
    repo.run(["switch", "main"]);
    CommandGitRepositoryGateway::new(true)
        .switch_branch(repo.path(), "feature")
        .unwrap();
    assert!(!repo.path().join("main.txt").exists());
    assert_eq!(repo.read("feature.txt"), "feature\n");
}

#[cfg(unix)]
#[test]
fn checkout_branch_receipt_rejects_replaced_repository_path() {
    let repo = branch_repo();
    repo.write("main.txt", "main\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["branch", "feature"]);
    let checkout = super::branch_checkout::checkout(
        repo.path(),
        "feature",
        super::branch_checkout::CheckoutBranchKind::Local,
        true,
    )
    .unwrap();
    let original_path = repo.path().to_path_buf();
    let moved_path = original_path.with_extension("checkout-moved");
    fs::rename(&original_path, &moved_path).unwrap();
    fs::create_dir(&original_path).unwrap();
    assert!(checkout
        .branches(true)
        .unwrap_err()
        .to_string()
        .contains("directory changed"));
    fs::remove_dir_all(moved_path).unwrap();
}
