use super::*;
use serde_json::{json, Value};

const CLAUDE: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
const ROOT: &str = "/Users/dev/project";

fn change_request(provider: &str, change: Value) -> Value {
    json!({ "repositoryRoot": ROOT, "provider": provider, "change": change })
}

fn parse_change(value: Value) -> Result<AgentMcpServerChangeRequest, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn validated(provider: &str, change: Value) -> Result<(), String> {
    let request = parse_change(change_request(provider, change)).expect("request shape");
    validate_change_request(&request)
}

fn add(name: &str, scope: &str, launch: Value) -> Value {
    json!({ "kind": "add", "name": name, "scope": scope, "launch": launch })
}

fn http(url: &str) -> Value {
    json!({ "kind": "http", "url": url })
}

fn stdio(command: &str, args: &[String]) -> Value {
    json!({ "kind": "stdio", "command": command, "args": args })
}

fn assert_invalid(result: Result<(), String>) {
    assert_eq!(
        result.err().as_deref(),
        Some(AGENT_MCP_SERVER_INVALID_REQUEST_ERROR)
    );
}

#[test]
fn the_new_error_strings_match_the_shared_contract() {
    assert_eq!(
        AGENT_MCP_SERVER_INVALID_REQUEST_ERROR,
        "Agent MCP server request is invalid."
    );
    assert_eq!(
        AGENT_MCP_SERVER_EXISTS_ERROR,
        "An MCP server with this name is already configured."
    );
    assert_eq!(
        AGENT_MCP_SERVER_NOT_FOUND_ERROR,
        "The MCP server is not configured."
    );
    assert_eq!(
        AGENT_MCP_SERVER_CHANGE_UNSUPPORTED_ERROR,
        "This MCP server cannot be changed from Codevo."
    );
    assert_eq!(
        AGENT_MCP_SERVER_LOGIN_UNSUPPORTED_ERROR,
        "This MCP server does not support sign-in."
    );
    assert_eq!(
        AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR,
        "The MCP server sign-in is no longer active."
    );
}

#[test]
fn every_change_variant_parses_from_its_camel_case_wire_shape() {
    let added = parse_change(change_request(
        "claudeCode",
        add("docs", "local", http("https://docs.example/mcp")),
    ))
    .expect("add http");
    assert_eq!(added.provider, CLAUDE);
    assert_eq!(added.repository_root, ROOT);
    assert_eq!(
        added.change,
        AgentMcpServerChange::Add {
            name: "docs".to_string(),
            scope: AgentMcpServerConfigScope::Local,
            launch: AgentMcpServerLaunch::Http {
                url: "https://docs.example/mcp".to_string()
            },
        }
    );
    let sse = parse_change(change_request(
        "claudeCode",
        add(
            "events",
            "user",
            json!({ "kind": "sse", "url": "https://e.example/sse" }),
        ),
    ))
    .expect("add sse");
    assert!(matches!(
        sse.change,
        AgentMcpServerChange::Add {
            launch: AgentMcpServerLaunch::Sse { .. },
            ..
        }
    ));
    let local = parse_change(change_request(
        "codex",
        add("tool", "user", stdio("npx", &["-y".to_string()])),
    ))
    .expect("add stdio");
    assert_eq!(local.provider, CODEX);
    assert_eq!(
        local.change,
        AgentMcpServerChange::Add {
            name: "tool".to_string(),
            scope: AgentMcpServerConfigScope::User,
            launch: AgentMcpServerLaunch::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string()],
            },
        }
    );
    let removed = parse_change(change_request(
        "claudeCode",
        json!({ "kind": "remove", "name": "docs", "scope": "project" }),
    ))
    .expect("remove");
    assert_eq!(
        removed.change,
        AgentMcpServerChange::Remove {
            name: "docs".to_string(),
            scope: AgentMcpServerConfigScope::Project,
        }
    );
    let signed_out = parse_change(change_request(
        "codex",
        json!({ "kind": "signOut", "name": "claude.ai Docs" }),
    ))
    .expect("sign out");
    assert_eq!(
        signed_out.change,
        AgentMcpServerChange::SignOut {
            name: "claude.ai Docs".to_string()
        }
    );
}

