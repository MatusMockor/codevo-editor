use super::watch_adapter::{WatchNodeDebugAdapter, WatchNodeDebugAdapterFailure};
use super::watch_cdp::{node_cdp_watch_adapters, NodeCdpWatchAdapterPolicy};
use super::watch_command_worker::WatchDebugCommandWorkerPolicy;
use super::watch_controller::{
    WatchReconnectController, WatchReconnectEffect, WatchReconnectPolicy,
};
use super::watch_desired_policy::{DesiredDebuggerPolicy, DesiredDebuggerPolicySnapshot};
use super::watch_generation::{
    InspectorEndpointFingerprint, TargetGeneration, WatchGenerationPolicy, WatchInstant,
};
use super::watch_session_factory::{
    start_native_node_watch_session, NativeNodeWatchLaunchAuthority, NativeNodeWatchSessionStartup,
};
use super::watch_supervisor::{
    watch_target_disconnect_feed, WatchSupervisorCancellation, WatchSupervisorController,
};
use super::{spawn_node_inspector, spawn_node_inspector_descriptor_bound};
use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventPayload, DebugEventSink,
    DebugExceptionPauseMode, DebugScopeInfo, DebugStackFrame, DebugStartResponse, DebugStopReason,
    DebugVariableInfo, StepKind,
};
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use crate::debug_commands::DebugSessionFactoryStartup;
use crate::debug_node_launch::{
    build_native_node_watch_launch_plan_for_test, NativeNodeWatchLaunchPolicy,
};
use crate::debug_session_registry::{DebugSessionMode, DebugSessionRegistry};
use crate::debug_support::DebugProcessHandle;
use crate::managed_javascript_typescript::node_executable_path;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::{Error as WebSocketError, Message, WebSocket};

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_GROUP_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(20);
static NEXT_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

struct TempWatchWorkspace(PathBuf);

impl TempWatchWorkspace {
    fn new() -> Self {
        let suffix = NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "codevo-node-watch-proof-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create native Node watch proof workspace");
        Self(
            root.canonicalize()
                .expect("canonicalize native Node watch proof workspace"),
        )
    }
}

impl Drop for TempWatchWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct WatchProcess {
    child: Child,
    process: DebugProcessHandle,
    process_group_id: i32,
}

impl WatchProcess {
    fn terminate_and_reap(&mut self) {
        self.process.terminate();
        if let Err(message) = wait_for_child_exit_result(&mut self.child, PROBE_TIMEOUT) {
            hard_kill_and_reap(&mut self.child, self.process_group_id);
            panic!("native Node watch supervisor cleanup failed: {message}");
        }
    }
}

impl Drop for WatchProcess {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            self.process.terminate();
            if wait_for_child_exit_result(&mut self.child, PROBE_TIMEOUT).is_err() {
                hard_kill_and_reap(&mut self.child, self.process_group_id);
            }
        }
    }
}

struct NodeRuntime {
    executable: PathBuf,
    major_version: u32,
}

