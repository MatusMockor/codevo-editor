#![allow(dead_code)]

#[path = "../src/node_package_problem_matcher.rs"]
mod node_package_problem_matcher;
#[path = "../src/terminal_task_admission.rs"]
mod terminal_task_admission;
#[path = "../src/terminal_task_process.rs"]
mod terminal_task_process;
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
    pub struct WorkspaceId(String);

    impl WorkspaceId {
        pub(crate) fn as_str(&self) -> &str {
            &self.0
        }
    }

    impl TryFrom<String> for WorkspaceId {
        type Error = String;

        fn try_from(value: String) -> Result<Self, Self::Error> {
            if value.is_empty() {
                Err("empty workspace".to_string())
            } else {
                Ok(Self(value))
            }
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

use std::{
    fs::{self, File},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use node_package_problem_matcher::{NodePackageProblemMatcher, NodePackageProblemMatcherKind};
use terminal_task_admission::TerminalTaskAdmissionRegistry;
use terminal_task_process::TerminalTaskOwnership;
use vscode_process_task_events::{
    VscodeProcessTaskEvent, VscodeProcessTaskEventSink, VscodeProcessTaskOutputStream,
    VscodeProcessTaskOwner, VscodeProcessTaskProblemsState, VscodeProcessTaskStatus,
};
use vscode_process_task_registry::{
    VscodeProcessTaskCompletion, VscodeProcessTaskRegistry, VscodeProcessTaskStep,
    VscodeProcessTaskStepActivation, VscodeProcessTaskStopAction,
};
use workspace_registry::WorkspaceId;

#[derive(Default)]
struct Sink(Mutex<Vec<VscodeProcessTaskEvent>>);

impl VscodeProcessTaskEventSink for Sink {
    fn emit(&self, event: VscodeProcessTaskEvent) {
        self.0.lock().expect("events").push(event);
    }
}

impl Sink {
    fn events(&self) -> Vec<VscodeProcessTaskEvent> {
        self.0.lock().expect("events").clone()
    }
}

struct MatcherFixture {
    root: PathBuf,
}

impl MatcherFixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let root = std::env::temp_dir().join(format!(
            "codevo-vscode-process-problems-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("src")).expect("create matcher fixture");
        fs::write(root.join("src/app.ts"), "const value = 1;\n").expect("write source");
        fs::write(root.join("src/other.ts"), "const other = 1;\n").expect("write source");
        let root = fs::canonicalize(root).expect("canonical matcher fixture");
        Self { root }
    }

    fn matcher(&self) -> NodePackageProblemMatcher {
        let workspace = File::open(&self.root).expect("open workspace");
        let working_directory = File::open(&self.root).expect("open working directory");
        NodePackageProblemMatcher::new(
            NodePackageProblemMatcherKind::TypeScript,
            &workspace,
            &self.root,
            &working_directory,
            &self.root,
        )
        .expect("create matcher")
    }
}

impl Drop for MatcherFixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).expect("remove matcher fixture");
    }
}

