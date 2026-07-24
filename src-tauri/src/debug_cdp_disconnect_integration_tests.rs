use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluatePolicy, DebugEvent, DebugEventPayload, DebugEventSink,
    DebugExceptionPauseMode, DebugLaunchTarget, DebugSessionRegistry, DebugSetExpressionRequest,
    DebugSetVariableRequest, DebugVariablePageRequest,
};
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use crate::debug_session_registry::DebugSessionMode;
use std::collections::HashMap;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct IgnoreSink;

impl DebugEventSink for IgnoreSink {
    fn emit(&self, _event: DebugEvent) {}
}

#[derive(Default)]
struct CollectSink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for CollectSink {
    fn emit(&self, event: DebugEvent) {
        self.0.lock().expect("events").push(event);
    }
}

impl CollectSink {
    fn stopped(&self) -> Option<(u64, u64)> {
        self.0
            .lock()
            .ok()?
            .iter()
            .find_map(|event| match &event.payload {
                DebugEventPayload::Stopped {
                    frames,
                    pause_generation,
                    ..
                } => frames
                    .first()
                    .map(|frame| (*pause_generation, frame.frame_id)),
                _ => None,
            })
    }
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn node_available() -> bool {
    Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("reserve inspector port")
        .local_addr()
        .expect("inspector address")
        .port()
}

fn fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "codevo-real-node-disconnect-{name}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create Node fixture");
    let script = root.join("target.js");
    let marker = root.join("ran.txt");
    fs::write(
        &script,
        "require('fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);",
    )
    .expect("write Node fixture");
    (root, script, marker)
}

fn wait_until(timeout: Duration, mut ready: impl FnMut() -> bool, message: &str) {
    let deadline = Instant::now() + timeout;
    while !ready() {
        assert!(Instant::now() < deadline, "timed out waiting for {message}");
        thread::sleep(Duration::from_millis(20));
    }
}

