use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;
#[cfg(test)]
use std::sync::MutexGuard;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const LEASE_RANDOM_BYTES: usize = 16;
const LEASE_ID_BYTES: usize = LEASE_RANDOM_BYTES * 2;
const MAX_RANDOM_COLLISION_ATTEMPTS: usize = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct NodeAttachCandidateLeasePolicy {
    ttl: Duration,
    maximum_global_leases: usize,
    maximum_leases_per_authority: usize,
}

impl NodeAttachCandidateLeasePolicy {
    pub(crate) fn new(
        ttl: Duration,
        maximum_global_leases: usize,
        maximum_leases_per_authority: usize,
    ) -> Result<Self, &'static str> {
        if ttl.is_zero() {
            return Err("candidate lease TTL must be positive");
        }
        if maximum_global_leases == 0 {
            return Err("candidate lease capacity must be positive");
        }
        if maximum_leases_per_authority == 0 || maximum_leases_per_authority > maximum_global_leases
        {
            return Err("candidate lease per-authority capacity is invalid");
        }
        Ok(Self {
            ttl,
            maximum_global_leases,
            maximum_leases_per_authority,
        })
    }
}

/// An opaque, single-use capability. Its debug representation is deliberately
/// redacted so the capability cannot accidentally enter logs.
#[derive(Clone, Eq, Hash, PartialEq)]
pub(crate) struct NodeAttachCandidateLeaseId(String);

