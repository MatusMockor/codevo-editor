use super::super::agent_attachment_paths;
use super::*;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::time::UNIX_EPOCH;

static FIXTURE_NONCE: AtomicU64 = AtomicU64::new(0);

const WORKSPACE: &str = "workspace-alpha";
const OTHER_WORKSPACE: &str = "workspace-beta";
const THREAD: &str = "agt-thread-0001";
const ROOT_KEY: &str = "/workspace/alpha";

struct TemporaryStore {
    root: PathBuf,
    root_keys: Vec<String>,
    store: AgentAttachmentStore,
}

impl TemporaryStore {
    fn create(label: &str) -> Self {
        let nonce = FIXTURE_NONCE.fetch_add(1, AtomicOrdering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "agent-attachment-store-{label}-{}-{nonce}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create fixture root");
        Self {
            store: AgentAttachmentStore::new(root.clone()),
            root_keys: vec![ROOT_KEY.to_string()],
            root,
        }
    }

    fn owner(&self) -> AgentAttachmentOwner<'_> {
        self.owner_for(THREAD)
    }

    fn owner_for<'a>(&'a self, thread_id: &'a str) -> AgentAttachmentOwner<'a> {
        AgentAttachmentOwner {
            workspace_id: WORKSPACE,
            thread_id,
            root_keys: &self.root_keys,
        }
    }

    fn foreign_owner(&self) -> AgentAttachmentOwner<'_> {
        AgentAttachmentOwner {
            workspace_id: OTHER_WORKSPACE,
            thread_id: THREAD,
            root_keys: &self.root_keys,
        }
    }

    fn persist_thread_file(&self, root_key: &str, thread_id: &str) {
        let directory = self
            .root
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(root_key));
        fs::create_dir_all(&directory).expect("create thread root");
        fs::write(directory.join(format!("{thread_id}.json")), b"{}").expect("write thread file");
    }

    fn pending(&self, attachment_id: &str, extension: &str) -> PathBuf {
        agent_attachment_pending_file(&self.root, attachment_id, extension).expect("pending path")
    }

    fn stored(&self, attachment_id: &str, extension: &str) -> PathBuf {
        agent_attachment_thread_file(&self.root, THREAD, attachment_id, extension)
            .expect("stored path")
    }
}

impl Drop for TemporaryStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes
}

fn gif_bytes(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&[0x80, 0, 0]);
    bytes
}

fn jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    bytes.extend_from_slice(&[0xff, 0xc0, 0x00, 0x11, 0x08]);
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    bytes
}

fn webp_lossless_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8L");
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.push(0x2f);
    let packed = (width - 1) | ((height - 1) << 14);
    bytes.extend_from_slice(&packed.to_le_bytes());
    bytes
}

fn image_header(name: &str, mime: AgentImageMime) -> StageAgentAttachmentHeader {
    StageAgentAttachmentHeader {
        kind: AgentAttachmentKind::Image,
        name: name.to_string(),
        mime: Some(mime),
        width: None,
        height: None,
    }
}

fn file_header(name: &str) -> StageAgentAttachmentHeader {
    StageAgentAttachmentHeader {
        kind: AgentAttachmentKind::File,
        name: name.to_string(),
        mime: None,
        width: None,
        height: None,
    }
}

#[cfg(unix)]
fn age_path(path: &Path, seconds: u64) {
    let when = SystemTime::now() - Duration::from_secs(seconds);
    let seconds = when.duration_since(UNIX_EPOCH).expect("epoch").as_secs() as libc::time_t;
    let times = [
        libc::timeval {
            tv_sec: seconds,
            tv_usec: 0,
        },
        libc::timeval {
            tv_sec: seconds,
            tv_usec: 0,
        },
    ];
    let encoded = std::ffi::CString::new(path.to_str().expect("utf-8 path")).expect("c path");
    assert_eq!(
        unsafe { libc::utimes(encoded.as_ptr(), times.as_ptr()) },
        0,
        "aging {path:?} must succeed"
    );
}

#[cfg(unix)]
fn mode_of(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path).expect("metadata").permissions().mode() & 0o777
}

