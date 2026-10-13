use super::transport::Failure;
use super::types::{id, uuid};
use crate::agent_file_source::{valid_id, INVALID_SOURCE, MAX_FILE_BYTES, TOO_LARGE, UNREADABLE};
use serde::{Deserialize, Serialize};

pub(super) const STORAGE_FULL: &str = "The server's attachment storage is full. Try again later.";
pub(super) const FILE_REFUSED: &str = "The server does not accept this file.";
pub(super) const UPLOAD_CANCELLED: &str = "Attachment upload was cancelled.";
pub(super) const UPDATE_SERVER: &str = "Update this server to attach files.";
pub(super) const FILE_CAPABILITY: &str = "fileAttachments";
pub(super) const STORED_DIFFERENT: &str = "The server stored a different file than was sent.";
pub(super) const NOT_STORED: &str = "The server no longer stores this attachment.";
pub(super) const DOWNLOAD_MISMATCH: &str = "The downloaded file does not match the attachment.";
pub(super) const SAVE_FAILED: &str = "The file could not be saved.";
pub(super) const INVALID_RESPONSE: &str = "Runner returned an invalid response.";
pub(super) const LEASE_CHANGED: &str = "Server connection changed during request";
const INTERRUPTED: &str = "Runner operation failed";
const INVALID_REQUEST: &str = "Invalid attachment request";
const OUTPUT_LIMIT: &str = "Runner response exceeds output limit.";
const MAX_NAME_BYTES: usize = 255;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadFileRequest {
    pub server_id: String,
    pub attachment_id: String,
    pub source_id: String,
    pub name: String,
}

impl UploadFileRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        id(&self.server_id)?;
        uuid(&self.attachment_id)?;
        if !valid_id(&self.source_id) {
            return Err(INVALID_SOURCE.into());
        }
        if !accepted_name(&self.name) {
            return Err(FILE_REFUSED.into());
        }
        Ok(())
    }

    pub(super) fn path(&self) -> String {
        format!("/v1/attachments/{}", self.attachment_id)
    }

    pub(super) fn file_name_header(&self) -> String {
        url::form_urlencoded::byte_serialize(self.name.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelUploadRequest {
    pub server_id: String,
    pub attachment_id: String,
}

impl CancelUploadRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        id(&self.server_id)?;
        uuid(&self.attachment_id)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadRequest {
    pub server_id: String,
    pub attachment_id: String,
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

impl DownloadRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        id(&self.server_id)?;
        uuid(&self.attachment_id)?;
        if self.name.trim().is_empty()
            || self.name.len() > MAX_NAME_BYTES
            || self
                .name
                .chars()
                .any(|character| character.is_ascii_control())
            || !(1..=MAX_FILE_BYTES).contains(&self.bytes)
            || !is_sha256(&self.sha256)
        {
            return Err(INVALID_REQUEST.into());
        }
        Ok(())
    }

    pub(super) fn path(&self) -> String {
        format!("/v1/attachments/{}/content", self.attachment_id)
    }

    pub(super) fn suggested_name(&self) -> String {
        let cleaned: String = self
            .name
            .chars()
            .filter(|character| !is_direction_control(*character))
            .map(|character| match character {
                '/' | '\\' | ':' => '_',
                other if other.is_control() => '_',
                other => other,
            })
            .collect();
        let cleaned = cleaned.trim().trim_start_matches('.').trim_start();
        if cleaned.is_empty() {
            return "attachment".into();
        }
        cleaned.into()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Saved,
    Cancelled,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct DownloadOutcome {
    pub status: DownloadStatus,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileAttachment {
    pub id: String,
    pub runner_id: String,
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
    pub created_at: String,
    pub kind: String,
    pub media_type: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredFile {
    pub attachment: FileAttachment,
    pub created: bool,
}

pub(super) struct Sent<'a> {
    pub(super) id: &'a str,
    pub(super) runner_id: &'a str,
    pub(super) name: &'a str,
    pub(super) bytes: u64,
    pub(super) sha256: &'a str,
    pub(super) media_type: &'a str,
}

pub(super) fn stored(status: u16, body: &[u8], sent: &Sent<'_>) -> Result<StoredFile, String> {
    let stored: StoredFile = serde_json::from_slice(body).map_err(|_| INVALID_RESPONSE)?;
    let created = match status {
        200 => false,
        201 => true,
        _ => return Err(INVALID_RESPONSE.into()),
    };
    let attachment = &stored.attachment;
    if stored.created != created
        || attachment.runner_id.is_empty()
        || attachment.runner_id.len() > 128
        || attachment.created_at.is_empty()
        || attachment.created_at.len() > 64
        || attachment.created_at.chars().any(char::is_control)
    {
        return Err(INVALID_RESPONSE.into());
    }
    if attachment.id != sent.id
        || (!sent.runner_id.is_empty() && attachment.runner_id != sent.runner_id)
        || attachment.name != sent.name
        || attachment.bytes != sent.bytes
        || attachment.sha256 != sent.sha256
        || attachment.kind != "file"
        || attachment.media_type != sent.media_type
    {
        return Err(STORED_DIFFERENT.into());
    }
    Ok(stored)
}

pub(super) fn upload_refusal(failure: Failure) -> String {
    match failure {
        Failure::Cancelled => UPLOAD_CANCELLED.into(),
        Failure::Status(413) => TOO_LARGE.into(),
        Failure::Status(429) => STORAGE_FULL.into(),
        Failure::Status(400 | 415) => FILE_REFUSED.into(),
        Failure::Status(status) => format!("Runner request failed (HTTP {status})."),
        Failure::Exceeded => OUTPUT_LIMIT.into(),
        Failure::Local => UNREADABLE.into(),
        Failure::Unsupported => UPDATE_SERVER.into(),
        Failure::Transport(reason) => reason,
    }
}

pub(super) fn download_refusal(failure: Failure) -> String {
    match failure {
        Failure::Status(404) => NOT_STORED.into(),
        Failure::Status(status) => format!("Runner request failed (HTTP {status})."),
        Failure::Exceeded => DOWNLOAD_MISMATCH.into(),
        Failure::Cancelled | Failure::Unsupported => INTERRUPTED.into(),
        Failure::Local => SAVE_FAILED.into(),
        Failure::Transport(reason) => reason,
    }
}

fn accepted_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= MAX_NAME_BYTES
        && !name
            .chars()
            .any(|character| character.is_ascii_control() || matches!(character, '/' | '\\'))
}

fn is_direction_control(character: char) -> bool {
    matches!(
        character,
        '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
    )
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
#[path = "attachment_file_wire_tests.rs"]
mod tests;
