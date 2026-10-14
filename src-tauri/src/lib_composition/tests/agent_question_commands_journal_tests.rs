use super::*;
use crate::agent_questions::QUESTION_EXPIRED_WHILE_SENDING_ERROR;
use crate::agent_runtime_requests::model::JournalState;
use crate::agent_runtime_requests::store::IntentSettlement;
use crate::agent_task_admission::AgentTaskHistoryScope;
use crate::agent_task_supervisor::AgentTaskMetadata;
use agent_answer_journal::failed_answer_settlement;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;

const FLUSH: Duration = Duration::from_secs(10);
const TERMINAL_TASKS_KEPT_BY_THE_REGISTRY: usize = 128;

struct JournalingSink {
    journal: Arc<RuntimeRequestJournal>,
}

impl AgentTaskEventSink for JournalingSink {
    fn status(&self, _event: AgentTaskStatusEvent) {}

    fn output(&self, _event: AgentTaskOutputEvent) {}

    fn interactions(&self, task: &AgentTaskMetadata, snapshot: AgentInteractionSnapshot) {
        self.journal
            .observe(task.history_scope.as_ref(), &task.thread_id, snapshot);
    }
}

struct JournaledTurn {
    workspace: Workspace,
    history: Workspace,
    workspaces: WorkspaceRegistry,
    descriptor: ManagedWorkspaceDescriptor,
    journal: Arc<RuntimeRequestJournal>,
    turn: RunningTurn,
    scope: HistoryScope,
    task_scope: AgentTaskHistoryScope,
}

impl JournaledTurn {
    fn start(label: &str) -> Self {
        let workspace = Workspace::create(label);
        let history = Workspace::create(&format!("{label}-history"));
        let workspaces = WorkspaceRegistry::new();
        let descriptor = workspaces.register(&workspace.root).expect("register");
        let journal = Arc::new(RuntimeRequestJournal::start_with_limits(
            request_store(&history.root),
            "boot-0001".to_string(),
            system_clock(),
            JournalLimits {
                retry_backoff: Duration::from_millis(15),
                answer_budget: FLUSH,
                ..JournalLimits::default()
            },
        ));
        let scope = scope_for(&workspace.root);
        let tracking = journal
            .track_turn(&scope, THREAD, TASK)
            .expect("track the turn");
        let task_scope = tracking.task_scope();
        let turn = RunningTurn::start_observed(
            &descriptor,
            &workspace.root,
            Arc::new(JournalingSink {
                journal: Arc::clone(&journal),
            }),
            Some(tracking),
        );
        Self {
            workspace,
            history,
            workspaces,
            descriptor,
            journal,
            turn,
            scope,
            task_scope,
        }
    }

    fn ask_question(&self, responder: impl Fn() -> Result<(), String> + Send + Sync + 'static) {
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
        assert_eq!(
            self.turn
                .session
                .register(question, Arc::new(move |_| responder())),
            Ok(())
        );
    }

    fn answer_question(&self) -> Result<AgentQuestionStatus, String> {
        answer_owned_question(
            &self.workspaces,
            &self.turn.tasks,
            &self.journal,
            question_answer(&self.descriptor),
        )
        .map(|request| request.status)
    }

    fn stored(&self) -> Vec<Value> {
        self.journal
            .read(&self.scope, THREAD, 256)
            .expect("read journaled requests")
            .requests
            .iter()
            .map(|request| serde_json::to_value(request).expect("encode request"))
            .collect()
    }

    fn settled(&self) -> Vec<Value> {
        assert!(self.journal.flush(FLUSH), "journal did not settle");
        self.stored()
    }

    fn captured(&self) -> AnsweringTask {
        self.turn
            .tasks
            .question_task(
                TASK,
                self.descriptor.workspace_id.as_str(),
                &self.workspace.root,
            )
            .expect("capture the answering task")
    }
}