#[test]
fn descriptor_bound_watch_spawn_cannot_be_redirected_by_root_path_replacement() {
    let Some(runtime) = supported_watch_runtime_or_skip("descriptor-bound watch spawn") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    fs::write(&script, "setInterval(() => {}, 1000);\n").expect("write retained script");
    let retained = fs::File::open(&workspace.0).expect("retain original workspace");
    let launch = build_native_node_watch_launch_plan_for_test(
        &workspace.0,
        "server.js".to_string(),
        u8::try_from(runtime.major_version).expect("bounded managed Node major"),
    )
    .expect("build descriptor-bound launch before replacement");

    let moved = workspace.0.with_extension(format!(
        "retained-{}",
        NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::rename(&workspace.0, &moved).expect("move retained workspace");
    fs::create_dir(&workspace.0).expect("create foreign replacement root");
    let replacement = RootReplacementGuard {
        moved,
        original: workspace.0.clone(),
    };
    assert!(
        !workspace.0.join("server.js").exists(),
        "foreign replacement must not contain the launch script"
    );

    let root_key = workspace.0.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root(&root_key);
    let captured_emitter = Arc::new(Mutex::new(None));
    let emitter_capture = Arc::clone(&captured_emitter);
    registry
        .start_session(
            &root_key,
            Arc::new(WatchEventSink::default()),
            move |emitter| {
                *lock_recover(&emitter_capture) = Some(emitter);
                Ok(Box::new(InertWatchHarnessAdapter))
            },
        )
        .expect("capture descriptor-bound emitter");
    let emitter = lock_recover(&captured_emitter)
        .take()
        .expect("descriptor-bound emitter");
    let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let mut process = spawn_node_inspector_descriptor_bound(
        &launch,
        retained,
        emitter,
        Arc::clone(&startup_is_current),
    )
    .expect("spawn from retained directory despite pathname replacement");
    process
        .ensure_unambiguous(startup_is_current.as_ref())
        .expect("one retained inspector endpoint");
    process.terminate_and_wait();
    assert!(registry.deactivate_root(&root_key));
    drop(replacement);
}

#[test]
fn spawned_watch_owner_reaps_process_group_during_unwind() {
    let Some(runtime) = supported_watch_runtime_or_skip("watch process unwind ownership") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    fs::write(&script, "setInterval(() => {}, 1000);\n").expect("write unwind target");
    let retained = fs::File::open(&workspace.0).expect("retain unwind workspace");
    let launch = build_native_node_watch_launch_plan_for_test(
        &workspace.0,
        "server.js".to_string(),
        u8::try_from(runtime.major_version).expect("bounded managed Node major"),
    )
    .expect("build unwind launch");

    let root_key = workspace.0.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root(&root_key);
    let captured_emitter = Arc::new(Mutex::new(None));
    let emitter_capture = Arc::clone(&captured_emitter);
    registry
        .start_session(
            &root_key,
            Arc::new(WatchEventSink::default()),
            move |emitter| {
                *lock_recover(&emitter_capture) = Some(emitter);
                Ok(Box::new(InertWatchHarnessAdapter))
            },
        )
        .expect("capture unwind emitter");
    let emitter = lock_recover(&captured_emitter)
        .take()
        .expect("unwind emitter");
    let startup_is_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let process = spawn_node_inspector_descriptor_bound(
        &launch,
        retained,
        emitter,
        Arc::clone(&startup_is_current),
    )
    .expect("spawn unwind watch owner");
    process
        .ensure_unambiguous(startup_is_current.as_ref())
        .expect("one unwind inspector endpoint");
    let process_group_id =
        i32::try_from(process.process_id_for_test()).expect("unwind process group");

    let unwind = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _owned_process = process;
        panic!("exercise spawned watch unwind cleanup");
    }));
    assert!(unwind.is_err());
    wait_for_process_group_exit(process_group_id, PROCESS_GROUP_EXIT_TIMEOUT);
    assert!(registry.deactivate_root(&root_key));
}

struct RootReplacementGuard {
    moved: PathBuf,
    original: PathBuf,
}

impl Drop for RootReplacementGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.original);
        let _ = fs::rename(&self.moved, &self.original);
    }
}

#[test]
fn private_registry_factory_keeps_one_session_across_native_target_generations_and_reaps_on_stop() {
    let Some(runtime) = supported_watch_runtime_or_skip("private registry watch factory") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    write_debug_target(&script);
    write_revision(&dependency, 1);
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
        policy: NativeNodeWatchLaunchPolicy::for_test(
            "server.js".to_string(),
            u8::try_from(runtime.major_version).expect("managed Node major"),
        )
        .expect("strict private policy"),
        exception_pause_mode: DebugExceptionPauseMode::None,
        just_my_code: None,
        authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| true)),
    })
    .expect("private watch factory");
    let DebugStartResponse::Ok { session_id } = response else {
        panic!("private watch factory did not register: {response:?}");
    };
    registry
        .control_for_session(session_id, &root_key, |adapter| adapter.confirm_launch())
        .expect("registered watch session")
        .expect("confirm pending native watch launch");

    let first = wait_for_marker(&marker, 1);
    wait_for_output(&sink, session_id, "watch-output 1");
    write_revision(&dependency, 2);
    let second = wait_for_marker_with_events(&marker, 2, &sink, &Arc::new(Mutex::new(Vec::new())));
    assert_ne!(first.pid, second.pid);
    assert_eq!(registry.session_id_for_root(&root_key), Some(session_id));
    assert_eq!(
        lock_recover(&sink.0)
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Started { .. }))
            .count(),
        1
    );

    assert!(registry.stop_by_id(session_id));
    wait_for_process_exit(second.pid, PROBE_TIMEOUT);
    wait_for_terminated_event(&sink, session_id);
    let events = lock_recover(&sink.0);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Started { .. }))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
            .count(),
        1
    );
}

