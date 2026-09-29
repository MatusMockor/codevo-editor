use super::*;
use crate::codex_model_catalog_domain::{
    parse_catalog, parse_model_list, CodexCatalogSnapshot, LiveCodexCatalog,
};
use std::sync::Arc;

const BUNDLE: &[u8] = include_bytes!("../../src/domain/codexModelManifest.json");
const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/codex-app-server-model-list.jsonl");
const CONTRACT: &[u8] = include_bytes!("../../contracts/codex-model-catalog-wire.json");

fn model(id: &str) -> CodexModelChoice {
    serde_json::from_value(serde_json::json!(id)).unwrap()
}

fn live_catalog(hide: &[&str]) -> CodexCatalogSnapshot {
    let mut listing = parse_model_list(FIXTURE).unwrap();
    listing
        .models
        .retain(|model| !hide.contains(&model.id.as_str()));
    listing
        .hidden_ids
        .extend(hide.iter().map(|id| (*id).to_string()));
    CodexCatalogSnapshot::new(
        Arc::new(parse_catalog(BUNDLE).unwrap()),
        Some(Arc::new(
            LiveCodexCatalog::from_listing(listing, 1).unwrap(),
        )),
    )
}

fn contract_cases(key: &str) -> Vec<(String, serde_json::Value)> {
    let contract: serde_json::Value = serde_json::from_slice(CONTRACT).unwrap();
    contract[key]
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

#[test]
fn contract_launches_parse_and_rejected_launches_fail() {
    for (name, value) in contract_cases("launches") {
        let launch: AgentLaunchOptions =
            serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(serde_json::to_value(launch).unwrap(), value, "{name}");
    }
    let rejected = contract_cases("rejectedLaunches");
    assert!(!rejected.is_empty());
    for (name, value) in rejected {
        assert!(
            serde_json::from_value::<AgentLaunchOptions>(value).is_err(),
            "{name} must be rejected"
        );
    }
}

#[test]
fn stored_codex_launch_without_effort_round_trips_byte_identical() {
    let wire = r#"{"provider":"codex","model":"gpt-5.5","mode":"workspaceWrite"}"#;
    let launch: AgentLaunchOptions = serde_json::from_str(wire).unwrap();
    assert_eq!(
        launch,
        codex(CodexModelChoice::Gpt55, CodexExecutionMode::WorkspaceWrite)
    );
    assert_eq!(serde_json::to_string(&launch).unwrap(), wire);
    let explicit_default: AgentLaunchOptions = serde_json::from_str(
        r#"{"provider":"codex","model":"gpt-5.5","mode":"workspaceWrite","effort":"default"}"#,
    )
    .unwrap();
    assert_eq!(serde_json::to_string(&explicit_default).unwrap(), wire);
    let with_effort = codex_with_effort(
        model("gpt-6.1-sol"),
        CodexExecutionMode::Default,
        CodexEffortChoice::Xhigh,
    );
    assert_eq!(
        serde_json::to_string(&with_effort).unwrap(),
        r#"{"provider":"codex","model":"gpt-6.1-sol","mode":"default","effort":"xhigh"}"#
    );
}

#[test]
fn codex_effort_table_is_exhaustive_and_closed() {
    let expected: [(CodexEffortChoice, &str, &[&str]); 9] = [
        (CodexEffortChoice::Default, "default", &[]),
        (
            CodexEffortChoice::None,
            "none",
            &["-c", "model_reasoning_effort=\"none\""],
        ),
        (
            CodexEffortChoice::Minimal,
            "minimal",
            &["-c", "model_reasoning_effort=\"minimal\""],
        ),
        (
            CodexEffortChoice::Low,
            "low",
            &["-c", "model_reasoning_effort=\"low\""],
        ),
        (
            CodexEffortChoice::Medium,
            "medium",
            &["-c", "model_reasoning_effort=\"medium\""],
        ),
        (
            CodexEffortChoice::High,
            "high",
            &["-c", "model_reasoning_effort=\"high\""],
        ),
        (
            CodexEffortChoice::Xhigh,
            "xhigh",
            &["-c", "model_reasoning_effort=\"xhigh\""],
        ),
        (
            CodexEffortChoice::Max,
            "max",
            &["-c", "model_reasoning_effort=\"max\""],
        ),
        (
            CodexEffortChoice::Ultra,
            "ultra",
            &["-c", "model_reasoning_effort=\"ultra\""],
        ),
    ];
    for (effort, wire, args) in expected {
        assert_eq!(serde_json::to_value(effort).unwrap(), wire);
        assert_eq!(
            serde_json::from_value::<CodexEffortChoice>(wire.into()).unwrap(),
            effort
        );
        assert_eq!(effort.exec_args(), args);
        let launch = codex_with_effort(
            CodexModelChoice::Default,
            CodexExecutionMode::Default,
            effort,
        );
        assert_eq!(launch.effort_args(), args);
        assert_eq!(
            launch.codex_effort(),
            (effort != CodexEffortChoice::Default).then_some(wire)
        );
    }
}

#[test]
fn live_catalog_model_validates_and_yields_model_and_effort_args() {
    let catalog = live_catalog(&[]);
    let launch = codex_with_effort(
        model("gpt-6.1-sol"),
        CodexExecutionMode::WorkspaceWrite,
        CodexEffortChoice::Ultra,
    );
    let args = launch.codex_catalog_args(&catalog).unwrap();
    assert_eq!(args.model, ["-m", "gpt-6.1-sol"]);
    assert_eq!(args.effort, ["-c", "model_reasoning_effort=\"ultra\""]);
    assert!(args.settings.is_empty());
    assert_eq!(launch.codex_model_id(), Some("gpt-6.1-sol"));
    assert_eq!(launch.codex_effort(), Some("ultra"));
    let default = codex(CodexModelChoice::Default, CodexExecutionMode::Default);
    let args = default.codex_catalog_args(&catalog).unwrap();
    assert!(args.model.is_empty() && args.effort.is_empty());
    assert_eq!(default.codex_model_id(), None);
    assert_eq!(default.codex_effort(), None);
}

#[test]
fn bundled_catalog_model_validates_through_the_global_snapshot() {
    let launch = codex_with_effort(
        CodexModelChoice::Gpt6Astra,
        CodexExecutionMode::Default,
        CodexEffortChoice::High,
    );
    assert_eq!(launch.validate_capabilities(), Ok(()));
    assert_eq!(launch.validate_cli_version(None), Ok(()));
    let args = launch.validated_catalog_args(None).unwrap();
    assert_eq!(args.model, ["-m", "gpt-6-astra"]);
    assert_eq!(args.effort, ["-c", "model_reasoning_effort=\"high\""]);
}

#[test]
fn unknown_syntactically_valid_models_are_refused_before_spawn() {
    for id in ["gpt-6-unknown", "gpt-5.4"] {
        let launch = codex(model(id), CodexExecutionMode::Default);
        assert_eq!(
            launch.validate_capabilities(),
            Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );
        assert_eq!(
            launch.validate_cli_version(None),
            Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );
        assert_eq!(
            launch.validated_catalog_args(None).err().as_deref(),
            Some(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );
        assert!(launch.codex_catalog_args(&live_catalog(&[])).is_err());
    }
}

#[test]
fn model_hidden_by_the_live_list_is_refused_even_when_bundled() {
    let launch = codex(model("gpt-6-luna"), CodexExecutionMode::Default);
    assert!(launch.codex_catalog_args(&live_catalog(&[])).is_ok());
    assert_eq!(
        launch
            .codex_catalog_args(&live_catalog(&["gpt-6-luna"]))
            .err(),
        Some(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );
}

#[test]
fn bundle_only_models_are_accepted_before_live_and_refused_after() {
    let launch = codex(model("gpt-6-sol"), CodexExecutionMode::Default);
    let bundle_only = CodexCatalogSnapshot::new(Arc::new(parse_catalog(BUNDLE).unwrap()), None);
    assert!(launch.codex_catalog_args(&bundle_only).is_ok());
    assert_eq!(
        launch.codex_catalog_args(&live_catalog(&[])).err(),
        Some(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );
}

#[test]
fn effort_the_model_does_not_support_is_refused() {
    let catalog = live_catalog(&[]);
    for (id, effort) in [
        ("gpt-6-luna", CodexEffortChoice::Ultra),
        ("gpt-5.5", CodexEffortChoice::Max),
        ("gpt-6-astra", CodexEffortChoice::Minimal),
        ("default", CodexEffortChoice::None),
    ] {
        let launch = codex_with_effort(model(id), CodexExecutionMode::Default, effort);
        assert_eq!(
            launch.codex_catalog_args(&catalog).err(),
            Some(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR),
            "{id} {effort:?}"
        );
    }
    let supported = codex_with_effort(
        CodexModelChoice::Default,
        CodexExecutionMode::Default,
        CodexEffortChoice::Ultra,
    );
    assert!(supported.codex_catalog_args(&catalog).is_ok());
    let unsupported = codex_with_effort(
        CodexModelChoice::Gpt56Luna,
        CodexExecutionMode::Default,
        CodexEffortChoice::Ultra,
    );
    assert_eq!(
        unsupported.validate_capabilities(),
        Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
    );
}

#[test]
fn codex_model_identifiers_are_bounded_and_flag_free() {
    for value in [
        "gpt-6-astra --help".to_string(),
        "--help".into(),
        "-m".into(),
        "gpt_6".into(),
        "gpt-6\n".into(),
        "a".repeat(65),
    ] {
        assert!(serde_json::from_value::<CodexModelChoice>(value.into()).is_err());
    }
    assert_eq!(model(&"a".repeat(64)).as_str().len(), 64);
    assert_eq!(model("default"), CodexModelChoice::Default);
}
