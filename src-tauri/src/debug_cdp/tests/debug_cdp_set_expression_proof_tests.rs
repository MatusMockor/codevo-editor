use super::*;
use crate::debug_adapter::{DebugEvaluateContext, DebugEvaluatePolicy, DebugSetExpressionRequest};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

fn evaluate_watch(
    registry: &DebugSessionRegistry,
    frame_id: u64,
    expression: &str,
) -> crate::debug_adapter::DebugVariableInfo {
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                expression,
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("watch evaluation")
}

fn breakpoint_paused_params_with_this() -> Value {
    let mut params = breakpoint_paused_params();
    params["callFrames"][0]["this"] =
        json!({"type":"object","className":"Object","objectId":"this-object-0"});
    params
}

#[test]
fn static_const_object_chain_is_proved_in_exact_order_and_exposed_atomically() {
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("scope-local-1") => json!([{
                    "name":"root", "writable":false,
                    "value":{"type":"object","className":"Object","objectId":"root-object"}
                }]),
                Some("root-object") => json!([{
                    "name":"child", "writable":false,
                    "value":{"type":"object","className":"Object","objectId":"child-object"}
                }]),
                Some("child-object") => json!([{
                    "name":"leaf", "writable":true,
                    "value":{"type":"number","value":1}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let evaluated = evaluate_watch(&registry, frames[0].frame_id, "root.child.leaf");
    assert!(evaluated.set_expression_reference.is_some());
    assert_eq!(
        server
            .params_for("Runtime.getProperties")
            .into_iter()
            .map(|params| params["objectId"].as_str().unwrap_or("").to_string())
            .collect::<Vec<_>>(),
        ["scope-local-1", "root-object", "child-object"]
    );
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
}

#[test]
fn this_static_chain_uses_authoritative_call_frame_receiver_without_scope_lookup() {
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
            event("Debugger.paused", breakpoint_paused_params_with_this()),
        ],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("this-object-0") => json!([{
                    "name":"nested", "writable":true,
                    "value":{"type":"object","className":"Object","objectId":"this-child"}
                }, {
                    "name":"bad", "get":{"type":"function","objectId":"getter"}
                }, {
                    "name":"proxy", "writable":true,
                    "value":{"type":"object","subtype":"proxy","objectId":"this-proxy"}
                }]),
                Some("this-child") => json!([{
                    "name":"leaf", "writable":true,
                    "value":{"type":"number","value":1}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let evaluated = evaluate_watch(&registry, frames[0].frame_id, "this.nested.leaf");
    assert!(evaluated.set_expression_reference.is_some());
    assert_eq!(
        server
            .params_for("Runtime.getProperties")
            .into_iter()
            .map(|params| params["objectId"].as_str().unwrap_or("").to_string())
            .collect::<Vec<_>>(),
        ["this-object-0", "this-child"]
    );
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
    for expression in ["this.bad.leaf", "this.proxy.leaf", "this.inherited"] {
        assert_eq!(
            evaluate_watch(&registry, frames[0].frame_id, expression).set_expression_reference,
            None,
            "must reject {expression}"
        );
    }
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("this-proxy")));
}

#[test]
fn first_shadowing_proxy_blocks_outer_fallback_without_invoking_traps() {
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("scope-local-1") => json!([{
                    "name":"root", "writable":true,
                    "value":{"type":"object","subtype":"proxy","objectId":"proxy-root"}
                }]),
                Some("scope-global-1") => json!([{
                    "name":"root", "writable":true,
                    "value":{"type":"object","objectId":"outer-root"}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let evaluated = evaluate_watch(&registry, frames[0].frame_id, "root.leaf");
    assert_eq!(evaluated.set_expression_reference, None);
    let proof_requests = server.params_for("Runtime.getProperties");
    assert_eq!(proof_requests.len(), 1);
    assert_eq!(proof_requests[0]["objectId"], json!("scope-local-1"));
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
}

#[test]
fn accessors_and_internal_intermediate_objects_are_rejected_without_execution() {
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("scope-local-1") => json!([
                    {"name":"accessorRoot","writable":false,"value":{"type":"object","objectId":"accessor-object"}},
                    {"name":"internalRoot","writable":false,"value":{"type":"object","objectId":"internal-object"}}
                ]),
                Some("accessor-object") => json!([{
                    "name":"leaf", "get":{"type":"function","objectId":"getter"}
                }]),
                Some("internal-object") => json!([{
                    "name":"child", "writable":true,
                    "value":{"type":"object","subtype":"internal#scope","objectId":"internal-child"}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    for expression in ["accessorRoot.leaf", "internalRoot.child.leaf"] {
        assert_eq!(
            evaluate_watch(&registry, frames[0].frame_id, expression).set_expression_reference,
            None
        );
    }
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("internal-child")));
}

#[test]
fn static_and_identifier_tokens_share_the_bounded_pause_quota() {
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("scope-local-1") => json!([
                    {"name":"root","writable":false,"value":{"type":"object","objectId":"root-object"}},
                    {"name":"count","writable":true,"value":{"type":"number","value":1}}
                ]),
                Some("root-object") => json!([{
                    "name":"leaf","writable":true,"value":{"type":"number","value":1}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    for _ in 0..100 {
        assert!(evaluate_watch(&registry, frames[0].frame_id, "root.leaf")
            .set_expression_reference
            .is_some());
    }
    assert!(evaluate_watch(&registry, frames[0].frame_id, "count")
        .set_expression_reference
        .is_some());
}

#[test]
fn static_assignment_pins_the_parent_before_rhs_and_invalidates_every_token() {
    let assigned = Arc::new(AtomicBool::new(false));
    let rhs_seen = Arc::new(AtomicBool::new(false));
    let scope_reads = Arc::new(AtomicUsize::new(0));
    let assigned_for_server = Arc::clone(&assigned);
    let rhs_for_server = Arc::clone(&rhs_seen);
    let scope_reads_for_server = Arc::clone(&scope_reads);
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
        "Debugger.evaluateOnCallFrame" => {
            let expression = params
                .get("expression")
                .and_then(Value::as_str)
                .unwrap_or("");
            let value = if expression.contains("makeValue") {
                rhs_for_server.store(true, Ordering::SeqCst);
                42
            } else {
                1
            };
            vec![result(
                id,
                json!({"result":{"type":"number","value":value,"description":value.to_string()}}),
            )]
        }
        "Runtime.getProperties" => {
            let object_id = params.get("objectId").and_then(Value::as_str);
            let value = if assigned_for_server.load(Ordering::SeqCst) {
                42
            } else {
                1
            };
            let descriptors = match object_id {
                Some("scope-local-1") => {
                    let read = scope_reads_for_server.fetch_add(1, Ordering::SeqCst);
                    let object_id = if read < 2 {
                        "root-object"
                    } else {
                        "root-wrapper"
                    };
                    json!([{
                        "name":"root", "writable":false,
                        "value":{"type":"object","objectId":object_id}
                    }])
                }
                Some("root-object") | Some("root-wrapper") => {
                    let object_id = if object_id == Some("root-object") {
                        "child-object"
                    } else {
                        "child-wrapper"
                    };
                    json!([{
                        "name":"child", "writable":false,
                        "value":{"type":"object","objectId":object_id}
                    }])
                }
                Some("child-object") | Some("child-wrapper") => json!([{
                    "name":"leaf", "writable":true,
                    "value":{"type":"number","value":value,"description":value.to_string()}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        "Runtime.callFunctionOn" => {
            if params
                .get("functionDeclaration")
                .and_then(Value::as_str)
                .is_some_and(|function| function.contains("==="))
            {
                vec![result(
                    id,
                    json!({"result":{"type":"boolean","value":true}}),
                )]
            } else {
                assigned_for_server.store(true, Ordering::SeqCst);
                vec![result(
                    id,
                    json!({"result":{"type":"number","value":42,"description":"42"}}),
                )]
            }
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let frame_id = frames[0].frame_id;
    let pause_generation = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
        .expect("session")
        .expect("pause generation");
    let expression = "root.child.leaf";
    let first = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("first static token");
    let second = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("second static token");

    let result = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: first,
                expression: expression.to_string(),
                value: "makeValue()".to_string(),
            })
        })
        .expect("session")
        .expect("static assignment");
    assert!(rhs_seen.load(Ordering::SeqCst));
    assert_eq!(result.set_expression_reference, first);
    assert_eq!(result.expression, expression);
    assert_eq!(result.value.name, expression);
    assert_eq!(result.value.value, "42");
    assert_eq!(result.value.variables_reference, 0);
    assert_eq!(result.value.can_set_value, None);
    assert_eq!(result.value.set_expression_reference, None);

    let assignment_calls = server
        .params_for("Runtime.callFunctionOn")
        .into_iter()
        .filter(|params| {
            params
                .get("functionDeclaration")
                .and_then(Value::as_str)
                .is_some_and(|function| function.contains("this[key]"))
        })
        .collect::<Vec<_>>();
    let call = assignment_calls.first().expect("one fixed assignment call");
    assert_eq!(call["objectId"], json!("child-wrapper"));
    assert_eq!(call["arguments"], json!([{"value":"leaf"},{"value":42}]));
    assert_eq!(assignment_calls.len(), 1);
    let identity_calls = server
        .params_for("Runtime.callFunctionOn")
        .into_iter()
        .filter(|params| {
            params
                .get("functionDeclaration")
                .and_then(Value::as_str)
                .is_some_and(|function| function.contains("==="))
        })
        .collect::<Vec<_>>();
    assert_eq!(identity_calls.len(), 2);
    assert_eq!(identity_calls[0]["objectId"], json!("root-object"));
    assert_eq!(
        identity_calls[0]["arguments"],
        json!([{"objectId":"root-wrapper"}])
    );
    assert_eq!(identity_calls[0]["returnByValue"], json!(true));
    assert_eq!(
        server.params_for("Debugger.evaluateOnCallFrame").len(),
        3,
        "two Watch evaluations plus exactly one RHS"
    );
    let requests = server.requests();
    let rhs_index = requests
        .iter()
        .position(|(method, params)| {
            method == "Debugger.evaluateOnCallFrame"
                && params
                    .get("expression")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.contains("makeValue"))
        })
        .expect("RHS request");
    assert!(requests[rhs_index + 1..].iter().all(|(method, params)| {
        method != "Runtime.getProperties"
            || params.get("objectId").and_then(Value::as_str) == Some("child-wrapper")
    }));

    let stale = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: second,
                expression: expression.to_string(),
                value: "99".to_string(),
            })
        })
        .expect("session")
        .expect_err("all sibling tokens are invalidated");
    assert!(stale.contains("Unknown") || stale.contains("already-used"));
}

#[test]
fn static_chain_drift_fails_before_rhs_and_consumes_the_token() {
    let scope_reads = Arc::new(AtomicUsize::new(0));
    let scope_reads_for_server = Arc::clone(&scope_reads);
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let object_id = params.get("objectId").and_then(Value::as_str);
            let descriptors = match object_id {
                Some("scope-local-1") => {
                    let read = scope_reads_for_server.fetch_add(1, Ordering::SeqCst);
                    let root = if read == 0 {
                        "root-object"
                    } else {
                        "drifted-root"
                    };
                    json!([{"name":"root","writable":false,
                        "value":{"type":"object","objectId":root}}])
                }
                Some("root-object") | Some("drifted-root") => {
                    json!([{"name":"leaf","writable":true,
                    "value":{"type":"number","value":1}}])
                }
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        "Runtime.callFunctionOn" => vec![result(
            id,
            json!({"result":{"type":"boolean","value":false}}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let frame_id = frames[0].frame_id;
    let pause_generation = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
        .expect("session")
        .expect("pause generation");
    let expression = "root.leaf";
    let token = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("static token");
    let sibling = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("sibling static token");
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: token,
                expression: expression.to_string(),
                value: "mustNotRun()".to_string(),
            })
        })
        .expect("session")
        .expect_err("drift must fail closed");
    assert!(error.contains("changed"));
    assert_eq!(
        server.params_for("Debugger.evaluateOnCallFrame").len(),
        2,
        "only the two Watch evaluations; RHS was not dispatched"
    );
    assert!(server
        .params_for("Runtime.callFunctionOn")
        .iter()
        .all(|params| params
            .get("functionDeclaration")
            .and_then(Value::as_str)
            .is_some_and(|function| function.contains("==="))));
    let replay = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: token,
                expression: expression.to_string(),
                value: "mustNotRun()".to_string(),
            })
        })
        .expect("session")
        .expect_err("consumed drift token cannot replay");
    assert!(replay.contains("Unknown") || replay.contains("already-used"));
    let sibling_error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: sibling,
                expression: expression.to_string(),
                value: "mustNotRun()".to_string(),
            })
        })
        .expect("session")
        .expect_err("pre-RHS failure invalidates sibling tokens");
    assert!(sibling_error.contains("Unknown") || sibling_error.contains("already-used"));
}

