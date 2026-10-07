use super::*;

const PROVIDER: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const EFFECTIVE_PATH: &str = "/detected/bin:/usr/bin";

struct Fixture {
    resolver: Arc<FakeResolver>,
    registry: Arc<AgentProviderRuntimeRegistry>,
    generation: u64,
}

impl Fixture {
    fn new() -> Self {
        let resolver = Arc::new(FakeResolver::new(
            executable_identity_fixture(),
            EFFECTIVE_PATH,
        ));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
            resolver.clone(),
        ));
        let generation = registry
            .register_policy(PROVIDER, 1, None, auto_policy())
            .expect("policy")
            .provider_generation;
        Self {
            resolver,
            registry,
            generation,
        }
    }

    fn turn(&self) -> ProviderTurnLease {
        self.registry
            .acquire_turn_for_generation(PROVIDER, self.generation)
            .expect("turn lease")
    }

    fn rediscover(&self, change: impl FnOnce(&mut ResolvedProviderExecutable)) {
        let mut resolved = self
            .resolver
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.discovery_generation += 1;
        change(&mut resolved);
    }

    fn observation_revision(&self) -> u64 {
        configuration(&self.registry.state(), PROVIDER)
            .expect("configuration")
            .update_observation_revision
    }
}

fn stale() -> Result<(), String> {
    Err(AGENT_PROVIDER_STALE_ERROR.to_string())
}

#[test]
fn account_usage_lease_does_not_refresh_discovery_under_a_held_turn() {
    let fixture = Fixture::new();
    let turn = fixture.turn();

    let usage = fixture
        .registry
        .acquire_account_usage_for_generation(PROVIDER, fixture.generation)
        .expect("usage lease");

    assert_eq!(fixture.resolver.refreshes.load(Ordering::SeqCst), 0);
    assert_eq!(usage.discovery_generation, turn.discovery_generation);
    assert_eq!(fixture.registry.revalidate_health(&usage), Ok(()));
    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), Ok(()));
}

#[test]
fn account_usage_lease_keeps_health_admission_accounting() {
    let fixture = Fixture::new();
    let revision = fixture.observation_revision();
    let acquire = || {
        fixture
            .registry
            .acquire_account_usage_for_generation(PROVIDER, fixture.generation)
    };

    let usage = acquire().expect("usage lease");

    assert_eq!(fixture.observation_revision(), revision + 1);
    assert_eq!(
        acquire().err().as_deref(),
        Some(AGENT_PROVIDER_UPDATING_ERROR)
    );
    assert_eq!(
        fixture
            .registry
            .acquire_health_for_generation(PROVIDER, fixture.generation)
            .err()
            .as_deref(),
        Some(AGENT_PROVIDER_UPDATING_ERROR)
    );
    drop(usage);
    let sign_in = fixture
        .registry
        .acquire_sign_in(PROVIDER, fixture.generation)
        .expect("sign-in");
    assert_eq!(
        acquire().err().as_deref(),
        Some(AGENT_PROVIDER_SIGN_IN_ACTIVE_ERROR)
    );
    drop(sign_in);
    assert!(acquire().is_ok());
    assert_eq!(fixture.observation_revision(), revision + 2);
}

#[test]
fn held_turn_lease_rejects_a_regressed_discovery_generation() {
    let fixture = Fixture::new();
    fixture.rediscover(|_| {});
    let turn = fixture.turn();
    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), Ok(()));

    fixture.rediscover(|resolved| resolved.discovery_generation = turn.discovery_generation - 1);

    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), stale());
}

#[test]
fn held_turn_lease_rejects_a_rediscovered_executable_replacement() {
    let fixture = Fixture::new();
    let turn = fixture.turn();
    let replacement = executable_identity_fixture();

    fixture.rediscover(|resolved| {
        resolved.cli_path = replacement.canonical_path.to_string_lossy().into_owned();
        resolved.cli_identity = replacement;
    });

    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), stale());
}

#[test]
fn held_turn_lease_rejects_a_rediscovered_effective_path() {
    let fixture = Fixture::new();
    let turn = fixture.turn();

    fixture.rediscover(|resolved| resolved.effective_path = "/other/bin:/usr/bin".to_string());

    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), stale());
}

#[test]
fn held_turn_lease_rejects_a_rediscovered_path_fingerprint() {
    let fixture = Fixture::new();
    let turn = fixture.turn();

    fixture.rediscover(|resolved| resolved.path_fingerprint = "fingerprint:other".to_string());

    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), stale());
}

#[test]
fn held_turn_lease_rejects_an_executable_rewritten_in_place_after_a_refresh() {
    let fixture = Fixture::new();
    let turn = fixture.turn();

    fixture.rediscover(|_| {});
    fs::write(&turn.cli_identity.canonical_path, "#!/bin/sh\nexit 17\n").expect("rewrite");

    assert_eq!(fixture.registry.revalidate_turn_authority(&turn), stale());
}
