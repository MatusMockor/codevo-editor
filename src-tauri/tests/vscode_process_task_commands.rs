#![allow(dead_code)]

#[path = "../src/node_package_problem_matcher.rs"]
mod node_package_problem_matcher;
#[path = "../src/terminal_task_admission.rs"]
mod terminal_task_admission;
#[path = "../src/vscode_process_task_commands.rs"]
mod vscode_process_task_commands;
#[path = "../src/vscode_process_task_events.rs"]
mod vscode_process_task_events;
#[path = "../src/vscode_process_task_registry.rs"]
mod vscode_process_task_registry;

mod workspace_registry {
    use serde::{Deserialize, Serialize};
    use std::{
        fs::File,
        io,
        path::{Path, PathBuf},
    };

    #[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
    #[serde(transparent)]
    pub struct WorkspaceId(pub String);

    impl WorkspaceId {
        pub(crate) fn as_str(&self) -> &str {
            &self.0
        }
    }

    pub(crate) fn open_file_relative_to(root: &File, relative_path: &Path) -> io::Result<File> {
        File::open(opened_root_path(root)?.join(relative_path))
    }

    pub(crate) fn opened_regular_file_path(file: &File) -> io::Result<PathBuf> {
        opened_path(file)
    }

    pub(crate) fn opened_root_path(file: &File) -> io::Result<PathBuf> {
        opened_path(file)
    }

    #[cfg(target_os = "linux")]
    fn opened_path(file: &File) -> io::Result<PathBuf> {
        std::fs::read_link(format!(
            "/proc/self/fd/{}",
            std::os::fd::AsRawFd::as_raw_fd(file)
        ))
    }

    #[cfg(target_os = "macos")]
    fn opened_path(file: &File) -> io::Result<PathBuf> {
        use std::os::{fd::AsRawFd, unix::ffi::OsStringExt};

        let mut path = vec![0_u8; libc::PATH_MAX as usize];
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, path.as_mut_ptr()) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let end = path
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "unterminated path"))?;
        Ok(PathBuf::from(std::ffi::OsString::from_vec(
            path[..end].to_vec(),
        )))
    }
}

mod terminal_task_process {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[derive(Clone, Debug)]
    pub(crate) struct TerminalTaskOwnership {
        session_id: u64,
        stop_requested: Arc<AtomicBool>,
        task_id: u64,
    }

    impl TerminalTaskOwnership {
        pub(crate) fn new(session_id: u64, task_id: u64) -> Self {
            Self {
                session_id,
                stop_requested: Arc::new(AtomicBool::new(false)),
                task_id,
            }
        }

        pub(crate) fn request_stop(&self) -> bool {
            !self.stop_requested.swap(true, Ordering::SeqCst)
        }

        pub(crate) fn was_stop_requested(&self) -> bool {
            self.stop_requested.load(Ordering::SeqCst)
        }

        pub(crate) fn session_id(&self) -> u64 {
            self.session_id
        }

        pub(crate) fn task_id(&self) -> u64 {
            self.task_id
        }
    }
}

mod terminal {
    use std::sync::Arc;

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct TerminalOutputEvent {
        pub data: String,
        pub session_id: u64,
    }

    pub trait TerminalEventSink: Send + Sync {
        fn emit_output(&self, event: TerminalOutputEvent);
    }

    impl<T: TerminalEventSink + ?Sized> TerminalEventSink for Arc<T> {
        fn emit_output(&self, event: TerminalOutputEvent) {
            (**self).emit_output(event);
        }
    }
}

