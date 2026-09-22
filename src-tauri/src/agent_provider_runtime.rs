use crate::agent_task_spawner::agent_provider::process::ExecutableIdentity;
use crate::agent_task_spawner::agent_provider::ClaudeAuthStatusCapability;
use crate::agent_task_spawner::{AgentCliInvocation, MAX_AGENT_CLI_PATH_BYTES};
use std::{
    sync::{Arc, Condvar, Mutex, MutexGuard},
    time::{Duration, Instant},
};

#[path = "agent_provider_runtime/codex_policy.rs"]
mod codex_policy;
pub use codex_policy::{validate_codex_policy_args, CodexTransport};

pub trait AgentProviderHostLifecycle: Send + Sync {
    fn retire_idle_hosts(&self, provider: AgentCliInvocation) -> Result<(), String>;
}

#[cfg(test)]
struct NoProviderHosts;
#[cfg(test)]
impl AgentProviderHostLifecycle for NoProviderHosts {
    fn retire_idle_hosts(&self, _provider: AgentCliInvocation) -> Result<(), String> {
        Ok(())
    }
}

#[path = "agent_provider_runtime/turn_version.rs"]
mod turn_version;

#[path = "agent_provider_runtime/lifecycle.rs"]
mod lifecycle;

#[path = "agent_provider_runtime/installer.rs"]
pub(crate) mod installer;
pub use installer::{AgentProviderUpdateCandidate, ResolvedAgentProviderInstaller};

#[path = "agent_provider_runtime/update_check.rs"]
pub(crate) mod update_check;

#[path = "agent_provider_runtime/resolution.rs"]
mod resolution;
use resolution::ResolvedProviderExecutableRef;
#[cfg(test)]
use resolution::TestProviderExecutableResolver;
pub use resolution::{AgentProviderExecutableResolver, ResolvedProviderExecutable};

pub const MAX_PROVIDER_OPERATION_ID_BYTES: usize = 128;
pub const AGENT_PROVIDER_DISABLED_ERROR: &str =
    "Enable this provider in Settings before starting a turn.";
pub const AGENT_PROVIDER_UPDATING_ERROR: &str =
    "This provider is updating. Wait for the update to finish.";
pub const AGENT_PROVIDER_STALE_ERROR: &str =
    "Agent provider settings changed. Retry the operation.";
pub const AGENT_PROVIDER_TURN_ACTIVE_ERROR: &str =
    "Stop this provider's active turns before updating.";
pub const AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR: &str =
    "This provider is signing in. Wait for sign-in to finish.";
pub const AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR: &str =
    "This provider already has an active sign-in session.";
