use super::{
    interactions::{
        CallError, Exchange, InteractionError, InteractionRunnerPort, RemoteInteractions,
    },
    interactions_rules::{self as rules, within_budget, MAX_REQUEST_QUESTIONS},
    interactions_wire::{
        parse_approval_result, parse_question_result, ApprovalInteraction, QuestionInteraction,
        ResponseCapability,
    },
    types::uuid,
};
use crate::agent_questions::{
    approvals::{AgentApprovalDecision, AgentApprovalStatus},
    AgentQuestionAnswerItem, AgentQuestionStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;

const MAX_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RemoteRequestResponse {
    Question {
        answers: Vec<AgentQuestionAnswerItem>,
    },
    Approval {
        decision: AgentApprovalDecision,
    },
}

impl RemoteRequestResponse {
    fn bounded(&self) -> bool {
        match self {
            Self::Approval { .. } => true,
            Self::Question { answers } => {
                answers.len() <= MAX_REQUEST_QUESTIONS
                    && answers.iter().all(rules::bounded_answer)
                    && within_budget(self, MAX_RESPONSE_BYTES)
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum RemoteRequestItem {
    Question(QuestionInteraction),
    Approval(ApprovalInteraction),
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteRespondOutcome {
    Answered { request: RemoteRequestItem },
    NotAnswerable { request: RemoteRequestItem },
}

fn same_approval(left: &ApprovalInteraction, right: &ApprovalInteraction) -> bool {
    left.id == right.id
        && left.provider == right.provider
        && left.kind == right.kind
        && left.title == right.title
        && left.detail == right.detail
        && left.detail_truncated == right.detail_truncated
        && left.facts == right.facts
        && left.decisions == right.decisions
        && left.expires_at == right.expires_at
}

fn confirmed_question(
    asked: &QuestionInteraction,
    answers: &[AgentQuestionAnswerItem],
    value: Value,
    task: &str,
) -> Result<QuestionInteraction, InteractionError> {
    let answered = parse_question_result(value, task)?;
    if answered.id != asked.id
        || answered.provider != asked.provider
        || answered.questions != asked.questions
        || answered.status != AgentQuestionStatus::Answered
        || answered.answers.as_deref() != Some(answers)
    {
        return Err(InteractionError::Unconfirmed);
    }
    Ok(QuestionInteraction {
        created_at: asked.created_at.clone(),
        ..answered
    })
}

fn confirmed_approval(
    asked: &ApprovalInteraction,
    decision: AgentApprovalDecision,
    value: Value,
    task: &str,
) -> Result<ApprovalInteraction, InteractionError> {
    let decided = parse_approval_result(value, task)?;
    if !same_approval(asked, &decided) || decided.decision != Some(decision) {
        return Err(InteractionError::Unconfirmed);
    }
    Ok(ApprovalInteraction {
        created_at: asked.created_at.clone(),
        ..decided
    })
}

impl RemoteRequestItem {
    fn find(
        current: &RemoteInteractions,
        request_id: &str,
        response: &RemoteRequestResponse,
    ) -> Result<Self, InteractionError> {
        let item = match response {
            RemoteRequestResponse::Question { .. } => current
                .questions
                .iter()
                .find(|question| question.id == request_id)
                .cloned()
                .map(Self::Question),
            RemoteRequestResponse::Approval { .. } => current
                .approvals
                .iter()
                .find(|approval| approval.id == request_id)
                .cloned()
                .map(Self::Approval),
        };
        item.ok_or(InteractionError::RequestGone)
    }

    fn settled_answer(&self, response: &RemoteRequestResponse) -> Option<bool> {
        match (self, response) {
            (Self::Question(question), RemoteRequestResponse::Question { answers })
                if question.status == AgentQuestionStatus::Answered =>
            {
                Some(question.answers.as_deref() == Some(answers.as_slice()))
            }
            (Self::Approval(approval), RemoteRequestResponse::Approval { decision })
                if matches!(
                    approval.status,
                    AgentApprovalStatus::Approved | AgentApprovalStatus::Denied
                ) =>
            {
                Some(approval.decision == Some(*decision))
            }
            _ => None,
        }
    }

    fn capability(&self) -> Option<ResponseCapability> {
        match self {
            Self::Question(question) => question.response_capability,
            Self::Approval(approval) => approval.response_capability,
        }
    }

    fn refused(self) -> Self {
        match self {
            Self::Question(question) => Self::Question(question.refused()),
            Self::Approval(approval) => Self::Approval(approval.refused()),
        }
    }

    fn route(&self) -> String {
        match self {
            Self::Question(question) => format!("questions/{}/answer", question.id),
            Self::Approval(approval) => format!("approvals/{}/answer", approval.id),
        }
    }

    fn body(&self, response: &RemoteRequestResponse) -> Result<Value, InteractionError> {
        match (self, response) {
            (Self::Question(question), RemoteRequestResponse::Question { answers })
                if rules::answers(&question.questions, answers) =>
            {
                Ok(json!({ "answers": answers }))
            }
            (Self::Approval(approval), RemoteRequestResponse::Approval { decision })
                if approval.decisions.contains(decision) =>
            {
                Ok(json!({ "decision": decision }))
            }
            _ => Err(InteractionError::InvalidRequest),
        }
    }

    fn confirmed(
        &self,
        response: &RemoteRequestResponse,
        value: Value,
        task: &str,
    ) -> Result<Self, InteractionError> {
        match (self, response) {
            (Self::Question(question), RemoteRequestResponse::Question { answers }) => {
                confirmed_question(question, answers, value, task).map(Self::Question)
            }
            (Self::Approval(approval), RemoteRequestResponse::Approval { decision }) => {
                confirmed_approval(approval, *decision, value, task).map(Self::Approval)
            }
            _ => Err(InteractionError::InvalidRequest),
        }
    }
}

fn admit_response(
    request_id: &str,
    response: &RemoteRequestResponse,
) -> Result<(), InteractionError> {
    if uuid(request_id).is_err() || !response.bounded() {
        return Err(InteractionError::InvalidRequest);
    }
    Ok(())
}

pub(super) struct Responded {
    pub(super) outcome: RemoteRespondOutcome,
    pub(super) read: RemoteInteractions,
    pub(super) delivered: bool,
}

impl Responded {
    fn observed(outcome: RemoteRespondOutcome, read: RemoteInteractions) -> Self {
        Self {
            outcome,
            read,
            delivered: false,
        }
    }
}

fn refused<P: InteractionRunnerPort>(
    exchange: &Exchange<'_, P>,
    request_id: &str,
    response: &RemoteRequestResponse,
) -> Result<Responded, InteractionError> {
    let read = exchange.read()?;
    let request = RemoteRequestItem::find(&read, request_id, response)?.refused();
    Ok(Responded::observed(
        RemoteRespondOutcome::NotAnswerable { request },
        read,
    ))
}

fn respond<P: InteractionRunnerPort>(
    exchange: &Exchange<'_, P>,
    request_id: &str,
    response: &RemoteRequestResponse,
) -> Result<Responded, InteractionError> {
    admit_response(request_id, response)?;
    let read = exchange.read()?;
    let item = RemoteRequestItem::find(&read, request_id, response)?;
    let body = item.body(response)?;
    if item.settled_answer(response) == Some(true) {
        return Ok(Responded::observed(
            RemoteRespondOutcome::Answered { request: item },
            read,
        ));
    }
    if item.settled_answer(response) == Some(false)
        || matches!(
            item.capability(),
            Some(ResponseCapability::NotResumable { .. })
        )
    {
        return Ok(Responded::observed(
            RemoteRespondOutcome::NotAnswerable { request: item },
            read,
        ));
    }
    match exchange.post(&item.route(), body) {
        Ok(value) => Ok(Responded {
            outcome: RemoteRespondOutcome::Answered {
                request: item.confirmed(response, value, exchange.task())?,
            },
            read,
            delivered: true,
        }),
        Err(CallError::Conflict) => refused(exchange, request_id, response),
        Err(CallError::NotFound) => Err(InteractionError::RequestGone),
        Err(error) => Err(error.into()),
    }
}

pub(super) struct Delivery {
    responded: Result<Responded, InteractionError>,
    posted: bool,
}

impl Delivery {
    pub(super) fn posted(&self) -> bool {
        self.posted
    }

    pub(super) fn settle_responded<P: InteractionRunnerPort>(
        self,
        port: &P,
    ) -> Result<Responded, InteractionError> {
        if port.is_current() {
            return self.responded;
        }
        if self.posted {
            return Err(InteractionError::DeliveryUncertain);
        }
        Err(InteractionError::Superseded)
    }

    pub(super) fn settle<P: InteractionRunnerPort>(
        self,
        port: &P,
    ) -> Result<RemoteRespondOutcome, InteractionError> {
        self.settle_responded(port)
            .map(|responded| responded.outcome)
    }
}

pub(super) fn deliver<P: InteractionRunnerPort>(
    port: &P,
    runner: &str,
    task: &str,
    request_id: &str,
    response: &RemoteRequestResponse,
    now: Instant,
) -> Delivery {
    deliver_until(port, runner, task, (request_id, response), now, None)
}

pub(super) fn deliver_until<P: InteractionRunnerPort>(
    port: &P,
    runner: &str,
    task: &str,
    (request_id, response): (&str, &RemoteRequestResponse),
    now: Instant,
    deadline: Option<Instant>,
) -> Delivery {
    match Exchange::open(port, runner, task, now).map(|exchange| exchange.until(deadline)) {
        Ok(exchange) => Delivery {
            responded: respond(&exchange, request_id, response),
            posted: exchange.posted(),
        },
        Err(error) => Delivery {
            responded: Err(error),
            posted: false,
        },
    }
}
