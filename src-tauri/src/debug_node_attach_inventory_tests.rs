use super::*;
use std::fs;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

struct FakeOwnershipProvider {
    groups: BTreeMap<PathBuf, Vec<TerminalOwnedProcessGroup>>,
    snapshot_complete: Arc<AtomicBool>,
}

impl TerminalOwnershipProvider for FakeOwnershipProvider {
    fn owned_process_groups(
        &self,
        workspace_root: &Path,
    ) -> Result<Vec<TerminalOwnedProcessGroup>, AttachCandidateInventoryFailure> {
        self.snapshot_complete.store(true, Ordering::SeqCst);
        Ok(self.groups.get(workspace_root).cloned().unwrap_or_default())
    }
}

struct FakeProcessSnapshotProvider {
    calls: Arc<Mutex<Vec<u32>>>,
    failure: Option<AttachCandidateInventoryFailure>,
    snapshot_complete: Arc<AtomicBool>,
    snapshots: Mutex<BTreeMap<u32, Vec<VerifiedProcessSnapshot>>>,
}

struct FakeReauthorizationProvider {
    failure: Option<AttachCandidateInventoryFailure>,
    groups: Vec<TerminalOwnedProcessGroup>,
    requested_roots: Mutex<Vec<PathBuf>>,
    workspace_authority: Option<DebugWorkspaceAuthority>,
}

impl TerminalReauthorizationProvider for FakeReauthorizationProvider {
    fn terminal_reauthorization_snapshot(
        &self,
        workspace_root: &Path,
    ) -> Result<TerminalReauthorizationSnapshot, AttachCandidateInventoryFailure> {
        self.requested_roots
            .lock()
            .expect("requested roots")
            .push(workspace_root.to_path_buf());
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        let mut groups = self.groups.clone();
        for group in &mut groups {
            group.workspace_authority = self.workspace_authority.clone();
        }
        Ok(TerminalReauthorizationSnapshot { groups })
    }
}

impl ProcessSnapshotProvider for FakeProcessSnapshotProvider {
    fn verified_process_snapshots(
        &self,
        process_group_id: u32,
    ) -> Result<Vec<VerifiedProcessSnapshot>, AttachCandidateInventoryFailure> {
        assert!(
            self.snapshot_complete.load(Ordering::SeqCst),
            "platform I/O started before terminal ownership snapshot completed"
        );
        self.calls.lock().expect("calls").push(process_group_id);
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        Ok(self
            .snapshots
            .lock()
            .expect("snapshots")
            .remove(&process_group_id)
            .unwrap_or_default())
    }
}

#[cfg(target_os = "macos")]
struct FakeProcessRevalidationProvider {
    snapshot: Mutex<Option<VerifiedProcessSnapshot>>,
}

#[cfg(target_os = "macos")]
impl ProcessRevalidationProvider for FakeProcessRevalidationProvider {
    fn verified_process_snapshot(
        &self,
        _process_id: u32,
        _process_group_id: u32,
    ) -> Result<VerifiedProcessSnapshot, StrongCandidateRevalidationFailure> {
        self.snapshot
            .lock()
            .expect("snapshot")
            .take()
            .ok_or(StrongCandidateRevalidationFailure::ProcessChanged)
    }
}

fn group(
    process_group_id: i32,
    session_id: u64,
    source: TerminalOwnedProcessGroupSource,
) -> TerminalOwnedProcessGroup {
    TerminalOwnedProcessGroup {
        process_group_id,
        session_id,
        source,
        workspace_authority: None,
    }
}

fn snapshot(
    process_id: u32,
    process_group_id: u32,
    start_seconds: u64,
    arguments: &[&[u8]],
) -> VerifiedProcessSnapshot {
    VerifiedProcessSnapshot {
        process_id,
        process_group_id,
        start_seconds,
        start_microseconds: 7,
        process_image: b"/private/runtime/node".to_vec(),
        arguments: arguments.iter().map(|argument| argument.to_vec()).collect(),
        arguments_capture: super::super::ProcessArgumentsCapture::Complete,
    }
}

