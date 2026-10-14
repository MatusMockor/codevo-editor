use super::super::super::interactions_fake::transport::*;
use super::super::super::thread_requests_ipc::{ThreadRespondOutcome, ThreadRespondRequest};
use super::super::super::thread_requests_respond::{respond_under, settle_response};
use super::*;
use std::collections::VecDeque;

fn query_through(server: &str, runner: &str, turns: Vec<TurnDescriptor>) -> ThreadRequestsQuery {
    ThreadRequestsQuery {
        server_id: server.into(),
        runner_id: runner.into(),
        ..query(turns, None)
    }
}

fn respond_through(server: &str, runner: &str) -> ThreadRespondRequest {
    ThreadRespondRequest {
        server_id: server.into(),
        runner_id: runner.into(),
        ..respond_request(TASK, APPROVAL, decide("allowOnce"))
    }
}

fn interactions_line() -> String {
    format!("GET {}", route("interactions"))
}

fn record_line() -> String {
    format!("GET /v1/tasks/{TASK}")
}

fn task_record() -> Value {
    json!({"id": TASK, "conversationId": THREAD, "status": "running", "parts": []})
}

#[test]
fn server_a_can_neither_read_nor_answer_through_server_b() {
    let (state, directory) = state();
    let (lease_a, listener_a) = connection("server-a", "runner-a");
    let (lease_b, listener_b) = connection("server-b", "runner-b");
    let socket_a = listener_a.local_addr().expect("socket a");
    let socket_a = socket_a
        .as_pathname()
        .expect("socket path")
        .display()
        .to_string();
    state.install_connection(lease_a);
    state.install_connection(lease_b);
    let mut foreign = snapshot("empty");
    foreign["taskId"] = OTHER_TASK.into();
    let mut snapshots = VecDeque::from([live(), live(), foreign]);
    let served_a = serve(listener_a, "runner-a", 10, move |line| {
        if line == record_line() {
            return (200, task_record());
        }
        if line.starts_with("POST ") {
            let mut approved = legacy_approval("approved");
            approved["decision"] = "allowOnce".into();
            return (200, json!({"request": approved}));
        }
        (200, snapshots.pop_front().unwrap_or(Value::Null))
    });
    let served_b = serve(listener_b, "runner-b", 4, |line| {
        if line == record_line() {
            return (200, task_record());
        }
        (200, snapshot("answeredAndDecided"))
    });
    for (server, runner) in [("server-a", "runner-b"), ("server-b", "runner-a")] {
        assert_eq!(
            admit_connection(&state, server, runner).err(),
            Some(InteractionError::RunnerChanged)
        );
    }
    let through_a = admit_connection(&state, "server-a", "runner-a").unwrap();
    let through_b = admit_connection(&state, "server-b", "runner-b").unwrap();
    let turns = || vec![turn(TASK, STARTED, Some(3), false)];
    let forged = query_through("server-a", "runner-b", turns());
    assert_eq!(
        list_under(&through_a, &forged, &Instant::now, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::RunnerChanged)
    );
    let forged_answer = respond_through("server-a", "runner-b");
    let delivery = respond_under(&through_a, &forged_answer, Instant::now(), far());
    assert_eq!(
        settle_response(&through_a, &forged_answer, delivery, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::RunnerChanged)
    );
    let query_a = query_through("server-a", "runner-a", turns());
    let page_a = settle_page(
        &through_a,
        list_under(&through_a, &query_a, &Instant::now, far()),
        far(),
    )
    .unwrap();
    assert!(through_a.interaction_ledger().requests().holds(TASK));
    assert!(!through_b.interaction_ledger().requests().holds(TASK));
    let query_b = query_through("server-b", "runner-b", turns());
    let page_b = settle_page(
        &through_b,
        list_under(&through_b, &query_b, &Instant::now, far()),
        far(),
    )
    .unwrap();
    assert_eq!(
        page_a.message.parts().workspace_id.as_deref(),
        Some("server-a")
    );
    assert_eq!(
        page_b.message.parts().workspace_id.as_deref(),
        Some("server-b")
    );
    assert!(records(&page_a)
        .iter()
        .all(|record| record["status"] == "pending"));
    assert!(records(&page_b)
        .iter()
        .all(|record| record["status"] == "resolved"));
    let answer = respond_through("server-a", "runner-a");
    let delivery = respond_under(&through_a, &answer, Instant::now(), far());
    let result = settle_response(&through_a, &answer, delivery, far()).unwrap();
    assert_eq!(result.outcome(), ThreadRespondOutcome::Answered);
    assert_eq!(wire(&result)["message"]["workspaceId"], "server-a");
    assert!(!through_a.interaction_ledger().requests().holds(TASK));
    assert!(through_b.interaction_ledger().requests().holds(TASK));
    let error = list_under(&through_a, &query_a, &Instant::now, far()).unwrap_err();
    assert_eq!(
        error,
        ThreadRequestError::Interaction(InteractionError::Wire(WireError::ForeignTask))
    );
    let served_a = served_a.join().expect("server a");
    let served_b = served_b.join().expect("server b");
    let requests_a: Vec<String> = lines(&served_a)
        .into_iter()
        .filter(|line| line != "GET /v1/runner")
        .collect();
    assert_eq!(
        requests_a,
        [
            record_line(),
            interactions_line(),
            interactions_line(),
            format!("POST {}", route(&format!("approvals/{APPROVAL}/answer"))),
            interactions_line(),
        ]
    );
    assert_eq!(
        lines(&served_b),
        [
            "GET /v1/runner".to_string(),
            record_line(),
            "GET /v1/runner".to_string(),
            interactions_line()
        ]
    );
    for (head, _) in &served_a {
        assert!(head.contains("x-codevo-runner-id: runner-a"));
        let announced = head
            .lines()
            .find(|line| line.starts_with("x-codevo-client-capabilities:"))
            .expect("announced capabilities");
        let tokens: Vec<&str> = announced
            .split_once(':')
            .expect("header value")
            .1
            .trim()
            .split(',')
            .collect();
        assert!(tokens.contains(&"runtimeRequests"));
        assert!(tokens.contains(&"interactiveApprovals"));
        assert_eq!(tokens.len(), 16);
    }
    let text = format!(
        "{}{}{}{}",
        wire(&page_a),
        wire(&page_b),
        wire(&result),
        error.message()
    );
    for fragment in [
        socket_a.as_str(),
        "test-only",
        "localhost",
        "127.0.0.1",
        "runner-a",
        "runner-b",
        "/v1/",
    ] {
        assert!(!text.contains(fragment), "{fragment}");
    }
    drop(state);
    let _ = std::fs::remove_dir_all(directory);
}

