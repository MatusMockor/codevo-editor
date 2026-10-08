use super::{revoke_trust_and_stop_agents, stop_agents_of_revoked_trust};
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
use crate::agent_task_spawner::codex_app_server_host::shell_test_support::{
    shell_host_for, ShellHostPids, ShellHostSpawner,
};
use crate::agent_task_spawner::codex_app_server_host::CodexAppServerHostRegistry;
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
        self.start_running_turn_in(task_id, descriptor, &descriptor.canonical_root_path);
    }

    fn start_running_turn_in(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        repository_root: &Path,
    ) {
        self.start_turn(
            task_id,
            descriptor,
            repository_root,
            sleeping_plan(repository_root),
        );
    }

    fn revoke_trust(&self, trust_root: &Path, registered: Option<&ManagedWorkspaceDescriptor>) {
        stop_agents_of_revoked_trust(
            self.app.handle(),
            trust_root,
            registered.map(|descriptor| &descriptor.workspace_id),
        );
    }

    fn revoke_trust_of(&self, descriptor: &ManagedWorkspaceDescriptor) {
        self.revoke_trust(&descriptor.canonical_root_path, Some(descriptor));
    }

    fn retire_registration(&self, descriptor: &ManagedWorkspaceDescriptor) {
        self.app
            .state::<WorkspaceRegistry>()
            .unregister(&descriptor.workspace_id)
            .expect("retire the workspace id");
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
        self.start_turn(task_id, descriptor, root, plan.with_claude_session(session_plan));
        events
    }

    fn start_turn(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        root: &Path,
        plan: AgentTaskSpawnPlan,
    ) {
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
                    trust_root: descriptor.canonical_root_path.clone(),
                    repository_root: root.to_path_buf(),
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
    harness.revoke_trust_of(&descriptor);

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

    harness.revoke_trust_of(&registration.descriptor);

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
    harness.revoke_trust_of(&registration.descriptor);

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
fn revoked_trust_stops_a_turn_that_outlived_the_registration_it_started_under() {
    let harness = Harness::create("retired-registration");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let root = harness.workspace("project");
    let earlier = registry.register_with_receipt(&root).expect("register");
    harness.start_running_turn("agt-earlier", &earlier.descriptor);
    harness.retire_registration(&earlier.descriptor);
    let reopened = registry.register_with_receipt(&root).expect("reopen");
    assert_ne!(
        earlier.descriptor.workspace_id,
        reopened.descriptor.workspace_id
    );
    harness.start_running_turn("agt-reopened", &reopened.descriptor);
    assert!(harness.sink.terminal("agt-earlier").is_none());

    harness.revoke_trust_of(&reopened.descriptor);

    for task_id in ["agt-earlier", "agt-reopened"] {
        assert!(stopped_for_revoked_trust(harness.sink.settled(task_id)));
    }
}

#[test]
fn revoked_trust_stops_a_turn_of_a_project_that_is_no_longer_registered() {
    let harness = Harness::create("unregistered-project");
    let registration = harness
        .app
        .state::<WorkspaceRegistry>()
        .register_with_receipt(harness.workspace("project"))
        .expect("register");
    harness.start_running_turn("agt-orphaned", &registration.descriptor);
    harness.retire_registration(&registration.descriptor);

    harness.revoke_trust(&registration.descriptor.canonical_root_path, None);

    assert!(stopped_for_revoked_trust(
        harness.sink.settled("agt-orphaned")
    ));
}

#[test]
fn revoked_trust_of_a_nested_repository_leaves_the_parent_project_working_in_it_alone() {
    let harness = Harness::create("nested-repository");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let parent_root = harness.workspace("parent");
    let nested_root = harness.workspace("parent/nested");
    let parent = registry.register_with_receipt(&parent_root).expect("parent");
    let nested = registry.register_with_receipt(&nested_root).expect("nested");
    harness.start_running_turn_in(
        "agt-parent",
        &parent.descriptor,
        &nested.descriptor.canonical_root_path,
    );
    harness.start_running_turn("agt-nested", &nested.descriptor);

    harness.revoke_trust_of(&nested.descriptor);

    assert!(stopped_for_revoked_trust(
        harness.sink.settled("agt-nested")
    ));
    assert!(harness.sink.terminal("agt-parent").is_none());
    harness.stop_and_settle("agt-parent");
}

#[test]
fn revoked_trust_retires_the_codex_host_that_served_the_project_and_keeps_other_hosts() {
    let harness = Harness::create("codex-host");
    let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
        ShellHostSpawner::default(),
    )));
    harness.app.manage(Arc::clone(&hosts));
    let revoked_root = harness.workspace("revoked");
    let other_root = harness.workspace("other");
    let revoked = shell_host_for(&hosts, &revoked_root, &revoked_root).expect("revoked host");
    let other = shell_host_for(&hosts, &other_root, &other_root).expect("other host");
    let revoked_pids = ShellHostPids::of(&revoked);
    let other_pids = ShellHostPids::of(&other);

    harness.revoke_trust(&revoked_root, None);

    assert!(!revoked.is_ready());
    assert!(revoked_pids.gone_within_deadline());
    assert!(other.is_ready());
    assert!(other_pids.alive());
    hosts.drain_for_dispose();
    assert!(other_pids.gone_within_deadline());
}

