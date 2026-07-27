use crate::debug_cdp::variables::{
    CDP_COLLECTION_ENTRY_WINDOW_FUNCTION, CDP_COLLECTION_ENTRY_WINDOW_SIZE,
    MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION, MAX_CDP_OBJECT_ID_BYTES,
    MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE,
};

#[test]
fn collection_entry_window_function_text_uses_only_fixed_dense_index_reads() {
    assert_eq!(
        CDP_COLLECTION_ENTRY_WINDOW_FUNCTION
            .matches("this[start")
            .count(),
        CDP_COLLECTION_ENTRY_WINDOW_SIZE
    );
    for forbidden in ["...", " for ", ".slice", ".map", ".push", "Symbol"] {
        assert!(
            !CDP_COLLECTION_ENTRY_WINDOW_FUNCTION.contains(forbidden),
            "forbidden function source fragment: {forbidden}"
        );
    }
    assert_eq!(CDP_COLLECTION_ENTRY_WINDOW_FUNCTION.matches('(').count(), 1);
}

fn collection_responder(collection: Value, responses: Value) -> MockResponder {
    let mut windows = std::collections::HashMap::new();
    let mut next_window = 0usize;
    Box::new(move |id, method, params| match method {
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
            json!({"result": [{"name": "collection", "value": collection.clone()}]}),
        )],
        "Runtime.callFunctionOn" => {
            let source_id = params["objectId"].as_str().unwrap_or("");
            let start = params["arguments"][0]["value"].as_u64().unwrap_or(u64::MAX);
            let count = params["arguments"][1]["value"].as_u64().unwrap_or(0);
            let properties = responses
                .get(source_id)
                .and_then(|response| response.get("result"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|property| {
                    let index = property.get("name")?.as_str()?.parse::<u64>().ok()?;
                    if index < start || index >= start.saturating_add(count) {
                        return None;
                    }
                    let mut property = property.clone();
                    property["name"] = json!((index - start).to_string());
                    Some(property)
                })
                .chain([json!({
                    "name": "length",
                    "value": {"type": "number", "value": count}
                })])
                .collect::<Vec<_>>();
            let window_id = format!("collection-window-{next_window}");
            next_window = next_window.saturating_add(1);
            windows.insert(window_id.clone(), json!({"result": properties}));
            vec![result(
                id,
                json!({
                    "result": {
                        "type": "object",
                        "subtype": "array",
                        "description": format!("Array({count})"),
                        "objectId": window_id
                    }
                }),
            )]
        }
        "Runtime.getProperties" => {
            let object_id = params["objectId"].as_str().unwrap_or("");
            let response = windows
                .get(object_id)
                .cloned()
                .or_else(|| responses.get(object_id).cloned())
                .unwrap_or_else(|| json!({"result": []}));
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    })
}

fn collection_owner(registry: &DebugSessionRegistry, sink: &CollectingSink) -> (u64, u64, u64) {
    let (pause_generation, frame_id, scope_reference) = first_scope_owner(registry, sink);
    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: scope_reference,
                start: 0,
                count: 1,
            })
        })
        .expect("session")
        .expect("scope variables");
    (
        pause_generation,
        frame_id,
        page.variables[0].variables_reference,
    )
}

fn variables_page(
    registry: &DebugSessionRegistry,
    owner: (u64, u64, u64),
    start: u64,
    count: u32,
) -> crate::debug_adapter::DebugVariablePage {
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation: owner.0,
                frame_id: owner.1,
                variables_reference: owner.2,
                start,
                count,
            })
        })
        .expect("session")
        .expect("variables page")
}

