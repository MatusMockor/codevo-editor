use super::*;
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    fs,
    os::unix::fs::symlink,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

struct Fixture {
    base: PathBuf,
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let base = std::env::temp_dir().join(format!(
            "codevo-file-preview-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = base.join("workspace");
        fs::create_dir_all(&root).unwrap();
        Self { base, root }
    }

    fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn root_file(&self) -> File {
        File::open(&self.root).unwrap()
    }

    fn preview(&self, relative: &str) -> io::Result<WorkspaceFilePreview> {
        read_file_preview_from_root(&self.root_file(), relative)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn text(relative: &str, contents: &str, byte_length: u64, truncated: bool) -> WorkspaceFilePreview {
    WorkspaceFilePreview::Text {
        relative_path: relative.to_owned(),
        contents: contents.to_owned(),
        byte_length,
        truncated,
    }
}

fn binary(relative: &str, byte_length: u64) -> WorkspaceFilePreview {
    WorkspaceFilePreview::Binary {
        relative_path: relative.to_owned(),
        byte_length,
    }
}

#[test]
fn small_utf8_file_is_returned_whole() {
    let fixture = Fixture::new("small");
    fixture.write("src/main.ts", "const é = \"ok\";\n".as_bytes());

    assert_eq!(
        fixture.preview("src/main.ts").unwrap(),
        text("src/main.ts", "const é = \"ok\";\n", 17, false)
    );
}

#[test]
fn empty_file_is_empty_text() {
    let fixture = Fixture::new("empty");
    fixture.write("empty.txt", b"");

    assert_eq!(
        fixture.preview("empty.txt").unwrap(),
        text("empty.txt", "", 0, false)
    );
}

#[test]
fn file_of_exactly_the_limit_is_not_truncated() {
    let fixture = Fixture::new("exact");
    fixture.write("exact.txt", &vec![b'x'; FILE_PREVIEW_MAX_BYTES]);

    let WorkspaceFilePreview::Text {
        contents,
        byte_length,
        truncated,
        ..
    } = fixture.preview("exact.txt").unwrap()
    else {
        panic!("expected text");
    };
    assert_eq!(contents.len(), FILE_PREVIEW_MAX_BYTES);
    assert_eq!(byte_length, FILE_PREVIEW_MAX_BYTES as u64);
    assert!(!truncated);
}

#[test]
fn large_file_is_truncated_on_a_char_boundary_with_the_full_byte_length() {
    let fixture = Fixture::new("large");
    let mut bytes = vec![b'a'; FILE_PREVIEW_MAX_BYTES - 1];
    bytes.extend("€".repeat(1000).as_bytes());
    fixture.write("large.txt", &bytes);

    let WorkspaceFilePreview::Text {
        contents,
        byte_length,
        truncated,
        relative_path,
    } = fixture.preview("large.txt").unwrap()
    else {
        panic!("expected text");
    };
    assert_eq!(relative_path, "large.txt");
    assert!(truncated);
    assert_eq!(byte_length, bytes.len() as u64);
    assert_eq!(contents.len(), FILE_PREVIEW_MAX_BYTES - 1);
    assert!(contents.bytes().all(|byte| byte == b'a'));
}

#[test]
fn large_file_cut_exactly_after_a_complete_char_keeps_it() {
    let fixture = Fixture::new("large-boundary");
    let mut bytes = vec![b'a'; FILE_PREVIEW_MAX_BYTES - 3];
    bytes.extend("€€".as_bytes());
    fixture.write("large.txt", &bytes);

    let WorkspaceFilePreview::Text {
        contents,
        truncated,
        ..
    } = fixture.preview("large.txt").unwrap()
    else {
        panic!("expected text");
    };
    assert!(truncated);
    assert_eq!(contents.len(), FILE_PREVIEW_MAX_BYTES);
    assert!(contents.ends_with('€'));
}

#[test]
fn nul_in_the_first_eight_kib_is_binary() {
    let fixture = Fixture::new("nul");
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.push(0);
    bytes.extend(b"rest");
    fixture.write("archive.zip", &bytes);

    assert_eq!(
        fixture.preview("archive.zip").unwrap(),
        binary("archive.zip", bytes.len() as u64)
    );
}

#[test]
fn nul_after_the_sniff_window_in_valid_utf8_stays_text() {
    let fixture = Fixture::new("late-nul");
    let mut bytes = vec![b'a'; FILE_PREVIEW_BINARY_SNIFF_BYTES];
    bytes.push(0);
    fixture.write("late.txt", &bytes);

    assert!(matches!(
        fixture.preview("late.txt").unwrap(),
        WorkspaceFilePreview::Text {
            truncated: false,
            ..
        }
    ));
}

#[test]
fn invalid_utf8_is_binary() {
    let fixture = Fixture::new("invalid");
    fixture.write("latin1.txt", &[b'c', b'a', b'f', 0xe9, b'\n']);

    assert_eq!(
        fixture.preview("latin1.txt").unwrap(),
        binary("latin1.txt", 5)
    );
}

#[test]
fn incomplete_final_char_in_a_whole_file_is_binary() {
    let fixture = Fixture::new("incomplete");
    fixture.write("cut.txt", &[b'a', 0xe2, 0x82]);

    assert_eq!(fixture.preview("cut.txt").unwrap(), binary("cut.txt", 3));
}

#[test]
fn invalid_utf8_inside_a_truncated_prefix_is_binary() {
    let fixture = Fixture::new("large-invalid");
    let mut bytes = vec![b'a'; FILE_PREVIEW_MAX_BYTES + 10];
    bytes[FILE_PREVIEW_MAX_BYTES / 2] = 0xff;
    fixture.write("large.bin", &bytes);

    assert_eq!(
        fixture.preview("large.bin").unwrap(),
        binary("large.bin", bytes.len() as u64)
    );
}

#[test]
fn symlink_leaf_escaping_the_root_is_rejected() {
    let fixture = Fixture::new("symlink-leaf");
    let outside = fixture.base.join("secret.txt");
    fs::write(&outside, b"secret").unwrap();
    symlink(&outside, fixture.root.join("link.txt")).unwrap();

    assert!(fixture.preview("link.txt").is_err());
}

#[test]
fn symlinked_directory_component_is_rejected() {
    let fixture = Fixture::new("symlink-dir");
    let outside = fixture.base.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.txt"), b"secret").unwrap();
    symlink(&outside, fixture.root.join("linked")).unwrap();

    assert!(fixture.preview("linked/secret.txt").is_err());
}

#[test]
fn parent_traversal_and_absolute_paths_are_rejected() {
    let fixture = Fixture::new("traversal");
    fs::write(fixture.base.join("secret.txt"), b"secret").unwrap();

    for path in ["../secret.txt", "a/../../secret.txt", "/etc/hosts", ""] {
        let error = fixture.preview(path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{path}");
    }
}

#[test]
fn hard_linked_file_is_rejected_like_read_text() {
    let fixture = Fixture::new("hardlink");
    let outside = fixture.base.join("secret.txt");
    fs::write(&outside, b"secret").unwrap();
    fs::hard_link(&outside, fixture.root.join("alias.txt")).unwrap();

    assert!(fixture.preview("alias.txt").is_err());
}

#[test]
fn missing_file_is_not_found() {
    let fixture = Fixture::new("missing");

    assert_eq!(
        fixture.preview("missing.txt").unwrap_err().kind(),
        io::ErrorKind::NotFound
    );
}

#[test]
fn directory_is_rejected() {
    let fixture = Fixture::new("directory");
    fs::create_dir_all(fixture.root.join("src")).unwrap();

    assert!(fixture.preview("src").is_err());
}

#[test]
fn registered_root_descriptor_is_used_when_available() {
    let fixture = Fixture::new("registered");
    fixture.write("a.txt", b"registered");
    let registry = WorkspaceRegistry::new();
    registry.register(&fixture.root).unwrap();

    let root = resolve_preview_root(
        registry.clone_root_for_path(&fixture.root),
        Path::new("/nonexistent-codevo-preview-root"),
    )
    .unwrap();

    assert_eq!(
        read_file_preview_from_root(&root, "a.txt").unwrap(),
        text("a.txt", "registered", 10, false)
    );
}

#[test]
fn unregistered_root_falls_back_to_a_descriptor_opened_root() {
    let fixture = Fixture::new("unregistered");
    fixture.write("a.txt", b"plain");
    let registry = WorkspaceRegistry::new();

    let root =
        resolve_preview_root(registry.clone_root_for_path(&fixture.root), &fixture.root).unwrap();

    assert_eq!(
        read_file_preview_from_root(&root, "a.txt").unwrap(),
        text("a.txt", "plain", 5, false)
    );
}

#[test]
fn unregistered_fallback_rejects_relative_and_non_directory_roots() {
    let fixture = Fixture::new("bad-root");
    fixture.write("a.txt", b"plain");
    let missing = || Err(io::Error::from(io::ErrorKind::NotFound));

    assert!(resolve_preview_root(missing(), Path::new("relative/root")).is_err());
    assert!(resolve_preview_root(missing(), &fixture.root.join("a.txt")).is_err());
}

#[test]
fn registry_errors_other_than_not_found_are_not_bypassed() {
    let fixture = Fixture::new("registry-error");
    let error = resolve_preview_root(
        Err(io::Error::other("workspace registry lock poisoned")),
        &fixture.root,
    )
    .unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::Other);
}

#[test]
fn preview_serializes_as_a_closed_kind_tagged_camel_case_union() {
    assert_eq!(
        serde_json::to_value(text("a.ts", "x", 1, false)).unwrap(),
        serde_json::json!({
            "kind": "text",
            "relativePath": "a.ts",
            "contents": "x",
            "byteLength": 1,
            "truncated": false
        })
    );
    assert_eq!(
        serde_json::to_value(binary("a.png", 9)).unwrap(),
        serde_json::json!({ "kind": "binary", "relativePath": "a.png", "byteLength": 9 })
    );
}