#[test]
fn revoking_trust_through_a_retargeted_symlink_acts_on_the_project_that_is_open() {
    let harness = Harness::create("retargeted-symlink");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let alias = harness.fixture.join("alias");
    std::os::unix::fs::symlink(harness.workspace("opened"), &alias).expect("alias to opened");
    let alias_label = alias.to_string_lossy().into_owned();
    let opened = registry.register_with_receipt(&alias).expect("open alias");
    let retarget = registry
        .register_with_receipt(harness.workspace("retarget"))
        .expect("open retarget");
    let opened_root = opened.descriptor.canonical_root_path.clone();
    let retarget_root = retarget.descriptor.canonical_root_path.clone();
    let retarget_label = retarget_root.to_string_lossy().into_owned();
    let mut trust =
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
    trust.set(&alias_label, true).expect("trust opened");
    trust.set(&retarget_label, true).expect("trust retarget");
    assert_eq!(
        Path::new(&trust.snapshot(&alias_label).root_path),
        opened_root
    );
    let trust = Mutex::new(trust);
    let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
        ShellHostSpawner::default(),
    )));
    harness.app.manage(Arc::clone(&hosts));
    let opened_host = shell_host_for(&hosts, &opened_root, &opened_root).expect("opened host");
    let retarget_host =
        shell_host_for(&hosts, &retarget_root, &retarget_root).expect("retarget host");
    let opened_pids = ShellHostPids::of(&opened_host);
    let retarget_pids = ShellHostPids::of(&retarget_host);
    harness.start_running_turn("agt-opened", &opened.descriptor);
    harness.start_running_turn("agt-retarget", &retarget.descriptor);
    let sessions = harness.start_claude_session_turn("agt-opened-claude", &opened.descriptor);
    std::fs::remove_file(&alias).expect("drop alias");
    std::os::unix::fs::symlink(&retarget_root, &alias).expect("alias to retarget");

    let revocation =
        revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &alias_label)
            .expect("revoke trust");

    assert_eq!(Path::new(&revocation.state.root_path), opened_root);
    assert_eq!(revocation.runtime_root, opened_root);
    assert_eq!(
        revocation
            .registered
            .map(|descriptor| descriptor.workspace_id),
        Some(opened.descriptor.workspace_id.clone())
    );
    let trust = trust.lock().expect("trust lock");
    assert!(!trust.get(&opened_root.to_string_lossy()).trusted);
    assert!(trust.get(&retarget_label).trusted);
    for task_id in ["agt-opened", "agt-opened-claude"] {
        assert!(stopped_for_revoked_trust(harness.sink.settled(task_id)));
    }
    assert_eq!(
        sessions.ended_reason("thread-agt-opened-claude"),
        Some(ClaudeSessionEndReason::TrustRevoked)
    );
    assert!(!opened_host.is_ready());
    assert!(opened_pids.gone_within_deadline());
    assert!(harness.sink.terminal("agt-retarget").is_none());
    assert!(retarget_host.is_ready());
    assert!(retarget_pids.alive());
    harness.stop_and_settle("agt-retarget");
    hosts.drain_for_dispose();
    assert!(retarget_pids.gone_within_deadline());
}

