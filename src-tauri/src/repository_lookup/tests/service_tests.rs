use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::super::wire::{
    RepositoryHostAuth, RepositoryHostsSnapshot, RepositoryHostsState,
    RepositoryLookupFailureReason, RepositoryLookupOutcome, RepositoryProvider,
    RepositoryVisibility,
};
use super::fake_cli::{request, FakeCliDirectory};

const GITHUB_VIEW: &str = concat!(
    "cat <<'JSON'\n",
    r#"{"nameWithOwner":"acme/storefront-api","description":"Storefront API service","#,
    r#""visibility":"PUBLIC","defaultBranchRef":{"name":"main"},"#,
    r#""url":"https://github.com/acme/storefront-api","#,
    r#""sshUrl":"git@github.com:acme/storefront-api.git"}"#,
    "\nJSON"
);

const GITLAB_PROJECT: &str = concat!(
    "cat <<'JSON'\n",
    r#"{"path_with_namespace":"platform/billing-service","description":"Billing service","#,
    r#""visibility":"private","default_branch":"main","#,
    r#""ssh_url_to_repo":"ssh://git@gitlab.example.com:2222/platform/billing-service.git","#,
    r#""http_url_to_repo":"https://gitlab.example.com/platform/billing-service.git"}"#,
    "\nJSON"
);

fn glab_script(directory: &FakeCliDirectory, project_body: &str) -> String {
    format!(
        "printf '%s\\n' \"$*\" >> {argv}\nif [ \"$1\" = \"auth\" ]; then\n  echo 'gitlab.example.com'\n  echo '  Logged in to gitlab.example.com as tester (keyring)'\n  echo '  Token: glpat-secret-value'\n  exit 0\nfi\n{project_body}",
        argv = directory.file("glab.argv").to_string_lossy(),
        project_body = project_body
    )
}

fn github_script(directory: &FakeCliDirectory, body: &str) -> String {
    format!(
        "printf '%s\\n' \"$*\" >> {argv}\n{body}",
        argv = directory.file("gh.argv").to_string_lossy(),
        body = body
    )
}

#[test]
fn a_github_lookup_returns_a_validated_repository_and_derived_urls() {
    let directory = FakeCliDirectory::create("github-ok");
    directory.script("gh", &github_script(&directory, GITHUB_VIEW));
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    let RepositoryLookupOutcome::Ok { repository } = outcome else {
        panic!("expected a repository, got {outcome:?}");
    };
    assert_eq!(repository.provider, RepositoryProvider::Github);
    assert_eq!(repository.host, "github.com");
    assert_eq!(repository.full_path, "acme/storefront-api");
    assert_eq!(repository.visibility, RepositoryVisibility::Public);
    assert_eq!(repository.default_branch.as_deref(), Some("main"));
    assert_eq!(
        repository.ssh_url.as_deref(),
        Some("git@github.com:acme/storefront-api.git")
    );
    assert_eq!(
        repository.https_url.as_deref(),
        Some("https://github.com/acme/storefront-api.git")
    );
    assert_eq!(
        directory.read("gh.argv").trim(),
        "repo view github.com/acme/storefront-api --json \
         nameWithOwner,url,sshUrl,visibility,description,defaultBranchRef"
    );
}

#[test]
fn a_gitlab_lookup_uses_the_allow_listed_host_and_percent_encoded_path() {
    let directory = FakeCliDirectory::create("gitlab-ok");
    directory.script("glab", &glab_script(&directory, GITLAB_PROJECT));
    let service = directory.service();

    let outcome = service.lookup(request(
        "gitlab",
        "gitlab.example.com",
        "platform/billing-service",
    ));

    let RepositoryLookupOutcome::Ok { repository } = outcome else {
        panic!("expected a repository, got {outcome:?}");
    };
    assert_eq!(repository.host, "gitlab.example.com");
    assert_eq!(repository.full_path, "platform/billing-service");
    assert_eq!(repository.visibility, RepositoryVisibility::Private);
    assert_eq!(
        repository.ssh_url.as_deref(),
        Some("ssh://git@gitlab.example.com:2222/platform/billing-service.git")
    );
    let argv = directory.read("glab.argv");
    assert!(argv.contains("auth status"), "{argv}");
    assert!(
        argv.contains("api --hostname gitlab.example.com projects/platform%2Fbilling-service"),
        "{argv}"
    );
    assert!(!argv.contains("glpat"), "{argv}");
}

