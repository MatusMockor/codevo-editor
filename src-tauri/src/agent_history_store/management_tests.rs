use super::*;

#[test]
fn management_metadata_survives_catalog_restart_and_clearing_without_losing_history() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.snoozed_until = Some(1_800_000_000_000);
    saved.settled_at = None;
    saved.sort_order = Some(-0.25);
    saved.turns = vec![turn(0)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    let reopened = AgentHistoryStore::new(fixture.base.clone());
    let page = reopened.read_threads(ROOT, &owner(), None).unwrap();
    assert_eq!(page.threads[0].snoozed_until, saved.snoozed_until);
    assert_eq!(page.threads[0].settled_at, saved.settled_at);
    assert_eq!(page.threads[0].sort_order, saved.sort_order);
    assert_eq!(page.threads[0].owner, saved.owner);
    let mut cleared = page.threads[0].clone();
    cleared.snoozed_until = None;
    cleared.settled_at = None;
    cleared.sort_order = None;
    reopened.save(ROOT, &owner(), &cleared, 1).unwrap();
    let loaded = reopened.load(ROOT, &owner()).unwrap();
    assert_eq!(loaded.threads[0].snoozed_until, None);
    assert_eq!(loaded.threads[0].settled_at, None);
    assert_eq!(loaded.threads[0].sort_order, None);
    assert_eq!(loaded.threads[0].turns, saved.turns);
    cleared.settled_at = Some(0);
    reopened.save(ROOT, &owner(), &cleared, 2).unwrap();
    let settled = reopened.read_threads(ROOT, &owner(), None).unwrap();
    assert_eq!(settled.threads[0].settled_at, Some(0));
    assert_eq!(settled.threads[0].snoozed_until, None);
}

#[test]
fn legacy_archive_migration_preserves_identity_and_accepts_absent_metadata() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.archived = true;
    let directory = fixture
        .base
        .join("agent-threads")
        .join(legacy::fnv1a64hex(ROOT));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("{}.json", saved.thread_id));
    let original = serde_json::to_vec(&AgentThreadDocument {
        schema_version: 1,
        thread: saved.clone(),
    })
    .unwrap();
    fs::write(&path, &original).unwrap();
    let loaded = fixture.store.load(ROOT, &owner()).unwrap();
    assert!(loaded.threads[0].archived);
    assert_eq!(loaded.threads[0].settled_at, None);
    assert_eq!(loaded.threads[0].owner, saved.owner);
    assert_eq!(fs::read(path).unwrap(), original);
}

#[test]
fn invalid_catalog_management_metadata_is_rejected_on_read() {
    for (field, value) in [
        ("snoozedUntil", json!(8_640_000_000_000_001_u64)),
        ("settledAt", json!(-1)),
        ("sortOrder", json!("first")),
        ("sortOrder", json!(9_007_199_254_740_992_u64)),
        ("unknownManagementField", json!(true)),
    ] {
        let fixture = Fixture::new();
        let saved = thread();
        fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
        let mut payload = serde_json::to_value(&saved).unwrap();
        payload[field] = value;
        fixture
            .store
            .with_connection(ROOT, &owner(), |connection| {
                sql(connection.execute("UPDATE threads SET payload=?1", [payload.to_string()]))?;
                Ok(())
            })
            .unwrap();
        assert!(
            fixture.store.read_threads(ROOT, &owner(), None).is_err(),
            "{field}"
        );
    }
}
