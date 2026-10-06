use super::*;
use serde_json::{json, Value};

const CONTRACT: &[u8] = include_bytes!("../../contracts/agent-command-catalog-wire.json");
const ROOT: &str = "/Users/dev/project";

fn contract() -> Value {
    serde_json::from_slice(CONTRACT).unwrap()
}

fn contract_cases(key: &str) -> Vec<(String, Value)> {
    contract()[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            (
                case["name"].as_str().unwrap().to_string(),
                case["value"].clone(),
            )
        })
        .collect()
}

fn claude_stdout(commands: Value) -> Vec<u8> {
    let response = json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": CLAUDE_CONTROL_REQUEST_ID,
            "response": {
                "commands": commands,
                "models": [{"value": "model-a"}],
                "account": {"email": "person@example.test"},
            },
        },
    });
    let mut stdout = serde_json::to_vec(&response).unwrap();
    stdout.push(b'\n');
    stdout
}

fn codex_stdout(data: Value) -> Vec<u8> {
    let mut stdout = b"{\"method\":\"account/updated\",\"params\":{}}\nnot json\n".to_vec();
    stdout.extend(serde_json::to_vec(&json!({"id": 3, "result": {"data": data}})).unwrap());
    stdout.push(b'\n');
    stdout
}

fn codex_listing(cwd: &str, skills: Value) -> Value {
    json!([{"cwd": cwd, "skills": skills, "errors": []}])
}

fn names(catalog: &AgentCommandCatalog) -> Vec<&str> {
    catalog
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect()
}

#[test]
fn contract_limits_match_the_domain_constants() {
    let limits = &contract()["limits"];
    assert_eq!(limits["maxEntries"], json!(MAX_CATALOG_ENTRIES));
    assert_eq!(limits["maxNameBytes"], json!(MAX_NAME_BYTES));
    assert_eq!(limits["maxLabelBytes"], json!(MAX_LABEL_BYTES));
    assert_eq!(limits["maxDescriptionBytes"], json!(MAX_DESCRIPTION_BYTES));
    assert_eq!(
        limits["maxArgumentHintBytes"],
        json!(MAX_ARGUMENT_HINT_BYTES)
    );
    assert_eq!(
        limits["maxRepositoryRootBytes"],
        json!(MAX_REPOSITORY_ROOT_BYTES)
    );
    assert_eq!(contract()["ipcCommand"], "get_agent_command_catalog");
}

#[test]
fn contract_catalog_fixtures_round_trip_through_the_wire_types() {
    for (name, value) in contract_cases("catalogs") {
        let catalog = parse_catalog(&serde_json::to_vec(&value).unwrap()).expect(&name);
        assert_eq!(serde_json::to_value(&catalog).unwrap(), value, "{name}");
    }
}

#[test]
fn foreign_catalogs_are_accepted_only_for_the_requested_provider() {
    for (name, value) in contract_cases("catalogs") {
        let provider = match value["provider"].as_str().unwrap() {
            "claudeCode" => AgentCliInvocation::ClaudeCode,
            _ => AgentCliInvocation::CodexExec,
        };
        let other = match provider {
            AgentCliInvocation::ClaudeCode => AgentCliInvocation::CodexExec,
            AgentCliInvocation::CodexExec => AgentCliInvocation::ClaudeCode,
        };
        let catalog = parse_foreign_catalog(value.clone(), provider).expect(&name);
        assert_eq!(serde_json::to_value(&catalog).unwrap(), value, "{name}");
        assert!(parse_foreign_catalog(value, other).is_err(), "{name}");
    }
    for (name, value) in contract_cases("rejectedCatalogs") {
        for provider in [
            AgentCliInvocation::ClaudeCode,
            AgentCliInvocation::CodexExec,
        ] {
            assert!(
                parse_foreign_catalog(value.clone(), provider).is_err(),
                "{name}"
            );
        }
    }
    assert!(parse_foreign_catalog(json!("catalog"), AgentCliInvocation::CodexExec).is_err());
    assert!(parse_foreign_catalog(json!(null), AgentCliInvocation::CodexExec).is_err());
}

#[test]
fn contract_rejected_catalog_fixtures_are_refused() {
    for (name, value) in contract_cases("rejectedCatalogs") {
        assert!(
            parse_catalog(&serde_json::to_vec(&value).unwrap()).is_err(),
            "{name}"
        );
    }
}

