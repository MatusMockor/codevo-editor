use super::super::projection::validate_summaries;
use super::super::wire::{
    lifecycle_bytes, AgentTurnContextDigest, AgentTurnDigestOccupancy, AgentTurnDigestProvider,
    AgentTurnDigestWire, AgentTurnLogBudget, AgentTurnLogSummary, MAX_LOG_COUNTER,
    MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES, MAX_SUMMARY_PROMPT_RESPONSE_BYTES,
    MAX_TURN_LIFECYCLE_BYTES, MAX_TURN_PROMPT_BYTES, MAX_TURN_SUMMARIES,
};
use super::*;

fn force_turn_bytes(temp: &TempLogStore, turn_id: &str, bytes: i64) {
    let connection = rusqlite::Connection::open(temp.database()).expect("open raw connection");
    connection
        .execute(
            "UPDATE turn_meta SET bytes = ?2 WHERE turn_id = ?1",
            rusqlite::params![turn_id, bytes],
        )
        .expect("force turn bytes");
}

fn sample_digest() -> AgentTurnDigestWire {
    AgentTurnDigestWire {
        version: 1,
        context: AgentTurnContextDigest {
            provider: AgentTurnDigestProvider::ClaudeCode,
            capacities: Vec::new(),
            primary: None,
            current: Some(AgentTurnDigestOccupancy {
                observed_at_epoch_ms: None,
                used_tokens: 1_200,
                context_window: 200_000,
            }),
            bounded: false,
        },
    }
}

#[test]
fn a_turn_continues_past_the_legacy_size_ceiling_and_reopens() {
    let temp = TempLogStore::create("no-ceiling");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    let legacy_ceiling = 256 * 1024 * 1024;
    force_turn_bytes(&temp, TURN_ID, legacy_ceiling);
    let receipt = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "over")]))
        .expect("append beyond the old ceiling");
    assert!(receipt.turn_bytes > legacy_ceiling);
    assert_eq!(receipt.budget, AgentTurnLogBudget::Ok);
    let reopened = store.open(&open_request(TURN_ID)).expect("reopen");
    store
        .append(&append_request(
            TURN_ID,
            reopened.writer_epoch,
            3,
            vec![entry(3, "continued")],
        ))
        .expect("append after reopen");
    let summaries = store.summarize(&summarize_request()).expect("summaries");
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::None));
    assert_eq!(summaries[0].event_count, 3);
}

#[test]
fn numeric_counter_exhaustion_refuses_atomically_without_a_false_loss() {
    let temp = TempLogStore::create("numeric-exhaustion");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    force_turn_bytes(&temp, TURN_ID, MAX_LOG_COUNTER);
    let refused = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "over")]))
        .expect_err("wire counters must remain exact");
    assert_eq!(code(refused), "budgetExhausted");
    let summaries = store.summarize(&summarize_request()).expect("summaries");
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::None));
    assert_eq!(summaries[0].event_count, 1);
    assert_eq!(summaries[0].bytes, MAX_LOG_COUNTER);
}

#[test]
fn exhausted_sequence_and_event_counters_roll_back_before_inserting() {
    for column in ["next_seq", "event_count"] {
        let temp = TempLogStore::create(column);
        let store = temp.store();
        let epoch = seed(&store, TURN_ID, 1);
        let connection = rusqlite::Connection::open(temp.database()).expect("raw connection");
        connection
            .execute(
                &format!("UPDATE turn_meta SET {column} = ?1 WHERE turn_id = ?2"),
                rusqlite::params![MAX_LOG_COUNTER, TURN_ID],
            )
            .expect("synthetic counter exhaustion");
        let next_seq = if column == "next_seq" {
            MAX_LOG_COUNTER
        } else {
            2
        };
        let refused = store
            .append(&append_request(
                TURN_ID,
                epoch,
                next_seq,
                vec![entry(next_seq, "over")],
            ))
            .expect_err("counter must not overflow the wire precision");
        assert_eq!(code(refused), "budgetExhausted");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM events WHERE turn_id = ?1",
                [TURN_ID],
                |row| row.get(0),
            )
            .expect("count events");
        assert_eq!(count, 1);
    }
}

