use super::*;

#[test]
fn debug_launch_target_serializes_with_kebab_case_kinds() {
    let attach = DebugLaunchTarget::NodeAttach { port: 9229 };
    let node = DebugLaunchTarget::NodeScript {
        script_path: "/workspace/one/index.js".to_string(),
    };
    let test_file = DebugLaunchTarget::JsTestFile {
        runner: "vitest".to_string(),
        file_path: "/workspace/one/src/app.test.ts".to_string(),
        package_root_path: "/workspace/one".to_string(),
    };

    assert_eq!(
        serde_json::to_value(&attach).expect("serialize attach target"),
        serde_json::json!({"kind": "node-attach", "port": 9229})
    );
    assert_eq!(
        serde_json::to_value(&node).expect("serialize node target"),
        serde_json::json!({"kind": "node-script", "scriptPath": "/workspace/one/index.js"})
    );
    assert_eq!(
        serde_json::to_value(&test_file).expect("serialize test target"),
        serde_json::json!({
            "kind": "js-test-file",
            "runner": "vitest",
            "filePath": "/workspace/one/src/app.test.ts",
            "packageRootPath": "/workspace/one"
        })
    );
    let parsed: DebugLaunchTarget = serde_json::from_value(
        serde_json::json!({"kind": "node-script", "scriptPath": "/workspace/one/index.js"}),
    )
    .expect("deserialize node target");
    assert_eq!(parsed, node);
    let parsed_attach: DebugLaunchTarget =
        serde_json::from_value(serde_json::json!({"kind": "node-attach", "port": 9229}))
            .expect("deserialize attach target");
    assert_eq!(parsed_attach, attach);
}

#[test]
fn debug_launch_targets_reject_unknown_fields_for_every_wire_variant() {
    let values = [
        serde_json::json!({"kind":"node-attach","port":9229,"host":"example.test"}),
        serde_json::json!({"kind":"node-script","scriptPath":"/workspace/a.js","extra":true}),
        serde_json::json!({"kind":"js-test-file","runner":"vitest","filePath":"/workspace/a.test.ts","packageRootPath":"/workspace","extra":true}),
        serde_json::json!({"kind":"node-configured-script","scriptPath":"/workspace/a.js","args":[],"cwd":null,"env":{},"extra":true}),
        serde_json::json!({"kind":"js-configured-test","runner":"jest","filePath":"/workspace/a.test.js","packageRootPath":"/workspace","args":[],"cwd":null,"env":{},"extra":true}),
        serde_json::json!({"kind":"node-npm-script","script":"dev","packageRootPath":"/workspace","args":[],"cwd":null,"env":{},"extra":true}),
        serde_json::json!({"kind":"php-script","scriptPath":"/workspace/a.php","extra":true}),
        serde_json::json!({"kind":"php-test-file","filePath":"/workspace/a.php","extra":true}),
        serde_json::json!({"kind":"php-listen","port":9003,"extra":true}),
    ];
    for value in values {
        assert!(serde_json::from_value::<DebugLaunchTarget>(value).is_err());
    }
}

