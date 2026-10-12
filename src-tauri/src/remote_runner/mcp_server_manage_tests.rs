use super::*;
use crate::agent_mcp_server_manage_domain::{
    AGENT_MCP_SERVER_CALLBACK_REJECTED_ERROR as CALLBACK_REJECTED,
    AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR as CHANGE_UNSUPPORTED,
    AGENT_MCP_SERVER_EXISTS_ERROR as SERVER_EXISTS,
    AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR as LOGIN_INACTIVE,
    AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR as LOGIN_UNSUPPORTED,
    AGENT_MCP_SERVER_NOT_FOUND_ERROR as SERVER_NOT_FOUND,
};
use crate::agent_mcp_servers_domain::AGENT_MCP_SERVERS_UNSUPPORTED_RUNNER_ERROR as UNSUPPORTED_RUNNER;
use serde_json::json;

const SERVER: &str = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const RUNNER: &str = "runner-home";
const PROJECT: &str = "codevo-editor";
const LOGIN: &str = "login-0123456789";
const CALLBACK: &str = "http://localhost:33418/callback?code=abc&state=xyz";
const AUTHORIZATION: &str = "https://auth.example/authorize?client_id=codevo&state=abc";
const BASE: &str = "/v1/projects/codevo-editor/mcp-servers/codex";

fn target(provider: &str) -> Value {
    json!({ "serverId": SERVER, "runnerId": RUNNER, "projectId": PROJECT, "provider": provider })
}

fn with(mut value: Value, fields: Value) -> Value {
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

fn http_change() -> Value {
    json!({ "kind": "add", "name": "docs", "scope": "user",
        "launch": { "kind": "http", "url": "https://docs.example/mcp" } })
}

fn change_request(provider: &str, change: Value) -> Value {
    with(target(provider), json!({ "change": change }))
}

fn login_request(provider: &str, name: &str, mode: &str) -> Value {
    with(target(provider), json!({ "name": name, "mode": mode }))
}

fn login_id_request(login_id: &str) -> Value {
    with(target("codex"), json!({ "loginId": login_id }))
}

fn callback_request(login_id: &str, callback_url: &str) -> Value {
    with(
        target("codex"),
        json!({ "loginId": login_id, "callbackUrl": callback_url }),
    )
}

#[derive(Clone, Copy, Debug)]
enum Command {
    Change,
    LoginStart,
    LoginState,
    LoginCallback,
    LoginCancel,
}

const COMMANDS: [Command; 5] = [
    Command::Change,
    Command::LoginStart,
    Command::LoginState,
    Command::LoginCallback,
    Command::LoginCancel,
];

impl Command {
    fn valid(self) -> Value {
        match self {
            Self::Change => change_request("codex", http_change()),
            Self::LoginStart => login_request("codex", "docs", "signIn"),
            Self::LoginState | Self::LoginCancel => login_id_request(LOGIN),
            Self::LoginCallback => callback_request(LOGIN, CALLBACK),
        }
    }

    fn admit(self, request: Value) -> Result<Call, String> {
        fn parsed<T: serde::de::DeserializeOwned>(request: Value) -> Result<T, String> {
            serde_json::from_value(request).map_err(|_| "deserialize".to_string())
        }
        let call = match self {
            Self::Change => parsed::<McpServerChangeRequest>(request)?.admitted(),
            Self::LoginStart => parsed::<McpServerLoginStartRequest>(request)?.admitted(),
            Self::LoginState => parsed::<McpServerLoginRequest>(request)?.state_read(),
            Self::LoginCallback => parsed::<McpServerLoginCallbackRequest>(request)?.admitted(),
            Self::LoginCancel => parsed::<McpServerLoginRequest>(request)?.cancellation(),
        };
        Ok(call?)
    }

    fn request_line(self) -> String {
        match self {
            Self::Change => format!("POST {BASE}/changes HTTP/1.1"),
            Self::LoginStart => format!("POST {BASE}/logins HTTP/1.1"),
            Self::LoginState => format!("GET {BASE}/logins/{LOGIN} HTTP/1.1"),
            Self::LoginCallback => format!("POST {BASE}/logins/{LOGIN}/callback HTTP/1.1"),
            Self::LoginCancel => format!("DELETE {BASE}/logins/{LOGIN} HTTP/1.1"),
        }
    }

    fn answer(self) -> Value {
        match self {
            Self::Change | Self::LoginCallback | Self::LoginCancel => json!({ "version": 1 }),
            Self::LoginStart => json!({ "version": 1, "step": {
                "kind": "awaitingCallback",
                "loginId": LOGIN,
                "authorizationUrl": AUTHORIZATION,
                "delivery": "paste",
            } }),
            Self::LoginState => json!({ "version": 1, "state": "pending" }),
        }
    }

    fn parse(self, value: Value) -> Result<Value, &'static str> {
        fn wire<T: serde::Serialize>(parsed: T) -> Value {
            serde_json::to_value(parsed).unwrap()
        }
        match self {
            Self::Change | Self::LoginCallback | Self::LoginCancel => parse_ack(value).map(wire),
            Self::LoginStart => parse_login_started(value).map(wire),
            Self::LoginState => parse_login_status(value).map(wire),
        }
    }
}

