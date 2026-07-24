use crate::debug_session_registry::{retained_workspace_authority, DebugWorkspaceAuthority};
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;

const MAX_ROOT_BYTES: usize = 4_096;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugDisconnectRequest {
    pub(crate) root_path: String,
    pub(crate) session_id: u64,
}

impl DebugDisconnectRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.root_path.is_empty() || self.root_path.len() > MAX_ROOT_BYTES {
            return Err(format!(
                "Debug workspace root must contain 1 to {MAX_ROOT_BYTES} UTF-8 bytes."
            ));
        }
        if self.root_path.chars().any(char::is_control) {
            return Err("Debug workspace root contains a forbidden control character.".to_string());
        }
        if self.session_id == 0 || self.session_id > MAX_SAFE_INTEGER {
            return Err("Debug session id must be a positive JavaScript-safe integer.".to_string());
        }
        Ok(())
    }
}

pub(crate) fn validated_disconnect_authority(
    registry: &WorkspaceRegistry,
    request: &DebugDisconnectRequest,
) -> Result<DebugWorkspaceAuthority, String> {
    request.validate()?;
    retained_workspace_authority(registry, &request.root_path)
}
