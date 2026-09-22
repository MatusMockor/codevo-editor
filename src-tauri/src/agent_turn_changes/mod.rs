//! Durable bounded snapshots of the on-disk working tree before and after each agent turn.
//! These never mutate the live Git index, references, files, or repository configuration.
mod compare;
mod git_process;
mod snapshot;
mod storage;
mod types;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use types::*;
pub(crate) use types::{CapturePhase, TurnChangesSummary, TurnFileDiff};

pub(crate) struct AgentTurnChangesStore {
    base: PathBuf,
    active: Mutex<HashSet<String>>,
}
struct Permit<'a> {
    store: &'a AgentTurnChangesStore,
    root: String,
}
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.store
            .active
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.root);
    }
}
impl AgentTurnChangesStore {
    pub(crate) fn new(base: PathBuf) -> Self {
        let base = base
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .zip(base.file_name())
            .map(|(parent, name)| parent.join(name))
            .unwrap_or(base);
        Self {
            base: base.join("agent-turn-changes"),
            active: Mutex::new(HashSet::new()),
        }
    }
    fn permit(&self, root: &str) -> Result<Permit<'_>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Turn changes are temporarily unavailable.")?;
        if active.len() >= 2 || !active.insert(root.to_owned()) {
            return Err("Turn changes are already being recorded.".into());
        }
        Ok(Permit {
            store: self,
            root: root.to_owned(),
        })
    }
    #[cfg(test)]
    pub(crate) fn capture(
        &self,
        root: &Path,
        turn_id: &str,
        phase: CapturePhase,
    ) -> Result<TurnChangesSummary, String> {
        self.capture_inner(root, turn_id, phase, None)
    }
    pub(crate) fn capture_with_authority(
        &self,
        root: &Path,
        turn_id: &str,
        phase: CapturePhase,
        authority: &std::fs::File,
    ) -> Result<TurnChangesSummary, String> {
        self.capture_inner(root, turn_id, phase, Some(authority))
    }
    fn capture_inner(
        &self,
        root: &Path,
        turn_id: &str,
        phase: CapturePhase,
        authority: Option<&std::fs::File>,
    ) -> Result<TurnChangesSummary, String> {
        validate_turn(turn_id)?;
        let (handle, identity) = snapshot::root_identity(root)?;
        verify_authority(&identity, authority)?;
        let _permit = self.permit(&identity.path)?;
        let path = storage::record_path(&self.base, &identity, turn_id);
        let existing = storage::read(&path)?;
        if let Some(record) = &existing {
            validate_record(record, &identity, turn_id)?;
            if record.finished || matches!(phase, CapturePhase::Before) {
                snapshot::verify_root(&identity)?;
                return Ok(record.summary.clone());
            }
        }
        let mut record = match (existing, phase) {
            (Some(record), CapturePhase::After) => record,
            (None, CapturePhase::After) => {
                return Ok(TurnChangesSummary::unavailable(
                    turn_id,
                    "No snapshot was recorded before this turn.",
                ))
            }
            (_, CapturePhase::Before) => Record {
                version: 1,
                root: identity.clone(),
                turn_id: turn_id.into(),
                before: Snapshot::new(),
                after: None,
                summary: TurnChangesSummary::unavailable(
                    turn_id,
                    "No completed snapshot is available for this turn.",
                ),
                finished: false,
            },
        };
        match snapshot::capture(
            &handle,
            &identity,
            matches!(phase, CapturePhase::After).then_some(&record.before),
        ) {
            Ok(captured) => match phase {
                CapturePhase::Before => record.before = captured,
                CapturePhase::After => {
                    record.summary = match compare::summary(&self.base, &record, &captured) {
                        Ok(summary) => summary,
                        Err(reason) => TurnChangesSummary::unavailable(turn_id, &reason),
                    };
                    record.after = Some(captured);
                    record.finished = true;
                }
            },
            Err(reason) => {
                record.summary = TurnChangesSummary::unavailable(turn_id, &reason);
                record.finished = true;
            }
        }
        snapshot::verify_root(&identity)?;
        storage::write(&path, &record)?;
        storage::prune(&self.base, &path)?;
        Ok(record.summary)
    }
    #[cfg(test)]
    pub(crate) fn get(&self, root: &Path, turn_id: &str) -> Result<TurnChangesSummary, String> {
        self.get_inner(root, turn_id, None)
    }
    pub(crate) fn get_with_authority(
        &self,
        root: &Path,
        turn_id: &str,
        authority: &std::fs::File,
    ) -> Result<TurnChangesSummary, String> {
        self.get_inner(root, turn_id, Some(authority))
    }
    fn get_inner(
        &self,
        root: &Path,
        turn_id: &str,
        authority: Option<&std::fs::File>,
    ) -> Result<TurnChangesSummary, String> {
        validate_turn(turn_id)?;
        let (_, identity) = snapshot::root_identity(root)?;
        verify_authority(&identity, authority)?;
        let Some(record) = storage::read(&storage::record_path(&self.base, &identity, turn_id))?
        else {
            return Ok(TurnChangesSummary::unavailable(
                turn_id,
                "No snapshot is available for this turn.",
            ));
        };
        validate_record(&record, &identity, turn_id)?;
        snapshot::verify_root(&identity)?;
        Ok(record.summary)
    }
    #[cfg(test)]
    pub(crate) fn file_diff(
        &self,
        root: &Path,
        turn_id: &str,
        relative_path: &str,
    ) -> Result<TurnFileDiff, String> {
        self.diff_inner(root, turn_id, relative_path, None)
    }
    pub(crate) fn file_diff_with_authority(
        &self,
        root: &Path,
        turn_id: &str,
        relative_path: &str,
        authority: &std::fs::File,
    ) -> Result<TurnFileDiff, String> {
        self.diff_inner(root, turn_id, relative_path, Some(authority))
    }
    fn diff_inner(
        &self,
        root: &Path,
        turn_id: &str,
        relative_path: &str,
        authority: Option<&std::fs::File>,
    ) -> Result<TurnFileDiff, String> {
        validate_turn(turn_id)?;
        if !snapshot::valid_relative(relative_path) {
            return Err("Invalid turn file path.".into());
        }
        let (_, identity) = snapshot::root_identity(root)?;
        verify_authority(&identity, authority)?;
        let record = storage::read(&storage::record_path(&self.base, &identity, turn_id))?
            .ok_or("No snapshot is available for this turn.")?;
        validate_record(&record, &identity, turn_id)?;
        if record.summary.state != ChangesState::Ready
            || !record
                .summary
                .files
                .iter()
                .any(|file| file.relative_path == relative_path)
        {
            return Err("This file is not available in the recorded turn changes.".into());
        }
        let before = record.before.get(relative_path);
        let after = record
            .after
            .as_ref()
            .and_then(|snapshot| snapshot.get(relative_path));
        let unavailable_reason = before
            .and_then(|entry| entry.unavailable.clone())
            .or_else(|| after.and_then(|entry| entry.unavailable.clone()));
        let side = |entry: Option<&Entry>| DiffSide {
            text: if unavailable_reason.is_none() {
                entry
                    .and_then(|entry| entry.text.clone())
                    .unwrap_or_default()
            } else {
                String::new()
            },
            truncated: false,
        };
        snapshot::verify_root(&identity)?;
        Ok(TurnFileDiff {
            relative_path: relative_path.into(),
            original: side(before),
            modified: side(after),
            unavailable_reason,
        })
    }
}
fn validate_turn(turn_id: &str) -> Result<(), String> {
    if turn_id.is_empty() || turn_id.len() > 256 || turn_id.chars().any(char::is_control) {
        return Err("Invalid turn identifier.".into());
    }
    Ok(())
}
fn validate_record(record: &Record, root: &RootIdentity, turn_id: &str) -> Result<(), String> {
    if record.version != 1
        || &record.root != root
        || record.turn_id != turn_id
        || record.summary.turn_id != turn_id
    {
        return Err("Saved turn changes belong to a different workspace or turn.".into());
    }
    if record.before.len() > 10000
        || record
            .after
            .as_ref()
            .is_some_and(|after| after.len() > 10000)
        || record.summary.files.len() > MAX_CHANGED_FILES
    {
        return Err("Saved turn changes exceed the supported bounds.".into());
    }
    if record
        .summary
        .reason
        .as_ref()
        .is_some_and(|reason| reason.len() > 1024)
        || (record.summary.state == ChangesState::Ready
            && (!record.finished || record.after.is_none()))
        || (record.summary.state == ChangesState::Unavailable && !record.summary.files.is_empty())
    {
        return Err("Saved turn changes contain invalid summary data.".into());
    }
    if record.summary.state == ChangesState::Ready {
        let after = record
            .after
            .as_ref()
            .ok_or("Saved turn changes have no completion snapshot.")?;
        let paths: std::collections::BTreeSet<_> =
            record.before.keys().chain(after.keys()).collect();
        let changed: Vec<_> =
            paths
                .into_iter()
                .filter(|path| {
                    !record.before.get(*path).zip(after.get(*path)).is_some_and(
                        |(before, after)| {
                            before.digest == after.digest
                                && before.executable == after.executable
                                && before.unavailable == after.unavailable
                        },
                    )
                })
                .collect();
        if record.summary.truncated != (changed.len() > MAX_CHANGED_FILES)
            || !record
                .summary
                .files
                .iter()
                .map(|file| &file.relative_path)
                .eq(changed.into_iter().take(MAX_CHANGED_FILES))
        {
            return Err("Saved turn changes do not match their frozen snapshots.".into());
        }
    }
    let mut seen = HashSet::new();
    for file in &record.summary.files {
        let after = record
            .after
            .as_ref()
            .and_then(|after| after.get(&file.relative_path));
        let before = record.before.get(&file.relative_path);
        if !snapshot::valid_relative(&file.relative_path)
            || file.old_relative_path.is_some()
            || !seen.insert(&file.relative_path)
            || (before.is_none() && after.is_none())
            || before.zip(after).is_some_and(|(before, after)| {
                before.digest == after.digest
                    && before.executable == after.executable
                    && before.unavailable == after.unavailable
            })
            || file.added_lines.is_some()
                != before
                    .into_iter()
                    .chain(after)
                    .all(|entry| entry.unavailable.is_none())
            || [file.added_lines, file.deleted_lines]
                .into_iter()
                .flatten()
                .any(|count| count > 9_007_199_254_740_991)
            || file.added_lines.is_some() != file.deleted_lines.is_some()
            || matches!(file.status, ChangeStatus::Added) != before.is_none()
            || matches!(file.status, ChangeStatus::Deleted) != after.is_none()
        {
            return Err("Saved turn changes contain invalid file summary data.".into());
        }
    }
    for (path, entry) in record
        .before
        .iter()
        .chain(record.after.iter().flat_map(|after| after.iter()))
    {
        if entry.digest.len() != 64
            || !entry.digest.bytes().all(|b| b.is_ascii_hexdigit())
            || !snapshot::valid_relative(path)
            || entry
                .text
                .as_ref()
                .is_some_and(|text| text.len() > MAX_FILE_BYTES)
            || (entry.text.is_some() == entry.unavailable.is_some())
        {
            return Err("Saved turn changes contain invalid file data.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests;

fn verify_authority(
    identity: &RootIdentity,
    authority: Option<&std::fs::File>,
) -> Result<(), String> {
    if let Some(authority) = authority {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let metadata = authority
                .metadata()
                .map_err(|_| "The original workspace is unavailable.")?;
            if metadata.dev() != identity.device || metadata.ino() != identity.inode {
                return Err("The workspace changed before reading turn changes.".into());
            }
        }
        #[cfg(not(unix))]
        return Err("Turn changes are unavailable on this platform.".into());
    }
    Ok(())
}
