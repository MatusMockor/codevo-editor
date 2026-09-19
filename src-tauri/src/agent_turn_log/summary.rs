use super::errors::AgentTurnLogResult;
use super::schema::read_all_turn_meta;
use super::wire::{AgentTurnLogSummary, MAX_TURN_SUMMARIES};
use rusqlite::Connection;

pub(crate) fn summarize(connection: &Connection) -> AgentTurnLogResult<Vec<AgentTurnLogSummary>> {
    let rows = read_all_turn_meta(connection, MAX_TURN_SUMMARIES)?;
    Ok(rows
        .into_iter()
        .map(|row| AgentTurnLogSummary {
            turn_id: row.turn_id,
            event_count: row.event_count,
            bytes: row.bytes,
            loss: row.loss,
            sealed: row.sealed,
            digest: row.digest,
        })
        .collect())
}
