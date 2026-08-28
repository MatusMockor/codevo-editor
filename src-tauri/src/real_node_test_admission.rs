use std::sync::{Mutex, MutexGuard, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

const ADMISSION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const RETRY_INTERVAL: Duration = Duration::from_millis(20);
#[cfg(unix)]
const CONTENTION_NONCE_ENV: &str = "CODEVO_REAL_NODE_ADMISSION_CONTENTION_NONCE";

static REAL_NODE_TEST_ADMISSION: Mutex<()> = Mutex::new(());

/// Serializes real Node inspector tests that otherwise compete for process and
/// runtime resources inside and across libtest processes.
///
/// The wait is deliberately bounded so a leaked guard cannot hang the suite.
/// Recovering a poisoned mutex is safe because the mutex protects no mutable
/// test state: ownership of the guard is the complete in-process capability.
pub(crate) fn acquire() -> RealNodeTestAdmission {
    let deadline = Instant::now() + ADMISSION_TIMEOUT;
    let thread_guard = acquire_thread_guard(deadline);
    let process_guard = ProcessAdmission::acquire(deadline);
    RealNodeTestAdmission {
        _process_guard: process_guard,
        _thread_guard: thread_guard,
    }
}

fn acquire_thread_guard(deadline: Instant) -> MutexGuard<'static, ()> {
    loop {
        match REAL_NODE_TEST_ADMISSION.try_lock() {
            Ok(guard) => return guard,
            Err(TryLockError::Poisoned(error)) => return error.into_inner(),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                thread::sleep(RETRY_INTERVAL);
            }
            Err(TryLockError::WouldBlock) => {
                panic!("timed out waiting for in-process real Node test admission");
            }
        }
    }
}

pub(crate) struct RealNodeTestAdmission {
    _process_guard: ProcessAdmission,
    _thread_guard: MutexGuard<'static, ()>,
}

#[cfg(unix)]
struct ProcessAdmission {
    // This lock coordinates cooperative same-EUID Cargo test processes. The
    // private namespace and post-lock identity checks reject accidental or
    // pre-existing path substitution. A malicious same-EUID process that
    // mutates the namespace after verification is outside the test harness
    // threat model. The directory and lock file are therefore never cleaned
    // up while tests may be running.
    _lock_file: std::fs::File,
}

#[cfg(unix)]
impl ProcessAdmission {
    fn acquire(deadline: Instant) -> Self {
        use std::ffi::CString;
        use std::fs::OpenOptions;
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::fs::OpenOptionsExt;

        const LOCK_NAME: &[u8] = b"exclusive.lock";

        let directory_path = admission_directory_path();
        create_private_directory(&directory_path);
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&directory_path)
            .unwrap_or_else(|error| {
                panic!("unable to open private real Node test admission directory: {error}")
            });
        let directory_metadata = directory.metadata().unwrap_or_else(|error| {
            panic!("unable to inspect real Node test admission directory: {error}")
        });
        validate_private_directory(&directory_metadata);
        verify_cloexec(directory.as_raw_fd(), "admission directory");

        let lock_name = CString::new(LOCK_NAME).expect("static lock filename");
        let lock_fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                lock_name.as_ptr(),
                libc::O_CLOEXEC | libc::O_CREAT | libc::O_NOFOLLOW | libc::O_RDWR,
                0o600,
            )
        };
        if lock_fd < 0 {
            panic!(
                "unable to open real Node test admission lock: {}",
                std::io::Error::last_os_error()
            );
        }
        let lock_file = unsafe { std::fs::File::from_raw_fd(lock_fd) };
        let initial_lock_metadata = lock_file.metadata().unwrap_or_else(|error| {
            panic!("unable to inspect real Node test admission lock: {error}")
        });
        validate_lock_file(&initial_lock_metadata);
        verify_cloexec(lock_file.as_raw_fd(), "admission lock");

        let mut contention_marker_published = false;
        loop {
            let result =
                unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            let contended = matches!(
                error.raw_os_error(),
                Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN
            );
            if contended && Instant::now() < deadline {
                if !contention_marker_published {
                    publish_contention_marker();
                    contention_marker_published = true;
                }
                thread::sleep(RETRY_INTERVAL);
                continue;
            }
            if contended {
                panic!("timed out waiting for cross-process real Node test admission");
            }
            if error.kind() == std::io::ErrorKind::Interrupted && Instant::now() < deadline {
                continue;
            }
            panic!("unable to lock real Node test admission file: {error}");
        }

        verify_locked_identity(
            &directory_path,
            &directory,
            &directory_metadata,
            &lock_file,
            &initial_lock_metadata,
        );
        Self {
            _lock_file: lock_file,
        }
    }
}

#[cfg(unix)]
fn publish_contention_marker() {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let Some(nonce) = std::env::var_os(CONTENTION_NONCE_ENV) else {
        return;
    };
    let marker = contention_marker_path(&nonce);
    let mut marker_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(marker)
        .expect("create cross-process real Node admission contention marker");
    marker_file
        .write_all(b"contended")
        .expect("publish cross-process real Node admission contention");
}