fn providers(
    groups: BTreeMap<PathBuf, Vec<TerminalOwnedProcessGroup>>,
    snapshots: BTreeMap<u32, Vec<VerifiedProcessSnapshot>>,
) -> (FakeOwnershipProvider, FakeProcessSnapshotProvider) {
    let snapshot_complete = Arc::new(AtomicBool::new(false));
    (
        FakeOwnershipProvider {
            groups,
            snapshot_complete: Arc::clone(&snapshot_complete),
        },
        FakeProcessSnapshotProvider {
            calls: Arc::new(Mutex::new(Vec::new())),
            failure: None,
            snapshot_complete,
            snapshots: Mutex::new(snapshots),
        },
    )
}

fn unverified_candidate(
    workspace_root: &Path,
    process_group_id: u32,
    session_id: u64,
    source: TerminalOwnedProcessGroupSource,
) -> UnverifiedNodeAttachCandidate {
    let discovered = parse_verified_node_inspector(snapshot(
        51,
        process_group_id,
        1_000,
        &[b"--inspect=9230", b"app.js"],
    ))
    .expect("arguments should parse")
    .expect("candidate should be discovered");
    UnverifiedNodeAttachCandidate {
        display: redacted_display(&discovered),
        authority: TerminalCandidateAuthority {
            process_group_id,
            session_id,
            source,
        },
        discovered,
        retained_workspace: None,
        workspace_authority: test_workspace_authority(workspace_root),
        workspace_root: workspace_root.to_path_buf(),
    }
}

fn test_workspace_authority(workspace_root: &Path) -> DebugWorkspaceAuthority {
    DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: format!("test:{}", workspace_root.display()),
        canonical_root: workspace_root.to_string_lossy().into_owned(),
    }
}

fn reauthorization_provider(
    workspace_root: &Path,
    groups: Vec<TerminalOwnedProcessGroup>,
) -> FakeReauthorizationProvider {
    FakeReauthorizationProvider {
        failure: None,
        groups,
        requested_roots: Mutex::new(Vec::new()),
        workspace_authority: Some(test_workspace_authority(workspace_root)),
    }
}

#[cfg(target_os = "macos")]
fn target_metadata(root: &Path, target_id: &str, port: u16, source: &str) -> Vec<u8> {
    format!(
        r#"[{{"id":"{target_id}","type":"node","url":"file://{}","webSocketDebuggerUrl":"ws://127.0.0.1:{port}/{target_id}"}}]"#,
        root.join(source).display()
    )
    .into_bytes()
}

#[cfg(target_os = "macos")]
fn observed_payload(root: &Path, target_id: &str) -> EndpointObservedNodeAttachCandidate {
    let candidate = unverified_candidate(root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
    TerminalAuthorityObservation { candidate }
        .observe_endpoint(&target_metadata(root, target_id, 9_230, "app.js"))
        .expect("endpoint observation")
        .payload
}

#[cfg(target_os = "macos")]
fn fresh_process(arguments: &[&[u8]]) -> FakeProcessRevalidationProvider {
    FakeProcessRevalidationProvider {
        snapshot: Mutex::new(Some(snapshot(51, 41, 1_000, arguments))),
    }
}

#[test]
fn inventory_is_root_isolated_and_platform_work_starts_after_snapshot() {
    let root_a = PathBuf::from("/workspace/a");
    let root_b = PathBuf::from("/workspace/b");
    let (ownership, processes) = providers(
        BTreeMap::from([
            (
                root_a.clone(),
                vec![group(41, 1, TerminalOwnedProcessGroupSource::Shell)],
            ),
            (
                root_b.clone(),
                vec![group(42, 2, TerminalOwnedProcessGroupSource::Shell)],
            ),
        ]),
        BTreeMap::from([(
            41,
            vec![snapshot(51, 41, 1_000, &[b"--inspect=9230", b"app.js"])],
        )]),
    );

    let inventory =
        collect_discovered_candidates_with(&root_a, &ownership, &processes).expect("inventory");

    assert_eq!(inventory.workspace_root, root_a);
    assert_eq!(inventory.candidates.len(), 1);
    assert_eq!(
        processes.calls.lock().expect("calls").as_slice(),
        &[41],
        "foreign workspace PGID must not reach the platform provider"
    );
    assert_eq!(inventory.candidates[0].authority.session_id, 1);
}

#[test]
fn duplicate_generation_and_duplicate_same_session_group_are_collected_once() {
    let root = PathBuf::from("/workspace");
    let duplicate_a = snapshot(51, 41, 1_000, &[b"--inspect=9230", b"app.js"]);
    let duplicate_b = snapshot(51, 41, 1_000, &[b"--inspect=9230", b"app.js"]);
    let (ownership, processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![
                group(41, 1, TerminalOwnedProcessGroupSource::Task),
                group(41, 1, TerminalOwnedProcessGroupSource::Shell),
            ],
        )]),
        BTreeMap::from([(41, vec![duplicate_a, duplicate_b])]),
    );

    let inventory =
        collect_discovered_candidates_with(&root, &ownership, &processes).expect("inventory");

    assert_eq!(inventory.candidates.len(), 1);
    assert!(matches!(
        inventory.candidates[0].authority.source,
        TerminalOwnedProcessGroupSource::Shell
    ));
    assert_eq!(processes.calls.lock().expect("calls").as_slice(), &[41]);
}