fn spawn_node(flag: &str, port: u16, script: &Path, marker: &Path) -> ChildGuard {
    ChildGuard(
        Command::new("node")
            .arg(format!("--{flag}=127.0.0.1:{port}"))
            .arg(script)
            .arg(marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn real Node inspector target"),
    )
}

fn attach_and_disconnect(root: &Path, port: u16) {
    wait_until(
        Duration::from_secs(5),
        || TcpStream::connect(("127.0.0.1", port)).is_ok(),
        "Node inspector",
    );
    let root_key = root.to_string_lossy().into_owned();
    let registry = DebugSessionRegistry::new();
    let permit = registry.begin_start(&root_key).expect("startup permit");
    let launch = DebugLaunchTarget::NodeAttach { port };
    let id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            Arc::new(IgnoreSink),
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            DebugSessionMode::ExternalNodeAttach,
            move |emitter| {
                crate::debug_cdp::create_node_cdp_adapter(
                    root,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("attach to real Node target");
    registry
        .disconnect_external_node_attach(&root_key, id)
        .expect("disconnect real Node target");
}

#[test]
fn external_running_node_survives_transport_disconnect() {
    if !node_available() {
        return;
    }
    let (root, script, marker) = fixture("running");
    let port = free_port();
    let mut child = spawn_node("inspect", port, &script, &marker);
    wait_until(Duration::from_secs(5), || marker.is_file(), "Node script");

    attach_and_disconnect(&root, port);

    assert!(child.0.try_wait().expect("inspect Node status").is_none());
    assert_eq!(
        fs::read_to_string(&marker).expect("read PID marker"),
        child.0.id().to_string()
    );
    drop(child);
    fs::remove_dir_all(root).expect("remove Node fixture");
}

#[test]
fn inspect_brk_node_progresses_and_survives_disconnect() {
    if !node_available() {
        return;
    }
    let (root, script, marker) = fixture("inspect-brk");
    let port = free_port();
    let mut child = spawn_node("inspect-brk", port, &script, &marker);
    wait_until(
        Duration::from_secs(5),
        || TcpStream::connect(("127.0.0.1", port)).is_ok(),
        "paused Node inspector",
    );
    assert!(!marker.exists(), "inspect-brk target ran before disconnect");

    attach_and_disconnect(&root, port);

    wait_until(
        Duration::from_secs(5),
        || marker.is_file(),
        "inspect-brk target to continue after disconnect",
    );
    assert!(child.0.try_wait().expect("inspect-brk status").is_none());
    assert_eq!(
        fs::read_to_string(&marker).expect("read PID marker"),
        child.0.id().to_string()
    );
    drop(child);
    fs::remove_dir_all(root).expect("remove Node fixture");
}

#[test]
fn real_node_set_variable_updates_scope_and_object_property() {
    if !node_available() {
        return;
    }
    let (root, script, _marker) = fixture("set-variable");
    fs::write(
        &script,
        "let count = 100; function run() { let count = 1; let rhsRuns = 0; const fixed = 5; let holder = { key: 1 }; debugger; setInterval(() => count + holder.key + rhsRuns + fixed, 1000); } run();",
    )
    .expect("write set-variable fixture");
    let root_key = root.to_string_lossy().into_owned();
    let registry = DebugSessionRegistry::new();
    let permit = registry.begin_start(&root_key).expect("startup permit");
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let adapter_root = root.clone();
    let sink = Arc::new(CollectSink::default());
    let session_id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink.clone(),
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            DebugSessionMode::OwnedLaunch,
            move |emitter| {
                crate::debug_cdp::create_node_cdp_adapter(
                    &adapter_root,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("attach set-variable target");
    let pause_deadline = Instant::now() + Duration::from_secs(5);
    while sink.stopped().is_none() && Instant::now() < pause_deadline {
        thread::sleep(Duration::from_millis(20));
    }
    let observed_events = sink.0.lock().expect("events").clone();
    assert!(
        sink.stopped().is_some(),
        "timed out waiting for debugger statement pause: {:?}",
        observed_events
    );
    let (pause_generation, frame_id) = sink.stopped().expect("stopped owner");
    let scopes = registry
        .with_session(&root_key, |adapter| adapter.scopes(frame_id))
        .expect("session")
        .expect("scopes");
    let mut count_owner = None;
    for scope in scopes {
        let page = registry
            .with_session(&root_key, |adapter| {
                adapter.variables_page(DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: scope.variables_reference,
                    start: 0,
                    count: 100,
                })
            })
            .expect("session")
            .expect("scope variables");
        if page
            .variables
            .iter()
            .any(|variable| variable.name == "count" && variable.value == "1")
        {
            count_owner = Some(scope.variables_reference);
        }
    }

    let watched_holder = registry
        .with_session(&root_key, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                "holder",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("evaluate holder watch");
    assert!(watched_holder.variables_reference > 0);
    assert_eq!(watched_holder.can_set_value, None);
    let watched_properties = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: watched_holder.variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("watch properties");
    assert_eq!(
        watched_properties
            .variables
            .iter()
            .find(|variable| variable.name == "key")
            .and_then(|variable| variable.can_set_value),
        Some(true)
    );
    let watched_key = registry
        .with_session(&root_key, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: watched_holder.variables_reference,
                name: "key".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect("set watched holder.key");
    assert_eq!(watched_key.value.value, "2");

    // Mutating the independent Watch root must not poison the previously
    // loaded lexical scope reference.
    let count = registry
        .with_session(&root_key, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: count_owner.expect("count scope"),
                name: "count".to_string(),
                value: "2".to_string(),
            })
        })
        .expect("session")
        .expect("set count");
    assert_eq!(count.value.value, "2");

    let refreshed_scope = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: count_owner.expect("count scope"),
                start: 0,
                count: 100,
            })
        })
        .expect("session")
        .expect("refreshed scope");
    let holder_reference = refreshed_scope
        .variables
        .iter()
        .find(|variable| variable.name == "holder")
        .map(|variable| variable.variables_reference)
        .expect("holder reference");

    let object = registry
        .with_session(&root_key, |adapter| {
            adapter.set_variable(DebugSetVariableRequest {
                pause_generation,
                frame_id,
                variables_reference: holder_reference,
                name: "key".to_string(),
                value: "({ nested: 3 })".to_string(),
            })
        })
        .expect("session")
        .expect("set holder.key");
    assert!(object.value.variables_reference > 0);
    let nested = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: object.value.variables_reference,
                start: 0,
                count: 10,
            })
        })
        .expect("session")
        .expect("inspect assigned object");
    assert!(nested
        .variables
        .iter()
        .any(|variable| variable.name == "nested" && variable.value == "3"));

    let watched_count = registry
        .with_session(&root_key, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                "count",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("evaluate count watch");
    let count_token = watched_count
        .set_expression_reference
        .expect("mutable identifier token");
    assert_eq!(watched_count.can_set_value, None);
    let watched_rhs_runs = registry
        .with_session(&root_key, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                "rhsRuns",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("evaluate rhsRuns watch");
    let rhs_runs_token = watched_rhs_runs
        .set_expression_reference
        .expect("second mutable identifier token");
    let complex = registry
        .with_session(&root_key, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                "count + 1",
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        })
        .expect("session")
        .expect("evaluate complex watch");
    assert_eq!(complex.set_expression_reference, None);

    let assigned_count = registry
        .with_session(&root_key, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: count_token,
                expression: "count".to_string(),
                value: "(++rhsRuns, 40)".to_string(),
            })
        })
        .expect("session")
        .expect("set count expression");
    assert_eq!(assigned_count.set_expression_reference, count_token);
    assert_eq!(assigned_count.expression, "count");
    assert_eq!(assigned_count.value.value, "40");
    assert_eq!(assigned_count.value.set_expression_reference, None);

    let stale_other_token = registry
        .with_session(&root_key, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: rhs_runs_token,
                expression: "rhsRuns".to_string(),
                value: "99".to_string(),
            })
        })
        .expect("session")
        .expect_err("one mutation invalidates every Watch token");
    assert!(stale_other_token.contains("Unknown") || stale_other_token.contains("already-used"));

    for (expression, expected) in [("count", "40"), ("rhsRuns", "1")] {
        let refreshed = registry
            .with_session(&root_key, |adapter| {
                adapter.evaluate_with_policy(
                    frame_id,
                    expression,
                    DebugEvaluatePolicy {
                        context: DebugEvaluateContext::Watch,
                        allow_side_effects: false,
                    },
                )
            })
            .expect("session")
            .expect("refresh Watch value");
        assert_eq!(refreshed.value, expected);
    }

    assert!(registry.stop_by_id(session_id));
    fs::remove_dir_all(root).expect("remove set-variable fixture");
}

