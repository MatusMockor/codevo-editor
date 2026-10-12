use super::{
    connection, paths, sqlite,
    wire::{
        validate_identifier, validate_key, validate_put, LoadThreadResponse, PutTaskResponse,
        RejectionReason, RemoteReplayCacheKey, TaskRecord,
    },
    CacheError, CacheResult, EXPIRY_MS, FUTURE_TOLERANCE_MS, MAX_RECORD_BYTES,
    MAX_TASKS_PER_THREAD, MAX_THREADS, MAX_THREAD_BYTES, MAX_TOTAL_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::path::PathBuf;

pub(crate) struct RemoteAgentReplayStore {
    directory: PathBuf,
}

impl RemoteAgentReplayStore {
    pub(crate) fn new(base_dir: PathBuf) -> Self {
        Self {
            directory: paths::directory(&base_dir),
        }
    }

    fn with_connection<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> CacheResult<T>,
    ) -> CacheResult<T> {
        let mut connection = connection::open(&self.directory)?;
        let result = work(&mut connection);
        if matches!(result, Err(CacheError::Corrupt)) {
            let _ = connection::recreate(connection, &self.directory);
        }
        result
    }

    pub(crate) fn load_thread(
        &self,
        key: &RemoteReplayCacheKey,
        now_ms: i64,
    ) -> CacheResult<LoadThreadResponse> {
        validate_key(key)?;
        validate_clock(now_ms)?;
        match self.with_connection(|connection| load_thread(connection, key, now_ms)) {
            Err(CacheError::Corrupt) => Ok(LoadThreadResponse::Miss {}),
            result => result,
        }
    }

    pub(crate) fn put_task(
        &self,
        key: &RemoteReplayCacheKey,
        task_id: &str,
        record: &[u8],
        now_ms: i64,
    ) -> CacheResult<PutTaskResponse> {
        if let Err(reason) = validate_put(key, task_id, record) {
            return Ok(PutTaskResponse::Rejected { reason });
        }
        validate_clock(now_ms)?;
        self.with_connection(|connection| put_task(connection, key, task_id, record, now_ms))
    }

    pub(crate) fn remove_thread(&self, key: &RemoteReplayCacheKey) -> CacheResult<()> {
        validate_key(key)?;
        self.with_connection(|connection| {
            delete_thread(connection, key)?;
            checkpoint(connection)
        })
    }

    pub(crate) fn remove_server(&self, server_id: &str) -> CacheResult<()> {
        validate_identifier(server_id)?;
        self.with_connection(|connection| {
            sqlite(connection.execute("DELETE FROM threads WHERE server_id=?1", [server_id]))?;
            checkpoint(connection)
        })
    }

    pub(crate) fn clear(&self) -> CacheResult<()> {
        connection::clear(&self.directory)
    }
}

fn validate_clock(now_ms: i64) -> CacheResult<()> {
    if now_ms < 0 {
        return Err(CacheError::Unavailable);
    }
    Ok(())
}

