use super::plan::MAX_STDERR_BYTES;
use super::repository_path::RepositoryPath;
use super::sanitize::bounded_lossy_text;
use super::wire::{RepositoryLookupFailureReason, RepositoryLookupOutcome};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FailureClass {
    RateLimited,
    NotFound,
    NotAuthenticated,
    Network,
}

const CLASSIFICATION_TABLE: [(FailureClass, &[&str]); 4] = [
    (
        FailureClass::RateLimited,
        &[
            "api rate limit exceeded",
            "secondary rate limit",
            "rate limit exceeded",
            "http 429",
            "429 too many requests",
            "429 {message",
        ],
    ),
    (
        FailureClass::NotFound,
        &[
            "http 404",
            "404 not found",
            "404 project not found",
            "404 group not found",
            "could not resolve to a repository",
        ],
    ),
    (
        FailureClass::NotAuthenticated,
        &[
            "http 401",
            "http 403",
            "401 unauthorized",
            "403 forbidden",
            "gh auth login",
            "glab auth login",
            "bad credentials",
            "requires authentication",
            "authentication required",
            "no api token",
            "no token provided",
            "must be authenticated",
        ],
    ),
    (
        FailureClass::Network,
        &[
            "dial tcp",
            "no such host",
            "could not resolve host",
            "connection refused",
            "connection reset",
            "network is unreachable",
            "i/o timeout",
            "tls handshake",
            "tls: failed to verify certificate",
            "x509: certificate",
            "certificate signed by unknown authority",
            "certificate has expired",
            "server misbehaving",
        ],
    ),
];

pub(crate) fn classify_failure(stderr: &[u8], path: &RepositoryPath) -> RepositoryLookupOutcome {
    let text = neutral_stderr(stderr, path);
    let Some(class) = CLASSIFICATION_TABLE
        .iter()
        .find(|(_, markers)| markers.iter().any(|marker| text.contains(marker)))
        .map(|(class, _)| *class)
    else {
        return RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Unknown,
        };
    };
    match class {
        FailureClass::RateLimited => RepositoryLookupOutcome::RateLimited {
            retry_after_seconds: None,
        },
        FailureClass::NotFound => RepositoryLookupOutcome::NotFound,
        FailureClass::NotAuthenticated => RepositoryLookupOutcome::NotAuthenticated,
        FailureClass::Network => RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    }
}

pub(crate) fn neutral_stderr(stderr: &[u8], path: &RepositoryPath) -> String {
    let text = bounded_lossy_text(stderr, MAX_STDERR_BYTES).to_lowercase();
    let without_locations = strip_locations(&text);
    let echoes = [
        path.as_str().to_ascii_lowercase(),
        path.percent_encoded().to_ascii_lowercase(),
    ];
    echoes
        .iter()
        .fold(without_locations, |text, echo| replace_all(&text, echo))
}

fn strip_locations(text: &str) -> String {
    text.split(|character: char| character.is_ascii_whitespace())
        .map(|token| match is_location_token(token) {
            true => " ",
            false => token,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_location_token(token: &str) -> bool {
    token.contains("://") || token.contains('@') || token.contains("%2f")
}

fn replace_all(text: &str, echo: &str) -> String {
    if echo.is_empty() {
        return text.to_string();
    }
    text.split(echo).collect::<Vec<_>>().join(" ")
}
