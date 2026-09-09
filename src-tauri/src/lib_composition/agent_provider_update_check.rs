use super::*;
use crate::agent_task_spawner::agent_provider::runtime::update_check::ProviderUpdateCheckLease;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderUpdateCheckResult {
    update: AgentProviderUpdateAvailability,
    checked_at_epoch_ms: u64,
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
        AgentProviderUpdateAvailability::ChecksDisabled
    } else if let Some(installed) = lease.installed_version.as_deref() {
        let latest = metadata.latest(lease.provider, &is_cancelled);
        if is_cancelled() {
            return Err("Provider update check was cancelled.".to_string());
        }
        match latest {
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
        }
    } else {
        unavailable(AgentProviderUpdateUnavailableReason::InvalidVersion)
    };
    registry.revalidate_update_check(&lease)?;
    Ok(AgentProviderUpdateCheckResult {
        update,
        checked_at_epoch_ms: now_epoch_ms(),
    })
}

fn unavailable(reason: AgentProviderUpdateUnavailableReason) -> AgentProviderUpdateAvailability {
    AgentProviderUpdateAvailability::Unavailable { reason }
}

#[cfg(test)]
#[path = "agent_provider_update_check_tests.rs"]
mod tests;
