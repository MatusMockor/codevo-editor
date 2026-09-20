use super::agent_thread_store::{
    agent_root_owner_id, AgentThreadDocument, MAX_AGENT_THREAD_FILE_BYTES,
};
use super::errors::{AgentTurnLogError, AgentTurnLogResult};
use std::{
    fs,
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    modified_nanos: i128,
    size: u64,
}

#[derive(Debug)]
pub(crate) struct ThreadOwnershipProbe {
    document: PathBuf,
    root_key: String,
    thread_id: String,
    verified: Option<FileIdentity>,
}

impl ThreadOwnershipProbe {
    pub(crate) fn new(document: PathBuf, root_key: String, thread_id: String) -> Self {
        Self {
            document,
            root_key,
            thread_id,
            verified: None,
        }
    }

    pub(crate) fn revalidate(&mut self) -> AgentTurnLogResult<()> {
        if let Some(base) = self
            .document
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
        {
            // Exact catalog ownership wins once migrated; legacy files remain immutable backups.
            let owned=super::super::super::agent_history_commands::agent_history_store::connection::ownership_status(base,&self.root_key,&self.thread_id).map_err(|_|AgentTurnLogError::OwnerMismatch)?;
            match owned {
                Some(true) => return Ok(()),
                Some(false) => return Err(AgentTurnLogError::OwnerMismatch),
                None => {}
            }
        }
        let metadata = match fs::symlink_metadata(&self.document) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                self.verified = None;
                return Ok(());
            }
            Err(_) => return Err(AgentTurnLogError::OwnerMismatch),
        };
        if !metadata.file_type().is_file() {
            return Err(AgentTurnLogError::OwnerMismatch);
        }
        let identity = identity_of(&metadata);
        if self.verified == Some(identity) {
            return Ok(());
        }
        self.confirm_document()?;
        self.verified = Some(identity);
        Ok(())
    }

    fn confirm_document(&self) -> AgentTurnLogResult<()> {
        let Some(content) = read_bounded(&self.document) else {
            return Ok(());
        };
        let Ok(document) = serde_json::from_slice::<AgentThreadDocument>(&content) else {
            return Ok(());
        };
        let thread = &document.thread;
        if thread.thread_id != self.thread_id
            || thread.owner.root_key != self.root_key
            || thread.owner.owner_id != agent_root_owner_id(&self.root_key)
        {
            return Err(AgentTurnLogError::OwnerMismatch);
        }
        Ok(())
    }
}

fn read_bounded(path: &Path) -> Option<Vec<u8>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let handle = options.open(path).ok()?;
    let mut content = Vec::new();
    handle
        .take(MAX_AGENT_THREAD_FILE_BYTES as u64)
        .read_to_end(&mut content)
        .ok()?;
    Some(content)
}

#[cfg(unix)]
fn identity_of(metadata: &fs::Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        modified_nanos: i128::from(metadata.mtime()) * 1_000_000_000
            + i128::from(metadata.mtime_nsec()),
        size: metadata.len(),
    }
}

#[cfg(not(unix))]
fn identity_of(metadata: &fs::Metadata) -> FileIdentity {
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos() as i128)
        .unwrap_or_default();
    FileIdentity {
        device: 0,
        inode: 0,
        modified_nanos,
        size: metadata.len(),
    }
}