use std::{
    collections::VecDeque,
    io::Cursor,
    sync::{
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use terminal::{TerminalEventSink, TerminalOutputEvent};
use terminal_task_admission::TerminalTaskAdmissionRegistry;
use terminal_task_process::TerminalTaskOwnership;
use vscode_process_task_commands::{
    PreparedProcessTask, ProcessTaskRuntimePort, VscodeProcessTaskCommandService,
};
use vscode_process_task_events::{
    VscodeProcessTaskEvent, VscodeProcessTaskEventSink, VscodeProcessTaskOwner,
    VscodeProcessTaskStatus,
};
use vscode_process_task_registry::VscodeProcessTaskRegistry;
use workspace_registry::WorkspaceId;

type Prepare = Box<
    dyn FnOnce(&VscodeProcessTaskOwner) -> Result<PreparedProcessTask, String> + Send + 'static,
>;

struct FakeRuntime(Mutex<Option<Prepare>>);

impl FakeRuntime {
    fn new(
        prepare: impl FnOnce(&VscodeProcessTaskOwner) -> Result<PreparedProcessTask, String>
            + Send
            + 'static,
    ) -> Self {
        Self(Mutex::new(Some(Box::new(prepare))))
    }
}

impl ProcessTaskRuntimePort for FakeRuntime {
    fn prepare_and_spawn(
        &self,
        owner: &VscodeProcessTaskOwner,
    ) -> Result<PreparedProcessTask, String> {
        self.0.lock().expect("prepare").take().expect("one prepare")(owner)
    }
}

type PrepareStep = Box<
    dyn FnMut(&VscodeProcessTaskOwner, &str) -> Result<PreparedProcessTask, String>
        + Send
        + 'static,
>;

struct ChainRuntime {
    chain: Vec<String>,
    prepare: Mutex<PrepareStep>,
}

impl ChainRuntime {
    fn new(
        chain: &[&str],
        prepare: impl FnMut(&VscodeProcessTaskOwner, &str) -> Result<PreparedProcessTask, String>
            + Send
            + 'static,
    ) -> Self {
        Self {
            chain: chain.iter().map(|label| (*label).to_string()).collect(),
            prepare: Mutex::new(Box::new(prepare)),
        }
    }
}

impl ProcessTaskRuntimePort for ChainRuntime {
    fn resolve_chain(&self, _owner: &VscodeProcessTaskOwner) -> Result<Vec<String>, String> {
        Ok(self.chain.clone())
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
        self.prepare.lock().expect("prepare step")(owner, label)
    }
}

#[derive(Default)]
struct EventSink(Mutex<Vec<VscodeProcessTaskEvent>>);

impl VscodeProcessTaskEventSink for EventSink {
    fn emit(&self, event: VscodeProcessTaskEvent) {
        self.0.lock().expect("events").push(event);
    }
}

#[derive(Default)]
struct RawTerminalSink(Mutex<Vec<TerminalOutputEvent>>);

impl TerminalEventSink for RawTerminalSink {
    fn emit_output(&self, event: TerminalOutputEvent) {
        self.0.lock().expect("terminal").push(event);
    }
}

#[test]
fn start_replies_before_background_completion_and_ack_flushes_ordered_events() {
    let (release, receiver) = mpsc::sync_channel(0);
    let terminal = Arc::new(RawTerminalSink::default());
    let ownership = TerminalTaskOwnership::new(7, 11);
    let runtime = FakeRuntime::new({
        let terminal = Arc::clone(&terminal);
        move |_| {
            Ok(prepared(
                ownership,
                terminal,
                Some(b"stdout".to_vec()),
                Some(b"stderr".to_vec()),
                receiver,
                Some(0),
            ))
        }
    });
    let (service, events) = service(runtime);
    let task_owner = owner("run-1", "workspace-a", 7);

    assert_eq!(service.start(task_owner.clone()).unwrap(), task_owner);
    assert!(!has_terminal_event(&events));
    service.acknowledge(task_owner.clone()).unwrap();
    release.send(()).unwrap();
    wait_until(|| has_terminal_event(&events));

    let emitted = events.0.lock().unwrap().clone();
    assert!(matches!(
        emitted.first(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Running,
            ..
        })
    ));
    assert!(matches!(
        emitted.last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(0) },
            ..
        })
    ));
    let mut terminal_output = terminal
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.data.clone())
        .collect::<Vec<_>>();
    terminal_output.sort();
    assert_eq!(terminal_output, ["stderr", "stdout"]);
}

