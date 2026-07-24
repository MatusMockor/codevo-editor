#[path = "../src/debug_node_child_inspector_discovery_strategy.rs"]
mod debug_node_child_inspector_discovery_strategy;
#[path = "../src/debug_node_child_target_registry.rs"]
mod debug_node_child_target_registry;

use debug_node_child_inspector_discovery_strategy::*;
use debug_node_child_target_registry::*;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

struct SnapshotProvider {
    results: VecDeque<Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure>>,
}

impl AuthoritativeChildInspectorSnapshotProvider for SnapshotProvider {
    fn capture(
        &mut self,
        _root: OwnedChildProcessRoot,
        _deadline: Instant,
    ) -> Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure> {
        self.results
            .pop_front()
            .unwrap_or(Err(ChildInspectorDiscoveryFailure::SnapshotChanged))
    }
}

struct SlowSnapshotProvider;

impl AuthoritativeChildInspectorSnapshotProvider for SlowSnapshotProvider {
    fn capture(
        &mut self,
        _root: OwnedChildProcessRoot,
        _deadline: Instant,
    ) -> Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure> {
        std::thread::sleep(Duration::from_millis(120));
        Ok(snapshot())
    }
}

fn root() -> OwnedChildProcessRoot {
    OwnedChildProcessRoot::new(40, 40, 100).expect("root")
}

fn snapshot() -> AuthoritativeChildInspectorSnapshot {
    snapshot_with_token(1)
}

fn snapshot_with_token(acquisition_token: u64) -> AuthoritativeChildInspectorSnapshot {
    AuthoritativeChildInspectorSnapshot::for_test(
        acquisition_token,
        vec![(40, 1, 40, 100), (41, 40, 40, 101), (42, 41, 40, 102)],
        vec![(LoopbackInspectorHost::Ipv4, 42, 9_230)],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            "ws://127.0.0.1:9230/target-a",
        )],
    )
}

fn strategy(
    result: Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure>,
) -> TrustedChildInspectorDiscoveryStrategy<SnapshotProvider> {
    TrustedChildInspectorDiscoveryStrategy::new(SnapshotProvider {
        results: VecDeque::from([result]),
    })
}

#[derive(Default)]
struct NoopReaper;

impl OwnedNodeProcessGroupReaper for NoopReaper {
    fn stop_and_reap(&mut self, _group: OwnedNodeProcessGroup) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn macos_platform_strategy_is_explicitly_blocked() {
    assert_eq!(
        MacOsAtomicChildInspectorSnapshotProvider::readiness(),
        ChildInspectorDiscoveryReadiness::Blocked {
            reason: "macOS cannot atomically bind process ancestry, listener ownership, and inspector HTTP target bytes into one snapshot generation."
        }
    );
    let mut strategy =
        TrustedChildInspectorDiscoveryStrategy::new(MacOsAtomicChildInspectorSnapshotProvider);
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::AtomicSnapshotUnavailable)
    );
}

#[test]
fn one_stable_snapshot_builds_a_registry_accepted_root_to_child_observation() {
    let observations = strategy(Ok(snapshot()))
        .discover(root())
        .expect("verified observations");
    assert_eq!(observations.len(), 1);

    let registry =
        NodeChildTargetRegistry::new(7, 40, 40, 100, NoopReaper).expect("registry foundation");
    let authorities = registry
        .reconcile(1, observations)
        .expect("registry accepts");
    assert_eq!(authorities.len(), 1);
}

#[test]
fn provider_race_never_publishes_a_partial_observation() {
    let mut strategy = strategy(Err(ChildInspectorDiscoveryFailure::SnapshotChanged));
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::SnapshotChanged)
    );
}

#[test]
fn acquisition_generation_is_strictly_monotonic_and_newer_invalid_evidence_burns_its_token() {
    let invalid_newer = AuthoritativeChildInspectorSnapshot::for_test(
        3,
        vec![(40, 1, 40, 100), (41, 40, 40, 101)],
        vec![(LoopbackInspectorHost::Ipv4, 41, 9_230)],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            "ws://127.0.0.1:9230/wrong-target",
        )],
    );
    let mut strategy = TrustedChildInspectorDiscoveryStrategy::new(SnapshotProvider {
        results: VecDeque::from([
            Ok(snapshot_with_token(2)),
            Ok(snapshot_with_token(2)),
            Ok(invalid_newer),
            Ok(snapshot_with_token(2)),
            Ok(snapshot_with_token(4)),
        ]),
    });

    let registry =
        NodeChildTargetRegistry::new(8, 40, 40, 100, NoopReaper).expect("registry foundation");
    let observations = strategy.discover(root()).expect("new snapshot");
    assert!(registry.reconcile(1, observations).is_ok());
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::SnapshotChanged)
    );
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::EndpointIdentityChanged)
    );
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::SnapshotChanged)
    );
    let observations = strategy.discover(root()).expect("newest snapshot");
    assert!(
        registry.reconcile(4, observations).is_ok(),
        "only a fresh acquisition can advance a later registry discovery epoch"
    );
}

