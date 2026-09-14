use super::*;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

mod validation_performance {
    include!("validation_performance_tests.rs");
}

static NONCE: AtomicU64 = AtomicU64::new(0);

fn executable_identity_fixture() -> ExecutableIdentity {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!(
        "codevo-provider-runtime-{}-{nonce}",
        std::process::id()
    ));
    fs::write(&path, "#!/bin/sh\nexit 0\n").expect("script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
    }
    crate::agent_task_spawner::agent_provider::process::executable_identity(
        path.to_str().expect("path"),
    )
    .expect("identity")
}

fn policy(path: &str) -> AgentProviderPolicy {
    AgentProviderPolicy {
        codex_transport: Default::default(),
        codex_app_server_args: Vec::new(),
        enabled: true,
        cli_path: Some(path.to_string()),
        check_for_updates: true,
    }
}

fn auto_policy() -> AgentProviderPolicy {
    AgentProviderPolicy {
        codex_transport: Default::default(),
        codex_app_server_args: Vec::new(),
        enabled: true,
        cli_path: None,
        check_for_updates: false,
    }
}

struct FakeResolver {
    resolved: Mutex<ResolvedProviderExecutable>,
    refreshes: AtomicU64,
}

impl FakeResolver {
    fn new(identity: ExecutableIdentity, effective_path: &str) -> Self {
        Self {
            resolved: Mutex::new(ResolvedProviderExecutable {
                cli_path: identity.canonical_path.to_string_lossy().into_owned(),
                cli_identity: identity,
                effective_path: effective_path.to_string(),
                path_fingerprint: format!("fingerprint:{effective_path}"),
                discovery_generation: 1,
            }),
            refreshes: AtomicU64::new(0),
        }
    }

    fn replace(&self, identity: ExecutableIdentity) {
        let mut resolved = self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.cli_path = identity.canonical_path.to_string_lossy().into_owned();
        resolved.cli_identity = identity;
    }

    fn refresh_authority(&self) {
        let mut resolved = self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.discovery_generation = resolved.discovery_generation.wrapping_add(1).max(1);
    }
}

impl AgentProviderExecutableResolver for FakeResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        _manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        if refresh {
            self.refreshes.fetch_add(1, Ordering::SeqCst);
        }
        Ok(self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone())
    }
}

#[test]
fn automatic_turn_lease_captures_one_resolved_identity_and_effective_path() {
    let identity = executable_identity_fixture();
    let expected_path = identity.canonical_path.to_string_lossy().into_owned();
    let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .expect("policy");

    let lease = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("turn lease");

    assert_eq!(lease.cli_path, expected_path);
    assert_eq!(lease.effective_path, "/detected/bin:/usr/bin");
    assert_eq!(
        lease.cli_identity.canonical_path,
        std::path::Path::new(&lease.cli_path)
    );
    assert!(registry.revalidate_turn_authority(&lease).is_ok());
}