#[test]
fn dependency_chain_keeps_one_owner_gate_and_flushes_one_terminal_status() {
    let (completed_sender, completed_receiver) = mpsc::sync_channel(0);
    let (_release, target_receiver) = closed_receiver();
    let mut runs = VecDeque::from([
        prepared_closed(71, 101, b"dependency".to_vec(), Some(0)),
        PreparedProcessTask {
            ownership: TerminalTaskOwnership::new(71, 102),
            problem_matcher: None,
            terminal_sink: Arc::new(RawTerminalSink::default()),
            stdout: Some(Box::new(Cursor::new(b"target".to_vec()))),
            stderr: None,
            finish: Box::new(move || {
                target_receiver.recv().unwrap();
                completed_sender.send(()).unwrap();
                Ok(Some(0))
            }),
        },
    ]);
    let runtime = ChainRuntime::new(&["dependency", "task"], move |_, _| {
        Ok(runs.pop_front().expect("planned step"))
    });
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let service = VscodeProcessTaskCommandService::new(registry, Arc::new(runtime), events.clone());
    let task_owner = owner("chain-fast", "workspace-a", 71);

    service.start(task_owner.clone()).unwrap();
    completed_receiver.recv().unwrap();
    assert!(events.0.lock().unwrap().is_empty());
    service.acknowledge(task_owner.clone()).unwrap();
    wait_until(|| has_terminal_event(&events));

    let emitted = events.0.lock().unwrap().clone();
    assert_eq!(
        emitted
            .iter()
            .filter(|event| matches!(
                event,
                VscodeProcessTaskEvent::Status {
                    state: VscodeProcessTaskStatus::Running,
                    ..
                }
            ))
            .count(),
        1
    );
    assert_eq!(
        emitted
            .iter()
            .filter(|event| matches!(
                event,
                VscodeProcessTaskEvent::Status {
                    state: VscodeProcessTaskStatus::Exited { .. }
                        | VscodeProcessTaskStatus::Failed { .. }
                        | VscodeProcessTaskStatus::Stopped,
                    ..
                }
            ))
            .count(),
        1
    );
    let output = emitted
        .iter()
        .filter_map(|event| match event {
            VscodeProcessTaskEvent::Output { data, .. } => Some(data.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(output, ["dependency", "target"]);
    assert_eq!(emitted.len(), 6);
    assert!(matches!(
        &emitted[0],
        VscodeProcessTaskEvent::Status {
            sequence: 1,
            state: VscodeProcessTaskStatus::Running,
            ..
        }
    ));
    assert!(matches!(
        &emitted[1],
        VscodeProcessTaskEvent::Step {
            sequence: 2,
            label,
            index: 1,
            total: 2,
            ..
        } if label == "dependency"
    ));
    assert!(matches!(
        &emitted[2],
        VscodeProcessTaskEvent::Output { sequence: 3, data, .. }
            if data == "dependency"
    ));
    assert!(matches!(
        &emitted[3],
        VscodeProcessTaskEvent::Step {
            sequence: 4,
            label,
            index: 2,
            total: 2,
            ..
        } if label == "task"
    ));
    assert!(matches!(
        &emitted[4],
        VscodeProcessTaskEvent::Output { sequence: 5, data, .. } if data == "target"
    ));
    assert!(matches!(
        &emitted[5],
        VscodeProcessTaskEvent::Status {
            sequence: 6,
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(0) },
            ..
        }
    ));
    assert!(emitted.iter().all(|event| match event {
        VscodeProcessTaskEvent::Status { owner, .. }
        | VscodeProcessTaskEvent::Output { owner, .. }
        | VscodeProcessTaskEvent::Step { owner, .. }
        | VscodeProcessTaskEvent::Problems { owner, .. } => owner == &task_owner,
    }));
}

#[test]
fn dependency_steps_share_one_output_budget_and_one_truncation_marker() {
    let mut runs = VecDeque::from([
        prepared_closed(76, 150, vec![b'a'; 1024 * 1024], Some(0)),
        prepared_closed(76, 151, b"must-be-truncated".to_vec(), Some(0)),
    ]);
    let runtime = ChainRuntime::new(&["dependency", "task"], move |_, _| {
        Ok(runs.pop_front().expect("planned step"))
    });
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let service = VscodeProcessTaskCommandService::new(registry, Arc::new(runtime), events.clone());
    let task_owner = owner("chain-output-cap", "workspace-a", 76);

    service.start(task_owner.clone()).unwrap();
    service.acknowledge(task_owner).unwrap();
    wait_until(|| has_terminal_event(&events));

    let emitted = events.0.lock().unwrap();
    let output_bytes = emitted
        .iter()
        .filter_map(|event| match event {
            VscodeProcessTaskEvent::Output {
                data,
                truncated: false,
                ..
            } => Some(data.len()),
            _ => None,
        })
        .sum::<usize>();
    let markers = emitted
        .iter()
        .filter(|event| {
            matches!(
                event,
                VscodeProcessTaskEvent::Output {
                    data,
                    truncated: true,
                    ..
                } if data.is_empty()
            )
        })
        .count();
    assert_eq!(output_bytes, 1024 * 1024);
    assert_eq!(markers, 1);
    assert!(!serde_json::to_string(&*emitted)
        .unwrap()
        .contains("must-be-truncated"));
}

#[test]
fn first_nonzero_dependency_prevents_all_later_spawns() {
    let prepared_labels = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&prepared_labels);
    let runtime = ChainRuntime::new(&["dependency", "task"], move |_, label| {
        observed.lock().unwrap().push(label.to_string());
        Ok(prepared_closed(72, 110, Vec::new(), Some(2)))
    });
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let service = VscodeProcessTaskCommandService::new(registry, Arc::new(runtime), events.clone());
    let task_owner = owner("chain-nonzero", "workspace-a", 72);

    service.start(task_owner.clone()).unwrap();
    service.acknowledge(task_owner).unwrap();
    wait_until(|| has_terminal_event(&events));

    assert_eq!(*prepared_labels.lock().unwrap(), ["dependency"]);
    assert!(matches!(
        events.0.lock().unwrap().last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(2) },
            ..
        })
    ));
}

