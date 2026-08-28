use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const MAX_AGENT_ROOT_LEASES: usize = 8;
pub const MAX_AGENT_ROOT_LEASE_TOKEN: u64 = 9_007_199_254_740_991;
pub const AGENT_ROOT_LEASE_LIMIT_ERROR: &str = "Too many agent project roots are leased.";
pub const AGENT_ROOT_LEASE_TOKEN_EXHAUSTED_ERROR: &str =
    "Agent project root lease token capacity is exhausted.";

#[derive(Debug, Default)]
struct AgentRootLeaseState {
    next_token: u64,
    leases: HashMap<PathBuf, u64>,
}

#[derive(Debug, Default)]
pub struct AgentRootLeaseRegistry {
    state: Mutex<AgentRootLeaseState>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentRootLeaseReleaseDisposition {
    Released,
    NotHeld,
    ForeignOwner,
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

        if state.next_token >= MAX_AGENT_ROOT_LEASE_TOKEN {
            return Err(AGENT_ROOT_LEASE_TOKEN_EXHAUSTED_ERROR.to_string());
        }

        state.next_token += 1;
        let token = state.next_token;
        state.leases.insert(canonical_root.to_path_buf(), token);

        Ok(token)
    }

    pub fn release(&self, canonical_root: &Path, token: u64) -> AgentRootLeaseReleaseDisposition {
        let mut state = self.state();
        let Some(held) = state.leases.get(canonical_root).copied() else {
            return AgentRootLeaseReleaseDisposition::NotHeld;
        };

        if held != token {
            return AgentRootLeaseReleaseDisposition::ForeignOwner;
        }

        state.leases.remove(canonical_root);

        AgentRootLeaseReleaseDisposition::Released
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

        assert_eq!(
            registry.release(root, token.wrapping_add(1)),
            AgentRootLeaseReleaseDisposition::ForeignOwner
        );
        assert!(registry.is_held(root));
        assert_eq!(
            registry.release(root, token),
            AgentRootLeaseReleaseDisposition::Released
        );
        assert!(!registry.is_held(root));
    }

    #[test]
    fn exhausted_tokens_fail_closed_without_reusing_a_stale_token() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/token-exhaustion");
        let stale = registry.acquire(root).expect("initial acquire");
        assert_eq!(
            registry.release(root, stale),
            AgentRootLeaseReleaseDisposition::Released
        );
        registry.state().next_token = MAX_AGENT_ROOT_LEASE_TOKEN;

        let error = registry.acquire(root).expect_err("token exhaustion");

        assert_eq!(error, AGENT_ROOT_LEASE_TOKEN_EXHAUSTED_ERROR);
        assert!(!registry.is_held(root));
    }

    #[test]
    fn exhausted_token_capacity_preserves_idempotent_held_root_acquisition() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/held-at-exhaustion");
        let held = registry.acquire(root).expect("initial acquire");
        registry.state().next_token = MAX_AGENT_ROOT_LEASE_TOKEN;

        let reacquired = registry.acquire(root).expect("idempotent re-acquire");
        let error = registry
            .acquire(Path::new("/workspace/new-at-exhaustion"))
            .expect_err("new root fails closed");

        assert_eq!(reacquired, held);
        assert_eq!(error, AGENT_ROOT_LEASE_TOKEN_EXHAUSTED_ERROR);
    }

    #[test]
    fn stale_and_unknown_token_release_is_a_no_op() {
        let registry = AgentRootLeaseRegistry::new();
        let root = Path::new("/workspace/gamma");
        let stale = registry.acquire(root).expect("first acquire");

        assert_eq!(
            registry.release(root, stale),
            AgentRootLeaseReleaseDisposition::Released
        );

        let renewed = registry.acquire(root).expect("second acquire");

        assert_ne!(stale, renewed);
        assert_eq!(
            registry.release(root, stale),
            AgentRootLeaseReleaseDisposition::ForeignOwner
        );
        assert!(registry.is_held(root));
        assert_eq!(
            registry.release(Path::new("/workspace/never-leased"), renewed),
            AgentRootLeaseReleaseDisposition::NotHeld
        );
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

        assert_eq!(
            registry.release(&root, token),
            AgentRootLeaseReleaseDisposition::Released
        );

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

        assert_eq!(
            registry.release(leased, token),
            AgentRootLeaseReleaseDisposition::Released
        );

        assert!(dispose_should_stop_agent_tasks(Some(&registry), leased));
    }
}
