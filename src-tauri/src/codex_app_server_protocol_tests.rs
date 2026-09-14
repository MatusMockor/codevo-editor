use super::*;
use serde_json::json;
use std::path::PathBuf;

const PROJECTED_THREAD_ITEM_TAGS: &[&str] = &[
    "agentMessage",
    "commandExecution",
    "contextCompaction",
    "fileChange",
    "mcpToolCall",
    "reasoning",
    "subAgentActivity",
    "userMessage",
    "webSearch",
];

const PROJECTED_USER_INPUT_TAGS: &[&str] = &["localImage", "text"];

const HANDLED_NOTIFICATION_METHODS: &[&str] = &[
    "error",
    "item/completed",
    "item/started",
    "thread/compacted",
    "thread/queue/changed",
    "thread/started",
    "thread/tokenUsage/updated",
    "turn/completed",
    "turn/started",
];

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("codex_app_server")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("fixture {} must be readable: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("fixture {} must be json: {error}", path.display()))
}

fn fixture_strings(name: &str, key: &str) -> Vec<String> {
    let document = fixture(name);
    let entries = document
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("fixture {name} must expose the array `{key}`"));
    entries
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .unwrap_or_else(|| panic!("fixture {name} must list strings under `{key}`"))
                .to_string()
        })
        .collect()
}

fn merged(base: Value, extra: Value) -> Value {
    let mut object = base.as_object().expect("base must be an object").clone();
    for (key, value) in extra.as_object().expect("extra must be an object") {
        object.insert(key.clone(), value.clone());
    }
    Value::Object(object)
}

fn minimal_thread_item(tag: &str) -> Value {
    let extra = match tag {
        "userMessage" => json!({
            "clientId": "steer-1",
            "content": [{ "type": "text", "text": "do it" }]
        }),
        "agentMessage" => json!({ "text": "hello" }),
        "reasoning" => json!({ "content": ["thought"], "summary": ["summary"] }),
        "commandExecution" => json!({
            "status": "completed",
            "command": "ls -la",
            "commandActions": [],
            "cwd": "/repo",
            "exitCode": 0,
            "durationMs": 12,
            "aggregatedOutput": "out"
        }),
        "fileChange" => json!({
            "status": "completed",
            "changes": [{ "path": "src/lib.rs", "diff": "@@", "kind": { "type": "update" } }]
        }),
        "mcpToolCall" => json!({
            "status": "failed",
            "server": "docs",
            "tool": "search",
            "arguments": null,
            "error": { "message": "boom" }
        }),
        "webSearch" => json!({ "query": "rust serde" }),
        "subAgentActivity" => json!({
            "kind": "started",
            "agentThreadId": "thread-child",
            "agentPath": "agents/reviewer.md"
        }),
        _ => json!({}),
    };
    merged(json!({ "type": tag, "id": "item-1" }), extra)
}

fn sample_turn_start_params() -> TurnStartParams {
    TurnStartParams {
        thread_id: "thread-1".to_string(),
        input: vec![
            UserInput::Text {
                text: "do it".to_string(),
            },
            UserInput::LocalImage {
                path: "/repo/shot.png".to_string(),
            },
        ],
        cwd: Some("/repo".to_string()),
        model: Some("gpt-5.6".to_string()),
        approval_policy: Some(ApprovalPolicy::Never),
        sandbox_policy: Some(SandboxPolicy::WorkspaceWrite {
            network_access: false,
            writable_roots: vec!["/repo".to_string()],
        }),
        effort: Some("high".to_string()),
        client_user_message_id: Some("steer-1".to_string()),
        turn_trigger: Some("user".to_string()),
    }
}

fn round_trip<T>(value: &T)
where
    T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
{
    let encoded = serde_json::to_value(value).expect("client params must serialize");
    let decoded: T = serde_json::from_value(encoded).expect("client params must round-trip");
    assert_eq!(&decoded, value);
}

fn reject_unknown_field<T>(mut params: Value)
where
    T: DeserializeOwned,
{
    let object = params.as_object_mut().expect("params must be an object");
    object.insert("surpriseField".to_string(), json!(true));
    assert!(serde_json::from_value::<T>(params).is_err());
}

