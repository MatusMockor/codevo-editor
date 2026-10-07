use super::*;
use serde_json::json;

const CONTRACT: &[u8] = include_bytes!("../../../contracts/agent-mcp-servers-wire.json");
const SERVER: &str = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const RUNNER: &str = "runner-home";

fn contract() -> Value {
    serde_json::from_slice(CONTRACT).unwrap()
}

fn contract_cases(key: &str) -> Vec<(String, Value)> {
    let cases: Vec<(String, Value)> = contract()[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            (
                case["name"].as_str().unwrap().to_string(),
                case["value"].clone(),
            )
        })
        .collect();
    assert!(!cases.is_empty(), "{key}");
    cases
}

fn request(value: Value) -> Result<McpServersRequest, String> {
    let request: McpServersRequest =
        serde_json::from_value(value).map_err(|_| "deserialize".to_string())?;
    request.admitted_path()?;
    Ok(request)
}

fn request_for(project: &str, provider: &str) -> Result<McpServersRequest, String> {
    request(
        json!({"serverId": SERVER, "runnerId": RUNNER, "projectId": project, "provider": provider}),
    )
}

fn runner_provider(local: &str) -> Provider {
    let name = contract()["remoteRunnerProviders"][local].clone();
    serde_json::from_value(name).unwrap_or_else(|_| panic!("unknown local provider {local}"))
}

fn relabelled(mut value: Value, provider: &str) -> Value {
    value["provider"] = provider.into();
    value
}

fn descriptor(runner: &str, capability: Value) -> Value {
    let mut descriptor = json!({
        "protocolVersion": 1,
        "runnerId": runner,
        "name": "Server",
        "capabilities": {"taskExecution": true, "eventReplay": true},
    });
    if !capability.is_null() {
        descriptor["capabilities"][CAPABILITY] = capability;
    }
    descriptor
}

fn runner_servers(provider: &str) -> Value {
    json!({
        "version": 1,
        "provider": provider,
        "truncated": false,
        "servers": [{
            "name": "docs",
            "status": "failed",
            "scope": "unknown",
            "transport": "stdio",
            "endpointOrigin": null,
            "toolCount": 0,
            "detail": "Connection closed",
        }],
    })
}

#[test]
fn the_command_capability_and_route_match_the_wire_contract() {
    let contract = contract();
    let command = std::any::type_name_of_val(&remote_runner_get_mcp_servers);
    assert_eq!(
        command.rsplit("::").next(),
        contract["remoteIpcCommand"].as_str()
    );
    assert_eq!(contract["remoteRunnerCapability"], json!(CAPABILITY));
    let template = contract["remoteRunnerRoute"].as_str().unwrap();
    for provider in [Provider::Claude, Provider::Codex] {
        let expected = template
            .replace("{projectId}", "codevo-editor")
            .replace("{claude|codex}", provider.segment());
        assert_eq!(
            request_for("codevo-editor", provider.segment())
                .unwrap()
                .admitted_path()
                .unwrap(),
            expected
        );
        assert!(crate::remote_runner::transport::is_mcp_servers_route(
            "GET", &expected
        ));
    }
}

#[test]
fn runner_provider_names_match_the_wire_contract_and_relabel_to_the_local_ones() {
    let providers = contract()["remoteRunnerProviders"].clone();
    assert_eq!(providers.as_object().unwrap().len(), 2);
    for provider in [Provider::Claude, Provider::Codex] {
        let local = serde_json::to_value(provider.local()).unwrap();
        assert_eq!(
            providers[local.as_str().unwrap()],
            json!(provider.segment()),
            "{provider:?}"
        );
        assert_eq!(
            serde_json::from_value::<Provider>(json!(provider.segment())).unwrap(),
            provider
        );
    }
}

#[test]
fn the_remote_errors_are_contract_errors() {
    let errors = contract()["errors"].clone();
    assert_eq!(errors["unsupportedRunner"], json!(UNSUPPORTED_RUNNER));
    assert_eq!(errors["serverUnavailable"], json!(SERVER_UNAVAILABLE));
    assert_eq!(errors["unknownWorkspace"], json!(UNKNOWN_WORKSPACE));
    assert_eq!(errors["busy"], json!(BUSY));
    assert_eq!(errors["timedOut"], json!(TIMED_OUT));
    assert_eq!(errors["unavailable"], json!(UNAVAILABLE));
}

