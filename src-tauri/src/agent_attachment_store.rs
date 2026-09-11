use super::agent_attachment_paths::{
    agent_attachment_pending_directory, agent_attachment_pending_file,
    agent_attachment_pending_part_file, agent_attachment_root, agent_attachment_thread_directory,
    agent_attachment_thread_file, ensure_agent_attachment_extension,
    ensure_agent_attachment_file_id, AGENT_ATTACHMENT_ID_PATTERN_LENGTH,
    AGENT_ATTACHMENT_PART_EXTENSION, AGENT_ATTACHMENT_THREADS_DIR_NAME,
    MAX_AGENT_ATTACHMENT_EXTENSION_BYTES,
};
pub(crate) use super::agent_thread_store;

use crate::git_worktree::{safe_agent_task_id, MAX_AGENT_TASK_ID_BYTES};
use agent_attachment_image::{
    agent_image_extension, agent_image_mime_for_extension, matches_agent_image_signature,
    verify_agent_image_bytes, AgentImageDimensions, AGENT_ATTACHMENT_MAGIC_ERROR,
};
use agent_thread_store::{
    fnv1a64hex, AgentImageMime, AGENT_ATTACHMENT_NAME_ERROR, AGENT_ATTACHMENT_PATH_ERROR,
    AGENT_THREAD_STORE_DIR_NAME, MAX_AGENT_ATTACHMENT_NAME_BYTES, MAX_AGENT_ATTACHMENT_PATH_BYTES,
    MAX_AGENT_FILE_BYTES, MAX_AGENT_IMAGE_BYTES, MAX_AGENT_TURN_ATTACHMENTS,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Mutex, PoisonError,
    },
    time::{Duration, SystemTime},
};

#[path = "agent_attachment_image.rs"]
pub mod agent_attachment_image;

pub const MAX_PENDING_AGENT_ATTACHMENTS: usize = 64;
pub const MAX_PENDING_AGENT_ATTACHMENTS_PER_WORKSPACE: usize = 32;
pub const MAX_CLAIMED_AGENT_ATTACHMENTS: usize = 512;
pub const MAX_AGENT_ATTACHMENT_SWEEP_ENTRIES: usize = 512;
pub const MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES: usize = 64;
pub const MAX_AGENT_ATTACHMENT_THREAD_ROOTS: usize = 64;
pub const MAX_AGENT_ATTACHMENT_CANDIDATE_BYTES: u64 = MAX_AGENT_FILE_BYTES;
pub const AGENT_ATTACHMENT_PENDING_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
pub const AGENT_ATTACHMENT_PART_LIFETIME: Duration = Duration::from_secs(60 * 60);

pub const AGENT_ATTACHMENT_UNAVAILABLE_ERROR: &str =
    "Attachment is no longer available. Remove it and try again.";
pub const AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR: &str =
    "The attachment belongs to another workspace session.";
pub const AGENT_ATTACHMENT_CAPACITY_ERROR: &str =
    "Too many attachments are waiting to be sent. Remove one and try again.";
pub const AGENT_ATTACHMENT_NOT_REGULAR_FILE_ERROR: &str = "The attachment is not a regular file.";
pub const AGENT_ATTACHMENT_SIZE_CHANGED_ERROR: &str =
    "The attachment changed on disk before it could be sent.";
pub const AGENT_ATTACHMENT_TOO_LARGE_ERROR: &str =
    "The attachment is larger than the supported size.";
pub const AGENT_ATTACHMENT_KIND_MISMATCH_ERROR: &str =
    "The attachment kind does not match its stored metadata.";
