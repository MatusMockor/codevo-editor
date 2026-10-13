use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

mod media_type;

pub(crate) const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
pub(crate) const CHUNK_BYTES: usize = 64 * 1024;
pub(crate) const MAX_SOURCES: usize = 64;
const MAX_PATH_BYTES: usize = 4096;

pub(crate) const BAD_PATH: &str = "Choose a file using an absolute local file path.";
pub(crate) const FOLDER: &str = "Choose a file, not a folder.";
pub(crate) const NOT_REGULAR: &str = "Choose a regular file, not a symbolic link or special file.";
pub(crate) const EMPTY: &str = "File is empty.";
pub(crate) const TOO_LARGE: &str = "File is larger than 50 MiB.";
pub(crate) const UNREADABLE: &str = "The file could not be read.";
pub(crate) const NOT_STAGED: &str = "The attached file is no longer staged. Attach it again.";
pub(crate) const CHANGED: &str = "The attached file changed. Attach it again.";
pub(crate) const INVALID_SOURCE: &str = "Invalid attachment source";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity {
    device: u64,
    inode: u64,
    length: u64,
    modified: (i64, i64),
}

impl Identity {
    #[cfg(unix)]
    fn of(metadata: &fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            length: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
        }
    }

    #[cfg(not(unix))]
    fn of(metadata: &fs::Metadata) -> Self {
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or((0, 0), |elapsed| {
                (elapsed.as_secs() as i64, i64::from(elapsed.subsec_nanos()))
            });
        Self {
            device: 0,
            inode: 0,
            length: metadata.len(),
            modified,
        }
    }

    fn same_file(&self, other: &Self) -> bool {
        self.device == other.device && self.inode == other.inode && self.length == other.length
    }
}

fn open(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    options.open(path)
}

pub(crate) fn entropy<const N: usize>() -> Option<[u8; N]> {
    let mut bytes = [0_u8; N];
    File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut bytes))
        .ok()?;
    Some(bytes)
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn mint_id() -> Option<String> {
    let mut bytes = entropy::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let text = hex(&bytes);
    Some(format!(
        "{}-{}-{}-{}-{}",
        &text[..8],
        &text[8..12],
        &text[12..16],
        &text[16..20],
        &text[20..]
    ))
}

pub(crate) fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[14] == b'4'
        && b"89ab".contains(&bytes[19])
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                return *byte == b'-';
            }
            byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
        })
}

#[derive(Debug)]
pub(crate) struct Source {
    path: PathBuf,
    name: String,
    identity: Identity,
}

impl Source {
    pub(crate) fn stage(path: &str) -> Result<Self, String> {
        if path.len() > MAX_PATH_BYTES
            || path.chars().any(char::is_control)
            || !Path::new(path).is_absolute()
        {
            return Err(BAD_PATH.into());
        }
        let path = Path::new(path);
        let before = fs::symlink_metadata(path).map_err(|_| UNREADABLE)?;
        if before.file_type().is_dir() {
            return Err(FOLDER.into());
        }
        if !before.file_type().is_file() {
            return Err(NOT_REGULAR.into());
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(BAD_PATH)?;
        let file = open(path).map_err(|_| UNREADABLE)?;
        let opened = file.metadata().map_err(|_| UNREADABLE)?;
        if !opened.is_file() {
            return Err(NOT_REGULAR.into());
        }
        let identity = Identity::of(&opened);
        if !identity.same_file(&Identity::of(&before)) {
            return Err(UNREADABLE.into());
        }
        if identity.length == 0 {
            return Err(EMPTY.into());
        }
        if identity.length > MAX_FILE_BYTES {
            return Err(TOO_LARGE.into());
        }
        Ok(Self {
            path: path.to_path_buf(),
            name: name.to_owned(),
            identity,
        })
    }

    pub(crate) fn bytes(&self) -> u64 {
        self.identity.length
    }

    pub(crate) fn media_type(&self) -> &'static str {
        media_type::for_path(&self.path)
    }

    fn unchanged(&self, metadata: &fs::Metadata) -> bool {
        metadata.file_type().is_file() && Identity::of(metadata) == self.identity
    }

    pub(crate) fn open(self: &Arc<Self>) -> Result<Reader, String> {
        let before = fs::symlink_metadata(&self.path).map_err(|_| UNREADABLE)?;
        if !self.unchanged(&before) {
            return Err(CHANGED.into());
        }
        let reader = Reader {
            file: open(&self.path).map_err(|_| UNREADABLE)?,
            source: Arc::clone(self),
            remaining: self.identity.length,
            digest: Sha256::new(),
        };
        reader.verify()?;
        Ok(reader)
    }
}

pub(crate) struct Reader {
    file: File,
    source: Arc<Source>,
    remaining: u64,
    digest: Sha256,
}

impl Reader {
    fn verify(&self) -> Result<(), String> {
        let opened = self.file.metadata().map_err(|_| UNREADABLE)?;
        if !self.source.unchanged(&opened) {
            return Err(CHANGED.into());
        }
        Ok(())
    }

    fn read(&mut self, buffer: &mut [u8]) -> Result<usize, String> {
        loop {
            match self.file.read(buffer) {
                Ok(count) => return Ok(count),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => return Err(UNREADABLE.into()),
            }
        }
    }

    fn seal(&mut self) -> Result<(), String> {
        if self.read(&mut [0_u8; 1])? != 0 {
            return Err(CHANGED.into());
        }
        self.verify()?;
        let named = fs::symlink_metadata(&self.source.path).map_err(|_| CHANGED)?;
        if !self.source.unchanged(&named) {
            return Err(CHANGED.into());
        }
        Ok(())
    }

    pub(crate) fn next(&mut self) -> Result<Option<Vec<u8>>, String> {
        if self.remaining == 0 {
            return Ok(None);
        }
        let wanted = self.remaining.min(CHUNK_BYTES as u64) as usize;
        let mut chunk = vec![0_u8; wanted];
        let mut filled = 0;
        while filled < wanted {
            let count = self.read(&mut chunk[filled..])?;
            if count == 0 {
                return Err(CHANGED.into());
            }
            filled += count;
        }
        self.digest.update(&chunk);
        if self.remaining == wanted as u64 {
            self.seal()?;
        }
        self.remaining -= wanted as u64;
        Ok(Some(chunk))
    }

    pub(crate) fn digest(&self) -> Option<String> {
        if self.remaining != 0 {
            return None;
        }
        Some(hex(&self.digest.clone().finalize()))
    }

    #[cfg(test)]
    pub(crate) fn finish(self) -> Option<String> {
        self.digest()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Staged {
    pub(crate) source_id: String,
    pub(crate) name: String,
    pub(crate) bytes: u64,
}

#[derive(Default)]
pub(crate) struct FileSources {
    entries: Mutex<VecDeque<(String, Arc<Source>)>>,
}

impl FileSources {
    pub(crate) fn stage(&self, path: &str) -> Result<Staged, String> {
        let source = Source::stage(path)?;
        let source_id = mint_id().ok_or(UNREADABLE)?;
        let staged = Staged {
            source_id: source_id.clone(),
            name: source.name.clone(),
            bytes: source.bytes(),
        };
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.push_back((source_id, Arc::new(source)));
        while entries.len() > MAX_SOURCES {
            entries.pop_front();
        }
        Ok(staged)
    }

    pub(crate) fn find(&self, source_id: &str) -> Option<Arc<Source>> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|(id, _)| id == source_id)
            .map(|(_, source)| Arc::clone(source))
    }

    pub(crate) fn release(&self, source_id: &str) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(id, _)| id != source_id);
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

#[cfg(all(test, unix))]
mod tests;
