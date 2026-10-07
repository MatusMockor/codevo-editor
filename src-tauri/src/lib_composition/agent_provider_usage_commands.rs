use crate::agent_task_spawner::agent_provider::agent_cli_version::now_epoch_ms;
use crate::agent_task_spawner::agent_provider::process::{
    execute_agent_provider_plan_cancellable, parse_provider_probe_json, AgentProviderProcessIntent,
    AgentProviderProcessPlan,
};
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry;
use crate::agent_task_spawner::AgentCliInvocation;
use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

#[path = "agent_usage_account_identity.rs"]
mod account_identity;

const MAX_USAGE_WINDOWS: usize = 12;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentProviderUsageRequest {
    provider: AgentCliInvocation,
    provider_generation: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderUsageSnapshot {
    provider: AgentCliInvocation,
    account_identity: Option<String>,
    fetched_at_epoch_ms: u64,
    windows: Vec<AgentProviderUsageWindow>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderUsageWindow {
    id: String,
    label: String,
    used_percent: f64,
    window_duration_minutes: Option<u64>,
    resets_at_epoch_ms: Option<u64>,
    resets_label: Option<String>,
}

#[tauri::command]
pub(crate) async fn read_agent_provider_usage(
    request: AgentProviderUsageRequest,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<AgentProviderUsageSnapshot, String> {
    let provider_registry = Arc::clone(&provider_registry);
    run_blocking_command(move || {
        let lease = provider_registry
            .acquire_account_usage_for_generation(request.provider, request.provider_generation)?;
        provider_registry.revalidate_health(&lease)?;
        let read_claude_identity = || -> Result<Option<String>, String> {
            provider_registry.revalidate_health(&lease)?;
            let auth_plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
                lease.cli_identity.clone(),
                AgentProviderProcessIntent::AuthenticationStatus(AgentCliInvocation::ClaudeCode),
                &lease.effective_path,
            )?;
            let output = execute_agent_provider_plan_cancellable(&auth_plan, || false);
            provider_registry.revalidate_health(&lease)?;
            Ok(output
                .ok()
                .and_then(|output| account_identity::claude_identity(&output.stdout)))
        };
        let before = match request.provider {
            AgentCliInvocation::ClaudeCode => read_claude_identity()?,
            AgentCliInvocation::CodexExec => None,
        };
        provider_registry.revalidate_health(&lease)?;
        let plan = AgentProviderProcessPlan::provider_owned_with_effective_path(
            lease.cli_identity.clone(),
            AgentProviderProcessIntent::AccountUsage(request.provider),
            &lease.effective_path,
        )?;
        let output = execute_agent_provider_plan_cancellable(&plan, || false)
            .map_err(|_| "Provider account usage could not be read.".to_string())?;
        provider_registry.revalidate_health(&lease)?;
        let identity = match request.provider {
            AgentCliInvocation::ClaudeCode => {
                account_identity::stable_identity(before, read_claude_identity()?)
            }
            AgentCliInvocation::CodexExec => account_identity::codex_identity(&output.stdout),
        };
        provider_registry.revalidate_health(&lease)?;
        let windows = match request.provider {
            AgentCliInvocation::ClaudeCode => parse_claude_usage(&output.stdout)?,
            AgentCliInvocation::CodexExec => parse_codex_usage(&output.stdout)?,
        };
        Ok(AgentProviderUsageSnapshot {
            provider: request.provider,
            account_identity: identity,
            fetched_at_epoch_ms: now_epoch_ms(),
            windows,
        })
    })
    .await
}

fn parse_claude_usage(stdout: &[u8]) -> Result<Vec<AgentProviderUsageWindow>, String> {
    let envelope = parse_provider_probe_json(stdout)
        .ok_or_else(|| "Claude usage returned an invalid response.".to_string())?;
    let result = envelope
        .get("result")
        .and_then(Value::as_str)
        .ok_or_else(|| "Claude usage was unavailable.".to_string())?;
    let mut windows = Vec::new();
    for line in result.lines().map(str::trim) {
        let Some((label, detail)) = line.split_once(':') else {
            continue;
        };
        if !label.starts_with("Current session") && !label.starts_with("Current week") {
            continue;
        }
        let Some((percent, reset)) = detail.trim().split_once("% used · resets ") else {
            continue;
        };
        let Ok(used_percent) = percent.trim().parse::<f64>() else {
            continue;
        };
        if !used_percent.is_finite() || !(0.0..=100.0).contains(&used_percent) {
            continue;
        }
        let Some((id, display_label, duration)) = claude_usage_window_identity(label.trim()) else {
            continue;
        };
        windows.push(AgentProviderUsageWindow {
            id: id.to_string(),
            label: display_label.to_string(),
            used_percent,
            window_duration_minutes: duration,
            resets_at_epoch_ms: None,
            resets_label: Some(reset.trim().to_string()),
        });
    }
    if windows.is_empty() {
        return Err("Claude usage did not include account limit windows.".to_string());
    }
    validate_usage_windows(&windows)?;
    Ok(windows)
}

fn claude_usage_window_identity(label: &str) -> Option<(&str, &str, Option<u64>)> {
    Some(match label {
        "Current session" => ("five_hour", "5-hour limit", Some(300)),
        "Current week (all models)" => ("seven_day", "Weekly limit", Some(10_080)),
        "Current week (Fable)" => ("seven_day_fable", "Weekly Fable limit", Some(10_080)),
        "Current week (Opus)" => ("seven_day_opus", "Weekly Opus limit", Some(10_080)),
        "Current week (Sonnet)" => ("seven_day_sonnet", "Weekly Sonnet limit", Some(10_080)),
        _ => return None,
    })
}

fn parse_codex_usage(stdout: &[u8]) -> Result<Vec<AgentProviderUsageWindow>, String> {
    let response = stdout
        .split(|byte| *byte == b'\n')
        .filter_map(parse_provider_probe_json)
        .find(|value| value.get("id") == Some(&Value::from(1)))
        .ok_or_else(|| "Codex usage was unavailable.".to_string())?;
    let result = response
        .get("result")
        .ok_or_else(|| "Codex usage was unavailable.".to_string())?;
    let mut windows = Vec::new();
    if let Some(buckets) = result.get("rateLimitsByLimitId").and_then(Value::as_object) {
        for (bucket_id, bucket) in buckets {
            append_codex_bucket(&mut windows, bucket_id, bucket)?;
        }
    } else if let Some(bucket) = result.get("rateLimits") {
        append_codex_bucket(&mut windows, "codex", bucket)?;
    }
    if windows.is_empty() {
        return Err("Codex usage did not include account limit windows.".to_string());
    }
    validate_usage_windows(&windows)?;
    Ok(windows)
}

fn append_codex_bucket(
    windows: &mut Vec<AgentProviderUsageWindow>,
    id: &str,
    bucket: &Value,
) -> Result<(), String> {
    let name = bucket
        .get("limitName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Codex");
    for (kind, suffix) in [("primary", "primary"), ("secondary", "secondary")] {
        let Some(window) = bucket.get(kind).filter(|value| !value.is_null()) else {
            continue;
        };
        let Some(used_percent) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        if !used_percent.is_finite() || !(0.0..=100.0).contains(&used_percent) {
            return Err("Codex usage returned an invalid limit window.".to_string());
        }
        let duration = window.get("windowDurationMins").and_then(Value::as_u64);
        let resets_at_epoch_ms = window
            .get("resetsAt")
            .and_then(Value::as_u64)
            .and_then(|value| value.checked_mul(1_000));
        windows.push(AgentProviderUsageWindow {
            id: format!("{id}-{suffix}"),
            label: format!("{name} · {}", duration.map(window_label).unwrap_or("Limit")),
            used_percent,
            window_duration_minutes: duration,
            resets_at_epoch_ms,
            resets_label: None,
        });
    }
    Ok(())
}

fn validate_usage_windows(windows: &[AgentProviderUsageWindow]) -> Result<(), String> {
    let text = |value: &str, limit| {
        !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
    };
    let mut ids = std::collections::HashSet::new();
    if windows.is_empty()
        || windows.len() > MAX_USAGE_WINDOWS
        || windows.iter().any(|window| {
            !text(&window.id, 160)
                || !text(&window.label, 160)
                || !ids.insert(&window.id)
                || window
                    .resets_label
                    .as_ref()
                    .is_some_and(|value| !text(value, 200))
                || window
                    .window_duration_minutes
                    .is_some_and(|value| value > 9_007_199_254_740_991)
                || window
                    .resets_at_epoch_ms
                    .is_some_and(|value| value > 9_007_199_254_740_991)
        })
    {
        return Err("Provider usage returned invalid or excessive limit windows.".to_string());
    }
    Ok(())
}

fn window_label(minutes: u64) -> &'static str {
    match minutes {
        300 => "5-hour limit",
        10_080 => "Weekly limit",
        _ => "Usage limit",
    }
}

#[cfg(test)]
#[path = "agent_provider_usage_authority_tests.rs"]
mod authority_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_and_control_bearing_claude_limit_windows() {
        for result in ["Current session: 1% used · resets tomorrow\nCurrent session: 2% used · resets tomorrow", "Current session: 1% used · resets to\u{007f}morrow"] {
            let output = serde_json::json!({"result":result}).to_string();
            assert!(parse_claude_usage(output.as_bytes()).is_err());
        }
    }
    #[test]
    fn rejects_codex_out_of_range_and_excessive_limit_windows() {
        let bad = br#"{"id":1,"result":{"rateLimits":{"primary":{"usedPercent":101}}}}"#;
        assert!(parse_codex_usage(bad).is_err());
        let buckets: serde_json::Map<String, Value> = (0..13)
            .map(|index| {
                (
                    index.to_string(),
                    serde_json::json!({"primary":{"usedPercent":1}}),
                )
            })
            .collect();
        let output =
            serde_json::json!({"id":1,"result":{"rateLimitsByLimitId":buckets}}).to_string();
        assert!(parse_codex_usage(output.as_bytes()).is_err());
    }
    #[test]
    fn parses_claude_session_and_weekly_windows() {
        let input = r#"{"result":"Current session: 6% used · resets Sep 2 at 10:40pm (Europe/Bratislava)\nCurrent week (all models): 5% used · resets Sep 8 at 8am (Europe/Bratislava)\nCurrent week (Fable): 15% used · resets Sep 8 at 8am (Europe/Bratislava)"}"#;
        let windows = parse_claude_usage(input.as_bytes()).expect("usage");
        assert_eq!(windows.len(), 3);
        assert_eq!(windows[0].used_percent, 6.0);
        assert_eq!(windows[0].id, "five_hour");
        assert_eq!(windows[1].label, "Weekly limit");
        assert_eq!(windows[2].id, "seven_day_fable");
        assert_eq!(windows[2].label, "Weekly Fable limit");
    }

    #[test]
    fn parses_codex_primary_and_secondary_windows() {
        let input = br#"{"id":0,"result":{}}
{"id":1,"result":{"rateLimitsByLimitId":{"codex":{"limitName":null,"primary":{"usedPercent":11,"windowDurationMins":300,"resetsAt":1788771347},"secondary":{"usedPercent":22,"windowDurationMins":10080,"resetsAt":1788983872}}}}}"#;
        let windows = parse_codex_usage(input).expect("usage");
        assert_eq!(windows.len(), 2);
        assert!(windows[0].label.contains("5-hour limit"));
        assert!(windows[1].label.contains("Weekly limit"));
    }
}
