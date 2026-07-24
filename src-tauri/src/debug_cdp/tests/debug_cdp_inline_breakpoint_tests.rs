use super::*;

#[test]
fn inline_breakpoint_sends_and_verifies_exact_raw_column_with_existing_features() {
    let file = breakpoint_fixture_file("inline-raw");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({
                "breakpointId": "cdp-inline",
                "locations": [{"scriptId": "1", "lineNumber": 14, "columnNumber": 8}]
            }),
        )],
        _ => vec![ok(id)],
    }));
    let mut inline = breakpoint(&file_path, "inline", 12, Some("enabled"), true);
    inline.column_number = Some(5);
    inline.hit_condition = Some(DebugHitCondition::Equals { count: 2 });
    inline.log_message = Some("value={value}".to_string());
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

    let updated = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_breakpoints(&file_path, &[inline])
        })
        .expect("session")
        .expect("inline breakpoint");

    assert_eq!(
        server.params_for("Debugger.setBreakpointByUrl"),
        vec![json!({
            "url": file_url_from_path(&file_path),
            "lineNumber": 11,
            "columnNumber": 4,
            "condition": "enabled"
        })]
    );
    assert!(updated[0].verified);
    assert_eq!(updated[0].line_number, 15);
    assert_eq!(updated[0].column_number, Some(9));
    assert_eq!(
        updated[0].hit_condition,
        Some(DebugHitCondition::Equals { count: 2 })
    );
    assert_eq!(updated[0].log_message.as_deref(), Some("value={value}"));
}

#[test]
fn inline_breakpoint_maps_typescript_position_in_both_directions() {
    let root = temp_root("inline-source-map");
    let source = root.join("src/app.ts");
    let emitted = root.join("dist/app.js");
    let map = root.join("dist/app.js.map");
    write_file(&source, "one two three\n");
    write_file(&emitted, "one       two       three\n");
    write_file(
        &map,
        r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA,UAAI,UAAM"}"#,
    );
    let source_path = source.to_string_lossy().to_string();
    let generated_url = file_url_from_path(&emitted.to_string_lossy());
    let expected_url = generated_url.clone();
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({
                "breakpointId": "cdp-inline-mapped",
                "locations": [{"scriptId": "1", "lineNumber": 0, "columnNumber": 10}]
            }),
        )],
        _ => vec![ok(id)],
    }));
    let mut source_maps = SourceMapRegistry::new(&root).expect("registry");
    source_maps
        .register_script(&generated_url, &file_url_from_path(&map.to_string_lossy()))
        .expect("source map");
    let mut inline = breakpoint(&source_path, "inline-mapped", 1, None, true);
    inline.column_number = Some(9);
    let sink = Arc::new(CollectingSink::default());
    let registry = DebugSessionRegistry::new();
    let url = server.url.clone();
    registry
        .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
            NodeCdpAdapter::connect_with_source_maps(
                &url,
                emitter,
                &[inline],
                NodeCdpConnectOptions {
                    exception_pause_mode: DebugExceptionPauseMode::None,
                    request_timeout: MOCK_REQUEST_TIMEOUT,
                    ownership: DebuggeeOwnership::External,
                    source_maps: Some(source_maps),
                    startup: CdpStartupPolicy::SpawnedWaiting {
                        startup_entry: None,
                    },
                    disconnected: None,
                    startup_is_current: Arc::new(|| true),
                    internal_step_filter: None,
                },
            )
            .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
        })
        .expect("mapped inline session");

    assert_eq!(
        server.params_for("Debugger.setBreakpointByUrl"),
        vec![json!({"url": expected_url, "lineNumber": 0, "columnNumber": 10})]
    );
    let verified = sink
        .payloads()
        .into_iter()
        .find_map(|payload| match payload {
            DebugEventPayload::BreakpointsVerified { breakpoints, .. } => Some(breakpoints),
            _ => None,
        })
        .expect("verified inline event");
    assert!(verified[0].verified);
    assert_eq!(verified[0].line_number, 1);
    assert_eq!(verified[0].column_number, Some(5));
}

#[test]
fn inline_breakpoint_consumes_resolution_that_races_before_set_response() {
    let file = breakpoint_fixture_file("inline-early-resolution");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![
            event(
                "Debugger.breakpointResolved",
                json!({
                    "breakpointId": "cdp-inline-early",
                    "location": {"scriptId": "1", "lineNumber": 20, "columnNumber": 6}
                }),
            ),
            result(
                id,
                json!({"breakpointId": "cdp-inline-early", "locations": []}),
            ),
        ],
        _ => vec![ok(id)],
    }));
    let mut inline = breakpoint(&file_path, "inline", 12, None, true);
    inline.column_number = Some(5);
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

    let updated = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_breakpoints(&file_path, &[inline])
        })
        .expect("session")
        .expect("early resolution");

    assert!(updated[0].verified);
    assert_eq!(updated[0].line_number, 21);
    assert_eq!(updated[0].column_number, Some(7));
}

