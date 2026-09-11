use super::agent_attachment_commands::agent_attachment_store::{
    agent_attachment_image::agent_image_media_type, prompt_line, AgentAttachmentKind,
    AgentAttachmentOwner, AgentAttachmentStore, ResolvedTurnAttachment,
};
use super::agent_attachment_commands::agent_thread_store::{
    MAX_AGENT_ATTACHMENT_NAME_BYTES, MAX_AGENT_ATTACHMENT_PATH_BYTES, MAX_AGENT_TURN_ATTACHMENTS,
};
use super::{canonicalize_workspace_root, trusted_for, workspace_root_for_disposal, GitTrustState};
use crate::agent_task_admission::AgentTaskAdmissionRegistry;
use crate::agent_task_spawner::agent_launch::{
    AgentLaunchOptions, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR,
};
use crate::agent_task_spawner::agent_provider::process::ExecutableIdentity;
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderRuntimeRegistry, ProviderTurnLease,
};
use crate::agent_task_spawner::{
    plan_agent_invocation_with_authority, AgentCliInvocation, AgentImageAttachment,
    AgentInvocationRequest, AgentTaskSpawnPlan, AGENT_TURN_IMAGE_BUDGET_ERROR,
    MAX_AGENT_TURN_IMAGE_BYTES,
};
use crate::agent_task_supervisor::{
    AgentTaskEventSink, AgentTaskIsolation, AgentTaskOutputEvent, AgentTaskRegistry,
    AgentTaskStartRequest as AgentTaskRegistryStartRequest, AgentTaskStartResult,
    AgentTaskStatusEvent, AGENT_TASK_OUTPUT_EVENT_CHANNEL, AGENT_TASK_STARTS_CLOSED_ERROR,
    AGENT_TASK_STATUS_EVENT_CHANNEL,
};
use crate::effective_executable_environment::EffectiveExecutablePath;
use crate::git_worktree::{ensure_worktree_path_in_base, safe_agent_task_id};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use agent_root_lease::{
    AgentRootLeaseRegistry, AgentRootLeaseReleaseDisposition, RegisteredAgentRootLease,
    MAX_AGENT_ROOT_LEASE_TOKEN,
};
use agent_root_workspace_registration::{
    acquire_registered_workspace_lease, release_registered_workspace_lease,
};
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
#[path = "agent_root_workspace_registration.rs"]
mod agent_root_workspace_registration;
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
pub(crate) const AGENT_PROMPT_ATTACHMENT_MISMATCH_ERROR: &str =
    "Agent prompt does not match its attachments.";
pub(crate) const AGENT_ATTACHMENT_REFERENCE_ERROR: &str =
    "Agent attachment references must carry a bounded name and absolute path.";

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
    agent_cli_kind: AgentCliInvocation,
    resume_session_id: Option<String>,
    launch: AgentLaunchOptions,
    provider_generation: u64,
    thread_id: String,
    #[serde(default)]
    attachments: Vec<StartAgentTaskAttachment>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum StartAgentTaskAttachment {
    #[serde(rename_all = "camelCase")]
    Staged { attachment_id: String },
    #[serde(rename_all = "camelCase")]
    Reference { name: String, path: String },
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
    claimed_attachment_ids: Vec<String>,
}

fn acquire_agent_task_provider_authority(
    registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &StartAgentTaskRequest,
) -> Result<ProviderTurnLease, String> {
    registry.acquire_turn_for_generation(request.agent_cli_kind, request.provider_generation)
}