#[test]
fn unknown_fields_kinds_and_missing_fields_are_rejected_at_every_level() {
    let valid_launch = http("https://docs.example/mcp");
    let rejected = [
        json!({ "repositoryRoot": ROOT, "provider": "codex", "change": { "kind": "signOut", "name": "a" }, "cwd": "/tmp" }),
        json!({ "repositoryRoot": ROOT, "provider": "gemini", "change": { "kind": "signOut", "name": "a" } }),
        json!({ "repositoryRoot": ROOT, "change": { "kind": "signOut", "name": "a" } }),
        json!({ "provider": "codex", "change": { "kind": "signOut", "name": "a" } }),
        json!({ "repositoryRoot": ROOT, "provider": "codex" }),
        change_request(
            "codex",
            json!({ "kind": "signOut", "name": "a", "scope": "user" }),
        ),
        change_request("codex", json!({ "kind": "rename", "name": "a" })),
        change_request("codex", json!({ "name": "a" })),
        change_request("codex", json!({ "kind": "remove", "name": "a" })),
        change_request(
            "codex",
            json!({ "kind": "remove", "name": "a", "scope": "global" }),
        ),
        change_request(
            "codex",
            json!({ "kind": "remove", "name": "a", "scope": "user", "force": true }),
        ),
        change_request(
            "codex",
            json!({ "kind": "add", "name": "a", "scope": "user" }),
        ),
        change_request(
            "codex",
            json!({ "kind": "add", "name": "a", "scope": "user", "launch": valid_launch, "env": {} }),
        ),
        change_request(
            "codex",
            add(
                "a",
                "user",
                json!({ "kind": "http", "url": "https://a.example", "headers": {} }),
            ),
        ),
        change_request("codex", add("a", "user", json!({ "kind": "http" }))),
        change_request(
            "codex",
            add(
                "a",
                "user",
                json!({ "kind": "websocket", "url": "wss://a.example" }),
            ),
        ),
        change_request(
            "codex",
            add("a", "user", json!({ "kind": "stdio", "command": "npx" })),
        ),
        change_request(
            "codex",
            add(
                "a",
                "user",
                json!({ "kind": "stdio", "command": "npx", "args": "x" }),
            ),
        ),
        change_request(
            "codex",
            add(
                "a",
                "user",
                json!({ "kind": "stdio", "command": "npx", "args": [], "env": {} }),
            ),
        ),
        change_request(
            "codex",
            add(
                "a",
                "user",
                json!({ "kind": "stdio", "command": "npx", "args": [1] }),
            ),
        ),
        change_request("codex", add("a", "user", json!("https://a.example"))),
    ];
    for value in rejected {
        assert!(parse_change(value.clone()).is_err(), "{value}");
    }
}

