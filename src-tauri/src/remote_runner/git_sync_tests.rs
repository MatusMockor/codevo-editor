use super::super::git_sync_wire::{
    operation_route, refusable_route, refusal_error, refused, GitErrorCode, StartBase, StartBody,
};
use super::super::types::{Server, StartRequest};
use super::*;
use serde_json::json;
use std::cell::{Cell, RefCell};

const CONTRACT: &str = include_str!("../../../contracts/remote-git-sync-wire.json");
const RUNNER: &str = "linux-runner";
const TASK: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const KEY: &str = "0b9d6f3e-6a51-4c1f-8d2e-7f1a2b3c4d5e";
const OPERATION: &str = "5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f";
const OTHER_OPERATION: &str = "6a1d2e3f-4b5c-4d6e-8f70-8b9c0d1e2f3a";

type Call = (String, String, Option<Value>);

struct FakeRunner {
    runner: String,
    swapped: Cell<bool>,
    current: Cell<bool>,
    revoke_during_call: bool,
    swap_runner_during_call: bool,
    reply: RefCell<Option<Result<Value, String>>>,
    calls: RefCell<Vec<Call>>,
}

impl FakeRunner {
    fn replying(reply: Result<Value, String>) -> Self {
        Self {
            runner: RUNNER.into(),
            swapped: Cell::new(false),
            current: Cell::new(true),
            revoke_during_call: false,
            swap_runner_during_call: false,
            reply: RefCell::new(Some(reply)),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }
}

impl GitRunnerPort for FakeRunner {
    fn runner_id(&self) -> &str {
        if self.swapped.get() {
            return "replacement-runner";
        }
        &self.runner
    }

