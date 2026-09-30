use super::*;
use serde_json::{json, Value};

const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/codex-app-server-model-list.jsonl");
const BUNDLE: &[u8] = include_bytes!("../../src/domain/codexModelManifest.json");
const CONTRACT: &[u8] = include_bytes!("../../contracts/codex-model-catalog-wire.json");

fn fixture_response() -> Value {
    FIXTURE
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .find(|value| value["id"] == json!(1))
        .unwrap()
}

fn stdout_for(response: &Value) -> Vec<u8> {
    let mut stdout = br#"{"id":0,"result":{"userAgent":"codevo_editor/0.159.1"}}"#.to_vec();
    stdout.push(b'\n');
    stdout.extend(serde_json::to_vec(response).unwrap());
    stdout.push(b'\n');
    stdout
}

fn with_entries(edit: impl FnOnce(&mut Vec<Value>)) -> Vec<u8> {
    let mut response = fixture_response();
    let entries = response["result"]["data"].as_array_mut().unwrap();
    edit(entries);
    stdout_for(&response)
}

fn entry<'a>(entries: &'a mut [Value], id: &str) -> &'a mut Value {
    entries.iter_mut().find(|entry| entry["id"] == id).unwrap()
}

fn contract_cases(key: &str) -> Vec<(String, Value)> {
    let contract: Value = serde_json::from_slice(CONTRACT).unwrap();
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
fn real_model_list_fixture_adapts_to_visible_models_and_hidden_ids() {
    let listing = parse_model_list(FIXTURE).unwrap();
    let ids: Vec<_> = listing
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "gpt-6.1-sol",
            "gpt-6-astra",
            "gpt-6-luna",
            "gpt-5.6-sol",
            "gpt-5.5"
        ]
    );
    let default = &listing.models[0];
    assert!(default.is_default);
    assert_eq!(default.label, "GPT-6.1-Sol");
    assert_eq!(default.default_effort, Some(CodexEffort::Low));
    assert_eq!(
        default.efforts,
        [
            CodexEffort::Low,
            CodexEffort::Medium,
            CodexEffort::High,
            CodexEffort::Xhigh,
            CodexEffort::Max,
            CodexEffort::Ultra
        ]
    );
    assert_eq!(
        listing
            .models
            .iter()
            .filter(|model| model.is_default)
            .count(),
        1
    );
    let legacy = &listing.models[4];
    assert_eq!(legacy.status, CodexModelStatus::Legacy);
    assert_eq!(legacy.upgrade_to.as_deref(), Some("gpt-5.6-sol"));
    assert!(listing.models[..4]
        .iter()
        .all(|model| model.status == CodexModelStatus::Current && model.upgrade_to.is_none()));
    assert_eq!(
        listing
            .hidden_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["codex-auto-review", "gpt-reserve"]
    );
    let live = LiveCodexCatalog::from_listing(listing, 1).unwrap();
    assert_eq!(live.catalog.source, CodexCatalogSource::Live);
}

#[test]
fn unknown_efforts_are_dropped_and_unknown_default_effort_becomes_null() {
    let stdout = with_entries(|entries| {
        let model = entry(entries, "gpt-6-astra");
        model["supportedReasoningEfforts"] = json!([
            {"reasoningEffort": "turbo", "description": "future"},
            {"reasoningEffort": "high", "description": "deep"},
            {"reasoningEffort": "high", "description": "duplicate"}
        ]);
        model["defaultReasoningEffort"] = json!("turbo");
    });
    let listing = parse_model_list(&stdout).unwrap();
    let astra = listing
        .models
        .iter()
        .find(|model| model.id == "gpt-6-astra")
        .unwrap();
    assert_eq!(astra.efforts, [CodexEffort::High]);
    assert_eq!(astra.default_effort, None);
}

#[test]
fn upgrade_string_is_a_fallback_for_upgrade_info() {
    let stdout = with_entries(|entries| {
        let model = entry(entries, "gpt-5.5");
        model["upgradeInfo"] = Value::Null;
        model["upgrade"] = json!("gpt-6-astra");
    });
    let listing = parse_model_list(&stdout).unwrap();
    let legacy = listing
        .models
        .iter()
        .find(|model| model.id == "gpt-5.5")
        .unwrap();
    assert_eq!(legacy.upgrade_to.as_deref(), Some("gpt-6-astra"));
    assert_eq!(legacy.status, CodexModelStatus::Legacy);
}

