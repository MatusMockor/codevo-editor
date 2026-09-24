use std::{
    ffi::{CStr, OsString},
    fmt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[cfg(target_os = "macos")]
const PRIVACY_PROTECTED_HOME_DIRECTORY_NAMES: &[&str] = &[
    ".Trash",
    "Applications",
    "Desktop",
    "Documents",
    "Downloads",
    "Library",
    "Movies",
    "Music",
    "Pictures",
];

#[cfg(not(target_os = "macos"))]
const PRIVACY_PROTECTED_HOME_DIRECTORY_NAMES: &[&str] = &[];

const PASSWD_BUFFER_BYTES: usize = 16_384;

pub trait HomeDirectorySource {
    fn home_directory(&self) -> Option<PathBuf>;
}

pub struct ProcessHomeDirectory;

impl HomeDirectorySource for ProcessHomeDirectory {
    fn home_directory(&self) -> Option<PathBuf> {
        home_from_environment(std::env::var_os("HOME")).or_else(home_from_password_database)
    }
}

fn home_from_environment(value: Option<OsString>) -> Option<PathBuf> {
    let value = value.filter(|home| !home.is_empty())?;
    let home = PathBuf::from(value);
    if home.is_relative() {
        return None;
    }
    Some(home)
}

#[cfg(unix)]
fn home_from_password_database() -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;

    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut buffer = vec![0 as libc::c_char; PASSWD_BUFFER_BYTES];
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    let directory = unsafe { (*result).pw_dir };
    if directory.is_null() {
        return None;
    }
    let bytes = unsafe { CStr::from_ptr(directory) }.to_bytes();
    home_from_environment(Some(std::ffi::OsStr::from_bytes(bytes).to_os_string()))
}

#[cfg(not(unix))]
fn home_from_password_database() -> Option<PathBuf> {
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileIdentity {
    device: u64,
    inode: u64,
}

impl FileIdentity {
    pub fn new(device: u64, inode: u64) -> Self {
        Self { device, inode }
    }
}

#[derive(Clone, Copy)]
pub struct FileIdentityProbe {
    identity: fn(&Path) -> Option<FileIdentity>,
    resolve: fn(&Path) -> Option<PathBuf>,
}

impl FileIdentityProbe {
    pub fn filesystem() -> Self {
        Self {
            identity: filesystem_identity,
            resolve: |path| path.canonicalize().ok(),
        }
    }

    pub fn new(
        identity: fn(&Path) -> Option<FileIdentity>,
        resolve: fn(&Path) -> Option<PathBuf>,
    ) -> Self {
        Self { identity, resolve }
    }
}

impl fmt::Debug for FileIdentityProbe {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("FileIdentityProbe")
    }
}

