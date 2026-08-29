use super::*;
use std::{
    collections::HashMap,
    fs::File,
    io::Write,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

static TEMP_SEQUENCE: AtomicUsize = AtomicUsize::new(1);

struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    fn new(name: &str) -> Self {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!(
            "codevo-agent-cli-discovery-{}-{name}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create fixture directory");
        Self { path }
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct TestContext {
    home: PathBuf,
    shell: Option<PathBuf>,
    current_path: Option<String>,
}

impl AgentCliDiscoveryContext for TestContext {
    fn home_directory(&self) -> Option<PathBuf> {
        Some(self.home.clone())
    }

    fn login_shell(&self) -> Option<PathBuf> {
        self.shell.clone()
    }

    fn current_path(&self) -> Option<String> {
        self.current_path.clone()
    }
}

#[derive(Default)]
struct TestVersions {
    versions: Mutex<HashMap<PathBuf, String>>,
    probes: AtomicUsize,
}

impl TestVersions {
    fn with_version(path: PathBuf, version: &str) -> Self {
        Self {
            versions: Mutex::new(HashMap::from([(path, version.to_string())])),
            probes: AtomicUsize::new(0),
        }
    }
}

impl AgentCliVersionSource for TestVersions {
    fn version(
        &self,
        _provider: AgentCliInvocation,
        path: &Path,
        _effective_path: &str,
    ) -> Option<String> {
        self.probes.fetch_add(1, Ordering::Relaxed);
        self.versions.lock().ok()?.get(path).cloned()
    }
}

struct PanicOnceVersions {
    panics: AtomicBool,
}

impl AgentCliVersionSource for PanicOnceVersions {
    fn version(
        &self,
        _provider: AgentCliInvocation,
        _path: &Path,
        _effective_path: &str,
    ) -> Option<String> {
        if self.panics.swap(false, Ordering::AcqRel) {
            panic!("injected version panic");
        }
        Some("1.2.3".to_string())
    }
}

fn executable(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("executable parent")).expect("create parent");
    let mut file = File::create(path).expect("create executable");
    file.write_all(contents.as_bytes())
        .expect("write executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("set executable");
    }
}

fn shell(path: &Path, behavior: &str) {
    executable(path, &format!("#!/bin/sh\n{behavior}\n"));
}

fn joined_path(paths: &[&Path]) -> String {
    env::join_paths(paths)
        .expect("join fixture path")
        .to_string_lossy()
        .into_owned()
}

fn discovery(
    home: &Path,
    shell: Option<PathBuf>,
    current_path: Option<String>,
    versions: Arc<dyn AgentCliVersionSource>,
    timeout: Duration,
) -> AgentCliDiscovery {
    AgentCliDiscovery::with_collaborators(
        Arc::new(TestContext {
            home: home.to_path_buf(),
            shell,
            current_path,
        }),
        versions,
        timeout,
    )
}

#[test]
fn login_shell_path_precedes_current_path_and_well_known_directories() {
    let fixture = TestDirectory::new("shell-success");
    let shell_path = fixture.path.join("zsh");
    let login_bin = fixture.path.join("login-bin");
    let current_bin = fixture.path.join("current-bin");
    let known_bin = fixture.path.join(".local/bin");
    let login_cli = login_bin.join("claude");
    executable(&login_cli, "provider");
    executable(&current_bin.join("claude"), "provider");
    executable(&known_bin.join("claude"), "provider");
    shell(
        &shell_path,
        &format!("printf %s '{}'", joined_path(&[&login_bin])),
    );
    let canonical = fs::canonicalize(&login_cli).expect("canonical login CLI");
    let versions = Arc::new(TestVersions::with_version(canonical.clone(), "2.3.4"));
    let service = discovery(
        &fixture.path,
        Some(shell_path),
        Some(joined_path(&[&current_bin])),
        versions,
        Duration::from_secs(1),
    );

    let snapshot = service.effective_environment().expect("discovery snapshot");

    let detected = snapshot
        .provider(AgentCliInvocation::ClaudeCode)
        .expect("detected Claude");
    assert_eq!(detected.path(), canonical);
    assert_eq!(detected.version(), Some("2.3.4"));
    assert_eq!(split_path(snapshot.path())[0], login_bin);
}

#[test]
fn cached_snapshot_does_not_run_login_shell_again_until_refresh() {
    let fixture = TestDirectory::new("shell-cache");
    let shell_path = fixture.path.join("zsh");
    let bin = fixture.path.join("bin");
    let count = fixture.path.join("count");
    fs::create_dir_all(&bin).expect("bin directory");
    shell(
        &shell_path,
        &format!(
            "printf x >> '{}'; printf %s '{}'",
            count.to_string_lossy(),
            joined_path(&[&bin])
        ),
    );
    let service = discovery(
        &fixture.path,
        Some(shell_path),
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    service.effective_environment().expect("first snapshot");
    service.effective_environment().expect("cached snapshot");
    assert_eq!(fs::read_to_string(&count).expect("shell count"), "x");

    service.refresh().expect("refreshed snapshot");
    assert_eq!(fs::read_to_string(&count).expect("refresh count"), "xx");
}

#[test]
fn refresh_generation_rejects_an_older_in_flight_shell_result() {
    let fixture = TestDirectory::new("refresh-generation");
    let shell_path = fixture.path.join("bash");
    let old_bin = fixture.path.join("old-bin");
    let new_bin = fixture.path.join("new-bin");
    let count = fixture.path.join("count");
    let started = fixture.path.join("started");
    let release = fixture.path.join("release");
    fs::create_dir_all(&old_bin).expect("old bin");
    fs::create_dir_all(&new_bin).expect("new bin");
    shell(
        &shell_path,
        &format!(
            "n=0; test -f '{}' && n=$(cat '{}'); n=$((n+1)); printf %s $n > '{}'; if test $n -eq 1; then : > '{}'; while ! test -f '{}'; do sleep 0.01; done; printf %s '{}'; exit 0; fi; printf %s '{}'",
            count.to_string_lossy(),
            count.to_string_lossy(),
            count.to_string_lossy(),
            started.to_string_lossy(),
            release.to_string_lossy(),
            joined_path(&[&old_bin]),
            joined_path(&[&new_bin])
        ),
    );
    let service = Arc::new(discovery(
        &fixture.path,
        Some(shell_path),
        Some(joined_path(&[&old_bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(2),
    ));
    let first_service = service.clone();
    let first = thread::spawn(move || first_service.effective_environment());
    wait_for_file(&started);
    let refresh_service = service.clone();
    let refreshed = thread::spawn(move || refresh_service.refresh());
    wait_for_generation(&service, 1);
    File::create(&release).expect("release first shell");

    let first = first.join().expect("join first").expect("first result");
    let refreshed = refreshed
        .join()
        .expect("join refresh")
        .expect("refresh result");

    assert_eq!(split_path(first.path())[0], new_bin);
    assert_eq!(split_path(refreshed.path())[0], new_bin);
    assert_eq!(fs::read_to_string(count).expect("shell count"), "2");
}

fn wait_for_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !path.exists() {
        assert!(Instant::now() < deadline, "fixture file was not created");
        thread::yield_now();
    }
}

fn wait_for_generation(service: &AgentCliDiscovery, generation: u64) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let current = service.cache.lock().expect("cache lock").generation;
        if current == generation {
            return;
        }
        assert!(Instant::now() < deadline, "generation did not advance");
        thread::yield_now();
    }
}

#[test]
fn login_shell_output_cap_is_shared_across_stdout_and_stderr() {
    let fixture = TestDirectory::new("shell-combined-cap");
    let shell_path = fixture.path.join("sh");
    shell(&shell_path, "printf '%040000d' 0; printf '%040000d' 0 >&2");

    assert!(run_login_shell_path(&shell_path, Duration::from_secs(1)).is_err());
}

#[test]
fn failed_unknown_and_timed_out_shells_fall_back_to_current_path() {
    let fixture = TestDirectory::new("shell-fallbacks");
    let current_bin = fixture.path.join("current-bin");
    executable(&current_bin.join("codex"), "provider");
    let current_path = joined_path(&[&current_bin]);
    let cases = [
        ("unknown", "exit 0", Duration::from_secs(1)),
        ("bash", "exit 9", Duration::from_secs(1)),
        ("fish", "sleep 2", Duration::from_millis(30)),
    ];
    for (name, behavior, timeout) in cases {
        let shell_path = fixture.path.join(name);
        shell(&shell_path, behavior);
        let service = discovery(
            &fixture.path,
            Some(shell_path),
            Some(current_path.clone()),
            Arc::new(TestVersions::default()),
            timeout,
        );
        let snapshot = service.effective_environment().expect("fallback snapshot");
        assert_eq!(split_path(snapshot.path())[0], current_bin);
        assert!(snapshot.provider(AgentCliInvocation::CodexExec).is_some());
    }
}

#[test]
fn well_known_nvm_fnm_and_static_directories_are_bounded_and_discovered() {
    let fixture = TestDirectory::new("well-known");
    let empty = fixture.path.join("empty");
    fs::create_dir_all(&empty).expect("empty path");
    let nvm_bin = fixture.path.join(".nvm/versions/node/v24/bin");
    let fnm_bin = fixture.path.join(".fnm/node-versions/v23/bin");
    executable(&nvm_bin.join("claude"), "provider");
    executable(&fnm_bin.join("codex"), "provider");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&empty])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let snapshot = service
        .effective_environment()
        .expect("well-known snapshot");

    assert_eq!(
        snapshot
            .provider(AgentCliInvocation::ClaudeCode)
            .expect("nvm Claude")
            .path(),
        fs::canonicalize(nvm_bin.join("claude")).expect("canonical nvm CLI")
    );
    assert_eq!(
        snapshot
            .provider(AgentCliInvocation::CodexExec)
            .expect("fnm Codex")
            .path(),
        fs::canonicalize(fnm_bin.join("codex")).expect("canonical fnm CLI")
    );
    assert!(split_path(snapshot.path()).len() <= MAX_EFFECTIVE_PATH_ENTRIES);
}

