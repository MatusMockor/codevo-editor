use super::{
    attachment_file_wire::{
        stored, upload_refusal, CancelUploadRequest, Sent, StoredFile, UploadFileRequest,
        FILE_CAPABILITY, INVALID_RESPONSE, LEASE_CHANGED, UPLOAD_CANCELLED,
    },
    attachment_transfers::{AttachmentTransferState, UploadPermit},
    attachment_upload_feed::{ChunkSource, Feeding, Halted, SourceOpener},
    attachment_watch::{Budget, Guard},
    service::{ConnectionLease, RemoteRunnerState},
    transport::{Failure, Reply, Transfer, TransferPolicy, UploadHead},
};
use crate::agent_file_source::{FileSources, NOT_STAGED, UNREADABLE};
use std::{sync::Arc, time::Instant};

#[tauri::command]
pub async fn remote_runner_upload_attachment_file(
    state: tauri::State<'_, RemoteRunnerState>,
    sources: tauri::State<'_, Arc<FileSources>>,
    transfers: tauri::State<'_, AttachmentTransferState>,
    request: UploadFileRequest,
) -> Result<StoredFile, String> {
    request.validate()?;
    let permit = transfers.admit_upload(&request.server_id, &request.attachment_id)?;
    let state = state.inner().clone();
    let sources = Arc::clone(sources.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let lease = state.connection_lease(&request.server_id)?;
        upload(&lease, &sources, &permit, &request, TransferPolicy::FILE)
    })
    .await
    .map_err(|_| "Runner operation failed")?
}

#[tauri::command]
pub async fn remote_runner_cancel_attachment_upload(
    transfers: tauri::State<'_, AttachmentTransferState>,
    request: CancelUploadRequest,
) -> Result<(), String> {
    request.validate()?;
    transfers.cancel_upload(&request.server_id, &request.attachment_id);
    Ok(())
}

pub(super) struct SourcePlan {
    pub(super) length: u64,
    pub(super) media_type: &'static str,
    pub(super) open: SourceOpener,
}

fn current(lease: &ConnectionLease, permit: &UploadPermit) -> Result<(), String> {
    if permit.is_cancelled() {
        return Err(UPLOAD_CANCELLED.into());
    }
    if !lease.is_current() {
        return Err(LEASE_CHANGED.into());
    }
    Ok(())
}

pub(super) fn upload(
    lease: &ConnectionLease,
    sources: &FileSources,
    permit: &UploadPermit,
    request: &UploadFileRequest,
    policy: TransferPolicy,
) -> Result<StoredFile, String> {
    request.validate()?;
    let budget = Budget::starting(Instant::now(), policy.total);
    let source = sources.find(&request.source_id).ok_or(NOT_STAGED)?;
    let plan = SourcePlan {
        length: source.bytes(),
        media_type: source.media_type(),
        open: Box::new(move || {
            let reader = source.open()?;
            Ok(Box::new(reader) as Box<dyn ChunkSource>)
        }),
    };
    upload_from(lease, permit, request, policy, budget, plan)
}

enum Ended {
    Locally(String),
    Remotely(Failure),
}

async fn settle(exchange: &mut Transfer<'_, Reply>, feeding: &mut Feeding) -> Result<Reply, Ended> {
    tokio::select! {
        biased;
        failure = feeding.failed() => Err(Ended::Locally(failure)),
        reply = exchange.settled() => reply.map_err(Ended::Remotely),
    }
}

pub(super) fn upload_from(
    lease: &ConnectionLease,
    permit: &UploadPermit,
    request: &UploadFileRequest,
    policy: TransferPolicy,
    budget: Budget,
    plan: SourcePlan,
) -> Result<StoredFile, String> {
    request.validate()?;
    current(lease, permit)?;
    let session = lease.session_with_cancellation(|| permit.is_cancelled());
    current(lease, permit)?;
    let session = session?;
    let wanted = {
        let (lease, cancelled) = (lease.clone(), permit.cancelled());
        move || lease.is_current() && !*cancelled.borrow()
    };
    let mut guard = Guard::new(budget, &session, Some(permit.cancelled()));
    let mut feeding = Feeding::start(permit.worker()?, plan.open, wanted)?;
    if let Err(halted) = feeding.opened(&mut guard, policy.local) {
        return Err(match halted {
            Halted::Locally(failure) => failure,
            Halted::Interrupted(interrupted) => {
                interrupted.refusal(lease, UPLOAD_CANCELLED, LEASE_CHANGED, UNREADABLE)
            }
        });
    }
    current(lease, permit)?;
    let head = UploadHead {
        path: request.path(),
        headers: vec![
            ("x-codevo-attachment-kind", "file".into()),
            ("content-type", plan.media_type.into()),
            ("x-file-name", request.file_name_header()),
        ],
        length: plan.length,
        capability: FILE_CAPABILITY,
    };
    let (feed, mut exchange) = session.upload(
        lease.server(),
        head,
        policy,
        budget.deadline(),
        permit.cancelled(),
    )?;
    feeding.feed(feed);
    let ended = tauri::async_runtime::block_on(settle(&mut exchange, &mut feeding));
    let reply = match ended {
        Ok(reply) => reply,
        Err(Ended::Locally(failure)) => return Err(failure),
        Err(Ended::Remotely(failure)) => {
            if let Some(failure) = feeding.failure() {
                return Err(failure);
            }
            current(lease, permit)?;
            return Err(upload_refusal(failure));
        }
    };
    current(lease, permit)?;
    let sha256 = feeding.digest().ok_or(INVALID_RESPONSE)?;
    stored(
        reply.status,
        &reply.body,
        &Sent {
            id: &request.attachment_id,
            runner_id: lease.runner_id(),
            name: &request.name,
            bytes: plan.length,
            sha256: &sha256,
            media_type: plan.media_type,
        },
    )
}

#[cfg(all(test, unix))]
#[path = "attachment_upload_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "attachment_upload_feed_tests.rs"]
mod feed_tests;
