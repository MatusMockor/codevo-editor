use crate::trust::WorkspaceTrustService;
use std::sync::Mutex;

pub(crate) trait CloneTrustRevocation {
    fn revoke_clone_root(&self, canonical_root: &str) -> Result<(), String>;
}

impl CloneTrustRevocation for Mutex<WorkspaceTrustService> {
    fn revoke_clone_root(&self, canonical_root: &str) -> Result<(), String> {
        let mut service = self
            .lock()
            .map_err(|_| "Workspace trust is unavailable.".to_string())?;
        service
            .revoke_canonical_root(canonical_root)
            .map(|_| ())
            .map_err(|_| "Workspace trust for the clone folder could not be reset.".to_string())
    }
}
