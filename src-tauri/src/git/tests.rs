include!("history_graph_tests.rs");
include!("branch_checkout_tests.rs");
use super::{
    detect_git_repositories, git_command, load_commit_details, load_commit_diff, load_commit_files,
    load_commit_log, parse_branch_list, parse_porcelain_status, read_git_object_content,
    safe_branch_name, safe_commit_sha, safe_relative_path, BoundedContent,
    CommandGitRepositoryGateway, GitChangeStatus, GitChangedFile, GitCommitFilters,
    GitDiffPreviewUnavailableReason, GitRepositoryGateway, DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH,
    MAX_DIFF_SNAPSHOT_BYTES,
};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

/// Guarantees a distinct temp-repo path for every `TestGitRepo`, even when
/// the platform clock is too coarse to disambiguate concurrent tests.
static TEST_REPO_COUNTER: AtomicU64 = AtomicU64::new(0);

#[path = "staging_branch_tests.rs"]
mod staging_branch;

#[test]
fn untrusted_git_command_injects_exec_neutralizing_config() {
    let command = git_command(false);
    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    assert_eq!(
        args,
        [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "diff.external=",
            "-c",
            "filter.lfs.smudge=",
            "-c",
            "filter.lfs.clean=",
            "-c",
            "filter.lfs.process=",
            "-c",
            "filter.lfs.required=false",
        ]
    );
}

#[test]
fn trusted_git_command_keeps_argv_byte_identical() {
    assert!(git_command(true).get_args().next().is_none());
}

#[cfg(unix)]
#[test]
fn untrusted_status_disables_core_fsmonitor_hook() {
    let repo = TestGitRepo::new();
    let sentinel = repo.path().join("fsmonitor-ran");
    let fsmonitor = repo.path().join("fsmonitor.sh");
    write_executable_script(
        &fsmonitor,
        &format!("#!/bin/sh\ntouch '{}'\nprintf '\\n'\n", sentinel.display()),
    );
    repo.run([
        "config",
        "core.fsmonitor",
        fsmonitor.to_str().expect("fsmonitor path"),
    ]);

    CommandGitRepositoryGateway::new(false)
        .status(repo.path())
        .expect("untrusted status");

    assert!(!sentinel.exists(), "untrusted status ran core.fsmonitor");
}

#[cfg(unix)]
#[test]
fn trusted_status_preserves_core_fsmonitor_hook() {
    let repo = TestGitRepo::new();
    let sentinel = repo.path().join("fsmonitor-ran");
    let fsmonitor = repo.path().join("fsmonitor.sh");
    write_executable_script(
        &fsmonitor,
        &format!("#!/bin/sh\ntouch '{}'\nprintf '\\n'\n", sentinel.display()),
    );
    repo.run([
        "config",
        "core.fsmonitor",
        fsmonitor.to_str().expect("fsmonitor path"),
    ]);

    CommandGitRepositoryGateway::new(true)
        .status(repo.path())
        .expect("trusted status");

    assert!(
        sentinel.exists(),
        "trusted status did not run core.fsmonitor"
    );
}

#[cfg(unix)]
#[test]
fn untrusted_commit_disables_pre_commit_hook_with_dev_null_hooks_path() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "hooks@example.com"]);
    repo.run(["config", "user.name", "Hook Tester"]);
    repo.write("tracked.txt", "content\n");
    repo.run(["add", "tracked.txt"]);
    let sentinel = repo.path().join("pre-commit-ran");
    write_executable_script(
        &repo.path().join(".git/hooks/pre-commit"),
        &format!("#!/bin/sh\ntouch '{}'\n", sentinel.display()),
    );

    let output = git_command(false)
        .arg("-C")
        .arg(repo.path())
        .args(["commit", "-m", "hook test"])
        .output()
        .expect("untrusted commit");

    assert!(
        output.status.success(),
        "untrusted commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!sentinel.exists(), "untrusted commit ran pre-commit hook");
}

#[cfg(unix)]
#[test]
fn untrusted_stage_disables_lfs_clean_smudge_and_process_filters() {
    let repo = TestGitRepo::new();
    let sentinel = repo.path().join("lfs-filter-ran");
    let filter = repo.path().join("lfs-filter.sh");
    write_executable_script(
        &filter,
        &format!("#!/bin/sh\ntouch '{}'\ncat\n", sentinel.display()),
    );
    repo.write(".gitattributes", "*.bin filter=lfs\n");
    repo.write("asset.bin", "content\n");
    for key in [
        "filter.lfs.clean",
        "filter.lfs.smudge",
        "filter.lfs.process",
    ] {
        repo.run(["config", key, filter.to_str().expect("filter path")]);
    }

    CommandGitRepositoryGateway::new(false)
        .stage(
            repo.path(),
            &[git_changed_file(
                "asset.bin",
                false,
                GitChangeStatus::Untracked,
            )],
        )
        .expect("untrusted stage");

    assert!(!sentinel.exists(), "untrusted stage ran an LFS filter");
}

