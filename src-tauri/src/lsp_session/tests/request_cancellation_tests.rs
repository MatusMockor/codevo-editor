use super::super::{
    ExactSessionNotificationOutcome, ProjectResyncRequestOutcome, SharedProcessKiller,
};
use super::*;
use std::sync::Condvar;

struct BlockingWriterGate(Arc<(Mutex<bool>, Condvar)>);

impl BlockingWriterGate {
    fn release(&self) {
        let (released, condvar) = &*self.0;
        *released.lock().expect("blocking writer gate lock") = true;
        condvar.notify_all();
    }
}

struct BlockingCancelWriter {
    capture: Arc<Mutex<Vec<u8>>>,
    parked: Sender<()>,
    gate: Arc<(Mutex<bool>, Condvar)>,
}

struct BlockingNotificationWriter {
    parked: Sender<()>,
    gate: Arc<(Mutex<bool>, Condvar)>,
}

impl BlockingNotificationWriter {
    fn session() -> (
        Arc<super::super::session_writer::SessionMessageWriter>,
        Receiver<()>,
        BlockingWriterGate,
    ) {
        let (parked, parked_rx) = mpsc::channel();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let strategy = Arc::new(Self {
            parked,
            gate: Arc::clone(&gate),
        });
        (
            super::super::session_writer::SessionMessageWriter::from_strategy(
                Box::new(io::sink()),
                strategy,
            ),
            parked_rx,
            BlockingWriterGate(gate),
        )
    }
}

impl super::super::session_writer::MessageWriteStrategy for BlockingNotificationWriter {
    fn write_framed(
        &self,
        writer: &mut dyn Write,
        payload: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        writer.write_all(header.as_bytes())?;
        writer.write_all(payload)?;
        writer.flush()?;
        if payload
            .windows(b"workspace/didChangeWatchedFiles".len())
            .any(|window| window == b"workspace/didChangeWatchedFiles")
        {
            let _ = self.parked.send(());
            let (released, condvar) = &*self.gate;
            let mut released = released.lock().expect("blocking notification gate");
            while !*released {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "language-server stdin write timed out",
                    ));
                }
                let (next, wait) = condvar
                    .wait_timeout(released, remaining)
                    .expect("blocking notification wait");
                released = next;
                if wait.timed_out() && !*released {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "language-server stdin write timed out",
                    ));
                }
            }
        }
        Ok(())
    }
}

impl BlockingCancelWriter {
    fn session() -> BlockingCancelSession {
        let capture = Arc::new(Mutex::new(Vec::new()));
        let (parked, parked_rx) = mpsc::channel();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let strategy = Arc::new(Self {
            capture: Arc::clone(&capture),
            parked,
            gate: Arc::clone(&gate),
        });
        (
            super::super::session_writer::SessionMessageWriter::from_strategy(
                Box::new(io::sink()),
                strategy,
            ),
            capture,
            parked_rx,
            BlockingWriterGate(gate),
        )
    }
}

type BlockingCancelSession = (
    Arc<super::super::session_writer::SessionMessageWriter>,
    Arc<Mutex<Vec<u8>>>,
    Receiver<()>,
    BlockingWriterGate,
);

impl super::super::session_writer::MessageWriteStrategy for BlockingCancelWriter {
    fn write_framed(
        &self,
        _writer: &mut dyn Write,
        payload: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        write_message(
            &mut *self.capture.lock().expect("blocking writer capture lock"),
            payload,
        )?;
        if payload
            .windows(b"$/cancelRequest".len())
            .any(|window| window == b"$/cancelRequest")
        {
            let _ = self.parked.send(());
            let (released, condvar) = &*self.gate;
            let mut released = released.lock().expect("blocking writer gate lock");
            while !*released {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "cancellation write timed out",
                    ));
                }
                let (next, wait) = condvar
                    .wait_timeout(released, remaining)
                    .expect("blocking writer gate wait");
                released = next;
                if wait.timed_out() && !*released {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "cancellation write timed out",
                    ));
                }
            }
        }
        Ok(())
    }
}

struct FailingCancelWriter {
    capture: Arc<Mutex<Vec<u8>>>,
}

struct FailingCancellationFailureTaskSpawner;

impl super::super::request_dispatch::CancellationFailureTaskSpawner
    for FailingCancellationFailureTaskSpawner
{
    fn spawn(&self, _name: String, _task: Box<dyn FnOnce() + Send + 'static>) -> io::Result<()> {
        Err(io::Error::other("injected failure task spawn error"))
    }
}

