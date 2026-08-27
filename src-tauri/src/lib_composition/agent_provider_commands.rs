use crate::agent_task_spawner::agent_provider::agent_cli_version::{
    now_epoch_ms, parse_agent_cli_version,
};
use crate::agent_task_spawner::agent_provider::process::{
    executable_identity, execute_agent_provider_plan_cancellable, resolve_package_manager,
    AgentProviderProcessFailure, AgentProviderProcessIntent, AgentProviderProcessOutput,
    AgentProviderProcessPlan,
};
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderPolicy, AgentProviderPolicyReceipt, AgentProviderRuntimeRegistry,
    AgentProviderUpdateCandidate, ProviderHealthLease, ResolvedAgentProviderInstaller,
};
use crate::agent_task_spawner::agent_provider::{
    brew_cask, claude_auth_capability, compare_versions, npm_package, parse_auth_state,
    parse_brew_available_version, parse_claude_text_auth_state, parse_npm_available_version,
    parse_npm_installed_version, sanitized_tail, AgentProviderAuthState,
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
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc,
    },
};
use tauri::State;

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
) -> Result<AgentProviderUpdateResult, String> {
    let provider_registry = Arc::clone(&provider_registry);
    let cancellation = ProviderRequestCancellation::new();
    let cancelled = cancellation.flag();
    let result = run_blocking_command(move || {
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
        if !provider_registry.update_is_current(&lease) {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                "Provider update authority changed.",
            ));
        }
        if executable_identity(&lease.candidate.cli_path).ok().as_ref()
            != Some(&lease.candidate.cli_identity)
        {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                "Provider executable identity changed.",
            ));
        }
        if !provider_registry.update_is_current(&lease) {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                "Provider update authority changed.",
            ));
        }
        let plan = match lease
            .candidate
            .installer
            .update_plan(lease.provider, &lease.candidate.available_version)
        {
            Ok(plan) => plan,
            Err(message) => {
                return Ok(update_failure(
                    AgentProviderUpdateFailureReason::AdmissionRefused,
                    &message,
                ))
            }
        };
        if !provider_registry.update_is_current(&lease) {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::AdmissionRefused,
                "Provider update authority changed.",
            ));
        }
        let output = match execute_owned(&provider_registry, &cancelled, &plan) {
            Ok(output) => output,
            Err(failure) => return Ok(process_update_failure(failure)),
        };
        if !provider_registry.update_is_current(&lease) {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::Uncertain,
                "Provider update authority changed after execution.",
            ));
        }
        let version_plan = AgentProviderProcessPlan::provider(
            &lease.candidate.cli_path,
            AgentProviderProcessIntent::InstalledVersion(lease.provider),
        )?;
        if !provider_registry.update_is_current(&lease) {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::Uncertain,
                "Provider update authority changed before verification.",
            ));
        }
        let observed = match execute_owned(&provider_registry, &cancelled, &version_plan) {
            Ok(output) => output,
            Err(failure) => return Ok(process_update_failure(failure)),
        };
        if !provider_registry.update_is_current(&lease) {
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
        if installed_version != lease.candidate.available_version {
            return Ok(update_failure(
                AgentProviderUpdateFailureReason::Uncertain,
                &format!("Provider reported version {installed_version} after update."),
            ));
        }
        Ok(AgentProviderUpdateResult::Succeeded {
            previous_version: lease.candidate.installed_version.clone(),
            installed_version,
        })
    })
    .await;
    drop(cancellation);
    result
}

