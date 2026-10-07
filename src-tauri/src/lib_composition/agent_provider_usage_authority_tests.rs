use crate::agent_cli_discovery::{
    AgentCliDiscovery, AgentCliDiscoveryContext, AgentCliVersionSource,
    EffectiveExecutableEnvironment,
};
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderPolicy, AgentProviderRuntimeRegistry, ProviderTurnLease,
    AGENT_PROVIDER_STALE_ERROR,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

const PROVIDER: AgentCliInvocation = AgentCliInvocation::ClaudeCode;

struct SearchPath(Mutex<String>);

impl AgentCliDiscoveryContext for SearchPath {
    fn home_directory(&self) -> Option<PathBuf> {
        None
    }

    fn login_shell(&self) -> Option<PathBuf> {
        None
    }

    fn current_path(&self) -> Option<String> {
        Some(self.0.lock().expect("search path").clone())
    }
}

struct UnprobedVersions;

impl AgentCliVersionSource for UnprobedVersions {
    fn version(&self, _: AgentCliInvocation, _: &Path, _: &str) -> Option<String> {
        None
    }
}

struct Fixture {
    root: PathBuf,
    search_path: Arc<SearchPath>,
    discovery: Arc<AgentCliDiscovery>,
    registry: Arc<AgentProviderRuntimeRegistry>,
    generation: u64,
}

impl Fixture {
    fn detected(label: &str) -> Self {
        Self::new(label, install_entry, |_| None)
    }

    fn manual(label: &str) -> Self {
        Self::new(label, install_entry, |cli| {
            Some(cli.to_string_lossy().into_owned())
        })
    }

    #[cfg(unix)]
    fn versioned(label: &str) -> Self {
        Self::new(
            label,
            |entry| {
                let first = entry.with_file_name("version-1");
                install(&first, "version one");
                std::os::unix::fs::symlink(first, entry).expect("entry link");
            },
            |_| None,
        )
    }

