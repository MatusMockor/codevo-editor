use super::*;

#[test]
fn notify_breakpoint_resolved_marks_breakpoints_verified() {
    let file = breakpoint_fixture_file("notify-resolved");
    let file_path = file.to_string_lossy().to_string();
    let session = start_listen_session(
        file.parent().expect("fixture parent"),
        vec![breakpoint(&file_path, "bp-1", 12, None, true)],
    );
    let client = MockXdebugClient::connect(
        session.port,
        scripted_responder(|command| {
            (command.name == "breakpoint_set").then(|| {
                vec![breakpoint_set_response(
                    command.transaction_id,
                    "dbgp-77",
                    false,
                )]
            })
        }),
    );
    wait_for_command(&client, "run");
    let initial = wait_for(
        || verified_events(&session.sink).into_iter().next(),
        EVENT_WAIT_TIMEOUT,
        "initial breakpoints verified event",
    );
    assert!(!initial.1[0].verified);

    client.inject(&notify_resolved_xml("dbgp-77", 14));

    let resolved = wait_for(
        || verified_events(&session.sink).into_iter().nth(1),
        EVENT_WAIT_TIMEOUT,
        "resolved breakpoints verified event",
    );
    assert_eq!(resolved.0, file_path);
    assert!(resolved.1[0].verified);
    assert_eq!(resolved.1[0].line_number, 14);
}
