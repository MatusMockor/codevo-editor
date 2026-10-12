use super::*;
use crate::agent_mcp_server_manage_domain::AGENT_MCP_SERVER_INVALID_REQUEST_ERROR;

const CLAUDE: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;
const ROOT: &str = "/work/project";

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn http(url: &str) -> AgentMcpServerLaunch {
    AgentMcpServerLaunch::Http {
        url: url.to_string(),
    }
}

fn stdio(command: &str, args: &[&str]) -> AgentMcpServerLaunch {
    AgentMcpServerLaunch::Stdio {
        command: command.to_string(),
        args: strings(args),
    }
}

fn add(
    name: &str,
    scope: AgentMcpServerConfigScope,
    launch: AgentMcpServerLaunch,
) -> AgentMcpServerChange {
    AgentMcpServerChange::Add {
        name: name.to_string(),
        scope,
        launch,
    }
}

fn command(provider: AgentCliInvocation, change: &AgentMcpServerChange) -> McpChangeCommand {
    match mcp_change_operation(provider, change, ROOT) {
        Ok(McpChangeOperation::Command(command)) => command,
        Ok(McpChangeOperation::Exchange(_)) => panic!("expected a command"),
        Err(failure) => panic!("unexpected failure {failure:?}"),
    }
}

fn exchange(provider: AgentCliInvocation, change: &AgentMcpServerChange) -> McpChangeExchange {
    match mcp_change_operation(provider, change, ROOT) {
        Ok(McpChangeOperation::Exchange(exchange)) => exchange,
        Ok(McpChangeOperation::Command(_)) => panic!("expected an exchange"),
        Err(failure) => panic!("unexpected failure {failure:?}"),
    }
}

fn written(step: McpProbeStep) -> Value {
    let McpProbeStep::Write(bytes) = step else {
        panic!("expected a write, got {step:?}");
    };
    assert_eq!(bytes.last(), Some(&b'\n'));
    assert_eq!(bytes.iter().filter(|byte| **byte == b'\n').count(), 1);
    serde_json::from_slice(&bytes).expect("request is one JSON line")
}

fn claude_success(request_id: &str, response: Value) -> Vec<u8> {
    json_line(&json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response },
    }))
}

fn claude_error(request_id: &str, error: &str) -> Vec<u8> {
    json_line(&json!({
        "type": "control_response",
        "response": { "subtype": "error", "request_id": request_id, "error": error },
    }))
}

fn codex_result(id: u64, result: Value) -> Vec<u8> {
    json_line(&json!({ "id": id, "result": result }))
}

fn codex_error(id: u64, message: &str) -> Vec<u8> {
    json_line(&json!({ "id": id, "error": { "code": -32600, "message": message } }))
}

#[test]
fn failures_map_to_the_closed_error_strings() {
    assert_eq!(
        McpChangeFailure::ServerExists.message(),
        "An MCP server with this name is already configured."
    );
    assert_eq!(
        McpChangeFailure::ServerNotFound.message(),
        "The MCP server is not configured."
    );
    assert_eq!(
        McpChangeFailure::ChangeUnsupported.message(),
        "This MCP server cannot be changed from Codevo."
    );
    assert_eq!(
        McpChangeFailure::TimedOut.message(),
        "Agent MCP server status check timed out."
    );
    assert_eq!(
        McpChangeFailure::Unavailable.message(),
        "Agent MCP server status is unavailable."
    );
    assert_ne!(
        McpChangeFailure::Unavailable.message(),
        AGENT_MCP_SERVER_INVALID_REQUEST_ERROR
    );
}

#[test]
fn claude_add_places_every_user_value_after_the_option_terminator() {
    let added = command(
        CLAUDE,
        &add(
            "docs",
            AgentMcpServerConfigScope::User,
            http("https://docs.example/mcp?x=--scope"),
        ),
    );
    assert_eq!(
        added.args(),
        strings(&[
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "http",
            "--",
            "docs",
            "https://docs.example/mcp?x=--scope",
        ])
    );
    let sse = command(
        CLAUDE,
        &add(
            "events",
            AgentMcpServerConfigScope::Local,
            AgentMcpServerLaunch::Sse {
                url: "https://e.example/sse".to_string(),
            },
        ),
    );
    assert_eq!(
        sse.args(),
        strings(&[
            "mcp",
            "add",
            "--scope",
            "local",
            "--transport",
            "sse",
            "--",
            "events",
            "https://e.example/sse",
        ])
    );
}

