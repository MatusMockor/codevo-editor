#![allow(dead_code)] // Private foundation awaiting a trusted native workspace-open integration.

use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::os::{
    fd::{AsRawFd, FromRawFd},
    unix::ffi::{OsStrExt, OsStringExt},
};
#[cfg(target_os = "macos")]
use std::{collections::HashMap, fs::File, path::Component, sync::Mutex};

#[cfg(target_os = "macos")]
const O_RESOLVE_BENEATH: libc::c_int = 0x0000_1000;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct WorkspaceId(String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnicodeNormalizationPolicy {
    CanonicalDecomposition,
    Preserved,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWorkspaceDescriptor {
    pub workspace_id: WorkspaceId,
    pub selected_root_path: PathBuf,
    pub canonical_root_path: PathBuf,
    pub case_sensitive: Option<bool>,
    pub unicode_normalization_policy: UnicodeNormalizationPolicy,
}

#[cfg(target_os = "macos")]
struct ManagedWorkspace {
    descriptor: ManagedWorkspaceDescriptor,
    root: File,
    #[cfg(test)]
    drop_hook: Option<Box<dyn FnOnce() + Send>>,
}

#[cfg(all(test, target_os = "macos"))]
impl Drop for ManagedWorkspace {
    fn drop(&mut self) {
        if let Some(hook) = self.drop_hook.take() {
            hook();
        }
    }
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    #[cfg(target_os = "macos")]
    workspaces: Mutex<HashMap<WorkspaceId, ManagedWorkspace>>,
    #[cfg(target_os = "macos")]
    operations: Mutex<()>,
}

impl WorkspaceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn register(
        &self,
        selected_root: impl AsRef<Path>,
    ) -> io::Result<ManagedWorkspaceDescriptor> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = selected_root;
            return Err(unsupported_platform());
        }
        #[cfg(target_os = "macos")]
        {
            self.register_macos(selected_root.as_ref(), || Ok(()))
        }
    }

    #[cfg(target_os = "macos")]
    fn register_macos<F>(
        &self,
        selected_root: &Path,
        post_open: F,
    ) -> io::Result<ManagedWorkspaceDescriptor>
    where
        F: FnOnce() -> io::Result<()>,
    {
        // Following the selected root is allowed only here. Every later access starts at this FD.
        let root = open_selected_root(selected_root)?;
        post_open()?;
        let canonical_root_path = opened_root_path(&root)?;
        let descriptor = ManagedWorkspaceDescriptor {
            workspace_id: random_workspace_id()?,
            selected_root_path: selected_root.to_path_buf(),
            canonical_root_path,
            case_sensitive: detect_case_sensitivity(&root),
            unicode_normalization_policy: detect_unicode_policy(&root),
        };
        self.workspaces.lock().map_err(lock_error)?.insert(
            descriptor.workspace_id.clone(),
            ManagedWorkspace {
                descriptor: descriptor.clone(),
                root,
                #[cfg(test)]
                drop_hook: None,
            },
        );
        Ok(descriptor)
    }

    pub fn unregister(&self, workspace_id: &WorkspaceId) -> io::Result<()> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = workspace_id;
            return Err(unsupported_platform());
        }
        #[cfg(target_os = "macos")]
        // Revokes future registry operations. Files already returned or root FDs already cloned
        // by an in-flight open intentionally retain their normal OS-handle lifetime.
        {
            let removed = self
                .workspaces
                .lock()
                .map_err(lock_error)?
                .remove(workspace_id)
                .ok_or_else(unknown_workspace)?;
            drop(removed);
            Ok(())
        }
    }

    pub fn descriptor(&self, workspace_id: &WorkspaceId) -> io::Result<ManagedWorkspaceDescriptor> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = workspace_id;
            return Err(unsupported_platform());
        }
        #[cfg(target_os = "macos")]
        self.workspaces
            .lock()
            .map_err(lock_error)?
            .get(workspace_id)
            .map(|workspace| workspace.descriptor.clone())
            .ok_or_else(unknown_workspace)
    }

    pub fn clear(&self) {
        #[cfg(target_os = "macos")]
        {
            let drained = if let Ok(mut workspaces) = self.workspaces.lock() {
                workspaces.drain().map(|(_, workspace)| workspace).collect()
            } else {
                Vec::new()
            };
            drop(drained);
        }
    }

    /// Opens an existing descendant without following any intermediate or leaf symlink.
    #[cfg(target_os = "macos")]
    pub fn open_descendant(
        &self,
        workspace_id: &WorkspaceId,
        relative_path: &Path,
    ) -> io::Result<File> {
        self.open_descendant_macos(workspace_id, relative_path, || Ok(()))
    }

    pub(crate) fn clone_root(&self, workspace_id: &WorkspaceId) -> io::Result<File> {
        let workspaces = self.workspaces.lock().map_err(lock_error)?;
        workspaces
            .get(workspace_id)
            .ok_or_else(unknown_workspace)?
            .root
            .try_clone()
    }

    pub(crate) fn lock_operations(&self) -> io::Result<std::sync::MutexGuard<'_, ()>> {
        self.operations.lock().map_err(lock_error)
    }

    #[cfg(target_os = "macos")]
    fn open_descendant_macos<F>(
        &self,
        workspace_id: &WorkspaceId,
        relative_path: &Path,
        post_clone: F,
    ) -> io::Result<File>
    where
        F: FnOnce() -> io::Result<()>,
    {
        validate_relative_path(relative_path)?;
        let root = {
            let workspaces = self.workspaces.lock().map_err(lock_error)?;
            let workspace = workspaces.get(workspace_id).ok_or_else(unknown_workspace)?;
            workspace.root.try_clone()?
        };
        post_clone()?;
        open_relative_to(&root, relative_path)
    }
}

