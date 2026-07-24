use super::*;
use crate::debug_hit_condition::DebugHitCondition;
use serde_json::json;

#[test]
fn first_pause_hitting_an_unknown_user_breakpoint_stops_conservatively() {
    let mut paused_params = breakpoint_paused_params();
    paused_params["hitBreakpoints"] = json!(["cdp-bp-1"]);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused_params.clone())]
        }
        _ => vec![ok(id)],
    }));

    let (_registry, sink) = start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
    let (reason, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert_eq!(frames.len(), 3);
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
}

#[test]
fn hit_condition_composes_with_cdp_condition_and_stops_on_the_nth_hit() {
    let mut paused_params = breakpoint_paused_params();
    paused_params["hitBreakpoints"] = json!(["cdp-hit"]);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-hit", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused_params.clone())]
        }
        "Debugger.resume" => vec![
            ok(id),
            event("Debugger.resumed", json!({})),
            event("Debugger.paused", paused_params.clone()),
        ],
        _ => vec![ok(id)],
    }));
    let file = breakpoint_fixture_file("hit-condition-third");
    let mut configured = breakpoint(
        &file.to_string_lossy(),
        "logical-hit",
        1,
        Some("x > 0"),
        true,
    );
    configured.hit_condition = Some(DebugHitCondition::Equals { count: 3 });

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    let (reason, _) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| method == "Debugger.resume")
            .count(),
        2
    );
    assert_eq!(
        server.params_for("Debugger.setBreakpointByUrl")[0]["condition"],
        json!("x > 0")
    );
    assert!(server.params_for("Debugger.setBreakpointByUrl")[0]
        .get("hitCondition")
        .is_none());
    assert!(!sink
        .payloads()
        .iter()
        .any(|payload| matches!(payload, DebugEventPayload::Resumed)));
}

#[test]
fn failed_internal_hit_resume_surfaces_the_real_pause() {
    let mut paused_params = breakpoint_paused_params();
    paused_params["hitBreakpoints"] = json!(["cdp-hit"]);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-hit", "locations":[]}),
        )],
        "Runtime.runIfWaitingForDebugger" => {
            vec![ok(id), event("Debugger.paused", paused_params.clone())]
        }
        "Debugger.resume" => vec![error_reply(id, "resume rejected")],
        _ => vec![ok(id)],
    }));
    let file = breakpoint_fixture_file("hit-resume-failure");
    let mut configured = breakpoint(&file.to_string_lossy(), "logical-hit", 1, None, true);
    configured.hit_condition = Some(DebugHitCondition::Equals { count: 2 });

    let (_registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);
    let (reason, frames) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(!frames.is_empty());
    assert_eq!(
        server
            .methods()
            .into_iter()
            .filter(|method| method == "Debugger.resume")
            .count(),
        1
    );
}

#[test]
fn explicit_user_pause_wins_a_simultaneous_filtered_hit() {
    let mut paused_params = breakpoint_paused_params();
    paused_params["hitBreakpoints"] = json!(["cdp-hit"]);
    let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
        "Debugger.setBreakpointByUrl" => vec![result(
            id,
            json!({"breakpointId":"cdp-hit", "locations":[]}),
        )],
        "Debugger.pause" => vec![ok(id), event("Debugger.paused", paused_params.clone())],
        _ => vec![ok(id)],
    }));
    let file = breakpoint_fixture_file("explicit-pause-hit");
    let mut configured = breakpoint(&file.to_string_lossy(), "logical-hit", 1, None, true);
    configured.hit_condition = Some(DebugHitCondition::GreaterOrEqual { count: 10 });
    let (registry, sink) =
        start_session_with_mock(&server.url, vec![configured], MOCK_REQUEST_TIMEOUT);

    registry
        .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
        .expect("session")
        .expect("explicit pause");
    let (reason, _) = wait_for_stopped(&sink, 0);

    assert_eq!(reason, DebugStopReason::Breakpoint);
    assert!(!server.methods().contains(&"Debugger.resume".to_string()));
}
