use super::*;
use crate::debug_session_registry::retained_workspace_authority;

#[test]
fn disconnect_rejects_hostile_roots_before_workspace_authority_lookup() {
    let registry = WorkspaceRegistry::new();
    for (root_path, expected) in [
        (
            "x".repeat(MAX_DEBUG_EVALUATE_ROOT_BYTES + 1),
            "must contain",
        ),
        ("/workspace\nother".to_string(), "forbidden control"),
    ] {
        let error = validated_disconnect_authority(
            &registry,
            &DebugDisconnectRequest {
                root_path,
                session_id: 7,
            },
        )
        .expect_err("invalid root must fail before registry lookup");
        assert!(
            error.contains(expected),
            "unexpected validation error: {error}"
        );
        assert!(!error.contains("not registered"));
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn retained_disconnect_authority_survives_path_loss_but_rejects_alias_reownership() {
    use std::os::unix::fs::symlink;

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-debug-authority-{}-{nonce}",
        std::process::id()
    ));
    let original = fixture.join("original");
    let renamed = fixture.join("renamed");
    let replacement = fixture.join("replacement");
    let alias = fixture.join("workspace");
    std::fs::create_dir_all(&original).expect("create original workspace");
    std::fs::create_dir_all(&replacement).expect("create replacement workspace");
    symlink(&original, &alias).expect("create workspace alias");
    let registry = WorkspaceRegistry::new();
    registry
        .register(&alias)
        .expect("register original workspace");
    let original_authority =
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("original retained authority");

    std::fs::remove_file(&alias).expect("remove workspace alias");
    std::fs::rename(&original, &renamed).expect("rename original workspace");
    assert_eq!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("authority after root loss"),
        original_authority
    );

    symlink(&replacement, &alias).expect("retarget workspace alias");
    assert_eq!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("retained authority after retarget"),
        original_authority
    );
    registry
        .register(&alias)
        .expect("register replacement workspace identity");
    assert_ne!(
        retained_workspace_authority(&registry, alias.to_str().expect("UTF-8 alias"))
            .expect("replacement authority"),
        original_authority
    );

    registry.clear();
    std::fs::remove_file(alias).expect("remove retargeted alias");
    std::fs::remove_dir_all(fixture).expect("remove authority fixture");
}