pub const AGENT_ATTACHMENT_SYMLINK_ERROR: &str = "Symlinks cannot be attached.";
pub const AGENT_ATTACHMENT_SIGNATURE_BYTES: u64 = 64;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentAttachmentKind {
    Image,
    File,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageAgentAttachmentHeader {
    pub kind: AgentAttachmentKind,
    pub name: String,
    #[serde(default)]
    pub mime: Option<AgentImageMime>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedAgentAttachment {
    pub attachment_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<AgentImageMime>,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub prompt_line_bytes_max: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedAgentAttachment {
    pub attachment_id: String,
    pub stored_path: String,
    pub prompt_line: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAttachmentCandidate {
    pub bytes: u64,
    pub is_regular_file: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_mime: Option<AgentImageMime>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTurnAttachment {
    pub attachment_id: String,
    pub kind: AgentAttachmentKind,
    pub mime: Option<AgentImageMime>,
    pub bytes: u64,
    pub path: PathBuf,
    pub stored_path: String,
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentAttachmentSweepOutcome {
    pub pending_truncated: bool,
}

pub struct AgentAttachmentOwner<'a> {
    pub workspace_id: &'a str,
    pub thread_id: &'a str,
    pub root_keys: &'a [String],
}

#[derive(Clone, Debug)]
struct AgentAttachmentRecord {
    workspace_id: String,
    thread_id: Option<String>,
    kind: AgentAttachmentKind,
    name: String,
    mime: Option<AgentImageMime>,
    extension: String,
    bytes: u64,
    sequence: u64,
}

#[derive(Default)]
struct AgentAttachmentRegistry {
    pending: HashMap<String, AgentAttachmentRecord>,
    claimed: HashMap<String, AgentAttachmentRecord>,
}

pub struct AgentAttachmentStore {
    base_dir: PathBuf,
    registry: Mutex<AgentAttachmentRegistry>,
    sequence: AtomicU64,
    sweep_cursor: AtomicUsize,
}

impl AgentAttachmentStore {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            registry: Mutex::new(AgentAttachmentRegistry::default()),
            sequence: AtomicU64::new(0),
            sweep_cursor: AtomicUsize::new(0),
        }
    }

    pub fn stage_bytes(
        &self,
        workspace_id: &str,
        header: &StageAgentAttachmentHeader,
        bytes: &[u8],
    ) -> Result<StagedAgentAttachment, String> {
        self.sweep_all();
        let prepared = prepare_staged_attachment(header, bytes)?;
        self.publish_pending(workspace_id, prepared, |path| {
            write_private_file(path, bytes)
        })
    }

    pub fn stage_from_path(
        &self,
        workspace_id: &str,
        header: &StageAgentAttachmentHeader,
        path: &str,
    ) -> Result<StagedAgentAttachment, String> {
        self.sweep_all();
        let bytes = read_candidate_file(path, staged_limit(header.kind))?;
        let prepared = prepare_staged_attachment(header, &bytes)?;
        self.publish_pending(workspace_id, prepared, move |target| {
            write_private_file(target, &bytes)
        })
    }

    pub fn inspect_candidate(&self, path: &str) -> Result<AgentAttachmentCandidate, String> {
        ensure_candidate_path(path)?;
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("The attachment could not be read: {error}"))?;
        Ok(AgentAttachmentCandidate {
            bytes: metadata.len(),
            is_regular_file: metadata.file_type().is_file(),
            extension_mime: Path::new(path)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
                .and_then(agent_image_mime_for_extension),
        })
    }

    pub fn read_candidate(&self, path: &str) -> Result<Vec<u8>, String> {
        read_candidate_file(path, MAX_AGENT_ATTACHMENT_CANDIDATE_BYTES)
    }

    pub fn release(&self, workspace_id: &str, attachment_id: &str) -> Result<(), String> {
        ensure_agent_attachment_file_id(attachment_id)?;
        let Some(record) = self.take_pending(workspace_id, attachment_id)? else {
            return Ok(());
        };
        let path = agent_attachment_pending_file(&self.base_dir, attachment_id, &record.extension)?;
        remove_file_if_present(&path)
    }

    pub fn claim(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_ids: &[String],
    ) -> Result<Vec<ClaimedAgentAttachment>, String> {
        let thread_id = safe_agent_task_id(owner.thread_id)?;
        ensure_attachment_id_set(attachment_ids)?;
        let reserved = self.reserve_pending(owner.workspace_id, attachment_ids)?;
        let directory = agent_attachment_thread_directory(&self.base_dir, &thread_id)?;
        if let Err(error) = create_private_directory(&directory) {
            self.restore_pending(reserved);
            return Err(error);
        }
        let claimed = match self.rename_reserved_into_thread(&thread_id, &reserved) {
            Ok(claimed) => claimed,
            Err(error) => {
                self.restore_pending(reserved);
                return Err(error);
            }
        };
        self.record_claimed(&thread_id, reserved);
        Ok(claimed)
    }

    pub fn claim_for_turn(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_ids: &[String],
    ) -> Result<Vec<ResolvedTurnAttachment>, String> {
        safe_agent_task_id(owner.thread_id)?;
        ensure_attachment_id_set(attachment_ids)?;
        let pending = self.pending_ids(attachment_ids);
        if !pending.is_empty() {
            self.claim(owner, &pending)?;
        }
        attachment_ids
            .iter()
            .map(|attachment_id| self.resolve_turn_attachment(owner, attachment_id))
            .collect()
    }

    pub fn read_claimed(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_id: &str,
        limit: u64,
    ) -> Result<Vec<u8>, String> {
        let path = self.resolve_claimed_path(owner, attachment_id)?;
        read_bounded_file(&path, limit)
    }

    pub fn read_turn_image(&self, attachment: &ResolvedTurnAttachment) -> Result<Vec<u8>, String> {
        if attachment.kind != AgentAttachmentKind::Image {
            return Err(AGENT_ATTACHMENT_KIND_MISMATCH_ERROR.to_string());
        }
        let bytes = read_bounded_file(&attachment.path, MAX_AGENT_IMAGE_BYTES)?;
        if bytes.len() as u64 != attachment.bytes {
            return Err(AGENT_ATTACHMENT_SIZE_CHANGED_ERROR.to_string());
        }
        Ok(bytes)
    }

    pub fn resolve_claimed_path(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_id: &str,
    ) -> Result<PathBuf, String> {
        let thread_id = safe_agent_task_id(owner.thread_id)?;
        ensure_agent_attachment_file_id(attachment_id)?;
        let record = self.claimed_record(owner, attachment_id)?;
        let extension = self.stored_extension(&thread_id, attachment_id)?;
        if record.is_none() {
            self.ensure_thread_belongs_to_owner(owner)?;
        }
        let path =
            agent_attachment_thread_file(&self.base_dir, &thread_id, attachment_id, &extension)?;
        ensure_regular_file(&path)?;
        Ok(path)
    }

    pub fn sweep(&self) -> AgentAttachmentSweepOutcome {
        AgentAttachmentSweepOutcome {
            pending_truncated: self.sweep_pending().unwrap_or(false),
        }
    }

    pub fn sweep_all(&self) -> AgentAttachmentSweepOutcome {
        let outcome = self.sweep();
        let _ = self.sweep_orphan_thread_directories();
        outcome
    }

    fn publish_pending<W>(
        &self,
        workspace_id: &str,
        prepared: PreparedAgentAttachment,
        write: W,
    ) -> Result<StagedAgentAttachment, String>
    where
        W: FnOnce(&Path) -> Result<(), String>,
    {
        ensure_workspace_owner(workspace_id)?;
        let attachment_id = self.mint_attachment_id();
        let record = AgentAttachmentRecord {
            workspace_id: workspace_id.to_string(),
            thread_id: None,
            kind: prepared.kind,
            name: prepared.name.clone(),
            mime: prepared.mime,
            extension: prepared.extension.clone(),
            bytes: prepared.bytes,
            sequence: self.next_sequence(),
        };
        self.reserve_capacity(workspace_id)?;
        let part = agent_attachment_pending_part_file(&self.base_dir, &attachment_id)?;
        let target =
            agent_attachment_pending_file(&self.base_dir, &attachment_id, &prepared.extension)?;
        create_private_directory(&agent_attachment_pending_directory(&self.base_dir)?)?;
        write(&part)?;
        if let Err(error) = fs::rename(&part, &target) {
            let _ = fs::remove_file(&part);
            return Err(format!("Unable to save the attachment: {error}"));
        }
        self.registry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pending
            .insert(attachment_id.clone(), record);
        let prompt_line_bytes_max = self.prompt_line_bytes_max(prepared.kind, &prepared.name);
        Ok(StagedAgentAttachment {
            attachment_id,
            name: prepared.name,
            mime: prepared.mime,
            bytes: prepared.bytes,
            width: prepared.dimensions.map(|value| value.width),
            height: prepared.dimensions.map(|value| value.height),
            prompt_line_bytes_max,
        })
    }

    fn prompt_line_bytes_max(&self, kind: AgentAttachmentKind, name: &str) -> usize {
        let longest_file = agent_attachment_root(&self.base_dir)
            .join(AGENT_ATTACHMENT_THREADS_DIR_NAME)
            .to_string_lossy()
            .len()
            + 1
            + MAX_AGENT_TASK_ID_BYTES
            + 1
            + AGENT_ATTACHMENT_ID_PATTERN_LENGTH
            + 1
            + MAX_AGENT_ATTACHMENT_EXTENSION_BYTES;
        prompt_line(kind, name, &"x".repeat(longest_file)).len()
    }

    fn mint_attachment_id(&self) -> String {
        loop {
            let candidate = mint_attachment_id_bytes(self.next_sequence());
            let registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
            if !registry.pending.contains_key(&candidate)
                && !registry.claimed.contains_key(&candidate)
            {
                return candidate;
            }
        }
    }

    fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst)
    }

    fn reserve_capacity(&self, workspace_id: &str) -> Result<(), String> {
        let registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        if registry.pending.len() >= MAX_PENDING_AGENT_ATTACHMENTS {
            return Err(AGENT_ATTACHMENT_CAPACITY_ERROR.to_string());
        }
        let owned = registry
            .pending
            .values()
            .filter(|record| record.workspace_id == workspace_id)
            .count();
        if owned >= MAX_PENDING_AGENT_ATTACHMENTS_PER_WORKSPACE {
            return Err(AGENT_ATTACHMENT_CAPACITY_ERROR.to_string());
        }
        Ok(())
    }

    fn take_pending(
        &self,
        workspace_id: &str,
        attachment_id: &str,
    ) -> Result<Option<AgentAttachmentRecord>, String> {
        let mut registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(record) = registry.pending.get(attachment_id) else {
            return Ok(None);
        };
        if record.workspace_id != workspace_id {
            return Err(AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR.to_string());
        }
        Ok(registry.pending.remove(attachment_id))
    }

    fn pending_ids(&self, attachment_ids: &[String]) -> Vec<String> {
        let registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        attachment_ids
            .iter()
            .filter(|attachment_id| registry.pending.contains_key(*attachment_id))
            .cloned()
            .collect()
    }

    fn reserve_pending(
        &self,
        workspace_id: &str,
        attachment_ids: &[String],
    ) -> Result<Vec<(String, AgentAttachmentRecord)>, String> {
        let mut registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        for attachment_id in attachment_ids {
            match registry.pending.get(attachment_id) {
                None => return Err(AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string()),
                Some(record) if record.workspace_id != workspace_id => {
                    return Err(AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR.to_string())
                }
                Some(_) => {}
            }
        }
        Ok(attachment_ids
            .iter()
            .filter_map(|attachment_id| {
                registry
                    .pending
                    .remove(attachment_id)
                    .map(|record| (attachment_id.clone(), record))
            })
            .collect())
    }

    fn restore_pending(&self, reserved: Vec<(String, AgentAttachmentRecord)>) {
        let mut registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        for (attachment_id, record) in reserved {
            registry.pending.insert(attachment_id, record);
        }
    }

    fn record_claimed(&self, thread_id: &str, reserved: Vec<(String, AgentAttachmentRecord)>) {
        let mut registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        if registry.claimed.len() + reserved.len() > MAX_CLAIMED_AGENT_ATTACHMENTS {
            evict_oldest_claimed(&mut registry.claimed, reserved.len());
        }
        for (attachment_id, mut record) in reserved {
            record.thread_id = Some(thread_id.to_string());
            registry.claimed.insert(attachment_id, record);
        }
    }

    fn rename_reserved_into_thread(
        &self,
        thread_id: &str,
        reserved: &[(String, AgentAttachmentRecord)],
    ) -> Result<Vec<ClaimedAgentAttachment>, String> {
        let mut claimed = Vec::with_capacity(reserved.len());
        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(reserved.len());
        for (attachment_id, record) in reserved {
            let source =
                agent_attachment_pending_file(&self.base_dir, attachment_id, &record.extension)?;
            let target = agent_attachment_thread_file(
                &self.base_dir,
                thread_id,
                attachment_id,
                &record.extension,
            )?;
            let stored_path = match path_text(&target) {
                Ok(stored_path) => stored_path,
                Err(error) => {
                    roll_back_renames(&moved);
                    return Err(error);
                }
            };
            if let Err(error) = fs::rename(&source, &target) {
                roll_back_renames(&moved);
                return Err(claim_failure(error));
            }
            moved.push((target, source));
            claimed.push(ClaimedAgentAttachment {
                prompt_line: prompt_line(record.kind, &record.name, &stored_path),
                attachment_id: attachment_id.clone(),
                stored_path,
            });
        }
        Ok(claimed)
    }

    fn claimed_record(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_id: &str,
    ) -> Result<Option<AgentAttachmentRecord>, String> {
        let registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(record) = registry.claimed.get(attachment_id) else {
            return Ok(None);
        };
        if record.workspace_id != owner.workspace_id
            || record.thread_id.as_deref() != Some(owner.thread_id)
        {
            return Err(AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR.to_string());
        }
        Ok(Some(record.clone()))
    }

    fn ensure_thread_belongs_to_owner(
        &self,
        owner: &AgentAttachmentOwner<'_>,
    ) -> Result<(), String> {
        match owner
            .root_keys
            .iter()
            .any(|root_key| self.thread_file_exists_for_root_key(root_key, owner.thread_id))
        {
            true => Ok(()),
            false => Err(AGENT_ATTACHMENT_WORKSPACE_MISMATCH_ERROR.to_string()),
        }
    }

    fn thread_file_exists_for_root_key(&self, root_key: &str, thread_id: &str) -> bool {
        self.base_dir
            .join(AGENT_THREAD_STORE_DIR_NAME)
            .join(fnv1a64hex(root_key))
            .join(format!("{thread_id}.json"))
            .is_file()
    }

    pub fn forget_claimed(&self, attachment_ids: &[String]) {
        let mut registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        for attachment_id in attachment_ids {
            registry.claimed.remove(attachment_id);
        }
    }

    fn resolve_turn_attachment(
        &self,
        owner: &AgentAttachmentOwner<'_>,
        attachment_id: &str,
    ) -> Result<ResolvedTurnAttachment, String> {
        ensure_agent_attachment_file_id(attachment_id)?;
        let record = self.claimed_record(owner, attachment_id)?;
        let extension = match &record {
            Some(record) => record.extension.clone(),
            None => {
                let extension = self.stored_extension(owner.thread_id, attachment_id)?;
                self.ensure_thread_belongs_to_owner(owner)?;
                extension
            }
        };
        let path = agent_attachment_thread_file(
            &self.base_dir,
            owner.thread_id,
            attachment_id,
            &extension,
        )?;
        let size = ensure_regular_file(&path)?;
        if record.as_ref().is_some_and(|record| record.bytes != size) {
            return Err(AGENT_ATTACHMENT_SIZE_CHANGED_ERROR.to_string());
        }
        let mime = match &record {
            Some(record) => record.mime,
            None => agent_image_mime_for_extension(&extension),
        };
        if let Some(mime) = mime {
            let head = read_file_prefix(&path, AGENT_ATTACHMENT_SIGNATURE_BYTES)?;
            if !matches_agent_image_signature(mime, &head) {
                return Err(AGENT_ATTACHMENT_MAGIC_ERROR.to_string());
            }
        }
        let kind = match (&record, mime) {
            (Some(record), _) => record.kind,
            (None, Some(_)) => AgentAttachmentKind::Image,
            (None, None) => AgentAttachmentKind::File,
        };
        Ok(ResolvedTurnAttachment {
            attachment_id: attachment_id.to_string(),
            kind,
            mime,
            bytes: size,
            stored_path: path_text(&path)?,
            name: record.map(|record| record.name),
            path,
        })
    }

    fn stored_extension(&self, thread_id: &str, attachment_id: &str) -> Result<String, String> {
        if let Some(record) = self
            .registry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .claimed
            .get(attachment_id)
        {
            return Ok(record.extension.clone());
        }
        let directory = agent_attachment_thread_directory(&self.base_dir, thread_id)?;
        let reader =
            fs::read_dir(&directory).map_err(|_| AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string())?;
        for entry in reader.take(MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES) {
            let Ok(entry) = entry else {
                continue;
            };
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            let Some((stem, extension)) = file_name.rsplit_once('.') else {
                continue;
            };
            if stem != attachment_id || ensure_agent_attachment_extension(extension).is_err() {
                continue;
            }
            return Ok(extension.to_string());
        }
        Err(AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string())
    }

    fn sweep_pending(&self) -> Result<bool, String> {
        let directory = agent_attachment_pending_directory(&self.base_dir)?;
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => return Ok(false),
        };
        let now = SystemTime::now();
        let cursor = self.sweep_cursor.load(Ordering::SeqCst);
        let mut examined = 0;
        let mut removed = 0;
        let mut skipped = 0;
        for entry in reader {
            if skipped < cursor {
                skipped += 1;
                continue;
            }
            if examined >= MAX_AGENT_ATTACHMENT_SWEEP_ENTRIES {
                self.sweep_cursor
                    .store(cursor + examined - removed, Ordering::SeqCst);
                return Ok(true);
            }
            examined += 1;
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.file_type().is_file() {
                continue;
            }
            let lifetime = match entry.path().extension().and_then(|value| value.to_str()) {
                Some(AGENT_ATTACHMENT_PART_EXTENSION) => AGENT_ATTACHMENT_PART_LIFETIME,
                _ => AGENT_ATTACHMENT_PENDING_LIFETIME,
            };
            if !older_than(&metadata, now, lifetime) {
                continue;
            }
            let _ = fs::remove_file(entry.path());
            self.forget_pending_path(&entry.path());
            removed += 1;
        }
        self.sweep_cursor.store(0, Ordering::SeqCst);
        Ok(false)
    }

    fn forget_pending_path(&self, path: &Path) {
        let Some(attachment_id) = path.file_stem().and_then(|value| value.to_str()) else {
            return;
        };
        self.registry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pending
            .remove(attachment_id);
    }

    fn sweep_orphan_thread_directories(&self) -> Result<(), String> {
        let directory =
            agent_attachment_root(&self.base_dir).join(AGENT_ATTACHMENT_THREADS_DIR_NAME);
        let reader = match fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => return Ok(()),
        };
        let now = SystemTime::now();
        for entry in reader.take(MAX_AGENT_ATTACHMENT_SWEEP_ENTRIES) {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_dir() || !older_than(&metadata, now, AGENT_ATTACHMENT_PENDING_LIFETIME)
            {
                continue;
            }
            let file_name = entry.file_name();
            let Some(thread_id) = file_name.to_str() else {
                continue;
            };
            if safe_agent_task_id(thread_id).is_err()
                || self.thread_file_exists_in_any_root(thread_id)
                || self.holds_claimed_thread(thread_id)
            {
                continue;
            }
            let Ok(resolved) = agent_attachment_thread_directory(&self.base_dir, thread_id) else {
                continue;
            };
            let _ = fs::remove_dir_all(resolved);
        }
        Ok(())
    }

    fn holds_claimed_thread(&self, thread_id: &str) -> bool {
        self.registry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .claimed
            .values()
            .any(|record| record.thread_id.as_deref() == Some(thread_id))
    }

    fn thread_file_exists_in_any_root(&self, thread_id: &str) -> bool {
        let roots = match fs::read_dir(self.base_dir.join(AGENT_THREAD_STORE_DIR_NAME)) {
            Ok(roots) => roots,
            Err(error) if error.kind() == ErrorKind::NotFound => return false,
            Err(_) => return true,
        };
        let file_name = format!("{thread_id}.json");
        for (scanned, root) in roots.enumerate() {
            if scanned >= MAX_AGENT_ATTACHMENT_THREAD_ROOTS {
                return true;
            }
            let Ok(root) = root else {
                return true;
            };
            if root.path().join(&file_name).is_file() {
                return true;
            }
        }
        false
    }
}

