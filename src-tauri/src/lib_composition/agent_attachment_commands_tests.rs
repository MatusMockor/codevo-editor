use super::super::agent_task_commands::agent_root_lease::{
    AgentRootLeaseReleaseDisposition, AgentRootWorkspaceRegistration,
    RegisteredAgentRootLeaseAcquisition,
};
use super::*;
use crate::workspace_registry::ManagedWorkspaceDescriptor;
use agent_attachment_store::{AgentAttachmentCandidate, ClaimedAgentAttachment};
use agent_thread_store::AgentImageMime;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

#[test]
fn the_stage_header_contract_is_camel_case_and_closed() {
    let header: StageAgentAttachmentBytesHeader = serde_json::from_str(
        r#"{"workspaceId":"w1","kind":"image","name":"shot.png","mime":"image/png","width":4,"height":9}"#,
    )
    .expect("stage header parses");

    assert_eq!(header.workspace_id.as_str(), "w1");
    assert_eq!(header.kind, AgentAttachmentKind::Image);
    assert_eq!(header.attachment().mime, Some(AgentImageMime::Png));
    assert_eq!((header.width, header.height), (Some(4), Some(9)));
    assert!(serde_json::from_str::<StageAgentAttachmentBytesHeader>(
        r#"{"workspaceId":"w1","kind":"file","name":"a","path":"/tmp/a"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<StageAgentAttachmentBytesHeader>(
        r#"{"workspace_id":"w1","kind":"file","name":"a"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<StageAgentAttachmentBytesHeader>(
        r#"{"workspaceId":"w1","kind":"video","name":"a"}"#
    )
    .is_err());
}