#[cfg(unix)]
fn write_executable_script(path: &Path, content: &str) {
    use std::os::unix::fs::PermissionsExt;

    fs::write(path, content).expect("write executable script");
    let mut permissions = fs::metadata(path).expect("script metadata").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).expect("make script executable");
}

#[test]
fn commit_log_returns_empty_for_unborn_head() {
    let repo = TestGitRepo::new();

    let commits = load_commit_log(repo.path(), empty_commit_filters(), true).expect("commit log");

    assert!(commits.is_empty());
}

#[test]
fn fetch_updates_only_the_requested_workspace() {
    let fixture = RemoteGitFixture::new();
    fixture.commit_and_push("remote.txt", "remote\n", "remote update");
    let gateway = CommandGitRepositoryGateway::new(true);
    let old_b_head = fixture.git_output(&fixture.workspace_b, ["rev-parse", "HEAD"]);

    gateway
        .fetch(&fixture.workspace_a)
        .expect("fetch workspace A");

    assert_eq!(
        fixture.git_output(&fixture.workspace_a, ["rev-parse", "origin/main"]),
        fixture.git_output(&fixture.seed, ["rev-parse", "HEAD"])
    );
    assert_eq!(
        fixture.git_output(&fixture.workspace_b, ["rev-parse", "HEAD"]),
        old_b_head
    );
    assert!(!fixture.workspace_b.join("remote.txt").exists());
}

#[test]
fn status_reports_behind_upstream_after_fetch() {
    let fixture = RemoteGitFixture::new();
    fixture.commit_and_push("remote-one.txt", "one\n", "remote one");
    fixture.commit_and_push("remote-two.txt", "two\n", "remote two");
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

    let raw_counts = fixture.git_output(
        &fixture.workspace_a,
        ["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    );
    let status = CommandGitRepositoryGateway::new(true)
        .status(&fixture.workspace_a)
        .expect("status");

    assert_eq!(raw_counts, "2\t0");
    assert_eq!(
        status.upstream,
        Some(super::GitUpstreamTracking {
            branch: "origin/main".to_string(),
            ahead: 0,
            behind: 2,
        })
    );
}

#[test]
fn status_reports_ahead_upstream_after_local_commits() {
    let fixture = RemoteGitFixture::new();
    fixture.commit_in(&fixture.workspace_a, "local-one.txt", "one\n", "local one");
    fixture.commit_in(&fixture.workspace_a, "local-two.txt", "two\n", "local two");

    let status = CommandGitRepositoryGateway::new(true)
        .status(&fixture.workspace_a)
        .expect("status");
    let upstream = status.upstream.expect("upstream");

    assert_eq!(upstream.ahead, 2);
    assert_eq!(upstream.behind, 0);
}

#[test]
fn status_reports_diverged_upstream() {
    let fixture = RemoteGitFixture::new();
    fixture.commit_in(&fixture.workspace_a, "local.txt", "local\n", "local");
    fixture.commit_and_push("remote.txt", "remote\n", "remote");
    RemoteGitFixture::run_git(&fixture.workspace_a, ["fetch", "--prune"]);

    let status = CommandGitRepositoryGateway::new(true)
        .status(&fixture.workspace_a)
        .expect("status");
    let upstream = status.upstream.expect("upstream");

    assert_eq!(upstream.ahead, 1);
    assert_eq!(upstream.behind, 1);
}

#[test]
fn status_omits_tracking_without_upstream_or_on_detached_head() {
    let fixture = RemoteGitFixture::new();
    RemoteGitFixture::run_git(&fixture.workspace_a, ["branch", "--unset-upstream"]);

    let status = CommandGitRepositoryGateway::new(true)
        .status(&fixture.workspace_a)
        .expect("status");

    assert_eq!(status.upstream, None);

    RemoteGitFixture::run_git(&fixture.workspace_a, ["checkout", "--detach"]);
    let detached = CommandGitRepositoryGateway::new(true)
        .status(&fixture.workspace_a)
        .expect("detached status");

    assert_eq!(detached.branch, None);
    assert_eq!(detached.upstream, None);
}

#[test]
fn commit_log_lists_commits_from_real_repository() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "history@example.com"]);
    repo.run(["config", "user.name", "History Author"]);
    repo.write("file.txt", "first\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "first commit"]);
    repo.write("file.txt", "second\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "second commit"]);

    let commits = load_commit_log(repo.path(), empty_commit_filters(), true).expect("commit log");

    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].subject, "second commit");
    assert_eq!(commits[0].author_name, "History Author");
    assert_eq!(commits[0].author_email, "history@example.com");
    assert_eq!(commits[1].subject, "first commit");
    assert_eq!(commits[0].parents.len(), 1);
    assert!(commits[0].hash.len() >= 40);
    assert!(commits
        .iter()
        .all(|commit| commit.hash.chars().all(|value| !value.is_whitespace())));
}

