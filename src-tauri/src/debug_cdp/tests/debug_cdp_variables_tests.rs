use super::*;
use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluatePolicy, DebugSetVariableRequest, DebugVariableFilter,
    DebugVariablePageRequest, StepKind,
};
use crate::debug_cdp::variables::{
    MutableScopeKind, ObjectReferenceAccess, ObjectReferenceMutation,
    MAX_CDP_OBJECT_REFERENCES_PER_PAUSE, MAX_CDP_PROPERTY_DESCRIPTORS,
    MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE,
};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

mod clipboard_tests {
    include!("debug_cdp_clipboard_tests.rs");
}

mod watch_mutation_tests {
    include!("debug_cdp_watch_mutation_tests.rs");
}

mod set_expression_proof_tests {
    include!("debug_cdp_set_expression_proof_tests.rs");
}

mod multiline_evaluate_name_tests {
    use super::*;
    include!("debug_cdp_multiline_evaluate_name_tests.rs");
}

mod variable_range_tests {
    use super::*;
    include!("debug_cdp_variable_range_tests.rs");
}

mod collection_variables_tests {
    use super::*;
    include!("debug_cdp_collection_variables_tests.rs");
}

#[path = "debug_cdp_collection_variables_real_integration_tests.rs"]
mod collection_variables_real_integration_tests;

fn variables_responder(properties: Value) -> MockResponder {
    Box::new(move |id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(id, json!({"result": properties}))],
        _ => vec![ok(id)],
    })
}

fn first_scope_owner(registry: &DebugSessionRegistry, sink: &CollectingSink) -> (u64, u64, u64) {
    let (_, frames) = wait_for_stopped(sink, 0);
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            let pause_generation = adapter
                .current_pause_generation()
                .expect("current pause generation");
            let scopes = adapter.scopes(frames[0].frame_id).expect("scopes");
            (
                pause_generation,
                frames[0].frame_id,
                scopes[0].variables_reference,
            )
        })
        .expect("session")
}

fn start_session_with_mutation_guard(
    server_url: &str,
    current: Arc<AtomicBool>,
) -> (DebugSessionRegistry, Arc<CollectingSink>) {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(CollectingSink::default());
    let url = server_url.to_string();
    registry
        .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
            let guard = Arc::clone(&current);
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
                    startup_is_current: Arc::new(move || guard.load(Ordering::SeqCst)),
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("start guarded mock session");
    (registry, sink)
}

#[test]
fn pause_inventory_preserves_scope_slot_provenance_and_fails_other_scopes_closed() {
    let mut state = CdpShared::new(None);
    let scope_types = [
        "global", "local", "closure", "catch", "module", "with", "block", "script", "eval",
        "unknown",
    ];
    let scope_chain = scope_types
        .iter()
        .enumerate()
        .map(|(index, scope_type)| {
            json!({
                "type": scope_type,
                "object": {"objectId": format!("scope-{index}")}
            })
        })
        .collect::<Vec<_>>();
    let params = json!({
        "callFrames": [{
            "callFrameId": "call-frame-7",
            "functionName": "run",
            "url": "file:///workspace/app.js",
            "location": {"lineNumber": 0, "columnNumber": 0},
            "scopeChain": scope_chain
        }]
    });

    let inventory = build_pause_inventory(&params, &mut state).expect("pause inventory");
    assert_eq!(inventory.object_ids.len(), scope_types.len());
    for (index, scope_type) in scope_types.iter().enumerate() {
        let reference = inventory
            .object_ids
            .values()
            .find(|reference| reference.object_id == format!("scope-{index}"))
            .expect("scope reference");
        assert_eq!(reference.access, ObjectReferenceAccess::ScopeRoot);
        let expected = match *scope_type {
            "local" => ObjectReferenceMutation::ScopeSlot {
                call_frame_id: "call-frame-7".to_string(),
                scope_number: index as u32,
                scope_kind: MutableScopeKind::Local,
            },
            "closure" => ObjectReferenceMutation::ScopeSlot {
                call_frame_id: "call-frame-7".to_string(),
                scope_number: index as u32,
                scope_kind: MutableScopeKind::Closure,
            },
            "catch" => ObjectReferenceMutation::ScopeSlot {
                call_frame_id: "call-frame-7".to_string(),
                scope_number: index as u32,
                scope_kind: MutableScopeKind::Catch,
            },
            _ => ObjectReferenceMutation::ReadOnly,
        };
        assert_eq!(reference.mutation, expected);
    }
}