#[test]
fn a_reported_loss_and_digest_survive_a_reopen() {
    let temp = TempLogStore::create("loss-digest");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);
    let digest = sample_digest();
    let mut request = append_request(TURN_ID, epoch, 3, vec![entry(3, "c")]);
    request.digest = Some(digest.clone());
    request.loss = loss(AgentTurnLogLossKind::LegacyWindow);

    store.append(&request).expect("append with digest and loss");
    let reopened = store.open(&open_request(TURN_ID)).expect("reopen");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(reopened.digest, Some(digest));
    assert_eq!(reopened.digest_through_seq, 3);
    assert_eq!(reopened.next_seq, 4);
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::LegacyWindow));
}

#[test]
fn a_prior_loss_is_recorded_only_while_the_turn_reports_no_loss() {
    let temp = TempLogStore::create("prior-loss");
    let store = temp.store();
    let mut first = open_request(TURN_ID);
    first.prior_loss = loss(AgentTurnLogLossKind::SupervisorGap);

    store.open(&first).expect("open with a prior loss");
    let recorded = store.summarize(&summarize_request()).expect("summaries");
    store
        .open(&open_request(TURN_ID))
        .expect("reopen without a loss");
    let retained = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(recorded[0].loss, loss(AgentTurnLogLossKind::SupervisorGap));
    assert_eq!(retained[0].loss, loss(AgentTurnLogLossKind::SupervisorGap));
}

#[test]
fn summaries_keep_the_most_recently_active_turns_and_order_them_by_activity() {
    let temp = TempLogStore::create("summary-activity");
    let store = temp.store();
    for index in 0..70 {
        let turn_id = format!("agt-turn-{index:04}");
        seed(&store, &turn_id, 1);
    }
    let revived = "agt-turn-0000";
    let epoch = store
        .open(&open_request(revived))
        .expect("reopen the oldest turn")
        .writer_epoch;
    store
        .append(&append_request(revived, epoch, 2, vec![entry(2, "late")]))
        .expect("append to the oldest turn");

    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let turn_ids: Vec<&str> = summaries
        .iter()
        .map(|summary| summary.turn_id.as_str())
        .collect();

    assert_eq!(summaries.len(), 64);
    assert_eq!(
        turn_ids.last(),
        Some(&revived),
        "the most recently active turn must be the newest summary: {turn_ids:?}"
    );
    assert!(
        !turn_ids.contains(&"agt-turn-0006"),
        "an idle turn must fall out of the bounded window before an active one: {turn_ids:?}"
    );
}

#[test]
fn summaries_are_bounded_and_ordered_by_turn() {
    let temp = TempLogStore::create("summaries");
    let store = temp.store();
    for index in 0..70 {
        let turn_id = format!("agt-turn-{index:04}");
        seed(&store, &turn_id, 1);
    }

    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(summaries.len(), 64);
    assert_eq!(summaries[0].turn_id, "agt-turn-0006");
    assert_eq!(summaries[63].turn_id, "agt-turn-0069");
    assert!(summaries.iter().all(|summary| summary.bytes > 0));
}

fn carried_summary(
    turn_id: &str,
    prompt: Option<&str>,
    prompt_omitted: bool,
) -> AgentTurnLogSummary {
    AgentTurnLogSummary {
        turn_id: turn_id.to_string(),
        event_count: 0,
        bytes: 0,
        loss: loss(AgentTurnLogLossKind::None),
        sealed: false,
        digest: None,
        prompt: prompt.map(str::to_string),
        prompt_omitted,
        lifecycle: None,
        lifecycle_omitted: false,
    }
}

fn lifecycle_summary(
    turn_id: &str,
    lifecycle: Value,
    lifecycle_omitted: bool,
) -> AgentTurnLogSummary {
    AgentTurnLogSummary {
        lifecycle: Some(lifecycle),
        lifecycle_omitted,
        ..carried_summary(turn_id, None, false)
    }
}

