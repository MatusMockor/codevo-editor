use super::{
    discard_file, prepare_discard, GitDiscardAction, GitDiscardFile, GitDiscardReceipt,
    DISCARD_CLEAN_ERROR, DISCARD_CONFLICT_ERROR, DISCARD_CONTENT_CHANGED_ERROR,
    DISCARD_PATH_BLOCKED_ERROR, DISCARD_STALE_ERROR, DISCARD_SUBMODULE_ERROR,
    DISCARD_UNTRACKED_OVERLAP_ERROR,
};
use crate::git::GitChangeStatus;
use std::path::Path;

use crate::git::working_tree_test_repo::TestRepo;

fn discard_now(
    root: &Path,
    request: &GitDiscardFile,
    trusted: bool,
) -> std::io::Result<GitDiscardReceipt> {
    let prepared = prepare_discard(root, request, trusted)?;
    discard_file(root, request, &prepared.fingerprint, trusted)
}

fn request(relative: &str, status: GitChangeStatus) -> GitDiscardFile {
    GitDiscardFile {
        relative_path: relative.to_string(),
        old_relative_path: None,
        expected_status: status,
    }
}

fn committed(label: &str) -> TestRepo {
    let repo = TestRepo::new(label);
    repo.write("tracked.txt", "base\n");
    repo.write("dir/keep.txt", "keep\n");
    repo.commit_all("base");
    repo
}

#[test]
fn discarding_an_untracked_file_deletes_only_that_file() {
    let repo = committed("discard-untracked");
    repo.write("dir/new.txt", "draft\n");
    repo.write("dir/other.txt", "other\n");

    let receipt = discard_now(
        repo.path(),
        &request("dir/new.txt", GitChangeStatus::Untracked),
        true,
    )
    .expect("discard");

    assert_eq!(receipt.action, GitDiscardAction::Deleted);
    assert_eq!(repo.read("dir/new.txt"), None);
    assert_eq!(repo.read("dir/other.txt").as_deref(), Some("other\n"));
    assert_eq!(repo.read("dir/keep.txt").as_deref(), Some("keep\n"));
}

#[test]
fn discarding_a_modified_file_restores_head_for_index_and_worktree() {
    let repo = committed("discard-modified");
    repo.write("tracked.txt", "staged\n");
    repo.git(&["add", "tracked.txt"]);
    repo.write("tracked.txt", "staged and edited\n");

    let receipt = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Modified),
        true,
    )
    .expect("discard");

    assert_eq!(receipt.action, GitDiscardAction::Restored);
    assert_eq!(repo.read("tracked.txt").as_deref(), Some("base\n"));
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discarding_a_deleted_file_brings_it_back() {
    let repo = committed("discard-deleted");
    repo.git(&["rm", "-q", "tracked.txt"]);

    discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Deleted),
        true,
    )
    .expect("discard");

    assert_eq!(repo.read("tracked.txt").as_deref(), Some("base\n"));
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discarding_a_staged_new_file_removes_it_from_index_and_disk() {
    let repo = committed("discard-added");
    repo.write("added.txt", "new\n");
    repo.git(&["add", "added.txt"]);
    repo.write("added.txt", "new and edited\n");

    let receipt = discard_now(
        repo.path(),
        &request("added.txt", GitChangeStatus::Added),
        true,
    )
    .expect("discard");

    assert_eq!(receipt.action, GitDiscardAction::Deleted);
    assert_eq!(repo.read("added.txt"), None);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discarding_a_staged_new_ignored_file_still_deletes_it() {
    let repo = committed("discard-ignored");
    repo.write(".gitignore", "*.log\n");
    repo.commit_all("ignore logs");
    repo.write("trace.log", "noise\n");
    repo.git(&["add", "-f", "trace.log"]);

    discard_now(
        repo.path(),
        &request("trace.log", GitChangeStatus::Added),
        true,
    )
    .expect("discard");

    assert_eq!(repo.read("trace.log"), None);
}

#[test]
fn discarding_a_rename_restores_the_old_path_and_removes_the_new_one() {
    let repo = committed("discard-rename");
    repo.git(&["mv", "tracked.txt", "moved.txt"]);
    let rename = GitDiscardFile {
        relative_path: "moved.txt".to_string(),
        old_relative_path: Some("tracked.txt".to_string()),
        expected_status: GitChangeStatus::Renamed,
    };

    let receipt = discard_now(repo.path(), &rename, true).expect("discard");

    assert_eq!(receipt.action, GitDiscardAction::Restored);
    assert_eq!(repo.read("tracked.txt").as_deref(), Some("base\n"));
    assert_eq!(repo.read("moved.txt"), None);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discard_refuses_when_the_status_changed_since_confirmation() {
    let repo = committed("discard-stale");
    repo.write("tracked.txt", "edited\n");

    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Untracked),
        true,
    )
    .expect_err("stale status must fail closed");

    assert_eq!(error.to_string(), DISCARD_STALE_ERROR);
    assert_eq!(repo.read("tracked.txt").as_deref(), Some("edited\n"));
}

