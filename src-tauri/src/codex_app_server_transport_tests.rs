use super::*;
use serde_json::json;
use std::io::{pipe, BufReader, PipeReader, PipeWriter};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_INTERVAL: Duration = Duration::from_millis(5);

struct DecliningHandler;

impl CodexServerRequestHandler for DecliningHandler {
    fn decline(&self, method: &str, _params: &Value) -> Option<Value> {
        match method {
            "execCommandApproval" => Some(json!({ "decision": "denied" })),
            _ => None,
        }
    }
}

struct Harness {
    transport: CodexAppServerTransport,
    server_writer: Mutex<Option<PipeWriter>>,
    client_lines: Arc<Mutex<Vec<String>>>,
    _retained_reader: Mutex<Option<PipeReader>>,
}

impl Harness {
    fn new(drain_client_output: bool) -> Self {
        let (client_output, server_writer) = pipe().expect("server to client pipe");
        let (server_reader, client_input) = pipe().expect("client to server pipe");
        let transport = CodexAppServerTransport::connect(
            CodexAppServerStreams {
                input: Box::new(client_input),
                output: Box::new(client_output),
            },
            Arc::new(DecliningHandler),
        );
        let client_lines = Arc::new(Mutex::new(Vec::new()));
        let mut retained_reader = None;
        match drain_client_output {
            true => {
                let collected = Arc::clone(&client_lines);
                thread::spawn(move || {
                    let mut reader = BufReader::new(server_reader);
                    let mut line = String::new();
                    loop {
                        line.clear();
                        match reader.read_line(&mut line) {
                            Ok(0) | Err(_) => return,
                            Ok(_) => collected
                                .lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .push(line.trim_end().to_string()),
                        }
                    }
                });
            }
            false => retained_reader = Some(server_reader),
        }
        Self {
            transport,
            server_writer: Mutex::new(Some(server_writer)),
            client_lines,
            _retained_reader: Mutex::new(retained_reader),
        }
    }

    fn emit(&self, frame: &Value) {
        self.emit_bytes(format!("{frame}\n").as_bytes());
    }

    fn emit_bytes(&self, bytes: &[u8]) {
        let mut writer = self
            .server_writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let handle = writer.as_mut().expect("server writer");
        handle.write_all(bytes).expect("emit frame");
        handle.flush().expect("flush frame");
    }

    fn close_server(&self) {
        self.server_writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }

    fn client_line(&self, index: usize) -> Option<Value> {
        let lines = self
            .client_lines
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let line = lines.get(index)?;
        serde_json::from_str(line.as_str()).ok()
    }
}

fn wait_for<T>(mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if let Some(value) = probe() {
            return value;
        }
        assert!(Instant::now() < deadline, "condition never became true");
        thread::sleep(PROBE_INTERVAL);
    }
}

fn item_started(thread_id: &str, item_id: &str) -> Value {
    json!({
        "method": "item/started",
        "params": {
            "threadId": thread_id,
            "item": { "type": "webSearch", "id": item_id, "query": "rust" },
        },
        "emittedAtMs": 1_726_000_000_000u64,
    })
}

#[test]
fn frames_split_at_arbitrary_byte_boundaries_reassemble() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let first = format!("{}\n", item_started("thread-1", "item-1"));
    let second = format!("{}\n", item_started("thread-1", "item-2"));
    let joined = format!("{first}{second}");
    for byte in joined.as_bytes() {
        harness.emit_bytes(&[*byte]);
    }
    let mut seen = Vec::new();
    for _ in 0..2 {
        let frame = frames
            .recv_timeout(PROBE_TIMEOUT)
            .expect("split frame delivered");
        seen.push(frame);
    }
    assert_eq!(seen.len(), 2);
    assert!(matches!(
        seen[0],
        TurnFrame::Notification(ref notification) if matches!(**notification, ServerNotification::ItemStarted(_))
    ));
    assert!(harness.transport.failure().is_none());
}

