use super::super::executable_identity_path_with_effective_path;
use super::*;
use crate::agent_mcp_servers_domain::{
    AgentMcpServerScope, AgentMcpServerStatus, AgentMcpServerTransport,
};
use crate::agent_mcp_servers_protocol::MAX_CODEX_MCP_STATUS_LINE_BYTES;
use serde_json::Value;
use std::{
    env,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    thread,
};

static NONCE: AtomicU64 = AtomicU64::new(0);

const FAST: McpStatusTiming = McpStatusTiming {
    poll_interval: Duration::from_millis(40),
    stable_for: Duration::from_millis(250),
    settle_deadline: Duration::from_secs(20),
};
const SHORT_DEADLINE: McpStatusTiming = McpStatusTiming {
    poll_interval: Duration::from_millis(100),
    settle_deadline: Duration::from_millis(1_500),
    ..FAST
};

const RECORD_INVOCATION: &str = r#"
directory=$(dirname "$0")
printf '%s\n' "$@" > "$directory/argv"
env > "$directory/environment"
printf '%s\n' "$PWD" > "$directory/cwd"
printf '%s\n' "$$" > "$directory/pid"
( while :; do echo beat >> "$directory/heartbeat"; sleep 0.05; done ) &
"#;

const CLAUDE_READ_LOOP: &str = r#"
polls=0
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$directory/stdin"
  id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"subtype":"initialize"'*) initialize;;
    *'"subtype":"mcp_status"'*) polls=$((polls + 1)); status;;
  esac
done
"#;

const CLAUDE_INITIALIZE_OK: &str = r#"
initialize() {
  printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{"commands":[{"name":"review"}],"pid":4242}}}\n' "$id"
}
"#;

const CODEX_READ_LOOP: &str = r#"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$directory/stdin"
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{"userAgent":"codevo_editor"}}\n{"method":"remoteControl/status/changed","params":{"status":"disabled"}}\n';;
    *'"method":"mcpServerStatus/list"'*) status;;
  esac
done
"#;

struct Fixture {
    directory: PathBuf,
    workspace: PathBuf,
    cli: PathBuf,
}

