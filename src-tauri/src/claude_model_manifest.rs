//! App-global catalog infrastructure. The catalog contains public provider metadata only.
#[path = "claude_model_manifest_cache.rs"]
mod cache;
#[path = "claude_model_manifest_t3.rs"]
mod t3;
use crate::claude_model_manifest_domain::{
    parse_manifest, ClaudeModelManifest, MAX_MANIFEST_BYTES,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Emitter;

const SOURCE_URL: &str = "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";
const TTL: Duration = Duration::from_secs(3600);
const RETRY: Duration = Duration::from_secs(300);
const TIMEOUT: Duration = Duration::from_secs(10);
const EVENT: &str = "claude-model-manifest-updated";
const BUNDLE: &[u8] = include_bytes!("../../src/domain/claudeModelManifest.json");
static SERVICE: OnceLock<Result<Arc<CatalogService>, String>> = OnceLock::new();

struct State {
    catalog: Arc<ClaudeModelManifest>,
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
    let path = data_dir.join("claude-model-manifest-t3-v1.json");
    {
        let Ok(mut state) = service.state.lock() else {
            return;
        };
        if state.cache_path.is_some() {
            return;
        }
        state.cache_path = Some(path.clone());
    }
    tauri::async_runtime::spawn(async move {
        let cached = tauri::async_runtime::spawn_blocking(move || cache::read(&path)).await;
        if let Ok(Ok(cached)) = cached {
            let remaining = cached.remaining_ttl(cache::epoch_ms(), TTL);
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
        if let Ok(mut state) = service.state.lock() {
            state.cache_ready = true;
        }
        refresh(app, service);
    });
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
        if let Ok(changed) = fetch_and_install(&service, fetch(SOURCE_URL), TIMEOUT).await {
            lease.success = true;
            if changed {
                publish(&app, &service);
            }
            let path = service
                .state
                .lock()
                .ok()
                .and_then(|state| state.cache_path.clone());
            if let (Some(path), Ok(catalog)) = (path, service.snapshot()) {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    cache::write(&path, catalog.as_ref())
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
    #[ignore = "explicit live upstream smoke test requires network"]
    async fn live_t3_source_is_fetchable_and_supported() {
        let bytes = fetch(SOURCE_URL).await.unwrap();
        let catalog = t3::parse_t3_manifest(&bytes).unwrap();
        assert!(!catalog.claude_code.is_empty());
    }
}
