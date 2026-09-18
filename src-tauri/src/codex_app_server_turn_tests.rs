use super::super::codex_app_server_protocol::classify_notification;
use super::*;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::AtomicUsize;

const THREAD: &str = "root-thread";
const TURN: &str = "current-turn";

struct FakePort {
    frames: Mutex<VecDeque<Result<TurnFrame, TurnFrameRecvError>>>,
    overflow: AtomicBool,
    attached: Mutex<Vec<String>>,
    attachment_allowed: AtomicBool,
    steers: Mutex<Vec<(TurnSteerParams, Duration)>>,
    steer_result: Mutex<Result<String, CodexRpcFailure>>,
    question_answers: Mutex<Vec<(Value, Value)>>,
    answer_blocked: AtomicBool,
    answer_entered: AtomicBool,
    cleanups: AtomicUsize,
    interrupted: AtomicBool,
    cleanup_blocked: AtomicBool,
    cleanup_finished: AtomicBool,
    cleanup_error: Mutex<Option<String>>,
    cleanup_panics: AtomicBool,
}

impl FakePort {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            frames: Mutex::new(VecDeque::new()),
            overflow: AtomicBool::new(false),
            attached: Mutex::new(Vec::new()),
            attachment_allowed: AtomicBool::new(true),
            steers: Mutex::new(Vec::new()),
            steer_result: Mutex::new(Ok(TURN.into())),
            question_answers: Mutex::new(Vec::new()),
            answer_blocked: AtomicBool::new(false),
            answer_entered: AtomicBool::new(false),
            cleanups: AtomicUsize::new(0),
            interrupted: AtomicBool::new(false),
            cleanup_blocked: AtomicBool::new(false),
            cleanup_finished: AtomicBool::new(false),
            cleanup_error: Mutex::new(None),
            cleanup_panics: AtomicBool::new(false),
        })
    }

    fn push(&self, method: &str, params: Value) {
        self.frames
            .lock()
            .unwrap()
            .push_back(Ok(TurnFrame::Notification(Box::new(
                classify_notification(method, params),
            ))));
    }

    fn complete(&self, thread: &str, turn: &str, status: &str) {
        self.push(
            "turn/completed",
            json!({"threadId":thread,"turn":{"id":turn,"status":status}}),
        );
    }

    fn child(self: &Arc<Self>) -> CodexTurnChild {
        CodexTurnChild::from_port(self.clone(), THREAD.into(), TURN.into())
    }
}

impl CodexTurnPort for FakePort {
    fn answer_question(&self, id: Value, result: Value, closed: &AtomicBool) -> Result<(), String> {
        self.answer_entered.store(true, Ordering::SeqCst);
        while self.answer_blocked.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        if closed.load(Ordering::SeqCst) {
            return Err("Closed".into());
        }
        self.question_answers.lock().unwrap().push((id, result));
        Ok(())
    }
    fn receive(&self) -> Result<TurnFrame, TurnFrameRecvError> {
        self.frames
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(TurnFrameRecvError::Timeout))
    }
    fn truncated(&self) -> bool {
        self.overflow.load(Ordering::SeqCst)
    }
    fn attach_thread(&self, id: &str) -> bool {
        self.attached.lock().unwrap().push(id.into());
        self.attachment_allowed.load(Ordering::SeqCst)
    }
    fn steer(&self, params: TurnSteerParams, timeout: Duration) -> Result<String, CodexRpcFailure> {
        self.steers.lock().unwrap().push((params, timeout));
        self.steer_result.lock().unwrap().clone()
    }
    fn cleanup(&self, interrupt: bool) -> Result<(), String> {
        self.cleanups.fetch_add(1, Ordering::SeqCst);
        self.interrupted.store(interrupt, Ordering::SeqCst);
        while self.cleanup_blocked.load(Ordering::SeqCst) {
            std::thread::yield_now();
        }
        self.cleanup_finished.store(true, Ordering::SeqCst);
        assert!(!self.cleanup_panics.load(Ordering::SeqCst), "cleanup panic");
        match self.cleanup_error.lock().unwrap().clone() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
    fn stderr(&self) -> String {
        "diagnostic tail".into()
    }
}

