use super::*;

const MEBIBYTE: u64 = 1024 * 1024;

fn policy() -> TransferPolicy {
    TransferPolicy {
        total: Duration::from_secs(900),
        idle: Duration::from_secs(60),
        local: Duration::from_secs(60),
    }
}

fn seconds(start: Instant, seconds: u64) -> Instant {
    start + Duration::from_secs(seconds)
}

fn timed_out(since: Option<Instant>) -> Option<Expiry> {
    Some(Expiry {
        failure: Failure::Transport(TIMED_OUT.into()),
        suspect: since,
    })
}

fn beat(beats: u64) -> Signals {
    Signals {
        beats,
        ..Signals::default()
    }
}

fn sent(beats: u64) -> Signals {
    Signals {
        beats,
        waiting: false,
        sent: true,
    }
}

fn waiting(beats: u64) -> Signals {
    Signals {
        beats,
        waiting: true,
        sent: false,
    }
}

fn streamed(watchdog: &mut Watchdog, start: Instant, from: u64, until: u64) {
    for second in from..=until {
        let observed = watchdog.observe(beat(second + 1), seconds(start, second));
        assert!(observed.progressed && !observed.tail);
        assert_eq!(watchdog.expired(seconds(start, second)), None);
    }
}

#[test]
fn silence_before_any_progress_ends_at_the_idle_bound() {
    let start = Instant::now();
    let watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    assert_eq!(watchdog.wake(), seconds(start, 60));
    assert_eq!(watchdog.expired(seconds(start, 59)), None);
    assert_eq!(watchdog.expired(seconds(start, 60)), timed_out(Some(start)));
}

#[test]
fn every_beat_restarts_the_idle_bound_from_its_own_instant() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 300);
    assert_eq!(watchdog.wake(), seconds(start, 360));
    assert_eq!(watchdog.suspect(), Some(seconds(start, 300)));
    let repeated = watchdog.observe(beat(301), seconds(start, 330));
    assert!(!repeated.progressed);
    assert_eq!(watchdog.expired(seconds(start, 359)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 360)),
        timed_out(Some(seconds(start, 300)))
    );
}

#[test]
fn a_slowly_draining_tail_outlives_the_idle_bound_and_a_dead_tail_still_ends() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 12 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 511);
    assert_eq!(watchdog.tail_until(), None);
    let handed = watchdog.observe(sent(513), seconds(start, 512));
    assert!(handed.progressed && handed.tail);
    assert_eq!(watchdog.tail_until(), Some(seconds(start, 768)));
    let drained_per_second = 8 * MEBIBYTE / 512;
    assert_eq!(drained_per_second, SLOWEST_BYTES_PER_SECOND);
    assert_eq!(TAIL_BYTES / drained_per_second, 256);
    assert_eq!(watchdog.wake(), seconds(start, 768));
    for second in [573, 700, 767] {
        assert_eq!(watchdog.expired(seconds(start, second)), None, "{second}");
    }
    assert_eq!(
        watchdog.expired(seconds(start, 768)),
        timed_out(Some(seconds(start, 512)))
    );
    let again = watchdog.observe(sent(513), seconds(start, 600));
    assert!(!again.tail && !again.progressed);
    assert_eq!(watchdog.wake(), seconds(start, 768));
}

#[test]
fn a_response_during_the_tail_counts_as_progress_and_extends_past_the_tail() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 12 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 511);
    watchdog.observe(sent(513), seconds(start, 512));
    let answered = watchdog.observe(sent(514), seconds(start, 760));
    assert!(answered.progressed && !answered.tail);
    assert_eq!(watchdog.wake(), seconds(start, 820));
    assert_eq!(watchdog.expired(seconds(start, 819)), None);
}

#[test]
fn a_fast_transfer_keeps_the_idle_floor_for_its_tail() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 4);
    assert!(watchdog.observe(sent(6), seconds(start, 5)).tail);
    assert_eq!(watchdog.wake(), seconds(start, 65));
    assert_eq!(watchdog.expired(seconds(start, 64)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 65)),
        timed_out(Some(seconds(start, 5)))
    );
}

#[test]
fn a_body_handed_over_at_once_assumes_the_slowest_supported_uplink() {
    let start = Instant::now();
    for (length, patience) in [
        (64 * 1024, 60),
        (MEBIBYTE, 64),
        (3 * MEBIBYTE, 192),
        (4 * MEBIBYTE, 256),
    ] {
        let mut watchdog = Watchdog::new(policy(), length, start + policy().total, start);
        watchdog.observe(beat(1), start);
        assert!(watchdog.observe(sent(2), start).tail);
        assert_eq!(watchdog.wake(), seconds(start, patience), "{length}");
        assert_eq!(watchdog.expired(seconds(start, patience - 1)), None);
        assert_eq!(
            watchdog.expired(seconds(start, patience)),
            timed_out(Some(start))
        );
    }
    assert_eq!(SLOWEST_BYTES_PER_SECOND, 16 * 1024);
    assert_eq!(TAIL_BYTES, 4 * MEBIBYTE);
}

