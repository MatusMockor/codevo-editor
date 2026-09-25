use super::git_integration_commands::git_integration;
use super::git_surface_commands::git_branch_diff;
use super::git_surface_commands::git_surface_status;
use super::git_surface_commands::{ensure_git_surface_trusted, git_surface_root};
use super::repository_lookup::{
    plan_command, run_bounded, CliProgram, DiscoveryExecutableResolver, ExecutableResolver,
    ProcessError, ProcessKillSwitch, ProcessLimits, ProcessOutput,
};
use super::{canonicalize_workspace_root, GitTrustState};
use crate::agent_cli_discovery::AgentCliDiscovery;
use crate::run_blocking_command;
use pull_request::{
    classify_forge_failure, created_url, hosted_repository, pull_request_argv,
    validate_pull_request, ForgeKind, HostedRepository, PullRequestFailure, PullRequestReceipt,
};
use pull_request_base::{resolve_default_base, resolve_requested_base};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

#[path = "../pull_request.rs"]
pub(crate) mod pull_request;
#[path = "pull_request_base.rs"]
mod pull_request_base;

const PULL_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const FORGE_AUTH_TIMEOUT: Duration = Duration::from_secs(15);
const PULL_REQUEST_STDOUT_BYTES: usize = 64 * 1024;
const PULL_REQUEST_STDERR_BYTES: usize = 8 * 1024;
const MAX_CONTEXT_SUBJECTS: usize = 50;
const MAX_CONTEXT_SUBJECT_BYTES: usize = 200;
const GITHUB_CREDENTIAL_ENVIRONMENT: [&str; 4] =
    ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_ENTERPRISE_TOKEN"];
const GITLAB_CREDENTIAL_ENVIRONMENT: [&str; 4] = [
    "GITLAB_TOKEN",
    "GITLAB_ACCESS_TOKEN",
    "GLAB_HOST",
    "GITLAB_HOST",
];

pub(crate) type ForgeEnvironment = Arc<dyn Fn(&str) -> Option<OsString> + Send + Sync>;

pub(crate) struct PullRequestService {
    executables: Arc<dyn ExecutableResolver>,
    home: PathBuf,
    environment: ForgeEnvironment,
}

impl PullRequestService {
    pub(crate) fn new(discovery: Arc<AgentCliDiscovery>) -> Self {
        Self::with_resolver(
            Arc::new(DiscoveryExecutableResolver::new(discovery)),
            forge_home(),
        )
    }

    pub(crate) fn with_resolver(executables: Arc<dyn ExecutableResolver>, home: PathBuf) -> Self {
        Self::with_environment(executables, home, Arc::new(|key| std::env::var_os(key)))
    }

    pub(crate) fn with_environment(
        executables: Arc<dyn ExecutableResolver>,
        home: PathBuf,
        environment: ForgeEnvironment,
    ) -> Self {
        Self {
            executables,
            home,
            environment,
        }
    }

    fn cli_available(&self, forge: ForgeKind) -> bool {
        self.executables.resolve(program(forge)).is_some()
    }