#[test]
fn discard_refuses_a_tracked_file_that_turned_untracked() {
    let repo = committed("discard-untracked-now");
    repo.write("tracked.txt", "edited\n");
    repo.git(&["rm", "-q", "--cached", "tracked.txt"]);

    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Modified),
        true,
    )
    .expect_err("stale status must fail closed");

    assert_eq!(error.to_string(), DISCARD_STALE_ERROR);
    assert_eq!(repo.read("tracked.txt").as_deref(), Some("edited\n"));
}

#[test]
fn discard_refuses_a_file_without_changes() {
    let repo = committed("discard-clean");
    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Modified),
        true,
    )
    .expect_err("clean file");
    assert_eq!(error.to_string(), DISCARD_CLEAN_ERROR);
}

#[test]
fn discard_refuses_conflicted_files() {
    let repo = committed("discard-conflict");
    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Conflicted),
        true,
    )
    .expect_err("conflicted request");
    assert_eq!(error.to_string(), DISCARD_CONFLICT_ERROR);

    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("tracked.txt", "feature\n");
    repo.commit_all("feature");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("tracked.txt", "main\n");
    repo.commit_all("main");
    let merge = std::process::Command::new("git")
        .arg("-C")
        .arg(repo.path())
        .args(["merge", "-q", "feature"])
        .output()
        .expect("merge");
    assert!(!merge.status.success());

    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Modified),
        true,
    )
    .expect_err("conflicted file");
    assert_eq!(error.to_string(), DISCARD_CONFLICT_ERROR);
    assert!(repo
        .read("tracked.txt")
        .is_some_and(|text| text.contains("<<<<<<<")));
}

#[test]
fn discard_treats_glob_characters_literally() {
    let repo = committed("discard-literal");
    repo.write("dir/[ab].txt", "glob\n");
    repo.write("dir/a.txt", "sibling\n");

    discard_now(
        repo.path(),
        &request("dir/[ab].txt", GitChangeStatus::Untracked),
        true,
    )
    .expect("discard");

    assert_eq!(repo.read("dir/[ab].txt"), None);
    assert_eq!(repo.read("dir/a.txt").as_deref(), Some("sibling\n"));
}

#[test]
fn discard_rejects_paths_that_escape_or_are_not_files() {
    let repo = committed("discard-paths");
    for path in [
        "../outside.txt",
        "/etc/passwd",
        "dir/",
        "",
        "a/./b",
        "dir\\x",
    ] {
        assert!(
            discard_now(
                repo.path(),
                &request(path, GitChangeStatus::Untracked),
                true
            )
            .is_err(),
            "{path:?} must be rejected"
        );
    }
    let same = GitDiscardFile {
        relative_path: "tracked.txt".to_string(),
        old_relative_path: Some("tracked.txt".to_string()),
        expected_status: GitChangeStatus::Renamed,
    };
    assert!(discard_now(repo.path(), &same, true).is_err());
    assert!(discard_now(
        &repo.path().join("dir"),
        &request("keep.txt", GitChangeStatus::Modified),
        true
    )
    .is_err());
}

