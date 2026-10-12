use super::super::executable_identity_path_with_effective_path;
use super::*;
use crate::agent_mcp_server_login_protocol::{
    McpLoginAnnouncement, McpLoginProviderStep, McpLoginTiming,
};
use crate::agent_mcp_server_manage_domain::{
    AgentMcpServerChange, AgentMcpServerConfigScope, AgentMcpServerLaunch,
};
use crate::agent_mcp_server_manage_protocol::mcp_change_operation;
use serde_json::Value;
use std::{
    env,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    thread,
};

static NONCE: AtomicU64 = AtomicU64::new(0);
const CLAUDE: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
const AUTH_URL: &str =
    "https://auth.example/authorize?state=s&redirect_uri=http%3A%2F%2Flocalhost%3A41001%2Fcallback";
const GENEROUS: Duration = Duration::from_secs(20);
const FAST: McpLoginTiming = McpLoginTiming {
    poll_interval: Duration::from_millis(40),
    deadline: Duration::from_secs(20),
    step_timeout: Duration::from_secs(20),
    sign_out_timeout: Duration::from_secs(10),
    authority_check_interval: Duration::from_millis(250),
};

const RECORD_INVOCATION: &str = r#"
directory=$(dirname "$0")
printf '%s\n' "$@" > "$directory/argv"
printf '%s\n' "$*" >> "$directory/invocations"
env > "$directory/environment"
printf '%s\n' "$PWD" > "$directory/cwd"
printf '%s\n' "$$" > "$directory/pid"
( while :; do echo beat >> "$directory/heartbeat"; sleep 0.05; done ) &
"#;

const CLAUDE_SESSION: &str = r#"
polls=0
reply() {
  printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":%s}}\n' "$id" "$1"
}
refuse() {
  printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"%s"}}\n' "$id" "$1"
}
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$directory/stdin"
  id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"subtype":"initialize"'*) reply '{"commands":[]}';;
    *'"subtype":"mcp_clear_auth"'*) clear;;
    *'"subtype":"mcp_authenticate"'*) authenticate;;
    *'"subtype":"mcp_status"'*) polls=$((polls + 1)); status;;
  esac
done
"#;

const CODEX_SESSION: &str = r#"
case "$1" in
  mcp) plain "$@"; exit $?;;
esac
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$directory/stdin"
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{"userAgent":"codevo_editor"}}\n{"method":"remoteControl/status/changed","params":{"status":"disabled"}}\n';;
    *'"method":"config/read"'*) config;;
    *'"method":"config/batchWrite"'*) printf '{"id":3,"result":{"status":"ok","version":"sha256:0","filePath":"/tmp/config.toml","overriddenMetadata":null}}\n';;
    *'"method":"mcpServer/oauth/login"'*) login;;
  esac
done
"#;

const CLAUDE_CLEAR_OK: &str = "clear() { reply '{}'; }";
const CLAUDE_AWAITING: &str = r#"
authenticate() {
  reply '{"authUrl":"https://auth.example/authorize?state=s&redirect_uri=http%3A%2F%2Flocalhost%3A41001%2Fcallback","requiresUserAction":true,"callbackExpected":true,"redirectScheme":"localhost","state":"s","callbackPort":41001}'
}
"#;
const CLAUDE_CONNECTS_ON_THIRD_POLL: &str = r#"
status() {
  state=needs-auth
  if [ "$polls" -ge 3 ]; then state=connected; fi
  reply "{\"mcpServers\":[{\"name\":\"other\",\"status\":\"connected\"},{\"name\":\"docs\",\"status\":\"$state\"}]}"
}
"#;
const CLAUDE_NEVER_CONNECTS: &str = r#"
status() { reply '{"mcpServers":[{"name":"docs","status":"needs-auth"}]}'; }
"#;
const CODEX_PLAIN_OK: &str = "plain() { echo done; }";
const CODEX_CONFIG_EMPTY: &str = r#"config() { printf '{"id":2,"result":{"config":{"model":null,"mcp_servers":{}},"origins":{}}}\n'; }"#;
const CODEX_LOGIN_AWAITING: &str = r#"
login() {
  printf '{"id":1,"result":{"authorizationUrl":"https://auth.example/authorize?state=s&redirect_uri=http%%3A%%2F%%2Flocalhost%%3A41001%%2Fcallback","loginId":"login-1"}}\n'
  while [ ! -e "$directory/callback" ]; do sleep 0.02; done
  printf '{"method":"mcpServer/oauthLogin/completed","params":{"name":"docs","success":%s,"error":null,"loginId":"login-1"}}\n' "$(cat "$directory/callback")"
}
"#;

#[derive(Default)]
struct Steps(Mutex<Vec<McpLoginAnnouncement>>);

