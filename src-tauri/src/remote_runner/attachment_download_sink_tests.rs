use super::super::attachment_download_sink::{Partial, Sink, SinkOpener};
use super::super::attachment_test_support::*;
use super::tests::{answering, request, saved};
use super::*;
use std::os::unix::fs::PermissionsExt;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn mode(path: &std::path::Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn partial_entry(scratch: &Scratch) -> PathBuf {
    let entries = scratch.entries();
    let partial = entries
        .iter()
        .find(|name| name.starts_with(".codevo-download-") && name.ends_with(".part"))
        .expect("a partial file exists");
    scratch.0.join(partial)
}

#[test]
fn a_sibling_partial_file_is_private_until_it_is_published_with_the_final_mode() {
    let scratch = Scratch::new();
    let target = scratch.file("report.pdf", b"previous copy");
    let mut partial = Box::new(Partial::create(&target).unwrap());
    assert_eq!(mode(&partial_entry(&scratch)), 0o600);
    partial.write(b"new copy").unwrap();
    partial.prepare().unwrap();
    assert_eq!(mode(&partial_entry(&scratch)), 0o644);
    assert_eq!(std::fs::read(&target).unwrap(), b"previous copy");
    partial.commit().unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"new copy");
    assert_eq!(mode(&target), 0o644);
    assert_eq!(scratch.entries(), ["report.pdf"]);
}

#[test]
fn an_in_place_file_is_created_exclusively_and_removed_unless_published() {
    let scratch = Scratch::new();
    let target = scratch.0.join("fresh.bin");
    let mut partial = Box::new(Partial::in_place(&target).unwrap());
    assert_eq!(mode(&target), 0o600);
    partial.write(b"payload").unwrap();
    partial.prepare().unwrap();
    partial.commit().unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"payload");
    assert_eq!(mode(&target), 0o644);
    std::fs::remove_file(&target).unwrap();
    let mut abandoned = Partial::in_place(&target).unwrap();
    abandoned.write(b"partial").unwrap();
    drop(abandoned);
    assert!(scratch.entries().is_empty());
}

#[test]
fn an_in_place_file_never_replaces_an_existing_destination_or_follows_a_link() {
    let scratch = Scratch::new();
    let existing = scratch.file("report.pdf", b"previous copy");
    assert_eq!(Partial::in_place(&existing).err(), Some(SAVE_FAILED.into()));
    assert_eq!(std::fs::read(&existing).unwrap(), b"previous copy");
    let link = scratch.0.join("link.bin");
    std::os::unix::fs::symlink(scratch.0.join("elsewhere.bin"), &link).unwrap();
    assert_eq!(Partial::in_place(&link).err(), Some(SAVE_FAILED.into()));
    assert_eq!(scratch.entries(), ["link.bin", "report.pdf"]);
}

#[test]
fn a_swapped_partial_entry_is_refused_at_publication_and_left_alone_on_cleanup() {
    for publish in [true, false] {
        let scratch = Scratch::new();
        let target = scratch.0.join("out.bin");
        let mut partial = Box::new(Partial::create(&target).unwrap());
        partial.write(b"downloaded").unwrap();
        let entry = partial_entry(&scratch);
        std::fs::rename(&entry, scratch.0.join("moved.part")).unwrap();
        std::fs::write(&entry, b"foreign").unwrap();
        if publish {
            assert_eq!(partial.prepare(), Err(SAVE_FAILED.to_string()));
        }
        drop(partial);
        assert!(!target.exists(), "{publish}");
        assert_eq!(std::fs::read(&entry).unwrap(), b"foreign", "{publish}");
        assert_eq!(
            std::fs::read(scratch.0.join("moved.part")).unwrap(),
            b"downloaded"
        );
    }
}

struct Hooked {
    inner: Box<dyn Sink>,
    writes: usize,
    on_write: Box<dyn FnMut(usize) + Send>,
    on_prepare: Box<dyn FnMut() + Send>,
}

impl Sink for Hooked {
    fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.writes += 1;
        (self.on_write)(self.writes);
        self.inner.write(chunk)
    }

    fn prepare(&mut self) -> Result<(), String> {
        (self.on_prepare)();
        self.inner.prepare()
    }

    fn commit(self: Box<Self>) -> Result<(), String> {
        self.inner.commit()
    }
}