#[test]
fn hostile_commands_and_arguments_cannot_become_claude_options() {
    let hostile = [
        "--scope",
        "user",
        "-e",
        "TOKEN=1",
        "--",
        "--help",
        "; rm -rf /",
        "$(id)",
        "",
    ];
    let added = command(
        CLAUDE,
        &add(
            "tool",
            AgentMcpServerConfigScope::Local,
            stdio("--version", &hostile),
        ),
    );
    let args = added.args();
    assert_eq!(
        args[..9],
        strings(&[
            "mcp",
            "add",
            "--scope",
            "local",
            "--transport",
            "stdio",
            "--",
            "tool",
            "--version",
        ])
    );
    assert_eq!(args[9..], strings(&hostile));
    let terminator = args.iter().position(|arg| arg == "--").expect("terminator");
    assert_eq!(terminator, 6);
    assert!(args[..terminator].iter().all(|arg| [
        "mcp",
        "add",
        "--scope",
        "local",
        "--transport",
        "stdio"
    ]
    .contains(&arg.as_str())));
}

#[test]
fn remove_and_sign_out_commands_terminate_options_before_the_name() {
    let removed = command(
        CLAUDE,
        &AgentMcpServerChange::Remove {
            name: "docs".to_string(),
            scope: AgentMcpServerConfigScope::Project,
        },
    );
    assert_eq!(
        removed.args(),
        strings(&["mcp", "remove", "--scope", "project", "--", "docs"])
    );
    let codex_removed = command(
        CODEX,
        &AgentMcpServerChange::Remove {
            name: "docs".to_string(),
            scope: AgentMcpServerConfigScope::User,
        },
    );
    assert_eq!(
        codex_removed.args(),
        strings(&["mcp", "remove", "--", "docs"])
    );
    let signed_out = command(
        CODEX,
        &AgentMcpServerChange::SignOut {
            name: "--config model=x".to_string(),
        },
    );
    assert_eq!(
        signed_out.args(),
        strings(&["mcp", "logout", "--", "--config model=x"])
    );
}

#[test]
fn an_invalid_or_unsupported_change_never_becomes_an_operation() {
    let invalid = [
        (
            CLAUDE,
            add(
                "-docs",
                AgentMcpServerConfigScope::User,
                http("https://d.example"),
            ),
        ),
        (
            CLAUDE,
            add(
                "docs",
                AgentMcpServerConfigScope::Project,
                http("https://d.example"),
            ),
        ),
        (
            CLAUDE,
            add("docs", AgentMcpServerConfigScope::User, http("--help")),
        ),
        (
            CODEX,
            add(
                "docs",
                AgentMcpServerConfigScope::Local,
                http("https://d.example"),
            ),
        ),
        (
            CODEX,
            add(
                "docs",
                AgentMcpServerConfigScope::User,
                AgentMcpServerLaunch::Sse {
                    url: "https://d.example/sse".to_string(),
                },
            ),
        ),
        (
            CODEX,
            add(
                "a.b",
                AgentMcpServerConfigScope::User,
                http("https://d.example"),
            ),
        ),
        (
            CODEX,
            AgentMcpServerChange::Remove {
                name: "docs".to_string(),
                scope: AgentMcpServerConfigScope::Project,
            },
        ),
        (
            CLAUDE,
            AgentMcpServerChange::SignOut {
                name: "do\ncs".to_string(),
            },
        ),
    ];
    for (provider, change) in invalid {
        assert!(
            matches!(
                mcp_change_operation(provider, &change, ROOT),
                Err(McpChangeFailure::Unavailable)
            ),
            "{change:?}"
        );
    }
}

