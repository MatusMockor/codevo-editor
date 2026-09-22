use super::*;

pub(super) fn capture_completion(shared: &Arc<AgentTaskShared>, task_id: &str) -> bool {
    let (metadata, authority) = {
        let mut state = shared.state();
        let Some(entry) = state.entries.get_mut(task_id) else {
            return false;
        };
        if entry.completion_claimed {
            return false;
        }
        entry.completion_claimed = true;
        if !entry.group.as_ref().is_some_and(|group| group.is_reaped()) {
            return true;
        }
        (entry.metadata.clone(), entry.cwd_authority.clone())
    };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        shared
            .sink
            .before_completion(&metadata, authority.as_deref());
    }));
    true
}

pub(super) fn complete(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    payload: AgentTaskStatusPayload,
) {
    if !capture_completion(shared, task_id) {
        return;
    }
    let released_input;
    let released_questions;
    let expired_delivery;
    let emit = {
        let mut state = shared.state();
        let emit = {
            let Some(entry) = state.entries.get_mut(task_id) else {
                return;
            };
            if matches!(entry.phase, AgentTaskPhase::Terminal) {
                return;
            }
            let pending = matches!(entry.phase, AgentTaskPhase::Pending);
            entry.phase = AgentTaskPhase::Terminal;
            entry.admission.take();
            released_input = entry.input.take();
            released_questions = entry.questions.clone();
            entry.watchdog.finish();
            let status =
                resolve_terminal_status(entry.stop_requested, entry.watchdog_timed_out, payload);
            if entry.acknowledged
                && !entry.flushing
                && !shared.sink.requires_output_acknowledgement()
            {
                entry.status_sequence += 1;
                Some(entry.metadata.status_event(entry.status_sequence, status))
            } else {
                if pending {
                    entry.status_sequence += 1;
                    let running = entry
                        .metadata
                        .status_event(entry.status_sequence, AgentTaskStatusPayload::Running);
                    push_queued(entry, QueuedAgentTaskEvent::Status(running));
                }
                entry.status_sequence += 1;
                let event = entry.metadata.status_event(entry.status_sequence, status);
                push_queued(entry, QueuedAgentTaskEvent::Status(event));
                None
            }
        };
        expired_delivery = record_terminal_entry(&mut state, task_id);
        emit
    };
    if let Some(questions) = released_questions {
        questions.finish();
    }
    close_agent_task_input(released_input, AgentTaskInputState::ClosedAfterResult);
    for event in expired_delivery {
        shared.sink.status(event);
    }
    if let Some(event) = emit {
        shared.sink.status(event);
    } else if shared.sink.requires_output_acknowledgement() {
        let _order = shared
            .output_emission_order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for event in drain_acknowledgement(shared, task_id) {
            emit_queued_event(shared.sink.as_ref(), event);
        }
    }
}

fn resolve_terminal_status(
    stop_requested: bool,
    watchdog_timed_out: bool,
    payload: AgentTaskStatusPayload,
) -> AgentTaskStatusPayload {
    if watchdog_timed_out {
        return AgentTaskStatusPayload::Failed {
            message: AGENT_TASK_TIMEOUT_MESSAGE.to_string(),
        };
    }
    if let AgentTaskStatusPayload::Failed { message } = payload {
        return AgentTaskStatusPayload::Failed {
            message: clip_failure_message(&message),
        };
    }
    if stop_requested {
        return AgentTaskStatusPayload::Stopped;
    }
    payload
}

fn record_terminal_entry(
    state: &mut AgentTaskRegistryState,
    task_id: &str,
) -> Vec<AgentTaskStatusEvent> {
    let mut expired_delivery = Vec::new();
    if !state
        .terminal_order
        .iter()
        .any(|candidate| candidate == task_id)
    {
        state.terminal_order.push_back(task_id.to_string());
    }
    while state.terminal_order.len() > MAX_TERMINAL_AGENT_TASK_ENTRIES {
        let Some(expired) = state.terminal_order.pop_front() else {
            break;
        };
        if let Some(entry) = state.entries.remove(&expired) {
            if entry.acknowledged
                && (!entry.outstanding_output.is_empty() || !entry.queued.is_empty())
            {
                expired_delivery.push(
                    entry.metadata.status_event(
                        entry.status_sequence + 1,
                        AgentTaskStatusPayload::Failed {
                            message: "Agent output delivery expired; some output is unavailable."
                                .to_string(),
                        },
                    ),
                );
            }
        }
    }
    expired_delivery
}