#[test]
fn malformed_partial_and_unsafe_model_lists_are_rejected_whole() {
    let mut error_response = fixture_response();
    error_response
        .as_object_mut()
        .unwrap()
        .insert("error".into(), json!({"code": -32600, "message": "nope"}));
    let mut error_only = json!({"id": 1, "error": {"code": -32600, "message": "nope"}});
    let mut paged = fixture_response();
    paged["result"]["nextCursor"] = json!("page-2");
    let mut cursor_wrong_type = fixture_response();
    cursor_wrong_type["result"]["nextCursor"] = json!(7);
    let rejected: Vec<(&str, Vec<u8>)> = vec![
        ("not json", b"not json\n".to_vec()),
        ("empty", Vec::new()),
        ("oversize", vec![b' '; MAX_MODEL_LIST_BYTES + 1]),
        (
            "no response",
            FIXTURE.split(|b| *b == b'\n').next().unwrap().to_vec(),
        ),
        ("truncated", FIXTURE[..FIXTURE.len() / 2].to_vec()),
        ("error response", stdout_for(&error_response)),
        ("error only", stdout_for(&error_only.take())),
        ("paged", stdout_for(&paged)),
        ("cursor wrong type", stdout_for(&cursor_wrong_type)),
        ("duplicate response", [FIXTURE, FIXTURE].concat()),
        (
            "zero defaults",
            with_entries(|entries| entry(entries, "gpt-6.1-sol")["isDefault"] = json!(false)),
        ),
        (
            "two defaults",
            with_entries(|entries| entry(entries, "gpt-6-astra")["isDefault"] = json!(true)),
        ),
        (
            "hidden default",
            with_entries(|entries| entry(entries, "gpt-6.1-sol")["hidden"] = json!(true)),
        ),
        (
            "duplicate ids",
            with_entries(|entries| {
                let duplicate = entry(entries, "gpt-6-astra").clone();
                entries.push(duplicate);
            }),
        ),
        (
            "duplicate hidden id",
            with_entries(|entries| entry(entries, "gpt-reserve")["id"] = json!("gpt-6-luna")),
        ),
        (
            "aliased visible model",
            with_entries(|entries| entry(entries, "gpt-6-astra")["model"] = json!("gpt-6-sol")),
        ),
        (
            "flag-like id",
            with_entries(|entries| {
                let model = entry(entries, "gpt-6-astra");
                model["id"] = json!("--help");
                model["model"] = json!("--help");
            }),
        ),
        (
            "uppercase id",
            with_entries(|entries| {
                let model = entry(entries, "gpt-6-astra");
                model["id"] = json!("GPT-6-Astra");
                model["model"] = json!("GPT-6-Astra");
            }),
        ),
        (
            "control character",
            with_entries(|entries| {
                entry(entries, "gpt-6-astra")["description"] = json!("Frontier.\u{7}")
            }),
        ),
        (
            "empty label",
            with_entries(|entries| entry(entries, "gpt-6-astra")["displayName"] = json!("")),
        ),
        (
            "overlong description",
            with_entries(|entries| {
                entry(entries, "gpt-6-astra")["description"] = json!("x".repeat(1025))
            }),
        ),
        (
            "unsafe upgrade target",
            with_entries(|entries| {
                entry(entries, "gpt-5.5")["upgradeInfo"]["model"] = json!("gpt 6 --yolo")
            }),
        ),
        (
            "missing required field",
            with_entries(|entries| {
                entry(entries, "gpt-6-luna")
                    .as_object_mut()
                    .unwrap()
                    .remove("isDefault");
            }),
        ),
        (
            "wrong typed hidden flag",
            with_entries(|entries| entry(entries, "gpt-6-luna")["hidden"] = json!("false")),
        ),
        (
            "wrong typed effort",
            with_entries(|entries| {
                entry(entries, "gpt-6-luna")["supportedReasoningEfforts"] =
                    json!([{"reasoningEffort": 3}])
            }),
        ),
        (
            "hidden entry missing fields",
            with_entries(|entries| {
                entry(entries, "gpt-reserve")
                    .as_object_mut()
                    .unwrap()
                    .remove("description");
            }),
        ),
        (
            "only hidden models",
            with_entries(|entries| entries.retain(|entry| entry["hidden"] == json!(true))),
        ),
        (
            "too many entries",
            with_entries(|entries| {
                let template = entry(entries, "gpt-reserve").clone();
                for index in 0..MAX_UPSTREAM_MODELS {
                    let mut hidden = template.clone();
                    hidden["id"] = json!(format!("hidden-{index}"));
                    entries.push(hidden);
                }
            }),
        ),
    ];
    for (name, stdout) in rejected {
        assert!(
            parse_model_list(&stdout).is_err(),
            "{name} must be rejected"
        );
    }
}

