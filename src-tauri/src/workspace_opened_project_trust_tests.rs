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
