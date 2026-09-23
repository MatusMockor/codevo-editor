//! Durable Git checkpoints of the on-disk working tree before and after each agent turn.
//! Private refs retain history without changing HEAD, the live index, or working files.
mod admission;
mod checkpoint;
mod checkpoint_diff;
mod checkpoint_retention;
mod compare;
mod git_authority;
mod git_process;
pub(crate) mod read_errors;
mod record_validation;
mod snapshot;
mod storage;
mod storage_catalog;
mod types;
use record_validation::validate_record;
use std::path::{Path, PathBuf};
use types::*;
pub(crate) use types::{CapturePhase, ChangesState, TurnChangesSummary, TurnFileDiff};

pub(crate) struct AgentTurnChangesStore {
    base: PathBuf,
    admission: admission::Admission,
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
            admission: admission::Admission::default(),
        }
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
        let _permit = self.admission.acquire(&identity.path)?;
        snapshot::verify_root(&identity)?;
        let path = storage::record_path(&self.base, &identity, turn_id);
        let existing = storage::read(&path)?;
        if existing.is_none() {
            if let Some(reason) = unsupported_reason(&identity) {
                return Ok(TurnChangesSummary::unsupported(turn_id, reason));
            }
        }
        if let Some(record) = &existing {
            validate_record(record, &identity, turn_id)?;
            if record.finished || matches!(phase, CapturePhase::Before) {
                snapshot::verify_root(&identity)?;
                return recorded_summary(record, &identity);
            }
        }
        let previous = existing
            .as_ref()
            .and_then(|record| record.checkpoints.clone());
        let mut record = match (existing, phase) {
            (Some(record), CapturePhase::After) => record,
            (None, CapturePhase::After) => {
                return Ok(TurnChangesSummary::unavailable(
                    turn_id,
                    "No snapshot was recorded before this turn.",
                ))
            }
            (_, CapturePhase::Before) => Record {
                version: 2,
                root: identity.clone(),
                turn_id: turn_id.into(),
                before: Snapshot::new(),
                after: None,
                summary: TurnChangesSummary::unavailable(
                    turn_id,
                    "No completed snapshot is available for this turn.",
                ),
                finished: false,
                checkpoints: Some(Checkpoints::default()),
            },
        };
        if record.version == 1 {
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
        } else {
            let checkpoints = record
                .checkpoints
                .as_mut()
                .ok_or("Missing checkpoint metadata.")?;
            let capture = checkpoint::capture(
                &self.base,
                &handle,
                &identity,
                turn_id,
                phase,
                checkpoints.before.as_ref(),
            );
            match capture {
                Ok(captured) => match phase {
                    CapturePhase::Before => checkpoints.before = Some(captured),
                    CapturePhase::After => {
                        checkpoints.after = Some(captured);
                        record.finished = true;
                        record.summary = match checkpoint::summary(
                            &identity,
                            checkpoints
                                .before
                                .as_ref()
                                .ok_or("Missing baseline checkpoint.")?,
                            checkpoints
                                .after
                                .as_ref()
                                .ok_or("Missing final checkpoint.")?,
                            turn_id,
                        ) {
                            Ok(summary) => summary,
                            Err(reason) => TurnChangesSummary::unavailable(turn_id, &reason),
                        };
                    }
                },
                Err(reason) => {
                    record.summary = TurnChangesSummary::unavailable(turn_id, &reason);
                    record.finished = true;
                }
            }
        }
        snapshot::verify_root(&identity)?;
        if let Err(error) = storage::write(&path, &record) {
            // Only undo this attempt's new refs. Existing durable checkpoints remain owned
            // by their earlier metadata, including the baseline of an incomplete turn.
            // rename may already have published metadata when directory fsync fails.
            // Preserve refs if publication is visible or cannot be settled safely.
            let published = storage::read(&path)
                .map(|saved| saved.is_some_and(|saved| saved.checkpoints == record.checkpoints))
                .unwrap_or(true);
            if let Some(saved) = record.checkpoints.as_ref().filter(|_| !published) {
                let previous = previous.as_ref();
                for (created, existed) in [
                    (
                        &saved.before,
                        previous.and_then(|saved| saved.before.as_ref()),
                    ),
                    (
                        &saved.after,
                        previous.and_then(|saved| saved.after.as_ref()),
                    ),
                ] {
                    if existed.is_none() {
                        if let Some(created) = created {
                            let _ = checkpoint::delete(&identity, created);
                        }
                    }
                }
            }
            return Err(error);
        }
        storage::prune(&self.base, &path)?;
        checkpoint_retention::enforce(&self.base, &identity, turn_id)?;
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
            if let Some(reason) = unsupported_reason(&identity) {
                return Ok(TurnChangesSummary::unsupported(turn_id, reason));
            }
            return Ok(TurnChangesSummary::unavailable(
                turn_id,
                "No snapshot is available for this turn.",
            ));
        };
        validate_record(&record, &identity, turn_id)?;
        if never_captured(&record) {
            if let Some(reason) = unsupported_reason(&identity) {
                return Ok(TurnChangesSummary::unsupported(turn_id, reason));
            }
        }
        snapshot::verify_root(&identity)?;
        recorded_summary(&record, &identity)
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
        if let Some(checkpoints) = &record.checkpoints {
            let before = checkpoints
                .before
                .as_ref()
                .ok_or("Missing baseline checkpoint.")?;
            let after = checkpoints
                .after
                .as_ref()
                .ok_or("Missing final checkpoint.")?;
            let summary = checkpoint::summary(&identity, before, after, turn_id)?;
            if summary != record.summary {
                return Err("Saved turn changes do not match their checkpoints.".into());
            }
            let diff = checkpoint::file_diff(&identity, before, after, relative_path)?;
            snapshot::verify_root(&identity)?;
            return Ok(diff);
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
#[cfg(test)]
mod tests;

fn unsupported_reason(identity: &RootIdentity) -> Option<UnsupportedReason> {
    git_authority::unsupported_reason(identity).ok().flatten()
}

fn never_captured(record: &Record) -> bool {
    let captured = match &record.checkpoints {
        Some(checkpoints) => checkpoints.before.is_some() || checkpoints.after.is_some(),
        None => !record.before.is_empty() || record.after.is_some(),
    };
    record.finished && record.summary.state == ChangesState::Unavailable && !captured
}

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

fn recorded_summary(
    record: &Record,
    identity: &RootIdentity,
) -> Result<TurnChangesSummary, String> {
    if let Some(checkpoints) = &record.checkpoints {
        for checkpoint in checkpoints.before.iter().chain(checkpoints.after.iter()) {
            if let Err(reason) = checkpoint::verify(identity, checkpoint) {
                return Ok(TurnChangesSummary::unavailable(&record.turn_id, &reason));
            }
        }
        if record.summary.state == ChangesState::Ready {
            let before = checkpoints
                .before
                .as_ref()
                .ok_or("Missing baseline checkpoint.")?;
            let after = checkpoints
                .after
                .as_ref()
                .ok_or("Missing final checkpoint.")?;
            let summary = checkpoint::summary(identity, before, after, &record.turn_id)?;
            if summary != record.summary {
                return Err("Saved turn changes do not match their checkpoints.".into());
            }
        }
    }
    snapshot::verify_root(identity)?;
    Ok(record.summary.clone())
}