#[test]
fn malformed_runtime_chain_is_rejected_before_prepare_and_releases_admission() {
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let invalid = VscodeProcessTaskCommandService::new(
        Arc::clone(&registry),
        Arc::new(ChainRuntime::new(&["task", "task"], |_, _| {
            panic!("invalid chain must never prepare")
        })),
        events.clone(),
    );
    assert_eq!(
        invalid
            .start(owner("invalid-chain", "workspace-a", 74))
            .unwrap_err(),
        "Unable to resolve the process task chain safely."
    );
    let whitespace = VscodeProcessTaskCommandService::new(
        Arc::clone(&registry),
        Arc::new(ChainRuntime::new(&[" ", "task"], |_, _| {
            panic!("blank chain label must never prepare")
        })),
        events.clone(),
    );
    assert_eq!(
        whitespace
            .start(owner("blank-chain", "workspace-a", 74))
            .unwrap_err(),
        "Unable to resolve the process task chain safely."
    );

    let replacement = VscodeProcessTaskCommandService::new(
        registry,
        Arc::new(FakeRuntime::new(|_| {
            Ok(prepared_closed(74, 130, Vec::new(), Some(0)))
        })),
        events,
    );
    assert!(replacement
        .start(owner("after-invalid", "workspace-a", 74))
        .is_ok());
}

#[test]
fn later_prepare_failure_is_generic_stops_chain_and_releases_admission() {
    let mut step = 0;
    let runtime = ChainRuntime::new(&["dependency", "task"], move |_, _| {
        step += 1;
        if step == 1 {
            Ok(prepared_closed(75, 140, Vec::new(), Some(0)))
        } else {
            Err("SECRET_CHANGED_CONFIG\nraw runtime detail".to_string())
        }
    });
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let service = VscodeProcessTaskCommandService::new(
        Arc::clone(&registry),
        Arc::new(runtime),
        events.clone(),
    );
    let task_owner = owner("later-failure", "workspace-a", 75);
    service.start(task_owner.clone()).unwrap();
    service.acknowledge(task_owner).unwrap();
    wait_until(|| has_terminal_event(&events));
    let serialized = serde_json::to_string(&*events.0.lock().unwrap()).unwrap();
    assert!(!serialized.contains("SECRET_CHANGED_CONFIG"));
    assert!(serialized.contains("Unable to continue the process task chain safely."));
    assert_eq!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, VscodeProcessTaskEvent::Step { .. }))
            .count(),
        1,
        "a step that failed before spawn must not be announced"
    );

    let replacement = VscodeProcessTaskCommandService::new(
        registry,
        Arc::new(FakeRuntime::new(|_| {
            Ok(prepared_closed(75, 141, Vec::new(), Some(0)))
        })),
        events,
    );
    assert!(replacement
        .start(owner("after-later-failure", "workspace-a", 75))
        .is_ok());
}

