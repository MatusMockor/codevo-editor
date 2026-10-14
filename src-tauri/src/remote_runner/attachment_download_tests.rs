use super::super::attachment_file_wire::{DOWNLOAD_MISMATCH, NOT_STORED};
use super::super::attachment_test_support::*;
use super::*;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::sync::Mutex;

struct Chosen {
    target: Option<PathBuf>,
    suggested: Mutex<Vec<String>>,
}

impl Chosen {
    fn path(target: PathBuf) -> Self {
        Self {
            target: Some(target),
            suggested: Mutex::default(),
        }
    }

    fn dismissed() -> Self {
        Self {
            target: None,
            suggested: Mutex::default(),
        }
    }
}

impl SaveDestination for Chosen {
    fn choose(&self, suggested: &str) -> Result<Option<PathBuf>, String> {
        self.suggested.lock().unwrap().push(suggested.into());
        Ok(self.target.clone())
    }
}

pub(super) fn request(name: &str, bytes: &[u8]) -> DownloadRequest {
    DownloadRequest {
        server_id: "fixture".into(),
        attachment_id: ATTACHMENT_ID.into(),
        name: name.into(),
        bytes: bytes.len() as u64,
        sha256: sha256(bytes),
    }
}

fn run(
    runner: &Runner,
    request: &DownloadRequest,
    chosen: &Chosen,
) -> Result<DownloadOutcome, String> {
    let transfers = AttachmentTransferState::default();
    let permit = transfers
        .admit_download()
        .expect("an idle lane admits the download");
    download(&runner.lease, &permit, request, chosen, swift())
}

pub(super) fn answering(
    status: u16,
    declared: Option<usize>,
    body: Vec<u8>,
) -> (
    impl Fn(String, UnixStream) + Send + Sync + 'static,
    std::sync::mpsc::Receiver<String>,
) {
    let (seen, heads) = std::sync::mpsc::channel();
    let route = move |head: String, mut socket: UnixStream| {
        let length = declared.map_or(String::new(), |length| {
            format!("Content-Length: {length}\r\n")
        });
        let reply = format!(
            "HTTP/1.1 {status} Test\r\nContent-Type: application/octet-stream\r\n{length}Connection: close\r\n\r\n"
        );
        let _ = socket.write_all(reply.as_bytes());
        let _ = socket.write_all(&body);
        let _ = seen.send(head);
    };
    (route, heads)
}

pub(super) fn saved() -> DownloadOutcome {
    DownloadOutcome {
        status: DownloadStatus::Saved,
    }
}

#[test]
fn a_download_streams_to_a_private_partial_file_and_renames_it_over_the_destination() {
    let bytes = content(300_000);
    let scratch = Scratch::new();
    let target = scratch.file("report.pdf", b"previous copy");
    let (route, heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let chosen = Chosen::path(target.clone());
    let request = request("../a:b/report.pdf", &bytes);
    assert_eq!(run(&runner, &request, &chosen).unwrap(), saved());
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
    let mode = std::fs::metadata(&target).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o644);
    assert_eq!(scratch.entries(), ["report.pdf"]);
    assert_eq!(*chosen.suggested.lock().unwrap(), ["_a_b_report.pdf"]);
    let head = heads.recv_timeout(WAIT).unwrap();
    assert!(head.starts_with(&format!("GET /v1/attachments/{ATTACHMENT_ID}/content ")));
    assert_eq!(header(&head, "authorization"), ["Bearer test-only"]);
    assert_eq!(header(&head, "x-codevo-runner-id"), [RUNNER_ID]);
    assert_eq!(runner.routed(), 1);
}

