use super::*;
use serde_json::json;

const ROOT: &str = "/Users/dev/project";

fn at(start: Instant, millis: u64) -> Instant {
    start + Duration::from_millis(millis)
}

fn claude_line(request_id: &str, description: &str) -> Vec<u8> {
    let mut line = json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": {"commands": [{"name": "pr", "description": description}]},
        },
    })
    .to_string()
    .into_bytes();
    line.push(b'\n');
    line
}

fn skills_response(id: u64, cwd: &str, names: &[&str]) -> Vec<u8> {
    let skills: Vec<_> = names
        .iter()
        .map(|name| json!({"name": name, "scope": "repo"}))
        .collect();
    let mut line =
        json!({"id": id, "result": {"data": [{"cwd": cwd, "skills": skills, "errors": []}]}})
            .to_string()
            .into_bytes();
    line.push(b'\n');
    line
}

fn handshake_response() -> Vec<u8> {
    b"{\"id\":0,\"result\":{\"userAgent\":\"codex\"}}\n".to_vec()
}

fn request_id(step: &ProbeStep) -> u64 {
    let ProbeStep::Write(bytes) = step else {
        panic!("expected a request, got {step:?}");
    };
    let value: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(value["method"], "skills/list");
    assert_eq!(value["params"]["cwds"], json!([ROOT]));
    assert!(bytes.ends_with(b"\n"));
    value["id"].as_u64().unwrap()
}

fn result_names(line: &[u8]) -> Vec<String> {
    let value: Value = serde_json::from_slice(line).unwrap();
    parse_codex_skills_value(&value, ROOT)
        .unwrap()
        .entries
        .into_iter()
        .map(|entry| entry.name)
        .collect()
}

#[test]
fn claude_watch_completes_only_on_our_control_response_line() {
    let mut watch = ClaudeInitializeWatch::new();
    assert_eq!(watch.step(), ProbeStep::Wait);
    watch.observe(&claude_line("other-request", "first"));
    assert_eq!(watch.step(), ProbeStep::Wait);
    watch.observe(b"{\"type\":\"system\",\"text\":\"\\\"type\\\":\\\"control_response\\\"\"}\n");
    watch.observe(b"not json\n");
    watch.observe(
        b"{\"type\":\"assistant\",\"message\":\"\\\"request_id\\\":\\\"codevo-command-catalog\\\"\"}\n",
    );
    assert_eq!(watch.step(), ProbeStep::Wait);
    assert!(!watch.is_done());
    let marker_in_description = claude_line(
        "codevo-command-catalog",
        "contains \"type\":\"control_response\" text",
    );
    let (head, tail) = marker_in_description.split_at(marker_in_description.len() / 2);
    watch.observe(head);
    assert_eq!(watch.step(), ProbeStep::Wait);
    watch.observe(tail);
    assert_eq!(watch.step(), ProbeStep::Done);
    assert!(watch.is_done());
    let result = watch.take_result().unwrap();
    assert_eq!(
        &result[..],
        &marker_in_description[..marker_in_description.len() - 1]
    );
    watch.observe(&claude_line("codevo-command-catalog", "later"));
    assert_eq!(watch.take_result(), None);
}

