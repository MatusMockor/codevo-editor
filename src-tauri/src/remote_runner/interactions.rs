use super::{
    interactions_ledger::{ContentDigest, InteractionLedger},
    interactions_wire::{
        parse_legacy_approvals, parse_legacy_questions, parse_snapshot, ApprovalInteraction,
        InteractionSnapshot, QuestionInteraction, WireError,
    },
    project_management::call_lease,
    send_gate::SendGate,
    service::{ConnectionLease, RemoteRunnerState},
    types::{id, uuid},
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{cell::Cell, sync::Arc, time::Instant};

const NOT_FOUND: &str = "Runner request failed (HTTP 404).";
const CONFLICT: &str = "Runner request failed (HTTP 409).";
const CHANGED_DURING_REQUEST: &str = "Server connection changed during request";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum InteractionError {
    InvalidRequest,
    RunnerChanged,
    Superseded,
    DeliveryUncertain,
    TaskNotFound,
    RequestGone,
    Unconfirmed,
    DeadlineExceeded,
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
            Self::DeadlineExceeded => "Runner did not answer in time",
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

    fn call_before(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
        _deadline: Option<Instant>,
    ) -> Result<Value, String> {
        self.call(method, path, body)
    }

    fn now(&self) -> Instant {
        Instant::now()
    }

    fn has_passed(&self, deadline: Instant) -> bool {
        self.now() >= deadline
    }

    fn post_before(
        &self,
        path: &str,
        body: Value,
        deadline: Option<Instant>,
    ) -> (Result<Value, String>, Dispatch) {
        (
            self.call_before("POST", path, Some(body), deadline),
            Dispatch::PossiblySent,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Dispatch {
    Unsent,
    PossiblySent,
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

    fn call_before(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
        deadline: Option<Instant>,
    ) -> Result<Value, String> {
        let Some(deadline) = deadline else {
            return self.call(method, path, body);
        };
        self.send_before((method, path, body), deadline, None)
    }

    fn post_before(
        &self,
        path: &str,
        body: Value,
        deadline: Option<Instant>,
    ) -> (Result<Value, String>, Dispatch) {
        let Some(deadline) = deadline else {
            return (self.call("POST", path, Some(body)), Dispatch::PossiblySent);
        };
        let gate = Arc::new(SendGate::default());
        let result = self.send_before(
            ("POST", path, Some(body)),
            deadline,
            Some(Arc::clone(&gate)),
        );
        let dispatch = match gate.cancel() {
            true => Dispatch::Unsent,
            false => Dispatch::PossiblySent,
        };
        (result, dispatch)
    }
}

impl ConnectionLease {
    fn send_before(
        &self,
        request: (&'static str, &str, Option<Value>),
        deadline: Instant,
        gate: Option<Arc<SendGate>>,
    ) -> Result<Value, String> {
        let session = self.session_with_cancellation(|| Instant::now() >= deadline)?;
        if !self.is_current() {
            return Err(CHANGED_DURING_REQUEST.into());
        }
        let result = session.request_before(self.server(), request, deadline, gate);
        if !self.is_current() {
            return Err(CHANGED_DURING_REQUEST.into());
        }
        result
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
    #[serde(skip)]
    pub approvals_complete: bool,
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
            approvals_complete: true,
        }
    }

    fn legacy(
        task: &str,
        questions: Vec<QuestionInteraction>,
        listed: Option<LegacyApprovalList>,
        ledger: &InteractionLedger,
    ) -> Result<Self, InteractionError> {
        let approvals_complete = listed.is_some();
        let (approvals, approvals_truncated) = listed.unwrap_or_default();
        let digest = digest(&(&questions, &approvals, approvals_truncated))?;
        Ok(Self {
            task_id: task.into(),
            sequence: ledger.stamp(task, digest),
            questions,
            questions_truncated: false,
            approvals,
            approvals_truncated,
            source: InteractionSource::Legacy,
            approvals_complete,
        })
    }
}

pub(super) struct Exchange<'a, P> {
    port: &'a P,
    runner: &'a str,
    task: &'a str,
    now: Instant,
    deadline: Option<Instant>,
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
            deadline: None,
            posted: Cell::new(false),
        };
        exchange.admit()?;
        Ok(exchange)
    }

    pub(super) fn until(self, deadline: Option<Instant>) -> Self {
        Self { deadline, ..self }
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

    fn fetch(&self, path: &str) -> Result<Value, CallError> {
        self.admit()?;
        let outcome = self.port.call_before("GET", path, None, self.deadline);
        self.admit()?;
        outcome.map_err(CallError::from_transport)
    }

    fn get(&self, route: &str) -> Result<Value, CallError> {
        self.fetch(&self.path(route))
    }

    pub(super) fn task_record(&self) -> Result<Value, InteractionError> {
        Ok(self.fetch(&format!("/v1/tasks/{}", self.task))?)
    }

    pub(super) fn post(&self, route: &str, body: Value) -> Result<Value, CallError> {
        self.admit()?;
        if self
            .deadline
            .is_some_and(|deadline| self.port.has_passed(deadline))
        {
            return Err(InteractionError::DeadlineExceeded.into());
        }
        let (outcome, dispatch) = self
            .port
            .post_before(&self.path(route), body, self.deadline);
        self.posted.set(dispatch == Dispatch::PossiblySent);
        self.admit().map_err(|error| self.after_send(error))?;
        outcome.map_err(CallError::from_transport)
    }

    fn after_send(&self, error: InteractionError) -> InteractionError {
        if self.posted.get() {
            return InteractionError::DeliveryUncertain;
        }
        error
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

    fn approvals(&self) -> Result<Option<LegacyApprovalList>, InteractionError> {
        match self.get("approvals") {
            Ok(value) => Ok(Some(parse_legacy_approvals(value, self.task)?)),
            Err(CallError::NotFound) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn confirm_missing_approvals(&self) -> Result<Option<LegacyApprovalList>, InteractionError> {
        parse_legacy_questions(self.get("questions")?, self.task)?;
        if let Some(approvals) = self.approvals()? {
            return Ok(Some(approvals));
        }
        self.admit()?;
        self.port.ledger().remember_missing_approvals(self.now);
        Ok(None)
    }

    fn legacy_approvals(&self) -> Result<Option<LegacyApprovalList>, InteractionError> {
        if self.port.ledger().lacks_approvals(self.now) {
            return Ok(None);
        }
        match self.approvals()? {
            Some(approvals) => Ok(Some(approvals)),
            None => self.confirm_missing_approvals(),
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

pub(super) fn read_until<P: InteractionRunnerPort>(
    port: &P,
    runner: &str,
    task: &str,
    now: Instant,
    deadline: Option<Instant>,
) -> Result<RemoteInteractions, InteractionError> {
    Exchange::open(port, runner, task, now)?
        .until(deadline)
        .read()
}

pub(super) fn admit_connection(
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

#[cfg(test)]
#[path = "interactions_tests.rs"]
mod tests;
