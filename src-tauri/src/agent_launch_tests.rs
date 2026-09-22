use super::*;

const CLAUDE_MODELS: [ClaudeModelChoice; 14] = [
    ClaudeModelChoice::Default,
    ClaudeModelChoice::Fable,
    ClaudeModelChoice::Opus,
    ClaudeModelChoice::Sonnet,
    ClaudeModelChoice::ClaudeFable51,
    ClaudeModelChoice::ClaudeFable5,
    ClaudeModelChoice::ClaudeOpus5,
    ClaudeModelChoice::ClaudeOpus48,
    ClaudeModelChoice::ClaudeOpus47,
    ClaudeModelChoice::ClaudeOpus46,
    ClaudeModelChoice::ClaudeOpus45,
    ClaudeModelChoice::ClaudeSonnet5,
    ClaudeModelChoice::ClaudeSonnet46,
    ClaudeModelChoice::ClaudeHaiku45,
];
const CLAUDE_MODES: [ClaudePermissionMode; 6] = [
    ClaudePermissionMode::Default,
    ClaudePermissionMode::Plan,
    ClaudePermissionMode::Supervised,
    ClaudePermissionMode::AcceptEdits,
    ClaudePermissionMode::Auto,
    ClaudePermissionMode::BypassPermissions,
];
const CODEX_MODELS: [CodexModelChoice; 7] = [
    CodexModelChoice::Default,
    CodexModelChoice::Gpt6Astra,
    CodexModelChoice::Gpt56Sol,
    CodexModelChoice::Gpt56Terra,
    CodexModelChoice::Gpt56Luna,
    CodexModelChoice::Gpt55,
    CodexModelChoice::Gpt54,
];
const CODEX_MODES: [CodexExecutionMode; 5] = [
    CodexExecutionMode::Default,
    CodexExecutionMode::ReadOnly,
    CodexExecutionMode::WorkspaceWrite,
    CodexExecutionMode::Auto,
    CodexExecutionMode::DangerFullAccess,
];

const CLAUDE_EFFORTS: [ClaudeEffortChoice; 8] = [
    ClaudeEffortChoice::Default,
    ClaudeEffortChoice::Low,
    ClaudeEffortChoice::Medium,
    ClaudeEffortChoice::High,
    ClaudeEffortChoice::Xhigh,
    ClaudeEffortChoice::Max,
    ClaudeEffortChoice::Ultracode,
    ClaudeEffortChoice::Ultrathink,
];

fn claude(model: ClaudeModelChoice, mode: ClaudePermissionMode) -> AgentLaunchOptions {
    claude_with_effort(model, mode, ClaudeEffortChoice::Default)
}

fn claude_with_effort(
    model: ClaudeModelChoice,
    mode: ClaudePermissionMode,
    effort: ClaudeEffortChoice,
) -> AgentLaunchOptions {
    AgentLaunchOptions::ClaudeCode {
        model,
        mode,
        effort,
        context: ClaudeContextChoice::TwoHundredK,
        fast_mode: false,
        thinking_mode: false,
        chrome: true,
    }
}

fn codex(model: CodexModelChoice, mode: CodexExecutionMode) -> AgentLaunchOptions {
    AgentLaunchOptions::Codex { model, mode }
}

#[test]
fn catalog_model_without_a_code_variant_launches_and_enforces_its_constraints() {
    let mut catalog = (*crate::claude_model_manifest::snapshot().unwrap()).clone();
    let mut future = catalog.claude_code[0].clone();
    future.choice = "claude-future-9".into();
    future.runtime_ids = vec![future.choice.clone()];
    future.min_version = Some("2.1.280".into());
    future.max_version_exclusive = Some("3.0.0".into());
    future.fast_mode = false;
    future.thinking_mode = false;
    future.efforts = vec!["high".into()];
    future.context_windows = vec!["200k".into(), "1m".into()];
    catalog.claude_code.push(future);
    let launch: AgentLaunchOptions = serde_json::from_value(serde_json::json!({
        "provider":"claudeCode", "model":"claude-future-9", "mode":"default",
        "effort":"high", "context":"1m"
    }))
    .unwrap();
    assert!(
        launch.validate_capabilities().is_err(),
        "unpublished IDs fail execution validation"
    );
    assert!(launch.validate_manifest(&catalog, Some("2.1.280")).is_ok());
    assert!(launch.validate_manifest(&catalog, Some("2.1.279")).is_err());
    assert!(launch.validate_manifest(&catalog, Some("3.0.0")).is_err());
    assert!(launch
        .validate_manifest(&catalog, Some("2.1.281-beta.1"))
        .is_ok());
    assert!(
        claude(ClaudeModelChoice::Sonnet, ClaudePermissionMode::Default)
            .validate_manifest(&catalog, Some("2.1.281-beta.1"))
            .is_ok()
    );
    assert!(claude(
        ClaudeModelChoice::ClaudeFable51,
        ClaudePermissionMode::Default
    )
    .validate_cli_version(None)
    .is_err());
    assert!(
        claude(ClaudeModelChoice::Default, ClaudePermissionMode::Default)
            .validate_cli_version(None)
            .is_ok()
    );
    let AgentLaunchOptions::ClaudeCode { model, context, .. } = launch else {
        unreachable!()
    };
    assert_eq!(
        claude_model_args(model, context, true),
        ["--model", "claude-future-9[1m]"]
    );
    let mut unsupported = launch;
    if let AgentLaunchOptions::ClaudeCode { fast_mode, .. } = &mut unsupported {
        *fast_mode = true;
    }
    assert!(unsupported.validate_manifest(&catalog, None).is_err());
    if let AgentLaunchOptions::ClaudeCode {
        fast_mode, effort, ..
    } = &mut unsupported
    {
        *fast_mode = false;
        *effort = ClaudeEffortChoice::Max;
    }
    assert!(unsupported.validate_manifest(&catalog, None).is_err());
}

