use super::super::agent_thread_store::MAX_AGENT_EVENT_TEXT_BYTES;
use super::super::wire::{AgentTurnLogBudget, MAX_APPEND_OPS};
use super::*;

#[test]
fn an_opened_turn_starts_at_the_sequence_base_and_every_open_bumps_the_writer_epoch() {
    let temp = TempLogStore::create("open-epoch");
    let store = temp.store();

    let first = store.open(&open_request(TURN_ID)).expect("first lease");
    let second = store.open(&open_request(TURN_ID)).expect("second lease");

    assert_eq!(first.writer_epoch, 1);
    assert_eq!(first.next_seq, 1);
    assert_eq!(first.digest, None);
    assert_eq!(first.digest_through_seq, 0);
    assert_eq!(second.writer_epoch, 2);
    assert_eq!(second.next_seq, 1);
}

#[test]
fn appends_must_be_contiguous_and_a_gap_fails_closed() {
    let temp = TempLogStore::create("contiguity");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("lease");

    let receipt = store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, "a"), entry(2, "b")],
        ))
        .expect("append two events");
    let gap = store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            3,
            vec![entry(4, "d")],
        ))
        .expect_err("a skipped sequence is refused");
    let stale = store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            2,
            vec![entry(2, "b")],
        ))
        .expect_err("a stale expectation is refused");
    let below_base = store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            0,
            vec![entry(0, "zero")],
        ))
        .expect_err("a sequence below the log base is refused");

    assert_eq!(receipt.persisted_through_seq, 2);
    assert_eq!(receipt.next_seq, 3);
    assert_eq!(receipt.budget, AgentTurnLogBudget::Ok);
    assert_eq!(code(gap), "sequenceGap");
    assert_eq!(code(stale), "sequenceGap");
    assert_eq!(code(below_base), "sequenceGap");
}

#[test]
fn a_replacement_supersedes_one_row_without_changing_the_count() {
    let temp = TempLogStore::create("replace");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 4);

    let receipt = store
        .append(&append_request(
            TURN_ID,
            epoch,
            5,
            vec![entry(2, "superseded"), entry(5, "new")],
        ))
        .expect("replace and append in one batch");
    let summaries = store.summarize(&summarize_request()).expect("summaries");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert_eq!(receipt.next_seq, 6);
    assert_eq!(summaries[0].event_count, 5);
    assert_eq!(page.entries.len(), 5);
    assert_eq!(page.entries[1].event, text_event("superseded"));
}

#[test]
fn unordered_duplicate_or_out_of_range_operations_fail_closed() {
    let temp = TempLogStore::create("replace-bounds");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);

    let duplicate = store
        .append(&append_request(
            TURN_ID,
            epoch,
            3,
            vec![entry(1, "x"), entry(1, "y")],
        ))
        .expect_err("a duplicate sequence is refused");
    let unordered = store
        .append(&append_request(
            TURN_ID,
            epoch,
            3,
            vec![entry(3, "b"), entry(2, "a")],
        ))
        .expect_err("unordered operations are refused");
    let below_base = store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(0, "x")]))
        .expect_err("a sequence below the log base is refused");

    assert_eq!(code(duplicate), "sequenceGap");
    assert_eq!(code(unordered), "sequenceGap");
    assert_eq!(code(below_base), "sequenceGap");
}

#[test]
fn sealing_refuses_every_later_append() {
    let temp = TempLogStore::create("seal");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);
    let mut sealing = append_request(TURN_ID, epoch, 3, vec![entry(3, "last")]);
    sealing.seal = true;

    store.append(&sealing).expect("seal the turn");
    let refused = store
        .append(&append_request(TURN_ID, epoch, 4, vec![entry(4, "late")]))
        .expect_err("a sealed turn refuses appends");
    let summaries = store.summarize(&summarize_request()).expect("summaries");

    assert_eq!(code(refused), "sealed");
    assert!(summaries[0].sealed);
}

#[test]
fn a_second_writer_supersedes_the_first_across_service_instances() {
    let temp = TempLogStore::create("writer-cas");
    let first_store = temp.store();
    let second_store = temp.store();
    let first = first_store
        .open(&open_request(TURN_ID))
        .expect("first lease");

    let second = second_store
        .open(&open_request(TURN_ID))
        .expect("second lease");
    let stale = first_store
        .append(&append_request(
            TURN_ID,
            first.writer_epoch,
            1,
            vec![entry(1, "stale")],
        ))
        .expect_err("the older writer is superseded");
    second_store
        .append(&append_request(
            TURN_ID,
            second.writer_epoch,
            1,
            vec![entry(1, "fresh")],
        ))
        .expect("the newest writer keeps its lease");

    assert_eq!(code(stale), "supersededWriter");
    assert!(second.writer_epoch > first.writer_epoch);
}