#[test]
fn contract_request_fixtures_are_accepted_and_rejected() {
    for (name, value) in contract_cases("requests") {
        let request: AgentCommandCatalogRequest = serde_json::from_value(value).expect(&name);
        validate_request(&request).expect(&name);
    }
    for (name, value) in contract_cases("rejectedRequests") {
        let accepted = serde_json::from_value::<AgentCommandCatalogRequest>(value)
            .ok()
            .is_some_and(|request| validate_request(&request).is_ok());
        assert!(!accepted, "{name}");
    }
    let request = AgentCommandCatalogRequest {
        repository_root: "/Users/dev/project/".to_string(),
        provider: AgentCliInvocation::CodexExec,
    };
    assert!(validate_request(&request).is_err());
    let request = AgentCommandCatalogRequest {
        repository_root: format!("/{}", "a".repeat(MAX_REPOSITORY_ROOT_BYTES)),
        provider: AgentCliInvocation::CodexExec,
    };
    assert!(validate_request(&request).is_err());
    let request = AgentCommandCatalogRequest {
        repository_root: "/Users/dev/pro\u{7}ject".to_string(),
        provider: AgentCliInvocation::CodexExec,
    };
    assert!(validate_request(&request).is_err());
}

#[test]
fn entry_names_follow_the_contract_pattern() {
    for name in [
        "pr",
        "code-review",
        "superpowers:brainstorming",
        "a.b_c",
        "9lives",
    ] {
        assert!(is_valid_entry_name(name), "{name}");
    }
    for name in ["", "/pr", "code review", "-pr", ":x", "émoji", "a\n", "pr/"] {
        assert!(!is_valid_entry_name(name), "{name}");
    }
    assert!(is_valid_entry_name(&"n".repeat(MAX_NAME_BYTES)));
    assert!(!is_valid_entry_name(&"n".repeat(MAX_NAME_BYTES + 1)));
}

#[test]
fn text_sanitizer_trims_collapses_and_truncates_on_char_boundaries() {
    assert_eq!(sanitized_text(None, 16), None);
    assert_eq!(sanitized_text(Some(""), 16), None);
    assert_eq!(sanitized_text(Some(" \n\t\u{7f}"), 16), None);
    assert_eq!(
        sanitized_text(Some("  Open a\n\npull\u{0}request.\t"), 64),
        Some("Open a pull request.".to_string())
    );
    let truncated = sanitized_text(Some("ééééé"), 7).unwrap();
    assert_eq!(truncated, "ééé");
    assert!(truncated.len() <= 7);
    assert_eq!(sanitized_text(Some("ab cd"), 3), Some("ab".to_string()));
    assert_eq!(
        sanitized_text(Some("日本語テキスト"), 8),
        Some("日本".to_string())
    );
}

#[test]
fn claude_initialize_response_maps_commands_and_drops_internal_or_invalid_names() {
    let long = "é".repeat(MAX_DESCRIPTION_BYTES);
    let stdout = claude_stdout(json!([
        {"name": "code-review", "description": "Review the diff.", "argumentHint": "[target]", "builtin": true, "aliases": ["review"]},
        {"name": "design-login", "description": "Sign in to the design workspace."},
        {"name": "__internal", "description": "hidden"},
        {"name": "bad name", "description": "space"},
        {"name": "/slash"},
        {"name": "code-review", "description": "Duplicate."},
        {"name": "long", "description": long, "argumentHint": "   ", "builtin": "yes"},
        {"description": "nameless"},
        {"name": 7},
    ]));
    let catalog = parse_claude_initialize(&stdout).unwrap();
    assert_eq!(catalog.version, 1);
    assert_eq!(catalog.provider, AgentCliInvocation::ClaudeCode);
    assert!(!catalog.truncated);
    assert_eq!(names(&catalog), ["code-review", "design-login", "long"]);
    let review = &catalog.entries[0];
    assert_eq!(review.kind, AgentCommandCatalogEntryKind::Command);
    assert_eq!(review.label, None);
    assert_eq!(review.description.as_deref(), Some("Review the diff."));
    assert_eq!(review.argument_hint.as_deref(), Some("[target]"));
    assert!(review.builtin);
    assert_eq!(catalog.entries[1].argument_hint, None);
    assert!(!catalog.entries[1].builtin);
    let long = &catalog.entries[2];
    assert!(long.description.as_deref().unwrap().len() <= MAX_DESCRIPTION_BYTES);
    assert_eq!(
        long.description.as_deref().unwrap().chars().count(),
        MAX_DESCRIPTION_BYTES / 2
    );
    assert_eq!(long.argument_hint, None);
    assert!(!long.builtin);
    let serialized = serde_json::to_string(&catalog).unwrap();
    assert!(!serialized.contains("example.test"));
    assert!(!serialized.contains("model-a"));
}

