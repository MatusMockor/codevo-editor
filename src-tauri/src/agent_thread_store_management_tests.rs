use super::*;

#[test]
fn management_metadata_round_trips_and_old_archives_stay_archived() {
    let workspace = TempStore::create("management");
    let store = workspace.store();
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.archived = true;
    let old = serde_json::to_value(&document).unwrap();
    assert!(old["thread"].get("snoozedUntil").is_none());
    let decoded: AgentThreadDocument = serde_json::from_value(old.clone()).unwrap();
    assert!(decoded.thread.archived);
    assert_eq!(decoded.thread.settled_at, None);
    for field in ["snoozedUntil", "settledAt", "sortOrder"] {
        let mut nullable = old.clone();
        nullable["thread"][field] = Value::Null;
        let decoded: AgentThreadDocument = serde_json::from_value(nullable).unwrap();
        assert_eq!(decoded, document);
    }
    document.thread.snoozed_until = Some(8_640_000_000_000_000);
    document.thread.settled_at = None;
    document.thread.sort_order = Some(-0.5);
    store.save(ROOT_KEY, &document).unwrap();
    assert_eq!(store.load(ROOT_KEY).unwrap().threads, vec![document.thread]);
}

#[test]
fn management_wire_rejects_wrong_types_and_unknown_fields() {
    let original = serde_json::to_value(thread_document(ROOT_KEY, "agt-thread-0001", 10)).unwrap();
    for field in ["snoozedUntil", "settledAt"] {
        for invalid in [json!(-1), json!(1.5), json!("1"), json!(true), json!({})] {
            let mut value = original.clone();
            value["thread"][field] = invalid;
            assert!(serde_json::from_value::<AgentThreadDocument>(value).is_err());
        }
    }
    for invalid in [json!("1"), json!(false), json!([]), json!({})] {
        let mut value = original.clone();
        value["thread"]["sortOrder"] = invalid;
        assert!(serde_json::from_value::<AgentThreadDocument>(value).is_err());
    }
    let mut value = original;
    value["thread"]["unexpectedManagementField"] = json!(1);
    assert!(serde_json::from_value::<AgentThreadDocument>(value).is_err());
}

#[test]
fn management_validation_rejects_unrepresentable_dates_and_order_before_save() {
    let workspace = TempStore::create("invalid-management");
    let store = workspace.store();
    for timestamp in [8_640_000_000_000_001, u64::MAX] {
        for snooze in [true, false] {
            let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
            if snooze {
                document.thread.snoozed_until = Some(timestamp);
            } else {
                document.thread.settled_at = Some(timestamp);
            }
            assert!(store.save(ROOT_KEY, &document).is_err());
        }
    }
    for order in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        9_007_199_254_740_992.0,
        -9_007_199_254_740_992.0,
    ] {
        let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
        document.thread.sort_order = Some(order);
        assert!(store.save(ROOT_KEY, &document).is_err());
    }
    assert!(store.load(ROOT_KEY).unwrap().threads.is_empty());
}

#[test]
fn settled_and_snoozed_are_mutually_exclusive() {
    let mut document = thread_document(ROOT_KEY, "agt-thread-0001", 10);
    document.thread.settled_at = Some(0);
    validate_agent_thread_document(ROOT_KEY, &document).unwrap();
    document.thread.snoozed_until = Some(1);
    assert!(validate_agent_thread_document(ROOT_KEY, &document).is_err());
}
