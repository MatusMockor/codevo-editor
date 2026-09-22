#![cfg_attr(not(unix), allow(dead_code))]

mod repository_path;
mod sanitize;
#[cfg(unix)]
mod search;
mod search_wire;
mod wire;
pub(crate) use search_wire::{
    RepositorySearchOutcome, RepositorySearchRequest, RepositorySearchRequestWire,
};

#[cfg(unix)]
mod authority;
#[cfg(unix)]
mod classify;
#[cfg(unix)]
mod clock;
#[cfg(unix)]
mod clone_url;
#[cfg(unix)]
mod github;
#[cfg(unix)]
mod gitlab;
#[cfg(unix)]
mod hosts;
#[cfg(unix)]
use crate::repository_process_support::{pipes, process_guard};
#[cfg(unix)]
mod plan;
#[cfg(unix)]
mod process;

#[cfg(unix)]
mod resolver;
#[cfg(unix)]
mod service;
#[cfg(unix)]
mod slot;

#[cfg(not(unix))]
#[path = "service_unsupported.rs"]
mod service;

#[cfg(test)]
mod tests;

pub(crate) use service::RepositoryLookupService;
pub(crate) use wire::{
    RepositoryHostsSnapshot, RepositoryLookupOutcome, RepositoryLookupRequest,
    RepositoryLookupRequestWire,
};