#[test]
fn claude_catalog_truncates_after_the_entry_limit() {
    let commands: Vec<Value> = (0..MAX_CATALOG_ENTRIES + 3)
        .map(|index| json!({"name": format!("command-{index}")}))
        .collect();
    let catalog = parse_claude_initialize(&claude_stdout(json!(commands))).unwrap();
    assert!(catalog.truncated);
    assert_eq!(catalog.entries.len(), MAX_CATALOG_ENTRIES);
    assert_eq!(catalog.entries[0].name, "command-0");
    assert_eq!(
        catalog.entries[MAX_CATALOG_ENTRIES - 1].name,
        format!("command-{}", MAX_CATALOG_ENTRIES - 1)
    );
    let exact: Vec<Value> = (0..MAX_CATALOG_ENTRIES)
        .map(|index| json!({"name": format!("command-{index}")}))
        .collect();
    let catalog = parse_claude_initialize(&claude_stdout(json!(exact))).unwrap();
    assert!(!catalog.truncated);
    assert_eq!(catalog.entries.len(), MAX_CATALOG_ENTRIES);
}

#[test]
fn claude_parser_ignores_unrelated_lines_and_rejects_bad_responses() {
    let mut stdout = b"not json\n{\"type\":\"system\",\"subtype\":\"init\"}\n".to_vec();
    stdout.extend(claude_stdout(json!([{"name": "pr"}])));
    assert_eq!(names(&parse_claude_initialize(&stdout).unwrap()), ["pr"]);

    assert!(parse_claude_initialize(b"").is_err());
    assert!(parse_claude_initialize(b"{not json").is_err());
    let other_id = json!({"type":"control_response","response":{"subtype":"success","request_id":"other","response":{"commands":[{"name":"pr"}]}}});
    assert!(parse_claude_initialize(other_id.to_string().as_bytes()).is_err());
    let failed = json!({"type":"control_response","response":{"subtype":"error","request_id":CLAUDE_CONTROL_REQUEST_ID,"error":"nope"}});
    assert!(parse_claude_initialize(failed.to_string().as_bytes()).is_err());
    let no_commands = json!({"type":"control_response","response":{"subtype":"success","request_id":CLAUDE_CONTROL_REQUEST_ID,"response":{"models":[]}}});
    assert!(parse_claude_initialize(no_commands.to_string().as_bytes()).is_err());
    let oversized = vec![b' '; MAX_CATALOG_OUTPUT_BYTES + 1];
    assert!(parse_claude_initialize(&oversized).is_err());
    let empty = parse_claude_initialize(&claude_stdout(json!([]))).unwrap();
    assert!(empty.entries.is_empty());
    assert!(!empty.truncated);
}

