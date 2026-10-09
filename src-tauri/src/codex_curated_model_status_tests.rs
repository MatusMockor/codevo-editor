use super::*;
use crate::codex_model_catalog_domain::{parse_catalog, parse_model_list};
use serde_json::{json, Value};

const UPSTREAM: &[u8] = include_bytes!("../tests/fixtures/t3-model-manifest.json");
const LISTING: &[u8] = include_bytes!("../tests/fixtures/codex-app-server-model-list.jsonl");
const BUNDLE: &[u8] = include_bytes!("../../src/domain/codexModelManifest.json");

fn statuses(ids: &[&str]) -> CuratedCodexStatuses {
    CuratedCodexStatuses::try_from(ids.iter().map(|id| id.to_string()).collect::<Vec<_>>()).unwrap()
}

fn manifest(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut value: Value = serde_json::from_slice(UPSTREAM).unwrap();
    edit(&mut value);
    serde_json::to_vec(&value).unwrap()
}

fn codex_models(value: &mut Value) -> &mut Vec<Value> {
    value["providers"]["codex"]["models"]
        .as_array_mut()
        .unwrap()
}

fn legacy_ids(models: &[CodexCatalogModel]) -> Vec<&str> {
    models
        .iter()
        .filter(|model| model.status == CodexModelStatus::Legacy)
        .map(|model| model.id.as_str())
        .collect()
}

#[test]
fn upstream_snapshot_yields_exactly_the_curated_legacy_ids() {
    let parsed = parse_t3_codex_statuses(UPSTREAM).unwrap();
    assert_eq!(
        Vec::<String>::from(parsed),
        [
            "gpt-5.5",
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-6-sol"
        ]
    );
}

#[test]
fn curated_legacy_marks_listed_models_and_leaves_unknown_ones_untouched() {
    let mut models = parse_model_list(LISTING).unwrap().models;
    let upstream = models.clone();
    statuses(&["gpt-5.6-sol", "gpt-not-listed"]).apply(&mut models);
    assert_eq!(legacy_ids(&models), ["gpt-5.6-sol", "gpt-5.5"]);
    let marked = models
        .iter()
        .find(|model| model.id == "gpt-5.6-sol")
        .unwrap();
    assert_eq!(marked.upgrade_to, None);
    for (after, before) in models.iter().zip(&upstream) {
        assert_eq!(after.id, before.id);
        assert_eq!(after.upgrade_to, before.upgrade_to);
        assert_eq!(after.is_default, before.is_default);
    }
    CuratedCodexStatuses::default().apply(&mut models);
    assert_eq!(legacy_ids(&models), ["gpt-5.6-sol", "gpt-5.5"]);
}

#[test]
fn upstream_upgrade_stays_legacy_when_the_curated_list_says_current() {
    let curated = parse_t3_codex_statuses(&manifest(|value| {
        for model in codex_models(value) {
            model["status"] = json!("current");
        }
    }))
    .unwrap();
    assert_eq!(curated, CuratedCodexStatuses::default());
    let mut models = parse_model_list(LISTING).unwrap().models;
    curated.apply(&mut models);
    assert_eq!(legacy_ids(&models), ["gpt-5.5"]);
    let upgraded = models.iter().find(|model| model.id == "gpt-5.5").unwrap();
    assert_eq!(upgraded.upgrade_to.as_deref(), Some("gpt-5.6-sol"));
}

#[test]
fn default_model_is_never_legacy_from_the_curated_signal_alone() {
    let mut models = parse_model_list(LISTING).unwrap().models;
    statuses(&["gpt-6.1-sol", "gpt-6-astra"]).apply(&mut models);
    let default = models.iter().find(|model| model.is_default).unwrap();
    assert_eq!(default.id, "gpt-6.1-sol");
    assert_eq!(default.status, CodexModelStatus::Current);
    assert_eq!(legacy_ids(&models), ["gpt-6-astra", "gpt-5.5"]);
}

#[test]
fn bundled_fallback_already_matches_the_curated_snapshot() {
    let bundle = parse_catalog(BUNDLE).unwrap();
    assert_eq!(
        legacy_ids(&bundle.models),
        [
            "gpt-6-sol",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5"
        ]
    );
    let mut overlaid = bundle.clone();
    parse_t3_codex_statuses(UPSTREAM)
        .unwrap()
        .apply(&mut overlaid.models);
    assert_eq!(overlaid, bundle);
}

