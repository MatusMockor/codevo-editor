#[test]
fn multiline_evaluation_propagates_exact_bounded_nested_property_expressions() {
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
            json!({
                "result": {
                    "type": "object",
                    "description": "Object",
                    "objectId": "evaluated-root"
                }
            }),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("evaluated-root") => vec![result(
            id,
            json!({
                "result": [{
                    "name": "nested",
                    "value": {
                        "type": "object",
                        "description": "Object",
                        "objectId": "evaluated-nested"
                    }
                }]
            }),
        )],
        "Runtime.getProperties" if params["objectId"] == json!("evaluated-nested") => vec![result(
            id,
            json!({
                "result": [{
                    "name": "b",
                    "value": {"type": "number", "value": 1, "description": "1"}
                }]
            }),
        )],
        _ => vec![ok(id)],
    }));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (_, frames) = wait_for_stopped(&sink, 0);
    let expression = "({\n  nested: { b: 1 }\n})";
    let evaluated = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.evaluate(frames[0].frame_id, expression)
        })
        .expect("session")
        .expect("evaluation");
    assert_eq!(evaluated.evaluate_name.as_deref(), Some(expression));

    let page = |variables_reference| {
        registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation: adapter
                        .current_pause_generation()
                        .expect("current pause generation"),
                    frame_id: frames[0].frame_id,
                    variables_reference,
                    start: 0,
                    count: 100,
                })
            })
            .expect("session")
            .expect("variables")
    };
    let root = page(evaluated.variables_reference);
    assert_eq!(
        root.variables[0].evaluate_name.as_deref(),
        Some("(({\n  nested: { b: 1 }\n})).nested")
    );
    let nested = page(root.variables[0].variables_reference);
    assert_eq!(
        nested.variables[0].evaluate_name.as_deref(),
        Some("(({\n  nested: { b: 1 }\n})).nested.b")
    );
}
