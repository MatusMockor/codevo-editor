use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "codevo-image-source-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn image(&self) -> PathBuf {
        let path = self.0.join("photo.png");
        fs::write(&path, b"\x89PNG\r\n\x1a\nimage payload").unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn selected_image_reads_without_local_workspace_registration() {
    let fixture = Fixture::new();
    let path = fixture.image();
    assert_eq!(
        read_image_source(path.to_str().unwrap()).unwrap(),
        fs::read(path).unwrap()
    );
}
#[test]
fn request_is_closed_and_path_is_bounded() {
    assert!(serde_json::from_str::<ImageSourceRequest>(r#"{"path":"/tmp/a.png"}"#).is_ok());
    assert!(serde_json::from_str::<ImageSourceRequest>(
        r#"{"path":"/tmp/a.png","workspaceId":"w"}"#
    )
    .is_err());
    for path in [
        "relative.png".to_string(),
        "/tmp/\0.png".to_string(),
        format!("/{}.png", "x".repeat(4096)),
    ] {
        assert!(read_image_source(&path).is_err());
    }
}
#[test]
fn rejects_nonimage_empty_oversized_and_directory_sources() {
    let fixture = Fixture::new();
    let path = fixture.image();
    fs::write(&path, b"not an image").unwrap();
    assert!(read_image_source(path.to_str().unwrap())
        .unwrap_err()
        .contains("format"));
    fs::write(&path, []).unwrap();
    assert!(read_image_source(path.to_str().unwrap())
        .unwrap_err()
        .contains("50 MB"));
    fs::File::create(&path)
        .unwrap()
        .set_len(MAX_SOURCE_BYTES + 1)
        .unwrap();
    assert!(read_image_source(path.to_str().unwrap())
        .unwrap_err()
        .contains("50 MB"));
    let directory = fixture.0.join("directory.png");
    fs::create_dir(&directory).unwrap();
    assert!(read_image_source(directory.to_str().unwrap())
        .unwrap_err()
        .contains("regular"));
    let unsupported = fixture.0.join("secret.txt");
    fs::write(&unsupported, b"secret").unwrap();
    assert!(read_image_source(unsupported.to_str().unwrap())
        .unwrap_err()
        .contains("PNG"));
}
#[cfg(unix)]
#[test]
fn rejects_symlink_and_fifo_without_opening_them() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let link = fixture.0.join("link.png");
    symlink(fixture.image(), &link).unwrap();
    assert!(read_image_source(link.to_str().unwrap()).is_err());
    let fifo = fixture.0.join("pipe.png");
    let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    assert!(read_image_source(fifo.to_str().unwrap()).is_err());
}
