use super::*;

pub(super) fn begin_acknowledgement(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    workspace_id: Option<&str>,
) -> Result<Option<Vec<QueuedAgentTaskEvent>>, String> {
    let mut state = shared.state();
    let entry = state
        .entries
        .get_mut(task_id)
        .ok_or_else(|| AGENT_TASK_NOT_REGISTERED_ERROR.to_string())?;
    if workspace_id.is_some_and(|expected| entry.metadata.workspace_id != expected) {
        return Err(AGENT_TASK_NOT_REGISTERED_ERROR.to_string());
    }
    if entry.acknowledged {
        return Ok(None);
    }
    entry.acknowledged = true;
    entry.flushing = true;
    if matches!(entry.phase, AgentTaskPhase::Pending) {
        entry.phase = AgentTaskPhase::Running;
        entry.status_sequence += 1;
        let running = entry
            .metadata
            .status_event(entry.status_sequence, AgentTaskStatusPayload::Running);
        entry
            .queued
            .push_back(QueuedAgentTaskEvent::Status(running));
    }
    Ok(Some(take_ready_events(
        entry,
        shared.sink.requires_output_acknowledgement(),
    )))
}

pub(super) fn drain_acknowledgement(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
) -> Vec<QueuedAgentTaskEvent> {
    let mut state = shared.state();
    let terminal = {
        let Some(entry) = state.entries.get_mut(task_id) else {
            return Vec::new();
        };
        if !entry.acknowledged {
            return Vec::new();
        }
        let events = take_ready_events(entry, shared.sink.requires_output_acknowledgement());
        if !events.is_empty() {
            return events;
        }
        entry.flushing = false;
        matches!(entry.phase, AgentTaskPhase::Terminal)
            && entry.queued.is_empty()
            && entry.outstanding_output.is_empty()
    };
    if terminal {
        state.entries.remove(task_id);
        state
            .terminal_order
            .retain(|candidate| candidate != task_id);
    }
    Vec::new()
}

pub(super) fn take_ready_events(
    entry: &mut AgentTaskEntry,
    acknowledgement_required: bool,
) -> Vec<QueuedAgentTaskEvent> {
    let mut events = Vec::new();
    while let Some(event) = entry.queued.front() {
        if acknowledgement_required {
            match event {
                QueuedAgentTaskEvent::Output(_)
                    if entry.outstanding_output.len() >= MAX_UNACKNOWLEDGED_AGENT_OUTPUT_EVENTS =>
                {
                    break
                }
                QueuedAgentTaskEvent::Status(event)
                    if !matches!(event.status, AgentTaskStatusPayload::Running)
                        && !entry.outstanding_output.is_empty() =>
                {
                    break
                }
                _ => {}
            }
        }
        let event = entry.queued.pop_front().expect("front event exists");
        if acknowledgement_required {
            if let QueuedAgentTaskEvent::Output(output) = &event {
                entry.outstanding_output.push_back(output.sequence);
            }
        }
        events.push(event);
    }
    events
}

pub(super) fn emit_queued_event(sink: &dyn AgentTaskEventSink, event: QueuedAgentTaskEvent) {
    match event {
        QueuedAgentTaskEvent::Status(event) => sink.status(event),
        QueuedAgentTaskEvent::Output(event) => sink.output(event),
    }
}

