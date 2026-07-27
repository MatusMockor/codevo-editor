#[test]
fn indexed_and_named_pages_share_one_snapshot_and_classify_canonical_indices() {
    let server = MockCdpServer::start(variables_responder(json!([
        {"name": "0", "value": {"type": "number", "value": 0}},
        {"name": "1", "value": {"type": "number", "value": 1}},
        {"name": "4294967294", "value": {"type": "number", "value": 2}},
        {"name": "00", "value": {"type": "number", "value": 3}},
        {"name": "01", "value": {"type": "number", "value": 4}},
        {"name": "4294967295", "value": {"type": "number", "value": 5}}
    ])));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
    let request = DebugVariablePageRequest {
        pause_generation,
        frame_id,
        variables_reference,
        start: 0,
        count: 100,
    };

    let indexed = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page_filtered(request, DebugVariableFilter::Indexed)
        })
        .expect("session")
        .expect("indexed page");
    let named = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page_filtered(request, DebugVariableFilter::Named)
        })
        .expect("session")
        .expect("named page");

    assert_eq!(indexed.total, Some(3));
    assert_eq!(
        indexed
            .variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        ["0", "1", "4294967294"]
    );
    assert_eq!(named.total, Some(3));
    assert_eq!(
        named
            .variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        ["00", "01", "4294967295"]
    );
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);
}

#[test]
fn indexed_page_randomly_addresses_the_4900_range_from_one_snapshot() {
    let properties = (0..5_000)
        .map(|index| {
            json!({
                "name": index.to_string(),
                "value": {"type": "number", "value": index}
            })
        })
        .collect::<Vec<_>>();
    let server = MockCdpServer::start(variables_responder(json!(properties)));
    let (registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);

    let page = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.variables_page_filtered(
                DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference,
                    start: 4_900,
                    count: 100,
                },
                DebugVariableFilter::Indexed,
            )
        })
        .expect("session")
        .expect("random indexed page");

    assert_eq!(page.total, Some(5_000));
    assert_eq!(page.returned, 100);
    assert_eq!(
        page.variables
            .first()
            .map(|variable| variable.name.as_str()),
        Some("4900")
    );
    assert_eq!(
        page.variables.last().map(|variable| variable.name.as_str()),
        Some("4999")
    );
    assert_eq!(page.next_start, None);
    assert_eq!(server.params_for("Runtime.getProperties").len(), 1);
}

#[test]
fn dispatched_rhs_success_and_error_clear_an_unrelated_descriptor_snapshot() {
    for is_error in [false, true] {
        let unrelated_version = Arc::new(AtomicUsize::new(0));
        let version_for_server = Arc::clone(&unrelated_version);
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
                    json!({"result": [
                        {
                            "name": "target",
                            "writable": true,
                            "value": {"type": "number", "value": 1}
                        },
                        {
                            "name": "unrelated",
                            "writable": true,
                            "value": {"type": "object", "objectId": "unrelated-object"}
                        }
                    ]}),
                )]
            }
            "Runtime.getProperties" if params["objectId"] == json!("unrelated-object") => {
                let value = version_for_server.fetch_add(1, Ordering::SeqCst) + 1;
                vec![result(
                    id,
                    json!({"result": [
                        {"name": "value", "writable": true, "value": {"type": "number", "value": value}}
                    ]}),
                )]
            }
            "Debugger.evaluateOnCallFrame" if is_error => vec![result(
                id,
                json!({
                    "result": {"type": "undefined"},
                    "exceptionDetails": {"text": "side effect then throw"}
                }),
            )],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({"result": {"type": "number", "value": 42}}),
            )],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
        let scope = registry
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
        let unrelated_reference = scope
            .variables
            .iter()
            .find(|variable| variable.name == "unrelated")
            .expect("unrelated object")
            .variables_reference;
        let unrelated_request = DebugVariablePageRequest {
            pause_generation,
            frame_id,
            variables_reference: unrelated_reference,
            start: 0,
            count: 100,
        };
        registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(unrelated_request)
            })
            .expect("session")
            .expect("unrelated page");

        let mutation = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_variable(DebugSetVariableRequest {
                    pause_generation,
                    frame_id,
                    variables_reference,
                    name: "target".to_string(),
                    value: "(globalThis.sibling = 5, (() => { throw new Error('boom') })())"
                        .to_string(),
                })
            })
            .expect("session");
        assert_eq!(mutation.is_err(), is_error);

        let refreshed = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables_page(unrelated_request)
            })
            .expect("session")
            .expect("unrelated page after throwing RHS");
        assert_eq!(refreshed.variables[0].value, "2");
        let unrelated_reads = server
            .params_for("Runtime.getProperties")
            .into_iter()
            .filter(|params| params["objectId"] == json!("unrelated-object"))
            .count();
        assert_eq!(unrelated_reads, 2);
    }
}

#[test]
fn malformed_property_arrays_fail_closed_and_are_never_cached() {
    for malformed in [
        json!({"privateProperties": []}),
        json!({"result": [], "privateProperties": {}}),
        json!({"result": [{"value": {"type": "number", "value": 1}}]}),
        json!({"result": [{"name": 7, "value": {"type": "number", "value": 1}}]}),
        json!({"result": [{"name": "value", "value": "not-a-remote-object"}]}),
        json!({"result": [{"name": "value", "value": {"value": 1}}]}),
        json!({"result": [{"name": "value", "value": {"type": "mystery"}}]}),
        json!({"result": [{"name": "value", "get": {"type": "function", "objectId": 7}}]}),
    ] {
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
            "Runtime.getProperties" => vec![result(id, malformed.clone())],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (pause_generation, frame_id, variables_reference) = first_scope_owner(&registry, &sink);
        let request = DebugVariablePageRequest {
            pause_generation,
            frame_id,
            variables_reference,
            start: 0,
            count: 100,
        };

        for _ in 0..2 {
            let page = registry
                .with_session(WORKSPACE_KEY, |adapter| adapter.variables_page(request))
                .expect("session");
            assert!(page.is_err());
        }
        assert_eq!(server.params_for("Runtime.getProperties").len(), 2);
    }
}