fn resolve_agent_task_attachments(
    request: &StartAgentTaskRequest,
    authority: &AgentTaskProjectAuthority,
    store: &AgentAttachmentStore,
) -> Result<ClaimedAgentTaskAttachments, String> {
    if request.attachments.len() > MAX_AGENT_TURN_ATTACHMENTS {
        return Err(format!(
            "Agent turn exceeds the maximum of {MAX_AGENT_TURN_ATTACHMENTS} attachments."
        ));
    }
    let mut staged = Vec::with_capacity(request.attachments.len());
    for attachment in &request.attachments {
        match attachment {
            StartAgentTaskAttachment::Staged { attachment_id } => {
                staged.push(attachment_id.clone())
            }
            StartAgentTaskAttachment::Reference { name, path } => {
                ensure_agent_attachment_reference(name, path)?
            }
        }
    }
    if staged.is_empty() {
        return Ok(ClaimedAgentTaskAttachments::default());
    }
    let root_keys = agent_task_root_keys(authority);
    let owner = AgentAttachmentOwner {
        workspace_id: request.workspace_id.as_str(),
        thread_id: &request.thread_id,
        root_keys: &root_keys,
    };
    let resolved = store.claim_for_turn(&owner, &staged)?;
    let images = ensure_prompt_carries_attachment_lines(&request.prompt, &resolved)
        .and_then(|()| agent_image_attachments(request.agent_cli_kind, store, &resolved));
    match images {
        Ok(images) => Ok(ClaimedAgentTaskAttachments {
            images,
            claimed_attachment_ids: staged,
        }),
        Err(error) => {
            store.forget_claimed(&staged);
            Err(error)
        }
    }
}

#[derive(Debug, Default)]
struct ClaimedAgentTaskAttachments {
    images: Vec<AgentImageAttachment>,
    claimed_attachment_ids: Vec<String>,
}

fn agent_task_root_keys(authority: &AgentTaskProjectAuthority) -> Vec<String> {
    super::agent_attachment_commands::workspace_root_keys(&authority.descriptor)
}

fn ensure_agent_attachment_reference(name: &str, path: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > MAX_AGENT_ATTACHMENT_NAME_BYTES
        || !path.starts_with('/')
        || path.len() > MAX_AGENT_ATTACHMENT_PATH_BYTES
        || name.chars().any(char::is_control)
        || path.chars().any(char::is_control)
    {
        return Err(AGENT_ATTACHMENT_REFERENCE_ERROR.to_string());
    }
    Ok(())
}

fn ensure_prompt_carries_attachment_lines(
    prompt: &str,
    resolved: &[ResolvedTurnAttachment],
) -> Result<(), String> {
    for attachment in resolved {
        if !prompt
            .split('\n')
            .any(|line| line_names_attachment(line, attachment))
        {
            return Err(AGENT_PROMPT_ATTACHMENT_MISMATCH_ERROR.to_string());
        }
    }
    Ok(())
}

fn line_names_attachment(line: &str, attachment: &ResolvedTurnAttachment) -> bool {
    if let Some(name) = &attachment.name {
        return line == prompt_line(attachment.kind, name, &attachment.stored_path);
    }
    let prefix = match attachment.kind {
        AgentAttachmentKind::Image => "[Attached image \"",
        AgentAttachmentKind::File => "[Attached file \"",
    };
    let suffix = format!("\" is saved at: {}]", attachment.stored_path);
    let Some(named) = line.strip_prefix(prefix) else {
        return false;
    };
    let Some(name) = named.strip_suffix(&suffix) else {
        return false;
    };
    !name.is_empty() && !name.contains('"')
}

fn agent_image_attachments(
    invocation: AgentCliInvocation,
    store: &AgentAttachmentStore,
    resolved: &[ResolvedTurnAttachment],
) -> Result<Vec<AgentImageAttachment>, String> {
    let images: Vec<&ResolvedTurnAttachment> = resolved
        .iter()
        .filter(|attachment| attachment.kind == AgentAttachmentKind::Image)
        .collect();
    let total = images.iter().fold(0u64, |total, attachment| {
        total.saturating_add(attachment.bytes)
    });
    if total > MAX_AGENT_TURN_IMAGE_BYTES {
        return Err(AGENT_TURN_IMAGE_BUDGET_ERROR.to_string());
    }
    images
        .into_iter()
        .map(|attachment| match invocation {
            AgentCliInvocation::CodexExec => {
                Ok(AgentImageAttachment::Path(attachment.path.clone()))
            }
            AgentCliInvocation::ClaudeCode => {
                let mime = attachment
                    .mime
                    .ok_or_else(|| AGENT_PROMPT_ATTACHMENT_MISMATCH_ERROR.to_string())?;
                Ok(AgentImageAttachment::Inline {
                    media_type: agent_image_media_type(mime).to_string(),
                    data: store.read_turn_image(attachment)?,
                })
            }
        })
        .collect()
}

