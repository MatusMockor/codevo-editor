use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

#[derive(Default)]
struct RecordingWriter {
    frames: Arc<Mutex<Vec<Vec<u8>>>>,
    closes: Arc<AtomicUsize>,
    failure: Option<io::ErrorKind>,
    write_delay: Option<Duration>,
    writing: Arc<AtomicUsize>,
}

impl RecordingWriter {
    fn new() -> Self {
        Self::default()
    }

    fn failing(kind: io::ErrorKind) -> Self {
        Self {
            failure: Some(kind),
            ..Self::default()
        }
    }

    fn slow(delay: Duration) -> Self {
        Self {
            write_delay: Some(delay),
            ..Self::default()
        }
    }

    fn writing(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.writing)
    }

    fn frames(&self) -> Arc<Mutex<Vec<Vec<u8>>>> {
        Arc::clone(&self.frames)
    }

    fn closes(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.closes)
    }
}

impl AgentTaskInput for RecordingWriter {
    fn write_frame(&mut self, frame: &[u8], _deadline: Instant) -> io::Result<()> {
        if let Some(kind) = self.failure {
            return Err(io::Error::from(kind));
        }
        if let Some(delay) = self.write_delay {
            self.writing.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(delay);
        }
        self.frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(frame.to_vec());
        Ok(())
    }

    fn close(&mut self) {
        self.closes.fetch_add(1, Ordering::SeqCst);
    }
}

fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(30)
}

fn slot_with(writer: RecordingWriter) -> AgentTaskInputSlot {
    AgentTaskInputSlot::new(Box::new(writer), None)
}

fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn slot_writes_frames_in_order_and_counts_them() {
    let writer = RecordingWriter::new();
    let frames = writer.frames();
    let slot = slot_with(writer);

    assert_eq!(slot.state(), AgentTaskInputState::Open);
    slot.write(b"first\n", deadline(), MAX_AGENT_STEERS_PER_TURN)
        .expect("first frame");
    slot.write(b"second\n", deadline(), MAX_AGENT_STEERS_PER_TURN)
        .expect("second frame");

    let written = frames
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert_eq!(
        written,
        vec![b"first\n".to_vec(), b"second\n".to_vec()],
        "frames reach the child in arrival order"
    );
    assert_eq!(slot.frames_written(), 2);
}