#[test]
fn discard_request_rejects_unknown_fields() {
    let parsed = serde_json::from_str::<GitDiscardFile>(
        r#"{"relativePath":"a","oldRelativePath":null,"expectedStatus":"modified","force":true}"#,
    );
    assert!(parsed.is_err());
}

#[test]
fn discarding_a_rename_never_overwrites_an_untracked_file_at_the_old_path() {
    let repo = committed("discard-rename-overlap");
    repo.git(&["mv", "tracked.txt", "moved.txt"]);
    repo.write("tracked.txt", "precious untracked work\n");
    let rename = GitDiscardFile {
        relative_path: "moved.txt".to_string(),
        old_relative_path: Some("tracked.txt".to_string()),
        expected_status: GitChangeStatus::Renamed,
    };

    let error = discard_now(repo.path(), &rename, true).expect_err("overlap must fail closed");

    assert_eq!(error.to_string(), DISCARD_UNTRACKED_OVERLAP_ERROR);
    assert_eq!(
        repo.read("tracked.txt").as_deref(),
        Some("precious untracked work\n")
    );
    assert_eq!(repo.read("moved.txt").as_deref(), Some("base\n"));
}

#[test]
fn discarding_a_staged_delete_never_clobbers_a_recreated_untracked_file() {
    let repo = committed("discard-delete-recreated");
    repo.git(&["rm", "-q", "--cached", "tracked.txt"]);
    repo.write("tracked.txt", "recreated by hand\n");

    let error = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Deleted),
        true,
    )
    .expect_err("recreated file must fail closed");

    assert_eq!(error.to_string(), DISCARD_UNTRACKED_OVERLAP_ERROR);
    assert_eq!(
        repo.read("tracked.txt").as_deref(),
        Some("recreated by hand\n")
    );
}

#[test]
fn discard_never_restores_a_head_directory_over_an_untracked_file() {
    let repo = committed("discard-directory-in-head");
    repo.git(&["rm", "-q", "-r", "--cached", "dir"]);
    std::fs::remove_dir_all(repo.path().join("dir")).expect("remove dir");
    repo.write("dir", "a file where HEAD has a directory\n");

    let error = discard_now(
        repo.path(),
        &request("dir", GitChangeStatus::Untracked),
        true,
    )
    .expect_err("entries below the path must fail closed");

    assert_eq!(error.to_string(), DISCARD_STALE_ERROR);
    assert_eq!(
        repo.read("dir").as_deref(),
        Some("a file where HEAD has a directory\n")
    );
}

