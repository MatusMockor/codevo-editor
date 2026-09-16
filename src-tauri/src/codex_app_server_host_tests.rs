use super::super::codex_app_server_transport::TurnFrame;
use super::*;
use crate::agent_task_spawner::agent_provider::process::executable_identity;
use std::io::{pipe, BufRead, BufReader, PipeReader, PipeWriter, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_INTERVAL: Duration = Duration::from_millis(5);
const TEST_START_TIMEOUT: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, PartialEq, Eq)]
enum FakeBehaviour {
    Ready,
    SilentInitialize,
    SilentTurnStart,
}

struct FakeServerControl {
    writer: Mutex<Option<PipeWriter>>,
    killed: AtomicBool,
    initialize_seen: AtomicBool,
}

impl FakeServerControl {
    fn emit(&self, frame: &Value) {
        let mut writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(handle) = writer.as_mut() else {
            return;
        };
        if handle.write_all(format!("{frame}\n").as_bytes()).is_err() {
            return;
        }
        let _ = handle.flush();
    }

    fn kill(&self) {
        self.killed.store(true, Ordering::SeqCst);
        self.writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }
}

struct FakeHostProcess {
    streams: Option<CodexAppServerStreams>,
    control: Arc<FakeServerControl>,
    stopped: Arc<AtomicUsize>,
    already_stopped: bool,
}

impl CodexHostProcess for FakeHostProcess {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        self.streams
            .take()
            .ok_or_else(|| "fake streams already taken".to_string())
    }

    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        None
    }

    fn stop(&mut self, _graceful: Duration, _force: Duration) {
        if self.already_stopped {
            return;
        }
        self.already_stopped = true;
        self.control.kill();
        self.stopped.fetch_add(1, Ordering::SeqCst);
    }
}

impl Drop for FakeHostProcess {
    fn drop(&mut self) {
        self.stop(CODEX_HOST_GRACEFUL_STOP, CODEX_HOST_FORCE_STOP);
    }
}

struct FakeHostProcessSpawner {
    behaviour: FakeBehaviour,
    spawned: AtomicUsize,
    stopped: Arc<AtomicUsize>,
    controls: Mutex<Vec<Arc<FakeServerControl>>>,
}

impl FakeHostProcessSpawner {
    fn new(behaviour: FakeBehaviour) -> Arc<Self> {
        Arc::new(Self {
            behaviour,
            spawned: AtomicUsize::new(0),
            stopped: Arc::new(AtomicUsize::new(0)),
            controls: Mutex::new(Vec::new()),
        })
    }

    fn spawned(&self) -> usize {
        self.spawned.load(Ordering::SeqCst)
    }

    fn stopped(&self) -> usize {
        self.stopped.load(Ordering::SeqCst)
    }

    fn control(&self, index: usize) -> Arc<FakeServerControl> {
        Arc::clone(
            self.controls
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(index)
                .expect("fake server control"),
        )
    }
}

impl CodexHostProcessSpawner for FakeHostProcessSpawner {
    fn spawn(&self, _plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        let (client_output, server_writer) = pipe().map_err(|error| error.to_string())?;
        let (server_reader, client_input) = pipe().map_err(|error| error.to_string())?;
        let control = Arc::new(FakeServerControl {
            writer: Mutex::new(Some(server_writer)),
            killed: AtomicBool::new(false),
            initialize_seen: AtomicBool::new(false),
        });
        self.controls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Arc::clone(&control));
        self.spawned.fetch_add(1, Ordering::SeqCst);
        let behaviour = self.behaviour;
        let served = Arc::clone(&control);
        thread::spawn(move || serve(server_reader, served, behaviour));
        Ok(Box::new(FakeHostProcess {
            streams: Some(CodexAppServerStreams {
                input: Box::new(client_input),
                output: Box::new(client_output),
            }),
            control,
            stopped: Arc::clone(&self.stopped),
            already_stopped: false,
        }))
    }
}

