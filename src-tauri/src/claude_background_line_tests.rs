use super::*;
use serde_json::json;

fn compact(frame: Value) -> Option<Vec<u8>> {
    let mut line = serde_json::to_vec(&frame).unwrap();
    line.push(b'\n');
    compact_background_frame(&frame, line.len())
}

fn decoded(bytes: &[u8]) -> Value {
    assert_eq!(bytes.last(), Some(&b'\n'));
    assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    serde_json::from_slice(bytes).unwrap()
}

fn large(seed: &str) -> String {
    seed.repeat(8 * 1024 / seed.len() + 1)
}

#[test]
fn lines_too_short_to_hold_a_clippable_string_stay_verbatim() {
    let frame = json!({
        "type":"user",
        "message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"x".repeat(MIN_CLIPPED_STRING_BYTES - 200)}]}
    });
    assert_eq!(compact(frame.clone()), None);
    assert_eq!(
        compact_background_frame(&frame, MIN_CLIPPED_STRING_BYTES - 1),
        None
    );
}

#[test]
fn untouched_and_non_object_frames_stay_verbatim() {
    assert_eq!(
        compact(json!({"type":"result","result":large("reply ")})),
        None
    );
    assert_eq!(compact(json!([large("x")])), None);
}

#[test]
fn reply_text_and_reasoning_are_never_clipped() {
    let text = large("visible reply ");
    let thinking = large("private reasoning ");
    let compacted = decoded(&compact(json!({
        "type":"assistant",
        "message":{"content":[
            {"type":"thinking","thinking":thinking,"signature":"sig"},
            {"type":"text","text":text},
            {"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/a.ts","content":large("body ")}}
        ]}
    }))
    .unwrap());

    let blocks = &compacted["message"]["content"];
    assert_eq!(blocks[0]["thinking"], thinking);
    assert_eq!(blocks[1]["text"], text);
    assert_eq!(blocks[2]["id"], "t1");
    assert_eq!(blocks[2]["name"], "Write");
    assert_eq!(blocks[2]["input"]["file_path"], "/a.ts");
    let body = blocks[2]["input"]["content"].as_str().unwrap();
    assert!(body.len() < 2 * RETAINED_STRING_EDGE_BYTES + 64);
}

#[test]
fn clipped_strings_keep_utf8_head_and_tail_with_an_omission_marker() {
    let output = format!("START{}END", "é€".repeat(4096));
    let compacted = decoded(&compact(json!({
        "type":"user",
        "parent_tool_use_id":"toolu_parent",
        "message":{"content":[{"type":"tool_result","tool_use_id":"t9","is_error":true,"content":[{"type":"text","text":output}]}]}
    }))
    .unwrap());

    assert_eq!(compacted["parent_tool_use_id"], "toolu_parent");
    let block = &compacted["message"]["content"][0];
    assert_eq!(block["tool_use_id"], "t9");
    assert_eq!(block["is_error"], true);
    let kept = block["content"][0]["text"].as_str().unwrap();
    let head = kept.split('\n').next().unwrap();
    let tail = kept.rsplit('\n').next().unwrap();
    assert!(head.starts_with("START"));
    assert!(tail.ends_with("END"));
    assert!(output.starts_with(head));
    assert!(output.ends_with(tail));
    assert!(head.len() > RETAINED_STRING_EDGE_BYTES - 4);
    assert!(tail.len() > RETAINED_STRING_EDGE_BYTES - 4);
    let omitted = output.len() - head.len() - tail.len();
    assert!(kept.contains(&format!("… {omitted} bytes omitted …")));
}

#[test]
fn tool_use_result_keeps_subagent_fields_and_bounds_large_arrays() {
    let filenames: Vec<String> = (0..2_000)
        .map(|index| format!("src/file-{index}.ts"))
        .collect();
    let compacted = decoded(
        &compact(json!({
            "type":"user",
            "message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"done"}]},
            "tool_use_result":{
                "agentId":"a1b2c3",
                "agentType":"general-purpose",
                "status":"completed",
                "totalDurationMs":1200,
                "totalTokens":3400,
                "totalToolUseCount":5,
                "filenames":filenames,
                "content":[{"type":"text","text":large("report ")}]
            }
        }))
        .unwrap(),
    );

    let result = &compacted["tool_use_result"];
    assert_eq!(result["agentId"], "a1b2c3");
    assert_eq!(result["agentType"], "general-purpose");
    assert_eq!(result["status"], "completed");
    assert_eq!(result["totalDurationMs"], 1200);
    assert_eq!(result["totalTokens"], 3400);
    assert_eq!(result["totalToolUseCount"], 5);
    let kept = result["filenames"].as_array().unwrap();
    assert_eq!(kept.len(), MAX_RETAINED_ARRAY_ITEMS);
    assert_eq!(kept[0], "src/file-0.ts");
    assert_eq!(compacted["message"]["content"][0]["content"], "done");
}

