use super::super::super::agent_history_commands::agent_history_store::runtime_requests::HistoryRuntimeRequestStore;
use super::*;
use crate::agent_questions::approvals::{
    AgentApprovalFact, AgentApprovalKind, AgentApprovalStatus,
};
use crate::agent_questions::{
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionSession, AgentQuestionStatus,
};
use crate::agent_runtime_requests::journal::{
    new_run_id, system_clock, JournalLimits, TurnTracking,
};
use crate::agent_runtime_requests::scopes::HistoryScope;
use crate::agent_task_spawner::{AgentChild, AgentProcessSpawner, AgentTaskProcessOwnership};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

static NEXT_WORKSPACE: AtomicU64 = AtomicU64::new(0);

const TASK: &str = "agt-turn-interactions";
const THREAD: &str = "thread-interactions";

#[path = "tests/agent_question_commands_journal_tests.rs"]
mod journal_tests;

fn request_store(base: &Path) -> Arc<HistoryRuntimeRequestStore> {
    Arc::new(HistoryRuntimeRequestStore::new(base.to_path_buf()))
}

fn scoped_admission(
    admission: crate::agent_task_admission::AgentTaskAdmission,
    history: Option<TurnTracking>,
) -> crate::agent_task_admission::AgentTaskAdmission {
    let Some(tracking) = history else {
        return admission;
    };
    let task_scope = tracking.task_scope();
    admission
        .with_runtime_lease(tracking)
        .with_history_scope(task_scope)
}

fn detached_journal() -> RuntimeRequestJournal {
    RuntimeRequestJournal::start(
        request_store(Path::new("/nonexistent/codevo-detached-request-journal")),
        new_run_id(),
        system_clock(),
    )
}

struct WaitingTurn {
    session: Arc<AgentQuestionSession>,
    stopped: Arc<AtomicBool>,
}

impl AgentChild for WaitingTurn {
    fn take_questions(&mut self) -> Option<Arc<AgentQuestionSession>> {
        Some(Arc::clone(&self.session))
    }

    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(std::io::empty()))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(std::io::empty()))
    }

    fn observe_exit(&mut self) -> Result<bool, String> {
        Ok(self.stopped.load(Ordering::SeqCst))
    }

    fn reap(&mut self) -> Result<i32, String> {
        Ok(0)
    }

    fn process_group_id(&self) -> i32 {
        0
    }

    fn ownership(&self) -> AgentTaskProcessOwnership {
        AgentTaskProcessOwnership::SharedSession
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Default)]
struct WaitingTurnSpawner {
    sessions: Mutex<std::collections::VecDeque<Arc<AgentQuestionSession>>>,
    exits: Mutex<Vec<Arc<AtomicBool>>>,
}

impl WaitingTurnSpawner {
    fn with_session(session: &Arc<AgentQuestionSession>) -> Self {
        let spawner = Self::default();
        spawner.spawn_next_with(session);
        spawner
    }

    fn finish_spawned_turns(&self) {
        for exit in self.exits.lock().expect("spawned turns").iter() {
            exit.store(true, Ordering::SeqCst);
        }
    }

    fn spawn_next_with(&self, session: &Arc<AgentQuestionSession>) {
        self.sessions
            .lock()
            .expect("upcoming sessions")
            .push_back(Arc::clone(session));
    }
}

impl AgentProcessSpawner for WaitingTurnSpawner {
    fn spawn(&self, _plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .pop_front()
            .ok_or("no session is waiting for this turn")?;
        let stopped = Arc::new(AtomicBool::new(false));
        self.exits
            .lock()
            .map_err(|error| error.to_string())?
            .push(Arc::clone(&stopped));
        Ok(Box::new(WaitingTurn { session, stopped }))
    }
}

struct SilentSink;

impl AgentTaskEventSink for SilentSink {
    fn status(&self, _event: AgentTaskStatusEvent) {}

