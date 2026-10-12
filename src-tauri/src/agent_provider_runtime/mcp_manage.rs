use super::{model_catalog_probe::ProviderCatalogProbeLease, AgentProviderRuntimeRegistry};
use crate::agent_mcp_server_login_protocol::{McpLoginEvents, McpLoginFailure, McpLoginRequest};
use crate::agent_mcp_server_manage_domain::AgentMcpServerChange;
use crate::agent_mcp_server_manage_protocol::{mcp_change_operation, McpChangeFailure};
use crate::agent_task_spawner::agent_provider::process::mcp_manage_plan::{
    execute_mcp_change, execute_mcp_login, McpManageLaunch,
};
use std::{fs, path::Path, sync::Arc, time::Duration};

fn launch<'a>(
    lease: &'a ProviderCatalogProbeLease,
    workspace_root: &'a Path,
    cwd_authority: Arc<fs::File>,
) -> McpManageLaunch<'a> {
    McpManageLaunch {
        identity: lease.cli_identity.clone(),
        provider: lease.provider,
        workspace_root,
        cwd_authority,
        effective_path: &lease.effective_path,
    }
}

impl AgentProviderRuntimeRegistry {
    pub fn change_mcp_server(
        &self,
        lease: &ProviderCatalogProbeLease,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
        change: &AgentMcpServerChange,
        timeout: Duration,
    ) -> Result<(), McpChangeFailure> {
        self.revalidate_catalog_probe(lease)
            .map_err(|_| McpChangeFailure::Unavailable)?;
        let root = workspace_root
            .to_str()
            .ok_or(McpChangeFailure::Unavailable)?;
        let operation = mcp_change_operation(lease.provider, change, root)?;
        let changed = execute_mcp_change(
            &launch(lease, workspace_root, cwd_authority),
            operation,
            timeout,
            || self.catalog_probe_cancelled(lease),
        );
        self.revalidate_catalog_probe(lease)
            .map_err(|_| McpChangeFailure::Unavailable)?;
        changed
    }

    pub fn run_mcp_login(
        &self,
        lease: &ProviderCatalogProbeLease,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
        login: &McpLoginRequest,
        events: Arc<dyn McpLoginEvents>,
        cancelled: impl Fn() -> bool,
    ) -> bool {
        if self.revalidate_catalog_probe(lease).is_err() {
            events.step_known(Err(McpLoginFailure::Unavailable));
            return false;
        }
        let succeeded = execute_mcp_login(
            &launch(lease, workspace_root, cwd_authority),
            login,
            events,
            || cancelled() || self.catalog_probe_cancelled(lease),
        );
        succeeded && self.revalidate_catalog_probe(lease).is_ok()
    }
}