fn scope_for(root: &Path) -> HistoryScope {
    let root_key = root.to_string_lossy().into_owned();
    HistoryScope {
        owner_id:
            super::super::super::super::agent_attachment_commands::agent_thread_store::agent_root_owner_id(
                &root_key,
            ),
        root_key,
    }
}

fn summary(request: &Value) -> String {
    format!(
        "{}:{}:{}",
        request["id"].as_str().unwrap_or("?"),
        request["status"].as_str().unwrap_or("?"),
        request["responseCapability"]["reason"]
            .as_str()
            .unwrap_or("-")
    )
}

#[test]
fn answer_is_durable_as_submitting_while_it_is_delivered_and_resolved_after() {
    let journaled = JournaledTurn::start("journal-intent");
    let during_delivery: Arc<Mutex<Vec<Value>>> = Arc::default();
    let observed = Arc::clone(&during_delivery);
    let reader = Arc::clone(&journaled.journal);
    let scope = journaled.scope.clone();
    journaled.ask_question(move || {
        let stored = reader
            .read(&scope, THREAD, 256)
            .map_err(|error| error.to_string())?;
        let mut observed = observed.lock().map_err(|error| error.to_string())?;
        observed.extend(
            stored
                .requests
                .iter()
                .filter_map(|request| serde_json::to_value(request).ok()),
        );
        Ok(())
    });
    let registered = journaled.settled();
    assert_eq!(summary(&registered[0]), "question-1:pending:-");
    assert_eq!(registered[0]["turnId"], json!(TASK));
    assert_eq!(registered[0]["provider"], json!("claudeCode"));

    assert_eq!(
        journaled.answer_question(),
        Ok(AgentQuestionStatus::Answered)
    );

    let during_delivery = during_delivery.lock().expect("observed requests");
    assert_eq!(during_delivery.len(), 1);
    assert_eq!(
        summary(&during_delivery[0]),
        "question-1:submitting:unknown"
    );
    assert_eq!(
        during_delivery[0]["resolution"],
        json!({"kind": "answers", "answers": [
            {"questionId": "q", "optionIds": [], "text": "answer"}
        ]})
    );
    let resolved = journaled.settled();
    assert_eq!(summary(&resolved[0]), "question-1:resolved:unknown");
    assert_eq!(resolved[0]["resolution"], during_delivery[0]["resolution"]);
    assert!(resolved[0]["version"].as_u64() > during_delivery[0]["version"].as_u64());
    assert!(during_delivery[0]["version"].as_u64() > registered[0]["version"].as_u64());
    assert_eq!(journaled.journal.health().state, JournalState::Saved);
    assert_eq!(
        journaled.answer_question(),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(journaled.settled(), resolved);
}

#[test]
fn approval_decision_is_journaled_with_the_decision_the_user_sent() {
    let journaled = JournaledTurn::start("journal-approval");
    journaled.turn.ask();
    assert_eq!(journaled.settled().len(), 2);

    let decided = answer_owned_approval(
        &journaled.workspaces,
        &journaled.turn.tasks,
        &journaled.journal,
        approval_answer(&journaled.descriptor),
    );

    assert_eq!(
        decided.map(|request| request.status),
        Ok(AgentApprovalStatus::Approved)
    );
    let stored = journaled.settled();
    assert_eq!(summary(&stored[0]), "question-1:pending:-");
    assert_eq!(summary(&stored[1]), "approval-1:resolved:unknown");
    assert_eq!(
        stored[1]["resolution"],
        json!({"kind": "decision", "decision": "allowOnce"})
    );
}

#[test]
fn responder_failure_is_recorded_as_delivery_failed_without_the_answer() {
    let journaled = JournaledTurn::start("journal-delivery-failed");
    journaled.ask_question(|| Err("provider pipe closed".to_string()));
    journaled.settled();

    assert_eq!(
        journaled.answer_question(),
        Err("provider pipe closed".to_string())
    );

    let failed = journaled.settled();
    assert_eq!(summary(&failed[0]), "question-1:expired:deliveryFailed");
    assert_eq!(failed[0]["resolution"], Value::Null);
    assert!(failed[0]["resolvedAtEpochMs"].is_u64());
    assert_eq!(journaled.journal.health().state, JournalState::Saved);
    assert_eq!(
        journaled.turn.session.list(TASK)[0].status,
        AgentQuestionStatus::Expired
    );
}

#[test]
fn turn_closed_while_the_answer_is_in_flight_keeps_the_unconfirmed_answer() {
    let journaled = JournaledTurn::start("journal-unconfirmed");
    let closing = Arc::downgrade(&journaled.turn.session);
    journaled.ask_question(move || {
        let session = closing.upgrade().ok_or("session is gone")?;
        session.close();
        Ok(())
    });
    journaled.settled();

    assert_eq!(
        journaled.answer_question(),
        Err(QUESTION_EXPIRED_WHILE_SENDING_ERROR.to_string())
    );

    let unconfirmed = journaled.settled();
    assert_eq!(
        summary(&unconfirmed[0]),
        "question-1:expired:answerUnconfirmed"
    );
    assert_eq!(
        unconfirmed[0]["resolution"]["answers"][0]["text"],
        json!("answer")
    );
}

#[test]
fn failed_answer_is_classified_by_what_the_session_still_holds() {
    let journaled = JournaledTurn::start("journal-classify");
    journaled.ask_question(|| Ok(()));
    let captured = journaled.captured();
    assert!(Arc::ptr_eq(captured.session(), &journaled.turn.session));
    let failure =
        |request_id: &str, error: &str| failed_answer_settlement(&captured, request_id, error);

    assert_eq!(
        failure("question-1", "Agent task is no longer waiting."),
        IntentSettlement::Reverted
    );
    assert_eq!(
        failure("question-1", QUESTION_EXPIRED_WHILE_SENDING_ERROR),
        IntentSettlement::Reverted
    );
    journaled.turn.session.expire("question-1");
    assert_eq!(
        failure("question-1", QUESTION_EXPIRED_WHILE_SENDING_ERROR),
        IntentSettlement::Unconfirmed
    );
    assert_eq!(
        failure("question-1", "provider pipe closed"),
        IntentSettlement::DeliveryFailed
    );
    assert_eq!(
        failure("question-9", "Unknown question."),
        IntentSettlement::DeliveryFailed
    );
}

#[test]
fn answer_the_session_refuses_never_reaches_the_journal() {
    let journaled = JournaledTurn::start("journal-refused");
    journaled.ask_question(|| Ok(()));
    let registered = journaled.settled();
    let mut invalid = question_answer(&journaled.descriptor);
    invalid.response.answers[0].question_id = "other".into();

    let refused = answer_owned_question(
        &journaled.workspaces,
        &journaled.turn.tasks,
        &journaled.journal,
        invalid,
    );

    assert!(refused.is_err());
    assert_eq!(journaled.settled(), registered);
    assert_eq!(
        journaled.answer_question(),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        summary(&journaled.settled()[0]),
        "question-1:resolved:unknown"
    );
}

#[test]
fn unwritable_journal_never_keeps_the_agent_from_its_answer() {
    use std::os::unix::fs::PermissionsExt;
    let journaled = JournaledTurn::start("journal-read-only");
    let delivered = Arc::new(AtomicU64::new(0));
    let counter = Arc::clone(&delivered);
    journaled.ask_question(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    journaled.settled();
    let database = journaled.history.root.join("agent-history").join("v2");
    let owner_directory = std::fs::read_dir(&database)
        .expect("history directory")
        .next()
        .expect("history owner directory")
        .expect("history owner entry")
        .path();
    let permissions = |path: &Path, mode: u32| {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).expect("permissions")
    };
    permissions(&owner_directory.join("history.sqlite3"), 0o400);
    for sidecar in ["history.sqlite3-wal", "history.sqlite3-shm"] {
        let _ = std::fs::remove_file(owner_directory.join(sidecar));
    }
    permissions(&owner_directory, 0o500);

    let answered = journaled.answer_question();
    assert!(journaled.journal.flush(FLUSH));
    let health = journaled.journal.health();
    let thread_state = journaled.journal.thread_state(THREAD);
    permissions(&owner_directory, 0o700);
    permissions(&owner_directory.join("history.sqlite3"), 0o600);

    assert_eq!(answered, Ok(AgentQuestionStatus::Answered));
    assert_eq!(delivered.load(Ordering::SeqCst), 1);
    assert_eq!(health.state, JournalState::Degraded);
    assert_eq!(thread_state, JournalState::Degraded);
    assert_eq!(health.unsaved_answers, 1);
    assert!(health.failed_writes >= 1, "{health:?}");
}

#[test]
fn rejected_start_reusing_a_running_task_never_redirects_its_journal_to_another_root() {
    use crate::agent_task_supervisor::DUPLICATE_AGENT_TASK_ERROR;
    let journaled = JournaledTurn::start("journal-redirect");
    let other_project = Workspace::create("journal-redirect-other-project");
    let other_scope = scope_for(&other_project.root);
    let other_repository = journaled.workspace.nested("other-repository");

    for scope in [&journaled.scope, &other_scope] {
        assert!(journaled.journal.track_turn(scope, THREAD, TASK).is_err());
    }
    let tracking = journaled
        .journal
        .track_turn(&other_scope, "thread-redirect", TASK)
        .expect("another thread is another turn until the registry refuses the task id");
    let refused_turn = tracking.authority().clone();
    let admission = journaled
        .turn
        .tasks
        .admission()
        .reserve(
            &journaled.descriptor.workspace_id,
            &other_repository,
            &other_repository,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let rejected = journaled.turn.tasks.start(
        AgentTaskRegistryStartRequest {
            task_id: TASK.to_string(),
            thread_id: "thread-redirect".to_string(),
            workspace_id: journaled.descriptor.workspace_id.as_str().to_string(),
            trust_root: journaled.descriptor.canonical_root_path.clone(),
            repository_root: other_repository.clone(),
            isolation: AgentTaskIsolation::InPlace,
            worktree_path: None,
        },
        AgentTaskSpawnPlan::for_tests(
            PathBuf::from("/bin/codevo-waiting-turn"),
            Vec::new(),
            other_repository.clone(),
            Vec::new(),
        ),
        scoped_admission(admission, Some(tracking)),
    );
    assert_eq!(
        rejected.map(|result| result.task_id),
        Err(DUPLICATE_AGENT_TASK_ERROR.to_string())
    );
    journaled.journal.forget_refused_start(&refused_turn);
    let running = journaled
        .turn
        .tasks
        .metadata_for_workspace(TASK, journaled.descriptor.workspace_id.as_str())
        .expect("running task metadata");
    assert_eq!(running.history_scope, Some(journaled.task_scope.clone()));
    assert_eq!(running.thread_id, THREAD);

    journaled.ask_question(|| Ok(()));
    assert_eq!(summary(&journaled.settled()[0]), "question-1:pending:-");
    assert_eq!(
        journaled.answer_question(),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        summary(&journaled.settled()[0]),
        "question-1:resolved:unknown"
    );
    for thread_id in [THREAD, "thread-redirect"] {
        let redirected = journaled
            .journal
            .read(&other_scope, thread_id, 256)
            .expect("read the other root");
        assert!(redirected.requests.is_empty(), "{thread_id}");
    }
    assert!(journaled
        .journal
        .track_turn(&other_scope, "thread-redirect", TASK)
        .is_ok());
    assert_eq!(journaled.journal.health().state, JournalState::Saved);
}

fn stored_in(journaled: &JournaledTurn, thread_id: &str) -> Vec<String> {
    assert!(journaled.journal.flush(FLUSH), "journal did not settle");
    journaled
        .journal
        .read(&journaled.scope, thread_id, 256)
        .expect("read journaled requests")
        .requests
        .iter()
        .map(|request| summary(&serde_json::to_value(request).expect("encode request")))
        .collect()
}

fn eventually(check: impl Fn() -> bool) -> bool {
    let deadline = std::time::Instant::now() + FLUSH;
    while std::time::Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    check()
}

#[test]
fn answer_captured_for_one_task_is_never_delivered_to_a_task_that_reused_its_id() {
    let journaled = JournaledTurn::start("journal-reused-task");
    let tasks = &journaled.turn.tasks;
    let workspace_id = journaled.descriptor.workspace_id.as_str();
    journaled.turn.ask();
    let captured_question = journaled.captured();
    let captured_approval = tasks
        .approval_task(TASK, workspace_id, &journaled.workspace.root)
        .expect("capture the approving task");
    assert!(Arc::ptr_eq(
        captured_approval.session(),
        &journaled.turn.session
    ));
    let pending = ["question-1:pending:-", "approval-1:pending:-"];
    assert_eq!(stored_in(&journaled, THREAD), pending);

    journaled.turn.spawner.finish_spawned_turns();
    let finished = |task_id: &str| {
        eventually(|| {
            tasks
                .question_task(task_id, workspace_id, &journaled.workspace.root)
                .is_err()
        })
    };
    assert!(finished(TASK));
    for index in 0..TERMINAL_TASKS_KEPT_BY_THE_REGISTRY {
        let task_id = format!("agt-turn-filler-{index:03}");
        journaled
            .turn
            .spawner
            .spawn_next_with(&Arc::new(AgentQuestionSession::new()));
        start_task(
            tasks,
            (&task_id, "thread-filler"),
            &journaled.descriptor,
            &journaled.workspace.root,
            None,
        );
        journaled.turn.spawner.finish_spawned_turns();
        assert!(finished(&task_id), "{task_id}");
    }
    assert!(
        tasks.metadata_for_workspace(TASK, workspace_id).is_none(),
        "the finished task never left the registry"
    );
    let reused = Arc::new(AgentQuestionSession::new());
    journaled.turn.spawner.spawn_next_with(&reused);
    let tracking = journaled
        .journal
        .track_turn(&journaled.scope, "thread-reused", TASK)
        .expect("track the task that reuses the id");
    start_task(
        tasks,
        (TASK, "thread-reused"),
        &journaled.descriptor,
        &journaled.workspace.root,
        Some(tracking),
    );
    ask_both(&reused);
    assert_eq!(stored_in(&journaled, "thread-reused"), pending);
    let current = tasks
        .question_task(TASK, workspace_id, &journaled.workspace.root)
        .expect("the task that reused the id");
    assert!(Arc::ptr_eq(current.session(), &reused));
    assert_eq!(current.metadata.thread_id, "thread-reused");
    assert_eq!(captured_question.metadata.thread_id, THREAD);

    let question = deliver_question_answer(
        tasks,
        &journaled.journal,
        &captured_question,
        question_answer(&journaled.descriptor),
    );
    let approval = deliver_approval_answer(
        tasks,
        &journaled.journal,
        &captured_approval,
        approval_answer(&journaled.descriptor),
    );

    assert!(question.is_err());
    assert!(approval.is_err());
    assert_eq!(reused.list(TASK)[0].status, AgentQuestionStatus::Pending);
    assert_eq!(
        reused.approvals().list(TASK)[0].status,
        AgentApprovalStatus::Pending
    );
    assert_eq!(stored_in(&journaled, "thread-reused"), pending);
    assert_eq!(
        stored_in(&journaled, THREAD),
        [
            "question-1:expired:turnEnded",
            "approval-1:expired:turnEnded"
        ]
    );
    assert_eq!(journaled.journal.health().unsaved_answers, 0);

    assert_eq!(
        deliver_question_answer(
            tasks,
            &journaled.journal,
            &current,
            question_answer(&journaled.descriptor),
        )
        .map(|request| request.status),
        Ok(AgentQuestionStatus::Answered)
    );
    assert_eq!(
        stored_in(&journaled, "thread-reused"),
        ["question-1:resolved:unknown", "approval-1:pending:-"]
    );
}
