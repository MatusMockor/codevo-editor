use super::model::{
    from_wire_name, wire_name, CloseReason, JournalState, RequestKind, RequestProvider,
    RequestResolution, RequestStatus, RuntimeRequest, ThreadRequests, MAX_ANCHOR_TOOL_ID_BYTES,
    MAX_REQUESTS_PER_MESSAGE, MAX_REQUEST_ID_BYTES, MAX_RETAINED_REQUESTS_PER_THREAD,
    MAX_SAFE_INTEGER,
};
use super::observed::{
    observe_approval, observe_question, observe_snapshot, ClosedStatus, ObservedState,
};
use crate::agent_questions::approvals::{
    AgentApprovalDecision, AgentApprovalKind, AgentApprovalRequest, AgentApprovalStatus,
    MAX_AGENT_APPROVAL_FACTS, MAX_AGENT_APPROVAL_TITLE_BYTES,
};
use crate::agent_questions::interactions::AgentInteractionSnapshot;
use crate::agent_questions::{
    AgentQuestion, AgentQuestionAnswerItem, AgentQuestionRequest, AgentQuestionStatus,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

const WIRE: &str = include_str!("../../../contracts/agent-runtime-request-wire.json");

fn wire() -> Value {
    serde_json::from_str(WIRE).expect("decode the runtime request fixture")
}

fn cases(section: &str, validity: &str) -> Vec<Value> {
    wire()[section][validity]
        .as_array()
        .expect("fixture cases")
        .clone()
}

fn valid_value(section: &str, name: &str) -> Value {
    cases(section, "valid")
        .into_iter()
        .find(|case| case["name"] == json!(name))
        .unwrap_or_else(|| panic!("missing valid case {name}"))["value"]
        .clone()
}

fn invalid_value(section: &str, case: &Value) -> Value {
    let base = case["base"].as_str().expect("invalid case base");
    let mut value = valid_value(section, base);
    let object = value.as_object_mut().expect("base object");
    for (key, patched) in case["patch"].as_object().expect("invalid case patch") {
        object.insert(key.clone(), patched.clone());
    }
    for key in case["omit"].as_array().into_iter().flatten() {
        object.remove(key.as_str().expect("omitted key"));
    }
    value
}

fn assert_section<T: DeserializeOwned + Serialize>(section: &str, minimum_cases: usize) {
    let valid = cases(section, "valid");
    assert!(valid.len() >= minimum_cases, "{section}");
    for case in valid {
        let parsed: T = serde_json::from_value(case["value"].clone())
            .unwrap_or_else(|error| panic!("{section}.{}: {error}", case["name"]));
        assert_eq!(
            serde_json::to_value(&parsed).expect("encode"),
            case["value"],
            "{section}.{}",
            case["name"]
        );
    }
    let invalid = cases(section, "invalid");
    assert!(invalid.len() >= minimum_cases, "{section}");
    for case in invalid {
        let value = invalid_value(section, &case);
        assert!(
            serde_json::from_value::<T>(value).is_err(),
            "{section}.{} must be rejected",
            case["name"]
        );
    }
}

fn names<T: Serialize>(variants: &[T]) -> Value {
    json!(variants
        .iter()
        .map(|variant| wire_name(variant).expect("variant name"))
        .collect::<Vec<_>>())
}

#[test]
fn every_valid_request_round_trips_and_every_invalid_request_is_rejected() {
    assert_section::<RuntimeRequest>("requests", 17);
}

#[test]
fn every_valid_thread_message_round_trips_and_every_invalid_one_is_rejected() {
    assert_section::<ThreadRequests>("threadRequests", 3);
}

#[test]
fn closed_sets_and_limits_match_the_shared_fixture() {
    let wire = wire();
    assert_eq!(names(&RequestStatus::ALL), wire["statuses"]);
    assert_eq!(names(&CloseReason::ALL), wire["closeReasons"]);
    assert_eq!(names(&RequestProvider::ALL), wire["providers"]);
    assert_eq!(names(&RequestKind::ALL), wire["bodyKinds"]);
    assert_eq!(names(&JournalState::ALL), wire["journals"]);
    let limits = &wire["limits"];
    assert_eq!(limits["idBytes"], json!(MAX_REQUEST_ID_BYTES));
    assert_eq!(
        limits["anchorToolIdBytes"],
        json!(MAX_ANCHOR_TOOL_ID_BYTES)
    );
    assert_eq!(limits["approvalFacts"], json!(MAX_AGENT_APPROVAL_FACTS));
    assert_eq!(
        limits["approvalTitleBytes"],
        json!(MAX_AGENT_APPROVAL_TITLE_BYTES)
    );
    assert_eq!(
        limits["requestsPerMessage"],
        json!(MAX_REQUESTS_PER_MESSAGE)
    );
    assert_eq!(
        limits["retainedRequestsPerThread"],
        json!(MAX_RETAINED_REQUESTS_PER_THREAD)
    );
    assert_eq!(MAX_SAFE_INTEGER, (1u64 << 53) - 1);
}

#[test]
fn question_and_option_limits_of_the_fixture_are_the_accepted_maximum() {
    let limits = wire()["limits"].clone();
    let question_limit = limits["questions"].as_u64().expect("questions") as usize;
    let option_limit = limits["questionOptions"].as_u64().expect("options") as usize;
    let question = |index: usize, options: usize| {
        json!({
            "id": format!("q{index}"),
            "header": "",
            "prompt": "Pick",
            "options": (0..options)
                .map(|option| json!({"id": format!("o{option}"), "label": "Option", "description": ""}))
                .collect::<Vec<_>>(),
            "multiple": false,
            "allowCustom": true,
        })
    };
    let with_questions = |questions: Vec<Value>| {
        let mut value = valid_value("requests", "expiredTurnEnded");
        value["body"] = json!({"kind": "question", "questions": questions});
        serde_json::from_value::<RuntimeRequest>(value)
    };
    assert!(with_questions((0..question_limit).map(|index| question(index, 0)).collect()).is_ok());
    assert!(
        with_questions((0..=question_limit).map(|index| question(index, 0)).collect()).is_err()
    );
    assert!(with_questions(vec![question(0, option_limit)]).is_ok());
    assert!(with_questions(vec![question(0, option_limit + 1)]).is_err());
}

#[test]
fn transition_table_matches_the_shared_fixture() {
    let table = wire()["transitions"].clone();
    for from in RequestStatus::ALL {
        let name = wire_name(&from).expect("status name");
        assert_eq!(names(from.successors()), table[&name], "{name}");
        for to in RequestStatus::ALL {
            let listed = table[&name]
                .as_array()
                .expect("successors")
                .contains(&json!(wire_name(&to).expect("status name")));
            assert_eq!(from.may_become(to), listed, "{name}");
        }
    }
}

#[test]
fn no_walk_ever_leaves_a_terminal_status() {
    let terminal: Vec<RequestStatus> = RequestStatus::ALL
        .into_iter()
        .filter(|status| status.is_terminal())
        .collect();
    assert_eq!(
        terminal,
        [
            RequestStatus::Resolved,
            RequestStatus::Cancelled,
            RequestStatus::Expired,
            RequestStatus::TimedOut
        ]
    );
    let mut seed = 0x9e37_79b9_7f4a_7c15_u64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        RequestStatus::ALL[(seed % 6) as usize]
    };
    for _ in 0..2_000 {
        let mut current = RequestStatus::Pending;
        let mut closed_as = None;
        for _ in 0..24 {
            let candidate = next();
            if !current.may_become(candidate) {
                continue;
            }
            assert_eq!(closed_as, None, "{current:?} left for {candidate:?}");
            current = candidate;
            if current.is_terminal() {
                closed_as = Some(current);
            }
        }
        if let Some(closed) = closed_as {
            assert_eq!(current, closed);
        }
    }
    for from in terminal {
        for to in RequestStatus::ALL {
            assert!(!from.may_become(to), "{from:?} -> {to:?}");
        }
    }
}