impl Fixture {
    fn create(label: &str, name: &str, body: &str) -> Self {
        let directory = env::temp_dir().join(format!(
            "codevo-mcp-servers-plan-{label}-{}-{}",
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
        }
    }

    fn claude(label: &str, functions: &str) -> Self {
        Self::create(label, "claude", &format!("{functions}\n{CLAUDE_READ_LOOP}"))
    }

    fn codex(label: &str, functions: &str) -> Self {
        Self::create(label, "codex", &format!("{functions}\n{CODEX_READ_LOOP}"))
    }

    fn plan(
        &self,
        provider: AgentCliInvocation,
        timing: McpStatusTiming,
    ) -> (AgentProviderProcessPlan, Arc<McpServersProbe>) {
        self.plan_in(provider, timing, &self.workspace)
            .expect("plan")
    }

    fn plan_in(
        &self,
        provider: AgentCliInvocation,
        timing: McpStatusTiming,
        workspace_root: &Path,
    ) -> Result<(AgentProviderProcessPlan, Arc<McpServersProbe>), String> {
        let effective_path = env::var("PATH").expect("test PATH");
        let identity = executable_identity_path_with_effective_path(&self.cli, &effective_path)?;
        let authority = Arc::new(fs::File::open(&self.workspace).expect("workspace authority"));
        let probe = McpServersProbe::with_timing(provider, timing);
        let plan = AgentProviderProcessPlan::mcp_servers_with_effective_path(
            identity,
            provider,
            workspace_root,
            authority,
            &effective_path,
            Arc::clone(&probe),
        )?;
        Ok((plan, probe))
    }

    fn run(
        &self,
        provider: AgentCliInvocation,
        timing: McpStatusTiming,
    ) -> Result<AgentMcpServers, McpServersProbeFailure> {
        let (plan, probe) = self.plan(provider, timing);
        execute_mcp_servers_plan(&plan, &probe, || false)
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

    fn assert_only_control_requests(&self) {
        for message in self.stdin_messages() {
            assert_eq!(message["type"], "control_request", "{message}");
            assert!(message.get("message").is_none(), "{message}");
            assert!(
                ["initialize", "mcp_status"]
                    .contains(&message["request"]["subtype"].as_str().unwrap_or_default()),
                "{message}"
            );
        }
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

fn env_value<'a>(plan: &'a AgentProviderProcessPlan, key: &str) -> Option<&'a str> {
    plan.env
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

fn statuses(snapshot: &AgentMcpServers) -> Vec<(&str, AgentMcpServerStatus)> {
    snapshot
        .servers
        .iter()
        .map(|server| (server.name.as_str(), server.status))
        .collect()
}

fn claude_status_function(body: &str) -> String {
    format!("{CLAUDE_INITIALIZE_OK}\nstatus() {{\n{body}\n}}")
}

fn claude_servers_line(servers: &str) -> String {
    format!(
        r#"printf '{{"type":"control_response","response":{{"subtype":"success","request_id":"%s","response":{{"mcpServers":{servers}}}}}}}\n' "$id""#
    )
}

#[test]
fn claude_plan_lists_every_configured_server_without_a_model_turn() {
    let fixture = Fixture::claude("claude-plan", "");
    let (plan, _) = fixture.plan(AgentCliInvocation::ClaudeCode, McpStatusTiming::PRODUCTION);
    assert_eq!(
        plan.args(),
        [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--settings",
            "{\"disableAllHooks\":true}",
            "--no-session-persistence",
        ]
    );
    assert!(!plan.args().iter().any(|arg| arg == "--strict-mcp-config"));
    assert_eq!(plan.cwd, fixture.workspace);
    assert!(plan.cwd_authority.is_some());
    assert_eq!(plan.timeout, Duration::from_secs(25));
    assert_eq!(plan.output_limit, MAX_CLAUDE_MCP_STATUS_STREAM_BYTES);
    assert!(!plan.requires_update_authorization);
    assert!(plan.usage_probe.is_none());
    assert!(plan.stdout_completion_marker.is_none());
    assert!(plan.interactive_probe.is_some());
    assert_eq!(
        plan.stdin_payload.as_deref(),
        Some(CLAUDE_MCP_INITIALIZE_REQUEST.as_bytes())
    );
    assert_eq!(env_value(&plan, "ENABLE_CLAUDEAI_MCP_SERVERS"), None);
    assert_eq!(env_value(&plan, "CLAUDE_CODE_AUTO_CONNECT_IDE"), Some("0"));
    assert_eq!(
        env_value(&plan, "CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL"),
        Some("1")
    );
    assert_eq!(env_value(&plan, "CI"), Some("1"));
    assert!(env_value(&plan, "PATH").is_some());
    assert!(fixture
        .plan_in(
            AgentCliInvocation::ClaudeCode,
            McpStatusTiming::PRODUCTION,
            Path::new("relative"),
        )
        .is_err());
}

#[test]
fn codex_plan_sends_only_the_handshake_up_front_without_config_overrides() {
    let fixture = Fixture::codex("codex-plan", "");
    let (plan, probe) = fixture.plan(AgentCliInvocation::CodexExec, McpStatusTiming::PRODUCTION);
    assert_eq!(plan.args(), ["app-server", "--stdio"]);
    assert_eq!(plan.cwd, fixture.workspace);
    assert!(plan.cwd_authority.is_some());
    assert_eq!(plan.timeout, Duration::from_secs(25));
    assert_eq!(plan.output_limit, MAX_CODEX_MCP_STATUS_STREAM_BYTES);
    assert!(plan.stdout_completion_marker.is_none());
    assert_eq!(env_value(&plan, "CLAUDE_CODE_AUTO_CONNECT_IDE"), None);
    assert_eq!(
        plan.stdin_payload.as_deref(),
        Some(CODEX_APP_SERVER_HANDSHAKE.as_bytes())
    );
    assert!(!probe.is_complete());
    assert_eq!(probe.advance(None, Instant::now()), Ok(false));
    probe.observe(b"{\"id\":0,\"result\":{}}\n");
    assert!(probe.advance(None, Instant::now()).is_err());
    assert!(fixture
        .plan_in(
            AgentCliInvocation::CodexExec,
            McpStatusTiming::PRODUCTION,
            Path::new("relative"),
        )
        .is_err());
}

#[test]
fn claude_probe_polls_until_pending_servers_settle_and_never_sends_a_user_message() {
    let pending = claude_servers_line(
        r#"[{"name":"slow","status":"pending","config":{"type":"stdio","command":"/opt/MARKER_SECRET/server","args":["--key","MARKER_SECRET"],"env":{"TOKEN":"MARKER_SECRET"}},"scope":"project"}]"#,
    );
    let settled = claude_servers_line(
        r#"[{"name":"slow","status":"connected","config":{"type":"stdio","command":"/opt/MARKER_SECRET/server","args":["--key","MARKER_SECRET"],"env":{"TOKEN":"MARKER_SECRET"}},"scope":"project","tools":[{"name":"MARKER_SECRET"}]},{"name":"claude.ai Gmail","status":"needs-auth","config":{"type":"claudeai-proxy","url":"https://gmailmcp.googleapis.com/mcp/v1?token=MARKER_SECRET","id":"mcpsrv_MARKER_SECRET"},"scope":"claudeai"}]"#,
    );
    let fixture = Fixture::claude(
        "claude-settle",
        &claude_status_function(&format!(
            r#"
  printf '{{"type":"system","subtype":"status","request_id":"%s"}}\nnot json\n' "$id"
  if [ "$polls" -lt 3 ]; then
    {pending}
  else
    {settled}
  fi"#
        )),
    );
    let snapshot = fixture
        .run(AgentCliInvocation::ClaudeCode, FAST)
        .expect("snapshot");
    assert_eq!(snapshot.provider, AgentCliInvocation::ClaudeCode);
    assert!(!snapshot.truncated);
    assert_eq!(
        statuses(&snapshot),
        [
            ("claude.ai Gmail", AgentMcpServerStatus::NeedsAuth),
            ("slow", AgentMcpServerStatus::Connected),
        ]
    );
    assert_eq!(snapshot.servers[0].scope, AgentMcpServerScope::Account);
    assert_eq!(
        snapshot.servers[0].endpoint_origin.as_deref(),
        Some("https://gmailmcp.googleapis.com")
    );
    assert_eq!(
        snapshot.servers[1].transport,
        AgentMcpServerTransport::Stdio
    );
    assert_eq!(snapshot.servers[1].tool_count, Some(1));
    assert!(!serde_json::to_string(&snapshot)
        .unwrap()
        .contains("MARKER_SECRET"));
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
            "--no-session-persistence",
        ]
    );
    assert_eq!(
        fixture.read("cwd").trim_end(),
        fixture.workspace.to_str().unwrap()
    );
    let environment = fixture.lines("environment");
    assert!(environment.contains(&"CLAUDE_CODE_AUTO_CONNECT_IDE=0".to_string()));
    assert!(environment.contains(&"CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL=1".to_string()));
    assert!(!environment
        .iter()
        .any(|entry| entry.starts_with("ENABLE_CLAUDEAI_MCP_SERVERS=")));
    let messages = fixture.stdin_messages();
    assert!(messages.len() >= 4, "{messages:?}");
    assert_eq!(messages[0]["request"]["subtype"], "initialize");
    assert!(messages[1..]
        .iter()
        .all(|message| message["request"] == serde_json::json!({"subtype": "mcp_status"})));
    assert!(!fixture.read("stdin").contains("\"user\""));
    fixture.assert_only_control_requests();
    fixture.assert_process_group_terminated();
}

#[test]
fn claude_probe_returns_still_connecting_servers_at_the_settle_deadline() {
    let pending = claude_servers_line(
        r#"[{"name":"slow","status":"pending","scope":"local"},{"name":"ready","status":"connected","scope":"user"}]"#,
    );
    let fixture = Fixture::claude("claude-deadline", &claude_status_function(&pending));
    let started = Instant::now();
    let snapshot = fixture
        .run(AgentCliInvocation::ClaudeCode, SHORT_DEADLINE)
        .expect("snapshot");
    assert!(started.elapsed() >= SHORT_DEADLINE.settle_deadline);
    assert!(started.elapsed() < Duration::from_secs(15));
    assert_eq!(
        statuses(&snapshot),
        [
            ("ready", AgentMcpServerStatus::Connected),
            ("slow", AgentMcpServerStatus::Connecting),
        ]
    );
    fixture.assert_only_control_requests();
    fixture.assert_process_group_terminated();
}

#[test]
fn a_process_timeout_returns_the_latest_snapshot_or_the_timed_out_failure() {
    let pending = claude_servers_line(r#"[{"name":"slow","status":"pending"}]"#);
    let fixture = Fixture::claude("claude-timeout-snapshot", &claude_status_function(&pending));
    let patient = McpStatusTiming {
        settle_deadline: Duration::from_secs(600),
        ..FAST
    };
    let (mut plan, probe) = fixture.plan(AgentCliInvocation::ClaudeCode, patient);
    plan.timeout = Duration::from_secs(2);
    let snapshot = execute_mcp_servers_plan(&plan, &probe, || false).expect("latest snapshot");
    assert_eq!(
        statuses(&snapshot),
        [("slow", AgentMcpServerStatus::Connecting)]
    );
    fixture.assert_process_group_terminated();

    let silent = Fixture::claude("claude-timeout-silent", &claude_status_function(":"));
    let (mut plan, probe) = silent.plan(AgentCliInvocation::ClaudeCode, FAST);
    plan.timeout = Duration::from_millis(1_500);
    assert_eq!(
        execute_mcp_servers_plan(&plan, &probe, || false),
        Err(McpServersProbeFailure::TimedOut)
    );
    assert!(silent.stdin_messages().len() <= 2);
    silent.assert_only_control_requests();
    silent.assert_process_group_terminated();

    let mute = Fixture::claude(
        "claude-timeout-mute",
        "initialize() { :; }\nstatus() { :; }",
    );
    let (mut plan, probe) = mute.plan(AgentCliInvocation::ClaudeCode, FAST);
    plan.timeout = Duration::from_millis(1_500);
    assert_eq!(
        execute_mcp_servers_plan(&plan, &probe, || false),
        Err(McpServersProbeFailure::TimedOut)
    );
    assert!(mute.stdin_messages().len() <= 1);
    mute.assert_only_control_requests();
    mute.assert_process_group_terminated();
}

#[test]
fn claude_probe_fails_closed_on_an_error_response_and_terminates_the_process() {
    let fixture = Fixture::claude(
        "claude-error",
        &claude_status_function(
            r#"  printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"Unsupported control request subtype: mcp_status"}}\n' "$id"
  sleep 30"#,
        ),
    );
    let started = Instant::now();
    assert_eq!(
        fixture.run(AgentCliInvocation::ClaudeCode, FAST),
        Err(McpServersProbeFailure::Unavailable)
    );
    assert!(started.elapsed() < Duration::from_secs(15));
    fixture.assert_process_group_terminated();

    let rejected = Fixture::claude(
        "claude-initialize-error",
        r#"initialize() {
  printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"nope"}}\n' "$id"
}
status() { :; }"#,
    );
    assert_eq!(
        rejected.run(AgentCliInvocation::ClaudeCode, FAST),
        Err(McpServersProbeFailure::Unavailable)
    );
    assert_eq!(rejected.stdin_messages().len(), 1);
    rejected.assert_process_group_terminated();
}

