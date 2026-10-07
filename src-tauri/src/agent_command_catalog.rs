use crate::agent_command_catalog_domain::{
    validate_request, AgentCommandCatalog, AgentCommandCatalogRequest,
};
use crate::agent_command_catalog_service::{
    AgentCommandCatalogService, AgentCommandCatalogSource, CatalogOwner,
    AGENT_COMMAND_CATALOG_LOADING_ERROR, AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR,
    AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR, AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR,
};
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry;
use crate::agent_task_spawner::AgentCliInvocation;
use crate::agent_workspace_probe_authority::{
    WorkspaceProbeAuthority, WorkspaceProbeAuthorityErrors,
};
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Instant,
};
use tauri::Manager;

pub(crate) const UNKNOWN_CATALOG_WORKSPACE_ERROR: &str =
    "Agent command catalog workspace is not registered or its identity changed.";
pub(crate) const UNTRUSTED_CATALOG_WORKSPACE_ERROR: &str =
    "Agent command catalog requires a trusted repository.";
const CATALOG_TRUST_BUSY_ERROR: &str = "Agent command catalog trust authority is busy.";
const MAX_CONCURRENT_PROBES: usize = 2;
static SERVICE: OnceLock<Arc<AgentCommandCatalogService>> = OnceLock::new();
static PROBES: AtomicUsize = AtomicUsize::new(0);

fn service() -> &'static Arc<AgentCommandCatalogService> {
    SERVICE.get_or_init(|| Arc::new(AgentCommandCatalogService::new()))
}

struct ProbePermit;

impl ProbePermit {
    fn acquire() -> Option<Self> {
        PROBES
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_CONCURRENT_PROBES).then_some(count + 1)
            })
            .ok()
            .map(|_| Self)
    }
}

impl Drop for ProbePermit {
    fn drop(&mut self) {
        PROBES.fetch_sub(1, Ordering::AcqRel);
    }
}

struct CatalogAuthorityErrors;

impl WorkspaceProbeAuthorityErrors for CatalogAuthorityErrors {
    const UNKNOWN_WORKSPACE: &'static str = UNKNOWN_CATALOG_WORKSPACE_ERROR;
    const UNTRUSTED_WORKSPACE: &'static str = UNTRUSTED_CATALOG_WORKSPACE_ERROR;
    const TRUST_BUSY: &'static str = CATALOG_TRUST_BUSY_ERROR;
    const UNAVAILABLE: &'static str = AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR;
}

type WorkspaceCatalogAuthority = WorkspaceProbeAuthority<CatalogAuthorityErrors>;

impl WorkspaceCatalogAuthority {
    fn owner(&self, provider: AgentCliInvocation) -> CatalogOwner<'_> {
        CatalogOwner {
            workspace_root: &self.repository_root,
            workspace_id: self.descriptor.workspace_id.as_str(),
            provider,
        }
    }
}

struct RegistryCommandCatalogSource<'a> {
    providers: &'a AgentProviderRuntimeRegistry,
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    authority: &'a WorkspaceCatalogAuthority,
}

fn provider_generation(
    providers: &AgentProviderRuntimeRegistry,
    provider: AgentCliInvocation,
) -> Option<u64> {
    let (policy, receipt) = providers.policy_snapshot(provider)?;
    policy.enabled.then_some(receipt.provider_generation)
}

impl AgentCommandCatalogSource for RegistryCommandCatalogSource<'_> {
    fn current_generation(&self, provider: AgentCliInvocation) -> Option<u64> {
        provider_generation(self.providers, provider)
    }

    fn probe(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        workspace_root: &Path,
    ) -> Result<Vec<u8>, String> {
        if workspace_root != self.authority.repository_root {
            return Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
        }
        let lease = self.providers.acquire_catalog_probe(provider, generation)?;
        let trust_lease = self.authority.reserve_trust(self.trust)?;
        self.authority.revalidate(self.registry, self.trust)?;
        let stdout = self.providers.probe_command_catalog(
            &lease,
            workspace_root,
            Arc::clone(&self.authority.repository_authority),
        )?;
        self.authority.revalidate(self.registry, self.trust)?;
        drop(trust_lease);
        Ok(stdout)
    }
}