#[test]
fn revoked_mutation_permission_skips_static_prepare_and_invalidates_siblings() {
    let current = Arc::new(AtomicBool::new(true));
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
            json!({"result":{"type":"number","value":1,"description":"1"}}),
        )],
        "Runtime.getProperties" => {
            let descriptors = match params.get("objectId").and_then(Value::as_str) {
                Some("scope-local-1") => json!([{"name":"root","writable":false,
                    "value":{"type":"object","objectId":"root-object"}}]),
                Some("root-object") => json!([{"name":"leaf","writable":true,
                    "value":{"type":"number","value":1}}]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mutation_guard(&server.url, Arc::clone(&current));
    let (_, frames) = wait_for_stopped(&sink, 0);
    let frame_id = frames[0].frame_id;
    let pause_generation = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
        .expect("session")
        .expect("pause generation");
    let expression = "root.leaf";
    let first = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("first token");
    let sibling = evaluate_watch(&registry, frame_id, expression)
        .set_expression_reference
        .expect("sibling token");
    let proof_requests = server.params_for("Runtime.getProperties").len();
    let evaluations = server.params_for("Debugger.evaluateOnCallFrame").len();
    current.store(false, Ordering::SeqCst);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: first,
                expression: expression.to_string(),
                value: "mustNotRun()".to_string(),
            })
        })
        .expect("session")
        .expect_err("revoked mutation permission");
    assert!(error.contains("no longer permits"));
    assert_eq!(
        server.params_for("Runtime.getProperties").len(),
        proof_requests
    );
    assert_eq!(
        server.params_for("Debugger.evaluateOnCallFrame").len(),
        evaluations
    );
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
    let sibling_error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: sibling,
                expression: expression.to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect_err("sibling was invalidated");
    assert!(sibling_error.contains("Unknown") || sibling_error.contains("already-used"));
}