#[test]
fn conflicting_duplicate_generation_fails_before_candidate_parsing() {
    let root = PathBuf::from("/workspace");
    let first = snapshot(51, 41, 1_000, &[b"--inspect=9230", b"app.js"]);
    let mut conflicting = snapshot(51, 41, 1_000, &[b"--inspect=9231", b"other.js"]);
    conflicting.process_image = b"/different/runtime/nodejs".to_vec();
    let (ownership, processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![group(41, 1, TerminalOwnedProcessGroupSource::Shell)],
        )]),
        BTreeMap::from([(41, vec![first, conflicting])]),
    );

    assert!(matches!(
        collect_discovered_candidates_with(&root, &ownership, &processes),
        Err(AttachCandidateInventoryFailure::PlatformInventoryUnavailable)
    ));
}

#[test]
fn provider_failure_and_ambiguous_terminal_ownership_fail_closed() {
    let root = PathBuf::from("/workspace");
    let (ownership, mut processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![group(41, 1, TerminalOwnedProcessGroupSource::Shell)],
        )]),
        BTreeMap::new(),
    );
    processes.failure = Some(AttachCandidateInventoryFailure::PlatformInventoryUnavailable);
    assert!(matches!(
        collect_discovered_candidates_with(&root, &ownership, &processes),
        Err(AttachCandidateInventoryFailure::PlatformInventoryUnavailable)
    ));

    let (ownership, processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![
                group(41, 1, TerminalOwnedProcessGroupSource::Shell),
                group(41, 2, TerminalOwnedProcessGroupSource::Task),
            ],
        )]),
        BTreeMap::new(),
    );
    assert!(matches!(
        collect_discovered_candidates_with(&root, &ownership, &processes),
        Err(AttachCandidateInventoryFailure::AmbiguousTerminalOwnership)
    ));
    assert!(processes.calls.lock().expect("calls").is_empty());
}

#[test]
fn group_snapshot_and_candidate_capacities_fail_without_partial_inventory() {
    let root = PathBuf::from("/workspace");
    let groups = (1..=MAX_OWNED_PROCESS_GROUPS + 1)
        .map(|index| {
            group(
                i32::try_from(index).expect("group"),
                u64::try_from(index).expect("session"),
                TerminalOwnedProcessGroupSource::Shell,
            )
        })
        .collect();
    let (ownership, processes) =
        providers(BTreeMap::from([(root.clone(), groups)]), BTreeMap::new());
    assert!(matches!(
        collect_discovered_candidates_with(&root, &ownership, &processes),
        Err(AttachCandidateInventoryFailure::CapacityExceeded)
    ));
    assert!(processes.calls.lock().expect("calls").is_empty());

    let candidates = (0..=MAX_UNVERIFIED_CANDIDATES)
        .map(|index| {
            snapshot(
                u32::try_from(index + 100).expect("pid"),
                41,
                u64::try_from(index + 1).expect("generation"),
                &[b"--inspect=9230", b"app.js"],
            )
        })
        .collect();
    let (ownership, processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![group(41, 1, TerminalOwnedProcessGroupSource::Shell)],
        )]),
        BTreeMap::from([(41, candidates)]),
    );
    assert!(matches!(
        collect_discovered_candidates_with(&root, &ownership, &processes),
        Err(AttachCandidateInventoryFailure::CapacityExceeded)
    ));
}

