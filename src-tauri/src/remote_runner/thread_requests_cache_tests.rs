use super::super::interactions_fake::{live, observed, retasked, sequenced, snapshot, task, turn};
use super::*;

fn read(
    index: usize,
    name: &str,
    sequence: u64,
    source: InteractionSource,
    after_end: bool,
) -> Arc<TurnRead> {
    let value = sequenced(retasked(snapshot(name), &task(index)), sequence);
    Arc::new(TurnRead::new(observed(value, source), after_end))
}

fn closed(index: usize, sequence: u64, after_end: bool) -> Arc<TurnRead> {
    read(
        index,
        "answeredAndDecided",
        sequence,
        InteractionSource::Snapshot,
        after_end,
    )
}

fn open(index: usize, sequence: u64, after_end: bool) -> Arc<TurnRead> {
    read(
        index,
        "livePendingQuestionAndApproval",
        sequence,
        InteractionSource::Snapshot,
        after_end,
    )
}

fn served(cache: &ThreadRequestCache, index: usize, sequence: Option<u64>, terminal: bool) -> bool {
    cache
        .serve(&turn(&task(index), 0, sequence, terminal))
        .is_some()
}

#[test]
fn entry_is_served_while_its_sequence_is_at_least_the_requested_one() {
    let cache = ThreadRequestCache::default();
    cache.retain(&open(1, 5, false));
    assert!(served(&cache, 1, Some(4), false));
    assert!(served(&cache, 1, Some(5), false));
    assert!(!served(&cache, 1, Some(6), false));
    assert!(cache.holds(&task(1)));
    assert!(!served(&cache, 2, Some(1), false));
}

#[test]
fn unknown_sequence_is_served_only_for_an_ended_turn_read_after_it_ended() {
    let cache = ThreadRequestCache::default();
    cache.retain(&closed(1, 5, false));
    assert!(!served(&cache, 1, None, false));
    assert!(!served(&cache, 1, None, true));
    cache.retain(&closed(1, 5, true));
    assert!(served(&cache, 1, None, true));
    assert!(!served(&cache, 1, None, false));
    assert!(served(&cache, 1, Some(5), true));
    assert!(!served(&cache, 1, Some(6), true));
}

#[test]
fn ended_turn_is_never_served_an_entry_that_still_holds_an_open_request() {
    let cache = ThreadRequestCache::default();
    cache.retain(&open(1, 5, false));
    assert!(served(&cache, 1, Some(5), false));
    assert!(!served(&cache, 1, Some(5), true));
    assert!(!served(&cache, 1, None, true));
    let waiting = read(
        2,
        "pendingWithoutWaiter",
        2,
        InteractionSource::Snapshot,
        false,
    );
    cache.retain(&waiting);
    assert!(!served(&cache, 2, Some(2), true));
}

#[test]
fn reads_that_cannot_be_trusted_later_are_not_kept_and_replace_the_previous_entry() {
    let cache = ThreadRequestCache::default();
    cache.retain(&open(1, 5, false));
    cache.retain(&open(1, 6, true));
    assert!(!cache.holds(&task(1)));
    assert_eq!(cache.usage(), (0, 0));
    let running_legacy = read(2, "answeredAndDecided", 3, InteractionSource::Legacy, false);
    cache.retain(&running_legacy);
    assert!(!cache.holds(&task(2)));
    let ended_legacy_open = read(
        3,
        "livePendingQuestionAndApproval",
        3,
        InteractionSource::Legacy,
        true,
    );
    cache.retain(&ended_legacy_open);
    assert!(!cache.holds(&task(3)));
    let ended_legacy = read(4, "answeredAndDecided", 3, InteractionSource::Legacy, true);
    cache.retain(&ended_legacy);
    assert!(cache.holds(&task(4)));
    assert!(served(&cache, 4, None, true));
    assert!(served(&cache, 4, Some(900), true));
    assert!(!served(&cache, 4, Some(1), false));
}

#[test]
fn observing_the_other_source_drops_every_entry_of_the_previous_one() {
    let cache = ThreadRequestCache::default();
    cache.retain(&closed(1, 5, true));
    cache.retain(&closed(2, 5, true));
    assert_eq!(cache.usage().0, 2);
    let running_legacy = read(3, "answeredAndDecided", 1, InteractionSource::Legacy, false);
    cache.retain(&running_legacy);
    assert_eq!(cache.usage(), (0, 0));
    let ended_legacy = read(4, "answeredAndDecided", 1, InteractionSource::Legacy, true);
    cache.retain(&ended_legacy);
    assert!(cache.holds(&task(4)));
    cache.retain(&closed(5, 2, false));
    assert!(!cache.holds(&task(4)));
    assert!(cache.holds(&task(5)));
    assert_eq!(cache.usage().0, 1);
}

