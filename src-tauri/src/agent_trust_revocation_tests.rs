use super::{revoke_path_trust_and_stop_agents, stop_agents_of_revoked_trust};
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
use crate::workspace_registry::registration::WorkspaceRegistration;
use crate::workspace_registry::unregister::{WorkspaceOwnerRelease, WorkspaceOwnerScope};
use crate::workspace_registry::{ManagedWorkspaceDescriptor, RegistrationOwner, WorkspaceRegistry};
use crate::workspace_trust_commands::opened_project::{
    revocation_lease, OpenedProjectTrustRevocationTarget, OPENED_PROJECT_REVOCATION_IDENTITY_ERROR,
};
use crate::workspace_trust_commands::{revoke_leased_project, revoke_opened_project};
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
        self.start_turn_admitted_under(
            task_id,
            descriptor,
            root,
            &descriptor.canonical_root_path,
            plan,
        );
    }

    fn start_running_turn_admitted_under(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        trust_root: &Path,
    ) {
        let root = &descriptor.canonical_root_path;
        self.start_turn_admitted_under(task_id, descriptor, root, trust_root, sleeping_plan(root));
    }

    fn start_turn_admitted_under(
        &self,
        task_id: &str,
        descriptor: &ManagedWorkspaceDescriptor,
        root: &Path,
        trust_root: &Path,
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
                    trust_root: trust_root.to_path_buf(),
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

fn tab_identity(registration: &WorkspaceRegistration) -> OpenedProjectTrustRevocationTarget {
    tab_identity_of(serde_json::json!({
        "workspaceId": registration.receipt.workspace_id,
        "admissionToken": registration.receipt.admission_token,
        "canonicalRootPath": registration.descriptor.canonical_root_path,
    }))
}

fn tab_identity_of(identity: serde_json::Value) -> OpenedProjectTrustRevocationTarget {
    serde_json::from_value(identity).expect("tab identity")
}

#[derive(Clone, Copy)]
enum AliasAdmission {
    First,
    Second,
}

fn assert_trust_off_in_a_retargeted_alias_tab_revokes_the_open_project(admission: AliasAdmission) {
    let harness = Harness::create("retargeted-alias-tab");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let alias = harness.fixture.join("alias");
    let opened_path = harness.workspace("opened");
    std::os::unix::fs::symlink(&opened_path, &alias).expect("alias to opened");
    let alias_label = alias.to_string_lossy().into_owned();
    let earlier = match admission {
        AliasAdmission::First => None,
        AliasAdmission::Second => Some(registry.register_with_receipt(&opened_path).expect("open")),
    };
    let tab = registry.register_with_receipt(&alias).expect("open alias");
    if let Some(earlier) = &earlier {
        assert_eq!(
            earlier.descriptor.workspace_id,
            tab.descriptor.workspace_id
        );
        let retained = registry
            .descriptor(&tab.descriptor.workspace_id)
            .expect("retained descriptor");
        assert_ne!(retained.selected_root_path, alias);
    }
    let retarget = registry
        .register_with_receipt(harness.workspace("retarget"))
        .expect("open retarget");
    let opened_root = tab.descriptor.canonical_root_path.clone();
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
    let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
        ShellHostSpawner::default(),
    )));
    harness.app.manage(Arc::clone(&hosts));
    let opened_host = shell_host_for(&hosts, &opened_root, &opened_root).expect("opened host");
    let retarget_host =
        shell_host_for(&hosts, &retarget_root, &retarget_root).expect("retarget host");
    let opened_pids = ShellHostPids::of(&opened_host);
    let retarget_pids = ShellHostPids::of(&retarget_host);
    harness.start_running_turn("agt-opened", &tab.descriptor);
    harness.start_running_turn("agt-retarget", &retarget.descriptor);
    let sessions = harness.start_claude_session_turn("agt-opened-claude", &tab.descriptor);
    std::fs::remove_file(&alias).expect("drop alias");
    std::os::unix::fs::symlink(&retarget_root, &alias).expect("alias to retarget");
    assert_eq!(
        Path::new(&trust.snapshot(&alias_label).root_path),
        retarget_root
    );
    let trust = Mutex::new(trust);

    let revocation = revoke_opened_project(
        harness.app.handle(),
        &trust,
        &registry,
        &tab_identity(&tab),
    )
    .expect("revoke trust");

    assert_eq!(Path::new(&revocation.state.root_path), opened_root);
    assert!(!revocation.state.trusted);
    assert_eq!(revocation.runtime_root.as_deref(), Some(opened_root.as_path()));
    assert_eq!(
        revocation
            .registered
            .map(|descriptor| descriptor.workspace_id),
        Some(tab.descriptor.workspace_id.clone())
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

#[test]
fn revoking_trust_through_a_retargeted_symlink_acts_on_the_project_that_is_open() {
    assert_trust_off_in_a_retargeted_alias_tab_revokes_the_open_project(AliasAdmission::First);
}

#[test]
fn trust_off_in_a_tab_opened_through_a_second_retargeted_alias_revokes_the_open_project() {
    assert_trust_off_in_a_retargeted_alias_tab_revokes_the_open_project(AliasAdmission::Second);
}

#[test]
fn a_stale_or_foreign_tab_identity_is_rejected_without_revoking_or_stopping_anything() {
    let harness = Harness::create("stale-tab-identity");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let opened = registry
        .register_with_receipt(harness.workspace("opened"))
        .expect("open project");
    let other = registry
        .register_with_receipt(harness.workspace("other"))
        .expect("open other project");
    let opened_label = opened
        .descriptor
        .canonical_root_path
        .to_string_lossy()
        .into_owned();
    let mut trust =
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
    trust.set(&opened_label, true).expect("trust opened");
    let trust = Mutex::new(trust);
    harness.start_running_turn("agt-opened", &opened.descriptor);
    let identity = |workspace_id: &str, admission_token: u64, canonical_root: &Path| {
        tab_identity_of(serde_json::json!({
            "workspaceId": workspace_id,
            "admissionToken": admission_token,
            "canonicalRootPath": canonical_root,
        }))
    };
    let opened_id = opened.receipt.workspace_id.as_str();
    let opened_token = opened.receipt.admission_token;
    let opened_root = opened.descriptor.canonical_root_path.as_path();
    let rejected = |target: &OpenedProjectTrustRevocationTarget| {
        let refusal = revoke_opened_project(harness.app.handle(), &trust, &registry, target)
            .err()
            .map(|error| (error.kind(), error.to_string()));
        let untouched = trust.lock().expect("trust lock").get(&opened_label).trusted
            && harness.sink.terminal("agt-opened").is_none();
        untouched
            && refusal
                == Some((
                    std::io::ErrorKind::InvalidInput,
                    OPENED_PROJECT_REVOCATION_IDENTITY_ERROR.to_string(),
                ))
    };

    assert!(rejected(&identity("ws-unknown", opened_token, opened_root)));
    assert!(rejected(&identity(opened_id, opened_token + 1, opened_root)));
    assert!(rejected(&identity(opened_id, 0, opened_root)));
    assert!(rejected(&identity(
        opened_id,
        other.receipt.admission_token + 1,
        opened_root
    )));
    assert!(rejected(&identity(
        opened_id,
        opened_token,
        &other.descriptor.canonical_root_path
    )));
    assert!(rejected(&identity(
        opened_id,
        opened_token,
        &opened_root.join(".")
    )));
    assert!(rejected(&identity(
        other.receipt.workspace_id.as_str(),
        opened_token,
        opened_root
    )));
    harness.retire_registration(&opened.descriptor);
    assert!(rejected(&tab_identity(&opened)));
    assert!(serde_json::from_value::<OpenedProjectTrustRevocationTarget>(serde_json::json!({
        "workspaceId": opened_id,
        "admissionToken": opened_token,
        "canonicalRootPath": opened_root,
        "rootPath": opened_root,
    }))
    .is_err());
    harness.stop_and_settle("agt-opened");
}

#[test]
fn a_registration_replaced_before_the_revocation_commits_keeps_its_replacement_untouched() {
    let harness = Harness::create("replaced-before-commit");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let root = harness.workspace("project");
    let validated = registry.register_with_receipt(&root).expect("open project");
    let label = validated
        .descriptor
        .canonical_root_path
        .to_string_lossy()
        .into_owned();
    let mut trust =
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
    trust.set(&label, true).expect("trust project");
    let trust = Mutex::new(trust);
    let lease = revocation_lease(&registry, &tab_identity(&validated)).expect("validated tab");
    harness.retire_registration(&validated.descriptor);
    let replacement = registry.register_with_receipt(&root).expect("reopen project");
    assert_ne!(
        replacement.descriptor.workspace_id,
        validated.descriptor.workspace_id
    );
    let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
        ShellHostSpawner::default(),
    )));
    harness.app.manage(Arc::clone(&hosts));
    let replacement_root = &replacement.descriptor.canonical_root_path;
    let host = shell_host_for(&hosts, replacement_root, replacement_root).expect("host");
    let pids = ShellHostPids::of(&host);
    harness.start_running_turn("agt-replacement", &replacement.descriptor);
    let sessions =
        harness.start_claude_session_turn("agt-replacement-claude", &replacement.descriptor);

    let refusal = revoke_leased_project(harness.app.handle(), &trust, &lease)
        .err()
        .map(|error| (error.kind(), error.to_string()));

    assert_eq!(
        refusal,
        Some((
            std::io::ErrorKind::InvalidInput,
            OPENED_PROJECT_REVOCATION_IDENTITY_ERROR.to_string()
        ))
    );
    assert!(trust.lock().expect("trust lock").get(&label).trusted);
    for task_id in ["agt-replacement", "agt-replacement-claude"] {
        assert!(harness.sink.terminal(task_id).is_none());
    }
    assert!(sessions.ended.lock().expect("ended lock").is_empty());
    assert!(host.is_ready());
    assert!(pids.alive());
    for task_id in ["agt-replacement", "agt-replacement-claude"] {
        harness.stop_and_settle(task_id);
    }
    hosts.drain_for_dispose();
    assert!(pids.gone_within_deadline());
}

