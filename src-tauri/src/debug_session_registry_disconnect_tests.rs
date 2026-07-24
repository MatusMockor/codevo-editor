use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEvent, DebugEventPayload, DebugEventSink, DebugScopeInfo,
    DebugSessionRegistry, DebugStackFrame, DebugVariableInfo, StepKind,
};
use crate::debug_breakpoint_policy::DebugBreakpointAdapterKind;
use crate::debug_session_registry::DebugSessionMode;
use crate::debug_session_registry::DebugWorkspaceAuthority;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;

#[derive(Clone, Default)]
struct AdapterState {
    terminated: Arc<AtomicBool>,
}

struct TestAdapter(AdapterState);

impl DebugAdapter for TestAdapter {
    fn set_breakpoints(
        &mut self,
        _file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        Ok(breakpoints.to_vec())
    }

    fn step(&mut self, _kind: StepKind) -> Result<(), String> {
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        Ok(Vec::new())
    }

    fn scopes(&mut self, _frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        Ok(Vec::new())
    }

    fn evaluate(&mut self, _frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        Ok(DebugVariableInfo {
            name: expression.to_string(),
            value: String::new(),
            value_type: None,
            evaluate_name: None,
            variables_reference: 0,
            can_set_value: None,
            set_expression_reference: None,
        })
    }

    fn terminate(&mut self) {
        self.0.terminated.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct Sink(Mutex<Vec<DebugEvent>>);

impl DebugEventSink for Sink {
    fn emit(&self, event: DebugEvent) {
        self.0.lock().expect("event lock").push(event);
    }
}

impl Sink {
    fn terminal_count(&self) -> usize {
        self.0
            .lock()
            .expect("event lock")
            .iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
            .count()
    }
}

fn start(
    registry: &DebugSessionRegistry,
    sink: Arc<Sink>,
    root: &str,
    mode: DebugSessionMode,
) -> (u64, AdapterState) {
    let permit = registry.begin_start(root).expect("startup permit");
    let state = AdapterState::default();
    let adapter_state = state.clone();
    let id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink,
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            mode,
            move |_| Ok(Box::new(TestAdapter(adapter_state))),
        )
        .expect("start session");
    (id, state)
}

fn retained_authority(workspace_id: &str, root: &str) -> DebugWorkspaceAuthority {
    DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: workspace_id.to_string(),
        canonical_root: root.to_string(),
    }
}

fn start_authorized(
    registry: &DebugSessionRegistry,
    sink: Arc<Sink>,
    root: &str,
    authority: DebugWorkspaceAuthority,
) -> (u64, AdapterState) {
    let permit = registry
        .begin_start_with_authority(root, authority)
        .expect("startup permit");
    let state = AdapterState::default();
    let adapter_state = state.clone();
    let id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink,
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            DebugSessionMode::ExternalNodeAttach,
            move |_| Ok(Box::new(TestAdapter(adapter_state))),
        )
        .expect("start authorized session");
    (id, state)
}

fn start_authorized_group_member(
    registry: &DebugSessionRegistry,
    sink: Arc<Sink>,
    permit: crate::debug_adapter::DebugStartupPermit,
) -> (u64, AdapterState) {
    let state = AdapterState::default();
    let adapter_state = state.clone();
    let id = registry
        .start_session_with_permit_breakpoints_and_mode(
            permit,
            sink,
            DebugBreakpointAdapterKind::Node,
            HashMap::new(),
            DebugSessionMode::ExternalNodeAttach,
            move |_| Ok(Box::new(TestAdapter(adapter_state))),
        )
        .expect("start authorized group member");
    (id, state)
}

#[test]
fn disconnect_removes_and_terminates_only_an_external_attach() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let (id, state) = start(
        &registry,
        Arc::clone(&sink),
        "/workspace/attach",
        DebugSessionMode::ExternalNodeAttach,
    );

    registry
        .disconnect_external_node_attach("/workspace/attach", id)
        .expect("disconnect attach");

    assert!(state.terminated.load(Ordering::SeqCst));
    assert_eq!(registry.session_id_for_root("/workspace/attach"), None);
    assert_eq!(sink.terminal_count(), 1);
}

#[test]
fn disconnect_preserves_owned_launch_and_normal_stop_still_terminates_it() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let (id, state) = start(
        &registry,
        Arc::clone(&sink),
        "/workspace/launch",
        DebugSessionMode::OwnedLaunch,
    );

    assert_eq!(
        registry
            .disconnect_external_node_attach("/workspace/launch", id)
            .expect_err("owned launch must be preserved"),
        "Disconnect is only available for attached Node.js debug sessions."
    );
    assert!(!state.terminated.load(Ordering::SeqCst));
    assert_eq!(registry.session_id_for_root("/workspace/launch"), Some(id));
    assert!(registry.stop_by_id(id));
    assert!(state.terminated.load(Ordering::SeqCst));
    assert_eq!(sink.terminal_count(), 1);
}