    fn output(&self, _event: AgentTaskOutputEvent) {}
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn create(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-question-commands-{label}-{}-{}",
            std::process::id(),
            NEXT_WORKSPACE.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).expect("workspace root");
        Self {
            root: std::fs::canonicalize(root).expect("canonical workspace root"),
        }
    }

    fn nested(&self, name: &str) -> PathBuf {
        let nested = self.root.join(name);
        std::fs::create_dir_all(&nested).expect("nested repository");
        nested
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct RunningTurn {
    tasks: AgentTaskRegistry,
    spawner: Arc<WaitingTurnSpawner>,
    session: Arc<AgentQuestionSession>,
}

fn start_task(
    tasks: &AgentTaskRegistry,
    (task_id, thread_id): (&str, &str),
    descriptor: &ManagedWorkspaceDescriptor,
    repository_root: &Path,
    history: Option<TurnTracking>,
) {
    let admission = tasks
        .admission()
        .reserve(
            &descriptor.workspace_id,
            repository_root,
            repository_root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let started = tasks.start(
        AgentTaskRegistryStartRequest {
            task_id: task_id.to_string(),
            thread_id: thread_id.to_string(),
            workspace_id: descriptor.workspace_id.as_str().to_string(),
            trust_root: descriptor.canonical_root_path.clone(),
            repository_root: repository_root.to_path_buf(),
            isolation: AgentTaskIsolation::InPlace,
            worktree_path: None,
        },
        AgentTaskSpawnPlan::for_tests(
            PathBuf::from("/bin/codevo-waiting-turn"),
            Vec::new(),
            repository_root.to_path_buf(),
            Vec::new(),
        ),
        scoped_admission(admission, history),
    );
    assert_eq!(
        started.map(|result| result.task_id),
        Ok(task_id.to_string())
    );
    assert_eq!(tasks.acknowledge(task_id), Ok(()));
}

fn ask_both(session: &AgentQuestionSession) {
    let question = AgentQuestionRequest {
        id: "question-1".into(),
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
    };
    let approval = AgentApprovalRequest {
        id: "approval-1".into(),
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
    };
    assert_eq!(session.register(question, Arc::new(|_| Ok(()))), Ok(()));
    assert_eq!(
        session.approvals().register(approval, Arc::new(|_| Ok(()))),
        Ok(())
    );
}

impl RunningTurn {
    fn start(descriptor: &ManagedWorkspaceDescriptor, repository_root: &Path) -> Self {
        Self::start_observed(descriptor, repository_root, Arc::new(SilentSink), None)
    }

    fn start_observed(
        descriptor: &ManagedWorkspaceDescriptor,
        repository_root: &Path,
        sink: Arc<dyn AgentTaskEventSink>,
        history: Option<TurnTracking>,
    ) -> Self {
        Self::start_in_thread(THREAD, descriptor, repository_root, sink, history)
    }

    fn start_in_thread(
        thread_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        repository_root: &Path,
        sink: Arc<dyn AgentTaskEventSink>,
        history: Option<TurnTracking>,
    ) -> Self {
        let session = Arc::new(AgentQuestionSession::new());
        let spawner = Arc::new(WaitingTurnSpawner::with_session(&session));
        let tasks = AgentTaskRegistry::new(
            Arc::new(AgentTaskAdmissionRegistry::new()),
            Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
            sink,
        )
        .with_clean_exit_grace_for_tests(Duration::ZERO);
        start_task(
            &tasks,
            (TASK, thread_id),
            descriptor,
            repository_root,
            history,
        );
        Self {
            tasks,
            spawner,
            session,
        }
    }

    fn ask(&self) {
        ask_both(&self.session);
    }
}

fn idle_tasks() -> AgentTaskRegistry {
    AgentTaskRegistry::new(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        Arc::new(WaitingTurnSpawner::default()),
        Arc::new(SilentSink),
    )
}

fn question_answer(descriptor: &ManagedWorkspaceDescriptor) -> QuestionAnswerRequest {
    QuestionAnswerRequest {
        task_id: TASK.to_string(),
        workspace_id: descriptor.workspace_id.clone(),
        request_id: "question-1".to_string(),
        response: AgentQuestionResponse {
            answers: vec![AgentQuestionAnswerItem {
                question_id: "q".into(),
                option_ids: Vec::new(),
                text: "answer".into(),
            }],
        },
    }
}

fn approval_answer(descriptor: &ManagedWorkspaceDescriptor) -> ApprovalAnswerRequest {
    ApprovalAnswerRequest {
        task_id: TASK.to_string(),
        workspace_id: descriptor.workspace_id.clone(),
        request_id: "approval-1".to_string(),
        decision: AgentApprovalDecision::AllowOnce,
    }
}

fn assert_every_command_is_rejected(
    workspaces: &WorkspaceRegistry,
    tasks: &AgentTaskRegistry,
    descriptor: &ManagedWorkspaceDescriptor,
) {
    assert!(answer_owned_question(
        workspaces,
        tasks,
        &detached_journal(),
        question_answer(descriptor)
    )
    .is_err());
    assert!(answer_owned_approval(
        workspaces,
        tasks,
        &detached_journal(),
        approval_answer(descriptor)
    )
    .is_err());
}

fn assert_requests_stay_pending(turn: &RunningTurn) {
    assert_eq!(
        turn.session.list(TASK)[0].status,
        AgentQuestionStatus::Pending
    );
    assert_eq!(
        turn.session.approvals().list(TASK)[0].status,
        AgentApprovalStatus::Pending
    );
}

#[test]
fn a_task_that_has_not_started_cannot_be_answered() {
    let workspace = Workspace::create("not-started");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let tasks = idle_tasks();
    assert!(answer_owned_question(
        &workspaces,
        &tasks,
        &detached_journal(),
        question_answer(&descriptor)
    )
    .is_err());
    assert!(answer_owned_approval(
        &workspaces,
        &tasks,
        &detached_journal(),
        approval_answer(&descriptor)
    )
    .is_err());
}

#[test]
fn a_task_in_a_nested_repository_is_answered_through_its_workspace() {
    let workspace = Workspace::create("nested");
    let repository = workspace.nested("pa-mcp-be");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&descriptor, &repository);
    turn.ask();
    assert_requests_stay_pending(&turn);

    assert_eq!(
        answer_owned_question(
            &workspaces,
            &turn.tasks,
            &detached_journal(),
            question_answer(&descriptor)
        )
        .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        answer_owned_approval(
            &workspaces,
            &turn.tasks,
            &detached_journal(),
            approval_answer(&descriptor)
        )
        .map(|request| request.status),
        Ok(AgentApprovalStatus::Approved)
    );
    assert_eq!(
        turn.session.list(TASK)[0].status,
        AgentQuestionStatus::Answered
    );
    assert_eq!(
        turn.session.approvals().list(TASK)[0].status,
        AgentApprovalStatus::Approved
    );
}

#[test]
fn a_task_at_the_workspace_root_is_answered() {
    let workspace = Workspace::create("root");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&descriptor, &workspace.root);
    turn.ask();
    assert_eq!(
        answer_owned_question(
            &workspaces,
            &turn.tasks,
            &detached_journal(),
            question_answer(&descriptor)
        )
        .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
}

#[test]
fn an_unregistered_workspace_cannot_answer_requests() {
    let workspace = Workspace::create("unregistered");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&descriptor, &workspace.root);
    turn.ask();
    workspaces
        .unregister(&descriptor.workspace_id)
        .expect("unregister");
    assert_every_command_is_rejected(&workspaces, &turn.tasks, &descriptor);
    assert_every_command_is_rejected(&workspaces, &idle_tasks(), &descriptor);
    assert_requests_stay_pending(&turn);
}

