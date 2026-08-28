use crate::run_blocking_command;
use agent_thread_store::{
    agent_root_owner_id, AgentThread, AgentThreadDocument, AgentThreadStore, UnreadableAgentThread,
    AGENT_THREAD_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[path = "../agent_thread_store.rs"]
pub(crate) mod agent_thread_store;

pub(crate) const AGENT_THREAD_OWNER_ID_MISMATCH_ERROR: &str =
    "The agent thread owner does not match this project root.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadAgentThreadsRequest {
    root_key: String,
    owner_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveAgentThreadRequest {
    root_key: String,
    owner_id: String,
    thread: AgentThread,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteAgentThreadRequest {
    root_key: String,
    owner_id: String,
    thread_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentThreadsSnapshot {
    threads: Vec<AgentThread>,
    unreadable: Vec<UnreadableAgentThread>,
    evicted: usize,
}

fn ensure_agent_root_owner(root_key: &str, owner_id: &str) -> Result<(), String> {
    if owner_id != agent_root_owner_id(root_key) {
        return Err(AGENT_THREAD_OWNER_ID_MISMATCH_ERROR.to_string());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn load_agent_threads(
    request: LoadAgentThreadsRequest,
    store: State<'_, Arc<AgentThreadStore>>,
) -> Result<AgentThreadsSnapshot, String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        ensure_agent_root_owner(&request.root_key, &request.owner_id)?;
        let loaded = store.load(&request.root_key)?;

        Ok(AgentThreadsSnapshot {
            threads: loaded.threads,
            unreadable: loaded.unreadable,
            evicted: loaded.evicted,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_agent_thread(
    request: SaveAgentThreadRequest,
    store: State<'_, Arc<AgentThreadStore>>,
) -> Result<(), String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        ensure_agent_root_owner(&request.root_key, &request.owner_id)?;
        store.save(
            &request.root_key,
            &AgentThreadDocument {
                schema_version: AGENT_THREAD_SCHEMA_VERSION,
                thread: request.thread,
            },
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_agent_thread(
    request: DeleteAgentThreadRequest,
    store: State<'_, Arc<AgentThreadStore>>,
) -> Result<(), String> {
    let store = Arc::clone(&store);
    run_blocking_command(move || {
        ensure_agent_root_owner(&request.root_key, &request.owner_id)?;
        store.delete(&request.root_key, &request.thread_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_thread_store::{
        AgentProviderSession, AgentThreadOwner, AgentThreadTarget, AgentTurn, AgentTurnStatus,
    };
    use serde_json::json;

    fn root_key() -> String {
        "/workspace/alpha".to_string()
    }

    fn thread_json() -> serde_json::Value {
        json!({
            "threadId": "agt-thread-0001",
            "owner": {
                "rootKey": root_key(),
                "ownerId": agent_root_owner_id(&root_key()),
                "repositoryRoot": "/workspace/alpha"
            },
            "target": { "isolation": "worktree", "worktreePath": "/workspace/alpha/.worktrees/agt-thread-0001" },
            "provider": { "kind": "claudeCode", "sessionId": null },
            "title": "do the thing",
            "pinned": false,
            "archived": false,
            "createdAtEpochMs": 1,
            "updatedAtEpochMs": 2,
            "turns": [],
            "turnsTruncated": false
        })
    }

    #[test]
    fn load_and_delete_requests_reject_unknown_fields() {
        let load = serde_json::from_value::<LoadAgentThreadsRequest>(json!({
            "rootKey": root_key(),
            "ownerId": agent_root_owner_id(&root_key()),
            "extra": 1
        }));
        let delete = serde_json::from_value::<DeleteAgentThreadRequest>(json!({
            "rootKey": root_key(),
            "ownerId": agent_root_owner_id(&root_key()),
            "threadId": "agt-thread-0001",
            "extra": 1
        }));

        assert!(load.is_err(), "unknown load field must be rejected");
        assert!(delete.is_err(), "unknown delete field must be rejected");
    }

    #[test]
    fn save_requests_reject_unknown_fields_at_every_depth() {
        let top_level = serde_json::from_value::<SaveAgentThreadRequest>(json!({
            "rootKey": root_key(),
            "ownerId": agent_root_owner_id(&root_key()),
            "thread": thread_json(),
            "extra": 1
        }));
        let mut nested_thread = thread_json();
        nested_thread["extra"] = json!(1);
        let nested = serde_json::from_value::<SaveAgentThreadRequest>(json!({
            "rootKey": root_key(),
            "ownerId": agent_root_owner_id(&root_key()),
            "thread": nested_thread
        }));

        assert!(top_level.is_err(), "unknown request field must be rejected");
        assert!(nested.is_err(), "unknown thread field must be rejected");
    }

    #[test]
    fn save_requests_accept_the_typescript_wire_shape() {
        let request = serde_json::from_value::<SaveAgentThreadRequest>(json!({
            "rootKey": root_key(),
            "ownerId": agent_root_owner_id(&root_key()),
            "thread": thread_json()
        }))
        .expect("deserialize save request");

        assert_eq!(request.thread.thread_id, "agt-thread-0001");
        assert_eq!(request.thread.owner.root_key, root_key());
    }

    #[test]
    fn snapshot_responses_use_the_camel_case_wire_shape() {
        let snapshot = AgentThreadsSnapshot {
            threads: vec![AgentThread {
                thread_id: "agt-thread-0001".to_string(),
                owner: AgentThreadOwner {
                    root_key: root_key(),
                    owner_id: agent_root_owner_id(&root_key()),
                    repository_root: "/workspace/alpha".to_string(),
                },
                target: AgentThreadTarget {
                    isolation: crate::agent_task_supervisor::AgentTaskIsolation::InPlace,
                    worktree_path: None,
                },
                provider: AgentProviderSession {
                    kind: crate::agent_task_spawner::AgentCliInvocation::ClaudeCode,
                    session_id: None,
                },
                title: "do the thing".to_string(),
                pinned: false,
                archived: false,
                created_at_epoch_ms: 1,
                updated_at_epoch_ms: 2,
                turns: vec![AgentTurn {
                    turn_id: "agt-turn-0001".to_string(),
                    prompt: "do it".to_string(),
                    status: AgentTurnStatus::Interrupted,
                    started_at_epoch_ms: 1,
                    ended_at_epoch_ms: None,
                    events: Vec::new(),
                    events_truncated: false,
                    last_status_sequence: 0,
                    last_output_sequence: 0,
                    stream_metrics: None,
                    launch: None,
                    cli_version: None,
                }],
                turns_truncated: false,
                viewed_at_epoch_ms: None,
                integration: None,
            }],
            unreadable: vec![UnreadableAgentThread {
                thread_id: "agt-thread-0002".to_string(),
                reason: "corrupt".to_string(),
            }],
            evicted: 3,
        };

        let encoded = serde_json::to_value(&snapshot).expect("serialize snapshot");

        assert_eq!(encoded["evicted"], json!(3));
        assert_eq!(
            encoded["unreadable"][0]["threadId"],
            json!("agt-thread-0002")
        );
        assert_eq!(encoded["threads"][0]["turnsTruncated"], json!(false));
        assert_eq!(
            encoded["threads"][0]["turns"][0]["status"],
            json!({ "kind": "interrupted" })
        );
    }

    #[test]
    fn owner_id_must_be_derived_from_the_root_key() {
        let mismatch = ensure_agent_root_owner(&root_key(), "agent-root:0000000000000000")
            .expect_err("foreign owner id must be refused");

        assert_eq!(mismatch, AGENT_THREAD_OWNER_ID_MISMATCH_ERROR);
        ensure_agent_root_owner(&root_key(), &agent_root_owner_id(&root_key()))
            .expect("derived owner id is accepted");
    }
}
