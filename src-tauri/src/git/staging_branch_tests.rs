use super::*;

#[test]
fn commits_only_staged_content_for_selected_paths() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "test@example.com"]);
    repo.run(["config", "user.name", "Test User"]);
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write("file.txt", "two\n");
    repo.run(["add", "file.txt"]);
    repo.write("file.txt", "three\n");

    let gateway = CommandGitRepositoryGateway::new(true);
    gateway
        .commit(
            repo.path(),
            "selected",
            &[git_changed_file(
                "file.txt",
                true,
                GitChangeStatus::Modified,
            )],
        )
        .expect("commit");

    assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
    assert_eq!(repo.read("file.txt"), "three\n");
}

#[test]
fn does_not_trust_deleted_payload_when_index_has_staged_content() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "test@example.com"]);
    repo.run(["config", "user.name", "Test User"]);
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write("file.txt", "two\n");
    repo.run(["add", "file.txt"]);
    repo.write("file.txt", "three\n");

    let gateway = CommandGitRepositoryGateway::new(true);
    gateway
        .commit(
            repo.path(),
            "selected",
            &[git_changed_file("file.txt", true, GitChangeStatus::Deleted)],
        )
        .expect("commit");

    assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
    assert_eq!(repo.read("file.txt"), "three\n");
}

