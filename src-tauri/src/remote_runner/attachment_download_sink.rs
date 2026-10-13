use super::attachment_file_wire::{DOWNLOAD_MISMATCH, LEASE_CHANGED, SAVE_FAILED};
use super::attachment_transfers::{Seat, WorkerPermit};
use super::attachment_watch::{Budget, Guard, Interrupted};
use super::commands::OPERATIONS_BUSY;
use super::service::ConnectionLease;
use super::transport::{DownloadFeed, Session};
use crate::agent_file_source::{entropy, hex};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, watch};

const PARTIAL_ATTEMPTS: usize = 8;
const PARTIAL_MODE: u32 = 0o600;
const SAVED_MODE: u32 = 0o644;
const WORKING: u8 = 0;
const PUBLISHING: u8 = 1;
const ABANDONED: u8 = 2;
const RETIRE_GRACE: Duration = Duration::from_secs(1);

pub(super) trait Sink: Send {
    fn write(&mut self, chunk: &[u8]) -> Result<(), String>;
    fn prepare(&mut self) -> Result<(), String>;
    fn commit(self: Box<Self>) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Halted {
    Locally(String),
    Interrupted(Interrupted),
}

pub(super) type SinkOpener = Box<dyn FnOnce(&Path) -> Result<Box<dyn Sink>, String> + Send>;
pub(super) type Report = Option<Result<(), String>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Placement {
    Beside,
    InPlace,
}

pub(super) struct Partial {
    path: PathBuf,
    target: PathBuf,
    file: File,
    placement: Placement,
    kept: bool,
}

fn exclusive(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(PARTIAL_MODE).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

#[cfg(unix)]
fn same_entry(file: &File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let (Ok(held), Ok(named)) = (file.metadata(), fs::symlink_metadata(path)) else {
        return false;
    };
    named.file_type().is_file() && held.dev() == named.dev() && held.ino() == named.ino()
}

#[cfg(not(unix))]
fn same_entry(_file: &File, path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|named| named.file_type().is_file())
}

impl Partial {
    pub(super) fn create(target: &Path) -> Result<Self, String> {
        let directory = target
            .parent()
            .filter(|_| target.is_absolute() && target.file_name().is_some())
            .ok_or(SAVE_FAILED)?;
        for _ in 0..PARTIAL_ATTEMPTS {
            let token = entropy::<8>().ok_or(SAVE_FAILED)?;
            let path = directory.join(format!(".codevo-download-{}.part", hex(&token)));
            match exclusive(&path) {
                Ok(file) => return Ok(Self::holding(path, target, file, Placement::Beside)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                    return Self::in_place(target);
                }
                Err(_) => return Err(SAVE_FAILED.into()),
            }
        }
        Err(SAVE_FAILED.into())
    }

    pub(super) fn in_place(target: &Path) -> Result<Self, String> {
        let file = exclusive(target).map_err(|_| SAVE_FAILED)?;
        Ok(Self::holding(
            target.to_path_buf(),
            target,
            file,
            Placement::InPlace,
        ))
    }

    fn holding(path: PathBuf, target: &Path, file: File, placement: Placement) -> Self {
        Self {
            path,
            target: target.to_path_buf(),
            file,
            placement,
            kept: false,
        }
    }

    fn ready(&self) -> std::io::Result<()> {
        self.file.sync_all()?;
        if !same_entry(&self.file, &self.path) {
            return Err(std::io::ErrorKind::NotFound.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            self.file
                .set_permissions(fs::Permissions::from_mode(SAVED_MODE))?;
        }
        Ok(())
    }

    fn place(&self) -> std::io::Result<()> {
        if self.placement == Placement::InPlace {
            return Ok(());
        }
        fs::rename(&self.path, &self.target)
    }
}

impl Sink for Partial {
    fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.file.write_all(chunk).map_err(|_| SAVE_FAILED.into())
    }

    fn prepare(&mut self) -> Result<(), String> {
        self.ready().map_err(|_| SAVE_FAILED.into())
    }

    fn commit(mut self: Box<Self>) -> Result<(), String> {
        self.place().map_err(|_| SAVE_FAILED)?;
        self.kept = true;
        Ok(())
    }
}

impl Drop for Partial {
    fn drop(&mut self) {
        if self.kept || !same_entry(&self.file, &self.path) {
            return;
        }
        let _ = fs::remove_file(&self.path);
    }
}

pub(super) struct SaveJob {
    pub(super) target: PathBuf,
    pub(super) open: SinkOpener,
    pub(super) bytes: u64,
    pub(super) sha256: String,
    pub(super) lease: ConnectionLease,
    pub(super) session: Arc<Session>,
    pub(super) budget: Budget,
}

pub(super) struct Saving {
    _seat: Seat,
    commit: Arc<AtomicU8>,
    ready: Option<oneshot::Receiver<Result<(), String>>>,
    feeds: Option<std::sync::mpsc::Sender<DownloadFeed>>,
    verdict: Option<std::sync::mpsc::Sender<()>>,
    report: watch::Receiver<Report>,
}

impl Saving {
    pub(super) fn start(
        (seat, permit): (Seat, WorkerPermit),
        job: SaveJob,
    ) -> Result<Self, String> {
        let commit = Arc::new(AtomicU8::new(WORKING));
        let (readying, ready) = oneshot::channel();
        let (feeds, fed) = std::sync::mpsc::channel();
        let (verdict, decided) = std::sync::mpsc::channel();
        let (reporting, report) = watch::channel(None);
        let committing = Arc::clone(&commit);
        std::thread::Builder::new()
            .name("codevo-attachment-save".into())
            .spawn(move || {
                let _permit = permit;
                let Some(saved) = save(job, readying, fed, decided, &committing) else {
                    return;
                };
                reporting.send_replace(Some(saved));
            })
            .map_err(|_| OPERATIONS_BUSY)?;
        Ok(Self {
            _seat: seat,
            commit,
            ready: Some(ready),
            feeds: Some(feeds),
            verdict: Some(verdict),
            report,
        })
    }