#[test]
fn trust_off_in_a_tab_of_a_root_whose_name_normalizes_revokes_both_records_and_stops_its_work() {
    for name in ["trailing space ", " leading space", "back\\slash"] {
        let harness = Harness::create("normalizing-root-name");
        let registry = harness.app.state::<WorkspaceRegistry>();
        let opened = registry
            .register_with_receipt(harness.workspace(name))
            .expect("open project");
        let exact_root = opened.descriptor.canonical_root_path.clone();
        let exact = exact_root.to_string_lossy().into_owned();
        let mut trust =
            WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust");
        assert!(trust.grant_opened_canonical_root(&exact).expect("opened grant").trusted);
        trust.set(&exact, true).expect("path grant");
        let admitted_under = PathBuf::from(trust.snapshot(&exact).root_path);
        let trust = Mutex::new(trust);
        let hosts = Arc::new(CodexAppServerHostRegistry::new(Arc::new(
            ShellHostSpawner::default(),
        )));
        harness.app.manage(Arc::clone(&hosts));
        let host = shell_host_for(&hosts, &exact_root, &exact_root).expect("host");
        let pids = ShellHostPids::of(&host);
        harness.start_running_turn_admitted_under("agt-admitted", &opened.descriptor, &admitted_under);
        harness.start_running_turn("agt-exact", &opened.descriptor);

        let revocation = revoke_opened_project(
            harness.app.handle(),
            &trust,
            &registry,
            &tab_identity(&opened),
        )
        .expect("revoke trust");

        assert_eq!(revocation.state.root_path, exact, "{name}");
        assert_eq!(revocation.runtime_root.as_deref(), Some(exact_root.as_path()));
        for task_id in ["agt-admitted", "agt-exact"] {
            assert!(
                stopped_for_revoked_trust(harness.sink.settled(task_id)),
                "{name}: {task_id}"
            );
        }
        assert!(!host.is_ready(), "{name}");
        assert!(pids.gone_within_deadline(), "{name}");
        drop(trust);
        let reloaded =
            WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("reload");
        assert!(!reloaded.snapshot_canonical(&exact).trusted, "{name}");
        assert!(!reloaded.get(&exact).trusted, "{name}");
    }
}

