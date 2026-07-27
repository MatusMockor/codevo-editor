use crate::debug_adapter::{
    DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode, DebugLaunchTarget,
    DebugVariableFilter, DebugVariablePageRequest,
};
use crate::debug_commands::stop_debug_session_blocking;
use crate::debug_session_registry::DebugSessionRegistry;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const FIXTURE_CREATE_ATTEMPTS: usize = 64;
const MARKER_TIMEOUT: Duration = Duration::from_secs(10);
static NEXT_WORKSPACE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct CapturingSink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for CapturingSink {
    fn emit(&self, event: DebugEvent) {
        lock_recover(&self.0).push(event);
    }
}

struct TempWorkspace(PathBuf);

impl TempWorkspace {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("fixture clock")
            .as_nanos();
        for _ in 0..FIXTURE_CREATE_ATTEMPTS {
            let sequence = NEXT_WORKSPACE_ID.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "codevo-node-stop-reap-proof-{}-{nonce:x}-{sequence:x}",
                std::process::id()
            ));
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            match builder.create(&root) {
                Ok(()) => {
                    let metadata = fs::symlink_metadata(&root).expect("inspect private workspace");
                    assert!(metadata.is_dir());
                    assert_eq!(metadata.mode() & 0o777, 0o700);
                    assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
                    return Self(root);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create private Stop proof workspace: {error}"),
            }
        }
        panic!("unable to allocate a private Stop proof workspace");
    }

    fn create_file(&self, name: &str, contents: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(&path)
            .expect("create private Stop proof file");
        file.write_all(contents).expect("write Stop proof file");
        file.sync_all().expect("sync Stop proof file");
        path
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(serde::Deserialize)]
struct ProcessMarker {
    root: u32,
    grandchild: u32,
}

#[test]
fn ordinary_node_stop_returns_only_after_root_and_grandchild_are_gone() {
    let _admission = super::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real Node Stop/reap proof requires the managed Node.js runtime in CI");
        }
        eprintln!("skipping real Node Stop/reap proof: no managed Node.js runtime is available");
        return;
    }

    let workspace = TempWorkspace::new();
    let marker_path = workspace.0.join("processes.json");
    let marker_literal =
        serde_json::to_string(&marker_path.to_string_lossy()).expect("encode private marker path");
    let script = format!(
        r#"
const fs = require("fs");
const {{ spawn }} = require("child_process");
process.on("SIGTERM", () => {{}});
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {{}}); setInterval(() => {{}}, 1000);"], {{
  stdio: "ignore"
}});
fs.writeFileSync({marker_literal}, JSON.stringify({{ root: process.pid, grandchild: grandchild.pid }}));
setInterval(() => {{}}, 1000);
"#
    );
    let script_path = workspace.create_file("server.js", script.as_bytes());
    let script_path = script_path
        .canonicalize()
        .expect("canonical Stop proof target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script_path.to_string_lossy().into_owned(),
    };
    let startup_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
                    &workspace.0,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    startup_current,
                )
            },
        )
        .expect("start ordinary Node debug session");
    let marker = wait_for_marker(&marker_path);
    assert_eq!(
        process_group(marker.root),
        i32::try_from(marker.root).expect("root PID")
    );
    assert_eq!(
        process_group(marker.grandchild),
        i32::try_from(marker.root).expect("root process group")
    );

    let started = Instant::now();
    stop_debug_session_blocking(&registry, session_id).expect("Stop ordinary Node session");

    assert!(
        started.elapsed() >= Duration::from_millis(450),
        "Stop acknowledged before the TERM grace and KILL fallback settled"
    );
    assert!(
        !process_is_running(marker.root),
        "Node debug root survived successful Stop"
    );
    assert!(
        !process_is_running(marker.grandchild),
        "Node debug grandchild survived successful Stop"
    );
    assert_eq!(
        lock_recover(&sink.0)
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
            .count(),
        1,
        "Stop must publish one terminal event"
    );
}

