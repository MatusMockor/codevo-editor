use super::*;

fn seed_closed_rows(journaled: &Journaled, turn_id: &str, count: usize, created_at: i64) {
    let mut connection = journaled.raw();
    let transaction = connection.transaction().unwrap();
    for index in 0..count {
        transaction
            .execute(
                "INSERT INTO runtime_requests(thread_id,turn_id,request_id,kind,status,reason,
                    run_id,version,reg_index,format,body,outcome,anchor_tool_id,created_at,
                    updated_at,resolved_at)
                 SELECT thread_id,?1,?2,kind,'expired','turnEnded',run_id,1,?3,format,body,NULL,
                    NULL,?4,?4,?4
                 FROM runtime_requests WHERE request_id='template'",
                rusqlite::params![
                    turn_id,
                    format!("seed-{index:05}"),
                    index as i64 + 10,
                    created_at + index as i64
                ],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
}

#[test]
fn turn_cap_prunes_the_oldest_closed_request_and_reports_truncation() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-template",
            1,
            1,
            vec![question("template", ObservedState::Pending)],
        ),
    );
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-open", ObservedState::Pending)]),
    );
    seed_closed_rows(&journaled, TURN, MAX_REQUESTS_PER_TURN - 1, 10);
    let pruned_marks = || -> i64 {
        journaled
            .raw()
            .query_row(
                "SELECT IFNULL(SUM(pruned),0) FROM runtime_request_marks",
                [],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(pruned_marks(), 0);

    let report = journaled.apply(
        RUN,
        &snapshot(
            2,
            vec![
                question("question-open", ObservedState::Pending),
                question("question-new", ObservedState::Pending),
            ],
        ),
    );

    assert_eq!(
        (report.transitions, report.pruned, report.skipped),
        (1, 1, 0)
    );
    let in_turn = |request_id: &str| -> i64 {
        journaled
            .raw()
            .query_row(
                "SELECT COUNT(*) FROM runtime_requests WHERE turn_id=?1 AND request_id=?2",
                [TURN, request_id],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(in_turn("seed-00000"), 0);
    assert_eq!(in_turn("seed-00001"), 1);
    assert_eq!(in_turn("question-open"), 1);
    assert_eq!(in_turn("question-new"), 1);
    assert_eq!(in_turn("template"), 0);
    assert_eq!(pruned_marks(), 1);
    let read = journaled.read();
    assert!(read.truncated);
    assert_eq!(read.requests.len(), 256);
    assert!(read
        .requests
        .iter()
        .any(|request| request.parts().id == "question-open"));
}

#[test]
fn open_requests_are_never_pruned_and_an_unplaceable_request_is_counted() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("template", ObservedState::Pending)]),
    );
    seed_closed_rows(&journaled, TURN, MAX_REQUESTS_PER_TURN - 1, 10);
    journaled
        .raw()
        .execute_batch("UPDATE runtime_requests SET status='pending',reason=NULL,resolved_at=NULL")
        .unwrap();
    let mut listed: Vec<ObservedRequest> = (0..MAX_REQUESTS_PER_TURN - 1)
        .map(|index| question(&format!("seed-{index:05}"), ObservedState::Pending))
        .collect();
    listed.push(question("template", ObservedState::Pending));
    listed.push(question("question-new", ObservedState::Pending));

    let report = journaled.apply(RUN, &snapshot(2, listed));

    assert_eq!(
        (report.transitions, report.pruned, report.skipped),
        (0, 0, 1)
    );
    assert_eq!(journaled.row_count(), MAX_REQUESTS_PER_TURN as i64);
    assert!(journaled.read().truncated);
}

fn filled_thread() -> Journaled {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-template",
            1,
            900_000,
            vec![question("template", ObservedState::Pending)],
        ),
    );
    let per_turn = MAX_REQUESTS_PER_TURN - 1;
    let mut seeded = 1;
    let mut turn = 0;
    while seeded < MAX_REQUESTS_PER_THREAD {
        let count = per_turn.min(MAX_REQUESTS_PER_THREAD - seeded);
        seed_closed_rows(
            &journaled,
            &format!("agt-turn-seed-{turn:02}"),
            count,
            1_000 * (turn as i64 + 1),
        );
        seeded += count;
        turn += 1;
    }
    journaled
}