#[test]
fn dynamic_model_identifiers_reject_flag_injection_and_unbounded_input() {
    for value in [
        "--help".to_string(),
        "gpt-6-astra".into(),
        "claude-opus-5.5".into(),
        "claude-".into(),
        "claude-opus--5".into(),
        "claude-new --help".into(),
        "claude-new[1m]".into(),
        "a".repeat(97),
        "claude-💣".into(),
    ] {
        assert!(serde_json::from_value::<ClaudeModelChoice>(value.into()).is_err());
    }
}

#[test]
fn product_default_is_a_concrete_full_access_claude_launch() {
    let options = AgentLaunchOptions::default();
    assert!(options.is_dangerous());
    assert_eq!(options.mode_args(false), ["--dangerously-skip-permissions"]);
    assert_eq!(options.effort_args(), ["--effort", "high"]);
    assert!(options.model_args().is_empty());
}

#[test]
fn claude_model_table_is_exhaustive_and_flagless_by_default() {
    let expected: [&[&str]; 14] = [
        &[],
        &["--model", "fable"],
        &["--model", "opus"],
        &["--model", "sonnet"],
        &["--model", "claude-fable-5-1"],
        &["--model", "claude-fable-5"],
        &["--model", "claude-opus-5"],
        &["--model", "claude-opus-4-8"],
        &["--model", "claude-opus-4-7"],
        &["--model", "claude-opus-4-6"],
        &["--model", "claude-opus-4-5"],
        &["--model", "claude-sonnet-5"],
        &["--model", "claude-sonnet-4-6"],
        &["--model", "claude-haiku-4-5"],
    ];
    for (index, model) in CLAUDE_MODELS.into_iter().enumerate() {
        assert_eq!(
            claude(model, ClaudePermissionMode::Default).model_args(),
            expected[index],
            "model {model:?}"
        );
    }
}

#[test]
fn claude_one_million_context_uses_the_runtime_model_suffix() {
    let launch = AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Fable,
        mode: ClaudePermissionMode::Default,
        effort: ClaudeEffortChoice::High,
        context: ClaudeContextChoice::OneM,
        fast_mode: false,
        thinking_mode: false,
        chrome: true,
    };
    assert_eq!(launch.model_args(), &["--model", "fable[1m]"]);
}

#[test]
fn claude_mode_table_is_exhaustive_and_ignores_resume() {
    let expected: [&[&str]; 6] = [
        &[],
        &["--permission-mode", "plan"],
        &["--permission-mode", "default"],
        &["--permission-mode", "acceptEdits"],
        &["--permission-mode", "auto"],
        &["--dangerously-skip-permissions"],
    ];
    for (index, mode) in CLAUDE_MODES.into_iter().enumerate() {
        let options = claude(ClaudeModelChoice::Default, mode);
        assert_eq!(options.mode_args(false), expected[index], "mode {mode:?}");
        assert_eq!(options.mode_args(true), expected[index], "mode {mode:?}");
    }
}

