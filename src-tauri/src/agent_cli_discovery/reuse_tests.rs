use super::*;

struct MutableContext(Mutex<Option<String>>);

impl AgentCliDiscoveryContext for MutableContext {
    fn home_directory(&self) -> Option<PathBuf> {
        None
    }

    fn login_shell(&self) -> Option<PathBuf> {
        None
    }

    fn current_path(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }
}

#[test]
fn refresh_reuses_unchanged_binary_but_rebuilds_path_and_authority() {
    let fixture = TestDirectory::new("reuse-path");
    let first = fixture.path.join("first");
    let second = fixture.path.join("second");
    executable(&first.join("claude"), "original");
    executable(&second.join("claude"), "other");
    let context = Arc::new(MutableContext(Mutex::new(Some(joined_path(&[&first])))));
    let versions = Arc::new(TestVersions::default());
    let service =
        AgentCliDiscovery::with_collaborators(context.clone(), versions.clone(), Duration::ZERO);
    let initial = service.effective_environment().unwrap();
    #[cfg(unix)]
    crate::agent_task_spawner::agent_provider::process::take_executable_digest_work();
    service.invalidate().unwrap();
    service.invalidate().unwrap();
    let reused = service.effective_environment().unwrap();
    #[cfg(unix)]
    assert_eq!(
        crate::agent_task_spawner::agent_provider::process::take_executable_digest_work(),
        (0, 0)
    );
    assert_eq!(versions.probes.load(Ordering::Relaxed), 1);
    assert_eq!(reused.authority_generation(), 2);
    assert!(!Arc::ptr_eq(&initial, &reused));
    *context.0.lock().unwrap() = Some(joined_path(&[&second, &first]));
    let changed = service.refresh().unwrap();
    assert_eq!(
        changed
            .provider(AgentCliInvocation::ClaudeCode)
            .unwrap()
            .path(),
        fs::canonicalize(second.join("claude")).unwrap()
    );
    assert_eq!(versions.probes.load(Ordering::Relaxed), 2);
    *context.0.lock().unwrap() = Some(joined_path(&[&first]));
    service.refresh().unwrap();
    assert_eq!(versions.probes.load(Ordering::Relaxed), 3);
}

#[cfg(unix)]
#[test]
fn refresh_recaptures_changed_content_with_restored_mtime_and_alias_retarget() {
    use std::os::unix::fs::symlink;
    let fixture = TestDirectory::new("reuse-mutation");
    let bin = fixture.path.join("bin");
    let original = fixture.path.join("original");
    let replacement = fixture.path.join("replacement");
    executable(&original, "original");
    executable(&replacement, "replaced");
    fs::create_dir_all(&bin).unwrap();
    symlink(&original, bin.join("claude")).unwrap();
    let versions = Arc::new(TestVersions::default());
    let service = AgentCliDiscovery::with_collaborators(
        Arc::new(MutableContext(Mutex::new(Some(joined_path(&[&bin]))))),
        versions.clone(),
        Duration::ZERO,
    );
    service.effective_environment().unwrap();
    let modified = fs::metadata(&original).unwrap().modified().unwrap();
    thread::sleep(Duration::from_millis(2));
    fs::write(&original, "modified").unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&original)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    service.refresh().unwrap();
    assert_eq!(versions.probes.load(Ordering::Relaxed), 2);
    fs::remove_file(bin.join("claude")).unwrap();
    symlink(&replacement, bin.join("claude")).unwrap();
    let retargeted = service.refresh().unwrap();
    assert_eq!(
        retargeted
            .provider(AgentCliInvocation::ClaudeCode)
            .unwrap()
            .path(),
        fs::canonicalize(replacement).unwrap()
    );
    assert_eq!(versions.probes.load(Ordering::Relaxed), 3);
}

#[test]
fn failed_refresh_does_not_publish_previous_snapshot() {
    let fixture = TestDirectory::new("reuse-failure");
    executable(&fixture.path.join("claude"), "original");
    let context = Arc::new(MutableContext(Mutex::new(Some(joined_path(&[
        &fixture.path
    ])))));
    let versions = Arc::new(TestVersions::default());
    let service =
        AgentCliDiscovery::with_collaborators(context.clone(), versions.clone(), Duration::ZERO);
    service.effective_environment().unwrap();
    *context.0.lock().unwrap() = None;
    assert!(matches!(
        service.refresh(),
        Err(AgentCliDiscoveryError::EffectivePathUnavailable)
    ));
    *context.0.lock().unwrap() = Some(joined_path(&[&fixture.path]));
    let recovered = service.effective_environment().unwrap();
    assert_eq!(recovered.authority_generation(), 1);
    assert_eq!(versions.probes.load(Ordering::Relaxed), 1);
}

