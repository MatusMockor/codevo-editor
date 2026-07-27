use super::watch_adapter::WatchNodeDebugAdapter;
use super::watch_cdp::{node_cdp_watch_adapters_with_start_gate, NodeCdpWatchAdapterPolicy};
use super::watch_command_worker::WatchDebugCommandWorkerPolicy;
use super::watch_controller::{WatchReconnectController, WatchReconnectPolicy};
use super::watch_desired_policy::{DesiredDebuggerPolicy, DesiredDebuggerPolicySnapshot};
use super::watch_entry_authority::NativeNodeWatchEntryAuthority;
use super::watch_generation::WatchGenerationPolicy;
use super::watch_start_gate::NativeNodeWatchStartGate;
use super::watch_supervisor::{
    watch_target_disconnect_feed, WatchSupervisorCancellation, WatchSupervisorHandle,
};
use super::{spawn_node_inspector_descriptor_bound, DebugSessionFactoryStartup};
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvaluateContext, DebugEvaluateFailure, DebugEvaluatePolicy,
    DebugEventEmitter, DebugExceptionPauseMode, DebugFunctionBreakpoint,
    DebugFunctionBreakpointVerification, DebugJustMyCodePolicy, DebugScopeInfo,
    DebugSetExpressionRequest, DebugSetExpressionResult, DebugSetVariableRequest,
    DebugSetVariableResult, DebugStackFrame, DebugStartResponse, DebugVariableFilter,
    DebugVariableInfo, DebugVariablePage, DebugVariablePageRequest, StepKind,
};
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use crate::debug_commands::start_debug_session_with_factory;
use crate::debug_exception_type_filter::DebugExceptionTypeFilter;
use crate::debug_node_launch::{
    build_strict_native_node_watch_launch_plan, NativeNodeWatchLaunchPolicy,
};
use std::fs::File;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
const COMMAND_QUEUE_CAPACITY: usize = 32;
const START_CONFIRM_TIMEOUT: Duration = Duration::from_secs(15);
const REPLACEMENT_TIMEOUT_TICKS: u64 = 10_000;
const MAX_ENDPOINT_EVENTS: u16 = 64;
const ENDPOINT_BEFORE_CLOSE_GRACE_TICKS: u64 = 2_000;