    fn ensure_authenticated(
        &self,
        repository: &HostedRepository,
        cwd: &Path,
    ) -> Result<(), PullRequestFailure> {
        let argv = [
            "auth".to_string(),
            "status".to_string(),
            "--hostname".to_string(),
            repository.host.clone(),
        ];
        let output = self.run(repository.forge, &argv, cwd, FORGE_AUTH_TIMEOUT)?;
        if output.success {
            return Ok(());
        }
        let diagnostics = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        );
        let failure = classify_forge_failure(&diagnostics, &repository.host);
        if matches!(failure, PullRequestFailure::AuthRequired(_)) {
            return Err(failure);
        }
        Err(PullRequestFailure::ForgeError(format!(
            "The {} CLI could not check the sign-in status. {}",
            program(repository.forge).executable_name(),
            diagnostics.trim()
        )))
    }

    fn forge_command(
        &self,
        forge: ForgeKind,
        argv: &[String],
        cwd: &Path,
    ) -> Result<Command, PullRequestFailure> {
        let executable = self
            .executables
            .resolve(program(forge))
            .ok_or(PullRequestFailure::CliMissing(forge))?;
        let mut command = plan_command(&executable.path, argv, &self.home, &executable.search_path);
        command.current_dir(cwd);
        apply_forge_credentials(&mut command, forge, self.environment.as_ref());
        Ok(command)
    }

    fn run(
        &self,
        forge: ForgeKind,
        argv: &[String],
        cwd: &Path,
        timeout: Duration,
    ) -> Result<ProcessOutput, PullRequestFailure> {
        let command = self.forge_command(forge, argv, cwd)?;
        let limits = ProcessLimits {
            timeout,
            stdout_bytes: PULL_REQUEST_STDOUT_BYTES,
            stderr_bytes: PULL_REQUEST_STDERR_BYTES,
        };
        run_bounded(command, limits, &ProcessKillSwitch::default()).map_err(|error| match error {
            ProcessError::TimedOut => {
                PullRequestFailure::ForgeError("The forge did not answer in time.".to_string())
            }
            ProcessError::OutputTooLarge => PullRequestFailure::ForgeError(
                "The forge answered with too much output.".to_string(),
            ),
            ProcessError::Io => {
                PullRequestFailure::ForgeError("The forge CLI could not be started.".to_string())
            }
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PullRequestContextRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatePullRequestRequest {
    repository_root: String,
    worktree_path: Option<String>,
    base: String,
    title: String,
    body: String,
    draft: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequestContext {
    pub(crate) head_branch: Option<String>,
    pub(crate) default_base: Option<String>,
    pub(crate) base: Option<String>,
    pub(crate) commits_ahead: usize,
    pub(crate) files_changed: usize,
    pub(crate) unpushed_commits: usize,
    pub(crate) has_upstream: bool,
    pub(crate) forge: Option<ForgeKind>,
    pub(crate) cli_available: bool,
    pub(crate) commit_subjects: Vec<String>,
    pub(crate) compare_url: Option<String>,
}

pub(crate) fn pull_request_context_blocking(
    service: &PullRequestService,
    request: PullRequestContextRequest,
) -> Result<PullRequestContext, String> {
    let requested_base = request
        .base
        .as_deref()
        .map(git_branch_diff::safe_base_ref)
        .transpose()?;
    let worktree = git_surface_root(&request.repository_root, request.worktree_path.as_deref())?;
    let head = git_integration::current_branch(&worktree)?;
    let (local, _) = git_surface_status::refs(&worktree, "refs/heads")?;
    let remote = head.as_deref().and_then(|head| {
        git_integration::discover_remote(&worktree, head)
            .ok()
            .flatten()
    });
    let default = resolve_default_base(&worktree, remote.as_deref(), &local);
    let resolved = match requested_base {
        Some(requested) => Some(resolve_requested_base(
            &worktree,
            remote.as_deref(),
            &requested,
        )),
        None => default.clone(),
    };
    let hosted = remote
        .as_deref()
        .and_then(|remote| hosted_remote_named(&worktree, remote));
    let upstream = git_surface_status::upstream(&worktree);
    let (commits_ahead, files_changed, commit_subjects) = match resolved.as_ref() {
        Some(base) => branch_summary(&worktree, &base.comparison),
        None => (0, 0, Vec::new()),
    };
    let default_base = default.map(|base| base.forge_name);
    let base = resolved.map(|base| base.forge_name);
    let compare_url = match (hosted.as_ref(), base.as_deref(), head.as_deref()) {
        (Some((_, url)), Some(base), Some(head)) => git_integration::compare_url(url, base, head),
        _ => None,
    };
    Ok(PullRequestContext {
        head_branch: head,
        default_base,
        base,
        commits_ahead,
        files_changed,
        unpushed_commits: upstream
            .as_ref()
            .map_or(commits_ahead, |upstream| upstream.ahead),
        has_upstream: upstream.is_some(),
        forge: hosted.as_ref().map(|(repository, _)| repository.forge),
        cli_available: hosted
            .as_ref()
            .is_some_and(|(repository, _)| service.cli_available(repository.forge)),
        commit_subjects,
        compare_url,
    })
}

pub(crate) fn create_pull_request_blocking(
    service: &PullRequestService,
    request: CreatePullRequestRequest,
) -> Result<PullRequestReceipt, String> {
    create_pull_request_inner(service, request).map_err(PullRequestFailure::into_error_string)
}

fn create_pull_request_inner(
    service: &PullRequestService,
    request: CreatePullRequestRequest,
) -> Result<PullRequestReceipt, PullRequestFailure> {
    let base =
        git_branch_diff::safe_base_ref(&request.base).map_err(PullRequestFailure::Invalid)?;
    let validated = validate_pull_request(&request.title, &request.body, request.draft)
        .map_err(PullRequestFailure::Invalid)?;
    let root = canonicalize_workspace_root(&request.repository_root)
        .map_err(PullRequestFailure::Invalid)?;
    let targets = git_integration::resolve_ship_targets(
        &root,
        request.worktree_path.as_deref().map(Path::new),
    )
    .map_err(PullRequestFailure::Invalid)?;
    let head = git_integration::current_branch(&targets.worktree)
        .map_err(PullRequestFailure::ForgeError)?
        .ok_or_else(|| {
            PullRequestFailure::Invalid("The checkout is on a detached HEAD.".to_string())
        })?;
    let remote = git_integration::discover_remote(&targets.worktree, &head)
        .map_err(PullRequestFailure::ForgeError)?
        .ok_or(PullRequestFailure::NoRemote)?;
    let base = resolve_requested_base(&targets.worktree, Some(&remote), &base).forge_name;
    if head == base {
        return Err(PullRequestFailure::Invalid(
            "Choose a base branch different from the current branch.".to_string(),
        ));
    }
    let (repository, _) = hosted_remote_named(&targets.worktree, &remote)
        .ok_or(PullRequestFailure::UnsupportedHost)?;
    if !service.cli_available(repository.forge) {
        return Err(PullRequestFailure::CliMissing(repository.forge));
    }
    service.ensure_authenticated(&repository, &targets.worktree)?;
    let needs_push =
        git_surface_status::upstream(&targets.worktree).is_none_or(|upstream| upstream.ahead > 0);
    if needs_push {
        git_integration::push_branch_upstream(&targets)
            .map_err(|failure| PullRequestFailure::PushFailed(failure.into_error_string()))?;
    }
    let argv = pull_request_argv(&repository, &head, &base, &validated);
    let output = service.run(
        repository.forge,
        &argv,
        &targets.worktree,
        PULL_REQUEST_TIMEOUT,
    )?;
    if !output.success {
        let diagnostics = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        );
        return Err(classify_forge_failure(&diagnostics, &repository.host));
    }
    let url = created_url(&String::from_utf8_lossy(&output.stdout), &repository.host).ok_or_else(
        || {
            PullRequestFailure::ForgeError(
                "The forge CLI did not report the pull request address.".to_string(),
            )
        },
    )?;
    Ok(PullRequestReceipt {
        url,
        forge: repository.forge,
    })
}

fn hosted_remote_named(worktree: &Path, remote: &str) -> Option<(HostedRepository, String)> {
    let url =
        git_surface_status::git(worktree, &["remote", "get-url", "--push", "--", remote]).ok()?;
    let url = url.trim().to_string();
    let (host, owner, repository) = git_integration::parse_hosted_remote(&url)?;
    Some((hosted_repository(&host, &owner, &repository)?, url))
}

fn branch_summary(worktree: &Path, base: &str) -> (usize, usize, Vec<String>) {
    let range = format!("{base}..HEAD");
    let symmetric = format!("{base}...HEAD");
    let limit = format!("--max-count={MAX_CONTEXT_SUBJECTS}");
    let commits = git_surface_status::git(worktree, &["rev-list", "--count", range.as_str(), "--"])
        .ok()
        .and_then(|output| output.trim().parse().ok())
        .unwrap_or(0);
    let files =
        git_surface_status::git(worktree, &["diff", "--shortstat", symmetric.as_str(), "--"])
            .ok()
            .and_then(|output| shortstat_files(&output))
            .unwrap_or(0);
    let subjects = git_surface_status::git(
        worktree,
        &["log", "--format=%s", limit.as_str(), range.as_str(), "--"],
    )
    .map(|output| {
        output
            .lines()
            .map(|line| git_surface_status::clip_utf8(line.trim(), MAX_CONTEXT_SUBJECT_BYTES))
            .filter(|line| !line.is_empty())
            .collect()
    })
    .unwrap_or_default();
    (commits, files, subjects)
}

fn shortstat_files(output: &str) -> Option<usize> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Some(0);
    }
    trimmed.split_whitespace().next()?.parse().ok()
}

fn forge_credential_environment(forge: ForgeKind) -> &'static [&'static str] {
    match forge {
        ForgeKind::Github => &GITHUB_CREDENTIAL_ENVIRONMENT,
        ForgeKind::Gitlab => &GITLAB_CREDENTIAL_ENVIRONMENT,
    }
}