#[test]
fn claude_command_outcomes_use_the_exit_status_and_a_narrow_message_match() {
    let added = command(
        CLAUDE,
        &add(
            "docs",
            AgentMcpServerConfigScope::User,
            http("https://d.example"),
        ),
    );
    let failed = |stderr: &str| {
        added.outcome(McpCommandCompletion::Failed {
            stderr: stderr.as_bytes(),
        })
    };
    assert_eq!(
        added.outcome(McpCommandCompletion::Succeeded {
            stdout: b"MCP server docs already exists in user config\n"
        }),
        Ok(())
    );
    assert_eq!(
        failed("MCP server docs already exists in user config\n"),
        Err(McpChangeFailure::ServerExists)
    );
    assert_eq!(
        failed("warning: slow disk\n  MCP server docs already exists in user config\n"),
        Err(McpChangeFailure::ServerExists)
    );
    for stderr in [
        "",
        "MCP server other already exists in user config\n",
        "MCP server docs-2 already exists in user config\n",
        "MCP server docs already exists in local config\n",
        "MCP server docs already exists in user config: MCP server x\n",
        "Invalid name docs. Names can only contain letters\n",
        "error: MCP server docs already exists in user config\n",
        "\u{ff}\u{fe}",
    ] {
        assert_eq!(
            failed(stderr),
            Err(McpChangeFailure::Unavailable),
            "{stderr}"
        );
    }
    let removed = command(
        CLAUDE,
        &AgentMcpServerChange::Remove {
            name: "docs".to_string(),
            scope: AgentMcpServerConfigScope::Project,
        },
    );
    assert_eq!(
        removed.outcome(McpCommandCompletion::Succeeded { stdout: b"" }),
        Ok(())
    );
    for (scope, stderr) in [
        (
            AgentMcpServerConfigScope::Project,
            "No MCP server named \"docs\" in .mcp.json\n",
        ),
        (
            AgentMcpServerConfigScope::User,
            "No MCP server named \"docs\" in user scope\n",
        ),
        (
            AgentMcpServerConfigScope::Local,
            "note\n No MCP server named \"docs\" in local scope \n",
        ),
    ] {
        let scoped = McpChangeCommand::ClaudeRemove {
            name: "docs".to_string(),
            scope,
        };
        assert_eq!(
            scoped.outcome(McpCommandCompletion::Failed {
                stderr: stderr.as_bytes()
            }),
            Err(McpChangeFailure::ServerNotFound)
        );
    }
    for stderr in [
        "No MCP server named \"docs2\" in .mcp.json\n",
        "No MCP server named \"docs\" in user scope\n",
        "No MCP server named \"docs\" in .mcp.json.bak\n",
        "Failed: No MCP server named \"docs\" in .mcp.json\n",
        "EACCES\n",
    ] {
        assert_eq!(
            removed.outcome(McpCommandCompletion::Failed {
                stderr: stderr.as_bytes()
            }),
            Err(McpChangeFailure::Unavailable),
            "{stderr}"
        );
    }
}

#[test]
fn codex_command_outcomes_distinguish_missing_and_unsupported_servers() {
    let removed = McpChangeCommand::CodexRemove {
        name: "docs".to_string(),
    };
    assert_eq!(
        removed.outcome(McpCommandCompletion::Succeeded {
            stdout: b"Removed global MCP server 'docs'.\n"
        }),
        Ok(())
    );
    assert_eq!(
        removed.outcome(McpCommandCompletion::Succeeded {
            stdout: b"No MCP server named 'docs' found.\n"
        }),
        Err(McpChangeFailure::ServerNotFound)
    );
    assert_eq!(
        removed.outcome(McpCommandCompletion::Succeeded {
            stdout: b"No MCP server named 'docs-2' found.\n"
        }),
        Ok(())
    );
    assert_eq!(
        removed.outcome(McpCommandCompletion::Failed {
            stderr: b"No MCP server named 'docs' found.\n"
        }),
        Err(McpChangeFailure::Unavailable)
    );
    let signed_out = McpChangeCommand::CodexSignOut {
        name: "docs".to_string(),
    };
    assert_eq!(
        signed_out.outcome(McpCommandCompletion::Succeeded {
            stdout: b"No OAuth credentials stored for 'docs'.\n"
        }),
        Ok(())
    );
    let failed = |stderr: &str| {
        signed_out.outcome(McpCommandCompletion::Failed {
            stderr: stderr.as_bytes(),
        })
    };
    assert_eq!(
        failed("WARNING: proceeding\nError: No MCP server named 'docs' found in configuration.\n"),
        Err(McpChangeFailure::ServerNotFound)
    );
    assert_eq!(
        failed("Error: OAuth logout is only supported for streamable_http transports.\n"),
        Err(McpChangeFailure::ChangeUnsupported)
    );
    for stderr in [
        "",
        "Error: No MCP server named 'other' found in configuration.\n",
        "Error: keyring is locked\n",
    ] {
        assert_eq!(
            failed(stderr),
            Err(McpChangeFailure::Unavailable),
            "{stderr}"
        );
    }
}

