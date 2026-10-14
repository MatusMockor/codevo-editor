use super::super::attachment_file_wire::UPDATE_SERVER;
use super::super::attachment_test_support::*;
use super::super::attachment_transfers::WORKER_THREADS;
use super::super::commands::OPERATIONS_BUSY;
use super::tests::run;
use super::*;
use crate::agent_file_source::{CHUNK_BYTES, UNREADABLE};
use std::os::unix::net::UnixStream;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const LARGE: u64 = 8 * 1024 * 1024;
const OTHER_ID: &str = "00000000-0000-4000-8000-000000000002";

struct Block {
    entered: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
    woke: mpsc::Receiver<()>,
}

struct Blocked {
    served: usize,
    enter: mpsc::Sender<()>,
    released: mpsc::Receiver<()>,
    wake: mpsc::Sender<()>,
}

impl ChunkSource for Blocked {
    fn next(&mut self) -> Result<Option<Vec<u8>>, String> {
        self.served += 1;
        if self.served > 1 {
            let _ = self.enter.send(());
            let _ = self.released.recv_timeout(WAIT);
            let _ = self.wake.send(());
        }
        Ok(Some(vec![0_u8; CHUNK_BYTES]))
    }

    fn digest(&self) -> Option<String> {
        None
    }
}

fn blocked_after_one_chunk() -> (SourcePlan, Block) {
    let (enter, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (wake, woke) = mpsc::channel();
    let source = Blocked {
        served: 0,
        enter,
        released,
        wake,
    };
    let plan = SourcePlan {
        length: LARGE,
        media_type: "application/octet-stream",
        open: Box::new(move || Ok(Box::new(source) as Box<dyn ChunkSource>)),
    };
    let block = Block {
        entered,
        release,
        woke,
    };
    (plan, block)
}

fn blocked_while_opening() -> (SourcePlan, Block) {
    let (enter, entered) = mpsc::channel();
    let (release, released) = mpsc::channel::<()>();
    let (wake, woke) = mpsc::channel();
    let plan = SourcePlan {
        length: LARGE,
        media_type: "application/octet-stream",
        open: Box::new(move || {
            let _ = enter.send(());
            let _ = released.recv_timeout(WAIT);
            let _ = wake.send(());
            Err(UNREADABLE.into())
        }),
    };
    let block = Block {
        entered,
        release,
        woke,
    };
    (plan, block)
}

fn request(attachment_id: &str) -> UploadFileRequest {
    UploadFileRequest {
        server_id: "fixture".into(),
        attachment_id: attachment_id.into(),
        source_id: "00000000-0000-4000-8000-000000000001".into(),
        name: "large.bin".into(),
    }
}

fn draining() -> impl Fn(String, UnixStream) + Send + Sync + 'static {
    |head: String, mut socket: UnixStream| {
        read_up_to(&mut socket, declared_length(&head));
    }
}

fn impatient() -> TransferPolicy {
    TransferPolicy {
        local: Duration::from_millis(200),
        ..swift()
    }
}

#[test]
fn cancel_settles_the_upload_at_once_while_the_reader_is_still_blocked() {
    let runner = Runner::serve(draining());
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    let (plan, block) = blocked_after_one_chunk();
    let request = request(ATTACHMENT_ID);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| {
            let permit = permit;
            upload_from(
                &runner.lease,
                &permit,
                &request,
                swift(),
                budget(swift()),
                plan,
            )
        });
        block.entered.recv_timeout(WAIT).unwrap();
        let started = Instant::now();
        transfers.cancel_upload("fixture", ATTACHMENT_ID);
        assert_eq!(uploading.join().unwrap().unwrap_err(), UPLOAD_CANCELLED);
        assert!(started.elapsed() < WAIT / 4);
    });
    assert!(block.woke.try_recv().is_err());
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(transfers.workers(), (1, 1));
    assert!(transfers.admit_upload("fixture", ATTACHMENT_ID).is_ok());
    assert!(runner.session.is_alive());
    block.release.send(()).unwrap();
    block.woke.recv_timeout(WAIT).unwrap();
    assert!(settles(|| transfers.workers() == (0, 0)));
}

#[test]
fn a_blocked_read_settles_at_the_local_bound_with_the_unreadable_error() {
    let runner = Runner::serve(draining());
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    let (plan, block) = blocked_after_one_chunk();
    let started = Instant::now();
    let outcome = upload_from(
        &runner.lease,
        &permit,
        &request(ATTACHMENT_ID),
        impatient(),
        budget(impatient()),
        plan,
    );
    assert_eq!(outcome.unwrap_err(), UNREADABLE);
    assert!(started.elapsed() >= impatient().local);
    assert!(started.elapsed() < WAIT / 4);
    assert!(block.woke.try_recv().is_err());
    drop(permit);
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(transfers.workers(), (1, 1));
    assert!(runner.session.is_alive());
    assert_eq!(runner.routed(), 1);
    drop(block.release);
    assert!(settles(|| transfers.workers() == (0, 0)));
}

#[test]
fn a_blocked_open_settles_at_the_local_bound_or_on_cancel_before_any_request() {
    let runner = Runner::serve(draining());
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    let (plan, block) = blocked_while_opening();
    let outcome = upload_from(
        &runner.lease,
        &permit,
        &request(ATTACHMENT_ID),
        impatient(),
        budget(impatient()),
        plan,
    );
    assert_eq!(outcome.unwrap_err(), UNREADABLE);
    drop(permit);
    let permit = transfers.admit_upload("fixture", OTHER_ID).unwrap();
    let (plan, second) = blocked_while_opening();
    let request = request(OTHER_ID);
    std::thread::scope(|scope| {
        let uploading = scope.spawn(|| {
            let permit = permit;
            upload_from(
                &runner.lease,
                &permit,
                &request,
                swift(),
                budget(swift()),
                plan,
            )
        });
        second.entered.recv_timeout(WAIT).unwrap();
        let started = Instant::now();
        transfers.cancel_upload("fixture", OTHER_ID);
        assert_eq!(uploading.join().unwrap().unwrap_err(), UPLOAD_CANCELLED);
        assert!(started.elapsed() < WAIT / 4);
    });
    assert_eq!(runner.routed(), 0);
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(transfers.workers(), (2, 2));
    drop((block.release, second.release));
    assert!(settles(|| transfers.workers() == (0, 0)));
}