#[test]
fn discarding_a_modified_file_that_is_missing_from_head_fails_without_deleting_it() {
    let repo = committed("discard-modified-not-in-head");
    repo.write("staged.txt", "new\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("staged.txt", "new, edited\n");

    let error = discard_now(
        repo.path(),
        &request("staged.txt", GitChangeStatus::Modified),
        true,
    )
    .expect_err("a status mismatch must fail closed");

    assert_eq!(error.to_string(), DISCARD_STALE_ERROR);
    assert_eq!(repo.read("staged.txt").as_deref(), Some("new, edited\n"));
}

#[test]
fn discard_never_overwrites_an_ignored_file_recreated_after_a_staged_delete() {
    let repo = TestRepo::new("discard-ignored-recreated");
    repo.write(".gitignore", "*.log\n");
    repo.write("build.log", "base\n");
    repo.git(&["add", "-f", "build.log", ".gitignore"]);
    repo.git(&["commit", "-qm", "base"]);
    repo.git(&["rm", "-q", "--cached", "build.log"]);
    repo.write("build.log", "precious\n");

    let error = discard_now(
        repo.path(),
        &request("build.log", GitChangeStatus::Deleted),
        true,
    )
    .expect_err("an ignored file in the way must fail closed");

    assert_eq!(error.to_string(), DISCARD_UNTRACKED_OVERLAP_ERROR);
    assert_eq!(repo.read("build.log").as_deref(), Some("precious\n"));
}

#[test]
fn discard_never_overwrites_an_ignored_file_at_a_rename_old_path() {
    let repo = TestRepo::new("discard-ignored-rename");
    repo.write(".gitignore", "*.log\n");
    repo.write("a.log", "base\n");
    repo.git(&["add", "-f", "a.log", ".gitignore"]);
    repo.git(&["commit", "-qm", "base"]);
    repo.git(&["mv", "a.log", "moved.txt"]);
    repo.write("a.log", "precious\n");
    let rename = GitDiscardFile {
        relative_path: "moved.txt".to_string(),
        old_relative_path: Some("a.log".to_string()),
        expected_status: GitChangeStatus::Renamed,
    };

    let error = discard_now(repo.path(), &rename, true).expect_err("ignored file in the way");

    assert_eq!(error.to_string(), DISCARD_UNTRACKED_OVERLAP_ERROR);
    assert_eq!(repo.read("a.log").as_deref(), Some("precious\n"));
    assert_eq!(repo.read("moved.txt").as_deref(), Some("base\n"));
}

#[test]
fn discard_never_deletes_an_untracked_file_that_replaced_a_parent_directory() {
    let repo = committed("discard-parent-file");
    std::fs::remove_dir_all(repo.path().join("dir")).expect("remove dir");
    repo.write("dir", "precious file named dir\n");

    let error = discard_now(
        repo.path(),
        &request("dir/keep.txt", GitChangeStatus::Deleted),
        true,
    )
    .expect_err("a file replacing the parent must fail closed");

    assert!(
        [DISCARD_UNTRACKED_OVERLAP_ERROR, DISCARD_PATH_BLOCKED_ERROR]
            .contains(&error.to_string().as_str()),
        "{error}"
    );
    assert_eq!(
        repo.read("dir").as_deref(),
        Some("precious file named dir\n")
    );
}

#[test]
fn discard_never_follows_or_removes_a_symlink_that_replaced_a_parent_directory() {
    use std::os::unix::fs::symlink;
    let repo = committed("discard-parent-link");
    let outside = repo.path().with_extension("outside");
    std::fs::create_dir_all(&outside).expect("outside dir");
    std::fs::write(outside.join("keep.txt"), "outside\n").expect("outside file");
    std::fs::remove_dir_all(repo.path().join("dir")).expect("remove dir");
    symlink(&outside, repo.path().join("dir")).expect("symlink");

    let result = discard_now(
        repo.path(),
        &request("dir/keep.txt", GitChangeStatus::Deleted),
        true,
    );
    let link_kept = std::fs::symlink_metadata(repo.path().join("dir"))
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    let outside_content = std::fs::read_to_string(outside.join("keep.txt"));
    let _ = std::fs::remove_dir_all(&outside);

    assert!(result.is_err());
    assert!(link_kept);
    assert_eq!(outside_content.ok().as_deref(), Some("outside\n"));
}

#[test]
fn discard_never_removes_a_directory_that_replaced_a_deleted_file() {
    let repo = committed("discard-file-to-dir");
    std::fs::remove_file(repo.path().join("tracked.txt")).expect("remove file");
    repo.write("tracked.txt/inner.txt", "precious\n");

    let result = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Deleted),
        true,
    );

    assert!(result.is_err());
    assert_eq!(
        repo.read("tracked.txt/inner.txt").as_deref(),
        Some("precious\n")
    );
}

#[test]
fn discard_refuses_when_the_file_was_edited_after_confirmation() {
    let repo = committed("discard-fingerprint");
    repo.write("tracked.txt", "reviewed edit\n");
    let file = request("tracked.txt", GitChangeStatus::Modified);
    let prepared = prepare_discard(repo.path(), &file, true).expect("prepare");
    repo.write("tracked.txt", "agent kept typing\n");

    let error = discard_file(repo.path(), &file, &prepared.fingerprint, true)
        .expect_err("changed content must fail closed");

    assert_eq!(error.to_string(), DISCARD_CONTENT_CHANGED_ERROR);
    assert_eq!(
        repo.read("tracked.txt").as_deref(),
        Some("agent kept typing\n")
    );
    assert!(discard_file(repo.path(), &file, "not-a-fingerprint", true).is_err());
}

