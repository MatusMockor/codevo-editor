use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const MAX_AGENT_ROOT_LEASES: usize = 8;
pub const AGENT_ROOT_LEASE_LIMIT_ERROR: &str = "Too many agent project roots are leased.";

#[derive(Debug, Default)]
struct AgentRootLeaseState {
    next_token: u64,
    leases: HashMap<PathBuf, u64>,
}

#[derive(Debug, Default)]
pub struct AgentRootLeaseRegistry {
    state: Mutex<AgentRootLeaseState>,
}

impl AgentRootLeaseRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn acquire(&self, canonical_root: &Path) -> Result<u64, String> {
        let mut state = self.state();

        if let Some(token) = state.leases.get(canonical_root) {
            return Ok(*token);
        }

        if state.leases.len() >= MAX_AGENT_ROOT_LEASES {
            return Err(AGENT_ROOT_LEASE_LIMIT_ERROR.to_string());
        }

        state.next_token = state.next_token.wrapping_add(1).max(1);
        let token = state.next_token;
        state.leases.insert(canonical_root.to_path_buf(), token);

        Ok(token)
    }

    pub fn release(&self, canonical_root: &Path, token: u64) -> bool {
        let mut state = self.state();
        let Some(held) = state.leases.get(canonical_root).copied() else {
            return false;
        };

        if held != token {
            return false;
        }

        state.leases.remove(canonical_root);

        true
    }

    pub fn is_held(&self, canonical_root: &Path) -> bool {
        self.state().leases.contains_key(canonical_root)
    }

    #[cfg(test)]
    pub fn held_root_count(&self) -> usize {
        self.state().leases.len()
    }

    fn state(&self) -> MutexGuard<'_, AgentRootLeaseState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub fn dispose_should_stop_agent_tasks(
    leases: Option<&AgentRootLeaseRegistry>,
    canonical_root: &Path,
) -> bool {
    let Some(leases) = leases else {
        return true;
    };

    !leases.is_held(canonical_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_is_idempotent_per_root() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/alpha");

        let first = registry.acquire(root).expect("first acquire");
        let second = registry.acquire(root).expect("second acquire");

        assert_eq!(first, second);
        assert_eq!(registry.held_root_count(), 1);
    }

    #[test]
    fn release_requires_the_exact_token() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/beta");
        let token = registry.acquire(root).expect("acquire");

        assert!(!registry.release(root, token.wrapping_add(1)));
        assert!(registry.is_held(root));
        assert!(registry.release(root, token));
        assert!(!registry.is_held(root));
    }

    #[test]
    fn stale_and_unknown_token_release_is_a_no_op() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/gamma");
        let stale = registry.acquire(root).expect("first acquire");

        assert!(registry.release(root, stale));

        let renewed = registry.acquire(root).expect("second acquire");

        assert_ne!(stale, renewed);
        assert!(!registry.release(root, stale));
        assert!(registry.is_held(root));
        assert!(!registry.release(Path::new("/workspace/never-leased"), renewed));
    }

    #[test]
    fn lease_count_is_capped() {
        let registry = AgentRootLeaseRegistry::new();

        for index in 0..MAX_AGENT_ROOT_LEASES {
            registry
                .acquire(&PathBuf::from(format!("/workspace/root-{index}")))
                .expect("acquire within the cap");
        }

        let error = registry
            .acquire(Path::new("/workspace/overflow"))
            .expect_err("cap must be enforced");

        assert_eq!(error, AGENT_ROOT_LEASE_LIMIT_ERROR);
        assert_eq!(registry.held_root_count(), MAX_AGENT_ROOT_LEASES);
    }

    #[test]
    fn re_acquiring_a_held_root_never_consumes_a_cap_slot() {
        let registry = AgentRootLeaseRegistry::new();

        for index in 0..MAX_AGENT_ROOT_LEASES {
            registry
                .acquire(&PathBuf::from(format!("/workspace/root-{index}")))
                .expect("acquire within the cap");
        }

        registry
            .acquire(Path::new("/workspace/root-0"))
            .expect("re-acquire is idempotent at the cap");

        assert_eq!(registry.held_root_count(), MAX_AGENT_ROOT_LEASES);
    }

    #[test]
    fn releasing_a_root_frees_a_cap_slot() {
        let registry = AgentRootLeaseRegistry::new();
        let mut tokens = Vec::new();

        for index in 0..MAX_AGENT_ROOT_LEASES {
            let root = PathBuf::from(format!("/workspace/root-{index}"));
            tokens.push((root.clone(), registry.acquire(&root).expect("acquire")));
        }

        let (root, token) = tokens.remove(0);

        assert!(registry.release(&root, token));

        registry
            .acquire(Path::new("/workspace/overflow"))
            .expect("freed slot is reusable");
    }

    #[test]
    fn dispose_stops_tasks_only_for_unleased_roots() {
        let registry = AgentRootLeaseRegistry::new();
        let leased = Path::new("/workspace/leased");
        let other = Path::new("/workspace/other");
        let token = registry.acquire(leased).expect("acquire");

        assert!(!dispose_should_stop_agent_tasks(Some(&registry), leased));
        assert!(dispose_should_stop_agent_tasks(Some(&registry), other));
        assert!(dispose_should_stop_agent_tasks(None, leased));

        registry.release(leased, token);

        assert!(dispose_should_stop_agent_tasks(Some(&registry), leased));
    }
}