    pub(super) fn ready(&mut self, guard: &mut Guard, patience: Duration) -> Result<(), Halted> {
        let Some(ready) = self.ready.take() else {
            return Err(Halted::Locally(SAVE_FAILED.into()));
        };
        tauri::async_runtime::block_on(async {
            tokio::select! {
                biased;
                ready = ready => ready
                    .unwrap_or_else(|_| Err(SAVE_FAILED.into()))
                    .map_err(Halted::Locally),
                interrupted = guard.interrupted(patience) => Err(Halted::Interrupted(interrupted)),
            }
        })
    }

    pub(super) fn feed(&self, feed: DownloadFeed) {
        if let Some(feeds) = &self.feeds {
            let _ = feeds.send(feed);
        }
    }

    pub(super) fn failure(&self) -> Option<String> {
        self.report.borrow().as_ref()?.as_ref().err().cloned()
    }

    pub(super) async fn failed(&mut self) -> String {
        loop {
            if let Some(failure) = self.failure() {
                return failure;
            }
            if self.report.changed().await.is_err() {
                return std::future::pending().await;
            }
        }
    }

    async fn reported(&mut self) -> Result<(), String> {
        let Ok(report) = self.report.wait_for(Option::is_some).await else {
            return Err(SAVE_FAILED.into());
        };
        report.clone().unwrap_or_else(|| Err(SAVE_FAILED.into()))
    }

    pub(super) fn publish(&mut self, guard: &mut Guard, patience: Duration) -> Result<(), Halted> {
        if let Some(verdict) = &self.verdict {
            let _ = verdict.send(());
        }
        let deadline = tokio::time::Instant::from_std(guard.budget().deadline());
        tauri::async_runtime::block_on(async {
            let interrupted = tokio::select! {
                biased;
                report = self.reported() => return report.map_err(Halted::Locally),
                interrupted = guard.interrupted(patience) => interrupted,
            };
            if self.abandon() {
                return Err(Halted::Interrupted(interrupted));
            }
            tokio::time::timeout_at(deadline, self.reported())
                .await
                .unwrap_or_else(|_| Err(SAVE_FAILED.into()))
                .map_err(Halted::Locally)
        })
    }

    pub(super) fn retire(mut self) {
        self.abandon();
        self.feeds.take();
        self.verdict.take();
        let finished = async { while self.report.changed().await.is_ok() {} };
        let retired = async { tokio::time::timeout(RETIRE_GRACE, finished).await };
        let _ = tauri::async_runtime::block_on(retired);
    }

    fn abandon(&self) -> bool {
        self.commit
            .compare_exchange(WORKING, ABANDONED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

impl Drop for Saving {
    fn drop(&mut self) {
        self.abandon();
    }
}

fn save(
    job: SaveJob,
    readying: oneshot::Sender<Result<(), String>>,
    fed: std::sync::mpsc::Receiver<DownloadFeed>,
    decided: std::sync::mpsc::Receiver<()>,
    commit: &AtomicU8,
) -> Option<Result<(), String>> {
    let mut sink = match (job.open)(&job.target) {
        Ok(sink) => sink,
        Err(error) => {
            let _ = readying.send(Err(error));
            return None;
        }
    };
    readying.send(Ok(())).ok()?;
    let mut feed = fed.recv().ok()?;
    let mut digest = Sha256::new();
    let mut received = 0_u64;
    while let Some(chunk) = feed.next() {
        received = received.saturating_add(chunk.len() as u64);
        if received > job.bytes {
            return Some(Err(DOWNLOAD_MISMATCH.into()));
        }
        digest.update(&chunk);
        if let Err(error) = sink.write(&chunk) {
            return Some(Err(error));
        }
    }
    decided.recv().ok()?;
    if received != job.bytes || hex(&digest.finalize()) != job.sha256 {
        return Some(Err(DOWNLOAD_MISMATCH.into()));
    }
    if let Err(error) = sink.prepare() {
        return Some(Err(error));
    }
    let begun = commit.compare_exchange(WORKING, PUBLISHING, Ordering::AcqRel, Ordering::Acquire);
    if begun.is_err() {
        return Some(Err(SAVE_FAILED.into()));
    }
    let authorized = job.lease.is_current() && job.session.is_open();
    if let Err(refusal) = cleared(authorized, Instant::now(), job.budget) {
        return Some(Err(refusal.into()));
    }
    Some(sink.commit())
}

pub(super) fn cleared(authorized: bool, now: Instant, budget: Budget) -> Result<(), &'static str> {
    if !authorized {
        return Err(LEASE_CHANGED);
    }
    if budget.spent(now) {
        return Err(SAVE_FAILED);
    }
    Ok(())
}
