use super::{
    canonical_wire::canonical,
    project_clone::branch_name,
    types::{id, uuid},
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

const BRANCH_BYTES: usize = 255;
const MAX_BRANCHES: usize = 500;
const MAX_DIRTY: u32 = 10_000;
const MAX_MESSAGE_BYTES: usize = 4096;
const MAX_RUNNER_ID_BYTES: usize = 128;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const PUBLISHED_REF_PREFIX: &str = "refs/heads/";
const INVALID: &str = "Invalid runner Git sync response";
const REFUSAL_PREFIX: &str = "Runner refused the Git operation: ";
pub(super) const GIT_OPERATION_UNKNOWN: &str =
    "The runner no longer knows this Git operation. Refresh the Git status.";

fn required<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}

pub(super) fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

fn check(valid: bool) -> Result<(), String> {
    if !valid {
        return Err(INVALID.into());
    }
    Ok(())
}

pub(super) fn git_branch(value: &str) -> bool {
    branch_name(value) && value.len() <= BRANCH_BYTES && value != "HEAD" && !value.starts_with('+')
}

pub(super) fn blank(value: &str) -> bool {
    value.chars().all(|c| c.is_whitespace() || c == '\u{feff}')
}

pub(super) fn git_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(super) fn runner_id(value: &str) -> bool {
    !blank(value) && value.len() <= MAX_RUNNER_ID_BYTES && !value.chars().any(char::is_control)
}

pub(super) fn commit_message(value: &str) -> bool {
    !blank(value)
        && value.len() <= MAX_MESSAGE_BYTES
        && !value.chars().any(|c| c != '\n' && c.is_control())
}

fn digits(value: &[u8], min: u8, max: u8) -> bool {
    let parsed = value.iter().try_fold(0_u8, |acc, b| {
        b.is_ascii_digit()
            .then(|| acc.saturating_mul(10).saturating_add(b - b'0'))
    });
    parsed.is_some_and(|n| (min..=max).contains(&n))
}

pub(super) fn timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() < 20 || b.len() > 64 {
        return false;
    }
    let date_time = b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && digits(&b[5..7], 1, 12)
        && b[7] == b'-'
        && digits(&b[8..10], 1, 31)
        && b[10] == b'T'
        && digits(&b[11..13], 0, 23)
        && b[13] == b':'
        && digits(&b[14..16], 0, 59)
        && b[16] == b':'
        && digits(&b[17..19], 0, 59);
    if !date_time {
        return false;
    }
    let mut rest = &b[19..];
    if rest.first() == Some(&b'.') {
        let fraction = rest[1..].iter().take_while(|b| b.is_ascii_digit()).count();
        if !(1..=9).contains(&fraction) {
            return false;
        }
        rest = &rest[1 + fraction..];
    }
    rest == b"Z"
        || (rest.len() == 6
            && matches!(rest[0], b'+' | b'-')
            && digits(&rest[1..3], 0, 23)
            && rest[3] == b':'
            && digits(&rest[4..6], 0, 59))
}

fn optional_timestamp(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(timestamp)
}

fn optional_branch(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(git_branch)
}

