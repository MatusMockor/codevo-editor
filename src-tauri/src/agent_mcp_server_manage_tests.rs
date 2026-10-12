use super::*;
use crate::agent_mcp_server_manage_domain::{
    AgentMcpServerConfigScope, AgentMcpServerLoginMode, AgentMcpServerLoginState,
    AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR, AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR,
    AGENT_MCP_SERVER_NOT_FOUND_ERROR,
};
use crate::agent_mcp_servers_domain::{
    AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR, AGENT_MCP_SERVERS_TIMED_OUT_ERROR,
    AGENT_MCP_SERVERS_UNAVAILABLE_ERROR, AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR,
    AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR,
};
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
use crate::workspace_registry::ManagedWorkspaceDescriptor;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::AtomicU64,
};

const CLAUDE: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
const AUTH_URL: &str = "https://auth.example/authorize?state=s";
const WAIT: Duration = Duration::from_secs(30);
const FAST: McpLoginTiming = McpLoginTiming {
    poll_interval: Duration::from_millis(40),
    deadline: Duration::from_secs(30),
    step_timeout: Duration::from_secs(30),
    sign_out_timeout: Duration::from_secs(10),
    authority_check_interval: Duration::from_millis(250),
};
const CHANGE_TIMEOUT: Duration = Duration::from_secs(30);
static NONCE: AtomicU64 = AtomicU64::new(0);

const RECORD_INVOCATION: &str = r#"
directory=$(dirname "$0")
echo "$*" >> "$directory/invocations"
echo "$$" >> "$directory/pids"
printf '%s\n' "$PWD" > "$directory/cwd"
( while :; do echo beat >> "$directory/heartbeat"; sleep 0.05; done ) &
"#;

const CODEX_BODY: &str = r#"
case "$1" in
  mcp) plain "$@"; exit $?;;
esac
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"config/read"'*) config;;
    *'"method":"mcpServer/oauth/login"'*) login;;
  esac
done
"#;

const CLAUDE_BODY: &str = r#"
reply() {
  printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":%s}}\n' "$id" "$1"
}
refuse() {
  printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"%s"}}\n' "$id" "$1"
}
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"subtype":"initialize"'*) reply '{}';;
    *'"subtype":"mcp_authenticate"'*) authenticate;;
  esac
done
"#;

const PLAIN_REMOVED: &str = r#"
plain() {
  while [ ! -e "$directory/release" ]; do sleep 0.02; done
  if [ "$4" = missing ]; then echo "No MCP server named '$4' found."; return 0; fi
  echo "Removed global MCP server '$4'."
}
"#;

const LOGIN_AWAITING: &str = r#"
login() {
  printf '{"id":1,"result":{"authorizationUrl":"https://auth.example/authorize?state=s","loginId":"login-1"}}\n'
  while [ ! -e "$directory/callback" ]; do sleep 0.02; done
  printf '{"method":"mcpServer/oauthLogin/completed","params":{"name":"docs","success":%s,"error":null,"loginId":"login-1"}}\n' "$(cat "$directory/callback")"
}
"#;

struct Fixture {
    directory: PathBuf,
    workspace: PathBuf,
    registry: Arc<WorkspaceRegistry>,
    trust: Arc<Mutex<WorkspaceTrustService>>,
    providers: Arc<AgentProviderRuntimeRegistry>,
    logins: AgentMcpLoginRegistry,
    cli: PathBuf,
    provider: AgentCliInvocation,
}

