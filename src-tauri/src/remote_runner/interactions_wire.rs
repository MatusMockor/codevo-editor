use super::{
    canonical_wire::canonical,
    interactions_rules::{self as rules, within_budget},
    types::uuid,
};
use crate::agent_questions::{
    approvals::{AgentApprovalDecision, AgentApprovalFact, AgentApprovalStatus},
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionRequest, AgentQuestionStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub(super) const MAX_QUESTIONS: usize = 32;
pub(super) const MAX_APPROVALS: usize = 32;
const MAX_LEGACY_APPROVALS: usize = 48;
const MAX_SECTION_BYTES: usize = 3 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WireError {
    Oversize,
    TooMany,
    Malformed,
    ForeignTask,
    Duplicate,
    InvalidItem,
}

impl WireError {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::Oversize => "Runner requests exceed size limit",
            Self::TooMany => "Too many runner requests",
            Self::Malformed => "Invalid runner requests",
            Self::ForeignTask => "Runner request belongs to another task",
            Self::Duplicate => "Duplicate runner request",
            Self::InvalidItem => "Invalid runner request",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SettleReason {
    RunnerRestarted,
    RunnerStopped,
    TurnEnded,
    TaskCancelled,
    ProviderWithdrew,
    TimedOut,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResponseCapability {
    Live,
    NotResumable { reason: SettleReason },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteApprovalKind {
    Command,
    FileChange,
    Tool,
    Plan,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Pending,
    Answered,
    Unanswered,
}

impl Phase {
    fn legacy_capability(self) -> Option<ResponseCapability> {
        match self {
            Self::Answered => None,
            Self::Pending => Some(ResponseCapability::Live),
            Self::Unanswered => Some(ResponseCapability::NotResumable {
                reason: SettleReason::Unknown,
            }),
        }
    }

    fn admits(self, settled_at: Option<&str>, capability: Option<ResponseCapability>) -> bool {
        if self == Self::Pending && settled_at.is_some() {
            return false;
        }
        match (self, capability) {
            (Self::Answered, None) => true,
            (Self::Pending, Some(ResponseCapability::Live)) => true,
            (Self::Pending, Some(ResponseCapability::NotResumable { reason })) => {
                reason == SettleReason::Unknown
            }
            (Self::Unanswered, Some(ResponseCapability::NotResumable { .. })) => true,
            _ => false,
        }
    }

    fn refused(self, capability: Option<ResponseCapability>) -> Option<ResponseCapability> {
        if self != Self::Pending {
            return capability;
        }
        Some(ResponseCapability::NotResumable {
            reason: SettleReason::Unknown,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionInteraction {
    pub id: String,
    pub task_id: String,
    pub provider: String,
    pub questions: Vec<AgentQuestion>,
    pub status: AgentQuestionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<AgentQuestionAnswerItem>>,
    pub created_at: Option<String>,
    pub settled_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_capability: Option<ResponseCapability>,
}

impl QuestionInteraction {
    fn phase(&self) -> Phase {
        match self.status {
            AgentQuestionStatus::Pending => Phase::Pending,
            AgentQuestionStatus::Answered => Phase::Answered,
            AgentQuestionStatus::Cancelled | AgentQuestionStatus::Expired => Phase::Unanswered,
        }
    }

    fn from_legacy(request: AgentQuestionRequest) -> Self {
        let mut item = Self {
            id: request.id,
            task_id: request.task_id,
            provider: request.provider,
            questions: request.questions,
            status: request.status,
            answers: request.answers,
            created_at: None,
            settled_at: None,
            response_capability: None,
        };
        item.response_capability = item.phase().legacy_capability();
        item
    }

    fn answers_match_status(&self) -> bool {
        match (&self.status, &self.answers) {
            (AgentQuestionStatus::Answered, Some(answers)) => {
                rules::answers(&self.questions, answers)
            }
            (AgentQuestionStatus::Answered, None) => false,
            (_, answers) => answers.is_none(),
        }
    }

    pub(super) fn refused(mut self) -> Self {
        self.response_capability = self.phase().refused(self.response_capability);
        self
    }

    fn validate(&self, task: &str) -> Result<(), WireError> {
        if self.task_id != task {
            return Err(WireError::ForeignTask);
        }
        if !rules::identifier(&self.id)
            || !rules::provider(&self.provider)
            || !rules::questions(&self.questions)
            || !self.answers_match_status()
        {
            return Err(WireError::InvalidItem);
        }
        admit_lifecycle(
            self.phase(),
            self.created_at.as_deref(),
            self.settled_at.as_deref(),
            self.response_capability,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalInteraction {
    pub id: String,
    pub task_id: String,
    pub provider: String,
    pub kind: RemoteApprovalKind,
    pub title: String,
    pub detail: String,
    pub detail_truncated: bool,
    pub facts: Vec<AgentApprovalFact>,
    pub decisions: Vec<AgentApprovalDecision>,
    pub status: AgentApprovalStatus,
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<AgentApprovalDecision>,
    pub created_at: Option<String>,
    pub settled_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_capability: Option<ResponseCapability>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyApproval {
    id: String,
    task_id: String,
    provider: String,
    kind: RemoteApprovalKind,
    title: String,
    detail: String,
    detail_truncated: bool,
    facts: Vec<AgentApprovalFact>,
    decisions: Vec<AgentApprovalDecision>,
    status: AgentApprovalStatus,
    expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    decision: Option<AgentApprovalDecision>,
}

impl ApprovalInteraction {
    fn phase(&self) -> Phase {
        match self.status {
            AgentApprovalStatus::Pending => Phase::Pending,
            AgentApprovalStatus::Approved | AgentApprovalStatus::Denied => Phase::Answered,
            AgentApprovalStatus::Cancelled
            | AgentApprovalStatus::Expired
            | AgentApprovalStatus::TimedOut => Phase::Unanswered,
        }
    }

    fn from_legacy(request: LegacyApproval) -> Self {
        let mut item = Self {
            id: request.id,
            task_id: request.task_id,
            provider: request.provider,
            kind: request.kind,
            title: request.title,
            detail: request.detail,
            detail_truncated: request.detail_truncated,
            facts: request.facts,
            decisions: request.decisions,
            status: request.status,
            expires_at: request.expires_at,
            decision: request.decision,
            created_at: None,
            settled_at: None,
            response_capability: None,
        };
        item.response_capability = item.phase().legacy_capability();
        item
    }

    fn decision_matches_status(&self) -> bool {
        match (self.status, self.decision) {
            (AgentApprovalStatus::Denied, Some(AgentApprovalDecision::Deny)) => true,
            (AgentApprovalStatus::Denied, _) => false,
            (AgentApprovalStatus::Approved, Some(AgentApprovalDecision::Deny) | None) => false,
            (AgentApprovalStatus::Approved, Some(decision)) => self.decisions.contains(&decision),
            (_, decision) => decision.is_none(),
        }
    }

    pub(super) fn refused(mut self) -> Self {
        self.response_capability = self.phase().refused(self.response_capability);
        self
    }

    fn validate(&self, task: &str) -> Result<(), WireError> {
        if self.task_id != task {
            return Err(WireError::ForeignTask);
        }
        if uuid(&self.id).is_err()
            || !rules::provider(&self.provider)
            || !rules::approval(&self.title, &self.detail, &self.facts, &self.decisions)
            || !timestamp(&self.expires_at)
            || !self.decision_matches_status()
        {
            return Err(WireError::InvalidItem);
        }
        admit_lifecycle(
            self.phase(),
            self.created_at.as_deref(),
            self.settled_at.as_deref(),
            self.response_capability,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InteractionSnapshot {
    pub task_id: String,
    pub sequence: u64,
    pub questions: Vec<QuestionInteraction>,
    pub questions_truncated: bool,
    pub approvals: Vec<ApprovalInteraction>,
    pub approvals_truncated: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyList<T> {
    items: Vec<T>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyResult<T> {
    request: T,
}

fn bounded(value: &Value, key: &str, max_items: usize) -> Result<(), WireError> {
    let items = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or(WireError::Malformed)?;
    if items.len() > max_items {
        return Err(WireError::TooMany);
    }
    if !within_budget(items, MAX_SECTION_BYTES) {
        return Err(WireError::Oversize);
    }
    Ok(())
}

fn number(digits: &[u8]) -> Option<u32> {
    digits.iter().try_fold(0_u32, |value, digit| {
        digit
            .is_ascii_digit()
            .then(|| value * 10 + u32::from(digit - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    }
}

fn timestamp_fields(value: &str) -> Option<[u32; 7]> {
    let bytes = value.as_bytes();
    let separators = [
        (4, b'-'),
        (7, b'-'),
        (10, b'T'),
        (13, b':'),
        (16, b':'),
        (19, b'.'),
        (23, b'Z'),
    ];
    if bytes.len() != 24
        || separators
            .iter()
            .any(|(index, byte)| bytes[*index] != *byte)
    {
        return None;
    }
    Some([
        number(&bytes[0..4])?,
        number(&bytes[5..7])?,
        number(&bytes[8..10])?,
        number(&bytes[11..13])?,
        number(&bytes[14..16])?,
        number(&bytes[17..19])?,
        number(&bytes[20..23])?,
    ])
}

pub(super) fn timestamp(value: &str) -> bool {
    timestamp_fields(value).is_some_and(|[year, month, day, hour, minute, second, _]| {
        (1..=days_in_month(year, month)).contains(&day) && hour < 24 && minute < 60 && second < 60
    })
}

pub(super) fn epoch_millis(value: &str) -> Option<u64> {
    if !timestamp(value) {
        return None;
    }
    let [year, month, day, hour, minute, second, millis] = timestamp_fields(value)?.map(i64::from);
    let shifted_year = year - i64::from(month <= 2);
    let era = shifted_year.div_euclid(400);
    let year_of_era = shifted_year.rem_euclid(400);
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    let elapsed = ((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis;
    Some(u64::try_from(elapsed).unwrap_or(0))
}

fn admit_lifecycle(
    phase: Phase,
    created_at: Option<&str>,
    settled_at: Option<&str>,
    capability: Option<ResponseCapability>,
) -> Result<(), WireError> {
    if !created_at.is_none_or(timestamp)
        || !settled_at.is_none_or(timestamp)
        || !phase.admits(settled_at, capability)
    {
        return Err(WireError::InvalidItem);
    }
    Ok(())
}

fn admit_questions(questions: &[QuestionInteraction], task: &str) -> Result<(), WireError> {
    let mut seen = HashSet::new();
    for question in questions {
        question.validate(task)?;
        if !seen.insert(question.id.as_str()) {
            return Err(WireError::Duplicate);
        }
    }
    Ok(())
}

fn admit_approvals(approvals: &[ApprovalInteraction], task: &str) -> Result<(), WireError> {
    let mut seen = HashSet::new();
    for approval in approvals {
        approval.validate(task)?;
        if !seen.insert(approval.id.as_str()) {
            return Err(WireError::Duplicate);
        }
    }
    Ok(())
}

fn retain_newest(
    mut approvals: Vec<ApprovalInteraction>,
) -> Result<(Vec<ApprovalInteraction>, bool), WireError> {
    let mut excess = approvals.len().saturating_sub(MAX_APPROVALS);
    let truncated = excess > 0;
    approvals.retain(|approval| {
        if excess == 0 || approval.status == AgentApprovalStatus::Pending {
            return true;
        }
        excess -= 1;
        false
    });
    if approvals.len() > MAX_APPROVALS {
        return Err(WireError::TooMany);
    }
    Ok((approvals, truncated))
}

fn with_question_truncation(mut value: Value) -> Value {
    if let Some(snapshot) = value.as_object_mut() {
        snapshot
            .entry("questionsTruncated")
            .or_insert(Value::Bool(false));
    }
    value
}

pub(super) fn parse_snapshot(value: Value, task: &str) -> Result<InteractionSnapshot, WireError> {
    bounded(&value, "questions", MAX_QUESTIONS)?;
    bounded(&value, "approvals", MAX_APPROVALS)?;
    let snapshot: InteractionSnapshot =
        canonical(with_question_truncation(value)).ok_or(WireError::Malformed)?;
    if uuid(&snapshot.task_id).is_err() || snapshot.sequence > MAX_SAFE_INTEGER {
        return Err(WireError::Malformed);
    }
    if snapshot.task_id != task {
        return Err(WireError::ForeignTask);
    }
    admit_questions(&snapshot.questions, task)?;
    admit_approvals(&snapshot.approvals, task)?;
    Ok(snapshot)
}

pub(super) fn parse_legacy_questions(
    value: Value,
    task: &str,
) -> Result<Vec<QuestionInteraction>, WireError> {
    bounded(&value, "items", MAX_QUESTIONS)?;
    let list: LegacyList<AgentQuestionRequest> = canonical(value).ok_or(WireError::Malformed)?;
    let questions: Vec<_> = list
        .items
        .into_iter()
        .map(QuestionInteraction::from_legacy)
        .collect();
    admit_questions(&questions, task)?;
    Ok(questions)
}

pub(super) fn parse_legacy_approvals(
    value: Value,
    task: &str,
) -> Result<(Vec<ApprovalInteraction>, bool), WireError> {
    bounded(&value, "items", MAX_LEGACY_APPROVALS)?;
    let list: LegacyList<LegacyApproval> = canonical(value).ok_or(WireError::Malformed)?;
    let approvals: Vec<_> = list
        .items
        .into_iter()
        .map(ApprovalInteraction::from_legacy)
        .collect();
    admit_approvals(&approvals, task)?;
    retain_newest(approvals)
}

pub(super) fn parse_question_result(
    value: Value,
    task: &str,
) -> Result<QuestionInteraction, WireError> {
    let result: LegacyResult<AgentQuestionRequest> =
        canonical(value).ok_or(WireError::Malformed)?;
    let question = QuestionInteraction::from_legacy(result.request);
    question.validate(task)?;
    Ok(question)
}

pub(super) fn parse_approval_result(
    value: Value,
    task: &str,
) -> Result<ApprovalInteraction, WireError> {
    let result: LegacyResult<LegacyApproval> = canonical(value).ok_or(WireError::Malformed)?;
    let approval = ApprovalInteraction::from_legacy(result.request);
    approval.validate(task)?;
    Ok(approval)
}

#[cfg(test)]
#[path = "interactions_wire_tests.rs"]
mod tests;