fn admitted_error(command: Command, request: Value) -> Option<String> {
    command.admit(request).err()
}

#[test]
fn the_five_tunnel_commands_carry_their_contract_names() {
    let names = [
        std::any::type_name_of_val(&remote_runner_change_mcp_server),
        std::any::type_name_of_val(&remote_runner_start_mcp_server_login),
        std::any::type_name_of_val(&remote_runner_get_mcp_server_login),
        std::any::type_name_of_val(&remote_runner_submit_mcp_server_login_callback),
        std::any::type_name_of_val(&remote_runner_cancel_mcp_server_login),
    ]
    .map(|name| name.rsplit("::").next().unwrap_or_default());
    assert_eq!(
        names,
        [
            "remote_runner_change_mcp_server",
            "remote_runner_start_mcp_server_login",
            "remote_runner_get_mcp_server_login",
            "remote_runner_submit_mcp_server_login_callback",
            "remote_runner_cancel_mcp_server_login",
        ]
    );
    assert_eq!(CAPABILITY, "mcpServerManagement");
}

#[test]
fn every_admitted_request_targets_its_exact_route_with_the_closed_body() {
    for provider in ["claude", "codex"] {
        let base = format!("/v1/projects/{PROJECT}/mcp-servers/{provider}");
        let change = Command::Change
            .admit(change_request(provider, http_change()))
            .expect("change");
        assert_eq!(change.method, "POST");
        assert_eq!(change.path, format!("{base}/changes"));
        assert_eq!(change.body, Some(json!({ "change": http_change() })));
        let login = Command::LoginStart
            .admit(login_request(provider, "claude.ai Linear", "signInAgain"))
            .expect("login");
        assert_eq!(login.method, "POST");
        assert_eq!(login.path, format!("{base}/logins"));
        assert_eq!(
            login.body,
            Some(json!({ "name": "claude.ai Linear", "mode": "signInAgain" }))
        );
        let identified = with(target(provider), json!({ "loginId": LOGIN }));
        let state = Command::LoginState
            .admit(identified.clone())
            .expect("state");
        assert_eq!(state.method, "GET");
        assert_eq!(state.path, format!("{base}/logins/{LOGIN}"));
        assert_eq!(state.body, None);
        let cancel = Command::LoginCancel.admit(identified).expect("cancel");
        assert_eq!(cancel.method, "DELETE");
        assert_eq!(cancel.path, format!("{base}/logins/{LOGIN}"));
        assert_eq!(cancel.body, None);
        let callback = Command::LoginCallback
            .admit(with(
                target(provider),
                json!({ "loginId": LOGIN, "callbackUrl": CALLBACK }),
            ))
            .expect("callback");
        assert_eq!(callback.method, "POST");
        assert_eq!(callback.path, format!("{base}/logins/{LOGIN}/callback"));
        assert_eq!(callback.body, Some(json!({ "callbackUrl": CALLBACK })));
    }
    for command in COMMANDS {
        let call = command.admit(command.valid()).expect("admitted");
        assert_eq!(
            format!("{} {} HTTP/1.1", call.method, call.path),
            command.request_line()
        );
        assert!(
            crate::remote_runner::mcp_server_manage_wire::Route::of(call.method, &call.path)
                .is_some(),
            "{command:?}"
        );
    }
}

