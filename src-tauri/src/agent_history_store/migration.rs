use super::{legacy, sql, upsert};
use rusqlite::Connection;
use std::{fs, io::Read, path::Path};
pub(super) fn migrate(
    connection: &mut Connection,
    base: &Path,
    root: &str,
) -> Result<Vec<legacy::UnreadableAgentThread>, String> {
    let directory = base
        .join(legacy::AGENT_THREAD_STORE_DIR_NAME)
        .join(legacy::fnv1a64hex(root));
    let reader = match fs::read_dir(directory) {
        Ok(reader) => reader,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut unreadable = Vec::new();
    for entry in reader.take(1024) {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
            continue;
        };
        if crate::git_worktree::safe_agent_task_id(id).is_err() {
            continue;
        }
        let done:bool=sql(connection.query_row("SELECT EXISTS(SELECT 1 FROM migrated WHERE thread_id=?1 UNION ALL SELECT 1 FROM tombstones WHERE thread_id=?1)",[id],|r|r.get(0)))?;
        if done {
            continue;
        }
        match read(&entry.path(), root, id) {
            Ok(thread) => {
                let tx =
                    sql(connection
                        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
                let done:bool=sql(tx.query_row("SELECT EXISTS(SELECT 1 FROM migrated WHERE thread_id=?1 UNION ALL SELECT 1 FROM tombstones WHERE thread_id=?1)",[id],|r|r.get(0)))?;
                if done {
                    continue;
                }
                let exists: bool = sql(tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM threads WHERE thread_id=?1)",
                    [id],
                    |r| r.get(0),
                ))?;
                if !exists {
                    upsert(&tx, &thread)?;
                }
                sql(tx.execute(
                    "INSERT OR IGNORE INTO migrated(thread_id) VALUES (?1)",
                    [id],
                ))?;
                sql(tx.commit())?;
            }
            Err(reason) if unreadable.len() < legacy::MAX_UNREADABLE_REPORTS => {
                unreadable.push(legacy::UnreadableAgentThread {
                    thread_id: id.into(),
                    reason,
                })
            }
            Err(_) => {}
        }
    }
    Ok(unreadable)
}
fn read(path: &Path, root: &str, id: &str) -> Result<legacy::AgentThread, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let file = options
        .open(path)
        .map_err(|_| "The saved thread cannot be opened.".to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > legacy::MAX_AGENT_THREAD_FILE_BYTES as u64 {
        return Err("The saved thread exceeds the legacy migration file limit.".into());
    }
    let mut payload = Vec::new();
    file.take(legacy::MAX_AGENT_THREAD_FILE_BYTES as u64 + 1)
        .read_to_end(&mut payload)
        .map_err(|e| e.to_string())?;
    if payload.len() > legacy::MAX_AGENT_THREAD_FILE_BYTES {
        return Err("The saved thread grew during migration.".into());
    }
    let document: legacy::AgentThreadDocument = serde_json::from_slice(&payload)
        .map_err(|_| "The saved thread contains invalid JSON.".to_string())?;
    legacy::validate_agent_thread_document(root, &document)?;
    if document.thread.thread_id != id {
        return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
    }
    Ok(document.thread)
}
