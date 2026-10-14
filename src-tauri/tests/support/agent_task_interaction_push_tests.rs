use super::*;
use agent_questions::approvals::{
    AgentApprovalDecision, AgentApprovalFact, AgentApprovalKind, AgentApprovalRequest,
    AgentApprovalStatus,
};
use agent_questions::{
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionRequest, AgentQuestionResponse,
    AgentQuestionSession, AgentQuestionStatus,
};

const WORKSPACE: &str = "ws-agent-tests";

fn question(id: &str) -> AgentQuestionRequest {
    AgentQuestionRequest {
        id: id.into(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        questions: vec![AgentQuestion {
            id: "q".into(),
            header: String::new(),
            prompt: "Choose".into(),
            options: Vec::new(),
            multiple: false,
            allow_custom: true,
        }],
        status: AgentQuestionStatus::Pending,
        answers: None,
    }
}

fn response() -> AgentQuestionResponse {
    AgentQuestionResponse {
        answers: vec![AgentQuestionAnswerItem {
            question_id: "q".into(),
            option_ids: Vec::new(),
            text: "answer".into(),
        }],
    }
}

fn approval(id: &str) -> AgentApprovalRequest {
    AgentApprovalRequest {
        id: id.into(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        kind: AgentApprovalKind::Command,
        title: "Run a command".into(),
        detail: "npm test".into(),
        detail_truncated: false,
        facts: vec![AgentApprovalFact {
            label: "Directory".into(),
            value: "/repo".into(),
        }],
        decisions: vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny,
        ],
        status: AgentApprovalStatus::Pending,
        decision: None,
    }
}

struct RunningTask {
    session: Arc<AgentQuestionSession>,
    process: Arc<FakeProcess>,
}

fn start_with_session(
    fixture: &Fixture,
    task_id: &str,
    repository_root: &Path,
    process_group_id: i32,
) -> RunningTask {
    let session = Arc::new(AgentQuestionSession::new());
    let process = FakeProcess::new(None, Some(0));
    let mut child = FakeChildSpec::new(&process, process_group_id).build();
    child.questions = Some(Arc::clone(&session));
    fixture.signals.track(process_group_id, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    let started = dispatch(
        fixture,
        task_id,
        repository_root,
        &repository_root.join(".worktrees").join(task_id),
    );
    assert_eq!(
        started.map(|result| result.task_id),
        Ok(task_id.to_string())
    );
    assert_eq!(fixture.registry.acknowledge(task_id), Ok(()));
    RunningTask { session, process }
}

fn pushed_for(fixture: &Fixture, task_id: &str) -> Vec<AgentInteractionSnapshot> {
    fixture
        .sink
        .interactions()
        .into_iter()
        .filter(|snapshot| snapshot.task_id == task_id)
        .collect()
}

fn question_statuses(snapshot: &AgentInteractionSnapshot) -> Vec<AgentQuestionStatus> {
    snapshot
        .questions
        .iter()
        .map(|request| request.status.clone())
        .collect()
}

fn approval_statuses(snapshot: &AgentInteractionSnapshot) -> Vec<AgentApprovalStatus> {
    snapshot
        .approvals
        .iter()
        .map(|request| request.status)
        .collect()
}

#[test]
fn starting_a_task_pushes_the_interactions_its_session_already_holds() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let session = Arc::new(AgentQuestionSession::new());
    assert_eq!(
        session.register(question("question-early"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let process = FakeProcess::new(None, Some(0));
    let mut child = FakeChildSpec::new(&process, 9701).build();
    child.questions = Some(Arc::clone(&session));
    fixture.signals.track(9701, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    let started = dispatch(
        &fixture,
        "agt-early",
        root,
        &root.join(".worktrees/agt-early"),
    );
    assert_eq!(
        started.map(|result| result.task_id),
        Ok("agt-early".to_string())
    );
    let pushed = pushed_for(&fixture, "agt-early");
    assert_eq!(pushed.len(), 1);
    assert_eq!(pushed[0].workspace_id, WORKSPACE);
    assert_eq!(pushed[0].sequence, 1);
    assert_eq!(pushed[0].questions.len(), 1);
    assert_eq!(pushed[0].questions[0].id, "question-early");
    assert_eq!(pushed[0].questions[0].task_id, "agt-early");
    assert_eq!(fixture.registry.stop("agt-early"), Ok(()));
}

#[test]
fn every_pushed_snapshot_names_the_task_and_thread_that_own_its_session() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let first = start_with_session(&fixture, "agt-owner-a", root, 9731);
    let second = start_with_session(&fixture, "agt-owner-b", root, 9732);
    assert_eq!(
        second
            .session
            .register(question("question-b"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        first
            .session
            .register(question("question-a"), Arc::new(|_| Ok(()))),
        Ok(())
    );

    let owners = fixture.sink.interaction_owners();
    let pushed = fixture.sink.interactions();
    assert_eq!(owners.len(), pushed.len());
    assert!(pushed.len() >= 4);
    for (owner, snapshot) in owners.iter().zip(&pushed) {
        assert_eq!(owner.task_id, snapshot.task_id);
        assert_eq!(owner.workspace_id, snapshot.workspace_id);
        assert_eq!(owner.thread_id, "thread-a");
        assert_eq!(owner.cwd, root.join(".worktrees").join(&snapshot.task_id));
    }
    let before = fixture.registry.next_interaction_sequence();
    assert!(
        before
            > pushed
                .iter()
                .map(|snapshot| snapshot.sequence)
                .max()
                .unwrap_or(0)
    );
    assert_eq!(
        first
            .session
            .register(question("question-c"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let latest = pushed_for(&fixture, "agt-owner-a")
        .last()
        .map(|snapshot| snapshot.sequence);
    assert!(latest > Some(before));
    assert_eq!(fixture.registry.stop("agt-owner-a"), Ok(()));
    assert_eq!(fixture.registry.stop("agt-owner-b"), Ok(()));
    drop((first.process, second.process));
}

#[test]
fn a_task_without_a_session_pushes_nothing_and_reads_as_empty() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let process = FakeProcess::new(None, Some(0));
    fixture.signals.track(9702, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(
        FakeChildSpec::new(&process, 9702).build(),
    ));
    let started = dispatch(
        &fixture,
        "agt-plain",
        root,
        &root.join(".worktrees/agt-plain"),
    );
    assert_eq!(
        started.map(|result| result.task_id),
        Ok("agt-plain".to_string())
    );
    assert_eq!(
        fixture.registry.interactions("agt-plain", WORKSPACE, root),
        Ok(AgentInteractionSnapshot::empty("agt-plain", WORKSPACE))
    );
    assert_eq!(fixture.registry.stop("agt-plain"), Ok(()));
    assert!(wait_until(EVENT_DEADLINE, || {
        fixture.sink.has_terminal_status("agt-plain") || process.exit_code().is_some()
    }));
    assert!(pushed_for(&fixture, "agt-plain").is_empty());
}

#[test]
fn session_changes_are_pushed_and_numbered_together_with_pulls() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-live", root, 9703);
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        task.session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    let pulled = fixture.registry.interactions("agt-live", WORKSPACE, root);
    assert_eq!(pulled.as_ref().map(|snapshot| snapshot.sequence), Ok(4));
    assert_eq!(
        fixture
            .registry
            .answer_question("agt-live", WORKSPACE, root, "question-1", response())
            .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        fixture
            .registry
            .answer_approval(
                "agt-live",
                WORKSPACE,
                root,
                "approval-1",
                AgentApprovalDecision::Deny
            )
            .map(|request| request.status),
        Ok(AgentApprovalStatus::Denied)
    );
    let pushed = pushed_for(&fixture, "agt-live");
    assert_eq!(
        pushed
            .iter()
            .map(|snapshot| snapshot.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 5, 6]
    );
    assert!(pushed
        .iter()
        .all(|snapshot| snapshot.workspace_id == WORKSPACE));
    assert_eq!(
        question_statuses(&pushed[4]),
        vec![AgentQuestionStatus::Answered]
    );
    assert_eq!(
        approval_statuses(&pushed[4]),
        vec![AgentApprovalStatus::Denied]
    );
    assert_eq!(pushed[4].approvals[0].task_id, "agt-live");
    assert_eq!(fixture.registry.stop("agt-live"), Ok(()));
}

#[test]
fn a_task_in_a_nested_repository_is_read_and_answered_through_its_workspace() {
    let fixture = fixture(Duration::from_secs(10));
    let workspace_root = Path::new("/workspace-root");
    let repository = workspace_root.join("nested-repository");
    let task = start_with_session(&fixture, "agt-nested", &repository, 9704);
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        fixture
            .registry
            .interactions("agt-nested", WORKSPACE, workspace_root)
            .map(|snapshot| question_statuses(&snapshot)),
        Ok(vec![AgentQuestionStatus::Pending])
    );
    assert_eq!(
        fixture
            .registry
            .answer_question(
                "agt-nested",
                WORKSPACE,
                workspace_root,
                "question-1",
                response()
            )
            .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    for foreign in ["/workspace", "/workspace-root/nested", "/elsewhere", ""] {
        assert!(
            fixture
                .registry
                .interactions("agt-nested", WORKSPACE, Path::new(foreign))
                .is_err(),
            "{foreign:?} does not contain the task repository"
        );
        assert!(
            fixture
                .registry
                .answer_question(
                    "agt-nested",
                    WORKSPACE,
                    Path::new(foreign),
                    "question-1",
                    response()
                )
                .is_err(),
            "{foreign:?} does not contain the task repository"
        );
    }
    assert_eq!(fixture.registry.stop("agt-nested"), Ok(()));
}

#[test]
fn stopping_a_task_pushes_its_pending_requests_as_expired() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-stopped", root, 9705);
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        task.session
            .approvals()
            .register(approval("approval-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        fixture
            .registry
            .stop_for_workspace("agt-stopped", WORKSPACE),
        Ok(())
    );
    let pushed = pushed_for(&fixture, "agt-stopped");
    let last = pushed.last().expect("a snapshot after stop");
    assert_eq!(pushed.len(), 4);
    assert_eq!(last.sequence, 4);
    assert_eq!(question_statuses(last), vec![AgentQuestionStatus::Expired]);
    assert_eq!(approval_statuses(last), vec![AgentApprovalStatus::Expired]);
}

#[test]
fn a_finished_task_pushes_a_final_snapshot_with_its_pending_requests_expired() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-finished", root, 9706);
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    task.process.set_exited(0);
    assert!(wait_until(EVENT_DEADLINE, || {
        fixture.sink.has_terminal_status("agt-finished")
    }));
    let pushed = pushed_for(&fixture, "agt-finished");
    let last = pushed.last().expect("a final snapshot");
    assert_eq!(pushed.len(), 3);
    assert_eq!(last.sequence, 3);
    assert_eq!(question_statuses(last), vec![AgentQuestionStatus::Expired]);
    assert_eq!(
        fixture
            .registry
            .interactions("agt-finished", WORKSPACE, root)
            .map(|snapshot| (snapshot.sequence, question_statuses(&snapshot))),
        Ok((4, vec![AgentQuestionStatus::Expired]))
    );
    assert!(fixture
        .registry
        .answer_question("agt-finished", WORKSPACE, root, "question-1", response())
        .is_err());
    assert_eq!(pushed_for(&fixture, "agt-finished").len(), 3);
}

#[test]
fn a_task_that_failed_to_start_stops_pushing_once_its_entry_is_removed() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let session = Arc::new(AgentQuestionSession::new());
    let process = FakeProcess::new(None, Some(0));
    let mut child = FakeChildSpec::new(&process, 9707)
        .with_stdout_reader_fault()
        .build();
    child.questions = Some(Arc::clone(&session));
    fixture.signals.track(9707, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    let started = dispatch(
        &fixture,
        "agt-unstarted",
        root,
        &root.join(".worktrees/agt-unstarted"),
    );
    assert!(started.is_err());
    assert_eq!(pushed_for(&fixture, "agt-unstarted").len(), 1);
    assert_eq!(
        session.register(question("question-late"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    session.close();
    assert_eq!(pushed_for(&fixture, "agt-unstarted").len(), 1);
}

#[test]
fn removing_a_registered_entry_detaches_its_session_observer() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let session = Arc::new(AgentQuestionSession::new());
    let process = FakeProcess::new(None, None);
    let mut child = FakeChildSpec::new(&process, 9710).build();
    child.questions = Some(Arc::clone(&session));
    fixture.signals.track(9710, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    fixture.registry.fail_next_waiter_start_for_tests();
    let started = dispatch(
        &fixture,
        "agt-removed",
        root,
        &root.join(".worktrees/agt-removed"),
    );
    assert!(started.is_err());
    assert_eq!(
        fixture
            .registry
            .interactions("agt-removed", WORKSPACE, root),
        Ok(AgentInteractionSnapshot::empty("agt-removed", WORKSPACE))
    );
    assert_eq!(pushed_for(&fixture, "agt-removed").len(), 1);
    assert_eq!(
        session.register(question("question-late"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    session.close();
    assert_eq!(pushed_for(&fixture, "agt-removed").len(), 1);
}

#[test]
fn a_panicking_interaction_sink_strands_neither_the_session_nor_the_registry() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    fixture
        .sink
        .panic_on_interactions
        .store(true, Ordering::SeqCst);
    let task = start_with_session(&fixture, "agt-panicking-sink", root, 9708);
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(|_| Ok(()))),
        Ok(())
    );
    assert_eq!(
        fixture
            .registry
            .answer_question(
                "agt-panicking-sink",
                WORKSPACE,
                root,
                "question-1",
                response()
            )
            .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    fixture
        .sink
        .panic_on_interactions
        .store(false, Ordering::SeqCst);
    assert_eq!(
        fixture
            .registry
            .interactions("agt-panicking-sink", WORKSPACE, root)
            .map(|snapshot| (snapshot.sequence, question_statuses(&snapshot))),
        Ok((4, vec![AgentQuestionStatus::Answered]))
    );
    assert_eq!(fixture.registry.stop("agt-panicking-sink"), Ok(()));
    assert!(wait_until(EVENT_DEADLINE, || {
        fixture.sink.has_terminal_status("agt-panicking-sink")
    }));
}

#[test]
fn dropping_the_registry_releases_the_session_and_the_sink() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-dropped", root, 9709);
    let Fixture { registry, sink, .. } = fixture;
    drop(registry);
    assert!(wait_until(EVENT_DEADLINE, || {
        Arc::strong_count(&sink) == 1 && Arc::strong_count(&task.session) == 1
    }));
    assert_eq!(
        sink.interactions()
            .iter()
            .map(|snapshot| snapshot.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
}

#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    signal: Condvar,
}

impl Gate {
    fn open(&self) {
        *self.open.lock().expect("gate lock") = true;
        self.signal.notify_all();
    }

    fn wait_open(&self) -> bool {
        let open = self.open.lock().expect("gate lock");
        let (open, _) = self
            .signal
            .wait_timeout_while(open, EVENT_DEADLINE, |open| !*open)
            .expect("gate wait");
        *open
    }
}

struct PausedDelivery {
    entered: Arc<Gate>,
    resume: Arc<Gate>,
}

impl PausedDelivery {
    fn new() -> Self {
        Self {
            entered: Arc::new(Gate::default()),
            resume: Arc::new(Gate::default()),
        }
    }

    fn deliver(&self) -> impl Fn() -> Result<(), String> + Send + Sync + 'static {
        let entered = Arc::clone(&self.entered);
        let resume = Arc::clone(&self.resume);
        move || {
            entered.open();
            if resume.wait_open() {
                return Ok(());
            }
            Err("the test never resumed the paused delivery".to_string())
        }
    }
}

const TERMINAL_ENTRIES_THAT_EVICT_ONE_MORE: usize = 128;

fn finish_and_forget(fixture: &Fixture, task: &RunningTask, task_id: &str, root: &Path) {
    let pushed_before = pushed_for(fixture, task_id).len();
    task.process.set_exited(0);
    assert!(
        wait_until(EVENT_DEADLINE, || {
            pushed_for(fixture, task_id).len() > pushed_before
        }),
        "completion never finished the session"
    );
    assert!(wait_until(EVENT_DEADLINE, || {
        fixture.registry.live_worker_thread_count() == 0
    }));
    for index in 0..TERMINAL_ENTRIES_THAT_EVICT_ONE_MORE {
        let finished = FakeProcess::new(Some(0), None);
        fixture.spawner.script(FakeSpawnOutcome::Child(
            FakeChildSpec::new(&finished, 20_000 + index as i32).build(),
        ));
        let filler = format!("{task_id}-filler-{index}");
        let started = dispatch(
            fixture,
            &filler,
            root,
            &root.join(".worktrees").join(&filler),
        );
        assert_eq!(started.map(|result| result.task_id), Ok(filler));
        assert!(wait_until(EVENT_DEADLINE, || {
            fixture.registry.live_worker_thread_count() == 0
        }));
    }
    assert_eq!(
        fixture.registry.interactions(task_id, WORKSPACE, root),
        Ok(AgentInteractionSnapshot::empty(task_id, WORKSPACE))
    );
}

#[test]
fn a_question_answer_settling_after_the_task_is_forgotten_is_still_pushed() {
    let fixture = fixture(Duration::from_secs(60));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-late-answer", root, 9711);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        task.session
            .register(question("question-1"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| {
            fixture.registry.answer_question(
                "agt-late-answer",
                WORKSPACE,
                root,
                "question-1",
                response(),
            )
        });
        assert!(delivery.entered.wait_open());
        finish_and_forget(&fixture, &task, "agt-late-answer", root);
        let last = pushed_for(&fixture, "agt-late-answer").pop();
        assert_eq!(
            last.as_ref().map(question_statuses),
            Some(vec![AgentQuestionStatus::Pending])
        );
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    let pushed = pushed_for(&fixture, "agt-late-answer");
    let last = pushed.last().expect("a snapshot after the answer settled");
    assert_eq!(question_statuses(last), vec![AgentQuestionStatus::Answered]);
    assert!(pushed
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
}

#[test]
fn an_approval_answer_settling_after_the_task_is_forgotten_is_still_pushed() {
    let fixture = fixture(Duration::from_secs(60));
    let root = Path::new("/repo-interactions");
    let task = start_with_session(&fixture, "agt-late-approval", root, 9712);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        task.session
            .approvals()
            .register(approval("approval-1"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| {
            fixture.registry.answer_approval(
                "agt-late-approval",
                WORKSPACE,
                root,
                "approval-1",
                AgentApprovalDecision::AllowOnce,
            )
        });
        assert!(delivery.entered.wait_open());
        finish_and_forget(&fixture, &task, "agt-late-approval", root);
        delivery.resume.open();
        answering.join().expect("answering thread")
    });
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentApprovalStatus::Approved)
    );
    let pushed = pushed_for(&fixture, "agt-late-approval");
    let last = pushed.last().expect("a snapshot after the answer settled");
    assert_eq!(approval_statuses(last), vec![AgentApprovalStatus::Approved]);
}

#[test]
fn a_forgotten_task_never_publishes_over_a_replacement_with_the_same_id() {
    let fixture = fixture(Duration::from_secs(60));
    let root = Path::new("/repo-interactions");
    let original = start_with_session(&fixture, "agt-reused", root, 9713);
    let delivery = PausedDelivery::new();
    let deliver = delivery.deliver();
    assert_eq!(
        original
            .session
            .register(question("question-original"), Arc::new(move |_| deliver())),
        Ok(())
    );
    let answered = thread::scope(|scope| {
        let answering = scope.spawn(|| {
            fixture.registry.answer_question(
                "agt-reused",
                WORKSPACE,
                root,
                "question-original",
                response(),
            )
        });
        assert!(delivery.entered.wait_open());
        finish_and_forget(&fixture, &original, "agt-reused", root);
        let before_replacement = pushed_for(&fixture, "agt-reused").len();
        let replacement = start_with_session(&fixture, "agt-reused", root, 9714);
        assert_eq!(
            replacement
                .session
                .register(question("question-replacement"), Arc::new(|_| Ok(()))),
            Ok(())
        );
        delivery.resume.open();
        let answered = answering.join().expect("answering thread");
        original.session.close();
        let published: Vec<(u64, Vec<String>)> = pushed_for(&fixture, "agt-reused")
            .split_off(before_replacement)
            .into_iter()
            .map(|snapshot| {
                let ids = snapshot.questions.into_iter().map(|request| request.id);
                (snapshot.sequence, ids.collect())
            })
            .collect();
        assert_eq!(
            published,
            vec![
                (4, Vec::new()),
                (5, vec!["question-replacement".to_string()])
            ]
        );
        assert_eq!(
            fixture
                .registry
                .interactions("agt-reused", WORKSPACE, root)
                .map(|snapshot| (snapshot.sequence, snapshot.questions.len())),
            Ok((6, 1))
        );
        assert_eq!(fixture.registry.stop("agt-reused"), Ok(()));
        answered
    });
    assert_eq!(
        answered.map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
}
