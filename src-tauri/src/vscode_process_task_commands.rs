use std::{
    collections::HashSet,
    io::Read,
    sync::Arc,
    thread::{self, JoinHandle},
};

use crate::{
    terminal::{TerminalEventSink, TerminalOutputEvent},
    terminal_task_process::TerminalTaskOwnership,
    vscode_process_task_events::{
        VscodeProcessTaskEventSink, VscodeProcessTaskOutputStream, VscodeProcessTaskOwner,
    },
    vscode_process_task_registry::{
        VscodeProcessTaskCompletion, VscodeProcessTaskRegistry, VscodeProcessTaskStep,
        VscodeProcessTaskStepActivation, VscodeProcessTaskStopAction,
    },
    workspace_registry::WorkspaceId,
};

#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
use crate::{
    process_task_runtime::{
        finish_process_task, ProcessTaskOwner, ProcessTaskRuntime, SpawnProcessTaskRequest,
    },
    terminal_session::TerminalSupervisor,
    trust::WorkspaceTrustService,
    workspace_registry::WorkspaceRegistry,
};
#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
use std::sync::Mutex;
#[cfg(all(not(test), not(any(target_os = "macos", target_os = "linux"))))]
use tauri::AppHandle;
#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
use tauri::{AppHandle, Manager};

const READER_BUFFER_BYTES: usize = 8 * 1_024;
const MAX_CHAIN_TASKS: usize = 128;
const MAX_CHAIN_LABEL_BYTES: usize = 256;

pub(crate) type StartVscodeProcessTaskRequest = VscodeProcessTaskOwner;
pub(crate) type StartVscodeProcessTaskResponse = VscodeProcessTaskOwner;
pub(crate) type AcknowledgeVscodeProcessTaskStartRequest = VscodeProcessTaskOwner;
pub(crate) type StopVscodeProcessTaskRequest = VscodeProcessTaskOwner;

pub(crate) trait ProcessTaskRuntimePort: Send + Sync {
    fn resolve_chain(&self, owner: &VscodeProcessTaskOwner) -> Result<Vec<String>, String> {
        Ok(vec![owner.label.clone()])
    }

    fn prepare_and_spawn(
        &self,
        owner: &VscodeProcessTaskOwner,
    ) -> Result<PreparedProcessTask, String>;

    fn prepare_and_spawn_step(
        &self,
        owner: &VscodeProcessTaskOwner,
        label: &str,
    ) -> Result<PreparedProcessTask, String> {
        let mut step = owner.clone();
        step.label = label.to_string();
        self.prepare_and_spawn(&step)
    }
}

#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
pub(crate) struct AppProcessTaskRuntime(pub(crate) AppHandle);

#[cfg(all(not(test), not(any(target_os = "macos", target_os = "linux"))))]
pub(crate) struct AppProcessTaskRuntime(pub(crate) AppHandle);

#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
impl ProcessTaskRuntimePort for AppProcessTaskRuntime {
    fn resolve_chain(&self, owner: &VscodeProcessTaskOwner) -> Result<Vec<String>, String> {
        let registry = self.0.state::<WorkspaceRegistry>();
        let descriptor = registry
            .descriptor(&owner.workspace_id)
            .map_err(|_| "Process task workspace is not registered.".to_string())?;
        let trust = self.0.state::<Mutex<WorkspaceTrustService>>();
        let terminals = self.0.state::<TerminalSupervisor>();
        ProcessTaskRuntime::new(&registry, &trust, &terminals).resolve_chain_labels(
            &SpawnProcessTaskRequest {
                owner: ProcessTaskOwner {
                    workspace_id: owner.workspace_id.clone(),
                    workspace_root: descriptor.canonical_root_path,
                    terminal_session_id: owner.session_id,
                },
                config_revision: owner.config_revision.clone(),
                label: owner.label.clone(),
            },
        )
    }

    fn prepare_and_spawn(
        &self,
        owner: &VscodeProcessTaskOwner,
    ) -> Result<PreparedProcessTask, String> {
        self.prepare_and_spawn_step(owner, &owner.label)
    }

