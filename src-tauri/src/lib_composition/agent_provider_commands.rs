use crate::agent_task_spawner::agent_provider::agent_cli_version::{
    now_epoch_ms, parse_agent_cli_version,
};
#[cfg(test)]
use crate::agent_task_spawner::agent_provider::process::executable_identity;
use crate::agent_task_spawner::agent_provider::process::{
    execute_agent_provider_plan_cancellable,
    execute_agent_provider_update_plan_cancellable_with_output_sink,
    resolve_package_manager_on_path, AgentProviderProcessFailure, AgentProviderProcessIntent,
    AgentProviderProcessOutput, AgentProviderProcessOutputSink, AgentProviderProcessOutputStream,
    AgentProviderProcessPlan, ExecutableIdentity,
};
use crate::agent_task_spawner::agent_provider::runtime::installer::{
    bounded_home_path, native_cli_artifact_matches,
};
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderPolicy, AgentProviderPolicyReceipt, AgentProviderRuntimeRegistry,
    AgentProviderUpdateCandidate, ProviderHealthLease, ResolvedAgentProviderInstaller,
};
use crate::agent_task_spawner::agent_provider::{
    brew_cask, claude_auth_capability, compare_versions, npm_package, parse_auth_state,
    parse_brew_available_version, parse_claude_text_auth_state, parse_npm_available_version,
    parse_npm_installed_version, self_update_command, AgentProviderAuthState,
    AgentProviderHealthProbeResult, AgentProviderUpdateAvailability,
    AgentProviderUpdateFailureReason, AgentProviderUpdateResult,
    AgentProviderUpdateUnavailableReason, ClaudeAuthStatusCapability,
};
use crate::agent_task_spawner::AgentCliInvocation;
use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, State};

