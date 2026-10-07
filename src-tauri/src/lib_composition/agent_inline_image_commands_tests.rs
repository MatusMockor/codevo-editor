use super::super::agent_attachment_commands::agent_thread_store::{
    agent_root_owner_id, fnv1a64hex, AGENT_THREAD_STORE_DIR_NAME, MAX_AGENT_IMAGE_DIMENSION,
};
use super::super::agent_task_commands::{
    agent_root_lease::AgentRootWorkspaceRegistration, UNKNOWN_AGENT_WORKSPACE_ERROR,
    UNTRUSTED_AGENT_REPOSITORY_ERROR,
};
use super::*;
use std::{
    cell::Cell,
    path::PathBuf,
    sync::{atomic::AtomicU64, MutexGuard, PoisonError},
};
use tauri::ipc::{InvokeResponseBody, IpcResponse};

const THREAD: &str = "agt-thread-0001";
static NEXT: AtomicU64 = AtomicU64::new(0);
static PERMIT_TESTS: Mutex<()> = Mutex::new(());

struct Fixture {
    app: tauri::App<tauri::test::MockRuntime>,
    workspace_id: WorkspaceId,
    root_key: String,
    base_dir: PathBuf,
    outside: PathBuf,
    temp: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = std::env::temp_dir().join(format!(
            "codevo-inline-image-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&temp);
        let project = temp.join("project");
        let base_dir = temp.join("app-data");
        let outside = temp.join("outside");
        for directory in [&project, &base_dir, &outside] {
            fs::create_dir_all(directory).unwrap();
        }
        let project = project.canonicalize().unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&project).unwrap();
        let leases = AgentRootLeaseRegistry::new();
        leases
            .acquire_registered(
                &project,
                AgentRootWorkspaceRegistration {
                    workspace_id: descriptor.workspace_id.clone(),
                    admission_token: 1,
                },
            )
            .unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        app.manage(registry);
        app.manage(Mutex::new(
            WorkspaceTrustService::load(temp.join("workspace-trust.json")).unwrap(),
        ));
        app.manage(Arc::new(leases));
        app.manage(Arc::new(AgentAttachmentStore::new(base_dir.clone())));
        let fixture = Self {
            app,
            workspace_id: descriptor.workspace_id,
            root_key: descriptor.canonical_root_path.to_str().unwrap().to_string(),
            base_dir,
            outside,
            temp,
        };
        fixture.set_trusted(true);
        fixture.write_thread_file(&fixture.root_key, THREAD);
        fixture
    }

    fn set_trusted(&self, trusted: bool) {
        self.app
            .state::<Mutex<WorkspaceTrustService>>()
            .lock()
            .unwrap()
            .set(&self.root_key, trusted)
            .unwrap();
    }

    fn thread_file(&self, root_key: &str, thread_id: &str) -> PathBuf {
        self.base_dir
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(root_key))
            .join(format!("{thread_id}.json"))
    }

    fn write_thread_file(&self, root_key: &str, thread_id: &str) {
        let path = self.thread_file(root_key, thread_id);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"{}").unwrap();
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.outside.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        self.read_as(&self.workspace_id, THREAD, path.to_str().unwrap())
    }

    fn read_as(
        &self,
        workspace_id: &WorkspaceId,
        thread_id: &str,
        path: &str,
    ) -> Result<Vec<u8>, String> {
        let authority = InlineImageAuthority::from_app(self.app.handle());
        read_inline_image(path, || authority.owning_workspace(workspace_id, thread_id))
    }

    fn invoke(&self, path: &Path) -> Result<Vec<u8>, String> {
        let request = serde_json::from_value::<InlineImageRequest>(serde_json::json!({
            "workspaceId": self.workspace_id.as_str(),
            "threadId": THREAD,
            "path": path.to_str().unwrap(),
        }))
        .unwrap();
        let response = tauri::async_runtime::block_on(read_agent_inline_image(
            self.app.handle().clone(),
            request,
        ))?;
        let InvokeResponseBody::Raw(bytes) = response.body().unwrap() else {
            panic!("inline images travel as raw bytes");
        };
        Ok(bytes)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp);
    }
}

fn workspace_id(value: &str) -> WorkspaceId {
    serde_json::from_value(serde_json::Value::String(value.to_string())).unwrap()
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes
}

fn jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08];
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes
}

fn gif(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes
}

fn webp(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"RIFF\x16\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00".to_vec();
    bytes.extend_from_slice(&(width - 1).to_le_bytes()[..3]);
    bytes.extend_from_slice(&(height - 1).to_le_bytes()[..3]);
    bytes
}

