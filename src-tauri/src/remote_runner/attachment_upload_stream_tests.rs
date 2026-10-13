use super::super::super::attachment_test_support::*;
use super::super::super::transport::{Failure, StallPolicy, UploadHead};
use super::super::*;
use super::{appended, run, touched};
use crate::agent_file_source::{CHANGED, CHUNK_BYTES};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const LARGE: u64 = 8 * 1024 * 1024;

fn changed_during(change: &str, apply: fn(&Path)) {
    let (route, gate) = gated("large.bin", "application/octet-stream");
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        gate.paused.recv_timeout(WAIT).unwrap();
        apply(&staged.path);
        gate.resume.send(()).unwrap();
        assert_eq!(uploading.join().unwrap().unwrap_err(), CHANGED, "{change}");
    });
    let received = gate.received.recv_timeout(WAIT).unwrap();
    assert_eq!(declared_length(&received.head) as u64, LARGE, "{change}");
    assert!(!received.complete(), "{change}");
    assert_eq!(runner.routed(), 1, "{change}");
}

#[test]
fn a_file_truncated_during_the_upload_never_completes_the_body() {
    changed_during("truncated", |path| {
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_len(LARGE / 4)
            .unwrap()
    });
}

#[test]
fn a_file_appended_during_the_upload_never_completes_the_body() {
    changed_during("appended", appended);
}

#[test]
fn a_file_touched_during_the_upload_never_completes_the_body() {
    changed_during("touched", touched);
}

#[test]
fn a_file_replaced_during_the_upload_never_completes_the_body() {
    changed_during("replaced", |path| {
        let replacement = path.with_extension("replacement");
        std::fs::File::create(&replacement)
            .unwrap()
            .set_len(LARGE)
            .unwrap();
        std::fs::rename(replacement, path).unwrap();
    });
}

#[test]
fn an_unchanged_large_file_completes_after_the_runner_resumes_reading() {
    let (route, gate) = gated("large.bin", "application/octet-stream");
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        gate.paused.recv_timeout(WAIT).unwrap();
        assert_eq!(
            runner
                .session
                .request(&server(), "POST", "/v1/tasks", None, vec![])
                .unwrap()["ok"],
            true
        );
        assert!(!uploading.is_finished());
        gate.resume.send(()).unwrap();
        let stored = uploading.join().unwrap().unwrap();
        assert_eq!(stored.attachment.bytes, LARGE);
    });
    assert!(gate.received.recv_timeout(WAIT).unwrap().complete());
    assert_eq!(runner.routed(), 2);
}

#[test]
fn cancelling_mid_stream_aborts_the_exact_upload_and_releases_its_registration() {
    let (route, gate) = gated("large.bin", "application/octet-stream");
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    let request = staged.request("large.bin");
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| {
            let permit = permit;
            upload(&runner.lease, &staged.sources, &permit, &request, swift())
        });
        gate.paused.recv_timeout(WAIT).unwrap();
        transfers.cancel_upload("fixture", "00000000-0000-4000-8000-000000000001");
        transfers.cancel_upload("another", ATTACHMENT_ID);
        std::thread::sleep(Duration::from_millis(50));
        assert!(!uploading.is_finished());
        let started = Instant::now();
        transfers.cancel_upload("fixture", ATTACHMENT_ID);
        transfers.cancel_upload("fixture", ATTACHMENT_ID);
        assert_eq!(uploading.join().unwrap().unwrap_err(), UPLOAD_CANCELLED);
        assert!(started.elapsed() < WAIT / 2);
    });
    assert_eq!(transfers.in_flight(), (0, 0));
    transfers.cancel_upload("fixture", ATTACHMENT_ID);
    gate.resume.send(()).unwrap();
    assert!(!gate.received.recv_timeout(WAIT).unwrap().complete());
    assert!(runner.session.is_alive());
}

#[test]
fn a_revoked_lease_aborts_the_stream_and_fails_closed() {
    let (route, gate) = gated("large.bin", "application/octet-stream");
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        gate.paused.recv_timeout(WAIT).unwrap();
        let started = Instant::now();
        runner.lease.revoke();
        let error = uploading.join().unwrap().unwrap_err();
        assert!(error == TUNNEL_CLOSED || error == LEASE_CHANGED, "{error}");
        assert!(started.elapsed() < WAIT / 2);
    });
    gate.resume.send(()).unwrap();
    assert!(!gate.received.recv_timeout(WAIT).unwrap().complete());
    assert_eq!(runner.routed(), 1);
}

