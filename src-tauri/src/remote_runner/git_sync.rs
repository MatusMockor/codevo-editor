use super::{
    canonical_wire::Canonical,
    commands::blocking,
    git_sync_wire::{
        operation_route, parse_branch_list, parse_checkout_status, parse_commit_result,
        parse_operation, parse_thread_status, refused, CommitBody, GitErrorBody, GitOperationKind,
        IdempotentBody, OperationLost, PushBody, RemoteGitRequest, RemoteGitResponse,
        GIT_OPERATION_UNKNOWN,
    },
    service::{ConnectionLease, RemoteRunnerState},
};
use serde::Serialize;
use serde_json::Value;

const RUNNER_CHANGED: &str = "Runner identity changed. Reconnect the server before continuing.";
const SUPERSEDED: &str = "Server connection changed during request";
const INVALID_RESPONSE: &str = "Invalid runner Git sync response";

pub(super) trait GitRunnerPort {
    fn runner_id(&self) -> &str;
    fn is_current(&self) -> bool;
    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String>;
}

impl GitRunnerPort for ConnectionLease {
    fn runner_id(&self) -> &str {
        ConnectionLease::runner_id(self)
    }

    fn is_current(&self) -> bool {
        ConnectionLease::is_current(self)
    }

    fn call(&self, method: &'static str, path: &str, body: Option<Value>) -> Result<Value, String> {
        super::project_management::call_lease(self.clone(), method, path, body)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Expect {
    Branches,
    CheckoutStatus,
    ThreadStatus,
    Commit,
    Started(GitOperationKind),
    Polled(String),
}

#[derive(Debug)]
pub(super) struct GitPlan {
    method: &'static str,
    path: String,
    body: Option<Value>,
    expect: Expect,
}

fn json<T: Serialize>(body: &T) -> Result<Option<Value>, String> {
    serde_json::to_value(body)
        .map(Some)
        .map_err(|_| "Invalid Git sync request".into())
}

fn get(path: String, expect: Expect) -> Result<GitPlan, String> {
    Ok(GitPlan {
        method: "GET",
        path,
        body: None,
        expect,
    })
}

fn post(path: String, body: Option<Value>, expect: Expect) -> Result<GitPlan, String> {
    Ok(GitPlan {
        method: "POST",
        path,
        body,
        expect,
    })
}

fn started(path: String, idempotency_key: &str, kind: GitOperationKind) -> Result<GitPlan, String> {
    let body = IdempotentBody {
        idempotency_key: idempotency_key.into(),
    };
    body.validate()?;
    post(path, json(&body)?, Expect::Started(kind))
}

pub(super) fn plan(request: &RemoteGitRequest) -> Result<GitPlan, String> {
    request.validate()?;
    match request {
        RemoteGitRequest::ProjectBranches(r) => get(
            format!("/v1/projects/{}/git/branches", r.project_id),
            Expect::Branches,
        ),
        RemoteGitRequest::ProjectStatus(r) => get(
            format!("/v1/projects/{}/git/status", r.project_id),
            Expect::CheckoutStatus,
        ),
        RemoteGitRequest::ProjectFetch(r) => started(
            format!("/v1/projects/{}/git/fetch", r.project_id),
            &r.idempotency_key,
            GitOperationKind::Fetch,
        ),
        RemoteGitRequest::ProjectUpdate(r) => started(
            format!("/v1/projects/{}/git/update", r.project_id),
            &r.idempotency_key,
            GitOperationKind::Update,
        ),
        RemoteGitRequest::ThreadStatus(r) => get(
            format!("/v1/tasks/{}/git/status", r.task_id),
            Expect::ThreadStatus,
        ),
        RemoteGitRequest::ThreadCommit(r) => {
            let body = CommitBody {
                message: r.message.clone(),
            };
            body.validate()?;
            post(
                format!("/v1/tasks/{}/git/commit", r.task_id),
                json(&body)?,
                Expect::Commit,
            )
        }
        RemoteGitRequest::ThreadPush(r) => {
            let body = PushBody {
                idempotency_key: r.idempotency_key.clone(),
                target: r.target,
            };
            body.validate()?;
            post(
                format!("/v1/tasks/{}/git/push", r.task_id),
                json(&body)?,
                Expect::Started(GitOperationKind::Push),
            )
        }
        RemoteGitRequest::Operation(r) => get(
            format!("/v1/git-operations/{}", r.operation_id),
            Expect::Polled(r.operation_id.clone()),
        ),
    }
}

impl GitPlan {
    fn parse(&self, value: Value) -> Result<RemoteGitResponse, String> {
        match &self.expect {
            Expect::Branches => parse_branch_list(value).map(RemoteGitResponse::Branches),
            Expect::CheckoutStatus => {
                parse_checkout_status(value).map(RemoteGitResponse::CheckoutStatus)
            }
            Expect::ThreadStatus => parse_thread_status(value).map(RemoteGitResponse::ThreadStatus),
            Expect::Commit => parse_commit_result(value).map(RemoteGitResponse::Commit),
            Expect::Started(kind) => {
                let operation = parse_operation(value)?;
                if operation.kind() != *kind {
                    return Err(INVALID_RESPONSE.into());
                }
                Ok(RemoteGitResponse::Operation(operation))
            }
            Expect::Polled(id) => {
                let operation = parse_operation(value)?;
                if operation.id() != id {
                    return Err(INVALID_RESPONSE.into());
                }
                Ok(RemoteGitResponse::Operation(operation))
            }
        }
    }

    fn settle_error(&self, error: String) -> Result<RemoteGitResponse, String> {
        if self.method == "POST" {
            if let Some(code) = refused(&error) {
                return Ok(RemoteGitResponse::Refused(GitErrorBody { error: code }));
            }
        }
        if matches!(self.expect, Expect::Polled(_))
            && operation_route(&self.path)
            && error == GIT_OPERATION_UNKNOWN
        {
            return Ok(RemoteGitResponse::Lost(OperationLost::Unknown));
        }
        if refused(&error).is_some() || error == GIT_OPERATION_UNKNOWN {
            return Err(INVALID_RESPONSE.into());
        }
        Err(error)
    }
}

pub(super) fn execute(
    port: &impl GitRunnerPort,
    request: &RemoteGitRequest,
) -> Result<RemoteGitResponse, String> {
    let plan = plan(request)?;
    if port.runner_id() != request.runner_id() {
        return Err(RUNNER_CHANGED.into());
    }
    if !port.is_current() {
        return Err(SUPERSEDED.into());
    }
    let outcome = port.call(plan.method, &plan.path, plan.body.clone());
    if !port.is_current() || port.runner_id() != request.runner_id() {
        return Err(SUPERSEDED.into());
    }
    match outcome {
        Ok(value) => plan.parse(value),
        Err(error) => plan.settle_error(error),
    }
}

#[tauri::command]
pub async fn remote_runner_git(
    state: tauri::State<'_, RemoteRunnerState>,
    request: Canonical<RemoteGitRequest>,
) -> Result<RemoteGitResponse, String> {
    let request = request.0;
    plan(&request)?;
    let lease = state.connection_lease(request.server_id())?;
    if lease.runner_id() != request.runner_id() {
        return Err(RUNNER_CHANGED.into());
    }
    blocking(move || execute(&lease, &request)).await
}

#[cfg(test)]
#[path = "git_sync_tests.rs"]
mod tests;
