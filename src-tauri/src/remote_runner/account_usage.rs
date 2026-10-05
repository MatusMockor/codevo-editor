//! Account-wide usage from the exact selected runner, without returning credentials.
use super::{
    commands::blocking, project_management::call_lease, service::RemoteRunnerState, types::id,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const INVALID: &str = "Invalid runner account usage";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountUsageRequest {
    server_id: String,
    runner_id: String,
    provider: Provider,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Provider {
    Claude,
    Codex,
}
impl Provider {
    fn path(self) -> &'static str {
        match self {
            Self::Claude => "/v1/account-usage/claude",
            Self::Codex => "/v1/account-usage/codex",
        }
    }
    fn snapshot_name(self) -> &'static str {
        match self {
            Self::Claude => "claudeCode",
            Self::Codex => "codex",
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountUsageSnapshot {
    provider: String,
    fetched_at_epoch_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account_identity: Option<String>,
    windows: Vec<UsageWindow>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsageWindow {
    id: String,
    label: String,
    used_percent: f64,
    #[serde(deserialize_with = "nullable")]
    window_duration_minutes: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    resets_at_epoch_ms: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    resets_label: Option<String>,
}
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn account_identity(value: &str) -> bool {
    value
        .strip_prefix("account:v1:sha256:")
        .is_some_and(|digest| {
            digest.len() == 64
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}
fn validate(value: Value, provider: Provider) -> Result<AccountUsageSnapshot, String> {
    let snapshot: AccountUsageSnapshot = serde_json::from_value(value).map_err(|_| INVALID)?;
    if snapshot.provider != provider.snapshot_name()
        || snapshot.fetched_at_epoch_ms > MAX_SAFE_INTEGER
        || snapshot.windows.is_empty()
        || snapshot.windows.len() > 12
    {
        return Err(INVALID.into());
    }
    if snapshot
        .account_identity
        .as_ref()
        .is_some_and(|value| !account_identity(value))
    {
        return Err(INVALID.into());
    }
    let mut ids = std::collections::HashSet::new();
    for window in &snapshot.windows {
        if !text(&window.id, 160)
            || !ids.insert(&window.id)
            || !text(&window.label, 160)
            || !window.used_percent.is_finite()
            || !(0.0..=100.0).contains(&window.used_percent)
            || window
                .window_duration_minutes
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
            || window
                .resets_at_epoch_ms
                .is_some_and(|value| value > MAX_SAFE_INTEGER)
            || window
                .resets_label
                .as_ref()
                .is_some_and(|value| !text(value, 200))
        {
            return Err(INVALID.into());
        }
    }
    Ok(snapshot)
}
fn admit_descriptor(descriptor: Value, expected_runner: &str) -> Result<(), String> {
    if super::descriptor::validate(descriptor.clone())? != expected_runner {
        return Err("Server connection changed during request".into());
    }
    if descriptor
        .get("capabilities")
        .and_then(|caps| caps.get("accountUsage"))
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(
            "The server runner does not support account usage. Update the runner on the server."
                .into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn remote_runner_get_account_usage(
    state: tauri::State<'_, RemoteRunnerState>,
    request: AccountUsageRequest,
) -> Result<AccountUsageSnapshot, String> {
    id(&request.server_id)?;
    if !text(&request.runner_id, 128) {
        return Err("Invalid runner identity".into());
    }
    let lease = state.connection_lease(&request.server_id)?;
    if lease.runner_id() != request.runner_id {
        return Err("Server connection changed during request".into());
    }
    blocking(move || {
        let descriptor = call_lease(lease.clone(), "GET", "/v1/runner", None)?;
        admit_descriptor(descriptor, lease.runner_id())?;
        validate(
            call_lease(lease, "GET", request.provider.path(), None)?,
            request.provider,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Value {
        serde_json::json!({"provider":"codex","fetchedAtEpochMs":123,"windows":[{"id":"codex-primary","label":"5-hour limit","usedPercent":12,"windowDurationMinutes":300,"resetsAtEpochMs":456,"resetsLabel":null}]})
    }
    #[test]
    fn validates_closed_bounded_account_usage_and_provider() {
        assert!(validate(snapshot(), Provider::Codex).is_ok());
        assert!(validate(snapshot(), Provider::Claude).is_err());
        let mut identified = snapshot();
        identified["accountIdentity"] =
            Value::from(format!("account:v1:sha256:{}", "a".repeat(64)));
        assert!(validate(identified, Provider::Codex).is_ok());
        for (field, value) in [
            ("unknown", Value::Bool(true)),
            ("fetchedAtEpochMs", Value::from(MAX_SAFE_INTEGER + 1)),
            ("accountIdentity", Value::Bool(true)),
            ("accountIdentity", Value::from("foreign")),
        ] {
            let mut item = snapshot();
            item[field] = value;
            assert!(validate(item, Provider::Codex).is_err());
        }
        for (field, value) in [
            ("usedPercent", Value::from(101)),
            ("resetsLabel", Value::from("x".repeat(201))),
            ("id", Value::from("bad\nlabel")),
        ] {
            let mut item = snapshot();
            item["windows"][0][field] = value;
            assert!(validate(item, Provider::Codex).is_err());
        }
        let mut duplicate = snapshot();
        duplicate["windows"] =
            serde_json::json!([duplicate["windows"][0], duplicate["windows"][0]]);
        assert!(validate(duplicate, Provider::Codex).is_err());
        let mut missing = snapshot();
        missing["windows"][0]
            .as_object_mut()
            .unwrap()
            .remove("resetsLabel");
        assert!(validate(missing, Provider::Codex).is_err());
    }
    #[test]
    fn only_valid_supported_exact_runner_descriptors_admit_usage() {
        let base = serde_json::json!({"protocolVersion":1,"runnerId":"expected","name":"Server","capabilities":{"taskExecution":true,"eventReplay":true,"accountUsage":true}});
        assert!(admit_descriptor(base.clone(), "expected").is_ok());
        assert!(admit_descriptor(base.clone(), "foreign").is_err());
        for (field, value) in [
            ("protocolVersion", Value::from(2)),
            ("unknown", Value::Bool(true)),
        ] {
            let mut invalid = base.clone();
            invalid[field] = value;
            assert!(admit_descriptor(invalid, "expected").is_err());
        }
        for value in [Value::Bool(false), Value::Null, Value::from("true")] {
            let mut unsupported = base.clone();
            unsupported["capabilities"]["accountUsage"] = value;
            assert!(admit_descriptor(unsupported, "expected").is_err());
        }
    }
    #[test]
    fn requests_reject_unknown_fields_and_arbitrary_provider() {
        for request in [
            serde_json::json!({"serverId":"pc","runnerId":"r","provider":"openai"}),
            serde_json::json!({"serverId":"pc","runnerId":"r","provider":"codex","command":"id"}),
        ] {
            assert!(serde_json::from_value::<AccountUsageRequest>(request).is_err());
        }
    }
}