#[test]
fn stale_disconnect_is_idempotent_without_a_session_but_rejects_a_replacement() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let root = "/workspace/attach";
    let (old_id, _) = start(
        &registry,
        Arc::clone(&sink),
        root,
        DebugSessionMode::ExternalNodeAttach,
    );
    assert!(registry.finish_session(old_id, None));
    registry
        .disconnect_external_node_attach(root, old_id)
        .expect("remote close is idempotent");

    let (replacement_id, replacement) =
        start(&registry, sink, root, DebugSessionMode::ExternalNodeAttach);
    assert!(registry
        .disconnect_external_node_attach(root, old_id)
        .is_err());
    assert_eq!(registry.session_id_for_root(root), Some(replacement_id));
    assert!(!replacement.terminated.load(Ordering::SeqCst));
}

#[test]
fn disconnect_and_remote_finish_race_emits_one_terminal_event() {
    let registry = Arc::new(DebugSessionRegistry::new());
    let sink = Arc::new(Sink::default());
    let root = "/workspace/attach";
    let (id, _) = start(
        &registry,
        Arc::clone(&sink),
        root,
        DebugSessionMode::ExternalNodeAttach,
    );
    let barrier = Arc::new(Barrier::new(3));
    let disconnect_registry = Arc::clone(&registry);
    let disconnect_barrier = Arc::clone(&barrier);
    let disconnect = thread::spawn(move || {
        disconnect_barrier.wait();
        disconnect_registry.disconnect_external_node_attach(root, id)
    });
    let finish_registry = Arc::clone(&registry);
    let finish_barrier = Arc::clone(&barrier);
    let finish = thread::spawn(move || {
        finish_barrier.wait();
        finish_registry.finish_session(id, None)
    });
    barrier.wait();

    disconnect
        .join()
        .expect("disconnect worker")
        .expect("disconnect is idempotent if finish won");
    let _finish_won = finish.join().expect("finish worker");
    assert_eq!(registry.session_id_for_root(root), None);
    assert_eq!(sink.terminal_count(), 1);
}

#[test]
fn retained_authority_allows_disposal_without_reopening_the_root() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let authority = retained_authority("workspace-a", "/canonical/a");
    let (id, state) = start_authorized(
        &registry,
        Arc::clone(&sink),
        "/canonical/a",
        authority.clone(),
    );

    registry
        .disconnect_external_node_attach_authorized(&authority, id)
        .expect("retained identity disconnect");

    assert!(state.terminated.load(Ordering::SeqCst));
    assert_eq!(registry.session_id_for_root("/canonical/a"), None);
    assert_eq!(sink.terminal_count(), 1);
}

#[test]
fn disconnect_rejects_cross_workspace_spoof_and_unknown_id_with_a_replacement() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let authority_a = retained_authority("workspace-a", "/canonical/a");
    let authority_b = retained_authority("workspace-b", "/canonical/b");
    let (id, state) = start_authorized(&registry, sink, "/canonical/a", authority_a.clone());

    assert!(registry
        .disconnect_external_node_attach_authorized(&authority_b, id)
        .is_err());
    assert!(registry
        .disconnect_external_node_attach_authorized(&authority_a, id + 10_000)
        .is_err());
    assert_eq!(registry.session_id_for_root("/canonical/a"), Some(id));
    assert!(!state.terminated.load(Ordering::SeqCst));
}

#[test]
fn absent_session_id_is_idempotent_only_without_the_same_workspace_authority() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let authority = retained_authority("workspace-a", "/canonical/a");
    let (id, _) = start_authorized(&registry, sink, "/canonical/a", authority.clone());

    assert!(registry
        .disconnect_external_node_attach_authorized(&authority, id + 1)
        .is_err());
    assert!(registry.finish_session(id, None));
    registry
        .disconnect_external_node_attach_authorized(&authority, id)
        .expect("already closed exact workspace is idempotent");
}

#[test]
fn late_exact_disconnect_of_finished_group_member_preserves_same_authority_sibling() {
    let registry = DebugSessionRegistry::new();
    let sink = Arc::new(Sink::default());
    let root = "/canonical/compound";
    let authority = retained_authority("workspace-compound", root);
    let group = registry
        .begin_start_group_with_authority(root, authority.clone())
        .expect("authorized startup group");
    let first_permit = registry
        .begin_start_in_group(&group)
        .expect("first member permit");
    let second_permit = registry
        .begin_start_in_group(&group)
        .expect("second member permit");
    let (first_id, first_state) =
        start_authorized_group_member(&registry, Arc::clone(&sink), first_permit);
    let (second_id, second_state) =
        start_authorized_group_member(&registry, Arc::clone(&sink), second_permit);

    assert!(registry.finish_session(first_id, None));
    registry
        .disconnect_external_node_attach_authorized(&authority, first_id)
        .expect("late exact disconnect is idempotent");

    assert!(!first_state.terminated.load(Ordering::SeqCst));
    assert!(!second_state.terminated.load(Ordering::SeqCst));
    assert!(registry.owns_session(root, second_id));
    assert_eq!(registry.session_id_for_root(root), Some(second_id));
    assert_eq!(sink.terminal_count(), 1);
}