#[test]
fn a_closed_tunnel_aborts_the_stream_and_fails_closed() {
    let (route, gate) = gated("large.bin", "application/octet-stream");
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        gate.paused.recv_timeout(WAIT).unwrap();
        let started = Instant::now();
        runner.session.close();
        assert_eq!(uploading.join().unwrap().unwrap_err(), TUNNEL_CLOSED);
        assert!(started.elapsed() < WAIT / 2);
    });
    gate.resume.send(()).unwrap();
    assert!(!gate.received.recv_timeout(WAIT).unwrap().complete());
    assert_eq!(runner.routed(), 1);
}

#[test]
fn an_interrupted_connection_is_a_transport_failure_that_is_not_replayed() {
    let route = |head: String, mut socket: UnixStream| {
        read_up_to(&mut socket, CHUNK_BYTES.min(declared_length(&head)));
    };
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    assert_eq!(
        run(&runner, &staged, "large.bin", swift()).unwrap_err(),
        CONNECTION_FAILED
    );
    assert_eq!(runner.routed(), 1);
    assert!(runner.session.is_alive());
}

#[test]
fn a_refusal_that_arrives_before_the_body_is_read_ends_the_upload_promptly() {
    use super::super::super::attachment_file_wire::STORAGE_FULL;
    use std::io::Write;
    for lingering in [false, true] {
        let (release, released) = mpsc::channel::<()>();
        let released = std::sync::Mutex::new(released);
        let route = move |_head: String, mut socket: UnixStream| {
            let reply = b"HTTP/1.1 429 Test\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
            let _ = socket.write_all(reply);
            if lingering {
                let _ = released.lock().unwrap().recv_timeout(WAIT);
            }
        };
        let runner = Runner::serve(route);
        let staged = StagedFile::sparse("large.bin", LARGE);
        let started = Instant::now();
        assert_eq!(
            run(&runner, &staged, "large.bin", swift()).unwrap_err(),
            STORAGE_FULL,
            "{lingering}"
        );
        assert!(started.elapsed() < WAIT / 2, "{lingering}");
        assert_eq!(runner.routed(), 1);
        assert!(runner.session.is_alive());
        drop(release);
    }
}

struct Held {
    reached: mpsc::Receiver<String>,
    release: mpsc::Sender<()>,
}

fn holding() -> (impl Fn(String, UnixStream) + Send + Sync + 'static, Held) {
    let (reach, reached) = mpsc::channel();
    let (release, released) = mpsc::channel::<()>();
    let released = std::sync::Mutex::new(released);
    let route = move |head: String, socket: UnixStream| {
        let _ = reach.send(head);
        let _ = released.lock().unwrap().recv_timeout(WAIT);
        drop(socket);
    };
    (route, Held { reached, release })
}

#[test]
fn an_upload_without_progress_times_out_on_its_own_idle_bound() {
    let (route, held) = holding();
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    let policy = TransferPolicy {
        total: Duration::from_secs(20),
        idle: Duration::from_millis(300),
        ..swift()
    };
    let started = Instant::now();
    assert_eq!(
        run(&runner, &staged, "large.bin", policy).unwrap_err(),
        TIMED_OUT
    );
    assert!(started.elapsed() >= policy.idle);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(is_upload(&held.reached.recv_timeout(WAIT).unwrap()));
    assert_eq!(runner.routed(), 1);
    assert!(runner.session.is_alive());
    held.release.send(()).unwrap();
}

#[test]
fn a_progressing_upload_still_ends_at_its_total_bound() {
    let route = |head: String, mut socket: UnixStream| {
        let mut remaining = declared_length(&head);
        while remaining > 0 {
            let read = read_up_to(&mut socket, (16 * 1024).min(remaining)).len();
            if read == 0 {
                return;
            }
            remaining -= read;
            std::thread::sleep(Duration::from_millis(10));
        }
    };
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    let policy = TransferPolicy {
        total: Duration::from_millis(500),
        idle: Duration::from_secs(10),
        ..swift()
    };
    let started = Instant::now();
    assert_eq!(
        run(&runner, &staged, "large.bin", policy).unwrap_err(),
        TIMED_OUT
    );
    assert!(started.elapsed() >= policy.total);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(runner.routed(), 1);
}