#[test]
fn commit_log_uses_cursor_as_skip_offset() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "history@example.com"]);
    repo.run(["config", "user.name", "History Author"]);
    repo.write("file.txt", "first\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "first commit"]);
    repo.write("file.txt", "second\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "second commit"]);

    let commits = load_commit_log(
        repo.path(),
        GitCommitFilters {
            cursor: Some("1".to_string()),
            limit: Some(1),
            ..empty_commit_filters()
        },
        true,
    )
    .expect("commit log");

    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].subject, "first commit");
}

#[test]
fn commit_details_loads_metadata_from_real_repository() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "details@example.com"]);
    repo.run(["config", "user.name", "Details Author"]);
    repo.write("file.txt", "details\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "subject line", "-m", "body line"]);
    let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();

    let details = load_commit_details(repo.path(), &sha, true).expect("details");

    assert_eq!(details.commit.subject, "subject line");
    assert_eq!(details.commit.author_name, "Details Author");
    assert_eq!(details.commit.author_email, "details@example.com");
    assert_eq!(details.body, "subject line\n\nbody line");
    assert!(!details.containing_branches.is_empty());
}

#[test]
fn commit_history_loads_details_files_and_diff_for_non_head_commit() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "details@example.com"]);
    repo.run(["config", "user.name", "Details Author"]);
    repo.write("file.txt", "first\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "first commit"]);
    let first_sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
    repo.write("file.txt", "second\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "second commit"]);

    let details = load_commit_details(repo.path(), &first_sha, true).expect("details");
    let files = load_commit_files(repo.path(), &first_sha, true).expect("files");
    let diff =
        load_commit_diff(repo.path(), &first_sha, "file.txt", None, &files, true).expect("diff");

    assert_eq!(details.commit.subject, "first commit");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "file.txt");
    assert_eq!(files[0].status, "A");
    assert_eq!(diff.original_content, "");
    assert_eq!(diff.modified_content, "first\n");
    assert_eq!(diff.status, "A");
}

#[test]
fn detect_git_repositories_includes_the_root_when_it_is_a_repository() {
    let repo = TestGitRepo::new();

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(repositories, vec!["".to_string()]);
}

#[test]
fn detect_git_repositories_returns_no_repositories_for_a_plain_directory_tree() {
    let repo = TestGitRepo::new();
    fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
    fs::create_dir_all(repo.path().join("src")).expect("plain subdirectory");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert!(repositories.is_empty());
}

#[test]
fn detect_git_repositories_finds_nested_repositories_and_worktree_git_files() {
    let repo = TestGitRepo::new();

    // A regular nested repository two levels deep.
    fs::create_dir_all(repo.path().join("a/b/.git")).expect("nested repo marker");

    // A linked worktree/submodule: `.git` is a file (a `gitdir:` pointer),
    // not a directory.
    fs::create_dir_all(repo.path().join("worktrees/feature")).expect("worktree directory");
    fs::write(
        repo.path().join("worktrees/feature/.git"),
        "gitdir: ../../.git/worktrees/feature\n",
    )
    .expect("worktree .git file");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(
        repositories,
        vec![
            "".to_string(),
            "a/b".to_string(),
            "worktrees/feature".to_string(),
        ]
    );
}

#[test]
fn detect_git_repositories_skips_codevo_managed_worktrees() {
    let repo = TestGitRepo::new();
    fs::create_dir_all(repo.path().join(".worktrees/agt-test"))
        .expect("managed worktree directory");
    fs::write(
        repo.path().join(".worktrees/agt-test/.git"),
        "gitdir: ../../.git/worktrees/agt-test\n",
    )
    .expect("managed worktree .git file");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(repositories, vec!["".to_string()]);
}

#[test]
fn detect_git_repositories_preserves_dot_worktrees_in_plain_workspaces() {
    let repo = TestGitRepo::new();
    fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
    fs::create_dir_all(repo.path().join(".worktrees/product/.git"))
        .expect("nested product repository");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(repositories, vec![".worktrees/product".to_string()]);
}

#[test]
fn detect_git_repositories_skips_node_modules_and_other_ignored_directories() {
    let repo = TestGitRepo::new();

    // Vendored/dependency trees are never a project's own repository, and
    // real Node/Laravel projects nest plenty of `.git` markers under them
    // (npm packages installed from git, composer's own vendor `.git`).
    fs::create_dir_all(repo.path().join("node_modules/x/.git")).expect("node_modules repo");
    fs::create_dir_all(repo.path().join("vendor/y/.git")).expect("vendor repo");
    fs::create_dir_all(repo.path().join("storage/logs/.git")).expect("storage repo");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(repositories, vec!["".to_string()]);
}

#[cfg(unix)]
#[test]
fn detect_git_repositories_does_not_follow_symlinked_directories() {
    use std::os::unix::fs::symlink;

    let repo = TestGitRepo::new();
    let linked_target = repo.path().join("linked-target");
    fs::create_dir_all(linked_target.join(".git")).expect("linked target repo marker");
    symlink(&linked_target, repo.path().join("linked")).expect("directory symlink");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    // The real directory is still discovered by its own name; only the
    // symlinked alias pointing back at it is excluded (cycle protection
    // and dedup for aliases such as `vendor/pkg -> ../workbench/pkg`).
    assert_eq!(
        repositories,
        vec!["".to_string(), "linked-target".to_string()]
    );
}

