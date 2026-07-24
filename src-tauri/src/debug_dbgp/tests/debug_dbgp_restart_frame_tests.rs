use super::*;

#[test]
fn restart_frame_is_explicitly_unsupported_for_xdebug() {
    let root = temp_root("restart-frame-unsupported");
    let session = start_listen_session(&root, Vec::new());
    let error = session
        .registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.restart_frame(1, 1))
        .expect("session")
        .expect_err("restart frame must fail");

    assert_eq!(
        error,
        "Restart frame is not supported by PHP/Xdebug sessions."
    );
}
