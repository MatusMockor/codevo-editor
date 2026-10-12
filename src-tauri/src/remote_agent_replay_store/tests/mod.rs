use super::{connection, paths, wire::*, *};
use rusqlite::{params, Connection};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

mod bounds;
mod clock;
mod contracts;
#[path = "paths.rs"]
mod path_regressions;
mod privacy;
mod process;
mod recovery;
mod safety;
mod store;

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempStore {
    base: PathBuf,
}

impl TempStore {
    fn new() -> Self {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!(
            "codevo-remote-replay-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&base).expect("create temporary directory");
        Self { base }
    }

    fn store(&self) -> RemoteAgentReplayStore {
        RemoteAgentReplayStore::new(self.base.clone())
    }

    fn directory(&self) -> PathBuf {
        paths::directory(&self.base)
    }

    fn database(&self) -> PathBuf {
        self.directory().join("cache.sqlite3")
    }

    fn connection(&self) -> connection::OpenedConnection {
        connection::open(&self.directory()).expect("open cache database")
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn key(thread: &str) -> RemoteReplayCacheKey {
    RemoteReplayCacheKey {
        server_id: "server".into(),
        endpoint: "[\"server\",\"host\",\"user\",22]".into(),
        runner_id: "runner".into(),
        thread_key: thread.into(),
    }
}

fn put(store: &RemoteAgentReplayStore, key: &RemoteReplayCacheKey, task: &str, now: i64) {
    assert_eq!(
        store.put_task(key, task, b"{}", now),
        Ok(PutTaskResponse::Stored {})
    );
}

fn records(result: CacheResult<LoadThreadResponse>) -> Vec<TaskRecord> {
    let LoadThreadResponse::Hit { records } = result.expect("load cache records") else {
        panic!("expected a cache hit");
    };
    records
}

fn object_of_size(size: usize) -> Vec<u8> {
    let mut record = b"{\"x\":\"".to_vec();
    record.resize(size - 2, b'a');
    record.extend_from_slice(b"\"}");
    record
}

fn rejected(reason: RejectionReason) -> CacheResult<PutTaskResponse> {
    Ok(PutTaskResponse::Rejected { reason })
}

fn row_count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count cache rows")
}
