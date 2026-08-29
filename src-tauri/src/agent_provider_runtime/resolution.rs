use crate::agent_task_spawner::{agent_provider::process::ExecutableIdentity, AgentCliInvocation};

#[derive(Clone, Debug)]
pub struct ResolvedProviderExecutable {
    pub cli_path: String,
    pub cli_identity: ExecutableIdentity,
    pub effective_path: String,
    pub path_fingerprint: String,
    pub discovery_generation: u64,
}

pub trait AgentProviderExecutableResolver: Send + Sync {
    fn resolve_provider(
        &self,
        provider: AgentCliInvocation,
        manual_override: Option<&str>,
        refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String>;
}

#[derive(Clone, Copy)]
pub(super) struct ResolvedProviderExecutableRef<'a> {
    pub(super) cli_path: &'a str,
    pub(super) cli_identity: &'a ExecutableIdentity,
    pub(super) effective_path: &'a str,
    pub(super) path_fingerprint: &'a str,
    pub(super) discovery_generation: u64,
}

#[cfg(test)]
pub(super) struct TestProviderExecutableResolver;

#[cfg(test)]
impl AgentProviderExecutableResolver for TestProviderExecutableResolver {
    fn resolve_provider(
        &self,
        _provider: AgentCliInvocation,
        manual_override: Option<&str>,
        _refresh: bool,
    ) -> Result<ResolvedProviderExecutable, String> {
        let cli_path = manual_override
            .ok_or_else(|| "Agent provider CLI path is not configured.".to_string())?;
        let effective_path = std::env::var("PATH")
            .map_err(|_| "Agent provider CLI path is not configured.".to_string())?;
        let cli_identity = match crate::agent_task_spawner::agent_provider::process::executable_identity_path_with_effective_path(
            std::path::Path::new(cli_path),
            &effective_path,
        ) {
            Ok(identity) => identity,
            Err(_) => crate::agent_task_spawner::agent_provider::process::executable_identity_path_with_effective_path(
                &std::env::current_exe()
                    .map_err(|_| "Agent provider CLI path is not configured.".to_string())?,
                &effective_path,
            )?,
        };
        Ok(ResolvedProviderExecutable {
            cli_path: cli_path.to_string(),
            cli_identity,
            path_fingerprint: effective_path.clone(),
            effective_path,
            discovery_generation: 1,
        })
    }
}