fn turn_state_of(journaled: &Journaled, turn_id: &str) -> Option<String> {
    journaled
        .raw()
        .query_row(
            "SELECT suppressed FROM runtime_request_turns WHERE thread_id=?1 AND turn_id=?2",
            [THREAD, turn_id],
            |row| row.get(0),
        )
        .optional()
        .unwrap()
}

#[test]
fn thread_cap_prunes_the_oldest_closed_request_of_the_thread() {
    let journaled = filled_thread();
    journaled
        .raw()
        .execute(
            "INSERT INTO runtime_request_turns(
                thread_id,turn_id,run_id,applied_sequence,suppressed,incarnation)
             VALUES(?1,'agt-turn-seed-00',?2,1,'[]',?3)",
            rusqlite::params![THREAD, RUN, INCARNATION as i64],
        )
        .unwrap();
    assert_eq!(journaled.row_count(), MAX_REQUESTS_PER_THREAD as i64);

    let report = journaled.apply(
        RUN,
        &snapshot_of(
            TURN,
            2,
            950_000,
            vec![question("question-new", ObservedState::Pending)],
        ),
    );

    assert_eq!((report.transitions, report.pruned), (1, 1));
    assert_eq!(journaled.row_count(), MAX_REQUESTS_PER_THREAD as i64);
    let oldest: i64 = journaled
        .raw()
        .query_row(
            "SELECT COUNT(*) FROM runtime_requests
             WHERE turn_id='agt-turn-seed-00' AND request_id='seed-00000'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(oldest, 0);
    let read = journaled.read();
    assert!(read.truncated);
    assert_eq!(read.requests.len(), 256);
    let ids: Vec<&str> = read
        .requests
        .iter()
        .map(|request| request.parts().id.as_str())
        .collect();
    assert!(ids.contains(&"template"));
    assert!(ids.contains(&"question-new"));

    let relisted = journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-seed-00",
            3,
            960_000,
            vec![
                question("seed-00000", expired()),
                question("seed-00001", expired()),
            ],
        ),
    );
    assert_eq!((relisted.transitions, relisted.pruned), (0, 0));
    assert_eq!(journaled.row_count(), MAX_REQUESTS_PER_THREAD as i64);
    assert_eq!(
        turn_state_of(&journaled, "agt-turn-seed-00").as_deref(),
        Some(r#"[{"id":"seed-00000","kind":"question"}]"#)
    );
}

