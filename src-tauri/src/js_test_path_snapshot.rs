use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub(super) struct RetainedPathSnapshot {
    entries: Vec<(PathBuf, RetainedUnixIdentity)>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) struct RetainedUnixIdentity {
    pub(super) device: u64,
    pub(super) inode: u64,
    pub(super) mode: u32,
    pub(super) changed_seconds: i64,
    pub(super) changed_nanoseconds: i64,
}

impl RetainedUnixIdentity {
    pub(super) fn from_metadata(metadata: &fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;

        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            mode: metadata.mode(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        }
    }
}

impl RetainedPathSnapshot {
    pub(super) fn capture(
        root: &Path,
        path: &Path,
        allow_leaf_symlink: bool,
    ) -> Result<Self, String> {
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Retained path must stay inside its authority root.".to_string())?;
        let mut current = root.to_path_buf();
        let mut entries = Vec::new();
        let root_metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Failed to snapshot retained path: {error}"))?;
        entries.push((
            current.clone(),
            RetainedUnixIdentity::from_metadata(&root_metadata),
        ));
        let component_count = relative.components().count();
        for (index, component) in relative.components().enumerate() {
            let Component::Normal(segment) = component else {
                return Err("Retained path contains an invalid component.".to_string());
            };
            current.push(segment);
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| format!("Failed to snapshot retained path: {error}"))?;
            if metadata.file_type().is_symlink()
                && !(allow_leaf_symlink && index + 1 == component_count)
            {
                return Err("Retained path cannot contain symlinks.".to_string());
            }
            entries.push((
                current.clone(),
                RetainedUnixIdentity::from_metadata(&metadata),
            ));
        }
        Ok(Self { entries })
    }

    pub(super) fn ensure_identity(&self) -> Result<(), String> {
        for (path, expected) in &self.entries {
            let metadata = fs::symlink_metadata(path)
                .map_err(|error| format!("Retained path identity changed: {error}"))?;
            if RetainedUnixIdentity::from_metadata(&metadata) != *expected {
                return Err("Retained path identity changed.".to_string());
            }
        }
        Ok(())
    }
}
