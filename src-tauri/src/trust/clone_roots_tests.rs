use super::revoked_roots::MAX_REVOKED_ROOTS;
use super::{prune_missing_clone_roots, WorkspaceTrustService, WORKSPACE_TRUST_REVOKED_REFUSAL};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

fn create_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("{prefix}-{nanos}"));
    fs::create_dir_all(&path).expect("create temp dir");
    path.canonicalize().expect("canonical temp dir")
}

fn persisted(storage: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(storage).expect("read trust")).expect("trust json")
}

fn assert_refused(service: &mut WorkspaceTrustService, root: &str) {
    let refusal = service
        .grant_opened_canonical_root(root)
        .expect_err("clone root must be refused");
    assert_eq!(refusal.kind(), ErrorKind::PermissionDenied, "{root}");
    assert_eq!(refusal.to_string(), WORKSPACE_TRUST_REVOKED_REFUSAL);
}

fn block_storage(service: &mut WorkspaceTrustService, root: &Path) {
    let blocker = root.join("blocked-parent");
    fs::write(&blocker, "not a directory").expect("write blocker");
    service.storage_path = blocker.join("trust.json");
}

#[test]
fn a_cloned_root_stays_refused_after_many_later_clones_and_a_reload() {
    let root = create_temp_dir("trust-clone-cap");
    let storage = root.join("trust.json");
    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    for index in 0..300 {
        assert!(
            !service
                .revoke_clone_canonical_root(&format!("/clones/{index:04}"))
                .unwrap()
                .trusted
        );
    }
    drop(service);

    let file = persisted(&storage);
    assert_eq!(
        file["revokedRoots"].as_array().unwrap().len(),
        MAX_REVOKED_ROOTS
    );
    assert_eq!(file["cloneRoots"].as_array().unwrap().len(), 300);
    let mut reloaded = WorkspaceTrustService::load(storage).unwrap();
    assert_refused(&mut reloaded, "/clones/0000");
    assert_refused(&mut reloaded, "/clones/0299");
    assert!(!reloaded.get("/clones/0000").trusted);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_explicit_grant_allows_the_clone_root_and_clears_its_mark() {
    let root = create_temp_dir("trust-clone-grant");
    let storage = root.join("trust.json");
    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    service
        .revoke_clone_canonical_root("/clones/first")
        .unwrap();
    for index in 0..300 {
        service
            .revoke_clone_canonical_root(&format!("/clones/{index:04}"))
            .unwrap();
    }
    assert_refused(&mut service, "/clones/first");

    assert!(service.set("/clones/first", true).unwrap().trusted);
    let clones = persisted(&storage)["cloneRoots"].clone();
    assert!(!clones
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry == "/clones/first"));
    assert!(
        service
            .grant_opened_canonical_root("/clones/first")
            .unwrap()
            .trusted
    );
    assert!(!service.set("/clones/first", false).unwrap().trusted);
    for index in 300..600 {
        service
            .revoke_canonical_root(&format!("/manual/{index:04}"))
            .unwrap();
    }
    assert!(
        service
            .grant_opened_canonical_root("/clones/first")
            .unwrap()
            .trusted
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn pruning_forgets_only_clone_roots_whose_folder_is_gone() {
    let root = create_temp_dir("trust-clone-prune");
    let storage = root.join("trust.json");
    let kept = root.join("kept");
    let gone = root.join("gone");
    fs::create_dir(&kept).unwrap();
    fs::create_dir(&gone).unwrap();
    let kept = kept.to_str().unwrap().to_owned();
    let gone_path = gone.to_str().unwrap().to_owned();
    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    service.revoke_clone_canonical_root(&kept).unwrap();
    service.revoke_clone_canonical_root(&gone_path).unwrap();
    fs::remove_dir(&gone).unwrap();
    let trust = Mutex::new(service);

    assert_eq!(prune_missing_clone_roots(&trust).unwrap(), 1);
    assert_eq!(persisted(&storage)["cloneRoots"], serde_json::json!([kept]));
    let mut service = trust.into_inner().unwrap();
    assert_refused(&mut service, &kept);
    assert_eq!(
        persisted(&storage)["revokedRoots"],
        serde_json::json!([kept, gone_path])
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_clone_marked_again_during_pruning_is_not_forgotten() {
    let root = create_temp_dir("trust-clone-prune-race");
    let storage = root.join("trust.json");
    let clone = root.join("clone").to_str().unwrap().to_owned();
    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    service.revoke_clone_canonical_root(&clone).unwrap();

    let batch = service.clone_roots_prune_batch();
    let missing = batch.missing_roots();
    assert_eq!(missing.as_slice(), std::slice::from_ref(&clone));
    service.revoke_clone_canonical_root(&clone).unwrap();

    assert_eq!(service.forget_clone_roots(&batch, missing).unwrap(), 0);
    assert_eq!(
        persisted(&storage)["cloneRoots"],
        serde_json::json!([clone])
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_saves_roll_back_clone_marks_exactly() {
    let root = create_temp_dir("trust-clone-rollback");
    let storage = root.join("trust.json");
    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    service.revoke_clone_canonical_root("/clones/kept").unwrap();
    block_storage(&mut service, &root);

    assert!(service.revoke_clone_canonical_root("/clones/new").is_err());
    let not_marked = service
        .grant_opened_canonical_root("/clones/new")
        .unwrap_err();
    assert_ne!(not_marked.kind(), ErrorKind::PermissionDenied);

    assert!(service.set("/clones/kept", true).is_err());
    assert!(!service.get("/clones/kept").trusted);
    assert_refused(&mut service, "/clones/kept");

    let batch = service.clone_roots_prune_batch();
    assert!(service
        .forget_clone_roots(&batch, vec!["/clones/kept".to_owned()])
        .is_err());

    service.storage_path = storage.clone();
    service.revoke_canonical_root("/other").unwrap();
    let file = persisted(&storage);
    assert_eq!(file["cloneRoots"], serde_json::json!(["/clones/kept"]));
    assert_eq!(
        file["revokedRoots"],
        serde_json::json!(["/clones/kept", "/other"])
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_legacy_file_without_clone_roots_loads() {
    let root = create_temp_dir("trust-clone-legacy");
    let storage = root.join("trust.json");
    fs::write(
        &storage,
        r#"{"trustedRoots":["/trusted"],"revokedRoots":["/revoked"]}"#,
    )
    .unwrap();

    let mut service = WorkspaceTrustService::load(storage.clone()).unwrap();
    assert!(service.get("/trusted").trusted);
    assert_refused(&mut service, "/revoked");
    assert!(service.grant_opened_canonical_root("/new").unwrap().trusted);
    assert_eq!(persisted(&storage)["cloneRoots"], serde_json::json!([]));
    fs::remove_dir_all(root).unwrap();
}
