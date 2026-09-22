use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(super) const MAX_FILE_BYTES: usize = 128 * 1024;
pub(super) const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_READ_BYTES: usize = 128 * 1024 * 1024;
pub(super) const MAX_HASH_FILE_BYTES: u64 = 32 * 1024 * 1024;
pub(super) const MAX_RECORD_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_STORAGE_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const MAX_TURNS: usize = 32;
pub(super) const MAX_CHANGED_FILES: usize = 500;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CapturePhase {
    Before,
    After,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnChangesSummary {
    pub turn_id: String,
    pub state: ChangesState,
    pub files: Vec<TurnChangedFile>,
    pub truncated: bool,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChangesState {
    Ready,
    Unavailable,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChangeStatus {
    Added,
    Modified,
    Deleted,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnChangedFile {
    pub relative_path: String,
    pub old_relative_path: Option<String>,
    pub status: ChangeStatus,
    pub added_lines: Option<u64>,
    pub deleted_lines: Option<u64>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiffSide {
    pub text: String,
    pub truncated: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnFileDiff {
    pub relative_path: String,
    pub original: DiffSide,
    pub modified: DiffSide,
    pub unavailable_reason: Option<DiffUnavailableReason>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiffUnavailableReason {
    Binary,
    Large,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct RootIdentity {
    pub path: String,
    pub device: u64,
    pub inode: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Entry {
    pub digest: String,
    pub executable: bool,
    pub text: Option<String>,
    pub unavailable: Option<DiffUnavailableReason>,
}
pub(super) type Snapshot = BTreeMap<String, Entry>;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    pub version: u32,
    pub root: RootIdentity,
    pub turn_id: String,
    pub before: Snapshot,
    pub after: Option<Snapshot>,
    pub summary: TurnChangesSummary,
    pub finished: bool,
}
impl TurnChangesSummary {
    pub(super) fn unavailable(turn_id: &str, reason: &str) -> Self {
        Self {
            turn_id: turn_id.into(),
            state: ChangesState::Unavailable,
            files: Vec::new(),
            truncated: false,
            reason: Some(reason.into()),
        }
    }
}
