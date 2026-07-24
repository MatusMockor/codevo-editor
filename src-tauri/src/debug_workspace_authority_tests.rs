use super::{retain_workspace_root, DebugWorkspaceAuthority};
use crate::debug_adapter::DebugLaunchTarget;
use crate::debug_node_launch::{build_launch_plan, NodeLaunchProgram};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Barrier};

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn retained_start_root_survives_rename_and_replacement_before_blocking_launch() {
    use std::os::unix::fs::symlink;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-debug-start-authority-{}-{nonce}",
        std::process::id()
    ));
    let original = fixture.join("original");
    let renamed = fixture.join("renamed-a");
    let replacement = fixture.join("replacement-b");
    let alias = fixture.join("workspace");
    let trust_file = fixture.join("trust.json");
    fs::create_dir_all(original.join("cwd")).expect("create original workspace");
    fs::create_dir_all(replacement.join("cwd")).expect("create replacement workspace");
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
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        panic!("production authority must be retained");
    };
    assert_eq!(canonical_root, &canonical_original.to_string_lossy());
    let mut trust = WorkspaceTrustService::load(trust_file).expect("load trust fixture");
    trust
        .set(canonical_root, true)
        .expect("trust A identity key");

    let barrier = Arc::new(Barrier::new(2));
    let worker_barrier = Arc::clone(&barrier);
    let worker_root = Arc::clone(&retained);
    let worker = std::thread::spawn(move || {
        worker_barrier.wait();
        let live_root = worker_root.live_path().expect("derive retained live path");
        let target = DebugLaunchTarget::NodeConfiguredScript {
            script_path: "target.js".to_string(),
            args: Vec::new(),
            cwd: Some(live_root.join("cwd").to_string_lossy().into_owned()),
            env: HashMap::new(),
            just_my_code: None,
        };
        let plan = build_launch_plan(&live_root, &target).expect("build retained launch plan");
        (live_root, plan)
    });

    fs::rename(&original, &renamed).expect("rename A after authority capture");
    fs::rename(&replacement, &original).expect("replace A path with B");
    let canonical_renamed = renamed.canonicalize().expect("canonical renamed A");
    barrier.wait();
    let (live_root, plan) = worker.join().expect("blocking launch worker");

    assert_eq!(live_root, canonical_renamed);
    assert_eq!(plan.working_directory, canonical_renamed.join("cwd"));
    assert!(matches!(plan.program, NodeLaunchProgram::Node));
    let launched = plan
        .arguments
        .iter()
        .find(|argument| argument.ends_with("target.js"));
    assert_eq!(
        launched.map(String::as_str),
        canonical_renamed.join("target.js").to_str()
    );
    assert_eq!(
        fs::read_to_string(launched.expect("launched target")).expect("read retained target"),
        "A"
    );
    assert_eq!(fs::read_to_string(original.join("target.js")).unwrap(), "B");
    assert!(
        trust.get(canonical_root).trusted,
        "trust stays keyed to captured A authority"
    );

    let outside_link = canonical_renamed.join("outside");
    symlink(&original, &outside_link).expect("create B escape link");
    let escaped = DebugLaunchTarget::NodeConfiguredScript {
        script_path: "outside/target.js".to_string(),
        args: Vec::new(),
        cwd: None,
        env: HashMap::new(),
        just_my_code: None,
    };
    assert!(build_launch_plan(&live_root, &escaped).is_err());

    drop(retained);
    registry.clear();
    fs::remove_dir_all(fixture).expect("remove authority fixture");
}
