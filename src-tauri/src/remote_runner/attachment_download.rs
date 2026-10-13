use super::{
    attachment_download_sink::{Halted, Partial, SaveJob, Saving, Sink, SinkOpener},
    attachment_file_wire::{
        download_refusal, DownloadOutcome, DownloadRequest, DownloadStatus, LEASE_CHANGED,
        SAVE_FAILED,
    },
    attachment_transfers::{AttachmentTransferState, DownloadPermit},
    attachment_watch::{Budget, Guard},
    service::{ConnectionLease, RemoteRunnerState},
    transport::{Session, Transfer, TransferPolicy},
};
use std::{path::PathBuf, sync::Arc, time::Instant};

pub(super) trait SaveDestination {
    fn choose(&self, suggested: &str) -> Result<Option<PathBuf>, String>;
}

struct NativeSaveDialog(tauri::AppHandle);

impl SaveDestination for NativeSaveDialog {
    fn choose(&self, suggested: &str) -> Result<Option<PathBuf>, String> {
        use tauri_plugin_dialog::DialogExt;
        let Some(chosen) = self
            .0
            .dialog()
            .file()
            .set_file_name(suggested)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        chosen.into_path().map(Some).map_err(|_| SAVE_FAILED.into())
    }
}

#[tauri::command]
pub async fn remote_runner_download_attachment(
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteRunnerState>,
    transfers: tauri::State<'_, AttachmentTransferState>,
    request: DownloadRequest,
) -> Result<DownloadOutcome, String> {
    request.validate()?;
    let permit = transfers.admit_download()?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let lease = state.connection_lease(&request.server_id)?;
        download(
            &lease,
            &permit,
            &request,
            &NativeSaveDialog(app),
            TransferPolicy::FILE,
        )
    })
    .await
    .map_err(|_| "Runner operation failed")?
}

pub(super) fn download(
    lease: &ConnectionLease,
    permit: &DownloadPermit,
    request: &DownloadRequest,
    destination: &dyn SaveDestination,
    policy: TransferPolicy,
) -> Result<DownloadOutcome, String> {
    request.validate()?;
    let chosen = {
        let _choosing = permit.choosing()?;
        destination.choose(&request.suggested_name())?
    };
    let Some(target) = chosen else {
        return Ok(DownloadOutcome {
            status: DownloadStatus::Cancelled,
        });
    };
    let open: SinkOpener = Box::new(|target| {
        let partial = Partial::create(target)?;
        Ok(Box::new(partial) as Box<dyn Sink>)
    });
    let budget = Budget::starting(Instant::now(), policy.total);
    download_into(lease, permit, request, policy, budget, target, open)
}

async fn settle(exchange: &mut Transfer<'_, ()>, saving: &mut Saving) -> Result<(), String> {
    let ended = tokio::select! {
        biased;
        failure = saving.failed() => return Err(failure),
        ended = exchange.settled() => ended,
    };
    let Err(failure) = ended else {
        return Ok(());
    };
    Err(saving
        .failure()
        .unwrap_or_else(|| download_refusal(failure)))
}

fn refusal(lease: &ConnectionLease, halted: Halted) -> String {
    match halted {
        Halted::Locally(failure) => failure,
        Halted::Interrupted(interrupted) => {
            interrupted.refusal(lease, SAVE_FAILED, LEASE_CHANGED, SAVE_FAILED)
        }
    }
}

fn transfer(
    lease: &ConnectionLease,
    request: &DownloadRequest,
    policy: TransferPolicy,
    session: &Session,
    guard: &mut Guard,
    saving: &mut Saving,
) -> Result<(), String> {
    saving
        .ready(guard, policy.local)
        .map_err(|halted| refusal(lease, halted))?;
    let (feed, mut exchange) = session.download(
        lease.server(),
        request.path(),
        request.bytes,
        policy,
        guard.budget().deadline(),
    )?;
    saving.feed(feed);
    tauri::async_runtime::block_on(settle(&mut exchange, saving))?;
    if !lease.is_current() {
        return Err(LEASE_CHANGED.into());
    }
    saving
        .publish(guard, policy.local)
        .map_err(|halted| refusal(lease, halted))
}

pub(super) fn download_into(
    lease: &ConnectionLease,
    permit: &DownloadPermit,
    request: &DownloadRequest,
    policy: TransferPolicy,
    budget: Budget,
    target: PathBuf,
    open: SinkOpener,
) -> Result<DownloadOutcome, String> {
    request.validate()?;
    if !lease.is_current() {
        return Err(LEASE_CHANGED.into());
    }
    let session = lease.session()?;
    let job = SaveJob {
        target,
        open,
        bytes: request.bytes,
        sha256: request.sha256.clone(),
        lease: lease.clone(),
        session: Arc::clone(&session),
        budget,
    };
    let mut guard = Guard::new(budget, &session, None);
    let mut saving = Saving::start(permit.worker()?, job)?;
    if let Err(failure) = transfer(lease, request, policy, &session, &mut guard, &mut saving) {
        saving.retire();
        return Err(failure);
    }
    Ok(DownloadOutcome {
        status: DownloadStatus::Saved,
    })
}

#[cfg(all(test, unix))]
#[path = "attachment_download_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "attachment_download_sink_tests.rs"]
mod sink_tests;