#[test]
fn stale_registry_publication_reaps_started_watch_without_event_leak_or_finish_deadlock() {
    let Some(runtime) = supported_watch_runtime_or_skip("stale private watch publication") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    write_debug_target(&script);
    write_revision(&dependency, 1);
    let root_key = workspace.0.to_string_lossy().into_owned();
    let registry = Arc::new(DebugSessionRegistry::new());
    registry.activate_root(&root_key);
    let permit = registry.begin_start(&root_key).expect("stale watch permit");
    let sink = Arc::new(WatchEventSink::default());
    let hook_registry = Arc::clone(&registry);
    let hook_root = root_key.clone();
    let authority = NativeNodeWatchLaunchAuthority::new(Arc::new(|| true))
        .with_after_supervisor_started(Arc::new(move || {
            hook_registry.deactivate_root(&hook_root);
        }));
    let breakpoints = Vec::new();
    let started_at = Instant::now();

    let result = start_native_node_watch_session(NativeNodeWatchSessionStartup {
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
        policy: NativeNodeWatchLaunchPolicy::for_test(
            "server.js".to_string(),
            u8::try_from(runtime.major_version).expect("managed Node major"),
        )
        .expect("strict stale policy"),
        exception_pause_mode: DebugExceptionPauseMode::None,
        just_my_code: None,
        authority,
    });

    assert!(result
        .expect_err("stale registry publication")
        .contains("lifecycle changed"));
    assert!(
        started_at.elapsed() < PROBE_TIMEOUT,
        "stale startup teardown deadlocked"
    );
    assert_eq!(registry.session_id_for_root(&root_key), None);
    assert!(
        !marker.exists(),
        "an unconfirmed stale watch must never run user code"
    );
    assert!(
        lock_recover(&sink.0).is_empty(),
        "pending Started/Terminated events leaked from rejected publication"
    );
}

#[test]
fn unconfirmed_registry_launch_times_out_without_running_user_code_and_retires_session() {
    let Some(runtime) = supported_watch_runtime_or_skip("unconfirmed private watch timeout") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    write_debug_target(&script);
    write_revision(&dependency, 1);
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
        policy: NativeNodeWatchLaunchPolicy::for_test(
            "server.js".to_string(),
            u8::try_from(runtime.major_version).expect("managed Node major"),
        )
        .expect("strict private policy"),
        exception_pause_mode: DebugExceptionPauseMode::None,
        just_my_code: None,
        authority: NativeNodeWatchLaunchAuthority::new(Arc::new(|| true))
            .with_start_confirm_timeout(Duration::from_millis(100)),
    })
    .expect("paused private watch factory");
    let DebugStartResponse::Ok { session_id } = response else {
        panic!("private watch factory did not register: {response:?}");
    };

    let deadline = Instant::now() + PROBE_TIMEOUT;
    while registry.session_id_for_root(&root_key) == Some(session_id) && Instant::now() < deadline {
        thread::sleep(POLL_INTERVAL);
    }
    assert_eq!(
        registry.session_id_for_root(&root_key),
        None,
        "unconfirmed launch must retire its registry session after the bounded timeout"
    );
    assert!(
        !marker.exists(),
        "unconfirmed launch must never execute user code"
    );
    wait_for_terminated_event(&sink, session_id);
}

#[derive(Debug, Eq, PartialEq)]
struct TargetMarker {
    pid: u32,
    revision: u32,
}

