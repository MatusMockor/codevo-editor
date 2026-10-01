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
            "type":"assistant",
            "message":{"content":[{"type":"redacted_thinking","data":large("opaque ")}]}
        }))
        .unwrap(),
    );
    assert!(compacted["message"]["content"][0]["data"]
        .as_str()
        .unwrap()
        .contains("bytes omitted"));
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
