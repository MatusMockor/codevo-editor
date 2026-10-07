use super::*;

const FIRST_AGENT: &str = "toolu_agent_first";
const SECOND_AGENT: &str = "toolu_agent_second";

fn stream_event(index: usize) -> Vec<u8> {
    line(serde_json::json!({
        "type":"stream_event",
        "session_id":"sess-abcdefgh",
        "parent_tool_use_id":null,
        "event":{"type":"content_block_delta","index":index,"delta":{"type":"text_delta","text":"d".repeat(1024)}}
    }))
}

fn tool_use_summary(index: usize) -> Vec<u8> {
    line(serde_json::json!({
        "type":"tool_use_summary",
        "session_id":"sess-abcdefgh",
        "summary":format!("{index}:{}", "s".repeat(1024))
    }))
}

fn hook_response(index: usize) -> Vec<u8> {
    line(serde_json::json!({
        "type":"system",
        "subtype":"hook_response",
        "session_id":"sess-abcdefgh",
        "hook_name":format!("PostToolUse-{index}"),
        "stdout":"h".repeat(1024)
    }))
}

fn notification_echo(bytes: usize) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"role":"user","content":format!("<task-notification>{}</task-notification>", "n".repeat(bytes))}
    }))
}

fn telemetry(count: usize) -> Vec<Vec<u8>> {
    (0..count)
        .map(|index| match index % 4 {
            0 => stream_event(index),
            1 => tool_use_summary(index),
            2 => hook_response(index),
            _ => [KEEP_ALIVE.to_vec(), stream_event(index)].concat(),
        })
        .collect()
}

fn thinking(text: &str, signature: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"thinking","thinking":text,"signature":signature}]}
    }))
}

fn agent_call(id: &str, description: &str, prompt_bytes: usize) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{
            "type":"tool_use",
            "id":id,
            "name":"Agent",
            "input":{"description":description,"subagent_type":"general-purpose","prompt":"p".repeat(prompt_bytes)}
        }]}
    }))
}

fn agent_result(id: &str, report: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":id,"content":report}]},
        "tool_use_result":{"agentId":"a1b2c3","agentType":"general-purpose","status":"completed"}
    }))
}

fn block(routed: &serde_json::Value) -> &serde_json::Value {
    &routed["message"]["content"][0]
}

#[test]
fn a_telemetry_heavy_unprompted_reply_keeps_every_substantive_line_in_order() {
    let mut router = ClaudeSessionRouter::new();
    let reasoning = "private reasoning é ".repeat(480);
    let signature = "S".repeat(20 * 1024);
    let answer = "final answer ž ".repeat(200);
    let think = thinking(&reasoning, &signature);
    let echo = notification_echo(28 * 1024);
    let noise = telemetry(150);
    let first_call = agent_call(FIRST_AGENT, "review the router", 24 * 1024);
    let second_call = agent_call(SECOND_AGENT, "review the parser", 28 * 1024);
    let first_result = agent_result(FIRST_AGENT, "router report");
    let second_result = agent_result(SECOND_AGENT, "parser report");
    let reply = assistant(&answer);
    let closing = result(None, 0.5, &answer);
    assert!(think.len() > 29 * 1024);
    assert!(reply.len() > 3 * 1024);
    assert!(noise.iter().map(Vec::len).sum::<usize>() >= 150 * 1024);
    let mut lines: Vec<&[u8]> = vec![INIT, &echo];
    lines.extend(noise[..50].iter().map(Vec::as_slice));
    lines.push(&think);
    lines.extend(noise[50..100].iter().map(Vec::as_slice));
    lines.extend([first_call.as_slice(), second_call.as_slice()]);
    lines.extend(noise[100..].iter().map(Vec::as_slice));
    lines.extend([first_result.as_slice(), second_result.as_slice()]);
    lines.extend([reply.as_slice(), closing.as_slice()]);

    let collected = feed_all(&mut router, &lines);

    assert_eq!(collected.background.len(), 1);
    let background = &collected.background[0];
    assert!(background.complete);
    assert!(!background.truncated, "nothing displayable was dropped");
    assert!(background.output.len() <= MAX_BACKGROUND_TURN_BYTES);
    let routed = lines_of(&background.output);
    let kinds: Vec<&str> = routed
        .iter()
        .map(|routed| routed["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "system",
            "assistant",
            "assistant",
            "assistant",
            "user",
            "user",
            "assistant",
            "result"
        ]
    );
    assert_eq!(block(&routed[1])["thinking"], reasoning);
    assert!(block(&routed[1]).get("signature").is_none());
    assert_eq!(block(&routed[2])["id"], FIRST_AGENT);
    assert_eq!(block(&routed[2])["name"], "Agent");
    assert_eq!(
        block(&routed[2])["input"]["description"],
        "review the router"
    );
    assert_eq!(block(&routed[3])["id"], SECOND_AGENT);
    assert_eq!(
        block(&routed[3])["input"]["description"],
        "review the parser"
    );
    assert_eq!(block(&routed[4])["tool_use_id"], FIRST_AGENT);
    assert_eq!(block(&routed[4])["content"], "router report");
    assert_eq!(routed[4]["tool_use_result"]["agentId"], "a1b2c3");
    assert_eq!(block(&routed[5])["tool_use_id"], SECOND_AGENT);
    assert_eq!(block(&routed[6])["text"], answer);
    assert_eq!(routed[7]["result"], answer);
    assert_eq!(routed[7]["total_cost_usd"], 0.5);
}

