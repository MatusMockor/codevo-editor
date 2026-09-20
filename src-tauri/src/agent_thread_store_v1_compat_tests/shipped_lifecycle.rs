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