#[test]
fn variables_expose_only_adapter_proven_writable_metadata() {
    let properties = json!([
        {"name": "mutable", "writable": true, "value": {"type": "number", "value": 1}},
        {"name": "frozen", "writable": false, "value": {"type": "number", "value": 2}},
        {"name": "unknown", "value": {"type": "number", "value": 3}},
        {
            "name": "symbolic",
            "symbol": {"type": "symbol"},
            "writable": true,
            "value": {"type": "number", "value": 4}
        }
    ]);
    let server = MockCdpServer::start(variables_responder(properties));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let variables = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("variables page")
        .variables;

    assert_eq!(variables[0].can_set_value, Some(true));
    assert!(variables[1..]
        .iter()
        .all(|variable| variable.can_set_value.is_none()));
    assert_eq!(
        serde_json::to_value(&variables[0])
            .expect("serialize mutable variable")
            .get("canSetValue"),
        Some(&json!(true))
    );
    assert!(serde_json::to_value(&variables[1])
        .expect("serialize read-only variable")
        .get("canSetValue")
        .is_none());
}

#[test]
fn only_watch_evaluation_provenance_makes_nested_object_properties_writable() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
                "objectId": "evaluated-object", "description": "Object"
            }}),
        )],
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "key", "writable": true,
                "value": {"type": "number", "value": 1, "description": "1"}
            }]}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let pause_generation = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.current_pause_generation().expect("pause")
        })
        .expect("session");

    for (context, writable) in [
        (DebugEvaluateContext::Watch, true),
        (DebugEvaluateContext::Repl, false),
    ] {
        let evaluated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(
                    frames[0].frame_id,
                    "holder",
                    DebugEvaluatePolicy {
                        context,
                        allow_side_effects: false,
                    },
                )
            })
            .expect("session")
            .expect("evaluation");
        assert!(evaluated.variables_reference > 0);
        assert_eq!(evaluated.can_set_value, None);
        let page = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id: frames[0].frame_id,
                    variables_reference: evaluated.variables_reference,
                    start: 0,
                    count: 10,
                })
            })
            .expect("session")
            .expect("properties");
        assert_eq!(page.variables[0].can_set_value, writable.then_some(true));
    }
}

#[test]
fn read_only_scope_provenance_cannot_be_laundered_through_object_descendants() {
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
        "Runtime.getProperties" => {
            let object_id = params.get("objectId").and_then(Value::as_str);
            let properties = match object_id {
                Some("scope-local-1") => json!([{
                    "name": "mutableRoot",
                    "writable": true,
                    "value": {"type": "object", "objectId": "mutable-child"}
                }]),
                Some("scope-global-1") => json!([{
                    "name": "readOnlyRoot",
                    "writable": true,
                    "value": {"type": "object", "objectId": "read-only-child"}
                }]),
                Some("mutable-child") | Some("read-only-child") => json!([{
                    "name": "leaf",
                    "writable": true,
                    "value": {"type": "number", "value": 1}
                }]),
                _ => json!([]),
            };
            vec![result(id, json!({"result": properties}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let (pause_generation, frame_id, scopes) = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            (
                adapter
                    .current_pause_generation()
                    .expect("current pause generation"),
                frames[0].frame_id,
                adapter.scopes(frames[0].frame_id).expect("scopes"),
            )
        })
        .expect("session");

    for (scope_index, expected_writable) in [(0, true), (1, false)] {
        let root_page = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: scopes[scope_index].variables_reference,
                    start: 0,
                    count: 100,
                })
            })
            .expect("session")
            .expect("root page");
        assert_eq!(
            root_page.variables[0].can_set_value,
            expected_writable.then_some(true)
        );

        let descendant_page = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: root_page.variables[0].variables_reference,
                    start: 0,
                    count: 100,
                })
            })
            .expect("session")
            .expect("descendant page");
        assert_eq!(
            descendant_page.variables[0].can_set_value,
            expected_writable.then_some(true)
        );
    }
}

