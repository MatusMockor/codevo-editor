use super::*;
use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use crate::agent_task_spawner::claude_session_policy::ExecutableFingerprint;
use crate::agent_task_spawner::claude_session_router::ClaudeBackgroundReply;
use crate::agent_task_spawner::claude_user_frame;
use crate::agent_task_supervisor::system_process_group_signals;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};

const ROUTED_SESSION: &str = "sess-abcdefgh";
const REAP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Emission {
    Level { live: bool, turn_settled: bool },
    Turn { turn_settled: bool },
}

#[derive(Default)]
struct EmissionRecorder {
    settlement: Mutex<Option<Arc<TurnSettlement>>>,
    emissions: Mutex<Vec<Emission>>,
}

impl EmissionRecorder {
    fn turn_settled(&self) -> bool {
        lock(&self.settlement)
            .as_ref()
            .is_some_and(|settlement| settlement.outcome().is_some())
    }

    fn take(&self) -> Vec<Emission> {
        std::mem::take(&mut *lock(&self.emissions))
    }
}

impl ClaudeSessionOwner for EmissionRecorder {
    fn session_ended(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        _reason: ClaudeSessionEndReason,
        _background_tasks_live: bool,
    ) {
    }

    fn background_turn(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        _turn: ClaudeBackgroundTurn,
    ) {
        let turn_settled = self.turn_settled();
        lock(&self.emissions).push(Emission::Turn { turn_settled });
    }

    fn background_tasks(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        tasks: ClaudeBackgroundTasks,
    ) -> bool {
        let turn_settled = self.turn_settled();
        lock(&self.emissions).push(Emission::Level {
            live: tasks.keeps_session_live(),
            turn_settled,
        });
        true
    }
}

struct QuietSession {
    session: Arc<ClaudeThreadSession>,
    recorder: Arc<EmissionRecorder>,
}

impl QuietSession {
    fn start() -> Self {
        let child = Command::new("/bin/sleep")
            .arg("600")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .expect("quiet session process");
        let process_group_id = child.id() as i32;
        let recorder = Arc::new(EmissionRecorder::default());
        let owner: Weak<EmissionRecorder> = Arc::downgrade(&recorder);
        let owner: Weak<dyn ClaudeSessionOwner> = owner;
        let session = ClaudeThreadSession::start(
            ClaudeSessionIdentity {
                key: ClaudeSessionKey {
                    workspace_id: "ws-route-step".to_string(),
                    thread_id: "thread-a".to_string(),
                },
                generation: 1,
                fingerprint: ClaudeSessionFingerprint {
                    executable: ExecutableFingerprint {
                        path: PathBuf::from("/bin/sleep"),
                        size_bytes: 0,
                        modified_epoch_ms: 0,
                        device: 0,
                        inode: 0,
                    },
                    provider_generation: 1,
                    launch: AgentLaunchOptions::default(),
                    args_without_resume: Vec::new(),
                    env: Vec::new(),
                    cwd: PathBuf::from("/"),
                    cwd_identity: None,
                },
                repository_root: PathBuf::from("/"),
            },
            (child, process_group_id),
            system_process_group_signals(),
            ClaudeSessionTuning::default(),
            owner,
        )
        .expect("quiet session");
        Self { session, recorder }
    }

    fn attach(&self) -> (ClaudeSessionTurnChild, String) {
        let turn = self
            .session
            .attach_turn(&claude_user_frame("go", &[]))
            .expect("attached turn");
        let state = self.session.state();
        let attached = state.attached.as_ref().expect("attached state");
        *lock(&self.recorder.settlement) = Some(Arc::clone(&attached.settlement));
        (turn, attached.lifecycle.initial_command_id().to_string())
    }

    fn read_in_one_chunk(&self, chunk: &[u8]) -> Vec<Emission> {
        self.session.route_step(|router| router.feed(chunk));
        self.recorder.take()
    }
}

impl Drop for QuietSession {
    fn drop(&mut self) {
        self.session.kill_now(ClaudeSessionEndReason::Shutdown);
        self.session.wait_reaped(REAP_TIMEOUT);
    }
}

fn routed(mut frame: serde_json::Value) -> Vec<u8> {
    frame["session_id"] = serde_json::json!(ROUTED_SESSION);
    let mut line = serde_json::to_vec(&frame).expect("routed frame");
    line.push(b'\n');
    line
}

fn command(id: &str, state: &str) -> Vec<u8> {
    routed(serde_json::json!({"type": "command_lifecycle", "command_uuid": id, "state": state}))
}

fn init() -> Vec<u8> {
    routed(serde_json::json!({"type": "system", "subtype": "init"}))
}

fn answer(text: &str) -> Vec<u8> {
    routed(serde_json::json!({
        "type": "assistant",
        "parent_tool_use_id": null,
        "message": {"content": [{"type": "text", "text": text}]}
    }))
}

fn own_result(id: &str) -> Vec<u8> {
    routed(serde_json::json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "result": "done",
        "num_turns": 1,
        "user_message_uuid": id,
        "user_message_uuids": [id]
    }))
}

