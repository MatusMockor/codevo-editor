use super::*;
use crate::debug_adapter::DebugJustMyCodePolicy;
use std::sync::atomic::{AtomicBool, Ordering};

const EXPECTED_NODE_INTERNALS_PATTERN: &str = r"^(?:node:|internal/)";
const EXPECTED_NODE_DEPENDENCIES_PATTERN: &str = r"(?:^|[/\\])node_modules[/\\]";

#[test]
fn handshake_sends_enable_sequence_before_run_if_waiting() {
    let server = MockCdpServer::start(simple_responder());

    let (_registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

    assert_eq!(
        server.methods(),
        vec![
            "Runtime.enable".to_string(),
            "Debugger.enable".to_string(),
            "Debugger.setPauseOnExceptions".to_string(),
            "Runtime.runIfWaitingForDebugger".to_string(),
        ]
    );
    assert_eq!(
        server.params_for("Debugger.setPauseOnExceptions"),
        vec![json!({ "state": "none" })]
    );
}

fn start_session_with_internal_step_filter(
    server_url: &str,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<(DebugSessionRegistry, Arc<CollectingSink>), String> {
    start_session_with_step_filter(
        server_url,
        DebugJustMyCodePolicy::NodeInternals,
        startup_is_current,
    )
}

fn start_session_with_step_filter(
    server_url: &str,
    policy: DebugJustMyCodePolicy,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<(DebugSessionRegistry, Arc<CollectingSink>), String> {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let url = server_url.to_string();
    registry.start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
        NodeCdpAdapter::connect_with_source_maps(
            &url,
            emitter,
            &[],
            NodeCdpConnectOptions {
                exception_pause_mode: DebugExceptionPauseMode::None,
                request_timeout: MOCK_REQUEST_TIMEOUT,
                ownership: DebuggeeOwnership::External,
                source_maps: None,
                startup: CdpStartupPolicy::SpawnedWaiting {
                    startup_entry: None,
                },
                disconnected: None,
                startup_is_current,
                internal_step_filter: Some(policy),
            },
        )
        .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
    })?;
    Ok((registry, sink))
}

#[test]
fn dependency_step_filter_uses_only_fixed_direct_script_url_patterns() {
    assert!(EXPECTED_NODE_DEPENDENCIES_PATTERN.len() < 64);
    for (policy, expected_patterns) in [
        (
            DebugJustMyCodePolicy::Dependencies,
            json!([EXPECTED_NODE_DEPENDENCIES_PATTERN]),
        ),
        (
            DebugJustMyCodePolicy::NodeInternalsAndDependencies,
            json!([
                EXPECTED_NODE_INTERNALS_PATTERN,
                EXPECTED_NODE_DEPENDENCIES_PATTERN
            ]),
        ),
    ] {
        let server = MockCdpServer::start(simple_responder());
        let (_registry, _sink) =
            start_session_with_step_filter(&server.url, policy, Arc::new(|| true))
                .expect("start dependency-filtered session");

        assert_eq!(
            server.params_for("Debugger.setBlackboxPatterns"),
            vec![json!({ "patterns": expected_patterns })]
        );
        let methods = server.methods();
        let blackbox = methods
            .iter()
            .position(|method| method == "Debugger.setBlackboxPatterns")
            .expect("blackbox request");
        let run = methods
            .iter()
            .position(|method| method == "Runtime.runIfWaitingForDebugger")
            .expect("run request");
        assert!(blackbox < run);
    }
}

#[test]
fn node_internal_step_filter_is_fixed_bounded_and_set_before_run() {
    assert_eq!(
        serde_json::to_value(DebugJustMyCodePolicy::NodeInternals)
            .expect("serialize internal filter"),
        json!("nodeInternals")
    );
    assert!(EXPECTED_NODE_INTERNALS_PATTERN.len() < 64);

    let server = MockCdpServer::start(simple_responder());
    let (_registry, _sink) =
        start_session_with_internal_step_filter(&server.url, Arc::new(|| true))
            .expect("start filtered session");

    assert_eq!(
        server.methods(),
        vec![
            "Runtime.enable".to_string(),
            "Debugger.enable".to_string(),
            "Debugger.setBlackboxPatterns".to_string(),
            "Debugger.setPauseOnExceptions".to_string(),
            "Runtime.runIfWaitingForDebugger".to_string(),
        ]
    );
    assert_eq!(
        server.params_for("Debugger.setBlackboxPatterns"),
        vec![json!({ "patterns": [EXPECTED_NODE_INTERNALS_PATTERN] })]
    );
}

#[test]
fn node_internal_step_filter_failure_never_runs_the_debuggee() {
    for policy in [
        DebugJustMyCodePolicy::Dependencies,
        DebugJustMyCodePolicy::NodeInternals,
        DebugJustMyCodePolicy::NodeInternalsAndDependencies,
    ] {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.setBlackboxPatterns" {
                vec![error_reply(id, "rejected")]
            } else {
                vec![ok(id)]
            }
        }));

        let error = match start_session_with_step_filter(&server.url, policy, Arc::new(|| true)) {
            Ok(_) => panic!("blackbox failure must abort startup"),
            Err(error) => error,
        };

        assert!(error.contains("rejected"));
        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Debugger.setBlackboxPatterns".to_string(),
            ]
        );
    }
}

#[test]
fn node_internal_step_filter_ack_is_startup_fenced_before_run() {
    let current = Arc::new(AtomicBool::new(true));
    let flip = Arc::clone(&current);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| {
        if method == "Debugger.setBlackboxPatterns" {
            flip.store(false, Ordering::SeqCst);
        }
        vec![ok(id)]
    }));
    let guard = Arc::clone(&current);

    let error = match start_session_with_internal_step_filter(
        &server.url,
        Arc::new(move || guard.load(Ordering::SeqCst)),
    ) {
        Ok(_) => panic!("revoked startup cannot continue after blackbox ACK"),
        Err(error) => error,
    };

    assert!(error.contains("lifecycle changed"));
    assert_eq!(
        server.methods(),
        vec![
            "Runtime.enable".to_string(),
            "Debugger.enable".to_string(),
            "Debugger.setBlackboxPatterns".to_string(),
        ]
    );
}