#[test]
fn matcher_events_are_ordered_and_reject_a_foreign_exact_owner() {
    let fixture = MatcherFixture::new();
    let registry = registry();
    let sink = Sink::default();
    let current_owner = owner("matcher-run", "workspace-a", 14);
    registry.reserve(current_owner.clone()).expect("reserve");
    registry
        .activate_step(
            &current_owner,
            ownership(14, 41),
            Some(fixture.matcher()),
            VscodeProcessTaskStep {
                label: "typecheck",
                index: 1,
                total: 1,
            },
        )
        .expect("activate");

    let mut foreign_owner = current_owner.clone();
    foreign_owner.config_revision = format!("sha256:{}", "b".repeat(64));
    assert!(registry
        .record_output(
            &foreign_owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"src/app.ts(1,7): error TS2322: Wrong type\n",
            &sink,
        )
        .is_err());
    registry
        .record_output(
            &current_owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"src/app.ts(1,7): error TS2322: Wrong type\n",
            &sink,
        )
        .expect("record matcher output");
    registry
        .finish_output(&current_owner, VscodeProcessTaskOutputStream::Stdout, &sink)
        .expect("finish output");
    registry
        .complete(
            &current_owner,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(2) },
            &sink,
        )
        .expect("complete");
    registry
        .acknowledge_start(&current_owner, &sink)
        .expect("acknowledge");

    let events = sink.events();
    assert_eq!(events.len(), 7);
    assert!(matches!(
        &events[0],
        VscodeProcessTaskEvent::Status {
            sequence: 1,
            state: VscodeProcessTaskStatus::Running,
            ..
        }
    ));
    assert!(matches!(
        &events[1],
        VscodeProcessTaskEvent::Problems {
            sequence: 2,
            state: VscodeProcessTaskProblemsState::Reset,
            ..
        }
    ));
    assert!(matches!(
        &events[2],
        VscodeProcessTaskEvent::Step { sequence: 3, .. }
    ));
    assert!(matches!(
        &events[3],
        VscodeProcessTaskEvent::Output { sequence: 4, .. }
    ));
    assert!(matches!(
        &events[4],
        VscodeProcessTaskEvent::Problems {
            sequence: 5,
            state: VscodeProcessTaskProblemsState::Append { total: 1, .. },
            ..
        }
    ));
    assert!(matches!(
        &events[5],
        VscodeProcessTaskEvent::Problems {
            sequence: 6,
            state: VscodeProcessTaskProblemsState::Complete { total: 1, .. },
            ..
        }
    ));
    assert!(matches!(
        &events[6],
        VscodeProcessTaskEvent::Status {
            sequence: 7,
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(2) },
            ..
        }
    ));
    assert!(events.iter().all(|event| match event {
        VscodeProcessTaskEvent::Output { owner, .. }
        | VscodeProcessTaskEvent::Status { owner, .. }
        | VscodeProcessTaskEvent::Step { owner, .. }
        | VscodeProcessTaskEvent::Problems { owner, .. } => owner == &current_owner,
    }));
}

#[test]
fn failed_and_stopped_matcher_runs_clear_problems_before_terminal_status() {
    for (index, completion, stop) in [
        (
            0,
            VscodeProcessTaskCompletion::Failed {
                message: "failed".to_string(),
            },
            false,
        ),
        (
            1,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(0) },
            true,
        ),
    ] {
        let fixture = MatcherFixture::new();
        let registry = registry();
        let sink = Sink::default();
        let current_owner = owner(
            &format!("interrupted-matcher-run-{index}"),
            "workspace-a",
            15 + index,
        );
        registry.reserve(current_owner.clone()).expect("reserve");
        registry
            .activate_step(
                &current_owner,
                ownership(15 + index, 42 + index),
                Some(fixture.matcher()),
                VscodeProcessTaskStep {
                    label: "typecheck",
                    index: 1,
                    total: 1,
                },
            )
            .expect("activate");
        registry
            .record_output(
                &current_owner,
                VscodeProcessTaskOutputStream::Stdout,
                b"src/app.ts(1,7): error TS2322: Wrong type\n",
                &sink,
            )
            .expect("record matcher output");
        if stop {
            assert!(matches!(
                registry.request_stop(&current_owner).expect("request stop"),
                VscodeProcessTaskStopAction::Terminate(_)
            ));
        }
        registry
            .complete(&current_owner, completion, &sink)
            .expect("complete");
        registry
            .acknowledge_start(&current_owner, &sink)
            .expect("acknowledge");

        let events = sink.events();
        let clear = events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    VscodeProcessTaskEvent::Problems {
                        state: VscodeProcessTaskProblemsState::Clear,
                        ..
                    }
                )
            })
            .expect("clear problems");
        assert!(matches!(
            &events[clear - 1],
            VscodeProcessTaskEvent::Problems {
                state: VscodeProcessTaskProblemsState::Append { total: 1, .. },
                ..
            }
        ));
        if stop {
            assert!(matches!(
                &events[clear + 1],
                VscodeProcessTaskEvent::Status {
                    state: VscodeProcessTaskStatus::Stopped,
                    ..
                }
            ));
        } else {
            assert!(matches!(
                &events[clear + 1],
                VscodeProcessTaskEvent::Status {
                    state: VscodeProcessTaskStatus::Failed { .. },
                    ..
                }
            ));
        }
        assert!(!events.iter().any(|event| {
            matches!(
                event,
                VscodeProcessTaskEvent::Problems {
                    state: VscodeProcessTaskProblemsState::Complete { .. },
                    ..
                }
            )
        }));
    }
}

