use super::{
    validate_effective_path, AgentProviderProcessPlan, ExecutableIdentity, InteractiveProbe,
    CODEX_APP_SERVER_HANDSHAKE,
};
use crate::agent_command_catalog_domain::{CLAUDE_INITIALIZE_REQUEST, MAX_CATALOG_OUTPUT_BYTES};
use crate::agent_command_catalog_protocol::{
    ClaudeInitializeWatch, CodexSkillsPoll, ProbeStep, MAX_CODEX_SKILLS_STREAM_BYTES,
};
use crate::agent_task_spawner::AgentCliInvocation;
use std::{
    fs,
    io::Write,
    path::Path,
    process::ChildStdin,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const AGENT_PROVIDER_COMMAND_CATALOG_CLAUDE_TIMEOUT: Duration = Duration::from_secs(20);
pub const AGENT_PROVIDER_COMMAND_CATALOG_CODEX_TIMEOUT: Duration = Duration::from_secs(15);
const CLAUDE_INITIALIZE_ARGS: [&str; 10] = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--settings",
    "{\"disableAllHooks\":true}",
    "--no-session-persistence",
];
const CODEX_APP_SERVER_ARGS: [&str; 2] = ["app-server", "--stdio"];
const CLAUDE_PROBE_ENVIRONMENT: [(&str, &str); 3] = [
    ("ENABLE_CLAUDEAI_MCP_SERVERS", "false"),
    ("CLAUDE_CODE_AUTO_CONNECT_IDE", "0"),
    ("CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL", "1"),
];
const INVALID_WORKSPACE_ROOT_ERROR: &str = "Provider command catalog workspace root is invalid.";
const PROBE_STATE_ERROR: &str = "Provider command catalog probe state is unavailable.";

#[derive(Debug)]
enum CatalogProtocol {
    Claude(ClaudeInitializeWatch),
    Codex(CodexSkillsPoll),
}

#[derive(Debug)]
pub struct CommandCatalogProbe {
    protocol: Mutex<CatalogProtocol>,
}

impl CommandCatalogProbe {
    pub fn new(provider: AgentCliInvocation, workspace_root: &str) -> Arc<Self> {
        let protocol = match provider {
            AgentCliInvocation::ClaudeCode => CatalogProtocol::Claude(ClaudeInitializeWatch::new()),
            AgentCliInvocation::CodexExec => {
                CatalogProtocol::Codex(CodexSkillsPoll::new(workspace_root))
            }
        };
        Arc::new(Self {
            protocol: Mutex::new(protocol),
        })
    }

    fn protocol(&self) -> Result<MutexGuard<'_, CatalogProtocol>, String> {
        self.protocol
            .lock()
            .map_err(|_| PROBE_STATE_ERROR.to_string())
    }

    pub fn take_result(&self) -> Option<Vec<u8>> {
        let mut protocol = self.protocol().ok()?;
        match &mut *protocol {
            CatalogProtocol::Claude(watch) => watch.take_result(),
            CatalogProtocol::Codex(poll) => poll.take_result(),
        }
    }
}

impl InteractiveProbe for CommandCatalogProbe {
    fn observe(&self, bytes: &[u8]) {
        let Ok(mut protocol) = self.protocol() else {
            return;
        };
        match &mut *protocol {
            CatalogProtocol::Claude(watch) => watch.observe(bytes),
            CatalogProtocol::Codex(poll) => poll.observe(bytes, Instant::now()),
        }
    }

    fn advance(&self, stdin: Option<&mut ChildStdin>, now: Instant) -> Result<bool, String> {
        let mut protocol = self.protocol()?;
        let step = match &mut *protocol {
            CatalogProtocol::Claude(watch) => watch.step(),
            CatalogProtocol::Codex(poll) => poll.step(now),
        };
        drop(protocol);
        match step {
            ProbeStep::Wait => Ok(false),
            ProbeStep::Done => Ok(true),
            ProbeStep::Failed(error) => Err(error),
            ProbeStep::Write(request) => {
                stdin
                    .ok_or_else(|| "Provider input pipe was unavailable.".to_string())?
                    .write_all(&request)
                    .map_err(|_| "Provider input pipe could not be written.".to_string())?;
                Ok(false)
            }
        }
    }