#[test]
fn claude_watch_accepts_reordered_keys_and_large_lines_and_rejects_oversized_lines() {
    let mut watch = ClaudeInitializeWatch::new();
    let reordered = format!(
        "{{\"response\":{{\"response\":{{\"commands\":[]}},\"request_id\":\"{CLAUDE_CONTROL_REQUEST_ID}\",\"subtype\":\"success\"}},\"type\":\"control_response\"}}\n"
    );
    watch.observe(reordered.as_bytes());
    assert_eq!(watch.step(), ProbeStep::Done);

    let mut watch = ClaudeInitializeWatch::new();
    let large = claude_line("codevo-command-catalog", &"d".repeat(50 * 1024));
    for chunk in large.chunks(4096) {
        watch.observe(chunk);
    }
    assert_eq!(watch.step(), ProbeStep::Done);
    assert_eq!(watch.take_result().unwrap().len(), large.len() - 1);

    let mut watch = ClaudeInitializeWatch::new();
    watch.observe(&vec![b'x'; MAX_CATALOG_OUTPUT_BYTES]);
    assert_eq!(watch.step(), ProbeStep::Wait);
    watch.observe(b"y");
    assert!(matches!(watch.step(), ProbeStep::Failed(_)));
    watch.observe(&claude_line("codevo-command-catalog", "late"));
    assert!(matches!(watch.step(), ProbeStep::Failed(_)));
    assert_eq!(watch.take_result(), None);
}

#[test]
fn codex_poll_waits_for_the_handshake_then_polls_with_one_outstanding_request() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    assert_eq!(poll.step(at(start, 0)), ProbeStep::Wait);
    poll.observe(
        b"{\"method\":\"account/updated\",\"params\":{}}\n",
        at(start, 10),
    );
    assert_eq!(poll.step(at(start, 10)), ProbeStep::Wait);
    poll.observe(&handshake_response(), at(start, 20));
    let first = poll.step(at(start, 20));
    assert_eq!(request_id(&first), 1);
    assert_eq!(poll.step(at(start, 30)), ProbeStep::Wait);
    assert_eq!(poll.step(at(start, 900)), ProbeStep::Wait);
    poll.observe(&skills_response(1, ROOT, &["a"]), at(start, 950));
    assert_eq!(request_id(&poll.step(at(start, 950))), 2);
    assert_eq!(poll.take_result(), None);
}

#[test]
fn codex_poll_finishes_once_the_name_list_is_stable_and_returns_the_grown_list() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(&skills_response(1, ROOT, &["a"]), at(start, 100));
    assert_eq!(poll.step(at(start, 200)), ProbeStep::Wait);
    assert_eq!(request_id(&poll.step(at(start, 400))), 2);
    poll.observe(&skills_response(2, ROOT, &["a"]), at(start, 450));
    assert_eq!(request_id(&poll.step(at(start, 800))), 3);
    poll.observe(&skills_response(3, ROOT, &["a", "b", "c"]), at(start, 850));
    assert_eq!(request_id(&poll.step(at(start, 1200))), 4);
    poll.observe(&skills_response(4, ROOT, &["a", "b", "c"]), at(start, 1250));
    assert_eq!(poll.step(at(start, 1500)), ProbeStep::Wait);
    assert_eq!(request_id(&poll.step(at(start, 1600))), 5);
    poll.observe(&skills_response(5, ROOT, &["a", "b", "c"]), at(start, 1650));
    assert_eq!(request_id(&poll.step(at(start, 2000))), 6);
    poll.observe(&skills_response(6, ROOT, &["a", "b", "c"]), at(start, 2050));
    assert_eq!(request_id(&poll.step(at(start, 2400))), 7);
    poll.observe(&skills_response(7, ROOT, &["a", "b", "c"]), at(start, 2450));
    assert_eq!(request_id(&poll.step(at(start, 2800))), 8);
    assert_eq!(poll.step(at(start, 2849)), ProbeStep::Wait);
    assert_eq!(poll.step(at(start, 2850)), ProbeStep::Done);
    assert!(poll.is_done());
    assert_eq!(result_names(&poll.take_result().unwrap()), ["a", "b", "c"]);
    assert_eq!(poll.step(at(start, 3000)), ProbeStep::Done);
}