#[test]
fn pruning_a_request_of_a_turn_whose_watermark_was_swept_never_recreates_the_watermark() {
    let journaled = filled_thread();
    assert_eq!(journaled.row_count(), MAX_REQUESTS_PER_THREAD as i64);
    assert_eq!(journaled.turn_state_count(), 1);

    let report = journaled.apply(
        RUN,
        &snapshot_of(
            TURN,
            2,
            950_000,
            vec![question("question-new", ObservedState::Pending)],
        ),
    );

    assert_eq!((report.transitions, report.pruned), (1, 1));
    let oldest: i64 = journaled
        .raw()
        .query_row(
            "SELECT COUNT(*) FROM runtime_requests
             WHERE turn_id='agt-turn-seed-00' AND request_id='seed-00000'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(oldest, 0);
    assert_eq!(turn_state_of(&journaled, "agt-turn-seed-00"), None);
    assert_eq!(journaled.turn_state_count(), 2);
    assert_eq!(turn_state_of(&journaled, TURN).as_deref(), Some("[]"));
    assert_eq!(
        turn_state_of(&journaled, "agt-turn-template").as_deref(),
        Some("[]")
    );
}

#[test]
fn rows_from_a_newer_build_are_counted_as_unreadable_and_left_untouched() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                question("question-3", ObservedState::Pending),
                question("question-4", ObservedState::Pending),
                question("question-5", ObservedState::Pending),
                question("question-6", ObservedState::Pending),
                question("question-7", ObservedState::Pending),
                question("question-8", ObservedState::Pending),
                question("question-9", ObservedState::Pending),
            ],
        ),
    );
    journaled
        .raw()
        .execute_batch(
            "UPDATE runtime_requests SET status=x'ff' WHERE request_id='question-7';
             UPDATE runtime_requests SET created_at='soon' WHERE request_id='question-8';
             UPDATE runtime_requests SET body=x'00ff',kind='notice' WHERE request_id='question-9';
             UPDATE runtime_requests SET format=7 WHERE request_id='question-1';
             UPDATE runtime_requests SET status='deferred' WHERE request_id='question-2';
             UPDATE runtime_requests SET body='{\"provider\":\"codex\"}' WHERE request_id='question-3';
             UPDATE runtime_requests SET status='expired',reason='userDismissed',resolved_at=5
                WHERE request_id='question-4';
             UPDATE runtime_requests SET version=-4 WHERE request_id='question-5';",
        )
        .unwrap();
    let untouched = journaled.dump();

    let read = journaled.read();
    assert_eq!(read.unreadable, 8);
    assert_eq!(read.requests.len(), 1);
    assert_eq!(read.requests[0].parts().id, "question-6");
    for (request_id, receipt) in [
        ("question-1", IntentReceipt::Refused),
        ("question-2", IntentReceipt::NotJournaled),
        ("question-7", IntentReceipt::NotJournaled),
        ("question-9", IntentReceipt::NotJournaled),
    ] {
        assert_eq!(
            journaled.intend(RUN, request_id, 2),
            receipt,
            "{request_id}"
        );
    }
    assert_eq!(journaled.dump(), untouched);

    let closing = snapshot(
        2,
        vec![
            question("question-1", expired()),
            question("question-2", expired()),
            question("question-3", ObservedState::Pending),
            question("question-4", expired()),
            question("question-5", ObservedState::Pending),
            question("question-6", ObservedState::Pending),
            question("question-7", expired()),
            question("question-8", ObservedState::Pending),
            question("question-9", expired()),
        ],
    );
    assert_eq!(
        journaled.apply(RUN, &closing),
        ApplyReport::default(),
        "rows this build cannot read are neither rewritten nor counted as conflicts"
    );
    assert_eq!(journaled.dump(), untouched);
    journaled.recover_as(NEXT_RUN, 9_000);
    assert!(journaled.dump()[1].contains(":deferred:"));
    assert!(journaled.dump()[6].contains(":blob:"));
    assert_eq!(journaled.read().unreadable, 8);
}

#[test]
fn request_id_reused_by_the_other_kind_is_not_overwritten() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("shared-1", ObservedState::Pending)]),
    );
    let before = journaled.dump();

    let report = journaled.apply(
        RUN,
        &snapshot(2, vec![approval("shared-1", ObservedState::Pending)]),
    );

    assert_eq!((report.transitions, report.skipped), (0, 1));
    assert_eq!(journaled.dump(), before);
    assert!(journaled.read().truncated);
}

#[test]
fn requests_are_read_in_receiver_order_within_the_requested_window() {
    let journaled = Journaled::new();
    let closed_turn = |turn_id: &str, sequence: u64, at: u64| {
        snapshot_of(
            turn_id,
            sequence,
            at,
            vec![
                question("question-b", expired()),
                question("question-a", expired()),
            ],
        )
    };
    journaled.apply(RUN, &closed_turn("agt-turn-0002", 2, 2_000));
    journaled.apply(RUN, &closed_turn("agt-turn-0001", 1, 1_000));
    journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-0000",
            3,
            500,
            vec![question("question-open", ObservedState::Pending)],
        ),
    );
    let order = |read: &StoredRequests| -> Vec<String> {
        read.requests
            .iter()
            .map(|request| format!("{}/{}", request.parts().turn_id, request.parts().id))
            .collect()
    };

    let all = journaled.read();
    assert_eq!(
        order(&all),
        [
            "agt-turn-0000/question-open",
            "agt-turn-0001/question-b",
            "agt-turn-0001/question-a",
            "agt-turn-0002/question-b",
            "agt-turn-0002/question-a",
        ]
    );
    assert!(!all.truncated);

    let window = journaled
        .store
        .read(&journaled.scope, THREAD, 2)
        .expect("read window");
    assert_eq!(
        order(&window),
        ["agt-turn-0000/question-open", "agt-turn-0002/question-a"]
    );
    assert!(window.truncated);
}