struct PreparedAgentAttachment {
    kind: AgentAttachmentKind,
    name: String,
    mime: Option<AgentImageMime>,
    extension: String,
    bytes: u64,
    dimensions: Option<AgentImageDimensions>,
}

fn prepare_staged_attachment(
    header: &StageAgentAttachmentHeader,
    bytes: &[u8],
) -> Result<PreparedAgentAttachment, String> {
    ensure_attachment_name(&header.name)?;
    let size = bytes.len() as u64;
    if size == 0 || size > staged_limit(header.kind) {
        return Err(AGENT_ATTACHMENT_TOO_LARGE_ERROR.to_string());
    }
    if header.kind == AgentAttachmentKind::File {
        if header.mime.is_some() || header.width.is_some() || header.height.is_some() {
            return Err(AGENT_ATTACHMENT_KIND_MISMATCH_ERROR.to_string());
        }
        return Ok(PreparedAgentAttachment {
            kind: header.kind,
            name: header.name.clone(),
            mime: None,
            extension: staged_file_extension(&header.name),
            bytes: size,
            dimensions: None,
        });
    }
    let Some(mime) = header.mime else {
        return Err(AGENT_ATTACHMENT_KIND_MISMATCH_ERROR.to_string());
    };
    let dimensions = verify_agent_image_bytes(mime, bytes)?;
    if header.width.is_some_and(|width| width != dimensions.width)
        || header
            .height
            .is_some_and(|height| height != dimensions.height)
    {
        return Err(AGENT_ATTACHMENT_KIND_MISMATCH_ERROR.to_string());
    }
    Ok(PreparedAgentAttachment {
        kind: header.kind,
        name: header.name.clone(),
        mime: Some(mime),
        extension: agent_image_extension(mime).to_string(),
        bytes: size,
        dimensions: Some(dimensions),
    })
}