#[test]
fn every_schema_thread_item_tag_decodes_to_a_variant_or_is_ignored() {
    let tags = fixture_strings("thread_item.schema.json", "tags");
    assert_eq!(
        tags.len(),
        PROJECTED_THREAD_ITEM_TAGS.len() + IGNORED_THREAD_ITEM_TAGS.len()
    );
    for tag in &tags {
        let decoded: ThreadItem = serde_json::from_value(minimal_thread_item(tag))
            .unwrap_or_else(|error| panic!("thread item `{tag}` must decode: {error}"));
        let projected = PROJECTED_THREAD_ITEM_TAGS.contains(&tag.as_str());
        let ignored = IGNORED_THREAD_ITEM_TAGS.contains(&tag.as_str());
        assert!(projected != ignored, "`{tag}` must be projected or ignored");
        match decoded {
            ThreadItem::Ignored { tag: decoded_tag } => {
                assert_eq!(&decoded_tag, tag);
                assert!(ignored);
            }
            ThreadItem::Unrecognized { tag: decoded_tag } => {
                panic!("schema tag `{decoded_tag}` must not be unrecognized")
            }
            _ => assert!(projected, "`{tag}` must decode into its own variant"),
        }
    }
    for tag in PROJECTED_THREAD_ITEM_TAGS
        .iter()
        .chain(IGNORED_THREAD_ITEM_TAGS)
    {
        assert!(
            tags.iter().any(|schema_tag| schema_tag == tag),
            "`{tag}` disappeared from the app-server schema"
        );
    }
}

#[test]
fn an_unlisted_thread_item_tag_is_unrecognized() {
    let decoded: ThreadItem =
        serde_json::from_value(json!({ "type": "telepathy", "id": "item-1" })).expect("decodes");
    assert_eq!(
        decoded,
        ThreadItem::Unrecognized {
            tag: "telepathy".to_string()
        }
    );
}

#[test]
fn the_ignored_thread_item_table_is_sorted_for_binary_search() {
    let mut sorted = IGNORED_THREAD_ITEM_TAGS.to_vec();
    sorted.sort_unstable();
    assert_eq!(sorted.as_slice(), IGNORED_THREAD_ITEM_TAGS);
}

#[test]
fn a_user_message_item_carries_its_client_id() {
    let decoded: ThreadItem =
        serde_json::from_value(minimal_thread_item("userMessage")).expect("user message decodes");
    assert_eq!(
        decoded,
        ThreadItem::UserMessage {
            id: "item-1".to_string(),
            client_id: Some("steer-1".to_string())
        }
    );

    let without: ThreadItem =
        serde_json::from_value(json!({ "type": "userMessage", "id": "item-2", "content": [] }))
            .expect("user message decodes");
    assert_eq!(
        without,
        ThreadItem::UserMessage {
            id: "item-2".to_string(),
            client_id: None
        }
    );
}

#[test]
fn a_context_compaction_item_decodes_as_its_own_variant() {
    let decoded: ThreadItem = serde_json::from_value(minimal_thread_item("contextCompaction"))
        .expect("context compaction decodes");
    assert_eq!(
        decoded,
        ThreadItem::ContextCompaction {
            id: "item-1".to_string()
        }
    );
}

#[test]
fn every_schema_user_input_tag_decodes_to_a_variant_or_unrecognized() {
    let tags = fixture_strings("user_input.schema.json", "tags");
    for tag in &tags {
        let payload = merged(
            json!({ "type": tag }),
            json!({ "text": "hi", "path": "/repo/a.png", "url": "https://x", "name": "n" }),
        );
        let decoded: UserInput = serde_json::from_value(payload)
            .unwrap_or_else(|error| panic!("user input `{tag}` must decode: {error}"));
        let projected = PROJECTED_USER_INPUT_TAGS.contains(&tag.as_str());
        match decoded {
            UserInput::Unrecognized { tag: decoded_tag } => {
                assert_eq!(&decoded_tag, tag);
                assert!(!projected);
            }
            _ => assert!(projected),
        }
    }
}

