use super::*;

const IMAGE_TOOL_ID: &str = "toolu_image_read";
const AGENT_TOOL_ID: &str = "toolu_agent_spawn";

fn tool_use(id: &str, name: &str, input: serde_json::Value, parent: Option<&str>) -> Vec<u8> {
    line(serde_json::json!({
        "type":"assistant",
        "parent_tool_use_id":parent,
        "session_id":"sess-abcdefgh",
        "message":{"content":[{"type":"tool_use","id":id,"name":name,"input":input}]}
    }))
}

fn tool_result(id: &str, content: serde_json::Value, parent: Option<&str>) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user",
        "parent_tool_use_id":parent,
        "session_id":"sess-abcdefgh",
        "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":id,"content":content}]},
        "tool_use_result":{"stdout":content.to_string(),"interrupted":false}
    }))
}

fn bare_tool_result(id: &str, content: &str) -> Vec<u8> {
    line(serde_json::json!({
        "type":"user",
        "parent_tool_use_id":AGENT_TOOL_ID,
        "session_id":"sess-abcdefgh",
        "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":id,"content":content}]}
    }))
}

fn image_result(id: &str, base64_bytes: usize) -> Vec<u8> {
    tool_result(
        id,
        serde_json::json!([{
            "type":"image",
            "source":{"type":"base64","media_type":"image/png","data":"A".repeat(base64_bytes)}
        }]),
        None,
    )
}

fn tool_output(index: usize, bytes: usize) -> String {
    let head = format!("HEAD-{index:03}-");
    let tail = format!("-TAIL-{index:03}");
    let body = "é".repeat((bytes - head.len() - tail.len()) / 2);
    format!("{head}{body}{tail}")
}

fn edge(characters: impl Iterator<Item = char>) -> String {
    characters.take(200).collect()
}

fn routed_tool_results(output: &[u8]) -> Vec<serde_json::Value> {
    lines_of(output)
        .into_iter()
        .filter(|routed| routed["type"] == "user")
        .map(|routed| routed["message"]["content"][0].clone())
        .collect()
}

#[test]
fn an_unprompted_reply_that_reads_a_large_image_keeps_the_image_tool_result() {
    let mut router = ClaudeSessionRouter::new();
    let read = tool_use(
        IMAGE_TOOL_ID,
        "Read",
        serde_json::json!({"file_path":"/tmp/after-hover.png"}),
        None,
    );
    let image = image_result(IMAGE_TOOL_ID, 240 * 1024);
    let reply = assistant("Looks good.");
    let closing = result(None, 0.5, "Looks good.");
    let collected = feed_all(&mut router, &[INIT, &read, &image, &reply, &closing]);

    assert_eq!(collected.background.len(), 1);
    let background = &collected.background[0];
    assert!(
        !background.truncated,
        "nothing the transcript shows was dropped"
    );
    assert!(background.complete);
    assert!(background.output.len() <= MAX_BACKGROUND_TURN_BYTES);
    let results = routed_tool_results(&background.output);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["tool_use_id"], IMAGE_TOOL_ID);
    assert_eq!(results[0]["content"][0]["type"], "image");
    let routed = lines_of(&background.output);
    assert_eq!(routed.len(), 5);
    assert_eq!(routed[3]["message"]["content"][0]["text"], "Looks good.");
    assert_eq!(routed.last().unwrap()["type"], "result");
}

#[test]
fn a_subagent_heavy_unprompted_reply_keeps_every_tool_result_head_and_tail() {
    let mut router = ClaudeSessionRouter::new();
    let outputs: Vec<String> = (0..40).map(|index| tool_output(index, 24 * 1024)).collect();
    let calls: Vec<Vec<u8>> = (0..40)
        .map(|index| {
            tool_use(
                &format!("toolu_inner_{index:03}"),
                "Bash",
                serde_json::json!({"command":format!("cat big-{index}.log")}),
                Some(AGENT_TOOL_ID),
            )
        })
        .collect();
    let results: Vec<Vec<u8>> = outputs
        .iter()
        .enumerate()
        .map(|(index, output)| {
            tool_result(
                &format!("toolu_inner_{index:03}"),
                serde_json::json!(output),
                Some(AGENT_TOOL_ID),
            )
        })
        .collect();
    let closing = result(None, 0.5, "subagent done");
    let mut lines: Vec<&[u8]> = vec![INIT];
    for (call, result) in calls.iter().zip(&results) {
        lines.push(call);
        lines.push(result);
    }
    lines.push(&closing);
    let raw: usize = lines.iter().map(|bytes| bytes.len()).sum();
    assert!(raw > 4 * MAX_BACKGROUND_TURN_BYTES);

    let collected = feed_all(&mut router, &lines);

    let background = &collected.background[0];
    assert!(!background.truncated);
    assert!(background.complete);
    let routed = routed_tool_results(&background.output);
    assert_eq!(routed.len(), outputs.len());
    for (index, (routed, original)) in routed.iter().zip(&outputs).enumerate() {
        assert_eq!(routed["tool_use_id"], format!("toolu_inner_{index:03}"));
        let kept = routed["content"].as_str().unwrap();
        assert!(kept.starts_with(&edge(original.chars())));
        assert!(kept.ends_with(
            &edge(original.chars().rev())
                .chars()
                .rev()
                .collect::<String>()
        ));
        assert!(kept.contains("bytes omitted"));
        assert!(kept.len() < original.len() / 8);
    }
    assert_eq!(
        lines_of(&background.output).last().unwrap()["type"],
        "result"
    );
}

