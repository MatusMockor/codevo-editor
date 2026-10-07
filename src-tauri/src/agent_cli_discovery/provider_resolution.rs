use super::*;

impl AgentProviderExecutableResolver for AgentCliDiscovery {
    fn entry_point(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        effective_path: &str,
    ) -> Option<ProviderEntryPoint> {
        provider_entry_point(provider, manual_override, effective_path)
    }

    fn observed_version(
        &self,
        provider: AgentCliInvocation,
        expected: &ExecutableIdentity,
        discovery_generation: u64,
    ) -> Option<String> {
        let environment = self.effective_environment().ok()?;
        if environment.authority_generation() != discovery_generation {
            return None;
        }
        let executable = environment.provider(provider)?;
        if executable.identity != *expected || !expected.is_reusable_for_discovery() {
            return None;
        }
        executable.version.clone()
    }

    fn resolve_provider(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        if refresh || self.detection_is_stale(provider, manual_override) {
            self.refresh().map_err(|error| error.to_string())?;
        }
        let resolution = AgentCliDiscovery::resolve_provider(self, provider, manual_override)
            .map_err(|error| error.to_string())?;
        let environment = resolution.environment();
        let executable = resolution
            .executable()
            .ok_or_else(|| agent_cli_binary_unavailable_error(provider))?;
        Ok(ResolvedProviderExecutable {
            cli_path: executable.path().to_string_lossy().into_owned(),
            cli_identity: executable.identity().clone(),
            effective_path: environment.path().to_string(),
            path_fingerprint: environment.path_fingerprint().to_string(),
            discovery_generation: environment.authority_generation(),
        })
    }

    fn observe_provider(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        expected: &ExecutableIdentity,
    ) -> Result<ResolvedProviderExecutable, String> {
        let Some(manual_path) = manual_override else {
            return AgentProviderExecutableResolver::resolve_provider(self, provider, None, false);
        };
        let environment = self
            .effective_environment()
            .map_err(|error| error.to_string())?;
        let path = bounded_manual_path(manual_path)
            .filter(|path| *path == expected.canonical_path)
            .ok_or_else(|| agent_cli_binary_unavailable_error(provider))?;
        if !expected.is_current_for_observation() {
            return Err(agent_cli_binary_unavailable_error(provider));
        }
        Ok(ResolvedProviderExecutable {
            cli_path: path.to_string_lossy().into_owned(),
            cli_identity: expected.clone(),
            effective_path: environment.path().to_string(),
            path_fingerprint: environment.path_fingerprint().to_string(),
            discovery_generation: environment.authority_generation(),
        })
    }
}

impl AgentCliDiscovery {
    fn detection_is_stale(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
    ) -> bool {
        if manual_override.is_some() {
            return false;
        }
        let Ok(environment) = self.effective_environment() else {
            return false;
        };
        let Some(executable) = environment.provider(provider) else {
            return false;
        };
        !executable.identity().is_current_for_observation()
            || !search_path_resolves_to(provider, environment.path(), executable.path())
    }
}

fn search_path_resolves_to(
    provider: AgentCliInvocation,
    effective_path: &str,
    canonical: &Path,
) -> bool {
    let executable_name = provider_executable_name(provider);
    split_path(effective_path).into_iter().any(|directory| {
        bounded_executable_path(&directory.join(executable_name)).as_deref() == Some(canonical)
    })
}