#[test]
fn map_entries_expand_to_separately_inspectable_keys_and_values() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "className": "Map",
            "description": "Map(1)",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {
                "result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "description": "{\"first\" => Object}",
                            "objectId": "map-entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]
            },
            "map-entry-0": {
                "result": [
                    {
                        "name": "key",
                        "value": {
                            "type": "object",
                            "description": "Object",
                            "objectId": "map-key"
                        }
                    },
                    {
                        "name": "value",
                        "value": {
                            "type": "object",
                            "description": "Object",
                            "objectId": "map-value"
                        }
                    }
                ]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let entries = variables_page(&registry, map_owner, 0, 100);

    assert_eq!(entries.total, Some(1));
    assert_eq!(entries.variables[0].name, "0");
    assert!(entries.variables[0].variables_reference > 0);

    let entry_owner = (
        map_owner.0,
        map_owner.1,
        entries.variables[0].variables_reference,
    );
    let entry = variables_page(&registry, entry_owner, 0, 100);
    assert_eq!(
        entry
            .variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["key", "value"]
    );
    assert!(entry
        .variables
        .iter()
        .all(|variable| variable.variables_reference > 0));
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["generatePreview"] == json!(false)));
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("map-entries")));
    assert_eq!(
        server.params_for("Runtime.callFunctionOn"),
        vec![json!({
            "objectId": "map-entries",
            "functionDeclaration": CDP_COLLECTION_ENTRY_WINDOW_FUNCTION,
            "arguments": [
                {"value": 0},
                {"value": 1}
            ],
            "awaitPromise": false,
            "silent": true,
            "returnByValue": false,
            "throwOnSideEffect": true,
            "generatePreview": false,
        })]
    );
    assert_eq!(
        server.params_for("Runtime.releaseObject"),
        vec![json!({"objectId": "collection-window-0"})]
    );
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
}

#[test]
fn debuggee_controlled_window_description_does_not_disable_collection_inspection() {
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
                "name": "map",
                "value": {
                    "type": "object",
                    "subtype": "map",
                    "description": "Map(1)",
                    "objectId": "map"
                }
            }]}),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("map") => vec![result(
            id,
            json!({
                "result": [{"name": "tag", "value": {"type": "string", "value": "retained"}}],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "map-entries"
                    }
                }]
            }),
        )],
        "Runtime.callFunctionOn" if params["objectId"] == json!("map-entries") => vec![result(
            id,
            json!({
                "result": {
                    "type": "object",
                    "subtype": "array",
                    "description": "DebuggeeControlled",
                    "objectId": "collection-window"
                }
            }),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("collection-window") => {
            vec![result(
                id,
                json!({"result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "description": "{\"key\" => \"value\"}",
                            "objectId": "entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]}),
            )]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let page = variables_page(&registry, map_owner, 0, 100);

    assert_eq!(
        page.variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["tag", "0"]
    );
    assert_eq!(
        server.params_for("Runtime.releaseObject"),
        vec![json!({"objectId": "collection-window"})]
    );
}

#[test]
fn rejected_or_invalid_collection_windows_preserve_ordinary_properties() {
    for (label, window) in [
        (
            "rejected",
            json!({
                "exceptionDetails": {"text": "Side effect check rejected"},
                "result": {"type": "object", "subtype": "array", "objectId": "rejected-window"}
            }),
        ),
        (
            "invalid",
            json!({
                "result": {
                    "type": "object",
                    "subtype": "map",
                    "objectId": "invalid-window"
                }
            }),
        ),
    ] {
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
            "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => {
                vec![result(
                    id,
                    json!({"result": [{
                        "name": "map",
                        "value": {
                            "type": "object",
                            "subtype": "map",
                            "description": "Map(1)",
                            "objectId": "map"
                        }
                    }]}),
                )]
            }
            "Runtime.getProperties" if params["objectId"] == json!("map") => vec![result(
                id,
                json!({
                    "result": [{
                        "name": "tag",
                        "value": {"type": "string", "value": "retained"}
                    }],
                    "internalProperties": [{
                        "name": "[[Entries]]",
                        "value": {
                            "type": "object",
                            "subtype": "array",
                            "description": "Array(1)",
                            "objectId": "map-entries"
                        }
                    }]
                }),
            )],
            "Runtime.callFunctionOn" if params["objectId"] == json!("map-entries") => {
                vec![result(id, window.clone())]
            }
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let map_owner = collection_owner(&registry, &sink);
        let page = variables_page(&registry, map_owner, 0, 100);

        assert_eq!(page.variables.len(), 1, "{label}");
        assert_eq!(page.variables[0].name, "tag", "{label}");
        assert!(page.truncated, "{label}");
        assert_eq!(
            page.limit_reason,
            Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability),
            "{label}"
        );
        assert_eq!(
            server.params_for("Runtime.releaseObject"),
            vec![json!({"objectId": format!("{label}-window")})],
            "{label}"
        );
    }
}

#[test]
fn map_preserves_ordinary_own_properties_with_projected_entries() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map(1)",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [{
                    "name": "tag",
                    "value": {"type": "string", "value": "important"}
                }],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {
                "result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "objectId": "entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let page = variables_page(&registry, map_owner, 0, 100);

    assert_eq!(
        page.variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["tag", "0"]
    );
    assert_eq!(page.total, Some(2));
}

#[test]
fn set_entries_expand_to_element_children() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "set",
            "className": "Set",
            "description": "Set(1)",
            "objectId": "set"
        }),
        json!({
            "set": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "set-entries"
                    }
                }]
            },
            "set-entries": {
                "result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "description": "Object",
                            "objectId": "set-entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]
            },
            "set-entry-0": {
                "result": [{
                    "name": "value",
                    "value": {
                        "type": "object",
                        "description": "Object",
                        "objectId": "set-value"
                    }
                }]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let set_owner = collection_owner(&registry, &sink);
    let entries = variables_page(&registry, set_owner, 0, 100);
    let entry_owner = (
        set_owner.0,
        set_owner.1,
        entries.variables[0].variables_reference,
    );
    let entry = variables_page(&registry, entry_owner, 0, 100);

    assert_eq!(entries.total, Some(1));
    assert_eq!(entry.variables.len(), 1);
    assert_eq!(entry.variables[0].name, "value");
    assert!(entry.variables[0].variables_reference > 0);
}

