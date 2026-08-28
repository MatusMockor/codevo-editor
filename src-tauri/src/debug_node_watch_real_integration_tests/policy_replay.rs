use super::*;

#[test]
fn production_watch_stack_replays_breakpoint_and_exception_filter_into_fresh_target() {
    let _admission = super::super::real_node_test_admission::acquire();
    let Some(runtime) = supported_watch_runtime_or_skip("production watch debugger proof") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    let checkpoint_gate = workspace.0.join("checkpoint-gate");
    fs::write(
        &script,
        "const fs = require('node:fs');\nconst revision = require('./revision.js');\ntry { throw new RangeError('must stay hidden'); } catch {} fs.writeFileSync('target.json', JSON.stringify({ pid: process.pid, revision })); console.log('watch-output', revision);\nfunction checkpoint() {\n  const observed = revision;\n  return observed;\n}\nfunction waitForCheckpointGate() {\n  if (fs.existsSync('checkpoint-gate')) { checkpoint(); return; }\n  setImmediate(waitForCheckpointGate);\n}\nif (revision === 1) checkpoint();\nelse waitForCheckpointGate();\nsetInterval(() => {}, 1000);\n",
    )
    .expect("write production watch debug target with checkpoint gate");
    write_revision(&dependency, 1);
    let script = script
        .canonicalize()
        .expect("canonicalize production watch target");
    let script_path = script.to_string_lossy().into_owned();
    let root_path = workspace.0.to_string_lossy().into_owned();

    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root(&root_path);
    let sink = Arc::new(WatchEventSink::default());
    let captured_emitter = Arc::new(Mutex::new(None));
    let emitter_capture = Arc::clone(&captured_emitter);
    let session_id = registry
        .start_session(
            &root_path,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            move |emitter| {
                *lock_recover(&emitter_capture) = Some(emitter);
                Ok(Box::new(InertWatchHarnessAdapter))
            },
        )
        .expect("start internal production watch harness session");
    let emitter = lock_recover(&captured_emitter)
        .take()
        .expect("capture watch event emitter");

    let desired = Arc::new(Mutex::new(DesiredDebuggerPolicy::new(
        DesiredDebuggerPolicySnapshot::new_with_exception_filter(
            &workspace.0,
            DebugBreakpointAdapterKind::Node,
            vec![watch_breakpoint(&script_path)],
            DebugExceptionPauseMode::All,
            crate::debug_exception_type_filter::DebugExceptionTypeFilter::parse(vec![
                "TypeError".to_string()
            ])
            .expect("valid real watch exception filter"),
            true,
            None,
        )
        .expect("validated production watch desired policy"),
    )));
    let launch = build_native_node_watch_launch_plan_for_test(
        &workspace.0,
        "server.js".to_string(),
        u8::try_from(runtime.major_version).expect("bounded managed Node major"),
    )
    .expect("build exact production native-watch launch plan");
    let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let process = spawn_node_inspector(&launch, emitter.clone(), Arc::clone(&startup_is_current))
        .expect("spawn production Node watch inspector");
    process
        .ensure_unambiguous(startup_is_current.as_ref())
        .expect("one production watch inspector endpoint");
    let supervisor_pid = process.process_id_for_test();
    let process_group_id = i32::try_from(supervisor_pid).expect("supervisor PID");
    assert_eq!(
        process_group(supervisor_pid),
        process_group_id,
        "production watch supervisor did not own its exact process group"
    );

    let cancellation = WatchSupervisorCancellation::new();
    let (disconnect_publisher, disconnect_feed) = watch_target_disconnect_feed();
    let (connector, replay, publisher, watch_adapter, logical_finish_gate) =
        node_cdp_watch_adapters(
            workspace.0.clone(),
            Arc::new(retained_entry_authority(&workspace.0, &script)),
            NodeCdpWatchAdapterPolicy::new(
                Duration::from_secs(2),
                WatchDebugCommandWorkerPolicy::new(32, Duration::from_secs(2))
                    .expect("watch command worker policy"),
            )
            .expect("watch CDP adapter policy"),
            emitter,
            startup_is_current,
            desired,
            disconnect_publisher,
            cancellation.clone(),
        );
    let controller = WatchReconnectController::new(
        WatchGenerationPolicy::new(
            u64::try_from(PROBE_TIMEOUT.as_millis()).expect("bounded replacement timeout"),
            64,
        )
        .expect("watch generation policy"),
        WatchReconnectPolicy::new(2_000).expect("endpoint-before-close grace"),
        connector,
        replay,
        publisher,
    );
    let reconnect_effects = Arc::new(Mutex::new(Vec::new()));
    let controller = ObservedWatchController {
        inner: controller,
        effects: Arc::clone(&reconnect_effects),
    };
    let finish_registry = Arc::clone(&registry);
    let supervisor = process
        .spawn_watch_supervisor(
            controller,
            disconnect_feed,
            cancellation,
            Box::new(move |outcome| {
                let _ = logical_finish_gate
                    .finish(|| finish_registry.finish_session(session_id, outcome.exit_code()));
            }),
        )
        .expect("start production watch supervisor owner");

    let first = wait_for_marker(&marker, 1);
    assert_ne!(first.pid, supervisor_pid);
    assert_eq!(process_group(first.pid), process_group_id);
    let first_pause =
        wait_for_breakpoint_state(&sink, &reconnect_effects, &script_path, 5, 1, 1, 1);
    assert_exact_watch_inspection(&watch_adapter, &first_pause);
    let replacement_breakpoint = DebugBreakpoint {
        line_number: 6,
        ..watch_breakpoint(&script_path)
    };
    let applied = watch_adapter
        .set_breakpoints(&script_path, &[replacement_breakpoint])
        .expect("replace live generation-one breakpoint");
    assert_eq!(applied.len(), 1);
    assert!(applied[0].verified);
    watch_adapter
        .step(StepKind::Continue)
        .expect("continue first watch target to replacement breakpoint");
    let live_replacement_pause =
        wait_for_breakpoint_state(&sink, &reconnect_effects, &script_path, 6, 1, 0, 1);
    assert_exact_watch_inspection(&watch_adapter, &live_replacement_pause);
    watch_adapter
        .step(StepKind::Continue)
        .expect("continue first watch target after live breakpoint replacement");
    let resumed_floor = wait_for_pause_epoch(
        &watch_adapter,
        live_replacement_pause.pause_epoch + 1,
        "first target resume floor",
    );
    assert_eq!(resumed_floor, live_replacement_pause.pause_epoch + 1);

    let replacement_event_floor = lock_recover(&sink.0).len();
    let replacement_revision =
        trigger_policy_watch_replacement(&dependency, &sink, &reconnect_effects);
    let second =
        wait_for_marker_with_events(&marker, replacement_revision, &sink, &reconnect_effects);
    assert_ne!(second.pid, first.pid, "watch target PID was not replaced");
    assert_ne!(second.pid, supervisor_pid);
    assert!(
        process_is_running(i32::try_from(second.pid).expect("second target PID")),
        "replacement target exited before publication: {:?}",
        lock_recover(&sink.0).as_slice()
    );
    assert_eq!(process_group(second.pid), process_group_id);
    wait_for_generation_activation(&reconnect_effects, 2);
    wait_for_replayed_policy_verification(
        &sink,
        &reconnect_effects,
        replacement_event_floor,
        &script_path,
        6,
        2,
    );
    let reconnect_floor = wait_for_pause_epoch(
        &watch_adapter,
        resumed_floor + 1,
        "published replacement reconnect floor",
    );
    assert!(
        reconnect_floor > resumed_floor,
        "target close and the hidden replacement exception must advance the pause lineage"
    );
    fs::write(&checkpoint_gate, replacement_revision.to_string())
        .expect("release replacement checkpoint after capturing its reconnect floor");
    let second_pause =
        wait_for_breakpoint_state(&sink, &reconnect_effects, &script_path, 6, 2, 1, 2);
    assert_eq!(
        second_pause.pause_epoch,
        reconnect_floor + 1,
        "replacement pause must continue the exact pause-generation lineage"
    );
    assert_exact_watch_inspection(&watch_adapter, &second_pause);
    assert!(
        lock_recover(&sink.0).iter().all(|event| !matches!(
            &event.payload,
            DebugEventPayload::Stopped {
                reason: DebugStopReason::Exception,
                ..
            }
        )),
        "caught RangeError must remain hidden by the replayed TypeError-only filter"
    );
    assert_eq!(
        watch_adapter.stack_trace(first_pause.pause_epoch),
        Err(WatchNodeDebugAdapterFailure::StalePauseEpoch),
        "the replacement target must reject inspection owned by generation one"
    );

    supervisor.stop();
    wait_for_process_exit(supervisor_pid, PROBE_TIMEOUT);
    wait_for_process_exit(second.pid, PROBE_TIMEOUT);
    wait_for_terminated_event(&sink, session_id);
    assert!(
        !registry.finish_session(session_id, None),
        "logical watch finish callback must remove the exact harness session once"
    );
}

