use super::super::codex_app_server_protocol::{
    CollabAgentTool, CollabAgentToolCallItem, CollabAgentToolCallStatus,
};
use super::{
    bounded_identity, clipped_text, CodexItemPhase, CodexSpawnStatus, CodexTurnEvent,
    MAX_CODEX_THREAD_ID_BYTES, MAX_CODEX_TOOL_ID_BYTES, MAX_SUBAGENT_THREADS_PER_TURN,
};

pub const MAX_CODEX_SPAWN_TITLE_BYTES: usize = 480;
pub const MAX_CODEX_SPAWN_MODEL_BYTES: usize = 64;
const REASONING_EFFORTS: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];

pub(super) enum CollabOutcome {
    Spawn(CodexTurnEvent),
    Dropped,
    Unknown,
}

pub(super) fn project_collab(
    item: &CollabAgentToolCallItem,
    phase: CodexItemPhase,
) -> CollabOutcome {
    if item.tool != CollabAgentTool::SpawnAgent {
        return CollabOutcome::Dropped;
    }
    let Some(call_id) = bounded_identity(item.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CollabOutcome::Unknown;
    };
    let Some(status) = spawn_status(item.status.as_ref(), phase) else {
        return CollabOutcome::Unknown;
    };
    let mut agent_thread_ids: Vec<String> = Vec::new();
    for receiver in item.receiver_thread_ids.iter().flatten() {
        let Some(receiver) = bounded_identity(receiver.as_str(), MAX_CODEX_THREAD_ID_BYTES) else {
            return CollabOutcome::Unknown;
        };
        if agent_thread_ids.contains(&receiver) {
            continue;
        }
        if agent_thread_ids.len() >= MAX_SUBAGENT_THREADS_PER_TURN {
            break;
        }
        agent_thread_ids.push(receiver);
    }
    CollabOutcome::Spawn(CodexTurnEvent::SubagentSpawn {
        call_id,
        status,
        task_title: item.prompt.as_deref().and_then(spawn_title),
        model: item.model.as_deref().and_then(spawn_model),
        reasoning_effort: item.reasoning_effort.as_deref().and_then(reasoning_effort),
        agent_thread_ids,
    })
}

fn spawn_status(
    status: Option<&CollabAgentToolCallStatus>,
    phase: CodexItemPhase,
) -> Option<CodexSpawnStatus> {
    match status {
        None => Some(match phase {
            CodexItemPhase::Started => CodexSpawnStatus::InProgress,
            CodexItemPhase::Completed => CodexSpawnStatus::Completed,
        }),
        Some(CollabAgentToolCallStatus::InProgress) => Some(CodexSpawnStatus::InProgress),
        Some(CollabAgentToolCallStatus::Completed) => Some(CodexSpawnStatus::Completed),
        Some(CollabAgentToolCallStatus::Failed) => Some(CodexSpawnStatus::Failed),
        Some(CollabAgentToolCallStatus::Interrupted) => Some(CodexSpawnStatus::Interrupted),
        Some(CollabAgentToolCallStatus::Unrecognized { .. }) => None,
    }
}

fn spawn_title(prompt: &str) -> Option<String> {
    let line = prompt.lines().find(|line| !line.trim().is_empty())?;
    let collapsed = line
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    let clipped = clipped_text(collapsed.as_str(), MAX_CODEX_SPAWN_TITLE_BYTES);
    (!clipped.text.is_empty()).then_some(clipped.text)
}

fn spawn_model(model: &str) -> Option<String> {
    let model = model.trim();
    if model.is_empty()
        || model.len() > MAX_CODEX_SPAWN_MODEL_BYTES
        || model.chars().any(char::is_control)
    {
        return None;
    }
    Some(model.to_string())
}

fn reasoning_effort(value: &str) -> Option<String> {
    REASONING_EFFORTS
        .contains(&value)
        .then(|| value.to_string())
}