pub fn prompt_line(kind: AgentAttachmentKind, name: &str, stored_path: &str) -> String {
    match kind {
        AgentAttachmentKind::Image => {
            format!("[Attached image \"{name}\" is saved at: {stored_path}]")
        }
        AgentAttachmentKind::File => {
            format!("[Attached file \"{name}\" is saved at: {stored_path}]")
        }
    }
}

fn staged_limit(kind: AgentAttachmentKind) -> u64 {
    match kind {
        AgentAttachmentKind::Image => MAX_AGENT_IMAGE_BYTES,
        AgentAttachmentKind::File => MAX_AGENT_FILE_BYTES,
    }
}

fn staged_file_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|extension| ensure_agent_attachment_extension(extension).is_ok())
        .unwrap_or_else(|| "bin".to_string())
}

fn ensure_attachment_name(candidate: &str) -> Result<(), String> {
    if candidate.is_empty()
        || candidate.len() > MAX_AGENT_ATTACHMENT_NAME_BYTES
        || candidate
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '"') || character.is_control())
    {
        return Err(AGENT_ATTACHMENT_NAME_ERROR.to_string());
    }
    Ok(())
}

fn ensure_candidate_path(candidate: &str) -> Result<(), String> {
    if !candidate.starts_with('/')
        || candidate.len() > MAX_AGENT_ATTACHMENT_PATH_BYTES
        || candidate.chars().any(char::is_control)
    {
        return Err(AGENT_ATTACHMENT_PATH_ERROR.to_string());
    }
    Ok(())
}

