use super::{CacheError, CacheResult, MAX_IDENTIFIER_BYTES, MAX_RECORD_BYTES};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RemoteReplayCacheKey {
    pub(crate) server_id: String,
    pub(crate) endpoint: String,
    pub(crate) runner_id: String,
    pub(crate) thread_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct LoadThreadRequest {
    pub(crate) key: RemoteReplayCacheKey,
}

pub(crate) type RemoveThreadRequest = LoadThreadRequest;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct PutTaskRequest {
    pub(crate) key: RemoteReplayCacheKey,
    pub(crate) task_id: String,
    pub(crate) record: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RemoveServerRequest {
    pub(crate) server_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ClearRequest {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TaskRecord {
    pub(crate) task_id: String,
    pub(crate) record: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "camelCase")]
pub(crate) enum LoadThreadResponse {
    Hit { records: Vec<TaskRecord> },
    Miss {},
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RejectionReason {
    InvalidIdentifier,
    RecordTooLarge,
    InvalidRecord,
    ThreadTooLarge,
    TooManyTasks,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "camelCase")]
pub(crate) enum PutTaskResponse {
    Stored {},
    Rejected { reason: RejectionReason },
    Unavailable {},
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "camelCase")]
pub(crate) enum RemoveResponse {
    Removed {},
    Unavailable {},
}

pub(crate) fn validate_identifier(value: &str) -> CacheResult<()> {
    if value.is_empty() || value.len() > MAX_IDENTIFIER_BYTES || value.contains('\0') {
        return Err(CacheError::InvalidIdentifier);
    }
    Ok(())
}

pub(crate) fn validate_key(key: &RemoteReplayCacheKey) -> CacheResult<()> {
    for value in [
        &key.server_id,
        &key.endpoint,
        &key.runner_id,
        &key.thread_key,
    ] {
        validate_identifier(value)?;
    }
    Ok(())
}

pub(crate) fn validate_put_request(request: &PutTaskRequest) -> Result<(), RejectionReason> {
    validate_key(&request.key).map_err(|_| RejectionReason::InvalidIdentifier)?;
    validate_identifier(&request.task_id).map_err(|_| RejectionReason::InvalidIdentifier)?;
    if request.record.len() > MAX_RECORD_BYTES {
        return Err(RejectionReason::RecordTooLarge);
    }
    Ok(())
}

pub(crate) fn validate_put(
    key: &RemoteReplayCacheKey,
    task_id: &str,
    record: &[u8],
) -> Result<(), RejectionReason> {
    validate_key(key).map_err(|_| RejectionReason::InvalidIdentifier)?;
    validate_identifier(task_id).map_err(|_| RejectionReason::InvalidIdentifier)?;
    validate_record(record)
}

pub(super) fn validate_record(record: &[u8]) -> Result<(), RejectionReason> {
    if record.len() > MAX_RECORD_BYTES {
        return Err(RejectionReason::RecordTooLarge);
    }
    let value = serde_json::from_slice::<serde_json::Value>(record)
        .map_err(|_| RejectionReason::InvalidRecord)?;
    if !value.is_object() {
        return Err(RejectionReason::InvalidRecord);
    }
    Ok(())
}
