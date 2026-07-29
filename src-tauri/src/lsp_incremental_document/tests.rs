use super::*;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Barrier};
use std::time::Duration;

struct SequentialLifecycleTokenIssuer {
    next: AtomicU64,
}

impl LifecycleTokenIssuer for SequentialLifecycleTokenIssuer {
    fn issue(&self) -> Result<String, String> {
        let next = self.next.fetch_add(1, Ordering::SeqCst);
        Ok(format!("lsp-document-lifecycle-{next}"))
    }
}

struct ConstantLifecycleTokenIssuer;

impl LifecycleTokenIssuer for ConstantLifecycleTokenIssuer {
    fn issue(&self) -> Result<String, String> {
        Ok("fixed-collision-token".to_string())
    }
}

fn test_registry() -> DocumentChangeAdmissionRegistry {
    DocumentChangeAdmissionRegistry {
        state: Mutex::new(DocumentChangeAdmissionState::default()),
        changed: Condvar::new(),
        token_issuer: Box::new(SequentialLifecycleTokenIssuer {
            next: AtomicU64::new(1),
        }),
    }
}

#[test]
fn exact_session_transition_invalidates_inflight_open_and_change_commits() {
    let state = test_registry();
    state
        .begin_exact_session_transition("/workspace", 8)
        .expect("initial session");
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &open_request(),
            "/workspace",
            "/workspace/a.ts",
            |_| {
                state
                    .begin_exact_session_transition("/workspace", 9)
                    .expect("replacement session");
                Ok(true)
            },
        )
        .expect("inflight open"),
        DocumentOpenAdmissionReceipt::StaleSession
    );

    let mut replacement = open_request_value();
    replacement["expectedSessionId"] = json!(9);
    open(&state, decode_open(replacement), true);
    let mut change = request();
    change["expectedSessionId"] = json!(9);
    change["authority"]["lifecycleToken"] = json!("lsp-document-lifecycle-2");
    let change = decode(change);
    assert_eq!(
        deliver_validated_document_change(&state, &change, "/workspace", "/workspace/a.ts", |_| {
            state
                .begin_exact_session_transition("/workspace", 10)
                .expect("auto-restarted session");
            Ok(true)
        },)
        .expect("inflight change"),
        DocumentChangeAdmissionReceipt::StaleSession
    );
    let inner = lock_admission(&state).expect("admission state");
    assert!(inner.documents.is_empty());
    assert!(inner.pending.is_empty());
    assert_eq!(inner.sessions.get("/workspace"), Some(&10));
}

#[test]
fn successor_requires_one_checked_generation_step_and_exact_closed_predecessor() {
    let state = test_registry();
    open(&state, open_request(), true);
    close(&state, close_request(1), true);

    for (owner_generation, sync_generation) in [(4, 3), (2, 5), (4, 7)] {
        let jumped = decode_open(mutate(open_request_value(), |value| {
            value["authority"]["documentIncarnation"] = json!("document-next");
            value["authority"]["modelIncarnation"] = json!("model-next");
            value["authority"]["ownerGeneration"] = json!(owner_generation);
            value["authority"]["ownerIncarnation"] = json!("owner-next");
            value["authority"]["syncGeneration"] = json!(sync_generation);
            value["predecessorLifecycleToken"] = json!("lsp-document-lifecycle-1");
        }));
        assert_eq!(
            deliver_validated_document_open(
                &state,
                &jumped,
                "/workspace",
                "/workspace/a.ts",
                |_| panic!("generation jump must not send"),
            )
            .expect("jump receipt"),
            DocumentOpenAdmissionReceipt::StaleAuthority
        );
    }

    let exact_successor = decode_open(mutate(open_request_value(), |value| {
        value["authority"]["documentIncarnation"] = json!("document-next");
        value["authority"]["modelIncarnation"] = json!("model-next");
        value["authority"]["ownerGeneration"] = json!(3);
        value["authority"]["ownerIncarnation"] = json!("owner-next");
        value["authority"]["syncGeneration"] = json!(4);
        value["predecessorLifecycleToken"] = json!("lsp-document-lifecycle-1");
    }));
    open(&state, exact_successor, true);
}

