use super::{
    amend_candidate, amend_head, GitAmendCandidate, AMEND_HEAD_MOVED_ERROR, AMEND_NO_COMMIT_ERROR,
    AMEND_OPERATION_IN_PROGRESS_ERROR, AMEND_PUSHED_ERROR, MAX_AMEND_MESSAGE_BYTES,
};

use super::{GitAmendFile, GitAmendFileAction};
use crate::git::amend_index::{AMEND_NOTHING_CHANGED_ERROR, AMEND_UNSELECTED_CHANGES_ERROR};
use crate::git::working_tree_test_repo::TestRepo;

fn worktree(path: &str) -> GitAmendFile {
    GitAmendFile {
        relative_path: path.to_string(),
        action: GitAmendFileAction::StageWorktree,
    }
}

fn deletion(path: &str) -> GitAmendFile {
    GitAmendFile {
        relative_path: path.to_string(),
        action: GitAmendFileAction::StageDeletion,
    }
}

fn ready_head(repo: &TestRepo) -> String {
    match amend_candidate(repo.path(), true).expect("candidate") {
        GitAmendCandidate::Ready { head_sha, .. } => head_sha,
        other => panic!("expected a ready candidate, got {other:?}"),
    }
}

#[test]
fn candidate_reports_no_commit_on_an_unborn_branch() {
    let repo = TestRepo::new("amend-unborn");
    assert_eq!(
        amend_candidate(repo.path(), true).expect("candidate"),
        GitAmendCandidate::NoCommit
    );
    let error = amend_head(repo.path(), &"a".repeat(40), "message", &[], true)
        .expect_err("unborn amend must fail");
    assert_eq!(error.to_string(), AMEND_NO_COMMIT_ERROR);
}

#[test]
fn candidate_prefills_the_full_last_message() {
    let repo = TestRepo::new("amend-ready");
    repo.write("a.txt", "one\n");
    repo.commit_all("feat: first\n\nBody line.");
    let head = repo.git(&["rev-parse", "HEAD"]);
    assert_eq!(
        amend_candidate(repo.path(), true).expect("candidate"),
        GitAmendCandidate::Ready {
            head_sha: head,
            message: "feat: first\n\nBody line.".to_string(),
        }
    );
}

#[test]
fn candidate_reports_a_head_contained_in_any_remote_ref_as_pushed() {
    let repo = TestRepo::new("amend-pushed");
    repo.write("a.txt", "one\n");
    repo.commit_all("shared");
    let head = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["update-ref", "refs/remotes/origin/other", &head]);
    assert_eq!(
        amend_candidate(repo.path(), true).expect("candidate"),
        GitAmendCandidate::Pushed {
            head_sha: head.clone()
        }
    );
    let error =
        amend_head(repo.path(), &head, "rewrite", &[], true).expect_err("pushed amend must fail");
    assert_eq!(error.to_string(), AMEND_PUSHED_ERROR);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn candidate_reports_an_oversized_message_instead_of_truncating_it() {
    let repo = TestRepo::new("amend-large");
    repo.write("a.txt", "one\n");
    repo.git(&["add", "-A"]);
    let message = "x".repeat(MAX_AMEND_MESSAGE_BYTES + 10);
    repo.git(&["commit", "-q", "-m", &message]);
    assert!(matches!(
        amend_candidate(repo.path(), true).expect("candidate"),
        GitAmendCandidate::MessageTooLarge { .. }
    ));
}

#[test]
fn message_only_amend_rewords_head_and_keeps_the_tree() {
    let repo = TestRepo::new("amend-reword");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    repo.write("a.txt", "two\n");
    repo.commit_all("second");
    let head = ready_head(&repo);
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let parent = repo.git(&["rev-parse", "HEAD~1"]);

    let receipt = amend_head(repo.path(), &head, "second, reworded", &[], true).expect("amend");

    assert_eq!(receipt.head_sha, repo.git(&["rev-parse", "HEAD"]));
    assert_ne!(receipt.head_sha, head);
    assert_eq!(repo.git(&["log", "-1", "--format=%B"]), "second, reworded");
    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(repo.git(&["rev-parse", "HEAD~1"]), parent);
}