#[test]
fn request_envelopes_are_closed_and_camel_case() {
    for command in COMMANDS {
        assert!(command.admit(command.valid()).is_ok(), "{command:?}");
        for (field, value) in [
            ("repositoryRoot", json!("/srv/project")),
            ("server_id", json!(SERVER)),
            ("login_id", json!(LOGIN)),
            ("extra", json!(true)),
        ] {
            assert_eq!(
                admitted_error(command, with(command.valid(), json!({ field: value }))),
                Some("deserialize".to_string()),
                "{command:?} {field}"
            );
        }
        for provider in ["claudeCode", "Claude", "CODEX", "openai", ""] {
            assert_eq!(
                admitted_error(
                    command,
                    with(command.valid(), json!({ "provider": provider }))
                ),
                Some("deserialize".to_string()),
                "{command:?} {provider}"
            );
        }
        for missing in ["serverId", "runnerId", "projectId", "provider"] {
            let mut request = command.valid();
            request.as_object_mut().unwrap().remove(missing);
            assert_eq!(
                admitted_error(command, request),
                Some("deserialize".to_string()),
                "{command:?} {missing}"
            );
        }
    }
    for (command, field) in [
        (Command::Change, "change"),
        (Command::LoginStart, "name"),
        (Command::LoginStart, "mode"),
        (Command::LoginState, "loginId"),
        (Command::LoginCancel, "loginId"),
        (Command::LoginCallback, "loginId"),
        (Command::LoginCallback, "callbackUrl"),
    ] {
        let mut request = command.valid();
        request.as_object_mut().unwrap().remove(field);
        assert_eq!(
            admitted_error(command, request),
            Some("deserialize".to_string()),
            "{command:?} {field}"
        );
    }
    for (command, fields) in [
        (Command::LoginStart, json!({ "mode": "signOut" })),
        (Command::LoginStart, json!({ "mode": "SignIn" })),
        (Command::LoginState, json!({ "callbackUrl": CALLBACK })),
        (Command::LoginCancel, json!({ "callbackUrl": CALLBACK })),
        (
            Command::Change,
            json!({ "change": { "kind": "rename", "name": "docs" } }),
        ),
        (
            Command::Change,
            json!({ "change": { "kind": "signOut", "name": "docs", "scope": "user" } }),
        ),
        (
            Command::Change,
            json!({ "change": { "kind": "add", "name": "docs", "scope": "user",
                "launch": { "kind": "http", "url": "https://docs.example/mcp", "headers": {} } } }),
        ),
        (
            Command::Change,
            json!({ "change": { "kind": "add", "name": "docs", "scope": "user",
                "launch": { "kind": "stdio", "command": "sh -c ls" } } }),
        ),
    ] {
        assert_eq!(
            admitted_error(command, with(command.valid(), fields.clone())),
            Some("deserialize".to_string()),
            "{command:?} {fields}"
        );
    }
}

#[test]
fn hostile_identifiers_are_invalid_requests_and_never_reach_a_path() {
    for command in COMMANDS {
        for project in [
            "",
            "-a",
            "_a",
            "a.b",
            "a b",
            "a/b",
            "../a",
            "..",
            "a\n",
            "a?x=1",
            "a%2fb",
            "a#b",
            &"x".repeat(65),
        ] {
            assert_eq!(
                admitted_error(
                    command,
                    with(command.valid(), json!({ "projectId": project }))
                ),
                Some(INVALID_REQUEST.to_string()),
                "{command:?} {project:?}"
            );
        }
        for (server, runner) in [
            ("../x", RUNNER),
            ("", RUNNER),
            ("a/b", RUNNER),
            (SERVER, "run\nner"),
            (SERVER, " "),
            (SERVER, ""),
            (SERVER, &"r".repeat(129)),
        ] {
            assert_eq!(
                admitted_error(
                    command,
                    with(
                        command.valid(),
                        json!({ "serverId": server, "runnerId": runner })
                    )
                ),
                Some(INVALID_REQUEST.to_string()),
                "{command:?} {server:?} {runner:?}"
            );
        }
    }
    for command in [
        Command::LoginState,
        Command::LoginCancel,
        Command::LoginCallback,
    ] {
        for login in [
            "",
            "short",
            "1234567",
            "../../runner",
            "..%2f..%2frunner",
            "login/0123456789",
            "login-0123456789/callback",
            "login-0123456789?x=1",
            "login-0123456789#x",
            "login_0123456789",
            "login 0123456789",
            "login-0123456789\n",
            "login-0123456789\u{0}",
            "logín-0123456789",
            &"a".repeat(65),
        ] {
            assert_eq!(
                admitted_error(command, with(command.valid(), json!({ "loginId": login }))),
                Some(INVALID_REQUEST.to_string()),
                "{command:?} {login:?}"
            );
        }
        for login in ["12345678", "A-b-C-d-0", &"a".repeat(64)] {
            let call = command
                .admit(with(command.valid(), json!({ "loginId": login })))
                .expect("login id");
            assert!(call.path.contains(&format!("/logins/{login}")), "{login}");
        }
    }
}

