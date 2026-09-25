use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloneFailure {
    Authentication,
    NotFound,
    BranchNotFound,
    Network,
    HostKey,
    Timeout,
    Destination,
    Other,
}

const CLASSIFICATION_TABLE: [(CloneFailure, &[&str]); 5] = [
    (
        CloneFailure::HostKey,
        &["host key verification failed", "no matching host key"],
    ),
    (
        CloneFailure::Authentication,
        &[
            "authentication failed",
            "could not read username",
            "could not read password",
            "permission denied (publickey",
            "invalid username or password",
            "http basic: access denied",
            "terminal prompts disabled",
            "the requested url returned error: 401",
            "the requested url returned error: 403",
        ],
    ),
    (
        CloneFailure::BranchNotFound,
        &["not found in upstream", "could not find remote branch"],
    ),
    (
        CloneFailure::NotFound,
        &[
            "repository not found",
            "does not appear to be a git repository",
            "the requested url returned error: 404",
            "' not found",
            "the project you were looking for could not be found",
        ],
    ),
    (
        CloneFailure::Network,
        &[
            "could not resolve host",
            "could not resolve hostname",
            "failed to connect",
            "connection timed out",
            "connection refused",
            "connection reset",
            "connection was reset",
            "network is unreachable",
            "operation timed out",
            "openssl",
            "ssl_read",
            "ssl certificate problem",
            "ssl_connect",
            "ssl_error",
            "ssl routines",
            "tls handshake",
            "gnutls_handshake",
            "schannel",
            "early eof",
            "the remote end hung up unexpectedly",
        ],
    ),
];

const KNOWN_REMOTE_HOST_MESSAGES: [&str; 4] = [
    "remote: repository not found",
    "remote: invalid username or password",
    "remote: http basic: access denied",
    "remote: the project you were looking for could not be found",
];

fn classifiable(line: &str) -> bool {
    if !line.starts_with("remote:") {
        return true;
    }
    KNOWN_REMOTE_HOST_MESSAGES
        .iter()
        .any(|message| line.starts_with(message))
}

pub(crate) fn classify_failure<'a>(lines: impl Iterator<Item = &'a str> + Clone) -> CloneFailure {
    for (failure, needles) in CLASSIFICATION_TABLE {
        if lines
            .clone()
            .any(|line| classifiable(line) && needles.iter().any(|needle| line.contains(needle)))
        {
            return failure;
        }
    }
    CloneFailure::Other
}
