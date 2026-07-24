use crate::debug_adapter::{
    DebugBreakpoint, DebugEvaluateContext, DebugExceptionPauseMode, DebugJustMyCodePolicy,
    DebugLaunchTarget, DebugVariableInfo, JsTestDebugNameMatch, JsTestDebugRunner,
    JsTestDebugSelection,
};
use crate::debug_hit_condition::DebugHitCondition;

#[test]
fn exception_pause_mode_has_a_closed_typed_wire_contract() {
    let expected = [
        (DebugExceptionPauseMode::None, "none"),
        (DebugExceptionPauseMode::Uncaught, "uncaught"),
        (DebugExceptionPauseMode::All, "all"),
    ];

    for (mode, wire_value) in expected {
        assert_eq!(
            serde_json::to_value(mode).expect("serialize exception pause mode"),
            serde_json::json!(wire_value)
        );
        let parsed: DebugExceptionPauseMode = serde_json::from_value(serde_json::json!(wire_value))
            .expect("deserialize exception pause mode");
        assert_eq!(parsed, mode);
    }
    assert!(
        serde_json::from_value::<DebugExceptionPauseMode>(serde_json::json!("caught")).is_err()
    );
    assert_eq!(
        DebugExceptionPauseMode::default(),
        DebugExceptionPauseMode::None
    );
}

#[test]
fn debug_breakpoint_has_a_closed_frontend_wire_contract() {
    let parsed: DebugBreakpoint = serde_json::from_value(serde_json::json!({
        "id": "bp-9",
        "filePath": "/workspace/one/src/app.ts",
        "lineNumber": 42,
        "columnNumber": 9,
        "condition": "user !== null",
        "hitCondition": {"kind":"greaterOrEqual", "count":3},
        "logMessage": "user={user.id}",
        "enabled": true,
        "verified": false
    }))
    .expect("deserialize breakpoint");
    let expected = DebugBreakpoint {
        id: "bp-9".to_string(),
        file_path: "/workspace/one/src/app.ts".to_string(),
        line_number: 42,
        column_number: Some(9),
        condition: Some("user !== null".to_string()),
        hit_condition: Some(DebugHitCondition::GreaterOrEqual { count: 3 }),
        log_message: Some("user={user.id}".to_string()),
        enabled: true,
        verified: false,
    };
    assert_eq!(parsed, expected);
    let round_tripped: DebugBreakpoint =
        serde_json::from_value(serde_json::to_value(&expected).expect("serialize breakpoint"))
            .expect("round-trip breakpoint");
    assert_eq!(round_tripped, expected);

    let without_verified: DebugBreakpoint = serde_json::from_value(serde_json::json!({
        "id": "bp-unverified",
        "filePath": "/workspace/one/src/app.ts",
        "lineNumber": 7,
        "condition": null,
        "enabled": true
    }))
    .expect("deserialize breakpoint without verified");
    assert!(!without_verified.verified);
    assert!(without_verified.hit_condition.is_none());
    assert!(without_verified.log_message.is_none());
    assert!(without_verified.column_number.is_none());

    for invalid_column in [
        serde_json::Value::Null,
        serde_json::json!(0),
        serde_json::json!(4_294_967_296_u64),
    ] {
        assert!(
            serde_json::from_value::<DebugBreakpoint>(serde_json::json!({
                "id":"bp-invalid-column", "filePath":"/workspace/one/src/app.ts",
                "lineNumber":7, "columnNumber":invalid_column, "condition":null,
                "enabled":true
            }))
            .is_err()
        );
    }

    assert!(
        serde_json::from_value::<DebugBreakpoint>(serde_json::json!({
            "id": "bp-unknown",
            "filePath": "/workspace/one/src/app.ts",
            "lineNumber": 7,
            "condition": null,
            "enabled": true,
            "unexpected": true
        }))
        .is_err()
    );

    for invalid_hit_condition in [
        serde_json::json!({"kind":"equals", "count":0}),
        serde_json::json!({"kind":"greaterOrEqual", "count":9_007_199_254_740_992_u64}),
        serde_json::json!({"kind":"multiple", "count":2, "unexpected":true}),
    ] {
        assert!(
            serde_json::from_value::<DebugBreakpoint>(serde_json::json!({
                "id":"bp-invalid-hit", "filePath":"/workspace/one/src/app.ts",
                "lineNumber":7, "condition":null, "hitCondition":invalid_hit_condition,
                "enabled":true
            }))
            .is_err()
        );
    }
}