#[test]
fn invalid_changes_names_and_callback_addresses_are_invalid_requests() {
    let add = |name: &str, scope: &str, launch: Value| json!({ "kind": "add", "name": name, "scope": scope, "launch": launch });
    let http = |url: &str| json!({ "kind": "http", "url": url });
    for (provider, change) in [
        (
            "codex",
            add("-docs", "user", http("https://docs.example/mcp")),
        ),
        (
            "codex",
            add("do cs", "user", http("https://docs.example/mcp")),
        ),
        ("codex", add("", "user", http("https://docs.example/mcp"))),
        (
            "codex",
            add("docs", "local", http("https://docs.example/mcp")),
        ),
        (
            "codex",
            add("docs", "project", http("https://docs.example/mcp")),
        ),
        (
            "codex",
            add(
                "docs",
                "user",
                json!({ "kind": "sse", "url": "https://docs.example/sse" }),
            ),
        ),
        (
            "claude",
            add("docs", "project", http("https://docs.example/mcp")),
        ),
        (
            "claude",
            add("docs", "user", http("ftp://docs.example/mcp")),
        ),
        (
            "claude",
            add("docs", "user", http("https://user:secret@docs.example/mcp")),
        ),
        (
            "claude",
            add("docs", "user", http("https://docs.example/m cp")),
        ),
        (
            "claude",
            add(
                "docs",
                "user",
                json!({ "kind": "stdio", "command": "", "args": [] }),
            ),
        ),
        (
            "claude",
            add(
                "docs",
                "user",
                json!({ "kind": "stdio", "command": "npx", "args": ["a\u{0}b"] }),
            ),
        ),
        (
            "claude",
            add(
                "docs",
                "user",
                json!({ "kind": "stdio", "command": "npx", "args": vec!["a"; 33] }),
            ),
        ),
        (
            "codex",
            json!({ "kind": "remove", "name": "docs", "scope": "local" }),
        ),
        (
            "claude",
            json!({ "kind": "remove", "name": "--scope", "scope": "user" }),
        ),
        ("claude", json!({ "kind": "signOut", "name": "" })),
        ("claude", json!({ "kind": "signOut", "name": "do\ncs" })),
        (
            "claude",
            json!({ "kind": "signOut", "name": "docs\u{202e}" }),
        ),
    ] {
        assert_eq!(
            admitted_error(Command::Change, change_request(provider, change.clone())),
            Some(INVALID_REQUEST.to_string()),
            "{provider} {change}"
        );
    }
    for (provider, change) in [
        (
            "claude",
            add("docs", "local", http("https://docs.example/mcp")),
        ),
        (
            "claude",
            add(
                "docs",
                "user",
                json!({ "kind": "sse", "url": "https://docs.example/sse" }),
            ),
        ),
        (
            "claude",
            json!({ "kind": "remove", "name": "docs", "scope": "project" }),
        ),
        (
            "codex",
            json!({ "kind": "remove", "name": "docs", "scope": "user" }),
        ),
        (
            "codex",
            json!({ "kind": "signOut", "name": "claude.ai Linear" }),
        ),
    ] {
        assert!(
            Command::Change
                .admit(change_request(provider, change.clone()))
                .is_ok(),
            "{provider} {change}"
        );
    }
    for name in ["", " ", "do\ncs", "docs\u{202e}", &"n".repeat(129)] {
        assert_eq!(
            admitted_error(Command::LoginStart, login_request("codex", name, "signIn")),
            Some(INVALID_REQUEST.to_string()),
            "{name:?}"
        );
    }
    for callback in [
        "",
        "https://localhost:33418/callback?code=abc",
        "http://example.com/callback?code=abc",
        "http://localhost:33418/callback",
        "http://localhost:33418/callback?code=a b",
        "localhost:33418/callback?code=abc",
        &format!("http://localhost/callback?code={}", "a".repeat(8192)),
    ] {
        assert_eq!(
            admitted_error(Command::LoginCallback, callback_request(LOGIN, callback)),
            Some(INVALID_REQUEST.to_string()),
            "{callback:?}"
        );
    }
}

