use super::super::classify::classify_failure;
use super::super::hosts::parse_glab_auth_status;
use super::super::plan::CliPlan;
use super::super::repository_path::{
    is_normalized_repository_path, normalized_repository_path, RepositoryPath,
};
use super::super::wire::{
    RepositoryHostAuth, RepositoryHostName, RepositoryLookupFailureReason, RepositoryLookupOutcome,
    RepositoryProvider, RepositoryVisibility,
};
use super::super::{github, gitlab};

const GLAB_AUTH_STATUS: &str = "git.efabrica.sk\n  Logged in to git.efabrica.sk as mockor (keyring)\n  Git operations for git.efabrica.sk configured to use ssh protocol.\n  Token: glpat-super-secret-token\ngitlab.com\n  x gitlab.com: api call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}\n";

#[test]
fn repository_paths_follow_the_shared_grammar() {
    assert_eq!(
        normalized_repository_path(RepositoryProvider::Github, "acme/storefront-api"),
        Some("acme/storefront-api".to_string())
    );
    assert_eq!(
        normalized_repository_path(RepositoryProvider::Github, " acme/storefront-api.git "),
        Some("acme/storefront-api".to_string())
    );
    assert_eq!(
        normalized_repository_path(RepositoryProvider::Gitlab, "platform/payments/billing"),
        Some("platform/payments/billing".to_string())
    );
}

#[test]
fn adversarial_repository_paths_are_rejected() {
    let rejected = [
        "-acme/storefront-api",
        "acme/:id",
        "acme/store&front",
        "acme/store#front",
        "acme/store%2Ffront",
        "acme/store\u{0}front",
        "acme/../storefront",
        "acme/..",
        "acme",
        "acme/storefront/extra",
        "acme//storefront",
        "acme/.storefront",
        "/acme/storefront",
        "acme/storefront/",
        "",
        "   ",
    ];
    for path in rejected {
        assert_eq!(
            normalized_repository_path(RepositoryProvider::Github, path),
            None,
            "expected {path:?} to be rejected"
        );
    }
    let over_limit = format!("acme/{}", "a".repeat(256));
    assert_eq!(
        normalized_repository_path(RepositoryProvider::Github, &over_limit),
        None
    );
    let at_limit = format!("acme/{}", "a".repeat(250));
    assert_eq!(at_limit.chars().count(), 255);
    assert!(normalized_repository_path(RepositoryProvider::Github, &at_limit).is_some());
}

#[test]
fn surrounding_whitespace_normalizes_but_is_never_an_accepted_request_path() {
    for raw in [
        "acme/storefront\n",
        " acme/storefront ",
        "acme/storefront.git",
    ] {
        assert!(normalized_repository_path(RepositoryProvider::Github, raw).is_some());
        assert!(!is_normalized_repository_path(
            RepositoryProvider::Github,
            raw
        ));
    }
}

#[test]
fn gitlab_paths_are_bounded_to_twenty_segments() {
    let segments = (0..20).map(|_| "group").collect::<Vec<_>>().join("/");
    assert!(normalized_repository_path(RepositoryProvider::Gitlab, &segments).is_some());
    let too_deep = (0..21).map(|_| "group").collect::<Vec<_>>().join("/");
    assert_eq!(
        normalized_repository_path(RepositoryProvider::Gitlab, &too_deep),
        None
    );
}

#[test]
fn cli_plans_render_closed_argument_vectors() {
    let path = RepositoryPath::parse(RepositoryProvider::Github, "acme/storefront-api")
        .expect("github path");
    assert_eq!(
        CliPlan::GithubRepoView { path }.argv(),
        vec![
            "repo".to_string(),
            "view".to_string(),
            "github.com/acme/storefront-api".to_string(),
            "--json".to_string(),
            "nameWithOwner,url,sshUrl,visibility,description,defaultBranchRef".to_string(),
        ]
    );
    assert_eq!(
        CliPlan::GithubAuthStatus.argv(),
        vec![
            "auth".to_string(),
            "status".to_string(),
            "--hostname".to_string(),
            "github.com".to_string(),
        ]
    );
    assert_eq!(
        CliPlan::GitlabAuthStatus.argv(),
        vec!["auth".to_string(), "status".to_string()]
    );
    let host = RepositoryHostName::lowercased("GitLab.Example.com").expect("host");
    let path = RepositoryPath::parse(RepositoryProvider::Gitlab, "platform/payments/billing")
        .expect("gitlab path");
    assert_eq!(
        CliPlan::GitlabProject { host, path }.argv(),
        vec![
            "api".to_string(),
            "--hostname".to_string(),
            "gitlab.example.com".to_string(),
            "projects/platform%2Fpayments%2Fbilling".to_string(),
        ]
    );
}