#[test]
fn every_attachment_request_shape_is_camel_case_and_rejects_unknown_fields() {
    let staged: StageAgentAttachmentFromPathRequest = serde_json::from_str(
        r#"{"workspaceId":"w1","kind":"image","name":"a.png","mime":"image/png","width":1,"height":1,"path":"/tmp/a.png"}"#,
    )
    .expect("from-path request parses");
    let candidate: AgentAttachmentCandidateRequest =
        serde_json::from_str(r#"{"workspaceId":"w1","path":"/tmp/a.png"}"#)
            .expect("candidate request parses");
    let claim: ClaimAgentAttachmentsRequest = serde_json::from_str(
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001","attachmentIds":["00112233445566778899aabbccddeeff"]}"#,
    )
    .expect("claim request parses");
    let release: ReleaseAgentAttachmentRequest = serde_json::from_str(
        r#"{"workspaceId":"w1","attachmentId":"00112233445566778899aabbccddeeff"}"#,
    )
    .expect("release request parses");
    let reference: AgentAttachmentReferenceRequest = serde_json::from_str(
        r#"{"workspaceId":"w1","threadId":"agt-thread-0001","attachmentId":"00112233445566778899aabbccddeeff"}"#,
    )
    .expect("reference request parses");

    assert_eq!(staged.path, "/tmp/a.png");
    assert_eq!(candidate.path, "/tmp/a.png");
    assert_eq!(claim.thread_id, "agt-thread-0001");
    assert_eq!(release.attachment_id, "00112233445566778899aabbccddeeff");
    assert_eq!(reference.thread_id, "agt-thread-0001");
    assert!(serde_json::from_str::<AgentAttachmentCandidateRequest>(
        r#"{"workspaceId":"w1","path":"/tmp/a.png","extra":1}"#
    )
    .is_err());
    assert!(serde_json::from_str::<ClaimAgentAttachmentsRequest>(
        r#"{"workspaceId":"w1","thread_id":"agt-thread-0001","attachmentIds":[]}"#
    )
    .is_err());
}

#[test]
fn every_attachment_result_shape_reaches_the_webview_in_camel_case() {
    let staged = serde_json::to_string(&StagedAgentAttachment {
        attachment_id: "00112233445566778899aabbccddeeff".to_string(),
        name: "shot.png".to_string(),
        mime: Some(AgentImageMime::Png),
        bytes: 12,
        width: Some(4),
        height: Some(9),
        prompt_line_bytes_max: 180,
    })
    .expect("serialize staged");
    let generic = serde_json::to_string(&StagedAgentAttachment {
        attachment_id: "00112233445566778899aabbccddeeff".to_string(),
        name: "notes.md".to_string(),
        mime: None,
        bytes: 5,
        width: None,
        height: None,
        prompt_line_bytes_max: 180,
    })
    .expect("serialize staged file");
    let claimed = serde_json::to_string(&ClaimedAgentAttachment {
        attachment_id: "00112233445566778899aabbccddeeff".to_string(),
        stored_path: "/store/a.png".to_string(),
        prompt_line: "[Attached image \"a.png\" is saved at: /store/a.png]".to_string(),
    })
    .expect("serialize claimed");
    let candidate = serde_json::to_string(&AgentAttachmentCandidate {
        bytes: 12,
        is_regular_file: true,
        extension_mime: Some(AgentImageMime::Jpeg),
    })
    .expect("serialize candidate");

    assert_eq!(
        staged,
        r#"{"attachmentId":"00112233445566778899aabbccddeeff","name":"shot.png","mime":"image/png","bytes":12,"width":4,"height":9,"promptLineBytesMax":180}"#
    );
    assert_eq!(
        generic,
        r#"{"attachmentId":"00112233445566778899aabbccddeeff","name":"notes.md","bytes":5,"promptLineBytesMax":180}"#
    );
    assert_eq!(
        claimed,
        r#"{"attachmentId":"00112233445566778899aabbccddeeff","storedPath":"/store/a.png","promptLine":"[Attached image \"a.png\" is saved at: /store/a.png]"}"#
    );
    assert_eq!(
        candidate,
        r#"{"bytes":12,"isRegularFile":true,"extensionMime":"image/jpeg"}"#
    );
}

#[test]
fn an_empty_or_oversized_workspace_id_never_reaches_the_store() {
    let empty: WorkspaceId = serde_json::from_str("\"\"").expect("workspace id");
    let oversized: WorkspaceId = serde_json::from_str(&format!(
        "\"{}\"",
        "w".repeat(MAX_AGENT_TASK_WORKSPACE_ID_BYTES + 1)
    ))
    .expect("workspace id");
    let accepted: WorkspaceId = serde_json::from_str("\"workspace-1\"").expect("workspace id");

    assert_eq!(
        ensure_agent_attachment_workspace_id(&empty),
        Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );
    assert_eq!(
        ensure_agent_attachment_workspace_id(&oversized),
        Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );
    assert_eq!(ensure_agent_attachment_workspace_id(&accepted), Ok(()));
}

#[test]
fn the_thumbnail_read_budget_is_the_stored_image_budget() {
    assert_eq!(
        MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES,
        agent_thread_store::MAX_AGENT_IMAGE_BYTES
    );
}

static OWNER_FIXTURE_NONCE: AtomicU64 = AtomicU64::new(0);

struct TemporaryDirectory {
    path: PathBuf,
}

impl TemporaryDirectory {
    fn create(label: &str) -> Self {
        let nonce = OWNER_FIXTURE_NONCE.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "agent-attachment-owner-{label}-{}-{nonce}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create fixture directory");
        Self {
            path: path.canonicalize().expect("canonical fixture directory"),
        }
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct AgentRootOwnerFixture {
    project_root: PathBuf,
    base_dir: PathBuf,
    registry: WorkspaceRegistry,
    leases: AgentRootLeaseRegistry,
    trust: Mutex<WorkspaceTrustService>,
    store: AgentAttachmentStore,
    descriptor: ManagedWorkspaceDescriptor,
    lease_token: u64,
    _temp: TemporaryDirectory,
}

impl AgentRootOwnerFixture {
    fn create(label: &str) -> Self {
        let temp = TemporaryDirectory::create(label);
        let project_root = temp.join("project");
        fs::create_dir_all(&project_root).expect("create project root");
        let project_root = project_root.canonicalize().expect("canonical project root");
        let base_dir = temp.join("app-data");
        fs::create_dir_all(&base_dir).expect("create store base directory");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry
            .register(&project_root)
            .expect("register workspace");
        let leases = AgentRootLeaseRegistry::new();
        let acquisition = leases
            .acquire_registered(
                &project_root,
                AgentRootWorkspaceRegistration {
                    workspace_id: descriptor.workspace_id.clone(),
                    admission_token: 1,
                },
            )
            .expect("acquire registered agent root lease");
        let RegisteredAgentRootLeaseAcquisition::Acquired(lease) = acquisition else {
            panic!("a fresh fixture root must acquire a new lease");
        };
        let trust = WorkspaceTrustService::load(temp.join("workspace-trust.json"))
            .expect("load trust service");
        let fixture = Self {
            store: AgentAttachmentStore::new(base_dir.clone()),
            project_root,
            base_dir,
            registry,
            leases,
            trust: Mutex::new(trust),
            descriptor,
            lease_token: lease.lease_token,
            _temp: temp,
        };
        fixture.set_trusted(true);
        fixture
    }

    fn root_key(&self) -> String {
        self.descriptor
            .canonical_root_path
            .to_str()
            .expect("utf-8 canonical root")
            .to_string()
    }

    fn set_trusted(&self, trusted: bool) {
        self.trust
            .lock()
            .expect("trust lock")
            .set(&self.root_key(), trusted)
            .expect("record trust decision");
    }

    fn agent_root_owner_id(&self) -> WorkspaceId {
        workspace_id(&agent_thread_store::agent_root_owner_id(&self.root_key()))
    }

    fn thread_file(&self, thread_id: &str) -> PathBuf {
        self.base_dir
            .join(agent_thread_store::AGENT_THREAD_STORE_DIR_NAME)
            .join(agent_thread_store::fnv1a64hex(&self.root_key()))
            .join(format!("{thread_id}.json"))
    }

    fn write_thread_file(&self, thread_id: &str) {
        let path = self.thread_file(thread_id);
        fs::create_dir_all(path.parent().expect("thread root")).expect("create thread root");
        fs::write(&path, b"{}").expect("write thread file");
    }

    fn stage_png(&self, bytes: &[u8]) -> StagedAgentAttachment {
        self.store
            .stage_bytes(
                self.descriptor.workspace_id.as_str(),
                &StageAgentAttachmentHeader {
                    kind: AgentAttachmentKind::Image,
                    name: "shot.png".to_string(),
                    mime: Some(AgentImageMime::Png),
                    width: Some(4),
                    height: Some(9),
                },
                bytes,
            )
            .expect("stage image")
    }

    fn release_lease(&self) {
        assert_eq!(self.leases.registered_leases().len(), 1);
        let (disposition, _) = self
            .leases
            .release_registered(&self.project_root, self.lease_token);
        assert_eq!(disposition, AgentRootLeaseReleaseDisposition::Released);
        assert!(self.leases.registered_leases().is_empty());
    }

    fn resolve(&self, owner_id: &WorkspaceId) -> Result<ResolvedAgentAttachmentOwner, String> {
        resolve_agent_attachment_owner_with(&self.registry, &self.trust, &self.leases, owner_id)
    }
}

fn workspace_id(value: &str) -> WorkspaceId {
    serde_json::from_str(&serde_json::to_string(value).expect("json string")).expect("workspace id")
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

#[test]
fn an_agent_root_owner_with_a_registered_trusted_lease_reads_reveals_claims_and_releases() {
    let fixture = AgentRootOwnerFixture::create("claims");
    let thread = "agt-thread-0001";
    fixture.write_thread_file(thread);
    let png = png_bytes(4, 9);
    let claimed_attachment = fixture.stage_png(&png);
    let released_attachment = fixture.stage_png(&png);
    let owner_id = fixture.agent_root_owner_id();
    assert!(owner_id.as_str().starts_with(AGENT_ROOT_OWNER_ID_PREFIX));

    let resolved = fixture
        .resolve(&owner_id)
        .expect("resolve agent root owner");

    assert_eq!(resolved.workspace_id, fixture.descriptor.workspace_id);
    assert_eq!(resolved.root_keys, workspace_root_keys(&fixture.descriptor));

    let owner = resolved.store_owner(thread);
    let claimed = fixture
        .store
        .claim(
            &owner,
            std::slice::from_ref(&claimed_attachment.attachment_id),
        )
        .expect("claim through the agent root owner");
    let stored_path = agent_attachment_paths::agent_attachment_thread_file(
        &fixture.base_dir,
        thread,
        &claimed_attachment.attachment_id,
        "png",
    )
    .expect("stored path");
    let pending_path = agent_attachment_paths::agent_attachment_pending_file(
        &fixture.base_dir,
        &released_attachment.attachment_id,
        "png",
    )
    .expect("pending path");

    assert_eq!(claimed.len(), 1);
    assert_eq!(
        fixture
            .store
            .read_claimed(
                &owner,
                &claimed_attachment.attachment_id,
                MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES
            )
            .expect("read the claimed image"),
        png
    );
    assert_eq!(
        fixture
            .store
            .resolve_claimed_path(&owner, &claimed_attachment.attachment_id)
            .expect("reveal the claimed image"),
        stored_path
    );
    assert!(pending_path.is_file());

    fixture
        .store
        .release(
            resolved.workspace_id.as_str(),
            &released_attachment.attachment_id,
        )
        .expect("release the pending attachment");

    assert!(!pending_path.exists());
}

#[test]
fn an_agent_root_owner_still_resolves_after_the_claim_record_is_gone() {
    let fixture = AgentRootOwnerFixture::create("restart");
    let thread = "agt-thread-0002";
    fixture.write_thread_file(thread);
    let png = png_bytes(4, 9);
    let staged = fixture.stage_png(&png);
    let owner_id = fixture.agent_root_owner_id();
    let resolved = fixture
        .resolve(&owner_id)
        .expect("resolve agent root owner");
    fixture
        .store
        .claim(
            &resolved.store_owner(thread),
            std::slice::from_ref(&staged.attachment_id),
        )
        .expect("claim through the agent root owner");

    fixture
        .store
        .forget_claimed(std::slice::from_ref(&staged.attachment_id));
    let reopened = fixture
        .resolve(&owner_id)
        .expect("resolve agent root owner after a restart");

    assert_eq!(
        fixture
            .store
            .read_claimed(
                &reopened.store_owner(thread),
                &staged.attachment_id,
                MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES
            )
            .expect("read the claimed image after a restart"),
        png
    );

    fs::remove_file(fixture.thread_file(thread)).expect("remove the thread file");

    assert_eq!(
        fixture.store.read_claimed(
            &reopened.store_owner(thread),
            &staged.attachment_id,
            MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES
        ),
        Err(agent_attachment_store::AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR.to_string())
    );
}

#[test]
fn a_released_agent_root_lease_fails_closed_as_an_unknown_workspace() {
    let fixture = AgentRootOwnerFixture::create("released");
    let owner_id = fixture.agent_root_owner_id();
    fixture.resolve(&owner_id).expect("resolve while leased");

    fixture.release_lease();

    assert_eq!(
        fixture.resolve(&owner_id).err(),
        Some(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );
}

#[test]
fn an_unknown_agent_root_owner_fails_closed_as_an_unknown_workspace() {
    let fixture = AgentRootOwnerFixture::create("unknown");
    let foreign_root = workspace_id("agent-root:0000000000000000");
    let unregistered = workspace_id("workspace-nope");

    assert_eq!(
        fixture.resolve(&foreign_root).err(),
        Some(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );
    assert_eq!(
        fixture.resolve(&unregistered).err(),
        Some(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );
    assert!(fixture.resolve(&fixture.agent_root_owner_id()).is_ok());
}

#[test]
fn an_untrusted_agent_root_lease_fails_closed_as_untrusted() {
    let fixture = AgentRootOwnerFixture::create("untrusted");
    let owner_id = fixture.agent_root_owner_id();
    fixture.resolve(&owner_id).expect("resolve while trusted");

    fixture.set_trusted(false);

    assert_eq!(
        fixture.resolve(&owner_id).err(),
        Some(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string())
    );
    assert!(fixture.leases.registered_leases().len() == 1);
}

#[test]
fn a_registered_workspace_id_resolves_exactly_as_before() {
    let fixture = AgentRootOwnerFixture::create("registered");
    let registered = fixture.descriptor.workspace_id.clone();

    let resolved = fixture
        .resolve(&registered)
        .expect("resolve the registered workspace id");

    assert_eq!(resolved.workspace_id, registered);
    assert_eq!(resolved.root_keys, workspace_root_keys(&fixture.descriptor));
    assert_eq!(
        fixture.resolve(&workspace_id("ws-unregistered")).err(),
        Some(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
    );

    fixture.set_trusted(false);

    assert_eq!(
        fixture.resolve(&registered).err(),
        Some(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string())
    );
}