impl NodeAttachCandidateLeaseId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for NodeAttachCandidateLeaseId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NodeAttachCandidateLeaseId([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NodeAttachCandidateLeaseIssueError {
    CapacityClosed,
    EntropyUnavailable,
}

/// All invalid consume attempts intentionally collapse to the same result.
/// Callers cannot distinguish an expired, stale, foreign, malformed, unknown,
/// or already consumed capability.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct NodeAttachCandidateLeaseClosed;

struct CandidateLease<Authority, Payload> {
    authority: Authority,
    payload: Payload,
    expires_at: Instant,
}

struct CandidateLeaseState<Authority, Payload> {
    leases: HashMap<String, CandidateLease<Authority, Payload>>,
    authority_counts: HashMap<Authority, usize>,
}

impl<Authority, Payload> Default for CandidateLeaseState<Authority, Payload> {
    fn default() -> Self {
        Self {
            leases: HashMap::new(),
            authority_counts: HashMap::new(),
        }
    }
}

trait CandidateLeaseClock: Send + Sync {
    fn now(&self) -> Instant;
}

struct SystemCandidateLeaseClock;

impl CandidateLeaseClock for SystemCandidateLeaseClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

trait CandidateLeaseEntropy: Send + Sync {
    fn fill(&self, bytes: &mut [u8]) -> Result<(), ()>;
}

/// Uses the same operating-system CSPRNG primitive as workspace capabilities.
/// `getentropy` is bounded to 256 bytes; lease IDs request only 16.
struct OsCandidateLeaseEntropy;

impl CandidateLeaseEntropy for OsCandidateLeaseEntropy {
    fn fill(&self, bytes: &mut [u8]) -> Result<(), ()> {
        if bytes.len() > 256 {
            return Err(());
        }
        // SAFETY: `bytes` is a valid writable slice for exactly `bytes.len()`
        // bytes, and `getentropy` does not retain the pointer.
        (unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } == 0)
            .then_some(())
            .ok_or(())
    }
}

/// Bounded, root/session-agnostic storage for Node attach candidate proofs.
///
/// `Authority` is deliberately generic: production can bind a retained
/// workspace identity, a session epoch, or a composite of both. `Payload`
/// remains backend-only, so process identifiers and argv never need a wire
/// representation.
pub(crate) struct NodeAttachCandidateLeaseRegistry<Authority, Payload>
where
    Authority: Clone + Eq + Hash,
{
    policy: NodeAttachCandidateLeasePolicy,
    state: Mutex<CandidateLeaseState<Authority, Payload>>,
    clock: Arc<dyn CandidateLeaseClock>,
    entropy: Arc<dyn CandidateLeaseEntropy>,
}

impl<Authority, Payload> NodeAttachCandidateLeaseRegistry<Authority, Payload>
where
    Authority: Clone + Eq + Hash,
{
    pub(crate) fn new(policy: NodeAttachCandidateLeasePolicy) -> Self {
        Self::with_sources(
            policy,
            Arc::new(SystemCandidateLeaseClock),
            Arc::new(OsCandidateLeaseEntropy),
        )
    }

    pub(crate) fn issue(
        &self,
        authority: Authority,
        payload: Payload,
    ) -> Result<NodeAttachCandidateLeaseId, NodeAttachCandidateLeaseIssueError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NodeAttachCandidateLeaseIssueError::CapacityClosed)?;
        let now = self.clock.now();
        let Some(expires_at) = now.checked_add(self.policy.ttl) else {
            return Err(NodeAttachCandidateLeaseIssueError::CapacityClosed);
        };
        let retired = remove_expired(&mut state, now);
        if state.leases.len() >= self.policy.maximum_global_leases
            || state.authority_counts.get(&authority).copied().unwrap_or(0)
                >= self.policy.maximum_leases_per_authority
        {
            drop(state);
            drop(retired);
            return Err(NodeAttachCandidateLeaseIssueError::CapacityClosed);
        }

        let id = match self.unique_id(&state) {
            Ok(id) => id,
            Err(error) => {
                drop(state);
                drop(retired);
                return Err(error);
            }
        };
        state.leases.insert(
            id.0.clone(),
            CandidateLease {
                authority: authority.clone(),
                payload,
                expires_at,
            },
        );
        *state.authority_counts.entry(authority).or_insert(0) += 1;
        drop(state);
        drop(retired);
        Ok(id)
    }

    pub(crate) fn consume(
        &self,
        authority: &Authority,
        lease_id: &str,
    ) -> Result<Payload, NodeAttachCandidateLeaseClosed> {
        if !valid_lease_id(lease_id) {
            return Err(NodeAttachCandidateLeaseClosed);
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| NodeAttachCandidateLeaseClosed)?;
        let now = self.clock.now();
        let retired = remove_expired(&mut state, now);

        // Take before checking the authority. Every recognized capability has
        // exactly one consume attempt, including a foreign or stale caller.
        let lease = match state.leases.remove(lease_id) {
            Some(lease) => lease,
            None => {
                drop(state);
                drop(retired);
                return Err(NodeAttachCandidateLeaseClosed);
            }
        };
        decrement_authority_count(&mut state.authority_counts, &lease.authority);
        let authority_matches = &lease.authority == authority;
        drop(state);
        drop(retired);
        if !authority_matches || now >= lease.expires_at {
            return Err(NodeAttachCandidateLeaseClosed);
        }
        Ok(lease.payload)
    }

    pub(crate) fn cleanup_expired(&self) -> usize {
        let Ok(mut state) = self.state.lock() else {
            return 0;
        };
        let retired = remove_expired(&mut state, self.clock.now());
        let count = retired.len();
        drop(state);
        drop(retired);
        count
    }

    pub(crate) fn revoke_authority(&self, authority: &Authority) -> usize {
        let Ok(mut state) = self.state.lock() else {
            return 0;
        };
        let revoked = state
            .leases
            .iter()
            .filter_map(|(id, lease)| (&lease.authority == authority).then_some(id.clone()))
            .collect::<Vec<_>>();
        let retired = revoked
            .iter()
            .filter_map(|id| {
                let lease = state.leases.remove(id)?;
                decrement_authority_count(&mut state.authority_counts, &lease.authority);
                Some(lease)
            })
            .collect::<Vec<_>>();
        let count = retired.len();
        drop(state);
        drop(retired);
        count
    }

    pub(crate) fn revoke_all(&self) -> Result<usize, NodeAttachCandidateLeaseClosed> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| NodeAttachCandidateLeaseClosed)?;
        let retired = std::mem::take(&mut state.leases)
            .into_values()
            .collect::<Vec<_>>();
        state.authority_counts.clear();
        let count = retired.len();
        drop(state);
        drop(retired);
        Ok(count)
    }

    #[cfg(test)]
    pub(crate) fn live_lease_count_for_test(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.leases.len())
            .unwrap_or(usize::MAX)
    }

    fn unique_id(
        &self,
        state: &CandidateLeaseState<Authority, Payload>,
    ) -> Result<NodeAttachCandidateLeaseId, NodeAttachCandidateLeaseIssueError> {
        for _ in 0..MAX_RANDOM_COLLISION_ATTEMPTS {
            let mut random = [0_u8; LEASE_RANDOM_BYTES];
            self.entropy
                .fill(&mut random)
                .map_err(|_| NodeAttachCandidateLeaseIssueError::EntropyUnavailable)?;
            let id = encode_lease_id(random);
            if !state.leases.contains_key(&id) {
                return Ok(NodeAttachCandidateLeaseId(id));
            }
        }
        Err(NodeAttachCandidateLeaseIssueError::EntropyUnavailable)
    }

    fn with_sources(
        policy: NodeAttachCandidateLeasePolicy,
        clock: Arc<dyn CandidateLeaseClock>,
        entropy: Arc<dyn CandidateLeaseEntropy>,
    ) -> Self {
        Self {
            policy,
            state: Mutex::new(CandidateLeaseState::default()),
            clock,
            entropy,
        }
    }
}