#[test]
fn detect_git_repositories_respects_the_max_depth_bound() {
    let repo = TestGitRepo::new();
    fs::remove_dir_all(repo.path().join(".git")).expect("remove root .git");
    fs::create_dir_all(repo.path().join("one/two/three/four/five/.git"))
        .expect("deeply nested repo marker");

    let shallow = detect_git_repositories(repo.path(), 4).expect("shallow scan");
    assert!(shallow.is_empty());

    let deep = detect_git_repositories(repo.path(), 5).expect("deep scan");
    assert_eq!(deep, vec!["one/two/three/four/five".to_string()]);
}

#[test]
fn detect_git_repositories_returns_a_sorted_deterministic_order() {
    let repo = TestGitRepo::new();
    fs::create_dir_all(repo.path().join("z-repo/.git")).expect("repo z");
    fs::create_dir_all(repo.path().join("a-repo/.git")).expect("repo a");
    fs::create_dir_all(repo.path().join("m-repo/.git")).expect("repo m");

    let repositories = detect_git_repositories(repo.path(), DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH)
        .expect("detect repositories");

    assert_eq!(
        repositories,
        vec![
            "".to_string(),
            "a-repo".to_string(),
            "m-repo".to_string(),
            "z-repo".to_string(),
        ]
    );
}

#[test]
fn detect_git_repositories_fails_for_a_missing_root() {
    let repo = TestGitRepo::new();
    let missing = repo.path().join("does-not-exist");

    let result = detect_git_repositories(&missing, DEFAULT_GIT_REPOSITORY_DISCOVERY_DEPTH);

    assert!(result.is_err());
}

#[test]
fn parses_porcelain_status_changes() {
    let output = b" M src/User.php\0?? src/New.php\0D  old.php\0R  new.php\0old.php\0UU both.php\0";
    let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

    assert_eq!(changes[0].status, GitChangeStatus::Modified);
    assert_eq!(changes[0].relative_path, "src/User.php");
    assert_eq!(changes[1].status, GitChangeStatus::Untracked);
    assert_eq!(changes[2].status, GitChangeStatus::Deleted);
    assert_eq!(changes[3].status, GitChangeStatus::Renamed);
    assert_eq!(changes[3].old_relative_path.as_deref(), Some("old.php"));
    assert_eq!(changes[4].status, GitChangeStatus::Conflicted);
}

#[test]
fn marks_index_changes_as_staged() {
    let output = b"M  staged.php\0 M unstaged.php\0A  added.php\0?? new.php\0";
    let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

    assert!(changes[0].is_staged);
    assert!(!changes[1].is_staged);
    assert!(changes[2].is_staged);
    assert!(!changes[3].is_staged);
}

#[test]
fn splits_partially_staged_status_into_index_and_worktree_changes() {
    let output = b"MM partial.php\0AM added.php\0MD deleted-later.php\0";
    let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

    assert_eq!(changes.len(), 6);
    assert_eq!(changes[0].relative_path, "partial.php");
    assert!(changes[0].is_staged);
    assert_eq!(changes[0].status, GitChangeStatus::Modified);
    assert_eq!(changes[1].relative_path, "partial.php");
    assert!(!changes[1].is_staged);
    assert_eq!(changes[1].status, GitChangeStatus::Modified);
    assert_eq!(changes[2].status, GitChangeStatus::Added);
    assert!(changes[2].is_staged);
    assert_eq!(changes[3].status, GitChangeStatus::Modified);
    assert!(!changes[3].is_staged);
    assert_eq!(changes[4].status, GitChangeStatus::Modified);
    assert!(changes[4].is_staged);
    assert_eq!(changes[5].status, GitChangeStatus::Deleted);
    assert!(!changes[5].is_staged);
}

#[test]
fn rejects_paths_outside_workspace() {
    assert!(safe_relative_path("../secret.php").is_err());
    assert!(safe_relative_path("/secret.php").is_err());
    assert!(safe_relative_path("src/User.php").is_ok());
}

#[test]
fn safe_commit_sha_rejects_non_hex_and_options() {
    assert!(safe_commit_sha("HEAD").is_err());
    assert!(safe_commit_sha("--output=/etc/passwd").is_err());
    assert!(safe_commit_sha("1a2").is_err());
    assert!(safe_commit_sha("deadBEEF").is_ok());
}