    fn prepare_and_spawn_step(
        &self,
        owner: &VscodeProcessTaskOwner,
        label: &str,
    ) -> Result<PreparedProcessTask, String> {
        let registry = self.0.state::<WorkspaceRegistry>();
        let descriptor = registry
            .descriptor(&owner.workspace_id)
            .map_err(|_| "Process task workspace is not registered.".to_string())?;
        let trust = self.0.state::<Mutex<WorkspaceTrustService>>();
        let terminals = self.0.state::<TerminalSupervisor>();
        let mut spawned = ProcessTaskRuntime::new(&registry, &trust, &terminals)
            .prepare_and_spawn(&SpawnProcessTaskRequest {
                owner: ProcessTaskOwner {
                    workspace_id: owner.workspace_id.clone(),
                    workspace_root: descriptor.canonical_root_path,
                    terminal_session_id: owner.session_id,
                },
                config_revision: owner.config_revision.clone(),
                label: label.to_string(),
            })?;
        let stdout = spawned
            .stdout
            .take()
            .map(|reader| Box::new(reader) as Box<dyn Read + Send>);
        let stderr = spawned
            .stderr
            .take()
            .map(|reader| Box::new(reader) as Box<dyn Read + Send>);
        let ownership = spawned.ownership.clone();
        let terminal_sink = Arc::clone(&spawned.sink);
        let app = self.0.clone();
        Ok(PreparedProcessTask {
            ownership,
            terminal_sink,
            stdout,
            stderr,
            finish: Box::new(move || {
                let terminals = app.state::<TerminalSupervisor>();
                finish_process_task(&terminals, &mut spawned)
                    .map(|status| status.code())
                    .map_err(|_| {
                        "The process task failed while waiting for completion.".to_string()
                    })
            }),
        })
    }
}

#[cfg(all(not(test), not(any(target_os = "macos", target_os = "linux"))))]
impl ProcessTaskRuntimePort for AppProcessTaskRuntime {
    fn prepare_and_spawn(
        &self,
        _owner: &VscodeProcessTaskOwner,
    ) -> Result<PreparedProcessTask, String> {
        let _ = &self.0;
        Err("VS Code process tasks are not supported on this platform.".to_string())
    }
}

pub(crate) struct PreparedProcessTask {
    pub(crate) ownership: TerminalTaskOwnership,
    pub(crate) terminal_sink: Arc<dyn TerminalEventSink>,
    pub(crate) stdout: Option<Box<dyn Read + Send>>,
    pub(crate) stderr: Option<Box<dyn Read + Send>>,
    pub(crate) finish: Box<dyn FnOnce() -> Result<Option<i32>, String> + Send>,
}

#[derive(Clone)]
pub(crate) struct VscodeProcessTaskCommandService {
    registry: Arc<VscodeProcessTaskRegistry>,
    runtime: Arc<dyn ProcessTaskRuntimePort>,
    event_sink: Arc<dyn VscodeProcessTaskEventSink>,
}

impl VscodeProcessTaskCommandService {
    pub(crate) fn new(
        registry: Arc<VscodeProcessTaskRegistry>,
        runtime: Arc<dyn ProcessTaskRuntimePort>,
        event_sink: Arc<dyn VscodeProcessTaskEventSink>,
    ) -> Self {
        Self {
            registry,
            runtime,
            event_sink,
        }
    }

    pub(crate) fn start(
        &self,
        request: StartVscodeProcessTaskRequest,
    ) -> Result<StartVscodeProcessTaskResponse, String> {
        self.registry.reserve(request.clone())?;
        let chain = match self.runtime.resolve_chain(&request) {
            Ok(chain) if valid_chain(&chain, &request.label) => chain,
            _ => {
                let _ = self.registry.complete(
                    &request,
                    VscodeProcessTaskCompletion::Failed {
                        message: "Unable to resolve the process task chain safely.".to_string(),
                    },
                    self.event_sink.as_ref(),
                );
                return Err("Unable to resolve the process task chain safely.".to_string());
            }
        };
        let total = u16::try_from(chain.len())
            .map_err(|_| "Unable to resolve the process task chain safely.".to_string())?;
        let prepared = match self.runtime.prepare_and_spawn_step(&request, &chain[0]) {
            Ok(prepared) => prepared,
            Err(_) => {
                let _ = self.registry.complete(
                    &request,
                    VscodeProcessTaskCompletion::Failed {
                        message: "Unable to start the process task safely.".to_string(),
                    },
                    self.event_sink.as_ref(),
                );
                return Err("Unable to start the process task safely.".to_string());
            }
        };
        let stop_requested = match self.registry.activate_step(
            &request,
            prepared.ownership.clone(),
            VscodeProcessTaskStep {
                label: &chain[0],
                index: 1,
                total,
            },
        ) {
            Ok(stop_requested) => stop_requested,
            Err(error) => {
                prepared.ownership.request_stop();
                let _ = self.registry.complete(
                    &request,
                    VscodeProcessTaskCompletion::Failed {
                        message: "Unable to activate the process task.".to_string(),
                    },
                    self.event_sink.as_ref(),
                );
                spawn_cleanup(prepared);
                return Err(bounded_failure(&error));
            }
        };
        if stop_requested {
            prepared.ownership.request_stop();
        }
        self.spawn_lifecycle(request.clone(), chain, total, prepared);
        Ok(request)
    }

