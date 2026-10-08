use super::stop_agents_of_revoked_workspace;
use crate::agent_task_admission::AgentTaskAdmissionRegistry;
use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use crate::agent_task_spawner::claude_session_policy::{
    ClaudeSessionBackgroundTasksEvent, ClaudeSessionBackgroundTurnEvent, ClaudeSessionEndReason,
    ClaudeSessionEndedEvent, ClaudeSessionKey, ClaudeSessionRestartPolicy,
};
use crate::agent_task_spawner::claude_session_registry::{
    ClaudeSessionEventSink, ClaudeSessionRegistry, ClaudeSessionRequest,
};
use crate::agent_task_spawner::claude_session_turn::{session_fingerprint, ClaudeSessionTurnPlan};
use crate::agent_task_spawner::{claude_user_frame, AgentTaskSpawnPlan, StdAgentProcessSpawner};
use crate::agent_task_supervisor::{
    agent_task_trust_revocation::AGENT_TASK_TRUST_REVOKED_MESSAGE, system_process_group_signals,
    AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent, AgentTaskRegistry,
    AgentTaskStartRequest, AgentTaskStatusEvent, AgentTaskStatusPayload,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::unregister::{WorkspaceOwnerRelease, WorkspaceOwnerScope};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, RegistrationOwner, WorkspaceRegistry};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::test::MockRuntime;
use tauri::Manager;

const SETTLE_DEADLINE: Duration = Duration::from_secs(10);
static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct RecordingSink {
    statuses: Mutex<Vec<AgentTaskStatusEvent>>,
}

impl RecordingSink {
    fn terminal(&self, task_id: &str) -> Option<AgentTaskStatusPayload> {
        self.statuses
            .lock()
            .expect("statuses lock")
            .iter()
            .filter(|event| event.task_id == task_id)
            .map(|event| event.status.clone())
            .find(|status| {
                !matches!(
                    status,
                    AgentTaskStatusPayload::Pending | AgentTaskStatusPayload::Running
                )
            })
    }

