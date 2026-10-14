use super::{
    interactions::{
        read_under, settle_read, Dispatch, InteractionError, InteractionRunnerPort,
        InteractionSource, RemoteInteractions,
    },
    interactions_ledger::InteractionLedger,
    interactions_respond::{deliver, RemoteRequestResponse, RemoteRespondOutcome},
    interactions_wire::parse_snapshot,
    thread_requests_ipc::TurnDescriptor,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub(super) const FIXTURE: &str = include_str!("fixtures/agent-interactions-wire.json");
pub(super) const RUNNER: &str = "linux-runner";
pub(super) const TASK: &str = "8c0d1f5e-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
pub(super) const OTHER_TASK: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
pub(super) const QUESTION: &str = "a0000000-0000-4000-8000-000000000001";
pub(super) const APPROVAL: &str = "b0000000-0000-4000-8000-000000000001";

pub(super) type Reply = Result<Value, String>;
pub(super) const TRANSPORT_TIMEOUT: Duration = Duration::from_secs(30);
const TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";
pub(super) type Call = (String, String, Option<Value>);

pub(super) struct FakeRunner {
    pub(super) runner: String,
    pub(super) current: Cell<bool>,
    pub(super) swapped: Cell<bool>,
    pub(super) revoke_on_call: Option<usize>,
    pub(super) swap_on_call: Option<usize>,
    pub(super) replies: RefCell<VecDeque<Reply>>,
    pub(super) calls: RefCell<Vec<Call>>,
    pub(super) ledger: InteractionLedger,
    pub(super) called_under_lock: Cell<bool>,
    pub(super) call_delay: Duration,
    pub(super) base: Instant,
    pub(super) elapsed: Cell<Duration>,
    pub(super) deadlines: RefCell<Vec<Option<Instant>>>,
    pub(super) silent_from: Option<usize>,
    pub(super) unsent_posts: bool,
    pub(super) now_tick: Cell<Duration>,
}

impl FakeRunner {
    pub(super) fn replying(replies: Vec<Reply>) -> Self {
        Self {
            runner: RUNNER.into(),
            current: Cell::new(true),
            swapped: Cell::new(false),
            revoke_on_call: None,
            swap_on_call: None,
            replies: RefCell::new(replies.into()),
            calls: RefCell::new(Vec::new()),
            ledger: InteractionLedger::default(),
            called_under_lock: Cell::new(false),
            call_delay: Duration::ZERO,
            base: Instant::now(),
            elapsed: Cell::new(Duration::ZERO),
            deadlines: RefCell::new(Vec::new()),
            silent_from: None,
            unsent_posts: false,
            now_tick: Cell::new(Duration::ZERO),
        }
    }

    pub(super) fn clock(&self) -> Instant {
        self.base + self.elapsed.get()
    }

    pub(super) fn joined(&self, tasks: &[String], conversation: &str) {
        for task in tasks {
            self.ledger
                .conversations()
                .remember(task, conversation.to_string());
        }
    }

    pub(super) fn queue(&self, replies: Vec<Reply>) {
        self.replies.borrow_mut().extend(replies);
    }

    pub(super) fn calls(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }

    pub(super) fn routes(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .map(|(method, path, _)| format!("{method} {path}"))
            .collect()
    }
}

impl InteractionRunnerPort for FakeRunner {
    fn runner_id(&self) -> &str {
        if self.swapped.get() {
            return "replacement-runner";
        }
        &self.runner
    }

    fn is_current(&self) -> bool {
        self.current.get()
    }

    fn ledger(&self) -> &InteractionLedger {
        &self.ledger
    }

    fn call_before(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
        deadline: Option<Instant>,
    ) -> Reply {
        self.deadlines.borrow_mut().push(deadline);
        let silent = self
            .silent_from
            .is_some_and(|first| self.calls.borrow().len() + 1 >= first);
        let delay = match silent {
            true => TRANSPORT_TIMEOUT,
            false => self.call_delay,
        };
        let finished = self.clock() + delay;
        if silent && deadline.is_none_or(|deadline| finished <= deadline) {
            self.calls
                .borrow_mut()
                .push((method.into(), path.into(), body));
            self.elapsed.set(self.elapsed.get() + delay);
            return Err(TIMED_OUT.into());
        }
        if let Some(deadline) = deadline.filter(|deadline| finished > *deadline) {
            self.calls
                .borrow_mut()
                .push((method.into(), path.into(), body));
            self.elapsed
                .set(deadline.saturating_duration_since(self.base));
            return Err(TIMED_OUT.into());
        }
        self.elapsed.set(self.elapsed.get() + self.call_delay);
        self.call(method, path, body)
    }

    fn now(&self) -> Instant {
        self.elapsed.set(self.elapsed.get() + self.now_tick.get());
        self.clock()
    }

    fn post_before(&self, path: &str, body: Value, deadline: Option<Instant>) -> (Reply, Dispatch) {
        if self.unsent_posts {
            self.calls
                .borrow_mut()
                .push(("POST".into(), path.into(), Some(body)));
            return (
                Err("Runner connection was superseded.".into()),
                Dispatch::Unsent,
            );
        }
        (
            self.call_before("POST", path, Some(body), deadline),
            Dispatch::PossiblySent,
        )
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Reply {
        self.calls
            .borrow_mut()
            .push((method.into(), path.into(), body));
        let made = self.calls.borrow().len();
        if !self.ledger.is_unlocked() {
            self.called_under_lock.set(true);
        }
        if self.revoke_on_call == Some(made) {
            self.current.set(false);
        }
        if self.swap_on_call == Some(made) {
            self.swapped.set(true);
        }
        self.replies
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Err("unexpected runner call".into()))
    }
}

pub(super) fn snapshot(name: &str) -> Value {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("interaction fixture is JSON");
    fixture["snapshots"]
        .as_array()
        .expect("snapshots")
        .iter()
        .find(|case| case["name"] == name)
        .expect("named snapshot")["value"]
        .clone()
}

pub(super) fn live() -> Value {
    snapshot("livePendingQuestionAndApproval")
}

pub(super) fn legacy(item: &Value) -> Value {
    let mut item = item.clone();
    let fields = item.as_object_mut().expect("wire item");
    for added in ["createdAt", "settledAt", "responseCapability"] {
        fields.remove(added);
    }
    item
}

pub(super) fn legacy_question(status: &str) -> Value {
    let mut item = legacy(&live()["questions"][0]);
    item["status"] = status.into();
    item
}

pub(super) fn legacy_approval(status: &str) -> Value {
    let mut item = legacy(&live()["approvals"][0]);
    item["status"] = status.into();
    item
}

pub(super) fn composed(item: Value, capability: Option<Value>) -> Value {
    let mut item = item;
    item["createdAt"] = Value::Null;
    item["settledAt"] = Value::Null;
    if let Some(capability) = capability {
        item["responseCapability"] = capability;
    }
    item
}

pub(super) fn items(items: Vec<Value>) -> Reply {
    Ok(json!({ "items": items }))
}

pub(super) fn not_found() -> Reply {
    Err("Runner request failed (HTTP 404).".into())
}

pub(super) fn conflict() -> Reply {
    Err("Runner request failed (HTTP 409).".into())
}

pub(super) fn route(suffix: &str) -> String {
    format!("/v1/tasks/{TASK}/{suffix}")
}

pub(super) fn read_at(
    runner: &FakeRunner,
    now: Instant,
) -> Result<RemoteInteractions, InteractionError> {
    settle_read(runner, read_under(runner, RUNNER, TASK, now))
}

pub(super) fn answer_at(
    runner: &FakeRunner,
    request_id: &str,
    response: &RemoteRequestResponse,
    now: Instant,
) -> Result<RemoteRespondOutcome, InteractionError> {
    deliver(runner, RUNNER, TASK, request_id, response, now).settle(runner)
}

pub(super) fn answer(
    runner: &FakeRunner,
    request_id: &str,
    response: &RemoteRequestResponse,
) -> Result<RemoteRespondOutcome, InteractionError> {
    answer_at(runner, request_id, response, Instant::now())
}

pub(super) fn choose(option: &str) -> RemoteRequestResponse {
    serde_json::from_value(json!({
        "kind": "question",
        "answers": [{"questionId": "storage", "optionIds": [option], "text": ""}]
    }))
    .expect("question response")
}

pub(super) fn decide(decision: &str) -> RemoteRequestResponse {
    serde_json::from_value(json!({"kind": "approval", "decision": decision}))
        .expect("approval response")
}

pub(super) fn wire<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serialisable IPC value")
}