#[test]
fn provider_refusals_match_complete_known_messages() {
    assert_eq!(
        claude_refusal("Server not found: docs", "docs"),
        ProviderRefusal::ServerNotFound
    );
    assert_eq!(
        claude_refusal(
            "Server type \"stdio\" does not support OAuth authentication",
            "docs"
        ),
        ProviderRefusal::Unsupported
    );
    assert_eq!(
        claude_refusal("Cannot clear auth for server type \"stdio\"", "docs"),
        ProviderRefusal::Unsupported
    );
    for error in [
        "",
        "Server not found: docs-2",
        "Server not found: other",
        "SDK auth failed: Server not found: docs",
        "Server type \"stdio\" does not support OAuth authentication for docs",
        "Server type \"a b\" does not support OAuth authentication",
        "Server type \"\" does not support OAuth authentication",
        "Cannot clear auth for server type \"stdio\": busy",
    ] {
        assert_eq!(
            claude_refusal(error, "docs"),
            ProviderRefusal::Other,
            "{error}"
        );
    }
    assert_eq!(
        codex_refusal("No MCP server named 'docs' found.", "docs"),
        ProviderRefusal::ServerNotFound
    );
    assert_eq!(
        codex_refusal(
            "OAuth login is only supported for streamable HTTP servers.",
            "docs"
        ),
        ProviderRefusal::Unsupported
    );
    for message in [
        "",
        "No MCP server named 'docs-2' found.",
        "No MCP server named 'docs' found in configuration.",
        "failed to login to MCP server 'docs': Metadata error",
        "failed: OAuth login is only supported for streamable HTTP servers.",
    ] {
        assert_eq!(
            codex_refusal(message, "docs"),
            ProviderRefusal::Other,
            "{message}"
        );
    }
}

#[test]
fn a_crafted_server_name_cannot_steer_error_classification() {
    for name in [
        "only supported for streamable",
        "OAuth login is only supported for streamable HTTP servers.",
        "No MCP server named",
        "x' found.",
    ] {
        let wrapped = format!("failed to login to MCP server '{name}': Registration failed");
        assert_eq!(
            codex_refusal(&wrapped, name),
            ProviderRefusal::Other,
            "{name}"
        );
        let missing = format!("No MCP server named '{name}' found.");
        assert_eq!(
            codex_refusal(&missing, name),
            ProviderRefusal::ServerNotFound,
            "{name}"
        );
        assert_eq!(
            codex_refusal(&missing, "docs"),
            ProviderRefusal::Other,
            "{name}"
        );
        let signed_out = McpChangeCommand::CodexSignOut {
            name: name.to_string(),
        };
        let stderr = format!("Error: failed to delete OAuth credentials for '{name}'\n");
        assert_eq!(
            signed_out.outcome(McpCommandCompletion::Failed {
                stderr: stderr.as_bytes()
            }),
            Err(McpChangeFailure::Unavailable),
            "{name}"
        );
    }
    for name in [
        "does not support OAuth",
        "Server type \"stdio\" does not support OAuth authentication",
        "Cannot clear auth for server type \"stdio\"",
        "Server not found",
    ] {
        for error in [
            format!("SDK auth failed: {name}: ENOTFOUND"),
            format!("{name}: connection refused"),
            format!("Server not found: {name} (did you mean docs?)"),
        ] {
            assert_eq!(
                claude_refusal(&error, name),
                ProviderRefusal::Other,
                "{error}"
            );
        }
        assert_eq!(
            claude_refusal(&format!("Server not found: {name}"), name),
            ProviderRefusal::ServerNotFound
        );
    }
    let mut login_error = json!({
        "id": 1,
        "error": {
            "code": -32603,
            "message": "failed to login to MCP server 'only supported for streamable': Registration failed",
        },
    });
    let reply = codex_reply(&mut login_error, "only supported for streamable").expect("reply");
    assert_eq!(reply.result.err(), Some(ProviderRefusal::Other));
}

fn clear_auth(name: &str) -> McpChangeExchange {
    exchange(
        CLAUDE,
        &AgentMcpServerChange::SignOut {
            name: name.to_string(),
        },
    )
}

