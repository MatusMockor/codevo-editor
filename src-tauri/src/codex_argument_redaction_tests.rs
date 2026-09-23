use super::redaction::{
    is_secret_key, key_segments, redact_arguments, MAX_REDACTION_DEPTH, MAX_REDACTION_NODES,
    MAX_REDACTION_STRING_BYTES, SECRET_SEGMENT_MARKERS, SECRET_SUFFIX_MARKERS,
};
use serde_json::Value;
use std::path::PathBuf;

fn fixture() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("codex_app_server")
        .join("argument_redaction.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()));
    serde_json::from_str(&text).expect("redaction fixture must be JSON")
}

#[test]
fn the_redaction_contract_matches_the_shared_fixture() {
    let fixture = fixture();
    let markers = |name: &str| {
        fixture[name]
            .as_array()
            .expect("markers")
            .iter()
            .map(|marker| marker.as_str().expect("marker").to_string())
            .collect::<Vec<_>>()
    };

    assert_eq!(markers("segmentMarkers"), SECRET_SEGMENT_MARKERS);
    assert_eq!(markers("suffixMarkers"), SECRET_SUFFIX_MARKERS);
    assert_eq!(fixture["maxDepth"], MAX_REDACTION_DEPTH);
    assert_eq!(fixture["maxNodes"], MAX_REDACTION_NODES);
    assert_eq!(fixture["maxStringBytes"], MAX_REDACTION_STRING_BYTES);
}

#[test]
fn every_shared_fixture_case_redacts_identically() {
    let fixture = fixture();
    for case in fixture["cases"].as_array().expect("cases") {
        let redacted = redact_arguments(&case["input"]);

        assert_eq!(redacted.value, case["expected"], "case {}", case["name"]);
    }
}

#[test]
fn node_budget_exhaustion_is_reported() {
    let wide = Value::Array((0..1_000).map(Value::from).collect());

    assert!(redact_arguments(&wide).exhausted);
    assert!(!redact_arguments(&serde_json::json!({ "a": 1 })).exhausted);
}

#[test]
fn keys_are_split_into_camel_snake_kebab_and_dot_segments() {
    assert_eq!(
        key_segments("X-Private_Key.v2"),
        vec!["x", "private", "key", "v2"]
    );
    assert_eq!(key_segments("OAuthToken"), vec!["o", "auth", "token"]);
    assert_eq!(key_segments("APIKey"), vec!["api", "key"]);
    assert!(key_segments("--").is_empty());
    assert!(!is_secret_key(""));
    assert!(is_secret_key("clientSecret"));
}