pub(crate) const AGENT_PROVIDER_UPDATE_PROGRESS_EVENT: &str = "agent-provider-update://progress";
const MAX_AGENT_PROVIDER_PROGRESS_DATA_BYTES: usize = 4 * 1024;
const MAX_AGENT_PROVIDER_PROGRESS_TOTAL_DATA_BYTES: usize = 1024 * 1024;
const MAX_AGENT_PROVIDER_PROGRESS_EVENTS: u32 = 4_096;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterAgentProviderPolicyRequest {
    provider: AgentCliInvocation,
    settings_revision: u64,
    expected_provider_generation: Option<u64>,
    enabled: bool,
    cli_path: Option<String>,
    check_for_updates: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterAgentProviderPolicyReceipt {
    provider: AgentCliInvocation,
    settings_revision: u64,
    provider_generation: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentProviderHealthProbeRequest {
    provider: AgentCliInvocation,
    provider_generation: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GetAgentProviderPolicyRequest {
    provider: AgentCliInvocation,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AgentProviderPolicySnapshot {
    Unregistered,
    Registered {
        receipt: RegisterAgentProviderPolicyReceipt,
        enabled: bool,
        cli_path: Option<String>,
        check_for_updates: bool,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentProviderUpdateRequest {
    provider: AgentCliInvocation,
    provider_generation: u64,
    operation_id: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentProviderUpdateProgressStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderUpdateProgressEvent {
    provider: AgentCliInvocation,
    provider_generation: u64,
    operation_id: String,
    sequence: u32,
    stream: AgentProviderUpdateProgressStream,
    data: String,
    truncated: bool,
    redacted: bool,
}

trait AgentProviderUpdateProgressSink: Send + Sync {
    fn emit(&self, event: AgentProviderUpdateProgressEvent) -> Result<(), ()>;
}

struct AppAgentProviderUpdateProgressSink(AppHandle);

impl AgentProviderUpdateProgressSink for AppAgentProviderUpdateProgressSink {
    fn emit(&self, event: AgentProviderUpdateProgressEvent) -> Result<(), ()> {
        self.0
            .emit(AGENT_PROVIDER_UPDATE_PROGRESS_EVENT, event)
            .map_err(|_| ())
    }
}

#[cfg(test)]
struct NoopAgentProviderUpdateProgressSink;

#[cfg(test)]
impl AgentProviderUpdateProgressSink for NoopAgentProviderUpdateProgressSink {
    fn emit(&self, _event: AgentProviderUpdateProgressEvent) -> Result<(), ()> {
        Ok(())
    }
}

trait AgentProviderPackageManagerLocator {
    fn resolve(&self, name: &str) -> Option<ExecutableIdentity>;
}

struct EffectivePathAgentProviderPackageManagerLocator<'a>(&'a str);

impl AgentProviderPackageManagerLocator for EffectivePathAgentProviderPackageManagerLocator<'_> {
    fn resolve(&self, name: &str) -> Option<ExecutableIdentity> {
        resolve_package_manager_on_path(name, self.0)
    }
}

#[tauri::command]
pub(crate) async fn register_agent_provider_policy(
    request: RegisterAgentProviderPolicyRequest,
    registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<RegisterAgentProviderPolicyReceipt, String> {
    let registry = Arc::clone(&registry);
    run_blocking_command(move || {
        let receipt = registry.register_policy(
            request.provider,
            request.settings_revision,
            request.expected_provider_generation,
            AgentProviderPolicy {
                enabled: request.enabled,
                cli_path: request.cli_path,
                check_for_updates: request.check_for_updates,
            },
        )?;
        Ok(wire_receipt(receipt))
    })
    .await
}

#[tauri::command]
pub(crate) fn get_agent_provider_policy(
    request: GetAgentProviderPolicyRequest,
    registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> AgentProviderPolicySnapshot {
    let Some((policy, receipt)) = registry.policy_snapshot(request.provider) else {
        return AgentProviderPolicySnapshot::Unregistered;
    };
    AgentProviderPolicySnapshot::Registered {
        receipt: wire_receipt(receipt),
        enabled: policy.enabled,
        cli_path: policy.cli_path,
        check_for_updates: policy.check_for_updates,
    }
}

fn wire_receipt(receipt: AgentProviderPolicyReceipt) -> RegisterAgentProviderPolicyReceipt {
    RegisterAgentProviderPolicyReceipt {
        provider: receipt.provider,
        settings_revision: receipt.settings_revision,
        provider_generation: receipt.provider_generation,
    }
}

#[tauri::command]
pub(crate) async fn probe_agent_provider_health(
    request: AgentProviderHealthProbeRequest,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<AgentProviderHealthProbeResult, String> {
    let provider_registry = Arc::clone(&provider_registry);
    let cancellation = ProviderRequestCancellation::new();
    let cancelled = cancellation.flag();
    let result = run_blocking_command(move || {
        let lease = provider_registry
            .acquire_health_for_generation(request.provider, request.provider_generation)?;
        probe_health(&provider_registry, lease, &cancelled)
    })
    .await;
    drop(cancellation);
    result
}

#[tauri::command]
pub(crate) async fn update_agent_provider(
    request: AgentProviderUpdateRequest,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
    app: AppHandle,
) -> Result<AgentProviderUpdateResult, String> {
    let provider_registry = Arc::clone(&provider_registry);
    let cancellation = ProviderRequestCancellation::new();
    let cancelled = cancellation.flag();
    let progress_sink: Arc<dyn AgentProviderUpdateProgressSink> =
        Arc::new(AppAgentProviderUpdateProgressSink(app));
    let result = run_blocking_command(move || {
        run_agent_provider_update_with_progress_sink(
            &provider_registry,
            &request,
            &cancelled,
            progress_sink,
        )
    })
    .await;
    drop(cancellation);
    result
}

#[cfg(test)]
fn run_agent_provider_update(
    provider_registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &AgentProviderUpdateRequest,
    cancelled: &AtomicBool,
) -> Result<AgentProviderUpdateResult, String> {
    run_agent_provider_update_with_progress_sink(
        provider_registry,
        request,
        cancelled,
        Arc::new(NoopAgentProviderUpdateProgressSink),
    )
}

fn run_agent_provider_update_with_progress_sink(
    provider_registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &AgentProviderUpdateRequest,
    cancelled: &AtomicBool,
    progress_sink: Arc<dyn AgentProviderUpdateProgressSink>,
) -> Result<AgentProviderUpdateResult, String> {
    run_agent_provider_update_with_spawn_barrier_and_progress_sink(
        provider_registry,
        request,
        cancelled,
        || {},
        progress_sink,
    )
}

#[cfg(test)]
fn run_agent_provider_update_with_spawn_barrier(
    provider_registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &AgentProviderUpdateRequest,
    cancelled: &AtomicBool,
    before_installer_spawn: impl FnOnce(),
) -> Result<AgentProviderUpdateResult, String> {
    run_agent_provider_update_with_spawn_barrier_and_progress_sink(
        provider_registry,
        request,
        cancelled,
        before_installer_spawn,
        Arc::new(NoopAgentProviderUpdateProgressSink),
    )
}

fn run_agent_provider_update_with_spawn_barrier_and_progress_sink(
    provider_registry: &Arc<AgentProviderRuntimeRegistry>,
    request: &AgentProviderUpdateRequest,
    cancelled: &AtomicBool,
    before_installer_spawn: impl FnOnce(),
    progress_sink: Arc<dyn AgentProviderUpdateProgressSink>,
) -> Result<AgentProviderUpdateResult, String> {
    let lease = provider_registry.acquire_update(
        request.provider,
        request.provider_generation,
        &request.operation_id,
    )?;
    if lease.operation_id != request.operation_id {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::AdmissionRefused,
            "Provider update operation changed.",
        ));
    }
    if provider_registry
        .revalidate_update_authority(&lease)
        .is_err()
    {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::AdmissionRefused,
            "Provider update authority changed.",
        ));
    }
    if !lease.candidate.cli_identity.is_current_for_spawn() {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::AdmissionRefused,
            "Provider executable identity changed.",
        ));
    }
    if provider_registry
        .revalidate_update_authority(&lease)
        .is_err()
    {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::AdmissionRefused,
            "Provider update authority changed.",
        ));
    }
    let plan = match lease.candidate.installer.update_plan(
        lease.provider,
        &lease.candidate.available_version,
        &lease.candidate.effective_path,
    ) {
        Ok(plan) => plan,
        Err(message) => {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                &message,
            ))
        }
    };
    if provider_registry
        .revalidate_update_authority(&lease)
        .is_err()
    {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::AdmissionRefused,
            "Provider update authority changed.",
        ));
    }
    let output = match execute_update_owned(
        provider_registry,
        cancelled,
        &lease,
        &plan,
        before_installer_spawn,
        progress_sink,
    ) {
        Ok(output) => output,
        Err(UpdateExecutionFailure::AuthorityLost) => {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                "Provider executable identity changed before installer launch.",
            ))
        }
        Err(UpdateExecutionFailure::Process(failure)) => {
            return Ok(process_update_failure(failure))
        }
    };
    if !provider_registry.update_is_current(&lease) {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::Uncertain,
            "Provider update authority changed after execution.",
        ));
    }
    let updated = match provider_registry.refresh_updated_executable(&lease) {
        Ok(resolved) => resolved,
        Err(_) => {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::Uncertain,
                "Provider executable could not be resolved after the update.",
            ));
        }
    };
    let version_plan = match AgentProviderProcessPlan::provider_owned_with_effective_path(
        updated.cli_identity.clone(),
        AgentProviderProcessIntent::InstalledVersion(lease.provider),
        &updated.effective_path,
    ) {
        Ok(plan) => plan,
        Err(_) => {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::Uncertain,
                "Provider verification could not be prepared after the update.",
            ));
        }
    };
    if provider_registry
        .revalidate_updated_executable(&lease, &updated)
        .is_err()
    {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::Uncertain,
            "Provider update authority changed before verification.",
        ));
    }
    let observed = match execute_owned(provider_registry, cancelled, &version_plan) {
        Ok(output) => output,
        Err(failure) => return Ok(process_update_failure(failure)),
    };
    if provider_registry
        .revalidate_updated_executable(&lease, &updated)
        .is_err()
    {
        return Ok(update_failure(
            AgentProviderUpdateFailureReason::Uncertain,
            "Provider update authority changed after verification.",
        ));
    }
    let Some(installed_version) = parse_version_output(&observed) else {
        return Ok(update_failure_with_output(
            AgentProviderUpdateFailureReason::Uncertain,
            &output,
        ));
    };
    if let Some(reason) = verification_failure(&lease.candidate, &installed_version) {
        return Ok(update_failure(reason, ""));
    }
    Ok(AgentProviderUpdateResult::Succeeded {
        previous_version: lease.candidate.installed_version.clone(),
        installed_version,
    })
}