#[test]
fn codex_poll_finishes_two_seconds_after_an_unchanging_first_result() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(&skills_response(1, ROOT, &["pdf"]), at(start, 100));
    let mut requests = 1;
    for millis in (200..2100).step_by(100) {
        match poll.step(at(start, millis)) {
            ProbeStep::Wait => {}
            step @ ProbeStep::Write(_) => {
                let id = request_id(&step);
                requests += 1;
                assert_eq!(id, requests);
                poll.observe(&skills_response(id, ROOT, &["pdf"]), at(start, millis + 10));
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(poll.step(at(start, 2100)), ProbeStep::Done);
    assert_eq!(result_names(&poll.take_result().unwrap()), ["pdf"]);
}

#[test]
fn codex_poll_stops_at_the_cap_when_the_list_keeps_changing() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    let mut responses = 0;
    let mut last = Vec::new();
    for millis in (0..6000).step_by(50) {
        match poll.step(at(start, millis)) {
            ProbeStep::Wait => {}
            step @ ProbeStep::Write(_) => {
                let id = request_id(&step);
                responses += 1;
                last = vec![format!("skill-{responses}")];
                let names: Vec<&str> = last.iter().map(String::as_str).collect();
                poll.observe(&skills_response(id, ROOT, &names), at(start, millis + 10));
            }
            other => panic!("unexpected {other:?} at {millis}"),
        }
    }
    assert!(responses <= MAX_CODEX_SKILLS_POLLS);
    assert_eq!(poll.step(at(start, 6000)), ProbeStep::Done);
    assert_eq!(result_names(&poll.take_result().unwrap()), last);
}

#[test]
fn codex_poll_fails_on_error_responses_and_missing_results() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(&skills_response(1, ROOT, &["a"]), at(start, 100));
    assert_eq!(request_id(&poll.step(at(start, 400))), 2);
    poll.observe(
        b"{\"id\":2,\"error\":{\"code\":-1,\"message\":\"nope\"}}\n",
        at(start, 450),
    );
    assert!(matches!(poll.step(at(start, 450)), ProbeStep::Failed(_)));
    assert_eq!(poll.take_result(), None);

    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(b"{\"id\":0,\"error\":{\"code\":-1}}\n", at(start, 0));
    assert!(matches!(poll.step(at(start, 0)), ProbeStep::Failed(_)));

    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    assert_eq!(poll.step(at(start, 5999)), ProbeStep::Wait);
    assert!(matches!(poll.step(at(start, 6000)), ProbeStep::Failed(_)));

    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(
        &skills_response(1, "/Users/dev/other", &["a"]),
        at(start, 100),
    );
    assert!(matches!(poll.step(at(start, 100)), ProbeStep::Failed(_)));
}

#[test]
fn codex_poll_ignores_unrelated_lines_wrong_ids_and_rejects_oversized_lines() {
    let start = Instant::now();
    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(b"garbage\n{\"method\":\"skills/changed\"}\n", at(start, 50));
    poll.observe(&skills_response(99, ROOT, &["wrong"]), at(start, 60));
    poll.observe(&skills_response(2, ROOT, &["early"]), at(start, 70));
    poll.observe(b"{\"id\":1,\"error\":{\"code\":1}}", at(start, 80));
    assert_eq!(poll.step(at(start, 400)), ProbeStep::Wait);
    poll.observe(b"\n", at(start, 410));
    assert!(matches!(poll.step(at(start, 410)), ProbeStep::Failed(_)));

    let mut poll = CodexSkillsPoll::new(ROOT);
    poll.observe(&handshake_response(), at(start, 0));
    assert_eq!(request_id(&poll.step(at(start, 0))), 1);
    poll.observe(&vec![b'{'; MAX_CATALOG_OUTPUT_BYTES + 1], at(start, 100));
    assert!(matches!(poll.step(at(start, 100)), ProbeStep::Failed(_)));
    poll.observe(&skills_response(1, ROOT, &["a"]), at(start, 200));
    assert!(matches!(poll.step(at(start, 200)), ProbeStep::Failed(_)));
    assert_eq!(poll.take_result(), None);
    assert_eq!(MAX_CODEX_SKILLS_STREAM_BYTES, 17 * 2 * 1024 * 1024);
}
