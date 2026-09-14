use super::send_unix_process_group_signal_with;

#[test]
fn esrch_is_an_empty_group_success_without_a_probe() {
    let result = send_unix_process_group_signal_with(
        41,
        libc::SIGKILL,
        |_, _| Err(libc::ESRCH),
        |_| panic!("ESRCH must not probe membership"),
        false,
    );
    assert_eq!(result, Ok(()));
}

#[test]
fn macos_eperm_is_success_only_after_positive_zombie_only_proof() {
    let result = send_unix_process_group_signal_with(
        42,
        libc::SIGKILL,
        |_, _| Err(libc::EPERM),
        |group| group == 42,
        true,
    );
    assert_eq!(result, Ok(()));
}

#[test]
fn substantive_eperm_is_never_cleanup_success() {
    for (is_macos, zombie_only) in [(false, true), (true, false)] {
        let result = send_unix_process_group_signal_with(
            43,
            libc::SIGKILL,
            |_, _| Err(libc::EPERM),
            |_| zombie_only,
            is_macos,
        );
        assert!(result
            .expect_err("substantive EPERM must fail closed")
            .contains("Operation not permitted"));
    }
}

#[test]
fn live_leader_only_eperm_cannot_use_the_post_observation_exception() {
    let result = send_unix_process_group_signal_with(
        44,
        libc::SIGKILL,
        |_, _| Err(libc::EPERM),
        |_| true,
        false,
    );
    assert!(result
        .expect_err("a live leader must fail closed even if it is the only group member")
        .contains("Operation not permitted"));
}
