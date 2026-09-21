use std::path::PathBuf;
use std::sync::Arc;
use std::{env, fs};

use super::authority::{allowance, authorize_gitlab_host, HostAuthorization, HostsRefresh};
use super::classify::classify_failure;
use super::clock::{Clock, SystemClock};
use super::hosts::{parse_glab_auth_status, GitlabHostCache, ParsedHosts};
use super::plan::{CliPlan, MAX_HOSTS_STDOUT_BYTES, MAX_STDERR_BYTES};
use super::process::{plan_command, run_bounded, ProcessError, ProcessLimits, ProcessOutput};
use super::resolver::{DiscoveryExecutableResolver, ExecutableResolver, ResolvedExecutable};
use super::sanitize::bounded_lossy_text;
use super::slot::{ProviderSlot, SlotLease, MIN_SPAWN_INTERVAL};
use super::wire::{
    RepositoryHost, RepositoryHostAuth, RepositoryHostsFailureReason, RepositoryHostsSnapshot,
    RepositoryHostsState, RepositoryLookupFailureReason, RepositoryLookupOutcome,
    RepositoryLookupRequest, RepositoryProvider, GITHUB_HOST,
};
use super::{github, gitlab};
use crate::agent_cli_discovery::AgentCliDiscovery;

pub(crate) struct RepositoryLookupService {
    executables: Arc<dyn ExecutableResolver>,
    home: PathBuf,
    github_slot: ProviderSlot,
    gitlab_slot: ProviderSlot,
    hosts_slot: ProviderSlot,
    gitlab_hosts: GitlabHostCache,
}

impl RepositoryLookupService {
    pub(crate) fn new(discovery: Arc<AgentCliDiscovery>) -> Self {
        Self::with_resolver(
            Arc::new(DiscoveryExecutableResolver::new(discovery)),
            neutral_home(),
        )
    }

    pub(crate) fn with_resolver(executables: Arc<dyn ExecutableResolver>, home: PathBuf) -> Self {
        Self::with_clock(executables, home, Arc::new(SystemClock))
    }