#[test]
fn a_runner_that_stops_reading_bounds_how_much_of_the_file_is_ever_read() {
    let (route, held) = holding();
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("huge.bin", 32 * 1024 * 1024);
    let source = staged.sources.find(&staged.source_id).unwrap();
    let mut reader = source.open().unwrap();
    let (_cancel, cancelled) = tokio::sync::watch::channel(false);
    let policy = TransferPolicy {
        total: Duration::from_secs(20),
        idle: Duration::from_millis(400),
        ..swift()
    };
    let (mut feed, exchange) = runner
        .session
        .upload(
            &server(),
            head(source.bytes()),
            policy,
            ends(policy),
            cancelled,
        )
        .unwrap();
    let mut accepted = 0_usize;
    while let Some(chunk) = reader.next().unwrap() {
        if !feed.send(chunk) {
            break;
        }
        accepted += 1;
    }
    assert!(accepted > 0);
    assert!(accepted * CHUNK_BYTES <= 4 * 1024 * 1024, "{accepted}");
    assert_eq!(
        exchange.finish().unwrap_err(),
        Failure::Transport(TIMED_OUT.into())
    );
    assert!(reader.digest().is_none());
    held.reached.recv_timeout(WAIT).unwrap();
    held.release.send(()).unwrap();
}

fn head(length: u64) -> UploadHead {
    UploadHead {
        path: format!("/v1/attachments/{ATTACHMENT_ID}"),
        headers: vec![("content-type", "application/octet-stream".into())],
        length,
        capability: "fileAttachments",
    }
}

#[test]
fn a_success_that_arrives_before_the_body_is_complete_fails_closed() {
    let digest = sha256(&vec![0_u8; LARGE as usize]);
    let (release, released) = mpsc::channel::<()>();
    let released = std::sync::Mutex::new(released);
    let route = move |_head: String, mut socket: UnixStream| {
        let reply = stored_json(
            "large.bin",
            LARGE as usize,
            &digest,
            "application/octet-stream",
        );
        respond(&mut socket, 201, reply.as_bytes());
        let _ = released.lock().unwrap().recv_timeout(WAIT);
    };
    let runner = Runner::serve(route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    let started = Instant::now();
    assert_eq!(
        run(&runner, &staged, "large.bin", swift()).unwrap_err(),
        INVALID_RESPONSE
    );
    assert!(started.elapsed() < WAIT / 2);
    assert_eq!(runner.routed(), 1);
    drop(release);
}

#[test]
fn dropping_an_upload_stream_aborts_its_exchange() {
    let (closed, observed) = mpsc::channel();
    let route = move |head: String, mut socket: UnixStream| {
        let declared = declared_length(&head);
        let _ = closed.send((declared, read_up_to(&mut socket, declared).len()));
    };
    let runner = Runner::serve(route);
    let (_cancel, cancelled) = tokio::sync::watch::channel(false);
    let (mut feed, exchange) = runner
        .session
        .upload(&server(), head(LARGE), swift(), ends(swift()), cancelled)
        .unwrap();
    assert!(feed.send(vec![0_u8; CHUNK_BYTES]));
    assert!(settles(|| runner.routed() == 1));
    drop(exchange);
    drop(feed);
    let (declared, received) = observed.recv_timeout(WAIT / 2).unwrap();
    assert_eq!(declared as u64, LARGE);
    assert!((received as u64) < LARGE, "{received}");
    assert!(runner.session.is_alive());
}

#[test]
fn a_reader_that_stops_supplying_chunks_ends_as_a_local_failure() {
    use super::super::super::attachment_file_wire::upload_refusal;
    use crate::agent_file_source::UNREADABLE;
    let (route, held) = holding();
    let runner = Runner::serve(route);
    let (_cancel, cancelled) = tokio::sync::watch::channel(false);
    let policy = TransferPolicy {
        local: Duration::from_millis(150),
        ..swift()
    };
    let (mut feed, exchange) = runner
        .session
        .upload(&server(), head(LARGE), policy, ends(policy), cancelled)
        .unwrap();
    assert!(feed.send(vec![0_u8; CHUNK_BYTES]));
    std::thread::sleep(Duration::from_secs(1));
    assert!(!feed.send(vec![0_u8; CHUNK_BYTES]));
    assert_eq!(exchange.finish().unwrap_err(), Failure::Local);
    assert_eq!(upload_refusal(Failure::Local), UNREADABLE);
    assert!(runner.session.is_alive());
    held.reached.recv_timeout(WAIT).unwrap();
    drop(held.release);
}

fn impatient() -> StallPolicy {
    StallPolicy {
        quiet: Duration::from_millis(150),
        probe: Duration::from_millis(450),
        ..StallPolicy::DEFAULT
    }
}

#[test]
fn a_stalled_tunnel_aborts_the_upload_through_the_shared_verdict() {
    let (release, released) = mpsc::channel::<()>();
    let released = std::sync::Mutex::new(released);
    let route = move |head: String, mut socket: UnixStream| {
        if is_upload(&head) {
            let _ = released.lock().unwrap().recv_timeout(WAIT);
            return;
        }
        read_up_to(&mut socket, 1);
    };
    let runner = Runner::serve_with(impatient(), route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    let policy = TransferPolicy {
        total: Duration::from_secs(30),
        idle: Duration::from_secs(30),
        ..swift()
    };
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", policy));
        assert!(settles(|| runner.routed() >= 1));
        let started = Instant::now();
        assert_eq!(
            runner
                .session
                .request(&server(), "GET", "/v1/tasks", None, vec![])
                .unwrap_err(),
            CONNECTION_FAILED
        );
        assert_eq!(uploading.join().unwrap().unwrap_err(), CONNECTION_FAILED);
        assert!(started.elapsed() < WAIT / 2);
    });
    assert!(!runner.session.is_alive());
    drop(release);
}