#[test]
fn revoking_an_existing_root_by_path_stops_runtimes_at_its_real_path() {
    for name in ["trailing space ", "back\\slash", "plain"] {
        let harness = Harness::create("path-runtime-root");
        let registry = harness.app.state::<WorkspaceRegistry>();
        let unregistered = harness
            .workspace(&format!("unregistered {name}"))
            .canonicalize()
            .expect("canonical unregistered root");
        let registered = registry
            .register_with_receipt(harness.workspace(&format!("registered {name}")))
            .expect("open project");
        let trust = Mutex::new(
            WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust"),
        );
        let revoke = |root: &Path| {
            revoke_path_trust_and_stop_agents(
                harness.app.handle(),
                &trust,
                &registry,
                &root.to_string_lossy(),
            )
            .expect("revoke trust")
        };

        let revocation = revoke(&unregistered);
        assert_eq!(revocation.runtime_root.as_deref(), Some(unregistered.as_path()));
        assert!(revocation.registered.is_none(), "{name}");

        let registered_root = &registered.descriptor.canonical_root_path;
        let revocation = revoke(registered_root);
        assert_eq!(
            revocation.runtime_root.as_deref(),
            Some(registered_root.as_path())
        );
        assert_eq!(
            revocation
                .registered
                .map(|descriptor| descriptor.workspace_id),
            Some(registered.descriptor.workspace_id.clone()),
            "{name}"
        );
    }
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
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
            .expect("revoke trust");

    assert_eq!(revocation.state.root_path, spelling);
    assert!(!revocation.state.trusted);
    assert!(revocation.registered.is_none());
    assert!(revocation.runtime_root.is_none());
    assert!(!trust.lock().expect("trust lock").get(&spelling).trusted);
    let persisted = WorkspaceTrustService::load(storage).expect("reload trust");
    assert!(!persisted.get(&spelling).trusted);
}