#[test]
fn the_first_prompt_of_a_turn_wins_and_a_later_one_is_ignored() {
    let temp = TempLogStore::create("prompt-first-wins");
    let store = temp.store();

    store
        .open(&prompted_open_request(TURN_ID, "the first prompt"))
        .expect("open with the first prompt");
    let reopened = store
        .open(&prompted_open_request(TURN_ID, "a different prompt"))
        .expect("a later prompt is never an error");
    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");

    assert_eq!(reopened.writer_epoch, 2);
    assert_eq!(summaries[0].prompt.as_deref(), Some("the first prompt"));
    assert!(!summaries[0].prompt_omitted);
}

#[test]
fn a_reopen_without_a_prompt_keeps_the_stored_prompt_through_an_append() {
    let temp = TempLogStore::create("prompt-retained");
    let store = temp.store();

    store
        .open(&prompted_open_request(TURN_ID, "the stored prompt"))
        .expect("open with a prompt");
    let lease = store
        .open(&open_request(TURN_ID))
        .expect("reopen without a prompt");
    store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            AGENT_TURN_LOG_SEQ_BASE,
            vec![entry(AGENT_TURN_LOG_SEQ_BASE, "first")],
        ))
        .expect("append after the reopen");
    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");

    assert_eq!(summaries[0].prompt.as_deref(), Some("the stored prompt"));
    assert!(!summaries[0].prompt_omitted);
    assert_eq!(summaries[0].event_count, 1);
}

#[test]
fn a_prompt_at_the_byte_ceiling_is_stored_and_a_larger_one_is_refused() {
    let temp = TempLogStore::create("prompt-ceiling");
    let store = temp.store();
    let ceiling = "p".repeat(MAX_TURN_PROMPT_BYTES);

    store
        .open(&prompted_open_request(TURN_ID, &ceiling))
        .expect("a prompt at the ceiling is accepted");
    let refused = store
        .open(&prompted_open_request(
            "agt-turn-0002",
            &"p".repeat(MAX_TURN_PROMPT_BYTES + 1),
        ))
        .expect_err("a prompt over the ceiling is refused");
    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");

    assert_eq!(code(refused), "budgetExhausted");
    assert_eq!(summaries.len(), 1, "a refused open must create no turn");
    assert_eq!(summaries[0].prompt.as_deref(), Some(ceiling.as_str()));
}

#[test]
fn a_prompt_with_a_nul_byte_or_without_content_is_refused() {
    let temp = TempLogStore::create("prompt-refusals");
    let store = temp.store();

    let nul = store
        .open(&prompted_open_request(TURN_ID, "explain\u{0}the test"))
        .expect_err("a prompt carrying a NUL is refused");
    let empty = store
        .open(&prompted_open_request(TURN_ID, ""))
        .expect_err("an empty prompt is refused");
    let whitespace = store
        .open(&prompted_open_request(TURN_ID, "explain\n\tthe test"))
        .expect("newlines and tabs are legitimate prompt content");

    assert_eq!(code(nul), "budgetExhausted");
    assert_eq!(code(empty), "budgetExhausted");
    assert_eq!(whitespace.writer_epoch, 1);
}

#[test]
fn summaries_withhold_a_stored_prompt_until_the_caller_asks_for_it() {
    let temp = TempLogStore::create("prompt-withheld");
    let store = temp.store();
    store
        .open(&prompted_open_request(TURN_ID, "explain the failing test"))
        .expect("open a prompted turn");
    store
        .open(&open_request("agt-turn-0002"))
        .expect("open a turn without a prompt");

    let withheld = store.summarize(&summarize_request()).expect("summaries");
    let carried = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");

    assert_eq!(withheld[0].prompt, None);
    assert!(withheld[0].prompt_omitted, "the log still holds the prompt");
    assert_eq!(withheld[1].prompt, None);
    assert!(!withheld[1].prompt_omitted, "no prompt was ever stored");
    assert_eq!(
        carried[0].prompt.as_deref(),
        Some("explain the failing test")
    );
    assert!(!carried[0].prompt_omitted);
    assert_eq!(carried[1].prompt, None);
    assert!(!carried[1].prompt_omitted);
}

