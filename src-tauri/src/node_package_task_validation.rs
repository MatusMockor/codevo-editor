//! Backend admission validation for Node package task owner identities.

use crate::workspace_registry::WorkspaceId;
use std::path::{Component, Path};

pub(crate) const RUN_ID_BYTES_LIMIT: usize = 128;
pub(crate) const WORKSPACE_ID_BYTES_LIMIT: usize = 1024;
pub(crate) const MANIFEST_PATH_BYTES_LIMIT: usize = 4096;
pub(crate) const SCRIPT_NAME_BYTES_LIMIT: usize = 214;

pub(crate) fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.trim().is_empty()
        || run_id.len() > RUN_ID_BYTES_LIMIT
        || run_id.chars().any(char::is_control)
    {
        return Err("Node package task runId is invalid.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_workspace_id(workspace_id: &WorkspaceId) -> Result<(), String> {
    let value = workspace_id.as_str();
    if value.trim().is_empty()
        || value.len() > WORKSPACE_ID_BYTES_LIMIT
        || value.chars().any(char::is_control)
    {
        return Err("Node package task workspaceId is invalid.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_manifest_relative_path(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > MANIFEST_PATH_BYTES_LIMIT
        || value.contains('\\')
        || value.chars().any(char::is_control)
        || path.is_absolute()
        || path.file_name().and_then(|name| name.to_str()) != Some("package.json")
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Node package task manifest path is invalid.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_script_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > SCRIPT_NAME_BYTES_LIMIT
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("Node package task script name is invalid.".to_string());
    }
    Ok(())
}