#[test]
fn a_body_without_a_declared_length_is_accepted_only_at_the_exact_size() {
    let bytes = content(150_000);
    for (sent, expected) in [
        (bytes.clone(), Ok(saved())),
        (content(150_001), Err(DOWNLOAD_MISMATCH.to_string())),
        (content(149_999), Err(DOWNLOAD_MISMATCH.to_string())),
    ] {
        let scratch = Scratch::new();
        let target = scratch.0.join("out.bin");
        let (route, _heads) = answering(200, None, sent);
        let runner = Runner::serve(route);
        let outcome = run(&runner, &request("out.bin", &bytes), &Chosen::path(target));
        assert_eq!(outcome, expected);
        let kept = if expected.is_ok() {
            vec!["out.bin".to_string()]
        } else {
            Vec::new()
        };
        assert_eq!(scratch.entries(), kept);
    }
}

#[test]
fn a_mismatching_download_removes_its_partial_file_and_keeps_the_destination() {
    let bytes = content(200_000);
    let mut corrupted = bytes.clone();
    corrupted[100_000] ^= 0xff;
    for (case, declared, sent, expected) in [
        ("hash", Some(bytes.len()), corrupted, DOWNLOAD_MISMATCH),
        (
            "short",
            Some(bytes.len() - 10),
            bytes[..bytes.len() - 10].to_vec(),
            DOWNLOAD_MISMATCH,
        ),
        (
            "long",
            Some(bytes.len() + 1),
            content(200_001),
            DOWNLOAD_MISMATCH,
        ),
        (
            "cut",
            Some(bytes.len()),
            bytes[..70_000].to_vec(),
            "Unable to read runner response.",
        ),
    ] {
        let scratch = Scratch::new();
        let target = scratch.file("kept.bin", b"previous copy");
        let (route, _heads) = answering(200, declared, sent);
        let runner = Runner::serve(route);
        assert_eq!(
            run(
                &runner,
                &request("kept.bin", &bytes),
                &Chosen::path(target.clone())
            )
            .unwrap_err(),
            expected,
            "{case}"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"previous copy", "{case}");
        assert_eq!(scratch.entries(), ["kept.bin"], "{case}");
    }
}

#[test]
fn runner_statuses_map_to_the_contract_strings_and_leave_no_file() {
    for (status, expected, alive) in [
        (404, NOT_STORED, true),
        (503, "Runner request failed (HTTP 503).", true),
        (206, "Runner request failed (HTTP 206).", true),
        (401, TUNNEL_CLOSED, false),
    ] {
        let bytes = content(1_000);
        let scratch = Scratch::new();
        let (route, _heads) = answering(status, Some(bytes.len()), bytes.clone());
        let runner = Runner::serve(route);
        let chosen = Chosen::path(scratch.0.join("out.bin"));
        assert_eq!(
            run(&runner, &request("out.bin", &bytes), &chosen).unwrap_err(),
            expected,
            "{status}"
        );
        assert!(scratch.entries().is_empty(), "{status}");
        assert_eq!(runner.session.is_alive(), alive, "{status}");
    }
}

#[test]
fn a_dismissed_dialog_cancels_without_contacting_the_runner() {
    let bytes = content(1_000);
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let chosen = Chosen::dismissed();
    assert_eq!(
        run(&runner, &request(".hidden", &bytes), &chosen).unwrap(),
        DownloadOutcome {
            status: DownloadStatus::Cancelled
        }
    );
    assert_eq!(*chosen.suggested.lock().unwrap(), ["hidden"]);
    assert_eq!(runner.routed(), 0);
}

