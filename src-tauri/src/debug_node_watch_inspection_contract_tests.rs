use super::*;
use std::cell::Cell;

fn frame(id: u64, name: &str, path: Option<&str>) -> DebugStackFrame {
    DebugStackFrame {
        frame_id: id,
        name: name.to_string(),
        file_path: path.map(str::to_string),
        line_number: 1,
        column: 1,
    }
}

fn scope(reference: u64, name: &str) -> DebugScopeInfo {
    DebugScopeInfo {
        name: name.to_string(),
        variables_reference: reference,
        expensive: false,
    }
}

fn variable(name: &str, value: &str) -> DebugVariableInfo {
    DebugVariableInfo {
        name: name.to_string(),
        value: value.to_string(),
        value_type: Some("number".to_string()),
        evaluate_name: Some(name.to_string()),
        variables_reference: 0,
        can_set_value: None,
        set_expression_reference: None,
    }
}

fn variables_request() -> WatchVariablesRequest {
    WatchVariablesRequest::new(DebugVariablePageRequest {
        pause_generation: 7,
        frame_id: 3,
        variables_reference: 11,
        start: 0,
        count: 10,
    })
    .expect("variables request")
}

#[test]
fn requests_require_nonzero_javascript_safe_identifiers() {
    assert!(WatchStackTraceRequest::new(1).is_ok());
    assert!(WatchStackTraceRequest::new(0).is_err());
    assert!(WatchStackTraceRequest::new(MAX_SAFE_INTEGER + 1).is_err());
    assert!(WatchScopesRequest::new(1, 1).is_ok());
    assert!(WatchScopesRequest::new(0, 1).is_err());
    assert!(WatchScopesRequest::new(1, 0).is_err());
    assert!(WatchScopesRequest::new(1, MAX_SAFE_INTEGER + 1).is_err());
    assert!(WatchVariablesRequest::new(DebugVariablePageRequest {
        pause_generation: 1,
        frame_id: 1,
        variables_reference: MAX_SAFE_INTEGER + 1,
        start: 0,
        count: 1,
    })
    .is_err());
    assert!(WatchVariablesRequest::new(DebugVariablePageRequest {
        pause_generation: 1,
        frame_id: 1,
        variables_reference: 1,
        start: 0,
        count: 101,
    })
    .is_err());
}

#[test]
fn stack_trace_is_bounded_truncated_and_rejects_invalid_strings_or_ids() {
    let frames = (1..=257)
        .map(|id| frame(id, "frame", Some("/workspace/app.ts")))
        .collect();
    let result = WatchStackTraceResult::new(7, frames).expect("bounded frames");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frames().len(), 256);
    assert!(result.truncated());

    assert!(WatchStackTraceResult::new(7, vec![frame(0, "frame", None)]).is_err());
    assert!(WatchStackTraceResult::new(7, vec![frame(1, &"n".repeat(1_025), None)]).is_err());
    assert!(WatchStackTraceResult::new(7, vec![frame(1, "bad\nname", None)]).is_err());
    assert!(
        WatchStackTraceResult::new(7, vec![frame(1, "frame", Some(&"p".repeat(4_097)))]).is_err()
    );
}

#[test]
fn stack_trace_aggregate_string_budget_is_fail_closed() {
    let frames = (1..=129)
        .map(|id| frame(id, "n", Some(&"p".repeat(4_096))))
        .collect();
    assert!(WatchStackTraceResult::new(7, frames).is_err());
}

#[test]
fn scopes_require_bounded_clean_names_and_nonzero_safe_references() {
    assert!(WatchScopesResult::new(7, 3, vec![scope(1, "Local")]).is_ok());
    assert!(
        WatchScopesResult::new(7, 3, (1..=257).map(|id| scope(id, "Scope")).collect()).is_err()
    );
    assert!(WatchScopesResult::new(7, 3, vec![scope(0, "Local")]).is_err());
    assert!(WatchScopesResult::new(7, 3, vec![scope(MAX_SAFE_INTEGER + 1, "Local")]).is_err());
    assert!(WatchScopesResult::new(7, 3, vec![scope(1, "bad\u{0000}name")]).is_err());
    assert!(WatchScopesResult::new(7, 3, vec![scope(1, &"s".repeat(1_025))]).is_err());
    assert!(WatchScopesResult::new(7, 0, vec![scope(1, "Local")]).is_err());
}

