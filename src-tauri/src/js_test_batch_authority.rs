use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_PACKAGE_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RUNNER_BYTES: u64 = 32 * 1024 * 1024;

pub(super) struct RetainedBatchPackageManifest {
    descriptor: fs::File,
    identity: BatchUnixIdentity,
    path: PathBuf,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct BatchUnixIdentity {
    device: u64,
    inode: u64,
    mode: u32,
    modified_nanoseconds: i64,
    modified_seconds: i64,
    size: u64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

impl BatchUnixIdentity {
    fn from_metadata(metadata: &fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;

        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            mode: metadata.mode(),
            modified_nanoseconds: metadata.mtime_nsec(),
            modified_seconds: metadata.mtime(),
            size: metadata.len(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        }
    }
}

impl RetainedBatchPackageManifest {
    pub(super) fn ensure_identity(&self) -> Result<(), String> {
        let descriptor = self.descriptor.metadata().map_err(|error| {
            format!("Failed to inspect retained JavaScript test package manifest: {error}")
        })?;
        let current = fs::symlink_metadata(&self.path).map_err(|error| {
            format!("JavaScript test package manifest identity changed: {error}")
        })?;
        if current.file_type().is_symlink()
            || BatchUnixIdentity::from_metadata(&descriptor) != self.identity
            || BatchUnixIdentity::from_metadata(&current) != self.identity
        {
            return Err("JavaScript test package manifest identity changed.".to_string());
        }
        Ok(())
    }
}

pub(super) fn retain_and_validate_package_manifest(
    root: &Path,
) -> Result<RetainedBatchPackageManifest, String> {
    use std::os::unix::fs::OpenOptionsExt;

    let path = root.join("package.json");
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("JavaScript test package manifest is unavailable: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(
            "JavaScript test package manifest must be a regular non-symlink file.".to_string(),
        );
    }
    if metadata.len() > MAX_PACKAGE_MANIFEST_BYTES {
        return Err("JavaScript test package manifest exceeds its safety limit.".to_string());
    }
    let descriptor = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path)
        .map_err(|error| format!("Failed to retain JavaScript test package manifest: {error}"))?;
    let identity = BatchUnixIdentity::from_metadata(&descriptor.metadata().map_err(|error| {
        format!("Failed to inspect retained JavaScript test package manifest: {error}")
    })?);
    if identity != BatchUnixIdentity::from_metadata(&metadata) {
        return Err("JavaScript test package manifest identity changed.".to_string());
    }
    use std::os::unix::fs::FileExt;
    let exact_length = usize::try_from(metadata.len())
        .map_err(|_| "JavaScript test package manifest length is invalid.".to_string())?;
    let mut bytes = vec![0_u8; exact_length];
    let mut offset = 0_usize;
    while offset < exact_length {
        let read = descriptor
            .read_at(&mut bytes[offset..], offset as u64)
            .map_err(|error| format!("Failed to read JavaScript test package manifest: {error}"))?;
        if read == 0 {
            return Err(
                "JavaScript test package manifest changed while being retained.".to_string(),
            );
        }
        offset += read;
    }
    let mut overflow = [0_u8; 1];
    if descriptor
        .read_at(&mut overflow, exact_length as u64)
        .map_err(|error| format!("Failed to verify JavaScript test package manifest: {error}"))?
        != 0
    {
        return Err("JavaScript test package manifest grew while being retained.".to_string());
    }
    let after = BatchUnixIdentity::from_metadata(&descriptor.metadata().map_err(|error| {
        format!("Failed to revalidate retained JavaScript test package manifest: {error}")
    })?);
    if after != identity {
        return Err("JavaScript test package manifest changed while being retained.".to_string());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("JavaScript test package manifest is invalid: {error}"))?;
    if !value.is_object() {
        return Err("JavaScript test package manifest must contain a JSON object.".to_string());
    }
    let authority = RetainedBatchPackageManifest {
        descriptor,
        identity,
        path,
    };
    authority.ensure_identity()?;
    Ok(authority)
}

pub(super) struct RetainedBatchResultFile {
    descriptor: fs::File,
    device: u64,
    inode: u64,
    path: PathBuf,
}

