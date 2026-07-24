use super::*;
use crate::debug_adapter::{DebugEvaluateContext, DebugEvaluatePolicy};

#[test]
fn php_watch_is_unsupported_without_sending_dbgp_eval() {
    let root = temp_root("watch-unsupported");
    let session = start_listen_session(&root, Vec::new());
    let client = MockXdebugClient::connect(session.port, default_responder());
    let (_, frames) = wait_for_stopped(&session.sink, 0);
    let eval_count = client
        .command_names()
        .into_iter()
        .filter(|name| name == "eval")
        .count();

    let failure = session
        .registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                frames[0].frame_id,
                "$invoice",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect_err("PHP watch must be unsupported");

    assert_eq!(
        failure.kind,
        crate::debug_adapter::DebugEvaluateErrorKind::Unsupported
    );
    assert!(failure.message.contains("PHP"));
    assert_eq!(
        client
            .command_names()
            .into_iter()
            .filter(|name| name == "eval")
            .count(),
        eval_count
    );
}

#[test]
fn php_clipboard_is_explicitly_unsupported_without_sending_dbgp_eval() {
    let root = temp_root("clipboard-unsupported");
    let session = start_listen_session(&root, Vec::new());
    let client = MockXdebugClient::connect(session.port, default_responder());
    let (_, frames) = wait_for_stopped(&session.sink, 0);

    let failure = session
        .registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                frames[0].frame_id,
                "$invoice",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Clipboard,
                    allow_side_effects: true,
                },
            )
        })
        .expect("session")
        .expect_err("PHP clipboard must be unsupported");

    assert_eq!(
        failure.kind,
        crate::debug_adapter::DebugEvaluateErrorKind::Unsupported
    );
    assert!(failure.message.contains("Clipboard"));
    assert!(!client.command_names().contains(&"eval".to_string()));
}

#[test]
fn php_watch_preserves_frame_ownership_without_sending_dbgp_eval() {
    let root = temp_root("watch-frame");
    let session = start_listen_session(&root, Vec::new());
    let client = MockXdebugClient::connect(session.port, default_responder());
    wait_for_stopped(&session.sink, 0);

    let failure = session
        .registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                999_999,
                "$invoice",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect_err("unknown frame must fail");

    assert_eq!(
        failure.kind,
        crate::debug_adapter::DebugEvaluateErrorKind::Exception
    );
    assert!(failure.message.contains("Unknown debug frame"));
    assert!(!client.command_names().contains(&"eval".to_string()));
}
#[test]
fn dbgp_set_variable_is_explicitly_unsupported() {
    let root = temp_root("set-variable-unsupported");
    let session = start_listen_session(&root, Vec::new());
    let error = session
        .registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(crate::debug_adapter::DebugSetVariableRequest {
                pause_generation: 1,
                frame_id: 1,
                variables_reference: 1,
                name: "value".to_string(),
                value: "42".to_string(),
            })
        })
        .expect("session")
        .expect_err("DBGp must reject set variable");
    assert!(error.starts_with("Unsupported:"));
    session.registry.stop(WORKSPACE_KEY);
}
