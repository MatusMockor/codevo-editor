use super::*;
use crate::debug_adapter::{DebugEvaluateContext, DebugEvaluateErrorKind, DebugEvaluatePolicy};

fn clipboard_policy() -> DebugEvaluatePolicy {
    DebugEvaluatePolicy {
        context: DebugEvaluateContext::Clipboard,
        allow_side_effects: true,
    }
}

#[test]
fn clipboard_evaluates_the_exact_expression_and_serializes_admitted_remote_objects() {
    let server = MockCdpServer::start(Box::new(|id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {
                "type":"object", "className":"Object", "description":"Object", "objectId":"root",
                "preview":{"type":"object", "description":"Object", "overflow":false,
                    "properties":[{"name":"items", "type":"object", "subtype":"array", "value":"Array(2)"}]}
            }}),
        )],
        "Runtime.getProperties" => match params["objectId"].as_str() {
            Some("root") => vec![result(
                id,
                json!({"result":[{"name":"items", "value":{
                    "type":"object", "subtype":"array", "className":"Array", "description":"Array(2)", "objectId":"items",
                    "preview":{"type":"object", "subtype":"array", "description":"Array(2)", "overflow":false,
                        "properties":[{"name":"0","type":"number","value":"1"},{"name":"1","type":"object","value":"Object"}]}
                }}]}),
            )],
            Some("items") => vec![result(
                id,
                json!({"result":[
                    {"name":"0", "value":{"type":"number", "value":1}},
                    {"name":"1", "value":{"type":"object", "className":"Object", "description":"Object", "objectId":"child",
                        "preview":{"type":"object", "description":"Object", "overflow":false, "properties":[{"name":"name","type":"string","value":"Ada"}]}}},
                    {"name":"length", "value":{"type":"number", "value":2}}
                ]}),
            )],
            Some("child") => vec![result(
                id,
                json!({"result":[{"name":"name", "value":{"type":"string", "value":"Ada"}}]}),
            )],
            _ => vec![ok(id)],
        },
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let value = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(frames[0].frame_id, "items", clipboard_policy())
        })
        .expect("session")
        .expect("clipboard evaluation");
    assert_eq!(value.value, "{items: [1, {name: \"Ada\"}]}");
    assert_eq!(value.value_type.as_deref(), Some("string"));
    assert_eq!(value.variables_reference, 0);
    assert!(value.evaluate_name.is_none());

    let parameters = server.params_for("Debugger.evaluateOnCallFrame");
    assert_eq!(parameters.len(), 1);
    assert_eq!(parameters[0]["callFrameId"], json!("cf-0"));
    assert_eq!(parameters[0]["silent"], json!(true));
    assert_eq!(parameters[0]["returnByValue"], json!(false));
    assert_eq!(parameters[0]["generatePreview"], json!(true));
    assert_eq!(parameters[0]["awaitPromise"], json!(false));
    assert_eq!(parameters[0]["timeout"], json!(1_500));
    assert_eq!(parameters[0]["objectGroup"], json!("codevo.clipboard"));
    assert!(parameters[0].get("throwOnSideEffect").is_none());
    assert_eq!(parameters[0]["expression"], json!("items"));
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn clipboard_preserves_bounded_structures_without_invoking_accessors() {
    let server = MockCdpServer::start(Box::new(|id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result": {
                "type":"object", "className":"Object", "description":"Object", "objectId":"root",
                "preview":{"type":"object", "description":"Object", "overflow":false, "properties":[
                    {"name":"array", "type":"object", "subtype":"array", "value":"Array(3)"},
                    {"name":"date", "type":"object", "subtype":"date", "value":"2026-07-22T00:00:00.000Z"},
                    {"name":"self", "type":"object", "value":"Object"},
                    {"name":"typed", "type":"object", "subtype":"typedarray", "value":"Uint8Array(2)"}
                ]}
            }}),
        )],
        "Runtime.getProperties" => match params["objectId"].as_str() {
            Some("root") => vec![result(
                id,
                json!({"result":[
                    {"name":"array", "value":{"type":"object", "subtype":"array", "className":"Array", "description":"Array(3)", "objectId":"array", "preview":{"type":"object", "subtype":"array", "description":"Array(3)", "overflow":false, "properties":[{"name":"0","type":"number","value":"1"},{"name":"2","type":"number","value":"3"}]}}},
                    {"name":"date", "value":{"type":"object", "subtype":"date", "className":"Date", "description":"2026-07-22T00:00:00.000Z", "objectId":"date", "preview":{"type":"object", "subtype":"date", "description":"2026-07-22T00:00:00.000Z", "overflow":false, "properties":[]}}},
                    {"name":"getter", "get":{"type":"function", "description":"get getter() {}"}, "set":{"type":"undefined"}},
                    {"name":"self", "value":{"type":"object", "className":"Object", "description":"Object", "objectId":"root", "preview":{"type":"object", "description":"Object", "overflow":false, "properties":[]}}},
                    {"name":"typed", "value":{"type":"object", "subtype":"typedarray", "className":"Uint8Array", "description":"Uint8Array(2)", "objectId":"typed", "preview":{"type":"object", "subtype":"typedarray", "description":"Uint8Array(2)", "overflow":false, "properties":[{"name":"0","type":"number","value":"7"},{"name":"1","type":"number","value":"8"},{"name":"length","type":"number","value":"2"}]}}}
                ]}),
            )],
            Some("array") => vec![result(
                id,
                json!({"result":[
                    {"name":"0", "value":{"type":"number", "value":1}},
                    {"name":"2", "value":{"type":"number", "value":3}},
                    {"name":"length", "value":{"type":"number", "value":3}}
                ]}),
            )],
            Some("typed") => vec![result(
                id,
                json!({"result":[
                    {"name":"0", "value":{"type":"number", "value":7}},
                    {"name":"1", "value":{"type":"number", "value":8}}
                ]}),
            )],
            _ => vec![ok(id)],
        },
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);

    let value = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
        })
        .expect("session")
        .expect("bounded clipboard structures");

    assert_eq!(
        value.value,
        "{array: [1, [Empty], 3], date: Date(\"2026-07-22T00:00:00.000Z\"), getter: [Getter], self: [Circular], typed: Uint8Array([7, 8])}"
    );
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("date")));
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn clipboard_rejects_proxy_and_overflow_previews_before_property_materialization() {
    let unsupported_subtypes = [
        "proxy",
        "map",
        "set",
        "weakmap",
        "weakset",
        "regexp",
        "error",
        "promise",
        "generator",
        "node",
        "wasmvalue",
        "arraybuffer",
        "dataview",
    ];
    let mut remotes = unsupported_subtypes
        .into_iter()
        .map(|subtype| {
            json!({
                "type":"object", "subtype":subtype, "className":"Object", "description":subtype,
                "objectId":"unsafe", "preview":{"type":"object", "subtype":subtype, "overflow":false, "properties":[]}
            })
        })
        .collect::<Vec<_>>();
    remotes.extend([
        json!({
            "type":"object", "subtype":"typedarray", "className":"Buffer", "description":"<Buffer 01>",
            "objectId":"unsafe", "preview":{"type":"object", "subtype":"typedarray", "overflow":false,
                "properties":[{"name":"0","type":"number","value":"1"},{"name":"length","type":"number","value":"1"}]}
        }),
        json!({
            "type":"object", "className":"Object", "description":"Object", "objectId":"huge",
            "preview":{"type":"object", "overflow":true, "properties":[]}
        }),
    ]);
    for remote in remotes {
        let response = remote.clone();
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => {
                vec![ok(id), event("Debugger.paused", breakpoint_paused_params())]
            }
            "Debugger.evaluateOnCallFrame" => {
                vec![result(id, json!({"result": response.clone()}))]
            }
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let failure = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
            })
            .expect("session")
            .expect_err("unsafe preview must be rejected");

        assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
        assert!(server.params_for("Runtime.getProperties").is_empty());
        assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
    }
}