fn hooked(
    on_write: impl FnMut(usize) + Send + 'static,
    on_prepare: impl FnMut() + Send + 'static,
) -> SinkOpener {
    Box::new(move |target| {
        let partial = Partial::create(target)?;
        Ok(Box::new(Hooked {
            inner: Box::new(partial),
            writes: 0,
            on_write: Box::new(on_write),
            on_prepare: Box::new(on_prepare),
        }) as Box<dyn Sink>)
    })
}

struct Block {
    entered: mpsc::Receiver<()>,
    release: mpsc::Sender<()>,
}

fn blocking() -> (impl FnMut() + Send + 'static, Block) {
    let (enter, entered) = mpsc::channel();
    let (release, released) = mpsc::channel::<()>();
    let block = move || {
        let _ = enter.send(());
        let _ = released.recv_timeout(WAIT);
    };
    (block, Block { entered, release })
}

fn impatient() -> TransferPolicy {
    TransferPolicy {
        local: Duration::from_millis(200),
        ..swift()
    }
}

#[test]
fn an_unhooked_sink_saves_exactly_like_the_native_path() {
    let bytes = content(300_000);
    let scratch = Scratch::new();
    let target = scratch.0.join("out.bin");
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let outcome = download_into(
        &runner.lease,
        &permit,
        &request("out.bin", &bytes),
        swift(),
        budget(swift()),
        target.clone(),
        hooked(|_| {}, || {}),
    );
    assert_eq!(outcome, Ok(saved()));
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
    assert_eq!(scratch.entries(), ["out.bin"]);
    assert!(settles(|| transfers.workers() == (0, 0)));
}

#[test]
fn a_blocked_write_settles_at_the_local_bound_and_the_woken_worker_cleans_up() {
    let bytes = vec![7_u8; 8 * 1024 * 1024];
    let scratch = Scratch::new();
    let target = scratch.0.join("out.bin");
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let (mut block, blocked) = blocking();
    let on_write = move |write: usize| {
        if write == 2 {
            block();
        }
    };
    let started = Instant::now();
    let outcome = download_into(
        &runner.lease,
        &permit,
        &request("out.bin", &bytes),
        impatient(),
        budget(impatient()),
        target.clone(),
        hooked(on_write, || {}),
    );
    assert_eq!(outcome, Err(SAVE_FAILED.to_string()));
    assert!(started.elapsed() >= impatient().local);
    assert!(started.elapsed() < WAIT / 2);
    blocked.entered.recv_timeout(WAIT).unwrap();
    drop(permit);
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(transfers.workers(), (1, 1));
    assert!(transfers.admit_download().is_ok());
    assert!(partial_entry(&scratch).exists());
    assert!(runner.session.is_alive());
    blocked.release.send(()).unwrap();
    assert!(settles(|| transfers.workers() == (0, 0)));
    assert!(scratch.entries().is_empty());
}

#[test]
fn a_worker_blocked_in_preparation_is_abandoned_and_never_renames_when_it_wakes() {
    let bytes = content(50_000);
    let scratch = Scratch::new();
    let target = scratch.file("out.bin", b"previous copy");
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let (block, blocked) = blocking();
    let started = Instant::now();
    let outcome = download_into(
        &runner.lease,
        &permit,
        &request("out.bin", &bytes),
        impatient(),
        budget(impatient()),
        target.clone(),
        hooked(|_| {}, block),
    );
    assert_eq!(outcome, Err(SAVE_FAILED.to_string()));
    assert!(started.elapsed() >= impatient().local);
    assert!(started.elapsed() < WAIT / 2);
    blocked.entered.recv_timeout(WAIT).unwrap();
    assert_eq!(transfers.workers(), (1, 1));
    assert_eq!(std::fs::read(&target).unwrap(), b"previous copy");
    blocked.release.send(()).unwrap();
    assert!(settles(|| transfers.workers() == (0, 0)));
    assert_eq!(std::fs::read(&target).unwrap(), b"previous copy");
    assert_eq!(scratch.entries(), ["out.bin"]);
}