#[test]
fn matcher_problems_persist_across_a_later_step_without_a_matcher() {
    let fixture = MatcherFixture::new();
    let registry = registry();
    let sink = Sink::default();
    let current_owner = owner("matcher-then-no-matcher", "workspace-a", 17);
    let first = ownership(17, 44);
    registry.reserve(current_owner.clone()).expect("reserve");
    registry
        .activate_step(
            &current_owner,
            first.clone(),
            Some(fixture.matcher()),
            VscodeProcessTaskStep {
                label: "typecheck",
                index: 1,
                total: 2,
            },
        )
        .expect("activate");
    registry
        .acknowledge_start(&current_owner, &sink)
        .expect("acknowledge");
    registry
        .record_output(
            &current_owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"src/app.ts(1,7): error TS2322: Wrong type\n",
            &sink,
        )
        .expect("record matcher output");
    registry
        .replace_ownership_step(
            &current_owner,
            &first,
            ownership(17, 45),
            None,
            VscodeProcessTaskStep {
                label: "build",
                index: 2,
                total: 2,
            },
            &sink,
        )
        .expect("activate step without matcher");
    registry
        .complete(
            &current_owner,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        )
        .expect("complete");

    let events = sink.events();
    assert_eq!(
        events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    VscodeProcessTaskEvent::Problems {
                        state: VscodeProcessTaskProblemsState::Reset,
                        ..
                    }
                )
            })
            .count(),
        1
    );
    let complete = events
        .iter()
        .find_map(|event| match event {
            VscodeProcessTaskEvent::Problems {
                state:
                    VscodeProcessTaskProblemsState::Complete {
                        problems,
                        total,
                        truncated,
                    },
                ..
            } => Some((problems, total, truncated)),
            _ => None,
        })
        .expect("complete problems");
    assert_eq!(complete.0.len(), 1);
    assert_eq!(*complete.1, 1);
    assert!(!complete.2);
}

#[test]
fn first_supported_matcher_on_a_later_step_emits_the_runs_only_reset() {
    let fixture = MatcherFixture::new();
    let registry = registry();
    let sink = Sink::default();
    let current_owner = owner("later-matcher", "workspace-a", 18);
    let first = ownership(18, 46);
    let second = ownership(18, 47);
    registry.reserve(current_owner.clone()).expect("reserve");
    registry
        .activate_step(
            &current_owner,
            first.clone(),
            None,
            VscodeProcessTaskStep {
                label: "prepare",
                index: 1,
                total: 3,
            },
        )
        .expect("activate");
    registry
        .acknowledge_start(&current_owner, &sink)
        .expect("acknowledge");
    registry
        .replace_ownership_step(
            &current_owner,
            &first,
            second.clone(),
            None,
            VscodeProcessTaskStep {
                label: "compile",
                index: 2,
                total: 3,
            },
            &sink,
        )
        .expect("activate second step");
    assert!(!sink
        .events()
        .iter()
        .any(|event| matches!(event, VscodeProcessTaskEvent::Problems { .. })));
    registry
        .replace_ownership_step(
            &current_owner,
            &second,
            ownership(18, 48),
            Some(fixture.matcher()),
            VscodeProcessTaskStep {
                label: "typecheck",
                index: 3,
                total: 3,
            },
            &sink,
        )
        .expect("activate matcher step");

    let events = sink.events();
    let reset = events
        .iter()
        .position(|event| {
            matches!(
                event,
                VscodeProcessTaskEvent::Problems {
                    state: VscodeProcessTaskProblemsState::Reset,
                    ..
                }
            )
        })
        .expect("reset problems");
    assert!(matches!(
        &events[reset + 1],
        VscodeProcessTaskEvent::Step {
            label,
            index: 3,
            total: 3,
            ..
        } if label == "typecheck"
    ));
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, VscodeProcessTaskEvent::Problems { .. }))
            .count(),
        1
    );
}

