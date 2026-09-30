use super::super::claude_thread_session_tests::{
    drain, linger_native_background_task_with, read_until,
};
use super::*;
use agent_task_spawner::claude_session_policy::SessionAvailability;
use agent_task_spawner::claude_session_task_stop::ClaudeBackgroundTaskStopOutcome;

const STOP_DEADLINE: Duration = Duration::from_secs(3);
const LEVEL_DEADLINE: Duration = Duration::from_secs(5);

struct Lingering {
    cli: FakeCli,
    registry: Arc<ClaudeSessionRegistry>,
    events: Arc<RecordingSessionEvents>,
    session: Arc<ClaudeThreadSession>,
    task: String,
}

impl Lingering {
    fn start(label: &str, prompt: &str) -> Self {
        let cli = FakeCli::new(label);
        let (registry, events) = session_registry(ClaudeSessionTuning::default());
        let acquired = acquire(
            &registry,
            &cli,
            &session_request(
                &cli,
                "ws-a",
                "t1",
                None,
                AgentLaunchOptions::default(),
                ClaudeSessionRestartPolicy::RefuseIfBackground,
            ),
        )
        .expect("acquire");
        let session = acquired.session.expect("a live session");
        linger_native_background_task_with(&session, prompt);
        assert!(wait_until(LEVEL_DEADLINE, || {
            last_level(&events, "t1").is_some_and(|level| level.total == 1)
        }));
        let task = last_level(&events, "t1")
            .and_then(|level| level.tasks.first().map(|task| task.task_id.clone()))
            .unwrap_or_default();
        assert!(task.starts_with("linger-"), "{task}");
        Self {
            cli,
            registry,
            events,
            session,
            task,
        }
    }

    fn stop(&self, workspace: &str, thread: &str, task: &str) -> ClaudeBackgroundTaskStopOutcome {
        self.registry
            .stop_background_task(workspace, thread, task, Instant::now() + STOP_DEADLINE)
    }

    fn level_cleared(&self) -> bool {
        last_level(&self.events, "t1")
            .is_some_and(|level| level.total == 0 && level.agents == 0 && level.tasks.is_empty())
    }
}

impl Drop for Lingering {
    fn drop(&mut self) {
        self.registry.shutdown_all();
    }
}

fn last_level(
    events: &RecordingSessionEvents,
    thread: &str,
) -> Option<ClaudeSessionBackgroundTasksEvent> {
    events
        .background_task_levels()
        .into_iter()
        .rev()
        .find(|level| level.thread_id == thread)
}