#[test]
fn fields_the_overlay_does_not_read_never_change_the_statuses() {
    let expected = parse_t3_codex_statuses(UPSTREAM).unwrap();
    let drifted = manifest(|value| {
        value["providers"]["codex"]["futureCapability"] = json!({"nested": [1, 2, 3]});
        value["providers"]["claudeAgent"] = json!("broken");
        for model in codex_models(value) {
            model["badge"] = json!("new");
            model["name"] = json!(42);
        }
    });
    assert_eq!(parse_t3_codex_statuses(&drifted).unwrap(), expected);
}

#[test]
fn missing_malformed_oversized_and_unknown_sections_are_rejected_whole() {
    let rejected: Vec<(&str, Vec<u8>)> = vec![
        ("not json", b"not json".to_vec()),
        ("oversized payload", vec![b' '; MAX_MANIFEST_BYTES + 1]),
        (
            "unknown envelope version",
            manifest(|value| value["version"] = json!(2)),
        ),
        (
            "missing section",
            manifest(|value| {
                value["providers"].as_object_mut().unwrap().remove("codex");
            }),
        ),
        (
            "section is not an object",
            manifest(|value| value["providers"]["codex"] = json!("gpt-6-sol")),
        ),
        (
            "models is not a list",
            manifest(|value| value["providers"]["codex"]["models"] = json!({})),
        ),
        ("no models", manifest(|value| codex_models(value).clear())),
        (
            "missing status",
            manifest(|value| {
                codex_models(value)[3]
                    .as_object_mut()
                    .unwrap()
                    .remove("status");
            }),
        ),
        (
            "unknown status",
            manifest(|value| codex_models(value)[3]["status"] = json!("deprecated")),
        ),
        (
            "status is not text",
            manifest(|value| codex_models(value)[3]["status"] = json!(true)),
        ),
        (
            "missing slug",
            manifest(|value| {
                codex_models(value)[3]
                    .as_object_mut()
                    .unwrap()
                    .remove("slug");
            }),
        ),
        (
            "unsafe slug",
            manifest(|value| codex_models(value)[3]["slug"] = json!("GPT 6 --sol")),
        ),
        (
            "oversized slug",
            manifest(|value| {
                codex_models(value)[3]["slug"] = json!("a".repeat(MAX_MODEL_ID_BYTES + 1))
            }),
        ),
        (
            "duplicate slug",
            manifest(|value| {
                let duplicate = json!({"slug": "gpt-6-sol", "name": "Again", "status": "current"});
                codex_models(value).push(duplicate);
            }),
        ),
        (
            "too many models",
            manifest(|value| {
                *codex_models(value) = (0..=MAX_CURATED_MODELS)
                    .map(|index| json!({"slug": format!("gpt-{index}"), "status": "legacy"}))
                    .collect();
            }),
        ),
    ];
    for (name, bytes) in rejected {
        assert!(parse_t3_codex_statuses(&bytes).is_err(), "accepted {name}");
    }
}

#[test]
fn stored_ids_round_trip_within_the_bound_and_reject_unsafe_input() {
    let curated = parse_t3_codex_statuses(UPSTREAM).unwrap();
    let stored = serde_json::to_string(&curated).unwrap();
    assert_eq!(
        serde_json::from_str::<CuratedCodexStatuses>(&stored).unwrap(),
        curated
    );
    let largest: Vec<String> = (0..MAX_CURATED_MODELS)
        .map(|index| format!("{index:0>width$}", width = MAX_MODEL_ID_BYTES))
        .collect();
    let stored = serde_json::to_string(&CuratedCodexStatuses::try_from(largest).unwrap()).unwrap();
    assert!(stored.len() <= MAX_CURATED_JSON_BYTES);
    let too_many: Vec<String> = (0..=MAX_CURATED_MODELS)
        .map(|index| format!("gpt-{index}"))
        .collect();
    for input in [
        json!(too_many),
        json!(["gpt-6-sol", "gpt-6-sol"]),
        json!(["GPT 6 --sol"]),
        json!(["a".repeat(MAX_MODEL_ID_BYTES + 1)]),
        json!([42]),
        json!({"legacy": ["gpt-6-sol"]}),
    ] {
        assert!(serde_json::from_value::<CuratedCodexStatuses>(input).is_err());
    }
}
