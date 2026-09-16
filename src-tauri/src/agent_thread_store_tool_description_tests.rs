use super::*;

#[test]
fn a_tool_call_description_round_trips_and_stays_absent_when_unset() {
    let mut source = document_json();
    source["thread"]["owner"]["ownerId"] = json!(agent_root_owner_id("/workspace"));
    source["thread"]["turns"][0]["events"] = json!([
        {
            "kind": "toolCall",
            "toolId": "t1",
            "name": "Bash",
            "inputSummary": "npm run lint",
            "description": "Run the linter"
        },
        { "kind": "toolCall", "toolId": "t2", "name": "Read", "inputSummary": "/repo/a.ts" }
    ]);
    let document: AgentThreadDocument =
        serde_json::from_value(source.clone()).expect("described tool call loads");

    assert_eq!(
        document.thread.turns[0].events[0],
        AgentTurnEvent::ToolCall {
            tool_id: "t1".to_string(),
            name: "Bash".to_string(),
            input_summary: "npm run lint".to_string(),
            description: Some("Run the linter".to_string()),
            parent_tool_id: None,
        }
    );
    assert_eq!(
        document.thread.turns[0].events[1],
        AgentTurnEvent::ToolCall {
            tool_id: "t2".to_string(),
            name: "Read".to_string(),
            input_summary: "/repo/a.ts".to_string(),
            description: None,
            parent_tool_id: None,
        }
    );
    assert_eq!(
        serde_json::to_value(&document).expect("serialize described document"),
        source
    );
    validate_agent_thread_document("/workspace", &document)
        .expect("a bounded description is accepted");
}

#[test]
fn an_unbounded_or_control_bearing_tool_call_description_is_refused() {
    let base = {
        let mut source = document_json();
        source["thread"]["owner"]["ownerId"] = json!(agent_root_owner_id("/workspace"));
        source
    };
    for description in [
        String::new(),
        "a".repeat(MAX_AGENT_TOOL_DESCRIPTION_BYTES + 1),
        "before\u{0}after".to_string(),
        "line\nbreak".to_string(),
    ] {
        let mut source = base.clone();
        source["thread"]["turns"][0]["events"] = json!([
            {
                "kind": "toolCall",
                "toolId": "t1",
                "name": "Bash",
                "inputSummary": "ls",
                "description": description
            }
        ]);
        let document: AgentThreadDocument =
            serde_json::from_value(source).expect("document shape still loads");
        assert!(
            validate_agent_thread_document("/workspace", &document).is_err(),
            "expected {description:?} to be refused"
        );
    }
}
