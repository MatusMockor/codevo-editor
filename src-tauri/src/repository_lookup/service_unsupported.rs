use std::sync::Arc;

use super::wire::{
    RepositoryHostsSnapshot, RepositoryHostsState, RepositoryLookupFailureReason,
    RepositoryLookupOutcome, RepositoryLookupRequest,
};
use crate::agent_cli_discovery::AgentCliDiscovery;

pub(crate) struct RepositoryLookupService;

impl RepositoryLookupService {
    pub(crate) fn new(_discovery: Arc<AgentCliDiscovery>) -> Self {
        Self
    }

    pub(crate) fn search(
        &self,
        _request: super::search_wire::RepositorySearchRequest,
    ) -> super::search_wire::RepositorySearchOutcome {
        super::search_wire::RepositorySearchOutcome::Failure(RepositoryLookupOutcome::CliMissing)
    }

    pub(crate) fn hosts(&self) -> RepositoryHostsSnapshot {
        RepositoryHostsSnapshot {
            github: RepositoryHostsState::CliMissing,
            gitlab: RepositoryHostsState::CliMissing,
        }
    }

    pub(crate) fn lookup(&self, _request: RepositoryLookupRequest) -> RepositoryLookupOutcome {
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Unknown,
        }
    }
}