fn count(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitErrorCode {
    GitRemoteUnavailable,
    GitAuthFailed,
    GitTimeout,
    GitNoRemote,
    GitRemoteUnsupported,
    GitBranchNotFound,
    GitDetachedHead,
    GitNoUpstream,
    GitDirty,
    GitDiverged,
    GitOperationInProgress,
    GitRejectedNonFastForward,
    GitRejected,
    GitNothingToCommit,
    GitIdentityMissing,
    Busy,
    Conflict,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum StartBase {
    OriginBranch { branch: String },
    CheckoutHead {},
}

impl StartBase {
    pub(super) fn validate(&self) -> Result<(), String> {
        match self {
            Self::OriginBranch { branch } if !git_branch(branch) => {
                Err("Invalid base branch".into())
            }
            Self::OriginBranch { .. } | Self::CheckoutHead {} => Ok(()),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartBody {
    pub(super) project_id: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub(super) base: Option<StartBase>,
}

impl StartBody {
    pub(super) fn validate(&self) -> Result<(), String> {
        id(&self.project_id)?;
        self.base.as_ref().map_or(Ok(()), StartBase::validate)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdempotentBody {
    pub(super) idempotency_key: String,
}

impl IdempotentBody {
    pub(super) fn validate(&self) -> Result<(), String> {
        uuid(&self.idempotency_key)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CommitBody {
    pub(super) message: String,
}

impl CommitBody {
    pub(super) fn validate(&self) -> Result<(), String> {
        if !commit_message(&self.message) {
            return Err("Invalid commit message".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PushTarget {
    ThreadBranch,
    BaseBranch,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushBody {
    pub(super) idempotency_key: String,
    pub(super) target: PushTarget,
}

impl PushBody {
    pub(super) fn validate(&self) -> Result<(), String> {
        uuid(&self.idempotency_key)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteBranch {
    name: String,
    sha: String,
    committed_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchList {
    #[serde(deserialize_with = "required")]
    default_branch: Option<String>,
    #[serde(deserialize_with = "required")]
    checkout_branch: Option<String>,
    #[serde(deserialize_with = "required")]
    fetched_at: Option<String>,
    branches: Vec<RemoteBranch>,
    truncated: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DirtySummary {
    tracked: u32,
    untracked: u32,
    truncated: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tracking {
    #[serde(rename = "ref")]
    reference: String,
    ahead: u64,
    behind: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckoutOperation {
    None,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Bisect,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutStatus {
    #[serde(deserialize_with = "required")]
    branch: Option<String>,
    head_sha: String,
    #[serde(deserialize_with = "required")]
    upstream: Option<Tracking>,
    dirty: DirtySummary,
    operation: CheckoutOperation,
    in_place_task_active: bool,
    #[serde(deserialize_with = "required")]
    fetched_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThreadMode {
    Worktree,
    InPlace,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadBase {
    branch: String,
    sha: String,
    #[serde(deserialize_with = "required")]
    fetched_at: Option<String>,
    ahead: u64,
    behind: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadGitStatus {
    mode: ThreadMode,
    #[serde(deserialize_with = "required")]
    branch: Option<String>,
    head_sha: String,
    #[serde(deserialize_with = "required")]
    base: Option<ThreadBase>,
    #[serde(deserialize_with = "required")]
    published: Option<Tracking>,
    dirty: DirtySummary,
    active: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitResult {
    commit_sha: String,
    status: ThreadGitStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitOperationKind {
    Fetch,
    Update,
    Push,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitOperationStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GitOperationResult {
    Fetch {
        fetched_at: String,
    },
    Update {
        head_sha: String,
        fast_forwarded: u64,
    },
    Push {
        remote_ref: String,
        pushed_sha: String,
        created: bool,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GitOperation {
    id: String,
    kind: GitOperationKind,
    status: GitOperationStatus,
    #[serde(deserialize_with = "required")]
    error: Option<GitErrorCode>,
    #[serde(deserialize_with = "required")]
    result: Option<GitOperationResult>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GitErrorBody {
    pub(super) error: GitErrorCode,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum OperationLost {
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RemoteGitResponse {
    Branches(BranchList),
    CheckoutStatus(CheckoutStatus),
    ThreadStatus(ThreadGitStatus),
    Commit(CommitResult),
    Operation(GitOperation),
    Refused(GitErrorBody),
    Lost(OperationLost),
}

impl GitOperation {
    pub(super) fn id(&self) -> &str {
        &self.id
    }

    pub(super) fn kind(&self) -> GitOperationKind {
        self.kind
    }
}

pub(super) fn refusable_route(path: &str) -> bool {
    let project = path
        .strip_prefix("/v1/projects/")
        .and_then(|rest| rest.split_once("/git/"))
        .is_some_and(|(project, action)| {
            id(project).is_ok() && matches!(action, "fetch" | "update")
        });
    let task = path
        .strip_prefix("/v1/tasks/")
        .and_then(|rest| rest.split_once("/git/"))
        .is_some_and(|(task, action)| uuid(task).is_ok() && matches!(action, "commit" | "push"));
    project || task
}

pub(super) fn operation_route(path: &str) -> bool {
    path.strip_prefix("/v1/git-operations/")
        .is_some_and(|operation| uuid(operation).is_ok())
}

pub(super) fn refusal_error(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let refusal = parse_error_body(value).ok()?;
    let code = serde_json::to_value(refusal.error).ok()?;
    Some(format!("{REFUSAL_PREFIX}{}", code.as_str()?))
}

pub(super) fn refused(error: &str) -> Option<GitErrorCode> {
    let code = error.strip_prefix(REFUSAL_PREFIX)?;
    serde_json::from_value(Value::String(code.into())).ok()
}

impl Tracking {
    fn valid(&self) -> bool {
        git_branch(&self.reference) && count(self.ahead) && count(self.behind)
    }
}

impl DirtySummary {
    fn valid(&self) -> bool {
        self.tracked <= MAX_DIRTY && self.untracked <= MAX_DIRTY
    }
}

impl BranchList {
    fn valid(&self) -> bool {
        optional_branch(&self.default_branch)
            && optional_branch(&self.checkout_branch)
            && optional_timestamp(&self.fetched_at)
            && self.branches.len() <= MAX_BRANCHES
            && self.branches.iter().all(|branch| {
                git_branch(&branch.name) && git_sha(&branch.sha) && timestamp(&branch.committed_at)
            })
    }
}

impl CheckoutStatus {
    fn valid(&self) -> bool {
        optional_branch(&self.branch)
            && git_sha(&self.head_sha)
            && self.upstream.as_ref().is_none_or(Tracking::valid)
            && self.dirty.valid()
            && optional_timestamp(&self.fetched_at)
    }
}

impl ThreadGitStatus {
    fn valid(&self) -> bool {
        optional_branch(&self.branch)
            && git_sha(&self.head_sha)
            && self.base.as_ref().is_none_or(|base| {
                git_branch(&base.branch)
                    && git_sha(&base.sha)
                    && optional_timestamp(&base.fetched_at)
                    && count(base.ahead)
                    && count(base.behind)
            })
            && self.published.as_ref().is_none_or(Tracking::valid)
            && self.dirty.valid()
    }
}

impl GitOperationResult {
    fn kind(&self) -> GitOperationKind {
        match self {
            Self::Fetch { .. } => GitOperationKind::Fetch,
            Self::Update { .. } => GitOperationKind::Update,
            Self::Push { .. } => GitOperationKind::Push,
        }
    }

    fn valid(&self) -> bool {
        match self {
            Self::Fetch { fetched_at } => timestamp(fetched_at),
            Self::Update {
                head_sha,
                fast_forwarded,
            } => git_sha(head_sha) && count(*fast_forwarded),
            Self::Push {
                remote_ref,
                pushed_sha,
                ..
            } => {
                git_sha(pushed_sha)
                    && remote_ref
                        .strip_prefix(PUBLISHED_REF_PREFIX)
                        .is_some_and(git_branch)
            }
        }
    }
}

impl GitOperation {
    fn valid(&self) -> bool {
        let outcome = match (&self.status, &self.error, &self.result) {
            (GitOperationStatus::Running, None, None) => true,
            (GitOperationStatus::Succeeded, None, Some(result)) => {
                result.kind() == self.kind && result.valid()
            }
            (GitOperationStatus::Failed, Some(_), None) => true,
            _ => false,
        };
        outcome && uuid(&self.id).is_ok()
    }
}

fn parse<T: for<'de> Deserialize<'de> + Serialize>(
    value: Value,
    valid: fn(&T) -> bool,
) -> Result<T, String> {
    let parsed: T = canonical(value).ok_or(INVALID)?;
    check(valid(&parsed))?;
    Ok(parsed)
}

pub(super) fn parse_branch_list(value: Value) -> Result<BranchList, String> {
    parse(value, BranchList::valid)
}

pub(super) fn parse_checkout_status(value: Value) -> Result<CheckoutStatus, String> {
    parse(value, CheckoutStatus::valid)
}

pub(super) fn parse_thread_status(value: Value) -> Result<ThreadGitStatus, String> {
    parse(value, ThreadGitStatus::valid)
}

pub(super) fn parse_commit_result(value: Value) -> Result<CommitResult, String> {
    parse(value, |result: &CommitResult| {
        git_sha(&result.commit_sha) && result.status.valid()
    })
}

pub(super) fn parse_operation(value: Value) -> Result<GitOperation, String> {
    parse(value, GitOperation::valid)
}

pub(super) fn parse_error_body(value: Value) -> Result<GitErrorBody, String> {
    parse(value, |_: &GitErrorBody| true)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitProjectTarget {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) project_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitProjectNetwork {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) project_id: String,
    pub(super) idempotency_key: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitThreadTarget {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) task_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitThreadCommit {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) task_id: String,
    pub(super) message: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitThreadPush {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) task_id: String,
    pub(super) idempotency_key: String,
    pub(super) target: PushTarget,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitOperationTarget {
    pub(super) server_id: String,
    pub(super) runner_id: String,
    pub(super) operation_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum RemoteGitRequest {
    ProjectBranches(GitProjectTarget),
    ProjectFetch(GitProjectNetwork),
    ProjectStatus(GitProjectTarget),
    ProjectUpdate(GitProjectNetwork),
    ThreadStatus(GitThreadTarget),
    ThreadCommit(GitThreadCommit),
    ThreadPush(GitThreadPush),
    Operation(GitOperationTarget),
}

fn connection(server_id: &str, runner: &str) -> Result<(), String> {
    id(server_id)?;
    if !runner_id(runner) {
        return Err("Invalid runner identity".into());
    }
    Ok(())
}

impl RemoteGitRequest {
    pub(super) fn server_id(&self) -> &str {
        match self {
            Self::ProjectBranches(r) | Self::ProjectStatus(r) => &r.server_id,
            Self::ProjectFetch(r) | Self::ProjectUpdate(r) => &r.server_id,
            Self::ThreadStatus(r) => &r.server_id,
            Self::ThreadCommit(r) => &r.server_id,
            Self::ThreadPush(r) => &r.server_id,
            Self::Operation(r) => &r.server_id,
        }
    }

    pub(super) fn runner_id(&self) -> &str {
        match self {
            Self::ProjectBranches(r) | Self::ProjectStatus(r) => &r.runner_id,
            Self::ProjectFetch(r) | Self::ProjectUpdate(r) => &r.runner_id,
            Self::ThreadStatus(r) => &r.runner_id,
            Self::ThreadCommit(r) => &r.runner_id,
            Self::ThreadPush(r) => &r.runner_id,
            Self::Operation(r) => &r.runner_id,
        }
    }

    pub(super) fn validate(&self) -> Result<(), String> {
        match self {
            Self::ProjectBranches(r) | Self::ProjectStatus(r) => {
                connection(&r.server_id, &r.runner_id)?;
                id(&r.project_id)
            }
            Self::ProjectFetch(r) | Self::ProjectUpdate(r) => {
                connection(&r.server_id, &r.runner_id)?;
                id(&r.project_id)?;
                uuid(&r.idempotency_key)
            }
            Self::ThreadStatus(r) => {
                connection(&r.server_id, &r.runner_id)?;
                uuid(&r.task_id)
            }
            Self::ThreadCommit(r) => {
                connection(&r.server_id, &r.runner_id)?;
                uuid(&r.task_id)?;
                if !commit_message(&r.message) {
                    return Err("Invalid commit message".into());
                }
                Ok(())
            }
            Self::ThreadPush(r) => {
                connection(&r.server_id, &r.runner_id)?;
                uuid(&r.task_id)?;
                uuid(&r.idempotency_key)
            }
            Self::Operation(r) => {
                connection(&r.server_id, &r.runner_id)?;
                uuid(&r.operation_id)
            }
        }
    }
}

#[cfg(test)]
#[path = "git_sync_wire_tests.rs"]
mod tests;
