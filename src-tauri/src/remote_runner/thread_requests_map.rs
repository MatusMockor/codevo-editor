use super::{
    interactions::{InteractionSource, RemoteInteractions},
    interactions_respond::{RemoteRequestItem, RemoteRespondOutcome},
    interactions_wire::{
        epoch_millis, ApprovalInteraction, QuestionInteraction, RemoteApprovalKind,
        ResponseCapability, SettleReason,
    },
};
use crate::agent_questions::{
    approvals::{AgentApprovalKind, AgentApprovalStatus},
    AgentQuestionStatus,
};
use crate::agent_runtime_requests::model::{
    CloseReason, JournalState, RequestBody, RequestError, RequestKind, RequestLifecycle,
    RequestParts, RequestProvider, RequestResolution, RuntimeRequest, ThreadRequests,
    ThreadRequestsParts,
};

pub(super) const SNAPSHOT_EPOCH: &str = "rr1-snapshot";

pub(super) fn epoch(source: InteractionSource, lease_serial: u64, generation: u64) -> String {
    match (source, generation) {
        (InteractionSource::Snapshot, 0) => SNAPSHOT_EPOCH.into(),
        (InteractionSource::Snapshot, _) => format!("rr1-snapshot-{lease_serial}-{generation}"),
        (InteractionSource::Legacy, 0) => format!("rr1-legacy-{lease_serial}"),
        (InteractionSource::Legacy, _) => format!("rr1-legacy-{lease_serial}-{generation}"),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Standing {
    Observed,
    Confirmed,
}

enum Phase {
    Pending,
    Resolved(RequestResolution),
    Cancelled,
    Expired,
    TimedOut,
}

struct Row<'a> {
    id: &'a str,
    provider: &'a str,
    created_at: Option<&'a str>,
    settled_at: Option<&'a str>,
    capability: Option<ResponseCapability>,
    phase: Phase,
    body: RequestBody,
}

fn approval_kind(kind: RemoteApprovalKind) -> AgentApprovalKind {
    match kind {
        RemoteApprovalKind::Command => AgentApprovalKind::Command,
        RemoteApprovalKind::FileChange => AgentApprovalKind::FileChange,
        RemoteApprovalKind::Tool => AgentApprovalKind::Tool,
        RemoteApprovalKind::Plan => AgentApprovalKind::Plan,
    }
}

fn close_reason(reason: SettleReason) -> CloseReason {
    match reason {
        SettleReason::RunnerRestarted => CloseReason::RunnerRestarted,
        SettleReason::RunnerStopped => CloseReason::RunnerStopped,
        SettleReason::TurnEnded => CloseReason::TurnEnded,
        SettleReason::TaskCancelled => CloseReason::TaskCancelled,
        SettleReason::ProviderWithdrew => CloseReason::ProviderCancelled,
        SettleReason::TimedOut => CloseReason::TimedOut,
        SettleReason::Unknown => CloseReason::Unknown,
    }
}

fn question_phase(question: &QuestionInteraction) -> Result<Phase, RequestError> {
    match (&question.status, &question.answers) {
        (AgentQuestionStatus::Pending, _) => Ok(Phase::Pending),
        (AgentQuestionStatus::Answered, Some(answers)) => {
            Ok(Phase::Resolved(RequestResolution::Answers {
                answers: answers.clone(),
            }))
        }
        (AgentQuestionStatus::Answered, None) => Err(RequestError::Resolution),
        (AgentQuestionStatus::Cancelled, _) => Ok(Phase::Cancelled),
        (AgentQuestionStatus::Expired, _) => Ok(Phase::Expired),
    }
}

fn approval_phase(approval: &ApprovalInteraction) -> Result<Phase, RequestError> {
    match (approval.status, approval.decision) {
        (AgentApprovalStatus::Pending, _) => Ok(Phase::Pending),
        (AgentApprovalStatus::Approved | AgentApprovalStatus::Denied, Some(decision)) => {
            Ok(Phase::Resolved(RequestResolution::Decision { decision }))
        }
        (AgentApprovalStatus::Approved | AgentApprovalStatus::Denied, None) => {
            Err(RequestError::Resolution)
        }
        (AgentApprovalStatus::Cancelled, _) => Ok(Phase::Cancelled),
        (AgentApprovalStatus::Expired, _) => Ok(Phase::Expired),
        (AgentApprovalStatus::TimedOut, _) => Ok(Phase::TimedOut),
    }
}

impl<'a> Row<'a> {
    fn question(question: &'a QuestionInteraction) -> Result<Self, RequestError> {
        Ok(Self {
            id: &question.id,
            provider: &question.provider,
            created_at: question.created_at.as_deref(),
            settled_at: question.settled_at.as_deref(),
            capability: question.response_capability,
            phase: question_phase(question)?,
            body: RequestBody::Question {
                questions: question.questions.clone(),
            },
        })
    }

    fn approval(approval: &'a ApprovalInteraction) -> Result<Self, RequestError> {
        Ok(Self {
            id: &approval.id,
            provider: &approval.provider,
            created_at: approval.created_at.as_deref(),
            settled_at: approval.settled_at.as_deref(),
            capability: approval.response_capability,
            phase: approval_phase(approval)?,
            body: RequestBody::Approval {
                approval_kind: approval_kind(approval.kind),
                title: approval.title.clone(),
                detail: approval.detail.clone(),
                detail_truncated: approval.detail_truncated,
                facts: approval.facts.clone(),
                decisions: approval.decisions.clone(),
            },
        })
    }

    fn item(item: &'a RemoteRequestItem) -> Result<Self, RequestError> {
        match item {
            RemoteRequestItem::Question(question) => Self::question(question),
            RemoteRequestItem::Approval(approval) => Self::approval(approval),
        }
    }

    fn key(&self) -> (RequestKind, &str) {
        (self.body.kind(), self.id)
    }

    fn created(&self) -> Result<Option<u64>, RequestError> {
        self.created_at
            .map(|created_at| epoch_millis(created_at).ok_or(RequestError::Integer))
            .transpose()
    }

    fn settled(&self, created: u64) -> Result<u64, RequestError> {
        let Some(settled_at) = self.settled_at else {
            return Ok(created);
        };
        let settled = epoch_millis(settled_at).ok_or(RequestError::Integer)?;
        Ok(settled.max(created))
    }

    fn reason(&self) -> Result<CloseReason, RequestError> {
        match self.capability {
            Some(ResponseCapability::NotResumable { reason }) => Ok(close_reason(reason)),
            _ => Err(RequestError::Capability),
        }
    }

    fn supersedes_live(&self, standing: Standing) -> bool {
        standing == Standing::Confirmed
            || (matches!(self.phase, Phase::Pending)
                && self.capability != Some(ResponseCapability::Live))
    }

    fn lifecycle(&self, created: u64) -> Result<RequestLifecycle, RequestError> {
        let resolved_at_epoch_ms = self.settled(created)?;
        match &self.phase {
            Phase::Pending if self.capability == Some(ResponseCapability::Live) => {
                Ok(RequestLifecycle::Pending)
            }
            Phase::Pending => Ok(RequestLifecycle::Submitting {
                reason: self.reason()?,
                resolution: None,
            }),
            Phase::Resolved(resolution) => Ok(RequestLifecycle::Resolved {
                reason: CloseReason::Unknown,
                resolved_at_epoch_ms,
                resolution: resolution.clone(),
            }),
            Phase::Cancelled => Ok(RequestLifecycle::Cancelled {
                reason: self.reason()?,
                resolved_at_epoch_ms,
            }),
            Phase::Expired => Ok(RequestLifecycle::Expired {
                reason: self.reason()?,
                resolved_at_epoch_ms,
                resolution: None,
            }),
            Phase::TimedOut => Ok(RequestLifecycle::TimedOut {
                reason: self.reason()?,
                resolved_at_epoch_ms,
            }),
        }
    }

    fn request(
        self,
        place: &Place<'_>,
        standing: Standing,
    ) -> Result<RuntimeRequest, RequestError> {
        let created_at_epoch_ms = self.created()?.unwrap_or(place.started_at_epoch_ms);
        let version = place
            .sequence
            .checked_mul(2)
            .and_then(|doubled| doubled.checked_add(1 + u64::from(self.supersedes_live(standing))))
            .ok_or(RequestError::Integer)?;
        let lifecycle = self.lifecycle(created_at_epoch_ms)?;
        RuntimeRequest::new(RequestParts {
            id: self.id.to_string(),
            turn_id: place.task_id.to_string(),
            provider: RequestProvider::parse(self.provider)?,
            created_at_epoch_ms,
            order: place.order,
            version,
            anchor_tool_id: None,
            body: self.body,
            lifecycle,
        })
    }
}

struct Place<'a> {
    task_id: &'a str,
    sequence: u64,
    started_at_epoch_ms: u64,
    order: u64,
}

