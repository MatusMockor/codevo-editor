use super::*;
use agent_task_supervisor::AgentTaskMetadata;

type Hook = Box<dyn Fn(&AgentTaskMetadata) + Send + Sync>;
struct CaptureSink {
    before: Hook,
    after: Hook,
    events: RecordingSink,
}
impl AgentTaskEventSink for CaptureSink {
    fn before_start(&self, task: &AgentTaskMetadata, _: Option<&fs::File>) {
        (self.before)(task);
    }
    fn before_completion(&self, task: &AgentTaskMetadata, _: Option<&fs::File>) {
        (self.after)(task);
    }
    fn status(&self, event: AgentTaskStatusEvent) {
        self.events.status(event);
    }
    fn output(&self, event: AgentTaskOutputEvent) {
        self.events.output(event);
    }
}
fn setup(sink: Arc<CaptureSink>, spawner: Arc<FakeSpawner>) -> Arc<AgentTaskRegistry> {
    Arc::new(AgentTaskRegistry::with_dependencies(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        spawner,
        sink,
        Arc::new(RecordingSignalSender::default()),
        Duration::from_secs(60),
        Duration::from_millis(20),
        Duration::from_millis(30),
    ))
}
fn start(registry: &AgentTaskRegistry, root: &Path) -> Result<AgentTaskStartResult, String> {
    let admission = registry.admission().reserve(
        &workspace("ws-agent-tests"),
        root,
        root,
        AgentTaskIsolation::Worktree,
    )?;
    registry.start(
        start_request("agt-capture", root),
        fake_plan(root),
        admission,
    )
}

#[test]
fn completion_snapshot_retains_admission_and_precedes_terminal_publication() {
    let (entered, entered_rx) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    let captures = Arc::new(AtomicU64::new(0));
    let after_count = captures.clone();
    let sink = Arc::new(CaptureSink {
        before: Box::new(|_| {}),
        after: Box::new(move |task| {
            assert_eq!(task.task_id, "agt-capture");
            after_count.fetch_add(1, Ordering::SeqCst);
            entered.send(()).unwrap();
            release_rx.lock().unwrap().recv().unwrap();
        }),
        events: RecordingSink::default(),
    });
    let spawner = Arc::new(FakeSpawner::default());
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&FakeProcess::new(Some(0), None), 9781).build(),
    ));
    let registry = setup(sink.clone(), spawner);
    let root = unique_path("capture-completion");
    start(&registry, &root).unwrap();
    registry.acknowledge("agt-capture").unwrap();
    entered_rx.recv_timeout(EVENT_DEADLINE).unwrap();
    assert!(!sink.events.has_terminal_status("agt-capture"));
    assert!(registry
        .admission()
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::Worktree
        )
        .is_err());
    release.send(()).unwrap();
    assert!(wait_until(EVENT_DEADLINE, || sink
        .events
        .has_terminal_status("agt-capture")));
    registry.acknowledge("agt-capture").unwrap();
    registry.acknowledge("agt-capture").unwrap();
    assert_eq!(captures.load(Ordering::SeqCst), 1);
    assert!(registry
        .admission()
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::Worktree
        )
        .is_ok());
}

#[test]
fn cancellation_during_baseline_never_starts_provider() {
    for shutdown in [false, true] {
        let (entered, entered_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let sink = Arc::new(CaptureSink {
            before: Box::new(move |_| {
                entered.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }),
            after: Box::new(|_| {}),
            events: RecordingSink::default(),
        });
        let spawner = Arc::new(FakeSpawner::default());
        spawner.script(FakeSpawnOutcome::Fail("must not spawn".into()));
        let registry = setup(sink, spawner.clone());
        let worker_registry = registry.clone();
        let root = unique_path("capture-cancel");
        let worker = thread::spawn(move || start(&worker_registry, &root));
        entered_rx.recv_timeout(EVENT_DEADLINE).unwrap();
        if shutdown {
            registry.close_start_admission();
            registry.shutdown_all();
        } else {
            registry.stop("agt-capture").unwrap();
        }
        release.send(()).unwrap();
        assert!(worker.join().unwrap().is_err());
        assert_eq!(spawner.pending_outcomes(), 1);
    }
}

#[test]
fn snapshot_panics_do_not_break_provider_execution_or_terminal_publication() {
    let sink = Arc::new(CaptureSink {
        before: Box::new(|_| panic!("snapshot before failed")),
        after: Box::new(|_| panic!("snapshot after failed")),
        events: RecordingSink::default(),
    });
    let spawner = Arc::new(FakeSpawner::default());
    spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&FakeProcess::new(Some(0), None), 9782).build(),
    ));
    let registry = setup(sink.clone(), spawner);
    start(&registry, &unique_path("capture-failure")).unwrap();
    registry.acknowledge("agt-capture").unwrap();
    assert!(wait_until(EVENT_DEADLINE, || sink
        .events
        .has_terminal_status("agt-capture")));
}

struct UnreapableChild;
impl AgentChild for UnreapableChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }
    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(io::empty()))
    }
    fn observe_exit(&mut self) -> Result<bool, String> {
        Err("Cannot observe child exit".into())
    }
    fn reap(&mut self) -> Result<i32, String> {
        Err("Cannot reap child".into())
    }
    fn force_kill(&mut self) -> Result<(), String> {
        Err("Cannot stop child".into())
    }
    fn process_group_id(&self) -> i32 {
        9783
    }
}
struct UnreapableSpawner;
impl AgentProcessSpawner for UnreapableSpawner {
    fn spawn(&self, _: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        Ok(Box::new(UnreapableChild))
    }
}
#[test]
fn an_unreaped_provider_never_publishes_an_after_snapshot() {
    let captures = Arc::new(AtomicU64::new(0));
    let after_count = captures.clone();
    let sink = Arc::new(CaptureSink {
        before: Box::new(|_| {}),
        after: Box::new(move |_| {
            after_count.fetch_add(1, Ordering::SeqCst);
        }),
        events: RecordingSink::default(),
    });
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        Arc::new(UnreapableSpawner),
        sink.clone(),
        Arc::new(FailingSignalSender),
        Duration::from_secs(60),
        Duration::from_millis(10),
        Duration::from_millis(20),
    );
    start(&registry, &unique_path("capture-unreaped")).unwrap();
    registry.acknowledge("agt-capture").unwrap();
    assert!(wait_until(EVENT_DEADLINE, || sink
        .events
        .has_terminal_status("agt-capture")));
    assert_eq!(captures.load(Ordering::SeqCst), 0);
}