#[test]
fn two_frames_in_one_write_both_dispatch() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let batch = format!(
        "{}\n{}\n",
        item_started("thread-1", "item-1"),
        item_started("thread-1", "item-2")
    );
    harness.emit_bytes(batch.as_bytes());
    for _ in 0..2 {
        frames
            .recv_timeout(PROBE_TIMEOUT)
            .expect("batched frame delivered");
    }
}

#[test]
fn oversized_line_is_fatal_for_the_host() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let mut oversized = Vec::with_capacity(MAX_APP_SERVER_LINE_BYTES + 16);
    oversized.extend(std::iter::repeat_n(b'x', MAX_APP_SERVER_LINE_BYTES + 8));
    oversized.push(b'\n');
    harness.emit_bytes(oversized.as_slice());
    let failure = wait_for(|| harness.transport.failure());
    assert_eq!(failure, APP_SERVER_LINE_LIMIT_ERROR);
    assert_eq!(
        frames.recv_timeout(PROBE_TIMEOUT),
        Err(TurnFrameRecvError::Closed {
            reason: APP_SERVER_LINE_LIMIT_ERROR.to_string(),
        })
    );
}

#[test]
fn unknown_notification_is_counted_and_never_fatal() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({
        "method": "thread/somethingBrandNew",
        "params": { "threadId": "thread-1" },
    }));
    let frame = frames
        .recv_timeout(PROBE_TIMEOUT)
        .expect("unknown frame routed");
    assert_eq!(
        frame,
        TurnFrame::UnknownFrame {
            method: "thread/somethingBrandNew".to_string(),
        }
    );
    assert!(harness.transport.failure().is_none());
    assert_eq!(harness.transport.stats().unknown_frames, 1);
}

#[test]
fn undecodable_envelope_is_counted_and_never_fatal() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({
        "jsonrpc": "2.0",
        "method": "item/started",
        "params": { "threadId": "thread-1" },
        "futureEnvelopeKey": { "nested": true },
    }));
    let frame = frames
        .recv_timeout(PROBE_TIMEOUT)
        .expect("undecodable frame routed");
    assert_eq!(
        frame,
        TurnFrame::UnknownFrame {
            method: "item/started".to_string(),
        }
    );
    assert!(harness.transport.failure().is_none());
    assert_eq!(harness.transport.stats().undecodable_frames, 1);
}

#[test]
fn ignored_notifications_never_reach_a_turn() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({
        "method": "item/agentMessage/delta",
        "params": { "threadId": "thread-1", "delta": "hi" },
    }));
    harness.emit(&item_started("thread-1", "item-1"));
    let frame = frames.recv_timeout(PROBE_TIMEOUT).expect("frame delivered");
    assert!(matches!(
        frame,
        TurnFrame::Notification(ref notification) if matches!(**notification, ServerNotification::ItemStarted(_))
    ));
}

#[test]
fn unknown_server_request_is_answered_with_method_not_found() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({
        "id": 7,
        "method": "future/serverRequest",
        "params": { "threadId": "thread-1" },
    }));
    let answer = wait_for(|| harness.client_line(0));
    assert_eq!(answer["id"], json!(7));
    assert_eq!(answer["error"]["code"], json!(JSON_RPC_METHOD_NOT_FOUND));
    assert_eq!(
        frames.recv_timeout(PROBE_TIMEOUT),
        Ok(TurnFrame::UnknownFrame {
            method: "future/serverRequest".to_string(),
        })
    );
    assert!(harness.transport.failure().is_none());
}

#[test]
fn declined_server_request_is_answered_and_projected() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({
        "id": "abc",
        "method": "execCommandApproval",
        "params": { "conversationId": "thread-1", "command": ["rm", "-rf"] },
    }));
    let answer = wait_for(|| harness.client_line(0));
    assert_eq!(answer["id"], json!("abc"));
    assert_eq!(answer["result"], json!({ "decision": "denied" }));
    assert_eq!(
        frames.recv_timeout(PROBE_TIMEOUT),
        Ok(TurnFrame::ServerRequestDeclined {
            method: "execCommandApproval".to_string(),
        })
    );
}

