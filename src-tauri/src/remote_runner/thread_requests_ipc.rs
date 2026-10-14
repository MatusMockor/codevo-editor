use super::{
    interactions_respond::RemoteRequestResponse,
    types::{id, uuid},
};
use crate::agent_questions::{
    is_blank, AgentQuestionAnswerItem, MAX_AGENT_QUESTIONS_PER_REQUEST,
    MAX_AGENT_QUESTION_ANSWER_TEXT_BYTES, MAX_AGENT_QUESTION_OPTIONS,
};
use crate::agent_runtime_requests::model::{is_identifier, ThreadRequests, MAX_SAFE_INTEGER};
use serde::{Deserialize, Deserializer, Serialize};
use std::{collections::HashSet, fmt};

pub(super) const MAX_TURNS: usize = 32;
pub(super) const MAX_CURSOR_CHARS: usize = 256;
pub(super) const MAX_RUNNER_ID_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum IpcError {
    Server,
    Runner,
    Thread,
    Turn,
    Turns,
    Cursor,
    Request,
    Response,
}

impl fmt::Display for IpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            Self::Server => "server",
            Self::Runner => "runner",
            Self::Thread => "thread",
            Self::Turn => "turn",
            Self::Turns => "turn list",
            Self::Cursor => "cursor",
            Self::Request => "request id",
            Self::Response => "response",
        };
        write!(formatter, "Invalid remote thread request {detail}.")
    }
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub(super) fn is_cursor(value: &str) -> bool {
    (1..=MAX_CURSOR_CHARS).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

fn admit_connection(server_id: &str, runner_id: &str, thread_id: &str) -> Result<(), IpcError> {
    if id(server_id).is_err() {
        return Err(IpcError::Server);
    }
    if runner_id.is_empty()
        || runner_id.len() > MAX_RUNNER_ID_BYTES
        || runner_id.chars().any(char::is_control)
    {
        return Err(IpcError::Runner);
    }
    if uuid(thread_id).is_err() {
        return Err(IpcError::Thread);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TurnWire {
    turn_id: String,
    started_at_epoch_ms: u64,
    #[serde(deserialize_with = "required_nullable")]
    interaction_sequence: Option<u64>,
    terminal: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "TurnWire")]
pub struct TurnDescriptor {
    pub(super) turn_id: String,
    pub(super) started_at_epoch_ms: u64,
    pub(super) interaction_sequence: Option<u64>,
    pub(super) terminal: bool,
}

impl TryFrom<TurnWire> for TurnDescriptor {
    type Error = IpcError;

    fn try_from(wire: TurnWire) -> Result<Self, Self::Error> {
        if uuid(&wire.turn_id).is_err()
            || wire.started_at_epoch_ms > MAX_SAFE_INTEGER
            || wire
                .interaction_sequence
                .is_some_and(|sequence| sequence > MAX_SAFE_INTEGER)
        {
            return Err(IpcError::Turn);
        }
        Ok(Self {
            turn_id: wire.turn_id,
            started_at_epoch_ms: wire.started_at_epoch_ms,
            interaction_sequence: wire.interaction_sequence,
            terminal: wire.terminal,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryWire {
    server_id: String,
    runner_id: String,
    thread_id: String,
    turns: Vec<TurnDescriptor>,
    #[serde(deserialize_with = "required_nullable")]
    cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "QueryWire")]
pub struct ThreadRequestsQuery {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) thread_id: String,
    pub(super) turns: Vec<TurnDescriptor>,
    pub(super) cursor: Option<String>,
}

impl TryFrom<QueryWire> for ThreadRequestsQuery {
    type Error = IpcError;

    fn try_from(wire: QueryWire) -> Result<Self, Self::Error> {
        admit_connection(&wire.server_id, &wire.runner_id, &wire.thread_id)?;
        let mut distinct = HashSet::new();
        if wire.turns.len() > MAX_TURNS
            || !wire
                .turns
                .iter()
                .all(|turn| distinct.insert(turn.turn_id.as_str()))
        {
            return Err(IpcError::Turns);
        }
        if wire
            .cursor
            .as_deref()
            .is_some_and(|cursor| !is_cursor(cursor))
        {
            return Err(IpcError::Cursor);
        }
        Ok(Self {
            server_id: wire.server_id,
            runner_id: wire.runner_id,
            thread_id: wire.thread_id,
            turns: wire.turns,
            cursor: wire.cursor,
        })
    }
}

fn admit_answer(answer: &AgentQuestionAnswerItem) -> bool {
    let mut options = HashSet::new();
    is_identifier(&answer.question_id)
        && answer.option_ids.len() <= MAX_AGENT_QUESTION_OPTIONS
        && answer
            .option_ids
            .iter()
            .all(|option| is_identifier(option) && options.insert(option.as_str()))
        && answer.text.len() <= MAX_AGENT_QUESTION_ANSWER_TEXT_BYTES
        && (!answer.option_ids.is_empty() || !is_blank(&answer.text))
}

fn admit_response(response: &RemoteRequestResponse) -> bool {
    let RemoteRequestResponse::Question { answers } = response else {
        return true;
    };
    let mut questions = HashSet::new();
    (1..=MAX_AGENT_QUESTIONS_PER_REQUEST).contains(&answers.len())
        && answers
            .iter()
            .all(|answer| admit_answer(answer) && questions.insert(answer.question_id.as_str()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RespondWire {
    server_id: String,
    runner_id: String,
    thread_id: String,
    turn: TurnDescriptor,
    request_id: String,
    response: RemoteRequestResponse,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "RespondWire")]
pub struct ThreadRespondRequest {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) thread_id: String,
    pub(super) turn: TurnDescriptor,
    pub(super) request_id: String,
    pub(super) response: RemoteRequestResponse,
}

impl TryFrom<RespondWire> for ThreadRespondRequest {
    type Error = IpcError;

    fn try_from(wire: RespondWire) -> Result<Self, Self::Error> {
        admit_connection(&wire.server_id, &wire.runner_id, &wire.thread_id)?;
        if uuid(&wire.request_id).is_err() {
            return Err(IpcError::Request);
        }
        if !admit_response(&wire.response) {
            return Err(IpcError::Response);
        }
        Ok(Self {
            server_id: wire.server_id,
            runner_id: wire.runner_id,
            thread_id: wire.thread_id,
            turn: wire.turn,
            request_id: wire.request_id,
            response: wire.response,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRequestsPage {
    pub(super) message: ThreadRequests,
    pub(super) next_cursor: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ThreadRespondOutcome {
    Answered,
    NotAnswerable,
    DeliveryUncertain,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRespondResult {
    outcome: ThreadRespondOutcome,
    message: Option<ThreadRequests>,
}

impl ThreadRespondResult {
    pub(super) fn answered(message: Option<ThreadRequests>) -> Self {
        Self {
            outcome: ThreadRespondOutcome::Answered,
            message,
        }
    }

    pub(super) fn not_answerable(message: Option<ThreadRequests>) -> Self {
        Self {
            outcome: ThreadRespondOutcome::NotAnswerable,
            message,
        }
    }

    pub(super) fn delivery_uncertain() -> Self {
        Self {
            outcome: ThreadRespondOutcome::DeliveryUncertain,
            message: None,
        }
    }

    #[cfg(test)]
    pub(super) fn outcome(&self) -> ThreadRespondOutcome {
        self.outcome
    }

    #[cfg(test)]
    pub(super) fn message(&self) -> Option<&ThreadRequests> {
        self.message.as_ref()
    }
}

#[cfg(test)]
#[path = "thread_requests_ipc_tests.rs"]
mod tests;