#[test]
fn production_watch_stack_replays_breakpoint_into_fresh_target_and_reaps_group() {
    let Some(runtime) = supported_watch_runtime_or_skip("production watch debugger proof") else {
        return;
    };
    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    write_debug_target(&script);
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
        DesiredDebuggerPolicySnapshot::new(
            &workspace.0,
            DebugBreakpointAdapterKind::Node,
            vec![watch_breakpoint(&script_path)],
            DebugExceptionPauseMode::None,
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

    // Node installs dependency watchers asynchronously after the entry module
    // starts. Keep the proof bounded while avoiding a same-tick mutation race.
    thread::sleep(Duration::from_millis(250));
    write_revision(&dependency, 2);
    let second = wait_for_marker_with_events(&marker, 2, &sink, &reconnect_effects);
    assert_ne!(second.pid, first.pid, "watch target PID was not replaced");
    assert_ne!(second.pid, supervisor_pid);
    assert!(
        process_is_running(i32::try_from(second.pid).expect("second target PID")),
        "replacement target exited before publication: {:?}",
        lock_recover(&sink.0).as_slice()
    );
    assert_eq!(process_group(second.pid), process_group_id);
    wait_for_generation_activation(&reconnect_effects, 2);
    let reconnect_floor = wait_for_pause_epoch(
        &watch_adapter,
        resumed_floor + 1,
        "published replacement reconnect floor",
    );
    assert_eq!(
        reconnect_floor,
        resumed_floor + 1,
        "target close must invalidate the old inventory before carrying its floor forward"
    );
    let second_pause =
        wait_for_breakpoint_state(&sink, &reconnect_effects, &script_path, 6, 2, 1, 2);
    assert_eq!(
        second_pause.pause_epoch,
        reconnect_floor + 1,
        "replacement pause must continue the exact pause-generation lineage"
    );
    assert_exact_watch_inspection(&watch_adapter, &second_pause);
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

/// Phase 0 only: prove the real runtime contract before exposing restart-aware
/// watch debugging through production launch plans or the debug IPC.
#[test]
fn native_node_watch_replaces_one_inspector_target_and_reaps_the_process_group() {
    let Some(runtime) = available_node_runtime() else {
        if std::env::var_os("CI").is_some() {
            panic!(
                "native Node watch integration proof requires a runnable Node.js executable in CI"
            );
        }
        eprintln!(
            "skipping native Node watch integration proof: no runnable Node.js executable is available"
        );
        return;
    };
    if runtime.major_version < 20 {
        if std::env::var_os("CI").is_some() {
            panic!("native Node watch integration proof requires Node.js 20 or newer in CI");
        }
        eprintln!(
            "skipping native Node watch integration proof: Node.js {} is older than the supported Node.js 20 baseline",
            runtime.major_version
        );
        return;
    }
    assert!(
        node_supports_watch(&runtime.executable),
        "supported Node.js {} did not advertise --watch",
        runtime.major_version
    );

    let workspace = TempWatchWorkspace::new();
    let script = workspace.0.join("server.js");
    let dependency = workspace.0.join("revision.js");
    let marker = workspace.0.join("target.json");
    write_target(&script);
    write_revision(&dependency, 1);

    let mut command = Command::new(&runtime.executable);
    command
        // Node runtime flags must precede the script path. The inspector port is
        // runtime-owned so every replacement target receives a fresh endpoint.
        .arg("--watch")
        .arg("--inspect-brk=127.0.0.1:0")
        .arg(&script)
        .arg(&marker)
        .current_dir(&workspace.0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0);
    let mut child = command
        .spawn()
        .expect("spawn native Node watch integration proof");
    let supervisor_pid = child.id();
    let stderr = child.stderr.take().expect("native Node watch proof stderr");
    let endpoints = spawn_endpoint_reader(stderr);
    let process = DebugProcessHandle::from_process_id(supervisor_pid);
    let process_group_id = i32::try_from(supervisor_pid).expect("supervisor PID");
    let mut watch = WatchProcess {
        child,
        process,
        process_group_id,
    };
    assert_eq!(
        process_group(supervisor_pid),
        process_group_id,
        "native Node watch supervisor did not own its requested process group"
    );

    let first_endpoint = receive_distinct_endpoint(&endpoints, None, PROBE_TIMEOUT);
    let mut first_socket = connect_and_resume(&first_endpoint);
    let first = wait_for_marker(&marker, 1);
    assert_ne!(
        first.pid, supervisor_pid,
        "native Node --watch did not separate its supervisor from the inspected target"
    );
    assert_eq!(
        process_group(first.pid),
        process_group_id,
        "first inspected target escaped the native Node watch process group"
    );
    assert!(
        watch
            .child
            .try_wait()
            .expect("watch supervisor status")
            .is_none(),
        "native Node watch supervisor exited with its first target"
    );

    write_revision(&dependency, 2);
    let second_endpoint =
        receive_distinct_endpoint(&endpoints, Some(&first_endpoint), PROBE_TIMEOUT);
    assert_ne!(
        endpoint_token(&second_endpoint),
        endpoint_token(&first_endpoint),
        "native Node --watch reused the inspector UUID across target replacement"
    );
    wait_for_socket_close(&mut first_socket, PROBE_TIMEOUT);
    wait_for_process_exit(first.pid, PROBE_TIMEOUT);

    let _second_socket = connect_and_resume(&second_endpoint);
    let second = wait_for_marker(&marker, 2);
    assert_ne!(
        second.pid, first.pid,
        "native Node --watch did not replace the inspected child process"
    );
    assert_ne!(
        second.pid, supervisor_pid,
        "replacement inspector endpoint belongs to the watch supervisor"
    );
    assert_eq!(
        process_group(second.pid),
        process_group_id,
        "replacement inspected target escaped the native Node watch process group"
    );
    assert!(
        watch
            .child
            .try_wait()
            .expect("watch supervisor status")
            .is_none(),
        "native Node watch supervisor exited during target replacement"
    );

    watch.terminate_and_reap();
    wait_for_process_exit(second.pid, PROBE_TIMEOUT);
}

fn available_node_runtime() -> Option<NodeRuntime> {
    let node = PathBuf::from(node_executable_path()?);
    let (success, output) = run_bounded_output(&node, "--version")?;
    if !success {
        return None;
    }
    let version = String::from_utf8(output).ok()?;
    let major_version = version
        .trim()
        .strip_prefix('v')?
        .split('.')
        .next()?
        .parse()
        .ok()?;
    Some(NodeRuntime {
        executable: node,
        major_version,
    })
}

fn supported_watch_runtime_or_skip(proof: &str) -> Option<NodeRuntime> {
    let Some(runtime) = available_node_runtime() else {
        capability_unavailable(proof, "no runnable Node.js executable is available");
        return None;
    };
    if !matches!(runtime.major_version, 22 | 24 | 26) {
        capability_unavailable(
            proof,
            &format!(
                "Node.js {} is outside the managed watch runtime policy",
                runtime.major_version
            ),
        );
        return None;
    }
    if !node_supports_watch(&runtime.executable) {
        capability_unavailable(
            proof,
            &format!(
                "Node.js {} did not advertise --watch",
                runtime.major_version
            ),
        );
        return None;
    }
    Some(runtime)
}

fn capability_unavailable(proof: &str, reason: &str) {
    if std::env::var_os("CI").is_some() {
        panic!("{proof} requires native Node watch capability: {reason}");
    }
    eprintln!("skipping {proof}: {reason}");
}

fn node_supports_watch(node: &Path) -> bool {
    run_bounded_output(node, "--help").is_some_and(|(success, stdout)| {
        success
            && String::from_utf8_lossy(&stdout)
                .lines()
                .any(|line| line.trim_start().starts_with("--watch "))
    })
}

fn run_bounded_output(program: &Path, argument: &str) -> Option<(bool, Vec<u8>)> {
    let mut child = Command::new(program)
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout.read_to_end(&mut output).map(|_| output);
        let _ = sender.send(result);
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    };
    let output = receiver.recv_timeout(Duration::from_secs(1)).ok()?.ok()?;
    Some((success, output))
}

fn write_target(script: &Path) {
    fs::write(
        script,
        "const fs = require('node:fs');\nconst revision = require('./revision.js');\nfs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, revision }));\nsetInterval(() => {}, 1000);\n",
    )
    .expect("write native Node watch target");
}

fn write_debug_target(script: &Path) {
    fs::write(
        script,
        "const fs = require('node:fs');\nconst revision = require('./revision.js');\nfs.writeFileSync('target.json', JSON.stringify({ pid: process.pid, revision })); console.log('watch-output', revision);\nfunction checkpoint() {\n  const observed = revision;\n  return observed;\n}\nif (revision === 1) checkpoint();\nelse setTimeout(checkpoint, 250);\nsetInterval(() => {}, 1000);\n",
    )
    .expect("write production watch debug target");
}

fn write_revision(dependency: &Path, revision: u32) {
    fs::write(dependency, format!("module.exports = {revision};\n"))
        .expect("write native Node watch dependency");
}

fn spawn_endpoint_reader(stderr: impl std::io::Read + Send + 'static) -> Receiver<String> {
    let (sender, receiver) = mpsc::sync_channel(8);
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let Some(endpoint) = line
                .strip_prefix("Debugger listening on ")
                .and_then(valid_loopback_endpoint)
            else {
                continue;
            };
            if sender.send(endpoint.to_string()).is_err() {
                break;
            }
        }
    });
    receiver
}