fn serve(reader: PipeReader, control: Arc<FakeServerControl>, behaviour: FakeBehaviour) {
    let mut buffered = BufReader::new(reader);
    let mut line = String::new();
    let mut counter = 0u64;
    loop {
        line.clear();
        match buffered.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => (),
        }
        if control.killed.load(Ordering::SeqCst) {
            return;
        }
        let Ok(frame) = serde_json::from_str::<Value>(line.as_str()) else {
            continue;
        };
        let Some(id) = frame.get("id").cloned() else {
            continue;
        };
        let method = frame
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if method == "initialize" {
            control.initialize_seen.store(true, Ordering::SeqCst);
        }
        if method == "initialize" && behaviour == FakeBehaviour::SilentInitialize {
            continue;
        }
        if method == "turn/start" && behaviour == FakeBehaviour::SilentTurnStart {
            continue;
        }
        counter += 1;
        let result = match method.as_str() {
            "thread/start" | "thread/resume" => json!({
                "thread": { "id": format!("thread-{counter}") },

            }),
            "turn/start" => json!({
                "turn": { "id": format!("turn-{counter}"), "status": "inProgress" },
            }),
            "turn/steer" => json!({ "turnId": format!("turn-{counter}") }),
            "thread/unsubscribe" => json!({ "status": "unsubscribed" }),
            _ => json!({}),
        };
        control.emit(&json!({ "id": id, "result": result }));
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

fn test_identity() -> ExecutableIdentity {
    executable_identity("/bin/echo").expect("identity for /bin/echo")
}

fn test_plan(root: &str) -> CodexHostLaunchPlan {
    CodexHostLaunchPlan::new(test_identity(), Path::new(root), &["--model", "gpt-5"], &[])
        .expect("launch plan")
        .with_env(Vec::new())
}

fn test_key(root: &str, generation: u64) -> CodexHostKey {
    CodexHostKey::new(PathBuf::from(root), generation, test_identity())
}

fn test_registry(spawner: Arc<FakeHostProcessSpawner>) -> CodexAppServerHostRegistry {
    CodexAppServerHostRegistry::new(spawner).with_start_timeout(TEST_START_TIMEOUT)
}

#[test]
fn launch_plan_carries_the_stdio_transport_arguments() {
    let plan = test_plan("/repo/one");
    assert_eq!(
        plan.args(),
        [
            "app-server",
            "--listen",
            "stdio://",
            "--model",
            "gpt-5",
            "-c",
            "features.default_mode_request_user_input=true"
        ]
    );
    assert_eq!(plan.repository_root(), Path::new("/repo/one"));
}

#[test]
fn launch_plan_requires_an_absolute_repository_root() {
    let outcome = CodexHostLaunchPlan::new(test_identity(), Path::new("repo"), &[], &[]);
    assert_eq!(outcome.err(), Some(CODEX_HOST_ROOT_ERROR.to_string()));
}

#[test]
fn extra_arguments_are_bounded_and_reject_transport_flags() {
    assert_eq!(
        validate_codex_app_server_args(&["--config".to_string(), "a=b".to_string()]),
        Ok(vec!["--config".to_string(), "a=b".to_string()])
    );
    let too_many: Vec<String> = (0..=MAX_CODEX_APP_SERVER_ARGS)
        .map(|index| format!("--flag-{index}"))
        .collect();
    assert_eq!(
        validate_codex_app_server_args(&too_many).err(),
        Some(CODEX_HOST_ARG_COUNT_ERROR.to_string())
    );
    assert_eq!(
        validate_codex_app_server_args(&["x".repeat(MAX_CODEX_APP_SERVER_ARG_BYTES + 1)]).err(),
        Some(CODEX_HOST_ARG_SIZE_ERROR.to_string())
    );
    assert_eq!(
        validate_codex_app_server_args(&[String::new()]).err(),
        Some(CODEX_HOST_ARG_SIZE_ERROR.to_string())
    );
    for rejected in [
        "--listen",
        "--listen=stdio://",
        "--code-mode-host",
        "--strict-config",
    ] {
        assert_eq!(
            validate_codex_app_server_args(&[rejected.to_string()]).err(),
            Some(CODEX_HOST_ARG_REJECTED_ERROR.to_string()),
            "{rejected} must be rejected"
        );
    }
    for charset in ["--a\nb", "--a\tb", "--a\u{0}b", "--héllo"] {
        assert_eq!(
            validate_codex_app_server_args(&[charset.to_string()]).err(),
            Some(CODEX_HOST_ARG_CHARSET_ERROR.to_string())
        );
    }
}

#[test]
fn a_handshake_failure_keeps_the_host_out_of_the_registry() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentInitialize);
    let registry = test_registry(Arc::clone(&spawner));
    let outcome = registry.host_for(test_key("/repo/one", 1), &test_plan("/repo/one"));
    let failure = outcome.err().expect("handshake must fail");
    assert!(
        failure.starts_with(CODEX_HOST_HANDSHAKE_ERROR),
        "unexpected failure: {failure}"
    );
    assert_eq!(registry.host_count(), 0);
    assert_eq!(spawner.spawned(), 1);
    assert_eq!(spawner.stopped(), 1);
}

