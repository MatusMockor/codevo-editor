use super::*;

struct FixedReleaseMetadata {
    calls: AtomicUsize,
}

impl AgentProviderReleaseMetadataSource for FixedReleaseMetadata {
    fn latest(
        &self,
        _provider: AgentCliInvocation,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<String, RegistryVersionError> {
        if cancelled() {
            return Err(RegistryVersionError::Cancelled);
        }
        let version = self.calls.fetch_add(1, Ordering::SeqCst) + 2;
        Ok(format!("1.2.{version}"))
    }
}

#[test]
fn manual_release_checks_need_no_package_manager_and_fetch_each_time() {
    for provider in [
        AgentCliInvocation::ClaudeCode,
        AgentCliInvocation::CodexExec,
    ] {
        let fixture = IsolatedFixture::new("manual-release-without-npm");
        let cli = fixture.executable("native/provider", "exit 91");
        let locator = FixedPackageManagerLocator::empty();
        let source = FixedReleaseMetadata {
            calls: AtomicUsize::new(0),
        };
        let (registry, receipt) = native_provider_registry(provider, &cli);
        let lease = registry
            .acquire_health_for_generation(provider, receipt.provider_generation)
            .expect("health lease");
        for available_version in ["1.2.2", "1.2.3"] {
            let (availability, candidate) = probe_update(
                &registry,
                &lease,
                &lease.cli_identity,
                Some("1.2.1"),
                &AtomicBool::new(false),
                &locator,
                &source,
            );
            assert_eq!(
                availability,
                AgentProviderUpdateAvailability::ManualUpdateAvailable {
                    installed_version: "1.2.1".to_string(),
                    available_version: available_version.to_string(),
                }
            );
            assert!(candidate.is_none());
        }
        assert_eq!(locator.calls.load(Ordering::SeqCst), 0);
        assert_eq!(source.calls.load(Ordering::SeqCst), 2);
    }
}

#[test]
fn native_release_check_needs_no_package_manager() {
    let fixture = IsolatedFixture::new("native-release-without-npm");
    let cli = fixture.executable("home/.codex/packages/current/bin/codex", "exit 91");
    let source = FixedReleaseMetadata {
        calls: AtomicUsize::new(0),
    };
    let (registry, receipt) = registered_registry(&cli, true);
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let result = probe_native(
        &registry,
        &lease,
        &lease.cli_identity,
        &fixture.path("home"),
        &AtomicBool::new(false),
        &source,
    );
    assert!(matches!(
        result,
        InstallerProbeOutcome::Resolved {
            installer: ResolvedAgentProviderInstaller::SelfUpdate { .. },
            available_version,
        } if available_version == "1.2.2"
    ));
    assert_eq!(source.calls.load(Ordering::SeqCst), 1);
}

struct ReplacingReleaseMetadata<'a> {
    registry: &'a Arc<AgentProviderRuntimeRegistry>,
    lease: &'a ProviderHealthLease,
}

impl AgentProviderReleaseMetadataSource for ReplacingReleaseMetadata<'_> {
    fn latest(
        &self,
        provider: AgentCliInvocation,
        _cancelled: &dyn Fn() -> bool,
    ) -> Result<String, RegistryVersionError> {
        self.registry
            .register_policy(
                provider,
                2,
                Some(self.lease.generation),
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: Some(self.lease.cli_path.clone()),
                    check_for_updates: false,
                },
            )
            .expect("replace provider policy during metadata request");
        Ok("1.2.3".to_string())
    }
}

#[test]
fn release_metadata_cannot_publish_after_provider_policy_replacement() {
    let fixture = IsolatedFixture::new("release-policy-replacement");
    let cli = fixture.executable("native/provider", "exit 91");
    let (registry, receipt) = registered_registry(&cli, true);
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let source = ReplacingReleaseMetadata {
        registry: &registry,
        lease: &lease,
    };
    assert_eq!(
        probe_manual_available_version(&registry, &lease, &AtomicBool::new(false), &source),
        Err(AgentProviderUpdateUnavailableReason::ProbeFailed)
    );
}

struct ObservedVersionResolver(ResolvedProviderExecutable);

impl AgentProviderExecutableResolver for ObservedVersionResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        _manual_override: Option<&str>,
        _refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        Ok(self.0.clone())
    }

    fn observed_version(
        &self,
        _provider: AgentCliInvocation,
        expected: &ExecutableIdentity,
        generation: u64,
    ) -> Option<String> {
        (expected == &self.0.cli_identity && generation == self.0.discovery_generation)
            .then(|| "1.2.1".to_string())
    }
}

