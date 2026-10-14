use super::model::{
    CloseReason, RequestBody, RequestError, RequestKind, RequestProvider, RequestResolution,
    RequestStatus,
};
use crate::agent_questions::approvals::{AgentApprovalRequest, AgentApprovalStatus};
use crate::agent_questions::interactions::AgentInteractionSnapshot;
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionStatus};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClosedStatus {
    Cancelled,
    Expired,
    TimedOut,
}

impl ClosedStatus {
    pub fn status(self) -> RequestStatus {
        match self {
            Self::Cancelled => RequestStatus::Cancelled,
            Self::Expired => RequestStatus::Expired,
            Self::TimedOut => RequestStatus::TimedOut,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ObservedState {
    Pending,
    Resolved(RequestResolution),
    Closed {
        status: ClosedStatus,
        reason: CloseReason,
    },
}

impl ObservedState {
    fn closed(status: ClosedStatus, reason: CloseReason) -> Self {
        Self::Closed { status, reason }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedRequest {
    pub id: String,
    pub provider: RequestProvider,
    pub body: RequestBody,
    pub state: ObservedState,
}

impl ObservedRequest {
    fn validated(self) -> Result<Self, RequestError> {
        self.body.validate(&self.id, self.provider)?;
        if let ObservedState::Resolved(resolution) = &self.state {
            resolution.validate_for(&self.id, self.provider, &self.body)?;
        }
        Ok(self)
    }
}

pub fn observe_question(request: AgentQuestionRequest) -> Result<ObservedRequest, RequestError> {
    let state = match (request.status, request.answers) {
        (AgentQuestionStatus::Pending, None) => ObservedState::Pending,
        (AgentQuestionStatus::Answered, Some(answers)) => {
            ObservedState::Resolved(RequestResolution::Answers { answers })
        }
        (AgentQuestionStatus::Cancelled, None) => {
            ObservedState::closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled)
        }
        (AgentQuestionStatus::Expired, None) => {
            ObservedState::closed(ClosedStatus::Expired, CloseReason::TurnEnded)
        }
        _ => return Err(RequestError::Lifecycle),
    };
    ObservedRequest {
        provider: RequestProvider::parse(&request.provider)?,
        id: request.id,
        body: RequestBody::Question {
            questions: request.questions,
        },
        state,
    }
    .validated()
}

pub fn observe_approval(request: AgentApprovalRequest) -> Result<ObservedRequest, RequestError> {
    let state = match (request.status, request.decision) {
        (AgentApprovalStatus::Pending, None) => ObservedState::Pending,
        (AgentApprovalStatus::Approved | AgentApprovalStatus::Denied, Some(decision)) => {
            ObservedState::Resolved(RequestResolution::Decision { decision })
        }
        (AgentApprovalStatus::Cancelled, None) => {
            ObservedState::closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled)
        }
        (AgentApprovalStatus::Expired, None) => {
            ObservedState::closed(ClosedStatus::Expired, CloseReason::TurnEnded)
        }
        (AgentApprovalStatus::TimedOut, None) => {
            ObservedState::closed(ClosedStatus::TimedOut, CloseReason::TimedOut)
        }
        _ => return Err(RequestError::Lifecycle),
    };
    ObservedRequest {
        provider: RequestProvider::parse(&request.provider)?,
        id: request.id,
        body: RequestBody::Approval {
            approval_kind: request.kind,
            title: request.title,
            detail: request.detail,
            detail_truncated: request.detail_truncated,
            facts: request.facts,
            decisions: request.decisions,
        },
        state,
    }
    .validated()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DigestedState {
    Pending,
    Resolved,
    Closed {
        status: ClosedStatus,
        reason: CloseReason,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DigestedRequest {
    pub id: String,
    pub kind: RequestKind,
    pub state: DigestedState,
}

impl ObservedRequest {
    fn digested(self) -> DigestedRequest {
        DigestedRequest {
            kind: self.body.kind(),
            id: self.id,
            state: match self.state {
                ObservedState::Pending => DigestedState::Pending,
                ObservedState::Resolved(_) => DigestedState::Resolved,
                ObservedState::Closed { status, reason } => {
                    DigestedState::Closed { status, reason }
                }
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedTurn {
    pub sequence: u64,
    pub requests: Vec<ObservedRequest>,
    pub digested: Vec<DigestedRequest>,
    pub rejected: Vec<String>,
}

impl ObservedTurn {
    pub fn into_digest(self) -> Self {
        let mut digested = self.digested;
        digested.extend(self.requests.into_iter().map(ObservedRequest::digested));
        Self {
            sequence: self.sequence,
            requests: Vec::new(),
            digested,
            rejected: self.rejected,
        }
    }

    pub fn digest_bytes(&self) -> usize {
        let digested: usize = self.digested.iter().map(|request| request.id.len()).sum();
        let rejected: usize = self.rejected.iter().map(String::len).sum();
        digested + rejected
    }
}

pub fn observe_snapshot(snapshot: AgentInteractionSnapshot) -> ObservedTurn {
    let questions = snapshot
        .questions
        .into_iter()
        .map(|request| (request.id.clone(), observe_question(request)));
    let approvals = snapshot
        .approvals
        .into_iter()
        .map(|request| (request.id.clone(), observe_approval(request)));
    let mut turn = ObservedTurn {
        sequence: snapshot.sequence,
        requests: Vec::new(),
        digested: Vec::new(),
        rejected: Vec::new(),
    };
    for (id, request) in questions.chain(approvals) {
        match request {
            Ok(request) => turn.requests.push(request),
            Err(_) => turn.rejected.push(id),
        }
    }
    turn
}

pub fn retained_bytes(snapshot: &AgentInteractionSnapshot) -> usize {
    let questions = snapshot.questions.iter().map(|request| {
        let asked: usize = request
            .questions
            .iter()
            .map(|question| {
                let options: usize = question
                    .options
                    .iter()
                    .map(|option| option.id.len() + option.label.len() + option.description.len())
                    .sum();
                question.id.len() + question.header.len() + question.prompt.len() + options
            })
            .sum();
        let answered: usize = request
            .answers
            .iter()
            .flatten()
            .map(|answer| {
                let options: usize = answer.option_ids.iter().map(String::len).sum();
                answer.question_id.len() + answer.text.len() + options
            })
            .sum();
        request.id.len() + request.provider.len() + asked + answered
    });
    let approvals = snapshot.approvals.iter().map(|request| {
        let facts: usize = request
            .facts
            .iter()
            .map(|fact| fact.label.len() + fact.value.len())
            .sum();
        request.id.len()
            + request.provider.len()
            + request.title.len()
            + request.detail.len()
            + facts
    });
    snapshot.task_id.len()
        + snapshot.workspace_id.len()
        + questions.sum::<usize>()
        + approvals.sum::<usize>()
}