#[test]
fn the_newest_turns_carry_their_prompts_until_the_response_budget_is_spent() {
    let temp = TempLogStore::create("prompt-response-budget");
    let store = temp.store();
    let prompt = "p".repeat(MAX_TURN_PROMPT_BYTES);
    let turns = MAX_SUMMARY_PROMPT_RESPONSE_BYTES / MAX_TURN_PROMPT_BYTES + 2;
    for index in 0..turns {
        store
            .open(&prompted_open_request(
                &format!("agt-turn-{index:04}"),
                &prompt,
            ))
            .expect("open a prompted turn");
    }

    let summaries = store
        .summarize(&prompted_summarize_request(true))
        .expect("summaries");
    let carried_bytes: usize = summaries
        .iter()
        .filter_map(|summary| summary.prompt.as_ref())
        .map(String::len)
        .sum();

    assert_eq!(summaries.len(), turns);
    assert!(
        summaries[..2]
            .iter()
            .all(|summary| summary.prompt.is_none() && summary.prompt_omitted),
        "the oldest turns must report a truthful omission"
    );
    assert!(
        summaries[2..].iter().all(|summary| {
            summary.prompt.as_deref() == Some(prompt.as_str()) && !summary.prompt_omitted
        }),
        "the newest turns must carry their prompts"
    );
    assert!(carried_bytes <= MAX_SUMMARY_PROMPT_RESPONSE_BYTES);
    assert!(validate_summaries(&summaries).is_ok());
}

#[test]
fn summaries_that_contradict_the_prompt_projection_fail_closed() {
    let ceiling = "p".repeat(MAX_TURN_PROMPT_BYTES);
    let contradiction = vec![carried_summary(TURN_ID, Some("explain the test"), true)];
    let oversized = vec![carried_summary(
        TURN_ID,
        Some(&format!("{ceiling}p")),
        false,
    )];
    let over_budget: Vec<AgentTurnLogSummary> =
        (0..MAX_SUMMARY_PROMPT_RESPONSE_BYTES / MAX_TURN_PROMPT_BYTES + 1)
            .map(|index| carried_summary(&format!("agt-turn-{index:04}"), Some(&ceiling), false))
            .collect();

    let refused_contradiction =
        validate_summaries(&contradiction).expect_err("a carried prompt cannot be omitted");
    let refused_oversized =
        validate_summaries(&oversized).expect_err("a carried prompt cannot exceed the ceiling");
    let refused_over_budget =
        validate_summaries(&over_budget).expect_err("the response budget is bounded");

    assert_eq!(code(refused_contradiction), "unreadable");
    assert_eq!(code(refused_oversized), "unreadable");
    assert_eq!(code(refused_over_budget), "unreadable");
}

fn stored_lifecycle(store: &AgentTurnLogStore, turn_id: &str, lifecycle: Value) {
    let lease = store.open(&open_request(turn_id)).expect("open lease");
    store
        .append(&lifecycle_append_request(
            turn_id,
            lease.writer_epoch,
            AGENT_TURN_LOG_SEQ_BASE,
            Vec::new(),
            lifecycle,
        ))
        .expect("store the lifecycle");
}

fn corrupt_stored_lifecycle(temp: &TempLogStore, turn_id: &str, raw: &str) {
    let connection = rusqlite::Connection::open(temp.database()).expect("open raw connection");
    connection
        .execute(
            "UPDATE turn_meta SET lifecycle = ?2 WHERE turn_id = ?1",
            rusqlite::params![turn_id, raw],
        )
        .expect("corrupt the stored lifecycle");
}

