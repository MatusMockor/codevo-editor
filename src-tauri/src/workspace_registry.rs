#![allow(dead_code)] // Private foundation awaiting a trusted native workspace-open integration.

use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::os::unix::ffi::OsStringExt;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::os::{
    fd::{AsRawFd, FromRawFd},
    unix::ffi::OsStrExt,
};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    path::Component,
    sync::{atomic::AtomicU64, Mutex},
};

#[path = "workspace_registry/registration.rs"]
pub(crate) mod registration;
#[path = "workspace_registry/unregister.rs"]
mod unregister;

#[cfg(any(target_os = "macos", target_os = "linux"))]
const MAX_REGISTERED_PATHS_PER_WORKSPACE: usize = 128;
#[cfg(any(target_os = "macos", target_os = "linux"))]
const MAX_REGISTERED_PATHS_GLOBAL: usize = 4096;

#[cfg(target_os = "macos")]
const O_RESOLVE_BENEATH: libc::c_int = 0x0000_1000;
#[cfg(target_os = "macos")]
pub(crate) const MACOS_OPEN_BENEATH_NOFOLLOW_FLAGS: libc::c_int =
    O_RESOLVE_BENEATH | libc::O_NOFOLLOW_ANY;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct WorkspaceId(String);

impl WorkspaceId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnicodeNormalizationPolicy {
    CanonicalDecomposition,
    Preserved,
    Unknown,
}

#[cfg(target_os = "linux")]
#[cfg(test)]
mod linux_tests {
    use super::*;
    use std::{fs, io::Read, os::unix::fs::symlink};

