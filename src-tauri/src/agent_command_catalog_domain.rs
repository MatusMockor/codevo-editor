use crate::agent_task_spawner::AgentCliInvocation;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

pub const MAX_CATALOG_ENTRIES: usize = 512;
pub const MAX_NAME_BYTES: usize = 128;
pub const MAX_LABEL_BYTES: usize = 128;
pub const MAX_DESCRIPTION_BYTES: usize = 512;
pub const MAX_ARGUMENT_HINT_BYTES: usize = 128;
pub const MAX_REPOSITORY_ROOT_BYTES: usize = 4096;
pub const MAX_CATALOG_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub const CLAUDE_CONTROL_REQUEST_ID: &str = "codevo-command-catalog";
pub const CLAUDE_INITIALIZE_REQUEST: &str = "{\"type\":\"control_request\",\"request_id\":\"codevo-command-catalog\",\"request\":{\"subtype\":\"initialize\"}}\n";
pub const INVALID_REQUEST_ERROR: &str =
    "Agent command catalog requests need a bounded normalized absolute repository root.";
const CATALOG_VERSION: u32 = 1;
const CLAUDE_INTERNAL_PREFIX: &str = "__";
const OUTPUT_LIMIT_ERROR: &str = "Agent command catalog output exceeds size limit.";
const INVALID_ENVELOPE_ERROR: &str = "Unsupported agent command catalog envelope.";
const INVALID_ENTRY_ERROR: &str = "Invalid agent command catalog entry.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCommandCatalogEntryKind {
    Command,
    Skill,
}

