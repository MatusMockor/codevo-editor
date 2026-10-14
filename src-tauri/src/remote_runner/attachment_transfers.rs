use super::attachment_file_wire::UPLOAD_CANCELLED;
use super::commands::OPERATIONS_BUSY;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::watch;

pub(super) const UPLOADS_PER_SERVER: usize = 2;
pub(super) const UPLOADS: usize = 8;
pub(super) const DOWNLOADS: usize = 2;
pub(super) const CANCELLED_RETAINED: usize = 32;
pub(super) const CANCELLED_FOR: Duration = Duration::from_secs(5);
pub(super) const ABANDONED_WORKERS: usize = 16;
pub(super) const WORKER_THREADS: usize = UPLOADS + DOWNLOADS + ABANDONED_WORKERS;

struct Cancelled {
    server_id: String,
    attachment_id: String,
    at: Instant,
}

impl Cancelled {
    fn names(&self, server_id: &str, attachment_id: &str) -> bool {
        self.server_id == server_id && self.attachment_id == attachment_id
    }
}

struct Upload {
    serial: u64,
    server_id: String,
    attachment_id: String,
    cancel: watch::Sender<bool>,
}

struct Worker {
    serial: u64,
    abandoned: bool,
}

#[derive(Default)]
struct Slots {
    workers: Vec<Worker>,
    uploads: Vec<Upload>,
    cancelled: VecDeque<Cancelled>,
    downloads: usize,
    choosing: bool,
    next: u64,
}

impl Slots {
    fn forget_expired(&mut self, now: Instant) {
        self.cancelled
            .retain(|entry| now.saturating_duration_since(entry.at) < CANCELLED_FOR);
    }

    fn saturated(&self) -> bool {
        self.workers.len() >= WORKER_THREADS
    }

    fn reserve(&mut self, state: &AttachmentTransferState) -> WorkerPermit {
        let serial = self.next;
        self.next = self.next.wrapping_add(1);
        self.workers.push(Worker {
            serial,
            abandoned: false,
        });
        WorkerPermit {
            state: state.clone(),
            serial,
        }
    }
}

#[derive(Clone, Default)]
pub struct AttachmentTransferState(Arc<Mutex<Slots>>);

impl AttachmentTransferState {
    fn slots(&self) -> MutexGuard<'_, Slots> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(super) fn admit_upload(
        &self,
        server_id: &str,
        attachment_id: &str,
    ) -> Result<UploadPermit, String> {
        self.admit_upload_at(server_id, attachment_id, Instant::now())
    }

    fn admit_upload_at(
        &self,
        server_id: &str,
        attachment_id: &str,
        now: Instant,
    ) -> Result<UploadPermit, String> {
        let mut slots = self.slots();
        slots.forget_expired(now);
        let cancelled = slots
            .cancelled
            .iter()
            .position(|entry| entry.names(server_id, attachment_id));
        if let Some(position) = cancelled {
            slots.cancelled.remove(position);
            return Err(UPLOAD_CANCELLED.into());
        }
        let server = slots
            .uploads
            .iter()
            .filter(|upload| upload.server_id == server_id);
        let duplicate = server
            .clone()
            .any(|upload| upload.attachment_id == attachment_id);
        if duplicate
            || server.count() >= UPLOADS_PER_SERVER
            || slots.uploads.len() >= UPLOADS
            || slots.saturated()
        {
            return Err(OPERATIONS_BUSY.into());
        }
        let (cancel, cancelled) = watch::channel(false);
        let serial = slots.next;
        slots.next = slots.next.wrapping_add(1);
        slots.uploads.push(Upload {
            serial,
            server_id: server_id.into(),
            attachment_id: attachment_id.into(),
            cancel,
        });
        let worker = slots.reserve(self);
        Ok(UploadPermit {
            state: self.clone(),
            serial,
            cancelled,
            worker: Reserved::holding(worker),
        })
    }

    pub(super) fn cancel_upload(&self, server_id: &str, attachment_id: &str) {
        self.cancel_upload_at(server_id, attachment_id, Instant::now());
    }

    fn cancel_upload_at(&self, server_id: &str, attachment_id: &str, now: Instant) {
        let mut slots = self.slots();
        slots.forget_expired(now);
        let upload = slots
            .uploads
            .iter()
            .find(|upload| upload.server_id == server_id && upload.attachment_id == attachment_id);
        if let Some(upload) = upload {
            upload.cancel.send_replace(true);
            return;
        }
        slots
            .cancelled
            .retain(|entry| !entry.names(server_id, attachment_id));
        slots.cancelled.push_back(Cancelled {
            server_id: server_id.into(),
            attachment_id: attachment_id.into(),
            at: now,
        });
        while slots.cancelled.len() > CANCELLED_RETAINED {
            slots.cancelled.pop_front();
        }
    }

    pub(super) fn admit_download(&self) -> Result<DownloadPermit, String> {
        let mut slots = self.slots();
        if slots.downloads >= DOWNLOADS || slots.saturated() {
            return Err(OPERATIONS_BUSY.into());
        }
        slots.downloads += 1;
        let worker = slots.reserve(self);
        Ok(DownloadPermit {
            state: self.clone(),
            worker: Reserved::holding(worker),
        })
    }

    #[cfg(test)]
    pub(super) fn workers(&self) -> (usize, usize) {
        let slots = self.slots();
        let abandoned = slots.workers.iter().filter(|worker| worker.abandoned);
        (slots.workers.len(), abandoned.count())
    }

    #[cfg(test)]
    pub(super) fn remembered(&self) -> usize {
        self.slots().cancelled.len()
    }

    #[cfg(test)]
    pub(super) fn in_flight(&self) -> (usize, usize) {
        let slots = self.slots();
        (slots.uploads.len(), slots.downloads)
    }
}

