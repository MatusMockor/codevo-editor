use super::*;

const EVENT_KIND_FIXTURE: &str =
    include_str!("../../src/domain/fixtures/agent-turn-event-kinds.json");

const EXPECTED_EVENT_KINDS: [&str; 18] = [
    "assistantText",
    "backgroundTask",
    "contextCompaction",
    "contextCompactionStatus",
    "contextUsage",
    "error",
    "queued",
    "reasoning",
    "result",
    "subagent",
    "subagentActivity",
    "subagentEvent",
    "subagentTurnDone",
    "subagentUsage",
    "toolCall",
    "toolResult",
    "unknownLine",
    "userMessage",
];

fn turn_event_kind(event: &AgentTurnEvent) -> &'static str {
    match event {
        AgentTurnEvent::BackgroundTask { .. } => "backgroundTask",
        AgentTurnEvent::UserMessage { .. } => "userMessage",
        AgentTurnEvent::SubagentActivity { .. } => "subagentActivity",
        AgentTurnEvent::SubagentEvent { .. } => "subagentEvent",
        AgentTurnEvent::SubagentUsage { .. } => "subagentUsage",
        AgentTurnEvent::SubagentTurnDone { .. } => "subagentTurnDone",
        AgentTurnEvent::Queued { .. } => "queued",
        AgentTurnEvent::AssistantText { .. } => "assistantText",
        AgentTurnEvent::Reasoning { .. } => "reasoning",
        AgentTurnEvent::ToolCall { .. } => "toolCall",
        AgentTurnEvent::ToolResult { .. } => "toolResult",
        AgentTurnEvent::Subagent { .. } => "subagent",
        AgentTurnEvent::Result { .. } => "result",
        AgentTurnEvent::ContextCompaction { .. } => "contextCompaction",
        AgentTurnEvent::ContextCompactionStatus { .. } => "contextCompactionStatus",
        AgentTurnEvent::ContextUsage { .. } => "contextUsage",
        AgentTurnEvent::Error { .. } => "error",
        AgentTurnEvent::UnknownLine { .. } => "unknownLine",
    }
}

fn document_with_events(events: Vec<AgentTurnEvent>) -> AgentThreadDocument {
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.turns[0].events = events;
    document
}

fn background_task(
    task_id: &str,
    description: Option<&str>,
    status: AgentBackgroundTaskStatus,
    task_type: AgentBackgroundTaskType,
) -> AgentTurnEvent {
    AgentTurnEvent::BackgroundTask {
        task_id: task_id.to_string(),
        status,
        task_type,
        description: description.map(str::to_string),
    }
}

#[test]
fn background_task_events_round_trip_every_status_and_task_type() {
    let statuses = [
        (AgentBackgroundTaskStatus::Starting, "starting"),
        (AgentBackgroundTaskStatus::Running, "running"),
        (AgentBackgroundTaskStatus::Completed, "completed"),
        (AgentBackgroundTaskStatus::Failed, "failed"),
        (AgentBackgroundTaskStatus::Stopped, "stopped"),
    ];
    let task_types = [
        (AgentBackgroundTaskType::Monitor, "monitor"),
        (AgentBackgroundTaskType::Shell, "shell"),
        (AgentBackgroundTaskType::Agent, "agent"),
        (AgentBackgroundTaskType::Other, "other"),
    ];
    for (status, status_wire) in statuses {
        for (task_type, type_wire) in task_types {
            let document = document_with_events(vec![background_task(
                "bgt_01shell",
                Some("npm run dev"),
                status,
                task_type,
            )]);
            let encoded = serde_json::to_value(&document).expect("serialize background task");

            assert_eq!(
                encoded["thread"]["turns"][0]["events"][0],
                json!({
                    "kind": "backgroundTask",
                    "taskId": "bgt_01shell",
                    "status": status_wire,
                    "taskType": type_wire,
                    "description": "npm run dev",
                })
            );
            let decoded: AgentThreadDocument =
                serde_json::from_value(encoded).expect("deserialize background task");
            assert_eq!(decoded, document);
            validate_agent_thread_document(ROOT_KEY, &document)
                .expect("background task is within bounds");
        }
    }
}

