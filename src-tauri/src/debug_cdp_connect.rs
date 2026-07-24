const HELD_PROCESS_IDENTITY_CHANGED: &str =
    "Node inspector process identity changed while attaching.";
const CDP_CONNECT_TIMEOUT: Duration = Duration::from_secs(1);

struct OpenCdpTransportOptions {
    request_timeout: Duration,
    ownership: DebuggeeOwnership,
    source_maps: Option<SourceMapRegistry>,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    pause_generation_floor: PauseGenerationFloor,
    disconnected: Option<mpsc::Sender<()>>,
    attached: bool,
}

enum CdpSocketAuthorization {
    ExistingFlow,
    #[cfg(target_os = "macos")]
    KernelBoundExternal(KernelHeldNodeAttachRequest),
}

enum CdpSocketAuthorizationProof {
    ExistingFlow,
    #[cfg(target_os = "macos")]
    KernelBoundExternal {
        connection: HeldLoopbackConnection,
        proof: KernelBoundNodeAttachConnection,
    },
}

#[cfg(target_os = "macos")]
enum PostRuntimeSnapshotProvider {
    Platform,
    #[cfg(test)]
    DeterministicDrift,
}

fn open_cdp_transport(
    ws_url: &str,
    emitter: CdpEventEmitter,
    options: OpenCdpTransportOptions,
) -> Result<NodeCdpAdapter, String> {
    let (adapter, authorization) = open_cdp_transport_with_authorization(
        ws_url,
        emitter,
        options,
        CdpSocketAuthorization::ExistingFlow,
    )?;
    match authorization {
        CdpSocketAuthorizationProof::ExistingFlow => Ok(adapter),
        #[cfg(target_os = "macos")]
        CdpSocketAuthorizationProof::KernelBoundExternal { .. } => {
            Err("Unexpected Node inspector socket authorization.".to_string())
        }
    }
}

fn open_cdp_transport_with_authorization(
    ws_url: &str,
    emitter: CdpEventEmitter,
    options: OpenCdpTransportOptions,
    authorization: CdpSocketAuthorization,
) -> Result<(NodeCdpAdapter, CdpSocketAuthorizationProof), String> {
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_CDP_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_CDP_FRAME_BYTES));
    let port = loopback_web_socket_port(ws_url)?;
    let stream = TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        CDP_CONNECT_TIMEOUT,
    )
    .map_err(|_| "Unable to connect to the loopback Node inspector WebSocket.".to_string())?;
    stream
        .set_read_timeout(Some(CDP_CONNECT_TIMEOUT))
        .and_then(|_| stream.set_write_timeout(Some(CDP_CONNECT_TIMEOUT)))
        .map_err(|_| "Unable to configure the Node inspector WebSocket.".to_string())?;
    let bounded = BoundedCdpStream {
        inner: stream,
        handshake_remaining: Some(MAX_CDP_HANDSHAKE_BYTES),
    };
    let (mut socket, _response) =
        tungstenite::client::client_with_config(ws_url, bounded, Some(config)).map_err(
            |error| {
                redact_inspector_url(&format!(
                    "Unable to connect to the Node.js inspector: {error}"
                ))
            },
        )?;
    socket.get_mut().handshake_remaining = None;
    socket
        .get_ref()
        .inner
        .set_read_timeout(Some(SOCKET_POLL_INTERVAL))
        .map_err(|error| format!("Unable to configure the inspector socket: {error}"))?;
    let authorization = match authorization {
        CdpSocketAuthorization::ExistingFlow => CdpSocketAuthorizationProof::ExistingFlow,
        #[cfg(target_os = "macos")]
        CdpSocketAuthorization::KernelBoundExternal(request) => {
            let connection = capture_held_loopback_connection(&socket.get_ref().inner, port)?;
            let proof = request
                .bind(&socket.get_ref().inner, port)
                .map_err(str::to_owned)?;
            CdpSocketAuthorizationProof::KernelBoundExternal { connection, proof }
        }
    };
    let mut shared_state = CdpShared::new_at_pause_generation_floor(
        options.source_maps,
        options.pause_generation_floor,
    );
    shared_state.first_pause_seen = options.attached;
    let shared = Arc::new(Mutex::new(shared_state));
    let client = CdpClient::start(
        socket,
        Arc::clone(&shared),
        emitter,
        options.request_timeout,
        options.disconnected,
    );
    Ok((
        NodeCdpAdapter {
            client,
            ownership: options.ownership,
            shared,
            mutation_is_allowed: options.startup_is_current,
        },
        authorization,
    ))
}

