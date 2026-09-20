use serde_json::Value;
use std::collections::HashSet;

const MAX_TASK_TITLE_BYTES: usize = 480;
const MAX_BATCH_KEY_BYTES: usize = 272;
const MAX_PARENT_TOOL_ID_BYTES: usize = 256;
const MAX_NESTED_COUNT: u64 = 999;
const MAX_COUNTED_NESTED_IDS: usize = 32;

/// Closed bounded metadata shared by persisted turns and remote replay snapshots.
pub(crate) fn valid(value: &Value) -> bool {
    let Some(record) = value.as_object() else {
        return false;
    };
    if record.keys().any(|key| {
        !matches!(
            key.as_str(),
            "entries" | "truncated" | "openBatchKey" | "countedNestedToolIds"
        )
    }) || !record.get("truncated").is_some_and(Value::is_boolean)
    {
        return false;
    }
    if record.contains_key("openBatchKey")
        && !record
            .get("openBatchKey")
            .and_then(Value::as_str)
            .is_some_and(|key| !key.is_empty() && key.len() <= MAX_BATCH_KEY_BYTES)
    {
        return false;
    }
    if record.contains_key("countedNestedToolIds")
        && !valid_counted_nested_ids(&record["countedNestedToolIds"])
    {
        return false;
    }
    let Some(entries) = record.get("entries").and_then(Value::as_array) else {
        return false;
    };
    if entries.len() > 32 {
        return false;
    }
    let mut seen = HashSet::new();
    let mut aliases = HashSet::new();
    for entry in entries {
        let Some(fields) = entry.as_object() else {
            return false;
        };
        if fields.keys().any(|key| {
            !matches!(
                key.as_str(),
                "id" | "toolId"
                    | "taskId"
                    | "agentThreadId"
                    | "name"
                    | "description"
                    | "state"
                    | "telemetryState"
                    | "resultState"
                    | "durationMs"
                    | "totalTokens"
                    | "steps"
                    | "lastToolName"
                    | "taskTitle"
                    | "batchKey"
                    | "nestedCount"
                    | "parentToolId"
            )
        }) {
            return false;
        }
        let text = |key: &str, max: usize| {
            fields
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| s.len() <= max)
        };
        let Some(id) = text("id", 272).filter(|s| !s.is_empty()) else {
            return false;
        };
        if !seen.insert(id) || text("name", 128).is_none() || text("description", 512).is_none() {
            return false;
        }
        let mut identified = false;
        for key in ["toolId", "taskId", "agentThreadId"] {
            if fields.contains_key(key) {
                let Some(identity) = text(key, 256).filter(|s| !s.is_empty()) else {
                    return false;
                };
                if !aliases.insert((key, identity)) {
                    return false;
                }
                identified = true;
            }
        }
        if !identified {
            return false;
        }
        for key in ["durationMs", "totalTokens", "steps"] {
            if fields.contains_key(key)
                && fields[key]
                    .as_u64()
                    .is_none_or(|v| v > 9_007_199_254_740_991)
            {
                return false;
            }
        }
        if fields.contains_key("lastToolName") && text("lastToolName", 128).is_none() {
            return false;
        }
        for (key, max) in [
            ("taskTitle", MAX_TASK_TITLE_BYTES),
            ("batchKey", MAX_BATCH_KEY_BYTES),
            ("parentToolId", MAX_PARENT_TOOL_ID_BYTES),
        ] {
            if fields.contains_key(key) && text(key, max).is_none_or(str::is_empty) {
                return false;
            }
        }
        if fields.contains_key("nestedCount")
            && fields["nestedCount"]
                .as_u64()
                .is_none_or(|count| !(1..=MAX_NESTED_COUNT).contains(&count))
        {
            return false;
        }
        let state = |key| fields.get(key).and_then(Value::as_str);
        for key in ["state", "telemetryState"] {
            if (key == "state" || fields.contains_key(key))
                && !matches!(
                    state(key),
                    Some("running" | "completed" | "failed" | "interrupted")
                )
            {
                return false;
            }
        }
        if fields.contains_key("resultState")
            && !matches!(state("resultState"), Some("completed" | "failed"))
        {
            return false;
        }
        let expected = if state("telemetryState") == Some("failed")
            || state("resultState") == Some("failed")
        {
            "failed"
        } else {
            state("telemetryState")
                .or_else(|| state("resultState"))
                .unwrap_or("running")
        };
        if state("state") != Some(expected) {
            return false;
        }
    }
    true
}

