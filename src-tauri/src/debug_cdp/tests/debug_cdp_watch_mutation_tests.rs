use super::*;
use crate::debug_adapter::{DebugEvaluateContext, DebugEvaluatePolicy, DebugVariablePageRequest};
use serde_json::{json, Value};

#[test]
fn watch_cycle_back_edges_cannot_launder_mutable_ancestor_provenance() {
    let server = MockCdpServer::start(Box::new(|id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {
                "type": "object", "className": "Object",
                "objectId": "watch-a", "description": "A"
            }}),
        )],
        "Runtime.getProperties" => {
            let response = match params.get("objectId").and_then(Value::as_str) {
                Some("watch-a") => json!({"result": [{
                    "name": "b", "writable": true,
                    "value": {
                        "type": "object", "className": "Object",
                        "objectId": "watch-b", "description": "B"
                    }
                }]}),
                Some("watch-b") => json!({
                    "result": [
                        {
                            "name": "frozenBack", "writable": false,
                            "value": {"type": "object", "objectId": "watch-a"}
                        },
                        {
                            "name": "symbolBack", "writable": true,
                            "symbol": {"type": "symbol", "description": "Symbol(back)"},
                            "value": {"type": "object", "objectId": "watch-a"}
                        }
                    ],
                    "privateProperties": [{
                        "name": "#privateBack", "writable": true,
                        "value": {"type": "object", "objectId": "watch-a"}
                    }]
                }),
                _ => json!({"result": []}),
            };
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let (pause_generation, watched) = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            (
                adapter.current_pause_generation().expect("pause"),
                adapter
                    .evaluate_with_policy(
                        frames[0].frame_id,
                        "a",
                        DebugEvaluatePolicy {
                            context: DebugEvaluateContext::Watch,
                            allow_side_effects: false,
                        },
                    )
                    .expect("watch evaluation"),
            )
        })
        .expect("session");
    let a_page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id: frames[0].frame_id,
                variables_reference: watched.variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("A properties");
    let b = &a_page.variables[0];
    assert_eq!(b.can_set_value, Some(true));
    assert!(b.variables_reference > 0);
    let b_page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id: frames[0].frame_id,
                variables_reference: b.variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("B properties");
    assert_eq!(b_page.variables.len(), 3);
    for back_edge in b_page.variables {
        assert_eq!(back_edge.can_set_value, None, "{}", back_edge.name);
        assert_eq!(back_edge.variables_reference, 0, "{}", back_edge.name);
    }
}

#[test]
fn watch_property_names_share_the_exact_set_variable_admission_boundary() {
    let exact_multibyte = "é".repeat(512);
    let oversized_multibyte = "é".repeat(512) + "x";
    let exact_for_server = exact_multibyte.clone();
    let oversized_for_server = oversized_multibyte.clone();
    let server = MockCdpServer::start(Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {"type":"object", "objectId":"names-root"}}),
        )],
        "Runtime.getProperties" => {
            let response = if params.get("objectId").and_then(Value::as_str) == Some("names-root") {
                json!({"result": [
                    {"name":"", "writable":true, "value":{"type":"object", "objectId":"empty"}},
                    {"name":"control\nname", "writable":true, "value":{"type":"object", "objectId":"control"}},
                    {"name":"x".repeat(1_025), "writable":true, "value":{"type":"object", "objectId":"ascii-long"}},
                    {"name":exact_for_server, "writable":true, "value":{"type":"object", "objectId":"exact"}},
                    {"name":oversized_for_server, "writable":true, "value":{"type":"object", "objectId":"utf8-long"}}
                ]})
            } else {
                json!({"result": [{
                    "name":"leaf", "writable":true,
                    "value":{"type":"number", "value":1, "description":"1"}
                }]})
            };
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let (pause_generation, watched) = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            (
                adapter.current_pause_generation().expect("pause"),
                adapter
                    .evaluate_with_policy(
                        frames[0].frame_id,
                        "owner",
                        DebugEvaluatePolicy {
                            context: DebugEvaluateContext::Watch,
                            allow_side_effects: false,
                        },
                    )
                    .expect("watch"),
            )
        })
        .expect("session");
    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id: frames[0].frame_id,
                variables_reference: watched.variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("name properties");
    assert_eq!(page.variables.len(), 5);
    for variable in &page.variables {
        let valid = variable.name == exact_multibyte;
        assert_eq!(variable.can_set_value, valid.then_some(true));
        assert!(variable.variables_reference > 0);
        let descendants = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id: frames[0].frame_id,
                    variables_reference: variable.variables_reference,
                    start: 0,
                    count: 10,
                })
            })
            .expect("session")
            .expect("descendants");
        assert_eq!(
            descendants.variables[0].can_set_value,
            valid.then_some(true),
            "{} bytes",
            variable.name.len()
        );
    }
}
