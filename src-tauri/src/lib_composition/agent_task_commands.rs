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
use crate::agent_task_spawner::agent_task_input::{
    AgentTaskSteerRejection, MAX_AGENT_STEER_FRAME_BYTES,
};
use crate::agent_task_spawner::{
    claude_user_frame, plan_agent_invocation_with_authority, AgentCliInvocation,
    AgentImageAttachment, AgentInvocationRequest, AgentTaskSpawnPlan,
    AGENT_TURN_IMAGE_BUDGET_ERROR, MAX_AGENT_PROMPT_BYTES, MAX_AGENT_TURN_IMAGE_BYTES,
};
use crate::agent_task_supervisor::agent_task_pending_stops::AGENT_TASK_STOPPED_BEFORE_START_ERROR;
use crate::agent_task_supervisor::{
    AgentTaskEventSink, AgentTaskIsolation, AgentTaskMetadata, AgentTaskOutputEvent,
    AgentTaskRegistry, AgentTaskStartRequest as AgentTaskRegistryStartRequest,
    AgentTaskStartResult, AgentTaskStatusEvent, AGENT_TASK_OUTPUT_EVENT_CHANNEL,
    AGENT_TASK_STARTS_CLOSED_ERROR, AGENT_TASK_STATUS_EVENT_CHANNEL,
};
use crate::effective_executable_environment::EffectiveExecutablePath;
use crate::git_worktree::{ensure_worktree_path_in_base, safe_agent_task_id};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
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
pub(crate) use crate::agent_task_spawner::{
    codex_app_server_host, codex_app_server_protocol, codex_app_server_turn,
};
#[path = "codex_task_composition.rs"]
pub(crate) mod codex_task_composition;

#[path = "agent_task_output_commands.rs"]
pub(crate) mod output_delivery;
#[path = "agent_question_commands.rs"]
pub(crate) mod questions;

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
pub(crate) struct SteerAgentTaskRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    thread_id: String,
    prompt: String,
    #[serde(default)]
    attachments: Vec<StartAgentTaskAttachment>,
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

#[path = "agent_task_change_capture.rs"]
mod agent_task_change_capture;

impl AgentTaskEventSink for AppHandleAgentTaskEventSink {
    fn before_start(&self, task: &AgentTaskMetadata, authority: Option<&std::fs::File>) {
        agent_task_change_capture::capture(
            &self.app,
            task,
            authority,
            crate::agent_turn_changes::CapturePhase::Before,
        );
    }

    fn before_completion(&self, task: &AgentTaskMetadata, authority: Option<&std::fs::File>) {
        agent_task_change_capture::capture(
            &self.app,
            task,
            authority,
            crate::agent_turn_changes::CapturePhase::After,
        );
    }

    fn requires_output_acknowledgement(&self) -> bool {
        true
    }

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

fn acquire_agent_task_provider_authority(
    registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &StartAgentTaskRequest,
) -> Result<ProviderTurnLease, String> {
    registry.acquire_turn_for_generation(request.agent_cli_kind, request.provider_generation)
}

struct AgentTurnAttachmentClaim<'a> {
    workspace_id: &'a str,
    thread_id: &'a str,
    prompt: &'a str,
    invocation: AgentCliInvocation,
    attachments: &'a [StartAgentTaskAttachment],
    root_keys: &'a [String],
}

fn resolve_agent_task_attachments(
    request: &StartAgentTaskRequest,
    authority: &AgentTaskProjectAuthority,
    store: &AgentAttachmentStore,
) -> Result<ClaimedAgentTaskAttachments, String> {
    let root_keys = agent_task_root_keys(authority);
    claim_agent_turn_attachments(
        &AgentTurnAttachmentClaim {
            workspace_id: request.workspace_id.as_str(),
            thread_id: &request.thread_id,
            prompt: &request.prompt,
            invocation: request.agent_cli_kind,
            attachments: &request.attachments,
            root_keys: &root_keys,
        },
        store,
    )
}

fn claim_agent_turn_attachments(
    claim: &AgentTurnAttachmentClaim<'_>,
    store: &AgentAttachmentStore,
) -> Result<ClaimedAgentTaskAttachments, String> {
    let staged = staged_agent_turn_attachment_ids(claim.attachments)?;
    if staged.is_empty() {
        return Ok(ClaimedAgentTaskAttachments::default());
    }
    let owner = AgentAttachmentOwner {
        workspace_id: claim.workspace_id,
        thread_id: claim.thread_id,
        root_keys: claim.root_keys,
    };
    // Keep bounded, exact-owner claims on refusal: the composer retries with
    // this thread ID, even before there is a saved thread document. Eviction
    // and application shutdown still release the in-memory claim records.
    let resolved = store.claim_for_turn(&owner, &staged)?;
    let images = ensure_prompt_carries_attachment_lines(claim.prompt, &resolved)
        .and_then(|()| agent_image_attachments(claim.invocation, store, &resolved));
    images.map(|images| ClaimedAgentTaskAttachments { images })
}

