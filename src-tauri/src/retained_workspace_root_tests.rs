use super::retain_workspace_root;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::fs;
use std::sync::{Arc, Barrier};

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn retained_root_survives_rename_and_replacement_before_blocking_work() {
    use std::os::unix::fs::symlink;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-retained-root-authority-{}-{nonce}",
        std::process::id()
    ));
    let original = fixture.join("original");
    let renamed = fixture.join("renamed-a");
    let replacement = fixture.join("replacement-b");
    let alias = fixture.join("workspace");
    let trust_file = fixture.join("trust.json");
    fs::create_dir_all(&original).expect("create original workspace");
    fs::create_dir_all(&replacement).expect("create replacement workspace");
    fs::write(original.join("target.js"), "A").expect("write A target");
    fs::write(replacement.join("target.js"), "B").expect("write B target");
    symlink(&original, &alias).expect("create selected-root alias");
    let canonical_original = original.canonicalize().expect("canonical original");

    let registry = WorkspaceRegistry::new();
    registry.register(&alias).expect("register A");
    let retained = Arc::new(
        retain_workspace_root(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("retain A root"),
    );
    let canonical_root = retained.authority.canonical_root.clone();
    assert_eq!(canonical_root, canonical_original.to_string_lossy());
    let mut trust = WorkspaceTrustService::load(trust_file).expect("load trust fixture");
    trust
        .set(&canonical_root, true)
        .expect("trust A identity key");

    let barrier = Arc::new(Barrier::new(2));
    let worker_barrier = Arc::clone(&barrier);
    let worker_root = Arc::clone(&retained);
    let worker = std::thread::spawn(move || {
        worker_barrier.wait();
        worker_root.live_path().expect("derive retained live path")
    });

    fs::rename(&original, &renamed).expect("rename A after authority capture");
    fs::rename(&replacement, &original).expect("replace A path with B");
    let canonical_renamed = renamed.canonicalize().expect("canonical renamed A");
    barrier.wait();
    let live_root = worker.join().expect("blocking worker");

    assert_eq!(live_root, canonical_renamed);
    assert_eq!(
        fs::read_to_string(live_root.join("target.js")).expect("read retained target"),
        "A"
    );
    assert_eq!(fs::read_to_string(original.join("target.js")).unwrap(), "B");
    assert!(
        trust.get(&canonical_root).trusted,
        "trust stays keyed to captured A authority"
    );

    drop(retained);
    registry.clear();
    fs::remove_dir_all(fixture).expect("remove authority fixture");
}

#[test]
fn unregistered_root_is_rejected() {
    let registry = WorkspaceRegistry::new();

    let error = retain_workspace_root(&registry, "/codevo-unregistered-workspace-root")
        .expect_err("unregistered root must be rejected");

    assert_eq!(
        error,
        "Workspace is not registered or its identity changed."
    );
}