#[test]
fn summaries_withhold_a_stored_lifecycle_until_the_caller_asks_for_it() {
    let temp = TempLogStore::create("lifecycle-withheld");
    let store = temp.store();
    stored_lifecycle(&store, TURN_ID, retained_lifecycle());
    store
        .open(&open_request("agt-turn-0002"))
        .expect("open a turn without a lifecycle");

    let withheld = store.summarize(&summarize_request()).expect("summaries");
    let carried = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(withheld[0].lifecycle, None);
    assert!(
        withheld[0].lifecycle_omitted,
        "the log still holds the lifecycle"
    );
    assert_eq!(withheld[1].lifecycle, None);
    assert!(!withheld[1].lifecycle_omitted);
    assert_eq!(carried[0].lifecycle, Some(retained_lifecycle()));
    assert!(!carried[0].lifecycle_omitted);
    assert_eq!(carried[1].lifecycle, None);
    assert!(!carried[1].lifecycle_omitted);
    assert!(validate_summaries(&carried).is_ok());
}

#[test]
fn the_last_lifecycle_written_to_a_turn_wins_and_an_append_without_one_keeps_it() {
    let temp = TempLogStore::create("lifecycle-last-write");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("open lease");

    store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "first")],
            legacy_lifecycle("toolu_first"),
        ))
        .expect("store the first lifecycle");
    store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            2,
            vec![entry(2, "second")],
            retained_lifecycle(),
        ))
        .expect("replace the stored lifecycle");
    let replaced = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");
    store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            3,
            vec![entry(3, "third")],
        ))
        .expect("append without a lifecycle");
    let untouched = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(replaced[0].lifecycle, Some(retained_lifecycle()));
    assert_eq!(untouched[0].lifecycle, Some(retained_lifecycle()));
    assert!(!untouched[0].lifecycle_omitted);
    assert_eq!(untouched[0].event_count, 3);
}

#[test]
fn an_invalid_lifecycle_is_refused_and_stores_nothing_of_that_append() {
    let temp = TempLogStore::create("lifecycle-invalid");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("open lease");
    let mut unknown_key = retained_lifecycle();
    unknown_key["entries"][0]["unknownField"] = json!(true);
    let mut incoherent = retained_lifecycle();
    incoherent["entries"][0]["state"] = json!("completed");

    let refused_unknown = store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "first")],
            unknown_key,
        ))
        .expect_err("an unknown entry field is refused");
    let refused_incoherent = store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "first")],
            incoherent,
        ))
        .expect_err("a state contradicting its telemetry is refused");
    let refused_shape = store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "first")],
            json!("running"),
        ))
        .expect_err("a lifecycle that is not an object is refused");
    let summaries = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(code(refused_unknown), "budgetExhausted");
    assert_eq!(code(refused_incoherent), "budgetExhausted");
    assert_eq!(code(refused_shape), "budgetExhausted");
    assert_eq!(summaries[0].lifecycle, None);
    assert!(!summaries[0].lifecycle_omitted);
    assert_eq!(
        summaries[0].event_count, 0,
        "a refused append must store no events"
    );
}

#[test]
fn a_lifecycle_over_the_byte_ceiling_is_refused_and_stores_nothing() {
    let temp = TempLogStore::create("lifecycle-ceiling");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("open lease");
    let oversized = oversized_lifecycle();

    let refused = store
        .append(&lifecycle_append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "first")],
            oversized.clone(),
        ))
        .expect_err("a lifecycle over the ceiling is refused");
    let summaries = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert!(
        crate::agent_subagent_lifecycle::valid(&oversized),
        "the oversized fixture must be refused for its size alone"
    );
    assert!(lifecycle_bytes(&oversized) > MAX_TURN_LIFECYCLE_BYTES);
    assert_eq!(code(refused), "budgetExhausted");
    assert_eq!(summaries[0].lifecycle, None);
    assert_eq!(summaries[0].event_count, 0);
}