/// The process has already been reaped. A disconnected renderer must not retain
/// its terminal delivery forever or prevent shutdown of the native waiter.
pub(super) fn wait_for_terminal_output_delivery(
    shared: &Arc<AgentTaskShared>,
    task_id: &str,
    timeout: Duration,
) {
    if !shared.sink.requires_output_acknowledgement() {
        return;
    }
    let deadline = Instant::now() + timeout;
    loop {
        let pending = {
            let state = shared.state();
            state.entries.get(task_id).is_some_and(|entry| {
                matches!(entry.phase, AgentTaskPhase::Terminal)
                    && (!entry.outstanding_output.is_empty() || !entry.queued.is_empty())
            })
        };
        if !pending {
            return;
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
    let _order = shared
        .output_emission_order
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let event = {
        let mut state = shared.state();
        let Some(entry) = state.entries.get(task_id) else {
            return;
        };
        if !matches!(entry.phase, AgentTaskPhase::Terminal)
            || (entry.queued.is_empty() && entry.outstanding_output.is_empty())
        {
            return;
        }
        let event = entry.metadata.status_event(
            entry.status_sequence + 1,
            AgentTaskStatusPayload::Failed {
                message: "Agent output delivery was interrupted; some output is unavailable."
                    .to_string(),
            },
        );
        state.entries.remove(task_id);
        state.terminal_order.retain(|id| id != task_id);
        event
    };
    shared.sink.status(event);
}

impl AgentTaskRegistry {
    pub fn acknowledge_output_for_workspace(
        &self,
        task_id: &str,
        workspace_id: &str,
        sequence: u64,
    ) -> Result<(), String> {
        let _order = self
            .shared
            .output_emission_order
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        {
            let mut state = self.shared.state();
            let entry = state
                .entries
                .get_mut(task_id)
                .ok_or_else(|| AGENT_TASK_NOT_REGISTERED_ERROR.to_string())?;
            if entry.metadata.workspace_id != workspace_id || !entry.acknowledged {
                return Err(AGENT_TASK_NOT_REGISTERED_ERROR.to_string());
            }
            if sequence == 0 || sequence > 9_007_199_254_740_991 {
                return Err("Invalid agent output acknowledgement sequence.".to_string());
            }
            if sequence <= entry.last_acknowledged_output {
                return Ok(());
            }
            if !entry.outstanding_output.contains(&sequence) {
                return Err("Agent output acknowledgement was not delivered.".to_string());
            }
            while entry
                .outstanding_output
                .front()
                .is_some_and(|value| *value <= sequence)
            {
                entry.outstanding_output.pop_front();
            }
            entry.last_acknowledged_output = sequence;
        }
        for event in drain_acknowledgement(&self.shared, task_id) {
            emit_queued_event(self.shared.sink.as_ref(), event);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Sink(Mutex<Vec<AgentTaskStatusEvent>>);
    impl AgentTaskEventSink for Sink {
        fn status(&self, event: AgentTaskStatusEvent) {
            self.0.lock().unwrap().push(event);
        }
        fn output(&self, _: AgentTaskOutputEvent) {}
        fn requires_output_acknowledgement(&self) -> bool {
            true
        }
    }

    fn terminal_entry() -> AgentTaskEntry {
        AgentTaskEntry {
            admission: None,
            metadata: AgentTaskMetadata {
                task_id: "delivery-test".into(),
                thread_id: "thread".into(),
                workspace_id: "workspace".into(),
                repository_root: PathBuf::from("/repo"),
                cwd: PathBuf::from("/repo"),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
            },
            phase: AgentTaskPhase::Terminal,
            acknowledged: true,
            flushing: false,
            queued: VecDeque::new(),
            status_sequence: 2,
            output_sequence: 1,
            output_incomplete_reported: false,
            outstanding_output: VecDeque::from([1]),
            last_acknowledged_output: 0,
            stdout_at_line_boundary: true,
            stderr_at_line_boundary: true,
            stop_requested: false,
            watchdog_timed_out: false,
            group: None,
            input: None,
            questions: None,
            watchdog: Arc::new(WatchdogGate::default()),
        }
    }

    #[test]
    fn terminal_ack_timeout_releases_state_and_reports_incomplete_delivery() {
        let sink = Arc::new(Sink::default());
        let entry = terminal_entry();
        let shared = Arc::new(AgentTaskShared {
            sink: sink.clone(),
            signals: Arc::new(SystemAgentProcessGroupSignalSender),
            tuning: AgentTaskRuntimeTuning::default(),
            live_worker_threads: Arc::new(AtomicUsize::new(0)),
            output_emission_order: Mutex::new(()),
            fail_next_waiter_start: AtomicBool::new(false),
            state: Mutex::new(AgentTaskRegistryState {
                entries: HashMap::from([("delivery-test".into(), entry)]),
                terminal_order: VecDeque::from(["delivery-test".into()]),
                ..AgentTaskRegistryState::default()
            }),
        });
        wait_for_terminal_output_delivery(&shared, "delivery-test", Duration::ZERO);
        assert!(shared.state().entries.is_empty());
        assert!(shared.state().terminal_order.is_empty());
        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].sequence, 3);
        assert!(
            matches!(&events[0].status, AgentTaskStatusPayload::Failed { message } if message.contains("output delivery"))
        );
    }

    #[test]
    fn consumed_terminal_does_not_report_delivery_failure() {
        let sink = Arc::new(Sink::default());
        let mut entry = terminal_entry();
        entry.outstanding_output.clear();
        let shared = Arc::new(AgentTaskShared {
            sink: sink.clone(),
            signals: Arc::new(SystemAgentProcessGroupSignalSender),
            tuning: AgentTaskRuntimeTuning::default(),
            live_worker_threads: Arc::new(AtomicUsize::new(0)),
            output_emission_order: Mutex::new(()),
            fail_next_waiter_start: AtomicBool::new(false),
            state: Mutex::new(AgentTaskRegistryState {
                entries: HashMap::from([("delivery-test".into(), entry)]),
                ..AgentTaskRegistryState::default()
            }),
        });
        wait_for_terminal_output_delivery(&shared, "delivery-test", Duration::ZERO);
        assert!(sink.0.lock().unwrap().is_empty());
    }
}
