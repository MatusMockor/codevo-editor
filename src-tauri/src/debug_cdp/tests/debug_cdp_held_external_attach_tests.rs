use super::*;
use crate::debug_adapter::{DebugAdapter, DebugExceptionPauseMode, DebugSessionRegistry};
use crate::debug_cdp::node_attach_orchestrator::{
    kernel_held_request_for_current_process, kernel_held_target_for_current_process,
    KernelHeldNodeAttachRequest,
};
use crate::debug_cdp::transport::{
    runtime_process_id, NodeCdpAdapter, NodeCdpHeldExternalConnectOptions,
};
use serde_json::{json, Value};
use std::sync::{mpsc, Arc};
use std::time::Duration;

const EXPECTED_PROCESS_ID: u32 = 41_337;

fn pid_responder(process_id: Value) -> MockResponder {
    Box::new(move |id, method, _params| {
        if method == "Runtime.evaluate" {
            vec![result(
                id,
                json!({"result": {"type": "number", "value": process_id.clone()}}),
            )]
        } else {
            vec![ok(id)]
        }
    })
}

fn held_options(disconnected: Option<mpsc::Sender<()>>) -> NodeCdpHeldExternalConnectOptions {
    NodeCdpHeldExternalConnectOptions {
        request_timeout: MOCK_REQUEST_TIMEOUT,
        source_maps: None,
        disconnected,
        startup_is_current: Arc::new(|| true),
    }
}

fn mock_server_port(url: &str) -> u16 {
    url.split_once("127.0.0.1:")
        .and_then(|(_, remainder)| remainder.split_once('/'))
        .and_then(|(port, _)| port.parse::<u16>().ok())
        .expect("mock server port")
}

fn current_process_request(url: &str) -> KernelHeldNodeAttachRequest {
    kernel_held_request_for_current_process(mock_server_port(url))
}