#[test]
fn interleaved_responses_correlate_by_id() {
    let harness = Harness::new(true);
    let transport = &harness.transport;
    thread::scope(|scope| {
        let first = scope.spawn(|| {
            transport.request(
                ClientMethod::ThreadStart,
                json!({ "cwd": "/tmp" }),
                PROBE_TIMEOUT,
            )
        });
        let second = scope.spawn(|| {
            transport.request(
                ClientMethod::TurnStart,
                json!({ "threadId": "thread-1", "input": [] }),
                PROBE_TIMEOUT,
            )
        });
        let mut ids = Vec::new();
        wait_for(|| {
            let lines = harness
                .client_lines
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            match lines.len() >= 2 {
                true => Some(()),
                false => None,
            }
        });
        for index in 0..2 {
            let line = harness.client_line(index).expect("request line");
            ids.push((
                line["id"].as_u64().expect("request id"),
                line["method"].as_str().expect("method").to_string(),
            ));
        }
        for (id, method) in ids.iter().rev() {
            harness.emit(&json!({ "id": id, "result": { "echo": method } }));
        }
        let first = first.join().expect("first request").expect("first result");
        let second = second
            .join()
            .expect("second request")
            .expect("second result");
        let mut results = [
            first["echo"].as_str().unwrap_or_default().to_string(),
            second["echo"].as_str().unwrap_or_default().to_string(),
        ];
        results.sort();
        assert_eq!(results, ["thread/start", "turn/start"]);
    });
}

#[test]
fn request_timeout_removes_the_pending_entry_and_discards_a_late_response() {
    let harness = Harness::new(true);
    let outcome = harness.transport.request(
        ClientMethod::Initialize,
        json!({ "clientInfo": { "name": "codevo", "version": "1" } }),
        Duration::from_millis(60),
    );
    assert_eq!(outcome, Err(CodexRpcFailure::Timeout));
    assert_eq!(harness.transport.pending_requests(), 0);
    let request = wait_for(|| harness.client_line(0));
    let id = request["id"].as_u64().expect("request id");
    harness.emit(&json!({ "id": id, "result": { "late": true } }));
    let late = wait_for(|| match harness.transport.stats().late_responses {
        0 => None,
        count => Some(count),
    });
    assert_eq!(late, 1);
    assert!(harness.transport.failure().is_none());
}

#[test]
fn rpc_error_response_surfaces_as_an_rpc_failure() {
    let harness = Harness::new(true);
    let transport = &harness.transport;
    thread::scope(|scope| {
        let request = scope.spawn(|| {
            transport.request(
                ClientMethod::TurnSteer,
                json!({ "threadId": "thread-1", "expectedTurnId": "turn-1", "input": [] }),
                PROBE_TIMEOUT,
            )
        });
        let line = wait_for(|| harness.client_line(0));
        let id = line["id"].as_u64().expect("request id");
        harness.emit(&json!({
            "id": id,
            "error": { "code": -32000, "message": "not steerable", "data": { "activeTurnNotSteerable": {} } },
        }));
        let outcome = request.join().expect("request thread");
        let Err(CodexRpcFailure::Rpc(error)) = outcome else {
            panic!("expected an rpc failure, got {outcome:?}");
        };
        assert_eq!(error.code, -32000);
    });
}

#[test]
fn write_queue_overflow_is_fatal() {
    let harness = Harness::new(false);
    let payload = "p".repeat(32 * 1024);
    let mut failure = None;
    for _ in 0..512 {
        let outcome = harness.transport.notify(
            ClientNotificationMethod::Initialized,
            json!({ "padding": payload }),
        );
        if let Err(error) = outcome {
            failure = Some(error);
            break;
        }
    }
    assert_eq!(
        failure,
        Some(CodexRpcFailure::HostFailed {
            reason: APP_SERVER_WRITE_QUEUE_ERROR.to_string(),
        })
    );
    assert_eq!(
        harness.transport.failure(),
        Some(APP_SERVER_WRITE_QUEUE_ERROR.to_string())
    );
}

