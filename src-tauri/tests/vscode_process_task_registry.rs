#![allow(dead_code)]

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
}

use std::sync::{Arc, Mutex};

use terminal_task_admission::TerminalTaskAdmissionRegistry;
use terminal_task_process::TerminalTaskOwnership;
use vscode_process_task_events::{
    VscodeProcessTaskEvent, VscodeProcessTaskEventSink, VscodeProcessTaskOutputStream,
    VscodeProcessTaskOwner, VscodeProcessTaskStatus,
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