#[test]
fn contract_remote_requests_are_accepted_and_rejected() {
    for (name, value) in contract_cases("remoteRequests") {
        let request = request(value.clone()).expect(&name);
        assert_eq!(
            request.admitted_path().unwrap(),
            format!(
                "/v1/projects/codevo-editor/mcp-servers/{}",
                value["provider"].as_str().unwrap()
            ),
            "{name}"
        );
        assert_eq!(request.server_id, SERVER, "{name}");
        assert_eq!(request.runner_id, RUNNER, "{name}");
    }
    for (name, value) in contract_cases("rejectedRemoteRequests") {
        assert!(request(value).is_err(), "{name}");
    }
    for project in ["a", "codevo-editor", "a_b-c9", &"x".repeat(64)] {
        assert!(request_for(project, "codex").is_ok(), "{project}");
    }
    for project in [
        "-a",
        "_a",
        "a.b",
        "a b",
        "a/b",
        "../a",
        "a\n",
        "a?x=1",
        "a%2fb",
        &"x".repeat(65),
    ] {
        assert!(request_for(project, "codex").is_err(), "{project}");
    }
    for provider in ["claudeCode", "Claude", "CODEX", "openai", ""] {
        assert!(request_for("p", provider).is_err(), "{provider}");
    }
    for (server, runner) in [
        ("../x", RUNNER),
        ("", RUNNER),
        (SERVER, "run\nner"),
        (SERVER, " "),
        (SERVER, &"r".repeat(129)),
    ] {
        assert!(
            request(
                json!({"serverId": server, "runnerId": runner, "projectId": "p", "provider": "codex"})
            )
            .is_err(),
            "{server:?} {runner:?}"
        );
    }
}

#[test]
fn contract_runner_responses_are_parsed_strictly_and_relabelled_for_the_requested_provider() {
    for (name, value) in contract_cases("remoteRunnerResponses") {
        let (matching, other) = match value["provider"].as_str().unwrap() {
            "claude" => (Provider::Claude, Provider::Codex),
            _ => (Provider::Codex, Provider::Claude),
        };
        let local = serde_json::to_value(matching.local()).unwrap();
        let servers = parse_runner_servers(value.clone(), matching).expect(&name);
        assert_eq!(servers.provider, matching.local(), "{name}");
        assert_eq!(
            serde_json::to_value(&servers).unwrap(),
            relabelled(value.clone(), local.as_str().unwrap()),
            "{name}"
        );
        assert_eq!(
            parse_runner_servers(value, other).err(),
            Some(UNAVAILABLE),
            "{name}"
        );
    }
    for (name, value) in contract_cases("rejectedRemoteRunnerResponses") {
        for provider in [Provider::Claude, Provider::Codex] {
            assert_eq!(
                parse_runner_servers(value.clone(), provider).err(),
                Some(UNAVAILABLE),
                "{name}"
            );
        }
    }
}

#[test]
fn every_local_wire_rule_applies_to_runner_responses() {
    for (name, value) in contract_cases("responses") {
        let local = value["provider"].as_str().unwrap().to_string();
        let provider = runner_provider(&local);
        let servers = parse_runner_servers(relabelled(value.clone(), provider.segment()), provider)
            .expect(&name);
        assert_eq!(serde_json::to_value(&servers).unwrap(), value, "{name}");
        assert_eq!(
            parse_runner_servers(value, provider).is_ok(),
            local == provider.segment(),
            "{name} keeps the local provider name"
        );
    }
    for (name, value) in contract_cases("rejectedResponses") {
        let Some(provider) = value["provider"]
            .as_str()
            .filter(|local| *local != "gemini")
            .map(runner_provider)
        else {
            assert!(
                parse_runner_servers(value, Provider::Codex).is_err(),
                "{name}"
            );
            continue;
        };
        assert_eq!(
            parse_runner_servers(relabelled(value, provider.segment()), provider).err(),
            Some(UNAVAILABLE),
            "{name}"
        );
    }
    let entry = |index: usize| json!({"name": format!("server-{index}"), "status": "connected", "scope": "user", "transport": "stdio", "endpointOrigin": null, "toolCount": null, "detail": null});
    let listed = |count: usize| json!({"version": 1, "provider": "codex", "truncated": true, "servers": (0..count).map(entry).collect::<Vec<Value>>()});
    assert_eq!(
        parse_runner_servers(listed(128), Provider::Codex)
            .unwrap()
            .servers
            .len(),
        128
    );
    assert_eq!(
        parse_runner_servers(listed(129), Provider::Codex).err(),
        Some(UNAVAILABLE)
    );
    for value in [json!("servers"), json!(null), json!([]), json!({})] {
        assert_eq!(
            parse_runner_servers(value, Provider::Codex).err(),
            Some(UNAVAILABLE)
        );
    }
}

