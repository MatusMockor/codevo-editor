use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

static NONCE: AtomicUsize = AtomicUsize::new(0);

struct TempRepository {
    root: PathBuf,
}

impl TempRepository {
    fn create(label: &str) -> Self {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "git-branch-diff-unit-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create repository directory");
        let repository = Self {
            root: root.canonicalize().expect("canonical root"),
        };
        repository.git(&["init", "--initial-branch=main"]);
        repository.git(&["config", "user.name", "Test"]);
        repository.git(&["config", "user.email", "test@example.com"]);
        fs::write(repository.root.join("a.txt"), "one\ntwo\n").expect("seed file");
        repository.git(&["add", "a.txt"]);
        repository.git(&["commit", "-m", "initial"]);
        repository
    }

    fn git(&self, arguments: &[&str]) {
        let output = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .arg("-C")
            .arg(&self.root)
            .args(arguments)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", message]);
    }
}

impl Drop for TempRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn rejects_option_like_and_malformed_base_refs() {
    let too_long = "x".repeat(257);
    for bad in ["--help", "a..b", "main ", "x@{1}", "", too_long.as_str()] {
        assert_eq!(
            safe_base_ref(bad),
            Err(INVALID_BASE_REF_ERROR.to_string()),
            "{bad}"
        );
    }
    assert_eq!(safe_base_ref("main"), Ok("main".to_string()));
    assert_eq!(
        safe_base_ref("origin/release/1.4"),
        Ok("origin/release/1.4".to_string())
    );
}

#[test]
fn rejects_escaping_and_non_canonical_relative_paths() {
    for bad in ["../x", "/abs", "a//b", "a/./b", ""] {
        assert_eq!(
            safe_relative_path(bad),
            Err(INVALID_DIFF_PATH_ERROR.to_string()),
            "{bad}"
        );
    }
    assert_eq!(safe_relative_path("src/a.ts"), Ok("src/a.ts".to_string()));
}

#[test]
fn parses_name_status_records_with_renames() {
    let (files, truncated) = parse_name_status_z("M\0a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0", 10);
    assert!(!truncated);
    assert_eq!(
        files
            .iter()
            .map(|file| (
                file.relative_path.as_str(),
                file.old_relative_path.as_deref(),
                file.status
            ))
            .collect::<Vec<_>>(),
        vec![
            ("a.ts", None, "modified"),
            ("new.ts", Some("old.ts"), "renamed"),
            ("b.ts", None, "added"),
        ]
    );
}

#[test]
fn caps_name_status_records() {
    let (files, truncated) = parse_name_status_z(&"M\0a\0".repeat(4), 2);
    assert_eq!(files.len(), 2);
    assert!(truncated);
}

#[test]
fn lists_branch_changes_against_the_merge_base_and_reads_sides() {
    let repository = TempRepository::create("changes");
    repository.git(&["checkout", "-b", "feat"]);
    fs::write(repository.root.join("a.txt"), "one\nTWO\n").expect("edit a");
    fs::write(repository.root.join("b.txt"), "new\n").expect("write b");
    repository.commit_all("feat work");

    let changes = branch_changes(&repository.root, "main").expect("branch changes");

    assert_eq!(changes.merge_base.len(), 40);
    assert!(changes
        .merge_base
        .chars()
        .all(|character| character.is_ascii_hexdigit()));
    assert!(!changes.truncated);
    assert_eq!(
        changes.files,
        vec![
            BranchChangedFile {
                relative_path: "a.txt".into(),
                old_relative_path: None,
                status: "modified",
                added: Some(1),
                deleted: Some(1),
            },
            BranchChangedFile {
                relative_path: "b.txt".into(),
                old_relative_path: None,
                status: "added",
                added: Some(1),
                deleted: Some(0),
            },
        ]
    );

    let modified = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "a.txt",
        None,
    )
    .expect("a sides");
    assert_eq!(modified.original.text, "one\ntwo\n");
    assert_eq!(modified.modified.text, "one\nTWO\n");
    assert_eq!(modified.unavailable_reason, None);

    let added = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "b.txt",
        None,
    )
    .expect("b sides");
    assert_eq!(added.original.text, "");
    assert_eq!(added.modified.text, "new\n");
}

#[test]
fn reports_large_and_binary_sides_as_unavailable() {
    let repository = TempRepository::create("unavailable");
    repository.git(&["checkout", "-b", "feat"]);
    fs::write(repository.root.join("big.txt"), "x".repeat(200 * 1024)).expect("write big");
    fs::write(repository.root.join("bin.dat"), [0u8, 1, 2]).expect("write binary");
    repository.commit_all("large and binary");
    let changes = branch_changes(&repository.root, "main").expect("branch changes");

    let large = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "big.txt",
        None,
    )
    .expect("large sides");
    let binary = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "bin.dat",
        None,
    )
    .expect("binary sides");

    assert_eq!(large.unavailable_reason, Some("large"));
    assert_eq!(large.modified.text, "");
    assert_eq!(binary.unavailable_reason, Some("binary"));
}

