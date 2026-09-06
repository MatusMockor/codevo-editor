use super::*;

struct SharedDiscoveryResolver {
    resolved: Mutex<ResolvedProviderExecutable>,
    expected_override: Option<String>,
    refreshes: AtomicUsize,
    foreign_advance_after_refreshes: Option<usize>,
    foreign_advance_applied: AtomicBool,
}

impl SharedDiscoveryResolver {
    fn new(provider: &Path, effective_path: &str) -> Self {
        let identity = executable_identity(provider.to_str().expect("provider path"))
            .expect("provider identity");
        Self {
            resolved: Mutex::new(ResolvedProviderExecutable {
                cli_path: identity.canonical_path.to_string_lossy().into_owned(),
                cli_identity: identity,
                effective_path: effective_path.to_string(),
                path_fingerprint: "effective-path-1".to_string(),
                discovery_generation: 1,
            }),
            expected_override: None,
            refreshes: AtomicUsize::new(0),
            foreign_advance_after_refreshes: None,
            foreign_advance_applied: AtomicBool::new(false),
        }
    }

    fn expecting_override(mut self, manual_override: &Path) -> Self {
        self.expected_override = Some(manual_override.to_string_lossy().into_owned());
        self
    }

    fn advancing_epoch_after_refreshes(mut self, refreshes: usize) -> Self {
        self.foreign_advance_after_refreshes = Some(refreshes);
        self
    }

    fn apply_pending_foreign_advance(&self) {
        let Some(threshold) = self.foreign_advance_after_refreshes else {
            return;
        };
        if self.refreshes.load(Ordering::SeqCst) < threshold {
            return;
        }
        if self.foreign_advance_applied.swap(true, Ordering::SeqCst) {
            return;
        }
        self.advance_epoch();
    }

    fn snapshot(&self) -> ResolvedProviderExecutable {
        self.resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn epoch(&self) -> u64 {
        self.snapshot().discovery_generation
    }

    fn advance_epoch(&self) {
        let mut resolved = self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.discovery_generation = resolved.discovery_generation.saturating_add(1);
    }

    fn regress_epoch(&self) {
        let mut resolved = self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.discovery_generation = resolved.discovery_generation.saturating_sub(1);
    }

    fn replace_executable(&self, provider: &Path) {
        let identity = executable_identity(provider.to_str().expect("replacement path"))
            .expect("replacement identity");
        let mut resolved = self
            .resolved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        resolved.cli_path = identity.canonical_path.to_string_lossy().into_owned();
        resolved.cli_identity = identity;
        resolved.discovery_generation = resolved.discovery_generation.saturating_add(1);
    }
}

impl AgentProviderExecutableResolver for SharedDiscoveryResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        if self.expected_override.as_deref() != manual_override {
            return Err("Provider executable unavailable.".to_string());
        }
        if refresh {
            self.refreshes.fetch_add(1, Ordering::SeqCst);
            self.advance_epoch();
            return Ok(self.snapshot());
        }
        self.apply_pending_foreign_advance();
        Ok(self.snapshot())
    }
}

fn installing_npm_fixture(label_behavior: &str) -> NpmFixture {
    let npm = npm_fixture(label_behavior);
    let version_path = npm._fixture.path("registry/installed-version");
    let script = fs::read_to_string(&npm.manager_path)
        .expect("npm script")
        .replace("$VERSION_PATH", &version_path.to_string_lossy());
    fs::write(&npm.manager_path, script).expect("patched npm script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&npm.manager_path, fs::Permissions::from_mode(0o755))
            .expect("npm permissions");
    }
    npm
}

fn shared_discovery_registry(
    resolver: Arc<SharedDiscoveryResolver>,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    shared_discovery_registry_with_path(resolver, None)
}

fn shared_discovery_registry_with_path(
    resolver: Arc<SharedDiscoveryResolver>,
    cli_path: Option<String>,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path,
                check_for_updates: true,
            },
        )
        .expect("registered policy");
    (registry, receipt)
}

#[test]
fn a_foreign_discovery_refresh_does_not_refuse_an_admitted_update() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(SharedDiscoveryResolver::new(
        &npm.provider_path,
        &effective_path,
    ));
    let (registry, receipt) = shared_discovery_registry(Arc::clone(&resolver));

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let admitted_epoch = resolver.epoch();

    resolver.advance_epoch();
    assert!(resolver.epoch() > admitted_epoch);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("update result");

    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    assert!(npm.install_marker.exists());
}

#[test]
fn a_regressed_discovery_epoch_still_refuses_an_admitted_update() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(SharedDiscoveryResolver::new(
        &npm.provider_path,
        &effective_path,
    ));
    let (registry, receipt) = shared_discovery_registry(Arc::clone(&resolver));

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let admitted_epoch = resolver.epoch();

    resolver.regress_epoch();
    assert!(resolver.epoch() < admitted_epoch);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("refused update result");

    assert!(
        matches!(
            &result,
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::AuthorityChanged,
                ..
            }
        ),
        "got {result:?}"
    );
    assert!(!npm.install_marker.exists());
}