#[test]
fn debug_variable_evaluate_name_is_optional_and_closed_on_the_wire() {
    let without_evaluate_name = DebugVariableInfo {
        name: "user".to_string(),
        value: "User".to_string(),
        value_type: Some("object".to_string()),
        evaluate_name: None,
        variables_reference: 9,
        can_set_value: None,
        set_expression_reference: None,
    };
    assert_eq!(
        serde_json::to_value(&without_evaluate_name).expect("serialize variable"),
        serde_json::json!({
            "name":"user", "value":"User", "type":"object", "variablesReference":9
        })
    );

    let with_evaluate_name = DebugVariableInfo {
        evaluate_name: Some("root.user".to_string()),
        ..without_evaluate_name.clone()
    };
    let encoded = serde_json::to_value(&with_evaluate_name).expect("serialize evaluate name");
    assert_eq!(
        encoded.get("evaluateName"),
        Some(&serde_json::json!("root.user"))
    );
    assert_eq!(
        serde_json::from_value::<DebugVariableInfo>(encoded).expect("deserialize evaluate name"),
        with_evaluate_name
    );
    let settable = DebugVariableInfo {
        can_set_value: Some(true),
        ..without_evaluate_name.clone()
    };
    let encoded = serde_json::to_value(&settable).expect("serialize settable variable");
    assert_eq!(encoded.get("canSetValue"), Some(&serde_json::json!(true)));
    assert_eq!(
        serde_json::from_value::<DebugVariableInfo>(encoded)
            .expect("deserialize settable variable"),
        settable
    );
    let set_expression = DebugVariableInfo {
        set_expression_reference: Some(17),
        ..without_evaluate_name.clone()
    };
    let encoded = serde_json::to_value(&set_expression).expect("serialize set expression");
    assert_eq!(
        encoded.get("setExpressionReference"),
        Some(&serde_json::json!(17))
    );
    assert_eq!(
        serde_json::from_value::<DebugVariableInfo>(encoded).expect("deserialize set expression"),
        set_expression
    );
    for invalid in [0_u64, 9_007_199_254_740_992] {
        assert!(
            serde_json::from_value::<DebugVariableInfo>(serde_json::json!({
                "name":"count", "value":"1", "type":"number", "variablesReference":0,
                "setExpressionReference": invalid
            }))
            .is_err()
        );
    }
    let internal_false = DebugVariableInfo {
        can_set_value: Some(false),
        ..without_evaluate_name.clone()
    };
    assert!(serde_json::to_value(internal_false)
        .expect("serialize internal false")
        .get("canSetValue")
        .is_none());
    for invalid in [serde_json::Value::Bool(false), serde_json::Value::Null] {
        assert!(
            serde_json::from_value::<DebugVariableInfo>(serde_json::json!({
                "name":"user", "value":"User", "type":"object", "variablesReference":9,
                "canSetValue": invalid
            }))
            .is_err()
        );
    }
    assert!(
        serde_json::from_value::<DebugVariableInfo>(serde_json::json!({
            "name":"user", "value":"User", "type":"object", "variablesReference":9,
            "evaluateName":"root.user", "extra":true
        }))
        .is_err()
    );
}

#[test]
fn debug_evaluate_context_has_an_exact_clipboard_wire_variant() {
    for (context, encoded) in [
        (DebugEvaluateContext::Repl, "repl"),
        (DebugEvaluateContext::Watch, "watch"),
        (DebugEvaluateContext::Clipboard, "clipboard"),
    ] {
        assert_eq!(
            serde_json::to_value(context).unwrap(),
            serde_json::json!(encoded)
        );
        assert_eq!(
            serde_json::from_value::<DebugEvaluateContext>(serde_json::json!(encoded)).unwrap(),
            context
        );
    }
    assert!(serde_json::from_value::<DebugEvaluateContext>(serde_json::json!("copy")).is_err());
}

