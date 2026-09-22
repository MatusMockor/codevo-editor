use super::*;
use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    base: PathBuf,
    root: PathBuf,
    store: AgentTurnChangesStore,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "codevo-turn-changes-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&base).unwrap();
        let root = base.join("repository");
        fs::create_dir(&root).unwrap();
        git(&root, &["init", "--quiet"]);
        git(&root, &["config", "user.name", "Test"]);
        git(&root, &["config", "user.email", "test@example.invalid"]);
        let store = AgentTurnChangesStore::new(base.join("appdata"));
        Self { base, root, store }
    }
    fn write(&self, path: &str, contents: &[u8]) {
        fs::write(self.root.join(path), contents).unwrap();
    }
    fn capture(&self, id: &str, phase: CapturePhase) -> TurnChangesSummary {
        self.store.capture(&self.root, id, phase).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
fn git(root: &Path, args: &[&str]) {
    assert!(Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap()
        .status
        .success());
}
#[test]
fn captures_actual_dirty_baseline_without_mutating_index_and_freezes_after_restart() {
    let fixture = Fixture::new();
    fixture.write("file.txt", b"committed\n");
    git(&fixture.root, &["add", "."]);
    git(&fixture.root, &["commit", "-qm", "initial"]);
    fixture.write("file.txt", b"staged\n");
    git(&fixture.root, &["add", "."]);
    fixture.write("file.txt", b"user dirty\n");
    let index = fs::read(fixture.root.join(".git/index")).unwrap();
    fixture.capture("turn-1", CapturePhase::Before);
    fixture.write("file.txt", b"agent result\nextra\n");
    fixture.write("new.txt", b"new\n");
    let summary = fixture.capture("turn-1", CapturePhase::After);
    assert_eq!(summary.state, ChangesState::Ready);
    assert_eq!(summary.files.len(), 2);
    assert_eq!(summary.files[0].added_lines, Some(2));
    assert_eq!(summary.files[0].deleted_lines, Some(1));
    assert_eq!(fs::read(fixture.root.join(".git/index")).unwrap(), index);
    fixture.write("file.txt", b"later unrelated\n");
    git(&fixture.root, &["add", "."]);
    git(&fixture.root, &["commit", "-qm", "later"]);
    let reopened = AgentTurnChangesStore::new(fixture.base.join("appdata"));
    let diff = reopened
        .file_diff(&fixture.root, "turn-1", "file.txt")
        .unwrap();
    assert_eq!(diff.original.text, "user dirty\n");
    assert_eq!(diff.modified.text, "agent result\nextra\n");
    assert_eq!(
        reopened
            .capture(&fixture.root, "turn-1", CapturePhase::After)
            .unwrap(),
        summary
    );
}
#[test]
fn second_turn_uses_new_baseline_and_first_baseline_is_idempotent() {
    let fixture = Fixture::new();
    fixture.write("a", b"one\n");
    fixture.capture("one", CapturePhase::Before);
    fixture.write("a", b"two\n");
    fixture.capture("one", CapturePhase::Before);
    fixture.capture("one", CapturePhase::After);
    fixture.capture("two", CapturePhase::Before);
    fixture.write("a", b"three\n");
    fixture.capture("two", CapturePhase::After);
    assert_eq!(
        fixture
            .store
            .file_diff(&fixture.root, "one", "a")
            .unwrap()
            .original
            .text,
        "one\n"
    );
    assert_eq!(
        fixture
            .store
            .file_diff(&fixture.root, "two", "a")
            .unwrap()
            .original
            .text,
        "two\n"
    );
}
#[test]
fn absent_baseline_never_falls_back_to_live_status() {
    let fixture = Fixture::new();
    fixture.write("a", b"dirty\n");
    assert_eq!(
        fixture.capture("missing", CapturePhase::After).state,
        ChangesState::Unavailable
    );
    assert_eq!(
        fixture.store.get(&fixture.root, "missing").unwrap().state,
        ChangesState::Unavailable
    );
    assert!(fixture
        .store
        .file_diff(&fixture.root, "missing", "a")
        .is_err());
}
#[test]
fn binary_large_deleted_and_added_files_are_explicit_and_bounded() {
    let fixture = Fixture::new();
    fixture.write("binary", &[0, 1]);
    fixture.write("large", &vec![b'a'; MAX_FILE_BYTES + 1]);
    fixture.write("deleted", b"gone\n");
    fixture.capture("turn", CapturePhase::Before);
    fixture.write("binary", &[0, 2]);
    fixture.write("large", &vec![b'b'; MAX_FILE_BYTES + 1]);
    fs::remove_file(fixture.root.join("deleted")).unwrap();
    fixture.write("added", b"hello\n");
    let summary = fixture.capture("turn", CapturePhase::After);
    assert_eq!(summary.files.len(), 4);
    for (path, reason) in [
        ("binary", DiffUnavailableReason::Binary),
        ("large", DiffUnavailableReason::Large),
    ] {
        let file = summary
            .files
            .iter()
            .find(|file| file.relative_path == path)
            .unwrap();
        assert_eq!(file.added_lines, None);
        let diff = fixture
            .store
            .file_diff(&fixture.root, "turn", path)
            .unwrap();
        assert_eq!(diff.unavailable_reason, Some(reason));
        assert!(diff.original.text.is_empty());
        assert!(diff.modified.text.is_empty());
    }
    assert_eq!(
        fixture
            .store
            .file_diff(&fixture.root, "turn", "deleted")
            .unwrap()
            .modified
            .text,
        ""
    );
}
#[test]
fn path_escape_and_foreign_root_fail_closed() {
    let fixture = Fixture::new();
    fixture.write("a", b"before");
    fixture.capture("turn", CapturePhase::Before);
    fixture.write("a", b"after");
    fixture.capture("turn", CapturePhase::After);
    for path in ["../a", "/etc/passwd", ".git/config", "x/../../a", "x//a"] {
        assert!(fixture
            .store
            .file_diff(&fixture.root, "turn", path)
            .is_err());
    }
    let foreign = Fixture::new();
    assert_eq!(
        fixture.store.get(&foreign.root, "turn").unwrap().state,
        ChangesState::Unavailable
    );
    fs::rename(&fixture.root, fixture.base.join("moved")).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    assert!(fixture.store.get(&fixture.root, "turn").is_err());
}
#[cfg(unix)]
#[test]
fn symlinks_do_not_read_external_targets_and_symlink_parents_fail_closed() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let secret = fixture.base.join("secret");
    fs::write(&secret, b"never expose").unwrap();
    symlink(&secret, fixture.root.join("link")).unwrap();
    fixture.capture("link", CapturePhase::Before);
    fs::remove_file(fixture.root.join("link")).unwrap();
    fixture.capture("link", CapturePhase::After);
    let diff = fixture
        .store
        .file_diff(&fixture.root, "link", "link")
        .unwrap();
    assert_eq!(diff.unavailable_reason, Some(DiffUnavailableReason::Binary));
    assert!(diff.original.text.is_empty());
    fs::create_dir(fixture.root.join("dir")).unwrap();
    fixture.write("dir/tracked", b"safe");
    git(&fixture.root, &["add", "dir/tracked"]);
    fs::remove_dir_all(fixture.root.join("dir")).unwrap();
    symlink(&fixture.base, fixture.root.join("dir")).unwrap();
    assert_eq!(
        fixture.capture("escape", CapturePhase::Before).state,
        ChangesState::Unavailable
    );
}
#[test]
fn oversized_file_marks_capture_unavailable_and_retention_is_bounded() {
    let fixture = Fixture::new();
    let file = fs::File::create(fixture.root.join("huge")).unwrap();
    file.set_len(MAX_HASH_FILE_BYTES + 1).unwrap();
    let started = std::time::Instant::now();
    assert_eq!(
        fixture.capture("huge", CapturePhase::Before).state,
        ChangesState::Unavailable
    );
    eprintln!(
        "snapshot over-limit {}bytes rejected in {}ms",
        MAX_HASH_FILE_BYTES + 1,
        started.elapsed().as_millis()
    );
    fs::remove_file(fixture.root.join("huge")).unwrap();
    for n in 0..MAX_TURNS + 2 {
        fixture.capture(&format!("turn-{n}"), CapturePhase::Before);
    }
    assert_eq!(
        fixture
            .store
            .get(&fixture.root, "turn-0")
            .unwrap()
            .reason
            .as_deref(),
        Some("No snapshot is available for this turn.")
    );
}
#[test]
fn file_display_limit_is_reported_and_omitted_paths_are_not_exposed() {
    let fixture = Fixture::new();
    fixture.capture("many", CapturePhase::Before);
    for n in 0..MAX_CHANGED_FILES + 1 {
        fixture.write(&format!("file-{n:04}"), b"x\n");
    }
    let summary = fixture.capture("many", CapturePhase::After);
    assert!(summary.truncated);
    assert_eq!(summary.files.len(), MAX_CHANGED_FILES);
    assert!(fixture
        .store
        .file_diff(&fixture.root, "many", "file-0500")
        .is_err());
}