#[test]
fn stop_during_inter_step_prepare_latches_and_kills_the_racing_child() {
    let (entered_sender, entered_receiver) = mpsc::sync_channel(0);
    let (release_sender, release_receiver) = mpsc::sync_channel(0);
    let replacement = TerminalTaskOwnership::new(73, 121);
    let replacement_probe = replacement.clone();
    let mut index = 0;
    let runtime = ChainRuntime::new(&["dependency", "task"], move |_, _| {
        index += 1;
        if index == 1 {
            return Ok(prepared_closed(73, 120, Vec::new(), Some(0)));
        }
        entered_sender.send(()).unwrap();
        release_receiver.recv().unwrap();
        let (_release, receiver) = closed_receiver();
        Ok(prepared(
            replacement.clone(),
            Arc::new(RawTerminalSink::default()),
            None,
            None,
            receiver,
            Some(0),
        ))
    });
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let service = Arc::new(VscodeProcessTaskCommandService::new(
        registry,
        Arc::new(runtime),
        events.clone(),
    ));
    let task_owner = owner("chain-stop-gap", "workspace-a", 73);

    service.start(task_owner.clone()).unwrap();
    entered_receiver.recv().unwrap();
    service.stop(task_owner.clone()).unwrap();
    release_sender.send(()).unwrap();
    service.acknowledge(task_owner).unwrap();
    wait_until(|| has_terminal_event(&events));

    assert!(replacement_probe.was_stop_requested());
    assert_eq!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, VscodeProcessTaskEvent::Step { .. }))
            .count(),
        1
    );
    assert!(matches!(
        events.0.lock().unwrap().last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Stopped,
            ..
        })
    ));
}

#[test]
fn stop_and_ack_require_the_exact_full_owner_and_stop_is_deduplicated() {
    let (release, receiver) = mpsc::sync_channel(0);
    let ownership = TerminalTaskOwnership::new(8, 12);
    let stop_probe = ownership.clone();
    let runtime = FakeRuntime::new(move |_| {
        Ok(prepared(
            ownership,
            Arc::new(RawTerminalSink::default()),
            None,
            None,
            receiver,
            Some(0),
        ))
    });
    let (service, events) = service(runtime);
    let task_owner = owner("run-exact", "workspace-a", 8);
    service.start(task_owner.clone()).unwrap();
    let wrong = VscodeProcessTaskOwner {
        label: "other".to_string(),
        ..task_owner.clone()
    };
    assert!(service.acknowledge(wrong.clone()).is_err());
    assert!(service.stop(wrong).is_err());
    service.stop(task_owner.clone()).unwrap();
    service.stop(task_owner.clone()).unwrap();
    assert!(stop_probe.was_stop_requested());
    service.acknowledge(task_owner).unwrap();
    release.send(()).unwrap();
    wait_until(|| has_terminal_event(&events));
    assert!(matches!(
        events.0.lock().unwrap().last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Stopped,
            ..
        })
    ));
}

#[test]
fn prestart_stop_race_is_carried_through_activation() {
    let (entered_sender, entered_receiver) = mpsc::sync_channel(0);
    let (prepare_release, prepare_receiver) = mpsc::sync_channel(0);
    let ownership = TerminalTaskOwnership::new(9, 13);
    let stop_probe = ownership.clone();
    let runtime = FakeRuntime::new(move |_| {
        entered_sender.send(()).unwrap();
        prepare_receiver.recv().unwrap();
        let (_release, finish_receiver) = closed_receiver();
        Ok(prepared(
            ownership,
            Arc::new(RawTerminalSink::default()),
            None,
            None,
            finish_receiver,
            Some(0),
        ))
    });
    let (service, events) = service(runtime);
    let service = Arc::new(service);
    let task_owner = owner("run-race", "workspace-a", 9);
    let worker = {
        let service = Arc::clone(&service);
        let owner = task_owner.clone();
        thread::spawn(move || service.start(owner))
    };
    entered_receiver.recv().unwrap();
    service.stop(task_owner.clone()).unwrap();
    prepare_release.send(()).unwrap();
    assert_eq!(worker.join().unwrap().unwrap(), task_owner);
    assert!(stop_probe.was_stop_requested());
    service.acknowledge(task_owner).unwrap();
    wait_until(|| has_terminal_event(&events));
    assert_eq!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, VscodeProcessTaskEvent::Step { .. }))
            .count(),
        1,
        "a child that passed activation has one step marker even when prestart stop won"
    );
}