#[test]
fn production_tokens_are_random_bounded_hex_and_collision_retries_are_bounded() {
    let state = DocumentChangeAdmissionRegistry::default();
    let first = deliver_validated_document_open(
        &state,
        &open_request(),
        "/workspace",
        "/workspace/a.ts",
        |_| Ok(true),
    )
    .expect("first token");
    let second_request = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
    }));
    let second = deliver_validated_document_open(
        &state,
        &second_request,
        "/workspace",
        "/workspace/b.ts",
        |_| Ok(true),
    )
    .expect("second token");
    let tokens = [first, second].map(|receipt| match receipt {
        DocumentOpenAdmissionReceipt::Admitted { lifecycle_token } => lifecycle_token,
        other => panic!("unexpected receipt: {other:?}"),
    });
    assert_ne!(tokens[0], tokens[1]);
    assert!(tokens
        .iter()
        .all(|token| token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit())));

    let collisions = DocumentChangeAdmissionRegistry {
        state: Mutex::new(DocumentChangeAdmissionState::default()),
        changed: Condvar::new(),
        token_issuer: Box::new(ConstantLifecycleTokenIssuer),
    };
    open(&collisions, open_request(), true);
    let collision_request = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
    }));
    assert_eq!(
        deliver_validated_document_open(
            &collisions,
            &collision_request,
            "/workspace",
            "/workspace/b.ts",
            |_| panic!("colliding token must never send"),
        )
        .expect_err("collision budget"),
        "Secure document lifecycle token collision budget was exhausted."
    );
}

#[test]
fn concurrent_open_reservations_cannot_share_one_lifecycle_token() {
    let state = Arc::new(DocumentChangeAdmissionRegistry {
        state: Mutex::new(DocumentChangeAdmissionState::default()),
        changed: Condvar::new(),
        token_issuer: Box::new(ConstantLifecycleTokenIssuer),
    });
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let first_state = Arc::clone(&state);
    let first_entered = Arc::clone(&entered);
    let first_release = Arc::clone(&release);
    let first = std::thread::spawn(move || {
        deliver_validated_document_open(
            &first_state,
            &open_request(),
            "/workspace",
            "/workspace/a.ts",
            |_| {
                first_entered.wait();
                first_release.wait();
                Ok(true)
            },
        )
    });
    entered.wait();

    let second_request = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
    }));
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &second_request,
            "/workspace",
            "/workspace/b.ts",
            |_| panic!("pending token collision must not send"),
        )
        .expect_err("pending collision budget"),
        "Secure document lifecycle token collision budget was exhausted."
    );
    release.wait();
    assert!(matches!(
        first.join().expect("first open").expect("first receipt"),
        DocumentOpenAdmissionReceipt::Admitted { .. }
    ));
    let inner = lock_admission(&state).expect("admission state");
    assert!(inner.pending_lifecycle_tokens.is_empty());
}

#[test]
fn strict_incremental_request_preserves_change_order_and_utf16_ranges() {
    let request = decode(json!({
        "authority": authority(),
        "change": {
            "kind": "incremental",
            "path": "/workspace/a.ts",
            "version": 7,
            "changes": [
                change(9, 0, 9, 4, "high"),
                change(1, 1, 1, 3, "😀")
            ]
        },
        "expectedSessionId": 8,
        "rootPath": "/workspace"
    }));
    request.validate().expect("valid request");
    let notification = request.validated_notification_for_path(request.path());

    assert_eq!(notification.params["textDocument"]["version"], 7);
    assert_eq!(notification.params["contentChanges"][0]["text"], "high");
    assert_eq!(notification.params["contentChanges"][1]["text"], "😀");
    assert_eq!(
        notification.params["contentChanges"][1]["range"],
        json!({
            "start": { "line": 1, "character": 1 },
            "end": { "line": 1, "character": 3 }
        })
    );
}

#[test]
fn strict_full_request_emits_one_full_change() {
    let request = decode(json!({
        "authority": authority(),
        "change": {
            "kind": "full",
            "path": "/workspace/a.ts",
            "text": "export {};",
            "version": 2
        },
        "expectedSessionId": 8,
        "rootPath": "/workspace"
    }));
    request.validate().expect("valid request");
    let notification = request.validated_notification_for_path(request.path());
    assert_eq!(
        notification.params["contentChanges"],
        json!([{ "text": "export {};" }])
    );
}