#[test]
fn the_gitlab_host_list_is_parsed_without_retaining_secrets() {
    let parsed = parse_glab_auth_status(GLAB_AUTH_STATUS);

    assert!(!parsed.truncated);
    assert_eq!(parsed.hosts.len(), 2);
    assert_eq!(parsed.hosts[0].host, "git.efabrica.sk");
    assert_eq!(parsed.hosts[0].auth, RepositoryHostAuth::Authenticated);
    assert_eq!(parsed.hosts[1].host, "gitlab.com");
    assert_eq!(parsed.hosts[1].auth, RepositoryHostAuth::NotAuthenticated);
    let serialized = serde_json::to_string(&parsed.hosts).expect("serialize hosts");
    assert!(!serialized.contains("glpat"), "{serialized}");
    assert!(!serialized.contains("401"), "{serialized}");
}

#[test]
fn host_names_are_lowercased_and_the_ninth_host_is_truncated() {
    let output = (0..9)
        .map(|index| {
            format!(
                "GitLab-{index}.Example.com\n  Logged in to gitlab-{index}.example.com as tester\n"
            )
        })
        .collect::<String>();

    let parsed = parse_glab_auth_status(&output);

    assert!(parsed.truncated);
    assert_eq!(parsed.hosts.len(), 8);
    assert_eq!(parsed.hosts[0].host, "gitlab-0.example.com");
    assert_eq!(parsed.hosts[7].host, "gitlab-7.example.com");
    assert!(parsed
        .hosts
        .iter()
        .all(|host| host.auth == RepositoryHostAuth::Authenticated));
}

#[test]
fn unrelated_auth_status_lines_never_become_hosts() {
    let parsed = parse_glab_auth_status("No hosts configured\n  Token: glpat-secret\n");

    assert!(parsed.hosts.is_empty());
    assert!(!parsed.truncated);
}

#[test]
fn hosts_carrying_a_port_are_skipped_but_reported_as_truncated() {
    let parsed = parse_glab_auth_status(
        "gitlab.example.com:8443\n  Logged in to gitlab.example.com:8443 as tester\ngitlab.example.com\n  Logged in to gitlab.example.com as tester\n",
    );

    assert_eq!(parsed.hosts.len(), 1);
    assert_eq!(parsed.hosts[0].host, "gitlab.example.com");
    assert!(parsed.truncated);
}

#[test]
fn a_hostile_repository_path_cannot_forge_the_failure_class() {
    let cases = [
        (
            "acme/issue-429",
            "error: failed to run git: GET https://gitlab.example.com/api/v4/projects/acme%2Fissue-429 dial tcp: lookup gitlab.example.com: no such host",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Network,
            },
        ),
        (
            "acme/repo-404",
            "failed: GET https://gitlab.example.com/api/v4/projects/acme%2Frepo-404: dial tcp: connection refused",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Network,
            },
        ),
        (
            "acme/rate-limit",
            "unexpected transport failure for acme/rate-limit",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Unknown,
            },
        ),
        (
            "acme/401-auth-login",
            "unexpected transport failure for acme/401-auth-login",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Unknown,
            },
        ),
    ];
    for (raw, stderr, expected) in cases {
        let path = RepositoryPath::parse(RepositoryProvider::Gitlab, raw).expect("gitlab path");
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            expected,
            "{raw}"
        );
    }
}

#[test]
fn server_failures_are_still_classified_after_neutralizing_the_echoed_path() {
    let path =
        RepositoryPath::parse(RepositoryProvider::Gitlab, "acme/issue-429").expect("gitlab path");
    let cases = [
        (
            "GET https://gitlab.example.com/api/v4/projects/acme%2Fissue-429: 404 {message: 404 Project Not Found}",
            RepositoryLookupOutcome::NotFound,
        ),
        (
            "GET https://gitlab.example.com/api/v4/projects/acme%2Fissue-429: 401 {message: 401 Unauthorized}",
            RepositoryLookupOutcome::NotAuthenticated,
        ),
        (
            "GET https://gitlab.example.com/api/v4/projects/acme%2Fissue-429: 429 {message: 429 Too Many Requests}",
            RepositoryLookupOutcome::RateLimited {
                retry_after_seconds: None,
            },
        ),
    ];
    for (stderr, expected) in cases {
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            expected,
            "{stderr}"
        );
    }
}

