use super::*;

fn wire(events: Vec<Value>) -> Value {
    let mut value = serde_json::to_value(thread_document(ROOT_KEY, "agt-thread-0001", 10)).unwrap();
    value["thread"]["turns"][0]["events"] = json!(events);
    value
}

fn accepted(value: Value) -> Value {
    let document: AgentThreadDocument = serde_json::from_value(value).expect("valid wire document");
    validate_agent_thread_document(ROOT_KEY, &document).expect("valid document semantics");
    serde_json::to_value(document).unwrap()
}

fn rejected(value: Value) {
    if let Ok(document) = serde_json::from_value::<AgentThreadDocument>(value.clone()) {
        assert!(
            validate_agent_thread_document(ROOT_KEY, &document).is_err(),
            "accepted invalid wire: {value}"
        );
    }
}

fn breakdown() -> Value {
    json!({"inputTokens": 10, "cachedInputTokens": 2, "cacheWriteInputTokens": 1,
        "outputTokens": 3, "reasoningOutputTokens": 1, "totalTokens": 13})
}

fn usage() -> Value {
    json!({"inputTokens": 10, "outputTokens": 3, "contextTokens": 13, "costUsd": 0.01,
        "cachedInputTokens": 2, "reasoningOutputTokens": 1, "scope": "thread",
        "appServerUsage": {"last": breakdown(), "total": breakdown(), "contextWindow": 200000}})
}

fn app_events() -> Vec<Value> {
    vec![
        json!({"kind":"userMessage", "text":"continue", "attachments":[{
            "kind":"image", "attachmentId":"0123456789abcdef0123456789abcdef",
            "name":"screen.png", "mime":"image/png", "bytes":32, "width":2, "height":2,
            "storedPath":"/workspace/alpha/screen.png"}]}),
        json!({"kind":"subagentActivity","agentThreadId":"child-1","agentPath":"/root/child","activity":"started"}),
        json!({"kind":"subagentEvent","agentThreadId":"child-1","event":{"kind":"assistantText","text":"working"}}),
        json!({"kind":"subagentUsage","agentThreadId":"child-1","usage":usage()}),
        json!({"kind":"subagentTurnDone","agentThreadId":"child-1","durationMs":100,"isError":false}),
        json!({"kind":"queued","threadId":"thread-1","clientUserMessageId":null}),
        json!({"kind":"result","text":"done","isError":false,"usage":usage(),"durationMs":100}),
    ]
}

#[test]
fn appserver_event_variants_usage_and_transport_round_trip() {
    let events = app_events();
    for transport in ["exec", "appServer"] {
        let mut value = wire(events.clone());
        value["thread"]["turns"][0]["codexTransport"] = json!(transport);
        let encoded = accepted(value);
        assert_eq!(encoded["thread"]["turns"][0]["events"], json!(events));
        assert_eq!(encoded["thread"]["turns"][0]["codexTransport"], transport);
    }
    for activity in ["started", "interacted", "interrupted", "completed"] {
        accepted(wire(vec![
            json!({"kind":"subagentActivity","agentThreadId":"child","agentPath":"","activity":activity}),
        ]));
    }
    for event in [
        json!({"kind":"reasoning","text":"reason"}),
        json!({"kind":"toolCall","toolId":"tool","name":"read","inputSummary":"file"}),
        json!({"kind":"toolResult","toolId":"tool","outputSummary":"ok","isError":false}),
    ] {
        accepted(wire(vec![
            json!({"kind":"subagentEvent","agentThreadId":"child","event":event}),
        ]));
    }
}

#[test]
fn legacy_omissions_and_explicit_null_duration_remain_valid() {
    let value = accepted(wire(vec![
        json!({"kind":"userMessage","text":"legacy"}),
        json!({"kind":"result","text":"done","isError":false,"usage":{"inputTokens":1,"outputTokens":2}}),
    ]));
    assert!(value["thread"]["turns"][0].get("codexTransport").is_none());
    assert!(value["thread"]["turns"][0]["events"][0]
        .get("attachments")
        .is_none());
    assert!(value["thread"]["turns"][0]["events"][1]
        .get("durationMs")
        .is_none());
    accepted(wire(vec![
        json!({"kind":"result","text":"","isError":false,"usage":null,"durationMs":null}),
        json!({"kind":"subagentTurnDone","agentThreadId":"child","durationMs":null,"isError":false}),
    ]));
}

#[test]
fn appserver_wire_rejects_unknown_keys_variants_and_nested_subagents() {
    for event in app_events() {
        let mut extra = event.clone();
        extra["surprise"] = json!(true);
        rejected(wire(vec![extra]));
    }
    for event in app_events() {
        rejected(wire(vec![
            json!({"kind":"subagentEvent","agentThreadId":"child","event":event}),
        ]));
    }
    let mut bad_usage = usage();
    bad_usage["appServerUsage"]["last"]["unknown"] = json!(1);
    rejected(wire(vec![
        json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad_usage}),
    ]));
    rejected(wire(vec![
        json!({"kind":"subagentUsage","agentThreadId":"child","usage":null}),
    ]));
    let mut value = wire(vec![]);
    value["thread"]["turns"][0]["codexTransport"] = json!("shell");
    rejected(value);
}

