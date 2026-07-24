use super::endpoint::{
    validate_node_attach_endpoint, NodeAttachEndpointFailure, NodeAttachEndpointFamily,
    NodeAttachEndpointObservation,
};
use super::{
    parse_verified_node_inspector, DiscoveredNodeInspectorCandidate, LoopbackHost,
    VerifiedProcessSnapshot,
};
#[cfg(target_os = "macos")]
use super::{
    CandidateEndpointMetadataFailure, CandidateKernelHeldAttachFailure,
    CandidateKernelHeldAttachRequest,
};
use crate::debug_session_registry::{DebugWorkspaceAuthority, RetainedDebugWorkspaceRoot};
use crate::terminal_session::{
    TerminalOwnedProcessGroup, TerminalOwnedProcessGroupSource, TerminalSupervisor,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MAX_OWNED_PROCESS_GROUPS: usize = 64;
const MAX_VERIFIED_PROCESS_SNAPSHOTS: usize = 512;
const MAX_UNVERIFIED_CANDIDATES: usize = 128;
const MAX_DISPLAY_LABEL_BYTES: usize = 32;
const MAX_DISPLAY_DETAIL_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct ProcessGeneration {
    process_group_id: u32,
    process_id: u32,
    start_microseconds: u64,
    start_seconds: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp::node_attach_orchestrator) enum AttachCandidateInventoryFailure {
    AmbiguousTerminalOwnership,
    CapacityExceeded,
    PlatformInventoryUnavailable,
    TerminalAuthorityChanged,
    TerminalOwnershipUnavailable,
    StableTerminalWorkspaceIdentityUnavailable,
    WorkspaceIdentityChanged,
    WorkspaceMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RedactedAttachCandidateDisplay {
    label: String,
    detail: String,
}

/// A parser discovery is deliberately not a publishable attach candidate.
/// Held-socket PID ownership plus inspector endpoint UUID/source validation
/// must consume this type and produce a later validated typestate before any
/// lease, command, IPC response or picker projection can be issued.
pub(super) struct UnverifiedNodeAttachCandidate {
    authority: TerminalCandidateAuthority,
    discovered: DiscoveredNodeInspectorCandidate,
    display: RedactedAttachCandidateDisplay,
    retained_workspace: Option<Arc<RetainedDebugWorkspaceRoot>>,
    workspace_authority: DebugWorkspaceAuthority,
    workspace_root: PathBuf,
}

#[derive(Clone, Copy)]
struct TerminalCandidateAuthority {
    process_group_id: u32,
    session_id: u64,
    source: TerminalOwnedProcessGroupSource,
}

/// A one-shot observation of terminal authority at one instant, not a durable
/// proof or lease. A future commit/consume path must perform a fresh final
/// recheck and consume this non-Clone value immediately.
pub(in crate::debug_cdp) struct TerminalAuthorityObservation {
    candidate: UnverifiedNodeAttachCandidate,
}

/// Backend-only typestate combining the one-shot terminal observation with
/// the exact inspector metadata bytes accepted for that candidate. It is
/// intentionally neither Clone nor serializable.
pub(in crate::debug_cdp::node_attach_orchestrator) struct EndpointObservedNodeAttachCandidate {
    _terminal: TerminalAuthorityObservation,
    _endpoint: NodeAttachEndpointObservation,
}

pub(in crate::debug_cdp::node_attach_orchestrator) struct EndpointObservedNodeAttachCandidateIssue {
    pub(in crate::debug_cdp::node_attach_orchestrator) authority: DebugWorkspaceAuthority,
    pub(in crate::debug_cdp::node_attach_orchestrator) payload: EndpointObservedNodeAttachCandidate,
    pub(in crate::debug_cdp::node_attach_orchestrator) label: String,
    pub(in crate::debug_cdp::node_attach_orchestrator) detail: String,
    pub(in crate::debug_cdp::node_attach_orchestrator) port: u16,
}

#[cfg(target_os = "macos")]
pub(in crate::debug_cdp::node_attach_orchestrator) struct StrongRevalidatedNodeAttachCandidate {
    request: CandidateKernelHeldAttachRequest,
    web_socket_endpoint: Box<str>,
}

#[cfg(target_os = "macos")]
impl StrongRevalidatedNodeAttachCandidate {
    pub(in crate::debug_cdp::node_attach_orchestrator) fn into_parts(
        self,
    ) -> (CandidateKernelHeldAttachRequest, Box<str>) {
        (self.request, self.web_socket_endpoint)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum EndpointObservationFailure {
    EndpointMetadata(NodeAttachEndpointFailure),
    PlatformUnavailable,
    TransportUnavailable,
    UnsupportedTransport,
    WorkspaceIdentityChanged,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp::node_attach_orchestrator) enum StrongCandidateRevalidationFailure {
    EndpointChanged,
    ProcessChanged,
    TerminalChanged,
    UnsupportedTransport,
    WorkspaceIdentityChanged,
}

pub(super) struct UnverifiedNodeAttachInventory {
    candidates: Vec<UnverifiedNodeAttachCandidate>,
    retained_workspace: Option<Arc<RetainedDebugWorkspaceRoot>>,
    workspace_authority: DebugWorkspaceAuthority,
    workspace_root: PathBuf,
}

struct TerminalReauthorizationSnapshot {
    groups: Vec<TerminalOwnedProcessGroup>,
}

trait TerminalOwnershipProvider {
    fn owned_process_groups(
        &self,
        workspace_root: &Path,
    ) -> Result<Vec<TerminalOwnedProcessGroup>, AttachCandidateInventoryFailure>;
}

trait ProcessSnapshotProvider {
    fn verified_process_snapshots(
        &self,
        process_group_id: u32,
    ) -> Result<Vec<VerifiedProcessSnapshot>, AttachCandidateInventoryFailure>;
}

#[cfg(target_os = "macos")]
trait ProcessRevalidationProvider {
    fn verified_process_snapshot(
        &self,
        process_id: u32,
        process_group_id: u32,
    ) -> Result<VerifiedProcessSnapshot, StrongCandidateRevalidationFailure>;
}

trait TerminalReauthorizationProvider {
    fn terminal_reauthorization_snapshot(
        &self,
        workspace_root: &Path,
    ) -> Result<TerminalReauthorizationSnapshot, AttachCandidateInventoryFailure>;
}

impl TerminalOwnershipProvider for TerminalSupervisor {
    fn owned_process_groups(
        &self,
        workspace_root: &Path,
    ) -> Result<Vec<TerminalOwnedProcessGroup>, AttachCandidateInventoryFailure> {
        TerminalSupervisor::owned_process_groups(self, workspace_root)
            .map_err(|_| AttachCandidateInventoryFailure::TerminalOwnershipUnavailable)
    }
}

impl TerminalReauthorizationProvider for TerminalSupervisor {
    fn terminal_reauthorization_snapshot(
        &self,
        workspace_root: &Path,
    ) -> Result<TerminalReauthorizationSnapshot, AttachCandidateInventoryFailure> {
        Ok(TerminalReauthorizationSnapshot {
            groups: TerminalSupervisor::owned_process_groups(self, workspace_root)
                .map_err(|_| AttachCandidateInventoryFailure::TerminalOwnershipUnavailable)?,
        })
    }
}

#[cfg(target_os = "macos")]
struct MacProcessSnapshotProvider;

#[cfg(target_os = "macos")]
impl ProcessSnapshotProvider for MacProcessSnapshotProvider {
    fn verified_process_snapshots(
        &self,
        process_group_id: u32,
    ) -> Result<Vec<VerifiedProcessSnapshot>, AttachCandidateInventoryFailure> {
        super::macos::verified_process_snapshots(process_group_id)
            .map_err(|_| AttachCandidateInventoryFailure::PlatformInventoryUnavailable)
    }
}

#[cfg(target_os = "macos")]
impl ProcessRevalidationProvider for MacProcessSnapshotProvider {
    fn verified_process_snapshot(
        &self,
        process_id: u32,
        process_group_id: u32,
    ) -> Result<VerifiedProcessSnapshot, StrongCandidateRevalidationFailure> {
        let process_id = i32::try_from(process_id)
            .ok()
            .filter(|process_id| *process_id > 0)
            .ok_or(StrongCandidateRevalidationFailure::ProcessChanged)?;
        super::macos::verified_process_snapshot(process_id, process_group_id)
            .map_err(|_| StrongCandidateRevalidationFailure::ProcessChanged)
    }
}

/// Takes the terminal-owned PGID snapshot first. The terminal registry lock is
/// released by `owned_process_groups` before any libproc/sysctl work begins.
#[cfg(target_os = "macos")]
pub(super) fn collect_discovered_candidates(
    retained_workspace: Arc<RetainedDebugWorkspaceRoot>,
    terminals: &TerminalSupervisor,
) -> Result<UnverifiedNodeAttachInventory, AttachCandidateInventoryFailure> {
    let workspace_root = retained_workspace
        .live_path()
        .map_err(|_| AttachCandidateInventoryFailure::WorkspaceIdentityChanged)?;
    let workspace_authority = retained_workspace.authority.clone();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &workspace_authority
    else {
        return Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged);
    };
    if Path::new(canonical_root) != workspace_root {
        return Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged);
    }
    collect_discovered_candidates_with_binding(
        &workspace_root,
        workspace_authority,
        Some(retained_workspace),
        terminals,
        &MacProcessSnapshotProvider,
    )
}

#[cfg(target_os = "macos")]
pub(in crate::debug_cdp::node_attach_orchestrator) fn collect_fresh_terminal_observations(
    retained_workspace: Arc<RetainedDebugWorkspaceRoot>,
    terminals: &TerminalSupervisor,
) -> Result<Vec<TerminalAuthorityObservation>, AttachCandidateInventoryFailure> {
    let inventory = collect_discovered_candidates(retained_workspace, terminals)?;
    let mut observations = Vec::with_capacity(inventory.candidates.len());
    for candidate in inventory.candidates {
        match observe_terminal_authority(candidate, &inventory.workspace_root, terminals) {
            Ok(observation) => observations.push(observation),
            // A process/session disappearing between discovery and publication
            // is ordinary per-candidate churn and must not hide stable peers.
            Err(AttachCandidateInventoryFailure::TerminalAuthorityChanged) => {}
            Err(failure) => return Err(failure),
        }
    }
    Ok(observations)
}

#[cfg(test)]
fn collect_discovered_candidates_with(
    workspace_root: &Path,
    ownership: &dyn TerminalOwnershipProvider,
    processes: &dyn ProcessSnapshotProvider,
) -> Result<UnverifiedNodeAttachInventory, AttachCandidateInventoryFailure> {
    collect_discovered_candidates_with_binding(
        workspace_root,
        DebugWorkspaceAuthority::RetainedWorkspace {
            workspace_id: format!("test:{}", workspace_root.display()),
            canonical_root: workspace_root.to_string_lossy().into_owned(),
        },
        None,
        ownership,
        processes,
    )
}

fn collect_discovered_candidates_with_binding(
    workspace_root: &Path,
    workspace_authority: DebugWorkspaceAuthority,
    retained_workspace: Option<Arc<RetainedDebugWorkspaceRoot>>,
    ownership: &dyn TerminalOwnershipProvider,
    processes: &dyn ProcessSnapshotProvider,
) -> Result<UnverifiedNodeAttachInventory, AttachCandidateInventoryFailure> {
    let owned_groups = normalize_owned_groups(ownership.owned_process_groups(workspace_root)?)?;
    let mut snapshots_by_generation =
        BTreeMap::<ProcessGeneration, (TerminalCandidateAuthority, VerifiedProcessSnapshot)>::new();
    let mut snapshot_count = 0usize;

    for authority in owned_groups {
        let snapshots = processes.verified_process_snapshots(authority.process_group_id)?;
        snapshot_count = snapshot_count
            .checked_add(snapshots.len())
            .ok_or(AttachCandidateInventoryFailure::CapacityExceeded)?;
        if snapshot_count > MAX_VERIFIED_PROCESS_SNAPSHOTS {
            return Err(AttachCandidateInventoryFailure::CapacityExceeded);
        }
        for snapshot in snapshots {
            if snapshot.process_group_id != authority.process_group_id {
                return Err(AttachCandidateInventoryFailure::PlatformInventoryUnavailable);
            }
            let generation = process_generation(&snapshot);
            if let Some((_, existing)) = snapshots_by_generation.get(&generation) {
                if !existing.same_generation(&snapshot) {
                    return Err(AttachCandidateInventoryFailure::PlatformInventoryUnavailable);
                }
            } else {
                snapshots_by_generation.insert(generation, (authority, snapshot));
            }
        }
    }

    let mut candidates = Vec::new();
    for (_, (authority, snapshot)) in snapshots_by_generation {
        let discovered = match parse_verified_node_inspector(snapshot) {
            Ok(Some(discovered)) => discovered,
            Ok(None) | Err(_) => continue,
        };
        if candidates.len() == MAX_UNVERIFIED_CANDIDATES {
            return Err(AttachCandidateInventoryFailure::CapacityExceeded);
        }
        candidates.push(UnverifiedNodeAttachCandidate {
            display: redacted_display(&discovered),
            authority,
            discovered,
            retained_workspace: retained_workspace.clone(),
            workspace_authority: workspace_authority.clone(),
            workspace_root: workspace_root.to_path_buf(),
        });
    }

    Ok(UnverifiedNodeAttachInventory {
        candidates,
        retained_workspace,
        workspace_authority,
        workspace_root: workspace_root.to_path_buf(),
    })
}

/// Refreshes terminal ownership without holding the registry lock across any
/// platform process I/O. This slice performs no platform I/O itself; the
/// supervisor returns an owned snapshot before tuple validation begins.
pub(super) fn observe_terminal_authority(
    candidate: UnverifiedNodeAttachCandidate,
    exact_workspace_root: &Path,
    terminals: &TerminalSupervisor,
) -> Result<TerminalAuthorityObservation, AttachCandidateInventoryFailure> {
    observe_terminal_authority_with(candidate, exact_workspace_root, terminals)
}

fn observe_terminal_authority_with(
    candidate: UnverifiedNodeAttachCandidate,
    exact_workspace_root: &Path,
    ownership: &dyn TerminalReauthorizationProvider,
) -> Result<TerminalAuthorityObservation, AttachCandidateInventoryFailure> {
    if candidate.workspace_root != exact_workspace_root {
        return Err(AttachCandidateInventoryFailure::WorkspaceMismatch);
    }
    if let Some(retained_workspace) = &candidate.retained_workspace {
        let live_root = retained_workspace
            .live_path()
            .map_err(|_| AttachCandidateInventoryFailure::WorkspaceIdentityChanged)?;
        if live_root != candidate.workspace_root
            || retained_workspace.authority != candidate.workspace_authority
        {
            return Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged);
        }
    }

    let groups = ownership
        .terminal_reauthorization_snapshot(exact_workspace_root)?
        .groups;
    if groups.len() > MAX_OWNED_PROCESS_GROUPS {
        return Err(AttachCandidateInventoryFailure::CapacityExceeded);
    }

    let mut exact_matches = 0usize;
    let mut process_group_claims = 0usize;
    let mut exact_workspace_authority = None;
    for group in groups {
        let process_group_id = u32::try_from(group.process_group_id)
            .ok()
            .filter(|process_group_id| *process_group_id > 0)
            .ok_or(AttachCandidateInventoryFailure::TerminalOwnershipUnavailable)?;
        if process_group_id != candidate.authority.process_group_id {
            continue;
        }

        process_group_claims = process_group_claims
            .checked_add(1)
            .ok_or(AttachCandidateInventoryFailure::CapacityExceeded)?;
        if group.session_id == candidate.authority.session_id
            && group.source == candidate.authority.source
        {
            exact_matches = exact_matches
                .checked_add(1)
                .ok_or(AttachCandidateInventoryFailure::CapacityExceeded)?;
            exact_workspace_authority = Some(group.workspace_authority);
        }
    }

    match (exact_matches, process_group_claims) {
        (1, 1) => match exact_workspace_authority.flatten() {
            Some(authority) if authority == candidate.workspace_authority => {
                Ok(TerminalAuthorityObservation { candidate })
            }
            Some(_) => Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged),
            None => {
                Err(AttachCandidateInventoryFailure::StableTerminalWorkspaceIdentityUnavailable)
            }
        },
        (0, 0 | 1) => Err(AttachCandidateInventoryFailure::TerminalAuthorityChanged),
        _ => Err(AttachCandidateInventoryFailure::AmbiguousTerminalOwnership),
    }
}