#[test]
fn unknown_wire_names_are_not_decoded() {
    assert_eq!(
        from_wire_name::<RequestStatus>("timedOut"),
        Some(RequestStatus::TimedOut)
    );
    assert_eq!(from_wire_name::<RequestStatus>("answered"), None);
    assert_eq!(from_wire_name::<CloseReason>("userDismissed"), None);
    assert_eq!(from_wire_name::<RequestKind>("notice"), None);
}

fn question(status: AgentQuestionStatus) -> AgentQuestionRequest {
    AgentQuestionRequest {
        id: "question-1".into(),
        task_id: "agt-turn-0001".into(),
        provider: "codex".into(),
        questions: vec![AgentQuestion {
            id: "notes".into(),
            header: String::new(),
            prompt: "Anything else?".into(),
            options: Vec::new(),
            multiple: false,
            allow_custom: true,
        }],
        status,
        answers: None,
    }
}

fn approval(status: AgentApprovalStatus) -> AgentApprovalRequest {
    AgentApprovalRequest {
        id: "approval-1".into(),
        task_id: "agt-turn-0001".into(),
        provider: "claudeCode".into(),
        kind: AgentApprovalKind::Command,
        title: "Run the test suite".into(),
        detail: "npm test".into(),
        detail_truncated: false,
        facts: Vec::new(),
        decisions: vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny,
        ],
        status,
        decision: None,
    }
}

