use super::{
    safe_agent_task_id, validate_agent_thread_document, AgentThread, AgentThreadDocument,
    AGENT_THREAD_STORE_FULL_ERROR, MAX_AGENT_THREADS_PER_ROOT, MAX_AGENT_THREAD_FILE_BYTES,
    MAX_AGENT_THREAD_ROOT_BYTES,
};
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_AGENT_THREAD_DIRECTORY_ENTRIES: usize = 1024;
pub(super) const ROOT_USAGE_RESCAN_SAVES: u32 = 32;
const ROOT_USAGE_RESCAN_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Default)]
pub(super) struct RootUsageCache {
    usage: Option<RootUsage>,
}

#[derive(Debug)]
struct RootUsage {
    sizes: HashMap<String, u64>,
    total_bytes: u64,
    saves_since_scan: u32,
    scanned_at: Instant,
}

impl RootUsage {
    fn scanned(entries: &[RootDirectoryEntry]) -> Self {
        let sizes: HashMap<String, u64> = entries
            .iter()
            .map(|entry| (entry.thread_id.clone(), entry.size))
            .collect();
        Self {
            total_bytes: sizes.values().sum(),
            sizes,
            saves_since_scan: 0,
            scanned_at: Instant::now(),
        }
    }

    fn is_fresh(&self) -> bool {
        self.saves_since_scan < ROOT_USAGE_RESCAN_SAVES
            && self.scanned_at.elapsed() < ROOT_USAGE_RESCAN_INTERVAL
    }

    fn others(&self, thread_id: &str) -> (usize, u64) {
        match self.sizes.get(thread_id) {
            Some(size) => (self.sizes.len() - 1, self.total_bytes - size),
            None => (self.sizes.len(), self.total_bytes),
        }
    }

    fn record(&mut self, thread_id: &str, bytes: u64) {
        self.forget(thread_id);
        self.sizes.insert(thread_id.to_string(), bytes);
        self.total_bytes += bytes;
        self.saves_since_scan += 1;
    }

    fn forget(&mut self, thread_id: &str) {
        if let Some(size) = self.sizes.remove(thread_id) {
            self.total_bytes -= size;
        }
    }
}

impl RootUsageCache {
    pub(super) fn admit(
        &mut self,
        root_key: &str,
        directory: &Path,
        thread_id: &str,
        incoming_bytes: u64,
    ) -> Result<(), String> {
        if let Some(usage) = self
            .usage
            .as_ref()
            .filter(|usage| usage.is_fresh() && usage.sizes.contains_key(thread_id))
        {
            let (count, bytes) = usage.others(thread_id);
            if !over_budget(count + 1, bytes + incoming_bytes) {
                return Ok(());
            }
        }
        self.usage = None;
        let entries = root_directory_entries(directory)?;
        let mut stored: Vec<StoredThreadFile> = entries
            .iter()
            .filter(|entry| entry.thread_id != thread_id)
            .map(|entry| StoredThreadFile {
                thread_id: entry.thread_id.clone(),
                path: entry.path.clone(),
                size: entry.size,
                updated_at_epoch_ms: 0,
                evictable: false,
            })
            .collect();
        if over_budget(stored.len() + 1, stored_bytes(&stored) + incoming_bytes) {
            classify_evictable(root_key, &mut stored);
            let (_, within_budget) = evict_to_budget(&mut stored, 1, incoming_bytes);
            if !within_budget {
                return Err(AGENT_THREAD_STORE_FULL_ERROR.to_string());
            }
            return Ok(());
        }
        self.usage = Some(RootUsage::scanned(&entries));
        Ok(())
    }

    pub(super) fn settle_save(&mut self, thread_id: &str, bytes: u64, saved: bool) {
        if !saved {
            self.usage = None;
            return;
        }
        if let Some(usage) = self.usage.as_mut() {
            usage.record(thread_id, bytes);
        }
    }

    pub(super) fn forget(&mut self, thread_id: &str) {
        if let Some(usage) = self.usage.as_mut() {
            usage.forget(thread_id);
        }
    }

    pub(super) fn invalidate(&mut self) {
        self.usage = None;
    }
}