#[test]
fn base64_images_shrink_without_losing_their_block_shape() {
    let line = compact(json!({
        "type":"user",
        "message":{"content":[{"type":"tool_result","tool_use_id":"t3","content":[
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR".repeat(60_000)}}
        ]}]}
    }))
    .unwrap();

    assert!(line.len() < 4 * RETAINED_STRING_EDGE_BYTES);
    let value = decoded(&line);
    let image = &value["message"]["content"][0]["content"][0];
    assert_eq!(image["type"], "image");
    assert_eq!(image["source"]["media_type"], "image/png");
    assert!(image["source"]["data"]
        .as_str()
        .unwrap()
        .starts_with("iVBOR"));
}

#[test]
fn only_assistant_reply_text_and_reasoning_stay_verbatim() {
    let compacted = decoded(
        &compact(json!({
            "type":"user",
            "message":{"content":[
                {"type":"text","text":large("task notification ")},
                {"type":"tool_result","tool_use_id":"t4","content":"ok"}
            ]}
        }))
        .unwrap(),
    );
    assert!(compacted["message"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("bytes omitted"));

    let compacted = decoded(
        &compact(json!({
            "type":"user",
            "message":{"content":[
                {"type":"thinking","thinking":large("echoed "),"signature":"sig"},
                {"type":"tool_result","tool_use_id":"t4","content":"ok"}
            ]}
        }))
        .unwrap(),
    );
    let echoed = &compacted["message"]["content"][0];
    assert!(echoed["thinking"]
        .as_str()
        .unwrap()
        .contains("bytes omitted"));
    assert_eq!(echoed["signature"], "sig");
}

#[test]
fn a_reasoning_signature_is_removed_and_the_reasoning_stays_byte_identical() {
    let thinking = format!("START é€ {} END", large("private reasoning ž "));
    let text = large("visible reply ");
    let command = "c".repeat(MIN_CLIPPED_STRING_BYTES - 1);
    let frame = json!({
        "type":"assistant",
        "parent_tool_use_id":null,
        "session_id":"sess-abcdefgh",
        "message":{"role":"assistant","model":"claude","usage":{"input_tokens":3,"output_tokens":5},"content":[
            {"type":"thinking","thinking":thinking,"signature":"S".repeat(20 * 1024)},
            {"type":"text","text":text},
            {"type":"tool_use","id":"t1","name":"Bash","input":{"command":command,"description":"List files"}}
        ]}
    });

    let line = compact(frame.clone()).unwrap();

    assert!(line.len() < serde_json::to_vec(&frame).unwrap().len() - 20 * 1024);
    let mut expected = frame;
    expected["message"]["content"][0]
        .as_object_mut()
        .unwrap()
        .remove("signature");
    assert_eq!(decoded(&line), expected);
    let kept = String::from_utf8(line).unwrap();
    assert!(kept.contains(&serde_json::to_string(&thinking).unwrap()));
    assert!(kept.contains(&serde_json::to_string(&text).unwrap()));
}

#[test]
fn a_signature_is_removed_from_lines_too_short_to_clip() {
    let frame = json!({
        "type":"assistant",
        "message":{"content":[{"type":"thinking","thinking":"short","signature":"c2ln"}]}
    });

    let compacted = decoded(&compact(frame).unwrap());

    assert_eq!(
        compacted,
        json!({"type":"assistant","message":{"content":[{"type":"thinking","thinking":"short"}]}})
    );
}

#[test]
fn a_redacted_reasoning_payload_is_removed_whole() {
    let compacted = decoded(
        &compact(json!({
            "type":"assistant",
            "message":{"content":[{"type":"redacted_thinking","data":large("opaque ")}]}
        }))
        .unwrap(),
    );

    assert_eq!(
        compacted["message"]["content"],
        json!([{"type":"redacted_thinking"}])
    );
}

#[test]
fn assistant_lines_without_an_undisplayed_field_stay_verbatim() {
    assert_eq!(
        compact(json!({
            "type":"assistant",
            "message":{"content":[
                {"type":"thinking","thinking":"short"},
                {"type":"text","text":"signature"},
                {"type":"tool_use","id":"t1","name":"Bash","input":{"signature":"kept","data":"kept"}}
            ]}
        })),
        None
    );
}

fn projected(frame: Value) -> Option<Value> {
    let mut line = serde_json::to_vec(&frame).unwrap();
    line.push(b'\n');
    background_line(&frame, line).map(|bytes| decoded(&bytes))
}

#[test]
fn frames_the_transcript_shows_are_buffered_whole_or_compacted() {
    let small = json!({"type":"result","subtype":"success","result":"done"});
    assert_eq!(projected(small.clone()), Some(small));
    let scalar = json!([1, 2, 3]);
    assert_eq!(projected(scalar.clone()), Some(scalar));

    let clipped = projected(json!({
        "type":"user",
        "message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":large("z")}]}
    }))
    .unwrap();
    assert!(clipped["message"]["content"][0]["content"]
        .as_str()
        .unwrap()
        .contains("bytes omitted"));
}