#[cfg(target_os = "macos")]
fn random_workspace_id() -> io::Result<WorkspaceId> {
    let mut random = [0_u8; 16];
    if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let token = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(WorkspaceId(format!("ws-{token}")))
}

#[cfg(target_os = "macos")]
fn lock_error<T>(_: std::sync::PoisonError<T>) -> io::Error {
    io::Error::other("workspace registry lock poisoned")
}

#[cfg(target_os = "macos")]
fn unknown_workspace() -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, "unknown or closed workspace id")
}

#[cfg(not(target_os = "macos"))]
fn unsupported_platform() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "managed workspace roots are supported only on macOS",
    )
}

#[cfg(target_os = "macos")]
pub(crate) fn validate_relative_path(path: &Path) -> io::Result<()> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid relative path",
        ));
    }
    for component in path.components() {
        match component {
            Component::Normal(value) if !value.as_encoded_bytes().contains(&0) => {}
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid relative path",
                ))
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_selected_root(path: &Path) -> io::Result<File> {
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}

#[cfg(target_os = "macos")]
fn opened_root_path(root: &File) -> io::Result<PathBuf> {
    let mut opened_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(root.as_raw_fd(), opened_stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let opened_stat = unsafe { opened_stat.assume_init() };
    if opened_stat.st_mode & libc::S_IFMT != libc::S_IFDIR {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root is not a directory",
        ));
    }

    let mut opened_path = vec![0_u8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(root.as_raw_fd(), libc::F_GETPATH, opened_path.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let end = opened_path
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "opened root path is not terminated",
            )
        })?;
    Ok(PathBuf::from(std::ffi::OsString::from_vec(
        opened_path[..end].to_vec(),
    )))
}

#[cfg(target_os = "macos")]
fn open_relative_to(root: &File, path: &Path) -> io::Result<File> {
    open_relative_to_with_hook(root, path, || Ok(()))
}

#[cfg(target_os = "macos")]
fn open_relative_to_with_hook<F>(root: &File, path: &Path, pre_open: F) -> io::Result<File>
where
    F: FnOnce() -> io::Result<()>,
{
    validate_relative_path(path)?;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
    pre_open()?;
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            path.as_ptr(),
            libc::O_RDONLY
                | libc::O_NONBLOCK
                | libc::O_CLOEXEC
                | libc::O_NOFOLLOW_ANY
                | O_RESOLVE_BENEATH,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(file.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { stat.assume_init() }.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace descendant is not a regular file",
        ));
    }
    Ok(file)
}

#[cfg(target_os = "macos")]
fn detect_case_sensitivity(root: &File) -> Option<bool> {
    unsafe {
        *libc::__error() = 0;
        let result = libc::fpathconf(root.as_raw_fd(), libc::_PC_CASE_SENSITIVE);
        if result == -1 {
            None
        } else {
            Some(result == 1)
        }
    }
}

