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
                    | "nextCursor"
                    | "outputTruncatedBeforeSequence"
                    | "outputStartsAtLineBoundary"
            )
        }) && fields
            .get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| items.len() <= 50)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