#[test]
fn the_same_key_reuses_one_host() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let first = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("first host");
    let second = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("second host");
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(spawner.spawned(), 1);
    assert_eq!(registry.host_count(), 1);
}

#[test]
fn two_repository_roots_get_two_hosts() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let first = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("first host");
    let second = registry
        .host_for(test_key("/repo/two", 1), &test_plan("/repo/two"))
        .expect("second host");
    assert!(!Arc::ptr_eq(&first, &second));
    assert_eq!(registry.host_count(), 2);
}

#[test]
fn a_new_generation_retires_the_previous_host() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let first = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("first host");
    let second = registry
        .host_for(test_key("/repo/one", 2), &test_plan("/repo/one"))
        .expect("second host");
    assert!(!Arc::ptr_eq(&first, &second));
    assert_eq!(spawner.spawned(), 2);
}

#[test]
fn a_fifth_host_evicts_the_least_recently_used_idle_host() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let mut hosts = Vec::new();
    for index in 0..MAX_CODEX_APP_SERVER_HOSTS {
        let root = format!("/repo/{index}");
        hosts.push(
            registry
                .host_for(test_key(root.as_str(), 1), &test_plan(root.as_str()))
                .expect("host"),
        );
        thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(registry.host_count(), MAX_CODEX_APP_SERVER_HOSTS);
    let refreshed = registry
        .host_for(test_key("/repo/0", 1), &test_plan("/repo/0"))
        .expect("refresh the oldest host");
    assert!(Arc::ptr_eq(&refreshed, &hosts[0]));
    thread::sleep(Duration::from_millis(2));
    let evicting = registry
        .host_for(test_key("/repo/overflow", 1), &test_plan("/repo/overflow"))
        .expect("fifth host");
    assert_eq!(registry.host_count(), MAX_CODEX_APP_SERVER_HOSTS);
    assert!(!Arc::ptr_eq(&evicting, &hosts[1]));
    let replayed = registry
        .host_for(test_key("/repo/1", 1), &test_plan("/repo/1"))
        .expect("restart the evicted host");
    assert!(!Arc::ptr_eq(&replayed, &hosts[1]));
}

#[test]
fn a_host_with_a_live_turn_is_never_evicted() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let mut leases = Vec::new();
    for index in 0..MAX_CODEX_APP_SERVER_HOSTS {
        let root = format!("/repo/{index}");
        let host = registry
            .host_for(test_key(root.as_str(), 1), &test_plan(root.as_str()))
            .expect("host");
        let thread = host
            .start_thread(ThreadStartParams {
                cwd: Some(root.clone()),
                model: None,
                sandbox: None,
                approval_policy: None,
            })
            .expect("thread");
        let turn = host
            .start_turn(
                &thread,
                TurnStartParams {
                    thread_id: thread.thread_id().to_string(),
                    input: Vec::new(),
                    cwd: None,
                    model: None,
                    approval_policy: None,
                    sandbox_policy: None,
                    effort: None,
                    client_user_message_id: None,
                    turn_trigger: None,
                },
            )
            .expect("turn");
        leases.push((host, thread, turn));
    }
    let outcome = registry.host_for(test_key("/repo/busy", 1), &test_plan("/repo/busy"));
    assert_eq!(outcome.err(), Some(CODEX_HOST_LIMIT_ERROR.to_string()));
    assert_eq!(registry.host_count(), MAX_CODEX_APP_SERVER_HOSTS);
    let (host, _thread, turn) = leases.remove(0);
    assert_eq!(host.live_turns(), 1);
    drop(turn);
    assert_eq!(host.live_turns(), 0);
}

