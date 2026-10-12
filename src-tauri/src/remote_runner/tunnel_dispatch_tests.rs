use super::tunnel_stall::{StallPolicy, HEAVY_UPLOAD_BYTES};
use super::{tests::fixture_server, Session};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

fn listener(session: &Session) -> std::os::unix::net::UnixListener {
    let path = session
        .process
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .socket_path();
    let listener = std::os::unix::net::UnixListener::bind(path).unwrap();
    listener.set_nonblocking(true).unwrap();
    listener
}

fn accept(listener: &std::os::unix::net::UnixListener) -> std::os::unix::net::UnixStream {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match listener.accept() {
            Ok((socket, _)) => {
                socket.set_nonblocking(false).unwrap();
                return socket;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("fixture accept failed: {error}"),
        }
    }
}

fn read_request(socket: &mut std::os::unix::net::UnixStream) {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut header = Vec::new();
    loop {
        let mut byte = [0];
        socket.read_exact(&mut byte).unwrap();
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") {
            return;
        }
    }
}

fn respond(socket: &mut std::os::unix::net::UnixStream) {
    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
}

#[test]
fn sixteen_pending_reads_do_not_reject_actions_or_block_another_server() {
    let session = Arc::new(Session::fixture());
    let bound = listener(&session);
    let (ready, received) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let fixture = std::thread::spawn(move || {
        let mut sockets = Vec::new();
        for _ in 0..16 {
            let mut socket = accept(&bound);
            read_request(&mut socket);
            sockets.push(socket);
        }
        ready.send(()).unwrap();
        // An interactive request must arrive and finish before any read is released.
        let mut action = accept(&bound);
        read_request(&mut action);
        respond(&mut action);
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        for socket in &mut sockets {
            respond(socket);
        }
    });
    let reads: Vec<_> = (0..16)
        .map(|_| {
            let session = session.clone();
            std::thread::spawn(move || {
                session.request(&fixture_server(), "GET", "/v1/tasks", None, vec![])
            })
        })
        .collect();
    received.recv_timeout(Duration::from_secs(5)).unwrap();
    let other = Session::fixture();
    let other_listener = listener(&other);
    let other_fixture = std::thread::spawn(move || {
        let mut socket = accept(&other_listener);
        read_request(&mut socket);
        respond(&mut socket);
    });
    assert_eq!(
        other
            .request(&fixture_server(), "GET", "/v1/runner", None, vec![])
            .unwrap()["ok"],
        true
    );
    other_fixture.join().unwrap();
    assert_eq!(
        session
            .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
            .unwrap()["ok"],
        true
    );
    release.send(()).unwrap();
    for read in reads {
        assert_eq!(read.join().unwrap().unwrap()["ok"], true);
    }
    fixture.join().unwrap();
}

#[test]
fn close_cancels_pending_http_without_waiting_for_deadline_or_replaying() {
    let session = Arc::new(Session::fixture());
    let listener = listener(&session);
    let pid = session.pid().unwrap();
    let (ready, received) = mpsc::channel();
    let (settled, cancellation_proven) = mpsc::channel();
    let fixture = std::thread::spawn(move || {
        let mut socket = accept(&listener);
        read_request(&mut socket);
        ready.send(()).unwrap();
        // The fixture socket belongs to this thread, not the tunnel process.
        // Reqwest may retain its background HTTP connection after cancellation;
        // peer EOF therefore is not evidence of request-task settlement.
        // Withhold the response until the caller has proven prompt cancellation.
        cancellation_proven
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    });
    let owner = session.clone();
    let pending = std::thread::spawn(move || {
        owner.request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
    });
    received.recv_timeout(Duration::from_secs(5)).unwrap();
    let started = Instant::now();
    session.close();
    assert!(pending.join().unwrap().unwrap_err().contains("changed"));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(session.pid(), None);
    assert!(!session.is_alive());
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
    assert!(session
        .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
        .is_err());
    settled.send(()).unwrap();
    fixture.join().unwrap();
}

