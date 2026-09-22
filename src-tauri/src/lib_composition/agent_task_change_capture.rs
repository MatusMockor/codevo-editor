use super::{agent_task_start_authority::retained_root_matches_path, AgentTaskMetadata};
use crate::agent_turn_changes::{AgentTurnChangesStore, CapturePhase};
use std::{fs::File, sync::Arc};
use tauri::{AppHandle, Manager};

pub(super) fn capture(
    app: &AppHandle,
    task: &AgentTaskMetadata,
    authority: Option<&File>,
    phase: CapturePhase,
) {
    // An unavailable snapshot is preferable to reading a replacement workspace.
    let Some(authority) = authority else {
        return;
    };
    if !retained_root_matches_path(authority, &task.cwd) {
        return;
    }
    if let Some(store) = app.try_state::<Arc<AgentTurnChangesStore>>() {
        let _ = store.capture_with_authority(&task.cwd, &task.task_id, phase, authority);
    }
}
