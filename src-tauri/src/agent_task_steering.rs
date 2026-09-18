use super::{
    agent_task_result_detector::ResultLineDetector, AgentProcessGroup, AgentTaskEntry,
    AgentTaskInputSlot, AgentTaskInputState, AgentTaskMetadata, AgentTaskPhase, AgentTaskRegistry,
};
use crate::agent_task_spawner::{
    agent_task_input::{
        AgentTaskInputFrame, AgentTaskSteerRejection, MAX_AGENT_STEERS_PER_TURN,
        MAX_AGENT_STEER_FRAME_BYTES,
    },
    AGENT_STDIN_FRAME_DEADLINE,
};
use std::{sync::Arc, time::Instant};

pub(super) type AgentTaskResultWatch = (Arc<AgentTaskInputSlot>, ResultLineDetector);

pub(super) fn result_watch(input: Option<Arc<AgentTaskInputSlot>>) -> Option<AgentTaskResultWatch> {
    let input = input?;
    let detector = ResultLineDetector::new().with_lifecycle(input.claude_lifecycle());
    Some((input, detector))
}

pub(super) struct AgentTaskStopTargets {
    groups: Vec<Arc<AgentProcessGroup>>,
    inputs: Vec<Arc<AgentTaskInputSlot>>,
    questions: Vec<Arc<crate::agent_questions::AgentQuestionSession>>,
}

impl AgentTaskStopTargets {
    pub(super) fn claim<'a>(entries: impl Iterator<Item = &'a mut AgentTaskEntry>) -> Self {
        let mut targets = Self {
            groups: Vec::new(),
            inputs: Vec::new(),
            questions: Vec::new(),
        };
        for entry in entries {
            entry.stop_requested = true;
            targets.groups.extend(entry.group.clone());
            targets.inputs.extend(entry.input.clone());
            targets.questions.extend(entry.questions.clone());
        }
        targets
    }

    pub(super) fn close_inputs(&self) {
        for questions in &self.questions {
            questions.close();
        }
        for input in &self.inputs {
            input.close(AgentTaskInputState::ClosedByStop);
        }
    }

    pub(super) fn into_groups(self) -> Vec<Arc<AgentProcessGroup>> {
        self.groups
    }
}

impl AgentTaskRegistry {
    pub fn metadata_for_workspace(
        &self,
        task_id: &str,
        workspace_id: &str,
    ) -> Option<AgentTaskMetadata> {
        let state = self.shared.state();
        let entry = state.entries.get(task_id)?;
        if entry.metadata.workspace_id != workspace_id {
            return None;
        }
        Some(entry.metadata.clone())
    }

    pub fn steer_for_workspace(
        &self,
        task_id: &str,
        workspace_id: &str,
        frame: Arc<[u8]>,
    ) -> Result<(), AgentTaskSteerRejection> {
        if frame.len() > MAX_AGENT_STEER_FRAME_BYTES {
            return Err(AgentTaskSteerRejection::LimitExceeded);
        }
        self.steer_for_owner(
            task_id,
            workspace_id,
            None,
            AgentTaskInputFrame::Bytes(frame),
        )
    }

    pub fn steer_for_thread(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
        frame: Arc<[u8]>,
    ) -> Result<(), AgentTaskSteerRejection> {
        self.steer_for_owner(
            task_id,
            workspace_id,
            Some(thread_id),
            AgentTaskInputFrame::Bytes(frame),
        )
    }

    pub fn input_kind_for_thread(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
    ) -> Result<
        crate::agent_task_spawner::agent_task_input::AgentTaskInputKind,
        AgentTaskSteerRejection,
    > {
        Ok(self
            .steerable_input(task_id, workspace_id, Some(thread_id))?
            .kind())
    }

    pub fn steer_input_for_thread(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
        frame: AgentTaskInputFrame,
    ) -> Result<(), AgentTaskSteerRejection> {
        self.steer_for_owner(task_id, workspace_id, Some(thread_id), frame)
    }

    fn steer_for_owner(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: Option<&str>,
        frame: AgentTaskInputFrame,
    ) -> Result<(), AgentTaskSteerRejection> {
        if !frame.bounded() {
            return Err(AgentTaskSteerRejection::LimitExceeded);
        }
        let input = self.steerable_input(task_id, workspace_id, thread_id)?;
        let deadline = Instant::now() + AGENT_STDIN_FRAME_DEADLINE;
        let outcome = input.write_input(&frame, deadline, MAX_AGENT_STEERS_PER_TURN);
        let Err(rejection) = outcome else {
            return Ok(());
        };
        if matches!(
            rejection,
            AgentTaskSteerRejection::WriteTimedOut | AgentTaskSteerRejection::WriteFailed
        ) {
            let _ = self.stop_owned(task_id, Some(workspace_id));
        }
        Err(rejection)
    }

    fn steerable_input(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: Option<&str>,
    ) -> Result<Arc<AgentTaskInputSlot>, AgentTaskSteerRejection> {
        let state = self.shared.state();
        let Some(entry) = state.entries.get(task_id) else {
            return Err(AgentTaskSteerRejection::NotRegistered);
        };
        if entry.metadata.workspace_id != workspace_id {
            return Err(AgentTaskSteerRejection::NotRegistered);
        }
        if thread_id.is_some_and(|thread_id| entry.metadata.thread_id != thread_id) {
            return Err(AgentTaskSteerRejection::NotRegistered);
        }
        if entry.stop_requested || entry.watchdog_timed_out {
            return Err(AgentTaskSteerRejection::Stopping);
        }
        if !matches!(entry.phase, AgentTaskPhase::Running) {
            return Err(AgentTaskSteerRejection::NotRunning);
        }
        let Some(input) = entry.input.clone() else {
            return Err(AgentTaskSteerRejection::InputUnavailable);
        };
        Ok(input)
    }

    pub fn close_input_for_workspace(
        &self,
        task_id: &str,
        workspace_id: &str,
    ) -> Result<(), AgentTaskSteerRejection> {
        let input = {
            let state = self.shared.state();
            let Some(entry) = state.entries.get(task_id) else {
                return Err(AgentTaskSteerRejection::NotRegistered);
            };
            if entry.metadata.workspace_id != workspace_id {
                return Err(AgentTaskSteerRejection::NotRegistered);
            }
            entry.input.clone()
        };
        close_agent_task_input(input, AgentTaskInputState::ClosedAfterResult);
        Ok(())
    }
}

pub(super) fn close_input_after_result(
    watch: Option<AgentTaskResultWatch>,
    bytes: &[u8],
) -> Option<AgentTaskResultWatch> {
    let (input, mut detector) = watch?;
    match detector.feed(bytes) {
        Ok(false) => return Some((input, detector)),
        Ok(true) => {}
        Err(message) => input.fail_background(message),
    }
    close_agent_task_input(Some(input), AgentTaskInputState::ClosedAfterResult);
    None
}

pub(super) fn close_agent_task_input(
    input: Option<Arc<AgentTaskInputSlot>>,
    state: AgentTaskInputState,
) {
    let Some(input) = input else {
        return;
    };
    input.close(state);
}