#[test]
fn a_reply_that_overflows_even_after_compaction_still_reports_the_gap() {
    let mut router = ClaudeSessionRouter::new();
    let results: Vec<Vec<u8>> = (0..200)
        .map(|index| {
            tool_result(
                &format!("toolu_flood_{index:03}"),
                serde_json::json!(tool_output(index, 24 * 1024)),
                Some(AGENT_TOOL_ID),
            )
        })
        .collect();
    let closing = result(None, 0.5, "flooded");
    let mut lines: Vec<&[u8]> = vec![INIT];
    lines.extend(results.iter().map(Vec::as_slice));
    lines.push(&closing);

    let collected = feed_all(&mut router, &lines);

    let background = &collected.background[0];
    assert!(background.truncated);
    assert!(background.complete);
    assert!(background.output.len() <= MAX_BACKGROUND_TURN_BYTES);
    assert_eq!(
        lines_of(&background.output).last().unwrap()["type"],
        "result"
    );
}

#[test]
fn finish_reports_a_dangling_partial_line_of_an_unprompted_reply_as_truncated() {
    let mut router = ClaudeSessionRouter::new();
    let reply = assistant("background-started");
    assert!(feed_all(&mut router, &[INIT, &reply]).background.is_empty());
    assert!(router
        .feed(b"{\"type\":\"assistant\",\"message\":")
        .background_turns
        .is_empty());

    let step = router.finish();

    assert_eq!(step.background_turns.len(), 1);
    let background = &step.background_turns[0];
    assert!(background.truncated);
    assert!(!background.complete);
    assert_eq!(background.output, [INIT, reply.as_slice()].concat());
}

#[test]
fn finish_without_a_partial_line_ends_an_unprompted_reply_without_a_gap() {
    let mut router = ClaudeSessionRouter::new();
    let reply = assistant("background-started");
    feed_all(&mut router, &[INIT, &reply]);

    let step = router.finish();

    assert!(!step.background_turns[0].truncated);
    assert!(!step.background_turns[0].complete);
}

#[test]
fn many_medium_tool_results_are_compacted_and_all_kept() {
    let mut router = ClaudeSessionRouter::new();
    let results: Vec<Vec<u8>> = (0..60)
        .map(|index| {
            bare_tool_result(
                &format!("toolu_medium_{index:03}"),
                &tool_output(index, 6 * 1024),
            )
        })
        .collect();
    assert!(results.iter().all(|bytes| bytes.len() < 8 * 1024));
    let closing = result(None, 0.5, "medium done");
    let mut lines: Vec<&[u8]> = vec![INIT];
    lines.extend(results.iter().map(Vec::as_slice));
    lines.push(&closing);
    let raw: usize = lines.iter().map(|bytes| bytes.len()).sum();
    assert!(raw > MAX_BACKGROUND_TURN_BYTES);

    let collected = feed_all(&mut router, &lines);

    let background = &collected.background[0];
    assert!(!background.truncated);
    assert!(background.complete);
    let routed = routed_tool_results(&background.output);
    assert_eq!(routed.len(), 60);
    assert_eq!(routed[59]["tool_use_id"], "toolu_medium_059");
}

#[test]
fn owned_turn_lines_are_never_compacted() {
    let mut router = ClaudeSessionRouter::new();
    let (_, id) = owned_turn(&mut router);
    let large = bare_tool_result("toolu_owned", &tool_output(0, 24 * 1024));

    let step = router.feed(&large);

    assert_eq!(step.turn_output, large);
    assert!(router.feed(&result(Some(&id), 0.5, "S")).settled);
}