#[test]
fn transport_failures_map_to_exact_contract_errors() {
    const INVALID_INPUT: &str = "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.";
    for (failure, expected) in [
        (RunnerRefusal::McpServerExists.message(), SERVER_EXISTS),
        (RunnerRefusal::McpServerNotFound.message(), SERVER_NOT_FOUND),
        (
            RunnerRefusal::McpChangeUnsupported.message(),
            CHANGE_UNSUPPORTED,
        ),
        (
            RunnerRefusal::McpLoginUnsupported.message(),
            LOGIN_UNSUPPORTED,
        ),
        (RunnerRefusal::McpLoginInactive.message(), LOGIN_INACTIVE),
        (
            RunnerRefusal::McpCallbackRejected.message(),
            CALLBACK_REJECTED,
        ),
        (RunnerRefusal::InvalidInput.message(), INVALID_REQUEST),
        (RunnerRefusal::Busy.message(), BUSY),
        (RunnerRefusal::StorageUnavailable.message(), UNAVAILABLE),
        (OPERATIONS_BUSY, BUSY),
        (REQUEST_TIMED_OUT, TIMED_OUT),
        ("Runner request failed (HTTP 404).", UNKNOWN_WORKSPACE),
        (OUTPUT_LIMIT_EXCEEDED, UNAVAILABLE),
        (INVALID_RESPONSE, UNAVAILABLE),
        (INVALID_INPUT, UNAVAILABLE),
        ("Runner request failed (HTTP 400).", UNAVAILABLE),
        ("Runner request failed (HTTP 401).", UNAVAILABLE),
        ("Runner request failed (HTTP 403).", UNAVAILABLE),
        ("Runner request failed (HTTP 405).", UNAVAILABLE),
        ("Runner request failed (HTTP 413).", UNAVAILABLE),
        ("Runner request failed (HTTP 415).", UNAVAILABLE),
        ("Runner request failed (HTTP 409).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 429).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 500).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 503).", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 504).", SERVER_UNAVAILABLE),
        ("Server is not connected", SERVER_UNAVAILABLE),
        ("Runner connection was superseded.", SERVER_UNAVAILABLE),
        (
            "Server connection changed during request",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner connection changed during request.",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner identity changed. Reconnect the server before continuing.",
            SERVER_UNAVAILABLE,
        ),
        (
            "Runner connection failed. The request outcome may be unknown.",
            SERVER_UNAVAILABLE,
        ),
        ("Runner operation failed", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP 404)", SERVER_UNAVAILABLE),
        ("Runner request failed (HTTP busy).", SERVER_UNAVAILABLE),
        (
            "Runner MCP server status check is busy.",
            SERVER_UNAVAILABLE,
        ),
        (LOGIN_INACTIVE, SERVER_UNAVAILABLE),
        (BUSY, SERVER_UNAVAILABLE),
        ("", SERVER_UNAVAILABLE),
    ] {
        assert_eq!(contract_error(failure), expected, "{failure:?}");
    }
}

#[cfg(unix)]
mod peer {
    use super::*;
    use crate::remote_runner::{
        mcp_server_manage_wire::MAX_OUTPUT, transport::Session, types::Server,
    };
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread::JoinHandle;
    use std::time::Duration;

    struct Received {
        head: String,
        body: String,
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

    fn descriptor(runner: &str, capabilities: Value) -> String {
        let mut descriptor = json!({
            "protocolVersion": 1,
            "runnerId": runner,
            "name": "Server",
            "capabilities": { "taskExecution": true, "eventReplay": true },
        });
        for (name, value) in capabilities.as_object().unwrap() {
            descriptor["capabilities"][name] = value.clone();
        }
        descriptor.to_string()
    }

    fn managing() -> String {
        descriptor(
            RUNNER,
            json!({ "mcpServers": true, "mcpServerManagement": true }),
        )
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
            Self::serving(vec![(200, managing()), (200, managing()), response])
        }

        fn run(&self, command: Command, request: Value) -> Result<Value, String> {
            let call = command.admit(request)?;
            let answer = exchange(&self.lease, call)?;
            Ok(command.parse(answer)?)
        }

        fn received(self) -> Vec<Received> {
            self.stop.store(true, Ordering::Release);
            let received = self.serving.join().unwrap();
            for request in &received {
                assert!(request
                    .head
                    .contains(&format!("x-codevo-runner-id: {RUNNER}\r\n")));
                assert!(request.head.contains("authorization: Bearer test-only\r\n"));
                assert!(request
                    .head
                    .lines()
                    .find_map(|line| line.strip_prefix("x-codevo-client-capabilities: "))
                    .is_some_and(|tokens| tokens.split(',').any(|token| token == CAPABILITY)));
            }
            received
        }

        fn request_lines(self) -> Vec<String> {
            self.received()
                .iter()
                .map(|request| request.head.lines().next().unwrap_or_default().to_string())
                .collect()
        }
    }

    fn padded(value: &Value, bytes: usize) -> String {
        let body = value.to_string();
        format!("{body}{}", " ".repeat(bytes - body.len()))
    }