fn verification_failure(
    candidate: &AgentProviderUpdateCandidate,
    installed_version: &str,
) -> Option<AgentProviderUpdateFailureReason> {
    if !matches!(
        candidate.installer,
        ResolvedAgentProviderInstaller::SelfUpdate { .. }
    ) {
        return (installed_version != candidate.available_version)
            .then_some(AgentProviderUpdateFailureReason::Uncertain);
    }
    match compare_versions(&candidate.installed_version, installed_version) {
        Some(Ordering::Less) => None,
        Some(Ordering::Equal) => Some(AgentProviderUpdateFailureReason::VersionNotAdvanced),
        _ => Some(AgentProviderUpdateFailureReason::Uncertain),
    }
}

fn probe_health(
    provider_registry: &AgentProviderRuntimeRegistry,
    lease: ProviderHealthLease,
    cancelled: &AtomicBool,
) -> Result<AgentProviderHealthProbeResult, String> {
    let effective_path = lease.effective_path.clone();
    probe_health_with_locator(
        provider_registry,
        lease,
        cancelled,
        &EffectivePathAgentProviderPackageManagerLocator(&effective_path),
    )
}

fn probe_health_with_locator(
    provider_registry: &AgentProviderRuntimeRegistry,
    lease: ProviderHealthLease,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> Result<AgentProviderHealthProbeResult, String> {
    let identity = lease.cli_identity.clone();
    provider_registry.revalidate_health(&lease)?;
    let version_plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity.clone(),
        AgentProviderProcessIntent::InstalledVersion(lease.provider),
        &lease.effective_path,
    )?;
    provider_registry.revalidate_health(&lease)?;
    let installed_output = execute_owned(provider_registry, cancelled, &version_plan)
        .map_err(|_| "Provider version probe failed.".to_string())?;
    let installed = parse_version_output(&installed_output);
    revalidate_health_identity(provider_registry, &lease, &identity)?;
    let auth = probe_auth(
        provider_registry,
        &lease,
        &identity,
        installed.as_deref(),
        cancelled,
    );
    revalidate_health_identity(provider_registry, &lease, &identity)?;
    let (update, candidate) = probe_update(
        provider_registry,
        &lease,
        &identity,
        installed.as_deref(),
        cancelled,
        package_manager_locator,
    );
    revalidate_health_identity(provider_registry, &lease, &identity)?;
    provider_registry.cache_candidate(&lease, candidate)?;
    revalidate_health_identity(provider_registry, &lease, &identity)?;
    Ok(AgentProviderHealthProbeResult {
        installed_version: installed,
        auth,
        update,
        checked_at_epoch_ms: now_epoch_ms(),
    })
}

