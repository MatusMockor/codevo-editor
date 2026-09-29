use super::*;
use crate::codex_model_catalog_domain::CodexCatalogSource as WireSource;
use serde_json::{json, Value};

const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/codex-app-server-model-list.jsonl");

struct FakeSource {
    generation: Option<u64>,
    stdout: Result<Vec<u8>, String>,
}

impl CodexCatalogSource for FakeSource {
    fn current_generation(&self) -> Option<u64> {
        self.generation
    }

    fn probe(
        &self,
        _generation: u64,
        install: &mut dyn FnMut(&[u8]) -> Result<bool, String>,
    ) -> Result<bool, String> {
        install(&self.stdout.clone()?)
    }
}

fn listing() -> CodexModelListing {
    parse_model_list(FIXTURE).unwrap()
}

fn listing_without(id: &str) -> CodexModelListing {
    let mut listing = listing();
    listing.models.retain(|model| model.id != id);
    listing
}

fn fixture_with_default(id: &str) -> Vec<u8> {
    let mut stdout = Vec::new();
    for line in FIXTURE.split(|byte| *byte == b'\n') {
        let Ok(mut value) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if let Some(entries) = value["result"]["data"].as_array_mut() {
            for entry in entries {
                entry["isDefault"] = json!(entry["id"] == id);
            }
        }
        stdout.extend(serde_json::to_vec(&value).unwrap());
        stdout.push(b'\n');
    }
    stdout
}

fn live_ids(service: &CatalogService) -> Vec<String> {
    service
        .snapshot()
        .unwrap()
        .published()
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect()
}

#[test]
fn bundle_is_published_until_a_live_catalog_is_installed() {
    let service = CatalogService::new().unwrap();
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.published().source, WireSource::Bundled);
    assert_eq!(snapshot.published().revision, 0);
    assert!(service.install(3, listing()).unwrap());
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.published().source, WireSource::Live);
    assert_eq!(snapshot.published().revision, 1);
    assert!(snapshot.resolve("gpt-reserve").is_none());
}

#[test]
fn older_provider_generation_cannot_replace_a_newer_catalog() {
    let service = CatalogService::new().unwrap();
    assert!(service.install(5, listing()).unwrap());
    assert!(!service.install(4, listing_without("gpt-6-luna")).unwrap());
    assert!(live_ids(&service).contains(&"gpt-6-luna".to_string()));
    assert_eq!(service.snapshot().unwrap().published().revision, 1);
    assert!(service.install(5, listing_without("gpt-6-luna")).unwrap());
    assert!(!live_ids(&service).contains(&"gpt-6-luna".to_string()));
    assert_eq!(service.snapshot().unwrap().published().revision, 2);
}

#[test]
fn identical_listing_advances_generation_without_a_new_revision() {
    let service = CatalogService::new().unwrap();
    assert!(service.install(1, listing()).unwrap());
    assert!(!service.install(2, listing()).unwrap());
    assert_eq!(service.snapshot().unwrap().published().revision, 1);
    assert!(!service.install(1, listing_without("gpt-6-luna")).unwrap());
    assert!(live_ids(&service).contains(&"gpt-6-luna".to_string()));
}

#[test]
fn single_flight_lease_schedules_retry_ttl_and_generation_changes() {
    let service = Arc::new(CatalogService::new().unwrap());
    let now = Instant::now();
    let lease = service.begin(now, 1).unwrap();
    assert!(service.begin(now, 1).is_none());
    assert!(service.begin(now, 2).is_none());
    drop(lease);
    assert!(service.begin(now, 1).is_none());
    assert!(service
        .begin(now + RETRY + Duration::from_secs(1), 1)
        .is_some());
    let mut lease = service.begin(now, 2).unwrap();
    lease.success = true;
    drop(lease);
    assert!(service
        .begin(now + RETRY + Duration::from_secs(1), 2)
        .is_none());
    assert!(service
        .begin(now + TTL + Duration::from_secs(1), 2)
        .is_some());
    assert!(service.begin(now, 3).is_some());
}

#[test]
fn invalidation_makes_refresh_due_even_while_a_probe_is_in_flight() {
    let service = Arc::new(CatalogService::new().unwrap());
    let now = Instant::now();
    let mut lease = service.begin(now, 1).unwrap();
    lease.success = true;
    service.invalidate();
    drop(lease);
    assert!(service.begin(now, 1).is_some());
}

#[test]
fn concurrent_refresh_has_one_owner() {
    let service = Arc::new(CatalogService::new().unwrap());
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let joins: Vec<_> = (0..8)
        .map(|_| {
            let service = Arc::clone(&service);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                service.begin(Instant::now(), 1)
            })
        })
        .collect();
    let leases: Vec<_> = joins
        .into_iter()
        .filter_map(|join| join.join().unwrap())
        .collect();
    assert_eq!(leases.len(), 1);
}

