use crate::debug_cdp::variables::{
    MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION, MAX_CDP_OBJECT_ID_BYTES,
};

fn collection_responder(collection: Value, responses: Value) -> MockResponder {
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
        "Runtime.getProperties" => {
            let object_id = params["objectId"].as_str().unwrap_or("");
            let response = responses
                .get(object_id)
                .cloned()
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
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
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
}

#[test]
fn collection_over_the_retained_cap_is_truthfully_truncated() {
    let entries = (0..=MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION)
        .map(|index| {
            json!({
                "name": index.to_string(),
                "value": {
                    "type": "object",
                    "subtype": "internal#entry",
                    "description": index.to_string(),
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
                            MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION
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
                        "value": MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION + 1
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
                .map(|variable| variable.name.clone()),
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
    assert_eq!(retained.first().map(String::as_str), Some("0"));
    assert_eq!(retained.last().map(String::as_str), Some("511"));
}

#[test]
fn oversized_collection_description_skips_entries_fetch_and_reports_truncation() {
    let server = MockCdpServer::start(collection_responder(
        json!({
            "type": "object",
            "subtype": "map",
            "description": "Map",
            "objectId": "map"
        }),
        json!({
            "map": {
                "result": [{"name": "tag", "value": {"type": "string", "value": "cache"}}],
                "internalProperties": [{
                    "name": "[[Entries]]",
                    "value": {
                        "type": "object",
                        "subtype": "array",
                        "description": format!(
                            "Array({})",
                            MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION + 1
                        ),
                        "objectId": "map-entries"
                    }
                }]
            },
            "map-entries": {
                "result": [{"name": "length", "value": {"type": "number", "value": 0}}]
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
        Some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount)
    );
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["objectId"] != json!("map-entries")));
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
        "Runtime.getProperties" if params["objectId"] == json!("map-entries") => vec![
            event("Debugger.paused", breakpoint_paused_params()),
            result(
                id,
                json!({"result": [
                    {
                        "name": "0",
                        "value": {
                            "type": "object",
                            "subtype": "internal#entry",
                            "objectId": "entry-0"
                        }
                    },
                    {"name": "length", "value": {"type": "number", "value": 1}}
                ]}),
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