#[test]
fn held_turn_lease_fails_after_provider_a_b_a_generation_replacement() {
    let resolver = Arc::new(FakeResolver::new(
        executable_identity_fixture(),
        "/detected/bin:/usr/bin",
    ));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let first = registry
        .register_policy(AgentCliInvocation::ClaudeCode, 1, None, auto_policy())
        .expect("first policy");
    let lease = registry
        .acquire_turn_for_generation(AgentCliInvocation::ClaudeCode, first.provider_generation)
        .expect("turn lease");
    let mut disabled = auto_policy();
    disabled.enabled = false;
    let second = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            2,
            Some(first.provider_generation),
            disabled,
        )
        .expect("second policy");
    registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            3,
            Some(second.provider_generation),
            auto_policy(),
        )
        .expect("third policy");

    assert_eq!(
        registry.revalidate_turn_authority(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn held_turn_lease_rejects_discovery_a_b_a_with_identical_executable_bytes() {
    let resolver = Arc::new(FakeResolver::new(
        executable_identity_fixture(),
        "/detected/bin:/usr/bin",
    ));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
        resolver.clone(),
    ));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .expect("policy");
    let lease = registry
        .acquire_turn_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("turn lease");

    resolver.refresh_authority();

    assert_eq!(
        registry.revalidate_turn_authority(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn held_manual_override_lease_rejects_discovery_a_b_a() {
    let identity = executable_identity_fixture();
    let manual_path = identity.canonical_path.to_string_lossy().into_owned();
    let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
        resolver.clone(),
    ));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            policy(&manual_path),
        )
        .expect("manual policy");
    let lease = registry
        .acquire_turn_for_generation(AgentCliInvocation::ClaudeCode, receipt.provider_generation)
        .expect("turn lease");

    resolver.refresh_authority();

    assert_eq!(
        registry.revalidate_turn_authority(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn health_refresh_re_resolves_and_identity_replacement_fails_closed() {
    let resolver = Arc::new(FakeResolver::new(
        executable_identity_fixture(),
        "/detected/bin:/usr/bin",
    ));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
        resolver.clone(),
    ));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .expect("policy");
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    assert_eq!(resolver.refreshes.load(Ordering::SeqCst), 1);

    resolver.replace(executable_identity_fixture());

    assert_eq!(
        registry.revalidate_health(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[cfg(unix)]
#[test]
fn cached_health_resolution_rejects_a_path_swap_before_publication() {
    use std::os::unix::fs::PermissionsExt;

    let identity = executable_identity_fixture();
    let executable_path = identity.canonical_path.clone();
    let resolver = Arc::new(FakeResolver::new(identity, "/detected/bin:/usr/bin"));
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .expect("policy");
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let retained = executable_path.with_extension("retained");
    fs::rename(&executable_path, &retained).expect("retain executable");
    fs::write(&executable_path, "#!/bin/sh\nexit 0\n").expect("replacement executable");
    fs::set_permissions(&executable_path, fs::Permissions::from_mode(0o755))
        .expect("replacement permissions");

    assert_eq!(
        registry.revalidate_health(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );

    drop(lease);
    fs::remove_file(executable_path).expect("replacement cleanup");
    fs::remove_file(retained).expect("retained cleanup");
}

#[test]
fn turns_and_updates_are_atomically_exclusive() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            policy("/cli/claude"),
        )
        .expect("policy");
    let turn = registry
        .acquire_turn(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "/cli/claude",
        )
        .expect("turn");
    assert_eq!(
        registry
            .acquire_update(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "operation-1"
            )
            .err(),
        Some(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string())
    );
    drop(turn);

    let health = registry
        .acquire_health(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "/cli/claude",
        )
        .expect("health");
    let identity = executable_identity_fixture();
    registry
        .cache_candidate(
            &health,
            Some(AgentProviderUpdateCandidate {
                cli_path: "/cli/claude".to_string(),
                cli_identity: health.cli_identity.clone(),
                effective_path: health.effective_path.clone(),
                path_fingerprint: health.path_fingerprint.clone(),
                discovery_generation: health.discovery_generation,
                installed_version: "1.0.0".to_string(),
                available_version: "1.1.0".to_string(),
                installer: ResolvedAgentProviderInstaller::Npm {
                    program: identity,
                    package_name: "@anthropic-ai/claude-code".to_string(),
                },
            }),
        )
        .expect("candidate");
    drop(health);
    let metadata = registry
        .acquire_update_check(AgentCliInvocation::ClaudeCode, receipt.provider_generation)
        .expect("metadata lease");
    let update = registry
        .acquire_update(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "operation-2",
        )
        .expect("update");
    assert_eq!(
        registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude",
            )
            .err(),
        Some(AGENT_PROVIDER_UPDATING_ERROR.to_string())
    );
    drop(update);
    assert!(registry.revalidate_update_check(&metadata).is_err());
    drop(metadata);
    assert!(registry
        .acquire_turn(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "/cli/claude",
        )
        .is_ok());
}

#[test]
fn sign_in_excludes_same_provider_turns_duplicates_and_updates() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let claude = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            policy("/cli/claude"),
        )
        .expect("claude policy");
    let codex = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/codex"))
        .expect("codex policy");

    let sign_in = registry
        .acquire_sign_in(AgentCliInvocation::ClaudeCode, claude.provider_generation)
        .expect("sign in");
    assert_eq!(sign_in.cli_path, "/cli/claude");
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, claude.provider_generation,)
            .err(),
        Some(AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR.to_string())
    );
    assert_eq!(
        registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                claude.provider_generation,
                "/cli/claude",
            )
            .err(),
        Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
    );
    assert_eq!(
        registry
            .acquire_update(
                AgentCliInvocation::ClaudeCode,
                claude.provider_generation,
                "operation-sign-in",
            )
            .err(),
        Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR.to_string())
    );
    assert!(registry
        .acquire_turn(
            AgentCliInvocation::CodexExec,
            codex.provider_generation,
            "/cli/codex",
        )
        .is_ok());

    drop(sign_in);
    assert!(registry
        .acquire_turn(
            AgentCliInvocation::ClaudeCode,
            claude.provider_generation,
            "/cli/claude",
        )
        .is_ok());
}