#[test]
fn frames_the_transcript_never_shows_are_not_buffered() {
    for kind in SILENT_FRAME_TYPES {
        assert_eq!(
            projected(json!({"type":kind,"payload":large("p")})),
            None,
            "{kind}"
        );
    }
    let echo = json!({"type":"user","message":{"content":large("<task-notification>")}});
    assert_eq!(projected(echo), None);
    let text_only = json!({"type":"user","message":{"content":[{"type":"text","text":"hi"}]}});
    assert_eq!(projected(text_only), None);
    let listed = json!({"type":"user","message":[{"type":"tool_result","tool_use_id":"t1"}]});
    assert_eq!(projected(listed), None);
    for subtype in [
        "hook_started",
        "hook_response",
        "background_tasks_changed",
        "files_persisted",
    ] {
        assert_eq!(
            projected(json!({"type":"system","subtype":subtype,"stdout":large("h")})),
            None,
            "{subtype}"
        );
    }
    for subtype in ["compact_boundary", "status"] {
        assert_eq!(
            projected(
                json!({"type":"system","subtype":subtype,"parent_tool_use_id":"toolu_parent"})
            ),
            None,
            "{subtype}"
        );
    }
}

#[test]
fn every_system_subtype_the_transcript_reads_is_buffered() {
    let subtypes = [
        "init",
        "api_retry",
        "compact_boundary",
        "status",
        "task_started",
        "task_progress",
        "task_notification",
        "task_updated",
    ];
    for subtype in subtypes {
        let frame =
            json!({"type":"system","subtype":subtype,"parent_tool_use_id":null,"task_id":"t1"});
        assert_eq!(projected(frame.clone()), Some(frame), "{subtype}");
    }
    for subtype in ["init", "api_retry", "task_started", "task_progress"] {
        let frame = json!({"type":"system","subtype":subtype,"parent_tool_use_id":"toolu_parent"});
        assert_eq!(projected(frame.clone()), Some(frame), "{subtype}");
    }
}

#[test]
fn an_unsupported_frame_keeps_only_the_type_its_notice_names() {
    assert_eq!(
        projected(json!({"type":"future_frame","payload":large("p")})),
        Some(json!({"type":"future_frame"}))
    );
    assert_eq!(
        projected(json!({"type":"t".repeat(MAX_NAMED_FRAME_TYPE_BYTES),"payload":1})),
        Some(json!({"type":"t".repeat(MAX_NAMED_FRAME_TYPE_BYTES)}))
    );
    assert_eq!(
        projected(json!({"type":"t".repeat(MAX_NAMED_FRAME_TYPE_BYTES + 1),"payload":1})),
        Some(json!({"type":""}))
    );
    assert_eq!(projected(json!({"payload":large("p")})), Some(json!({})));
    assert_eq!(projected(json!({"type":7,"payload":1})), Some(json!({})));
}

#[test]
fn message_content_arrays_keep_every_item() {
    let todos: Vec<Value> = (0..400)
        .map(|index| json!({"content":format!("step {index}"),"status":"pending"}))
        .collect();
    let blocks: Vec<Value> = (0..300)
        .map(|index| json!({"type":"text","text":format!("{index}:{}", "y".repeat(1_200))}))
        .collect();

    let calls = decoded(&compact(json!({
        "type":"assistant",
        "message":{"content":[{"type":"tool_use","id":"t5","name":"TodoWrite","input":{"todos":todos,"note":large("n ")}}]}
    }))
    .unwrap());
    let results = decoded(
        &compact(json!({
            "type":"user",
            "message":{"content":[{"type":"tool_result","tool_use_id":"t6","content":blocks}]}
        }))
        .unwrap(),
    );

    let kept = calls["message"]["content"][0]["input"]["todos"]
        .as_array()
        .unwrap();
    assert_eq!(kept.len(), 400);
    assert_eq!(kept[399]["content"], "step 399");
    let kept = results["message"]["content"][0]["content"]
        .as_array()
        .unwrap();
    assert_eq!(kept.len(), 300);
    assert!(kept[299]["text"].as_str().unwrap().starts_with("299:"));
}

#[test]
fn compaction_changes_nothing_but_the_clipped_strings() {
    let output = large("z");
    let frame = json!({
        "type":"user",
        "session_id":"sess-abcdefgh",
        "parent_tool_use_id":null,
        "uuid":"u-1",
        "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t7","is_error":false,"content":output}]},
        "tool_use_result":{"stdout":"short","stderr":"","interrupted":false}
    });

    let compacted = decoded(&compact(frame.clone()).unwrap());

    let mut expected = frame;
    let omitted = output.len() - 2 * RETAINED_STRING_EDGE_BYTES;
    expected["message"]["content"][0]["content"] = json!(format!(
        "{}\n… {omitted} bytes omitted …\n{}",
        &output[..RETAINED_STRING_EDGE_BYTES],
        &output[output.len() - RETAINED_STRING_EDGE_BYTES..]
    ));
    assert_eq!(compacted, expected);
}