#[test]
fn a_gitlab_host_outside_the_allow_list_is_refused_without_an_api_call() {
    let directory = FakeCliDirectory::create("gitlab-host");
    directory.script("glab", &glab_script(&directory, GITLAB_PROJECT));
    let service = directory.service();

    let outcome = service.lookup(request(
        "gitlab",
        "gitlab.internal",
        "platform/billing-service",
    ));

    assert_eq!(outcome, RepositoryLookupOutcome::HostNotAllowed);
    assert!(!directory.read("glab.argv").contains("api"));
}

#[test]
fn a_github_host_other_than_github_com_is_refused() {
    let directory = FakeCliDirectory::create("github-host");
    directory.script("gh", &github_script(&directory, GITHUB_VIEW));
    let service = directory.service();

    let outcome = service.lookup(request(
        "github",
        "github.example.com",
        "acme/storefront-api",
    ));

    assert_eq!(outcome, RepositoryLookupOutcome::HostNotAllowed);
    assert!(directory.read("gh.argv").is_empty());
}

#[test]
fn a_missing_cli_reports_cli_missing() {
    let directory = FakeCliDirectory::create("missing");
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(outcome, RepositoryLookupOutcome::CliMissing);
}

#[test]
fn a_failing_lookup_is_classified_from_the_exit_status_and_stderr() {
    let directory = FakeCliDirectory::create("not-found");
    directory.script(
        "gh",
        "echo 'GraphQL: Could not resolve to a Repository with the name' >&2\nexit 1",
    );
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(outcome, RepositoryLookupOutcome::NotFound);
}

#[test]
fn a_rate_limited_lookup_reports_rate_limited_without_a_retry_hint() {
    let directory = FakeCliDirectory::create("rate-limited");
    directory.script("gh", "echo 'API rate limit exceeded' >&2\nexit 1");
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(
        outcome,
        RepositoryLookupOutcome::RateLimited {
            retry_after_seconds: None
        }
    );
}

#[test]
fn oversized_lookup_output_reports_output_too_large() {
    let directory = FakeCliDirectory::create("too-large");
    directory.script("gh", "head -c 300000 /dev/zero | tr '\\0' a");
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(
        outcome,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::OutputTooLarge
        }
    );
}

#[test]
fn unparsable_lookup_output_reports_invalid_output() {
    let directory = FakeCliDirectory::create("invalid");
    directory.script("gh", "echo 'not json'");
    let service = directory.service();

    let outcome = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(
        outcome,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::InvalidOutput
        }
    );
}

#[test]
fn a_superseding_lookup_kills_the_previous_job_which_reports_superseded() {
    let directory = FakeCliDirectory::create("supersede");
    let marker = directory.file("started.marker");
    directory.script(
        "gh",
        &format!(
            "if [ -f {marker} ]; then\n{GITHUB_VIEW}\nexit 0\nfi\ntouch {marker}\nsleep 300",
            marker = marker.to_string_lossy()
        ),
    );
    let service = directory.service();
    let first_service = Arc::clone(&service);
    let first = thread::spawn(move || {
        first_service.lookup(request("github", "github.com", "acme/storefront-api"))
    });
    assert!(directory.await_file("started.marker"));
    directory.advance_past_spawn_interval();

    let started = Instant::now();
    let second = service.lookup(request("github", "github.com", "acme/storefront-api"));
    let elapsed = started.elapsed();

    assert!(
        matches!(second, RepositoryLookupOutcome::Ok { .. }),
        "{second:?}"
    );
    assert!(elapsed < Duration::from_secs(8), "{elapsed:?}");
    assert_eq!(
        first.join().expect("join superseded lookup"),
        RepositoryLookupOutcome::Superseded
    );
}

