use super::*;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: std::path::PathBuf,
    registry: WorkspaceRegistry,
    service: Mutex<WorkspaceTrustService>,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-opened-trust-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("project")).unwrap();
        let service = Mutex::new(WorkspaceTrustService::load(root.join("trust.json")).unwrap());
        Self {
            root,
            service,
            registry: WorkspaceRegistry::new(),
        }
    }

    fn admit(&self) -> OpenedProjectTrustTarget {
        let registration = self
            .registry
            .register_with_receipt(self.root.join("project"))
            .unwrap();
        OpenedProjectTrustTarget {
            workspace_id: registration.receipt.workspace_id,
            admission_token: registration.receipt.admission_token,
            selected_root_path: registration
                .descriptor
                .selected_root_path
                .to_string_lossy()
                .into_owned(),
            canonical_root_path: registration
                .descriptor
                .canonical_root_path
                .to_string_lossy()
                .into_owned(),
        }
    }

    fn trusted(&self) -> bool {
        self.service
            .lock()
            .unwrap()
            .get(&self.root.join("project").to_string_lossy())
            .trusted
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn grants_current_opened_project_and_activates_once() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    let mut activated = false;
    let state = grant(&fixture.registry, &fixture.service, target, |_| {
        activated = true
    })
    .unwrap();
    assert!(state.trusted && activated && fixture.trusted());
}

#[test]
fn rejects_replaced_admission_without_granting() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    fixture.admit();
    assert!(
        grant(&fixture.registry, &fixture.service, target, |_| panic!(
            "stale activation"
        ))
        .is_err()
    );
    assert!(!fixture.trusted());
}

#[test]
fn rejects_path_replacement_and_forged_root() {
    let fixture = Fixture::new();
    let mut target = fixture.admit();
    target.canonical_root_path = fixture.root.to_string_lossy().into_owned();
    assert!(
        grant(&fixture.registry, &fixture.service, target, |_| panic!(
            "foreign activation"
        ))
        .is_err()
    );
    let target = fixture.admit();
    fs::rename(fixture.root.join("project"), fixture.root.join("old")).unwrap();
    fs::create_dir(fixture.root.join("project")).unwrap();
    assert!(
        grant(&fixture.registry, &fixture.service, target, |_| panic!(
            "replacement activation"
        ))
        .is_err()
    );
    assert!(!fixture.trusted());
}

#[test]
fn revocation_is_not_undone_by_same_or_new_admission() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    let root = target.canonical_root_path.clone();
    grant(&fixture.registry, &fixture.service, target, |_| {}).unwrap();
    fixture.service.lock().unwrap().set(&root, false).unwrap();
    let target = fixture.admit();
    assert!(
        grant(&fixture.registry, &fixture.service, target, |_| panic!(
            "revoked activation"
        ))
        .is_err()
    );
    assert!(!fixture.trusted());
}

#[test]
fn closed_admission_cannot_grant() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    fixture.registry.unregister(&target.workspace_id).unwrap();
    assert!(
        grant(&fixture.registry, &fixture.service, target, |_| panic!(
            "closed activation"
        ))
        .is_err()
    );
    assert!(!fixture.trusted());
}

#[test]
fn wire_rejects_unknown_fields_and_invalid_tokens() {
    assert!(serde_json::from_value::<OpenedProjectTrustTarget>(serde_json::json!({
        "workspaceId":"x", "admissionToken":1, "selectedRootPath":"/a", "canonicalRootPath":"/a", "trusted":true
    })).is_err());
    let fixture = Fixture::new();
    let mut target = fixture.admit();
    target.admission_token = 0;
    assert!(grant(&fixture.registry, &fixture.service, target, |_| {}).is_err());
    assert!(!fixture.trusted());
}

#[test]
fn revocation_identity_wire_and_refusal_match_the_shared_contract() {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../contracts/workspace-trust-errors.json")).unwrap();
    assert_eq!(
        contract["openedProjectIdentityReplaced"].as_str(),
        Some(OPENED_PROJECT_REVOCATION_IDENTITY_ERROR)
    );
    let pinned = contract["openedProjectRevocationTarget"].clone();
    let target: OpenedProjectTrustRevocationTarget =
        serde_json::from_value(pinned.clone()).unwrap();
    assert_eq!(target.workspace_id.as_str(), "ws-a");
    assert_eq!(target.admission_token, 4);
    assert_eq!(target.canonical_root_path, "/real");
    for (field, value) in [
        ("rootPath", serde_json::json!("/real")),
        ("selectedRootPath", serde_json::json!("/alias")),
        ("trusted", serde_json::json!(false)),
    ] {
        let mut widened = pinned.clone();
        widened[field] = value;
        assert!(serde_json::from_value::<OpenedProjectTrustRevocationTarget>(widened).is_err());
    }
    for missing in ["workspaceId", "admissionToken", "canonicalRootPath"] {
        let mut narrowed = pinned.clone();
        narrowed.as_object_mut().unwrap().remove(missing);
        assert!(serde_json::from_value::<OpenedProjectTrustRevocationTarget>(narrowed).is_err());
    }
    let refusal = revocation_lease(&WorkspaceRegistry::new(), &target)
        .err()
        .unwrap();
    assert_eq!(refusal.kind(), io::ErrorKind::InvalidInput);
    assert_eq!(
        refusal.to_string(),
        OPENED_PROJECT_REVOCATION_IDENTITY_ERROR
    );
}