#[test]
fn idle_hosts_are_retired_and_busy_hosts_are_kept() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let idle = registry
        .host_for(test_key("/repo/idle", 1), &test_plan("/repo/idle"))
        .expect("idle host");
    let busy = registry
        .host_for(test_key("/repo/busy", 1), &test_plan("/repo/busy"))
        .expect("busy host");
    let thread = busy
        .start_thread(ThreadStartParams {
            cwd: Some("/repo/busy".to_string()),
            model: None,
            sandbox: None,
            approval_policy: None,
        })
        .expect("thread");
    let _turn = busy
        .start_turn(
            &thread,
            TurnStartParams {
                thread_id: thread.thread_id().to_string(),
                input: Vec::new(),
                cwd: None,
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                effort: None,
                client_user_message_id: None,
                turn_trigger: None,
            },
        )
        .expect("turn");
    registry.retire_idle();
    assert_eq!(registry.host_count(), 2);
    registry.retire_idle_before(Instant::now());
    assert_eq!(registry.host_count(), 1);
    drop(idle);
    assert_eq!(busy.live_turns(), 1);
}

#[test]
fn host_death_settles_every_live_turn_and_removes_the_host() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("host");
    let thread = host
        .start_thread(ThreadStartParams {
            cwd: Some("/repo/one".to_string()),
            model: None,
            sandbox: None,
            approval_policy: None,
        })
        .expect("thread");
    let _turn = host
        .start_turn(
            &thread,
            TurnStartParams {
                thread_id: thread.thread_id().to_string(),
                input: Vec::new(),
                cwd: None,
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                effort: None,
                client_user_message_id: None,
                turn_trigger: None,
            },
        )
        .expect("turn");
    spawner.control(0).kill();
    let closed = wait_for(|| thread.frames().closed());
    assert!(!closed.is_empty());
    assert!(matches!(host.state(), CodexHostState::Failed { .. }));
    let restarted = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("fresh host");
    assert!(!Arc::ptr_eq(&restarted, &host));
    assert_eq!(registry.host_count(), 1);
}

#[test]
fn a_notification_reaches_the_thread_route() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .expect("host");
    let thread = host
        .start_thread(ThreadStartParams {
            cwd: Some("/repo/one".to_string()),
            model: None,
            sandbox: None,
            approval_policy: None,
        })
        .expect("thread");
    spawner.control(0).emit(&json!({
        "method": "turn/completed",
        "params": {
            "threadId": thread.thread_id(),
            "turn": { "id": "turn-1", "status": "completed", "durationMs": 12 },
        },
    }));
    let frame = thread
        .frames()
        .recv_timeout(PROBE_TIMEOUT)
        .expect("turn completed frame");
    assert!(matches!(frame, TurnFrame::Notification(_)));
}

#[test]
fn dispose_drains_every_host_and_stops_its_process() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    for index in 0..3 {
        let root = format!("/repo/{index}");
        registry
            .host_for(test_key(root.as_str(), 1), &test_plan(root.as_str()))
            .expect("host");
    }
    assert_eq!(registry.host_count(), 3);
    registry.drain_for_dispose();
    assert_eq!(registry.host_count(), 0);
    assert_eq!(spawner.stopped(), 3);
}

#[test]
fn every_approval_request_is_answered_with_the_declining_variant() {
    let decliner = CodexApprovalDecliner;
    let params = json!({ "conversationId": "thread-1" });
    for method in [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "execCommandApproval",
        "applyPatchApproval",
        "item/permissions/requestApproval",
        "mcpServer/elicitation/request",
        "item/tool/call",
    ] {
        assert!(
            decliner.decline(method, &params).is_some(),
            "{method} must be declined"
        );
    }
    assert_eq!(
        decliner.decline("item/tool/requestUserInput", &params),
        None
    );
    assert_eq!(decliner.decline("future/serverRequest", &params), None);
    assert_eq!(decliner.decline("attestation/generate", &params), None);
}