#[test]
fn nvm_inventory_cannot_starve_fnm_provider_discovery() {
    let fixture = TestDirectory::new("manager-fairness");
    let empty = fixture.path.join("empty");
    fs::create_dir_all(&empty).expect("empty path");
    for index in 0..12 {
        fs::create_dir_all(
            fixture
                .path
                .join(format!(".nvm/versions/node/v{index}/bin")),
        )
        .expect("nvm bin");
    }
    let fnm_bin = fixture.path.join(".fnm/node-versions/v23/bin");
    executable(&fnm_bin.join("codex"), "provider");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&empty])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let snapshot = service.effective_environment().expect("fair snapshot");

    assert_eq!(
        snapshot
            .provider(AgentCliInvocation::CodexExec)
            .expect("fnm Codex")
            .path(),
        fs::canonicalize(fnm_bin.join("codex")).expect("canonical fnm Codex")
    );
}

#[test]
fn later_manager_versions_remain_eligible_when_global_capacity_is_available() {
    let fixture = TestDirectory::new("manager-late-version");
    let empty = fixture.path.join("empty");
    fs::create_dir_all(&empty).expect("empty path");
    for index in 0..5 {
        let nvm_bin = fixture
            .path
            .join(format!(".nvm/versions/node/v{index}/bin"));
        let fnm_bin = fixture.path.join(format!(".fnm/version-{index}/bin"));
        fs::create_dir_all(&nvm_bin).expect("nvm bin");
        fs::create_dir_all(&fnm_bin).expect("fnm bin");
        if index == 4 {
            executable(&nvm_bin.join("claude"), "provider");
            executable(&fnm_bin.join("codex"), "provider");
        }
    }
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&empty])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let snapshot = service.effective_environment().expect("late snapshot");

    assert!(snapshot.provider(AgentCliInvocation::ClaudeCode).is_some());
    assert!(snapshot.provider(AgentCliInvocation::CodexExec).is_some());
}