impl TerminalAuthorityObservation {
    #[cfg(test)]
    pub(in crate::debug_cdp::node_attach_orchestrator) fn observe_endpoint(
        self,
        exact_target_metadata: &[u8],
    ) -> Result<EndpointObservedNodeAttachCandidateIssue, EndpointObservationFailure> {
        self.observe_endpoint_bytes(exact_target_metadata)
    }

    /// Consumes the terminal observation and binds it to the exact endpoint
    /// metadata response. Publication is currently IPv4-only because the held
    /// transport proof supports only IPv4; IPv6 must fail closed here rather
    /// than becoming a picker item that cannot complete the strong flow.
    fn observe_endpoint_bytes(
        self,
        exact_target_metadata: &[u8],
    ) -> Result<EndpointObservedNodeAttachCandidateIssue, EndpointObservationFailure> {
        let endpoint = self.candidate.discovered.endpoint;
        if endpoint.host != LoopbackHost::Ipv4 {
            return Err(EndpointObservationFailure::UnsupportedTransport);
        }

        let live_root_before = retained_candidate_live_root(&self.candidate)
            .map_err(|_| EndpointObservationFailure::WorkspaceIdentityChanged)?;
        let endpoint_observation = validate_node_attach_endpoint(
            &live_root_before,
            NodeAttachEndpointFamily::Ipv4,
            endpoint.port,
            exact_target_metadata,
        )
        .map_err(EndpointObservationFailure::EndpointMetadata)?;
        let live_root_after = retained_candidate_live_root(&self.candidate)
            .map_err(|_| EndpointObservationFailure::WorkspaceIdentityChanged)?;
        if live_root_before != live_root_after {
            return Err(EndpointObservationFailure::WorkspaceIdentityChanged);
        }
        let authority = self.candidate.workspace_authority.clone();
        let label = self.candidate.display.label.clone();
        let detail = self.candidate.display.detail.clone();

        Ok(EndpointObservedNodeAttachCandidateIssue {
            authority,
            payload: EndpointObservedNodeAttachCandidate {
                _terminal: self,
                _endpoint: endpoint_observation,
            },
            label,
            detail,
            port: endpoint.port,
        })
    }