#[test]
fn default_branches_reuse_the_clone_branch_grammar() {
    for branch in [
        "--upload-pack=x",
        "a..b",
        "-main",
        "main/",
        "feature/.hidden",
    ] {
        let payload =
            format!(r#"{{"path_with_namespace":"platform/billing","default_branch":"{branch}"}}"#);
        let repository =
            gitlab::parse_repository(&host(), payload.as_bytes()).expect("gitlab repository");
        assert_eq!(repository.default_branch, None, "{branch}");
    }
    let payload =
        br#"{"path_with_namespace":"platform/billing","default_branch":"release/2026.04"}"#;
    let repository = gitlab::parse_repository(&host(), payload).expect("gitlab repository");
    assert_eq!(
        repository.default_branch.as_deref(),
        Some("release/2026.04")
    );
}

#[test]
fn the_classification_table_maps_cli_failures_to_closed_outcomes() {
    let cases = [
        (
            "HTTP 404: Not Found (https://api.github.com/repos/acme/missing)",
            RepositoryLookupOutcome::NotFound,
        ),
        (
            "GraphQL: Could not resolve to a Repository with the name 'acme/missing'",
            RepositoryLookupOutcome::NotFound,
        ),
        (
            "HTTP 401: Bad credentials. Try authenticating with: gh auth login",
            RepositoryLookupOutcome::NotAuthenticated,
        ),
        (
            "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Network,
            },
        ),
        (
            "You have exceeded a secondary rate limit",
            RepositoryLookupOutcome::RateLimited {
                retry_after_seconds: None,
            },
        ),
        (
            "something entirely unexpected happened",
            RepositoryLookupOutcome::Failed {
                reason: RepositoryLookupFailureReason::Unknown,
            },
        ),
    ];
    let path =
        RepositoryPath::parse(RepositoryProvider::Github, "acme/missing").expect("github path");
    for (stderr, expected) in cases {
        assert_eq!(
            classify_failure(stderr.as_bytes(), &path),
            expected,
            "{stderr}"
        );
    }
}

#[test]
fn github_output_derives_urls_from_the_validated_full_path() {
    let repository = github::parse_repository(
        br#"{"nameWithOwner":"acme/storefront-api","url":"https://github.com/acme/storefront-api","visibility":"INTERNAL","description":null,"defaultBranchRef":null}"#,
    )
    .expect("github repository");

    assert_eq!(repository.host, "github.com");
    assert_eq!(repository.visibility, RepositoryVisibility::Internal);
    assert_eq!(repository.description, None);
    assert_eq!(repository.default_branch, None);
    assert_eq!(
        repository.ssh_url.as_deref(),
        Some("git@github.com:acme/storefront-api.git")
    );
    assert_eq!(
        repository.https_url.as_deref(),
        Some("https://github.com/acme/storefront-api.git")
    );
    assert!(repository.is_valid());
}

#[test]
fn github_output_with_an_invalid_full_path_is_refused() {
    assert!(github::parse_repository(
        br#"{"nameWithOwner":"acme/team/storefront","url":"https://github.com/acme/team/storefront"}"#
    )
    .is_none());
    assert!(github::parse_repository(
        br#"{"nameWithOwner":"-acme/storefront","url":"https://github.com/-acme/storefront"}"#
    )
    .is_none());
    assert!(github::parse_repository(b"not json").is_none());
}

#[test]
fn gitlab_urls_are_accepted_only_through_the_clone_url_grammar() {
    let host = RepositoryHostName::lowercased("gitlab.example.com").expect("host");
    let repository = gitlab::parse_repository(
        &host,
        br#"{"path_with_namespace":"platform/billing","visibility":"secret","description":"Line\u0000break","default_branch":"release/2026.04","ssh_url_to_repo":"ssh://git@gitlab.example.com:2222/platform/billing.git","http_url_to_repo":"https://user:token@gitlab.example.com/platform/billing.git"}"#,
    )
    .expect("gitlab repository");

    assert_eq!(repository.visibility, RepositoryVisibility::Unknown);
    assert_eq!(repository.description.as_deref(), Some("Linebreak"));
    assert_eq!(
        repository.default_branch.as_deref(),
        Some("release/2026.04")
    );
    assert_eq!(
        repository.ssh_url.as_deref(),
        Some("ssh://git@gitlab.example.com:2222/platform/billing.git")
    );
    assert_eq!(repository.https_url, None);
    assert!(repository.is_valid());
}

#[test]
fn gitlab_descriptions_are_clipped_to_the_contract_limit() {
    let description = "é".repeat(400);
    let payload =
        format!(r#"{{"path_with_namespace":"platform/billing","description":"{description}"}}"#);

    let repository =
        gitlab::parse_repository(&host(), payload.as_bytes()).expect("gitlab repository");

    assert_eq!(
        repository
            .description
            .as_deref()
            .map(|value| value.chars().count()),
        Some(200)
    );
    assert!(repository.is_valid());
}

#[test]
fn gitlab_branches_beyond_the_grammar_are_dropped() {
    let payload =
        br#"{"path_with_namespace":"platform/billing","default_branch":"release branch"}"#;

    let repository = gitlab::parse_repository(&host(), payload).expect("gitlab repository");

    assert_eq!(repository.default_branch, None);
    assert!(repository.is_valid());
}

fn host() -> RepositoryHostName {
    RepositoryHostName::lowercased("gitlab.example.com").expect("host")
}
