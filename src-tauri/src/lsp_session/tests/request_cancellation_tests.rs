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

impl BlockingCancelWriter {
    fn new() -> (Self, Arc<Mutex<Vec<u8>>>, Receiver<()>, BlockingWriterGate) {
        let capture = Arc::new(Mutex::new(Vec::new()));
        let (parked, parked_rx) = mpsc::channel();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        (
            Self {
                capture: Arc::clone(&capture),
                parked,
                gate: Arc::clone(&gate),
            },
            capture,
            parked_rx,
            BlockingWriterGate(gate),
        )
    }
}

impl Write for BlockingCancelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.capture
            .lock()
            .expect("blocking writer capture lock")
            .extend_from_slice(buf);
        if buf
            .windows(b"$/cancelRequest".len())
            .any(|window| window == b"$/cancelRequest")
        {
            let _ = self.parked.send(());
            let (released, condvar) = &*self.gate;
            let mut released = released.lock().expect("blocking writer gate lock");
            while !*released {
                released = condvar.wait(released).expect("blocking writer gate wait");
            }
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
    let (stdin, capture, write_parked, stdin_gate) = BlockingCancelWriter::new();
    let spawner = FakeSpawner::with_stdin(ready_script(), true, Box::new(stdin));
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

    let request_registry = Arc::clone(&registry);
    let request = std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace",
            41,
            "textDocument/completion",
            json!({ "marker": "pending" }),
        ))
    });
    let request_id = wait_for_captured_request_id(&capture, "textDocument/completion");
    assert_eq!(request_id, 41);

    let supervisor = registry
        .existing_supervisor("/tmp/workspace")
        .expect("workspace supervisor");
    let (_, pending_requests) = supervisor
        .session_request_parts()
        .expect("session request parts");
    let cancel_registry = Arc::clone(&registry);
    let (cancel_done, cancel_done_rx) = mpsc::channel();
    let cancel = std::thread::spawn(move || {
        cancel_registry.cancel_request("/tmp/workspace", request_id);
        let _ = cancel_done.send(());
    });

    write_parked
        .recv_timeout(Duration::from_secs(2))
        .expect("cancel write must park before pending lock acquisition");

    let (lock_acquired, lock_acquired_rx) = mpsc::channel();
    let lock_attempt = std::thread::spawn(move || {
        let guard = pending_requests
            .lock()
            .expect("pending requests lock while cancel write is parked");
        drop(guard);
        let _ = lock_acquired.send(());
    });
    let lock_was_free = lock_acquired_rx
        .recv_timeout(Duration::from_secs(2))
        .is_ok();

    stdin_gate.release();
    let cancel_completed = cancel_done_rx.recv_timeout(Duration::from_secs(2)).is_ok();
    if cancel_completed {
        cancel.join().expect("cancel thread");
    }
    if lock_acquired_rx
        .recv_timeout(Duration::from_secs(2))
        .is_ok()
        || lock_was_free
    {
        lock_attempt.join().expect("pending lock thread");
    }

    write_held_message(
        &held,
        json!({ "jsonrpc": "2.0", "id": request_id, "result": null }),
    );
    request
        .join()
        .expect("request thread")
        .expect("request result");

    assert!(
        lock_was_free,
        "pending requests lock must be acquirable while cancel stdin write is parked"
    );
    assert!(
        cancel_completed,
        "cancel thread must complete after the stdin gate is released"
    );
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

    let request_registry = Arc::clone(&registry);
    let request = std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_registry.send_request_async_with_id(
            "/tmp/workspace-b",
            41,
            "textDocument/completion",
            json!({ "marker": "pending" }),
        ))
    });
    let request_id = wait_for_captured_request_id(&capture_b, "textDocument/completion");
    assert_eq!(request_id, 41);

    registry.cancel_request("/tmp/workspace-b", request_id + 100);
    registry.cancel_request("/tmp/workspace-a", request_id);
    assert!(!captured_messages(&capture_a)
        .iter()
        .any(|message| message["method"] == "$/cancelRequest"));
    assert!(!captured_messages(&capture_b)
        .iter()
        .any(|message| message["method"] == "$/cancelRequest"));

    registry.cancel_request("/tmp/workspace-b", request_id);
    let cancellations = captured_messages(&capture_b)
        .into_iter()
        .filter(|message| message["method"] == "$/cancelRequest")
        .collect::<Vec<_>>();
    assert_eq!(
        cancellations,
        vec![json!({
            "jsonrpc": "2.0",
            "method": "$/cancelRequest",
            "params": { "id": request_id },
        })]
    );

    write_held_message(
        &held_b,
        json!({ "jsonrpc": "2.0", "id": request_id, "result": null }),
    );
    request
        .join()
        .expect("request thread")
        .expect("request result");
    registry.cancel_request("/tmp/workspace-b", request_id);
    assert_eq!(
        captured_messages(&capture_b)
            .iter()
            .filter(|message| message["method"] == "$/cancelRequest")
            .count(),
        1
    );
}