fn permit_tests() -> MutexGuard<'static, ()> {
    PERMIT_TESTS.lock().unwrap_or_else(PoisonError::into_inner)
}

#[test]
fn the_request_contract_is_camel_case_and_closed() {
    let request: InlineImageRequest = serde_json::from_str(
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001","path":"/tmp/shot.png"}"#,
    )
    .unwrap();

    assert_eq!(request.workspace_id.as_str(), "w1");
    assert_eq!(request.thread_id, "agt-thread-0001");
    assert_eq!(request.path, "/tmp/shot.png");
    for rejected in [
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001","path":"/tmp/shot.png","turnId":"t"}"#,
        r#"{"workspace_id":"w1","thread_id":"agt-thread-0001","path":"/tmp/shot.png"}"#,
        r#"{"workspaceId":"w1","path":"/tmp/shot.png"}"#,
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001"}"#,
        r#"{"threadId":"agt-thread-0001","path":"/tmp/shot.png"}"#,
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001","path":7}"#,
    ] {
        assert!(serde_json::from_str::<InlineImageRequest>(rejected).is_err());
    }
}

#[test]
fn the_command_is_registered_under_its_wire_name_with_the_retry_message() {
    assert!(include_str!("runtime.rs")
        .contains("agent_inline_image_commands::read_agent_inline_image,"));
    assert_eq!(
        INLINE_IMAGE_BUSY_ERROR,
        "Another image is being read. Try again shortly."
    );
    assert_eq!(MAX_AGENT_IMAGE_BYTES, 10 * 1024 * 1024);
    assert!(INLINE_IMAGE_SIZE_ERROR.contains("10 MB"));
}

#[test]
fn reads_every_supported_format_outside_the_workspace() {
    let fixture = Fixture::new();
    for (name, bytes) in [
        ("shot.png", png(1440, 12_000)),
        ("SHOT.PNG", png(4, 9)),
        ("photo.jpg", jpeg(640, 480)),
        ("photo.jpeg", jpeg(640, 480)),
        ("loop.gif", gif(32, 32)),
        ("frame.webp", webp(800, 600)),
    ] {
        let path = fixture.file(name, &bytes);
        assert!(!path.starts_with(&fixture.root_key));
        assert_eq!(fixture.read(&path), Ok(bytes), "{name}");
    }
}

#[cfg(unix)]
#[test]
fn reads_through_a_symlinked_parent_directory() {
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    fixture.file("shot.png", &bytes);
    let alias = fixture.temp.join("alias");
    std::os::unix::fs::symlink(&fixture.outside, &alias).unwrap();

    assert_eq!(fixture.read(&alias.join("shot.png")), Ok(bytes.clone()));
    assert_eq!(fixture.read(&alias.join("../alias/./shot.png")), Ok(bytes));
}

#[test]
fn an_agent_root_owner_id_reads_through_its_registered_lease() {
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    let path = fixture.file("shot.png", &bytes);
    let owner = workspace_id(&agent_root_owner_id(&fixture.root_key));

    assert_eq!(
        fixture.read_as(&owner, THREAD, path.to_str().unwrap()),
        Ok(bytes)
    );
}

#[test]
fn rejects_paths_that_are_not_bounded_absolute_and_printable() {
    let fixture = Fixture::new();
    fixture.file("shot.png", &png(4, 9));
    let bounded = format!(
        "/{}.png",
        "x".repeat(MAX_AGENT_ATTACHMENT_PATH_BYTES - "/.png".len())
    );
    assert_eq!(bounded.len(), MAX_AGENT_ATTACHMENT_PATH_BYTES);

    for path in [
        String::new(),
        "shot.png".to_string(),
        "./shot.png".to_string(),
        "~/shot.png".to_string(),
        "file:///tmp/shot.png".to_string(),
        format!("{}/shot\n.png", fixture.outside.display()),
        format!("{}/shot.png\0", fixture.outside.display()),
        format!("{bounded}x"),
    ] {
        assert_eq!(
            fixture.read_as(&fixture.workspace_id, THREAD, &path),
            Err(INLINE_IMAGE_PATH_ERROR.to_string()),
            "{path:?}"
        );
    }
    assert_eq!(
        fixture.read_as(&fixture.workspace_id, THREAD, &bounded),
        Err(INLINE_IMAGE_UNAVAILABLE_ERROR.to_string())
    );
}