#[test]
fn unknown_fields_and_wrong_tags_are_rejected_during_deserialization() {
    for value in [
        request_with(json!({ "extra": true })),
        mutate(request(), |value| value["authority"]["extra"] = json!(true)),
        request_with_change(json!({
            "kind": "incremental", "path": "/workspace/a.ts", "version": 2,
            "changes": [change(0, 0, 0, 0, "x")], "extra": true
        })),
        mutate(request(), |value| {
            value["change"]["changes"][0]["extra"] = json!(true)
        }),
        mutate(request(), |value| {
            value["change"]["changes"][0]["range"]["extra"] = json!(true)
        }),
        request_with_change(json!({
            "kind": "incremental", "path": "/workspace/a.ts", "version": 2,
            "changes": [{
                "kind": "incremental", "rangeLength": 0, "text": "x",
                "range": {
                    "start": { "line": 0, "character": 0, "extra": true },
                    "end": { "line": 0, "character": 0 }
                }
            }]
        })),
        request_with_change(json!({
            "kind": "mixed", "path": "/workspace/a.ts", "version": 2, "changes": []
        })),
    ] {
        assert!(serde_json::from_value::<BoundedDocumentDidChangeRequest>(value).is_err());
    }

    let missing_predecessor = mutate(open_request_value(), |value| {
        value
            .as_object_mut()
            .expect("open request")
            .remove("predecessorLifecycleToken");
    });
    assert!(serde_json::from_value::<BoundedDocumentDidOpenRequest>(missing_predecessor).is_err());
    assert_eq!(
        serde_json::to_value(DocumentOpenAdmissionReceipt::Admitted {
            lifecycle_token: "issued".to_string(),
        })
        .expect("open receipt"),
        json!({ "kind": "admitted", "lifecycleToken": "issued" })
    );
}

#[test]
fn validates_authority_path_version_and_ranges() {
    for value in [
        mutate(request(), |value| value["expectedSessionId"] = json!(0)),
        mutate(request(), |value| {
            value["expectedSessionId"] = json!(MAX_SAFE_JAVASCRIPT_INTEGER + 1)
        }),
        mutate(request(), |value| {
            value["authority"]["syncGeneration"] = json!(0)
        }),
        mutate(request(), |value| value["rootPath"] = json!("relative")),
        mutate(request(), |value| {
            value["change"]["path"] = json!("relative.ts")
        }),
        mutate(request(), |value| value["change"]["version"] = json!(0)),
        mutate(request(), |value| {
            value["change"]["version"] = json!(MAX_LSP_UINTEGER + 1)
        }),
        mutate(request(), |value| {
            value["change"]["changes"][0]["range"]["end"] = json!({ "line": 0, "character": 0 });
            value["change"]["changes"][0]["range"]["start"] = json!({ "line": 1, "character": 0 });
        }),
        mutate(request(), |value| {
            value["change"]["changes"][0]["rangeLength"] = json!(MAX_LSP_UINTEGER + 1)
        }),
    ] {
        assert!(decode(value).validate().is_err());
    }
}

#[test]
fn enforces_change_count_and_utf8_byte_boundaries() {
    let mut accepted = request();
    accepted["change"]["changes"] = Value::Array(
        (0..MAX_CHANGE_COUNT)
            .map(|_| change(0, 0, 0, 0, "x"))
            .collect(),
    );
    assert!(decode(accepted).validate().is_ok());

    let mut rejected = request();
    rejected["change"]["changes"] = Value::Array(
        (0..=MAX_CHANGE_COUNT)
            .map(|_| change(0, 0, 0, 0, "x"))
            .collect(),
    );
    assert!(decode(rejected).validate().is_err());

    let mut oversized = request();
    oversized["change"]["changes"][0]["text"] = json!("ž".repeat(MAX_CHANGE_TEXT_BYTES / 2 + 1));
    assert!(decode(oversized).validate().is_err());

    let mut aggregate = request();
    aggregate["change"]["changes"] = Value::Array(vec![
        change(0, 0, 0, 0, &"a".repeat(MAX_CHANGE_TEXT_BYTES)),
        change(0, 0, 0, 0, &"b".repeat(MAX_CHANGE_TEXT_BYTES)),
        change(0, 0, 0, 0, "overflow"),
    ]);
    assert!(decode(aggregate).validate().is_err());
}

