use super::*;
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const ROOT: &str = "/workspace/import-test";
const ID: &str = "agt-imported-0001";
const SESSION: &str = "11111111-1111-4111-8111-111111111111";
struct Fixture {
    base: PathBuf,
    store: AgentHistoryStore,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "import-db-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&base).unwrap();
        Self {
            store: AgentHistoryStore::new(base.clone()),
            base,
        }
    }
    fn thread(&self) -> AgentThread {
        serde_json::from_value(json!({"threadId":ID,"owner":{"rootKey":ROOT,"ownerId":owner(),"repositoryRoot":ROOT},"target":{"isolation":"in-place","worktreePath":null},"provider":{"kind":"claudeCode","sessionId":SESSION},"title":"Imported","pinned":false,"archived":false,"createdAtEpochMs":1,"updatedAtEpochMs":2,"turns":[],"turnsTruncated":false,"externalOrigin":{"provider":"claudeCode","sessionId":SESSION,"importedAtEpochMs":2}})).unwrap()
    }
    fn save(&self) {
        self.store.save(ROOT, &owner(), &self.thread(), 0).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}
fn owner() -> String {
    super::super::legacy::agent_root_owner_id(ROOT)
}
fn source_page(start: usize, count: usize, complete: bool) -> SourcePage {
    SourcePage {cursor:serde_json::from_value(json!({"identity":"fixture","sourceModified":"fixture","snapshotName":"import-0000000000000000.snapshot","copiedBytes":10000,"snapshotIdentity":"fixture","snapshotBytes":10000,"offset":start+count,"skippingLine":false})).unwrap(),
 exchanges:(start..start+count).map(|n|serde_json::from_value(json!({"role":"user","text":format!("message-{n}-{}","x".repeat(1000))})).unwrap()).collect(),complete,truncated:false}
}
#[test]
fn durable_checkpoint_survives_restart_pages_all_rows_and_completed_import_never_reads_source() {
    let f = Fixture::new();
    f.save();
    for start in (0..640).step_by(64) {
        let reopened = AgentHistoryStore::new(f.base.clone());
        let progress = reopened
            .import_with(ROOT, &owner(), ID, |_, cursor| {
                assert_eq!(cursor.is_some(), start > 0);
                Ok(source_page(start, 64, start == 576))
            })
            .unwrap();
        assert_eq!(progress.imported_count, (start + 64) as u64);
    }
    let reopened = AgentHistoryStore::new(f.base.clone());
    assert!(
        reopened
            .import_with(ROOT, &owner(), ID, |_, _| panic!(
                "completed imports cannot depend on source"
            ))
            .unwrap()
            .complete
    );
    let mut before = None;
    let mut seen = Vec::new();
    loop {
        let page = reopened
            .read_imported_history(ROOT, &owner(), ID, before)
            .unwrap();
        assert!(page.complete);
        assert!(!page.history.exchanges_truncated);
        assert!(page.history.total_preview_bytes <= 128 * 1024);
        seen.extend(page.history.exchanges.into_iter().map(|e| e.text));
        if !page.has_earlier {
            break;
        }
        before = page.before_ordinal;
    }
    assert_eq!(seen.len(), 640);
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 640);
    assert_eq!(
        reopened.load(ROOT, &owner()).unwrap().threads[0]
            .provider
            .session_id
            .as_deref(),
        Some(SESSION)
    );
}
#[test]
fn failed_source_step_rolls_back_and_retries_without_duplicate() {
    let f = Fixture::new();
    f.save();
    f.store
        .import_with(ROOT, &owner(), ID, |_, _| Ok(source_page(0, 64, false)))
        .unwrap();
    assert!(f
        .store
        .import_with(ROOT, &owner(), ID, |_, _| Err("replaced source".into()))
        .is_err());
    let progress = f
        .store
        .import_with(ROOT, &owner(), ID, |_, cursor| {
            assert!(cursor.is_some());
            Ok(source_page(64, 4, true))
        })
        .unwrap();
    assert_eq!(progress.imported_count, 68);
    assert_eq!(
        f.store
            .read_imported_history(ROOT, &owner(), ID, None)
            .unwrap()
            .history
            .exchanges
            .len(),
        68
    );
}
#[test]
fn legacy_snapshot_survives_source_failure_and_header_stripping() {
    let f = Fixture::new();
    let mut thread = f.thread();
    thread.external_origin.as_mut().unwrap().history=Some(serde_json::from_value(json!({"provider":"claudeCode","sessionId":SESSION,"exchanges":[{"role":"user","text":"legacy"}],"exchangesTruncated":true,"totalPreviewBytes":6})).unwrap());
    f.store.save(ROOT, &owner(), &thread, 0).unwrap();
    let loaded = f.store.load(ROOT, &owner()).unwrap();
    assert!(loaded.threads[0]
        .external_origin
        .as_ref()
        .unwrap()
        .history
        .is_none());
    assert!(f
        .store
        .import_with(ROOT, &owner(), ID, |_, _| Err("missing source".into()))
        .is_err());
    let page = f
        .store
        .read_imported_history(ROOT, &owner(), ID, None)
        .unwrap();
    assert_eq!(page.history.exchanges[0].text, "legacy");
    assert!(page.history.exchanges_truncated);
    assert!(!page.complete);
}
#[test]
fn deleted_thread_rejects_late_import_and_read() {
    let f = Fixture::new();
    f.save();
    f.store
        .import_with(ROOT, &owner(), ID, |_, _| Ok(source_page(0, 64, false)))
        .unwrap();
    f.store.delete(ROOT, &owner(), ID).unwrap();
    assert!(f
        .store
        .import_with(ROOT, &owner(), ID, |_, _| panic!(
            "deleted import must not read source"
        ))
        .is_err());
    assert!(f
        .store
        .read_imported_history(ROOT, &owner(), ID, None)
        .is_err());
}