    #[cfg(target_os = "macos")]
    pub(in crate::debug_cdp::node_attach_orchestrator) fn fetch_and_observe_endpoint(
        self,
    ) -> Result<EndpointObservedNodeAttachCandidateIssue, EndpointObservationFailure> {
        let live_root_before = retained_candidate_live_root(&self.candidate)
            .map_err(|_| EndpointObservationFailure::WorkspaceIdentityChanged)?;
        let metadata = self
            .candidate
            .discovered
            .fetch_endpoint_metadata()
            .map_err(|failure| match failure {
                CandidateEndpointMetadataFailure::UnsupportedEndpoint => {
                    EndpointObservationFailure::UnsupportedTransport
                }
                CandidateEndpointMetadataFailure::PlatformUnavailable => {
                    EndpointObservationFailure::PlatformUnavailable
                }
                _ => EndpointObservationFailure::TransportUnavailable,
            })?;
        let live_root_after = retained_candidate_live_root(&self.candidate)
            .map_err(|_| EndpointObservationFailure::WorkspaceIdentityChanged)?;
        if live_root_before != live_root_after {
            return Err(EndpointObservationFailure::WorkspaceIdentityChanged);
        }
        self.observe_endpoint_bytes(&metadata)
    }
}

fn retained_candidate_live_root(
    candidate: &UnverifiedNodeAttachCandidate,
) -> Result<PathBuf, AttachCandidateInventoryFailure> {
    retained_workspace_live_root(
        &candidate.retained_workspace,
        &candidate.workspace_authority,
        &candidate.workspace_root,
    )
}