#[test]
fn a_retained_lifecycle_round_trips_through_the_log_unchanged() {
    let temp = TempLogStore::create("lifecycle-round-trip");
    let store = temp.store();
    stored_lifecycle(&store, TURN_ID, retained_lifecycle());
    drop(store);

    let reopened = temp.store();
    let summaries = reopened
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(summaries[0].lifecycle, Some(retained_lifecycle()));
    assert!(!summaries[0].lifecycle_omitted);
}

#[test]
fn the_newest_turns_carry_their_lifecycles_until_the_response_budget_is_spent() {
    let temp = TempLogStore::create("lifecycle-response-budget");
    let store = temp.store();
    let large = large_lifecycle();
    let size = lifecycle_bytes(&large);
    let fits = MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES / size;
    let turns = fits + 2;
    for index in 0..turns {
        stored_lifecycle(&store, &format!("agt-turn-{index:04}"), large.clone());
    }

    let summaries = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");
    let carried_bytes: usize = summaries
        .iter()
        .filter_map(|summary| summary.lifecycle.as_ref())
        .map(lifecycle_bytes)
        .sum();

    assert!(size <= MAX_TURN_LIFECYCLE_BYTES);
    assert!(fits >= 2 && turns <= MAX_TURN_SUMMARIES);
    assert_eq!(summaries.len(), turns);
    assert!(
        summaries[..turns - fits]
            .iter()
            .all(|summary| summary.lifecycle.is_none() && summary.lifecycle_omitted),
        "the oldest turns must report a truthful omission"
    );
    assert!(
        summaries[turns - fits..]
            .iter()
            .all(|summary| summary.lifecycle.as_ref() == Some(&large) && !summary.lifecycle_omitted),
        "the newest turns must carry their lifecycles"
    );
    assert!(carried_bytes <= MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES);
    assert!(validate_summaries(&summaries).is_ok());

    let targeted = store
        .summarize(&SummarizeAgentTurnLogsRequest {
            turn_id: Some(summaries[0].turn_id.clone()),
            ..lifecycle_summarize_request(true)
        })
        .expect("target an omitted older lifecycle");
    assert_eq!(targeted.len(), 1);
    assert_eq!(targeted[0].turn_id, summaries[0].turn_id);
    assert_eq!(targeted[0].lifecycle, Some(large));
    assert!(!targeted[0].lifecycle_omitted);
    assert!(validate_summaries(&targeted).is_ok());

    let mut foreign = open_request("agt-foreign-turn");
    foreign.scope.thread_id = "agt-other-thread".to_string();
    let epoch = store
        .open(&foreign)
        .expect("open another thread")
        .writer_epoch;
    let mut append = lifecycle_append_request(
        "agt-foreign-turn",
        epoch,
        1,
        Vec::new(),
        retained_lifecycle(),
    );
    append.scope = foreign.scope;
    store
        .append(&append)
        .expect("write another thread lifecycle");
    let foreign_target = store
        .summarize(&SummarizeAgentTurnLogsRequest {
            turn_id: Some("agt-foreign-turn".to_string()),
            ..lifecycle_summarize_request(true)
        })
        .expect("missing turn in the requested thread");
    assert!(
        foreign_target.is_empty(),
        "targeting cannot cross the thread boundary"
    );
}

