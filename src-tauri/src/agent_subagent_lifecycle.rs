use serde_json::Value;
use std::collections::HashSet;

/// Closed bounded metadata shared by persisted turns and remote replay snapshots.
pub(crate) fn valid(value: &Value) -> bool {
    let Some(record) = value.as_object() else {
        return false;
    };
    if record.len() != 2 || !record.get("truncated").is_some_and(Value::is_boolean) {
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

pub(crate) fn optional<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    let value = <Value as serde::Deserialize>::deserialize(deserializer)?;
    if !valid(&value) {
        return Err(serde::de::Error::custom(
            "Invalid subagent lifecycle metadata",
        ));
    }
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> Value {
        json!({"entries":[{"id":"tool:t","toolId":"t","name":"Agent","description":"work","state":"interrupted","telemetryState":"interrupted"}],"truncated":false})
    }
    #[test]
    fn optional_field_roundtrips_and_rejects_explicit_null() {
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
        assert!(serde_json::from_value::<Turn>(json!({"lifecycle":null})).is_err());
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
}