pub(super) fn task(index: usize) -> String {
    format!("00000000-0000-4000-8000-{index:012}")
}

pub(super) fn retasked(mut snapshot: Value, task: &str) -> Value {
    snapshot["taskId"] = task.into();
    for section in ["questions", "approvals"] {
        let items = snapshot[section].as_array_mut().expect("snapshot section");
        for item in items {
            item["taskId"] = task.into();
        }
    }
    snapshot
}

pub(super) fn sequenced(mut snapshot: Value, sequence: u64) -> Value {
    snapshot["sequence"] = sequence.into();
    snapshot
}

pub(super) fn observed(snapshot: Value, source: InteractionSource) -> RemoteInteractions {
    let task = snapshot["taskId"].as_str().expect("task id").to_string();
    let parsed = parse_snapshot(snapshot, &task).expect("valid snapshot");
    RemoteInteractions {
        task_id: parsed.task_id,
        sequence: parsed.sequence,
        questions: parsed.questions,
        questions_truncated: parsed.questions_truncated,
        approvals: parsed.approvals,
        approvals_truncated: parsed.approvals_truncated,
        source,
        approvals_complete: true,
    }
}

pub(super) fn turn(
    task: &str,
    started_at_epoch_ms: u64,
    interaction_sequence: Option<u64>,
    terminal: bool,
) -> TurnDescriptor {
    TurnDescriptor {
        turn_id: task.into(),
        started_at_epoch_ms,
        interaction_sequence,
        terminal,
    }
}

