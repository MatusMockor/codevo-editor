pub(super) const USER_VERSION: i64 = 1;
pub(super) const DDL: &str = "
CREATE TABLE cache_meta (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    nonce BLOB NOT NULL CHECK(length(nonce) = 16)
);
INSERT INTO cache_meta VALUES(1, randomblob(16));
CREATE TABLE threads (
    server_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    runner_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    last_access_ms INTEGER NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes >= 0),
    PRIMARY KEY(server_id, endpoint, runner_id, thread_key)
) WITHOUT ROWID;
CREATE TABLE tasks (
    server_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    runner_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    task_id TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes >= 0),
    updated_at_ms INTEGER NOT NULL,
    record BLOB NOT NULL,
    PRIMARY KEY(server_id, endpoint, runner_id, thread_key, task_id),
    FOREIGN KEY(server_id, endpoint, runner_id, thread_key)
        REFERENCES threads(server_id, endpoint, runner_id, thread_key) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX threads_lru ON threads(last_access_ms, updated_at_ms, server_id, endpoint, runner_id, thread_key);
CREATE INDEX threads_expiry ON threads(updated_at_ms);
";
