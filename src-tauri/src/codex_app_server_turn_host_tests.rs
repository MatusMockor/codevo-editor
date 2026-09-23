use super::super::super::codex_app_server_host::*;
use super::super::super::codex_app_server_protocol::{
    ThreadResumeParams, ThreadStartParams, TurnStartParams,
};
use super::super::super::codex_app_server_transport::CodexAppServerStreams;
use super::*;
use crate::agent_task_spawner::agent_provider::process::executable_identity;
use crate::agent_task_spawner::{AgentChild, AgentTaskProcessOwnership};
use std::io::{pipe, BufRead, BufReader, PipeWriter, Write};
use std::path::{Path, PathBuf};

struct Control {
    writer: Mutex<Option<PipeWriter>>,
    stopped: AtomicBool,
    reject_interrupt: bool,
    reject_start: AtomicBool,
    reject_resume: AtomicBool,
    transient_resume: AtomicBool,
    malformed_resume: AtomicBool,
    unsubscribe: Mutex<Option<Value>>,
    methods: Mutex<Vec<String>>,
    requests: Mutex<Vec<Value>>,
    reject_clean: AtomicBool,
    remaining_terminal_polls: AtomicUsize,
}
impl Control {
    fn emit(&self, frame: Value) {
        if let Some(writer) = self.writer.lock().unwrap().as_mut() {
            let _ = writeln!(writer, "{frame}");
        }
    }
    fn acknowledge_unsubscribe(&self) {
        let id = self.unsubscribe.lock().unwrap().take().unwrap();
        self.emit(json!({"id":id,"result":{"status":"unsubscribed"}}));
    }
}
struct Process {
    streams: Option<CodexAppServerStreams>,
    control: Arc<Control>,
}
impl CodexHostProcess for Process {
    fn take_streams(&mut self) -> Result<CodexAppServerStreams, String> {
        Ok(self.streams.take().unwrap())
    }
    fn take_stderr(&mut self) -> Option<Box<dyn Read + Send>> {
        None
    }
    fn stop(&mut self, _: Duration, _: Duration) {
        self.control.stopped.store(true, Ordering::SeqCst);
        self.control.writer.lock().unwrap().take();
    }
}
struct Spawner {
    control: Arc<Control>,
}
impl CodexHostProcessSpawner for Spawner {
    fn spawn(&self, _: &CodexHostLaunchPlan) -> Result<Box<dyn CodexHostProcess>, String> {
        let (output, writer) = pipe().unwrap();
        let (reader, input) = pipe().unwrap();
        *self.control.writer.lock().unwrap() = Some(writer);
        let control = self.control.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines() {
                let Ok(line) = line else {
                    break;
                };
                let frame: Value = serde_json::from_str(&line).unwrap();
                let Some(id) = frame.get("id") else {
                    continue;
                };
                let method = frame["method"].as_str().unwrap();
                control.methods.lock().unwrap().push(method.into());
                control.requests.lock().unwrap().push(frame.clone());
                if method == "thread/resume" && control.malformed_resume.load(Ordering::SeqCst) {
                    control.emit(json!({"id":id,"result":{"thread":{"id":"wrong-authority"}}}));
                    continue;
                }
                if method == "thread/resume" && control.reject_resume.load(Ordering::SeqCst) {
                    control.emit(
                        json!({"id":id,"error":{"code":-32600,"message":"no rollout found for thread id previous-thread"}}),
                    );
                    continue;
                }
                if method == "thread/resume" && control.transient_resume.load(Ordering::SeqCst) {
                    control.emit(
                        json!({"id":id,"error":{"code":-32000,"message":"resume unavailable"}}),
                    );
                    continue;
                }
                if method == "turn/start" && control.reject_start.load(Ordering::SeqCst) {
                    control
                        .emit(json!({"id":id,"error":{"code":-32000,"message":"turn rejected"}}));
                    continue;
                }
                if method == "thread/unsubscribe" {
                    *control.unsubscribe.lock().unwrap() = Some(id.clone());
                    continue;
                }
                if method == "turn/interrupt" && control.reject_interrupt {
                    control.emit(
                        json!({"id":id,"error":{"code":-32000,"message":"interrupt rejected"}}),
                    );
                    continue;
                }
                if method == "thread/backgroundTerminals/clean"
                    && control.reject_clean.load(Ordering::SeqCst)
                {
                    control.emit(
                        json!({"id":id,"error":{"code":-32000,"message":"cleanup rejected"}}),
                    );
                    continue;
                }
                let result = match method {
                    "thread/backgroundTerminals/list" => {
                        let busy = control
                            .remaining_terminal_polls
                            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                            .is_ok();
                        json!({"data": if busy { vec![json!({"processId":"owned-process"})] } else {vec![]}, "nextCursor":null})
                    }
                    "thread/start" | "thread/resume" => json!({"thread":{"id":THREAD}}),
                    "turn/start" => json!({"turn":{"id":TURN,"status":"inProgress"}}),
                    _ => json!({}),
                };
                control.emit(json!({"id":id,"result":result}));
                if method == "turn/interrupt" {
                    control.emit(json!({"method":"turn/completed","params":{"threadId":THREAD,"turn":{"id":TURN,"status":"interrupted"}}}));
                }
            }
        });
        Ok(Box::new(Process {
            streams: Some(CodexAppServerStreams {
                input: Box::new(input),
                output: Box::new(output),
            }),
            control: self.control.clone(),
        }))
    }
}

