use super::*;
use serde_json::json;

const ROOT: &str = "/Users/dev/work";

fn hints(values: &[DeviceMcpHint]) -> BTreeSet<DeviceMcpHint> {
    values.iter().copied().collect()
}

fn config(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap()
}

fn selected(value: Value, kind: ProjectKind) -> DeviceMcpSelection {
    select(&config(value), ROOT, kind).expect("selection")
}

fn entry<'a>(selection: &'a DeviceMcpSelection, name: &str) -> &'a DeviceMcpEntry {
    selection
        .entries
        .iter()
        .find(|entry| entry.name == name)
        .unwrap_or_else(|| panic!("{name}"))
}

fn launch(entry: &DeviceMcpEntry) -> &DeviceMcpLaunch {
    match &entry.disposition {
        Disposition::Transfer(launch) => launch,
        other => panic!("{} {other:?}", entry.name),
    }
}

#[test]
fn stdio_entries_transfer_command_args_and_env() {
    let selection = selected(
        json!({ "mcpServers": {
            "files": { "type": "stdio", "command": "npx", "args": ["-y", "server"], "env": { "API_KEY": "s3cr3t" } },
            "bare": { "command": "uvx" },
        } }),
        ProjectKind::Git,
    );
    let files = entry(&selection, "files");
    assert_eq!(files.transport, DeviceMcpTransport::Stdio);
    assert!(files.hints.is_empty());
    assert!(
        *launch(files)
            == DeviceMcpLaunch::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "server".into()],
                env: BTreeMap::from([("API_KEY".into(), "s3cr3t".into())]),
            }
    );
    let bare = entry(&selection, "bare");
    assert!(
        *launch(bare)
            == DeviceMcpLaunch::Stdio {
                command: "uvx".into(),
                args: vec![],
                env: BTreeMap::new(),
            }
    );
    assert_eq!(selection.transferable().count(), 2);
    assert_eq!(selection.retained().count(), 0);
    assert_eq!(selection.omitted, 0);
}

#[test]
fn http_and_sse_entries_transfer_url_and_headers_with_sign_in_hints() {
    let selection = selected(
        json!({ "mcpServers": {
            "linear": { "type": "http", "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer tok" } },
            "docs": { "type": "http", "url": "https://docs.example/mcp" },
            "events": { "type": "sse", "url": "https://events.example/sse", "headers": {} },
            "sentry": { "type": "http", "url": "https://mcp.sentry.dev/mcp", "oauth": { "clientId": "abc" } },
        } }),
        ProjectKind::Git,
    );
    let linear = entry(&selection, "linear");
    assert_eq!(linear.transport, DeviceMcpTransport::Http);
    assert!(linear.hints.is_empty());
    assert!(
        *launch(linear)
            == DeviceMcpLaunch::Http {
                url: "https://mcp.linear.app/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), "Bearer tok".into())]),
            }
    );
    assert_eq!(
        entry(&selection, "docs").hints,
        hints(&[DeviceMcpHint::MayNeedSignIn])
    );
    let events = entry(&selection, "events");
    assert_eq!(events.transport, DeviceMcpTransport::Sse);
    assert!(matches!(launch(events), DeviceMcpLaunch::Sse { .. }));
    assert_eq!(
        entry(&selection, "sentry").hints,
        hints(&[DeviceMcpHint::MayNeedSignIn, DeviceMcpHint::OauthClient])
    );
}