fn probe_health(
    provider_registry: &AgentProviderRuntimeRegistry,
    lease: ProviderHealthLease,
    cancelled: &AtomicBool,
) -> Result<AgentProviderHealthProbeResult, String> {
    let cli_path = lease
        .policy
        .cli_path
        .as_deref()
        .ok_or_else(|| "Agent provider CLI path is not configured.".to_string())?;
    let identity = executable_identity(cli_path)?;
    provider_registry.revalidate_health(&lease)?;
    let version_plan = AgentProviderProcessPlan::provider_owned(
        identity.clone(),
        AgentProviderProcessIntent::InstalledVersion(lease.provider),
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
    );
    revalidate_health_identity(provider_registry, &lease, &identity)?;
    provider_registry.cache_candidate(&lease, candidate)?;
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
    let plan = AgentProviderProcessPlan::provider_owned(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatus(lease.provider),
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
    let Ok(plan) = AgentProviderProcessPlan::provider_owned(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode),
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
    let Ok(plan) = AgentProviderProcessPlan::provider_owned(
        identity.clone(),
        AgentProviderProcessIntent::AuthenticationStatusText(AgentCliInvocation::ClaudeCode),
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
    let cli_path = lease
        .policy
        .cli_path
        .as_deref()
        .ok_or_else(|| "Agent provider CLI path is not configured.".to_string())?;
    if executable_identity(cli_path).ok().as_ref() != Some(identity) {
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
    match probe_npm(registry, lease, cli_identity, installed_version, cancelled) {
        InstallerProbeOutcome::Resolved {
            installer,
            available_version,
        } => {
            return availability(
                lease.policy.cli_path.as_deref().unwrap_or_default(),
                cli_identity,
                installed_version,
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
    match probe_brew(registry, lease, cli_identity, installed_version, cancelled) {
        InstallerProbeOutcome::Resolved {
            installer,
            available_version,
        } => {
            return availability(
                lease.policy.cli_path.as_deref().unwrap_or_default(),
                cli_identity,
                installed_version,
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
    (
        AgentProviderUpdateAvailability::Unavailable {
            reason: AgentProviderUpdateUnavailableReason::UnknownInstaller,
        },
        None,
    )
}

enum InstallerProbeOutcome {
    NotOwned,
    Resolved {
        installer: ResolvedAgentProviderInstaller,
        available_version: String,
    },
    Unavailable(AgentProviderUpdateUnavailableReason),
}

fn probe_npm(
    registry: &AgentProviderRuntimeRegistry,
    lease: &ProviderHealthLease,
    cli_identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: &str,
    cancelled: &AtomicBool,
) -> InstallerProbeOutcome {
    let Some(npm) = resolve_package_manager("npm") else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let root_plan = AgentProviderProcessPlan::package_manager(
        npm.clone(),
        AgentProviderProcessIntent::NpmGlobalRoot,
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
    if !cli_identity.canonical_path.starts_with(&package_root) {
        return InstallerProbeOutcome::NotOwned;
    }
    let inventory_plan = AgentProviderProcessPlan::package_manager(
        npm.clone(),
        AgentProviderProcessIntent::NpmInventory,
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
    let available_plan = AgentProviderProcessPlan::package_manager(
        npm,
        AgentProviderProcessIntent::NpmAvailableVersion(lease.provider),
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
) -> InstallerProbeOutcome {
    let Some(brew) = resolve_package_manager("brew") else {
        return InstallerProbeOutcome::NotOwned;
    };
    if registry.revalidate_health(lease).is_err() {
        return InstallerProbeOutcome::Unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed,
        );
    }
    let caskroom_plan = AgentProviderProcessPlan::package_manager(
        brew.clone(),
        AgentProviderProcessIntent::BrewCaskroom(lease.provider),
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
    if !cli_identity.canonical_path.starts_with(&caskroom) {
        return InstallerProbeOutcome::NotOwned;
    }
    let outdated_plan = AgentProviderProcessPlan::package_manager(
        brew,
        AgentProviderProcessIntent::BrewOutdated(lease.provider),
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

fn availability(
    cli_path: &str,
    cli_identity: &crate::agent_task_spawner::agent_provider::process::ExecutableIdentity,
    installed_version: &str,
    available_version: String,
    installer: ResolvedAgentProviderInstaller,
) -> (
    AgentProviderUpdateAvailability,
    Option<AgentProviderUpdateCandidate>,
) {
    match compare_versions(installed_version, &available_version) {
        Some(Ordering::Less) => {
            let display = installer.display();
            (
                AgentProviderUpdateAvailability::Available {
                    installed_version: installed_version.to_string(),
                    available_version: available_version.clone(),
                    installer: display,
                },
                Some(AgentProviderUpdateCandidate {
                    cli_path: cli_path.to_string(),
                    cli_identity: cli_identity.clone(),
                    installed_version: installed_version.to_string(),
                    available_version,
                    installer,
                }),
            )
        }
        Some(_) => (
            AgentProviderUpdateAvailability::Current {
                installed_version: installed_version.to_string(),
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
            update_failure(AgentProviderUpdateFailureReason::SpawnFailed, &message)
        }
        AgentProviderProcessFailure::TimedOut { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::TimedOut,
                output_tail: sanitized_tail(&stdout, &stderr),
                output_truncated: false,
            }
        }
        AgentProviderProcessFailure::OutputLimitExceeded { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::OutputLimitExceeded,
                output_tail: sanitized_tail(&stdout, &stderr),
                output_truncated: true,
            }
        }
        AgentProviderProcessFailure::Exited { stdout, stderr } => {
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::Exited,
                output_tail: sanitized_tail(&stdout, &stderr),
                output_truncated: false,
            }
        }
        AgentProviderProcessFailure::Uncertain(message) => {
            update_failure(AgentProviderUpdateFailureReason::Uncertain, &message)
        }
    }
}

fn update_failure(
    reason: AgentProviderUpdateFailureReason,
    message: &str,
) -> AgentProviderUpdateResult {
    AgentProviderUpdateResult::Failed {
        reason,
        output_tail: sanitized_tail(message.as_bytes(), b""),
        output_truncated: false,
    }
}

fn update_failure_with_output(
    reason: AgentProviderUpdateFailureReason,
    output: &AgentProviderProcessOutput,
) -> AgentProviderUpdateResult {
    AgentProviderUpdateResult::Failed {
        reason,
        output_tail: sanitized_tail(&output.stdout, &output.stderr),
        output_truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NONCE: AtomicU64 = AtomicU64::new(0);

    fn provider_executable(body: &str) -> std::path::PathBuf {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "codevo-provider-health-{}-{nonce}",
            std::process::id()
        ));
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("provider fixture");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .expect("executable fixture");
        }
        path
    }

    #[test]
    fn policy_and_operation_requests_reject_unknown_fields() {
        let cancellation = ProviderRequestCancellation::new();
        let cancelled = cancellation.flag();
        drop(cancellation);
        assert!(cancelled.load(AtomicOrdering::Acquire));

        let accepted = serde_json::from_value::<RegisterAgentProviderPolicyRequest>(json!({
            "provider": "codex",
            "settingsRevision": 1,
            "expectedProviderGeneration": null,
            "enabled": true,
            "cliPath": "/usr/local/bin/codex",
            "checkForUpdates": false
        }));
        assert!(accepted.is_ok());
        let extra = serde_json::from_value::<RegisterAgentProviderPolicyRequest>(json!({
            "provider": "codex",
            "settingsRevision": 1,
            "expectedProviderGeneration": null,
            "enabled": true,
            "cliPath": "/usr/local/bin/codex",
            "checkForUpdates": false,
            "version": "latest"
        }));
        assert!(extra.is_err());
        let update = serde_json::from_value::<AgentProviderUpdateRequest>(json!({
            "provider": "codex",
            "providerGeneration": 2,
            "operationId": "operation-1",
            "installer": "npm"
        }));
        assert!(update.is_err());
        let query = serde_json::from_value::<GetAgentProviderPolicyRequest>(json!({
            "provider": "codex",
            "extra": true
        }));
        assert!(query.is_err());
    }

    #[test]
    fn policy_snapshots_use_the_closed_tagged_wire_shape() {
        assert_eq!(
            serde_json::to_value(AgentProviderPolicySnapshot::Unregistered).expect("unregistered"),
            json!({"kind":"unregistered"})
        );
        assert_eq!(
            serde_json::to_value(AgentProviderPolicySnapshot::Registered {
                receipt: RegisterAgentProviderPolicyReceipt {
                    provider: AgentCliInvocation::CodexExec,
                    settings_revision: 4,
                    provider_generation: 9,
                },
                enabled: true,
                cli_path: Some("/usr/local/bin/codex".to_string()),
                check_for_updates: false,
            })
            .expect("registered"),
            json!({
                "kind":"registered",
                "receipt": {
                    "provider":"codex",
                    "settingsRevision":4,
                    "providerGeneration":9
                },
                "enabled":true,
                "cliPath":"/usr/local/bin/codex",
                "checkForUpdates":false
            })
        );
    }

    #[test]
    fn health_probe_uses_the_closed_version_and_auth_plans() {
        let executable = provider_executable(
            "if [ \"$1\" = \"--version\" ]; then echo 'claude 2.1.247'; exit 0; fi\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ] && [ \"$3\" = \"--json\" ]; then echo '{\"loggedIn\":true,\"subscriptionType\":\"Pro\"}'; exit 0; fi\nexit 9",
        );
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(executable.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("policy");
        let lease = registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
            )
            .expect("health lease");
        let result = probe_health(&registry, lease, &AtomicBool::new(false)).expect("health");
        assert_eq!(result.installed_version.as_deref(), Some("2.1.247"));
        assert_eq!(
            result.auth,
            AgentProviderAuthState::SignedIn {
                label: Some("Pro".to_string())
            }
        );
        assert_eq!(
            result.update,
            AgentProviderUpdateAvailability::ChecksDisabled
        );
        fs::remove_file(executable).expect("cleanup");
    }

    #[test]
    fn claude_capabilities_select_text_unavailable_and_cache_unknown_fallback() {
        let text = provider_executable(
            "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ] && [ -z \"$3\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
        );
        let text_registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let text_receipt = text_registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(text.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("text policy");
        let text_lease = text_registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                text_receipt.provider_generation,
            )
            .expect("text lease");
        let text_identity =
            executable_identity(text.to_str().expect("text path")).expect("identity");
        assert_eq!(
            probe_auth(
                &text_registry,
                &text_lease,
                &text_identity,
                Some("2.1.83"),
                &AtomicBool::new(false),
            ),
            AgentProviderAuthState::SignedIn {
                label: Some("Claude".to_string())
            }
        );
        drop(text_lease);
        fs::remove_file(text).expect("text cleanup");

        let marker = std::env::temp_dir().join(format!(
            "codevo-provider-auth-marker-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let unavailable = provider_executable(&format!(
            "if [ \"$1\" = \"auth\" ]; then echo hit > '{}'; fi\nexit 9",
            marker.display()
        ));
        let unavailable_registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let unavailable_receipt = unavailable_registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(unavailable.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("unavailable policy");
        let unavailable_lease = unavailable_registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                unavailable_receipt.provider_generation,
            )
            .expect("unavailable lease");
        let unavailable_identity =
            executable_identity(unavailable.to_str().expect("path")).expect("unavailable identity");
        assert_eq!(
            probe_auth(
                &unavailable_registry,
                &unavailable_lease,
                &unavailable_identity,
                Some("0.2.0"),
                &AtomicBool::new(false),
            ),
            AgentProviderAuthState::Unknown
        );
        assert!(!marker.exists());
        drop(unavailable_lease);
        fs::remove_file(unavailable).expect("unavailable cleanup");

        let fallback_marker = std::env::temp_dir().join(format!(
            "codevo-provider-auth-fallback-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let fallback = provider_executable(&format!(
            "if [ \"$3\" = \"--json\" ]; then echo json >> '{}'; echo \"error: unknown option '--json'\" >&2; exit 1; fi\nif [ \"$1\" = \"auth\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
            fallback_marker.display()
        ));
        let fallback_registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let fallback_receipt = fallback_registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(fallback.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("fallback policy");
        let fallback_identity =
            executable_identity(fallback.to_str().expect("path")).expect("fallback identity");
        for _ in 0..2 {
            let lease = fallback_registry
                .acquire_health_for_generation(
                    AgentCliInvocation::ClaudeCode,
                    fallback_receipt.provider_generation,
                )
                .expect("fallback lease");
            assert!(matches!(
                probe_auth(
                    &fallback_registry,
                    &lease,
                    &fallback_identity,
                    Some("9.9.9"),
                    &AtomicBool::new(false),
                ),
                AgentProviderAuthState::SignedIn { .. }
            ));
            drop(lease);
        }
        assert_eq!(
            fs::read_to_string(&fallback_marker).expect("fallback marker"),
            "json\n"
        );
        fs::remove_file(fallback).expect("fallback cleanup");
        fs::remove_file(fallback_marker).expect("marker cleanup");

        let retry_marker = std::env::temp_dir().join(format!(
            "codevo-provider-auth-retry-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let retry = provider_executable(&format!(
            "if [ \"$3\" = \"--json\" ] && [ ! -f '{}' ]; then touch '{}'; echo transient >&2; exit 1; fi\nif [ \"$3\" = \"--json\" ]; then echo \"error: unknown option '--json'\" >&2; exit 1; fi\nif [ \"$1\" = \"auth\" ]; then echo 'Logged in using Claude'; exit 0; fi\nexit 9",
            retry_marker.display(),
            retry_marker.display()
        ));
        let retry_registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let retry_receipt = retry_registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(retry.to_string_lossy().into_owned()),
                    check_for_updates: false,
                },
            )
            .expect("retry policy");
        let retry_identity =
            executable_identity(retry.to_str().expect("path")).expect("retry identity");
        let first_retry_lease = retry_registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                retry_receipt.provider_generation,
            )
            .expect("first retry lease");
        assert_eq!(
            probe_auth(
                &retry_registry,
                &first_retry_lease,
                &retry_identity,
                Some("9.9.9"),
                &AtomicBool::new(false),
            ),
            AgentProviderAuthState::Unknown
        );
        assert_eq!(
            retry_registry.claude_auth_capability(&first_retry_lease, &retry_identity),
            None
        );
        drop(first_retry_lease);
        let second_retry_lease = retry_registry
            .acquire_health_for_generation(
                AgentCliInvocation::ClaudeCode,
                retry_receipt.provider_generation,
            )
            .expect("second retry lease");
        assert!(matches!(
            probe_auth(
                &retry_registry,
                &second_retry_lease,
                &retry_identity,
                Some("9.9.9"),
                &AtomicBool::new(false),
            ),
            AgentProviderAuthState::SignedIn { .. }
        ));
        drop(second_retry_lease);
        fs::remove_file(retry).expect("retry cleanup");
        fs::remove_file(retry_marker).expect("retry marker cleanup");
    }

    #[test]
    fn claude_fallback_requires_an_exact_unsupported_option_error() {
        assert!(unsupported_json_option(
            b"",
            b"error: unknown option '--json'"
        ));
        assert!(!unsupported_json_option(b"", b"network failed --json"));
        assert_eq!(
            bounded_absolute_path(b"/opt/homebrew/Caskroom/codex\n"),
            Some(std::path::PathBuf::from("/opt/homebrew/Caskroom/codex"))
        );
        assert_eq!(
            bounded_absolute_path(b"/opt/homebrew/Caskroom/codex\n\n"),
            None
        );
        assert_eq!(
            probe_failure_reason(&AgentProviderProcessFailure::Exited {
                stdout: Vec::new(),
                stderr: b"Error: unknown option: --cask".to_vec(),
            }),
            AgentProviderUpdateUnavailableReason::UnsupportedProbe
        );
        assert_eq!(
            probe_failure_reason(&AgentProviderProcessFailure::TimedOut {
                stdout: Vec::new(),
                stderr: Vec::new(),
            }),
            AgentProviderUpdateUnavailableReason::ProbeFailed
        );
    }
}
