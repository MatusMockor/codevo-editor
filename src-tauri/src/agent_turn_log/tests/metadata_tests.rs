use super::super::projection::validate_summaries;
use super::super::wire::{
    AgentTurnContextDigest, AgentTurnDigestOccupancy, AgentTurnDigestProvider, AgentTurnDigestWire,
    AgentTurnLogBudget, AgentTurnLogSummary, MAX_SUMMARY_PROMPT_RESPONSE_BYTES, MAX_TURN_BYTES,
    MAX_TURN_PROMPT_BYTES, NEAR_TURN_BYTES,
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
                used_tokens: 1_200,
                context_window: 200_000,
            }),
            bounded: false,
        },
    }
}

#[test]
fn the_turn_ceiling_records_the_loss_and_refuses_further_appends() {
    let temp = TempLogStore::create("ceiling");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    force_turn_bytes(&temp, TURN_ID, MAX_TURN_BYTES);

    let refused = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "over")]))
        .expect_err("the per-turn ceiling refuses the batch");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(code(refused), "budgetExhausted");
    assert_eq!(summaries[0].loss, loss(AgentTurnLogLossKind::TurnCeiling));
    assert_eq!(summaries[0].event_count, 1);
}

#[test]
fn a_turn_near_the_ceiling_reports_a_near_budget() {
    let temp = TempLogStore::create("near-budget");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 1);
    force_turn_bytes(&temp, TURN_ID, NEAR_TURN_BYTES);

    let receipt = store
        .append(&append_request(TURN_ID, epoch, 2, vec![entry(2, "next")]))
        .expect("append below the ceiling");

    assert_eq!(receipt.budget, AgentTurnLogBudget::Near);
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
