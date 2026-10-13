use super::{AgentInteractionSnapshot, AgentTaskMetadata, AgentTaskPhase, AgentTaskRegistry};
use crate::agent_questions::approvals::{AgentApprovalDecision, AgentApprovalRequest};
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse, AgentQuestionSession};
use std::{path::Path, sync::Arc};
pub(super) const AGENT_INTERACTIONS_CHANGED_ERROR: &str =
    "Agent task interactions changed while they were read.";
fn ensure_task_owner(
    metadata: &AgentTaskMetadata,
    workspace_id: &str,
    workspace_root: &Path,
) -> Result<(), String> {
    if metadata.workspace_id != workspace_id
        || !workspace_root.is_absolute()
        || !metadata.repository_root.starts_with(workspace_root)
    {
        return Err("Agent task belongs to another workspace.".into());
    }
    Ok(())
}
impl AgentTaskRegistry {
    pub(super) fn listed_session(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<Option<Arc<AgentQuestionSession>>, String> {
        let state = self.shared.state();
        let Some(entry) = state.entries.get(task_id) else {
            return Ok(None);
        };
        ensure_task_owner(&entry.metadata, workspace_id, workspace_root)?;
        Ok(entry.questions.clone())
    }
    fn answering_session(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<Option<Arc<AgentQuestionSession>>, String> {
        let state = self.shared.state();
        let entry = state
            .entries
            .get(task_id)
            .ok_or("Agent task is unavailable.")?;
        ensure_task_owner(&entry.metadata, workspace_id, workspace_root)?;
        if entry.stop_requested
            || entry.watchdog_timed_out
            || !matches!(entry.phase, AgentTaskPhase::Running)
        {
            return Err("Agent task is no longer waiting.".into());
        }
        Ok(entry.questions.clone())
    }
    pub fn interactions(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<AgentInteractionSnapshot, String> {
        let Some(session) = self.listed_session(task_id, workspace_id, workspace_root)? else {
            return Ok(AgentInteractionSnapshot::empty(task_id, workspace_id));
        };
        self.interactions_of(&session, task_id, workspace_id, workspace_root)
    }
    pub(super) fn interactions_of(
        &self,
        session: &Arc<AgentQuestionSession>,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<AgentInteractionSnapshot, String> {
        session.expire_overdue();
        let snapshot = session.snapshot(task_id, workspace_id);
        let current = self.listed_session(task_id, workspace_id, workspace_root)?;
        if !current.is_some_and(|current| Arc::ptr_eq(&current, session)) {
            return Err(AGENT_INTERACTIONS_CHANGED_ERROR.into());
        }
        Ok(snapshot)
    }
    pub fn answer_question(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
        request_id: &str,
        response: AgentQuestionResponse,
    ) -> Result<AgentQuestionRequest, String> {
        self.answering_session(task_id, workspace_id, workspace_root)?
            .ok_or("Agent does not support questions.")?
            .answer(task_id, request_id, response)
    }
    pub fn answer_approval(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
        request_id: &str,
        decision: AgentApprovalDecision,
    ) -> Result<AgentApprovalRequest, String> {
        self.answering_session(task_id, workspace_id, workspace_root)?
            .ok_or("Agent does not support approvals.")?
            .approvals()
            .answer(task_id, request_id, decision)
    }
}