#[cfg(unix)]
#[test]
fn scripts_are_recaptured_when_interpreter_selection_changes() {
    let fixture = TestDirectory::new("reuse-script");
    let first = fixture.path.join("first");
    let second = fixture.path.join("second");
    fs::create_dir_all(&first).unwrap();
    executable(&second.join("node"), "native interpreter");
    executable(&first.join("claude"), "#!/usr/bin/env node\nmain()");
    let versions = Arc::new(TestVersions::default());
    let service = AgentCliDiscovery::with_collaborators(
        Arc::new(MutableContext(Mutex::new(Some(joined_path(&[
            &first, &second,
        ]))))),
        versions.clone(),
        Duration::ZERO,
    );
    let before = service.effective_environment().unwrap();
    service.refresh().unwrap();
    assert_eq!(versions.probes.load(Ordering::Relaxed), 2);
    executable(&first.join("node"), "new interpreter");
    let after = service.refresh().unwrap();
    assert_eq!(versions.probes.load(Ordering::Relaxed), 3);
    assert_ne!(
        before
            .provider(AgentCliInvocation::ClaudeCode)
            .unwrap()
            .identity(),
        after
            .provider(AgentCliInvocation::ClaudeCode)
            .unwrap()
            .identity()
    );
}

#[test]
fn observed_version_requires_current_native_identity_and_generation() {
    let fixture = TestDirectory::new("observed-version");
    let bin = fixture.path.join("bin");
    let cli = bin.join("claude");
    executable(&cli, "original");
    let versions = Arc::new(TestVersions::with_version(
        fs::canonicalize(&cli).unwrap(),
        "2.1.0",
    ));
    let service = AgentCliDiscovery::with_collaborators(
        Arc::new(MutableContext(Mutex::new(Some(joined_path(&[&bin]))))),
        versions.clone(),
        Duration::ZERO,
    );
    let environment = service.effective_environment().unwrap();
    let identity = environment
        .provider(AgentCliInvocation::ClaudeCode)
        .unwrap()
        .identity();
    assert_eq!(
        service.observed_version(
            AgentCliInvocation::ClaudeCode,
            identity,
            environment.authority_generation()
        ),
        Some("2.1.0".into())
    );
    assert_eq!(
        service.observed_version(
            AgentCliInvocation::CodexExec,
            identity,
            environment.authority_generation()
        ),
        None
    );
    assert_eq!(versions.probes.load(Ordering::Relaxed), 1);
    service.refresh().unwrap();
    assert_eq!(
        service.observed_version(
            AgentCliInvocation::ClaudeCode,
            identity,
            environment.authority_generation()
        ),
        None
    );
    let generation = service
        .effective_environment()
        .unwrap()
        .authority_generation();
    fs::write(&cli, "changed-binary").unwrap();
    assert_eq!(
        service.observed_version(AgentCliInvocation::ClaudeCode, identity, generation),
        None
    );
}

#[cfg(unix)]
#[test]
fn observed_version_does_not_reuse_script_launcher_version() {
    let fixture = TestDirectory::new("observed-script-version");
    let bin = fixture.path.join("bin");
    let cli = bin.join("claude");
    executable(&cli, "#!/bin/sh\nexit 0\n");
    let service = AgentCliDiscovery::with_collaborators(
        Arc::new(MutableContext(Mutex::new(Some(joined_path(&[&bin]))))),
        Arc::new(TestVersions::with_version(
            fs::canonicalize(&cli).unwrap(),
            "2.1.0",
        )),
        Duration::ZERO,
    );
    let environment = service.effective_environment().unwrap();
    let identity = environment
        .provider(AgentCliInvocation::ClaudeCode)
        .unwrap()
        .identity();
    assert_eq!(
        service.observed_version(
            AgentCliInvocation::ClaudeCode,
            identity,
            environment.authority_generation()
        ),
        None
    );
}
