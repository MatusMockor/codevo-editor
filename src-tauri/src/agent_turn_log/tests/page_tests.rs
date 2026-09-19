use super::super::wire::{AgentTurnLogAnchorAt, AgentTurnLogPage, MAX_PAGE_BYTES, MAX_PAGE_EVENTS};
use super::*;

fn sequences(page: &AgentTurnLogPage) -> Vec<i64> {
    page.entries.iter().map(|entry| entry.seq).collect()
}

#[test]
fn the_tail_anchor_returns_the_newest_events_in_order() {
    let temp = TempLogStore::create("page-tail");
    let store = temp.store();
    seed(&store, TURN_ID, 10);

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 4, MAX_PAGE_BYTES))
        .expect("tail page");

    assert_eq!(sequences(&page), vec![7, 8, 9, 10]);
    assert_eq!(page.first_seq, 7);
    assert_eq!(page.last_seq, 10);
    assert!(page.has_earlier);
    assert!(!page.has_later);
    assert!(!page.clipped);
    assert_eq!(page.loss, loss(AgentTurnLogLossKind::None));
}

#[test]
fn the_before_and_after_anchors_page_in_both_directions() {
    let temp = TempLogStore::create("page-anchors");
    let store = temp.store();
    seed(&store, TURN_ID, 10);

    let before = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::Before, 6),
            3,
            MAX_PAGE_BYTES,
        ))
        .expect("before page");
    let after = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::After, 6),
            3,
            MAX_PAGE_BYTES,
        ))
        .expect("after page");

    assert_eq!(sequences(&before), vec![3, 4, 5]);
    assert!(before.has_earlier);
    assert!(before.has_later);
    assert_eq!(sequences(&after), vec![7, 8, 9]);
    assert!(after.has_earlier);
    assert!(after.has_later);
}

#[test]
fn the_around_anchor_spans_both_sides_of_a_sequence() {
    let temp = TempLogStore::create("page-around");
    let store = temp.store();
    seed(&store, TURN_ID, 10);

    let page = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::Around, 5),
            4,
            MAX_PAGE_BYTES,
        ))
        .expect("around page");

    assert_eq!(sequences(&page), vec![4, 5, 6, 7]);
    assert!(page.has_earlier);
    assert!(page.has_later);
}

#[test]
fn a_page_clips_on_the_byte_budget_and_reports_it() {
    let temp = TempLogStore::create("page-clip");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("lease");
    let ops = (1..=8).map(|seq| entry(seq, &"x".repeat(1_000))).collect();
    store
        .append(&append_request(TURN_ID, lease.writer_epoch, 1, ops))
        .expect("seed wide events");

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 8, 2_500))
        .expect("clipped page");

    assert!(page.clipped);
    assert!(page.entries.len() < 8);
    assert!(page.has_earlier);
}

#[test]
fn page_requests_beyond_the_transport_bounds_fail_closed() {
    let temp = TempLogStore::create("page-bounds");
    let store = temp.store();
    seed(&store, TURN_ID, 4);

    let too_many = store
        .read_page(&page_request(TURN_ID, tail(), MAX_PAGE_EVENTS + 1, 1_024))
        .expect_err("a page over the event bound is refused");
    let too_wide = store
        .read_page(&page_request(TURN_ID, tail(), 10, MAX_PAGE_BYTES + 1))
        .expect_err("a page over the byte bound is refused");
    let empty = store
        .read_page(&page_request(TURN_ID, tail(), 0, 1_024))
        .expect_err("an empty page request is refused");
    let anchored_tail = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::Tail, 4),
            10,
            1_024,
        ))
        .expect_err("a tail anchor with a sequence is refused");
    let unanchored_before = store
        .read_page(&page_request(
            TURN_ID,
            tail_at(AgentTurnLogAnchorAt::Before),
            10,
            1_024,
        ))
        .expect_err("a before anchor without a sequence is refused");

    assert_eq!(code(too_many), "budgetExhausted");
    assert_eq!(code(too_wide), "budgetExhausted");
    assert_eq!(code(empty), "budgetExhausted");
    assert_eq!(code(anchored_tail), "sequenceGap");
    assert_eq!(code(unanchored_before), "sequenceGap");
}

fn tail_at(at: AgentTurnLogAnchorAt) -> super::super::wire::AgentTurnLogAnchor {
    super::super::wire::AgentTurnLogAnchor { at, seq: None }
}

#[test]
fn an_empty_turn_reports_an_empty_page() {
    let temp = TempLogStore::create("page-empty");
    let store = temp.store();
    store.open(&open_request(TURN_ID)).expect("lease");

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 10, 1_024))
        .expect("empty page");

    assert!(page.entries.is_empty());
    assert_eq!(page.first_seq, 0);
    assert_eq!(page.last_seq, 0);
    assert!(!page.has_earlier);
    assert!(!page.has_later);
}

#[test]
fn an_anchor_past_the_end_reports_the_remaining_direction() {
    let temp = TempLogStore::create("page-past-end");
    let store = temp.store();
    seed(&store, TURN_ID, 5);

    let after = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::After, 5),
            10,
            1_024,
        ))
        .expect("after the last sequence");
    let before = store
        .read_page(&page_request(
            TURN_ID,
            anchored(AgentTurnLogAnchorAt::Before, 1),
            10,
            1_024,
        ))
        .expect("before the first sequence");

    assert!(after.entries.is_empty());
    assert!(after.has_earlier);
    assert!(!after.has_later);
    assert!(before.entries.is_empty());
    assert!(before.has_later);
    assert!(!before.has_earlier);
}

#[test]
fn an_undecodable_row_is_skipped_and_reported_without_losing_the_page() {
    let temp = TempLogStore::create("page-unreadable");
    let store = temp.store();
    seed(&store, TURN_ID, 4);
    let connection = rusqlite::Connection::open(temp.database()).expect("raw connection");
    connection
        .execute(
            "UPDATE events SET payload = ?2 WHERE turn_id = ?1 AND seq = 2",
            rusqlite::params![TURN_ID, b"{ not json".to_vec()],
        )
        .expect("corrupt one payload");

    let page = store
        .read_page(&page_request(TURN_ID, tail(), 10, 8_192))
        .expect("page over a corrupt row");

    assert_eq!(sequences(&page), vec![1, 3, 4]);
    assert_eq!(page.loss, loss(AgentTurnLogLossKind::Unreadable));
}