#[test]
fn every_schema_string_union_value_decodes_to_a_named_variant() {
    let unions = fixture("string_unions.schema.json");
    for value in fixture_strings("string_unions.schema.json", "CommandExecutionStatus") {
        let decoded: CommandExecutionStatus =
            serde_json::from_value(json!(value)).expect("decodes");
        assert!(!matches!(
            decoded,
            CommandExecutionStatus::Unrecognized { .. }
        ));
    }
    for value in fixture_strings("string_unions.schema.json", "PatchApplyStatus") {
        let decoded: PatchApplyStatus = serde_json::from_value(json!(value)).expect("decodes");
        assert!(!matches!(decoded, PatchApplyStatus::Unrecognized { .. }));
    }
    for value in fixture_strings("string_unions.schema.json", "McpToolCallStatus") {
        let decoded: McpToolCallStatus = serde_json::from_value(json!(value)).expect("decodes");
        assert!(!matches!(decoded, McpToolCallStatus::Unrecognized { .. }));
    }
    for value in fixture_strings("string_unions.schema.json", "SubAgentActivityKind") {
        let decoded: SubAgentActivityKind = serde_json::from_value(json!(value)).expect("decodes");
        assert!(!matches!(
            decoded,
            SubAgentActivityKind::Unrecognized { .. }
        ));
    }
    for value in fixture_strings("string_unions.schema.json", "TurnStatus") {
        let decoded: TurnStatus = serde_json::from_value(json!(value)).expect("decodes");
        assert!(!matches!(decoded, TurnStatus::Unrecognized { .. }));
    }
    assert!(unions.get("TurnStatus").is_some());
}

#[test]
fn unknown_string_union_values_become_unrecognized() {
    let decoded: CommandExecutionStatus =
        serde_json::from_value(json!("quantumTunnelled")).expect("decodes");
    assert_eq!(
        decoded,
        CommandExecutionStatus::Unrecognized {
            tag: "quantumTunnelled".to_string()
        }
    );
}

#[test]
fn every_schema_thread_status_tag_decodes_to_a_named_variant() {
    for tag in fixture_strings("thread_status.schema.json", "tags") {
        let decoded: ThreadStatus =
            serde_json::from_value(json!({ "type": tag, "activeFlags": ["waitingOnApproval"] }))
                .expect("thread status decodes");
        assert!(!matches!(decoded, ThreadStatus::Unrecognized { .. }));
    }
    let decoded: ThreadStatus =
        serde_json::from_value(json!({ "type": "hibernating" })).expect("decodes");
    assert_eq!(
        decoded,
        ThreadStatus::Unrecognized {
            tag: "hibernating".to_string()
        }
    );
}

#[test]
fn every_schema_patch_change_kind_decodes_to_a_named_variant() {
    for tag in fixture_strings("patch_change_kind.schema.json", "tags") {
        let decoded: PatchChangeKind =
            serde_json::from_value(json!({ "type": tag, "move_path": null })).expect("decodes");
        assert!(!matches!(decoded, PatchChangeKind::Unrecognized { .. }));
    }
}

#[test]
fn a_tagged_object_without_a_type_is_rejected() {
    assert!(serde_json::from_value::<ThreadItem>(json!({ "id": "item-1" })).is_err());
    assert!(serde_json::from_value::<UserInput>(json!({ "text": "hi" })).is_err());
}

