use super::*;
use crate::agent_mcp_server_manage_domain::AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR as CHANGE_UNSUPPORTED;
use crate::agent_mcp_servers_domain::{
    AGENT_MCP_SERVERS_BUSY_ERROR as BUSY, AGENT_MCP_SERVERS_UNAVAILABLE_ERROR as UNAVAILABLE,
    AGENT_MCP_SERVERS_UNSUPPORTED_RUNNER_ERROR as UNSUPPORTED_RUNNER,
};
use crate::remote_runner::mcp_device_config::{DeviceMcpTransport, Disposition};
use crate::remote_runner::mcp_device_config_fs::config_path;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const SERVER: &str = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const RUNNER: &str = "runner-home";
const PROJECT: &str = "codevo-editor";
const ROUTE: &str = "/v1/projects/codevo-editor/mcp-servers/claude/device-sync";

fn request(fields: Value) -> Value {
    let mut value = json!({
        "serverId": SERVER,
        "runnerId": RUNNER,
        "projectId": PROJECT,
        "rootPath": "/Users/dev/work",
        "projectKind": "folder",
    });
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

fn admitted(value: Value) -> Result<String, String> {
    serde_json::from_value::<DeviceMcpSyncRequest>(value)
        .map_err(|_| "deserialize".to_string())?
        .admitted()
        .map_err(String::from)
}

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "codevo-mcp-device-sync-{label}-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn trust(&self) -> Mutex<WorkspaceTrustService> {
        Mutex::new(WorkspaceTrustService::load(self.root.with_extension("trust.json")).unwrap())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(self.root.with_extension("moved"));
        let _ = std::fs::remove_file(self.root.with_extension("trust.json"));
    }
}

fn device_config(root: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "mcpServers": { "user_tool": { "command": "npx" } },
        "projects": {
            root: { "mcpServers": { "root_tool": { "type": "http", "url": "https://x.example/mcp" } } },
            format!("{root}/nested"): { "mcpServers": { "nested_tool": { "command": "uvx" } } },
        },
    }))
    .unwrap()
}

fn collected(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    root_path: &str,
    kind: ProjectKind,
    read: impl FnOnce() -> Result<Option<Vec<u8>>, &'static str>,
) -> Result<DeviceMcpSelection, String> {
    collect(registry, trust, root_path, kind, read).map(|(_, selection)| selection)
}

#[test]
fn the_command_carries_its_contract_name_and_is_registered() {
    let name = std::any::type_name_of_val(&remote_runner_sync_device_mcp_servers);
    assert_eq!(
        name.rsplit("::").next(),
        Some("remote_runner_sync_device_mcp_servers")
    );
    assert_eq!(CAPABILITY, "mcpDeviceSync");
    let runtime = include_str!("../lib_composition/runtime.rs");
    assert_eq!(
        runtime
            .matches("crate::remote_runner::remote_runner_sync_device_mcp_servers,")
            .count(),
        1
    );
}

#[test]
fn the_request_envelope_is_closed_camel_case_and_bounded() {
    assert_eq!(admitted(request(json!({}))), Ok(ROUTE.to_string()));
    assert_eq!(
        admitted(request(json!({ "projectKind": "git" }))),
        Ok(ROUTE.to_string())
    );
    for (field, value) in [
        ("provider", json!("claude")),
        ("server_id", json!(SERVER)),
        ("servers", json!([])),
        ("extra", json!(true)),
    ] {
        assert_eq!(
            admitted(request(json!({ field: value }))),
            Err("deserialize".to_string()),
            "{field}"
        );
    }
    for missing in [
        "serverId",
        "runnerId",
        "projectId",
        "rootPath",
        "projectKind",
    ] {
        let mut value = request(json!({}));
        value.as_object_mut().unwrap().remove(missing);
        assert_eq!(admitted(value), Err("deserialize".to_string()), "{missing}");
    }
    for kind in ["Folder", "repository", "", "codex"] {
        assert_eq!(
            admitted(request(json!({ "projectKind": kind }))),
            Err("deserialize".to_string()),
            "{kind}"
        );
    }
    for fields in [
        json!({ "serverId": "../x" }),
        json!({ "serverId": "" }),
        json!({ "runnerId": "run\nner" }),
        json!({ "runnerId": " " }),
        json!({ "runnerId": "r".repeat(129) }),
        json!({ "projectId": "../runner" }),
        json!({ "projectId": "a/b" }),
        json!({ "projectId": "x".repeat(65) }),
        json!({ "rootPath": "" }),
        json!({ "rootPath": "/a\u{0}b" }),
        json!({ "rootPath": format!("/{}", "x".repeat(4096)) }),
    ] {
        assert_eq!(
            admitted(request(fields.clone())),
            Err(INVALID_REQUEST.to_string()),
            "{fields}"
        );
    }
}

