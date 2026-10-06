use super::*;
use crate::agent_task_spawner::agent_provider::runtime::{
    configuration, AgentProviderPolicy, AgentProviderUpdateCandidate,
    ResolvedAgentProviderInstaller,
};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::Arc,
    time::{Duration, Instant},
};

const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
static NONCE: AtomicU64 = AtomicU64::new(0);

fn fake_codex(body: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "codevo-catalog-probe-lease-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&directory).unwrap();
    let script = directory.join("codex");
    fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    script
}

fn registry_for(script: &Path) -> (Arc<AgentProviderRuntimeRegistry>, u64) {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(
            CODEX,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: Some(script.to_string_lossy().into_owned()),
                check_for_updates: true,
                codex_transport: Default::default(),
                codex_app_server_args: Vec::new(),
            },
        )
        .unwrap();
    (registry, receipt.provider_generation)
}

fn cache_update_candidate(registry: &Arc<AgentProviderRuntimeRegistry>, generation: u64) {
    let health = registry
        .acquire_health_for_generation(CODEX, generation)
        .unwrap();
    registry
        .cache_candidate(
            &health,
            Some(AgentProviderUpdateCandidate {
                cli_path: health.cli_path.clone(),
                cli_identity: health.cli_identity.clone(),
                effective_path: health.effective_path.clone(),
                path_fingerprint: health.path_fingerprint.clone(),
                discovery_generation: health.discovery_generation,
                installed_version: "1.0.0".to_string(),
                available_version: "1.1.0".to_string(),
                installer: ResolvedAgentProviderInstaller::Npm {
                    program: health.cli_identity.clone(),
                    package_name: "@openai/codex".to_string(),
                },
            }),
        )
        .unwrap();
}

fn turn_count(registry: &AgentProviderRuntimeRegistry) -> usize {
    configuration(&registry.state(), CODEX).unwrap().turn_count
}

fn cleanup(script: &Path) {
    fs::remove_dir_all(script.parent().unwrap()).unwrap();
}

#[test]
fn sign_in_and_update_start_while_a_probe_is_held_and_cancel_it() {
    let script = fake_codex("exit 0");
    let (registry, generation) = registry_for(&script);
    let probe = registry.acquire_catalog_probe(CODEX, generation).unwrap();
    assert!(!registry.catalog_probe_cancelled(&probe));
    let sign_in = registry.acquire_sign_in(CODEX, generation).unwrap();
    assert!(registry.catalog_probe_cancelled(&probe));
    drop(sign_in);
    drop(probe);

    cache_update_candidate(&registry, generation);
    let probe = registry.acquire_catalog_probe(CODEX, generation).unwrap();
    let update = registry
        .acquire_update(CODEX, generation, "operation-1")
        .unwrap();
    assert!(registry.catalog_probe_cancelled(&probe));
    drop(update);
    drop(probe);
    cleanup(&script);
}

#[test]
fn a_running_probe_is_cancelled_promptly_when_sign_in_starts() {
    let script = fake_codex("while IFS= read -r line; do :; done");
    let (registry, generation) = registry_for(&script);
    let probe = registry.acquire_catalog_probe(CODEX, generation).unwrap();
    let signer = Arc::clone(&registry);
    let sign_in = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        signer.acquire_sign_in(CODEX, generation)
    });
    let started = Instant::now();
    assert!(registry.probe_model_catalog(&probe).is_err());
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(sign_in.join().unwrap().is_ok());
    cleanup(&script);
}

#[test]
fn a_probe_cannot_start_while_updating_or_signing_in() {
    let script = fake_codex("exit 0");
    let (registry, generation) = registry_for(&script);
    let sign_in = registry.acquire_sign_in(CODEX, generation).unwrap();
    assert!(registry.acquire_catalog_probe(CODEX, generation).is_err());
    drop(sign_in);
    cache_update_candidate(&registry, generation);
    let update = registry
        .acquire_update(CODEX, generation, "operation-1")
        .unwrap();
    assert!(registry.acquire_catalog_probe(CODEX, generation).is_err());
    drop(update);
    assert!(registry.acquire_catalog_probe(CODEX, generation).is_ok());
    cleanup(&script);
}

#[test]
fn a_probe_lease_is_not_an_active_turn() {
    let script = fake_codex("exit 0");
    let (registry, generation) = registry_for(&script);
    let probe = registry.acquire_catalog_probe(CODEX, generation).unwrap();
    assert_eq!(turn_count(&registry), 0);
    let turn = registry
        .acquire_turn_for_generation(CODEX, generation)
        .unwrap();
    assert_eq!(turn_count(&registry), 1);
    assert_eq!(
        registry.acquire_sign_in(CODEX, generation).err().as_deref(),
        Some(super::super::AGENT_PROVIDER_TURN_ACTIVE_ERROR)
    );
    drop(turn);
    assert_eq!(turn_count(&registry), 0);
    drop(probe);
    assert_eq!(turn_count(&registry), 0);
    cleanup(&script);
}

#[test]
fn a_command_catalog_probe_runs_in_the_workspace_and_is_cancelled_by_sign_in() {
    let script = fake_codex(
        "while IFS= read -r line; do case \"$line\" in *'\"method\":\"initialize\"'*) printf '{\"id\":0,\"result\":{}}\\n';; *'\"method\":\"skills/list\"'*) printf '{\"id\":1,\"result\":{\"data\":[{\"cwd\":\"%s\",\"skills\":[{\"name\":\"pdf\"}],\"errors\":[]}]}}\\n' \"$PWD\"; sleep 30;; esac; done",
    );
    let workspace = script.parent().unwrap().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let workspace = workspace.canonicalize().unwrap();
    let authority = Arc::new(fs::File::open(&workspace).unwrap());
    let (registry, generation) = registry_for(&script);
    let probe = registry.acquire_catalog_probe(CODEX, generation).unwrap();
    let stdout = registry
        .probe_command_catalog(&probe, &workspace, Arc::clone(&authority))
        .unwrap();
    let response: serde_json::Value = serde_json::from_slice(stdout.trim_ascii_end()).unwrap();
    assert_eq!(
        response["result"]["data"][0]["cwd"],
        workspace.to_str().unwrap()
    );
    assert!(registry
        .probe_command_catalog(&probe, Path::new("relative"), Arc::clone(&authority))
        .is_err());
    drop(probe);

    let stalled =
        fake_codex("touch \"$(dirname \"$0\")/started\"; while IFS= read -r line; do :; done");
    let started_marker = stalled.parent().unwrap().join("started");
    let (stalled_registry, stalled_generation) = registry_for(&stalled);
    let stalled_probe = stalled_registry
        .acquire_catalog_probe(CODEX, stalled_generation)
        .unwrap();
    let stalled_signer = Arc::clone(&stalled_registry);
    let stalled_sign_in = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(60);
        while !started_marker.exists() {
            assert!(Instant::now() < deadline, "stalled provider never started");
            std::thread::sleep(Duration::from_millis(20));
        }
        stalled_signer.acquire_sign_in(CODEX, stalled_generation)
    });
    assert!(stalled_registry
        .probe_command_catalog(&stalled_probe, &workspace, authority)
        .is_err());
    assert!(stalled_sign_in.join().unwrap().is_ok());
    cleanup(&stalled);
    cleanup(&script);
}