fn setup_host(
    reject_interrupt: bool,
) -> (
    CodexAppServerHostRegistry,
    Arc<CodexAppServerHost>,
    Arc<Control>,
) {
    let control = Arc::new(Control {
        writer: Mutex::new(None),
        stopped: AtomicBool::new(false),
        reject_interrupt,
        reject_start: AtomicBool::new(false),
        reject_resume: AtomicBool::new(false),
        transient_resume: AtomicBool::new(false),
        malformed_resume: AtomicBool::new(false),
        unsubscribe: Mutex::new(None),
        methods: Mutex::new(Vec::new()),
        requests: Mutex::new(Vec::new()),
        reject_clean: AtomicBool::new(false),
        remaining_terminal_polls: AtomicUsize::new(0),
    });
    let registry = CodexAppServerHostRegistry::new(Arc::new(Spawner {
        control: control.clone(),
    }));
    let identity = executable_identity("/bin/echo").unwrap();
    let key = CodexHostKey::new(PathBuf::from("/repo"), 1, identity.clone());
    let plan = CodexHostLaunchPlan::new(identity, Path::new("/repo"), &[], &[]).unwrap();
    let host = registry.host_for(key, &plan).unwrap();
    (registry, host, control)
}

fn setup(
    reject_interrupt: bool,
) -> (
    CodexAppServerHostRegistry,
    Arc<CodexAppServerHost>,
    Arc<Control>,
    CodexTurnChild,
) {
    let (registry, host, control) = setup_host(reject_interrupt);
    let thread = host
        .start_thread(ThreadStartParams {
            cwd: Some("/repo".into()),
            model: None,
            sandbox: None,
            approval_policy: None,
            developer_instructions: None,
        })
        .unwrap();
    let turn = host
        .start_turn(
            &thread,
            TurnStartParams {
                thread_id: THREAD.into(),
                input: vec![],
                cwd: None,
                model: None,
                approval_policy: None,
                sandbox_policy: None,
                effort: None,
                client_user_message_id: None,
                turn_trigger: None,
            },
        )
        .unwrap();
    let child = CodexTurnChild::new(host.clone(), thread, turn).unwrap();
    (registry, host, control, child)
}
fn resume_params() -> ThreadResumeParams {
    ThreadResumeParams {
        thread_id: THREAD.into(),
        cwd: Some("/repo".into()),
        model: None,
        sandbox: None,
        approval_policy: None,
        developer_instructions: None,
        exclude_turns: true,
    }
}