#[test]
fn turn_and_update_exclude_sign_in_and_every_failed_acquisition_releases() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            1,
            None,
            policy("/cli/claude"),
        )
        .expect("policy");
    let turn = registry
        .acquire_turn(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "/cli/claude",
        )
        .expect("turn");
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
            .err(),
        Some(AGENT_PROVIDER_TURN_ACTIVE_ERROR.to_string())
    );
    drop(turn);

    let health = registry
        .acquire_health(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "/cli/claude",
        )
        .expect("health");
    let identity = executable_identity_fixture();
    registry
        .cache_candidate(
            &health,
            Some(AgentProviderUpdateCandidate {
                cli_path: "/cli/claude".to_string(),
                cli_identity: health.cli_identity.clone(),
                effective_path: health.effective_path.clone(),
                path_fingerprint: health.path_fingerprint.clone(),
                discovery_generation: health.discovery_generation,
                installed_version: "1.0.0".to_string(),
                available_version: "1.1.0".to_string(),
                installer: ResolvedAgentProviderInstaller::Npm {
                    program: identity,
                    package_name: "@anthropic-ai/claude-code".to_string(),
                },
            }),
        )
        .expect("candidate");
    drop(health);
    let update = registry
        .acquire_update(
            AgentCliInvocation::ClaudeCode,
            receipt.provider_generation,
            "operation-update",
        )
        .expect("update");
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
            .err(),
        Some(AGENT_PROVIDER_UPDATING_ERROR.to_string())
    );
    drop(update);
    assert!(registry
        .acquire_sign_in(AgentCliInvocation::ClaudeCode, receipt.provider_generation,)
        .is_ok());
}

#[test]
fn sign_in_revalidation_fails_closed_after_policy_replacement_but_lease_still_excludes() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let first = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/a"))
        .expect("first");
    let sign_in = registry
        .acquire_sign_in(AgentCliInvocation::CodexExec, first.provider_generation)
        .expect("sign in");
    let second = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            2,
            Some(first.provider_generation),
            policy("/cli/b"),
        )
        .expect("replacement");
    assert_eq!(
        registry.revalidate_sign_in_authority(
            sign_in.provider,
            sign_in.generation,
            &sign_in.cli_path,
        ),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::CodexExec, second.provider_generation)
            .err(),
        Some(AGENT_PROVIDER_ALREADY_SIGNING_IN_ERROR.to_string())
    );
    drop(sign_in);
    assert!(registry
        .acquire_sign_in(AgentCliInvocation::CodexExec, second.provider_generation)
        .is_ok());
}