#[test]
fn over_cap_dynamic_directory_fails_closed_instead_of_selecting_a_subset() {
    let fixture = TestDirectory::new("directory-cap");
    let fnm = fixture.path.join(".fnm");
    for index in 0..=MAX_DISCOVERY_DIRECTORY_ENTRIES {
        fs::create_dir_all(fnm.join(format!("entry-{index:03}/bin"))).expect("fnm inventory entry");
    }

    assert!(fnm_bin_directories(&fixture.path).is_empty());
}

#[test]
fn nested_over_cap_sibling_invalidates_the_complete_fnm_scan() {
    let fixture = TestDirectory::new("nested-directory-cap");
    let early_bin = fixture.path.join(".fnm/a/bin");
    let overflow = fixture.path.join(".fnm/z-overflow");
    fs::create_dir_all(&early_bin).expect("early bin");
    for index in 0..=MAX_DISCOVERY_DIRECTORY_ENTRIES {
        fs::create_dir_all(overflow.join(format!("entry-{index:03}"))).expect("overflow entry");
    }

    assert!(fnm_bin_directories(&fixture.path).is_empty());
}

#[test]
fn global_visit_exhaustion_invalidates_partial_fnm_matches() {
    let fixture = TestDirectory::new("global-visit-cap");
    for index in 0..MAX_DISCOVERY_DIRECTORY_VISITS {
        fs::create_dir_all(fixture.path.join(format!(".fnm/entry-{index:03}/bin")))
            .expect("breadth entry");
    }

    assert!(fnm_bin_directories(&fixture.path).is_empty());
}