#[test]
fn rejected_interrupt_retires_and_stops_shared_host_before_reap_returns() {
    let (_registry, host, control, child) = setup(true);
    assert_eq!(
        AgentChild::ownership(&child),
        AgentTaskProcessOwnership::SharedSession
    );
    assert_eq!(AgentChild::process_group_id(&child), 0);
    child.force_kill();
    assert_eq!(
        child.reap().unwrap_err(),
        "Codex turn interruption could not be confirmed."
    );
    assert!(control.stopped.load(Ordering::SeqCst));
    assert!(!host.is_ready());
    assert_eq!(host.live_turns(), 0);
    assert!(host.resume_thread(resume_params()).is_err());
}

#[test]
fn successful_cleanup_retains_route_until_unsubscribe_ack_then_resume_is_allowed() {
    let (_registry, host, control, mut child) = setup(false);
    let mut output = child.stdout_reader().unwrap();
    read_chunk(&mut output).unwrap();
    control.emit(json!({"method":"turn/completed","params":{"threadId":THREAD,"turn":{"id":TURN,"status":"completed"}}}));
    wait_until(|| match read_chunk(&mut output) {
        Ok(text) => text.contains("result"),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => false,
        Err(error) => panic!("{error}"),
    });
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let reaper = std::thread::spawn(move || {
        done_tx.send(child.reap()).unwrap();
    });
    wait_until(|| control.unsubscribe.lock().unwrap().is_some());
    assert_eq!(host.live_turns(), 1);
    assert!(matches!(
        done_rx.try_recv(),
        Err(std::sync::mpsc::TryRecvError::Empty)
    ));
    assert!(host.resume_thread(resume_params()).is_err());
    control.acknowledge_unsubscribe();
    assert_eq!(
        done_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap(),
        0
    );
    reaper.join().unwrap();
    assert!(host.is_ready());
    assert!(!control.stopped.load(Ordering::SeqCst));
    assert_eq!(host.live_turns(), 0);
    assert!(!control
        .methods
        .lock()
        .unwrap()
        .iter()
        .any(|method| method.starts_with("thread/backgroundTerminals/")));
    let resumed = host.resume_thread(resume_params()).unwrap();
    assert_eq!(resumed.thread_id(), THREAD);
}

fn validated_plan(
    host: Arc<CodexAppServerHost>,
    calls: Arc<AtomicUsize>,
    accepted_checks: usize,
) -> CodexAppServerTurnPlan {
    CodexAppServerTurnPlan {
        host,
        validate_authority: Arc::new(move || {
            if calls.fetch_add(1, Ordering::SeqCst) < accepted_checks {
                Ok(())
            } else {
                Err("workspace authority revoked".into())
            }
        }),
        thread_start: ThreadStartParams {
            cwd: Some("/repo".into()),
            model: None,
            sandbox: None,
            approval_policy: None,
            developer_instructions: None,
        },
        thread_resume: None,
        turn_start: TurnStartParams {
            thread_id: String::new(),
            input: vec![],
            cwd: None,
            model: None,
            approval_policy: None,
            sandbox_policy: None,
            effort: None,
            client_user_message_id: None,
            turn_trigger: None,
        },
    }
}