#[test]
fn a_provider_that_exits_or_is_cancelled_is_unavailable() {
    let exited = Fixture::create("claude-exit", "claude", "exit 3");
    assert_eq!(
        exited.run(AgentCliInvocation::ClaudeCode, FAST),
        Err(McpServersProbeFailure::Unavailable)
    );
    exited.assert_process_group_terminated();

    let pending = claude_servers_line(r#"[{"name":"slow","status":"pending"}]"#);
    let cancelled = Fixture::claude("claude-cancel", &claude_status_function(&pending));
    let (plan, probe) = cancelled.plan(AgentCliInvocation::ClaudeCode, FAST);
    let heartbeat = cancelled.directory.join("heartbeat");
    let started = Instant::now();
    assert_eq!(
        execute_mcp_servers_plan(&plan, &probe, || {
            heartbeat.exists() && started.elapsed() >= Duration::from_millis(300)
        }),
        Err(McpServersProbeFailure::Unavailable)
    );
    assert!(started.elapsed() < Duration::from_secs(15));
    cancelled.assert_process_group_terminated();
}

#[test]
fn codex_probe_reads_one_status_list_between_unrelated_notifications() {
    let fixture = Fixture::codex(
        "codex-list",
        r#"status() {
  printf '{"method":"account/updated","params":{"authMode":"chatgpt"}}\n'
  printf '{"id":2,"result":{"data":[{"name":"decoy"}]}}\n'
  printf '{"id":1,"result":{"data":[{"name":"codex_apps","runtimeStatus":null,"pluginId":null,"httpOrigin":"https://chatgpt.com","serverInfo":{"name":"codex-apps"},"tools":{"search":{"name":"search","description":"MARKER_SECRET","inputSchema":{"type":"object"}},"fetch":{"name":"fetch"}},"toolsError":null,"authStatus":"bearerToken"},'
  sleep 0.1
  printf '{"name":"broken","runtimeStatus":null,"pluginId":null,"httpOrigin":"http://127.0.0.1:9","serverInfo":null,"tools":{},"toolsError":"request failed for url (http://127.0.0.1:9/mcp/path?token=MARKER_SECRET)","authStatus":"unknown"}],"nextCursor":"2"}}\n'
  sleep 30
}"#,
    );
    let started = Instant::now();
    let snapshot = fixture
        .run(AgentCliInvocation::CodexExec, McpStatusTiming::PRODUCTION)
        .expect("snapshot");
    assert!(started.elapsed() < Duration::from_secs(15));
    assert_eq!(snapshot.provider, AgentCliInvocation::CodexExec);
    assert!(snapshot.truncated);
    assert_eq!(
        statuses(&snapshot),
        [
            ("broken", AgentMcpServerStatus::Failed),
            ("codex_apps", AgentMcpServerStatus::Connected),
        ]
    );
    assert_eq!(
        snapshot.servers[0].detail.as_deref(),
        Some("request failed for url (http://127.0.0.1:9")
    );
    assert_eq!(
        snapshot.servers[1].endpoint_origin.as_deref(),
        Some("https://chatgpt.com")
    );
    assert_eq!(snapshot.servers[1].tool_count, Some(2));
    assert!(!serde_json::to_string(&snapshot)
        .unwrap()
        .contains("MARKER_SECRET"));
    assert_eq!(fixture.lines("argv"), ["app-server", "--stdio"]);
    assert_eq!(
        fixture.read("cwd").trim_end(),
        fixture.workspace.to_str().unwrap()
    );
    let messages = fixture.stdin_messages();
    let methods: Vec<&str> = messages
        .iter()
        .map(|message| message["method"].as_str().expect("method"))
        .collect();
    assert_eq!(
        methods,
        ["initialize", "initialized", "mcpServerStatus/list"]
    );
    assert_eq!(
        messages[2]["params"],
        serde_json::json!({"detail": "toolsAndAuthOnly", "limit": 128})
    );
    fixture.assert_process_group_terminated();
}