#[test]
fn server_payloads_decode_with_unknown_fields() {
    let started = classify_notification(
        "thread/started",
        json!({
            "thread": {
                "id": "thread-1",
                "parentThreadId": null,
                "status": { "type": "idle" },
                "environments": [{ "environmentId": "local" }],
                "extra": null,
                "sessionId": "thread-1",
                "forkedFromId": null,
                "preview": "",
                "ephemeral": false,
                "section": null,
                "sectionEnteredAt": null,
                "projectId": null,
                "historyMode": "paginated",
                "modelProvider": "openai",
                "turns": [],
                "cwd": "/repo",
                "createdAt": 1,
                "updatedAt": 2,
                "cliVersion": "0.154.0",
                "source": "appServer"
            },
            "futureField": { "nested": true }
        }),
    );
    let ServerNotification::ThreadStarted(payload) = started else {
        panic!("thread/started must classify");
    };
    assert_eq!(payload.thread.id, "thread-1");
    assert_eq!(payload.thread.status, Some(ThreadStatus::Idle));

    let completed = classify_notification(
        "item/completed",
        json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "completedAtMs": 5,
            "item": {
                "type": "commandExecution",
                "id": "item-1",
                "status": "completed",
                "command": "ls",
                "commandActions": [],
                "cwd": "/repo",
                "exitCode": 0,
                "processId": "pty-1",
                "pluginId": null,
                "scriptPath": null,
                "source": "agent",
                "brandNewField": 7
            }
        }),
    );
    let ServerNotification::ItemCompleted(payload) = completed else {
        panic!("item/completed must classify");
    };
    let ThreadItem::CommandExecution(command) = payload.item else {
        panic!("commandExecution must decode");
    };
    assert_eq!(command.status, CommandExecutionStatus::Completed);
    assert_eq!(command.exit_code, Some(0));
}

#[test]
fn undecodable_known_notification_params_become_unknown() {
    let classified = classify_notification("turn/completed", json!({ "threadId": "thread-1" }));
    assert_eq!(
        classified,
        ServerNotification::Unknown {
            method: "turn/completed".to_string()
        }
    );
}

#[test]
fn thread_queue_changed_classifies() {
    let classified = classify_notification("thread/queue/changed", json!({ "threadId": "t-1" }));
    assert_eq!(
        classified,
        ServerNotification::ThreadQueueChanged {
            thread_id: "t-1".to_string()
        }
    );
}

#[test]
fn every_schema_notification_method_is_handled_or_ignored() {
    for method in fixture_strings("server_notification_methods.schema.json", "methods") {
        let classified = classify_notification(method.as_str(), Value::Null);
        let handled = HANDLED_NOTIFICATION_METHODS.contains(&method.as_str());
        match classified {
            ServerNotification::Ignored { method: ignored } => {
                assert_eq!(ignored, method);
                assert!(!handled, "`{method}` must not be ignored");
            }
            ServerNotification::Unknown { method: unknown } => {
                assert_eq!(unknown, method);
                assert!(handled, "`{method}` must be ignored or handled");
            }
            _ => assert!(handled),
        }
    }
}

#[test]
fn an_unlisted_notification_method_is_unknown() {
    assert_eq!(
        classify_notification("thread/telepathy/updated", Value::Null),
        ServerNotification::Unknown {
            method: "thread/telepathy/updated".to_string()
        }
    );
}

#[test]
fn the_ignored_notification_table_is_sorted_for_binary_search() {
    let mut sorted = IGNORED_NOTIFICATION_METHODS.to_vec();
    sorted.sort_unstable();
    assert_eq!(sorted.as_slice(), IGNORED_NOTIFICATION_METHODS);
}

#[test]
fn a_notification_method_is_bounded() {
    let method = "thread/".to_string() + &"x".repeat(MAX_PROTOCOL_METHOD_BYTES * 2);
    let ServerNotification::Unknown { method: bounded } =
        classify_notification(method.as_str(), Value::Null)
    else {
        panic!("an overlong method must be unknown");
    };
    assert_eq!(bounded.len(), MAX_PROTOCOL_METHOD_BYTES);
}

#[test]
fn client_params_reject_unknown_fields() {
    reject_unknown_field::<InitializeParams>(json!({
        "clientInfo": { "name": "codevo", "version": "1" }
    }));
    reject_unknown_field::<ThreadStartParams>(json!({ "cwd": "/repo" }));
    reject_unknown_field::<ThreadResumeParams>(json!({
        "threadId": "thread-1",
        "excludeTurns": true
    }));
    reject_unknown_field::<TurnStartParams>(json!({ "threadId": "thread-1", "input": [] }));
    reject_unknown_field::<TurnSteerParams>(json!({
        "threadId": "thread-1",
        "expectedTurnId": "turn-1",
        "input": []
    }));
    reject_unknown_field::<TurnInterruptParams>(json!({
        "threadId": "thread-1",
        "turnId": "turn-1"
    }));
    reject_unknown_field::<ThreadUnsubscribeParams>(json!({ "threadId": "thread-1" }));
    reject_unknown_field::<ThreadBackgroundTerminalsCleanParams>(json!({ "threadId": "thread-1" }));
    reject_unknown_field::<ThreadBackgroundTerminalsListParams>(
        json!({ "threadId": "thread-1", "limit": 1 }),
    );
}