#[test]
fn amend_folds_only_the_selected_staged_files_into_head() {
    let repo = TestRepo::new("amend-files");
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.write("a.txt", "amended\n");
    repo.write("b.txt", "left out\n");
    repo.git(&["add", "a.txt", "b.txt"]);

    amend_head(
        repo.path(),
        &head,
        "first, amended",
        &[worktree("a.txt")],
        true,
    )
    .expect("amend");

    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "amended");
    assert_eq!(repo.git(&["show", "HEAD:b.txt"]), "one");
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "1");
}

#[test]
fn amend_refuses_when_head_moved_since_the_candidate_was_read() {
    let repo = TestRepo::new("amend-moved");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let seen = ready_head(&repo);
    repo.write("a.txt", "two\n");
    repo.commit_all("agent commit");
    let current = repo.git(&["rev-parse", "HEAD"]);

    let error = amend_head(repo.path(), &seen, "stale", &[], true).expect_err("moved head");

    assert_eq!(error.to_string(), AMEND_HEAD_MOVED_ERROR);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), current);
    assert_eq!(repo.git(&["log", "-1", "--format=%B"]), "agent commit");
}

#[test]
fn amend_rejects_invalid_ids_messages_and_paths_before_running_git() {
    let repo = TestRepo::new("amend-invalid");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    assert!(amend_head(repo.path(), "HEAD", "message", &[], true).is_err());
    assert!(amend_head(repo.path(), &head, "   ", &[], true).is_err());
    assert!(amend_head(repo.path(), &head, "nul\0byte", &[], true).is_err());
    let escaping = [worktree("../outside.txt")];
    assert!(amend_head(repo.path(), &head, "message", &escaping, true).is_err());
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn amend_refuses_a_nested_directory_instead_of_the_repository_root() {
    let repo = TestRepo::new("amend-nested");
    repo.write("nested/a.txt", "one\n");
    repo.commit_all("first");
    assert!(amend_candidate(&repo.path().join("nested"), true).is_err());
    assert_eq!(repo.read("nested/a.txt").as_deref(), Some("one\n"));
}

#[test]
fn amend_stages_selected_worktree_files_itself_and_syncs_the_index() {
    let repo = TestRepo::new("amend-stage");
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.write("a.txt", "worktree edit\n");
    repo.write("b.txt", "not selected\n");
    repo.write("new.txt", "brand new\n");

    amend_head(
        repo.path(),
        &head,
        "first, amended",
        &[worktree("a.txt"), worktree("new.txt")],
        true,
    )
    .expect("amend");

    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "worktree edit");
    assert_eq!(repo.git(&["show", "HEAD:new.txt"]), "brand new");
    assert_eq!(repo.git(&["show", "HEAD:b.txt"]), "one");
    assert_eq!(repo.git(&["status", "--porcelain"]), " M b.txt");
}

