use super::{dispatch_workspace_file_watch_start, validate_workspace_file_watch_stop_root};
use crate::workspace::protected_paths::{
    HomeDirectorySource, ProcessHomeDirectory, WorkspaceRootRefusal,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::ThreadId,
};

#[test]
fn start_dispatches_root_resolution_and_watch_start_off_the_calling_thread() {
    let root = std::env::temp_dir().canonicalize().expect("temp root");
    let observed: Arc<Mutex<Option<(ThreadId, PathBuf)>>> = Arc::new(Mutex::new(None));
    let recorder = Arc::clone(&observed);

    let receipt = tauri::async_runtime::block_on(dispatch_workspace_file_watch_start(
        root.to_string_lossy().into_owned(),
        move |canonical_root| {
            *recorder.lock().expect("observation") =
                Some((std::thread::current().id(), canonical_root));
            Ok(7_u64)
        },
    ));

    let (worker_thread, started_root) = observed
        .lock()
        .expect("observation")
        .clone()
        .expect("watch start ran");
    assert_eq!(receipt, Ok(7));
    assert_ne!(worker_thread, std::thread::current().id());
    assert_eq!(started_root, root);
}

#[test]
fn start_rejects_an_unresolvable_root_without_starting_a_watch() {
    let missing = std::env::temp_dir().join("codevo-missing-watch-root-does-not-exist");
    let started = Arc::new(Mutex::new(false));
    let recorder = Arc::clone(&started);

    let result = tauri::async_runtime::block_on(dispatch_workspace_file_watch_start(
        missing.to_string_lossy().into_owned(),
        move |_| {
            *recorder.lock().expect("start flag") = true;
            Ok(())
        },
    ));

    assert!(result.is_err());
    assert!(!*started.lock().expect("start flag"));
}

#[test]
fn stop_root_validation_rejects_relative_nul_and_oversized_roots() {
    assert!(validate_workspace_file_watch_stop_root("relative/root").is_err());
    assert!(validate_workspace_file_watch_stop_root("/root\0").is_err());
    assert!(validate_workspace_file_watch_stop_root(&format!("/{}", "a".repeat(32_768))).is_err());
    assert!(validate_workspace_file_watch_stop_root("/workspace").is_ok());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn registry_refuses_filesystem_root_and_process_home_as_workspace_roots() {
    let registry = crate::workspace_registry::WorkspaceRegistry::new();
    let home = ProcessHomeDirectory.home_directory().expect("process home");

    let root_error = registry
        .register_with_receipt("/")
        .expect_err("root refused");
    let home_error = registry
        .register_with_receipt(&home)
        .expect_err("home refused");

    assert_eq!(root_error.kind(), std::io::ErrorKind::InvalidInput);
    assert_eq!(
        root_error.to_string(),
        WorkspaceRootRefusal::FilesystemRoot.to_string()
    );
    assert_eq!(
        home_error.to_string(),
        WorkspaceRootRefusal::Home.to_string()
    );
}

#[test]
fn workspace_root_canonicalization_refuses_filesystem_root_and_process_home() {
    let home = ProcessHomeDirectory.home_directory().expect("process home");

    assert_eq!(
        crate::canonicalize_workspace_root("/"),
        Err(WorkspaceRootRefusal::FilesystemRoot.to_string())
    );
    assert_eq!(
        crate::canonicalize_workspace_root(&home.to_string_lossy()),
        Err(WorkspaceRootRefusal::Home.to_string())
    );
    let project = std::env::temp_dir().canonicalize().expect("temp root");
    assert_eq!(
        crate::canonicalize_workspace_root(&project.to_string_lossy()),
        Ok(project)
    );
}

#[cfg(target_os = "macos")]
#[test]
fn workspace_root_canonicalization_refuses_the_data_volume_alias_of_home() {
    let home = ProcessHomeDirectory
        .home_directory()
        .expect("process home")
        .canonicalize()
        .expect("canonical home");
    let aliased_home = std::path::Path::new("/System/Volumes/Data")
        .join(home.strip_prefix("/").expect("absolute home"));
    if !aliased_home.is_dir() {
        return;
    }

    assert_eq!(
        crate::canonicalize_workspace_root(&aliased_home.to_string_lossy()),
        Err(WorkspaceRootRefusal::Home.to_string())
    );
}