fn rows(read: &RemoteInteractions) -> Result<Vec<Row<'_>>, RequestError> {
    let mut rows = read
        .questions
        .iter()
        .map(Row::question)
        .chain(read.approvals.iter().map(Row::approval))
        .map(|row| {
            let row = row?;
            let created = row.created()?;
            Ok((created, row))
        })
        .collect::<Result<Vec<_>, RequestError>>()?;
    rows.sort_by_key(|(created, _)| *created);
    Ok(rows.into_iter().map(|(_, row)| row).collect())
}

pub(super) fn holds_open_request(read: &RemoteInteractions) -> bool {
    read.questions
        .iter()
        .any(|question| question.status == AgentQuestionStatus::Pending)
        || read
            .approvals
            .iter()
            .any(|approval| approval.status == AgentApprovalStatus::Pending)
}

pub(super) fn is_truncated(read: &RemoteInteractions) -> bool {
    read.questions_truncated || read.approvals_truncated
}

pub(super) fn requests(
    read: &RemoteInteractions,
    started_at_epoch_ms: u64,
) -> Result<Vec<RuntimeRequest>, RequestError> {
    rows(read)?
        .into_iter()
        .zip(0_u64..)
        .map(|(row, order)| {
            let place = Place {
                task_id: &read.task_id,
                sequence: read.sequence,
                started_at_epoch_ms,
                order,
            };
            row.request(&place, Standing::Observed)
        })
        .collect()
}