#[test]
fn complete_snapshot_keeps_matcher_retained_problems_beyond_one_append_batch() {
    let fixture = MatcherFixture::new();
    let registry = registry();
    let sink = Sink::default();
    let current_owner = owner("batched-matcher-run", "workspace-a", 16);
    registry.reserve(current_owner.clone()).expect("reserve");
    registry
        .activate_step(
            &current_owner,
            ownership(16, 43),
            Some(fixture.matcher()),
            VscodeProcessTaskStep {
                label: "typecheck",
                index: 1,
                total: 1,
            },
        )
        .expect("activate");
    let output = (0..120)
        .map(|index| {
            let path = if index % 2 == 0 {
                "src/app.ts"
            } else {
                "src/other.ts"
            };
            format!("{path}(1,1): error TS2322: Wrong type {index}\n")
        })
        .collect::<String>();
    assert!(output.len() < 8 * 1_024);
    registry
        .record_output(
            &current_owner,
            VscodeProcessTaskOutputStream::Stdout,
            output.as_bytes(),
            &sink,
        )
        .expect("record matcher output");
    registry
        .finish_output(&current_owner, VscodeProcessTaskOutputStream::Stdout, &sink)
        .expect("finish output");
    registry
        .complete(
            &current_owner,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(2) },
            &sink,
        )
        .expect("complete");
    registry
        .acknowledge_start(&current_owner, &sink)
        .expect("acknowledge");

    let events = sink.events();
    let append = events
        .iter()
        .find_map(|event| match event {
            VscodeProcessTaskEvent::Problems {
                state: VscodeProcessTaskProblemsState::Append { problems, .. },
                ..
            } => Some(problems),
            _ => None,
        })
        .expect("append event");
    assert_eq!(append.len(), 32);
    let complete = events
        .iter()
        .find_map(|event| match event {
            VscodeProcessTaskEvent::Problems {
                state:
                    VscodeProcessTaskProblemsState::Complete {
                        problems,
                        total,
                        truncated,
                    },
                ..
            } => Some((problems, total, truncated)),
            _ => None,
        })
        .expect("complete event");
    assert_eq!(complete.0.len(), 120);
    assert_eq!(*complete.1, 120);
    assert!(!complete.2);
}

#[test]
fn acknowledge_flushes_running_then_output_then_completion_even_if_completed_first() {
    let registry = registry();
    let sink = Sink::default();
    let current_owner = owner("run-1", "workspace-a", 7);
    registry.reserve(current_owner.clone()).expect("reserve");
    assert!(registry.acknowledge_start(&current_owner, &sink).is_err());
    registry
        .activate(&current_owner, ownership(7, 11))
        .expect("activate");
    registry
        .record_output(
            &current_owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"hello",
            &sink,
        )
        .expect("output");
    registry
        .complete(
            &current_owner,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        )
        .expect("complete");
    registry
        .reserve(owner("same-session-after-complete", "workspace-a", 7))
        .expect("completion releases shared admission");
    assert!(sink.events().is_empty());

    registry
        .acknowledge_start(&current_owner, &sink)
        .expect("acknowledge");
    let events = sink.events();
    assert_eq!(events.len(), 3);
    assert!(matches!(
        &events[0],
        VscodeProcessTaskEvent::Status {
            sequence: 1,
            state: VscodeProcessTaskStatus::Running,
            ..
        }
    ));
    assert!(matches!(
        &events[1],
        VscodeProcessTaskEvent::Output {
            sequence: 2,
            data,
            truncated: false,
            ..
        } if data == "hello"
    ));
    assert!(matches!(
        &events[2],
        VscodeProcessTaskEvent::Status {
            sequence: 3,
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(0) },
            ..
        }
    ));
}

