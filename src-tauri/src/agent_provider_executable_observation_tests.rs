use super::*;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::AtomicU64;

static NONCE: AtomicU64 = AtomicU64::new(0);

fn fixture() -> PathBuf {
    let path = env::temp_dir().join(format!(
        "codevo-provider-observation-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    fs::write(&path, vec![42_u8; 65_536]).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn mutate_restoring_mtime(path: &Path) {
    let metadata = fs::metadata(path).unwrap();
    let mut file = fs::File::options().write(true).open(path).unwrap();
    file.write_all(&[43]).unwrap();
    file.set_times(fs::FileTimes::new().set_modified(metadata.modified().unwrap()))
        .unwrap();
    assert_eq!(fs::metadata(path).unwrap().len(), metadata.len());
    assert_eq!(
        fs::metadata(path).unwrap().modified().unwrap(),
        metadata.modified().unwrap()
    );
}

#[test]
fn observations_do_not_hash_and_exact_validation_hashes_once() {
    let path = fixture();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    take_executable_digest_work();
    for _ in 0..5 {
        assert!(identity.is_current_for_observation());
    }
    assert_eq!(take_executable_digest_work(), (0, 0));
    assert!(identity.is_current_for_spawn());
    assert_eq!(take_executable_digest_work(), (1, identity.size_bytes));
    fs::remove_file(path).unwrap();
}

#[test]
fn observation_rejects_same_size_mutation_with_restored_mtime() {
    let path = fixture();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    mutate_restoring_mtime(&path);
    assert!(!identity.is_current_for_observation());
    fs::remove_file(path).unwrap();
}

#[test]
fn observation_rejects_permissions_and_replaced_or_deleted_path() {
    let path = fixture();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(!identity.is_current_for_observation());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    let retained = path.with_extension("retained");
    fs::rename(&path, &retained).unwrap();
    fs::copy(&retained, &path).unwrap();
    assert!(!identity.is_current_for_observation());
    fs::remove_file(&path).unwrap();
    assert!(!identity.is_current_for_observation());
    std::os::unix::fs::symlink(&retained, &path).unwrap();
    assert!(!identity.is_current_for_observation());
    fs::remove_file(path).unwrap();
    fs::remove_file(retained).unwrap();
}

#[test]
fn observation_rejects_changed_script_interpreter() {
    let interpreter = fixture();
    let script = fixture();
    fs::write(&script, format!("#!{}\nexit 0\n", interpreter.display())).unwrap();
    let identity = executable_identity(script.to_str().unwrap()).unwrap();
    assert!(identity.is_current_for_observation());
    mutate_restoring_mtime(&interpreter);
    assert!(!identity.is_current_for_observation());
    fs::remove_file(script).unwrap();
    fs::remove_file(interpreter).unwrap();
}

#[test]
fn exact_validation_checks_content_even_when_metadata_matches() {
    let path = fixture();
    let mut identity = executable_identity(path.to_str().unwrap()).unwrap();
    mutate_restoring_mtime(&path);
    identity.observation = Arc::new(ExecutableObservation::capture(
        &fs::metadata(&path).unwrap(),
    ));
    assert!(identity.is_current_for_observation());
    assert!(!identity.is_current_for_spawn());
    fs::remove_file(path).unwrap();
}

#[test]
fn spawn_rejects_mutation_in_authorization_callback() {
    let path = fixture();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    let mut bound = identity.bound_command().unwrap();
    assert!(matches!(
        bound.spawn_cancellable(
            || false,
            Some(|| {
                mutate_restoring_mtime(&path);
                true
            })
        ),
        Err(BoundExecutableSpawnFailure::IdentityChanged)
    ));
    fs::remove_file(path).unwrap();
}

#[test]
fn exact_validation_rejects_mutation_after_a_digest_chunk() {
    let path = fixture();
    let identity = executable_identity(path.to_str().unwrap()).unwrap();
    let calls = AtomicUsize::new(0);
    assert!(!identity.exact_shallow_is_current_with(|| {
        if calls.fetch_add(1, Ordering::SeqCst) == 1 {
            mutate_restoring_mtime(&path);
        }
        false
    }));
    assert!(calls.load(Ordering::SeqCst) >= 2);
    fs::remove_file(path).unwrap();
}

#[test]
fn ordinary_spawn_hashes_once_and_authorized_spawn_hashes_both_sides() {
    let identity = executable_identity("/usr/bin/true").unwrap();
    let mut ordinary = bound_command(&identity).unwrap();
    take_executable_digest_work();
    assert!(ordinary.spawn().unwrap().wait().unwrap().success());
    assert_eq!(take_executable_digest_work(), (1, identity.size_bytes));
    let mut authorized = bound_command(&identity).unwrap();
    let called = AtomicUsize::new(0);
    assert!(authorized
        .spawn_cancellable(
            || false,
            Some(|| {
                called.fetch_add(1, Ordering::SeqCst);
                true
            })
        )
        .unwrap()
        .wait()
        .unwrap()
        .success());
    assert_eq!(called.load(Ordering::SeqCst), 1);
    assert_eq!(take_executable_digest_work(), (2, identity.size_bytes * 2));
    let mut denied = bound_command(&identity).unwrap();
    assert!(matches!(
        denied.spawn_cancellable(|| false, Some(|| false)),
        Err(BoundExecutableSpawnFailure::IdentityChanged)
    ));
    assert_eq!(take_executable_digest_work(), (1, identity.size_bytes));
}
