//! Private Node attach orchestration boundary.
//!
//! Candidate discovery and one-shot lease storage live below the same CDP
//! parent as the held transport typestate. No attach authority crosses a
//! command or IPC boundary until this module owns the complete transition.

#[path = "debug_node_attach_candidate_registry.rs"]
mod attach_candidate_registry;
#[path = "debug_node_attach_candidates.rs"]
mod attach_candidates;

#[cfg(target_os = "macos")]
use super::transport::{
    HeldExternalNodeCdpAttach, NodeCdpAdapter, NodeCdpHeldExternalConnectOptions,
};
#[cfg(target_os = "macos")]
use crate::debug_adapter::DebugEventEmitter;
use crate::debug_session_registry::DebugWorkspaceAuthority;
#[cfg(test)]
use attach_candidate_registry::NodeAttachCandidateLeaseClosed;
use attach_candidate_registry::{
    NodeAttachCandidateLeaseIssueError, NodeAttachCandidateLeasePolicy,
    NodeAttachCandidateLeaseRegistry,
};
#[cfg(target_os = "macos")]
use attach_candidates::collect_fresh_terminal_observations;
use attach_candidates::{
    EndpointObservationFailure, EndpointObservedNodeAttachCandidate, TerminalAuthorityObservation,
};
#[cfg(target_os = "macos")]
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

const NODE_ATTACH_CANDIDATE_LEASE_TTL: Duration = Duration::from_secs(30);
const MAX_NODE_ATTACH_CANDIDATE_LEASES: usize = 128;

/// Deliberately minimal picker projection. This type has no `Debug` or
/// serialization implementation, so the lease capability cannot accidentally
/// enter logs or an IPC contract while this flow remains private.
pub(crate) struct NodeAttachCandidatePickerItem {
    pub(crate) lease_id: String,
    pub(crate) label: String,
    pub(crate) detail: String,
    pub(crate) port: u16,
}

