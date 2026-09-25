use super::*;
use crate::trust::WorkspaceTrustService;
use std::{
    path::PathBuf,
    process::Command,
    sync::atomic::AtomicUsize,
    time::{Duration, Instant},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf, Mutex<WorkspaceTrustService>);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "codevo-local-clone-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir(&p).unwrap();
        let trust = WorkspaceTrustService::load(Self::trust_storage(&p)).unwrap();
        Self(p, Mutex::new(trust))
    }
    fn trust_storage(path: &std::path::Path) -> PathBuf {
        path.with_extension("trust.json")
    }
    fn request(&self, index: usize) -> CloneRequest {
        CloneRequest {
            idempotency_key: format!("00000000-0000-0000-0000-{index:012}"),
            url: "https://example.com/org/repo.git".into(),
            name: format!("clone-{index}"),
            parent_path: self.0.to_str().unwrap().into(),
            branch: None,
            ensure_parent: false,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
        let _ = std::fs::remove_file(Self::trust_storage(&self.0));
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
        .start_with(&fixture.1, request.clone(), move |job, destination| {
            let mut command = Command::new("git");
            command
                .args(["clone", "--quiet", "--"])
                .arg(source)
                .arg(".");
            destination.anchor(&mut command);
            assert!(
                run_bounded(command, limits(), &job.kill, &mut |_| {})
                    .unwrap()
                    .success
            );
            destination.verify()
        })
        .unwrap();
    let complete = wait(&state, &snapshot.clone_id);
    assert_eq!(complete.status, Status::Completed);
    assert_eq!(
        std::fs::read_to_string(fixture.0.join("clone-1/hello.txt")).unwrap(),
        "hello"
    );
    assert_eq!(state.start(&fixture.1, request.clone()).unwrap(), complete);
    let mut foreign = request;
    foreign.url = "https://example.com/other/repo.git".into();
    assert!(state.start(&fixture.1, foreign).is_err());
    let mut collision = fixture.request(2);
    collision.name = "clone-1".into();
    assert!(state.start(&fixture.1, collision).is_err());
    state.shutdown().unwrap();
    assert!(state.start(&fixture.1, fixture.request(3)).is_err());
}
#[test]
fn cancel_reaps_process_and_cleans_partial_folder_for_retry() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let request = fixture.request(1);
    let (started, ready) = std::sync::mpsc::channel();
    let first = state
        .start_with(&fixture.1, request.clone(), move |job, destination| {
            std::fs::write(
                std::path::Path::new(&destination.path).join("partial"),
                "data",
            )
            .unwrap();
            started.send(()).unwrap();
            let mut command = Command::new("sleep");
            command.arg("30");
            let _ = run_bounded(command, limits(), &job.kill, &mut |_| {});
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
        .start_with(&fixture.1, retry, |_, destination| destination.verify())
        .unwrap();
    assert_eq!(wait(&state, &next.clone_id).status, Status::Completed);
}
#[test]
fn cancel_keeps_active_permit_until_worker_settles() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (release, held) = std::sync::mpsc::channel();
    let first = state
        .start_with(&fixture.1, fixture.request(1), move |_, _| {
            held.recv().unwrap();
            Ok(())
        })
        .unwrap();
    state.cancel(&first.clone_id).unwrap();
    let (release2, held2) = std::sync::mpsc::channel();
    state
        .start_with(&fixture.1, fixture.request(2), move |_, _| {
            held2.recv().unwrap();
            Ok(())
        })
        .unwrap();
    assert!(state
        .start_with(&fixture.1, fixture.request(3), |_, _| Ok(()))
        .is_err());
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
            .start_with(&fixture.1, fixture.request(1), move |job, _| {
                started.send(()).unwrap();
                let mut command = Command::new("sleep");
                command.arg("30");
                let _ = run_bounded(command, limits(), &job.kill, &mut |_| {});
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
    let output = run_bounded(
        command,
        limits(),
        &ProcessKillSwitch::default(),
        &mut |_| {},
    )
    .unwrap();
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
    assert!(run_bounded(command, short, &ProcessKillSwitch::default(), &mut |_| {}).is_err());
    let mut command = Command::new("sh");
    command.args(["-c", "while :; do printf 1234567890; done"]);
    assert!(run_bounded(
        command,
        limits(),
        &ProcessKillSwitch::default(),
        &mut |_| {}
    )
    .is_err());
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
            progress: None,
            failure: None,
        }),
        failure: Mutex::new(None),
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
                progress: None,
                failure: None,
            }),
            failure: Mutex::new(None),
            request,
            active: AtomicBool::new(index == 0),
            cancelled: AtomicBool::new(false),
            worker: Mutex::new(None),
            kill: ProcessKillSwitch::default(),
        }));
    }
    let next = state
        .start_with(&fixture.1, fixture.request(MAX_JOBS), |_, destination| {
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

fn commit_fixture_repository(source: &std::path::Path) {
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .arg(source)
        .status()
        .unwrap()
        .success());
    std::fs::write(source.join("a.txt"), "a").unwrap();
    assert!(Command::new("git")
        .arg("-C")
        .arg(source)
        .args(["add", "a.txt"])
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .arg("-C")
        .arg(source)
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
            "init"
        ])
        .status()
        .unwrap()
        .success());
}