fn read_chunk(reader: &mut dyn Read) -> io::Result<String> {
    let mut bytes = [0; 32768];
    reader
        .read(&mut bytes)
        .map(|len| String::from_utf8(bytes[..len].to_vec()).unwrap())
}

fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !predicate() {
        assert!(
            Instant::now() < deadline,
            "asynchronous cleanup did not finish"
        );
        std::thread::yield_now();
    }
}

#[test]
fn readers_and_input_are_single_owner_and_session_precedes_output() {
    let port = FakePort::new();
    let mut child = port.child();
    let mut output = child.stdout_reader().unwrap();
    let session: Value = serde_json::from_str(&read_chunk(&mut output).unwrap()).unwrap();
    assert_eq!(session["t"], "session");
    assert_eq!(session["threadId"], THREAD);
    assert!(child.stdout_reader().is_err());
    assert!(child.stderr_reader().is_ok());
    assert!(child.stderr_reader().is_err());
    assert!(child.take_turn_input().is_some());
    assert!(child.take_turn_input().is_none());
    assert!(child.reap().is_err());
    assert_eq!(
        read_chunk(&mut output).unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
}

#[test]
fn only_exact_root_turn_completion_settles_the_child() {
    let port = FakePort::new();
    port.complete(THREAD, "old-turn", "completed");
    port.complete("foreign", TURN, "completed");
    port.complete(THREAD, TURN, "completed");
    let mut child = port.child();
    let mut output = child.stdout_reader().unwrap();
    read_chunk(&mut output).unwrap();
    assert_eq!(
        read_chunk(&mut output).unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
    assert!(!child.observe_exit());
    let _ = read_chunk(&mut output);
    assert!(!child.observe_exit());
    assert!(read_chunk(&mut output).unwrap().contains("result"));
    assert_eq!(child.reap().unwrap(), 0);
    assert_eq!(read_chunk(&mut output).unwrap(), "");
    wait_until(|| port.cleanup_finished.load(Ordering::SeqCst));
    assert!(!port.interrupted.load(Ordering::SeqCst));
}

#[test]
fn stale_root_items_and_usage_cannot_contaminate_current_turn() {
    let port = FakePort::new();
    port.push("item/completed", json!({"threadId":THREAD,"turnId":"old-turn","item":{"type":"agentMessage","id":"old","text":"STALE"}}));
    port.push("thread/tokenUsage/updated", json!({"threadId":THREAD,"turnId":"old-turn","tokenUsage":{"last":{"inputTokens":999},"total":{}}}));
    port.complete(THREAD, TURN, "completed");
    let mut child = port.child();
    let mut output = child.stdout_reader().unwrap();
    read_chunk(&mut output).unwrap();
    for _ in 0..2 {
        assert_eq!(
            read_chunk(&mut output).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
    }
    let terminal = read_chunk(&mut output).unwrap();
    assert!(!terminal.contains("999"));
    assert!(!terminal.contains("STALE"));
}

#[test]
fn subagent_registration_attaches_and_child_completion_does_not_end_root() {
    let port = FakePort::new();
    port.push("item/started", json!({"threadId":THREAD,"turnId":TURN,"item":{"type":"subAgentActivity","id":"call","kind":"started","agentThreadId":"sub","agentPath":"/root/sub"}}));
    port.push(
        "turn/started",
        json!({"threadId":"sub","turn":{"id":"child-turn","status":"inProgress"}}),
    );
    port.complete("sub", "stale-child-turn", "completed");
    port.complete("sub", "child-turn", "completed");
    let mut child = port.child();
    let mut output = child.stdout_reader().unwrap();
    read_chunk(&mut output).unwrap();
    assert!(read_chunk(&mut output).unwrap().contains("subagent"));
    assert!(port.attached.lock().unwrap().iter().any(|id| id == "sub"));
    // Start establishes authority without a wire event; a stale completion is ignored.
    for _ in 0..2 {
        assert_eq!(
            read_chunk(&mut output).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        assert!(!child.observe_exit());
    }
    assert!(read_chunk(&mut output)
        .unwrap()
        .contains("subagentTurnCompleted"));
    assert!(!child.observe_exit());
}

#[test]
fn attachment_failure_is_explicit_and_fails_turn() {
    let port = FakePort::new();
    port.attachment_allowed.store(false, Ordering::SeqCst);
    port.push("item/started", json!({"threadId":THREAD,"turnId":TURN,"item":{"type":"subAgentActivity","id":"call","kind":"started","agentThreadId":"sub","agentPath":"/root/sub"}}));
    let mut child = port.child();
    let mut output = child.stdout_reader().unwrap();
    read_chunk(&mut output).unwrap();
    assert!(read_chunk(&mut output)
        .unwrap()
        .contains("could not be attached"));
    assert_eq!(child.reap().unwrap(), 1);
}

#[test]
fn overflow_and_host_failure_are_visible_failed_exits() {
    for overflow in [true, false] {
        let port = FakePort::new();
        port.overflow.store(overflow, Ordering::SeqCst);
        port.frames
            .lock()
            .unwrap()
            .push_back(Err(TurnFrameRecvError::Closed {
                reason: "host disconnected; output is incomplete".into(),
            }));
        let mut child = port.child();
        let mut output = child.stdout_reader().unwrap();
        read_chunk(&mut output).unwrap();
        let error = read_chunk(&mut output).unwrap();
        assert!(error.contains("incomplete"));
        assert!(error.contains("error"));
        assert_eq!(child.reap().unwrap(), 1);
    }
}

#[test]
fn steering_preserves_exact_authority_client_id_and_deadline() {
    let port = FakePort::new();
    let mut child = port.child();
    let mut input = child.take_turn_input().unwrap();
    let payload = vec![UserInput::Text {
        text: "change direction".into(),
    }];
    input
        .steer(
            payload.clone(),
            Some("client-7".into()),
            Instant::now() + Duration::from_secs(2),
        )
        .unwrap();
    let calls = port.steers.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.thread_id, THREAD);
    assert_eq!(calls[0].0.expected_turn_id, TURN);
    assert_eq!(
        calls[0].0.client_user_message_id.as_deref(),
        Some("client-7")
    );
    assert_eq!(calls[0].0.input, payload);
    assert!(calls[0].1 > Duration::ZERO && calls[0].1 <= Duration::from_secs(2));
}

#[test]
fn steering_rejects_expired_closed_failed_and_wrong_turn_requests() {
    let port = FakePort::new();
    let mut child = port.child();
    let mut input = child.take_turn_input().unwrap();
    assert_eq!(
        input
            .steer(vec![], None, Instant::now())
            .unwrap_err()
            .kind(),
        io::ErrorKind::TimedOut
    );
    assert!(port.steers.lock().unwrap().is_empty());
    for (result, expected) in [
        (Err(CodexRpcFailure::Timeout), io::ErrorKind::TimedOut),
        (
            Err(CodexRpcFailure::HostFailed {
                reason: "gone".into(),
            }),
            io::ErrorKind::BrokenPipe,
        ),
        (Ok("wrong-turn".into()), io::ErrorKind::InvalidData),
    ] {
        *port.steer_result.lock().unwrap() = result;
        assert_eq!(
            input
                .steer(vec![], None, Instant::now() + Duration::from_secs(1))
                .unwrap_err()
                .kind(),
            expected
        );
    }
    input.close();
    assert!(input.cancellation_flag().load(Ordering::SeqCst));
    assert_eq!(
        input
            .steer(vec![], None, Instant::now() + Duration::from_secs(1))
            .unwrap_err()
            .kind(),
        io::ErrorKind::BrokenPipe
    );
}

#[test]
fn stop_settles_immediately_while_cleanup_is_blocked_and_runs_once() {
    let port = FakePort::new();
    port.cleanup_blocked.store(true, Ordering::SeqCst);
    let mut child = port.child();
    let input = child.take_turn_input().unwrap();
    child.force_kill();
    assert!(child.observe_exit());
    assert_eq!(child.state.exit.load(Ordering::SeqCst), 130);
    assert!(input.cancellation_flag().load(Ordering::SeqCst));
    wait_until(|| port.cleanups.load(Ordering::SeqCst) == 1);
    assert!(!port.cleanup_finished.load(Ordering::SeqCst));
    child.force_kill();
    port.cleanup_blocked.store(false, Ordering::SeqCst);
    assert_eq!(child.reap().unwrap(), 130);
    drop(child);
    wait_until(|| port.cleanup_finished.load(Ordering::SeqCst));
    assert_eq!(port.cleanups.load(Ordering::SeqCst), 1);
    assert!(port.interrupted.load(Ordering::SeqCst));
}

#[test]
fn dropping_live_child_closes_input_and_owns_interrupt_cleanup() {
    let port = FakePort::new();
    let mut child = port.child();
    let input = child.take_turn_input().unwrap();
    drop(child);
    assert!(input.cancellation_flag().load(Ordering::SeqCst));
    wait_until(|| port.cleanup_finished.load(Ordering::SeqCst));
    assert_eq!(port.cleanups.load(Ordering::SeqCst), 1);
    assert!(port.interrupted.load(Ordering::SeqCst));
}

#[test]
fn stderr_is_exposed_only_after_failure_and_not_success_or_stop() {
    for exit in [0, 1, 130] {
        let port = FakePort::new();
        let mut child = port.child();
        let mut stderr = child.stderr_reader().unwrap();
        assert_eq!(
            read_chunk(&mut stderr).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        child.state.settle(exit);
        assert_eq!(
            read_chunk(&mut stderr).unwrap(),
            if exit == 1 { "diagnostic tail" } else { "" }
        );
        assert_eq!(read_chunk(&mut stderr).unwrap(), "");
    }
}

#[path = "codex_app_server_turn_host_tests.rs"]
mod host_tests;

#[test]
fn concurrent_and_repeated_reapers_retain_cleanup_failure() {
    let port = FakePort::new();
    port.cleanup_blocked.store(true, Ordering::SeqCst);
    *port.cleanup_error.lock().unwrap() = Some("terminal cleanup unconfirmed".into());
    let child = Arc::new(port.child());
    child.force_kill();
    wait_until(|| port.cleanups.load(Ordering::SeqCst) == 1);
    let (sender, receiver) = std::sync::mpsc::channel();
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let child = Arc::clone(&child);
            let sender = sender.clone();
            std::thread::spawn(move || sender.send(child.reap()).unwrap())
        })
        .collect();
    assert!(receiver.recv_timeout(Duration::from_millis(20)).is_err());
    port.cleanup_blocked.store(false, Ordering::SeqCst);
    for _ in 0..2 {
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            Err("terminal cleanup unconfirmed".into())
        );
    }
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(child.reap(), Err("terminal cleanup unconfirmed".into()));
    assert_eq!(port.cleanups.load(Ordering::SeqCst), 1);
}

#[test]
fn cleanup_worker_panic_remains_an_error_on_repeated_reap() {
    let port = FakePort::new();
    port.cleanup_panics.store(true, Ordering::SeqCst);
    let child = port.child();
    child.force_kill();
    assert_eq!(child.reap(), Err("Codex turn cleanup failed.".into()));
    assert_eq!(child.reap(), Err("Codex turn cleanup failed.".into()));
    assert_eq!(port.cleanups.load(Ordering::SeqCst), 1);
}

#[test]
fn question_waits_for_answer_and_maps_exact_provider_values() {
    use crate::agent_questions::{AgentQuestionAnswerItem, AgentQuestionResponse};
    let port = FakePort::new();
    let child = port.child();
    questions::register(&child.state,json!(91),json!({"threadId":THREAD,"turnId":TURN,"questions":[{"id":"choice","header":"Choice","question":"Which?","options":[{"label":"First","description":"Recommended"}]}]})).unwrap();
    assert!(port.question_answers.lock().unwrap().is_empty());
    let request = child.state.questions.list("task").remove(0);
    child
        .state
        .questions
        .answer(
            "task",
            &request.id,
            AgentQuestionResponse {
                answers: vec![AgentQuestionAnswerItem {
                    question_id: "choice".into(),
                    option_ids: vec!["option-0".into()],
                    text: "Extra".into(),
                }],
            },
        )
        .unwrap();
    assert_eq!(
        *port.question_answers.lock().unwrap(),
        vec![(
            json!(91),
            json!({"answers":{"choice":{"answers":["First","Extra"]}}})
        )]
    );
    child.state.settle(0);
}
#[test]
fn question_rejects_foreign_turn_and_expires_on_stop() {
    let port = FakePort::new();
    let child = port.child();
    let mut params = json!({"threadId":THREAD,"turnId":"foreign","questions":[{"id":"q","header":"","question":"Text?"}]});
    assert!(questions::register(&child.state, json!(1), params.clone()).is_err());
    params["turnId"] = json!(TURN);
    questions::register(&child.state, json!(2), params).unwrap();
    child.force_kill();
    assert_eq!(
        child.state.questions.list("task")[0].status,
        crate::agent_questions::AgentQuestionStatus::Expired
    );
    assert!(port.question_answers.lock().unwrap().is_empty());
}

#[test]
fn stale_and_subagent_questions_do_not_abort_parent_turn() {
    let port = FakePort::new();
    let child = port.child();
    let mut reader = CodexTurnReader {
        state: Arc::clone(&child.state),
        projection: CodexTurnProjection::new(Some(THREAD.into())),
        pending: Cursor::new(vec![]),
        declined_reported: false,
    };
    for (thread, turn) in [(THREAD, "previous"), ("child-thread", TURN)] {
        reader.project(TurnFrame::UserInputRequested { id: json!(1), params: json!({"threadId":thread,"turnId":turn,"questions":[{"id":"q","header":"Q","question":"Choose"}]}) });
        assert!(!child.observe_exit());
        assert!(child.state.questions.list("task").is_empty());
    }
    child.state.settle(0);
}

#[test]
fn resolved_question_expires_without_ending_turn() {
    let port = FakePort::new();
    let child = port.child();
    questions::register(&child.state, json!(9), json!({"threadId":THREAD,"turnId":TURN,"questions":[{"id":"q","header":"Q","question":"Choose"}]})).unwrap();
    let mut reader = CodexTurnReader {
        state: Arc::clone(&child.state),
        projection: CodexTurnProjection::new(Some(THREAD.into())),
        pending: Cursor::new(vec![]),
        declined_reported: false,
    };
    reader.project(TurnFrame::UserInputResolved { id: json!(9) });
    assert_eq!(
        child.state.questions.list("task")[0].status,
        crate::agent_questions::AgentQuestionStatus::Expired
    );
    assert!(!child.observe_exit());
    child.state.settle(0);
}

#[test]
fn direct_input_cancellation_while_answer_waits_prevents_provider_write() {
    use crate::agent_questions::{AgentQuestionAnswerItem, AgentQuestionResponse};
    let port = FakePort::new();
    let child = port.child();
    questions::register(&child.state,json!(19),json!({"threadId":THREAD,"turnId":TURN,"questions":[{"id":"q","header":"Q","question":"Choose"}]})).unwrap();
    let session = Arc::clone(&child.state.questions);
    let request = session.list("task").remove(0);
    port.answer_blocked.store(true, Ordering::SeqCst);
    let worker = std::thread::spawn(move || {
        session.answer(
            "task",
            &request.id,
            AgentQuestionResponse {
                answers: vec![AgentQuestionAnswerItem {
                    question_id: "q".into(),
                    option_ids: vec![],
                    text: "Reply".into(),
                }],
            },
        )
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while !port.answer_entered.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::yield_now();
    }
    let entered = port.answer_entered.load(Ordering::SeqCst);
    child.state.input_closed.store(true, Ordering::SeqCst);
    port.answer_blocked.store(false, Ordering::SeqCst);
    assert!(worker.join().unwrap().is_err());
    assert!(entered);
    assert!(port.question_answers.lock().unwrap().is_empty());
    child.state.settle(0);
}
