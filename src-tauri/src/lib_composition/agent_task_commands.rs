use super::{canonicalize_workspace_root, trusted_for, GitTrustState};
use crate::agent_task_admission::AgentTaskAdmissionRegistry;
use crate::agent_task_spawner::{plan_agent_invocation, AgentCliInvocation, AgentTaskSpawnPlan};
use crate::agent_task_supervisor::{
    AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent, AgentTaskRegistry,
    AgentTaskStartRequest as AgentTaskRegistryStartRequest, AgentTaskStartResult,
    AgentTaskStatusEvent, AGENT_TASK_OUTPUT_EVENT_CHANNEL, AGENT_TASK_STATUS_EVENT_CHANNEL,
};
use crate::git_worktree::{ensure_worktree_path_in_base, safe_agent_task_id};
use crate::run_blocking_command;
use crate::workspace_registry::WorkspaceId;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) const MAX_AGENT_TASK_WORKSPACE_ID_BYTES: usize = 1024;
pub(crate) const UNTRUSTED_AGENT_REPOSITORY_ERROR: &str =
    "Agent tasks require a trusted repository.";
pub(crate) const UNTRUSTED_AGENT_WORKTREE_ERROR: &str =
    "Agent tasks require a trusted agent worktree.";
pub(crate) const IN_PLACE_AGENT_CWD_ERROR: &str =
    "In-place agent tasks must run at the repository root.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartAgentTaskRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    repository_root: String,
    cwd: String,
    isolation: AgentTaskIsolation,
    prompt: String,
    agent_cli_path: String,
    agent_cli_kind: AgentCliInvocation,
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
}

fn prepare_agent_task_start(
    request: &StartAgentTaskRequest,
) -> Result<PreparedAgentTaskStart, String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let repository_root = canonicalize_workspace_root(&request.repository_root)?;
    let (cwd, worktree_path) = match request.isolation {
        AgentTaskIsolation::InPlace => {
            let cwd = canonicalize_workspace_root(&request.cwd)?;
            if cwd != repository_root {
                return Err(IN_PLACE_AGENT_CWD_ERROR.to_string());
            }
            (cwd, None)
        }
        AgentTaskIsolation::Worktree => {
            let cwd = ensure_worktree_path_in_base(&repository_root, Path::new(&request.cwd))?;
            (cwd.clone(), Some(cwd))
        }
    };
    let plan = plan_agent_invocation(
        &request.agent_cli_path,
        request.agent_cli_kind,
        &request.prompt,
        &cwd,
    )?;

    Ok(PreparedAgentTaskStart {
        request: AgentTaskRegistryStartRequest {
            task_id,
            workspace_id: request.workspace_id.as_str().to_string(),
            repository_root,
            isolation: request.isolation,
            worktree_path,
        },
        plan,
    })
}