#[test]
fn retirement_stops_process_even_when_external_host_handles_remain() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let old = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    let _new = registry
        .host_for(test_key("/repo/one", 2), &test_plan("/repo/one"))
        .unwrap();
    assert_eq!(registry.host_count(), 1);
    assert!(!old.is_ready());
    assert_eq!(spawner.stopped(), 1);
    registry.drain_for_dispose();
    assert_eq!(spawner.stopped(), 2);
}

#[test]
fn mismatched_launch_authority_never_spawns() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    assert!(registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/two"))
        .is_err());
    assert_eq!(spawner.spawned(), 0);
}

#[test]
fn pending_start_reservations_enforce_host_bound_and_dispose_fences_adoption() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentInitialize);
    let registry = Arc::new(test_registry(Arc::clone(&spawner)));
    let mut starts = Vec::new();
    for index in 0..MAX_CODEX_APP_SERVER_HOSTS {
        let registry = Arc::clone(&registry);
        starts.push(thread::spawn(move || {
            let root = format!("/repo/{index}");
            registry
                .host_for(test_key(&root, 1), &test_plan(&root))
                .is_err()
        }));
    }
    wait_for(|| (spawner.spawned() == MAX_CODEX_APP_SERVER_HOSTS).then_some(()));
    assert!(registry
        .host_for(test_key("/repo/fifth", 1), &test_plan("/repo/fifth"))
        .is_err());
    assert_eq!(spawner.spawned(), MAX_CODEX_APP_SERVER_HOSTS);
    registry.drain_for_dispose();
    for start in starts {
        assert!(start.join().unwrap());
    }
    assert_eq!(registry.host_count(), 0);
    assert_eq!(spawner.stopped(), MAX_CODEX_APP_SERVER_HOSTS);
    assert!(registry
        .host_for(test_key("/repo/again", 1), &test_plan("/repo/again"))
        .is_err());
}

#[test]
fn update_retires_idle_hosts_but_refuses_open_thread_authority() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    let thread = host
        .start_thread(ThreadStartParams {
            cwd: Some("/repo/one".into()),
            model: None,
            sandbox: None,
            approval_policy: None,
        })
        .unwrap();
    assert!(registry.retire_all_idle_for_update().is_err());
    assert!(host.is_ready());
    drop(thread);
    registry.retire_all_idle_for_update().unwrap();
    assert!(!host.is_ready());
    assert_eq!(registry.host_count(), 0);
    assert_eq!(spawner.stopped(), 1);
}

#[test]
fn host_failure_reaps_without_waiting_for_external_arc_drop() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    spawner.control(0).kill();
    wait_for(|| (spawner.stopped() == 1).then_some(()));
    assert!(!host.is_ready());
}

#[cfg(unix)]
#[test]
fn owned_process_drop_reaps_the_actual_process() {
    use std::os::unix::process::CommandExt;
    let child = std::process::Command::new("/bin/sleep")
        .arg("60")
        .process_group(0)
        .spawn()
        .unwrap();
    let pid = child.id() as i32;
    let process = StdCodexHostProcess::adopt(child).unwrap();
    drop(process);
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn an_uncertain_turn_start_retires_and_reaps_the_host() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentTurnStart);
    let registry = test_registry(Arc::clone(&spawner));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    let thread = host
        .start_thread(ThreadStartParams {
            cwd: Some("/repo/one".into()),
            model: None,
            sandbox: None,
            approval_policy: None,
        })
        .unwrap();
    let result = host.start_turn_within(
        &thread,
        TurnStartParams {
            thread_id: thread.thread_id().into(),
            input: Vec::new(),
            cwd: None,
            model: None,
            approval_policy: None,
            sandbox_policy: None,
            effort: None,
            client_user_message_id: None,
            turn_trigger: None,
        },
        Duration::from_millis(20),
    );
    assert!(matches!(result, Err(CodexRpcFailure::Timeout)));
    assert!(!host.is_ready());
    assert_eq!(spawner.stopped(), 1);
}

