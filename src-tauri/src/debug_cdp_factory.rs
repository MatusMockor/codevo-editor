/// Runs on the process waiter thread after exit. Wire it to
/// `DebugSessionRegistry::finish_session`; the adapter never emits
/// `Terminated`. Factory failures never invoke it.
pub(crate) fn create_node_cdp_adapter(
    root: &Path,
    launch_target: &DebugLaunchTarget,
    initial_breakpoints: &[DebugBreakpoint],
    exception_pause_mode: DebugExceptionPauseMode,
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<Box<dyn DebugAdapter>, String> {
    let internal_step_filter = launch_target.just_my_code();
    if let DebugLaunchTarget::NodeAttach { port, .. } = launch_target {
        ensure_startup_current(startup_is_current.as_ref())?;
        let target = crate::debug_inspector_attach::discover_single_node_target(root, *port)?;
        ensure_startup_current(startup_is_current.as_ref())?;
        let source_maps = SourceMapRegistry::new(root)?;
        let (disconnected_tx, disconnected_rx) = mpsc::channel();
        let adapter = NodeCdpAdapter::connect_with_source_maps(
            &target.web_socket_url,
            emitter,
            initial_breakpoints,
            NodeCdpConnectOptions {
                exception_pause_mode,
                request_timeout: CDP_REQUEST_TIMEOUT,
                ownership: DebuggeeOwnership::External,
                source_maps: Some(source_maps),
                startup: CdpStartupPolicy::Attached,
                disconnected: Some(disconnected_tx),
                startup_is_current: Arc::clone(&startup_is_current),
                internal_step_filter,
            },
        )?;
        ensure_startup_current(startup_is_current.as_ref())?;
        let confirmed = crate::debug_inspector_attach::discover_single_node_target(root, *port)?;
        ensure_startup_current(startup_is_current.as_ref())?;
        if confirmed != target {
            return Err("Node inspector target changed while attaching.".to_string());
        }
        thread::spawn(move || {
            if disconnected_rx.recv().is_ok() {
                finish(None);
            }
        });
        return Ok(Box::new(adapter));
    }
    let launch = build_launch_plan(root, launch_target)?;
    let source_maps = source_map_registry(root, launch_target)?;
    let mut process =
        spawn_node_inspector(&launch, emitter.clone(), Arc::clone(&startup_is_current))?;
    let mut adapter = match NodeCdpAdapter::connect_with_source_maps(
        &process.ws_url,
        emitter,
        initial_breakpoints,
        NodeCdpConnectOptions {
            exception_pause_mode,
            request_timeout: CDP_REQUEST_TIMEOUT,
            ownership: DebuggeeOwnership::Spawned(process.process),
            source_maps: Some(source_maps),
            startup: CdpStartupPolicy::SpawnedWaiting {
                startup_entry: launch.startup_entry.as_deref(),
            },
            disconnected: None,
            startup_is_current: Arc::clone(&startup_is_current),
            internal_step_filter,
        },
    ) {
        Ok(adapter) => adapter,
        Err(error) => {
            process.terminate_and_wait();
            return Err(error);
        }
    };
    if let Err(error) = process.ensure_unambiguous(startup_is_current.as_ref()) {
        adapter.terminate();
        process.terminate_and_wait();
        return Err(error);
    }
    process.spawn_waiter(finish);
    Ok(Box::new(adapter))
}

/// Consumes one opaque picker capability and creates an external adapter from
/// the exact kernel-bound WebSocket it authorizes. The lease is taken before
/// any network operation and there is deliberately no port-based fallback.
#[cfg(target_os = "macos")]
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_node_attach_candidate_adapter(
    publications: &NodeAttachCandidatePublicationRegistry,
    authority: &crate::debug_session_registry::DebugWorkspaceAuthority,
    lease_id: &str,
    terminals: &crate::terminal_session::TerminalSupervisor,
    root: &Path,
    initial_breakpoints: &[DebugBreakpoint],
    exception_pause_mode: DebugExceptionPauseMode,
    internal_step_filter: Option<crate::debug_adapter::DebugJustMyCodePolicy>,
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<Box<dyn DebugAdapter>, String> {
    ensure_startup_current(startup_is_current.as_ref())?;
    let target = publications
        .consume_and_revalidate(authority, lease_id, terminals)
        .map_err(|_| "Node attach candidate is no longer available.".to_string())?;
    ensure_startup_current(startup_is_current.as_ref())?;
    let source_maps = SourceMapRegistry::new(root)?;
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let held = target.connect(
        emitter,
        transport::NodeCdpHeldExternalConnectOptions {
            request_timeout: CDP_REQUEST_TIMEOUT,
            source_maps: Some(source_maps),
            disconnected: Some(disconnected_tx),
            startup_is_current: Arc::clone(&startup_is_current),
        },
    )?;
    ensure_startup_current(startup_is_current.as_ref())?;
    let mut adapter = held.initialize(
        initial_breakpoints,
        exception_pause_mode,
        internal_step_filter,
    )?;
    if let Err(error) = ensure_startup_current(startup_is_current.as_ref()) {
        adapter.terminate();
        return Err(error);
    }
    thread::spawn(move || {
        if disconnected_rx.recv().is_ok() {
            finish(None);
        }
    });
    Ok(Box::new(adapter))
}