#[test]
fn running_snapshot_publishes_progress_and_terminal_states_clear_it() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (published, proceed) = std::sync::mpsc::channel::<()>();
    let (release, released) = std::sync::mpsc::channel::<()>();
    let started = state
        .start_with(&fixture.1, fixture.request(1), move |job, destination| {
            job.publish_progress(CloneProgress {
                phase: super::super::progress::ClonePhase::Receiving,
                percent: 42,
                received_bytes: Some(1024),
                bytes_per_second: None,
            });
            published.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(2)).unwrap();
            destination.verify()
        })
        .unwrap();
    proceed.recv_timeout(Duration::from_secs(2)).unwrap();
    let running = state.get(&started.clone_id).unwrap();
    assert_eq!(running.status, Status::Running);
    assert_eq!(running.progress.map(|value| value.percent), Some(42));
    assert_eq!(running.failure, None);
    release.send(()).unwrap();
    let done = wait(&state, &started.clone_id);
    assert_eq!(done.status, Status::Completed);
    assert_eq!(done.progress, None);
    assert_eq!(done.failure, None);
}

#[test]
fn cancelled_snapshot_clears_progress_and_ignores_recorded_failure() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (published, proceed) = std::sync::mpsc::channel::<()>();
    let (release, released) = std::sync::mpsc::channel::<()>();
    let started = state
        .start_with(&fixture.1, fixture.request(1), move |job, _| {
            job.publish_progress(CloneProgress {
                phase: super::super::progress::ClonePhase::Counting,
                percent: 3,
                received_bytes: None,
                bytes_per_second: None,
            });
            job.record_failure(CloneFailure::Network);
            published.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(2)).unwrap();
            Err("Stopped".into())
        })
        .unwrap();
    proceed.recv_timeout(Duration::from_secs(2)).unwrap();
    state.cancel(&started.clone_id).unwrap();
    release.send(()).unwrap();
    let cancelled = wait(&state, &started.clone_id);
    assert_eq!(cancelled.status, Status::Cancelled);
    assert_eq!(cancelled.progress, None);
    assert_eq!(cancelled.failure, None);
    assert_eq!(cancelled.error, None);
}

#[test]
fn failed_snapshot_carries_recorded_or_default_failure_kind() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let recorded = state
        .start_with(&fixture.1, fixture.request(1), |job, _| {
            job.record_failure(CloneFailure::Authentication);
            Err("Cloning failed.".into())
        })
        .unwrap();
    let failed = wait(&state, &recorded.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(CloneFailure::Authentication));
    let unrecorded = state
        .start_with(&fixture.1, fixture.request(2), |_, _| {
            Err("Cloning failed.".into())
        })
        .unwrap();
    assert_eq!(
        wait(&state, &unrecorded.clone_id).failure,
        Some(CloneFailure::Other)
    );
}

#[test]
fn snapshot_wire_shape_is_closed_and_camel_case() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let started = state
        .start_with(&fixture.1, fixture.request(1), |job, _| {
            job.record_failure(CloneFailure::Network);
            Err("Cloning failed.".into())
        })
        .unwrap();
    let failed = wait(&state, &started.clone_id);
    let value = serde_json::to_value(&failed).unwrap();
    let mut keys: Vec<&str> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["cloneId", "error", "failure", "path", "progress", "status"]
    );
    assert_eq!(value["failure"], serde_json::json!("network"));
    assert_eq!(value["progress"], serde_json::Value::Null);
}

