use super::agent_provider_usage_commands::account_identity as identity;
use crate::agent_task_spawner::{
    agent_provider::{
        agent_cli_version::now_epoch_ms,
        process::{
            execute_agent_provider_plan_cancellable, limit_reset_plan::LimitResetProbe,
            parse_provider_probe_json, AgentProviderProcessPlan,
        },
        runtime::{AgentProviderRuntimeRegistry, ProviderHealthLease},
    },
    AgentCliInvocation,
};
use crate::run_blocking_command;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Instant};
use tauri::{Manager, State, WebviewWindow};
#[path = "codex_limit_reset_store.rs"]
pub(super) mod store;
use store::{Confirmation, HistoryRecord, LimitResetStore};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadRequest {
    provider_generation: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareRequest {
    provider_generation: u64,
    account_identity: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConsumeRequest {
    provider_generation: u64,
    confirmation_token: String,
    idempotency_key: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    account_identity: Option<String>,
    available_count: Option<u64>,
    history: Vec<HistoryRecord>,
    history_truncated: bool,
    pending_operation_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Prepared {
    confirmation_token: String,
}
#[derive(Serialize)]
pub(crate) struct Consumed {
    outcome: String,
}

fn read_probe(
    registry: &Arc<AgentProviderRuntimeRegistry>,
    lease: Arc<ProviderHealthLease>,
) -> Result<Vec<u8>, String> {
    registry.revalidate_health(&lease)?;
    let authority_registry = Arc::clone(registry);
    let authority_lease = Arc::clone(&lease);
    let probe = LimitResetProbe::new(
        None,
        identity::codex_reset_identity,
        Arc::new(move || authority_registry.revalidate_health(&authority_lease)),
    );
    let plan = AgentProviderProcessPlan::limit_reset_with_effective_path(
        lease.cli_identity.clone(),
        &lease.effective_path,
        Arc::clone(&probe),
    )?;
    execute_agent_provider_plan_cancellable(&plan, || registry.revalidate_health(&lease).is_err())
        .map_err(|_| {
            "Codex reset availability could not be read. This CLI may not support limit resets."
                .to_string()
        })?;
    registry.revalidate_health(&lease)?;
    Ok(probe.snapshot()?.0)
}
fn availability(stdout: &[u8]) -> Result<Option<u64>, String> {
    let rates = stdout
        .split(|b| *b == b'\n')
        .filter_map(parse_provider_probe_json)
        .find(|v| v.get("id").and_then(Value::as_u64) == Some(1))
        .ok_or("Codex reset availability was unavailable.")?;
    let value = &rates["result"]["rateLimitResetCredits"]["availableCount"];
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_u64()
        .filter(|count| *count <= 1_000_000)
        .map(Some)
        .ok_or_else(|| "Codex returned invalid reset availability.".into())
}
#[tauri::command]
pub(crate) async fn read_codex_limit_resets(
    request: ReadRequest,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
    reset_store: State<'_, Arc<LimitResetStore>>,
) -> Result<Snapshot, String> {
    let registry = Arc::clone(&provider_registry);
    let store = Arc::clone(&reset_store);
    run_blocking_command(move || {
        let lease = Arc::new(registry.acquire_account_usage_for_generation(
            AgentCliInvocation::CodexExec,
            request.provider_generation,
        )?);
        let stdout = read_probe(&registry, Arc::clone(&lease))?;
        let account_identity = identity::codex_reset_identity(&stdout);
        let available_count = availability(&stdout)?;
        let (history, history_truncated, pending_operation_id) =
            store.history(account_identity.as_deref())?;
        registry.revalidate_health(&lease)?;
        Ok(Snapshot {
            account_identity,
            available_count,
            history,
            history_truncated,
            pending_operation_id,
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn prepare_codex_limit_reset(
    request: PrepareRequest,
    window: WebviewWindow,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
    reset_store: State<'_, Arc<LimitResetStore>>,
) -> Result<Prepared, String> {
    let registry = Arc::clone(&provider_registry);
    let store = Arc::clone(&reset_store);
    run_blocking_command(move || {
        if !store::account_id(&request.account_identity) {
            return Err("Codex reset account identity was invalid.".into());
        }
        let lease = Arc::new(registry.acquire_account_usage_for_generation(
            AgentCliInvocation::CodexExec,
            request.provider_generation,
        )?);
        let stdout = read_probe(&registry, Arc::clone(&lease))?;
        if identity::codex_reset_identity(&stdout).as_ref() != Some(&request.account_identity) {
            return Err("Codex account changed. Refresh usage before resetting.".into());
        }
        if availability(&stdout)?.is_none_or(|count| count == 0)
            && store.history(Some(&request.account_identity))?.2.is_none()
        {
            return Err("No Codex limit resets are available.".into());
        }
        registry.revalidate_health(&lease)?;
        let confirmation_token = store.prepare(Confirmation {
            window_label: window.label().to_string(),
            generation: request.provider_generation,
            identity: request.account_identity,
            cli_identity: lease.cli_identity.clone(),
            discovery_generation: lease.discovery_generation,
            deadline: Instant::now(),
        })?;
        Ok(Prepared { confirmation_token })
    })
    .await
}
#[tauri::command]
pub(crate) async fn consume_codex_limit_reset(
    request: ConsumeRequest,
    window: WebviewWindow,
    provider_registry: State<'_, Arc<AgentProviderRuntimeRegistry>>,
    reset_store: State<'_, Arc<LimitResetStore>>,
) -> Result<Consumed, String> {
    let registry = Arc::clone(&provider_registry);
    let store = Arc::clone(&reset_store);
    let app = window.app_handle().clone();
    let window_label = window.label().to_string();
    run_blocking_command(move || {
        if !store::operation_key(&request.idempotency_key) || request.confirmation_token.len() != 64 || !request.confirmation_token.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("Codex reset confirmation was invalid.".into()); }
        let confirmation = store.take(&request.confirmation_token, request.provider_generation)?;
        if confirmation.window_label != window_label || app.get_webview_window(&window_label).is_none() {
            return Err("Codex reset confirmation belongs to a closed or different window.".into());
        }
        let lease = Arc::new(registry.acquire_account_usage_for_generation(AgentCliInvocation::CodexExec, request.provider_generation)?);
        if lease.cli_identity != confirmation.cli_identity || lease.discovery_generation != confirmation.discovery_generation { return Err("Codex provider changed before reset. Refresh usage.".into()); }
        registry.revalidate_health(&lease)?;
        store.begin(&confirmation.identity, &request.idempotency_key)?;
        // Scope the provider's idempotency namespace to the exact account, including after local history eviction.
        let provider_key = format!("{:x}", Sha256::digest(format!("codevo-reset-v1:{}:{}", confirmation.identity, request.idempotency_key).as_bytes()));
        let authority_registry = Arc::clone(&registry); let authority_lease = Arc::clone(&lease);
        let deadline = confirmation.deadline;
        let authority_app = app.clone();
        let authority_window_label = window_label.clone();
        let probe = LimitResetProbe::new(Some((confirmation.identity.clone(), provider_key)), identity::codex_reset_identity, Arc::new(move || {
            if Instant::now() >= deadline { return Err("Codex reset confirmation expired.".into()); }
            if authority_app.get_webview_window(&authority_window_label).is_none() { return Err("Codex reset window closed before submission.".into()); }
            authority_registry.revalidate_health(&authority_lease)
        }));
        let plan = AgentProviderProcessPlan::limit_reset_with_effective_path(lease.cli_identity.clone(), &lease.effective_path, Arc::clone(&probe))?;
        execute_agent_provider_plan_cancellable(&plan, || registry.revalidate_health(&lease).is_err() || Instant::now() >= deadline || app.get_webview_window(&window_label).is_none()).map_err(|_| "Codex reset could not be confirmed. Its result may be uncertain; retry this operation with the same key.".to_string())?;
        let outcome = probe.snapshot()?.1.ok_or("Codex reset returned no outcome.")?;
        // Persist confirmed settlement for the captured account even if UI/provider authority changes after the write.
        store.finish(&confirmation.identity, &request.idempotency_key, &outcome, now_epoch_ms()).map_err(|_| "Codex reset settled but local history could not be saved. Retry with the same operation key.".to_string())?;
        registry.revalidate_health(&lease)?;
        Ok(Consumed { outcome })
    }).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_requests_are_closed_and_credit_counts_are_bounded() {
        assert!(serde_json::from_value::<ReadRequest>(
            serde_json::json!({"providerGeneration":1,"extra":true})
        )
        .is_err());
        assert!(serde_json::from_value::<PrepareRequest>(
            serde_json::json!({"providerGeneration":1,"accountIdentity":"account","extra":true})
        )
        .is_err());
        assert!(serde_json::from_value::<ConsumeRequest>(serde_json::json!({"providerGeneration":1,"confirmationToken":"token","idempotencyKey":"key","extra":true})).is_err());
        for count in [
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!(1_000_001),
            serde_json::json!("1"),
        ] {
            assert!(availability(serde_json::json!({"id":1,"result":{"rateLimitResetCredits":{"availableCount":count}}}).to_string().as_bytes()).is_err());
        }
        assert_eq!(availability(b"{\"id\":1,\"result\":{}}"), Ok(None));
    }
}
