use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEventEmitter, DebugExceptionPauseMode, DebugLaunchTarget,
};
use std::path::Path;
use std::sync::Arc;

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_debug_adapter_with_exception_filter(
    root: &Path,
    launch: &DebugLaunchTarget,
    breakpoints: &[DebugBreakpoint],
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: &[String],
    source_maps_enabled: bool,
    stop_on_entry: bool,
    emitter: DebugEventEmitter,
    finish: Box<dyn FnOnce(Option<i32>) + Send>,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<Box<dyn DebugAdapter>, String> {
    crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(
        exception_type_filter.to_vec(),
    )?;
    if launch.is_node() {
        return crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
            root,
            launch,
            breakpoints,
            exception_pause_mode,
            exception_type_filter,
            source_maps_enabled,
            stop_on_entry,
            emitter,
            finish,
            startup_is_current,
        );
    }
    if exception_pause_mode == DebugExceptionPauseMode::None && exception_type_filter.is_empty() {
        return crate::debug_dbgp::create_php_dbgp_adapter(
            root,
            launch,
            breakpoints,
            emitter,
            finish,
        );
    }
    Err("Exception pause modes are only available for Node.js debug sessions.".to_string())
}