#[test]
fn derives_staged_rename_from_git_index() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "test@example.com"]);
    repo.run(["config", "user.name", "Test User"]);
    repo.write("old.txt", "one\n");
    repo.run(["add", "old.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["mv", "old.txt", "new.txt"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    gateway
        .commit(
            repo.path(),
            "rename",
            &[git_changed_file("new.txt", true, GitChangeStatus::Modified)],
        )
        .expect("commit");

    assert_eq!(repo.git_output(["show", "HEAD:new.txt"]), "one\n");
    assert!(repo
        .git_output(["ls-tree", "--name-only", "HEAD"])
        .lines()
        .all(|path| path != "old.txt"));
}

#[test]
fn stage_refuses_conflicted_file_with_markers_without_resolving_index() {
    let repo = conflicted_repo();
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");

    let error = gateway
        .stage(repo.path(), &[change])
        .expect_err("conflict markers must block staging");

    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("conflict.txt"));
    assert!(!repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
    assert!(repo
        .git_output(["diff", "--cached", "--name-only", "--", "clean.txt"])
        .is_empty());
}

#[test]
fn stage_refuses_crlf_conflicted_file_with_markers_without_resolving_index() {
    let repo = branch_repo();
    repo.run(["config", "core.autocrlf", "false"]);
    repo.write("conflict.txt", "base\r\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("conflict.txt", "feature\r\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "feature"]);
    repo.run(["checkout", "main"]);
    repo.write("conflict.txt", "main\r\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "main"]);
    repo.merge_expecting_conflict("feature");
    assert!(repo.read("conflict.txt").contains("<<<<<<< HEAD\r\n"));
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");

    let error = gateway
        .stage(repo.path(), &[change])
        .expect_err("CRLF conflict markers must block staging");

    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("conflict.txt"));
    assert!(!repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
}

#[test]
fn stage_refuses_diff3_conflict_then_stages_after_resolution() {
    let repo = branch_repo();
    repo.run(["config", "merge.conflictStyle", "diff3"]);
    repo.write("conflict.txt", "base\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("conflict.txt", "feature\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "feature"]);
    repo.run(["checkout", "main"]);
    repo.write("conflict.txt", "main\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "main"]);
    repo.merge_expecting_conflict("feature");
    assert!(repo.read("conflict.txt").contains("|||||||"));
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");

    let error = gateway
        .stage(repo.path(), std::slice::from_ref(&change))
        .expect_err("diff3 conflict markers must block staging");

    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("conflict.txt"));
    assert!(!repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());

    repo.write("conflict.txt", "resolved\n");
    gateway
        .stage(repo.path(), &[change])
        .expect("mark diff3 conflict resolved");

    assert!(repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
}

#[test]
fn stage_resolves_delete_modify_conflict_as_deletion() {
    let repo = branch_repo();
    repo.write("conflict.txt", "base\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("conflict.txt", "feature\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "modify"]);
    repo.run(["checkout", "main"]);
    repo.run(["rm", "conflict.txt"]);
    repo.run(["commit", "-m", "delete"]);
    repo.merge_expecting_conflict("feature");
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");
    fs::remove_file(repo.path().join("conflict.txt")).expect("choose deletion");

    gateway
        .stage(repo.path(), &[change])
        .expect("stage conflict deletion");

    assert!(repo
        .git_output(["ls-files", "--", "conflict.txt"])
        .is_empty());
    assert!(repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
}

#[test]
fn stage_refuses_unmerged_file_even_when_payload_status_is_stale() {
    let repo = conflicted_repo();
    let gateway = CommandGitRepositoryGateway::new(true);
    let mut change = conflicted_change(&gateway, &repo, "conflict.txt");
    change.status = GitChangeStatus::Modified;

    let error = gateway
        .stage(repo.path(), &[change])
        .expect_err("unmerged index entries must block staging with markers");

    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("conflict.txt"));
    assert!(!repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
}

#[test]
fn stage_marks_resolved_conflicted_file_without_markers() {
    let repo = conflicted_repo();
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");
    repo.write("conflict.txt", "resolved\n");

    let status = gateway
        .stage(repo.path(), &[change])
        .expect("mark conflict resolved");

    assert!(repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
    assert!(status.changes.iter().any(|change| {
        change.relative_path == "conflict.txt"
            && change.status == GitChangeStatus::Modified
            && change.is_staged
    }));
}

#[test]
fn stage_allows_conflicted_file_with_only_a_stray_marker_line() {
    let repo = conflicted_repo();
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = conflicted_change(&gateway, &repo, "conflict.txt");
    repo.write("conflict.txt", "resolved\n<<<<<<< stray text\n");

    gateway
        .stage(repo.path(), &[change])
        .expect("a lone marker is not a conflict block");

    assert!(repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
}

#[test]
fn stage_refuses_mixed_batch_without_partially_mutating_index() {
    let repo = conflicted_repo();
    let gateway = CommandGitRepositoryGateway::new(true);
    repo.write("clean.txt", "changed\n");
    let status = gateway.status(repo.path()).expect("status");
    let changes = [
        status
            .changes
            .iter()
            .find(|change| change.relative_path == "clean.txt")
            .expect("clean change")
            .clone(),
        status
            .changes
            .iter()
            .find(|change| change.relative_path == "conflict.txt")
            .expect("conflicted change")
            .clone(),
    ];

    let error = gateway
        .stage(repo.path(), &changes)
        .expect_err("mixed batch must be atomic");

    assert!(error.to_string().contains("conflict.txt"));
    assert!(!repo
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
    assert!(repo
        .git_output(["diff", "--cached", "--name-only", "--", "clean.txt"])
        .is_empty());
}

#[test]
fn stage_does_not_check_markers_in_non_conflicted_file() {
    let repo = branch_repo();
    repo.write(
        "markers.txt",
        "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n",
    );
    let gateway = CommandGitRepositoryGateway::new(true);
    let change = gateway
        .status(repo.path())
        .expect("status")
        .changes
        .into_iter()
        .find(|change| change.relative_path == "markers.txt")
        .expect("marker-like file");

    let status = gateway
        .stage(repo.path(), &[change])
        .expect("stage non-conflicted marker text");

    assert!(status
        .changes
        .iter()
        .any(|change| { change.relative_path == "markers.txt" && change.is_staged }));
}

#[test]
fn stage_conflict_validation_is_isolated_to_requested_root() {
    let repo_a = conflicted_repo();
    let repo_b = branch_repo();
    repo_b.write(
        "markers.txt",
        "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n",
    );
    let gateway = CommandGitRepositoryGateway::new(true);
    let change_b = gateway
        .status(repo_b.path())
        .expect("repo B status")
        .changes
        .into_iter()
        .find(|change| change.relative_path == "markers.txt")
        .expect("repo B change");

    gateway
        .stage(repo_b.path(), &[change_b])
        .expect("stage in repo B");

    assert!(!repo_a
        .git_output(["ls-files", "-u", "--", "conflict.txt"])
        .is_empty());
    assert_eq!(
        repo_b.git_output(["diff", "--cached", "--name-only"]),
        "markers.txt\n"
    );
}

// --- patch generation (corruption-prone; assert on git's own output) ---

// --- stage_hunk / unstage_hunk round trips through real git ---

#[test]
fn parses_branch_list_marking_the_current_branch() {
    // Layout is `%(HEAD)%(refname:short)`: a one-char flag (`*` for current,
    // a space otherwise) immediately followed by the short name.
    let output = concat!("*main\n", " feature/login\n", " release-1.0\n");

    let branches = parse_branch_list(output);

    assert_eq!(branches.len(), 3);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].is_current);
    assert_eq!(branches[1].name, "feature/login");
    assert!(!branches[1].is_current);
    assert_eq!(branches[2].name, "release-1.0");
    assert!(!branches[2].is_current);
}

#[test]
fn branch_list_pins_the_current_branch_first_keeping_other_order() {
    // git lists refs alphabetically, so the current branch can appear in the
    // middle; the switcher pins it to the top, leaving the rest in order.
    let output = concat!(" alpha\n", "*middle\n", " omega\n");

    let branches = parse_branch_list(output);

    assert_eq!(branches[0].name, "middle");
    assert!(branches[0].is_current);
    assert_eq!(branches[1].name, "alpha");
    assert_eq!(branches[2].name, "omega");
}

#[test]
fn skips_malformed_branch_records() {
    // Blank lines and records whose first column is neither `*` nor space are
    // skipped (defensive against unexpected `for-each-ref` output).
    let output = concat!("\n", "*main\n", "Xbad-flag\n");

    let branches = parse_branch_list(output);

    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].is_current);
}