#[test]
fn enforces_utf8_path_and_utf16_full_text_bounds() {
    let mut path = request();
    path["change"]["path"] = json!(format!("/{}", "ž".repeat(MAX_PATH_BYTES / 2 + 1)));
    assert!(decode(path).validate().is_err());

    let mut full = request_with_change(json!({
        "kind": "full",
        "path": "/workspace/a.ts",
        "version": 2,
        "text": "😀".repeat(MAX_FULL_TEXT_UTF16_UNITS / 2)
    }));
    assert!(decode(full.clone()).validate().is_ok());
    full["change"]["text"] = json!(format!("{}x", full["change"]["text"].as_str().unwrap()));
    assert!(decode(full).validate().is_err());
}

#[test]
fn change_requires_exact_open_authority_and_monotonic_version() {
    let state = test_registry();
    let first = decode(request());
    assert_eq!(
        deliver(&state, &first, true),
        DocumentChangeAdmissionReceipt::NotOpen
    );
    open(&state, open_request(), true);
    assert_eq!(
        deliver(&state, &first, true),
        DocumentChangeAdmissionReceipt::Admitted
    );
    assert_eq!(
        deliver(&state, &first, true),
        DocumentChangeAdmissionReceipt::StaleVersion
    );

    let foreign_model = decode(mutate(request(), |value| {
        value["authority"]["modelIncarnation"] = json!("model-b");
        value["change"]["version"] = json!(3);
    }));
    assert_eq!(
        deliver(&state, &foreign_model, true),
        DocumentChangeAdmissionReceipt::StaleAuthority
    );
}

#[test]
fn close_tombstone_blocks_late_change_and_old_reopen() {
    let state = test_registry();
    open(&state, open_request(), true);
    let change = decode(request());
    assert_eq!(
        deliver(&state, &change, true),
        DocumentChangeAdmissionReceipt::Admitted
    );
    close(&state, close_request(2), true);
    let late = decode(mutate(request(), |value| {
        value["change"]["version"] = json!(3)
    }));
    assert_eq!(
        deliver(&state, &late, true),
        DocumentChangeAdmissionReceipt::NotOpen
    );
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &open_request(),
            "/workspace",
            "/workspace/a.ts",
            |_| panic!("old reopen must not send")
        )
        .expect("old reopen receipt"),
        DocumentOpenAdmissionReceipt::StaleAuthority
    );
}

#[test]
fn close_then_newer_sync_generation_reopens_but_rejects_a_to_b_to_a_late_events() {
    let state = test_registry();
    open(&state, open_request(), true);
    close(&state, close_request(1), true);
    let newer_open = mutate(open_request_value(), |value| {
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
        value["authority"]["syncGeneration"] = json!(4);
        value["predecessorLifecycleToken"] = json!("lsp-document-lifecycle-1");
    });
    open(&state, decode_open(newer_open), true);

    let late_a = decode(request());
    assert_eq!(
        deliver(&state, &late_a, true),
        DocumentChangeAdmissionReceipt::StaleAuthority
    );
    let b = decode(mutate(request(), |value| {
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
        value["authority"]["syncGeneration"] = json!(4);
        value["authority"]["lifecycleToken"] = json!("lsp-document-lifecycle-2");
    }));
    assert_eq!(
        deliver(&state, &b, true),
        DocumentChangeAdmissionReceipt::Admitted
    );
}

#[test]
fn stale_session_and_failed_send_do_not_mutate_lifecycle() {
    let state = test_registry();
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &open_request(),
            "/workspace",
            "/workspace/a.ts",
            |_| Ok(false)
        )
        .expect("failed-session receipt"),
        DocumentOpenAdmissionReceipt::StaleSession
    );
    assert_eq!(
        deliver(&state, &decode(request()), true),
        DocumentChangeAdmissionReceipt::NotOpen
    );
    open(&state, open_request(), true);
    let foreign_session = decode(mutate(request(), |value| {
        value["expectedSessionId"] = json!(9)
    }));
    assert_eq!(
        deliver(&state, &foreign_session, true),
        DocumentChangeAdmissionReceipt::StaleSession
    );
}