#[test]
fn page_exhaustion_on_a_raw_connection_fails_the_write_as_full_and_rolls_it_back() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    let mut connection = journaled.raw();
    let pages: i64 = connection
        .pragma_query_value(None, "page_count", |row| row.get(0))
        .unwrap();
    connection
        .pragma_update(None, "max_page_count", pages)
        .unwrap();
    let mut large = question("question-large", ObservedState::Pending);
    large.body = question_body(&"x".repeat(8_000));
    let listed: Vec<ObservedRequest> = (0..48)
        .map(|index| ObservedRequest {
            id: format!("question-large-{index}"),
            ..large.clone()
        })
        .chain([question("question-1", expired())])
        .collect();

    let failure = runtime_requests::apply_snapshot(&mut connection, RUN, &snapshot(2, listed))
        .expect_err("a full database refuses the write");

    assert_eq!(failure.kind, StoreErrorKind::Full);
    drop(connection);
    assert_eq!(journaled.row_count(), 1);
    assert_eq!(journaled.only()["status"], json!("pending"));
}

#[test]
fn runtime_request_tables_are_additive_and_keep_the_released_schema_version() {
    let journaled = Journaled::new();
    let fixture = &journaled.fixture;
    let mut saved = thread();
    saved.turns = vec![turn(1)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    let pending = snapshot(1, vec![question("question-1", ObservedState::Pending)]);
    journaled.apply(RUN, &pending);
    let version = || -> i64 {
        raw_history(fixture)
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    };
    assert_eq!(version(), 2);

    raw_history(fixture)
        .execute_batch("CREATE TABLE from_a_newer_build(id INTEGER PRIMARY KEY);")
        .unwrap();
    for _ in 0..2 {
        let reopened = AgentHistoryStore::new(fixture.base.clone());
        assert_eq!(reopened.load(ROOT, &owner()).unwrap().threads.len(), 1);
        assert_eq!(
            reopened
                .read_turns(ROOT, &owner(), THREAD, None)
                .unwrap()
                .turns
                .len(),
            1
        );
    }
    assert_eq!(version(), 2);
    assert_eq!(journaled.row_count(), 1);
    assert_eq!(journaled.only()["status"], json!("pending"));
}

#[test]
fn history_written_before_the_runtime_request_tables_existed_gains_them_when_it_is_claimed() {
    let fixture = Fixture::new();
    fixture.store.save(ROOT, &owner(), &thread(), 0).unwrap();
    raw_history(&fixture)
        .execute_batch(
            "DROP INDEX runtime_requests_open;
             DROP INDEX runtime_requests_order;
             DROP TABLE runtime_requests;
             DROP TABLE runtime_request_marks;
             DROP TABLE runtime_request_turns;",
        )
        .unwrap();
    let journaled = Journaled::over(fixture);
    let fixture = &journaled.fixture;

    let pending = snapshot(1, vec![question("question-1", ObservedState::Pending)]);
    assert_eq!(journaled.apply(RUN, &pending).transitions, 1);

    assert_eq!(journaled.only()["status"], json!("pending"));
    assert_eq!(
        AgentHistoryStore::new(fixture.base.clone())
            .load(ROOT, &owner())
            .unwrap()
            .threads
            .len(),
        1
    );
}

#[test]
fn open_path_that_never_touches_the_runtime_request_tables_still_serves_history() {
    let journaled = Journaled::new();
    let fixture = &journaled.fixture;
    let mut saved = thread();
    saved.turns = vec![turn(1)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    journaled.intend(RUN, "question-1", 2);

    let tables_known_to_the_released_open_path = [
        "history_owner",
        "threads",
        "import_identity",
        "turns",
        "attachment_cleanup",
        "tombstones",
        "migrated",
        "turn_halt_requests",
    ];
    let connection = raw_history(fixture);
    for table in tables_known_to_the_released_open_path {
        let present: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert!(present, "{table}");
    }
    let read_only = connection::open_read_only(&fixture.base, ROOT)
        .expect("open read only")
        .expect("existing database");
    let threads: i64 = read_only
        .query_row("SELECT COUNT(*) FROM threads", [], |row| row.get(0))
        .unwrap();
    assert_eq!(threads, 1);
    assert_eq!(
        connection::ownership_status(&fixture.base, ROOT, THREAD),
        Ok(Some(true))
    );
    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, THREAD, "agt-turn-0001");
    assert!(facts.is_ok());
}

#[test]
fn journaled_requests_stay_out_of_the_thread_and_turn_payloads() {
    let journaled = Journaled::new();
    let fixture = &journaled.fixture;
    let mut saved = thread();
    saved.turns = vec![turn(1)];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    let payloads = || -> (String, String) {
        let connection = raw_history(fixture);
        (
            connection
                .query_row("SELECT payload FROM threads", [], |row| row.get(0))
                .unwrap(),
            connection
                .query_row("SELECT payload FROM turns", [], |row| row.get(0))
                .unwrap(),
        )
    };
    let before = payloads();

    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    journaled.intend(RUN, "question-1", 2);
    journaled.apply(
        RUN,
        &snapshot(
            3,
            vec![question(
                "question-1",
                ObservedState::Resolved(answers("Nothing else.")),
            )],
        ),
    );

    assert_eq!(payloads(), before);
    assert!(serde_json::from_str::<AgentThread>(&before.0).is_ok());
    assert!(serde_json::from_str::<AgentTurn>(&before.1).is_ok());
    let page = fixture
        .store
        .read_turns(ROOT, &owner(), THREAD, None)
        .unwrap();
    assert_eq!(page.turns.len(), 1);
    assert_eq!(page.revision, 1);
}

#[test]
fn write_is_refused_for_a_scope_that_does_not_own_the_database() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", ObservedState::Pending)]),
    );
    let foreign = HistoryScope {
        root_key: ROOT.to_string(),
        owner_id: legacy::agent_root_owner_id("/workspace/other"),
    };

    let refused = journaled.store.apply_snapshot(
        &foreign,
        RUN,
        &snapshot(2, vec![question("question-1", expired())]),
    );

    assert_eq!(
        refused.map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert_eq!(journaled.only()["status"], json!("pending"));
}

