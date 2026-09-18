const MAX_AGENT_TOOL_SUMMARY_BYTES: usize = 512;
use super::codex_app_server_protocol::{
    CommandExecutionItem, CommandExecutionStatus, ErrorNotification, FileChangeItem,
    ItemNotification, McpToolCallItem, ReasoningItem, ServerNotification, SubAgentActivityItem,
    SubAgentActivityKind, ThreadCompactedNotification, ThreadItem, ThreadStartedNotification,
    ThreadTokenUsage, ThreadTokenUsageUpdatedNotification, TokenUsageBreakdown, TurnError,
    TurnStatus, WebSearchItem, MAX_PROTOCOL_METHOD_BYTES,
};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};
use std::collections::{HashMap, HashSet};

pub const CODEX_TURN_EVENT_SCHEMA_VERSION: u8 = 1;
pub const MAX_CODEX_EVENT_TEXT_BYTES: usize = 16 * 1_024;
pub const MAX_CODEX_TOOL_ID_BYTES: usize = 256;
pub const MAX_CODEX_TOOL_NAME_BYTES: usize = 256;
pub const MAX_CODEX_THREAD_ID_BYTES: usize = 256;
pub const MAX_CODEX_CLIENT_USER_MESSAGE_ID_BYTES: usize = 256;
pub const MAX_SUBAGENT_THREADS_PER_TURN: usize = 32;
pub const MAX_CODEX_UNKNOWN_FRAMES_PER_TURN: usize = 8;
pub const MAX_CODEX_SUBAGENT_ACTIVITY_IDS: usize = 256;
pub const MAX_CODEX_SUBAGENT_TURN_IDS: usize = 4096;

pub const SHELL_TOOL_NAME: &str = "shell";
pub const APPLY_PATCH_TOOL_NAME: &str = "apply_patch";
pub const WEB_SEARCH_TOOL_NAME: &str = "web_search";

const SERIALIZATION_FALLBACK_LINE: &str =
    r#"{"v":1,"t":"unknownFrame","method":"codexTurnEventSerializationFailed"}"#;

const MAX_SAFE_WIRE_INTEGER: i64 = 9_007_199_254_740_991;

const CHANGED_PATH_SEPARATOR: &str = ", ";
const TEXT_PART_SEPARATOR: &str = "\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexTextRole {
    Assistant,
    Reasoning,
}