#[derive(Clone, Debug)]
pub(super) struct StoredThreadFile {
    pub(super) thread_id: String,
    pub(super) path: PathBuf,
    pub(super) size: u64,
    pub(super) updated_at_epoch_ms: u64,
    pub(super) evictable: bool,
}

pub(super) fn thread_is_evictable(thread: &AgentThread) -> bool {
    !thread.pinned && thread.turns.iter().all(|turn| turn.status.is_terminal())
}

#[derive(Clone, Debug)]
pub(super) struct RootDirectoryEntry {
    pub(super) thread_id: String,
    pub(super) path: PathBuf,
    pub(super) size: u64,
}

pub(super) fn root_directory_entries(directory: &Path) -> Result<Vec<RootDirectoryEntry>, String> {
    let reader = match fs::read_dir(directory) {
        Ok(reader) => reader,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to read the agent thread store: {error}")),
    };
    let mut entries = Vec::new();
    for entry in reader.take(MAX_AGENT_THREAD_DIRECTORY_ENTRIES) {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if file_name.contains(".json.tmp-") {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        let Some(thread_id) = file_name.strip_suffix(".json") else {
            continue;
        };
        if safe_agent_task_id(thread_id).is_err() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        entries.push(RootDirectoryEntry {
            thread_id: thread_id.to_string(),
            path: entry.path(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
    Ok(entries)
}

pub(super) fn read_thread_file(
    root_key: &str,
    entry: &RootDirectoryEntry,
) -> Result<AgentThread, String> {
    if entry.size > MAX_AGENT_THREAD_FILE_BYTES as u64 {
        return Err("The saved thread exceeds the supported file size.".to_string());
    }
    let content = fs::read_to_string(&entry.path)
        .map_err(|error| format!("The saved thread could not be read: {error}"))?;
    let document: AgentThreadDocument = serde_json::from_str(&content)
        .map_err(|error| format!("The saved thread is not valid JSON: {error}"))?;
    validate_agent_thread_document(root_key, &document)?;
    if document.thread.thread_id != entry.thread_id {
        return Err("The saved thread identifier does not match its file name.".to_string());
    }
    Ok(document.thread)
}

pub(super) fn classify_evictable(root_key: &str, stored: &mut [StoredThreadFile]) {
    for file in stored.iter_mut() {
        let entry = RootDirectoryEntry {
            thread_id: file.thread_id.clone(),
            path: file.path.clone(),
            size: file.size,
        };
        let Ok(thread) = read_thread_file(root_key, &entry) else {
            continue;
        };
        file.updated_at_epoch_ms = thread.updated_at_epoch_ms;
        file.evictable = thread_is_evictable(&thread);
    }
}

pub(super) fn stored_bytes(stored: &[StoredThreadFile]) -> u64 {
    stored.iter().map(|file| file.size).sum()
}

pub(super) fn over_budget(count: usize, bytes: u64) -> bool {
    count > MAX_AGENT_THREADS_PER_ROOT || bytes > MAX_AGENT_THREAD_ROOT_BYTES
}

pub(super) fn evict_to_budget(
    stored: &mut Vec<StoredThreadFile>,
    extra_count: usize,
    extra_bytes: u64,
) -> (usize, bool) {
    let mut evicted = 0;
    loop {
        if !over_budget(
            stored.len() + extra_count,
            stored_bytes(stored) + extra_bytes,
        ) {
            return (evicted, true);
        }
        let Some(index) = evictable_index(stored) else {
            return (evicted, false);
        };
        let victim = stored.remove(index);
        let _ = fs::remove_file(&victim.path);
        evicted += 1;
    }
}

fn evictable_index(stored: &[StoredThreadFile]) -> Option<usize> {
    stored
        .iter()
        .enumerate()
        .filter(|(_, file)| file.evictable)
        .min_by(|(_, left), (_, right)| {
            left.updated_at_epoch_ms
                .cmp(&right.updated_at_epoch_ms)
                .then_with(|| left.thread_id.cmp(&right.thread_id))
        })
        .map(|(index, _)| index)
}
