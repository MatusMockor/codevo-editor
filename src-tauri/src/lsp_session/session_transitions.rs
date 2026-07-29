use super::{
    DiagnosticsSink, JsonRpcRequest, LanguageServerCommand, LanguageServerRuntimeStatus,
    LanguageServerSupervisor, RefreshSink, RestartController, ServerProcessSpawner, StatusSink,
    WorkspaceEditSink,
};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Distinguishes a fresh start (user request) from an auto-restart after a
/// crash. A restart is only allowed to resume a session that is still crashed,
/// which keeps the crash->stop transition race-free.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StartKind {
    Fresh,
    ReservedFresh,
    Restart,
}

/// Everything needed to re-spawn a crashed session for the *same* workspace.
///
/// Captured per session and handed to the reader thread. On an unexpected crash
/// the reader consults [`RestartController`] and, if a restart is allowed,
/// re-enters the owning supervisor to start a fresh session. The supervisor is
/// held weakly so a dropped/closed workspace cannot be resurrected.
#[allow(dead_code)]
pub(super) struct RestartContext {
    pub(super) supervisor: std::sync::Weak<LanguageServerSupervisor>,
    pub(super) command: LanguageServerCommand,
    pub(super) initialize_request: JsonRpcRequest,
    pub(super) spawner: Arc<dyn ServerProcessSpawner + Send + Sync>,
    pub(super) status_sink: Arc<dyn StatusSink>,
    pub(super) diagnostics_sink: Arc<dyn DiagnosticsSink>,
    pub(super) workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    pub(super) refresh_sink: Arc<dyn RefreshSink>,
    pub(super) controller: Arc<RestartController>,
}

/// Step size for the cancellable backoff. The backoff total can be as long as
/// the restart policy's maximum delay; waking this often keeps a closing
/// workspace's restart thread responsive without busy-spinning.
const RESTART_BACKOFF_STEP: Duration = Duration::from_millis(100);

/// Sleep out `delay` in short steps, re-checking after each step whether the
/// owning workspace is still open.
pub(super) fn cancellable_backoff(
    supervisor: &std::sync::Weak<LanguageServerSupervisor>,
    delay: Duration,
    step: Duration,
) -> Option<Arc<LanguageServerSupervisor>> {
    let deadline = Instant::now() + delay;

    loop {
        let alive = supervisor.upgrade()?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Some(alive);
        }
        drop(alive);
        std::thread::sleep(remaining.min(step));
    }
}

impl RestartContext {
    /// Re-spawn the session after `delay`, unless the workspace closes or a
    /// competing lifecycle transition supersedes this exact crashed session.
    pub(super) fn restart_after(self: Arc<Self>, delay: Duration) {
        std::thread::spawn(move || {
            let Some(supervisor) =
                cancellable_backoff(&self.supervisor, delay, RESTART_BACKOFF_STEP)
            else {
                return;
            };

            let _ = supervisor.start_core(
                &self.command,
                &self.initialize_request,
                self.spawner.as_ref(),
                Arc::clone(&self.status_sink),
                Arc::clone(&self.diagnostics_sink),
                Arc::clone(&self.workspace_edit_sink),
                Arc::clone(&self.refresh_sink),
                Some(Arc::clone(&self)),
                StartKind::Restart,
            );
        });
    }
}

#[allow(dead_code)]
pub(super) fn clone_command(command: &LanguageServerCommand) -> LanguageServerCommand {
    LanguageServerCommand {
        executable: command.executable.clone(),
        args: command.args.clone(),
        working_directory: command.working_directory.clone(),
        env: command.env.clone(),
    }
}

#[allow(dead_code)]
pub(super) fn clone_initialize_request(request: &JsonRpcRequest) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: request.jsonrpc.clone(),
        id: request.id,
        method: request.method.clone(),
        params: request.params.clone(),
    }
}

pub(super) fn publish_crash(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn StatusSink,
    message: &str,
) {
    publish(
        status,
        sink,
        LanguageServerRuntimeStatus::Crashed {
            message: message.to_string(),
        },
    );
}

pub(super) fn publish(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn StatusSink,
    next: LanguageServerRuntimeStatus,
) {
    set_status(status, next.clone());
    sink.emit_status(next);
}

pub(super) fn set_status(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    next: LanguageServerRuntimeStatus,
) {
    if let Ok(mut current) = status.lock() {
        *current = next;
    }
}
