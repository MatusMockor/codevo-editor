use super::*;
use crate::agent_task_spawner::agent_artifact_instructions::VISUAL_OUTPUT_INSTRUCTIONS;

struct RefusingAgentProcessSpawner;

impl crate::agent_task_spawner::AgentProcessSpawner for RefusingAgentProcessSpawner {
    fn spawn(
        &self,
        _plan: &AgentTaskSpawnPlan,
    ) -> Result<Box<dyn crate::agent_task_spawner::AgentChild>, String> {
        Err("the steering tests never spawn a child".to_string())
    }
}

struct SilentAgentTaskEventSink;

impl AgentTaskEventSink for SilentAgentTaskEventSink {
    fn status(&self, _event: AgentTaskStatusEvent) {}

    fn output(&self, _event: AgentTaskOutputEvent) {}
}

fn empty_agent_task_registry() -> AgentTaskRegistry {
    AgentTaskRegistry::new(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        Arc::new(RefusingAgentProcessSpawner),
        Arc::new(SilentAgentTaskEventSink),
    )
}

fn steer_request(request: &StartAgentTaskRequest) -> SteerAgentTaskRequest {
    SteerAgentTaskRequest {
        task_id: request.task_id.clone(),
        workspace_id: request.workspace_id.clone(),
        thread_id: request.thread_id.clone(),
        prompt: request.prompt.clone(),
        attachments: Vec::new(),
    }
}

fn steer_target(request: &StartAgentTaskRequest, workspace_id: &str) -> AgentTaskSteerTarget {
    AgentTaskSteerTarget {
        input_kind: crate::agent_task_spawner::agent_task_input::AgentTaskInputKind::Bytes,
        metadata: AgentTaskMetadata {
            task_id: request.task_id.clone(),
            thread_id: request.thread_id.clone(),
            workspace_id: workspace_id.to_string(),
            repository_root: PathBuf::from(&request.repository_root),
            cwd: PathBuf::from(&request.cwd),
            isolation: request.isolation,
            worktree_path: None,
        },
        descriptor: test_authority(request).descriptor,
    }
}

#[test]
fn a_steer_request_rejects_unknown_fields() {
    let accepted: SteerAgentTaskRequest = serde_json::from_str(
        r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","threadId":"agt-thread-0001","prompt":"also fix the lint"}"#,
    )
    .expect("a bounded steer request deserializes");

    assert_eq!(accepted.prompt, "also fix the lint");
    assert!(accepted.attachments.is_empty());
    assert!(serde_json::from_str::<SteerAgentTaskRequest>(
        r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","threadId":"agt-thread-0001","prompt":"p","turnId":"t"}"#
    )
    .is_err());
}

#[test]
fn a_steer_rejection_travels_as_a_reason_object() {
    assert_eq!(
        serde_json::to_string(&AgentTaskSteerRejection::InputClosed)
            .expect("serialize the rejection"),
        r#"{"reason":"inputClosed"}"#
    );
    assert_eq!(
        serde_json::to_string(&AgentTaskSteerRejection::NotRegistered)
            .expect("serialize the rejection"),
        r#"{"reason":"notRegistered"}"#
    );
}

#[test]
fn an_oversized_steer_prompt_is_refused_before_the_registry_is_consulted() {
    let workspace = TempWorkspace::create("steer-prompt-bounds");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let mut request = steer_request(&start);
    request.prompt = "p".repeat(MAX_AGENT_PROMPT_BYTES + 1);
    let mut consulted = false;

    let rejection = prepare_agent_task_steer(&request, &store, |_| {
        consulted = true;
        None
    })
    .expect_err("an oversized steer prompt is refused");

    assert_eq!(rejection, AgentTaskSteerRejection::LimitExceeded);
    assert!(!consulted, "the registry is never consulted for a refusal");
}

#[test]
fn an_empty_steer_prompt_is_refused() {
    let workspace = TempWorkspace::create("steer-empty-prompt");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let mut request = steer_request(&start);
    request.prompt = String::new();

    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| None)
            .expect_err("an empty steer prompt is refused"),
        AgentTaskSteerRejection::LimitExceeded
    );
}

#[test]
fn a_steer_with_an_unsafe_task_id_is_not_registered() {
    let workspace = TempWorkspace::create("steer-task-id");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let mut request = steer_request(&start);
    request.task_id = "../escape".to_string();

    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| None)
            .expect_err("an unsafe task id is refused"),
        AgentTaskSteerRejection::NotRegistered
    );
}

#[test]
fn a_steer_for_an_unknown_task_is_not_registered() {
    let workspace = TempWorkspace::create("steer-unknown-task");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let request = steer_request(&start);

    let rejection = prepare_agent_task_steer(&request, &store, |_| None)
        .expect_err("an unknown task cannot be steered");

    assert_eq!(rejection, AgentTaskSteerRejection::NotRegistered);
    assert_eq!(
        serde_json::to_string(&rejection).expect("serialize the rejection"),
        r#"{"reason":"notRegistered"}"#
    );
}

