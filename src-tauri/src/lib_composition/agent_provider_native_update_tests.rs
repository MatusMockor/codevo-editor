use super::*;
use crate::agent_task_spawner::agent_provider::{
    AgentProviderInstaller, AgentProviderSelfUpdateCommand,
};

fn native_home(label: &str) -> IsolatedFixture {
    IsolatedFixture::new(label)
}

fn candidate(
    installer: ResolvedAgentProviderInstaller,
    installed_version: &str,
    available_version: &str,
) -> AgentProviderUpdateCandidate {
    AgentProviderUpdateCandidate {
        cli_path: "/cli/provider".to_string(),
        cli_identity: match &installer {
            ResolvedAgentProviderInstaller::Npm { program, .. }
            | ResolvedAgentProviderInstaller::Homebrew { program, .. }
            | ResolvedAgentProviderInstaller::SelfUpdate { program, .. } => program.clone(),
        },
        effective_path: "/usr/bin:/bin".to_string(),
        path_fingerprint: "fingerprint".to_string(),
        discovery_generation: 1,
        installed_version: installed_version.to_string(),
        available_version: available_version.to_string(),
        installer,
    }
}

#[test]
fn native_probe_publishes_a_self_update_candidate_for_a_home_installed_cli() {
    let fixture = native_home("native-probe");
    let home = fixture.path("home");
    let cli = fixture.executable(
        "home/.codex/packages/standalone/current/bin/codex",
        "if [ \"$1\" = \"--version\" ]; then printf 'codex 0.150.1\\n'; exit 0; fi\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi\nexit 9",
    );
    let npm = fixture.executable(
        "bin/npm",
        "if [ \"$1\" = \"view\" ] && [ \"$2\" = \"@openai/codex\" ] && [ \"$3\" = \"version\" ] && [ \"$4\" = \"--json\" ] && [ \"$#\" -eq 4 ]; then printf '\"0.151.0\"\\n'; exit 0; fi\nexit 91",
    );
    let locator = FixedPackageManagerLocator::npm(&npm);
    let (registry, receipt) = registered_registry(&cli, true);
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let identity = lease.cli_identity.clone();

    let outcome = probe_native(
        &registry,
        &lease,
        &identity,
        &home,
        &AtomicBool::new(false),
        &locator,
    );

    let InstallerProbeOutcome::Resolved {
        installer,
        available_version,
    } = outcome
    else {
        panic!("expected a resolved native installer");
    };
    assert_eq!(available_version, "0.151.0");
    assert_eq!(
        installer,
        ResolvedAgentProviderInstaller::SelfUpdate {
            program: identity.clone(),
            command: AgentProviderSelfUpdateCommand::CodexUpdate,
        }
    );
    assert_eq!(
        installer.display(),
        AgentProviderInstaller::SelfUpdate {
            command: AgentProviderSelfUpdateCommand::CodexUpdate,
        }
    );
    let plan = installer
        .update_plan(
            AgentCliInvocation::CodexExec,
            &available_version,
            &lease.effective_path,
        )
        .expect("self-update plan");
    assert_eq!(plan.identity(), &identity);
    assert!(installer
        .update_plan(
            AgentCliInvocation::ClaudeCode,
            &available_version,
            &lease.effective_path,
        )
        .is_err());
    assert!(installer.owns_provider_executable(&identity));
    let foreign = executable_identity(npm.to_str().expect("npm path")).expect("npm identity");
    assert!(!ResolvedAgentProviderInstaller::SelfUpdate {
        program: foreign,
        command: AgentProviderSelfUpdateCommand::CodexUpdate,
    }
    .owns_provider_executable(&identity));
    assert_eq!(
        registry.cache_candidate(
            &lease,
            Some(AgentProviderUpdateCandidate {
                cli_path: lease.cli_path.clone(),
                cli_identity: identity.clone(),
                effective_path: lease.effective_path.clone(),
                path_fingerprint: lease.path_fingerprint.clone(),
                discovery_generation: lease.discovery_generation,
                installed_version: "0.150.1".to_string(),
                available_version,
                installer: ResolvedAgentProviderInstaller::SelfUpdate {
                    program: executable_identity(npm.to_str().expect("npm path"))
                        .expect("npm identity"),
                    command: AgentProviderSelfUpdateCommand::CodexUpdate,
                },
            }),
        ),
        Err(
            crate::agent_task_spawner::agent_provider::runtime::AGENT_PROVIDER_STALE_ERROR
                .to_string()
        )
    );
}

fn self_update_fixture(label: &str, update_behavior: &str) -> (IsolatedFixture, PathBuf) {
    let fixture = native_home(label);
    let version_path = fixture.path("state/version");
    fs::create_dir_all(version_path.parent().expect("state parent")).expect("state directory");
    fs::write(&version_path, "0.150.1\n").expect("installed version");
    let update_behavior = update_behavior.replace("$VERSION_PATH", &version_path.to_string_lossy());
    let cli = fixture.executable(
        "home/.codex/packages/standalone/current/bin/codex",
        &format!(
            "if [ \"$1\" = \"--version\" ]; then printf 'codex '; /bin/cat '{}'; exit 0; fi\nif [ \"$1\" = \"update\" ] && [ \"$#\" -eq 1 ]; then {update_behavior}; fi\nexit 9",
            version_path.display()
        ),
    );
    (fixture, cli)
}