#[test]
fn bidi_control_characters_in_a_runner_response_are_unavailable() {
    assert!(parse_runner_servers(runner_servers("codex"), Provider::Codex).is_ok());
    for (field, value) in [
        ("detail", "Connection\u{202e}desolc"),
        ("detail", "\u{2066}Connection closed\u{2069}"),
        ("detail", "Connection\u{200e} closed"),
        ("name", "docs\u{202e}"),
        ("name", "do\u{200f}cs"),
    ] {
        let mut response = runner_servers("codex");
        response["servers"][0][field] = value.into();
        assert_eq!(
            parse_runner_servers(response, Provider::Codex).err(),
            Some(UNAVAILABLE),
            "{field} {value:?}"
        );
    }
}

#[test]
fn only_valid_supported_exact_runner_descriptors_admit_the_status_read() {
    assert_eq!(
        admit_descriptor(descriptor(RUNNER, true.into()), RUNNER),
        Ok(())
    );
    assert_eq!(
        admit_descriptor(descriptor("replacement", true.into()), RUNNER),
        Err(SERVER_UNAVAILABLE)
    );
    for capability in [Value::Null, false.into()] {
        assert_eq!(
            admit_descriptor(descriptor(RUNNER, capability), RUNNER),
            Err(UNSUPPORTED_RUNNER)
        );
    }
    for capability in [json!("true"), json!(1), json!({}), json!([])] {
        assert_eq!(
            admit_descriptor(descriptor(RUNNER, capability), RUNNER),
            Err(SERVER_UNAVAILABLE)
        );
    }
    for (field, value) in [
        ("protocolVersion", Value::from(2)),
        ("unknown", Value::Bool(true)),
        ("runnerId", Value::from("")),
    ] {
        let mut invalid = descriptor(RUNNER, true.into());
        invalid[field] = value;
        assert_eq!(admit_descriptor(invalid, RUNNER), Err(SERVER_UNAVAILABLE));
    }
    let mut other_capability = descriptor(RUNNER, Value::Null);
    other_capability["capabilities"]["commandCatalog"] = true.into();
    assert_eq!(
        admit_descriptor(other_capability, RUNNER),
        Err(UNSUPPORTED_RUNNER)
    );
}

#[test]
fn transport_failures_map_to_exact_contract_errors() {
    const INVALID_INPUT: &str = "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.";
    for (failure, expected) in [
        ("Runner request failed (HTTP 404).", UNKNOWN_WORKSPACE),
        (RunnerRefusal::Busy.message(), BUSY),
        (OPERATIONS_BUSY, BUSY),
        (REQUEST_TIMED_OUT, TIMED_OUT),
        (RunnerRefusal::StorageUnavailable.message(), UNAVAILABLE),
        (OUTPUT_LIMIT_EXCEEDED, UNAVAILABLE),
        (INVALID_RESPONSE, UNAVAILABLE),
        (INVALID_INPUT, UNAVAILABLE),
        ("Runner request failed (HTTP 400).", UNAVAILABLE),
        ("Runner request failed (HTTP 401).", UNAVAILABLE),
        ("Runner request failed (HTTP 403).", UNAVAILABLE),
        ("Runner request failed (HTTP 405).", UNAVAILABLE),
        ("Runner request failed (HTTP 409).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 429).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 500).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 502).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 503).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 504).", SERVER_UNAVAILABLE),
        ("Server is not connected", SERVER_UNAVAILABLE),
        ("Server registry unavailable", SERVER_UNAVAILABLE),
        ("Runner connection was superseded.", SERVER_UNAVAILABLE),
        ("Runner connection unavailable.", SERVER_UNAVAILABLE),
        (
            "Server connection changed during request",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner connection changed during request.",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner connection is closed. Reconnect the server.",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner identity changed. Reconnect the server before continuing.",
            SERVER_UNAVAILABLE,
        ),
        ("Invalid runner identity.", SERVER_UNAVAILABLE),
        (
            "Runner connection failed. The request outcome may be unknown.",
            SERVER_UNAVAILABLE,
        ),
        ("Unable to read runner response.", SERVER_UNAVAILABLE),
        ("Runner operation failed", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 404)", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 99999).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP busy).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP ).", SERVER_UNAVAILABLE),
        (BUSY, SERVER_UNAVAILABLE),
        ("", SERVER_UNAVAILABLE),
    ] {
        assert_eq!(contract_error(failure), expected, "{failure:?}");
    }
    let errors = contract()["errors"].clone();
    for failure in [
        "Runner request failed (HTTP 404).",
        "Runner request failed (HTTP 503).",
        RUNNER_BUSY,
        RUNNER_PROBE_FAILED,
        REQUEST_TIMED_OUT,
        "",
    ] {
        assert!(
            errors
                .as_object()
                .unwrap()
                .values()
                .any(|error| error == contract_error(failure)),
            "{failure:?}"
        );
    }
}