#[test]
fn newly_ignored_baseline_files_are_not_fabricated_as_deletions() {
    let fixture = Fixture::new();
    fixture.write("untracked", b"user data\n");
    fixture.capture("ignore", CapturePhase::Before);
    fixture.write(".gitignore", b"untracked\n");
    let summary = fixture.capture("ignore", CapturePhase::After);
    assert_eq!(summary.files.len(), 1);
    assert_eq!(summary.files[0].relative_path, ".gitignore");
}
#[cfg(unix)]
#[test]
fn executable_mode_changes_and_retained_authority_are_preserved() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    fixture.write("script", b"echo hello\n");
    let authority = fs::File::open(&fixture.root).unwrap();
    fixture
        .store
        .capture_with_authority(&fixture.root, "mode", CapturePhase::Before, &authority)
        .unwrap();
    fs::set_permissions(
        fixture.root.join("script"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let summary = fixture
        .store
        .capture_with_authority(&fixture.root, "mode", CapturePhase::After, &authority)
        .unwrap();
    assert_eq!(summary.files.len(), 1);
    assert_eq!(summary.files[0].added_lines, Some(0));
    fs::rename(&fixture.root, fixture.base.join("old-root")).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    assert!(fixture
        .store
        .capture_with_authority(&fixture.root, "foreign", CapturePhase::Before, &authority)
        .is_err());
    assert!(fixture
        .store
        .get_with_authority(&fixture.root, "mode", &authority)
        .is_err());
    assert!(fixture
        .store
        .file_diff_with_authority(&fixture.root, "mode", "script", &authority)
        .is_err());
}
#[test]
fn malformed_saved_summaries_are_rejected() {
    let fixture = Fixture::new();
    fixture.write("a", b"before\n");
    fixture.capture("bad", CapturePhase::Before);
    fixture.write("a", b"after\n");
    fixture.capture("bad", CapturePhase::After);
    let (_, identity) = snapshot::root_identity(&fixture.root).unwrap();
    let path = storage::record_path(&fixture.store.base, &identity, "bad");
    let original = storage::read(&path).unwrap().unwrap();
    let cases: [fn(&mut Record); 10] = [
        |record| record.summary.files.clear(),
        |record| record.summary.truncated = true,
        |record| record.after = None,
        |record| record.finished = false,
        |record| record.summary.files[0].relative_path = "../secret".into(),
        |record| record.summary.files[0].relative_path = "absent".into(),
        |record| record.summary.files.push(record.summary.files[0].clone()),
        |record| record.summary.reason = Some("x".repeat(1025)),
        |record| record.summary.files[0].added_lines = Some(u64::MAX),
        |record| record.summary.files[0].status = ChangeStatus::Added,
    ];
    for case in cases {
        let mut record = original.clone();
        case(&mut record);
        storage::write(&path, &record).unwrap();
        assert!(fixture.store.get(&fixture.root, "bad").is_err());
        assert!(fixture.store.file_diff(&fixture.root, "bad", "a").is_err());
    }
}
#[cfg(unix)]
#[test]
fn appdata_storage_symlink_cannot_redirect_writes_or_pruning() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fixture.write("a", b"test");
    let external = fixture.base.join("foreign-storage");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("keep.json"), b"private").unwrap();
    fs::create_dir(fixture.base.join("appdata")).unwrap();
    symlink(&external, fixture.base.join("appdata/agent-turn-changes")).unwrap();
    assert!(fixture
        .store
        .capture(&fixture.root, "test", CapturePhase::Before)
        .is_err());
    assert_eq!(fs::read_dir(&external).unwrap().count(), 1);
    assert_eq!(fs::read(external.join("keep.json")).unwrap(), b"private");
}
#[test]
fn measured_snapshots_cover_small_large_and_limit_exhaustion() {
    let fixture = Fixture::new();
    for (label, count, size) in [("small", 10, 1024), ("representative", 1000, 8192)] {
        for n in 0..count {
            fixture.write(&format!("file-{n:04}"), &vec![b'a'; size]);
        }
        let start = std::time::Instant::now();
        let before = fixture.capture(label, CapturePhase::Before);
        let baseline_ms = start.elapsed().as_millis();
        assert_eq!(before.state, ChangesState::Unavailable);
        fixture.write("file-0000", b"changed\n");
        let start = std::time::Instant::now();
        let after = fixture.capture(label, CapturePhase::After);
        let after_ms = start.elapsed().as_millis();
        assert_eq!(after.state, ChangesState::Ready);
        let (_, identity) = snapshot::root_identity(&fixture.root).unwrap();
        let stored = fs::metadata(storage::record_path(&fixture.store.base, &identity, label))
            .unwrap()
            .len();
        eprintln!("snapshot {label}: {count} files x {size} bytes; before={baseline_ms}ms after={after_ms}ms stored={stored}bytes");
    }
}
