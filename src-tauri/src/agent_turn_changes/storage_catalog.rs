use super::{record_validation, snapshot, storage, types::*};
use std::{fs::File, io::Read, path::Path};

pub(super) struct RootRecords {
    directory: File,
    root: RootIdentity,
}
impl RootRecords {
    pub(super) fn open(base: &Path, root: &RootIdentity) -> Result<Self, String> {
        let path = base.join(snapshot::digest(root.path.as_bytes()));
        Ok(Self {
            directory: storage::directory(&path, false)
                .map_err(|_| "Turn metadata directory unavailable.")?,
            root: root.clone(),
        })
    }
    pub(super) fn records(&self) -> Result<Vec<Record>, String> {
        let mut records = Vec::new();
        let mut total = 0_u64;
        for name in storage::names(&self.directory, 1024)? {
            let path = Path::new(&name);
            if path.extension().is_none_or(|ext| ext != "json")
                || path
                    .file_stem()
                    .is_none_or(|stem| !storage::hash_name(stem))
            {
                continue;
            }
            let file = storage::child_file(&self.directory, &name, libc::O_RDONLY)
                .map_err(|_| "Unsafe checkpoint metadata.")?;
            let metadata = file
                .metadata()
                .map_err(|_| "Checkpoint metadata unavailable.")?;
            if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
                return Err("Checkpoint metadata exceeds size limit.".into());
            }
            total = total.saturating_add(metadata.len());
            if total > MAX_STORAGE_BYTES {
                return Err("Checkpoint metadata exceeds storage limit.".into());
            }
            let mut bytes = Vec::new();
            file.take(MAX_RECORD_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Unable to read checkpoint metadata.")?;
            if bytes.len() as u64 > MAX_RECORD_BYTES {
                return Err("Checkpoint metadata exceeds size limit.".into());
            }
            let record: Record =
                serde_json::from_slice(&bytes).map_err(|_| "Invalid checkpoint metadata.")?;
            record_validation::validate_record(&record, &record.root, &record.turn_id)?;
            if record.root != self.root {
                continue;
            }
            if path.file_stem().and_then(|stem| stem.to_str())
                != Some(snapshot::digest(record.turn_id.as_bytes()).as_str())
            {
                return Err("Checkpoint metadata name mismatch.".into());
            }
            records.push((metadata.modified().ok(), name, record));
        }
        records.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        Ok(records.into_iter().map(|(_, _, record)| record).collect())
    }
    pub(super) fn remove(&self, record: &Record) -> Result<(), String> {
        record_validation::validate_record(record, &self.root, &record.turn_id)?;
        let name = format!("{}.json", snapshot::digest(record.turn_id.as_bytes()));
        storage::unlink(&self.directory, std::ffi::OsStr::new(&name), 0)
            .map_err(|_| "Unable to remove expired checkpoint metadata.".into())
    }
}
