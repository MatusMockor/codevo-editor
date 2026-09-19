use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::plan::CliProgram;
use crate::agent_cli_discovery::AgentCliDiscovery;

pub(crate) const MAX_PATH_ENTRIES: usize = 64;
pub(crate) const MAX_PATH_ENTRY_BYTES: usize = 4096;

const ROOT_UID: u32 = 0;
const GROUP_AND_WORLD_WRITE: u32 = 0o022;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedExecutable {
    pub(crate) path: PathBuf,
    pub(crate) search_path: String,
}

pub(crate) trait ExecutableResolver: Send + Sync {
    fn resolve(&self, program: CliProgram) -> Option<ResolvedExecutable>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PathTrust {
    owner_uid: u32,
}

impl PathTrust {
    pub(crate) fn current() -> Self {
        // SAFETY: `getuid` reads the calling process identity and never fails.
        Self {
            owner_uid: unsafe { libc::getuid() },
        }
    }

    #[cfg(test)]
    pub(crate) fn owned_by(owner_uid: u32) -> Self {
        Self { owner_uid }
    }

    fn trusted_owner(&self, metadata: &Metadata) -> bool {
        let owner = owner_uid(metadata);
        owner == ROOT_UID || owner == self.owner_uid
    }

    fn trusted_directory(&self, metadata: &Metadata) -> bool {
        if !metadata.is_dir() {
            return false;
        }
        if mode(metadata) & GROUP_AND_WORLD_WRITE == 0 {
            return true;
        }
        self.trusted_owner(metadata)
    }

    fn trusted_file(&self, metadata: &Metadata) -> bool {
        metadata.is_file() && self.trusted_owner(metadata)
    }
}

pub(crate) struct DiscoveryExecutableResolver {
    discovery: Arc<AgentCliDiscovery>,
}

impl DiscoveryExecutableResolver {
    pub(crate) fn new(discovery: Arc<AgentCliDiscovery>) -> Self {
        Self { discovery }
    }
}

impl ExecutableResolver for DiscoveryExecutableResolver {
    fn resolve(&self, program: CliProgram) -> Option<ResolvedExecutable> {
        let environment = self.discovery.effective_environment().ok()?;
        let search_path = environment.path().to_string();
        let path = resolve_on_search_path(&search_path, program.executable_name())?;
        Some(ResolvedExecutable { path, search_path })
    }
}

pub(crate) fn resolve_on_search_path(search_path: &str, name: &str) -> Option<PathBuf> {
    resolve_trusted_on_search_path(search_path, name, PathTrust::current())
}

pub(crate) fn resolve_trusted_on_search_path(
    search_path: &str,
    name: &str,
    trust: PathTrust,
) -> Option<PathBuf> {
    for directory in std::env::split_paths(search_path)
        .filter(|entry| entry.is_absolute())
        .filter(|entry| entry.as_os_str().len() <= MAX_PATH_ENTRY_BYTES)
        .take(MAX_PATH_ENTRIES)
    {
        if !is_trusted_directory(&directory, trust) {
            continue;
        }
        let Some(executable) = executable_candidate(&directory.join(name), trust) else {
            continue;
        };
        return Some(executable);
    }
    None
}

fn executable_candidate(candidate: &Path, trust: PathTrust) -> Option<PathBuf> {
    if !candidate.is_absolute() || candidate.as_os_str().len() > MAX_PATH_ENTRY_BYTES {
        return None;
    }
    let canonical = fs::canonicalize(candidate).ok()?;
    let metadata = fs::metadata(&canonical).ok()?;
    if !trust.trusted_file(&metadata) || !is_executable(&metadata) {
        return None;
    }
    let parent = canonical.parent()?;
    if !is_trusted_directory(parent, trust) {
        return None;
    }
    Some(canonical)
}

fn is_trusted_directory(directory: &Path, trust: PathTrust) -> bool {
    let Ok(canonical) = fs::canonicalize(directory) else {
        return false;
    };
    let Ok(metadata) = fs::metadata(&canonical) else {
        return false;
    };
    trust.trusted_directory(&metadata)
}

fn owner_uid(metadata: &Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;

    metadata.uid()
}

fn mode(metadata: &Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;

    metadata.mode()
}

fn is_executable(metadata: &Metadata) -> bool {
    mode(metadata) & 0o111 != 0
}