#[test]
fn failed_update_leaves_every_idle_host_usable() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let idle = registry
        .host_for(test_key("/repo/idle", 1), &test_plan("/repo/idle"))
        .unwrap();
    let busy = registry
        .host_for(test_key("/repo/busy", 1), &test_plan("/repo/busy"))
        .unwrap();
    let _busy = busy.acquire_activity().unwrap();
    assert!(registry.retire_all_idle_for_update().is_err());
    assert!(idle.acquire_activity().is_ok());
    assert!(busy.acquire_activity().is_ok());
}

#[test]
fn repository_dispose_leaves_other_hosts_and_allows_a_fresh_generation() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let first = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    let other = registry
        .host_for(test_key("/repo/two", 1), &test_plan("/repo/two"))
        .unwrap();
    registry.retire_for_repository(Path::new("/repo/one"));
    assert!(!first.is_ready());
    assert!(other.is_ready());
    let fresh = registry
        .host_for(test_key("/repo/one", 2), &test_plan("/repo/one"))
        .unwrap();
    assert!(fresh.is_ready());
    assert!(!Arc::ptr_eq(&first, &fresh));
    assert_eq!(registry.host_count(), 2);
}

#[test]
fn successful_late_handshake_cannot_resurrect_a_disposed_repository() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentInitialize);
    let registry = Arc::new(test_registry(Arc::clone(&spawner)));
    let starting = Arc::clone(&registry);
    let task = thread::spawn(move || {
        starting
            .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
            .is_err()
    });
    wait_for(|| (spawner.spawned() == 1).then_some(()));
    let control = spawner.control(0);
    wait_for(|| control.initialize_seen.load(Ordering::SeqCst).then_some(()));
    registry.retire_for_repository(Path::new("/repo/one"));
    control.emit(&json!({"id": 1, "result": {}}));
    assert!(task.join().unwrap());
    assert_eq!(registry.host_count(), 0);
    assert_eq!(spawner.stopped(), 1);
}

#[test]
fn simultaneous_same_root_starts_share_the_completed_handshake() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentInitialize);
    let registry = Arc::new(test_registry(Arc::clone(&spawner)));
    let first_registry = Arc::clone(&registry);
    let first = thread::spawn(move || {
        first_registry
            .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
            .unwrap()
    });
    wait_for(|| (spawner.spawned() == 1).then_some(()));
    let second_registry = Arc::clone(&registry);
    let second = thread::spawn(move || {
        second_registry
            .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
            .unwrap()
    });
    let control = spawner.control(0);
    wait_for(|| control.initialize_seen.load(Ordering::SeqCst).then_some(()));
    control.emit(&json!({"id": 1, "result": {}}));
    assert!(Arc::ptr_eq(&first.join().unwrap(), &second.join().unwrap()));
    assert_eq!(spawner.spawned(), 1);
}

#[test]
fn adopted_host_retains_the_cancellation_authority_of_startup_waiters() {
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::SilentInitialize);
    let registry = Arc::new(test_registry(Arc::clone(&spawner)));
    let starting = Arc::clone(&registry);
    let task = thread::spawn(move || {
        starting
            .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
            .unwrap()
    });
    wait_for(|| (spawner.spawned() == 1).then_some(()));
    let waiter_authority = Arc::clone(&registry.locked().starting[0].1);
    let control = spawner.control(0);
    wait_for(|| control.initialize_seen.load(Ordering::SeqCst).then_some(()));
    control.emit(&json!({"id": 1, "result": {}}));
    let _host = task.join().unwrap();
    assert!(registry.locked().starting.is_empty());
    assert!(!waiter_authority.load(Ordering::SeqCst));
    registry.retire_for_repository(Path::new("/repo/one"));
    assert!(waiter_authority.load(Ordering::SeqCst));
}

struct BlockingStopSpawner {
    inner: Arc<FakeHostProcessSpawner>,
    release: Arc<(Mutex<bool>, Condvar)>,
}

struct BlockingStopProcess {
    inner: Box<dyn CodexHostProcess>,
    release: Arc<(Mutex<bool>, Condvar)>,
}

impl CodexHostProcessSpawner for BlockingStopSpawner {
    fn spawn(&self, plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        Ok(Box::new(BlockingStopProcess {
            inner: self.inner.spawn(plan)?,
            release: Arc::clone(&self.release),
        }))
    }
}