#[test]
fn a_second_waiter_is_refused_as_busy() {
    let directory = FakeCliDirectory::create("busy");
    directory.script("gh", &github_script(&directory, GITHUB_VIEW));
    let service = directory.service();
    let slot = service.slot_for(RepositoryProvider::Github);
    let lease = slot.acquire().expect("occupy the provider slot");
    let waiting_service = Arc::clone(&service);
    let waiter = thread::spawn(move || {
        waiting_service.lookup(request("github", "github.com", "acme/storefront-api"))
    });
    while !slot.has_waiter() {
        thread::sleep(Duration::from_millis(5));
    }

    let busy = service.lookup(request("github", "github.com", "acme/storefront-api"));

    assert_eq!(
        busy,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Busy
        }
    );
    directory.advance_past_spawn_interval();
    drop(lease);
    assert!(matches!(
        waiter.join().expect("join waiting lookup"),
        RepositoryLookupOutcome::Ok { .. }
    ));
}

#[test]
fn a_panic_while_the_slot_is_held_releases_it_for_the_next_lookup() {
    let directory = FakeCliDirectory::create("panic");
    directory.script("gh", &github_script(&directory, GITHUB_VIEW));
    let service = directory.service();

    let panicked = catch_unwind(AssertUnwindSafe(|| {
        let _lease = service
            .slot_for(RepositoryProvider::Github)
            .acquire()
            .expect("occupy the provider slot");
        panic!("parser failure");
    }));
    directory.advance_past_spawn_interval();

    assert!(panicked.is_err());
    assert!(matches!(
        service.lookup(request("github", "github.com", "acme/storefront-api")),
        RepositoryLookupOutcome::Ok { .. }
    ));
}

#[test]
fn the_hosts_snapshot_reports_both_providers_without_cli_text() {
    let directory = FakeCliDirectory::create("hosts");
    directory.script(
        "gh",
        "echo 'Logged in to github.com account tester'\nexit 0",
    );
    directory.script("glab", &glab_script(&directory, GITLAB_PROJECT));
    let service = directory.service();

    let snapshot = service.hosts();

    let serialized = serde_json::to_string(&snapshot).expect("serialize snapshot");
    assert!(!serialized.contains("glpat"), "{serialized}");
    let RepositoryHostsSnapshot { github, gitlab } = snapshot;
    assert_eq!(
        github,
        RepositoryHostsState::Ready {
            hosts: vec![super::super::wire::RepositoryHost {
                provider: RepositoryProvider::Github,
                host: "github.com".to_string(),
                auth: RepositoryHostAuth::Authenticated,
            }],
            truncated: false,
        }
    );
    let RepositoryHostsState::Ready { hosts, truncated } = gitlab else {
        panic!("expected ready gitlab hosts, got {gitlab:?}");
    };
    assert!(!truncated);
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].host, "gitlab.example.com");
    assert_eq!(hosts[0].auth, RepositoryHostAuth::Authenticated);
}

#[test]
fn the_hosts_snapshot_reports_missing_clis() {
    let directory = FakeCliDirectory::create("hosts-missing");
    let service = directory.service();

    let snapshot = service.hosts();

    assert_eq!(snapshot.github, RepositoryHostsState::CliMissing);
    assert_eq!(snapshot.gitlab, RepositoryHostsState::CliMissing);
}

#[test]
fn an_unauthenticated_github_cli_is_reported_as_not_authenticated() {
    let directory = FakeCliDirectory::create("hosts-unauthenticated");
    directory.script(
        "gh",
        "echo 'You are not logged into any GitHub hosts' >&2\nexit 1",
    );
    let service = directory.service();

    let snapshot = service.hosts();

    assert_eq!(
        snapshot.github,
        RepositoryHostsState::Ready {
            hosts: vec![super::super::wire::RepositoryHost {
                provider: RepositoryProvider::Github,
                host: "github.com".to_string(),
                auth: RepositoryHostAuth::NotAuthenticated,
            }],
            truncated: false,
        }
    );
}