fn valid_loopback_endpoint(candidate: &str) -> Option<&str> {
    let authority_and_token = candidate.strip_prefix("ws://127.0.0.1:")?;
    let (port, token) = authority_and_token.split_once('/')?;
    let port = port.parse::<u16>().ok()?;
    (port != 0
        && !token.is_empty()
        && token.len() <= 128
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
    .then_some(candidate)
}

fn endpoint_token(endpoint: &str) -> &str {
    endpoint
        .rsplit_once('/')
        .map(|(_, token)| token)
        .expect("validated inspector endpoint token")
}

fn receive_distinct_endpoint(
    endpoints: &Receiver<String>,
    previous: Option<&str>,
    timeout: Duration,
) -> String {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out waiting for a native Node watch inspector endpoint"
        );
        match endpoints.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(endpoint) if previous != Some(endpoint.as_str()) => return endpoint,
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                panic!("native Node watch stderr closed before the inspector endpoint arrived")
            }
        }
    }
}

type InspectorSocket = WebSocket<TcpStream>;

fn connect_and_resume(endpoint: &str) -> InspectorSocket {
    let port = endpoint
        .strip_prefix("ws://127.0.0.1:")
        .and_then(|value| value.split_once('/'))
        .and_then(|(port, _)| port.parse::<u16>().ok())
        .expect("validated inspector port");
    let stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("loopback inspector address"),
        Duration::from_secs(1),
    )
    .expect("connect native Node watch inspector");
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .expect("configure inspector read timeout");
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .expect("configure inspector write timeout");
    let (mut socket, _) =
        tungstenite::client::client(endpoint, stream).expect("upgrade native Node inspector");
    send_cdp_request(&mut socket, 1, "Runtime.runIfWaitingForDebugger");
    socket
}