#[test]
fn php_launch_targets_serialize_with_kebab_case_kinds() {
    let script = DebugLaunchTarget::PhpScript {
        script_path: "/workspace/one/public/index.php".to_string(),
    };
    let test_file = DebugLaunchTarget::PhpTestFile {
        file_path: "/workspace/one/tests/Feature/InvoiceTest.php".to_string(),
    };
    let listen_with_port = DebugLaunchTarget::PhpListen { port: Some(9010) };
    let listen_default = DebugLaunchTarget::PhpListen { port: None };

    assert_eq!(
        serde_json::to_value(&script).expect("serialize php script target"),
        serde_json::json!({
            "kind": "php-script",
            "scriptPath": "/workspace/one/public/index.php"
        })
    );
    assert_eq!(
        serde_json::to_value(&test_file).expect("serialize php test target"),
        serde_json::json!({
            "kind": "php-test-file",
            "filePath": "/workspace/one/tests/Feature/InvoiceTest.php"
        })
    );
    assert_eq!(
        serde_json::to_value(&listen_with_port).expect("serialize php listen target"),
        serde_json::json!({"kind": "php-listen", "port": 9010})
    );
    assert_eq!(
        serde_json::to_value(&listen_default).expect("serialize default listen target"),
        serde_json::json!({"kind": "php-listen", "port": null})
    );
    let parsed_script: DebugLaunchTarget = serde_json::from_value(serde_json::json!({
        "kind": "php-script",
        "scriptPath": "/workspace/one/public/index.php"
    }))
    .expect("deserialize php script target");
    assert_eq!(parsed_script, script);
    let parsed_test: DebugLaunchTarget = serde_json::from_value(serde_json::json!({
        "kind": "php-test-file",
        "filePath": "/workspace/one/tests/Feature/InvoiceTest.php"
    }))
    .expect("deserialize php test target");
    assert_eq!(parsed_test, test_file);
    let parsed_listen: DebugLaunchTarget =
        serde_json::from_value(serde_json::json!({"kind": "php-listen", "port": 9010}))
            .expect("deserialize php listen target");
    assert_eq!(parsed_listen, listen_with_port);
    let parsed_default: DebugLaunchTarget =
        serde_json::from_value(serde_json::json!({"kind": "php-listen"}))
            .expect("deserialize listen target without port");
    assert_eq!(parsed_default, listen_default);
}

#[test]
fn step_kind_serializes_as_frontend_wire_values() {
    assert_eq!(
        serde_json::to_value(StepKind::Continue).expect("serialize continue"),
        serde_json::json!("continue")
    );
    assert_eq!(
        serde_json::to_value(StepKind::StepOver).expect("serialize stepOver"),
        serde_json::json!("stepOver")
    );
    assert_eq!(
        serde_json::to_value(StepKind::StepInto).expect("serialize stepInto"),
        serde_json::json!("stepInto")
    );
    assert_eq!(
        serde_json::to_value(StepKind::StepOut).expect("serialize stepOut"),
        serde_json::json!("stepOut")
    );
    let parsed: StepKind =
        serde_json::from_value(serde_json::json!("stepOut")).expect("deserialize stepOut");
    assert_eq!(parsed, StepKind::StepOut);
}

#[test]
fn debug_stop_reason_serializes_all_frontend_wire_values() {
    let expected = [
        (DebugStopReason::Breakpoint, "breakpoint"),
        (DebugStopReason::Step, "step"),
        (DebugStopReason::Pause, "pause"),
        (DebugStopReason::Exception, "exception"),
        (DebugStopReason::Entry, "entry"),
        (DebugStopReason::Restart, "restart"),
    ];

    for (reason, wire_value) in expected {
        assert_eq!(
            serde_json::to_value(reason).expect("serialize stop reason"),
            serde_json::json!(wire_value)
        );
        let parsed: DebugStopReason =
            serde_json::from_value(serde_json::json!(wire_value)).expect("deserialize stop reason");
        assert_eq!(parsed, reason);
    }
}

#[test]
fn debug_start_response_serializes_with_status_tag() {
    assert_eq!(
        serde_json::to_value(DebugStartResponse::Ok { session_id: 3 })
            .expect("serialize ok response"),
        serde_json::json!({"status": "ok", "sessionId": 3})
    );
    assert_eq!(
        serde_json::to_value(DebugStartResponse::Unavailable {
            message: "Node runtime not found.".to_string()
        })
        .expect("serialize unavailable response"),
        serde_json::json!({"status": "unavailable", "message": "Node runtime not found."})
    );
    assert_eq!(
        serde_json::to_value(DebugStartResponse::Error {
            message: "Launch failed.".to_string()
        })
        .expect("serialize error response"),
        serde_json::json!({"status": "error", "message": "Launch failed."})
    );
}