fn retained_workspace_live_root(
    retained_workspace: &Option<Arc<RetainedDebugWorkspaceRoot>>,
    workspace_authority: &DebugWorkspaceAuthority,
    workspace_root: &Path,
) -> Result<PathBuf, AttachCandidateInventoryFailure> {
    let Some(retained_workspace) = retained_workspace else {
        #[cfg(test)]
        return Ok(workspace_root.to_path_buf());
        #[cfg(not(test))]
        return Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged);
    };
    let live_root = retained_workspace
        .live_path()
        .map_err(|_| AttachCandidateInventoryFailure::WorkspaceIdentityChanged)?;
    if live_root != workspace_root || &retained_workspace.authority != workspace_authority {
        return Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged);
    }
    Ok(live_root)
}

#[cfg(target_os = "macos")]
impl EndpointObservedNodeAttachCandidate {
    pub(in crate::debug_cdp::node_attach_orchestrator) fn consume_and_revalidate(
        self,
        terminals: &TerminalSupervisor,
    ) -> Result<StrongRevalidatedNodeAttachCandidate, StrongCandidateRevalidationFailure> {
        self.consume_and_revalidate_with_metadata_provider(
            terminals,
            &MacProcessSnapshotProvider,
            |candidate| {
                candidate
                    .fetch_endpoint_metadata()
                    .map_err(|_| StrongCandidateRevalidationFailure::EndpointChanged)
            },
        )
    }