impl AgentCommandCatalogEntryKind {
    fn for_provider(provider: AgentCliInvocation) -> Self {
        match provider {
            AgentCliInvocation::ClaudeCode => Self::Command,
            AgentCliInvocation::CodexExec => Self::Skill,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCommandCatalogEntry {
    pub kind: AgentCommandCatalogEntryKind,
    pub name: String,
    pub label: Option<String>,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    pub builtin: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCommandCatalog {
    pub version: u32,
    pub provider: AgentCliInvocation,
    pub truncated: bool,
    pub entries: Vec<AgentCommandCatalogEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCommandCatalogRequest {
    pub repository_root: String,
    pub provider: AgentCliInvocation,
}

pub fn validate_request(request: &AgentCommandCatalogRequest) -> Result<(), String> {
    validate_repository_root(&request.repository_root)
}

pub fn validate_repository_root(root: &str) -> Result<(), String> {
    if root.is_empty()
        || root.len() > MAX_REPOSITORY_ROOT_BYTES
        || root.chars().any(char::is_control)
    {
        return Err(INVALID_REQUEST_ERROR.to_string());
    }
    let path = Path::new(root);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(INVALID_REQUEST_ERROR.to_string());
    }
    let normalized = path.components().collect::<PathBuf>();
    if normalized.as_os_str() != path.as_os_str() {
        return Err(INVALID_REQUEST_ERROR.to_string());
    }
    Ok(())
}

pub fn is_valid_entry_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    value.len() <= MAX_NAME_BYTES
        && first.is_ascii_alphanumeric()
        && bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'.' | b'-'))
}

fn bounded_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_entry(entry: &AgentCommandCatalogEntry, kind: AgentCommandCatalogEntryKind) -> bool {
    entry.kind == kind
        && is_valid_entry_name(&entry.name)
        && entry
            .label
            .as_deref()
            .is_none_or(|value| bounded_text(value, MAX_LABEL_BYTES))
        && entry
            .description
            .as_deref()
            .is_none_or(|value| bounded_text(value, MAX_DESCRIPTION_BYTES))
        && entry
            .argument_hint
            .as_deref()
            .is_none_or(|value| bounded_text(value, MAX_ARGUMENT_HINT_BYTES))
}

pub fn validate_catalog(catalog: &AgentCommandCatalog) -> Result<(), String> {
    if catalog.version != CATALOG_VERSION || catalog.entries.len() > MAX_CATALOG_ENTRIES {
        return Err(INVALID_ENVELOPE_ERROR.into());
    }
    let kind = AgentCommandCatalogEntryKind::for_provider(catalog.provider);
    let mut names = HashSet::new();
    if catalog
        .entries
        .iter()
        .any(|entry| !valid_entry(entry, kind) || !names.insert(entry.name.as_str()))
    {
        return Err(INVALID_ENTRY_ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
pub fn parse_catalog(bytes: &[u8]) -> Result<AgentCommandCatalog, String> {
    if bytes.len() > MAX_CATALOG_OUTPUT_BYTES {
        return Err(OUTPUT_LIMIT_ERROR.into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| INVALID_ENVELOPE_ERROR)?;
    let catalog = parse_catalog_value(value)?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn parse_catalog_value(value: Value) -> Result<AgentCommandCatalog, String> {
    serde_json::from_value(value).map_err(|_| INVALID_ENVELOPE_ERROR.into())
}

pub fn parse_foreign_catalog(
    value: Value,
    provider: AgentCliInvocation,
) -> Result<AgentCommandCatalog, String> {
    let catalog = parse_catalog_value(value)?;
    if catalog.provider != provider {
        return Err(INVALID_ENVELOPE_ERROR.into());
    }
    validate_catalog(&catalog)?;
    Ok(catalog)
}

pub fn codex_skills_request(workspace_root: &str, id: u64) -> String {
    let mut request = serde_json::json!({
        "method": "skills/list",
        "id": id,
        "params": { "cwds": [workspace_root] },
    })
    .to_string();
    request.push('\n');
    request
}

pub fn sanitized_text(value: Option<&str>, max: usize) -> Option<String> {
    let mut result = String::new();
    let mut pending_space = false;
    for character in value?.chars() {
        if character.is_whitespace() || character.is_control() {
            pending_space = !result.is_empty();
            continue;
        }
        if pending_space {
            result.push(' ');
            pending_space = false;
        }
        result.push(character);
    }
    if result.is_empty() {
        return None;
    }
    Some(truncated_on_char_boundary(result, max))
}

fn truncated_on_char_boundary(mut value: String, max: usize) -> String {
    if value.len() <= max {
        return value;
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    let trimmed = value.trim_end().len();
    value.truncate(trimmed);
    value
}

pub fn parse_catalog_output(
    provider: AgentCliInvocation,
    stdout: &[u8],
    workspace_root: &str,
) -> Result<AgentCommandCatalog, String> {
    match provider {
        AgentCliInvocation::ClaudeCode => parse_claude_initialize(stdout),
        AgentCliInvocation::CodexExec => parse_codex_skills(stdout, workspace_root),
    }
}

fn response_lines(stdout: &[u8]) -> Result<impl Iterator<Item = Value> + '_, String> {
    if stdout.len() > MAX_CATALOG_OUTPUT_BYTES {
        return Err(OUTPUT_LIMIT_ERROR.into());
    }
    Ok(stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok()))
}

fn assemble(
    provider: AgentCliInvocation,
    candidates: impl Iterator<Item = AgentCommandCatalogEntry>,
) -> Result<AgentCommandCatalog, String> {
    let mut names = HashSet::new();
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in candidates {
        if !is_valid_entry_name(&entry.name) || !names.insert(entry.name.clone()) {
            continue;
        }
        if entries.len() == MAX_CATALOG_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(entry);
    }
    let catalog = AgentCommandCatalog {
        version: CATALOG_VERSION,
        provider,
        truncated,
        entries,
    };
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

pub fn parse_claude_initialize(stdout: &[u8]) -> Result<AgentCommandCatalog, String> {
    let response = response_lines(stdout)?
        .find(|value| {
            text_field(value, "type") == Some("control_response")
                && value.get("response").is_some_and(|body| {
                    text_field(body, "request_id") == Some(CLAUDE_CONTROL_REQUEST_ID)
                })
        })
        .ok_or("Claude command catalog response is missing.")?;
    let body = response
        .get("response")
        .ok_or("Claude command catalog response is missing.")?;
    if text_field(body, "subtype") != Some("success") {
        return Err("Claude command catalog request failed.".into());
    }
    let commands = body
        .get("response")
        .and_then(|value| value.get("commands"))
        .and_then(Value::as_array)
        .ok_or("Claude command catalog response has no commands.")?;
    let candidates = commands.iter().filter_map(|command| {
        let name = text_field(command, "name")?;
        if name.starts_with(CLAUDE_INTERNAL_PREFIX) {
            return None;
        }
        Some(AgentCommandCatalogEntry {
            kind: AgentCommandCatalogEntryKind::Command,
            name: name.to_string(),
            label: None,
            description: sanitized_text(text_field(command, "description"), MAX_DESCRIPTION_BYTES),
            argument_hint: sanitized_text(
                text_field(command, "argumentHint"),
                MAX_ARGUMENT_HINT_BYTES,
            ),
            builtin: command.get("builtin").and_then(Value::as_bool) == Some(true),
        })
    });
    assemble(AgentCliInvocation::ClaudeCode, candidates)
}

fn is_codex_response(value: &Value) -> bool {
    value.get("id").and_then(Value::as_u64).is_some()
        && (value.get("result").is_some() || value.get("error").is_some())
}

pub fn parse_codex_skills(
    stdout: &[u8],
    workspace_root: &str,
) -> Result<AgentCommandCatalog, String> {
    let mut responses = response_lines(stdout)?.filter(is_codex_response);
    let response = responses
        .next()
        .ok_or("Codex skill catalog response is missing.")?;
    if responses.next().is_some() {
        return Err("Codex skill catalog response is ambiguous.".into());
    }
    parse_codex_skills_value(&response, workspace_root)
}

fn listing_is_incomplete(listing: &Value) -> bool {
    listing.get("errors").is_some_and(|errors| {
        !errors.is_null() && errors.as_array().is_none_or(|errors| !errors.is_empty())
    })
}

pub fn parse_codex_skills_value(
    response: &Value,
    workspace_root: &str,
) -> Result<AgentCommandCatalog, String> {
    if response.get("error").is_some() {
        return Err("Codex skill catalog request failed.".into());
    }
    let data = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
        .ok_or("Codex skill catalog response has no data.")?;
    let mut listings = data
        .iter()
        .filter(|entry| text_field(entry, "cwd") == Some(workspace_root));
    let listing = listings
        .next()
        .ok_or("Codex skill catalog response has no listing for the workspace.")?;
    if listings.next().is_some() {
        return Err("Codex skill catalog response lists the workspace more than once.".into());
    }
    let skills = listing
        .get("skills")
        .and_then(Value::as_array)
        .ok_or("Codex skill catalog response has no skills.")?;
    let candidates = skills.iter().filter_map(|skill| {
        if skill.get("enabled").and_then(Value::as_bool) == Some(false) {
            return None;
        }
        let name = text_field(skill, "name")?;
        let interface = skill.get("interface").filter(|value| value.is_object());
        let description = text_field(skill, "shortDescription")
            .or_else(|| interface.and_then(|value| text_field(value, "shortDescription")))
            .or_else(|| text_field(skill, "description"));
        Some(AgentCommandCatalogEntry {
            kind: AgentCommandCatalogEntryKind::Skill,
            name: name.to_string(),
            label: sanitized_text(
                interface.and_then(|value| text_field(value, "displayName")),
                MAX_LABEL_BYTES,
            ),
            description: sanitized_text(description, MAX_DESCRIPTION_BYTES),
            argument_hint: None,
            builtin: text_field(skill, "scope") == Some("system"),
        })
    });
    let mut catalog = assemble(AgentCliInvocation::CodexExec, candidates)?;
    catalog.truncated |= listing_is_incomplete(listing);
    Ok(catalog)
}

#[cfg(test)]
#[path = "agent_command_catalog_domain_tests.rs"]
mod tests;