fn ensure_workspace_owner(workspace_id: &str) -> Result<(), String> {
    if workspace_id.is_empty() {
        return Err("Agent attachment workspace id is required.".to_string());
    }
    Ok(())
}

fn ensure_attachment_id_set(attachment_ids: &[String]) -> Result<(), String> {
    if attachment_ids.len() > MAX_AGENT_TURN_ATTACHMENTS {
        return Err(format!(
            "Agent turn exceeds the maximum of {MAX_AGENT_TURN_ATTACHMENTS} attachments."
        ));
    }
    for (index, attachment_id) in attachment_ids.iter().enumerate() {
        ensure_agent_attachment_file_id(attachment_id)?;
        if attachment_ids[..index].contains(attachment_id) {
            return Err("Agent turn attachments must have unique attachment ids.".to_string());
        }
    }
    Ok(())
}

fn claim_failure(error: std::io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        return AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string();
    }
    format!("Unable to attach the files to this thread: {error}")
}

fn roll_back_renames(moved: &[(PathBuf, PathBuf)]) {
    for (target, source) in moved.iter().rev() {
        let _ = fs::rename(target, source);
    }
}

fn evict_oldest_claimed(claimed: &mut HashMap<String, AgentAttachmentRecord>, room: usize) {
    let mut ordered: Vec<(String, u64)> = claimed
        .iter()
        .map(|(attachment_id, record)| (attachment_id.clone(), record.sequence))
        .collect();
    ordered.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
    let excess = (claimed.len() + room).saturating_sub(MAX_CLAIMED_AGENT_ATTACHMENTS);
    for (attachment_id, _) in ordered.into_iter().take(excess) {
        claimed.remove(&attachment_id);
    }
}