#[test]
fn clipboard_rejects_malformed_remote_objects_and_descriptors() {
    for remote in [
        json!({"type":"boolean", "value":"true"}),
        json!({"type":"number", "value":"1"}),
        json!({"type":"number", "unserializableValue":"wat"}),
        json!({"type":"bigint", "unserializableValue":"12"}),
        json!({"type":"object", "subtype":"null"}),
        json!({"type":"object", "className":"Object", "objectId":"root", "preview":{"type":"object", "subtype":"array", "overflow":false, "properties":[]}}),
    ] {
        let response = remote.clone();
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason":"Break on start", "callFrames":[]}),
                ),
            ],
            "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
            "Debugger.evaluateOnCallFrame" => vec![result(id, json!({"result":response.clone()}))],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let failure = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
            })
            .expect("session")
            .expect_err("malformed RemoteObject must fail closed");
        assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
        assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
    }

    for descriptor in [
        json!({"name":"x"}),
        json!({"name":"x", "value":{"type":"number", "value":1}, "get":{"type":"undefined"}, "set":{"type":"undefined"}}),
        json!({"name":"x", "get":{"type":"function", "description":"get x() {}"}}),
        json!({"name":"x", "get":{"type":"number", "value":1}, "set":{"type":"undefined"}}),
        json!({"name":1, "value":{"type":"number", "value":1}}),
    ] {
        let descriptor = descriptor.clone();
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason":"Break on start", "callFrames":[]}),
                ),
            ],
            "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({"result":{"type":"object", "objectId":"root", "preview":{"type":"object", "overflow":false, "properties":[]}}}),
            )],
            "Runtime.getProperties" => vec![result(id, json!({"result":[descriptor.clone()]}))],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let failure = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
            })
            .expect("session")
            .expect_err("malformed descriptor must fail closed");
        assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
        assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
    }

    for (remote, properties) in [
        (
            json!({"type":"object", "subtype":"array", "className":"Array", "objectId":"root", "preview":{"type":"object", "subtype":"array", "overflow":false, "properties":[]}}),
            json!([{"name":"0", "value":{"type":"number", "value":1}}]),
        ),
        (
            json!({"type":"object", "subtype":"array", "className":"Array", "objectId":"root", "preview":{"type":"object", "subtype":"array", "overflow":false, "properties":[]}}),
            json!([{"name":"length", "value":{"type":"number", "value":1.5}}]),
        ),
        (
            json!({"type":"object", "subtype":"array", "className":"Array", "objectId":"root", "preview":{"type":"object", "subtype":"array", "overflow":false, "properties":[]}}),
            json!([
                {"name":"1", "value":{"type":"number", "value":1}},
                {"name":"length", "value":{"type":"number", "value":1}}
            ]),
        ),
        (
            json!({"type":"object", "subtype":"array", "className":"Array", "objectId":"root", "preview":{"type":"object", "subtype":"array", "overflow":false, "properties":[]}}),
            json!([
                {"name":"01", "value":{"type":"number", "value":1}},
                {"name":"length", "value":{"type":"number", "value":2}}
            ]),
        ),
        (
            json!({"type":"object", "subtype":"typedarray", "className":"Uint8Array", "objectId":"root", "preview":{"type":"object", "subtype":"typedarray", "overflow":false, "properties":[{"name":"0", "type":"number", "value":"1"}]}}),
            json!([{"name":"0", "value":{"type":"number", "value":1}}]),
        ),
        (
            json!({"type":"object", "subtype":"typedarray", "className":"Uint8Array", "objectId":"root", "preview":{"type":"object", "subtype":"typedarray", "overflow":false, "properties":[{"name":"0", "type":"number", "value":"1"}, {"name":"length", "type":"number", "value":"01"}]}}),
            json!([{"name":"0", "value":{"type":"number", "value":1}}]),
        ),
    ] {
        let response = remote.clone();
        let properties = properties.clone();
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason":"Break on start", "callFrames":[]}),
                ),
            ],
            "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
            "Debugger.evaluateOnCallFrame" => vec![result(id, json!({"result":response.clone()}))],
            "Runtime.getProperties" => vec![result(id, json!({"result":properties.clone()}))],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let failure = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
            })
            .expect("session")
            .expect_err("malformed collection length must fail closed");
        assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
        assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
    }

    let descriptors = (0..=256)
        .map(|index| json!({"name":format!("property{index}"), "value":{"type":"number", "value":index}}))
        .collect::<Vec<_>>();
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start", "callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
        "Debugger.evaluateOnCallFrame" => vec![result(
            id,
            json!({"result":{"type":"object", "objectId":"root", "preview":{"type":"object", "overflow":false, "properties":[]}}}),
        )],
        "Runtime.getProperties" => vec![result(id, json!({"result":descriptors.clone()}))],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let failure = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
        })
        .expect("session")
        .expect_err("257 descriptors must exceed the exact property cap");
    assert_eq!(failure.kind, DebugEvaluateErrorKind::Unsupported);
    assert_eq!(server.params_for("Runtime.releaseObjectGroup").len(), 1);
}