#[test]
fn revoked_preflight_authority_never_opens_a_thread() {
    let (_registry, host, control) = setup_host(false);
    let calls = Arc::new(AtomicUsize::new(0));
    let plan = validated_plan(host.clone(), calls.clone(), 0);
    assert_eq!(
        plan.spawn().err().as_deref(),
        Some("workspace authority revoked")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(*control.methods.lock().unwrap(), vec!["initialize"]);
    assert_eq!(host.live_turns(), 0);
    assert!(host.is_ready());
}

#[test]
fn authority_revoked_after_thread_response_unsubscribes_without_starting_turn() {
    let (_registry, host, control) = setup_host(false);
    let calls = Arc::new(AtomicUsize::new(0));
    let plan = validated_plan(host.clone(), calls.clone(), 1);
    let spawning = std::thread::spawn(move || plan.spawn().err());
    wait_until(|| control.unsubscribe.lock().unwrap().is_some());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        *control.methods.lock().unwrap(),
        vec!["initialize", "thread/start", "thread/unsubscribe"]
    );
    assert_eq!(host.live_turns(), 0);
    control.acknowledge_unsubscribe();
    assert_eq!(
        spawning.join().unwrap().as_deref(),
        Some("workspace authority revoked")
    );
    assert!(host.is_ready());
    assert!(!control.stopped.load(Ordering::SeqCst));
    let resumed = host.resume_thread(resume_params()).unwrap();
    assert_eq!(resumed.thread_id(), THREAD);
    assert_eq!(host.live_turns(), 0);
}

#[test]
fn authority_revoked_after_turn_start_retires_host_before_returning_error() {
    let (_registry, host, control) = setup_host(true);
    let calls = Arc::new(AtomicUsize::new(0));
    let plan = validated_plan(host.clone(), calls.clone(), 2);
    assert_eq!(
        plan.spawn().err().as_deref(),
        Some("workspace authority revoked")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        *control.methods.lock().unwrap(),
        vec!["initialize", "thread/start", "turn/start", "turn/interrupt"]
    );
    assert!(control.stopped.load(Ordering::SeqCst));
    assert!(!host.is_ready());
    assert_eq!(host.live_turns(), 0);
}

#[test]
fn rejected_turn_start_unsubscribes_new_and_resumed_threads_before_returning_error() {
    for resume in [false, true] {
        let (_registry, host, control) = setup_host(false);
        control.reject_start.store(true, Ordering::SeqCst);
        let mut plan = validated_plan(host.clone(), Arc::new(AtomicUsize::new(0)), usize::MAX);
        if resume {
            plan.thread_resume = Some(resume_params());
        }
        let spawning = std::thread::spawn(move || plan.spawn().err());
        wait_until(|| control.unsubscribe.lock().unwrap().is_some());
        assert!(!spawning.is_finished());
        assert_eq!(
            *control.methods.lock().unwrap(),
            vec![
                "initialize",
                if resume {
                    "thread/resume"
                } else {
                    "thread/start"
                },
                "turn/start",
                "thread/unsubscribe",
            ]
        );
        control.acknowledge_unsubscribe();
        assert_eq!(spawning.join().unwrap().as_deref(), Some("turn rejected"));
        assert!(host.is_ready());
        assert!(!control.stopped.load(Ordering::SeqCst));
        assert_eq!(host.live_turns(), 0);
        assert!(host.resume_thread(resume_params()).is_ok());
    }
}

#[test]
fn rejected_turn_start_with_failed_unsubscribe_retires_host_and_preserves_start_error() {
    let (_registry, host, control) = setup_host(false);
    control.reject_start.store(true, Ordering::SeqCst);
    let plan = validated_plan(host.clone(), Arc::new(AtomicUsize::new(0)), usize::MAX);
    let spawning = std::thread::spawn(move || plan.spawn().err());
    wait_until(|| control.unsubscribe.lock().unwrap().is_some());
    let id = control.unsubscribe.lock().unwrap().take().unwrap();
    control.emit(json!({"id":id,"error":{"code":-32000,"message":"unsubscribe rejected"}}));
    assert_eq!(spawning.join().unwrap().as_deref(), Some("turn rejected"));
    assert!(!host.is_ready());
    assert!(control.stopped.load(Ordering::SeqCst));
    assert_eq!(host.live_turns(), 0);
    assert!(host.resume_thread(resume_params()).is_err());
}

