use super::*;
use crate::debug_adapter::{
    DebugCompletionItemKind, DebugCompletionQuery, DebugCompletionRequest, DebugCompletionRoot,
};
use crate::debug_cdp::completions::{
    MAX_COMPLETION_DESCRIPTORS_PER_PAUSE, MAX_COMPLETION_PROTOTYPE_DEPTH,
    MAX_COMPLETION_REQUESTS_PER_PAUSE,
};
use crate::debug_cdp::variables::MAX_CDP_PROPERTY_DESCRIPTORS;
use serde_json::json;
use std::time::Duration;

fn completion_responder() -> MockResponder {
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" => {
            let descriptors = match params["objectId"].as_str() {
                Some("scope-local-1") => json!([
                    {"name":"repository","value":{"type":"object","objectId":"repository-1"}},
                    {"name":"localOnly","value":{"type":"number","value":1}},
                    {"name":"foo-bar","value":{"type":"number","value":2}},
                    {"name":"0","value":{"type":"number","value":3}},
                    {"name":"shadowed","get":{"type":"function","objectId":"getter-1"}}
                ]),
                Some("scope-global-1") => json!([
                    {"name":"globalOnly","value":{"type":"number","value":2}},
                    {"name":"shadowed","value":{"type":"number","value":3}}
                ]),
                Some("repository-1") => json!([
                    {"name":"findAll","value":{"type":"function","objectId":"function-1"}},
                    {"name":"findOne","value":{"type":"function","objectId":"function-2"}},
                    {"name":"foo-bar","value":{"type":"number","value":3}},
                    {"name":"0","value":{"type":"number","value":4}},
                    {"name":"danger","get":{"type":"function","objectId":"getter-2"}}
                ]),
                _ => json!([]),
            };
            vec![result(id, json!({"result":descriptors}))]
        }
        _ => vec![ok(id)],
    })
}

fn truncated_near_scope_responder() -> MockResponder {
    let near = (0..=MAX_CDP_PROPERTY_DESCRIPTORS)
        .map(|index| {
            json!({
                "name":format!("near{index}"),
                "value":{"type":"number","value":index}
            })
        })
        .collect::<Vec<_>>();
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => {
            vec![result(id, json!({"result":near}))]
        }
        "Runtime.getProperties" if params["objectId"] == json!("scope-global-1") => vec![result(
            id,
            json!({"result":[{
                "name":"repository",
                "value":{"type":"object","objectId":"wrong-outer-root"}
            }]}),
        )],
        _ => vec![ok(id)],
    })
}

fn malformed_near_scope_responder() -> MockResponder {
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => vec![result(
            id,
            json!({"result":[
                {"name":"localKnown","value":{"type":"number","value":1}},
                {"value":{"type":"number","value":2}}
            ]}),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("scope-global-1") => vec![result(
            id,
            json!({"result":[
                {"name":"globalGuess","value":{"type":"number","value":3}}
            ]}),
        )],
        _ => vec![ok(id)],
    })
}

fn prototype_completion_responder() -> MockResponder {
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" => {
            let response = match params["objectId"].as_str() {
                Some("scope-local-1") => json!({
                    "result":[{
                        "name":"items",
                        "value":{"type":"object","subtype":"array","objectId":"array-1"}
                    }]
                }),
                Some("scope-global-1") => json!({"result":[]}),
                Some("array-1") => json!({
                    "result":[
                        {
                            "name":"map",
                            "value":{"type":"function","objectId":"own-map"}
                        },
                        {
                            "name":"unsafe",
                            "get":{"type":"function","objectId":"own-getter"}
                        }
                    ],
                    "internalProperties":[{
                        "name":"[[Prototype]]",
                        "value":{"type":"object","objectId":"array-prototype"}
                    }]
                }),
                Some("array-prototype") => json!({
                    "result":[
                        {"name":"map","value":{"type":"function","objectId":"prototype-map"}},
                        {"name":"filter","value":{"type":"function","objectId":"prototype-filter"}},
                        {"name":"unsafe","value":{"type":"function","objectId":"unsafe-function"}}
                    ],
                    "internalProperties":[{
                        "name":"[[Prototype]]",
                        "value":{"type":"object","objectId":"object-prototype"}
                    }]
                }),
                Some("object-prototype") => json!({
                    "result":[{
                        "name":"filter",
                        "value":{"type":"function","objectId":"duplicate-filter"}
                    }]
                }),
                _ => json!({"result":[]}),
            };
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    })
}

fn deep_prototype_completion_responder() -> MockResponder {
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => vec![result(
            id,
            json!({"result":[{
                "name":"deep",
                "value":{"type":"object","objectId":"prototype-depth-0"}
            }]}),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("scope-global-1") => {
            vec![result(id, json!({"result":[]}))]
        }
        "Runtime.getProperties" => {
            let depth = params["objectId"]
                .as_str()
                .and_then(|value| value.strip_prefix("prototype-depth-"))
                .and_then(|value| value.parse::<usize>().ok())
                .expect("prototype depth object");
            vec![result(
                id,
                json!({
                    "result":[{
                        "name":format!("level{depth}"),
                        "value":{"type":"function","objectId":format!("function-{depth}")}
                    }],
                    "internalProperties":[{
                        "name":"[[Prototype]]",
                        "value":{
                            "type":"object",
                            "objectId":format!("prototype-depth-{}", depth + 1)
                        }
                    }]
                }),
            )]
        }
        _ => vec![ok(id)],
    })
}