    #[cfg(test)]
    fn consume_and_revalidate_with(
        self,
        ownership: &dyn TerminalReauthorizationProvider,
        processes: &dyn ProcessRevalidationProvider,
        fresh_target_metadata: &[u8],
    ) -> Result<StrongRevalidatedNodeAttachCandidate, StrongCandidateRevalidationFailure> {
        self.consume_and_revalidate_with_metadata_provider(ownership, processes, |_| {
            Ok(fresh_target_metadata.to_vec())
        })
    }

    fn consume_and_revalidate_with_metadata_provider(
        self,
        ownership: &dyn TerminalReauthorizationProvider,
        processes: &dyn ProcessRevalidationProvider,
        metadata_provider: impl FnOnce(
            &super::RevalidatedNodeInspectorCandidate,
        ) -> Result<Vec<u8>, StrongCandidateRevalidationFailure>,
    ) -> Result<StrongRevalidatedNodeAttachCandidate, StrongCandidateRevalidationFailure> {
        let EndpointObservedNodeAttachCandidate {
            _terminal: terminal,
            _endpoint: previous_endpoint,
        } = self;
        let live_root_before = retained_candidate_live_root(&terminal.candidate)
            .map_err(|_| StrongCandidateRevalidationFailure::WorkspaceIdentityChanged)?;
        let terminal = observe_terminal_authority_with(
            terminal.candidate,
            &live_root_before,
            ownership,
        )
        .map_err(|failure| match failure {
            AttachCandidateInventoryFailure::WorkspaceIdentityChanged
            | AttachCandidateInventoryFailure::WorkspaceMismatch
            | AttachCandidateInventoryFailure::StableTerminalWorkspaceIdentityUnavailable => {
                StrongCandidateRevalidationFailure::WorkspaceIdentityChanged
            }
            _ => StrongCandidateRevalidationFailure::TerminalChanged,
        })?;
        let UnverifiedNodeAttachCandidate {
            discovered,
            retained_workspace,
            workspace_authority,
            workspace_root,
            ..
        } = terminal.candidate;
        let fresh_snapshot = processes.verified_process_snapshot(
            discovered.snapshot.process_id,
            discovered.snapshot.process_group_id,
        )?;
        let revalidated = discovered
            .revalidate(fresh_snapshot)
            .map_err(|_| StrongCandidateRevalidationFailure::ProcessChanged)?;
        if revalidated.endpoint.host != LoopbackHost::Ipv4 {
            return Err(StrongCandidateRevalidationFailure::UnsupportedTransport);
        }

        // This short-lived HTTP socket closes after its response. Its kernel
        // proof authorizes only this metadata observation. The later strong
        // WebSocket flow opens and independently proves its own held socket.
        let fresh_target_metadata = metadata_provider(&revalidated)?;
        let fresh_endpoint = validate_node_attach_endpoint(
            &live_root_before,
            NodeAttachEndpointFamily::Ipv4,
            revalidated.endpoint.port,
            &fresh_target_metadata,
        )
        .map_err(|_| StrongCandidateRevalidationFailure::EndpointChanged)?;
        if !previous_endpoint.same_target_endpoint(&fresh_endpoint) {
            return Err(StrongCandidateRevalidationFailure::EndpointChanged);
        }
        let live_root_after = retained_workspace_live_root(
            &retained_workspace,
            &workspace_authority,
            &workspace_root,
        )
        .map_err(|_| StrongCandidateRevalidationFailure::WorkspaceIdentityChanged)?;
        if live_root_before != live_root_after {
            return Err(StrongCandidateRevalidationFailure::WorkspaceIdentityChanged);
        }

        let request =
            revalidated
                .into_kernel_held_attach_request()
                .map_err(|failure| match failure {
                    CandidateKernelHeldAttachFailure::UnsupportedEndpoint => {
                        StrongCandidateRevalidationFailure::UnsupportedTransport
                    }
                    CandidateKernelHeldAttachFailure::BindingFailed => {
                        StrongCandidateRevalidationFailure::ProcessChanged
                    }
                })?;
        Ok(StrongRevalidatedNodeAttachCandidate {
            request,
            web_socket_endpoint: fresh_endpoint.into_web_socket_endpoint(),
        })
    }
}

