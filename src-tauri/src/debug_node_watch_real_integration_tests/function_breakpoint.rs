use super::*;

#[test]
fn private_registry_watch_installs_first_generation_function_breakpoint_before_immediate_call() {
    let _admission = super::super::real_node_test_admission::acquire();
    let Some(runtime) =
        supported_watch_runtime_or_skip("first-generation watch function breakpoint")
    else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("function-ran");
    write_revision(&dependency, 1);
    fs::write(
        &script,
        concat!(
            "globalThis.qaImmediate = function qaImmediate() { ",
            "const revision = require('./revision.js'); ",
            "require('node:fs').writeFileSync('function-ran', String(revision)); ",
            "}; globalThis.qaImmediate();\n",
            "setInterval(() => {}, 1000);\n",
        ),
    )
    .expect("write first-generation function-breakpoint target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root(&root_key);
    let permit = registry.begin_start(&root_key).expect("watch permit");
    let sink = Arc::new(WatchEventSink::default());
    let breakpoints = Vec::new();
    let response = start_native_node_watch_session(NativeNodeWatchSessionStartup {
        factory: DebugSessionFactoryStartup {
            permit,
            sink: Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            registry: &registry,
            breakpoint_kind: DebugBreakpointAdapterKind::Node,
            breakpoints: &breakpoints,
            mode: DebugSessionMode::OwnedLaunch,
        },
        root: workspace.0.clone(),
        workspace_directory: fs::File::open(&workspace.0).expect("retained workspace"),
        entry_authority: retained_entry_authority(&workspace.0, &script),
        policy: NativeNodeWatchLaunchPolicy::for_test(
            "server.js".to_string(),
            u8::try_from(runtime.major_version).expect("managed Node major"),
        )
        .expect("strict function-breakpoint policy"),
        exception_pause_mode: DebugExceptionPauseMode::None,
        exception_type_filter:
            crate::debug_exception_type_filter::DebugExceptionTypeFilter::default(),
        just_my_code: None,
        function_breakpoints: vec![DebugFunctionBreakpoint {
            id: "qa-first-generation".to_string(),
            function_name: "globalThis.qaImmediate".to_string(),
            enabled: true,
        }],
        authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)),
    })
    .expect("first-generation function-breakpoint watch factory");
    let DebugStartResponse::Ok { session_id } = response else {
        panic!("function-breakpoint watch factory did not register: {response:?}");
    };
    registry
        .control_for_session(session_id, &root_key, |adapter| adapter.confirm_launch())
        .expect("registered watch session")
        .expect("confirm pending native watch launch");

    let (reason, frames) = wait_for_watch_stopped(&sink, 0);
    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(
        frames
            .first()
            .is_some_and(|frame| frame.name == "qaImmediate"),
        "expected first-generation qaImmediate function breakpoint, got {frames:?}"
    );
    assert!(
        !marker.exists(),
        "the function body must not run before its first-generation breakpoint pause"
    );
    let events = lock_recover(&sink.0);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
            .count(),
        1,
        "internal first-generation bootstrap pauses must remain hidden"
    );
    drop(events);

    registry
        .control_for_session(session_id, &root_key, |adapter| {
            adapter.step(StepKind::Continue)
        })
        .expect("registered watch session")
        .expect("continue first-generation function breakpoint");
    wait_for_file_contents(&marker, "1");
    // Native watch installs dependency watchers asynchronously after require().
    thread::sleep(Duration::from_millis(250));
    write_revision(&dependency, 2);
    let (replacement_reason, replacement_frames) = wait_for_watch_stopped(&sink, 1);
    assert_eq!(replacement_reason, DebugStopReason::Breakpoint);
    assert!(
        replacement_frames
            .first()
            .is_some_and(|frame| frame.name == "qaImmediate"),
        "expected replacement-generation qaImmediate breakpoint, got {replacement_frames:?}"
    );
    assert_eq!(
        fs::read_to_string(&marker).expect("first-generation function marker"),
        "1",
        "replacement function body ran before its persisted breakpoint pause"
    );
    let events = lock_recover(&sink.0);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Stopped { .. }))
            .count(),
        2,
        "each target generation may expose only its real function-breakpoint stop"
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                &event.payload,
                DebugEventPayload::FunctionBreakpointsVerified {
                    generation: 1,
                    breakpoints,
                } if breakpoints.iter().any(|breakpoint| {
                    breakpoint.id == "qa-first-generation" && breakpoint.verified
                })
            ))
            .count(),
        2,
        "the persisted policy generation must verify once for each target generation"
    );
    drop(events);

    assert!(registry.stop_by_id(session_id));
    wait_for_terminated_event(&sink, session_id);
}