#[test]
fn foreign_server_lifecycle_token_fails_closed() {
    let state = test_registry();
    open(&state, open_request(), true);
    let foreign = decode(mutate(request(), |value| {
        value["authority"]["lifecycleToken"] = json!("foreign-token");
    }));
    assert_eq!(
        deliver(&state, &foreign, true),
        DocumentChangeAdmissionReceipt::StaleAuthority
    );
    let foreign_close: BoundedDocumentDidCloseRequest =
        serde_json::from_value(mutate(close_request_value(1), |value| {
            value["authority"]["lifecycleToken"] = json!("foreign-token");
        }))
        .expect("foreign close");
    assert_eq!(
        deliver_validated_document_close(
            &state,
            &foreign_close,
            "/workspace",
            "/workspace/a.ts",
            |_| panic!("foreign close must not send")
        )
        .expect("foreign close receipt"),
        DocumentChangeAdmissionReceipt::StaleAuthority
    );
}

#[test]
fn purge_during_irreversible_send_never_reports_admitted() {
    let state = test_registry();
    let pending_open = open_request();
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &pending_open,
            "/workspace",
            "/workspace/a.ts",
            |_| {
                state.purge_all().expect("concurrent purge");
                Ok(true)
            }
        )
        .expect("purged open receipt"),
        DocumentOpenAdmissionReceipt::StaleSession
    );

    open(&state, open_request(), true);
    let change = decode(mutate(request(), |value| {
        value["authority"]["lifecycleToken"] = json!("lsp-document-lifecycle-2");
    }));
    assert_eq!(
        deliver_validated_document_change(&state, &change, "/workspace", "/workspace/a.ts", |_| {
            state.purge_all().expect("concurrent purge");
            Ok(true)
        })
        .expect("purged change receipt"),
        DocumentChangeAdmissionReceipt::StaleSession
    );
}

#[test]
fn duplicate_open_and_close_are_idempotent_without_duplicate_notifications() {
    let state = test_registry();
    open(&state, open_request(), true);
    assert_eq!(
        deliver_validated_document_open(
            &state,
            &open_request(),
            "/workspace",
            "/workspace/a.ts",
            |_| panic!("duplicate open must not send")
        )
        .expect("duplicate open"),
        DocumentOpenAdmissionReceipt::Admitted {
            lifecycle_token: "lsp-document-lifecycle-1".to_string()
        }
    );
    for divergent in [
        mutate(open_request_value(), |value| {
            value["text"] = json!("export const divergent = true;");
        }),
        mutate(open_request_value(), |value| {
            value["languageId"] = json!("javascript");
        }),
    ] {
        assert_eq!(
            deliver_validated_document_open(
                &state,
                &decode_open(divergent),
                "/workspace",
                "/workspace/a.ts",
                |_| panic!("divergent duplicate open must not send"),
            )
            .expect("divergent duplicate receipt"),
            DocumentOpenAdmissionReceipt::StaleAuthority
        );
    }
    close(&state, close_request(1), true);
    assert_eq!(
        deliver_validated_document_close(
            &state,
            &close_request(1),
            "/workspace",
            "/workspace/a.ts",
            |_| panic!("duplicate close must not send")
        )
        .expect("duplicate close"),
        DocumentChangeAdmissionReceipt::Admitted
    );
}

