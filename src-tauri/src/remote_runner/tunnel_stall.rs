use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub(super) const HEAVY_UPLOAD_BYTES: usize = 64 * 1024;
const SETTLE: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
pub(in crate::remote_runner) struct StallPolicy {
    pub(in crate::remote_runner) quiet: Duration,
    pub(in crate::remote_runner) probe: Duration,
    pub(in crate::remote_runner) upload_bytes_per_second: u64,
    pub(in crate::remote_runner) upload_grace_limit: Duration,
}

impl StallPolicy {
    pub(in crate::remote_runner) const DEFAULT: Self = Self {
        quiet: Duration::from_secs(3),
        probe: Duration::from_secs(12),
        upload_bytes_per_second: 16 * 1024,
        upload_grace_limit: Duration::from_secs(20),
    };

    fn upload_grace(&self, bytes: usize) -> Duration {
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        let milliseconds = bytes.saturating_mul(1_000) / self.upload_bytes_per_second.max(1);
        Duration::from_millis(milliseconds).min(self.upload_grace_limit)
    }
}

#[derive(Default)]
struct Uploads {
    bytes: usize,
    until: Option<Instant>,
}

pub(super) struct Evidence {
    policy: StallPolicy,
    origin: Instant,
    inbound: AtomicU64,
    suspected: AtomicU64,
    uploads: Mutex<Uploads>,
}

impl Evidence {
    pub(super) fn new(policy: StallPolicy) -> Self {
        Self {
            policy,
            origin: Instant::now(),
            inbound: AtomicU64::new(0),
            suspected: AtomicU64::new(0),
            uploads: Mutex::default(),
        }
    }

    pub(super) fn record_inbound(&self) {
        self.record_inbound_at(Instant::now());
    }

    fn record_inbound_at(&self, at: Instant) {
        self.inbound.fetch_max(self.stamp(at), Ordering::AcqRel);
    }

    pub(super) fn inbound(&self) -> Option<Instant> {
        self.instant(&self.inbound)
    }

    pub(super) fn suspect(&self, started: Instant, ended: Instant) {
        if ended.saturating_duration_since(started) < self.policy.quiet {
            return;
        }
        if self.inbound().is_some_and(|seen| seen > started) {
            return;
        }
        self.suspected
            .fetch_max(self.stamp(ended), Ordering::AcqRel);
    }

    pub(super) fn suspected(&self) -> Option<Instant> {
        self.instant(&self.suspected)
    }

    fn stamp(&self, at: Instant) -> u64 {
        let elapsed = at.saturating_duration_since(self.origin).as_nanos();
        u64::try_from(elapsed).unwrap_or(u64::MAX).saturating_add(1)
    }

    fn instant(&self, stamp: &AtomicU64) -> Option<Instant> {
        let nanoseconds = stamp.load(Ordering::Acquire).checked_sub(1)?;
        Some(self.origin + Duration::from_nanos(nanoseconds))
    }

    pub(super) fn suspended(&self, now: Instant) -> Option<Instant> {
        self.uploads().until.filter(|until| now < *until)
    }

    pub(super) fn upload(&self, bytes: usize, now: Instant) -> Option<UploadGuard<'_>> {
        if bytes == 0 {
            return None;
        }
        let mut uploads = self.uploads();
        uploads.bytes = uploads.bytes.saturating_add(bytes);
        if uploads.bytes >= HEAVY_UPLOAD_BYTES {
            let until = now + self.policy.upload_grace(uploads.bytes);
            uploads.until = Some(uploads.until.map_or(until, |known| known.max(until)));
        }
        Some(UploadGuard {
            evidence: self,
            bytes,
        })
    }

    fn uploads(&self) -> MutexGuard<'_, Uploads> {
        self.uploads.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub(super) struct UploadGuard<'a> {
    evidence: &'a Evidence,
    bytes: usize,
}