#[test]
fn background_task_events_omit_an_absent_description_and_keep_it_optional() {
    let document = document_with_events(vec![background_task(
        "bgt_01monitor",
        None,
        AgentBackgroundTaskStatus::Starting,
        AgentBackgroundTaskType::Monitor,
    )]);
    let encoded = serde_json::to_value(&document).expect("serialize background task");

    assert_eq!(
        encoded["thread"]["turns"][0]["events"][0],
        json!({
            "kind": "backgroundTask",
            "taskId": "bgt_01monitor",
            "status": "starting",
            "taskType": "monitor",
        })
    );
    let decoded: AgentThreadDocument =
        serde_json::from_value(encoded).expect("deserialize background task");
    assert_eq!(decoded, document);
}

#[test]
fn background_task_events_fail_closed_on_unknown_variants_and_fields() {
    let base = json!({
        "kind": "backgroundTask",
        "taskId": "bgt_01shell",
        "status": "running",
        "taskType": "shell",
    });
    serde_json::from_value::<AgentTurnEvent>(base.clone()).expect("the base event is supported");

    let mut unknown_status = base.clone();
    unknown_status["status"] = json!("queued");
    let mut unknown_task_type = base.clone();
    unknown_task_type["taskType"] = json!("plan");
    let mut unknown_field = base.clone();
    unknown_field["extra"] = json!(true);
    let mut missing_task_type = base;
    missing_task_type
        .as_object_mut()
        .expect("event object")
        .remove("taskType");

    for event in [
        unknown_status,
        unknown_task_type,
        unknown_field,
        missing_task_type,
    ] {
        assert!(
            serde_json::from_value::<AgentTurnEvent>(event.clone()).is_err(),
            "{event}"
        );
    }
}

#[test]
fn background_task_events_reject_unbounded_ids_and_descriptions() {
    let oversize_id = "a".repeat(MAX_AGENT_TOOL_ID_BYTES + 1);
    let oversize_description = "a".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES + 1);
    let rejected = [
        background_task(
            "",
            None,
            AgentBackgroundTaskStatus::Running,
            AgentBackgroundTaskType::Shell,
        ),
        background_task(
            &oversize_id,
            None,
            AgentBackgroundTaskStatus::Running,
            AgentBackgroundTaskType::Shell,
        ),
        background_task(
            "bgt\u{7}bell",
            None,
            AgentBackgroundTaskStatus::Running,
            AgentBackgroundTaskType::Shell,
        ),
        background_task(
            "bgt_01shell",
            Some(&oversize_description),
            AgentBackgroundTaskStatus::Running,
            AgentBackgroundTaskType::Shell,
        ),
        background_task(
            "bgt_01shell",
            Some("before\u{0}after"),
            AgentBackgroundTaskStatus::Running,
            AgentBackgroundTaskType::Shell,
        ),
    ];
    for event in rejected {
        assert!(
            validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![event.clone()]))
                .is_err(),
            "{event:?}"
        );
    }

    let bounded = background_task(
        &"a".repeat(MAX_AGENT_TOOL_ID_BYTES),
        Some(&"a".repeat(MAX_AGENT_TOOL_SUMMARY_BYTES)),
        AgentBackgroundTaskStatus::Running,
        AgentBackgroundTaskType::Shell,
    );
    validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![bounded]))
        .expect("the exact byte bounds are accepted");
}

fn fixture_section(name: &str) -> Value {
    let fixture: Value =
        serde_json::from_str(EVENT_KIND_FIXTURE).expect("shared event kind fixture parses");
    fixture[name].clone()
}

fn decode_fixture_event(label: &str, value: &Value) -> AgentTurnEvent {
    let event: AgentTurnEvent = serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("{label} is missing from the Rust wire contract: {error}"));
    assert_eq!(
        &serde_json::to_value(&event).expect("re-encode fixture event"),
        value,
        "{label}"
    );
    event
}