#[test]
fn an_unwritable_or_unusable_destination_fails_without_leaving_a_partial_file() {
    let bytes = content(50_000);
    let scratch = Scratch::new();
    let locked = scratch.0.join("locked");
    std::fs::create_dir(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
    let occupied = scratch.0.join("occupied");
    std::fs::create_dir(&occupied).unwrap();
    std::fs::write(occupied.join("inside"), b"x").unwrap();
    let cases = [
        ("read-only directory", locked.join("out.bin"), 0),
        ("missing directory", scratch.0.join("missing/out.bin"), 0),
        ("relative path", PathBuf::from("out.bin"), 0),
        ("directory destination", occupied.clone(), 1),
    ];
    let applicable = cases
        .into_iter()
        .filter(|(case, _, _)| !privileged() || *case != "read-only directory");
    for (case, target, routed) in applicable {
        let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
        let runner = Runner::serve(route);
        assert_eq!(
            run(&runner, &request("out.bin", &bytes), &Chosen::path(target)).unwrap_err(),
            SAVE_FAILED,
            "{case}"
        );
        assert_eq!(runner.routed(), routed, "{case}");
        assert_eq!(scratch.entries(), ["locked", "occupied"], "{case}");
    }
    assert!(std::fs::read_dir(&locked).unwrap().next().is_none());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
}

struct Guarded {
    _scratch: Scratch,
    directory: PathBuf,
    target: PathBuf,
}

impl Guarded {
    fn new() -> Self {
        let scratch = Scratch::new();
        let directory = scratch.0.join("guarded");
        std::fs::create_dir(&directory).unwrap();
        let target = directory.join("report.pdf");
        std::fs::write(&target, b"previous copy").unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o555)).unwrap();
        Self {
            _scratch: scratch,
            directory,
            target,
        }
    }

    fn entries(&self) -> Vec<String> {
        std::fs::read_dir(&self.directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }
}

impl Drop for Guarded {
    fn drop(&mut self) {
        let _ = std::fs::set_permissions(&self.directory, std::fs::Permissions::from_mode(0o755));
    }
}

#[test]
fn an_existing_destination_survives_when_its_folder_refuses_a_sibling_file() {
    let bytes = content(200_000);
    let mut corrupted = bytes.clone();
    corrupted[150_000] ^= 0xff;
    for (case, status, declared, sent) in [
        ("before the body", 404, 0, Vec::new()),
        ("mid-body", 200, bytes.len(), bytes[..70_000].to_vec()),
        ("hash mismatch", 200, bytes.len(), corrupted),
        ("complete", 200, bytes.len(), bytes.clone()),
    ] {
        let guarded = Guarded::new();
        let (route, _heads) = answering(status, Some(declared), sent);
        let runner = Runner::serve(route);
        let chosen = Chosen::path(guarded.target.clone());
        let outcome = run(&runner, &request("report.pdf", &bytes), &chosen);
        let replaced = privileged() && case == "complete";
        match (privileged(), replaced) {
            (false, _) => {
                assert_eq!(outcome, Err(SAVE_FAILED.to_string()), "{case}");
                assert_eq!(runner.routed(), 0, "{case}");
            }
            (true, true) => assert_eq!(outcome, Ok(saved()), "{case}"),
            (true, false) => assert!(outcome.is_err(), "{case}"),
        }
        let expected = match replaced {
            true => bytes.as_slice(),
            false => b"previous copy".as_slice(),
        };
        assert_eq!(std::fs::read(&guarded.target).unwrap(), expected, "{case}");
        assert_eq!(guarded.entries(), ["report.pdf"], "{case}");
    }
}

struct Stalling {
    reached: std::sync::mpsc::Receiver<()>,
    release: std::sync::mpsc::Sender<()>,
}