impl RetainedBatchResultFile {
    pub(super) fn create(path: PathBuf) -> Result<Self, String> {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

        let descriptor = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&path)
            .map_err(|error| format!("Failed to retain JavaScript test batch report: {error}"))?;
        let metadata = descriptor.metadata().map_err(|error| {
            format!("Failed to inspect retained JavaScript test batch report: {error}")
        })?;
        if !metadata.is_file() {
            return Err("JavaScript test batch report must be a regular file.".to_string());
        }
        let authority = Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            descriptor,
            path,
        };
        authority.ensure_path_identity()?;
        Ok(authority)
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn ensure_path_identity(&self) -> Result<(), String> {
        use std::os::unix::fs::MetadataExt;

        let descriptor = self.descriptor.metadata().map_err(|error| {
            format!("Failed to inspect retained JavaScript test batch report: {error}")
        })?;
        let current = fs::symlink_metadata(&self.path)
            .map_err(|error| format!("JavaScript test batch report identity changed: {error}"))?;
        if !descriptor.is_file()
            || !current.is_file()
            || current.file_type().is_symlink()
            || descriptor.dev() != self.device
            || descriptor.ino() != self.inode
            || current.dev() != self.device
            || current.ino() != self.inode
        {
            return Err("JavaScript test batch report identity changed.".to_string());
        }
        Ok(())
    }

    pub(super) fn validated_len(&self, limit: u64) -> Result<u64, String> {
        self.ensure_path_identity()?;
        let length = self
            .descriptor
            .metadata()
            .map_err(|error| {
                format!("Failed to inspect retained JavaScript test batch report: {error}")
            })?
            .len();
        if length > limit {
            return Err(format!(
                "JavaScript test batch report exceeds the {limit} byte safety limit."
            ));
        }
        Ok(length)
    }

    pub(super) fn read_exact(&self, exact_length: u64) -> Result<Vec<u8>, String> {
        use std::os::unix::fs::FileExt;

        self.ensure_path_identity()?;
        let allocation = usize::try_from(exact_length)
            .map_err(|_| "JavaScript test batch report length is invalid.".to_string())?;
        let mut bytes = vec![0_u8; allocation];
        let mut offset = 0_u64;
        while offset < exact_length {
            let start = usize::try_from(offset)
                .map_err(|_| "JavaScript test batch report offset is invalid.".to_string())?;
            let read = self
                .descriptor
                .read_at(&mut bytes[start..], offset)
                .map_err(|error| format!("Failed to read JavaScript test batch report: {error}"))?;
            if read == 0 {
                return Err("JavaScript test batch report changed while being read.".to_string());
            }
            offset = offset.saturating_add(read as u64);
        }
        let mut overflow = [0_u8; 1];
        if self
            .descriptor
            .read_at(&mut overflow, exact_length)
            .map_err(|error| format!("Failed to verify JavaScript test batch report: {error}"))?
            != 0
        {
            return Err("JavaScript test batch report grew while being read.".to_string());
        }
        self.ensure_path_identity()?;
        Ok(bytes)
    }
}

impl Drop for RetainedBatchResultFile {
    fn drop(&mut self) {
        if self.ensure_path_identity().is_ok() {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(super) struct RetainedBatchRunnerGeneration {
    descriptor: fs::File,
    identity: BatchUnixIdentity,
    path: PathBuf,
}

impl RetainedBatchRunnerGeneration {
    pub(super) fn capture(path: &Path) -> Result<Self, String> {
        use std::os::unix::fs::{FileExt, OpenOptionsExt};

        let descriptor = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|error| {
                format!("Failed to retain JavaScript test runner generation: {error}")
            })?;
        let identity =
            BatchUnixIdentity::from_metadata(&descriptor.metadata().map_err(|error| {
                format!("Failed to inspect retained JavaScript test runner generation: {error}")
            })?);
        if identity.size > MAX_RUNNER_BYTES {
            return Err("JavaScript test runner exceeds its batch safety limit.".to_string());
        }
        let mut offset = 0_u64;
        let mut chunk = [0_u8; 64 * 1024];
        while offset < identity.size {
            let remaining = usize::try_from((identity.size - offset).min(chunk.len() as u64))
                .map_err(|_| "JavaScript test runner length is invalid.".to_string())?;
            let read = descriptor
                .read_at(&mut chunk[..remaining], offset)
                .map_err(|error| format!("Failed to read JavaScript test runner: {error}"))?;
            if read == 0 {
                return Err("JavaScript test runner changed while being retained.".to_string());
            }
            offset += read as u64;
        }
        let mut overflow = [0_u8; 1];
        if descriptor
            .read_at(&mut overflow, identity.size)
            .map_err(|error| format!("Failed to verify JavaScript test runner: {error}"))?
            != 0
        {
            return Err("JavaScript test runner grew while being retained.".to_string());
        }
        let authority = Self {
            descriptor,
            identity,
            path: path.to_path_buf(),
        };
        authority.ensure_identity()?;
        Ok(authority)
    }

    pub(super) fn ensure_identity(&self) -> Result<(), String> {
        let descriptor = self.descriptor.metadata().map_err(|error| {
            format!("Failed to inspect retained JavaScript test runner generation: {error}")
        })?;
        let current = fs::symlink_metadata(&self.path).map_err(|error| {
            format!("JavaScript test runner generation identity changed: {error}")
        })?;
        if current.file_type().is_symlink()
            || BatchUnixIdentity::from_metadata(&descriptor) != self.identity
            || BatchUnixIdentity::from_metadata(&current) != self.identity
        {
            return Err("JavaScript test runner generation identity changed.".to_string());
        }
        Ok(())
    }
}
