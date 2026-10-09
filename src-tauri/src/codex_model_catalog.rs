use crate::agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry;
use crate::agent_task_spawner::AgentCliInvocation;
use crate::codex_curated_model_status::CuratedCodexStatuses;
use crate::codex_model_catalog_domain::{
    parse_catalog, parse_model_list, CodexCatalogSnapshot, CodexModelCatalog, CodexModelListing,
    LiveCodexCatalog,
};
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Emitter;

const TTL: Duration = Duration::from_secs(3600);
const RETRY: Duration = Duration::from_secs(300);
const EVENT: &str = "codex-model-catalog-updated";
const UNAVAILABLE: &str = "Codex model catalog unavailable.";
const BUNDLE: &[u8] = include_bytes!("../../src/domain/codexModelManifest.json");
static SERVICE: OnceLock<Result<Arc<CatalogService>, String>> = OnceLock::new();

pub trait CodexCatalogSource: Send + Sync {
    fn current_generation(&self) -> Option<u64>;
    fn probe(
        &self,
        generation: u64,
        install: &mut dyn FnMut(&[u8]) -> Result<bool, String>,
    ) -> Result<bool, String>;
}

struct RegistryCatalogSource(Arc<AgentProviderRuntimeRegistry>);

impl CodexCatalogSource for RegistryCatalogSource {
    fn current_generation(&self) -> Option<u64> {
        let (policy, receipt) = self.0.policy_snapshot(AgentCliInvocation::CodexExec)?;
        policy.enabled.then_some(receipt.provider_generation)
    }

    fn probe(
        &self,
        generation: u64,
        install: &mut dyn FnMut(&[u8]) -> Result<bool, String>,
    ) -> Result<bool, String> {
        let lease = self
            .0
            .acquire_catalog_probe(AgentCliInvocation::CodexExec, generation)?;
        let stdout = self.0.probe_model_catalog(&lease)?;
        install(&stdout)
    }
}

struct InstalledLive {
    catalog: Arc<LiveCodexCatalog>,
    listing: CodexModelListing,
    generation: u64,
}

struct CatalogState {
    bundled: Arc<CodexModelCatalog>,
    live: Option<InstalledLive>,
    curated: Arc<CuratedCodexStatuses>,
    revision: u64,
    schedule: Option<(u64, Instant)>,
    in_flight: bool,
    epoch: u64,
}

impl CatalogState {
    fn restatus_live(&mut self, curated: &CuratedCodexStatuses) -> Result<bool, String> {
        let Some(live) = self.live.as_mut() else {
            return Ok(false);
        };
        let listing = curated_listing(&live.listing, curated);
        if live.catalog.lists_same_models(&listing) {
            return Ok(false);
        }
        let revision = self.revision.checked_add(1).ok_or(UNAVAILABLE)?;
        live.catalog = Arc::new(LiveCodexCatalog::from_listing(listing, revision)?);
        self.revision = revision;
        Ok(true)
    }
}

fn curated_listing(
    listing: &CodexModelListing,
    curated: &CuratedCodexStatuses,
) -> CodexModelListing {
    let mut listing = listing.clone();
    curated.apply(&mut listing.models);
    listing
}

fn bundled_catalog(curated: &CuratedCodexStatuses) -> Result<CodexModelCatalog, String> {
    let mut catalog = parse_catalog(BUNDLE)?;
    curated.apply(&mut catalog.models);
    Ok(catalog)
}

struct CatalogService {
    state: Mutex<CatalogState>,
}