struct CountingProcessKiller {
    terminate_count: Arc<AtomicUsize>,
}

impl ProcessKiller for CountingProcessKiller {
    fn terminate(&mut self) -> io::Result<()> {
        self.terminate_count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl Write for FailingCancelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.capture
            .lock()
            .expect("failing writer capture lock")
            .extend_from_slice(buf);
        if buf
            .windows(b"$/cancelRequest".len())
            .any(|window| window == b"$/cancelRequest")
        {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "cancel transport failed",
            ));
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn cancel_request_releases_pending_requests_lock_before_writing_to_stdin() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let (stdin, capture, write_parked, stdin_gate) = BlockingCancelWriter::session();
    let spawner = FakeSpawner::with_session_stdin(ready_script(), true, stdin);
    let held = Arc::clone(&spawner.held_writer);
    let (sink, _rx) = ChannelSink::new();

    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let session_id = running_session_id(&registry, "/tmp/workspace");

    let request_registry = Arc::clone(&registry);
    let (request_done, request_done_rx) = mpsc::channel();
    let request = std::thread::spawn(move || {
        let result = tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace",
            session_id,
            41,
            "textDocument/completion",
            json!({ "marker": "pending" }),
        ));
        let _ = request_done.send(result.clone());
        result
    });
    let wire_request_id = wait_for_captured_request_id(&capture, "textDocument/completion");

    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let (_, _, pending_requests, _) = supervisor
        .session_request_parts()
        .expect("session request parts");
    let cancel_started = Instant::now();
    registry
        .cancel_request("/tmp/workspace", session_id, 41)
        .expect("schedule cancellation");
    assert!(
        cancel_started.elapsed() < Duration::from_secs(1),
        "cancel command must not wait for the stdin writer"
    );

    write_parked
        .recv_timeout(Duration::from_secs(2))
        .expect("cancel write must run on the blocking pool");

    let lock_was_free = pending_requests.lock_is_available();
    let cancelled_request = request_done_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("removing the pending sender must release the waiting request");

    stdin_gate.release();

    drop(held);
    let joined_request = request.join().expect("request thread");
    assert_eq!(joined_request, cancelled_request);
    assert!(cancelled_request
        .expect_err("cancelled request must fail closed")
        .contains("cancelled"));

    assert!(
        lock_was_free,
        "pending requests lock must be acquirable while cancel stdin write is parked"
    );
    assert_ne!(wire_request_id, 41, "wire ids are backend-owned");
}

#[test]
fn cancellation_queue_bounds_sixty_four_parked_writes_and_restart_gets_fresh_transport() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let (stdin, _capture, write_parked, stdin_gate) = BlockingCancelWriter::session();
    let spawner = FakeSpawner::with_session_stdin(ready_script(), true, stdin);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let session_id = running_session_id(&registry, "/tmp/workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let (_, _, pending, cancellation_transport) = supervisor
        .session_request_parts()
        .expect("session request parts");
    let mut receivers = Vec::new();
    for offset in 0..super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        let (sender, receiver) = mpsc::channel();
        pending
            .admit(1_000 + offset, Some(offset + 1), sender)
            .expect("pending cancellation owner");
        receivers.push(receiver);
    }

    let started = Instant::now();
    for request_id in 1..=super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        registry
            .cancel_request("/tmp/workspace", session_id, request_id)
            .expect("bounded cancellation enqueue");
    }
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "sixty-four cancellations must never wait for the parked pipe"
    );
    write_parked
        .recv_timeout(Duration::from_secs(1))
        .expect("dedicated cancellation writer must own the parked write");
    assert!(receivers.iter().all(|receiver| {
        receiver.recv_timeout(Duration::from_millis(25))
            == Err(mpsc::RecvTimeoutError::Disconnected)
    }));

    let saturation = cancellation_transport
        .enqueue(9_999)
        .expect_err("the sixty-fifth outstanding write must fail closed");
    assert_eq!(saturation.kind(), io::ErrorKind::WouldBlock);
    wait_for_log(&supervisor, "cancellation queue capacity was reached");
    let deadline = Instant::now() + Duration::from_secs(1);
    while terminate_count.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        terminate_count.load(Ordering::SeqCst) > 0,
        "queue saturation must terminate the exact unhealthy transport"
    );

    registry.stop("/tmp/workspace");
    stdin_gate.release();
    let replacement_spawner = FakeSpawner::new(ready_script(), true);
    let (replacement_sink, _replacement_rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &replacement_spawner,
            replacement_sink,
            noop_diagnostics_sink(),
        )
        .expect("replacement gets an independent cancellation transport");
    assert_ne!(
        running_session_id(&registry, "/tmp/workspace"),
        session_id,
        "replacement must have fresh session authority"
    );
}