#[test]
fn an_oversized_unprompted_reply_reports_the_gap_and_keeps_its_answer_and_result() {
    let mut router = ClaudeSessionRouter::new();
    let step_text = "subagent step ".repeat(40 * 1024 / 14);
    let activity = line(serde_json::json!({
        "type":"assistant",
        "parent_tool_use_id":FIRST_AGENT,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"text","text":step_text}]}
    }));
    let answer = "final answer ž ".repeat(200);
    let reply = assistant(&answer);
    let closing = result(None, 0.5, &answer);
    let mut lines: Vec<&[u8]> = vec![INIT];
    lines.extend(std::iter::repeat_n(activity.as_slice(), 8));
    lines.extend([reply.as_slice(), closing.as_slice()]);
    assert!(8 * activity.len() > MAX_BACKGROUND_TURN_BYTES);

    let collected = feed_all(&mut router, &lines);

    let background = &collected.background[0];
    assert!(background.truncated, "dropped activity is reported");
    assert!(background.complete);
    assert!(background.output.len() <= MAX_BACKGROUND_TURN_BYTES);
    let routed = lines_of(&background.output);
    let kept_activity = routed
        .iter()
        .filter(|routed| routed["parent_tool_use_id"] == FIRST_AGENT)
        .count();
    let fits = (BudgetClass::Activity.limit() - INIT.len()) / activity.len();
    assert!((1..8).contains(&fits));
    assert_eq!(kept_activity, fits);
    assert_eq!(routed.len(), fits + 3);
    let tail = &routed[routed.len() - 2..];
    assert_eq!(tail[0]["type"], "assistant");
    assert_eq!(tail[0]["parent_tool_use_id"], serde_json::Value::Null);
    assert_eq!(block(&tail[0])["text"], answer);
    assert_eq!(tail[1]["type"], "result");
    assert_eq!(tail[1]["result"], answer);
}

#[test]
fn each_budget_class_stops_at_its_own_limit() {
    let activity_limit = MAX_BACKGROUND_TURN_BYTES
        - BACKGROUND_RESULT_RESERVE_BYTES
        - BACKGROUND_ANSWER_RESERVE_BYTES;
    let answer_limit = MAX_BACKGROUND_TURN_BYTES - BACKGROUND_RESULT_RESERVE_BYTES;
    assert_eq!(MAX_BACKGROUND_TURN_BYTES, 256 * 1024);
    assert_eq!(BudgetClass::Activity.limit(), activity_limit);
    assert_eq!(BudgetClass::Answer.limit(), answer_limit);
    assert_eq!(BudgetClass::Closing.limit(), MAX_BACKGROUND_TURN_BYTES);

    let mut turn = UnsolicitedTurn::default();
    assert!(turn.push(&vec![b'a'; activity_limit], BudgetClass::Activity));
    assert!(!turn.truncated);
    assert!(!turn.push(b"a", BudgetClass::Activity));
    assert!(turn.truncated);
    assert!(turn.push(
        &vec![b'b'; BACKGROUND_ANSWER_RESERVE_BYTES],
        BudgetClass::Answer
    ));
    assert!(!turn.push(b"b", BudgetClass::Answer));
    assert!(turn.push(
        &vec![b'c'; BACKGROUND_RESULT_RESERVE_BYTES],
        BudgetClass::Closing
    ));
    assert!(!turn.push(b"c", BudgetClass::Closing));
    assert_eq!(turn.output.len(), MAX_BACKGROUND_TURN_BYTES);
}