#[test]
fn claude_effort_table_is_exhaustive_and_flagless_by_default() {
    let expected: [&[&str]; 8] = [
        &[],
        &["--effort", "low"],
        &["--effort", "medium"],
        &["--effort", "high"],
        &["--effort", "xhigh"],
        &["--effort", "max"],
        &["--effort", "xhigh"],
        &[],
    ];
    for (index, effort) in CLAUDE_EFFORTS.into_iter().enumerate() {
        let options = claude_with_effort(
            ClaudeModelChoice::Default,
            ClaudePermissionMode::Default,
            effort,
        );
        assert_eq!(options.effort_args(), expected[index], "effort {effort:?}");
    }
}

#[test]
fn claude_ultracode_maps_to_xhigh_and_enables_cli_orchestration() {
    let launch = claude_with_effort(
        ClaudeModelChoice::Opus,
        ClaudePermissionMode::BypassPermissions,
        ClaudeEffortChoice::Ultracode,
    );
    assert_eq!(launch.effort_args(), &["--effort", "xhigh"]);
    assert_eq!(
        launch.settings_args(),
        &["--settings", r#"{"ultracode":true}"#]
    );
}

#[test]
fn claude_fast_mode_is_forwarded_with_ultracode_in_one_settings_document() {
    let launch = AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Opus,
        mode: ClaudePermissionMode::BypassPermissions,
        effort: ClaudeEffortChoice::Ultracode,
        context: ClaudeContextChoice::OneM,
        fast_mode: true,
        thinking_mode: false,
        chrome: true,
    };
    assert_eq!(
        launch.settings_args(),
        &["--settings", r#"{"fastMode":true,"ultracode":true}"#]
    );
}

#[test]
fn claude_haiku_thinking_is_forwarded_as_a_real_cli_setting() {
    let launch = AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::ClaudeHaiku45,
        mode: ClaudePermissionMode::BypassPermissions,
        effort: ClaudeEffortChoice::Default,
        context: ClaudeContextChoice::TwoHundredK,
        fast_mode: false,
        thinking_mode: true,
        chrome: true,
    };
    assert_eq!(
        launch.settings_args(),
        &["--settings", r#"{"alwaysThinkingEnabled":true}"#]
    );
    assert!(launch.validate_capabilities().is_ok());
}

#[test]
fn claude_ultrathink_prefixes_prose_but_preserves_cli_slash_commands() {
    let launch = claude_with_effort(
        ClaudeModelChoice::Fable,
        ClaudePermissionMode::BypassPermissions,
        ClaudeEffortChoice::Ultrathink,
    );
    assert_eq!(
        launch.prompt("Investigate this"),
        "Ultrathink:\nInvestigate this"
    );
    assert_eq!(
        launch.prompt(" /compact keep recent errors "),
        "/compact keep recent errors"
    );
    assert_eq!(
        launch.prompt("/home/developer/app.ts failed"),
        "Ultrathink:\n/home/developer/app.ts failed"
    );
}

#[test]
fn model_specific_capabilities_fail_closed() {
    let unsupported_ultracode = claude_with_effort(
        ClaudeModelChoice::Sonnet,
        ClaudePermissionMode::BypassPermissions,
        ClaudeEffortChoice::Ultracode,
    );
    assert_eq!(
        unsupported_ultracode.validate_capabilities(),
        Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );

    let unsupported_fast = AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Fable,
        mode: ClaudePermissionMode::BypassPermissions,
        effort: ClaudeEffortChoice::High,
        context: ClaudeContextChoice::OneM,
        fast_mode: true,
        thinking_mode: false,
        chrome: true,
    };
    assert_eq!(
        unsupported_fast.validate_capabilities(),
        Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );
    assert!(AgentLaunchOptions::ClaudeCode {
        model: ClaudeModelChoice::Opus,
        mode: ClaudePermissionMode::BypassPermissions,
        effort: ClaudeEffortChoice::High,
        context: ClaudeContextChoice::OneM,
        fast_mode: true,
        thinking_mode: false,
        chrome: true,
    }
    .validate_capabilities()
    .is_ok());
    assert_eq!(
        claude_with_effort(
            ClaudeModelChoice::ClaudeHaiku45,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::High,
        )
        .validate_capabilities(),
        Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );
}

#[test]
fn codex_never_carries_effort_args() {
    for model in CODEX_MODELS {
        for mode in CODEX_MODES {
            assert!(codex(model, mode).effort_args().is_empty());
        }
    }
}