#[test]
fn cancellation_failure_task_spawn_error_synchronously_kills_the_exact_transport() {
    let (stdin, _capture, write_parked, stdin_gate) = BlockingCancelWriter::session();
    let terminate_count = Arc::new(AtomicUsize::new(0));
    let killer: SharedProcessKiller = Arc::new(Mutex::new(Some(Box::new(CountingProcessKiller {
        terminate_count: Arc::clone(&terminate_count),
    }))));
    let log = Arc::new(Mutex::new(String::new()));
    let transport =
        super::super::request_dispatch::CancellationTransport::start_with_failure_task_spawner(
            77,
            stdin,
            killer,
            Arc::clone(&log),
            "Test server",
            Arc::new(FailingCancellationFailureTaskSpawner),
        )
        .expect("start cancellation transport");

    for wire_request_id in 1..=super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        transport
            .enqueue(wire_request_id)
            .expect("fill bounded cancellation queue");
    }
    write_parked
        .recv_timeout(Duration::from_secs(1))
        .expect("first cancellation write must park");
    let error = transport
        .enqueue(10_000)
        .expect_err("queue saturation must schedule exact failure");
    assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        1,
        "failure-task spawn error must synchronously kill the exact transport"
    );
    assert!(
        log.lock()
            .expect("runtime log")
            .contains("failed to dispatch cancellation failure task"),
        "fallback failure must remain observable"
    );

    stdin_gate.release();
    transport.revoke();
}

#[test]
fn cancellation_failure_fallback_publication_finishes_before_replacement_reset() {
    let (stdin, _capture, write_parked, stdin_gate) = BlockingCancelWriter::session();
    let terminate_count = Arc::new(AtomicUsize::new(0));
    let killer: SharedProcessKiller = Arc::new(Mutex::new(Some(Box::new(CountingProcessKiller {
        terminate_count: Arc::clone(&terminate_count),
    }))));
    let log = Arc::new(Mutex::new(String::new()));
    let transport =
        super::super::request_dispatch::CancellationTransport::start_with_failure_task_spawner(
            78,
            stdin,
            killer,
            Arc::clone(&log),
            "Test server",
            Arc::new(FailingCancellationFailureTaskSpawner),
        )
        .expect("start cancellation transport");
    let (hook_entered_tx, hook_entered_rx) = mpsc::channel();
    let hook_gate = Arc::new((Mutex::new(false), Condvar::new()));
    let hook_gate_for_callback = Arc::clone(&hook_gate);
    transport.set_failure_after_check_hook(Arc::new(move || {
        hook_entered_tx.send(()).expect("signal fallback check");
        let (released, condvar) = &*hook_gate_for_callback;
        let mut released = released.lock().expect("fallback hook gate");
        while !*released {
            released = condvar.wait(released).expect("fallback hook wait");
        }
    }));

    for wire_request_id in 1..=super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        transport
            .enqueue(wire_request_id)
            .expect("fill bounded cancellation queue");
    }
    write_parked
        .recv_timeout(Duration::from_secs(1))
        .expect("first cancellation write must park");

    let failing_transport = Arc::clone(&transport);
    let saturation = std::thread::spawn(move || {
        failing_transport
            .enqueue(10_001)
            .expect_err("queue saturation must enter fallback")
    });
    hook_entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("fallback must pause after its generation check");

    let revoking_transport = Arc::clone(&transport);
    let (revoke_done_tx, revoke_done_rx) = mpsc::channel();
    let revoke = std::thread::spawn(move || {
        revoking_transport.revoke();
        revoke_done_tx.send(()).expect("signal revoke completion");
    });
    stdin_gate.release();
    assert_eq!(
        revoke_done_rx.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout),
        "replacement revoke/reset must wait behind the old fallback publication"
    );

    let (released, condvar) = &*hook_gate;
    *released.lock().expect("release fallback hook") = true;
    condvar.notify_all();
    assert_eq!(
        saturation.join().expect("saturation thread").kind(),
        io::ErrorKind::WouldBlock
    );
    revoke.join().expect("revoke thread");
    revoke_done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("revoke must complete after fallback publication");

    *log.lock().expect("replacement telemetry reset") = "replacement telemetry".to_string();
    assert_eq!(
        log.lock().expect("runtime log").as_str(),
        "replacement telemetry",
        "old fallback publication must finish before replacement telemetry resets"
    );
    assert_eq!(terminate_count.load(Ordering::SeqCst), 1);
}