#[test]
fn login_requests_are_strict_camel_case_shapes() {
    let start: AgentMcpServerLoginStartRequest = serde_json::from_value(json!({
        "repositoryRoot": ROOT, "provider": "claudeCode", "name": "docs", "mode": "signInAgain",
    }))
    .expect("start");
    assert_eq!(start.mode, AgentMcpServerLoginMode::SignInAgain);
    assert_eq!(start.provider, CLAUDE);
    let plain: AgentMcpServerLoginStartRequest = serde_json::from_value(json!({
        "repositoryRoot": ROOT, "provider": "codex", "name": "docs", "mode": "signIn",
    }))
    .expect("start");
    assert_eq!(plain.mode, AgentMcpServerLoginMode::SignIn);
    for value in [
        json!({ "repositoryRoot": ROOT, "provider": "codex", "name": "docs" }),
        json!({ "repositoryRoot": ROOT, "provider": "codex", "name": "docs", "mode": "signOut" }),
        json!({ "repositoryRoot": ROOT, "provider": "codex", "mode": "signIn" }),
        json!({ "repositoryRoot": ROOT, "provider": "codex", "name": "docs", "mode": "signIn", "callbackUrl": "http://localhost/" }),
    ] {
        assert!(
            serde_json::from_value::<AgentMcpServerLoginStartRequest>(value.clone()).is_err(),
            "{value}"
        );
    }
    let lookup: AgentMcpServerLoginRequest =
        serde_json::from_value(json!({ "loginId": "0123456789abcdef" })).expect("lookup");
    assert_eq!(lookup.login_id, "0123456789abcdef");
    for value in [
        json!({}),
        json!({ "loginId": 7 }),
        json!({ "login_id": "0123456789abcdef" }),
        json!({ "loginId": "0123456789abcdef", "repositoryRoot": ROOT }),
    ] {
        assert!(
            serde_json::from_value::<AgentMcpServerLoginRequest>(value.clone()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn responses_serialize_to_the_exact_wire_shapes() {
    assert_eq!(
        serde_json::to_value(AgentMcpServerAck::acknowledged()).unwrap(),
        json!({ "version": 1 })
    );
    assert_eq!(
        serde_json::to_value(AgentMcpServerLoginStarted::new(
            AgentMcpServerLoginStep::Completed
        ))
        .unwrap(),
        json!({ "version": 1, "step": { "kind": "completed" } })
    );
    assert_eq!(
        serde_json::to_value(AgentMcpServerLoginStarted::new(
            AgentMcpServerLoginStep::FinishInBrowser {
                authorization_url: "https://claude.ai/connect".to_string()
            }
        ))
        .unwrap(),
        json!({
            "version": 1,
            "step": { "kind": "finishInBrowser", "authorizationUrl": "https://claude.ai/connect" },
        })
    );
    assert_eq!(
        serde_json::to_value(AgentMcpServerLoginStarted::new(
            AgentMcpServerLoginStep::AwaitingCallback {
                login_id: "0123456789abcdef".to_string(),
                authorization_url: "https://auth.example/authorize?state=s".to_string(),
                delivery: AgentMcpServerLoginDelivery::Automatic,
            }
        ))
        .unwrap(),
        json!({
            "version": 1,
            "step": {
                "kind": "awaitingCallback",
                "loginId": "0123456789abcdef",
                "authorizationUrl": "https://auth.example/authorize?state=s",
                "delivery": "automatic",
            },
        })
    );
    for (state, wire) in [
        (AgentMcpServerLoginState::Pending, "pending"),
        (AgentMcpServerLoginState::Succeeded, "succeeded"),
        (AgentMcpServerLoginState::Failed, "failed"),
    ] {
        assert_eq!(
            serde_json::to_value(AgentMcpServerLoginStatus::new(state)).unwrap(),
            json!({ "version": 1, "state": wire })
        );
    }
}

#[test]
fn a_login_step_never_prints_its_authorization_url() {
    let step = AgentMcpServerLoginStep::AwaitingCallback {
        login_id: "0123456789abcdef".to_string(),
        authorization_url: "https://auth.example/authorize?state=secret".to_string(),
        delivery: AgentMcpServerLoginDelivery::Automatic,
    };
    assert_eq!(format!("{step:?}"), "AwaitingCallback");
    let finish = AgentMcpServerLoginStep::FinishInBrowser {
        authorization_url: "https://claude.ai/secret".to_string(),
    };
    assert_eq!(format!("{finish:?}"), "FinishInBrowser");
}

#[test]
fn configuration_names_follow_the_closed_pattern() {
    let longest = "a".repeat(MAX_MCP_CONFIG_NAME_BYTES);
    for name in ["a", "_private", "0day", "docs-server_2", longest.as_str()] {
        assert!(is_valid_config_name(name), "{name}");
    }
    let too_long = "a".repeat(MAX_MCP_CONFIG_NAME_BYTES + 1);
    for name in [
        "",
        "-docs",
        "--scope",
        "docs server",
        "docs.server",
        "docs/server",
        "docs\n",
        "dócs",
        "docs=1",
        too_long.as_str(),
    ] {
        assert!(!is_valid_config_name(name), "{name}");
        assert_invalid(validated(
            "claudeCode",
            add(name, "user", http("https://docs.example/mcp")),
        ));
        assert_invalid(validated(
            "codex",
            json!({ "kind": "remove", "name": name, "scope": "user" }),
        ));
    }
    assert_eq!(MAX_MCP_CONFIG_NAME_BYTES, 64);
}

#[test]
fn sign_out_and_login_names_follow_the_status_name_rule() {
    let longest = "n".repeat(128);
    for name in ["docs", "claude.ai Docs", "-leading-dash", longest.as_str()] {
        assert_eq!(
            validated("codex", json!({ "kind": "signOut", "name": name })),
            Ok(()),
            "{name}"
        );
        assert_eq!(
            validate_login_start_request(&AgentMcpServerLoginStartRequest {
                repository_root: ROOT.to_string(),
                provider: CLAUDE,
                name: name.to_string(),
                mode: AgentMcpServerLoginMode::SignIn,
            }),
            Ok(()),
            "{name}"
        );
    }
    let too_long = "n".repeat(129);
    for name in [
        "",
        " docs",
        "docs ",
        "do\ncs",
        "do\u{0}cs",
        "do\u{202e}cs",
        too_long.as_str(),
    ] {
        assert_invalid(validated(
            "claudeCode",
            json!({ "kind": "signOut", "name": name }),
        ));
        assert_invalid(validate_login_start_request(
            &AgentMcpServerLoginStartRequest {
                repository_root: ROOT.to_string(),
                provider: CODEX,
                name: name.to_string(),
                mode: AgentMcpServerLoginMode::SignInAgain,
            },
        ));
    }
}

#[test]
fn launch_urls_are_bounded_http_urls_without_userinfo_or_blanks() {
    let prefix = "https://docs.example/";
    let longest = format!(
        "{prefix}{}",
        "a".repeat(MAX_MCP_LAUNCH_URL_BYTES - prefix.len())
    );
    assert_eq!(longest.len(), 2048);
    for url in [
        "https://docs.example/mcp",
        "http://127.0.0.1:8080/mcp?x=--scope",
        "https://docs.example",
        "https://[::1]:8443/mcp",
        longest.as_str(),
    ] {
        assert!(is_valid_launch_url(url), "{url}");
        assert_eq!(
            validated("codex", add("docs", "user", http(url))),
            Ok(()),
            "{url}"
        );
    }
    let too_long = format!("{longest}a");
    for url in [
        "",
        "docs.example/mcp",
        "--scope",
        "ftp://docs.example/mcp",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://",
        "https://user@docs.example/mcp",
        "https://user:secret@docs.example/mcp",
        "https://docs.example/a b",
        "https://docs.example/a\tb",
        " https://docs.example/mcp",
        "https://docs.example/mcp\n",
        "https://docs.example/\u{0}",
        "https://docs.example/\u{a0}x",
        too_long.as_str(),
    ] {
        assert!(!is_valid_launch_url(url), "{url}");
        assert_invalid(validated("claudeCode", add("docs", "user", http(url))));
        assert_invalid(validated(
            "claudeCode",
            add("docs", "user", json!({ "kind": "sse", "url": url })),
        ));
    }
}

#[test]
fn commands_and_arguments_are_bounded_and_free_of_control_characters() {
    let longest_command = "c".repeat(MAX_MCP_COMMAND_BYTES);
    let longest_arg = "a".repeat(MAX_MCP_ARG_BYTES);
    let most_args = vec![longest_arg.clone(); MAX_MCP_ARGS];
    assert_eq!(
        (MAX_MCP_COMMAND_BYTES, MAX_MCP_ARGS, MAX_MCP_ARG_BYTES),
        (1024, 32, 1024)
    );
    for (command, args) in [
        ("npx", vec![]),
        (
            "/opt/my tools/server",
            vec!["--flag".to_string(), String::new()],
        ),
        ("--version", vec!["--".to_string(), "-e".to_string()]),
        (longest_command.as_str(), most_args.clone()),
    ] {
        assert_eq!(
            validated("claudeCode", add("tool", "local", stdio(command, &args))),
            Ok(()),
            "{command}"
        );
        assert_eq!(
            validated("codex", add("tool", "user", stdio(command, &args))),
            Ok(())
        );
    }
    let command_too_long = format!("{longest_command}c");
    for command in [
        "",
        "np\nx",
        "np\u{0}x",
        "np\u{7f}x",
        command_too_long.as_str(),
    ] {
        assert_invalid(validated("codex", add("tool", "user", stdio(command, &[]))));
    }
    let too_many = vec!["a".to_string(); MAX_MCP_ARGS + 1];
    assert_invalid(validated(
        "codex",
        add("tool", "user", stdio("npx", &too_many)),
    ));
    let arg_too_long = format!("{longest_arg}a");
    for arg in ["a\u{0}b", "a\nb", "a\u{1b}[0m", arg_too_long.as_str()] {
        assert_invalid(validated(
            "claudeCode",
            add("tool", "user", stdio("npx", &[arg.to_string()])),
        ));
    }
}

#[test]
fn provider_scope_and_transport_combinations_are_closed() {
    let launch = || http("https://docs.example/mcp");
    assert_eq!(
        validated("claudeCode", add("docs", "local", launch())),
        Ok(())
    );
    assert_eq!(
        validated("claudeCode", add("docs", "user", launch())),
        Ok(())
    );
    assert_invalid(validated("claudeCode", add("docs", "project", launch())));
    assert_eq!(validated("codex", add("docs", "user", launch())), Ok(()));
    assert_invalid(validated("codex", add("docs", "local", launch())));
    assert_invalid(validated("codex", add("docs", "project", launch())));
    let sse = || json!({ "kind": "sse", "url": "https://docs.example/sse" });
    assert_eq!(validated("claudeCode", add("docs", "user", sse())), Ok(()));
    assert_invalid(validated("codex", add("docs", "user", sse())));
    for scope in ["user", "project", "local"] {
        assert_eq!(
            validated(
                "claudeCode",
                json!({ "kind": "remove", "name": "docs", "scope": scope })
            ),
            Ok(())
        );
    }
    assert_eq!(
        validated(
            "codex",
            json!({ "kind": "remove", "name": "docs", "scope": "user" })
        ),
        Ok(())
    );
    for scope in ["project", "local"] {
        assert_invalid(validated(
            "codex",
            json!({ "kind": "remove", "name": "docs", "scope": scope }),
        ));
    }
}

#[test]
fn an_invalid_repository_root_is_an_invalid_request() {
    for root in ["", "relative", "/a/../b", "/a/./b", "/a\nb"] {
        let request = AgentMcpServerChangeRequest {
            repository_root: root.to_string(),
            provider: CODEX,
            change: AgentMcpServerChange::SignOut {
                name: "docs".to_string(),
            },
        };
        assert_invalid(validate_change_request(&request));
        assert_invalid(validate_login_start_request(
            &AgentMcpServerLoginStartRequest {
                repository_root: root.to_string(),
                provider: CODEX,
                name: "docs".to_string(),
                mode: AgentMcpServerLoginMode::SignIn,
            },
        ));
    }
}

#[test]
fn authorization_urls_must_be_https_or_loopback_http() {
    let prefix = "https://auth.example/authorize?state=";
    let longest = format!(
        "{prefix}{}",
        "s".repeat(MAX_MCP_AUTHORIZATION_URL_BYTES - prefix.len())
    );
    assert_eq!(longest.len(), 4096);
    for url in [
        "https://auth.example/authorize?client_id=a&redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fcallback",
        "https://claude.ai/connect",
        "http://localhost:33418/authorize",
        "http://127.0.0.1:33418/authorize?x=1",
        "http://localhost/authorize",
        longest.as_str(),
    ] {
        assert!(is_valid_authorization_url(url), "{url}");
    }
    let too_long = format!("{longest}s");
    for url in [
        "",
        "http://auth.example/authorize",
        "http://localhost.evil.example/authorize",
        "http://127.0.0.1.evil.example/authorize",
        "http://localhost@evil.example/authorize",
        "http://[::1]:8080/authorize",
        "https://user@auth.example/authorize",
        "https://auth.example/a b",
        "https://auth.example/a\nb",
        "https://auth.example/\u{7}",
        "HTTPS://auth.example/authorize",
        "https:auth.example/authorize",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "codex://callback",
        "//auth.example/authorize",
        "auth.example/authorize",
        too_long.as_str(),
    ] {
        assert!(!is_valid_authorization_url(url), "{url}");
    }
}

#[test]
fn login_ids_follow_the_opaque_id_pattern() {
    let longest = "a".repeat(MAX_MCP_LOGIN_ID_BYTES);
    for id in ["01234567", "0123-abcd-EFGH", longest.as_str()] {
        assert!(is_valid_login_id(id), "{id}");
        assert_eq!(
            validate_login_request(&AgentMcpServerLoginRequest {
                login_id: id.to_string()
            }),
            Ok(())
        );
    }
    let too_long = "a".repeat(MAX_MCP_LOGIN_ID_BYTES + 1);
    for id in [
        "",
        "0123456",
        "0123 4567",
        "0123_4567",
        "01234567\n",
        "../../etc",
        "0123456é",
        too_long.as_str(),
    ] {
        assert!(!is_valid_login_id(id), "{id}");
        assert_invalid(validate_login_request(&AgentMcpServerLoginRequest {
            login_id: id.to_string(),
        }));
    }
    assert_eq!((MIN_MCP_LOGIN_ID_BYTES, MAX_MCP_LOGIN_ID_BYTES), (8, 64));
}
