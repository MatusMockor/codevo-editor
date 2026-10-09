//! App-global catalog infrastructure. The catalog contains public provider metadata only.
#[path = "claude_model_manifest_cache.rs"]
mod cache;
#[path = "claude_model_manifest_t3.rs"]
mod t3;
use crate::claude_model_manifest_domain::{
    parse_manifest, ClaudeModelManifest, MAX_MANIFEST_BYTES,
};
use crate::codex_curated_model_status::{parse_t3_codex_statuses, CuratedCodexStatuses};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Emitter;

const SOURCE_URL: &str = "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";
const TTL: Duration = Duration::from_secs(3600);
const RETRY: Duration = Duration::from_secs(300);
const TIMEOUT: Duration = Duration::from_secs(10);
const EVENT: &str = "claude-model-manifest-updated";
const CACHE_FILE: &str = "claude-model-manifest-t3-v3.json";
const RETIRED_CACHE_FILES: [&str; 2] = [
    "claude-model-manifest-t3-v1.json",
    "claude-model-manifest-t3-v2.json",
];
const BUNDLE: &[u8] = include_bytes!("../../src/domain/claudeModelManifest.json");
static SERVICE: OnceLock<Result<Arc<CatalogService>, String>> = OnceLock::new();

struct State {
    catalog: Arc<ClaudeModelManifest>,
    codex_statuses: Arc<CuratedCodexStatuses>,
    next_attempt: Option<Instant>,
    in_flight: bool,
    cache_ready: bool,
    cache_path: Option<PathBuf>,
}
struct CatalogService {
    state: Mutex<State>,
}
impl CatalogService {
    fn new() -> Result<Self, String> {
        Ok(Self {
            state: Mutex::new(State {
                catalog: Arc::new(parse_manifest(BUNDLE)?),
                codex_statuses: Arc::default(),
                next_attempt: None,
                in_flight: false,
                cache_ready: false,
                cache_path: None,
            }),
        })
    }
    fn snapshot(&self) -> Result<Arc<ClaudeModelManifest>, String> {
        Ok(self
            .state
            .lock()
            .map_err(|_| "Claude catalog unavailable.")?
            .catalog
            .clone())
    }
    fn install(&self, catalog: ClaudeModelManifest) -> Result<bool, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Claude catalog unavailable.")?;
        if catalog.updated_at <= state.catalog.updated_at {
            return Ok(false);
        }
        state.catalog = Arc::new(catalog);
        Ok(true)
    }
    fn codex_statuses(&self) -> Result<Arc<CuratedCodexStatuses>, String> {
        Ok(self
            .state
            .lock()
            .map_err(|_| "Claude catalog unavailable.")?
            .codex_statuses
            .clone())
    }
    fn install_codex_statuses(&self, statuses: CuratedCodexStatuses) -> Result<(), String> {
        self.state
            .lock()
            .map_err(|_| "Claude catalog unavailable.")?
            .codex_statuses = Arc::new(statuses);
        Ok(())
    }
    fn begin(self: &Arc<Self>, now: Instant) -> Option<RefreshLease> {
        let mut state = self.state.lock().ok()?;
        if !state.cache_ready
            || state.in_flight
            || state.next_attempt.is_some_and(|next| now < next)
        {
            return None;
        }
        state.in_flight = true;
        Some(RefreshLease {
            service: self.clone(),
            success: false,
        })
    }
}
struct RefreshLease {
    service: Arc<CatalogService>,
    success: bool,
}
impl Drop for RefreshLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.service.state.lock() {
            state.in_flight = false;
            state.next_attempt = Some(Instant::now() + if self.success { TTL } else { RETRY });
        }
    }
}
fn service() -> Result<Arc<CatalogService>, String> {
    SERVICE
        .get_or_init(|| CatalogService::new().map(Arc::new))
        .clone()
}
pub fn snapshot() -> Result<Arc<ClaudeModelManifest>, String> {
    service()?.snapshot()
}

