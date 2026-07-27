use crate::debug_adapter::{
    DebugEvent, DebugEventPayload, DebugEventSink, DebugExceptionPauseMode, DebugLaunchTarget,
    DebugOutputStream, DebugStopReason, StepKind,
};
use crate::debug_session_registry::DebugSessionRegistry;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const EVENT_TIMEOUT: Duration = Duration::from_secs(10);
const FIXTURE_CREATE_ATTEMPTS: usize = 64;
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
                "codevo-stop-on-entry-proof-{}-{nonce:x}-{sequence:x}",
                std::process::id()
            ));
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            match builder.create(&root) {
                Ok(()) => {
                    let metadata = fs::symlink_metadata(&root).expect("inspect private workspace");
                    assert!(metadata.is_dir(), "fixture root must be a directory");
                    assert_eq!(metadata.mode() & 0o777, 0o700);
                    assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
                    return Self(root);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create private stop-on-entry workspace: {error}"),
            }
        }
        panic!("unable to allocate a unique private stop-on-entry workspace");
    }

    fn create_script(&self, name: &str, contents: &[u8]) -> std::io::Result<PathBuf> {
        let path = self.0.join(name);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(&path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        Ok(path)
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn stop_on_entry_fixture_is_private_and_never_overwrites_a_target() {
    let workspace = TempWorkspace::new();
    let script = workspace
        .create_script("entry.js", b"first")
        .expect("create private target");
    let root_metadata = fs::symlink_metadata(&workspace.0).expect("private root metadata");
    let script_metadata = fs::symlink_metadata(&script).expect("private target metadata");
    assert_eq!(root_metadata.mode() & 0o777, 0o700);
    assert_eq!(script_metadata.mode() & 0o777, 0o600);
    assert_eq!(
        workspace
            .create_script("entry.js", b"replacement")
            .expect_err("create_new must reject an existing target")
            .kind(),
        std::io::ErrorKind::AlreadyExists
    );
    assert_eq!(fs::read(&script).expect("retained target"), b"first");
}

#[test]
fn real_node_stop_on_entry_pauses_first_user_line_before_user_output() {
    let _admission = super::real_node_test_admission::acquire();
    if node_executable_path().is_none() {
        if std::env::var_os("CI").is_some() {
            panic!("real stopOnEntry proof requires the managed Node.js runtime in CI");
        }
        eprintln!("skipping real stopOnEntry proof: no managed Node.js runtime is available");
        return;
    }

    let workspace = TempWorkspace::new();
    let script = workspace
        .create_script(
            "entry.js",
            b"console.log('STOP_ON_ENTRY_USER_OUTPUT');\nsetInterval(() => {}, 1000);\n",
        )
        .expect("create real stop-on-entry target");
    let script = script.canonicalize().expect("canonical target");
    let script_path = script.to_string_lossy().into_owned();
    let root_key = workspace.0.to_string_lossy().into_owned();
    let sink = Arc::new(CapturingSink::default());
    let registry = DebugSessionRegistry::new();
    registry.activate_root(&root_key);
    let launch = DebugLaunchTarget::NodeScript {
        script_path: script_path.clone(),
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
                    true,
                    emitter,
                    Box::new(|_| {}),
                    startup_current,
                )
            },
        )
        .expect("start real stop-on-entry session");

    let stopped_index = wait_for_event(&sink, |event| {
        matches!(
            event.payload,
            DebugEventPayload::Stopped {
                reason: DebugStopReason::Entry,
                ..
            }
        )
    });
    let events = lock_recover(&sink.0);
    assert!(
        events[..=stopped_index].iter().all(|event| !matches!(
            &event.payload,
            DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text,
                ..
            } if text.contains("STOP_ON_ENTRY_USER_OUTPUT")
        )),
        "user output escaped before the entry pause: {events:?}"
    );
    let DebugEventPayload::Stopped { frames, .. } = &events[stopped_index].payload else {
        unreachable!("waited for entry pause")
    };
    let first = frames.first().expect("entry pause call frame");
    assert_eq!(
        first.line_number, 1,
        "stopOnEntry must pause at the first user line: {frames:?}"
    );
    drop(events);

    registry
        .with_session(&root_key, |adapter| adapter.step(StepKind::Continue))
        .expect("registered stop-on-entry session")
        .expect("continue from entry");
    wait_for_event(&sink, |event| {
        matches!(
            &event.payload,
            DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text,
                ..
            } if text.contains("STOP_ON_ENTRY_USER_OUTPUT")
        )
    });
    assert!(registry.stop_by_id(session_id));
}

fn wait_for_event(sink: &CapturingSink, predicate: impl Fn(&DebugEvent) -> bool) -> usize {
    let deadline = Instant::now() + EVENT_TIMEOUT;
    loop {
        if let Some(index) = lock_recover(&sink.0).iter().position(&predicate) {
            return index;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for real stop-on-entry event: {:?}",
            lock_recover(&sink.0).as_slice()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
