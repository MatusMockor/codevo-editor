use super::DebugFinishGate;
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEventEmitter, DebugEventSink, DebugSessionRegistry,
    DebugStartResponse, DebugStartupPermit,
};
use crate::debug_breakpoint_policy::{breakpoints_by_file, DebugBreakpointAdapterKind};
use crate::debug_session_registry::DebugSessionMode;
use std::sync::Arc;

type DebugSessionFinishCallback = Box<dyn FnOnce(Option<i32>) + Send>;

pub(crate) struct DebugSessionFactoryStartup<'a> {
    pub(crate) permit: DebugStartupPermit,
    pub(crate) sink: Arc<dyn DebugEventSink>,
    pub(crate) registry: &'a Arc<DebugSessionRegistry>,
    pub(crate) breakpoint_kind: DebugBreakpointAdapterKind,
    pub(crate) breakpoints: &'a [DebugBreakpoint],
    pub(crate) mode: DebugSessionMode,
}

/// Shared transactional debugger publication boundary. Adapters are created
/// while their event emitter is pending; a factory failure, stale startup, or
/// registry commit failure discards all queued events and terminates the
/// adapter before returning.
pub(crate) fn start_debug_session_with_factory<F>(
    startup: DebugSessionFactoryStartup<'_>,
    factory: F,
) -> Result<DebugStartResponse, String>
where
    F: FnOnce(
        DebugEventEmitter,
        DebugSessionFinishCallback,
        Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<Box<dyn DebugAdapter>, String>,
{
    let DebugSessionFactoryStartup {
        permit,
        sink,
        registry,
        breakpoint_kind,
        breakpoints,
        mode,
    } = startup;
    let finish_gate = Arc::new(DebugFinishGate::default());
    let finish_registry = Arc::clone(registry);
    let finish_wait = Arc::clone(&finish_gate);
    let startup_registry = Arc::clone(registry);
    let startup_permit = permit.clone();
    let started = registry.start_session_with_permit_breakpoints_and_mode(
        permit,
        sink,
        breakpoint_kind,
        breakpoints_by_file(breakpoints),
        mode,
        move |emitter| {
            let session_id = emitter.session_id();
            let finish = Box::new(move |exit_code| {
                if finish_wait.wait_until_registered() {
                    finish_registry.finish_session(session_id, exit_code);
                }
            });
            let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> =
                Arc::new(move || startup_registry.startup_is_current(&startup_permit));
            factory(emitter, finish, startup_is_current)
        },
    );

    match started {
        Ok(session_id) => {
            finish_gate.complete(true);
            Ok(DebugStartResponse::Ok { session_id })
        }
        Err(message) => {
            finish_gate.complete(false);
            Err(message)
        }
    }
}
