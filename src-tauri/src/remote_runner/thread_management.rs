//! Strict, exact-connection transport for server-owned thread organization.
use super::{
    commands::blocking,
    project_management::call_lease,
    service::RemoteRunnerState,
    types::{id, uuid},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const PAGE_LIMIT: usize = 100;
const ORDER_LIMIT: usize = 256;
const MAX_TIMESTAMP: u64 = 8_640_000_000_000_000;
const INVALID: &str = "Invalid runner thread metadata";

fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadMetadata {
    task_id: String,
    revision: u64,
    #[serde(deserialize_with = "nullable")]
    title: Option<String>,
    pinned: bool,
    archived: bool,
    removed: bool,
    #[serde(deserialize_with = "nullable")]
    viewed_at_epoch_ms: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    snoozed_until: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    settled_at: Option<u64>,
    #[serde(deserialize_with = "nullable")]
    sort_order: Option<f64>,
}

fn validate_title(title: &str) -> bool {
    !title.trim().is_empty()
        && title.len() <= 256
        && !title.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
impl ThreadMetadata {
    fn validate(&self) -> Result<(), String> {
        uuid(&self.task_id)?;
        if (self.snoozed_until.is_some() && self.settled_at.is_some())
            || self.revision > SAFE_INTEGER
            || self.title.as_deref().is_some_and(|t| !validate_title(t))
            || [self.viewed_at_epoch_ms, self.snoozed_until, self.settled_at]
                .into_iter()
                .flatten()
                .any(|v| v > MAX_TIMESTAMP)
            || self
                .sort_order
                .is_some_and(|v| !v.is_finite() || v.abs() > SAFE_INTEGER as f64)
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadMetadataRequest {
    server_id: String,
    task_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadMetadataListRequest {
    server_id: String,
    after: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadMetadataPatchRequest {
    server_id: String,
    task_id: String,
    patch: Value,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadMetadataPage {
    items: Vec<ThreadMetadata>,
    #[serde(deserialize_with = "nullable")]
    next_after: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ThreadOrderResult {
    items: Vec<ThreadMetadata>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Placement {
    Before,
    After,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadOrderRequest {
    server_id: String,
    task_id: String,
    target_task_id: String,
    placement: Placement,
}

fn task_path(server: &str, task: &str) -> Result<String, String> {
    id(server)?;
    uuid(task)?;
    Ok(format!("/v1/tasks/{task}/thread-metadata"))
}
fn parse_metadata(value: Value, task: &str) -> Result<ThreadMetadata, String> {
    let result: ThreadMetadata = serde_json::from_value(value).map_err(|_| INVALID)?;
    result.validate()?;
    if result.task_id != task {
        return Err("Thread metadata belongs to another task".into());
    }
    Ok(result)
}
fn validate_items(items: &[ThreadMetadata], limit: usize) -> Result<(), String> {
    if items.len() > limit {
        return Err("Too many thread metadata items".into());
    }
    let mut seen = std::collections::HashSet::new();
    for item in items {
        item.validate()?;
        if !seen.insert(&item.task_id) {
            return Err("Duplicate thread metadata item".into());
        }
    }
    Ok(())
}
fn parse_page(value: Value, after: Option<&str>) -> Result<ThreadMetadataPage, String> {
    let page: ThreadMetadataPage = serde_json::from_value(value).map_err(|_| INVALID)?;
    validate_items(&page.items, PAGE_LIMIT)?;
    if let Some(cursor) = &page.next_after {
        uuid(cursor)?;
        if Some(cursor.as_str()) == after
            || page.items.last().is_none_or(|item| &item.task_id != cursor)
        {
            return Err("Invalid thread metadata cursor".into());
        }
    }
    Ok(page)
}
fn validate_patch(patch: &Value) -> Result<(), String> {
    let fields = patch.as_object().ok_or(INVALID)?;
    if fields.len() < 2
        || fields
            .get("expectedRevision")
            .and_then(Value::as_u64)
            .is_none_or(|v| v > SAFE_INTEGER)
    {
        return Err(INVALID.into());
    }
    if fields.get("snoozedUntil").is_some_and(|v| !v.is_null())
        && fields.get("settledAt").is_some_and(|v| !v.is_null())
    {
        return Err(INVALID.into());
    }
    for (key, value) in fields {
        let valid = match key.as_str() {
            "expectedRevision" => true,
            "title" => value.is_null() || value.as_str().is_some_and(validate_title),
            "pinned" | "archived" | "removed" => value.is_boolean(),
            "viewedAtEpochMs" | "snoozedUntil" | "settledAt" => {
                value.is_null() || value.as_u64().is_some_and(|v| v <= MAX_TIMESTAMP)
            }
            "sortOrder" => {
                value.is_null()
                    || value
                        .as_f64()
                        .is_some_and(|v| v.is_finite() && v.abs() <= SAFE_INTEGER as f64)
            }
            _ => false,
        };
        if !valid {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_runner_get_thread_metadata(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadMetadataRequest,
) -> Result<ThreadMetadata, String> {
    let path = task_path(&request.server_id, &request.task_id)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || parse_metadata(call_lease(lease, "GET", &path, None)?, &request.task_id)).await
}
#[tauri::command]
pub async fn remote_runner_list_thread_metadata(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadMetadataListRequest,
) -> Result<ThreadMetadataPage, String> {
    id(&request.server_id)?;
    let path = match &request.after {
        Some(after) => {
            uuid(after)?;
            format!("/v1/thread-metadata?after={after}")
        }
        None => "/v1/thread-metadata".into(),
    };
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        parse_page(
            call_lease(lease, "GET", &path, None)?,
            request.after.as_deref(),
        )
    })
    .await
}
#[tauri::command]
pub async fn remote_runner_patch_thread_metadata(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadMetadataPatchRequest,
) -> Result<ThreadMetadata, String> {
    let path = task_path(&request.server_id, &request.task_id)?;
    validate_patch(&request.patch)?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        parse_metadata(
            call_lease(lease, "PATCH", &path, Some(request.patch))?,
            &request.task_id,
        )
    })
    .await
}
#[tauri::command]
pub async fn remote_runner_order_thread(
    state: tauri::State<'_, RemoteRunnerState>,
    request: ThreadOrderRequest,
) -> Result<ThreadOrderResult, String> {
    task_path(&request.server_id, &request.task_id)?;
    uuid(&request.target_task_id)?;
    if request.task_id == request.target_task_id {
        return Err("Cannot order a thread against itself".into());
    }
    let lease = state.connection_lease(&request.server_id)?;
    blocking(move || {
        let result: ThreadOrderResult = serde_json::from_value(call_lease(lease, "POST", &format!("/v1/tasks/{}/thread-order", request.task_id), Some(serde_json::json!({"targetTaskId": request.target_task_id, "placement": request.placement})))?).map_err(|_| INVALID)?;
        validate_items(&result.items, ORDER_LIMIT)?;
        // The runner returns only changed rows; a repeated reorder legitimately has no changes.
        Ok(result)
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const TASK: &str = "00000000-0000-4000-8000-000000000001";
    const OTHER: &str = "00000000-0000-4000-8000-000000000002";
    fn dto() -> Value {
        json!({"taskId":TASK,"revision":0,"title":null,"pinned":false,"archived":false,"removed":false,"viewedAtEpochMs":null,"snoozedUntil":null,"settledAt":null,"sortOrder":null})
    }
    #[test]
    fn accepts_empty_and_partial_changed_order_rows() {
        for value in [
            json!({"items": []}),
            json!({"items": [{"taskId":OTHER,"revision":1,"title":null,"pinned":false,"archived":false,"removed":false,"viewedAtEpochMs":null,"snoozedUntil":null,"settledAt":null,"sortOrder":1}]}),
        ] {
            let result: ThreadOrderResult = serde_json::from_value(value).unwrap();
            assert!(validate_items(&result.items, ORDER_LIMIT).is_ok());
        }
    }
    #[test]
    fn metadata_is_closed_required_and_exact_task() {
        assert!(parse_metadata(dto(), TASK).is_ok());
        assert!(parse_metadata(dto(), OTHER).is_err());
        for key in dto().as_object().unwrap().keys() {
            let mut value = dto();
            value.as_object_mut().unwrap().remove(key);
            assert!(parse_metadata(value, TASK).is_err(), "missing {key}");
        }
        let mut invalid_state = dto();
        invalid_state["snoozedUntil"] = json!(100);
        invalid_state["settledAt"] = json!(200);
        assert!(parse_metadata(invalid_state, TASK).is_err());
        let mut value = dto();
        value["unknown"] = json!(true);
        assert!(parse_metadata(value, TASK).is_err());
    }
    #[test]
    fn bounds_and_types_fail_closed() {
        for (key, value) in [
            ("revision", json!(SAFE_INTEGER + 1)),
            ("title", json!("\n")),
            ("title", json!("x".repeat(257))),
            ("pinned", json!(null)),
            ("viewedAtEpochMs", json!(-1)),
            ("snoozedUntil", json!(1.5)),
            ("settledAt", json!(SAFE_INTEGER + 1)),
        ] {
            let mut metadata = dto();
            metadata[key] = value;
            assert!(parse_metadata(metadata, TASK).is_err(), "{key}");
        }
    }
    #[test]
    fn patch_rejects_unknown_empty_and_unsafe_values() {
        for patch in [
            json!({}),
            json!({"expectedRevision":0}),
            json!({"expectedRevision":0,"pinned":null}),
            json!({"expectedRevision":0,"foo":true}),
            json!({"expectedRevision":-1,"pinned":true}),
            json!({"expectedRevision":0,"snoozedUntil":SAFE_INTEGER+1}),
        ] {
            assert!(validate_patch(&patch).is_err());
        }
        assert!(validate_patch(
            &json!({"expectedRevision":0,"title":null,"pinned":true,"settledAt":123})
        )
        .is_ok());
    }
    #[test]
    fn pages_reject_duplicates_overflow_and_stuck_cursors() {
        assert!(parse_page(json!({"items":[dto()],"nextAfter":null}), None).is_ok());
        assert!(parse_page(json!({"items":[dto()],"nextAfter":TASK}), None).is_ok());
        for page in [
            json!({"items":[dto(),dto()],"nextAfter":null}),
            json!({"items":[dto()],"nextAfter":OTHER}),
            json!({"items":[],"nextAfter":TASK}),
            json!({"items":[dto()]}),
        ] {
            assert!(parse_page(page, None).is_err());
        }
        assert!(parse_page(json!({"items":[dto()],"nextAfter":TASK}), Some(TASK)).is_err());
    }
    #[test]
    fn page_item_bound_and_sort_order_bound_are_enforced() {
        let items: Vec<Value> = (0..=PAGE_LIMIT)
            .map(|index| {
                let mut item = dto();
                item["taskId"] = json!(format!("00000000-0000-4000-8000-{index:012x}"));
                item
            })
            .collect();
        assert!(parse_page(json!({"items":items,"nextAfter":null}), None).is_err());
        let mut item = dto();
        item["sortOrder"] = json!(SAFE_INTEGER as f64 + 2.0);
        assert!(parse_metadata(item, TASK).is_err());
        assert!(validate_patch(
            &json!({"expectedRevision":0,"sortOrder":SAFE_INTEGER as f64 + 2.0})
        )
        .is_err());
    }
    #[test]
    fn request_identifiers_cannot_inject_routes() {
        assert!(task_path("server", TASK).is_ok());
        for task in ["../task", "task?after=bad", ""] {
            assert!(task_path("server", task).is_err());
        }
        assert!(serde_json::from_value::<ThreadMetadataRequest>(
            json!({"serverId":"server","taskId":TASK,"unknown":true})
        )
        .is_err());
        assert!(serde_json::from_value::<ThreadOrderRequest>(
            json!({"serverId":"server","taskId":TASK,"targetTaskId":OTHER,"placement":"middle"})
        )
        .is_err());
    }
}