#[test]
fn diff_isolates_index_and_worktree_for_partially_staged_file() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("file.txt", "one\ntwo\nthree\n");
    repo.run(["add", "file.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write("file.txt", "ONE\ntwo\nthree\n");
    repo.run(["add", "file.txt"]);
    repo.write("file.txt", "ONE\ntwo\nTHREE\n");

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    let staged = status
        .changes
        .iter()
        .find(|change| change.relative_path == "file.txt" && change.is_staged)
        .expect("staged change");
    let worktree = status
        .changes
        .iter()
        .find(|change| change.relative_path == "file.txt" && !change.is_staged)
        .expect("worktree change");

    let staged_diff = gateway.diff(repo.path(), staged).expect("staged diff");
    let worktree_diff = gateway.diff(repo.path(), worktree).expect("worktree diff");

    assert_eq!(staged_diff.original_content, "one\ntwo\nthree\n");
    assert_eq!(staged_diff.modified_content, "ONE\ntwo\nthree\n");
    assert_eq!(worktree_diff.original_content, "ONE\ntwo\nthree\n");
    assert_eq!(worktree_diff.modified_content, "ONE\ntwo\nTHREE\n");
}

#[test]
fn diff_reads_colon_prefixed_index_path_without_git_stage_ambiguity() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("0:foo", "zero base\n");
    repo.write("foo", "plain base\n");
    repo.run(["add", "0:foo", "foo"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write("0:foo", "zero index\n");
    repo.run(["add", "0:foo"]);
    repo.write("0:foo", "zero worktree\n");

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    let staged = status
        .changes
        .iter()
        .find(|change| change.relative_path == "0:foo" && change.is_staged)
        .expect("staged colon-path change");
    let worktree = status
        .changes
        .iter()
        .find(|change| change.relative_path == "0:foo" && !change.is_staged)
        .expect("worktree colon-path change");

    let staged_diff = gateway.diff(repo.path(), staged).expect("staged diff");
    let worktree_diff = gateway.diff(repo.path(), worktree).expect("worktree diff");

    assert_eq!(staged_diff.original_content, "zero base\n");
    assert_eq!(staged_diff.modified_content, "zero index\n");
    assert_eq!(worktree_diff.original_content, "zero index\n");
    assert_eq!(worktree_diff.modified_content, "zero worktree\n");
}

#[test]
fn diff_rejects_large_staged_worktree_and_untracked_snapshots_before_loading() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("worktree-large.txt", "small\n");
    repo.run(["add", "worktree-large.txt"]);
    repo.run(["commit", "-m", "initial"]);

    let large = vec![b'x'; MAX_DIFF_SNAPSHOT_BYTES as usize + 1];
    fs::write(repo.path().join("staged-large.txt"), &large).expect("large staged file");
    repo.run(["add", "staged-large.txt"]);
    fs::write(repo.path().join("worktree-large.txt"), &large).expect("large worktree file");
    fs::write(repo.path().join("untracked-large.txt"), &large).expect("large untracked file");

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    for (path, staged) in [
        ("staged-large.txt", true),
        ("worktree-large.txt", false),
        ("untracked-large.txt", false),
    ] {
        let change = status
            .changes
            .iter()
            .find(|change| change.relative_path == path && change.is_staged == staged)
            .unwrap_or_else(|| panic!("missing {path} change"));
        let diff = gateway
            .diff(repo.path(), change)
            .expect("large diff marker");

        assert_eq!(
            diff.preview_unavailable_reason,
            Some(GitDiffPreviewUnavailableReason::Large)
        );
        assert!(diff.original_content.is_empty());
        assert!(diff.modified_content.is_empty());
    }
}

#[test]
fn git_object_reader_enforces_its_bound_independently_of_the_size_probe() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    let large = vec![b'x'; MAX_DIFF_SNAPSHOT_BYTES as usize + 1];
    fs::write(repo.path().join("large.txt"), &large).expect("large index file");
    repo.write("small.txt", "small content\n");
    repo.run(["add", "large.txt", "small.txt"]);

    let large_content = read_git_object_content(
        repo.path(),
        ":./large.txt",
        MAX_DIFF_SNAPSHOT_BYTES as usize,
        true,
    )
    .expect("bounded large blob read");
    let small_content = read_git_object_content(
        repo.path(),
        ":./small.txt",
        MAX_DIFF_SNAPSHOT_BYTES as usize,
        true,
    )
    .expect("bounded small blob read");
    let missing_content = read_git_object_content(
        repo.path(),
        ":./missing.txt",
        MAX_DIFF_SNAPSHOT_BYTES as usize,
        true,
    )
    .expect("missing blob read");

    assert!(matches!(large_content, BoundedContent::TooLarge));
    assert!(matches!(
        small_content,
        BoundedContent::Bytes(content) if content == b"small content\n"
    ));
    assert!(matches!(
        missing_content,
        BoundedContent::Bytes(content) if content.is_empty()
    ));
}