fn probe_auth(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: Option<&str>,
    cancelled: &AtomicBool,
) -> AgentProviderAuthState {
    if lease.provider == AgentCliInvocation::ClaudeCode {
        return probe_claude_auth(registry, lease, identity, installed_version, cancelled);
    }
    let plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatus(lease.provider),
        &lease.effective_path,
    );
    let Ok(plan) = plan else {
        return AgentProviderAuthState::Unknown;
    };
    if registry.revalidate_health(lease).is_err() {
        return AgentProviderAuthState::Unknown;
    }
    match execute_owned(registry, cancelled, &plan) {
        Ok(output) => parse_auth_state(lease.provider, &output.stdout, &output.stderr),
        Err(_) => AgentProviderAuthState::Unknown,
    }
}

fn probe_claude_auth(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: Option<&str>,
    cancelled: &AtomicBool,
) -> AgentProviderAuthState {
    let cached = registry.claude_auth_capability(lease, identity);
    let selected = cached.or_else(|| installed_version.and_then(claude_auth_capability));
    if selected == Some(ClaudeAuthStatusCapability::Unavailable) {
        let _ = registry.cache_claude_auth_capability(
            lease,
            identity,
            ClaudeAuthStatusCapability::Unavailable,
        );
        return AgentProviderAuthState::Unknown;
    }
    if selected == Some(ClaudeAuthStatusCapability::Text) {
        let _ = registry.cache_claude_auth_capability(
            lease,
            identity,
            ClaudeAuthStatusCapability::Text,
        );
        return probe_claude_text_auth(registry, lease, identity, cancelled);
    }
    let Ok(plan) = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode),
        &lease.effective_path,
    ) else {
        return AgentProviderAuthState::Unknown;
    };
    if registry.revalidate_health(lease).is_err() {
        return AgentProviderAuthState::Unknown;
    }
    match execute_owned(registry, cancelled, &plan) {
        Ok(output) => {
            let _ = registry.cache_claude_auth_capability(
                lease,
                identity,
                ClaudeAuthStatusCapability::Json,
            );
            parse_auth_state(lease.provider, &output.stdout, &output.stderr)
        }
        Err(AgentProviderProcessFailure::Exited { stdout, stderr })
            if selected.is_none() && unsupported_json_option(&stdout, &stderr) =>
        {
            if revalidate_health_identity(registry, lease, identity).is_err() {
                return AgentProviderAuthState::Unknown;
            }
            let _ = registry.cache_claude_auth_capability(
                lease,
                identity,
                ClaudeAuthStatusCapability::Text,
            );
            probe_claude_text_auth(registry, lease, identity, cancelled)
        }
        Err(_) => AgentProviderAuthState::Unknown,
    }
}

fn unsupported_json_option(stdout: &[u8], stderr: &[u8]) -> bool {
    [stdout, stderr].into_iter().any(|value| {
        std::str::from_utf8(value).is_ok_and(|value| {
            let value = value.trim();
            matches!(
                value,
                "error: unknown option '--json'"
                    | "error: unexpected argument '--json' found"
                    | "Unknown option: --json"
            )
        })
    })
}

fn probe_claude_text_auth(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    cancelled: &AtomicBool,
) -> AgentProviderAuthState {
    let Ok(plan) = AgentProviderProcessPlan::provider_owned_with_effective_path(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatusText(AgentCliInvocation::ClaudeCode),
        &lease.effective_path,
    ) else {
        return AgentProviderAuthState::Unknown;
    };
    if registry.revalidate_health(lease).is_err() {
        return AgentProviderAuthState::Unknown;
    }
    let Ok(output) = execute_owned(registry, cancelled, &plan) else {
        return AgentProviderAuthState::Unknown;
    };
    parse_claude_text_auth_state(&output.stdout, &output.stderr)
}

fn revalidate_health_identity(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
) -> Result<(), String> {
    registry.revalidate_health(lease)?;
    if lease.cli_identity != *identity {
        return Err("Provider executable identity changed.".to_string());
    }
    registry.revalidate_health(lease)
}

