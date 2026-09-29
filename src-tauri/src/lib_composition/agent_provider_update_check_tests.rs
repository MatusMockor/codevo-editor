use super::*;
use crate::agent_task_spawner::agent_provider::runtime::update_check::tests::{
    fixture as update_check_fixture, fixture_with_executable, identity_of, install_executable,
    link, ScratchExecutable,
};
use crate::agent_task_spawner::agent_provider::runtime::update_check::ExecutableStatFingerprint;
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderExecutableResolver, ProviderEntryPoint, ResolvedProviderExecutable,
};

struct DiscoveryEntryPoints;
impl AgentProviderExecutableResolver for DiscoveryEntryPoints {
    fn resolve_provider(
        &self,
        _: AgentCliInvocation,
        _: Option<&str>,
        _: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        panic!("Fingerprints only resolve entry points");
    }

    fn entry_point(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
    ) -> Option<ProviderEntryPoint> {
        crate::agent_cli_discovery::provider_entry_point(provider, manual_override, effective_path)
    }
}

fn discovered_identity(
    provider: AgentCliInvocation,
    effective_path: &str,
) -> crate::agent_task_spawner::agent_provider::process::ExecutableIdentity {
    let entry = crate::agent_cli_discovery::provider_entry_point(provider, None, effective_path)
        .expect("discovered executable");
    identity_of(&entry.canonical, effective_path)
}

#[test]
fn canonical_discovery_fingerprint_detects_a_retargeted_version_link() {
    let scratch = ScratchExecutable::installed("canonical-retarget", "claude");
    let path = scratch.effective_path();
    let recorded = ExecutableStatFingerprint::recorded(
        &DiscoveryEntryPoints,
        AgentCliInvocation::ClaudeCode,
        None,
        &path,
        &discovered_identity(AgentCliInvocation::ClaudeCode, &path),
    );
    assert!(recorded.is_current(&DiscoveryEntryPoints));

    scratch.self_update();

    assert!(!recorded.is_current(&DiscoveryEntryPoints));
}

#[cfg(unix)]
#[test]
fn canonical_discovery_fingerprint_detects_a_swapped_current_directory_link() {
    let scratch = ScratchExecutable::installed("current-swap", "claude");
    let packages = scratch.root.join("packages/standalone");
    install_executable(&packages.join("0.158.0/bin/codex"), b"codex 0.158.0");
    link(&packages.join("0.158.0"), &packages.join("current"));
    link(
        &packages.join("current/bin/codex"),
        &scratch.bin().join("codex"),
    );
    let path = scratch.effective_path();
    let recorded = ExecutableStatFingerprint::recorded(
        &DiscoveryEntryPoints,
        AgentCliInvocation::CodexExec,
        None,
        &path,
        &discovered_identity(AgentCliInvocation::CodexExec, &path),
    );
    assert!(recorded.is_current(&DiscoveryEntryPoints));

    install_executable(&packages.join("0.159.0/bin/codex"), b"codex 0.159.0");
    std::fs::remove_file(packages.join("current")).unwrap();
    link(&packages.join("0.159.0"), &packages.join("current"));

    assert!(packages.join("0.158.0/bin/codex").exists());
    assert!(!recorded.is_current(&DiscoveryEntryPoints));
}

#[test]
fn manual_override_fingerprint_follows_the_configured_link() {
    let scratch = ScratchExecutable::installed("manual", "claude");
    let manual = scratch.bin().join("claude");
    let manual = manual.to_str().unwrap();
    let entry = crate::agent_cli_discovery::provider_entry_point(
        AgentCliInvocation::ClaudeCode,
        Some(manual),
        "",
    )
    .unwrap();
    let recorded = ExecutableStatFingerprint::recorded(
        &DiscoveryEntryPoints,
        AgentCliInvocation::ClaudeCode,
        Some(manual),
        "",
        &identity_of(&entry.canonical, &scratch.effective_path()),
    );
    assert!(recorded.is_current(&DiscoveryEntryPoints));

    scratch.self_update();

    assert!(!recorded.is_current(&DiscoveryEntryPoints));
}
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
        AgentProviderUpdateCheckOutcome::Checked(AgentProviderUpdateAvailability::Available { .. })
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
            AgentProviderUpdateCheckOutcome::Checked(if enabled {
                unavailable(AgentProviderUpdateUnavailableReason::InvalidVersion)
            } else {
                AgentProviderUpdateAvailability::ChecksDisabled
            })
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
        AgentProviderUpdateCheckOutcome::Checked(unavailable(
            AgentProviderUpdateUnavailableReason::ProbeFailed
        ))
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
fn self_updated_executable_is_reported_without_comparing_the_stale_version() {
    let scratch = ScratchExecutable::new("self-update");
    let (registry, receipt) =
        fixture_with_executable(Some("1.0.0"), true, &scratch.effective_path());
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();

    scratch.self_update();

    let result = check_updates(
        &registry,
        lease,
        &AtomicBool::new(false),
        &Metadata(|_: &dyn Fn() -> bool| panic!("A changed executable must not be compared")),
    )
    .unwrap();
    assert_eq!(
        result.update,
        AgentProviderUpdateCheckOutcome::ExecutableChanged(ExecutableChanged::ExecutableChanged)
    );
    assert!(registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .is_ok());
}

#[test]
fn unchanged_executable_still_offers_the_newer_release() {
    let scratch = ScratchExecutable::new("unchanged");
    let (registry, receipt) =
        fixture_with_executable(Some("1.0.0"), true, &scratch.effective_path());
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    let result = check_updates(
        &registry,
        lease,
        &AtomicBool::new(false),
        &Metadata(|_: &dyn Fn() -> bool| Ok("1.1.0".to_string())),
    )
    .unwrap();
    assert!(matches!(
        result.update,
        AgentProviderUpdateCheckOutcome::Checked(AgentProviderUpdateAvailability::Available { .. })
    ));
}

#[test]
fn update_check_outcomes_serialize_to_the_closed_wire_contract() {
    let changed = AgentProviderUpdateCheckResult {
        update: AgentProviderUpdateCheckOutcome::ExecutableChanged(
            ExecutableChanged::ExecutableChanged,
        ),
        checked_at_epoch_ms: 7,
    };
    assert_eq!(
        serde_json::to_value(&changed).unwrap(),
        serde_json::json!({ "update": { "kind": "executableChanged" }, "checkedAtEpochMs": 7 })
    );
    let current = AgentProviderUpdateCheckResult {
        update: AgentProviderUpdateCheckOutcome::Checked(
            AgentProviderUpdateAvailability::Current {
                installed_version: "1.0.0".to_string(),
            },
        ),
        checked_at_epoch_ms: 7,
    };
    assert_eq!(
        serde_json::to_value(&current).unwrap(),
        serde_json::json!({
            "update": { "kind": "current", "installedVersion": "1.0.0" },
            "checkedAtEpochMs": 7
        })
    );
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