#[test]
fn safe_branch_name_rejects_injection_and_accepts_valid() {
    assert!(safe_branch_name("feature/login").is_ok());
    assert!(safe_branch_name("release-1.0").is_ok());
    assert!(safe_branch_name("fix_bug").is_ok());
    // Empty / whitespace-only is rejected.
    assert!(safe_branch_name("").is_err());
    assert!(safe_branch_name("   ").is_err());
    // Option/shell injection and invalid ref shapes are rejected.
    assert!(safe_branch_name("--force").is_err());
    assert!(safe_branch_name("-D main").is_err());
    assert!(safe_branch_name("foo; rm -rf /").is_err());
    assert!(safe_branch_name("foo bar").is_err());
    assert!(safe_branch_name("foo..bar").is_err());
    assert!(safe_branch_name("foo~1").is_err());
    assert!(safe_branch_name("foo^").is_err());
    assert!(safe_branch_name("foo:bar").is_err());
    assert!(safe_branch_name("foo?").is_err());
    assert!(safe_branch_name("foo*").is_err());
    assert!(safe_branch_name("foo\\bar").is_err());
    assert!(safe_branch_name("@{-1}").is_err());
}

#[test]
fn remote_branch_list_reports_fetched_branches_without_head_pointer() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
    fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "topic/HEAD"]);
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "topic/HEAD"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

    let branches = CommandGitRepositoryGateway::new(true)
        .remote_branch_list(&fixture.workspace_a)
        .expect("remote branch list");
    let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();

    assert!(names.contains(&"origin/feature-x"));
    assert!(names.contains(&"origin/main"));
    assert!(names.contains(&"origin/topic/HEAD"), "{names:?}");
    assert!(!names.contains(&"origin/HEAD"));
}

#[test]
fn checkout_remote_branch_creates_tracking_branch_and_isolates_workspace() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
    fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

    let branches = CommandGitRepositoryGateway::new(true)
        .checkout_remote_branch(&fixture.workspace_a, "origin/feature-x")
        .expect("checkout remote branch");

    assert!(branches
        .iter()
        .any(|branch| branch.name == "feature-x" && branch.is_current));
    assert_eq!(
        fixture.git_output(&fixture.workspace_a, ["rev-parse", "--abbrev-ref", "@{u}"]),
        "origin/feature-x"
    );
    assert_eq!(
        fixture.git_output(&fixture.workspace_b, ["rev-parse", "--abbrev-ref", "HEAD"]),
        "main"
    );
    assert!(!fixture.workspace_b.join("feature.txt").exists());
}

#[test]
fn checkout_remote_branch_accepts_genuine_branch_ending_in_head() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "topic/HEAD"]);
    fixture.commit_in(&fixture.seed, "topic.txt", "topic\n", "topic");
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "topic/HEAD"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

    let branches = CommandGitRepositoryGateway::new(true)
        .checkout_remote_branch(&fixture.workspace_a, "origin/topic/HEAD")
        .expect("checkout genuine remote branch ending in HEAD");

    assert!(branches
        .iter()
        .any(|branch| branch.name == "topic/HEAD" && branch.is_current));
    assert_eq!(
        fixture.git_output(
            &fixture.workspace_a,
            ["config", "--get", "branch.topic/HEAD.remote"],
        ),
        "origin"
    );
    assert_eq!(
        fixture.git_output(
            &fixture.workspace_a,
            ["config", "--get", "branch.topic/HEAD.merge"],
        ),
        "refs/heads/topic/HEAD"
    );
}

