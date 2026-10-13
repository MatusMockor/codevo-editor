use super::super::questions::AGENT_INTERACTIONS_CHANGED_ERROR;
use super::super::{
    AgentInteractionSnapshot, AgentTaskEntry, AgentTaskEventSink, AgentTaskIsolation,
    AgentTaskOutcomeAuthority, AgentTaskOutputEvent, AgentTaskPhase, AgentTaskRegistry,
    AgentTaskStatusEvent, WatchdogGate,
};
use super::*;
use crate::agent_questions::{AgentQuestion, AgentQuestionRequest, AgentQuestionStatus};
use crate::agent_task_admission::AgentTaskAdmissionRegistry;
use crate::agent_task_spawner::{AgentChild, AgentProcessSpawner, AgentTaskSpawnPlan};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const TASK: &str = "agt-settling";
const WORKSPACE: &str = "workspace";
const ROOT: &str = "/repo";

struct RefusingSpawner;

impl AgentProcessSpawner for RefusingSpawner {
    fn spawn(&self, _plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        Err("interaction tests never spawn a child".to_string())
    }
}

#[derive(Default)]
struct RecordingSink {
    interactions: Mutex<Vec<AgentInteractionSnapshot>>,
}

impl RecordingSink {
    fn question_statuses(&self) -> Vec<Vec<AgentQuestionStatus>> {
        self.interactions
            .lock()
            .expect("interactions lock")
            .iter()
            .map(|snapshot| {
                snapshot
                    .questions
                    .iter()
                    .map(|request| request.status.clone())
                    .collect()
            })
            .collect()
    }
}

impl AgentTaskEventSink for RecordingSink {
    fn status(&self, _event: AgentTaskStatusEvent) {}

    fn output(&self, _event: AgentTaskOutputEvent) {}

    fn interactions(&self, snapshot: AgentInteractionSnapshot) {
        self.interactions
            .lock()
            .expect("interactions lock")
            .push(snapshot);
    }
}

fn metadata() -> AgentTaskMetadata {
    AgentTaskMetadata {
        task_id: TASK.into(),
        thread_id: "thread".into(),
        workspace_id: WORKSPACE.into(),
        trust_root: PathBuf::from(ROOT),
        repository_root: PathBuf::from(ROOT),
        cwd: PathBuf::from(ROOT),
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
    }
}

fn asking_session(question_id: &str) -> Arc<AgentQuestionSession> {
    let session = Arc::new(AgentQuestionSession::new());
    let registered = session.register(
        AgentQuestionRequest {
            id: question_id.into(),
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
        },
        Arc::new(|_| Ok(())),
    );
    assert_eq!(registered, Ok(()));
    session
}

fn terminal_entry(
    session: &Arc<AgentQuestionSession>,
    interactions: Option<AgentInteractionSubscription>,
) -> AgentTaskEntry {
    AgentTaskEntry {
        completion_claimed: true,
        cwd_authority: None,
        admission: None,
        metadata: metadata(),
        phase: AgentTaskPhase::Terminal,
        acknowledged: false,
        flushing: false,
        queued: VecDeque::new(),
        status_sequence: 0,
        output_sequence: 0,
        output_incomplete_reported: false,
        outstanding_output: VecDeque::new(),
        last_acknowledged_output: 0,
        stdout_at_line_boundary: true,
        stderr_at_line_boundary: true,
        stop_requested: false,
        outcome_authority: AgentTaskOutcomeAuthority::Undecided,
        interrupt_requested: false,
        watchdog_timed_out: false,
        group: None,
        input: None,
        questions: Some(Arc::clone(session)),
        interactions,
        watchdog: Arc::new(WatchdogGate::default()),
    }
}

fn registry(sink: &Arc<RecordingSink>) -> AgentTaskRegistry {
    AgentTaskRegistry::new(
        Arc::new(AgentTaskAdmissionRegistry::new()),
        Arc::new(RefusingSpawner),
        Arc::clone(sink) as Arc<dyn AgentTaskEventSink>,
    )
}

fn live_leases(registry: &AgentTaskRegistry) -> usize {
    registry
        .shared
        .state()
        .interaction_leases
        .superseded_by_task
        .values()
        .filter(|lease| lease.strong_count() > 0)
        .count()
}

#[test]
fn an_entry_removed_between_terminal_marking_and_finish_still_gets_its_final_snapshot() {
    let sink = Arc::new(RecordingSink::default());
    let registry = registry(&sink);
    let session = asking_session("question-1");
    let subscription =
        AgentInteractionSubscription::open(&registry.shared, &metadata(), Some(&session));
    registry
        .shared
        .state()
        .entries
        .insert(TASK.into(), terminal_entry(&session, subscription));

    let retained = {
        let state = registry.shared.state();
        let entry = state.entries.get(TASK);
        AgentSettlingSession::retain(entry.and_then(|entry| entry.questions.as_ref()))
    };
    let removed = registry.shared.state().entries.remove(TASK);
    assert!(removed.is_some());
    drop(removed);
    assert_eq!(live_leases(&registry), 1);
    assert!(retained.is_some());
    if let Some(retained) = retained {
        retained.finish();
    }

    assert_eq!(
        sink.question_statuses(),
        vec![
            vec![AgentQuestionStatus::Pending],
            vec![AgentQuestionStatus::Expired]
        ]
    );
    assert_eq!(live_leases(&registry), 0);
}