#[test]
fn empty_map_has_no_children_and_no_error() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map(0)",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(0)",
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {
                "result": [
                    {"name": "length", "value": {"type": "number", "value": 0}}
                ]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let entries = variables_page(&registry, map_owner, 0, 100);

    assert!(entries.variables.is_empty());
    assert_eq!(entries.total, Some(0));
    assert!(!entries.truncated);
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
}

#[test]
fn weak_collections_use_the_same_bounded_entry_projection() {
    for (subtype, entry_fields) in [
        (
            "weakmap",
            vec![
                json!({"name": "key", "value": {"type": "object", "objectId": "key"}}),
                json!({"name": "value", "value": {"type": "number", "value": 1}}),
            ],
        ),
        (
            "weakset",
            vec![json!({
                "name": "value",
                "value": {"type": "object", "objectId": "value"}
            })],
        ),
    ] {
        let server = MockCdpServer::start(collection_responder(
            json!({
                "type": "object",
                "subtype": subtype,
                "description": subtype,
                "objectId": "weak"
            }),
            json!({
                "weak": {
                    "result": [],
                    "internalProperties": [{
                        "name": "[[Entries]]",
                        "value": {
                            "type": "object",
                            "subtype": "array",
                            "description": "Array(1)",
                            "objectId": "weak-entries"
                        }
                    }]
                },
                "weak-entries": {
                    "result": [
                        {
                            "name": "0",
                            "value": {
                                "type": "object",
                                "subtype": "internal#entry",
                                "objectId": "weak-entry"
                            }
                        },
                        {"name": "length", "value": {"type": "number", "value": 1}}
                    ]
                },
                "weak-entry": {"result": entry_fields}
            }),
        ));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let weak_owner = collection_owner(&registry, &sink);
        let entries = variables_page(&registry, weak_owner, 0, 100);
        let entry_owner = (
            weak_owner.0,
            weak_owner.1,
            entries.variables[0].variables_reference,
        );
        let entry = variables_page(&registry, entry_owner, 0, 100);

        assert_eq!(entries.total, Some(1));
        let expected_entries = match subtype {
            "weakmap" => 2,
            _ => 1,
        };
        assert_eq!(entry.variables.len(), expected_entries);
    }
}

#[test]
fn proxy_wrapped_collection_is_unexpandable_and_page_is_truthfully_capability_limited() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "proxy",
            "description": "Proxy(Map)",
            "objectId": "proxy"
        }),
        json!({
            "proxy": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Target]]",
                    "value": {
                        "type": "object",
                        "subtype": "map",
                        "objectId": "proxy-target"
                    }
                }]
            },
            "proxy-target": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "objectId": "target-entries"
                    }
                }]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, scope_reference) = first_scope_owner(&registry, &sink);
    let page = variables_page(
        &registry,
        (pause_generation, frame_id, scope_reference),
        0,
        100,
    );

    assert_eq!(page.variables.len(), 1);
    assert_eq!(page.variables[0].variables_reference, 0);
    assert!(page.truncated);
    assert_eq!(
        page.limit_reason,
        Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability)
    );
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("proxy")));
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
}