#[test]
fn request_accepts_optional_ensure_parent_and_rejects_non_boolean() {
    let base = serde_json::json!({"idempotencyKey":"00000000-0000-0000-0000-000000000001","url":"https://example.com/org/repo.git","name":"repo","parentPath":"/tmp"});
    let parsed: CloneRequest = serde_json::from_value(base.clone()).unwrap();
    assert!(!parsed.ensure_parent);
    let mut with_flag = base.clone();
    with_flag["ensureParent"] = serde_json::json!(true);
    assert!(
        serde_json::from_value::<CloneRequest>(with_flag)
            .unwrap()
            .ensure_parent
    );
    for invalid in [
        serde_json::json!("yes"),
        serde_json::json!(1),
        serde_json::Value::Null,
    ] {
        let mut bad = base.clone();
        bad["ensureParent"] = invalid;
        assert!(serde_json::from_value::<CloneRequest>(bad).is_err());
    }
}

#[test]
fn ensure_parent_is_part_of_idempotency_identity() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let request = fixture.request(1);
    let first = state
        .start_with(&fixture.1, request.clone(), |_, destination| {
            destination.verify()
        })
        .unwrap();
    wait(&state, &first.clone_id);
    let mut changed = request;
    changed.ensure_parent = true;
    assert!(state.start(&fixture.1, changed).is_err());
}

#[test]
fn actual_git_clone_reports_classified_failure_for_missing_branch() {
    let fixture = Fixture::new();
    let source = fixture.0.join("branch-source");
    commit_fixture_repository(&source);
    let state = LocalCloneState::default();
    let mut request = fixture.request(9);
    request.branch = Some("does-not-exist".into());
    let started = state
        .start_with(&fixture.1, request, move |job, destination| {
            let mut command = Command::new("git");
            command
                .args(["clone", "--progress", "--branch", "does-not-exist", "--"])
                .arg(&source)
                .arg(".");
            destination.anchor(&mut command);
            run_clone(job, destination, command)
        })
        .unwrap();
    let failed = wait(&state, &started.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(CloneFailure::BranchNotFound));
    assert!(!fixture.0.join("clone-9").exists());
}

#[test]
fn actual_git_clone_with_progress_completes_and_clears_progress() {
    let fixture = Fixture::new();
    let source = fixture.0.join("progress-source");
    commit_fixture_repository(&source);
    let state = LocalCloneState::default();
    let started = state
        .start_with(&fixture.1, fixture.request(3), move |job, destination| {
            let mut command = Command::new("git");
            command
                .args(["clone", "--progress", "--"])
                .arg(&source)
                .arg(".");
            destination.anchor(&mut command);
            run_clone(job, destination, command)
        })
        .unwrap();
    let done = wait(&state, &started.clone_id);
    assert_eq!(done.status, Status::Completed);
    assert_eq!(done.progress, None);
    assert_eq!(done.failure, None);
    assert!(fixture.0.join("clone-3/a.txt").exists());
}

#[test]
fn chatty_progress_over_the_stderr_limit_still_publishes_and_classifies() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let (observed, observation) = std::sync::mpsc::channel();
    let script = concat!(
        "i=0; while [ $i -lt 1500 ]; do ",
        "printf 'Receiving objects:  %d%% (1/2), 1.00 MiB | 1.00 MiB/s\\r' $((i / 17)) >&2; ",
        "i=$((i + 1)); done; ",
        "head -c 4000 /dev/zero | tr '\\0' x >&2; ",
        "printf '\\nReceiving objects:  99%% (1/2)\\r' >&2; ",
        "printf '\\nfatal: unable to access x: Could not resolve host: example.com\\n' >&2; ",
        "exit 128"
    );
    let started = state
        .start_with(&fixture.1, fixture.request(4), move |job, destination| {
            let mut command = Command::new("sh");
            command.args(["-c", script]);
            destination.anchor(&mut command);
            let result = run_clone(job, destination, command);
            observed.send(job.snapshot().progress).unwrap();
            result
        })
        .unwrap();
    let progress = observation.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(progress.map(|value| value.percent), Some(99));
    let failed = wait(&state, &started.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(CloneFailure::Network));
    assert_eq!(failed.progress, None);
}