fn prepare_agent_task_start(
    request: &StartAgentTaskRequest,
    authority: AgentTaskProjectAuthority,
    executable_identity: ExecutableIdentity,
    effective_path: EffectiveExecutablePath<'_>,
    store: &AgentAttachmentStore,
) -> Result<PreparedAgentTaskStart, String> {
    if request.provider_generation == 0 {
        return Err("Agent provider generation is invalid.".to_string());
    }
    if !request.launch.matches(request.agent_cli_kind) {
        return Err(AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR.to_string());
    }
    safe_agent_task_id(&request.task_id)?;
    safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let ClaimedAgentTaskAttachments {
        images,
        claimed_attachment_ids,
    } = resolve_agent_task_attachments(request, &authority, store)?;
    let prepared = prepare_claimed_agent_task_start(
        request,
        authority,
        executable_identity,
        effective_path,
        images,
        claimed_attachment_ids.clone(),
    );
    if prepared.is_err() {
        store.forget_claimed(&claimed_attachment_ids);
    }
    prepared
}

fn prepare_claimed_agent_task_start(
    request: &StartAgentTaskRequest,
    authority: AgentTaskProjectAuthority,
    executable_identity: ExecutableIdentity,
    effective_path: EffectiveExecutablePath<'_>,
    attachments: Vec<AgentImageAttachment>,
    claimed_attachment_ids: Vec<String>,
) -> Result<PreparedAgentTaskStart, String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
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
    let plan = plan_agent_invocation_with_authority(
        executable_identity,
        AgentInvocationRequest {
            invocation: request.agent_cli_kind,
            prompt: &request.prompt,
            cwd: &cwd,
            resume_session_id: request.resume_session_id.as_deref(),
            launch: request.launch,
            attachments,
        },
        effective_path,
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
        claimed_attachment_ids,
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
        let provider_turn = acquire_agent_task_provider_authority(
            preparation_app
                .state::<Arc<AgentProviderRuntimeRegistry>>()
                .inner(),
            &preparation_request,
        )?;
        let authority = capture_agent_task_project_authority(
            &preparation_app.state::<WorkspaceRegistry>(),
            &preparation_app.state::<Mutex<WorkspaceTrustService>>(),
            &preparation_request,
        )?;
        let effective_path = EffectiveExecutablePath::new(&provider_turn.effective_path)?;
        let prepared = prepare_agent_task_start(
            &preparation_request,
            authority,
            provider_turn.cli_identity.clone(),
            effective_path,
            preparation_app
                .state::<Arc<AgentAttachmentStore>>()
                .inner()
                .as_ref(),
        )?;
        Ok((prepared, provider_turn))
    })
    .await?;
    let admission_registry = Arc::clone(&state.admission);
    run_blocking_command(move || {
        let (prepared, provider_turn) = prepared;
        let PreparedAgentTaskStart {
            request: registry_request,
            plan,
            authority,
            claimed_attachment_ids,
        } = prepared;
        let attachment_store = Arc::clone(&app.state::<Arc<AgentAttachmentStore>>());
        let workspace_registry = app.state::<WorkspaceRegistry>();
        let trust_state = app.state::<Mutex<WorkspaceTrustService>>();
        if let Err(error) =
            revalidate_agent_task_filesystem_authority(&workspace_registry, &request, &authority)
        {
            attachment_store.forget_claimed(&claimed_attachment_ids);
            return Err(error);
        }
        let workspace_lease = match workspace_registry.reserve_runtime_start(&request.workspace_id)
        {
            Ok(workspace_lease) => workspace_lease,
            Err(_) => {
                attachment_store.forget_claimed(&claimed_attachment_ids);
                return Err(AGENT_WORKSPACE_START_BUSY_ERROR.to_string());
            }
        };
        let trust_leases =
            match reserve_agent_task_trust(&trust_state, &authority, request.isolation) {
                Ok(trust_leases) => trust_leases,
                Err(error) => {
                    attachment_store.forget_claimed(&claimed_attachment_ids);
                    return Err(error);
                }
            };
        if !retained_root_matches_path(&authority.project_authority, &authority.project_root)
            || !retained_root_matches_path(
                &authority.repository_authority,
                &authority.repository_root,
            )
            || !retained_root_matches_path(&authority.cwd_authority, &authority.cwd)
        {
            attachment_store.forget_claimed(&claimed_attachment_ids);
            return Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string());
        }
        let admission = match admission_registry.reserve(
            &request.workspace_id,
            &registry_request.repository_root,
            plan.cwd(),
            request.isolation,
        ) {
            Ok(admission) => admission,
            Err(error) => {
                attachment_store.forget_claimed(&claimed_attachment_ids);
                return Err(error);
            }
        };
        if let Err(error) = app
            .state::<Arc<AgentProviderRuntimeRegistry>>()
            .revalidate_turn_authority(&provider_turn)
        {
            attachment_store.forget_claimed(&claimed_attachment_ids);
            return Err(error);
        }
        let admission = admission.with_runtime_lease(provider_turn);
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
        if result.is_err() {
            attachment_store.forget_claimed(&claimed_attachment_ids);
        }
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
    workspace_id: WorkspaceId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentRootLeaseReleaseKind {
    Released,
    NotHeld,
    ForeignOwner,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRootLeaseReleaseResult {
    kind: AgentRootLeaseReleaseKind,
    lease_token: u64,
}

impl AgentRootLeaseReleaseResult {
    fn from_disposition(lease_token: u64, disposition: AgentRootLeaseReleaseDisposition) -> Self {
        let kind = match disposition {
            AgentRootLeaseReleaseDisposition::Released => AgentRootLeaseReleaseKind::Released,
            AgentRootLeaseReleaseDisposition::NotHeld => AgentRootLeaseReleaseKind::NotHeld,
            AgentRootLeaseReleaseDisposition::ForeignOwner => {
                AgentRootLeaseReleaseKind::ForeignOwner
            }
        };

        Self { kind, lease_token }
    }
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

fn ensure_agent_root_lease_token_bounds(lease_token: u64) -> Result<(), String> {
    if lease_token == 0 || lease_token > MAX_AGENT_ROOT_LEASE_TOKEN {
        return Err(format!(
            "Agent project root lease token must be between 1 and {MAX_AGENT_ROOT_LEASE_TOKEN}."
        ));
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn acquire_agent_root_lease(
    app: AppHandle,
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
        let registry = app.state::<WorkspaceRegistry>();
        acquire_registered_workspace_lease(&root, &registry, &leases).map(agent_root_lease_receipt)
    })
    .await
}

#[tauri::command]
pub(crate) fn release_agent_root_lease(
    registry: State<'_, WorkspaceRegistry>,
    request: AgentRootLeaseReleaseRequest,
    leases: State<'_, Arc<AgentRootLeaseRegistry>>,
) -> Result<AgentRootLeaseReleaseResult, String> {
    release_agent_root_lease_for_registry(request, leases.inner().as_ref(), Some(&registry))
}

fn release_agent_root_lease_for_registry(
    request: AgentRootLeaseReleaseRequest,
    leases: &AgentRootLeaseRegistry,
    workspace_registry: Option<&WorkspaceRegistry>,
) -> Result<AgentRootLeaseReleaseResult, String> {
    ensure_agent_root_lease_bounds(&request.root_path)?;
    ensure_agent_root_lease_token_bounds(request.lease_token)?;
    let root = workspace_root_for_disposal(&request.root_path);
    let disposition =
        release_registered_workspace_lease(&root, request.lease_token, leases, workspace_registry)?;

    Ok(AgentRootLeaseReleaseResult::from_disposition(
        request.lease_token,
        disposition,
    ))
}

fn agent_root_lease_receipt(lease: RegisteredAgentRootLease) -> AgentRootLeaseReceipt {
    AgentRootLeaseReceipt {
        lease_token: lease.lease_token,
        workspace_id: lease.registration.workspace_id,
    }
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
#[path = "agent_task_commands_tests.rs"]
mod tests;