impl Fixture {
    fn create(label: &str, provider: AgentCliInvocation, functions: &[&str]) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codevo-mcp-manage-{label}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let workspace = directory.join("workspace");
        fs::create_dir_all(workspace.join("packages/app")).expect("workspace");
        let workspace = workspace.canonicalize().expect("canonical workspace");
        let (name, body) = match provider {
            AgentCliInvocation::ClaudeCode => ("claude", CLAUDE_BODY),
            AgentCliInvocation::CodexExec => ("codex", CODEX_BODY),
        };
        let cli = directory.join(name);
        let script = format!(
            "#!/bin/sh\n{RECORD_INVOCATION}\n{}\n{body}\n",
            functions.join("\n")
        );
        fs::write(&cli, script).expect("script");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("executable");
        let trust = WorkspaceTrustService::load(directory.join("trust.json")).expect("trust");
        Self {
            directory,
            workspace,
            registry: Arc::new(WorkspaceRegistry::new()),
            trust: Arc::new(Mutex::new(trust)),
            providers: Arc::new(AgentProviderRuntimeRegistry::new()),
            logins: AgentMcpLoginRegistry::default(),
            cli,
            provider,
        }
    }

    fn ready(label: &str, provider: AgentCliInvocation, functions: &[&str]) -> Self {
        let fixture = Self::create(label, provider, functions);
        fixture.register();
        fixture.set_trust(true);
        fixture.enable();
        fixture
    }

    fn register(&self) -> ManagedWorkspaceDescriptor {
        self.registry
            .register(&self.workspace)
            .expect("register workspace")
    }

    fn set_trust(&self, trusted: bool) {
        self.trust
            .lock()
            .unwrap()
            .set(self.workspace.to_str().expect("utf8 root"), trusted)
            .expect("update trust");
    }

    fn enable(&self) -> u64 {
        self.register_policy(1, None, true)
    }

    fn register_policy(&self, revision: u64, expected: Option<u64>, enabled: bool) -> u64 {
        self.providers
            .register_policy(
                self.provider,
                revision,
                expected,
                AgentProviderPolicy {
                    enabled,
                    cli_path: Some(self.cli.to_string_lossy().into_owned()),
                    check_for_updates: false,
                    codex_transport: Default::default(),
                    codex_app_server_args: Vec::new(),
                },
            )
            .expect("register provider policy")
            .provider_generation
    }

    fn capture(&self, root: &Path) -> Result<WorkspaceMcpServersAuthority, String> {
        WorkspaceMcpServersAuthority::capture(
            &self.registry,
            &self.trust,
            root.to_str().expect("utf8 root"),
        )
    }

    fn change_within(
        &self,
        root: &Path,
        change: &AgentMcpServerChange,
        timeout: Duration,
    ) -> Result<(WorkspaceMcpServersAuthority, u64), String> {
        let authority = self.capture(root)?;
        let generation = apply_change(
            &self.providers,
            &self.registry,
            &self.trust,
            &authority,
            self.provider,
            change,
            timeout,
        )?;
        Ok((authority, generation))
    }

    fn confirm_change(
        &self,
        authority: &WorkspaceMcpServersAuthority,
        generation: u64,
    ) -> Result<(), String> {
        confirm_publication(
            &self.providers,
            &self.registry,
            &self.trust,
            authority,
            self.provider,
            generation,
        )
    }

    fn change_in(&self, root: &Path, change: &AgentMcpServerChange) -> Result<(), String> {
        let (authority, generation) = self.change_within(root, change, CHANGE_TIMEOUT)?;
        self.confirm_change(&authority, generation)
    }

    fn change(&self, change: &AgentMcpServerChange) -> Result<(), String> {
        self.change_in(&self.workspace, change)
    }

    fn start_worker(
        &self,
        mode: AgentMcpServerLoginMode,
        timing: McpLoginTiming,
    ) -> Result<StartedLogin, String> {
        let authority = self.capture(&self.workspace)?;
        let registry = Arc::clone(&self.registry);
        let trust = Arc::clone(&self.trust);
        let context = LoginStart {
            providers: &self.providers,
            registry: &self.registry,
            trust: &self.trust,
            logins: &self.logins,
            workspace_is_current: Arc::new(move |authority: &WorkspaceMcpServersAuthority| {
                authority.revalidate_registration(&registry, &trust)
            }),
        };
        let login = McpLoginRequest {
            name: "docs".to_string(),
            mode,
            timing,
        };
        start_login(&context, authority, self.provider, login)
    }

    fn confirm_login(&self, started: &StartedLogin) -> Result<(), String> {
        started.confirm(&self.providers, &self.registry, &self.trust)
    }

    fn start_with(
        &self,
        mode: AgentMcpServerLoginMode,
        timing: McpLoginTiming,
    ) -> Result<AgentMcpServerLoginStep, String> {
        let started = self.start_worker(mode, timing)?;
        if let Err(error) = self.confirm_login(&started) {
            started.reap(&self.logins);
            return Err(error);
        }
        Ok(started.step)
    }

    fn start(&self) -> Result<AgentMcpServerLoginStep, String> {
        self.start_with(AgentMcpServerLoginMode::SignIn, FAST)
    }

    fn start_pending(&self) -> String {
        match self.start().expect("login step") {
            AgentMcpServerLoginStep::AwaitingCallback {
                login_id,
                authorization_url,
                delivery,
            } => {
                assert_eq!(authorization_url, AUTH_URL);
                assert_eq!(delivery, AgentMcpServerLoginDelivery::Automatic);
                login_id
            }
            step => panic!("unexpected step {step:?}"),
        }
    }

    fn mark(&self, name: &str, content: &str) {
        let staged = self.directory.join(format!("{name}.staged"));
        fs::write(&staged, content).expect("marker");
        fs::rename(staged, self.directory.join(name)).expect("publish marker");
    }

    fn lines(&self, name: &str) -> Vec<String> {
        fs::read_to_string(self.directory.join(name))
            .map(|content| content.lines().map(str::to_string).collect())
            .unwrap_or_default()
    }

    fn wait_for_invocations(&self, expected: usize) {
        let deadline = Instant::now() + WAIT;
        while self.lines("invocations").len() < expected {
            assert!(Instant::now() < deadline, "provider was not spawned");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_state(&self, login_id: &str, expected: AgentMcpServerLoginState) {
        let deadline = Instant::now() + WAIT;
        while self.logins.state(login_id) != Ok(expected) {
            assert!(Instant::now() < deadline, "login never became {expected:?}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_recorded_state(&self, login_id: &str, expected: AgentMcpServerLoginState) {
        let deadline = Instant::now() + WAIT;
        while self.logins.state_without_owner_check(login_id) != Ok(expected) {
            assert!(Instant::now() < deadline, "login never became {expected:?}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn is_alive(&self, invocation: usize) -> bool {
        let pid: libc::pid_t = self.lines("pids")[invocation].parse().expect("pid");
        unsafe { libc::kill(pid, 0) == 0 }
    }

    fn assert_no_provider_is_running(&self) {
        let pids = self.lines("pids");
        assert!(
            (0..pids.len()).all(|invocation| !self.is_alive(invocation)),
            "a provider is still alive"
        );
        let beats = self.lines("heartbeat").len();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            self.lines("heartbeat").len(),
            beats,
            "a provider process group is still running"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.logins.shutdown();
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn remove(name: &str) -> AgentMcpServerChange {
    AgentMcpServerChange::Remove {
        name: name.to_string(),
        scope: AgentMcpServerConfigScope::User,
    }
}

fn released(label: &str) -> Fixture {
    let fixture = Fixture::create(label, CODEX, &[PLAIN_REMOVED, LOGIN_AWAITING]);
    fixture.mark("release", "");
    fixture
}

fn ready(label: &str) -> Fixture {
    let fixture = released(label);
    fixture.register();
    fixture.set_trust(true);
    fixture.enable();
    fixture
}

fn command_name<T>(command: &T) -> &'static str {
    std::any::type_name_of_val(command)
        .rsplit("::")
        .next()
        .unwrap_or_default()
}

#[test]
fn the_command_names_match_the_shared_contract() {
    assert_eq!(
        command_name(&change_agent_mcp_server),
        "change_agent_mcp_server"
    );
    assert_eq!(
        command_name(&start_agent_mcp_server_login),
        "start_agent_mcp_server_login"
    );
    assert_eq!(
        command_name(&get_agent_mcp_server_login),
        "get_agent_mcp_server_login"
    );
    assert_eq!(
        command_name(&cancel_agent_mcp_server_login),
        "cancel_agent_mcp_server_login"
    );
}

#[test]
fn a_change_fails_closed_without_spawning_for_unknown_untrusted_or_disabled_owners() {
    let unregistered = released("change-unregistered");
    unregistered.set_trust(true);
    unregistered.enable();
    assert_eq!(
        unregistered.change(&remove("docs")).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    let untrusted = released("change-untrusted");
    untrusted.register();
    untrusted.enable();
    assert_eq!(
        untrusted.change(&remove("docs")).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    let disabled = released("change-disabled");
    disabled.register();
    disabled.set_trust(true);
    assert_eq!(
        disabled.change(&remove("docs")).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    disabled.register_policy(1, None, false);
    assert_eq!(
        disabled.change(&remove("docs")).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    for fixture in [&unregistered, &untrusted, &disabled] {
        assert!(fixture.lines("invocations").is_empty());
    }
}

#[test]
fn a_change_runs_in_the_registered_repository_root_and_reports_its_outcome() {
    let fixture = ready("change-registered");
    assert_eq!(fixture.change(&remove("docs")), Ok(()));
    assert_eq!(fixture.lines("invocations"), ["mcp remove -- docs"]);
    assert_eq!(fixture.lines("cwd"), [fixture.workspace.to_str().unwrap()]);
    assert_eq!(
        fixture.change(&remove("missing")).err().as_deref(),
        Some(AGENT_MCP_SERVER_NOT_FOUND_ERROR)
    );
    let nested = fixture.workspace.join("packages/app");
    assert_eq!(fixture.change_in(&nested, &remove("docs")), Ok(()));
    assert_eq!(fixture.lines("cwd"), [nested.to_str().unwrap()]);
    let outside = fixture.directory.canonicalize().expect("directory");
    assert_eq!(
        fixture
            .change_in(&outside, &remove("docs"))
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.lines("invocations").len(), 3);
    fixture.assert_no_provider_is_running();
}

#[test]
fn a_change_holds_trust_while_the_provider_runs() {
    let fixture = Fixture::ready("change-trust", CODEX, &[PLAIN_REMOVED, LOGIN_AWAITING]);
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.change(&remove("docs")));
        fixture.wait_for_invocations(1);
        let revoked = fixture
            .trust
            .lock()
            .unwrap()
            .set(fixture.workspace.to_str().unwrap(), false);
        assert_eq!(
            revoked.err().map(|error| error.kind()),
            Some(std::io::ErrorKind::WouldBlock)
        );
        fixture.mark("release", "");
        assert_eq!(worker.join().unwrap(), Ok(()));
    });
    fixture.set_trust(false);
    assert_eq!(
        fixture.change(&remove("docs")).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.lines("invocations").len(), 1);
}

#[test]
fn a_change_is_cancelled_when_its_provider_is_disabled_or_its_workspace_replaced() {
    let disabled = Fixture::ready("change-disabled-during", CODEX, &[PLAIN_REMOVED]);
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| disabled.change(&remove("docs")));
        disabled.wait_for_invocations(1);
        let generation = provider_generation(&disabled.providers, CODEX).expect("generation");
        disabled.register_policy(2, Some(generation), false);
        let started = Instant::now();
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
        );
        assert!(started.elapsed() < Duration::from_secs(10));
    });
    disabled.assert_no_provider_is_running();
    let replaced = Fixture::create("change-reregistered", CODEX, &[PLAIN_REMOVED]);
    let first = replaced.register();
    replaced.set_trust(true);
    replaced.enable();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| replaced.change(&remove("docs")));
        replaced.wait_for_invocations(1);
        replaced
            .registry
            .unregister(&first.workspace_id)
            .expect("unregister");
        replaced.register();
        replaced.mark("release", "");
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
        );
    });
}