#[test]
fn an_unregistered_missing_root_is_the_runtime_root_only_in_its_stored_spelling() {
    let harness = Harness::create("missing-runtime-root");
    let registry = harness.app.state::<WorkspaceRegistry>();
    let trust = Mutex::new(
        WorkspaceTrustService::load(harness.fixture.join("trust.json")).expect("load trust"),
    );
    let stored = format!("{}/gone/repo", harness.fixture.display());

    let revoke = |spelling: &str| {
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, spelling)
            .expect("revoke trust")
            .runtime_root
    };

    assert_eq!(revoke(&stored).as_deref(), Some(Path::new(&stored)));
    for respelled in ["gone/./repo", "gone//repo"] {
        let spelling = format!("{}/{respelled}", harness.fixture.display());
        assert_eq!(Path::new(&spelling), Path::new(&stored));
        assert!(revoke(&spelling).is_none());
    }
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

    let refused =
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
            .err()
            .expect("revocation waits for the start boundary");

    assert_eq!(refused.kind(), std::io::ErrorKind::WouldBlock);
    assert!(trust.lock().expect("trust lock").get(&spelling).trusted);
    drop(launch);
    let revocation =
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &spelling)
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
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &collision)
            .err()
            .expect("revocation waits for the fallback start boundary");

    assert_eq!(refused.kind(), std::io::ErrorKind::WouldBlock);
    assert!(trust.lock().expect("trust lock").get(&collision).trusted);
    assert!(untouched());
    drop(launch);

    let revocation =
        revoke_path_trust_and_stop_agents(harness.app.handle(), &trust, &registry, &collision)
            .expect("revoke the fallback key");

    assert_eq!(revocation.state.root_path, collision);
    assert!(revocation.registered.is_none());
    let runtime_root = revocation.runtime_root.expect("fallback runtime root");
    assert_eq!(runtime_root, Path::new(&collision));
    assert_ne!(runtime_root, opened_root);
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
    tab: Option<OpenedProjectTrustRevocationTarget>,
    retarget: Option<(PathBuf, PathBuf)>,
    keeps_trusted: Option<String>,
}