#[test]
fn discard_refuses_submodules_before_changing_anything() {
    let repo = committed("discard-submodule");
    let head = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&[
        "update-index",
        "--add",
        "--cacheinfo",
        "160000",
        &head,
        "vendor/lib",
    ]);

    let error = discard_now(
        repo.path(),
        &request("vendor/lib", GitChangeStatus::Added),
        true,
    )
    .expect_err("submodule");

    assert_eq!(error.to_string(), DISCARD_SUBMODULE_ERROR);
    assert!(repo
        .git(&["ls-files", "-s", "vendor/lib"])
        .starts_with("160000"));
}

#[test]
fn discard_handles_unicode_spaces_and_glob_characters_literally() {
    let repo = TestRepo::new("discard-unicode");
    let path = "sp ace/\u{00fc}n\u{00ef} [x]*?.txt";
    repo.write(path, "base\n");
    repo.write("sp ace/other.txt", "other\n");
    repo.commit_all("base");
    repo.write(path, "edit\n");
    repo.write("sp ace/other.txt", "other edit\n");

    discard_now(repo.path(), &request(path, GitChangeStatus::Modified), true).expect("discard");

    assert_eq!(repo.read(path).as_deref(), Some("base\n"));
    assert_eq!(
        repo.read("sp ace/other.txt").as_deref(),
        Some("other edit\n")
    );
}

#[test]
fn discard_refuses_when_the_staged_content_changed_after_confirmation() {
    let repo = committed("discard-fingerprint-index");
    repo.write("tracked.txt", "v1 staged\n");
    repo.git(&["add", "tracked.txt"]);
    repo.write("tracked.txt", "v2 worktree\n");
    let file = request("tracked.txt", GitChangeStatus::Modified);
    let prepared = prepare_discard(repo.path(), &file, true).expect("prepare");
    let blob = repo.git(&["hash-object", "-w", "--", "dir/keep.txt"]);
    repo.git(&[
        "update-index",
        "--cacheinfo",
        &format!("100644,{blob},tracked.txt"),
    ]);

    let error = discard_file(repo.path(), &file, &prepared.fingerprint, true)
        .expect_err("staged change after prepare");

    assert_eq!(error.to_string(), DISCARD_CONTENT_CHANGED_ERROR);
    assert_eq!(repo.read("tracked.txt").as_deref(), Some("v2 worktree\n"));
}

#[test]
fn discard_refuses_an_in_place_edit_of_a_large_file_with_restored_mtime() {
    use std::os::unix::fs::MetadataExt;
    let repo = committed("discard-fingerprint-large");
    let big = vec![b'a'; 33 * 1024 * 1024];
    std::fs::write(repo.path().join("big.bin"), &big).expect("write big");
    repo.commit_all("big");
    let mut edited = big;
    edited[0] = b'b';
    std::fs::write(repo.path().join("big.bin"), &edited).expect("edit big");
    let file = request("big.bin", GitChangeStatus::Modified);
    let prepared = prepare_discard(repo.path(), &file, true).expect("prepare");
    let before = std::fs::metadata(repo.path().join("big.bin")).expect("metadata");
    std::thread::sleep(std::time::Duration::from_millis(20));
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut handle = std::fs::OpenOptions::new()
            .write(true)
            .open(repo.path().join("big.bin"))
            .expect("open big");
        handle.seek(SeekFrom::Start(1)).expect("seek");
        handle.write_all(b"AGENT-EDIT").expect("agent edit");
    }
    let times = [
        libc::timespec {
            tv_sec: before.mtime(),
            tv_nsec: before.mtime_nsec(),
        },
        libc::timespec {
            tv_sec: before.mtime(),
            tv_nsec: before.mtime_nsec(),
        },
    ];
    let target = std::ffi::CString::new(repo.path().join("big.bin").to_str().expect("utf8 path"))
        .expect("c path");
    // SAFETY: `target` is a valid path and `times` holds two initialized timespecs.
    unsafe { libc::utimensat(libc::AT_FDCWD, target.as_ptr(), times.as_ptr(), 0) };

    let error =
        discard_file(repo.path(), &file, &prepared.fingerprint, true).expect_err("in-place edit");

    assert_eq!(error.to_string(), DISCARD_CONTENT_CHANGED_ERROR);
    let content = std::fs::read(repo.path().join("big.bin")).expect("read big");
    assert!(content.windows(10).any(|window| window == b"AGENT-EDIT"));
}