#[test]
fn provider_result_arriving_after_the_capture_deadline_is_discarded() {
    let mut strategy = TrustedChildInspectorDiscoveryStrategy::new(SlowSnapshotProvider);
    assert_eq!(
        strategy.discover(root()),
        Err(ChildInspectorDiscoveryFailure::SnapshotTimedOut)
    );
}

#[test]
fn duplicate_pid_or_pid_reuse_inside_one_snapshot_is_ambiguous() {
    for processes in [
        vec![(40, 1, 40, 100), (41, 40, 40, 101), (41, 40, 40, 101)],
        vec![(40, 1, 40, 100), (41, 40, 40, 101), (41, 40, 40, 102)],
    ] {
        let snapshot = AuthoritativeChildInspectorSnapshot::for_test(
            1,
            processes,
            vec![(LoopbackInspectorHost::Ipv4, 41, 9_230)],
            vec![(
                LoopbackInspectorHost::Ipv4,
                9_230,
                "target-a",
                "ws://127.0.0.1:9230/target-a",
            )],
        );
        assert_eq!(
            strategy(Ok(snapshot)).discover(root()),
            Err(ChildInspectorDiscoveryFailure::AmbiguousProcess)
        );
    }
}

#[test]
fn root_generation_drift_fails_closed() {
    let snapshot = AuthoritativeChildInspectorSnapshot::for_test(
        1,
        vec![(40, 1, 40, 99), (41, 40, 40, 101)],
        vec![(LoopbackInspectorHost::Ipv4, 41, 9_230)],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            "ws://127.0.0.1:9230/target-a",
        )],
    );
    assert_eq!(
        strategy(Ok(snapshot)).discover(root()),
        Err(ChildInspectorDiscoveryFailure::ProcessGenerationChanged)
    );
}

#[test]
fn listener_or_http_target_ambiguity_fails_closed() {
    let duplicate_listener = AuthoritativeChildInspectorSnapshot::for_test(
        1,
        vec![(40, 1, 40, 100), (41, 40, 40, 101)],
        vec![
            (LoopbackInspectorHost::Ipv4, 41, 9_230),
            (LoopbackInspectorHost::Ipv4, 41, 9_230),
        ],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            "ws://127.0.0.1:9230/target-a",
        )],
    );
    assert_eq!(
        strategy(Ok(duplicate_listener)).discover(root()),
        Err(ChildInspectorDiscoveryFailure::AmbiguousEndpoint)
    );

    let mismatched_http_identity = AuthoritativeChildInspectorSnapshot::for_test(
        1,
        vec![(40, 1, 40, 100), (41, 40, 40, 101)],
        vec![(LoopbackInspectorHost::Ipv4, 41, 9_230)],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            "ws://127.0.0.1:9230/target-b",
        )],
    );
    assert_eq!(
        strategy(Ok(mismatched_http_identity)).discover(root()),
        Err(ChildInspectorDiscoveryFailure::EndpointIdentityChanged)
    );

    let oversized_http_identity = AuthoritativeChildInspectorSnapshot::for_test(
        1,
        vec![(40, 1, 40, 100), (41, 40, 40, 101)],
        vec![(LoopbackInspectorHost::Ipv4, 41, 9_230)],
        vec![(
            LoopbackInspectorHost::Ipv4,
            9_230,
            "target-a",
            &"x".repeat(513),
        )],
    );
    assert_eq!(
        strategy(Ok(oversized_http_identity)).discover(root()),
        Err(ChildInspectorDiscoveryFailure::EndpointIdentityChanged)
    );
}

#[test]
fn missing_parent_cycle_and_foreign_group_fail_ancestry_validation() {
    for processes in [
        vec![(40, 1, 40, 100), (42, 41, 40, 102)],
        vec![(40, 1, 40, 100), (41, 42, 40, 101), (42, 41, 40, 102)],
        vec![(40, 1, 40, 100), (41, 40, 99, 101)],
    ] {
        let owner = processes.last().expect("target").0;
        let snapshot = AuthoritativeChildInspectorSnapshot::for_test(
            1,
            processes,
            vec![(LoopbackInspectorHost::Ipv4, owner, 9_230)],
            vec![(
                LoopbackInspectorHost::Ipv4,
                9_230,
                "target-a",
                "ws://127.0.0.1:9230/target-a",
            )],
        );
        assert_eq!(
            strategy(Ok(snapshot)).discover(root()),
            Err(ChildInspectorDiscoveryFailure::IncompleteAncestry)
        );
    }
}

#[test]
fn snapshot_bounds_are_enforced_before_projection() {
    let processes = (0..513)
        .map(|index| {
            let pid = 40 + index as u32;
            (pid, pid.saturating_sub(1), 40, 100 + index as u64)
        })
        .collect();
    let oversized =
        AuthoritativeChildInspectorSnapshot::for_test(1, processes, Vec::new(), Vec::new());
    assert_eq!(
        strategy(Ok(oversized)).discover(root()),
        Err(ChildInspectorDiscoveryFailure::CapacityExceeded)
    );
}
