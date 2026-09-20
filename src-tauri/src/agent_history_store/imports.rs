//! Imported transcript rows share the root history database, never the bounded thread header.
use super::super::super::agent_session_history_commands::agent_session_history::{
    import::{discard_snapshot, read_page, SourceCursor, SourcePage},
    ExternalAgentSessionHistory, ExternalSessionExchange,
};
use super::{legacy::AgentThread, AgentHistoryStore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProgress {
    pub complete: bool,
    pub imported_count: u64,
    pub truncated: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedHistoryPage {
    pub history: ExternalAgentSessionHistory,
    pub has_earlier: bool,
    pub before_ordinal: Option<u64>,
    pub complete: bool,
}

pub(super) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS imported_checkpoints (
        thread_id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL, imported_count INTEGER NOT NULL,
        complete INTEGER NOT NULL, truncated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS imported_exchanges (
        thread_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(thread_id, ordinal));
        CREATE TABLE IF NOT EXISTS imported_legacy (thread_id TEXT PRIMARY KEY, payload TEXT NOT NULL);")
        .map_err(db_error)
}

impl AgentHistoryStore {
    pub(crate) fn import_session_history(
        &self,
        root: &str,
        owner: &str,
        id: &str,
    ) -> Result<ImportProgress, String> {
        self.import_with(root, owner, id, |thread, cursor| {
            let origin = thread
                .external_origin
                .as_ref()
                .ok_or("This thread is not an imported session.")?;
            let project =
                std::fs::canonicalize(root).map_err(|_| "The imported project is unavailable.")?;
            let repository = std::fs::canonicalize(&thread.owner.repository_root)
                .map_err(|_| "The imported repository is unavailable.")?;
            if !repository.starts_with(project) {
                return Err("The imported repository is outside this project.".into());
            }
            read_page(
                origin.provider,
                &origin.session_id,
                &thread.owner.repository_root,
                origin.imported_at_epoch_ms,
                cursor,
                &self.base_dir,
            )
        })
    }

    fn import_with(
        &self,
        root: &str,
        owner: &str,
        id: &str,
        read: impl FnOnce(&AgentThread, Option<SourceCursor>) -> Result<SourcePage, String>,
    ) -> Result<ImportProgress, String> {
        self.with_connection(root, owner, |connection| {
            // A transaction serializes checkpoint reads with writes; retrying a committed step
            // cannot duplicate records even after a lost IPC response.
            let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(db_error)?;
            let thread = header(&transaction, root, owner, id)?;
            if thread.external_origin.is_none() { return Err("This thread is not an imported session.".into()); }
            let saved = transaction.query_row("SELECT cursor,imported_count,complete,truncated FROM imported_checkpoints WHERE thread_id=?1",
                [id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,bool>(2)?,row.get::<_,bool>(3)?)))
                .optional().map_err(db_error)?;
            if let Some((_, count, true, truncated)) = &saved {
                return Ok(ImportProgress { complete: true, imported_count: (*count).try_into().map_err(|_| "Invalid import count.")?, truncated: *truncated });
            }
            let cursor = saved.as_ref().map(|entry| serde_json::from_str::<SourceCursor>(&entry.0))
                .transpose().map_err(|_| "The saved import checkpoint is unreadable.".to_string())?;
            let page = read(&thread, cursor)?;
            let mut count = saved.as_ref().map_or(0, |entry| entry.1);
            let truncated = saved.as_ref().is_some_and(|entry| entry.3) || page.truncated;
            for exchange in page.exchanges {
                transaction.execute("INSERT INTO imported_exchanges(thread_id,ordinal,payload) VALUES(?1,?2,?3)",
                    params![id,count,serde_json::to_string(&exchange).map_err(|_| "Cannot encode imported message.")?]).map_err(db_error)?;
                count += 1;
            }
            transaction.execute("INSERT INTO imported_checkpoints(thread_id,cursor,imported_count,complete,truncated) VALUES(?1,?2,?3,?4,?5)
                ON CONFLICT(thread_id) DO UPDATE SET cursor=excluded.cursor, imported_count=excluded.imported_count,complete=excluded.complete,truncated=excluded.truncated",
                params![id,serde_json::to_string(&page.cursor).map_err(|_| "Cannot encode import checkpoint.")?,count,page.complete,truncated]).map_err(db_error)?;
            transaction.commit().map_err(db_error)?;
            if page.complete { discard_snapshot(&page.cursor, &self.base_dir); }
            Ok(ImportProgress { complete: page.complete, imported_count: count.try_into().map_err(|_| "Invalid import count.")?, truncated })
        })
    }

    pub(crate) fn read_imported_history(
        &self,
        root: &str,
        owner: &str,
        id: &str,
        before: Option<u64>,
    ) -> Result<ImportedHistoryPage, String> {
        self.with_connection(root, owner, |connection| {
            let thread = header(connection, root, owner, id)?;
            let origin = thread.external_origin.ok_or("This thread is not an imported session.")?;
            let saved = connection.query_row("SELECT complete,truncated FROM imported_checkpoints WHERE thread_id=?1", [id],
                |row| Ok((row.get::<_,bool>(0)?,row.get::<_,bool>(1)?))).optional().map_err(db_error)?;
            if saved.is_none_or(|entry| !entry.0) {
                let legacy: Option<String> = connection.query_row("SELECT payload FROM imported_legacy WHERE thread_id=?1", [id], |row| row.get(0)).optional().map_err(db_error)?;
                let history = legacy.map(|payload| serde_json::from_str(&payload).map_err(|_| "Saved original history is unreadable.".to_string())).transpose()?.or(origin.history.map(|history| serde_json::to_value(history).and_then(serde_json::from_value)).transpose().map_err(|_| "Saved original history is unreadable.")?);
                if let Some(history) = history {
                    return Ok(ImportedHistoryPage { history, has_earlier: false, before_ordinal: None, complete: false });
                }
            }
            let mut statement = connection.prepare("SELECT ordinal,payload FROM imported_exchanges WHERE thread_id=?1 AND (?2 IS NULL OR ordinal<?2) ORDER BY ordinal DESC LIMIT 257").map_err(db_error)?;
            let rows = statement.query_map(params![id,before.map(i64::try_from).transpose().map_err(|_| "Invalid imported cursor.")?], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?)))
                .map_err(db_error)?;
            let mut exchanges = Vec::new();
            let mut bytes = 0;
            let mut oldest = None;
            let mut has_earlier = false;
            for row in rows {
                let (ordinal, payload) = row.map_err(db_error)?;
                let exchange: ExternalSessionExchange = serde_json::from_str(&payload).map_err(|_| "An imported message is unreadable.")?;
                if exchanges.len() >= 256 || bytes + exchange.budget_bytes() > 128 * 1024 { has_earlier = true; break; }
                bytes += exchange.budget_bytes();
                oldest = Some(u64::try_from(ordinal).map_err(|_| "Invalid imported ordinal.")?);
                exchanges.push(exchange);
            }
            exchanges.reverse();
            Ok(ImportedHistoryPage {
                history: ExternalAgentSessionHistory { provider: origin.provider, session_id: origin.session_id,
                    exchanges, exchanges_truncated: saved.is_none_or(|entry| !entry.0 || entry.1), total_preview_bytes: bytes as u64 },
                has_earlier, before_ordinal: if has_earlier { oldest } else { None },
                complete: saved.is_some_and(|entry| entry.0),
            })
        })
    }
}