#[test]
fn failed_or_malformed_probe_output_keeps_the_last_good_catalog() {
    let service = Arc::new(CatalogService::new().unwrap());
    let good = FakeSource {
        generation: Some(1),
        stdout: Ok(FIXTURE.to_vec()),
    };
    let mut lease = service.begin(Instant::now(), 1).unwrap();
    assert_eq!(run_refresh(&service, &good, &mut lease), Ok(true));
    assert!(lease.success);
    drop(lease);
    let installed = service.snapshot().unwrap().published().clone();
    for stdout in [
        Err("Provider model catalog probe failed.".to_string()),
        Ok(b"not json".to_vec()),
        Ok(FIXTURE[..FIXTURE.len() / 2].to_vec()),
        Ok(vec![b' '; 256 * 1024 + 1]),
        Ok(br#"{"id":1,"error":{"code":-1,"message":"offline"}}"#.to_vec()),
    ] {
        let source = FakeSource {
            generation: Some(2),
            stdout,
        };
        let mut lease = service.begin(Instant::now(), 2).unwrap();
        assert!(run_refresh(&service, &source, &mut lease).is_err());
        assert!(!lease.success);
        drop(lease);
        service.invalidate();
        assert_eq!(service.snapshot().unwrap().published(), &installed);
    }
    let changed = FakeSource {
        generation: Some(2),
        stdout: Ok(fixture_with_default("gpt-6-astra")),
    };
    let mut lease = service.begin(Instant::now(), 2).unwrap();
    assert_eq!(run_refresh(&service, &changed, &mut lease), Ok(true));
    assert_eq!(
        service.snapshot().unwrap().resolve("default").unwrap().id,
        "gpt-6-astra"
    );
}

#[cfg(unix)]
mod registry_probe {
    use super::*;
    use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    fn fake_codex(name: &str, body: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "codevo-codex-model-catalog-{name}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let script = directory.join("codex");
        fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn registry_for(script: &std::path::Path) -> (Arc<AgentProviderRuntimeRegistry>, u64) {
        let registry = Arc::new(AgentProviderRuntimeRegistry::new());
        let receipt = registry
            .register_policy(
                AgentCliInvocation::CodexExec,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(script.to_string_lossy().into_owned()),
                    check_for_updates: false,
                    codex_transport: Default::default(),
                    codex_app_server_args: Vec::new(),
                },
            )
            .unwrap();
        (registry, receipt.provider_generation)
    }

    #[test]
    fn app_server_model_list_probe_installs_the_live_catalog() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/codex-app-server-model-list.jsonl");
        let script = fake_codex(
            "live",
            &format!(
                "while IFS= read -r line; do case \"$line\" in *'\"method\":\"model/list\"'*'\"includeHidden\":true'*) cat '{}';; esac; done",
                fixture.display()
            ),
        );
        let (registry, generation) = registry_for(&script);
        let source = RegistryCatalogSource(Arc::clone(&registry));
        assert_eq!(source.current_generation(), Some(generation));
        let service = Arc::new(CatalogService::new().unwrap());
        let mut lease = service.begin(Instant::now(), generation).unwrap();
        assert_eq!(run_refresh(&service, &source, &mut lease), Ok(true));
        drop(lease);
        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.published().source, WireSource::Live);
        assert_eq!(snapshot.resolve("default").unwrap().id, "gpt-6.1-sol");
        assert!(snapshot.resolve("codex-auto-review").is_none());
        fs::remove_dir_all(script.parent().unwrap()).unwrap();
    }

    #[test]
    fn stale_generation_and_broken_output_are_refused() {
        let script = fake_codex("broken", "printf 'not json\\n'; exit 0");
        let (registry, generation) = registry_for(&script);
        let source = RegistryCatalogSource(Arc::clone(&registry));
        let service = Arc::new(CatalogService::new().unwrap());
        let mut lease = service.begin(Instant::now(), generation).unwrap();
        assert!(run_refresh(&service, &source, &mut lease).is_err());
        drop(lease);
        assert_eq!(
            service.snapshot().unwrap().published().source,
            WireSource::Bundled
        );
        let mut lease = service.begin(Instant::now(), generation + 1).unwrap();
        assert!(run_refresh(&service, &source, &mut lease).is_err());
        fs::remove_dir_all(script.parent().unwrap()).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn a_probe_cancelled_by_sign_in_installs_nothing_and_schedules_a_retry() {
    use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
    use std::{fs, os::unix::fs::PermissionsExt};
    let directory = std::env::temp_dir().join(format!(
        "codevo-codex-model-catalog-cancel-{}",
        std::process::id()
    ));
    fs::create_dir_all(&directory).unwrap();
    let script = directory.join("codex");
    fs::write(&script, "#!/bin/sh\nwhile IFS= read -r line; do :; done\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let generation = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(script.to_string_lossy().into_owned()),
                check_for_updates: false,
                codex_transport: Default::default(),
                codex_app_server_args: Vec::new(),
            },
        )
        .unwrap()
        .provider_generation;
    let signer = Arc::clone(&registry);
    let sign_in = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        signer.acquire_sign_in(AgentCliInvocation::CodexExec, generation)
    });
    let service = Arc::new(CatalogService::new().unwrap());
    let started = Instant::now();
    let mut lease = service.begin(started, generation).unwrap();
    let source = RegistryCatalogSource(Arc::clone(&registry));
    assert!(run_refresh(&service, &source, &mut lease).is_err());
    drop(lease);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(sign_in.join().unwrap().is_ok());
    assert_eq!(
        service.snapshot().unwrap().published().source,
        WireSource::Bundled
    );
    assert!(service.begin(Instant::now(), generation).is_none());
    assert!(service
        .begin(Instant::now() + RETRY + Duration::from_secs(1), generation)
        .is_some());
    fs::remove_dir_all(directory).unwrap();
}