#[test]
fn hung_cancellation_write_times_out_and_reaps_only_its_exact_transport() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let (stdin, _capture, write_parked, stdin_gate) = BlockingCancelWriter::session();
    let spawner = FakeSpawner::with_session_stdin(ready_script(), true, stdin);
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let session_id = running_session_id(&registry, "/tmp/workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let (_, _, pending, _) = supervisor
        .session_request_parts()
        .expect("session request parts");
    let (sender, receiver) = mpsc::channel();
    pending
        .admit(1_000, Some(1), sender)
        .expect("pending cancellation owner");

    registry
        .cancel_request("/tmp/workspace", session_id, 1)
        .expect("enqueue cancellation");
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(1)),
        Err(mpsc::RecvTimeoutError::Disconnected),
        "local waiter must be released before the wire timeout"
    );
    write_parked
        .recv_timeout(Duration::from_secs(1))
        .expect("wire write must park");
    wait_for_log(&supervisor, "cancellation write timed out");
    let deadline = Instant::now() + Duration::from_secs(1);
    while terminate_count.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        terminate_count.load(Ordering::SeqCst) > 0,
        "watchdog must terminate the exact hung transport"
    );

    stdin_gate.release();
    registry.stop("/tmp/workspace");
}

#[test]
fn cancel_request_only_notifies_the_owning_workspace_for_a_pending_id() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let spawner_a = FakeSpawner::new(ready_script(), true);
    let spawner_b = FakeSpawner::new(ready_script(), true);
    let capture_a = Arc::clone(&spawner_a.stdin_capture);
    let capture_b = Arc::clone(&spawner_b.stdin_capture);
    let held_b = Arc::clone(&spawner_b.held_writer);
    let (sink_a, _rx_a) = ChannelSink::new();
    let (sink_b, _rx_b) = ChannelSink::new();

    registry
        .start(
            "/tmp/workspace-a",
            &command(),
            &initialize_request(),
            &spawner_a,
            sink_a,
            noop_diagnostics_sink(),
        )
        .expect("start workspace a");
    registry
        .start(
            "/tmp/workspace-b",
            &command(),
            &initialize_request(),
            &spawner_b,
            sink_b,
            noop_diagnostics_sink(),
        )
        .expect("start workspace b");
    let session_a = running_session_id(&registry, "/tmp/workspace-a");
    let session_b = running_session_id(&registry, "/tmp/workspace-b");

    let request_registry = Arc::clone(&registry);
    let request = std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace-b",
            session_b,
            41,
            "textDocument/completion",
            json!({ "marker": "pending" }),
        ))
    });
    let wire_request_id = wait_for_captured_request_id(&capture_b, "textDocument/completion");

    registry
        .cancel_request("/tmp/workspace-b", session_b, 42)
        .expect("unknown request is a no-op");
    registry
        .cancel_request("/tmp/workspace-a", session_a, 41)
        .expect("foreign workspace request is a no-op");
    assert!(!captured_messages(&capture_a)
        .iter()
        .any(|message| message["method"] == "$/cancelRequest"));
    assert!(!captured_messages(&capture_b)
        .iter()
        .any(|message| message["method"] == "$/cancelRequest"));

    registry
        .cancel_request("/tmp/workspace-b", session_b, 41)
        .expect("cancel exact workspace request");
    wait_for_captured_method(&capture_b, "$/cancelRequest");
    let cancellations = captured_messages(&capture_b)
        .into_iter()
        .filter(|message| message["method"] == "$/cancelRequest")
        .collect::<Vec<_>>();
    assert_eq!(
        cancellations,
        vec![json!({
            "jsonrpc": "2.0",
            "method": "$/cancelRequest",
            "params": { "id": wire_request_id },
        })]
    );

    assert!(request
        .join()
        .expect("request thread")
        .expect_err("cancelled request must fail closed")
        .contains("cancelled"));
    write_held_message(
        &held_b,
        json!({ "jsonrpc": "2.0", "id": wire_request_id, "result": null }),
    );
    registry
        .cancel_request("/tmp/workspace-b", session_b, 41)
        .expect("repeat cancel is a no-op");
    assert_eq!(
        captured_messages(&capture_b)
            .iter()
            .filter(|message| message["method"] == "$/cancelRequest")
            .count(),
        1
    );
}