    pub(crate) fn acknowledge(
        &self,
        request: AcknowledgeVscodeProcessTaskStartRequest,
    ) -> Result<(), String> {
        self.registry
            .acknowledge_start(&request, self.event_sink.as_ref())
    }

    pub(crate) fn stop(&self, request: StopVscodeProcessTaskRequest) -> Result<(), String> {
        if let VscodeProcessTaskStopAction::Terminate(ownership) =
            self.registry.request_stop(&request)?
        {
            ownership.request_stop();
        }
        Ok(())
    }

    pub(crate) fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        for ownership in self.registry.request_stop_workspace(workspace_id) {
            ownership.request_stop();
        }
    }

    pub(crate) fn request_stop_all(&self) {
        for ownership in self.registry.request_stop_all() {
            ownership.request_stop();
        }
    }

    fn spawn_lifecycle(
        &self,
        owner: VscodeProcessTaskOwner,
        chain: Vec<String>,
        total: u16,
        run: PreparedProcessTask,
    ) {
        let registry = Arc::clone(&self.registry);
        let runtime = Arc::clone(&self.runtime);
        let event_sink = Arc::clone(&self.event_sink);
        thread::spawn(move || {
            let mut current = run;
            let mut labels = chain.into_iter();
            let _ = labels.next();
            let mut step_index = 1_u16;
            let completion = loop {
                let previous_ownership = current.ownership.clone();
                let step_result = finish_prepared_step(&owner, current, &registry, &event_sink);
                match step_result {
                    StepResult::Stopped => break VscodeProcessTaskCompletion::Stopped,
                    StepResult::Exited(exit_code) if exit_code == Some(0) => {
                        let Some(next_label) = labels.next() else {
                            break VscodeProcessTaskCompletion::Exited { exit_code };
                        };
                        match registry.may_continue(&owner, &previous_ownership) {
                            Ok(true) => {}
                            Ok(false) => break VscodeProcessTaskCompletion::Stopped,
                            Err(_) => {
                                break VscodeProcessTaskCompletion::Failed {
                                    message: "Unable to continue the process task chain safely."
                                        .to_string(),
                                };
                            }
                        }
                        let next = match runtime.prepare_and_spawn_step(&owner, &next_label) {
                            Ok(next) => next,
                            Err(_) => {
                                break VscodeProcessTaskCompletion::Failed {
                                    message: "Unable to continue the process task chain safely."
                                        .to_string(),
                                };
                            }
                        };
                        step_index = step_index.saturating_add(1);
                        let activation = match registry.replace_ownership_step(
                            &owner,
                            &previous_ownership,
                            next.ownership.clone(),
                            VscodeProcessTaskStep {
                                label: &next_label,
                                index: step_index,
                                total,
                            },
                            event_sink.as_ref(),
                        ) {
                            Ok(activation) => activation,
                            Err(_) => {
                                next.ownership.request_stop();
                                spawn_cleanup(next);
                                break VscodeProcessTaskCompletion::Failed {
                                    message: "Unable to activate the next process task safely."
                                        .to_string(),
                                };
                            }
                        };
                        if activation == VscodeProcessTaskStepActivation::StopRequested {
                            next.ownership.request_stop();
                            spawn_cleanup(next);
                            break VscodeProcessTaskCompletion::Stopped;
                        }
                        current = next;
                    }
                    StepResult::Exited(exit_code) => {
                        break VscodeProcessTaskCompletion::Exited { exit_code };
                    }
                    StepResult::Failed(message) => {
                        break VscodeProcessTaskCompletion::Failed { message };
                    }
                }
            };
            let _ = registry.complete(&owner, completion, event_sink.as_ref());
        });
    }
}

