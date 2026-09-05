use crate::agent_task_spawner::agent_provider::process::ExecutableIdentity;
use crate::agent_task_spawner::agent_provider::ClaudeAuthStatusCapability;
use crate::agent_task_spawner::{AgentCliInvocation, MAX_AGENT_CLI_PATH_BYTES};
use std::{
    sync::{Arc, Condvar, Mutex, MutexGuard},
    time::{Duration, Instant},
};

#[path = "agent_provider_runtime/installer.rs"]
pub(crate) mod installer;
pub use installer::{AgentProviderUpdateCandidate, ResolvedAgentProviderInstaller};

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
    updating: bool,
    signing_in: bool,
    candidate: Option<AgentProviderUpdateCandidate>,
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
            updating: false,
            signing_in: false,
            candidate: None,
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
    claude_code: Option<ProviderConfiguration>,
    codex: Option<ProviderConfiguration>,
}

pub struct AgentProviderRuntimeRegistry {
    state: Mutex<ProviderRuntimeState>,
    settlement: Condvar,
    discovery: Arc<dyn AgentProviderExecutableResolver>,
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
        }
    }

    pub fn with_discovery(discovery: Arc<dyn AgentProviderExecutableResolver>) -> Self {
        Self {
            state: Mutex::new(ProviderRuntimeState::default()),
            settlement: Condvar::new(),
            discovery,
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

    pub fn revalidate_health(&self, lease: &ProviderHealthLease) -> Result<(), String> {
        self.revalidate_health_state(lease)?;
        self.revalidate_resolution(lease.provider, &lease.policy, lease.resolved())?;
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
        configuration.updating = true;
        state.update_active = true;
        Ok(ProviderUpdateLease {
            registry: Arc::clone(self),
            provider,
            generation,
            operation_id: operation_id.to_string(),
            candidate,
        })
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
        if !expected.cli_identity.is_current_for_spawn() {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let observed = self.resolve_provider(provider, policy, false)?;
        if observed.cli_path != expected.cli_path
            || observed.cli_identity != *expected.cli_identity
            || observed.effective_path != expected.effective_path
            || observed.path_fingerprint != expected.path_fingerprint
            || observed.discovery_generation != expected.discovery_generation
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        if !expected.cli_identity.is_current_for_spawn()
            || !observed.cli_identity.is_current_for_spawn()
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
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

    pub fn revalidate_update_authority(&self, lease: &ProviderUpdateLease) -> Result<(), String> {
        if !self.update_is_current(lease) {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let policy = {
            let state = self.state();
            let configuration = configuration(&state, lease.provider)
                .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
            if configuration.generation != lease.generation {
                return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
            }
            configuration.policy.clone()
        };
        self.revalidate_resolution(
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
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
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
        self.revalidate_resolution(
            lease.provider,
            &policy,
            ResolvedProviderExecutableRef {
                cli_path: &resolved.cli_path,
                cli_identity: &resolved.cli_identity,
                effective_path: &resolved.effective_path,
                path_fingerprint: &resolved.path_fingerprint,
                discovery_generation: resolved.discovery_generation,
            },
        )?;
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

    pub fn close_operation_admission(&self) {
        let mut state = self.state();
        state.starts_closed = true;
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let claude_generation = state.next_generation;
        if let Some(configuration) = state.claude_code.as_mut() {
            configuration.generation = claude_generation;
            configuration.candidate = None;
        }
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let codex_generation = state.next_generation;
        if let Some(configuration) = state.codex.as_mut() {
            configuration.generation = codex_generation;
            configuration.candidate = None;
        }
    }

    pub fn operations_closed(&self) -> bool {
        self.state().starts_closed
    }

    pub fn shutdown_operations(&self, timeout: Duration) -> bool {
        self.close_operation_admission();
        let deadline = Instant::now() + timeout;
        let mut state = self.state();
        while state.health_count > 0 || state.update_active || sign_in_active(&state) {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            let Ok((next, result)) = self.settlement.wait_timeout(state, remaining) else {
                return false;
            };
            state = next;
            if result.timed_out()
                && (state.health_count > 0 || state.update_active || sign_in_active(&state))
            {
                return false;
            }
        }
        true
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
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NONCE: AtomicU64 = AtomicU64::new(0);

    fn executable_identity_fixture() -> ExecutableIdentity {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "codevo-provider-runtime-{}-{nonce}",
            std::process::id()
        ));
        fs::write(&path, "#!/bin/sh\nexit 0\n").expect("script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
        }
        crate::agent_task_spawner::agent_provider::process::executable_identity(
            path.to_str().expect("path"),
        )
        .expect("identity")
    }

    fn policy(path: &str) -> AgentProviderPolicy {
        AgentProviderPolicy {
            enabled: true,
            cli_path: Some(path.to_string()),
            check_for_updates: true,
        }
    }

    fn auto_policy() -> AgentProviderPolicy {
        AgentProviderPolicy {
            enabled: true,
            cli_path: None,
            check_for_updates: false,
        }
    }

    struct FakeResolver {
        resolved: Mutex<ResolvedProviderExecutable>,
        refreshes: AtomicU64,
    }

    impl FakeResolver {
        fn new(identity: ExecutableIdentity, effective_path: &str) -> Self {
            Self {
                resolved: Mutex::new(ResolvedProviderExecutable {
                    cli_path: identity.canonical_path.to_string_lossy().into_owned(),
                    cli_identity: identity,
                    effective_path: effective_path.to_string(),
                    path_fingerprint: format!("fingerprint:{effective_path}"),
                    discovery_generation: 1,
                }),
                refreshes: AtomicU64::new(0),
            }
        }

        fn replace(&self, identity: ExecutableIdentity) {
            let mut resolved = self
                .resolved
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            resolved.cli_path = identity.canonical_path.to_string_lossy().into_owned();
            resolved.cli_identity = identity;
        }

        fn refresh_authority(&self) {
            let mut resolved = self
                .resolved
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            resolved.discovery_generation = resolved.discovery_generation.wrapping_add(1).max(1);
        }
    }

    impl AgentProviderExecutableResolver for FakeResolver {
        fn resolve_provider(
            &self,
            _provider: AgentCliInvocation,
            _manual_override: Option<&str>,
            refresh: bool,
        ) -> Result<ResolvedProviderExecutable, String> {
            if refresh {
                self.refreshes.fetch_add(1, Ordering::SeqCst);
            }
            Ok(self
                .resolved
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone())
        }
    }

    #[test]
    fn automatic_turn_lease_captures_one_resolved_identity_and_effective_path() {
        let identity = executable_identity_fixture();
        let expected_path = identity.canonical_path.to_string_lossy().into_owned();
        let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
            .expect("policy");

        let lease = registry
            .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
            .expect("turn lease");

        assert_eq!(lease.cli_path, expected_path);
        assert_eq!(lease.effective_path, "/detected/bin:/usr/bin");
        assert_eq!(
            lease.cli_identity.canonical_path,
            std::path::Path::new(&lease.cli_path)
        );
        assert!(registry.revalidate_turn_authority(&lease).is_ok());
    }

    #[test]
    fn held_turn_lease_fails_after_provider_a_b_a_generation_replacement() {
        let resolver = Arc::new(FakeResolver::new(
            executable_identity_fixture(),
            "/detected/bin:/usr/bin",
        ));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
        let first = registry
            .register_policy(AgentCliInvocation::ClaudeCode, 1, None, auto_policy())
            .expect("first policy");
        let lease = registry
            .acquire_turn_for_generation(AgentCliInvocation::ClaudeCode, first.provider_generation)
            .expect("turn lease");
        let mut disabled = auto_policy();
        disabled.enabled = false;
        let second = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                2,
                Some(first.provider_generation),
                disabled,
            )
            .expect("second policy");
        registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                3,
                Some(second.provider_generation),
                auto_policy(),
            )
            .expect("third policy");

        assert_eq!(
            registry.revalidate_turn_authority(&lease),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn held_turn_lease_rejects_discovery_a_b_a_with_identical_executable_bytes() {
        let resolver = Arc::new(FakeResolver::new(
            executable_identity_fixture(),
            "/detected/bin:/usr/bin",
        ));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
            resolver.clone(),
        ));
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
            .expect("policy");
        let lease = registry
            .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
            .expect("turn lease");

        resolver.refresh_authority();

        assert_eq!(
            registry.revalidate_turn_authority(&lease),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn held_manual_override_lease_rejects_discovery_a_b_a() {
        let identity = executable_identity_fixture();
        let manual_path = identity.canonical_path.to_string_lossy().into_owned();
        let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
            resolver.clone(),
        ));
        let receipt = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                policy(&manual_path),
            )
            .expect("manual policy");
        let lease = registry
            .acquire_turn_for_generation(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
            )
            .expect("turn lease");

        resolver.refresh_authority();

        assert_eq!(
            registry.revalidate_turn_authority(&lease),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn health_refresh_re_resolves_and_identity_replacement_fails_closed() {
        let resolver = Arc::new(FakeResolver::new(
            executable_identity_fixture(),
            "/detected/bin:/usr/bin",
        ));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
            resolver.clone(),
        ));
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
            .expect("policy");
        let lease = registry
            .acquire_health_for_generation(
                AgentCliInvocation::CodexExec,
                receipt.provider_generation,
            )
            .expect("health lease");
        assert_eq!(resolver.refreshes.load(Ordering::SeqCst), 1);

        resolver.replace(executable_identity_fixture());

        assert_eq!(
            registry.revalidate_health(&lease),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn cached_health_resolution_rejects_a_path_swap_before_publication() {
        use std::os::unix::fs::PermissionsExt;

        let identity = executable_identity_fixture();
        let executable_path = identity.canonical_path.clone();
        let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
            .expect("policy");
        let lease = registry
            .acquire_health_for_generation(
                AgentCliInvocation::CodexExec,
                receipt.provider_generation,
            )
            .expect("health lease");
        let retained = executable_path.with_extension("retained");
        fs::rename(&executable_path, &retained).expect("retain executable");
        fs::write(&executable_path, "#!/bin/sh\nexit 0\n").expect("replacement executable");
        fs::set_permissions(&executable_path, fs::Permissions::from_mode(0o755))
            .expect("replacement permissions");

        assert_eq!(
            registry.revalidate_health(&lease),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );

        drop(lease);
        fs::remove_file(executable_path).expect("replacement cleanup");
        fs::remove_file(retained).expect("retained cleanup");
    }

    #[test]
    fn turns_and_updates_are_atomically_exclusive() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                policy("/cli/claude"),
            )
            .expect("policy");
        let turn = registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .expect("turn");
        assert_eq!(
            registry
                .acquire_update(
                    AgentCliInvocation::ClaudeCode,
                    receipt.provider_generation,
                    "operation-1"
                )
                .err(),
            Some(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string())
        );
        drop(turn);

        let health = registry
            .acquire_health(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .expect("health");
        let identity = executable_identity_fixture();
        registry
            .cache_candidate(
                &health,
                Some(AgentProviderUpdateCandidate {
                    cli_path: "/cli/claude".to_string(),
                    cli_identity: health.cli_identity.clone(),
                    effective_path: health.effective_path.clone(),
                    path_fingerprint: health.path_fingerprint.clone(),
                    discovery_generation: health.discovery_generation,
                    installed_version: "1.0.0".to_string(),
                    available_version: "1.1.0".to_string(),
                    installer: ResolvedAgentProviderInstaller::Npm {
                        program: identity,
                        package_name: "@anthropic-ai/claude-code".to_string(),
                    },
                }),
            )
            .expect("candidate");
        drop(health);
        let update = registry
            .acquire_update(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "operation-2",
            )
            .expect("update");
        assert_eq!(
            registry
                .acquire_turn(
                    AgentCliInvocation::ClaudeCode,
                    receipt.provider_generation,
                    "/cli/claude",
                )
                .err(),
            Some(AGENT_PROVIDER_UPDATING_ERROR.to_string())
        );
        drop(update);
        assert!(registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .is_ok());
    }

    #[test]
    fn sign_in_excludes_same_provider_turns_duplicates_and_updates() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let claude = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                policy("/cli/claude"),
            )
            .expect("claude policy");
        let codex = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/codex"))
            .expect("codex policy");

        let sign_in = registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, claude.provider_generation)
            .expect("sign in");
        assert_eq!(sign_in.cli_path, "/cli/claude");
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::ClaudeCode, claude.provider_generation,)
                .err(),
            Some(AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR.to_string())
        );
        assert_eq!(
            registry
                .acquire_turn(
                    AgentCliInvocation::ClaudeCode,
                    claude.provider_generation,
                    "/cli/claude",
                )
                .err(),
            Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
        );
        assert_eq!(
            registry
                .acquire_update(
                    AgentCliInvocation::ClaudeCode,
                    claude.provider_generation,
                    "operation-sign-in",
                )
                .err(),
            Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
        );
        assert!(registry
            .acquire_turn(
                AgentCliInvocation::CodexExec,
                codex.provider_generation,
                "/cli/codex",
            )
            .is_ok());

        drop(sign_in);
        assert!(registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                claude.provider_generation,
                "/cli/claude",
            )
            .is_ok());
    }

    #[test]
    fn turn_and_update_exclude_sign_in_and_every_failed_acquisition_releases() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                1,
                None,
                policy("/cli/claude"),
            )
            .expect("policy");
        let turn = registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .expect("turn");
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
                .err(),
            Some(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string())
        );
        drop(turn);

        let health = registry
            .acquire_health(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .expect("health");
        let identity = executable_identity_fixture();
        registry
            .cache_candidate(
                &health,
                Some(AgentProviderUpdateCandidate {
                    cli_path: "/cli/claude".to_string(),
                    cli_identity: health.cli_identity.clone(),
                    effective_path: health.effective_path.clone(),
                    path_fingerprint: health.path_fingerprint.clone(),
                    discovery_generation: health.discovery_generation,
                    installed_version: "1.0.0".to_string(),
                    available_version: "1.1.0".to_string(),
                    installer: ResolvedAgentProviderInstaller::Npm {
                        program: identity,
                        package_name: "@anthropic-ai/claude-code".to_string(),
                    },
                }),
            )
            .expect("candidate");
        drop(health);
        let update = registry
            .acquire_update(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "operation-update",
            )
            .expect("update");
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
                .err(),
            Some(AGENT_PROVIDER_UPDATING_ERROR.to_string())
        );
        drop(update);
        assert!(registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
            .is_ok());
    }

    #[test]
    fn sign_in_revalidation_fails_closed_after_policy_replacement_but_lease_still_excludes() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let first = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/a"))
            .expect("first");
        let sign_in = registry
            .acquire_sign_in(AgentCliInvocation::CodexExec, first.provider_generation)
            .expect("sign in");
        let second = registry
            .register_policy(
                AgentCliInvocation::CodexExec,
                2,
                Some(first.provider_generation),
                policy("/cli/b"),
            )
            .expect("replacement");
        assert_eq!(
            registry.revalidate_sign_in_authority(
                sign_in.provider,
                sign_in.generation,
                &sign_in.cli_path,
            ),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::CodexExec, second.provider_generation)
                .err(),
            Some(AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR.to_string())
        );
        drop(sign_in);
        assert!(registry
            .acquire_sign_in(AgentCliInvocation::CodexExec, second.provider_generation)
            .is_ok());
    }

    #[test]
    fn disabled_pathless_and_stale_sign_in_requests_fail_closed_without_stranding_a_lease() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let mut disabled = policy("/cli/claude");
        disabled.enabled = false;
        let first = registry
            .register_policy(AgentCliInvocation::ClaudeCode, 1, None, disabled)
            .expect("disabled policy");
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::ClaudeCode, first.provider_generation)
                .err(),
            Some(AGENT_PROVIDER_DISABLED_ERROR.to_string())
        );
        let pathless = AgentProviderPolicy {
            enabled: true,
            cli_path: None,
            check_for_updates: false,
        };
        let second = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                2,
                Some(first.provider_generation),
                pathless,
            )
            .expect("pathless policy");
        assert!(registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, second.provider_generation)
            .err()
            .is_some_and(|error| error.contains("not configured")));
        assert_eq!(
            registry
                .acquire_sign_in(AgentCliInvocation::ClaudeCode, first.provider_generation)
                .err(),
            Some(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn replacement_retires_old_generations_and_health_leases() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let first = registry
            .register_policy(AgentCliInvocation::ClaudeCode, 1, None, policy("/cli/a"))
            .expect("first");
        let health = registry
            .acquire_health(
                AgentCliInvocation::ClaudeCode,
                first.provider_generation,
                "/cli/a",
            )
            .expect("health");
        let second = registry
            .register_policy(
                AgentCliInvocation::ClaudeCode,
                2,
                Some(first.provider_generation),
                policy("/cli/b"),
            )
            .expect("second");
        assert_ne!(first.provider_generation, second.provider_generation);
        assert_eq!(
            registry.cache_candidate(&health, None),
            Err(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn disabled_and_stale_turns_fail_closed() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let mut claude = policy("/cli/claude");
        claude.enabled = false;
        let receipt = registry
            .register_policy(AgentCliInvocation::ClaudeCode, 1, None, claude)
            .expect("policy");
        assert_eq!(
            registry
                .acquire_turn(
                    AgentCliInvocation::ClaudeCode,
                    receipt.provider_generation,
                    "/cli/claude"
                )
                .err(),
            Some(AGENT_PROVIDER_DISABLED_ERROR.to_string())
        );
        assert_eq!(
            registry
                .acquire_turn(AgentCliInvocation::CodexExec, 0, "/cli/codex")
                .err(),
            Some(AGENT_PROVIDER_STALE_ERROR.to_string())
        );
    }

    #[test]
    fn registration_retry_is_idempotent_and_conflicts_fail_closed() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let first = registry
            .register_policy(AgentCliInvocation::CodexExec, 7, None, policy("/cli/codex"))
            .expect("first");
        let retried = registry
            .register_policy(AgentCliInvocation::CodexExec, 7, None, policy("/cli/codex"))
            .expect("retry");
        assert_eq!(first, retried);
        let mut conflict = policy("/cli/codex");
        conflict.enabled = false;
        assert_eq!(
            registry
                .register_policy(
                    AgentCliInvocation::CodexExec,
                    7,
                    Some(first.provider_generation),
                    conflict,
                )
                .unwrap_err(),
            AGENT_PROVIDER_REVISION_CONFLICT_ERROR
        );
        assert_eq!(
            registry
                .register_policy(AgentCliInvocation::CodexExec, 6, None, policy("/cli/codex"))
                .expect("reload retry"),
            first
        );
        assert_eq!(
            registry
                .register_policy(AgentCliInvocation::CodexExec, 6, None, policy("/cli/other"),)
                .unwrap_err(),
            AGENT_PROVIDER_STALE_REVISION_ERROR
        );
        let replaced = registry
            .register_policy(
                AgentCliInvocation::CodexExec,
                6,
                Some(first.provider_generation),
                policy("/cli/reloaded"),
            )
            .expect("exact generation permits a reset client revision");
        assert_ne!(replaced.provider_generation, first.provider_generation);
        assert_eq!(
            registry
                .register_policy(
                    AgentCliInvocation::CodexExec,
                    8,
                    Some(first.provider_generation),
                    policy("/cli/wrong-generation"),
                )
                .unwrap_err(),
            AGENT_PROVIDER_GENERATION_CONFLICT_ERROR
        );
    }

    #[test]
    fn update_plan_cannot_accept_an_unvalidated_version() {
        let installer = ResolvedAgentProviderInstaller::Npm {
            program: executable_identity_fixture(),
            package_name: "@openai/codex".to_string(),
        };
        assert!(installer
            .update_plan(AgentCliInvocation::CodexExec, "latest; rm", "/usr/bin:/bin")
            .is_err());
    }

    #[test]
    fn shutdown_closes_registration_and_waits_for_health_settlement() {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/codex"))
            .expect("policy");
        let health = registry
            .acquire_health(
                AgentCliInvocation::CodexExec,
                receipt.provider_generation,
                "/cli/codex",
            )
            .expect("health");
        let shutdown_registry = Arc::clone(&registry);
        let (sender, receiver) = std::sync::mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            sender
                .send(shutdown_registry.shutdown_operations(Duration::from_secs(1)))
                .expect("send result");
        });
        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        drop(health);
        assert!(receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("shutdown result"));
        shutdown.join().expect("shutdown thread");
        assert_eq!(
            registry
                .register_policy(AgentCliInvocation::CodexExec, 2, None, policy("/cli/codex"))
                .unwrap_err(),
            AGENT_PROVIDER_STALE_ERROR
        );
    }
}
