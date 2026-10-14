use super::{
    commands::{blocking, OperationClass},
    interactions_ledger::{ContentDigest, InteractionLedger},
    interactions_respond::{deliver, RemoteRequestResponse, RemoteRespondOutcome},
    interactions_wire::{
        parse_legacy_approvals, parse_legacy_questions, parse_snapshot, ApprovalInteraction,
        InteractionSnapshot, QuestionInteraction, WireError,
    },
    project_management::call_lease,
    service::{ConnectionLease, RemoteRunnerState},
    types::{id, uuid},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{cell::Cell, time::Instant};

const NOT_FOUND: &str = "Runner request failed (HTTP 404).";
const CONFLICT: &str = "Runner request failed (HTTP 409).";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum InteractionError {
    InvalidRequest,
    RunnerChanged,
    Superseded,
    DeliveryUncertain,
    TaskNotFound,
    RequestGone,
    Unconfirmed,
    Wire(WireError),
    Transport(String),
}

impl InteractionError {
    pub(super) fn message(&self) -> &str {
        match self {
            Self::InvalidRequest => "Invalid runner interaction request",
            Self::RunnerChanged => {
                "Runner identity changed. Reconnect the server before continuing."
            }
            Self::Superseded => "Server connection changed during request",
            Self::DeliveryUncertain => {
                "Server connection changed while the response was being sent. It may or may not have been delivered."
            }
            Self::TaskNotFound => "Runner task requests are not available",
            Self::RequestGone => "Runner request is no longer available",
            Self::Unconfirmed => "Runner did not confirm this response",
            Self::Wire(error) => error.message(),
            Self::Transport(error) => error,
        }
    }
}

impl From<InteractionError> for String {
    fn from(error: InteractionError) -> Self {
        error.message().into()
    }
}

impl From<WireError> for InteractionError {
    fn from(error: WireError) -> Self {
        Self::Wire(error)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum CallError {
    NotFound,
    Conflict,
    Fatal(InteractionError),
}

impl CallError {
    fn from_transport(error: String) -> Self {
        match error.as_str() {
            NOT_FOUND => Self::NotFound,
            CONFLICT => Self::Conflict,
            _ => Self::Fatal(InteractionError::Transport(error)),
        }
    }
}

impl From<InteractionError> for CallError {
    fn from(error: InteractionError) -> Self {
        Self::Fatal(error)
    }
}

impl From<CallError> for InteractionError {
    fn from(error: CallError) -> Self {
        match error {
            CallError::NotFound => Self::TaskNotFound,
            CallError::Conflict => Self::Transport(CONFLICT.into()),
            CallError::Fatal(error) => error,
        }
    }
}

pub(super) trait InteractionRunnerPort {
    fn runner_id(&self) -> &str;
    fn is_current(&self) -> bool;
    fn ledger(&self) -> &InteractionLedger;
    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String>;
}

impl InteractionRunnerPort for ConnectionLease {
    fn runner_id(&self) -> &str {
        ConnectionLease::runner_id(self)
    }

    fn is_current(&self) -> bool {
        ConnectionLease::is_current(self)
    }

    fn ledger(&self) -> &InteractionLedger {
        self.interaction_ledger()
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String> {
        call_lease(self.clone(), method, path, body)
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InteractionSource {
    Snapshot,
    Legacy,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInteractions {
    pub task_id: String,
    pub sequence: u64,
    pub questions: Vec<QuestionInteraction>,
    pub questions_truncated: bool,
    pub approvals: Vec<ApprovalInteraction>,
    pub approvals_truncated: bool,
    pub source: InteractionSource,
}

type LegacyApprovalList = (Vec<ApprovalInteraction>, bool);

fn digest(content: &impl Serialize) -> Result<ContentDigest, InteractionError> {
    let mut hasher = Sha256::new();
    serde_json::to_writer(&mut hasher, content).map_err(|_| WireError::Malformed)?;
    Ok(hasher.finalize().into())
}

impl RemoteInteractions {
    fn snapshot(snapshot: InteractionSnapshot) -> Self {
        Self {
            task_id: snapshot.task_id,
            sequence: snapshot.sequence,
            questions: snapshot.questions,
            questions_truncated: snapshot.questions_truncated,
            approvals: snapshot.approvals,
            approvals_truncated: snapshot.approvals_truncated,
            source: InteractionSource::Snapshot,
        }
    }

    fn legacy(
        task: &str,
        questions: Vec<QuestionInteraction>,
        (approvals, approvals_truncated): LegacyApprovalList,
        ledger: &InteractionLedger,
    ) -> Result<Self, InteractionError> {
        let digest = digest(&(&questions, &approvals, approvals_truncated))?;
        Ok(Self {
            task_id: task.into(),
            sequence: ledger.stamp(task, digest),
            questions,
            questions_truncated: false,
            approvals,
            approvals_truncated,
            source: InteractionSource::Legacy,
        })
    }
}

pub(super) struct Exchange<'a, P> {
    port: &'a P,
    runner: &'a str,
    task: &'a str,
    now: Instant,
    posted: Cell<bool>,
}

impl<'a, P: InteractionRunnerPort> Exchange<'a, P> {
    pub(super) fn open(
        port: &'a P,
        runner: &'a str,
        task: &'a str,
        now: Instant,
    ) -> Result<Self, InteractionError> {
        uuid(task).map_err(|_| InteractionError::InvalidRequest)?;
        let exchange = Self {
            port,
            runner,
            task,
            now,
            posted: Cell::new(false),
        };
        exchange.admit()?;
        Ok(exchange)
    }

    pub(super) fn task(&self) -> &str {
        self.task
    }

    pub(super) fn posted(&self) -> bool {
        self.posted.get()
    }

    fn admit(&self) -> Result<(), InteractionError> {
        if self.port.runner_id() != self.runner {
            return Err(InteractionError::RunnerChanged);
        }
        if !self.port.is_current() {
            return Err(InteractionError::Superseded);
        }
        Ok(())
    }

    fn path(&self, route: &str) -> String {
        format!("/v1/tasks/{}/{route}", self.task)
    }

    fn get(&self, route: &str) -> Result<Value, CallError> {
        self.admit()?;
        let outcome = self.port.call("GET", &self.path(route), None);
        self.admit()?;
        outcome.map_err(CallError::from_transport)
    }

    pub(super) fn post(&self, route: &str, body: Value) -> Result<Value, CallError> {
        self.admit()?;
        self.posted.set(true);
        let outcome = self.port.call("POST", &self.path(route), Some(body));
        self.admit()
            .map_err(|_| InteractionError::DeliveryUncertain)?;
        outcome.map_err(CallError::from_transport)
    }

    fn snapshot(&self) -> Result<Option<RemoteInteractions>, InteractionError> {
        match self.get("interactions") {
            Ok(value) => Ok(Some(RemoteInteractions::snapshot(parse_snapshot(
                value, self.task,
            )?))),
            Err(CallError::NotFound) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn legacy_approvals(&self) -> Result<LegacyApprovalList, InteractionError> {
        match self.get("approvals") {
            Ok(value) => Ok(parse_legacy_approvals(value, self.task)?),
            Err(CallError::NotFound) => Ok(LegacyApprovalList::default()),
            Err(error) => Err(error.into()),
        }
    }

    fn confirm_legacy_runner(&self) -> Result<Option<RemoteInteractions>, InteractionError> {
        if let Some(snapshot) = self.snapshot()? {
            return Ok(Some(snapshot));
        }
        self.admit()?;
        self.port.ledger().remember_legacy_runner(self.now);
        Ok(None)
    }

    pub(super) fn read(&self) -> Result<RemoteInteractions, InteractionError> {
        let ledger = self.port.ledger();
        let legacy = ledger.is_legacy_runner(self.now);
        if !legacy {
            if let Some(snapshot) = self.snapshot()? {
                return Ok(snapshot);
            }
        }
        let questions = parse_legacy_questions(self.get("questions")?, self.task)?;
        let approvals = self.legacy_approvals()?;
        if !legacy {
            if let Some(snapshot) = self.confirm_legacy_runner()? {
                return Ok(snapshot);
            }
        }
        self.admit()?;
        RemoteInteractions::legacy(self.task, questions, approvals, ledger)
    }
}

pub(super) fn read_under<P: InteractionRunnerPort>(
    port: &P,
    runner: &str,
    task: &str,
    now: Instant,
) -> Result<RemoteInteractions, InteractionError> {
    Exchange::open(port, runner, task, now)?.read()
}

pub(super) fn settle_read<P: InteractionRunnerPort>(
    port: &P,
    result: Result<RemoteInteractions, InteractionError>,
) -> Result<RemoteInteractions, InteractionError> {
    if !port.is_current() {
        return Err(InteractionError::Superseded);
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteInteractionsRequest {
    server_id: String,
    runner_id: String,
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteRespondRequest {
    server_id: String,
    runner_id: String,
    task_id: String,
    request_id: String,
    response: RemoteRequestResponse,
}

fn admit_connection(
    state: &RemoteRunnerState,
    server: &str,
    runner: &str,
) -> Result<ConnectionLease, InteractionError> {
    id(server).map_err(|_| InteractionError::InvalidRequest)?;
    if runner.is_empty() || runner.len() > 128 || runner.chars().any(char::is_control) {
        return Err(InteractionError::InvalidRequest);
    }
    let lease = state
        .connection_lease(server)
        .map_err(InteractionError::Transport)?;
    if lease.runner_id() != runner {
        return Err(InteractionError::RunnerChanged);
    }
    Ok(lease)
}

#[tauri::command]
pub async fn get_remote_agent_interactions(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RemoteInteractionsRequest,
) -> Result<RemoteInteractions, String> {
    let lease = admit_connection(state.inner(), &request.server_id, &request.runner_id)?;
    let worker = lease.clone();
    let result = blocking(OperationClass::Bulk, move || {
        Ok(read_under(
            &worker,
            &request.runner_id,
            &request.task_id,
            Instant::now(),
        ))
    })
    .await?;
    Ok(settle_read(&lease, result)?)
}

#[tauri::command]
pub async fn respond_remote_agent_request(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RemoteRespondRequest,
) -> Result<RemoteRespondOutcome, String> {
    let lease = admit_connection(state.inner(), &request.server_id, &request.runner_id)?;
    let worker = lease.clone();
    let delivery = blocking(OperationClass::Control, move || {
        Ok(deliver(
            &worker,
            &request.runner_id,
            &request.task_id,
            &request.request_id,
            &request.response,
            Instant::now(),
        ))
    })
    .await?;
    Ok(delivery.settle(&lease)?)
}

#[cfg(test)]
#[path = "interactions_tests.rs"]
mod tests;