#[test]
fn a_slow_progressing_upload_is_not_misread_as_a_dead_tunnel() {
    let (uploaded, finished) = mpsc::channel::<()>();
    let finished = std::sync::Mutex::new(finished);
    let route = move |head: String, mut socket: UnixStream| {
        if head.starts_with("GET /healthz ") {
            read_up_to(&mut socket, 1);
            return;
        }
        if !is_upload(&head) {
            let _ = finished.lock().unwrap().recv_timeout(WAIT);
            return respond(&mut socket, 200, b"{\"ok\":true}");
        }
        let declared = declared_length(&head);
        let mut body = Vec::with_capacity(declared);
        while body.len() < declared {
            let read = read_up_to(&mut socket, CHUNK_BYTES.min(declared - body.len()));
            if read.is_empty() {
                return;
            }
            body.extend(read);
            std::thread::sleep(Duration::from_millis(12));
        }
        let reply = stored_json(
            "large.bin",
            declared,
            &sha256(&body),
            "application/octet-stream",
        );
        respond(&mut socket, 201, reply.as_bytes());
        let _ = uploaded.send(());
    };
    let runner = Runner::serve_with(impatient(), route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let started = Instant::now();
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        let waiting = scope.spawn(|| {
            runner
                .session
                .request(&server(), "GET", "/v1/tasks", None, vec![])
        });
        let stored = uploading.join().unwrap().unwrap();
        assert_eq!(stored.attachment.bytes, LARGE);
        assert!(started.elapsed() > Duration::from_millis(900));
        assert_eq!(waiting.join().unwrap().unwrap()["ok"], true);
    });
    assert!(runner.session.is_alive());
}

#[test]
fn requests_failing_behind_a_slow_tail_cannot_stall_the_tunnel_before_the_transfer_settles() {
    let (drain, drained) = mpsc::channel::<()>();
    let drain = std::sync::Mutex::new(drain);
    let route = move |head: String, mut socket: UnixStream| {
        if !is_upload(&head) {
            read_up_to(&mut socket, 1);
            return;
        }
        let declared = declared_length(&head);
        let body = read_up_to(&mut socket, declared);
        let _ = drain.lock().unwrap().send(());
        std::thread::sleep(Duration::from_millis(2_000));
        let reply = stored_json(
            "large.bin",
            declared,
            &sha256(&body),
            "application/octet-stream",
        );
        respond(&mut socket, 201, reply.as_bytes());
    };
    let policy = impatient();
    let runner = Runner::serve_with(policy, route);
    let staged = StagedFile::sparse("large.bin", LARGE);
    std::thread::scope(|scope| {
        let waiting = scope.spawn(|| {
            runner
                .session
                .request(&server(), "GET", "/v1/tasks", None, vec![])
        });
        let started = Instant::now();
        let uploading = scope.spawn(|| run(&runner, &staged, "large.bin", swift()));
        drained.recv_timeout(WAIT).unwrap();
        runner.silence_identity();
        let unanswered = Instant::now();
        assert_eq!(
            runner
                .session
                .request(&server(), "GET", "/v1/projects", None, vec![])
                .unwrap_err(),
            CONNECTION_FAILED
        );
        assert!(unanswered.elapsed() >= policy.quiet);
        let stored = uploading.join().unwrap().unwrap();
        assert_eq!(stored.attachment.bytes, LARGE);
        assert!(unanswered.elapsed() > policy.quiet + policy.probe * 2);
        assert!(started.elapsed() > (policy.quiet + policy.probe) * 2);
        let settled = Instant::now();
        assert_eq!(waiting.join().unwrap().unwrap_err(), CONNECTION_FAILED);
        assert!(settled.elapsed() >= policy.quiet);
        assert!(settled.elapsed() < swift().idle / 2);
    });
    assert!(!runner.session.is_alive());
}
