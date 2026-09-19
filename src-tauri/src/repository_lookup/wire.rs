use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::repository_path::{is_normalized_repository_path, RepositoryPath};
use super::sanitize::{is_bounded_branch, is_bounded_description};

pub(crate) const MAX_HOSTS_PER_PROVIDER: usize = 8;
pub(crate) const MAX_HOST_CHARS: usize = 253;
pub(crate) const GITHUB_HOST: &str = "github.com";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryProvider {
    Github,
    Gitlab,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryHostAuth {
    Authenticated,
    NotAuthenticated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryVisibility {
    Public,
    Private,
    Internal,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryHostsFailureReason {
    TimedOut,
    InvalidOutput,
    Busy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RepositoryLookupFailureReason {
    Network,
    InvalidOutput,
    OutputTooLarge,
    Busy,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RepositoryHostName(String);

impl RepositoryHostName {
    pub(crate) fn lowercased(value: &str) -> Option<Self> {
        let lowered = value.to_ascii_lowercase();
        if !is_repository_host(&lowered) {
            return None;
        }
        Some(Self(lowered))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

pub(crate) fn is_repository_host(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_HOST_CHARS {
        return false;
    }
    if value != value.to_ascii_lowercase() {
        return false;
    }
    let bytes = value.as_bytes();
    let (Some(first), Some(last)) = (bytes.first(), bytes.last()) else {
        return false;
    };
    if !first.is_ascii_alphanumeric() || !last.is_ascii_alphanumeric() {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'.' || *byte == b'-')
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositoryLookupRequestWire {
    provider: RepositoryProvider,
    host: String,
    path: String,
}

#[derive(Clone, Debug)]
pub(crate) struct RepositoryLookupRequest {
    pub(crate) provider: RepositoryProvider,
    pub(crate) host: RepositoryHostName,
    pub(crate) path: RepositoryPath,
}

impl RepositoryLookupRequest {
    pub(crate) fn validate(wire: &RepositoryLookupRequestWire) -> Option<Self> {
        if !is_repository_host(&wire.host) {
            return None;
        }
        let host = RepositoryHostName::lowercased(&wire.host)?;
        if !is_normalized_repository_path(wire.provider, &wire.path) {
            return None;
        }
        let path = RepositoryPath::parse(wire.provider, &wire.path)?;
        Some(Self {
            provider: wire.provider,
            host,
            path,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositoryHost {
    pub(crate) provider: RepositoryProvider,
    pub(crate) host: String,
    pub(crate) auth: RepositoryHostAuth,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum RepositoryHostsState {
    Ready {
        hosts: Vec<RepositoryHost>,
        truncated: bool,
    },
    CliMissing,
    Failed {
        reason: RepositoryHostsFailureReason,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositoryHostsSnapshot {
    pub(crate) github: RepositoryHostsState,
    pub(crate) gitlab: RepositoryHostsState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositoryInfo {
    pub(crate) provider: RepositoryProvider,
    pub(crate) host: String,
    pub(crate) full_path: String,
    pub(crate) description: Option<String>,
    pub(crate) visibility: RepositoryVisibility,
    pub(crate) default_branch: Option<String>,
    pub(crate) ssh_url: Option<String>,
    pub(crate) https_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum RepositoryLookupOutcome {
    Ok {
        repository: RepositoryInfo,
    },
    NotFound,
    CliMissing,
    NotAuthenticated,
    HostNotAllowed,
    TimedOut,
    Superseded,
    #[serde(rename_all = "camelCase")]
    RateLimited {
        retry_after_seconds: Option<u32>,
    },
    Failed {
        reason: RepositoryLookupFailureReason,
    },
}

impl RepositoryHostsSnapshot {
    pub(crate) fn sanitized(self) -> Self {
        Self {
            github: self.github.sanitized(RepositoryProvider::Github),
            gitlab: self.gitlab.sanitized(RepositoryProvider::Gitlab),
        }
    }
}

impl RepositoryHostsState {
    fn sanitized(self, provider: RepositoryProvider) -> Self {
        if self.is_valid(provider) {
            return self;
        }
        Self::Failed {
            reason: RepositoryHostsFailureReason::InvalidOutput,
        }
    }

    fn is_valid(&self, provider: RepositoryProvider) -> bool {
        let Self::Ready { hosts, .. } = self else {
            return true;
        };
        if hosts.len() > MAX_HOSTS_PER_PROVIDER {
            return false;
        }
        if hosts
            .iter()
            .map(|entry| entry.host.as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != hosts.len()
        {
            return false;
        }
        hosts
            .iter()
            .all(|entry| entry.provider == provider && is_repository_host(&entry.host))
    }
}

impl RepositoryLookupOutcome {
    pub(crate) fn sanitized(self) -> Self {
        if self.is_valid() {
            return self;
        }
        Self::Failed {
            reason: RepositoryLookupFailureReason::InvalidOutput,
        }
    }

    pub(crate) fn is_valid(&self) -> bool {
        let Self::Ok { repository } = self else {
            return true;
        };
        repository.is_valid()
    }
}

impl RepositoryInfo {
    pub(crate) fn is_valid(&self) -> bool {
        if !is_repository_host(&self.host) {
            return false;
        }
        if !is_normalized_repository_path(self.provider, &self.full_path) {
            return false;
        }
        if !self
            .description
            .as_deref()
            .is_none_or(is_bounded_description)
        {
            return false;
        }
        if !self.default_branch.as_deref().is_none_or(is_bounded_branch) {
            return false;
        }
        self.ssh_url.as_deref().is_none_or(is_ssh_clone_url)
            && self.https_url.as_deref().is_none_or(is_https_clone_url)
    }
}

pub(crate) fn is_ssh_clone_url(value: &str) -> bool {
    !value.starts_with("https://") && crate::remote_runner::repository_url(value)
}

pub(crate) fn is_https_clone_url(value: &str) -> bool {
    value.starts_with("https://") && crate::remote_runner::repository_url(value)
}