#[test]
fn rejects_missing_files_directories_and_unsupported_extensions() {
    let fixture = Fixture::new();
    let directory = fixture.outside.join("folder.png");
    fs::create_dir(&directory).unwrap();

    assert_eq!(
        fixture.read(&fixture.outside.join("missing.png")),
        Err(INLINE_IMAGE_UNAVAILABLE_ERROR.to_string())
    );
    assert_eq!(
        fixture.read(&directory),
        Err(INLINE_IMAGE_NOT_REGULAR_FILE_ERROR.to_string())
    );
    for name in [
        "drawing.svg",
        "notes.txt",
        "icon.ico",
        "photo.avif",
        "screenshot",
        ".png",
    ] {
        let path = fixture.file(name, &png(4, 9));
        assert_eq!(
            fixture.read(&path),
            Err(INLINE_IMAGE_TYPE_ERROR.to_string()),
            "{name}"
        );
    }
}

#[test]
fn rejects_content_that_is_not_the_declared_image_format() {
    let fixture = Fixture::new();

    for (name, bytes) in [
        (
            "secret.png",
            b"-----BEGIN OPENSSH PRIVATE KEY-----".to_vec(),
        ),
        ("photo.jpg", png(4, 9)),
        ("loop.gif", jpeg(4, 9)),
        ("frame.webp", gif(4, 9)),
    ] {
        let path = fixture.file(name, &bytes);
        assert_eq!(
            fixture.read(&path),
            Err(INLINE_IMAGE_CONTENT_ERROR.to_string()),
            "{name}"
        );
    }
}

#[test]
fn rejects_empty_and_oversized_files_and_accepts_the_exact_cap() {
    let fixture = Fixture::new();
    let path = fixture.file("shot.png", &[]);
    assert_eq!(
        fixture.read(&path),
        Err(INLINE_IMAGE_SIZE_ERROR.to_string())
    );

    fs::write(&path, png(4, 9)).unwrap();
    let file = OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(MAX_AGENT_IMAGE_BYTES + 1).unwrap();
    assert_eq!(
        fixture.read(&path),
        Err(INLINE_IMAGE_SIZE_ERROR.to_string())
    );

    file.set_len(MAX_AGENT_IMAGE_BYTES).unwrap();
    assert_eq!(
        fixture.read(&path).map(|bytes| bytes.len() as u64),
        Ok(MAX_AGENT_IMAGE_BYTES)
    );
}

#[test]
fn rejects_undecodable_headers_and_dimensions_beyond_the_attachment_limit() {
    let fixture = Fixture::new();
    let limit = MAX_AGENT_IMAGE_DIMENSION;

    for (width, height) in [(limit, 1), (1, limit), (1440, limit)] {
        let path = fixture.file("shot.png", &png(width, height));
        assert!(fixture.read(&path).is_ok(), "{width}x{height}");
    }
    for bytes in [
        png(limit + 1, 1),
        png(1440, limit + 1),
        png(1440, 22_222),
        png(0, 9),
        png(u32::MAX, u32::MAX),
        b"\x89PNG\r\n\x1a\nnot a header".to_vec(),
    ] {
        let path = fixture.file("shot.png", &bytes);
        assert_eq!(
            fixture.read(&path),
            Err(INLINE_IMAGE_DIMENSIONS_ERROR.to_string())
        );
    }
}

