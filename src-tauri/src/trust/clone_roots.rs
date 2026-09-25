use super::WorkspaceTrustService;
use std::{collections::BTreeSet, fs, io, path::Path, sync::Mutex};

pub(crate) const MAX_CLONE_ROOT_PRUNE_BATCH: usize = 1024;

#[derive(Default)]
pub(crate) struct CloneRoots {
    roots: BTreeSet<String>,
    epoch: u64,
}

pub(crate) struct CloneRootsPruneBatch {
    epoch: u64,
    roots: BTreeSet<String>,
}

impl CloneRootsPruneBatch {
    pub(crate) fn missing_roots(&self) -> Vec<String> {
        self.roots
            .iter()
            .filter(|root| folder_is_missing(root))
            .cloned()
            .collect()
    }
}

fn folder_is_missing(root: &str) -> bool {
    matches!(
        fs::symlink_metadata(Path::new(root)),
        Err(error) if error.kind() == io::ErrorKind::NotFound
    )
}

impl CloneRoots {
    pub(crate) fn from_persisted(roots: Vec<String>) -> Self {
        Self {
            roots: roots.into_iter().collect(),
            epoch: 0,
        }
    }

    pub(crate) fn contains(&self, root: &str) -> bool {
        self.roots.contains(root)
    }

    pub(crate) fn mark(&mut self, root: String) -> bool {
        self.epoch = self.epoch.wrapping_add(1);
        self.roots.insert(root)
    }

    pub(crate) fn unmark(&mut self, root: &str) -> bool {
        self.roots.remove(root)
    }

    pub(crate) fn restore(&mut self, roots: Vec<String>) {
        self.roots.extend(roots);
    }

    pub(crate) fn prune_batch(&self) -> CloneRootsPruneBatch {
        CloneRootsPruneBatch {
            epoch: self.epoch,
            roots: self
                .roots
                .iter()
                .take(MAX_CLONE_ROOT_PRUNE_BATCH)
                .cloned()
                .collect(),
        }
    }

    pub(crate) fn forget(
        &mut self,
        batch: &CloneRootsPruneBatch,
        missing: Vec<String>,
    ) -> Vec<String> {
        if batch.epoch != self.epoch {
            return Vec::new();
        }
        missing
            .into_iter()
            .filter(|root| batch.roots.contains(root) && self.roots.remove(root))
            .collect()
    }

    pub(crate) fn persisted(&self) -> Vec<String> {
        self.roots.iter().cloned().collect()
    }
}

pub(crate) fn prune_missing_clone_roots(trust: &Mutex<WorkspaceTrustService>) -> io::Result<usize> {
    let batch = trust
        .lock()
        .map_err(|_| io::Error::other("workspace trust is unavailable"))?
        .clone_roots_prune_batch();
    let missing = batch.missing_roots();
    if missing.is_empty() {
        return Ok(0);
    }
    trust
        .lock()
        .map_err(|_| io::Error::other("workspace trust is unavailable"))?
        .forget_clone_roots(&batch, missing)
}