fn capture_held_loopback_connection(
    stream: &TcpStream,
    expected_peer_port: u16,
) -> Result<HeldLoopbackConnection, String> {
    let local = stream
        .local_addr()
        .map_err(|_| "Unable to identify the local inspector socket endpoint.".to_string())?;
    let peer = stream
        .peer_addr()
        .map_err(|_| "Unable to identify the remote inspector socket endpoint.".to_string())?;
    let (SocketAddr::V4(client_local), SocketAddr::V4(client_peer)) = (local, peer) else {
        return Err(
            "Node inspector WebSocket must use an exact IPv4 loopback connection.".to_string(),
        );
    };
    if *client_local.ip() != Ipv4Addr::LOCALHOST
        || *client_peer.ip() != Ipv4Addr::LOCALHOST
        || client_local.port() == 0
        || client_peer.port() != expected_peer_port
    {
        return Err("Node inspector WebSocket connection identity is invalid.".to_string());
    }
    Ok(HeldLoopbackConnection {
        client_local,
        client_peer,
    })
}

fn initialize_attached_debugger(
    adapter: &mut NodeCdpAdapter,
    emitter: &DebugEventEmitter,
    initial_breakpoints: &[DebugBreakpoint],
    exception_pause_mode: DebugExceptionPauseMode,
    internal_step_filter: Option<DebugJustMyCodePolicy>,
) -> Result<(), String> {
    ensure_startup_current(adapter.mutation_is_allowed.as_ref())?;
    adapter.client.request("Debugger.enable", json!({}))?;
    ensure_startup_current(adapter.mutation_is_allowed.as_ref())?;
    if let Some(policy) = internal_step_filter {
        let patterns: &[&str] = match policy {
            DebugJustMyCodePolicy::Dependencies => &[NODE_DEPENDENCIES_BLACKBOX_PATTERN],
            DebugJustMyCodePolicy::NodeInternals => &[NODE_INTERNALS_BLACKBOX_PATTERN],
            DebugJustMyCodePolicy::NodeInternalsAndDependencies => &[
                NODE_INTERNALS_BLACKBOX_PATTERN,
                NODE_DEPENDENCIES_BLACKBOX_PATTERN,
            ],
        };
        adapter.client.request(
            "Debugger.setBlackboxPatterns",
            json!({ "patterns": patterns }),
        )?;
        ensure_startup_current(adapter.mutation_is_allowed.as_ref())?;
    }
    adapter.set_exception_pause(exception_pause_mode)?;
    for (file_path, breakpoints) in group_breakpoints_by_file(initial_breakpoints) {
        ensure_startup_current(adapter.mutation_is_allowed.as_ref())?;
        let verified = adapter.set_breakpoints(&file_path, &breakpoints)?;
        emitter.emit(DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints: verified,
        });
    }
    Ok(())
}

fn verify_runtime_process_id(client: &CdpClient, expected_process_id: u32) -> Result<(), String> {
    if expected_process_id == 0 {
        return Err(HELD_PROCESS_IDENTITY_CHANGED.to_string());
    }
    let response = client
        .request(
            "Runtime.evaluate",
            json!({
                "expression": "process.pid",
                "silent": true,
                "returnByValue": true,
                "awaitPromise": false,
                "throwOnSideEffect": true,
            }),
        )
        .map_err(|_| HELD_PROCESS_IDENTITY_CHANGED.to_string())?;
    if runtime_process_id(&response) != Some(expected_process_id) {
        return Err(HELD_PROCESS_IDENTITY_CHANGED.to_string());
    }
    Ok(())
}

pub(super) fn runtime_process_id(response: &Value) -> Option<u32> {
    if response.get("exceptionDetails").is_some() {
        return None;
    }
    let remote = response.get("result")?;
    if remote.get("type").and_then(Value::as_str) != Some("number")
        || remote.get("unserializableValue").is_some()
    {
        return None;
    }
    let process_id = remote.get("value")?.as_u64()?;
    u32::try_from(process_id)
        .ok()
        .filter(|process_id| *process_id != 0)
}