const CONNECTION_FAILED: &str = "Runner connection failed. The request outcome may be unknown.";
const ROUTE_TIMEOUT: Duration = Duration::from_secs(30);

fn policy(quiet: u64, probe: u64) -> StallPolicy {
    StallPolicy {
        quiet: Duration::from_millis(quiet),
        probe: Duration::from_millis(probe),
        upload_bytes_per_second: HEAVY_UPLOAD_BYTES as u64,
        ..StallPolicy::DEFAULT
    }
}

fn swift() -> StallPolicy {
    policy(150, 600)
}

fn patient() -> StallPolicy {
    policy(30, 20_000)
}

fn read_head(socket: &mut std::os::unix::net::UnixStream) -> String {
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut head = Vec::new();
    let mut byte = [0];
    while !head.ends_with(b"\r\n\r\n") && matches!(socket.read(&mut byte), Ok(1)) {
        head.push(byte[0]);
    }
    String::from_utf8_lossy(&head).into_owned()
}

fn is_probe(head: &str) -> bool {
    head.starts_with("GET /healthz ")
}

struct BlackHole {
    heads: mpsc::Receiver<String>,
    stop: mpsc::Sender<()>,
    thread: std::thread::JoinHandle<Vec<std::os::unix::net::UnixStream>>,
}

impl BlackHole {
    fn swallow(bound: std::os::unix::net::UnixListener) -> Self {
        let (seen, heads) = mpsc::channel();
        let (stop, stopped) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let mut held = Vec::new();
            while stopped.try_recv().is_err() {
                let Ok((mut socket, _)) = bound.accept() else {
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                };
                socket.set_nonblocking(false).unwrap();
                let _ = seen.send(read_head(&mut socket));
                held.push(socket);
            }
            held
        });
        Self {
            heads,
            stop,
            thread,
        }
    }

    fn await_probe(&self) {
        while !is_probe(&self.heads.recv_timeout(Duration::from_secs(5)).unwrap()) {}
    }

    fn release(self) -> (Vec<String>, Vec<std::os::unix::net::UnixStream>) {
        self.stop.send(()).unwrap();
        let held = self.thread.join().unwrap();
        (self.heads.try_iter().collect(), held)
    }
}

fn settles(condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    true
}