#[test]
fn amend_includes_a_staged_rename_when_both_paths_are_selected() {
    let repo = TestRepo::new("amend-rename");
    repo.write("old.txt", "content\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.git(&["mv", "old.txt", "new.txt"]);

    amend_head(
        repo.path(),
        &head,
        "first, renamed",
        &[worktree("new.txt"), deletion("old.txt")],
        true,
    )
    .expect("amend");

    assert_eq!(repo.git(&["ls-tree", "--name-only", "HEAD"]), "new.txt");
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn a_rejected_amend_leaves_the_index_and_head_untouched() {
    let repo = TestRepo::new("amend-no-side-effect");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let seen = ready_head(&repo);
    repo.write("a.txt", "two\n");
    repo.commit_all("agent commit");
    let current = repo.git(&["rev-parse", "HEAD"]);
    repo.write("a.txt", "unstaged edit\n");

    let error = amend_head(repo.path(), &seen, "stale", &[worktree("a.txt")], true)
        .expect_err("moved head");

    assert_eq!(error.to_string(), AMEND_HEAD_MOVED_ERROR);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), current);
    assert_eq!(repo.git(&["status", "--porcelain"]), " M a.txt");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn amend_rejects_selected_paths_that_are_not_plain_repository_files() {
    let repo = TestRepo::new("amend-paths");
    repo.write("dir/a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    for path in ["dir/", "a/./b", "", "dir\\a.txt", "a\nb"] {
        assert!(
            amend_head(repo.path(), &head, "message", &[worktree(path)], true).is_err(),
            "{path:?} must be rejected"
        );
    }
    repo.write("dir/a.txt", "two\n");
    let error = amend_head(repo.path(), &head, "message", &[worktree("dir")], true)
        .expect_err("a directory is not a file");
    assert!(!error.to_string().is_empty());
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn commit_and_amend_treat_glob_characters_in_paths_literally() {
    use crate::git::{CommandGitRepositoryGateway, GitRepositoryGateway};
    let repo = TestRepo::new("amend-literal");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    repo.write("[ab].txt", "glob\n");
    repo.write("a.txt", "sibling edit\n");
    repo.git(&["add", "--", "[ab].txt", "a.txt"]);
    let gateway = CommandGitRepositoryGateway::new(true);
    let status = gateway.status(repo.path()).expect("status");
    let glob = status
        .changes
        .iter()
        .filter(|change| change.relative_path == "[ab].txt")
        .cloned()
        .collect::<Vec<_>>();

    gateway
        .commit(repo.path(), "only the glob file", &glob)
        .expect("commit");

    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "one");
    assert_eq!(repo.git(&["show", "HEAD:[ab].txt"]), "glob");
    let head = ready_head(&repo);
    repo.write("[ab].txt", "glob, amended\n");
    amend_head(
        repo.path(),
        &head,
        "glob amended",
        &[worktree("[ab].txt")],
        true,
    )
    .expect("amend");
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "one");
    assert_eq!(repo.git(&["show", "HEAD:[ab].txt"]), "glob, amended");
}

fn scratch_leftovers(repo: &TestRepo) -> Vec<String> {
    std::fs::read_dir(repo.path().join(".git"))
        .expect("git dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with("codevo-amend"))
        .collect()
}

fn install_reference_hook(repo: &TestRepo, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    let hook = repo.path().join(".git/hooks/reference-transaction");
    std::fs::create_dir_all(hook.parent().expect("hooks dir")).expect("hooks dir");
    std::fs::write(
        &hook,
        format!("#!/bin/sh\nif [ \"$1\" = committed ]; then {body}; fi\n"),
    )
    .expect("write hook");
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).expect("chmod hook");
}

#[test]
fn amend_is_refused_while_a_merge_is_in_progress() {
    let repo = TestRepo::new("amend-mid-merge");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    repo.git(&["checkout", "-qb", "side"]);
    repo.write("side.txt", "from side\n");
    repo.commit_all("side work");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("a.txt", "main two\n");
    repo.commit_all("main work");
    let head = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["merge", "-q", "--no-commit", "--no-ff", "side"]);

    assert_eq!(
        amend_candidate(repo.path(), true).expect("candidate"),
        GitAmendCandidate::OperationInProgress
    );
    let error = amend_head(repo.path(), &head, "sneaky", &[worktree("side.txt")], true)
        .expect_err("mid-merge amend");

    assert_eq!(error.to_string(), AMEND_OPERATION_IN_PROGRESS_ERROR);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert!(repo.path().join(".git/MERGE_HEAD").exists());
}

#[test]
fn amend_keeps_unrelated_staged_changes_out_of_the_commit_and_in_the_index() {
    let repo = TestRepo::new("amend-unrelated");
    repo.write("a.txt", "one\n");
    repo.write("other.txt", "other\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.write("other.txt", "staged unrelated\n");
    repo.git(&["add", "other.txt"]);
    repo.write("a.txt", "amended\n");

    let receipt = amend_head(
        repo.path(),
        &head,
        "first, amended",
        &[worktree("a.txt")],
        true,
    )
    .expect("amend");

    assert!(receipt.index_synced);
    assert_eq!(repo.git(&["show", "HEAD:other.txt"]), "other");
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "amended");
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "M  other.txt");
    assert!(scratch_leftovers(&repo).is_empty());
}