#[test]
fn diff_rejects_binary_staged_and_worktree_snapshots_before_serialization() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("worktree.bin", "text\n");
    repo.run(["add", "worktree.bin"]);
    repo.run(["commit", "-m", "initial"]);
    fs::write(repo.path().join("staged.bin"), b"staged\0binary").expect("staged binary");
    repo.run(["add", "staged.bin"]);
    fs::write(repo.path().join("worktree.bin"), b"worktree\0binary").expect("worktree binary");

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    for (path, staged) in [("staged.bin", true), ("worktree.bin", false)] {
        let change = status
            .changes
            .iter()
            .find(|change| change.relative_path == path && change.is_staged == staged)
            .unwrap_or_else(|| panic!("missing {path} change"));
        let diff = gateway
            .diff(repo.path(), change)
            .expect("binary diff marker");

        assert_eq!(
            diff.preview_unavailable_reason,
            Some(GitDiffPreviewUnavailableReason::Binary)
        );
        assert!(diff.original_content.is_empty());
        assert!(diff.modified_content.is_empty());
    }
}

#[test]
fn diff_handles_untracked_and_deleted_files_on_their_selected_side() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("deleted.txt", "tracked\n");
    repo.run(["add", "deleted.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write("new.txt", "untracked\n");
    fs::create_dir_all(repo.path().join("new-directory")).expect("untracked directory");
    fs::write(repo.path().join("new-directory/file.txt"), "nested\n")
        .expect("nested untracked file");
    fs::remove_file(repo.path().join("deleted.txt")).expect("delete tracked file");

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    let untracked = status
        .changes
        .iter()
        .find(|change| change.relative_path == "new.txt")
        .expect("untracked change");
    let deleted = status
        .changes
        .iter()
        .find(|change| change.relative_path == "deleted.txt")
        .expect("deleted change");
    let nested_untracked = status
        .changes
        .iter()
        .find(|change| change.relative_path == "new-directory/file.txt")
        .expect("nested untracked file change");

    let untracked_diff = gateway
        .diff(repo.path(), untracked)
        .expect("untracked diff");
    let deleted_diff = gateway.diff(repo.path(), deleted).expect("deleted diff");
    let nested_diff = gateway
        .diff(repo.path(), nested_untracked)
        .expect("nested untracked diff");

    assert_eq!(untracked_diff.original_content, "");
    assert_eq!(untracked_diff.modified_content, "untracked\n");
    assert_eq!(deleted_diff.original_content, "tracked\n");
    assert_eq!(deleted_diff.modified_content, "");
    assert_eq!(nested_diff.original_content, "");
    assert_eq!(nested_diff.modified_content, "nested\n");
}

#[test]
fn diff_handles_staged_delete_and_rename_against_head() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("deleted.txt", "delete me\n");
    repo.write("old.txt", "rename me\n");
    repo.run(["add", "deleted.txt", "old.txt"]);
    repo.run(["commit", "-m", "initial"]);
    repo.run(["rm", "deleted.txt"]);
    repo.run(["mv", "old.txt", "new.txt"]);

    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    let deleted = status
        .changes
        .iter()
        .find(|change| change.relative_path == "deleted.txt")
        .expect("staged deletion");
    let renamed = status
        .changes
        .iter()
        .find(|change| change.relative_path == "new.txt")
        .expect("staged rename");

    let deleted_diff = gateway.diff(repo.path(), deleted).expect("deleted diff");
    let renamed_diff = gateway.diff(repo.path(), renamed).expect("renamed diff");

    assert!(deleted.is_staged);
    assert_eq!(deleted_diff.original_content, "delete me\n");
    assert_eq!(deleted_diff.modified_content, "");
    assert!(renamed.is_staged);
    assert_eq!(renamed.old_relative_path.as_deref(), Some("old.txt"));
    assert_eq!(renamed_diff.original_content, "rename me\n");
    assert_eq!(renamed_diff.modified_content, "rename me\n");
}

#[test]
fn diff_routes_nested_repository_change_through_its_owner() {
    let workspace = TestGitRepo::new();
    let nested = workspace.path().join("packages/nested");
    fs::create_dir_all(&nested).expect("nested repository directory");
    let run_nested = |args: &[&str]| {
        let output = git_command(true)
            .arg("-C")
            .arg(&nested)
            .args(args)
            .output()
            .expect("run nested git");
        assert!(
            output.status.success(),
            "nested git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run_nested(&["init"]);
    run_nested(&["config", "user.email", "nested@example.com"]);
    run_nested(&["config", "user.name", "Nested Author"]);
    fs::write(nested.join("nested.txt"), "base\n").expect("nested base");
    run_nested(&["add", "nested.txt"]);
    run_nested(&["commit", "-m", "initial"]);
    fs::write(nested.join("nested.txt"), "changed\n").expect("nested change");

    let gateway = CommandGitRepositoryGateway::new(true);
    let nested_status = gateway.status(&nested).expect("nested status");
    let change = nested_status.changes.first().expect("nested change");
    let diff = gateway
        .diff(workspace.path(), change)
        .expect("nested diff from workspace root");

    assert_eq!(diff.change.relative_path, "nested.txt");
    assert_eq!(diff.original_content, "base\n");
    assert_eq!(diff.modified_content, "changed\n");
    assert_eq!(diff.preview_unavailable_reason, None);
}

#[test]
fn diff_reads_unstaged_rename_base_from_the_old_index_path() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "diff@example.com"]);
    repo.run(["config", "user.name", "Diff Author"]);
    repo.write("old.txt", "before\n");
    repo.run(["add", "old.txt"]);
    repo.run(["commit", "-m", "initial"]);
    fs::rename(repo.path().join("old.txt"), repo.path().join("new.txt"))
        .expect("rename worktree file");
    fs::write(repo.path().join("new.txt"), "after\n").expect("modify renamed file");
    let canonical_root = repo.path().canonicalize().expect("canonical repository");

    let change = GitChangedFile {
        is_staged: false,
        is_unversioned: false,
        old_path: Some(canonical_root.join("old.txt").to_string_lossy().to_string()),
        old_relative_path: Some("old.txt".to_string()),
        path: canonical_root.join("new.txt").to_string_lossy().to_string(),
        relative_path: "new.txt".to_string(),
        status: GitChangeStatus::Renamed,
    };
    let diff = CommandGitRepositoryGateway::new(true)
        .diff(repo.path(), &change)
        .expect("unstaged rename diff");

    assert_eq!(diff.original_content, "before\n");
    assert_eq!(diff.modified_content, "after\n");
}