#[test]
fn cancel_transport_failure_is_observed_and_marks_the_exact_session_unhealthy() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let capture = Arc::new(Mutex::new(Vec::new()));
    let spawner = FakeSpawner::with_stdin(
        ready_script(),
        true,
        Box::new(FailingCancelWriter {
            capture: Arc::clone(&capture),
        }),
    );
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, _rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let session_id = running_session_id(&registry, "/tmp/workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let request_registry = Arc::clone(&registry);
    let request = std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace",
            session_id,
            41,
            "textDocument/completion",
            json!({ "marker": "pending" }),
        ))
    });
    wait_for_captured_request_id(&capture, "textDocument/completion");

    registry
        .cancel_request("/tmp/workspace", session_id, 41)
        .expect("schedule cancellation");
    assert!(request
        .join()
        .expect("request thread")
        .expect_err("cancelled request must fail closed")
        .contains("cancelled"));
    wait_for_log(&supervisor, "cancellation transport failed");

    let deadline = Instant::now() + Duration::from_secs(2);
    while terminate_count.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        terminate_count.load(Ordering::SeqCst) > 0,
        "failed cancellation write must terminate the unhealthy transport"
    );
}

#[test]
fn pending_request_capacity_rejects_the_next_request_without_evicting_an_owner() {
    let pending = super::super::PendingRequestRegistry::new();
    let mut receivers = Vec::new();
    let (zero_sender, _zero_receiver) = mpsc::channel();
    assert_eq!(
        pending.admit(9_999, Some(0), zero_sender),
        Err(super::super::PendingRequestAdmissionError::InvalidRequestId)
    );

    for request_id in 0..super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        let (sender, receiver) = mpsc::channel();
        pending
            .admit(request_id, None, sender)
            .expect("request below the cap must be admitted");
        receivers.push(receiver);
    }

    let (overflow_sender, _overflow_receiver) = mpsc::channel();
    assert_eq!(
        pending.admit(
            super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64,
            None,
            overflow_sender
        ),
        Err(
            super::super::PendingRequestAdmissionError::CapacityExceeded {
                capacity: super::super::MAX_PENDING_REQUESTS_PER_SESSION,
            }
        )
    );
    assert_eq!(
        pending.len(),
        super::super::MAX_PENDING_REQUESTS_PER_SESSION
    );
    assert!(receivers
        .iter()
        .all(|receiver| receiver.try_recv() == Err(mpsc::TryRecvError::Empty)));
}

#[test]
fn full_pending_request_registry_rejects_before_writing_or_waiting_for_the_server() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    let spawner = FakeSpawner::new(ready_script(), true);
    let capture = Arc::clone(&spawner.stdin_capture);
    let (sink, _rx) = ChannelSink::new();

    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        )
        .expect("start workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let (session_id, _, pending, _) = supervisor
        .session_request_parts()
        .expect("session request parts");
    let mut receivers = Vec::new();
    for request_id in 0..super::super::MAX_PENDING_REQUESTS_PER_SESSION as u64 {
        let (sender, receiver) = mpsc::channel();
        pending
            .admit(10_000 + request_id, None, sender)
            .expect("request below the cap must be admitted");
        receivers.push(receiver);
    }

    let started = Instant::now();
    let error = supervisor
        .send_request_with_id(
            session_id,
            1_000,
            "textDocument/completion",
            json!({ "marker": "must-not-be-written" }),
        )
        .expect_err("request above the cap must fail");

    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(
        error.to_string(),
        format!(
            "Language server pending request capacity ({}) was reached.",
            super::super::MAX_PENDING_REQUESTS_PER_SESSION
        )
    );
    assert!(!captured_messages(&capture)
        .iter()
        .any(|message| message["params"]["marker"] == "must-not-be-written"));
    assert_eq!(
        pending.len(),
        super::super::MAX_PENDING_REQUESTS_PER_SESSION
    );
    drop(receivers);
}