#[test]
fn hidden_entries_with_unsafe_ids_are_excluded_from_the_hidden_set() {
    let stdout = with_entries(|entries| entry(entries, "gpt-reserve")["id"] = json!("--reserve"));
    let listing = parse_model_list(&stdout).unwrap();
    assert_eq!(
        listing
            .hidden_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["codex-auto-review"]
    );
}

#[test]
fn bundled_catalog_is_valid() {
    let catalog = parse_catalog(BUNDLE).unwrap();
    assert_eq!(catalog.source, CodexCatalogSource::Bundled);
    assert_eq!(catalog.revision, 0);
    assert!(catalog.models.iter().any(|model| model.id == "gpt-6-astra"));
    assert!(!catalog.models.iter().any(|model| model.id == "gpt-5.4"));
    assert!(catalog
        .models
        .iter()
        .all(|model| model.release_date.is_some()));
}

#[test]
fn contract_catalogs_round_trip_and_rejected_catalogs_fail() {
    for (name, value) in contract_cases("catalogs") {
        let bytes = serde_json::to_vec(&value).unwrap();
        let catalog = parse_catalog(&bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(serde_json::to_value(&catalog).unwrap(), value, "{name}");
    }
    let rejected = contract_cases("rejectedCatalogs");
    assert!(!rejected.is_empty());
    for (name, value) in rejected {
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(parse_catalog(&bytes).is_err(), "{name} must be rejected");
    }
}

#[test]
fn catalog_keys_for_nullable_fields_are_required() {
    for field in ["defaultEffort", "upgradeTo"] {
        let mut value: Value = serde_json::from_slice(BUNDLE).unwrap();
        value["models"][0].as_object_mut().unwrap().remove(field);
        assert!(parse_catalog(&serde_json::to_vec(&value).unwrap()).is_err());
    }
}

#[test]
fn live_catalog_revision_must_be_positive() {
    let listing = parse_model_list(FIXTURE).unwrap();
    assert!(LiveCodexCatalog::from_listing(listing.clone(), 0).is_err());
    assert!(LiveCodexCatalog::from_listing(listing, 1).is_ok());
}

#[test]
fn resolution_uses_the_bundle_only_until_a_live_list_exists() {
    let bundled = Arc::new(parse_catalog(BUNDLE).unwrap());
    let bundle_only = CodexCatalogSnapshot::new(Arc::clone(&bundled), None);
    assert_eq!(bundle_only.resolve("default").unwrap().id, "gpt-6.1-sol");
    assert_eq!(
        bundle_only.resolve("gpt-6-astra").unwrap().id,
        "gpt-6-astra"
    );
    assert!(bundle_only.resolve("gpt-5.4").is_none());
    assert_eq!(bundle_only.published().source, CodexCatalogSource::Bundled);

    let stdout = with_entries(|entries| {
        let model = entry(entries, "gpt-6-luna");
        model["hidden"] = json!(true);
        let astra = entry(entries, "gpt-6-astra");
        astra["supportedReasoningEfforts"] = json!([{"reasoningEffort": "low"}]);
        astra["defaultReasoningEffort"] = json!("low");
        entry(entries, "gpt-6.1-sol")["isDefault"] = json!(false);
        entry(entries, "gpt-6-astra")["isDefault"] = json!(true);
    });
    let live = LiveCodexCatalog::from_listing(parse_model_list(&stdout).unwrap(), 3).unwrap();
    let snapshot = CodexCatalogSnapshot::new(bundled, Some(Arc::new(live)));
    assert_eq!(snapshot.published().revision, 3);
    assert_eq!(snapshot.resolve("default").unwrap().id, "gpt-6-astra");
    assert_eq!(
        snapshot.resolve("gpt-6-astra").unwrap().efforts,
        [CodexEffort::Low]
    );
    assert!(snapshot.resolve("gpt-6-luna").is_none());
    assert!(snapshot.resolve("gpt-reserve").is_none());
    assert!(snapshot.resolve("gpt-6-sol").is_none());
    assert!(snapshot.resolve("gpt-6-unknown").is_none());
}

#[test]
fn small_upstream_schema_drift_keeps_the_live_list() {
    let stdout = with_entries(|entries| {
        entry(entries, "gpt-6-luna")["defaultReasoningEffort"] = Value::Null;
        entry(entries, "gpt-6-astra")
            .as_object_mut()
            .unwrap()
            .remove("hidden");
    });
    let listing = parse_model_list(&stdout).unwrap();
    let luna = listing
        .models
        .iter()
        .find(|model| model.id == "gpt-6-luna")
        .unwrap();
    assert_eq!(luna.default_effort, None);
    assert!(!luna.efforts.is_empty());
    assert!(listing.models.iter().any(|model| model.id == "gpt-6-astra"));
    assert!(!listing.hidden_ids.contains("gpt-6-astra"));
}