#[test]
fn close_waits_for_inflight_change_and_blocks_late_change() {
    let state = Arc::new(test_registry());
    open(&state, open_request(), true);
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let change_state = Arc::clone(&state);
    let change_entered = Arc::clone(&entered);
    let change_release = Arc::clone(&release);
    let change_thread = std::thread::spawn(move || {
        deliver_validated_document_change(
            &change_state,
            &decode(request()),
            "/workspace",
            "/workspace/a.ts",
            |_| {
                change_entered.wait();
                change_release.wait();
                Ok(true)
            },
        )
    });
    entered.wait();
    let close_state = Arc::clone(&state);
    let (sent_tx, sent_rx) = mpsc::channel();
    let close_thread = std::thread::spawn(move || {
        deliver_validated_document_close(
            &close_state,
            &close_request(2),
            "/workspace",
            "/workspace/a.ts",
            |_| {
                sent_tx.send(()).expect("close sent");
                Ok(true)
            },
        )
    });
    assert!(sent_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release.wait();
    assert_eq!(
        change_thread
            .join()
            .expect("change thread")
            .expect("change"),
        DocumentChangeAdmissionReceipt::Admitted
    );
    sent_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("ordered close");
    assert_eq!(
        close_thread.join().expect("close thread").expect("close"),
        DocumentChangeAdmissionReceipt::Admitted
    );
    let late = decode(mutate(request(), |value| {
        value["change"]["version"] = json!(3)
    }));
    assert_eq!(
        deliver(&state, &late, true),
        DocumentChangeAdmissionReceipt::NotOpen
    );
}

#[test]
fn backpressure_is_per_document_and_does_not_hold_global_mutex() {
    let state = Arc::new(test_registry());
    open(&state, open_request(), true);
    let other_open = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
    }));
    open(&state, other_open, true);
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let blocked_state = Arc::clone(&state);
    let blocked_entered = Arc::clone(&entered);
    let blocked_release = Arc::clone(&release);
    let thread = std::thread::spawn(move || {
        deliver_validated_document_change(
            &blocked_state,
            &decode(request()),
            "/workspace",
            "/workspace/a.ts",
            |_| {
                blocked_entered.wait();
                blocked_release.wait();
                Ok(true)
            },
        )
    });
    entered.wait();
    let other_change = decode(mutate(request(), |value| {
        value["change"]["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
        value["authority"]["lifecycleToken"] = json!("lsp-document-lifecycle-2");
    }));
    assert_eq!(
        deliver(&state, &other_change, true),
        DocumentChangeAdmissionReceipt::Admitted
    );
    release.wait();
    assert_eq!(
        thread.join().expect("blocked thread").expect("delivery"),
        DocumentChangeAdmissionReceipt::Admitted
    );
}

#[test]
fn lifecycle_capacity_is_bounded_and_restart_purge_releases_it() {
    let state = test_registry();
    {
        let mut inner = lock_admission(&state).expect("bounded state");
        inner.max_documents = 1;
        inner.max_tombstones = 1;
    }
    open(&state, open_request(), true);
    close(&state, close_request(1), true);
    let other = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
    }));
    open(&state, other, true);
    state.purge_root("/workspace").expect("restart purge");
    open(&state, open_request(), true);
}

#[test]
fn tombstone_capacity_quarantines_root_until_exact_session_transition() {
    let state = test_registry();
    {
        let mut inner = lock_admission(&state).expect("bounded state");
        inner.max_documents = 2;
        inner.max_tombstones = 1;
    }
    open(&state, open_request(), true);
    close(&state, close_request(1), true);

    let second_open = decode_open(mutate(open_request_value(), |value| {
        value["path"] = json!("/workspace/b.ts");
        value["authority"]["documentIncarnation"] = json!("document-b");
        value["authority"]["modelIncarnation"] = json!("model-b");
    }));
    open(&state, second_open, true);
    let second_close: BoundedDocumentDidCloseRequest =
        serde_json::from_value(mutate(close_request_value(1), |value| {
            value["path"] = json!("/workspace/b.ts");
            value["authority"]["documentIncarnation"] = json!("document-b");
            value["authority"]["modelIncarnation"] = json!("model-b");
            value["authority"]["lifecycleToken"] = json!("lsp-document-lifecycle-2");
        }))
        .expect("second close");
    assert_eq!(
        deliver_validated_document_close(
            &state,
            &second_close,
            "/workspace",
            "/workspace/b.ts",
            |_| Ok(true)
        )
        .expect("second close receipt"),
        DocumentChangeAdmissionReceipt::Admitted
    );

    {
        let inner = lock_admission(&state).expect("bounded state");
        assert!(inner.closed_order.is_empty());
        assert!(inner.documents.is_empty());
        assert!(inner.quarantined_roots.contains("/workspace"));
    }
    for replay in [
        open_request_value(),
        mutate(open_request_value(), |value| {
            value["path"] = json!("/workspace/c.ts");
            value["authority"]["documentIncarnation"] = json!("document-c");
            value["authority"]["modelIncarnation"] = json!("model-c");
        }),
    ] {
        let replay = decode_open(replay);
        assert_eq!(
            deliver_validated_document_open(
                &state,
                &replay,
                "/workspace",
                &replay.path,
                |_| panic!("quarantined root must not send"),
            )
            .expect("quarantined receipt"),
            DocumentOpenAdmissionReceipt::StaleAuthority
        );
    }

    state
        .begin_exact_session_transition("/workspace", 9)
        .expect("replacement session");
    let replacement = decode_open(mutate(open_request_value(), |value| {
        value["expectedSessionId"] = json!(9);
    }));
    open(&state, replacement, true);
}

