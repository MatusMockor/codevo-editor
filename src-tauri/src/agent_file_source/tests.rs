use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-file-source-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn file(&self, name: &str, bytes: &[u8]) -> String {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        path.to_str().unwrap().to_owned()
    }

    fn sparse(&self, name: &str, length: u64) -> String {
        let path = self.0.join(name);
        File::create(&path).unwrap().set_len(length).unwrap();
        path.to_str().unwrap().to_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn payload(length: usize) -> Vec<u8> {
    (0..length).map(|index| (index * 31 % 251) as u8).collect()
}

fn digest(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn drained(reader: &mut Reader) -> Result<Vec<Vec<u8>>, String> {
    let mut chunks = Vec::new();
    while let Some(chunk) = reader.next()? {
        chunks.push(chunk);
    }
    Ok(chunks)
}

type Change = (&'static str, fn(&str));
type Refused = (&'static str, fn(&str), &'static str);

fn touch(path: &str) {
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(3_600);
    OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(later)
        .unwrap();
}

fn append(path: &str) {
    use std::io::Write;
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(b"!")
        .unwrap();
}

#[test]
fn a_regular_file_is_staged_by_identity_under_an_opaque_uuid() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let path = fixture.file("Výkaz 2026.xlsx", b"sheet");
    let staged = sources.stage(&path).unwrap();
    assert_eq!(staged.name, "Výkaz 2026.xlsx");
    assert_eq!(staged.bytes, 5);
    assert!(valid_id(&staged.source_id));
    assert!(!staged.source_id.contains("xlsx"));
    let again = sources.stage(&path).unwrap();
    assert_ne!(again.source_id, staged.source_id);
    let source = sources.find(&staged.source_id).unwrap();
    assert_eq!(source.bytes(), 5);
    assert_eq!(
        source.media_type(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert_eq!(sources.len(), 2);
}

#[test]
fn the_size_bounds_are_one_byte_and_exactly_fifty_mebibytes() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    assert_eq!(MAX_FILE_BYTES, 52_428_800);
    assert_eq!(
        sources.stage(&fixture.file("empty.bin", b"")).unwrap_err(),
        EMPTY
    );
    assert_eq!(sources.stage(&fixture.file("one.bin", b"1")).unwrap().bytes, 1);
    let largest = fixture.sparse("largest.bin", MAX_FILE_BYTES);
    assert_eq!(sources.stage(&largest).unwrap().bytes, MAX_FILE_BYTES);
    let oversized = fixture.sparse("oversized.bin", MAX_FILE_BYTES + 1);
    assert_eq!(sources.stage(&oversized).unwrap_err(), TOO_LARGE);
    assert_eq!(sources.len(), 2);
}

#[test]
fn paths_that_are_not_bounded_absolute_text_are_refused() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let valid = fixture.file("a.txt", b"a");
    let padded = format!("{}/{}", fixture.0.display(), "x".repeat(4096));
    for path in [
        "relative.txt".to_string(),
        "./relative.txt".to_string(),
        String::new(),
        format!("{valid}\0"),
        format!("{valid}\n"),
        format!("{}/a\u{7f}.txt", fixture.0.display()),
        padded,
    ] {
        assert_eq!(sources.stage(&path).unwrap_err(), BAD_PATH, "{path:?}");
    }
    assert_eq!(sources.len(), 0);
}

#[test]
fn folders_and_missing_or_unreadable_files_are_refused() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let folder = fixture.0.join("folder.pdf");
    fs::create_dir(&folder).unwrap();
    assert_eq!(sources.stage(folder.to_str().unwrap()).unwrap_err(), FOLDER);
    assert_eq!(sources.stage("/").unwrap_err(), FOLDER);
    let missing = fixture.0.join("missing.pdf");
    assert_eq!(
        sources.stage(missing.to_str().unwrap()).unwrap_err(),
        UNREADABLE
    );
    let below = format!("{}/below", fixture.file("plain.txt", b"x"));
    assert_eq!(sources.stage(&below).unwrap_err(), UNREADABLE);
    let secret = fixture.file("secret.bin", b"secret");
    fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();
    let privileged = unsafe { libc::geteuid() == 0 };
    let expected = match privileged {
        true => Ok(6),
        false => Err(UNREADABLE.to_string()),
    };
    assert_eq!(sources.stage(&secret).map(|staged| staged.bytes), expected);
    assert_eq!(sources.len(), usize::from(privileged));
}

#[test]
fn symbolic_links_and_special_files_are_refused_without_blocking() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let target = fixture.file("target.txt", b"target");
    let link = fixture.0.join("link.txt");
    symlink(&target, &link).unwrap();
    assert_eq!(
        sources.stage(link.to_str().unwrap()).unwrap_err(),
        NOT_REGULAR
    );
    let dangling = fixture.0.join("dangling.txt");
    symlink(fixture.0.join("nowhere"), &dangling).unwrap();
    assert_eq!(
        sources.stage(dangling.to_str().unwrap()).unwrap_err(),
        NOT_REGULAR
    );
    let pipe = fixture.0.join("pipe.txt");
    let name = std::ffi::CString::new(pipe.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    assert_eq!(
        sources.stage(pipe.to_str().unwrap()).unwrap_err(),
        NOT_REGULAR
    );
    let socket = fixture.0.join("s");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    assert_eq!(
        sources.stage(socket.to_str().unwrap()).unwrap_err(),
        NOT_REGULAR
    );
    let linked_folder = fixture.0.join("linked");
    symlink(&fixture.0, &linked_folder).unwrap();
    let through = linked_folder.join("target.txt");
    assert_eq!(sources.stage(through.to_str().unwrap()).unwrap().bytes, 6);
    assert_eq!(sources.len(), 1);
}

#[test]
fn the_registry_keeps_sixty_four_sources_and_evicts_the_oldest_first() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let path = fixture.file("a.txt", b"a");
    let ids: Vec<String> = (0..MAX_SOURCES + 3)
        .map(|_| sources.stage(&path).unwrap().source_id)
        .collect();
    assert_eq!(MAX_SOURCES, 64);
    assert_eq!(sources.len(), MAX_SOURCES);
    for evicted in &ids[..3] {
        assert!(sources.find(evicted).is_none());
    }
    for retained in &ids[3..] {
        assert!(sources.find(retained).is_some());
    }
    sources.release(&ids[3]);
    sources.release(&ids[3]);
    sources.release(&ids[0]);
    sources.release("not-a-source");
    assert!(sources.find(&ids[3]).is_none());
    assert_eq!(sources.len(), MAX_SOURCES - 1);
    let next = sources.stage(&path).unwrap().source_id;
    assert_eq!(sources.len(), MAX_SOURCES);
    assert!(sources.find(&ids[4]).is_some());
    assert!(sources.find(&next).is_some());
}

