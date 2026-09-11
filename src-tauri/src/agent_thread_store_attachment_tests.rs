use super::agent_attachment_paths::{
    agent_attachment_root, agent_attachment_thread_directory, ensure_within_agent_attachment_root,
    AGENT_ATTACHMENT_CONTAINMENT_ERROR,
};
use super::*;
use serde_json::{json, Value};
use std::sync::atomic::AtomicU64;

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

const ROOT_KEY: &str = "/workspace";

struct TempStore {
    base: PathBuf,
}

impl TempStore {
    fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!(
            "agent-attachment-store-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("create temp store directory");
        Self { base }
    }

    fn store(&self) -> AgentThreadStore {
        AgentThreadStore::new(self.base.clone())
    }

    fn thread_path(&self, thread_id: &str) -> PathBuf {
        self.base
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(ROOT_KEY))
            .join(format!("{thread_id}.json"))
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn document_value() -> Value {
    json!({
        "schemaVersion": AGENT_THREAD_SCHEMA_VERSION,
        "thread": serde_json::from_str::<Value>(ATTACHMENT_FIXTURE).expect("fixture value")
    })
}

const ATTACHMENT_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/agent-thread-with-attachments.json");
const LEGACY_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/agent-thread-legacy-no-attachments.json");

fn fixture_document(raw: &str) -> AgentThreadDocument {
    AgentThreadDocument {
        schema_version: AGENT_THREAD_SCHEMA_VERSION,
        thread: serde_json::from_str(raw).expect("shared fixture loads"),
    }
}

#[test]
fn the_shared_attachment_fixture_round_trips_the_typescript_wire_shape() {
    let document = fixture_document(ATTACHMENT_FIXTURE);
    let turn = &document.thread.turns[0];

    assert_eq!(
        turn.attachments[0],
        AgentAttachment::Image {
            attachment_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9".to_string(),
            name: "square.png".to_string(),
            mime: AgentImageMime::Png,
            bytes: 204_800,
            width: 1_280,
            height: 720,
            stored_path:
                "/data/agent-attachments/threads/agt-t1-0001/0a1b2c3d4e5f60718293a4b5c6d7e8f9.png"
                    .to_string(),
        }
    );
    assert_eq!(
        turn.attachments[1],
        AgentAttachment::File {
            attachment_id: "112233445566778899001122334455aa".to_string(),
            name: "notes.txt".to_string(),
            bytes: 4_096,
            stored_path:
                "/data/agent-attachments/threads/agt-t1-0001/112233445566778899001122334455aa.txt"
                    .to_string(),
        }
    );
    assert_eq!(
        turn.attachments[2],
        AgentAttachment::Reference {
            name: "clip.mp4".to_string(),
            path: "/Users/dev/Movies/clip.mp4".to_string(),
            bytes: 73_400_320,
        }
    );
    let reencoded = serde_json::to_string_pretty(&document.thread).expect("re-encode fixture");
    assert_eq!(format!("{reencoded}\n"), ATTACHMENT_FIXTURE);
    validate_agent_thread_document("/workspace", &document).expect("fixture is within bounds");
}

#[test]
fn the_shared_legacy_fixture_re_serialises_byte_identically() {
    assert!(!LEGACY_FIXTURE.contains("attachments"));
    let document = fixture_document(LEGACY_FIXTURE);

    assert!(document.thread.turns[0].attachments.is_empty());
    let reencoded = serde_json::to_string_pretty(&document.thread).expect("re-encode legacy");
    assert!(!reencoded.contains("attachments"));
    assert_eq!(format!("{reencoded}\n"), LEGACY_FIXTURE);
    validate_agent_thread_document("/workspace", &document).expect("legacy is within bounds");
}

#[test]
fn agent_attachments_reject_unknown_kinds_and_unknown_fields() {
    for attachments in [
        json!([{ "kind": "video", "name": "n", "path": "/n", "bytes": 1 }]),
        json!([{ "kind": "reference", "name": "n", "path": "/n", "bytes": 1, "extra": 1 }]),
        json!([{ "kind": "reference", "name": "n", "path": "/n" }]),
        json!([{ "kind": "reference", "name": "n", "path": "/n", "bytes": -1 }]),
        json!([{ "kind": "reference", "name": "n", "path": "/n", "bytes": 1.5 }]),
        json!([{ "kind": "file", "name": "n", "bytes": 1, "storedPath": "/n" }]),
        json!([{
            "kind": "image", "attachmentId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "name": "n",
            "mime": "image/svg+xml", "bytes": 1, "width": 1, "height": 1, "storedPath": "/n"
        }]),
    ] {
        let mut source = document_value();
        source["thread"]["turns"][0]["attachments"] = attachments;
        assert!(serde_json::from_value::<AgentThreadDocument>(source).is_err());
    }
}

#[test]
fn agent_attachment_bounds_are_enforced_at_the_same_limits_as_typescript() {
    let image = |overrides: fn(&mut AgentAttachment)| {
        let mut attachment = AgentAttachment::Image {
            attachment_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9".to_string(),
            name: "square.png".to_string(),
            mime: AgentImageMime::Png,
            bytes: 1,
            width: 1,
            height: 1,
            stored_path: "/data/square.png".to_string(),
        };
        overrides(&mut attachment);
        attachment
    };
    let mut document = fixture_document(ATTACHMENT_FIXTURE);
    document.thread.turns[0].attachments = vec![image(|_| {})];
    validate_agent_thread_document(ROOT_KEY, &document).expect("a bounded image is accepted");

    let rejected = [
        image(|attachment| {
            if let AgentAttachment::Image { attachment_id, .. } = attachment {
                *attachment_id = "0A1B2C3D4E5F60718293A4B5C6D7E8F9".to_string();
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { name, .. } = attachment {
                *name = "dir/square.png".to_string();
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { name, .. } = attachment {
                *name = "a".repeat(256);
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { bytes, .. } = attachment {
                *bytes = MAX_AGENT_IMAGE_BYTES + 1;
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { width, .. } = attachment {
                *width = 0;
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { height, .. } = attachment {
                *height = MAX_AGENT_IMAGE_DIMENSION + 1;
            }
        }),
        image(|attachment| {
            if let AgentAttachment::Image { stored_path, .. } = attachment {
                *stored_path = "relative/square.png".to_string();
            }
        }),
        AgentAttachment::File {
            attachment_id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9".to_string(),
            name: "notes.txt".to_string(),
            bytes: MAX_AGENT_FILE_BYTES + 1,
            stored_path: "/data/notes.txt".to_string(),
        },
        AgentAttachment::Reference {
            name: "clip.mp4".to_string(),
            path: "/Movies/clip.mp4".to_string(),
            bytes: MAX_AGENT_REFERENCE_BYTES + 1,
        },
    ];
    for attachment in rejected {
        document.thread.turns[0].attachments = vec![attachment];
        assert!(validate_agent_thread_document(ROOT_KEY, &document).is_err());
    }

    document.thread.turns[0].attachments = vec![image(|_| {}), image(|_| {})];
    assert_eq!(
        validate_agent_thread_document(ROOT_KEY, &document),
        Err(AGENT_ATTACHMENT_DUPLICATE_ID_ERROR.to_string())
    );

    document.thread.turns[0].attachments = (0..9)
        .map(|index| AgentAttachment::Reference {
            name: format!("clip-{index}.mp4"),
            path: format!("/Movies/clip-{index}.mp4"),
            bytes: 1,
        })
        .collect();
    assert!(validate_agent_thread_document(ROOT_KEY, &document).is_err());

    document.thread.turns[0].attachments = (0..8u8)
        .map(|index| AgentAttachment::Image {
            attachment_id: format!("{index}").repeat(32),
            name: "square.png".to_string(),
            mime: AgentImageMime::Png,
            bytes: 5 * 1024 * 1024 + 1,
            width: 1,
            height: 1,
            stored_path: "/data/square.png".to_string(),
        })
        .collect();
    assert!(validate_agent_thread_document(ROOT_KEY, &document).is_err());
}

#[test]
fn deleting_a_thread_removes_its_attachment_directory() {
    use std::os::unix::fs::PermissionsExt;

    let workspace = TempStore::create("attachment-delete");
    let store = workspace.store();
    let mut document = fixture_document(ATTACHMENT_FIXTURE);
    document.thread.thread_id = "agt-thread-0102".to_string();
    store.save(ROOT_KEY, &document).expect("save thread");
    let reloaded = store.load(ROOT_KEY).expect("reload thread");
    assert_eq!(
        reloaded.threads[0].turns[0].attachments,
        document.thread.turns[0].attachments
    );
    let attachments =
        agent_attachment_thread_directory(&workspace.base, "agt-thread-0102").expect("thread dir");
    fs::create_dir_all(&attachments).expect("create attachment directory");
    let file = attachments.join("0a1b2c3d4e5f60718293a4b5c6d7e8f9.png");
    fs::write(&file, b"png").expect("write attachment");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).expect("restrict attachment");

    store.delete(ROOT_KEY, "agt-thread-0102").expect("delete");

    assert!(!attachments.exists());
    assert!(!workspace.thread_path("agt-thread-0102").exists());
    assert!(agent_attachment_root(&workspace.base).exists());
    store
        .delete(ROOT_KEY, "agt-thread-0102")
        .expect("a missing attachment directory is not an error");
}

#[test]
fn an_attachment_path_outside_the_store_root_is_refused() {
    let workspace = TempStore::create("attachment-containment");
    let root = agent_attachment_root(&workspace.base);

    for candidate in [
        root.join("..").join("agent-threads"),
        root.clone(),
        workspace.base.join("agent-threads"),
        root.join("threads").join("..").join("..").join("escape"),
    ] {
        assert_eq!(
            ensure_within_agent_attachment_root(&workspace.base, &candidate),
            Err(AGENT_ATTACHMENT_CONTAINMENT_ERROR.to_string())
        );
    }
    assert!(agent_attachment_thread_directory(&workspace.base, "../evil").is_err());
    assert!(agent_attachment_thread_directory(&workspace.base, "agt-thread-0103").is_ok());
}