const RETAINED_ENTRY_KEYS: [&str; 4] = ["taskTitle", "batchKey", "nestedCount", "parentToolId"];

pub(crate) fn valid_legacy(value: &Value) -> bool {
    valid(value) && !carries_retained_detail(value)
}

fn carries_retained_detail(value: &Value) -> bool {
    let Some(record) = value.as_object() else {
        return true;
    };
    if record.len() != 2 {
        return true;
    }
    let Some(entries) = record.get("entries").and_then(Value::as_array) else {
        return true;
    };
    entries.iter().any(|entry| {
        entry.as_object().is_none_or(|fields| {
            RETAINED_ENTRY_KEYS
                .iter()
                .any(|key| fields.contains_key(*key))
        })
    })
}

fn valid_counted_nested_ids(value: &Value) -> bool {
    let Some(ids) = value.as_array() else {
        return false;
    };
    if ids.is_empty() || ids.len() > MAX_COUNTED_NESTED_IDS {
        return false;
    }
    let mut seen = HashSet::new();
    ids.iter().all(|id| {
        id.as_str()
            .is_some_and(|id| !id.is_empty() && id.len() <= 256 && seen.insert(id))
    })
}

pub(crate) fn optional<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    let value = <Value as serde::Deserialize>::deserialize(deserializer)?;
    Ok(valid(&value).then_some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> Value {
        json!({"entries":[{"id":"tool:t","toolId":"t","name":"Agent","description":"work","state":"interrupted","telemetryState":"interrupted"}],"truncated":false})
    }
    #[test]
    fn optional_field_roundtrips_and_drops_unreadable_shapes() {
        #[derive(serde::Deserialize, serde::Serialize)]
        struct Turn {
            #[serde(
                default,
                skip_serializing_if = "Option::is_none",
                deserialize_with = "optional"
            )]
            lifecycle: Option<Value>,
        }
        let legacy: Turn = serde_json::from_value(json!({})).unwrap();
        assert!(legacy.lifecycle.is_none());
        let input = json!({"lifecycle":fixture()});
        let turn: Turn = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(turn).unwrap(), input);
        let mut additive = fixture();
        additive["entries"][0]["unknownEntryKey"] = json!(true);
        for dropped in [json!(null), json!("nonsense"), additive] {
            let turn: Turn = serde_json::from_value(json!({"lifecycle":dropped})).unwrap();
            assert!(turn.lifecycle.is_none());
        }
    }
    #[test]
    fn metadata_is_closed_bounded_and_coherent() {
        assert!(valid(&fixture()));
        assert!(valid(&json!({"entries":[],"truncated":true})));
        for key in [
            "state",
            "telemetryState",
            "resultState",
            "unknown",
            "durationMs",
        ] {
            let mut v = fixture();
            v["entries"][0][key] = json!("invalid");
            assert!(!valid(&v));
        }
        let mut v = fixture();
        v["entries"][0]["state"] = json!("completed");
        assert!(!valid(&v));
        let mut v = fixture();
        v["entries"][0]["name"] = json!("é".repeat(65));
        assert!(!valid(&v));
        let mut v = fixture();
        v["entries"] = json!(vec![v["entries"][0].clone(); 33]);
        assert!(!valid(&v));
        let mut v = fixture();
        let mut duplicate = v["entries"][0].clone();
        duplicate["id"] = json!("different");
        v["entries"].as_array_mut().unwrap().push(duplicate);
        assert!(!valid(&v));
        assert!(!valid(&Value::Null));
    }
    #[test]
    fn the_v1_shape_refuses_every_retained_key_and_anything_invalid() {
        let wire: Value = serde_json::from_str(WIRE).unwrap();
        let legacy = &wire["valid"]["legacy"];
        assert!(valid_legacy(legacy));
        assert!(valid(&wire["valid"]["retained"]));
        assert!(!valid_legacy(&wire["valid"]["retained"]));
        for (key, value) in [
            ("taskTitle", json!("Review the slice")),
            ("batchKey", json!("spawn:toolu_legacy_a")),
            ("nestedCount", json!(1)),
            ("parentToolId", json!("toolu_parent")),
        ] {
            let mut entry_patched = legacy.clone();
            entry_patched["entries"][0][key] = value;
            assert!(valid(&entry_patched), "{key}");
            assert!(!valid_legacy(&entry_patched), "{key}");
        }
        for (key, value) in [
            ("openBatchKey", json!("spawn:toolu_legacy_a")),
            ("countedNestedToolIds", json!(["toolu_overflow"])),
        ] {
            let mut root_patched = legacy.clone();
            root_patched[key] = value;
            assert!(valid(&root_patched), "{key}");
            assert!(!valid_legacy(&root_patched), "{key}");
        }
        let mut incoherent = legacy.clone();
        incoherent["entries"][0]["state"] = json!("running");
        assert!(!valid_legacy(&incoherent));
        assert!(!valid_legacy(&Value::Null));
    }
    const WIRE: &str = include_str!("../../contracts/agent-subagent-lifecycle-wire.json");
    fn patched(mut target: Value, patch: &Value) -> Value {
        for (key, value) in patch.as_object().unwrap() {
            target[key.as_str()] = value.clone();
        }
        target
    }
    #[test]
    fn shared_wire_contract_roundtrips_and_rejects_invalid_patches() {
        #[derive(serde::Deserialize, serde::Serialize)]
        struct Turn {
            #[serde(
                default,
                skip_serializing_if = "Option::is_none",
                deserialize_with = "optional"
            )]
            lifecycle: Option<Value>,
        }
        let wire: Value = serde_json::from_str(WIRE).unwrap();
        assert_eq!(wire["limits"]["entries"], json!(32));
        assert_eq!(
            wire["limits"]["taskTitleBytes"],
            json!(MAX_TASK_TITLE_BYTES)
        );
        assert_eq!(wire["limits"]["batchKeyBytes"], json!(MAX_BATCH_KEY_BYTES));
        assert_eq!(
            wire["limits"]["parentToolIdBytes"],
            json!(MAX_PARENT_TOOL_ID_BYTES)
        );
        assert_eq!(wire["limits"]["nestedCount"], json!(MAX_NESTED_COUNT));
        assert_eq!(
            wire["limits"]["countedNestedToolIds"],
            json!(MAX_COUNTED_NESTED_IDS)
        );
        assert_eq!(
            wire["limits"].as_object().map(serde_json::Map::len),
            Some(6)
        );
        for name in ["legacy", "retained"] {
            let input = json!({"lifecycle": wire["valid"][name]});
            let turn: Turn = serde_json::from_value(input.clone()).unwrap();
            assert_eq!(serde_json::to_value(turn).unwrap(), input, "{name}");
        }
        let retained = &wire["valid"]["retained"];
        let dropped = |value: &Value| {
            serde_json::from_value::<Turn>(json!({"lifecycle":value}))
                .unwrap()
                .lifecycle
                .is_none()
        };
        for patch in wire["invalidEntryPatches"].as_array().unwrap() {
            let mut value = retained.clone();
            value["entries"][0] = patched(value["entries"][0].clone(), patch);
            assert!(!valid(&value), "{patch}");
            assert!(dropped(&value), "{patch}");
        }
        for patch in wire["invalidRootPatches"].as_array().unwrap() {
            let value = patched(retained.clone(), patch);
            assert!(!valid(&value), "{patch}");
            assert!(dropped(&value), "{patch}");
        }
    }
}