    pub(crate) fn with_clock(
        executables: Arc<dyn ExecutableResolver>,
        home: PathBuf,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            executables,
            home,
            github_slot: ProviderSlot::new(Arc::clone(&clock), MIN_SPAWN_INTERVAL),
            gitlab_slot: ProviderSlot::new(Arc::clone(&clock), MIN_SPAWN_INTERVAL),
            hosts_slot: ProviderSlot::new(Arc::clone(&clock), MIN_SPAWN_INTERVAL),
            gitlab_hosts: GitlabHostCache::new(clock),
        }
    }

    pub(crate) fn hosts(&self) -> RepositoryHostsSnapshot {
        let Some(lease) = self.hosts_slot.acquire() else {
            return RepositoryHostsSnapshot {
                github: busy_hosts(),
                gitlab: busy_hosts(),
            };
        };
        RepositoryHostsSnapshot {
            github: self.github_hosts_state(&lease),
            gitlab: self.gitlab_hosts_state(&lease),
        }
        .sanitized()
    }

    pub(crate) fn lookup(&self, request: RepositoryLookupRequest) -> RepositoryLookupOutcome {
        match self.authorize(&request) {
            HostAuthorization::NotAllowed => return RepositoryLookupOutcome::HostNotAllowed,
            HostAuthorization::Busy => return failed(RepositoryLookupFailureReason::Busy),
            HostAuthorization::CliMissing => return RepositoryLookupOutcome::CliMissing,
            HostAuthorization::RefreshFailed => {
                return failed(RepositoryLookupFailureReason::Unknown)
            }
            HostAuthorization::Allowed => {}
        }
        let Some(lease) = self.slot_for(request.provider).acquire() else {
            return failed(RepositoryLookupFailureReason::Busy);
        };
        let plan = lookup_plan(&request);
        let Some(executable) = self.executables.resolve(plan.program()) else {
            return RepositoryLookupOutcome::CliMissing;
        };
        let result = self.run(&executable, &plan, &lease);
        if lease.superseded() {
            return RepositoryLookupOutcome::Superseded;
        }
        let output = match result {
            Ok(output) => output,
            Err(ProcessError::TimedOut) => return RepositoryLookupOutcome::TimedOut,
            Err(ProcessError::OutputTooLarge) => {
                return failed(RepositoryLookupFailureReason::OutputTooLarge)
            }
            Err(ProcessError::Io) => return failed(RepositoryLookupFailureReason::Unknown),
        };
        if !output.success {
            return classify_failure(&output.stderr, &request.path);
        }
        let repository = match request.provider {
            RepositoryProvider::Github => github::parse_repository(&output.stdout),
            RepositoryProvider::Gitlab => gitlab::parse_repository(&request.host, &output.stdout),
        };
        let Some(repository) = repository else {
            return failed(RepositoryLookupFailureReason::InvalidOutput);
        };
        if !repository
            .full_path
            .eq_ignore_ascii_case(request.path.as_str())
        {
            return RepositoryLookupOutcome::NotFound;
        }
        RepositoryLookupOutcome::Ok { repository }.sanitized()
    }

    fn github_hosts_state(&self, lease: &SlotLease<'_>) -> RepositoryHostsState {
        let Some(executable) = self
            .executables
            .resolve(CliPlan::GithubAuthStatus.program())
        else {
            return RepositoryHostsState::CliMissing;
        };
        let output = match self.run(&executable, &CliPlan::GithubAuthStatus, lease) {
            Ok(output) => output,
            Err(error) => return hosts_failure(error),
        };
        if lease.superseded() {
            return busy_hosts();
        }
        RepositoryHostsState::Ready {
            hosts: vec![RepositoryHost {
                provider: RepositoryProvider::Github,
                host: GITHUB_HOST.to_string(),
                auth: host_auth(output.success),
            }],
            truncated: false,
        }
    }

    fn gitlab_hosts_state(&self, lease: &SlotLease<'_>) -> RepositoryHostsState {
        if let Some(cached) = self.gitlab_hosts.debounced() {
            return ready_hosts(cached);
        }
        let Some(executable) = self
            .executables
            .resolve(CliPlan::GitlabAuthStatus.program())
        else {
            self.gitlab_hosts.invalidate();
            return RepositoryHostsState::CliMissing;
        };
        let output = match self.run(&executable, &CliPlan::GitlabAuthStatus, lease) {
            Ok(output) => output,
            Err(error) => return hosts_failure(error),
        };
        if lease.superseded() {
            return busy_hosts();
        }
        let parsed = parse_glab_auth_status(&auth_status_text(&output));
        self.gitlab_hosts.store(parsed.clone());
        ready_hosts(parsed)
    }

    fn authorize(&self, request: &RepositoryLookupRequest) -> HostAuthorization {
        match request.provider {
            RepositoryProvider::Github => allowance(request.host.as_str() == GITHUB_HOST),
            RepositoryProvider::Gitlab => {
                authorize_gitlab_host(&request.host, &self.gitlab_hosts, || {
                    self.refresh_gitlab_hosts()
                })
            }
        }
    }

    fn refresh_gitlab_hosts(&self) -> HostsRefresh {
        let Some(lease) = self.hosts_slot.try_acquire() else {
            return HostsRefresh::Busy;
        };
        let Some(executable) = self
            .executables
            .resolve(CliPlan::GitlabAuthStatus.program())
        else {
            return HostsRefresh::CliMissing;
        };
        let output = self.run(&executable, &CliPlan::GitlabAuthStatus, &lease);
        if lease.superseded() {
            return HostsRefresh::Busy;
        }
        let Ok(output) = output else {
            return HostsRefresh::Failed;
        };
        let parsed = parse_glab_auth_status(&auth_status_text(&output));
        self.gitlab_hosts.store(parsed.clone());
        HostsRefresh::Parsed(parsed)
    }

    fn run(
        &self,
        executable: &ResolvedExecutable,
        plan: &CliPlan,
        lease: &SlotLease<'_>,
    ) -> Result<ProcessOutput, ProcessError> {
        let command = plan_command(
            &executable.path,
            &plan.argv(),
            &self.home,
            &executable.search_path,
        );
        let limits = ProcessLimits {
            timeout: plan.timeout(),
            stdout_bytes: plan.max_stdout_bytes(),
            stderr_bytes: MAX_STDERR_BYTES,
        };
        run_bounded(command, limits, lease.kill_switch())
    }

    pub(super) fn slot_for(&self, provider: RepositoryProvider) -> &ProviderSlot {
        match provider {
            RepositoryProvider::Github => &self.github_slot,
            RepositoryProvider::Gitlab => &self.gitlab_slot,
        }
    }

    #[cfg(test)]
    pub(super) fn hosts_slot(&self) -> &ProviderSlot {
        &self.hosts_slot
    }
}

fn lookup_plan(request: &RepositoryLookupRequest) -> CliPlan {
    match request.provider {
        RepositoryProvider::Github => CliPlan::GithubRepoView {
            path: request.path.clone(),
        },
        RepositoryProvider::Gitlab => CliPlan::GitlabProject {
            host: request.host.clone(),
            path: request.path.clone(),
        },
    }
}

fn auth_status_text(output: &ProcessOutput) -> String {
    format!(
        "{}\n{}",
        bounded_lossy_text(&output.stdout, MAX_HOSTS_STDOUT_BYTES),
        bounded_lossy_text(&output.stderr, MAX_STDERR_BYTES)
    )
}

fn ready_hosts(parsed: ParsedHosts) -> RepositoryHostsState {
    RepositoryHostsState::Ready {
        hosts: parsed.hosts,
        truncated: parsed.truncated,
    }
}

fn hosts_failure(error: ProcessError) -> RepositoryHostsState {
    let reason = match error {
        ProcessError::TimedOut => RepositoryHostsFailureReason::TimedOut,
        ProcessError::OutputTooLarge | ProcessError::Io => {
            RepositoryHostsFailureReason::InvalidOutput
        }
    };
    RepositoryHostsState::Failed { reason }
}

fn busy_hosts() -> RepositoryHostsState {
    RepositoryHostsState::Failed {
        reason: RepositoryHostsFailureReason::Busy,
    }
}

fn host_auth(authenticated: bool) -> RepositoryHostAuth {
    match authenticated {
        true => RepositoryHostAuth::Authenticated,
        false => RepositoryHostAuth::NotAuthenticated,
    }
}

fn failed(reason: RepositoryLookupFailureReason) -> RepositoryLookupOutcome {
    RepositoryLookupOutcome::Failed { reason }
}

fn neutral_home() -> PathBuf {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        return PathBuf::from("/");
    };
    if !home.is_absolute() || !fs::metadata(&home).is_ok_and(|metadata| metadata.is_dir()) {
        return PathBuf::from("/");
    }
    home
}