#[test]
fn a_new_lease_for_a_task_id_supersedes_only_the_earlier_lease_of_that_id() {
    let mut leases = AgentInteractionLeases::default();
    let first = leases.issue("agt-one");
    let other = leases.issue("agt-two");
    let second = leases.issue("agt-one");
    assert!(first.superseded.load(Ordering::SeqCst));
    assert!(!other.superseded.load(Ordering::SeqCst));
    assert!(!second.superseded.load(Ordering::SeqCst));
    assert!(Arc::ptr_eq(&first.sequence, &second.sequence));
    assert!(Arc::ptr_eq(&first.sequence, &other.sequence));
}

#[test]
fn released_leases_are_pruned_so_the_table_stays_bounded() {
    let mut leases = AgentInteractionLeases::default();
    for index in 0..256 {
        drop(leases.issue(&format!("agt-{index}")));
    }
    let retained = leases.issue("agt-retained");
    drop(leases.issue("agt-last"));
    assert_eq!(leases.superseded_by_task.len(), 2);
    assert!(!retained.superseded.load(Ordering::SeqCst));
}

fn track(registry: &AgentTaskRegistry, session: &Arc<AgentQuestionSession>) {
    let subscription =
        AgentInteractionSubscription::open(&registry.shared, &metadata(), Some(session));
    registry
        .shared
        .state()
        .entries
        .insert(TASK.into(), terminal_entry(session, subscription));
}

fn forget(registry: &AgentTaskRegistry) {
    let removed = registry.shared.state().entries.remove(TASK);
    assert!(removed.is_some());
}

fn question_ids(snapshot: &AgentInteractionSnapshot) -> Vec<String> {
    snapshot
        .questions
        .iter()
        .map(|request| request.id.clone())
        .collect()
}

#[test]
fn a_pull_that_captured_a_session_before_its_task_id_was_reused_is_rejected() {
    let sink = Arc::new(RecordingSink::default());
    let registry = registry(&sink);
    let original = asking_session("question-original");
    track(&registry, &original);
    let captured = registry.listed_session(TASK, WORKSPACE, Path::new(ROOT));
    assert!(matches!(&captured, Ok(Some(session)) if Arc::ptr_eq(session, &original)));

    forget(&registry);
    let replacement = asking_session("question-replacement");
    track(&registry, &replacement);
    let published = sink
        .interactions
        .lock()
        .expect("interactions lock")
        .last()
        .cloned();
    assert_eq!(
        published.as_ref().map(question_ids),
        Some(vec!["question-replacement".to_string()])
    );

    assert_eq!(
        registry.interactions_of(&original, TASK, WORKSPACE, Path::new(ROOT)),
        Err(AGENT_INTERACTIONS_CHANGED_ERROR.to_string())
    );
    let fresh = registry.interactions(TASK, WORKSPACE, Path::new(ROOT));
    assert_eq!(
        fresh.as_ref().map(question_ids),
        Ok(vec!["question-replacement".to_string()])
    );
    let published_sequence = published.map(|snapshot| snapshot.sequence);
    let fresh_sequence = fresh.map(|snapshot| snapshot.sequence).ok();
    assert!(published_sequence.is_some());
    assert!(fresh_sequence > published_sequence);
}

#[test]
fn a_pull_that_captured_a_session_before_its_entry_was_removed_is_rejected() {
    let sink = Arc::new(RecordingSink::default());
    let registry = registry(&sink);
    let original = asking_session("question-original");
    track(&registry, &original);
    forget(&registry);
    assert_eq!(
        registry.interactions_of(&original, TASK, WORKSPACE, Path::new(ROOT)),
        Err(AGENT_INTERACTIONS_CHANGED_ERROR.to_string())
    );
    assert_eq!(
        registry.interactions(TASK, WORKSPACE, Path::new(ROOT)),
        Ok(AgentInteractionSnapshot::empty(TASK, WORKSPACE))
    );
}

#[test]
fn a_pull_of_the_session_its_entry_still_holds_is_returned() {
    let sink = Arc::new(RecordingSink::default());
    let registry = registry(&sink);
    let original = asking_session("question-original");
    track(&registry, &original);
    assert_eq!(
        registry
            .interactions_of(&original, TASK, WORKSPACE, Path::new(ROOT))
            .as_ref()
            .map(question_ids),
        Ok(vec!["question-original".to_string()])
    );
}