#[test]
fn only_one_sync_is_in_flight_at_a_time() {
    let first = SyncPermit::acquire().expect("first");
    assert_eq!(SyncPermit::acquire().err(), Some(SYNC_BUSY));
    drop(first);
    let again = SyncPermit::acquire().expect("released");
    drop(again);
}

#[test]
fn the_device_config_is_located_in_the_claude_config_dir_or_home() {
    let dir = |value: &str| Some(OsString::from(value));
    assert_eq!(
        config_path(dir("/c"), dir("/h")),
        Ok(PathBuf::from("/c/.claude.json"))
    );
    assert_eq!(
        config_path(None, dir("/h")),
        Ok(PathBuf::from("/h/.claude.json"))
    );
    assert_eq!(
        config_path(dir(""), dir("/h")),
        Ok(PathBuf::from("/h/.claude.json"))
    );
    assert!(config_path(None, None).is_err());
    assert!(config_path(None, dir("")).is_err());
}

#[test]
fn the_device_config_read_is_bounded_and_regular_file_only() {
    let fixture = Fixture::new("read");
    let missing = fixture.root.join("absent.json");
    assert_eq!(read_bounded(&missing), Ok(None));
    let file = fixture.root.join(".claude.json");
    std::fs::write(&file, b"{}").unwrap();
    assert_eq!(read_bounded(&file), Ok(Some(b"{}".to_vec())));
    assert!(read_bounded(&fixture.root).is_err());
    let fifo = fixture.root.join("fifo");
    let name = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    assert!(read_bounded(&fifo).is_err());
    let oversize = std::fs::File::create(fixture.root.join("big.json")).unwrap();
    oversize
        .set_len(crate::remote_runner::mcp_device_config::MAX_DEVICE_CONFIG_BYTES as u64 + 1)
        .unwrap();
    let refused = read_bounded(&fixture.root.join("big.json")).unwrap_err();
    assert!(refused.contains("too large"));
}

#[test]
fn an_unregistered_or_invalid_root_is_refused_before_reading() {
    let fixture = Fixture::new("unregistered");
    let registry = WorkspaceRegistry::new();
    let trust = fixture.trust();
    let root = fixture.root.to_str().unwrap().to_owned();
    for candidate in [root.as_str(), "", "/a\u{0}b", "/unregistered"] {
        let refused = collected(&registry, &trust, candidate, ProjectKind::Folder, || {
            panic!("read before authority")
        });
        assert!(refused.is_err(), "{candidate:?}");
    }
}

#[test]
fn an_untrusted_root_is_refused_before_reading() {
    let fixture = Fixture::new("untrusted");
    let registry = WorkspaceRegistry::new();
    registry.register(&fixture.root).unwrap();
    let trust = fixture.trust();
    let refused = collected(
        &registry,
        &trust,
        fixture.root.to_str().unwrap(),
        ProjectKind::Folder,
        || panic!("untrusted read"),
    )
    .unwrap_err();
    assert!(refused.contains("Trust this workspace"));
}

