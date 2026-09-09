use super::*;
use crate::agent_task_spawner::agent_provider::AgentProviderInstaller;

#[derive(Clone)]
pub(super) struct ProviderUpdateObservation {
    installed_version: String,
    installer: Option<AgentProviderInstaller>,
}

pub struct ProviderUpdateCheckLease {
    registry: Arc<AgentProviderRuntimeRegistry>,
    pub provider: AgentCliInvocation,
    generation: u64,
    observation_revision: u64,
    policy: AgentProviderPolicy,
    pub installed_version: Option<String>,
    pub installer: Option<AgentProviderInstaller>,
    pub checks_enabled: bool,
}

impl Drop for ProviderUpdateCheckLease {
    fn drop(&mut self) {
        self.registry
            .release_update_check(self.provider, self.generation);
    }
}

impl AgentProviderRuntimeRegistry {
    fn release_update_check(&self, provider: AgentCliInvocation, generation: u64) {
        let mut state = self.state();
        state.update_check_count = state.update_check_count.saturating_sub(1);
        self.settlement.notify_all();
        if let Some(configuration) = configuration_mut(&mut state, provider) {
            if configuration.generation == generation {
                configuration.update_check_count =
                    configuration.update_check_count.saturating_sub(1);
            }
        }
    }

    pub fn cache_update_observation(
        &self,
        lease: &ProviderHealthLease,
        installed_version: Option<String>,
        installer: Option<AgentProviderInstaller>,
    ) -> Result<(), String> {
        self.revalidate_health(lease)?;
        let mut state = self.state();
        let configuration = configuration_mut(&mut state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != lease.generation || configuration.policy != lease.policy {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        configuration.update_observation =
            installed_version.map(|installed_version| ProviderUpdateObservation {
                installed_version,
                installer,
            });
        Ok(())
    }

    pub fn acquire_update_check(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderUpdateCheckLease, String> {
        let mut state = self.state();
        if state.starts_closed || state.update_check_count >= 2 {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        validate_current(configuration, generation)?;
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.updating
            || configuration.health_count > 0
            || configuration.update_check_count > 0
        {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        configuration.update_check_count += 1;
        let observation = configuration.update_observation.clone();
        let lease = ProviderUpdateCheckLease {
            registry: Arc::clone(self),
            provider,
            generation,
            observation_revision: configuration.update_observation_revision,
            policy: configuration.policy.clone(),
            checks_enabled: configuration.policy.check_for_updates,
            installed_version: observation
                .as_ref()
                .map(|value| value.installed_version.clone()),
            installer: observation.and_then(|value| value.installer),
        };
        state.update_check_count += 1;
        Ok(lease)
    }

    pub fn revalidate_update_check(&self, lease: &ProviderUpdateCheckLease) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if state.starts_closed
            || configuration.generation != lease.generation
            || configuration.policy != lease.policy
            || configuration.update_check_count == 0
            || configuration.update_observation_revision != lease.observation_revision
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "update_check_tests.rs"]
pub(crate) mod tests;