#[test]
fn tagged_output_byte_cap_emits_one_marker_before_the_event_cap() {
    let registry = registry();
    let sink = Sink::default();
    let owner = owner("run-byte-cap", "workspace-a", 81);
    registry.reserve(owner.clone()).unwrap();
    registry.activate(&owner, ownership(81, 120)).unwrap();
    registry.acknowledge_start(&owner, &sink).unwrap();
    registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stdout,
            &vec![b'x'; 1024 * 1024 + 1],
            &sink,
        )
        .unwrap();

    let output = sink
        .events()
        .into_iter()
        .filter_map(|event| match event {
            VscodeProcessTaskEvent::Output {
                data, truncated, ..
            } => Some((data, truncated)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(output.len(), 129);
    assert_eq!(
        output
            .iter()
            .filter(|(data, truncated)| data.is_empty() && *truncated)
            .count(),
        1
    );
    assert_eq!(
        output
            .iter()
            .filter(|(_, truncated)| !truncated)
            .map(|(data, _)| data.len())
            .sum::<usize>(),
        1024 * 1024
    );
}

#[test]
fn incremental_utf8_is_lossless_chunked_and_emits_one_empty_truncation_marker() {
    let registry = registry();
    let sink = Sink::default();
    let owner = owner("run-output", "workspace-a", 8);
    registry.reserve(owner.clone()).unwrap();
    registry.activate(&owner, ownership(8, 12)).unwrap();
    registry.acknowledge_start(&owner, &sink).unwrap();
    registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stdout,
            &[0xc5],
            &sink,
        )
        .unwrap();
    registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stdout,
            &[0xbe],
            &sink,
        )
        .unwrap();
    registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stderr,
            &vec![b'x'; 9_000],
            &sink,
        )
        .unwrap();
    for _ in 0..1_023 {
        registry
            .record_output(&owner, VscodeProcessTaskOutputStream::Stdout, b"y", &sink)
            .unwrap();
    }
    registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"ignored",
            &sink,
        )
        .unwrap();

    let output = sink
        .events()
        .into_iter()
        .filter_map(|event| match event {
            VscodeProcessTaskEvent::Output {
                data, truncated, ..
            } => Some((data, truncated)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(output[0], ("ž".to_string(), false));
    assert!(output.iter().all(|(data, _)| data.len() <= 8 * 1_024));
    let markers = output
        .iter()
        .filter(|(data, truncated)| data.is_empty() && *truncated)
        .count();
    assert_eq!(markers, 1);
    assert_eq!(output.last(), Some(&(String::new(), true)));
}

#[test]
fn wrong_or_duplicate_owner_is_rejected_and_stop_returns_exact_ownership_once() {
    let registry = registry();
    let sink = Sink::default();
    let owner = owner("run-exact", "workspace-a", 9);
    let wrong = VscodeProcessTaskOwner {
        label: "other".to_string(),
        ..owner.clone()
    };
    registry.reserve(owner.clone()).unwrap();
    assert!(registry.reserve(owner.clone()).is_err());
    assert!(registry.activate(&wrong, ownership(9, 20)).is_err());
    assert!(registry.activate(&owner, ownership(10, 20)).is_err());
    registry.activate(&owner, ownership(9, 21)).unwrap();
    assert!(registry.request_stop(&wrong).is_err());
    match registry.request_stop(&owner).unwrap() {
        VscodeProcessTaskStopAction::Terminate(ownership) => {
            assert_eq!(ownership.session_id(), 9);
            assert_eq!(ownership.task_id(), 21);
        }
        action => panic!("unexpected action: {action:?}"),
    }
    assert!(matches!(
        registry.request_stop(&owner).unwrap(),
        VscodeProcessTaskStopAction::AlreadyRequested
    ));
    registry
        .complete(
            &owner,
            VscodeProcessTaskCompletion::Exited { exit_code: Some(0) },
            &sink,
        )
        .unwrap();
    registry.acknowledge_start(&owner, &sink).unwrap();
    assert!(matches!(
        sink.events().last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Stopped,
            ..
        })
    ));
    assert!(registry
        .record_output(
            &owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"late",
            &sink
        )
        .is_err());
}