#[test]
fn two_thousand_entry_map_pages_in_windows_with_correct_retained_keys_and_values() {
    let entry_count = 2_000usize;
    let entries = (0..entry_count)
        .map(|index| {
            json!({
                "name": index.to_string(),
                "value": {
                    "type": "object",
                    "subtype": "internal#entry",
                    "description": format!("{{\"key-{index}\" => \"value-{index}\"}}"),
                    "objectId": format!("entry-{index}")
                }
            })
        })
        .collect::<Vec<_>>();
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": format!(
                            "Array({})",
                            entry_count
                        ),
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {
                "result": entries.into_iter().chain([json!({
                    "name": "length",
                    "value": {
                        "type": "number",
                        "value": entry_count
                    }
                })]).collect::<Vec<_>>()
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let mut start = 0;
    let mut retained = Vec::new();
    loop {
        let page = variables_page(&registry, map_owner, start, 100);
        retained.extend(
            page.variables
                .iter()
                .map(|variable| (variable.name.clone(), variable.value.clone())),
        );
        assert!(page.truncated);
        assert_eq!(page.total, None);
        assert_eq!(
            page.limit_reason,
            Some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount)
        );
        let Some(next_start) = page.next_start else {
            assert_eq!(page.returned, 12);
            break;
        };
        assert_eq!(page.returned, 100);
        start = next_start;
    }
    assert_eq!(retained.len(), MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION);
    assert_eq!(
        retained.first(),
        Some(&("0".to_string(), "{\"key-0\" => \"value-0\"}".to_string()))
    );
    assert_eq!(
        retained.last(),
        Some(&(
            "511".to_string(),
            "{\"key-511\" => \"value-511\"}".to_string()
        ))
    );
    let calls = server.params_for("Runtime.callFunctionOn");
    assert_eq!(
        calls.len(),
        MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION / CDP_COLLECTION_ENTRY_WINDOW_SIZE
    );
    for (window, params) in calls.iter().enumerate() {
        assert_eq!(
            params["arguments"],
            json!([
                {"value": window * CDP_COLLECTION_ENTRY_WINDOW_SIZE},
                {"value": CDP_COLLECTION_ENTRY_WINDOW_SIZE}
            ])
        );
        assert_eq!(
            params["functionDeclaration"],
            json!(CDP_COLLECTION_ENTRY_WINDOW_FUNCTION)
        );
    }
}