#[test]
fn real_node_static_set_expression_mutates_exact_pinned_parents_and_runs_rhs_once() {
    if !node_available() {
        return;
    }
    let (root, script, _marker) = fixture("set-expression-static");
    fs::write(
        &script,
        r#"
let rhsRuns = 0;
const obj = { prop: 1, "a-b": 2, nested: { leaf: 3 } };
const items = [4];
const oldParent = { leaf: 10 };
let lhs = { parent: oldParent };
let getterHits = 0;
let proxyHits = 0;
const getterRoot = { get bad() { getterHits += 1; return { leaf: 1 }; } };
const proxyRoot = new Proxy({ leaf: 1 }, { get(target, key, receiver) { proxyHits += 1; return Reflect.get(target, key, receiver); } });
const holder = {
  0: 5, prop: 6, "a-b": 7, nested: { leaf: 8 },
  run() {
    debugger;
    setInterval(() => rhsRuns + obj.prop + obj["a-b"] + obj.nested.leaf + items[0] + oldParent.leaf + lhs.parent.leaf + this[0] + this.prop + this["a-b"] + this.nested.leaf + getterHits + proxyHits, 1000);
  }
};
holder.run();
"#,
    )
    .expect("write static set-expression fixture");
    let root_key = root.to_string_lossy().into_owned();
    let registry = DebugSessionRegistry::new();
    let permit = registry.begin_start(&root_key).expect("startup permit");
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script.to_string_lossy().into_owned(),
    };
    let adapter_root = root.clone();
    let sink = Arc::new(CollectSink::default());
    let session_id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink.clone(),
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            DebugSessionMode::OwnedLaunch,
            move |emitter| {
                crate::debug_cdp::create_node_cdp_adapter(
                    &adapter_root,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    emitter,
                    Box::new(|_| {}),
                    Arc::new(|| true),
                )
            },
        )
        .expect("attach static set-expression target");
    wait_until(
        Duration::from_secs(5),
        || sink.stopped().is_some(),
        "static set-expression pause",
    );
    let (pause_generation, frame_id) = sink.stopped().expect("stopped owner");

    let evaluate = |expression: &str| {
        registry
            .with_session(&root_key, |adapter| {
                adapter.evaluate_with_policy(
                    frame_id,
                    expression,
                    DebugEvaluatePolicy {
                        context: DebugEvaluateContext::Watch,
                        allow_side_effects: false,
                    },
                )
            })
            .expect("session")
            .expect("watch evaluation")
    };
    let set_static = |expression: &str, value: &str| {
        let watched = evaluate(expression);
        let token = watched
            .set_expression_reference
            .unwrap_or_else(|| panic!("missing static token for {expression}"));
        registry
            .with_session(&root_key, |adapter| {
                adapter.set_expression(DebugSetExpressionRequest {
                    pause_generation,
                    frame_id,
                    set_expression_reference: token,
                    expression: expression.to_string(),
                    value: value.to_string(),
                })
            })
            .expect("session")
            .unwrap_or_else(|error| panic!("set {expression}: {error}"))
    };

    let stale_items = evaluate("items[0]")
        .set_expression_reference
        .expect("items token");
    let assigned = set_static("obj.prop", "(++rhsRuns, 11)");
    assert_eq!(assigned.expression, "obj.prop");
    assert_eq!(assigned.value.name, "obj.prop");
    assert_eq!(assigned.value.value, "11");
    let stale = registry
        .with_session(&root_key, |adapter| {
            adapter.set_expression(DebugSetExpressionRequest {
                pause_generation,
                frame_id,
                set_expression_reference: stale_items,
                expression: "items[0]".to_string(),
                value: "999".to_string(),
            })
        })
        .expect("session")
        .expect_err("other token must be revoked");
    assert!(stale.contains("Unknown") || stale.contains("already-used"));

    for (expression, rhs, expected) in [
        ("items[0]", "(++rhsRuns, 22)", "22"),
        ("obj[\"a-b\"]", "(++rhsRuns, 33)", "33"),
        ("obj.nested.leaf", "(++rhsRuns, 44)", "44"),
    ] {
        let assigned = set_static(expression, rhs);
        assert_eq!(assigned.expression, expression);
        assert_eq!(assigned.value.name, expression);
        assert_eq!(assigned.value.value, expected);
    }
    assert_eq!(evaluate("rhsRuns").value, "4");
    for (expression, expected) in [
        ("obj.prop", "11"),
        ("items[0]", "22"),
        ("obj[\"a-b\"]", "33"),
        ("obj.nested.leaf", "44"),
    ] {
        assert_eq!(evaluate(expression).value, expected, "{expression}");
    }

    for (expression, rhs, expected) in [
        ("this.prop", "(++rhsRuns, 61)", "61"),
        ("this[0]", "(++rhsRuns, 62)", "62"),
        ("this[\"a-b\"]", "(++rhsRuns, 63)", "63"),
        ("this.nested.leaf", "(++rhsRuns, 64)", "64"),
    ] {
        let assigned = set_static(expression, rhs);
        assert_eq!(assigned.expression, expression);
        assert_eq!(assigned.value.name, expression);
        assert_eq!(assigned.value.value, expected);
        assert_eq!(evaluate(expression).value, expected);
    }
    assert_eq!(evaluate("rhsRuns").value, "8");

    let assigned = set_static(
        "lhs.parent.leaf",
        "(++rhsRuns, lhs.parent = { leaf: 99 }, 55)",
    );
    assert_eq!(assigned.value.name, "lhs.parent.leaf");
    assert_eq!(assigned.value.value, "55");
    assert_eq!(evaluate("rhsRuns").value, "9");
    assert_eq!(evaluate("oldParent.leaf").value, "55");
    assert_eq!(evaluate("lhs.parent.leaf").value, "99");

    for expression in ["getterRoot.bad.leaf", "proxyRoot.leaf"] {
        let _ = registry.with_session(&root_key, |adapter| {
            adapter.evaluate_with_policy(
                frame_id,
                expression,
                DebugEvaluatePolicy {
                    context: DebugEvaluateContext::Watch,
                    allow_side_effects: false,
                },
            )
        });
    }
    assert_eq!(evaluate("getterHits").value, "0");
    assert_eq!(evaluate("proxyHits").value, "0");

    assert!(registry.stop_by_id(session_id));
    fs::remove_dir_all(root).expect("remove static set-expression fixture");
}
