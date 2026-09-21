use super::*;
use std::{
    path::PathBuf,
    process::Command,
    sync::atomic::AtomicUsize,
    time::{Duration, Instant},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "codevo-local-clone-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn request(&self, index: usize) -> CloneRequest {
        CloneRequest {
            idempotency_key: format!("00000000-0000-0000-0000-{index:012}"),
            url: "https://example.com/org/repo.git".into(),
            name: format!("clone-{index}"),
            parent_path: self.0.to_str().unwrap().into(),
            branch: None,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn wait(state: &LocalCloneState, id: &str) -> Snapshot {
    let until = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = state.get(id).unwrap();
        if snapshot.status != Status::Running {
            return snapshot;
        }
        assert!(Instant::now() < until, "clone did not settle");
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn limits() -> ProcessLimits {
    ProcessLimits {
        timeout: Duration::from_secs(3),
        stdout_bytes: 4096,
        stderr_bytes: 4096,
    }
}
#[test]
fn actual_git_clone_uses_reserved_destination_and_preserves_existing_folder() {
    let fixture = Fixture::new();
    let source = fixture.0.join("source");
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .arg(&source)
        .status()
        .unwrap()
        .success());
    std::fs::write(source.join("hello.txt"), "hello").unwrap();
    assert!(Command::new("git")
        .arg("-C")
        .arg(&source)
        .args(["add", "hello.txt"])
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .arg("-C")
        .arg(&source)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "fixture"
        ])
        .status()
        .unwrap()
        .success());
    let state = LocalCloneState::default();
    let request = fixture.request(1);
    let snapshot = state
        .start_with(request.clone(), move |job, destination| {
            let mut command = Command::new("git");
            command
                .args(["clone", "--quiet", "--"])
                .arg(source)
                .arg(".");
            destination.anchor(&mut command);
            assert!(run_bounded(command, limits(), &job.kill).unwrap().success);
            destination.verify()
        })
        .unwrap();
    let complete = wait(&state, &snapshot.clone_id);
    assert_eq!(complete.status, Status::Completed);
    assert_eq!(
        std::fs::read_to_string(fixture.0.join("clone-1/hello.txt")).unwrap(),
        "hello"
    );
    assert_eq!(state.start(request.clone()).unwrap(), complete);
    let mut foreign = request;
    foreign.url = "https://example.com/other/repo.git".into();
    assert!(state.start(foreign).is_err());
    let mut collision = fixture.request(2);
    collision.name = "clone-1".into();
    assert!(state.start(collision).is_err());
    state.shutdown().unwrap();
    assert!(state.start(fixture.request(3)).is_err());
}
#[test]
fn cancel_reaps_process_and_cleans_partial_folder_for_retry() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let request = fixture.request(1);
    let (started, ready) = std::sync::mpsc::channel();
    let first = state
        .start_with(request.clone(), move |job, destination| {
            std::fs::write(
                std::path::Path::new(&destination.path).join("partial"),
                "data",
            )
            .unwrap();
            started.send(()).unwrap();
            let mut command = Command::new("sleep");
            command.arg("30");
            let _ = run_bounded(command, limits(), &job.kill);
            Err("Stopped".into())
        })
        .unwrap();
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(
        state.cancel(&first.clone_id).unwrap().status,
        Status::Running
    );
    assert_eq!(wait(&state, &first.clone_id).status, Status::Cancelled);
    assert!(!fixture.0.join("clone-1").exists());
    let mut retry = fixture.request(2);
    retry.name = "clone-1".into();
    let next = state
        .start_with(retry, |_, destination| destination.verify())
        .unwrap();
    assert_eq!(wait(&state, &next.clone_id).status, Status::Completed);
}
#[test]
fn cancel_keeps_active_permit_until_worker_settles() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (release, held) = std::sync::mpsc::channel();
    let first = state
        .start_with(fixture.request(1), move |_, _| {
            held.recv().unwrap();
            Ok(())
        })
        .unwrap();
    state.cancel(&first.clone_id).unwrap();
    let (release2, held2) = std::sync::mpsc::channel();
    state
        .start_with(fixture.request(2), move |_, _| {
            held2.recv().unwrap();
            Ok(())
        })
        .unwrap();
    assert!(state.start_with(fixture.request(3), |_, _| Ok(())).is_err());
    release.send(()).unwrap();
    release2.send(()).unwrap();
    state.shutdown().unwrap();
}
#[test]
fn shutdown_and_drop_stop_real_workers() {
    for explicit in [true, false] {
        let fixture = Fixture::new();
        let state = LocalCloneState::default();
        let (started, ready) = std::sync::mpsc::channel();
        state
            .start_with(fixture.request(1), move |job, _| {
                started.send(()).unwrap();
                let mut command = Command::new("sleep");
                command.arg("30");
                let _ = run_bounded(command, limits(), &job.kill);
                Err("Stopped".into())
            })
            .unwrap();
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        let before = Instant::now();
        if explicit {
            state.shutdown().unwrap();
        }
        drop(state);
        assert!(before.elapsed() < Duration::from_secs(2));
        assert!(!fixture.0.join("clone-1").exists());
    }
}
#[test]
fn parent_completion_kills_helpers_that_closed_output_pipes() {
    let fixture = Fixture::new();
    let marker = fixture.0.join("leak");
    let mut command = Command::new("sh");
    command
        .args([
            "-c",
            "(sleep 0.3; printf leaked > \"$1\") </dev/null >/dev/null 2>&1 & exit 0",
            "fixture",
        ])
        .arg(&marker);
    let output = run_bounded(command, limits(), &ProcessKillSwitch::default()).unwrap();
    assert!(output.success);
    std::thread::sleep(Duration::from_millis(500));
    assert!(!marker.exists());
}
#[test]
fn timeout_and_output_overflow_are_bounded() {
    let mut command = Command::new("sleep");
    command.arg("30");
    let mut short = limits();
    short.timeout = Duration::from_millis(30);
    assert!(run_bounded(command, short, &ProcessKillSwitch::default()).is_err());
    let mut command = Command::new("sh");
    command.args(["-c", "while :; do printf 1234567890; done"]);
    assert!(run_bounded(command, limits(), &ProcessKillSwitch::default()).is_err());
    // Exercise the shared guard's injectable terminator without sending signals.
    let kill = ProcessKillSwitch::with_terminator(|_| {});
    let registration = kill.register(123);
    assert!(registration.accepted());
    kill.kill();
}
#[test]
fn wire_rejects_unknown_fields_credentials_paths_and_accepts_unicode_branch() {
    let fixture = Fixture::new();
    let request = fixture.request(1);
    assert!(request.validate().is_ok());
    for url in [
        "file:///tmp/repo",
        "https://token@example.com/repo",
        "ext::danger",
        "-bad",
    ] {
        let mut invalid = request.clone();
        invalid.url = url.into();
        assert!(invalid.validate().is_err());
    }
    let mut unicode = request.clone();
    unicode.branch = Some("é".repeat(200));
    assert!(unicode.validate().is_ok());
    let mut invalid = request;
    invalid.name = "../other".into();
    assert!(invalid.validate().is_err());
    assert!(serde_json::from_value::<CloneRequest>(serde_json::json!({"idempotencyKey":"00000000-0000-0000-0000-000000000001","url":"https://example.com/repo","name":"repo","parentPath":"/tmp","extra":true})).is_err());
}