#[test]
fn a_poisoned_registry_lock_keeps_serving() {
    let fixture = Fixture::new();
    let sources = Arc::new(FileSources::default());
    let path = fixture.file("a.txt", b"a");
    let id = sources.stage(&path).unwrap().source_id;
    let poisoned = Arc::clone(&sources);
    let panicked = std::thread::spawn(move || {
        let _held = poisoned.entries.lock().unwrap();
        panic!("holder failed");
    })
    .join();
    assert!(panicked.is_err());
    assert!(sources.find(&id).is_some());
    sources.release(&id);
    assert!(sources.stage(&path).is_ok());
    assert_eq!(sources.len(), 1);
}

#[test]
fn source_identifiers_are_lowercase_version_four_uuids() {
    for _ in 0..32 {
        assert!(valid_id(&mint_id().unwrap()));
    }
    for invalid in [
        "",
        "7389088c-29b8-4cec-9a15-e825e1fb2f6",
        "7389088c-29b8-1cec-9a15-e825e1fb2f66",
        "7389088c-29b8-4cec-ca15-e825e1fb2f66",
        "7389088C-29B8-4CEC-9A15-E825E1FB2F66",
        "7389088c029b8-4cec-9a15-e825e1fb2f66",
        "../../../../etc/passwd/aaaaaaaaaaaaa",
        "7389088c-29b8-4cec-9a15-e825e1fb2f66 ",
    ] {
        assert!(!valid_id(invalid), "{invalid:?}");
    }
}

#[test]
fn the_reader_yields_bounded_chunks_and_the_digest_of_exactly_what_it_read() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    for length in [1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 3 * CHUNK_BYTES + 17] {
        let bytes = payload(length);
        let path = fixture.file("data.bin", &bytes);
        let source = sources.find(&sources.stage(&path).unwrap().source_id).unwrap();
        let mut reader = source.open().unwrap();
        let chunks = drained(&mut reader).unwrap();
        assert!(chunks.iter().all(|chunk| !chunk.is_empty() && chunk.len() <= CHUNK_BYTES));
        assert_eq!(chunks.len(), length.div_ceil(CHUNK_BYTES));
        assert_eq!(chunks.concat(), bytes);
        assert_eq!(reader.next().unwrap(), None);
        assert_eq!(reader.finish().unwrap(), digest(&bytes));
    }
}