#[test]
fn stage_writes_a_private_pending_file_named_from_the_verified_mime() {
    let fixture = TemporaryStore::create("stage");

    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("shot.PNG", AgentImageMime::Png),
            &png_bytes(4, 9),
        )
        .expect("stage image");

    assert_eq!(staged.name, "shot.PNG");
    assert_eq!(staged.mime, Some(AgentImageMime::Png));
    assert_eq!(staged.bytes, png_bytes(4, 9).len() as u64);
    assert_eq!((staged.width, staged.height), (Some(4), Some(9)));
    assert_eq!(
        ensure_agent_attachment_file_id(&staged.attachment_id),
        Ok(staged.attachment_id.as_str())
    );
    let path = fixture.pending(&staged.attachment_id, "png");
    assert_eq!(fs::read(&path).expect("pending bytes"), png_bytes(4, 9));
    assert!(
        staged.prompt_line_bytes_max
            >= prompt_line(
                AgentAttachmentKind::Image,
                "shot.PNG",
                path.to_str().expect("utf-8")
            )
            .len()
    );
}

#[cfg(unix)]
#[test]
fn stage_keeps_the_pending_directory_at_0700_and_its_file_at_0600() {
    let fixture = TemporaryStore::create("modes");

    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");

    assert_eq!(
        mode_of(&fixture.pending(&staged.attachment_id, "png")),
        0o600
    );
    assert_eq!(
        mode_of(&agent_attachment_pending_directory(&fixture.root).expect("pending directory")),
        0o700
    );
    assert_eq!(mode_of(&agent_attachment_root(&fixture.root)), 0o700);
}

#[test]
fn stage_refuses_bytes_whose_magic_does_not_match_the_declared_mime() {
    let fixture = TemporaryStore::create("magic");

    let refused = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &gif_bytes(2, 2),
        )
        .expect_err("magic mismatch must be refused");

    assert_eq!(refused, AGENT_ATTACHMENT_MAGIC_ERROR);
}

#[test]
fn stage_refuses_declared_dimensions_that_disagree_with_the_bytes() {
    let fixture = TemporaryStore::create("dimensions");
    let mut header = image_header("a.png", AgentImageMime::Png);
    header.width = Some(99);
    header.height = Some(1);

    let refused = fixture
        .store
        .stage_bytes(WORKSPACE, &header, &png_bytes(1, 1))
        .expect_err("declared dimensions must match the bytes");

    assert_eq!(refused, AGENT_ATTACHMENT_KIND_MISMATCH_ERROR);
}

#[test]
fn every_supported_image_header_yields_its_real_dimensions() {
    let fixture = TemporaryStore::create("headers");

    let cases: [(AgentImageMime, Vec<u8>, (u32, u32)); 4] = [
        (AgentImageMime::Png, png_bytes(3, 7), (3, 7)),
        (AgentImageMime::Gif, gif_bytes(11, 13), (11, 13)),
        (AgentImageMime::Jpeg, jpeg_bytes(17, 19), (17, 19)),
        (AgentImageMime::Webp, webp_lossless_bytes(23, 29), (23, 29)),
    ];
    for (mime, bytes, expected) in cases {
        let staged = fixture
            .store
            .stage_bytes(WORKSPACE, &image_header("a", mime), &bytes)
            .expect("stage image");
        assert_eq!(
            (staged.width, staged.height),
            (Some(expected.0), Some(expected.1)),
            "{mime:?}"
        );
    }
}

#[test]
fn staged_generic_files_keep_a_bounded_lowercase_extension() {
    let fixture = TemporaryStore::create("file-extension");

    let kept = fixture
        .store
        .stage_bytes(WORKSPACE, &file_header("notes.MD"), b"hello")
        .expect("stage file");
    let replaced = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &file_header("archive.tar.gz.verylongextension"),
            b"hello",
        )
        .expect("stage file");
    let part_like = fixture
        .store
        .stage_bytes(WORKSPACE, &file_header("draft.part"), b"hello")
        .expect("stage file");

    assert!(fixture.pending(&kept.attachment_id, "md").exists());
    assert!(fixture.pending(&replaced.attachment_id, "bin").exists());
    assert!(fixture.pending(&part_like.attachment_id, "bin").exists());
}

#[test]
fn release_removes_only_a_pending_file_owned_by_the_same_workspace() {
    let fixture = TemporaryStore::create("release");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");

    let foreign = fixture
        .store
        .release(OTHER_WORKSPACE, &staged.attachment_id)
        .expect_err("a foreign workspace must not release");
    assert_eq!(foreign, AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR);
    assert!(fixture.pending(&staged.attachment_id, "png").exists());

    fixture
        .store
        .release(WORKSPACE, &staged.attachment_id)
        .expect("release");

    assert!(!fixture.pending(&staged.attachment_id, "png").exists());
    assert_eq!(
        fixture.store.release(WORKSPACE, &staged.attachment_id),
        Ok(()),
        "releasing twice is success"
    );
}