pub(crate) struct NodeAttachCandidateList {
    pub(crate) candidates: Vec<NodeAttachCandidatePickerItem>,
    pub(crate) truncated: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NodeAttachCandidatePublicationFailure {
    EndpointObservation(EndpointObservationFailure),
    LeaseIssue(NodeAttachCandidateLeaseIssueError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct NodeAttachCandidateConsumeClosed;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct NodeAttachCandidateListClosed;

/// Private publication boundary. The registry retains all process, terminal,
/// endpoint and workspace evidence; callers receive only the redacted picker
/// projection plus an opaque one-shot capability.
pub(crate) struct NodeAttachCandidatePublicationRegistry {
    leases: NodeAttachCandidateLeaseRegistry<
        DebugWorkspaceAuthority,
        EndpointObservedNodeAttachCandidate,
    >,
    listing_generation: Mutex<NodeAttachCandidateListingGeneration>,
}

#[derive(Default)]
struct NodeAttachCandidateListingGeneration {
    current: Option<u64>,
    next: u64,
}

pub(crate) struct NodeAttachCandidateListingTransaction {
    generation: u64,
    preserve_leases: bool,
    registry: Arc<NodeAttachCandidatePublicationRegistry>,
}

impl NodeAttachCandidatePublicationRegistry {
    pub(crate) fn new() -> Self {
        let policy = NodeAttachCandidateLeasePolicy::new(
            NODE_ATTACH_CANDIDATE_LEASE_TTL,
            MAX_NODE_ATTACH_CANDIDATE_LEASES,
            MAX_NODE_ATTACH_CANDIDATE_LEASES,
        )
        .expect("static Node attach lease policy must be valid");
        Self {
            leases: NodeAttachCandidateLeaseRegistry::new(policy),
            listing_generation: Mutex::new(NodeAttachCandidateListingGeneration::default()),
        }
    }

    pub(crate) fn begin_listing(
        self: &Arc<Self>,
    ) -> Result<NodeAttachCandidateListingTransaction, NodeAttachCandidateListClosed> {
        let mut state = self
            .listing_generation
            .lock()
            .map_err(|_| NodeAttachCandidateListClosed)?;
        let generation = state
            .next
            .checked_add(1)
            .ok_or(NodeAttachCandidateListClosed)?;
        self.leases
            .revoke_all()
            .map_err(|_| NodeAttachCandidateListClosed)?;
        state.next = generation;
        state.current = Some(generation);
        Ok(NodeAttachCandidateListingTransaction {
            generation,
            preserve_leases: false,
            registry: Arc::clone(self),
        })
    }

    pub(crate) fn invalidate_listings(&self) -> Result<(), NodeAttachCandidateListClosed> {
        let mut state = self
            .listing_generation
            .lock()
            .map_err(|_| NodeAttachCandidateListClosed)?;
        let generation = state
            .next
            .checked_add(1)
            .ok_or(NodeAttachCandidateListClosed)?;
        self.leases
            .revoke_all()
            .map_err(|_| NodeAttachCandidateListClosed)?;
        state.next = generation;
        state.current = None;
        Ok(())
    }

    pub(crate) fn revoke_authority(&self, authority: &DebugWorkspaceAuthority) {
        self.leases.revoke_authority(authority);
    }

    #[cfg(test)]
    pub(super) fn publish(
        &self,
        terminal_observation: TerminalAuthorityObservation,
        exact_target_metadata: &[u8],
    ) -> Result<NodeAttachCandidatePickerItem, NodeAttachCandidatePublicationFailure> {
        let issue = terminal_observation
            .observe_endpoint(exact_target_metadata)
            .map_err(NodeAttachCandidatePublicationFailure::EndpointObservation)?;
        let lease_id = self
            .leases
            .issue(issue.authority, issue.payload)
            .map_err(NodeAttachCandidatePublicationFailure::LeaseIssue)?;
        Ok(NodeAttachCandidatePickerItem {
            lease_id: lease_id.as_str().to_owned(),
            label: issue.label,
            detail: issue.detail,
            port: issue.port,
        })
    }

    #[cfg(target_os = "macos")]
    pub(super) fn publish_from_held_http(
        &self,
        terminal_observation: TerminalAuthorityObservation,
    ) -> Result<NodeAttachCandidatePickerItem, NodeAttachCandidatePublicationFailure> {
        let issue = terminal_observation
            .fetch_and_observe_endpoint()
            .map_err(NodeAttachCandidatePublicationFailure::EndpointObservation)?;
        let lease_id = self
            .leases
            .issue(issue.authority, issue.payload)
            .map_err(NodeAttachCandidatePublicationFailure::LeaseIssue)?;
        Ok(NodeAttachCandidatePickerItem {
            lease_id: lease_id.as_str().to_owned(),
            label: issue.label,
            detail: issue.detail,
            port: issue.port,
        })
    }

    fn abort_listing(&self, generation: u64) {
        let Ok(mut state) = self.listing_generation.lock() else {
            return;
        };
        if state.current == Some(generation) {
            let _ = self.leases.revoke_all();
            state.current = None;
        }
    }

    fn issue_for_listing(
        &self,
        generation: u64,
        issue: attach_candidates::EndpointObservedNodeAttachCandidateIssue,
    ) -> Result<NodeAttachCandidatePickerItem, NodeAttachCandidatePublicationFailure> {
        let state = self.listing_generation.lock().map_err(|_| {
            NodeAttachCandidatePublicationFailure::LeaseIssue(
                NodeAttachCandidateLeaseIssueError::CapacityClosed,
            )
        })?;
        if state.current != Some(generation) {
            return Err(NodeAttachCandidatePublicationFailure::LeaseIssue(
                NodeAttachCandidateLeaseIssueError::CapacityClosed,
            ));
        }
        let lease_id = self
            .leases
            .issue(issue.authority, issue.payload)
            .map_err(NodeAttachCandidatePublicationFailure::LeaseIssue)?;
        Ok(NodeAttachCandidatePickerItem {
            lease_id: lease_id.as_str().to_owned(),
            label: issue.label,
            detail: issue.detail,
            port: issue.port,
        })
    }

    /// Atomically takes the capability. A foreign-authority attempt, expiry,
    /// malformed ID, unknown ID, or replay all close identically and never
    /// reveal whether a backend payload existed.
    #[cfg(test)]
    fn consume(
        &self,
        authority: &DebugWorkspaceAuthority,
        lease_id: &str,
    ) -> Result<EndpointObservedNodeAttachCandidate, NodeAttachCandidateLeaseClosed> {
        self.leases.consume(authority, lease_id)
    }

    /// Atomically burns the lease before any fallible revalidation. The caller
    /// obtains metadata through a fresh, bounded and kernel-proven held HTTP
    /// connection. That response socket is never reused as the later
    /// WebSocket; the strong flow independently proves its own held socket.
    #[cfg(target_os = "macos")]
    pub(super) fn consume_and_revalidate(
        &self,
        authority: &DebugWorkspaceAuthority,
        lease_id: &str,
        terminals: &crate::terminal_session::TerminalSupervisor,
    ) -> Result<KernelHeldNodeAttachTarget, NodeAttachCandidateConsumeClosed> {
        self.consume_into_target_with(authority, lease_id, |payload| {
            let revalidated = payload
                .consume_and_revalidate(terminals)
                .map_err(|_| NodeAttachCandidateConsumeClosed)?;
            let (request, web_socket_endpoint) = revalidated.into_parts();
            Ok(KernelHeldNodeAttachTarget {
                web_socket_endpoint,
                request: KernelHeldNodeAttachRequest(request),
            })
        })
    }

    #[cfg(target_os = "macos")]
    fn consume_into_target_with(
        &self,
        authority: &DebugWorkspaceAuthority,
        lease_id: &str,
        revalidate: impl FnOnce(
            EndpointObservedNodeAttachCandidate,
        )
            -> Result<KernelHeldNodeAttachTarget, NodeAttachCandidateConsumeClosed>,
    ) -> Result<KernelHeldNodeAttachTarget, NodeAttachCandidateConsumeClosed> {
        let payload = self
            .leases
            .consume(authority, lease_id)
            .map_err(|_| NodeAttachCandidateConsumeClosed)?;
        revalidate(payload)
    }

    #[cfg(test)]
    fn consume_with_forced_revalidation_failure_for_test(
        &self,
        authority: &DebugWorkspaceAuthority,
        lease_id: &str,
    ) -> Result<(), NodeAttachCandidateConsumeClosed> {
        let _payload = self
            .leases
            .consume(authority, lease_id)
            .map_err(|_| NodeAttachCandidateConsumeClosed)?;
        Err(NodeAttachCandidateConsumeClosed)
    }
}

impl NodeAttachCandidateListingTransaction {
    #[cfg(target_os = "macos")]
    pub(crate) fn list_from_workspace(
        &self,
        retained_workspace: Arc<crate::debug_session_registry::RetainedDebugWorkspaceRoot>,
        terminals: &crate::terminal_session::TerminalSupervisor,
        mut authority_current: impl FnMut() -> Result<(), NodeAttachCandidateListClosed>,
    ) -> Result<NodeAttachCandidateList, NodeAttachCandidateListClosed> {
        authority_current()?;
        let observations = collect_fresh_terminal_observations(retained_workspace, terminals)
            .map_err(|_| NodeAttachCandidateListClosed)?;
        authority_current()?;

        let truncated = observations.len() > MAX_NODE_ATTACH_CANDIDATE_LEASES;
        let mut candidates =
            Vec::with_capacity(observations.len().min(MAX_NODE_ATTACH_CANDIDATE_LEASES));
        for observation in observations
            .into_iter()
            .take(MAX_NODE_ATTACH_CANDIDATE_LEASES)
        {
            authority_current()?;
            let issue = match observation.fetch_and_observe_endpoint() {
                Ok(issue) => issue,
                Err(
                    EndpointObservationFailure::WorkspaceIdentityChanged
                    | EndpointObservationFailure::PlatformUnavailable,
                ) => return Err(NodeAttachCandidateListClosed),
                Err(_) => continue,
            };
            authority_current()?;
            let candidate = self
                .registry
                .issue_for_listing(self.generation, issue)
                .map_err(|_| NodeAttachCandidateListClosed)?;
            candidates.push(candidate);
        }
        authority_current()?;
        Ok(NodeAttachCandidateList {
            candidates,
            truncated,
        })
    }

    pub(crate) fn commit(mut self) -> Result<(), NodeAttachCandidateListClosed> {
        let state = self
            .registry
            .listing_generation
            .lock()
            .map_err(|_| NodeAttachCandidateListClosed)?;
        if state.current != Some(self.generation) {
            return Err(NodeAttachCandidateListClosed);
        }
        self.preserve_leases = true;
        Ok(())
    }
}

impl Drop for NodeAttachCandidateListingTransaction {
    fn drop(&mut self) {
        if !self.preserve_leases {
            self.registry.abort_listing(self.generation);
        }
    }
}

fn listing_from_observations<T>(
    mut observations: Vec<T>,
    mut publish: impl FnMut(
        T,
    ) -> Result<
        NodeAttachCandidatePickerItem,
        NodeAttachCandidatePublicationFailure,
    >,
) -> Result<NodeAttachCandidateList, NodeAttachCandidateListClosed> {
    let truncated = observations.len() > MAX_NODE_ATTACH_CANDIDATE_LEASES;
    observations.truncate(MAX_NODE_ATTACH_CANDIDATE_LEASES);
    let mut candidates = Vec::with_capacity(observations.len());
    for observation in observations {
        match publish(observation) {
            Ok(candidate) => candidates.push(candidate),
            Err(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::WorkspaceIdentityChanged
                | EndpointObservationFailure::PlatformUnavailable,
            ))
            | Err(NodeAttachCandidatePublicationFailure::LeaseIssue(_)) => {
                return Err(NodeAttachCandidateListClosed);
            }
            // Endpoint disappearance, malformed metadata and unsupported
            // transports are isolated per-process churn.
            Err(NodeAttachCandidatePublicationFailure::EndpointObservation(_)) => {}
        }
    }
    Ok(NodeAttachCandidateList {
        candidates,
        truncated,
    })
}

impl Default for NodeAttachCandidatePublicationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
use std::net::TcpStream;

#[cfg(target_os = "macos")]
pub(super) struct KernelHeldNodeAttachRequest(attach_candidates::CandidateKernelHeldAttachRequest);

/// Final one-shot authority for opening one exact, freshly observed inspector
/// WebSocket. Neither the URL nor the process/socket identity can be projected
/// from this value; the only production transition consumes the whole target.
#[cfg(target_os = "macos")]
pub(in crate::debug_cdp) struct KernelHeldNodeAttachTarget {
    web_socket_endpoint: Box<str>,
    request: KernelHeldNodeAttachRequest,
}

#[cfg(target_os = "macos")]
impl KernelHeldNodeAttachTarget {
    pub(in crate::debug_cdp) fn connect(
        self,
        emitter: DebugEventEmitter,
        options: NodeCdpHeldExternalConnectOptions,
    ) -> Result<HeldExternalNodeCdpAttach, String> {
        NodeCdpAdapter::connect_kernel_bound_held_external(
            &self.web_socket_endpoint,
            emitter,
            self.request,
            options,
        )
    }
}

#[cfg(target_os = "macos")]
pub(super) struct KernelBoundNodeAttachConnection(
    attach_candidates::CandidateKernelBoundHeldConnection,
);

#[cfg(target_os = "macos")]
pub(super) struct SnapshotRevalidatedKernelBoundNodeAttachConnection(
    attach_candidates::CandidateSnapshotRevalidatedKernelBoundConnection,
);

#[cfg(target_os = "macos")]
impl KernelHeldNodeAttachRequest {
    fn from_revalidated(
        candidate: attach_candidates::RevalidatedNodeInspectorCandidate,
    ) -> Result<Self, &'static str> {
        candidate
            .into_kernel_held_attach_request()
            .map(Self)
            .map_err(|_| "Node attach endpoint is not supported.")
    }

    pub(super) fn bind(
        self,
        held_socket: &TcpStream,
        connected_port: u16,
    ) -> Result<KernelBoundNodeAttachConnection, &'static str> {
        self.0
            .bind(held_socket, connected_port)
            .map(KernelBoundNodeAttachConnection)
            .map_err(|_| "Node inspector process identity changed while attaching.")
    }
}