    #[test]
    fn keeps_operations_within_the_registered_root_and_rejects_symlinks() {
        let root =
            std::env::temp_dir().join(format!("mockor-linux-registry-{}", std::process::id()));
        let outside = root.with_extension("outside");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("nested/allowed.txt"), "allowed").unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        symlink(&outside, root.join("escape")).unwrap();

        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).unwrap();
        let mut allowed = registry
            .open_descendant(&descriptor.workspace_id, Path::new("nested/allowed.txt"))
            .unwrap();
        let mut content = String::new();
        allowed.read_to_string(&mut content).unwrap();

        assert_eq!(content, "allowed");
        assert!(registry
            .open_descendant(&descriptor.workspace_id, Path::new("escape/secret.txt"))
            .is_err());
        assert!(registry
            .open_descendant(&descriptor.workspace_id, Path::new("../outside/secret.txt"))
            .is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct ManagedWorkspace {
    descriptor: ManagedWorkspaceDescriptor,
    registered_paths: BTreeSet<PathBuf>,
    registration_admissions: HashMap<u64, RegistrationAdmission>,
    latest_admission_token: u64,
    root: File,
    unregister_generation: Option<u64>,
    #[cfg(test)]
    drop_hook: Option<Box<dyn FnOnce() + Send>>,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct RegistrationAdmission {
    added_registered_paths: BTreeSet<PathBuf>,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct RegisteredPathOwner {
    workspace_id: WorkspaceId,
    admission_token: u64,
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
impl Drop for ManagedWorkspace {
    fn drop(&mut self) {
        if let Some(hook) = self.drop_hook.take() {
            hook();
        }
    }
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    workspaces: Mutex<HashMap<WorkspaceId, ManagedWorkspace>>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    path_owners: Mutex<HashMap<PathBuf, RegisteredPathOwner>>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    operations: Mutex<()>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    next_registration_token: AtomicU64,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    next_unregister_generation: AtomicU64,
}

impl WorkspaceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn descriptor_for_registered_path(
        &self,
        path: &Path,
    ) -> io::Result<ManagedWorkspaceDescriptor> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = path;
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let registered_path = normalize_registered_path(path)?;
        let workspaces = self.workspaces.lock().map_err(lock_error)?;
        let path_owners = self.path_owners.lock().map_err(lock_error)?;
        let owner = path_owners
            .get(&registered_path)
            .ok_or_else(unknown_workspace)?;
        workspaces
            .get(&owner.workspace_id)
            .filter(|workspace| workspace.unregister_generation.is_none())
            .map(|workspace| workspace.descriptor.clone())
            .ok_or_else(unknown_workspace)
    }

    pub fn descriptor(&self, workspace_id: &WorkspaceId) -> io::Result<ManagedWorkspaceDescriptor> {
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = workspace_id;
            return Err(unsupported_platform());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        self.workspaces
            .lock()
            .map_err(lock_error)?
            .get(workspace_id)
            .filter(|workspace| workspace.unregister_generation.is_none())
            .map(|workspace| workspace.descriptor.clone())
            .ok_or_else(unknown_workspace)
    }

    pub fn clear(&self) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let _operation = self.operations.lock().ok();
            let drained = if let Ok(mut workspaces) = self.workspaces.lock() {
                workspaces.drain().map(|(_, workspace)| workspace).collect()
            } else {
                Vec::new()
            };
            if let Ok(mut path_owners) = self.path_owners.lock() {
                path_owners.clear();
            }
            drop(drained);
        }
    }

    /// Opens an existing descendant without following any intermediate or leaf symlink.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub fn open_descendant(
        &self,
        workspace_id: &WorkspaceId,
        relative_path: &Path,
    ) -> io::Result<File> {
        self.open_descendant_with_hook(workspace_id, relative_path, || Ok(()))
    }

    pub(crate) fn clone_root(&self, workspace_id: &WorkspaceId) -> io::Result<File> {
        let workspaces = self.workspaces.lock().map_err(lock_error)?;
        workspaces
            .get(workspace_id)
            .filter(|workspace| workspace.unregister_generation.is_none())
            .ok_or_else(unknown_workspace)?
            .root
            .try_clone()
    }

    /// Resolves a legacy raw-root command to an already admitted workspace without reopening
    /// that path. The returned directory FD remains bound to the registered filesystem object
    /// even if its selected or canonical path is subsequently replaced.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(crate) fn clone_root_for_path(&self, root_path: &Path) -> io::Result<File> {
        let workspaces = self.workspaces.lock().map_err(lock_error)?;
        let workspace = workspaces
            .values()
            .find(|workspace| {
                workspace.unregister_generation.is_none()
                    && (workspace.descriptor.selected_root_path == root_path
                        || workspace.descriptor.canonical_root_path == root_path)
            })
            .ok_or_else(unknown_workspace)?;
        workspace.root.try_clone()
    }

    pub(crate) fn lock_operations(&self) -> io::Result<std::sync::MutexGuard<'_, ()>> {
        self.operations.lock().map_err(lock_error)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn open_descendant_with_hook<F>(
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
            let workspace = workspaces
                .get(workspace_id)
                .filter(|workspace| workspace.unregister_generation.is_none())
                .ok_or_else(unknown_workspace)?;
            workspace.root.try_clone()?
        };
        post_clone()?;
        open_relative_to(&root, relative_path)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn normalize_registered_path(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "registered workspace path must be absolute",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn lock_error<T>(_: std::sync::PoisonError<T>) -> io::Error {
    io::Error::other("workspace registry lock poisoned")
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn unknown_workspace() -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, "unknown or closed workspace id")
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn unsupported_platform() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "managed workspace roots are supported only on macOS",
    )
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
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
pub(crate) fn opened_root_path(root: &File) -> io::Result<PathBuf> {
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

#[cfg(target_os = "linux")]
pub(crate) fn opened_root_path(root: &File) -> io::Result<PathBuf> {
    let path = std::fs::read_link(format!("/proc/self/fd/{}", root.as_raw_fd()))?;
    let metadata = std::fs::metadata(&path)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace root is not a directory",
        ));
    }
    Ok(path)
}

#[cfg(target_os = "macos")]
pub(crate) fn opened_regular_file_path(file: &File) -> io::Result<PathBuf> {
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "opened descriptor is not a regular file",
        ));
    }
    let mut opened_path = vec![0_u8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, opened_path.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let end = opened_path
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "opened path is not terminated")
        })?;
    Ok(PathBuf::from(std::ffi::OsString::from_vec(
        opened_path[..end].to_vec(),
    )))
}

#[cfg(target_os = "linux")]
pub(crate) fn opened_regular_file_path(file: &File) -> io::Result<PathBuf> {
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "opened descriptor is not a regular file",
        ));
    }
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn opened_regular_file_path(_file: &File) -> io::Result<PathBuf> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Opened descriptor paths are unsupported on this platform.",
    ))
}

#[cfg(target_os = "macos")]
fn open_relative_to(root: &File, path: &Path) -> io::Result<File> {
    open_relative_to_with_hook(root, path, || Ok(()))
}