fn unusual_intermediate_prototype_responder() -> MockResponder {
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" => {
            let response = match params["objectId"].as_str() {
                Some("scope-local-1") => json!({
                    "result":[{
                        "name":"a",
                        "value":{"type":"object","objectId":"object-a"}
                    }]
                }),
                Some("object-a") => json!({
                    "result":[{
                        "name":"b",
                        "value":{"type":"object","objectId":"object-b"}
                    }],
                    "internalProperties":[{
                        "name":"[[Prototype]]",
                        "value":{"type":"number","value":1}
                    }]
                }),
                Some("object-b") => json!({
                    "result":[{
                        "name":"complete",
                        "value":{"type":"function","objectId":"function-complete"}
                    }]
                }),
                _ => json!({"result":[]}),
            };
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    })
}

fn oversized_completion_payload_responder() -> MockResponder {
    let oversized = "x".repeat(1024 * 1024);
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" if params["objectId"] == json!("scope-local-1") => vec![result(
            id,
            json!({"result":[{
                "name":"large",
                "value":{"type":"object","objectId":"large-object"}
            }]}),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("large-object") => vec![result(
            id,
            json!({"result":[{
                "name":"largeValue",
                "value":{"type":"string","value":oversized}
            }]}),
        )],
        "Runtime.getProperties" => vec![result(id, json!({"result":[]}))],
        _ => vec![ok(id)],
    })
}

fn descriptor_quota_completion_responder() -> MockResponder {
    let exhausted = (0..MAX_COMPLETION_DESCRIPTORS_PER_PAUSE)
        .map(|index| json!({"name": index.to_string()}))
        .collect::<Vec<_>>();
    Box::new(move |id, method, params| match method {
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.paused",
                json!({"reason":"Break on start","callFrames":[]}),
            ),
        ],
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", breakpoint_paused_params()),
        ],
        "Runtime.getProperties" => {
            let response = match params["objectId"].as_str() {
                Some("scope-local-1") => json!({
                    "result":[{
                        "name":"item",
                        "value":{"type":"object","objectId":"item"}
                    }]
                }),
                Some("item") => json!({
                    "result":[{
                        "name":"shallow",
                        "value":{"type":"function","objectId":"shallow-function"}
                    }],
                    "internalProperties":[{
                        "name":"[[Prototype]]",
                        "value":{"type":"object","objectId":"quota-prototype"}
                    }]
                }),
                Some("quota-prototype") => json!({"result": exhausted}),
                _ => json!({"result":[]}),
            };
            vec![result(id, response)]
        }
        _ => vec![ok(id)],
    })
}

fn exact_pause_owner(registry: &DebugSessionRegistry, sink: &CollectingSink) -> (u64, u64) {
    let (_, frames) = wait_for_stopped(sink, 0);
    registry
        .with_session(WORKSPACE_KEY, |adapter| {
            (
                adapter
                    .current_pause_generation()
                    .expect("pause generation"),
                frames[0].frame_id,
            )
        })
        .expect("session")
}

#[test]
fn lexical_completion_uses_scope_shadowing_without_evaluation() {
    let server = MockCdpServer::start(completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Lexical {
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("completion");

    assert_eq!(
        completion
            .items
            .iter()
            .map(|item| (item.label.as_str(), item.kind))
            .collect::<Vec<_>>(),
        vec![
            ("globalOnly", DebugCompletionItemKind::Variable),
            ("localOnly", DebugCompletionItemKind::Variable),
            ("repository", DebugCompletionItemKind::Variable),
        ]
    );
    assert!(!completion.is_incomplete);
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
}

#[test]
fn member_completion_resolves_only_static_ordinary_data_roots() {
    let server = MockCdpServer::start(completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("repository".into()),
                    path: Vec::new(),
                    prefix: "find".into(),
                },
            })
        })
        .expect("session")
        .expect("completion");

    assert_eq!(
        completion.items,
        vec![
            crate::debug_adapter::DebugCompletionItem {
                label: "findAll".into(),
                kind: DebugCompletionItemKind::Property,
            },
            crate::debug_adapter::DebugCompletionItem {
                label: "findOne".into(),
                kind: DebugCompletionItemKind::Property,
            },
        ]
    );
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
}