fn stalling(
    body: Vec<u8>,
    first: usize,
) -> (
    impl Fn(String, UnixStream) + Send + Sync + 'static,
    Stalling,
) {
    let (reach, reached) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel::<()>();
    let released = Mutex::new(released);
    let route = move |_head: String, mut socket: UnixStream| {
        let reply = format!(
            "HTTP/1.1 200 Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = socket.write_all(reply.as_bytes());
        let _ = socket.write_all(&body[..first]);
        let _ = reach.send(());
        if released.lock().unwrap().recv_timeout(WAIT).is_ok() {
            let _ = socket.write_all(&body[first..]);
        }
    };
    (route, Stalling { reached, release })
}

#[test]
fn a_revoked_lease_or_closed_tunnel_aborts_the_download_and_removes_its_partial_file() {
    let bytes = content(400_000);
    for revoke in [true, false] {
        let (route, stalling) = stalling(bytes.clone(), 100_000);
        let runner = Runner::serve(route);
        let scratch = Scratch::new();
        let chosen = Chosen::path(scratch.0.join("out.bin"));
        let request = request("out.bin", &bytes);
        std::thread::scope(|scope| {
            let downloading = scope.spawn(|| run(&runner, &request, &chosen));
            stalling.reached.recv_timeout(WAIT).unwrap();
            assert!(settles(|| scratch.entries().len() == 1));
            let started = std::time::Instant::now();
            match revoke {
                true => runner.lease.revoke(),
                false => runner.session.close(),
            }
            assert_eq!(downloading.join().unwrap().unwrap_err(), TUNNEL_CLOSED);
            assert!(started.elapsed() < WAIT / 2);
        });
        assert!(scratch.entries().is_empty(), "{revoke}");
        drop(stalling.release);
    }
}

#[test]
fn a_partial_entry_swapped_mid_download_is_neither_published_nor_deleted() {
    let bytes = content(400_000);
    let (route, stalling) = stalling(bytes.clone(), 100_000);
    let runner = Runner::serve(route);
    let scratch = Scratch::new();
    let target = scratch.0.join("out.bin");
    let chosen = Chosen::path(target.clone());
    let request = request("out.bin", &bytes);
    std::thread::scope(|scope| {
        let downloading = scope.spawn(|| run(&runner, &request, &chosen));
        stalling.reached.recv_timeout(WAIT).unwrap();
        assert!(settles(|| scratch.entries().len() == 1));
        let partial = scratch.0.join(&scratch.entries()[0]);
        std::fs::rename(&partial, scratch.0.join("moved.part")).unwrap();
        std::fs::write(&partial, b"foreign").unwrap();
        stalling.release.send(()).unwrap();
        assert_eq!(downloading.join().unwrap().unwrap_err(), SAVE_FAILED);
        assert_eq!(std::fs::read(&partial).unwrap(), b"foreign");
    });
    assert!(!target.exists());
    let entries = scratch.entries();
    assert_eq!(entries.len(), 2);
    assert!(entries.contains(&"moved.part".to_string()));
}

#[test]
fn dropping_a_download_stream_aborts_its_exchange() {
    let (closed, observed) = std::sync::mpsc::channel();
    let route = move |_head: String, mut socket: UnixStream| {
        let reply = "HTTP/1.1 200 Test\r\nContent-Length: 33554432\r\nConnection: close\r\n\r\n";
        let _ = socket.write_all(reply.as_bytes());
        let chunk = vec![7_u8; 64 * 1024];
        let mut written = 0_usize;
        while written < 33_554_432 && socket.write_all(&chunk).is_ok() {
            written += chunk.len();
        }
        let _ = closed.send(written);
    };
    let runner = Runner::serve(route);
    let path = format!("/v1/attachments/{ATTACHMENT_ID}/content");
    let (mut feed, exchange) = runner
        .session
        .download(&server(), path, 33_554_432, swift(), ends(swift()))
        .unwrap();
    assert!(feed.next().is_some());
    drop(exchange);
    drop(feed);
    let written = observed.recv_timeout(WAIT / 2).unwrap();
    assert!(written < 33_554_432, "{written}");
    assert!(runner.session.is_alive());
}

#[test]
fn a_consumer_that_stops_writing_ends_as_a_local_failure() {
    use super::super::transport::Failure;
    let (route, _heads) = answering(200, Some(8 * 1024 * 1024), vec![7_u8; 8 * 1024 * 1024]);
    let runner = Runner::serve(route);
    let policy = TransferPolicy {
        local: std::time::Duration::from_millis(150),
        ..swift()
    };
    let path = format!("/v1/attachments/{ATTACHMENT_ID}/content");
    let (mut feed, exchange) = runner
        .session
        .download(&server(), path, 8 * 1024 * 1024, policy, ends(policy))
        .unwrap();
    assert!(feed.next().is_some());
    std::thread::sleep(std::time::Duration::from_secs(1));
    while feed.next().is_some() {}
    assert_eq!(exchange.finish(), Err(Failure::Local));
    assert_eq!(
        super::super::attachment_file_wire::download_refusal(Failure::Local),
        SAVE_FAILED
    );
    assert!(runner.session.is_alive());
}

#[test]
fn a_connection_replaced_while_the_dialog_is_open_is_refused_before_any_request() {
    struct Revoking<'a>(&'a Runner, PathBuf);
    impl SaveDestination for Revoking<'_> {
        fn choose(&self, _suggested: &str) -> Result<Option<PathBuf>, String> {
            self.0.lease.revoke();
            Ok(Some(self.1.clone()))
        }
    }
    let bytes = content(1_000);
    let scratch = Scratch::new();
    let (route, _heads) = answering(200, Some(bytes.len()), bytes.clone());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let chooser = Revoking(&runner, scratch.0.join("out.bin"));
    assert_eq!(
        download(
            &runner.lease,
            &permit,
            &request("out.bin", &bytes),
            &chooser,
            swift()
        )
        .unwrap_err(),
        LEASE_CHANGED
    );
    assert_eq!(runner.routed(), 0);
    assert!(scratch.entries().is_empty());
}