#[test]
fn the_tail_never_outlives_the_total_bound() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 849);
    assert!(watchdog.observe(sent(851), seconds(start, 850)).tail);
    assert_eq!(watchdog.tail_until(), Some(seconds(start, 900)));
    assert_eq!(watchdog.wake(), seconds(start, 900));
    assert_eq!(watchdog.expired(seconds(start, 899)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 900)),
        timed_out(Some(seconds(start, 850)))
    );
}

#[test]
fn a_blocked_local_side_is_bounded_separately_and_never_blames_the_tunnel() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 9);
    watchdog.observe(waiting(10), seconds(start, 40));
    assert_eq!(watchdog.wake(), seconds(start, 100));
    assert_eq!(watchdog.suspect(), None);
    assert_eq!(watchdog.expired(seconds(start, 99)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 100)),
        Some(Expiry {
            failure: Failure::Local,
            suspect: None,
        })
    );
}

#[test]
fn time_spent_waiting_on_the_local_side_is_excluded_from_the_idle_bound() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 9);
    watchdog.observe(waiting(10), seconds(start, 10));
    watchdog.observe(waiting(10), seconds(start, 30));
    assert_eq!(watchdog.wake(), seconds(start, 70));
    let resumed = watchdog.observe(beat(10), seconds(start, 65));
    assert!(!resumed.progressed);
    assert_eq!(watchdog.wake(), seconds(start, 125));
    assert_eq!(watchdog.suspect(), Some(seconds(start, 65)));
    assert_eq!(watchdog.expired(seconds(start, 124)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 125)),
        timed_out(Some(seconds(start, 65)))
    );
}

#[test]
fn a_slow_but_progressing_local_side_restarts_its_bound_with_every_chunk() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    for step in 0..20 {
        let now = seconds(start, step * 40);
        assert_eq!(watchdog.expired(now), None, "{step}");
        let observed = watchdog.observe(waiting(step + 1), now);
        assert!(observed.progressed);
        assert_eq!(watchdog.wake(), now + Duration::from_secs(60));
    }
}

#[test]
fn the_total_bound_applies_while_waiting_locally_without_blaming_the_tunnel() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 50 * MEBIBYTE, start + policy().total, start);
    watchdog.observe(waiting(1), seconds(start, 870));
    assert_eq!(watchdog.wake(), seconds(start, 900));
    assert_eq!(watchdog.expired(seconds(start, 900)), timed_out(None));
}

#[test]
fn a_tail_inferred_from_a_slower_rate_is_floored_at_the_slowest_supported_uplink() {
    let start = Instant::now();
    let mut watchdog = Watchdog::new(policy(), 5 * MEBIBYTE, start + policy().total, start);
    streamed(&mut watchdog, start, 0, 127);
    assert!(watchdog.observe(sent(129), seconds(start, 128)).tail);
    assert_eq!(MEBIBYTE / 128, SLOWEST_BYTES_PER_SECOND / 2);
    assert_eq!(watchdog.tail_until(), Some(seconds(start, 128 + 256)));
    assert_eq!(watchdog.wake(), seconds(start, 384));
    assert_eq!(watchdog.expired(seconds(start, 383)), None);
    assert_eq!(
        watchdog.expired(seconds(start, 384)),
        timed_out(Some(seconds(start, 128)))
    );
    for (length, streamed_for) in [(50 * MEBIBYTE, 899), (5 * MEBIBYTE, 1), (9 * MEBIBYTE, 700)] {
        let mut watchdog = Watchdog::new(policy(), length, start + policy().total, start);
        watchdog.observe(beat(1), start);
        let handed = seconds(start, streamed_for);
        assert!(watchdog.observe(sent(2), handed).tail);
        let until = watchdog.tail_until().unwrap();
        assert!(until <= handed + Duration::from_secs(256), "{length}");
        assert!(until <= seconds(start, 900), "{length}");
    }
}

#[test]
fn the_transport_inherits_what_is_left_of_the_operation_deadline() {
    let start = Instant::now();
    let deadline = seconds(start, 900);
    let begun = seconds(start, 880);
    let mut watchdog = Watchdog::new(policy(), 3 * MEBIBYTE, deadline, begun);
    assert_eq!(watchdog.wake(), deadline);
    assert_eq!(watchdog.expired(seconds(start, 899)), None);
    assert_eq!(watchdog.expired(deadline), timed_out(Some(begun)));
    watchdog.observe(beat(1), seconds(start, 890));
    assert!(watchdog.observe(sent(2), seconds(start, 890)).tail);
    assert_eq!(watchdog.tail_until(), Some(deadline));
    assert_eq!(watchdog.wake(), deadline);
    let spent = Watchdog::new(policy(), MEBIBYTE, deadline, seconds(start, 901));
    assert_eq!(spent.wake(), deadline);
    assert_eq!(
        spent.expired(seconds(start, 901)),
        timed_out(Some(seconds(start, 901)))
    );
}
