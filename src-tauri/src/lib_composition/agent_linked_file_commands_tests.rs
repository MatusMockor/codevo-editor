use super::*;
use std::{
    path::PathBuf,
    sync::{atomic::AtomicU64, Mutex, MutexGuard, PoisonError},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
static PERMIT_TESTS: Mutex<()> = Mutex::new(());

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = std::env::temp_dir().join(format!(
            "codevo-linked-file-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();
        Self {
            root: temp.canonicalize().unwrap(),
        }
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.root.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn read(path: &Path) -> Result<LinkedTextFile, String> {
    read_linked_text_file(path.to_str().unwrap())
}

fn text(path: &Path, content: &str) -> Result<LinkedTextFile, String> {
    Ok(LinkedTextFile::File {
        canonical_path: path.to_str().unwrap().to_string(),
        content: content.to_string(),
    })
}

fn invoke(path: &Path) -> Result<LinkedTextFile, String> {
    let request = serde_json::from_value::<LinkedTextFileRequest>(serde_json::json!({
        "path": path.to_str().unwrap(),
    }))
    .unwrap();
    tauri::async_runtime::block_on(read_agent_linked_text_file(request))
}

fn permit_tests() -> MutexGuard<'static, ()> {
    PERMIT_TESTS.lock().unwrap_or_else(PoisonError::into_inner)
}

#[test]
fn the_request_contract_is_camel_case_and_closed() {
    let request: LinkedTextFileRequest =
        serde_json::from_str(r#"{"path":"/tmp/handoff.md"}"#).unwrap();

    assert_eq!(request.path, "/tmp/handoff.md");
    for rejected in [
        r#"{"path":"/tmp/handoff.md","maxBytes":1}"#,
        r#"{"Path":"/tmp/handoff.md"}"#,
        r#"{"path":7}"#,
        r#"{}"#,
    ] {
        assert!(serde_json::from_str::<LinkedTextFileRequest>(rejected).is_err());
    }
}

#[test]
fn the_response_contract_is_a_closed_tagged_union() {
    let file = LinkedTextFile::File {
        canonical_path: "/tmp/handoff.md".to_string(),
        content: "# Handoff\n".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&file).unwrap(),
        serde_json::json!({
            "kind": "file",
            "canonicalPath": "/tmp/handoff.md",
            "content": "# Handoff\n",
        })
    );
    for (refusal, kind) in [
        (LinkedTextFile::DoesNotExist, "doesNotExist"),
        (LinkedTextFile::Folder, "folder"),
        (LinkedTextFile::SpecialFile, "specialFile"),
        (LinkedTextFile::TooLarge, "tooLarge"),
        (LinkedTextFile::NotText, "notText"),
        (LinkedTextFile::NotLocal, "notLocal"),
        (LinkedTextFile::Unreadable, "unreadable"),
        (LinkedTextFile::Unavailable, "unavailable"),
        (LinkedTextFile::Busy, "busy"),
    ] {
        assert_eq!(
            serde_json::to_value(&refusal).unwrap(),
            serde_json::json!({ "kind": kind })
        );
    }
}

#[test]
fn the_command_is_registered_under_its_wire_name_with_its_limits() {
    assert!(include_str!("runtime.rs")
        .contains("agent_linked_file_commands::read_agent_linked_text_file,"));
    assert_eq!(MAX_AGENT_LINKED_FILE_PATH_BYTES, 4096);
    assert_eq!(MAX_AGENT_LINKED_FILE_BYTES, 10 * 1024 * 1024);
    assert_eq!(MAX_CONCURRENT_LINKED_FILE_READS, 2);
}

#[test]
fn returns_the_text_of_a_regular_file_with_its_canonical_path() {
    let fixture = Fixture::new();
    let file = fixture.file("handoff.md", "# Odovzdávka ž\n".as_bytes());
    let empty = fixture.file("empty.md", b"");
    fs::create_dir(fixture.root.join("nested")).unwrap();

    assert_eq!(read(&file), text(&file, "# Odovzdávka ž\n"));
    assert_eq!(read(&empty), text(&empty, ""));
    assert_eq!(
        read(&fixture.root.join("nested/../handoff.md")),
        text(&file, "# Odovzdávka ž\n")
    );
}

#[cfg(unix)]
#[test]
fn resolves_symlinked_parents_and_file_aliases_to_the_real_file() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.root.join("real")).unwrap();
    let file = fixture.file("real/handoff.md", b"# Handoff\n");
    std::os::unix::fs::symlink(fixture.root.join("real"), fixture.root.join("alias")).unwrap();
    std::os::unix::fs::symlink(&file, fixture.root.join("shortcut.md")).unwrap();
    std::os::unix::fs::symlink(
        fixture.root.join("gone.md"),
        fixture.root.join("dangling.md"),
    )
    .unwrap();
    std::os::unix::fs::symlink(fixture.root.join("loop.md"), fixture.root.join("loop.md")).unwrap();

    assert_eq!(
        read(&fixture.root.join("alias/handoff.md")),
        text(&file, "# Handoff\n")
    );
    assert_eq!(
        read(&fixture.root.join("shortcut.md")),
        text(&file, "# Handoff\n")
    );
    assert_eq!(
        read(&fixture.root.join("dangling.md")),
        Ok(LinkedTextFile::DoesNotExist)
    );
    assert_eq!(
        read(&fixture.root.join("loop.md")),
        Ok(LinkedTextFile::Unavailable)
    );
}

