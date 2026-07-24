use super::MAX_CDP_OBJECT_ID_BYTES;
use serde_json::Value;

pub(super) fn ordinary_this_object_id(call_frame: &Value) -> Option<String> {
    call_frame
        .get("this")
        .filter(|value| value.get("type").and_then(Value::as_str) == Some("object"))
        .filter(|value| {
            value
                .get("subtype")
                .and_then(Value::as_str)
                .is_none_or(|subtype| subtype != "proxy" && !subtype.starts_with("internal#"))
        })
        .and_then(|value| value.get("objectId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= MAX_CDP_OBJECT_ID_BYTES)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_only_bounded_ordinary_object_receivers() {
        assert_eq!(
            ordinary_this_object_id(&json!({"this":{"type":"object","objectId":"receiver"}}))
                .as_deref(),
            Some("receiver")
        );
        let oversized = "x".repeat(MAX_CDP_OBJECT_ID_BYTES + 1);
        for call_frame in [
            json!({"this":{"type":"number","value":1}}),
            json!({}),
            json!({"this":{"type":"object","subtype":"proxy","objectId":"proxy"}}),
            json!({"this":{"type":"object","subtype":"internal#scope","objectId":"internal"}}),
            json!({"this":{"type":"object","objectId":""}}),
            json!({"this":{"type":"object","objectId":oversized}}),
        ] {
            assert_eq!(ordinary_this_object_id(&call_frame), None);
        }
    }
}
