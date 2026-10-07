use crate::agent_mcp_servers_domain::{
    validate_request, AgentMcpServers, AgentMcpServersRequest, AGENT_MCP_SERVERS_BUSY_ERROR,
    AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
    AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR, AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR,
};
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry;
use crate::agent_task_spawner::AgentCliInvocation;
use crate::agent_workspace_probe_authority::{
    WorkspaceProbeAuthority, WorkspaceProbeAuthorityErrors,
};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::Manager;

const MAX_CONCURRENT_MCP_PROBES: usize = 2;
static MCP_PROBES: AtomicUsize = AtomicUsize::new(0);

struct McpProbePermit {
    active: &'static AtomicUsize,
}

impl McpProbePermit {
    fn acquire(active: &'static AtomicUsize) -> Result<Self, String> {
        active
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_CONCURRENT_MCP_PROBES).then_some(count + 1)
            })
            .map(|_| Self { active })
            .map_err(|_| AGENT_MCP_SERVERS_BUSY_ERROR.to_string())
    }
}

impl Drop for McpProbePermit {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

struct McpServersAuthorityErrors;

impl WorkspaceProbeAuthorityErrors for McpServersAuthorityErrors {
    const UNKNOWN_WORKSPACE: &'static str = AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR;
    const UNTRUSTED_WORKSPACE: &'static str = AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR;
    const TRUST_BUSY: &'static str = AGENT_MCP_SERVERS_BUSY_ERROR;
    const UNAVAILABLE: &'static str = AGENT_MCP_SERVERS_UNAVAILABLE_ERROR;
}

type WorkspaceMcpServersAuthority = WorkspaceProbeAuthority<McpServersAuthorityErrors>;

#[derive(Clone, Debug)]
struct CheckedMcpServers {
    servers: AgentMcpServers,
    generation: u64,
}

fn provider_generation(
    providers: &AgentProviderRuntimeRegistry,
    provider: AgentCliInvocation,
) -> Result<u64, String> {
    providers
        .policy_snapshot(provider)
        .filter(|(policy, _)| policy.enabled)
        .map(|(_, receipt)| receipt.provider_generation)
        .ok_or_else(|| AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR.to_string())
}

fn ensure_provider_generation(
    providers: &AgentProviderRuntimeRegistry,
    provider: AgentCliInvocation,
    generation: u64,
) -> Result<(), String> {
    if provider_generation(providers, provider)? != generation {
        return Err(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR.to_string());
    }
    Ok(())
}

fn lease_failure(providers: &AgentProviderRuntimeRegistry, provider: AgentCliInvocation) -> String {
    provider_generation(providers, provider)
        .err()
        .unwrap_or_else(|| AGENT_MCP_SERVERS_UNAVAILABLE_ERROR.to_string())
}

fn check_servers(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceMcpServersAuthority,
    provider: AgentCliInvocation,
) -> Result<CheckedMcpServers, String> {
    let generation = provider_generation(providers, provider)?;
    let lease = providers
        .acquire_catalog_probe(provider, generation)
        .map_err(|_| lease_failure(providers, provider))?;
    let trust_lease = authority.reserve_trust(trust)?;
    authority.revalidate(registry, trust)?;
    let servers = providers
        .probe_mcp_servers(
            &lease,
            &authority.repository_root,
            Arc::clone(&authority.repository_authority),
        )
        .map_err(|failure| failure.message().to_string());
    authority.revalidate(registry, trust)?;
    drop(trust_lease);
    ensure_provider_generation(providers, provider, generation)?;
    Ok(CheckedMcpServers {
        servers: servers?,
        generation,
    })
}

fn publish_servers(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceMcpServersAuthority,
    provider: AgentCliInvocation,
    checked: CheckedMcpServers,
) -> Result<AgentMcpServers, String> {
    authority.revalidate_registration(registry, trust)?;
    ensure_provider_generation(providers, provider, checked.generation)?;
    if checked.servers.provider != provider {
        return Err(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR.to_string());
    }
    Ok(checked.servers)
}

#[tauri::command]
pub async fn get_agent_mcp_servers(
    app: tauri::AppHandle,
    request: AgentMcpServersRequest,
) -> Result<AgentMcpServers, String> {
    validate_request(&request)?;
    let provider = request.provider;
    let providers = Arc::clone(app.state::<Arc<AgentProviderRuntimeRegistry>>().inner());
    let permit = McpProbePermit::acquire(&MCP_PROBES)?;
    let probe_app = app.clone();
    let probe_providers = Arc::clone(&providers);
    let (authority, checked) = run_blocking_command(move || {
        let _permit = permit;
        let registry = probe_app.state::<WorkspaceRegistry>();
        let trust = probe_app.state::<Mutex<WorkspaceTrustService>>();
        let authority = WorkspaceMcpServersAuthority::capture(
            registry.inner(),
            trust.inner(),
            &request.repository_root,
        )?;
        let checked = check_servers(
            &probe_providers,
            registry.inner(),
            trust.inner(),
            &authority,
            provider,
        )?;
        Ok((authority, checked))
    })
    .await?;
    publish_servers(
        &providers,
        app.state::<WorkspaceRegistry>().inner(),
        app.state::<Mutex<WorkspaceTrustService>>().inner(),
        &authority,
        provider,
        checked,
    )
}

#[cfg(all(test, unix))]
#[path = "agent_mcp_servers_tests.rs"]
mod tests;
