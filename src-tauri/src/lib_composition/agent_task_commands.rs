use super::{canonicalize_workspace_root, trusted_for, workspace_root_for_disposal, GitTrustState};
use crate::agent_task_admission::AgentTaskAdmissionRegistry;
use crate::agent_task_spawner::agent_launch::{
    AgentLaunchOptions, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR,
};
use crate::agent_task_spawner::{plan_agent_invocation, AgentCliInvocation, AgentTaskSpawnPlan};
use crate::agent_task_supervisor::{
    AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent, AgentTaskRegistry,
    AgentTaskStartRequest as AgentTaskRegistryStartRequest, AgentTaskStartResult,
    AgentTaskStatusEvent, AGENT_TASK_OUTPUT_EVENT_CHANNEL, AGENT_TASK_STARTS_CLOSED_ERROR,
    AGENT_TASK_STATUS_EVENT_CHANNEL,
};
use crate::git_worktree::{ensure_worktree_path_in_base, safe_agent_task_id};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use agent_root_lease::AgentRootLeaseRegistry;
#[cfg(test)]
use agent_task_start_authority::revalidate_agent_task_project_authority;
use agent_task_start_authority::{
    capture_agent_task_project_authority, reserve_agent_task_trust, retained_root_matches_path,
    revalidate_agent_task_filesystem_authority, AgentTaskProjectAuthority,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[path = "../agent_root_lease.rs"]
pub(crate) mod agent_root_lease;
#[path = "agent_task_start_authority.rs"]
mod agent_task_start_authority;

pub(crate) const MAX_AGENT_TASK_WORKSPACE_ID_BYTES: usize = 1024;
pub(crate) const MAX_AGENT_TASK_PATH_BYTES: usize = 4096;
pub(crate) const MAX_AGENT_ROOT_LEASE_PATH_BYTES: usize = 4096;
pub(crate) const UNTRUSTED_AGENT_REPOSITORY_ERROR: &str =
    "Agent tasks require a trusted repository.";
pub(crate) const UNTRUSTED_AGENT_WORKTREE_ERROR: &str =
    "Agent tasks require a trusted agent worktree.";
pub(crate) const IN_PLACE_AGENT_CWD_ERROR: &str =
    "In-place agent tasks must run at the repository root.";
pub(crate) const UNKNOWN_AGENT_WORKSPACE_ERROR: &str =
    "Agent task workspace is not registered or its identity changed.";
pub(crate) const AGENT_PROJECT_ROOT_MISMATCH_ERROR: &str =
    "Agent project root does not match the registered workspace.";
pub(crate) const AGENT_REPOSITORY_CONTAINMENT_ERROR: &str =
    "Agent repository must be contained within the registered project root.";
pub(crate) const INVALID_AGENT_TASK_PATH_ERROR: &str =
    "Agent task paths must be bounded normalized absolute paths.";
pub(crate) const AGENT_WORKSPACE_START_BUSY_ERROR: &str =
    "Agent task workspace is closing or busy.";
pub(crate) const AGENT_TRUST_START_BUSY_ERROR: &str = "Agent task trust authority is busy.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartAgentTaskRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    project_root: String,
    repository_root: String,
    cwd: String,
    isolation: AgentTaskIsolation,
    prompt: String,
    agent_cli_path: String,
    agent_cli_kind: AgentCliInvocation,
    resume_session_id: Option<String>,
    launch: AgentLaunchOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentTaskReferenceRequest {
    task_id: String,
    workspace_id: WorkspaceId,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopAgentTasksForRootRequest {
    workspace_id: WorkspaceId,
    repository_root: String,
}

pub(crate) struct AppHandleAgentTaskEventSink {
    app: AppHandle,
}

impl AppHandleAgentTaskEventSink {
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl AgentTaskEventSink for AppHandleAgentTaskEventSink {
    fn status(&self, event: AgentTaskStatusEvent) {
        let _ = self.app.emit(AGENT_TASK_STATUS_EVENT_CHANNEL, event);
    }

    fn output(&self, event: AgentTaskOutputEvent) {
        let _ = self.app.emit(AGENT_TASK_OUTPUT_EVENT_CHANNEL, event);
    }
}

pub(crate) struct AgentTaskRuntimeState<'a> {
    registry: State<'a, AgentTaskRegistry>,
    admission: State<'a, Arc<AgentTaskAdmissionRegistry>>,
}

fn state_from_command<'r, 'de: 'r, T, R>(
    command: &tauri::ipc::CommandItem<'de, R>,
) -> Result<State<'r, T>, tauri::ipc::InvokeError>
where
    T: Send + Sync + 'static,
    R: tauri::Runtime,
{
    <State<'r, T> as tauri::ipc::CommandArg<'de, R>>::from_command(tauri::ipc::CommandItem {
        plugin: command.plugin,
        name: command.name,
        key: command.key,
        message: command.message,
        acl: command.acl,
    })
}

impl<'r, 'de: 'r, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for AgentTaskRuntimeState<'r> {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        Ok(Self {
            registry: state_from_command(&command)?,
            admission: state_from_command(&command)?,
        })
    }
}

fn ensure_workspace_id_bounds(workspace_id: &WorkspaceId) -> Result<(), String> {
    if workspace_id.as_str().is_empty() {
        return Err("Agent task workspace id is required.".to_string());
    }

    if workspace_id.as_str().len() > MAX_AGENT_TASK_WORKSPACE_ID_BYTES {
        return Err(format!(
            "Agent task workspace id must not exceed {MAX_AGENT_TASK_WORKSPACE_ID_BYTES} bytes."
        ));
    }

    Ok(())
}

fn ensure_agent_task_trust(
    repository_trusted: bool,
    cwd_trusted: bool,
    isolation: AgentTaskIsolation,
) -> Result<(), String> {
    if !repository_trusted {
        return Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string());
    }

    if isolation == AgentTaskIsolation::Worktree && !cwd_trusted {
        return Err(UNTRUSTED_AGENT_WORKTREE_ERROR.to_string());
    }

    Ok(())
}