impl CatalogService {
    fn new() -> Result<Self, String> {
        Ok(Self {
            state: Mutex::new(CatalogState {
                bundled: Arc::new(parse_catalog(BUNDLE)?),
                live: None,
                curated: Arc::default(),
                revision: 0,
                schedule: None,
                in_flight: false,
                epoch: 0,
            }),
        })
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, CatalogState>, String> {
        self.state.lock().map_err(|_| UNAVAILABLE.to_string())
    }

    fn snapshot(&self) -> Result<CodexCatalogSnapshot, String> {
        let state = self.state()?;
        Ok(CodexCatalogSnapshot::new(
            Arc::clone(&state.bundled),
            state.live.as_ref().map(|live| Arc::clone(&live.catalog)),
        ))
    }

    fn install(&self, generation: u64, listing: CodexModelListing) -> Result<bool, String> {
        let mut state = self.state()?;
        if let Some(live) = state.live.as_mut() {
            if generation < live.generation {
                return Ok(false);
            }
            if live.listing == listing {
                live.generation = generation;
                return Ok(false);
            }
        }
        let revision = state.revision.checked_add(1).ok_or(UNAVAILABLE)?;
        let catalog =
            LiveCodexCatalog::from_listing(curated_listing(&listing, &state.curated), revision)?;
        state.revision = revision;
        state.live = Some(InstalledLive {
            catalog: Arc::new(catalog),
            listing,
            generation,
        });
        Ok(true)
    }

    fn install_curated(&self, curated: Arc<CuratedCodexStatuses>) -> Result<bool, String> {
        let mut state = self.state()?;
        if state.curated == curated {
            return Ok(false);
        }
        let bundled = bundled_catalog(&curated)?;
        let live_changed = state.restatus_live(&curated)?;
        let changed = live_changed || (state.live.is_none() && *state.bundled != bundled);
        state.bundled = Arc::new(bundled);
        state.curated = curated;
        Ok(changed)
    }

    fn invalidate(&self) {
        let Ok(mut state) = self.state() else {
            return;
        };
        state.schedule = None;
        state.epoch = state.epoch.wrapping_add(1);
    }

    fn begin(self: &Arc<Self>, now: Instant, generation: u64) -> Option<RefreshLease> {
        let mut state = self.state().ok()?;
        let scheduled = state
            .schedule
            .is_some_and(|(scheduled, next)| scheduled == generation && now < next);
        if state.in_flight || scheduled {
            return None;
        }
        state.in_flight = true;
        Some(RefreshLease {
            service: Arc::clone(self),
            generation,
            epoch: state.epoch,
            success: false,
        })
    }
}

struct RefreshLease {
    service: Arc<CatalogService>,
    generation: u64,
    epoch: u64,
    success: bool,
}

impl Drop for RefreshLease {
    fn drop(&mut self) {
        let Ok(mut state) = self.service.state.lock() else {
            return;
        };
        state.in_flight = false;
        if state.epoch != self.epoch {
            state.schedule = None;
            return;
        }
        let delay = if self.success { TTL } else { RETRY };
        state.schedule = Some((self.generation, Instant::now() + delay));
    }
}

fn run_refresh(
    service: &CatalogService,
    source: &dyn CodexCatalogSource,
    lease: &mut RefreshLease,
) -> Result<bool, String> {
    let generation = lease.generation;
    let changed = source.probe(generation, &mut |stdout| {
        service.install(generation, parse_model_list(stdout)?)
    })?;
    lease.success = true;
    Ok(changed)
}

fn service() -> Result<Arc<CatalogService>, String> {
    SERVICE
        .get_or_init(|| CatalogService::new().map(Arc::new))
        .clone()
}

pub fn snapshot() -> Result<CodexCatalogSnapshot, String> {
    service()?.snapshot()
}

fn publish(app: &tauri::AppHandle, service: &CatalogService) {
    if let Ok(snapshot) = service.snapshot() {
        let _ = app.emit(EVENT, snapshot.published());
    }
}

fn refresh(app: tauri::AppHandle, source: Arc<dyn CodexCatalogSource>) {
    let Ok(service) = service() else {
        return;
    };
    let Some(generation) = source.current_generation() else {
        return;
    };
    let Some(mut lease) = service.begin(Instant::now(), generation) else {
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let changed = run_refresh(&service, source.as_ref(), &mut lease);
        drop(lease);
        if changed == Ok(true) {
            publish(&app, &service);
        }
    });
}

pub fn install_curated_statuses(app: &tauri::AppHandle, curated: Arc<CuratedCodexStatuses>) {
    let Ok(service) = service() else {
        return;
    };
    if service.install_curated(curated) == Ok(true) {
        publish(app, &service);
    }
}

pub fn request_refresh(app: &tauri::AppHandle, registry: &Arc<AgentProviderRuntimeRegistry>) {
    refresh(
        app.clone(),
        Arc::new(RegistryCatalogSource(Arc::clone(registry))),
    );
}

pub fn invalidate_and_refresh(
    app: &tauri::AppHandle,
    registry: &Arc<AgentProviderRuntimeRegistry>,
) {
    if let Ok(service) = service() {
        service.invalidate();
    }
    request_refresh(app, registry);
}

#[tauri::command]
pub async fn get_codex_model_catalog(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<CodexModelCatalog, String> {
    let catalog = snapshot()?.published().clone();
    request_refresh(&app, registry.inner());
    Ok(catalog)
}

#[cfg(test)]
#[path = "codex_model_catalog_tests.rs"]
mod tests;