#[cfg(target_os = "linux")]
fn open_relative_to(root: &File, path: &Path) -> io::Result<File> {
    open_relative_to_with_hook(root, path, || Ok(()))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn open_file_relative_to(root: &File, path: &Path) -> io::Result<File> {
    open_relative_to(root, path)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn open_file_relative_to(_root: &File, _path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Descriptor-relative workspace reads are unsupported on this platform.",
    ))
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
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_CLOEXEC | MACOS_OPEN_BENEATH_NOFOLLOW_FLAGS,
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

#[cfg(target_os = "linux")]
fn open_relative_to_with_hook<F>(root: &File, path: &Path, pre_open: F) -> io::Result<File>
where
    F: FnOnce() -> io::Result<()>,
{
    validate_relative_path(path)?;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
    pre_open()?;
    let mut how: libc::open_how = unsafe { std::mem::zeroed() };
    how.flags = (libc::O_RDONLY | libc::O_NONBLOCK | libc::O_CLOEXEC) as u64;
    how.resolve = libc::RESOLVE_BENEATH | libc::RESOLVE_NO_SYMLINKS;
    let mut attempts = 0;
    let fd = loop {
        let fd = unsafe {
            libc::syscall(
                libc::SYS_openat2,
                root.as_raw_fd(),
                path.as_ptr(),
                &how,
                std::mem::size_of::<libc::open_how>(),
            ) as libc::c_int
        };
        if fd >= 0
            || io::Error::last_os_error().raw_os_error() != Some(libc::EAGAIN)
            || attempts == 2
        {
            break fd;
        }
        attempts += 1;
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

#[cfg(target_os = "linux")]
fn detect_case_sensitivity(_: &File) -> Option<bool> {
    None
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

#[cfg(target_os = "linux")]
fn detect_unicode_policy(_: &File) -> UnicodeNormalizationPolicy {
    UnicodeNormalizationPolicy::Unknown
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_descriptor_open_flags_require_beneath_and_no_symlinks() {
        assert_eq!(
            MACOS_OPEN_BENEATH_NOFOLLOW_FLAGS & O_RESOLVE_BENEATH,
            O_RESOLVE_BENEATH
        );
        assert_eq!(
            MACOS_OPEN_BENEATH_NOFOLLOW_FLAGS & libc::O_NOFOLLOW_ANY,
            libc::O_NOFOLLOW_ANY
        );
        assert_ne!(O_RESOLVE_BENEATH, libc::O_NOFOLLOW_ANY);
    }

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
    fn isolates_distinct_roots_and_reuses_identity_for_the_same_root() {
        let registry = WorkspaceRegistry::new();
        let a = temp_root("a");
        let b = temp_root("b");
        fs::write(a.join("value"), "a").unwrap();
        fs::write(b.join("value"), "b").unwrap();
        let a1 = registry.register(&a).unwrap();
        let a2 = registry.register(&a).unwrap();
        let b = registry.register(&b).unwrap();
        assert_eq!(a1.workspace_id, a2.workspace_id);
        assert_ne!(a1.workspace_id, b.workspace_id);
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

    #[cfg(unix)]
    #[test]
    fn aliases_and_lexical_parent_paths_reuse_the_canonical_identity() {
        let registry = WorkspaceRegistry::new();
        let parent = temp_root("identity-aliases");
        let root = parent.join("workspace");
        let alias = parent.join("workspace-alias");
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        symlink(&root, &alias).unwrap();

        let direct = registry.register(&root).unwrap();
        let through_alias = registry.register(&alias).unwrap();
        let through_parent = registry
            .register(root.join("nested").join("..").as_path())
            .unwrap();

        assert_eq!(direct.workspace_id, through_alias.workspace_id);
        assert_eq!(direct.workspace_id, through_parent.workspace_id);
        assert_eq!(through_alias.selected_root_path, alias);
        assert_eq!(
            through_parent.selected_root_path,
            root.join("nested").join("..")
        );
        assert_eq!(registry.workspaces.lock().unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn unregistering_a_shared_identity_revokes_every_alias() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("identity-unregister");
        let alias = root.with_extension("alias");
        fs::write(root.join("value"), "retained").unwrap();
        symlink(&root, &alias).unwrap();

        let direct = registry.register(&root).unwrap();
        let through_alias = registry.register(&alias).unwrap();
        assert_eq!(direct.workspace_id, through_alias.workspace_id);

        registry.unregister(&direct.workspace_id).unwrap();

        assert_eq!(
            registry
                .descriptor(&through_alias.workspace_id)
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        assert_eq!(
            registry
                .open_descendant(&through_alias.workspace_id, Path::new("value"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }

    #[test]
    fn registering_after_unregister_allocates_a_fresh_identity() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("identity-reregister");
        let first = registry.register(&root).unwrap();
        registry.unregister(&first.workspace_id).unwrap();

        let second = registry.register(&root).unwrap();

        assert_ne!(first.workspace_id, second.workspace_id);
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
            .register_with_hook(&selected, || {
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
            opening_registry.open_descendant_with_hook(&opening_id, Path::new("value"), || {
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
            opening_registry.open_descendant_with_hook(&opening_id, Path::new("value"), || {
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

    #[test]
    fn unregister_after_runs_lifecycle_before_removal_and_fails_closed() {
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(temp_root("lifecycle")).unwrap();
        let callback_root = descriptor.canonical_root_path.clone();
        let error = registry
            .unregister_after(&descriptor.workspace_id, |registered| {
                assert_eq!(registered.canonical_root_path, callback_root);
                Err(io::Error::other("terminal stop failed"))
            })
            .expect_err("lifecycle failure must preserve registration");
        assert_eq!(error.to_string(), "terminal stop failed");
        assert!(registry.descriptor(&descriptor.workspace_id).is_ok());

        registry
            .unregister_after(&descriptor.workspace_id, |registered| {
                assert_eq!(registered.canonical_root_path, callback_root);
                Ok(())
            })
            .expect("successful lifecycle removes registration");
        assert!(registry.descriptor(&descriptor.workspace_id).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn registered_aliases_are_bounded_deduplicated_and_removed_with_workspace() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("alias-target").canonicalize().unwrap();
        let aliases = temp_root("alias-container");
        let descriptor = registry.register(&root).unwrap();
        let mut first_alias = None;
        for index in 0..(MAX_REGISTERED_PATHS_PER_WORKSPACE - 1) {
            let alias = aliases.join(format!("alias-{index}"));
            symlink(&root, &alias).unwrap();
            let reused = registry.register(&alias).unwrap();
            assert_eq!(reused.workspace_id, descriptor.workspace_id);
            first_alias.get_or_insert(alias);
        }
        let first_alias = first_alias.unwrap();
        assert_eq!(
            registry.register(&first_alias).unwrap().workspace_id,
            descriptor.workspace_id,
            "re-registering the same lexical alias must be deduplicated"
        );
        let overflow = aliases.join("overflow");
        symlink(&root, &overflow).unwrap();
        assert_eq!(
            registry.register(&overflow).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        assert_eq!(
            registry
                .descriptor_for_registered_path(&first_alias)
                .unwrap()
                .workspace_id,
            descriptor.workspace_id
        );

        registry.unregister(&descriptor.workspace_id).unwrap();
        assert!(registry
            .descriptor_for_registered_path(&first_alias)
            .is_err());
        fs::remove_dir_all(aliases).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn explicitly_reregistered_retargeted_alias_transfers_deterministic_ownership() {
        let registry = WorkspaceRegistry::new();
        let root_a = temp_root("transfer-a").canonicalize().unwrap();
        let root_b = temp_root("transfer-b").canonicalize().unwrap();
        let alias = root_a.with_extension("transfer-alias");
        symlink(&root_a, &alias).unwrap();
        let a = registry.register(&root_a).unwrap();
        assert_eq!(
            registry.register(&alias).unwrap().workspace_id,
            a.workspace_id
        );

        fs::remove_file(&alias).unwrap();
        symlink(&root_b, &alias).unwrap();
        let b = registry.register(&alias).unwrap();
        assert_ne!(a.workspace_id, b.workspace_id);
        assert_eq!(
            registry
                .descriptor_for_registered_path(&alias)
                .unwrap()
                .workspace_id,
            b.workspace_id
        );
        assert_eq!(
            crate::registered_runtime_root(&registry, alias.to_str().unwrap()),
            b.canonical_root_path,
            "trust revoke and dispose share this deterministic retained-root lookup"
        );
        assert_eq!(
            registry
                .descriptor_for_registered_path(&root_a)
                .unwrap()
                .workspace_id,
            a.workspace_id,
            "A must remain reachable through its canonical direct identity"
        );
        assert!(!registry
            .workspaces
            .lock()
            .unwrap()
            .get(&a.workspace_id)
            .unwrap()
            .registered_paths
            .contains(&normalize_registered_path(&alias).unwrap()));

        registry.unregister(&b.workspace_id).unwrap();
        assert!(registry.descriptor_for_registered_path(&alias).is_err());
        assert!(registry.descriptor_for_registered_path(&root_a).is_ok());
        fs::remove_file(alias).unwrap();
        fs::remove_dir_all(root_a).unwrap();
        fs::remove_dir_all(root_b).unwrap();
    }
}