#[test]
fn bounded_snapshots_visit_at_most_the_limit_plus_one_sentinel() {
    let frames: Vec<_> = (1..=10_000)
        .map(|id| frame(id, "frame", Some("/workspace/app.ts")))
        .collect();
    let frame_visits = Cell::new(0);
    let stack = WatchStackTraceResult::snapshot(
        7,
        frames
            .iter()
            .inspect(|_| frame_visits.set(frame_visits.get() + 1)),
        || true,
    )
    .expect("bounded stack snapshot");
    assert_eq!(frame_visits.get(), 257);
    assert_eq!(stack.frames().len(), 256);
    assert!(stack.truncated());

    let scopes: Vec<_> = (1..=10_000).map(|id| scope(id, "Scope")).collect();
    let scope_visits = Cell::new(0);
    assert!(WatchScopesResult::snapshot(
        7,
        3,
        scopes
            .iter()
            .inspect(|_| scope_visits.set(scope_visits.get() + 1)),
        || true,
    )
    .is_err());
    assert_eq!(scope_visits.get(), 257);
}

#[test]
fn bounded_snapshots_abort_when_pause_ownership_is_revoked_during_copy() {
    let frames: Vec<_> = (1..=10).map(|id| frame(id, "frame", None)).collect();
    let checks = Cell::new(0);
    assert!(WatchStackTraceResult::snapshot(7, &frames, || {
        checks.set(checks.get() + 1);
        checks.get() < 4
    })
    .is_err());
    assert_eq!(checks.get(), 4);
}

#[test]
fn variable_pages_preserve_exact_owner_pagination_and_aggregate_bounds() {
    let request = variables_request();
    let result = WatchVariablesResult::new(
        request,
        DebugVariablePage {
            variables: vec![variable("value", "42")],
            start: 0,
            returned: 1,
            total: Some(1),
            next_start: None,
            truncated: false,
        },
    )
    .expect("bounded page");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frame_id(), 3);
    assert_eq!(result.variables_reference(), 11);

    assert!(WatchVariablesResult::new(
        request,
        DebugVariablePage {
            variables: vec![variable("value", "42")],
            start: 1,
            returned: 1,
            total: Some(2),
            next_start: None,
            truncated: false,
        },
    )
    .is_err());
    assert!(WatchVariablesResult::new(
        request,
        DebugVariablePage {
            variables: vec![variable("value", &"x".repeat(MAX_VARIABLE_VALUE_BYTES + 1))],
            start: 0,
            returned: 1,
            total: Some(1),
            next_start: None,
            truncated: false,
        },
    )
    .is_err());
}

#[test]
fn evaluation_contract_enforces_watch_clipboard_and_repl_side_effect_policy() {
    for (context, allow_side_effects) in [
        (DebugEvaluateContext::Watch, false),
        (DebugEvaluateContext::Clipboard, true),
        (DebugEvaluateContext::Repl, true),
    ] {
        assert!(WatchEvaluateRequest::new(
            7,
            3,
            "value".to_string(),
            DebugEvaluatePolicy {
                context,
                allow_side_effects,
            },
        )
        .is_ok());
        assert!(WatchEvaluateRequest::new(
            7,
            3,
            "value".to_string(),
            DebugEvaluatePolicy {
                context,
                allow_side_effects: !allow_side_effects,
            },
        )
        .is_err());
        for expression in [
            "({root:\n{child:{value:42}}})",
            "(() => {\r\n\treturn 42;\r\n})()",
        ] {
            assert!(WatchEvaluateRequest::new(
                7,
                3,
                expression.to_string(),
                DebugEvaluatePolicy {
                    context,
                    allow_side_effects,
                },
            )
            .is_ok());
        }
    }
    for expression in [
        "before\rafter",
        "before\r\u{b}after",
        "before\u{b}after",
        "before\u{c}after",
        "before\u{85}after",
        "before\0after",
    ] {
        assert!(WatchEvaluateRequest::new(
            7,
            3,
            expression.to_string(),
            DebugEvaluatePolicy {
                context: DebugEvaluateContext::Repl,
                allow_side_effects: true,
            },
        )
        .is_err());
    }
}

