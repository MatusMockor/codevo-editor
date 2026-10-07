use super::{
    configuration, validate_current, AgentProviderPolicy, AgentProviderRuntimeRegistry,
    ResolvedProviderExecutableRef, AGENT_PROVIDER_DISABLED_ERROR,
    AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR, AGENT_PROVIDER_STALE_ERROR, AGENT_PROVIDER_UPDATING_ERROR,
};
use crate::agent_mcp_servers_domain::AgentMcpServers;
use crate::agent_mcp_servers_protocol::McpServersProbeFailure;
use crate::agent_task_spawner::agent_provider::process::{
    command_catalog_plan::CommandCatalogProbe,
    execute_agent_provider_maintenance_plan_cancellable, execute_agent_provider_plan_cancellable,
    mcp_servers_plan::{execute_mcp_servers_plan, McpServersProbe},
    AgentProviderProcessIntent, AgentProviderProcessPlan, ExecutableIdentity,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{fs, path::Path, sync::Arc};

const COMMAND_CATALOG_PROBE_FAILED: &str = "Provider command catalog probe failed.";

pub struct ProviderCatalogProbeLease {
    provider: AgentCliInvocation,
    generation: u64,
    policy: AgentProviderPolicy,
    cli_path: String,
    cli_identity: ExecutableIdentity,
    effective_path: String,
    path_fingerprint: String,
    discovery_generation: u64,
}

impl ProviderCatalogProbeLease {
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

impl AgentProviderRuntimeRegistry {
    pub fn acquire_catalog_probe(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<ProviderCatalogProbeLease, String> {
        let policy = self.operation_policy(provider, generation)?;
        let resolved = self.resolve_provider(provider, &policy, false)?;
        let state = self.state();
        if state.starts_closed {
            return Err(AGENT_PROVIDER_STALE_ERROR.to_string());
        }
        let configuration = configuration(&state, provider)
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
        Ok(ProviderCatalogProbeLease {
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

    fn catalog_probe_cancelled(&self, lease: &ProviderCatalogProbeLease) -> bool {
        self.operations_closed()
            || self
                .revalidate_operation_state(lease.provider, lease.generation, &lease.policy)
                .is_err()
    }

    fn revalidate_catalog_probe(&self, lease: &ProviderCatalogProbeLease) -> Result<(), String> {
        self.revalidate_operation_state(lease.provider, lease.generation, &lease.policy)?;
        self.revalidate_resolution(lease.provider, &lease.policy, lease.resolved())?;
        self.revalidate_operation_state(lease.provider, lease.generation, &lease.policy)
    }

    pub fn probe_model_catalog(
        &self,
        lease: &ProviderCatalogProbeLease,
    ) -> Result<Vec<u8>, String> {
        self.revalidate_catalog_probe(lease)?;
        let plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
            lease.cli_identity.clone(),
            AgentProviderProcessIntent::ModelCatalog(lease.provider),
            &lease.effective_path,
        )?;
        let output = execute_agent_provider_maintenance_plan_cancellable(&plan, || {
            self.catalog_probe_cancelled(lease)
        })
        .map_err(|_| "Provider model catalog probe failed.".to_string())?;
        self.revalidate_catalog_probe(lease)?;
        Ok(output.stdout)
    }

    pub fn probe_command_catalog(
        &self,
        lease: &ProviderCatalogProbeLease,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
    ) -> Result<Vec<u8>, String> {
        self.revalidate_catalog_probe(lease)?;
        let root = workspace_root
            .to_str()
            .ok_or_else(|| COMMAND_CATALOG_PROBE_FAILED.to_string())?;
        let probe = CommandCatalogProbe::new(lease.provider, root);
        let plan = AgentProviderProcessPlan::command_catalog_with_effective_path(
            lease.cli_identity.clone(),
            lease.provider,
            workspace_root,
            cwd_authority,
            &lease.effective_path,
            Arc::clone(&probe),
        )?;
        execute_agent_provider_plan_cancellable(&plan, || self.catalog_probe_cancelled(lease))
            .map_err(|_| COMMAND_CATALOG_PROBE_FAILED.to_string())?;
        self.revalidate_catalog_probe(lease)?;
        probe
            .take_result()
            .ok_or_else(|| COMMAND_CATALOG_PROBE_FAILED.to_string())
    }

    pub fn probe_mcp_servers(
        &self,
        lease: &ProviderCatalogProbeLease,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
    ) -> Result<AgentMcpServers, McpServersProbeFailure> {
        self.revalidate_catalog_probe(lease)
            .map_err(|_| McpServersProbeFailure::Unavailable)?;
        let root = workspace_root
            .to_str()
            .ok_or(McpServersProbeFailure::Unavailable)?;
        let probe = McpServersProbe::new(lease.provider, root);
        let plan = AgentProviderProcessPlan::mcp_servers_with_effective_path(
            lease.cli_identity.clone(),
            lease.provider,
            workspace_root,
            cwd_authority,
            &lease.effective_path,
            Arc::clone(&probe),
        )
        .map_err(|_| McpServersProbeFailure::Unavailable)?;
        let servers =
            execute_mcp_servers_plan(&plan, &probe, || self.catalog_probe_cancelled(lease))?;
        self.revalidate_catalog_probe(lease)
            .map_err(|_| McpServersProbeFailure::Unavailable)?;
        Ok(servers)
    }
}

#[cfg(all(test, unix))]
#[path = "model_catalog_probe_tests.rs"]
mod tests;