#[test]
fn codex_probe_fails_closed_on_errors_oversized_lines_and_silence() {
    let failed = Fixture::codex(
        "codex-error",
        r#"status() {
  printf '{"error":{"code":-32600,"message":"Invalid request"},"id":1}\n'
  sleep 30
}"#,
    );
    assert_eq!(
        failed.run(AgentCliInvocation::CodexExec, McpStatusTiming::PRODUCTION),
        Err(McpServersProbeFailure::Unavailable)
    );
    failed.assert_process_group_terminated();

    let oversized = Fixture::codex(
        "codex-oversized",
        &format!(
            r#"status() {{
  printf '{{"id":1,"result":{{"data":[],"padding":"'
  head -c {} /dev/zero | tr '\0' 'x'
  printf '"}}}}\n'
  sleep 30
}}"#,
            MAX_CODEX_MCP_STATUS_LINE_BYTES + 1
        ),
    );
    assert_eq!(
        oversized.run(AgentCliInvocation::CodexExec, McpStatusTiming::PRODUCTION),
        Err(McpServersProbeFailure::Unavailable)
    );
    oversized.assert_process_group_terminated();

    let silent = Fixture::codex("codex-silent", "status() { :; }");
    let (mut plan, probe) = silent.plan(AgentCliInvocation::CodexExec, McpStatusTiming::PRODUCTION);
    plan.timeout = Duration::from_millis(1_500);
    assert_eq!(
        execute_mcp_servers_plan(&plan, &probe, || false),
        Err(McpServersProbeFailure::TimedOut)
    );
    assert!(silent.stdin_messages().iter().all(|message| [
        "initialize",
        "initialized",
        "mcpServerStatus/list"
    ]
    .contains(&message["method"].as_str().unwrap_or_default())));
    silent.assert_process_group_terminated();
}
