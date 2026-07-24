use crate::{
    debug_adapter::{DebugBreakpoint, DebugExceptionPauseMode},
    debug_cdp::{ensure_startup_current, transport::CdpClient},
    debug_hit_condition::DebugHitCondition,
    debug_logpoint::{parse_debug_log_template, DebugLogTemplate, MAX_DEBUG_LOGPOINTS_PER_PAUSE},
};
use serde_json::json;
use std::collections::{HashMap, HashSet};

pub(crate) fn set_breakpoints_active(
    client: &CdpClient,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    active: bool,
) -> Result<(), String> {
    ensure_startup_current(mutation_is_allowed)?;
    client.request("Debugger.setBreakpointsActive", json!({ "active": active }))?;
    Ok(())
}

pub(crate) fn set_exception_pause(
    client: &CdpClient,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    mode: DebugExceptionPauseMode,
) -> Result<(), String> {
    ensure_startup_current(mutation_is_allowed)?;
    let state = match mode {
        DebugExceptionPauseMode::None => "none",
        DebugExceptionPauseMode::Uncaught => "uncaught",
        DebugExceptionPauseMode::All => "all",
    };
    client.request("Debugger.setPauseOnExceptions", json!({ "state": state }))?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct LogicalBreakpointHitState {
    hit_condition: Option<DebugHitCondition>,
    hits: u64,
    logpoint: Option<DebugLogTemplate>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum BreakpointPauseDecision {
    Pause,
    AutoResume,
    Log(Vec<DebugLogTemplate>),
}

#[derive(Default)]
pub(crate) struct CdpBreakpointHitRegistry {
    by_cdp_id: HashMap<String, LogicalBreakpointHitState>,
}

impl CdpBreakpointHitRegistry {
    pub(crate) fn register(&mut self, cdp_id: String, breakpoint: &DebugBreakpoint) {
        self.by_cdp_id.insert(
            cdp_id,
            LogicalBreakpointHitState {
                hit_condition: breakpoint.hit_condition,
                hits: 0,
                logpoint: breakpoint
                    .log_message
                    .as_deref()
                    .and_then(|message| parse_debug_log_template(message).ok()),
            },
        );
    }

    pub(crate) fn remove(&mut self, cdp_id: &str) {
        self.by_cdp_id.remove(cdp_id);
    }

    /// Counts each distinct CDP id once. Unknown ids force a visible pause because silently
    /// resuming a real debugger pause is more dangerous than surfacing an extra stop.
    pub(crate) fn record_pause<'a>(
        &mut self,
        hit_cdp_ids: impl IntoIterator<Item = &'a str>,
    ) -> BreakpointPauseDecision {
        let mut seen = HashSet::new();
        let ids = hit_cdp_ids
            .into_iter()
            .filter(|id| seen.insert(*id))
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return BreakpointPauseDecision::Pause;
        }
        let mut should_pause = false;
        let mut logpoints = Vec::new();
        for id in ids {
            let Some(state) = self.by_cdp_id.get_mut(id) else {
                should_pause = true;
                continue;
            };
            state.hits = state.hits.saturating_add(1);
            let matches = state
                .hit_condition
                .is_none_or(|condition| condition.matches(state.hits));
            if !matches {
                continue;
            }
            match &state.logpoint {
                Some(logpoint) if logpoints.len() < MAX_DEBUG_LOGPOINTS_PER_PAUSE => {
                    logpoints.push(logpoint.clone());
                }
                Some(_) => should_pause = true,
                None => should_pause = true,
            }
        }
        if should_pause {
            BreakpointPauseDecision::Pause
        } else if !logpoints.is_empty() {
            BreakpointPauseDecision::Log(logpoints)
        } else {
            BreakpointPauseDecision::AutoResume
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn breakpoint(id: &str, hit_condition: Option<DebugHitCondition>) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.into(),
            file_path: "/workspace/app.ts".into(),
            line_number: 1,
            column_number: None,
            condition: None,
            hit_condition,
            log_message: None,
            enabled: true,
            verified: false,
        }
    }

    #[test]
    fn ordinary_unknown_and_multiple_simultaneous_hits_are_deterministic() {
        let mut registry = CdpBreakpointHitRegistry::default();
        registry.register("ordinary".into(), &breakpoint("a", None));
        registry.register(
            "third".into(),
            &breakpoint("b", Some(DebugHitCondition::Equals { count: 3 })),
        );
        assert_eq!(
            registry.record_pause(["third", "third"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(
            registry.record_pause(["third", "ordinary"]),
            BreakpointPauseDecision::Pause
        );
        assert_eq!(
            registry.record_pause(["third"]),
            BreakpointPauseDecision::Pause
        );
        assert_eq!(
            registry.record_pause(["unknown"]),
            BreakpointPauseDecision::Pause
        );
    }

    #[test]
    fn reinstall_resets_count_and_saturation_never_wraps() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let breakpoint = breakpoint("a", Some(DebugHitCondition::Multiple { count: 2 }));
        registry.register("cdp".into(), &breakpoint);
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::Pause
        );
        registry.register("cdp".into(), &breakpoint);
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        registry.by_cdp_id.get_mut("cdp").unwrap().hits = u64::MAX;
        assert_eq!(
            registry.record_pause(["cdp"]),
            BreakpointPauseDecision::AutoResume
        );
        assert_eq!(registry.by_cdp_id["cdp"].hits, u64::MAX);
    }

    #[test]
    fn logpoints_reuse_hit_counts_and_ordinary_collisions_stop() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let mut logging = breakpoint("log", Some(DebugHitCondition::Equals { count: 2 }));
        logging.log_message = Some("count={count}".into());
        registry.register("logging".into(), &logging);
        registry.register("ordinary".into(), &breakpoint("stop", None));

        assert_eq!(
            registry.record_pause(["logging"]),
            BreakpointPauseDecision::AutoResume
        );
        assert!(matches!(
            registry.record_pause(["logging"]),
            BreakpointPauseDecision::Log(messages) if messages.len() == 1
        ));
        assert_eq!(
            registry.record_pause(["logging", "ordinary"]),
            BreakpointPauseDecision::Pause
        );
    }

    #[test]
    fn simultaneous_logpoints_are_bounded_and_overflow_stops_conservatively() {
        let mut registry = CdpBreakpointHitRegistry::default();
        let ids = (0..=MAX_DEBUG_LOGPOINTS_PER_PAUSE)
            .map(|index| format!("cdp-{index}"))
            .collect::<Vec<_>>();
        for id in &ids {
            let mut logging = breakpoint(id, None);
            logging.log_message = Some(format!("message {id}"));
            registry.register(id.clone(), &logging);
        }

        assert_eq!(
            registry.record_pause(ids.iter().map(String::as_str)),
            BreakpointPauseDecision::Pause
        );
    }
}