#[test]
fn member_completion_includes_prototype_methods_without_duplicates_or_getters() {
    let server = MockCdpServer::start(prototype_completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("items".into()),
                    path: Vec::new(),
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("completion");

    assert_eq!(
        completion
            .items
            .iter()
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>(),
        vec!["filter", "map"]
    );
    assert!(!completion.is_incomplete);
    assert!(server.params_for("Runtime.callFunctionOn").is_empty());
    assert!(server.params_for("Debugger.evaluateOnCallFrame").is_empty());
    assert!(server
        .params_for("Runtime.getProperties")
        .iter()
        .all(|params| params["ownProperties"] == json!(true)));
}

#[test]
fn member_completion_stops_at_the_prototype_depth_cap() {
    let server = MockCdpServer::start(deep_prototype_completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("deep".into()),
                    path: Vec::new(),
                    prefix: "level".into(),
                },
            })
        })
        .expect("session")
        .expect("bounded completion");

    assert_eq!(
        completion
            .items
            .iter()
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>(),
        (0..=MAX_COMPLETION_PROTOTYPE_DEPTH)
            .map(|depth| format!("level{depth}"))
            .collect::<Vec<_>>()
    );
    assert!(completion.is_incomplete);
    assert_eq!(
        server.params_for("Runtime.getProperties").len(),
        MAX_COMPLETION_PROTOTYPE_DEPTH + 2
    );
}

#[test]
fn unusual_intermediate_prototype_does_not_block_member_path_traversal() {
    let server = MockCdpServer::start(unusual_intermediate_prototype_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("a".into()),
                    path: vec!["b".into()],
                    prefix: "comp".into(),
                },
            })
        })
        .expect("session")
        .expect("completion");

    assert_eq!(completion.items.len(), 1);
    assert_eq!(completion.items[0].label, "complete");
    assert!(!completion.is_incomplete);
}

#[test]
fn oversized_descriptor_payload_returns_truthful_incomplete_completion() {
    let server = MockCdpServer::start(oversized_completion_payload_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("large".into()),
                    path: Vec::new(),
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("bounded completion");

    assert!(completion.items.is_empty());
    assert!(completion.is_incomplete);
}

#[test]
fn stale_pause_is_rejected_before_any_completion_cdp_request() {
    let server = MockCdpServer::start(completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);
    let before = server.params_for("Runtime.getProperties").len();

    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation: pause_generation + 1,
                frame_id,
                query: DebugCompletionQuery::Lexical {
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect_err("stale completion");

    assert!(error.contains("owner changed"));
    assert_eq!(server.params_for("Runtime.getProperties").len(), before);
}

#[test]
fn truncated_near_scope_never_guesses_an_outer_member_root() {
    let server = MockCdpServer::start(truncated_near_scope_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("repository".into()),
                    path: Vec::new(),
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("bounded incomplete response");

    assert!(completion.items.is_empty());
    assert!(completion.is_incomplete);
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);
}

#[test]
fn malformed_near_scope_keeps_known_partial_but_blocks_outer_lexical_guessing() {
    let server = MockCdpServer::start(malformed_near_scope_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Lexical {
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("known partial completion");

    assert_eq!(
        completion
            .items
            .iter()
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>(),
        vec!["localKnown"]
    );
    assert!(completion.is_incomplete);
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);
}

#[test]
fn expired_deadline_returns_an_incomplete_completion_result() {
    let server = MockCdpServer::start(completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion =
        crate::debug_cdp::completions::with_test_completion_deadline(Duration::ZERO, || {
            registry
                .with_session(WORKSPACE_KEY, |adapter| {
                    adapter.completions(DebugCompletionRequest {
                        pause_generation,
                        frame_id,
                        query: DebugCompletionQuery::Lexical {
                            prefix: String::new(),
                        },
                    })
                })
                .expect("session")
                .expect("expired completion degrades")
        });

    assert!(completion.items.is_empty());
    assert!(completion.is_incomplete);
}

#[test]
fn exhausted_completion_request_quota_keeps_shallow_member_labels() {
    let server = MockCdpServer::start(deep_prototype_completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);
    let request = || DebugCompletionRequest {
        pause_generation,
        frame_id,
        query: DebugCompletionQuery::Member {
            root: DebugCompletionRoot::Binding("deep".into()),
            path: Vec::new(),
            prefix: "level".into(),
        },
    };

    let requests_per_complete_member = MAX_COMPLETION_PROTOTYPE_DEPTH.saturating_add(2);
    let complete_requests = MAX_COMPLETION_REQUESTS_PER_PAUSE / requests_per_complete_member;
    for _ in 0..complete_requests {
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.completions(request()))
            .expect("session")
            .expect("completion within quota");
    }
    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.completions(request()))
        .expect("session")
        .expect("quota exhaustion degrades");

    assert_eq!(completion.items.len(), 1);
    assert_eq!(completion.items[0].label, "level0");
    assert!(completion.is_incomplete);
}

#[test]
fn exhausted_completion_descriptor_quota_keeps_shallow_member_labels() {
    let server = MockCdpServer::start(descriptor_quota_completion_responder());
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id) = exact_pause_owner(&registry, &sink);

    let completion = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.completions(DebugCompletionRequest {
                pause_generation,
                frame_id,
                query: DebugCompletionQuery::Member {
                    root: DebugCompletionRoot::Binding("item".into()),
                    path: Vec::new(),
                    prefix: String::new(),
                },
            })
        })
        .expect("session")
        .expect("descriptor quota exhaustion degrades");

    assert_eq!(completion.items.len(), 1);
    assert_eq!(completion.items[0].label, "shallow");
    assert!(completion.is_incomplete);
}