#[test]
fn appserver_numbers_are_unsigned_javascript_safe_integers() {
    for invalid in [json!(-1), json!(1.5), json!(9_007_199_254_740_992_u64)] {
        rejected(wire(vec![
            json!({"kind":"subagentTurnDone","agentThreadId":"child","durationMs":invalid,"isError":false}),
        ]));
        rejected(wire(vec![
            json!({"kind":"result","text":"","isError":false,"usage":null,"durationMs":invalid}),
        ]));
        for key in ["cachedInputTokens", "reasoningOutputTokens"] {
            let mut bad = usage();
            bad[key] = invalid.clone();
            rejected(wire(vec![
                json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad}),
            ]));
        }
        for key in [
            "inputTokens",
            "cachedInputTokens",
            "cacheWriteInputTokens",
            "outputTokens",
            "reasoningOutputTokens",
            "totalTokens",
        ] {
            for scope in ["last", "total"] {
                let mut bad = usage();
                bad["appServerUsage"][scope][key] = invalid.clone();
                rejected(wire(vec![
                    json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad}),
                ]));
            }
        }
    }
}

#[test]
fn child_limit_counts_distinct_ids_across_all_appserver_event_variants() {
    let mut events: Vec<_> = (0..32)
        .map(|index| {
            let mut event = app_events()[1 + index % 4].clone();
            event["agentThreadId"] = json!(format!("child-{index}"));
            event
        })
        .collect();
    accepted(wire(events.clone()));
    events.push(events[0].clone());
    accepted(wire(events.clone()));
    events.push(json!({"kind":"subagentTurnDone","agentThreadId":"child-33","durationMs":null,"isError":false}));
    rejected(wire(events));
}

#[test]
fn user_message_attachment_validation_matches_turn_attachment_bounds() {
    let mut event = app_events()[0].clone();
    event["attachments"] = json!([]);
    rejected(wire(vec![event]));
    let mut event = app_events()[0].clone();
    let attachment = event["attachments"][0].clone();
    event["attachments"] = json!([attachment.clone(), attachment]);
    rejected(wire(vec![event]));
    let mut event = app_events()[0].clone();
    event["attachments"][0]["unknown"] = json!(true);
    rejected(wire(vec![event]));
}

#[test]
fn required_nullable_fields_cannot_be_omitted_and_optional_objects_cannot_be_null() {
    for (mut event, key) in [
        (app_events()[4].clone(), "durationMs"),
        (app_events()[5].clone(), "clientUserMessageId"),
        (app_events()[6].clone(), "usage"),
    ] {
        event.as_object_mut().unwrap().remove(key);
        rejected(wire(vec![event]));
    }
    for key in ["last", "total", "contextWindow"] {
        let mut bad = usage();
        bad["appServerUsage"].as_object_mut().unwrap().remove(key);
        rejected(wire(vec![
            json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad}),
        ]));
    }
    for key in ["scope", "appServerUsage"] {
        let mut bad = usage();
        bad[key] = Value::Null;
        rejected(wire(vec![
            json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad}),
        ]));
    }
    let mut event = app_events()[0].clone();
    event["attachments"] = Value::Null;
    rejected(wire(vec![event]));
    let mut value = wire(vec![]);
    value["thread"]["turns"][0]["codexTransport"] = Value::Null;
    rejected(value);
}

#[test]
fn child_identifiers_are_nonempty_control_free_and_byte_bounded() {
    for id in [
        String::new(),
        "child\nforeign".to_string(),
        "x".repeat(257),
        "é".repeat(129),
    ] {
        for index in 1..=4 {
            let mut event = app_events()[index].clone();
            event["agentThreadId"] = json!(id);
            rejected(wire(vec![event]));
        }
    }
    let mut bad = usage();
    bad["appServerUsage"]["contextWindow"] = json!(9_007_199_254_740_992_u64);
    rejected(wire(vec![
        json!({"kind":"subagentUsage","agentThreadId":"child","usage":bad}),
    ]));
}

#[test]
fn activity_paths_use_task_path_bounds_and_queued_ids_use_session_id_grammar() {
    for size in [257, 4096] {
        accepted(wire(vec![
            json!({"kind":"subagentActivity","agentThreadId":"child",
            "agentPath":"p".repeat(size),"activity":"started"}),
        ]));
    }
    rejected(wire(vec![
        json!({"kind":"subagentActivity","agentThreadId":"child",
        "agentPath":"p".repeat(4097),"activity":"started"}),
    ]));
    accepted(wire(vec![
        json!({"kind":"queued","threadId":"thread-1","clientUserMessageId":"client-1"}),
    ]));
    for id in [
        "x".to_string(),
        "client 1".to_string(),
        "-client1".to_string(),
        "x".repeat(129),
    ] {
        rejected(wire(vec![
            json!({"kind":"queued","threadId":"thread-1","clientUserMessageId":id}),
        ]));
    }
}

#[test]
fn nested_tool_identifiers_follow_the_same_strict_bounds_as_top_level_tools() {
    for kind in ["toolCall", "toolResult"] {
        let base = if kind == "toolCall" {
            json!({"kind":kind,"toolId":"tool-1","name":"read","inputSummary":"file","parentToolId":"parent-1"})
        } else {
            json!({"kind":kind,"toolId":"tool-1","outputSummary":"ok","isError":false,"parentToolId":"parent-1"})
        };
        for key in ["toolId", "parentToolId", "name"] {
            if key == "name" && kind == "toolResult" {
                continue;
            }
            for invalid in [String::new(), "id\nforeign".to_string(), "x".repeat(257)] {
                let mut inner = base.clone();
                inner[key] = json!(invalid);
                rejected(wire(vec![
                    json!({"kind":"subagentEvent","agentThreadId":"child","event":inner}),
                ]));
            }
        }
    }
}