#[test]
fn claude_sign_out_clears_auth_after_the_session_initializes() {
    let mut session = clear_auth("claude.ai \"Docs\"");
    assert_eq!(session.step(), McpProbeStep::Wait);
    assert_eq!(session.outcome(), None);
    session.observe(b"{\"type\":\"system\",\"subtype\":\"init\"}\nnot json\n");
    session.observe(&claude_success("someone-else", json!({})));
    assert_eq!(session.step(), McpProbeStep::Wait);
    let initialized = claude_success(CLAUDE_MCP_INITIALIZE_REQUEST_ID, json!({ "commands": [] }));
    let (head, tail) = initialized.split_at(17);
    session.observe(head);
    assert_eq!(session.step(), McpProbeStep::Wait);
    session.observe(tail);
    assert_eq!(
        written(session.step()),
        json!({
            "type": "control_request",
            "request_id": CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID,
            "request": { "subtype": "mcp_clear_auth", "serverName": "claude.ai \"Docs\"" },
        })
    );
    assert_eq!(session.step(), McpProbeStep::Wait);
    session.observe(&claude_success("codevo-mcp-servers-status-1", json!({})));
    assert_eq!(session.outcome(), None);
    session.observe(&claude_success(CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID, json!({})));
    assert_eq!(session.outcome(), Some(Ok(())));
    assert_eq!(session.step(), McpProbeStep::Done);
    session.observe(&claude_error(CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID, "late"));
    assert_eq!(session.outcome(), Some(Ok(())));
}

#[test]
fn claude_sign_out_maps_control_errors_to_closed_failures() {
    for (error, failure) in [
        ("Server not found: docs", McpChangeFailure::ServerNotFound),
        (
            "Cannot clear auth for server type \"stdio\"",
            McpChangeFailure::ChangeUnsupported,
        ),
        ("keychain is locked", McpChangeFailure::Unavailable),
    ] {
        let mut session = clear_auth("docs");
        session.observe(&claude_success(CLAUDE_MCP_INITIALIZE_REQUEST_ID, json!({})));
        assert!(matches!(session.step(), McpProbeStep::Write(_)));
        session.observe(&claude_error(CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID, error));
        assert_eq!(session.outcome(), Some(Err(failure)), "{error}");
        assert_eq!(session.step(), McpProbeStep::Done);
    }
    let mut refused = clear_auth("docs");
    refused.observe(&claude_error(CLAUDE_MCP_INITIALIZE_REQUEST_ID, "no"));
    assert_eq!(refused.outcome(), Some(Err(McpChangeFailure::Unavailable)));
    assert_eq!(refused.step(), McpProbeStep::Done);
    let mut early = clear_auth("docs");
    early.observe(&claude_success(CLAUDE_MCP_CLEAR_AUTH_REQUEST_ID, json!({})));
    assert_eq!(early.outcome(), None);
    let mut flooded = clear_auth("docs");
    flooded.observe(&vec![b'x'; MAX_CLAUDE_MCP_STATUS_LINE_BYTES + 1]);
    assert_eq!(flooded.outcome(), Some(Err(McpChangeFailure::Unavailable)));
}

fn codex_add(launch: AgentMcpServerLaunch) -> McpChangeExchange {
    exchange(
        CODEX,
        &add("docs-1", AgentMcpServerConfigScope::User, launch),
    )
}

fn config_with(servers: Value) -> Value {
    json!({ "config": { "model": null, "mcp_servers": servers }, "origins": {} })
}

#[test]
fn codex_add_reads_the_config_then_writes_the_server_without_starting_oauth() {
    let mut session = codex_add(http("https://docs.example/mcp"));
    assert_eq!(session.step(), McpProbeStep::Wait);
    session.observe(
        b"{\"method\":\"remoteControl/status/changed\",\"params\":{\"status\":\"disabled\"}}\n",
    );
    session.observe(&codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        config_with(json!({})),
    ));
    assert_eq!(session.step(), McpProbeStep::Wait);
    session.observe(&codex_result(
        CODEX_HANDSHAKE_REPLY_ID,
        json!({ "userAgent": "x" }),
    ));
    assert_eq!(
        written(session.step()),
        json!({
            "method": "config/read",
            "id": CODEX_MCP_CONFIG_REQUEST_ID,
            "params": { "cwd": ROOT, "includeLayers": false },
        })
    );
    assert_eq!(session.step(), McpProbeStep::Wait);
    session.observe(&codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        config_with(json!({ "docs": { "url": "https://other.example" }, "docs-1": null })),
    ));
    assert_eq!(
        written(session.step()),
        json!({
            "method": "config/batchWrite",
            "id": CODEX_MCP_CONFIG_WRITE_REQUEST_ID,
            "params": {
                "edits": [{
                    "keyPath": "mcp_servers.docs-1",
                    "mergeStrategy": "replace",
                    "value": { "url": "https://docs.example/mcp" },
                }],
            },
        })
    );
    assert_eq!(session.outcome(), None);
    session.observe(&codex_result(
        CODEX_MCP_CONFIG_WRITE_REQUEST_ID,
        json!({ "status": "ok", "version": "sha256:0", "filePath": "/home/u/.codex/config.toml" }),
    ));
    assert_eq!(session.outcome(), Some(Ok(())));
    assert_eq!(session.step(), McpProbeStep::Done);
}