#[test]
fn the_shared_event_kind_fixture_mirrors_every_typescript_turn_event() {
    let kinds = fixture_section("kinds");
    let kinds = kinds.as_object().expect("the kinds section is an object");
    let mut events = Vec::new();
    for (kind, value) in kinds {
        let event = decode_fixture_event(kind, value);

        assert_eq!(turn_event_kind(&event), kind.as_str());
        events.push(event);
    }

    let mut fixture_kinds: Vec<&str> = kinds.keys().map(String::as_str).collect();
    fixture_kinds.sort_unstable();
    assert_eq!(fixture_kinds, EXPECTED_EVENT_KINDS);
    validate_agent_thread_document(ROOT_KEY, &document_with_events(events))
        .expect("every fixture event is within bounds");
}

#[test]
fn the_shared_fixture_variants_round_trip_the_optional_field_shapes() {
    let variants = fixture_section("variants");
    let variants = variants
        .as_array()
        .expect("the variants section is an array");
    let mut events = Vec::new();
    for (index, value) in variants.iter().enumerate() {
        let event = decode_fixture_event(&format!("variants[{index}]"), value);

        assert_eq!(
            turn_event_kind(&event),
            value["kind"].as_str().expect("kind")
        );
        events.push(event);
    }

    assert!(!events.is_empty());
    validate_agent_thread_document(ROOT_KEY, &document_with_events(events))
        .expect("every fixture variant is within bounds");
}

#[test]
fn a_parent_tool_id_is_bounded_exactly_like_the_typescript_optional_tool_id() {
    let oversize = "a".repeat(MAX_AGENT_TOOL_ID_BYTES + 1);
    let rejected = [String::new(), oversize, "toolu\u{7}bell".to_string()];
    for parent_tool_id in rejected {
        let events = vec![
            AgentTurnEvent::AssistantText {
                text: "done".to_string(),
                parent_tool_id: Some(parent_tool_id.clone()),
            },
            AgentTurnEvent::ToolCall {
                tool_id: "toolu_01call".to_string(),
                name: "Bash".to_string(),
                input_summary: "ls -la".to_string(),
                description: None,
                parent_tool_id: Some(parent_tool_id.clone()),
            },
            AgentTurnEvent::ToolResult {
                tool_id: "toolu_01call".to_string(),
                output_summary: "3 entries".to_string(),
                is_error: false,
                parent_tool_id: Some(parent_tool_id.clone()),
            },
        ];
        for event in events {
            assert!(
                validate_agent_thread_document(
                    ROOT_KEY,
                    &document_with_events(vec![event.clone()])
                )
                .is_err(),
                "{event:?}"
            );
        }
    }

    let bounded = "a".repeat(MAX_AGENT_TOOL_ID_BYTES);
    let accepted = AgentTurnEvent::AssistantText {
        text: "done".to_string(),
        parent_tool_id: Some(bounded),
    };
    validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![accepted]))
        .expect("a parent tool id at the exact byte bound is accepted");
}

#[test]
fn a_tool_id_is_bounded_exactly_like_the_typescript_bounded_tool_id() {
    let oversize = "a".repeat(MAX_AGENT_TOOL_ID_BYTES + 1);
    let rejected = [String::new(), oversize, "toolu\u{7}bell".to_string()];
    for tool_id in rejected {
        let events = vec![
            AgentTurnEvent::ToolCall {
                tool_id: tool_id.clone(),
                name: "Bash".to_string(),
                input_summary: "ls -la".to_string(),
                description: None,
                parent_tool_id: None,
            },
            AgentTurnEvent::ToolResult {
                tool_id: tool_id.clone(),
                output_summary: "3 entries".to_string(),
                is_error: false,
                parent_tool_id: None,
            },
        ];
        for event in events {
            assert!(
                validate_agent_thread_document(
                    ROOT_KEY,
                    &document_with_events(vec![event.clone()])
                )
                .is_err(),
                "{event:?}"
            );
        }
    }

    let accepted = AgentTurnEvent::ToolResult {
        tool_id: "a".repeat(MAX_AGENT_TOOL_ID_BYTES),
        output_summary: "3 entries".to_string(),
        is_error: false,
        parent_tool_id: None,
    };
    validate_agent_thread_document(ROOT_KEY, &document_with_events(vec![accepted]))
        .expect("a tool id at the exact byte bound is accepted");
}