impl Drop for UploadGuard<'_> {
    fn drop(&mut self) {
        let mut uploads = self.evidence.uploads();
        uploads.bytes = uploads.bytes.saturating_sub(self.bytes);
        if uploads.bytes < HEAVY_UPLOAD_BYTES {
            uploads.until = None;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Load {
    Idle,
    Suspended(Instant),
    Waiting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Step {
    Rest(Option<Instant>),
    Wake(Instant),
    Probe(Instant),
    Stalled,
}

pub(super) struct StallDetector {
    policy: StallPolicy,
    since: Option<Instant>,
    probed: Option<Instant>,
    recheck: Option<Instant>,
    suspected: Option<Instant>,
}

impl StallDetector {
    pub(super) fn new(policy: StallPolicy) -> Self {
        Self {
            policy,
            since: None,
            probed: None,
            recheck: None,
            suspected: None,
        }
    }

    pub(super) fn suspect(&mut self, at: Option<Instant>) {
        self.suspected = at;
    }

    pub(super) fn step(
        &mut self,
        now: Instant,
        load: Load,
        inbound: Option<Instant>,
        probing: bool,
    ) -> Step {
        if !probing {
            self.probed = None;
        }
        let unanswered = self
            .suspected
            .filter(|at| inbound.is_none_or(|seen| seen < *at));
        if let Some(at) = unanswered {
            self.since = None;
            return self.judge(now, at);
        }
        match load {
            Load::Idle => return self.rest(None),
            Load::Suspended(until) => return self.rest(Some(until)),
            Load::Waiting => {}
        }
        let since = *self.since.get_or_insert(now);
        let anchor = inbound.map_or(since, |seen| seen.max(since));
        let probe_at = anchor + self.policy.quiet;
        if now < probe_at {
            self.recheck = None;
            return Step::Wake(probe_at);
        }
        self.judge(now, probe_at + self.policy.probe)
    }

    fn judge(&mut self, now: Instant, earliest: Instant) -> Step {
        let probed = *self.probed.get_or_insert(now);
        let verdict_at = earliest.max(probed + self.policy.probe);
        if now < verdict_at {
            self.recheck = None;
            return Step::Probe(verdict_at);
        }
        if now < verdict_at + SETTLE {
            return Step::Stalled;
        }
        let recheck = *self.recheck.get_or_insert(now + SETTLE);
        if now < recheck {
            return Step::Probe(recheck);
        }
        Step::Stalled
    }

    fn rest(&mut self, wake: Option<Instant>) -> Step {
        self.since = None;
        self.probed = None;
        self.recheck = None;
        Step::Rest(wake)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLICY: StallPolicy = StallPolicy::DEFAULT;

    fn at(start: Instant, milliseconds: u64) -> Instant {
        start + Duration::from_millis(milliseconds)
    }

    #[test]
    fn production_policy_stays_below_the_shortest_request_timeout() {
        assert_eq!(POLICY.quiet, Duration::from_secs(3));
        assert_eq!(POLICY.probe, Duration::from_secs(12));
        assert_eq!(POLICY.upload_bytes_per_second, 16 * 1024);
        assert_eq!(POLICY.upload_grace_limit, Duration::from_secs(20));
        assert!(POLICY.quiet + POLICY.probe < Duration::from_secs(25));
        assert!(POLICY.upload_grace_limit < Duration::from_secs(25));
    }

    #[test]
    fn a_silent_tunnel_is_probed_after_three_seconds_and_dead_after_fifteen() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        assert_eq!(
            detector.step(start, Load::Waiting, None, false),
            Step::Wake(at(start, 3_000))
        );
        assert_eq!(
            detector.step(at(start, 2_999), Load::Waiting, None, false),
            Step::Wake(at(start, 3_000))
        );
        assert_eq!(
            detector.step(at(start, 3_000), Load::Waiting, None, false),
            Step::Probe(at(start, 15_000))
        );
        assert_eq!(
            detector.step(at(start, 14_999), Load::Waiting, None, true),
            Step::Probe(at(start, 15_000))
        );
        assert_eq!(
            detector.step(at(start, 15_000), Load::Waiting, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn the_verdict_falls_exactly_fifteen_seconds_after_the_last_evidence() {
        let start = Instant::now();
        for (evidence, noticed) in [(1, 3_000), (2_999, 3_000), (3_001, 15_000), (9_000, 15_000)] {
            let mut detector = StallDetector::new(POLICY);
            detector.step(start, Load::Waiting, None, false);
            if noticed > 3_000 {
                detector.step(at(start, 3_000), Load::Waiting, None, false);
            }
            let seen = Some(at(start, evidence));
            let probing = noticed > 3_000;
            let mut step = detector.step(at(start, noticed), Load::Waiting, seen, probing);
            if step == Step::Wake(at(start, evidence + 3_000)) {
                step = detector.step(at(start, evidence + 3_000), Load::Waiting, seen, probing);
            }
            assert_eq!(
                step,
                Step::Probe(at(start, evidence + 15_000)),
                "{evidence}"
            );
            assert_eq!(
                detector.step(at(start, evidence + 14_999), Load::Waiting, seen, true),
                Step::Probe(at(start, evidence + 15_000)),
                "{evidence}"
            );
            assert_eq!(
                detector.step(at(start, evidence + 15_000), Load::Waiting, seen, true),
                Step::Stalled,
                "{evidence}"
            );
        }
    }

    #[test]
    fn evidence_older_than_the_wait_does_not_shorten_it() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        let stale = Some(start);
        assert_eq!(
            detector.step(at(start, 600_000), Load::Waiting, stale, false),
            Step::Wake(at(start, 603_000))
        );
    }

    #[test]
    fn an_idle_session_is_never_probed_however_long_it_stays_silent() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        for milliseconds in [0, 3_000, 15_000, 600_000] {
            assert_eq!(
                detector.step(at(start, milliseconds), Load::Idle, None, false),
                Step::Rest(None)
            );
        }
        assert_eq!(
            detector.step(at(start, 600_000), Load::Waiting, None, false),
            Step::Wake(at(start, 603_000))
        );
    }

    #[test]
    fn later_requests_do_not_postpone_the_probe_of_an_already_silent_session() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        for milliseconds in [500, 1_000, 2_500] {
            assert_eq!(
                detector.step(at(start, milliseconds), Load::Waiting, None, false),
                Step::Wake(at(start, 3_000))
            );
        }
        assert_eq!(
            detector.step(at(start, 3_100), Load::Waiting, None, false),
            Step::Probe(at(start, 15_100))
        );
        assert_eq!(
            detector.step(at(start, 3_200), Load::Waiting, None, true),
            Step::Probe(at(start, 15_100))
        );
    }

    #[test]
    fn regular_evidence_keeps_a_slow_session_alive_indefinitely() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        let mut now = start;
        let mut seen = None;
        for _ in 0..20 {
            now += POLICY.quiet;
            assert_eq!(
                detector.step(now, Load::Waiting, seen, false),
                Step::Probe(now + POLICY.probe)
            );
            now += POLICY.probe - Duration::from_millis(1);
            seen = Some(now);
            assert_eq!(
                detector.step(now, Load::Waiting, seen, true),
                Step::Wake(now + POLICY.quiet)
            );
        }
        assert!(now.duration_since(start) > Duration::from_secs(290));
    }

    #[test]
    fn a_probe_that_started_late_still_gets_its_whole_window() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        assert_eq!(
            detector.step(at(start, 40_000), Load::Waiting, None, false),
            Step::Probe(at(start, 52_000))
        );
        assert_eq!(
            detector.step(at(start, 51_999), Load::Waiting, None, true),
            Step::Probe(at(start, 52_000))
        );
        assert_eq!(
            detector.step(at(start, 52_000), Load::Waiting, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn a_probe_that_ended_unnoticed_is_started_again_with_a_whole_window() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        detector.step(at(start, 3_000), Load::Waiting, None, false);
        let answered = Some(at(start, 4_000));
        assert_eq!(
            detector.step(at(start, 15_000), Load::Waiting, answered, false),
            Step::Probe(at(start, 27_000))
        );
    }

    #[test]
    fn a_verdict_reached_late_waits_once_for_evidence_queued_behind_it() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        detector.step(at(start, 3_000), Load::Waiting, None, false);
        assert_eq!(
            detector.step(at(start, 60_000), Load::Waiting, None, true),
            Step::Probe(at(start, 60_250))
        );
        assert_eq!(
            detector.step(at(start, 60_100), Load::Waiting, None, true),
            Step::Probe(at(start, 60_250))
        );
        let mut rescued = StallDetector::new(POLICY);
        rescued.step(start, Load::Waiting, None, false);
        rescued.step(at(start, 3_000), Load::Waiting, None, false);
        rescued.step(at(start, 60_000), Load::Waiting, None, true);
        assert_eq!(
            rescued.step(
                at(start, 60_250),
                Load::Waiting,
                Some(at(start, 60_010)),
                false
            ),
            Step::Wake(at(start, 63_010))
        );
        assert_eq!(
            detector.step(at(start, 60_250), Load::Waiting, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn a_session_that_stops_waiting_abandons_the_running_probe_window() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        detector.step(at(start, 3_000), Load::Waiting, None, false);
        assert_eq!(
            detector.step(at(start, 4_000), Load::Idle, None, true),
            Step::Rest(None)
        );
        assert_eq!(
            detector.step(at(start, 20_000), Load::Waiting, None, false),
            Step::Wake(at(start, 23_000))
        );
    }

    #[test]
    fn a_suspended_watch_resumes_at_its_time_box_with_a_fresh_wait() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.step(start, Load::Waiting, None, false);
        detector.step(at(start, 3_000), Load::Waiting, None, false);
        let until = at(start, 8_000);
        assert_eq!(
            detector.step(at(start, 4_000), Load::Suspended(until), None, true),
            Step::Rest(Some(until))
        );
        assert_eq!(
            detector.step(until, Load::Waiting, None, false),
            Step::Wake(at(start, 11_000))
        );
        assert_eq!(
            detector.step(at(start, 11_000), Load::Waiting, None, false),
            Step::Probe(at(start, 23_000))
        );
        assert_eq!(
            detector.step(at(start, 23_000), Load::Waiting, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn a_large_upload_into_a_black_hole_is_declared_dead_thirty_five_seconds_after_it_began() {
        let start = Instant::now();
        let request_timeout = at(start, 25_000);
        let boxed = start + POLICY.upload_grace(320 * 1024);
        assert_eq!(boxed, at(start, 20_000));
        let mut detector = StallDetector::new(POLICY);
        assert_eq!(
            detector.step(start, Load::Suspended(boxed), None, false),
            Step::Rest(Some(boxed))
        );
        assert_eq!(
            detector.step(boxed, Load::Waiting, None, false),
            Step::Wake(at(start, 23_000))
        );
        assert_eq!(
            detector.step(at(start, 23_000), Load::Waiting, None, false),
            Step::Probe(at(start, 35_000))
        );
        detector.suspect(Some(request_timeout));
        assert_eq!(
            detector.step(request_timeout, Load::Idle, None, true),
            Step::Probe(at(start, 35_000))
        );
        let next = Load::Suspended(at(start, 46_000));
        assert_eq!(
            detector.step(at(start, 26_000), next, None, true),
            Step::Probe(at(start, 35_000))
        );
        assert_eq!(
            detector.step(at(start, 34_999), Load::Waiting, None, true),
            Step::Probe(at(start, 35_000))
        );
        assert_eq!(
            detector.step(at(start, 35_000), Load::Idle, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn an_unanswered_timeout_starts_one_probe_window_even_with_nothing_in_flight() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.suspect(Some(at(start, 25_000)));
        assert_eq!(
            detector.step(at(start, 25_000), Load::Idle, None, false),
            Step::Probe(at(start, 37_000))
        );
        assert_eq!(
            detector.step(at(start, 36_999), Load::Idle, None, true),
            Step::Probe(at(start, 37_000))
        );
        assert_eq!(
            detector.step(at(start, 37_000), Load::Idle, None, true),
            Step::Stalled
        );
    }

    #[test]
    fn any_later_byte_or_probe_answer_clears_the_suspicion_for_good() {
        let start = Instant::now();
        let mut detector = StallDetector::new(POLICY);
        detector.suspect(Some(at(start, 25_000)));
        detector.step(at(start, 25_000), Load::Idle, None, false);
        let answered = Some(at(start, 26_000));
        assert_eq!(
            detector.step(at(start, 26_000), Load::Idle, answered, false),
            Step::Rest(None)
        );
        for milliseconds in [37_000, 60_000, 600_000] {
            assert_eq!(
                detector.step(at(start, milliseconds), Load::Idle, answered, false),
                Step::Rest(None)
            );
        }
        assert_eq!(
            detector.step(at(start, 600_000), Load::Waiting, answered, false),
            Step::Wake(at(start, 603_000))
        );
        let earlier = Some(at(start, 24_999));
        let mut silent = StallDetector::new(POLICY);
        silent.suspect(Some(at(start, 25_000)));
        assert_eq!(
            silent.step(at(start, 25_000), Load::Idle, earlier, false),
            Step::Probe(at(start, 37_000))
        );
    }

    #[test]
    fn only_a_long_silent_request_raises_a_suspicion() {
        let evidence = Evidence::new(POLICY);
        let origin = evidence.origin;
        evidence.suspect(at(origin, 1_000), at(origin, 3_999));
        assert_eq!(evidence.suspected(), None);
        evidence.record_inbound_at(at(origin, 2_000));
        evidence.suspect(at(origin, 1_000), at(origin, 26_000));
        assert_eq!(evidence.suspected(), None);
        evidence.suspect(at(origin, 2_000), at(origin, 27_000));
        assert_eq!(evidence.suspected(), Some(at(origin, 27_000)));
        evidence.suspect(at(origin, 2_000), at(origin, 26_500));
        assert_eq!(evidence.suspected(), Some(at(origin, 27_000)));
    }

    #[test]
    fn upload_time_boxes_grow_with_the_queued_bytes_up_to_the_limit() {
        assert_eq!(POLICY.upload_grace(64 * 1024), Duration::from_secs(4));
        assert_eq!(POLICY.upload_grace(160 * 1024), Duration::from_secs(10));
        assert_eq!(POLICY.upload_grace(320 * 1024), Duration::from_secs(20));
        assert_eq!(
            POLICY.upload_grace(16 * 1024 * 1024),
            Duration::from_secs(20)
        );
        assert_eq!(POLICY.upload_grace(usize::MAX), Duration::from_secs(20));
    }

    #[test]
    fn a_heavy_upload_suspends_the_watch_only_for_its_time_box() {
        let evidence = Evidence::new(POLICY);
        let start = Instant::now();
        assert_eq!(evidence.suspended(start), None);
        let small = evidence.upload(HEAVY_UPLOAD_BYTES - 1, start);
        assert_eq!(evidence.suspended(start), None);
        drop(small);
        assert!(evidence.upload(0, start).is_none());
        let heavy = evidence.upload(HEAVY_UPLOAD_BYTES, start);
        assert_eq!(evidence.suspended(start), Some(at(start, 4_000)));
        assert_eq!(evidence.suspended(at(start, 3_999)), Some(at(start, 4_000)));
        assert_eq!(evidence.suspended(at(start, 4_000)), None);
        drop(heavy);
        assert_eq!(evidence.suspended(start), None);
    }

    #[test]
    fn concurrent_bodies_are_judged_by_their_total_and_release_on_unwind() {
        let evidence = Evidence::new(POLICY);
        let start = Instant::now();
        let first = evidence.upload(40 * 1024, start);
        assert_eq!(evidence.suspended(start), None);
        let second = evidence.upload(40 * 1024, at(start, 1_000));
        assert_eq!(evidence.suspended(start), Some(at(start, 6_000)));
        let third = evidence.upload(80 * 1024, at(start, 2_000));
        assert_eq!(evidence.suspended(start), Some(at(start, 12_000)));
        drop(third);
        assert_eq!(evidence.suspended(start), Some(at(start, 12_000)));
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _held = second;
            panic!("upload failed");
        }));
        assert!(unwound.is_err());
        assert_eq!(evidence.suspended(start), None);
        drop(first);
        let later = evidence.upload(HEAVY_UPLOAD_BYTES, at(start, 30_000));
        assert_eq!(
            evidence.suspended(at(start, 30_000)),
            Some(at(start, 34_000))
        );
        drop(later);
    }

    #[test]
    fn inbound_evidence_keeps_the_latest_observation_time() {
        let evidence = Evidence::new(POLICY);
        assert_eq!(evidence.inbound(), None);
        let origin = evidence.origin;
        evidence.record_inbound_at(origin);
        assert_eq!(evidence.inbound(), Some(origin));
        evidence.record_inbound_at(at(origin, 5_000));
        evidence.record_inbound_at(at(origin, 2_000));
        assert_eq!(evidence.inbound(), Some(at(origin, 5_000)));
        evidence.record_inbound();
        assert!(evidence.inbound() >= Some(at(origin, 5_000)));
    }
}