fn valid_chain(chain: &[String], target_label: &str) -> bool {
    if chain.is_empty()
        || chain.len() > MAX_CHAIN_TASKS
        || chain.last().map(String::as_str) != Some(target_label)
    {
        return false;
    }
    let mut unique = HashSet::with_capacity(chain.len());
    chain.iter().all(|label| {
        !label.trim().is_empty()
            && label.len() <= MAX_CHAIN_LABEL_BYTES
            && !label.chars().any(char::is_control)
            && unique.insert(label.as_str())
    })
}

enum StepResult {
    Exited(Option<i32>),
    Failed(String),
    Stopped,
}

fn finish_prepared_step(
    owner: &VscodeProcessTaskOwner,
    mut run: PreparedProcessTask,
    registry: &Arc<VscodeProcessTaskRegistry>,
    event_sink: &Arc<dyn VscodeProcessTaskEventSink>,
) -> StepResult {
    let stdout = run.stdout.take().map(|reader| {
        spawn_output_reader(
            reader,
            owner.clone(),
            VscodeProcessTaskOutputStream::Stdout,
            Arc::clone(registry),
            Arc::clone(event_sink),
            Arc::clone(&run.terminal_sink),
        )
    });
    let stderr = run.stderr.take().map(|reader| {
        spawn_output_reader(
            reader,
            owner.clone(),
            VscodeProcessTaskOutputStream::Stderr,
            Arc::clone(registry),
            Arc::clone(event_sink),
            Arc::clone(&run.terminal_sink),
        )
    });
    let ownership = run.ownership.clone();
    let process_result = (run.finish)();
    let stdout_result = join_reader(stdout);
    let stderr_result = join_reader(stderr);
    match (
        ownership.was_stop_requested(),
        process_result,
        stdout_result,
        stderr_result,
    ) {
        (true, _, _, _) => StepResult::Stopped,
        (false, Ok(exit_code), Ok(()), Ok(())) => StepResult::Exited(exit_code),
        (false, Err(_), _, _) => {
            StepResult::Failed("The process task failed while waiting for completion.".to_string())
        }
        (false, _, Err(_), _) | (false, _, _, Err(_)) => {
            StepResult::Failed("The process task output stream failed.".to_string())
        }
    }
}

fn spawn_output_reader(
    mut reader: Box<dyn Read + Send>,
    owner: VscodeProcessTaskOwner,
    stream: VscodeProcessTaskOutputStream,
    registry: Arc<VscodeProcessTaskRegistry>,
    event_sink: Arc<dyn VscodeProcessTaskEventSink>,
    terminal_sink: Arc<dyn TerminalEventSink>,
) -> JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let result = (|| {
            let mut buffer = [0_u8; READER_BUFFER_BYTES];
            loop {
                let count = reader
                    .read(&mut buffer)
                    .map_err(|_| "Unable to read process task output.".to_string())?;
                if count == 0 {
                    break;
                }
                terminal_sink.emit_output(TerminalOutputEvent {
                    data: String::from_utf8_lossy(&buffer[..count]).into_owned(),
                    session_id: owner.session_id,
                });
                registry.record_output(&owner, stream, &buffer[..count], event_sink.as_ref())?;
            }
            Ok(())
        })();
        let finish = registry.finish_output(&owner, stream, event_sink.as_ref());
        result.and(finish)
    })
}

fn join_reader(reader: Option<JoinHandle<Result<(), String>>>) -> Result<(), String> {
    let Some(reader) = reader else {
        return Ok(());
    };
    reader
        .join()
        .map_err(|_| "The process task output reader stopped unexpectedly.".to_string())?
}

fn spawn_cleanup(run: PreparedProcessTask) {
    thread::spawn(move || {
        let _ = (run.finish)();
    });
}

fn bounded_failure(message: &str) -> String {
    const MAX_BYTES: usize = 4 * 1_024;
    let clean = message
        .chars()
        .map(|character| {
            if character.is_control() {
                '\u{fffd}'
            } else {
                character
            }
        })
        .collect::<String>();
    if clean.len() <= MAX_BYTES {
        return clean;
    }
    let mut end = MAX_BYTES - '…'.len_utf8();
    while !clean.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &clean[..end])
}