#[test]
fn amend_reports_an_unsynced_index_when_the_lock_never_clears() {
    let repo = TestRepo::new("amend-locked");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    install_reference_hook(&repo, ": > \"$(git rev-parse --git-dir)/index.lock\"");
    repo.write("a.txt", "amended\n");

    let receipt = amend_head(
        repo.path(),
        &head,
        "locked amend",
        &[worktree("a.txt")],
        true,
    )
    .expect("the commit itself succeeds");

    std::fs::remove_file(repo.path().join(".git/index.lock")).expect("remove lock");
    assert!(!receipt.index_synced);
    assert_eq!(receipt.head_sha, repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "amended");
    assert!(scratch_leftovers(&repo).is_empty());
}

#[test]
fn amend_retries_the_index_update_until_a_short_lived_lock_clears() {
    let repo = TestRepo::new("amend-lock-retry");
    repo.write("a.txt", "one\n");
    repo.write("b.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    install_reference_hook(
        &repo,
        "lock=\"$(git rev-parse --git-dir)/index.lock\"; : > \"$lock\"; (sleep 0.2; rm -f \"$lock\") >/dev/null 2>&1 & :",
    );
    repo.write("a.txt", "amended\n");
    repo.write("b.txt", "amended\n");

    let receipt = amend_head(
        repo.path(),
        &head,
        "retried amend",
        &[worktree("a.txt"), worktree("b.txt")],
        true,
    )
    .expect("amend");

    assert!(receipt.index_synced);
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "");
}