/// Non-optional startup preflight supplied by the future private caller after
/// it has composed retained-workspace and trust-snapshot ownership. Every
/// transition represented by this check must first invalidate the same debug
/// registry root; the registry permit is the lock-free ongoing authority.
#[derive(Clone)]
pub(crate) struct NativeNodeWatchLaunchAuthority {
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    verified_runtime: Option<crate::debug_node_launch::NodeLaunchProgram>,
    source_maps_enabled: bool,
    smart_step_enabled: bool,
    start_confirm_timeout: Duration,
    #[cfg(test)]
    after_supervisor_started: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl NativeNodeWatchLaunchAuthority {
    pub(crate) fn new(is_current: Arc<dyn Fn() -> bool + Send + Sync>) -> Self {
        Self {
            is_current,
            verified_runtime: None,
            source_maps_enabled: true,
            smart_step_enabled: true,
            start_confirm_timeout: START_CONFIRM_TIMEOUT,
            #[cfg(test)]
            after_supervisor_started: None,
        }
    }

    pub(crate) fn is_current(&self) -> bool {
        (self.is_current)()
    }

    pub(crate) fn with_verified_runtime(
        mut self,
        runtime: crate::debug_node_launch::NodeLaunchProgram,
    ) -> Self {
        self.verified_runtime = Some(runtime);
        self
    }

    pub(crate) fn with_source_maps_enabled(mut self, enabled: bool) -> Self {
        self.source_maps_enabled = enabled;
        self
    }

    pub(crate) fn with_smart_step_enabled(mut self, enabled: bool) -> Self {
        self.smart_step_enabled = enabled;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_start_confirm_timeout(mut self, timeout: Duration) -> Self {
        self.start_confirm_timeout = timeout;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_after_supervisor_started(
        mut self,
        hook: Arc<dyn Fn() + Send + Sync>,
    ) -> Self {
        self.after_supervisor_started = Some(hook);
        self
    }

    #[cfg(test)]
    fn notify_supervisor_started(&self) {
        if let Some(hook) = self.after_supervisor_started.as_ref() {
            hook();
        }
    }
}

pub(crate) struct NativeNodeWatchSessionStartup<'a> {
    pub(crate) factory: DebugSessionFactoryStartup<'a>,
    pub(crate) root: PathBuf,
    pub(crate) workspace_directory: File,
    pub(crate) entry_authority: NativeNodeWatchEntryAuthority,
    pub(crate) policy: NativeNodeWatchLaunchPolicy,
    pub(crate) exception_pause_mode: DebugExceptionPauseMode,
    pub(crate) exception_type_filter: DebugExceptionTypeFilter,
    pub(crate) just_my_code: Option<DebugJustMyCodePolicy>,
    pub(crate) function_breakpoints: Vec<DebugFunctionBreakpoint>,
    pub(crate) authority: NativeNodeWatchLaunchAuthority,
}

/// Lower-level Phase-0 harness for the watch lifecycle proofs. It is not a
/// production import boundary: Node reopens entry/import paths after spawn.
/// The retained-workspace caller must remain fail-closed until the complete
/// module graph can be descriptor-bound or sandboxed.
pub(crate) fn start_native_node_watch_session(
    startup: NativeNodeWatchSessionStartup<'_>,
) -> Result<DebugStartResponse, String> {
    let NativeNodeWatchSessionStartup {
        factory,
        root,
        workspace_directory,
        entry_authority,
        policy,
        exception_pause_mode,
        exception_type_filter,
        just_my_code,
        function_breakpoints,
        authority,
    } = startup;
    if !authority.is_current() {
        return Err("Native Node watch launch authority is stale.".to_string());
    }
    let mut launch = build_strict_native_node_watch_launch_plan(&root, policy)?;
    if launch.startup_entry.as_deref() != Some(entry_authority.canonical_path()) {
        return Err("Native Node watch entrypoint identity changed during startup.".to_string());
    }
    if let Some(runtime) = authority.verified_runtime.clone() {
        launch.program = runtime;
    }
    let desired = Arc::new(Mutex::new(DesiredDebuggerPolicy::new(
        DesiredDebuggerPolicySnapshot::new_with_exception_filter(
            &root,
            DebugBreakpointAdapterKind::Node,
            factory.breakpoints.to_vec(),
            exception_pause_mode,
            exception_type_filter,
            true,
            just_my_code,
        )?
        .with_initial_function_breakpoints(function_breakpoints)?,
    )));
    let adapter_policy = NodeCdpWatchAdapterPolicy::new(
        REQUEST_TIMEOUT,
        WatchDebugCommandWorkerPolicy::new(COMMAND_QUEUE_CAPACITY, COMMAND_TIMEOUT)?,
    )?
    .with_source_maps_enabled(authority.source_maps_enabled);
    let adapter_policy = adapter_policy.with_smart_step_enabled(authority.smart_step_enabled);
    let generation_policy =
        WatchGenerationPolicy::new(REPLACEMENT_TIMEOUT_TICKS, MAX_ENDPOINT_EVENTS)
            .map_err(|_| "Invalid native Node watch generation policy.".to_string())?;
    let reconnect_policy = WatchReconnectPolicy::new(ENDPOINT_BEFORE_CLOSE_GRACE_TICKS)?;

    start_debug_session_with_factory(factory, move |emitter, finish, registry_is_current| {
        if !authority.is_current() {
            return Err("Native Node watch launch authority is stale.".to_string());
        }
        let adapter = create_watch_adapter(
            root,
            workspace_directory,
            entry_authority,
            launch,
            desired,
            adapter_policy,
            generation_policy,
            reconnect_policy,
            emitter,
            finish,
            registry_is_current,
            authority.start_confirm_timeout,
        )?;
        #[cfg(test)]
        authority.notify_supervisor_started();
        Ok(adapter)
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "keeps the private launch authorities and lifecycle strategies explicit"
)]
fn create_watch_adapter(
    root: PathBuf,
    workspace_directory: File,
    entry_authority: NativeNodeWatchEntryAuthority,
    launch: crate::debug_node_launch::NodeLaunchPlan,
    desired: Arc<Mutex<DesiredDebuggerPolicy>>,
    adapter_policy: NodeCdpWatchAdapterPolicy,
    generation_policy: WatchGenerationPolicy,
    reconnect_policy: WatchReconnectPolicy,
    emitter: DebugEventEmitter,
    finish: Box<dyn FnOnce(Option<i32>) + Send>,
    authority_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    start_confirm_timeout: Duration,
) -> Result<Box<dyn DebugAdapter>, String> {
    if !authority_is_current() {
        return Err("Native Node watch launch authority is stale.".to_string());
    }
    let start_gate =
        Arc::new(NativeNodeWatchStartGate::pending(start_confirm_timeout).map_err(str::to_string)?);
    let entry_authority = Arc::new(entry_authority);
    let mut process = spawn_node_inspector_descriptor_bound(
        &launch,
        workspace_directory,
        emitter.clone(),
        Arc::clone(&authority_is_current),
    )?;
    if !authority_is_current() {
        process.terminate_and_wait();
        return Err("Native Node watch launch authority is stale.".to_string());
    }
    if let Err(error) = process.ensure_unambiguous(authority_is_current.as_ref()) {
        process.terminate_and_wait();
        return Err(error);
    }
    let initial_endpoint = match process.initial_watch_endpoint() {
        Ok(endpoint) => endpoint,
        Err(_) => {
            process.terminate_and_wait();
            return Err("The Node.js watch inspector endpoint is invalid.".to_string());
        }
    };

    let cancellation = WatchSupervisorCancellation::new();
    let (disconnect_publisher, disconnect_feed) = watch_target_disconnect_feed();
    let (connector, replay, publisher, control, logical_finish) =
        node_cdp_watch_adapters_with_start_gate(
            root,
            Arc::clone(&entry_authority),
            adapter_policy,
            emitter,
            Arc::clone(&authority_is_current),
            desired,
            disconnect_publisher,
            cancellation.clone(),
            Arc::clone(&start_gate),
        );
    let controller = WatchReconnectController::new(
        generation_policy,
        reconnect_policy,
        connector,
        replay,
        publisher,
    );
    let finish_tx = match spawn_registry_finish_relay(move |exit_code| {
        let _ = logical_finish.finish(|| finish(exit_code));
    }) {
        Ok(sender) => sender,
        Err(error) => {
            process.terminate_and_wait();
            return Err(format!(
                "Unable to start native Node watch finish owner: {error}"
            ));
        }
    };
    let supervisor = process.spawn_watch_supervisor_with_initial_endpoint(
        initial_endpoint,
        controller,
        disconnect_feed,
        cancellation,
        Box::new(move |outcome| {
            let _ = finish_tx.send(outcome.exit_code());
        }),
    )?;
    Ok(Box::new(NativeNodeWatchRegistryAdapter {
        control,
        start_gate,
        supervisor: Some(supervisor),
        _entry_authority: entry_authority,
    }))
}

fn spawn_registry_finish_relay(
    finish: impl FnOnce(Option<i32>) + Send + 'static,
) -> std::io::Result<std::sync::mpsc::SyncSender<Option<i32>>> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("native-node-watch-registry-finish".to_string())
        .spawn(move || {
            if let Ok(exit_code) = receiver.recv() {
                finish(exit_code);
            }
        })?;
    // The relay can wait on the generic registry publication gate while the
    // supervisor owner remains independently joinable. Its only sender is
    // consumed by the supervisor completion callback, so it exits after either
    // successful or rejected registration resolves.
    Ok(sender)
}

struct NativeNodeWatchRegistryAdapter {
    control: WatchNodeDebugAdapter,
    start_gate: Arc<NativeNodeWatchStartGate>,
    supervisor: Option<WatchSupervisorHandle>,
    _entry_authority: Arc<NativeNodeWatchEntryAuthority>,
}

impl NativeNodeWatchRegistryAdapter {
    fn failure(error: impl std::fmt::Debug) -> String {
        format!("Native Node watch target rejected the operation: {error:?}")
    }

    fn stop_owner(&mut self) {
        self.start_gate.cancel();
        if let Some(supervisor) = self.supervisor.take() {
            supervisor.stop();
        }
    }
}

impl Drop for NativeNodeWatchRegistryAdapter {
    fn drop(&mut self) {
        self.stop_owner();
    }
}

impl DebugAdapter for NativeNodeWatchRegistryAdapter {
    fn confirm_launch(&mut self) -> Result<(), String> {
        self.start_gate.confirm().map_err(str::to_string)
    }

    fn set_breakpoints_active(&mut self, active: bool) -> Result<(), String> {
        self.control
            .set_breakpoints_active(active)
            .map_err(Self::failure)
    }

    fn set_function_breakpoints(
        &mut self,
        breakpoints: &[DebugFunctionBreakpoint],
        generation: u64,
    ) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
        self.control
            .set_function_breakpoints(breakpoints, generation)
            .map_err(Self::failure)
    }

    fn set_exception_pause(&mut self, mode: DebugExceptionPauseMode) -> Result<(), String> {
        self.control
            .set_exception_pause(mode)
            .map_err(Self::failure)
    }

    fn set_exception_pause_filter(
        &mut self,
        mode: DebugExceptionPauseMode,
        exception_type_filter: &[String],
    ) -> Result<(), String> {
        let filter = DebugExceptionTypeFilter::parse(exception_type_filter.to_vec())?;
        self.control
            .set_exception_pause_filter(mode, filter)
            .map_err(Self::failure)
    }

    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        self.control
            .set_breakpoints(file_path, breakpoints)
            .map_err(Self::failure)
    }

    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        self.control.step(kind).map_err(Self::failure)
    }

    fn pause(&mut self) -> Result<(), String> {
        self.control.pause().map_err(Self::failure)
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        let epoch = self.control.current_pause_epoch().map_err(Self::failure)?;
        self.control
            .stack_trace(epoch)
            .map(|result| result.frames().to_vec())
            .map_err(Self::failure)
    }

    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        let epoch = self.control.current_pause_epoch().map_err(Self::failure)?;
        self.control
            .scopes(epoch, frame_id)
            .map(|result| result.scopes().to_vec())
            .map_err(Self::failure)
    }

    fn current_pause_generation(&self) -> Option<u64> {
        self.control.current_pause_epoch().ok()
    }

    fn variables_page(
        &mut self,
        request: DebugVariablePageRequest,
    ) -> Result<DebugVariablePage, String> {
        self.control.variables_page(request).map_err(Self::failure)
    }

    fn variables_page_filtered(
        &mut self,
        request: DebugVariablePageRequest,
        filter: DebugVariableFilter,
    ) -> Result<DebugVariablePage, String> {
        self.control
            .variables_page_filtered(request, filter)
            .map_err(Self::failure)
    }

    fn set_variable(
        &mut self,
        request: DebugSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String> {
        self.control.set_variable(request).map_err(Self::failure)
    }

    fn set_expression(
        &mut self,
        request: DebugSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String> {
        self.control.set_expression(request).map_err(Self::failure)
    }

    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        self.evaluate_with_policy(
            frame_id,
            expression,
            DebugEvaluatePolicy {
                context: DebugEvaluateContext::Repl,
                allow_side_effects: true,
            },
        )
        .map_err(|failure| failure.message)
    }

    fn evaluate_with_policy(
        &mut self,
        frame_id: u64,
        expression: &str,
        policy: DebugEvaluatePolicy,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        let epoch = self
            .control
            .current_pause_epoch()
            .map_err(|failure| DebugEvaluateFailure::exception(Self::failure(failure)))?;
        self.control
            .evaluate(epoch, frame_id, expression.to_string(), policy)
            .map_err(|failure| DebugEvaluateFailure::exception(Self::failure(failure)))?
    }

    fn terminate(&mut self) {
        self.stop_owner();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugEvent, DebugEventSink, DebugSessionRegistry};
    use crate::debug_session_registry::DebugSessionMode;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Sink;

    impl DebugEventSink for Sink {
        fn emit(&self, _event: DebugEvent) {}
    }

    struct Fixture {
        root: PathBuf,
        script: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-watch-session-factory-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_nanos()
            ));
            fs::create_dir_all(&root).expect("fixture root");
            let root = root.canonicalize().expect("canonical root");
            let script = root.join("server.js");
            fs::write(&script, "setInterval(() => {}, 1000);\n").expect("fixture script");
            Self { root, script }
        }

        fn policy(&self) -> NativeNodeWatchLaunchPolicy {
            NativeNodeWatchLaunchPolicy::for_test(self.script.to_string_lossy().into_owned(), 22)
                .expect("strict policy")
        }

        fn entry_authority(&self) -> NativeNodeWatchEntryAuthority {
            NativeNodeWatchEntryAuthority::from_retained(
                &self.root,
                &self.script,
                fs::File::open(&self.root).expect("entry authority root"),
                fs::File::open(&self.script).expect("retained entry"),
            )
            .expect("entry authority")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn native_watch_authority_defaults_runtime_features_on_and_preserves_disables() {
        let enabled = NativeNodeWatchLaunchAuthority::new(Arc::new(|| true));
        assert!(enabled.source_maps_enabled);
        assert!(enabled.smart_step_enabled);

        let disabled =
            NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)).with_source_maps_enabled(false);
        assert!(!disabled.source_maps_enabled);
        let disabled =
            NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)).with_smart_step_enabled(false);
        assert!(!disabled.smart_step_enabled);
    }

    fn startup<'a>(
        registry: &'a Arc<DebugSessionRegistry>,
        permit: crate::debug_adapter::DebugStartupPermit,
        breakpoints: &'a [DebugBreakpoint],
    ) -> DebugSessionFactoryStartup<'a> {
        DebugSessionFactoryStartup {
            permit,
            sink: Arc::new(Sink),
            registry,
            breakpoint_kind: DebugBreakpointAdapterKind::Node,
            breakpoints,
            mode: DebugSessionMode::OwnedLaunch,
        }
    }

    #[test]
    fn stale_composed_workspace_or_trust_authority_is_rejected_before_plan_or_spawn() {
        let fixture = Fixture::new();
        let root_key = fixture.root.to_string_lossy().into_owned();
        let registry = Arc::new(DebugSessionRegistry::new());
        registry.activate_root(&root_key);
        let permit = registry.begin_start(&root_key).expect("startup permit");

        let result = start_native_node_watch_session(NativeNodeWatchSessionStartup {
            factory: startup(&registry, permit, &[]),
            root: fixture.root.clone(),
            workspace_directory: fs::File::open(&fixture.root).expect("retained root"),
            entry_authority: fixture.entry_authority(),
            policy: fixture.policy(),
            exception_pause_mode: DebugExceptionPauseMode::None,
            exception_type_filter: DebugExceptionTypeFilter::default(),
            just_my_code: None,
            function_breakpoints: Vec::new(),
            authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| false)),
        });

        assert_eq!(
            result,
            Err("Native Node watch launch authority is stale.".to_string())
        );
        assert_eq!(registry.session_id_for_root(&root_key), None);
    }

    #[test]
    fn mismatched_retained_entry_authority_is_rejected_before_process_spawn() {
        let fixture = Fixture::new();
        let other = fixture.root.join("other.js");
        fs::write(&other, "console.log('other');\n").expect("other entry");
        let root_key = fixture.root.to_string_lossy().into_owned();
        let registry = Arc::new(DebugSessionRegistry::new());
        registry.activate_root(&root_key);
        let permit = registry.begin_start(&root_key).expect("startup permit");
        let entry_authority = NativeNodeWatchEntryAuthority::from_retained(
            &fixture.root,
            &other,
            fs::File::open(&fixture.root).expect("entry authority root"),
            fs::File::open(&other).expect("other retained entry"),
        )
        .expect("other entry authority");

        let result = start_native_node_watch_session(NativeNodeWatchSessionStartup {
            factory: startup(&registry, permit, &[]),
            root: fixture.root.clone(),
            workspace_directory: fs::File::open(&fixture.root).expect("retained root"),
            entry_authority,
            policy: fixture.policy(),
            exception_pause_mode: DebugExceptionPauseMode::None,
            exception_type_filter: DebugExceptionTypeFilter::default(),
            just_my_code: None,
            function_breakpoints: Vec::new(),
            authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)),
        });

        assert_eq!(
            result,
            Err("Native Node watch entrypoint identity changed during startup.".to_string())
        );
        assert_eq!(registry.session_id_for_root(&root_key), None);
    }

    #[test]
    fn authority_invalidation_after_plan_is_rechecked_before_process_spawn() {
        let fixture = Fixture::new();
        let root_key = fixture.root.to_string_lossy().into_owned();
        let registry = Arc::new(DebugSessionRegistry::new());
        registry.activate_root(&root_key);
        let permit = registry.begin_start(&root_key).expect("startup permit");
        let checks = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&checks);

        let result = start_native_node_watch_session(NativeNodeWatchSessionStartup {
            factory: startup(&registry, permit, &[]),
            root: fixture.root.clone(),
            workspace_directory: fs::File::open(&fixture.root).expect("retained root"),
            entry_authority: fixture.entry_authority(),
            policy: fixture.policy(),
            exception_pause_mode: DebugExceptionPauseMode::None,
            exception_type_filter: DebugExceptionTypeFilter::default(),
            just_my_code: None,
            function_breakpoints: Vec::new(),
            authority: NativeNodeWatchLaunchAuthority::new(Arc::new(move || {
                observed.fetch_add(1, Ordering::SeqCst) == 0
            })),
        });

        assert!(result
            .expect_err("stale pre-spawn authority")
            .contains("authority is stale"));
        assert!(checks.load(Ordering::SeqCst) >= 2);
        assert_eq!(registry.session_id_for_root(&root_key), None);
    }

    #[test]
    fn stale_registry_start_permit_rejects_before_process_spawn() {
        let fixture = Fixture::new();
        let root_key = fixture.root.to_string_lossy().into_owned();
        let registry = Arc::new(DebugSessionRegistry::new());
        registry.activate_root(&root_key);
        let permit = registry.begin_start(&root_key).expect("startup permit");
        assert!(
            registry.deactivate_root(&root_key)
                || registry.session_id_for_root(&root_key).is_none()
        );

        let result = start_native_node_watch_session(NativeNodeWatchSessionStartup {
            factory: startup(&registry, permit, &[]),
            root: fixture.root.clone(),
            workspace_directory: fs::File::open(&fixture.root).expect("retained root"),
            entry_authority: fixture.entry_authority(),
            policy: fixture.policy(),
            exception_pause_mode: DebugExceptionPauseMode::None,
            exception_type_filter: DebugExceptionTypeFilter::default(),
            just_my_code: None,
            function_breakpoints: Vec::new(),
            authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)),
        });

        assert!(result
            .expect_err("stale registry permit")
            .contains("lifecycle changed"));
        assert_eq!(registry.session_id_for_root(&root_key), None);
    }

    #[test]
    fn pre_spawned_finish_relay_delivers_one_early_outcome_without_blocking_owner() {
        let (observed_tx, observed_rx) = std::sync::mpsc::sync_channel(1);
        let relay = spawn_registry_finish_relay(move |exit_code| {
            observed_tx.send(exit_code).expect("finish observation");
        })
        .expect("finish relay");

        relay.send(Some(17)).expect("early outcome");
        drop(relay);

        assert_eq!(
            observed_rx.recv_timeout(Duration::from_secs(1)),
            Ok(Some(17))
        );
        assert_eq!(
            observed_rx.recv_timeout(Duration::from_millis(20)),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
        );
    }
}