#[test]
fn shutdown_waits_for_admitted_start_before_capturing_jobs() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    state.0.starting.store(true, Ordering::SeqCst);
    let shutdown_state = state.clone();
    let (finished, completion) = std::sync::mpsc::channel();
    let shutdown = std::thread::spawn(move || finished.send(shutdown_state.shutdown()).unwrap());
    let deadline = Instant::now() + Duration::from_secs(2);
    while !state.0.closed.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert!(completion.try_recv().is_err());
    let request = fixture.request(1);
    let job = Arc::new(Job {
        snapshot: Mutex::new(Snapshot {
            clone_id: request.idempotency_key.clone(),
            status: Status::Running,
            path: Some(fixture.0.join("clone-1").to_str().unwrap().into()),
            error: None,
        }),
        request,
        active: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        worker: Mutex::new(None),
        kill: ProcessKillSwitch::default(),
    });
    lock(&state.0.jobs).push(Arc::clone(&job));
    state.0.starting.store(false, Ordering::SeqCst);
    completion
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    shutdown.join().unwrap();
    assert!(job.cancelled.load(Ordering::SeqCst));
}

#[test]
fn capacity_evicts_oldest_settled_job_but_retains_active_jobs() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    for index in 0..MAX_JOBS {
        let request = fixture.request(index);
        lock(&state.0.jobs).push(Arc::new(Job {
            snapshot: Mutex::new(Snapshot {
                clone_id: request.idempotency_key.clone(),
                status: if index == 0 {
                    Status::Running
                } else {
                    Status::Completed
                },
                path: Some(
                    fixture
                        .0
                        .join(format!("clone-{index}"))
                        .to_str()
                        .unwrap()
                        .into(),
                ),
                error: None,
            }),
            request,
            active: AtomicBool::new(index == 0),
            cancelled: AtomicBool::new(false),
            worker: Mutex::new(None),
            kill: ProcessKillSwitch::default(),
        }));
    }
    let next = state
        .start_with(fixture.request(MAX_JOBS), |_, destination| {
            destination.verify()
        })
        .unwrap();
    assert_eq!(wait(&state, &next.clone_id).status, Status::Completed);
    assert!(state.get(&fixture.request(0).idempotency_key).is_ok());
    assert!(state.get(&fixture.request(1).idempotency_key).is_err());
    assert!(state.get(&fixture.request(2).idempotency_key).is_ok());
    assert_eq!(lock(&state.0.jobs).len(), MAX_JOBS);
    lock(&state.0.jobs)[0].active.store(false, Ordering::SeqCst);
}
