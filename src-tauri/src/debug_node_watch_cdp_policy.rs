use super::super::watch_command_worker::WatchDebugCommandWorkerPolicy;
use std::time::Duration;

#[derive(Clone, Copy, Debug)]
pub(crate) struct NodeCdpWatchAdapterPolicy {
    pub(super) request_timeout: Duration,
    pub(super) command_policy: WatchDebugCommandWorkerPolicy,
    pub(super) source_maps_enabled: bool,
    pub(super) smart_step_enabled: bool,
}

impl NodeCdpWatchAdapterPolicy {
    pub(crate) fn new(
        request_timeout: Duration,
        command_policy: WatchDebugCommandWorkerPolicy,
    ) -> Result<Self, &'static str> {
        if request_timeout.is_zero() {
            return Err("watch CDP request timeout must be positive");
        }
        Ok(Self {
            request_timeout,
            command_policy,
            source_maps_enabled: true,
            smart_step_enabled: true,
        })
    }

    pub(crate) fn with_source_maps_enabled(mut self, enabled: bool) -> Self {
        self.source_maps_enabled = enabled;
        self
    }

    pub(crate) fn with_smart_step_enabled(mut self, enabled: bool) -> Self {
        self.smart_step_enabled = enabled;
        self
    }
}