#[test]
fn first_executable_regular_file_wins_and_directories_are_rejected() {
    let fixture = TestDirectory::new("first-hit");
    let first = fixture.path.join("first");
    let second = fixture.path.join("second");
    fs::create_dir_all(first.join("claude")).expect("directory named Claude");
    executable(&second.join("claude"), "provider");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&first, &second, &first])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let snapshot = service.effective_environment().expect("first hit snapshot");

    assert_eq!(&split_path(snapshot.path())[..2], &[first, second.clone()]);
    assert_eq!(
        snapshot
            .provider(AgentCliInvocation::ClaudeCode)
            .expect("second executable")
            .path(),
        fs::canonicalize(second.join("claude")).expect("canonical executable")
    );
}

#[test]
fn duplicate_base_entries_do_not_displace_a_later_unique_directory() {
    let fixture = TestDirectory::new("base-dedupe");
    let duplicate = fixture.path.join("duplicate");
    let valid = fixture.path.join("valid");
    fs::create_dir_all(&duplicate).expect("duplicate directory");
    executable(&valid.join("claude"), "provider");
    let mut entries = vec![duplicate.as_path(); MAX_BASE_PATH_ENTRIES + 8];
    entries.push(&valid);
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&entries)),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let snapshot = service.effective_environment().expect("deduped snapshot");

    assert_eq!(&split_path(snapshot.path())[..2], &[duplicate, valid]);
    assert!(snapshot.provider(AgentCliInvocation::ClaudeCode).is_some());
}

#[test]
fn fnm_glob_accepts_depth_three_and_rejects_depth_four() {
    let fixture = TestDirectory::new("fnm-depth");
    let depth_three = fixture.path.join(".fnm/a/b/bin");
    let depth_four = fixture.path.join(".fnm/a/b/c/bin");
    fs::create_dir_all(&depth_three).expect("depth three");
    fs::create_dir_all(&depth_four).expect("depth four");

    let matches = fnm_bin_directories(&fixture.path);

    assert!(matches.contains(&depth_three));
    assert!(!matches.contains(&depth_four));
}