fn trusted_fallback_key(harness: &Harness) -> (PathBuf, String, WorkspaceTrustService) {
    let storage = harness.fixture.join("trust.json");
    let spelling = format!("{}/missing/./repo", harness.fixture.display());
    let mut trust = WorkspaceTrustService::load(storage.clone()).expect("load trust");
    trust.set(&spelling, true).expect("trust the fallback key");
    assert_eq!(trust.get(&spelling).root_path, spelling);
    (storage, spelling, trust)
}

#[test]
fn revoking_an_unregistered_path_removes_the_fallback_key_its_grant_stored() {
    let harness = Harness::create("fallback-key");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let (storage, spelling, trust) = trusted_fallback_key(&harness);
    let persisted = WorkspaceTrustService::load(storage.clone()).expect("reload trust");
    assert!(persisted.get(&spelling).trusted);
    let trust = Mutex::new(trust);

    let revocation =
        revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
            .expect("revoke trust");

    assert_eq!(revocation.state.root_path, spelling);
    assert!(!revocation.state.trusted);
    assert!(revocation.registered.is_none());
    assert!(!trust.lock().expect("trust lock").get(&spelling).trusted);
    let persisted = WorkspaceTrustService::load(storage).expect("reload trust");
    assert!(!persisted.get(&spelling).trusted);
}

#[test]
fn an_active_launch_on_a_fallback_key_still_refuses_its_revocation() {
    let harness = Harness::create("fallback-key-launch");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let (_, spelling, trust) = trusted_fallback_key(&harness);
    let launch = trust
        .reserve_launch(&trust.snapshot(&spelling))
        .expect("reserve the start boundary");
    let trust = Mutex::new(trust);

    let refused = revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
        .err()
        .expect("revocation waits for the start boundary");

    assert_eq!(refused.kind(), std::io::ErrorKind::WouldBlock);
    assert!(trust.lock().expect("trust lock").get(&spelling).trusted);
    drop(launch);
    let revocation =
        revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
            .expect("revoke after the launch");
    assert!(!revocation.state.trusted);
    assert!(!trust.lock().expect("trust lock").get(&spelling).trusted);
}

#[test]
fn a_fallback_spelling_that_collapses_onto_an_open_project_revokes_only_its_own_key() {
    let harness = Harness::create("lexical-collision");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let opened = registry
        .register_with_receipt(harness.workspace("base/repo"))
        .expect("open project");
    let opened_root = opened.descriptor.canonical_root_path.clone();
    let opened_label = opened_root.to_string_lossy().into_owned();
    let collision = format!(
        "{}/missing/../repo",
        opened_root.parent().expect("base").display()
    );
    assert_eq!(
        registry
            .descriptor_for_registered_path(Path::new(&collision))
            .expect("the spelling collapses onto the open project")
            .workspace_id,
        opened.descriptor.workspace_id
    );
    let mut trust =
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
    trust.set(&opened_label, true).expect("trust open project");
    trust.set(&collision, true).expect("trust fallback key");
    assert_eq!(trust.get(&collision).root_path, collision);
    let launch = trust
        .reserve_launch(&trust.snapshot(&collision))
        .expect("reserve the fallback start boundary");
    let trust = Mutex::new(trust);
    let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
        ShellHostSpawner::default(),
    )));
    harness.app.manage(Arc::clone(&hosts));
    let host = shell_host_for(&hosts, &opened_root, &opened_root).expect("open project host");
    let pids = ShellHostPids::of(&host);
    harness.start_running_turn("agt-open", &opened.descriptor);
    let sessions = harness.start_claude_session_turn("agt-open-claude", &opened.descriptor);
    let untouched = || {
        let trust = trust.lock().expect("trust lock");
        trust.get(&opened_label).trusted
            && harness.sink.terminal("agt-open").is_none()
            && harness.sink.terminal("agt-open-claude").is_none()
            && sessions.ended.lock().expect("ended lock").is_empty()
            && host.is_ready()
            && pids.alive()
    };

    let refused =
        revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &collision)
            .err()
            .expect("revocation waits for the fallback start boundary");

    assert_eq!(refused.kind(), std::io::ErrorKind::WouldBlock);
    assert!(trust.lock().expect("trust lock").get(&collision).trusted);
    assert!(untouched());
    drop(launch);

    let revocation =
        revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &collision)
            .expect("revoke the fallback key");

    assert_eq!(revocation.state.root_path, collision);
    assert!(revocation.registered.is_none());
    assert_eq!(revocation.runtime_root, Path::new(&collision));
    assert_ne!(revocation.runtime_root.as_os_str(), opened_root.as_os_str());
    assert!(!trust.lock().expect("trust lock").get(&collision).trusted);
    assert!(untouched());
    for task_id in ["agt-open", "agt-open-claude"] {
        harness.stop_and_settle(task_id);
    }
    hosts.drain_for_dispose();
    assert!(pids.gone_within_deadline());
}