#[test]
fn disabled_pathless_and_stale_sign_in_requests_fail_closed_without_stranding_a_lease() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let mut disabled = policy("/cli/claude");
    disabled.enabled = false;
    let first = registry
        .register_policy(AgentCliInvocation::ClaudeCode, 1, None, disabled)
        .expect("disabled policy");
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, first.provider_generation)
            .err(),
        Some(AGENT_PROVIDER_DISABLED_ERROR.to_string())
    );
    let pathless = AgentProviderPolicy {
        codex_transport: Default::default(),
        codex_app_server_args: Vec::new(),
        enabled: true,
        cli_path: None,
        check_for_updates: false,
    };
    let second = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            2,
            Some(first.provider_generation),
            pathless,
        )
        .expect("pathless policy");
    assert!(registry
        .acquire_sign_in(AgentCliInvocation::ClaudeCode, second.provider_generation)
        .err()
        .is_some_and(|error| error.contains("not configured")));
    assert_eq!(
        registry
            .acquire_sign_in(AgentCliInvocation::ClaudeCode, first.provider_generation)
            .err(),
        Some(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn replacement_retires_old_generations_and_health_leases() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let first = registry
        .register_policy(AgentCliInvocation::ClaudeCode, 1, None, policy("/cli/a"))
        .expect("first");
    let health = registry
        .acquire_health(
            AgentCliInvocation::ClaudeCode,
            first.provider_generation,
            "/cli/a",
        )
        .expect("health");
    let second = registry
        .register_policy(
            AgentCliInvocation::ClaudeCode,
            2,
            Some(first.provider_generation),
            policy("/cli/b"),
        )
        .expect("second");
    assert_ne!(first.provider_generation, second.provider_generation);
    assert_eq!(
        registry.cache_candidate(&health, None),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn disabled_and_stale_turns_fail_closed() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let mut claude = policy("/cli/claude");
    claude.enabled = false;
    let receipt = registry
        .register_policy(AgentCliInvocation::ClaudeCode, 1, None, claude)
        .expect("policy");
    assert_eq!(
        registry
            .acquire_turn(
                AgentCliInvocation::ClaudeCode,
                receipt.provider_generation,
                "/cli/claude"
            )
            .err(),
        Some(AGENT_PROVIDER_DISABLED_ERROR.to_string())
    );
    assert_eq!(
        registry
            .acquire_turn(AgentCliInvocation::CodexExec, 0, "/cli/codex")
            .err(),
        Some(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn registration_retry_is_idempotent_and_conflicts_fail_closed() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let first = registry
        .register_policy(AgentCliInvocation::CodexExec, 7, None, policy("/cli/codex"))
        .expect("first");
    let retried = registry
        .register_policy(AgentCliInvocation::CodexExec, 7, None, policy("/cli/codex"))
        .expect("retry");
    assert_eq!(first, retried);
    let mut conflict = policy("/cli/codex");
    conflict.enabled = false;
    assert_eq!(
        registry
            .register_policy(
                AgentCliInvocation::CodexExec,
                7,
                Some(first.provider_generation),
                conflict,
            )
            .unwrap_err(),
        AGENT_PROVIDER_REVISION_CONFLICT_ERROR
    );
    assert_eq!(
        registry
            .register_policy(AgentCliInvocation::CodexExec, 6, None, policy("/cli/codex"))
            .expect("reload retry"),
        first
    );
    assert_eq!(
        registry
            .register_policy(AgentCliInvocation::CodexExec, 6, None, policy("/cli/other"),)
            .unwrap_err(),
        AGENT_PROVIDER_STALE_REVISION_ERROR
    );
    let replaced = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            6,
            Some(first.provider_generation),
            policy("/cli/reloaded"),
        )
        .expect("exact generation permits a reset client revision");
    assert_ne!(replaced.provider_generation, first.provider_generation);
    assert_eq!(
        registry
            .register_policy(
                AgentCliInvocation::CodexExec,
                8,
                Some(first.provider_generation),
                policy("/cli/wrong-generation"),
            )
            .unwrap_err(),
        AGENT_PROVIDER_GENERATION_CONFLICT_ERROR
    );
}

#[test]
fn update_plan_cannot_accept_an_unvalidated_version() {
    let installer = ResolvedAgentProviderInstaller::Npm {
        program: executable_identity_fixture(),
        package_name: "@openai/codex".to_string(),
    };
    assert!(installer
        .update_plan(AgentCliInvocation::CodexExec, "latest; rm", "/usr/bin:/bin")
        .is_err());
}

#[test]
fn shutdown_closes_registration_and_waits_for_health_settlement() {
    let registry = Arc::new(AgentProviderRuntimeRegistry::new());
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, policy("/cli/codex"))
        .expect("policy");
    let health = registry
        .acquire_health(
            AgentCliInvocation::CodexExec,
            receipt.provider_generation,
            "/cli/codex",
        )
        .expect("health");
    let shutdown_registry = Arc::clone(&registry);
    let (sender, receiver) = std::sync::mpsc::channel();
    let shutdown = std::thread::spawn(move || {
        sender
            .send(shutdown_registry.shutdown_operations(Duration::from_secs(1)))
            .expect("send result");
    });
    assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
    drop(health);
    assert!(receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("shutdown result"));
    shutdown.join().expect("shutdown thread");
    assert_eq!(
        registry
            .register_policy(AgentCliInvocation::CodexExec, 2, None, policy("/cli/codex"))
            .unwrap_err(),
        AGENT_PROVIDER_STALE_ERROR
    );
}