fn older_than(metadata: &fs::Metadata, now: SystemTime, lifetime: Duration) -> bool {
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    now.duration_since(modified)
        .map(|elapsed| elapsed >= lifetime)
        .unwrap_or(false)
}

fn path_text(path: &Path) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or_else(|| AGENT_ATTACHMENT_PATH_ERROR.to_string())?;
    ensure_candidate_path(text)?;
    Ok(text.to_string())
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to remove the attachment: {error}")),
    }
}

fn open_without_following(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|error| match symlink_refusal(&error) {
            true => AGENT_ATTACHMENT_SYMLINK_ERROR.to_string(),
            false => AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string(),
        })
}

#[cfg(unix)]
fn symlink_refusal(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(not(unix))]
fn symlink_refusal(_error: &std::io::Error) -> bool {
    false
}

fn ensure_regular_file(path: &Path) -> Result<u64, String> {
    let handle = open_without_following(path)?;
    let metadata = handle
        .metadata()
        .map_err(|_| AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string())?;
    if !metadata.file_type().is_file() {
        return Err(AGENT_ATTACHMENT_NOT_REGULAR_FILE_ERROR.to_string());
    }
    Ok(metadata.len())
}

fn read_bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let handle = open_without_following(path)?;
    let metadata = handle
        .metadata()
        .map_err(|_| AGENT_ATTACHMENT_UNAVAILABLE_ERROR.to_string())?;
    if !metadata.file_type().is_file() {
        return Err(AGENT_ATTACHMENT_NOT_REGULAR_FILE_ERROR.to_string());
    }
    if metadata.len() > limit {
        return Err(AGENT_ATTACHMENT_TOO_LARGE_ERROR.to_string());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    handle
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("The attachment could not be read: {error}"))?;
    if bytes.len() as u64 != metadata.len() {
        return Err(AGENT_ATTACHMENT_SIZE_CHANGED_ERROR.to_string());
    }
    Ok(bytes)
}

