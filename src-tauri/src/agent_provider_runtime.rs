use crate::agent_task_spawner::agent_provider::process::{
    AgentProviderProcessPlan, ExecutableIdentity,
};
use crate::agent_task_spawner::agent_provider::{
    AgentProviderInstaller, ClaudeAuthStatusCapability,
};
use crate::agent_task_spawner::{AgentCliInvocation, MAX_AGENT_CLI_PATH_BYTES};
use std::{
    sync::{Arc, Condvar, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const MAX_PROVIDER_OPERATION_ID_BYTES: usize = 128;
pub const AGENT_PROVIDER_DISABLED_ERROR: &str =
    "Enable this provider in Settings before starting a turn.";
pub const AGENT_PROVIDER_UPDATING_ERROR: &str =
    "This provider is updating. Wait for the update to finish.";
pub const AGENT_PROVIDER_STALE_ERROR: &str =
    "Agent provider settings changed. Retry the operation.";
pub const AGENT_PROVIDER_TURN_ACTIVE_ERROR: &str =
    "Stop this provider's active turns before updating.";
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
}

impl Default for AgentProviderRuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentProviderRuntimeRegistry {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(ProviderRuntimeState::default()),
            settlement: Condvar::new(),
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
        state.next_generation = state.next_generation.wrapping_add(1).max(1);
        let provider_generation = state.next_generation;
        *configuration_slot_mut(&mut state, provider) = Some(ProviderConfiguration {
            turn_count,
            ..ProviderConfiguration::new(policy, settings_revision, provider_generation)
        });
        Ok(AgentProviderPolicyReceipt {
            provider,
            settings_revision,
            provider_generation,
        })
    }

    pub fn acquire_turn(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        cli_path: &str,
    ) -> Result<ProviderTurnLease, String> {
        let mut state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        validate_current(configuration, generation, cli_path)?;
        if !configuration.policy.enabled {
            return Err(AGENT_PROVIDER_DISABLED_ERROR.to_string());
        }
        if configuration.updating {
            return Err(AGENT_PROVIDER_UPDATING_ERROR.to_string());
        }
        configuration.turn_count = configuration.turn_count.saturating_add(1);
        Ok(ProviderTurnLease {
            registry: Arc::clone(self),
            provider,
            generation,
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

    pub fn acquire_health(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
        cli_path: &str,
    ) -> Result<ProviderHealthLease, String> {
        let mut state = self.state();
        if state.starts_closed || state.health_count >= 2 {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration_mut(&mut state, provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        validate_current(configuration, generation, cli_path)?;
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
        })
    }

    pub fn acquire_health_for_generation(
        self: &Arc<Self>,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderHealthLease, String> {
        let cli_path = {
            let state = self.state();
            let configuration = configuration(&state, provider)
                .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
            if configuration.generation != generation {
                return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
            }
            configuration
                .policy
                .cli_path
                .clone()
                .ok_or_else(|| "Agent provider CLI path is not configured.".to_string())?
        };
        self.acquire_health(provider, generation, &cli_path)
    }

    pub fn revalidate_health(&self, lease: &ProviderHealthLease) -> Result<(), String> {
        let state = self.state();
        let configuration = configuration(&state, lease.provider)
            .ok_or_else(|| AGENT_PROVIDER_STALE_ERROR.to_string())?;
        if configuration.generation != lease.generation
            || configuration.policy != lease.policy
            || configuration.health_count == 0
            || configuration.updating
        {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        Ok(())
    }

    pub fn cache_candidate(
        &self,
        lease: &ProviderHealthLease,
        candidate: Option<AgentProviderUpdateCandidate>,
    ) -> Result<(), String> {
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

    pub fn update_is_current(&self, lease: &ProviderUpdateLease) -> bool {
        let state = self.state();
        let Some(configuration) = configuration(&state, lease.provider) else {
            return false;
        };
        configuration.generation == lease.generation
            && configuration.updating
            && configuration.candidate.as_ref() == Some(&lease.candidate)
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
        while state.health_count > 0 || state.update_active {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let remaining = deadline.saturating_duration_since(now);
            let Ok((next, result)) = self.settlement.wait_timeout(state, remaining) else {
                return false;
            };
            state = next;
            if result.timed_out() && (state.health_count > 0 || state.update_active) {
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

    fn state(&self) -> MutexGuard<'_, ProviderRuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
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

fn validate_current(
    configuration: &ProviderConfiguration,
    generation: u64,
    cli_path: &str,
) -> Result<(), String> {
    if configuration.generation != generation
        || configuration.policy.cli_path.as_deref() != Some(cli_path)
    {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedAgentProviderInstaller {
    Npm {
        program: ExecutableIdentity,
        package_name: String,
    },
    Homebrew {
        program: ExecutableIdentity,
        cask: String,
    },
}

impl ResolvedAgentProviderInstaller {
    pub fn display(&self) -> AgentProviderInstaller {
        match self {
            Self::Npm { package_name, .. } => AgentProviderInstaller::Npm {
                package_name: package_name.clone(),
            },
            Self::Homebrew { cask, .. } => AgentProviderInstaller::Homebrew { cask: cask.clone() },
        }
    }

    pub fn update_plan(
        &self,
        provider: AgentCliInvocation,
        version: &str,
    ) -> Result<AgentProviderProcessPlan, String> {
        let plan = match self {
            Self::Npm { program, .. } => AgentProviderProcessPlan::package_manager(
                program.clone(),
                crate::agent_task_spawner::agent_provider::process::AgentProviderProcessIntent::NpmUpdate {
                    provider,
                    version: version.to_string(),
                },
            ),
            Self::Homebrew { program, .. } => AgentProviderProcessPlan::package_manager(
                program.clone(),
                crate::agent_task_spawner::agent_provider::process::AgentProviderProcessIntent::BrewUpdate(provider),
            ),
        }?;
        let expected = match self {
            Self::Npm { program, .. } | Self::Homebrew { program, .. } => program,
        };
        if plan.identity() != expected {
            return Err("Provider installer identity changed before update.".to_string());
        }
        Ok(plan)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentProviderUpdateCandidate {
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub installed_version: String,
    pub available_version: String,
    pub installer: ResolvedAgentProviderInstaller,
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
                    cli_identity: identity.clone(),
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
            .update_plan(AgentCliInvocation::CodexExec, "latest; rm")
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