fn load_thread(
    connection: &mut Connection,
    key: &RemoteReplayCacheKey,
    now_ms: i64,
) -> CacheResult<LoadThreadResponse> {
    let transaction = sqlite(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let metadata: Option<(i64, i64)> = sqlite(
        transaction
            .query_row(
                "SELECT updated_at_ms,bytes FROM threads
                 WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4",
                params![key.server_id, key.endpoint, key.runner_id, key.thread_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional(),
    )?;
    let Some((updated_at_ms, bytes)) = metadata else {
        return Ok(LoadThreadResponse::Miss {});
    };
    if updated_at_ms > now_ms.saturating_add(FUTURE_TOLERANCE_MS)
        || now_ms.saturating_sub(updated_at_ms).max(0) > EXPIRY_MS
    {
        delete_thread(&transaction, key)?;
        sqlite(transaction.commit())?;
        return Ok(LoadThreadResponse::Miss {});
    }
    if !(0..=MAX_THREAD_BYTES).contains(&bytes) || updated_at_ms < 0 {
        return Err(CacheError::Corrupt);
    }
    let records = read_records(&transaction, key, bytes)?;
    sqlite(transaction.execute(
        "UPDATE threads SET last_access_ms=MAX(last_access_ms,?5)
         WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4",
        params![
            key.server_id,
            key.endpoint,
            key.runner_id,
            key.thread_key,
            now_ms
        ],
    ))?;
    sqlite(transaction.commit())?;
    Ok(LoadThreadResponse::Hit { records })
}

fn read_records(
    connection: &Connection,
    key: &RemoteReplayCacheKey,
    expected_bytes: i64,
) -> CacheResult<Vec<TaskRecord>> {
    let mut statement = sqlite(connection.prepare(
        "SELECT task_id,record,bytes,length(record) FROM tasks
         WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4
         ORDER BY task_id LIMIT ?5",
    ))?;
    let mut rows = sqlite(statement.query(params![
        key.server_id,
        key.endpoint,
        key.runner_id,
        key.thread_key,
        (MAX_TASKS_PER_THREAD + 1) as i64
    ]))?;
    let mut records = Vec::new();
    let mut total_bytes = 0i64;
    while let Some(row) = sqlite(rows.next())? {
        let bytes: i64 = sqlite(row.get(2))?;
        let actual_bytes: i64 = sqlite(row.get(3))?;
        if bytes != actual_bytes || !(2..=MAX_RECORD_BYTES as i64).contains(&bytes) {
            return Err(CacheError::Corrupt);
        }
        total_bytes += bytes;
        if total_bytes > MAX_THREAD_BYTES || records.len() == MAX_TASKS_PER_THREAD {
            return Err(CacheError::Corrupt);
        }
        let task_id: String = sqlite(row.get(0))?;
        validate_identifier(&task_id).map_err(|_| CacheError::Corrupt)?;
        let record: Vec<u8> = sqlite(row.get(1))?;
        let record = String::from_utf8(record).map_err(|_| CacheError::Corrupt)?;
        records.push(TaskRecord { task_id, record });
    }
    if total_bytes != expected_bytes || records.is_empty() {
        return Err(CacheError::Corrupt);
    }
    Ok(records)
}

fn put_task(
    connection: &mut Connection,
    key: &RemoteReplayCacheKey,
    task_id: &str,
    record: &[u8],
    now_ms: i64,
) -> CacheResult<PutTaskResponse> {
    let transaction = sqlite(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    sqlite(transaction.execute(
        "DELETE FROM threads WHERE updated_at_ms < ?1 OR updated_at_ms > ?2",
        params![
            now_ms.saturating_sub(EXPIRY_MS),
            now_ms.saturating_add(FUTURE_TOLERANCE_MS)
        ],
    ))?;
    let (tasks, total, replaced): (i64, i64, i64) = sqlite(transaction.query_row(
        "SELECT COUNT(*),COALESCE(SUM(bytes),0),COALESCE(SUM(CASE WHEN task_id=?5 THEN bytes ELSE 0 END),0)
         FROM tasks WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4",
        params![key.server_id, key.endpoint, key.runner_id, key.thread_key, task_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ))?;
    let exists: bool = sqlite(transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks
         WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4 AND task_id=?5)",
        params![
            key.server_id,
            key.endpoint,
            key.runner_id,
            key.thread_key,
            task_id
        ],
        |row| row.get(0),
    ))?;
    if tasks >= MAX_TASKS_PER_THREAD as i64 && !exists {
        return Ok(PutTaskResponse::Rejected {
            reason: RejectionReason::TooManyTasks,
        });
    }
    let bytes = total
        .checked_sub(replaced)
        .and_then(|bytes| bytes.checked_add(record.len() as i64))
        .filter(|bytes| (0..=MAX_THREAD_BYTES).contains(bytes));
    let Some(bytes) = bytes else {
        return Ok(PutTaskResponse::Rejected {
            reason: RejectionReason::ThreadTooLarge,
        });
    };
    sqlite(transaction.execute(
        "INSERT INTO threads(server_id,endpoint,runner_id,thread_key,updated_at_ms,last_access_ms,bytes)
         VALUES(?1,?2,?3,?4,?5,?5,?6) ON CONFLICT(server_id,endpoint,runner_id,thread_key)
         DO UPDATE SET updated_at_ms=MAX(threads.updated_at_ms,excluded.updated_at_ms),
         last_access_ms=MAX(threads.last_access_ms,excluded.last_access_ms),bytes=excluded.bytes",
        params![key.server_id, key.endpoint, key.runner_id, key.thread_key, now_ms, bytes],
    ))?;
    sqlite(transaction.execute(
        "INSERT INTO tasks(server_id,endpoint,runner_id,thread_key,task_id,record,bytes,updated_at_ms)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(server_id,endpoint,runner_id,thread_key,task_id)
         DO UPDATE SET record=excluded.record,bytes=excluded.bytes,updated_at_ms=excluded.updated_at_ms",
        params![key.server_id, key.endpoint, key.runner_id, key.thread_key, task_id, record, record.len() as i64, now_ms],
    ))?;
    enforce_global_bounds(&transaction, key)?;
    sqlite(transaction.commit())?;
    Ok(PutTaskResponse::Stored {})
}

fn enforce_global_bounds(
    connection: &Connection,
    written: &RemoteReplayCacheKey,
) -> CacheResult<()> {
    loop {
        let (count, bytes): (i64, i64) = sqlite(connection.query_row(
            "SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM threads",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ))?;
        if count <= MAX_THREADS && bytes <= MAX_TOTAL_BYTES {
            return Ok(());
        }
        let oldest: Option<RemoteReplayCacheKey> = sqlite(
            connection
                .query_row(
                    "SELECT server_id,endpoint,runner_id,thread_key FROM threads
             WHERE NOT(server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4)
             ORDER BY last_access_ms,updated_at_ms,server_id,endpoint,runner_id,thread_key LIMIT 1",
                    params![
                        written.server_id,
                        written.endpoint,
                        written.runner_id,
                        written.thread_key
                    ],
                    |row| {
                        Ok(RemoteReplayCacheKey {
                            server_id: row.get(0)?,
                            endpoint: row.get(1)?,
                            runner_id: row.get(2)?,
                            thread_key: row.get(3)?,
                        })
                    },
                )
                .optional(),
        )?;
        let Some(oldest) = oldest else {
            return Err(CacheError::Corrupt);
        };
        delete_thread(connection, &oldest)?;
    }
}

fn delete_thread(connection: &Connection, key: &RemoteReplayCacheKey) -> CacheResult<()> {
    sqlite(connection.execute(
        "DELETE FROM threads WHERE server_id=?1 AND endpoint=?2 AND runner_id=?3 AND thread_key=?4",
        params![key.server_id, key.endpoint, key.runner_id, key.thread_key],
    ))?;
    Ok(())
}

fn checkpoint(connection: &Connection) -> CacheResult<()> {
    let (busy, _, _): (i64, i64, i64) = sqlite(connection.query_row(
        "PRAGMA wal_checkpoint(TRUNCATE)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ))?;
    if busy != 0 {
        return Err(CacheError::Unavailable);
    }
    Ok(())
}