fn branch_repo() -> TestGitRepo {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "branch@example.com"]);
    repo.run(["config", "user.name", "Branch Author"]);
    // Pin the initial (still unborn) branch name to `main` so tests do not
    // depend on the host's `init.defaultBranch` (could be `master`).
    // `symbolic-ref` is idempotent whether or not `main` is already current.
    repo.run(["symbolic-ref", "HEAD", "refs/heads/main"]);
    repo
}

fn conflicted_repo() -> TestGitRepo {
    let repo = branch_repo();
    repo.write("conflict.txt", "base\n");
    repo.write("clean.txt", "base\n");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "base"]);
    repo.run(["checkout", "-b", "feature"]);
    repo.write("conflict.txt", "feature\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "feature"]);
    repo.run(["checkout", "main"]);
    repo.write("conflict.txt", "main\n");
    repo.run(["add", "conflict.txt"]);
    repo.run(["commit", "-m", "main"]);

    let output = git_command(true)
        .arg("-C")
        .arg(repo.path())
        .args(["merge", "feature"])
        .output()
        .expect("run conflicting merge");
    assert!(!output.status.success(), "merge must conflict");
    repo
}

fn conflicted_change(
    gateway: &CommandGitRepositoryGateway,
    repo: &TestGitRepo,
    relative_path: &str,
) -> GitChangedFile {
    let change = gateway
        .status(repo.path())
        .expect("conflict status")
        .changes
        .into_iter()
        .find(|change| change.relative_path == relative_path)
        .expect("conflicted change");
    assert_eq!(change.status, GitChangeStatus::Conflicted);
    change
}

fn git_changed_file(
    relative_path: &str,
    is_staged: bool,
    status: GitChangeStatus,
) -> GitChangedFile {
    GitChangedFile {
        is_staged,
        is_unversioned: status == GitChangeStatus::Untracked,
        old_path: None,
        old_relative_path: None,
        path: format!("/workspace/{relative_path}"),
        relative_path: relative_path.to_string(),
        status,
    }
}

fn empty_commit_filters() -> GitCommitFilters {
    GitCommitFilters {
        all_branches: None,
        author: None,
        branch: None,
        cursor: None,
        limit: None,
        path: None,
        query: None,
    }
}

#[test]
fn history_diff_rejects_missing_binary_and_oversized_blobs() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "history@example.com"]);
    repo.run(["config", "user.name", "History"]);
    fs::write(repo.path().join("binary"), [0, 1, 2]).unwrap();
    fs::write(repo.path().join("invalid"), [255, 254]).unwrap();
    fs::write(repo.path().join("large"), vec![b'x'; 2_000_001]).unwrap();
    repo.write("ordinary", "hello");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "files"]);
    let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
    let files = load_commit_files(repo.path(), &sha, true).unwrap();
    for path in ["binary", "invalid", "large"] {
        assert!(load_commit_diff(repo.path(), &sha, path, None, &files, true).is_err());
    }
    let mut missing = files.clone();
    missing[0].path = "missing".to_string();
    assert!(load_commit_diff(repo.path(), &sha, "missing", None, &missing, true).is_err());
    repo.run(["rm", "ordinary"]);
    repo.run(["commit", "-m", "delete"]);
    let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
    let files = load_commit_files(repo.path(), &sha, true).unwrap();
    let diff = load_commit_diff(repo.path(), &sha, "ordinary", None, &files, true).unwrap();
    assert_eq!(diff.original_content, "hello");
    assert_eq!(diff.modified_content, "");
}