#[test]
fn fails_for_unknown_base_refs_and_invalid_merge_bases() {
    let repository = TempRepository::create("missing");
    assert!(branch_changes(&repository.root, "does-not-exist").is_err());
    assert!(branch_changes(&repository.root, "--output=/tmp/x").is_err());
    let commit = "a".repeat(40);
    assert!(branch_file_sides(&repository.root, "HEAD", &commit, "a.txt", None).is_err());
    assert!(branch_file_sides(&repository.root, &commit, "HEAD", "a.txt", None).is_err());
    assert!(branch_file_sides(&repository.root, &commit, &commit, "../x", None).is_err());
}

#[test]
fn reads_the_modified_side_from_the_listed_head_commit_after_head_moves() {
    let repository = TempRepository::create("moved");
    repository.git(&["checkout", "-b", "feat"]);
    fs::write(repository.root.join("a.txt"), "one\nlisted\n").expect("edit a");
    repository.commit_all("listed");
    let changes = branch_changes(&repository.root, "main").expect("branch changes");
    fs::write(repository.root.join("a.txt"), "one\nlater\n").expect("edit a again");
    repository.commit_all("later");

    let sides = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "a.txt",
        None,
    )
    .expect("sides");

    assert_eq!(changes.head_commit.len(), 40);
    assert_eq!(sides.modified.text, "one\nlisted\n");
}

#[test]
fn keeps_the_complete_prefix_and_marks_capped_branch_changes_truncated() {
    let repository = TempRepository::create("capped");
    repository.git(&["checkout", "-b", "feat"]);
    for index in 0..20 {
        fs::write(repository.root.join(format!("file-{index:02}.txt")), "x\n").expect("write");
    }
    repository.commit_all("many files");

    let capped = branch_changes_bounded(&repository.root, "main", 64).expect("capped changes");
    let complete = branch_changes(&repository.root, "main").expect("complete changes");

    assert!(capped.truncated);
    assert!(!capped.files.is_empty());
    assert!(capped.files.len() < 20);
    assert_eq!(
        capped
            .files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>(),
        complete.files[..capped.files.len()]
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>()
    );
    assert!(!complete.truncated);
    assert!(!complete.stats_truncated);
    assert_eq!(complete.files.len(), 20);
}

#[test]
fn marks_stats_truncated_when_numstat_is_capped_before_the_listed_files() {
    let repository = TempRepository::create("stats-capped");
    repository.git(&["checkout", "-b", "feat"]);
    for index in 0..4 {
        fs::write(repository.root.join(format!("f{index}")), "x\n").expect("write");
    }
    repository.commit_all("four files");

    let changes = branch_changes_bounded(&repository.root, "main", 24).expect("changes");

    assert_eq!(changes.files.len(), 4);
    assert!(!changes.truncated);
    assert!(changes.stats_truncated);
    assert_eq!(changes.files[3].added, None);
}

#[test]
fn reports_user_safe_errors_for_unborn_heads() {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!(
        "git-branch-diff-unit-unborn-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create repository directory");
    let repository = TempRepository {
        root: root.canonicalize().expect("canonical root"),
    };
    repository.git(&["init", "--initial-branch=main"]);

    assert_eq!(
        branch_changes(&repository.root, "main"),
        Err(NO_HEAD_COMMIT_ERROR.to_string())
    );
}

#[test]
fn treats_only_a_missing_path_as_a_missing_side() {
    let missing = CommandError::Failed("fatal: path 'b.txt' does not exist in 'abc'".to_string());
    let on_disk_only =
        CommandError::Failed("fatal: path 'b.txt' exists on disk, but not in 'abc'".to_string());
    let timed_out = CommandError::TimedOut(std::time::Duration::from_secs(10));
    let io = CommandError::Io("Failed to start git".to_string());
    let corrupt =
        CommandError::Failed("fatal: git cat-file: could not get object info".to_string());

    assert_eq!(side_size(Err(missing)), Ok(None));
    assert_eq!(side_size(Err(on_disk_only)), Ok(None));
    assert_eq!(side_size(Ok("12\n".to_string())), Ok(Some(12)));
    for failure in [timed_out, io, corrupt] {
        assert_eq!(
            side_size(Err(failure)),
            Err(SIDE_UNREADABLE_ERROR.to_string())
        );
    }
}

#[test]
fn reports_an_unreadable_side_instead_of_an_empty_one_when_the_object_is_gone() {
    let repository = TempRepository::create("corrupt-object");
    repository.git(&["checkout", "-b", "feat"]);
    fs::write(repository.root.join("a.txt"), "changed\n").expect("modify file");
    repository.commit_all("change a");
    let changes = branch_changes(&repository.root, "main").expect("branch changes");
    let blob = Command::new("git")
        .arg("-C")
        .arg(&repository.root)
        .args(["rev-parse", &format!("{}:a.txt", changes.head_commit)])
        .output()
        .expect("resolve blob");
    let blob = String::from_utf8_lossy(&blob.stdout).trim().to_string();
    fs::remove_file(
        repository
            .root
            .join(".git/objects")
            .join(&blob[..2])
            .join(&blob[2..]),
    )
    .expect("remove loose blob");

    let sides = branch_file_sides(
        &repository.root,
        &changes.merge_base,
        &changes.head_commit,
        "a.txt",
        None,
    );

    assert_eq!(sides, Err(SIDE_UNREADABLE_ERROR.to_string()));
}
