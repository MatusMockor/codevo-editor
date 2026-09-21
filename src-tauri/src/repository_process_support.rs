//! Shared bounded pipe draining and owned process-group primitives for repository operations.
#[cfg(unix)]
#[path = "repository_lookup/pipes.rs"]
pub(crate) mod pipes;
#[cfg(unix)]
#[path = "repository_lookup/process_guard.rs"]
pub(crate) mod process_guard;