fn staged_agent_turn_attachment_ids(
    attachments: &[StartAgentTaskAttachment],
) -> Result<Vec<String>, String> {
    if attachments.len() > MAX_AGENT_TURN_ATTACHMENTS {
        return Err(format!(
            "Agent turn exceeds the maximum of {MAX_AGENT_TURN_ATTACHMENTS} attachments."
        ));
    }
    let mut staged = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        match attachment {
            StartAgentTaskAttachment::Staged { attachment_id } => {
                staged.push(attachment_id.clone())
            }
            StartAgentTaskAttachment::Reference { name, path } => {
                ensure_agent_attachment_reference(name, path)?
            }
        }
    }
    Ok(staged)
}

#[derive(Debug, Default)]
struct ClaimedAgentTaskAttachments {
    images: Vec<AgentImageAttachment>,
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
    cli_version: Option<&str>,
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
    let ClaimedAgentTaskAttachments { images } =
        resolve_agent_task_attachments(request, &authority, store)?;
    prepare_claimed_agent_task_start(
        request,
        authority,
        executable_identity,
        effective_path,
        images,
        cli_version,
    )
}

fn prepare_claimed_agent_task_start(
    request: &StartAgentTaskRequest,
    authority: AgentTaskProjectAuthority,
    executable_identity: ExecutableIdentity,
    effective_path: EffectiveExecutablePath<'_>,
    attachments: Vec<AgentImageAttachment>,
    cli_version: Option<&str>,
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
            cli_version,
            attachments,
        },
        effective_path,
    )?
    .with_cwd_authority(Arc::clone(&authority.cwd_authority));

    Ok(PreparedAgentTaskStart {
        request: AgentTaskRegistryStartRequest {
            task_id,
            thread_id: request.thread_id.clone(),
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
    let task_id = request.task_id.clone();
    let workspace_id = request.workspace_id.clone();
    let discard_app = app.clone();
    let result = start_owned_agent_task(app, request, state).await;
    if result.is_err() {
        discard_app
            .state::<AgentTaskRegistry>()
            .discard_pending_stop(&task_id, workspace_id.as_str());
    }
    result
}

async fn start_owned_agent_task(
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
        let version = if preparation_request.agent_cli_kind == AgentCliInvocation::ClaudeCode {
            preparation_app
                .state::<Arc<AgentProviderRuntimeRegistry>>()
                .observed_turn_version(&provider_turn)?
        } else {
            None
        };
        preparation_request
            .launch
            .validate_cli_version(version.as_deref())
            .map_err(str::to_string)?;
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
            version.as_deref(),
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
        } = prepared;
        if app
            .state::<AgentTaskRegistry>()
            .stop_pending_before_start(&registry_request.task_id, request.workspace_id.as_str())
        {
            return Err(AGENT_TASK_STOPPED_BEFORE_START_ERROR.to_string());
        }
        let workspace_registry = app.state::<WorkspaceRegistry>();
        let trust_state = app.state::<Mutex<WorkspaceTrustService>>();
        revalidate_agent_task_filesystem_authority(&workspace_registry, &request, &authority)?;
        let workspace_lease = match workspace_registry.reserve_runtime_start(&request.workspace_id)
        {
            Ok(workspace_lease) => workspace_lease,
            Err(_) => {
                return Err(AGENT_WORKSPACE_START_BUSY_ERROR.to_string());
            }
        };
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
        app.state::<Arc<AgentProviderRuntimeRegistry>>()
            .revalidate_turn_authority(&provider_turn)?;
        let start_app = app.clone();
        let start_request = request.clone();
        let start_authority = authority.clone();
        let start_identity = plan.executable_identity().clone();
        let validate_authority = Arc::new(move || {
            revalidate_agent_task_filesystem_authority(
                &start_app.state::<WorkspaceRegistry>(),
                &start_request,
                &start_authority,
            )?;
            if !start_identity.retained_is_current() {
                return Err(AGENT_WORKSPACE_START_BUSY_ERROR.to_string());
            }
            let provider_registry = start_app.state::<Arc<AgentProviderRuntimeRegistry>>();
            let Some((_, receipt)) =
                provider_registry.policy_snapshot(start_request.agent_cli_kind)
            else {
                return Err(AGENT_WORKSPACE_START_BUSY_ERROR.to_string());
            };
            if receipt.provider_generation != start_request.provider_generation {
                return Err(AGENT_WORKSPACE_START_BUSY_ERROR.to_string());
            }
            Ok(())
        });
        let plan = codex_task_composition::prepare_transport(
            plan,
            &request,
            &authority,
            &provider_turn,
            app.state::<Arc<codex_app_server_host::CodexAppServerHostRegistry>>()
                .inner(),
            validate_authority,
        )?;
        revalidate_agent_task_filesystem_authority(&workspace_registry, &request, &authority)?;
        app.state::<Arc<AgentProviderRuntimeRegistry>>()
            .revalidate_turn_authority(&provider_turn)?;
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

struct AgentTaskSteerTarget {
    metadata: AgentTaskMetadata,
    descriptor: ManagedWorkspaceDescriptor,
    input_kind: crate::agent_task_spawner::agent_task_input::AgentTaskInputKind,
}

#[derive(Debug)]
struct PreparedAgentTaskSteer {
    task_id: String,
    thread_id: String,
    workspace_id: String,
    descriptor: ManagedWorkspaceDescriptor,
    frame: crate::agent_task_spawner::agent_task_input::AgentTaskInputFrame,
}

fn ensure_agent_steer_prompt_bounds(prompt: &str) -> Result<(), AgentTaskSteerRejection> {
    if prompt.is_empty() || prompt.len() > MAX_AGENT_PROMPT_BYTES {
        return Err(AgentTaskSteerRejection::LimitExceeded);
    }

    Ok(())
}

fn agent_steer_frame(
    prompt: &str,
    images: Vec<AgentImageAttachment>,
) -> Result<Arc<[u8]>, AgentTaskSteerRejection> {
    let mut inline = Vec::with_capacity(images.len());
    for image in images {
        let AgentImageAttachment::Inline { media_type, data } = image else {
            return Err(AgentTaskSteerRejection::LimitExceeded);
        };
        inline.push((media_type, data));
    }
    let frame = claude_user_frame(prompt, &inline);
    if frame.len() > MAX_AGENT_STEER_FRAME_BYTES {
        return Err(AgentTaskSteerRejection::LimitExceeded);
    }

    Ok(Arc::from(frame))
}

fn prepare_agent_task_steer<Lookup>(
    request: &SteerAgentTaskRequest,
    store: &AgentAttachmentStore,
    lookup: Lookup,
) -> Result<PreparedAgentTaskSteer, AgentTaskSteerRejection>
where
    Lookup: FnOnce(&str) -> Option<AgentTaskSteerTarget>,
{
    let task_id =
        safe_agent_task_id(&request.task_id).map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    safe_agent_task_id(&request.thread_id).map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    ensure_workspace_id_bounds(&request.workspace_id)
        .map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    ensure_agent_steer_prompt_bounds(&request.prompt)?;
    let Some(target) = lookup(&task_id) else {
        return Err(AgentTaskSteerRejection::NotRegistered);
    };
    if target.metadata.workspace_id != request.workspace_id.as_str()
        || target.metadata.thread_id != request.thread_id
    {
        return Err(AgentTaskSteerRejection::NotRegistered);
    }
    staged_agent_turn_attachment_ids(&request.attachments)
        .map_err(|_| AgentTaskSteerRejection::LimitExceeded)?;
    let root_keys = super::agent_attachment_commands::workspace_root_keys(&target.descriptor);
    let frame = claim_agent_turn_attachments(
        &AgentTurnAttachmentClaim {
            workspace_id: request.workspace_id.as_str(),
            thread_id: &request.thread_id,
            prompt: &request.prompt,
            invocation: match target.input_kind {
                crate::agent_task_spawner::agent_task_input::AgentTaskInputKind::Bytes => {
                    AgentCliInvocation::ClaudeCode
                }
                crate::agent_task_spawner::agent_task_input::AgentTaskInputKind::CodexInput => {
                    AgentCliInvocation::CodexExec
                }
            },
            attachments: &request.attachments,
            root_keys: &root_keys,
        },
        store,
    )
    .map_err(|_| AgentTaskSteerRejection::LimitExceeded)
    .and_then(|claimed| {
        use crate::agent_task_spawner::agent_task_input::{
            AgentTaskInputFrame, AgentTaskInputKind,
        };
        match target.input_kind {
            AgentTaskInputKind::Bytes => {
                agent_steer_frame(&request.prompt, claimed.images).map(AgentTaskInputFrame::Bytes)
            }
            AgentTaskInputKind::CodexInput => {
                let mut images = Vec::new();
                for image in claimed.images {
                    let AgentImageAttachment::Path(path) = image else {
                        return Err(AgentTaskSteerRejection::InputUnavailable);
                    };
                    images.push(path);
                }
                let input = codex_task_composition::codex_input(&request.prompt, &images)
                    .map_err(|_| AgentTaskSteerRejection::LimitExceeded)?;
                Ok(AgentTaskInputFrame::CodexInput {
                    input,
                    client_user_message_id: None,
                })
            }
        }
    })?;

    Ok(PreparedAgentTaskSteer {
        task_id,
        thread_id: request.thread_id.clone(),
        workspace_id: request.workspace_id.as_str().to_string(),
        descriptor: target.descriptor,
        frame,
    })
}

fn agent_task_steer_target(
    app: &AppHandle,
    task_id: &str,
    workspace_id: &WorkspaceId,
) -> Option<AgentTaskSteerTarget> {
    let metadata = app
        .state::<AgentTaskRegistry>()
        .metadata_for_workspace(task_id, workspace_id.as_str())?;
    let descriptor = app
        .state::<WorkspaceRegistry>()
        .descriptor(workspace_id)
        .ok()?;
    let input_kind = app
        .state::<AgentTaskRegistry>()
        .input_kind_for_thread(task_id, workspace_id.as_str(), &metadata.thread_id)
        .ok()?;

    Some(AgentTaskSteerTarget {
        metadata,
        descriptor,
        input_kind,
    })
}

fn revalidate_agent_steer_workspace(
    registry: &WorkspaceRegistry,
    expected: &ManagedWorkspaceDescriptor,
) -> Result<(), AgentTaskSteerRejection> {
    let current = registry
        .descriptor(&expected.workspace_id)
        .map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    if current != *expected {
        return Err(AgentTaskSteerRejection::NotRegistered);
    }
    let retained_root = registry
        .clone_root(&expected.workspace_id)
        .map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    if !retained_root_matches_path(&retained_root, &expected.canonical_root_path) {
        return Err(AgentTaskSteerRejection::NotRegistered);
    }
    Ok(())
}

fn steer_prepared_agent_task(
    app: &AppHandle,
    prepared: PreparedAgentTaskSteer,
) -> Result<(), AgentTaskSteerRejection> {
    revalidate_agent_steer_workspace(&app.state::<WorkspaceRegistry>(), &prepared.descriptor)?;
    app.state::<AgentTaskRegistry>().steer_input_for_thread(
        &prepared.task_id,
        &prepared.workspace_id,
        &prepared.thread_id,
        prepared.frame,
    )
}

#[tauri::command]
pub(crate) async fn steer_agent_task(
    app: AppHandle,
    request: SteerAgentTaskRequest,
) -> Result<(), AgentTaskSteerRejection> {
    let preparation_app = app.clone();
    let prepared = run_blocking_command(move || {
        Ok(prepare_agent_task_steer(
            &request,
            preparation_app
                .state::<Arc<AgentAttachmentStore>>()
                .inner()
                .as_ref(),
            |task_id| agent_task_steer_target(&preparation_app, task_id, &request.workspace_id),
        ))
    })
    .await
    .map_err(|_| AgentTaskSteerRejection::WriteFailed)??;

    run_blocking_command(move || Ok(steer_prepared_agent_task(&app, prepared)))
        .await
        .map_err(|_| AgentTaskSteerRejection::WriteFailed)?
}

fn agent_task_input_reference(
    request: &AgentTaskReferenceRequest,
) -> Result<String, AgentTaskSteerRejection> {
    let task_id =
        safe_agent_task_id(&request.task_id).map_err(|_| AgentTaskSteerRejection::NotRegistered)?;
    ensure_workspace_id_bounds(&request.workspace_id)
        .map_err(|_| AgentTaskSteerRejection::NotRegistered)?;

    Ok(task_id)
}

#[tauri::command]
pub(crate) fn close_agent_task_input(
    request: AgentTaskReferenceRequest,
    state: AgentTaskRuntimeState<'_>,
) -> Result<(), AgentTaskSteerRejection> {
    let task_id = agent_task_input_reference(&request)?;
    state
        .registry
        .close_input_for_workspace(&task_id, request.workspace_id.as_str())
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
    if let Some(hosts) = app.try_state::<Arc<codex_app_server_host::CodexAppServerHostRegistry>>() {
        hosts.retire_for_repository(root);
    }
}

#[cfg(test)]
#[path = "agent_task_commands_tests.rs"]
mod tests;