fn unprompted_result() -> Vec<u8> {
    routed(serde_json::json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "result": "replied",
        "num_turns": 1,
        "origin": {"kind": "task-notification"}
    }))
}

fn shell_started(task: &str) -> Vec<u8> {
    routed(serde_json::json!({
        "type": "system",
        "subtype": "task_started",
        "task_id": task,
        "task_type": "local_bash",
        "is_backgrounded": true
    }))
}

fn shell_finished(task: &str) -> Vec<u8> {
    routed(serde_json::json!({
        "type": "system",
        "subtype": "task_updated",
        "task_id": task,
        "patch": {"status": "completed"}
    }))
}

fn shell_stopped(task: &str) -> Vec<u8> {
    routed(serde_json::json!({
        "type": "system",
        "subtype": "task_notification",
        "task_id": task,
        "status": "stopped"
    }))
}

fn own_turn(id: &str, during: &[Vec<u8>]) -> Vec<u8> {
    let opening = [command(id, "queued"), command(id, "started"), init()];
    let closing = [answer("done"), own_result(id), command(id, "completed")];
    [opening.as_slice(), during, closing.as_slice()]
        .concat()
        .concat()
}

#[test]
fn a_live_level_read_in_the_chunk_that_settles_the_turn_is_published_before_the_settlement() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    let chunk = [own_turn(&id, &[]), init(), shell_started("bg-1")].concat();

    let emissions = quiet.read_in_one_chunk(&chunk);

    assert_eq!(
        emissions,
        [Emission::Level {
            live: true,
            turn_settled: false
        }]
    );
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(quiet.session.background_tasks(), 1);
    assert_eq!(
        lock(&quiet.session.router).background_tasks().reply,
        ClaudeBackgroundReply::InProgress
    );
}

#[test]
fn a_level_that_keeps_the_session_live_is_published_before_the_reply_turn_of_its_chunk() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    assert_eq!(quiet.read_in_one_chunk(&own_turn(&id, &[])), []);
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    let reply_starting_a_shell = [
        init(),
        answer("starting"),
        shell_started("bg-1"),
        unprompted_result(),
    ]
    .concat();

    assert_eq!(
        quiet.read_in_one_chunk(&reply_starting_a_shell),
        [
            Emission::Level {
                live: true,
                turn_settled: true
            },
            Emission::Turn { turn_settled: true }
        ]
    );
    assert_eq!(quiet.session.background_tasks(), 1);
}

#[test]
fn a_level_that_ends_the_session_work_is_published_after_the_reply_turn_it_closes() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    quiet.read_in_one_chunk(&[own_turn(&id, &[]), init(), shell_started("bg-1")].concat());
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    let reply_ending_with_the_shell_stopped = [
        answer("stopped it"),
        shell_stopped("bg-1"),
        unprompted_result(),
    ]
    .concat();

    assert_eq!(
        quiet.read_in_one_chunk(&reply_ending_with_the_shell_stopped),
        [
            Emission::Turn { turn_settled: true },
            Emission::Level {
                live: false,
                turn_settled: true
            }
        ]
    );
    assert_eq!(quiet.session.background_tasks(), 0);
}

#[test]
fn a_reply_during_which_a_task_finished_publishes_its_idle_level_after_its_turn() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    quiet.read_in_one_chunk(&[own_turn(&id, &[]), init(), shell_started("bg-1")].concat());
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    let reply_ending_with_the_shell_finished = [
        answer("still writing"),
        shell_finished("bg-1"),
        unprompted_result(),
    ]
    .concat();

    assert_eq!(
        quiet.read_in_one_chunk(&reply_ending_with_the_shell_finished),
        [
            Emission::Turn { turn_settled: true },
            Emission::Level {
                live: false,
                turn_settled: true
            }
        ]
    );
    assert_eq!(
        quiet.session.background_level(),
        ClaudeBackgroundTasks::default()
    );
}

#[test]
fn a_task_finishing_on_its_own_publishes_the_expected_reply_before_it_settles_the_waiting_turn() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    assert_eq!(
        quiet.read_in_one_chunk(&own_turn(&id, &[shell_started("bg-1")])),
        [Emission::Level {
            live: true,
            turn_settled: false
        }]
    );
    assert_eq!(turn.outcome(), None);

    assert_eq!(
        quiet.read_in_one_chunk(&shell_finished("bg-1")),
        [Emission::Level {
            live: true,
            turn_settled: false
        }]
    );
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(
        quiet.session.background_level().reply,
        ClaudeBackgroundReply::Expected
    );
}

#[test]
fn a_stopped_task_that_settles_the_waiting_turn_publishes_its_idle_level_after_the_settlement() {
    let quiet = QuietSession::start();
    let (turn, id) = quiet.attach();
    quiet.read_in_one_chunk(&own_turn(&id, &[shell_started("bg-1")]));
    assert_eq!(turn.outcome(), None);

    assert_eq!(
        quiet.read_in_one_chunk(&shell_stopped("bg-1")),
        [Emission::Level {
            live: false,
            turn_settled: true
        }]
    );
    assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    assert_eq!(
        quiet.session.background_level(),
        ClaudeBackgroundTasks::default()
    );
}