#[test]
fn claim_moves_the_whole_set_and_reports_the_exact_prompt_line() {
    let fixture = TemporaryStore::create("claim");
    let image = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("shot.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    let file = fixture
        .store
        .stage_bytes(WORKSPACE, &file_header("notes.md"), b"hello")
        .expect("stage file");

    let claimed = fixture
        .store
        .claim(
            &fixture.owner(),
            &[image.attachment_id.clone(), file.attachment_id.clone()],
        )
        .expect("claim");

    let image_path = fixture.stored(&image.attachment_id, "png");
    assert_eq!(claimed.len(), 2);
    assert_eq!(claimed[0].stored_path, image_path.to_string_lossy());
    assert_eq!(
        claimed[0].prompt_line,
        format!(
            "[Attached image \"shot.png\" is saved at: {}]",
            image_path.display()
        )
    );
    assert_eq!(
        claimed[1].prompt_line,
        format!(
            "[Attached file \"notes.md\" is saved at: {}]",
            fixture.stored(&file.attachment_id, "md").display()
        )
    );
    assert!(!fixture.pending(&image.attachment_id, "png").exists());
}

#[test]
fn claim_rolls_every_rename_back_when_one_member_of_the_set_fails() {
    let fixture = TemporaryStore::create("claim-rollback");
    let first = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage first");
    let second = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("b.png", AgentImageMime::Png),
            &png_bytes(2, 2),
        )
        .expect("stage second");
    fs::remove_file(fixture.pending(&second.attachment_id, "png")).expect("drop second file");

    let refused = fixture
        .store
        .claim(
            &fixture.owner(),
            &[first.attachment_id.clone(), second.attachment_id.clone()],
        )
        .expect_err("a partial claim must be refused");

    assert_eq!(refused, AGENT_ATTACHMENT_UNAVAILABLE_ERROR);
    assert!(
        fixture.pending(&first.attachment_id, "png").exists(),
        "the first file is moved back to pending"
    );
    assert!(!fixture.stored(&first.attachment_id, "png").exists());
    let reclaimed = fixture
        .store
        .claim(&fixture.owner(), std::slice::from_ref(&first.attachment_id))
        .expect("the rolled back entry is still claimable");
    assert_eq!(reclaimed.len(), 1);
    assert!(fixture.stored(&first.attachment_id, "png").exists());
}

#[test]
fn claim_refuses_a_pending_attachment_owned_by_another_workspace() {
    let fixture = TemporaryStore::create("claim-workspace");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");

    let refused = fixture
        .store
        .claim(
            &fixture.foreign_owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect_err("a foreign workspace must not claim");

    assert_eq!(refused, AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR);
    assert!(fixture.pending(&staged.attachment_id, "png").exists());
}

#[test]
fn claim_for_turn_resolves_the_stored_path_and_the_prompt_line_without_a_client_path() {
    let fixture = TemporaryStore::create("turn");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("shot.png", AgentImageMime::Png),
            &png_bytes(5, 6),
        )
        .expect("stage image");

    let resolved = fixture
        .store
        .claim_for_turn(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim for turn");

    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].kind, AgentAttachmentKind::Image);
    assert_eq!(resolved[0].mime, Some(AgentImageMime::Png));
    assert_eq!(
        resolved[0].path,
        fixture.stored(&staged.attachment_id, "png")
    );
    assert_eq!(resolved[0].name.as_deref(), Some("shot.png"));
    assert_eq!(
        prompt_line(
            resolved[0].kind,
            resolved[0].name.as_deref().expect("claimed name"),
            &resolved[0].stored_path
        ),
        format!(
            "[Attached image \"shot.png\" is saved at: {}]",
            fixture.stored(&staged.attachment_id, "png").display()
        )
    );
    assert_eq!(
        fixture.store.read_turn_image(&resolved[0]),
        Ok(png_bytes(5, 6))
    );
}

