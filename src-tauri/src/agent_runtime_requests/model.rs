use crate::agent_questions::approvals::{
    validate_approval, AgentApprovalDecision, AgentApprovalFact, AgentApprovalKind,
    AgentApprovalRequest, AgentApprovalStatus,
};
use crate::agent_questions::{
    validate_request, validate_response, AgentQuestion, AgentQuestionAnswerItem,
    AgentQuestionRequest, AgentQuestionResponse, AgentQuestionStatus,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fmt;

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_REQUEST_ID_BYTES: usize = 128;
pub const MAX_ANCHOR_TOOL_ID_BYTES: usize = 256;
pub const MAX_REQUESTS_PER_MESSAGE: usize = 64;
pub const MAX_RETAINED_REQUESTS_PER_THREAD: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestError {
    Identifier,
    Integer,
    AnchorToolId,
    Provider,
    Body,
    Resolution,
    Lifecycle,
    Capability,
    DuplicateRequest,
    TooManyRequests,
}

impl fmt::Display for RequestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            Self::Identifier => "identifier",
            Self::Integer => "integer",
            Self::AnchorToolId => "anchor tool id",
            Self::Provider => "provider",
            Self::Body => "body",
            Self::Resolution => "resolution",
            Self::Lifecycle => "lifecycle",
            Self::Capability => "response capability",
            Self::DuplicateRequest => "duplicate request",
            Self::TooManyRequests => "request count",
        };
        write!(formatter, "Invalid agent runtime request {detail}.")
    }
}

impl std::error::Error for RequestError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestStatus {
    Pending,
    Submitting,
    Resolved,
    Cancelled,
    Expired,
    TimedOut,
}

impl RequestStatus {
    pub const ALL: [Self; 6] = [
        Self::Pending,
        Self::Submitting,
        Self::Resolved,
        Self::Cancelled,
        Self::Expired,
        Self::TimedOut,
    ];

