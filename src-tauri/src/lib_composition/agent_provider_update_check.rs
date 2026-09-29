use super::*;
use crate::agent_task_spawner::agent_provider::runtime::update_check::ProviderUpdateCheckLease;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderUpdateCheckResult {
    update: AgentProviderUpdateCheckOutcome,
    checked_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum AgentProviderUpdateCheckOutcome {
    Checked(AgentProviderUpdateAvailability),
    ExecutableChanged(ExecutableChanged),
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ExecutableChanged {
    ExecutableChanged,
}

#[tauri::command]
pub(crate) async fn check_agent_provider_updates(
    request: AgentProviderHealthProbeRequest,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<AgentProviderUpdateCheckResult, String> {
    let provider_registry = Arc::clone(&provider_registry);
    let cancellation = ProviderRequestCancellation::new();
    let cancelled = cancellation.flag();
    let result = run_blocking_command(move || {
        let lease = provider_registry
            .acquire_update_check(request.provider, request.provider_generation)?;
        check_updates(
            &provider_registry,
            lease,
            &cancelled,
            &PublicRegistryMetadataSource,
        )
    })
    .await;
    drop(cancellation);
    result
}

fn check_updates(
    registry: &AgentProviderRuntimeRegistry,
    lease: ProviderUpdateCheckLease,
    cancelled: &AtomicBool,
    metadata: &dyn AgentProviderReleaseMetadataSource,
) -> Result<AgentProviderUpdateCheckResult, String> {
    let is_cancelled = || {
        cancelled.load(AtomicOrdering::Acquire) || registry.revalidate_update_check(&lease).is_err()
    };
    if is_cancelled() {
        return Err("Provider update check was cancelled.".to_string());
    }
    let update = if !lease.checks_enabled {
        AgentProviderUpdateCheckOutcome::Checked(AgentProviderUpdateAvailability::ChecksDisabled)
    } else if lease.installed_version.is_some() && !lease.executable_is_current() {
        AgentProviderUpdateCheckOutcome::ExecutableChanged(ExecutableChanged::ExecutableChanged)
    } else {
        AgentProviderUpdateCheckOutcome::Checked(compare_with_latest(
            &lease,
            metadata,
            &is_cancelled,
        )?)
    };
    registry.revalidate_update_check(&lease)?;
    Ok(AgentProviderUpdateCheckResult {
        update,
        checked_at_epoch_ms: now_epoch_ms(),
    })
}

fn compare_with_latest(
    lease: &ProviderUpdateCheckLease,
    metadata: &dyn AgentProviderReleaseMetadataSource,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<AgentProviderUpdateAvailability, String> {
    let Some(installed) = lease.installed_version.as_deref() else {
        return Ok(unavailable(
            AgentProviderUpdateUnavailableReason::InvalidVersion,
        ));
    };
    let latest = metadata.latest(lease.provider, is_cancelled);
    if is_cancelled() {
        return Err("Provider update check was cancelled.".to_string());
    }
    Ok(match latest {
        Ok(latest) => match compare_versions(installed, &latest) {
            Some(Ordering::Less) => match lease.installer.clone() {
                Some(installer) => AgentProviderUpdateAvailability::Available {
                    installed_version: installed.to_string(),
                    available_version: latest,
                    installer,
                },
                None => AgentProviderUpdateAvailability::ManualUpdateAvailable {
                    installed_version: installed.to_string(),
                    available_version: latest,
                },
            },
            Some(_) => AgentProviderUpdateAvailability::Current {
                installed_version: installed.to_string(),
            },
            None => unavailable(AgentProviderUpdateUnavailableReason::InvalidVersion),
        },
        Err(_) => unavailable(AgentProviderUpdateUnavailableReason::ProbeFailed),
    })
}

fn unavailable(reason: AgentProviderUpdateUnavailableReason) -> AgentProviderUpdateAvailability {
    AgentProviderUpdateAvailability::Unavailable { reason }
}

#[cfg(test)]
#[path = "agent_provider_update_check_tests.rs"]
mod tests;