#[test]
fn codex_skills_response_maps_skills_and_prefers_the_requested_cwd_listing() {
    let other = json!({"cwd": "/Users/dev/other", "skills": [{"name": "other-skill", "scope": "repo", "enabled": true}], "errors": []});
    let requested = json!({"cwd": ROOT, "skills": [
        {"name": "work-pets:create-pet", "description": "Long description.", "shortDescription": null, "interface": {"displayName": "Create Pet", "shortDescription": "Create a new pet for this workspace."}, "path": "/Users/dev/.codex/skills/pet/SKILL.md", "scope": "user", "enabled": true},
        {"name": "skill-creator", "description": "Create or update a skill.", "interface": null, "path": "/opt/codex/skills/creator/SKILL.md", "scope": "system", "enabled": true},
        {"name": "disabled-skill", "description": "Off.", "scope": "repo", "enabled": false},
        {"name": "short", "description": "Fallback.", "shortDescription": "Top-level short.", "interface": {"shortDescription": "Interface short."}, "scope": "repo"},
        {"name": "bad name", "scope": "repo"},
        {"name": "skill-creator", "description": "Duplicate."},
        {"description": "nameless"},
    ], "errors": []});
    let stdout = codex_stdout(json!([other, requested]));
    let catalog = parse_codex_skills(&stdout, ROOT).unwrap();
    assert_eq!(catalog.provider, AgentCliInvocation::CodexExec);
    assert!(!catalog.truncated);
    assert_eq!(
        names(&catalog),
        ["work-pets:create-pet", "skill-creator", "short"]
    );
    let pet = &catalog.entries[0];
    assert_eq!(pet.kind, AgentCommandCatalogEntryKind::Skill);
    assert_eq!(pet.label.as_deref(), Some("Create Pet"));
    assert_eq!(
        pet.description.as_deref(),
        Some("Create a new pet for this workspace.")
    );
    assert_eq!(pet.argument_hint, None);
    assert!(!pet.builtin);
    let creator = &catalog.entries[1];
    assert_eq!(creator.label, None);
    assert_eq!(
        creator.description.as_deref(),
        Some("Create or update a skill.")
    );
    assert!(creator.builtin);
    assert_eq!(
        catalog.entries[2].description.as_deref(),
        Some("Top-level short.")
    );
    let serialized = serde_json::to_string(&catalog).unwrap();
    assert!(!serialized.contains("SKILL.md"));
    assert!(!serialized.contains("/Users/dev"));
}

#[test]
fn codex_parser_requires_exactly_one_listing_for_the_requested_workspace() {
    let other_only = codex_stdout(codex_listing(
        "/Users/dev/elsewhere",
        json!([{"name": "fallback", "scope": "repo"}]),
    ));
    assert!(parse_codex_skills(&other_only, ROOT).is_err());
    let duplicated = codex_stdout(json!([
        {"cwd": ROOT, "skills": [{"name": "first"}], "errors": []},
        {"cwd": ROOT, "skills": [{"name": "second"}], "errors": []},
    ]));
    assert!(parse_codex_skills(&duplicated, ROOT).is_err());
    let any_id = br#"{"id":7,"result":{"data":[{"cwd":"/Users/dev/project","skills":[{"name":"pdf"}],"errors":[]}]}}"#;
    assert_eq!(names(&parse_codex_skills(any_id, ROOT).unwrap()), ["pdf"]);
    let mixed = b"{\"id\":1,\"result\":{\"data\":[]}}\n{\"id\":2,\"result\":{\"data\":[]}}\n";
    assert!(parse_codex_skills(mixed, ROOT).is_err());
}

#[test]
fn codex_listing_errors_mark_the_catalog_incomplete_without_leaking_them() {
    let with_errors = codex_stdout(json!([{
        "cwd": ROOT,
        "skills": [{"name": "pdf"}],
        "errors": [{"path": "/Users/dev/.codex/skills/broken/SKILL.md", "message": "bad frontmatter"}],
    }]));
    let catalog = parse_codex_skills(&with_errors, ROOT).unwrap();
    assert!(catalog.truncated);
    assert_eq!(names(&catalog), ["pdf"]);
    let serialized = serde_json::to_string(&catalog).unwrap();
    assert!(!serialized.contains("SKILL.md"));
    assert!(!serialized.contains("frontmatter"));
    for errors in [json!([]), json!(null)] {
        let stdout =
            codex_stdout(json!([{"cwd": ROOT, "skills": [{"name": "pdf"}], "errors": errors}]));
        assert!(!parse_codex_skills(&stdout, ROOT).unwrap().truncated);
    }
    let missing = codex_stdout(json!([{"cwd": ROOT, "skills": [{"name": "pdf"}]}]));
    assert!(!parse_codex_skills(&missing, ROOT).unwrap().truncated);
    let odd = codex_stdout(json!([{"cwd": ROOT, "skills": [{"name": "pdf"}], "errors": "boom"}]));
    assert!(parse_codex_skills(&odd, ROOT).unwrap().truncated);
}