#[cfg(target_os = "macos")]
impl KernelBoundNodeAttachConnection {
    pub(super) fn expected_process_id(&self) -> u32 {
        self.0.expected_process_id()
    }

    pub(super) fn revalidate_process_snapshot(
        self,
    ) -> Result<SnapshotRevalidatedKernelBoundNodeAttachConnection, &'static str> {
        self.0
            .revalidate_process_snapshot()
            .map(SnapshotRevalidatedKernelBoundNodeAttachConnection)
            .map_err(|_| "Node inspector process identity changed while attaching.")
    }

    #[cfg(test)]
    pub(super) fn revalidate_process_snapshot_with_drift_for_test(
        self,
    ) -> Result<SnapshotRevalidatedKernelBoundNodeAttachConnection, &'static str> {
        self.0
            .revalidate_process_snapshot_with_drift_for_test()
            .map(SnapshotRevalidatedKernelBoundNodeAttachConnection)
            .map_err(|_| "Node inspector process identity changed while attaching.")
    }
}

#[cfg(all(test, target_os = "macos"))]
pub(super) fn kernel_held_request_for_current_process(port: u16) -> KernelHeldNodeAttachRequest {
    KernelHeldNodeAttachRequest(
        attach_candidates::kernel_held_attach_request_for_current_process(port),
    )
}

