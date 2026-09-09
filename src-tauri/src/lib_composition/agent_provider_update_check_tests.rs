use super::*;
use crate::agent_task_spawner::agent_provider::runtime::update_check::tests::fixture as update_check_fixture;
use std::cell::Cell;

struct Metadata<F>(F);
impl<F: Fn(&dyn Fn() -> bool) -> Result<String, RegistryVersionError>>
    AgentProviderReleaseMetadataSource for Metadata<F>
{
    fn latest(
        &self,
        provider: AgentCliInvocation,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<String, RegistryVersionError> {
        assert_eq!(provider, AgentCliInvocation::CodexExec);
        (self.0)(cancelled)
    }
}

#[test]
fn metadata_only_reports_offer_without_executing_or_authorizing_update() {
    let (registry, receipt) = update_check_fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    let result = check_updates(
        &registry,
        lease,
        &AtomicBool::new(false),
        &Metadata(|cancelled: &dyn Fn() -> bool| {
            assert!(!cancelled());
            Ok("1.1.0".to_string())
        }),
    )
    .unwrap();
    assert!(matches!(
        result.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    assert!(result.checked_at_epoch_ms > 0);
    assert!(registry
        .acquire_update(
            receipt.provider,
            receipt.provider_generation,
            "update-check"
        )
        .is_err());
}

#[test]
fn unknown_version_and_disabled_checks_never_fetch_or_fall_back_to_diagnostics() {
    for (version, enabled) in [(None, true), (Some("1.0.0"), false)] {
        let (registry, receipt) = update_check_fixture(version, enabled);
        let lease = registry
            .acquire_update_check(receipt.provider, receipt.provider_generation)
            .unwrap();
        let result = check_updates(
            &registry,
            lease,
            &AtomicBool::new(false),
            &Metadata(|_: &dyn Fn() -> bool| panic!("No metadata required")),
        )
        .unwrap();
        assert_eq!(
            result.update,
            if enabled {
                unavailable(AgentProviderUpdateUnavailableReason::InvalidVersion)
            } else {
                AgentProviderUpdateAvailability::ChecksDisabled
            }
        );
    }
}

#[test]
fn network_failure_is_truthful_and_releases_lease_for_retry() {
    let (registry, receipt) = update_check_fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    let result = check_updates(
        &registry,
        lease,
        &AtomicBool::new(false),
        &Metadata(|_: &dyn Fn() -> bool| Err(RegistryVersionError::Timeout)),
    )
    .unwrap();
    assert_eq!(
        result.update,
        unavailable(AgentProviderUpdateUnavailableReason::ProbeFailed)
    );
    assert!(registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .is_ok());
}

#[test]
fn replacement_during_network_read_discards_even_successful_response() {
    let (registry, receipt) = update_check_fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    let called = Cell::new(false);
    let result = check_updates(
        &registry,
        lease,
        &AtomicBool::new(false),
        &Metadata(|cancelled: &dyn Fn() -> bool| {
            let mut policy = registry.policy_snapshot(receipt.provider).unwrap().0;
            policy.cli_path = Some("/another/cli".to_string());
            registry
                .register_policy(
                    receipt.provider,
                    2,
                    Some(receipt.provider_generation),
                    policy,
                )
                .unwrap();
            called.set(true);
            assert!(cancelled());
            Ok("1.1.0".to_string())
        }),
    );
    assert!(called.get());
    assert!(result.is_err());
}

#[test]
fn cancellation_during_network_read_discards_result() {
    let (registry, receipt) = update_check_fixture(Some("1.0.0"), true);
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    let cancelled = AtomicBool::new(false);
    assert!(check_updates(
        &registry,
        lease,
        &cancelled,
        &Metadata(|poll: &dyn Fn() -> bool| {
            cancelled.store(true, AtomicOrdering::Release);
            assert!(poll());
            Ok("1.1.0".to_string())
        })
    )
    .is_err());
}

#[test]
fn update_check_request_rejects_unknown_fields() {
    assert!(
        serde_json::from_value::<AgentProviderHealthProbeRequest>(serde_json::json!({
            "provider":"codex", "providerGeneration":1, "installedVersion":"1.0.0"
        }))
        .is_err()
    );
}