impl CodexTextRole {
    fn wire_role(self) -> &'static str {
        match self {
            Self::Assistant => "assistant",
            Self::Reasoning => "reasoning",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexSubagentKind {
    Started,
    Interacted,
    Interrupted,
    Completed,
}

impl CodexSubagentKind {
    fn wire_kind(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Interacted => "interacted",
            Self::Interrupted => "interrupted",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexUsageScope {
    Thread,
    Subagent,
}

impl CodexUsageScope {
    fn wire_scope(self) -> &'static str {
        match self {
            Self::Thread => "thread",
            Self::Subagent => "subagent",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CodexClippedText {
    pub text: String,
    pub clipped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CodexTokenBreakdown {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub cache_write_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}

impl CodexTokenBreakdown {
    fn from_protocol(breakdown: Option<&TokenUsageBreakdown>) -> Self {
        let Some(breakdown) = breakdown else {
            return Self::default();
        };
        Self {
            input_tokens: breakdown.input_tokens.unwrap_or_default(),
            cached_input_tokens: breakdown.cached_input_tokens.unwrap_or_default(),
            cache_write_input_tokens: breakdown.cache_write_input_tokens.unwrap_or_default(),
            output_tokens: breakdown.output_tokens.unwrap_or_default(),
            reasoning_output_tokens: breakdown.reasoning_output_tokens.unwrap_or_default(),
            total_tokens: breakdown.total_tokens.unwrap_or_default(),
        }
    }
}

impl Serialize for CodexTokenBreakdown {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("inputTokens", &self.input_tokens)?;
        map.serialize_entry("cachedInputTokens", &self.cached_input_tokens)?;
        map.serialize_entry("cacheWriteInputTokens", &self.cache_write_input_tokens)?;
        map.serialize_entry("outputTokens", &self.output_tokens)?;
        map.serialize_entry("reasoningOutputTokens", &self.reasoning_output_tokens)?;
        map.serialize_entry("totalTokens", &self.total_tokens)?;
        map.end()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CodexUsage {
    pub last: CodexTokenBreakdown,
    pub total: CodexTokenBreakdown,
    pub context_window: Option<i64>,
}

impl CodexUsage {
    fn from_protocol(usage: &ThreadTokenUsage) -> Self {
        Self {
            last: CodexTokenBreakdown::from_protocol(usage.last.as_ref()),
            total: CodexTokenBreakdown::from_protocol(usage.total.as_ref()),
            context_window: usage.model_context_window,
        }
    }
}

impl Serialize for CodexUsage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("last", &self.last)?;
        map.serialize_entry("total", &self.total)?;
        map.serialize_entry("contextWindow", &self.context_window)?;
        map.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexItemEvent {
    Text {
        role: CodexTextRole,
        text: CodexClippedText,
    },
    ToolCall {
        tool_id: String,
        name: CodexClippedText,
        input_summary: CodexClippedText,
    },
    ToolResult {
        tool_id: String,
        output_summary: CodexClippedText,
        is_error: bool,
    },
}

impl CodexItemEvent {
    fn serialize_fields<S>(&self, map: &mut S) -> Result<(), S::Error>
    where
        S: SerializeMap,
    {
        match self {
            Self::Text { role, text } => {
                map.serialize_entry("t", "text")?;
                map.serialize_entry("role", role.wire_role())?;
                map.serialize_entry("text", &text.text)?;
                map.serialize_entry("clipped", &text.clipped)
            }
            Self::ToolCall {
                tool_id,
                name,
                input_summary,
            } => {
                map.serialize_entry("t", "toolCall")?;
                map.serialize_entry("toolId", tool_id)?;
                map.serialize_entry("name", &name.text)?;
                map.serialize_entry("inputSummary", &input_summary.text)?;
                map.serialize_entry("clipped", &(name.clipped || input_summary.clipped))
            }
            Self::ToolResult {
                tool_id,
                output_summary,
                is_error,
            } => {
                map.serialize_entry("t", "toolResult")?;
                map.serialize_entry("toolId", tool_id)?;
                map.serialize_entry("outputSummary", &output_summary.text)?;
                map.serialize_entry("isError", is_error)?;
                map.serialize_entry("clipped", &output_summary.clipped)
            }
        }
    }
}

struct CodexItemEventPayload<'a>(&'a CodexItemEvent);

impl Serialize for CodexItemEventPayload<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(None)?;
        self.0.serialize_fields(&mut map)?;
        map.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexTurnEvent {
    Session {
        thread_id: String,
    },
    SessionFallback {
        previous_thread_id: String,
        thread_id: String,
    },
    Item(CodexItemEvent),
    Subagent {
        kind: CodexSubagentKind,
        agent_thread_id: String,
        agent_path: CodexClippedText,
    },
    SubagentItem {
        agent_thread_id: String,
        inner: CodexItemEvent,
    },
    Usage {
        scope: CodexUsageScope,
        thread_id: String,
        usage: CodexUsage,
    },
    Result {
        is_error: bool,
        duration_ms: Option<i64>,
        text: CodexClippedText,
        usage: Option<CodexUsage>,
    },
    SubagentTurnCompleted {
        agent_thread_id: String,
        duration_ms: Option<i64>,
        is_error: bool,
    },
    Compaction {
        before_tokens: Option<i64>,
        after_tokens: Option<i64>,
    },
    Queued {
        thread_id: String,
        client_user_message_id: Option<String>,
    },
    Error {
        message: CodexClippedText,
        thread_id: Option<String>,
    },
    UnknownFrame {
        method: String,
    },
}

impl CodexTurnEvent {
    pub fn session_fallback(previous_thread_id: &str, thread_id: &str) -> Option<Self> {
        let previous_thread_id = session_identity(previous_thread_id)?;
        let thread_id = session_identity(thread_id)?;
        if previous_thread_id == thread_id {
            return None;
        }
        Some(Self::SessionFallback {
            previous_thread_id,
            thread_id,
        })
    }

    pub fn text(role: CodexTextRole, text: CodexClippedText) -> Self {
        Self::Item(CodexItemEvent::Text { role, text })
    }

    pub fn tool_call(
        tool_id: String,
        name: CodexClippedText,
        input_summary: CodexClippedText,
    ) -> Self {
        Self::Item(CodexItemEvent::ToolCall {
            tool_id,
            name,
            input_summary,
        })
    }

    pub fn tool_result(tool_id: String, output_summary: CodexClippedText, is_error: bool) -> Self {
        Self::Item(CodexItemEvent::ToolResult {
            tool_id,
            output_summary,
            is_error,
        })
    }

    pub fn queued(thread_id: String, client_user_message_id: Option<&str>) -> Self {
        Self::Queued {
            thread_id,
            client_user_message_id: client_user_message_id
                .and_then(|id| bounded_identity(id, MAX_CODEX_CLIENT_USER_MESSAGE_ID_BYTES)),
        }
    }

    pub fn ndjson_line(&self) -> String {
        let encoded =
            serde_json::to_string(self).unwrap_or_else(|_| SERIALIZATION_FALLBACK_LINE.to_string());
        format!("{encoded}\n")
    }
}

impl Serialize for CodexTurnEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("v", &CODEX_TURN_EVENT_SCHEMA_VERSION)?;
        match self {
            Self::Session { thread_id } => {
                map.serialize_entry("t", "session")?;
                map.serialize_entry("threadId", thread_id)?;
            }
            Self::SessionFallback {
                previous_thread_id,
                thread_id,
            } => {
                map.serialize_entry("t", "sessionFallback")?;
                map.serialize_entry("previousThreadId", previous_thread_id)?;
                map.serialize_entry("threadId", thread_id)?;
            }
            Self::Item(item) => item.serialize_fields(&mut map)?,
            Self::Subagent {
                kind,
                agent_thread_id,
                agent_path,
            } => {
                map.serialize_entry("t", "subagent")?;
                map.serialize_entry("kind", kind.wire_kind())?;
                map.serialize_entry("agentThreadId", agent_thread_id)?;
                map.serialize_entry("agentPath", &agent_path.text)?;
                map.serialize_entry("clipped", &agent_path.clipped)?;
            }
            Self::SubagentItem {
                agent_thread_id,
                inner,
            } => {
                map.serialize_entry("t", "subagentItem")?;
                map.serialize_entry("agentThreadId", agent_thread_id)?;
                map.serialize_entry("inner", &CodexItemEventPayload(inner))?;
            }
            Self::Usage {
                scope,
                thread_id,
                usage,
            } => {
                map.serialize_entry("t", "usage")?;
                map.serialize_entry("scope", scope.wire_scope())?;
                map.serialize_entry("threadId", thread_id)?;
                map.serialize_entry("usage", usage)?;
            }
            Self::Result {
                is_error,
                duration_ms,
                text,
                usage,
            } => {
                map.serialize_entry("t", "result")?;
                map.serialize_entry("isError", is_error)?;
                map.serialize_entry("durationMs", duration_ms)?;
                map.serialize_entry("text", &text.text)?;
                map.serialize_entry("clipped", &text.clipped)?;
                map.serialize_entry("usage", usage)?;
            }
            Self::SubagentTurnCompleted {
                agent_thread_id,
                duration_ms,
                is_error,
            } => {
                map.serialize_entry("t", "subagentTurnCompleted")?;
                map.serialize_entry("agentThreadId", agent_thread_id)?;
                map.serialize_entry("durationMs", duration_ms)?;
                map.serialize_entry("isError", is_error)?;
            }
            Self::Compaction {
                before_tokens,
                after_tokens,
            } => {
                map.serialize_entry("t", "compaction")?;
                map.serialize_entry("beforeTokens", before_tokens)?;
                map.serialize_entry("afterTokens", after_tokens)?;
            }
            Self::Queued {
                thread_id,
                client_user_message_id,
            } => {
                map.serialize_entry("t", "queued")?;
                map.serialize_entry("threadId", thread_id)?;
                map.serialize_entry("clientUserMessageId", client_user_message_id)?;
            }
            Self::Error { message, thread_id } => {
                map.serialize_entry("t", "error")?;
                map.serialize_entry("message", &message.text)?;
                map.serialize_entry("clipped", &message.clipped)?;
                map.serialize_entry("threadId", thread_id)?;
            }
            Self::UnknownFrame { method } => {
                map.serialize_entry("t", "unknownFrame")?;
                map.serialize_entry("method", method)?;
            }
        }
        map.end()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexSubagentThread {
    pub thread_id: String,
    pub agent_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexThreadRole {
    Root,
    Subagent,
    Foreign,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexItemPhase {
    Started,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CodexItemOutcome {
    Events(Vec<CodexItemEvent>),
    Dropped,
    Unknown,
}

#[derive(Debug, Clone, Default)]
pub struct CodexTurnProjection {
    root_thread_id: Option<String>,
    subagent_threads: Vec<CodexSubagentThread>,
    unknown_frames_emitted: usize,
    subagent_activity_ids: Vec<String>,
    root_usage: Option<CodexUsage>,
    subagent_turns: HashMap<String, String>,
    observed_subagent_turns: HashSet<(String, String)>,
}

impl CodexTurnProjection {
    pub fn new(root_thread_id: Option<String>) -> Self {
        Self {
            root_thread_id: root_thread_id.and_then(|id| session_identity(id.as_str())),
            subagent_threads: Vec::new(),
            unknown_frames_emitted: 0,
            subagent_activity_ids: Vec::new(),
            root_usage: None,
            subagent_turns: HashMap::new(),
            observed_subagent_turns: HashSet::new(),
        }
    }

    pub fn root_thread_id(&self) -> Option<&str> {
        self.root_thread_id.as_deref()
    }

    pub fn subagent_threads(&self) -> &[CodexSubagentThread] {
        self.subagent_threads.as_slice()
    }

    pub fn unknown_frames_emitted(&self) -> usize {
        self.unknown_frames_emitted
    }

    pub fn adopt_root(&mut self, thread_id: &str) -> Vec<CodexTurnEvent> {
        let Some(bounded) = session_identity(thread_id) else {
            return self.unknown_frame("thread/start");
        };
        if self
            .root_thread_id
            .as_deref()
            .is_some_and(|root| root != bounded)
        {
            return self.unknown_frame("thread/start");
        }
        self.root_thread_id = Some(bounded.clone());
        vec![CodexTurnEvent::Session { thread_id: bounded }]
    }

    pub fn project(&mut self, notification: ServerNotification) -> Vec<CodexTurnEvent> {
        match notification {
            ServerNotification::ThreadStarted(payload) => self.thread_started(payload),
            ServerNotification::TurnStarted(payload) => {
                self.subagent_turn_started(&payload.thread_id, &payload.turn.id);
                Vec::new()
            }
            ServerNotification::TurnCompleted(payload) => self.turn_completed(
                payload.thread_id.as_str(),
                &payload.turn.id,
                &payload.turn.status,
                payload.turn.duration_ms,
                payload.turn.error.as_ref(),
            ),
            ServerNotification::ItemStarted(payload) => self.item(payload, CodexItemPhase::Started),
            ServerNotification::ItemCompleted(payload) => {
                self.item(payload, CodexItemPhase::Completed)
            }
            ServerNotification::ThreadTokenUsageUpdated(payload) => self.token_usage(payload),
            ServerNotification::ThreadCompacted(payload) => self.compacted(payload),
            ServerNotification::ThreadQueueChanged { thread_id } => self.queue_changed(thread_id),
            ServerNotification::Error(payload) => self.error(payload),
            ServerNotification::Ignored { .. } => Vec::new(),
            ServerNotification::Unknown { method } => self.unknown_frame(method.as_str()),
        }
    }

    fn thread_started(&mut self, payload: ThreadStartedNotification) -> Vec<CodexTurnEvent> {
        let Some(thread_id) = session_identity(payload.thread.id.as_str()) else {
            return self.unknown_frame("thread/started");
        };
        if self.root_thread_id.is_none() {
            self.root_thread_id = Some(thread_id.clone());
            return vec![CodexTurnEvent::Session { thread_id }];
        }
        match self.role(thread_id.as_str()) {
            CodexThreadRole::Root => vec![CodexTurnEvent::Session { thread_id }],
            CodexThreadRole::Subagent => Vec::new(),
            CodexThreadRole::Foreign => self.unknown_frame("thread/started"),
        }
    }

    fn turn_completed(
        &mut self,
        thread_id: &str,
        turn_id: &str,
        status: &TurnStatus,
        duration_ms: Option<i64>,
        error: Option<&TurnError>,
    ) -> Vec<CodexTurnEvent> {
        let duration_ms = duration_ms.filter(|value| safe_metric(*value));
        let is_error = !matches!(status, TurnStatus::Completed);
        match self.role(thread_id) {
            CodexThreadRole::Root => vec![CodexTurnEvent::Result {
                is_error,
                duration_ms,
                text: error.map(turn_error_text).unwrap_or_default(),
                usage: self.root_usage,
            }],
            CodexThreadRole::Subagent => {
                if bounded_identity(turn_id, MAX_CODEX_THREAD_ID_BYTES).is_none() {
                    return Vec::new();
                }
                if self.observed_subagent_turns.len() < MAX_CODEX_SUBAGENT_TURN_IDS {
                    self.observed_subagent_turns
                        .insert((thread_id.to_string(), turn_id.to_string()));
                }
                if self.subagent_turns.get(thread_id).map(String::as_str) != Some(turn_id) {
                    return Vec::new();
                }
                self.subagent_turns.remove(thread_id);
                vec![CodexTurnEvent::SubagentTurnCompleted {
                    agent_thread_id: thread_id.to_string(),
                    duration_ms,
                    is_error,
                }]
            }
            CodexThreadRole::Foreign => self.unknown_frame("turn/completed"),
        }
    }

    fn subagent_turn_started(&mut self, thread_id: &str, turn_id: &str) {
        if !matches!(self.role(thread_id), CodexThreadRole::Subagent)
            || bounded_identity(turn_id, MAX_CODEX_THREAD_ID_BYTES).is_none()
            || self.subagent_turns.get(thread_id).map(String::as_str) == Some(turn_id)
        {
            return;
        }
        let identity = (thread_id.to_string(), turn_id.to_string());
        if self.observed_subagent_turns.contains(&identity) {
            return;
        }
        // Never evict tombstones: late starts/completions cannot resurrect prior work.
        self.subagent_turns.remove(thread_id);
        if self.observed_subagent_turns.len() >= MAX_CODEX_SUBAGENT_TURN_IDS {
            return;
        }
        self.observed_subagent_turns.insert(identity);
        self.subagent_turns
            .insert(thread_id.to_string(), turn_id.to_string());
    }

    fn item(&mut self, payload: ItemNotification, phase: CodexItemPhase) -> Vec<CodexTurnEvent> {
        let method = item_method(phase);
        let Some(thread_id) =
            bounded_identity(payload.thread_id.as_str(), MAX_CODEX_THREAD_ID_BYTES)
        else {
            return self.unknown_frame(method);
        };
        let role = self.role(thread_id.as_str());
        if let ThreadItem::SubAgentActivity(activity) = &payload.item {
            if matches!(phase, CodexItemPhase::Completed) {
                return Vec::new();
            }
            return self.subagent_activity(role, activity, method);
        }
        match role {
            CodexThreadRole::Root => match project_item(&payload.item, phase) {
                CodexItemOutcome::Events(events) => {
                    events.into_iter().map(CodexTurnEvent::Item).collect()
                }
                CodexItemOutcome::Dropped => Vec::new(),
                CodexItemOutcome::Unknown => self.unknown_frame(method),
            },
            CodexThreadRole::Subagent => match project_item(&payload.item, phase) {
                CodexItemOutcome::Events(events) => events
                    .into_iter()
                    .map(|inner| CodexTurnEvent::SubagentItem {
                        agent_thread_id: thread_id.clone(),
                        inner,
                    })
                    .collect(),
                CodexItemOutcome::Dropped => Vec::new(),
                CodexItemOutcome::Unknown => self.unknown_frame(method),
            },
            CodexThreadRole::Foreign => self.unknown_frame(method),
        }
    }

    fn subagent_activity(
        &mut self,
        role: CodexThreadRole,
        activity: &SubAgentActivityItem,
        method: &str,
    ) -> Vec<CodexTurnEvent> {
        if !matches!(role, CodexThreadRole::Root) {
            return self.unknown_frame(method);
        }
        let Some(kind) = subagent_kind(&activity.kind) else {
            return self.unknown_frame(method);
        };
        let Some(agent_thread_id) =
            bounded_identity(activity.agent_thread_id.as_str(), MAX_CODEX_THREAD_ID_BYTES)
        else {
            return self.unknown_frame(method);
        };
        let agent_path = clipped_text(
            activity.agent_path.as_deref().unwrap_or_default(),
            MAX_CODEX_TOOL_NAME_BYTES,
        );
        if self.root_thread_id.as_deref() == Some(agent_thread_id.as_str())
            || bounded_identity(activity.id.as_str(), MAX_CODEX_TOOL_ID_BYTES).is_none()
        {
            return self.unknown_frame(method);
        }
        if self
            .subagent_activity_ids
            .iter()
            .any(|seen| seen == &activity.id)
        {
            return Vec::new();
        }
        if self.subagent_activity_ids.len() >= MAX_CODEX_SUBAGENT_ACTIVITY_IDS {
            return self.unknown_frame(method);
        }
        if !self.register_subagent(agent_thread_id.as_str(), agent_path.text.as_str()) {
            return self.unknown_frame(method);
        }
        if !self.mark_subagent_activity(activity.id.as_str()) {
            return Vec::new();
        }
        if matches!(
            kind,
            CodexSubagentKind::Started
                | CodexSubagentKind::Interacted
                | CodexSubagentKind::Interrupted
        ) {
            self.subagent_turns.remove(&agent_thread_id);
        }
        vec![CodexTurnEvent::Subagent {
            kind,
            agent_thread_id,
            agent_path,
        }]
    }

    fn register_subagent(&mut self, thread_id: &str, agent_path: &str) -> bool {
        if self
            .subagent_threads
            .iter()
            .any(|thread| thread.thread_id == thread_id)
        {
            return true;
        }
        if self.subagent_threads.len() >= MAX_SUBAGENT_THREADS_PER_TURN {
            return false;
        }
        self.subagent_threads.push(CodexSubagentThread {
            thread_id: thread_id.to_string(),
            agent_path: agent_path.to_string(),
        });
        true
    }

    fn mark_subagent_activity(&mut self, item_id: &str) -> bool {
        if self
            .subagent_activity_ids
            .iter()
            .any(|seen| seen == item_id)
        {
            return false;
        }
        if self.subagent_activity_ids.len() < MAX_CODEX_SUBAGENT_ACTIVITY_IDS {
            self.subagent_activity_ids.push(item_id.to_string());
        }
        true
    }

    fn token_usage(&mut self, payload: ThreadTokenUsageUpdatedNotification) -> Vec<CodexTurnEvent> {
        let Some(thread_id) =
            bounded_identity(payload.thread_id.as_str(), MAX_CODEX_THREAD_ID_BYTES)
        else {
            return self.unknown_frame("thread/tokenUsage/updated");
        };
        let Some(reported) = payload.token_usage.as_ref() else {
            return Vec::new();
        };
        let usage = CodexUsage::from_protocol(reported);
        if !valid_usage(&usage) {
            return self.unknown_frame("thread/tokenUsage/updated");
        }
        match self.role(thread_id.as_str()) {
            CodexThreadRole::Root => {
                self.root_usage = Some(usage);
                vec![CodexTurnEvent::Usage {
                    scope: CodexUsageScope::Thread,
                    thread_id,
                    usage,
                }]
            }
            CodexThreadRole::Subagent => vec![CodexTurnEvent::Usage {
                scope: CodexUsageScope::Subagent,
                thread_id,
                usage,
            }],
            CodexThreadRole::Foreign => self.unknown_frame("thread/tokenUsage/updated"),
        }
    }

    fn compacted(&mut self, payload: ThreadCompactedNotification) -> Vec<CodexTurnEvent> {
        match self.role(payload.thread_id.as_str()) {
            CodexThreadRole::Root => vec![CodexTurnEvent::Compaction {
                before_tokens: None,
                after_tokens: None,
            }],
            CodexThreadRole::Subagent => Vec::new(),
            CodexThreadRole::Foreign => self.unknown_frame("thread/compacted"),
        }
    }

    fn queue_changed(&mut self, thread_id: String) -> Vec<CodexTurnEvent> {
        let Some(thread_id) = bounded_identity(thread_id.as_str(), MAX_CODEX_THREAD_ID_BYTES)
        else {
            return self.unknown_frame("thread/queue/changed");
        };
        match self.role(thread_id.as_str()) {
            CodexThreadRole::Root => vec![CodexTurnEvent::queued(thread_id, None)],
            CodexThreadRole::Subagent => Vec::new(),
            CodexThreadRole::Foreign => self.unknown_frame("thread/queue/changed"),
        }
    }

    fn error(&mut self, payload: ErrorNotification) -> Vec<CodexTurnEvent> {
        vec![CodexTurnEvent::Error {
            message: turn_error_text(&payload.error),
            thread_id: payload
                .thread_id
                .as_deref()
                .and_then(|thread_id| bounded_identity(thread_id, MAX_CODEX_THREAD_ID_BYTES)),
        }]
    }

    fn unknown_frame(&mut self, method: &str) -> Vec<CodexTurnEvent> {
        if self.unknown_frames_emitted >= MAX_CODEX_UNKNOWN_FRAMES_PER_TURN {
            return Vec::new();
        }
        self.unknown_frames_emitted += 1;
        vec![CodexTurnEvent::UnknownFrame {
            method: clipped_text(method, MAX_PROTOCOL_METHOD_BYTES).text,
        }]
    }

    fn role(&self, thread_id: &str) -> CodexThreadRole {
        if self.root_thread_id.as_deref() == Some(thread_id) {
            return CodexThreadRole::Root;
        }
        if self
            .subagent_threads
            .iter()
            .any(|thread| thread.thread_id == thread_id)
        {
            return CodexThreadRole::Subagent;
        }
        CodexThreadRole::Foreign
    }
}

fn safe_metric(value: i64) -> bool {
    (0..=MAX_SAFE_WIRE_INTEGER).contains(&value)
}

fn valid_usage(usage: &CodexUsage) -> bool {
    [usage.last, usage.total].iter().all(|part| {
        [
            part.input_tokens,
            part.cached_input_tokens,
            part.cache_write_input_tokens,
            part.output_tokens,
            part.reasoning_output_tokens,
            part.total_tokens,
        ]
        .into_iter()
        .all(safe_metric)
    }) && usage.context_window.is_none_or(safe_metric)
}

fn item_method(phase: CodexItemPhase) -> &'static str {
    match phase {
        CodexItemPhase::Started => "item/started",
        CodexItemPhase::Completed => "item/completed",
    }
}

fn subagent_kind(kind: &SubAgentActivityKind) -> Option<CodexSubagentKind> {
    match kind {
        SubAgentActivityKind::Started => Some(CodexSubagentKind::Started),
        SubAgentActivityKind::Interacted => Some(CodexSubagentKind::Interacted),
        SubAgentActivityKind::Interrupted => Some(CodexSubagentKind::Interrupted),
        SubAgentActivityKind::Completed => Some(CodexSubagentKind::Completed),
        SubAgentActivityKind::Unrecognized { .. } => None,
    }
}

fn project_item(item: &ThreadItem, phase: CodexItemPhase) -> CodexItemOutcome {
    match item {
        ThreadItem::UserMessage { .. } => CodexItemOutcome::Dropped,
        ThreadItem::ContextCompaction { .. } => CodexItemOutcome::Dropped,
        ThreadItem::Ignored { .. } => CodexItemOutcome::Dropped,
        ThreadItem::AgentMessage(message) => {
            message_outcome(CodexTextRole::Assistant, message.text.as_deref(), phase)
        }
        ThreadItem::Reasoning(reasoning) => {
            let text = reasoning_text(reasoning);
            message_outcome(CodexTextRole::Reasoning, Some(text.as_str()), phase)
        }
        ThreadItem::CommandExecution(command) => command_outcome(command, phase),
        ThreadItem::FileChange(change) => file_change_outcome(change, phase),
        ThreadItem::McpToolCall(call) => mcp_tool_call_outcome(call, phase),
        ThreadItem::WebSearch(search) => web_search_outcome(search, phase),
        ThreadItem::SubAgentActivity(_) => CodexItemOutcome::Unknown,
        ThreadItem::Unrecognized { .. } => CodexItemOutcome::Unknown,
    }
}

fn message_outcome(
    role: CodexTextRole,
    text: Option<&str>,
    phase: CodexItemPhase,
) -> CodexItemOutcome {
    if !matches!(phase, CodexItemPhase::Completed) {
        return CodexItemOutcome::Dropped;
    }
    let bounded = clipped_text(text.unwrap_or_default(), MAX_CODEX_EVENT_TEXT_BYTES);
    if bounded.text.is_empty() {
        return CodexItemOutcome::Dropped;
    }
    CodexItemOutcome::Events(vec![CodexItemEvent::Text {
        role,
        text: bounded,
    }])
}

fn reasoning_text(reasoning: &ReasoningItem) -> String {
    match reasoning.summary.is_empty() {
        true => reasoning.content.join(TEXT_PART_SEPARATOR),
        false => reasoning.summary.join(TEXT_PART_SEPARATOR),
    }
}

fn command_outcome(command: &CommandExecutionItem, phase: CodexItemPhase) -> CodexItemOutcome {
    let Some(tool_id) = bounded_identity(command.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    match phase {
        CodexItemPhase::Started => CodexItemOutcome::Events(vec![CodexItemEvent::ToolCall {
            tool_id,
            name: clipped_text(SHELL_TOOL_NAME, MAX_CODEX_TOOL_NAME_BYTES),
            input_summary: clipped_text(
                command.command.as_deref().unwrap_or_default(),
                MAX_AGENT_TOOL_SUMMARY_BYTES,
            ),
        }]),
        CodexItemPhase::Completed => CodexItemOutcome::Events(vec![CodexItemEvent::ToolResult {
            tool_id,
            output_summary: clipped_text(
                command.aggregated_output.as_deref().unwrap_or_default(),
                MAX_AGENT_TOOL_SUMMARY_BYTES,
            ),
            is_error: command_is_error(command),
        }]),
    }
}

fn command_is_error(command: &CommandExecutionItem) -> bool {
    if !matches!(command.status, CommandExecutionStatus::Completed) {
        return true;
    }
    command.exit_code != Some(0)
}

fn file_change_outcome(change: &FileChangeItem, phase: CodexItemPhase) -> CodexItemOutcome {
    if !matches!(phase, CodexItemPhase::Started) {
        return CodexItemOutcome::Dropped;
    }
    let Some(tool_id) = bounded_identity(change.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    let paths = change
        .changes
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>()
        .join(CHANGED_PATH_SEPARATOR);
    CodexItemOutcome::Events(vec![CodexItemEvent::ToolCall {
        tool_id,
        name: clipped_text(APPLY_PATCH_TOOL_NAME, MAX_CODEX_TOOL_NAME_BYTES),
        input_summary: clipped_text(paths.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES),
    }])
}

fn mcp_tool_call_outcome(call: &McpToolCallItem, phase: CodexItemPhase) -> CodexItemOutcome {
    if !matches!(phase, CodexItemPhase::Started) {
        return CodexItemOutcome::Dropped;
    }
    let Some(tool_id) = bounded_identity(call.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    let (Some(server), Some(tool)) = (call.server.as_deref(), call.tool.as_deref()) else {
        return CodexItemOutcome::Dropped;
    };
    CodexItemOutcome::Events(vec![CodexItemEvent::ToolCall {
        tool_id,
        name: clipped_text(
            format!("{server}/{tool}").as_str(),
            MAX_CODEX_TOOL_NAME_BYTES,
        ),
        input_summary: CodexClippedText::default(),
    }])
}

fn web_search_outcome(search: &WebSearchItem, phase: CodexItemPhase) -> CodexItemOutcome {
    if !matches!(phase, CodexItemPhase::Started) {
        return CodexItemOutcome::Dropped;
    }
    let Some(tool_id) = bounded_identity(search.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    CodexItemOutcome::Events(vec![CodexItemEvent::ToolCall {
        tool_id,
        name: clipped_text(WEB_SEARCH_TOOL_NAME, MAX_CODEX_TOOL_NAME_BYTES),
        input_summary: clipped_text(
            search.query.as_deref().unwrap_or_default(),
            MAX_AGENT_TOOL_SUMMARY_BYTES,
        ),
    }])
}

fn turn_error_text(error: &TurnError) -> CodexClippedText {
    let combined = match error.additional_details.as_deref() {
        Some(details) if !details.is_empty() => {
            format!("{}{TEXT_PART_SEPARATOR}{details}", error.message)
        }
        _ => error.message.clone(),
    };
    clipped_text(combined.as_str(), MAX_CODEX_EVENT_TEXT_BYTES)
}

fn session_identity(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if !(8..=128).contains(&bytes.len())
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return None;
    }
    Some(value.to_string())
}

fn bounded_identity(value: &str, limit: usize) -> Option<String> {
    if value.is_empty() || value.len() > limit || value.contains('\0') {
        return None;
    }
    Some(value.to_string())
}

fn clipped_text(text: &str, limit: usize) -> CodexClippedText {
    let mut bounded = String::with_capacity(text.len().min(limit));
    let mut clipped = false;
    for character in text.chars() {
        let character = match character {
            '\0' => {
                clipped = true;
                '\u{fffd}'
            }
            character => character,
        };
        if bounded.len() + character.len_utf8() > limit {
            clipped = true;
            break;
        }
        bounded.push(character);
    }
    CodexClippedText {
        text: bounded,
        clipped,
    }
}

#[cfg(test)]
#[path = "codex_turn_event_tests.rs"]
mod tests;
