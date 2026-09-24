use super::WorkspaceFileChangeWatchRegistry;
use crate::workspace_runtime::WorkspaceWatchDisposer;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

const MAX_WORKSPACE_WATCH_DISPOSAL_FENCES: usize = 128;
const WORKSPACE_WATCH_DISPOSAL_FENCE_LIFETIME: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceWatchDisposalTicket {
    id: u64,
    watermark: u64,
    keys: Vec<String>,
}

impl WorkspaceWatchDisposalTicket {
    pub(super) fn watermark(&self) -> u64 {
        self.watermark
    }

    pub(super) fn keys(&self) -> &[String] {
        &self.keys
    }
}

struct DisposalFence {
    ticket: WorkspaceWatchDisposalTicket,
    created: Instant,
}

#[derive(Default)]
pub(super) struct WorkspaceWatchDisposalFences {
    next_id: AtomicU64,
    fences: Mutex<Vec<DisposalFence>>,
}

impl WorkspaceWatchDisposalFences {
    pub(super) fn insert(
        &self,
        watermark: u64,
        keys: Vec<String>,
    ) -> Result<WorkspaceWatchDisposalTicket, String> {
        let mut fences = self
            .fences
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        fences.retain(|fence| fence.created.elapsed() < WORKSPACE_WATCH_DISPOSAL_FENCE_LIFETIME);
        if fences.len() >= MAX_WORKSPACE_WATCH_DISPOSAL_FENCES {
            return Err(format!(
                "Workspace watch disposal capacity ({MAX_WORKSPACE_WATCH_DISPOSAL_FENCES}) was reached."
            ));
        }
        let ticket = WorkspaceWatchDisposalTicket {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            watermark,
            keys,
        };
        fences.push(DisposalFence {
            ticket: ticket.clone(),
            created: Instant::now(),
        });
        Ok(ticket)
    }

    pub(super) fn blocks(&self, root_key: &str, generation: u64) -> bool {
        self.fences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .any(|fence| {
                fence.ticket.watermark < generation
                    && fence.created.elapsed() < WORKSPACE_WATCH_DISPOSAL_FENCE_LIFETIME
                    && fence.ticket.keys.iter().any(|key| key == root_key)
            })
    }

    pub(super) fn remove(&self, ticket: &WorkspaceWatchDisposalTicket) {
        self.fences
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|fence| fence.ticket.id != ticket.id);
    }
}

pub struct WorkspaceWatchDisposalGuard<'a> {
    registry: &'a WorkspaceFileChangeWatchRegistry,
    ticket: Mutex<Option<WorkspaceWatchDisposalTicket>>,
}

impl<'a> WorkspaceWatchDisposalGuard<'a> {
    pub(super) fn new(
        registry: &'a WorkspaceFileChangeWatchRegistry,
        ticket: WorkspaceWatchDisposalTicket,
    ) -> Self {
        Self {
            registry,
            ticket: Mutex::new(Some(ticket)),
        }
    }

    pub fn stop_watches_before_arrival(&self) {
        self.settle(true);
    }

    fn settle(&self, stop: bool) {
        let Some(ticket) = self
            .ticket
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        else {
            return;
        };
        self.registry.complete_disposal(&ticket, stop);
    }
}

impl WorkspaceWatchDisposer for WorkspaceWatchDisposalGuard<'_> {
    fn stop_workspace_watch(&self, _root_path: &str) {
        self.settle(true);
    }
}

impl Drop for WorkspaceWatchDisposalGuard<'_> {
    fn drop(&mut self) {
        self.settle(false);
    }
}