    pub fn successors(self) -> &'static [Self] {
        match self {
            Self::Pending => &[
                Self::Submitting,
                Self::Cancelled,
                Self::Expired,
                Self::TimedOut,
            ],
            Self::Submitting => &[Self::Resolved, Self::Pending, Self::Expired],
            Self::Resolved | Self::Cancelled | Self::Expired | Self::TimedOut => &[],
        }
    }

    pub fn is_terminal(self) -> bool {
        self.successors().is_empty()
    }

    pub fn may_become(self, next: Self) -> bool {
        self.successors().contains(&next)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseReason {
    TurnEnded,
    ProviderCancelled,
    TimedOut,
    DeliveryFailed,
    AppRestarted,
    AnswerUnconfirmed,
    RunnerRestarted,
    RunnerStopped,
    TaskCancelled,
    Unknown,
}

impl CloseReason {
    pub const ALL: [Self; 10] = [
        Self::TurnEnded,
        Self::ProviderCancelled,
        Self::TimedOut,
        Self::DeliveryFailed,
        Self::AppRestarted,
        Self::AnswerUnconfirmed,
        Self::RunnerRestarted,
        Self::RunnerStopped,
        Self::TaskCancelled,
        Self::Unknown,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestProvider {
    Codex,
    ClaudeCode,
}

impl RequestProvider {
    pub const ALL: [Self; 2] = [Self::Codex, Self::ClaudeCode];

    pub fn name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claudeCode",
        }
    }

    pub fn parse(name: &str) -> Result<Self, RequestError> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.name() == name)
            .ok_or(RequestError::Provider)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestKind {
    Question,
    Approval,
}

impl RequestKind {
    pub const ALL: [Self; 2] = [Self::Question, Self::Approval];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JournalState {
    Saved,
    Degraded,
}

impl JournalState {
    pub const ALL: [Self; 2] = [Self::Saved, Self::Degraded];
}

pub fn wire_name<T: Serialize>(variant: &T) -> Option<String> {
    match serde_json::to_value(variant).ok()? {
        Value::String(name) => Some(name),
        _ => None,
    }
}

pub fn from_wire_name<T: DeserializeOwned>(name: &str) -> Option<T> {
    serde_json::from_value(Value::String(name.to_string())).ok()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RequestBody {
    Question {
        questions: Vec<AgentQuestion>,
    },
    #[serde(rename_all = "camelCase")]
    Approval {
        approval_kind: AgentApprovalKind,
        title: String,
        detail: String,
        detail_truncated: bool,
        facts: Vec<AgentApprovalFact>,
        decisions: Vec<AgentApprovalDecision>,
    },
}

impl RequestBody {
    pub fn kind(&self) -> RequestKind {
        match self {
            Self::Question { .. } => RequestKind::Question,
            Self::Approval { .. } => RequestKind::Approval,
        }
    }

    pub fn validate(&self, id: &str, provider: RequestProvider) -> Result<(), RequestError> {
        match self {
            Self::Question { questions } => {
                validate_request(&pending_question(id, provider, questions))
                    .map_err(|_| RequestError::Body)
            }
            Self::Approval {
                approval_kind,
                title,
                detail,
                detail_truncated,
                facts,
                decisions,
            } => validate_approval(&AgentApprovalRequest {
                id: id.to_string(),
                task_id: String::new(),
                provider: provider.name().to_string(),
                kind: *approval_kind,
                title: title.clone(),
                detail: detail.clone(),
                detail_truncated: *detail_truncated,
                facts: facts.clone(),
                decisions: decisions.clone(),
                status: AgentApprovalStatus::Pending,
                decision: None,
            })
            .map_err(|_| RequestError::Body),
        }
    }
}

fn pending_question(
    id: &str,
    provider: RequestProvider,
    questions: &[AgentQuestion],
) -> AgentQuestionRequest {
    AgentQuestionRequest {
        id: id.to_string(),
        task_id: String::new(),
        provider: provider.name().to_string(),
        questions: questions.to_vec(),
        status: AgentQuestionStatus::Pending,
        answers: None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RequestResolution {
    Answers {
        answers: Vec<AgentQuestionAnswerItem>,
    },
    Decision {
        decision: AgentApprovalDecision,
    },
}

impl RequestResolution {
    pub fn kind(&self) -> RequestKind {
        match self {
            Self::Answers { .. } => RequestKind::Question,
            Self::Decision { .. } => RequestKind::Approval,
        }
    }

    pub fn validate_for(
        &self,
        id: &str,
        provider: RequestProvider,
        body: &RequestBody,
    ) -> Result<(), RequestError> {
        match (self, body) {
            (Self::Answers { answers }, RequestBody::Question { questions }) => validate_response(
                &pending_question(id, provider, questions),
                &AgentQuestionResponse {
                    answers: answers.clone(),
                },
            )
            .map_err(|_| RequestError::Resolution),
            (Self::Decision { decision }, RequestBody::Approval { decisions, .. })
                if decisions.contains(decision) =>
            {
                Ok(())
            }
            _ => Err(RequestError::Resolution),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RequestLifecycle {
    Pending,
    Submitting {
        reason: CloseReason,
        resolution: Option<RequestResolution>,
    },
    Resolved {
        reason: CloseReason,
        resolved_at_epoch_ms: u64,
        resolution: RequestResolution,
    },
    Cancelled {
        reason: CloseReason,
        resolved_at_epoch_ms: u64,
    },
    Expired {
        reason: CloseReason,
        resolved_at_epoch_ms: u64,
        resolution: Option<RequestResolution>,
    },
    TimedOut {
        reason: CloseReason,
        resolved_at_epoch_ms: u64,
    },
}

impl RequestLifecycle {
    pub fn status(&self) -> RequestStatus {
        match self {
            Self::Pending => RequestStatus::Pending,
            Self::Submitting { .. } => RequestStatus::Submitting,
            Self::Resolved { .. } => RequestStatus::Resolved,
            Self::Cancelled { .. } => RequestStatus::Cancelled,
            Self::Expired { .. } => RequestStatus::Expired,
            Self::TimedOut { .. } => RequestStatus::TimedOut,
        }
    }

    pub fn reason(&self) -> Option<CloseReason> {
        match self {
            Self::Pending => None,
            Self::Submitting { reason, .. }
            | Self::Resolved { reason, .. }
            | Self::Cancelled { reason, .. }
            | Self::Expired { reason, .. }
            | Self::TimedOut { reason, .. } => Some(*reason),
        }
    }

    pub fn resolved_at_epoch_ms(&self) -> Option<u64> {
        match self {
            Self::Pending | Self::Submitting { .. } => None,
            Self::Resolved {
                resolved_at_epoch_ms,
                ..
            }
            | Self::Cancelled {
                resolved_at_epoch_ms,
                ..
            }
            | Self::Expired {
                resolved_at_epoch_ms,
                ..
            }
            | Self::TimedOut {
                resolved_at_epoch_ms,
                ..
            } => Some(*resolved_at_epoch_ms),
        }
    }

    pub fn resolution(&self) -> Option<&RequestResolution> {
        match self {
            Self::Pending | Self::Cancelled { .. } | Self::TimedOut { .. } => None,
            Self::Submitting { resolution, .. } | Self::Expired { resolution, .. } => {
                resolution.as_ref()
            }
            Self::Resolved { resolution, .. } => Some(resolution),
        }
    }

    fn coherent(&self) -> bool {
        match self {
            Self::Expired {
                reason, resolution, ..
            } => resolution.is_none() || *reason == CloseReason::AnswerUnconfirmed,
            _ => true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestParts {
    pub id: String,
    pub turn_id: String,
    pub provider: RequestProvider,
    pub created_at_epoch_ms: u64,
    pub order: u64,
    pub version: u64,
    pub anchor_tool_id: Option<String>,
    pub body: RequestBody,
    pub lifecycle: RequestLifecycle,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    try_from = "super::wire::RequestWire",
    into = "super::wire::RequestWire"
)]
pub struct RuntimeRequest {
    parts: RequestParts,
}

impl RuntimeRequest {
    pub fn new(parts: RequestParts) -> Result<Self, RequestError> {
        if !is_identifier(&parts.id) || !is_identifier(&parts.turn_id) {
            return Err(RequestError::Identifier);
        }
        let resolved_at = parts.lifecycle.resolved_at_epoch_ms().unwrap_or(0);
        if [parts.created_at_epoch_ms, parts.order, parts.version, resolved_at]
            .into_iter()
            .any(|value| value > MAX_SAFE_INTEGER)
            || parts.version == 0
        {
            return Err(RequestError::Integer);
        }
        if parts
            .anchor_tool_id
            .as_deref()
            .is_some_and(|tool_id| !is_anchor_tool_id(tool_id))
        {
            return Err(RequestError::AnchorToolId);
        }
        parts.body.validate(&parts.id, parts.provider)?;
        if !parts.lifecycle.coherent() {
            return Err(RequestError::Lifecycle);
        }
        if let Some(resolution) = parts.lifecycle.resolution() {
            resolution.validate_for(&parts.id, parts.provider, &parts.body)?;
        }
        Ok(Self { parts })
    }

    pub fn parts(&self) -> &RequestParts {
        &self.parts
    }

    pub fn into_parts(self) -> RequestParts {
        self.parts
    }

    pub fn status(&self) -> RequestStatus {
        self.parts.lifecycle.status()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThreadRequestsParts {
    pub workspace_id: Option<String>,
    pub thread_id: String,
    pub epoch: String,
    pub journal: JournalState,
    pub requests: Vec<RuntimeRequest>,
    pub truncated: bool,
    pub unreadable: u64,
    pub reset: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    try_from = "super::wire::ThreadRequestsWire",
    into = "super::wire::ThreadRequestsWire"
)]
pub struct ThreadRequests {
    parts: ThreadRequestsParts,
}

impl ThreadRequests {
    pub fn new(parts: ThreadRequestsParts) -> Result<Self, RequestError> {
        if !is_identifier(&parts.thread_id)
            || !is_identifier(&parts.epoch)
            || parts
                .workspace_id
                .as_deref()
                .is_some_and(|workspace_id| !is_identifier(workspace_id))
        {
            return Err(RequestError::Identifier);
        }
        if parts.unreadable > MAX_SAFE_INTEGER {
            return Err(RequestError::Integer);
        }
        if parts.requests.len() > MAX_REQUESTS_PER_MESSAGE {
            return Err(RequestError::TooManyRequests);
        }
        let mut keys = HashSet::new();
        if parts.requests.iter().any(|request| {
            !keys.insert((request.parts.turn_id.as_str(), request.parts.id.as_str()))
        }) {
            return Err(RequestError::DuplicateRequest);
        }
        Ok(Self { parts })
    }

    pub fn parts(&self) -> &ThreadRequestsParts {
        &self.parts
    }

    pub fn into_parts(self) -> ThreadRequestsParts {
        self.parts
    }
}

pub fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_BYTES
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

pub fn is_anchor_tool_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ANCHOR_TOOL_ID_BYTES
        && !value.chars().any(char::is_control)
}
