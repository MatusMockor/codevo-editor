use crate::{
    agent_task_spawner::agent_provider::agent_cli_version::parse_agent_cli_version,
    agent_task_spawner::AgentCliInvocation,
};
use serde::Deserialize;
use std::{fmt, time::Duration};

const MAX_METADATA_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CANCEL_POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistryVersionError {
    Cancelled,
    Timeout,
    Unavailable,
    InvalidResponse,
    ResponseTooLarge,
}

impl fmt::Display for RegistryVersionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "Provider operation was cancelled.",
            Self::Timeout => "The public package registry did not respond in time.",
            Self::Unavailable => "The public package registry is unavailable.",
            Self::InvalidResponse => "The public package registry returned an invalid version.",
            Self::ResponseTooLarge => {
                "The public package registry response exceeded its size limit."
            }
        })
    }
}

pub trait AgentProviderReleaseMetadataSource {
    fn latest(
        &self,
        provider: AgentCliInvocation,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<String, RegistryVersionError>;
}

pub struct PublicRegistryMetadataSource;

impl AgentProviderReleaseMetadataSource for PublicRegistryMetadataSource {
    fn latest(
        &self,
        provider: AgentCliInvocation,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<String, RegistryVersionError> {
        let endpoint = match provider {
            AgentCliInvocation::ClaudeCode => {
                "https://registry.npmjs.org/@anthropic-ai/claude-code/latest"
            }
            AgentCliInvocation::CodexExec => "https://registry.npmjs.org/@openai/codex/latest",
        };
        tauri::async_runtime::block_on(fetch_version(endpoint, cancelled, REQUEST_TIMEOUT))
    }
}

async fn fetch_version(
    endpoint: &str,
    cancelled: impl Fn() -> bool,
    timeout: Duration,
) -> Result<String, RegistryVersionError> {
    if cancelled() {
        return Err(RegistryVersionError::Cancelled);
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(timeout)
        .build()
        .map_err(|_| RegistryVersionError::Unavailable)?;
    let mut poll = tokio::time::interval(CANCEL_POLL);
    let request = read_version(&client, endpoint);
    tokio::pin!(request);
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            biased;
            _ = poll.tick() => {
                if cancelled() {
                    return Err(RegistryVersionError::Cancelled);
                }
            }
            _ = &mut deadline => return Err(RegistryVersionError::Timeout),
            result = &mut request => {
                if cancelled() {
                    return Err(RegistryVersionError::Cancelled);
                }
                return result;
            }
        }
    }
}

async fn read_version(
    client: &reqwest::Client,
    endpoint: &str,
) -> Result<String, RegistryVersionError> {
    let mut response = client
        .get(endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(classify_transport_error)?;
    if !response.status().is_success() {
        return Err(RegistryVersionError::Unavailable);
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_METADATA_BYTES as u64)
    {
        return Err(RegistryVersionError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(classify_transport_error)? {
        if chunk.len() > MAX_METADATA_BYTES.saturating_sub(bytes.len()) {
            return Err(RegistryVersionError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_version(&bytes)
}

fn classify_transport_error(error: reqwest::Error) -> RegistryVersionError {
    if error.is_timeout() {
        return RegistryVersionError::Timeout;
    }
    RegistryVersionError::Unavailable
}

fn parse_version(bytes: &[u8]) -> Result<String, RegistryVersionError> {
    #[derive(Deserialize)]
    struct Metadata {
        version: String,
    }
    let metadata: Metadata =
        serde_json::from_slice(bytes).map_err(|_| RegistryVersionError::InvalidResponse)?;
    let parsed = parse_agent_cli_version(&metadata.version)
        .filter(|version| *version == metadata.version)
        .ok_or(RegistryVersionError::InvalidResponse)?;
    Ok(parsed)
}

#[cfg(test)]
#[path = "agent_provider_registry_tests.rs"]
mod tests;