    #[test]
    fn every_command_is_sent_once_on_its_exact_route_and_answers_in_the_local_shape() {
        for command in COMMANDS {
            let runner = FakeRunner::admitted((200, command.answer().to_string()));
            assert_eq!(
                runner.run(command, command.valid()),
                Ok(command.answer()),
                "{command:?}"
            );
            assert_eq!(ensure_exact_runner(&runner.lease, RUNNER), Ok(()));
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
                    command.request_line().as_str(),
                ],
                "{command:?}"
            );
            assert!(received[..2].iter().all(|request| request.body.is_empty()));
            let sent = &received[2];
            let expected = match command {
                Command::Change => Some(json!({ "change": http_change() })),
                Command::LoginStart => Some(json!({ "name": "docs", "mode": "signIn" })),
                Command::LoginCallback => Some(json!({ "callbackUrl": CALLBACK })),
                Command::LoginState | Command::LoginCancel => None,
            };
            assert_eq!(
                serde_json::from_str::<Value>(&sent.body).ok(),
                expected,
                "{command:?}"
            );
            assert_eq!(
                sent.head.contains("content-type: application/json\r\n"),
                expected.is_some(),
                "{command:?}"
            );
        }
    }

    #[test]
    fn every_login_step_and_state_from_the_runner_is_returned_unchanged() {
        for step in [
            json!({ "kind": "completed" }),
            json!({ "kind": "finishInBrowser", "authorizationUrl": AUTHORIZATION }),
            json!({ "kind": "awaitingCallback", "loginId": LOGIN,
                "authorizationUrl": "http://127.0.0.1:33418/authorize?state=abc", "delivery": "paste" }),
        ] {
            let answer = json!({ "version": 1, "step": step });
            let runner = FakeRunner::admitted((200, answer.to_string()));
            assert_eq!(
                runner.run(Command::LoginStart, Command::LoginStart.valid()),
                Ok(answer)
            );
            runner.received();
        }
        for state in ["pending", "succeeded", "failed"] {
            let answer = json!({ "version": 1, "state": state });
            let runner = FakeRunner::admitted((200, answer.to_string()));
            assert_eq!(
                runner.run(Command::LoginState, Command::LoginState.valid()),
                Ok(answer)
            );
            runner.received();
        }
    }

    #[test]
    fn every_runner_error_code_maps_to_its_exact_contract_error() {
        for (status, body, expected) in [
            (409, "{\"error\":\"mcp_server_exists\"}", SERVER_EXISTS),
            (
                409,
                "{\"error\":\"mcp_server_not_found\"}",
                SERVER_NOT_FOUND,
            ),
            (
                409,
                "{\"error\":\"mcp_change_unsupported\"}",
                CHANGE_UNSUPPORTED,
            ),
            (
                409,
                "{\"error\":\"mcp_login_unsupported\"}",
                LOGIN_UNSUPPORTED,
            ),
            (409, "{\"error\":\"mcp_login_inactive\"}", LOGIN_INACTIVE),
            (
                409,
                "{\"error\":\"mcp_callback_rejected\"}",
                CALLBACK_REJECTED,
            ),
            (400, "{\"error\":\"invalid_input\"}", INVALID_REQUEST),
            (503, "{\"error\":\"busy\"}", BUSY),
            (503, "{\"error\":\"storage_unavailable\"}", UNAVAILABLE),
            (404, "{\"error\":\"not_found\"}", UNKNOWN_WORKSPACE),
            (404, "", UNKNOWN_WORKSPACE),
            (400, "{}", UNAVAILABLE),
            (
                400,
                "{\"error\":\"invalid_input\",\"field\":\"url\"}",
                UNAVAILABLE,
            ),
            (413, "{\"error\":\"too_large\"}", UNAVAILABLE),
            (415, "{\"error\":\"unsupported_media\"}", UNAVAILABLE),
            (403, "{\"error\":\"forbidden\"}", UNAVAILABLE),
            (405, "", UNAVAILABLE),
            (
                409,
                "{\"error\":\"runner_identity_mismatch\"}",
                SERVER_UNAVAILABLE,
            ),
            (409, "{\"error\":\"conflict\"}", SERVER_UNAVAILABLE),
            (
                409,
                "{\"error\":\"mcp_server_exists\",\"extra\":1}",
                SERVER_UNAVAILABLE,
            ),
            (409, "", SERVER_UNAVAILABLE),
            (429, "{\"error\":\"quota_exceeded\"}", SERVER_UNAVAILABLE),
            (500, "{\"error\":\"internal_error\"}", SERVER_UNAVAILABLE),
            (503, "", SERVER_UNAVAILABLE),
            (504, "", SERVER_UNAVAILABLE),
            (401, "{\"error\":\"unauthorized\"}", SERVER_UNAVAILABLE),
            (
                401,
                "{\"error\":\"mcp_login_inactive\"}",
                SERVER_UNAVAILABLE,
            ),
        ] {
            for command in COMMANDS {
                let runner = FakeRunner::admitted((status, body.to_string()));
                assert_eq!(
                    runner.run(command, command.valid()),
                    Err(expected.to_string()),
                    "{command:?} {status} {body}"
                );
                assert_eq!(runner.received().len(), 3, "{command:?} {status} {body}");
            }
        }
        let oversized = format!("{{\"error\":\"mcp_login_inactive\"}}{}", " ".repeat(1024));
        let runner = FakeRunner::admitted((409, oversized));
        assert_eq!(
            runner.run(Command::LoginState, Command::LoginState.valid()),
            Err(SERVER_UNAVAILABLE.to_string())
        );
        runner.received();
    }

    #[test]
    fn an_answer_with_an_unexpected_shape_is_unavailable() {
        let start = |step: Value| json!({ "version": 1, "step": step }).to_string();
        let awaiting = |delivery: &str, url: &str| json!({ "kind": "awaitingCallback", "loginId": LOGIN, "authorizationUrl": url, "delivery": delivery });
        for (command, body) in [
            (Command::Change, "{\"version\":2}".to_string()),
            (
                Command::Change,
                "{\"version\":1,\"extra\":true}".to_string(),
            ),
            (Command::Change, "not json".to_string()),
            (Command::Change, "[]".to_string()),
            (Command::Change, String::new()),
            (Command::LoginCallback, "{\"version\":\"1\"}".to_string()),
            (Command::LoginCancel, "{}".to_string()),
            (Command::LoginState, "{\"version\":1}".to_string()),
            (
                Command::LoginState,
                "{\"version\":1,\"state\":\"cancelled\"}".to_string(),
            ),
            (
                Command::LoginState,
                "{\"version\":2,\"state\":\"pending\"}".to_string(),
            ),
            (
                Command::LoginState,
                "{\"version\":1,\"state\":\"pending\",\"loginId\":\"login-0123456789\"}"
                    .to_string(),
            ),
            (Command::LoginStart, "{\"version\":1}".to_string()),
            (
                Command::LoginStart,
                start(awaiting("automatic", AUTHORIZATION)),
            ),
            (
                Command::LoginStart,
                start(awaiting("paste", "http://auth.example/authorize")),
            ),
            (
                Command::LoginStart,
                start(awaiting("paste", "javascript:alert(1)")),
            ),
            (
                Command::LoginStart,
                start(
                    json!({ "kind": "finishInBrowser", "authorizationUrl": "ftp://auth.example/" }),
                ),
            ),
            (
                Command::LoginStart,
                start(
                    json!({ "kind": "finishInBrowser", "authorizationUrl": AUTHORIZATION, "token": "secret" }),
                ),
            ),
            (
                Command::LoginStart,
                start(json!({ "kind": "completed", "extra": true })),
            ),
            (
                Command::LoginStart,
                json!({ "version": 2, "step": { "kind": "completed" } }).to_string(),
            ),
            (
                Command::LoginStart,
                json!({ "version": 1, "step": { "kind": "completed" }, "state": "pending" })
                    .to_string(),
            ),
        ] {
            let runner = FakeRunner::admitted((200, body.clone()));
            let outcome = runner.run(command, command.valid());
            assert_eq!(outcome, Err(UNAVAILABLE.to_string()), "{command:?} {body}");
            assert_eq!(runner.received().len(), 3, "{command:?} {body}");
        }
    }

    #[test]
    fn an_answer_is_accepted_at_the_size_limit_and_unavailable_above_it() {
        for command in COMMANDS {
            let runner = FakeRunner::admitted((200, padded(&command.answer(), MAX_OUTPUT)));
            assert_eq!(
                runner.run(command, command.valid()),
                Ok(command.answer()),
                "{command:?}"
            );
            runner.received();
            let runner = FakeRunner::admitted((200, padded(&command.answer(), MAX_OUTPUT + 1)));
            assert_eq!(
                runner.run(command, command.valid()),
                Err(UNAVAILABLE.to_string()),
                "{command:?}"
            );
            runner.received();
        }
    }

    #[test]
    fn an_invalid_request_never_issues_a_request() {
        for (command, fields) in [
            (Command::Change, json!({ "projectId": "../runner" })),
            (
                Command::Change,
                json!({ "change": { "kind": "remove", "name": "--scope", "scope": "user" } }),
            ),
            (Command::LoginStart, json!({ "name": "do\ncs" })),
            (Command::LoginStart, json!({ "runnerId": "run\nner" })),
            (Command::LoginState, json!({ "loginId": "../../runner" })),
            (Command::LoginCancel, json!({ "loginId": "short" })),
            (
                Command::LoginCallback,
                json!({ "loginId": "login-0123456789/../x" }),
            ),
            (
                Command::LoginCallback,
                json!({ "callbackUrl": "http://example.com/callback?code=abc" }),
            ),
            (Command::LoginCallback, json!({ "serverId": "a/b" })),
        ] {
            let runner = FakeRunner::admitted((200, command.answer().to_string()));
            assert_eq!(
                runner.run(command, with(command.valid(), fields.clone())),
                Err(INVALID_REQUEST.to_string()),
                "{command:?} {fields}"
            );
            assert!(runner.received().is_empty(), "{command:?} {fields}");
        }
    }

    #[test]
    fn a_runner_without_the_capability_is_unsupported_and_never_asked_to_manage() {
        for capabilities in [
            json!({}),
            json!({ "mcpServers": true }),
            json!({ "mcpServers": true, "mcpServerManagement": false }),
        ] {
            for command in COMMANDS {
                let runner = FakeRunner::serving(vec![
                    (200, descriptor(RUNNER, capabilities.clone())),
                    (200, command.answer().to_string()),
                ]);
                assert_eq!(
                    runner.run(command, command.valid()),
                    Err(UNSUPPORTED_RUNNER.to_string()),
                    "{command:?} {capabilities}"
                );
                assert_eq!(runner.request_lines(), ["GET /v1/runner HTTP/1.1"]);
            }
        }
        let runner = FakeRunner::serving(vec![(
            200,
            descriptor(RUNNER, json!({ "mcpServerManagement": "true" })),
        )]);
        assert_eq!(
            runner.run(Command::Change, Command::Change.valid()),
            Err(SERVER_UNAVAILABLE.to_string())
        );
        assert_eq!(runner.request_lines(), ["GET /v1/runner HTTP/1.1"]);
        let runner = FakeRunner::admitted((200, Command::Change.answer().to_string()));
        let managing_only = FakeRunner::serving(vec![
            (
                200,
                descriptor(RUNNER, json!({ "mcpServerManagement": true })),
            ),
            (
                200,
                descriptor(RUNNER, json!({ "mcpServerManagement": true })),
            ),
            (200, Command::Change.answer().to_string()),
        ]);
        assert!(runner.run(Command::Change, Command::Change.valid()).is_ok());
        assert!(managing_only
            .run(Command::Change, Command::Change.valid())
            .is_ok());
        runner.received();
        managing_only.received();
    }

    #[test]
    fn a_changed_runner_identity_is_server_unavailable_before_any_management_request() {
        let replacement = (
            200,
            descriptor("replacement", json!({ "mcpServerManagement": true })),
        );
        let mismatch = (409, "{\"error\":\"runner_identity_mismatch\"}".to_string());
        for (responses, calls) in [
            (vec![replacement.clone()], 1),
            (vec![(200, managing()), replacement.clone()], 2),
            (vec![mismatch.clone()], 1),
            (vec![(200, managing()), mismatch.clone()], 2),
        ] {
            let runner = FakeRunner::serving(responses);
            assert_eq!(
                runner.run(Command::Change, Command::Change.valid()),
                Err(SERVER_UNAVAILABLE.to_string())
            );
            let lines = runner.request_lines();
            assert_eq!(lines.len(), calls);
            assert!(lines.iter().all(|line| line == "GET /v1/runner HTTP/1.1"));
        }
    }

    #[test]
    fn a_superseded_connection_is_server_unavailable_without_any_request() {
        let runner = FakeRunner::admitted((200, Command::Change.answer().to_string()));
        assert_eq!(
            ensure_exact_runner(&runner.lease, "replacement"),
            Err(SERVER_UNAVAILABLE)
        );
        runner.lease.revoke();
        assert_eq!(
            ensure_exact_runner(&runner.lease, RUNNER),
            Err(SERVER_UNAVAILABLE)
        );
        for command in COMMANDS {
            assert_eq!(
                runner.run(command, command.valid()),
                Err(SERVER_UNAVAILABLE.to_string()),
                "{command:?}"
            );
        }
        assert!(runner.received().is_empty());
    }
}
