use super::*;

fn accepted(value: Value) -> AgentTurnEvent {
    let event = serde_json::from_value(value).expect("valid event wire");
    validate_agent_turn_event(&event).expect("valid event semantics");
    event
}

fn rejected(value: Value) {
    if let Ok(event) = serde_json::from_value::<AgentTurnEvent>(value.clone()) {
        assert!(
            validate_agent_turn_event(&event).is_err(),
            "accepted {value}"
        );
    }
}

#[test]
fn context_events_round_trip_through_disk_alongside_legacy_events() {
    let temp = TempStore::create("context-events");
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    let wires = vec![
        json!({"kind":"assistantText","text":"legacy response"}),
        json!({"kind":"contextCompaction","beforeTokens":2000,"afterTokens":null}),
        json!({"kind":"contextCompactionStatus","status":"compacting","message":null}),
        json!({"kind":"contextCompactionStatus","status":"idle","message":"Finished"}),
        json!({"kind":"contextCompactionStatus","status":"failed","message":"Limit reached"}),
        json!({"kind":"contextUsage","model":"claude-sonnet","inputTokens":0,"contextWindow":200000}),
        json!({"kind":"contextUsage","model":"claude-opus","inputTokens":null,"contextWindow":null}),
    ];
    document.thread.turns[0].events = wires.iter().cloned().map(accepted).collect();
    temp.store().save(ROOT_KEY, &document).unwrap();
    let loaded = temp.store().load(ROOT_KEY).unwrap();
    assert_eq!(loaded.threads.len(), 1);
    assert_eq!(
        serde_json::to_value(&loaded.threads[0].turns[0].events).unwrap(),
        json!(wires)
    );
}

#[test]
fn context_events_reject_extra_missing_or_wrongly_typed_fields() {
    let usage =
        json!({"kind":"contextUsage","model":"claude","inputTokens":null,"contextWindow":null});
    let status = json!({"kind":"contextCompactionStatus","status":"idle","message":null});
    for valid in [usage, status] {
        for field in valid.as_object().unwrap().keys() {
            let mut missing = valid.clone();
            missing.as_object_mut().unwrap().remove(field);
            rejected(missing);
        }
        let mut extra = valid.clone();
        extra["extra"] = json!(true);
        rejected(extra);
    }
    for status in [json!("running"), json!("Idle"), json!(null), json!(1)] {
        rejected(json!({"kind":"contextCompactionStatus","status":status,"message":null}));
    }
    rejected(json!({"kind":"contextCompactionStatus","status":"idle","message":42}));
    rejected(
        json!({"kind":"contextCompactionStatus","status":"failed","message":"before\u{0}after"}),
    );
    for field in ["inputTokens", "contextWindow"] {
        for invalid in [
            json!(-1),
            json!(1.5),
            json!("1"),
            json!(true),
            json!(MAX_AGENT_SAFE_INTEGER + 1),
        ] {
            let mut value = json!({"kind":"contextUsage","model":"claude","inputTokens":null,"contextWindow":null});
            value[field] = invalid;
            rejected(value);
        }
    }
    rejected(json!({"kind":"contextUsage","model":"claude","inputTokens":null,"contextWindow":0}));
}

#[test]
fn context_events_enforce_utf8_byte_bounds_and_safe_integer_edges() {
    accepted(
        json!({"kind":"contextUsage","model":"é".repeat(128),"inputTokens":MAX_AGENT_SAFE_INTEGER,"contextWindow":MAX_AGENT_SAFE_INTEGER}),
    );
    for model in [
        "".to_string(),
        "é".repeat(129),
        "x".repeat(257),
        "claude\n".to_string(),
    ] {
        rejected(
            json!({"kind":"contextUsage","model":model,"inputTokens":null,"contextWindow":null}),
        );
    }
    accepted(
        json!({"kind":"contextCompactionStatus","status":"failed","message":"é".repeat(MAX_AGENT_EVENT_TEXT_BYTES / 2)}),
    );
    rejected(
        json!({"kind":"contextCompactionStatus","status":"failed","message":"é".repeat(MAX_AGENT_EVENT_TEXT_BYTES / 2 + 1)}),
    );
}

#[test]
fn context_observation_time_is_optional_strict_and_durable() {
    let base =
        json!({"kind":"contextUsage","model":"claude","inputTokens":100,"contextWindow":200000});
    assert_eq!(serde_json::to_value(accepted(base.clone())).unwrap(), base);
    for timestamp in [0, MAX_AGENT_SAFE_INTEGER] {
        let mut value = base.clone();
        value["observedAtEpochMs"] = json!(timestamp);
        let temp = TempStore::create("observed-context");
        let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
        document.thread.turns[0].events = vec![accepted(value.clone())];
        temp.store().save(ROOT_KEY, &document).unwrap();
        let loaded = temp.store().load(ROOT_KEY).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded.threads[0].turns[0].events[0]).unwrap(),
            value
        );
    }
    for invalid in [
        json!(null),
        json!(-1),
        json!(1.5),
        json!("1"),
        json!(true),
        json!(MAX_AGENT_SAFE_INTEGER + 1),
    ] {
        let mut value = base.clone();
        value["observedAtEpochMs"] = invalid;
        rejected(value);
    }
}
