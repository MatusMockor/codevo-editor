use super::*;
use crate::debug_adapter::{
    DebugCompletionItemKind, DebugCompletionQuery, DebugCompletionRequest, DebugCompletionRoot,
};
use crate::debug_cdp::variables::MAX_CDP_PROPERTY_DESCRIPTORS;
use serde_json::json;

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
