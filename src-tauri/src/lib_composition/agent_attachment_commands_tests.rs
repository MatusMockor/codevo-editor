use super::*;
use agent_attachment_store::{AgentAttachmentCandidate, ClaimedAgentAttachment};
use agent_thread_store::AgentImageMime;

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
