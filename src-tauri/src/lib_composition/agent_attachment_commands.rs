use super::agent_task_commands::agent_root_lease::AgentRootLeaseRegistry;
use super::agent_task_commands::{
    MAX_AGENT_TASK_WORKSPACE_ID_BYTES, UNKNOWN_AGENT_WORKSPACE_ERROR,
    UNTRUSTED_AGENT_REPOSITORY_ERROR,
};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use agent_attachment_store::{
    AgentAttachmentCandidate, AgentAttachmentKind, AgentAttachmentOwner, AgentAttachmentStore,
    ClaimedAgentAttachment, StageAgentAttachmentHeader, StagedAgentAttachment,
};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

pub(crate) use super::agent_thread_store_commands::agent_thread_store::{
    self, agent_attachment_paths,
};

#[path = "../agent_attachment_store.rs"]
pub(crate) mod agent_attachment_store;

pub(crate) const AGENT_ROOT_OWNER_ID_PREFIX: &str = "agent-root:";
pub(crate) const AGENT_ATTACHMENT_HEADER: &str = "x-agent-attachment";
pub(crate) const AGENT_ATTACHMENT_HEADER_ERROR: &str =
    "The agent attachment request is missing its bounded header.";
pub(crate) const AGENT_ATTACHMENT_BODY_ERROR: &str =
    "The agent attachment request must carry raw bytes.";