#[test]
fn ownership_replacement_preserves_permanent_stop_latch_and_exact_identity() {
    let registry = registry();
    let owner = owner("chain", "workspace-a", 90);
    let first = ownership(90, 201);
    let wrong = ownership(90, 202);
    let replacement = ownership(90, 203);
    registry.reserve(owner.clone()).unwrap();
    registry.activate(&owner, first.clone()).unwrap();

    assert!(registry
        .replace_ownership(&owner, &wrong, replacement.clone())
        .is_err());
    assert!(matches!(
        registry.request_stop(&owner).unwrap(),
        VscodeProcessTaskStopAction::Terminate(_)
    ));
    assert!(registry
        .replace_ownership(&owner, &first, replacement.clone())
        .unwrap());
    replacement.request_stop();
    assert!(replacement.was_stop_requested());
    assert!(matches!(
        registry.request_stop(&owner).unwrap(),
        VscodeProcessTaskStopAction::AlreadyRequested
    ));
}

#[test]
fn atomic_step_activation_enforces_bounds_order_total_and_stop_latch() {
    let registry = registry();
    let sink = Sink::default();
    let owner = owner("step-chain", "workspace-a", 91);
    let first = ownership(91, 210);
    registry.reserve(owner.clone()).unwrap();
    assert!(registry
        .activate_step(
            &owner,
            first.clone(),
            None,
            VscodeProcessTaskStep {
                label: "   ",
                index: 1,
                total: 2,
            },
        )
        .is_err());
    registry
        .activate_step(
            &owner,
            first.clone(),
            None,
            VscodeProcessTaskStep {
                label: "dependency",
                index: 1,
                total: 2,
            },
        )
        .unwrap();
    assert!(registry
        .replace_ownership_step(
            &owner,
            &first,
            ownership(91, 211),
            None,
            VscodeProcessTaskStep {
                label: "target",
                index: 1,
                total: 2,
            },
            &sink,
        )
        .is_err());
    assert!(registry
        .replace_ownership_step(
            &owner,
            &first,
            ownership(91, 212),
            None,
            VscodeProcessTaskStep {
                label: "target",
                index: 2,
                total: 3,
            },
            &sink,
        )
        .is_err());

    assert!(matches!(
        registry.request_stop(&owner).unwrap(),
        VscodeProcessTaskStopAction::Terminate(_)
    ));
    assert_eq!(
        registry
            .replace_ownership_step(
                &owner,
                &first,
                ownership(91, 213),
                None,
                VscodeProcessTaskStep {
                    label: "target",
                    index: 2,
                    total: 2,
                },
                &sink,
            )
            .unwrap(),
        VscodeProcessTaskStepActivation::StopRequested
    );
    registry
        .complete(&owner, VscodeProcessTaskCompletion::Stopped, &sink)
        .unwrap();
    registry.acknowledge_start(&owner, &sink).unwrap();
    let events = sink.events();
    assert!(matches!(
        &events[0],
        VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Running,
            ..
        }
    ));
    assert!(matches!(
        &events[1],
        VscodeProcessTaskEvent::Step {
            label,
            index: 1,
            total: 2,
            ..
        } if label == "dependency"
    ));
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, VscodeProcessTaskEvent::Step { .. }))
            .count(),
        1
    );
    assert!(matches!(
        events.last(),
        Some(VscodeProcessTaskEvent::Status {
            state: VscodeProcessTaskStatus::Stopped,
            ..
        })
    ));
}

