use crate::agent_task_spawner::agent_provider::process::parse_provider_probe_json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_CREDITS: usize = 50;
const MAX_RAW_CREDITS: usize = 1000;
const MAX_ID_BYTES: usize = 256;
pub(super) const MAX_TITLE_BYTES: usize = 200;
const MAX_DESCRIPTION_BYTES: usize = 1000;
const MAX_EPOCH_MS: u64 = 8_640_000_000_000_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Credit {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub granted_at_epoch_ms: u64,
    pub expires_at_epoch_ms: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ChosenCredit {
    pub id: String,
    pub title: Option<String>,
}
pub(super) type Availability = (Option<u64>, Option<Vec<Credit>>);

pub(super) fn availability(stdout: &[u8]) -> Result<Availability, String> {
    let rates = stdout
        .split(|b| *b == b'\n')
        .filter_map(parse_provider_probe_json)
        .find(|v| v.get("id").and_then(Value::as_u64) == Some(1))
        .ok_or("Codex reset availability was unavailable.")?;
    let resets = &rates["result"]["rateLimitResetCredits"];
    Ok((
        count(&resets["availableCount"])?,
        credits(&resets["credits"])?,
    ))
}
fn count(value: &Value) -> Result<Option<u64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_u64()
        .filter(|count| *count <= 1_000_000)
        .map(Some)
        .ok_or_else(|| "Codex returned invalid reset availability.".into())
}
fn credits(value: &Value) -> Result<Option<Vec<Credit>>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let entries = value
        .as_array()
        .ok_or("Codex returned invalid reset credits.")?;
    let mut credits: Vec<Credit> = Vec::new();
    for entry in entries.iter().take(MAX_RAW_CREDITS) {
        if credits.len() == MAX_CREDITS {
            break;
        }
        let Some(credit) = credit(entry) else {
            continue;
        };
        if credits.iter().any(|known| known.id == credit.id) {
            continue;
        }
        credits.push(credit);
    }
    Ok(Some(credits))
}
fn credit(entry: &Value) -> Option<Credit> {
    if entry.get("status").and_then(Value::as_str) != Some("available") {
        return None;
    }
    let id = entry
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| credit_id(id))?;
    let expires_at_epoch_ms = match entry.get("expiresAt")? {
        Value::Null => None,
        seconds => Some(epoch_ms(seconds)?),
    };
    Some(Credit {
        id: id.to_string(),
        title: optional_text(entry.get("title"), MAX_TITLE_BYTES),
        description: optional_text(entry.get("description"), MAX_DESCRIPTION_BYTES),
        granted_at_epoch_ms: epoch_ms(entry.get("grantedAt")?)?,
        expires_at_epoch_ms,
    })
}
fn epoch_ms(seconds: &Value) -> Option<u64> {
    seconds
        .as_u64()?
        .checked_mul(1000)
        .filter(|ms| *ms <= MAX_EPOCH_MS)
}
fn optional_text(value: Option<&Value>, max_bytes: usize) -> Option<String> {
    let text = value?.as_str()?.trim();
    bounded_text(text, max_bytes).then(|| text.to_string())
}
pub(super) fn bounded_text(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
pub(super) fn credit_id(value: &str) -> bool {
    bounded_text(value, MAX_ID_BYTES)
}
pub(super) fn chosen(credits: Option<&[Credit]>, id: &str) -> Option<ChosenCredit> {
    credits?
        .iter()
        .find(|credit| credit.id == id)
        .map(|credit| ChosenCredit {
            id: credit.id.clone(),
            title: credit.title.clone(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn parse(resets: Value) -> Result<Availability, String> {
        availability(
            json!({"id":1,"result":{"rateLimitResetCredits":resets}})
                .to_string()
                .as_bytes(),
        )
    }
    fn entry(id: &str) -> Value {
        json!({"id":id,"resetType":"codexRateLimits","status":"available","grantedAt":10,"expiresAt":20,"title":"Full reset","description":null})
    }
    #[test]
    fn null_or_missing_credits_mean_only_the_count_is_known() {
        assert_eq!(parse(json!({"availableCount":2})), Ok((Some(2), None)));
        assert_eq!(
            parse(json!({"availableCount":2,"credits":null})),
            Ok((Some(2), None))
        );
        assert_eq!(
            parse(json!({"availableCount":0,"credits":[]})),
            Ok((Some(0), Some(Vec::new())))
        );
        assert!(parse(json!({"availableCount":1,"credits":"credit"})).is_err());
        assert!(parse(json!({"availableCount":1,"credits":{"id":"a"}})).is_err());
    }
    #[test]
    fn keeps_only_valid_available_credits_and_converts_seconds() {
        let mut redeemed = entry("redeemed");
        redeemed["status"] = json!("redeemed");
        let mut unknown = entry("unknown");
        unknown["status"] = json!("unknown");
        let mut never = entry("never");
        never["expiresAt"] = Value::Null;
        never["title"] = json!("  Spaced title  ");
        never["description"] = json!("Line\nbreak");
        let (_, credits) =
            parse(json!({"availableCount":3,"credits":[redeemed, unknown, entry("a"), never]}))
                .unwrap();
        assert_eq!(
            credits.unwrap(),
            vec![
                Credit {
                    id: "a".into(),
                    title: Some("Full reset".into()),
                    description: None,
                    granted_at_epoch_ms: 10_000,
                    expires_at_epoch_ms: Some(20_000),
                },
                Credit {
                    id: "never".into(),
                    title: Some("Spaced title".into()),
                    description: None,
                    granted_at_epoch_ms: 10_000,
                    expires_at_epoch_ms: None,
                },
            ]
        );
    }
    #[test]
    fn drops_malformed_overflowing_and_duplicate_entries() {
        let mut malformed = Vec::new();
        for (field, value) in [
            ("id", json!("")),
            ("id", json!(" padded")),
            ("id", json!("a\u{7}")),
            ("id", json!("x".repeat(257))),
            ("id", json!(7)),
            ("grantedAt", json!(-1)),
            ("grantedAt", json!(1.5)),
            ("grantedAt", Value::Null),
            ("grantedAt", json!(u64::MAX)),
            ("grantedAt", json!(8_640_000_000_001_u64)),
            ("expiresAt", json!(-5)),
            ("expiresAt", json!(i64::MAX)),
            ("expiresAt", json!("20")),
            ("expiresAt", json!(2.5)),
        ] {
            let mut credit = entry(&format!("bad-{}", malformed.len()));
            credit[field] = value;
            malformed.push(credit);
        }
        let mut no_granted = entry("no-granted");
        no_granted.as_object_mut().unwrap().remove("grantedAt");
        malformed.push(no_granted);
        let mut no_expiry = entry("no-expiry");
        no_expiry.as_object_mut().unwrap().remove("expiresAt");
        malformed.push(no_expiry);
        malformed.push(json!("credit"));
        let mut long_text = entry("long-text");
        long_text["title"] = json!("t".repeat(201));
        long_text["description"] = json!("d".repeat(1001));
        malformed.extend([entry("a"), entry("a"), long_text]);
        let credits = parse(json!({"availableCount":5,"credits":malformed}))
            .unwrap()
            .1
            .unwrap();
        assert_eq!(credits.len(), 2);
        assert_eq!(credits[0].id, "a");
        assert_eq!(credits[1].id, "long-text");
        assert_eq!(credits[1].title, None);
        assert_eq!(credits[1].description, None);
        let mut edge = entry("x".repeat(256).as_str());
        edge["grantedAt"] = json!(8_640_000_000_000_u64);
        let credits = parse(json!({"availableCount":1,"credits":[edge]}))
            .unwrap()
            .1
            .unwrap();
        assert_eq!(credits[0].granted_at_epoch_ms, MAX_EPOCH_MS);
    }
    #[test]
    fn caps_credits_and_bounds_the_scanned_array() {
        let many: Vec<_> = (0..80).map(|i| entry(&format!("c-{i}"))).collect();
        let credits = parse(json!({"availableCount":80,"credits":many}))
            .unwrap()
            .1
            .unwrap();
        assert_eq!(credits.len(), MAX_CREDITS);
        assert_eq!(credits[49].id, "c-49");
        let mut late: Vec<_> = (0..MAX_RAW_CREDITS).map(|_| json!(null)).collect();
        late.push(entry("late"));
        assert_eq!(
            parse(json!({"availableCount":1,"credits":late})).unwrap().1,
            Some(Vec::new())
        );
    }
    #[test]
    fn chosen_credit_must_be_in_the_fresh_list() {
        let credits = parse(json!({"availableCount":1,"credits":[entry("a")]}))
            .unwrap()
            .1;
        assert_eq!(
            chosen(credits.as_deref(), "a"),
            Some(ChosenCredit {
                id: "a".into(),
                title: Some("Full reset".into())
            })
        );
        assert_eq!(chosen(credits.as_deref(), "b"), None);
        assert_eq!(chosen(None, "a"), None);
    }
}
