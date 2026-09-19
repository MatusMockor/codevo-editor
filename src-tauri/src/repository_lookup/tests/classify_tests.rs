use super::super::classify::classify_failure;
use super::super::repository_path::RepositoryPath;
use super::super::wire::{
    RepositoryLookupFailureReason, RepositoryLookupOutcome, RepositoryProvider,
};

const GH_SAMPLES: [(&str, RepositoryLookupOutcome); 9] = [
    ("gh: Not Found (HTTP 404)", RepositoryLookupOutcome::NotFound),
    (
        "GraphQL: Could not resolve to a Repository with the name 'acme/missing'. (repository)",
        RepositoryLookupOutcome::NotFound,
    ),
    (
        "gh: Bad credentials (HTTP 401)",
        RepositoryLookupOutcome::NotAuthenticated,
    ),
    (
        "To get started with GitHub CLI, please run:  gh auth login",
        RepositoryLookupOutcome::NotAuthenticated,
    ),
    (
        "gh: API rate limit exceeded for user ID 1234567. (HTTP 403)",
        RepositoryLookupOutcome::RateLimited {
            retry_after_seconds: None,
        },
    ),
    (
        "You have exceeded a secondary rate limit and have been temporarily blocked. (HTTP 403)",
        RepositoryLookupOutcome::RateLimited {
            retry_after_seconds: None,
        },
    ),
    (
        "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host",
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    ),
    (
        "Get \"https://api.github.com/repos/acme/missing\": tls: failed to verify certificate: x509: certificate signed by unknown authority",
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    ),
    (
        "error: Post \"https://api.github.com/graphql\": dial tcp 140.82.121.6:443: connect: connection refused",
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    ),
];

const GLAB_SAMPLES: [(&str, RepositoryLookupOutcome); 6] = [
    (
        "GET https://gitlab.example.com/api/v4/projects/acme%2Fmissing: 404 {message: 404 Project Not Found}",
        RepositoryLookupOutcome::NotFound,
    ),
    (
        "GET https://gitlab.example.com/api/v4/projects/acme%2Fmissing: 401 {message: 401 Unauthorized}",
        RepositoryLookupOutcome::NotAuthenticated,
    ),
    (
        "error: no token provided for gitlab.example.com; run `glab auth login` to authenticate",
        RepositoryLookupOutcome::NotAuthenticated,
    ),
    (
        "GET https://gitlab.example.com/api/v4/projects/acme%2Fmissing: 429 {message: Retry later}",
        RepositoryLookupOutcome::RateLimited {
            retry_after_seconds: None,
        },
    ),
    (
        "Get \"https://gitlab.example.com/api/v4/user\": x509: certificate has expired or is not yet valid",
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    ),
    (
        "Get \"https://gitlab.example.com/api/v4/user\": dial tcp: lookup gitlab.example.com: no such host",
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Network,
        },
    ),
];

const HOSTILE_SAMPLES: [&str; 7] = [
    "the requested certificate was not found in the audit log",
    "renewal notice: certificate",
    "unexpected transport failure while applying the rate limit policy",
    "please check your auth login configuration before retrying",
    "the project description mentions 404 and 401 handling",
    "repository does not exist in the local mirror index",
    "server replied: too many requests are queued for this runner",
];

#[test]
fn real_gh_stderr_samples_map_to_the_documented_classes() {
    let path =
        RepositoryPath::parse(RepositoryProvider::Github, "acme/missing").expect("github path");
    for (stderr, expected) in GH_SAMPLES {
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            expected,
            "{stderr}"
        );
    }
}

#[test]
fn real_glab_stderr_samples_map_to_the_documented_classes() {
    let path =
        RepositoryPath::parse(RepositoryProvider::Gitlab, "acme/missing").expect("gitlab path");
    for (stderr, expected) in GLAB_SAMPLES {
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            expected,
            "{stderr}"
        );
    }
}

#[test]
fn unanchored_stderr_prose_never_forges_a_class() {
    let path =
        RepositoryPath::parse(RepositoryProvider::Github, "acme/missing").expect("github path");
    for stderr in HOSTILE_SAMPLES {
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Unknown
            },
            "{stderr}"
        );
    }
}

#[test]
fn a_hostile_path_echoed_by_the_cli_never_forges_a_class() {
    let cases = [
        "acme/404-not-found",
        "acme/rate-limit-exceeded",
        "acme/gh-auth-login",
        "acme/x509-certificate",
    ];
    for raw in cases {
        let path = RepositoryPath::parse(RepositoryProvider::Github, raw).expect("github path");
        let stderr = format!("unexpected transport failure for {raw} while contacting the api");
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Unknown
            },
            "{raw}"
        );
    }
}
