use crate::agent_command_catalog_domain::{parse_catalog_output, AgentCommandCatalog};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const CATALOG_TTL: Duration = Duration::from_secs(60);
pub const MAX_CACHED_CATALOGS: usize = 16;
pub const AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR: &str = "Agent command catalog unavailable.";
pub const AGENT_COMMAND_CATALOG_LOADING_ERROR: &str = "Agent command catalog is still loading.";
pub const AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR: &str =
    "Enable this provider in Settings before loading its commands.";
pub const AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR: &str =
    "Agent provider settings changed. Retry loading its commands.";

pub trait AgentCommandCatalogSource {
    fn current_generation(&self, provider: AgentCliInvocation) -> Option<u64>;
    fn probe(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        workspace_root: &Path,
    ) -> Result<Vec<u8>, String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CatalogOwner<'a> {
    pub workspace_root: &'a Path,
    pub workspace_id: &'a str,
    pub provider: AgentCliInvocation,
}

impl CatalogOwner<'_> {
    fn key(&self) -> CatalogKey {
        CatalogKey {
            workspace_root: self.workspace_root.to_path_buf(),
            provider: self.provider,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CatalogKey {
    workspace_root: PathBuf,
    provider: AgentCliInvocation,
}

struct CachedCatalog {
    key: CatalogKey,
    workspace_id: String,
    generation: u64,
    fetched_at: Instant,
    catalog: Arc<AgentCommandCatalog>,
}

impl CachedCatalog {
    fn owned_by(&self, owner: &CatalogOwner<'_>, generation: u64) -> bool {
        self.key.workspace_root == owner.workspace_root
            && self.key.provider == owner.provider
            && self.workspace_id == owner.workspace_id
            && self.generation == generation
    }
}

#[derive(Default)]
struct CatalogState {
    entries: Vec<CachedCatalog>,
    in_flight: Vec<CatalogKey>,
}

impl CatalogState {
    fn owned(&self, owner: &CatalogOwner<'_>, generation: u64) -> Option<&CachedCatalog> {
        self.entries
            .iter()
            .find(|entry| entry.owned_by(owner, generation))
    }

    fn install(&mut self, owner: &CatalogOwner<'_>, generation: u64, now: Instant, catalog: Arc<AgentCommandCatalog>) {
        let key = owner.key();
        let cached = CachedCatalog {
            key: key.clone(),
            workspace_id: owner.workspace_id.to_string(),
            generation,
            fetched_at: now,
            catalog,
        };
        match self.entries.iter().position(|entry| entry.key == key) {
            Some(index) => self.entries[index] = cached,
            None => self.entries.push(cached),
        }
        while self.entries.len() > MAX_CACHED_CATALOGS {
            let Some(oldest) = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, entry)| entry.fetched_at)
                .map(|(index, _)| index)
            else {
                return;
            };
            self.entries.remove(oldest);
        }
    }
}

#[derive(Default)]
pub struct AgentCommandCatalogService {
    state: Mutex<CatalogState>,
}

struct InFlightGuard {
    service: Arc<AgentCommandCatalogService>,
    key: CatalogKey,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        let Ok(mut state) = self.service.state.lock() else {
            return;
        };
        state.in_flight.retain(|key| *key != self.key);
    }
}

enum Lookup {
    Fresh(Arc<AgentCommandCatalog>),
    Stale(Arc<AgentCommandCatalog>),
    Loading,
    Probe(InFlightGuard),
}

impl AgentCommandCatalogService {
    pub fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> Result<MutexGuard<'_, CatalogState>, String> {
        self.state
            .lock()
            .map_err(|_| AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR.to_string())
    }

    fn lookup(
        self: &Arc<Self>,
        owner: &CatalogOwner<'_>,
        generation: u64,
        now: Instant,
    ) -> Result<Lookup, String> {
        let mut state = self.state()?;
        let cached = state
            .owned(owner, generation)
            .map(|entry| (Arc::clone(&entry.catalog), now.duration_since(entry.fetched_at)));
        if let Some((catalog, age)) = &cached {
            if *age < CATALOG_TTL {
                return Ok(Lookup::Fresh(Arc::clone(catalog)));
            }
        }
        let key = owner.key();
        if state.in_flight.contains(&key) {
            return Ok(cached.map_or(Lookup::Loading, |(catalog, _)| Lookup::Stale(catalog)));
        }
        state.in_flight.push(key.clone());
        Ok(Lookup::Probe(InFlightGuard {
            service: Arc::clone(self),
            key,
        }))
    }

    fn ensure_generation(
        source: &dyn AgentCommandCatalogSource,
        provider: AgentCliInvocation,
        generation: u64,
    ) -> Result<(), String> {
        match source.current_generation(provider) {
            Some(current) if current == generation => Ok(()),
            Some(_) => Err(AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR.to_string()),
            None => Err(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR.to_string()),
        }
    }

    pub fn cached(
        &self,
        owner: &CatalogOwner<'_>,
        generation: u64,
    ) -> Option<Arc<AgentCommandCatalog>> {
        self.state()
            .ok()?
            .owned(owner, generation)
            .map(|entry| Arc::clone(&entry.catalog))
    }

    pub fn resolve(
        self: &Arc<Self>,
        source: &dyn AgentCommandCatalogSource,
        owner: CatalogOwner<'_>,
        now: Instant,
    ) -> Result<Arc<AgentCommandCatalog>, String> {
        let generation = source
            .current_generation(owner.provider)
            .ok_or_else(|| AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR.to_string())?;
        let guard = match self.lookup(&owner, generation, now)? {
            Lookup::Fresh(catalog) | Lookup::Stale(catalog) => {
                Self::ensure_generation(source, owner.provider, generation)?;
                return Ok(catalog);
            }
            Lookup::Loading => return Err(AGENT_COMMAND_CATALOG_LOADING_ERROR.to_string()),
            Lookup::Probe(guard) => guard,
        };
        let workspace_root = owner
            .workspace_root
            .to_str()
            .ok_or_else(|| AGENT_COMMAND_CATALOG_UNAVAILABLE_ERROR.to_string())?;
        let stdout = source.probe(owner.provider, generation, owner.workspace_root)?;
        let catalog = Arc::new(parse_catalog_output(owner.provider, &stdout, workspace_root)?);
        Self::ensure_generation(source, owner.provider, generation)?;
        self.state()?
            .install(&owner, generation, now, Arc::clone(&catalog));
        drop(guard);
        Self::ensure_generation(source, owner.provider, generation)?;
        Ok(catalog)
    }

    #[cfg(test)]
    fn cached_roots(&self) -> Vec<PathBuf> {
        self.state()
            .map(|state| {
                state
                    .entries
                    .iter()
                    .map(|entry| entry.key.workspace_root.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn in_flight_count(&self) -> usize {
        self.state().map(|state| state.in_flight.len()).unwrap_or(0)
    }
}

#[cfg(test)]
#[path = "agent_command_catalog_service_tests.rs"]
mod tests;