#[test]
fn abandoned_readers_are_bounded_and_the_lane_recovers_when_they_wake() {
    let runner = Runner::serve(draining());
    let transfers = AttachmentTransferState::default();
    let hasty = TransferPolicy {
        local: Duration::from_millis(20),
        ..swift()
    };
    let mut blocks = Vec::new();
    for _ in 0..WORKER_THREADS {
        let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
        let (plan, block) = blocked_while_opening();
        let request = request(ATTACHMENT_ID);
        let outcome = upload_from(&runner.lease, &permit, &request, hasty, budget(hasty), plan);
        assert_eq!(outcome.unwrap_err(), UNREADABLE);
        blocks.push(block);
    }
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(transfers.workers(), (WORKER_THREADS, WORKER_THREADS));
    assert_eq!(
        transfers.admit_upload("fixture", ATTACHMENT_ID).err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    assert_eq!(
        transfers.admit_download().err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    assert_eq!(transfers.workers().0, WORKER_THREADS);
    let woken = blocks.pop().unwrap();
    drop(woken.release);
    woken.woke.recv_timeout(WAIT).unwrap();
    assert!(settles(|| transfers.workers().0 == WORKER_THREADS - 1));
    let admitted = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    assert_eq!(
        transfers.admit_download().err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    drop(admitted);
    assert!(transfers.admit_download().is_ok());
    drop(blocks);
    assert!(settles(|| transfers.workers() == (0, 0)));
    assert_eq!(runner.routed(), 0);
}

#[test]
fn a_connection_lost_while_the_source_is_opening_is_reported_at_once() {
    for revoke in [true, false] {
        let runner = Runner::serve(draining());
        let transfers = AttachmentTransferState::default();
        let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
        let (plan, block) = blocked_while_opening();
        let request = request(ATTACHMENT_ID);
        std::thread::scope(|scope| {
            let uploading = scope.spawn(|| {
                let permit = permit;
                upload_from(
                    &runner.lease,
                    &permit,
                    &request,
                    swift(),
                    budget(swift()),
                    plan,
                )
            });
            block.entered.recv_timeout(WAIT).unwrap();
            let started = Instant::now();
            let expected = match revoke {
                true => {
                    runner.lease.revoke();
                    LEASE_CHANGED
                }
                false => {
                    runner.session.close();
                    TUNNEL_CLOSED
                }
            };
            assert_eq!(uploading.join().unwrap().unwrap_err(), expected);
            assert!(started.elapsed() < WAIT / 4);
        });
        assert!(block.woke.try_recv().is_err());
        assert_eq!(runner.routed(), 0);
        assert_eq!(transfers.workers(), (1, 1));
        drop(block.release);
        assert!(settles(|| transfers.workers() == (0, 0)));
    }
}

#[test]
fn opening_and_transport_share_one_operation_deadline() {
    let (enter, entered) = mpsc::channel();
    let source = Blocked {
        served: 1,
        enter,
        released: mpsc::channel().1,
        wake: mpsc::channel().0,
    };
    let opening = Duration::from_millis(600);
    let plan = SourcePlan {
        length: LARGE,
        media_type: "application/octet-stream",
        open: Box::new(move || {
            std::thread::sleep(opening);
            Ok(Box::new(source) as Box<dyn ChunkSource>)
        }),
    };
    let runner = Runner::serve(|head: String, mut socket: UnixStream| {
        read_up_to(&mut socket, declared_length(&head));
        read_up_to(&mut socket, 1);
    });
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_upload("fixture", ATTACHMENT_ID).unwrap();
    let policy = TransferPolicy {
        total: Duration::from_millis(900),
        ..swift()
    };
    let started = Instant::now();
    let outcome = upload_from(
        &runner.lease,
        &permit,
        &request(ATTACHMENT_ID),
        policy,
        budget(policy),
        plan,
    );
    assert_eq!(outcome.unwrap_err(), TIMED_OUT);
    assert!(started.elapsed() >= policy.total);
    assert!(started.elapsed() < opening + policy.total - Duration::from_millis(150));
    entered.recv_timeout(WAIT).unwrap();
    assert_eq!(runner.routed(), 1);
}

#[test]
fn a_runner_without_the_file_capability_is_refused_before_any_byte_is_sent() {
    let mut textual: serde_json::Value = serde_json::from_str(&descriptor(None)).unwrap();
    textual["capabilities"]["fileAttachments"] = "true".into();
    for described in [
        descriptor(None),
        descriptor(Some(false)),
        textual.to_string(),
    ] {
        for file in ["notes.txt", "photo.png", "report.pdf"] {
            let staged = StagedFile::holding(file, b"legacy-compatible content");
            let (route, _received) = storing(201, |_| "{}".into());
            let runner = Runner::serve_describing(described.clone(), route);
            assert_eq!(
                run(&runner, &staged, file, swift()).unwrap_err(),
                UPDATE_SERVER,
                "{described} {file}"
            );
            assert_eq!(runner.routed(), 0, "{described} {file}");
            assert!(runner.session.is_alive());
        }
    }
    assert_eq!(UPDATE_SERVER, "Update this server to attach files.");
}