#[test]
fn discarding_the_untracked_twin_of_a_staged_delete_keeps_the_staged_delete() {
    let repo = committed("discard-untracked-twin");
    repo.git(&["rm", "-q", "--cached", "tracked.txt"]);

    let receipt = discard_now(
        repo.path(),
        &request("tracked.txt", GitChangeStatus::Untracked),
        true,
    )
    .expect("delete the untracked copy");

    assert_eq!(receipt.action, GitDiscardAction::Deleted);
    assert_eq!(repo.read("tracked.txt"), None);
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "D  tracked.txt");
}

#[test]
fn discarding_a_deleted_file_recreates_missing_folders_and_keeps_the_mode() {
    use std::os::unix::fs::PermissionsExt;
    let repo = committed("discard-deleted-folder");
    repo.write("tools/run.sh", "#!/bin/sh\n");
    std::fs::set_permissions(
        repo.path().join("tools/run.sh"),
        std::fs::Permissions::from_mode(0o755),
    )
    .expect("chmod");
    repo.commit_all("tool");
    repo.git(&["rm", "-q", "-r", "tools"]);
    assert!(!repo.path().join("tools").exists());

    discard_now(
        repo.path(),
        &request("tools/run.sh", GitChangeStatus::Deleted),
        true,
    )
    .expect("restore");

    let mode = std::fs::metadata(repo.path().join("tools/run.sh"))
        .expect("restored")
        .permissions()
        .mode();
    assert_eq!(repo.read("tools/run.sh").as_deref(), Some("#!/bin/sh\n"));
    assert_ne!(mode & 0o111, 0);
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "");
    let leftovers: Vec<String> = std::fs::read_dir(repo.path())
        .expect("root")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with(".merge_file"))
        .collect();
    assert!(leftovers.is_empty());
}

fn restore_leftovers(repo: &TestRepo) -> Vec<String> {
    [repo.path().to_path_buf(), repo.path().join(".git")]
        .iter()
        .flat_map(|dir| std::fs::read_dir(dir).expect("list dir"))
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with(".merge_file") || name.starts_with("codevo-"))
        .collect()
}

#[test]
fn discard_never_replaces_a_file_that_took_the_place_of_a_deleted_symlink() {
    use std::os::unix::fs::symlink;
    let repo = TestRepo::new("discard-symlink-clobber");
    repo.write("target.txt", "t\n");
    symlink("target.txt", repo.path().join("link")).expect("symlink");
    repo.commit_all("base");
    repo.git(&["rm", "-q", "--cached", "link"]);
    std::fs::remove_file(repo.path().join("link")).expect("remove link");
    let file = request("link", GitChangeStatus::Deleted);
    let prepared = prepare_discard(repo.path(), &file, true).expect("prepare");
    repo.write("link", "precious\n");

    let result = discard_file(repo.path(), &file, &prepared.fingerprint, true);

    assert!(result.is_err());
    let metadata = std::fs::symlink_metadata(repo.path().join("link")).expect("still there");
    assert!(!metadata.file_type().is_symlink());
    assert_eq!(repo.read("link").as_deref(), Some("precious\n"));
    assert!(restore_leftovers(&repo).is_empty());
}