#[test]
fn server_eof_settles_pending_requests_and_routes() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let transport = &harness.transport;
    thread::scope(|scope| {
        let request =
            scope.spawn(|| transport.request(ClientMethod::ThreadStart, json!({}), PROBE_TIMEOUT));
        wait_for(|| harness.client_line(0));
        harness.close_server();
        let outcome = request.join().expect("request thread");
        assert_eq!(
            outcome,
            Err(CodexRpcFailure::HostFailed {
                reason: APP_SERVER_EOF_ERROR.to_string(),
            })
        );
    });
    assert_eq!(
        frames.recv_timeout(PROBE_TIMEOUT),
        Err(TurnFrameRecvError::Closed {
            reason: APP_SERVER_EOF_ERROR.to_string(),
        })
    );
}

#[test]
fn frames_before_subscribe_are_replayed_from_the_orphan_buffer() {
    let harness = Harness::new(true);
    harness.emit(&item_started("thread-late", "item-1"));
    let frames = harness.transport.subscribe("thread-late");
    let frame = wait_for(|| frames.try_recv());
    assert!(matches!(
        frame,
        TurnFrame::Notification(ref notification) if matches!(**notification, ServerNotification::ItemStarted(_))
    ));
}

#[test]
fn attached_subagent_threads_route_into_the_same_turn() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-root");
    harness.emit(&item_started("thread-child", "item-1"));
    assert!(frames.attach_thread("thread-child"));
    let frame = wait_for(|| frames.try_recv());
    assert!(matches!(
        frame,
        TurnFrame::Notification(ref notification) if matches!(**notification, ServerNotification::ItemStarted(_))
    ));
    assert_eq!(frames.attached_threads(), 2);
}

#[test]
fn attached_subagent_threads_are_capped() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-root");
    for index in 0..MAX_SUBAGENT_THREADS_PER_TURN {
        assert!(frames.attach_thread(format!("child-{index}").as_str()));
    }
    assert!(!frames.attach_thread("child-overflow"));
    assert_eq!(frames.attached_threads(), MAX_SUBAGENT_THREADS_PER_TURN + 1);
}

#[test]
fn a_frame_without_a_thread_id_is_counted_as_unrouted() {
    let harness = Harness::new(true);
    let _frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({ "method": "future/global", "params": { "detail": 1 } }));
    let unrouted = wait_for(|| match harness.transport.stats().unrouted_frames {
        0 => None,
        count => Some(count),
    });
    assert_eq!(unrouted, 1);
    assert!(harness.transport.failure().is_none());
}

#[test]
fn inbound_queue_overflow_sets_the_truncated_flag() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let mut batch = String::new();
    for index in 0..(MAX_TURN_INBOUND_FRAMES + 8) {
        batch.push_str(
            format!("{}\n", item_started("thread-1", index.to_string().as_str())).as_str(),
        );
    }
    harness.emit_bytes(batch.as_bytes());
    wait_for(|| match frames.truncated() {
        true => Some(()),
        false => None,
    });
    assert!(frames.truncated());
    assert!(harness.transport.failure().is_none());
}

#[test]
fn dropping_a_receiver_releases_its_routes() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    assert!(frames.attach_thread("thread-child"));
    drop(frames);
    harness.emit(&item_started("thread-child", "item-1"));
    let reopened = harness.transport.subscribe("thread-child");
    let frame = wait_for(|| reopened.try_recv());
    assert!(matches!(
        frame,
        TurnFrame::Notification(ref notification) if matches!(**notification, ServerNotification::ItemStarted(_))
    ));
}

#[test]
fn duplicate_subscriptions_and_foreign_attachments_cannot_steal_routes() {
    let harness = Harness::new(true);
    let owner = harness.transport.subscribe("root");
    let foreign = harness.transport.subscribe("foreign");
    let duplicate = harness.transport.subscribe("root");
    assert!(duplicate.closed().is_some());
    assert!(!foreign.attach_thread("root"));
    harness.emit(&item_started("root", "owned"));
    assert!(owner.recv_timeout(PROBE_TIMEOUT).is_ok());
    assert!(foreign.try_recv().is_none());
    drop(duplicate);
    harness.emit(&item_started("root", "still-owned"));
    assert!(owner.recv_timeout(PROBE_TIMEOUT).is_ok());
}

