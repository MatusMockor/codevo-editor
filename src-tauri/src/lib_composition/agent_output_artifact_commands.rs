use super::{
    agent_attachment_commands::resolve_agent_attachment_owner,
    agent_thread_store_commands::agent_thread_store::{AgentThread, AgentThreadStore},
};
use crate::{
    agent_task_supervisor::AgentTaskIsolation,
    run_blocking_command,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
};
use serde::Deserialize;
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager};
#[path = "../agent_output_artifact_store.rs"]
pub(crate) mod store;
use store::{ArtifactMetadata, ArtifactOwner, OutputArtifactStore};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResolveRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    turn_id: String,
    path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    turn_id: String,
    artifact_id: String,
}

fn load_thread(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    thread_id: &str,
    turn_id: &str,
) -> Result<(AgentThread, PathBuf), String> {
    crate::git_worktree::safe_agent_task_id(thread_id)?;
    crate::git_worktree::safe_agent_task_id(turn_id)?;
    let resolved = resolve_agent_attachment_owner(app, workspace_id)?;
    let descriptor = app
        .state::<WorkspaceRegistry>()
        .descriptor(&resolved.workspace_id)
        .map_err(|e| e.to_string())?;
    let threads = app.state::<Arc<AgentThreadStore>>();
    for key in resolved.root_keys {
        if let Some(thread) = threads
            .load(&key)?
            .threads
            .into_iter()
            .find(|t| t.thread_id == thread_id)
        {
            let turn = thread
                .turns
                .iter()
                .find(|t| t.turn_id == turn_id)
                .ok_or("Artifact turn is unavailable.")?;
            if !turn.status.is_terminal() {
                return Err("Artifacts are available after the turn finishes.".into());
            }
            let repository = PathBuf::from(&thread.owner.repository_root)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if repository != descriptor.canonical_root_path {
                return Err("Artifact repository does not match its registered owner.".into());
            }
            return Ok((thread, repository));
        }
    }
    Err("Artifact thread is unavailable.".into())
}
fn root(thread: &AgentThread, repository: PathBuf) -> Result<PathBuf, String> {
    match thread.target.isolation {
        AgentTaskIsolation::InPlace if thread.target.worktree_path.is_none() => Ok(repository),
        AgentTaskIsolation::Worktree => {
            let path = thread
                .target
                .worktree_path
                .as_ref()
                .ok_or("Artifact worktree is unavailable.")?;
            let candidate = PathBuf::from(path);
            let expected = crate::git_worktree::agent_worktree_path(&repository, "placeholder");
            let base = expected.parent().ok_or("Invalid artifact worktree base.")?;
            if candidate == base
                || !candidate.starts_with(base)
                || candidate.components().any(|c| {
                    matches!(
                        c,
                        std::path::Component::ParentDir | std::path::Component::CurDir
                    )
                })
            {
                return Err("Artifact worktree aliases are not supported.".into());
            }
            Ok(candidate)
        }
        _ => Err("Invalid artifact workspace.".into()),
    }
}
#[tauri::command]
pub(crate) async fn resolve_agent_output_artifact(
    app: AppHandle,
    request: ResolveRequest,
) -> Result<ArtifactMetadata, String> {
    run_blocking_command(move || {
        resolve_saved_output_artifact(
            &app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
            &request.path,
        )
    })
    .await
}
pub(super) fn resolve_saved_output_artifact(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    thread_id: &str,
    turn_id: &str,
    path: &str,
) -> Result<ArtifactMetadata, String> {
    let request = ResolveRequest {
        workspace_id: workspace_id.clone(),
        thread_id: thread_id.into(),
        turn_id: turn_id.into(),
        path: path.into(),
    };
    let (thread, repository) = load_thread(
        app,
        &request.workspace_id,
        &request.thread_id,
        &request.turn_id,
    )?;
    let root = root(&thread, repository.clone())?;
    let owner = ArtifactOwner {
        root_key: &thread.owner.root_key,
        thread_id: &request.thread_id,
        turn_id: &request.turn_id,
    };
    let initial_registration =
        resolve_agent_attachment_owner(app, &request.workspace_id)?.workspace_id;
    if let Some(metadata) =
        app.state::<Arc<OutputArtifactStore>>()
            .existing(&owner, &root, &request.path)?
    {
        validate_still_owned(
            app,
            &request.workspace_id,
            &initial_registration,
            &thread,
            &request.turn_id,
        )?;
        return Ok(metadata);
    }
    if thread
        .turns
        .last()
        .is_none_or(|turn| turn.turn_id != request.turn_id)
    {
        return Err("This older turn has no saved artifact snapshot.".into());
    }
    let resolved = resolve_agent_attachment_owner(app, &request.workspace_id)?;
    let registry = app.state::<WorkspaceRegistry>();
    let root_descriptor = if root == repository {
        registry.clone_root(&resolved.workspace_id)
    } else {
        registry.open_directory_descendant(
            &resolved.workspace_id,
            root.strip_prefix(&repository)
                .map_err(|_| "Invalid artifact root.")?,
        )
    }
    .map_err(|e| e.to_string())?;
    let revalidate = || {
        use std::os::unix::fs::MetadataExt;
        validate_still_owned(
            app,
            &request.workspace_id,
            &initial_registration,
            &thread,
            &request.turn_id,
        )?;
        let (latest, _) = load_thread(
            app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
        )?;
        if latest
            .turns
            .last()
            .is_none_or(|turn| turn.turn_id != request.turn_id)
        {
            return Err("The conversation advanced before its artifact was saved.".into());
        }
        let current_owner = resolve_agent_attachment_owner(app, &request.workspace_id)?;
        if current_owner.workspace_id != resolved.workspace_id {
            return Err("Artifact owner changed.".into());
        }
        let current = if root == repository {
            registry.clone_root(&resolved.workspace_id)
        } else {
            registry.open_directory_descendant(
                &resolved.workspace_id,
                root.strip_prefix(&repository)
                    .map_err(|_| "Invalid artifact root.")?,
            )
        }
        .map_err(|e| e.to_string())?;
        let expected = root_descriptor.metadata().map_err(|e| e.to_string())?;
        let actual = current.metadata().map_err(|e| e.to_string())?;
        if expected.dev() != actual.dev() || expected.ino() != actual.ino() {
            return Err("Artifact workspace changed.".into());
        }
        Ok(())
    };
    app.state::<Arc<OutputArtifactStore>>().resolve_registered(
        &ArtifactOwner {
            root_key: &thread.owner.root_key,
            thread_id: &request.thread_id,
            turn_id: &request.turn_id,
        },
        &root,
        &root_descriptor,
        &request.path,
        revalidate,
    )
}
#[tauri::command]
pub(crate) async fn read_agent_output_artifact(
    app: AppHandle,
    request: ReadRequest,
) -> Result<tauri::ipc::Response, String> {
    run_blocking_command(move || {
        let (thread, _) = load_thread(
            &app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
        )?;
        let registration =
            resolve_agent_attachment_owner(&app, &request.workspace_id)?.workspace_id;
        let bytes = app.state::<Arc<OutputArtifactStore>>().read(
            &ArtifactOwner {
                root_key: &thread.owner.root_key,
                thread_id: &request.thread_id,
                turn_id: &request.turn_id,
            },
            &request.artifact_id,
        )?;
        validate_still_owned(
            &app,
            &request.workspace_id,
            &registration,
            &thread,
            &request.turn_id,
        )?;
        Ok(bytes)
    })
    .await
    .map(tauri::ipc::Response::new)
}

fn validate_still_owned(
    app: &AppHandle,
    owner: &WorkspaceId,
    registration: &WorkspaceId,
    expected: &AgentThread,
    turn_id: &str,
) -> Result<(), String> {
    if resolve_agent_attachment_owner(app, owner)?.workspace_id != *registration {
        return Err("Artifact owner changed.".into());
    }
    let (current, _) = load_thread(app, owner, &expected.thread_id, turn_id)?;
    if current.owner != expected.owner || current.target != expected.target {
        return Err("Artifact thread owner changed.".into());
    }
    Ok(())
}