#[cfg(test)]
pub(crate) fn terminal_authority_observation_for_test(
    workspace_root: PathBuf,
    workspace_authority: DebugWorkspaceAuthority,
    host: LoopbackHost,
    port: u16,
) -> TerminalAuthorityObservation {
    let discovered = DiscoveredNodeInspectorCandidate {
        snapshot: VerifiedProcessSnapshot {
            process_id: 41,
            process_group_id: 40,
            start_seconds: 1,
            start_microseconds: 2,
            process_image: b"/verified/bin/node".to_vec(),
            arguments: vec![format!("--inspect={port}").into_bytes()],
            arguments_capture: super::ProcessArgumentsCapture::Complete,
        },
        endpoint: super::LoopbackInspectorEndpoint { host, port },
    };
    TerminalAuthorityObservation {
        candidate: UnverifiedNodeAttachCandidate {
            authority: TerminalCandidateAuthority {
                process_group_id: 40,
                session_id: 7,
                source: TerminalOwnedProcessGroupSource::Shell,
            },
            display: redacted_display(&discovered),
            discovered,
            retained_workspace: None,
            workspace_authority,
            workspace_root,
        },
    }
}

fn normalize_owned_groups(
    groups: Vec<TerminalOwnedProcessGroup>,
) -> Result<Vec<TerminalCandidateAuthority>, AttachCandidateInventoryFailure> {
    if groups.len() > MAX_OWNED_PROCESS_GROUPS {
        return Err(AttachCandidateInventoryFailure::CapacityExceeded);
    }
    let mut by_process_group = BTreeMap::<u32, TerminalCandidateAuthority>::new();
    for group in groups {
        let process_group_id = u32::try_from(group.process_group_id)
            .ok()
            .filter(|process_group_id| *process_group_id > 0)
            .ok_or(AttachCandidateInventoryFailure::TerminalOwnershipUnavailable)?;
        let authority = TerminalCandidateAuthority {
            process_group_id,
            session_id: group.session_id,
            source: group.source,
        };
        match by_process_group.get_mut(&process_group_id) {
            None => {
                by_process_group.insert(process_group_id, authority);
            }
            Some(existing) if existing.session_id != authority.session_id => {
                return Err(AttachCandidateInventoryFailure::AmbiguousTerminalOwnership);
            }
            Some(existing)
                if matches!(existing.source, TerminalOwnedProcessGroupSource::Task)
                    && matches!(authority.source, TerminalOwnedProcessGroupSource::Shell) =>
            {
                *existing = authority;
            }
            Some(_) => {}
        }
    }
    Ok(by_process_group.into_values().collect())
}

fn process_generation(snapshot: &VerifiedProcessSnapshot) -> ProcessGeneration {
    ProcessGeneration {
        process_group_id: snapshot.process_group_id,
        process_id: snapshot.process_id,
        start_microseconds: snapshot.start_microseconds,
        start_seconds: snapshot.start_seconds,
    }
}

fn redacted_display(
    discovered: &DiscoveredNodeInspectorCandidate,
) -> RedactedAttachCandidateDisplay {
    let label = "Node.js inspector".to_string();
    let host = match discovered.endpoint.host {
        LoopbackHost::Ipv4 => "127.0.0.1",
        LoopbackHost::Ipv6 => "[::1]",
        LoopbackHost::Localhost => "localhost",
    };
    let detail = format!("Integrated terminal · {host}:{}", discovered.endpoint.port);
    debug_assert!(label.len() <= MAX_DISPLAY_LABEL_BYTES);
    debug_assert!(detail.len() <= MAX_DISPLAY_DETAIL_BYTES);
    RedactedAttachCandidateDisplay { label, detail }
}

#[cfg(test)]
#[path = "debug_node_attach_inventory_tests.rs"]
mod tests;