#[test]
fn client_params_round_trip() {
    round_trip(&InitializeParams {
        client_info: ClientInfo {
            name: "codevo".to_string(),
            version: "0.2.0".to_string(),
            title: Some("Codevo Editor".to_string()),
        },
        capabilities: Some(InitializeCapabilities {
            experimental_api: true,
        }),
    });
    round_trip(&ThreadStartParams {
        cwd: Some("/repo".to_string()),
        model: Some("gpt-5.6".to_string()),
        sandbox: Some(SandboxMode::WorkspaceWrite),
        approval_policy: Some(ApprovalPolicy::Never),
    });
    round_trip(&ThreadResumeParams {
        thread_id: "thread-1".to_string(),
        cwd: Some("/repo".to_string()),
        model: None,
        sandbox: Some(SandboxMode::ReadOnly),
        approval_policy: Some(ApprovalPolicy::Never),
        exclude_turns: true,
    });
    round_trip(&sample_turn_start_params());
    round_trip(&TurnSteerParams {
        thread_id: "thread-1".to_string(),
        expected_turn_id: "turn-1".to_string(),
        input: vec![UserInput::Text {
            text: "also fix the test".to_string(),
        }],
        client_user_message_id: Some("steer-1".to_string()),
    });
    round_trip(&TurnInterruptParams {
        thread_id: "thread-1".to_string(),
        turn_id: "turn-1".to_string(),
    });
    round_trip(&ThreadUnsubscribeParams {
        thread_id: "thread-1".to_string(),
    });
}

#[test]
fn client_params_use_the_app_server_wire_names() {
    let encoded = serde_json::to_value(sample_turn_start_params()).expect("serializes");
    assert_eq!(encoded["threadId"], json!("thread-1"));
    assert_eq!(encoded["clientUserMessageId"], json!("steer-1"));
    assert_eq!(encoded["turnTrigger"], json!("user"));
    assert_eq!(encoded["sandboxPolicy"]["type"], json!("workspaceWrite"));
    assert_eq!(
        encoded["sandboxPolicy"],
        json!({
            "type": "workspaceWrite",
            "networkAccess": false,
            "writableRoots": ["/repo"]
        })
    );
    assert_eq!(encoded["approvalPolicy"], json!("never"));
    assert_eq!(
        encoded["input"][0],
        json!({ "type": "text", "text": "do it" })
    );
    assert_eq!(
        encoded["input"][1],
        json!({ "type": "localImage", "path": "/repo/shot.png" })
    );

    let start = serde_json::to_value(ThreadStartParams {
        cwd: Some("/repo".to_string()),
        model: None,
        sandbox: Some(SandboxMode::DangerFullAccess),
        approval_policy: Some(ApprovalPolicy::OnRequest),
    })
    .expect("serializes");
    assert_eq!(start["sandbox"], json!("danger-full-access"));
    assert_eq!(start["approvalPolicy"], json!("on-request"));
    assert!(start.get("model").is_none());
}

#[test]
fn a_request_carries_the_jsonrpc_version_and_wire_method() {
    let encoded = serde_json::to_value(JsonRpcRequest {
        id: 7,
        method: ClientMethod::TurnSteer,
        params: json!({ "threadId": "thread-1" }),
    })
    .expect("serializes");
    assert_eq!(
        encoded,
        json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "turn/steer",
            "params": { "threadId": "thread-1" }
        })
    );

    let notification = serde_json::to_value(JsonRpcClientNotification {
        method: ClientNotificationMethod::Initialized,
        params: json!({}),
    })
    .expect("serializes");
    assert_eq!(
        notification,
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
    );
}