fn encode_lease_id(random: [u8; LEASE_RANDOM_BYTES]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(LEASE_ID_BYTES);
    for byte in random {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn valid_lease_id(candidate: &str) -> bool {
    candidate.len() == LEASE_ID_BYTES
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn remove_expired<Authority, Payload>(
    state: &mut CandidateLeaseState<Authority, Payload>,
    now: Instant,
) -> Vec<CandidateLease<Authority, Payload>>
where
    Authority: Eq + Hash,
{
    let expired = state
        .leases
        .iter()
        .filter_map(|(id, lease)| (now >= lease.expires_at).then_some(id.clone()))
        .collect::<Vec<_>>();
    expired
        .into_iter()
        .filter_map(|id| {
            let lease = state.leases.remove(&id)?;
            decrement_authority_count(&mut state.authority_counts, &lease.authority);
            Some(lease)
        })
        .collect()
}

fn decrement_authority_count<Authority>(
    counts: &mut HashMap<Authority, usize>,
    authority: &Authority,
) where
    Authority: Eq + Hash,
{
    let remove = if let Some(count) = counts.get_mut(authority) {
        debug_assert!(*count > 0, "lease authority count underflow");
        *count -= 1;
        *count == 0
    } else {
        debug_assert!(false, "missing lease authority count");
        false
    };
    if remove {
        counts.remove(authority);
    }
}

#[cfg(test)]
fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Weak;
    use std::thread;

    #[derive(Clone)]
    struct ManualClock {
        origin: Instant,
        millis: Arc<AtomicU64>,
    }

    impl ManualClock {
        fn new() -> Self {
            Self {
                origin: Instant::now(),
                millis: Arc::new(AtomicU64::new(0)),
            }
        }

        fn advance(&self, millis: u64) {
            self.millis.fetch_add(millis, Ordering::SeqCst);
        }
    }

    impl CandidateLeaseClock for ManualClock {
        fn now(&self) -> Instant {
            self.origin + Duration::from_millis(self.millis.load(Ordering::SeqCst))
        }
    }

    struct SequenceEntropy(Mutex<VecDeque<[u8; LEASE_RANDOM_BYTES]>>);

    impl SequenceEntropy {
        fn new(values: impl IntoIterator<Item = [u8; LEASE_RANDOM_BYTES]>) -> Self {
            Self(Mutex::new(values.into_iter().collect()))
        }
    }

    impl CandidateLeaseEntropy for SequenceEntropy {
        fn fill(&self, bytes: &mut [u8]) -> Result<(), ()> {
            let value = lock_recover(&self.0).pop_front().ok_or(())?;
            bytes.copy_from_slice(&value);
            Ok(())
        }
    }

    fn registry(
        clock: &ManualClock,
        entropy: impl IntoIterator<Item = [u8; LEASE_RANDOM_BYTES]>,
        global: usize,
        per_authority: usize,
    ) -> NodeAttachCandidateLeaseRegistry<String, String> {
        NodeAttachCandidateLeaseRegistry::with_sources(
            NodeAttachCandidateLeasePolicy::new(Duration::from_millis(100), global, per_authority)
                .expect("policy"),
            Arc::new(clock.clone()),
            Arc::new(SequenceEntropy::new(entropy)),
        )
    }

    #[test]
    fn policy_rejects_zero_and_inverted_bounds() {
        assert!(NodeAttachCandidateLeasePolicy::new(Duration::ZERO, 1, 1).is_err());
        assert!(NodeAttachCandidateLeasePolicy::new(Duration::from_secs(1), 0, 0).is_err());
        assert!(NodeAttachCandidateLeasePolicy::new(Duration::from_secs(1), 2, 3).is_err());
    }

    #[test]
    fn issued_id_is_128_bit_hex_and_redacted_in_debug_output() {
        let clock = ManualClock::new();
        let registry = registry(&clock, [[0xab; LEASE_RANDOM_BYTES]], 2, 2);
        let lease = registry
            .issue("root-a".to_string(), "proof".to_string())
            .expect("lease");
        assert_eq!(lease.as_str(), "abababababababababababababababab");
        assert_eq!(
            format!("{lease:?}"),
            "NodeAttachCandidateLeaseId([REDACTED])"
        );
    }

    #[test]
    fn production_entropy_issues_distinct_capabilities() {
        let registry = NodeAttachCandidateLeaseRegistry::<String, ()>::new(
            NodeAttachCandidateLeasePolicy::new(Duration::from_secs(1), 2, 2).expect("policy"),
        );
        let first = registry
            .issue("root".to_string(), ())
            .expect("first capability");
        let second = registry
            .issue("root".to_string(), ())
            .expect("second capability");
        assert_ne!(first.as_str(), second.as_str());
        assert!(valid_lease_id(first.as_str()));
        assert!(valid_lease_id(second.as_str()));
    }

    #[test]
    fn consume_is_atomic_take_first_and_exactly_once_under_concurrency() {
        let clock = ManualClock::new();
        let registry = Arc::new(registry(&clock, [[1; LEASE_RANDOM_BYTES]], 2, 2));
        let authority = "root-a".to_string();
        let lease = registry
            .issue(authority.clone(), "proof".to_string())
            .expect("lease");
        let lease_id = lease.as_str().to_string();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let registry = Arc::clone(&registry);
            let authority = authority.clone();
            let lease_id = lease_id.clone();
            let barrier = Arc::clone(&barrier);
            workers.push(thread::spawn(move || {
                barrier.wait();
                registry.consume(&authority, &lease_id)
            }));
        }
        barrier.wait();
        let successes = workers
            .into_iter()
            .map(|worker| worker.join().expect("consumer"))
            .filter(Result::is_ok)
            .count();
        assert_eq!(successes, 1);
        assert_eq!(
            registry.consume(&authority, &lease_id),
            Err(NodeAttachCandidateLeaseClosed)
        );
    }

    #[test]
    fn foreign_authority_consumes_the_capability_but_receives_closed() {
        let clock = ManualClock::new();
        let registry = registry(&clock, [[2; LEASE_RANDOM_BYTES]], 2, 2);
        let lease = registry
            .issue("root-a".to_string(), "proof".to_string())
            .expect("lease");
        assert_eq!(
            registry.consume(&"root-b".to_string(), lease.as_str()),
            Err(NodeAttachCandidateLeaseClosed)
        );
        assert_eq!(
            registry.consume(&"root-a".to_string(), lease.as_str()),
            Err(NodeAttachCandidateLeaseClosed)
        );
    }

    #[test]
    fn expired_malformed_unknown_and_consumed_are_the_same_closed_error() {
        let clock = ManualClock::new();
        let registry = registry(&clock, [[3; LEASE_RANDOM_BYTES]], 2, 2);
        let authority = "root-a".to_string();
        let lease = registry
            .issue(authority.clone(), "proof".to_string())
            .expect("lease");
        clock.advance(100);
        for candidate in [
            lease.as_str(),
            "not-a-lease",
            "ffffffffffffffffffffffffffffffff",
        ] {
            assert_eq!(
                registry.consume(&authority, candidate),
                Err(NodeAttachCandidateLeaseClosed)
            );
        }
    }

    #[test]
    fn cleanup_releases_global_and_per_authority_capacity() {
        let clock = ManualClock::new();
        let registry = registry(
            &clock,
            [
                [4; LEASE_RANDOM_BYTES],
                [5; LEASE_RANDOM_BYTES],
                [6; LEASE_RANDOM_BYTES],
            ],
            2,
            1,
        );
        registry
            .issue("root-a".to_string(), "a".to_string())
            .expect("root-a lease");
        registry
            .issue("root-b".to_string(), "b".to_string())
            .expect("root-b lease");
        assert_eq!(
            registry.issue("root-a".to_string(), "blocked".to_string()),
            Err(NodeAttachCandidateLeaseIssueError::CapacityClosed)
        );

        clock.advance(100);
        assert_eq!(registry.cleanup_expired(), 2);
        registry
            .issue("root-a".to_string(), "replacement".to_string())
            .expect("capacity released");
    }

    #[test]
    fn authority_revocation_is_exact_and_releases_only_its_capacity() {
        let clock = ManualClock::new();
        let registry = registry(
            &clock,
            [
                [9; LEASE_RANDOM_BYTES],
                [10; LEASE_RANDOM_BYTES],
                [11; LEASE_RANDOM_BYTES],
            ],
            3,
            2,
        );
        let root_a = "root-a".to_string();
        let root_b = "root-b".to_string();
        let first_a = registry
            .issue(root_a.clone(), "a-1".to_string())
            .expect("first root-a lease");
        registry
            .issue(root_a.clone(), "a-2".to_string())
            .expect("second root-a lease");
        let only_b = registry
            .issue(root_b.clone(), "b".to_string())
            .expect("root-b lease");

        assert_eq!(registry.revoke_authority(&root_a), 2);
        assert_eq!(registry.revoke_authority(&root_a), 0);
        assert_eq!(
            registry.consume(&root_a, first_a.as_str()),
            Err(NodeAttachCandidateLeaseClosed)
        );
        assert_eq!(
            registry.consume(&root_b, only_b.as_str()),
            Ok("b".to_string())
        );
    }

    #[test]
    fn random_collision_retries_without_overwriting_the_first_payload() {
        let clock = ManualClock::new();
        let registry = registry(
            &clock,
            [
                [7; LEASE_RANDOM_BYTES],
                [7; LEASE_RANDOM_BYTES],
                [8; LEASE_RANDOM_BYTES],
            ],
            2,
            2,
        );
        let authority = "root-a".to_string();
        let first = registry
            .issue(authority.clone(), "first".to_string())
            .expect("first");
        let second = registry
            .issue(authority.clone(), "second".to_string())
            .expect("second");
        assert_ne!(first.as_str(), second.as_str());
        assert_eq!(
            registry.consume(&authority, first.as_str()),
            Ok("first".to_string())
        );
        assert_eq!(
            registry.consume(&authority, second.as_str()),
            Ok("second".to_string())
        );
    }

    #[test]
    fn entropy_failure_and_collision_exhaustion_preserve_existing_payload() {
        let clock = ManualClock::new();
        let no_entropy = registry(&clock, [], 1, 1);
        assert_eq!(
            no_entropy.issue("root-a".to_string(), "proof".to_string()),
            Err(NodeAttachCandidateLeaseIssueError::EntropyUnavailable)
        );

        let repeated = std::iter::repeat_n([15; LEASE_RANDOM_BYTES], 9);
        let registry = registry(&clock, repeated, 2, 2);
        let authority = "root-a".to_string();
        let first = registry
            .issue(authority.clone(), "first".to_string())
            .expect("first lease");
        assert_eq!(
            registry.issue(authority.clone(), "second".to_string()),
            Err(NodeAttachCandidateLeaseIssueError::EntropyUnavailable)
        );
        assert_eq!(
            registry.consume(&authority, first.as_str()),
            Ok("first".to_string())
        );
    }

    #[test]
    fn concurrent_issue_cannot_exceed_exact_capacity() {
        let registry = Arc::new(NodeAttachCandidateLeaseRegistry::<String, ()>::new(
            NodeAttachCandidateLeasePolicy::new(Duration::from_secs(1), 1, 1).expect("policy"),
        ));
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let workers = (0..2)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    registry.issue("root-a".to_string(), ())
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().expect("issuer"))
                .filter(Result::is_ok)
                .count(),
            1
        );
    }

    #[test]
    fn expiry_is_sampled_after_the_linearization_lock_is_acquired() {
        #[derive(Clone)]
        struct ObservedClock {
            inner: ManualClock,
            observations: std::sync::mpsc::Sender<()>,
            reads: Arc<AtomicU64>,
        }
        impl CandidateLeaseClock for ObservedClock {
            fn now(&self) -> Instant {
                if self.reads.fetch_add(1, Ordering::SeqCst) > 0 {
                    let _ = self.observations.send(());
                }
                self.inner.now()
            }
        }

        let manual_clock = ManualClock::new();
        let (observations, observed) = std::sync::mpsc::channel();
        let clock = ObservedClock {
            inner: manual_clock.clone(),
            observations,
            reads: Arc::new(AtomicU64::new(0)),
        };
        let registry = Arc::new(NodeAttachCandidateLeaseRegistry::with_sources(
            NodeAttachCandidateLeasePolicy::new(Duration::from_millis(100), 1, 1).expect("policy"),
            Arc::new(clock),
            Arc::new(SequenceEntropy::new([[12; LEASE_RANDOM_BYTES]])),
        ));
        let authority = "root-a".to_string();
        let lease = registry
            .issue(authority.clone(), "proof".to_string())
            .expect("lease");
        let lease_id = lease.as_str().to_string();
        let state_guard = registry.state.lock().expect("state lock");
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let worker = {
            let registry = Arc::clone(&registry);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                registry.consume(&authority, &lease_id)
            })
        };
        barrier.wait();
        assert!(observed.recv_timeout(Duration::from_millis(50)).is_err());
        manual_clock.advance(100);
        drop(state_guard);
        observed
            .recv_timeout(Duration::from_secs(1))
            .expect("clock sampled after lock release");
        assert_eq!(
            worker.join().expect("consumer"),
            Err(NodeAttachCandidateLeaseClosed)
        );
    }

    #[test]
    fn poisoned_registry_fails_closed_without_exposing_payload() {
        let clock = ManualClock::new();
        let registry = Arc::new(registry(&clock, [[13; LEASE_RANDOM_BYTES]], 1, 1));
        let authority = "root-a".to_string();
        let lease = registry
            .issue(authority.clone(), "proof".to_string())
            .expect("lease");
        let lease_id = lease.as_str().to_string();
        let poison_target = Arc::clone(&registry);
        assert!(thread::spawn(move || {
            let _guard = poison_target.state.lock().expect("state lock");
            panic!("intentional poison");
        })
        .join()
        .is_err());

        assert_eq!(
            registry.consume(&authority, &lease_id),
            Err(NodeAttachCandidateLeaseClosed)
        );
        assert_eq!(
            registry.issue(authority, "replacement".to_string()),
            Err(NodeAttachCandidateLeaseIssueError::CapacityClosed)
        );
        assert_eq!(registry.cleanup_expired(), 0);
    }

    struct ReentrantDropProbe {
        lock_was_available: Arc<AtomicBool>,
        registry: Weak<NodeAttachCandidateLeaseRegistry<String, ReentrantDropProbe>>,
    }

    impl Drop for ReentrantDropProbe {
        fn drop(&mut self) {
            if let Some(registry) = self.registry.upgrade() {
                self.lock_was_available
                    .store(registry.state.try_lock().is_ok(), Ordering::SeqCst);
            }
        }
    }

    #[test]
    fn retired_payload_is_dropped_after_registry_lock_is_released() {
        let clock = ManualClock::new();
        let registry = Arc::new(NodeAttachCandidateLeaseRegistry::with_sources(
            NodeAttachCandidateLeasePolicy::new(Duration::from_millis(100), 1, 1).expect("policy"),
            Arc::new(clock.clone()),
            Arc::new(SequenceEntropy::new([[14; LEASE_RANDOM_BYTES]])),
        ));
        let lock_was_available = Arc::new(AtomicBool::new(false));
        registry
            .issue(
                "root-a".to_string(),
                ReentrantDropProbe {
                    lock_was_available: Arc::clone(&lock_was_available),
                    registry: Arc::downgrade(&registry),
                },
            )
            .expect("lease");
        clock.advance(100);
        assert_eq!(registry.cleanup_expired(), 1);
        assert!(lock_was_available.load(Ordering::SeqCst));
    }
}