#[test]
fn history_lists_merge_first_parent_and_literal_paths() {
    let repo = TestGitRepo::new();
    repo.run(["config", "user.email", "history@example.com"]);
    repo.run(["config", "user.name", "History"]);
    repo.write("root", "root");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "root"]);
    let branch = repo
        .git_output(["branch", "--show-current"])
        .trim()
        .to_string();
    repo.run(["checkout", "-b", "topic"]);
    repo.write("tab\tand\nnewline", "content");
    repo.run(["add", "."]);
    repo.run(["commit", "-m", "topic"]);
    repo.run(["checkout", &branch]);
    repo.run(["merge", "--no-ff", "topic", "-m", "merge"]);
    let sha = repo.git_output(["rev-parse", "HEAD"]).trim().to_string();
    let files = load_commit_files(repo.path(), &sha, true).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "tab\tand\nnewline");
    let diff = load_commit_diff(repo.path(), &sha, &files[0].path, None, &files, true).unwrap();
    assert_eq!(diff.original_content, "");
    assert_eq!(diff.modified_content, "content");
    assert!(load_commit_log(&repo.path().join("missing"), empty_commit_filters(), true).is_err());
    repo.run(["checkout", "--orphan", "unborn"]);
    assert!(load_commit_log(repo.path(), empty_commit_filters(), true)
        .unwrap()
        .is_empty());
}

struct TestGitRepo {
    path: PathBuf,
}

struct RemoteGitFixture {
    _host: TestGitRepo,
    seed: PathBuf,
    workspace_a: PathBuf,
    workspace_b: PathBuf,
}

impl RemoteGitFixture {
    fn new() -> Self {
        let host = TestGitRepo::new();
        let remote = host.path().join("remote.git");
        let seed = host.path().join("seed");
        let workspace_a = host.path().join("workspace-a");
        let workspace_b = host.path().join("workspace-b");
        Self::run_command(["init", "--bare", remote.to_str().expect("remote path")]);
        Self::run_command(["init", seed.to_str().expect("seed path")]);
        Self::configure(&seed);
        fs::write(seed.join("base.txt"), "base\n").expect("base file");
        Self::run_git(&seed, ["add", "base.txt"]);
        Self::run_git(&seed, ["commit", "-m", "initial"]);
        Self::run_git(&seed, ["branch", "-M", "main"]);
        Self::run_git(
            &seed,
            [
                "remote",
                "add",
                "origin",
                remote.to_str().expect("remote path"),
            ],
        );
        Self::run_git(&seed, ["push", "-u", "origin", "main"]);
        Self::run_git(&remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        Self::run_command([
            "clone",
            remote.to_str().expect("remote path"),
            workspace_a.to_str().expect("workspace A path"),
        ]);
        Self::run_command([
            "clone",
            remote.to_str().expect("remote path"),
            workspace_b.to_str().expect("workspace B path"),
        ]);
        Self::configure(&workspace_a);
        Self::configure(&workspace_b);

        Self {
            _host: host,
            seed,
            workspace_a,
            workspace_b,
        }
    }

    fn commit_and_push(&self, path: &str, content: &str, message: &str) {
        self.commit_in(&self.seed, path, content, message);
        Self::run_git(&self.seed, ["push"]);
    }

    fn commit_in(&self, root: &Path, path: &str, content: &str, message: &str) {
        fs::write(root.join(path), content).expect("fixture file");
        Self::run_git(root, ["add", path]);
        Self::run_git(root, ["commit", "-m", message]);
    }

    fn configure(root: &Path) {
        Self::run_git(root, ["config", "user.email", "test@example.com"]);
        Self::run_git(root, ["config", "user.name", "Test User"]);
    }

    fn git_output<const N: usize>(&self, root: &Path, args: [&str; N]) -> String {
        let output = git_command(true)
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn run_git<const N: usize>(root: &Path, args: [&str; N]) {
        let output = git_command(true)
            .arg("-C")
            .arg(root)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn run_command<const N: usize>(args: [&str; N]) {
        let output = git_command(true).args(args).output().expect("run git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

impl TestGitRepo {
    fn new() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        // A process-global atomic counter guarantees uniqueness across
        // parallel tests; the macOS clock only resolves to microseconds,
        // so `nanos` alone collides when tests start in the same tick and
        // both `git init` the same dir (templates/info/exclude clash).
        let unique = TEST_REPO_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "mockor-editor-git-test-{}-{nanos}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp repo");
        let repo = Self { path };
        repo.run(["init"]);
        repo
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn read(&self, relative_path: &str) -> String {
        fs::read_to_string(self.path.join(relative_path)).expect("read file")
    }

    fn write(&self, relative_path: &str, content: &str) {
        fs::write(self.path.join(relative_path), content).expect("write file");
    }

    fn merge_expecting_conflict(&self, branch: &str) {
        let output = git_command(true)
            .arg("-C")
            .arg(&self.path)
            .args(["merge", branch])
            .output()
            .expect("run conflicting merge");
        assert!(!output.status.success(), "merge must conflict");
    }

    fn git_output<const N: usize>(&self, args: [&str; N]) -> String {
        let output = git_command(true)
            .arg("-C")
            .arg(&self.path)
            .args(args)
            .output()
            .expect("run git");

        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        String::from_utf8_lossy(&output.stdout).to_string()
    }

    fn run<const N: usize>(&self, args: [&str; N]) {
        self.git_output(args);
    }
}

impl Drop for TestGitRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
