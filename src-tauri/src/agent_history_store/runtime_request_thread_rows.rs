use super::runtime_request_reads::load_request;
use super::runtime_requests::{integer_column, stored, text_column};
use crate::agent_runtime_requests::model::{from_wire_name, RuntimeRequest, MAX_SAFE_INTEGER};
use crate::agent_runtime_requests::store::{
    StoreError, StoredEntry, ThreadRead, ThreadRows, ThreadSummary,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, PoisonError};

pub(super) const MAX_REMEMBERED_UNDECODABLE_ROWS: usize = 256;
pub(super) const MAX_REMEMBERED_UNDECODABLE_THREADS: usize = 1024;

const READABLE_HEADER: &str = "format=1
    AND typeof(request_id)='text' AND typeof(turn_id)='text' AND typeof(body)='text'
    AND kind IN ('question','approval')
    AND status IN ('pending','submitting','resolved','cancelled','expired','timedOut')
    AND typeof(version)='integer' AND version>=1 AND version<=9007199254740991
    AND typeof(reg_index)='integer' AND reg_index>=0
    AND NOT (status='resolved' AND outcome IS NULL)";

type RowKey = (String, String);
type ThreadOf = (String, String);

#[derive(Default)]
struct Remembered {
    threads: HashMap<ThreadOf, BTreeSet<RowKey>>,
    order: VecDeque<ThreadOf>,
}

#[derive(Default)]
pub(super) struct UndecodableRows {
    remembered: Mutex<Remembered>,
}

impl UndecodableRows {
    fn locked(&self) -> MutexGuard<'_, Remembered> {
        self.remembered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn remember(&self, thread: &ThreadOf, row: RowKey) {
        let mut remembered = self.locked();
        if !remembered.threads.contains_key(thread) {
            remembered.order.push_back(thread.clone());
        }
        let rows = remembered.threads.entry(thread.clone()).or_default();
        if rows.len() < MAX_REMEMBERED_UNDECODABLE_ROWS {
            rows.insert(row);
        }
        while remembered.order.len() > MAX_REMEMBERED_UNDECODABLE_THREADS {
            let Some(oldest) = remembered.order.pop_front() else {
                break;
            };
            remembered.threads.remove(&oldest);
        }
    }

    fn of(&self, thread: &ThreadOf) -> Vec<RowKey> {
        self.locked()
            .threads
            .get(thread)
            .map(|rows| rows.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn forget(&self, thread: &ThreadOf, row: &RowKey) {
        let mut remembered = self.locked();
        if let Some(rows) = remembered.threads.get_mut(thread) {
            rows.remove(row);
        }
    }
}

struct ThreadRowsReader<'a> {
    transaction: &'a Transaction<'a>,
    thread: ThreadOf,
    undecodable: &'a UndecodableRows,
}

fn entry(row: &Row<'_>) -> Option<StoredEntry> {
    Some(StoredEntry {
        request_id: text_column(row, 0)?,
        kind: from_wire_name(&text_column(row, 1)?)?,
        status: from_wire_name(&text_column(row, 2)?)?,
        order: u64::try_from(integer_column(row, 3)?).ok()?,
        version: u64::try_from(integer_column(row, 4)?)
            .ok()
            .filter(|version| *version <= MAX_SAFE_INTEGER)?,
        bytes: usize::try_from(integer_column(row, 5)?).ok()?,
    })
}

impl ThreadRowsReader<'_> {
    fn thread_id(&self) -> &str {
        &self.thread.1
    }

    fn still_stored(&self, (turn_id, request_id): &RowKey) -> Result<bool, StoreError> {
        let found: Option<i64> = stored(
            self.transaction
                .query_row(
                    "SELECT 1 FROM runtime_requests
                     WHERE thread_id=?1 AND turn_id=?2 AND request_id=?3",
                    params![self.thread_id(), turn_id, request_id],
                    |row| row.get(0),
                )
                .optional(),
        )?;
        Ok(found.is_some())
    }

    fn remembered_undecodable(&self) -> Result<(u64, bool), StoreError> {
        let mut present = 0u64;
        let remembered = self.undecodable.of(&self.thread);
        let saturated = remembered.len() >= MAX_REMEMBERED_UNDECODABLE_ROWS;
        for row in remembered {
            if self.still_stored(&row)? {
                present += 1;
                continue;
            }
            self.undecodable.forget(&self.thread, &row);
        }
        Ok((present, saturated))
    }
}

impl ThreadRows for ThreadRowsReader<'_> {
    fn summary(&mut self) -> Result<ThreadSummary, StoreError> {
        let summary = stored(self.transaction.query_row(
            &format!(
                "SELECT
                    EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1),
                    EXISTS(SELECT 1 FROM runtime_request_marks
                        WHERE thread_id=?1 AND (pruned>0 OR skipped>0)),
                    (SELECT COUNT(*) FROM runtime_requests
                        WHERE thread_id=?1 AND NOT ({READABLE_HEADER}))"
            ),
            params![self.thread_id()],
            |row| {
                let unreadable: i64 = row.get(2)?;
                Ok(ThreadSummary {
                    deleted: row.get(0)?,
                    incomplete: row.get(1)?,
                    unreadable: u64::try_from(unreadable).unwrap_or(0),
                })
            },
        ))?;
        let (undecodable, saturated) = self.remembered_undecodable()?;
        Ok(ThreadSummary {
            incomplete: summary.incomplete || saturated,
            unreadable: summary.unreadable.saturating_add(undecodable),
            ..summary
        })
    }

    fn entries(&mut self, turn_id: &str) -> Result<Vec<StoredEntry>, StoreError> {
        let mut statement = stored(self.transaction.prepare(&format!(
            "SELECT request_id,kind,status,reg_index,version,
                octet_length(body)+IFNULL(octet_length(outcome),0)
             FROM runtime_requests
             WHERE thread_id=?1 AND turn_id=?2 AND {READABLE_HEADER}
             ORDER BY reg_index,request_id"
        )))?;
        let rows =
            stored(statement.query_map(params![self.thread_id(), turn_id], |row| Ok(entry(row))))?;
        let mut entries = Vec::new();
        for row in rows {
            entries.extend(stored(row)?);
        }
        Ok(entries)
    }

    fn load(
        &mut self,
        turn_id: &str,
        request_id: &str,
    ) -> Result<Option<RuntimeRequest>, StoreError> {
        let loaded = load_request(self.transaction, self.thread_id(), turn_id, request_id)?;
        if loaded.is_none() && self.still_stored(&(turn_id.to_string(), request_id.to_string()))? {
            self.undecodable
                .remember(&self.thread, (turn_id.to_string(), request_id.to_string()));
        }
        Ok(loaded)
    }
}

pub(super) fn read_thread(
    connection: &mut Connection,
    (root_key, thread_id): (&str, &str),
    undecodable: &UndecodableRows,
    read: &mut ThreadRead<'_>,
) -> Result<(), StoreError> {
    let transaction = stored(connection.transaction())?;
    read(&mut ThreadRowsReader {
        transaction: &transaction,
        thread: (root_key.to_string(), thread_id.to_string()),
        undecodable,
    })
}
