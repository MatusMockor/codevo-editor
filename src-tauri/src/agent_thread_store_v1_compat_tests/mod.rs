#[allow(dead_code, unused_imports)]
mod shipped_lifecycle;
#[allow(dead_code, unused_imports)]
mod shipped_store;

use super::{AgentThreadDocument, AgentThreadStore, AGENT_THREAD_RETAINED_LIFECYCLE_ERROR};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const DOCUMENTS: &str = include_str!("../../../contracts/agent-thread-v1-compat-documents.json");
const SHIPPED_COMMIT: &str = "c33d0d03";
const MIN_DOCUMENTS: usize = 6;
const SHIPPED_LIFECYCLE_ENTRY_KEYS: [&str; 13] = [
    "id",
    "toolId",
    "taskId",
    "agentThreadId",
    "name",
    "description",
    "state",
    "telemetryState",
    "resultState",
    "durationMs",
    "totalTokens",
    "steps",
    "lastToolName",
];

static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

struct TempBase {
    path: PathBuf,
}

impl TempBase {
    fn create(label: &str) -> Self {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "agent-thread-v1-compat-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp base directory");
        Self { path }
    }
}

impl Drop for TempBase {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct CompatFixture {
    root_key: String,
    threads: Vec<(String, Value)>,
}

fn fixture() -> CompatFixture {
    let wire: Value = serde_json::from_str(DOCUMENTS).expect("decode compat documents");
    assert_eq!(wire["shippedCommit"], json!(SHIPPED_COMMIT));
    let root_key = wire["rootKey"].as_str().expect("root key").to_string();
    let threads: Vec<(String, Value)> = wire["documents"]
        .as_array()
        .expect("documents")
        .iter()
        .map(|document| {
            (
                document["name"].as_str().expect("name").to_string(),
                document["thread"].clone(),
            )
        })
        .collect();
    assert!(threads.len() >= MIN_DOCUMENTS);
    CompatFixture { root_key, threads }
}

fn envelope(thread: &Value) -> Value {
    json!({"schemaVersion": 1, "thread": thread})
}

fn lifecycles(thread: &Value) -> Vec<&Value> {
    thread["turns"]
        .as_array()
        .expect("turns")
        .iter()
        .filter_map(|turn| turn.get("subagentLifecycle"))
        .collect()
}

#[test]
fn every_current_document_decodes_and_validates_with_the_shipped_structs() {
    let fixture = fixture();
    for (name, thread) in &fixture.threads {
        let document: shipped_store::AgentThreadDocument = serde_json::from_value(envelope(thread))
            .unwrap_or_else(|error| panic!("{name} is unreadable for {SHIPPED_COMMIT}: {error}"));
        shipped_store::validate_agent_thread_document(&fixture.root_key, &document)
            .unwrap_or_else(|error| panic!("{name} is rejected by {SHIPPED_COMMIT}: {error}"));
    }
}

#[test]
fn every_current_lifecycle_uses_exactly_the_shipped_key_sets() {
    let fixture = fixture();
    let mut checked = 0;
    for (name, thread) in &fixture.threads {
        for lifecycle in lifecycles(thread) {
            checked += 1;
            assert!(shipped_lifecycle::valid(lifecycle), "{name}");
            let root = lifecycle.as_object().expect("lifecycle object");
            let mut root_keys: Vec<&str> = root.keys().map(String::as_str).collect();
            root_keys.sort_unstable();
            assert_eq!(root_keys, ["entries", "truncated"], "{name}");
            for entry in lifecycle["entries"].as_array().expect("entries") {
                for key in entry.as_object().expect("entry").keys() {
                    assert!(
                        SHIPPED_LIFECYCLE_ENTRY_KEYS.contains(&key.as_str()),
                        "{name}: {key}"
                    );
                }
            }
        }
    }
    assert!(checked >= MIN_DOCUMENTS);
}

#[test]
fn the_shipped_loader_reads_what_the_current_store_saves_and_evicts_nothing() {
    let fixture = fixture();
    let temp = TempBase::create("load");
    let current = AgentThreadStore::new(temp.path.clone());
    for (name, thread) in &fixture.threads {
        let document: AgentThreadDocument = serde_json::from_value(envelope(thread))
            .unwrap_or_else(|error| panic!("{name} is unreadable for the current build: {error}"));
        current
            .save(&fixture.root_key, &document)
            .unwrap_or_else(|error| panic!("{name} is refused by the current store: {error}"));
    }

    let shipped = shipped_store::AgentThreadStore::new(temp.path.clone());
    let loaded = shipped.load(&fixture.root_key).expect("shipped load");

    assert!(loaded.unreadable.is_empty());
    assert_eq!(loaded.evicted, 0);
    assert_eq!(loaded.threads.len(), fixture.threads.len());
}

#[test]
fn a_retained_lifecycle_is_unreadable_for_the_shipped_loader_and_refused_by_the_current_store() {
    let fixture = fixture();
    let (_, thread) = fixture
        .threads
        .iter()
        .find(|(_, thread)| {
            lifecycles(thread).iter().any(|lifecycle| {
                lifecycle["entries"]
                    .as_array()
                    .is_some_and(|entries| !entries.is_empty())
            })
        })
        .expect("a document with a lifecycle entry");
    let mut retained = thread.clone();
    let turn = retained["turns"]
        .as_array_mut()
        .expect("turns")
        .iter_mut()
        .find(|turn| {
            turn["subagentLifecycle"]["entries"]
                .as_array()
                .is_some_and(|entries| !entries.is_empty())
        })
        .expect("a turn with a lifecycle entry");
    turn["subagentLifecycle"]["entries"][0]["taskTitle"] = json!("Review the slice");

    assert!(
        serde_json::from_value::<shipped_store::AgentThreadDocument>(envelope(&retained)).is_err()
    );
    let document: AgentThreadDocument =
        serde_json::from_value(envelope(&retained)).expect("current build decodes retained keys");
    let temp = TempBase::create("refuse");
    let current = AgentThreadStore::new(temp.path.clone());
    assert_eq!(
        current.save(&fixture.root_key, &document),
        Err(AGENT_THREAD_RETAINED_LIFECYCLE_ERROR.to_string())
    );
}
