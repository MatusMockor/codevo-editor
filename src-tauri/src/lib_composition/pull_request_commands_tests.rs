use super::super::repository_lookup::{CliProgram, ExecutableResolver, ResolvedExecutable};
use super::pull_request::{ForgeKind, PullRequestReceipt};
use super::*;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;

struct FixedResolver(Option<PathBuf>);

impl ExecutableResolver for FixedResolver {
    fn resolve(&self, _program: CliProgram) -> Option<ResolvedExecutable> {
        self.0.clone().map(|path| ResolvedExecutable {
            path,
            search_path: "/usr/bin:/bin".to_string(),
        })
    }
}

fn git(root: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .expect("git");
    assert!(status.status.success(), "git {arguments:?}");
}

fn scratch(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("pr-command-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("mkdir");
    root.canonicalize().expect("canonical")
}

fn repository_with_remote(label: &str, remote_url: &str) -> PathBuf {
    let root = scratch(label).join("repo");
    fs::create_dir_all(&root).expect("mkdir repo");
    git(&root, &["init", "--initial-branch=main"]);
    git(&root, &["config", "user.name", "Test"]);
    git(&root, &["config", "user.email", "t@example.com"]);
    git(&root, &["commit", "--allow-empty", "-m", "initial"]);
    git(&root, &["checkout", "-b", "feat/keys"]);
    git(&root, &["commit", "--allow-empty", "-m", "feat: keys"]);
    git(&root, &["remote", "add", "origin", remote_url]);
    git(
        &root,
        &["update-ref", "refs/remotes/origin/feat/keys", "HEAD"],
    );
    git(&root, &["update-ref", "refs/remotes/origin/main", "main"]);
    git(&root, &["config", "branch.feat/keys.remote", "origin"]);
    git(
        &root,
        &["config", "branch.feat/keys.merge", "refs/heads/feat/keys"],
    );
    root
}

fn fake_cli(root: &Path, script: &str) -> PathBuf {
    let path = root.parent().expect("scratch").join("fake-forge-cli");
    fs::write(&path, script).expect("write fake cli");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("chmod");
    path
}

fn service(cli: Option<PathBuf>, home: &Path) -> PullRequestService {
    PullRequestService::with_resolver(Arc::new(FixedResolver(cli)), home.to_path_buf())
}

fn create_request(root: &Path, base: &str, title: &str, body: &str) -> CreatePullRequestRequest {
    CreatePullRequestRequest {
        repository_root: root.to_string_lossy().to_string(),
        worktree_path: None,
        base: base.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        draft: false,
    }
}

fn cleanup(root: &Path) {
    let _ = fs::remove_dir_all(root.parent().expect("scratch"));
}

#[test]
fn rejects_unknown_pull_request_fields() {
    let context = serde_json::from_value::<PullRequestContextRequest>(serde_json::json!({
        "repositoryRoot": "/tmp/x",
        "worktreePath": null,
        "base": null,
        "token": "x"
    }));
    let create = serde_json::from_value::<CreatePullRequestRequest>(serde_json::json!({
        "repositoryRoot": "/tmp/x",
        "worktreePath": null,
        "base": "main",
        "title": "T",
        "body": "",
        "draft": false,
        "argv": ["--web"]
    }));
    assert!(context.is_err());
    assert!(create.is_err());
}

#[test]
fn creates_a_pull_request_without_pushing_when_the_branch_is_published() {
    let root = repository_with_remote("ok", "https://github.com/acme/orders-api.git");
    let log = root.parent().expect("scratch").join("argv.log");
    let cli = fake_cli(
        &root,
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nif [ \"$1\" = auth ]; then exit 0; fi\necho \"https://github.com/acme/orders-api/pull/42\"\n",
            log.display()
        ),
    );
    let service = service(Some(cli), &root);

    let receipt =
        create_pull_request_blocking(&service, create_request(&root, "main", "Add keys", "Body"));

    assert_eq!(
        receipt,
        Ok(PullRequestReceipt {
            url: "https://github.com/acme/orders-api/pull/42".to_string(),
            forge: ForgeKind::Github
        })
    );
    let argv = fs::read_to_string(&log).expect("argv log");
    assert_eq!(
        argv.lines().collect::<Vec<_>>(),
        vec![
            "auth",
            "status",
            "--hostname",
            "github.com",
            "pr",
            "create",
            "--repo=github.com/acme/orders-api",
            "--head=feat/keys",
            "--base=main",
            "--title=Add keys",
            "--body=Body",
        ]
    );
    cleanup(&root);
}

#[test]
fn reports_missing_cli_and_unsupported_hosts() {
    let github = repository_with_remote("missing", "https://github.com/acme/orders-api.git");
    let bitbucket =
        repository_with_remote("bitbucket", "https://bitbucket.org/acme/orders-api.git");
    let selfhosted =
        repository_with_remote("selfhosted", "git@git.example.com:acme/orders-api.git");
    let none = service(None, &github);

    let missing = create_pull_request_blocking(&none, create_request(&github, "main", "T", ""));
    let unsupported =
        create_pull_request_blocking(&none, create_request(&bitbucket, "main", "T", ""));
    let unknown = create_pull_request_blocking(&none, create_request(&selfhosted, "main", "T", ""));

    assert!(missing.unwrap_err().starts_with("cliMissing:"));
    assert!(unsupported.unwrap_err().starts_with("unsupportedHost:"));
    assert!(unknown.unwrap_err().starts_with("unsupportedHost:"));
    cleanup(&github);
    cleanup(&bitbucket);
    cleanup(&selfhosted);
}

#[test]
fn reports_an_unauthenticated_cli_before_pushing_or_creating() {
    let root = repository_with_remote("unauth", "https://github.com/acme/orders-api.git");
    git(&root, &["commit", "--allow-empty", "-m", "unpushed"]);
    let cli = fake_cli(
        &root,
        "#!/bin/sh\nif [ \"$1\" = auth ]; then echo 'You are not logged into any GitHub hosts. To log in, run: gh auth login' >&2; exit 1; fi\ntouch \"$HOME/created\"\n",
    );
    let service = service(Some(cli), &root);

    let result = create_pull_request_blocking(&service, create_request(&root, "main", "T", ""));

    assert!(result.unwrap_err().starts_with("authRequired:"));
    assert!(!root.join("created").exists());
    cleanup(&root);
}

#[test]
fn classifies_a_failing_forge_create() {
    let root = repository_with_remote("exists", "https://github.com/acme/orders-api.git");
    let cli = fake_cli(
        &root,
        "#!/bin/sh\nif [ \"$1\" = auth ]; then exit 0; fi\necho 'a pull request for branch \"feat/keys\" into branch \"main\" already exists:' >&2\necho 'https://github.com/acme/orders-api/pull/3' >&2\nexit 1\n",
    );
    let service = service(Some(cli), &root);

    let result = create_pull_request_blocking(&service, create_request(&root, "main", "T", ""));

    assert_eq!(
        result,
        Err("alreadyExists:https://github.com/acme/orders-api/pull/3".to_string())
    );
    cleanup(&root);
}

#[test]
fn rejects_invalid_input_before_running_anything() {
    let root = repository_with_remote("invalid", "https://github.com/acme/orders-api.git");
    let cli = fake_cli(&root, "#!/bin/sh\ntouch \"$HOME/ran\"\n");
    let service = service(Some(cli), &root);
    let huge_body = "b".repeat(70 * 1024);

    let cases = [
        create_request(&root, "--help", "T", ""),
        create_request(&root, "a..b", "T", ""),
        create_request(&root, "main", "a\nb", ""),
        create_request(&root, "main", "   ", ""),
        create_request(&root, "main", "T", &huge_body),
        create_request(&root, "feat/keys", "T", ""),
    ];
    for request in cases {
        let base = request.base.clone();
        let result = create_pull_request_blocking(&service, request);
        assert!(result.unwrap_err().starts_with("invalid:"), "{base}");
    }
    assert!(!root.join("ran").exists());
    cleanup(&root);
}

#[test]
fn describes_the_branch_for_the_form() {
    let root = repository_with_remote("context", "https://github.com/acme/orders-api.git");
    let none = service(None, &root);

    let context = pull_request_context_blocking(
        &none,
        PullRequestContextRequest {
            repository_root: root.to_string_lossy().to_string(),
            worktree_path: None,
            base: None,
        },
    )
    .expect("context");

    assert_eq!(context.head_branch.as_deref(), Some("feat/keys"));
    assert_eq!(context.base.as_deref(), Some("main"));
    assert_eq!(context.commits_ahead, 1);
    assert_eq!(context.files_changed, 0);
    assert_eq!(context.unpushed_commits, 0);
    assert!(context.has_upstream);
    assert_eq!(context.commit_subjects, vec!["feat: keys".to_string()]);
    assert_eq!(context.forge, Some(ForgeKind::Github));
    assert!(!context.cli_available);
    assert_eq!(
        context.compare_url.as_deref(),
        Some("https://github.com/acme/orders-api/compare/main...feat/keys?expand=1")
    );
    cleanup(&root);
}

#[test]
fn refuses_untrusted_pull_request_commands_before_any_process() {
    let root = repository_with_remote("untrusted", "https://github.com/acme/orders-api.git");
    let cli = fake_cli(&root, "#!/bin/sh\ntouch \"$HOME/ran\"\n");
    let app = tauri::test::mock_app();
    app.manage(Arc::new(service(Some(cli), &root)));

    let context = tauri::async_runtime::block_on(get_pull_request_context(
        PullRequestContextRequest {
            repository_root: root.to_string_lossy().to_string(),
            worktree_path: None,
            base: None,
        },
        false,
        app.state(),
    ));
    let create = tauri::async_runtime::block_on(create_pull_request(
        create_request(&root, "main", "T", ""),
        false,
        app.state(),
    ));

    assert!(context.unwrap_err().starts_with("untrusted:"));
    assert!(create.unwrap_err().starts_with("untrusted:"));
    assert!(!root.join("ran").exists());
    cleanup(&root);
}

fn context_for(
    service: &PullRequestService,
    root: &Path,
    base: Option<&str>,
) -> PullRequestContext {
    pull_request_context_blocking(
        service,
        PullRequestContextRequest {
            repository_root: root.to_string_lossy().to_string(),
            worktree_path: None,
            base: base.map(str::to_string),
        },
    )
    .expect("context")
}

fn argv_logging_cli(root: &Path) -> (PathBuf, PathBuf) {
    let log = root.parent().expect("scratch").join("argv.log");
    let cli = fake_cli(
        root,
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nif [ \"$1\" = auth ]; then exit 0; fi\necho \"https://github.com/acme/orders-api/pull/7\"\n",
            log.display()
        ),
    );
    (cli, log)
}

#[test]
fn uses_the_forge_default_branch_name_when_only_the_remote_head_exists() {
    let root = repository_with_remote("remote-head", "https://github.com/acme/orders-api.git");
    git(
        &root,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
    git(&root, &["branch", "-D", "main"]);
    let (cli, log) = argv_logging_cli(&root);
    let service = service(Some(cli), &root);

    let context = context_for(&service, &root, None);
    let receipt =
        create_pull_request_blocking(&service, create_request(&root, "origin/main", "T", ""));

    assert_eq!(context.default_base.as_deref(), Some("main"));
    assert_eq!(context.base.as_deref(), Some("main"));
    assert_eq!(context.commits_ahead, 1);
    assert_eq!(
        context.compare_url.as_deref(),
        Some("https://github.com/acme/orders-api/compare/main...feat/keys?expand=1")
    );
    assert!(receipt.is_ok());
    let argv = fs::read_to_string(&log).expect("argv log");
    assert!(argv.lines().any(|line| line == "--base=main"), "{argv}");
    cleanup(&root);
}

#[test]
fn falls_back_to_a_remote_candidate_branch_without_a_local_default() {
    let root = repository_with_remote("remote-candidate", "https://github.com/acme/orders-api.git");
    git(&root, &["branch", "-D", "main"]);
    let service = service(None, &root);

    let context = context_for(&service, &root, None);
    let requested = context_for(&service, &root, Some("origin/main"));

    assert_eq!(context.default_base.as_deref(), Some("main"));
    assert_eq!(context.base.as_deref(), Some("main"));
    assert_eq!(context.commits_ahead, 1);
    assert_eq!(requested.base.as_deref(), Some("main"));
    cleanup(&root);
}

#[test]
fn refuses_a_remote_qualified_base_that_names_the_current_branch() {
    let root = repository_with_remote("same-remote", "https://github.com/acme/orders-api.git");
    let cli = fake_cli(&root, "#!/bin/sh\ntouch \"$HOME/ran\"\n");
    let service = service(Some(cli), &root);

    let result =
        create_pull_request_blocking(&service, create_request(&root, "origin/feat/keys", "T", ""));

    assert!(result.unwrap_err().starts_with("invalid:"));
    assert!(!root.join("ran").exists());
    cleanup(&root);
}

#[test]
fn reports_an_unreachable_forge_during_the_sign_in_check_as_a_forge_error() {
    let root = repository_with_remote("offline", "https://github.com/acme/orders-api.git");
    let cli = fake_cli(
        &root,
        "#!/bin/sh\nif [ \"$1\" = auth ]; then echo 'error connecting to api.github.com' >&2; echo 'check your internet connection or https://githubstatus.com' >&2; exit 1; fi\ntouch \"$HOME/created\"\n",
    );
    let service = service(Some(cli), &root);

    let result = create_pull_request_blocking(&service, create_request(&root, "main", "T", ""));

    let error = result.unwrap_err();
    assert!(error.starts_with("forgeError:"), "{error}");
    assert!(
        error.contains("error connecting to api.github.com"),
        "{error}"
    );
    assert!(!root.join("created").exists());
    cleanup(&root);
}

fn environment_value(command: &Command, key: &str) -> Option<String> {
    command
        .get_envs()
        .find(|(name, _)| *name == key)
        .and_then(|(_, value)| value)
        .map(|value| value.to_string_lossy().into_owned())
}

#[test]
fn passes_each_forge_cli_only_its_own_credentials() {
    let root = scratch("forge-env");
    let environment: ForgeEnvironment = Arc::new(|key| match key {
        "GH_TOKEN" => Some("gh-secret".into()),
        "GITHUB_TOKEN" => Some("github-secret".into()),
        "GH_HOST" => Some("github.example.com".into()),
        "GH_ENTERPRISE_TOKEN" => Some("ghe-secret".into()),
        "GITLAB_TOKEN" => Some("glab-secret".into()),
        "GLAB_HOST" => Some("gitlab.example.com".into()),
        "GITLAB_HOST" => Some("gitlab.internal.example.com".into()),
        "GITLAB_ACCESS_TOKEN" => Some("gitlab-access-secret".into()),
        "AWS_SECRET_ACCESS_KEY" => Some("aws-secret".into()),
        _ => None,
    });
    let service = PullRequestService::with_environment(
        Arc::new(FixedResolver(Some(PathBuf::from("/usr/bin/true")))),
        root.clone(),
        environment,
    );

    let github = service
        .forge_command(ForgeKind::Github, &["auth".to_string()], &root)
        .expect("forge command");
    let gitlab = service
        .forge_command(ForgeKind::Gitlab, &["auth".to_string()], &root)
        .expect("forge command");

    let github_expected = [
        ("GH_TOKEN", "gh-secret"),
        ("GITHUB_TOKEN", "github-secret"),
        ("GH_HOST", "github.example.com"),
        ("GH_ENTERPRISE_TOKEN", "ghe-secret"),
    ];
    let gitlab_expected = [
        ("GITLAB_TOKEN", "glab-secret"),
        ("GLAB_HOST", "gitlab.example.com"),
        ("GITLAB_HOST", "gitlab.internal.example.com"),
        ("GITLAB_ACCESS_TOKEN", "gitlab-access-secret"),
    ];
    for (key, value) in github_expected {
        assert_eq!(
            environment_value(&github, key).as_deref(),
            Some(value),
            "{key}"
        );
        assert_eq!(environment_value(&gitlab, key), None, "{key}");
    }
    for (key, value) in gitlab_expected {
        assert_eq!(
            environment_value(&gitlab, key).as_deref(),
            Some(value),
            "{key}"
        );
        assert_eq!(environment_value(&github, key), None, "{key}");
    }
    for command in [&github, &gitlab] {
        assert_eq!(environment_value(command, "AWS_SECRET_ACCESS_KEY"), None);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn keeps_forge_credentials_out_of_the_shared_process_plan() {
    let command = plan_command(
        Path::new("/usr/bin/true"),
        &[],
        Path::new("/"),
        "/usr/bin:/bin",
    );

    for key in forge_credential_environment(ForgeKind::Github)
        .iter()
        .chain(forge_credential_environment(ForgeKind::Gitlab))
    {
        assert_eq!(environment_value(&command, key), None, "{key}");
    }
}