#[test]
fn persisted_revocation_survives_reload_and_manual_grant_can_restore_it() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    let root = target.canonical_root_path.clone();
    fixture.service.lock().unwrap().set(&root, false).unwrap();
    let reloaded =
        Mutex::new(WorkspaceTrustService::load(fixture.root.join("trust.json")).unwrap());
    assert!(grant(&fixture.registry, &reloaded, target, |_| panic!(
        "revoked activation"
    ))
    .is_err());
    reloaded.lock().unwrap().set(&root, true).unwrap();
    assert!(
        grant(&fixture.registry, &reloaded, fixture.admit(), |_| {})
            .unwrap()
            .trusted
    );
}

#[test]
fn legacy_store_remains_compatible_and_exact_grant_never_resolves_a_retargeted_path() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fs::write(fixture.root.join("trust.json"), r#"{"trustedRoots":[]}"#).unwrap();
    let mut service = WorkspaceTrustService::load(fixture.root.join("trust.json")).unwrap();
    let target = fixture.admit();
    fs::rename(fixture.root.join("project"), fixture.root.join("original")).unwrap();
    fs::create_dir(fixture.root.join("foreign")).unwrap();
    symlink(fixture.root.join("foreign"), fixture.root.join("project")).unwrap();
    let state = service
        .grant_opened_canonical_root(&target.canonical_root_path)
        .unwrap();
    assert_eq!(state.root_path, target.canonical_root_path);
    assert!(
        !service
            .get(&fixture.root.join("foreign").to_string_lossy())
            .trusted
    );
}

#[test]
fn failed_revocation_save_rolls_back_its_tombstone() {
    let fixture = Fixture::new();
    let target = fixture.admit();
    let root = target.canonical_root_path.clone();
    grant(&fixture.registry, &fixture.service, target, |_| {}).unwrap();
    fs::remove_file(fixture.root.join("trust.json")).unwrap();
    fs::create_dir(fixture.root.join("trust.json")).unwrap();
    assert!(fixture.service.lock().unwrap().set(&root, false).is_err());
    assert!(
        grant(&fixture.registry, &fixture.service, fixture.admit(), |_| {})
            .unwrap()
            .trusted
    );
}

#[test]
fn pending_lease_rejects_close_and_replacement_before_side_effect() {
    for close in [false, true] {
        let fixture = Fixture::new();
        let target = fixture.admit();
        let lease = fixture
            .registry
            .reserve_latest_registration_operation(&target.workspace_id, target.admission_token)
            .unwrap();
        if close {
            fixture.registry.unregister(&target.workspace_id).unwrap();
        } else {
            fixture.admit();
        }
        assert!(grant_lease(&lease, &fixture.service, |_| panic!("stale activation")).is_err());
        assert!(!fixture.trusted());
    }
}

fn revocation_target(grant: &OpenedProjectTrustTarget) -> OpenedProjectTrustRevocationTarget {
    OpenedProjectTrustRevocationTarget {
        workspace_id: grant.workspace_id.clone(),
        admission_token: grant.admission_token,
        canonical_root_path: grant.canonical_root_path.clone(),
    }
}

fn revoke_in(fixture: &Fixture, root: &str) -> io::Result<Vec<String>> {
    fixture
        .service
        .lock()
        .unwrap()
        .revoke_opened_canonical_root(root)
}

fn refused_as_replaced(refusal: Option<io::Error>) -> bool {
    refusal.is_some_and(|refusal| {
        refusal.kind() == io::ErrorKind::InvalidInput
            && refusal.to_string() == OPENED_PROJECT_REVOCATION_IDENTITY_ERROR
    })
}

#[test]
fn a_held_admission_that_is_not_the_latest_still_revokes_its_registration() {
    let fixture = Fixture::new();
    let earlier = fixture.admit();
    let latest = fixture.admit();
    assert_eq!(earlier.workspace_id, latest.workspace_id);
    assert_ne!(earlier.admission_token, latest.admission_token);
    let root = earlier.canonical_root_path.clone();
    fixture.service.lock().unwrap().set(&root, true).unwrap();

    let lease = revocation_lease(&fixture.registry, &revocation_target(&earlier)).unwrap();
    let revoked = revoke_lease(&lease, |root| revoke_in(&fixture, root)).unwrap();

    assert_eq!(revoked.revoked_roots, vec![root]);
    assert_eq!(revoked.descriptor.workspace_id, earlier.workspace_id);
    assert!(!fixture.trusted());
}