#[test]
fn codex_add_writes_a_stdio_server_as_command_and_argument_values() {
    let mut session = codex_add(stdio("--version", &["--a b", "-c", "x=\"y\""]));
    session.observe(&codex_result(CODEX_HANDSHAKE_REPLY_ID, json!({})));
    assert!(matches!(session.step(), McpProbeStep::Write(_)));
    session.observe(&codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        json!({ "config": { "mcp_servers": null } }),
    ));
    let request = written(session.step());
    assert_eq!(
        request["params"]["edits"][0]["value"],
        json!({ "command": "--version", "args": ["--a b", "-c", "x=\"y\""] })
    );
    let mut absent_table = codex_add(http("https://docs.example/mcp"));
    absent_table.observe(&codex_result(CODEX_HANDSHAKE_REPLY_ID, json!({})));
    assert!(matches!(absent_table.step(), McpProbeStep::Write(_)));
    absent_table.observe(&codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        json!({ "config": { "model": "x" } }),
    ));
    assert!(matches!(absent_table.step(), McpProbeStep::Write(_)));
}

#[test]
fn codex_add_refuses_a_configured_name_and_fails_closed_on_unreadable_config() {
    let read = |reply: Vec<u8>| {
        let mut session = codex_add(http("https://docs.example/mcp"));
        session.observe(&codex_result(CODEX_HANDSHAKE_REPLY_ID, json!({})));
        assert!(matches!(session.step(), McpProbeStep::Write(_)));
        session.observe(&reply);
        session
    };
    let mut existing = read(codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        config_with(json!({ "docs-1": { "command": "npx", "enabled": false } })),
    ));
    assert_eq!(
        existing.outcome(),
        Some(Err(McpChangeFailure::ServerExists))
    );
    assert_eq!(existing.step(), McpProbeStep::Done);
    for reply in [
        codex_error(CODEX_MCP_CONFIG_REQUEST_ID, "unknown variant `config/read`"),
        codex_result(CODEX_MCP_CONFIG_REQUEST_ID, json!({})),
        codex_result(CODEX_MCP_CONFIG_REQUEST_ID, json!({ "config": [] })),
        codex_result(CODEX_MCP_CONFIG_REQUEST_ID, json!(null)),
    ] {
        let mut unreadable = read(reply);
        assert_eq!(
            unreadable.outcome(),
            Some(Err(McpChangeFailure::Unavailable))
        );
        assert_eq!(unreadable.step(), McpProbeStep::Done);
    }
    let mut refused_write = read(codex_result(
        CODEX_MCP_CONFIG_REQUEST_ID,
        config_with(json!({})),
    ));
    assert!(matches!(refused_write.step(), McpProbeStep::Write(_)));
    refused_write.observe(&codex_error(
        CODEX_MCP_CONFIG_WRITE_REQUEST_ID,
        "read-only config",
    ));
    assert_eq!(
        refused_write.outcome(),
        Some(Err(McpChangeFailure::Unavailable))
    );
    let mut refused_handshake = codex_add(http("https://docs.example/mcp"));
    refused_handshake.observe(&codex_error(CODEX_HANDSHAKE_REPLY_ID, "unsupported client"));
    assert_eq!(
        refused_handshake.outcome(),
        Some(Err(McpChangeFailure::Unavailable))
    );
    let mut flooded = codex_add(http("https://docs.example/mcp"));
    flooded.observe(&vec![b'x'; MAX_CODEX_MCP_STATUS_LINE_BYTES + 1]);
    assert_eq!(flooded.outcome(), Some(Err(McpChangeFailure::Unavailable)));
}