#[test]
fn exact_prestart_cancellation_blocks_only_its_full_owner_and_is_deduplicated() {
    let registry = registry();
    let cancelled = owner("future", "workspace-a", 10);
    assert!(matches!(
        registry.request_stop(&cancelled).unwrap(),
        VscodeProcessTaskStopAction::PrestartRecorded
    ));
    assert!(matches!(
        registry.request_stop(&cancelled).unwrap(),
        VscodeProcessTaskStopAction::PrestartRecorded
    ));
    assert!(registry.reserve(cancelled.clone()).is_err());

    let replacement = VscodeProcessTaskOwner {
        config_revision: revision('b'),
        ..cancelled
    };
    assert!(registry.reserve(replacement).is_ok());
}

#[test]
fn admission_is_released_on_completion_and_sequence_exhaustion_fails_closed() {
    let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
    let registry = VscodeProcessTaskRegistry::with_initial_sequence(admission, u32::MAX);
    let first = owner("overflow", "workspace-a", 11);
    registry.reserve(first.clone()).unwrap();
    assert!(registry.activate(&first, ownership(11, 30)).is_err());

    let replacement = owner("replacement", "workspace-a", 11);
    assert!(registry.reserve(replacement).is_ok());

    let admission = Arc::new(TerminalTaskAdmissionRegistry::new());
    let output_registry = VscodeProcessTaskRegistry::with_initial_sequence(admission, u32::MAX - 1);
    let output_owner = owner("output-overflow", "workspace-b", 12);
    let sink = Sink::default();
    output_registry.reserve(output_owner.clone()).unwrap();
    output_registry
        .activate(&output_owner, ownership(12, 31))
        .unwrap();
    assert!(output_registry
        .record_output(
            &output_owner,
            VscodeProcessTaskOutputStream::Stdout,
            b"x",
            &sink
        )
        .is_err());
    assert!(output_registry
        .reserve(owner("output-replacement", "workspace-b", 12))
        .is_ok());
}

#[test]
fn prestart_and_terminal_tombstones_are_bounded() {
    let workspace_registry = registry();
    for index in 0..=128 {
        workspace_registry
            .request_stop(&owner(&format!("cancel-{index}"), "workspace-a", index))
            .unwrap();
    }
    assert!(workspace_registry
        .reserve(owner("cancel-0", "workspace-a", 2_000))
        .is_ok());

    let global_registry = registry();
    for index in 0..=1_024 {
        global_registry
            .request_stop(&owner(
                &format!("global-{index}"),
                &format!("workspace-{index}"),
                index,
            ))
            .unwrap();
    }
    assert!(global_registry
        .reserve(owner("global-0", "workspace-0", 3_000))
        .is_ok());

    let terminal_registry = registry();
    let sink = Sink::default();
    for index in 0..=1_024 {
        let owner = owner(&format!("terminal-{index}"), "workspace-terminal", index);
        terminal_registry.reserve(owner.clone()).unwrap();
        terminal_registry
            .activate(&owner, ownership(index, index))
            .unwrap();
        terminal_registry
            .complete(&owner, VscodeProcessTaskCompletion::Stopped, &sink)
            .unwrap();
    }
    assert!(terminal_registry
        .reserve(owner("terminal-0", "workspace-terminal", 4_000))
        .is_ok());
    assert!(terminal_registry
        .reserve(owner("terminal-1024", "workspace-terminal", 4_001))
        .is_err());
}

fn registry() -> VscodeProcessTaskRegistry {
    VscodeProcessTaskRegistry::with_admission(Arc::new(TerminalTaskAdmissionRegistry::new()))
}

fn ownership(session_id: u64, task_id: u64) -> TerminalTaskOwnership {
    TerminalTaskOwnership::new(session_id, task_id, 2_000_000_000)
}

fn owner(run_id: &str, workspace_id: &str, session_id: u64) -> VscodeProcessTaskOwner {
    VscodeProcessTaskOwner {
        run_id: run_id.to_string(),
        workspace_id: serde_json::from_str::<WorkspaceId>(&format!("\"{workspace_id}\""))
            .expect("workspace"),
        session_id,
        label: "task".to_string(),
        config_revision: revision('a'),
    }
}

fn revision(character: char) -> String {
    format!("sha256:{}", character.to_string().repeat(64))
}