#[test]
fn unverified_projection_is_bounded_and_contains_no_process_secrets() {
    let root = PathBuf::from("/workspace/private-root");
    let (ownership, processes) = providers(
        BTreeMap::from([(
            root.clone(),
            vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
        )]),
        BTreeMap::from([(
            41,
            vec![snapshot(
                424_242,
                41,
                1_000,
                &[
                    b"--require=/secret/bootstrap-token.js",
                    b"--inspect=localhost:9230",
                    b"/secret/application.js",
                ],
            )],
        )]),
    );

    let inventory =
        collect_discovered_candidates_with(&root, &ownership, &processes).expect("inventory");
    let candidate = &inventory.candidates[0];
    let projection = format!("{:?}", candidate.display);

    assert!(candidate.display.label.len() <= MAX_DISPLAY_LABEL_BYTES);
    assert!(candidate.display.detail.len() <= MAX_DISPLAY_DETAIL_BYTES);
    for secret in [
        "424242",
        "bootstrap-token",
        "application.js",
        "private-root",
        "ws://",
    ] {
        assert!(!projection.contains(secret), "{secret}");
    }
    assert_eq!(candidate.authority.process_group_id, 41);
    assert_eq!(candidate.discovered.endpoint.port, 9_230);
}

#[test]
fn terminal_reauthorization_requires_one_exact_fresh_authority_tuple() {
    let root = PathBuf::from("/workspace");
    let provider = reauthorization_provider(
        &root,
        vec![
            group(90, 11, TerminalOwnedProcessGroupSource::Task),
            group(41, 7, TerminalOwnedProcessGroupSource::Shell),
        ],
    );
    let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);

    let reauthorized = observe_terminal_authority_with(candidate, &root, &provider)
        .expect("one exact authority tuple should reauthorize");

    assert_eq!(reauthorized.candidate.authority.process_group_id, 41);
    assert_eq!(
        provider
            .requested_roots
            .lock()
            .expect("requested roots")
            .as_slice(),
        &[root]
    );
}

#[test]
fn terminal_reauthorization_rejects_root_mismatch_without_provider_access() {
    let original_root = PathBuf::from("/workspace/a");
    let requested_root = PathBuf::from("/workspace/b");
    let provider = reauthorization_provider(
        &original_root,
        vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
    );
    let candidate = unverified_candidate(
        &original_root,
        41,
        7,
        TerminalOwnedProcessGroupSource::Shell,
    );

    assert!(matches!(
        observe_terminal_authority_with(candidate, &requested_root, &provider),
        Err(AttachCandidateInventoryFailure::WorkspaceMismatch)
    ));
    assert!(provider
        .requested_roots
        .lock()
        .expect("requested roots")
        .is_empty());
}

#[test]
fn terminal_reauthorization_fails_closed_for_stopped_session_and_lock_failure() {
    let root = PathBuf::from("/workspace");
    let missing = reauthorization_provider(&root, Vec::new());
    let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
    assert!(matches!(
        observe_terminal_authority_with(candidate, &root, &missing),
        Err(AttachCandidateInventoryFailure::TerminalAuthorityChanged)
    ));

    let locked = FakeReauthorizationProvider {
        failure: Some(AttachCandidateInventoryFailure::TerminalOwnershipUnavailable),
        groups: Vec::new(),
        requested_roots: Mutex::new(Vec::new()),
        workspace_authority: Some(test_workspace_authority(&root)),
    };
    let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
    assert!(matches!(
        observe_terminal_authority_with(candidate, &root, &locked),
        Err(AttachCandidateInventoryFailure::TerminalOwnershipUnavailable)
    ));
}

#[test]
fn terminal_reauthorization_rejects_source_session_and_process_group_drift() {
    let root = PathBuf::from("/workspace");
    let drifted_groups = [
        group(41, 7, TerminalOwnedProcessGroupSource::Task),
        group(41, 8, TerminalOwnedProcessGroupSource::Shell),
        group(42, 7, TerminalOwnedProcessGroupSource::Shell),
    ];

    for drifted_group in drifted_groups {
        let provider = reauthorization_provider(&root, vec![drifted_group]);
        let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
        assert!(observe_terminal_authority_with(candidate, &root, &provider).is_err());
    }
}