#[test]
fn malformed_server_request_is_answered_fail_closed() {
    let harness = Harness::new(true);
    harness.emit(&json!({"id":7,"method":"execCommandApproval","params":{},"unexpected":true}));
    let answer = wait_for(|| harness.client_line(0));
    assert_eq!(answer["id"], 7);
    assert_eq!(answer["error"]["code"], -32600);
}

#[test]
fn outbound_oversized_request_does_not_leave_pending_entry() {
    let harness = Harness::new(true);
    let result = harness.transport.request(
        ClientMethod::TurnStart,
        json!({"padding":"x".repeat(MAX_APP_SERVER_LINE_BYTES)}),
        PROBE_TIMEOUT,
    );
    assert!(matches!(result, Err(CodexRpcFailure::HostFailed { reason })
        if reason == APP_SERVER_OUTBOUND_LIMIT_ERROR));
    assert_eq!(harness.transport.pending_requests(), 0);
    assert!(harness.transport.failure().is_none());
}

#[test]
fn inbound_byte_budget_and_orphan_loss_are_visible() {
    let queue = TurnFrameQueue::default();
    for _ in 0..9 {
        queue.push(BufferedFrame {
            frame: TurnFrame::UnknownFrame {
                method: "future".into(),
            },
            bytes: MAX_APP_SERVER_LINE_BYTES,
        });
    }
    assert!(queue.truncated());
    assert_eq!(queue.locked().bytes, MAX_TURN_INBOUND_BYTES);
    queue.try_recv();
    assert_eq!(
        queue.locked().bytes,
        MAX_TURN_INBOUND_BYTES - MAX_APP_SERVER_LINE_BYTES
    );
    let harness = Harness::new(true);
    for _ in 0..3 {
        harness.transport.shared.route(
            Some("orphan".into()),
            TurnFrame::UnknownFrame {
                method: "future".into(),
            },
            MAX_ORPHAN_INBOUND_BYTES,
        );
    }
    let frames = harness.transport.subscribe("orphan");
    assert!(frames.truncated());
    assert!(frames.try_recv().is_some());
}

#[test]
fn pending_requests_have_a_hard_capacity() {
    let harness = Harness::new(true);
    {
        let mut pending = harness.transport.shared.pending.lock().unwrap();
        for id in 1000..1000 + MAX_PENDING_REQUESTS as u64 {
            let (sender, _) = sync_channel(1);
            pending.insert(id, sender);
        }
    }
    assert!(harness
        .transport
        .request(ClientMethod::Initialize, json!({}), PROBE_TIMEOUT)
        .is_err());
    assert_eq!(harness.transport.pending_requests(), MAX_PENDING_REQUESTS);
}

#[test]
fn worker_panic_guard_closes_pending_requests_and_routes() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("root");
    let shared = Arc::clone(&harness.transport.shared);
    let worker = thread::spawn(move || {
        let _guard = TransportWorkerGuard(shared);
        panic!("injected worker panic");
    });
    assert!(worker.join().is_err());
    assert!(harness.transport.failure().is_some());
    assert!(matches!(
        frames.recv_timeout(PROBE_TIMEOUT),
        Err(TurnFrameRecvError::Closed { .. })
    ));
}

#[test]
fn orphan_loss_is_scoped_to_the_affected_thread() {
    let harness = Harness::new(true);
    for _ in 0..2 {
        harness.transport.shared.route(
            Some("overflow".into()),
            TurnFrame::UnknownFrame {
                method: "future".into(),
            },
            MAX_ORPHAN_INBOUND_BYTES,
        );
    }
    let unaffected = harness.transport.subscribe("clean");
    assert!(!unaffected.truncated());
    let affected = harness.transport.subscribe("overflow");
    assert!(affected.truncated());
}

