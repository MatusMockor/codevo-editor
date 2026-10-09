use super::{
    legacy::{AgentThread, MAX_AGENT_SAFE_INTEGER},
    sql,
};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const INVALID_HALT_REQUESTS: &str = "Agent turn halt requests are invalid.";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TurnHaltSource {
    ComposerStopButton,
    ComposerEscape,
    StopConfirmationBanner,
    SessionDock,
    ThreadMenu,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TurnHaltEscalationSource {
    ComposerStopButton,
    ComposerEscape,
    StopConfirmationBanner,
    SessionDock,
    ThreadMenu,
    InterruptRefused,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TurnHaltMode {
    SoftInterrupt,
    HardStop,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnHaltEscalation {
    pub source: TurnHaltEscalationSource,
    pub requested_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnHaltRequest {
    pub turn_id: String,
    pub source: TurnHaltSource,
    pub mode: TurnHaltMode,
    pub requested_at_epoch_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalation: Option<TurnHaltEscalation>,
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    sql(connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS turn_halt_requests(
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        source TEXT NOT NULL,
        mode TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        escalated_source TEXT,
        escalated_at INTEGER,
        PRIMARY KEY(thread_id,turn_id));",
    ))
}

pub(super) fn validate(thread: &AgentThread, requests: &[TurnHaltRequest]) -> Result<(), String> {
    if requests.len() > thread.turns.len() {
        return Err(INVALID_HALT_REQUESTS.into());
    }
    let saved: HashSet<&str> = thread
        .turns
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect();
    let mut seen = HashSet::new();
    for request in requests {
        if !saved.contains(request.turn_id.as_str()) || !seen.insert(request.turn_id.as_str()) {
            return Err(INVALID_HALT_REQUESTS.into());
        }
        if !coherent(request) {
            return Err(INVALID_HALT_REQUESTS.into());
        }
    }
    Ok(())
}

pub(super) fn wire_bytes(requests: &[TurnHaltRequest]) -> usize {
    if requests.is_empty() {
        return 0;
    }
    serde_json::to_vec(requests).map_or(0, |encoded| encoded.len())
}

pub(super) fn record(
    connection: &Connection,
    thread_id: &str,
    requests: &[TurnHaltRequest],
) -> Result<(), String> {
    for request in requests {
        let escalation = request.escalation.as_ref();
        let escalated_source = escalation.map(|escalation| text(&escalation.source));
        let escalated_at = escalation.map(|escalation| escalation.requested_at_epoch_ms as i64);
        sql(connection.execute(
            "INSERT INTO turn_halt_requests(thread_id,turn_id,source,mode,requested_at,escalated_source,escalated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(thread_id,turn_id) DO UPDATE SET
                escalated_source=excluded.escalated_source,
                escalated_at=excluded.escalated_at
             WHERE turn_halt_requests.escalated_source IS NULL
                AND turn_halt_requests.mode=?8
                AND excluded.escalated_source IS NOT NULL
                AND excluded.escalated_at>=turn_halt_requests.requested_at",
            params![
                thread_id,
                request.turn_id,
                text(&request.source),
                text(&request.mode),
                request.requested_at_epoch_ms as i64,
                escalated_source,
                escalated_at,
                text(&TurnHaltMode::SoftInterrupt),
            ],
        ))?;
    }
    Ok(())
}

pub(super) fn read(
    connection: &Connection,
    thread_id: &str,
    turn_id: &str,
) -> Option<TurnHaltRequest> {
    connection
        .query_row(
            "SELECT source,mode,requested_at,escalated_source,escalated_at
             FROM turn_halt_requests WHERE thread_id=?1 AND turn_id=?2",
            [thread_id, turn_id],
            |row| Ok(decode(row, turn_id)),
        )
        .optional()
        .ok()
        .flatten()
        .flatten()
}

pub(super) fn delete(connection: &Connection, thread_id: &str) -> Result<(), String> {
    sql(connection.execute(
        "DELETE FROM turn_halt_requests WHERE thread_id=?1",
        [thread_id],
    ))?;
    Ok(())
}

fn decode(row: &Row<'_>, turn_id: &str) -> Option<TurnHaltRequest> {
    let request = TurnHaltRequest {
        turn_id: turn_id.to_string(),
        source: variant(row, 0)?,
        mode: variant(row, 1)?,
        requested_at_epoch_ms: timestamp(row, 2)?,
        escalation: None,
    };
    if !coherent(&request) {
        return None;
    }
    let escalated = TurnHaltRequest {
        escalation: decode_escalation(row),
        ..request.clone()
    };
    if coherent(&escalated) {
        return Some(escalated);
    }
    Some(request)
}

fn decode_escalation(row: &Row<'_>) -> Option<TurnHaltEscalation> {
    Some(TurnHaltEscalation {
        source: variant(row, 3)?,
        requested_at_epoch_ms: timestamp(row, 4)?,
    })
}

fn coherent(request: &TurnHaltRequest) -> bool {
    if request.requested_at_epoch_ms > MAX_AGENT_SAFE_INTEGER {
        return false;
    }
    let Some(escalation) = request.escalation.as_ref() else {
        return true;
    };
    request.mode == TurnHaltMode::SoftInterrupt
        && escalation.requested_at_epoch_ms >= request.requested_at_epoch_ms
        && escalation.requested_at_epoch_ms <= MAX_AGENT_SAFE_INTEGER
}

fn text<T: Serialize>(variant: &T) -> Option<String> {
    match serde_json::to_value(variant).ok()? {
        Value::String(name) => Some(name),
        _ => None,
    }
}

fn variant<T: DeserializeOwned>(row: &Row<'_>, column: usize) -> Option<T> {
    let ValueRef::Text(raw) = row.get_ref(column).ok()? else {
        return None;
    };
    let name = std::str::from_utf8(raw).ok()?;
    serde_json::from_value(Value::String(name.to_string())).ok()
}

fn timestamp(row: &Row<'_>, column: usize) -> Option<u64> {
    let ValueRef::Integer(value) = row.get_ref(column).ok()? else {
        return None;
    };
    u64::try_from(value).ok()
}
