use super::{AgentAttachment, AgentTurnEvent, AgentTurnUsage, MAX_AGENT_SAFE_INTEGER};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodexTransport {
    AppServer,
    Exec,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentUsageScope {
    Thread,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubagentActivity {
    Started,
    Interacted,
    Interrupted,
    Completed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAppServerTokenBreakdown {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAppServerUsage {
    pub last: AgentAppServerTokenBreakdown,
    pub total: AgentAppServerTokenBreakdown,
    #[serde(deserialize_with = "nullable_required")]
    pub context_window: Option<u64>,
}

pub(super) fn nonnull_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub(super) fn nullable_required<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub(super) fn nonempty_attachments<'de, D>(
    deserializer: D,
) -> Result<Vec<AgentAttachment>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let attachments = Vec::<AgentAttachment>::deserialize(deserializer)?;
    if attachments.is_empty() {
        return Err(serde::de::Error::custom("attachments must not be empty"));
    }
    Ok(attachments)
}

pub(super) fn child_id(event: &AgentTurnEvent) -> Option<&str> {
    match event {
        AgentTurnEvent::SubagentActivity {
            agent_thread_id, ..
        }
        | AgentTurnEvent::SubagentEvent {
            agent_thread_id, ..
        }
        | AgentTurnEvent::SubagentUsage {
            agent_thread_id, ..
        }
        | AgentTurnEvent::SubagentTurnDone {
            agent_thread_id, ..
        } => Some(agent_thread_id),
        _ => None,
    }
}

fn bounded_identifier(value: &str, allow_empty: bool, limit: usize) -> Result<(), String> {
    if (!allow_empty && value.is_empty())
        || value.len() > limit
        || value.chars().any(char::is_control)
    {
        return Err("Agent app-server identifier exceeds supported bounds.".to_string());
    }
    Ok(())
}

fn identifier(value: &str, allow_empty: bool) -> Result<(), String> {
    bounded_identifier(value, allow_empty, 256)
}

fn validate_nested_content(event: &AgentTurnEvent) -> Result<(), String> {
    match event {
        AgentTurnEvent::ToolCall {
            tool_id,
            name,
            parent_tool_id,
            ..
        } => {
            identifier(tool_id, false)?;
            identifier(name, false)?;
            if let Some(id) = parent_tool_id {
                identifier(id, false)?;
            }
        }
        AgentTurnEvent::ToolResult {
            tool_id,
            parent_tool_id,
            ..
        } => {
            identifier(tool_id, false)?;
            if let Some(id) = parent_tool_id {
                identifier(id, false)?;
            }
        }
        AgentTurnEvent::AssistantText { .. } | AgentTurnEvent::Reasoning { .. } => {}
        _ => return Err("Agent subagent content must be text or tool content.".to_string()),
    }
    super::validate_agent_turn_event(event)
}

fn safe_count(value: Option<u64>) -> Result<(), String> {
    if value.is_some_and(|value| value > MAX_AGENT_SAFE_INTEGER) {
        return Err("Agent app-server telemetry exceeds the supported count.".to_string());
    }
    Ok(())
}

pub(super) fn validate_usage(usage: &AgentTurnUsage) -> Result<(), String> {
    safe_count(usage.cached_input_tokens)?;
    safe_count(usage.reasoning_output_tokens)?;
    let Some(snapshot) = &usage.app_server_usage else {
        return Ok(());
    };
    safe_count(snapshot.context_window)?;
    for value in [&snapshot.last, &snapshot.total] {
        for count in [
            value.input_tokens,
            value.cached_input_tokens,
            value.cache_write_input_tokens,
            value.output_tokens,
            value.reasoning_output_tokens,
            value.total_tokens,
        ] {
            safe_count(Some(count))?;
        }
    }
    Ok(())
}

pub(super) fn validate_event(event: &AgentTurnEvent) -> Result<(), String> {
    if let Some(id) = child_id(event) {
        identifier(id, false)?;
    }
    match event {
        AgentTurnEvent::UserMessage { attachments, .. } => {
            super::validate_agent_turn_attachments(attachments)
        }
        AgentTurnEvent::SubagentActivity { agent_path, .. } => {
            bounded_identifier(agent_path, true, 4096)
        }
        AgentTurnEvent::SubagentEvent { event, .. } => validate_nested_content(event),
        AgentTurnEvent::SubagentUsage { usage, .. } => super::validate_agent_turn_usage(usage),
        AgentTurnEvent::SubagentTurnDone { duration_ms, .. }
        | AgentTurnEvent::Result { duration_ms, .. } => safe_count(*duration_ms),
        AgentTurnEvent::Queued {
            thread_id,
            client_user_message_id,
        } => {
            identifier(thread_id, false)?;
            if let Some(id) = client_user_message_id {
                super::validate_resume_session_id(id)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