#[test]
fn second_large_collection_degrades_truthfully_and_later_object_expansion_succeeds() {
    let mut windows = std::collections::HashMap::new();
    let mut next_window = 0usize;
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
            json!({"result": [
                {
                    "name": "first",
                    "value": {
                        "type": "object",
                        "subtype": "map",
                        "description": "Map(512)",
                        "objectId": "first-map"
                    }
                },
                {
                    "name": "second",
                    "value": {
                        "type": "object",
                        "subtype": "map",
                        "description": "Map(2000)",
                        "objectId": "second-map"
                    }
                },
                {
                    "name": "ordinary",
                    "value": {
                        "type": "object",
                        "description": "Object",
                        "objectId": "ordinary"
                    }
                }
            ]}),
        )],
        "Runtime.getProperties"
            if params["objectId"] == json!("first-map")
                || params["objectId"] == json!("second-map") =>
        {
            let first = params["objectId"] == json!("first-map");
            let count = if first { 512 } else { 2_000 };
            let entries_id = if first {
                "first-map-entries"
            } else {
                "second-map-entries"
            };
            vec![result(
                id,
                json!({
                    "result": [],
                    "internalProperties": [{
                        "name": "[[Entries]]",
                        "value": {
                            "type": "object",
                            "subtype": "array",
                            "description": format!("Array({count})"),
                            "objectId": entries_id
                        }
                    }]
                }),
            )]
        }
        "Runtime.callFunctionOn" => {
            let source = params["objectId"].as_str().unwrap_or("");
            let start = params["arguments"][0]["value"].as_u64().unwrap_or(0) as usize;
            let count = params["arguments"][1]["value"].as_u64().unwrap_or(0) as usize;
            let prefix = if source == "first-map-entries" {
                "first"
            } else {
                "second"
            };
            let properties = (0..count)
                .map(|position| {
                    let index = start + position;
                    json!({
                        "name": position.to_string(),
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "description": format!("{{\"{prefix}-{index}\" => {index}}}"),
                            "objectId": format!("{prefix}-entry-{index}")
                        }
                    })
                })
                .chain([json!({
                    "name": "length",
                    "value": {"type": "number", "value": count}
                })])
                .collect::<Vec<_>>();
            let window_id = format!("large-window-{next_window}");
            next_window += 1;
            windows.insert(window_id.clone(), json!({"result": properties}));
            vec![result(
                id,
                json!({
                    "result": {
                        "type": "object",
                        "subtype": "array",
                        "objectId": window_id
                    }
                }),
            )]
        }
        "Runtime.getProperties" if params["objectId"] == json!("ordinary") => vec![result(
            id,
            json!({"result": [{
                "name": "a",
                "value": {"type": "number", "value": 1}
            }]}),
        )],
        "Runtime.getProperties" => {
            let response = params["objectId"]
                .as_str()
                .and_then(|object_id| windows.get(object_id))
                .cloned()
                .unwrap_or_else(|| json!({"result": []}));
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, scope_reference) = first_scope_owner(&registry, &sink);
    let scope = variables_page(
        &registry,
        (pause_generation, frame_id, scope_reference),
        0,
        3,
    );
    let owner = |name: &str| {
        (
            pause_generation,
            frame_id,
            scope
                .variables
                .iter()
                .find(|variable| variable.name == name)
                .expect("scope variable")
                .variables_reference,
        )
    };

    let first = variables_page(&registry, owner("first"), 0, 100);
    let second = variables_page(&registry, owner("second"), 0, 100);
    let ordinary = variables_page(&registry, owner("ordinary"), 0, 100);

    assert_eq!(first.variables.len(), 100);
    assert!(!first.truncated);
    assert_eq!(second.variables.len(), 100);
    assert!(second.truncated);
    assert_eq!(
        second.limit_reason,
        Some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount)
    );
    assert_eq!(ordinary.variables.len(), 1);
    assert_eq!(ordinary.variables[0].name, "a");
    assert_eq!(ordinary.variables[0].value, "1");
}

#[test]
fn exhausted_pause_load_budget_degrades_ordinary_object_page_instead_of_erroring() {
    let properties = (0..MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE)
        .map(|index| {
            json!({
                "name": format!("object-{index}"),
                "value": {
                    "type": "object",
                    "description": "Object",
                    "objectId": format!("object-{index}")
                }
            })
        })
        .collect::<Vec<_>>();
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
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => {
            vec![result(id, json!({"result": properties.clone()}))]
        }
        "Runtime.getProperties" => vec![result(id, json!({"result": []}))],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, scope_reference) = first_scope_owner(&registry, &sink);
    let mut references = Vec::new();
    let mut start = 0u64;
    while references.len() < MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE {
        let page = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: scope_reference,
                    start,
                    count: 100,
                })
            })
            .expect("session")
            .expect("scope page");
        references.extend(
            page.variables
                .iter()
                .map(|variable| variable.variables_reference),
        );
        let Some(next_start) = page.next_start else {
            break;
        };
        start = next_start;
    }
    assert_eq!(references.len(), MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE);

    for reference in references
        .iter()
        .take(MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE - 1)
    {
        let page = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: *reference,
                    start: 0,
                    count: 1,
                })
            })
            .expect("session")
            .expect("ordinary object page before exhaustion");
        assert!(!page.truncated);
    }
    let exhausted = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: references[MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE - 1],
                start: 0,
                count: 1,
            })
        })
        .expect("session")
        .expect("ordinary object page after exhaustion");

    assert!(exhausted.variables.is_empty());
    assert!(exhausted.truncated);
    assert_eq!(exhausted.total, None);
    assert_eq!(
        exhausted.limit_reason,
        Some(crate::debug_adapter::DebugVariablePageLimitReason::AcquisitionCount)
    );
}