impl RevokedKeyCase {
    fn by_path(name: &'static str, input: String) -> Self {
        Self {
            name,
            input,
            tab: None,
            retarget: None,
            keeps_trusted: None,
        }
    }

    fn in_tab(name: &'static str, input: &Path, tab: &WorkspaceRegistration) -> Self {
        Self {
            tab: Some(tab_identity(tab)),
            ..Self::by_path(name, input.to_string_lossy().into_owned())
        }
    }
}

fn revoked_key_cases(harness: &Harness) -> Vec<RevokedKeyCase> {
    let registry = harness.app.state::<WorkspaceRegistry>();
    let open = |path: PathBuf| registry.register_with_receipt(path).expect("open project");
    let alias_to = |alias: &str, target: &str| {
        let alias = harness.fixture.join(alias);
        std::os::unix::fs::symlink(harness.workspace(target), &alias).expect("alias");
        alias
    };
    let label = |path: &Path| path.to_string_lossy().into_owned();
    let fixture = harness.fixture.canonicalize().expect("canonical fixture");
    let canonical = open(harness.workspace("canonical"));
    let legacy = open(harness.workspace("legacy"));
    let alias = alias_to("alias", "aliased");
    let retargeted_alias = alias_to("retargeted-alias", "retargeted-from");
    open(harness.workspace("second-from"));
    let second_alias = alias_to("second-alias", "second-from");
    let collided = open(harness.workspace("collided"));
    vec![
        RevokedKeyCase::in_tab(
            "tab of a registered canonical path",
            &canonical.descriptor.canonical_root_path,
            &canonical,
        ),
        RevokedKeyCase::in_tab(
            "tab opened through a symlink",
            &alias,
            &open(alias.clone()),
        ),
        RevokedKeyCase {
            retarget: Some((retargeted_alias.clone(), harness.workspace("retargeted-to"))),
            ..RevokedKeyCase::in_tab(
                "tab opened through a symlink that is retargeted",
                &retargeted_alias,
                &open(retargeted_alias.clone()),
            )
        },
        RevokedKeyCase {
            retarget: Some((second_alias.clone(), harness.workspace("second-to"))),
            ..RevokedKeyCase::in_tab(
                "tab opened through a second alias that is retargeted",
                &second_alias,
                &open(second_alias.clone()),
            )
        },
        RevokedKeyCase::by_path(
            "registered canonical path without a tab identity",
            label(&legacy.descriptor.canonical_root_path),
        ),
        RevokedKeyCase::by_path(
            "unregistered existing path",
            label(&harness.workspace("unregistered")),
        ),
        RevokedKeyCase::by_path(
            "unregistered nonexistent canonical spelling",
            label(&fixture.join("gone/repo")),
        ),
        RevokedKeyCase::by_path(
            "unregistered nonexistent fallback spelling",
            label(&fixture.join("gone/./repo")),
        ),
        RevokedKeyCase {
            keeps_trusted: Some(label(&collided.descriptor.canonical_root_path)),
            ..RevokedKeyCase::by_path(
                "fallback spelling that collapses onto a registered root",
                label(&fixture.join("missing/../collided")),
            )
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

        let app = harness.app.handle();
        let revocation = match &case.tab {
            Some(tab) => revoke_opened_project(app, &trust, &registry, tab),
            None => revoke_path_trust_and_stop_agents(app, &trust, &registry, &case.input),
        }
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
fn trust_revocation_commands_revoke_and_stop_agents_through_one_identity() {
    let command = include_str!("workspace_trust_commands.rs");
    for composition in [
        "    let revocation = agent_trust_revocation::revoke_path_trust_and_stop_agents(\n        &app,\n        &service,\n        &workspace_registry,\n        &root_path,\n    )",
        "    let lease = opened_project::revocation_lease(registry, target)?;\n    revoke_leased_project(app, trust, &lease)",
        "    let revoked = opened_project::revoke_lease(lease, |root| {",
    ] {
        assert!(command.contains(composition), "missing: {composition}");
    }
    assert!(
        !command.contains(".set(&root_path, false)") && !command.contains(".set(&root_path, trusted)"),
        "trust revocation must not resolve the trust path a second time"
    );
}
