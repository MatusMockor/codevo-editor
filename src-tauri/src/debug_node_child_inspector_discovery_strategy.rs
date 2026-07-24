#![allow(dead_code)] // Private child-inspector foundation; no IPC/UI/config exposure.

use crate::debug_node_child_target_registry::{
    ChildInspectorEndpoint, ChildProcessIdentity, LoopbackInspectorHost,
    VerifiedChildInspectorObservation,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_SNAPSHOT_PROCESSES: usize = 512;
const MAX_SNAPSHOT_LISTENERS: usize = 64;
const MAX_SNAPSHOT_TARGETS: usize = 32;
const MAX_ANCESTRY_DEPTH: usize = 32;
const MAX_TARGET_ID_BYTES: usize = 256;
const MAX_WEB_SOCKET_URL_BYTES: usize = 512;
const SNAPSHOT_CAPTURE_TIMEOUT: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ChildInspectorDiscoveryReadiness {
    Blocked { reason: &'static str },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ChildInspectorDiscoveryFailure {
    AmbiguousEndpoint,
    AmbiguousProcess,
    AtomicSnapshotUnavailable,
    CapacityExceeded,
    EndpointIdentityChanged,
    IncompleteAncestry,
    InvalidSnapshot,
    ProcessGenerationChanged,
    SnapshotChanged,
    SnapshotTimedOut,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OwnedChildProcessRoot {
    pid: u32,
    process_group_id: u32,
    start_token: u64,
}

impl OwnedChildProcessRoot {
    pub(crate) fn new(
        pid: u32,
        process_group_id: u32,
        start_token: u64,
    ) -> Result<Self, ChildInspectorDiscoveryFailure> {
        if pid == 0
            || process_group_id == 0
            || pid != process_group_id
            || start_token == 0
            || start_token > MAX_SAFE_INTEGER
        {
            return Err(ChildInspectorDiscoveryFailure::InvalidSnapshot);
        }
        Ok(Self {
            pid,
            process_group_id,
            start_token,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct SnapshotProcess {
    pid: u32,
    parent_pid: u32,
    process_group_id: u32,
    start_token: u64,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct SnapshotListener {
    host: LoopbackInspectorHost,
    owner_pid: u32,
    port: u16,
}

#[derive(Debug, Eq, PartialEq)]
struct SnapshotInspectorTarget {
    host: LoopbackInspectorHost,
    port: u16,
    target_id: Box<str>,
    web_socket_debugger_url: Box<str>,
}

/// Opaque, single-acquisition evidence. No public/platform constructor exists
/// while macOS cannot atomically bind libproc ancestry, kernel socket ownership,
/// and inspector HTTP bytes into one snapshot generation.
pub(crate) struct AuthoritativeChildInspectorSnapshot {
    // Provider generation marker only. The verifier can validate its bounded
    // monotonic domain, but cannot infer atomic kernel acquisition from this
    // number. Opacity plus the absence of a production constructor is the
    // authority boundary until a real atomic macOS provider exists.
    acquisition_token: u64,
    listeners: Vec<SnapshotListener>,
    processes: Vec<SnapshotProcess>,
    targets: Vec<SnapshotInspectorTarget>,
}

pub(crate) trait AuthoritativeChildInspectorSnapshotProvider {
    /// Implementations must observe `deadline`; the strategy also discards any
    /// result returned after it. No production provider is enabled while a
    /// blocking kernel capture cannot be cancelled and proven atomic.
    fn capture(
        &mut self,
        root: OwnedChildProcessRoot,
        deadline: Instant,
    ) -> Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure>;
}

pub(crate) struct TrustedChildInspectorDiscoveryStrategy<Provider> {
    last_acquisition_token: u64,
    provider: Provider,
}

impl<Provider> TrustedChildInspectorDiscoveryStrategy<Provider>
where
    Provider: AuthoritativeChildInspectorSnapshotProvider,
{
    pub(crate) fn new(provider: Provider) -> Self {
        Self {
            last_acquisition_token: 0,
            provider,
        }
    }

    pub(crate) fn discover(
        &mut self,
        root: OwnedChildProcessRoot,
    ) -> Result<Vec<VerifiedChildInspectorObservation>, ChildInspectorDiscoveryFailure> {
        let deadline = Instant::now()
            .checked_add(SNAPSHOT_CAPTURE_TIMEOUT)
            .ok_or(ChildInspectorDiscoveryFailure::SnapshotTimedOut)?;
        let snapshot = self.provider.capture(root, deadline)?;
        if Instant::now() > deadline {
            return Err(ChildInspectorDiscoveryFailure::SnapshotTimedOut);
        }
        if snapshot.acquisition_token == 0 || snapshot.acquisition_token > MAX_SAFE_INTEGER {
            return Err(ChildInspectorDiscoveryFailure::CapacityExceeded);
        }
        if snapshot.acquisition_token <= self.last_acquisition_token {
            return Err(ChildInspectorDiscoveryFailure::SnapshotChanged);
        }
        // Burn every timely, bounded acquisition generation before projecting it. An invalid
        // newer snapshot must not allow an older snapshot to be replayed on the next discovery.
        self.last_acquisition_token = snapshot.acquisition_token;
        verify_single_snapshot(root, snapshot)
    }
}

/// Current macOS readiness is intentionally blocked. Existing attach
/// primitives are reused conceptually and remain authoritative for their own
/// phases:
///
/// - `debug_node_attach_macos` generation-binds libproc argv/image snapshots;
/// - `debug_node_attach_socket_owner_macos` binds a held connection to its PID;
/// - `debug_node_attach_candidates` bounds and revalidates inspector HTTP.
///
/// They are sequential observations, not one kernel transaction. Combining
/// them here would create a heuristic auto-attach race, so this provider emits
/// no snapshot and therefore can never construct a registry observation.
pub(crate) struct MacOsAtomicChildInspectorSnapshotProvider;

impl MacOsAtomicChildInspectorSnapshotProvider {
    pub(crate) fn readiness() -> ChildInspectorDiscoveryReadiness {
        ChildInspectorDiscoveryReadiness::Blocked {
            reason: "macOS cannot atomically bind process ancestry, listener ownership, and inspector HTTP target bytes into one snapshot generation.",
        }
    }
}

impl AuthoritativeChildInspectorSnapshotProvider for MacOsAtomicChildInspectorSnapshotProvider {
    fn capture(
        &mut self,
        _root: OwnedChildProcessRoot,
        _deadline: Instant,
    ) -> Result<AuthoritativeChildInspectorSnapshot, ChildInspectorDiscoveryFailure> {
        Err(ChildInspectorDiscoveryFailure::AtomicSnapshotUnavailable)
    }
}

fn verify_single_snapshot(
    root: OwnedChildProcessRoot,
    snapshot: AuthoritativeChildInspectorSnapshot,
) -> Result<Vec<VerifiedChildInspectorObservation>, ChildInspectorDiscoveryFailure> {
    if snapshot.acquisition_token == 0
        || snapshot.acquisition_token > MAX_SAFE_INTEGER
        || snapshot.processes.len() > MAX_SNAPSHOT_PROCESSES
        || snapshot.listeners.len() > MAX_SNAPSHOT_LISTENERS
        || snapshot.targets.len() > MAX_SNAPSHOT_TARGETS
    {
        return Err(ChildInspectorDiscoveryFailure::CapacityExceeded);
    }

    let mut processes = BTreeMap::new();
    for process in snapshot.processes {
        if process.pid == 0
            || process.process_group_id == 0
            || process.start_token == 0
            || process.start_token > MAX_SAFE_INTEGER
            || processes.insert(process.pid, process).is_some()
        {
            return Err(ChildInspectorDiscoveryFailure::AmbiguousProcess);
        }
    }
    let root_process = processes
        .get(&root.pid)
        .ok_or(ChildInspectorDiscoveryFailure::ProcessGenerationChanged)?;
    if root_process.process_group_id != root.process_group_id
        || root_process.start_token != root.start_token
    {
        return Err(ChildInspectorDiscoveryFailure::ProcessGenerationChanged);
    }

    let mut listeners = BTreeMap::new();
    for listener in snapshot.listeners {
        if listener.owner_pid == 0
            || listener.port == 0
            || !processes.contains_key(&listener.owner_pid)
            || listeners
                .insert((listener.host, listener.port), listener)
                .is_some()
        {
            return Err(ChildInspectorDiscoveryFailure::AmbiguousEndpoint);
        }
    }
    if listeners.len() != snapshot.targets.len() {
        return Err(ChildInspectorDiscoveryFailure::AmbiguousEndpoint);
    }

    let mut target_ids = BTreeSet::new();
    let mut observations = Vec::with_capacity(snapshot.targets.len());
    for target in snapshot.targets {
        let listener = listeners
            .remove(&(target.host, target.port))
            .ok_or(ChildInspectorDiscoveryFailure::EndpointIdentityChanged)?;
        if target.target_id.is_empty()
            || target.target_id.len() > MAX_TARGET_ID_BYTES
            || target.web_socket_debugger_url.len() > MAX_WEB_SOCKET_URL_BYTES
            || !exact_web_socket_identity(&target)
            || listener.owner_pid == root.pid
        {
            return Err(ChildInspectorDiscoveryFailure::EndpointIdentityChanged);
        }
        if !target_ids.insert(target.target_id.clone()) {
            return Err(ChildInspectorDiscoveryFailure::AmbiguousEndpoint);
        }
        let ancestry = authoritative_ancestry(root, listener.owner_pid, &processes)?;
        let endpoint = ChildInspectorEndpoint::new(target.host, target.port, target.target_id)
            .map_err(|_| ChildInspectorDiscoveryFailure::EndpointIdentityChanged)?;
        observations.push(
            VerifiedChildInspectorObservation::new(ancestry, endpoint)
                .map_err(|_| ChildInspectorDiscoveryFailure::IncompleteAncestry)?,
        );
    }
    if !listeners.is_empty() {
        return Err(ChildInspectorDiscoveryFailure::AmbiguousEndpoint);
    }
    Ok(observations)
}

fn authoritative_ancestry(
    root: OwnedChildProcessRoot,
    target_pid: u32,
    processes: &BTreeMap<u32, SnapshotProcess>,
) -> Result<Vec<ChildProcessIdentity>, ChildInspectorDiscoveryFailure> {
    let mut reversed = Vec::new();
    let mut visited = BTreeSet::new();
    let mut current_pid = target_pid;
    loop {
        if reversed.len() >= MAX_ANCESTRY_DEPTH || !visited.insert(current_pid) {
            return Err(ChildInspectorDiscoveryFailure::IncompleteAncestry);
        }
        let process = processes
            .get(&current_pid)
            .ok_or(ChildInspectorDiscoveryFailure::IncompleteAncestry)?;
        if process.process_group_id != root.process_group_id {
            return Err(ChildInspectorDiscoveryFailure::IncompleteAncestry);
        }
        reversed.push(
            ChildProcessIdentity::new(
                process.pid,
                process.parent_pid,
                process.process_group_id,
                process.start_token,
            )
            .map_err(|_| ChildInspectorDiscoveryFailure::InvalidSnapshot)?,
        );
        if current_pid == root.pid {
            break;
        }
        current_pid = process.parent_pid;
    }
    reversed.reverse();
    if reversed.len() < 2 {
        return Err(ChildInspectorDiscoveryFailure::IncompleteAncestry);
    }
    Ok(reversed)
}

fn exact_web_socket_identity(target: &SnapshotInspectorTarget) -> bool {
    let expected = match target.host {
        LoopbackInspectorHost::Ipv4 => {
            format!(
                "ws://127.0.0.1:{}/{}",
                target.port,
                target.target_id.as_ref()
            )
        }
        LoopbackInspectorHost::Ipv6 => {
            format!("ws://[::1]:{}/{}", target.port, target.target_id.as_ref())
        }
    };
    target.web_socket_debugger_url.as_ref() == expected
}

#[cfg(test)]
impl AuthoritativeChildInspectorSnapshot {
    pub(crate) fn for_test(
        acquisition_token: u64,
        processes: Vec<(u32, u32, u32, u64)>,
        listeners: Vec<(LoopbackInspectorHost, u32, u16)>,
        targets: Vec<(LoopbackInspectorHost, u16, &str, &str)>,
    ) -> Self {
        Self {
            acquisition_token,
            processes: processes
                .into_iter()
                .map(
                    |(pid, parent_pid, process_group_id, start_token)| SnapshotProcess {
                        pid,
                        parent_pid,
                        process_group_id,
                        start_token,
                    },
                )
                .collect(),
            listeners: listeners
                .into_iter()
                .map(|(host, owner_pid, port)| SnapshotListener {
                    host,
                    owner_pid,
                    port,
                })
                .collect(),
            targets: targets
                .into_iter()
                .map(
                    |(host, port, target_id, web_socket_debugger_url)| SnapshotInspectorTarget {
                        host,
                        port,
                        target_id: target_id.into(),
                        web_socket_debugger_url: web_socket_debugger_url.into(),
                    },
                )
                .collect(),
        }
    }
}