impl CodexHostProcess for BlockingStopProcess {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        self.inner.take_streams()
    }
    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        self.inner.take_stderr()
    }
    fn stop(&mut self, graceful: Duration, force: Duration) {
        let (lock, changed) = &*self.release;
        let mut released = lock.lock().unwrap();
        while !*released {
            released = changed.wait(released).unwrap();
        }
        self.inner.stop(graceful, force);
    }
}

#[test]
fn repository_disposal_returns_without_waiting_for_process_reaping() {
    let inner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let registry = CodexAppServerHostRegistry::new(Arc::new(BlockingStopSpawner {
        inner: Arc::clone(&inner),
        release: Arc::clone(&release),
    }));
    let host = registry
        .host_for(test_key("/repo/one", 1), &test_plan("/repo/one"))
        .unwrap();
    let started = Instant::now();
    registry.retire_for_repository(Path::new("/repo/one"));
    let elapsed = started.elapsed();
    let unavailable = !host.is_ready();
    let still_running = inner.stopped() == 0;
    *release.0.lock().unwrap() = true;
    release.1.notify_all();
    wait_for(|| (registry.pending_reaps.load(Ordering::SeqCst) == 0).then_some(()));
    assert!(
        elapsed < Duration::from_millis(100),
        "disposal blocked for {elapsed:?}"
    );
    assert!(unavailable);
    assert!(still_running);
    assert_eq!(inner.stopped(), 1);
}

#[cfg(unix)]
#[test]
fn replaced_directory_does_not_reuse_a_host_from_the_same_path() {
    let root = std::env::temp_dir().join(format!(
        "codevo-host-authority-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let old = root.with_extension("old");
    let spawner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry = test_registry(Arc::clone(&spawner));
    let root_text = root.to_str().unwrap();
    let first_plan = test_plan(root_text).with_cwd_authority(Arc::new(File::open(&root).unwrap()));
    let first = registry
        .host_for(test_key(root_text, 1), &first_plan)
        .unwrap();
    std::fs::rename(&root, &old).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert!(registry
        .host_for(test_key(root_text, 1), &first_plan)
        .is_err());
    let second_plan = test_plan(root_text).with_cwd_authority(Arc::new(File::open(&root).unwrap()));
    let second = registry
        .host_for(test_key(root_text, 1), &second_plan)
        .unwrap();
    assert!(!Arc::ptr_eq(&first, &second));
    assert!(!first.is_ready());
    assert_eq!(spawner.spawned(), 2);
    registry.drain_for_dispose();
    std::fs::remove_dir(root).unwrap();
    std::fs::remove_dir(old).unwrap();
}

struct PanicOnceStopSpawner(Arc<FakeHostProcessSpawner>);
struct PanicOnceStopProcess {
    inner: Box<dyn CodexHostProcess>,
    panicked: bool,
}
impl CodexHostProcessSpawner for PanicOnceStopSpawner {
    fn spawn(&self, plan: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        Ok(Box::new(PanicOnceStopProcess {
            inner: self.0.spawn(plan)?,
            panicked: false,
        }))
    }
}
impl CodexHostProcess for PanicOnceStopProcess {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        self.inner.take_streams()
    }
    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        self.inner.take_stderr()
    }
    fn stop(&mut self, graceful: Duration, force: Duration) {
        if !self.panicked {
            self.panicked = true;
            panic!("one-shot stop fault");
        }
        self.inner.stop(graceful, force);
    }
}

#[test]
fn cleanup_worker_survives_a_process_stop_panic() {
    let inner = FakeHostProcessSpawner::new(FakeBehaviour::Ready);
    let registry =
        CodexAppServerHostRegistry::new(Arc::new(PanicOnceStopSpawner(Arc::clone(&inner))));
    for index in 0..2 {
        let root = format!("/repo/{index}");
        let host = registry
            .host_for(test_key(&root, 1), &test_plan(&root))
            .unwrap();
        registry.retire_for_repository(Path::new(&root));
        wait_for(|| (registry.pending_reaps.load(Ordering::SeqCst) == 0).then_some(()));
        assert_eq!(inner.stopped(), index + 1);
        drop(host);
    }
    assert_eq!(inner.stopped(), 2);
}
