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
use crate::run_blocking_command;
use crate::trust::{WorkspaceTrustLaunchLease, WorkspaceTrustService, WorkspaceTrustSnapshot};
use crate::workspace_registry::{
    opened_root_path, ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry,
};
use std::{
    fs::File,
    path::{Path, PathBuf},
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

struct WorkspaceCatalogAuthority {
    descriptor: ManagedWorkspaceDescriptor,
    repository_root: PathBuf,
    repository_authority: Arc<File>,
    trust: WorkspaceTrustSnapshot,
}

fn registered_ancestor(
    registry: &WorkspaceRegistry,
    canonical_root: &Path,
) -> Result<ManagedWorkspaceDescriptor, String> {
    canonical_root
        .ancestors()
        .find_map(|ancestor| registry.descriptor_for_registered_path(ancestor).ok())
        .ok_or_else(|| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_descendant_directory(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    relative_path: &Path,
) -> Result<File, String> {
    registry
        .open_directory_descendant(workspace_id, relative_path)
        .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_descendant_directory(
    _registry: &WorkspaceRegistry,
    _workspace_id: &WorkspaceId,
    _relative_path: &Path,
) -> Result<File, String> {
    Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())
}

fn open_repository_authority(
    registry: &WorkspaceRegistry,
    descriptor: &ManagedWorkspaceDescriptor,
    canonical_root: &Path,
) -> Result<File, String> {
    let relative_path = canonical_root
        .strip_prefix(&descriptor.canonical_root_path)
        .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())?;
    if relative_path.as_os_str().is_empty() {
        return registry
            .clone_root(&descriptor.workspace_id)
            .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
    }
    open_descendant_directory(registry, &descriptor.workspace_id, relative_path)
}

#[cfg(unix)]
fn retained_directory_matches_path(retained: &File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    match (retained.metadata(), path.metadata()) {
        (Ok(retained_metadata), Ok(path_metadata)) => {
            retained_metadata.dev() == path_metadata.dev()
                && retained_metadata.ino() == path_metadata.ino()
        }
        _ => false,
    }
}

#[cfg(not(unix))]
fn retained_directory_matches_path(_retained: &File, _path: &Path) -> bool {
    false
}

fn trust_snapshot(
    trust: &Mutex<WorkspaceTrustService>,
    descriptor: &ManagedWorkspaceDescriptor,
) -> Result<WorkspaceTrustSnapshot, String> {
    Ok(trust
        .lock()
        .map_err(|_| AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR.to_string())?
        .snapshot_canonical(&descriptor.canonical_root_path.to_string_lossy()))
}

impl WorkspaceCatalogAuthority {
    fn capture(
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
        repository_root: &str,
    ) -> Result<Self, String> {
        let canonical_root = crate::canonicalize_workspace_root(repository_root)
            .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())?;
        let descriptor = registered_ancestor(registry, &canonical_root)?;
        let repository_authority =
            open_repository_authority(registry, &descriptor, &canonical_root)?;
        let opened_root = opened_root_path(&repository_authority)
            .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())?;
        if opened_root != canonical_root
            || !retained_directory_matches_path(&repository_authority, &canonical_root)
        {
            return Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
        }
        let trust = trust_snapshot(trust, &descriptor)?;
        if !trust.trusted {
            return Err(UNTRUSTED_CATALOG_WORKSPACE_ERROR.to_string());
        }
        Ok(Self {
            descriptor,
            repository_root: canonical_root,
            repository_authority: Arc::new(repository_authority),
            trust,
        })
    }

    fn owner(&self, provider: AgentCliInvocation) -> CatalogOwner<'_> {
        CatalogOwner {
            workspace_root: &self.repository_root,
            workspace_id: self.descriptor.workspace_id.as_str(),
            provider,
        }
    }

    fn reserve_trust(
        &self,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<WorkspaceTrustLaunchLease, String> {
        trust
            .lock()
            .map_err(|_| AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR.to_string())?
            .reserve_launch(&self.trust)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    return UNTRUSTED_CATALOG_WORKSPACE_ERROR.to_string();
                }
                CATALOG_TRUST_BUSY_ERROR.to_string()
            })
    }

    fn revalidate(
        &self,
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<(), String> {
        let current = Self::capture(registry, trust, &self.repository_root.to_string_lossy())?;
        let unchanged = current.descriptor == self.descriptor
            && current.repository_root == self.repository_root
            && current.trust == self.trust
            && retained_directory_matches_path(&self.repository_authority, &current.repository_root);
        if !unchanged {
            return Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
        }
        Ok(())
    }

    fn revalidate_registration(
        &self,
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<(), String> {
        let descriptor = registry
            .descriptor(&self.descriptor.workspace_id)
            .map_err(|_| UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string())?;
        if descriptor != self.descriptor {
            return Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
        }
        let trust = trust_snapshot(trust, &self.descriptor)?;
        if !trust.trusted {
            return Err(UNTRUSTED_CATALOG_WORKSPACE_ERROR.to_string());
        }
        if trust != self.trust {
            return Err(UNKNOWN_CATALOG_WORKSPACE_ERROR.to_string());
        }
        Ok(())
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
#[path = "agent_command_catalog_tests.rs"]
mod tests;