#[test]
fn rejects_images_above_the_inline_pixel_budget() {
    let fixture = Fixture::new();
    assert_eq!(MAX_INLINE_IMAGE_PIXELS, 32_000_000);

    for (name, bytes) in [
        ("shot.png", png(1440, 12_000)),
        ("shot.png", png(1_953, 16_384)),
        ("shot.png", png(5_656, 5_656)),
        ("photo.jpg", jpeg(8_000, 4_000)),
        ("loop.gif", gif(4_000, 8_000)),
        ("frame.webp", webp(8_000, 4_000)),
    ] {
        let path = fixture.file(name, &bytes);
        assert_eq!(fixture.read(&path), Ok(bytes), "{name}");
    }
    for (name, bytes) in [
        ("shot.png", png(16_384, 16_384)),
        ("shot.png", png(5_657, 5_657)),
        ("shot.png", png(2880, 16_384)),
        ("shot.png", png(1_954, 16_384)),
        ("photo.jpg", jpeg(8_000, 4_001)),
        ("loop.gif", gif(4_001, 8_000)),
        ("frame.webp", webp(8_000, 4_001)),
    ] {
        let path = fixture.file(name, &bytes);
        assert_eq!(
            fixture.read(&path),
            Err(INLINE_IMAGE_PIXELS_ERROR.to_string()),
            "{name}"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn only_local_materialized_storage_is_readable() {
    let local = libc::MNT_LOCAL as u32;
    let unrelated = (libc::MNT_RDONLY | libc::MNT_NOSUID | libc::MNT_JOURNALED) as u32;
    let compressed = libc::UF_COMPRESSED;

    assert_eq!(SF_DATALESS, 0x4000_0000);
    assert!(is_stored_locally(local, 0));
    assert!(is_stored_locally(local | unrelated, compressed));
    assert!(!is_stored_locally(0, 0));
    assert!(!is_stored_locally(unrelated, compressed));
    assert!(!is_stored_locally(local, SF_DATALESS));
    assert!(!is_stored_locally(
        local | unrelated,
        SF_DATALESS | compressed
    ));
    assert!(!is_stored_locally(0, SF_DATALESS));
}

#[cfg(target_os = "macos")]
#[test]
fn images_under_both_system_temporary_roots_are_local() {
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    let private_tmp = PathBuf::from(format!(
        "/tmp/codevo-inline-image-{}-{}.png",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&private_tmp, &bytes).unwrap();
    let user_temp = fixture.file("shot.png", &bytes);

    let from_private_tmp = fixture.read(&private_tmp);
    fs::remove_file(&private_tmp).unwrap();

    assert_eq!(from_private_tmp, Ok(bytes.clone()));
    assert_eq!(fixture.read(&user_temp), Ok(bytes));
    assert_eq!(
        ensure_stored_locally(
            Path::new("/private/tmp"),
            &fs::symlink_metadata("/private/tmp").unwrap()
        ),
        Ok(())
    );
}

#[cfg(unix)]
#[test]
fn a_final_symlink_is_judged_by_its_canonical_target() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    let image = fixture.file("real.png", &bytes);
    let secret = fixture.file("id_rsa", b"-----BEGIN OPENSSH PRIVATE KEY-----");
    let disguised = fixture.file("notes.png", b"plain text");
    let link = |name: &str, target: &Path| {
        let path = fixture.outside.join(name);
        symlink(target, &path).unwrap();
        path
    };

    assert_eq!(
        fixture.read(&link("to-secret.png", &secret)),
        Err(INLINE_IMAGE_TYPE_ERROR.to_string())
    );
    assert_eq!(
        fixture.read(&link("to-text.png", &disguised)),
        Err(INLINE_IMAGE_CONTENT_ERROR.to_string())
    );
    assert_eq!(
        fixture.read(&link("dangling.png", &fixture.outside.join("gone.png"))),
        Err(INLINE_IMAGE_UNAVAILABLE_ERROR.to_string())
    );
    assert_eq!(
        fixture.read(&link("to-image.png", &image)),
        Ok(bytes.clone())
    );
    assert_eq!(fixture.read(&link("to-image", &image)), Ok(bytes));
}

#[cfg(unix)]
#[test]
fn a_file_swapped_after_canonicalisation_is_rejected() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let path = fixture.file("shot.png", &png(4, 9));
    let other = fixture.file("other.png", &png(4, 9));
    let fifo = fixture.outside.join("pipe.png");
    let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let canonical = path.canonicalize().unwrap();
    let before = fs::symlink_metadata(&canonical).unwrap();
    assert!(open_bound_image(&canonical, &before).is_ok());

    assert_eq!(
        open_bound_image(&other.canonicalize().unwrap(), &before).err(),
        Some(INLINE_IMAGE_CHANGED_ERROR.to_string())
    );
    assert_eq!(
        open_bound_image(&fifo.canonicalize().unwrap(), &before).err(),
        Some(INLINE_IMAGE_CHANGED_ERROR.to_string())
    );
    fs::remove_file(&canonical).unwrap();
    symlink(&other, &canonical).unwrap();
    assert_eq!(
        open_bound_image(&canonical, &before).err(),
        Some(INLINE_IMAGE_UNAVAILABLE_ERROR.to_string())
    );
    assert_eq!(
        fixture.read(&fifo),
        Err(INLINE_IMAGE_NOT_REGULAR_FILE_ERROR.to_string())
    );
}

#[test]
fn a_file_rewritten_during_the_read_is_rejected() {
    let fixture = Fixture::new();
    let path = fixture.file("shot.png", &png(4, 9));
    let before = fs::symlink_metadata(&path).unwrap();
    let (file, opened) = open_bound_image(&path, &before).unwrap();

    let mut grown = png(4, 9);
    grown.extend_from_slice(b"appended");
    fs::write(&path, grown).unwrap();

    assert_eq!(
        read_stable_bytes(file, &opened),
        Err(INLINE_IMAGE_CHANGED_ERROR.to_string())
    );
}

#[test]
fn an_untrusted_or_unregistered_workspace_fails_closed_before_the_path_is_touched() {
    let fixture = Fixture::new();
    let image = fixture.file("shot.png", &png(4, 9));
    let image = image.to_str().unwrap();
    let missing = fixture.outside.join("missing.png");
    let missing = missing.to_str().unwrap();
    let root_owner = workspace_id(&agent_root_owner_id(&fixture.root_key));

    for owner in [
        workspace_id("workspace-nope"),
        workspace_id("agent-root:0000000000000000"),
        workspace_id(""),
    ] {
        for path in [image, missing] {
            assert_eq!(
                fixture.read_as(&owner, THREAD, path),
                Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
            );
        }
    }

    fixture.set_trusted(false);

    for owner in [&fixture.workspace_id, &root_owner] {
        for path in [image, missing] {
            assert_eq!(
                fixture.read_as(owner, THREAD, path),
                Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string())
            );
        }
    }
}

#[test]
fn a_thread_the_workspace_does_not_own_fails_closed_before_the_path_is_touched() {
    let fixture = Fixture::new();
    let image = fixture.file("shot.png", &png(4, 9));
    let image = image.to_str().unwrap();
    let missing = fixture.outside.join("missing.png");
    let missing = missing.to_str().unwrap();
    fixture.write_thread_file("/another/project", "agt-thread-0002");

    for thread in [
        "agt-thread-0002",
        "agt-thread-9999",
        "../agt-thread-0001",
        "",
    ] {
        for path in [image, missing] {
            assert_eq!(
                fixture.read_as(&fixture.workspace_id, thread, path),
                Err(INLINE_IMAGE_OWNER_ERROR.to_string()),
                "{thread:?}"
            );
        }
    }
    assert!(fixture
        .read_as(&fixture.workspace_id, THREAD, image)
        .is_ok());
}

#[test]
fn authority_revoked_during_the_read_withholds_the_bytes() {
    let fixture = Fixture::new();
    let image = fixture.file("shot.png", &png(4, 9));
    let image = image.to_str().unwrap();
    let authority = InlineImageAuthority::from_app(fixture.app.handle());
    let checks = Cell::new(0);
    let after_first_check = |revoke: &dyn Fn()| {
        checks.set(0);
        read_inline_image(image, || {
            let owner = authority.owning_workspace(&fixture.workspace_id, THREAD);
            checks.set(checks.get() + 1);
            if checks.get() == 1 {
                revoke();
            }
            owner
        })
    };

    assert!(after_first_check(&|| {}).is_ok());
    assert_eq!(checks.get(), 2);
    assert_eq!(
        after_first_check(
            &|| fs::remove_file(fixture.thread_file(&fixture.root_key, THREAD)).unwrap()
        ),
        Err(INLINE_IMAGE_OWNER_ERROR.to_string())
    );
    fixture.write_thread_file(&fixture.root_key, THREAD);
    assert_eq!(
        after_first_check(&|| fixture.set_trusted(false)),
        Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string())
    );
    assert_eq!(
        read_inline_image(image, || {
            checks.set(checks.get() + 1);
            Ok(workspace_id(&format!("workspace-{}", checks.get())))
        }),
        Err(INLINE_IMAGE_OWNER_ERROR.to_string())
    );
}