#[test]
fn a_registration_released_and_reopened_before_the_commit_refuses_the_revocation() {
    for reopened in [false, true] {
        let fixture = Fixture::new();
        let target = fixture.admit();
        let root = target.canonical_root_path.clone();
        fixture.service.lock().unwrap().set(&root, true).unwrap();
        let lease = revocation_lease(&fixture.registry, &revocation_target(&target)).unwrap();
        fixture.registry.unregister(&target.workspace_id).unwrap();
        if reopened {
            assert_ne!(fixture.admit().workspace_id, target.workspace_id);
        }

        let refusal = revoke_lease(&lease, |root| revoke_in(&fixture, root)).err();

        assert!(refused_as_replaced(refusal));
        assert!(fixture.trusted());
        assert!(refused_as_replaced(
            revocation_lease(&fixture.registry, &revocation_target(&target)).err()
        ));
    }
}

#[test]
fn a_release_and_reopen_cannot_interleave_with_an_in_flight_revocation() {
    const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);
    let fixture = Fixture::new();
    let target = fixture.admit();
    let root = target.canonical_root_path.clone();
    fixture.service.lock().unwrap().set(&root, true).unwrap();
    let lease = revocation_lease(&fixture.registry, &revocation_target(&target)).unwrap();
    let (entered, entered_rx) = std::sync::mpsc::channel();
    let (release, release_rx) = std::sync::mpsc::channel::<()>();
    let (reopened, reopened_rx) = std::sync::mpsc::channel();

    let (shared_lease, shared_fixture, released_id) = (&lease, &fixture, &target.workspace_id);
    let (revoked, released_in_time, replacement) = std::thread::scope(|scope| {
        let revocation = scope.spawn(move || {
            let (lease, fixture) = (shared_lease, shared_fixture);
            let mut released_in_time = false;
            let revoked = revoke_lease(lease, |root| {
                entered.send(()).unwrap();
                released_in_time = release_rx.recv_timeout(DEADLINE).is_ok();
                revoke_in(fixture, root)
            });
            (revoked, released_in_time)
        });
        entered_rx
            .recv_timeout(DEADLINE)
            .expect("the revocation never reached its commit");
        scope.spawn(move || {
            shared_fixture.registry.unregister(released_id).unwrap();
            reopened.send(shared_fixture.admit().workspace_id).unwrap();
        });
        let interleaved = reopened_rx
            .recv_timeout(std::time::Duration::from_millis(200))
            .is_ok();
        release.send(()).unwrap();
        let (revoked, released_in_time) = revocation.join().unwrap();
        let replacement = reopened_rx
            .recv_timeout(DEADLINE)
            .expect("the release never completed after the revocation");
        assert!(!interleaved);
        (revoked, released_in_time, replacement)
    });

    assert!(released_in_time);
    let revoked = revoked.unwrap();
    assert_eq!(revoked.descriptor.workspace_id, target.workspace_id);
    assert_ne!(replacement, target.workspace_id);
    assert_eq!(revoked.revoked_roots, vec![root]);
    assert!(!fixture.trusted());
}

#[test]
fn revocation_removes_the_exact_opened_record_and_the_record_admission_reads() {
    for name in ["trailing space ", " leading space", "back\\slash", "plain"] {
        let fixture = Fixture::new();
        let directory = fixture.root.join(name);
        fs::create_dir_all(&directory).unwrap();
        let registration = fixture.registry.register_with_receipt(&directory).unwrap();
        let exact = registration
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .into_owned();
        let target = OpenedProjectTrustRevocationTarget {
            workspace_id: registration.receipt.workspace_id.clone(),
            admission_token: registration.receipt.admission_token,
            canonical_root_path: exact.clone(),
        };
        let admitted = {
            let mut service = fixture.service.lock().unwrap();
            assert!(service.grant_opened_canonical_root(&exact).unwrap().trusted);
            service.set(&exact, true).unwrap().root_path
        };
        let launch = {
            let service = fixture.service.lock().unwrap();
            service.reserve_launch(&service.snapshot(&exact)).unwrap()
        };

        let lease = revocation_lease(&fixture.registry, &target).unwrap();
        let busy = revoke_lease(&lease, |root| revoke_in(&fixture, root))
            .err()
            .unwrap();
        assert_eq!(busy.kind(), io::ErrorKind::WouldBlock, "{name}");
        {
            let service = fixture.service.lock().unwrap();
            assert!(service.snapshot_canonical(&exact).trusted, "{name}");
            assert!(service.snapshot_canonical(&admitted).trusted, "{name}");
        }
        drop(launch);
        let revoked = revoke_lease(&lease, |root| revoke_in(&fixture, root)).unwrap();

        assert_eq!(revoked.revoked_roots[0], exact, "{name}");
        assert!(revoked.revoked_roots.contains(&admitted), "{name}");
        let reloaded = WorkspaceTrustService::load(fixture.root.join("trust.json")).unwrap();
        assert!(!reloaded.snapshot_canonical(&exact).trusted, "{name}");
        assert!(!reloaded.snapshot_canonical(&admitted).trusted, "{name}");
        assert!(!reloaded.get(&exact).trusted, "{name}");
    }
}