#[test]
fn every_client_method_has_a_distinct_wire_method() {
    let methods = [
        ClientMethod::Initialize,
        ClientMethod::ThreadStart,
        ClientMethod::ThreadResume,
        ClientMethod::TurnStart,
        ClientMethod::TurnSteer,
        ClientMethod::TurnInterrupt,
        ClientMethod::ThreadUnsubscribe,
        ClientMethod::ThreadBackgroundTerminalsClean,
        ClientMethod::ThreadBackgroundTerminalsList,
    ];
    let mut wire: Vec<&str> = methods.iter().map(|method| method.wire_method()).collect();
    wire.sort_unstable();
    wire.dedup();
    assert_eq!(wire.len(), methods.len());
    assert!(wire.contains(&"turn/steer"));
}

#[test]
fn incoming_envelopes_classify() {
    let response: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":1,"result":{"turnId":"turn-1"}}"#).expect("response decodes");
    assert_eq!(
        response,
        JsonRpcIncoming::Response {
            id: RequestId::Number(1),
            result: json!({ "turnId": "turn-1" })
        }
    );

    let failure: JsonRpcIncoming = serde_json::from_str(
        r#"{"error":{"code":-32600,"message":"no active turn to steer"},"id":3}"#,
    )
    .expect("error decodes");
    let JsonRpcIncoming::Error { id, error } = failure else {
        panic!("an error envelope must classify");
    };
    assert_eq!(id, RequestId::Number(3));
    assert_eq!(id.correlated(), Some(3));
    assert_eq!(error.code, -32600);

    let notification: JsonRpcIncoming = serde_json::from_str(
        r#"{"method":"thread/queue/changed","params":{"threadId":"t"},"emittedAtMs":17}"#,
    )
    .expect("notification decodes");
    assert_eq!(
        notification,
        JsonRpcIncoming::Notification {
            method: "thread/queue/changed".to_string(),
            params: json!({ "threadId": "t" })
        }
    );

    let request: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":"srv-1","method":"applyPatchApproval","params":{}}"#)
            .expect("server request decodes");
    assert_eq!(
        request,
        JsonRpcIncoming::ServerRequest {
            id: json!("srv-1"),
            method: "applyPatchApproval".to_string(),
            params: json!({})
        }
    );
}