    fn new(
        label: &str,
        install_entry: impl FnOnce(&Path),
        cli_path: impl FnOnce(&Path) -> Option<String>,
    ) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "codevo-usage-authority-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let bin = root.join("bin");
        fs::create_dir_all(&bin).expect("bin");
        install_entry(&bin.join("claude"));
        let cli = fs::canonicalize(bin.join("claude")).expect("canonical cli");
        let search_path = Arc::new(SearchPath(Mutex::new(joined(&[&bin]))));
        let discovery = Arc::new(AgentCliDiscovery::with_collaborators(
            search_path.clone(),
            Arc::new(UnprobedVersions),
            Duration::ZERO,
        ));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
            discovery.clone(),
        ));
        let generation = registry
            .register_policy(
                PROVIDER,
                1,
                None,
                AgentProviderPolicy {
                    enabled: true,
                    cli_path: cli_path(&cli),
                    check_for_updates: false,
                    codex_transport: Default::default(),
                    codex_app_server_args: Vec::new(),
                },
            )
            .expect("policy")
            .provider_generation;
        Self {
            root,
            search_path,
            discovery,
            registry,
            generation,
        }
    }

    fn cli(&self) -> PathBuf {
        self.root.join("bin").join("claude")
    }

    fn turn(&self) -> ProviderTurnLease {
        self.registry
            .acquire_turn_for_generation(PROVIDER, self.generation)
            .expect("turn lease")
    }

    fn discovery_generation(&self) -> u64 {
        self.discovery
            .effective_environment()
            .expect("environment")
            .authority_generation()
    }

    fn revalidate(&self, turn: &ProviderTurnLease) -> Result<(), String> {
        self.registry.revalidate_turn_authority(turn)
    }

    fn snapshot(&self) -> Arc<EffectiveExecutableEnvironment> {
        self.discovery.effective_environment().expect("environment")
    }

    #[cfg(unix)]
    fn self_update(&self) -> String {
        let entry = self.cli();
        let second = entry.with_file_name("version-2");
        install(&second, "version two, a longer build");
        fs::remove_file(&entry).expect("unlink entry");
        std::os::unix::fs::symlink(&second, &entry).expect("retarget entry");
        fs::canonicalize(second)
            .expect("canonical update")
            .to_string_lossy()
            .into_owned()
    }

    #[cfg(unix)]
    fn remove_previous_version(&self) {
        fs::remove_file(self.cli().with_file_name("version-1")).expect("remove previous");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn install_entry(entry: &Path) {
    install(entry, "original");
}

fn install(path: &Path, contents: &str) {
    fs::write(path, contents).expect("write executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("chmod");
    }
}

fn joined(directories: &[&Path]) -> String {
    std::env::join_paths(directories)
        .expect("search path")
        .to_string_lossy()
        .into_owned()
}

fn stale() -> Result<(), String> {
    Err(AGENT_PROVIDER_STALE_ERROR.to_string())
}

#[test]
fn reading_account_usage_keeps_the_discovery_authority_of_a_held_turn() {
    let fixture = Fixture::detected("usage-read");
    let turn = fixture.turn();
    let before = fixture.discovery.effective_environment().expect("before");

    let usage = fixture
        .registry
        .acquire_account_usage_for_generation(PROVIDER, fixture.generation)
        .expect("usage lease");

    let after = fixture.discovery.effective_environment().expect("after");
    assert!(Arc::ptr_eq(&before, &after));
    assert_eq!(usage.discovery_generation, turn.discovery_generation);
    assert_eq!(fixture.registry.revalidate_health(&usage), Ok(()));
    assert_eq!(fixture.revalidate(&turn), Ok(()));
}

#[test]
fn held_turn_survives_a_health_probe_refresh_of_an_identical_environment() {
    for fixture in [
        Fixture::detected("health-refresh"),
        Fixture::manual("health-refresh-manual"),
    ] {
        let turn = fixture.turn();

        let health = fixture
            .registry
            .acquire_health_for_generation(PROVIDER, fixture.generation)
            .expect("health lease");

        assert!(health.discovery_generation > turn.discovery_generation);
        assert_eq!(health.cli_identity, turn.cli_identity);
        assert_eq!(fixture.revalidate(&turn), Ok(()));
    }
}

#[test]
fn held_turn_survives_repeated_discovery_refreshes_of_an_identical_environment() {
    let fixture = Fixture::detected("repeated-refresh");
    let turn = fixture.turn();

    fixture.discovery.refresh().expect("first refresh");
    fixture.discovery.refresh().expect("second refresh");

    assert_eq!(
        fixture.discovery_generation(),
        turn.discovery_generation + 2
    );
    assert_eq!(fixture.revalidate(&turn), Ok(()));
}

#[test]
fn held_turn_is_rejected_when_a_refresh_discovers_a_replaced_executable() {
    for fixture in [
        Fixture::detected("replaced"),
        Fixture::manual("replaced-manual"),
    ] {
        let turn = fixture.turn();

        install(&fixture.cli(), "a replacement build");
        fixture.discovery.refresh().expect("refresh");

        assert_eq!(fixture.revalidate(&turn), stale());
    }
}

#[test]
fn held_turn_is_rejected_when_a_refresh_discovers_a_changed_search_path() {
    let fixture = Fixture::detected("search-path");
    let turn = fixture.turn();
    let appended = fixture.root.join("appended");
    fs::create_dir_all(&appended).expect("appended directory");

    *fixture.search_path.0.lock().expect("search path") =
        joined(&[&fixture.root.join("bin"), &appended]);
    let refreshed = fixture.discovery.refresh().expect("refresh");

    assert_eq!(
        refreshed.provider(PROVIDER).map(|cli| cli.identity()),
        Some(&turn.cli_identity)
    );
    assert_ne!(refreshed.path(), turn.effective_path);
    assert_eq!(fixture.revalidate(&turn), stale());
}

#[test]
fn acquisitions_of_an_unchanged_executable_never_refresh_discovery() {
    let fixture = Fixture::detected("unchanged");
    let before = fixture.snapshot();

    let turn = fixture.turn();
    let usage = fixture
        .registry
        .acquire_account_usage_for_generation(PROVIDER, fixture.generation)
        .expect("usage lease");

    assert_eq!(fixture.revalidate(&turn), Ok(()));
    assert_eq!(fixture.registry.revalidate_health(&usage), Ok(()));
    assert!(Arc::ptr_eq(&before, &fixture.snapshot()));
}

#[cfg(unix)]
#[test]
fn turn_acquisition_rediscovers_once_after_the_cached_executable_is_deleted() {
    let fixture = Fixture::versioned("deleted-turn");
    let before = fixture.snapshot();
    let updated = fixture.self_update();
    fixture.remove_previous_version();

    let turn = fixture.turn();

    let healed = fixture.snapshot();
    assert_eq!(turn.cli_path, updated);
    assert_eq!(
        healed.authority_generation(),
        before.authority_generation() + 1
    );
    assert_eq!(fixture.revalidate(&turn), Ok(()));
    drop(turn);
    drop(fixture.turn());
    assert!(Arc::ptr_eq(&healed, &fixture.snapshot()));
}

#[cfg(unix)]
#[test]
fn account_usage_acquisition_rediscovers_after_the_cached_executable_is_deleted() {
    let fixture = Fixture::versioned("deleted-usage");
    fixture.snapshot();
    let updated = fixture.self_update();
    fixture.remove_previous_version();

    let usage = fixture
        .registry
        .acquire_account_usage_for_generation(PROVIDER, fixture.generation)
        .expect("usage lease");

    assert_eq!(usage.cli_path, updated);
    assert_eq!(fixture.registry.revalidate_health(&usage), Ok(()));
}

#[cfg(unix)]
#[test]
fn turn_acquisition_follows_a_retargeted_entry_while_the_previous_file_remains() {
    let fixture = Fixture::versioned("retargeted");
    let before = fixture.snapshot();
    let updated = fixture.self_update();

    let turn = fixture.turn();

    let healed = fixture.snapshot();
    assert_eq!(turn.cli_path, updated);
    assert_eq!(
        healed.authority_generation(),
        before.authority_generation() + 1
    );
    assert_eq!(fixture.revalidate(&turn), Ok(()));
    assert!(Arc::ptr_eq(&healed, &fixture.snapshot()));
}

#[cfg(unix)]
#[test]
fn turn_held_across_a_self_healing_rediscovery_is_rejected() {
    let fixture = Fixture::versioned("held-across");
    let held = fixture.turn();
    let updated = fixture.self_update();

    let current = fixture.turn();

    assert_eq!(current.cli_path, updated);
    assert_ne!(current.cli_identity, held.cli_identity);
    assert_eq!(fixture.revalidate(&held), stale());
    assert_eq!(fixture.revalidate(&current), Ok(()));
}

#[cfg(unix)]
#[test]
fn revalidating_a_held_turn_after_its_entry_was_retargeted_fails_closed() {
    let fixture = Fixture::versioned("held-retargeted");
    let held = fixture.turn();
    fixture.self_update();

    assert_eq!(fixture.revalidate(&held), stale());
}

#[cfg(unix)]
#[test]
fn an_unlaunchable_entry_ahead_of_the_detected_executable_never_forces_a_refresh() {
    let fixture = Fixture::detected("shadowed");
    let shadow = fixture.root.join("shadow");
    fs::create_dir_all(&shadow).expect("shadow directory");
    install(
        &shadow.join("claude"),
        "#!/usr/bin/env codevo-missing-interpreter\n",
    );
    *fixture.search_path.0.lock().expect("search path") =
        joined(&[&shadow, &fixture.root.join("bin")]);
    let before = fixture.snapshot();
    assert_eq!(
        before
            .provider(PROVIDER)
            .map(|cli| cli.path().to_path_buf()),
        fs::canonicalize(fixture.cli()).ok()
    );

    let turn = fixture.turn();

    assert_eq!(fixture.revalidate(&turn), Ok(()));
    assert!(Arc::ptr_eq(&before, &fixture.snapshot()));
}
