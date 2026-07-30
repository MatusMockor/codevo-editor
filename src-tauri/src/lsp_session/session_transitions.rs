use super::{
    DiagnosticsSink, JsonRpcRequest, LanguageServerCommand, LanguageServerRuntimeStatus,
    LanguageServerSupervisor, RefreshSink, RestartController, ServerProcessSpawner, StatusSink,
    WorkspaceEditSink,
};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
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
const MAX_TRACKED_RESTART_TASKS: usize = 64;

fn restart_tasks() -> &'static Mutex<Vec<JoinHandle<()>>> {
    static TASKS: OnceLock<Mutex<Vec<JoinHandle<()>>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(Vec::new()))
}

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
        let mut tasks = restart_tasks()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut index = 0;
        while index < tasks.len() {
            if tasks[index].is_finished() {
                let handle = tasks.swap_remove(index);
                let _ = handle.join();
            } else {
                index += 1;
            }
        }
        if tasks.len() >= MAX_TRACKED_RESTART_TASKS {
            return;
        }
        let task = std::thread::Builder::new()
            .name("lsp-auto-restart".to_string())
            .spawn(move || {
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
        if let Ok(task) = task {
            tasks.push(task);
        }
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

pub(super) fn set_status(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    next: LanguageServerRuntimeStatus,
) {
    let mut current = status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = next;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_status_recovers_a_poisoned_mutex() {
        let status = Arc::new(Mutex::new(LanguageServerRuntimeStatus::Starting {
            session_id: 7,
        }));
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = status.lock().expect("status");
            panic!("poison language server status mutex");
        }));
        assert!(poisoned.is_err());

        set_status(&status, LanguageServerRuntimeStatus::Stopped);

        let current = status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(*current, LanguageServerRuntimeStatus::Stopped);
    }
}