#[test]
fn concurrent_starts_in_one_terminal_admit_only_the_first_owner() {
    let (prepare_entered_sender, prepare_entered_receiver) = mpsc::sync_channel(0);
    let (prepare_release_sender, prepare_release_receiver) = mpsc::sync_channel(0);
    let runtime = FakeRuntime::new(move |_| {
        prepare_entered_sender.send(()).unwrap();
        prepare_release_receiver.recv().unwrap();
        let (_release, finish_receiver) = closed_receiver();
        Ok(prepared(
            TerminalTaskOwnership::new(92, 14),
            Arc::new(RawTerminalSink::default()),
            None,
            None,
            finish_receiver,
            Some(0),
        ))
    });
    let (service, _) = service(runtime);
    let service = Arc::new(service);
    let first_owner = owner("concurrent-first", "workspace-a", 92);
    let first = {
        let service = Arc::clone(&service);
        let owner = first_owner.clone();
        thread::spawn(move || service.start(owner))
    };
    prepare_entered_receiver.recv().unwrap();

    let error = service
        .start(owner("concurrent-second", "workspace-a", 92))
        .unwrap_err();

    assert_eq!(
        error,
        "A typed task is already starting or running in this terminal session."
    );
    prepare_release_sender.send(()).unwrap();
    assert_eq!(first.join().unwrap().unwrap(), first_owner);
}

#[test]
fn stop_before_start_records_an_exact_tombstone_and_never_calls_runtime() {
    let (service, _) = service(FakeRuntime::new(|_| panic!("runtime must not run")));
    let task_owner = owner("prestart", "workspace-a", 91);
    service.stop(task_owner.clone()).unwrap();
    let error = service.start(task_owner).unwrap_err();
    assert_eq!(error, "The process task was cancelled before it started.");
}

#[test]
fn start_failure_releases_shared_admission_and_never_leaks_runtime_details() {
    let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::clone(
        &admission,
    )));
    let events = Arc::new(EventSink::default());
    let failed = VscodeProcessTaskCommandService::new(
        Arc::clone(&registry),
        Arc::new(FakeRuntime::new(|_| {
            Err("SECRET_COMMAND\ninternal".to_string())
        })),
        events.clone(),
    );
    let first = owner("failed", "workspace-a", 10);
    assert_eq!(
        failed.start(first).unwrap_err(),
        "Unable to start the process task safely."
    );

    let (_release, receiver) = closed_receiver();
    let succeeding = VscodeProcessTaskCommandService::new(
        registry,
        Arc::new(FakeRuntime::new(move |_| {
            Ok(prepared(
                TerminalTaskOwnership::new(10, 14),
                Arc::new(RawTerminalSink::default()),
                None,
                None,
                receiver,
                Some(0),
            ))
        })),
        events,
    );
    assert!(succeeding
        .start(owner("replacement", "workspace-a", 10))
        .is_ok());
}

#[test]
fn workspace_and_global_lifecycle_stops_target_only_live_exact_ownerships() {
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    let (release_a, receiver_a) = mpsc::sync_channel(0);
    let ownership_a = TerminalTaskOwnership::new(11, 15);
    let probe_a = ownership_a.clone();
    let service_a = VscodeProcessTaskCommandService::new(
        Arc::clone(&registry),
        Arc::new(FakeRuntime::new(move |_| {
            Ok(prepared(
                ownership_a,
                Arc::new(RawTerminalSink::default()),
                None,
                None,
                receiver_a,
                Some(0),
            ))
        })),
        events.clone(),
    );
    let owner_a = owner("a", "workspace-a", 11);
    service_a.start(owner_a.clone()).unwrap();

    let (release_b, receiver_b) = mpsc::sync_channel(0);
    let ownership_b = TerminalTaskOwnership::new(12, 16);
    let probe_b = ownership_b.clone();
    let service_b = VscodeProcessTaskCommandService::new(
        registry,
        Arc::new(FakeRuntime::new(move |_| {
            Ok(prepared(
                ownership_b,
                Arc::new(RawTerminalSink::default()),
                None,
                None,
                receiver_b,
                Some(0),
            ))
        })),
        events,
    );
    service_b.start(owner("b", "workspace-b", 12)).unwrap();

    service_a.request_stop_workspace(&owner_a.workspace_id);
    assert!(probe_a.was_stop_requested());
    assert!(!probe_b.was_stop_requested());
    service_a.request_stop_all();
    assert!(probe_b.was_stop_requested());
    release_a.send(()).unwrap();
    release_b.send(()).unwrap();
}