#[test]
fn kernel_bound_attach_correlates_pid_before_debugger_initialization() {
    let process_id = std::process::id();
    let server = MockCdpServer::start(pid_responder(json!(process_id)));
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let url = server.url.clone();

    registry
        .start_session(WORKSPACE_KEY, sink, |emitter| {
            let held = kernel_held_target_for_current_process(url.clone())
                .connect(emitter, held_options(Some(disconnected_tx)))?;
            assert_eq!(
                server.methods(),
                ["Runtime.enable", "Runtime.evaluate"],
                "debugger initialization crossed the kernel-proof barrier"
            );
            assert_eq!(
                disconnected_rx.try_recv(),
                Err(mpsc::TryRecvError::Empty),
                "the kernel-bound socket closed before initialization"
            );
            held.initialize(&[], DebugExceptionPauseMode::None, None)
                .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("publish kernel-bound attach");

    assert_eq!(
        server.methods(),
        [
            "Runtime.enable",
            "Runtime.evaluate",
            "Debugger.enable",
            "Debugger.setPauseOnExceptions",
        ]
    );
    assert_eq!(
        server.params_for("Runtime.evaluate"),
        [json!({
            "expression": "process.pid",
            "silent": true,
            "returnByValue": true,
            "awaitPromise": false,
            "throwOnSideEffect": true,
        })]
    );
    assert!(registry.deactivate_root(WORKSPACE_KEY));
}

#[test]
fn held_attach_retains_the_exact_immutable_loopback_connection_tuple() {
    let server = MockCdpServer::start(pid_responder(json!(std::process::id())));
    let registry = DebugSessionRegistry::new();
    let url = server.url.clone();
    let expected_peer_port = mock_server_port(&url);

    registry
        .start_session(
            WORKSPACE_KEY,
            Arc::new(CollectingSink::default()),
            |emitter| {
                let held = kernel_held_target_for_current_process(url.clone())
                    .connect(emitter, held_options(None))?;
                let before = held.connection_tuple_for_test();
                assert!(before.0.ip().is_loopback());
                assert!(before.1.ip().is_loopback());
                assert_ne!(before.0.port(), 0);
                assert_eq!(before.1.port(), expected_peer_port);

                held.initialize(&[], DebugExceptionPauseMode::None, None)
                    .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            },
        )
        .expect("publish attach retaining its connection tuple");

    assert!(registry.deactivate_root(WORKSPACE_KEY));
}

#[test]
fn kernel_proof_failure_starts_no_cdp_client_or_runtime_and_publishes_nothing() {
    let server = MockCdpServer::start(pid_responder(json!(std::process::id())));
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let url = server.url.clone();
    let server_port = mock_server_port(&url);
    let wrong_port = if server_port == u16::MAX {
        server_port - 1
    } else {
        server_port + 1
    };

    let error = registry
        .start_session(WORKSPACE_KEY, sink.clone(), |emitter| {
            NodeCdpAdapter::connect_kernel_bound_held_external(
                &url,
                emitter,
                kernel_held_request_for_current_process(wrong_port),
                held_options(Some(disconnected_tx)),
            )?
            .initialize(&[], DebugExceptionPauseMode::None, None)
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect_err("failed kernel proof must not publish");

    assert_eq!(
        error,
        "Node inspector process identity changed while attaching."
    );
    assert_eq!(
        disconnected_rx.recv_timeout(Duration::from_secs(2)),
        Err(mpsc::RecvTimeoutError::Disconnected),
        "the CDP client must never own the socket after proof failure"
    );
    assert!(server.methods().is_empty());
    assert!(sink.events().is_empty());
}

#[test]
fn post_runtime_snapshot_drift_closes_socket_without_debugger_or_publication() {
    let server = MockCdpServer::start(pid_responder(json!(std::process::id())));
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let url = server.url.clone();

    let error = registry
        .start_session(WORKSPACE_KEY, sink.clone(), |emitter| {
            NodeCdpAdapter::connect_kernel_bound_held_external_with_snapshot_drift_for_test(
                &url,
                emitter,
                current_process_request(&url),
                held_options(Some(disconnected_tx)),
            )?
            .initialize(&[], DebugExceptionPauseMode::None, None)
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect_err("post-Runtime snapshot drift must not publish");

    assert_eq!(
        error,
        "Node inspector process identity changed while attaching."
    );
    disconnected_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("snapshot drift closes the exact started CDP socket");
    assert_eq!(server.methods(), ["Runtime.enable", "Runtime.evaluate"]);
    assert!(server
        .methods()
        .iter()
        .all(|method| !method.starts_with("Debugger.")));
    assert_eq!(registry.session_id_for_root(WORKSPACE_KEY), None);
    assert!(sink.events().is_empty());
}

#[test]
fn mismatched_secondary_pid_closes_kernel_bound_socket() {
    let server = MockCdpServer::start(pid_responder(json!(std::process::id() + 1)));
    let registry = DebugSessionRegistry::new();
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let url = server.url.clone();

    let error = registry
        .start_session(
            WORKSPACE_KEY,
            Arc::new(CollectingSink::default()),
            |emitter| {
                kernel_held_target_for_current_process(url.clone())
                    .connect(emitter, held_options(Some(disconnected_tx)))?
                    .initialize(&[], DebugExceptionPauseMode::None, None)
                    .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            },
        )
        .expect_err("wrong PID must fail closed");

    assert_eq!(
        error,
        "Node inspector process identity changed while attaching."
    );
    disconnected_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("PID mismatch closes the held socket");
    assert_eq!(server.methods(), ["Runtime.enable", "Runtime.evaluate"]);
}

#[test]
fn runtime_pid_parser_accepts_only_a_positive_u32_number_remote() {
    assert_eq!(
        runtime_process_id(&json!({
            "result": {"type": "number", "value": EXPECTED_PROCESS_ID, "description": "41337"}
        })),
        Some(EXPECTED_PROCESS_ID)
    );
    for invalid in [
        json!({}),
        json!({"exceptionDetails": {}, "result": {"type": "number", "value": 1}}),
        json!({"result": {"type": "string", "value": "41337"}}),
        json!({"result": {"type": "number", "value": 0}}),
        json!({"result": {"type": "number", "value": -1}}),
        json!({"result": {"type": "number", "value": 1.5}}),
        json!({"result": {"type": "number", "value": u64::from(u32::MAX) + 1}}),
        json!({"result": {"type": "number", "unserializableValue": "NaN"}}),
        json!({"result": {"type": "boolean", "value": true}}),
        json!({"result": null}),
    ] {
        assert_eq!(runtime_process_id(&invalid), None, "{invalid}");
    }
}
