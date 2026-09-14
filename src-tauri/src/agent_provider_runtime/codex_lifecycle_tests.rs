use super::*;
use std::sync::Weak;

fn policy() -> AgentProviderPolicy {
    AgentProviderPolicy {
        enabled: true,
        cli_path: Some("/cli/codex".to_string()),
        check_for_updates: true,
        codex_transport: CodexTransport::AppServer,
        codex_app_server_args: vec![],
    }
}

struct Lifecycle {
    registry: Mutex<Weak<AgentProviderRuntimeRegistry>>,
    refuse: bool,
    calls: std::sync::atomic::AtomicUsize,
}

impl AgentProviderHostLifecycle for Lifecycle {
    fn retire_idle_hosts(&self, provider: AgentCliInvocation) -> Result<(), String> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let registry = self.registry.lock().unwrap().upgrade().unwrap();
        let generation = registry
            .policy_snapshot(provider)
            .unwrap()
            .1
            .provider_generation;
        assert_eq!(
            registry
                .acquire_turn_for_generation(provider, generation)
                .err()
                .unwrap(),
            AGENT_PROVIDER_UPDATING_ERROR
        );
        assert_eq!(
            registry
                .register_policy(provider, 2, Some(generation), policy())
                .unwrap_err(),
            AGENT_PROVIDER_UPDATING_ERROR
        );
        if self.refuse {
            return Err("Host retirement failed".to_string());
        }
        Ok(())
    }
}

fn fixture(refuse: bool) -> (Arc<AgentProviderRuntimeRegistry>, Arc<Lifecycle>, u64) {
    let lifecycle = Arc::new(Lifecycle {
        registry: Mutex::new(Weak::new()),
        refuse,
        calls: Default::default(),
    });
    let registry = Arc::new(
        AgentProviderRuntimeRegistry::with_discovery_and_host_lifecycle(
            Arc::new(TestProviderExecutableResolver),
            lifecycle.clone(),
        ),
    );
    *lifecycle.registry.lock().unwrap() = Arc::downgrade(&registry);
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, policy())
        .unwrap();
    let health = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
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
    drop(health);
    (registry, lifecycle, receipt.provider_generation)
}

#[test]
fn retirement_runs_outside_registry_lock_with_update_admission_reserved() {
    let (registry, lifecycle, generation) = fixture(false);
    let update = registry
        .acquire_update(
            AgentCliInvocation::CodexExec,
            generation,
            "update-operation",
        )
        .unwrap();
    assert_eq!(lifecycle.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, generation)
        .is_err());
    drop(update);
    assert!(registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, generation)
        .is_ok());
}

#[test]
fn failed_retirement_releases_the_update_lease() {
    let (registry, lifecycle, generation) = fixture(true);
    assert_eq!(
        registry
            .acquire_update(
                AgentCliInvocation::CodexExec,
                generation,
                "update-operation"
            )
            .err()
            .unwrap(),
        "Host retirement failed"
    );
    assert_eq!(lifecycle.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, generation)
        .is_ok());
}

#[test]
fn live_turn_refuses_update_without_retiring_hosts() {
    let (registry, lifecycle, generation) = fixture(false);
    let turn = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, generation)
        .unwrap();
    assert_eq!(
        registry
            .acquire_update(
                AgentCliInvocation::CodexExec,
                generation,
                "update-operation"
            )
            .err()
            .unwrap(),
        AGENT_PROVIDER_TURN_ACTIVE_ERROR
    );
    assert_eq!(lifecycle.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    drop(turn);
}

#[test]
fn changing_transport_and_args_invalidates_old_lease_and_captures_new_policy() {
    let (registry, _, generation) = fixture(false);
    let old = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, generation)
        .unwrap();
    let mut changed = policy();
    changed.codex_transport = CodexTransport::Exec;
    changed.codex_app_server_args = vec!["--analytics-default-enabled".to_string()];
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 2, Some(generation), changed)
        .unwrap();
    assert!(registry.revalidate_turn_authority(&old).is_err());
    assert_eq!(old.transport(), CodexTransport::AppServer);
    let new = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .unwrap();
    assert_eq!(new.transport(), CodexTransport::Exec);
    assert_eq!(new.app_server_args(), ["--analytics-default-enabled"]);
    assert_ne!(old.generation(), new.generation());
}

#[test]
fn args_validate_before_pathless_policy_can_return_early() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let mut invalid = policy();
    invalid.cli_path = None;
    for argument in [
        "--listen",
        "--listen=stdio://",
        "--code-mode-host=x",
        "--strict-config",
        "a\nb",
        "é",
        "",
    ] {
        invalid.codex_app_server_args = vec![argument.to_string()];
        assert!(registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, invalid.clone())
            .is_err());
    }
    invalid.codex_app_server_args = vec!["x".repeat(257)];
    assert!(registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, invalid.clone())
        .is_err());
    invalid.codex_app_server_args = vec!["x".to_string(); 17];
    assert!(registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, invalid)
        .is_err());
}