pub const AGENT_PROVIDER_REVISION_CONFLICT_ERROR: &str = "revisionConflict";
pub const AGENT_PROVIDER_STALE_REVISION_ERROR: &str = "staleRevision";
pub const AGENT_PROVIDER_GENERATION_CONFLICT_ERROR: &str = "generationConflict";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentProviderPolicy {
    pub enabled: bool,
    pub cli_path: Option<String>,
    pub check_for_updates: bool,
    pub codex_transport: CodexTransport,
    pub codex_app_server_args: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderResolutionMismatch {
    Executable,
    Environment,
    State,
}

impl ProviderResolutionMismatch {
    fn stale_error(self) -> String {
        AGENT_PROVIDER_STALE_ERROR.to_string()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentProviderPolicyReceipt {
    pub provider: AgentCliInvocation,
    pub settings_revision: u64,
    pub provider_generation: u64,
}

#[derive(Clone)]
struct ProviderConfiguration {
    policy: AgentProviderPolicy,
    settings_revision: u64,
    generation: u64,
    turn_count: usize,
    health_count: usize,
    update_check_count: usize,
    updating: bool,
    signing_in: bool,
    candidate: Option<AgentProviderUpdateCandidate>,
    update_observation: Option<update_check::ProviderUpdateObservation>,
    update_observation_revision: u64,
    claude_auth_capability: Option<ClaudeAuthCapabilityCache>,
}

impl ProviderConfiguration {
    fn new(policy: AgentProviderPolicy, settings_revision: u64, generation: u64) -> Self {
        Self {
            policy,
            settings_revision,
            generation,
            turn_count: 0,
            health_count: 0,
            update_check_count: 0,
            updating: false,
            signing_in: false,
            candidate: None,
            update_observation: None,
            update_observation_revision: 0,
            claude_auth_capability: None,
        }
    }
}

#[derive(Default)]
struct ProviderRuntimeState {
    next_generation: u64,
    starts_closed: bool,
    update_active: bool,
    health_count: usize,
    update_check_count: usize,
    claude_code: Option<ProviderConfiguration>,
    codex: Option<ProviderConfiguration>,
}

pub struct AgentProviderRuntimeRegistry {
    state: Mutex<ProviderRuntimeState>,
    settlement: Condvar,
    discovery: Arc<dyn AgentProviderExecutableResolver>,
    host_lifecycle: Arc<dyn AgentProviderHostLifecycle>,
}

#[cfg(test)]
impl Default for AgentProviderRuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentProviderRuntimeRegistry {
    #[cfg(test)]
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ProviderRuntimeState::default()),
            settlement: Condvar::new(),
            discovery: Arc::new(TestProviderExecutableResolver),
            host_lifecycle: Arc::new(NoProviderHosts),
        }
    }

    #[cfg(test)]
    pub fn with_discovery(discovery: Arc<dyn AgentProviderExecutableResolver>) -> Self {
        Self::with_discovery_and_host_lifecycle(discovery, Arc::new(NoProviderHosts))
    }

    pub fn with_discovery_and_host_lifecycle(
        discovery: Arc<dyn AgentProviderExecutableResolver>,
        host_lifecycle: Arc<dyn AgentProviderHostLifecycle>,
    ) -> Self {
        Self {
            state: Mutex::new(ProviderRuntimeState::default()),
            settlement: Condvar::new(),
            discovery,
            host_lifecycle,
        }
    }

    pub fn register_policy(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        settings_revision: u64,
        expected_provider_generation: Option<u64>,
        policy: AgentProviderPolicy,
    ) -> Result<AgentProviderPolicyReceipt, String> {
        validate_policy(&policy)?;
        if settings_revision == 0 {
            return Err("Agent provider settings revision is invalid.".to_string());
        }
        let mut state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if state.update_active {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        let previous = configuration(&state, provider);
        if let Some(configuration) = previous {
            if settings_revision <= configuration.settings_revision
                && configuration.policy == policy
            {
                return Ok(AgentProviderPolicyReceipt {
                    provider,
                    settings_revision: configuration.settings_revision,
                    provider_generation: configuration.generation,
                });
            }
            if settings_revision == configuration.settings_revision {
                return Err(AGENT_PROVIDER_REVISION_CONFLICT_ERROR.to_string());
            }
            if expected_provider_generation != Some(configuration.generation) {
                if settings_revision < configuration.settings_revision
                    && expected_provider_generation.is_none()
                {
                    return Err(AGENT_PROVIDER_STALE_REVISION_ERROR.to_string());
                }
                return Err(AGENT_PROVIDER_GENERATION_CONFLICT_ERROR.to_string());
            }
        } else if expected_provider_generation.is_some() {
            return Err(AGENT_PROVIDER_GENERATION_CONFLICT_ERROR.to_string());
        }
        let turn_count = previous.map_or(0, |configuration| configuration.turn_count);
        let signing_in = previous.is_some_and(|configuration| configuration.signing_in);
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let provider_generation = state.next_generation;
        *configuration_slot_mut(&mut state, provider) = Some(ProviderConfiguration {
            turn_count,
            signing_in,
            ..ProviderConfiguration::new(policy, settings_revision, provider_generation)
        });
        Ok(AgentProviderPolicyReceipt {
            provider,
            settings_revision,
            provider_generation,
        })
    }

    #[cfg(test)]
    pub fn acquire_turn(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        cli_path: &str,
    ) -> Result<ProviderTurnLease, String> {
        let lease = self.acquire_turn_for_generation(provider, generation)?;
        if lease.cli_path != cli_path {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(lease)
    }

    pub fn acquire_turn_for_generation(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderTurnLease, String> {
        let policy = self.operation_policy(provider, generation)?;
        let resolved = self.resolve_provider(provider, &policy, false)?;
        let mut state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        validate_current(configuration, generation)?;
        if configuration.policy != policy {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.updating {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        if configuration.signing_in {
            return Err(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string());
        }
        configuration.turn_count = configuration.turn_count.saturating_add(1);
        Ok(ProviderTurnLease {
            registry: Arc::clone(self),
            provider,
            generation,
            policy,
            cli_path: resolved.cli_path,
            cli_identity: resolved.cli_identity,
            effective_path: resolved.effective_path,
            path_fingerprint: resolved.path_fingerprint,
            discovery_generation: resolved.discovery_generation,
        })
    }

    pub fn policy_snapshot(
        &self,
        provider: AgentCliInvocation,
    ) -> Option<(AgentProviderPolicy, AgentProviderPolicyReceipt)> {
        let state = self.state();
        let configuration = configuration(&state, provider)?;
        Some((
            configuration.policy.clone(),
            AgentProviderPolicyReceipt {
                provider,
                settings_revision: configuration.settings_revision,
                provider_generation: configuration.generation,
            },
        ))
    }

    #[cfg(test)]
    pub fn acquire_health(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        cli_path: &str,
    ) -> Result<ProviderHealthLease, String> {
        let lease = self.acquire_health_resolved(provider, generation, false)?;
        if lease.cli_path != cli_path {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(lease)
    }

    fn acquire_health_resolved(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        refresh: bool,
    ) -> Result<ProviderHealthLease, String> {
        let policy = self.operation_policy(provider, generation)?;
        let resolved = self.resolve_provider(provider, &policy, refresh)?;
        let mut state = self.state();
        if state.starts_closed || state.health_count >= 2 {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        validate_current(configuration, generation)?;
        if configuration.policy != policy {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.updating || configuration.health_count > 0 {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        configuration.update_observation_revision =
            configuration.update_observation_revision.wrapping_add(1);
        configuration.health_count += 1;
        let policy = configuration.policy.clone();
        state.health_count += 1;
        Ok(ProviderHealthLease {
            registry: Arc::clone(self),
            provider,
            generation,
            policy,
            cli_path: resolved.cli_path,
            cli_identity: resolved.cli_identity,
            effective_path: resolved.effective_path,
            path_fingerprint: resolved.path_fingerprint,
            discovery_generation: resolved.discovery_generation,
        })
    }

    pub fn acquire_health_for_generation(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderHealthLease, String> {
        self.acquire_health_resolved(provider, generation, true)
    }

    pub fn observed_health_version(
        &self,
        lease: &ProviderHealthLease,
    ) -> Result<Option<String>, String> {
        self.revalidate_health(lease)?;
        let version = self.discovery.observed_version(
            lease.provider,
            &lease.cli_identity,
            lease.discovery_generation,
        );
        self.revalidate_health(lease)?;
        Ok(version)
    }

    pub fn revalidate_health(&self, lease: &ProviderHealthLease) -> Result<(), String> {
        self.revalidate_health_state(lease)?;
        self.revalidate_resolution_with(
            lease.provider,
            &lease.policy,
            lease.resolved(),
            ResolutionEpoch::Exact,
            ResolutionValidation::Observation,
        )
        .map_err(ProviderResolutionMismatch::stale_error)?;
        self.revalidate_health_state(lease)
    }

    pub fn cache_candidate(
        &self,
        lease: &ProviderHealthLease,
        candidate: Option<AgentProviderUpdateCandidate>,
    ) -> Result<(), String> {
        self.revalidate_health(lease)?;
        if candidate.as_ref().is_some_and(|candidate| {
            candidate.cli_path != lease.cli_path
                || candidate.cli_identity != lease.cli_identity
                || candidate.effective_path != lease.effective_path
                || candidate.path_fingerprint != lease.path_fingerprint
                || candidate.discovery_generation != lease.discovery_generation
                || !candidate
                    .installer
                    .owns_provider_executable(&candidate.cli_identity)
        }) {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let mut state = self.state();
        let configuration = configuration_mut(&mut state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != lease.generation
            || configuration.policy != lease.policy
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        configuration.candidate = candidate;
        Ok(())
    }

    pub fn claude_auth_capability(
        &self,
        lease: &ProviderHealthLease,
        identity: &ExecutableIdentity,
    ) -> Option<ClaudeAuthStatusCapability> {
        let state = self.state();
        let configuration = configuration(&state, lease.provider)?;
        if configuration.generation != lease.generation || configuration.policy != lease.policy {
            return None;
        }
        let cached = configuration.claude_auth_capability.as_ref()?;
        (cached.identity == *identity).then_some(cached.capability)
    }

    pub fn cache_claude_auth_capability(
        &self,
        lease: &ProviderHealthLease,
        identity: &ExecutableIdentity,
        capability: ClaudeAuthStatusCapability,
    ) -> Result<(), String> {
        let mut state = self.state();
        let configuration = configuration_mut(&mut state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if lease.provider != AgentCliInvocation::ClaudeCode
            || configuration.generation != lease.generation
            || configuration.policy != lease.policy
            || configuration.health_count == 0
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        configuration.claude_auth_capability = Some(ClaudeAuthCapabilityCache {
            identity: identity.clone(),
            capability,
        });
        Ok(())
    }

    pub fn acquire_update(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        operation_id: &str,
    ) -> Result<ProviderUpdateLease, String> {
        validate_operation_id(operation_id)?;
        let mut state = self.state();
        if state.starts_closed || state.update_active {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != generation {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !configuration.policy.enabled || !configuration.policy.check_for_updates {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.turn_count > 0 {
            return Err(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string());
        }
        if configuration.signing_in {
            return Err(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string());
        }
        if configuration.health_count > 0 || configuration.updating {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        let candidate = configuration
            .candidate
            .clone()
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        configuration.update_observation = None;
        configuration.update_observation_revision =
            configuration.update_observation_revision.wrapping_add(1);
        configuration.updating = true;
        state.update_active = true;
        let lease = ProviderUpdateLease {
            registry: Arc::clone(self),
            provider,
            generation,
            operation_id: operation_id.to_string(),
            candidate,
        };
        drop(state);
        self.host_lifecycle.retire_idle_hosts(provider)?;
        if self.operations_closed() {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(lease)
    }

    pub fn acquire_sign_in(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderSignInLease, String> {
        let policy = self.operation_policy(provider, generation)?;
        let resolved = self.resolve_provider(provider, &policy, false)?;
        let mut state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != generation {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if configuration.policy != policy {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.turn_count > 0 {
            return Err(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string());
        }
        if configuration.updating {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        if configuration.signing_in {
            return Err(AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR.to_string());
        }
        configuration.signing_in = true;
        Ok(ProviderSignInLease {
            registry: Arc::clone(self),
            provider,
            generation,
            policy,
            cli_path: resolved.cli_path,
            cli_identity: resolved.cli_identity,
            effective_path: resolved.effective_path,
            path_fingerprint: resolved.path_fingerprint,
            discovery_generation: resolved.discovery_generation,
        })
    }

    pub fn revalidate_turn_authority(&self, lease: &ProviderTurnLease) -> Result<(), String> {
        self.revalidate_operation_state(lease.provider, lease.generation, &lease.policy)?;
        self.revalidate_resolution(lease.provider, &lease.policy, lease.resolved())?;
        self.revalidate_operation_state(lease.provider, lease.generation, &lease.policy)
    }

    pub fn revalidate_sign_in_snapshot(
        &self,
        authority: &ProviderSignInAuthority,
    ) -> Result<(), String> {
        self.revalidate_sign_in_state(authority.provider, authority.generation, &authority.policy)?;
        self.revalidate_resolution(authority.provider, &authority.policy, authority.resolved())?;
        self.revalidate_sign_in_state(authority.provider, authority.generation, &authority.policy)
    }

    #[cfg(test)]
    pub fn revalidate_sign_in_authority(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        cli_path: &str,
    ) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if state.starts_closed
            || configuration.generation != generation
            || configuration.policy.cli_path.as_deref() != Some(cli_path)
            || !configuration.policy.enabled
            || !configuration.signing_in
            || configuration.turn_count > 0
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    fn operation_policy(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<AgentProviderPolicy, String> {
        let state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration(&state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != generation {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        Ok(configuration.policy.clone())
    }

    fn resolve_provider(
        &self,
        provider: AgentCliInvocation,
        policy: &AgentProviderPolicy,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        self.discovery
            .resolve_provider(provider, policy.cli_path.as_deref(), refresh)
    }

    fn revalidate_resolution(
        &self,
        provider: AgentCliInvocation,
        policy: &AgentProviderPolicy,
        expected: ResolvedProviderExecutableRef<'_>,
    ) -> Result<(), String> {
        self.revalidate_resolution_with(
            provider,
            policy,
            expected,
            ResolutionEpoch::Exact,
            ResolutionValidation::Exact,
        )
        .map_err(ProviderResolutionMismatch::stale_error)
    }

    fn revalidate_update_resolution(
        &self,
        provider: AgentCliInvocation,
        policy: &AgentProviderPolicy,
        expected: ResolvedProviderExecutableRef<'_>,
    ) -> Result<(), ProviderResolutionMismatch> {
        self.revalidate_resolution_with(
            provider,
            policy,
            expected,
            ResolutionEpoch::NotRegressed,
            ResolutionValidation::Exact,
        )
    }

    fn revalidate_resolution_with(
        &self,
        provider: AgentCliInvocation,
        policy: &AgentProviderPolicy,
        expected: ResolvedProviderExecutableRef<'_>,
        epoch: ResolutionEpoch,
        validation: ResolutionValidation,
    ) -> Result<(), ProviderResolutionMismatch> {
        let observed = match validation {
            ResolutionValidation::Exact => self.resolve_provider(provider, policy, false),
            ResolutionValidation::Observation => self.discovery.observe_provider(
                provider,
                policy.cli_path.as_deref(),
                expected.cli_identity,
            ),
        }
        .map_err(|_| ProviderResolutionMismatch::Executable)?;
        if observed.cli_path != expected.cli_path || observed.cli_identity != *expected.cli_identity
        {
            return Err(ProviderResolutionMismatch::Executable);
        }
        if observed.effective_path != expected.effective_path
            || observed.path_fingerprint != expected.path_fingerprint
            || !epoch.accepts(observed.discovery_generation, expected.discovery_generation)
        {
            return Err(ProviderResolutionMismatch::Environment);
        }
        let current = match validation {
            ResolutionValidation::Exact => expected.cli_identity.is_current_for_spawn(),
            ResolutionValidation::Observation => expected.cli_identity.is_current_for_observation(),
        };
        if !current {
            return Err(ProviderResolutionMismatch::Executable);
        }
        Ok(())
    }

    fn revalidate_operation_state(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        policy: &AgentProviderPolicy,
    ) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if state.starts_closed
            || configuration.generation != generation
            || configuration.policy != *policy
            || !configuration.policy.enabled
            || configuration.updating
            || configuration.signing_in
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    fn revalidate_health_state(&self, lease: &ProviderHealthLease) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if state.starts_closed
            || configuration.generation != lease.generation
            || configuration.policy != lease.policy
            || configuration.health_count == 0
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    fn revalidate_sign_in_state(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        policy: &AgentProviderPolicy,
    ) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if state.starts_closed
            || configuration.generation != generation
            || configuration.policy != *policy
            || !configuration.policy.enabled
            || !configuration.signing_in
            || configuration.turn_count > 0
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    pub fn update_is_current(&self, lease: &ProviderUpdateLease) -> bool {
        let state = self.state();
        let Some(configuration) = configuration(&state, lease.provider) else {
            return false;
        };
        configuration.generation == lease.generation
            && configuration.updating
            && configuration.candidate.as_ref() == Some(&lease.candidate)
    }

    pub fn revalidate_update_authority(
        &self,
        lease: &ProviderUpdateLease,
    ) -> Result<(), ProviderResolutionMismatch> {
        if !self.update_is_current(lease) {
            return Err(ProviderResolutionMismatch::State);
        }
        let policy = {
            let state = self.state();
            let Some(configuration) = configuration(&state, lease.provider) else {
                return Err(ProviderResolutionMismatch::State);
            };
            if configuration.generation != lease.generation {
                return Err(ProviderResolutionMismatch::State);
            }
            configuration.policy.clone()
        };
        self.revalidate_update_resolution(
            lease.provider,
            &policy,
            ResolvedProviderExecutableRef {
                cli_path: &lease.candidate.cli_path,
                cli_identity: &lease.candidate.cli_identity,
                effective_path: &lease.candidate.effective_path,
                path_fingerprint: &lease.candidate.path_fingerprint,
                discovery_generation: lease.candidate.discovery_generation,
            },
        )?;
        if !self.update_is_current(lease) {
            return Err(ProviderResolutionMismatch::State);
        }
        Ok(())
    }

    pub fn refresh_updated_executable(
        &self,
        lease: &ProviderUpdateLease,
    ) -> Result<ResolvedProviderExecutable, String> {
        let policy = self.update_policy(lease)?;
        let resolved = self.resolve_provider(lease.provider, &policy, true)?;
        if !self.update_is_current(lease) {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(resolved)
    }

    pub fn revalidate_updated_executable(
        &self,
        lease: &ProviderUpdateLease,
        resolved: &ResolvedProviderExecutable,
    ) -> Result<(), String> {
        let policy = self.update_policy(lease)?;
        self.revalidate_update_resolution(
            lease.provider,
            &policy,
            ResolvedProviderExecutableRef {
                cli_path: &resolved.cli_path,
                cli_identity: &resolved.cli_identity,
                effective_path: &resolved.effective_path,
                path_fingerprint: &resolved.path_fingerprint,
                discovery_generation: resolved.discovery_generation,
            },
        )
        .map_err(ProviderResolutionMismatch::stale_error)?;
        if !self.update_is_current(lease) {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    fn update_policy(&self, lease: &ProviderUpdateLease) -> Result<AgentProviderPolicy, String> {
        if !self.update_is_current(lease) {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let state = self.state();
        let configuration = configuration(&state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != lease.generation || !configuration.updating {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(configuration.policy.clone())
    }

    fn release_turn(&self, provider: AgentCliInvocation, _generation: u64) {
        let mut state = self.state();
        let Some(configuration) = configuration_mut(&mut state, provider) else {
            return;
        };
        configuration.turn_count = configuration.turn_count.saturating_sub(1);
    }

    fn release_health(&self, provider: AgentCliInvocation, generation: u64) {
        let mut state = self.state();
        state.health_count = state.health_count.saturating_sub(1);
        self.settlement.notify_all();
        let Some(configuration) = configuration_mut(&mut state, provider) else {
            return;
        };
        if configuration.generation != generation {
            return;
        }
        configuration.health_count = configuration.health_count.saturating_sub(1);
    }

    fn release_update(&self, provider: AgentCliInvocation, generation: u64) {
        let mut state = self.state();
        state.update_active = false;
        self.settlement.notify_all();
        let Some(configuration) = configuration_mut(&mut state, provider) else {
            return;
        };
        if configuration.generation != generation {
            return;
        }
        configuration.updating = false;
        configuration.candidate = None;
    }

    fn release_sign_in(&self, provider: AgentCliInvocation) {
        let mut state = self.state();
        let Some(configuration) = configuration_mut(&mut state, provider) else {
            return;
        };
        configuration.signing_in = false;
        self.settlement.notify_all();
    }

    fn state(&self) -> MutexGuard<'_, ProviderRuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn sign_in_active(state: &ProviderRuntimeState) -> bool {
    state
        .claude_code
        .as_ref()
        .is_some_and(|configuration| configuration.signing_in)
        || state
            .codex
            .as_ref()
            .is_some_and(|configuration| configuration.signing_in)
}

fn validate_policy(policy: &AgentProviderPolicy) -> Result<(), String> {
    validate_codex_policy_args(&policy.codex_app_server_args)?;
    let Some(cli_path) = policy.cli_path.as_deref() else {
        return Ok(());
    };
    if cli_path.is_empty() || cli_path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return Err("Agent provider CLI path is invalid.".to_string());
    }
    if cli_path.trim() != cli_path || cli_path.contains('\0') {
        return Err("Agent provider CLI path is invalid.".to_string());
    }
    if !std::path::Path::new(cli_path).is_absolute() {
        return Err("Agent provider CLI path must be absolute.".to_string());
    }
    Ok(())
}

fn validate_current(configuration: &ProviderConfiguration, generation: u64) -> Result<(), String> {
    if configuration.generation != generation {
        return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
    }
    Ok(())
}

fn validate_operation_id(operation_id: &str) -> Result<(), String> {
    if operation_id.len() < 8 || operation_id.len() > MAX_PROVIDER_OPERATION_ID_BYTES {
        return Err("Provider operation id is invalid.".to_string());
    }
    if !operation_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Provider operation id is invalid.".to_string());
    }
    Ok(())
}

fn configuration(
    state: &ProviderRuntimeState,
    provider: AgentCliInvocation,
) -> Option<&ProviderConfiguration> {
    match provider {
        AgentCliInvocation::ClaudeCode => state.claude_code.as_ref(),
        AgentCliInvocation::CodexExec => state.codex.as_ref(),
    }
}

fn configuration_mut(
    state: &mut ProviderRuntimeState,
    provider: AgentCliInvocation,
) -> Option<&mut ProviderConfiguration> {
    match provider {
        AgentCliInvocation::ClaudeCode => state.claude_code.as_mut(),
        AgentCliInvocation::CodexExec => state.codex.as_mut(),
    }
}

fn configuration_slot_mut(
    state: &mut ProviderRuntimeState,
    provider: AgentCliInvocation,
) -> &mut Option<ProviderConfiguration> {
    match provider {
        AgentCliInvocation::ClaudeCode => &mut state.claude_code,
        AgentCliInvocation::CodexExec => &mut state.codex,
    }
}

#[derive(Clone, Copy)]
enum ResolutionValidation {
    Exact,
    Observation,
}

enum ResolutionEpoch {
    Exact,
    NotRegressed,
}

impl ResolutionEpoch {
    fn accepts(self, observed: u64, expected: u64) -> bool {
        match self {
            Self::Exact => observed == expected,
            Self::NotRegressed => observed >= expected,
        }
    }
}

#[derive(Clone, Debug)]
struct ClaudeAuthCapabilityCache {
    identity: ExecutableIdentity,
    capability: ClaudeAuthStatusCapability,
}

pub struct ProviderTurnLease {
    registry: Arc<AgentProviderRuntimeRegistry>,
    provider: AgentCliInvocation,
    generation: u64,
    policy: AgentProviderPolicy,
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub effective_path: String,
    pub path_fingerprint: String,
    pub discovery_generation: u64,
}

impl ProviderTurnLease {
    pub fn transport(&self) -> CodexTransport {
        self.policy.codex_transport
    }
    pub fn app_server_args(&self) -> &[String] {
        &self.policy.codex_app_server_args
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }

    fn resolved(&self) -> ResolvedProviderExecutableRef<'_> {
        ResolvedProviderExecutableRef {
            cli_path: &self.cli_path,
            cli_identity: &self.cli_identity,
            effective_path: &self.effective_path,
            path_fingerprint: &self.path_fingerprint,
            discovery_generation: self.discovery_generation,
        }
    }
}

impl Drop for ProviderTurnLease {
    fn drop(&mut self) {
        self.registry.release_turn(self.provider, self.generation);
    }
}

pub struct ProviderHealthLease {
    registry: Arc<AgentProviderRuntimeRegistry>,
    pub provider: AgentCliInvocation,
    pub generation: u64,
    pub policy: AgentProviderPolicy,
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub effective_path: String,
    pub path_fingerprint: String,
    pub discovery_generation: u64,
}

impl ProviderHealthLease {
    fn resolved(&self) -> ResolvedProviderExecutableRef<'_> {
        ResolvedProviderExecutableRef {
            cli_path: &self.cli_path,
            cli_identity: &self.cli_identity,
            effective_path: &self.effective_path,
            path_fingerprint: &self.path_fingerprint,
            discovery_generation: self.discovery_generation,
        }
    }
}

impl Drop for ProviderHealthLease {
    fn drop(&mut self) {
        self.registry.release_health(self.provider, self.generation);
    }
}

pub struct ProviderUpdateLease {
    registry: Arc<AgentProviderRuntimeRegistry>,
    pub provider: AgentCliInvocation,
    pub generation: u64,
    pub operation_id: String,
    pub candidate: AgentProviderUpdateCandidate,
}

impl Drop for ProviderUpdateLease {
    fn drop(&mut self) {
        self.registry.release_update(self.provider, self.generation);
    }
}

pub struct ProviderSignInLease {
    registry: Arc<AgentProviderRuntimeRegistry>,
    pub provider: AgentCliInvocation,
    pub generation: u64,
    policy: AgentProviderPolicy,
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub effective_path: String,
    pub path_fingerprint: String,
    pub discovery_generation: u64,
}

impl ProviderSignInLease {
    pub fn authority(&self) -> ProviderSignInAuthority {
        ProviderSignInAuthority {
            provider: self.provider,
            generation: self.generation,
            policy: self.policy.clone(),
            cli_path: self.cli_path.clone(),
            cli_identity: self.cli_identity.clone(),
            effective_path: self.effective_path.clone(),
            path_fingerprint: self.path_fingerprint.clone(),
            discovery_generation: self.discovery_generation,
        }
    }
}

#[derive(Clone)]
pub struct ProviderSignInAuthority {
    provider: AgentCliInvocation,
    generation: u64,
    policy: AgentProviderPolicy,
    cli_path: String,
    cli_identity: ExecutableIdentity,
    effective_path: String,
    path_fingerprint: String,
    discovery_generation: u64,
}

impl ProviderSignInAuthority {
    fn resolved(&self) -> ResolvedProviderExecutableRef<'_> {
        ResolvedProviderExecutableRef {
            cli_path: &self.cli_path,
            cli_identity: &self.cli_identity,
            effective_path: &self.effective_path,
            path_fingerprint: &self.path_fingerprint,
            discovery_generation: self.discovery_generation,
        }
    }
}

impl std::fmt::Debug for ProviderSignInLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderSignInLease")
            .field("provider", &self.provider)
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

impl Drop for ProviderSignInLease {
    fn drop(&mut self) {
        self.registry.release_sign_in(self.provider);
    }
}

#[cfg(test)]
#[path = "agent_provider_runtime/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "agent_provider_runtime/codex_lifecycle_tests.rs"]
mod codex_lifecycle_tests;
