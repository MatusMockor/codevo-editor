use super::{
    validate_evaluate_text, DebugBreakpoint, DebugExceptionPauseMode, DebugScopeInfo,
    DebugVariablePageRequest, MAX_DEBUG_EVALUATE_ROOT_BYTES, MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES,
    MAX_DEBUG_SCOPES, MAX_DEBUG_VARIABLE_NAME_BYTES, MAX_DEBUG_VARIABLE_PAGE_COUNT,
    MAX_DEBUG_VARIABLE_START, MAX_JAVASCRIPT_SAFE_INTEGER,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetBreakpointsRequest {
    pub(super) root_path: String,
    pub(super) session_id: u64,
    pub(super) file_path: String,
    pub(super) breakpoints: Vec<DebugBreakpoint>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetExceptionPauseRequest {
    pub(super) root_path: String,
    pub(super) session_id: u64,
    pub(super) mode: DebugExceptionPauseMode,
    pub(super) exception_type_filter: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugRestartFrameRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
}

impl DebugRestartFrameRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        validate_workspace_root(&self.root_path)?;
        if self.root_path.chars().any(is_unsafe_debug_path_character) {
            return Err("Debug workspace root contains an unsafe character.".to_string());
        }
        validate_positive_safe_integers(&[
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
        ])
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugRunToLocationRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) file_path: String,
    pub(crate) line_number: u64,
    pub(crate) column_number: u64,
}

impl DebugRunToLocationRequest {
    pub(super) fn validate(&self) -> Result<(u32, u32), String> {
        validate_workspace_root(&self.root_path)?;
        if self
            .root_path
            .chars()
            .chain(self.file_path.chars())
            .any(is_unsafe_debug_path_character)
        {
            return Err("Run-to-location paths contain an unsafe character.".to_string());
        }
        validate_evaluate_text(
            &self.file_path,
            MAX_DEBUG_RUN_TO_LOCATION_PATH_BYTES,
            false,
            "Run-to-location file path",
        )
        .map_err(|failure| failure.message)?;
        validate_positive_safe_integers(&[
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.line_number, "line number"),
            (self.column_number, "column number"),
        ])?;
        let line_number = u32::try_from(self.line_number)
            .map_err(|_| "Run-to-location line number is out of range.".to_string())?;
        let column_number = u32::try_from(self.column_number)
            .map_err(|_| "Run-to-location column number is out of range.".to_string())?;
        Ok((line_number, column_number))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugScopesRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
}

impl DebugScopesRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        validate_workspace_root(&self.root_path)?;
        validate_positive_safe_integers(&[
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
        ])
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugVariablesRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
    pub(crate) pause_generation: u64,
    pub(crate) frame_id: u64,
    pub(crate) variables_reference: u64,
    pub(crate) start: u64,
    pub(crate) count: u32,
}

impl DebugVariablesRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        validate_workspace_root(&self.root_path)?;
        validate_positive_safe_integers(&[
            (self.session_id, "session id"),
            (self.pause_generation, "pause generation"),
            (self.frame_id, "frame id"),
            (self.variables_reference, "variables reference"),
        ])?;
        if self.start > MAX_DEBUG_VARIABLE_START {
            return Err(format!(
                "Debug variable page start must not exceed {MAX_DEBUG_VARIABLE_START}."
            ));
        }
        if self.count == 0 || self.count > MAX_DEBUG_VARIABLE_PAGE_COUNT {
            return Err(format!(
                "Debug variable page count must be between 1 and {MAX_DEBUG_VARIABLE_PAGE_COUNT}."
            ));
        }
        Ok(())
    }

    pub(super) fn adapter_request(&self) -> DebugVariablePageRequest {
        DebugVariablePageRequest {
            pause_generation: self.pause_generation,
            frame_id: self.frame_id,
            variables_reference: self.variables_reference,
            start: self.start,
            count: self.count,
        }
    }
}

pub(super) fn bound_scopes(scopes: Vec<DebugScopeInfo>) -> Result<Vec<DebugScopeInfo>, String> {
    if scopes.len() > MAX_DEBUG_SCOPES
        || scopes.iter().any(|scope| {
            scope.name.is_empty()
                || scope.name.len() > MAX_DEBUG_VARIABLE_NAME_BYTES
                || scope.name.chars().any(char::is_control)
                || scope.variables_reference == 0
                || scope.variables_reference > MAX_JAVASCRIPT_SAFE_INTEGER
        })
    {
        return Err("The debug adapter returned out-of-bounds scopes.".to_string());
    }
    Ok(scopes)
}

fn validate_workspace_root(root_path: &str) -> Result<(), String> {
    validate_evaluate_text(
        root_path,
        MAX_DEBUG_EVALUATE_ROOT_BYTES,
        false,
        "Debug workspace root",
    )
    .map_err(|failure| failure.message)
}

fn validate_positive_safe_integers(values: &[(u64, &str)]) -> Result<(), String> {
    for &(value, label) in values {
        if value == 0 || value > MAX_JAVASCRIPT_SAFE_INTEGER {
            return Err(format!(
                "Debug {label} must be a positive JavaScript-safe integer."
            ));
        }
    }
    Ok(())
}

pub(super) fn is_unsafe_debug_path_character(character: char) -> bool {
    matches!(
        character,
        '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}'
    )
}