#[cfg(all(test, target_os = "macos"))]
pub(super) fn kernel_held_target_for_current_process(
    web_socket_endpoint: String,
) -> KernelHeldNodeAttachTarget {
    let port = crate::debug_cdp::startup_policy::loopback_web_socket_port(&web_socket_endpoint)
        .expect("test target requires an exact loopback endpoint");
    KernelHeldNodeAttachTarget {
        web_socket_endpoint: web_socket_endpoint.into_boxed_str(),
        request: kernel_held_request_for_current_process(port),
    }
}

#[cfg(test)]
mod publication_tests {
    use super::*;
    use attach_candidates::{
        terminal_authority_observation_for_test, LoopbackHost, NodeAttachEndpointFailure,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    const TARGET_ID: &str = "12345678-1234-1234-1234-123456789abc";

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "editor-node-attach-publication-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create workspace");
            fs::write(path.join("server.js"), b"setInterval(() => {}, 1000);")
                .expect("write source");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn metadata(&self, endpoint: &str) -> Vec<u8> {
            format!(
                r#"[{{"id":"{TARGET_ID}","type":"node","url":"file://{}","webSocketDebuggerUrl":"{endpoint}"}}]"#,
                self.0.join("server.js").display()
            )
            .into_bytes()
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_file(self.0.join("server.js"));
            let _ = fs::remove_dir(&self.0);
        }
    }

    fn authority(name: &str, workspace: &TestWorkspace) -> DebugWorkspaceAuthority {
        DebugWorkspaceAuthority::RetainedWorkspace {
            workspace_id: name.to_owned(),
            canonical_root: workspace.path().to_string_lossy().into_owned(),
        }
    }

    fn observation(
        workspace: &TestWorkspace,
        authority: DebugWorkspaceAuthority,
        host: LoopbackHost,
        port: u16,
    ) -> TerminalAuthorityObservation {
        terminal_authority_observation_for_test(
            workspace.path().to_path_buf(),
            authority,
            host,
            port,
        )
    }

    fn prepared_issue(
        workspace: &TestWorkspace,
        authority: DebugWorkspaceAuthority,
        port: u16,
    ) -> attach_candidates::EndpointObservedNodeAttachCandidateIssue {
        observation(workspace, authority, LoopbackHost::Ipv4, port)
            .observe_endpoint(&workspace.metadata(&format!("ws://127.0.0.1:{port}/{TARGET_ID}")))
            .expect("prepare endpoint-observed candidate")
    }

    fn picker(index: usize) -> NodeAttachCandidatePickerItem {
        NodeAttachCandidatePickerItem {
            lease_id: format!("{index:032x}"),
            label: "Node.js inspector".to_string(),
            detail: "Integrated terminal · 127.0.0.1:9229".to_string(),
            port: 9_229,
        }
    }

    #[test]
    fn listing_keeps_stable_peers_when_one_endpoint_churns() {
        let listing = listing_from_observations(vec![0, 1, 2], |index| match index {
            0 => Err(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::TransportUnavailable,
            )),
            1 => Ok(picker(1)),
            _ => Err(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::EndpointMetadata(
                    NodeAttachEndpointFailure::InvalidTargetList,
                ),
            )),
        })
        .expect("per-process churn is skippable");

        assert_eq!(listing.candidates.len(), 1);
        assert_eq!(listing.candidates[0].lease_id, format!("{:032x}", 1));
        assert!(!listing.truncated);
    }

    #[test]
    fn listing_fails_closed_for_systemic_platform_failure() {
        assert!(listing_from_observations(vec![()], |_| {
            Err(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::PlatformUnavailable,
            ))
        })
        .is_err());
    }

    #[test]
    fn listing_projection_is_capped_at_128_and_marks_truncation() {
        let listing =
            listing_from_observations((0..=MAX_NODE_ATTACH_CANDIDATE_LEASES).collect(), |index| {
                Ok(picker(index))
            })
            .expect("bounded listing");

        assert_eq!(listing.candidates.len(), MAX_NODE_ATTACH_CANDIDATE_LEASES);
        assert!(listing.truncated);
    }

    #[test]
    fn foreign_authority_burns_capability_and_replay_stays_closed() {
        let workspace = TestWorkspace::new();
        let owner = authority("owner", &workspace);
        let foreign = authority("foreign", &workspace);
        let registry = NodeAttachCandidatePublicationRegistry::new();
        let item = registry
            .publish(
                observation(&workspace, owner.clone(), LoopbackHost::Ipv4, 9_229),
                &workspace.metadata(&format!("ws://127.0.0.1:9229/{TARGET_ID}")),
            )
            .expect("publish");

        assert!(registry.consume(&foreign, &item.lease_id).is_err());
        assert!(registry.consume(&owner, &item.lease_id).is_err());

        let replay_item = registry
            .publish(
                observation(&workspace, owner.clone(), LoopbackHost::Ipv4, 9_230),
                &workspace.metadata(&format!("ws://127.0.0.1:9230/{TARGET_ID}")),
            )
            .expect("publish replay candidate");
        assert!(registry.consume(&owner, &replay_item.lease_id).is_ok());
        assert!(registry.consume(&owner, &replay_item.lease_id).is_err());
    }

    #[test]
    fn revalidation_failure_burns_the_one_shot_lease() {
        let workspace = TestWorkspace::new();
        let owner = authority("owner", &workspace);
        let registry = NodeAttachCandidatePublicationRegistry::new();
        let item = registry
            .publish(
                observation(&workspace, owner.clone(), LoopbackHost::Ipv4, 9_229),
                &workspace.metadata(&format!("ws://127.0.0.1:9229/{TARGET_ID}")),
            )
            .expect("publish");

        assert!(registry
            .consume_with_forced_revalidation_failure_for_test(&owner, &item.lease_id)
            .is_err());
        assert!(registry.consume(&owner, &item.lease_id).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn successful_target_transition_is_atomic_and_exactly_once() {
        let workspace = TestWorkspace::new();
        let owner = authority("owner", &workspace);
        let registry = NodeAttachCandidatePublicationRegistry::new();
        let endpoint = format!("ws://127.0.0.1:9229/{TARGET_ID}");
        let item = registry
            .publish(
                observation(&workspace, owner.clone(), LoopbackHost::Ipv4, 9_229),
                &workspace.metadata(&endpoint),
            )
            .expect("publish");

        let target = registry
            .consume_into_target_with(&owner, &item.lease_id, |_payload| {
                Ok(kernel_held_target_for_current_process(endpoint))
            })
            .expect("one target transition");
        drop(target);

        assert!(registry
            .consume_into_target_with(&owner, &item.lease_id, |_| {
                unreachable!("a replay must not reach target construction")
            })
            .is_err());
    }

    #[test]
    fn endpoint_mismatch_is_not_publishable() {
        let workspace = TestWorkspace::new();
        let result = NodeAttachCandidatePublicationRegistry::new().publish(
            observation(
                &workspace,
                authority("owner", &workspace),
                LoopbackHost::Ipv4,
                9_229,
            ),
            &workspace.metadata(&format!("ws://127.0.0.1:9230/{TARGET_ID}")),
        );
        assert_eq!(
            result.err(),
            Some(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::EndpointMetadata(
                    NodeAttachEndpointFailure::EndpointMismatch
                )
            ))
        );
    }

    #[test]
    fn picker_projection_is_redacted() {
        let workspace = TestWorkspace::new();
        let registry = NodeAttachCandidatePublicationRegistry::new();
        let item = registry
            .publish(
                observation(
                    &workspace,
                    authority("secret-workspace-session", &workspace),
                    LoopbackHost::Ipv4,
                    9_229,
                ),
                &workspace.metadata(&format!("ws://127.0.0.1:9229/{TARGET_ID}")),
            )
            .expect("publish");
        let wire_projection = format!(
            "{}|{}|{}|{}",
            item.lease_id, item.label, item.detail, item.port
        );

        assert_eq!(item.label, "Node.js inspector");
        assert_eq!(item.detail, "Integrated terminal · 127.0.0.1:9229");
        assert!(!wire_projection.contains(TARGET_ID));
        assert!(!wire_projection.contains("server.js"));
        assert!(!wire_projection.contains("secret-workspace-session"));
        assert!(!wire_projection.contains("/verified/bin/node"));
        assert!(!wire_projection.contains("--inspect"));
        assert!(!wire_projection.contains("ws://"));
    }

    #[test]
    fn ipv6_is_explicitly_not_publishable_while_transport_is_ipv4_only() {
        let workspace = TestWorkspace::new();
        let result = NodeAttachCandidatePublicationRegistry::new().publish(
            observation(
                &workspace,
                authority("owner", &workspace),
                LoopbackHost::Ipv6,
                9_229,
            ),
            &workspace.metadata(&format!("ws://[::1]:9229/{TARGET_ID}")),
        );
        assert_eq!(
            result.err(),
            Some(NodeAttachCandidatePublicationFailure::EndpointObservation(
                EndpointObservationFailure::UnsupportedTransport
            ))
        );
    }

    #[test]
    fn publication_is_bounded_to_128_live_leases() {
        let workspace = TestWorkspace::new();
        let owner = authority("owner", &workspace);
        let registry = NodeAttachCandidatePublicationRegistry::new();
        let metadata = workspace.metadata(&format!("ws://127.0.0.1:9229/{TARGET_ID}"));
        for _ in 0..MAX_NODE_ATTACH_CANDIDATE_LEASES {
            registry
                .publish(
                    observation(&workspace, owner.clone(), LoopbackHost::Ipv4, 9_229),
                    &metadata,
                )
                .expect("within capacity");
        }
        let overflow = registry.publish(
            observation(&workspace, owner, LoopbackHost::Ipv4, 9_229),
            &metadata,
        );
        assert_eq!(
            overflow.err(),
            Some(NodeAttachCandidatePublicationFailure::LeaseIssue(
                NodeAttachCandidateLeaseIssueError::CapacityClosed
            ))
        );
        assert_eq!(NODE_ATTACH_CANDIDATE_LEASE_TTL, Duration::from_secs(30));
    }

    #[test]
    fn overlapping_listing_allows_only_latest_generation_to_issue() {
        let workspace = TestWorkspace::new();
        let registry = Arc::new(NodeAttachCandidatePublicationRegistry::new());
        let first = registry.begin_listing().expect("first listing");
        let blocked_first_issue = prepared_issue(&workspace, authority("first", &workspace), 9_229);
        let second = registry.begin_listing().expect("replacement listing");

        assert!(registry
            .issue_for_listing(first.generation, blocked_first_issue)
            .is_err());
        let second_item = registry
            .issue_for_listing(
                second.generation,
                prepared_issue(&workspace, authority("second", &workspace), 9_230),
            )
            .expect("latest listing issues");
        second.commit().expect("commit latest listing");
        drop(first);

        assert_eq!(registry.leases.live_lease_count_for_test(), 1);
        assert!(registry
            .consume(&authority("second", &workspace), &second_item.lease_id)
            .is_ok());
    }

    #[test]
    fn refresh_replaces_live_leases_instead_of_accumulating() {
        let workspace = TestWorkspace::new();
        let owner = authority("owner", &workspace);
        let registry = Arc::new(NodeAttachCandidatePublicationRegistry::new());
        let mut previous = None;

        for port in 9_229..9_239 {
            let listing = registry.begin_listing().expect("begin refresh");
            let item = registry
                .issue_for_listing(
                    listing.generation,
                    prepared_issue(&workspace, owner.clone(), port),
                )
                .expect("issue refresh");
            listing.commit().expect("commit refresh");
            if let Some(previous) = previous.replace(item.lease_id) {
                assert!(registry.consume(&owner, &previous).is_err());
            }
            assert_eq!(registry.leases.live_lease_count_for_test(), 1);
        }
    }

    #[test]
    fn foreign_workspace_listing_cannot_be_starved_by_previous_global_capacity() {
        let workspace = TestWorkspace::new();
        let first_owner = authority("first", &workspace);
        let foreign_owner = authority("foreign", &workspace);
        let registry = Arc::new(NodeAttachCandidatePublicationRegistry::new());
        let first = registry.begin_listing().expect("first listing");
        for _ in 0..MAX_NODE_ATTACH_CANDIDATE_LEASES {
            registry
                .issue_for_listing(
                    first.generation,
                    prepared_issue(&workspace, first_owner.clone(), 9_229),
                )
                .expect("fill first listing");
        }
        first.commit().expect("commit first listing");
        assert_eq!(
            registry.leases.live_lease_count_for_test(),
            MAX_NODE_ATTACH_CANDIDATE_LEASES
        );

        let foreign = registry.begin_listing().expect("foreign replacement");
        let item = registry
            .issue_for_listing(
                foreign.generation,
                prepared_issue(&workspace, foreign_owner.clone(), 9_230),
            )
            .expect("foreign listing issues after replacement");
        foreign.commit().expect("commit foreign listing");
        assert_eq!(registry.leases.live_lease_count_for_test(), 1);
        assert!(registry.consume(&foreign_owner, &item.lease_id).is_ok());
    }
}