#[test]
fn unsupported_transports_and_headers_helper_are_skipped_and_retained() {
    let selection = selected(
        json!({ "mcpServers": {
            "socket": { "type": "ws", "url": "wss://x.example/ws" },
            "sdk": { "type": "sdk", "name": "in-process" },
            "proxy": { "type": "claudeai-proxy", "url": "https://claude.ai/x", "id": "1" },
            "future": { "type": "quantum" },
            "helper": { "type": "http", "url": "https://h.example/mcp", "headersHelper": "/Users/dev/bin/token" },
        } }),
        ProjectKind::Git,
    );
    for name in ["socket", "sdk", "proxy", "future"] {
        let skipped = entry(&selection, name);
        assert_eq!(skipped.transport, DeviceMcpTransport::Unknown, "{name}");
        assert_eq!(
            skipped.disposition,
            Disposition::Skip(SkipReason::UnsupportedTransport)
        );
        assert_eq!(skipped.hints, hints(&[DeviceMcpHint::UnsupportedTransport]));
    }
    let helper = entry(&selection, "helper");
    assert_eq!(helper.transport, DeviceMcpTransport::Http);
    assert_eq!(helper.hints, hints(&[DeviceMcpHint::HeadersHelper]));
    assert_eq!(selection.transferable().count(), 0);
    assert_eq!(
        selection.retained().collect::<Vec<_>>(),
        ["future", "helper", "proxy", "sdk", "socket"]
    );
}

#[test]
fn malformed_entries_with_valid_names_are_invalid_config() {
    let long = "a".repeat(1025);
    let selection = selected(
        json!({ "mcpServers": {
            "a1": "npx",
            "a2": { "type": 3, "command": "npx" },
            "a3": { "type": "stdio" },
            "a4": { "command": "" },
            "a5": { "command": "npx", "args": "-y" },
            "a6": { "command": "npx", "args": [1] },
            "a7": { "command": "npx", "cwd": "/tmp" },
            "a8": { "command": "npx", "env": { "1BAD": "x" } },
            "a9": { "command": "npx", "env": { "OK": "a\u{0}b" } },
            "b1": { "command": "npx", "env": { "OK": 1 } },
            "b2": { "type": "http", "url": "ftp://x.example" },
            "b3": { "type": "http", "url": "https://user:pw@x.example/mcp" },
            "b4": { "type": "http", "url": "https://x.example/mcp", "headers": { "Bad Name": "v" } },
            "b5": { "type": "http", "url": "https://x.example/mcp", "headers": { "X": "a\r\nb" } },
            "b6": { "type": "sse", "url": "https://x.example/sse", "command": "npx" },
            "b7": { "type": "http" },
            "b8": { "command": long },
            "b9": { "command": "npx", "args": vec!["a"; 33] },
            "c1": { "command": "npx\n" },
            "c2": { "type": "http", "url": "https://x.example/mcp", "headers": { "X": "v".repeat(8193) } },
            "c3": { "command": "npx", "env": { "OK": "v".repeat(8193) } },
            "c4": { "type": "http", "url": "https://x.example/mcp", "headers": { "h".repeat(129): "v" } },
        } }),
        ProjectKind::Git,
    );
    assert_eq!(selection.entries.len(), 22);
    for skipped in &selection.entries {
        assert_eq!(
            skipped.disposition,
            Disposition::Skip(SkipReason::InvalidConfig),
            "{}",
            skipped.name
        );
        assert_eq!(skipped.hints, hints(&[DeviceMcpHint::InvalidConfig]));
    }
    assert_eq!(selection.retained().count(), 22);
}