#[test]
fn only_exact_refusal_bodies_are_runner_refusals() {
    for (body, expected) in [
        ("{\"error\":\"busy\"}", RunnerRefusal::Busy),
        (" { \"error\" : \"busy\" } ", RunnerRefusal::Busy),
        (
            "{\"error\":\"storage_unavailable\"}",
            RunnerRefusal::StorageUnavailable,
        ),
    ] {
        assert_eq!(
            RunnerRefusal::from_body(body.as_bytes()),
            Some(expected),
            "{body}"
        );
    }
    assert_ne!(
        RunnerRefusal::Busy.message(),
        RunnerRefusal::StorageUnavailable.message()
    );
    for body in [
        "",
        "{}",
        "busy",
        "\"busy\"",
        "{\"error\":\"Busy\"}",
        "{\"error\":\"storageUnavailable\"}",
        "{\"error\":\"not_found\"}",
        "{\"error\":\"internal_error\"}",
        "{\"error\":\"runner_identity_mismatch\"}",
        "{\"error\":\"busy\",\"extra\":true}",
        "{\"error\":\"storage_unavailable\",\"detail\":\"x\"}",
        "{\"error\":\"busy\",\"error\":\"busy\"}",
        "{\"error\":[\"busy\"]}",
        "{\"error\":\"busy\"",
    ] {
        assert_eq!(RunnerRefusal::from_body(body.as_bytes()), None, "{body}");
    }
}

#[cfg(unix)]
mod peer {
    use super::*;
    use crate::remote_runner::{transport::Session, types::Server};
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread::JoinHandle;
    use std::time::Duration;

    const PATH: &str = "/v1/projects/codevo-editor/mcp-servers/codex";
    const LIMIT: usize = 256 * 1024;

    struct FakeRunner {
        lease: ConnectionLease,
        stop: Arc<AtomicBool>,
        serving: JoinHandle<Vec<String>>,
    }