fn closed(status: ClosedStatus, reason: CloseReason) -> ObservedState {
    ObservedState::Closed { status, reason }
}

#[test]
fn session_question_statuses_map_to_request_states() {
    let answers = vec![AgentQuestionAnswerItem {
        question_id: "notes".into(),
        option_ids: Vec::new(),
        text: "Nothing else.".into(),
    }];
    let mut answered = question(AgentQuestionStatus::Answered);
    answered.answers = Some(answers.clone());
    let observed = |request| observe_question(request).expect("observed question").state;
    assert_eq!(
        observed(question(AgentQuestionStatus::Pending)),
        ObservedState::Pending
    );
    assert_eq!(
        observed(answered),
        ObservedState::Resolved(RequestResolution::Answers { answers })
    );
    assert_eq!(
        observed(question(AgentQuestionStatus::Expired)),
        closed(ClosedStatus::Expired, CloseReason::TurnEnded)
    );
    assert_eq!(
        observed(question(AgentQuestionStatus::Cancelled)),
        closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled)
    );
    assert_eq!(
        observe_question(question(AgentQuestionStatus::Pending))
            .expect("observed question")
            .provider,
        RequestProvider::Codex
    );
}

#[test]
fn session_approval_statuses_map_to_request_states() {
    let decided = |status, decision| {
        let mut request = approval(status);
        request.decision = Some(decision);
        observe_approval(request).expect("observed approval").state
    };
    let observed = |status| {
        observe_approval(approval(status))
            .expect("observed approval")
            .state
    };
    assert_eq!(
        observed(AgentApprovalStatus::Pending),
        ObservedState::Pending
    );
    assert_eq!(
        decided(
            AgentApprovalStatus::Approved,
            AgentApprovalDecision::AllowOnce
        ),
        ObservedState::Resolved(RequestResolution::Decision {
            decision: AgentApprovalDecision::AllowOnce
        })
    );
    assert_eq!(
        decided(AgentApprovalStatus::Denied, AgentApprovalDecision::Deny),
        ObservedState::Resolved(RequestResolution::Decision {
            decision: AgentApprovalDecision::Deny
        })
    );
    assert_eq!(
        observed(AgentApprovalStatus::TimedOut),
        closed(ClosedStatus::TimedOut, CloseReason::TimedOut)
    );
    assert_eq!(
        observed(AgentApprovalStatus::Expired),
        closed(ClosedStatus::Expired, CloseReason::TurnEnded)
    );
    assert_eq!(
        observed(AgentApprovalStatus::Cancelled),
        closed(ClosedStatus::Cancelled, CloseReason::ProviderCancelled)
    );
}