#[test]
fn set_variable_uses_exact_scope_slot_and_evaluates_the_value_once() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
            json!({"result": {"type": "number", "value": 42}}),
        )],
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "count",
                "writable": true,
                "value": {"type": "number", "value": 42}
            }]}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let assigned = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "count".to_string(),
                value: "21 * 2 // safe trailing comment".to_string(),
            })
        })
        .expect("session")
        .expect("assignment");

    assert_eq!(assigned.value.value, "42");
    assert_eq!(assigned.value.can_set_value, Some(true));
    assert_eq!(server.params_for("Debugger.evaluateOnCallFrame").len(), 1);
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
    assert_eq!(
        server.params_for("Debugger.setVariableValue"),
        vec![json!({
            "scopeNumber": 0,
            "variableName": "count",
            "newValue": {"value": 42},
            "callFrameId": "cf-0",
        })]
    );
}

#[test]
fn throwing_side_effecting_rhs_is_indeterminate_and_never_assigned_or_retried() {
    let expression = "(globalThis.marker = (globalThis.marker ?? 0) + 1, (() => { throw 1; })())";
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "count",
                "writable": true,
                "value": {"type": "number", "value": 1}
            }]}),
        )],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({
                "result": {"type": "undefined"},
                "exceptionDetails": {"text": "Uncaught", "exception": {"description": "1"}}
            }),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "count".to_string(),
                value: expression.to_string(),
            })
        })
        .expect("session")
        .expect_err("throwing RHS must be indeterminate");

    assert!(error.contains("indeterminate"));
    assert!(error.contains("not retried"));
    assert_eq!(server.params_for("Debugger.evaluateOnCallFrame").len(), 1);
    assert!(
        server.params_for("Debugger.evaluateOnCallFrame")[0]["expression"]
            .as_str()
            .expect("expression")
            .contains("globalThis.marker")
    );
    assert!(server.params_for("Debugger.setVariableValue").is_empty());
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn lifecycle_flip_after_rhs_evaluation_is_indeterminate_and_prevents_assignment() {
    let current = Arc::new(AtomicBool::new(true));
    let responder_current = Arc::clone(&current);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "count",
                "writable": true,
                "value": {"type": "number", "value": 1}
            }]}),
        )],
        "Debugger.evaluateOnCallFrame" => {
            responder_current.store(false, Ordering::SeqCst);
            vec![result(
                id,
                json!({"result": {"type": "number", "value": 2}}),
            )]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mutation_guard(&server.url, Arc::clone(&current));
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "count".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect_err("revoked mutation must be indeterminate after RHS dispatch");

    assert!(error.contains("indeterminate"));
    assert_eq!(server.params_for("Debugger.evaluateOnCallFrame").len(), 1);
    assert!(server.params_for("Debugger.setVariableValue").is_empty());
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn resumed_during_post_assignment_refresh_never_returns_stale_success() {
    let property_reads = Arc::new(AtomicUsize::new(0));
    let responder_reads = Arc::clone(&property_reads);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
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
        "Runtime.getProperties" => {
            let read = responder_reads.fetch_add(1, Ordering::SeqCst);
            let reply = result(
                id,
                json!({"result": [{
                    "name": "count",
                    "writable": true,
                    "value": {"type": "number", "value": 2}
                }]}),
            );
            if read == 2 {
                vec![event("Debugger.resumed", json!({})), reply]
            } else {
                vec![reply]
            }
        }
        "Debugger.evaluateOnCallFrame" => {
            vec![result(
                id,
                json!({"result": {"type": "number", "value": 2}}),
            )]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "count".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect_err("resumed pause must not return a stale success");

    assert!(error.contains("indeterminate"));
    assert_eq!(server.params_for("Debugger.setVariableValue").len(), 1);
}

#[test]
fn set_scope_object_reacquires_a_fresh_handle_then_releases_the_temporary_group() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "item",
                "writable": true,
                "value": {"type": "object", "objectId": "fresh-assigned-object"}
            }]}),
        )],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {
                "type": "object",
                "objectId": "temporary-evaluated-object",
                "description": "Object"
            }}),
        )],
        "Runtime.callFunctionOn" => vec![result(
            id,
            json!({"result": {
                "type": "object",
                "objectId": "fresh-assigned-object",
                "description": "Object"
            }}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let assigned = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "item".to_string(),
                value: "({ nested: true })".to_string(),
            })
        })
        .expect("session")
        .expect("object assignment");
    assert!(assigned.value.variables_reference > 0);
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);

    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: assigned.value.variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("transferred object remains inspectable");
}