#[cfg(target_os = "macos")]
fn detect_unicode_policy(root: &File) -> UnicodeNormalizationPolicy {
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::fstatfs(root.as_raw_fd(), stats.as_mut_ptr()) } != 0 {
        return UnicodeNormalizationPolicy::Unknown;
    }
    let stats = unsafe { stats.assume_init() };
    let bytes = unsafe { std::ffi::CStr::from_ptr(stats.f_fstypename.as_ptr()) }.to_bytes();
    match bytes {
        b"hfs" => UnicodeNormalizationPolicy::CanonicalDecomposition,
        b"apfs" => UnicodeNormalizationPolicy::Preserved,
        _ => UnicodeNormalizationPolicy::Unknown,
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::{
        fs,
        io::Read,
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc,
        },
        thread,
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "mockor-registry-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn isolates_workspaces_and_allows_same_root_with_separate_ids() {
        let registry = WorkspaceRegistry::new();
        let a = temp_root("a");
        let b = temp_root("b");
        fs::write(a.join("value"), "a").unwrap();
        fs::write(b.join("value"), "b").unwrap();
        let a1 = registry.register(&a).unwrap();
        let a2 = registry.register(&a).unwrap();
        let b = registry.register(&b).unwrap();
        assert_ne!(a1.workspace_id, a2.workspace_id);
        let mut value = String::new();
        registry
            .open_descendant(&b.workspace_id, Path::new("value"))
            .unwrap()
            .read_to_string(&mut value)
            .unwrap();
        assert_eq!(value, "b");
        assert_eq!(
            registry
                .descriptor(&a1.workspace_id)
                .unwrap()
                .canonical_root_path,
            fs::canonicalize(a).unwrap()
        );
    }

    #[test]
    fn closed_and_unknown_ids_are_rejected() {
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(temp_root("closed")).unwrap();
        registry.unregister(&descriptor.workspace_id).unwrap();
        assert_eq!(
            registry
                .descriptor(&descriptor.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        let random_id = random_workspace_id().unwrap();
        assert_ne!(random_id, descriptor.workspace_id);
        assert_eq!(
            registry.descriptor(&random_id).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        assert_eq!(
            registry
                .unregister(&descriptor.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }

    #[test]
    fn opened_root_path_is_derived_from_the_retained_fd() {
        let root = temp_root("identity").canonicalize().unwrap();
        let root_fd = open_selected_root(&root).unwrap();
        assert_eq!(opened_root_path(&root_fd).unwrap(), root);
    }

    #[test]
    fn selected_path_swap_after_open_keeps_original_fd_as_source_of_truth() {
        let registry = WorkspaceRegistry::new();
        let selected = temp_root("swap-original").canonicalize().unwrap();
        let replacement = temp_root("swap-replacement").canonicalize().unwrap();
        let displaced = selected.with_extension("displaced");
        fs::write(selected.join("identity"), "original").unwrap();
        fs::write(replacement.join("identity"), "replacement").unwrap();

        let descriptor = registry
            .register_macos(&selected, || {
                fs::rename(&selected, &displaced)?;
                fs::rename(&replacement, &selected)?;
                Ok(())
            })
            .unwrap();

        assert_eq!(
            descriptor.canonical_root_path,
            displaced.canonicalize().unwrap()
        );
        let mut identity = String::new();
        registry
            .open_descendant(&descriptor.workspace_id, Path::new("identity"))
            .unwrap()
            .read_to_string(&mut identity)
            .unwrap();
        assert_eq!(identity, "original");
    }

    #[test]
    fn descriptor_policy_is_probed_from_opened_temp_mount() {
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(temp_root("policy")).unwrap();
        let entries = registry.workspaces.lock().unwrap();
        let root = &entries[&descriptor.workspace_id].root;
        assert_eq!(descriptor.case_sensitive, detect_case_sensitivity(root));
        assert_eq!(
            descriptor.unicode_normalization_policy,
            detect_unicode_policy(root)
        );
    }

    #[test]
    fn fifo_leaf_is_rejected_without_blocking() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("fifo");
        let fifo = root.join("pipe");
        let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
        let descriptor = registry.register(&root).unwrap();
        assert_eq!(
            registry
                .open_descendant(&descriptor.workspace_id, Path::new("pipe"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn intermediate_rename_outside_root_before_single_open_is_rejected() {
        let root = temp_root("rename-race-root").canonicalize().unwrap();
        let outside = temp_root("rename-race-outside").canonicalize().unwrap();
        fs::create_dir_all(root.join("moving/nested")).unwrap();
        fs::write(root.join("moving/nested/value"), "outside").unwrap();
        let root_fd = open_selected_root(&root).unwrap();
        let moved = outside.join("moved");

        let result = open_relative_to_with_hook(&root_fd, Path::new("moving/nested/value"), || {
            fs::rename(root.join("moving"), &moved)?;
            symlink(&moved, root.join("moving"))?;
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(moved.join("nested/value")).unwrap(),
            "outside"
        );
    }

    #[test]
    fn unregister_drops_removed_root_outside_registry_lock() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let descriptor = registry.register(temp_root("drop-unregister")).unwrap();
        let weak_registry = Arc::downgrade(&registry);
        let (drop_tx, drop_rx) = mpsc::channel();
        registry
            .workspaces
            .lock()
            .unwrap()
            .get_mut(&descriptor.workspace_id)
            .unwrap()
            .drop_hook = Some(Box::new(move || {
            let registry = weak_registry.upgrade().unwrap();
            drop_tx
                .send(registry.workspaces.try_lock().is_ok())
                .unwrap();
        }));
        registry.unregister(&descriptor.workspace_id).unwrap();
        assert!(drop_rx.recv().unwrap());
    }

    #[test]
    fn clear_drops_drained_roots_outside_registry_lock() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let descriptor = registry.register(temp_root("drop-clear")).unwrap();
        let weak_registry = Arc::downgrade(&registry);
        let (drop_tx, drop_rx) = mpsc::channel();
        registry
            .workspaces
            .lock()
            .unwrap()
            .get_mut(&descriptor.workspace_id)
            .unwrap()
            .drop_hook = Some(Box::new(move || {
            let registry = weak_registry.upgrade().unwrap();
            drop_tx
                .send(registry.workspaces.try_lock().is_ok())
                .unwrap();
        }));
        registry.clear();
        assert!(drop_rx.recv().unwrap());
    }

    #[test]
    fn unregister_does_not_wait_for_an_open_after_it_clones_the_root() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("unregister-open");
        fs::write(root.join("value"), "retained").unwrap();
        let descriptor = registry.register(&root).unwrap();
        let workspace_id = descriptor.workspace_id.clone();
        let (cloned_tx, cloned_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let opening_registry = Arc::clone(&registry);
        let opening_id = workspace_id.clone();
        let opening = thread::spawn(move || {
            opening_registry.open_descendant_macos(&opening_id, Path::new("value"), || {
                cloned_tx.send(()).unwrap();
                resume_rx.recv().unwrap();
                Ok(())
            })
        });

        cloned_rx.recv().unwrap();
        registry.unregister(&workspace_id).unwrap();
        assert_eq!(
            registry.descriptor(&workspace_id).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        resume_tx.send(()).unwrap();
        let mut file = opening.join().unwrap().unwrap();
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        assert_eq!(content, "retained");
    }

    #[test]
    fn clear_does_not_wait_for_an_open_after_it_clones_the_root() {
        let registry = Arc::new(WorkspaceRegistry::new());
        let root = temp_root("clear-open");
        fs::write(root.join("value"), "retained").unwrap();
        let descriptor = registry.register(&root).unwrap();
        let (cloned_tx, cloned_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let opening_registry = Arc::clone(&registry);
        let opening_id = descriptor.workspace_id.clone();
        let opening = thread::spawn(move || {
            opening_registry.open_descendant_macos(&opening_id, Path::new("value"), || {
                cloned_tx.send(()).unwrap();
                resume_rx.recv().unwrap();
                Ok(())
            })
        });

        cloned_rx.recv().unwrap();
        registry.clear();
        assert_eq!(
            registry
                .descriptor(&descriptor.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        resume_tx.send(()).unwrap();
        assert!(opening.join().unwrap().is_ok());
    }

    #[test]
    fn returned_file_handle_remains_valid_after_revocation() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("returned-handle");
        fs::write(root.join("value"), "retained").unwrap();
        let descriptor = registry.register(&root).unwrap();
        let mut file = registry
            .open_descendant(&descriptor.workspace_id, Path::new("value"))
            .unwrap();
        registry.unregister(&descriptor.workspace_id).unwrap();
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        assert_eq!(content, "retained");
    }

    #[cfg(unix)]
    #[test]
    fn resolves_root_symlink_once_and_rejects_descendant_symlinks() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("links");
        let alias = root.with_extension("alias");
        fs::create_dir(root.join("real")).unwrap();
        fs::write(root.join("real/file"), "ok").unwrap();
        symlink(&root, &alias).unwrap();
        symlink("real", root.join("intermediate")).unwrap();
        symlink("real/file", root.join("leaf")).unwrap();
        let descriptor = registry.register(&alias).unwrap();
        assert_eq!(
            descriptor.canonical_root_path,
            fs::canonicalize(&root).unwrap()
        );
        assert!(registry
            .open_descendant(&descriptor.workspace_id, Path::new("intermediate/file"))
            .is_err());
        assert!(registry
            .open_descendant(&descriptor.workspace_id, Path::new("leaf"))
            .is_err());
    }

    #[test]
    fn rejects_empty_absolute_and_traversal_paths() {
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(temp_root("traversal")).unwrap();
        for path in [
            Path::new(""),
            Path::new("."),
            Path::new("../outside"),
            Path::new("/absolute"),
        ] {
            assert_eq!(
                registry
                    .open_descendant(&descriptor.workspace_id, path)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::InvalidInput
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn unregister_and_clear_remove_retained_roots() {
        let registry = WorkspaceRegistry::new();
        let first = registry.register(temp_root("fd-a")).unwrap();
        let second = registry.register(temp_root("fd-b")).unwrap();
        registry.unregister(&first.workspace_id).unwrap();
        assert!(!registry
            .workspaces
            .lock()
            .unwrap()
            .contains_key(&first.workspace_id));
        registry.clear();
        assert!(registry.workspaces.lock().unwrap().is_empty());
        assert_eq!(
            registry
                .descriptor(&second.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }
}