fn send_cdp_request(socket: &mut InspectorSocket, id: u64, method: &str) {
    socket
        .send(Message::Text(
            json!({ "id": id, "method": method, "params": {} })
                .to_string()
                .into(),
        ))
        .expect("send native Node inspector request");
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for `{method}` response"
        );
        match socket.read() {
            Ok(Message::Text(message)) => {
                let Ok(payload) = serde_json::from_str::<Value>(&message) else {
                    continue;
                };
                if payload.get("id").and_then(Value::as_u64) == Some(id) {
                    assert!(
                        payload.get("error").is_none(),
                        "native Node inspector rejected `{method}`: {payload}"
                    );
                    return;
                }
            }
            Ok(_) => {}
            Err(WebSocketError::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => panic!("native Node inspector closed during `{method}`: {error}"),
        }
    }
}

fn wait_for_socket_close(socket: &mut InspectorSocket, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        assert!(
            Instant::now() < deadline,
            "old native Node watch inspector socket stayed open after target replacement"
        );
        match socket.read() {
            Ok(Message::Close(_))
            | Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => return,
            Ok(_) => {}
            Err(WebSocketError::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return,
        }
    }
}

fn wait_for_marker(marker: &Path, revision: u32) -> TargetMarker {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if let Some(marker) = read_target_marker(marker, revision) {
            return marker;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for native Node watch target revision {revision}"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_marker_with_events(
    marker: &Path,
    revision: u32,
    sink: &WatchEventSink,
    reconnect_effects: &Mutex<Vec<WatchReconnectEffect>>,
) -> TargetMarker {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if let Some(marker) = read_target_marker(marker, revision) {
            return marker;
        }
        if Instant::now() >= deadline {
            panic!(
                "timed out waiting for native Node watch target revision {revision}; \
                 reconnect effects: {:?}; events: {:?}",
                lock_recover(reconnect_effects).as_slice(),
                lock_recover(&sink.0).as_slice(),
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn read_target_marker(marker: &Path, revision: u32) -> Option<TargetMarker> {
    let source = fs::read_to_string(marker).ok()?;
    let value = serde_json::from_str::<Value>(&source).ok()?;
    let observed_revision = value
        .get("revision")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    if observed_revision != Some(revision) {
        return None;
    }
    let pid = value
        .get("pid")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())?;
    Some(TargetMarker { pid, revision })
}

struct ObservedWatchController<Controller> {
    inner: Controller,
    effects: Arc<Mutex<Vec<WatchReconnectEffect>>>,
}

impl<Controller> ObservedWatchController<Controller>
where
    Controller: WatchSupervisorController,
{
    fn record(&self, effect: WatchReconnectEffect) -> WatchReconnectEffect {
        if effect != WatchReconnectEffect::Ignored {
            lock_recover(&self.effects).push(effect);
        }
        effect
    }
}

impl<Controller> WatchSupervisorController for ObservedWatchController<Controller>
where
    Controller: WatchSupervisorController,
{
    fn seed_initial(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        let effect = self.inner.seed_initial(endpoint, now);
        self.record(effect)
    }

    fn observe_endpoint(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        let effect = self.inner.observe_endpoint(endpoint, now);
        self.record(effect)
    }

    fn target_closed(
        &mut self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        let effect = self.inner.target_closed(generation, endpoint, now);
        self.record(effect)
    }

    fn deadline_elapsed(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        let effect = self.inner.deadline_elapsed(now);
        self.record(effect)
    }

    fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        let effect = self.inner.supervisor_exited();
        self.record(effect)
    }

    fn cancel(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        let effect = self.inner.cancel(now);
        self.record(effect)
    }
}

#[derive(Default)]
struct WatchEventSink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for WatchEventSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.0).push(event);
    }
}