#[test]
fn set_object_property_never_interpolates_the_name_or_assigned_value() {
    let hostile_name = "x\"]; globalThis.pwned = true; //";
    let expected_name = hostile_name.to_string();
    let responder_name = expected_name.clone();
    let property_reads = Arc::new(AtomicUsize::new(0));
    let responder_reads = Arc::clone(&property_reads);
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
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => vec![result(
            id,
            json!({"result": [{
                "name": "target",
                "writable": true,
                "value": {"type": "object", "objectId": "target-object"}
            }]}),
        )],
        "Runtime.getProperties" => {
            let read = responder_reads.fetch_add(1, Ordering::SeqCst);
            let value = if read < 2 {
                json!({"type": "number", "value": 0})
            } else {
                json!({"type": "object", "objectId": "assigned-object", "description": "Object"})
            };
            vec![result(
                id,
                json!({"result": [{
                    "name": responder_name,
                    "writable": true,
                    "value": value
                }]}),
            )]
        }
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {"type": "object", "objectId": "evaluated-object"}}),
        )],
        "Runtime.callFunctionOn" => vec![result(
            id,
            json!({"result": {"type": "object", "objectId": "assigned-object", "description": "Object"}}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let root = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("root page");
    let result = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: root.variables[0].variables_reference,
                name: expected_name.clone(),
                value: "({ payload: 'not interpolated' })".to_string(),
            })
        })
        .expect("session")
        .expect("property assignment");
    assert!(result.value.variables_reference > 0);

    let calls = server.params_for("Runtime.callFunctionOn");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["objectId"], json!("target-object"));
    assert_eq!(
        calls[0]["functionDeclaration"],
        json!("function(key, value) { this[key] = value; return this[key]; }")
    );
    assert_eq!(calls[0]["arguments"][0], json!({"value": hostile_name}));
    assert_eq!(
        calls[0]["arguments"][1],
        json!({"objectId": "evaluated-object"})
    );
    assert!(!calls[0]["functionDeclaration"]
        .as_str()
        .expect("function")
        .contains("pwned"));
}

#[test]
fn object_property_call_exception_after_dispatch_is_indeterminate() {
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
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => vec![result(
            id,
            json!({"result": [{
                "name": "target",
                "writable": true,
                "value": {"type": "object", "objectId": "target-object"}
            }]}),
        )],
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "key",
                "writable": true,
                "value": {"type": "number", "value": 1}
            }]}),
        )],
        "Debugger.evaluateOnCallFrame" => {
            vec![result(
                id,
                json!({"result": {"type": "number", "value": 2}}),
            )]
        }
        "Runtime.callFunctionOn" => vec![result(
            id,
            json!({
                "result": {"type": "undefined"},
                "exceptionDetails": {"text": "Uncaught after property call"}
            }),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let root = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("root page");
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: root.variables[0].variables_reference,
                name: "key".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect_err("post-dispatch call exception must be indeterminate");

    assert!(error.contains("indeterminate"));
    assert!(error.contains("not retried"));
    assert_eq!(server.params_for("Runtime.callFunctionOn").len(), 1);
    assert_eq!(server.params_for("Debugger.evaluateOnCallFrame").len(), 1);
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn set_variable_rejects_read_only_scope_before_evaluation() {
    let server = MockCdpServer::start(flow_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let (pause_generation, frame_id, global_reference) = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            let scopes = adapter.scopes(frames[0].frame_id).expect("scopes");
            (
                adapter.current_pause_generation().expect("pause"),
                frames[0].frame_id,
                scopes[1].variables_reference,
            )
        })
        .expect("session");
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: global_reference,
                name: "globalValue".to_string(),
                value: "1".to_string(),
            })
        })
        .expect("session")
        .expect_err("global scope must be read-only");
    assert!(error.contains("read-only"));
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
}

#[test]
fn set_variable_rejects_const_descriptor_before_evaluation() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(
            id,
            json!({"result": [{
                "name": "constant",
                "writable": false,
                "value": {"type": "number", "value": 1}
            }]}),
        )],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {"type": "number", "value": 2}}),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference,
                name: "constant".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect_err("const must be rejected");
    assert!(error.contains("safely writable"));
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
}