fn read_file_prefix(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let handle = open_without_following(path)?;
    let mut bytes = Vec::new();
    handle
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("The attachment could not be read: {error}"))?;
    Ok(bytes)
}

fn read_candidate_file(path: &str, limit: u64) -> Result<Vec<u8>, String> {
    ensure_candidate_path(path)?;
    read_bounded_file(Path::new(path), limit)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut handle = options
        .open(path)
        .map_err(|error| format!("Unable to save the attachment: {error}"))?;
    handle
        .write_all(bytes)
        .map_err(|error| format!("Unable to save the attachment: {error}"))?;
    handle
        .sync_all()
        .map_err(|error| format!("Unable to save the attachment: {error}"))?;
    Ok(())
}

fn create_private_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create the attachment store: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(directory, fs::Permissions::from_mode(0o700));
        if let Some(parent) = directory.parent() {
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    Ok(())
}

fn mint_attachment_id_bytes(sequence: u64) -> String {
    let mut raw = [0u8; 16];
    if let Ok(mut handle) = fs::File::open("/dev/urandom") {
        if handle.read_exact(&mut raw).is_ok() {
            return hexadecimal(&raw);
        }
    }
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(sequence.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
            .to_le_bytes(),
    );
    raw.copy_from_slice(&hasher.finalize()[..16]);
    hexadecimal(&raw)
}

fn hexadecimal(raw: &[u8]) -> String {
    raw.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
#[path = "agent_attachment_store_tests.rs"]
mod tests;