#[test]
fn env_and_header_limits_are_inclusive_at_the_contract_bound() {
    let env: Map<String, Value> = (0..MAX_ENV_ENTRIES)
        .map(|index| (format!("K{index}"), json!("v")))
        .collect();
    let mut over_env = env.clone();
    over_env.insert("EXTRA".into(), json!("v"));
    let headers: Map<String, Value> = (0..MAX_HEADERS)
        .map(|index| (format!("X-{index}"), json!("v")))
        .collect();
    let mut over_headers = headers.clone();
    over_headers.insert("X-Extra".into(), json!("v"));
    let key = format!("_{}", "a".repeat(MAX_ENV_KEY_BYTES - 1));
    let selection = selected(
        json!({ "mcpServers": {
            "env": { "command": "npx", "env": env },
            "overenv": { "command": "npx", "env": over_env },
            "headers": { "type": "http", "url": "https://x.example/mcp", "headers": headers },
            "overheaders": { "type": "http", "url": "https://x.example/mcp", "headers": over_headers },
            "longkey": { "command": "npx", "env": { key: "v" } },
            "token": { "type": "http", "url": "https://x.example/mcp", "headers": { "!#$%&'*+-.^_`|~0aZ": "v" } },
            "envvalue": { "command": "npx", "env": { "K": "v".repeat(MAX_VALUE_BYTES) } },
            "overvalue": { "command": "npx", "env": { "K": "v".repeat(MAX_VALUE_BYTES + 1) } },
            "headervalue": { "type": "http", "url": "https://x.example/mcp", "headers": { "X": "v".repeat(MAX_VALUE_BYTES) } },
        } }),
        ProjectKind::Git,
    );
    for name in [
        "env",
        "headers",
        "longkey",
        "token",
        "envvalue",
        "headervalue",
    ] {
        assert!(
            matches!(
                entry(&selection, name).disposition,
                Disposition::Transfer(_)
            ),
            "{name}"
        );
    }
    for name in ["overenv", "overheaders", "overvalue"] {
        assert_eq!(
            entry(&selection, name).disposition,
            Disposition::Skip(SkipReason::InvalidConfig),
            "{name}"
        );
    }
}

#[test]
fn expansion_and_mac_path_hints_cover_command_args_env_url_and_headers() {
    let selection = selected(
        json!({ "mcpServers": {
            "local": { "command": "/Users/dev/bin/server", "args": ["--port", "1"] },
            "argpath": { "command": "node", "args": ["/Users/dev/server.js"] },
            "envexp": { "command": "node", "env": { "TOKEN": "${TOKEN}" } },
            "argexp": { "command": "node", "args": ["${HOME}/x"] },
            "urlexp": { "type": "http", "url": "https://x.example/${PATH_PART}", "headers": { "Authorization": "Bearer x" } },
            "hdrexp": { "type": "sse", "url": "https://x.example/sse", "headers": { "Authorization": "Bearer ${TOKEN}" } },
            "envpath": { "command": "node", "env": { "DIR": "/Users/dev" } },
        } }),
        ProjectKind::Git,
    );
    assert_eq!(
        entry(&selection, "local").hints,
        hints(&[DeviceMcpHint::MacPath])
    );
    assert_eq!(
        entry(&selection, "argpath").hints,
        hints(&[DeviceMcpHint::MacPath])
    );
    for name in ["envexp", "argexp", "urlexp", "hdrexp"] {
        assert_eq!(
            entry(&selection, name).hints,
            hints(&[DeviceMcpHint::EnvExpansion]),
            "{name}"
        );
    }
    assert!(entry(&selection, "envpath").hints.is_empty());
}

#[test]
fn invalid_names_are_skipped_and_undisplayable_names_are_counted() {
    let selection = selected(
        json!({ "mcpServers": {
            "-dash": { "command": "npx" },
            "has space": { "command": "npx" },
            "dotted.name": { "type": "http", "url": "https://x.example/mcp" },
            "x".repeat(65): { "command": "npx" },
            "bad\nname": { "command": "npx" },
            "rtl\u{202e}": { "command": "npx" },
            "y".repeat(129): { "command": "npx" },
            "ok_name-1": { "command": "npx" },
        } }),
        ProjectKind::Git,
    );
    assert_eq!(selection.omitted, 3);
    let names: Vec<&str> = selection
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    assert_eq!(names.len(), 5);
    for name in ["-dash", "has space", "dotted.name", &"x".repeat(65)] {
        let skipped = entry(&selection, name);
        assert_eq!(
            skipped.disposition,
            Disposition::Skip(SkipReason::InvalidName)
        );
        assert_eq!(skipped.hints, hints(&[DeviceMcpHint::InvalidName]));
    }
    assert_eq!(
        entry(&selection, "dotted.name").transport,
        DeviceMcpTransport::Http
    );
    assert!(selection.retained().next().is_none());
    assert_eq!(
        selection
            .transferable()
            .map(|(name, _)| name)
            .collect::<Vec<_>>(),
        ["ok_name-1"]
    );
}