#[cfg(unix)]
#[test]
fn symlink_depth_limit_rejects_deep_chains_and_canonicalizes_accepted_chains() {
    use std::os::unix::fs::symlink;

    let fixture = TestDirectory::new("symlink-depth");
    let shallow = fixture.path.join("shallow");
    let deep = fixture.path.join("deep");
    let target = fixture.path.join("target/claude");
    executable(&target, "provider");
    fs::create_dir_all(&shallow).expect("shallow directory");
    symlink(&target, shallow.join("claude")).expect("shallow symlink");
    fs::create_dir_all(&deep).expect("deep directory");
    let mut previous = target.clone();
    for index in 0..=MAX_EXECUTABLE_SYMLINK_DEPTH {
        let link = fixture.path.join(format!("link-{index}"));
        symlink(&previous, &link).expect("chain symlink");
        previous = link;
    }
    symlink(&previous, deep.join("claude")).expect("deep entry symlink");

    let accepted = bounded_executable_path(&shallow.join("claude")).expect("shallow accepted");
    assert_eq!(
        accepted,
        fs::canonicalize(&target).expect("canonical target")
    );
    assert!(bounded_executable_path(&deep.join("claude")).is_none());
}

#[test]
fn cache_uses_effective_path_fingerprint_and_refresh_invalidates_it() {
    let fixture = TestDirectory::new("cache");
    let bin = fixture.path.join("bin");
    executable(&bin.join("claude"), "provider");
    let versions = Arc::new(TestVersions::default());
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        versions.clone(),
        Duration::from_secs(1),
    );

    let first = service.effective_environment().expect("first snapshot");
    let cached = service.effective_environment().expect("cached snapshot");
    assert!(Arc::ptr_eq(&first, &cached));
    assert_eq!(versions.probes.load(Ordering::Relaxed), 1);

    let refreshed = service.refresh().expect("refreshed snapshot");
    assert!(!Arc::ptr_eq(&first, &refreshed));
    assert_eq!(first.path_fingerprint(), refreshed.path_fingerprint());
    assert_eq!(versions.probes.load(Ordering::Relaxed), 2);
}

#[test]
fn repeated_identical_refreshes_mint_distinct_authority_generations() {
    let fixture = TestDirectory::new("refresh-aba-generation");
    let bin = fixture.path.join("bin");
    fs::create_dir_all(&bin).expect("bin directory");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let first = service.effective_environment().expect("first snapshot");
    let second = service.refresh().expect("second snapshot");
    let third = service.refresh().expect("third snapshot");

    assert_eq!(first.path_fingerprint(), second.path_fingerprint());
    assert_eq!(second.path_fingerprint(), third.path_fingerprint());
    assert_eq!(first.authority_generation(), 0);
    assert_eq!(second.authority_generation(), 1);
    assert_eq!(third.authority_generation(), 2);
}

#[test]
fn panic_during_build_releases_exact_single_flight_waiter_authority() {
    let fixture = TestDirectory::new("panic-cleanup");
    let bin = fixture.path.join("bin");
    executable(&bin.join("claude"), "provider");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(PanicOnceVersions {
            panics: AtomicBool::new(true),
        }),
        Duration::from_secs(1),
    );

    let first = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = service.effective_environment();
    }));
    assert!(first.is_err());

    let recovered = service
        .effective_environment()
        .expect("recovered discovery");
    assert_eq!(
        recovered
            .provider(AgentCliInvocation::ClaudeCode)
            .expect("recovered Claude")
            .version(),
        Some("1.2.3")
    );
}

#[test]
fn manual_override_resolves_outside_effective_path_with_retained_identity() {
    let fixture = TestDirectory::new("manual");
    let bin = fixture.path.join("bin");
    let manual = fixture.path.join("manual/claude");
    fs::create_dir_all(&bin).expect("base path");
    executable(&manual, "first");
    let canonical = fs::canonicalize(&manual).expect("canonical manual CLI");
    let versions = Arc::new(TestVersions::with_version(canonical.clone(), "4.5.6"));
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        versions,
        Duration::from_secs(1),
    );

    let resolved = service
        .resolve_provider(
            AgentCliInvocation::ClaudeCode,
            Some(manual.to_string_lossy().as_ref()),
        )
        .expect("manual resolution");

    let AgentCliResolution::Manual(resolved) = resolved else {
        panic!("expected manual resolution");
    };
    assert_eq!(resolved.executable().path(), canonical);
    assert_eq!(resolved.executable().version(), Some("4.5.6"));
    assert!(resolved.executable().identity().retained_is_current());
}

