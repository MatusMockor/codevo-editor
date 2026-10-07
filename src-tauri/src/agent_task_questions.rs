use super::{AgentTaskMetadata, AgentTaskPhase, AgentTaskRegistry};
use crate::agent_questions::approvals::{AgentApprovalDecision, AgentApprovalRequest};
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse, AgentQuestionSession};
use std::{path::Path, sync::Arc};
fn ensure_task_owner(
    metadata: &AgentTaskMetadata,
    workspace_id: &str,
    root: &Path,
) -> Result<(), String> {
    if metadata.workspace_id != workspace_id || metadata.repository_root != root {
        return Err("Agent task belongs to another workspace.".into());
    }
    Ok(())
}
impl AgentTaskRegistry {
    fn listed_session(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
    ) -> Result<Option<Arc<AgentQuestionSession>>, String> {
        let state = self.shared.state();
        let Some(entry) = state.entries.get(task_id) else {
            return Ok(None);
        };
        ensure_task_owner(&entry.metadata, workspace_id, root)?;
        Ok(entry.questions.clone())
    }
    fn answering_session(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
    ) -> Result<Option<Arc<AgentQuestionSession>>, String> {
        let state = self.shared.state();
        let entry = state
            .entries
            .get(task_id)
            .ok_or("Agent task is unavailable.")?;
        ensure_task_owner(&entry.metadata, workspace_id, root)?;
        if entry.stop_requested
            || entry.watchdog_timed_out
            || !matches!(entry.phase, AgentTaskPhase::Running)
        {
            return Err("Agent task is no longer waiting.".into());
        }
        Ok(entry.questions.clone())
    }
    pub fn list_questions(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
    ) -> Result<Vec<AgentQuestionRequest>, String> {
        Ok(self
            .listed_session(task_id, workspace_id, root)?
            .map_or_else(Vec::new, |s| s.list(task_id)))
    }
    pub fn answer_question(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
        request_id: &str,
        response: AgentQuestionResponse,
    ) -> Result<AgentQuestionRequest, String> {
        self.answering_session(task_id, workspace_id, root)?
            .ok_or("Agent does not support questions.")?
            .answer(task_id, request_id, response)
    }
    pub fn list_approvals(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
    ) -> Result<Vec<AgentApprovalRequest>, String> {
        Ok(self
            .listed_session(task_id, workspace_id, root)?
            .map_or_else(Vec::new, |s| s.approvals().list(task_id)))
    }
    pub fn answer_approval(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
        request_id: &str,
        decision: AgentApprovalDecision,
    ) -> Result<AgentApprovalRequest, String> {
        self.answering_session(task_id, workspace_id, root)?
            .ok_or("Agent does not support approvals.")?
            .approvals()
            .answer(task_id, request_id, decision)
    }
}