#[test]
fn a_connection_lost_during_preparation_prevents_the_rename() {
    let bytes = content(50_000);
    for revoke in [true, false] {
        let scratch = Scratch::new();
        let target = scratch.file("out.bin", b"previous copy");
        let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
        let runner = Runner::serve(route);
        let transfers = AttachmentTransferState::default();
        let permit = transfers.admit_download().unwrap();
        let (lease, session) = (runner.lease.clone(), runner.session.clone());
        let on_prepare = move || match revoke {
            true => lease.revoke(),
            false => session.close(),
        };
        let outcome = download_into(
            &runner.lease,
            &permit,
            &request("out.bin", &bytes),
            swift(),
            budget(swift()),
            target.clone(),
            hooked(|_| {}, on_prepare),
        );
        let changed = outcome == Err(LEASE_CHANGED.to_string());
        let closed = !revoke && outcome == Err(TUNNEL_CLOSED.to_string());
        assert!(changed || closed, "{revoke} {outcome:?}");
        assert_eq!(std::fs::read(&target).unwrap(), b"previous copy");
        assert_eq!(scratch.entries(), ["out.bin"], "{revoke}");
        assert_eq!(runner.routed(), 1);
    }
}

#[test]
fn a_blocked_destination_open_settles_at_the_local_bound_before_any_request() {
    let bytes = content(1_000);
    let scratch = Scratch::new();
    let target = scratch.0.join("out.bin");
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let (mut block, blocked) = blocking();
    let open: SinkOpener = Box::new(move |target| {
        block();
        let partial = Partial::create(target)?;
        Ok(Box::new(partial) as Box<dyn Sink>)
    });
    let outcome = download_into(
        &runner.lease,
        &permit,
        &request("out.bin", &bytes),
        impatient(),
        budget(impatient()),
        target,
        open,
    );
    assert_eq!(outcome, Err(SAVE_FAILED.to_string()));
    assert_eq!(runner.routed(), 0);
    blocked.entered.recv_timeout(WAIT).unwrap();
    assert_eq!(transfers.workers(), (1, 1));
    blocked.release.send(()).unwrap();
    assert!(settles(|| transfers.workers() == (0, 0)));
    assert!(scratch.entries().is_empty());
}

#[test]
fn the_commit_is_cleared_only_with_authority_and_before_the_deadline() {
    use super::super::attachment_download_sink::cleared;
    use super::super::attachment_watch::Budget;
    let start = Instant::now();
    let budget = Budget::starting(start, Duration::from_secs(900));
    let late = start + Duration::from_secs(900);
    assert_eq!(cleared(true, start, budget), Ok(()));
    assert_eq!(
        cleared(true, late - Duration::from_millis(1), budget),
        Ok(())
    );
    assert_eq!(cleared(true, late, budget), Err(SAVE_FAILED));
    assert_eq!(cleared(false, start, budget), Err(LEASE_CHANGED));
    assert_eq!(cleared(false, late, budget), Err(LEASE_CHANGED));
}

#[test]
fn a_connection_lost_while_the_worker_is_blocked_is_reported_at_once() {
    let bytes = content(50_000);
    for (revoke, preparing) in [(true, false), (false, false), (true, true), (false, true)] {
        let scratch = Scratch::new();
        let target = scratch.file("out.bin", b"previous copy");
        let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
        let runner = Runner::serve(route);
        let transfers = AttachmentTransferState::default();
        let permit = transfers.admit_download().unwrap();
        let (mut block, blocked) = blocking();
        let open: SinkOpener = match preparing {
            true => hooked(|_| {}, block),
            false => Box::new(move |target| {
                block();
                let partial = Partial::create(target)?;
                Ok(Box::new(partial) as Box<dyn Sink>)
            }),
        };
        let request = request("out.bin", &bytes);
        std::thread::scope(|scope| {
            let downloading = scope.spawn(|| {
                let policy = swift();
                let target = target.clone();
                download_into(
                    &runner.lease,
                    &permit,
                    &request,
                    policy,
                    budget(policy),
                    target,
                    open,
                )
            });
            blocked.entered.recv_timeout(WAIT).unwrap();
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
            let outcome = downloading.join().unwrap();
            assert_eq!(outcome, Err(expected.to_string()), "{revoke} {preparing}");
            assert!(started.elapsed() < WAIT / 4, "{revoke} {preparing}");
        });
        assert_eq!(transfers.workers(), (1, 1));
        blocked.release.send(()).unwrap();
        assert!(settles(|| transfers.workers() == (0, 0)));
        assert_eq!(std::fs::read(&target).unwrap(), b"previous copy");
        assert_eq!(scratch.entries(), ["out.bin"], "{revoke} {preparing}");
    }
}