impl NodeCdpAdapter {
    pub(super) fn connect(
        ws_url: &str,
        emitter: DebugEventEmitter,
        initial_breakpoints: &[DebugBreakpoint],
        exception_pause_mode: DebugExceptionPauseMode,
        request_timeout: Duration,
        process: Option<DebugProcessHandle>,
    ) -> Result<Self, String> {
        Self::connect_with_source_maps(
            ws_url,
            emitter,
            initial_breakpoints,
            NodeCdpConnectOptions {
                exception_pause_mode,
                request_timeout,
                ownership: process.map_or(DebuggeeOwnership::External, DebuggeeOwnership::Spawned),
                source_maps: None,
                startup: CdpStartupPolicy::SpawnedWaiting {
                    startup_entry: None,
                },
                disconnected: None,
                startup_is_current: Arc::new(|| true),
                internal_step_filter: None,
            },
        )
    }

    pub(super) fn connect_with_source_maps(
        ws_url: &str,
        emitter: DebugEventEmitter,
        initial_breakpoints: &[DebugBreakpoint],
        options: NodeCdpConnectOptions<'_>,
    ) -> Result<Self, String> {
        Self::connect_with_source_maps_at_pause_generation_floor(
            ws_url,
            emitter,
            initial_breakpoints,
            options,
            PauseGenerationFloor::INITIAL,
        )
    }

    pub(in crate::debug_cdp) fn connect_with_source_maps_at_pause_generation_floor(
        ws_url: &str,
        emitter: DebugEventEmitter,
        initial_breakpoints: &[DebugBreakpoint],
        options: NodeCdpConnectOptions<'_>,
        pause_generation_floor: PauseGenerationFloor,
    ) -> Result<Self, String> {
        let NodeCdpConnectOptions {
            exception_pause_mode,
            request_timeout,
            ownership,
            source_maps,
            startup,
            disconnected,
            startup_is_current,
            internal_step_filter,
        } = options;
        let attached = matches!(startup, CdpStartupPolicy::Attached);
        let mut adapter = open_cdp_transport(
            ws_url,
            emitter.clone().into(),
            OpenCdpTransportOptions {
                request_timeout,
                ownership,
                source_maps,
                startup_is_current: Arc::clone(&startup_is_current),
                pause_generation_floor,
                disconnected,
                attached,
            },
        )?;
        ensure_startup_current(startup_is_current.as_ref())?;
        adapter.client.request("Runtime.enable", json!({}))?;
        ensure_startup_current(startup_is_current.as_ref())?;
        initialize_attached_debugger(
            &mut adapter,
            &emitter,
            initial_breakpoints,
            exception_pause_mode,
            internal_step_filter,
        )?;
        let startup_entry = match startup {
            CdpStartupPolicy::SpawnedWaiting { startup_entry } => startup_entry,
            CdpStartupPolicy::Attached => return Ok(adapter),
        };
        let startup_probe: Option<StartupEntryProbe> = if let Some(entry) = startup_entry {
            let (probe, validation) = arm_startup_entry_probe(entry, |method, params| {
                ensure_startup_current(startup_is_current.as_ref())?;
                adapter.client.request(method, params)
            })?;
            adapter
                .shared
                .lock()
                .map_err(|error| error.to_string())?
                .startup_validation = Some(validation);
            Some(probe)
        } else {
            None
        };
        ensure_startup_current(startup_is_current.as_ref())?;
        adapter
            .client
            .request("Runtime.runIfWaitingForDebugger", json!({}))?;
        if let Some(probe) = startup_probe {
            probe.finish(request_timeout, |method, params| {
                ensure_startup_current(startup_is_current.as_ref())?;
                adapter.client.request(method, params)
            })?;
        }
        Ok(adapter)
    }

    #[cfg(target_os = "macos")]
    pub(in crate::debug_cdp) fn connect_kernel_bound_held_external(
        ws_url: &str,
        emitter: DebugEventEmitter,
        request: KernelHeldNodeAttachRequest,
        options: NodeCdpHeldExternalConnectOptions,
    ) -> Result<HeldExternalNodeCdpAttach, String> {
        Self::connect_kernel_bound_held_external_with_snapshot_provider(
            ws_url,
            emitter,
            request,
            options,
            PostRuntimeSnapshotProvider::Platform,
        )
    }

    #[cfg(all(test, target_os = "macos"))]
    pub(in crate::debug_cdp) fn connect_kernel_bound_held_external_with_snapshot_drift_for_test(
        ws_url: &str,
        emitter: DebugEventEmitter,
        request: KernelHeldNodeAttachRequest,
        options: NodeCdpHeldExternalConnectOptions,
    ) -> Result<HeldExternalNodeCdpAttach, String> {
        Self::connect_kernel_bound_held_external_with_snapshot_provider(
            ws_url,
            emitter,
            request,
            options,
            PostRuntimeSnapshotProvider::DeterministicDrift,
        )
    }