#[test]
fn an_interrupted_turn_leaves_a_live_task_that_its_owner_stops_while_the_session_is_idle() {
    let lingering = Lingering::start("stop-task-idle", "native-linger");
    assert_eq!(
        lingering.session.facts().availability,
        SessionAvailability::Idle
    );
    assert_eq!(lingering.session.background_tasks(), 1);

    assert_eq!(
        lingering.stop("ws-a", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::Stopping
    );
    assert!(wait_until(LEVEL_DEADLINE, || lingering.level_cleared()));
    assert_eq!(lingering.session.background_tasks(), 0);
    assert_eq!(
        lingering.cli.stop_task_requests(),
        vec![lingering.task.clone()]
    );
    assert!(lingering.events.reasons_for("t1").is_empty());
    assert_eq!(
        lingering.session.facts().availability,
        SessionAvailability::Idle
    );

    assert_eq!(
        lingering.stop("ws-a", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::NotLive
    );
    assert_eq!(lingering.cli.stop_task_requests().len(), 1);
    settle(&lingering.session, "hello");
    assert_eq!(lingering.cli.cli_pids().len(), 1);
}

#[test]
fn a_stop_needs_the_exact_owner_and_a_live_native_task_and_writes_nothing_otherwise() {
    let lingering = Lingering::start("stop-task-owner", "native-linger");
    assert_eq!(
        lingering.stop("ws-b", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::NoSession
    );
    assert_eq!(
        lingering.stop("ws-a", "t2", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::NoSession
    );
    assert_eq!(
        lingering.stop("ws-a", "t1", "linger-unknown"),
        ClaudeBackgroundTaskStopOutcome::NotLive
    );
    assert_eq!(
        lingering
            .session
            .stop_background_task("", Instant::now() + STOP_DEADLINE),
        ClaudeBackgroundTaskStopOutcome::NotLive
    );
    thread::sleep(Duration::from_millis(200));
    assert!(lingering.cli.stop_task_requests().is_empty());
    assert_eq!(lingering.session.background_tasks(), 1);
    assert!(lingering.events.reasons_for("t1").is_empty());
}

#[test]
fn a_refused_stop_is_reported_truthfully_and_the_task_stays_live() {
    let lingering = Lingering::start("stop-task-refused", "native-linger-refuse");
    assert_eq!(
        lingering.stop("ws-a", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::Refused {
            reason: format!("No task found with ID: {}", lingering.task),
        }
    );
    thread::sleep(Duration::from_millis(200));
    assert_eq!(lingering.session.background_tasks(), 1);
    assert!(!lingering.level_cleared());
    assert!(lingering.events.reasons_for("t1").is_empty());
    settle(&lingering.session, "hello");
    assert_eq!(lingering.cli.cli_pids().len(), 1);
}

#[test]
fn an_unanswered_stop_is_unconfirmed_within_its_deadline() {
    let lingering = Lingering::start("stop-task-silent", "native-linger-silent");
    let started = Instant::now();
    assert_eq!(
        lingering.registry.stop_background_task(
            "ws-a",
            "t1",
            &lingering.task,
            Instant::now() + Duration::from_secs(1)
        ),
        ClaudeBackgroundTaskStopOutcome::Unconfirmed
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        lingering.cli.stop_task_requests(),
        vec![lingering.task.clone()]
    );
    assert_eq!(lingering.session.background_tasks(), 1);
    assert!(lingering.events.reasons_for("t1").is_empty());
}

#[test]
fn a_stop_reply_during_a_running_turn_stays_out_of_that_turn() {
    let lingering = Lingering::start("stop-task-attached", "native-linger");
    let mut turn = lingering
        .session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach slow");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    let early = read_until(stdout.as_mut(), "echo:slow", Duration::from_secs(10));
    assert!(early.contains("echo:slow"), "{early}");

    assert_eq!(
        lingering.stop("ws-a", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::Stopping
    );
    assert!(wait_until(LEVEL_DEADLINE, || lingering.level_cleared()));
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let rest = drain(stdout.as_mut(), Duration::from_secs(10));
    let output = format!("{early}{rest}");
    assert_eq!(
        output.matches("\"type\": \"control_response\"").count(),
        1,
        "only the interrupt acknowledgement belongs to the turn: {output}"
    );
    assert_eq!(lingering.session.background_tasks(), 0);
    assert!(lingering.events.reasons_for("t1").is_empty());
}

#[test]
fn an_ended_session_reports_no_session_and_its_ended_event_still_reports_live_tasks() {
    let lingering = Lingering::start("stop-task-ended", "native-linger");
    assert!(lingering
        .registry
        .end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
    assert!(lingering.session.wait_reaped(Duration::from_secs(5)));
    assert_eq!(
        lingering.stop("ws-a", "t1", &lingering.task),
        ClaudeBackgroundTaskStopOutcome::NoSession
    );
    assert_eq!(
        lingering
            .session
            .stop_background_task(&lingering.task, Instant::now() + STOP_DEADLINE),
        ClaudeBackgroundTaskStopOutcome::NoSession
    );
    assert!(lingering.cli.stop_task_requests().is_empty());
    let ended = lingering.events.last_for("t1").expect("ended event");
    assert_eq!(ended.reason, ClaudeSessionEndReason::ThreadEnded);
    assert!(ended.background_tasks_live);
    assert_eq!(ended.workspace_id, "ws-a");
}