struct Reserved(Mutex<Option<WorkerPermit>>);

impl Reserved {
    fn holding(worker: WorkerPermit) -> Self {
        Self(Mutex::new(Some(worker)))
    }

    fn claim(&self) -> Result<(Seat, WorkerPermit), String> {
        let worker = self.0.lock().unwrap_or_else(|e| e.into_inner()).take();
        let worker = worker.ok_or(OPERATIONS_BUSY)?;
        let seat = Seat {
            state: worker.state.clone(),
            serial: worker.serial,
        };
        Ok((seat, worker))
    }
}

pub(super) struct UploadPermit {
    state: AttachmentTransferState,
    serial: u64,
    cancelled: watch::Receiver<bool>,
    worker: Reserved,
}

impl UploadPermit {
    pub(super) fn cancelled(&self) -> watch::Receiver<bool> {
        self.cancelled.clone()
    }

    pub(super) fn is_cancelled(&self) -> bool {
        *self.cancelled.borrow()
    }

    pub(super) fn worker(&self) -> Result<(Seat, WorkerPermit), String> {
        self.worker.claim()
    }
}

impl Drop for UploadPermit {
    fn drop(&mut self) {
        self.state
            .slots()
            .uploads
            .retain(|upload| upload.serial != self.serial);
    }
}

pub(super) struct DownloadPermit {
    state: AttachmentTransferState,
    worker: Reserved,
}

impl DownloadPermit {
    pub(super) fn choosing(&self) -> Result<Choosing<'_>, String> {
        let mut slots = self.state.slots();
        if slots.choosing {
            return Err(OPERATIONS_BUSY.into());
        }
        slots.choosing = true;
        Ok(Choosing(&self.state))
    }

    pub(super) fn worker(&self) -> Result<(Seat, WorkerPermit), String> {
        self.worker.claim()
    }
}

pub(super) struct Seat {
    state: AttachmentTransferState,
    serial: u64,
}

impl Drop for Seat {
    fn drop(&mut self) {
        let mut slots = self.state.slots();
        let worker = slots
            .workers
            .iter_mut()
            .find(|worker| worker.serial == self.serial);
        if let Some(worker) = worker {
            worker.abandoned = true;
        }
    }
}

pub(super) struct WorkerPermit {
    state: AttachmentTransferState,
    serial: u64,
}

impl Drop for WorkerPermit {
    fn drop(&mut self) {
        self.state
            .slots()
            .workers
            .retain(|worker| worker.serial != self.serial);
    }
}

impl Drop for DownloadPermit {
    fn drop(&mut self) {
        let mut slots = self.state.slots();
        slots.downloads = slots.downloads.saturating_sub(1);
    }
}

pub(super) struct Choosing<'a>(&'a AttachmentTransferState);

impl Drop for Choosing<'_> {
    fn drop(&mut self) {
        self.0.slots().choosing = false;
    }
}

#[cfg(test)]
#[path = "attachment_transfers_tests.rs"]
mod tests;