fn admit_self_update_candidate(
    registry: &Arc<AgentProviderRuntimeRegistry>,
    receipt: AgentProviderPolicyReceipt,
) {
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    registry
        .cache_candidate(
            &lease,
            Some(AgentProviderUpdateCandidate {
                cli_path: lease.cli_path.clone(),
                cli_identity: lease.cli_identity.clone(),
                effective_path: lease.effective_path.clone(),
                path_fingerprint: lease.path_fingerprint.clone(),
                discovery_generation: lease.discovery_generation,
                installed_version: "0.150.1".to_string(),
                available_version: "0.151.0".to_string(),
                installer: ResolvedAgentProviderInstaller::SelfUpdate {
                    program: lease.cli_identity.clone(),
                    command: AgentProviderSelfUpdateCommand::CodexUpdate,
                },
            }),
        )
        .expect("self-update candidate");
}

#[test]
fn admitted_self_update_runs_the_provider_update_command_and_accepts_any_advance() {
    let (_fixture, cli) = self_update_fixture(
        "self-update-advance",
        "printf '0.152.0\\n' > '$VERSION_PATH'; exit 0",
    );
    let (registry, receipt) = registered_registry(&cli, true);
    admit_self_update_candidate(&registry, receipt);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("self-update result");

    assert_eq!(
        result,
        AgentProviderUpdateResult::Succeeded {
            previous_version: "0.150.1".to_string(),
            installed_version: "0.152.0".to_string(),
        }
    );
}

#[test]
fn admitted_self_update_that_does_not_advance_reports_version_not_advanced() {
    let (_fixture, cli) = self_update_fixture("self-update-stalled", "exit 0");
    let (registry, receipt) = registered_registry(&cli, true);
    admit_self_update_candidate(&registry, receipt);

    let result =
        run_agent_provider_update(&registry, &update_request(receipt), &AtomicBool::new(false))
            .expect("stalled self-update result");

    assert_eq!(
        result,
        AgentProviderUpdateResult::Failed {
            reason: AgentProviderUpdateFailureReason::VersionNotAdvanced,
            output_tail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes)."
                .to_string(),
            output_truncated: false,
        }
    );
}

#[test]
fn self_update_verification_requires_a_strictly_newer_installed_version() {
    let fixture = native_home("native-verification");
    let cli = fixture.executable("home/.claude/local/claude", "exit 0");
    let program = executable_identity(cli.to_str().expect("cli path")).expect("identity");
    let self_update = candidate(
        ResolvedAgentProviderInstaller::SelfUpdate {
            program: program.clone(),
            command: AgentProviderSelfUpdateCommand::ClaudeUpdate,
        },
        "2.1.261",
        "2.1.262",
    );

    assert_eq!(verification_failure(&self_update, "2.1.262"), None);
    assert_eq!(verification_failure(&self_update, "2.1.300"), None);
    assert_eq!(
        verification_failure(&self_update, "2.1.261"),
        Some(AgentProviderUpdateFailureReason::VersionNotAdvanced)
    );
    assert_eq!(
        verification_failure(&self_update, "2.1.260"),
        Some(AgentProviderUpdateFailureReason::Uncertain)
    );
    assert_eq!(
        verification_failure(&self_update, "not-a-version"),
        Some(AgentProviderUpdateFailureReason::Uncertain)
    );

    let npm = candidate(
        ResolvedAgentProviderInstaller::Npm {
            program: program.clone(),
            package_name: "@openai/codex".to_string(),
        },
        "0.150.1",
        "0.151.0",
    );
    assert_eq!(verification_failure(&npm, "0.151.0"), None);
    assert_eq!(
        verification_failure(&npm, "0.152.0"),
        Some(AgentProviderUpdateFailureReason::Uncertain)
    );
    let brew = candidate(
        ResolvedAgentProviderInstaller::Homebrew {
            program,
            cask: "codex".to_string(),
        },
        "0.150.1",
        "0.151.0",
    );
    assert_eq!(verification_failure(&brew, "0.151.0"), None);
    assert_eq!(
        verification_failure(&brew, "0.150.1"),
        Some(AgentProviderUpdateFailureReason::Uncertain)
    );
}