#[test]
fn scopes_and_variables_are_served_from_the_pause_cache_and_get_properties() {
    let server = MockCdpServer::start(flow_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let stack = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.stack_trace())
        .expect("session")
        .expect("stack trace");
    let scopes = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.scopes(frames[0].frame_id))
        .expect("session")
        .expect("scopes");
    let variables = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation: adapter
                    .current_pause_generation()
                    .expect("current pause generation"),
                frame_id: frames[0].frame_id,
                variables_reference: scopes[0].variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("variables")
        .variables;
    assert_eq!(stack, frames);
    assert_eq!(
        (scopes[0].name.as_str(), scopes[0].expensive),
        ("Local", false)
    );
    assert_eq!(
        (scopes[1].name.as_str(), scopes[1].expensive),
        ("Global", true)
    );
    assert_eq!(
        server.params_for("Runtime.getProperties"),
        vec![json!({
            "objectId": "scope-local-1",
            "ownProperties": true,
            "generatePreview": false,
        })]
    );
    assert_eq!(variables.len(), 3);
    assert_eq!(
        (variables[0].name.as_str(), variables[0].value.as_str()),
        ("count", "7")
    );
    assert_eq!(variables[0].value_type.as_deref(), Some("number"));
    assert_eq!(variables[0].evaluate_name.as_deref(), Some("count"));
    assert_eq!(variables[0].variables_reference, 0);
    assert_eq!(
        (variables[1].name.as_str(), variables[1].value.as_str()),
        ("label", "ready")
    );
    assert_eq!(
        (variables[2].name.as_str(), variables[2].value.as_str()),
        ("user", "User")
    );
    assert_eq!(variables[2].value_type.as_deref(), Some("User"));
    assert_eq!(variables[2].evaluate_name.as_deref(), Some("user"));
    assert!(variables[2].variables_reference > 0);
    let nested = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation: adapter
                    .current_pause_generation()
                    .expect("current pause generation"),
                frame_id: frames[0].frame_id,
                variables_reference: variables[2].variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("nested variables");
    assert_eq!(nested.variables.len(), 3);
    assert_eq!(
        nested.variables[0].evaluate_name.as_deref(),
        Some("user.count")
    );
    assert_eq!(
        nested.variables[1].evaluate_name.as_deref(),
        Some("user.label")
    );
    assert_eq!(
        nested.variables[2].evaluate_name.as_deref(),
        Some("user.user")
    );
}

#[test]
fn variables_fail_closed_for_symbol_internal_synthetic_and_missing_parent_accessors() {
    let properties = json!([
        {"name": "normal", "value": {"type": "object", "description": "Normal", "objectId": "normal-id"}},
        {"name": "symbolic", "symbol": {"type": "symbol"}, "value": {"type": "number", "value": 1}},
        {"name": "[[Prototype]]", "value": {"type": "object", "subtype": "internal#location", "objectId": "internal-id"}}
    ]);
    let server = MockCdpServer::start(variables_responder(properties));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("variables page");

    assert_eq!(page.variables[0].evaluate_name.as_deref(), Some("normal"));
    assert_eq!(page.variables[1].evaluate_name, None);
    assert_eq!(page.variables[2].evaluate_name, None);

    let internal_reference = page.variables[2].variables_reference;
    let nested = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: internal_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("nested variables");
    assert!(nested
        .variables
        .iter()
        .all(|variable| variable.evaluate_name.is_none()));
}