fn large_command_completed(thread_id: &str) -> Value {
    json!({"method":"item/completed","params": {
        "threadId":thread_id,"turnId":"turn-large",
        "item":{"type":"commandExecution","id":"exec-large","status":"completed",
            "aggregatedOutput":"€".repeat(MAX_APP_SERVER_LINE_BYTES / 2),"exitCode":0}
    }})
}

#[test]
fn large_tool_output_preserves_other_turns_and_terminal_delivery() {
    let harness = Harness::new(true);
    let large = harness.transport.subscribe("large");
    let other = harness.transport.subscribe("other");
    // Original wire bytes exceed the entire queue budget. Only the projection is queued.
    for _ in 0..8 {
        harness.emit(&large_command_completed("large"));
    }
    harness.emit(&item_started("other", "other-item"));
    harness.emit(&json!({"method":"turn/completed","params":{
        "threadId":"large","turn":{"id":"turn-large","status":"completed"}
    }}));
    for _ in 0..8 {
        let TurnFrame::Notification(notification) = large.recv_timeout(PROBE_TIMEOUT).unwrap()
        else {
            panic!("expected projected notification")
        };
        let ServerNotification::ItemCompleted(payload) = *notification else {
            panic!("expected command completion")
        };
        let super::super::codex_app_server_protocol::ThreadItem::CommandExecution(item) =
            payload.item
        else {
            panic!("expected command item")
        };
        let output = item.aggregated_output.unwrap();
        assert_eq!(output, "€".repeat(4096 / 3));
        assert!(
            output.len() > 512,
            "presenter must still mark its summary clipped"
        );
    }
    assert!(matches!(large.recv_timeout(PROBE_TIMEOUT).unwrap(),
        TurnFrame::Notification(notification) if matches!(*notification, ServerNotification::TurnCompleted(_))));
    assert!(other.recv_timeout(PROBE_TIMEOUT).is_ok());
    assert!(!large.truncated());
    assert!(!other.truncated());
    assert!(harness.transport.failure().is_none());
}

#[test]
fn large_ignored_delta_does_not_break_following_canonical_item() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(
        &json!({"method":"item/commandExecution/outputDelta","params":{
            "threadId":"thread-1","delta":"x".repeat(MAX_APP_SERVER_LINE_BYTES + 1)
        }}),
    );
    harness.emit(&item_started("thread-1", "next"));
    assert!(frames.recv_timeout(PROBE_TIMEOUT).is_ok());
    assert!(harness.transport.failure().is_none());
}

#[test]
fn large_tool_metadata_is_not_allowed_by_the_display_payload_exception() {
    let harness = Harness::new(true);
    let mut frame = large_command_completed("thread-1");
    frame["params"]["item"]["command"] = json!("x".repeat(MAX_APP_SERVER_LINE_BYTES));
    harness.emit(&frame);
    assert_eq!(
        wait_for(|| harness.transport.failure()),
        APP_SERVER_LINE_LIMIT_ERROR
    );
}

#[test]
fn large_rpc_response_fails_pending_requests_truthfully() {
    let harness = Arc::new(Harness::new(true));
    let requesting = Arc::clone(&harness);
    let request = thread::spawn(move || {
        requesting
            .transport
            .request(ClientMethod::Initialize, json!({}), PROBE_TIMEOUT)
    });
    let sent = wait_for(|| harness.client_line(0));
    harness.emit(&json!({"id":sent["id"],"result":{
        "output":"x".repeat(MAX_APP_SERVER_LINE_BYTES + 1)
    }}));
    assert!(
        matches!(request.join().unwrap(), Err(CodexRpcFailure::HostFailed { reason })
        if reason == APP_SERVER_LINE_LIMIT_ERROR)
    );
    assert_eq!(harness.transport.pending_requests(), 0);
}

#[test]
fn ignored_method_with_request_id_is_not_silently_dropped() {
    let frame = json!({"id":8,"method":"item/commandExecution/outputDelta","params":{
        "delta":"x".repeat(MAX_APP_SERVER_LINE_BYTES + 1)
    }});
    assert!(inbound::project_large_notification(&serde_json::to_vec(&frame).unwrap()).is_err());
}