pub(crate) const MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES: u64 =
    agent_thread_store::MAX_AGENT_IMAGE_BYTES;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StageAgentAttachmentBytesHeader {
    workspace_id: WorkspaceId,
    kind: AgentAttachmentKind,
    name: String,
    #[serde(default)]
    mime: Option<agent_thread_store::AgentImageMime>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

impl StageAgentAttachmentBytesHeader {
    fn attachment(&self) -> StageAgentAttachmentHeader {
        StageAgentAttachmentHeader {
            kind: self.kind,
            name: self.name.clone(),
            mime: self.mime,
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StageAgentAttachmentFromPathRequest {
    workspace_id: WorkspaceId,
    kind: AgentAttachmentKind,
    name: String,
    #[serde(default)]
    mime: Option<agent_thread_store::AgentImageMime>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentAttachmentCandidateRequest {
    workspace_id: WorkspaceId,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimAgentAttachmentsRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    attachment_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReleaseAgentAttachmentRequest {
    workspace_id: WorkspaceId,
    attachment_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentAttachmentReferenceRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    attachment_id: String,
}

pub(crate) struct StageAgentAttachmentCall {
    header: StageAgentAttachmentBytesHeader,
    body: Vec<u8>,
}

impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for StageAgentAttachmentCall {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        let request =
            <tauri::ipc::Request<'de> as tauri::ipc::CommandArg<'de, R>>::from_command(command)?;
        let header = request
            .headers()
            .get(AGENT_ATTACHMENT_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| tauri::ipc::InvokeError::from(AGENT_ATTACHMENT_HEADER_ERROR))?;
        let header: StageAgentAttachmentBytesHeader = serde_json::from_str(header)
            .map_err(|_| tauri::ipc::InvokeError::from(AGENT_ATTACHMENT_HEADER_ERROR))?;
        let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
            return Err(tauri::ipc::InvokeError::from(AGENT_ATTACHMENT_BODY_ERROR));
        };
        Ok(Self {
            header,
            body: body.clone(),
        })
    }
}

fn ensure_agent_attachment_workspace_id(workspace_id: &WorkspaceId) -> Result<(), String> {
    if workspace_id.as_str().is_empty()
        || workspace_id.as_str().len() > MAX_AGENT_TASK_WORKSPACE_ID_BYTES
    {
        return Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string());
    }
    Ok(())
}

pub(crate) struct ResolvedAgentAttachmentOwner {
    workspace_id: WorkspaceId,
    root_keys: Vec<String>,
}

impl ResolvedAgentAttachmentOwner {
    fn store_owner<'a>(&'a self, thread_id: &'a str) -> AgentAttachmentOwner<'a> {
        AgentAttachmentOwner {
            workspace_id: self.workspace_id.as_str(),
            thread_id,
            root_keys: &self.root_keys,
        }
    }
}

fn resolve_agent_attachment_owner(
    app: &AppHandle,
    owner_id: &WorkspaceId,
) -> Result<ResolvedAgentAttachmentOwner, String> {
    let registry = app.state::<WorkspaceRegistry>();
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let leases = app.state::<Arc<AgentRootLeaseRegistry>>();
    resolve_agent_attachment_owner_with(&registry, &trust, leases.inner().as_ref(), owner_id)
}

pub(crate) fn resolve_agent_attachment_owner_with(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    leases: &AgentRootLeaseRegistry,
    owner_id: &WorkspaceId,
) -> Result<ResolvedAgentAttachmentOwner, String> {
    ensure_agent_attachment_workspace_id(owner_id)?;
    let workspace_id = resolve_agent_attachment_workspace_id(registry, leases, owner_id)?;
    let descriptor = registry
        .descriptor(&workspace_id)
        .map_err(|_| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())?;
    let root_path = descriptor
        .canonical_root_path
        .to_str()
        .ok_or_else(|| UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())?
        .to_string();
    let trusted = trust
        .lock()
        .map_err(|error| error.to_string())?
        .snapshot(&root_path)
        .trusted;
    if !trusted {
        return Err(UNTRUSTED_AGENT_REPOSITORY_ERROR.to_string());
    }
    Ok(ResolvedAgentAttachmentOwner {
        workspace_id,
        root_keys: workspace_root_keys(&descriptor),
    })
}

fn resolve_agent_attachment_workspace_id(
    registry: &WorkspaceRegistry,
    leases: &AgentRootLeaseRegistry,
    owner_id: &WorkspaceId,
) -> Result<WorkspaceId, String> {
    if !owner_id.as_str().starts_with(AGENT_ROOT_OWNER_ID_PREFIX) {
        return Ok(owner_id.clone());
    }
    for lease in leases.registered_leases() {
        let Ok(descriptor) = registry.descriptor(&lease.registration.workspace_id) else {
            continue;
        };
        let owns = workspace_root_keys(&descriptor)
            .iter()
            .any(|root_key| agent_thread_store::agent_root_owner_id(root_key) == owner_id.as_str());
        if owns {
            return Ok(lease.registration.workspace_id);
        }
    }
    Err(UNKNOWN_AGENT_WORKSPACE_ERROR.to_string())
}

pub(crate) fn workspace_root_keys(
    descriptor: &crate::workspace_registry::ManagedWorkspaceDescriptor,
) -> Vec<String> {
    let mut keys = Vec::with_capacity(2);
    for path in [
        &descriptor.selected_root_path,
        &descriptor.canonical_root_path,
    ] {
        let Some(path) = path.to_str() else {
            continue;
        };
        let key = normalized_workspace_root_key(path);
        if !key.is_empty() && !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

fn normalized_workspace_root_key(root: &str) -> String {
    let mut end = root.len();
    while end > 1 && matches!(root.as_bytes()[end - 1], b'/' | b'\\') {
        end -= 1;
    }
    root[..end].to_string()
}

fn attachment_store(app: &AppHandle) -> Arc<AgentAttachmentStore> {
    Arc::clone(&app.state::<Arc<AgentAttachmentStore>>())
}

#[tauri::command]
pub(crate) async fn stage_agent_attachment_bytes(
    app: AppHandle,
    call: StageAgentAttachmentCall,
) -> Result<StagedAgentAttachment, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &call.header.workspace_id)?;
        store.stage_bytes(
            resolved.workspace_id.as_str(),
            &call.header.attachment(),
            &call.body,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn stage_agent_attachment_from_path(
    app: AppHandle,
    request: StageAgentAttachmentFromPathRequest,
) -> Result<StagedAgentAttachment, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.stage_from_path(
            resolved.workspace_id.as_str(),
            &StageAgentAttachmentHeader {
                kind: request.kind,
                name: request.name.clone(),
                mime: request.mime,
                width: request.width,
                height: request.height,
            },
            &request.path,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_agent_attachment_candidate(
    app: AppHandle,
    request: AgentAttachmentCandidateRequest,
) -> Result<AgentAttachmentCandidate, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.inspect_candidate(&request.path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_agent_attachment_candidate(
    app: AppHandle,
    request: AgentAttachmentCandidateRequest,
) -> Result<tauri::ipc::Response, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.read_candidate(&request.path)
    })
    .await
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub(crate) async fn claim_agent_attachments(
    app: AppHandle,
    request: ClaimAgentAttachmentsRequest,
) -> Result<Vec<ClaimedAgentAttachment>, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.claim(
            &resolved.store_owner(&request.thread_id),
            &request.attachment_ids,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn release_agent_attachment(
    app: AppHandle,
    request: ReleaseAgentAttachmentRequest,
) -> Result<(), String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.release(resolved.workspace_id.as_str(), &request.attachment_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_agent_attachment(
    app: AppHandle,
    request: AgentAttachmentReferenceRequest,
) -> Result<tauri::ipc::Response, String> {
    let store = attachment_store(&app);
    run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store.read_claimed(
            &resolved.store_owner(&request.thread_id),
            &request.attachment_id,
            MAX_AGENT_ATTACHMENT_THUMBNAIL_BYTES,
        )
    })
    .await
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub(crate) async fn reveal_agent_attachment(
    app: AppHandle,
    request: AgentAttachmentReferenceRequest,
) -> Result<(), String> {
    let store = attachment_store(&app);
    let opener_app = app.clone();
    let path = run_blocking_command(move || {
        let resolved = resolve_agent_attachment_owner(&app, &request.workspace_id)?;
        store
            .resolve_claimed_path(
                &resolved.store_owner(&request.thread_id),
                &request.attachment_id,
            )
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await?;
    opener_app
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|error| format!("Unable to open the attachment: {error}"))
}

#[cfg(test)]
#[path = "agent_attachment_commands_tests.rs"]
mod tests;