#[test]
fn an_unfinished_reader_has_no_digest() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let path = fixture.file("data.bin", &payload(2 * CHUNK_BYTES));
    let source = sources.find(&sources.stage(&path).unwrap().source_id).unwrap();
    let mut reader = source.open().unwrap();
    assert_eq!(reader.next().unwrap().unwrap().len(), CHUNK_BYTES);
    assert!(reader.finish().is_none());
}

#[test]
fn a_source_changed_after_staging_cannot_be_opened() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let changes: [Refused; 6] = [
        ("touched", touch, CHANGED),
        ("appended", append, CHANGED),
        (
            "truncated",
            |path| OpenOptions::new().write(true).open(path).unwrap().set_len(3).unwrap(),
            CHANGED,
        ),
        (
            "replaced",
            |path| {
                let replacement = format!("{path}.replacement");
                fs::write(&replacement, payload(100)).unwrap();
                fs::rename(replacement, path).unwrap();
            },
            CHANGED,
        ),
        (
            "linked",
            |path| {
                let moved = format!("{path}.moved");
                fs::rename(path, &moved).unwrap();
                std::os::unix::fs::symlink(moved, path).unwrap();
            },
            CHANGED,
        ),
        ("deleted", |path| fs::remove_file(path).unwrap(), UNREADABLE),
    ];
    for (change, apply, expected) in changes {
        let path = fixture.file(&format!("{change}.bin"), &payload(100));
        let source = sources.find(&sources.stage(&path).unwrap().source_id).unwrap();
        apply(&path);
        assert_eq!(source.open().err(), Some(expected.to_string()), "{change}");
    }
}

#[test]
fn a_change_during_reading_withholds_the_final_chunk() {
    let fixture = Fixture::new();
    let sources = FileSources::default();
    let changes: [Change; 4] = [
        ("touched", touch),
        ("appended", append),
        (
            "truncated",
            |path| {
                OpenOptions::new()
                    .write(true)
                    .open(path)
                    .unwrap()
                    .set_len(CHUNK_BYTES as u64 + 5)
                    .unwrap()
            },
        ),
        (
            "replaced",
            |path| {
                let replacement = format!("{path}.replacement");
                fs::write(&replacement, payload(3 * CHUNK_BYTES)).unwrap();
                fs::rename(replacement, path).unwrap();
            },
        ),
    ];
    for (change, apply) in changes {
        let path = fixture.file(&format!("{change}.bin"), &payload(3 * CHUNK_BYTES));
        let source = sources.find(&sources.stage(&path).unwrap().source_id).unwrap();
        let mut reader = source.open().unwrap();
        assert_eq!(reader.next().unwrap().unwrap().len(), CHUNK_BYTES);
        apply(&path);
        let rest = drained(&mut reader);
        assert_eq!(rest.err(), Some(CHANGED.to_string()), "{change}");
        assert!(reader.finish().is_none(), "{change}");
    }
}

#[test]
fn every_media_type_is_accepted_by_the_runner_grammar() {
    fn part(value: &str) -> bool {
        let bytes = value.as_bytes();
        (1..=63).contains(&bytes.len())
            && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
            && bytes.iter().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"!#$&^_.+-".contains(byte)
            })
    }
    let mut known = std::collections::BTreeSet::new();
    for (extension, media_type) in media_type::TABLE.iter().copied() {
        let (kind, subtype) = media_type.split_once('/').unwrap();
        assert!(part(kind) && part(subtype), "{media_type}");
        assert_eq!(extension, extension.to_ascii_lowercase());
        assert!(known.insert(extension), "{extension}");
    }
    assert!(media_type::TABLE.len() <= 64);
    let (kind, subtype) = media_type::FALLBACK.split_once('/').unwrap();
    assert!(part(kind) && part(subtype));
}

#[test]
fn the_media_type_follows_the_final_extension_case_insensitively() {
    for (path, expected) in [
        ("/tmp/report.pdf", "application/pdf"),
        ("/tmp/REPORT.PDF", "application/pdf"),
        ("/tmp/archive.tar.gz", "application/gzip"),
        ("/tmp/photo.JPeG", "image/jpeg"),
        ("/tmp/notes.md", "text/markdown"),
        ("/tmp/script.ts", media_type::FALLBACK),
        ("/tmp/Makefile", media_type::FALLBACK),
        ("/tmp/.gitignore", media_type::FALLBACK),
        ("/tmp/trailing.", media_type::FALLBACK),
        ("/tmp/pdf", media_type::FALLBACK),
    ] {
        assert_eq!(media_type::for_path(Path::new(path)), expected, "{path}");
    }
}
