use crate::workspace::FileEntryKind;
use serde::{Deserialize, Serialize};

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