#[test]
fn pruned_request_still_listed_by_its_live_session_is_never_journaled_again() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-template",
            1,
            1,
            vec![question("template", ObservedState::Pending)],
        ),
    );
    let listed = |extra: Option<ObservedRequest>| -> Vec<ObservedRequest> {
        [
            Some(question("question-old", expired())),
            Some(question("question-open", ObservedState::Pending)),
            extra,
        ]
        .into_iter()
        .flatten()
        .collect()
    };
    journaled.apply(RUN, &snapshot(2, listed(None)));
    seed_closed_rows(&journaled, TURN, MAX_REQUESTS_PER_TURN - 2, 50_000);
    let in_turn = |request_id: &str| -> i64 {
        journaled
            .raw()
            .query_row(
                "SELECT COUNT(*) FROM runtime_requests WHERE turn_id=?1 AND request_id=?2",
                [TURN, request_id],
                |row| row.get(0),
            )
            .unwrap()
    };

    let grown = journaled.apply(
        RUN,
        &snapshot(
            3,
            listed(Some(question("question-new", ObservedState::Pending))),
        ),
    );
    assert_eq!((grown.transitions, grown.pruned), (1, 1));
    assert_eq!(in_turn("question-old"), 0);
    let settled = journaled.dump();

    let relisted = journaled.apply(
        RUN,
        &snapshot(
            4,
            listed(Some(question("question-new", ObservedState::Pending))),
        ),
    );
    assert_eq!(
        (relisted.transitions, relisted.pruned, relisted.skipped),
        (0, 0, 0)
    );
    let delayed = journaled.apply(
        RUN,
        &snapshot(3, vec![question("question-old", ObservedState::Pending)]),
    );
    assert!(delayed.stale);
    let resurrecting = journaled.apply(
        RUN,
        &snapshot(
            5,
            vec![
                question("question-old", ObservedState::Pending),
                question("question-open", ObservedState::Pending),
                question("question-new", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(resurrecting.transitions, 0);
    assert_eq!(in_turn("question-old"), 0);
    assert_eq!(journaled.dump(), settled);
    let suppressed: String = journaled
        .raw()
        .query_row(
            "SELECT suppressed FROM runtime_request_turns WHERE turn_id=?1",
            [TURN],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(suppressed, r#"[{"id":"question-old","kind":"question"}]"#);

    journaled.recover_as(NEXT_RUN, 9_000_000);
    assert_eq!(journaled.turn_state_count(), 0);
}

#[test]
fn suppression_remembers_only_what_a_live_session_can_still_list() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot_of(
            "agt-turn-template",
            1,
            1,
            vec![question("template", ObservedState::Pending)],
        ),
    );
    journaled.apply(
        RUN,
        &snapshot(2, vec![question("question-open", ObservedState::Pending)]),
    );
    seed_closed_rows(&journaled, TURN, MAX_REQUESTS_PER_TURN - 1, 50_000);
    let retained = crate::agent_questions::MAX_RETAINED_AGENT_QUESTIONS;
    let mut listed = vec![question("question-open", ObservedState::Pending)];
    for index in 0..retained + 3 {
        listed.push(question(
            &format!("question-new-{index}"),
            ObservedState::Pending,
        ));
        let report = journaled.apply(RUN, &snapshot(3 + index as u64, listed.clone()));
        assert_eq!((report.transitions, report.pruned), (1, 1), "{index}");
    }

    let suppressed: String = journaled
        .raw()
        .query_row(
            "SELECT suppressed FROM runtime_request_turns WHERE turn_id=?1",
            [TURN],
            |row| row.get(0),
        )
        .unwrap();
    let suppressed: Vec<Value> = serde_json::from_str(&suppressed).unwrap();
    assert_eq!(suppressed.len(), retained);
    assert_eq!(suppressed[0]["id"], json!("seed-00003"));
    assert_eq!(
        suppressed[retained - 1]["id"],
        json!(format!("seed-{:05}", retained + 2))
    );
}

#[test]
fn snapshot_at_or_below_the_applied_watermark_is_ignored_entirely() {
    let journaled = Journaled::new();
    let untouched = journaled.apply(RUN, &snapshot(4, Vec::new()));
    assert_eq!(untouched, ApplyReport::default());
    assert_eq!(journaled.turn_state_count(), 0);

    journaled.apply(
        RUN,
        &snapshot(5, vec![question("question-1", ObservedState::Pending)]),
    );
    assert_eq!(journaled.turn_state_count(), 1);
    for sequence in [3, 5] {
        let stale = journaled.apply(
            RUN,
            &snapshot(
                sequence,
                vec![
                    question("question-0", ObservedState::Pending),
                    question("question-1", expired()),
                ],
            ),
        );
        assert_eq!(
            stale,
            ApplyReport {
                stale: true,
                ..ApplyReport::default()
            },
            "{sequence}"
        );
    }

    assert_eq!(journaled.row_count(), 1);
    assert_eq!(journaled.only()["status"], json!("pending"));
}

#[test]
fn second_instance_cannot_claim_a_root_and_never_expires_the_first_instances_live_requests() {
    let first = Journaled::new();
    first.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                approval("approval-1", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(first.intend(RUN, "approval-1", 2), IntentReceipt::Recorded);
    let live = first.dump();

    let second = HistoryRuntimeRequestStore::new(first.fixture.base.clone());
    for now in [60_000, 61_000] {
        assert_eq!(
            second.claim_root(&first.scope, NEXT_RUN, now),
            Ok(RootClaim::HeldByAnotherInstance)
        );
    }
    let refused_write = second.apply_snapshot(
        &first.scope,
        NEXT_RUN,
        &snapshot(9, vec![question("question-1", expired())]),
    );
    let refused_intent = second.record_intent(
        &first.scope,
        NEXT_RUN,
        &intent("question-1", answers("stolen"), 9),
        before_deadline(),
    );
    let refused_read = second.read(&first.scope, THREAD, 256);
    assert_eq!(
        refused_write.map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert_eq!(
        refused_intent.map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert!(refused_read.is_err());
    assert_eq!(first.dump(), live);

    assert_eq!(
        first.store.claim_root(&first.scope, RUN, 62_000),
        Ok(RootClaim::AlreadyOwned)
    );
    let answered = first.apply(
        RUN,
        &snapshot(
            3,
            vec![
                question(
                    "question-1",
                    ObservedState::Resolved(answers("Nothing else.")),
                ),
                question("question-2", ObservedState::Pending),
                approval("approval-1", ObservedState::Resolved(decision())),
            ],
        ),
    );
    assert_eq!(answered.transitions, 2);

    let Journaled {
        fixture,
        store,
        scope,
    } = first;
    drop(store);
    assert_eq!(
        second.claim_root(&scope, NEXT_RUN, 70_000),
        Ok(RootClaim::Acquired(RecoveryReport {
            expired: 1,
            ..RecoveryReport::default()
        }))
    );
    let recovered = second.read(&scope, THREAD, 256).expect("read as the owner");
    let statuses: Vec<String> = recovered
        .requests
        .iter()
        .map(|request| {
            let wire = serde_json::to_value(request).expect("encode request");
            format!(
                "{}:{}",
                wire["status"].as_str().unwrap_or("?"),
                wire["responseCapability"]["reason"].as_str().unwrap_or("-")
            )
        })
        .collect();
    assert_eq!(
        statuses,
        [
            "resolved:unknown",
            "expired:appRestarted",
            "resolved:unknown"
        ]
    );
    drop(fixture);
}

#[test]
fn root_lease_is_a_private_regular_file_and_a_symlink_in_its_place_fails_closed() {
    use std::os::unix::fs::PermissionsExt;
    let owned = Journaled::new();
    let lease = connection::database_path(&owned.fixture.base, ROOT)
        .with_file_name("runtime-requests.lock");
    let metadata = fs::symlink_metadata(&lease).expect("lease file");
    assert!(metadata.file_type().is_file());
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);

    let other_root = "/workspace/other";
    let other_scope = HistoryScope {
        root_key: other_root.to_string(),
        owner_id: legacy::agent_root_owner_id(other_root),
    };
    let fixture = Fixture::new();
    AgentHistoryStore::new(fixture.base.clone())
        .load(other_root, &other_scope.owner_id)
        .expect("create the history database");
    let planted = connection::database_path(&fixture.base, other_root)
        .with_file_name("runtime-requests.lock");
    std::os::unix::fs::symlink(&lease, &planted).expect("plant a symlink");
    let store = HistoryRuntimeRequestStore::new(fixture.base.clone());

    let claimed = store.claim_root(&other_scope, RUN, 0);

    assert_eq!(
        claimed.map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
    assert_eq!(
        store
            .apply_snapshot(
                &other_scope,
                RUN,
                &snapshot(1, vec![question("question-1", ObservedState::Pending)])
            )
            .map_err(|error| error.kind),
        Err(StoreErrorKind::Unavailable)
    );
}
