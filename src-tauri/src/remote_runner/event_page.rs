use serde_json::Value;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Bound the event page envelope before forwarding it to the strict event decoder.
/// The retention watermark and stdout boundary are an atomic optional pair.
pub(super) fn validate(page: Value) -> Result<Value, String> {
    let valid = page.as_object().is_some_and(|fields| {
        fields.keys().all(|key| {
            matches!(
                key.as_str(),
                "items"
                    | "subagentLifecycle"
                    | "nextCursor"
                    | "outputTruncatedBeforeSequence"
                    | "outputStartsAtLineBoundary"
            )
        }) && fields
            .get("subagentLifecycle")
            .is_none_or(crate::agent_subagent_lifecycle::valid)
            && fields
                .get("items")
                .and_then(Value::as_array)
                .is_some_and(|items| items.len() <= 50 && items.iter().all(validate_input_event))
            && fields.get("nextCursor").is_some_and(|cursor| {
                cursor.is_null() || cursor.as_u64().is_some_and(|n| n <= MAX_SAFE_INTEGER)
            })
            && match (
                fields.get("outputTruncatedBeforeSequence"),
                fields.get("outputStartsAtLineBoundary"),
            ) {
                (None, None) => true,
                (Some(sequence), Some(boundary)) => {
                    sequence
                        .as_u64()
                        .is_some_and(|n| (1..=MAX_SAFE_INTEGER).contains(&n))
                        && boundary.is_boolean()
                }
                _ => false,
            }
    });
    if valid {
        Ok(page)
    } else {
        Err("Invalid runner event page response".into())
    }
}

// Input events carry user intent; validate their closed shape before crossing IPC.
fn validate_input_event(value: &Value) -> bool {
    if value.get("type").and_then(Value::as_str) != Some("task.input") {
        return true;
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct InputEvent {
        sequence: u64,
        task_id: String,
        #[serde(rename = "type")]
        kind: String,
        created_at: String,
        message_id: String,
        parts: Vec<super::types::Part>,
    }
    let Ok(event) = serde_json::from_value::<InputEvent>(value.clone()) else {
        return false;
    };
    event.kind == "task.input"
        && (1..=MAX_SAFE_INTEGER).contains(&event.sequence)
        && super::types::uuid(&event.task_id).is_ok()
        && super::types::uuid(&event.message_id).is_ok()
        && event.created_at.len() <= 64
        && event.created_at.len() >= 20
        && event.created_at.is_ascii()
        && event.created_at.as_bytes().get(10) == Some(&b'T')
        && !event.created_at.chars().any(char::is_control)
        && super::types::validate_parts(&event.parts).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shared_lifecycle_snapshot_is_optional_and_strict() {
        let valid = json!({"items":[],"nextCursor":null,"subagentLifecycle":{"entries":[],"truncated":false}});
        assert!(validate(valid.clone()).is_ok());
        for invalid in [
            Value::Null,
            json!({"entries":[],"truncated":false,"unknown":true}),
        ] {
            let mut page = valid.clone();
            page["subagentLifecycle"] = invalid;
            assert!(validate(page).is_err());
        }
    }
    #[test]
    fn input_event_requires_bounded_closed_parts_and_identity() {
        let event = json!({"sequence":1,"taskId":"7389088c-29b8-4cec-9a15-e825e1fb2f66",
            "type":"task.input","createdAt":"2026-09-18T00:00:00.000Z",
            "messageId":"7389088c-29b8-4cec-9a15-e825e1fb2f66",
            "parts":[{"type":"text","text":"Change direction"}]});
        assert!(validate(json!({"items":[event.clone()],"nextCursor":null})).is_ok());
        for field in ["taskId", "messageId", "createdAt", "parts", "unexpected"] {
            let mut invalid = event.clone();
            invalid[field] = json!("invalid");
            assert!(validate(json!({"items":[invalid],"nextCursor":null})).is_err());
        }
    }

    #[test]
    fn accepts_legacy_and_retention_metadata_without_rewriting_it() {
        for page in [
            json!({"items": [], "nextCursor": null}),
            json!({"items": [], "nextCursor": 7, "outputTruncatedBeforeSequence": 9, "outputStartsAtLineBoundary": false}),
            json!({"items": [], "nextCursor": null, "outputTruncatedBeforeSequence": MAX_SAFE_INTEGER, "outputStartsAtLineBoundary": true}),
        ] {
            assert_eq!(validate(page.clone()).unwrap(), page);
        }
    }

    #[test]
    fn rejects_invalid_incomplete_or_unknown_metadata() {
        let valid = json!({"items": [], "nextCursor": null, "outputTruncatedBeforeSequence": 9, "outputStartsAtLineBoundary": true});
        for value in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!(MAX_SAFE_INTEGER + 1),
            Value::Null,
            json!("9"),
        ] {
            let mut page = valid.clone();
            page["outputTruncatedBeforeSequence"] = value;
            assert!(validate(page).is_err());
        }
        for value in [Value::Null, json!(0), json!("true")] {
            let mut page = valid.clone();
            page["outputStartsAtLineBoundary"] = value;
            assert!(validate(page).is_err());
        }
        for key in [
            "outputTruncatedBeforeSequence",
            "outputStartsAtLineBoundary",
            "items",
            "nextCursor",
        ] {
            let mut page = valid.clone();
            page.as_object_mut().unwrap().remove(key);
            assert!(validate(page).is_err());
        }
        let mut page = valid;
        page["unexpected"] = json!(true);
        assert!(validate(page).is_err());
    }
}
