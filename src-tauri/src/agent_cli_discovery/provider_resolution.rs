use super::*;

impl AgentProviderExecutableResolver for AgentCliDiscovery {
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
        if refresh {
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