pub(super) fn responded(
    read: &RemoteInteractions,
    outcome: &RemoteRespondOutcome,
    delivered: bool,
    started_at_epoch_ms: u64,
) -> Result<RuntimeRequest, RequestError> {
    let (item, standing) = match outcome {
        RemoteRespondOutcome::Answered { request } if delivered => (request, Standing::Confirmed),
        RemoteRespondOutcome::Answered { request }
        | RemoteRespondOutcome::NotAnswerable { request } => (request, Standing::Observed),
    };
    let row = Row::item(item)?;
    let order = rows(read)?
        .iter()
        .zip(0_u64..)
        .find(|(candidate, _)| candidate.key() == row.key())
        .map(|(_, order)| order)
        .ok_or(RequestError::Identifier)?;
    let place = Place {
        task_id: &read.task_id,
        sequence: read.sequence,
        started_at_epoch_ms,
        order,
    };
    row.request(&place, standing)
}

pub(super) struct MessageScope<'a> {
    pub(super) server_id: &'a str,
    pub(super) thread_id: &'a str,
    pub(super) epoch: String,
}

pub(super) fn message(
    scope: MessageScope<'_>,
    requests: Vec<RuntimeRequest>,
    truncated: bool,
) -> Result<ThreadRequests, RequestError> {
    ThreadRequests::new(ThreadRequestsParts {
        workspace_id: Some(scope.server_id.to_string()),
        thread_id: scope.thread_id.to_string(),
        epoch: scope.epoch,
        journal: JournalState::Saved,
        requests,
        truncated,
        unreadable: 0,
        reset: false,
    })
}

#[cfg(test)]
#[path = "thread_requests_map_tests.rs"]
mod tests;