#[test]
fn known_installed_version_skips_version_process_but_refreshes_authentication() {
    let fixture = IsolatedFixture::new("known-installed-version");
    let version_marker = fixture.path("version-called");
    let auth_marker = fixture.path("auth-called");
    let cli = fixture.executable(
        "native/provider",
        &format!(
            "if [ \"$1\" = \"--version\" ]; then printf called > '{}'; exit 91; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf called > '{}'; printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 91",
            version_marker.display(),
            auth_marker.display(),
        ),
    );
    let identity = executable_identity(cli.to_str().expect("cli path")).expect("identity");
    let resolver = ObservedVersionResolver(ResolvedProviderExecutable {
        cli_path: identity.canonical_path.to_string_lossy().into_owned(),
        cli_identity: identity,
        effective_path: "/usr/bin:/bin".to_string(),
        path_fingerprint: "observed-native".to_string(),
        discovery_generation: 1,
    });
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(Arc::new(
        resolver,
    )));
    let receipt = registry
        .register_policy(
            AgentCliInvocation::CodexExec,
            1,
            None,
            AgentProviderPolicy {
                enabled: true,
                cli_path: None,
                check_for_updates: true,
            },
        )
        .expect("provider policy");
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let result = probe_health_with_sources(
        &registry,
        lease,
        &AtomicBool::new(false),
        &FixedPackageManagerLocator::empty(),
        &FixedReleaseMetadata {
            calls: AtomicUsize::new(0),
        },
    )
    .expect("health result");
    assert_eq!(result.installed_version.as_deref(), Some("1.2.1"));
    assert!(!version_marker.exists());
    assert!(auth_marker.exists());
}

#[test]
fn incompatible_artifacts_skip_package_manager_resolution() {
    for (provider, relative) in [
        (AgentCliInvocation::ClaudeCode, "native/2.1.266"),
        (AgentCliInvocation::ClaudeCode, "native/claude"),
        (AgentCliInvocation::CodexExec, "native/current/bin/codex"),
        (AgentCliInvocation::CodexExec, "native/not-bin/codex.js"),
    ] {
        let fixture = IsolatedFixture::new("ineligible-installer");
        let cli = fixture.executable(relative, "exit 0");
        let locator = FixedPackageManagerLocator::empty();
        let (registry, receipt) = native_provider_registry(provider, &cli);
        let lease = registry
            .acquire_health_for_generation(provider, receipt.provider_generation)
            .expect("health lease");
        for probe in [probe_npm, probe_brew] {
            assert!(matches!(
                probe(
                    &registry,
                    &lease,
                    &lease.cli_identity,
                    "1.2.3",
                    &AtomicBool::new(false),
                    &locator,
                    &locator,
                ),
                InstallerProbeOutcome::NotOwned
            ));
        }
        assert_eq!(locator.calls.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn matching_artifact_suffix_does_not_grant_installer_ownership() {
    for (provider, artifact, probe, manager) in [
        (
            AgentCliInvocation::ClaudeCode,
            "cli.js",
            probe_npm as InstallerOwnershipProbe,
            "npm",
        ),
        (
            AgentCliInvocation::CodexExec,
            "bin/codex.js",
            probe_npm as InstallerOwnershipProbe,
            "npm",
        ),
        (
            AgentCliInvocation::ClaudeCode,
            "1.2.3/claude",
            probe_brew as InstallerOwnershipProbe,
            "brew",
        ),
        (
            AgentCliInvocation::CodexExec,
            "1.2.3/bin/codex",
            probe_brew as InstallerOwnershipProbe,
            "brew",
        ),
    ] {
        let fixture = IsolatedFixture::new("eligible-foreign-installer");
        let cli = fixture.executable(&format!("foreign/{artifact}"), "exit 0");
        let owner = fixture.path("owner");
        fs::create_dir_all(owner.join(npm_package(provider))).expect("manager root");
        let program = fixture.executable(
            &format!("bin/{manager}"),
            &format!("printf '%s\\n' '{}'", owner.display()),
        );
        let locator = match manager {
            "npm" => FixedPackageManagerLocator::npm(&program),
            "brew" => FixedPackageManagerLocator::brew(&program),
            _ => unreachable!(),
        };
        let (registry, receipt) = native_provider_registry(provider, &cli);
        let lease = registry
            .acquire_health_for_generation(provider, receipt.provider_generation)
            .expect("health lease");
        assert!(matches!(
            probe(
                &registry,
                &lease,
                &lease.cli_identity,
                "1.2.3",
                &AtomicBool::new(false),
                &locator,
                &locator,
            ),
            InstallerProbeOutcome::NotOwned
        ));
        assert_eq!(locator.calls.load(Ordering::SeqCst), 1);
    }
}