#[test]
fn a_stalled_download_times_out_and_removes_its_partial_file() {
    let bytes = content(100_000);
    let partial = bytes[..40_000].to_vec();
    let route = move |_head: String, mut socket: UnixStream| {
        let reply = format!(
            "HTTP/1.1 200 Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            100_000
        );
        let _ = socket.write_all(reply.as_bytes());
        let _ = socket.write_all(&partial);
        read_up_to(&mut socket, 1);
    };
    let runner = Runner::serve(route);
    let scratch = Scratch::new();
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let policy = TransferPolicy {
        total: std::time::Duration::from_secs(20),
        idle: std::time::Duration::from_millis(300),
        ..swift()
    };
    let chosen = Chosen::path(scratch.0.join("out.bin"));
    let started = std::time::Instant::now();
    assert_eq!(
        download(
            &runner.lease,
            &permit,
            &request("out.bin", &bytes),
            &chosen,
            policy
        )
        .unwrap_err(),
        TIMED_OUT
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert!(scratch.entries().is_empty());
    assert!(runner.session.is_alive());
}

#[test]
fn only_one_save_dialog_is_open_at_a_time_and_an_invalid_request_opens_none() {
    struct Reentrant<'a>(&'a AttachmentTransferState, &'a Runner);
    impl SaveDestination for Reentrant<'_> {
        fn choose(&self, _suggested: &str) -> Result<Option<PathBuf>, String> {
            let second = self.0.admit_download()?;
            let nested = download(
                &self.1.lease,
                &second,
                &request("out.bin", b"x"),
                &Chosen::dismissed(),
                swift(),
            );
            assert_eq!(
                nested.unwrap_err(),
                "Too many server requests are still in progress; retry shortly"
            );
            Ok(None)
        }
    }
    let (route, _heads) = answering(200, Some(1), b"x".to_vec());
    let runner = Runner::serve(route);
    let transfers = AttachmentTransferState::default();
    let permit = transfers.admit_download().unwrap();
    let chooser = Reentrant(&transfers, &runner);
    assert_eq!(
        download(
            &runner.lease,
            &permit,
            &request("out.bin", b"x"),
            &chooser,
            swift()
        )
        .unwrap(),
        DownloadOutcome {
            status: DownloadStatus::Cancelled
        }
    );
    let mut invalid = request("out.bin", b"x");
    invalid.sha256 = "ABC".into();
    let chosen = Chosen::dismissed();
    assert!(download(&runner.lease, &permit, &invalid, &chosen, swift()).is_err());
    assert!(chosen.suggested.lock().unwrap().is_empty());
    drop(permit);
    assert_eq!(transfers.in_flight(), (0, 0));
    assert_eq!(runner.routed(), 0);
}