#[test]
fn discarding_a_deleted_symlink_restores_the_link_itself() {
    use std::os::unix::fs::symlink;
    let repo = TestRepo::new("discard-symlink-restore");
    repo.write("target.txt", "t\n");
    symlink("target.txt", repo.path().join("link")).expect("symlink");
    repo.commit_all("base");
    std::fs::remove_file(repo.path().join("link")).expect("remove link");

    discard_now(
        repo.path(),
        &request("link", GitChangeStatus::Deleted),
        true,
    )
    .expect("restore");

    let target = std::fs::read_link(repo.path().join("link")).expect("a symlink again");
    assert_eq!(target, Path::new("target.txt"));
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), "");
    assert!(restore_leftovers(&repo).is_empty());
}

#[test]
fn a_blocked_restore_leaves_no_temporary_files_in_the_worktree_or_git_dir() {
    let repo = committed("discard-restore-no-temp");
    repo.git(&["rm", "-q", "--cached", "tracked.txt"]);
    std::fs::remove_file(repo.path().join("tracked.txt")).expect("remove");
    let file = request("tracked.txt", GitChangeStatus::Deleted);
    let prepared = prepare_discard(repo.path(), &file, true).expect("prepare");
    repo.write("tracked.txt", "precious\n");

    assert!(discard_file(repo.path(), &file, &prepared.fingerprint, true).is_err());

    assert_eq!(repo.read("tracked.txt").as_deref(), Some("precious\n"));
    assert!(restore_leftovers(&repo).is_empty());
}

#[test]
fn a_restored_file_gets_the_mode_git_would_give_it_under_the_umask() {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::new("discard-umask");
    repo.write("run.sh", "#!/bin/sh\n");
    repo.write("plain.txt", "plain\n");
    std::fs::set_permissions(
        repo.path().join("run.sh"),
        std::fs::Permissions::from_mode(0o755),
    )
    .expect("chmod");
    repo.commit_all("base");
    std::fs::remove_file(repo.path().join("run.sh")).expect("remove");
    std::fs::remove_file(repo.path().join("plain.txt")).expect("remove");

    discard_now(
        repo.path(),
        &request("run.sh", GitChangeStatus::Deleted),
        true,
    )
    .expect("run.sh");
    discard_now(
        repo.path(),
        &request("plain.txt", GitChangeStatus::Deleted),
        true,
    )
    .expect("plain.txt");

    // SAFETY: umask only reads and resets the process file mode mask.
    let mask = unsafe {
        let current = libc::umask(0o022);
        libc::umask(current);
        current
    } as u32;
    let mode = |name: &str| {
        std::fs::metadata(repo.path().join(name))
            .expect("restored")
            .permissions()
            .mode()
            & 0o777
    };
    assert_eq!(mode("run.sh"), 0o777 & !mask);
    assert_eq!(mode("plain.txt"), 0o666 & !mask);
    assert!(restore_leftovers(&repo).is_empty());
}

#[test]
fn the_no_clobber_restore_refuses_an_occupied_path_for_symlinks_and_files() {
    use crate::git::{discard_restore::restore_without_clobbering, pinned_root::PinnedRoot};
    use std::os::unix::fs::symlink;
    let repo = TestRepo::new("restore-occupied");
    repo.write("target.txt", "t\n");
    repo.write("a.txt", "base\n");
    symlink("target.txt", repo.path().join("link")).expect("symlink");
    repo.commit_all("base");
    std::fs::remove_file(repo.path().join("link")).expect("remove link");
    std::fs::remove_file(repo.path().join("a.txt")).expect("remove file");
    repo.write("link", "precious link spot\n");
    repo.write("a.txt", "precious file spot\n");
    let root = PinnedRoot::open_top_level(repo.path(), true, "root").expect("root");

    assert!(restore_without_clobbering(&root, "link", true).is_err());
    assert!(restore_without_clobbering(&root, "a.txt", true).is_err());

    assert_eq!(repo.read("link").as_deref(), Some("precious link spot\n"));
    assert_eq!(repo.read("a.txt").as_deref(), Some("precious file spot\n"));
    assert!(restore_leftovers(&repo).is_empty());
}
