use super::*;
use std::{
    fs,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static PROCESS_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn workspace(value: &str) -> WorkspaceId {
    serde_json::from_value(serde_json::json!(value)).unwrap()
}

fn owner(watch_id: &str) -> JsTestWatchOwner {
    JsTestWatchOwner {
        watch_id: watch_id.to_string(),
        workspace_id: workspace("workspace-a"),
        epoch: 1,
    }
}

fn process_group() -> (SpawnedWatch, TerminalTaskOwnership, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "editor-js-test-watch-lifecycle-{}-{}",
        std::process::id(),
        PROCESS_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).expect("create process fixture");
    let ready = root.join("ready");
    let mut command = Command::new("/bin/sh");
    command
        .args([
            "-c",
            &format!(
                "sleep 30 & child=$!; touch '{}'; wait $child",
                ready.display()
            ),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.process_group(0);
    let child = command.spawn().unwrap();
    let ownership = TerminalTaskOwnership::new(1, 0, i32::try_from(child.id()).unwrap());
    (
        SpawnedWatch {
            child,
            ownership: ownership.clone(),
            reaped: false,
            stdout: Some(thread::spawn(|| {})),
            stderr: Some(thread::spawn(|| {})),
        },
        ownership,
        root,
        ready,
    )
}

fn wait_until_ready(ready: &Path) {
    let watchdog = Instant::now();
    while !ready.is_file() {
        assert!(watchdog.elapsed() < Duration::from_secs(10));
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn trust_revocation_stop_fully_reaps_watch_process_group() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("trust-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership, root, ready) = process_group();
    wait_until_ready(&ready);
    registry.activate(&owner, ownership.clone()).unwrap();
    registry.request_stop_workspace(&owner.workspace_id);
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
    fs::remove_dir_all(root).expect("cleanup process fixture");
}

#[test]
fn disconnect_stop_all_fully_reaps_watch_process_group() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("disconnect-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership, root, ready) = process_group();
    wait_until_ready(&ready);
    registry.activate(&owner, ownership.clone()).unwrap();
    registry.request_stop_all();
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
    fs::remove_dir_all(root).expect("cleanup process fixture");
}

#[test]
fn registry_drop_stops_and_allows_full_process_group_reap() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("drop-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership, root, ready) = process_group();
    wait_until_ready(&ready);
    registry.activate(&owner, ownership.clone()).unwrap();
    drop(registry);
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
    fs::remove_dir_all(root).expect("cleanup process fixture");
}

#[test]
fn spawned_watch_drop_fully_reaps_process_group() {
    let (spawned, ownership, root, ready) = process_group();
    wait_until_ready(&ready);
    drop(spawned);
    assert!(ownership.was_stop_requested());
    assert!(ownership.active_process_group_id().is_none());
    fs::remove_dir_all(root).expect("cleanup process fixture");
}

#[test]
fn timeout_fully_reaps_process_group() {
    let (spawned, ownership, root, ready) = process_group();
    wait_until_ready(&ready);
    let trigger = crate::js_test_run::JsTestTimeoutTrigger::new();
    trigger.expire();
    assert!(matches!(
        finish_watch_with_timeout_trigger(spawned, Duration::from_secs(8 * 60 * 60), trigger),
        JsTestWatchStatus::Failed { .. }
    ));
    assert!(ownership.active_process_group_id().is_none());
    fs::remove_dir_all(root).expect("cleanup process fixture");
}