#[derive(Clone, Debug)]
struct BreakpointPauseOwner {
    pause_epoch: u64,
    frame: DebugStackFrame,
}

fn wait_for_breakpoint_state(
    sink: &WatchEventSink,
    reconnect_effects: &Mutex<Vec<WatchReconnectEffect>>,
    script_path: &str,
    line_number: u32,
    expected_hits: usize,
    expected_verifications: usize,
    expected_generation: u64,
) -> BreakpointPauseOwner {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        let events = lock_recover(&sink.0);
        let matching_pauses: Vec<_> = events
            .iter()
            .filter_map(|event| match &event.payload {
                DebugEventPayload::Stopped {
                    reason: DebugStopReason::Breakpoint,
                    frames,
                    pause_generation,
                } => frames
                    .iter()
                    .find(|frame| frame.line_number == line_number)
                    .cloned()
                    .map(|frame| BreakpointPauseOwner {
                        pause_epoch: *pause_generation,
                        frame,
                    }),
                _ => None,
            })
            .collect();
        let hits = matching_pauses.len();
        let verifications = events
            .iter()
            .filter(|event| {
                matches!(
                    &event.payload,
                    DebugEventPayload::BreakpointsVerified {
                        file_path,
                        breakpoints,
                    } if file_path == script_path
                        && breakpoints.iter().any(|breakpoint| {
                            breakpoint.verified && breakpoint.line_number == line_number
                        })
                )
            })
            .count();
        let generation_activated = lock_recover(reconnect_effects).iter().any(|effect| {
            matches!(effect, WatchReconnectEffect::Activated(generation)
                if generation.get() == expected_generation)
        });
        if hits >= expected_hits && verifications >= expected_verifications && generation_activated
        {
            return matching_pauses
                .last()
                .cloned()
                .expect("expected breakpoint pause owner");
        }
        if Instant::now() >= deadline {
            panic!(
                "timed out waiting for production watch breakpoint state \
                 (hits {expected_hits}, verifications {expected_verifications}, \
                 generation {expected_generation}); reconnect effects: {:?}; events: {:?}",
                lock_recover(reconnect_effects).as_slice(),
                events.as_slice()
            );
        }
        drop(events);
        thread::sleep(POLL_INTERVAL);
    }
}

fn assert_exact_watch_inspection(
    watch_adapter: &WatchNodeDebugAdapter,
    owner: &BreakpointPauseOwner,
) {
    assert_eq!(
        watch_adapter.current_pause_epoch(),
        Ok(owner.pause_epoch),
        "active control ownership must match the stopped event epoch"
    );
    let stack = watch_adapter
        .stack_trace(owner.pause_epoch)
        .expect("stack trace for exact watch pause owner");
    assert_eq!(stack.pause_epoch(), owner.pause_epoch);
    assert!(
        stack.frames().iter().any(|frame| frame == &owner.frame),
        "typed stack trace did not preserve the exact breakpoint frame: {:?}",
        stack.frames()
    );
    let scopes = watch_adapter
        .scopes(owner.pause_epoch, owner.frame.frame_id)
        .expect("scopes for exact watch frame owner");
    assert_eq!(scopes.pause_epoch(), owner.pause_epoch);
    assert_eq!(scopes.frame_id(), owner.frame.frame_id);
    assert!(
        !scopes.scopes().is_empty(),
        "breakpoint frame must expose at least one bounded scope"
    );
}