#[test]
fn a_failed_amend_leaves_no_scratch_index_behind() {
    let repo = TestRepo::new("amend-leftovers");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.write("newdir/x.txt", "x\n");

    assert!(amend_head(repo.path(), &head, "dir", &[worktree("newdir")], true).is_err());

    assert!(scratch_leftovers(&repo).is_empty());
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn amend_keeps_merge_parents_and_a_detached_head_detached() {
    let repo = TestRepo::new("amend-merge-detached");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    repo.git(&["checkout", "-qb", "side"]);
    repo.write("side.txt", "side\n");
    repo.commit_all("side");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("main.txt", "main\n");
    repo.commit_all("main");
    repo.git(&["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let parents_before: Vec<String> = repo
        .git(&["rev-list", "--parents", "-n1", "HEAD"])
        .split_whitespace()
        .skip(1)
        .map(str::to_string)
        .collect();
    repo.git(&["checkout", "-q", "--detach", "HEAD"]);
    let main_before = repo.git(&["rev-parse", "main"]);
    let head = ready_head(&repo);

    amend_head(repo.path(), &head, "merge, amended", &[], true).expect("amend");

    let parents_after: Vec<String> = repo
        .git(&["rev-list", "--parents", "-n1", "HEAD"])
        .split_whitespace()
        .skip(1)
        .map(str::to_string)
        .collect();
    assert_eq!(parents_after, parents_before);
    assert_eq!(repo.git(&["rev-parse", "main"]), main_before);
    let head_file = std::fs::read_to_string(repo.path().join(".git/HEAD")).expect("HEAD");
    assert!(!head_file.starts_with("ref:"));
}

#[test]
fn amend_commits_a_staged_deletion_even_when_the_file_is_still_on_disk() {
    let repo = TestRepo::new("amend-rm-cached");
    repo.write("a.txt", "one\n");
    repo.write("secrets.env", "TOKEN=abc\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.git(&["rm", "-q", "--cached", "secrets.env"]);

    amend_head(
        repo.path(),
        &head,
        "first without secrets",
        &[deletion("secrets.env")],
        true,
    )
    .expect("amend");

    assert_eq!(repo.git(&["ls-tree", "-r", "--name-only", "HEAD"]), "a.txt");
    assert_eq!(repo.read("secrets.env").as_deref(), Some("TOKEN=abc\n"));
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "?? secrets.env");
}

#[test]
fn amend_of_a_rename_never_picks_up_a_file_recreated_at_the_old_path() {
    let repo = TestRepo::new("amend-rename-recreated");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    repo.git(&["mv", "a.txt", "b.txt"]);
    repo.write("a.txt", "unrelated scratch, never selected\n");

    amend_head(
        repo.path(),
        &head,
        "rename",
        &[worktree("b.txt"), deletion("a.txt")],
        true,
    )
    .expect("amend");

    assert_eq!(repo.git(&["ls-tree", "-r", "--name-only", "HEAD"]), "b.txt");
    assert_eq!(
        repo.read("a.txt").as_deref(),
        Some("unrelated scratch, never selected\n")
    );
}

#[test]
fn amend_batches_many_paths_and_records_a_reflog_message() {
    let repo = TestRepo::new("amend-many");
    for index in 0..600 {
        repo.write(&format!("d{}/f{index}.txt", index % 20), "x\n");
    }
    repo.commit_all("many");
    let head = ready_head(&repo);
    let files: Vec<GitAmendFile> = (0..600)
        .map(|index| {
            let path = format!("d{}/f{index}.txt", index % 20);
            repo.write(&path, "y\n");
            worktree(&path)
        })
        .collect();
    let started = std::time::Instant::now();

    let receipt =
        amend_head(repo.path(), &head, "many, amended\n\nbody", &files, true).expect("amend");

    assert!(started.elapsed() < std::time::Duration::from_secs(20));
    assert!(receipt.index_synced);
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "");
    assert_eq!(repo.git(&["show", "HEAD:d7/f7.txt"]), "y");
    assert_eq!(
        repo.git(&["reflog", "-1", "--format=%gs"]),
        "amend: many, amended"
    );
}

#[test]
fn history_reword_uses_the_same_pushed_check_as_amend() {
    use crate::git::{CommandGitRepositoryGateway, GitRepositoryGateway};
    let repo = TestRepo::new("reword-pushed");
    repo.write("a.txt", "one\n");
    repo.commit_all("shared");
    let head = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["update-ref", "refs/remotes/origin/other", &head]);

    let error = CommandGitRepositoryGateway::new(true)
        .reword(repo.path(), &head, "rewrite")
        .expect_err("pushed to another remote branch");

    assert!(error.to_string().contains("cannot amend a pushed commit"));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn amend_refuses_to_drop_files_that_were_not_selected_when_a_folder_became_a_file() {
    let repo = TestRepo::new("amend-dir-to-file");
    repo.write("d/x.txt", "x\n");
    repo.write("d/y.txt", "y\n");
    repo.write("keep.txt", "k\n");
    repo.commit_all("base");
    let head = ready_head(&repo);
    std::fs::remove_dir_all(repo.path().join("d")).expect("remove dir");
    repo.write("d", "file now\n");

    let error = amend_head(repo.path(), &head, "base", &[worktree("d")], true)
        .expect_err("unselected removals");

    assert!(error
        .to_string()
        .starts_with(AMEND_UNSELECTED_CHANGES_ERROR));
    assert!(error.to_string().contains("d/x.txt"));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn amend_refuses_a_file_that_became_a_folder() {
    let repo = TestRepo::new("amend-file-to-dir");
    repo.write("f", "file\n");
    repo.commit_all("base");
    let head = ready_head(&repo);
    std::fs::remove_file(repo.path().join("f")).expect("remove file");
    repo.write("f/inner.txt", "inner\n");

    assert!(amend_head(repo.path(), &head, "base", &[worktree("f")], true).is_err());
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn a_killed_ref_update_that_already_moved_head_reports_the_amend_truthfully() {
    let repo = TestRepo::new("amend-ref-killed");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    install_reference_hook(&repo, "kill -9 $PPID");
    repo.write("a.txt", "amended\n");

    let receipt = amend_head(repo.path(), &head, "killed", &[worktree("a.txt")], true)
        .expect("HEAD moved, so the amend happened");

    assert!(!receipt.index_synced);
    assert_ne!(receipt.head_sha, head);
    assert_eq!(receipt.head_sha, repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(repo.git(&["show", "HEAD:a.txt"]), "amended");
}

#[test]
fn a_rejected_ref_update_reports_that_nothing_changed() {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::new("amend-ref-rejected");
    repo.write("a.txt", "one\n");
    repo.commit_all("first");
    let head = ready_head(&repo);
    let hook = repo.path().join(".git/hooks/reference-transaction");
    std::fs::create_dir_all(hook.parent().expect("hooks dir")).expect("hooks dir");
    std::fs::write(
        &hook,
        "#!/bin/sh\nif [ \"$1\" = prepared ]; then exit 1; fi\n",
    )
    .expect("hook");
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let error = amend_head(repo.path(), &head, "rejected", &[], true).expect_err("rejected");

    assert_eq!(error.to_string(), AMEND_NOTHING_CHANGED_ERROR);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
}
