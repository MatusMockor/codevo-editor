use super::*;
use crate::agent_mcp_servers_domain::{
    AgentMcpServerStatus, AGENT_MCP_SERVERS_TIMED_OUT_ERROR, INVALID_REQUEST_ERROR,
};
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderPolicy;
use crate::workspace_registry::ManagedWorkspaceDescriptor;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::AtomicU64,
    time::{Duration, Instant},
};

const CONTRACT: &[u8] = include_bytes!("../../contracts/agent-mcp-servers-wire.json");
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
static NONCE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    directory: PathBuf,
    workspace: PathBuf,
    registry: WorkspaceRegistry,
    trust: Mutex<WorkspaceTrustService>,
    providers: Arc<AgentProviderRuntimeRegistry>,
    cli: PathBuf,
}

impl Fixture {
    fn create(label: &str, body: &str) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "codevo-mcp-servers-{label}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        let workspace = directory.join("workspace");
        fs::create_dir_all(workspace.join("packages/app")).expect("workspace");
        let workspace = workspace.canonicalize().expect("canonical workspace");
        let cli = directory.join("codex");
        fs::write(&cli, format!("#!/bin/sh\n{body}\n")).expect("script");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("executable");
        let trust = WorkspaceTrustService::load(directory.join("trust.json")).expect("trust");
        Self {
            directory,
            workspace,
            registry: WorkspaceRegistry::new(),
            trust: Mutex::new(trust),
            providers: Arc::new(AgentProviderRuntimeRegistry::new()),
            cli,
        }
    }

    fn register(&self) -> ManagedWorkspaceDescriptor {
        self.registry
            .register(&self.workspace)
            .expect("register workspace")
    }

    fn enable_codex(&self) -> u64 {
        self.register_codex(1, None, true)
    }

    fn register_codex(&self, revision: u64, expected: Option<u64>, enabled: bool) -> u64 {
        self.providers
            .register_policy(
                CODEX,
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
            .expect("register codex policy")
            .provider_generation
    }

    fn set_trust(&self, trusted: bool) {
        self.trust
            .lock()
            .unwrap()
            .set(self.workspace.to_str().expect("utf8 root"), trusted)
            .expect("update trust");
    }

    fn capture(&self, root: &Path) -> Result<WorkspaceMcpServersAuthority, String> {
        WorkspaceMcpServersAuthority::capture(
            &self.registry,
            &self.trust,
            root.to_str().expect("utf8 root"),
        )
    }

    fn check_only(
        &self,
        authority: &WorkspaceMcpServersAuthority,
    ) -> Result<CheckedMcpServers, String> {
        check_servers(
            &self.providers,
            &self.registry,
            &self.trust,
            authority,
            CODEX,
        )
    }

    fn publish(
        &self,
        authority: &WorkspaceMcpServersAuthority,
        checked: CheckedMcpServers,
    ) -> Result<AgentMcpServers, String> {
        publish_servers(
            &self.providers,
            &self.registry,
            &self.trust,
            authority,
            CODEX,
            checked,
        )
    }

    fn check(&self, root: &Path) -> Result<AgentMcpServers, String> {
        let authority = self.capture(root)?;
        let checked = self.check_only(&authority)?;
        self.publish(&authority, checked)
    }

    fn release(&self) {
        fs::write(self.directory.join("release"), b"").expect("release marker");
    }

    fn probe_count(&self) -> usize {
        fs::read_to_string(self.directory.join("probes"))
            .map(|probes| probes.lines().count())
            .unwrap_or(0)
    }

    fn wait_for_probe_count(&self, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(60);
        while self.probe_count() < expected {
            assert!(Instant::now() < deadline, "provider was not spawned");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

const STATUS_SCRIPT: &str = r#"
echo probe >> "$(dirname "$0")/probes"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"mcpServerStatus/list"'*)
      while [ ! -e "$(dirname "$0")/release" ]; do sleep 0.05; done
      printf '{"id":1,"result":{"data":[{"name":"%s","runtimeStatus":null,"pluginId":null,"httpOrigin":"https://docs.example","serverInfo":{"name":"docs"},"tools":{"search":{}},"toolsError":null,"authStatus":"bearerToken"}],"nextCursor":null}}\n' "$(basename "$PWD")";;
  esac
done
"#;

const FAILING_SCRIPT: &str = r#"
echo probe >> "$(dirname "$0")/probes"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":0,"result":{}}\n';;
    *'"method":"mcpServerStatus/list"'*) printf '{"id":1,"error":{"code":-32600,"message":"unsupported"}}\n';;
  esac
done
"#;

fn released(label: &str) -> Fixture {
    let fixture = Fixture::create(label, STATUS_SCRIPT);
    fixture.release();
    fixture
}

fn ready(label: &str) -> Fixture {
    let fixture = released(label);
    fixture.register();
    fixture.set_trust(true);
    fixture.enable_codex();
    fixture
}

#[test]
fn the_command_name_matches_the_wire_contract() {
    let contract: serde_json::Value = serde_json::from_slice(CONTRACT).unwrap();
    let command = std::any::type_name_of_val(&get_agent_mcp_servers);
    assert_eq!(command.rsplit("::").next(), contract["ipcCommand"].as_str());
}

#[test]
fn an_invalid_request_is_rejected_before_any_authority_is_captured() {
    let request = AgentMcpServersRequest {
        repository_root: "relative".to_string(),
        provider: CODEX,
    };
    assert_eq!(
        validate_request(&request).err().as_deref(),
        Some(INVALID_REQUEST_ERROR)
    );
}

#[test]
fn an_unregistered_workspace_fails_closed_without_spawning_the_provider() {
    let fixture = released("unregistered");
    fixture.set_trust(true);
    fixture.enable_codex();
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(
        fixture
            .check(&fixture.directory.join("missing"))
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
}

#[test]
fn an_untrusted_workspace_fails_closed_without_spawning_the_provider() {
    let fixture = released("untrusted");
    fixture.register();
    fixture.enable_codex();
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
}

#[test]
fn a_disabled_provider_fails_closed_without_spawning_the_provider() {
    let fixture = released("disabled");
    fixture.register();
    fixture.set_trust(true);
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    let generation = fixture.register_codex(1, None, false);
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    fixture.register_codex(2, Some(generation), true);
    assert!(fixture.check(&fixture.workspace).is_ok());
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_registered_trusted_workspace_is_probed_in_its_root_on_every_call() {
    let fixture = ready("registered");
    let servers = fixture.check(&fixture.workspace).expect("servers");
    assert_eq!(
        serde_json::to_value(&servers).unwrap(),
        serde_json::json!({
            "version": 1,
            "provider": "codex",
            "truncated": false,
            "servers": [{
                "name": "workspace",
                "status": "connected",
                "scope": "unknown",
                "transport": "http",
                "endpointOrigin": "https://docs.example",
                "toolCount": 1,
                "detail": null,
            }],
        })
    );
    assert_eq!(fixture.probe_count(), 1);
    assert_eq!(fixture.check(&fixture.workspace), Ok(servers));
    assert_eq!(fixture.probe_count(), 2);
}

#[test]
fn a_nested_repository_resolves_through_its_registered_project_authority() {
    let fixture = ready("nested");
    let nested = fixture.workspace.join("packages/app");
    let servers = fixture.check(&nested).expect("nested servers");
    assert_eq!(servers.servers[0].name, "app");
    let outside = fixture
        .directory
        .canonicalize()
        .expect("canonical directory");
    assert_eq!(
        fixture.check(&outside).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_failing_provider_probe_is_reported_as_unavailable() {
    let fixture = Fixture::create("failing", FAILING_SCRIPT);
    fixture.register();
    fixture.set_trust(true);
    fixture.enable_codex();
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    assert_ne!(
        AGENT_MCP_SERVERS_UNAVAILABLE_ERROR,
        AGENT_MCP_SERVERS_TIMED_OUT_ERROR
    );
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn revoked_trust_invalidates_a_captured_authority() {
    let fixture = ready("revoked-trust");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let checked = fixture.check_only(&authority).expect("checked servers");
    fixture.set_trust(false);
    assert_eq!(
        fixture
            .publish(&authority, checked.clone())
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(
        fixture.check_only(&authority).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
    fixture.set_trust(true);
    assert_eq!(
        fixture.publish(&authority, checked).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(
        authority
            .revalidate(&fixture.registry, &fixture.trust)
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
    );
    assert_eq!(
        fixture.check_only(&authority).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
    assert!(fixture.check(&fixture.workspace).is_ok());
}

#[test]
fn trust_revocation_is_refused_while_the_provider_runs_and_the_result_is_kept() {
    let fixture = Fixture::create("revoked-during-probe", STATUS_SCRIPT);
    fixture.register();
    fixture.set_trust(true);
    fixture.enable_codex();
    let pending = fixture.capture(&fixture.workspace).expect("authority");
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.check_only(&pending));
        fixture.wait_for_probe_count(1);
        let revoked = fixture
            .trust
            .lock()
            .unwrap()
            .set(fixture.workspace.to_str().unwrap(), false);
        assert_eq!(
            revoked.err().map(|error| error.kind()),
            Some(std::io::ErrorKind::WouldBlock)
        );
        fixture.release();
        let checked = worker.join().unwrap().expect("checked servers");
        assert_eq!(checked.servers.provider, CODEX);
        assert_eq!(checked.servers.servers.len(), 1);
        assert_eq!(checked.servers.servers[0].name, "workspace");
        assert_eq!(
            checked.servers.servers[0].status,
            AgentMcpServerStatus::Connected
        );
        assert!(fixture.publish(&pending, checked).is_ok());
    });
    fixture.set_trust(false);
    assert_eq!(
        fixture.check(&fixture.workspace).err().as_deref(),
        Some(AGENT_MCP_SERVERS_UNTRUSTED_WORKSPACE_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_snapshot_for_another_provider_is_never_published() {
    let fixture = ready("foreign-provider");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let checked = fixture.check_only(&authority).expect("checked servers");
    let foreign = CheckedMcpServers {
        servers: AgentMcpServers {
            provider: AgentCliInvocation::ClaudeCode,
            ..checked.servers.clone()
        },
        generation: checked.generation,
    };
    assert_eq!(
        fixture
            .publish(&authority, foreign.clone())
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    assert_eq!(
        publish_servers(
            &fixture.providers,
            &fixture.registry,
            &fixture.trust,
            &authority,
            AgentCliInvocation::ClaudeCode,
            foreign,
        )
        .err()
        .as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    assert!(fixture.publish(&authority, checked).is_ok());
}

#[test]
fn a_replaced_registration_is_never_served_from_the_previous_one() {
    let fixture = Fixture::create("reregistered", STATUS_SCRIPT);
    let first = fixture.register();
    fixture.set_trust(true);
    fixture.enable_codex();
    let pending = fixture.capture(&fixture.workspace).expect("authority");
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.check_only(&pending));
        fixture.wait_for_probe_count(1);
        fixture
            .registry
            .unregister(&first.workspace_id)
            .expect("unregister first registration");
        let second = fixture.register();
        assert_ne!(second.workspace_id, first.workspace_id);
        fixture.release();
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
        );
        assert_eq!(
            pending
                .revalidate_registration(&fixture.registry, &fixture.trust)
                .err()
                .as_deref(),
            Some(AGENT_MCP_SERVERS_UNKNOWN_WORKSPACE_ERROR)
        );
        let servers = fixture
            .check(&fixture.workspace)
            .expect("second registration servers");
        assert_eq!(servers.servers[0].status, AgentMcpServerStatus::Connected);
        assert_eq!(fixture.probe_count(), 2);
    });
}

#[test]
fn checked_servers_are_not_published_once_the_provider_is_replaced_or_disabled() {
    let fixture = ready("provider-after-worker");
    let generation = provider_generation(&fixture.providers, CODEX).expect("generation");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let checked = fixture.check_only(&authority).expect("checked servers");
    assert_eq!(checked.generation, generation);
    assert!(fixture.publish(&authority, checked.clone()).is_ok());
    let replaced = fixture.register_codex(2, Some(generation), true);
    assert_ne!(replaced, generation);
    assert_eq!(
        fixture
            .publish(&authority, checked.clone())
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVERS_UNAVAILABLE_ERROR)
    );
    fixture.register_codex(3, Some(replaced), false);
    assert_eq!(
        fixture.publish(&authority, checked).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(
        fixture.check_only(&authority).err().as_deref(),
        Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
    );
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn a_provider_disabled_while_it_runs_cancels_the_probe() {
    let fixture = Fixture::create("disabled-during-probe", STATUS_SCRIPT);
    fixture.register();
    fixture.set_trust(true);
    let generation = fixture.enable_codex();
    let pending = fixture.capture(&fixture.workspace).expect("authority");
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| fixture.check_only(&pending));
        fixture.wait_for_probe_count(1);
        fixture.register_codex(2, Some(generation), false);
        let started = Instant::now();
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some(AGENT_MCP_SERVERS_PROVIDER_DISABLED_ERROR)
        );
        assert!(started.elapsed() < Duration::from_secs(10));
    });
}

#[test]
fn exhausted_trust_launch_capacity_is_reported_as_busy() {
    let fixture = ready("trust-capacity");
    let authority = fixture.capture(&fixture.workspace).expect("authority");
    let mut leases = Vec::new();
    let exhausted = loop {
        match authority.reserve_trust(&fixture.trust) {
            Ok(lease) => leases.push(lease),
            Err(error) => break error,
        }
        assert!(leases.len() < 100_000, "trust launch capacity is unbounded");
    };
    assert_eq!(exhausted, AGENT_MCP_SERVERS_BUSY_ERROR);
    assert_eq!(
        fixture.check_only(&authority).err().as_deref(),
        Some(AGENT_MCP_SERVERS_BUSY_ERROR)
    );
    assert_eq!(fixture.probe_count(), 0);
    drop(leases);
    assert!(fixture.check_only(&authority).is_ok());
    assert_eq!(fixture.probe_count(), 1);
}

#[test]
fn at_most_two_probes_hold_a_permit_and_the_next_one_is_busy() {
    static ACTIVE: AtomicUsize = AtomicUsize::new(0);
    let first = McpProbePermit::acquire(&ACTIVE).expect("first permit");
    let second = McpProbePermit::acquire(&ACTIVE).expect("second permit");
    assert_eq!(ACTIVE.load(Ordering::Acquire), MAX_CONCURRENT_MCP_PROBES);
    assert_eq!(
        McpProbePermit::acquire(&ACTIVE).err().as_deref(),
        Some(AGENT_MCP_SERVERS_BUSY_ERROR)
    );
    assert_eq!(ACTIVE.load(Ordering::Acquire), MAX_CONCURRENT_MCP_PROBES);
    drop(first);
    let third = McpProbePermit::acquire(&ACTIVE).expect("released permit");
    assert!(McpProbePermit::acquire(&ACTIVE).is_err());
    let unwound = std::panic::catch_unwind(move || {
        let _held = third;
        panic!("probe panicked");
    });
    assert!(unwound.is_err());
    assert_eq!(ACTIVE.load(Ordering::Acquire), 1);
    drop(second);
    assert_eq!(ACTIVE.load(Ordering::Acquire), 0);
    assert_eq!(MAX_CONCURRENT_MCP_PROBES, 2);
}
