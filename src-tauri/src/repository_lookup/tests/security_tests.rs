use super::super::wire::{
    RepositoryHostsState, RepositoryLookupFailureReason, RepositoryLookupOutcome,
    RepositoryVisibility,
};
use super::fake_cli::{request, FakeCliDirectory};

fn gh(directory: &FakeCliDirectory, body: &str) {
    directory.script(
        "gh",
        &format!(
            "printf '%s\\n' \"$*\" >> {argv}\n{body}",
            argv = directory.file("gh.argv").to_string_lossy()
        ),
    );
}

fn glab(directory: &FakeCliDirectory, body: &str) {
    directory.script(
        "glab",
        &format!(
            "printf '%s\\n' \"$*\" >> {argv}\nif [ \"$1\" = \"auth\" ]; then\n  echo 'gitlab.example.com'\n  echo '  Logged in to gitlab.example.com as tester (keyring)'\n  exit 0\nfi\n{body}",
            argv = directory.file("glab.argv").to_string_lossy()
        ),
    );
}

fn json(body: &str) -> String {
    format!("cat <<'JSON'\n{body}\nJSON")
}

fn github_view(full_path: &str, url: &str) -> String {
    json(&format!(
        r#"{{"nameWithOwner":"{full_path}","url":"{url}","visibility":"PUBLIC","description":null,"defaultBranchRef":{{"name":"main"}}}}"#
    ))
}

fn gitlab_view(full_path: &str, ssh_url: &str, https_url: &str) -> String {
    json(&format!(
        r#"{{"path_with_namespace":"{full_path}","visibility":"private","default_branch":"main","ssh_url_to_repo":"{ssh_url}","http_url_to_repo":"{https_url}"}}"#
    ))
}

fn github_lookup(directory: &FakeCliDirectory) -> RepositoryLookupOutcome {
    directory
        .service()
        .lookup(request("github", "github.com", "acme/storefront-api"))
}

fn gitlab_lookup(directory: &FakeCliDirectory) -> RepositoryLookupOutcome {
    directory.service().lookup(request(
        "gitlab",
        "gitlab.example.com",
        "platform/billing-service",
    ))
}

#[test]
fn the_github_plan_pins_every_call_to_the_public_host() {
    let directory = FakeCliDirectory::create("github-pinned");
    gh(
        &directory,
        &github_view(
            "acme/storefront-api",
            "https://github.com/acme/storefront-api",
        ),
    );

    let outcome = github_lookup(&directory);
    let snapshot = directory.service().hosts();

    assert!(
        matches!(outcome, RepositoryLookupOutcome::Ok { .. }),
        "{outcome:?}"
    );
    let argv = directory.read("gh.argv");
    assert!(
        argv.contains("repo view github.com/acme/storefront-api"),
        "{argv}"
    );
    assert!(argv.contains("auth status --hostname github.com"), "{argv}");
    assert!(matches!(
        snapshot.github,
        RepositoryHostsState::Ready { .. }
    ));
}

#[test]
fn a_github_answer_whose_url_points_at_another_host_is_refused() {
    let directory = FakeCliDirectory::create("github-foreign-url");
    gh(
        &directory,
        &github_view(
            "acme/storefront-api",
            "https://ghes.internal.example/acme/storefront-api",
        ),
    );

    let outcome = github_lookup(&directory);

    assert_eq!(
        outcome,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::InvalidOutput
        }
    );
}

#[test]
fn a_github_answer_under_another_path_is_reported_as_not_found() {
    let directory = FakeCliDirectory::create("github-redirect");
    gh(
        &directory,
        &github_view(
            "acme/storefront-next",
            "https://github.com/acme/storefront-next",
        ),
    );

    assert_eq!(github_lookup(&directory), RepositoryLookupOutcome::NotFound);
}

#[test]
fn a_github_answer_with_server_casing_keeps_the_canonical_path() {
    let directory = FakeCliDirectory::create("github-casing");
    gh(
        &directory,
        &github_view(
            "Acme/Storefront-API",
            "https://github.com/Acme/Storefront-API",
        ),
    );

    let outcome = github_lookup(&directory);

    let RepositoryLookupOutcome::Ok { repository } = outcome else {
        panic!("expected a repository, got {outcome:?}");
    };
    assert_eq!(repository.full_path, "Acme/Storefront-API");
    assert_eq!(repository.visibility, RepositoryVisibility::Public);
}

#[test]
fn a_github_answer_breaking_the_path_grammar_reports_invalid_output() {
    let directory = FakeCliDirectory::create("github-bad-path");
    gh(
        &directory,
        &github_view(
            "acme/team/storefront-api",
            "https://github.com/acme/team/storefront-api",
        ),
    );

    assert_eq!(
        github_lookup(&directory),
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::InvalidOutput
        }
    );
}

#[test]
fn gitlab_clone_urls_pointing_at_another_host_are_dropped() {
    let directory = FakeCliDirectory::create("gitlab-foreign-urls");
    glab(
        &directory,
        &gitlab_view(
            "platform/billing-service",
            "ssh://git@attacker.example.net/platform/billing-service.git",
            "https://attacker.example.net/platform/billing-service.git",
        ),
    );

    let outcome = gitlab_lookup(&directory);

    let RepositoryLookupOutcome::Ok { repository } = outcome else {
        panic!("expected a repository, got {outcome:?}");
    };
    assert_eq!(repository.ssh_url, None);
    assert_eq!(repository.https_url, None);
}

#[test]
fn gitlab_clone_urls_on_the_requested_host_survive_ports_and_casing() {
    let directory = FakeCliDirectory::create("gitlab-pinned-urls");
    glab(
        &directory,
        &gitlab_view(
            "platform/billing-service",
            "ssh://git@gitlab.example.com:2222/platform/billing-service.git",
            "https://GitLab.Example.com/platform/billing-service.git",
        ),
    );

    let outcome = gitlab_lookup(&directory);

    let RepositoryLookupOutcome::Ok { repository } = outcome else {
        panic!("expected a repository, got {outcome:?}");
    };
    assert_eq!(
        repository.ssh_url.as_deref(),
        Some("ssh://git@gitlab.example.com:2222/platform/billing-service.git")
    );
    assert_eq!(
        repository.https_url.as_deref(),
        Some("https://GitLab.Example.com/platform/billing-service.git")
    );
    assert!(repository.is_valid());
}

#[test]
fn a_gitlab_answer_under_another_path_is_reported_as_not_found() {
    let directory = FakeCliDirectory::create("gitlab-redirect");
    glab(
        &directory,
        &gitlab_view(
            "platform/billing-next",
            "ssh://git@gitlab.example.com/platform/billing-next.git",
            "https://gitlab.example.com/platform/billing-next.git",
        ),
    );

    assert_eq!(gitlab_lookup(&directory), RepositoryLookupOutcome::NotFound);
}