#[test]
fn evaluation_result_is_owner_bound_and_preserves_bounded_side_effect_failures() {
    let request = WatchEvaluateRequest::new(
        7,
        3,
        "mutate()".to_string(),
        DebugEvaluatePolicy {
            context: DebugEvaluateContext::Watch,
            allow_side_effects: false,
        },
    )
    .expect("watch request");
    let result = WatchEvaluateResult::new(
        &request,
        Err(DebugEvaluateFailure {
            kind: crate::debug_adapter::DebugEvaluateErrorKind::SideEffect,
            message: "Evaluation blocked due to a side effect.".to_string(),
        }),
    )
    .expect("bounded failure");
    assert_eq!(result.pause_epoch(), 7);
    assert_eq!(result.frame_id(), 3);
    assert_eq!(
        result
            .into_outcome()
            .expect_err("side-effect rejection")
            .kind,
        crate::debug_adapter::DebugEvaluateErrorKind::SideEffect
    );

    assert!(WatchEvaluateResult::new(
        &request,
        Err(DebugEvaluateFailure::exception(
            "x".repeat(MAX_EVALUATE_MESSAGE_BYTES + 1)
        )),
    )
    .is_err());

    let multiline_expression = "({root:\n{child:{value:42}}})";
    let multiline_request = WatchEvaluateRequest::new(
        7,
        3,
        multiline_expression.to_string(),
        DebugEvaluatePolicy {
            context: DebugEvaluateContext::Repl,
            allow_side_effects: true,
        },
    )
    .expect("multiline request");
    let multiline_result = WatchEvaluateResult::new(
        &multiline_request,
        Ok(DebugVariableInfo {
            name: multiline_expression.to_string(),
            value: "Object".to_string(),
            value_type: Some("object".to_string()),
            evaluate_name: None,
            variables_reference: 11,
            can_set_value: None,
            set_expression_reference: None,
        }),
    )
    .expect("bounded multiline evaluation result");
    assert_eq!(
        multiline_result
            .into_outcome()
            .expect("multiline value")
            .name,
        multiline_expression
    );
}

#[test]
fn mutation_contracts_are_bounded_and_exact_owner_bound() {
    let variable_request = WatchSetVariableRequest::new(DebugSetVariableRequest {
        pause_generation: 7,
        frame_id: 3,
        variables_reference: 11,
        name: "value".to_string(),
        value: "42".to_string(),
    })
    .expect("set-variable request");
    assert!(WatchSetVariableRequest::new(DebugSetVariableRequest {
        pause_generation: 7,
        frame_id: 3,
        variables_reference: 11,
        name: "value".to_string(),
        value: "x".repeat(MAX_EVALUATE_EXPRESSION_BYTES + 1),
    })
    .is_err());
    assert!(WatchSetVariableResult::new(
        &variable_request,
        DebugSetVariableResult {
            value: variable("other", "42"),
        },
    )
    .is_err());

    let expression = WatchSetExpressionRequest::new(DebugSetExpressionRequest {
        pause_generation: 7,
        frame_id: 3,
        set_expression_reference: 13,
        expression: "value".to_string(),
        value: "42".to_string(),
    })
    .expect("set-expression request");
    assert!(WatchSetExpressionRequest::new(DebugSetExpressionRequest {
        pause_generation: 7,
        frame_id: 3,
        set_expression_reference: MAX_SAFE_INTEGER + 1,
        expression: "value".to_string(),
        value: "42".to_string(),
    })
    .is_err());
    assert!(WatchSetExpressionResult::new(
        &expression,
        DebugSetExpressionResult {
            set_expression_reference: 99,
            expression: "value".to_string(),
            value: variable("value", "42"),
        },
    )
    .is_err());
}
