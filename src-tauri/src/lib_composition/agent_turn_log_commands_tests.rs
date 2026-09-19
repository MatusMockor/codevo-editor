use super::*;
use agent_turn_log::wire::AgentTurnLogScope;
use serde_json::json;

const ROOT_KEY: &str = "/workspace/alpha";

fn owner_id() -> String {
    agent_turn_log::agent_thread_store::agent_root_owner_id(ROOT_KEY)
}

fn scope_json() -> serde_json::Value {
    json!({
        "rootKey": ROOT_KEY,
        "ownerId": owner_id(),
        "threadId": "agt-thread-0001",
        "turnId": "agt-turn-0001"
    })
}

#[test]
fn the_command_payloads_accept_the_typescript_wire_shape() {
    let open = serde_json::from_value::<OpenAgentTurnLogRequest>(json!({
        "scope": scope_json(),
        "priorLoss": { "kind": "none" }
    }))
    .expect("deserialize an open request");
    let summarize = serde_json::from_value::<SummarizeAgentTurnLogsRequest>(json!({
        "rootKey": ROOT_KEY,
        "ownerId": owner_id(),
        "threadId": "agt-thread-0001"
    }))
    .expect("deserialize a summarize request");

    assert_eq!(open.scope.turn_id, "agt-turn-0001");
    assert_eq!(summarize.thread_id, "agt-thread-0001");
}

#[test]
fn the_command_payloads_reject_unknown_fields() {
    let open = serde_json::from_value::<OpenAgentTurnLogRequest>(json!({
        "scope": scope_json(),
        "priorLoss": { "kind": "none" },
        "extra": 1
    }));
    let page = serde_json::from_value::<ReadAgentTurnLogPageRequest>(json!({
        "scope": scope_json(),
        "anchor": { "at": "tail" },
        "maxEvents": 10,
        "maxBytes": 10,
        "extra": 1
    }));

    assert!(open.is_err());
    assert!(page.is_err());
}

#[test]
fn the_delete_command_payload_accepts_the_wire_shape_and_rejects_anything_else() {
    let accepted = serde_json::from_value::<DeleteAgentThreadLogRequest>(json!({
        "rootKey": ROOT_KEY,
        "ownerId": owner_id(),
        "threadId": "agt-thread-0001"
    }))
    .expect("deserialize a delete request");
    let scoped = serde_json::from_value::<DeleteAgentThreadLogRequest>(json!({
        "rootKey": ROOT_KEY,
        "ownerId": owner_id(),
        "threadId": "agt-thread-0001",
        "turnId": "agt-turn-0001"
    }));
    let snake_case = serde_json::from_value::<DeleteAgentThreadLogRequest>(json!({
        "root_key": ROOT_KEY,
        "owner_id": owner_id(),
        "thread_id": "agt-thread-0001"
    }));

    assert_eq!(accepted.thread_id, "agt-thread-0001");
    assert!(scoped.is_err(), "a turn id is not part of the request");
    assert!(snake_case.is_err(), "the wire is camelCase only");
    assert_eq!(
        serde_json::to_value(DeleteAgentThreadLogResult { deleted: true })
            .expect("serialize a delete result"),
        json!({ "deleted": true })
    );
}

#[test]
fn the_structured_sequence_gap_carries_only_the_code_and_a_decimal_sequence() {
    let structured = AgentTurnLogError::SequenceGap(Some(42)).message();
    let plain = AgentTurnLogError::SequenceGap(None).message();

    assert_eq!(structured, "sequenceGap:42");
    assert_eq!(plain, "sequenceGap");
    assert!(structured
        .strip_prefix("sequenceGap:")
        .is_some_and(|rest| rest.chars().all(|character| character.is_ascii_digit())));
}

#[test]
fn a_foreign_owner_is_refused_before_any_blocking_work_is_dispatched() {
    use std::future::Future;
    use std::pin::pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::task::{Context, Poll, Waker};
    let dispatched = Arc::new(AtomicBool::new(false));
    let foreign = Arc::clone(&dispatched);
    let owned = Arc::clone(&dispatched);
    let mut refusal = pin!(scoped(ROOT_KEY, "agent-root:0000000000000000", move || {
        foreign.store(true, Ordering::SeqCst);
        Ok(1i64)
    }));

    let refused = refusal
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()));
    let dispatched_for_the_foreign_owner = dispatched.load(Ordering::SeqCst);
    let accepted = tauri::async_runtime::block_on(scoped(ROOT_KEY, &owner_id(), move || {
        owned.store(true, Ordering::SeqCst);
        Ok(7i64)
    }))
    .expect("the derived owner reaches the store");

    assert_eq!(
        refused,
        Poll::Ready(Err("ownerMismatch".to_string())),
        "a foreign owner must be refused before any blocking work is dispatched"
    );
    assert!(
        !dispatched_for_the_foreign_owner,
        "a foreign owner reached the blocking work"
    );
    assert_eq!(accepted, 7);
    assert!(
        dispatched.load(Ordering::SeqCst),
        "the owned scope never reached the blocking work"
    );
}

#[test]
fn a_foreign_owner_id_is_refused_with_the_closed_error_code() {
    let refused = authorize(ROOT_KEY, "agent-root:0000000000000000")
        .expect_err("a foreign owner id must be refused");

    assert_eq!(refused, "ownerMismatch");
    authorize(ROOT_KEY, &owner_id()).expect("the derived owner id is accepted");
}

#[test]
fn no_command_error_ever_carries_a_path_or_sqlite_text() {
    let temp = std::env::temp_dir().join(format!(
        "agent-turn-log-command-{}-{}",
        std::process::id(),
        line!()
    ));
    std::fs::create_dir_all(&temp).expect("create temp base directory");
    let store = AgentTurnLogStore::new(temp.clone());
    let scope = AgentTurnLogScope {
        root_key: ROOT_KEY.to_string(),
        owner_id: owner_id(),
        thread_id: "agt-thread-0001".to_string(),
        turn_id: "agt-turn-0001".to_string(),
    };

    let refused = store
        .append(&AppendAgentTurnLogRequest {
            scope,
            writer_epoch: 1,
            expected_next_seq: 1,
            ops: Vec::new(),
            digest: None,
            seal: false,
            loss: agent_turn_log::wire::AgentTurnLogLoss::of(
                agent_turn_log::wire::AgentTurnLogLossKind::None,
            ),
        })
        .map_err(|error| error.code().to_string())
        .expect_err("an unopened turn is refused");

    assert_eq!(refused, "supersededWriter");
    assert!(!refused.contains('/'));
    let _ = std::fs::remove_dir_all(&temp);
}