#[test]
fn terminal_reauthorization_rejects_duplicate_and_conflicting_pgid_claims() {
    let root = PathBuf::from("/workspace");
    for groups in [
        vec![
            group(41, 7, TerminalOwnedProcessGroupSource::Shell),
            group(41, 7, TerminalOwnedProcessGroupSource::Shell),
        ],
        vec![
            group(41, 7, TerminalOwnedProcessGroupSource::Shell),
            group(41, 7, TerminalOwnedProcessGroupSource::Task),
        ],
        vec![
            group(41, 7, TerminalOwnedProcessGroupSource::Shell),
            group(41, 8, TerminalOwnedProcessGroupSource::Shell),
        ],
    ] {
        let provider = reauthorization_provider(&root, groups);
        let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
        assert!(matches!(
            observe_terminal_authority_with(candidate, &root, &provider),
            Err(AttachCandidateInventoryFailure::AmbiguousTerminalOwnership)
        ));
    }
}

#[test]
fn terminal_observation_blocks_when_launch_workspace_identity_is_unavailable() {
    let root = PathBuf::from("/workspace");
    let mut provider = reauthorization_provider(
        &root,
        vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
    );
    provider.workspace_authority = None;
    let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);

    assert!(matches!(
        observe_terminal_authority_with(candidate, &root, &provider),
        Err(AttachCandidateInventoryFailure::StableTerminalWorkspaceIdentityUnavailable)
    ));
}

#[test]
fn terminal_observation_rejects_replacement_workspace_id() {
    let root = PathBuf::from("/workspace");
    let mut provider = reauthorization_provider(
        &root,
        vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
    );
    provider.workspace_authority = Some(DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: "replacement-workspace".to_string(),
        canonical_root: root.to_string_lossy().into_owned(),
    });
    let candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);

    assert!(matches!(
        observe_terminal_authority_with(candidate, &root, &provider),
        Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged)
    ));
}

#[cfg(target_os = "macos")]
#[test]
fn strong_consume_rejects_terminal_process_and_endpoint_drift() {
    const TARGET_ID: &str = "12345678-1234-1234-1234-123456789abc";
    let root = std::env::temp_dir().join(format!(
        "codevo-attach-strong-consume-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir(&root).expect("create root");
    fs::write(root.join("app.js"), b"setInterval(() => {}, 1000);").expect("write app");
    fs::write(root.join("other.js"), b"setInterval(() => {}, 1000);").expect("write other");

    let stopped = reauthorization_provider(&root, Vec::new());
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &stopped,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::TerminalChanged)
    ));

    let drifted_terminal = reauthorization_provider(
        &root,
        vec![group(41, 7, TerminalOwnedProcessGroupSource::Task)],
    );
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &drifted_terminal,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::TerminalChanged)
    ));

    let exact_terminal = reauthorization_provider(
        &root,
        vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
    );
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &exact_terminal,
            &fresh_process(&[b"--inspect=9231", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::ProcessChanged)
    ));
    let exec_drift = FakeProcessRevalidationProvider {
        snapshot: Mutex::new(Some(snapshot(
            51,
            41,
            1_001,
            &[b"--inspect=9230", b"app.js"],
        ))),
    };
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &exact_terminal,
            &exec_drift,
            &target_metadata(&root, TARGET_ID, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::ProcessChanged)
    ));

    let changed_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &exact_terminal,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, changed_id, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::EndpointChanged)
    ));
    assert!(matches!(
        observed_payload(&root, TARGET_ID).consume_and_revalidate_with(
            &exact_terminal,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_231, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::EndpointChanged)
    ));

    observed_payload(&root, TARGET_ID)
        .consume_and_revalidate_with(
            &exact_terminal,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_230, "other.js"),
        )
        .expect("source remains a point-in-time metadata filter");

    fs::remove_dir_all(&root).expect("remove root");
}