fn reaches_end_of_stream(socket: &mut std::os::unix::net::UnixStream) -> bool {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut buffer = [0; 4096];
    loop {
        match socket.read(&mut buffer) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
}

const ATTACHMENT: &str = "/v1/attachments/7389088c-29b8-4cec-9a15-e825e1fb2f66";
const REQUEST_TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";

fn payload(bytes: usize) -> Option<serde_json::Value> {
    use base64::Engine;
    let body = base64::engine::general_purpose::STANDARD.encode(vec![7_u8; bytes]);
    Some(serde_json::json!({ "base64": body }))
}

fn upload(session: &Session, bytes: usize) -> Result<serde_json::Value, String> {
    session.request(
        &fixture_server(),
        "PUT",
        ATTACHMENT,
        payload(bytes),
        vec![("content-type".into(), "image/png".into())],
    )
}

fn upload_until(session: &Session, timeout: Duration) -> Result<serde_json::Value, String> {
    let request = super::tunnel_http::prepare(
        "PUT",
        ATTACHMENT,
        payload(HEAVY_UPLOAD_BYTES),
        vec![("content-type".into(), "image/png".into())],
    )
    .unwrap();
    session.dispatch.request(request, None, 4096, timeout)
}

fn boxed_for_its_lifetime() -> StallPolicy {
    StallPolicy {
        upload_bytes_per_second: 1024,
        ..policy(100, 500)
    }
}

fn trickle(
    bound: std::os::unix::net::UnixListener,
    status: &'static str,
    body: String,
    gap: Duration,
) -> std::thread::JoinHandle<usize> {
    std::thread::spawn(move || {
        let mut slow = accept(&bound);
        read_request(&mut slow);
        write!(slow, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        for byte in body.as_bytes() {
            std::thread::sleep(gap);
            slow.write_all(&[*byte]).unwrap();
        }
        let mut unanswered = Vec::new();
        while let Ok((socket, _)) = bound.accept() {
            unanswered.push(socket);
        }
        unanswered.len()
    })
}

fn receive_upload(
    bound: &std::os::unix::net::UnixListener,
    bytes: usize,
) -> std::os::unix::net::UnixStream {
    let mut socket = accept(bound);
    read_request(&mut socket);
    socket.read_exact(&mut vec![0; bytes]).unwrap();
    socket
}

fn unvisited(bound: &std::os::unix::net::UnixListener) -> bool {
    matches!(bound.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
}

#[test]
fn black_hole_tunnel_fails_every_inflight_request_with_the_connection_error_within_the_bound() {
    let policy = swift();
    let session = Arc::new(Session::fixture_with_stall_policy(policy));
    let hole = BlackHole::swallow(listener(&session));
    let pid = session.pid().unwrap();
    let gate = Arc::new(std::sync::Barrier::new(9));
    let pending: Vec<_> = ["GET", "GET", "POST", "GET", "GET", "POST", "GET", "GET"]
        .into_iter()
        .map(|method| {
            let (session, gate) = (session.clone(), gate.clone());
            std::thread::spawn(move || {
                gate.wait();
                session.request(&fixture_server(), method, "/v1/tasks", None, vec![])
            })
        })
        .collect();
    let started = Instant::now();
    gate.wait();
    for request in pending {
        assert_eq!(request.join().unwrap().unwrap_err(), CONNECTION_FAILED);
    }
    let elapsed = started.elapsed();
    assert!(elapsed >= policy.quiet + policy.probe, "{elapsed:?}");
    assert!(elapsed < ROUTE_TIMEOUT / 6, "{elapsed:?}");
    assert!(session.dispatch.is_stalled());
    assert!(!session.is_alive());
    assert_eq!(session.pid(), None);
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert_eq!(
        session
            .request(&fixture_server(), "GET", "/v1/tasks", None, vec![])
            .unwrap_err(),
        "Runner connection is closed. Reconnect the server."
    );
    assert!(settles(|| session.dispatch.retained_tasks() == 0));
    let (heads, mut held) = hole.release();
    assert_eq!(heads.iter().filter(|head| is_probe(head)).count(), 1);
    assert_eq!(heads.len(), 9);
    assert!(held.iter_mut().all(reaches_end_of_stream));
}

#[test]
fn a_verdict_reaches_later_callers_and_is_applied_by_the_next_liveness_check() {
    let session = Session::fixture_with_stall_policy(policy(40, 150));
    let hole = BlackHole::swallow(listener(&session));
    let pid = session.pid().unwrap();
    let request = super::tunnel_http::prepare("GET", "/v1/tasks", None, vec![]).unwrap();
    assert_eq!(
        session
            .dispatch
            .request(request, None, 4096, ROUTE_TIMEOUT)
            .unwrap_err(),
        CONNECTION_FAILED
    );
    assert!(settles(|| session.dispatch.retained_tasks() == 0));
    let request = super::tunnel_http::prepare("POST", "/v1/tasks", None, vec![]).unwrap();
    assert_eq!(
        session
            .dispatch
            .request(request, None, 4096, ROUTE_TIMEOUT)
            .unwrap_err(),
        CONNECTION_FAILED
    );
    assert_eq!(session.pid(), Some(pid));
    assert!(!session.is_alive());
    assert_eq!(session.pid(), None);
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    let (heads, _) = hole.release();
    assert!(heads.iter().all(|head| !head.starts_with("POST ")));
}

#[test]
fn slow_but_alive_tunnel_keeps_a_long_request_and_is_not_torn_down() {
    let session = Arc::new(Session::fixture_with_stall_policy(patient()));
    let bound = listener(&session);
    let pid = session.pid().unwrap();
    let fixture = std::thread::spawn(move || {
        let mut slow = accept(&bound);
        assert!(read_head(&mut slow).starts_with("POST /v1/projects/p/mcp-servers/codex/logins "));
        for _ in 0..4 {
            let mut probe = accept(&bound);
            let head = read_head(&mut probe);
            assert!(is_probe(&head));
            assert!(head.contains("connection: close\r\n"));
            respond(&mut probe);
        }
        respond(&mut slow);
    });
    let started = Instant::now();
    let value = session
        .request(
            &fixture_server(),
            "POST",
            "/v1/projects/p/mcp-servers/codex/logins",
            Some(serde_json::json!({})),
            vec![],
        )
        .unwrap();
    assert_eq!(value["ok"], true);
    assert!(started.elapsed() >= patient().quiet * 4);
    fixture.join().unwrap();
    assert!(!session.dispatch.is_stalled());
    assert!(session.is_alive());
    assert_eq!(session.pid(), Some(pid));
}

#[test]
fn a_trickling_response_proves_liveness_while_probes_go_unanswered() {
    let policy = policy(20, 600);
    let session = Arc::new(Session::fixture_with_stall_policy(policy));
    let body = format!("{{\"ok\":true,\"pad\":\"{}\"}}", "x".repeat(22));
    let fixture = trickle(
        listener(&session),
        "200 OK",
        body,
        Duration::from_millis(25),
    );
    let started = Instant::now();
    let value = session
        .request(&fixture_server(), "GET", "/v1/tasks", None, vec![])
        .unwrap();
    assert_eq!(value["ok"], true);
    assert!(started.elapsed() > policy.quiet + policy.probe);
    assert!(fixture.join().unwrap() > 0);
    assert!(!session.dispatch.is_stalled());
    assert!(session.is_alive());
}

#[test]
fn a_trickling_refusal_body_proves_liveness_and_keeps_the_authoritative_refusal() {
    let policy = policy(20, 600);
    let invalid = format!(
        "{{\"error\":\"invalid_input\",\"pad\":\"{}\"}}",
        "x".repeat(10)
    );
    for (method, path, body, headers, status, refusal, gap, expected) in [
        (
            "GET",
            "/v1/tasks",
            None,
            vec![],
            "400 Bad Request",
            invalid,
            25,
            "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.",
        ),
        (
            "POST",
            "/v1/speech/transcriptions?language=en",
            payload(16),
            vec![("content-type".to_string(), "application/octet-stream".to_string())],
            "429 Too Many Requests",
            "{\"error\":\"busy\"}".to_string(),
            60,
            "Runner speech transcription failed: busy (HTTP 429).",
        ),
    ] {
        let session = Arc::new(Session::fixture_with_stall_policy(policy));
        let fixture = trickle(
            listener(&session),
            status,
            refusal,
            Duration::from_millis(gap),
        );
        let started = Instant::now();
        let error = session
            .request(&fixture_server(), method, path, body, headers)
            .unwrap_err();
        assert_eq!(error, expected);
        assert!(started.elapsed() > policy.quiet + policy.probe, "{status}");
        assert!(fixture.join().unwrap() > 0, "{status}");
        assert!(!session.dispatch.is_stalled(), "{status}");
        assert!(session.is_alive(), "{status}");
    }
}

#[test]
fn an_upload_that_times_out_in_a_black_hole_condemns_the_idle_session_one_probe_later() {
    let policy = boxed_for_its_lifetime();
    let session = Session::fixture_with_stall_policy(policy);
    let hole = BlackHole::swallow(listener(&session));
    let pid = session.pid().unwrap();
    assert_eq!(
        upload_until(&session, Duration::from_millis(300)).unwrap_err(),
        REQUEST_TIMED_OUT
    );
    let timed_out = Instant::now();
    assert!(!session.dispatch.is_stalled());
    assert!(settles(|| session.dispatch.is_stalled()));
    let waited = timed_out.elapsed();
    assert!(
        waited + Duration::from_millis(50) >= policy.probe,
        "{waited:?}"
    );
    assert!(waited < ROUTE_TIMEOUT / 6, "{waited:?}");
    assert!(!session.is_alive());
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert!(settles(|| session.dispatch.retained_tasks() == 0));
    let (heads, _) = hole.release();
    assert_eq!(heads.iter().filter(|head| is_probe(head)).count(), 1);
    assert_eq!(heads.len(), 2);
}

#[test]
fn a_timed_out_request_on_a_healthy_tunnel_is_cleared_by_one_answered_probe() {
    let policy = boxed_for_its_lifetime();
    let session = Session::fixture_with_stall_policy(policy);
    let bound = listener(&session);
    let fixture = std::thread::spawn(move || {
        let ignored = receive_upload(&bound, HEAVY_UPLOAD_BYTES);
        let mut probe = accept(&bound);
        assert!(is_probe(&read_head(&mut probe)));
        respond(&mut probe);
        (bound, ignored)
    });
    assert_eq!(
        upload_until(&session, Duration::from_millis(300)).unwrap_err(),
        REQUEST_TIMED_OUT
    );
    let (bound, _ignored) = fixture.join().unwrap();
    assert!(settles(|| session.dispatch.retained_tasks() == 1));
    std::thread::sleep(policy.quiet * 3 + policy.probe);
    assert!(unvisited(&bound));
    assert_eq!(session.dispatch.retained_tasks(), 1);
    assert!(!session.dispatch.is_stalled());
    assert!(session.is_alive());
}

#[test]
fn a_healthy_slow_upload_is_not_judged_while_its_time_box_runs() {
    let policy = policy(100, 500);
    let session = Arc::new(Session::fixture_with_stall_policy(policy));
    let bound = listener(&session);
    let fixture = std::thread::spawn(move || {
        let mut upload = receive_upload(&bound, HEAVY_UPLOAD_BYTES);
        std::thread::sleep(Duration::from_millis(900));
        respond(&mut upload);
        unvisited(&bound)
    });
    assert_eq!(upload(&session, HEAVY_UPLOAD_BYTES).unwrap()["ok"], true);
    assert!(fixture.join().unwrap());
    assert!(!session.dispatch.is_stalled());
    assert!(session.is_alive());
}

#[test]
fn concurrent_small_uploads_are_boxed_by_their_total_bytes() {
    let policy = policy(100, 500);
    let session = Arc::new(Session::fixture_with_stall_policy(policy));
    let bound = listener(&session);
    let each = HEAVY_UPLOAD_BYTES * 5 / 8;
    let fixture = std::thread::spawn(move || {
        let mut uploads = [receive_upload(&bound, each), receive_upload(&bound, each)];
        std::thread::sleep(Duration::from_millis(900));
        uploads.iter_mut().for_each(respond);
        unvisited(&bound)
    });
    let gate = Arc::new(std::sync::Barrier::new(2));
    let pending: Vec<_> = (0..2)
        .map(|_| {
            let (session, gate) = (session.clone(), gate.clone());
            std::thread::spawn(move || {
                gate.wait();
                upload(&session, each)
            })
        })
        .collect();
    for request in pending {
        assert_eq!(request.join().unwrap().unwrap()["ok"], true);
    }
    assert!(fixture.join().unwrap());
    assert!(!session.dispatch.is_stalled());
    assert!(session.is_alive());
}

#[test]
fn a_black_hole_during_a_heavy_upload_is_detected_once_its_time_box_ends() {
    let policy = policy(100, 500);
    let session = Arc::new(Session::fixture_with_stall_policy(policy));
    let hole = BlackHole::swallow(listener(&session));
    let started = Instant::now();
    assert_eq!(
        upload(&session, HEAVY_UPLOAD_BYTES).unwrap_err(),
        CONNECTION_FAILED
    );
    let elapsed = started.elapsed();
    let boxed = Duration::from_secs(1);
    assert!(
        elapsed >= boxed + policy.quiet + policy.probe,
        "{elapsed:?}"
    );
    assert!(elapsed < ROUTE_TIMEOUT / 6, "{elapsed:?}");
    assert!(!session.is_alive());
    let (heads, _) = hole.release();
    assert_eq!(heads.iter().filter(|head| is_probe(head)).count(), 1);
}

#[test]
fn a_late_verdict_cannot_overturn_an_explicit_close_or_reach_the_replacement_session() {
    use crate::remote_runner::service::ConnectionLease;
    let replaced = Arc::new(Session::fixture_with_stall_policy(policy(30, 1_000)));
    let hole = BlackHole::swallow(listener(&replaced));
    let first = ConnectionLease::new(fixture_server(), replaced.clone());
    let owner = replaced.clone();
    let pending = std::thread::spawn(move || {
        owner.request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
    });
    hole.await_probe();
    first.revoke();
    assert_eq!(
        pending.join().unwrap().unwrap_err(),
        "Runner connection changed during request."
    );
    let replacement = Arc::new(Session::fixture_with_stall_policy(swift()));
    let bound = listener(&replacement);
    let second = ConnectionLease::new(fixture_server(), replacement.clone());
    assert!(settles(|| replaced.dispatch.retained_tasks() == 0));
    assert!(!replaced.dispatch.is_stalled());
    assert!(!replaced.is_alive());
    assert!(first.session().is_err());
    assert!(replacement.is_alive());
    assert!(Arc::ptr_eq(&second.session().unwrap(), &replacement));
    let fixture = std::thread::spawn(move || {
        let mut socket = accept(&bound);
        read_request(&mut socket);
        respond(&mut socket);
    });
    assert_eq!(
        replacement
            .request(&fixture_server(), "GET", "/v1/runner", None, vec![])
            .unwrap()["ok"],
        true
    );
    fixture.join().unwrap();
    hole.release();
}

#[test]
fn a_stalled_session_is_replaced_through_its_own_lease_generation() {
    use crate::remote_runner::service::ConnectionLease;
    let stalled = Arc::new(Session::fixture_with_stall_policy(policy(40, 150)));
    let hole = BlackHole::swallow(listener(&stalled));
    let pid = stalled.pid().unwrap();
    let mut unreachable = fixture_server();
    unreachable.host = "not a valid host".into();
    let lease = ConnectionLease::new(unreachable, stalled.clone());
    let session = lease.session().unwrap();
    assert!(Arc::ptr_eq(&session, &stalled));
    assert_eq!(
        session
            .request(lease.server(), "GET", "/v1/tasks", None, vec![])
            .unwrap_err(),
        CONNECTION_FAILED
    );
    assert!(lease.is_current());
    assert_eq!(
        lease.session().err(),
        Some("Invalid SSH host or username.".to_string())
    );
    assert!(!stalled.is_alive());
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    hole.release();
}

#[test]
fn close_leaves_no_task_timer_or_socket_behind_a_running_probe() {
    let session = Arc::new(Session::fixture_with_stall_policy(patient()));
    let hole = BlackHole::swallow(listener(&session));
    let owner = session.clone();
    let pending = std::thread::spawn(move || {
        owner.request(&fixture_server(), "GET", "/v1/tasks", None, vec![])
    });
    hole.await_probe();
    let started = Instant::now();
    session.close();
    assert_eq!(
        pending.join().unwrap().unwrap_err(),
        "Runner connection changed during request."
    );
    assert!(settles(|| session.dispatch.retained_tasks() == 0));
    assert!(!session.dispatch.is_stalled());
    let (_, mut held) = hole.release();
    assert_eq!(held.len(), 2);
    assert!(held.iter_mut().all(reaches_end_of_stream));
    assert!(started.elapsed() < patient().probe / 2);
}