#[test]
fn failed_replacement_cleanup_terminates_before_arming_a_ghost_breakpoint() {
    let file = breakpoint_fixture_file("replace-cleanup-failure");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({
                "breakpointId": "cdp-old",
                "locations": [{"scriptId": "1", "lineNumber": 1, "columnNumber": 0}]
            }),
        )],
        "Debugger.removeBreakpoint" => vec![error_reply(id, "cannot remove")],
        _ => vec![ok(id)],
    }));
    let (registry, _sink) = start_session_with_mock(
        &server.url,
        vec![breakpoint(&file_path, "old", 2, None, true)],
        MOCK_REQUEST_TIMEOUT,
    );

    let error = registry
        .with_session(WORKSPACE_KEY, |adapter| {
            adapter.set_breakpoints(&file_path, &[breakpoint(&file_path, "new", 3, None, true)])
        })
        .expect("session")
        .expect_err("cleanup must fail closed");

    assert!(error.contains("session was terminated"));
    assert_eq!(server.params_for("Debugger.removeBreakpoint").len(), 2);
    assert_eq!(server.params_for("Debugger.setBreakpointByUrl").len(), 1);
}

#[test]
fn breakpoints_with_empty_locations_stay_pending_until_breakpoint_resolved() {
    let file = breakpoint_fixture_file("pending-bps");
    let file_path = file.to_string_lossy().to_string();
    let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId": "cdp-bp-pending", "locations": []}),
        )],
        "Runtime.runIfWaitingForDebugger" => vec![
            ok(id),
            event(
                "Debugger.breakpointResolved",
                json!({
                    "breakpointId": "cdp-bp-pending",
                    "location": {"scriptId": "9", "lineNumber": 14, "columnNumber": 0}
                }),
            ),
        ],
        _ => vec![ok(id)],
    }));

    let mut inline = breakpoint(&file_path, "bp-1", 12, None, true);
    inline.column_number = Some(5);
    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![inline], MOCK_REQUEST_TIMEOUT);
    let verified_events = wait_for(
        || {
            let events: Vec<(String, Vec<DebugBreakpoint>)> = sink
                .payloads()
                .into_iter()
                .filter_map(|payload| match payload {
                    DebugEventPayload::BreakpointsVerified {
                        file_path,
                        breakpoints,
                    } => Some((file_path, breakpoints)),
                    _ => None,
                })
                .collect();
            (events.len() >= 2).then_some(events)
        },
        EVENT_WAIT_TIMEOUT,
        "breakpoint resolution events",
    );

    assert_eq!(verified_events[0].0, file_path);
    assert!(!verified_events[0].1[0].verified);
    assert_eq!(verified_events[0].1[0].line_number, 12);
    assert_eq!(verified_events[0].1[0].column_number, Some(5));
    assert_eq!(verified_events[1].0, file_path);
    assert!(verified_events[1].1[0].verified);
    assert_eq!(verified_events[1].1[0].line_number, 15);
    assert_eq!(verified_events[1].1[0].column_number, Some(1));
}

#[test]
fn breakpoint_resolutions_for_unknown_ids_are_buffered_until_registration() {
    let mut state = CdpShared::new(None);
    let file_path = "/workspace/debug/src/app.js".to_string();

    let buffered = apply_breakpoint_resolution(
        &mut state,
        "cdp-early",
        GeneratedPosition {
            line: 14,
            column: 0,
        },
    );

    assert!(buffered.is_none());
    assert_eq!(
        state.pending_resolutions.get("cdp-early"),
        Some(&GeneratedPosition {
            line: 14,
            column: 0
        })
    );

    state.resolution_index.insert(
        "cdp-known".to_string(),
        BreakpointResolutionTarget {
            breakpoint_id: "bp-9".to_string(),
            column_number: None,
            file_path: file_path.clone(),
            generated_url: file_url_from_path(&file_path),
            source_path: file_path.clone(),
        },
    );
    state.breakpoints_by_file.insert(
        file_path.clone(),
        vec![breakpoint(&file_path, "bp-9", 10, None, true)],
    );
    let resolved = apply_breakpoint_resolution(
        &mut state,
        "cdp-known",
        GeneratedPosition {
            line: 21,
            column: 0,
        },
    )
    .expect("resolved breakpoint");

    assert_eq!(resolved.0, file_path);
    assert!(resolved.1[0].verified);
    assert_eq!(resolved.1[0].line_number, 22);
}

#[test]
fn unknown_breakpoint_resolution_buffer_is_strictly_bounded() {
    let mut state = CdpShared::new(None);
    for index in 0..=MAX_PENDING_BREAKPOINT_RESOLUTIONS {
        assert!(apply_breakpoint_resolution(
            &mut state,
            &format!("unknown-{index}"),
            GeneratedPosition {
                line: index as u32,
                column: 0,
            },
        )
        .is_none());
    }
    assert_eq!(
        state.pending_resolutions.len(),
        MAX_PENDING_BREAKPOINT_RESOLUTIONS
    );
    assert!(!state
        .pending_resolutions
        .contains_key(&format!("unknown-{MAX_PENDING_BREAKPOINT_RESOLUTIONS}")));
}

#[test]
fn breakpoint_activation_toggle_uses_exactly_one_typed_cdp_request() {
    let server = MockCdpServer::start(simple_responder());
    let (registry, _sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let session_id = registry
        .session_id_for_root(WORKSPACE_KEY)
        .expect("debug session id");
    registry
        .with_session_by_id(session_id, |adapter| adapter.set_breakpoints_active(false))
        .expect("known session")
        .expect("breakpoint activation ACK");
    assert_eq!(
        server.params_for("Debugger.setBreakpointsActive"),
        vec![json!({ "active": false })]
    );
}