#[test]
fn cancelled_request_late_response_is_unmatched_and_cannot_revive_it() {
    let pending = Arc::new(super::super::PendingRequestRegistry::new());
    let (sender, receiver) = mpsc::channel();
    pending
        .admit(10, Some(41), sender)
        .expect("request must be admitted");

    assert_eq!(
        pending.cancel(41),
        super::super::PendingRequestCancellationReceipt::Cancelled {
            wire_request_id: 10,
        }
    );
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(1)),
        Err(mpsc::RecvTimeoutError::Disconnected)
    );
    assert_eq!(
        pending.route_response(&json!({
            "jsonrpc": "2.0",
            "id": 10,
            "result": { "late": true }
        })),
        super::super::PendingResponseReceipt::Unmatched
    );
    assert_eq!(pending.len(), 0);

    let (reused_sender, _reused_receiver) = mpsc::channel();
    assert_eq!(
        pending.admit(11, Some(41), reused_sender),
        Err(
            super::super::PendingRequestAdmissionError::RequestIdNotMonotonic {
                previous: 41,
                received: 41,
            }
        )
    );

    let (new_sender, new_receiver) = mpsc::channel();
    pending
        .admit(12, Some(42), new_sender)
        .expect("newer client authority must be admitted");
    assert_eq!(
        pending.cancel(41),
        super::super::PendingRequestCancellationReceipt::NotPending
    );
    assert_eq!(
        new_receiver.try_recv(),
        Err(mpsc::TryRecvError::Empty),
        "a delayed old cancellation must not cancel the newer request"
    );
}

#[test]
fn cancellation_receipt_is_scoped_to_the_exact_session_registry() {
    let pending_a = super::super::PendingRequestRegistry::new();
    let pending_b = super::super::PendingRequestRegistry::new();
    let (sender, receiver) = mpsc::channel();
    pending_a
        .admit(10, Some(41), sender)
        .expect("workspace A request must be admitted");

    assert_eq!(
        pending_b.cancel(41),
        super::super::PendingRequestCancellationReceipt::NotPending
    );
    assert_eq!(receiver.try_recv(), Err(mpsc::TryRecvError::Empty));
    assert_eq!(pending_a.len(), 1);
    assert_eq!(pending_b.len(), 0);
}

#[test]
fn closed_old_session_registry_rejects_a_request_parked_before_replacement() {
    let old_pending = Arc::new(super::super::PendingRequestRegistry::new());
    let parked_pending = Arc::clone(&old_pending);
    let (release, release_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let parked = std::thread::spawn(move || {
        release_rx.recv().expect("release parked admission");
        let (sender, _receiver) = mpsc::channel();
        let _ = result_tx.send(parked_pending.admit(10, Some(41), sender));
    });

    old_pending.close_and_reject("old session closed");
    release.send(()).expect("release admission");
    assert_eq!(
        result_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("closed admission must settle promptly"),
        Err(super::super::PendingRequestAdmissionError::SessionClosed {
            message: "old session closed".to_string(),
        })
    );
    parked.join().expect("parked admission thread");

    let replacement_pending = super::super::PendingRequestRegistry::new();
    let (sender, receiver) = mpsc::channel();
    replacement_pending
        .admit(11, Some(41), sender)
        .expect("replacement session has independent authority");
    assert_eq!(receiver.try_recv(), Err(mpsc::TryRecvError::Empty));
}

#[test]
fn stale_session_cancel_cannot_target_replacement_after_root_a_b_a() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let spawner_a1 = FakeSpawner::new(ready_script(), true);
    let spawner_b = FakeSpawner::new(ready_script(), true);
    let (sink_a1, _rx_a1) = ChannelSink::new();
    let (sink_b, _rx_b) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace-a",
            &command(),
            &initialize_request(),
            &spawner_a1,
            sink_a1,
            noop_diagnostics_sink(),
        )
        .expect("start workspace A generation one");
    let old_session_a = running_session_id(&registry, "/tmp/workspace-a");
    registry
        .start(
            "/tmp/workspace-b",
            &command(),
            &initialize_request(),
            &spawner_b,
            sink_b,
            noop_diagnostics_sink(),
        )
        .expect("start workspace B");
    let session_b = running_session_id(&registry, "/tmp/workspace-b");
    assert_ne!(old_session_a, session_b);

    registry.stop("/tmp/workspace-a");
    let spawner_a2 = FakeSpawner::new(ready_script(), true);
    let capture_a2 = Arc::clone(&spawner_a2.stdin_capture);
    let held_a2 = Arc::clone(&spawner_a2.held_writer);
    let (sink_a2, _rx_a2) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace-a",
            &command(),
            &initialize_request(),
            &spawner_a2,
            sink_a2,
            noop_diagnostics_sink(),
        )
        .expect("restart workspace A");
    let replacement_session_a = running_session_id(&registry, "/tmp/workspace-a");
    assert_ne!(old_session_a, replacement_session_a);
    assert_ne!(session_b, replacement_session_a);

    let request_registry = Arc::clone(&registry);
    let request = std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace-a",
            replacement_session_a,
            41,
            "textDocument/completion",
            json!({ "marker": "replacement" }),
        ))
    });
    let wire_request_id = wait_for_captured_request_id(&capture_a2, "textDocument/completion");

    assert!(registry
        .cancel_request("/tmp/workspace-a", old_session_a, 41)
        .expect_err("old session authority must fail closed")
        .contains("no longer active"));
    assert!(!captured_messages(&capture_a2)
        .iter()
        .any(|message| message["method"] == "$/cancelRequest"));

    write_held_message(
        &held_a2,
        json!({ "jsonrpc": "2.0", "id": wire_request_id, "result": null }),
    );
    request
        .join()
        .expect("replacement request thread")
        .expect("replacement request must remain active");
}