fn trigger_policy_watch_replacement(
    dependency: &Path,
    sink: &WatchEventSink,
    reconnect_effects: &Mutex<Vec<WatchReconnectEffect>>,
) -> u32 {
    let initial_effect_count = lock_recover(reconnect_effects).len();
    let deadline = Instant::now() + PROBE_TIMEOUT;
    for revision in 2..=17 {
        write_revision(dependency, revision);
        let observation_deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < observation_deadline && Instant::now() < deadline {
            let replacement_observed = lock_recover(reconnect_effects)
                .iter()
                .skip(initial_effect_count)
                .any(|effect| {
                    matches!(
                        effect,
                        WatchReconnectEffect::AwaitingReplacement(_)
                            | WatchReconnectEffect::Activated(_)
                    )
                });
            if replacement_observed {
                return revision;
            }
            thread::sleep(POLL_INTERVAL);
        }
        if Instant::now() >= deadline {
            break;
        }
    }
    panic!(
        "timed out causally triggering policy-replay watch replacement; reconnect effects: {:?}; events: {:?}",
        lock_recover(reconnect_effects).as_slice(),
        lock_recover(&sink.0).as_slice()
    );
}

fn wait_for_replayed_policy_verification(
    sink: &WatchEventSink,
    reconnect_effects: &Mutex<Vec<WatchReconnectEffect>>,
    event_floor: usize,
    script_path: &str,
    line_number: u32,
    generation: u64,
) {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        let policy_verified = lock_recover(&sink.0).iter().skip(event_floor).any(|event| {
            matches!(
                &event.payload,
                DebugEventPayload::BreakpointsVerified {
                    file_path,
                    breakpoints,
                } if file_path == script_path && breakpoints.iter().any(|breakpoint| {
                    breakpoint.verified && breakpoint.line_number == line_number
                })
            )
        });
        if policy_verified {
            return;
        }
        if Instant::now() >= deadline {
            panic!(
                "timed out waiting for generation {generation} policy activation at line {line_number}; reconnect effects: {:?}; events: {:?}",
                lock_recover(reconnect_effects).as_slice(),
                lock_recover(&sink.0).as_slice()
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
}