    fn is_current(&self) -> bool {
        self.current.get()
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.calls
            .borrow_mut()
            .push((method.into(), path.into(), body));
        if self.revoke_during_call {
            self.current.set(false);
        }
        if self.swap_runner_during_call {
            self.swapped.set(true);
        }
        self.reply
            .borrow_mut()
            .take()
            .unwrap_or_else(|| Err("called twice".into()))
    }
}

fn contract() -> Value {
    serde_json::from_str(CONTRACT).expect("git sync wire contract is JSON")
}

fn fixture(section: &str, name: &str) -> Value {
    contract()["sections"][section]["accepted"]
        .as_array()
        .expect("accepted cases")
        .iter()
        .find(|case| case["name"] == name)
        .unwrap_or_else(|| panic!("missing fixture {section}/{name}"))["value"]
        .clone()
}

fn request(value: Value) -> RemoteGitRequest {
    serde_json::from_value::<Canonical<RemoteGitRequest>>(value)
        .expect("canonical request")
        .0
}

fn operation(kind: &str, id: &str) -> Value {
    json!({"id": id, "kind": kind, "status": "running", "error": null, "result": null})
}

fn refusal(code: &str) -> String {
    refusal_error(json!({ "error": code }).to_string().as_bytes()).expect("known refusal")
}

fn executed(request_value: Value, reply: Result<Value, String>) -> Result<Value, String> {
    let runner = FakeRunner::replying(reply);
    execute(&runner, &request(request_value))
        .map(|response| serde_json::to_value(response).expect("serialisable response"))
}

#[test]
fn every_contract_request_plans_one_fixed_route_and_body() {
    let expected = [
        (
            "projectBranches",
            "GET",
            "/v1/projects/storefront/git/branches",
            None,
        ),
        (
            "projectFetch",
            "POST",
            "/v1/projects/storefront/git/fetch",
            Some(json!({ "idempotencyKey": KEY })),
        ),
        (
            "projectStatus",
            "GET",
            "/v1/projects/storefront/git/status",
            None,
        ),
        (
            "projectUpdate",
            "POST",
            "/v1/projects/storefront/git/update",
            Some(json!({ "idempotencyKey": KEY })),
        ),
        (
            "threadStatus",
            "GET",
            "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/status",
            None,
        ),
        (
            "threadCommit",
            "POST",
            "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/commit",
            Some(json!({ "message": "Fix checkout totals" })),
        ),
        (
            "threadPushThreadBranch",
            "POST",
            "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/push",
            Some(json!({ "idempotencyKey": KEY, "target": "thread-branch" })),
        ),
        (
            "threadPushBaseBranch",
            "POST",
            "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/push",
            Some(json!({ "idempotencyKey": KEY, "target": "base-branch" })),
        ),
        (
            "operation",
            "GET",
            "/v1/git-operations/5f0c1d2e-3a4b-4c5d-9e6f-7a8b9c0d1e2f",
            None,
        ),
    ];
    for (name, method, path, body) in expected {
        let planned = plan(&request(fixture("editorGitRequest", name))).expect(name);
        assert_eq!(planned.method, method, "{name}");
        assert_eq!(planned.path, path, "{name}");
        assert_eq!(planned.body, body, "{name}");
    }
}

#[test]
fn rejected_contract_requests_never_plan_a_route() {
    for case in contract()["sections"]["editorGitRequest"]["rejected"]
        .as_array()
        .expect("rejected cases")
    {
        let parsed = serde_json::from_value::<Canonical<RemoteGitRequest>>(case["value"].clone());
        if let Ok(parsed) = parsed {
            assert!(plan(&parsed.0).is_err(), "{} planned", case["name"]);
        }
    }
}

#[test]
fn validated_responses_cross_ipc_unchanged() {
    let cases = [
        ("projectBranches", fixture("branchList", "typical")),
        ("projectStatus", fixture("checkoutStatus", "cleanTracking")),
        (
            "threadStatus",
            fixture("threadGitStatus", "worktreeFromOrigin"),
        ),
        ("threadCommit", fixture("commitResult", "committed")),
        ("projectFetch", operation("fetch", OPERATION)),
        ("projectUpdate", operation("update", OPERATION)),
        ("threadPushThreadBranch", operation("push", OPERATION)),
        ("operation", fixture("gitOperation", "pushSucceeded")),
    ];
    for (name, reply) in cases {
        assert_eq!(
            executed(fixture("editorGitRequest", name), Ok(reply.clone())),
            Ok(reply),
            "{name}"
        );
    }
}

#[test]
fn malformed_or_mismatched_responses_fail_closed() {
    let mut extra = fixture("threadGitStatus", "worktreeFromOrigin");
    extra["token"] = json!("secret");
    for (name, reply) in [
        ("threadStatus", extra),
        (
            "projectBranches",
            fixture("checkoutStatus", "cleanTracking"),
        ),
        ("projectFetch", operation("push", OPERATION)),
        ("projectUpdate", operation("fetch", OPERATION)),
        ("threadPushThreadBranch", operation("update", OPERATION)),
        ("operation", operation("push", OTHER_OPERATION)),
        ("threadCommit", Value::Null),
    ] {
        assert_eq!(
            executed(fixture("editorGitRequest", name), Ok(reply)),
            Err(INVALID_RESPONSE.into()),
            "{name}"
        );
    }
}

#[test]
fn generation_change_during_the_call_discards_a_valid_response() {
    let runner = FakeRunner {
        revoke_during_call: true,
        ..FakeRunner::replying(Ok(fixture("threadGitStatus", "worktreeFromOrigin")))
    };
    let result = execute(
        &runner,
        &request(fixture("editorGitRequest", "threadStatus")),
    );
    assert_eq!(result.unwrap_err(), SUPERSEDED);
    assert_eq!(runner.calls().len(), 1);
}

#[test]
fn runner_replacement_during_the_call_discards_the_response() {
    let runner = FakeRunner {
        swap_runner_during_call: true,
        ..FakeRunner::replying(Ok(operation("push", OPERATION)))
    };
    let result = execute(
        &runner,
        &request(fixture("editorGitRequest", "threadPushThreadBranch")),
    );
    assert_eq!(result.unwrap_err(), SUPERSEDED);
}

#[test]
fn superseded_or_foreign_runner_is_refused_before_any_call() {
    let stale = FakeRunner::replying(Ok(Value::Null));
    stale.current.set(false);
    assert_eq!(
        execute(
            &stale,
            &request(fixture("editorGitRequest", "threadCommit"))
        )
        .unwrap_err(),
        SUPERSEDED
    );
    assert!(stale.calls().is_empty());
    let foreign = FakeRunner {
        runner: "other-runner".into(),
        ..FakeRunner::replying(Ok(Value::Null))
    };
    assert_eq!(
        execute(
            &foreign,
            &request(fixture("editorGitRequest", "threadCommit"))
        )
        .unwrap_err(),
        RUNNER_CHANGED
    );
    assert!(foreign.calls().is_empty());
}

#[test]
fn admission_refusals_become_typed_responses_for_mutations_only() {
    for name in [
        "projectFetch",
        "projectUpdate",
        "threadCommit",
        "threadPushThreadBranch",
        "threadPushBaseBranch",
    ] {
        assert_eq!(
            executed(fixture("editorGitRequest", name), Err(refusal("git_dirty"))),
            Ok(json!({ "error": "git_dirty" })),
            "{name}"
        );
    }
    for name in [
        "projectBranches",
        "projectStatus",
        "threadStatus",
        "operation",
    ] {
        assert_eq!(
            executed(fixture("editorGitRequest", name), Err(refusal("busy"))),
            Err(INVALID_RESPONSE.into()),
            "{name}"
        );
    }
}

#[test]
fn every_refusal_code_round_trips_through_the_transport_error() {
    for case in contract()["sections"]["errorBody"]["accepted"]
        .as_array()
        .expect("accepted error bodies")
    {
        let body = case["value"].to_string();
        let error = refusal_error(body.as_bytes()).expect("refusal");
        let code = refused(&error).expect("decoded code");
        assert_eq!(
            serde_json::to_value(code).unwrap(),
            case["value"]["error"],
            "{}",
            case["name"]
        );
    }
    for case in contract()["sections"]["errorBody"]["rejected"]
        .as_array()
        .expect("rejected error bodies")
    {
        assert!(refusal_error(case["value"].to_string().as_bytes()).is_none());
    }
    assert!(refusal_error(b"not json").is_none());
    assert!(refused("Runner request failed (HTTP 409).").is_none());
    assert!(refused("Runner refused the Git operation: invalid_input").is_none());
}

#[test]
fn polling_a_forgotten_operation_reports_unknown_instead_of_failure() {
    assert_eq!(
        executed(
            fixture("editorGitRequest", "operation"),
            Err(GIT_OPERATION_UNKNOWN.into())
        ),
        Ok(json!({ "outcome": "unknown" }))
    );
    assert_eq!(
        executed(
            fixture("editorGitRequest", "threadStatus"),
            Err(GIT_OPERATION_UNKNOWN.into())
        ),
        Err(INVALID_RESPONSE.into())
    );
    assert_eq!(
        executed(
            fixture("editorGitRequest", "operation"),
            Err("Runner request failed (HTTP 500).".into())
        ),
        Err("Runner request failed (HTTP 500).".into())
    );
}

#[test]
fn transport_routes_are_recognised_exactly() {
    for path in [
        "/v1/projects/storefront/git/fetch",
        "/v1/projects/storefront/git/update",
        "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/commit",
        "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/push",
    ] {
        assert!(refusable_route(path), "{path}");
    }
    for path in [
        "/v1/projects/storefront/git/branches",
        "/v1/projects/storefront/git/status",
        "/v1/projects/store front/git/fetch",
        "/v1/tasks/not-a-task/git/push",
        "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/git/push/x",
        "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/start",
        "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/steer",
    ] {
        assert!(!refusable_route(path), "{path}");
    }
    assert!(operation_route(&format!("/v1/git-operations/{OPERATION}")));
    assert!(!operation_route("/v1/git-operations/x"));
    assert!(!operation_route(&format!(
        "/v1/git-operations/{OPERATION}/x"
    )));
}

#[test]
fn ipc_outcomes_have_closed_shapes() {
    assert_eq!(
        serde_json::to_value(RemoteGitResponse::Lost(OperationLost::Unknown)).unwrap(),
        json!({ "outcome": "unknown" })
    );
    assert_eq!(
        serde_json::to_value(RemoteGitResponse::Refused(GitErrorBody {
            error: GitErrorCode::GitNothingToCommit
        }))
        .unwrap(),
        json!({ "error": "git_nothing_to_commit" })
    );
}

#[cfg(unix)]
#[test]
fn revoked_connection_lease_never_reaches_the_runner() {
    use std::sync::Arc;
    let server = Server {
        id: "linux".into(),
        name: "Linux".into(),
        host: "127.0.0.1".into(),
        username: "codex".into(),
        port: 22,
        connected: true,
        runner_id: Some(RUNNER.into()),
    };
    let lease = ConnectionLease::new(
        server,
        Arc::new(super::super::transport::Session::fixture()),
    );
    lease.revoke();
    assert_eq!(
        execute(
            &lease,
            &request(fixture("editorGitRequest", "threadStatus"))
        )
        .unwrap_err(),
        SUPERSEDED
    );
}

#[test]
fn start_request_carries_an_optional_closed_base() {
    let start = |extra: Value| {
        let mut value = json!({ "serverId": "linux", "taskId": TASK, "projectId": "storefront" });
        if let (Some(target), Some(fields)) = (value.as_object_mut(), extra.as_object()) {
            target.extend(fields.clone());
        }
        serde_json::from_value::<StartRequest>(value)
    };
    let body = |request: StartRequest| {
        let body = StartBody {
            project_id: request.project_id,
            base: request.base,
        };
        body.validate()
            .map(|()| serde_json::to_value(&body).unwrap())
    };
    assert_eq!(
        body(start(json!({})).unwrap()),
        Ok(json!({ "projectId": "storefront" }))
    );
    assert_eq!(
        body(start(json!({ "base": { "kind": "checkout-head" } })).unwrap()),
        Ok(json!({ "projectId": "storefront", "base": { "kind": "checkout-head" } }))
    );
    assert_eq!(
        body(start(json!({ "base": { "kind": "origin-branch", "branch": "feature/x" } })).unwrap()),
        Ok(
            json!({ "projectId": "storefront", "base": { "kind": "origin-branch", "branch": "feature/x" } })
        )
    );
    assert!(body(
        start(json!({ "base": { "kind": "origin-branch", "branch": "+refs/heads/main" } }))
            .unwrap()
    )
    .is_err());
    assert!(
        body(start(json!({ "base": { "kind": "origin-branch", "branch": "HEAD" } })).unwrap())
            .is_err()
    );
    for rejected in [
        json!({ "base": null }),
        json!({ "base": { "kind": "sha", "sha": "abc" } }),
        json!({ "base": { "kind": "checkout-head", "branch": "main" } }),
        json!({ "base": { "kind": "origin-branch" } }),
        json!({ "isolation": "worktree" }),
    ] {
        assert!(start(rejected.clone()).is_err(), "{rejected}");
    }
    assert!(matches!(
        start(json!({ "base": { "kind": "origin-branch", "branch": "main" } }))
            .unwrap()
            .base,
        Some(StartBase::OriginBranch { .. })
    ));
}