#[test]
fn provider_runtime_port_projects_exact_identity_path_and_fingerprint() {
    let fixture = TestDirectory::new("runtime-port");
    let bin = fixture.path.join("bin");
    let codex = bin.join("codex");
    executable(&codex, "provider");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let resolved = AgentProviderExecutableResolver::resolve_provider(
        &service,
        AgentCliInvocation::CodexExec,
        None,
        false,
    )
    .expect("runtime resolution");

    assert_eq!(
        resolved.cli_path,
        fs::canonicalize(codex)
            .expect("canonical Codex")
            .to_string_lossy()
    );
    assert_eq!(
        resolved.effective_path,
        service.effective_environment().expect("snapshot").path()
    );
    assert_eq!(resolved.path_fingerprint.len(), 64);
    assert!(resolved.cli_identity.is_current_for_spawn());
}

#[test]
fn provider_runtime_port_returns_stable_not_found_error() {
    let fixture = TestDirectory::new("runtime-not-found");
    let bin = fixture.path.join("bin");
    fs::create_dir_all(&bin).expect("bin directory");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );

    let error = AgentProviderExecutableResolver::resolve_provider(
        &service,
        AgentCliInvocation::ClaudeCode,
        None,
        false,
    )
    .expect_err("not found");

    assert_eq!(
        error,
        agent_cli_binary_unavailable_error(AgentCliInvocation::ClaudeCode)
    );
}

#[test]
fn manual_override_rejects_relative_missing_and_directory_paths() {
    let fixture = TestDirectory::new("manual-invalid");
    let bin = fixture.path.join("bin");
    fs::create_dir_all(&bin).expect("base path");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );
    let invalid = [
        "relative/claude".to_string(),
        fixture.path.join("missing").to_string_lossy().into_owned(),
        fixture.path.to_string_lossy().into_owned(),
    ];

    for path in invalid {
        let resolution = service
            .resolve_provider(AgentCliInvocation::ClaudeCode, Some(&path))
            .expect("closed invalid resolution");
        assert!(matches!(resolution, AgentCliResolution::NotFound { .. }));
    }
}

#[test]
fn retained_manual_authority_rejects_a_b_a_content_replacement() {
    let fixture = TestDirectory::new("manual-aba");
    let bin = fixture.path.join("bin");
    let manual = fixture.path.join("manual/codex");
    fs::create_dir_all(&bin).expect("base path");
    executable(&manual, "content-a");
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        Arc::new(TestVersions::default()),
        Duration::from_secs(1),
    );
    let resolved = service
        .resolve_provider(
            AgentCliInvocation::CodexExec,
            Some(manual.to_string_lossy().as_ref()),
        )
        .expect("manual resolution");
    let AgentCliResolution::Manual(resolved) = resolved else {
        panic!("expected manual resolution");
    };

    let replacement_b = fixture.path.join("manual/replacement-b");
    let replacement_a = fixture.path.join("manual/replacement-a");
    executable(&replacement_b, "content-b");
    fs::rename(&replacement_b, &manual).expect("install replacement B");
    executable(&replacement_a, "content-a");
    fs::rename(&replacement_a, &manual).expect("install replacement A");

    assert!(!resolved.executable().identity().is_current_for_spawn());
}

#[test]
fn presentation_is_closed_and_uses_camel_case_provider_keys() {
    let fixture = TestDirectory::new("presentation");
    let bin = fixture.path.join("bin");
    executable(&bin.join("codex"), "provider");
    let canonical = fs::canonicalize(bin.join("codex")).expect("canonical Codex");
    let versions = Arc::new(TestVersions::with_version(canonical.clone(), "1.2.3"));
    let service = discovery(
        &fixture.path,
        None,
        Some(joined_path(&[&bin])),
        versions,
        Duration::from_secs(1),
    );

    let value = serde_json::to_value(
        service
            .effective_environment()
            .expect("snapshot")
            .presentation(),
    )
    .expect("serialize presentation");

    assert_eq!(value["claudeCode"]["kind"], "notFound");
    assert_eq!(value["codex"]["kind"], "detected");
    assert_eq!(value["codex"]["path"], canonical.to_string_lossy().as_ref());
    assert_eq!(value["codex"]["version"], "1.2.3");
}