#[test]
fn git_projects_use_user_scope_and_the_exact_root_only() {
    let value = json!({
        "mcpServers": { "shared": { "command": "user" }, "user_only": { "command": "u" } },
        "projects": {
            ROOT: { "mcpServers": { "shared": { "command": "root" } }, "history": [] },
            "/Users/dev/work/app": { "mcpServers": { "nested": { "command": "n" } } },
            "/Users/dev/workshop": { "mcpServers": { "sibling": { "command": "s" } } },
            "/Users/dev": { "mcpServers": { "parent": { "command": "p" } } },
        },
    });
    let selection = selected(value, ProjectKind::Git);
    let names: Vec<&str> = selection.transferable().map(|(name, _)| name).collect();
    assert_eq!(names, ["shared", "user_only"]);
    assert!(matches!(
        launch(entry(&selection, "shared")),
        DeviceMcpLaunch::Stdio { command, .. } if command == "root"
    ));
}

#[test]
fn folder_projects_add_descendants_with_root_over_descendants_over_user() {
    let value = json!({
        "mcpServers": { "a": { "command": "user" }, "b": { "command": "user" }, "c": { "command": "user" } },
        "projects": {
            ROOT: { "mcpServers": { "a": { "command": "root" } } },
            "/Users/dev/work/app": { "mcpServers": { "a": { "command": "app" }, "b": { "command": "app" }, "d": { "command": "same" } } },
            "/Users/dev/work/lib/": { "mcpServers": { "d": { "type": "stdio", "command": "same" } } },
            "/Users/dev/work/svc": { "mcpServers": { "e": { "command": "one" } } },
            "/Users/dev/work/svc/deep": { "mcpServers": { "e": { "command": "two" }, "f": { "type": "ws", "url": "wss://x" } } },
            "/Users/dev/work/other": { "mcpServers": { "f": { "type": "ws", "url": "wss://y" } } },
            "/Users/dev/workshop": { "mcpServers": { "g": { "command": "sibling" } } },
            "/Users/dev/work/../escape": { "mcpServers": { "h": { "command": "escape" } } },
            "/Users/dev/work/./dot": { "mcpServers": { "i": { "command": "dot" } } },
            "/Users/dev/work//double": { "mcpServers": { "j": { "command": "double" } } },
        },
    });
    let selection = selected(value, ProjectKind::Folder);
    let command = |name: &str| match launch(entry(&selection, name)) {
        DeviceMcpLaunch::Stdio { command, .. } => command.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(command("a"), "root");
    assert_eq!(command("b"), "app");
    assert_eq!(command("c"), "user");
    assert_eq!(command("d"), "same");
    let conflicted = entry(&selection, "e");
    assert_eq!(conflicted.disposition, Disposition::Conflict);
    assert!(conflicted.hints.is_empty());
    assert_eq!(entry(&selection, "f").disposition, Disposition::Conflict);
    let names: Vec<&str> = selection
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    assert_eq!(names, ["a", "b", "c", "d", "e", "f"]);
    assert_eq!(selection.retained().collect::<Vec<_>>(), ["e", "f"]);
}

#[test]
fn a_descendant_conflict_shadows_the_user_scope_but_not_the_root() {
    let value = json!({
        "mcpServers": { "x": { "command": "user" }, "y": { "command": "user" } },
        "projects": {
            ROOT: { "mcpServers": { "y": { "command": "root" } } },
            "/Users/dev/work/a": { "mcpServers": { "x": { "command": "a" }, "y": { "command": "a" } } },
            "/Users/dev/work/b": { "mcpServers": { "x": { "command": "b" }, "y": { "command": "b" } } },
        },
    });
    let selection = selected(value, ProjectKind::Folder);
    assert_eq!(entry(&selection, "x").disposition, Disposition::Conflict);
    assert!(matches!(
        launch(entry(&selection, "y")),
        DeviceMcpLaunch::Stdio { command, .. } if command == "root"
    ));
}

#[test]
fn the_filesystem_root_folder_treats_every_other_key_as_a_descendant() {
    assert!(is_strict_descendant("/a", "/"));
    assert!(!is_strict_descendant("/", "/"));
    assert!(is_strict_descendant("/r/a/b", "/r"));
    assert!(is_strict_descendant("/r/a/", "/r"));
    for key in [
        "/r", "/r/", "/rx", "/r//a", "/r/./a", "/r/../a", "/r/a/..", "r/a",
    ] {
        assert!(!is_strict_descendant(key, "/r"), "{key}");
    }
}

#[test]
fn descendant_project_count_is_bounded_before_entries_are_classified() {
    let mut projects = Map::new();
    for index in 0..=MAX_DESCENDANT_PROJECTS {
        projects.insert(
            format!("{ROOT}/p{index:03}"),
            json!({ "mcpServers": { format!("s{index}"): { "command": "x" } } }),
        );
    }
    let value = json!({ "projects": projects.clone() });
    assert_eq!(
        select(&config(value.clone()), ROOT, ProjectKind::Folder),
        Err(DeviceConfigError::TooManyServers)
    );
    assert!(select(&config(value), ROOT, ProjectKind::Git).is_ok());
    projects.remove(&format!("{ROOT}/p000"));
    for index in 0..10 {
        projects.insert(format!("{ROOT}/empty{index}"), json!({ "mcpServers": {} }));
        projects.insert(format!("{ROOT}/none{index}"), json!({ "history": [] }));
    }
    let bounded = select(
        &config(json!({ "projects": projects })),
        ROOT,
        ProjectKind::Folder,
    )
    .expect("sixty-four descendants");
    assert_eq!(bounded.transferable().count(), MAX_SYNCED_SERVERS);
    assert_eq!(bounded.entries.len(), MAX_DESCENDANT_PROJECTS);
}

#[test]
fn transferable_overflow_is_skipped_over_limit_and_retained() {
    let servers: Map<String, Value> = (0..40)
        .map(|index| (format!("s{index:02}"), json!({ "command": "x" })))
        .collect();
    let selection = selected(json!({ "mcpServers": servers }), ProjectKind::Git);
    assert_eq!(selection.transferable().count(), MAX_SYNCED_SERVERS);
    let retained: Vec<&str> = selection.retained().collect();
    assert_eq!(retained.len(), 8);
    assert_eq!(retained[0], "s32");
    let overflow = entry(&selection, "s39");
    assert_eq!(
        overflow.disposition,
        Disposition::Skip(SkipReason::OverLimit)
    );
    assert_eq!(overflow.hints, hints(&[DeviceMcpHint::OverLimit]));
}

#[test]
fn source_candidate_and_retain_limits_refuse_the_whole_sync() {
    let many = |count: usize, entry: Value| -> Map<String, Value> {
        (0..count)
            .map(|index| (format!("s{index:03}"), entry.clone()))
            .collect()
    };
    let ws = json!({ "type": "ws", "url": "wss://x" });
    for value in [
        json!({ "mcpServers": many(MAX_SOURCE_ENTRIES + 1, json!({ "command": "x" })) }),
        json!({ "mcpServers": many(MAX_CANDIDATES + 1, json!({ "command": "x" })) }),
        json!({ "mcpServers": many(MAX_RETAINED_NAMES + 1, ws.clone()) }),
        json!({ "mcpServers": many(MAX_SYNCED_SERVERS + MAX_RETAINED_NAMES + 1, json!({ "command": "x" })) }),
        json!({ "projects": { ROOT: { "mcpServers": many(MAX_SOURCE_ENTRIES + 1, ws.clone()) } } }),
    ] {
        assert_eq!(
            select(&config(value), ROOT, ProjectKind::Folder),
            Err(DeviceConfigError::TooManyServers)
        );
    }
    assert!(select(
        &config(json!({ "mcpServers": many(MAX_RETAINED_NAMES, ws) })),
        ROOT,
        ProjectKind::Git
    )
    .is_ok());
    let overflow = many(
        MAX_SYNCED_SERVERS + MAX_RETAINED_NAMES,
        json!({ "command": "x" }),
    );
    assert!(select(
        &config(json!({ "mcpServers": overflow })),
        ROOT,
        ProjectKind::Git
    )
    .is_ok());
}

#[test]
fn the_foreign_file_tolerates_unknown_top_level_fields_but_not_broken_shapes() {
    let selection = selected(
        json!({
            "numStartups": 12,
            "oauthAccount": { "emailAddress": "x@example.com" },
            "mcpServers": null,
            "projects": { ROOT: { "allowedTools": [], "mcpServers": null } },
        }),
        ProjectKind::Folder,
    );
    assert!(selection.entries.is_empty());
    assert!(selected(json!({}), ProjectKind::Git).entries.is_empty());
    for broken in [
        b"not json".to_vec(),
        b"[]".to_vec(),
        config(json!({ "mcpServers": [] })),
        config(json!({ "mcpServers": "x" })),
        config(json!({ "projects": [] })),
        config(json!({ "projects": { ROOT: "x" } })),
        config(json!({ "projects": { ROOT: { "mcpServers": 1 } } })),
    ] {
        assert_eq!(
            select(&broken, ROOT, ProjectKind::Folder),
            Err(DeviceConfigError::Invalid)
        );
    }
}

#[test]
fn an_oversize_configuration_is_refused_before_parsing() {
    let oversize = vec![b' '; MAX_DEVICE_CONFIG_BYTES + 1];
    assert_eq!(
        select(&oversize, ROOT, ProjectKind::Git),
        Err(DeviceConfigError::TooLarge)
    );
    let mut padded = b"{}".to_vec();
    padded.resize(MAX_DEVICE_CONFIG_BYTES, b' ');
    assert!(select(&padded, ROOT, ProjectKind::Git).is_ok());
}

#[test]
fn debug_output_and_error_messages_never_carry_configuration_values() {
    let selection = selected(
        json!({ "mcpServers": {
            "s": { "command": "npx", "args": ["--token=arg-secret-1"], "env": { "K": "env-secret-2" } },
            "h": { "type": "http", "url": "https://x.example/mcp?key=url-secret-3", "headers": { "Authorization": "Bearer header-secret-4" } },
        } }),
        ProjectKind::Git,
    );
    let debug = format!("{selection:?}");
    for secret in [
        "arg-secret-1",
        "env-secret-2",
        "url-secret-3",
        "header-secret-4",
        "npx",
    ] {
        assert!(!debug.contains(secret), "{secret}");
    }
    for error in [
        DeviceConfigError::TooLarge,
        DeviceConfigError::Invalid,
        DeviceConfigError::TooManyServers,
    ] {
        assert!(error.message().len() < 128);
    }
}

#[test]
fn project_kind_is_a_closed_camel_case_enum() {
    assert_eq!(
        serde_json::from_value::<ProjectKind>(json!("folder")).unwrap(),
        ProjectKind::Folder
    );
    assert_eq!(
        serde_json::from_value::<ProjectKind>(json!("git")).unwrap(),
        ProjectKind::Git
    );
    for invalid in ["Folder", "GIT", "repository", ""] {
        assert!(serde_json::from_value::<ProjectKind>(json!(invalid)).is_err());
    }
    assert_eq!(
        serde_json::to_value(DeviceMcpTransport::Unknown).unwrap(),
        json!("unknown")
    );
    assert_eq!(
        serde_json::to_value([
            DeviceMcpHint::MayNeedSignIn,
            DeviceMcpHint::EnvExpansion,
            DeviceMcpHint::MacPath,
            DeviceMcpHint::UnsupportedTransport,
            DeviceMcpHint::HeadersHelper,
            DeviceMcpHint::OauthClient,
            DeviceMcpHint::InvalidName,
            DeviceMcpHint::InvalidConfig,
            DeviceMcpHint::OverLimit,
        ])
        .unwrap(),
        json!([
            "mayNeedSignIn",
            "envExpansion",
            "macPath",
            "unsupportedTransport",
            "headersHelper",
            "oauthClient",
            "invalidName",
            "invalidConfig",
            "overLimit"
        ])
    );
}

#[test]
fn descendants_with_the_same_launch_are_not_a_conflict_and_union_their_hints() {
    let value = json!({ "projects": {
        "/Users/dev/work/a": { "mcpServers": { "docs": { "type": "http", "url": "https://d.example/mcp", "headers": { "Authorization": "Bearer x" } } } },
        "/Users/dev/work/b": { "mcpServers": { "docs": { "type": "http", "url": "https://d.example/mcp", "headers": { "Authorization": "Bearer x" }, "oauth": { "clientId": "c" } } } },
        "/Users/dev/work/c": { "mcpServers": { "docs": { "type": "http", "url": "https://d.example/mcp", "headers": { "Authorization": "Bearer y" } } } },
        "/Users/dev/work/d": { "mcpServers": { "tool": { "command": "npx" }, "ws": { "type": "ws", "url": "wss://a" } } },
        "/Users/dev/work/e": { "mcpServers": { "tool": { "type": "stdio", "command": "npx", "args": [], "env": {} }, "ws": { "type": "ws", "url": "wss://a" } } },
    } });
    let selection = selected(value, ProjectKind::Folder);
    assert_eq!(entry(&selection, "docs").disposition, Disposition::Conflict);
    let tool = entry(&selection, "tool");
    assert!(matches!(tool.disposition, Disposition::Transfer(_)));
    assert_eq!(
        entry(&selection, "ws").disposition,
        Disposition::Skip(SkipReason::UnsupportedTransport)
    );
    let merged = selected(
        json!({ "projects": {
            "/Users/dev/work/a": { "mcpServers": { "docs": { "type": "http", "url": "https://d.example/mcp", "headers": { "Authorization": "Bearer x" } } } },
            "/Users/dev/work/b": { "mcpServers": { "docs": { "type": "http", "url": "https://d.example/mcp", "headers": { "Authorization": "Bearer x" }, "oauth": { "clientId": "c" } } } },
        } }),
        ProjectKind::Folder,
    );
    let docs = entry(&merged, "docs");
    assert!(matches!(docs.disposition, Disposition::Transfer(_)));
    assert_eq!(
        docs.hints,
        hints(&[DeviceMcpHint::MayNeedSignIn, DeviceMcpHint::OauthClient])
    );
}

#[test]
fn displayable_names_match_the_script_trim_rule_of_the_report_parser() {
    let mut servers = Map::new();
    for name in [
        "\u{feff}lead",
        "trail\u{feff}",
        "\u{a0}nbsp",
        "nbsp\u{a0}",
        "\u{2028}line",
        "line\u{2029}",
        "\u{3000}ideo",
        " space",
        "tab\t",
        "mid\u{feff}dle",
        "mid\u{a0}dle",
        "mid\u{2028}dle",
    ] {
        servers.insert(name.to_owned(), json!({ "command": "npx" }));
    }
    let selection = selected(json!({ "mcpServers": servers }), ProjectKind::Git);
    assert_eq!(selection.omitted, 9);
    let shown: Vec<&str> = selection
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    assert_eq!(shown, ["mid\u{a0}dle", "mid\u{2028}dle", "mid\u{feff}dle"]);
    for name in shown {
        assert_eq!(
            name.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'),
            name
        );
        assert!(is_displayable_name(name));
    }
    for name in [
        "\u{feff}x",
        "x\u{feff}",
        "\u{a0}x",
        "x\u{2028}",
        "",
        "a\u{0}",
    ] {
        assert!(!is_displayable_name(name), "{name:?}");
    }
}

#[test]
fn oversize_arrays_and_maps_are_refused_before_their_items_are_copied() {
    let selection = selected(
        json!({ "mcpServers": {
            "args": { "command": "npx", "args": vec!["a"; 100_000] },
            "longarg": { "command": "npx", "args": ["a".repeat(1025)] },
            "env": { "command": "npx", "env": (0..10_000).map(|index| (format!("K{index}"), json!("v"))).collect::<Map<String, Value>>() },
            "headers": { "type": "http", "url": "https://x.example/mcp", "headers": (0..10_000).map(|index| (format!("X{index}"), json!("v"))).collect::<Map<String, Value>>() },
            "longcommand": { "command": "c".repeat(1025) },
        } }),
        ProjectKind::Git,
    );
    for skipped in &selection.entries {
        assert_eq!(
            skipped.disposition,
            Disposition::Skip(SkipReason::InvalidConfig),
            "{}",
            skipped.name
        );
    }
    assert_eq!(selection.entries.len(), 5);
}

#[test]
fn the_add_json_argument_is_bounded_by_its_compact_encoded_size() {
    let base = |filler: &str| json!({ "type": "stdio", "command": "npx", "args": [], "env": { "A": "v".repeat(8192), "B": "v".repeat(8192), "C": "v".repeat(8192), "D": filler } });
    let encoded = |filler: &str| serde_json::to_vec(&base(filler)).unwrap().len();
    let fitting = "f".repeat(MAX_ADD_JSON_BYTES - encoded(""));
    assert_eq!(encoded(&fitting), MAX_ADD_JSON_BYTES);
    let over = format!("{fitting}f");
    let escaped = format!("{}\n", &fitting[..fitting.len() - 1]);
    assert_eq!(escaped.len(), fitting.len());
    assert_eq!(encoded(&escaped), MAX_ADD_JSON_BYTES + 1);
    let quoted = format!("{}\"", &fitting[..fitting.len() - 2]);
    assert_eq!(encoded(&quoted), MAX_ADD_JSON_BYTES);
    let selection = selected(
        json!({ "mcpServers": {
            "exact": base(&fitting),
            "over": base(&over),
            "escaped": base(&escaped),
            "quoted": base(&quoted),
        } }),
        ProjectKind::Git,
    );
    for name in ["exact", "quoted"] {
        let accepted = entry(&selection, name);
        assert_eq!(
            add_json_bytes(launch(accepted)),
            Some(MAX_ADD_JSON_BYTES),
            "{name}"
        );
    }
    for name in ["over", "escaped"] {
        let skipped = entry(&selection, name);
        assert_eq!(
            skipped.disposition,
            Disposition::Skip(SkipReason::InvalidConfig),
            "{name}"
        );
        assert_eq!(skipped.hints, hints(&[DeviceMcpHint::InvalidConfig]));
    }
    assert_eq!(
        selection.retained().collect::<Vec<_>>(),
        ["escaped", "over"]
    );
    let header = |value: String| json!({ "type": "http", "url": "https://x.example/mcp", "headers": (0..4).map(|index| (format!("H{index}"), json!(if index == 0 { value.clone() } else { "v".repeat(8192) }))).collect::<Map<String, Value>>() });
    let remote_encoded = |value: &str| serde_json::to_vec(&header(value.to_owned())).unwrap().len();
    let remote_fit = "r".repeat(MAX_ADD_JSON_BYTES - remote_encoded(""));
    let remote = selected(
        json!({ "mcpServers": {
            "fit": header(remote_fit.clone()),
            "big": header(format!("{remote_fit}r")),
        } }),
        ProjectKind::Git,
    );
    assert!(matches!(
        entry(&remote, "fit").disposition,
        Disposition::Transfer(_)
    ));
    assert_eq!(
        entry(&remote, "big").disposition,
        Disposition::Skip(SkipReason::InvalidConfig)
    );
}