#[test]
fn ordinary_node_debugger_pause_stays_live_without_an_explicit_stop() {
    let _admission = super::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real Node pause-liveness proof requires the managed Node.js runtime in CI");
        }
        eprintln!(
            "skipping real Node pause-liveness proof: no managed Node.js runtime is available"
        );
        return;
    }

    let workspace = TempWorkspace::new();
    let script_path = workspace.create_file(
        "paused.js",
        br#"
function run() {
  const localLarge = Array.from({ length: 10_050 }, (_, i) => ({ i }));
  debugger;
  return localLarge.length;
}
run();
setInterval(() => {}, 1000);
"#,
    );
    let script_path = script_path
        .canonicalize()
        .expect("canonical pause-liveness target");
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script_path.to_string_lossy().into_owned(),
    };
    let startup_current: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| true);
    let session_id = registry
        .start_session(
            &root_key,
            Arc::clone(&sink) as Arc<dyn DebugEventSink>,
            |emitter| {
                crate::debug_cdp::create_node_cdp_adapter_with_exception_filter(
                    &workspace.0,
                    &launch,
                    &[],
                    DebugExceptionPauseMode::None,
                    &[],
                    true,
                    false,
                    emitter,
                    Box::new(|_| {}),
                    startup_current,
                )
            },
        )
        .expect("start paused ordinary Node debug session");

    let (pause_generation, frame_id, large_reference) =
        paused_large_array_owner(&registry, &root_key, &sink);
    let large_page = registry
        .with_session(&root_key, |adapter| {
            adapter.variables_page_filtered(
                DebugVariablePageRequest {
                    pause_generation,
                    frame_id,
                    variables_reference: large_reference,
                    start: 0,
                    count: 100,
                },
                DebugVariableFilter::Indexed,
            )
        })
        .expect("live paused session")
        .expect("large local variables");
    assert_eq!(large_page.variables.len(), 100);
    thread::sleep(Duration::from_secs(3));

    assert!(
        registry.owns_session(&root_key, session_id),
        "a visible debugger pause must not retire its session without Stop"
    );
    assert!(
        !lock_recover(&sink.0)
            .iter()
            .any(|event| matches!(event.payload, DebugEventPayload::Terminated { .. })),
        "a visible debugger pause must not emit Terminated without Stop"
    );

    stop_debug_session_blocking(&registry, session_id).expect("Stop paused ordinary Node session");
}

fn paused_large_array_owner(
    registry: &DebugSessionRegistry,
    root_key: &str,
    sink: &CapturingSink,
) -> (u64, u64, u64) {
    wait_for_event(sink, |payload| {
        matches!(payload, DebugEventPayload::Stopped { .. })
    });
    let (pause_generation, frame_id) = lock_recover(&sink.0)
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
        .expect("paused frame owner");
    let scopes = registry
        .with_session(root_key, |adapter| adapter.scopes(frame_id))
        .expect("live paused session")
        .expect("paused scopes");
    let local_scope = scopes.first().expect("local scope");
    let locals = registry
        .with_session(root_key, |adapter| {
            adapter.variables_page(DebugVariablePageRequest {
                pause_generation,
                frame_id,
                variables_reference: local_scope.variables_reference,
                start: 0,
                count: 100,
            })
        })
        .expect("live paused session")
        .expect("local variables");
    let large_reference = locals
        .variables
        .iter()
        .find(|variable| variable.name == "localLarge")
        .map(|variable| variable.variables_reference)
        .filter(|reference| *reference > 0)
        .expect("large local array reference");
    (pause_generation, frame_id, large_reference)
}

fn wait_for_event(sink: &CapturingSink, predicate: impl Fn(&DebugEventPayload) -> bool) {
    let deadline = Instant::now() + MARKER_TIMEOUT;
    loop {
        if lock_recover(&sink.0)
            .iter()
            .any(|event| predicate(&event.payload))
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the debugger event"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn wait_for_marker(path: &Path) -> ProcessMarker {
    let deadline = Instant::now() + MARKER_TIMEOUT;
    loop {
        if let Ok(contents) = fs::read(path) {
            if let Ok(marker) = serde_json::from_slice(&contents) {
                return marker;
            }
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the Node root/grandchild marker"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn process_group(process_id: u32) -> i32 {
    let process_id = i32::try_from(process_id).expect("process id");
    unsafe { libc::getpgid(process_id) }
}

fn process_is_running(process_id: u32) -> bool {
    let output = Command::new("/bin/ps")
        .args(["-o", "state=", "-p", &process_id.to_string()])
        .output()
        .expect("inspect process");
    let state = String::from_utf8_lossy(&output.stdout);
    let state = state.trim();
    !state.is_empty() && !state.starts_with('Z')
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