#[test]
fn very_large_collection_entries_use_the_bounded_window_request_shape() {
    let large = "x".repeat(5_000);
    let entries = (0..CDP_COLLECTION_ENTRY_WINDOW_SIZE)
        .map(|index| {
            json!({
                "name": index.to_string(),
                "value": {
                    "type": "object",
                    "subtype": "internal#entry",
                    "description": format!("{{\"{large}\" => \"{large}\"}}"),
                    "objectId": format!("large-entry-{index}")
                }
            })
        })
        .chain([json!({
            "name": "length",
            "value": {
                "type": "number",
                "value": CDP_COLLECTION_ENTRY_WINDOW_SIZE
            }
        })])
        .collect::<Vec<_>>();
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": format!(
                            "Array({})",
                            CDP_COLLECTION_ENTRY_WINDOW_SIZE
                        ),
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {"result": entries}
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let page = variables_page(&registry, map_owner, 0, 100);

    assert_eq!(page.variables.len(), CDP_COLLECTION_ENTRY_WINDOW_SIZE);
    let calls = server.params_for("Runtime.callFunctionOn");
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0]["arguments"],
        json!([
            {"value": 0},
            {"value": CDP_COLLECTION_ENTRY_WINDOW_SIZE}
        ])
    );
    assert_eq!(
        calls[0]["functionDeclaration"],
        json!(CDP_COLLECTION_ENTRY_WINDOW_FUNCTION)
    );
}

#[test]
fn anomalous_collection_entry_shapes_preserve_ordinary_properties_as_unknown_count() {
    let anomalies = vec![
        (
            "duplicate",
            vec![
                json!({
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "entries-a"
                    }
                }),
                json!({
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "entries-b"
                    }
                }),
            ],
        ),
        ("missing value", vec![json!({"name": "[[Entries]]"})]),
        (
            "wrong type",
            vec![json!({
                "name": "[[Entries]]",
                "value": {
                    "type": "string",
                    "subtype": "array",
                    "objectId": "entries"
                }
            })],
        ),
        (
            "wrong subtype",
            vec![json!({
                "name": "[[Entries]]",
                "value": {
                    "type": "object",
                    "subtype": "map",
                    "objectId": "entries"
                }
            })],
        ),
        (
            "missing object id",
            vec![json!({
                "name": "[[Entries]]",
                "value": {"type": "object", "subtype": "array"}
            })],
        ),
        (
            "empty object id",
            vec![json!({
                "name": "[[Entries]]",
                "value": {"type": "object", "subtype": "array", "objectId": ""}
            })],
        ),
        (
            "oversized object id",
            vec![json!({
                "name": "[[Entries]]",
                "value": {
                    "type": "object",
                    "subtype": "array",
                    "objectId": "x".repeat(MAX_CDP_OBJECT_ID_BYTES + 1)
                }
            })],
        ),
    ];

    for (anomaly, internal_properties) in anomalies {
        let server = MockCdpServer::start(collection_responder(
            json!({
                "type": "object",
                "subtype": "map",
                "description": "Map",
                "objectId": "map"
            }),
            json!({
                "map": {
                    "result": [{
                        "name": "tag",
                        "value": {"type": "string", "value": "retained"}
                    }],
                    "internalProperties": internal_properties
                }
            }),
        ));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let map_owner = collection_owner(&registry, &sink);
        let page = variables_page(&registry, map_owner, 0, 100);

        assert_eq!(page.variables.len(), 1, "{anomaly}");
        assert_eq!(page.variables[0].name, "tag", "{anomaly}");
        assert!(page.truncated, "{anomaly}");
        assert_eq!(page.total, None, "{anomaly}");
        assert_eq!(
            page.limit_reason,
            Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability),
            "{anomaly}"
        );
    }
}

#[test]
fn collection_without_entries_descriptor_reports_capability_degradation() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map(1)",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [{
                    "name": "tag",
                    "value": {"type": "string", "value": "retained"}
                }],
                "internalProperties": []
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let page = variables_page(&registry, map_owner, 0, 100);

    assert_eq!(page.variables.len(), 1);
    assert_eq!(page.variables[0].name, "tag");
    assert!(page.truncated);
    assert_eq!(page.total, None);
    assert_eq!(
        page.limit_reason,
        Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability)
    );
}

