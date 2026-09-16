use super::*;
use std::path::PathBuf;

#[test]
fn read_only_mode_never_grants_write_or_network_access() {
    assert_eq!(
        sandbox_for(CodexExecutionMode::ReadOnly, "/workspace"),
        (
            SandboxMode::ReadOnly,
            SandboxPolicy::ReadOnly {
                network_access: false
            }
        )
    );
}

#[test]
fn writing_modes_restrict_writable_roots_to_the_exact_working_directory() {
    for mode in [
        CodexExecutionMode::Default,
        CodexExecutionMode::WorkspaceWrite,
        CodexExecutionMode::Auto,
    ] {
        assert_eq!(
            sandbox_for(mode, "/repo/.worktrees/isolated"),
            (
                SandboxMode::WorkspaceWrite,
                SandboxPolicy::WorkspaceWrite {
                    network_access: false,
                    writable_roots: vec!["/repo/.worktrees/isolated".into()]
                },
            )
        );
    }
}

#[test]
fn full_access_is_only_selected_explicitly() {
    assert_eq!(
        sandbox_for(CodexExecutionMode::DangerFullAccess, "/workspace"),
        (
            SandboxMode::DangerFullAccess,
            SandboxPolicy::DangerFullAccess,
        )
    );
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
                text: VISUAL_OUTPUT_INSTRUCTIONS.into()
            },
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
fn text_only_turn_has_no_synthetic_attachment() {
    assert_eq!(
        codex_input("hello", &[]).unwrap(),
        vec![
            UserInput::Text {
                text: VISUAL_OUTPUT_INSTRUCTIONS.into()
            },
            UserInput::Text {
                text: "hello".into()
            }
        ]
    );
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
    assert_eq!(input.len(), 10);
    assert_eq!(input[1], UserInput::Text { text: prompt });
    assert!(
        crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame::CodexInput {
            input,
            client_user_message_id: None,
        }
        .bounded()
    );
}