#[test]
fn an_envelope_may_omit_the_jsonrpc_field_but_never_change_its_version() {
    let accepted: Result<JsonRpcIncoming, _> =
        serde_json::from_str(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
    assert!(accepted.is_ok());

    let foreign: Result<JsonRpcIncoming, _> =
        serde_json::from_str(r#"{"jsonrpc":"1.0","id":1,"result":{}}"#);
    assert!(foreign.is_err());
}

#[test]
fn a_malformed_envelope_is_rejected() {
    assert!(serde_json::from_str::<JsonRpcIncoming>(r#"{}"#).is_err());
    assert!(serde_json::from_str::<JsonRpcIncoming>(r#"{"id":1}"#).is_err());
    assert!(serde_json::from_str::<JsonRpcIncoming>(r#"{"result":{}}"#).is_err());
    assert!(
        serde_json::from_str::<JsonRpcIncoming>(r#"{"id":1,"result":{},"surprise":true}"#).is_err()
    );
    assert!(serde_json::from_str::<JsonRpcIncoming>(
        r#"{"id":1,"result":{},"error":{"code":1,"message":"m"}}"#
    )
    .is_err());
}

#[test]
fn a_foreign_response_id_is_discardable_not_fatal() {
    let text: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":"srv-9","result":{}}"#).expect("a string id decodes");
    let JsonRpcIncoming::Response { id, .. } = text else {
        panic!("a string id must still be a response");
    };
    assert_eq!(id, RequestId::String("srv-9".to_string()));
    assert_eq!(id.correlated(), None);

    let negative: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":-1,"result":{}}"#).expect("a negative id decodes");
    let JsonRpcIncoming::Response { id, .. } = negative else {
        panic!("a negative id must still be a response");
    };
    assert_eq!(id, RequestId::Other("-1".to_string()));
    assert_eq!(id.correlated(), None);

    let foreign_error: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":"srv-9","error":{"code":1,"message":"m"}}"#)
            .expect("a string id decodes");
    let JsonRpcIncoming::Error { id, .. } = foreign_error else {
        panic!("a string id must still be an error");
    };
    assert_eq!(id.correlated(), None);
}

#[test]
fn a_null_result_is_a_response_not_a_malformed_envelope() {
    let response: JsonRpcIncoming =
        serde_json::from_str(r#"{"id":5,"result":null}"#).expect("a null result decodes");
    assert_eq!(
        response,
        JsonRpcIncoming::Response {
            id: RequestId::Number(5),
            result: Value::Null
        }
    );
}

#[test]
fn a_request_id_is_bounded() {
    let id = "x".repeat(MAX_PROTOCOL_ID_BYTES * 2);
    let frame = format!(r#"{{"id":"{id}","result":{{}}}}"#);
    let response: JsonRpcIncoming = serde_json::from_str(&frame).expect("decodes");
    let JsonRpcIncoming::Response { id, .. } = response else {
        panic!("an overlong id must still be a response");
    };
    assert_eq!(id, RequestId::String("x".repeat(MAX_PROTOCOL_ID_BYTES)));
}

#[test]
fn active_turn_not_steerable_classifies() {
    let direct = JsonRpcError {
        code: -32600,
        message: "cannot steer a review turn".to_string(),
        data: Some(json!({ "activeTurnNotSteerable": { "turnKind": "review" } })),
    };
    assert_eq!(
        classify_error(&direct),
        CodexRpcErrorKind::ActiveTurnNotSteerable
    );

    let nested = JsonRpcError {
        code: -32600,
        message: "cannot steer a compact turn".to_string(),
        data: Some(json!({
            "message": "cannot steer a compact turn",
            "codexErrorInfo": { "activeTurnNotSteerable": { "turnKind": "compact" } }
        })),
    };
    assert_eq!(
        classify_error(&nested),
        CodexRpcErrorKind::ActiveTurnNotSteerable
    );

    let other = JsonRpcError {
        code: -32600,
        message: "no active turn to steer".to_string(),
        data: None,
    };
    assert_eq!(classify_error(&other), CodexRpcErrorKind::Other);

    let unrelated = JsonRpcError {
        code: -32603,
        message: "internal".to_string(),
        data: Some(json!({ "codexErrorInfo": "internalServerError" })),
    };
    assert_eq!(classify_error(&unrelated), CodexRpcErrorKind::Other);
}

#[test]
fn token_usage_decodes_with_missing_and_unknown_fields() {
    let usage = classify_notification(
        "thread/tokenUsage/updated",
        json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "tokenUsage": {
                "last": { "inputTokens": 10, "cachedInputTokens": 2, "reasoningOutputTokens": 3 },
                "total": { "totalTokens": 99, "brandNew": 1 },
                "modelContextWindow": 272000
            }
        }),
    );
    let ServerNotification::ThreadTokenUsageUpdated(payload) = usage else {
        panic!("token usage must classify");
    };
    let usage = payload.token_usage.expect("token usage is present");
    let last = usage.last.expect("last usage is present");
    assert_eq!(last.input_tokens, Some(10));
    assert_eq!(last.output_tokens, None);
    let total = usage.total.expect("total usage is present");
    assert_eq!(total.total_tokens, Some(99));
    assert_eq!(usage.model_context_window, Some(272000));
}

#[test]
fn a_missing_token_usage_is_unknown_rather_than_zero() {
    let usage = classify_notification(
        "thread/tokenUsage/updated",
        json!({ "threadId": "thread-1", "turnId": "turn-1" }),
    );
    let ServerNotification::ThreadTokenUsageUpdated(payload) = usage else {
        panic!("token usage must classify");
    };
    assert_eq!(payload.token_usage, None);
}

#[test]
fn unrecognized_user_input_never_serializes() {
    let encoded = serde_json::to_value(UserInput::Unrecognized {
        tag: "skill".to_string(),
    });
    assert!(encoded.is_err());

    let inside_params = serde_json::to_value(TurnSteerParams {
        thread_id: "thread-1".to_string(),
        expected_turn_id: "turn-1".to_string(),
        input: vec![UserInput::Unrecognized {
            tag: "skill".to_string(),
        }],
        client_user_message_id: None,
    });
    assert!(inside_params.is_err());
}

#[test]
fn protocol_tags_are_bounded() {
    let tag = "x".repeat(MAX_PROTOCOL_TAG_BYTES * 3);
    let decoded: ThreadItem =
        serde_json::from_value(json!({ "type": tag, "id": "item-1" })).expect("decodes");
    let ThreadItem::Unrecognized { tag: bounded } = decoded else {
        panic!("an overlong tag must be unrecognized");
    };
    assert_eq!(bounded.len(), MAX_PROTOCOL_TAG_BYTES);
}

#[test]
fn malformed_non_steerable_errors_never_select_the_queued_fallback() {
    for payload in [
        Value::Null,
        json!(false),
        json!({}),
        json!({"turnKind": "future"}),
    ] {
        for data in [
            json!({"activeTurnNotSteerable": payload}),
            json!({"codexErrorInfo": {"activeTurnNotSteerable": payload}}),
        ] {
            let error = JsonRpcError {
                code: -32600,
                message: "cannot steer".to_string(),
                data: Some(data),
            };
            assert_eq!(classify_error(&error), CodexRpcErrorKind::Other);
        }
    }
}

fn assert_object_keys_match_generated_schema(encoded: &Value, schema: &Value) {
    let object = encoded.as_object().expect("serialized object");
    let properties = schema["properties"]
        .as_object()
        .expect("generated properties");
    for key in object.keys() {
        assert!(
            properties.contains_key(key),
            "outbound field {key} missing in CLI schema"
        );
    }
    for key in schema["required"]
        .as_array()
        .expect("generated required fields")
    {
        let key = key.as_str().expect("field name");
        assert!(object.contains_key(key), "required CLI field {key} missing");
    }
}

#[test]
fn outbound_turn_shapes_match_installed_cli_generated_schema() {
    let start_schema = fixture("turn_start_params.schema.json");
    let start = serde_json::to_value(sample_turn_start_params()).expect("serializes");
    assert_object_keys_match_generated_schema(&start, &start_schema);
    let steer_schema = fixture("turn_steer_params.schema.json");
    let steer = serde_json::to_value(TurnSteerParams {
        thread_id: "thread-1".to_string(),
        expected_turn_id: "turn-1".to_string(),
        input: sample_turn_start_params().input,
        client_user_message_id: Some("client-1".to_string()),
    })
    .expect("serializes");
    assert_object_keys_match_generated_schema(&steer, &steer_schema);
    for (value, union) in start["input"]
        .as_array()
        .expect("inputs")
        .iter()
        .map(|input| (input, "UserInput"))
        .chain(std::iter::once((&start["sandboxPolicy"], "SandboxPolicy")))
    {
        let variant = start_schema["definitions"][union]["oneOf"]
            .as_array()
            .expect("generated variants")
            .iter()
            .find(|variant| variant["properties"]["type"]["enum"][0] == value["type"])
            .expect("serialized variant exists in CLI schema");
        assert_object_keys_match_generated_schema(value, variant);
    }
}

#[test]
fn background_terminal_cleanup_uses_exact_thread_scoped_wire_contracts() {
    let clean = ThreadBackgroundTerminalsCleanParams {
        thread_id: "owned-thread".into(),
    };
    let list = ThreadBackgroundTerminalsListParams {
        thread_id: "owned-thread".into(),
        limit: 1,
    };
    round_trip(&clean);
    round_trip(&list);
    assert_eq!(
        serde_json::to_value(clean).unwrap(),
        json!({"threadId":"owned-thread"})
    );
    assert_eq!(
        serde_json::to_value(list).unwrap(),
        json!({"threadId":"owned-thread","limit":1})
    );
    assert_eq!(
        ClientMethod::ThreadBackgroundTerminalsClean.wire_method(),
        "thread/backgroundTerminals/clean"
    );
    assert_eq!(
        ClientMethod::ThreadBackgroundTerminalsList.wire_method(),
        "thread/backgroundTerminals/list"
    );
    assert_eq!(
        serde_json::to_value(InitializeCapabilities {
            experimental_api: true
        })
        .unwrap(),
        json!({"experimentalApi":true})
    );
}
