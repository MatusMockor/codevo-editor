use super::{AgentTaskPhase, AgentTaskRegistry};
use crate::agent_questions::{AgentQuestionRequest, AgentQuestionResponse, AgentQuestionSession};
use std::{path::Path, sync::Arc};
impl AgentTaskRegistry {
    fn question_session(
        &self,
        task_id: &str,
        workspace_id: &str,
        root: &Path,
        answer: bool,
    ) -> Result<Option<Arc<AgentQuestionSession>>, String> {
        let state = self.shared.state();
        let entry = state
            .entries
            .get(task_id)
            .ok_or("Agent task is unavailable.")?;
        if entry.metadata.workspace_id != workspace_id || entry.metadata.repository_root != root {
            return Err("Agent task belongs to another workspace.".into());
        }
        if answer
            && (entry.stop_requested
                || entry.watchdog_timed_out
                || !matches!(entry.phase, AgentTaskPhase::Running))
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
            .question_session(task_id, workspace_id, root, false)?
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
        self.question_session(task_id, workspace_id, root, true)?
            .ok_or("Agent does not support questions.")?
            .answer(task_id, request_id, response)
    }
}