#[test]
fn claude_launch_defaults_effort_when_the_stored_document_omits_it() {
    let decoded: AgentLaunchOptions =
        serde_json::from_str(r#"{"provider":"claudeCode","model":"sonnet","mode":"plan"}"#)
            .expect("schema 1 claude launch decodes");
    assert_eq!(
        decoded,
        claude_with_effort(
            ClaudeModelChoice::Sonnet,
            ClaudePermissionMode::Plan,
            ClaudeEffortChoice::Default
        )
    );
    assert!(decoded.effort_args().is_empty());
}

#[test]
fn claude_browser_integration_is_on_unless_the_thread_turned_it_off() {
    let stored: AgentLaunchOptions =
        serde_json::from_str(r#"{"provider":"claudeCode","model":"sonnet","mode":"plan"}"#)
            .expect("schema 1 claude launch decodes");
    assert_eq!(stored.browser_args(), &["--chrome"]);
    assert_eq!(AgentLaunchOptions::default().browser_args(), &["--chrome"]);
    assert!(codex(CodexModelChoice::Gpt56Sol, CodexExecutionMode::Auto)
        .browser_args()
        .is_empty());

    let off_wire = r#"{"provider":"claudeCode","model":"sonnet","mode":"plan","effort":"default","context":"200k","chrome":false}"#;
    let off: AgentLaunchOptions =
        serde_json::from_str(off_wire).expect("chrome-off launch decodes");
    assert!(off.browser_args().is_empty());
    assert_eq!(
        serde_json::to_string(&off).expect("chrome-off launch encodes"),
        off_wire
    );
    assert_eq!(off.validate_capabilities(), Ok(()));
}

#[test]
fn codex_model_table_is_exhaustive_and_flagless_by_default() {
    let expected: [&[&str]; 7] = [
        &[],
        &["-m", "gpt-6-astra"],
        &["-m", "gpt-5.6-sol"],
        &["-m", "gpt-5.6-terra"],
        &["-m", "gpt-5.6-luna"],
        &["-m", "gpt-5.5"],
        &["-m", "gpt-5.4"],
    ];
    for (index, model) in CODEX_MODELS.into_iter().enumerate() {
        assert_eq!(
            codex(model, CodexExecutionMode::Default).model_args(),
            expected[index],
            "model {model:?}"
        );
    }
}

#[test]
fn codex_mode_table_differs_between_first_turn_and_resume() {
    let first: [&[&str]; 5] = [
        &[],
        &["--sandbox", "read-only"],
        &["--sandbox", "workspace-write"],
        &["--sandbox", "workspace-write"],
        &["--dangerously-bypass-approvals-and-sandbox"],
    ];
    let resumed: [&[&str]; 5] = [
        &[],
        &["-c", "sandbox_mode=\"read-only\""],
        &["-c", "sandbox_mode=\"workspace-write\""],
        &["-c", "sandbox_mode=\"workspace-write\""],
        &["--dangerously-bypass-approvals-and-sandbox"],
    ];
    for (index, mode) in CODEX_MODES.into_iter().enumerate() {
        let options = codex(CodexModelChoice::Default, mode);
        assert_eq!(options.mode_args(false), first[index], "mode {mode:?}");
        assert_eq!(options.mode_args(true), resumed[index], "mode {mode:?}");
    }
}

#[test]
fn invocation_and_dangerous_classification_follow_the_provider() {
    assert_eq!(
        claude(ClaudeModelChoice::Opus, ClaudePermissionMode::Plan).invocation(),
        AgentCliInvocation::ClaudeCode
    );
    assert_eq!(
        codex(CodexModelChoice::Gpt55, CodexExecutionMode::ReadOnly).invocation(),
        AgentCliInvocation::CodexExec
    );
    assert!(claude(
        ClaudeModelChoice::Default,
        ClaudePermissionMode::BypassPermissions
    )
    .is_dangerous());
    assert!(codex(
        CodexModelChoice::Default,
        CodexExecutionMode::DangerFullAccess
    )
    .is_dangerous());
    assert!(!claude(
        ClaudeModelChoice::Default,
        ClaudePermissionMode::AcceptEdits
    )
    .is_dangerous());
    assert!(!codex(
        CodexModelChoice::Default,
        CodexExecutionMode::WorkspaceWrite
    )
    .is_dangerous());
}

#[test]
fn matches_only_its_own_invocation() {
    let options = codex(CodexModelChoice::Gpt54, CodexExecutionMode::Default);
    assert!(options.matches(AgentCliInvocation::CodexExec));
    assert!(!options.matches(AgentCliInvocation::ClaudeCode));
}

#[test]
fn serde_round_trips_every_pair() {
    for model in CLAUDE_MODELS {
        for mode in CLAUDE_MODES {
            let options = claude(model, mode);
            let encoded = serde_json::to_string(&options).expect("claude launch encodes");
            let decoded: AgentLaunchOptions =
                serde_json::from_str(&encoded).expect("claude launch decodes");
            assert_eq!(decoded, options);
        }
    }
    for model in CODEX_MODELS {
        for mode in CODEX_MODES {
            let options = codex(model, mode);
            let encoded = serde_json::to_string(&options).expect("codex launch encodes");
            let decoded: AgentLaunchOptions =
                serde_json::from_str(&encoded).expect("codex launch decodes");
            assert_eq!(decoded, options);
        }
    }
}

#[test]
fn serde_uses_the_documented_wire_names() {
    let astra_wire = r#"{"provider":"codex","model":"gpt-6-astra","mode":"workspaceWrite"}"#;
    let astra = codex(
        CodexModelChoice::Gpt6Astra,
        CodexExecutionMode::WorkspaceWrite,
    );
    assert_eq!(
        serde_json::from_str::<AgentLaunchOptions>(astra_wire).expect("astra launch decodes"),
        astra
    );
    assert_eq!(
        serde_json::to_string(&astra).expect("astra launch encodes"),
        astra_wire
    );
    let encoded = serde_json::to_string(&codex(
        CodexModelChoice::Gpt56Sol,
        CodexExecutionMode::WorkspaceWrite,
    ))
    .expect("codex launch encodes");
    assert_eq!(
        encoded,
        r#"{"provider":"codex","model":"gpt-5.6-sol","mode":"workspaceWrite"}"#
    );
    let encoded = serde_json::to_string(&claude(
        ClaudeModelChoice::Sonnet,
        ClaudePermissionMode::BypassPermissions,
    ))
    .expect("claude launch encodes");
    assert_eq!(
        encoded,
        r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"default","context":"200k"}"#
    );
    let encoded = serde_json::to_string(&claude_with_effort(
        ClaudeModelChoice::Sonnet,
        ClaudePermissionMode::BypassPermissions,
        ClaudeEffortChoice::Xhigh,
    ))
    .expect("claude launch encodes");
    assert_eq!(
        encoded,
        r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"xhigh","context":"200k"}"#
    );
}