fn header(
    connection: &Connection,
    root: &str,
    owner: &str,
    id: &str,
) -> Result<AgentThread, String> {
    let payload: String = connection
        .query_row(
            "SELECT payload FROM threads WHERE thread_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| "The imported thread is no longer available.".to_string())?;
    let thread: AgentThread = serde_json::from_str(&payload)
        .map_err(|_| "The imported thread is unreadable.".to_string())?;
    super::validate(root, &thread)?;
    if thread.thread_id != id || thread.owner.owner_id != owner {
        return Err("The imported thread belongs to another owner.".into());
    }
    Ok(thread)
}
fn db_error(_: rusqlite::Error) -> String {
    "The imported session history database could not be accessed.".to_string()
}

/// Save shipped bounded snapshots separately before removing them from headers.
pub(super) fn migrate_legacy_history(
    connection: &Connection,
    thread: &AgentThread,
) -> Result<(), String> {
    let Some(history) = thread
        .external_origin
        .as_ref()
        .and_then(|origin| origin.history.as_ref())
    else {
        return Ok(());
    };
    let completed: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM imported_checkpoints WHERE thread_id=?1)",
            [&thread.thread_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if completed {
        return Ok(());
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO imported_legacy(thread_id,payload) VALUES(?1,?2)",
            params![
                thread.thread_id,
                serde_json::to_string(history).map_err(|_| "Cannot migrate original history.")?
            ],
        )
        .map_err(db_error)?;
    Ok(())
}

#[cfg(test)]
#[path = "imports_tests.rs"]
mod tests;

/// Capture cleanup before deletion, execute it only after the delete transaction commits.
pub(super) fn snapshot_cleanup(
    connection: &Connection,
    id: &str,
    base: &std::path::Path,
) -> Result<impl FnOnce(), String> {
    let encoded: Option<String> = connection
        .query_row(
            "SELECT cursor FROM imported_checkpoints WHERE thread_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let cursor = encoded.and_then(|value| serde_json::from_str::<SourceCursor>(&value).ok());
    let base = base.to_path_buf();
    Ok(move || {
        if let Some(cursor) = cursor {
            discard_snapshot(&cursor, &base);
        }
    })
}