#[test]
fn stopped_turn_cleans_only_owned_threads_and_verifies_before_unsubscribe() {
    let (_registry, host, control, child) = setup(false);
    // Stop wins before stdout consumes the activity announcing the child.
    control.emit(json!({"method":"item/started","params":{"threadId":THREAD,"turnId":TURN,"item":{"type":"subAgentActivity","id":"spawn-child","kind":"started","agentThreadId":"owned-subagent"}}}));
    control.remaining_terminal_polls.store(2, Ordering::SeqCst);
    child.force_kill();
    let reaper = std::thread::spawn(move || child.reap());
    wait_until(|| control.unsubscribe.lock().unwrap().is_some());
    assert!(!reaper.is_finished());
    let requests = control.requests.lock().unwrap().clone();
    assert_eq!(
        requests[0]["params"]["capabilities"]["experimentalApi"],
        true
    );
    let cleaned: Vec<_> = requests
        .iter()
        .filter(|frame| frame["method"] == "thread/backgroundTerminals/clean")
        .map(|frame| frame["params"]["threadId"].as_str().unwrap())
        .collect();
    assert_eq!(cleaned, vec![THREAD, "owned-subagent"]);
    let methods = control.methods.lock().unwrap().clone();
    let interrupt = methods
        .iter()
        .position(|method| method == "turn/interrupt")
        .unwrap();
    let clean = methods
        .iter()
        .position(|method| method == "thread/backgroundTerminals/clean")
        .unwrap();
    let unsubscribe = methods
        .iter()
        .position(|method| method == "thread/unsubscribe")
        .unwrap();
    assert!(interrupt < clean && clean < unsubscribe);
    assert_eq!(
        methods
            .iter()
            .filter(|method| method.as_str() == "thread/backgroundTerminals/list")
            .count(),
        4
    );
    assert!(requests
        .iter()
        .filter(|frame| frame["method"] == "thread/backgroundTerminals/list")
        .all(|frame| frame["params"]["limit"] == 1));
    control.acknowledge_unsubscribe();
    assert_eq!(reaper.join().unwrap().unwrap(), 130);
    assert!(host.is_ready());
    assert!(!control.stopped.load(Ordering::SeqCst));
}

#[test]
fn rejected_terminal_cleanup_retires_host_without_claiming_unsubscribe_success() {
    let (_registry, host, control, child) = setup(false);
    control.reject_clean.store(true, Ordering::SeqCst);
    child.force_kill();
    assert_eq!(
        child.reap().unwrap_err(),
        "Codex background terminal cleanup could not be confirmed."
    );
    assert_eq!(
        child.reap().unwrap_err(),
        "Codex background terminal cleanup could not be confirmed."
    );
    assert!(!host.is_ready());
    assert!(control.stopped.load(Ordering::SeqCst));
    assert!(control.unsubscribe.lock().unwrap().is_none());
}

#[test]
fn terminal_cleanup_verification_has_a_total_deadline() {
    let (_registry, host, control) = setup_host(false);
    control
        .remaining_terminal_polls
        .store(usize::MAX, Ordering::SeqCst);
    let result =
        host.clean_background_terminals_within(THREAD, Instant::now() + Duration::from_millis(50));
    assert!(matches!(result, Err(CodexRpcFailure::Timeout)));
    assert!(control.unsubscribe.lock().unwrap().is_none());
}