#[test]
fn js_test_selection_has_a_closed_typed_wire_contract() {
    let value = serde_json::json!({
        "kind": "js-test-selection",
        "runner": "vitest",
        "filePath": "/workspace/src/math.test.ts",
        "packageRootPath": "/workspace",
        "selection": {
            "kind": "test",
            "fullName": "math adds",
            "nameMatch": "exact"
        }
    });
    let parsed: DebugLaunchTarget = serde_json::from_value(value.clone()).expect("typed target");
    assert_eq!(
        parsed,
        DebugLaunchTarget::JsTestSelection {
            runner: JsTestDebugRunner::Vitest,
            file_path: "/workspace/src/math.test.ts".to_string(),
            package_root_path: "/workspace".to_string(),
            selection: JsTestDebugSelection::Test {
                full_name: "math adds".to_string(),
                name_match: JsTestDebugNameMatch::Exact,
            },
        }
    );
    assert_eq!(
        serde_json::to_value(parsed).expect("serialize target"),
        value
    );

    for invalid in [
        serde_json::json!({
            "kind":"js-test-selection", "runner":"mocha", "filePath":"/workspace/a.test.ts", "packageRootPath":"/workspace",
            "selection":{"kind":"file"}
        }),
        serde_json::json!({
            "kind":"js-test-selection", "runner":"jest", "filePath":"/workspace/a.test.ts", "packageRootPath":"/workspace",
            "selection":{"kind":"test", "fullName":"a", "nameMatch":"contains"}
        }),
        serde_json::json!({
            "kind":"js-test-selection", "runner":"jest", "filePath":"/workspace/a.test.ts", "packageRootPath":"/workspace",
            "selection":{"kind":"suite", "fullName":"a", "extra":true}
        }),
        serde_json::json!({
            "kind":"js-test-selection", "runner":"jest", "filePath":"/workspace/a.test.ts", "packageRootPath":"/workspace",
            "selection":{"kind":"file"}, "args":[]
        }),
    ] {
        assert!(serde_json::from_value::<DebugLaunchTarget>(invalid).is_err());
    }
}

#[test]
fn node_internal_step_filter_has_a_closed_least_privilege_wire_contract() {
    assert_eq!(
        serde_json::to_value(DebugJustMyCodePolicy::NodeInternals)
            .expect("serialize internal step filter"),
        serde_json::json!("nodeInternals")
    );
    assert_eq!(
        serde_json::from_value::<DebugJustMyCodePolicy>(serde_json::json!("nodeInternals"))
            .expect("deserialize internal step filter"),
        DebugJustMyCodePolicy::NodeInternals
    );
    assert_eq!(
        serde_json::from_value::<DebugJustMyCodePolicy>(serde_json::json!("dependencies"))
            .expect("deserialize dependency filter"),
        DebugJustMyCodePolicy::Dependencies
    );
    assert_eq!(
        serde_json::from_value::<DebugJustMyCodePolicy>(serde_json::json!(
            "nodeInternalsAndDependencies"
        ))
        .expect("deserialize combined filter"),
        DebugJustMyCodePolicy::NodeInternalsAndDependencies
    );

    for value in [
        "nodeModules",
        "nodeInternalsAndNodeModules",
        ".*",
        "internal/",
    ] {
        assert!(serde_json::from_value::<DebugJustMyCodePolicy>(serde_json::json!(value)).is_err());
    }

    for valid in [
        serde_json::json!({
            "kind":"node-configured-script",
            "scriptPath":"/workspace/app.js",
            "args":[],
            "cwd":null,
            "env":{},
            "justMyCode":"nodeInternals"
        }),
        serde_json::json!({
            "kind":"node-npm-script",
            "script":"dev",
            "packageRootPath":"/workspace",
            "args":[],
            "cwd":null,
            "env":{},
            "justMyCode":"nodeInternals"
        }),
    ] {
        let parsed =
            serde_json::from_value::<DebugLaunchTarget>(valid.clone()).expect("valid Node policy");
        assert_eq!(
            parsed.just_my_code(),
            Some(DebugJustMyCodePolicy::NodeInternals)
        );
        assert_eq!(
            serde_json::to_value(parsed).expect("policy round trip"),
            valid
        );
    }

    for hostile in [
        serde_json::json!({
            "kind":"node-configured-script",
            "scriptPath":"/workspace/app.js",
            "args":[],
            "cwd":null,
            "env":{},
            "justMyCode":".*private.*"
        }),
        serde_json::json!({
            "kind":"node-npm-script",
            "script":"dev",
            "packageRootPath":"/workspace",
            "args":[],
            "cwd":null,
            "env":{},
            "justMyCode":{"patterns":[".*"]}
        }),
        serde_json::json!({
            "kind":"node-attach",
            "port":9229,
            "justMyCode":"nodeInternals"
        }),
        serde_json::json!({
            "kind":"node-script",
            "scriptPath":"/workspace/app.js",
            "justMyCode":"nodeInternals"
        }),
        serde_json::json!({
            "kind":"js-configured-test",
            "runner":"vitest",
            "filePath":"/workspace/app.test.js",
            "packageRootPath":"/workspace",
            "args":[],
            "cwd":null,
            "env":{},
            "justMyCode":"nodeInternals"
        }),
        serde_json::json!({
            "kind":"php-script",
            "scriptPath":"/workspace/app.php",
            "justMyCode":"nodeInternals"
        }),
    ] {
        assert!(serde_json::from_value::<DebugLaunchTarget>(hostile).is_err());
    }
}
