use crate::workspace::FileEntryKind;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    #[serde(with = "decimal_u64")]
    pub(super) device: u64,
    #[serde(with = "decimal_u64")]
    pub(super) inode: u64,
    pub(super) size: i64,
    pub(super) modified_seconds: i64,
    pub(super) modified_nanoseconds: i64,
    #[serde(with = "decimal_u64")]
    pub(super) content_hash: u64,
}

mod decimal_u64 {
    use serde::{de::Error as _, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(D::Error::custom)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextFile {
    pub content: String,
    pub revision: FileRevision,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImageFile {
    pub base64: String,
    pub byte_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkspaceImageReadError {
    Io { message: String },
    TooLarge { size: u64, max_bytes: usize },
}

impl From<io::Error> for WorkspaceImageReadError {
    fn from(error: io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFileEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileEntryKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFileSearchResult {
    pub name: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFileSearchResponse {
    pub results: Vec<DescriptorFileSearchResult>,
    pub truncated: bool,
    pub request_generation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorTextSearchResult {
    pub relative_path: String,
    pub line_number: u64,
    pub column: u64,
    pub line_text: String,
    pub match_start: u64,
    pub match_end: u64,
    pub preview_truncated: bool,
    pub match_truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorTextSearchResponse {
    pub results: Vec<DescriptorTextSearchResult>,
    pub truncated: bool,
    pub request_generation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFileResult {
    pub relative_path: String,
    pub replacements: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFileFailure {
    pub relative_path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceReplaceResult {
    Success {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
    },
    Conflict {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        conflicts: Vec<ReplaceFileFailure>,
        message: String,
    },
    Partial {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        conflicts: Vec<ReplaceFileFailure>,
        errors: Vec<ReplaceFileFailure>,
        message: String,
    },
    Error {
        files: Vec<ReplaceFileResult>,
        total_replacements: u64,
        errors: Vec<ReplaceFileFailure>,
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum FileCommandResult {
    Success {
        revision: Option<FileRevision>,
    },
    Conflict {
        message: String,
    },
    Partial {
        message: String,
        revision: Option<FileRevision>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MutationResult {
    Success,
    Partial { message: String },
    Error { message: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceEditResult {
    Success {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
    },
    Conflict {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    Partial {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    Error {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
    NotFound {
        applied_file_operations: usize,
        applied_text_files: usize,
        applied_count: usize,
        failed_path: String,
        message: String,
    },
}
