use std::time::Duration;

use super::repository_path::RepositoryPath;
use super::wire::{RepositoryHostName, GITHUB_HOST};

pub(crate) const LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const HOSTS_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const MAX_LOOKUP_STDOUT_BYTES: usize = 256 * 1024;
pub(crate) const MAX_HOSTS_STDOUT_BYTES: usize = 64 * 1024;
pub(crate) const MAX_STDERR_BYTES: usize = 8 * 1024;

const GITHUB_REPO_FIELDS: &str = "nameWithOwner,url,sshUrl,visibility,description,defaultBranchRef";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CliProgram {
    Gh,
    Glab,
}

impl CliProgram {
    pub(crate) fn executable_name(self) -> &'static str {
        match self {
            Self::Gh => "gh",
            Self::Glab => "glab",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CliPlan {
    GithubAuthStatus,
    GithubRepoView {
        path: RepositoryPath,
    },
    GitlabAuthStatus,
    GitlabProject {
        host: RepositoryHostName,
        path: RepositoryPath,
    },
}

impl CliPlan {
    pub(crate) fn program(&self) -> CliProgram {
        match self {
            Self::GithubAuthStatus | Self::GithubRepoView { .. } => CliProgram::Gh,
            Self::GitlabAuthStatus | Self::GitlabProject { .. } => CliProgram::Glab,
        }
    }

    pub(crate) fn argv(&self) -> Vec<String> {
        match self {
            Self::GithubAuthStatus => vec![
                "auth".to_string(),
                "status".to_string(),
                "--hostname".to_string(),
                GITHUB_HOST.to_string(),
            ],
            Self::GitlabAuthStatus => vec!["auth".to_string(), "status".to_string()],
            Self::GithubRepoView { path } => vec![
                "repo".to_string(),
                "view".to_string(),
                format!("{GITHUB_HOST}/{}", path.as_str()),
                "--json".to_string(),
                GITHUB_REPO_FIELDS.to_string(),
            ],
            Self::GitlabProject { host, path } => vec![
                "api".to_string(),
                "--hostname".to_string(),
                host.as_str().to_string(),
                format!("projects/{}", path.percent_encoded()),
            ],
        }
    }

    pub(crate) fn timeout(&self) -> Duration {
        match self {
            Self::GithubAuthStatus | Self::GitlabAuthStatus => HOSTS_TIMEOUT,
            Self::GithubRepoView { .. } | Self::GitlabProject { .. } => LOOKUP_TIMEOUT,
        }
    }

    pub(crate) fn max_stdout_bytes(&self) -> usize {
        match self {
            Self::GithubAuthStatus | Self::GitlabAuthStatus => MAX_HOSTS_STDOUT_BYTES,
            Self::GithubRepoView { .. } | Self::GitlabProject { .. } => MAX_LOOKUP_STDOUT_BYTES,
        }
    }
}
