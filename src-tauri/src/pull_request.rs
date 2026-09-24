use serde::Serialize;

pub(crate) const MAX_PULL_REQUEST_TITLE_BYTES: usize = 256;
pub(crate) const MAX_PULL_REQUEST_BODY_BYTES: usize = 65_536;
pub(crate) const MAX_PULL_REQUEST_URL_BYTES: usize = 2_048;
pub(crate) const MAX_PULL_REQUEST_MESSAGE_BYTES: usize = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ForgeKind {
    Github,
    Gitlab,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HostedRepository {
    pub(crate) forge: ForgeKind,
    pub(crate) host: String,
    pub(crate) owner: String,
    pub(crate) repository: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ValidatedPullRequest {
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) draft: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequestReceipt {
    pub(crate) url: String,
    pub(crate) forge: ForgeKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PullRequestFailure {
    NoRemote,
    UnsupportedHost,
    CliMissing(ForgeKind),
    AuthRequired(String),
    AlreadyExists(Option<String>),
    PushFailed(String),
    ForgeError(String),
    Invalid(String),
    Untrusted,
}

impl PullRequestFailure {
    pub(crate) fn into_error_string(self) -> String {
        match self {
            Self::NoRemote => "noRemote:No remote is configured for this repository.".to_string(),
            Self::UnsupportedHost => {
                "unsupportedHost:Pull requests can be created for github.com and gitlab.com remotes."
                    .to_string()
            }
            Self::CliMissing(ForgeKind::Github) => {
                "cliMissing:Install the GitHub CLI (gh) to create pull requests.".to_string()
            }
            Self::CliMissing(ForgeKind::Gitlab) => {
                "cliMissing:Install the GitLab CLI (glab) to create merge requests.".to_string()
            }
            Self::AuthRequired(message) => format!("authRequired:{}", clip(&message)),
            Self::AlreadyExists(url) => format!("alreadyExists:{}", url.unwrap_or_default()),
            Self::PushFailed(message) => format!("pushFailed:{}", clip(&message)),
            Self::ForgeError(message) => format!("forgeError:{}", clip(&message)),
            Self::Invalid(message) => format!("invalid:{}", clip(&message)),
            Self::Untrusted => {
                "untrusted:Creating pull requests requires a trusted repository.".to_string()
            }
        }
    }
}

pub(crate) fn hosted_repository(
    host: &str,
    owner: &str,
    repository: &str,
) -> Option<HostedRepository> {
    let forge = match host {
        "github.com" => ForgeKind::Github,
        "gitlab.com" => ForgeKind::Gitlab,
        _ => return None,
    };
    Some(HostedRepository {
        forge,
        host: host.to_string(),
        owner: owner.to_string(),
        repository: repository.to_string(),
    })
}

pub(crate) fn validate_pull_request(
    title: &str,
    body: &str,
    draft: bool,
) -> Result<ValidatedPullRequest, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Enter a pull request title.".to_string());
    }
    if title.len() > MAX_PULL_REQUEST_TITLE_BYTES
        || title
            .chars()
            .any(|character| character.is_control() || is_bidi_control(character))
    {
        return Err(format!(
            "Use a single-line title of at most {MAX_PULL_REQUEST_TITLE_BYTES} bytes."
        ));
    }
    if body.len() > MAX_PULL_REQUEST_BODY_BYTES {
        return Err(format!(
            "The description is longer than {MAX_PULL_REQUEST_BODY_BYTES} bytes."
        ));
    }
    if body.chars().any(|character| {
        is_bidi_control(character)
            || (character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    }) {
        return Err("The description contains unsupported control characters.".to_string());
    }
    Ok(ValidatedPullRequest {
        title: title.to_string(),
        body: body.to_string(),
        draft,
    })
}

pub(crate) fn pull_request_argv(
    repository: &HostedRepository,
    head: &str,
    base: &str,
    request: &ValidatedPullRequest,
) -> Vec<String> {
    let mut argv = match repository.forge {
        ForgeKind::Github => vec![
            "pr".to_string(),
            "create".to_string(),
            format!(
                "--repo={}/{}/{}",
                repository.host, repository.owner, repository.repository
            ),
            format!("--head={head}"),
            format!("--base={base}"),
            format!("--title={}", request.title),
            format!("--body={}", request.body),
        ],
        ForgeKind::Gitlab => vec![
            "mr".to_string(),
            "create".to_string(),
            format!(
                "--repo=https://{}/{}/{}",
                repository.host, repository.owner, repository.repository
            ),
            format!("--source-branch={head}"),
            format!("--target-branch={base}"),
            format!("--title={}", request.title),
            format!("--description={}", request.body),
            "--yes".to_string(),
        ],
    };
    if request.draft {
        argv.push("--draft".to_string());
    }
    argv
}

pub(crate) fn created_url(output: &str, host: &str) -> Option<String> {
    let prefix = format!("https://{host}/");
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            line.starts_with(&prefix)
                && line.len() <= MAX_PULL_REQUEST_URL_BYTES
                && !line
                    .chars()
                    .any(|character| character.is_whitespace() || character.is_control())
        })
        .map(str::to_string)
}

pub(crate) fn classify_forge_failure(stderr: &str, host: &str) -> PullRequestFailure {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("already exists") {
        return PullRequestFailure::AlreadyExists(created_url(stderr, host));
    }
    let unauthenticated = lower.contains("auth login")
        || lower.contains("not logged")
        || lower.contains("authentication")
        || lower.contains("401");
    if unauthenticated {
        return PullRequestFailure::AuthRequired(stderr.trim().to_string());
    }
    PullRequestFailure::ForgeError(stderr.trim().to_string())
}

pub(crate) fn strip_remote_prefix<'a>(name: &'a str, remote: &str) -> Option<&'a str> {
    name.strip_prefix(remote)?
        .strip_prefix('/')
        .filter(|branch| !branch.is_empty())
}

fn is_bidi_control(character: char) -> bool {
    matches!(character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

fn clip(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.len() <= MAX_PULL_REQUEST_MESSAGE_BYTES {
        return trimmed.to_string();
    }
    let mut end = MAX_PULL_REQUEST_MESSAGE_BYTES;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    trimmed[..end].to_string()
}

#[cfg(test)]
#[path = "pull_request_tests.rs"]
mod tests;
