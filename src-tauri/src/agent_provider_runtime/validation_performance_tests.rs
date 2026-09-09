use super::*;
use crate::agent_task_spawner::agent_provider::process::{
    executable_identity, take_executable_digest_work,
};
use std::time::Instant;

#[cfg(unix)]
fn cpu_micros() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    assert_eq!(
        unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) },
        0
    );
    let usage = unsafe { usage.assume_init() };
    (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) as u64 * 1_000_000
        + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as u64
}

#[cfg(unix)]
#[test]
fn health_validation_digest_work_is_bounded() {
    use std::os::unix::fs::PermissionsExt;
    let path = std::env::temp_dir().join(format!(
        "codevo-health-work-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    fs::write(&path, vec![42_u8; 65_536]).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    let paths = std::env::var_os("CODEVO_HEALTH_BENCH_PATHS")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![path.clone()]);
    assert!(paths.len() <= 4);
    for (index, executable_path) in paths.iter().enumerate() {
        let identity = executable_identity(executable_path.to_str().unwrap()).unwrap();
        let size = identity.size_bytes;
        let resolver = Arc::new(FakeResolver::new(identity, "/usr/bin:/bin"));
        let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(resolver));
        let receipt = registry
            .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
            .unwrap();
        let lease = registry
            .acquire_health_for_generation(
                AgentCliInvocation::CodexExec,
                receipt.provider_generation,
            )
            .unwrap();
        for round in 0..3 {
            take_executable_digest_work();
            let cpu = cpu_micros();
            let started = Instant::now();
            registry.revalidate_health(&lease).unwrap();
            let elapsed_micros = started.elapsed().as_micros();
            let cpu_micros = cpu_micros() - cpu;
            let (hashes, bytes) = take_executable_digest_work();
            assert_eq!(hashes, 0);
            assert_eq!(bytes, size * hashes);
            eprintln!("health_validation index={index} round={round} size={size} hashes={hashes} bytes={bytes} elapsed_us={elapsed_micros} cpu_us={cpu_micros}");
        }
    }
    fs::remove_file(path).unwrap();
}

#[cfg(unix)]
#[test]
fn final_health_validation_rejects_same_size_mutation_during_resolution() {
    struct MutatingResolver {
        resolver: FakeResolver,
        mutate: std::sync::atomic::AtomicBool,
    }
    impl AgentProviderExecutableResolver for MutatingResolver {
        fn resolve_provider(
            &self,
            provider: AgentCliInvocation,
            manual: Option<&str>,
            refresh: bool,
        ) -> Result<ResolvedProviderExecutable, String> {
            let resolved = self.resolver.resolve_provider(provider, manual, refresh)?;
            if self.mutate.swap(false, Ordering::SeqCst) {
                let metadata = fs::metadata(&resolved.cli_path).unwrap();
                fs::write(&resolved.cli_path, "#!/bin/sh\nexit 1\n").unwrap();
                fs::File::options()
                    .write(true)
                    .open(&resolved.cli_path)
                    .unwrap()
                    .set_times(fs::FileTimes::new().set_modified(metadata.modified().unwrap()))
                    .unwrap();
            }
            Ok(resolved)
        }
    }
    let identity = executable_identity_fixture();
    let path = identity.canonical_path.clone();
    let resolver = Arc::new(MutatingResolver {
        resolver: FakeResolver::new(identity, "/usr/bin:/bin"),
        mutate: std::sync::atomic::AtomicBool::new(false),
    });
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(
        resolver.clone(),
    ));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .unwrap();
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .unwrap();
    resolver.mutate.store(true, Ordering::SeqCst);
    assert_eq!(
        registry.revalidate_health(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn observed_health_version_revalidates_after_reading_cached_version() {
    struct VersionMutator(FakeResolver);
    impl AgentProviderExecutableResolver for VersionMutator {
        fn resolve_provider(
            &self,
            provider: AgentCliInvocation,
            manual: Option<&str>,
            refresh: bool,
        ) -> Result<ResolvedProviderExecutable, String> {
            self.0.resolve_provider(provider, manual, refresh)
        }
        fn observed_version(
            &self,
            _provider: AgentCliInvocation,
            expected: &ExecutableIdentity,
            _generation: u64,
        ) -> Option<String> {
            fs::write(&expected.canonical_path, "changed while reading version").unwrap();
            Some("2.1.0".to_string())
        }
    }
    let identity = executable_identity_fixture();
    let path = identity.canonical_path.clone();
    let registry = Arc::new(AgentProviderRuntimeRegistry::with_discovery(Arc::new(
        VersionMutator(FakeResolver::new(identity, "/usr/bin:/bin")),
    )));
    let receipt = registry
        .register_policy(AgentCliInvocation::CodexExec, 1, None, auto_policy())
        .unwrap();
    let lease = registry
        .acquire_health_for_generation(AgentCliInvocation::CodexExec, receipt.provider_generation)
        .unwrap();
    assert_eq!(
        registry.observed_health_version(&lease),
        Err(AGENT_PROVIDER_STALE_ERROR.to_string())
    );
    fs::remove_file(path).unwrap();
}