#[test]
fn count_bound_evicts_the_least_recently_served_entry_first() {
    let cache = ThreadRequestCache::default();
    for index in 0..MAX_CACHED_TASKS {
        cache.retain(&closed(index, 1, true));
    }
    assert_eq!(cache.usage().0, MAX_CACHED_TASKS);
    assert!(served(&cache, 0, Some(1), true));
    cache.retain(&closed(MAX_CACHED_TASKS, 1, true));
    assert_eq!(cache.usage().0, MAX_CACHED_TASKS);
    assert!(cache.holds(&task(0)));
    assert!(!cache.holds(&task(1)));
    assert!(cache.holds(&task(2)));
    cache.retain(&closed(MAX_CACHED_TASKS + 1, 1, true));
    assert!(!cache.holds(&task(2)));
    assert!(cache.holds(&task(MAX_CACHED_TASKS)));
}

#[test]
fn byte_bound_evicts_oldest_entries_and_refuses_an_entry_larger_than_the_whole_budget() {
    let one = closed(0, 1, true).bytes().expect("measured entry");
    let cache = ThreadRequestCache::with_limits(MAX_CACHED_TASKS, one * 3);
    for index in 0..3 {
        cache.retain(&closed(index, 1, true));
    }
    assert_eq!(cache.usage(), (3, one * 3));
    assert!(served(&cache, 0, Some(1), true));
    cache.retain(&closed(3, 1, true));
    assert_eq!(cache.usage(), (3, one * 3));
    assert!(cache.holds(&task(0)));
    assert!(!cache.holds(&task(1)));
    let mut heavy = retasked(live(), &task(9));
    heavy["approvals"][0]["detail"] = "x".repeat(one * 3).into();
    let heavy = Arc::new(TurnRead::new(
        observed(heavy, InteractionSource::Snapshot),
        false,
    ));
    assert!(heavy.bytes().expect("measured entry") > one * 3);
    cache.retain(&heavy);
    assert!(!cache.holds(&task(9)));
    assert_eq!(cache.usage(), (3, one * 3));
    cache.forget(&task(0));
    assert_eq!(cache.usage(), (2, one * 2));
    cache.forget(&task(0));
    assert_eq!(cache.usage(), (2, one * 2));
}

#[test]
fn last_observed_source_stays_and_every_switch_is_counted() {
    let cache = ThreadRequestCache::default();
    let standing = |source, generation| Standing { source, generation };
    assert_eq!(cache.current(), standing(None, 0));
    cache.retain(&read(
        1,
        "answeredAndDecided",
        1,
        InteractionSource::Legacy,
        false,
    ));
    assert_eq!(
        cache.current(),
        standing(Some(InteractionSource::Legacy), 0)
    );
    cache.forget(&task(1));
    cache.retain(&read(
        2,
        "answeredAndDecided",
        1,
        InteractionSource::Legacy,
        true,
    ));
    assert_eq!(
        cache.current(),
        standing(Some(InteractionSource::Legacy), 0)
    );
    cache.observe(InteractionSource::Snapshot);
    assert_eq!(
        cache.current(),
        standing(Some(InteractionSource::Snapshot), 1)
    );
    assert_eq!(cache.usage(), (0, 0));
    cache.observe(InteractionSource::Snapshot);
    cache.retain(&closed(3, 1, true));
    assert_eq!(
        cache.current(),
        standing(Some(InteractionSource::Snapshot), 1)
    );
    cache.retain(&read(
        4,
        "answeredAndDecided",
        1,
        InteractionSource::Legacy,
        true,
    ));
    cache.observe(InteractionSource::Snapshot);
    assert_eq!(
        cache.current(),
        standing(Some(InteractionSource::Snapshot), 3)
    );
}

#[test]
fn default_bounds_are_fixed() {
    assert_eq!(MAX_CACHED_TASKS, 128);
    assert_eq!(MAX_CACHED_BYTES, 8 * 1024 * 1024);
    let cache = ThreadRequestCache::default();
    assert!(cache.is_unlocked());
    let held = cache.locked();
    assert!(!cache.is_unlocked());
    drop(held);
    assert_eq!(cache.usage(), (0, 0));
}