#[test]
fn slot_rejects_after_close_after_result() {
    let writer = RecordingWriter::new();
    let closes = writer.closes();
    let slot = slot_with(writer);

    slot.close(AgentTaskInputState::ClosedAfterResult);

    assert_eq!(slot.state(), AgentTaskInputState::ClosedAfterResult);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
    assert_eq!(
        slot.write(b"late\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::InputClosed)
    );
}

#[test]
fn slot_close_keeps_the_first_reason_and_closes_once() {
    let writer = RecordingWriter::new();
    let closes = writer.closes();
    let slot = slot_with(writer);

    slot.close(AgentTaskInputState::ClosedByStop);
    slot.close(AgentTaskInputState::ClosedAfterResult);

    assert_eq!(slot.state(), AgentTaskInputState::ClosedByStop);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
}

#[test]
fn slot_rejects_after_close_by_stop() {
    let slot = slot_with(RecordingWriter::new());

    slot.close(AgentTaskInputState::ClosedByStop);

    assert_eq!(
        slot.write(b"late\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn slot_enforces_the_steer_limit() {
    let writer = RecordingWriter::new();
    let frames = writer.frames();
    let slot = slot_with(writer);

    for index in 0..MAX_AGENT_STEERS_PER_TURN {
        slot.write(
            format!("frame-{index}\n").as_bytes(),
            deadline(),
            MAX_AGENT_STEERS_PER_TURN,
        )
        .expect("frame within the limit");
    }

    assert_eq!(
        slot.write(b"over\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::LimitExceeded)
    );
    assert_eq!(
        frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        MAX_AGENT_STEERS_PER_TURN as usize
    );
    assert_eq!(slot.state(), AgentTaskInputState::Open);
}

#[test]
fn slot_marks_detached_on_write_failure() {
    let slot = slot_with(RecordingWriter::failing(io::ErrorKind::BrokenPipe));

    assert_eq!(
        slot.write(b"frame\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::WriteFailed)
    );
    assert_eq!(slot.state(), AgentTaskInputState::Detached);
    assert_eq!(
        slot.write(b"frame\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::InputUnavailable)
    );
}

#[test]
fn timed_out_write_is_write_timed_out() {
    let slot = slot_with(RecordingWriter::failing(io::ErrorKind::TimedOut));

    assert_eq!(
        slot.write(b"frame\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::WriteTimedOut)
    );
    assert_eq!(slot.state(), AgentTaskInputState::Detached);
}

#[test]
fn an_oversized_frame_is_rejected_before_the_child_is_touched() {
    let writer = RecordingWriter::new();
    let frames = writer.frames();
    let slot = slot_with(writer);

    let frame = vec![b'x'; MAX_AGENT_STEER_FRAME_BYTES + 1];

    assert_eq!(
        slot.write(&frame, deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::LimitExceeded)
    );
    assert!(frames
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_empty());
    assert_eq!(slot.state(), AgentTaskInputState::Open);
}

#[test]
fn every_rejection_serializes_with_a_reason_tag() {
    let pairs = [
        (AgentTaskSteerRejection::NotRegistered, "notRegistered"),
        (AgentTaskSteerRejection::NotRunning, "notRunning"),
        (AgentTaskSteerRejection::Stopping, "stopping"),
        (AgentTaskSteerRejection::InputClosed, "inputClosed"),
        (
            AgentTaskSteerRejection::InputUnavailable,
            "inputUnavailable",
        ),
        (AgentTaskSteerRejection::LimitExceeded, "limitExceeded"),
        (AgentTaskSteerRejection::WriteTimedOut, "writeTimedOut"),
        (AgentTaskSteerRejection::WriteFailed, "writeFailed"),
    ];
    for (rejection, reason) in pairs {
        let encoded = serde_json::to_string(&rejection).expect("encode rejection");
        assert_eq!(encoded, format!(r#"{{"reason":"{reason}"}}"#));
        let decoded: AgentTaskSteerRejection =
            serde_json::from_str(&encoded).expect("decode rejection");
        assert_eq!(decoded, rejection);
    }
    assert!(serde_json::from_str::<AgentTaskSteerRejection>(r#"{"reason":"nope"}"#).is_err());
    assert!(serde_json::from_str::<AgentTaskSteerRejection>(r#""stopping""#).is_err());
    assert!(serde_json::from_str::<AgentTaskSteerRejection>("{}").is_err());
}

#[test]
fn close_never_waits_for_an_in_flight_write() {
    let writer = RecordingWriter::slow(Duration::from_millis(400));
    let frames = writer.frames();
    let closes = writer.closes();
    let writing = writer.writing();
    let slot = Arc::new(slot_with(writer));
    let writing_slot = Arc::clone(&slot);

    let pending = std::thread::spawn(move || {
        writing_slot.write(b"slow\n", deadline(), MAX_AGENT_STEERS_PER_TURN)
    });
    assert!(
        wait_until(Duration::from_secs(5), || writing.load(Ordering::SeqCst)
            > 0),
        "the slow write never started"
    );

    let started = Instant::now();
    slot.close(AgentTaskInputState::ClosedByStop);
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_millis(150),
        "close waited for the in-flight write: {elapsed:?}"
    );
    assert_eq!(slot.state(), AgentTaskInputState::ClosedByStop);
    assert_eq!(
        slot.write(b"racing\n", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::Stopping),
        "a steer racing the close is rejected as soon as the state flips"
    );

    pending.join().expect("pending write").expect("slow write");
    assert_eq!(
        frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        1
    );
    assert!(
        wait_until(Duration::from_secs(5), || closes.load(Ordering::SeqCst)
            == 1),
        "the in-flight writer never released the handle after the close"
    );
}

#[test]
fn queued_write_honors_its_deadline_without_waiting_for_writer() {
    let slot = slot_with(RecordingWriter::new());
    let _held = slot.writer.lock().expect("hold writer");
    let started = Instant::now();
    assert_eq!(
        slot.write(b"later\n", started + Duration::from_millis(25), 32),
        Err(AgentTaskSteerRejection::WriteTimedOut)
    );
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[cfg(unix)]
#[test]
fn initial_frame_precedes_a_steer_that_arrives_first() {
    use std::{
        io::Read,
        process::{Command, Stdio},
    };
    let mut child = Command::new("/bin/cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("cat");
    let retained = Arc::new(RetainedAgentStdin::new(child.stdin.take().expect("stdin")));
    let pending_stdin = Arc::clone(&retained);
    let pending = std::thread::spawn(move || pending_stdin.write_frame(b"steer\n", deadline()));
    std::thread::sleep(Duration::from_millis(30));
    retained
        .write_first_frame(b"initial\n", deadline())
        .expect("initial");
    pending.join().expect("writer").expect("steer");
    retained.request_close();
    let mut output = String::new();
    child
        .stdout
        .take()
        .expect("stdout")
        .read_to_string(&mut output)
        .expect("read");
    assert!(child.wait().expect("wait").success());
    assert_eq!(output, "initial\nsteer\n");
}

#[cfg(unix)]
#[test]
fn cancellation_interrupts_an_initial_frame_blocked_on_a_full_pipe() {
    use std::process::{Command, Stdio};
    let mut child = Command::new("/bin/cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("cat");
    let retained = Arc::new(RetainedAgentStdin::new(child.stdin.take().expect("stdin")));
    let pending_stdin = Arc::clone(&retained);
    let pending = std::thread::spawn(move || {
        pending_stdin.write_first_frame(&vec![b'x'; 4 * 1024 * 1024], deadline())
    });
    assert!(wait_until(Duration::from_secs(2), || retained
        .state
        .try_lock()
        .is_err()));
    let slot = AgentTaskInputSlot::new(
        Box::new(StdAgentTaskInput::new(Arc::clone(&retained))),
        None,
    );
    let started = Instant::now();
    slot.close(AgentTaskInputState::ClosedByStop);
    let result = pending.join().expect("writer");
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(
        result.expect_err("cancelled").kind(),
        io::ErrorKind::BrokenPipe
    );
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[cfg(unix)]
#[test]
fn waiting_for_initial_frame_does_not_extend_a_steer_deadline() {
    use std::process::{Command, Stdio};
    let mut child = Command::new("/bin/cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("cat");
    let retained = Arc::new(RetainedAgentStdin::new(child.stdin.take().expect("stdin")));
    let steer_stdin = Arc::clone(&retained);
    let started = Instant::now();
    let steer = std::thread::spawn(move || {
        steer_stdin.write_frame(b"steer\n", started + Duration::from_millis(100))
    });
    std::thread::sleep(Duration::from_millis(20));
    let initial_stdin = Arc::clone(&retained);
    let initial = std::thread::spawn(move || {
        initial_stdin.write_first_frame(&vec![b'x'; 4 * 1024 * 1024], deadline())
    });
    let outcome = steer.join().expect("steer");
    let elapsed = started.elapsed();
    retained.request_close();
    let _ = initial.join().expect("initial");
    let _ = child.kill();
    let _ = child.wait();
    assert_eq!(
        outcome.expect_err("deadline").kind(),
        io::ErrorKind::TimedOut
    );
    assert!(elapsed < Duration::from_secs(1));
}

#[test]
fn temporarily_not_steerable_keeps_the_input_open_for_a_later_message() {
    let slot = AgentTaskInputSlot::new(
        Box::new(RecordingWriter::failing(io::ErrorKind::WouldBlock)),
        None,
    );
    assert_eq!(
        slot.write(b"message", Instant::now() + Duration::from_secs(1), 32),
        Err(AgentTaskSteerRejection::NotSteerable)
    );
    assert_eq!(slot.state(), AgentTaskInputState::Open);
    assert_eq!(slot.frames_written(), 0);
}

#[test]
fn codex_input_cannot_be_sent_to_a_byte_writer() {
    use crate::agent_task_spawner::codex_app_server_protocol::UserInput;
    let slot = AgentTaskInputSlot::new(Box::new(RecordingWriter::new()), None);
    let input = AgentTaskInputFrame::CodexInput {
        input: vec![UserInput::Text {
            text: "hello".into(),
        }],
        client_user_message_id: Some("message-1".into()),
    };
    assert_eq!(slot.kind(), AgentTaskInputKind::Bytes);
    assert_eq!(
        slot.write_input(&input, Instant::now() + Duration::from_secs(1), 32),
        Err(AgentTaskSteerRejection::WriteFailed)
    );
    assert_eq!(slot.frames_written(), 0);
}

#[test]
fn background_failure_preserves_the_first_reason() {
    let slot = slot_with(RecordingWriter::new());
    assert_eq!(slot.background_failure(), None);
    slot.fail_background("background task tracking exceeded its limit");
    slot.fail_background("later failure");
    assert_eq!(
        slot.background_failure(),
        Some("background task tracking exceeded its limit")
    );
    assert_eq!(slot.state(), AgentTaskInputState::Open);
}

#[test]
fn stopping_input_preserves_background_failure_and_closes_once() {
    let writer = RecordingWriter::new();
    let closes = writer.closes();
    let slot = slot_with(writer);
    slot.fail_background("tracking failure");
    slot.close(AgentTaskInputState::ClosedByStop);
    slot.close(AgentTaskInputState::ClosedAfterResult);
    assert_eq!(slot.background_failure(), Some("tracking failure"));
    assert_eq!(slot.state(), AgentTaskInputState::ClosedByStop);
    assert_eq!(closes.load(Ordering::SeqCst), 1);
    assert_eq!(
        slot.write(b"late", deadline(), MAX_AGENT_STEERS_PER_TURN),
        Err(AgentTaskSteerRejection::Stopping)
    );
}

#[test]
fn background_failure_after_stop_does_not_reopen_input() {
    let slot = slot_with(RecordingWriter::new());
    slot.close(AgentTaskInputState::ClosedByStop);
    slot.fail_background("late failure");
    assert_eq!(slot.background_failure(), Some("late failure"));
    assert_eq!(slot.state(), AgentTaskInputState::ClosedByStop);
}

fn pending_question(provider: &str) -> crate::agent_questions::AgentQuestionRequest {
    serde_json::from_value(serde_json::json!({
        "id":"question-1", "taskId":"", "provider":provider,
        "questions":[{"id":"q", "header":"Choice", "prompt":"Which?",
            "options":[], "multiple":false, "allowCustom":true}], "status":"pending"
    }))
    .unwrap()
}

#[test]
fn pending_question_rejects_steering_without_writing_or_consuming_quota() {
    for provider in ["codex", "claudeCode"] {
        let questions = Arc::new(crate::agent_questions::AgentQuestionSession::new());
        let writer = RecordingWriter::new();
        let frames = writer.frames();
        let closes = writer.closes();
        let slot = AgentTaskInputSlot::new(Box::new(writer), Some(Arc::clone(&questions)));
        questions
            .register(pending_question(provider), Arc::new(|_| Ok(())))
            .unwrap();
        assert_eq!(
            slot.write(b"follow-up", deadline(), 1),
            Err(AgentTaskSteerRejection::NotSteerable)
        );
        assert!(frames.lock().unwrap().is_empty());
        assert_eq!(slot.frames_written(), 0);
        assert_eq!(slot.state(), AgentTaskInputState::Open);
        assert_eq!(closes.load(Ordering::SeqCst), 0);
        questions.cancel("question-1");
        slot.write(b"follow-up", deadline(), 1).unwrap();
        assert_eq!(*frames.lock().unwrap(), vec![b"follow-up".to_vec()]);
    }
}

#[test]
fn answering_question_keeps_steering_blocked_until_response_settles() {
    let questions = Arc::new(crate::agent_questions::AgentQuestionSession::new());
    let slot = Arc::new(AgentTaskInputSlot::new(
        Box::new(RecordingWriter::new()),
        Some(Arc::clone(&questions)),
    ));
    let pending_slot = Arc::clone(&slot);
    questions
        .register(
            pending_question("claudeCode"),
            Arc::new(move |_| {
                assert_eq!(
                    pending_slot.write(b"too soon", deadline(), 1),
                    Err(AgentTaskSteerRejection::NotSteerable)
                );
                Ok(())
            }),
        )
        .unwrap();
    questions
        .answer(
            "task",
            "question-1",
            crate::agent_questions::AgentQuestionResponse {
                answers: vec![crate::agent_questions::AgentQuestionAnswerItem {
                    question_id: "q".into(),
                    option_ids: vec![],
                    text: "Here".into(),
                }],
            },
        )
        .unwrap();
    slot.write(b"after answer", deadline(), 1).unwrap();
    assert_eq!(slot.frames_written(), 1);
}

#[test]
fn question_arriving_after_initial_admission_is_rechecked_with_writer_locked() {
    let questions = Arc::new(crate::agent_questions::AgentQuestionSession::new());
    let slot = AgentTaskInputSlot::new(
        Box::new(RecordingWriter::new()),
        Some(Arc::clone(&questions)),
    );
    slot.ensure_no_pending_question().unwrap();
    let writer = slot.writer.lock().unwrap();
    questions
        .register(pending_question("codex"), Arc::new(|_| Ok(())))
        .unwrap();
    let frame = AgentTaskInputFrame::Bytes(Arc::from(b"follow-up".as_slice()));
    assert_eq!(
        slot.write_input_locked(&frame, deadline(), 1, writer),
        Err(AgentTaskSteerRejection::NotSteerable)
    );
    assert_eq!(slot.frames_written(), 0);
    assert_eq!(slot.state(), AgentTaskInputState::Open);
}
