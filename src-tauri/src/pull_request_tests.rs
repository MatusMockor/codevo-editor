use super::*;

fn github() -> HostedRepository {
    hosted_repository("github.com", "acme", "orders-api").expect("github host")
}

#[test]
fn detects_supported_forges_only() {
    assert_eq!(github().forge, ForgeKind::Github);
    assert_eq!(
        hosted_repository("gitlab.com", "acme", "api").map(|repo| repo.forge),
        Some(ForgeKind::Gitlab)
    );
    assert!(hosted_repository("bitbucket.org", "acme", "api").is_none());
    assert!(hosted_repository("git.example.com", "acme", "api").is_none());
}

#[test]
fn validates_title_and_body() {
    assert_eq!(
        validate_pull_request("  Add keys  ", "## Why\n\tbecause", false).map(|pr| pr.title),
        Ok("Add keys".to_string())
    );
    assert!(validate_pull_request("   ", "", false).is_err());
    assert!(validate_pull_request("line\nbreak", "", false).is_err());
    assert!(validate_pull_request(&"t".repeat(257), "", false).is_err());
    assert!(validate_pull_request("ok", "nul\u{0}byte", false).is_err());
    assert!(validate_pull_request("ok", &"b".repeat(65_537), false).is_err());
    assert!(validate_pull_request("ok", &"b".repeat(70 * 1024), false).is_err());
    assert!(validate_pull_request("ok", "bidi \u{202e} override", false).is_err());
}

#[test]
fn plans_a_closed_github_argv_with_equals_form_values() {
    let request = validate_pull_request("-rf title", "--body text", true).expect("valid");
    let argv = pull_request_argv(&github(), "feat/keys", "main", &request);
    assert_eq!(
        argv,
        vec![
            "pr",
            "create",
            "--repo=github.com/acme/orders-api",
            "--head=feat/keys",
            "--base=main",
            "--title=-rf title",
            "--body=--body text",
            "--draft",
        ]
    );
}

#[test]
fn plans_a_gitlab_merge_request() {
    let repository = hosted_repository("gitlab.com", "acme", "api").expect("gitlab");
    let request = validate_pull_request("Title", "Body", false).expect("valid");
    assert_eq!(
        pull_request_argv(&repository, "feat/x", "main", &request),
        vec![
            "mr",
            "create",
            "--repo=https://gitlab.com/acme/api",
            "--source-branch=feat/x",
            "--target-branch=main",
            "--title=Title",
            "--description=Body",
            "--yes",
        ]
    );
}

#[test]
fn finds_the_created_url_on_the_forge_host_only() {
    let stdout =
        "Creating pull request\nhttps://evil.example/x\nhttps://github.com/acme/orders-api/pull/12\n";
    assert_eq!(
        created_url(stdout, "github.com"),
        Some("https://github.com/acme/orders-api/pull/12".to_string())
    );
    assert_eq!(created_url("done\n", "github.com"), None);
    assert_eq!(
        created_url(
            "https://github.com.evil.example/acme/x/pull/1\n",
            "github.com"
        ),
        None
    );
}

#[test]
fn classifies_forge_failures() {
    let existing = "a pull request for branch \"feat\" into branch \"main\" already exists:\nhttps://github.com/acme/orders-api/pull/3\n";
    assert_eq!(
        classify_forge_failure(existing, "github.com").into_error_string(),
        "alreadyExists:https://github.com/acme/orders-api/pull/3"
    );
    assert!(classify_forge_failure(
        "To get started with GitHub CLI, please run:  gh auth login",
        "github.com"
    )
    .into_error_string()
    .starts_with("authRequired:"));
    assert!(
        classify_forge_failure("GraphQL: Base ref must be a branch", "github.com")
            .into_error_string()
            .starts_with("forgeError:")
    );
}

#[test]
fn clips_long_failure_messages_on_a_char_boundary() {
    let message = format!("{}é", "a".repeat(MAX_PULL_REQUEST_MESSAGE_BYTES - 1));
    let error = PullRequestFailure::ForgeError(message).into_error_string();
    assert_eq!(
        error.len(),
        "forgeError:".len() + MAX_PULL_REQUEST_MESSAGE_BYTES - 1
    );
}

#[test]
fn strips_only_the_named_remote_prefix() {
    assert_eq!(strip_remote_prefix("origin/main", "origin"), Some("main"));
    assert_eq!(
        strip_remote_prefix("origin/feat/x", "origin"),
        Some("feat/x")
    );
    assert_eq!(strip_remote_prefix("origin/", "origin"), None);
    assert_eq!(strip_remote_prefix("originx/main", "origin"), None);
    assert_eq!(strip_remote_prefix("upstream/main", "origin"), None);
    assert_eq!(strip_remote_prefix("main", "origin"), None);
}
