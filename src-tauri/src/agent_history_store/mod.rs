pub(crate) use super::super::agent_thread_store_commands::agent_thread_store as legacy;
mod catalog;
pub(crate) mod connection;
mod migration;
mod pages;
pub(crate) use catalog::{FoundImport, ThreadPage};
pub(crate) mod imports;

use legacy::{AgentThread, AgentThreadDocument, AgentTurn, AGENT_THREAD_SCHEMA_VERSION};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub(crate) const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_PAGE_TURNS: usize = 32;
pub(crate) struct AgentHistoryStore {
    base_dir: PathBuf,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistorySnapshot {
    pub threads: Vec<AgentThread>,
    pub unreadable: Vec<legacy::UnreadableAgentThread>,
    pub evicted: usize,
    pub revisions: std::collections::BTreeMap<String, u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnPage {
    pub turns: Vec<AgentTurn>,
    pub has_earlier: bool,
    pub before_turn_id: Option<String>,
    pub revision: u64,
}
#[derive(Serialize)]
pub(crate) struct HistorySaveReceipt {
    pub revision: u64,
}
pub(crate) fn sql<T>(result: rusqlite::Result<T>) -> Result<T, String> {
    result.map_err(|error| format!("Unable to access saved agent history: {error}"))
}
impl AgentHistoryStore {
    pub(crate) fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }
    pub(crate) fn with_connection<T>(
        &self,
        root_key: &str,
        owner_id: &str,
        work: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut connection = connection::open(&self.base_dir, root_key, owner_id)?;
        work(&mut connection)
    }
    pub(crate) fn save(
        &self,
        root: &str,
        owner: &str,
        thread: &AgentThread,
        expected_revision: u64,
    ) -> Result<HistorySaveReceipt, String> {
        if expected_revision >= legacy::MAX_AGENT_SAFE_INTEGER {
            return Err("Agent history revision is out of bounds.".into());
        }
        validate(root, thread)?;
        let bytes = serde_json::to_vec(thread).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_PAGE_BYTES {
            return Err("Agent thread save batch exceeds 4 MiB.".into());
        }
        let fingerprint = format!("{:x}", Sha256::digest(&bytes));
        self.with_connection(root, owner, |connection| {
            let tx = sql(
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            )?;
            let deleted: bool = sql(tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1)",
                [&thread.thread_id],
                |r| r.get(0),
            ))?;
            if deleted {
                return Err("The saved thread has been deleted.".into());
            }
            let actual: Option<i64> = sql(tx
                .query_row(
                    "SELECT revision FROM threads WHERE thread_id=?1",
                    [&thread.thread_id],
                    |row| row.get(0),
                )
                .optional())?;
            if actual == Some(expected_revision as i64 + 1) {
                let accepted: Option<String> = sql(tx.query_row(
                    "SELECT last_save_hash FROM threads WHERE thread_id=?1",
                    [&thread.thread_id],
                    |row| row.get(0),
                ))?;
                if accepted.as_deref() == Some(fingerprint.as_str()) {
                    return Ok(HistorySaveReceipt {
                        revision: expected_revision + 1,
                    });
                }
            }
            if actual.unwrap_or(0) != expected_revision as i64 {
                return Err(
                    "The saved thread update is stale; reload its current revision.".into(),
                );
            }
            upsert(&tx, thread)?;
            let revision = expected_revision + 1;
            sql(tx.execute(
                "UPDATE threads SET revision=?2,last_save_hash=?3 WHERE thread_id=?1",
                rusqlite::params![thread.thread_id, revision as i64, fingerprint],
            ))?;
            sql(tx.execute(
                "INSERT OR IGNORE INTO migrated(thread_id) VALUES (?1)",
                [&thread.thread_id],
            ))?;
            sql(tx.commit())?;
            Ok(HistorySaveReceipt { revision })
        })
    }
    pub(crate) fn load(&self, root: &str, owner: &str) -> Result<HistorySnapshot, String> {
        self.with_connection(root, owner, |connection| {
            let unreadable = migration::migrate(connection, &self.base_dir, root)?;
            let transaction=sql(connection.transaction())?;
            let connection=&transaction;
            let mut statement = sql(connection.prepare(
                "SELECT thread_id,payload FROM threads ORDER BY json_extract(payload,'$.pinned') DESC,updated_at DESC,thread_id DESC LIMIT 64",
            ))?;
            let rows = sql(statement.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))))?;
            let mut threads = Vec::new();
            let mut revisions=std::collections::BTreeMap::new();
            let mut remaining = MAX_PAGE_BYTES - 65536;
            for row in rows {
                let (id,payload)=sql(row)?;
                let mut thread: AgentThread = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
                if thread.thread_id!=id {return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());}
                validate(root, &thread)?;
                let header = serde_json::to_vec(&thread)
                    .map_err(|e| e.to_string())?
                    .len();
                if header >= remaining {
                    break;
                }
                let page = pages::read(connection, root, &thread.thread_id, None, remaining - header)?;
                if page.turns.is_empty() && page.has_earlier {break;}
                revisions.insert(thread.thread_id.clone(),page.revision);
                thread.turns = page.turns;
                thread.turns_truncated |= page.has_earlier;
                remaining = remaining.saturating_sub(
                    serde_json::to_vec(&thread)
                        .map_err(|e| e.to_string())?
                        .len(),
                );
                threads.push(thread);
            }
            threads.reverse();
            Ok(HistorySnapshot {
                threads,
                unreadable,
                evicted: 0,
                revisions,
            })
        })
    }
    pub(crate) fn read_turns(
        &self,
        root: &str,
        owner: &str,
        id: &str,
        before: Option<&str>,
    ) -> Result<TurnPage, String> {
        crate::git_worktree::safe_agent_task_id(id)?;
        if let Some(cursor) = before {
            crate::git_worktree::safe_agent_task_id(cursor)?;
        }
        self.with_connection(root, owner, |connection| {
            let transaction = sql(connection.transaction())?;
            let page = pages::read(&transaction, root, id, before, MAX_PAGE_BYTES - 1024)?;
            if page.turns.is_empty() && page.has_earlier {
                return Err("The saved turn exceeds the bounded history page size.".into());
            }
            Ok(page)
        })
    }
    pub(crate) fn delete(&self, root: &str, owner: &str, id: &str) -> Result<(), String> {
        crate::git_worktree::safe_agent_task_id(id)?;
        let (cleanup, snapshot_cleanup) = self.with_connection(root, owner, |connection| {
            let tx = sql(connection.transaction())?;
            let payload: Option<String> = sql(tx
                .query_row(
                    "SELECT payload FROM threads WHERE thread_id=?1",
                    [id],
                    |row| row.get(0),
                )
                .optional())?;
            if let Some(payload) = payload {
                let thread: AgentThread =
                    serde_json::from_str(&payload).map_err(|e| e.to_string())?;
                validate(root, &thread)?;
                if thread.thread_id != id {
                    return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
                }
                sql(tx.execute(
                    "INSERT OR IGNORE INTO attachment_cleanup(thread_id) VALUES (?1)",
                    [id],
                ))?;
            }
            let cleanup: bool = sql(tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM attachment_cleanup WHERE thread_id=?1)",
                [id],
                |row| row.get(0),
            ))?;
            let snapshot_cleanup = imports::snapshot_cleanup(&tx, id, &self.base_dir)?;
            sql(tx.execute("DELETE FROM import_identity WHERE thread_id=?1", [id]))?;
            sql(tx.execute("DELETE FROM turns WHERE thread_id=?1", [id]))?;
            sql(tx.execute("DELETE FROM imported_exchanges WHERE thread_id=?1", [id]))?;
            sql(tx.execute("DELETE FROM imported_checkpoints WHERE thread_id=?1", [id]))?;
            sql(tx.execute("DELETE FROM imported_legacy WHERE thread_id=?1", [id]))?;
            sql(tx.execute("DELETE FROM threads WHERE thread_id=?1", [id]))?;
            sql(tx.execute(
                "INSERT OR IGNORE INTO tombstones(thread_id) VALUES (?1)",
                [id],
            ))?;
            sql(tx.commit())?;
            Ok((cleanup, snapshot_cleanup))
        })?;
        snapshot_cleanup();
        if cleanup {
            let directory = legacy::agent_attachment_paths::agent_attachment_thread_directory(
                &self.base_dir,
                id,
            )?;
            match std::fs::remove_dir_all(directory) {Ok(())=>{},Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},Err(error)=>return Err(format!("The saved thread was deleted but its attachments could not be removed: {error}"))}
            self.with_connection(root, owner, |connection| {
                sql(connection.execute("DELETE FROM attachment_cleanup WHERE thread_id=?1", [id]))?;
                Ok(())
            })?;
        }
        Ok(())
    }
}
fn validate(root: &str, thread: &AgentThread) -> Result<(), String> {
    if thread.updated_at_epoch_ms > legacy::MAX_AGENT_SAFE_INTEGER
        || thread.created_at_epoch_ms > legacy::MAX_AGENT_SAFE_INTEGER
    {
        return Err("Agent thread timestamp is out of bounds.".into());
    }
    let mut ids = std::collections::HashSet::new();
    if thread.turns.iter().any(|turn| !ids.insert(&turn.turn_id)) {
        return Err("Agent thread contains duplicate turn identifiers.".into());
    }
    legacy::validate_agent_thread_document(
        root,
        &AgentThreadDocument {
            schema_version: AGENT_THREAD_SCHEMA_VERSION,
            thread: thread.clone(),
        },
    )
}
fn upsert(connection: &Connection, thread: &AgentThread) -> Result<(), String> {
    let previous: Option<String> = sql(connection
        .query_row(
            "SELECT payload FROM threads WHERE thread_id=?1",
            [&thread.thread_id],
            |r| r.get(0),
        )
        .optional())?;
    if let Some(previous) = previous {
        let previous: AgentThread = serde_json::from_str(&previous).map_err(|e| e.to_string())?;
        validate(&thread.owner.root_key, &previous)?;
        if previous.thread_id != thread.thread_id {
            return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
        }
        if previous.updated_at_epoch_ms > thread.updated_at_epoch_ms {
            return Err("The saved thread update is stale.".into());
        }
    }
    imports::migrate_legacy_history(connection, thread)?;
    let mut header = thread.clone();
    header.turns.clear();
    if let Some(origin) = header.external_origin.as_mut() {
        origin.history = None;
    }
    let payload = serde_json::to_string(&header).map_err(|e| e.to_string())?;
    if let Some(origin) = thread.external_origin.as_ref() {
        let provider = serde_json::to_string(&origin.provider).map_err(|e| e.to_string())?;
        let existing:Option<String>=sql(connection.query_row("SELECT thread_id FROM import_identity WHERE provider=?1 AND session_id=?2 AND repository_root=?3",rusqlite::params![provider,origin.session_id,thread.owner.repository_root],|r|r.get(0)).optional())?;
        if existing.as_ref().is_some_and(|id| id != &thread.thread_id) {
            return Err("This provider session has already been imported.".into());
        }
        sql(connection.execute("INSERT OR IGNORE INTO import_identity(thread_id,provider,session_id,repository_root) VALUES(?1,?2,?3,?4)",rusqlite::params![thread.thread_id,provider,origin.session_id,thread.owner.repository_root]))?;
    }
    sql(connection.execute("INSERT INTO threads(thread_id,payload,updated_at) VALUES (?1,?2,?3) ON CONFLICT(thread_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",rusqlite::params![thread.thread_id,payload,thread.updated_at_epoch_ms as i64]))?;
    for turn in &thread.turns {
        let previous: Option<String> = sql(connection
            .query_row(
                "SELECT payload FROM turns WHERE thread_id=?1 AND turn_id=?2",
                rusqlite::params![thread.thread_id, turn.turn_id],
                |r| r.get(0),
            )
            .optional())?;
        if let Some(previous) = previous {
            let previous: AgentTurn = serde_json::from_str(&previous).map_err(|e| e.to_string())?;
            if previous.turn_id != turn.turn_id {
                return Err("The saved turn identifier is invalid.".into());
            }
            if previous.last_output_sequence > turn.last_output_sequence
                || previous.last_status_sequence > turn.last_status_sequence
                || (previous.status.is_terminal() && !turn.status.is_terminal())
            {
                return Err("The saved turn update is stale.".into());
            }
        }
        let existing: Option<i64> = sql(connection
            .query_row(
                "SELECT ordinal FROM turns WHERE thread_id=?1 AND turn_id=?2",
                rusqlite::params![thread.thread_id, turn.turn_id],
                |r| r.get(0),
            )
            .optional())?;
        let ordinal = match existing {
            Some(value) => value,
            None => sql(connection.query_row(
                "SELECT COALESCE(MAX(ordinal),0)+1 FROM turns WHERE thread_id=?1",
                [&thread.thread_id],
                |r| r.get(0),
            ))?,
        };
        let payload = serde_json::to_string(turn).map_err(|e| e.to_string())?;
        if payload.len() > MAX_PAGE_BYTES - 65536 {
            return Err("Agent turn exceeds the bounded history page size.".into());
        }
        sql(connection.execute("INSERT INTO turns(thread_id,turn_id,ordinal,payload) VALUES (?1,?2,?3,?4) ON CONFLICT(thread_id,turn_id) DO UPDATE SET payload=excluded.payload",rusqlite::params![thread.thread_id,turn.turn_id,ordinal,payload]))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests;