fn deliver(
    state: &DocumentChangeAdmissionRegistry,
    request: &BoundedDocumentDidChangeRequest,
    admitted: bool,
) -> DocumentChangeAdmissionReceipt {
    deliver_validated_document_change(state, request, "/workspace", request.path(), |_| {
        Ok(admitted)
    })
    .expect("delivery receipt")
}

fn open(
    state: &DocumentChangeAdmissionRegistry,
    request: BoundedDocumentDidOpenRequest,
    admitted: bool,
) {
    let receipt =
        deliver_validated_document_open(state, &request, "/workspace", &request.path, |_| {
            Ok(admitted)
        })
        .expect("open receipt");
    match (admitted, receipt) {
        (true, DocumentOpenAdmissionReceipt::Admitted { lifecycle_token }) => {
            assert!(!lifecycle_token.is_empty());
        }
        (false, DocumentOpenAdmissionReceipt::StaleSession) => {}
        (_, other) => panic!("unexpected open receipt: {other:?}"),
    }
}

fn close(
    state: &DocumentChangeAdmissionRegistry,
    request: BoundedDocumentDidCloseRequest,
    admitted: bool,
) {
    assert_eq!(
        deliver_validated_document_close(state, &request, "/workspace", &request.path, |_| Ok(
            admitted
        ))
        .expect("close receipt"),
        if admitted {
            DocumentChangeAdmissionReceipt::Admitted
        } else {
            DocumentChangeAdmissionReceipt::StaleSession
        }
    );
}

fn decode(value: Value) -> BoundedDocumentDidChangeRequest {
    serde_json::from_value(value).expect("strict request")
}

fn decode_open(value: Value) -> BoundedDocumentDidOpenRequest {
    serde_json::from_value(value).expect("strict open request")
}

fn open_request() -> BoundedDocumentDidOpenRequest {
    decode_open(open_request_value())
}

fn open_request_value() -> Value {
    json!({
        "authority": lifecycle_authority(),
        "expectedSessionId": 8,
        "languageId": "typescript",
        "path": "/workspace/a.ts",
        "predecessorLifecycleToken": null,
        "rootPath": "/workspace",
        "text": "export {};",
        "version": 1
    })
}

fn close_request(version: u64) -> BoundedDocumentDidCloseRequest {
    serde_json::from_value(close_request_value(version)).expect("strict close request")
}

fn close_request_value(version: u64) -> Value {
    json!({
        "authority": authority(),
        "expectedSessionId": 8,
        "path": "/workspace/a.ts",
        "rootPath": "/workspace",
        "version": version
    })
}

fn authority() -> Value {
    let mut value = lifecycle_authority();
    value.as_object_mut().expect("authority").insert(
        "lifecycleToken".to_string(),
        json!("lsp-document-lifecycle-1"),
    );
    value
}

fn lifecycle_authority() -> Value {
    json!({
        "documentIncarnation": "document-a",
        "modelIncarnation": "model-a",
        "ownerGeneration": 2,
        "ownerIncarnation": "owner-a",
        "ownerKey": "workspace-a",
        "syncGeneration": 3
    })
}

fn request() -> Value {
    request_with_change(json!({
        "kind": "incremental",
        "path": "/workspace/a.ts",
        "version": 2,
        "changes": [change(1, 0, 1, 1, "x")]
    }))
}

fn request_with(extra: Value) -> Value {
    let mut value = request();
    let object = value.as_object_mut().expect("request object");
    object.extend(extra.as_object().expect("extra object").clone());
    value
}

fn request_with_change(change: Value) -> Value {
    json!({
        "authority": authority(),
        "change": change,
        "expectedSessionId": 8,
        "rootPath": "/workspace"
    })
}

fn change(
    start_line: u64,
    start_character: u64,
    end_line: u64,
    end_character: u64,
    text: &str,
) -> Value {
    json!({
        "kind": "incremental",
        "range": {
            "start": { "line": start_line, "character": start_character },
            "end": { "line": end_line, "character": end_character }
        },
        "rangeLength": 0,
        "text": text
    })
}

fn mutate(mut value: Value, update: impl FnOnce(&mut Value)) -> Value {
    update(&mut value);
    value
}