#[derive(Debug)]
struct PreparedAgentTaskStart {
    request: AgentTaskRegistryStartRequest,
    plan: AgentTaskSpawnPlan,
    authority: AgentTaskProjectAuthority,
}

fn prepare_agent_task_start(
    request: &StartAgentTaskRequest,
    authority: AgentTaskProjectAuthority,
) -> Result<PreparedAgentTaskStart, String> {
    if !request.launch.matches(request.agent_cli_kind) {
        return Err(AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR.to_string());
    }
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let repository_root = authority.repository_root.clone();
    let cwd = authority.cwd.clone();
    let worktree_path = match request.isolation {
        AgentTaskIsolation::InPlace => {
            if cwd != repository_root {
                return Err(IN_PLACE_AGENT_CWD_ERROR.to_string());
            }
            None
        }
        AgentTaskIsolation::Worktree => {
            let verified_cwd = ensure_worktree_path_in_base(&repository_root, &cwd)?;
            if verified_cwd != cwd {
                return Err(AGENT_REPOSITORY_CONTAINMENT_ERROR.to_string());
            }
            Some(cwd.clone())
        }
    };
    let plan = plan_agent_invocation(
        &request.agent_cli_path,
        request.agent_cli_kind,
        &request.prompt,
        &cwd,
        request.resume_session_id.as_deref(),
        request.launch,
    )?
    .with_cwd_authority(Arc::clone(&authority.cwd_authority));

    Ok(PreparedAgentTaskStart {
        request: AgentTaskRegistryStartRequest {
            task_id,
            workspace_id: request.workspace_id.as_str().to_string(),
            repository_root,
            isolation: request.isolation,
            worktree_path,
        },
        plan,
        authority,
    })
}

#[tauri::command]
pub(crate) async fn start_agent_task(
    app: AppHandle,
    request: StartAgentTaskRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<AgentTaskStartResult, String> {
    let preparation_app = app.clone();
    let preparation_request = request.clone();
    let prepared = run_blocking_command(move || {
        let authority = capture_agent_task_project_authority(
            &preparation_app.state::<WorkspaceRegistry>(),
            &preparation_app.state::<Mutex<WorkspaceTrustService>>(),
            &preparation_request,
        )?;
        prepare_agent_task_start(&preparation_request, authority)
    })
    .await?;
    let admission_registry = Arc::clone(&state.admission);
    run_blocking_command(move || {
        let PreparedAgentTaskStart {
            request: registry_request,
            plan,
            authority,
        } = prepared;
        let workspace_registry = app.state::<WorkspaceRegistry>();
        let trust_state = app.state::<Mutex<WorkspaceTrustService>>();
        revalidate_agent_task_filesystem_authority(&workspace_registry, &request, &authority)?;
        let workspace_lease = workspace_registry
            .reserve_runtime_start(&request.workspace_id)
            .map_err(|_| AGENT_WORKSPACE_START_BUSY_ERROR.to_string())?;
        let trust_leases = reserve_agent_task_trust(&trust_state, &authority, request.isolation)?;
        if !retained_root_matches_path(&authority.project_authority, &authority.project_root)
            || !retained_root_matches_path(
                &authority.repository_authority,
                &authority.repository_root,
            )
            || !retained_root_matches_path(&authority.cwd_authority, &authority.cwd)
        {
            return Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string());
        }
        let admission = admission_registry.reserve(
            &request.workspace_id,
            &registry_request.repository_root,
            plan.cwd(),
            request.isolation,
        )?;
        let result = app
            .state::<AgentTaskRegistry>()
            .start(registry_request, plan, admission)
            .map_err(|error| {
                if error == AGENT_TASK_STARTS_CLOSED_ERROR {
                    return AGENT_WORKSPACE_START_BUSY_ERROR.to_string();
                }
                error
            });
        drop(trust_leases);
        drop(workspace_lease);
        result
    })
    .await
}

#[tauri::command]
pub(crate) fn acknowledge_agent_task_start(
    request: AgentTaskReferenceRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    state
        .registry
        .acknowledge_for_workspace(&task_id, request.workspace_id.as_str())
}

#[tauri::command]
pub(crate) fn stop_agent_task(
    request: AgentTaskReferenceRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    state
        .registry
        .stop_for_workspace(&task_id, request.workspace_id.as_str())
}