#[test]
fn checkout_remote_branch_surfaces_git_name_collision() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.seed, ["checkout", "-b", "feature-x"]);
    fixture.commit_in(&fixture.seed, "feature.txt", "feature\n", "feature");
    RemoteGitFixture::run_git(&fixture.seed, ["push", "-u", "origin", "feature-x"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);
    RemoteGitFixture::run_git(&fixture.workspace_a, ["branch", "feature-x"]);

    let error = CommandGitRepositoryGateway::new(true)
        .checkout_remote_branch(&fixture.workspace_a, "origin/feature-x")
        .expect_err("name collision");

    assert!(error
        .to_string()
        .contains("a branch named 'feature-x' already exists"));
}

#[test]
fn branch_list_reports_local_branches_with_current_flag() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["branch", "feature"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    let branches = gateway.branch_list(repo.path()).expect("branch list");
    let names: Vec<&str> = branches.iter().map(|branch| branch.name.as_str()).collect();

    assert!(names.contains(&"feature"));
    let current = branches
        .iter()
        .find(|branch| branch.is_current)
        .expect("current");
    // The initial checkout is the default branch (the only one with content).
    assert!(!current.name.is_empty());
    // Exactly one branch is flagged current.
    assert_eq!(
        branches.iter().filter(|branch| branch.is_current).count(),
        1
    );
}

#[test]
fn current_branch_returns_the_checked_out_branch() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["checkout", "-b", "work"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    let current = gateway.current_branch(repo.path()).expect("current branch");

    assert_eq!(current.as_deref(), Some("work"));
}

#[test]
fn create_branch_adds_a_branch_without_switching() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    let before = repo.git_output(["rev-parse", "--abbrev-ref", "HEAD"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    gateway
        .create_branch(repo.path(), "feature/new")
        .expect("create branch");

    // The branch now exists.
    let branches = gateway.branch_list(repo.path()).expect("branch list");
    assert!(branches.iter().any(|branch| branch.name == "feature/new"));
    // HEAD did not move: create must never switch.
    let after = repo.git_output(["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(before, after);
}

#[test]
fn create_branch_rejects_invalid_name() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);

    let gateway = CommandGitRepositoryGateway::new(true);

    assert!(gateway.create_branch(repo.path(), "--force").is_err());
    assert!(gateway.create_branch(repo.path(), "bad name").is_err());
}

#[test]
fn unmerged_branch_delete_has_stable_english_error() {
    let repo = branch_repo();
    repo.write("file.txt", "base\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("file.txt", "feature\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "unmerged feature"]);
    repo.run(["checkout", "main"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    let error = gateway
        .delete_branch(repo.path(), "feature", false)
        .expect_err("unmerged branch delete must fail");

    assert!(
        error.to_string().contains("not fully merged"),
        "unexpected git error: {error}"
    );
}

#[test]
fn switch_branch_moves_head_when_the_working_tree_is_clean() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["branch", "feature"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    gateway
        .switch_branch(repo.path(), "feature")
        .expect("switch branch");

    let current = gateway.current_branch(repo.path()).expect("current branch");
    assert_eq!(current.as_deref(), Some("feature"));
}

#[test]
fn switch_branch_refuses_when_local_changes_would_be_overwritten() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("file.txt", "feature\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "feature change"]);
    repo.run(["checkout", "main"]);
    // A dirty local change that conflicts with the feature branch content.
    repo.write("file.txt", "dirty local\n");

    let gateway = CommandGitRepositoryGateway::new(true);
    let result = gateway.switch_branch(repo.path(), "feature");

    // Switch must FAIL (no `-f`/`--discard`); work is never lost.
    assert!(result.is_err());
    // The working tree change survives the rejected switch.
    assert_eq!(repo.read("file.txt"), "dirty local\n");
    let current = gateway.current_branch(repo.path()).expect("current branch");
    assert_eq!(current.as_deref(), Some("main"));
}

#[test]
fn switch_branch_rejects_invalid_name() {
    let repo = branch_repo();
    repo.write("file.txt", "one\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);

    let gateway = CommandGitRepositoryGateway::new(true);

    assert!(gateway.switch_branch(repo.path(), "--orphan").is_err());
    assert!(gateway
        .switch_branch(repo.path(), "no/such/branch nope")
        .is_err());
}
