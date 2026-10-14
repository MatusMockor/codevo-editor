use crate::agent_questions::QUESTION_EXPIRED_WHILE_SENDING_ERROR;
use crate::agent_runtime_requests::journal::{AnswerAttempt, AnswerTarget, RuntimeRequestJournal};
use crate::agent_runtime_requests::model::RequestResolution;
use crate::agent_runtime_requests::store::IntentSettlement;
use crate::agent_task_supervisor::questions::AnsweringTask;
use crate::agent_task_supervisor::AgentTaskRegistry;

pub(super) fn failed_answer_settlement(
    task: &AnsweringTask,
    request_id: &str,
    error: &str,
) -> IntentSettlement {
    if task.holds_pending(request_id) {
        return IntentSettlement::Reverted;
    }
    if error == QUESTION_EXPIRED_WHILE_SENDING_ERROR {
        return IntentSettlement::Unconfirmed;
    }
    IntentSettlement::DeliveryFailed
}

pub(super) struct JournaledAnswer<'a> {
    tasks: &'a AgentTaskRegistry,
    task: &'a AnsweringTask,
    request_id: &'a str,
    attempt: AnswerAttempt,
}

impl<'a> JournaledAnswer<'a> {
    pub(super) fn begin(
        journal: &RuntimeRequestJournal,
        tasks: &'a AgentTaskRegistry,
        task: &'a AnsweringTask,
        request_id: &'a str,
        resolution: RequestResolution,
    ) -> Self {
        let attempt = journal.begin_answer(
            AnswerTarget {
                task_scope: task.metadata.history_scope.clone(),
                thread_id: task.metadata.thread_id.clone(),
                turn_id: task.metadata.task_id.clone(),
                request_id: request_id.to_string(),
                resolution,
            },
            || tasks.next_interaction_sequence(),
        );
        Self {
            tasks,
            task,
            request_id,
            attempt,
        }
    }

    pub(super) fn finish<T>(self, answered: &Result<T, String>) {
        let Err(error) = answered else {
            self.attempt.delivered();
            return;
        };
        if !self.attempt.is_recorded() {
            return;
        }
        self.attempt.settle(
            failed_answer_settlement(self.task, self.request_id, error),
            self.tasks.next_interaction_sequence(),
        );
    }
}