#[test]
fn only_a_root_assistant_line_with_text_is_an_answer() {
    let class = |value: serde_json::Value| BudgetClass::of(&value);
    let message = |blocks: serde_json::Value| serde_json::json!({"content":blocks});
    assert_eq!(
        class(
            serde_json::json!({"type":"assistant","parent_tool_use_id":null,"message":message(serde_json::json!([{"type":"text","text":"A"}]))})
        ),
        BudgetClass::Answer
    );
    assert_eq!(
        class(
            serde_json::json!({"type":"assistant","message":message(serde_json::json!([{"type":"thinking","thinking":"T"},{"type":"text","text":"A"}]))})
        ),
        BudgetClass::Answer
    );
    assert_eq!(
        class(
            serde_json::json!({"type":"assistant","parent_tool_use_id":"toolu_parent","message":message(serde_json::json!([{"type":"text","text":"A"}]))})
        ),
        BudgetClass::Activity
    );
    assert_eq!(
        class(
            serde_json::json!({"type":"assistant","message":message(serde_json::json!([{"type":"thinking","thinking":"T"}]))})
        ),
        BudgetClass::Activity
    );
    assert_eq!(
        class(
            serde_json::json!({"type":"user","message":message(serde_json::json!([{"type":"text","text":"A"}]))})
        ),
        BudgetClass::Activity
    );
    assert_eq!(
        class(serde_json::json!({"type":"result","subtype":"success"})),
        BudgetClass::Closing
    );
    assert_eq!(
        class(serde_json::json!({"type":"result","parent_tool_use_id":"toolu_parent"})),
        BudgetClass::Activity
    );
}

const FRAME_CONTRACT: &str = include_str!("../../contracts/claude-background-frame-contract.json");

struct ContractFrame {
    name: String,
    buffer: String,
    line: Vec<u8>,
    kept: Option<serde_json::Value>,
    kind: Option<String>,
}