#[test]
fn tells_a_missing_path_from_a_folder() {
    let fixture = Fixture::new();
    let file = fixture.file("handoff.md", b"# Handoff\n");
    fs::create_dir(fixture.root.join("folder.md")).unwrap();
    fs::create_dir(fixture.root.join("shot.png")).unwrap();

    for missing in [
        fixture.root.join("gone.md"),
        fixture.root.join("gone.png"),
        fixture.root.join("no-such-folder/gone.md"),
        file.join("child.md"),
    ] {
        assert_eq!(
            read(&missing),
            Ok(LinkedTextFile::DoesNotExist),
            "{missing:?}"
        );
    }
    for folder in ["folder.md", "shot.png", "."] {
        assert_eq!(
            read(&fixture.root.join(folder)),
            Ok(LinkedTextFile::Folder),
            "{folder}"
        );
    }
}

#[cfg(unix)]
#[test]
fn refuses_a_special_file_without_opening_it() {
    let fixture = Fixture::new();
    let socket = fixture.root.join("agent.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();

    assert_eq!(read(&socket), Ok(LinkedTextFile::SpecialFile));
    assert_eq!(
        read(Path::new("/dev/null")),
        Ok(LinkedTextFile::SpecialFile)
    );
    assert_eq!(
        read(Path::new("/dev/zero")),
        Ok(LinkedTextFile::SpecialFile)
    );
}

#[test]
fn bounds_the_file_size_at_the_limit() {
    let fixture = Fixture::new();
    let limit = MAX_AGENT_LINKED_FILE_BYTES as usize;
    let largest = fixture.file("largest.log", &vec![b'a'; limit]);
    let oversized = fixture.file("oversized.log", &vec![b'a'; limit + 1]);

    let Ok(LinkedTextFile::File { content, .. }) = read(&largest) else {
        panic!("a file of exactly the limit is returned");
    };
    assert_eq!(content.len(), limit);
    assert_eq!(read(&oversized), Ok(LinkedTextFile::TooLarge));
}

#[test]
fn refuses_content_that_is_not_text() {
    let fixture = Fixture::new();

    for (name, bytes) in [
        ("shot.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec()),
        ("latin1.txt", vec![b'c', b'a', b'f', 0xe9]),
        ("nul.md", b"# Handoff\0\n".to_vec()),
        ("archive.zip", vec![b'P', b'K', 3, 4, 0xff, 0xfe]),
    ] {
        let path = fixture.file(name, &bytes);
        assert_eq!(read(&path), Ok(LinkedTextFile::NotText), "{name}");
    }
    let named_like_an_image = fixture.file("notes.png", b"plain text");
    assert_eq!(
        read(&named_like_an_image),
        text(&named_like_an_image, "plain text")
    );
}

#[cfg(unix)]
#[test]
fn refuses_a_file_that_is_no_longer_the_one_that_was_checked() {
    let fixture = Fixture::new();
    let checked = fixture.file("handoff.md", b"small");
    let other = fixture.file("other.md", b"small");
    let before = fs::symlink_metadata(&checked).unwrap();

    assert_eq!(
        read_bound_bytes(&other, &before),
        Err(LinkedTextFile::Unreadable)
    );
    assert_eq!(read_bound_bytes(&checked, &before), Ok(b"small".to_vec()));

    fs::write(&checked, b"grown after the check").unwrap();

    assert_eq!(
        read_bound_bytes(&checked, &before),
        Err(LinkedTextFile::Unreadable)
    );
}

#[cfg(unix)]
#[test]
fn refuses_a_checked_path_that_was_swapped_for_a_symlink() {
    let fixture = Fixture::new();
    let checked = fixture.file("handoff.md", b"small");
    let secret = fixture.file("secret.md", b"small");
    let before = fs::symlink_metadata(&checked).unwrap();
    fs::remove_file(&checked).unwrap();
    std::os::unix::fs::symlink(&secret, &checked).unwrap();

    assert_eq!(
        read_bound_bytes(&checked, &before),
        Err(LinkedTextFile::Unreadable)
    );
}

#[cfg(unix)]
#[test]
fn reports_a_file_the_user_cannot_read_as_unreadable() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let fixture = Fixture::new();
    let file = fixture.file("secret.md", b"secret");
    let locked = fixture.root.join("locked");
    fs::create_dir(&locked).unwrap();
    fixture.file("locked/inside.md", b"inside");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

    let unreadable = read(&file);
    let unavailable = read(&locked.join("inside.md"));

    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(unreadable, Ok(LinkedTextFile::Unreadable));
    assert_eq!(unavailable, Ok(LinkedTextFile::Unavailable));
}

#[test]
fn maps_only_the_volume_refusal_to_not_local() {
    assert_eq!(
        not_stored_locally(INLINE_IMAGE_REMOTE_VOLUME_ERROR),
        LinkedTextFile::NotLocal
    );
    assert_eq!(
        not_stored_locally("The image could not be read."),
        LinkedTextFile::Unavailable
    );
}

#[test]
fn rejects_paths_that_are_not_bounded_absolute_and_printable() {
    let fixture = Fixture::new();
    fixture.file("handoff.md", b"# Handoff\n");
    let bounded = format!(
        "/{}.md",
        "x".repeat(MAX_AGENT_LINKED_FILE_PATH_BYTES - "/.md".len())
    );
    assert_eq!(bounded.len(), MAX_AGENT_LINKED_FILE_PATH_BYTES);

    for path in [
        String::new(),
        "handoff.md".to_string(),
        "./handoff.md".to_string(),
        "~/handoff.md".to_string(),
        "file:///tmp/handoff.md".to_string(),
        format!("{}/hand\noff.md", fixture.root.display()),
        format!("{}/handoff.md\0", fixture.root.display()),
        format!("{bounded}x"),
    ] {
        assert_eq!(
            read_linked_text_file(&path),
            Err(LINKED_FILE_PATH_ERROR.to_string()),
            "{path:?}"
        );
    }
    assert_eq!(
        read_linked_text_file(&bounded),
        Ok(LinkedTextFile::Unavailable)
    );
}

#[test]
fn the_command_answers_off_thread_and_releases_its_permit_on_every_outcome() {
    let _serial = permit_tests();
    let fixture = Fixture::new();
    let file = fixture.file("handoff.md", b"# Handoff\n");

    assert_eq!(invoke(&file), text(&file, "# Handoff\n"));
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    assert_eq!(
        invoke(&fixture.root.join("gone.md")),
        Ok(LinkedTextFile::DoesNotExist)
    );
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    assert_eq!(
        invoke(Path::new("relative.md")),
        Err(LINKED_FILE_PATH_ERROR.to_string())
    );
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
}

#[test]
fn exhausted_permits_answer_busy_without_queueing() {
    let _serial = permit_tests();
    let fixture = Fixture::new();
    let file = fixture.file("handoff.md", b"# Handoff\n");
    let held: Vec<ReadPermit> = (0..MAX_CONCURRENT_LINKED_FILE_READS)
        .map(|_| ReadPermit::acquire().unwrap())
        .collect();

    assert_eq!(invoke(&file), Ok(LinkedTextFile::Busy));
    assert_eq!(
        ACTIVE_READS.load(Ordering::Acquire),
        MAX_CONCURRENT_LINKED_FILE_READS
    );

    drop(held);

    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    assert_eq!(invoke(&file), text(&file, "# Handoff\n"));
}