#[test]
fn unparseable_collection_entry_counts_preserve_ordinary_properties_without_fetching_entries() {
    for description in [
        None,
        Some("Array"),
        Some("Array(1e9)"),
        Some("Array(999999999999999999999999999999999999999999)"),
    ] {
        let mut entries = json!({
            "type": "object",
            "subtype": "array",
            "objectId": "map-entries"
        });
        if let Some(description) = description {
            entries["description"] = json!(description);
        }
        let server = MockCdpServer::start(collection_responder(
            json!({
                "type": "object",
                "subtype": "map",
                "description": "Map",
                "objectId": "map"
            }),
            json!({
                "map": {
                    "result": [{
                        "name": "tag",
                        "value": {"type": "string", "value": "retained"}
                    }],
                    "internalProperties": [{
                        "name": "[[Entries]]",
                        "value": entries
                    }]
                },
                "map-entries": {
                    "result": [{"name": "length", "value": {"type": "number", "value": 0}}]
                }
            }),
        ));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let map_owner = collection_owner(&registry, &sink);
        let page = variables_page(&registry, map_owner, 0, 100);

        assert_eq!(page.variables.len(), 1);
        assert_eq!(page.variables[0].name, "tag");
        assert!(page.truncated);
        assert_eq!(page.total, None);
        assert_eq!(
            page.limit_reason,
            Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability)
        );
        assert!(server
            .params_for("Runtime.getProperties")
            .iter()
            .all(|params| params["objectId"] != json!("map-entries")));
    }
}

#[test]
fn typed_array_uses_existing_indexed_paging() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "typedarray",
            "className": "Uint8Array",
            "description": "Uint8Array(4)",
            "objectId": "typed"
        }),
        json!({
            "typed": {
                "result": [
                    {"name": "0", "value": {"type": "number", "value": 7}},
                    {"name": "1", "value": {"type": "number", "value": 8}},
                    {"name": "2", "value": {"type": "number", "value": 9}},
                    {"name": "3", "value": {"type": "number", "value": 10}}
                ],
                "internalProperties": [{
                    "name": "[[ViewedArrayBuffer]]",
                    "value": {
                        "type": "object",
                        "subtype": "arraybuffer",
                        "objectId": "buffer"
                    }
                }]
            }
        }),
    ));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let typed_owner = collection_owner(&registry, &sink);
    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page_filtered(
                DebugVariablePageRequest {
                    pause_generation: typed_owner.0,
                    frame_id: typed_owner.1,
                    variables_reference: typed_owner.2,
                    start: 1,
                    count: 2,
                },
                DebugVariableFilter::Indexed,
            )
        })
        .expect("session")
        .expect("typed array page");

    assert_eq!(
        page.variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["1", "2"]
    );
    assert_eq!(page.next_start, Some(3));
    assert_eq!(page.total, Some(4));
    assert_eq!(
        server
            .params_for("Runtime.getProperties")
            .iter()
            .filter(|params| params["objectId"] == json!("typed"))
            .count(),
        1
    );
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("buffer")));
}

#[test]
fn collection_result_after_resume_fails_closed() {
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
                "name": "map",
                "value": {
                    "type": "object",
                    "subtype": "map",
                    "description": "Map(1)",
                    "objectId": "map"
                }
            }]}),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("map") => vec![result(
            id,
            json!({
                "result": [],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "map-entries"
                    }
                }]
            }),
        )],
        "Runtime.callFunctionOn" if params["objectId"] == json!("map-entries") => vec![
            event("Debugger.resumed", json!({})),
            result(
                id,
                json!({
                    "result": {
                        "type": "object",
                        "subtype": "array",
                        "description": "Array(1)",
                        "objectId": "collection-window"
                    }
                }),
            ),
        ],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let map_owner = collection_owner(&registry, &sink);
    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation: map_owner.0,
                frame_id: map_owner.1,
                variables_reference: map_owner.2,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect_err("late collection result must fail closed");

    assert_eq!(
        error,
        "The debug collection pause owner changed while acquiring entries."
    );
}