#[test]
fn cdp_pages_build_private_numeric_and_escaped_nested_accessors() {
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
        "Runtime.getProperties" => {
            if params.get("objectId") == Some(&json!("scope-local-1")) {
                vec![result(
                    id,
                    json!({"result": [
                        {"name": "this", "value": {"type": "object", "objectId": "this-id"}}
                    ]}),
                )]
            } else if params.get("objectId") == Some(&json!("private-child-id")) {
                vec![result(
                    id,
                    json!({
                        "result": [],
                        "privateProperties": [
                            {"name": "#nested", "value": {"type": "number", "value": 2}}
                        ]
                    }),
                )]
            } else {
                vec![result(
                    id,
                    json!({
                        "result": [
                            {"name": "0", "value": {"type": "string", "value": "zero"}},
                            {"name": "full name", "value": {"type": "string", "value": "Ada"}},
                            {"name": "a\"b\\c", "value": {"type": "boolean", "value": true}},
                            {"name": "#ordinary", "value": {"type": "number", "value": 3}}
                        ],
                        "privateProperties": [
                            {"name": "#secret", "value": {"type": "number", "value": 1}},
                            {"name": "#child", "value": {"type": "object", "objectId": "private-child-id"}}
                        ]
                    }),
                )]
            }
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let root = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("scope page");
    assert_eq!(root.variables[0].evaluate_name.as_deref(), Some("this"));

    let nested = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: root.variables[0].variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("nested page");
    let paths = nested
        .variables
        .iter()
        .map(|variable| variable.evaluate_name.as_deref())
        .collect::<Vec<_>>();
    assert_eq!(
        paths,
        vec![
            Some("this[\"full name\"]"),
            Some("this[\"a\\\"b\\\\c\"]"),
            Some("this[\"#ordinary\"]"),
            Some("this.#secret"),
            Some("this.#child"),
        ]
    );

    let private_child = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: nested.variables[4].variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("private child page");
    assert_eq!(private_child.variables[0].evaluate_name, None);
}

#[test]
fn private_properties_share_truthful_bounded_pagination_with_ordinary_properties() {
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
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
        "Runtime.getProperties" => vec![result(
            id,
            json!({
                "result": [
                    {"name": "first", "value": {"type": "number", "value": 1}},
                    {"name": "second", "value": {"type": "number", "value": 2}}
                ],
                "privateProperties": [
                    {"name": "#third", "value": {"type": "number", "value": 3}},
                    {"name": "#fourth", "value": {"type": "number", "value": 4}}
                ]
            }),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 1,
                count: 2,
            })
        })
        .expect("session")
        .expect("mixed descriptor page");

    assert_eq!(
        page.variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["second", "#third"]
    );
    assert_eq!(page.returned, 2);
    assert_eq!(page.total, Some(4));
    assert_eq!(page.next_start, Some(3));
    assert!(!page.truncated);
    assert_eq!(page.variables[1].evaluate_name, None);
}

#[test]
fn repeated_pages_dedupe_references_and_the_hard_cap_resets_on_the_next_pause() {
    let batch = Arc::new(AtomicUsize::new(0));
    let response_batch = Arc::clone(&batch);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
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
        "Runtime.getProperties" => {
            let batch = response_batch.fetch_add(1, Ordering::SeqCst);
            let properties = (0..100)
                .map(|index| {
                    json!({
                        "name": format!("child-{index}"),
                        "value": {
                            "type": "object",
                            "objectId": format!("object-{batch}-{index}")
                        }
                    })
                })
                .collect::<Vec<_>>();
            vec![result(id, json!({"result": properties}))]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let request = DebugVariablePageRequest {
        pause_generation,
        frame_id,
        variables_reference,
        start: 0,
        count: 100,
    };

    for _ in 0..(MAX_CDP_OBJECT_REFERENCES_PER_PAUSE / 100) {
        let page = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
            .expect("session")
            .expect("unique object page");
        assert!(page
            .variables
            .iter()
            .all(|variable| variable.variables_reference > 0));
    }
    let capped = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
        .expect("session")
        .expect("capacity boundary page");
    assert!(capped
        .variables
        .iter()
        .all(|variable| variable.variables_reference > 0));
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::Continue))
        .expect("session")
        .expect("continue to next pause");
    let (_, frames) = wait_for_stopped(&sink, 1);
    let (next_generation, next_reference) = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            let generation = adapter
                .current_pause_generation()
                .expect("next pause generation");
            let scopes = adapter.scopes(frames[0].frame_id).expect("next scopes");
            (generation, scopes[0].variables_reference)
        })
        .expect("session");
    let after_reset = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation: next_generation,
                frame_id: frames[0].frame_id,
                variables_reference: next_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("page after pause reset");
    assert!(after_reset
        .variables
        .iter()
        .all(|variable| variable.variables_reference > 0));
}

#[test]
fn identical_pages_reuse_stable_reference_ids_across_repeated_cdp_loads() {
    let properties = json!([
        {"name": "first", "value": {"type": "object", "objectId": "stable-first"}},
        {"name": "second", "value": {"type": "object", "objectId": "stable-second"}}
    ]);
    let server = MockCdpServer::start(variables_responder(properties));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let request = DebugVariablePageRequest {
        pause_generation,
        frame_id,
        variables_reference,
        start: 0,
        count: 2,
    };
    let expected = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
        .expect("session")
        .expect("initial page")
        .variables
        .iter()
        .map(|variable| variable.variables_reference)
        .collect::<Vec<_>>();

    for _ in 1..MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE {
        let references = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
            .expect("session")
            .expect("repeated page")
            .variables
            .iter()
            .map(|variable| variable.variables_reference)
            .collect::<Vec<_>>();
        assert_eq!(references, expected);
    }
    let references = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
        .expect("session")
        .expect("cached page after repeated reads")
        .variables
        .iter()
        .map(|variable| variable.variables_reference)
        .collect::<Vec<_>>();
    assert_eq!(references, expected);
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);
}