    fn read_head(socket: &mut UnixStream) -> Option<String> {
        socket.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).ok()?;
            head.push(byte[0]);
        }
        String::from_utf8(head).ok()
    }

    fn serve(
        listener: UnixListener,
        responses: Vec<(u16, String)>,
        stop: Arc<AtomicBool>,
    ) -> Vec<String> {
        let mut responses = responses.into_iter();
        let mut heads = Vec::new();
        while !stop.load(Ordering::Acquire) {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            if socket.set_nonblocking(false).is_err() {
                continue;
            }
            let Some(head) = read_head(&mut socket) else {
                continue;
            };
            heads.push(head);
            let (status, body) = responses
                .next()
                .unwrap_or((500, "{\"error\":\"internal_error\"}".to_string()));
            let _ = write!(
                socket,
                "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
        heads
    }

    impl FakeRunner {
        fn serving(responses: Vec<(u16, String)>) -> Self {
            let session = Arc::new(Session::fixture());
            let listener = UnixListener::bind(session.socket_path()).unwrap();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = Arc::clone(&stop);
            let serving = std::thread::spawn(move || serve(listener, responses, stopped));
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
            let identity = (200, descriptor(RUNNER, true.into()).to_string());
            Self::serving(vec![identity.clone(), identity, response])
        }

        fn read(&self) -> Result<AgentMcpServers, &'static str> {
            read_servers(&self.lease, PATH, Provider::Codex)
        }

        fn requests(self) -> Vec<String> {
            self.stop.store(true, Ordering::Release);
            let heads = self.serving.join().unwrap();
            assert!(heads
                .iter()
                .all(|head| head.contains(&format!("x-codevo-runner-id: {RUNNER}\r\n"))));
            assert!(heads.iter().all(|head| {
                head.lines()
                    .find_map(|line| line.strip_prefix("x-codevo-client-capabilities: "))
                    .is_some_and(|tokens| tokens.split(',').any(|token| token == CAPABILITY))
            }));
            heads
                .iter()
                .map(|head| head.lines().next().unwrap_or_default().to_string())
                .collect()
        }
    }

    fn padded(value: &Value, bytes: usize) -> String {
        let body = value.to_string();
        format!("{body}{}", " ".repeat(bytes - body.len()))
    }

    #[test]
    fn an_admitted_runner_is_read_once_on_the_exact_route_and_relabelled() {
        let runner = FakeRunner::admitted((200, runner_servers("codex").to_string()));
        let servers = runner.read().expect("servers");
        assert_eq!(servers.provider, AgentCliInvocation::CodexExec);
        assert_eq!(
            serde_json::to_value(&servers).unwrap(),
            runner_servers("codex")
        );
        assert_eq!(ensure_exact_runner(&runner.lease, RUNNER), Ok(()));
        assert_eq!(
            runner.requests(),
            [
                "GET /v1/runner HTTP/1.1".to_string(),
                "GET /v1/runner HTTP/1.1".to_string(),
                format!("GET {PATH} HTTP/1.1"),
            ]
        );
    }

    #[test]
    fn a_foreign_provider_or_invalid_payload_is_unavailable() {
        for body in [
            runner_servers("claude").to_string(),
            runner_servers("claudeCode").to_string(),
            runner_servers("codex")
                .to_string()
                .replace("\"detail\"", "\"command\""),
            runner_servers("codex")
                .to_string()
                .replace("Connection closed", "Connection\u{202e}desolc"),
            runner_servers("codex")
                .to_string()
                .replace("\"docs\"", "\"docs\u{202e}\""),
            "not json".to_string(),
            "[]".to_string(),
            String::new(),
        ] {
            let runner = FakeRunner::admitted((200, body.clone()));
            assert_eq!(runner.read(), Err(UNAVAILABLE), "{body}");
            assert_eq!(runner.requests().len(), 3, "{body}");
        }
    }

    #[test]
    fn a_response_is_accepted_at_the_size_limit_and_unavailable_above_it() {
        let runner = FakeRunner::admitted((200, padded(&runner_servers("codex"), LIMIT)));
        assert_eq!(
            serde_json::to_value(runner.read().expect("servers at the limit")).unwrap(),
            runner_servers("codex")
        );
        runner.requests();
        let runner = FakeRunner::admitted((200, padded(&runner_servers("codex"), LIMIT + 1)));
        assert_eq!(runner.read(), Err(UNAVAILABLE));
        runner.requests();
    }

    #[test]
    fn a_changed_runner_identity_is_server_unavailable_before_the_status_route_is_read() {
        let replacement = (200, descriptor("replacement", true.into()).to_string());
        let expected = (200, descriptor(RUNNER, true.into()).to_string());
        let servers = (200, runner_servers("codex").to_string());
        for (responses, calls) in [
            (vec![replacement.clone(), servers.clone()], 1),
            (
                vec![expected.clone(), replacement.clone(), servers.clone()],
                2,
            ),
            (
                vec![(409, "{\"error\":\"runner_identity_mismatch\"}".to_string())],
                1,
            ),
            (
                vec![
                    expected.clone(),
                    (409, "{\"error\":\"runner_identity_mismatch\"}".to_string()),
                ],
                2,
            ),
        ] {
            let runner = FakeRunner::serving(responses);
            assert_eq!(runner.read(), Err(SERVER_UNAVAILABLE));
            let requests = runner.requests();
            assert_eq!(requests.len(), calls);
            assert!(requests
                .iter()
                .all(|request| request == "GET /v1/runner HTTP/1.1"));
        }
    }

    #[test]
    fn a_runner_without_the_capability_is_unsupported_and_never_asked_for_status() {
        for capability in [Value::Null, false.into()] {
            let runner = FakeRunner::serving(vec![
                (200, descriptor(RUNNER, capability).to_string()),
                (200, runner_servers("codex").to_string()),
            ]);
            assert_eq!(runner.read(), Err(UNSUPPORTED_RUNNER));
            assert_eq!(runner.requests(), ["GET /v1/runner HTTP/1.1"]);
        }
    }

    #[test]
    fn runner_refusals_map_to_exact_contract_errors() {
        for (status, body, expected) in [
            (404, "{\"error\":\"not_found\"}", UNKNOWN_WORKSPACE),
            (404, "", UNKNOWN_WORKSPACE),
            (503, "{\"error\":\"busy\"}", BUSY),
            (503, "{\"error\":\"storage_unavailable\"}", UNAVAILABLE),
            (500, "{\"error\":\"storage_unavailable\"}", UNAVAILABLE),
            (500, "{\"error\":\"busy\"}", BUSY),
            (503, "{\"error\":\"busy\",\"extra\":1}", SERVER_UNAVAILABLE),
            (
                503,
                "{\"error\":\"storage_unavailable\",\"extra\":1}",
                SERVER_UNAVAILABLE,
            ),
            (
                503,
                "{\"error\":\"speech_unavailable\"}",
                SERVER_UNAVAILABLE,
            ),
            (503, "", SERVER_UNAVAILABLE),
            (500, "{\"error\":\"internal_error\"}", SERVER_UNAVAILABLE),
            (504, "", SERVER_UNAVAILABLE),
            (429, "{\"error\":\"quota_exceeded\"}", SERVER_UNAVAILABLE),
            (400, "{\"error\":\"invalid_input\"}", UNAVAILABLE),
            (400, "{}", UNAVAILABLE),
            (403, "{\"error\":\"forbidden\"}", UNAVAILABLE),
            (405, "", UNAVAILABLE),
            (
                409,
                "{\"error\":\"runner_identity_mismatch\"}",
                SERVER_UNAVAILABLE,
            ),
            (401, "{\"error\":\"busy\"}", SERVER_UNAVAILABLE),
            (
                401,
                "{\"error\":\"storage_unavailable\"}",
                SERVER_UNAVAILABLE,
            ),
            (401, "{\"error\":\"unauthorized\"}", SERVER_UNAVAILABLE),
        ] {
            let runner = FakeRunner::admitted((status, body.to_string()));
            assert_eq!(runner.read(), Err(expected), "{status} {body}");
            assert_eq!(runner.requests().len(), 3, "{status} {body}");
        }
        for refusal in ["busy", "storage_unavailable"] {
            let oversized = format!("{{\"error\":\"{refusal}\"}}{}", " ".repeat(1024));
            let runner = FakeRunner::admitted((503, oversized));
            assert_eq!(runner.read(), Err(SERVER_UNAVAILABLE), "{refusal}");
            runner.requests();
        }
    }

    #[test]
    fn a_superseded_connection_is_server_unavailable_without_any_request() {
        let runner = FakeRunner::admitted((200, runner_servers("codex").to_string()));
        assert_eq!(
            ensure_exact_runner(&runner.lease, "replacement"),
            Err(SERVER_UNAVAILABLE)
        );
        assert_eq!(
            ensure_exact_runner(&runner.lease, ""),
            Err(SERVER_UNAVAILABLE)
        );
        assert_eq!(ensure_exact_runner(&runner.lease, RUNNER), Ok(()));
        runner.lease.revoke();
        assert_eq!(
            ensure_exact_runner(&runner.lease, RUNNER),
            Err(SERVER_UNAVAILABLE)
        );
        assert_eq!(runner.read(), Err(SERVER_UNAVAILABLE));
        assert!(runner.requests().is_empty());
    }

    #[test]
    fn a_connection_revoked_while_the_runner_answers_never_yields_servers() {
        let runner = FakeRunner::admitted((200, runner_servers("codex").to_string()));
        let servers = runner.read().expect("servers");
        runner.lease.revoke();
        assert_eq!(
            ensure_exact_runner(&runner.lease, RUNNER).map(|()| servers),
            Err(SERVER_UNAVAILABLE)
        );
        runner.requests();
    }
}