fn probe_update(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: Option<&str>,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> (
    AgentProviderUpdateAvailability,
    Option<AgentProviderUpdateCandidate>,
) {
    if !lease.policy.check_for_updates {
        return (AgentProviderUpdateAvailability::ChecksDisabled, None);
    }
    let Some(installed_version) = installed_version else {
        return (
            AgentProviderUpdateAvailability::Unavailable {
                reason: AgentProviderUpdateUnavailableReason::InvalidVersion,
            },
            None,
        );
    };
    for probe in INSTALLER_OWNERSHIP_PROBES {
        match probe(
            registry,
            lease,
            cli_identity,
            installed_version,
            cancelled,
            package_manager_locator,
        ) {
            InstallerProbeOutcome::Resolved {
                installer,
                available_version,
            } => {
                return availability(
                    ProviderAvailabilityEvidence::new(lease, cli_identity, installed_version),
                    available_version,
                    installer,
                )
            }
            InstallerProbeOutcome::Unavailable(reason) => {
                return (
                    AgentProviderUpdateAvailability::Unavailable { reason },
                    None,
                )
            }
            InstallerProbeOutcome::NotOwned => {}
        }
        if registry.revalidate_health(lease).is_err() {
            return (
                AgentProviderUpdateAvailability::Unavailable {
                    reason: AgentProviderUpdateUnavailableReason::ProbeFailed,
                },
                None,
            );
        }
    }
    let update =
        match probe_manual_available_version(registry, lease, cancelled, package_manager_locator) {
            Ok(available_version) => {
                match compare_versions(installed_version, &available_version) {
                    Some(Ordering::Less) => {
                        AgentProviderUpdateAvailability::ManualUpdateAvailable {
                            installed_version: installed_version.to_string(),
                            available_version,
                        }
                    }
                    Some(_) => AgentProviderUpdateAvailability::Current {
                        installed_version: installed_version.to_string(),
                    },
                    None => AgentProviderUpdateAvailability::Unavailable {
                        reason: AgentProviderUpdateUnavailableReason::InvalidVersion,
                    },
                }
            }
            Err(reason) => AgentProviderUpdateAvailability::Unavailable { reason },
        };
    (update, None)
}

fn probe_manual_available_version(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> Result<String, AgentProviderUpdateUnavailableReason> {
    registry
        .revalidate_health(lease)
        .map_err(|_| AgentProviderUpdateUnavailableReason::ProbeFailed)?;
    let npm = package_manager_locator
        .resolve("npm")
        .ok_or(AgentProviderUpdateUnavailableReason::UnknownInstaller)?;
    let plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        npm,
        AgentProviderProcessIntent::NpmAvailableVersion(lease.provider),
        &lease.effective_path,
    )
    .map_err(|_| AgentProviderUpdateUnavailableReason::ProbeFailed)?;
    registry
        .revalidate_health(lease)
        .map_err(|_| AgentProviderUpdateUnavailableReason::ProbeFailed)?;
    let output = execute_owned(registry, cancelled, &plan)
        .map_err(|failure| probe_failure_reason(&failure))?;
    registry
        .revalidate_health(lease)
        .map_err(|_| AgentProviderUpdateUnavailableReason::ProbeFailed)?;
    parse_npm_available_version(&output.stdout)
        .ok_or(AgentProviderUpdateUnavailableReason::ProbeFailed)
}

enum InstallerProbeOutcome {
    NotOwned,
    Resolved {
        installer: ResolvedAgentProviderInstaller,
        available_version: String,
    },
    Unavailable(AgentProviderUpdateUnavailableReason),
}

type InstallerOwnershipProbe = fn(
    &AgentProviderRuntimeRegistry,
    &ProviderHealthLease,
    &ExecutableIdentity,
    &str,
    &AtomicBool,
    &dyn AgentProviderPackageManagerLocator,
) -> InstallerProbeOutcome;

const INSTALLER_OWNERSHIP_PROBES: [InstallerOwnershipProbe; 3] =
    [probe_npm, probe_brew, probe_host_native];

fn probe_host_native(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &ExecutableIdentity,
    _installed_version: &str,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> InstallerProbeOutcome {
    let Some(home) = bounded_home_directory() else {
        return InstallerProbeOutcome::NotOwned;
    };
    probe_native(
        registry,
        lease,
        cli_identity,
        &home,
        cancelled,
        package_manager_locator,
    )
}

fn probe_native(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &ExecutableIdentity,
    home: &Path,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> InstallerProbeOutcome {
    if !native_cli_artifact_matches(home, &cli_identity.canonical_path, lease.provider) {
        return InstallerProbeOutcome::NotOwned;
    }
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    match probe_manual_available_version(registry, lease, cancelled, package_manager_locator) {
        Ok(available_version) => InstallerProbeOutcome::Resolved {
            installer: ResolvedAgentProviderInstaller::SelfUpdate {
                program: cli_identity.clone(),
                command: self_update_command(lease.provider),
            },
            available_version,
        },
        Err(reason) => InstallerProbeOutcome::Unavailable(native_metadata_reason(reason)),
    }
}

fn native_metadata_reason(
    reason: AgentProviderUpdateUnavailableReason,
) -> AgentProviderUpdateUnavailableReason {
    if reason == AgentProviderUpdateUnavailableReason::UnknownInstaller {
        return AgentProviderUpdateUnavailableReason::ProbeFailed;
    }
    reason
}

fn bounded_home_directory() -> Option<PathBuf> {
    bounded_home_path(std::env::var("HOME").ok())
}

fn probe_npm(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: &str,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> InstallerProbeOutcome {
    let Some(npm) = package_manager_locator.resolve("npm") else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let root_plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        npm.clone(),
        AgentProviderProcessIntent::NpmGlobalRoot,
        &lease.effective_path,
    );
    let Ok(root_plan) = root_plan else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Ok(root) = execute_owned(registry, cancelled, &root_plan) else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Some(root) = bounded_absolute_path(&root.stdout) else {
        return InstallerProbeOutcome::NotOwned;
    };
    let Ok(package_root) = fs::canonicalize(root.join(npm_package(lease.provider))) else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    if !npm_cli_artifact_matches(&package_root, &cli_identity.canonical_path, lease.provider) {
        return InstallerProbeOutcome::NotOwned;
    }
    let inventory_plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        npm.clone(),
        AgentProviderProcessIntent::NpmInventory,
        &lease.effective_path,
    );
    let Ok(inventory_plan) = inventory_plan else {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let inventory = match execute_owned(registry, cancelled, &inventory_plan) {
        Ok(output) => output,
        Err(failure) => return InstallerProbeOutcome::Unavailable(probe_failure_reason(&failure)),
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    if parse_npm_installed_version(&inventory.stdout, lease.provider).as_deref()
        != Some(installed_version)
    {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::InvalidVersion,
        );
    }
    let available_plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        npm,
        AgentProviderProcessIntent::NpmAvailableVersion(lease.provider),
        &lease.effective_path,
    );
    let Ok(available_plan) = available_plan else {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let available = match execute_owned(registry, cancelled, &available_plan) {
        Ok(output) => output,
        Err(failure) => return InstallerProbeOutcome::Unavailable(probe_failure_reason(&failure)),
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Some(available_version) = parse_npm_available_version(&available.stdout) else {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    };
    InstallerProbeOutcome::Resolved {
        installer: ResolvedAgentProviderInstaller::Npm {
            program: inventory_plan.identity().clone(),
            package_name: npm_package(lease.provider).to_string(),
        },
        available_version,
    }
}

fn probe_brew(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: &str,
    cancelled: &AtomicBool,
    package_manager_locator: &dyn AgentProviderPackageManagerLocator,
) -> InstallerProbeOutcome {
    let Some(brew) = package_manager_locator.resolve("brew") else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let caskroom_plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        brew.clone(),
        AgentProviderProcessIntent::BrewCaskroom(lease.provider),
        &lease.effective_path,
    );
    let Ok(caskroom_plan) = caskroom_plan else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Ok(caskroom) = execute_owned(registry, cancelled, &caskroom_plan) else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Some(caskroom) = bounded_absolute_path(&caskroom.stdout) else {
        return InstallerProbeOutcome::NotOwned;
    };
    let Ok(caskroom) = fs::canonicalize(caskroom) else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    if !brew_cli_artifact_matches(
        &caskroom,
        &cli_identity.canonical_path,
        lease.provider,
        installed_version,
    ) {
        return InstallerProbeOutcome::NotOwned;
    }
    let outdated_plan = AgentProviderProcessPlan::package_manager_with_effective_path(
        brew,
        AgentProviderProcessIntent::BrewOutdated(lease.provider),
        &lease.effective_path,
    );
    let Ok(outdated_plan) = outdated_plan else {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let outdated = match execute_owned(registry, cancelled, &outdated_plan) {
        Ok(output) => output,
        Err(failure) => return InstallerProbeOutcome::Unavailable(probe_failure_reason(&failure)),
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let Some(available_version) = parse_brew_available_version(&outdated.stdout, lease.provider)
    else {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    };
    InstallerProbeOutcome::Resolved {
        installer: ResolvedAgentProviderInstaller::Homebrew {
            program: caskroom_plan.identity().clone(),
            cask: brew_cask(lease.provider).to_string(),
        },
        available_version: available_version.unwrap_or_else(|| installed_version.to_string()),
    }
}

fn probe_failure_reason(
    failure: &AgentProviderProcessFailure,
) -> AgentProviderUpdateUnavailableReason {
    let AgentProviderProcessFailure::Exited { stdout, stderr } = failure else {
        return AgentProviderUpdateUnavailableReason::ProbeFailed;
    };
    if [stdout, stderr].into_iter().any(|output| {
        std::str::from_utf8(output).is_ok_and(|output| {
            matches!(
                output.trim(),
                "Error: unknown option: --json=v2"
                    | "Error: unknown option: --cask"
                    | "npm ERR! unknown option --json"
            )
        })
    }) {
        return AgentProviderUpdateUnavailableReason::UnsupportedProbe;
    }
    AgentProviderUpdateUnavailableReason::ProbeFailed
}

fn bounded_absolute_path(output: &[u8]) -> Option<std::path::PathBuf> {
    if output.len() > 4096 {
        return None;
    }
    let path = std::str::from_utf8(output).ok()?;
    let path = path
        .strip_suffix("\r\n")
        .or_else(|| path.strip_suffix('\n'))
        .unwrap_or(path);
    if path.is_empty() || path.trim() != path || path.contains(['\r', '\n']) {
        return None;
    }
    let path = Path::new(path);
    path.is_absolute().then(|| path.to_path_buf())
}

fn npm_cli_artifact_matches(
    package_root: &Path,
    cli_path: &Path,
    provider: AgentCliInvocation,
) -> bool {
    let expected = match provider {
        AgentCliInvocation::ClaudeCode => package_root.join("cli.js"),
        AgentCliInvocation::CodexExec => package_root.join("bin").join("codex.js"),
    };
    cli_path == expected
}

fn brew_cli_artifact_matches(
    caskroom: &Path,
    cli_path: &Path,
    provider: AgentCliInvocation,
    installed_version: &str,
) -> bool {
    let version_root = caskroom.join(installed_version);
    let expected = match provider {
        AgentCliInvocation::ClaudeCode => version_root.join("claude"),
        AgentCliInvocation::CodexExec => version_root.join("bin").join("codex"),
    };
    cli_path == expected
}

struct ProviderAvailabilityEvidence<'a> {
    cli_path: &'a str,
    cli_identity: &'a ExecutableIdentity,
    effective_path: &'a str,
    path_fingerprint: &'a str,
    discovery_generation: u64,
    installed_version: &'a str,
}

impl<'a> ProviderAvailabilityEvidence<'a> {
    fn new(
        lease: &'a ProviderHealthLease,
        cli_identity: &'a ExecutableIdentity,
        installed_version: &'a str,
    ) -> Self {
        Self {
            cli_path: &lease.cli_path,
            cli_identity,
            effective_path: &lease.effective_path,
            path_fingerprint: &lease.path_fingerprint,
            discovery_generation: lease.discovery_generation,
            installed_version,
        }
    }
}

fn availability(
    evidence: ProviderAvailabilityEvidence<'_>,
    available_version: String,
    installer: ResolvedAgentProviderInstaller,
) -> (
    AgentProviderUpdateAvailability,
    Option<AgentProviderUpdateCandidate>,
) {
    match compare_versions(evidence.installed_version, &available_version) {
        Some(Ordering::Less) => {
            let display = installer.display();
            (
                AgentProviderUpdateAvailability::Available {
                    installed_version: evidence.installed_version.to_string(),
                    available_version: available_version.clone(),
                    installer: display,
                },
                Some(AgentProviderUpdateCandidate {
                    cli_path: evidence.cli_path.to_string(),
                    cli_identity: evidence.cli_identity.clone(),
                    effective_path: evidence.effective_path.to_string(),
                    path_fingerprint: evidence.path_fingerprint.to_string(),
                    discovery_generation: evidence.discovery_generation,
                    installed_version: evidence.installed_version.to_string(),
                    available_version,
                    installer,
                }),
            )
        }
        Some(_) => (
            AgentProviderUpdateAvailability::Current {
                installed_version: evidence.installed_version.to_string(),
            },
            None,
        ),
        None => (
            AgentProviderUpdateAvailability::Unavailable {
                reason: AgentProviderUpdateUnavailableReason::InvalidVersion,
            },
            None,
        ),
    }
}

fn execute_owned(
    registry: &AgentProviderRuntimeRegistry,
    cancelled: &AtomicBool,
    plan: &AgentProviderProcessPlan,
) -> Result<AgentProviderProcessOutput, AgentProviderProcessFailure> {
    execute_agent_provider_plan_cancellable(plan, || {
        registry.operations_closed() || cancelled.load(AtomicOrdering::Acquire)
    })
}

enum UpdateExecutionFailure {
    AuthorityLost,
    Process(AgentProviderProcessFailure),
}

struct ProviderUpdateProcessOutputSink {
    provider: AgentCliInvocation,
    provider_generation: u64,
    operation_id: String,
    sink: Arc<dyn AgentProviderUpdateProgressSink>,
    state: Mutex<ProviderUpdateProgressState>,
}

#[derive(Default)]
struct ProviderUpdateProgressState {
    sequence: u32,
    published_bytes: usize,
    exhausted: bool,
}

impl ProviderUpdateProcessOutputSink {
    fn new(
        provider: AgentCliInvocation,
        provider_generation: u64,
        operation_id: String,
        sink: Arc<dyn AgentProviderUpdateProgressSink>,
    ) -> Self {
        Self {
            provider,
            provider_generation,
            operation_id,
            sink,
            state: Mutex::new(ProviderUpdateProgressState::default()),
        }
    }

    fn publish(
        &self,
        state: &mut ProviderUpdateProgressState,
        stream: AgentProviderProcessOutputStream,
        byte_count: usize,
    ) {
        if state.exhausted {
            return;
        }
        if state.sequence >= MAX_AGENT_PROVIDER_PROGRESS_EVENTS.saturating_sub(1) {
            state.sequence = MAX_AGENT_PROVIDER_PROGRESS_EVENTS;
            state.exhausted = true;
            let data = "Additional installer activity withheld.".to_string();
            state.published_bytes = state.published_bytes.saturating_add(data.len());
            let _ = self.sink.emit(AgentProviderUpdateProgressEvent {
                provider: self.provider,
                provider_generation: self.provider_generation,
                operation_id: self.operation_id.clone(),
                sequence: state.sequence,
                stream: progress_stream(stream),
                data,
                truncated: true,
                redacted: true,
            });
            return;
        }
        let data = match stream {
            AgentProviderProcessOutputStream::Stdout => {
                format!("Installer stdout activity: {byte_count} bytes.")
            }
            AgentProviderProcessOutputStream::Stderr => {
                format!("Installer stderr activity: {byte_count} bytes.")
            }
        };
        debug_assert!(data.len() <= MAX_AGENT_PROVIDER_PROGRESS_DATA_BYTES);
        debug_assert!(
            state.published_bytes.saturating_add(data.len())
                <= MAX_AGENT_PROVIDER_PROGRESS_TOTAL_DATA_BYTES
        );
        state.published_bytes = state.published_bytes.saturating_add(data.len());
        state.sequence += 1;
        let _ = self.sink.emit(AgentProviderUpdateProgressEvent {
            provider: self.provider,
            provider_generation: self.provider_generation,
            operation_id: self.operation_id.clone(),
            sequence: state.sequence,
            stream: progress_stream(stream),
            data,
            truncated: false,
            redacted: true,
        });
    }
}

impl AgentProviderProcessOutputSink for ProviderUpdateProcessOutputSink {
    fn emit(&self, stream: AgentProviderProcessOutputStream, data: &[u8]) -> Result<(), ()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !data.is_empty() {
            self.publish(&mut state, stream, data.len());
        }
        Ok(())
    }
}

fn progress_stream(stream: AgentProviderProcessOutputStream) -> AgentProviderUpdateProgressStream {
    match stream {
        AgentProviderProcessOutputStream::Stdout => AgentProviderUpdateProgressStream::Stdout,
        AgentProviderProcessOutputStream::Stderr => AgentProviderUpdateProgressStream::Stderr,
    }
}

fn execute_update_owned(
    registry: &AgentProviderRuntimeRegistry,
    cancelled: &AtomicBool,
    lease: &crate::agent_task_spawner::agent_provider::runtime::ProviderUpdateLease,
    plan: &AgentProviderProcessPlan,
    before_spawn_validation: impl FnOnce(),
    progress_sink: Arc<dyn AgentProviderUpdateProgressSink>,
) -> Result<AgentProviderProcessOutput, UpdateExecutionFailure> {
    let authority_lost = AtomicBool::new(false);
    let process_output_sink: Arc<dyn AgentProviderProcessOutputSink> =
        Arc::new(ProviderUpdateProcessOutputSink::new(
            lease.provider,
            lease.generation,
            lease.operation_id.clone(),
            progress_sink,
        ));
    let result = execute_agent_provider_update_plan_cancellable_with_output_sink(
        plan,
        || registry.operations_closed() || cancelled.load(AtomicOrdering::Acquire),
        || {
            before_spawn_validation();
            let current = registry.revalidate_update_authority(lease).is_ok();
            if !current {
                authority_lost.store(true, AtomicOrdering::Release);
            }
            current
        },
        process_output_sink,
    );
    match result {
        Ok(_) if authority_lost.load(AtomicOrdering::Acquire) => {
            Err(UpdateExecutionFailure::AuthorityLost)
        }
        Ok(output) => Ok(output),
        Err(_) if authority_lost.load(AtomicOrdering::Acquire) => {
            Err(UpdateExecutionFailure::AuthorityLost)
        }
        Err(failure) => Err(UpdateExecutionFailure::Process(failure)),
    }
}

struct ProviderRequestCancellation {
    cancelled: Arc<AtomicBool>,
}

impl ProviderRequestCancellation {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

impl Drop for ProviderRequestCancellation {
    fn drop(&mut self) {
        self.cancelled.store(true, AtomicOrdering::Release);
    }
}

fn parse_version_output(output: &AgentProviderProcessOutput) -> Option<String> {
    std::str::from_utf8(&output.stdout)
        .ok()
        .and_then(parse_agent_cli_version)
        .or_else(|| {
            std::str::from_utf8(&output.stderr)
                .ok()
                .and_then(parse_agent_cli_version)
        })
}

fn process_update_failure(failure: AgentProviderProcessFailure) -> AgentProviderUpdateResult {
    match failure {
        AgentProviderProcessFailure::Spawn(message) => {
            drop(message);
            update_failure(AgentProviderUpdateFailureReason::SpawnFailed, "")
        }
        AgentProviderProcessFailure::TimedOut { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::TimedOut,
                output_tail: safe_installer_output_summary(&stdout, &stderr),
                output_truncated: false,
            }
        }
        AgentProviderProcessFailure::OutputLimitExceeded { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::OutputLimitExceeded,
                output_tail: safe_installer_output_summary(&stdout, &stderr),
                output_truncated: true,
            }
        }
        AgentProviderProcessFailure::Exited { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::Exited,
                output_tail: safe_installer_output_summary(&stdout, &stderr),
                output_truncated: false,
            }
        }
        AgentProviderProcessFailure::Uncertain(message) => {
            drop(message);
            update_failure(AgentProviderUpdateFailureReason::Uncertain, "")
        }
    }
}

fn update_failure(
    reason: AgentProviderUpdateFailureReason,
    _message: &str,
) -> AgentProviderUpdateResult {
    AgentProviderUpdateResult::Failed {
        reason,
        output_tail: safe_installer_output_summary(b"", b""),
        output_truncated: false,
    }
}

fn update_failure_with_output(
    reason: AgentProviderUpdateFailureReason,
    output: &AgentProviderProcessOutput,
) -> AgentProviderUpdateResult {
    AgentProviderUpdateResult::Failed {
        reason,
        output_tail: safe_installer_output_summary(&output.stdout, &output.stderr),
        output_truncated: false,
    }
}

fn safe_installer_output_summary(stdout: &[u8], stderr: &[u8]) -> String {
    format!(
        "Installer output withheld (stdout: {} bytes, stderr: {} bytes).",
        stdout.len(),
        stderr.len()
    )
}

#[cfg(test)]
#[path = "agent_provider_commands_tests.rs"]
mod tests;