#[test]
fn codex_parser_rejects_bad_responses() {
    assert!(parse_codex_skills(b"", ROOT).is_err());
    assert!(parse_codex_skills(b"{\"id\":0,\"result\":{}}\n", ROOT).is_err());
    assert!(
        parse_codex_skills(br#"{"id":1,"error":{"code":-1,"message":"offline"}}"#, ROOT).is_err()
    );
    assert!(parse_codex_skills(br#"{"id":1,"result":{"data":[]}}"#, ROOT).is_err());
    assert!(parse_codex_skills(br#"{"id":1,"result":{"data":[{"cwd":"/x"}]}}"#, ROOT).is_err());
    let ambiguous = b"{\"id\":1,\"result\":{\"data\":[]}}\n{\"id\":1,\"result\":{\"data\":[]}}\n";
    assert!(parse_codex_skills(ambiguous, ROOT).is_err());
    let half = codex_stdout(codex_listing(ROOT, json!([{"name": "a"}])));
    assert!(parse_codex_skills(&half[..half.len() / 2], ROOT).is_err());
    let oversized = vec![b' '; MAX_CATALOG_OUTPUT_BYTES + 1];
    assert!(parse_codex_skills(&oversized, ROOT).is_err());
    let empty = parse_codex_skills(&codex_stdout(codex_listing(ROOT, json!([]))), ROOT).unwrap();
    assert!(empty.entries.is_empty());
}

#[test]
fn codex_catalog_truncates_after_the_entry_limit_and_bounds_text() {
    let long_label = "ü".repeat(MAX_LABEL_BYTES);
    let mut skills: Vec<Value> = (0..MAX_CATALOG_ENTRIES + 1)
        .map(|index| json!({"name": format!("skill-{index}"), "scope": "repo"}))
        .collect();
    skills[0] =
        json!({"name": "skill-0", "scope": "repo", "interface": {"displayName": long_label}});
    let catalog =
        parse_codex_skills(&codex_stdout(codex_listing(ROOT, json!(skills))), ROOT).unwrap();
    assert!(catalog.truncated);
    assert_eq!(catalog.entries.len(), MAX_CATALOG_ENTRIES);
    let label = catalog.entries[0].label.as_deref().unwrap();
    assert!(label.len() <= MAX_LABEL_BYTES);
    assert_eq!(label.chars().count(), MAX_LABEL_BYTES / 2);
}

#[test]
fn provider_requests_are_fixed_and_escaped() {
    let request: Value = serde_json::from_str(CLAUDE_INITIALIZE_REQUEST.trim_end()).unwrap();
    assert_eq!(request["type"], "control_request");
    assert_eq!(request["request_id"], CLAUDE_CONTROL_REQUEST_ID);
    assert_eq!(request["request"]["subtype"], "initialize");
    assert!(CLAUDE_INITIALIZE_REQUEST.ends_with('\n'));
    assert_eq!(CLAUDE_INITIALIZE_REQUEST.matches('\n').count(), 1);

    let tricky = "/Users/dev/pro\"ject\\with\nnewline";
    let request = codex_skills_request(tricky, 7);
    assert!(request.ends_with('\n'));
    assert_eq!(request.matches('\n').count(), 1);
    let parsed: Value = serde_json::from_str(request.trim_end()).unwrap();
    assert_eq!(
        parsed,
        json!({"method":"skills/list","id":7,"params":{"cwds":[tricky]}})
    );
}

#[test]
fn parse_catalog_output_dispatches_by_provider() {
    let claude = parse_catalog_output(
        AgentCliInvocation::ClaudeCode,
        &claude_stdout(json!([{"name": "pr"}])),
        ROOT,
    )
    .unwrap();
    assert_eq!(
        claude.entries[0].kind,
        AgentCommandCatalogEntryKind::Command
    );
    let codex = parse_catalog_output(
        AgentCliInvocation::CodexExec,
        &codex_stdout(codex_listing(ROOT, json!([{"name": "pdf"}]))),
        ROOT,
    )
    .unwrap();
    assert_eq!(codex.entries[0].kind, AgentCommandCatalogEntryKind::Skill);
    assert!(parse_catalog_output(
        AgentCliInvocation::CodexExec,
        &claude_stdout(json!([{"name": "pr"}])),
        ROOT
    )
    .is_err());
}