#[test]
fn evaluation_preserves_only_a_safe_owner_bound_expression_as_evaluate_name() {
    for (expression, expected) in [
        ("count + 1", Some("count + 1")),
        ("(\ncount\t+ 1\r\n)", Some("(\ncount\t+ 1\r\n)")),
        ("count\revil", None),
    ] {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let evaluated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, expression)
            })
            .expect("session")
            .expect("evaluation");
        assert_eq!(evaluated.evaluate_name.as_deref(), expected);
    }
}

#[test]
fn variables_page_slices_value_descriptors_and_registers_only_returned_children() {
    let properties = json!([
        {"name": "before", "value": {"type": "object", "description": "Before", "objectId": "before-id"}},
        {"name": "computed", "get": {"type": "function", "objectId": "getter-id"}},
        {"name": "selected", "value": {"type": "object", "description": "Selected", "objectId": "selected-id"}},
        {"name": "after", "value": {"type": "number", "value": 3}}
    ]);
    let server = MockCdpServer::start(variables_responder(properties));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);

    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: 1,
                count: 1,
            })
        })
        .expect("session")
        .expect("variables page");

    assert_eq!(page.start, 1);
    assert_eq!(page.returned, 1);
    assert_eq!(page.total, Some(3));
    assert_eq!(page.next_start, Some(2));
    assert!(!page.truncated);
    assert_eq!(page.variables.len(), 1);
    assert_eq!(page.variables[0].name, "selected");
    assert!(page.variables[0].variables_reference > 0);
    assert_eq!(
        server.params_for("Runtime.getProperties"),
        vec![json!({
            "objectId": "scope-local-1",
            "ownProperties": true,
            "generatePreview": false,
        })]
    );
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
}

#[test]
fn variables_page_caps_descriptors_and_does_not_advertise_rows_beyond_the_cap() {
    let mut properties = Vec::with_capacity(MAX_CDP_PROPERTY_DESCRIPTORS + 1);
    properties.push(json!({
        "name": "computed",
        "get": {"type": "function", "objectId": "getter-id"}
    }));
    for index in 1..=MAX_CDP_PROPERTY_DESCRIPTORS {
        properties.push(json!({
            "name": format!("value-{index}"),
            "value": {"type": "number", "value": index}
        }));
    }
    let server = MockCdpServer::start(variables_responder(Value::Array(properties)));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);

    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference,
                start: (MAX_CDP_PROPERTY_DESCRIPTORS - 2) as u64,
                count: 100,
            })
        })
        .expect("session")
        .expect("bounded variables page");

    assert_eq!(page.returned, 1);
    assert_eq!(page.total, None);
    assert_eq!(page.next_start, None);
    assert!(page.truncated);
    assert_eq!(page.variables[0].name, "value-9999");
}

#[test]
fn variables_page_rejects_stale_pause_and_cross_frame_owners_before_cdp_io() {
    let server = MockCdpServer::start(variables_responder(json!([])));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);

    for request in [
        DebugVariablePageRequest {
            pause_generation: pause_generation + 1,
            frame_id,
            variables_reference,
            start: 0,
            count: 1,
        },
        DebugVariablePageRequest {
            pause_generation,
            frame_id: frame_id + 1,
            variables_reference,
            start: 0,
            count: 1,
        },
    ] {
        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
            .expect("session")
            .expect_err("owner must be rejected");
        assert!(error.contains("stale") || error.contains("another debug frame"));
    }
    assert!(server.params_for("Runtime.getProperties").is_empty());
}

#[test]
fn pause_generation_advances_across_resume_and_new_pause() {
    let server = MockCdpServer::start(flow_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let _ = wait_for_stopped(&sink, 0);
    let first = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
        .expect("session")
        .expect("first generation");

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::Continue))
        .expect("session")
        .expect("continue");
    let _ = wait_for_stopped(&sink, 1);
    let second = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.current_pause_generation())
        .expect("session")
        .expect("second generation");

    assert!(second > first);
}
#[path = "debug_cdp_pause_generation_floor_tests.rs"]
mod pause_generation_floor_tests;
