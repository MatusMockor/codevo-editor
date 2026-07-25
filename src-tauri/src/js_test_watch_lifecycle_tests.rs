use super::*;
use std::os::unix::process::CommandExt;

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

fn process_group() -> (SpawnedWatch, TerminalTaskOwnership) {
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", "sleep 30 & wait"])
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
    )
}

#[test]
fn trust_revocation_stop_fully_reaps_watch_process_group() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("trust-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership) = process_group();
    registry.activate(&owner, ownership.clone()).unwrap();
    registry.request_stop_workspace(&owner.workspace_id);
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
}

#[test]
fn disconnect_stop_all_fully_reaps_watch_process_group() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("disconnect-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership) = process_group();
    registry.activate(&owner, ownership.clone()).unwrap();
    registry.request_stop_all();
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
}

#[test]
fn registry_drop_stops_and_allows_full_process_group_reap() {
    let registry = JsTestWatchRegistry::new();
    let owner = owner("drop-watch");
    registry.reserve(owner.clone()).unwrap();
    let (spawned, ownership) = process_group();
    registry.activate(&owner, ownership.clone()).unwrap();
    drop(registry);
    assert!(ownership.was_stop_requested());
    assert!(matches!(finish_watch(spawned), JsTestWatchStatus::Stopped));
    assert!(ownership.active_process_group_id().is_none());
}

#[test]
fn spawned_watch_drop_fully_reaps_process_group() {
    let (spawned, ownership) = process_group();
    drop(spawned);
    assert!(ownership.was_stop_requested());
    assert!(ownership.active_process_group_id().is_none());
}

#[test]
fn timeout_fully_reaps_process_group() {
    let (spawned, ownership) = process_group();
    assert!(matches!(
        finish_watch_with_timeout(spawned, Duration::from_millis(1)),
        JsTestWatchStatus::Failed { .. }
    ));
    assert!(ownership.active_process_group_id().is_none());
}
