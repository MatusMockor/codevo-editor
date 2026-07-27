use super::watch_generation::TargetGeneration;
use crate::workspace_registry::{
    open_file_relative_to, opened_regular_file_path, opened_root_path,
};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::os::fd::{AsRawFd, FromRawFd};

/// Exact native-watch entry identity retained for the complete logical debug
/// session. The CDP URL is derived once from the opened descriptor rather than
/// from a later pathname lookup.
#[derive(Debug)]
pub(crate) struct NativeNodeWatchEntryAuthority {
    canonical_root: PathBuf,
    canonical_path: PathBuf,
    relative_path: PathBuf,
    retained_root: File,
    _initial_entry: File,
    latest_generation: Mutex<Option<u64>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExactNativeNodeWatchEntryUrl(String);

#[derive(Debug)]
pub(crate) struct NativeNodeWatchEntryGeneration {
    authority: Arc<NativeNodeWatchEntryAuthority>,
    generation: u64,
    entry_url: ExactNativeNodeWatchEntryUrl,
    retained_entry: File,
    root_identity: StableFileIdentity,
    root_replacement_receipt: RootReplacementReceipt,
    entry_identity: FileIdentity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StableFileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

impl ExactNativeNodeWatchEntryUrl {
    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl NativeNodeWatchEntryAuthority {
    pub(crate) fn from_retained(
        canonical_root: &Path,
        expected_canonical_path: &Path,
        retained_root: File,
        retained_entry: File,
    ) -> Result<Self, String> {
        if !canonical_root.is_absolute() || !expected_canonical_path.is_absolute() {
            return Err("Native Node watch entrypoint authority must be canonical.".to_string());
        }
        let relative = expected_canonical_path
            .strip_prefix(canonical_root)
            .map_err(|_| "Native Node watch entrypoint escaped its workspace.".to_string())?;
        if relative.as_os_str().is_empty() {
            return Err("Native Node watch entrypoint must be a regular file.".to_string());
        }
        let descriptor_path = opened_regular_file_path(&retained_entry).map_err(|_| {
            "Native Node watch entrypoint identity changed during startup.".to_string()
        })?;
        if descriptor_path != expected_canonical_path {
            return Err(
                "Native Node watch entrypoint identity changed during startup.".to_string(),
            );
        }
        exact_file_url(&descriptor_path)?;
        Ok(Self {
            canonical_root: canonical_root.to_path_buf(),
            canonical_path: descriptor_path.clone(),
            relative_path: relative.to_path_buf(),
            retained_root,
            _initial_entry: retained_entry,
            latest_generation: Mutex::new(None),
        })
    }

    pub(crate) fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }

    #[cfg(test)]
    pub(crate) fn canonical_url(&self) -> String {
        exact_file_url(&self.canonical_path).expect("validated canonical entry URL")
    }

    pub(crate) fn prepare_generation(
        self: &Arc<Self>,
        generation: TargetGeneration,
    ) -> Result<NativeNodeWatchEntryGeneration, String> {
        let generation = generation.get();
        let mut latest = self.latest_generation.lock().map_err(|_| {
            "Native Node watch entry generation authority is unavailable.".to_string()
        })?;
        if latest.is_some_and(|latest| generation <= latest) {
            return Err("Native Node watch entry generation is stale.".to_string());
        }
        let root_replacement_receipt = RootReplacementReceipt::prepare(&self.retained_root)?;
        let retained_entry = self.open_current_entry()?;
        let entry_url = ExactNativeNodeWatchEntryUrl(exact_file_url(&self.canonical_path)?);
        let root_identity =
            stable_file_identity(&self.retained_root.metadata().map_err(|_| {
                "Native Node watch workspace identity changed before target activation.".to_string()
            })?)?;
        let entry_identity = file_identity(&retained_entry.metadata().map_err(|_| {
            "Native Node watch entrypoint identity changed before target activation.".to_string()
        })?)?;
        *latest = Some(generation);
        Ok(NativeNodeWatchEntryGeneration {
            authority: Arc::clone(self),
            generation,
            entry_url,
            retained_entry,
            root_identity,
            root_replacement_receipt,
            entry_identity,
        })
    }

