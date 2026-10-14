use super::{AgentInteractionSnapshot, AgentTaskMetadata, AgentTaskPhase, AgentTaskRegistry};
use crate::agent_questions::approvals::{
    AgentApprovalDecision, AgentApprovalRequest, AgentApprovalStatus,
};
use crate::agent_questions::{
    AgentQuestionRequest, AgentQuestionResponse, AgentQuestionSession, AgentQuestionStatus,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
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
    pub fn next_interaction_sequence(&self) -> u64 {
        self.shared.state().interaction_leases.next_sequence()
    }
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
    fn answering_task(
        &self,
        owner: (&str, &str, &Path),
        unsupported: &str,
    ) -> Result<AnsweringTask, String> {
        let (task_id, workspace_id, workspace_root) = owner;
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
        Ok(AnsweringTask {
            metadata: entry.metadata.clone(),
            session: entry.questions.clone().ok_or(unsupported)?,
            workspace_root: workspace_root.to_path_buf(),
        })
    }
    pub fn question_task(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<AnsweringTask, String> {
        self.answering_task(
            (task_id, workspace_id, workspace_root),
            "Agent does not support questions.",
        )
    }
    pub fn approval_task(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<AnsweringTask, String> {
        self.answering_task(
            (task_id, workspace_id, workspace_root),
            "Agent does not support approvals.",
        )
    }
    fn ensure_still_answering(&self, task: &AnsweringTask) -> Result<(), String> {
        let current = self.answering_session(
            &task.metadata.task_id,
            &task.metadata.workspace_id,
            &task.workspace_root,
        )?;
        if !current.is_some_and(|current| Arc::ptr_eq(&current, &task.session)) {
            return Err(AGENT_INTERACTIONS_CHANGED_ERROR.into());
        }
        Ok(())
    }
    pub fn answer_question(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
        request_id: &str,
        response: AgentQuestionResponse,
    ) -> Result<AgentQuestionRequest, String> {
        let task = self.question_task(task_id, workspace_id, workspace_root)?;
        self.answer_captured_question(&task, request_id, response)
    }
    pub fn answer_approval(
        &self,
        task_id: &str,
        workspace_id: &str,
        workspace_root: &Path,
        request_id: &str,
        decision: AgentApprovalDecision,
    ) -> Result<AgentApprovalRequest, String> {
        let task = self.approval_task(task_id, workspace_id, workspace_root)?;
        self.answer_captured_approval(&task, request_id, decision)
    }
    pub fn answer_captured_question(
        &self,
        task: &AnsweringTask,
        request_id: &str,
        response: AgentQuestionResponse,
    ) -> Result<AgentQuestionRequest, String> {
        self.ensure_still_answering(task)?;
        task.session
            .answer(&task.metadata.task_id, request_id, response)
    }
    pub fn answer_captured_approval(
        &self,
        task: &AnsweringTask,
        request_id: &str,
        decision: AgentApprovalDecision,
    ) -> Result<AgentApprovalRequest, String> {
        self.ensure_still_answering(task)?;
        task.session
            .approvals()
            .answer(&task.metadata.task_id, request_id, decision)
    }
}

pub struct AnsweringTask {
    pub metadata: AgentTaskMetadata,
    session: Arc<AgentQuestionSession>,
    workspace_root: PathBuf,
}

impl AnsweringTask {
    pub fn session(&self) -> &Arc<AgentQuestionSession> {
        &self.session
    }

    pub fn holds_pending(&self, request_id: &str) -> bool {
        let task_id = &self.metadata.task_id;
        let question = self.session.list(task_id).iter().any(|request| {
            request.id == request_id && request.status == AgentQuestionStatus::Pending
        });
        let approval = self
            .session
            .approvals()
            .list(task_id)
            .iter()
            .any(|request| {
                request.id == request_id && request.status == AgentApprovalStatus::Pending
            });
        question || approval
    }
}