#[test]
fn debug_event_payload_serializes_with_kind_tag() {
    let stopped = DebugEventPayload::Stopped {
        reason: DebugStopReason::Entry,
        pause_generation: 1,
        frames_truncated: false,
        frames: vec![DebugStackFrame {
            frame_id: 4,
            name: "handleRequest".to_string(),
            file_path: Some("/workspace/one/src/app.ts".to_string()),
            line_number: 12,
            column: 3,
        }],
    };
    let verified = DebugEventPayload::BreakpointsVerified {
        file_path: "/workspace/one/src/app.ts".to_string(),
        breakpoints: vec![DebugBreakpoint {
            id: "bp-1".to_string(),
            file_path: "/workspace/one/src/app.ts".to_string(),
            line_number: 12,
            column_number: None,
            condition: Some("count > 3".to_string()),
            hit_condition: None,
            log_message: None,
            enabled: true,
            verified: true,
        }],
    };

    assert_eq!(
        serde_json::to_value(DebugEventPayload::Started { session_id: 7 })
            .expect("serialize started"),
        serde_json::json!({"kind": "started", "sessionId": 7})
    );
    assert_eq!(
        serde_json::to_value(&stopped).expect("serialize stopped"),
        serde_json::json!({
            "kind": "stopped",
            "reason": "entry",
            "pauseGeneration": 1,
            "frames": [{
                "frameId": 4,
                "name": "handleRequest",
                "filePath": "/workspace/one/src/app.ts",
                "lineNumber": 12,
                "column": 3
            }]
        })
    );
    assert_eq!(
        serde_json::to_value(DebugEventPayload::Output {
            stream: DebugOutputStream::Stderr,
            text: "boom".to_string(),
            truncated: false,
        })
        .expect("serialize output"),
        serde_json::json!({
            "kind": "output",
            "stream": "stderr",
            "text": "boom",
            "truncated": false
        })
    );
    assert_eq!(
        serde_json::to_value(DebugEventPayload::Output {
            stream: DebugOutputStream::Stdout,
            text: "ready".to_string(),
            truncated: false,
        })
        .expect("serialize stdout output"),
        serde_json::json!({
            "kind": "output",
            "stream": "stdout",
            "text": "ready",
            "truncated": false
        })
    );
    assert_eq!(
        serde_json::to_value(DebugEventPayload::Terminated { exit_code: Some(1) })
            .expect("serialize terminated"),
        serde_json::json!({"kind": "terminated", "exitCode": 1})
    );
    assert_eq!(
        serde_json::to_value(DebugEventPayload::Terminated { exit_code: None })
            .expect("serialize terminated without exit code"),
        serde_json::json!({"kind": "terminated", "exitCode": null})
    );
    assert_eq!(
        serde_json::to_value(&verified).expect("serialize verified"),
        serde_json::json!({
            "kind": "breakpointsVerified",
            "filePath": "/workspace/one/src/app.ts",
            "breakpoints": [{
                "id": "bp-1",
                "filePath": "/workspace/one/src/app.ts",
                "lineNumber": 12,
                "condition": "count > 3",
                "enabled": true,
                "verified": true
            }]
        })
    );
}

#[test]
fn debug_event_and_variable_info_use_camel_case_wire_format() {
    let event = DebugEvent {
        root_path: "/workspace/one".to_string(),
        session_id: 2,
        seq: 5,
        payload: DebugEventPayload::Resumed,
    };
    let variable = DebugVariableInfo {
        name: "user".to_string(),
        value: "User { id: 1 }".to_string(),
        value_type: Some("User".to_string()),
        evaluate_name: None,
        variables_reference: 9,
        can_set_value: None,
        set_expression_reference: None,
    };

    assert_eq!(
        serde_json::to_value(&event).expect("serialize event"),
        serde_json::json!({
            "rootPath": "/workspace/one",
            "sessionId": 2,
            "seq": 5,
            "payload": {"kind": "resumed"}
        })
    );
    assert_eq!(
        serde_json::to_value(&variable).expect("serialize variable"),
        serde_json::json!({
            "name": "user",
            "value": "User { id: 1 }",
            "type": "User",
            "variablesReference": 9
        })
    );
}
