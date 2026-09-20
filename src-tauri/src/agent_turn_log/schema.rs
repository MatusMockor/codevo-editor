use super::errors::{sqlite, AgentTurnLogResult};
use super::wire::{
    AgentTurnDigestWire, AgentTurnLogLoss, AgentTurnLogLossKind, AGENT_TURN_DIGEST_VERSION,
};
use crate::agent_subagent_lifecycle;
use rusqlite::{Connection, OptionalExtension, Row};
use serde_json::Value;

pub(crate) const DDL: &str = "
CREATE TABLE IF NOT EXISTS turn_meta (
    turn_id TEXT PRIMARY KEY,
    writer_epoch INTEGER NOT NULL,
    next_seq INTEGER NOT NULL,
    first_seq INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    loss TEXT NOT NULL,
    sealed INTEGER NOT NULL,
    digest BLOB,
    digest_through_seq INTEGER NOT NULL,
    digest_version INTEGER NOT NULL,
    updated_seq INTEGER NOT NULL DEFAULT 0,
    prompt TEXT,
    lifecycle TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload BLOB NOT NULL,
    PRIMARY KEY(turn_id, seq)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS turn_meta_updated_seq ON turn_meta (updated_seq DESC);
";

const ACTIVITY_COLUMN: &str = "updated_seq";
const PROMPT_COLUMN: &str = "prompt";
const LIFECYCLE_COLUMN: &str = "lifecycle";
const NEXT_ACTIVITY: &str = "(SELECT IFNULL(MAX(updated_seq), 0) + 1 FROM turn_meta)";

pub(crate) fn ensure_activity_column(connection: &Connection) -> AgentTurnLogResult<()> {
    if has_activity_column(connection)? {
        return Ok(());
    }
    sqlite(connection.execute_batch(
        "ALTER TABLE turn_meta ADD COLUMN updated_seq INTEGER NOT NULL DEFAULT 0;
         CREATE INDEX IF NOT EXISTS turn_meta_updated_seq ON turn_meta (updated_seq DESC);",
    ))
}

pub(crate) fn has_activity_column(connection: &Connection) -> AgentTurnLogResult<bool> {
    has_column(connection, ACTIVITY_COLUMN)
}

pub(crate) fn ensure_prompt_column(connection: &Connection) -> AgentTurnLogResult<()> {
    if has_prompt_column(connection)? {
        return Ok(());
    }
    sqlite(connection.execute_batch("ALTER TABLE turn_meta ADD COLUMN prompt TEXT;"))
}

pub(crate) fn has_prompt_column(connection: &Connection) -> AgentTurnLogResult<bool> {
    has_column(connection, PROMPT_COLUMN)
}

pub(crate) fn ensure_lifecycle_column(connection: &Connection) -> AgentTurnLogResult<()> {
    if has_lifecycle_column(connection)? {
        return Ok(());
    }
    sqlite(connection.execute_batch("ALTER TABLE turn_meta ADD COLUMN lifecycle TEXT;"))
}

pub(crate) fn has_lifecycle_column(connection: &Connection) -> AgentTurnLogResult<bool> {
    has_column(connection, LIFECYCLE_COLUMN)
}

fn has_column(connection: &Connection, column: &str) -> AgentTurnLogResult<bool> {
    let present: i64 = sqlite(connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('turn_meta') WHERE name = ?1",
        [column],
        |row| row.get(0),
    ))?;
    Ok(present != 0)
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TurnMetaRow {
    pub(crate) turn_id: String,
    pub(crate) writer_epoch: i64,
    pub(crate) next_seq: i64,
    pub(crate) first_seq: i64,
    pub(crate) event_count: i64,
    pub(crate) bytes: i64,
    pub(crate) loss: AgentTurnLogLoss,
    pub(crate) sealed: bool,
    pub(crate) digest: Option<AgentTurnDigestWire>,
    pub(crate) digest_through_seq: i64,
    pub(crate) prompt: Option<String>,
    pub(crate) lifecycle: Option<Value>,
}

const SELECT_COLUMNS: &str = "turn_id, writer_epoch, next_seq, first_seq, event_count, bytes, loss, sealed, digest, digest_through_seq";

fn select_columns(connection: &Connection) -> AgentTurnLogResult<String> {
    let prompt = match has_prompt_column(connection)? {
        true => PROMPT_COLUMN,
        false => "NULL",
    };
    let lifecycle = match has_lifecycle_column(connection)? {
        true => LIFECYCLE_COLUMN,
        false => "NULL",
    };
    Ok(format!("{SELECT_COLUMNS}, {prompt}, {lifecycle}"))
}

pub(crate) fn read_turn_meta(
    connection: &Connection,
    turn_id: &str,
) -> AgentTurnLogResult<Option<TurnMetaRow>> {
    let columns = select_columns(connection)?;
    let statement = format!("SELECT {columns} FROM turn_meta WHERE turn_id = ?1");
    sqlite(
        connection
            .query_row(&statement, [turn_id], turn_meta_from_row)
            .optional(),
    )
}

pub(crate) fn read_all_turn_meta(
    connection: &Connection,
    limit: usize,
) -> AgentTurnLogResult<Vec<TurnMetaRow>> {
    let order = match has_activity_column(connection)? {
        true => "updated_seq DESC, turn_id DESC",
        false => "turn_id DESC",
    };
    let columns = select_columns(connection)?;
    let statement = format!("SELECT {columns} FROM turn_meta ORDER BY {order} LIMIT ?1");
    let mut prepared = sqlite(connection.prepare(&statement))?;
    let rows = sqlite(prepared.query_map([limit as i64], turn_meta_from_row))?;
    let mut collected = Vec::new();
    for row in rows {
        collected.push(sqlite(row)?);
    }
    collected.reverse();
    Ok(collected)
}

fn turn_meta_from_row(row: &Row<'_>) -> rusqlite::Result<TurnMetaRow> {
    let loss: String = row.get(6)?;
    let digest: Option<Vec<u8>> = row.get(8)?;
    let lifecycle: Option<String> = row.get(11)?;
    Ok(TurnMetaRow {
        turn_id: row.get(0)?,
        writer_epoch: row.get(1)?,
        next_seq: row.get(2)?,
        first_seq: row.get(3)?,
        event_count: row.get(4)?,
        bytes: row.get(5)?,
        loss: decode_loss(&loss),
        sealed: row.get::<_, i64>(7)? != 0,
        digest: digest.as_deref().and_then(decode_digest),
        digest_through_seq: row.get(9)?,
        prompt: row.get(10)?,
        lifecycle: lifecycle.as_deref().and_then(decode_lifecycle),
    })
}

fn decode_lifecycle(raw: &str) -> Option<Value> {
    let decoded: Value = serde_json::from_str(raw).ok()?;
    agent_subagent_lifecycle::valid(&decoded).then_some(decoded)
}

fn encode_lifecycle(lifecycle: Option<&Value>) -> Option<String> {
    lifecycle.and_then(|lifecycle| serde_json::to_string(lifecycle).ok())
}

pub(crate) fn decode_loss(raw: &str) -> AgentTurnLogLoss {
    serde_json::from_str(raw)
        .unwrap_or_else(|_| AgentTurnLogLoss::of(AgentTurnLogLossKind::Unreadable))
}

pub(crate) fn encode_loss(loss: AgentTurnLogLoss) -> String {
    serde_json::to_string(&loss).unwrap_or_else(|_| "{\"kind\":\"unreadable\"}".to_string())
}

fn decode_digest(raw: &[u8]) -> Option<AgentTurnDigestWire> {
    let decoded: AgentTurnDigestWire = serde_json::from_slice(raw).ok()?;
    if decoded.version != AGENT_TURN_DIGEST_VERSION {
        return None;
    }
    Some(decoded)
}

pub(crate) fn insert_turn_meta(
    connection: &Connection,
    row: &TurnMetaRow,
) -> AgentTurnLogResult<()> {
    let digest = row
        .digest
        .as_ref()
        .and_then(|digest| serde_json::to_vec(digest).ok());
    sqlite(connection.execute(
        &format!(
        "INSERT INTO turn_meta (turn_id, writer_epoch, next_seq, first_seq, event_count, bytes, loss, sealed, digest, digest_through_seq, digest_version, prompt, lifecycle, updated_seq)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, {NEXT_ACTIVITY})"),
        rusqlite::params![
            row.turn_id,
            row.writer_epoch,
            row.next_seq,
            row.first_seq,
            row.event_count,
            row.bytes,
            encode_loss(row.loss),
            i64::from(row.sealed),
            digest,
            row.digest_through_seq,
            i64::from(AGENT_TURN_DIGEST_VERSION),
            row.prompt,
            encode_lifecycle(row.lifecycle.as_ref()),
        ],
    ))?;
    Ok(())
}

pub(crate) fn update_turn_meta(
    connection: &Connection,
    row: &TurnMetaRow,
) -> AgentTurnLogResult<()> {
    let digest = row
        .digest
        .as_ref()
        .and_then(|digest| serde_json::to_vec(digest).ok());
    sqlite(connection.execute(
        &format!(
        "UPDATE turn_meta SET writer_epoch = ?2, next_seq = ?3, first_seq = ?4, event_count = ?5,
         bytes = ?6, loss = ?7, sealed = ?8, digest = ?9, digest_through_seq = ?10, digest_version = ?11,
         prompt = ?12, lifecycle = ?13, updated_seq = {NEXT_ACTIVITY}
         WHERE turn_id = ?1"),
        rusqlite::params![
            row.turn_id,
            row.writer_epoch,
            row.next_seq,
            row.first_seq,
            row.event_count,
            row.bytes,
            encode_loss(row.loss),
            i64::from(row.sealed),
            digest,
            row.digest_through_seq,
            i64::from(AGENT_TURN_DIGEST_VERSION),
            row.prompt,
            encode_lifecycle(row.lifecycle.as_ref()),
        ],
    ))?;
    Ok(())
}
