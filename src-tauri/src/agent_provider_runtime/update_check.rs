use super::*;
use crate::agent_task_spawner::agent_provider::AgentProviderInstaller;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

#[derive(Clone)]
pub(super) struct ProviderUpdateObservation {
    installed_version: String,
    installer: Option<AgentProviderInstaller>,
    executable: ExecutableStatFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutableStatFingerprint {
    provider: AgentCliInvocation,
    manual_override: Option<String>,
    effective_path: String,
    observed: Option<ExecutableStat>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExecutableStat {
    entry_point: PathBuf,
    canonical_path: PathBuf,
    size_bytes: u64,
    modified_epoch_ms: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl ExecutableStatFingerprint {
    pub fn current(
        resolver: &dyn AgentProviderExecutableResolver,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
    ) -> Self {
        Self {
            provider,
            manual_override: manual_override.map(str::to_string),
            effective_path: effective_path.to_string(),
            observed: ExecutableStat::observe(resolver, provider, manual_override, effective_path),
        }
    }

    pub fn recorded(
        resolver: &dyn AgentProviderExecutableResolver,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
        identity: &ExecutableIdentity,
    ) -> Self {
        let mut fingerprint = Self::current(resolver, provider, manual_override, effective_path);
        if !fingerprint
            .observed
            .as_ref()
            .is_some_and(|stat| stat.describes(identity))
        {
            fingerprint.observed = None;
        }
        fingerprint
    }

    pub fn is_current(&self, resolver: &dyn AgentProviderExecutableResolver) -> bool {
        let Some(recorded) = self.observed.as_ref() else {
            return false;
        };
        ExecutableStat::observe(
            resolver,
            self.provider,
            self.manual_override.as_deref(),
            &self.effective_path,
        )
        .as_ref()
            == Some(recorded)
    }
}

impl ExecutableStat {
    fn observe(
        resolver: &dyn AgentProviderExecutableResolver,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
    ) -> Option<Self> {
        let ProviderEntryPoint {
            unresolved: entry_point,
            canonical: canonical_path,
        } = resolver.entry_point(provider, manual_override, effective_path)?;
        let metadata = std::fs::metadata(&canonical_path).ok()?;
        let modified_epoch_ms = metadata
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|value| u64::try_from(value.as_millis()).ok())?;
        Some(Self {
            entry_point,
            canonical_path,
            size_bytes: metadata.len(),
            modified_epoch_ms,
            #[cfg(unix)]
            device: std::os::unix::fs::MetadataExt::dev(&metadata),
            #[cfg(unix)]
            inode: std::os::unix::fs::MetadataExt::ino(&metadata),
        })
    }

    fn describes(&self, identity: &ExecutableIdentity) -> bool {
        self.canonical_path == identity.canonical_path
            && self.size_bytes == identity.size_bytes
            && self.modified_epoch_ms == identity.modified_epoch_ms
            && self.same_platform_file(identity)
    }

    #[cfg(unix)]
    fn same_platform_file(&self, identity: &ExecutableIdentity) -> bool {
        self.device == identity.device && self.inode == identity.inode
    }

    #[cfg(not(unix))]
    fn same_platform_file(&self, _identity: &ExecutableIdentity) -> bool {
        true
    }
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
    executable: Option<ExecutableStatFingerprint>,
}

impl ProviderUpdateCheckLease {
    pub fn executable_is_current(&self) -> bool {
        self.executable
            .as_ref()
            .is_some_and(|executable| executable.is_current(self.registry.discovery.as_ref()))
    }
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
        let executable = ExecutableStatFingerprint::recorded(
            self.discovery.as_ref(),
            lease.provider,
            lease.policy.cli_path.as_deref(),
            &lease.effective_path,
            &lease.cli_identity,
        );
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
                executable,
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
            installer: observation
                .as_ref()
                .and_then(|value| value.installer.clone()),
            executable: observation.map(|value| value.executable),
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