#[test]
fn self_update_wire_shape_is_closed_and_rejects_unknown_installer_kinds() {
    assert_eq!(
        serde_json::to_value(AgentProviderInstaller::SelfUpdate {
            command: AgentProviderSelfUpdateCommand::ClaudeUpdate,
        })
        .expect("claude self-update installer"),
        json!({"kind": "selfUpdate", "command": "claudeUpdate"})
    );
    assert_eq!(
        serde_json::to_value(AgentProviderInstaller::SelfUpdate {
            command: AgentProviderSelfUpdateCommand::CodexUpdate,
        })
        .expect("codex self-update installer"),
        json!({"kind": "selfUpdate", "command": "codexUpdate"})
    );
    assert_eq!(
        serde_json::to_value(AgentProviderUpdateAvailability::Available {
            installed_version: "2.1.261".to_string(),
            available_version: "2.1.262".to_string(),
            installer: AgentProviderInstaller::SelfUpdate {
                command: AgentProviderSelfUpdateCommand::ClaudeUpdate,
            },
        })
        .expect("available update"),
        json!({
            "kind": "available",
            "installedVersion": "2.1.261",
            "availableVersion": "2.1.262",
            "installer": {"kind": "selfUpdate", "command": "claudeUpdate"},
        })
    );
    assert_eq!(
        serde_json::to_value(AgentProviderUpdateResult::Failed {
            reason: AgentProviderUpdateFailureReason::VersionNotAdvanced,
            output_tail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes)."
                .to_string(),
            output_truncated: false,
        })
        .expect("failed update"),
        json!({
            "kind": "failed",
            "reason": "versionNotAdvanced",
            "outputTail": "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
            "outputTruncated": false,
        })
    );
    assert!(serde_json::from_value::<AgentProviderUpdateRequest>(json!({
        "provider": "claudeCode",
        "providerGeneration": 3,
        "operationId": "operation-native",
        "installer": {"kind": "selfUpdate", "command": "claudeUpdate"},
    }))
    .is_err());
    assert!(serde_json::from_value::<AgentProviderUpdateRequest>(json!({
        "provider": "claudeCode",
        "providerGeneration": 3,
        "operationId": "operation-native",
    }))
    .is_ok());
}

#[test]
fn native_ownership_without_a_release_registry_is_probe_failed_and_admits_no_candidate() {
    let fixture = native_home("native-no-npm");
    let home = fixture.path("home");
    let cli = fixture.executable(
        "home/.codex/packages/standalone/current/bin/codex",
        "if [ \"$1\" = \"--version\" ]; then printf 'codex 0.150.1\\n'; exit 0; fi\nexit 9",
    );
    let locator = FixedPackageManagerLocator::empty();
    let (registry, receipt) = registered_registry(&cli, true);
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .expect("health lease");
    let identity = lease.cli_identity.clone();

    let outcome = probe_native(
        &registry,
        &lease,
        &identity,
        &home,
        &AtomicBool::new(false),
        &locator,
    );

    assert!(matches!(
        outcome,
        InstallerProbeOutcome::Unavailable(AgentProviderUpdateUnavailableReason::ProbeFailed)
    ));
    assert_eq!(
        native_metadata_reason(AgentProviderUpdateUnavailableReason::UnknownInstaller),
        AgentProviderUpdateUnavailableReason::ProbeFailed
    );
    assert_eq!(
        native_metadata_reason(AgentProviderUpdateUnavailableReason::UnsupportedProbe),
        AgentProviderUpdateUnavailableReason::UnsupportedProbe
    );
    drop(lease);
    assert!(registry
        .acquire_update(
            AgentCliInvocation::CodexExec,
            receipt.provider_generation,
            "operation-no-candidate",
        )
        .is_err());
}

#[test]
fn npm_ownership_short_circuits_the_native_probe() {
    let npm = npm_fixture("printf '0.151.0\\n' > '$VERSION_PATH'; exit 0");
    let locator = FixedPackageManagerLocator::npm(&npm.manager_path);
    let (registry, receipt) = registered_registry(&npm.provider_path, true);

    let health = health_with_locator(&registry, receipt, &locator);

    assert!(matches!(
        health.update,
        AgentProviderUpdateAvailability::Available { ref installer, .. }
            if installer == &AgentProviderInstaller::Npm {
                package_name: "@openai/codex".to_string(),
            }
    ));
    assert_eq!(locator.calls.load(Ordering::SeqCst), 1);
}

#[cfg(unix)]
#[test]
fn self_update_provider_swap_at_the_spawn_boundary_refuses_without_updating() {
    use std::os::unix::fs::PermissionsExt;

    let (fixture, cli) = self_update_fixture(
        "self-update-swap",
        "printf '0.152.0\\n' > '$VERSION_PATH'; exit 0",
    );
    let version_path = fixture.path("state/version");
    let (registry, receipt) = registered_registry(&cli, true);
    admit_self_update_candidate(&registry, receipt);
    let swapped = cli.clone();
    let retained = cli.with_extension("retained");

    let result = run_agent_provider_update_with_spawn_barrier(
        &registry,
        &update_request(receipt),
        &AtomicBool::new(false),
        move || {
            fs::rename(&swapped, &retained).expect("retain admitted provider");
            fs::write(&swapped, "#!/bin/sh\nprintf 'codex 9.9.9\\n'\n")
                .expect("replacement provider");
            fs::set_permissions(&swapped, fs::Permissions::from_mode(0o755))
                .expect("replacement permissions");
        },
    )
    .expect("closed admission result");

    assert!(
        matches!(
            &result,
            AgentProviderUpdateResult::Failed {
                reason: AgentProviderUpdateFailureReason::AdmissionRefused,
                ..
            }
        ),
        "got {result:?}"
    );
    assert_eq!(
        fs::read_to_string(&version_path).expect("version state"),
        "0.150.1\n"
    );
}
