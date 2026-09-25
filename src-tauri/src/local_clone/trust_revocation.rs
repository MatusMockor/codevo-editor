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
            .revoke_clone_canonical_root(canonical_root)
            .map(|_| ())
            .map_err(|_| "Workspace trust for the clone folder could not be reset.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::CloneTrustRevocation;
    use crate::trust::WorkspaceTrustService;
    use std::{fs, sync::Mutex, time::SystemTime};

    #[test]
    fn a_clone_root_stays_refused_after_its_revocation_is_evicted() {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("clone-trust-mark-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        let trust = Mutex::new(WorkspaceTrustService::load(root.join("trust.json")).unwrap());

        trust.revoke_clone_root("/clones/first").unwrap();
        let mut service = trust.lock().unwrap();
        for index in 0..300 {
            service
                .revoke_canonical_root(&format!("/manual/{index:04}"))
                .unwrap();
        }
        let refusal = service
            .grant_opened_canonical_root("/clones/first")
            .unwrap_err();
        assert_eq!(refusal.kind(), std::io::ErrorKind::PermissionDenied);
        drop(service);
        fs::remove_dir_all(root).unwrap();
    }
}