#[test]
fn owner_requests_and_start_response_have_the_exact_flat_serde_shape() {
    let value = serde_json::to_value(owner("wire", "workspace-a", 13)).unwrap();
    assert_eq!(
        value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        [
            "configRevision",
            "label",
            "runId",
            "sessionId",
            "workspaceId"
        ]
    );
    let mut unknown = value;
    unknown["command"] = serde_json::json!("secret");
    assert!(
        serde_json::from_value::<vscode_process_task_commands::StartVscodeProcessTaskRequest>(
            unknown
        )
        .is_err()
    );
}

fn service(runtime: FakeRuntime) -> (VscodeProcessTaskCommandService, Arc<EventSink>) {
    let registry = Arc::new(VscodeProcessTaskRegistry::with_admission(Arc::new(
        TerminalTaskAdmissionRegistry::new(),
    )));
    let events = Arc::new(EventSink::default());
    (
        VscodeProcessTaskCommandService::new(registry, Arc::new(runtime), events.clone()),
        events,
    )
}

fn prepared(
    ownership: TerminalTaskOwnership,
    terminal_sink: Arc<dyn TerminalEventSink>,
    stdout: Option<Vec<u8>>,
    stderr: Option<Vec<u8>>,
    finish_receiver: Receiver<()>,
    exit_code: Option<i32>,
) -> PreparedProcessTask {
    PreparedProcessTask {
        ownership,
        problem_matcher: None,
        terminal_sink,
        stdout: stdout.map(|bytes| Box::new(Cursor::new(bytes)) as Box<_>),
        stderr: stderr.map(|bytes| Box::new(Cursor::new(bytes)) as Box<_>),
        finish: Box::new(move || {
            let _ = finish_receiver.recv();
            Ok(exit_code)
        }),
    }
}

fn prepared_closed(
    session_id: u64,
    task_id: u64,
    stdout: Vec<u8>,
    exit_code: Option<i32>,
) -> PreparedProcessTask {
    let (_release, receiver) = closed_receiver();
    prepared(
        TerminalTaskOwnership::new(session_id, task_id),
        Arc::new(RawTerminalSink::default()),
        Some(stdout),
        None,
        receiver,
        exit_code,
    )
}

fn closed_receiver() -> (mpsc::SyncSender<()>, Receiver<()>) {
    let (sender, receiver) = mpsc::sync_channel(1);
    sender.send(()).unwrap();
    (sender, receiver)
}

fn owner(run_id: &str, workspace_id: &str, session_id: u64) -> VscodeProcessTaskOwner {
    VscodeProcessTaskOwner {
        run_id: run_id.to_string(),
        workspace_id: WorkspaceId(workspace_id.to_string()),
        session_id,
        label: "task".to_string(),
        config_revision: format!("sha256:{}", "a".repeat(64)),
    }
}

fn has_terminal_event(events: &EventSink) -> bool {
    events.0.lock().unwrap().iter().any(|event| {
        matches!(
            event,
            VscodeProcessTaskEvent::Status {
                state: VscodeProcessTaskStatus::Exited { .. }
                    | VscodeProcessTaskStatus::Failed { .. }
                    | VscodeProcessTaskStatus::Stopped,
                ..
            }
        )
    })
}

fn wait_until(predicate: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !predicate() {
        assert!(Instant::now() < deadline, "timed out");
        thread::sleep(Duration::from_millis(5));
    }
}