struct RevokedKeyCase {
    name: &'static str,
    input: String,
    retarget: Option<(PathBuf, PathBuf)>,
    keeps_trusted: Option<String>,
}

fn revoked_key_cases(harness: &Harness) -> Vec<RevokedKeyCase> {
    let registry = harness.app.state::<WorkspaceRegistry>();
    let open = |name: &str| {
        registry
            .register_with_receipt(harness.workspace(name))
            .expect("open project")
            .descriptor
            .canonical_root_path
    };
    let open_through_alias = |alias: &str, target: &str| {
        let alias = harness.fixture.join(alias);
        std::os::unix::fs::symlink(harness.workspace(target), &alias).expect("alias");
        registry.register_with_receipt(&alias).expect("open alias");
        alias
    };
    let label = |path: &Path| path.to_string_lossy().into_owned();
    let fixture = harness.fixture.canonicalize().expect("canonical fixture");
    let collided = open("collided");
    let retargeted_alias = open_through_alias("retargeted-alias", "retargeted-from");
    vec![
        RevokedKeyCase {
            name: "registered canonical path",
            input: label(&open("canonical")),
            retarget: None,
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "registered through a symlink",
            input: label(&open_through_alias("alias", "aliased")),
            retarget: None,
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "registered through a symlink that is retargeted",
            input: label(&retargeted_alias),
            retarget: Some((retargeted_alias, harness.workspace("retargeted-to"))),
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "unregistered existing path",
            input: label(&harness.workspace("unregistered")),
            retarget: None,
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "unregistered nonexistent canonical spelling",
            input: label(&fixture.join("gone/repo")),
            retarget: None,
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "unregistered nonexistent fallback spelling",
            input: label(&fixture.join("gone/./repo")),
            retarget: None,
            keeps_trusted: None,
        },
        RevokedKeyCase {
            name: "fallback spelling that collapses onto a registered root",
            input: label(&fixture.join("missing/../collided")),
            retarget: None,
            keeps_trusted: Some(label(&collided)),
        },
    ]
}

#[test]
fn revocation_removes_exactly_the_key_a_grant_of_the_same_input_stored() {
    let harness = Harness::create("revoked-key-table");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let trust = Mutex::new(
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust"),
    );
    for case in revoked_key_cases(&harness) {
        let granted = {
            let mut trust = trust.lock().expect("trust lock");
            if let Some(kept) = &case.keeps_trusted {
                trust.set(kept, true).expect("trust the kept project");
            }
            trust.set(&case.input, true).expect("grant").root_path
        };
        if let Some((alias, target)) = &case.retarget {
            std::fs::remove_file(alias).expect("drop alias");
            std::os::unix::fs::symlink(target, alias).expect("retarget alias");
        }

        let revocation =
            revoke_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &case.input)
                .expect("revoke");

        let trust = trust.lock().expect("trust lock");
        assert_eq!(revocation.state.root_path, granted, "{}", case.name);
        assert!(!revocation.state.trusted, "{}", case.name);
        assert!(!trust.snapshot_canonical(&granted).trusted, "{}", case.name);
        if let Some(kept) = &case.keeps_trusted {
            assert!(trust.snapshot_canonical(kept).trusted, "{}", case.name);
        }
    }
}

#[test]
fn trust_revocation_command_revokes_and_stops_agents_through_one_resolved_root() {
    let command = include_str!("workspace_trust_commands.rs");
    assert!(
        command.contains(
            "    let revocation = agent_trust_revocation::revoke_trust_and_stop_agents(\n        &app,\n        &service,\n        &workspace_registry,\n        &root_path,\n    )"
        ),
        "trust revocation must mutate trust and stop agents through one resolved root"
    );
    assert!(
        !command.contains(".set(&root_path, false)") && !command.contains(".set(&root_path, trusted)"),
        "trust revocation must not resolve the trust path a second time"
    );
}