#[test]
fn a_lost_reply_can_be_reconciled_from_the_structured_sequence_gap() {
    let temp = TempLogStore::create("lost-reply");
    let store = temp.store();
    let epoch = seed(&store, TURN_ID, 2);

    let committed = store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "c")]))
        .expect("the batch commits before the reply is lost");
    let retried = store
        .append(&append_request(TURN_ID, epoch, 3, vec![entry(3, "c")]))
        .expect_err("the retry of a committed batch is refused");
    let malformed = store
        .append(&append_request(TURN_ID, epoch, 4, vec![entry(9, "far")]))
        .expect_err("a non contiguous batch is refused");

    assert_eq!(committed.next_seq, 4);
    assert_eq!(retried.message(), "sequenceGap:4");
    assert_eq!(code(retried), "sequenceGap");
    assert_eq!(
        malformed.message(),
        "sequenceGap",
        "only the log's own next sequence is ever published"
    );
}

#[test]
fn a_superseded_writer_cannot_steal_its_lease_back_without_reopening() {
    let temp = TempLogStore::create("no-steal");
    let first_store = temp.store();
    let second_store = temp.store();
    let first = first_store
        .open(&open_request(TURN_ID))
        .expect("first lease");
    let second = second_store
        .open(&open_request(TURN_ID))
        .expect("second lease");
    second_store
        .append(&append_request(
            TURN_ID,
            second.writer_epoch,
            1,
            vec![entry(1, "fresh")],
        ))
        .expect("the newest writer keeps its lease");

    let stale = first_store
        .append(&append_request(
            TURN_ID,
            first.writer_epoch,
            2,
            vec![entry(2, "stale")],
        ))
        .expect_err("the superseded writer stays superseded");
    let retried = first_store
        .append(&append_request(
            TURN_ID,
            first.writer_epoch,
            2,
            vec![entry(2, "stale")],
        ))
        .expect_err("retrying does not steal the lease back");
    let reopened = first_store
        .open(&open_request(TURN_ID))
        .expect("an explicit reopen takes the lease back");
    let receipt = first_store
        .append(&append_request(
            TURN_ID,
            reopened.writer_epoch,
            2,
            vec![entry(2, "resumed")],
        ))
        .expect("the reopened writer may append");

    assert_eq!(code(stale), "supersededWriter");
    assert_eq!(code(retried), "supersededWriter");
    assert_eq!(reopened.writer_epoch, second.writer_epoch + 1);
    assert_eq!(receipt.next_seq, 3);
}

#[test]
fn an_unopened_turn_or_a_zero_writer_epoch_is_superseded() {
    let temp = TempLogStore::create("no-lease");
    let store = temp.store();

    let unopened = store
        .append(&append_request(TURN_ID, 1, 1, vec![entry(1, "a")]))
        .expect_err("an unopened turn has no lease");
    let zero_epoch = store
        .append(&append_request(TURN_ID, 0, 1, vec![entry(1, "a")]))
        .expect_err("a writer epoch of zero is refused");

    assert_eq!(code(unopened), "supersededWriter");
    assert_eq!(code(zero_epoch), "supersededWriter");
}

#[test]
fn batches_over_the_op_byte_or_event_bounds_are_refused() {
    let temp = TempLogStore::create("batch-bounds");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("lease");
    let too_many = (1..=MAX_APPEND_OPS as i64 + 1)
        .map(|seq| entry(seq, "x"))
        .collect();
    let oversized_text = "x".repeat(MAX_AGENT_EVENT_TEXT_BYTES + 1);
    let heavy = (1..=MAX_APPEND_OPS as i64)
        .map(|seq| entry(seq, &"y".repeat(MAX_AGENT_EVENT_TEXT_BYTES / 2)))
        .collect();

    let refused_count = store
        .append(&append_request(TURN_ID, lease.writer_epoch, 1, too_many))
        .expect_err("more than the op bound is refused");
    let refused_event = store
        .append(&append_request(
            TURN_ID,
            lease.writer_epoch,
            1,
            vec![entry(1, &oversized_text)],
        ))
        .expect_err("an out of bounds event is refused");
    let refused_bytes = store
        .append(&append_request(TURN_ID, lease.writer_epoch, 1, heavy))
        .expect_err("more than the batch byte bound is refused");
    let page = store
        .read_page(&page_request(TURN_ID, tail(), 200, 512 * 1024))
        .expect("tail page");

    assert_eq!(code(refused_count), "budgetExhausted");
    assert_eq!(code(refused_event), "budgetExhausted");
    assert_eq!(code(refused_bytes), "budgetExhausted");
    assert!(page.entries.is_empty(), "no partial batch reached the log");
}