#[test]
fn clipboard_classifies_exceptions_and_rejects_unbounded_or_stale_results() {
    for (remote, expected_kind) in [
        (
            json!({
                "result": {"type":"object", "subtype":"error"},
                "exceptionDetails": {"text":"Uncaught", "exception":{"description":"Error: getter failed"}}
            }),
            DebugEvaluateErrorKind::Exception,
        ),
        (
            json!({"result":{"type":"string", "value":"x".repeat(64 * 1024 + 1)}}),
            DebugEvaluateErrorKind::Unsupported,
        ),
    ] {
        let response = remote.clone();
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => {
                vec![ok(id), event("Debugger.paused", breakpoint_paused_params())]
            }
            "Debugger.evaluateOnCallFrame" => vec![result(id, response.clone())],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);
        let failure = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
            })
            .expect("session")
            .expect_err("clipboard response must fail");
        assert_eq!(failure.kind, expected_kind);
    }

    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason": "Break on start", "callFrames": []}),
            ),
        ],
        "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
        "Debugger.evaluateOnCallFrame" => vec![
            event("Debugger.resumed", json!({})),
            result(id, json!({"result":{"type":"string", "value":"stale"}})),
        ],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let failure = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate_with_policy(frames[0].frame_id, "value", clipboard_policy())
        })
        .expect("session")
        .expect_err("late clipboard response must be fenced");
    assert!(failure.message.contains("pause owner changed"));
}
