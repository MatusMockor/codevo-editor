#[path = "../src/debug_node_child_target_registry.rs"]
mod debug_node_child_target_registry;

use debug_node_child_target_registry::*;
use std::sync::{Arc, Mutex};

struct PanicPayloadWithPanickingDrop;

impl Drop for PanicPayloadWithPanickingDrop {
    fn drop(&mut self) {
        panic!("panic payload was dropped");
    }
}

#[derive(Clone, Default)]
struct RecordingReaper {
    calls: Arc<Mutex<Vec<OwnedNodeProcessGroup>>>,
}

impl OwnedNodeProcessGroupReaper for RecordingReaper {
    fn stop_and_reap(&mut self, group: OwnedNodeProcessGroup) -> Result<(), String> {
        self.calls.lock().expect("calls").push(group);
        Ok(())
    }
}

fn process(pid: u32, parent: u32, start: u64) -> ChildProcessIdentity {
    ChildProcessIdentity::new(pid, parent, 40, start).expect("process")
}

fn observation(
    pid: u32,
    parent: u32,
    start: u64,
    port: u16,
    target: &str,
) -> VerifiedChildInspectorObservation {
    VerifiedChildInspectorObservation::new(
        vec![process(40, 1, 100), process(pid, parent, start)],
        ChildInspectorEndpoint::new(LoopbackInspectorHost::Ipv4, port, target).expect("endpoint"),
    )
    .expect("observation")
}

fn registry() -> (NodeChildTargetRegistry<RecordingReaper>, RecordingReaper) {
    let reaper = RecordingReaper::default();
    (
        NodeChildTargetRegistry::new(7, 40, 40, 100, reaper.clone()).expect("registry"),
        reaper,
    )
}

#[test]
fn reconciliation_is_atomic_and_rejects_ambiguous_or_non_owned_inventory() {
    let (registry, _) = registry();
    let first = registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("first");
    assert_eq!(first.len(), 1);

    assert!(registry
        .reconcile(
            2,
            vec![
                observation(41, 40, 101, 9_230, "target-a"),
                observation(41, 40, 101, 9_231, "target-b"),
            ],
        )
        .is_err());
    let pause = registry
        .begin_pause(&first[0])
        .expect("inventory unchanged");
    registry.resume(&pause).expect("resume");

    let foreign = VerifiedChildInspectorObservation::new(
        vec![
            process(40, 1, 100),
            ChildProcessIdentity::new(42, 40, 99, 102).expect("foreign group process"),
        ],
        ChildInspectorEndpoint::new(LoopbackInspectorHost::Ipv6, 9_232, "target-c")
            .expect("endpoint"),
    )
    .expect("foreign");
    assert!(registry.reconcile(3, vec![foreign]).is_err());
    assert!(registry.reconcile(1, Vec::new()).is_err());
}

#[test]
fn reconciliation_rejects_conflicting_intermediate_process_identity_across_targets() {
    let (registry, _) = registry();
    let endpoint_a = ChildInspectorEndpoint::new(LoopbackInspectorHost::Ipv4, 9_230, "target-a")
        .expect("endpoint a");
    let endpoint_b = ChildInspectorEndpoint::new(LoopbackInspectorHost::Ipv4, 9_231, "target-b")
        .expect("endpoint b");
    let first = VerifiedChildInspectorObservation::new(
        vec![
            process(40, 1, 100),
            process(45, 40, 105),
            process(41, 45, 101),
        ],
        endpoint_a,
    )
    .expect("first observation");
    let conflicting = VerifiedChildInspectorObservation::new(
        vec![
            process(40, 1, 100),
            process(45, 40, 106),
            process(42, 45, 102),
        ],
        endpoint_b,
    )
    .expect("conflicting observation");

    assert!(registry.reconcile(1, vec![first, conflicting]).is_err());
}