#[tauri::command]
pub(crate) fn stop_agent_tasks_for_root(
    request: StopAgentTasksForRootRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let root = canonicalize_workspace_root(&request.repository_root)?;
    state
        .registry
        .stop_for_workspace_root(request.workspace_id.as_str(), &root);
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentRootLeaseRequest {
    root_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentRootLeaseReleaseRequest {
    root_path: String,
    lease_token: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRootLeaseReceipt {
    lease_token: u64,
}

fn ensure_agent_root_lease_bounds(root_path: &str) -> Result<(), String> {
    if root_path.is_empty() {
        return Err("Agent project root path is required.".to_string());
    }

    if root_path.len() > MAX_AGENT_ROOT_LEASE_PATH_BYTES {
        return Err(format!(
            "Agent project root path must not exceed {MAX_AGENT_ROOT_LEASE_PATH_BYTES} bytes."
        ));
    }

    Ok(())
}

fn ensure_agent_root_lease_trust(root_trusted: bool) -> Result<(), String> {
    if !root_trusted {
        return Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn acquire_agent_root_lease(
    request: AgentRootLeaseRequest,
    trust: GitTrustState<'_>,
    leases: State<'_, Arc<AgentRootLeaseRegistry>>,
) -> Result<AgentRootLeaseReceipt, String> {
    ensure_agent_root_lease_bounds(&request.root_path)?;
    let root_trusted = trusted_for(&trust, &request.root_path)?;
    ensure_agent_root_lease_trust(root_trusted)?;
    let leases = Arc::clone(&leases);
    run_blocking_command(move || {
        let root = canonicalize_workspace_root(&request.root_path)?;
        let lease_token = leases.acquire(&root)?;

        Ok(AgentRootLeaseReceipt { lease_token })
    })
    .await
}

#[tauri::command]
pub(crate) fn release_agent_root_lease(
    request: AgentRootLeaseReleaseRequest,
    leases: State<'_, Arc<AgentRootLeaseRegistry>>,
) -> Result<(), String> {
    ensure_agent_root_lease_bounds(&request.root_path)?;
    let root = workspace_root_for_disposal(&request.root_path);
    leases.release(&root, request.lease_token);

    Ok(())
}

pub(crate) fn stop_agent_tasks_on_dispose(app: &AppHandle, root: &Path) {
    let leases = app.try_state::<Arc<AgentRootLeaseRegistry>>();
    let held = leases.as_ref().map(|state| state.inner().as_ref());
    if !agent_root_lease::dispose_should_stop_agent_tasks(held, root) {
        return;
    }

    let Some(agent_tasks) = app.try_state::<AgentTaskRegistry>() else {
        return;
    };

    agent_tasks.stop_for_root(root);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_task_spawner::agent_launch::{
        ClaudeEffortChoice, ClaudeModelChoice, ClaudePermissionMode, CodexExecutionMode,
        CodexModelChoice,
    };
    use crate::trust::WorkspaceTrustSnapshot;
    use crate::workspace_registry::{ManagedWorkspaceDescriptor, UnicodeNormalizationPolicy};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    struct TempWorkspace {
        root: PathBuf,
    }

    impl TempWorkspace {
        fn create(label: &str) -> Self {
            let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!(
                "agent-task-commands-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create temp workspace directory");
            Self {
                root: root.canonicalize().expect("canonical temp workspace root"),
            }
        }

        fn executable_cli(&self) -> PathBuf {
            let path = self.root.join("agent-cli");
            fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write fake agent cli");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                    .expect("mark fake agent cli executable");
            }
            path
        }

        fn worktree(&self, task_id: &str) -> PathBuf {
            let path = self.root.join(".worktrees").join(task_id);
            fs::create_dir_all(&path).expect("create worktree directory");
            path
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn workspace_id(value: &str) -> WorkspaceId {
        serde_json::from_str(&format!("\"{value}\"")).expect("deserialize workspace id")
    }

    fn start_request(
        workspace: &TempWorkspace,
        cwd: &Path,
        isolation: AgentTaskIsolation,
    ) -> StartAgentTaskRequest {
        StartAgentTaskRequest {
            task_id: "agt-test-0001".to_string(),
            workspace_id: workspace_id("workspace-1"),
            project_root: workspace.root.to_string_lossy().into_owned(),
            repository_root: workspace.root.to_string_lossy().into_owned(),
            cwd: cwd.to_string_lossy().into_owned(),
            isolation,
            prompt: "Fix the failing test.".to_string(),
            agent_cli_path: workspace.executable_cli().to_string_lossy().into_owned(),
            agent_cli_kind: AgentCliInvocation::ClaudeCode,
            resume_session_id: None,
            launch: AgentLaunchOptions::default(),
        }
    }

    fn test_authority(request: &StartAgentTaskRequest) -> AgentTaskProjectAuthority {
        let project_root = PathBuf::from(&request.project_root);
        let repository_root = PathBuf::from(&request.repository_root);
        let cwd = PathBuf::from(&request.cwd);
        let project_authority = Arc::new(std::fs::File::open("/").expect("open test authority"));
        let repository_authority = Arc::new(
            project_authority
                .try_clone()
                .expect("clone repository authority"),
        );
        let cwd_authority = Arc::new(project_authority.try_clone().expect("clone cwd authority"));
        let project_trust = WorkspaceTrustSnapshot {
            generation: 1,
            root_path: request.project_root.clone(),
            trusted: true,
        };
        let cwd_trust = WorkspaceTrustSnapshot {
            generation: 1,
            root_path: request.cwd.clone(),
            trusted: true,
        };
        AgentTaskProjectAuthority {
            descriptor: ManagedWorkspaceDescriptor {
                workspace_id: request.workspace_id.clone(),
                selected_root_path: project_root.clone(),
                canonical_root_path: project_root.clone(),
                case_sensitive: Some(true),
                unicode_normalization_policy: UnicodeNormalizationPolicy::Preserved,
            },
            project_root,
            repository_root,
            cwd,
            project_authority,
            repository_authority,
            cwd_authority,
            project_trust,
            cwd_trust,
        }
    }

    fn prepare_test_request(
        request: &StartAgentTaskRequest,
    ) -> Result<PreparedAgentTaskStart, String> {
        prepare_agent_task_start(request, test_authority(request))
    }

    fn registered_request(
        workspace: &TempWorkspace,
        repository_root: &Path,
    ) -> (
        WorkspaceRegistry,
        Mutex<WorkspaceTrustService>,
        StartAgentTaskRequest,
    ) {
        let registry = WorkspaceRegistry::new();
        let descriptor = registry
            .register(&workspace.root)
            .expect("register workspace");
        let mut trust = WorkspaceTrustService::load(workspace.root.join("trust.json"))
            .expect("load trust service");
        trust
            .set(
                descriptor
                    .canonical_root_path
                    .to_str()
                    .expect("UTF-8 workspace root"),
                true,
            )
            .expect("trust workspace");
        let mut request = start_request(workspace, repository_root, AgentTaskIsolation::InPlace);
        request.workspace_id = descriptor.workspace_id;
        request.project_root = descriptor
            .canonical_root_path
            .to_string_lossy()
            .into_owned();
        request.repository_root = repository_root.to_string_lossy().into_owned();
        request.cwd = repository_root.to_string_lossy().into_owned();
        (registry, Mutex::new(trust), request)
    }

    #[test]
    fn registered_nested_repository_uses_the_trusted_project_authority() {
        let workspace = TempWorkspace::create("nested-authority");
        let repository = workspace.root.join("packages/app");
        fs::create_dir_all(&repository).expect("create nested repository");
        let repository = repository
            .canonicalize()
            .expect("canonical nested repository");
        let (registry, trust, request) = registered_request(&workspace, &repository);

        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("authorize nested repository");

        assert_eq!(authority.project_root, workspace.root);
        assert_eq!(authority.repository_root, repository);
    }

    #[test]
    fn registered_root_repository_behavior_is_preserved() {
        let workspace = TempWorkspace::create("root-authority");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);

        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("authorize root repository");

        assert_eq!(authority.project_root, authority.repository_root);
    }

    #[test]
    fn agent_task_paths_are_strict_and_bounded_before_filesystem_work() {
        let workspace = TempWorkspace::create("path-contract");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);
        let invalid_paths = [
            String::new(),
            "relative/path".to_string(),
            workspace
                .root
                .join("nested/..")
                .to_string_lossy()
                .into_owned(),
            format!("{}\0suffix", workspace.root.to_string_lossy()),
            format!("/{}", "p".repeat(MAX_AGENT_TASK_PATH_BYTES)),
        ];

        for invalid_path in invalid_paths {
            let mut invalid_request = request.clone();
            invalid_request.project_root = invalid_path;
            let error = capture_agent_task_project_authority(&registry, &trust, &invalid_request)
                .expect_err("invalid project path");
            assert_eq!(error, INVALID_AGENT_TASK_PATH_ERROR);
        }

        let mut invalid_repository = request.clone();
        invalid_repository.repository_root = "relative/repository".to_string();
        let repository_error =
            capture_agent_task_project_authority(&registry, &trust, &invalid_repository)
                .expect_err("invalid repository path");
        let mut invalid_cwd = request;
        invalid_cwd.cwd = "relative/cwd".to_string();
        let cwd_error = capture_agent_task_project_authority(&registry, &trust, &invalid_cwd)
            .expect_err("invalid cwd path");

        assert_eq!(repository_error, INVALID_AGENT_TASK_PATH_ERROR);
        assert_eq!(cwd_error, INVALID_AGENT_TASK_PATH_ERROR);

        let poisoned_trust = Mutex::new(
            WorkspaceTrustService::load(workspace.root.join("poisoned-trust.json"))
                .expect("load trust service"),
        );
        let _ = std::panic::catch_unwind(|| {
            let _guard = poisoned_trust.lock().expect("trust lock");
            panic!("poison trust");
        });
        let mut invalid_before_trust = invalid_cwd;
        invalid_before_trust.project_root = String::new();
        let ordering_error =
            capture_agent_task_project_authority(&registry, &poisoned_trust, &invalid_before_trust)
                .expect_err("path validation precedes trust access");
        assert_eq!(ordering_error, INVALID_AGENT_TASK_PATH_ERROR);
    }

    #[test]
    fn untrusted_registered_project_is_rejected() {
        let workspace = TempWorkspace::create("untrusted-project");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry
            .register(&workspace.root)
            .expect("register workspace");
        let trust = Mutex::new(
            WorkspaceTrustService::load(workspace.root.join("trust.json"))
                .expect("load trust service"),
        );
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.workspace_id = descriptor.workspace_id;

        let error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("untrusted project");

        assert_eq!(error, UNTRUSTED_AGENT_REPOSITORY_ERROR);
    }

    #[test]
    fn foreign_and_traversing_project_roots_are_rejected() {
        let workspace = TempWorkspace::create("project-mismatch");
        let foreign = TempWorkspace::create("foreign-project");
        let (registry, trust, mut request) = registered_request(&workspace, &workspace.root);
        request.project_root = foreign.root.to_string_lossy().into_owned();
        let foreign_error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("foreign project root");
        request.project_root = workspace
            .root
            .join("nested/..")
            .to_string_lossy()
            .into_owned();
        let traversal_error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("traversing project root");

        assert_eq!(foreign_error, AGENT_PROJECT_ROOT_MISMATCH_ERROR);
        assert_eq!(traversal_error, INVALID_AGENT_TASK_PATH_ERROR);
    }

    #[test]
    fn repository_outside_the_registered_project_is_rejected() {
        let workspace = TempWorkspace::create("repository-containment");
        let foreign = TempWorkspace::create("foreign-repository");
        let (registry, trust, mut request) = registered_request(&workspace, &workspace.root);
        request.repository_root = foreign.root.to_string_lossy().into_owned();
        request.cwd = request.repository_root.clone();

        let foreign_error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("foreign repository");
        fs::create_dir_all(workspace.root.join("packages")).expect("create package directory");
        request.repository_root = workspace
            .root
            .join("packages/..")
            .to_string_lossy()
            .into_owned();
        request.cwd = request.repository_root.clone();
        let traversal_error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("traversing repository");

        assert_eq!(foreign_error, AGENT_REPOSITORY_CONTAINMENT_ERROR);
        assert_eq!(traversal_error, INVALID_AGENT_TASK_PATH_ERROR);
    }

    #[cfg(unix)]
    #[test]
    fn nested_repository_symlinks_and_replacements_fail_closed() {
        use std::os::unix::fs::symlink;

        let workspace = TempWorkspace::create("nested-repository-identity");
        let foreign = TempWorkspace::create("nested-repository-foreign");
        let nested = workspace.root.join("packages/app");
        fs::create_dir_all(&nested).expect("create nested repository");
        let nested = nested.canonicalize().expect("canonical nested repository");
        let (registry, trust, mut request) = registered_request(&workspace, &nested);
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture nested authority");
        let retained = workspace.root.join("packages/retained-app");
        fs::rename(&nested, &retained).expect("move nested repository");
        fs::create_dir_all(&nested).expect("replace nested repository");
        let replacement_error =
            revalidate_agent_task_project_authority(&registry, &trust, &request, &authority)
                .expect_err("replaced nested repository");

        let alias = workspace.root.join("packages/foreign-alias");
        symlink(&foreign.root, &alias).expect("create foreign repository alias");
        request.repository_root = alias.to_string_lossy().into_owned();
        request.cwd = request.repository_root.clone();
        let symlink_error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("symlink repository");

        assert_eq!(replacement_error, UNKNOWN_AGENT_WORKSPACE_ERROR);
        assert_eq!(symlink_error, AGENT_REPOSITORY_CONTAINMENT_ERROR);
    }

    #[test]
    fn replaced_worktree_cwd_invalidates_the_prepared_authority() {
        let workspace = TempWorkspace::create("worktree-cwd-identity");
        let worktree = workspace.worktree("agt-test-0001");
        let retained = workspace.root.join(".worktrees/retained");
        let (registry, trust, mut request) = registered_request(&workspace, &workspace.root);
        request.isolation = AgentTaskIsolation::Worktree;
        request.cwd = worktree.to_string_lossy().into_owned();
        trust
            .lock()
            .expect("trust lock")
            .set(&request.cwd, true)
            .expect("trust worktree");
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture worktree authority");
        fs::rename(&worktree, &retained).expect("move worktree");
        fs::create_dir_all(&worktree).expect("replace worktree");

        let error =
            revalidate_agent_task_project_authority(&registry, &trust, &request, &authority)
                .expect_err("replaced worktree");

        assert_eq!(error, UNKNOWN_AGENT_WORKSPACE_ERROR);
    }

    #[cfg(unix)]
    #[test]
    fn unregistered_symlink_alias_is_rejected_as_project_authority() {
        use std::os::unix::fs::symlink;

        let workspace = TempWorkspace::create("project-symlink");
        let alias_parent = TempWorkspace::create("project-symlink-alias");
        let alias = alias_parent.root.join("alias");
        symlink(&workspace.root, &alias).expect("create project alias");
        let (registry, trust, mut request) = registered_request(&workspace, &workspace.root);
        request.project_root = alias.to_string_lossy().into_owned();

        let error = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect_err("unregistered project alias");

        assert_eq!(error, AGENT_PROJECT_ROOT_MISMATCH_ERROR);
    }

    #[cfg(unix)]
    #[test]
    fn registered_selected_alias_retains_its_project_trust_authority() {
        use std::os::unix::fs::symlink;

        let workspace = TempWorkspace::create("selected-project-alias");
        let alias_parent = TempWorkspace::create("selected-project-alias-parent");
        let alias = alias_parent.root.join("alias");
        symlink(&workspace.root, &alias).expect("create selected alias");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&alias).expect("register selected alias");
        let mut trust = WorkspaceTrustService::load(workspace.root.join("trust.json"))
            .expect("load trust service");
        trust
            .set(alias.to_str().expect("UTF-8 alias"), true)
            .expect("trust selected alias");
        let trust = Mutex::new(trust);
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.workspace_id = descriptor.workspace_id;
        request.project_root = alias.to_string_lossy().into_owned();

        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("authorize registered selected alias");

        assert_eq!(authority.project_root, workspace.root);
        assert!(authority.project_trust.trusted);
    }

    #[test]
    fn trust_revocation_invalidates_the_prepared_authority() {
        let workspace = TempWorkspace::create("trust-revocation");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture authority");
        trust
            .lock()
            .expect("trust lock")
            .set(&request.project_root, false)
            .expect("revoke trust");

        let error =
            revalidate_agent_task_project_authority(&registry, &trust, &request, &authority)
                .expect_err("revoked authority");

        assert_eq!(error, UNTRUSTED_AGENT_REPOSITORY_ERROR);
    }

    #[test]
    fn trust_revocation_cannot_commit_during_the_start_boundary() {
        use std::thread;

        let workspace = TempWorkspace::create("trust-start-boundary");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);
        let trust = Arc::new(trust);
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture authority");
        revalidate_agent_task_filesystem_authority(&registry, &request, &authority)
            .expect("revalidate filesystem authority");
        let leases = reserve_agent_task_trust(&trust, &authority, request.isolation)
            .expect("reserve trust launch");
        let revoker_trust = Arc::clone(&trust);
        let project_root = request.project_root.clone();
        let revoker = thread::spawn(move || {
            revoker_trust
                .lock()
                .expect("revoker trust lock")
                .set(&project_root, false)
                .expect_err("launch lease blocks revoke")
        });

        let revoke_error = revoker.join().expect("join revoker");

        assert_eq!(revoke_error.kind(), std::io::ErrorKind::WouldBlock);
        drop(leases);
        assert!(
            !trust
                .lock()
                .expect("trust lock")
                .set(&request.project_root, false)
                .expect("revoke after launch")
                .trusted
        );
    }

    #[test]
    fn removed_workspace_invalidates_the_prepared_authority() {
        let workspace = TempWorkspace::create("removed-workspace");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture authority");
        registry.clear();

        let error =
            revalidate_agent_task_project_authority(&registry, &trust, &request, &authority)
                .expect_err("removed workspace");

        assert_eq!(error, UNKNOWN_AGENT_WORKSPACE_ERROR);
    }

    #[cfg(unix)]
    #[test]
    fn replaced_workspace_path_invalidates_the_retained_descriptor() {
        let workspace = TempWorkspace::create("replaced-workspace");
        let moved_root = workspace.root.with_extension("retained");
        let (registry, trust, request) = registered_request(&workspace, &workspace.root);
        let authority = capture_agent_task_project_authority(&registry, &trust, &request)
            .expect("capture authority");
        fs::rename(&workspace.root, &moved_root).expect("move registered workspace");
        fs::create_dir_all(&workspace.root).expect("replace workspace path");

        let error =
            revalidate_agent_task_project_authority(&registry, &trust, &request, &authority)
                .expect_err("replaced workspace path");

        assert!(
            error == UNKNOWN_AGENT_WORKSPACE_ERROR || error == AGENT_PROJECT_ROOT_MISMATCH_ERROR,
            "got: {error}"
        );
        fs::remove_dir_all(&moved_root).expect("remove retained workspace fixture");
    }

    #[test]
    fn untrusted_repository_is_rejected() {
        let error = ensure_agent_task_trust(false, true, AgentTaskIsolation::InPlace)
            .expect_err("untrusted repository must be rejected");

        assert_eq!(error, UNTRUSTED_AGENT_REPOSITORY_ERROR);
    }

    #[test]
    fn worktree_isolation_requires_a_trusted_cwd() {
        let error = ensure_agent_task_trust(true, false, AgentTaskIsolation::Worktree)
            .expect_err("untrusted worktree cwd must be rejected");

        assert_eq!(error, UNTRUSTED_AGENT_WORKTREE_ERROR);
        ensure_agent_task_trust(true, false, AgentTaskIsolation::InPlace)
            .expect("in-place trust follows the repository");
    }

    #[test]
    fn start_command_rejects_an_untrusted_repository_before_planning() {
        let workspace = TempWorkspace::create("start-untrusted");
        let request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);

        let repository_trusted = false;
        let error = ensure_agent_task_trust(repository_trusted, false, request.isolation)
            .expect_err("trust gate must run before planning");

        assert_eq!(error, UNTRUSTED_AGENT_REPOSITORY_ERROR);
    }

    #[test]
    fn prepare_rejects_an_invalid_task_id() {
        let workspace = TempWorkspace::create("bad-id");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.task_id = "Bad--Id".to_string();

        let error = prepare_test_request(&request).expect_err("invalid task id");

        assert!(error.contains("task id"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_an_in_place_cwd_outside_the_repository_root() {
        let workspace = TempWorkspace::create("in-place-escape");
        let elsewhere = TempWorkspace::create("in-place-elsewhere");
        let request = start_request(&workspace, &elsewhere.root, AgentTaskIsolation::InPlace);

        let error = prepare_test_request(&request).expect_err("cwd containment");

        assert_eq!(error, IN_PLACE_AGENT_CWD_ERROR);
    }

    #[test]
    fn prepare_rejects_a_worktree_cwd_outside_the_worktree_base() {
        let workspace = TempWorkspace::create("worktree-escape");
        workspace.worktree("agt-test-0001");
        let outside = workspace.root.join("src");
        fs::create_dir_all(&outside).expect("create outside directory");
        let request = start_request(&workspace, &outside, AgentTaskIsolation::Worktree);

        let error = prepare_test_request(&request).expect_err("worktree containment");

        assert!(error.contains(".worktrees"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_an_oversized_workspace_id() {
        let workspace = TempWorkspace::create("workspace-id-bounds");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.workspace_id = workspace_id(&"w".repeat(MAX_AGENT_TASK_WORKSPACE_ID_BYTES + 1));

        let error = prepare_test_request(&request).expect_err("workspace id bounds");

        assert!(error.contains("workspace id"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_a_non_executable_cli_path() {
        let workspace = TempWorkspace::create("cli-not-executable");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        let plain = workspace.root.join("not-executable");
        fs::write(&plain, "data").expect("write plain file");
        request.agent_cli_path = plain.to_string_lossy().into_owned();

        let error = prepare_test_request(&request).expect_err("non-executable cli");

        assert!(error.contains("executable"), "got: {error}");
    }

    #[test]
    fn prepare_builds_a_worktree_plan_with_the_closed_argv_template() {
        let workspace = TempWorkspace::create("worktree-plan");
        let worktree = workspace.worktree("agt-test-0001");
        let request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);

        let prepared = prepare_test_request(&request).expect("prepare start");

        assert_eq!(prepared.request.task_id, "agt-test-0001");
        assert_eq!(prepared.request.workspace_id, "workspace-1");
        assert_eq!(prepared.request.isolation, AgentTaskIsolation::Worktree);
        assert_eq!(
            prepared.request.worktree_path.as_deref(),
            Some(prepared.plan.cwd())
        );
        assert_eq!(
            prepared.plan.args(),
            [
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--".to_string(),
                request.prompt.clone()
            ]
        );
    }

    #[test]
    fn prepare_rejects_launch_options_from_another_provider() {
        let workspace = TempWorkspace::create("launch-mismatch");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.launch = AgentLaunchOptions::Codex {
            model: CodexModelChoice::Gpt55,
            mode: CodexExecutionMode::ReadOnly,
        };

        let error = prepare_test_request(&request).expect_err("cross-provider launch");

        assert_eq!(error, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);
    }

    #[test]
    fn prepare_rejects_a_provider_mismatch_before_any_path_or_process_work() {
        let workspace = TempWorkspace::create("launch-mismatch-early");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.task_id = "Bad--Id".to_string();
        request.repository_root = "/nonexistent/repository/root".to_string();
        request.cwd = "/nonexistent/repository/root".to_string();
        request.agent_cli_path = "/nonexistent/agent-cli".to_string();
        request.launch = AgentLaunchOptions::Codex {
            model: CodexModelChoice::Default,
            mode: CodexExecutionMode::Default,
        };

        let error = prepare_test_request(&request).expect_err("cross-provider launch");

        assert_eq!(error, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);
    }

    #[test]
    fn prepare_rejects_a_claude_launch_on_a_codex_cli_kind() {
        let workspace = TempWorkspace::create("launch-mismatch-reversed");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.agent_cli_kind = AgentCliInvocation::CodexExec;

        let error = prepare_test_request(&request).expect_err("cross-provider launch");

        assert_eq!(error, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);
    }

    #[test]
    fn prepare_forwards_the_codex_resume_sandbox_override_into_the_argv() {
        let workspace = TempWorkspace::create("codex-resume-plan");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.agent_cli_kind = AgentCliInvocation::CodexExec;
        request.launch = AgentLaunchOptions::Codex {
            model: CodexModelChoice::Gpt56Sol,
            mode: CodexExecutionMode::ReadOnly,
        };
        request.resume_session_id = Some("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string());

        let prepared = prepare_test_request(&request).expect("prepare resumed codex start");

        assert_eq!(
            prepared.plan.args(),
            [
                "exec".to_string(),
                "resume".to_string(),
                "--json".to_string(),
                "-m".to_string(),
                "gpt-5.6-sol".to_string(),
                "-c".to_string(),
                "sandbox_mode=\"read-only\"".to_string(),
                "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string(),
                "--".to_string(),
                request.prompt.clone()
            ]
        );
    }

    #[test]
    fn a_dangerous_launch_still_depends_on_the_repository_trust_gate() {
        let workspace = TempWorkspace::create("dangerous-launch");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.launch = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Default,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::Default,
        };

        let refused = ensure_agent_task_trust(false, false, request.isolation)
            .expect_err("dangerous launches need a trusted repository");
        let prepared = prepare_test_request(&request).expect("prepare dangerous start");

        assert_eq!(refused, UNTRUSTED_AGENT_REPOSITORY_ERROR);
        assert!(prepared
            .plan
            .args()
            .contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn the_start_request_contract_has_no_dangerous_launch_confirmation_field() {
        let dangerous = r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","projectRoot":"/repo","repositoryRoot":"/repo","cwd":"/repo","isolation":"in-place","prompt":"do it","agentCliPath":"/bin/cli","agentCliKind":"codex","resumeSessionId":null,"launch":{"provider":"codex","model":"gpt-5.6-sol","mode":"dangerFullAccess"}}"#;
        let parsed: StartAgentTaskRequest =
            serde_json::from_str(dangerous).expect("dangerous request parses");
        assert_eq!(
            parsed.launch,
            AgentLaunchOptions::Codex {
                model: CodexModelChoice::Gpt56Sol,
                mode: CodexExecutionMode::DangerFullAccess,
            }
        );
        assert_eq!(parsed.agent_cli_kind, AgentCliInvocation::CodexExec);

        let with_confirmation = dangerous.replace(
            "\"resumeSessionId\":null",
            "\"resumeSessionId\":null,\"dangerousLaunchConfirmed\":true",
        );
        assert!(
            serde_json::from_str::<StartAgentTaskRequest>(&with_confirmation).is_err(),
            "the confirmation lives in the composer, never on the wire"
        );

        let snake_case = dangerous.replace("agentCliKind", "agent_cli_kind");
        assert!(serde_json::from_str::<StartAgentTaskRequest>(&snake_case).is_err());
    }

    #[test]
    fn prepare_forwards_the_launch_flags_into_the_argv() {
        let workspace = TempWorkspace::create("launch-plan");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.launch = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Sonnet,
            mode: ClaudePermissionMode::AcceptEdits,
            effort: ClaudeEffortChoice::High,
        };

        let prepared = prepare_test_request(&request).expect("prepare launch start");

        assert_eq!(
            prepared.plan.args(),
            [
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--model".to_string(),
                "sonnet".to_string(),
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
                "--effort".to_string(),
                "high".to_string(),
                "--".to_string(),
                request.prompt.clone()
            ]
        );
    }

    #[test]
    fn the_start_request_contract_requires_a_launch_and_rejects_unknown_fields() {
        let complete = r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","projectRoot":"/repo","repositoryRoot":"/repo","cwd":"/repo","isolation":"in-place","prompt":"do it","agentCliPath":"/bin/cli","agentCliKind":"claudeCode","resumeSessionId":null,"launch":{"provider":"claudeCode","model":"opus","mode":"plan"}}"#;
        let parsed: StartAgentTaskRequest =
            serde_json::from_str(complete).expect("complete request parses");
        assert_eq!(
            parsed.launch,
            AgentLaunchOptions::ClaudeCode {
                model: ClaudeModelChoice::Opus,
                mode: ClaudePermissionMode::Plan,
                effort: ClaudeEffortChoice::Default,
            }
        );

        let missing_launch = r#"{"taskId":"agt-test-0001","workspaceId":"workspace-1","projectRoot":"/repo","repositoryRoot":"/repo","cwd":"/repo","isolation":"in-place","prompt":"do it","agentCliPath":"/bin/cli","agentCliKind":"claudeCode","resumeSessionId":null}"#;
        assert!(serde_json::from_str::<StartAgentTaskRequest>(missing_launch).is_err());

        let missing_project_root = complete.replace("\"projectRoot\":\"/repo\",", "");
        assert!(serde_json::from_str::<StartAgentTaskRequest>(&missing_project_root).is_err());

        let unknown_model = complete.replace("\"opus\"", "\"claude-opus-4\"");
        assert!(serde_json::from_str::<StartAgentTaskRequest>(&unknown_model).is_err());
    }

    #[test]
    fn prepare_forwards_a_validated_resume_session_id_to_the_argv() {
        let workspace = TempWorkspace::create("resume-plan");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.resume_session_id = Some("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string());

        let prepared = prepare_test_request(&request).expect("prepare resumed start");

        assert_eq!(
            prepared.plan.args(),
            [
                "-p".to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--resume".to_string(),
                "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b".to_string(),
                "--".to_string(),
                request.prompt.clone()
            ]
        );
    }

    #[test]
    fn prepare_rejects_a_flag_like_resume_session_id() {
        let workspace = TempWorkspace::create("resume-flag");
        let worktree = workspace.worktree("agt-test-0001");
        let mut request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);
        request.resume_session_id = Some("--dangerously-skip-permissions".to_string());

        let error = prepare_test_request(&request).expect_err("flag-like resume id");

        assert!(error.contains("session id"), "got: {error}");
    }

    #[test]
    fn start_requests_reject_unknown_fields_and_accept_a_null_resume_session_id() {
        let unknown = serde_json::from_str::<StartAgentTaskRequest>(
            "{\"taskId\":\"agt-test-0001\",\"workspaceId\":\"w\",\"projectRoot\":\"/r\",\"repositoryRoot\":\"/r\",\"cwd\":\"/r\",\"isolation\":\"in-place\",\"prompt\":\"p\",\"agentCliPath\":\"/bin/agent\",\"agentCliKind\":\"claudeCode\",\"resumeSessionId\":null,\"launch\":{\"provider\":\"claudeCode\",\"model\":\"default\",\"mode\":\"default\"},\"extra\":1}",
        );
        let accepted = serde_json::from_str::<StartAgentTaskRequest>(
            "{\"taskId\":\"agt-test-0001\",\"workspaceId\":\"w\",\"projectRoot\":\"/r\",\"repositoryRoot\":\"/r\",\"cwd\":\"/r\",\"isolation\":\"in-place\",\"prompt\":\"p\",\"agentCliPath\":\"/bin/agent\",\"agentCliKind\":\"claudeCode\",\"resumeSessionId\":null,\"launch\":{\"provider\":\"claudeCode\",\"model\":\"default\",\"mode\":\"default\"}}",
        )
        .expect("deserialize start request");

        assert!(unknown.is_err(), "unknown start field must be rejected");
        assert_eq!(accepted.resume_session_id, None);
    }

    #[test]
    fn untrusted_agent_root_lease_is_refused() {
        let error = ensure_agent_root_lease_trust(false).expect_err("untrusted root must refuse");

        assert_eq!(error, UNTRUSTED_AGENT_REPOSITORY_ERROR);
        ensure_agent_root_lease_trust(true).expect("trusted root is leasable");
    }

    #[test]
    fn agent_root_lease_path_bounds_are_enforced() {
        let empty = ensure_agent_root_lease_bounds("").expect_err("empty root path");
        let oversized =
            ensure_agent_root_lease_bounds(&"p".repeat(MAX_AGENT_ROOT_LEASE_PATH_BYTES + 1))
                .expect_err("oversized root path");

        assert!(empty.contains("required"), "got: {empty}");
        assert!(oversized.contains("bytes"), "got: {oversized}");
        ensure_agent_root_lease_bounds("/workspace/alpha").expect("bounded root path");
    }

    #[test]
    fn agent_root_lease_requests_reject_unknown_fields() {
        let acquire = serde_json::from_str::<AgentRootLeaseRequest>(
            "{\"rootPath\":\"/workspace/alpha\",\"extra\":1}",
        );
        let release = serde_json::from_str::<AgentRootLeaseReleaseRequest>(
            "{\"rootPath\":\"/workspace/alpha\",\"leaseToken\":1,\"extra\":1}",
        );

        assert!(acquire.is_err(), "unknown acquire field must be rejected");
        assert!(release.is_err(), "unknown release field must be rejected");
    }

    #[test]
    fn agent_root_lease_wire_shape_is_camel_case() {
        let request = serde_json::from_str::<AgentRootLeaseReleaseRequest>(
            "{\"rootPath\":\"/workspace/alpha\",\"leaseToken\":7}",
        )
        .expect("deserialize release request");
        let receipt = serde_json::to_string(&AgentRootLeaseReceipt { lease_token: 7 })
            .expect("serialize receipt");

        assert_eq!(request.root_path, "/workspace/alpha");
        assert_eq!(request.lease_token, 7);
        assert_eq!(receipt, "{\"leaseToken\":7}");
    }

    #[cfg(unix)]
    #[test]
    fn acquire_and_release_converge_on_symlink_aliases() {
        let workspace = TempWorkspace::create("lease-alias");
        let real = workspace.root.join("real");
        let alias = workspace.root.join("alias");
        fs::create_dir_all(&real).expect("create real root");
        std::os::unix::fs::symlink(&real, &alias).expect("create alias symlink");
        let registry = AgentRootLeaseRegistry::new();

        let canonical = canonicalize_workspace_root(&alias.to_string_lossy()).expect("canonical");
        let token = registry.acquire(&canonical).expect("acquire via alias");

        assert!(registry.is_held(&real));

        let release_root = workspace_root_for_disposal(&alias.to_string_lossy());

        assert!(registry.release(&release_root, token));
        assert!(!registry.is_held(&real));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn private_var_alias_resolves_to_one_lease() {
        let aliased = Path::new("/var/tmp");
        let Ok(canonical) = aliased.canonicalize() else {
            return;
        };
        let registry = AgentRootLeaseRegistry::new();

        let first = registry
            .acquire(&canonicalize_workspace_root("/var/tmp").expect("canonical /var/tmp"))
            .expect("acquire via /var");
        let second = registry
            .acquire(&canonicalize_workspace_root(&canonical.to_string_lossy()).expect("canonical"))
            .expect("acquire via /private/var");

        assert_eq!(first, second);
        assert_eq!(registry.held_root_count(), 1);
        assert!(registry.release(&workspace_root_for_disposal("/var/tmp"), first));
    }

    #[test]
    fn dispose_guard_defers_to_a_held_lease() {
        let workspace = TempWorkspace::create("lease-dispose-guard");
        let registry = AgentRootLeaseRegistry::new();
        let token = registry.acquire(&workspace.root).expect("acquire");

        assert!(!agent_root_lease::dispose_should_stop_agent_tasks(
            Some(&registry),
            &workspace.root
        ));

        registry.release(&workspace.root, token);

        assert!(agent_root_lease::dispose_should_stop_agent_tasks(
            Some(&registry),
            &workspace.root
        ));
    }

    #[test]
    fn prepare_builds_an_in_place_plan_without_a_worktree_path() {
        let workspace = TempWorkspace::create("in-place-plan");
        let request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);

        let prepared = prepare_test_request(&request).expect("prepare start");

        assert_eq!(prepared.request.worktree_path, None);
        assert_eq!(prepared.plan.cwd(), workspace.root.as_path());
    }
}