#[tauri::command]
pub(crate) async fn start_agent_task(
    app: AppHandle,
    request: StartAgentTaskRequest,
    trust: GitTrustState<'_>,
    state: AgentTaskRuntimeState<'_>,
) -> Result<AgentTaskStartResult, String> {
    let repository_trusted = trusted_for(&trust, &request.repository_root)?;
    let cwd_trusted = trusted_for(&trust, &request.cwd)?;
    ensure_agent_task_trust(repository_trusted, cwd_trusted, request.isolation)?;
    let admission_registry = Arc::clone(&state.admission);
    run_blocking_command(move || {
        let prepared = prepare_agent_task_start(&request)?;
        let admission = admission_registry.reserve(
            &request.workspace_id,
            &prepared.request.repository_root,
            prepared.plan.cwd(),
            request.isolation,
        )?;
        app.state::<AgentTaskRegistry>()
            .start(prepared.request, prepared.plan, admission)
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
    state.registry.acknowledge(&task_id)
}

#[tauri::command]
pub(crate) fn stop_agent_task(
    request: AgentTaskReferenceRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    state.registry.stop(&task_id)
}

#[tauri::command]
pub(crate) fn stop_agent_tasks_for_root(
    request: StopAgentTasksForRootRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), String> {
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let root = canonicalize_workspace_root(&request.repository_root)?;
    state.registry.stop_for_root(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
            repository_root: workspace.root.to_string_lossy().into_owned(),
            cwd: cwd.to_string_lossy().into_owned(),
            isolation,
            prompt: "Fix the failing test.".to_string(),
            agent_cli_path: workspace.executable_cli().to_string_lossy().into_owned(),
            agent_cli_kind: AgentCliInvocation::ClaudeCode,
        }
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

        let error = prepare_agent_task_start(&request).expect_err("invalid task id");

        assert!(error.contains("task id"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_an_in_place_cwd_outside_the_repository_root() {
        let workspace = TempWorkspace::create("in-place-escape");
        let elsewhere = TempWorkspace::create("in-place-elsewhere");
        let request = start_request(&workspace, &elsewhere.root, AgentTaskIsolation::InPlace);

        let error = prepare_agent_task_start(&request).expect_err("cwd containment");

        assert_eq!(error, IN_PLACE_AGENT_CWD_ERROR);
    }

    #[test]
    fn prepare_rejects_a_worktree_cwd_outside_the_worktree_base() {
        let workspace = TempWorkspace::create("worktree-escape");
        workspace.worktree("agt-test-0001");
        let outside = workspace.root.join("src");
        fs::create_dir_all(&outside).expect("create outside directory");
        let request = start_request(&workspace, &outside, AgentTaskIsolation::Worktree);

        let error = prepare_agent_task_start(&request).expect_err("worktree containment");

        assert!(error.contains(".worktrees"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_an_oversized_workspace_id() {
        let workspace = TempWorkspace::create("workspace-id-bounds");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        request.workspace_id = workspace_id(&"w".repeat(MAX_AGENT_TASK_WORKSPACE_ID_BYTES + 1));

        let error = prepare_agent_task_start(&request).expect_err("workspace id bounds");

        assert!(error.contains("workspace id"), "got: {error}");
    }

    #[test]
    fn prepare_rejects_a_non_executable_cli_path() {
        let workspace = TempWorkspace::create("cli-not-executable");
        let mut request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);
        let plain = workspace.root.join("not-executable");
        fs::write(&plain, "data").expect("write plain file");
        request.agent_cli_path = plain.to_string_lossy().into_owned();

        let error = prepare_agent_task_start(&request).expect_err("non-executable cli");

        assert!(error.contains("executable"), "got: {error}");
    }

    #[test]
    fn prepare_builds_a_worktree_plan_with_the_closed_argv_template() {
        let workspace = TempWorkspace::create("worktree-plan");
        let worktree = workspace.worktree("agt-test-0001");
        let request = start_request(&workspace, &worktree, AgentTaskIsolation::Worktree);

        let prepared = prepare_agent_task_start(&request).expect("prepare start");

        assert_eq!(prepared.request.task_id, "agt-test-0001");
        assert_eq!(prepared.request.workspace_id, "workspace-1");
        assert_eq!(prepared.request.isolation, AgentTaskIsolation::Worktree);
        assert_eq!(
            prepared.request.worktree_path.as_deref(),
            Some(prepared.plan.cwd())
        );
        assert_eq!(
            prepared.plan.args(),
            ["-p".to_string(), "--".to_string(), request.prompt.clone()]
        );
    }

    #[test]
    fn prepare_builds_an_in_place_plan_without_a_worktree_path() {
        let workspace = TempWorkspace::create("in-place-plan");
        let request = start_request(&workspace, &workspace.root, AgentTaskIsolation::InPlace);

        let prepared = prepare_agent_task_start(&request).expect("prepare start");

        assert_eq!(prepared.request.worktree_path, None);
        assert_eq!(prepared.plan.cwd(), workspace.root.as_path());
    }
}