#[test]
fn only_one_change_holds_the_permit_and_a_panic_releases_it() {
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    let first = McpChangePermit::acquire(&ACTIVE).expect("first permit");
    assert_eq!(
        McpChangePermit::acquire(&ACTIVE).err().as_deref(),
        Some(AGENT_MCP_SERVERS_BUSY_ERROR)
    );
    drop(first);
    let second = McpChangePermit::acquire(&ACTIVE).expect("released permit");
    let unwound = std::panic::catch_unwind(move || {
        let _held = second;
        panic!("change panicked");
    });
    assert!(unwound.is_err());
    assert!(McpChangePermit::acquire(&ACTIVE).is_ok());
    assert!(!ACTIVE.load(Ordering::Acquire));
}

#[test]
fn a_login_fails_closed_without_spawning_for_unknown_untrusted_or_disabled_owners() {
    let unregistered = released("login-unregistered");
    unregistered.set_trust(true);
    unregistered.enable();
    assert_eq!(
        unregistered.start().err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    let untrusted = released("login-untrusted");
    untrusted.register();
    untrusted.enable();
    assert_eq!(
        untrusted.start().err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    let disabled = released("login-disabled");
    disabled.register();
    disabled.set_trust(true);
    assert_eq!(
        disabled.start().err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    for fixture in [&unregistered, &untrusted, &disabled] {
        assert!(fixture.lines("invocations").is_empty());
        assert!(fixture.logins.is_idle());
    }
}

#[test]
fn a_login_returns_its_step_then_follows_the_provider_to_success() {
    let fixture = ready("login-success");
    let login_id = fixture.start_pending();
    assert_eq!(login_id.len(), 32);
    assert_eq!(fixture.lines("invocations"), ["app-server --stdio"]);
    assert_eq!(fixture.lines("cwd"), [fixture.workspace.to_str().unwrap()]);
    assert_eq!(
        fixture.logins.state(&login_id),
        Ok(AgentMcpServerLoginState::Pending)
    );
    assert!(fixture.is_alive(0));
    fixture.mark("callback", "true");
    fixture.wait_for_state(&login_id, AgentMcpServerLoginState::Succeeded);
    fixture.assert_no_provider_is_running();
    assert_eq!(
        fixture.logins.state(&login_id),
        Ok(AgentMcpServerLoginState::Succeeded)
    );
}

#[test]
fn a_login_the_provider_rejects_ends_failed() {
    let fixture = ready("login-denied");
    let login_id = fixture.start_pending();
    fixture.mark("callback", "false");
    fixture.wait_for_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
}

#[test]
fn sign_in_again_logs_out_before_the_login_session_starts() {
    let fixture = ready("login-again");
    let step = fixture
        .start_with(AgentMcpServerLoginMode::SignInAgain, FAST)
        .expect("step");
    assert!(matches!(
        step,
        AgentMcpServerLoginStep::AwaitingCallback { .. }
    ));
    assert_eq!(
        fixture.lines("invocations"),
        ["mcp logout -- docs", "app-server --stdio"]
    );
}

#[test]
fn a_second_login_replaces_and_reaps_the_first() {
    let fixture = ready("login-replaced");
    let first = fixture.start_pending();
    assert!(fixture.is_alive(0));
    let second = fixture.start_pending();
    assert_ne!(first, second);
    assert!(!fixture.is_alive(0));
    assert!(fixture.is_alive(1));
    assert_eq!(
        fixture.logins.state(&first).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    assert_eq!(
        fixture.logins.state(&second),
        Ok(AgentMcpServerLoginState::Pending)
    );
    fixture.logins.cancel(&first);
    assert!(fixture.is_alive(1));
    assert_eq!(
        fixture.logins.state(&second),
        Ok(AgentMcpServerLoginState::Pending)
    );
}

#[test]
fn cancelling_a_login_reaps_the_provider_and_forgets_the_session() {
    let fixture = ready("login-cancel");
    let login_id = fixture.start_pending();
    let started = Instant::now();
    fixture.logins.cancel(&login_id);
    assert!(started.elapsed() < Duration::from_secs(5));
    fixture.assert_no_provider_is_running();
    assert_eq!(
        fixture.logins.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    fixture.logins.cancel(&login_id);
    assert!(fixture.logins.is_idle());
}

#[test]
fn a_step_that_does_not_arrive_in_time_times_out_and_retains_nothing() {
    let fixture = Fixture::ready("login-step-timeout", CODEX, &["login() { :; }"]);
    let timing = McpLoginTiming {
        step_timeout: Duration::from_millis(400),
        ..FAST
    };
    assert_eq!(
        fixture
            .start_with(AgentMcpServerLoginMode::SignIn, timing)
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_TIMED_OUT_ERROR)
    );
    assert!(fixture.logins.is_idle());
    fixture.assert_no_provider_is_running();
}

#[test]
fn a_login_past_its_deadline_fails_and_is_reaped() {
    let fixture = ready("login-deadline");
    let timing = McpLoginTiming {
        deadline: Duration::from_millis(700),
        ..FAST
    };
    let login_id = match fixture.start_with(AgentMcpServerLoginMode::SignIn, timing) {
        Ok(AgentMcpServerLoginStep::AwaitingCallback { login_id, .. }) => login_id,
        other => panic!("unexpected step {other:?}"),
    };
    fixture.wait_for_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
}

#[test]
fn a_provider_refusal_is_returned_as_a_closed_error_and_retains_nothing() {
    let fixture = Fixture::ready(
        "login-unsupported",
        CODEX,
        &[
            r#"login() { printf '{"id":1,"error":{"code":-32600,"message":"OAuth login is only supported for streamable HTTP servers."}}\n'; }"#,
        ],
    );
    assert_eq!(
        fixture.start().err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR)
    );
    assert!(fixture.logins.is_idle());
    fixture.assert_no_provider_is_running();
    let invalid = Fixture::ready(
        "login-invalid-url",
        CODEX,
        &[
            r#"login() { printf '{"id":1,"result":{"authorizationUrl":"http://auth.example/authorize","loginId":"l"}}\n'; }"#,
        ],
    );
    assert_eq!(
        invalid.start().err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    assert!(invalid.logins.is_idle());
    invalid.assert_no_provider_is_running();
}

#[test]
fn claude_steps_without_a_callback_end_the_session_and_retain_nothing() {
    let browser = Fixture::ready(
        "login-browser",
        CLAUDE,
        &[
            r#"authenticate() { reply '{"authUrl":"https://claude.ai/connect/docs","requiresUserAction":true,"callbackExpected":false}'; }"#,
        ],
    );
    assert_eq!(
        browser.start(),
        Ok(AgentMcpServerLoginStep::FinishInBrowser {
            authorization_url: "https://claude.ai/connect/docs".to_string()
        })
    );
    assert!(browser.logins.is_idle());
    browser.assert_no_provider_is_running();
    let completed = Fixture::ready(
        "login-completed",
        CLAUDE,
        &[r#"authenticate() { reply '{"requiresUserAction":false,"callbackExpected":false}'; }"#],
    );
    assert_eq!(completed.start(), Ok(AgentMcpServerLoginStep::Completed));
    assert!(completed.logins.is_idle());
    completed.assert_no_provider_is_running();
    let missing = Fixture::ready(
        "login-missing",
        CLAUDE,
        &["authenticate() { refuse 'Server not found: docs'; }"],
    );
    assert_eq!(
        missing.start().err().as_deref(),
        Some(AGENT_MCP_SERVER_NOT_FOUND_ERROR)
    );
    assert!(missing.logins.is_idle());
}

#[test]
fn revoking_trust_fails_a_pending_login_and_reaps_the_provider() {
    let fixture = ready("login-trust-revoked");
    let login_id = fixture.start_pending();
    fixture.set_trust(false);
    fixture.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
    assert_eq!(
        fixture.start().err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.lines("invocations").len(), 1);
}

#[test]
fn replacing_the_workspace_registration_fails_a_pending_login() {
    let fixture = released("login-reregistered");
    let first = fixture.register();
    fixture.set_trust(true);
    fixture.enable();
    let login_id = fixture.start_pending();
    fixture
        .registry
        .unregister(&first.workspace_id)
        .expect("unregister");
    fixture.register();
    fixture.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
}

#[test]
fn disabling_or_replacing_the_provider_fails_a_pending_login() {
    let disabled = ready("login-provider-disabled");
    let login_id = disabled.start_pending();
    let generation = provider_generation(&disabled.providers, CODEX).expect("generation");
    disabled.register_policy(2, Some(generation), false);
    disabled.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    disabled.assert_no_provider_is_running();
    let replaced = ready("login-provider-replaced");
    let login_id = replaced.start_pending();
    let generation = provider_generation(&replaced.providers, CODEX).expect("generation");
    replaced.register_policy(2, Some(generation), true);
    replaced.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    replaced.assert_no_provider_is_running();
    let closed = ready("login-shutdown");
    let login_id = closed.start_pending();
    closed.providers.close_operation_admission();
    closed.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    closed.assert_no_provider_is_running();
}

#[test]
fn a_provider_disabled_before_the_step_is_known_fails_the_start() {
    let fixture = Fixture::ready("login-disabled-during-start", CODEX, &["login() { :; }"]);
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.start());
        fixture.wait_for_invocations(1);
        let generation = provider_generation(&fixture.providers, CODEX).expect("generation");
        fixture.register_policy(2, Some(generation), false);
        let started = Instant::now();
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
        );
        assert!(started.elapsed() < Duration::from_secs(10));
    });
    assert!(fixture.logins.is_idle());
    fixture.assert_no_provider_is_running();
}

#[test]
fn dropping_the_login_registry_reaps_the_provider_process_group() {
    let mut fixture = ready("login-drop");
    fixture.start_pending();
    assert!(fixture.is_alive(0));
    let logins = std::mem::take(&mut fixture.logins);
    drop(logins);
    fixture.assert_no_provider_is_running();
}

const CONFIG_THEN_STOP_READING: &str = r#"
config() {
  printf '{"id":2,"result":{"config":{"mcp_servers":{}}}}\n'
  : > "$directory/stalled"
  sleep 30
}
"#;

#[test]
fn a_provider_that_stops_reading_times_out_and_releases_the_permit_and_trust() {
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    let fixture = Fixture::ready("change-stalled-write", CODEX, &[CONFIG_THEN_STOP_READING]);
    let change = AgentMcpServerChange::Add {
        name: "docs".to_string(),
        scope: AgentMcpServerConfigScope::User,
        launch: crate::agent_mcp_server_manage_domain::AgentMcpServerLaunch::Stdio {
            command: "\\".repeat(1024),
            args: vec!["\\".repeat(1024); 32],
        },
    };
    let started = Instant::now();
    let outcome = {
        let _permit = McpChangePermit::acquire(&ACTIVE).expect("permit");
        fixture
            .change_within(&fixture.workspace, &change, Duration::from_millis(1_500))
            .map(|_| ())
    };
    assert_eq!(
        outcome.err().as_deref(),
        Some(AGENT_MCP_SERVERS_TIMED_OUT_ERROR)
    );
    assert!(started.elapsed() < Duration::from_secs(15));
    assert!(fixture.directory.join("stalled").exists());
    assert!(McpChangePermit::acquire(&ACTIVE).is_ok());
    fixture.assert_no_provider_is_running();
    fixture.set_trust(false);
}

#[test]
fn a_completion_racing_a_trust_revocation_never_ends_succeeded() {
    let fixture = ready("login-revoked-at-completion");
    let timing = McpLoginTiming {
        authority_check_interval: Duration::from_secs(3_600),
        ..FAST
    };
    let login_id = match fixture.start_with(AgentMcpServerLoginMode::SignIn, timing) {
        Ok(AgentMcpServerLoginStep::AwaitingCallback { login_id, .. }) => login_id,
        other => panic!("unexpected step {other:?}"),
    };
    fixture.set_trust(false);
    fixture.mark("callback", "true");
    fixture.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
    assert_eq!(
        fixture.logins.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
}

#[test]
fn a_completion_racing_a_workspace_replacement_never_ends_succeeded() {
    let fixture = released("login-replaced-at-completion");
    let first = fixture.register();
    fixture.set_trust(true);
    fixture.enable();
    let timing = McpLoginTiming {
        authority_check_interval: Duration::from_secs(3_600),
        ..FAST
    };
    let login_id = match fixture.start_with(AgentMcpServerLoginMode::SignIn, timing) {
        Ok(AgentMcpServerLoginStep::AwaitingCallback { login_id, .. }) => login_id,
        other => panic!("unexpected step {other:?}"),
    };
    fixture
        .registry
        .unregister(&first.workspace_id)
        .expect("unregister");
    fixture.register();
    fixture.mark("callback", "true");
    fixture.wait_for_recorded_state(&login_id, AgentMcpServerLoginState::Failed);
    fixture.assert_no_provider_is_running();
}

#[test]
fn a_login_state_is_not_published_once_its_owner_is_revoked() {
    let succeeded = ready("login-state-revoked");
    let login_id = succeeded.start_pending();
    succeeded.mark("callback", "true");
    succeeded.wait_for_state(&login_id, AgentMcpServerLoginState::Succeeded);
    succeeded.set_trust(false);
    assert_eq!(
        succeeded.logins.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert!(succeeded.logins.is_idle());
    assert_eq!(
        succeeded.logins.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    let pending = ready("login-state-provider-disabled");
    let login_id = pending.start_pending();
    let generation = provider_generation(&pending.providers, CODEX).expect("generation");
    pending.register_policy(2, Some(generation), false);
    assert_eq!(
        pending.logins.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    assert!(pending.logins.is_idle());
    pending.assert_no_provider_is_running();
}

#[test]
fn a_login_started_for_authority_lost_before_publication_is_reaped_not_returned() {
    let replaced = released("login-publication-reregistered");
    let first = replaced.register();
    replaced.set_trust(true);
    replaced.enable();
    let started = replaced
        .start_worker(AgentMcpServerLoginMode::SignIn, FAST)
        .expect("worker result");
    assert!(matches!(
        started.step,
        AgentMcpServerLoginStep::AwaitingCallback { .. }
    ));
    assert_eq!(replaced.confirm_login(&started), Ok(()));
    replaced
        .registry
        .unregister(&first.workspace_id)
        .expect("unregister");
    replaced.register();
    assert_eq!(
        replaced.confirm_login(&started).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    started.reap(&replaced.logins);
    assert!(replaced.logins.is_idle());
    replaced.assert_no_provider_is_running();
    let regenerated = ready("login-publication-provider");
    let generation = provider_generation(&regenerated.providers, CODEX).expect("generation");
    let started = regenerated
        .start_worker(AgentMcpServerLoginMode::SignIn, FAST)
        .expect("worker result");
    regenerated.register_policy(2, Some(generation), true);
    assert_eq!(
        regenerated.confirm_login(&started).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    started.reap(&regenerated.logins);
    assert!(regenerated.logins.is_idle());
    regenerated.assert_no_provider_is_running();
    let untrusted = ready("login-publication-untrusted");
    let started = untrusted
        .start_worker(AgentMcpServerLoginMode::SignIn, FAST)
        .expect("worker result");
    untrusted.set_trust(false);
    assert_eq!(
        untrusted.confirm_login(&started).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    started.reap(&untrusted.logins);
    untrusted.assert_no_provider_is_running();
}

#[test]
fn a_change_is_not_acknowledged_once_its_authority_is_lost_before_publication() {
    let fixture = ready("change-publication");
    let (authority, generation) = fixture
        .change_within(&fixture.workspace, &remove("docs"), CHANGE_TIMEOUT)
        .expect("applied change");
    assert_eq!(fixture.confirm_change(&authority, generation), Ok(()));
    let replaced = fixture.register_policy(2, Some(generation), true);
    assert_eq!(
        fixture
            .confirm_change(&authority, generation)
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    assert_eq!(fixture.confirm_change(&authority, replaced), Ok(()));
    fixture.set_trust(false);
    assert_eq!(
        fixture
            .confirm_change(&authority, replaced)
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
}