#[test]
fn claim_for_turn_refuses_an_attachment_claimed_by_another_thread() {
    let fixture = TemporaryStore::create("turn-thread");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim");

    let refused = fixture
        .store
        .claim_for_turn(
            &fixture.owner_for("agt-thread-0002"),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect_err("a foreign thread must not resolve the attachment");

    assert_eq!(refused, AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR);
}

#[test]
fn claim_for_turn_reports_a_swept_attachment_as_no_longer_available() {
    let fixture = TemporaryStore::create("turn-missing");

    let refused = fixture
        .store
        .claim_for_turn(&fixture.owner(), &["0".repeat(32)])
        .expect_err("a missing attachment must be refused");

    assert_eq!(refused, AGENT_ATTACHMENT_UNAVAILABLE_ERROR);
}

#[test]
fn read_is_bounded_and_refuses_a_file_over_the_thumbnail_budget() {
    let fixture = TemporaryStore::create("read-bounds");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim");

    assert_eq!(
        fixture.store.read_claimed(
            &fixture.owner(),
            &staged.attachment_id,
            MAX_AGENT_IMAGE_BYTES
        ),
        Ok(png_bytes(1, 1))
    );
    assert_eq!(
        fixture
            .store
            .read_claimed(&fixture.owner(), &staged.attachment_id, 4)
            .expect_err("a file over the budget must be refused"),
        AGENT_ATTACHMENT_TOO_LARGE_ERROR
    );
}

#[test]
fn resolution_refuses_every_identifier_that_could_escape_the_attachment_root() {
    let fixture = TemporaryStore::create("containment");

    for thread_id in ["..", "../../etc", "/etc", "agt/../../etc"] {
        assert!(
            fixture
                .store
                .resolve_claimed_path(&fixture.owner_for(thread_id), &"a".repeat(32))
                .is_err(),
            "thread id {thread_id} must be refused"
        );
    }
    for attachment_id in [
        "..",
        "../secret",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "a".repeat(31).as_str(),
    ] {
        assert!(
            fixture
                .store
                .resolve_claimed_path(&fixture.owner(), attachment_id)
                .is_err(),
            "attachment id {attachment_id} must be refused"
        );
    }
}

#[cfg(unix)]
#[test]
fn reveal_resolution_refuses_a_symlink_planted_in_the_thread_directory() {
    use std::os::unix::fs::symlink;

    let fixture = TemporaryStore::create("containment-symlink");
    let secret = fixture.root.join("secret.png");
    fs::write(&secret, png_bytes(1, 1)).expect("write secret");
    let attachment_id = "b".repeat(32);
    let directory = agent_attachment_thread_directory(&fixture.root, THREAD).expect("thread dir");
    fs::create_dir_all(&directory).expect("create thread dir");
    symlink(&secret, directory.join(format!("{attachment_id}.png"))).expect("plant symlink");
    fixture.persist_thread_file(ROOT_KEY, THREAD);

    let refused = fixture
        .store
        .resolve_claimed_path(&fixture.owner(), &attachment_id)
        .expect_err("a symlink must not resolve");

    assert_eq!(
        refused,
        agent_attachment_paths::AGENT_ATTACHMENT_CONTAINMENT_ERROR
    );
}

#[test]
fn constructing_the_store_never_touches_the_filesystem() {
    let fixture = TemporaryStore::create("cold-start");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    age_path(&fixture.pending(&staged.attachment_id, "png"), 25 * 60 * 60);

    let restarted = AgentAttachmentStore::new(fixture.root.clone());

    assert!(
        fixture.pending(&staged.attachment_id, "png").exists(),
        "construction must not crawl the store"
    );
    restarted.sweep_all();
    assert!(!fixture.pending(&staged.attachment_id, "png").exists());
}

#[test]
fn read_refuses_a_thread_that_is_not_owned_by_the_callers_root_after_a_restart() {
    let fixture = TemporaryStore::create("foreign-root");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim");
    let restarted = AgentAttachmentStore::new(fixture.root.clone());
    let foreign_keys = vec!["/workspace/other".to_string()];
    let foreign = AgentAttachmentOwner {
        workspace_id: WORKSPACE,
        thread_id: THREAD,
        root_keys: &foreign_keys,
    };

    let refused = restarted
        .resolve_claimed_path(&foreign, &staged.attachment_id)
        .expect_err("another root must not read this thread");

    assert_eq!(refused, AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR);
    fixture.persist_thread_file(ROOT_KEY, THREAD);
    assert_eq!(
        restarted.resolve_claimed_path(&fixture.owner(), &staged.attachment_id),
        Ok(fixture.stored(&staged.attachment_id, "png"))
    );
}

#[test]
fn a_turn_resolves_an_attachment_whose_claim_record_is_gone_but_whose_file_remains() {
    let fixture = TemporaryStore::create("evicted-record");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("shot.png", AgentImageMime::Png),
            &png_bytes(3, 4),
        )
        .expect("stage image");
    fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim");
    fixture.persist_thread_file(ROOT_KEY, THREAD);
    let restarted = AgentAttachmentStore::new(fixture.root.clone());

    let resolved = restarted
        .claim_for_turn(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("resolve without a claim record");

    assert_eq!(resolved[0].name, None);
    assert_eq!(resolved[0].kind, AgentAttachmentKind::Image);
    assert_eq!(resolved[0].mime, Some(AgentImageMime::Png));
    assert_eq!(resolved[0].bytes, png_bytes(3, 4).len() as u64);
    assert_eq!(
        resolved[0].path,
        fixture.stored(&staged.attachment_id, "png")
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_candidate_is_refused_with_a_definite_message() {
    use std::os::unix::fs::symlink;

    let fixture = TemporaryStore::create("symlink-candidate");
    let target = fixture.root.join("target.png");
    let alias = fixture.root.join("alias.png");
    fs::write(&target, png_bytes(1, 1)).expect("write target");
    symlink(&target, &alias).expect("symlink");

    let refused = fixture
        .store
        .read_candidate(alias.to_str().expect("utf-8"))
        .expect_err("a symlink must be refused");

    assert_eq!(refused, AGENT_ATTACHMENT_SYMLINK_ERROR);
}

#[cfg(unix)]
#[test]
fn a_symlinked_threads_directory_cannot_place_a_claim_outside_the_root() {
    use std::os::unix::fs::symlink;

    let fixture = TemporaryStore::create("symlink-threads");
    let outside = fixture.root.join("outside");
    fs::create_dir_all(&outside).expect("create outside");
    fs::create_dir_all(agent_attachment_root(&fixture.root)).expect("create attachment root");
    symlink(
        &outside,
        agent_attachment_root(&fixture.root).join(AGENT_ATTACHMENT_THREADS_DIR_NAME),
    )
    .expect("symlink threads");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");

    let refused = fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect_err("a redirected threads directory must be refused");

    assert_eq!(
        refused,
        agent_attachment_paths::AGENT_ATTACHMENT_CONTAINMENT_ERROR
    );
    assert!(!outside.join(THREAD).exists());
}

#[cfg(unix)]
#[test]
fn sweep_advances_past_its_window_so_no_pending_file_is_skipped_forever() {
    let fixture = TemporaryStore::create("sweep-window");
    let directory = agent_attachment_pending_directory(&fixture.root).expect("pending directory");
    fs::create_dir_all(&directory).expect("create pending directory");
    let total = MAX_AGENT_ATTACHMENT_SWEEP_ENTRIES + 8;
    for index in 0..total {
        let path = directory.join(format!("{index:032x}.png"));
        fs::write(&path, b"x").expect("write pending");
        age_path(&path, 25 * 60 * 60);
    }

    let first = fixture.store.sweep();
    let second = fixture.store.sweep();

    assert!(first.pending_truncated, "the first window is truncated");
    assert!(!second.pending_truncated, "the second window finishes");
    assert_eq!(
        fs::read_dir(&directory)
            .expect("read pending directory")
            .count(),
        0,
        "every expired file is swept across the two windows"
    );
}

#[cfg(unix)]
#[test]
fn sweep_keeps_a_thread_directory_whose_root_lies_beyond_the_scan_cap() {
    let fixture = TemporaryStore::create("sweep-many-roots");
    let thread_id = "agt-thread-9100";
    let directory =
        agent_attachment_thread_directory(&fixture.root, thread_id).expect("thread directory");
    fs::create_dir_all(&directory).expect("create thread directory");
    for index in 0..=MAX_AGENT_ATTACHMENT_THREAD_ROOTS {
        let root_key = format!("/workspace/root-{index}");
        let root = fixture
            .root
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(&root_key));
        fs::create_dir_all(&root).expect("create thread root");
        if index == MAX_AGENT_ATTACHMENT_THREAD_ROOTS {
            fs::write(root.join(format!("{thread_id}.json")), b"{}").expect("write thread file");
        }
    }
    age_path(&directory, 25 * 60 * 60);

    fixture.store.sweep_all();

    assert!(
        directory.exists(),
        "a truncated root scan must never sweep a live thread"
    );
}

#[test]
fn resolution_recovers_the_extension_from_disk_after_a_restart() {
    let fixture = TemporaryStore::create("restart");
    let staged = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage image");
    fixture
        .store
        .claim(
            &fixture.owner(),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim");

    fixture.persist_thread_file(ROOT_KEY, THREAD);
    let restarted = AgentAttachmentStore::new(fixture.root.clone());

    assert_eq!(
        restarted.resolve_claimed_path(&fixture.owner(), &staged.attachment_id),
        Ok(fixture.stored(&staged.attachment_id, "png"))
    );
}

#[cfg(unix)]
#[test]
fn sweep_removes_pending_and_part_files_past_their_expiry_and_keeps_fresh_ones() {
    let fixture = TemporaryStore::create("sweep-expiry");
    let expired = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("old.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect("stage expired");
    let fresh = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("new.png", AgentImageMime::Png),
            &png_bytes(2, 2),
        )
        .expect("stage fresh");
    let part = agent_attachment_pending_part_file(&fixture.root, &"c".repeat(32)).expect("part");
    fs::write(&part, b"partial").expect("write part");
    age_path(
        &fixture.pending(&expired.attachment_id, "png"),
        25 * 60 * 60,
    );
    age_path(&part, 2 * 60 * 60);

    fixture.store.sweep_all();

    assert!(!fixture.pending(&expired.attachment_id, "png").exists());
    assert!(!part.exists());
    assert!(fixture.pending(&fresh.attachment_id, "png").exists());
    assert_eq!(
        fixture
            .store
            .claim(
                &fixture.owner(),
                std::slice::from_ref(&expired.attachment_id)
            )
            .expect_err("a swept attachment is gone"),
        AGENT_ATTACHMENT_UNAVAILABLE_ERROR
    );
}

#[cfg(unix)]
#[test]
fn sweep_removes_an_orphan_thread_directory_and_keeps_one_with_a_saved_thread() {
    let fixture = TemporaryStore::create("sweep-orphan");
    let orphan =
        agent_attachment_thread_directory(&fixture.root, "agt-thread-9001").expect("orphan");
    let kept = agent_attachment_thread_directory(&fixture.root, "agt-thread-9002").expect("kept");
    fs::create_dir_all(&orphan).expect("create orphan");
    fs::create_dir_all(&kept).expect("create kept");
    let thread_root = fixture.root.join(AGENT_THREAD_STORE_DIR_NAME).join("00");
    fs::create_dir_all(&thread_root).expect("create thread root");
    fs::write(thread_root.join("agt-thread-9002.json"), b"{}").expect("write thread file");
    age_path(&orphan, 25 * 60 * 60);
    age_path(&kept, 25 * 60 * 60);

    fixture.store.sweep_all();

    assert!(!orphan.exists(), "an orphan directory is swept");
    assert!(kept.exists(), "a directory with a saved thread is kept");
}

#[cfg(unix)]
#[test]
fn sweep_keeps_a_fresh_thread_directory_that_has_no_saved_thread_yet() {
    let fixture = TemporaryStore::create("sweep-fresh-thread");
    let fresh = agent_attachment_thread_directory(&fixture.root, "agt-thread-9003").expect("fresh");
    fs::create_dir_all(&fresh).expect("create fresh");

    fixture.store.sweep_all();

    assert!(fresh.exists());
}

#[test]
fn staging_refuses_to_exceed_the_pending_capacity_of_one_workspace() {
    let fixture = TemporaryStore::create("capacity");
    for _ in 0..MAX_PENDING_AGENT_ATTACHMENTS_PER_WORKSPACE {
        fixture
            .store
            .stage_bytes(
                WORKSPACE,
                &image_header("a.png", AgentImageMime::Png),
                &png_bytes(1, 1),
            )
            .expect("stage image");
    }

    let refused = fixture
        .store
        .stage_bytes(
            WORKSPACE,
            &image_header("a.png", AgentImageMime::Png),
            &png_bytes(1, 1),
        )
        .expect_err("the workspace pending budget is bounded");

    assert_eq!(refused, AGENT_ATTACHMENT_CAPACITY_ERROR);
}

#[test]
fn a_turn_never_carries_more_than_the_supported_number_of_attachments() {
    let fixture = TemporaryStore::create("turn-bound");
    let ids: Vec<String> = (0..=MAX_AGENT_TURN_ATTACHMENTS)
        .map(|index| format!("{index:032x}"))
        .collect();

    let refused = fixture
        .store
        .claim(&fixture.owner(), &ids)
        .expect_err("a turn is bounded");

    assert!(
        refused.contains("maximum of 8 attachments"),
        "got: {refused}"
    );
}

#[test]
fn staging_from_a_path_refuses_a_directory_and_copies_a_regular_file() {
    let fixture = TemporaryStore::create("from-path");
    let source = fixture.root.join("source.png");
    fs::write(&source, png_bytes(2, 3)).expect("write source");

    let staged = fixture
        .store
        .stage_from_path(
            WORKSPACE,
            &image_header("source.png", AgentImageMime::Png),
            source.to_str().expect("utf-8"),
        )
        .expect("stage from path");
    let refused = fixture
        .store
        .stage_from_path(
            WORKSPACE,
            &image_header("root", AgentImageMime::Png),
            fixture.root.to_str().expect("utf-8"),
        )
        .expect_err("a directory must be refused");

    assert_eq!((staged.width, staged.height), (Some(2), Some(3)));
    assert_eq!(refused, AGENT_ATTACHMENT_NOT_REGULAR_FILE_ERROR);
}

#[test]
fn candidate_inspection_reports_size_regularity_and_the_extension_mime() {
    let fixture = TemporaryStore::create("inspect");
    let source = fixture.root.join("photo.JPEG");
    fs::write(&source, jpeg_bytes(1, 1)).expect("write source");

    let candidate = fixture
        .store
        .inspect_candidate(source.to_str().expect("utf-8"))
        .expect("inspect candidate");

    assert_eq!(candidate.bytes, jpeg_bytes(1, 1).len() as u64);
    assert!(candidate.is_regular_file);
    assert_eq!(candidate.extension_mime, Some(AgentImageMime::Jpeg));
    assert!(fixture.store.inspect_candidate("relative/path").is_err());
}

#[test]
fn lookup_reaches_the_full_supported_thread_capacity_after_restart() {
    let fixture = TemporaryStore::create("restart-full-thread");
    let directory = agent_attachment_thread_directory(&fixture.root, THREAD).expect("directory");
    fs::create_dir_all(&directory).expect("create directory");
    // Use more than 64 attachments and fill the complete supported persisted-thread budget.
    // Direct fixtures avoid testing staging/sweeping thousands of times here.
    let ids: Vec<String> = (0..MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES)
        .map(|index| format!("{index:032x}"))
        .collect();
    for id in &ids {
        fs::write(fixture.stored(id, "txt"), b"attachment").expect("persist attachment");
    }
    fixture.persist_thread_file(ROOT_KEY, THREAD);
    let restarted = AgentAttachmentStore::new(fixture.root.clone());
    // Directory order is unspecified: choose the final on-disk entry so the old
    // first-64 lookup deterministically fails on every supported filesystem.
    let final_entry = fs::read_dir(&directory)
        .expect("entries")
        .last()
        .unwrap()
        .unwrap();
    let id = final_entry
        .path()
        .file_stem()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        restarted.resolve_claimed_path(&fixture.owner(), &id),
        Ok(fixture.stored(&id, "txt"))
    );
    let resolved = restarted
        .claim_for_turn(&fixture.owner(), &[id])
        .expect("resolve turn");
    assert_eq!(resolved[0].kind, AgentAttachmentKind::File);
}

#[test]
fn oversized_attachment_lookup_reports_incomplete_scan_instead_of_missing_file() {
    let fixture = TemporaryStore::create("restart-over-limit");
    let directory = agent_attachment_thread_directory(&fixture.root, THREAD).expect("directory");
    fs::create_dir_all(&directory).expect("create directory");
    for index in 0..=MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES {
        fs::write(directory.join(format!("{index:032x}.txt")), b"x").expect("write entry");
    }
    fixture.persist_thread_file(ROOT_KEY, THREAD);
    let restarted = AgentAttachmentStore::new(fixture.root.clone());
    assert_eq!(
        restarted.resolve_claimed_path(&fixture.owner(), &"f".repeat(32)),
        Err(AGENT_ATTACHMENT_DIRECTORY_LIMIT_ERROR.to_string())
    );
}