#[cfg(unix)]
pub(super) mod transport {
    use crate::remote_runner::{
        service::{ConnectionLease, RemoteRunnerState},
        transport::Session,
        types::Server,
    };
    use serde_json::{json, Value};
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    pub(in crate::remote_runner) type Served = std::thread::JoinHandle<Vec<(String, String)>>;

    pub(in crate::remote_runner) fn connection(
        server_id: &str,
        runner: &str,
    ) -> (ConnectionLease, UnixListener) {
        let session = Arc::new(Session::fixture());
        let listener = UnixListener::bind(session.socket_path()).expect("runner socket");
        let server = Server {
            id: server_id.into(),
            name: server_id.into(),
            host: "127.0.0.1".into(),
            username: "codex".into(),
            port: 22,
            connected: true,
            runner_id: Some(runner.into()),
        };
        (ConnectionLease::new(server, session), listener)
    }

    pub(in crate::remote_runner) fn receive(socket: &mut UnixStream) -> (String, String) {
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).expect("request head");
            head.push(byte[0]);
        }
        let head = String::from_utf8(head).expect("request head text");
        let length = head
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = vec![0; length];
        socket.read_exact(&mut body).expect("request body");
        (head, String::from_utf8(body).expect("request body text"))
    }

    pub(in crate::remote_runner) fn serve(
        listener: UnixListener,
        runner: &'static str,
        exchanges: usize,
        mut reply: impl FnMut(&str) -> (u16, Value) + Send + 'static,
    ) -> Served {
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut served = Vec::new();
            while served.len() < exchanges && Instant::now() < deadline {
                let accepted = listener.accept();
                if accepted.is_err() {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                }
                let (mut socket, _) = accepted.expect("accepted connection");
                socket.set_nonblocking(false).expect("blocking socket");
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("read timeout");
                let (head, body) = receive(&mut socket);
                let line = head
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .trim_end_matches(" HTTP/1.1")
                    .to_string();
                let (status, value) = match line.as_str() {
                    "GET /healthz" => (200, json!({})),
                    "GET /v1/runner" => (200, json!({"protocolVersion": 1, "runnerId": runner})),
                    other => reply(other),
                };
                let payload = value.to_string();
                write!(
                    socket,
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                    payload.len()
                )
                .expect("response");
                if line != "GET /healthz" {
                    served.push((head, body));
                }
            }
            served
        })
    }

    pub(in crate::remote_runner) fn lines(served: &[(String, String)]) -> Vec<String> {
        served
            .iter()
            .map(|(head, _)| {
                head.lines()
                    .next()
                    .unwrap_or_default()
                    .trim_end_matches(" HTTP/1.1")
                    .to_string()
            })
            .collect()
    }

    pub(in crate::remote_runner) fn state() -> (RemoteRunnerState, std::path::PathBuf) {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let directory = std::env::temp_dir().join(format!(
            "codevo-remote-interactions-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let state = RemoteRunnerState::new(directory.clone()).expect("runner state");
        (state, directory)
    }

    pub(in crate::remote_runner) fn never_contacted(listener: &UnixListener) -> bool {
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        listener.accept().is_err()
    }
}