#[test]
fn project_resync_restarts_only_the_exact_session_and_reports_stale_authority() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, rx) = ChannelSink::new();
    registry
        .start_with_auto_restart(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            LanguageServerEventSinks::new(
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            test_restart_controller(),
        )
        .expect("start exact resync session");
    wait_for(&rx, &running_status());
    let old_session = running_session_id(&registry, "/tmp/workspace");

    assert_eq!(
        registry
            .request_project_resync("/tmp/workspace", old_session)
            .expect("request exact project resync"),
        ProjectResyncRequestOutcome::Admitted
    );
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Running {
            session_id: old_session + 1,
            capabilities: LanguageServerCapabilities::default(),
        },
    );
    let replacement_session = running_session_id(&registry, "/tmp/workspace");
    assert_ne!(old_session, replacement_session);
    let termination_count_after_restart = terminate_count.load(Ordering::SeqCst);

    assert_eq!(
        registry
            .request_project_resync("/tmp/workspace", old_session)
            .expect("stale project resync outcome"),
        ProjectResyncRequestOutcome::SupersededByFreshSession
    );
    std::thread::sleep(Duration::from_millis(25));
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        termination_count_after_restart,
        "stale resync authority must not terminate the replacement"
    );
    assert_eq!(
        registry.status("/tmp/workspace"),
        LanguageServerRuntimeStatus::Running {
            session_id: replacement_session,
            capabilities: LanguageServerCapabilities::default(),
        }
    );
    assert_eq!(
        registry
            .request_project_resync("/tmp/missing-workspace", old_session)
            .expect("missing project resync outcome"),
        ProjectResyncRequestOutcome::Unavailable
    );
}

#[test]
fn blocked_exact_notification_times_out_restarts_and_cannot_target_replacement() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let (stdin, write_parked, stdin_gate) = BlockingNotificationWriter::session();
    let spawner = Arc::new(FakeSpawner::with_session_stdin(ready_script(), true, stdin));
    let terminate_count = Arc::clone(&spawner.terminate_count);
    let (sink, rx) = ChannelSink::new();
    registry
        .start_with_auto_restart(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
            LanguageServerEventSinks::new(
                sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
            ),
            test_restart_controller(),
        )
        .expect("start exact notification session");
    wait_for(&rx, &running_status());
    let old_session = running_session_id(&registry, "/tmp/workspace");
    let notification = JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "workspace/didChangeWatchedFiles".to_string(),
        params: json!({ "changes": [] }),
    };

    let notification_registry = Arc::clone(&registry);
    let notification_for_thread = JsonRpcNotification {
        jsonrpc: notification.jsonrpc.clone(),
        method: notification.method.clone(),
        params: notification.params.clone(),
    };
    let delivery = std::thread::spawn(move || {
        notification_registry.send_notification_for_session_outcome(
            "/tmp/workspace",
            old_session,
            &notification_for_thread,
        )
    });
    write_parked
        .recv_timeout(Duration::from_secs(1))
        .expect("notification write must park");
    let error = delivery
        .join()
        .expect("notification delivery thread")
        .expect_err("hung notification must time out");
    assert!(error.contains("timed out"));
    wait_for(
        &rx,
        &LanguageServerRuntimeStatus::Running {
            session_id: old_session + 1,
            capabilities: LanguageServerCapabilities::default(),
        },
    );
    let replacement_session = running_session_id(&registry, "/tmp/workspace");
    let termination_count_after_restart = terminate_count.load(Ordering::SeqCst);

    assert_eq!(
        registry
            .send_notification_for_session_outcome("/tmp/workspace", old_session, &notification,)
            .expect("stale notification outcome"),
        ExactSessionNotificationOutcome::Stale
    );
    assert_eq!(
        registry
            .send_notification_for_session_outcome(
                "/tmp/workspace",
                replacement_session,
                &notification,
            )
            .expect("replacement notification outcome"),
        ExactSessionNotificationOutcome::Admitted
    );
    assert_eq!(
        terminate_count.load(Ordering::SeqCst),
        termination_count_after_restart,
        "stale notification must not terminate the replacement"
    );

    stdin_gate.release();
}

