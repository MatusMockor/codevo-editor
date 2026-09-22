use super::*;
// Snapshot of https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json
// Retrieved 2026-09-22. Deliberately local: compatibility tests never require a network.
const UPSTREAM: &[u8] = include_bytes!("../tests/fixtures/t3-model-manifest.json");
fn synthetic() -> Value {
    json!({"version":1,"updatedAt":"2026-09-22T19:42:55Z", "providers": {"claudeAgent": {
        "defaults": {"chat":"claude-test-99"},
        "profiles": {"independent-profile": {
            "capabilities": {"optionDescriptors": [
                {"id":"effort", "label":"Reasoning", "type":"select", "options":[
                    {"id":"low","label":"Low"}, {"id":"high","label":"High","isDefault":true}
                ]},
                {"id":"contextWindow","label":"Context", "type":"select", "options":[
                    {"id":"200k","label":"200k","isDefault":true}, {"id":"1m","label":"1M"}
                ]}
            ]},
            "adapter":{"claudeCode":{"effortMap":{"high":"medium"},
                "modelSuffixes":{"contextWindow":{"1m":"[1m]"}},
                "contextWindowTokens":{"200k":200000,"1m":1000000}}}
        }},
        "models":[{"slug":"claude-test-99","name":"Claude Test 99","aliases":["test-99"],"status":"current",
            "profile":"independent-profile","adapter":{"claudeCode":{"minVersion":"2.1.1","maxVersionExclusive":"3.0.0"}}}]
    }}})
}
fn parse(value: &Value) -> Result<ClaudeModelManifest, String> {
    parse_t3_manifest(&serde_json::to_vec(value).unwrap())
}
fn profile(value: &mut Value) -> &mut Value {
    &mut value["providers"]["claudeAgent"]["profiles"]["independent-profile"]
}
#[test]
fn translates_actual_upstream_with_provider_specific_effort_maps() {
    let catalog = parse_t3_manifest(UPSTREAM).unwrap();
    assert_eq!(catalog.updated_at, "2026-09-22T19:42:55Z");
    assert_eq!(catalog.claude_code.len(), 11);
    assert_eq!(
        catalog.resolve_model("default").unwrap().choice,
        "claude-fable-5-1"
    );
    let opus = catalog.resolve_model("claude-opus-4-7").unwrap();
    assert_eq!(opus.default_effort, "xhigh");
    assert_eq!(
        opus.effort_map.as_ref().unwrap()["xhigh"].as_deref(),
        Some("max")
    );
    assert_eq!(
        catalog
            .resolve_model("claude-sonnet-4-6")
            .unwrap()
            .effort_map
            .as_ref()
            .unwrap()["max"]
            .as_deref(),
        Some("high")
    );
    let haiku = catalog.resolve_model("claude-haiku-4-5").unwrap();
    assert!(haiku.thinking_mode);
    assert_eq!(haiku.default_effort, "default");
    assert!(haiku.context_windows.is_empty());
}
#[test]
fn resolves_unseen_ids_profiles_versions_and_defaults_without_model_name_tables() {
    let catalog = parse(&synthetic()).unwrap();
    let model = catalog.resolve_model("default").unwrap();
    assert_eq!(model.choice, "claude-test-99");
    assert_eq!(model.runtime_ids, ["claude-test-99", "test-99"]);
    assert_eq!(model.min_version.as_deref(), Some("2.1.1"));
    assert_eq!(model.max_version_exclusive.as_deref(), Some("3.0.0"));
    assert_eq!(model.default_context.as_deref(), Some("200k"));
    assert_eq!(model.default_effort, "high");
}
#[test]
fn unrelated_providers_and_current_model_overlays_do_not_change_claude() {
    let mut input = synthetic();
    input["providers"]["other"] = json!({"newCapability": [true, 42]});
    input["currentModels"] = json!({"codex": ["arbitrary"], "claudeAgent": ["unrelated"]});
    assert!(parse(&input).is_ok());
}
#[test]
fn rejects_unknown_capabilities_and_execution_mappings() {
    for (pointer, replacement) in [
        ("/capabilities/optionDescriptors/0/id", json!("execute")),
        ("/capabilities/optionDescriptors/0/type", json!("shell")),
        (
            "/capabilities/optionDescriptors/0/options/0/id",
            json!("future-effort"),
        ),
        ("/adapter/claudeCode/effortMap/high", json!("--dangerous")),
        ("/adapter/claudeCode/effortMap/high", Value::Null),
        (
            "/adapter/claudeCode/modelSuffixes/contextWindow/1m",
            json!("[evil]"),
        ),
        ("/adapter/claudeCode/contextWindowTokens/1m", json!(42)),
    ] {
        let mut input = synthetic();
        *profile(&mut input).pointer_mut(pointer).unwrap() = replacement;
        assert!(parse(&input).is_err(), "accepted {pointer}");
    }
    let mut input = synthetic();
    profile(&mut input)["adapter"]["claudeCode"]["runtimeArguments"] = json!(["--evil"]);
    assert!(parse(&input).is_err());
}
#[test]
fn rejects_missing_duplicate_or_incompatible_defaults_and_references() {
    for pointer in [
        "/providers/claudeAgent/defaults/chat",
        "/providers/claudeAgent/models/0/profile",
    ] {
        let mut input = synthetic();
        *input.pointer_mut(pointer).unwrap() = json!("missing");
        assert!(parse(&input).is_err());
    }
    for index in [0, 1] {
        let mut input = synthetic();
        profile(&mut input)["capabilities"]["optionDescriptors"][0]["options"][index]
            ["isDefault"] = json!(index == 0);
        assert!(parse(&input).is_err());
    }
    let mut input = synthetic();
    input["providers"]["claudeAgent"]["models"][0]["aliases"] = json!(["test-99", "test-99"]);
    assert!(parse(&input).is_err());
    let mut input = synthetic();
    let mut second = input["providers"]["claudeAgent"]["models"][0].clone();
    second["slug"] = json!("claude-test-100");
    input["providers"]["claudeAgent"]["models"]
        .as_array_mut()
        .unwrap()
        .push(second);
    assert!(parse(&input).is_err());
}
#[test]
fn rejects_special_effort_and_prompt_semantics_it_cannot_preserve() {
    for target in [json!("high"), json!(true)] {
        let mut input: Value = serde_json::from_slice(UPSTREAM).unwrap();
        input["providers"]["claudeAgent"]["profiles"]["fable-5"]["adapter"]["claudeCode"]
            ["effortMap"]["ultracode"] = target;
        assert!(parse(&input).is_err());
    }
    let mut input: Value = serde_json::from_slice(UPSTREAM).unwrap();
    input["providers"]["claudeAgent"]["profiles"]["fable-5"]["capabilities"]["optionDescriptors"]
        [0]["promptInjectedValues"] = json!(["high"]);
    assert!(parse(&input).is_err());
}
#[test]
fn rejects_oversized_payloads_collections_strings_and_bad_timestamps() {
    assert!(parse_t3_manifest(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
    let mut input = synthetic();
    let model = input["providers"]["claudeAgent"]["models"][0].clone();
    input["providers"]["claudeAgent"]["models"] = json!(vec![model; 129]);
    assert!(parse(&input).is_err());
    let mut input = synthetic();
    let item = profile(&mut input).clone();
    input["providers"]["claudeAgent"]["profiles"] =
        Value::Object((0..129).map(|i| (format!("p{i}"), item.clone())).collect());
    assert!(parse(&input).is_err());
    let mut input = synthetic();
    profile(&mut input)["capabilities"]["optionDescriptors"][0]["label"] = json!("a".repeat(129));
    assert!(parse(&input).is_err());
    let mut input = synthetic();
    input["updatedAt"] = json!("2026-02-30T00:00:00Z");
    assert!(parse(&input).is_err());
}