fn apply_forge_credentials(
    command: &mut Command,
    forge: ForgeKind,
    environment: &dyn Fn(&str) -> Option<OsString>,
) {
    for &key in forge_credential_environment(forge) {
        let Some(value) = environment(key) else {
            continue;
        };
        command.env(key, value);
    }
}

fn program(forge: ForgeKind) -> CliProgram {
    match forge {
        ForgeKind::Github => CliProgram::Gh,
        ForgeKind::Gitlab => CliProgram::Glab,
    }
}

fn forge_home() -> PathBuf {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return PathBuf::from("/");
    };
    if !home.is_absolute() || !home.is_dir() {
        return PathBuf::from("/");
    }
    home
}

#[tauri::command]
pub(crate) async fn get_pull_request_context(
    request: PullRequestContextRequest,
    trust: GitTrustState<'_>,
    service: State<'_, Arc<PullRequestService>>,
) -> Result<PullRequestContext, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )
    .map_err(|_| PullRequestFailure::Untrusted.into_error_string())?;
    let service = Arc::clone(&service);
    run_blocking_command(move || pull_request_context_blocking(&service, request)).await
}

#[tauri::command]
pub(crate) async fn create_pull_request(
    request: CreatePullRequestRequest,
    trust: GitTrustState<'_>,
    service: State<'_, Arc<PullRequestService>>,
) -> Result<PullRequestReceipt, String> {
    ensure_git_surface_trusted(
        &trust,
        &request.repository_root,
        request.worktree_path.as_deref(),
    )
    .map_err(|_| PullRequestFailure::Untrusted.into_error_string())?;
    let service = Arc::clone(&service);
    run_blocking_command(move || create_pull_request_blocking(&service, request)).await
}

#[cfg(test)]
#[path = "pull_request_commands_tests.rs"]
mod tests;
