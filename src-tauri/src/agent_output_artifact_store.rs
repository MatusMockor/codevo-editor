use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[path = "agent_output_artifact_files.rs"]
mod files;

const MAX_IMAGE: u64 = 8 * 1024 * 1024;
const MAX_HTML: u64 = 2 * 1024 * 1024;
const MAX_STORAGE: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const HEADER_LIMIT: usize = 4096;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactMetadata {
    pub id: String,
    pub task_id: String,
    pub name: String,
    pub media_type: String,
    pub size_bytes: u64,
    pub sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Stored {
    owner: String,
    metadata: ArtifactMetadata,
}
pub struct ArtifactOwner<'a> {
    pub root_key: &'a str,
    pub thread_id: &'a str,
    pub turn_id: &'a str,
}
impl ArtifactOwner<'_> {
    fn key(&self) -> String {
        digest(&serde_json::to_vec(&(self.root_key, self.thread_id, self.turn_id)).unwrap())
    }
}
pub struct OutputArtifactStore {
    directory: PathBuf,
    lock: Mutex<()>,
}
impl OutputArtifactStore {
    pub fn new(base: PathBuf) -> Self {
        Self {
            directory: base.join("agent-output-artifacts"),
            lock: Mutex::new(()),
        }
    }
    #[cfg(test)]
    fn resolve(
        &self,
        owner: &ArtifactOwner<'_>,
        root: &Path,
        reference: &str,
    ) -> Result<ArtifactMetadata, String> {
        self.resolve_registered(owner, root, &files::directory(root)?, reference, || Ok(()))
    }
    pub fn resolve_registered(
        &self,
        owner: &ArtifactOwner<'_>,
        root: &Path,
        root_descriptor: &fs::File,
        reference: &str,
        revalidate: impl Fn() -> Result<(), String>,
    ) -> Result<ArtifactMetadata, String> {
        if reference.is_empty() || reference.len() > 4096 || reference.contains('\0') {
            return Err("Invalid artifact reference.".into());
        }
        let path = Path::new(reference);
        let relative = if path.is_absolute() {
            path.strip_prefix(root)
                .map_err(|_| "Artifact is outside its workspace.")?
        } else {
            path
        };
        if relative
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err("Invalid artifact reference.".into());
        }
        let name = relative
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| s.len() <= 255)
            .ok_or("Invalid artifact name.")?;
        let (media_type, limit) = media_type(relative)?;
        let owner_key = owner.key();
        let id = digest(&serde_json::to_vec(&(&owner_key, relative.to_str())).unwrap());
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Artifact store is unavailable.")?;
        revalidate()?;
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let directory = files::directory(&self.directory)?;
        files::lock(&directory)?;
        let filename = format!("{id}.artifact");
        if let Ok(file) = files::open(&directory, Path::new(&filename), libc::O_RDONLY) {
            revalidate()?;
            let result = decode(
                &files::read(file, MAX_IMAGE + HEADER_LIMIT as u64)?,
                &owner_key,
                &id,
            )
            .map(|(stored, _)| stored.metadata)?;
            revalidate()?;
            return Ok(result);
        }
        let bytes = files::source(root, root_descriptor, reference, limit)?;
        verify(media_type, &bytes)?;
        let metadata = ArtifactMetadata {
            id,
            task_id: owner.turn_id.into(),
            name: name.into(),
            media_type: media_type.into(),
            size_bytes: bytes.len() as u64,
            sha256: digest(&bytes),
        };
        let header = serde_json::to_vec(&Stored {
            owner: owner_key.clone(),
            metadata: metadata.clone(),
        })
        .map_err(|e| e.to_string())?;
        let mut snapshot = (header.len() as u32).to_be_bytes().to_vec();
        snapshot.extend(header);
        snapshot.extend(bytes);
        files::remove_partial(&directory, &filename);
        self.capacity(&directory, &owner_key, snapshot.len() as u64)?;
        revalidate()?;
        files::write(&directory, &filename, &snapshot)?;
        revalidate()?;
        Ok(metadata)
    }
    pub fn existing(
        &self,
        owner: &ArtifactOwner<'_>,
        root: &Path,
        reference: &str,
    ) -> Result<Option<ArtifactMetadata>, String> {
        if reference.is_empty() || reference.len() > 4096 || reference.contains('\0') {
            return Err("Invalid artifact reference.".into());
        }
        let path = Path::new(reference);
        let relative = if path.is_absolute() {
            path.strip_prefix(root)
                .map_err(|_| "Artifact is outside its workspace.")?
        } else {
            path
        };
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return Err("Invalid artifact reference.".into());
        }
        let owner_key = owner.key();
        let id = digest(&serde_json::to_vec(&(&owner_key, relative.to_str())).unwrap());
        if !self.directory.exists() {
            return Ok(None);
        }
        let directory = files::directory(&self.directory)?;
        let name = format!("{id}.artifact");
        if !self
            .directory
            .join(&name)
            .try_exists()
            .map_err(|e| e.to_string())?
        {
            return Ok(None);
        }
        let file = files::open(&directory, Path::new(&name), libc::O_RDONLY)?;
        let snapshot = files::read(file, MAX_IMAGE + HEADER_LIMIT as u64)?;
        decode(&snapshot, &owner_key, &id).map(|(stored, _)| Some(stored.metadata))
    }
    pub fn read(&self, owner: &ArtifactOwner<'_>, id: &str) -> Result<Vec<u8>, String> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid artifact id.".into());
        }
        let directory = files::directory(&self.directory)?;
        let file = files::open(
            &directory,
            Path::new(&format!("{id}.artifact")),
            libc::O_RDONLY,
        )?;
        let snapshot = files::read(file, MAX_IMAGE + HEADER_LIMIT as u64)?;
        let (_, bytes) = decode(&snapshot, &owner.key(), id)?;
        Ok(bytes.to_vec())
    }
    fn capacity(&self, directory: &fs::File, owner: &str, additional: u64) -> Result<(), String> {
        let mut total = additional;
        let mut owned = 0;
        for (index, entry) in fs::read_dir(&self.directory)
            .map_err(|e| e.to_string())?
            .enumerate()
        {
            if index + 1 >= MAX_ENTRIES {
                return Err("Artifact storage file limit reached.".into());
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let file = files::open(directory, Path::new(&entry.file_name()), libc::O_RDONLY)?;
            let size = file.metadata().map_err(|e| e.to_string())?.len();
            total = total
                .checked_add(size)
                .ok_or("Artifact storage limit reached.")?;
            if total > MAX_STORAGE {
                return Err("Artifact storage limit reached.".into());
            }
            // Read only the bounded metadata, never every artifact payload.
            use std::io::Read;
            let mut header = Vec::new();
            file.take(HEADER_LIMIT as u64)
                .read_to_end(&mut header)
                .map_err(|e| e.to_string())?;
            if let Ok(stored) = header_only(&header) {
                if stored.owner == owner {
                    owned += 1;
                }
            }
            if owned >= 32 {
                return Err("This turn already has 32 artifacts.".into());
            }
        }
        Ok(())
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn header_only(bytes: &[u8]) -> Result<Stored, String> {
    let prefix: [u8; 4] = bytes
        .get(..4)
        .ok_or("Invalid artifact metadata.")?
        .try_into()
        .unwrap();
    let length = u32::from_be_bytes(prefix) as usize;
    if length > HEADER_LIMIT - 4 {
        return Err("Invalid artifact metadata size.".into());
    }
    serde_json::from_slice(
        bytes
            .get(4..4 + length)
            .ok_or("Incomplete artifact metadata.")?,
    )
    .map_err(|e| e.to_string())
}
fn decode<'a>(bytes: &'a [u8], owner: &str, id: &str) -> Result<(Stored, &'a [u8]), String> {
    let stored = header_only(bytes)?;
    let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
    let content = &bytes[4 + length..];
    if stored.owner != owner
        || stored.metadata.id != id
        || stored.metadata.size_bytes != content.len() as u64
        || stored.metadata.sha256 != digest(content)
    {
        return Err("Artifact owner or content does not match.".into());
    }
    verify(&stored.metadata.media_type, content)?;
    Ok((stored, content))
}
fn media_type(path: &Path) -> Result<(&'static str, u64), String> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => Ok(("text/html", MAX_HTML)),
        "png" => Ok(("image/png", MAX_IMAGE)),
        "jpg" | "jpeg" => Ok(("image/jpeg", MAX_IMAGE)),
        "webp" => Ok(("image/webp", MAX_IMAGE)),
        _ => Err("Only HTML, PNG, JPEG and WebP artifacts are supported.".into()),
    }
}
fn verify(mime: &str, bytes: &[u8]) -> Result<(), String> {
    let valid = match mime {
        "text/html" => {
            bytes.len() as u64 <= MAX_HTML
                && !bytes.is_empty()
                && std::str::from_utf8(bytes).is_ok()
                && !bytes.contains(&0)
        }
        "image/png" | "image/jpeg" | "image/webp" => {
            use super::super::agent_attachment_commands::agent_attachment_store::agent_attachment_image::verify_agent_image_bytes;
            use super::super::agent_thread_store_commands::agent_thread_store::AgentImageMime;
            let image_type = match mime {
                "image/png" => AgentImageMime::Png,
                "image/jpeg" => AgentImageMime::Jpeg,
                _ => AgentImageMime::Webp,
            };
            verify_agent_image_bytes(image_type, bytes).is_ok_and(|dimensions| {
                dimensions.width <= 8192
                    && dimensions.height <= 8192
                    && u64::from(dimensions.width) * u64::from(dimensions.height) <= 16_000_000
            })
        }
        _ => false,
    };
    if valid && bytes.len() as u64 <= MAX_IMAGE {
        Ok(())
    } else {
        Err("Artifact content does not match its supported media type.".into())
    }
}
#[cfg(test)]
#[path = "agent_output_artifact_store_tests.rs"]
mod tests;