#[test]
fn a_sealed_turn_accepts_a_lifecycle_only_append_and_refuses_every_other_one() {
    let temp = TempLogStore::create("lifecycle-sealed");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);
    store
        .append(&AppendAgentTurnLogRequest {
            digest: Some(sample_digest()),
            seal: true,
            loss: loss(AgentTurnLogLossKind::SupervisorGap),
            ..append_request(TURN_ID, epoch, 3, vec![entry(3, "last")])
        })
        .expect("seal the turn");
    let sealed = store.summarize(&summarize_request()).expect("summaries");

    let refused_ops = store
        .append(&lifecycle_append_request(
            TURN_ID,
            epoch,
            4,
            vec![entry(4, "after")],
            retained_lifecycle(),
        ))
        .expect_err("a sealed turn refuses events");
    let refused_seal = store
        .append(&AppendAgentTurnLogRequest {
            seal: true,
            ..lifecycle_append_request(TURN_ID, epoch, 4, Vec::new(), retained_lifecycle())
        })
        .expect_err("a sealed turn refuses another seal");
    let refused_bare = store
        .append(&append_request(TURN_ID, epoch, 4, Vec::new()))
        .expect_err("a sealed turn refuses a lifecycle-less append");
    let receipt = store
        .append(&lifecycle_append_request(
            TURN_ID,
            epoch,
            4,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect("a sealed turn accepts a lifecycle-only append");
    let retry = store
        .append(&lifecycle_append_request(
            TURN_ID,
            epoch,
            4,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect("the same sealed lifecycle retry is idempotent");
    assert_eq!(retry, receipt);
    let replacement = store
        .append(&lifecycle_append_request(
            TURN_ID,
            epoch,
            4,
            Vec::new(),
            legacy_lifecycle("toolu_changed"),
        ))
        .expect_err("sealed lifecycle evidence is immutable");
    assert_eq!(code(replacement), "sealed");
    let after = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(code(refused_ops), "sealed");
    assert_eq!(code(refused_seal), "sealed");
    assert_eq!(code(refused_bare), "sealed");
    assert_eq!(receipt.next_seq, 4);
    assert_eq!(receipt.persisted_through_seq, 3);
    assert_eq!(after[0].lifecycle, Some(retained_lifecycle()));
    assert!(!after[0].lifecycle_omitted);
    assert!(after[0].sealed, "the seal survives a lifecycle-only append");
    assert_eq!(after[0].loss, sealed[0].loss);
    assert_eq!(after[0].digest, sealed[0].digest);
    assert_eq!(after[0].event_count, sealed[0].event_count);
    assert_eq!(after[0].bytes, sealed[0].bytes);
}

#[test]
fn a_lifecycle_only_append_to_a_sealed_turn_needs_the_exact_writer_and_sequence() {
    let temp = TempLogStore::create("lifecycle-sealed-authority");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    store
        .append(&AppendAgentTurnLogRequest {
            seal: true,
            ..append_request(TURN_ID, epoch, 2, Vec::new())
        })
        .expect("seal the turn");
    let reopened = store
        .open(&open_request(TURN_ID))
        .expect("reopen the sealed turn");

    let stale = store
        .append(&lifecycle_append_request(
            TURN_ID,
            epoch,
            2,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect_err("a stale writer epoch is refused");
    let gapped = store
        .append(&lifecycle_append_request(
            TURN_ID,
            reopened.writer_epoch,
            3,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect_err("a sequence that is not the sealed tail is refused");
    let accepted = store
        .append(&lifecycle_append_request(
            TURN_ID,
            reopened.writer_epoch,
            2,
            Vec::new(),
            retained_lifecycle(),
        ))
        .expect("the exact writer and sequence store the lifecycle");
    let summaries = store
        .summarize(&lifecycle_summarize_request(true))
        .expect("summaries");

    assert_eq!(code(stale), "supersededWriter");
    assert_eq!(code(gapped), "sequenceGap");
    assert_eq!(accepted.next_seq, 2);
    assert_eq!(summaries[0].lifecycle, Some(retained_lifecycle()));
}

#[test]
fn a_corrupted_stored_lifecycle_summarizes_as_no_lifecycle() {
    let temp = TempLogStore::create("lifecycle-corrupt");
    let store = temp.store();
    stored_lifecycle(&store, TURN_ID, retained_lifecycle());
    drop(store);
    corrupt_stored_lifecycle(&temp, TURN_ID, "{\"entries\":");

    let reopened = temp.store();
    let summaries = reopened
        .summarize(&lifecycle_summarize_request(true))
        .expect("an unreadable lifecycle must not fail the row");

    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].lifecycle, None);
    assert!(!summaries[0].lifecycle_omitted);
}

#[test]
fn a_stored_lifecycle_that_lost_its_shape_summarizes_as_no_lifecycle() {
    let temp = TempLogStore::create("lifecycle-foreign");
    let store = temp.store();
    stored_lifecycle(&store, TURN_ID, retained_lifecycle());
    drop(store);
    corrupt_stored_lifecycle(&temp, TURN_ID, "{\"entries\":[],\"unknownRootKey\":1}");

    let reopened = temp.store();
    let summaries = reopened
        .summarize(&lifecycle_summarize_request(true))
        .expect("a foreign lifecycle must not fail the row");

    assert_eq!(summaries[0].lifecycle, None);
    assert!(!summaries[0].lifecycle_omitted);
}

#[test]
fn summaries_that_contradict_the_lifecycle_projection_fail_closed() {
    let mut unknown_key = retained_lifecycle();
    unknown_key["entries"][0]["unknownField"] = json!(true);
    let contradiction = vec![lifecycle_summary(TURN_ID, retained_lifecycle(), true)];
    let unreadable = vec![lifecycle_summary(TURN_ID, unknown_key, false)];
    let shapeless = vec![lifecycle_summary(TURN_ID, json!("running"), false)];
    let oversized = vec![lifecycle_summary(TURN_ID, oversized_lifecycle(), false)];
    let over_budget: Vec<AgentTurnLogSummary> = (0..MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES
        / lifecycle_bytes(&large_lifecycle())
        + 1)
        .map(|index| lifecycle_summary(&format!("agt-turn-{index:04}"), large_lifecycle(), false))
        .collect();

    let refused_contradiction =
        validate_summaries(&contradiction).expect_err("a carried lifecycle cannot be omitted");
    let refused_unreadable =
        validate_summaries(&unreadable).expect_err("a carried lifecycle must stay closed");
    let refused_shapeless =
        validate_summaries(&shapeless).expect_err("a carried lifecycle must be an object");
    let refused_oversized =
        validate_summaries(&oversized).expect_err("a carried lifecycle cannot exceed the ceiling");
    let refused_over_budget =
        validate_summaries(&over_budget).expect_err("the response budget is bounded");

    assert_eq!(code(refused_contradiction), "unreadable");
    assert_eq!(code(refused_unreadable), "unreadable");
    assert_eq!(code(refused_shapeless), "unreadable");
    assert_eq!(code(refused_oversized), "unreadable");
    assert_eq!(code(refused_over_budget), "unreadable");
}

#[test]
fn context_digest_observation_times_preserve_legacy_shape_and_round_trip() {
    let mut base = serde_json::to_value(sample_digest()).unwrap();
    base["context"]["primary"] = json!({"model":"claude","inputTokens":1200});
    let legacy: AgentTurnDigestWire = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(serde_json::to_value(legacy).unwrap(), base);
    for field in ["primary", "current"] {
        for timestamp in [0, MAX_LOG_COUNTER] {
            let mut value = base.clone();
            value["context"][field]["observedAtEpochMs"] = json!(timestamp);
            let digest: AgentTurnDigestWire = serde_json::from_value(value.clone()).unwrap();
            super::super::validation::validate_digest(&digest).unwrap();
            let temp = TempLogStore::create("observed-context-digest");
            let store = temp.store();
            let epoch = seed(&store, TURN_ID, 1);
            let mut request = append_request(TURN_ID, epoch, 2, vec![entry(2, "observed")]);
            request.digest = Some(digest);
            store.append(&request).unwrap();
            let reopened = store.open(&open_request(TURN_ID)).unwrap();
            assert_eq!(
                serde_json::to_value(reopened.digest.unwrap()).unwrap(),
                value
            );
        }
        for invalid in [
            json!(null),
            json!(-1),
            json!(1.5),
            json!("1"),
            json!(true),
            json!(MAX_LOG_COUNTER + 1),
        ] {
            let mut value = base.clone();
            value["context"][field]["observedAtEpochMs"] = invalid;
            assert!(serde_json::from_value::<AgentTurnDigestWire>(value).is_err());
        }
    }
}
