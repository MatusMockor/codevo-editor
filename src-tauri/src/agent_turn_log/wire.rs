use super::agent_thread_store::AgentTurnEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const AGENT_TURN_LOG_SEQ_BASE: i64 = 1;
pub(crate) const MAX_APPEND_OPS: usize = 256;
pub(crate) const MAX_APPEND_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_PAGE_EVENTS: u32 = 200;
pub(crate) const MAX_PAGE_BYTES: u32 = 512 * 1024;
pub(crate) const MAX_DIGEST_BYTES: usize = 64 * 1024;
pub(crate) const MAX_DIGEST_CAPACITIES: usize = 16;
// Numeric wire precision, not a retention or disk quota.
pub(crate) const MAX_LOG_COUNTER: i64 = 9_007_199_254_740_991;
pub(crate) const MAX_TURN_SUMMARIES: usize = 64;
pub(crate) const MAX_TURN_PROMPT_BYTES: usize = 32 * 1024;
pub(crate) const MAX_SUMMARY_PROMPT_RESPONSE_BYTES: usize = 512 * 1024;
pub(crate) const MAX_TURN_LIFECYCLE_BYTES: usize = 128 * 1024;
pub(crate) const MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES: usize = 512 * 1024;
pub(crate) const AGENT_TURN_DIGEST_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentTurnLogLossKind {
    None,
    LegacyWindow,
    SupervisorGap,
    DiskBudget,
    // Historical loss marker; new writes have no cumulative turn-size quota.
    TurnCeiling,
    Unreadable,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogLoss {
    pub(crate) kind: AgentTurnLogLossKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) at_epoch_ms: Option<u64>,
}

impl AgentTurnLogLoss {
    pub(crate) fn of(kind: AgentTurnLogLossKind) -> Self {
        Self {
            kind,
            at_epoch_ms: None,
        }
    }

    pub(crate) fn is_none(self) -> bool {
        matches!(self.kind, AgentTurnLogLossKind::None)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogScope {
    pub(crate) root_key: String,
    pub(crate) owner_id: String,
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogEntry {
    pub(crate) seq: i64,
    pub(crate) event: AgentTurnEvent,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentTurnDigestProvider {
    ClaudeCode,
    Codex,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnDigestCapacity {
    pub(crate) model: String,
    pub(crate) context_window: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnDigestPrimary {
    pub(crate) model: String,
    pub(crate) input_tokens: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnDigestOccupancy {
    pub(crate) used_tokens: u64,
    pub(crate) context_window: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnContextDigest {
    pub(crate) provider: AgentTurnDigestProvider,
    pub(crate) capacities: Vec<AgentTurnDigestCapacity>,
    pub(crate) primary: Option<AgentTurnDigestPrimary>,
    pub(crate) current: Option<AgentTurnDigestOccupancy>,
    pub(crate) bounded: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnDigestWire {
    pub(crate) version: u32,
    pub(crate) context: AgentTurnContextDigest,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenAgentTurnLogRequest {
    pub(crate) scope: AgentTurnLogScope,
    pub(crate) prior_loss: AgentTurnLogLoss,
    #[serde(default)]
    pub(crate) prompt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogLease {
    pub(crate) writer_epoch: i64,
    pub(crate) next_seq: i64,
    pub(crate) digest: Option<AgentTurnDigestWire>,
    pub(crate) digest_through_seq: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppendAgentTurnLogRequest {
    pub(crate) scope: AgentTurnLogScope,
    pub(crate) writer_epoch: i64,
    pub(crate) expected_next_seq: i64,
    pub(crate) ops: Vec<AgentTurnLogEntry>,
    pub(crate) digest: Option<AgentTurnDigestWire>,
    pub(crate) seal: bool,
    pub(crate) loss: AgentTurnLogLoss,
    #[serde(default)]
    pub(crate) lifecycle: Option<Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentTurnLogBudget {
    Ok,
    Near,
    Evicting,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppendAgentTurnLogReceipt {
    pub(crate) persisted_through_seq: i64,
    pub(crate) next_seq: i64,
    pub(crate) turn_bytes: i64,
    pub(crate) budget: AgentTurnLogBudget,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentTurnLogAnchorAt {
    Tail,
    Before,
    After,
    Around,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogAnchor {
    pub(crate) at: AgentTurnLogAnchorAt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) seq: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadAgentTurnLogPageRequest {
    pub(crate) scope: AgentTurnLogScope,
    pub(crate) anchor: AgentTurnLogAnchor,
    pub(crate) max_events: u32,
    pub(crate) max_bytes: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogPage {
    pub(crate) entries: Vec<AgentTurnLogEntry>,
    pub(crate) first_seq: i64,
    pub(crate) last_seq: i64,
    pub(crate) has_earlier: bool,
    pub(crate) has_later: bool,
    pub(crate) loss: AgentTurnLogLoss,
    pub(crate) clipped: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTurnLogSummary {
    pub(crate) turn_id: String,
    pub(crate) event_count: i64,
    pub(crate) bytes: i64,
    pub(crate) loss: AgentTurnLogLoss,
    pub(crate) sealed: bool,
    pub(crate) digest: Option<AgentTurnDigestWire>,
    pub(crate) prompt: Option<String>,
    pub(crate) prompt_omitted: bool,
    pub(crate) lifecycle: Option<Value>,
    pub(crate) lifecycle_omitted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SummarizeAgentTurnLogsRequest {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_turn_id"
    )]
    pub(crate) turn_id: Option<String>,
    pub(crate) root_key: String,
    pub(crate) owner_id: String,
    pub(crate) thread_id: String,
    #[serde(default)]
    pub(crate) include_prompts: bool,
    #[serde(default)]
    pub(crate) include_lifecycles: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteAgentThreadLogRequest {
    pub(crate) root_key: String,
    pub(crate) owner_id: String,
    pub(crate) thread_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteAgentThreadLogResult {
    pub(crate) deleted: bool,
}

pub(crate) fn lifecycle_bytes(lifecycle: &Value) -> usize {
    serde_json::to_vec(lifecycle).map_or(usize::MAX, |encoded| encoded.len())
}

fn deserialize_turn_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
