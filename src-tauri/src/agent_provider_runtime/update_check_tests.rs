use super::*;

struct ForbiddenResolver;
impl AgentProviderExecutableResolver for ForbiddenResolver {
    fn resolve_provider(
        &self,
        _: AgentCliInvocation,
        _: Option<&str>,
        _: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        panic!("A metadata check must not discover, hash, or execute a CLI");
    }
}

pub(crate) fn fixture(
    installed_version: Option<&str>,
    checks_enabled: bool,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(Arc::new(
        ForbiddenResolver,
    )));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: None,
                check_for_updates: checks_enabled,
            },
        )
        .expect("policy");
    configuration_mut(&mut registry.state(), receipt.provider)
        .expect("configuration")
        .update_observation = installed_version.map(|version| ProviderUpdateObservation {
        installed_version: version.to_string(),
        installer: Some(AgentProviderInstaller::Npm {
            package_name: "@openai/codex".to_string(),
        }),
    });
    (registry, receipt)
}

#[test]
fn metadata_lease_never_resolves_and_does_not_grant_update_authority() {
    let (registry, receipt) = fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    assert_eq!(lease.installed_version.as_deref(), Some("1.0.0"));
    registry.revalidate_update_check(&lease).unwrap();
    assert!(registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .is_err());
    drop(lease);
    assert_eq!(
        registry
            .acquire_update(
                receipt.provider,
                receipt.provider_generation,
                "update-check"
            )
            .err(),
        Some(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
}

#[test]
fn replacement_retires_observation_and_old_lease_cannot_release_new_lease() {
    let (registry, first) = fixture(Some("1.0.0"), true);
    let old = registry
        .acquire_update_check(first.provider, first.provider_generation)
        .unwrap();
    let policy = registry.policy_snapshot(first.provider).unwrap().0;
    let mut changed = policy.clone();
    changed.cli_path = Some("/new/cli".to_string());
    let second = registry
        .register_policy(first.provider, 2, Some(first.provider_generation), changed)
        .unwrap();
    let third = registry
        .register_policy(first.provider, 3, Some(second.provider_generation), policy)
        .unwrap();
    assert!(registry.revalidate_update_check(&old).is_err());
    let new = registry
        .acquire_update_check(third.provider, third.provider_generation)
        .unwrap();
    assert!(new.installed_version.is_none());
    drop(old);
    assert!(registry
        .acquire_update_check(third.provider, third.provider_generation)
        .is_err());
    drop(new);
    assert!(registry
        .acquire_update_check(third.provider, third.provider_generation)
        .is_ok());
}

#[test]
fn shutdown_cancels_metadata_lease_and_waits_for_drop() {
    let (registry, receipt) = fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    assert!(!registry.shutdown_operations(Duration::ZERO));
    assert!(registry.revalidate_update_check(&lease).is_err());
    drop(lease);
    assert!(registry.shutdown_operations(Duration::ZERO));
}