#[cfg(unix)]
fn admission_directory_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("codevo-real-node-test-admission-{}", unsafe {
        libc::geteuid()
    }))
}

#[cfg(unix)]
fn contention_marker_path(nonce: &std::ffi::OsStr) -> std::path::PathBuf {
    let nonce = nonce
        .to_str()
        .filter(|value| {
            value.len() == 32
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .unwrap_or_else(|| panic!("invalid real Node admission contention nonce"));
    admission_directory_path().join(format!("contention-{nonce}.marker"))
}

#[cfg(unix)]
fn create_private_directory(path: &std::path::Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())
        .unwrap_or_else(|_| panic!("real Node test admission path contains NUL"));
    let result = unsafe { libc::mkdir(path.as_ptr(), 0o700) };
    if result == 0 {
        return;
    }
    let error = std::io::Error::last_os_error();
    if error.kind() != std::io::ErrorKind::AlreadyExists {
        panic!("unable to create private real Node test admission directory: {error}");
    }
}

#[cfg(unix)]
fn validate_private_directory(metadata: &std::fs::Metadata) {
    use std::os::unix::fs::MetadataExt;

    assert!(
        metadata.is_dir(),
        "real Node test admission directory is not a directory"
    );
    assert_eq!(
        metadata.uid(),
        unsafe { libc::geteuid() },
        "real Node test admission directory has a foreign owner"
    );
    assert_eq!(
        metadata.mode() & 0o777,
        0o700,
        "real Node test admission directory is not private"
    );
}

#[cfg(unix)]
fn validate_lock_file(metadata: &std::fs::Metadata) {
    use std::os::unix::fs::MetadataExt;

    assert!(
        metadata.is_file(),
        "real Node test admission lock is not a regular file"
    );
    assert_eq!(
        metadata.uid(),
        unsafe { libc::geteuid() },
        "real Node test admission lock has a foreign owner"
    );
    assert_eq!(
        metadata.nlink(),
        1,
        "real Node test admission lock must have exactly one link"
    );
    assert_eq!(
        metadata.mode() & 0o777,
        0o600,
        "real Node test admission lock has unsafe permissions"
    );
}

#[cfg(unix)]
fn verify_cloexec(descriptor: std::os::fd::RawFd, label: &str) {
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    assert!(
        flags >= 0 && flags & libc::FD_CLOEXEC != 0,
        "real Node test {label} is not close-on-exec"
    );
}

#[cfg(unix)]
fn verify_locked_identity(
    directory_path: &std::path::Path,
    directory: &std::fs::File,
    initial_directory: &std::fs::Metadata,
    lock_file: &std::fs::File,
    initial_lock: &std::fs::Metadata,
) {
    let locked_directory = directory
        .metadata()
        .expect("inspect locked admission directory");
    let path_directory =
        std::fs::symlink_metadata(directory_path).expect("revalidate admission directory path");
    validate_private_directory(&locked_directory);
    validate_private_directory(&path_directory);
    assert_same_identity(
        initial_directory,
        &locked_directory,
        "admission directory descriptor changed",
    );
    assert_same_identity(
        &locked_directory,
        &path_directory,
        "admission directory path was replaced",
    );

    let locked_file = lock_file.metadata().expect("inspect locked admission file");
    let path_file = std::fs::symlink_metadata(directory_path.join("exclusive.lock"))
        .expect("revalidate admission lock path");
    validate_lock_file(&locked_file);
    validate_lock_file(&path_file);
    assert_same_identity(
        initial_lock,
        &locked_file,
        "admission lock descriptor changed",
    );
    assert_same_identity(&locked_file, &path_file, "admission lock path was replaced");
}

#[cfg(unix)]
fn assert_same_identity(expected: &std::fs::Metadata, actual: &std::fs::Metadata, message: &str) {
    use std::os::unix::fs::MetadataExt;

    assert_eq!(
        (actual.dev(), actual.ino()),
        (expected.dev(), expected.ino()),
        "{message}"
    );
}

#[cfg(not(unix))]
struct ProcessAdmission;

#[cfg(not(unix))]
impl ProcessAdmission {
    fn acquire(_deadline: Instant) -> Self {
        Self
    }
}

#[cfg(test)]
mod tests {
    use super::acquire;
    #[cfg(unix)]
    use super::{
        assert_same_identity, contention_marker_path, validate_lock_file,
        validate_private_directory, ProcessAdmission, ADMISSION_TIMEOUT, CONTENTION_NONCE_ENV,
    };
    #[cfg(unix)]
    use std::path::{Path, PathBuf};
    #[cfg(unix)]
    use std::process::{Child, Command, Stdio};
    #[cfg(unix)]
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    #[test]
    fn panic_releases_admission_and_poisoned_lock_is_recoverable() {
        let panicked = thread::spawn(|| {
            let _admission = acquire();
            panic!("exercise real Node test admission unwind");
        })
        .join();
        assert!(panicked.is_err());

        let _recovered = acquire();
    }

    #[cfg(unix)]
    #[test]
    fn cross_process_contender_waits_for_release_then_acquires() {
        let admission = acquire();
        let nonce = subprocess_nonce();
        let marker = contention_marker_path(nonce.as_ref());
        let _ = std::fs::remove_file(&marker);
        let mut child = ChildCleanup {
            child: Command::new(std::env::current_exe().expect("current libtest executable"))
                .args([
                    "--exact",
                    "debug_node_process::real_node_test_admission::tests::cross_process_helper_acquires_admission",
                ])
                .env(CONTENTION_NONCE_ENV, &nonce)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn real Node admission contender"),
            marker,
        };

        wait_for_marker(&child.marker);
        assert!(
            child
                .child
                .try_wait()
                .expect("inspect blocked admission contender")
                .is_none(),
            "cross-process contender entered while the parent still held admission"
        );

        drop(admission);
        let status = wait_for_child(&mut child.child);
        assert!(status.success(), "admission contender failed: {status}");
    }

    #[cfg(unix)]
    #[test]
    fn cross_process_helper_acquires_admission() {
        if std::env::var_os(CONTENTION_NONCE_ENV).is_none() {
            return;
        }
        let _admission = acquire();
    }

    #[cfg(unix)]
    #[test]
    fn contention_nonce_rejects_path_injection_and_noncanonical_values() {
        for invalid in [
            "../00000000000000000000000000000",
            "0000000000000000000000000000000/",
            "0000000000000000000000000000000A",
            "0000000000000000000000000000000g",
            "short",
        ] {
            assert!(
                std::panic::catch_unwind(|| contention_marker_path(invalid.as_ref())).is_err(),
                "accepted invalid contention nonce: {invalid}"
            );
        }

        let valid = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            contention_marker_path(valid.as_ref()),
            super::admission_directory_path().join(format!("contention-{valid}.marker"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn lock_validators_reject_unsafe_type_mode_links_and_identity() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = TestFixture::new();
        let regular = fixture.path.join("regular");
        std::fs::write(&regular, b"lock").expect("create validation fixture");
        std::fs::set_permissions(&regular, std::fs::Permissions::from_mode(0o600))
            .expect("set safe fixture mode");
        validate_lock_file(&regular.metadata().expect("inspect regular fixture"));

        let wrong_mode = fixture.path.join("wrong-mode");
        std::fs::write(&wrong_mode, b"lock").expect("create wrong-mode fixture");
        std::fs::set_permissions(&wrong_mode, std::fs::Permissions::from_mode(0o644))
            .expect("set unsafe fixture mode");
        assert_panics(|| {
            validate_lock_file(&wrong_mode.metadata().expect("inspect wrong-mode fixture"));
        });
        assert_panics(|| {
            validate_lock_file(&fixture.path.metadata().expect("inspect directory fixture"));
        });

        let hardlink = fixture.path.join("hardlink");
        std::fs::hard_link(&regular, &hardlink).expect("create hardlink fixture");
        assert_panics(|| {
            validate_lock_file(&regular.metadata().expect("inspect hardlinked fixture"));
        });

        let other = fixture.path.join("other");
        std::fs::write(&other, b"other").expect("create identity fixture");
        assert_panics(|| {
            assert_same_identity(
                &regular.metadata().expect("inspect first identity"),
                &other.metadata().expect("inspect second identity"),
                "fixture identity mismatch",
            );
        });

        std::fs::set_permissions(&fixture.path, std::fs::Permissions::from_mode(0o755))
            .expect("set unsafe directory mode");
        assert_panics(|| {
            validate_private_directory(&fixture.path.metadata().expect("inspect unsafe directory"));
        });
    }

    #[cfg(unix)]
    #[test]
    fn expired_process_deadline_fails_closed_under_contention() {
        let held = ProcessAdmission::acquire(Instant::now() + ADMISSION_TIMEOUT);
        assert_panics(|| {
            let _unexpected = ProcessAdmission::acquire(Instant::now());
        });
        drop(held);
    }

    #[cfg(unix)]
    fn subprocess_nonce() -> String {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        format!(
            "{:016x}{:016x}",
            u64::from(std::process::id()),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[cfg(unix)]
    fn wait_for_marker(marker: &Path) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !marker.is_file() {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for admission contender to observe lock contention"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn wait_for_child(child: &mut Child) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match child.try_wait().expect("inspect admission contender") {
                Some(status) => return status,
                None if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                None => panic!("timed out waiting for admission contender to finish"),
            }
        }
    }

    #[cfg(unix)]
    fn assert_panics(action: impl FnOnce()) {
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(action)).is_err());
    }

    #[cfg(unix)]
    struct TestFixture {
        path: PathBuf,
    }

    #[cfg(unix)]
    impl TestFixture {
        fn new() -> Self {
            static SEQUENCE: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "codevo-real-node-admission-validation-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).expect("create validation fixture directory");
            Self { path }
        }
    }

    #[cfg(unix)]
    impl Drop for TestFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[cfg(unix)]
    struct ChildCleanup {
        child: Child,
        marker: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for ChildCleanup {
        fn drop(&mut self) {
            if self.child.try_wait().ok().flatten().is_none() {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
            let _ = std::fs::remove_file(&self.marker);
        }
    }
}
