use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

pub(crate) const MAX_PENDING_AGENT_TASK_STOPS: usize = 256;
pub(crate) const MAX_PENDING_AGENT_TASK_STOPS_PER_WORKSPACE: usize = 64;
pub(crate) const PENDING_AGENT_TASK_STOP_TTL: Duration = Duration::from_secs(10 * 60);
pub(crate) const AGENT_TASK_STOPPED_BEFORE_START_ERROR: &str =
    "The agent was stopped before it started.";
pub(crate) const PENDING_AGENT_TASK_STOPS_FULL_ERROR: &str =
    "Too many agent stops are waiting for their tasks to start.";
pub(crate) const PENDING_AGENT_TASK_STOP_FOREIGN_ERROR: &str =
    "Agent task stop is owned by another workspace.";

struct PendingStop {
    workspace_id: Option<String>,
    recorded_at: Instant,
}

#[derive(Default)]
pub(crate) struct PendingAgentTaskStops {
    entries: HashMap<String, PendingStop>,
}

impl PendingAgentTaskStops {
    pub(crate) fn record(
        &mut self,
        task_id: &str,
        workspace_id: Option<&str>,
        now: Instant,
    ) -> Result<(), String> {
        self.evict_expired(now);
        if let Some(existing) = self.entries.get_mut(task_id) {
            if existing.workspace_id.as_deref() != workspace_id {
                return Err(PENDING_AGENT_TASK_STOP_FOREIGN_ERROR.to_string());
            }
            existing.recorded_at = now;
            return Ok(());
        }
        if self.entries.len() >= MAX_PENDING_AGENT_TASK_STOPS
            || self.workspace_count(workspace_id) >= MAX_PENDING_AGENT_TASK_STOPS_PER_WORKSPACE
        {
            return Err(PENDING_AGENT_TASK_STOPS_FULL_ERROR.to_string());
        }
        self.entries.insert(
            task_id.to_string(),
            PendingStop {
                workspace_id: workspace_id.map(str::to_string),
                recorded_at: now,
            },
        );
        Ok(())
    }

    pub(crate) fn is_pending(&self, task_id: &str, workspace_id: &str, now: Instant) -> bool {
        self.entries
            .get(task_id)
            .is_some_and(|stop| stop.applies_to(workspace_id, now))
    }

    pub(crate) fn take(&mut self, task_id: &str, workspace_id: &str, now: Instant) -> bool {
        self.evict_expired(now);
        if !self.is_pending(task_id, workspace_id, now) {
            return false;
        }
        self.entries.remove(task_id);
        true
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    fn workspace_count(&self, workspace_id: Option<&str>) -> usize {
        self.entries
            .values()
            .filter(|stop| stop.workspace_id.as_deref() == workspace_id)
            .count()
    }

    fn evict_expired(&mut self, now: Instant) {
        self.entries.retain(|_, stop| !stop.expired(now));
    }
}

impl PendingStop {
    fn expired(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.recorded_at) >= PENDING_AGENT_TASK_STOP_TTL
    }

    fn applies_to(&self, workspace_id: &str, now: Instant) -> bool {
        if self.expired(now) {
            return false;
        }
        self.workspace_id
            .as_deref()
            .is_none_or(|expected| expected == workspace_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stopped_before_start_rejection_matches_the_frontend_wire_contract() {
        assert_eq!(
            AGENT_TASK_STOPPED_BEFORE_START_ERROR,
            "The agent was stopped before it started."
        );
    }

    #[test]
    fn a_recorded_stop_is_consumed_exactly_once_by_its_workspace() {
        let now = Instant::now();
        let mut stops = PendingAgentTaskStops::default();
        stops.record("agt-1", Some("ws-a"), now).unwrap();
        assert!(!stops.take("agt-1", "ws-b", now));
        assert!(stops.is_pending("agt-1", "ws-a", now));
        assert!(stops.take("agt-1", "ws-a", now));
        assert!(!stops.take("agt-1", "ws-a", now));
        assert_eq!(stops.len(), 0);
    }

    #[test]
    fn an_unowned_stop_applies_to_any_workspace() {
        let now = Instant::now();
        let mut stops = PendingAgentTaskStops::default();
        stops.record("agt-1", None, now).unwrap();
        assert!(stops.take("agt-1", "ws-b", now));
    }

    #[test]
    fn a_foreign_workspace_cannot_replace_a_recorded_stop() {
        let now = Instant::now();
        let mut stops = PendingAgentTaskStops::default();
        stops.record("agt-1", Some("ws-a"), now).unwrap();
        assert_eq!(
            stops.record("agt-1", Some("ws-b"), now).err().as_deref(),
            Some(PENDING_AGENT_TASK_STOP_FOREIGN_ERROR)
        );
        assert!(stops.take("agt-1", "ws-a", now));
    }

    #[test]
    fn one_workspace_cannot_exhaust_the_shared_capacity() {
        let now = Instant::now();
        let mut stops = PendingAgentTaskStops::default();
        for index in 0..MAX_PENDING_AGENT_TASK_STOPS_PER_WORKSPACE {
            stops
                .record(&format!("agt-a-{index}"), Some("ws-a"), now)
                .unwrap();
        }
        assert_eq!(
            stops
                .record("agt-a-overflow", Some("ws-a"), now)
                .err()
                .as_deref(),
            Some(PENDING_AGENT_TASK_STOPS_FULL_ERROR)
        );
        stops.record("agt-b-0", Some("ws-b"), now).unwrap();
    }

    #[test]
    fn expired_stops_neither_apply_nor_occupy_capacity() {
        let now = Instant::now();
        let later = now + PENDING_AGENT_TASK_STOP_TTL;
        let mut stops = PendingAgentTaskStops::default();
        for index in 0..MAX_PENDING_AGENT_TASK_STOPS {
            let workspace = format!("ws-{}", index % 4);
            stops
                .record(&format!("agt-{index}"), Some(&workspace), now)
                .unwrap();
        }
        assert_eq!(
            stops
                .record("agt-overflow", Some("ws-a"), now)
                .err()
                .as_deref(),
            Some(PENDING_AGENT_TASK_STOPS_FULL_ERROR)
        );
        assert!(!stops.is_pending("agt-0", "ws-0", later));
        stops.record("agt-overflow", Some("ws-a"), later).unwrap();
        assert_eq!(stops.len(), 1);
        assert!(!stops.take("agt-0", "ws-0", later));
    }
}