#[test]
fn process_and_endpoint_aba_receive_fresh_target_authority() {
    let (registry, _) = registry();
    let original = registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("original")
        .remove(0);
    registry.reconcile(2, Vec::new()).expect("removed");
    let returned = registry
        .reconcile(3, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("returned")
        .remove(0);
    assert_ne!(original, returned);
    assert!(registry.begin_pause(&original).is_err());

    let replacement = registry
        .reconcile(4, vec![observation(41, 40, 102, 9_230, "target-a")])
        .expect("pid reuse")
        .remove(0);
    assert_ne!(returned, replacement);
    assert!(registry.begin_pause(&returned).is_err());
}

#[test]
fn pause_frame_and_variable_authority_isolated_per_target_and_epoch() {
    let (registry, _) = registry();
    let targets = registry
        .reconcile(
            1,
            vec![
                observation(41, 40, 101, 9_230, "target-a"),
                observation(42, 40, 102, 9_231, "target-b"),
            ],
        )
        .expect("targets");
    let pause_a = registry.begin_pause(&targets[0]).expect("pause a");
    let frame_a = registry
        .admit_frame(&pause_a, "same-cdp-frame")
        .expect("frame a");
    let variable_a = registry.admit_variable(&frame_a, 1).expect("variable a");
    let pause_b = registry.begin_pause(&targets[1]).expect("pause b");
    let frame_b = registry
        .admit_frame(&pause_b, "same-cdp-frame")
        .expect("frame b");
    let variable_b = registry.admit_variable(&frame_b, 1).expect("variable b");

    assert_ne!(variable_a, variable_b);
    assert_ne!(
        registry
            .resolve_frame(&frame_a)
            .expect("frame route a")
            .endpoint,
        registry
            .resolve_frame(&frame_b)
            .expect("frame route b")
            .endpoint
    );
    assert_ne!(
        registry
            .resolve_variable(&variable_a)
            .expect("route a")
            .endpoint,
        registry
            .resolve_variable(&variable_b)
            .expect("route b")
            .endpoint
    );
    registry.resume(&pause_a).expect("resume a");
    assert!(registry.resolve_frame(&frame_a).is_none());
    assert!(registry.resolve_variable(&variable_a).is_none());
    assert!(registry.resolve_variable(&variable_b).is_some());
    let next_pause = registry.begin_pause(&targets[0]).expect("next pause");
    assert_ne!(pause_a, next_pause);
    assert!(registry.admit_variable(&frame_a, 2).is_err());
}

#[test]
fn stop_invalidates_all_authority_and_reaps_the_owned_group_exactly_once() {
    let (registry, reaper) = registry();
    let target = registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("target")
        .remove(0);
    let pause = registry.begin_pause(&target).expect("pause");
    let frame = registry.admit_frame(&pause, "frame").expect("frame");
    let variable = registry.admit_variable(&frame, 1).expect("variable");

    registry.stop_and_reap().expect("stop");
    registry.stop_and_reap().expect("idempotent stop");
    assert_eq!(reaper.calls.lock().expect("calls").len(), 1);
    assert_eq!(
        reaper.calls.lock().expect("calls")[0].process_group_id(),
        40
    );
    assert_eq!(reaper.calls.lock().expect("calls")[0].root_pid(), 40);
    assert!(registry.resolve_variable(&variable).is_none());
    assert!(registry.reconcile(2, Vec::new()).is_err());
}

#[test]
fn idempotent_inventory_preserves_generation_but_endpoint_drift_replaces_it() {
    let (registry, _) = registry();
    let original = registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("original")
        .remove(0);
    let same = registry
        .reconcile(2, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("same")
        .remove(0);
    assert_eq!(original, same);
    let drifted = registry
        .reconcile(3, vec![observation(41, 40, 101, 9_231, "target-b")])
        .expect("drifted")
        .remove(0);
    assert_ne!(same, drifted);
    assert!(registry.begin_pause(&same).is_err());
}

#[test]
fn endpoint_socket_target_and_registry_incarnation_ambiguity_fail_closed() {
    let (current_registry, _) = registry();
    assert!(current_registry
        .reconcile(
            1,
            vec![
                observation(41, 40, 101, 9_230, "target-a"),
                observation(42, 40, 102, 9_230, "target-b"),
            ],
        )
        .is_err());
    assert!(current_registry
        .reconcile(
            1,
            vec![
                observation(41, 40, 101, 9_230, "target-a"),
                observation(42, 40, 102, 9_231, "target-a"),
            ],
        )
        .is_err());

    let authority = current_registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("authority")
        .remove(0);
    let (replacement_registry, _) = registry();
    replacement_registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("replacement inventory");
    assert!(replacement_registry.begin_pause(&authority).is_err());
    assert!(
        NodeChildTargetRegistry::new(8, 99, 98, 100, RecordingReaper::default()).is_err(),
        "an owned group must be led by the admitted root process"
    );
}

#[test]
fn stop_fails_inventory_closed_while_reaping_and_concurrent_callers_share_one_result() {
    use std::{sync::mpsc, thread, time::Duration};

    struct BlockingReaper {
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl OwnedNodeProcessGroupReaper for BlockingReaper {
        fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
            self.entered.send(()).expect("entered");
            self.release.recv().expect("release");
            Ok(())
        }
    }

    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let registry = Arc::new(
        NodeChildTargetRegistry::new(
            9,
            40,
            40,
            100,
            BlockingReaper {
                entered: entered_tx,
                release: release_rx,
            },
        )
        .expect("blocking registry"),
    );
    registry
        .reconcile(1, vec![observation(41, 40, 101, 9_230, "target-a")])
        .expect("inventory");
    let stopping = {
        let registry = Arc::clone(&registry);
        thread::spawn(move || registry.stop_and_reap())
    };
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("reaper entered");
    assert!(
        registry.reconcile(2, Vec::new()).is_err(),
        "inventory must fail closed without waiting for the external reaper"
    );
    let concurrent_stop = {
        let registry = Arc::clone(&registry);
        thread::spawn(move || registry.stop_and_reap())
    };
    thread::sleep(Duration::from_millis(25));
    assert!(
        !concurrent_stop.is_finished(),
        "a concurrent stop must wait for and share the exact terminal result"
    );
    release_tx.send(()).expect("release stop");
    stopping.join().expect("stop thread").expect("stop result");
    assert_eq!(concurrent_stop.join().expect("concurrent stop"), Ok(()));

    #[derive(Default)]
    struct FailingReaper(usize);
    impl OwnedNodeProcessGroupReaper for FailingReaper {
        fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
            self.0 += 1;
            Err(format!("reap failed {}", self.0))
        }
    }
    let failed =
        NodeChildTargetRegistry::new(10, 50, 50, 200, FailingReaper::default()).expect("registry");
    assert_eq!(failed.stop_and_reap(), Err("reap failed 1".to_string()));
    assert_eq!(failed.stop_and_reap(), Err("reap failed 1".to_string()));
    assert!(failed.reconcile(1, Vec::new()).is_err());
}

#[test]
fn reaper_can_call_back_into_registry_without_deadlocking() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    type Callback = Box<dyn Fn() + Send + Sync>;
    struct ReentrantReaper {
        callback: Arc<Mutex<Option<Callback>>>,
        calls: Arc<AtomicUsize>,
    }
    impl OwnedNodeProcessGroupReaper for ReentrantReaper {
        fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(callback) = self.callback.lock().expect("callback").as_ref() {
                callback();
            }
            Ok(())
        }
    }

    let callback = Arc::new(Mutex::new(None::<Callback>));
    let calls = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(
        NodeChildTargetRegistry::new(
            11,
            40,
            40,
            100,
            ReentrantReaper {
                callback: Arc::clone(&callback),
                calls: Arc::clone(&calls),
            },
        )
        .expect("registry"),
    );
    let weak = Arc::downgrade(&registry);
    *callback.lock().expect("callback") = Some(Box::new(move || {
        let registry = weak.upgrade().expect("live registry");
        assert!(registry.reconcile(1, Vec::new()).is_err());
        assert!(registry.stop_and_reap().is_err());
    }));

    assert_eq!(registry.stop_and_reap(), Ok(()));
    assert_eq!(registry.stop_and_reap(), Ok(()));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn panicking_reaper_publishes_one_terminal_error_to_concurrent_waiters() {
    use std::{sync::mpsc, thread, time::Duration};

    struct PanickingReaper {
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl OwnedNodeProcessGroupReaper for PanickingReaper {
        fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
            self.entered.send(()).expect("entered");
            self.release.recv().expect("release");
            std::panic::panic_any(PanicPayloadWithPanickingDrop);
        }
    }

    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let registry = Arc::new(
        NodeChildTargetRegistry::new(
            12,
            40,
            40,
            100,
            PanickingReaper {
                entered: entered_tx,
                release: release_rx,
            },
        )
        .expect("registry"),
    );
    let first = {
        let registry = Arc::clone(&registry);
        thread::spawn(move || registry.stop_and_reap())
    };
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("reaper entered");
    let concurrent = {
        let registry = Arc::clone(&registry);
        thread::spawn(move || registry.stop_and_reap())
    };
    thread::sleep(Duration::from_millis(25));
    assert!(!concurrent.is_finished(), "concurrent stop must wait");
    release_tx.send(()).expect("release");

    let expected = Err("Owned Node process-group reaper panicked during stop.".to_string());
    assert_eq!(first.join().expect("first stop"), expected);
    assert_eq!(concurrent.join().expect("concurrent stop"), expected);
    assert_eq!(registry.stop_and_reap(), expected);
}

