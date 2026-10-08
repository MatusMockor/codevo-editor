use super::{CodexAppServerHost, CodexAppServerHostRegistry, HostActivity};
use std::path::Path;
use std::sync::PoisonError;

pub const MAX_CODEX_HOST_TRUST_ROOTS: usize = 8;
pub const CODEX_HOST_TRUST_ROOT_LIMIT_ERROR: &str =
    "Too many projects share the Codex session of this repository.";
pub const CODEX_HOST_TRUST_REVOKED_REASON: &str =
    "Codex session ended because trust in a project it served was revoked.";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum HostActivityClaim {
    NewThread,
    TurnOfOpenThread,
}

impl HostActivity {
    pub(super) fn serving(trust_root: &Path) -> Self {
        Self {
            trust_roots: vec![trust_root.to_path_buf()],
            ..Self::default()
        }
    }

    pub(super) fn admits(&self, claim: HostActivityClaim) -> bool {
        !self.draining || claim == HostActivityClaim::TurnOfOpenThread
    }

    fn serve_trust_root(&mut self, trust_root: &Path) -> Result<(), String> {
        if self
            .trust_roots
            .iter()
            .any(|served| served.as_os_str() == trust_root.as_os_str())
        {
            return Ok(());
        }
        if self.trust_roots.len() >= MAX_CODEX_HOST_TRUST_ROOTS {
            return Err(CODEX_HOST_TRUST_ROOT_LIMIT_ERROR.to_string());
        }
        self.trust_roots.push(trust_root.to_path_buf());
        Ok(())
    }

    fn retires_now_for_revoked(&mut self, trust_root: &Path) -> bool {
        if !self
            .trust_roots
            .iter()
            .any(|served| served.as_os_str() == trust_root.as_os_str())
        {
            return false;
        }
        self.draining = true;
        self.drained()
    }

    fn drained(&mut self) -> bool {
        if !self.draining || self.users != 0 {
            return false;
        }
        self.retired = true;
        true
    }
}

impl CodexAppServerHost {
    fn activity(&self) -> std::sync::MutexGuard<'_, HostActivity> {
        self.activity.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn accepts_new_threads(&self) -> bool {
        !self.activity().draining
    }

    pub(super) fn serve_trust_root(&self, trust_root: &Path) -> Result<(), String> {
        self.activity().serve_trust_root(trust_root)
    }

    pub(super) fn drained_after_revoked_trust(&self) -> bool {
        self.activity().drained()
    }
}

impl CodexAppServerHostRegistry {
    pub fn retire_for_revoked_trust(&self, trust_root: &Path) {
        let retired = {
            let mut state = self.locked();
            self.retire_slots(&mut state, |slot| {
                slot.host.activity().retires_now_for_revoked(trust_root)
            })
        };
        self.reap_in_background(retired, CODEX_HOST_TRUST_REVOKED_REASON);
    }
}

#[cfg(all(test, unix))]
#[path = "codex_app_server_host_trust_tests.rs"]
mod tests;
