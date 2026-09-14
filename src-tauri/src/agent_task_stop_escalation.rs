use super::{AgentProcessGroup, TERMINATE_PROCESS_GROUP_SIGNAL, WAIT_POLL_INTERVAL};
use super::{AgentProcessGroupSignalSender, AgentProcessGroupState};
use crate::agent_task_spawner::{AgentChild, AgentTaskProcessOwnership};
use std::{
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

impl AgentProcessGroup {
    pub(super) fn for_child(
        child: &dyn AgentChild,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
    ) -> Arc<Self> {
        match child.ownership() {
            AgentTaskProcessOwnership::OwnedGroup { process_group_id } => {
                Self::new(process_group_id, signals)
            }
            AgentTaskProcessOwnership::SharedSession => {
                let group = Self::new(0, signals);
                *group.state() = AgentProcessGroupState::SharedSession;
                group
            }
        }
    }
}

pub(super) fn reap_bounded(
    group: &Arc<AgentProcessGroup>,
    child: &mut dyn AgentChild,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        match group.try_wait(child) {
            Ok(Some(_)) => return,
            Err(_) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return;
                }
                thread::sleep(WAIT_POLL_INTERVAL);
            }
        }
    }
}

pub(super) fn escalate_group_stop(
    group: &Arc<AgentProcessGroup>,
    graceful: Duration,
    force: Duration,
) {
    let _ = group.signal(TERMINATE_PROCESS_GROUP_SIGNAL);
    if wait_for_group_reaped(group, graceful) {
        return;
    }
    let _ = group.force_stop();
    wait_for_group_reaped(group, force);
}

pub(super) fn wait_for_group_reaped(group: &Arc<AgentProcessGroup>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if group.is_reaped() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}

pub(super) fn wait_for_groups_reaped(groups: &[Arc<AgentProcessGroup>], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if groups.iter().all(|group| group.is_reaped()) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}