impl McpLoginEvents for Steps {
    fn step_known(&self, step: McpLoginAnnouncement) {
        self.0.lock().expect("steps").push(step);
    }
}

impl Steps {
    fn first(&self) -> Option<McpLoginAnnouncement> {
        self.0.lock().expect("steps").first().cloned()
    }
}

struct Fixture {
    directory: PathBuf,
    workspace: PathBuf,
    cli: PathBuf,
    effective_path: String,
}

impl Fixture {
    fn create(label: &str, name: &str, body: &str) -> Self {
        let directory = env::temp_dir().join(format!(
            "codevo-mcp-manage-plan-{label}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(directory.join("work space")).expect("workspace");
        let directory = directory.canonicalize().expect("canonical directory");
        let cli = directory.join(name);
        fs::write(&cli, format!("#!/bin/sh\n{RECORD_INVOCATION}\n{body}\n")).expect("script");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("executable");
        Self {
            workspace: directory.join("work space"),
            directory,
            cli,
            effective_path: env::var("PATH").expect("test PATH"),
        }
    }

    fn plain(label: &str, name: &str, body: &str) -> Self {
        Self::create(label, name, body)
    }

    fn claude(label: &str, functions: &[&str]) -> Self {
        let body = format!("{}\n{CLAUDE_SESSION}", functions.join("\n"));
        Self::create(label, "claude", &body)
    }

    fn codex(label: &str, functions: &[&str]) -> Self {
        let body = format!("{}\n{CODEX_SESSION}", functions.join("\n"));
        Self::create(label, "codex", &body)
    }

    fn launch(&self, provider: AgentCliInvocation) -> McpManageLaunch<'_> {
        McpManageLaunch {
            identity: executable_identity_path_with_effective_path(&self.cli, &self.effective_path)
                .expect("identity"),
            provider,
            workspace_root: &self.workspace,
            cwd_authority: Arc::new(fs::File::open(&self.workspace).expect("authority")),
            effective_path: &self.effective_path,
        }
    }

    fn change_within(
        &self,
        provider: AgentCliInvocation,
        change: &AgentMcpServerChange,
        timeout: Duration,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), McpChangeFailure> {
        let root = self.workspace.to_str().expect("utf8 workspace");
        let operation = mcp_change_operation(provider, change, root)?;
        execute_mcp_change(&self.launch(provider), operation, timeout, cancelled)
    }

    fn change(
        &self,
        provider: AgentCliInvocation,
        change: &AgentMcpServerChange,
    ) -> Result<(), McpChangeFailure> {
        self.change_within(provider, change, GENEROUS, || false)
    }

    fn login_with(
        &self,
        provider: AgentCliInvocation,
        mode: AgentMcpServerLoginMode,
        timing: McpLoginTiming,
        cancelled: impl Fn() -> bool,
    ) -> (bool, Option<McpLoginAnnouncement>) {
        let steps = Arc::new(Steps::default());
        let login = McpLoginRequest {
            name: "docs".to_string(),
            mode,
            timing,
        };
        let succeeded = execute_mcp_login(
            &self.launch(provider),
            &login,
            Arc::clone(&steps) as _,
            cancelled,
        );
        (succeeded, steps.first())
    }

    fn login(
        &self,
        provider: AgentCliInvocation,
        mode: AgentMcpServerLoginMode,
    ) -> (bool, Option<McpLoginAnnouncement>) {
        self.login_with(provider, mode, FAST, || false)
    }

    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.directory.join(name)).unwrap_or_default()
    }

    fn lines(&self, name: &str) -> Vec<String> {
        self.read(name).lines().map(str::to_string).collect()
    }

    fn stdin_messages(&self) -> Vec<Value> {
        self.lines("stdin")
            .iter()
            .map(|line| serde_json::from_str(line).expect("stdin line is JSON"))
            .collect()
    }

    fn claude_subtypes(&self) -> Vec<String> {
        self.stdin_messages()
            .iter()
            .map(|message| {
                assert_eq!(message["type"], "control_request", "{message}");
                message["request"]["subtype"]
                    .as_str()
                    .expect("subtype")
                    .to_string()
            })
            .collect()
    }

    fn codex_methods(&self) -> Vec<String> {
        self.stdin_messages()
            .iter()
            .map(|message| message["method"].as_str().expect("method").to_string())
            .collect()
    }

    fn assert_process_group_terminated(&self) {
        let pid: libc::pid_t = self.read("pid").trim().parse().expect("provider pid");
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "provider is still alive");
        let beats = self.read("heartbeat").len();
        thread::sleep(Duration::from_millis(300));
        assert_eq!(
            self.read("heartbeat").len(),
            beats,
            "provider process group is still running"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn add_http(name: &str, scope: AgentMcpServerConfigScope) -> AgentMcpServerChange {
    AgentMcpServerChange::Add {
        name: name.to_string(),
        scope,
        launch: AgentMcpServerLaunch::Http {
            url: "https://docs.example/mcp".to_string(),
        },
    }
}

fn remove(name: &str, scope: AgentMcpServerConfigScope) -> AgentMcpServerChange {
    AgentMcpServerChange::Remove {
        name: name.to_string(),
        scope,
    }
}

fn sign_out(name: &str) -> AgentMcpServerChange {
    AgentMcpServerChange::SignOut {
        name: name.to_string(),
    }
}

fn awaiting() -> Option<McpLoginAnnouncement> {
    Some(Ok(McpLoginProviderStep::AwaitingCallback(
        AUTH_URL.to_string(),
    )))
}

#[test]
fn claude_add_runs_a_typed_command_in_the_workspace_without_a_shell() {
    let fixture = Fixture::plain("claude-add", "claude", "echo Added");
    let hostile = [
        "--scope",
        "user",
        "; touch pwned",
        "$(touch pwned)",
        "-e",
        "A=1",
        "--",
        "",
    ];
    let change = AgentMcpServerChange::Add {
        name: "tool".to_string(),
        scope: AgentMcpServerConfigScope::Local,
        launch: AgentMcpServerLaunch::Stdio {
            command: "--version".to_string(),
            args: hostile.iter().map(|arg| (*arg).to_string()).collect(),
        },
    };
    assert_eq!(fixture.change(CLAUDE, &change), Ok(()));
    let expected: Vec<String> = [
        "mcp",
        "add",
        "--scope",
        "local",
        "--transport",
        "stdio",
        "--",
        "tool",
        "--version",
    ]
    .iter()
    .chain(hostile.iter())
    .map(|arg| (*arg).to_string())
    .collect();
    assert_eq!(fixture.lines("argv"), expected);
    assert_eq!(
        fixture.read("cwd").trim(),
        fixture.workspace.to_str().unwrap()
    );
    assert!(!fixture.workspace.join("pwned").exists());
    assert!(!fixture.directory.join("pwned").exists());
    assert!(fixture.lines("environment").contains(&"CI=1".to_string()));
    fixture.assert_process_group_terminated();
}

#[test]
fn claude_add_and_remove_map_exit_failures_to_closed_outcomes() {
    let exists = Fixture::plain(
        "claude-exists",
        "claude",
        "echo \"MCP server $8 already exists in $4 config\" >&2; exit 1",
    );
    assert_eq!(
        exists.change(CLAUDE, &add_http("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::ServerExists)
    );
    assert_eq!(
        exists.lines("argv"),
        [
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "http",
            "--",
            "docs",
            "https://docs.example/mcp"
        ]
    );
    let missing = Fixture::plain(
        "claude-missing",
        "claude",
        "echo \"No MCP server named \\\"$6\\\" in .mcp.json\" >&2; exit 1",
    );
    assert_eq!(
        missing.change(CLAUDE, &remove("docs", AgentMcpServerConfigScope::Project)),
        Err(McpChangeFailure::ServerNotFound)
    );
    assert_eq!(
        missing.lines("argv"),
        ["mcp", "remove", "--scope", "project", "--", "docs"]
    );
    let broken = Fixture::plain("claude-broken", "claude", "echo EACCES >&2; exit 2");
    assert_eq!(
        broken.change(CLAUDE, &add_http("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::Unavailable)
    );
    assert_eq!(
        broken.change(CLAUDE, &remove("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::Unavailable)
    );
    let noisy = Fixture::plain(
        "claude-noisy",
        "claude",
        "head -c 200000 /dev/zero | tr '\\0' x; exit 0",
    );
    assert_eq!(
        noisy.change(CLAUDE, &add_http("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::Unavailable)
    );
}

#[test]
fn a_hanging_change_command_times_out_and_its_process_group_is_reaped() {
    let fixture = Fixture::plain("claude-hang", "claude", "sleep 30");
    let started = Instant::now();
    assert_eq!(
        fixture.change_within(
            CLAUDE,
            &add_http("docs", AgentMcpServerConfigScope::User),
            Duration::from_millis(400),
            || false,
        ),
        Err(McpChangeFailure::TimedOut)
    );
    assert!(started.elapsed() < Duration::from_secs(10));
    fixture.assert_process_group_terminated();
    assert_eq!(AGENT_PROVIDER_MCP_CHANGE_TIMEOUT, Duration::from_secs(20));
}

#[test]
fn a_cancelled_change_is_unavailable_and_its_process_group_is_reaped() {
    let fixture = Fixture::plain("claude-cancel", "claude", "sleep 30");
    let cancelled = AtomicBool::new(false);
    thread::scope(|scope| {
        let worker = scope.spawn(|| {
            fixture.change_within(
                CLAUDE,
                &add_http("docs", AgentMcpServerConfigScope::User),
                GENEROUS,
                || cancelled.load(Ordering::Acquire),
            )
        });
        let deadline = Instant::now() + GENEROUS;
        while fixture.read("pid").is_empty() {
            assert!(Instant::now() < deadline, "provider was not spawned");
            thread::sleep(Duration::from_millis(10));
        }
        cancelled.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap(), Err(McpChangeFailure::Unavailable));
    });
    fixture.assert_process_group_terminated();
}

#[test]
fn codex_remove_and_sign_out_run_plain_commands_and_read_their_outcome() {
    let removed = Fixture::plain(
        "codex-removed",
        "codex",
        "echo \"Removed global MCP server '$4'.\"",
    );
    assert_eq!(
        removed.change(CODEX, &remove("docs", AgentMcpServerConfigScope::User)),
        Ok(())
    );
    assert_eq!(removed.lines("argv"), ["mcp", "remove", "--", "docs"]);
    let missing = Fixture::plain(
        "codex-missing",
        "codex",
        "echo \"No MCP server named '$4' found.\"",
    );
    assert_eq!(
        missing.change(CODEX, &remove("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::ServerNotFound)
    );
    let crashed = Fixture::plain("codex-crashed", "codex", "exit 3");
    assert_eq!(
        crashed.change(CODEX, &remove("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::Unavailable)
    );
    let signed_out = Fixture::plain(
        "codex-logout",
        "codex",
        "echo \"Removed OAuth credentials for '$4'.\"",
    );
    assert_eq!(signed_out.change(CODEX, &sign_out("--config x=1")), Ok(()));
    assert_eq!(
        signed_out.lines("argv"),
        ["mcp", "logout", "--", "--config x=1"]
    );
    let unknown = Fixture::plain(
        "codex-logout-missing",
        "codex",
        "echo 'WARNING: proceeding' >&2; echo \"Error: No MCP server named '$4' found in configuration.\" >&2; exit 1",
    );
    assert_eq!(
        unknown.change(CODEX, &sign_out("docs")),
        Err(McpChangeFailure::ServerNotFound)
    );
    let stdio = Fixture::plain(
        "codex-logout-stdio",
        "codex",
        "echo 'Error: OAuth logout is only supported for streamable_http transports.' >&2; exit 1",
    );
    assert_eq!(
        stdio.change(CODEX, &sign_out("docs")),
        Err(McpChangeFailure::ChangeUnsupported)
    );
}

#[test]
fn claude_sign_out_clears_auth_over_a_control_session() {
    let fixture = Fixture::claude("claude-sign-out", &[CLAUDE_CLEAR_OK]);
    assert_eq!(fixture.change(CLAUDE, &sign_out("claude.ai Docs")), Ok(()));
    assert_eq!(fixture.claude_subtypes(), ["initialize", "mcp_clear_auth"]);
    assert_eq!(
        fixture.stdin_messages()[1]["request"]["serverName"],
        "claude.ai Docs"
    );
    assert_eq!(
        fixture.lines("argv"),
        [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--settings",
            "{\"disableAllHooks\":true}",
            "--no-session-persistence"
        ]
    );
    assert_eq!(
        fixture.read("cwd").trim(),
        fixture.workspace.to_str().unwrap()
    );
    fixture.assert_process_group_terminated();
    let missing = Fixture::claude(
        "claude-sign-out-missing",
        &["clear() { refuse 'Server not found: docs'; }"],
    );
    assert_eq!(
        missing.change(CLAUDE, &sign_out("docs")),
        Err(McpChangeFailure::ServerNotFound)
    );
    let stdio = Fixture::claude(
        "claude-sign-out-stdio",
        &[r#"clear() { refuse 'Cannot clear auth for server type \"stdio\"'; }"#],
    );
    assert_eq!(
        stdio.change(CLAUDE, &sign_out("docs")),
        Err(McpChangeFailure::ChangeUnsupported)
    );
    let silent = Fixture::claude("claude-sign-out-silent", &["clear() { :; }"]);
    assert_eq!(
        silent.change_within(
            CLAUDE,
            &sign_out("docs"),
            Duration::from_millis(500),
            || false
        ),
        Err(McpChangeFailure::TimedOut)
    );
    silent.assert_process_group_terminated();
    let exiting = Fixture::claude("claude-sign-out-exit", &["clear() { exit 0; }"]);
    assert_eq!(
        exiting.change(CLAUDE, &sign_out("docs")),
        Err(McpChangeFailure::Unavailable)
    );
}

#[test]
fn codex_add_writes_the_config_without_running_the_oauth_command() {
    let fixture = Fixture::codex("codex-add", &[CODEX_PLAIN_OK, CODEX_CONFIG_EMPTY]);
    assert_eq!(
        fixture.change(CODEX, &add_http("docs", AgentMcpServerConfigScope::User)),
        Ok(())
    );
    assert_eq!(fixture.lines("invocations"), ["app-server --stdio"]);
    assert_eq!(
        fixture.codex_methods(),
        [
            "initialize",
            "initialized",
            "config/read",
            "config/batchWrite"
        ]
    );
    let messages = fixture.stdin_messages();
    assert_eq!(
        messages[2]["params"]["cwd"],
        fixture.workspace.to_str().unwrap()
    );
    assert_eq!(
        messages[3]["params"],
        serde_json::json!({
            "edits": [{
                "keyPath": "mcp_servers.docs",
                "mergeStrategy": "replace",
                "value": { "url": "https://docs.example/mcp" },
            }],
        })
    );
    fixture.assert_process_group_terminated();
}

#[test]
fn codex_add_refuses_a_configured_name_before_writing() {
    let existing = Fixture::codex(
        "codex-add-exists",
        &[
            CODEX_PLAIN_OK,
            r#"config() { printf '{"id":2,"result":{"config":{"mcp_servers":{"docs":{"url":"https://old.example/mcp","enabled":true}}}}}\n'; }"#,
        ],
    );
    assert_eq!(
        existing.change(CODEX, &add_http("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::ServerExists)
    );
    assert_eq!(
        existing.codex_methods(),
        ["initialize", "initialized", "config/read"]
    );
    let unreadable = Fixture::codex(
        "codex-add-unreadable",
        &[
            CODEX_PLAIN_OK,
            r#"config() { printf '{"id":2,"error":{"code":-32600,"message":"unsupported"}}\n'; }"#,
        ],
    );
    assert_eq!(
        unreadable.change(CODEX, &add_http("docs", AgentMcpServerConfigScope::User)),
        Err(McpChangeFailure::Unavailable)
    );
    assert!(!unreadable
        .codex_methods()
        .contains(&"config/batchWrite".to_string()));
    let silent = Fixture::codex("codex-add-silent", &[CODEX_PLAIN_OK, "config() { :; }"]);
    assert_eq!(
        silent.change_within(
            CODEX,
            &add_http("docs", AgentMcpServerConfigScope::User),
            Duration::from_millis(500),
            || false
        ),
        Err(McpChangeFailure::TimedOut)
    );
    silent.assert_process_group_terminated();
}

#[test]
fn claude_login_waits_for_the_callback_by_polling_until_connected() {
    let fixture = Fixture::claude(
        "claude-login",
        &[
            CLAUDE_CLEAR_OK,
            CLAUDE_AWAITING,
            CLAUDE_CONNECTS_ON_THIRD_POLL,
        ],
    );
    let (succeeded, step) = fixture.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
    assert!(succeeded);
    assert_eq!(step, awaiting());
    assert_eq!(
        fixture.claude_subtypes(),
        [
            "initialize",
            "mcp_authenticate",
            "mcp_status",
            "mcp_status",
            "mcp_status"
        ]
    );
    assert_eq!(fixture.stdin_messages()[1]["request"]["serverName"], "docs");
    fixture.assert_process_group_terminated();
}

#[test]
fn claude_sign_in_again_clears_credentials_before_authenticating() {
    let fixture = Fixture::claude(
        "claude-login-again",
        &[
            CLAUDE_CLEAR_OK,
            CLAUDE_AWAITING,
            CLAUDE_CONNECTS_ON_THIRD_POLL,
        ],
    );
    let (succeeded, step) = fixture.login(CLAUDE, AgentMcpServerLoginMode::SignInAgain);
    assert!(succeeded);
    assert_eq!(step, awaiting());
    assert_eq!(
        fixture.claude_subtypes()[..3],
        ["initialize", "mcp_clear_auth", "mcp_authenticate"]
    );
}

#[test]
fn claude_login_ends_the_session_at_once_when_no_callback_is_expected() {
    let browser = Fixture::claude(
        "claude-login-browser",
        &[
            r#"authenticate() { reply '{"authUrl":"https://claude.ai/connect/docs","requiresUserAction":true,"callbackExpected":false}'; }"#,
        ],
    );
    let started = Instant::now();
    let (succeeded, step) = browser.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
    assert!(!succeeded);
    assert_eq!(
        step,
        Some(Ok(McpLoginProviderStep::FinishInBrowser(
            "https://claude.ai/connect/docs".to_string()
        )))
    );
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(
        browser.claude_subtypes(),
        ["initialize", "mcp_authenticate"]
    );
    browser.assert_process_group_terminated();
    let completed = Fixture::claude(
        "claude-login-completed",
        &[r#"authenticate() { reply '{"requiresUserAction":false,"callbackExpected":false}'; }"#],
    );
    let (_, step) = completed.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
    assert_eq!(step, Some(Ok(McpLoginProviderStep::Completed)));
    assert_eq!(
        completed.claude_subtypes(),
        ["initialize", "mcp_authenticate"]
    );
    completed.assert_process_group_terminated();
}

#[test]
fn claude_login_maps_control_errors_and_rejects_invalid_authorization_urls() {
    for (label, function, failure) in [
        (
            "unsupported",
            r#"authenticate() { refuse 'Server type \"stdio\" does not support OAuth authentication'; }"#,
            McpLoginFailure::LoginUnsupported,
        ),
        (
            "missing",
            "authenticate() { refuse 'Server not found: docs'; }",
            McpLoginFailure::ServerNotFound,
        ),
        (
            "refused",
            "authenticate() { refuse 'SDK auth failed: ENOTFOUND'; }",
            McpLoginFailure::Unavailable,
        ),
        (
            "plain-http",
            r#"authenticate() { reply '{"authUrl":"http://auth.example/authorize","requiresUserAction":true,"callbackExpected":true}'; }"#,
            McpLoginFailure::Unavailable,
        ),
        (
            "script-url",
            r#"authenticate() { reply '{"authUrl":"javascript:alert(1)","requiresUserAction":true,"callbackExpected":false}'; }"#,
            McpLoginFailure::Unavailable,
        ),
    ] {
        let fixture = Fixture::claude(&format!("claude-login-{label}"), &[function]);
        let (succeeded, step) = fixture.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
        assert!(!succeeded, "{label}");
        assert_eq!(step, Some(Err(failure)), "{label}");
        assert_eq!(
            fixture.claude_subtypes(),
            ["initialize", "mcp_authenticate"]
        );
        fixture.assert_process_group_terminated();
    }
}

#[test]
fn a_login_that_outlives_its_deadline_fails_and_is_reaped() {
    let pending = Fixture::claude(
        "claude-login-deadline",
        &[CLAUDE_AWAITING, CLAUDE_NEVER_CONNECTS],
    );
    let timing = McpLoginTiming {
        deadline: Duration::from_millis(900),
        ..FAST
    };
    let started = Instant::now();
    let (succeeded, step) =
        pending.login_with(CLAUDE, AgentMcpServerLoginMode::SignIn, timing, || false);
    assert!(!succeeded);
    assert_eq!(step, awaiting());
    assert!(started.elapsed() >= Duration::from_millis(900));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(pending.claude_subtypes().len() > 3);
    pending.assert_process_group_terminated();
    let silent = Fixture::claude("claude-login-silent", &["authenticate() { :; }"]);
    let (succeeded, step) =
        silent.login_with(CLAUDE, AgentMcpServerLoginMode::SignIn, timing, || false);
    assert!(!succeeded);
    assert_eq!(step, Some(Err(McpLoginFailure::TimedOut)));
    silent.assert_process_group_terminated();
}

#[test]
fn a_cancelled_login_fails_and_its_process_group_is_reaped() {
    let fixture = Fixture::claude(
        "claude-login-cancel",
        &[CLAUDE_AWAITING, CLAUDE_NEVER_CONNECTS],
    );
    let cancelled = AtomicBool::new(false);
    thread::scope(|scope| {
        let worker = scope.spawn(|| {
            fixture.login_with(CLAUDE, AgentMcpServerLoginMode::SignIn, FAST, || {
                cancelled.load(Ordering::Acquire)
            })
        });
        let deadline = Instant::now() + GENEROUS;
        while !fixture.read("stdin").contains("mcp_status") {
            assert!(Instant::now() < deadline, "login never started polling");
            thread::sleep(Duration::from_millis(10));
        }
        let started = Instant::now();
        cancelled.store(true, Ordering::Release);
        let (succeeded, step) = worker.join().unwrap();
        assert!(!succeeded);
        assert_eq!(step, awaiting());
        assert!(started.elapsed() < Duration::from_secs(5));
    });
    fixture.assert_process_group_terminated();
}

#[test]
fn a_provider_that_exits_before_answering_fails_the_login() {
    let fixture = Fixture::claude("claude-login-exit", &["authenticate() { exit 0; }"]);
    let (succeeded, step) = fixture.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
    assert!(!succeeded);
    assert_eq!(step, Some(Err(McpLoginFailure::Unavailable)));
    let codex = Fixture::plain("codex-login-exit", "codex", "exit 0");
    let (succeeded, step) = codex.login(CODEX, AgentMcpServerLoginMode::SignIn);
    assert!(!succeeded);
    assert_eq!(step, Some(Err(McpLoginFailure::Unavailable)));
}

fn codex_login_outcome(
    label: &str,
    success: &str,
) -> (Fixture, bool, Option<McpLoginAnnouncement>) {
    let fixture = Fixture::codex(label, &[CODEX_PLAIN_OK, CODEX_LOGIN_AWAITING]);
    fs::write(fixture.directory.join("callback"), success).expect("callback");
    let (succeeded, step) = fixture.login(CODEX, AgentMcpServerLoginMode::SignIn);
    (fixture, succeeded, step)
}

#[test]
fn codex_login_follows_the_completion_notification() {
    let (fixture, succeeded, step) = codex_login_outcome("codex-login-ok", "true");
    assert!(succeeded);
    assert_eq!(step, awaiting());
    assert_eq!(fixture.lines("invocations"), ["app-server --stdio"]);
    assert_eq!(
        fixture.codex_methods(),
        ["initialize", "initialized", "mcpServer/oauth/login"]
    );
    assert_eq!(
        fixture.stdin_messages()[2]["params"],
        serde_json::json!({ "name": "docs", "timeoutSecs": 300 })
    );
    fixture.assert_process_group_terminated();
    let (failed, succeeded, step) = codex_login_outcome("codex-login-denied", "false");
    assert!(!succeeded);
    assert_eq!(step, awaiting());
    failed.assert_process_group_terminated();
}

#[test]
fn codex_sign_in_again_logs_out_first_and_tolerates_a_logout_failure() {
    let fixture = Fixture::codex(
        "codex-login-again",
        &[
            "plain() { echo 'Error: keyring is locked' >&2; return 1; }",
            CODEX_LOGIN_AWAITING,
        ],
    );
    fs::write(fixture.directory.join("callback"), "true").expect("callback");
    let (succeeded, step) = fixture.login(CODEX, AgentMcpServerLoginMode::SignInAgain);
    assert!(succeeded);
    assert_eq!(step, awaiting());
    assert_eq!(
        fixture.lines("invocations"),
        ["mcp logout -- docs", "app-server --stdio"]
    );
}

#[test]
fn codex_login_maps_request_errors_and_rejects_invalid_authorization_urls() {
    for (label, function, failure) in [
        (
            "missing",
            r#"login() { printf '{"id":1,"error":{"code":-32600,"message":"No MCP server named '"'"'docs'"'"' found."}}\n'; }"#,
            McpLoginFailure::ServerNotFound,
        ),
        (
            "stdio",
            r#"login() { printf '{"id":1,"error":{"code":-32600,"message":"OAuth login is only supported for streamable HTTP servers."}}\n'; }"#,
            McpLoginFailure::LoginUnsupported,
        ),
        (
            "discovery",
            r#"login() { printf '{"id":1,"error":{"code":-32603,"message":"failed to login to MCP server"}}\n'; }"#,
            McpLoginFailure::Unavailable,
        ),
        (
            "plain-http",
            r#"login() { printf '{"id":1,"result":{"authorizationUrl":"http://auth.example/authorize","loginId":"l"}}\n'; }"#,
            McpLoginFailure::Unavailable,
        ),
    ] {
        let fixture = Fixture::codex(&format!("codex-login-{label}"), &[CODEX_PLAIN_OK, function]);
        let (succeeded, step) = fixture.login(CODEX, AgentMcpServerLoginMode::SignIn);
        assert!(!succeeded, "{label}");
        assert_eq!(step, Some(Err(failure)), "{label}");
        fixture.assert_process_group_terminated();
    }
}

const CODEX_STOPS_READING_AFTER_CONFIG: &str = r#"
config() {
  printf '{"id":2,"result":{"config":{"mcp_servers":{}},"origins":{}}}\n'
  : > "$directory/stalled"
  sleep 30
}
"#;

fn largest_stdio_add() -> AgentMcpServerChange {
    AgentMcpServerChange::Add {
        name: "docs".to_string(),
        scope: AgentMcpServerConfigScope::User,
        launch: AgentMcpServerLaunch::Stdio {
            command: "\\".repeat(1024),
            args: vec!["\\".repeat(1024); 32],
        },
    }
}

#[test]
fn a_provider_that_stops_reading_a_large_request_cannot_block_the_deadline() {
    let fixture = Fixture::codex(
        "codex-add-stalled",
        &[CODEX_PLAIN_OK, CODEX_STOPS_READING_AFTER_CONFIG],
    );
    let change = largest_stdio_add();
    let root = fixture.workspace.to_str().expect("utf8 workspace");
    let Ok(McpChangeOperation::Exchange(mut exchange)) = mcp_change_operation(CODEX, &change, root)
    else {
        panic!("expected an exchange");
    };
    exchange.observe(b"{\"id\":0,\"result\":{}}\n");
    let _ = exchange.step();
    exchange.observe(b"{\"id\":2,\"result\":{\"config\":{}}}\n");
    let McpProbeStep::Write(request) = exchange.step() else {
        panic!("expected the write request");
    };
    assert!(request.len() > 64 * 1024, "{}", request.len());
    let started = Instant::now();
    assert_eq!(
        fixture.change_within(CODEX, &change, Duration::from_millis(1_500), || false),
        Err(McpChangeFailure::TimedOut)
    );
    assert!(started.elapsed() >= Duration::from_millis(1_500));
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(fixture.directory.join("stalled").exists());
    assert!(!fixture
        .codex_methods()
        .contains(&"config/batchWrite".to_string()));
    fixture.assert_process_group_terminated();
}

#[test]
fn a_stalled_large_request_is_abandoned_at_once_when_cancelled() {
    let fixture = Fixture::codex(
        "codex-add-stalled-cancel",
        &[CODEX_PLAIN_OK, CODEX_STOPS_READING_AFTER_CONFIG],
    );
    let cancelled = AtomicBool::new(false);
    thread::scope(|scope| {
        let worker = scope.spawn(|| {
            fixture.change_within(CODEX, &largest_stdio_add(), GENEROUS, || {
                cancelled.load(Ordering::Acquire)
            })
        });
        let deadline = Instant::now() + GENEROUS;
        while !fixture.directory.join("stalled").exists() {
            assert!(Instant::now() < deadline, "provider never stalled");
            thread::sleep(Duration::from_millis(10));
        }
        thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        cancelled.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap(), Err(McpChangeFailure::Unavailable));
        assert!(started.elapsed() < Duration::from_secs(5));
    });
    fixture.assert_process_group_terminated();
}

#[test]
fn a_large_request_is_delivered_in_full_to_a_provider_that_keeps_reading() {
    let fixture = Fixture::codex("codex-add-large", &[CODEX_PLAIN_OK, CODEX_CONFIG_EMPTY]);
    assert_eq!(fixture.change(CODEX, &largest_stdio_add()), Ok(()));
    let messages = fixture.stdin_messages();
    let value = &messages[3]["params"]["edits"][0]["value"];
    assert_eq!(value["command"], "\\".repeat(1024));
    assert_eq!(value["args"].as_array().map(Vec::len), Some(32));
    assert_eq!(value["args"][31], "\\".repeat(1024));
}

const CLAUDE_FAILS_BEFORE_CONNECTING: &str = r#"
status() {
  case "$polls" in
    1) state=needs-auth;;
    2|3) state=failed;;
    4) state=pending;;
    5) state=failed;;
    *) state=connected;;
  esac
  reply "{\"mcpServers\":[{\"name\":\"docs\",\"status\":\"$state\"}]}"
}
"#;

#[test]
fn claude_login_keeps_the_listener_alive_through_failed_statuses() {
    let fixture = Fixture::claude(
        "claude-login-failed-then-connected",
        &[CLAUDE_AWAITING, CLAUDE_FAILS_BEFORE_CONNECTING],
    );
    let (succeeded, step) = fixture.login(CLAUDE, AgentMcpServerLoginMode::SignIn);
    assert!(succeeded);
    assert_eq!(step, awaiting());
    let polls = fixture
        .claude_subtypes()
        .iter()
        .filter(|subtype| *subtype == "mcp_status")
        .count();
    assert_eq!(polls, 6);
}

const CODEX_COMPLETES_WHEN_ARMED: &str = r#"
login() {
  while [ ! -e "$directory/armed" ]; do sleep 0.01; done
  printf '{"id":1,"result":{"authorizationUrl":"https://auth.example/authorize?state=s&redirect_uri=http%%3A%%2F%%2Flocalhost%%3A41001%%2Fcallback","loginId":"login-1"}}\n'
  printf '{"method":"mcpServer/oauthLogin/completed","params":{"name":"docs","success":true,"error":null,"loginId":"login-1"}}\n'
  : > "$directory/completed"
}
"#;

#[test]
fn a_completion_observed_while_the_owner_cancels_is_not_a_success() {
    let fixture = Fixture::codex(
        "codex-login-cancel-race",
        &[CODEX_PLAIN_OK, CODEX_COMPLETES_WHEN_ARMED],
    );
    let revoke_after_completion = || {
        if !fixture.read("stdin").contains("mcpServer/oauth/login") {
            return false;
        }
        fs::write(fixture.directory.join("armed"), b"").expect("armed");
        let deadline = Instant::now() + GENEROUS;
        while !fixture.directory.join("completed").exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        thread::sleep(Duration::from_millis(150));
        true
    };
    let (succeeded, step) = fixture.login_with(
        CODEX,
        AgentMcpServerLoginMode::SignIn,
        FAST,
        revoke_after_completion,
    );
    assert_eq!(step, awaiting());
    assert!(!succeeded);
    fixture.assert_process_group_terminated();
}
