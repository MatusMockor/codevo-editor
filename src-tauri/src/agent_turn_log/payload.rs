use super::agent_thread_store::{validate_agent_turn_event, AgentTurnEvent};
use super::errors::{AgentTurnLogError, AgentTurnLogResult};
use super::wire::{AgentTurnLogEntry, MAX_APPEND_BYTES};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EncodedOp {
    pub(crate) seq: i64,
    pub(crate) kind: i64,
    pub(crate) payload: Vec<u8>,
}

pub(crate) fn encode_ops(ops: &[AgentTurnLogEntry]) -> AgentTurnLogResult<Vec<EncodedOp>> {
    let mut encoded = Vec::with_capacity(ops.len());
    let mut total = 0usize;
    for entry in ops {
        validate_agent_turn_event(&entry.event).map_err(|_| AgentTurnLogError::BudgetExhausted)?;
        let payload =
            serde_json::to_vec(&entry.event).map_err(|_| AgentTurnLogError::BudgetExhausted)?;
        total = total.saturating_add(payload.len());
        if total > MAX_APPEND_BYTES {
            return Err(AgentTurnLogError::BudgetExhausted);
        }
        encoded.push(EncodedOp {
            seq: entry.seq,
            kind: event_kind_code(&entry.event),
            payload,
        });
    }
    Ok(encoded)
}

pub(crate) fn decode_event(payload: &[u8]) -> Option<AgentTurnEvent> {
    serde_json::from_slice(payload).ok()
}

pub(crate) fn event_kind_code(event: &AgentTurnEvent) -> i64 {
    match event {
        AgentTurnEvent::BackgroundTask { .. } => 1,
        AgentTurnEvent::UserMessage { .. } => 2,
        AgentTurnEvent::SubagentActivity { .. } => 3,
        AgentTurnEvent::SubagentEvent { .. } => 4,
        AgentTurnEvent::SubagentUsage { .. } => 5,
        AgentTurnEvent::SubagentTurnDone { .. } => 6,
        AgentTurnEvent::Queued { .. } => 7,
        AgentTurnEvent::AssistantText { .. } => 8,
        AgentTurnEvent::Reasoning { .. } => 9,
        AgentTurnEvent::ToolCall { .. } => 10,
        AgentTurnEvent::ToolResult { .. } => 11,
        AgentTurnEvent::Subagent { .. } => 12,
        AgentTurnEvent::Result { .. } => 13,
        AgentTurnEvent::ContextCompaction { .. } => 14,
        AgentTurnEvent::ContextCompactionStatus { .. } => 15,
        AgentTurnEvent::ContextUsage { .. } => 16,
        AgentTurnEvent::Error { .. } => 17,
        AgentTurnEvent::UnknownLine { .. } => 18,
    }
}