#[test]
fn identity_malformed_transport_and_owner_races_fail_before_rhs() {
    #[derive(Clone, Copy)]
    enum Failure {
        Malformed,
        Transport,
        OwnerRace,
    }

    for failure in [Failure::Malformed, Failure::Transport, Failure::OwnerRace] {
        let scope_reads = Arc::new(AtomicUsize::new(0));
        let scope_reads_for_server = Arc::clone(&scope_reads);
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
                json!({"result":{"type":"number","value":1,"description":"1"}}),
            )],
            "Runtime.getProperties" => {
                let object_id = params.get("objectId").and_then(Value::as_str);
                let descriptors = match object_id {
                    Some("scope-local-1") => {
                        let read = scope_reads_for_server.fetch_add(1, Ordering::SeqCst);
                        let root = if read == 0 {
                            "captured-root"
                        } else {
                            "current-root"
                        };
                        json!([{"name":"root","writable":false,
                            "value":{"type":"object","objectId":root}}])
                    }
                    Some("captured-root") | Some("current-root") => json!([{
                        "name":"leaf","writable":true,
                        "value":{"type":"number","value":1}
                    }]),
                    _ => json!([]),
                };
                vec![result(id, json!({"result":descriptors}))]
            }
            "Runtime.callFunctionOn" => match failure {
                Failure::Malformed => {
                    vec![result(id, json!({"result":{"type":"number","value":1}}))]
                }
                Failure::Transport => Vec::new(),
                Failure::OwnerRace => vec![
                    event("Debugger.resumed", json!({})),
                    result(id, json!({"result":{"type":"boolean","value":true}})),
                ],
            },
            _ => vec![ok(id)],
        }));
        let timeout = if matches!(failure, Failure::Transport) {
            SHORT_REQUEST_TIMEOUT
        } else {
            MOCK_REQUEST_TIMEOUT
        };
        let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), timeout);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let frame_id = frames[0].frame_id;
        let pause_generation = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
            .expect("session")
            .expect("pause generation");
        let expression = "root.leaf";
        let token = evaluate_watch(&registry, frame_id, expression)
            .set_expression_reference
            .expect("captured static token");
        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_expression(DebugSetExpressionRequest {
                    pause_generation,
                    frame_id,
                    set_expression_reference: token,
                    expression: expression.to_string(),
                    value: "mustNotRun()".to_string(),
                })
            })
            .expect("session")
            .expect_err("identity failure must fail closed");
        assert!(
            error.contains("identity") || error.contains("paused") || error.contains("owner"),
            "unexpected identity error: {error}"
        );
        assert_eq!(
            server.params_for("Debugger.evaluateOnCallFrame").len(),
            1,
            "RHS must not run for an unproven identity"
        );
        assert!(server
            .params_for("Runtime.callFunctionOn")
            .iter()
            .all(|params| params
                .get("functionDeclaration")
                .and_then(Value::as_str)
                .is_some_and(|function| function.contains("==="))));
    }
}