#[cfg(unix)]
#[test]
fn real_node_fork_is_owned_as_one_logical_session_and_reaped_as_one_group() {
    use serde_json::Value;
    use std::{
        fs,
        io::{BufRead, BufReader},
        os::unix::process::CommandExt,
        process::{Child, Command, Stdio},
        sync::mpsc,
        thread,
        time::Duration,
    };

    struct RealGroupGuard {
        child: Arc<Mutex<Option<Child>>>,
        process_group_id: u32,
    }
    impl Drop for RealGroupGuard {
        fn drop(&mut self) {
            let pgid = self.process_group_id as i32;
            unsafe {
                libc::kill(-pgid, libc::SIGTERM);
                libc::kill(-pgid, libc::SIGKILL);
            }
            if let Some(mut child) = self.child.lock().expect("real child guard").take() {
                let _ = child.wait();
            }
        }
    }

    if Command::new("node").arg("--version").output().is_err() {
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "codevo-child-target-proof-{}-{:?}",
        std::process::id(),
        thread::current().id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("proof root");
    let script = root.join("fork-proof.cjs");
    fs::write(
        &script,
        r#"
const { fork } = require("node:child_process");
const inspector = require("node:inspector");
if (process.env.CODEVO_CHILD === "1") {
  process.send({ pid: process.pid, url: inspector.url() });
  setInterval(() => {}, 1000);
} else {
  const child = fork(__filename, [], {
    env: { ...process.env, CODEVO_CHILD: "1" },
    execArgv: ["--inspect=0"],
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  child.once("message", ({ pid, url }) => {
    process.stdout.write(JSON.stringify({ parent: process.pid, pid, url }) + "\n");
  });
  setInterval(() => {}, 1000);
}
"#,
    )
    .expect("proof script");
    let mut command = Command::new("node");
    command
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    let mut spawned = command.spawn().expect("spawn real Node parent");
    let root_pid = spawned.id();
    let stdout = spawned.stdout.take().expect("parent stdout");
    let child = Arc::new(Mutex::new(Some(spawned)));
    let _group_guard = RealGroupGuard {
        child: Arc::clone(&child),
        process_group_id: root_pid,
    };
    let (line_tx, line_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        let _ = line_tx.send(lines.next().transpose());
    });
    let line = match line_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(Some(line))) => line,
        other => panic!("real Node fork did not publish its inspector: {other:?}"),
    };
    let message: Value = serde_json::from_str(&line).expect("fork message");
    assert_eq!(message["parent"].as_u64(), Some(u64::from(root_pid)));
    let child_pid = message["pid"].as_u64().expect("child pid") as u32;
    let url = message["url"].as_str().expect("child inspector URL");
    let endpoint = url.strip_prefix("ws://127.0.0.1:").expect("loopback URL");
    let (port, target_id) = endpoint.split_once('/').expect("inspector endpoint");
    let process_group_id = unsafe { libc::getpgid(root_pid as i32) };
    assert_eq!(process_group_id, root_pid as i32);
    assert_eq!(unsafe { libc::getpgid(child_pid as i32) }, process_group_id);

    struct RealReaper(Arc<Mutex<Option<Child>>>);
    impl OwnedNodeProcessGroupReaper for RealReaper {
        fn stop_and_reap(&mut self, group: OwnedNodeProcessGroup) -> Result<(), String> {
            let pgid = i32::try_from(group.process_group_id())
                .map_err(|_| "invalid process group".to_string())?;
            unsafe {
                libc::kill(-pgid, libc::SIGTERM);
            }
            thread::sleep(Duration::from_millis(50));
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
            let mut child = self
                .0
                .lock()
                .map_err(|_| "root child owner is unavailable".to_string())?
                .take()
                .ok_or_else(|| "missing root child".to_string())?;
            child.wait().map_err(|error| error.to_string())?;
            Ok(())
        }
    }

    let registry =
        NodeChildTargetRegistry::new(77, root_pid, root_pid, 700, RealReaper(Arc::clone(&child)))
            .expect("real registry");
    let observation = VerifiedChildInspectorObservation::new(
        vec![
            ChildProcessIdentity::new(root_pid, 1, root_pid, 700).expect("root identity"),
            ChildProcessIdentity::new(child_pid, root_pid, root_pid, 701).expect("child identity"),
        ],
        ChildInspectorEndpoint::new(
            LoopbackInspectorHost::Ipv4,
            port.parse().expect("inspector port"),
            target_id,
        )
        .expect("child endpoint"),
    )
    .expect("verified observation");
    let target = registry
        .reconcile(1, vec![observation])
        .expect("real child inventory")
        .remove(0);
    let pause = registry
        .begin_pause(&target)
        .expect("real child pause owner");
    let frame = registry
        .admit_frame(&pause, "real-frame")
        .expect("real frame");
    assert!(registry.admit_variable(&frame, 1).is_ok());
    registry.stop_and_reap().expect("reap real process group");

    let group_is_gone = (0..100).any(|_| {
        let gone = unsafe { libc::kill(-(root_pid as i32), 0) } != 0;
        if !gone {
            thread::sleep(Duration::from_millis(10));
        }
        gone
    });
    assert!(group_is_gone, "owned Node process group survived stop");
    let _ = fs::remove_dir_all(root);
}