#[test]
fn old_session_completion_cannot_publish_telemetry_after_replacement_reset() {
    let registry = LanguageServerRegistry::new_with_label("Test server");
    let first_spawner = FakeSpawner::new(ready_script(), true);
    let (first_sink, _first_rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &first_spawner,
            first_sink,
            noop_diagnostics_sink(),
        )
        .expect("start first session");
    let old_session = running_session_id(&registry, "/tmp/workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    supervisor.force_status(LanguageServerRuntimeStatus::Crashed {
        message: "replace".to_string(),
    });

    let replacement_spawner = FakeSpawner::new(ready_script(), true);
    let (replacement_sink, _replacement_rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &replacement_spawner,
            replacement_sink,
            noop_diagnostics_sink(),
        )
        .expect("start replacement session");
    let replacement_session = running_session_id(&registry, "/tmp/workspace");
    assert_ne!(old_session, replacement_session);
    assert!(supervisor.recent_requests().is_empty());

    supervisor.record_request_outcome_for_session(
        old_session,
        "textDocument/completion",
        Instant::now(),
        false,
    );
    assert!(
        supervisor.recent_requests().is_empty(),
        "old session completion must not repopulate reset telemetry"
    );
    supervisor.record_request_outcome_for_session(
        replacement_session,
        "textDocument/completion",
        Instant::now(),
        true,
    );
    assert_eq!(supervisor.recent_requests().len(), 1);
}

#[test]
fn replacement_reset_is_atomic_with_an_old_telemetry_completion_after_its_generation_check() {
    let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
    let first_spawner = FakeSpawner::new(ready_script(), true);
    let (first_sink, _first_rx) = ChannelSink::new();
    registry
        .start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &first_spawner,
            first_sink,
            noop_diagnostics_sink(),
        )
        .expect("start first session");
    let old_session = running_session_id(&registry, "/tmp/workspace");
    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    supervisor.force_status(LanguageServerRuntimeStatus::Crashed {
        message: "replace".to_string(),
    });

    let (checked_tx, checked_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let recording_supervisor = Arc::clone(&supervisor);
    let recording = std::thread::spawn(move || {
        recording_supervisor.record_request_outcome_for_session_after_check(
            old_session,
            "textDocument/definition",
            Instant::now(),
            true,
            || {
                checked_tx.send(()).expect("signal generation check");
                release_rx.recv().expect("release telemetry record");
            },
        );
    });
    checked_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("old completion must pass its generation check");

    let replacement_registry = Arc::clone(&registry);
    let (replacement_done_tx, replacement_done_rx) = mpsc::channel();
    let replacement = std::thread::spawn(move || {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let result = replacement_registry.start(
            "/tmp/workspace",
            &command(),
            &initialize_request(),
            &spawner,
            sink,
            noop_diagnostics_sink(),
        );
        replacement_done_tx
            .send(result)
            .expect("publish replacement result");
    });
    assert_eq!(
        replacement_done_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty),
        "replacement must wait for the generation-owned telemetry publication"
    );

    release_tx.send(()).expect("release old telemetry record");
    recording.join().expect("telemetry recording thread");
    replacement.join().expect("replacement thread");
    replacement_done_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("replacement result")
        .expect("replacement must start");

    assert!(
        supervisor.recent_requests().is_empty(),
        "replacement reset must clear the old completion even when replacement interleaves after its check"
    );
}

fn running_session_id(registry: &LanguageServerRegistry, root_path: &str) -> u64 {
    match registry.status(root_path) {
        LanguageServerRuntimeStatus::Running { session_id, .. } => session_id,
        status => panic!("expected running session for {root_path}, got {status:?}"),
    }
}

fn wait_for_captured_method(capture: &Arc<Mutex<Vec<u8>>>, method: &str) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if captured_messages(capture)
            .iter()
            .any(|message| message["method"] == method)
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("expected captured method {method}");
}