fn contract_frames() -> Vec<ContractFrame> {
    let contract: serde_json::Value = serde_json::from_str(FRAME_CONTRACT).unwrap();
    assert_eq!(contract["schemaVersion"], 1);
    contract["frames"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let frame = row.get("frame");
            let raw = row.get("raw").and_then(serde_json::Value::as_str);
            assert!(frame.is_some() != raw.is_some(), "{row}");
            let bytes = match raw {
                Some(raw) => format!("{raw}\n").into_bytes(),
                None => line(frame.cloned().unwrap()),
            };
            ContractFrame {
                name: row["name"].as_str().unwrap().to_string(),
                buffer: row["buffer"].as_str().unwrap().to_string(),
                line: bytes,
                kept: row.get("projection").or(frame).cloned(),
                kind: frame
                    .and_then(|frame| frame.get("type"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            }
        })
        .collect()
}

fn buffered_after_opening(frame: &[u8]) -> (Vec<serde_json::Value>, bool) {
    let mut router = ClaudeSessionRouter::new();
    let opening = assistant("open");
    let mut collected = feed_all(&mut router, &[&opening, frame]);
    collected.absorb(router.finish());
    assert_eq!(collected.background.len(), 1);
    assert!(collected.turn.is_empty());
    let background = &collected.background[0];
    let mut routed = lines_of(&background.output);
    assert_eq!(routed.remove(0)["message"]["content"][0]["text"], "open");
    (routed, background.truncated)
}

#[test]
fn the_router_buffers_exactly_the_frames_the_shared_contract_keeps() {
    let frames = contract_frames();
    assert!(frames.len() > 40);
    for frame in &frames {
        let (routed, truncated) = buffered_after_opening(&frame.line);
        let state = frame.buffer.as_str();
        assert!(
            matches!(state, "kept" | "dropped" | "gap"),
            "{}",
            frame.name
        );
        let expected: Vec<serde_json::Value> = frame
            .kept
            .iter()
            .filter(|_| state == "kept")
            .cloned()
            .collect();
        assert_eq!(routed, expected, "{}", frame.name);
        assert_eq!(truncated, state == "gap", "{}", frame.name);
    }
}

#[test]
fn every_silent_frame_type_is_pinned_by_a_dropped_contract_row() {
    use crate::agent_task_spawner::claude_background_line::{
        MAX_NAMED_FRAME_TYPE_BYTES, SILENT_FRAME_TYPES,
    };
    let frames = contract_frames();
    let dropped: Vec<&str> = frames
        .iter()
        .filter(|frame| frame.buffer == "dropped")
        .filter_map(|frame| frame.kind.as_deref())
        .collect();
    for silent in SILENT_FRAME_TYPES {
        assert!(dropped.contains(&silent), "{silent}");
    }
    let overlong = frames
        .iter()
        .filter_map(|frame| frame.kind.as_deref())
        .filter(|kind| kind.len() > MAX_NAMED_FRAME_TYPE_BYTES)
        .count();
    assert_eq!(overlong, 1);
}

#[test]
fn a_reply_opened_by_silent_frames_still_closes_on_its_result() {
    let mut router = ClaudeSessionRouter::new();
    let delta = stream_event(0);
    let echo = notification_echo(64);
    let opened = feed_all(&mut router, &[&delta, &echo, KEEP_ALIVE]);
    assert!(opened.background.is_empty());
    assert_eq!(
        router.background_tasks().reply,
        ClaudeBackgroundReply::InProgress
    );
    assert_eq!(router.conversation(), Some("sess-abcdefgh"));

    let closed = router.feed(&result(None, 0.5, "done"));

    assert_eq!(closed.background_turns.len(), 1);
    let background = &closed.background_turns[0];
    assert!(background.complete);
    assert!(!background.truncated);
    let routed = lines_of(&background.output);
    assert_eq!(routed.len(), 1);
    assert_eq!(routed[0]["type"], "result");
    assert_eq!(routed[0]["total_cost_usd"], 0.5);
    assert_eq!(router.background_tasks().reply, ClaudeBackgroundReply::None);
}

#[test]
fn a_task_level_that_is_not_buffered_still_drives_background_task_tracking() {
    let mut router = ClaudeSessionRouter::new();
    let opened = feed_all(&mut router, &[INIT, TASKS_LISTED, TASK_STARTED]);
    assert_eq!(opened.background_changes, 2);
    assert_eq!(router.live_background_tasks(), 1);
    assert!(router.live_background_task("bg-1"));

    let emptied = router.feed(TASKS_EMPTIED);
    assert_eq!(router.live_background_tasks(), 1);
    assert!(emptied.background_tasks.is_none());
    let ended = router.feed(KEEP_ALIVE);
    assert_eq!(router.live_background_tasks(), 0);
    assert_eq!(ended.background_tasks.map(|level| level.total), Some(0));

    let closed = router.feed(&result(None, 0.5, "done"));
    let background = &closed.background_turns[0];
    assert!(!background.truncated);
    let subtypes: Vec<serde_json::Value> = lines_of(&background.output)
        .iter()
        .map(|routed| routed["subtype"].clone())
        .collect();
    assert_eq!(subtypes, ["init", "task_started", "success"]);
}

#[test]
fn an_interrupt_acknowledged_inside_an_unprompted_reply_is_still_observed() {
    let mut router = ClaudeSessionRouter::new();
    assert!(router.feed(INIT).background_turns.is_empty());
    router.interrupt_sent("req-1".to_string());

    let ack = router.feed(&acknowledgement("req-1"));

    assert!(ack.interrupt_acknowledged);
    let closed = router.feed(&result(None, 0.5, "done"));
    assert_eq!(lines_of(&closed.background_turns[0].output).len(), 2);
}