#[test]
fn a_trusted_root_selects_by_its_canonical_key_and_project_kind() {
    let fixture = Fixture::new("trusted");
    let registry = WorkspaceRegistry::new();
    let descriptor = registry.register(&fixture.root).unwrap();
    let canonical = descriptor.canonical_root_path.to_str().unwrap().to_owned();
    let trust = fixture.trust();
    trust.lock().unwrap().set(&canonical, true).unwrap();
    let names = |kind: ProjectKind| -> Vec<String> {
        collected(
            &registry,
            &trust,
            fixture.root.to_str().unwrap(),
            kind,
            || Ok(Some(device_config(&canonical))),
        )
        .unwrap()
        .entries
        .into_iter()
        .map(|entry| entry.name)
        .collect()
    };
    assert_eq!(
        names(ProjectKind::Folder),
        ["nested_tool", "root_tool", "user_tool"]
    );
    assert_eq!(names(ProjectKind::Git), ["root_tool", "user_tool"]);
    let empty = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        Ok(None)
    })
    .unwrap();
    assert!(empty.entries.is_empty());
    let unreadable = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        Err("The Claude configuration on this Mac could not be read.")
    })
    .unwrap_err();
    assert!(unreadable.contains("could not be read"));
    let invalid = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        Ok(Some(b"{\"mcpServers\":[]}".to_vec()))
    })
    .unwrap_err();
    assert!(invalid.contains("not valid"));
}

#[test]
fn a_trust_flip_during_the_read_is_refused() {
    let fixture = Fixture::new("trust-flip");
    let registry = WorkspaceRegistry::new();
    let descriptor = registry.register(&fixture.root).unwrap();
    let canonical = descriptor.canonical_root_path.to_str().unwrap().to_owned();
    let trust = fixture.trust();
    trust.lock().unwrap().set(&canonical, true).unwrap();
    let refused = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        trust.lock().unwrap().set(&canonical, false).unwrap();
        trust.lock().unwrap().set(&canonical, true).unwrap();
        Ok(Some(device_config(&canonical)))
    })
    .unwrap_err();
    assert!(refused.contains("trust changed"));
    let revoked = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        trust.lock().unwrap().set(&canonical, false).unwrap();
        Ok(None)
    })
    .unwrap_err();
    assert!(revoked.contains("trust changed"));
}

#[test]
fn a_folder_swap_during_the_read_is_refused() {
    let fixture = Fixture::new("swap");
    let registry = WorkspaceRegistry::new();
    let descriptor = registry.register(&fixture.root).unwrap();
    let canonical = descriptor.canonical_root_path.to_str().unwrap().to_owned();
    let trust = fixture.trust();
    trust.lock().unwrap().set(&canonical, true).unwrap();
    let moved = fixture.root.with_extension("moved");
    let refused = collected(&registry, &trust, &canonical, ProjectKind::Folder, || {
        std::fs::rename(&fixture.root, &moved).unwrap();
        std::fs::create_dir(&fixture.root).unwrap();
        Ok(Some(device_config(&canonical)))
    })
    .unwrap_err();
    assert!(refused.contains("identity changed"), "{refused}");
    assert!(Path::new(&moved).exists());
}

#[cfg(unix)]
mod peer {
    use super::*;
    use crate::remote_runner::{
        mcp_device_config::select, mcp_device_sync_wire::MAX_OUTPUT, transport::Session,
        types::Server,
    };
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{atomic::AtomicBool, Arc};
    use std::thread::JoinHandle;
    use std::time::Duration;

    struct Received {
        head: String,
        body: String,
    }

    type Hook = Box<dyn FnMut(usize) + Send>;

    struct Workspace {
        fixture: Fixture,
        registry: WorkspaceRegistry,
        trust: Arc<Mutex<WorkspaceTrustService>>,
        canonical: String,
    }

    impl Workspace {
        fn trusted(label: &str) -> Self {
            let fixture = Fixture::new(label);
            let registry = WorkspaceRegistry::new();
            let descriptor = registry.register(&fixture.root).unwrap();
            let canonical = descriptor.canonical_root_path.to_str().unwrap().to_owned();
            let trust = Arc::new(fixture.trust());
            trust.lock().unwrap().set(&canonical, true).unwrap();
            Self {
                fixture,
                registry,
                trust,
                canonical,
            }
        }
    }

    struct FakeRunner {
        lease: ConnectionLease,
        stop: Arc<AtomicBool>,
        serving: JoinHandle<Vec<Received>>,
    }