#[cfg(unix)]
fn filesystem_identity(path: &Path) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::metadata(path).ok()?;
    Some(FileIdentity::new(metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn filesystem_identity(_path: &Path) -> Option<FileIdentity> {
    None
}

#[derive(Debug, Clone)]
struct ProtectedHome {
    path: PathBuf,
    identity: Option<FileIdentity>,
}

#[derive(Debug, Clone)]
pub struct ProtectedPathPolicy {
    home: Option<ProtectedHome>,
    probe: FileIdentityProbe,
}

impl PartialEq for ProtectedPathPolicy {
    fn eq(&self, other: &Self) -> bool {
        self.home.as_ref().map(|home| &home.path) == other.home.as_ref().map(|home| &home.path)
    }
}

impl Eq for ProtectedPathPolicy {}

impl ProtectedPathPolicy {
    pub fn current() -> &'static Self {
        static CURRENT: OnceLock<ProtectedPathPolicy> = OnceLock::new();
        CURRENT.get_or_init(|| Self::from_source(&ProcessHomeDirectory))
    }

    pub fn from_source(source: &dyn HomeDirectorySource) -> Self {
        Self::for_home(source.home_directory().as_deref())
    }

    pub fn for_home(home: Option<&Path>) -> Self {
        Self::with_probe(home, FileIdentityProbe::filesystem())
    }

    pub fn with_probe(home: Option<&Path>, probe: FileIdentityProbe) -> Self {
        let home = home.map(|home| {
            let path = (probe.resolve)(home).unwrap_or_else(|| home.to_path_buf());
            let identity = (probe.identity)(&path);
            ProtectedHome { path, identity }
        });
        Self { home, probe }
    }

    pub fn unprotected() -> Self {
        Self {
            home: None,
            probe: FileIdentityProbe::filesystem(),
        }
    }

    pub fn is_protected_directory(&self, directory: &Path) -> bool {
        let Some(home) = self.home.as_ref() else {
            return false;
        };
        let Some(name) = directory.file_name().and_then(|name| name.to_str()) else {
            return false;
        };
        if !PRIVACY_PROTECTED_HOME_DIRECTORY_NAMES
            .iter()
            .any(|protected| names_equal(protected, name))
        {
            return false;
        }
        directory
            .parent()
            .is_some_and(|parent| self.is_home(home, parent))
    }

    pub fn check_workspace_root(&self, canonical_root: &Path) -> Result<(), WorkspaceRootRefusal> {
        if canonical_root.parent().is_none() {
            return Err(WorkspaceRootRefusal::FilesystemRoot);
        }
        let Some(home) = self.home.as_ref() else {
            return Ok(());
        };
        if self.is_home(home, canonical_root) {
            return Err(WorkspaceRootRefusal::Home);
        }
        if self.contains_home(home, canonical_root) {
            return Err(WorkspaceRootRefusal::HomeAncestor);
        }
        Ok(())
    }

    fn is_home(&self, home: &ProtectedHome, candidate: &Path) -> bool {
        if paths_equal(candidate, &home.path) {
            return true;
        }
        home.identity
            .is_some_and(|identity| (self.probe.identity)(candidate) == Some(identity))
    }

    fn contains_home(&self, home: &ProtectedHome, candidate: &Path) -> bool {
        if home
            .path
            .ancestors()
            .skip(1)
            .any(|ancestor| paths_equal(ancestor, candidate))
        {
            return true;
        }
        let Some(identity) = home.identity else {
            return false;
        };
        home.path.ancestors().skip(1).any(|ancestor| {
            let Ok(relative) = home.path.strip_prefix(ancestor) else {
                return false;
            };
            let aliased_home = candidate.join(relative);
            (self.probe.identity)(&aliased_home) == Some(identity)
                && (self.probe.resolve)(&aliased_home)
                    .is_some_and(|resolved| resolved.starts_with(candidate))
        })
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let mut left = left.components();
    let mut right = right.components();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return true,
            (Some(left), Some(right)) => {
                if !names_equal(
                    &left.as_os_str().to_string_lossy(),
                    &right.as_os_str().to_string_lossy(),
                ) {
                    return false;
                }
            }
            _ => return false,
        }
    }
}

#[cfg(target_os = "macos")]
fn names_equal(left: &str, right: &str) -> bool {
    left == right || left.to_lowercase() == right.to_lowercase()
}

#[cfg(not(target_os = "macos"))]
fn names_equal(left: &str, right: &str) -> bool {
    left == right
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceRootRefusal {
    Home,
    HomeAncestor,
    FilesystemRoot,
}

impl fmt::Display for WorkspaceRootRefusal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Home => "Choose a project folder, not your home folder.",
            Self::HomeAncestor => {
                "Choose a project folder, not a folder that contains your home folder."
            }
            Self::FilesystemRoot => "Choose a project folder, not the root of the disk.",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for WorkspaceRootRefusal {}

impl From<WorkspaceRootRefusal> for std::io::Error {
    fn from(refusal: WorkspaceRootRefusal) -> Self {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, refusal)
    }
}

#[cfg(test)]
#[path = "protected_paths_tests.rs"]
mod tests;