#[test]
fn a_replaced_workspace_generation_cannot_answer_requests() {
    let workspace = Workspace::create("replaced");
    let workspaces = WorkspaceRegistry::new();
    let original = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&original, &workspace.root);
    turn.ask();
    workspaces
        .unregister(&original.workspace_id)
        .expect("unregister");
    let replacement = workspaces.register(&workspace.root).expect("reregister");
    assert_ne!(original.workspace_id, replacement.workspace_id);
    assert_every_command_is_rejected(&workspaces, &turn.tasks, &original);
    assert_every_command_is_rejected(&workspaces, &turn.tasks, &replacement);
    assert_every_command_is_rejected(&workspaces, &idle_tasks(), &original);
    assert_requests_stay_pending(&turn);
}

#[test]
fn a_task_cannot_be_answered_through_another_workspace() {
    let owning = Workspace::create("owning");
    let foreign = Workspace::create("foreign");
    let workspaces = WorkspaceRegistry::new();
    let owner_descriptor = workspaces.register(&owning.root).expect("register owner");
    let foreign_descriptor = workspaces
        .register(&foreign.root)
        .expect("register foreign");
    let turn = RunningTurn::start(&owner_descriptor, &owning.root);
    turn.ask();
    assert_every_command_is_rejected(&workspaces, &turn.tasks, &foreign_descriptor);
    assert_requests_stay_pending(&turn);
    assert_eq!(
        answer_owned_question(
            &workspaces,
            &turn.tasks,
            &detached_journal(),
            question_answer(&owner_descriptor)
        )
        .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
}

#[test]
fn a_task_whose_repository_is_outside_the_workspace_root_is_rejected() {
    let workspace = Workspace::create("contained");
    let outside = Workspace::create("outside");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&descriptor, &outside.root);
    turn.ask();
    assert_every_command_is_rejected(&workspaces, &turn.tasks, &descriptor);
    assert_requests_stay_pending(&turn);
}