#[test]
fn wire_limit_rejects_even_supported_output_without_unbounded_accumulation() {
    let bytes = serde_json::to_vec(&json!({"method":"item/completed","params":{
        "threadId":"large","item":{"type":"commandExecution","id":"exec",
            "status":"completed","aggregatedOutput":"x".repeat(MAX_APP_SERVER_WIRE_BYTES)}
    }}))
    .unwrap();
    let mut reader = BufReader::new(bytes.as_slice());
    let mut line = Vec::new();
    assert!(matches!(
        read_bounded_line(&mut reader, &mut line, MAX_APP_SERVER_WIRE_BYTES).unwrap(),
        BoundedLine::Oversized
    ));
    assert!(line.len() <= MAX_APP_SERVER_WIRE_BYTES);
}

#[test]
fn malformed_large_output_is_not_repaired_or_accepted() {
    let mut frame = serde_json::to_vec(&large_command_completed("thread-1")).unwrap();
    frame.pop();
    assert!(inbound::project_large_notification(&frame).is_err());
}

#[test]
fn large_legacy_duplicate_command_output_does_not_stop_canonical_completion() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    let output = "x".repeat(1_048_606);
    harness.emit(&json!({"method":"codex/event/item_completed","params":{
        "conversationId":"thread-1", "msg":{"type":"item_completed","item":{
            "type":"CommandExecution", "stdout":output, "aggregated_output":output,
            "formatted_output":"x".repeat(40_112)
        }}
    }}));
    harness.emit(&large_command_completed("thread-1"));
    assert!(matches!(frames.recv_timeout(PROBE_TIMEOUT).unwrap(),
        TurnFrame::Notification(notification) if matches!(*notification, ServerNotification::ItemCompleted(_))));
    assert!(harness.transport.failure().is_none());
    assert_eq!(harness.transport.stats().unknown_frames, 0);
}

#[test]
fn large_projection_preserves_valid_escaped_protocol_names() {
    let frame = serde_json::to_string(&large_command_completed("thread-1"))
        .unwrap()
        .replace("item/completed", r"item\/completed")
        .replace("commandExecution", r"command\u0045xecution");
    assert!(inbound::project_large_notification(frame.as_bytes()).is_ok());
}

#[test]
fn null_rpc_id_still_counts_as_a_request_in_large_frames() {
    let frame = json!({"id":null,"method":"item/commandExecution/outputDelta","params":{
        "delta":"x".repeat(MAX_APP_SERVER_LINE_BYTES + 1)
    }});
    assert!(inbound::project_large_notification(&serde_json::to_vec(&frame).unwrap()).is_err());
}

#[test]
fn user_input_is_deferred_without_blocking_transport() {
    let harness = Harness::new(true);
    let frames = harness.transport.subscribe("thread-1");
    harness.emit(&json!({"id":91,"method":"item/tool/requestUserInput","params":{"threadId":"thread-1","turnId":"turn-1","questions":[]}}));
    assert!(
        matches!(frames.recv_timeout(PROBE_TIMEOUT).unwrap(),TurnFrame::UserInputRequested{id,..} if id==json!(91))
    );
    assert!(harness.client_line(0).is_none());
    harness.emit(&item_started("thread-1", "next-item"));
    assert!(matches!(
        frames.recv_timeout(PROBE_TIMEOUT).unwrap(),
        TurnFrame::Notification(_)
    ));
    harness
        .transport
        .answer_server_request(
            json!(91),
            json!({"answers":{"q":{"answers":["Real answer"]}}}),
        )
        .unwrap();
    assert_eq!(
        wait_for(|| harness.client_line(0))["result"]["answers"]["q"]["answers"][0],
        json!("Real answer")
    );
}
#[test]
fn orphan_question_is_rejected() {
    let harness = Harness::new(true);
    harness.emit(
        &json!({"id":92,"method":"item/tool/requestUserInput","params":{"threadId":"missing"}}),
    );
    assert_eq!(
        wait_for(|| harness.client_line(0))["error"]["code"],
        json!(-32600)
    );
}