    #[cfg(target_os = "macos")]
    fn connect_kernel_bound_held_external_with_snapshot_provider(
        ws_url: &str,
        emitter: DebugEventEmitter,
        request: KernelHeldNodeAttachRequest,
        options: NodeCdpHeldExternalConnectOptions,
        snapshot_provider: PostRuntimeSnapshotProvider,
    ) -> Result<HeldExternalNodeCdpAttach, String> {
        let NodeCdpHeldExternalConnectOptions {
            request_timeout,
            source_maps,
            disconnected,
            startup_is_current,
        } = options;
        let (adapter, authorization) = open_cdp_transport_with_authorization(
            ws_url,
            emitter.clone().into(),
            OpenCdpTransportOptions {
                request_timeout,
                ownership: DebuggeeOwnership::External,
                source_maps,
                startup_is_current: Arc::clone(&startup_is_current),
                pause_generation_floor: PauseGenerationFloor::INITIAL,
                disconnected,
                attached: true,
            },
            CdpSocketAuthorization::KernelBoundExternal(request),
        )?;
        let CdpSocketAuthorizationProof::KernelBoundExternal { connection, proof } = authorization
        else {
            return Err(identity_changed());
        };
        let expected_process_id = proof.expected_process_id();
        ensure_startup_current(startup_is_current.as_ref())?;
        adapter.client.request("Runtime.enable", json!({}))?;
        ensure_startup_current(startup_is_current.as_ref())?;
        verify_runtime_process_id(&adapter.client, expected_process_id)?;
        ensure_startup_current(startup_is_current.as_ref())?;
        let proof = match snapshot_provider {
            PostRuntimeSnapshotProvider::Platform => proof.revalidate_process_snapshot(),
            #[cfg(test)]
            PostRuntimeSnapshotProvider::DeterministicDrift => {
                proof.revalidate_process_snapshot_with_drift_for_test()
            }
        }
        .map_err(str::to_owned)?;
        ensure_startup_current(startup_is_current.as_ref())?;
        Ok(HeldExternalNodeCdpAttach {
            adapter: Some(adapter),
            connection,
            emitter,
            _kernel_proof: proof,
        })
    }

    pub(crate) fn connect_watch_transport_at_pause_generation_floor(
        ws_url: &str,
        emitter: CdpEventEmitter,
        request_timeout: Duration,
        source_maps: Option<SourceMapRegistry>,
        startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
        pause_generation_floor: PauseGenerationFloor,
        disconnected: Option<mpsc::Sender<()>>,
    ) -> Result<NodeCdpAdapter, String> {
        open_cdp_transport(
            ws_url,
            emitter,
            OpenCdpTransportOptions {
                request_timeout,
                ownership: DebuggeeOwnership::External,
                source_maps,
                startup_is_current,
                pause_generation_floor,
                disconnected,
                attached: false,
            },
        )
    }
}

#[cfg(target_os = "macos")]
impl HeldExternalNodeCdpAttach {
    pub(in crate::debug_cdp) fn initialize(
        mut self,
        initial_breakpoints: &[DebugBreakpoint],
        exception_pause_mode: DebugExceptionPauseMode,
        internal_step_filter: Option<DebugJustMyCodePolicy>,
    ) -> Result<NodeCdpAdapter, String> {
        let adapter = self.adapter.as_mut().ok_or_else(identity_changed)?;
        initialize_attached_debugger(
            adapter,
            &self.emitter,
            initial_breakpoints,
            exception_pause_mode,
            internal_step_filter,
        )?;
        self.adapter.take().ok_or_else(identity_changed)
    }
}

#[cfg(target_os = "macos")]
impl Drop for HeldExternalNodeCdpAttach {
    fn drop(&mut self) {
        if let Some(adapter) = self.adapter.as_mut() {
            adapter.terminate();
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
impl HeldExternalNodeCdpAttach {
    pub(in crate::debug_cdp) fn connection_tuple_for_test(&self) -> (SocketAddrV4, SocketAddrV4) {
        (self.connection.client_local, self.connection.client_peer)
    }
}

fn identity_changed() -> String {
    HELD_PROCESS_IDENTITY_CHANGED.to_string()
}