#[cfg(target_os = "macos")]
#[test]
fn publication_and_strong_consume_reject_renamed_replaced_retained_root() {
    use crate::{
        debug_session_registry::retain_workspace_root, workspace_registry::WorkspaceRegistry,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    const TARGET_ID: &str = "12345678-1234-1234-1234-123456789abc";
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-attach-publish-retained-{}-{nonce}",
        std::process::id()
    ));
    let root = fixture.join("workspace");
    fs::create_dir_all(&root).expect("create workspace");
    fs::write(root.join("app.js"), b"setInterval(() => {}, 1000);").expect("write app");
    let registry = WorkspaceRegistry::new();
    let descriptor = registry.register(&root).expect("register workspace");
    let root = descriptor.canonical_root_path.clone();
    let retained = Arc::new(
        retain_workspace_root(
            &registry,
            descriptor
                .canonical_root_path
                .to_str()
                .expect("UTF-8 fixture"),
        )
        .expect("retain workspace"),
    );

    let make_candidate = || {
        let mut candidate =
            unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
        candidate.workspace_authority = retained.authority.clone();
        candidate.retained_workspace = Some(Arc::clone(&retained));
        candidate
    };
    let payload = TerminalAuthorityObservation {
        candidate: make_candidate(),
    }
    .observe_endpoint(&target_metadata(&root, TARGET_ID, 9_230, "app.js"))
    .expect("publish before replacement")
    .payload;
    let pending_publication = TerminalAuthorityObservation {
        candidate: make_candidate(),
    };

    let moved = fixture.join("moved-workspace");
    fs::rename(&root, &moved).expect("rename workspace");
    fs::create_dir(&root).expect("replace path");
    fs::write(root.join("app.js"), b"replacement").expect("write replacement");

    assert!(matches!(
        pending_publication.observe_endpoint(&target_metadata(&root, TARGET_ID, 9_230, "app.js")),
        Err(EndpointObservationFailure::WorkspaceIdentityChanged)
    ));
    let terminal = FakeReauthorizationProvider {
        failure: None,
        groups: vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
        requested_roots: Mutex::new(Vec::new()),
        workspace_authority: Some(retained.authority.clone()),
    };
    assert!(matches!(
        payload.consume_and_revalidate_with(
            &terminal,
            &fresh_process(&[b"--inspect=9230", b"app.js"]),
            &target_metadata(&root, TARGET_ID, 9_230, "app.js"),
        ),
        Err(StrongCandidateRevalidationFailure::WorkspaceIdentityChanged)
    ));
    assert!(terminal
        .requested_roots
        .lock()
        .expect("requested roots")
        .is_empty());

    drop(retained);
    drop(registry);
    fs::remove_dir_all(&fixture).expect("remove fixture");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn terminal_observation_rejects_renamed_and_replaced_retained_workspace() {
    use crate::{
        debug_session_registry::retain_workspace_root, workspace_registry::WorkspaceRegistry,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let fixture = std::env::temp_dir().join(format!(
        "codevo-attach-retained-root-{}-{nonce}",
        std::process::id()
    ));
    let selected_root = fixture.join("workspace");
    fs::create_dir_all(&selected_root).expect("create workspace");
    let registry = WorkspaceRegistry::new();
    let descriptor = registry
        .register(&selected_root)
        .expect("register workspace");
    let retained = Arc::new(
        retain_workspace_root(
            &registry,
            descriptor
                .canonical_root_path
                .to_str()
                .expect("UTF-8 fixture"),
        )
        .expect("retain workspace"),
    );
    let root = descriptor.canonical_root_path;
    let mut candidate = unverified_candidate(&root, 41, 7, TerminalOwnedProcessGroupSource::Shell);
    candidate.workspace_authority = retained.authority.clone();
    candidate.retained_workspace = Some(Arc::clone(&retained));
    let provider = FakeReauthorizationProvider {
        failure: None,
        groups: vec![group(41, 7, TerminalOwnedProcessGroupSource::Shell)],
        requested_roots: Mutex::new(Vec::new()),
        workspace_authority: Some(retained.authority.clone()),
    };

    let moved_root = fixture.join("moved-workspace");
    fs::rename(&root, &moved_root).expect("rename retained workspace");
    fs::create_dir(&root).expect("replace workspace path");

    assert!(matches!(
        observe_terminal_authority_with(candidate, &root, &provider),
        Err(AttachCandidateInventoryFailure::WorkspaceIdentityChanged)
    ));
    assert!(provider
        .requested_roots
        .lock()
        .expect("requested roots")
        .is_empty());

    drop(retained);
    drop(registry);
    fs::remove_dir_all(&fixture).expect("remove fixture");
}
