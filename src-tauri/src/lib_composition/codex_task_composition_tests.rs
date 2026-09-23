use super::*;
use std::path::PathBuf;

#[test]
fn read_only_mode_never_grants_write_or_network_access() {
    assert_eq!(
        access_for(CodexExecutionMode::ReadOnly, "/workspace"),
        CodexAccess {
            sandbox: Some(SandboxMode::ReadOnly),
            sandbox_policy: Some(SandboxPolicy::ReadOnly {
                network_access: false
            }),
            approval_policy: Some(ApprovalPolicy::Never),
        }
    );
}

#[test]
fn writing_modes_restrict_writable_roots_and_ask_before_escalating() {
    for (mode, approval) in [
        (
            CodexExecutionMode::WorkspaceWrite,
            ApprovalPolicy::Untrusted,
        ),
        (CodexExecutionMode::Auto, ApprovalPolicy::OnRequest),
    ] {
        assert_eq!(
            access_for(mode, "/repo/.worktrees/isolated"),
            CodexAccess {
                sandbox: Some(SandboxMode::WorkspaceWrite),
                sandbox_policy: Some(SandboxPolicy::WorkspaceWrite {
                    network_access: false,
                    writable_roots: vec!["/repo/.worktrees/isolated".into()]
                }),
                approval_policy: Some(approval),
            }
        );
    }
}

#[test]
fn default_mode_leaves_sandbox_and_approvals_to_the_codex_config() {
    assert_eq!(
        access_for(CodexExecutionMode::Default, "/workspace"),
        CodexAccess {
            sandbox: None,
            sandbox_policy: None,
            approval_policy: None,
        }
    );
}

#[test]
fn full_access_is_only_selected_explicitly() {
    assert_eq!(
        access_for(CodexExecutionMode::DangerFullAccess, "/workspace"),
        CodexAccess {
            sandbox: Some(SandboxMode::DangerFullAccess),
            sandbox_policy: Some(SandboxPolicy::DangerFullAccess),
            approval_policy: Some(ApprovalPolicy::Never),
        }
    );
}

#[test]
fn visual_guidance_is_sent_once_as_thread_developer_instructions() {
    let access = access_for(CodexExecutionMode::Auto, "/repo");
    let (start, resume) = thread_params("/repo", Some("gpt-5.6"), &access, Some("thread-1"));
    assert_eq!(
        start.developer_instructions.as_deref(),
        Some(VISUAL_OUTPUT_INSTRUCTIONS)
    );
    let resume = resume.unwrap();
    assert_eq!(
        resume.developer_instructions.as_deref(),
        Some(VISUAL_OUTPUT_INSTRUCTIONS)
    );
    assert_eq!(resume.thread_id, "thread-1");
    assert_eq!(resume.approval_policy, Some(ApprovalPolicy::OnRequest));
    assert!(thread_params("/repo", None, &access, None).1.is_none());
}

#[test]
fn prompt_and_images_remain_separate_typed_inputs_in_order() {
    let prompt = "Inspect `$(touch injected)`\nthen compare screenshots.";
    let inputs = codex_input(
        prompt,
        &[
            PathBuf::from("/repo/image one.png"),
            PathBuf::from("/repo/žltá.png"),
        ],
    )
    .unwrap();
    assert_eq!(
        inputs,
        vec![
            UserInput::Text {
                text: prompt.into()
            },
            UserInput::LocalImage {
                path: "/repo/image one.png".into()
            },
            UserInput::LocalImage {
                path: "/repo/žltá.png".into()
            },
        ]
    );
}

#[test]
fn text_only_turn_has_no_synthetic_attachment_or_instructions() {
    let input = codex_input("hello", &[]).unwrap();
    assert_eq!(
        input,
        vec![UserInput::Text {
            text: "hello".into()
        }]
    );
    assert!(!input.iter().any(|item| matches!(
        item,
        UserInput::Text { text } if text.contains(VISUAL_OUTPUT_INSTRUCTIONS)
    )));
}

#[cfg(unix)]
#[test]
fn non_utf8_image_path_is_rejected() {
    use std::os::unix::ffi::OsStringExt;
    let path = PathBuf::from(std::ffi::OsString::from_vec(vec![b'/', 0xff]));
    assert!(codex_input("hello", &[path]).is_err());
}

#[test]
fn visual_guidance_preserves_maximum_user_prompt_and_attachment_budget() {
    let prompt = "x".repeat(crate::agent_task_spawner::MAX_AGENT_PROMPT_BYTES);
    let images: Vec<_> = (0..8)
        .map(|index| PathBuf::from(format!("/repo/image-{index}.png")))
        .collect();
    let input = codex_input(&prompt, &images).unwrap();
    assert_eq!(input.len(), 9);
    assert_eq!(input[0], UserInput::Text { text: prompt });
    assert!(
        crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame::CodexInput {
            input,
            client_user_message_id: None,
        }
        .bounded()
    );
}