    fn settled(&self, task_id: &str) -> Option<AgentTaskStatusPayload> {
        let deadline = Instant::now() + SETTLE_DEADLINE;
        while Instant::now() < deadline {
            if let Some(status) = self.terminal(task_id) {
                return Some(status);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }
}

impl AgentTaskEventSink for RecordingSink {
    fn status(&self, event: AgentTaskStatusEvent) {
        self.statuses.lock().expect("statuses lock").push(event);
    }

    fn output(&self, _event: AgentTaskOutputEvent) {}
}

#[derive(Default)]
struct RecordingSessionEvents {
    ended: Mutex<Vec<ClaudeSessionEndedEvent>>,
}

impl RecordingSessionEvents {
    fn ended_reason(&self, thread_id: &str) -> Option<ClaudeSessionEndReason> {
        let deadline = Instant::now() + SETTLE_DEADLINE;
        while Instant::now() < deadline {
            let reason = self
                .ended
                .lock()
                .expect("ended lock")
                .iter()
                .find(|event| event.thread_id == thread_id)
                .map(|event| event.reason);
            if reason.is_some() {
                return reason;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }
}

impl ClaudeSessionEventSink for RecordingSessionEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        self.ended.lock().expect("ended lock").push(event);
    }

    fn background_turn(&self, _event: ClaudeSessionBackgroundTurnEvent) {}

    fn background_tasks(&self, _event: ClaudeSessionBackgroundTasksEvent) {}
}

struct Harness {
    app: tauri::App<MockRuntime>,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    fixture: PathBuf,
}

impl Harness {
    fn create(label: &str) -> Self {
        let fixture = std::env::temp_dir().join(format!(
            "codevo-agent-trust-revocation-{label}-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&fixture).expect("fixture root");
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app");
        let admission = Arc::new(AgentTaskAdmissionRegistry::new());
        let sink = Arc::new(RecordingSink::default());
        app.manage(WorkspaceRegistry::new());
        app.manage(AgentTaskRegistry::new(
            Arc::clone(&admission),
            Arc::new(StdAgentProcessSpawner),
            Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        ));
        Self {
            app,
            admission,
            sink,
            fixture,
        }
    }

    fn workspace(&self, name: &str) -> PathBuf {
        let root = self.fixture.join(name);
        std::fs::create_dir_all(&root).expect("workspace root");
        root
    }

    fn start_running_turn(&self, task_id: &str, descriptor: &ManagedWorkspaceDescriptor) {
        self.start_turn(
            task_id,
            descriptor,
            sleeping_plan(&descriptor.canonical_root_path),
        );
    }

    fn start_claude_session_turn(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
    ) -> Arc<RecordingSessionEvents> {
        let events = Arc::new(RecordingSessionEvents::default());
        let sessions = Arc::new(ClaudeSessionRegistry::new(
            system_process_group_signals(),
            Arc::clone(&events) as Arc<dyn ClaudeSessionEventSink>,
        ));
        self.app.manage(Arc::clone(&sessions));
        let root = &descriptor.canonical_root_path;
        let plan = AgentTaskSpawnPlan::for_tests(
            PathBuf::from("/bin/sh"),
            vec![
                "-c".to_string(),
                "while read -r frame; do :; done".to_string(),
            ],
            root.clone(),
            Vec::new(),
        )
        .with_stdin_frame_for_tests(claude_user_frame("hi", &[]));
        let request = ClaudeSessionRequest {
            key: ClaudeSessionKey {
                workspace_id: descriptor.workspace_id.as_str().to_string(),
                thread_id: format!("thread-{task_id}"),
            },
            repository_root: root.clone(),
            fingerprint: session_fingerprint(&plan, AgentLaunchOptions::default(), 1),
            resume_session_id: None,
            restart: ClaudeSessionRestartPolicy::RefuseIfBackground,
        };
        let session_plan = ClaudeSessionTurnPlan::new(sessions, request, Arc::new(|| Ok(())));
        self.start_turn(task_id, descriptor, plan.with_claude_session(session_plan));
        events
    }

    fn start_turn(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        plan: AgentTaskSpawnPlan,
    ) {
        let root = &descriptor.canonical_root_path;
        let admission = self
            .admission
            .reserve(
                &descriptor.workspace_id,
                root,
                root,
                AgentTaskIsolation::InPlace,
            )
            .expect("admission");
        let registry = self.app.state::<AgentTaskRegistry>();
        registry
            .start(
                AgentTaskStartRequest {
                    task_id: task_id.to_string(),
                    thread_id: format!("thread-{task_id}"),
                    workspace_id: descriptor.workspace_id.as_str().to_string(),
                    repository_root: root.clone(),
                    isolation: AgentTaskIsolation::InPlace,
                    worktree_path: None,
                },
                plan,
                admission,
            )
            .expect("start turn");
        registry.acknowledge(task_id).expect("acknowledge turn");
    }

    fn stop_and_settle(&self, task_id: &str) {
        self.app
            .state::<AgentTaskRegistry>()
            .stop(task_id)
            .expect("stop turn");
        assert!(self.sink.settled(task_id).is_some());
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.fixture);
    }
}

fn sleeping_plan(cwd: &Path) -> AgentTaskSpawnPlan {
    AgentTaskSpawnPlan::for_tests(
        PathBuf::from("/bin/sh"),
        vec!["-c".to_string(), "sleep 30 & sleep 30".to_string()],
        cwd.to_path_buf(),
        Vec::new(),
    )
}

fn stopped_for_revoked_trust(status: Option<AgentTaskStatusPayload>) -> bool {
    matches!(
        status,
        Some(AgentTaskStatusPayload::Failed { message })
            if message == AGENT_TASK_TRUST_REVOKED_MESSAGE
    )
}

#[test]
fn revoked_trust_stops_the_agents_of_the_exact_workspace_while_another_owner_keeps_it_registered() {
    let harness = Harness::create("second-owner");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let revoked_root = harness.workspace("revoked");
    let editor = registry
        .register_with_receipt(&revoked_root)
        .expect("editor owner");
    let agent = registry
        .register_owner_with_receipt(&revoked_root, RegistrationOwner::Agent)
        .expect("agent owner");
    let other = registry
        .register_with_receipt(harness.workspace("other"))
        .expect("other workspace");
    assert_eq!(
        editor.descriptor.workspace_id,
        agent.descriptor.workspace_id
    );
    harness.start_running_turn("agt-revoked", &editor.descriptor);
    harness.start_running_turn("agt-other", &other.descriptor);

    let released = registry
        .release_owner(
            &agent.descriptor.workspace_id,
            WorkspaceOwnerScope::Admission {
                owner: RegistrationOwner::Agent,
                admission_token: agent.receipt.admission_token,
            },
            None,
        )
        .expect("release agent owner");
    assert!(matches!(
        released,
        WorkspaceOwnerRelease::RetainedByOtherOwners
    ));
    drop(released);
    assert!(harness.sink.terminal("agt-revoked").is_none());

    let descriptor = registry
        .descriptor_for_registered_path(&revoked_root)
        .expect("workspace stays registered for its editor owner");
    stop_agents_of_revoked_workspace(harness.app.handle(), &descriptor.workspace_id);

    assert!(stopped_for_revoked_trust(
        harness.sink.settled("agt-revoked")
    ));
    assert!(harness.sink.terminal("agt-other").is_none());
    assert!(registry
        .descriptor_for_registered_path(&revoked_root)
        .is_ok());
    harness.stop_and_settle("agt-other");
}

#[test]
fn revoked_trust_ends_a_running_claude_session_with_its_reason_and_explains_the_turn() {
    let harness = Harness::create("claude-session");
    let registration = harness
        .app
        .state::<WorkspaceRegistry>()
        .register_with_receipt(harness.workspace("project"))
        .expect("register");
    let events = harness.start_claude_session_turn("agt-claude", &registration.descriptor);
    assert!(harness.sink.terminal("agt-claude").is_none());

    stop_agents_of_revoked_workspace(harness.app.handle(), &registration.descriptor.workspace_id);

    assert!(stopped_for_revoked_trust(
        harness.sink.settled("agt-claude")
    ));
    assert_eq!(
        events.ended_reason("thread-agt-claude"),
        Some(ClaudeSessionEndReason::TrustRevoked)
    );
}

#[test]
fn a_start_racing_trust_revocation_is_stopped_once_committed_and_refused_afterwards() {
    let harness = Harness::create("start-race");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let root = harness.workspace("project");
    let registration = registry.register_with_receipt(&root).expect("register");
    let root_label = root.to_string_lossy().into_owned();
    let mut trust =
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
    trust.set(&root_label, true).expect("trust project");
    let launch_authority = trust.snapshot(&root_label);

    let launch = trust
        .reserve_launch(&launch_authority)
        .expect("reserve the start boundary");
    let blocked = trust
        .set(&root_label, false)
        .expect_err("revocation waits for the start boundary");
    assert_eq!(blocked.kind(), std::io::ErrorKind::WouldBlock);
    harness.start_running_turn("agt-racing", &registration.descriptor);
    drop(launch);

    assert!(!trust.set(&root_label, false).expect("revoke").trusted);
    stop_agents_of_revoked_workspace(harness.app.handle(), &registration.descriptor.workspace_id);

    assert!(stopped_for_revoked_trust(
        harness.sink.settled("agt-racing")
    ));
    let refused = trust
        .reserve_launch(&launch_authority)
        .err()
        .expect("a start after revocation is refused");
    assert_eq!(refused.kind(), std::io::ErrorKind::PermissionDenied);
}

#[test]
fn trust_revocation_command_stops_the_agents_of_the_revoked_workspace() {
    let command = include_str!("workspace_trust_commands.rs");
    assert!(
        command.contains(
            "agent_trust_revocation::stop_agents_of_revoked_workspace(&app, &descriptor.workspace_id);"
        ),
        "trust revocation must stop the agent tasks and sessions of the revoked workspace"
    );
}