    fn is_complete(&self) -> bool {
        self.protocol().is_ok_and(|protocol| match &*protocol {
            CatalogProtocol::Claude(watch) => watch.is_done(),
            CatalogProtocol::Codex(poll) => poll.is_done(),
        })
    }
}

impl AgentProviderProcessPlan {
    pub fn command_catalog_with_effective_path(
        identity: ExecutableIdentity,
        provider: AgentCliInvocation,
        workspace_root: &Path,
        cwd_authority: Arc<fs::File>,
        effective_path: &str,
        probe: Arc<CommandCatalogProbe>,
    ) -> Result<Self, String> {
        let effective_path = validate_effective_path(effective_path)?;
        if workspace_root.to_str().is_none() || !workspace_root.is_absolute() {
            return Err(INVALID_WORKSPACE_ROOT_ERROR.to_string());
        }
        let (args, timeout, stdin, output_limit): (&[&str], Duration, &str, usize) = match provider
        {
            AgentCliInvocation::ClaudeCode => (
                CLAUDE_INITIALIZE_ARGS.as_slice(),
                AGENT_PROVIDER_COMMAND_CATALOG_CLAUDE_TIMEOUT,
                CLAUDE_INITIALIZE_REQUEST,
                MAX_CATALOG_OUTPUT_BYTES,
            ),
            AgentCliInvocation::CodexExec => (
                CODEX_APP_SERVER_ARGS.as_slice(),
                AGENT_PROVIDER_COMMAND_CATALOG_CODEX_TIMEOUT,
                CODEX_APP_SERVER_HANDSHAKE,
                MAX_CODEX_SKILLS_STREAM_BYTES,
            ),
        };
        let mut plan = Self::new(
            identity,
            args.to_vec(),
            effective_path,
            timeout,
            output_limit,
            false,
        );
        plan.cwd = workspace_root.to_path_buf();
        plan.cwd_authority = Some(cwd_authority);
        plan.stdin_payload = Some(stdin.as_bytes().into());
        plan.interactive_probe = Some(probe);
        if provider == AgentCliInvocation::ClaudeCode {
            let mut env = std::mem::take(&mut plan.env).into_vec();
            env.extend(
                CLAUDE_PROBE_ENVIRONMENT
                    .iter()
                    .map(|(key, value)| ((*key).to_string(), (*value).to_string())),
            );
            plan.env = env.into_boxed_slice();
        }
        Ok(plan)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::{executable_identity_path_with_effective_path, execute_agent_provider_plan};
    use super::*;
    use crate::agent_command_catalog_domain::parse_catalog_output;
    use std::{
        env,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NONCE: AtomicU64 = AtomicU64::new(0);

    fn scratch_directory(label: &str) -> PathBuf {
        let directory = env::temp_dir().join(format!(
            "codevo-command-catalog-plan-{label}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).expect("scratch directory");
        directory
            .canonicalize()
            .expect("canonical scratch directory")
    }

    fn executable(directory: &Path, name: &str, body: &str) -> PathBuf {
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("executable");
        path
    }

    fn plan_for(
        cli: &Path,
        provider: AgentCliInvocation,
        workspace_root: &Path,
    ) -> Result<(AgentProviderProcessPlan, Arc<CommandCatalogProbe>), String> {
        let effective_path = env::var("PATH").expect("test PATH");
        let identity = executable_identity_path_with_effective_path(cli, &effective_path)?;
        let authority =
            Arc::new(fs::File::open(workspace_root).map_err(|error| error.to_string())?);
        let probe = CommandCatalogProbe::new(provider, workspace_root.to_str().expect("utf8"));
        let plan = AgentProviderProcessPlan::command_catalog_with_effective_path(
            identity,
            provider,
            workspace_root,
            authority,
            &effective_path,
            Arc::clone(&probe),
        )?;
        Ok((plan, probe))
    }

    fn env_value<'a>(plan: &'a AgentProviderProcessPlan, key: &str) -> Option<&'a str> {
        plan.env
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn claude_plan_runs_a_bounded_initialize_control_request_in_the_workspace() {
        let directory = scratch_directory("claude");
        let workspace = directory.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");
        let cli = executable(&directory, "claude", "exit 0");
        let (plan, _) = plan_for(&cli, AgentCliInvocation::ClaudeCode, &workspace).expect("plan");
        assert_eq!(
            plan.args(),
            [
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--strict-mcp-config",
                "--settings",
                "{\"disableAllHooks\":true}",
                "--no-session-persistence",
            ]
        );
        assert_eq!(plan.cwd, workspace);
        assert!(plan.cwd_authority.is_some());
        assert_eq!(plan.timeout, Duration::from_secs(20));
        assert_eq!(plan.output_limit, 2 * 1024 * 1024);
        assert!(!plan.requires_update_authorization);
        assert!(plan.usage_probe.is_none());
        assert!(plan.stdout_completion_marker.is_none());
        assert!(plan.interactive_probe.is_some());
        assert_eq!(
            plan.stdin_payload.as_deref(),
            Some(CLAUDE_INITIALIZE_REQUEST.as_bytes())
        );
        assert_eq!(
            env_value(&plan, "ENABLE_CLAUDEAI_MCP_SERVERS"),
            Some("false")
        );
        assert_eq!(env_value(&plan, "CLAUDE_CODE_AUTO_CONNECT_IDE"), Some("0"));
        assert_eq!(
            env_value(&plan, "CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL"),
            Some("1")
        );
        assert_eq!(env_value(&plan, "CI"), Some("1"));
        assert!(env_value(&plan, "PATH").is_some());
        assert!(plan_for(&cli, AgentCliInvocation::ClaudeCode, Path::new("relative")).is_err());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn codex_plan_sends_only_the_handshake_up_front_and_polls_through_the_probe() {
        let directory = scratch_directory("codex");
        let workspace = directory.join("work space");
        fs::create_dir_all(&workspace).expect("workspace");
        let cli = executable(&directory, "codex", "exit 0");
        let (plan, probe) =
            plan_for(&cli, AgentCliInvocation::CodexExec, &workspace).expect("plan");
        assert_eq!(plan.args(), ["app-server", "--stdio"]);
        assert_eq!(plan.cwd, workspace);
        assert_eq!(plan.timeout, Duration::from_secs(15));
        assert_eq!(plan.output_limit, MAX_CODEX_SKILLS_STREAM_BYTES);
        assert!(plan.stdout_completion_marker.is_none());
        assert!(env_value(&plan, "ENABLE_CLAUDEAI_MCP_SERVERS").is_none());
        assert_eq!(
            plan.stdin_payload.as_deref(),
            Some(CODEX_APP_SERVER_HANDSHAKE.as_bytes())
        );
        assert!(!probe.is_complete());
        assert_eq!(probe.advance(None, Instant::now()), Ok(false));
        probe.observe(b"{\"id\":0,\"result\":{}}\n");
        assert!(probe.advance(None, Instant::now()).is_err());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn claude_probe_completes_on_our_control_response_and_ignores_decoys() {
        let directory = scratch_directory("claude-run");
        let workspace = directory.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");
        let cli = executable(
            &directory,
            "claude",
            r#"
read -r request
case "$request" in *'"subtype":"initialize"'*) ;; *) exit 2;; esac
printf '{"type":"control_response","response":{"subtype":"success","request_id":"other","response":{"commands":[{"name":"decoy"}]}}}\n'
printf '{"type":"system","text":"\\"type\\":\\"control_response\\" \\"request_id\\":\\"codevo-command-catalog\\""}\n'
sleep 0.2
printf '{"response":{"response":{"commands":[{"name":"pr","description":"has \\"type\\":\\"control_response\\" inside"}],"cwd":"%s","mcp":"%s"},"request_id":"codevo-command-catalog","subtype":"success"},"type":"control_response"}' "$PWD" "$ENABLE_CLAUDEAI_MCP_SERVERS"
sleep 0.2
printf '\n'
sleep 30
"#,
        );
        let (plan, probe) =
            plan_for(&cli, AgentCliInvocation::ClaudeCode, &workspace).expect("plan");
        let output = execute_agent_provider_plan(&plan).expect("completed by probe");
        assert!(output.stdout.is_empty());
        let result = probe.take_result().expect("probe result");
        let response: serde_json::Value = serde_json::from_slice(&result).expect("response line");
        assert_eq!(
            response["response"]["response"]["cwd"],
            workspace.to_str().unwrap()
        );
        assert_eq!(response["response"]["response"]["mcp"], "false");
        let catalog = parse_catalog_output(
            AgentCliInvocation::ClaudeCode,
            &result,
            workspace.to_str().unwrap(),
        )
        .expect("catalog");
        assert_eq!(catalog.entries.len(), 1);
        assert_eq!(catalog.entries[0].name, "pr");
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn codex_probe_polls_until_the_skill_list_settles_and_returns_the_latest_listing() {
        let directory = scratch_directory("codex-run");
        let workspace = directory.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");
        let cli = executable(
            &directory,
            "codex",
            r#"
polls=0
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"skills/list"'*)
      id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
      polls=$((polls + 1))
      echo poll >> "$(dirname "$0")/polls"
      if [ "$polls" -lt 2 ]; then
        printf '{"id":%s,"result":{"data":[{"cwd":"%s","skills":[{"name":"a","scope":"system"}],"errors":[]}]}}\n' "$id" "$PWD"
      else
        printf '{"id":%s,"result":{"data":[{"cwd":"%s","skills":[{"name":"a","scope":"system"},{"name":"b"},' "$id" "$PWD"
        sleep 0.1
        printf '{"name":"c"}],"errors":[]}]}}\n'
      fi;;
  esac
done
"#,
        );
        let (plan, probe) =
            plan_for(&cli, AgentCliInvocation::CodexExec, &workspace).expect("plan");
        let output = execute_agent_provider_plan(&plan).expect("completed by probe");
        assert!(output.stdout.is_empty());
        let polls = fs::read_to_string(directory.join("polls"))
            .map(|polls| polls.lines().count())
            .unwrap_or(0);
        assert!(polls >= 2, "polling stopped after {polls} request(s)");
        let result = probe.take_result().expect("probe result");
        let catalog = parse_catalog_output(
            AgentCliInvocation::CodexExec,
            &result,
            workspace.to_str().unwrap(),
        )
        .expect("catalog");
        let names: Vec<&str> = catalog
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["a", "b", "c"]);
        assert!(catalog.entries[0].builtin);
        assert!(!catalog.truncated);
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn codex_probe_fails_on_an_error_response_and_terminates_the_process() {
        let directory = scratch_directory("codex-error");
        let workspace = directory.join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");
        let cli = executable(
            &directory,
            "codex",
            r#"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"skills/list"'*) printf '{"id":1,"error":{"code":-32601,"message":"unsupported"}}\n'; sleep 30;;
  esac
done
"#,
        );
        let (plan, probe) =
            plan_for(&cli, AgentCliInvocation::CodexExec, &workspace).expect("plan");
        assert!(execute_agent_provider_plan(&plan).is_err());
        assert_eq!(probe.take_result(), None);
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