#[test]
fn the_command_returns_raw_bytes_and_releases_its_permit_on_every_outcome() {
    let _serial = permit_tests();
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    let image = fixture.file("shot.png", &bytes);

    assert_eq!(fixture.invoke(&image), Ok(bytes.clone()));
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    assert_eq!(
        fixture.invoke(&fixture.outside.join("missing.png")),
        Err(INLINE_IMAGE_UNAVAILABLE_ERROR.to_string())
    );
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    fixture.set_trusted(false);
    assert_eq!(
        fixture.invoke(&image),
        Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string())
    );
    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
}

#[test]
fn exhausted_permits_return_the_retry_message_without_queueing() {
    let _serial = permit_tests();
    let fixture = Fixture::new();
    let bytes = png(4, 9);
    let image = fixture.file("shot.png", &bytes);
    let held: Vec<ReadPermit> = (0..MAX_CONCURRENT_INLINE_IMAGE_READS)
        .map(|_| ReadPermit::acquire().unwrap())
        .collect();

    assert_eq!(
        fixture.invoke(&image),
        Err("Another image is being read. Try again shortly.".to_string())
    );
    assert_eq!(
        ACTIVE_READS.load(Ordering::Acquire),
        MAX_CONCURRENT_INLINE_IMAGE_READS
    );

    drop(held);

    assert_eq!(ACTIVE_READS.load(Ordering::Acquire), 0);
    assert_eq!(fixture.invoke(&image), Ok(bytes));
}