fn legacy_runner(listener: std::os::unix::net::UnixListener, exchanges: usize) -> Served {
    let questions = format!("GET {}", route("questions"));
    let approvals = format!("GET {}", route("approvals"));
    serve(listener, "runner-a", exchanges, move |line| {
        if line == record_line() {
            return (200, task_record());
        }
        if line == questions {
            return (200, json!({"items": [legacy_question("expired")]}));
        }
        if line == approvals {
            return (200, json!({"items": [legacy_approval("expired")]}));
        }
        (404, json!({"error": "not_found"}))
    })
}

#[test]
fn cache_and_legacy_epoch_end_with_the_lease() {
    let (state, directory) = state();
    let (first, first_listener) = connection("server-a", "runner-a");
    state.install_connection(first);
    let served_first = legacy_runner(first_listener, 10);
    let captured = admit_connection(&state, "server-a", "runner-a").unwrap();
    let request = query_through(
        "server-a",
        "runner-a",
        vec![turn(TASK, STARTED, None, true)],
    );
    let read = settle_page(
        &captured,
        list_under(&captured, &request, &Instant::now, far()),
        far(),
    )
    .unwrap();
    let cached = settle_page(
        &captured,
        list_under(&captured, &request, &Instant::now, far()),
        far(),
    )
    .unwrap();
    assert_eq!(read, cached);
    assert_eq!(
        read.message.parts().epoch,
        format!("rr1-legacy-{}", captured.interaction_ledger().serial())
    );
    assert!(captured.interaction_ledger().requests().holds(TASK));
    assert_eq!(served_first.join().expect("first runner").len(), 10);
    state.disconnect("server-a", false).unwrap();
    let (second, second_listener) = connection("server-a", "runner-a");
    state.install_connection(second);
    let stale = list_under(&captured, &request, &Instant::now, far());
    assert_eq!(
        settle_page(&captured, stale, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    let answer = respond_through("server-a", "runner-a");
    let delivery = respond_under(&captured, &answer, Instant::now(), far());
    assert_eq!(
        settle_response(&captured, &answer, delivery, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::Superseded)
    );
    let current = admit_connection(&state, "server-a", "runner-a").unwrap();
    assert!(!current.interaction_ledger().requests().holds(TASK));
    assert_ne!(
        current.interaction_ledger().serial(),
        captured.interaction_ledger().serial()
    );
    let served_second = legacy_runner(second_listener, 10);
    let reread = settle_page(
        &current,
        list_under(&current, &request, &Instant::now, far()),
        far(),
    )
    .unwrap();
    assert_eq!(
        reread.message.parts().epoch,
        format!("rr1-legacy-{}", current.interaction_ledger().serial())
    );
    assert_ne!(reread.message.parts().epoch, read.message.parts().epoch);
    assert_eq!(records(&reread).len(), records(&read).len());
    assert_eq!(served_second.join().expect("second runner").len(), 10);
    drop(state);
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn task_the_runner_does_not_know_reads_as_an_empty_turn_over_the_real_transport() {
    let (lease, listener) = connection("server-a", "runner-a");
    let served = serve(listener, "runner-a", 2, |_| {
        (404, json!({"error": "not_found"}))
    });
    let request = query_through(
        "server-a",
        "runner-a",
        vec![turn(TASK, STARTED, None, true)],
    );
    let page = settle_page(
        &lease,
        list_under(&lease, &request, &Instant::now, far()),
        far(),
    )
    .unwrap();
    assert!(records(&page).is_empty());
    assert_eq!(page.next_cursor, None);
    assert_eq!(page.message.parts().epoch, "rr1-snapshot");
    assert!(!lease.interaction_ledger().requests().holds(TASK));
    let served = served.join().expect("runner");
    assert_eq!(
        lines(&served),
        ["GET /v1/runner".to_string(), record_line()]
    );
    assert!(lease
        .interaction_ledger()
        .conversations()
        .conversation(TASK)
        .is_none());
}

fn stalled_lease(
    entered: std::sync::mpsc::Sender<()>,
    release: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> crate::remote_runner::service::ConnectionLease {
    let lost = std::sync::Arc::new(crate::remote_runner::transport::Session::fixture());
    lost.close();
    let server = crate::remote_runner::types::Server {
        id: "server-a".into(),
        name: "server-a".into(),
        host: "127.0.0.1".into(),
        username: "codex".into(),
        port: 22,
        connected: true,
        runner_id: Some("runner-alpha".into()),
    };
    crate::remote_runner::service::ConnectionLease::with_connect(
        server,
        lost,
        Box::new(move |_, canceled| {
            let _ = entered.send(());
            loop {
                if canceled() {
                    return Err("Runner connection was canceled.".into());
                }
                if release.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err("SSH tunnel host is unreachable.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }),
    )
}

#[test]
fn deadline_cuts_off_the_wait_behind_a_competing_reconnect() {
    use super::super::super::interactions::InteractionRunnerPort;
    let (entered, entering) = std::sync::mpsc::channel();
    let release = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let lease = stalled_lease(entered, std::sync::Arc::clone(&release));
    let competitor = {
        let lease = lease.clone();
        std::thread::spawn(move || lease.session().map(|_| ()))
    };
    entering
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("competing reconnect started");
    let started = Instant::now();
    let waited = lease.call_before(
        "GET",
        &format!("/v1/tasks/{TASK}/interactions"),
        None,
        Some(started + std::time::Duration::from_millis(200)),
    );
    let elapsed = started.elapsed();
    assert!(waited.is_err());
    assert!(
        elapsed >= std::time::Duration::from_millis(200),
        "{elapsed:?}"
    );
    assert!(elapsed < std::time::Duration::from_secs(2), "{elapsed:?}");
    assert!(entering.try_recv().is_err());
    release.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(competitor.join().expect("competitor").is_err());
}

#[test]
fn both_commands_reject_at_their_ceiling_while_the_connection_cannot_be_made() {
    let (entered, _entering) = std::sync::mpsc::channel();
    let release = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let lease = stalled_lease(entered, release);
    let started = Instant::now();
    let ceiling = started + std::time::Duration::from_millis(250);
    let request = ThreadRequestsQuery {
        server_id: "server-a".into(),
        runner_id: "runner-alpha".into(),
        ..query(vec![turn(TASK, STARTED, None, false)], None)
    };
    assert_eq!(
        list_under(&lease, &request, &Instant::now, ceiling).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    let answer = respond_through("server-a", "runner-alpha");
    let started = Instant::now();
    let attempt = respond_under(
        &lease,
        &answer,
        started,
        started + std::time::Duration::from_millis(250),
    );
    assert_eq!(
        settle_response(&lease, &answer, attempt, far()).unwrap_err(),
        ThreadRequestError::Interaction(InteractionError::DeadlineExceeded)
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn answer_post_reports_whether_it_could_have_left_the_desktop() {
    use super::super::super::interactions::{Dispatch, InteractionRunnerPort};
    let path = format!("/v1/tasks/{TASK}/approvals/{APPROVAL}/answer");
    let (lease, listener) = connection("server-a", "runner-a");
    let served = serve(listener, "runner-a", 2, |_| (200, json!({"ok": true})));
    let ceiling = Instant::now() + std::time::Duration::from_secs(10);
    let (result, dispatch) = lease.post_before(&path, json!({"decision": "deny"}), Some(ceiling));
    assert!(result.is_ok());
    assert_eq!(dispatch, Dispatch::PossiblySent);
    assert_eq!(served.join().expect("runner").len(), 2);
    let (impostor, listener) = connection("server-a", "runner-a");
    let served = serve(listener, "runner-b", 1, |_| (200, json!({"ok": true})));
    let (result, dispatch) =
        impostor.post_before(&path, json!({"decision": "deny"}), Some(ceiling));
    assert!(result.is_err());
    assert_eq!(dispatch, Dispatch::Unsent);
    assert_eq!(lines(&served.join().expect("runner")), ["GET /v1/runner"]);
    let (late, listener) = connection("server-a", "runner-a");
    let (result, dispatch) =
        late.post_before(&path, json!({"decision": "deny"}), Some(Instant::now()));
    assert!(result.is_err());
    assert_eq!(dispatch, Dispatch::Unsent);
    listener.set_nonblocking(true).expect("nonblocking");
    assert!(listener.accept().is_err());
    let (entered, entering) = std::sync::mpsc::channel();
    let release = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let blocked = stalled_lease(entered, std::sync::Arc::clone(&release));
    let competitor = {
        let blocked = blocked.clone();
        std::thread::spawn(move || blocked.session().map(|_| ()))
    };
    entering
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("competing reconnect started");
    let started = Instant::now();
    let (result, dispatch) = blocked.post_before(
        &path,
        json!({"decision": "deny"}),
        Some(started + std::time::Duration::from_millis(200)),
    );
    assert!(result.is_err());
    assert_eq!(dispatch, Dispatch::Unsent);
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    release.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(competitor.join().expect("competitor").is_err());
}

#[test]
fn absolute_ceiling_bounds_a_request_the_runner_never_answers() {
    use super::super::super::interactions::{Dispatch, InteractionRunnerPort};
    let (lease, listener) = connection("server-a", "runner-a");
    listener.set_nonblocking(false).expect("blocking listener");
    let holder = std::thread::spawn(move || {
        let accepted = listener.accept();
        std::thread::sleep(std::time::Duration::from_secs(2));
        drop(accepted);
    });
    let started = Instant::now();
    let ceiling = started + std::time::Duration::from_millis(300);
    let path = format!("/v1/tasks/{TASK}/approvals/{APPROVAL}/answer");
    let (result, dispatch) = lease.post_before(&path, json!({"decision": "deny"}), Some(ceiling));
    let elapsed = started.elapsed();
    assert!(result.is_err());
    assert_eq!(dispatch, Dispatch::Unsent);
    assert!(
        elapsed >= std::time::Duration::from_millis(300),
        "{elapsed:?}"
    );
    assert!(
        elapsed < std::time::Duration::from_millis(1500),
        "{elapsed:?}"
    );
    holder.join().expect("holder");
}

#[test]
fn dispatcher_never_sends_a_post_whose_caller_already_declared_it_unsent() {
    use crate::remote_runner::send_gate::SendGate;
    let path = format!("/v1/tasks/{TASK}/approvals/{APPROVAL}/answer");
    let (lease, listener) = connection("server-a", "runner-a");
    let served = serve(listener, "runner-a", 1, |_| (200, json!({"ok": true})));
    let gate = std::sync::Arc::new(SendGate::default());
    assert!(gate.cancel());
    let session = lease.session().expect("session");
    let result = session.request_before(
        lease.server(),
        ("POST", &path, Some(json!({"decision": "deny"}))),
        Instant::now() + std::time::Duration::from_secs(5),
        Some(std::sync::Arc::clone(&gate)),
    );
    assert!(result.is_err());
    assert!(!gate.claim());
    assert_eq!(lines(&served.join().expect("runner")), ["GET /v1/runner"]);
}

#[test]
fn post_that_left_before_the_caller_gave_up_is_possibly_sent() {
    use super::super::super::interactions::{Dispatch, InteractionRunnerPort};
    let path = format!("/v1/tasks/{TASK}/approvals/{APPROVAL}/answer");
    let (lease, listener) = connection("server-a", "runner-a");
    let served = std::thread::spawn(move || {
        use std::io::Write;
        listener.set_nonblocking(false).expect("blocking listener");
        let mut heads = Vec::new();
        for answered in [true, false] {
            let (mut socket, _) = listener.accept().expect("connection");
            let (head, _) = receive(&mut socket);
            heads.push(head.lines().next().unwrap_or_default().to_string());
            if !answered {
                std::thread::sleep(std::time::Duration::from_millis(700));
                continue;
            }
            let payload = json!({"protocolVersion": 1, "runnerId": "runner-a"}).to_string();
            let _ = write!(
                socket,
                "HTTP/1.1 200 Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                payload.len()
            );
        }
        heads
    });
    let started = Instant::now();
    let (result, dispatch) = lease.post_before(
        &path,
        json!({"decision": "deny"}),
        Some(started + std::time::Duration::from_millis(300)),
    );
    assert!(result.is_err());
    assert_eq!(dispatch, Dispatch::PossiblySent);
    assert!(started.elapsed() < std::time::Duration::from_millis(650));
    assert_eq!(
        served.join().expect("runner"),
        [
            "GET /v1/runner HTTP/1.1".to_string(),
            format!("POST {path} HTTP/1.1")
        ]
    );
}