#[test]
fn serde_rejects_unknown_variants_fields_and_cross_provider_pairs() {
    for model in ["gpt-6-astra-unknown", "gpt-6-astra --help", "gpt-6"] {
        let wire = serde_json::json!({"provider": "codex", "model": model, "mode": "default"});
        assert!(serde_json::from_value::<AgentLaunchOptions>(wire).is_err());
    }
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"claudeCode","model":"claude-opus-4","mode":"default"}"#
    )
    .unwrap()
    .validate_capabilities()
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"gemini","model":"default","mode":"default"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"codex","model":"default","mode":"acceptEdits"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"claudeCode","model":"default","mode":"readOnly"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"codex","model":"default","mode":"default","effort":"high"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"codex","model":"default"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"claudeCode","model":"default","mode":"default","effort":"ultra"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"codex","model":"default","mode":"default","effort":"low"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"codex","model":"default","mode":"default","effort":"default"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<AgentLaunchOptions>(
        r#"{"provider":"claudeCode","model":"default","mode":"default","effort":"Xhigh"}"#
    )
    .is_err());
}

#[test]
fn newly_discovered_models_use_manifest_effort_mapping() {
    let mut data: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../src/domain/claudeModelManifest.json"))
            .unwrap();
    let entry = &mut data["claudeCode"][0];
    entry["choice"] = serde_json::json!("claude-future-6");
    entry["runtimeIds"] = serde_json::json!(["claude-future-6"]);
    entry["efforts"] = serde_json::json!(["xhigh", "max", "ultracode", "ultrathink"]);
    entry["defaultEffort"] = serde_json::json!("xhigh");
    entry["effortMap"] =
        serde_json::json!({"xhigh":"max", "max":"high", "ultracode":"xhigh", "ultrathink":null});
    let manifest =
        crate::claude_model_manifest_domain::parse_manifest(&serde_json::to_vec(&data).unwrap())
            .unwrap();
    for (effort, expected) in [
        ("xhigh", vec!["--effort", "max"]),
        ("max", vec!["--effort", "high"]),
        ("ultracode", vec!["--effort", "xhigh"]),
        ("ultrathink", vec![]),
        ("default", vec![]),
    ] {
        let launch: AgentLaunchOptions = serde_json::from_value(serde_json::json!({"provider":"claudeCode", "model":"claude-future-6", "mode":"default", "effort":effort})).unwrap();
        assert_eq!(launch.effort_args_with_manifest(&manifest), expected);
        if effort == "ultracode" {
            assert!(launch.settings_args_with_manifest(&manifest)[1].contains("\"ultracode\":true"));
        }
        if effort == "ultrathink" {
            assert_eq!(launch.prompt("hello"), "Ultrathink:\nhello");
        }
    }
}