#[test]
fn stopped_turn_cleans_subagent_from_dequeued_but_unprojected_activity() {
    let (_registry, host, control, child) = setup(false);
    control.emit(json!({"method":"item/started","params":{"threadId":THREAD,"turnId":TURN,"item":{"type":"subAgentActivity","id":"spawn-child","kind":"started","agentThreadId":"dequeued-subagent"}}}));
    // Receive the frame but never run the UI/output projection that used to
    // establish ownership. This is the reader paused between receive/project.
    wait_until(|| {
        matches!(
            child.state.port.receive(),
            Ok(TurnFrame::Notification(notification)) if matches!(*notification, ServerNotification::ItemStarted(_))
        )
    });
    child.force_kill();
    let reaper = std::thread::spawn(move || child.reap());
    wait_until(|| control.unsubscribe.lock().unwrap().is_some());
    let requests = control.requests.lock().unwrap().clone();
    let cleaned: Vec<_> = requests
        .iter()
        .filter(|frame| frame["method"] == "thread/backgroundTerminals/clean")
        .map(|frame| frame["params"]["threadId"].as_str().unwrap())
        .collect();
    assert_eq!(cleaned, vec![THREAD, "dequeued-subagent"]);
    control.acknowledge_unsubscribe();
    assert_eq!(reaper.join().unwrap().unwrap(), 130);
    assert!(host.is_ready());
}

#[test]
fn confirmed_resume_fallback_emits_exact_old_and_new_authority_before_notice() {
    for fallback in [false, true] {
        let (_registry, host, control) = setup_host(false);
        control.reject_resume.store(fallback, Ordering::SeqCst);
        let mut plan = validated_plan(host.clone(), Arc::new(AtomicUsize::new(0)), usize::MAX);
        let mut resume = resume_params();
        if fallback {
            resume.thread_id = "previous-thread".into();
        }
        plan.thread_resume = Some(resume);
        let mut child = plan.spawn().unwrap();
        let mut stdout = child.stdout_reader().unwrap();
        let initial = read_chunk(&mut stdout).unwrap();
        let frames: Vec<Value> = initial
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        if fallback {
            assert_eq!(
                frames[0],
                json!({"v":1,"t":"sessionFallback","previousThreadId":"previous-thread","threadId":THREAD})
            );
            assert_eq!(frames.len(), 2);
            assert_eq!(frames[1]["t"], "notice");
            assert_eq!(frames[1]["severity"], "warning");
            assert!(!frames.iter().any(|frame| frame["t"] == "session"));
        } else {
            assert_eq!(frames, vec![json!({"v":1,"t":"session","threadId":THREAD})]);
        }
        control.emit(json!({"method":"turn/completed","params":{"threadId":THREAD,"turn":{"id":TURN,"status":"completed"}}}));
        wait_until(|| match read_chunk(&mut stdout) {
            Ok(text) => text.contains("result"),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => false,
            Err(error) => panic!("{error}"),
        });
        let reaper = std::thread::spawn(move || child.reap());
        wait_until(|| control.unsubscribe.lock().unwrap().is_some());
        control.acknowledge_unsubscribe();
        assert_eq!(reaper.join().unwrap().unwrap(), 0);
    }
}

#[test]
fn invalid_resume_authority_never_authorizes_a_fallback_session() {
    let (_registry, host, control) = setup_host(false);
    control.malformed_resume.store(true, Ordering::SeqCst);
    let mut plan = validated_plan(host.clone(), Arc::new(AtomicUsize::new(0)), usize::MAX);
    plan.thread_resume = Some(resume_params());
    assert!(plan.spawn().is_err());
    assert_eq!(
        *control.methods.lock().unwrap(),
        vec!["initialize", "thread/resume"]
    );
    assert_eq!(host.live_turns(), 0);
}

#[test]
fn transient_resume_failure_fails_the_turn_without_starting_a_new_session() {
    let (_registry, host, control) = setup_host(false);
    control.transient_resume.store(true, Ordering::SeqCst);
    let mut plan = validated_plan(host.clone(), Arc::new(AtomicUsize::new(0)), usize::MAX);
    plan.thread_resume = Some(resume_params());
    let error = plan
        .spawn()
        .err()
        .expect("transient resume failure must fail the turn");
    assert_eq!(
        error,
        "Codex could not resume the previous session: resume unavailable"
    );
    assert_eq!(
        *control.methods.lock().unwrap(),
        vec!["initialize", "thread/resume"]
    );
    assert_eq!(host.live_turns(), 0);
}
