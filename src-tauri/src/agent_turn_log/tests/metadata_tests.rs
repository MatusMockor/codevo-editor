use super::super::wire::{
    AgentTurnContextDigest, AgentTurnDigestOccupancy, AgentTurnDigestProvider, AgentTurnDigestWire,
    AgentTurnLogBudget, MAX_TURN_BYTES, NEAR_TURN_BYTES,
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