#[derive(Clone, Debug)]
struct ResolvedCatalog {
    catalog: AgentCommandCatalog,
    generation: u64,
}

fn ensure_provider_generation(
    providers: &AgentProviderRuntimeRegistry,
    provider: AgentCliInvocation,
    generation: u64,
) -> Result<(), String> {
    match provider_generation(providers, provider) {
        Some(current) if current == generation => Ok(()),
        Some(_) => Err(AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR.to_string()),
        None => Err(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR.to_string()),
    }
}

fn resolve_catalog(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceCatalogAuthority,
    provider: AgentCliInvocation,
) -> Result<ResolvedCatalog, String> {
    let generation = provider_generation(providers, provider)
        .ok_or_else(|| AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR.to_string())?;
    let source = RegistryCommandCatalogSource {
        providers,
        registry,
        trust,
        authority,
    };
    let catalog = service().resolve(&source, authority.owner(provider), Instant::now())?;
    authority.revalidate(registry, trust)?;
    ensure_provider_generation(providers, provider, generation)?;
    Ok(ResolvedCatalog {
        catalog: AgentCommandCatalog::clone(&catalog),
        generation,
    })
}

fn stale_catalog(
    providers: &AgentProviderRuntimeRegistry,
    authority: &WorkspaceCatalogAuthority,
    provider: AgentCliInvocation,
) -> Result<ResolvedCatalog, String> {
    let generation = provider_generation(providers, provider)
        .ok_or_else(|| AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR.to_string())?;
    service()
        .cached(&authority.owner(provider), generation)
        .map(|catalog| ResolvedCatalog {
            catalog: AgentCommandCatalog::clone(&catalog),
            generation,
        })
        .ok_or_else(|| AGENT_COMMAND_CATALOG_LOADING_ERROR.to_string())
}

fn publish_catalog(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceCatalogAuthority,
    provider: AgentCliInvocation,
    resolved: ResolvedCatalog,
) -> Result<AgentCommandCatalog, String> {
    authority.revalidate_registration(registry, trust)?;
    ensure_provider_generation(providers, provider, resolved.generation)?;
    Ok(resolved.catalog)
}

#[tauri::command]
pub async fn get_agent_command_catalog(
    app: tauri::AppHandle,
    request: AgentCommandCatalogRequest,
) -> Result<AgentCommandCatalog, String> {
    validate_request(&request)?;
    let provider = request.provider;
    let capture_app = app.clone();
    let authority = run_blocking_command(move || {
        WorkspaceCatalogAuthority::capture(
            capture_app.state::<WorkspaceRegistry>().inner(),
            capture_app.state::<Mutex<WorkspaceTrustService>>().inner(),
            &request.repository_root,
        )
    })
    .await?;
    let authority = Arc::new(authority);
    let providers = Arc::clone(app.state::<Arc<AgentProviderRuntimeRegistry>>().inner());
    let resolved = match ProbePermit::acquire() {
        None => stale_catalog(&providers, &authority, provider)?,
        Some(permit) => {
            let probe_app = app.clone();
            let probe_authority = Arc::clone(&authority);
            let probe_providers = Arc::clone(&providers);
            run_blocking_command(move || {
                let _permit = permit;
                resolve_catalog(
                    &probe_providers,
                    probe_app.state::<WorkspaceRegistry>().inner(),
                    probe_app.state::<Mutex<WorkspaceTrustService>>().inner(),
                    &probe_authority,
                    provider,
                )
            })
            .await?
        }
    };
    publish_catalog(
        &providers,
        app.state::<WorkspaceRegistry>().inner(),
        app.state::<Mutex<WorkspaceTrustService>>().inner(),
        &authority,
        provider,
        resolved,
    )
}

#[cfg(all(test, unix))]
mod tests {
    use crate::workspace_registry::ManagedWorkspaceDescriptor;
    use std::path::PathBuf;
    include!("agent_command_catalog_tests.rs");
}