pub fn initialize(app: tauri::AppHandle, data_dir: PathBuf) {
    let Ok(service) = service() else {
        return;
    };
    {
        let Ok(mut state) = service.state.lock() else {
            return;
        };
        if state.cache_path.is_some() {
            return;
        }
        state.cache_path = Some(data_dir.join(CACHE_FILE));
    }
    tauri::async_runtime::spawn(async move {
        let cached = tauri::async_runtime::spawn_blocking(move || read_cache(&data_dir)).await;
        if let Ok(Ok(cached)) = cached {
            let remaining = cached.remaining_ttl(cache::epoch_ms(), TTL);
            let _ = service.install_codex_statuses(cached.codex_legacy_models);
            let cache_current = service
                .snapshot()
                .is_ok_and(|current| cached.manifest.updated_at >= current.updated_at);
            if service.install(cached.manifest).unwrap_or(false) {
                publish(&app, &service);
            }
            if cache_current {
                if let Ok(mut state) = service.state.lock() {
                    state.next_attempt = remaining.map(|duration| Instant::now() + duration);
                }
            }
        }
        hand_off_codex_statuses(&app, &service);
        if let Ok(mut state) = service.state.lock() {
            state.cache_ready = true;
        }
        refresh(app, service);
    });
}
fn read_cache(data_dir: &Path) -> Result<cache::CachedManifest, String> {
    for retired in RETIRED_CACHE_FILES {
        cache::remove_retired(&data_dir.join(retired));
    }
    cache::read(&data_dir.join(CACHE_FILE))
}
fn hand_off_codex_statuses(app: &tauri::AppHandle, service: &CatalogService) {
    if let Ok(statuses) = service.codex_statuses() {
        crate::codex_model_catalog::install_curated_statuses(app, statuses);
    }
}
fn publish(app: &tauri::AppHandle, service: &CatalogService) {
    if let Ok(catalog) = service.snapshot() {
        let _ = app.emit(EVENT, catalog.as_ref());
    }
}
fn refresh(app: tauri::AppHandle, service: Arc<CatalogService>) {
    let Some(mut lease) = service.begin(Instant::now()) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let installed = fetch_and_install(&service, fetch(SOURCE_URL), TIMEOUT).await;
        hand_off_codex_statuses(&app, &service);
        if let Ok(changed) = installed {
            lease.success = true;
            if changed {
                publish(&app, &service);
            }
            let path = service
                .state
                .lock()
                .ok()
                .and_then(|state| state.cache_path.clone());
            if let (Some(path), Ok(catalog), Ok(statuses)) =
                (path, service.snapshot(), service.codex_statuses())
            {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    cache::write(&path, catalog.as_ref(), statuses.as_ref())
                })
                .await;
            }
        }
        drop(lease);
    });
}
async fn fetch_and_install(
    service: &CatalogService,
    transport: impl std::future::Future<Output = Result<Vec<u8>, String>>,
    timeout: Duration,
) -> Result<bool, String> {
    let bytes = tokio::time::timeout(timeout, transport)
        .await
        .map_err(|_| "Claude catalog request timed out.")??;
    if let Ok(statuses) = parse_t3_codex_statuses(&bytes) {
        service.install_codex_statuses(statuses)?;
    }
    service.install(t3::parse_t3_manifest(&bytes)?)
}
#[tauri::command]
pub async fn get_claude_model_manifest(
    app: tauri::AppHandle,
) -> Result<ClaudeModelManifest, String> {
    let service = service()?;
    let catalog = service.snapshot()?;
    refresh(app, service);
    Ok(catalog.as_ref().clone())
}
async fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "Invalid Claude catalog URL.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Claude catalog requires a public HTTPS URL.".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "Claude catalog client unavailable.")?;
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| "Claude catalog request failed.")?
        .error_for_status()
        .map_err(|_| "Claude catalog server error.")?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_MANIFEST_BYTES as u64)
    {
        return Err("Invalid Claude catalog response.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Claude catalog read failed.")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_MANIFEST_BYTES {
            return Err("Claude catalog exceeds size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    const UPSTREAM: &[u8] = include_bytes!("../tests/fixtures/t3-model-manifest.json");
    fn upstream(updated_at: &str, edit: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut value: Value = serde_json::from_slice(UPSTREAM).unwrap();
        value["updatedAt"] = json!(updated_at);
        edit(&mut value);
        serde_json::to_vec(&value).unwrap()
    }
    fn legacy_ids(service: &CatalogService) -> Vec<String> {
        Vec::from(service.codex_statuses().unwrap().as_ref().clone())
    }
    #[tokio::test]
    async fn codex_statuses_install_even_when_the_claude_manifest_is_not_newer() {
        let service = CatalogService::new().unwrap();
        assert!(legacy_ids(&service).is_empty());
        let first = async { Ok(UPSTREAM.to_vec()) };
        assert!(fetch_and_install(&service, first, TIMEOUT).await.unwrap());
        assert!(!legacy_ids(&service).contains(&"gpt-6-luna".to_string()));
        let updated_at = service.snapshot().unwrap().updated_at.clone();
        let restatused = upstream(&updated_at, |value| {
            value["providers"]["codex"]["models"][2]["status"] = json!("legacy");
        });
        let second = async { Ok(restatused) };
        assert!(!fetch_and_install(&service, second, TIMEOUT).await.unwrap());
        assert_eq!(service.snapshot().unwrap().updated_at, updated_at);
        assert!(legacy_ids(&service).contains(&"gpt-6-luna".to_string()));
    }
    #[tokio::test]
    async fn broken_codex_sections_keep_last_good_statuses_and_still_install_claude() {
        let service = CatalogService::new().unwrap();
        let first = async { Ok(UPSTREAM.to_vec()) };
        assert!(fetch_and_install(&service, first, TIMEOUT).await.unwrap());
        let last_good = legacy_ids(&service);
        assert!(!last_good.is_empty());
        let broken = [
            json!(null),
            json!({"models": []}),
            json!({"models": [{"slug": "gpt-6-luna", "status": "deprecated"}]}),
            json!({"models": [{"slug": "a".repeat(4096), "status": "legacy"}]}),
            json!({"models": [{"slug": "gpt-6-luna"}, {"slug": "gpt-6-sol", "status": "legacy"}]}),
        ];
        for (year, section) in (2090..).zip(broken) {
            let updated_at = format!("{year}-01-01T00:00:00Z");
            let payload = upstream(&updated_at, |value| value["providers"]["codex"] = section);
            let transport = async { Ok(payload) };
            assert!(fetch_and_install(&service, transport, TIMEOUT)
                .await
                .unwrap());
            assert_eq!(service.snapshot().unwrap().updated_at, updated_at);
            assert_eq!(legacy_ids(&service), last_good);
        }
        let missing = upstream("2099-01-01T00:00:00Z", |value| {
            value["providers"].as_object_mut().unwrap().remove("codex");
        });
        let transport = async { Ok(missing) };
        assert!(fetch_and_install(&service, transport, TIMEOUT)
            .await
            .unwrap());
        assert_eq!(legacy_ids(&service), last_good);
    }
    #[tokio::test]
    async fn broken_claude_section_is_still_rejected_while_codex_statuses_apply() {
        let service = CatalogService::new().unwrap();
        let initial = service.snapshot().unwrap().updated_at.clone();
        let payload = upstream("2099-01-01T00:00:00Z", |value| {
            value["providers"]["claudeAgent"]["models"][0]["badge"] = json!("hot");
        });
        let transport = async { Ok(payload) };
        assert!(fetch_and_install(&service, transport, TIMEOUT)
            .await
            .is_err());
        assert_eq!(service.snapshot().unwrap().updated_at, initial);
        assert!(legacy_ids(&service).contains(&"gpt-6-sol".to_string()));
    }
    #[test]
    fn startup_cache_read_retires_older_files_and_restores_codex_statuses() {
        let dir = std::env::temp_dir().join(format!(
            "codevo-manifest-startup-{}-{}",
            std::process::id(),
            cache::epoch_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_cache(&dir).is_err());
        for retired in RETIRED_CACHE_FILES {
            assert_ne!(retired, CACHE_FILE);
            std::fs::write(dir.join(retired), b"{}").unwrap();
        }
        let service = CatalogService::new().unwrap();
        service
            .install_codex_statuses(parse_t3_codex_statuses(UPSTREAM).unwrap())
            .unwrap();
        let statuses = service.codex_statuses().unwrap();
        let catalog = service.snapshot().unwrap();
        cache::write(&dir.join(CACHE_FILE), &catalog, &statuses).unwrap();
        let cached = read_cache(&dir).unwrap();
        assert_eq!(&cached.codex_legacy_models, statuses.as_ref());
        assert_eq!(cached.manifest.updated_at, catalog.updated_at);
        for retired in RETIRED_CACHE_FILES {
            assert!(!dir.join(retired).exists());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_rollback_and_accepts_only_newer_catalog() {
        let service = CatalogService::new().unwrap();
        let mut older = parse_manifest(BUNDLE).unwrap();
        older.updated_at = "2020-01-01T00:00:00Z".into();
        assert!(!service.install(older).unwrap());
        let mut newer = parse_manifest(BUNDLE).unwrap();
        newer.updated_at = "2099-01-01T00:00:00Z".into();
        assert!(service.install(newer).unwrap());
        assert!(!service.install(parse_manifest(BUNDLE).unwrap()).unwrap());
    }
    #[test]
    fn single_flight_and_retry_deadlines_survive_dropped_work() {
        let service = Arc::new(CatalogService::new().unwrap());
        service.state.lock().unwrap().cache_ready = true;
        let now = Instant::now();
        let lease = service.begin(now).unwrap();
        assert!(service.begin(now + TTL).is_none());
        drop(lease);
        assert!(service.begin(now).is_none());
        let mut lease = service.begin(now + RETRY + Duration::from_secs(1)).unwrap();
        lease.success = true;
        drop(lease);
        assert!(service
            .begin(now + RETRY + Duration::from_secs(1))
            .is_none());
        assert!(service.begin(now + TTL + Duration::from_secs(1)).is_some());
    }
    #[test]
    fn concurrent_refresh_has_one_owner() {
        let service = Arc::new(CatalogService::new().unwrap());
        service.state.lock().unwrap().cache_ready = true;
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let joins: Vec<_> = (0..8)
            .map(|_| {
                let service = service.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    service.begin(Instant::now())
                })
            })
            .collect();
        let leases: Vec<_> = joins
            .into_iter()
            .filter_map(|join| join.join().unwrap())
            .collect();
        assert_eq!(leases.len(), 1);
    }
    #[tokio::test]
    async fn failed_transport_malformed_and_timeout_keep_last_good() {
        let service = CatalogService::new().unwrap();
        let initial = service.snapshot().unwrap().updated_at.clone();
        for result in [
            Err("HTTP 503".into()),
            Ok(b"not json".to_vec()),
            Ok(vec![b' '; MAX_MANIFEST_BYTES + 1]),
        ] {
            assert!(fetch_and_install(&service, async { result }, TIMEOUT)
                .await
                .is_err());
            assert_eq!(service.snapshot().unwrap().updated_at, initial);
        }
        assert!(
            fetch_and_install(&service, std::future::pending(), Duration::from_millis(1))
                .await
                .is_err()
        );
        assert_eq!(service.snapshot().unwrap().updated_at, initial);
        let mut newer: serde_json::Value =
            serde_json::from_slice(include_bytes!("../tests/fixtures/t3-model-manifest.json"))
                .unwrap();
        newer["updatedAt"] = "2099-01-01T00:00:00Z".into();
        assert!(fetch_and_install(
            &service,
            async { Ok(serde_json::to_vec(&newer).unwrap()) },
            TIMEOUT
        )
        .await
        .unwrap());
    }
    #[tokio::test]
    async fn the_checked_in_upstream_snapshot_replaces_the_bundle_as_live() {
        let service = CatalogService::new().unwrap();
        assert!(service.snapshot().unwrap().source.is_none());
        let snapshot = include_bytes!("../tests/fixtures/t3-model-manifest.json").to_vec();
        assert!(fetch_and_install(&service, async { Ok(snapshot) }, TIMEOUT)
            .await
            .unwrap());
        assert!(service.snapshot().unwrap().source.is_some());
    }
    #[tokio::test]
    #[ignore = "explicit live upstream smoke test requires network"]
    async fn live_t3_source_is_fetchable_and_supported() {
        let bytes = fetch(SOURCE_URL).await.unwrap();
        let catalog = t3::parse_t3_manifest(&bytes).unwrap();
        assert!(!catalog.claude_code.is_empty());
        assert!(parse_t3_codex_statuses(&bytes).is_ok());
    }
}