#[test]
fn incoherent_session_requests_are_rejected_and_reported_by_id() {
    let mut answered_without_answers = question(AgentQuestionStatus::Answered);
    answered_without_answers.id = "question-broken".into();
    let mut unknown_provider = approval(AgentApprovalStatus::Pending);
    unknown_provider.id = "approval-broken".into();
    unknown_provider.provider = "gemini".into();
    let mut not_offered = approval(AgentApprovalStatus::Approved);
    not_offered.id = "approval-not-offered".into();
    not_offered.decision = Some(AgentApprovalDecision::AllowForSession);
    let turn = observe_snapshot(AgentInteractionSnapshot {
        task_id: "agt-turn-0001".into(),
        workspace_id: "workspace".into(),
        sequence: 7,
        questions: vec![
            question(AgentQuestionStatus::Pending),
            answered_without_answers,
        ],
        approvals: vec![
            unknown_provider,
            not_offered,
            approval(AgentApprovalStatus::Pending),
        ],
    });
    assert_eq!(turn.sequence, 7);
    assert_eq!(
        turn.requests
            .iter()
            .map(|request| request.id.as_str())
            .collect::<Vec<_>>(),
        ["question-1", "approval-1"]
    );
    assert_eq!(
        turn.rejected,
        [
            "question-broken",
            "approval-broken",
            "approval-not-offered"
        ]
    );
}

#[test]
fn blank_text_follows_the_javascript_trim_whitespace_set() {
    use crate::agent_questions::is_blank;
    let javascript_whitespace = [
        '\u{0009}', '\u{000A}', '\u{000B}', '\u{000C}', '\u{000D}', '\u{0020}', '\u{00A0}',
        '\u{1680}', '\u{2000}', '\u{200A}', '\u{2028}', '\u{2029}', '\u{202F}', '\u{205F}',
        '\u{3000}', '\u{FEFF}',
    ];
    for character in javascript_whitespace {
        assert!(is_blank(&character.to_string()), "{:04X}", character as u32);
    }
    for character in ['\u{0085}', '\u{180E}', '\u{200B}', '\u{2060}', 'a'] {
        assert!(!is_blank(&character.to_string()), "{:04X}", character as u32);
    }
    assert!(is_blank(""));
    assert!(is_blank(" \u{FEFF}\t\u{3000}"));
    assert!(!is_blank(" \u{FEFF}x "));
}

#[test]
fn capability_reason_presence_is_part_of_the_wire_contract() {
    let pending = |capability: Value| {
        let mut value = valid_value("requests", "pendingQuestion");
        value["responseCapability"] = capability;
        serde_json::from_value::<RuntimeRequest>(value)
    };
    assert!(pending(json!({"kind": "live"})).is_ok());
    assert!(pending(json!({"kind": "live", "reason": null})).is_err());
    assert!(pending(json!({"kind": "live", "reason": "unknown"})).is_err());
    let cancelled = |capability: Value| {
        let mut value = valid_value("requests", "cancelledByProvider");
        value["responseCapability"] = capability;
        serde_json::from_value::<RuntimeRequest>(value)
    };
    assert!(cancelled(json!({"kind": "notResumable", "reason": "unknown"})).is_ok());
    assert!(cancelled(json!({"kind": "notResumable", "reason": null})).is_err());
    assert!(cancelled(json!({"kind": "notResumable"})).is_err());
    let encoded = serde_json::to_value(pending(json!({"kind": "live"})).expect("pending"))
        .expect("encode");
    assert_eq!(encoded["responseCapability"], json!({"kind": "live"}));
}