    #[cfg(test)]
    pub(crate) fn retained_metadata(&self) -> Result<std::fs::Metadata, std::io::Error> {
        self._initial_entry.metadata()
    }

    fn open_current_entry(&self) -> Result<File, String> {
        if opened_root_path(&self.retained_root).ok().as_deref() != Some(&self.canonical_root) {
            return Err(
                "Native Node watch workspace identity changed before target activation."
                    .to_string(),
            );
        }
        let entry =
            open_file_relative_to(&self.retained_root, &self.relative_path).map_err(|_| {
                "Native Node watch entrypoint identity changed before target activation."
                    .to_string()
            })?;
        if opened_regular_file_path(&entry).ok().as_deref() != Some(&self.canonical_path) {
            return Err(
                "Native Node watch entrypoint identity changed before target activation."
                    .to_string(),
            );
        }
        Ok(entry)
    }
}

impl NativeNodeWatchEntryGeneration {
    pub(crate) fn entry_url(&self) -> ExactNativeNodeWatchEntryUrl {
        self.entry_url.clone()
    }

    pub(crate) fn confirm(&self) -> Result<(), String> {
        let latest = self.authority.latest_generation.lock().map_err(|_| {
            "Native Node watch entry generation authority is unavailable.".to_string()
        })?;
        if *latest != Some(self.generation) {
            return Err("Native Node watch entry generation is stale.".to_string());
        }
        let current = self.authority.open_current_entry()?;
        let root_identity =
            stable_file_identity(&self.authority.retained_root.metadata().map_err(|_| {
                "Native Node watch workspace identity changed before target activation.".to_string()
            })?)?;
        let retained_identity = file_identity(&self.retained_entry.metadata().map_err(|_| {
            "Native Node watch entrypoint identity changed before target activation.".to_string()
        })?)?;
        let current_identity = file_identity(&current.metadata().map_err(|_| {
            "Native Node watch entrypoint identity changed before target activation.".to_string()
        })?)?;
        if root_identity != self.root_identity
            || self.root_replacement_receipt.was_replaced()?
            || retained_identity != self.entry_identity
            || current_identity != self.entry_identity
        {
            return Err(
                "Native Node watch entrypoint identity changed before target activation."
                    .to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Debug)]
struct RootReplacementReceipt {
    proof: RootReplacementProof,
    replacement_observed: Mutex<bool>,
}

impl RootReplacementReceipt {
    fn prepare(root: &File) -> Result<Self, String> {
        Ok(Self {
            proof: RootReplacementProof::prepare(root)?,
            replacement_observed: Mutex::new(false),
        })
    }

    fn was_replaced(&self) -> Result<bool, String> {
        let mut replacement_observed = self.replacement_observed.lock().map_err(|_| {
            "Native Node watch workspace replacement proof is unavailable.".to_string()
        })?;
        if *replacement_observed {
            return Ok(true);
        }
        match self.proof.was_replaced() {
            Ok(false) => Ok(false),
            Ok(true) => {
                *replacement_observed = true;
                Ok(true)
            }
            Err(error) => {
                *replacement_observed = true;
                Err(error)
            }
        }
    }
}

/// Descriptor-backed proof that the workspace root itself was not renamed,
/// deleted, or revoked while a target generation was pending. Directory
/// content writes are deliberately not observed: creating, deleting, or
/// renaming an unrelated child is ordinary workspace churn, not root
/// replacement.
#[cfg(target_os = "macos")]
#[derive(Debug)]
struct RootReplacementProof {
    queue: File,
}

#[cfg(target_os = "macos")]
impl RootReplacementProof {
    fn prepare(root: &File) -> Result<Self, String> {
        let queue_fd = unsafe { libc::kqueue() };
        if queue_fd < 0 {
            return Err(
                "Native Node watch workspace replacement proof is unavailable.".to_string(),
            );
        }
        let queue = unsafe { File::from_raw_fd(queue_fd) };
        let change = libc::kevent {
            ident: root.as_raw_fd() as libc::uintptr_t,
            filter: libc::EVFILT_VNODE,
            flags: libc::EV_ADD | libc::EV_CLEAR,
            fflags: libc::NOTE_DELETE | libc::NOTE_RENAME | libc::NOTE_REVOKE,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let registered = unsafe {
            libc::kevent(
                queue.as_raw_fd(),
                &change,
                1,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
            )
        };
        if registered < 0 {
            return Err(
                "Native Node watch workspace replacement proof is unavailable.".to_string(),
            );
        }
        Ok(Self { queue })
    }

    fn was_replaced(&self) -> Result<bool, String> {
        let mut event = libc::kevent {
            ident: 0,
            filter: 0,
            flags: 0,
            fflags: 0,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let timeout = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        let received = unsafe {
            libc::kevent(
                self.queue.as_raw_fd(),
                std::ptr::null(),
                0,
                &mut event,
                1,
                &timeout,
            )
        };
        if received < 0 {
            return Err(
                "Native Node watch workspace replacement proof is unavailable.".to_string(),
            );
        }
        Ok(received > 0)
    }
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
struct RootReplacementProof {
    inotify: File,
}

#[cfg(target_os = "linux")]
impl RootReplacementProof {
    fn prepare(root: &File) -> Result<Self, String> {
        let inotify_fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) };
        if inotify_fd < 0 {
            return Err(
                "Native Node watch workspace replacement proof is unavailable.".to_string(),
            );
        }
        let inotify = unsafe { File::from_raw_fd(inotify_fd) };
        let descriptor_path = std::ffi::CString::new(format!("/proc/self/fd/{}", root.as_raw_fd()))
            .map_err(|_| {
                "Native Node watch workspace replacement proof is unavailable.".to_string()
            })?;
        let watch = unsafe {
            libc::inotify_add_watch(
                inotify.as_raw_fd(),
                descriptor_path.as_ptr(),
                libc::IN_DELETE_SELF | libc::IN_MOVE_SELF | libc::IN_UNMOUNT,
            )
        };
        if watch < 0 {
            return Err(
                "Native Node watch workspace replacement proof is unavailable.".to_string(),
            );
        }
        Ok(Self { inotify })
    }

    fn was_replaced(&self) -> Result<bool, String> {
        let mut events = [0_u8; 4096];
        let received = unsafe {
            libc::read(
                self.inotify.as_raw_fd(),
                events.as_mut_ptr().cast(),
                events.len(),
            )
        };
        if received > 0 {
            return Ok(true);
        }
        if received == 0 {
            return Ok(false);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(false);
        }
        Err("Native Node watch workspace replacement proof is unavailable.".to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
#[derive(Debug)]
struct RootReplacementProof;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
impl RootReplacementProof {
    fn prepare(_root: &File) -> Result<Self, String> {
        Err(
            "Native Node watch exact root replacement proof is unsupported on this platform."
                .to_string(),
        )
    }

    fn was_replaced(&self) -> Result<bool, String> {
        Err(
            "Native Node watch exact root replacement proof is unsupported on this platform."
                .to_string(),
        )
    }
}

fn exact_file_url(path: &Path) -> Result<String, String> {
    tauri::Url::from_file_path(path)
        .map(Into::into)
        .map_err(|_| "Native Node watch entrypoint has no exact file URL.".to_string())
}

#[cfg(unix)]
fn stable_file_identity(metadata: &std::fs::Metadata) -> Result<StableFileIdentity, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(StableFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn stable_file_identity(_metadata: &std::fs::Metadata) -> Result<StableFileIdentity, String> {
    Err("Native Node watch exact file identity is unsupported on this platform.".to_string())
}

#[cfg(unix)]
fn file_identity(metadata: &std::fs::Metadata) -> Result<FileIdentity, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

#[cfg(not(unix))]
fn file_identity(_metadata: &std::fs::Metadata) -> Result<FileIdentity, String> {
    Err("Native Node watch exact file identity is unsupported on this platform.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: PathBuf,
        entry: PathBuf,
    }

    impl Fixture {
        fn new(entry_name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-watch-entry-authority-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).expect("fixture root");
            let root = root.canonicalize().expect("canonical root");
            let entry = root.join(entry_name);
            fs::write(&entry, "setInterval(() => {}, 1000);\n").expect("fixture entry");
            Self { root, entry }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn derives_an_exact_percent_encoded_url_from_the_retained_descriptor() {
        let fixture = Fixture::new("server #1%?!'().js");
        let authority = NativeNodeWatchEntryAuthority::from_retained(
            &fixture.root,
            &fixture.entry,
            File::open(&fixture.root).expect("root descriptor"),
            File::open(&fixture.entry).expect("entry descriptor"),
        )
        .expect("entry authority");

        assert_eq!(authority.canonical_path(), fixture.entry);
        assert!(authority
            .canonical_url()
            .ends_with("/server%20%231%25%3F!'().js"));
    }

    #[test]
    fn rejects_a_descriptor_for_a_different_file_even_inside_the_workspace() {
        let fixture = Fixture::new("server.js");
        let other = fixture.root.join("other.js");
        fs::write(&other, "console.log('other');\n").expect("other entry");

        assert!(NativeNodeWatchEntryAuthority::from_retained(
            &fixture.root,
            &fixture.entry,
            File::open(&fixture.root).expect("root descriptor"),
            File::open(other).expect("foreign descriptor"),
        )
        .expect_err("descriptor mismatch")
        .contains("identity changed"));
    }

    #[test]
    fn admits_an_atomic_save_as_a_new_exact_target_generation() {
        let fixture = Fixture::new("server.js");
        let authority = NativeNodeWatchEntryAuthority::from_retained(
            &fixture.root,
            &fixture.entry,
            File::open(&fixture.root).expect("root descriptor"),
            File::open(&fixture.entry).expect("entry descriptor"),
        )
        .expect("entry authority");
        let moved = fixture.root.join("admitted.js");
        fs::rename(&fixture.entry, &moved).expect("move admitted entry");
        fs::write(&fixture.entry, "console.log('replacement');\n").expect("replacement entry");

        assert_eq!(
            authority.canonical_url(),
            exact_file_url(&fixture.entry).expect("exact entry URL")
        );
        assert_eq!(
            authority
                .retained_metadata()
                .expect("retained metadata")
                .len(),
            fs::metadata(moved).expect("moved admitted metadata").len()
        );
        let authority = Arc::new(authority);
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("atomic replacement generation");
        assert_eq!(
            generation.entry_url().into_string(),
            authority.canonical_url()
        );
        generation.confirm().expect("replacement receipt");
        assert!(authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect_err("duplicate generation")
            .contains("stale"));
    }

    #[test]
    fn revalidates_the_exact_descriptor_for_each_target_generation() {
        let fixture = Fixture::new("server.js");
        let authority = Arc::new(
            NativeNodeWatchEntryAuthority::from_retained(
                &fixture.root,
                &fixture.entry,
                File::open(&fixture.root).expect("root descriptor"),
                File::open(&fixture.entry).expect("entry descriptor"),
            )
            .expect("entry authority"),
        );

        fs::write(&fixture.entry, "console.log('same inode edit');\n").expect("live edit");
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("same entry identity");
        generation.confirm().expect("same entry confirmation");

        let moved_root = fixture.root.with_extension("moved");
        fs::rename(&fixture.root, &moved_root).expect("move retained root");
        assert!(authority
            .prepare_generation(TargetGeneration::from_value_for_test(2))
            .expect_err("root path drift")
            .contains("identity changed"));
        fs::rename(&moved_root, &fixture.root).expect("restore fixture root");
    }

    #[test]
    fn rejects_entry_a_b_a_during_a_pending_generation_confirmation() {
        let fixture = Fixture::new("server.js");
        let authority = Arc::new(
            NativeNodeWatchEntryAuthority::from_retained(
                &fixture.root,
                &fixture.entry,
                File::open(&fixture.root).expect("root descriptor"),
                File::open(&fixture.entry).expect("entry descriptor"),
            )
            .expect("entry authority"),
        );
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("prepared generation");
        let displaced = fixture.root.join("displaced.js");
        fs::rename(&fixture.entry, &displaced).expect("displace entry");
        fs::write(&fixture.entry, "console.log('replacement');\n").expect("replacement entry");
        fs::remove_file(&fixture.entry).expect("remove replacement");
        fs::rename(&displaced, &fixture.entry).expect("restore original entry");

        assert!(generation
            .confirm()
            .expect_err("mid-generation A-B-A")
            .contains("identity changed"));
    }

    #[test]
    fn rejects_an_atomic_entry_replacement_during_pending_confirmation() {
        let fixture = Fixture::new("server.js");
        let authority = Arc::new(
            NativeNodeWatchEntryAuthority::from_retained(
                &fixture.root,
                &fixture.entry,
                File::open(&fixture.root).expect("root descriptor"),
                File::open(&fixture.entry).expect("entry descriptor"),
            )
            .expect("entry authority"),
        );
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("prepared generation");
        let replacement = fixture.root.join("replacement.js");
        fs::write(&replacement, "console.log('replacement');\n").expect("replacement file");
        fs::rename(&replacement, &fixture.entry).expect("atomic entry replacement");

        assert!(generation
            .confirm()
            .expect_err("mid-generation atomic save")
            .contains("identity changed"));
    }

    #[test]
    fn accepts_unrelated_child_create_delete_and_rename_during_confirmation() {
        let fixture = Fixture::new("server.js");
        let authority = Arc::new(
            NativeNodeWatchEntryAuthority::from_retained(
                &fixture.root,
                &fixture.entry,
                File::open(&fixture.root).expect("root descriptor"),
                File::open(&fixture.entry).expect("entry descriptor"),
            )
            .expect("entry authority"),
        );
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("prepared generation");

        let unrelated = fixture.root.join("unrelated.tmp");
        let renamed = fixture.root.join("renamed.tmp");
        fs::write(&unrelated, "ordinary workspace churn\n").expect("create unrelated child");
        fs::rename(&unrelated, &renamed).expect("rename unrelated child");
        fs::remove_file(&renamed).expect("delete unrelated child");

        generation
            .confirm()
            .expect("unrelated child churn must not replace root authority");
    }

    #[test]
    fn rejects_root_a_b_a_during_a_pending_generation_confirmation() {
        let fixture = Fixture::new("server.js");
        let authority = Arc::new(
            NativeNodeWatchEntryAuthority::from_retained(
                &fixture.root,
                &fixture.entry,
                File::open(&fixture.root).expect("root descriptor"),
                File::open(&fixture.entry).expect("entry descriptor"),
            )
            .expect("entry authority"),
        );
        let generation = authority
            .prepare_generation(TargetGeneration::from_value_for_test(1))
            .expect("prepared generation");
        let moved_root = fixture.root.with_extension("pending-moved");
        fs::rename(&fixture.root, &moved_root).expect("move original root");
        fs::create_dir(&fixture.root).expect("replacement root");
        fs::remove_dir(&fixture.root).expect("remove replacement root");
        fs::rename(&moved_root, &fixture.root).expect("restore original root");

        assert!(generation
            .confirm()
            .expect_err("root A-B-A")
            .contains("identity changed"));
        assert!(generation
            .confirm()
            .expect_err("root A-B-A must remain rejected")
            .contains("identity changed"));
    }

    #[test]
    fn rejects_an_entry_outside_the_canonical_workspace() {
        let workspace = Fixture::new("server.js");
        let outside = Fixture::new("outside.js");

        assert!(NativeNodeWatchEntryAuthority::from_retained(
            &workspace.root,
            &outside.entry,
            File::open(&workspace.root).expect("root descriptor"),
            File::open(&outside.entry).expect("outside descriptor"),
        )
        .expect_err("outside entry")
        .contains("escaped"));
    }
}