#[test]
fn requests_identify_the_task_by_workspace_and_task_id_only() {
    assert!(
        serde_json::from_value::<QuestionAnswerRequest>(serde_json::json!({
            "workspaceId": "workspace",
            "taskId": TASK,
            "requestId": "question-1",
            "response": {"answers": []}
        }))
        .is_ok()
    );
    assert!(
        serde_json::from_value::<QuestionAnswerRequest>(serde_json::json!({
            "workspaceId": "workspace",
            "taskId": TASK,
            "repositoryRoot": "/repo",
            "requestId": "question-1",
            "response": {"answers": []}
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ApprovalAnswerRequest>(serde_json::json!({
            "workspaceId": "workspace",
            "taskId": TASK,
            "requestId": "approval-1",
            "decision": "allowOnce"
        }))
        .is_ok()
    );
    assert!(
        serde_json::from_value::<ApprovalAnswerRequest>(serde_json::json!({
            "workspaceId": "workspace",
            "taskId": TASK,
            "repositoryRoot": "/repo",
            "requestId": "approval-1",
            "decision": "allowOnce"
        }))
        .is_err()
    );
}

#[test]
fn oversized_request_ids_are_rejected_before_reaching_the_task() {
    let workspace = Workspace::create("bounds");
    let workspaces = WorkspaceRegistry::new();
    let descriptor = workspaces.register(&workspace.root).expect("register");
    let turn = RunningTurn::start(&descriptor, &workspace.root);
    turn.ask();
    let oversized = "r".repeat(MAX_AGENT_INTERACTION_REQUEST_ID_BYTES + 1);
    let question = QuestionAnswerRequest {
        request_id: oversized.clone(),
        ..question_answer(&descriptor)
    };
    let approval = ApprovalAnswerRequest {
        request_id: oversized,
        ..approval_answer(&descriptor)
    };
    assert_eq!(
        answer_owned_question(&workspaces, &turn.tasks, &detached_journal(), question)
            .map(|request| request.status),
        Err("Invalid agent interaction request.".to_string())
    );
    assert_eq!(
        answer_owned_approval(&workspaces, &turn.tasks, &detached_journal(), approval)
            .map(|request| request.status),
        Err("Invalid agent interaction request.".to_string())
    );
    assert_requests_stay_pending(&turn);
}