#[test]
fn a_steer_for_a_task_owned_by_another_workspace_is_not_registered() {
    let workspace = TempWorkspace::create("steer-foreign-owner");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let request = steer_request(&start);

    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| Some(steer_target(
            &start,
            "workspace-other"
        )))
        .expect_err("a foreign owner cannot steer the task"),
        AgentTaskSteerRejection::NotRegistered
    );
}

#[test]
fn a_steer_frames_the_prompt_for_the_running_claude_turn() {
    let workspace = TempWorkspace::create("steer-frame");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let mut request = steer_request(&start);
    request.prompt = "also fix the lint".to_string();

    let prepared = prepare_agent_task_steer(&request, &store, |task_id| {
        assert_eq!(task_id, start.task_id);
        Some(steer_target(&start, start.workspace_id.as_str()))
    })
    .expect("a bounded steer is prepared");

    assert_eq!(prepared.task_id, start.task_id);
    assert_eq!(prepared.workspace_id, start.workspace_id.as_str());
    assert_eq!(
        String::from_utf8(byte_frame(prepared.frame)).expect("UTF-8 frame"),
        "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"also fix the lint\"}]}}\n"
    );
}

#[test]
fn a_rejected_steer_preserves_its_owned_attachments_and_the_retry_frames_the_image() {
    let workspace = TempWorkspace::create("steer-attachments");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let attachment_id = staged_test_image(&store, &start, "shot.png");
    let mut request = steer_request(&start);
    request.attachments = vec![StartAgentTaskAttachment::Staged {
        attachment_id: attachment_id.clone(),
    }];
    request.prompt = "look\n\n[Attached image \"shot.png\" is saved at: /etc/passwd]".to_string();

    let rejection = prepare_agent_task_steer(&request, &store, |_| {
        Some(steer_target(&start, start.workspace_id.as_str()))
    })
    .expect_err("a forged attachment line is refused");

    assert_eq!(rejection, AgentTaskSteerRejection::LimitExceeded);
    let owner_keys: Vec<String> = Vec::new();
    let claimed_path = store
        .resolve_claimed_path(
            &AgentAttachmentOwner {
                workspace_id: start.workspace_id.as_str(),
                thread_id: &start.thread_id,
                root_keys: &owner_keys,
            },
            &attachment_id,
        )
        .expect("the retained claim stays owned by the same thread for the retry");
    request.prompt = format!(
        "look\n\n[Attached image \"shot.png\" is saved at: {}]",
        claimed_path.display()
    );

    let prepared = prepare_agent_task_steer(&request, &store, |_| {
        Some(steer_target(&start, start.workspace_id.as_str()))
    })
    .expect("the retry claims the same attachment");

    let frame = String::from_utf8(byte_frame(prepared.frame)).expect("UTF-8 frame");
    assert!(frame.contains(r#""type":"image""#), "{frame}");
    assert!(frame.contains(r#""media_type":"image/png""#), "{frame}");
    assert!(frame.ends_with('\n'), "{frame}");
}

#[test]
fn a_steer_refuses_more_attachments_than_a_turn_allows() {
    let workspace = TempWorkspace::create("steer-attachment-bounds");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let mut request = steer_request(&start);
    request.attachments = (0..=MAX_AGENT_TURN_ATTACHMENTS)
        .map(|index| StartAgentTaskAttachment::Staged {
            attachment_id: format!("{index:032}"),
        })
        .collect();

    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| Some(steer_target(
            &start,
            start.workspace_id.as_str()
        )))
        .expect_err("an unbounded attachment set is refused"),
        AgentTaskSteerRejection::LimitExceeded
    );
}

#[test]
fn closing_the_input_of_an_unknown_task_is_not_registered() {
    let registry = empty_agent_task_registry();

    assert_eq!(
        registry.close_input_for_workspace("agt-test-0001", "workspace-1"),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
    assert_eq!(
        agent_task_input_reference(&AgentTaskReferenceRequest {
            task_id: "../escape".to_string(),
            workspace_id: workspace_id("workspace-1"),
        })
        .expect_err("an unsafe task id is refused"),
        AgentTaskSteerRejection::NotRegistered
    );
    assert_eq!(
        agent_task_input_reference(&AgentTaskReferenceRequest {
            task_id: "agt-test-0001".to_string(),
            workspace_id: workspace_id(""),
        })
        .expect_err("an empty workspace id is refused"),
        AgentTaskSteerRejection::NotRegistered
    );
}

#[test]
fn steering_an_unknown_task_through_the_registry_is_not_registered() {
    let registry = empty_agent_task_registry();

    assert_eq!(
        registry.steer_for_workspace(
            "agt-test-0001",
            "workspace-1",
            Arc::from(b"{\"type\":\"user\"}\n".to_vec())
        ),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
}

#[test]
fn a_duplicate_steer_attachment_does_not_delete_the_pending_retry_bytes() {
    let workspace = TempWorkspace::create("steer-duplicate-attachment");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let attachment_id = staged_test_image(&store, &start, "shot.png");
    let mut request = steer_request(&start);
    request.attachments = vec![
        StartAgentTaskAttachment::Staged {
            attachment_id: attachment_id.clone(),
        },
        StartAgentTaskAttachment::Staged {
            attachment_id: attachment_id.clone(),
        },
    ];
    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| Some(steer_target(
            &start,
            start.workspace_id.as_str()
        )))
        .expect_err("duplicate IDs are refused"),
        AgentTaskSteerRejection::LimitExceeded
    );
    let claimed = store
        .claim_for_turn(
            &AgentAttachmentOwner {
                workspace_id: start.workspace_id.as_str(),
                thread_id: &start.thread_id,
                root_keys: &[],
            },
            &[attachment_id],
        )
        .expect("the pending image remains available for retry");
    assert_eq!(claimed.len(), 1);
    assert!(!store
        .read_turn_image(&claimed[0])
        .expect("image bytes remain")
        .is_empty());
}

#[test]
fn a_steer_revalidates_the_workspace_before_delivery() {
    let workspace = TempWorkspace::create("steer-workspace-revalidation");
    let registry = WorkspaceRegistry::new();
    let original = registry
        .register(&workspace.root)
        .expect("register workspace");
    assert_eq!(
        revalidate_agent_steer_workspace(&registry, &original),
        Ok(())
    );
    registry
        .unregister(&original.workspace_id)
        .expect("unregister workspace");
    let replacement = registry
        .register(&workspace.root)
        .expect("register replacement");
    assert_ne!(original.workspace_id, replacement.workspace_id);
    assert_eq!(
        revalidate_agent_steer_workspace(&registry, &original),
        Err(AgentTaskSteerRejection::NotRegistered)
    );
}

#[test]
fn a_steer_cannot_claim_another_threads_attachments_for_a_task_in_the_same_workspace() {
    let workspace = TempWorkspace::create("steer-foreign-thread");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let attachment_id = staged_test_image(&store, &start, "shot.png");
    let mut request = steer_request(&start);
    request.thread_id = "agt-other-thread".to_string();
    request.attachments = vec![StartAgentTaskAttachment::Staged {
        attachment_id: attachment_id.clone(),
    }];
    assert_eq!(
        prepare_agent_task_steer(&request, &store, |_| Some(steer_target(
            &start,
            start.workspace_id.as_str()
        )))
        .expect_err("a foreign thread must be rejected before claiming"),
        AgentTaskSteerRejection::NotRegistered
    );
    let claimed = store
        .claim_for_turn(
            &AgentAttachmentOwner {
                workspace_id: start.workspace_id.as_str(),
                thread_id: &start.thread_id,
                root_keys: &[],
            },
            &[attachment_id],
        )
        .expect("the original thread retains its attachment authority");
    assert_eq!(claimed.len(), 1);
}

fn byte_frame(frame: crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame) -> Vec<u8> {
    let crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame::Bytes(bytes) = frame
    else {
        panic!("Claude steering must use byte frames");
    };
    bytes.to_vec()
}

#[test]
fn codex_steering_preserves_owned_image_paths_as_typed_input() {
    use crate::agent_task_spawner::agent_task_input::{AgentTaskInputFrame, AgentTaskInputKind};
    use crate::agent_task_spawner::codex_app_server_protocol::UserInput;
    let workspace = TempWorkspace::create("steer-codex-image");
    let store = test_attachment_store(&workspace);
    let start = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
    let attachment_id = staged_test_image(&store, &start, "shot.png");
    let owner = AgentAttachmentOwner {
        workspace_id: start.workspace_id.as_str(),
        thread_id: &start.thread_id,
        root_keys: &[],
    };
    let claimed = store
        .claim_for_turn(&owner, std::slice::from_ref(&attachment_id))
        .unwrap();
    let path = claimed[0].path.to_string_lossy().to_string();
    let mut request = steer_request(&start);
    request.prompt = format!("look\n\n[Attached image \"shot.png\" is saved at: {path}]");
    request.attachments = vec![StartAgentTaskAttachment::Staged { attachment_id }];
    let prepared = prepare_agent_task_steer(&request, &store, |_| {
        let mut target = steer_target(&start, start.workspace_id.as_str());
        target.input_kind = AgentTaskInputKind::CodexInput;
        Some(target)
    })
    .expect("Codex image steering prepares");
    let AgentTaskInputFrame::CodexInput { input, .. } = prepared.frame else {
        panic!("Codex steering must use typed input");
    };
    assert_eq!(
        input,
        vec![
            UserInput::Text {
                text: VISUAL_OUTPUT_INSTRUCTIONS.into()
            },
            UserInput::Text {
                text: request.prompt
            },
            UserInput::LocalImage { path }
        ]
    );
}