    fn read_request(socket: &mut UnixStream) -> Option<Received> {
        socket.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).ok()?;
            head.push(byte[0]);
        }
        let head = String::from_utf8(head).ok()?;
        let length = head
            .lines()
            .find_map(|line| line.strip_prefix("content-length: "))
            .map_or(Some(0), |length| length.parse::<usize>().ok())?;
        let mut body = vec![0; length];
        socket.read_exact(&mut body).ok()?;
        Some(Received {
            head,
            body: String::from_utf8(body).ok()?,
        })
    }

    fn serve(
        listener: UnixListener,
        responses: Vec<(u16, String)>,
        stop: Arc<AtomicBool>,
        mut hook: Hook,
    ) -> Vec<Received> {
        let mut responses = responses.into_iter();
        let mut received = Vec::new();
        while !stop.load(Ordering::Acquire) {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            if socket.set_nonblocking(false).is_err() {
                continue;
            }
            let Some(request) = read_request(&mut socket) else {
                continue;
            };
            received.push(request);
            hook(received.len() - 1);
            let (status, body) = responses
                .next()
                .unwrap_or((500, "{\"error\":\"internal_error\"}".to_string()));
            let _ = write!(
                socket,
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
        received
    }

    fn descriptor(capabilities: Value) -> String {
        let mut descriptor = json!({
            "protocolVersion": 1,
            "runnerId": RUNNER,
            "name": "Server",
            "capabilities": { "taskExecution": true, "eventReplay": true },
        });
        for (name, value) in capabilities.as_object().unwrap() {
            descriptor["capabilities"][name] = value.clone();
        }
        descriptor.to_string()
    }

    fn syncing() -> String {
        descriptor(json!({ "mcpServerManagement": true, "mcpDeviceSync": true }))
    }

    impl FakeRunner {
        fn serving(responses: Vec<(u16, String)>) -> Self {
            Self::hooked(responses, Box::new(|_| {}))
        }

        fn hooked(responses: Vec<(u16, String)>, hook: Hook) -> Self {
            let session = Arc::new(Session::fixture());
            let listener = UnixListener::bind(session.socket_path()).unwrap();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = Arc::clone(&stop);
            let serving = std::thread::spawn(move || serve(listener, responses, stopped, hook));
            let server = Server {
                id: "fixture".into(),
                name: "Fixture".into(),
                host: "localhost".into(),
                username: "test".into(),
                port: 22,
                connected: true,
                runner_id: Some(RUNNER.into()),
            };
            Self {
                lease: ConnectionLease::new(server, session),
                stop,
                serving,
            }
        }

        fn admitted(response: (u16, String)) -> Self {
            Self::serving(vec![(200, syncing()), (200, syncing()), response])
        }

        fn run(&self, selection: &DeviceMcpSelection) -> Result<DeviceMcpSyncReport, String> {
            self.run_in(&Workspace::trusted("peer"), selection)
        }

        fn run_in(
            &self,
            workspace: &Workspace,
            selection: &DeviceMcpSelection,
        ) -> Result<DeviceMcpSyncReport, String> {
            let Ok((authority, _)) = collect(
                &workspace.registry,
                &workspace.trust,
                &workspace.canonical,
                ProjectKind::Git,
                || Ok(None),
            ) else {
                panic!("workspace authority");
            };
            synchronize(&authority, &self.lease, ROUTE, selection)
        }

        fn received(self) -> Vec<Received> {
            self.stop.store(true, Ordering::Release);
            let received = self.serving.join().unwrap();
            for request in &received {
                let tokens = |name: &str| -> Vec<String> {
                    request
                        .head
                        .lines()
                        .find_map(|line| line.strip_prefix(&format!("{name}: ")))
                        .map(|tokens| tokens.split(',').map(str::to_owned).collect())
                        .unwrap_or_default()
                };
                let first = tokens("x-codevo-client-capabilities");
                let second = tokens("x-codevo-client-capabilities-2");
                assert!(first.contains(&"mcpServerManagement".to_string()));
                assert!(!first.contains(&CAPABILITY.to_string()));
                assert_eq!(second, [CAPABILITY]);
            }
            received
        }
    }

    fn sample() -> DeviceMcpSelection {
        let config = json!({ "mcpServers": {
            "files": { "command": "npx", "env": { "TOKEN": "env-secret-value" } },
            "linear": { "type": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer header-secret-value" } },
            "socket": { "type": "ws", "url": "wss://x.example" },
        } });
        select(
            &serde_json::to_vec(&config).unwrap(),
            "/Users/dev/work",
            ProjectKind::Git,
        )
        .unwrap()
    }

    fn answer() -> Value {
        json!({ "version": 1, "results": [
            { "name": "files", "outcome": "added" },
            { "name": "linear", "outcome": "commandMissing" },
            { "name": "gone", "outcome": "removed" },
        ] })
    }

    #[test]
    fn a_sync_admits_the_capability_and_puts_the_exact_body_once() {
        let selection = sample();
        let runner = FakeRunner::admitted((200, answer().to_string()));
        let report = runner.run(&selection).expect("report");
        let report = serde_json::to_value(&report).unwrap();
        assert_eq!(report["omitted"], json!(0));
        assert_eq!(
            report["results"],
            json!([
                { "name": "files", "transport": "stdio", "outcome": "added", "hints": [] },
                { "name": "gone", "transport": "unknown", "outcome": "removed", "hints": [] },
                { "name": "linear", "transport": "http", "outcome": "commandMissing", "hints": [] },
                { "name": "socket", "transport": "unknown", "outcome": "skipped", "hints": ["unsupportedTransport"] },
            ])
        );
        assert!(!report.to_string().contains("secret-value"));
        let received = runner.received();
        let lines: Vec<&str> = received
            .iter()
            .map(|request| request.head.lines().next().unwrap_or_default())
            .collect();
        assert_eq!(
            lines,
            [
                "GET /v1/runner HTTP/1.1",
                "GET /v1/runner HTTP/1.1",
                &format!("PUT {ROUTE} HTTP/1.1"),
            ]
        );
        let sent: Value = serde_json::from_str(&received[2].body).unwrap();
        assert_eq!(sent, request_body_value(&selection));
        assert!(received[2]
            .head
            .contains("content-type: application/json\r\n"));
    }

    fn request_body_value(selection: &DeviceMcpSelection) -> Value {
        crate::remote_runner::mcp_device_sync_wire::request_body(selection).unwrap()
    }

    #[test]
    fn a_runner_without_the_capability_is_unsupported_and_never_receives_the_body() {
        for capabilities in [
            json!({}),
            json!({ "mcpServerManagement": true }),
            json!({ "mcpServerManagement": true, "mcpDeviceSync": false }),
        ] {
            let runner = FakeRunner::serving(vec![
                (200, descriptor(capabilities.clone())),
                (200, answer().to_string()),
            ]);
            assert_eq!(
                runner.run(&sample()).err().as_deref(),
                Some(UNSUPPORTED_RUNNER)
            );
            let received = runner.received();
            assert_eq!(received.len(), 1, "{capabilities}");
            assert!(received[0].head.starts_with("GET /v1/runner "));
        }
        let invalid =
            FakeRunner::serving(vec![(200, descriptor(json!({ "mcpDeviceSync": "true" })))]);
        assert_eq!(
            invalid.run(&sample()).err().as_deref(),
            Some(SERVER_UNAVAILABLE)
        );
        invalid.received();
    }

    #[test]
    fn runner_refusals_map_to_contract_errors_without_configuration_values() {
        for (status, body, expected) in [
            (503, "{\"error\":\"busy\"}", BUSY),
            (
                409,
                "{\"error\":\"mcp_change_unsupported\"}",
                CHANGE_UNSUPPORTED,
            ),
            (400, "{\"error\":\"invalid_input\"}", INVALID_REQUEST),
            (503, "{\"error\":\"storage_unavailable\"}", UNAVAILABLE),
            (413, "{\"error\":\"too_large\"}", UNAVAILABLE),
            (500, "{\"error\":\"internal_error\"}", SERVER_UNAVAILABLE),
            (
                409,
                "{\"error\":\"runner_identity_mismatch\"}",
                SERVER_UNAVAILABLE,
            ),
            (
                200,
                "{\"version\":1,\"results\":[{\"name\":\"x\",\"outcome\":\"added\"}]}",
                UNAVAILABLE,
            ),
            (
                200,
                "{\"version\":1,\"results\":[],\"token\":\"env-secret-value\"}",
                UNAVAILABLE,
            ),
            (200, "not json", UNAVAILABLE),
        ] {
            let runner = FakeRunner::admitted((status, body.to_string()));
            let error = runner.run(&sample()).unwrap_err();
            assert_eq!(error, expected, "{status} {body}");
            assert!(!error.contains("secret"));
            assert_eq!(runner.received().len(), 3, "{status} {body}");
        }
    }

    #[test]
    fn an_answer_is_accepted_at_the_size_limit_and_unavailable_above_it() {
        let body = answer().to_string();
        let padded = |bytes: usize| format!("{body}{}", " ".repeat(bytes - body.len()));
        let runner = FakeRunner::admitted((200, padded(MAX_OUTPUT)));
        assert!(runner.run(&sample()).is_ok());
        runner.received();
        let runner = FakeRunner::admitted((200, padded(MAX_OUTPUT + 1)));
        assert_eq!(runner.run(&sample()).err().as_deref(), Some(UNAVAILABLE));
        runner.received();
    }

    #[test]
    fn an_oversize_body_is_refused_before_any_request() {
        let env: serde_json::Map<String, Value> = (0..3)
            .map(|index| (format!("K{index}"), json!("s".repeat(8192))))
            .collect();
        let servers: serde_json::Map<String, Value> = (0..11)
            .map(|index| {
                (
                    format!("s{index:02}"),
                    json!({ "command": "x", "env": env }),
                )
            })
            .collect();
        let config = json!({ "mcpServers": servers });
        let selection = select(
            &serde_json::to_vec(&config).unwrap(),
            "/Users/dev/work",
            ProjectKind::Git,
        )
        .unwrap();
        assert_eq!(selection.transferable().count(), 11);
        assert!(selection
            .entries
            .iter()
            .all(|entry| entry.transport == DeviceMcpTransport::Stdio
                && matches!(entry.disposition, Disposition::Transfer(_))));
        let runner = FakeRunner::admitted((200, answer().to_string()));
        let error = runner.run(&selection).unwrap_err();
        assert!(!error.contains("sss"));
        assert!(runner.received().is_empty());
    }

    #[test]
    fn a_superseded_connection_never_reaches_the_runner() {
        let runner = FakeRunner::admitted((200, answer().to_string()));
        assert_eq!(ensure_exact_runner(&runner.lease, RUNNER), Ok(()));
        assert_eq!(
            ensure_exact_runner(&runner.lease, "replacement"),
            Err(SERVER_UNAVAILABLE)
        );
        runner.lease.revoke();
        assert_eq!(
            ensure_exact_runner(&runner.lease, RUNNER),
            Err(SERVER_UNAVAILABLE)
        );
        assert_eq!(
            runner.run(&sample()).err().as_deref(),
            Some(SERVER_UNAVAILABLE)
        );
        assert!(runner.received().is_empty());
    }

    fn revoked_between_read_and_put(revoke: impl FnOnce(&Workspace) -> Hook) -> (String, usize) {
        let workspace = Workspace::trusted("revoked");
        let runner = FakeRunner::hooked(
            vec![
                (200, syncing()),
                (200, syncing()),
                (200, answer().to_string()),
            ],
            revoke(&workspace),
        );
        let error = runner.run_in(&workspace, &sample()).unwrap_err();
        let received = runner.received();
        assert!(received
            .iter()
            .all(|request| request.head.starts_with("GET /v1/runner ")));
        assert!(error.len() < 128 && !error.contains("secret"), "{error}");
        (error, received.len())
    }

    #[test]
    fn trust_revoked_while_the_runner_is_admitted_stops_the_put() {
        let (error, requests) = revoked_between_read_and_put(|workspace| {
            let trust = Arc::clone(&workspace.trust);
            let canonical = workspace.canonical.clone();
            Box::new(move |index| {
                if index == 0 {
                    trust.lock().unwrap().set(&canonical, false).unwrap();
                }
            })
        });
        assert!(error.contains("trust changed"), "{error}");
        assert_eq!(requests, 1);
    }

    #[test]
    fn a_folder_replaced_while_the_runner_is_admitted_stops_the_put() {
        let (error, requests) = revoked_between_read_and_put(|workspace| {
            let root = workspace.fixture.root.clone();
            Box::new(move |index| {
                if index == 0 {
                    std::fs::rename(&root, root.with_extension("moved")).unwrap();
                    std::fs::create_dir(&root).unwrap();
                }
            })
        });
        assert!(
            error.contains("identity changed") || error.contains("no longer registered"),
            "{error}"
        );
        assert_eq!(requests, 1);
    }
}