#[test]
fn run_clone_records_timeout_failure() {
    let fixture = Fixture::new();
    let state = LocalCloneState::default();
    let started = state
        .start_with(&fixture.1, fixture.request(5), move |job, destination| {
            let mut command = Command::new("sleep");
            command.arg("30");
            destination.anchor(&mut command);
            run_clone_with_timeout(job, destination, command, Duration::from_millis(50))
        })
        .unwrap();
    let failed = wait(&state, &started.clone_id);
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(failed.failure, Some(CloneFailure::Timeout));
}

#[test]
fn reclone_of_a_previously_trusted_path_is_durably_untrusted_before_the_job_is_acknowledged() {
    let fixture = Fixture::new();
    let request = fixture.request(1);
    let canonical = std::fs::canonicalize(&fixture.0).unwrap().join("clone-1");
    std::fs::create_dir(&canonical).unwrap();
    let path = canonical.to_str().unwrap().to_owned();
    lock(&fixture.1).set(&path, true).unwrap();
    std::fs::remove_dir(&canonical).unwrap();
    let state = LocalCloneState::default();
    let (release, held) = std::sync::mpsc::channel::<()>();
    let snapshot = state
        .start_with(&fixture.1, request, move |_, destination| {
            held.recv().unwrap();
            destination.verify()
        })
        .unwrap();
    assert_eq!(snapshot.path.as_deref(), Some(path.as_str()));
    assert!(!lock(&fixture.1).get(&path).trusted);
    release.send(()).unwrap();
    assert_eq!(wait(&state, &snapshot.clone_id).status, Status::Completed);
    let mut reloaded = WorkspaceTrustService::load(Fixture::trust_storage(&fixture.0)).unwrap();
    assert!(!reloaded.get(&path).trusted);
    assert_eq!(
        reloaded
            .grant_opened_canonical_root(&path)
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert!(reloaded.set(&path, true).unwrap().trusted);
    assert!(reloaded.grant_opened_canonical_root(&path).unwrap().trusted);
}

#[test]
fn trust_revocation_failure_aborts_before_git_and_removes_the_reservation() {
    let fixture = Fixture::new();
    let blocker = Fixture::trust_storage(&fixture.0);
    std::fs::write(&blocker, "not a directory").unwrap();
    let unwritable = Mutex::new(WorkspaceTrustService::load(blocker.join("trust.json")).unwrap());
    let state = LocalCloneState::default();
    let executed = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&executed);
    let snapshot = state
        .start_with(&unwritable, fixture.request(1), move |_, _| {
            observed.store(true, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
    assert_eq!(snapshot.status, Status::Failed);
    assert_eq!(snapshot.failure, Some(CloneFailure::Destination));
    assert_eq!(snapshot.path, None);
    assert!(snapshot.error.is_some());
    assert_eq!(state.get(&snapshot.clone_id).unwrap(), snapshot);
    assert!(!executed.load(Ordering::SeqCst));
    assert!(!fixture.0.join("clone-1").exists());
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 0);
    let retry = state
        .start_with(&fixture.1, fixture.request(2), |_, destination| {
            destination.verify()
        })
        .unwrap();
    assert_eq!(wait(&state, &retry.clone_id).status, Status::Completed);
}

#[test]
fn clone_command_keeps_prompts_disabled_and_respects_a_configured_ssh_command() {
    let fixture = Fixture::new();
    let environment = GitEnvironment::new(fixture.0.clone(), "/usr/bin:/bin".into(), Vec::new());
    let command = clone_command(
        &fixture.request(1),
        &environment,
        &SshTransport::UserConfiguration,
    );
    let variables: Vec<_> = command
        .get_envs()
        .map(|(key, value)| (key.to_owned(), value.map(|value| value.to_owned())))
        .collect();
    let value = |key: &str| {
        variables
            .iter()
            .find(|(name, _)| name == key)
            .and_then(|(_, value)| value.clone())
    };
    assert!(value("GIT_SSH_COMMAND").is_none());
    assert_eq!(value("GIT_TERMINAL_PROMPT").as_deref(), Some("0".as_ref()));
    assert_eq!(
        value("SSH_ASKPASS_REQUIRE").as_deref(),
        Some("never".as_ref())
    );
    assert!(command
        .get_args()
        .any(|argument| argument == "core.hooksPath=/dev/null"));
}
