use super::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

pub(crate) struct ScratchExecutable {
    pub(crate) root: PathBuf,
    name: &'static str,
}

impl ScratchExecutable {
    pub(crate) fn new(label: &str) -> Self {
        Self::installed(label, "codex")
    }

    pub(crate) fn installed(label: &str, name: &'static str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "codevo-update-check-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, AtomicOrdering::Relaxed)
        ));
        let scratch = Self { root, name };
        scratch.install_version("1.0.0", b"one");
        std::fs::create_dir_all(scratch.bin()).expect("bin");
        link(&scratch.version("1.0.0"), &scratch.bin().join(name));
        scratch
    }

    pub(crate) fn effective_path(&self) -> String {
        self.bin().to_str().expect("utf-8 path").to_string()
    }

    pub(crate) fn bin(&self) -> PathBuf {
        self.root.join("bin")
    }

    fn version(&self, version: &str) -> PathBuf {
        self.root.join("versions").join(version)
    }

    fn install_version(&self, version: &str, contents: &[u8]) {
        install_executable(&self.version(version), contents);
    }

    pub(crate) fn self_update(&self) {
        self.install_version("1.1.0", b"one-one, a longer build");
        let entry = self.bin().join(self.name);
        std::fs::remove_file(&entry).expect("unlink");
        link(&self.version("1.1.0"), &entry);
        assert!(self.version("1.0.0").exists());
    }

    fn overwrite_in_place(&self) {
        install_executable(&self.version("1.0.0"), b"one, rewritten");
    }
}

impl Drop for ScratchExecutable {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub(crate) fn install_executable(path: &Path, contents: &[u8]) {
    std::fs::create_dir_all(path.parent().expect("parent")).expect("directory");
    std::fs::write(path, contents).expect("write executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
}

#[cfg(unix)]
pub(crate) fn link(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).expect("symlink");
}

#[cfg(not(unix))]
pub(crate) fn link(target: &Path, link: &Path) {
    std::fs::copy(target, link).expect("copy");
}

pub(crate) fn identity_of(canonical: &Path, effective_path: &str) -> ExecutableIdentity {
    crate::agent_task_spawner::agent_provider::process::executable_identity_path_with_effective_path(
        canonical,
        effective_path,
    )
    .expect("identity")
}

pub(crate) struct ForbiddenResolver;
impl AgentProviderExecutableResolver for ForbiddenResolver {
    fn resolve_provider(
        &self,
        _: AgentCliInvocation,
        _: Option<&str>,
        _: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        panic!("A metadata check must not discover, hash, or execute a CLI");
    }

    fn entry_point(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
    ) -> Option<ProviderEntryPoint> {
        let candidates = match manual_override {
            Some(manual) => vec![PathBuf::from(manual)],
            None => std::env::split_paths(effective_path)
                .map(|directory| directory.join(test_executable_name(provider)))
                .collect(),
        };
        candidates.into_iter().find_map(|unresolved| {
            let canonical = std::fs::canonicalize(&unresolved).ok()?;
            canonical.is_file().then_some(ProviderEntryPoint {
                unresolved,
                canonical,
            })
        })
    }
}

fn test_executable_name(provider: AgentCliInvocation) -> &'static str {
    match provider {
        AgentCliInvocation::ClaudeCode => "claude",
        AgentCliInvocation::CodexExec => "codex",
    }
}

pub(crate) fn fixture(
    installed_version: Option<&str>,
    checks_enabled: bool,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    let test_binary = std::env::current_exe().expect("test executable");
    let executable = ExecutableStatFingerprint::current(
        &ForbiddenResolver,
        AgentCliInvocation::CodexExec,
        Some(test_binary.to_str().expect("utf-8 test binary path")),
        "",
    );
    fixture_with_fingerprint(installed_version, checks_enabled, executable)
}

pub(crate) fn fixture_with_executable(
    installed_version: Option<&str>,
    checks_enabled: bool,
    effective_path: &str,
) -> (
    Arc<AgentProviderRuntimeRegistry>,
    AgentProviderPolicyReceipt,
) {
    let executable = ExecutableStatFingerprint::current(
        &ForbiddenResolver,
        AgentCliInvocation::CodexExec,
        None,
        effective_path,
    );
    fixture_with_fingerprint(installed_version, checks_enabled, executable)
}

fn fixture_with_fingerprint(
    installed_version: Option<&str>,
    checks_enabled: bool,
    executable: ExecutableStatFingerprint,
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
                codex_transport: Default::default(),
                codex_app_server_args: Vec::new(),
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
        executable,
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

#[test]
fn fingerprint_detects_an_in_place_replacement_of_the_executable() {
    let scratch = ScratchExecutable::new("in-place");
    let recorded = ExecutableStatFingerprint::current(
        &ForbiddenResolver,
        AgentCliInvocation::CodexExec,
        None,
        &scratch.effective_path(),
    );
    assert!(recorded.is_current(&ForbiddenResolver));

    scratch.overwrite_in_place();

    assert!(!recorded.is_current(&ForbiddenResolver));
}

#[test]
fn fingerprint_of_a_missing_or_mismatched_executable_is_never_current() {
    let scratch = ScratchExecutable::new("missing");
    let path = scratch.effective_path();
    let recorded = ExecutableStatFingerprint::current(
        &ForbiddenResolver,
        AgentCliInvocation::CodexExec,
        None,
        &path,
    );
    std::fs::remove_file(scratch.bin().join("codex")).unwrap();
    assert!(!recorded.is_current(&ForbiddenResolver));

    let other = ScratchExecutable::installed("mismatch", "claude");
    let other_path = other.effective_path();
    let foreign = identity_of(
        &std::fs::canonicalize(other.bin().join("claude")).unwrap(),
        &other_path,
    );
    let unverifiable = ExecutableStatFingerprint::recorded(
        &ForbiddenResolver,
        AgentCliInvocation::CodexExec,
        None,
        &path,
        &foreign,
    );
    assert!(!unverifiable.is_current(&ForbiddenResolver));
}

#[test]
fn fingerprint_without_an_entry_point_port_is_never_current() {
    let scratch = ScratchExecutable::new("no-port");
    let recorded = ExecutableStatFingerprint::current(
        &TestProviderExecutableResolver,
        AgentCliInvocation::CodexExec,
        None,
        &scratch.effective_path(),
    );
    assert!(!recorded.is_current(&TestProviderExecutableResolver));
}

#[test]
fn metadata_lease_reports_whether_the_observed_executable_is_still_current() {
    let scratch = ScratchExecutable::new("lease");
    let (registry, receipt) =
        fixture_with_executable(Some("1.0.0"), true, &scratch.effective_path());
    let lease = registry
        .acquire_update_check(receipt.provider, receipt.provider_generation)
        .unwrap();
    assert!(lease.executable_is_current());

    scratch.self_update();

    assert!(!lease.executable_is_current());
}