#[test]
fn a_discovery_content_change_still_refuses_an_admitted_update() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(SharedDiscoveryResolver::new(
        &npm.provider_path,
        &effective_path,
    ));
    let (registry, receipt) = shared_discovery_registry(Arc::clone(&resolver));

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let foreign = npm._fixture.executable(
        "foreign/codex",
        "if [ \"$1\" = \"--version\" ]; then printf 'codex 9.9.9\\n'; exit 0; fi\nexit 9",
    );

    resolver.replace_executable(&foreign);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("refused update result");

    assert!(
        matches!(
            &result,
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::ExecutableChanged,
                ..
            }
        ),
        "got {result:?}"
    );
    assert!(!npm.install_marker.exists());
}

#[test]
fn a_manual_override_admitted_update_survives_a_foreign_discovery_refresh() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(
        SharedDiscoveryResolver::new(&npm.provider_path, &effective_path)
            .expecting_override(&npm.provider_path),
    );
    let (registry, receipt) = shared_discovery_registry_with_path(
        Arc::clone(&resolver),
        Some(npm.provider_path.to_string_lossy().into_owned()),
    );

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let admitted_epoch = resolver.epoch();

    resolver.advance_epoch();
    assert!(resolver.epoch() > admitted_epoch);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("update result");

    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    assert!(npm.install_marker.exists());
}

#[test]
fn a_foreign_refresh_after_the_post_update_refresh_still_verifies_the_update() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(
        SharedDiscoveryResolver::new(&npm.provider_path, &effective_path)
            .advancing_epoch_after_refreshes(2),
    );
    let (registry, receipt) = shared_discovery_registry(Arc::clone(&resolver));

    let health = health_with_locator(&registry, receipt, &locator);
    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { .. }
    ));
    let admitted_epoch = resolver.epoch();

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("update result");

    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.151.0".to_string(),
        }
    );
    assert!(npm.install_marker.exists());
    assert!(
        resolver.epoch() > admitted_epoch.saturating_add(1),
        "post-update refresh and foreign refresh both advanced the epoch"
    );
}

#[test]
fn cache_candidate_rejects_a_discovery_epoch_mismatch() {
    let npm = installing_npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let effective_path = std::env::var("PATH").expect("effective PATH");
    let resolver = Arc::new(SharedDiscoveryResolver::new(
        &npm.provider_path,
        &effective_path,
    ));
    let (registry, receipt) = shared_discovery_registry(Arc::clone(&resolver));
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let installer = ResolvedAgentProviderInstaller::Npm {
        program: executable_identity(npm.manager_path.to_str().expect("npm path")).expect("npm"),
        package_name: "@openai/codex".to_string(),
    };
    let candidate = AgentProviderUpdateCandidate {
        cli_path: lease.cli_path.clone(),
        cli_identity: lease.cli_identity.clone(),
        effective_path: lease.effective_path.clone(),
        path_fingerprint: lease.path_fingerprint.clone(),
        discovery_generation: lease.discovery_generation,
        installed_version: "0.150.1".to_string(),
        available_version: "0.151.0".to_string(),
        installer,
    };
    let mismatched = AgentProviderUpdateCandidate {
        discovery_generation: lease.discovery_generation.saturating_add(1),
        ..candidate.clone()
    };

    assert!(registry.cache_candidate(&lease, Some(mismatched)).is_err());
    assert!(registry.cache_candidate(&lease, Some(candidate)).is_ok());
}

#[test]
fn update_result_wire_contract_is_closed_and_exact() {
    assert_eq!(
        serde_json::to_value(AgentProviderUpdateResult::Succeeded {
            previous_version: "2.1.261".to_string(),
            installed_version: "2.1.263".to_string(),
        })
        .expect("succeeded result"),
        json!({
            "kind": "succeeded",
            "previousVersion": "2.1.261",
            "installedVersion": "2.1.263",
        })
    );
    assert_eq!(
        serde_json::to_value(AgentProviderUpdateResult::AlreadyCurrent {
            installed_version: "2.1.261".to_string(),
        })
        .expect("already current result"),
        json!({
            "kind": "alreadyCurrent",
            "installedVersion": "2.1.261",
        })
    );
    for (reason, wire) in [
        (
            AgentProviderUpdateFailureReason::OperationSuperseded,
            "operationSuperseded",
        ),
        (
            AgentProviderUpdateFailureReason::AuthorityChanged,
            "authorityChanged",
        ),
        (
            AgentProviderUpdateFailureReason::ExecutableChanged,
            "executableChanged",
        ),
        (
            AgentProviderUpdateFailureReason::InstallerUnsupported,
            "installerUnsupported",
        ),
        (AgentProviderUpdateFailureReason::SpawnFailed, "spawnFailed"),
        (AgentProviderUpdateFailureReason::TimedOut, "timedOut"),
        (
            AgentProviderUpdateFailureReason::OutputLimitExceeded,
            "outputLimitExceeded",
        ),
        (AgentProviderUpdateFailureReason::Exited, "exited"),
        (AgentProviderUpdateFailureReason::Uncertain, "uncertain"),
    ] {
        assert_eq!(
            serde_json::to_value(AgentProviderUpdateResult::Failed {
                reason,
                output_tail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes)."
                    .to_string(),
                output_truncated: false,
            })
            .expect("failed result"),
            json!({
                "kind": "failed",
                "reason": wire,
                "outputTail": "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
                "outputTruncated": false,
            })
        );
    }
}