fn wait_for_pause_epoch(watch_adapter: &WatchNodeDebugAdapter, minimum: u64, proof: &str) -> u64 {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if let Ok(epoch) = watch_adapter.current_pause_epoch() {
            if epoch >= minimum {
                return epoch;
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {proof} at or above epoch {minimum}"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_generation_activation(
    reconnect_effects: &Mutex<Vec<WatchReconnectEffect>>,
    expected_generation: u64,
) {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if lock_recover(reconnect_effects).iter().any(|effect| {
            matches!(effect, WatchReconnectEffect::Activated(generation)
                if generation.get() == expected_generation)
        }) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for published watch generation {expected_generation}: {:?}",
            lock_recover(reconnect_effects).as_slice()
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_terminated_event(sink: &WatchEventSink, session_id: u64) {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if lock_recover(&sink.0).iter().any(|event| {
            event.session_id == session_id
                && matches!(event.payload, DebugEventPayload::Terminated { .. })
        }) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for logical production watch termination"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_output(sink: &WatchEventSink, session_id: u64, expected: &str) {
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if lock_recover(&sink.0).iter().any(|event| {
            event.session_id == session_id
                && matches!(
                    &event.payload,
                    DebugEventPayload::Output { text, .. }
                        if strip_ansi_escape_sequences(text) == expected
                )
        }) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for native Node watch output `{expected}`: {:?}",
            lock_recover(&sink.0).as_slice()
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn strip_ansi_escape_sequences(value: &str) -> String {
    let mut stripped = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' && characters.peek() == Some(&'[') {
            characters.next();
            for sequence_character in characters.by_ref() {
                if ('@'..='~').contains(&sequence_character) {
                    break;
                }
            }
        } else {
            stripped.push(character);
        }
    }
    stripped
}

fn watch_breakpoint(file_path: &str) -> DebugBreakpoint {
    DebugBreakpoint {
        id: "watch-reconnect-breakpoint".to_string(),
        file_path: file_path.to_string(),
        line_number: 5,
        column_number: None,
        condition: None,
        hit_condition: None,
        log_message: None,
        enabled: true,
        verified: false,
    }
}

struct InertWatchHarnessAdapter;

impl DebugAdapter for InertWatchHarnessAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        Ok(breakpoints.to_vec())
    }

    fn step(&mut self, _kind: StepKind) -> Result<(), String> {
        Err("unused production watch harness operation".to_string())
    }

    fn pause(&mut self) -> Result<(), String> {
        Err("unused production watch harness operation".to_string())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        Ok(Vec::new())
    }

    fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        Ok(Vec::new())
    }

    fn evaluate(&mut self, _frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: String::new(),
            value_type: None,
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn terminate(&mut self) {}
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn wait_for_child_exit_result(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            Ok(None) => return Err("timed out waiting for supervisor process exit".to_string()),
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn hard_kill_and_reap(child: &mut Child, process_group_id: i32) {
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn process_group(pid: u32) -> i32 {
    let pid = i32::try_from(pid).expect("process PID");
    let process_group = unsafe { libc::getpgid(pid) };
    assert_ne!(
        process_group, -1,
        "unable to inspect process group for PID {pid}"
    );
    process_group
}

fn process_group_is_running(process_group_id: i32) -> bool {
    let result = unsafe { libc::kill(-process_group_id, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn wait_for_process_group_exit(process_group_id: i32, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while process_group_is_running(process_group_id) {
        assert!(
            Instant::now() < deadline,
            "native Node watch process group {process_group_id} survived owner cleanup for \
             {timeout:?}"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn wait_for_process_exit(pid: u32, timeout: Duration) {
    let pid = i32::try_from(pid).expect("target PID");
    let deadline = Instant::now() + timeout;
    while process_is_running(pid) {
        assert!(
            Instant::now() < deadline,
            "native Node watch target {pid} survived process-group termination"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

fn process_is_running(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}
