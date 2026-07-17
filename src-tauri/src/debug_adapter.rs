#![allow(dead_code)] // Protocol-agnostic debugger core awaiting the CDP adapter and command wiring slices.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBreakpoint {
    pub id: String,
    pub file_path: String,
    pub line_number: u32,
    pub condition: Option<String>,
    pub enabled: bool,
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStackFrame {
    pub frame_id: u64,
    pub name: String,
    pub file_path: Option<String>,
    pub line_number: u32,
    pub column: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScopeInfo {
    pub name: String,
    pub variables_reference: u64,
    pub expensive: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariableInfo {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    pub variables_reference: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugStopReason {
    Breakpoint,
    Step,
    Pause,
    Exception,
    Entry,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Continue,
    StepOver,
    StepInto,
    StepOut,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum DebugLaunchTarget {
    #[serde(rename = "node-script", rename_all = "camelCase")]
    NodeScript { script_path: String },
    #[serde(rename = "js-test-file", rename_all = "camelCase")]
    JsTestFile { runner: String, file_path: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DebugEventPayload {
    #[serde(rename_all = "camelCase")]
    Started { session_id: u64 },
    #[serde(rename_all = "camelCase")]
    Stopped {
        reason: DebugStopReason,
        frames: Vec<DebugStackFrame>,
    },
    Resumed,
    #[serde(rename_all = "camelCase")]
    Output {
        stream: DebugOutputStream,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Terminated { exit_code: Option<i32> },
    #[serde(rename_all = "camelCase")]
    BreakpointsVerified {
        file_path: String,
        breakpoints: Vec<DebugBreakpoint>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEvent {
    pub root_path: String,
    pub session_id: u64,
    pub seq: u64,
    pub payload: DebugEventPayload,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum DebugStartResponse {
    #[serde(rename_all = "camelCase")]
    Ok { session_id: u64 },
    Unavailable { message: String },
    Error { message: String },
}

pub trait DebugAdapter: Send {
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String>;
    fn step(&mut self, kind: StepKind) -> Result<(), String>;
    fn pause(&mut self) -> Result<(), String>;
    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String>;
    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String>;
    fn variables(&mut self, reference: u64) -> Result<Vec<DebugVariableInfo>, String>;
    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String>;
    fn terminate(&mut self);
}

/// `emit` must not synchronously call back into `DebugSessionRegistry`: it can
/// run while the (non-reentrant) per-session adapter mutex is held.
pub trait DebugEventSink: Send + Sync {
    fn emit(&self, event: DebugEvent);
}

/// Clones outlive the registry entry, so events may still arrive (with a higher
/// seq) after `Terminated`; consumers must treat `Terminated` as terminal.
#[derive(Clone)]
pub struct DebugEventEmitter {
    root_path: String,
    seq: Arc<AtomicU64>,
    session_id: u64,
    sink: Arc<dyn DebugEventSink>,
}

impl DebugEventEmitter {
    pub fn session_id(&self) -> u64 {
        self.session_id
    }

    pub fn emit(&self, payload: DebugEventPayload) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        self.sink.emit(DebugEvent {
            root_path: self.root_path.clone(),
            session_id: self.session_id,
            seq,
            payload,
        });
    }
}

struct RunningDebugSession {
    adapter: Arc<Mutex<Box<dyn DebugAdapter>>>,
    emitter: DebugEventEmitter,
    session_id: u64,
}

impl RunningDebugSession {
    fn terminate(self) {
        if let Ok(mut adapter) = self.adapter.lock() {
            adapter.terminate();
        }
        self.emitter
            .emit(DebugEventPayload::Terminated { exit_code: None });
    }
}

pub struct DebugSessionRegistry {
    next_session_id: AtomicU64,
    sessions: Mutex<HashMap<String, RunningDebugSession>>,
}

impl DebugSessionRegistry {
    pub fn new() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_session<F>(
        &self,
        root_key: &str,
        sink: Arc<dyn DebugEventSink>,
        session_factory: F,
    ) -> Result<u64, String>
    where
        F: FnOnce(DebugEventEmitter) -> Result<Box<dyn DebugAdapter>, String>,
    {
        self.stop(root_key);
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        let emitter = DebugEventEmitter {
            root_path: root_key.to_string(),
            seq: Arc::new(AtomicU64::new(0)),
            session_id,
            sink,
        };
        let adapter = session_factory(emitter.clone())?;
        let session = RunningDebugSession {
            adapter: Arc::new(Mutex::new(adapter)),
            emitter: emitter.clone(),
            session_id,
        };
        let previous = {
            let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            sessions.insert(root_key.to_string(), session)
        };
        if let Some(previous) = previous {
            previous.terminate();
        }
        emitter.emit(DebugEventPayload::Started { session_id });
        Ok(session_id)
    }

    pub fn session_id_for_root(&self, root_key: &str) -> Option<u64> {
        let sessions = self.sessions.lock().ok()?;
        sessions.get(root_key).map(|session| session.session_id)
    }

    pub fn with_session<R>(
        &self,
        root_key: &str,
        f: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let adapter = {
            let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            let session = sessions
                .get(root_key)
                .ok_or_else(|| format!("No debug session for workspace {root_key}."))?;
            Arc::clone(&session.adapter)
        };
        run_with_adapter(&adapter, f)
    }

    pub fn with_session_by_id<R>(
        &self,
        session_id: u64,
        f: impl FnOnce(&mut dyn DebugAdapter) -> R,
    ) -> Result<R, String> {
        let adapter = {
            let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            let session = sessions
                .values()
                .find(|session| session.session_id == session_id)
                .ok_or_else(|| format!("No debug session with id {session_id}."))?;
            Arc::clone(&session.adapter)
        };
        run_with_adapter(&adapter, f)
    }

    /// Adapter-initiated exit path (call from the process waiter thread); emits
    /// `Terminated` only if the session is still registered, so registry-initiated
    /// stops can never produce a duplicate.
    pub fn finish_session(&self, session_id: u64, exit_code: Option<i32>) -> bool {
        let Some(session) = self.remove_by_id(session_id) else {
            return false;
        };
        session
            .emitter
            .emit(DebugEventPayload::Terminated { exit_code });
        true
    }

    pub fn stop(&self, root_key: &str) -> bool {
        let removed = match self.sessions.lock() {
            Ok(mut sessions) => sessions.remove(root_key),
            Err(_) => None,
        };
        let Some(session) = removed else {
            return false;
        };
        session.terminate();
        true
    }

    pub fn stop_by_id(&self, session_id: u64) -> bool {
        let Some(session) = self.remove_by_id(session_id) else {
            return false;
        };
        session.terminate();
        true
    }

    pub fn stop_all(&self) {
        let removed: Vec<RunningDebugSession> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, session)| session).collect(),
            Err(_) => Vec::new(),
        };
        for session in removed {
            session.terminate();
        }
    }

    fn remove_by_id(&self, session_id: u64) -> Option<RunningDebugSession> {
        let mut sessions = self.sessions.lock().ok()?;
        let root_key = sessions
            .iter()
            .find(|(_, session)| session.session_id == session_id)
            .map(|(root_key, _)| root_key.clone())?;
        sessions.remove(&root_key)
    }
}

impl Default for DebugSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for DebugSessionRegistry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn run_with_adapter<R>(
    adapter: &Arc<Mutex<Box<dyn DebugAdapter>>>,
    f: impl FnOnce(&mut dyn DebugAdapter) -> R,
) -> Result<R, String> {
    let mut adapter = adapter.lock().map_err(|error| error.to_string())?;
    Ok(f(adapter.as_mut()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::thread;

    #[derive(Clone, Default)]
    struct FakeAdapterState {
        calls: Arc<Mutex<Vec<String>>>,
        terminated: Arc<AtomicBool>,
    }

    impl FakeAdapterState {
        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("calls").clone()
        }

        fn record(&self, call: String) {
            self.calls.lock().expect("calls").push(call);
        }

        fn is_terminated(&self) -> bool {
            self.terminated.load(Ordering::SeqCst)
        }
    }

    struct FakeAdapter {
        breakpoint_response: Result<Vec<DebugBreakpoint>, String>,
        state: FakeAdapterState,
    }

    impl FakeAdapter {
        fn new(state: FakeAdapterState) -> Self {
            Self {
                breakpoint_response: Ok(Vec::new()),
                state,
            }
        }

        fn with_breakpoint_response(
            state: FakeAdapterState,
            response: Result<Vec<DebugBreakpoint>, String>,
        ) -> Self {
            Self {
                breakpoint_response: response,
                state,
            }
        }
    }

    impl DebugAdapter for FakeAdapter {
        fn set_breakpoints(
            &mut self,
            file_path: &str,
            breakpoints: &[DebugBreakpoint],
        ) -> Result<Vec<DebugBreakpoint>, String> {
            self.state
                .record(format!("set_breakpoints:{file_path}:{}", breakpoints.len()));
            self.breakpoint_response.clone()
        }

        fn step(&mut self, kind: StepKind) -> Result<(), String> {
            self.state.record(format!("step:{kind:?}"));
            Ok(())
        }

        fn pause(&mut self) -> Result<(), String> {
            self.state.record("pause".to_string());
            Ok(())
        }

        fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
            self.state.record("stack_trace".to_string());
            Ok(Vec::new())
        }

        fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
            self.state.record(format!("scopes:{frame_id}"));
            Ok(Vec::new())
        }

        fn variables(&mut self, reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
            self.state.record(format!("variables:{reference}"));
            Ok(Vec::new())
        }

        fn evaluate(
            &mut self,
            frame_id: u64,
            expression: &str,
        ) -> Result<DebugVariableInfo, String> {
            self.state.record(format!("evaluate:{frame_id}:{expression}"));
            Ok(DebugVariableInfo {
                name: expression.to_string(),
                value: "42".to_string(),
                value_type: Some("number".to_string()),
                variables_reference: 0,
            })
        }

        fn terminate(&mut self) {
            self.state.record("terminate".to_string());
            self.state.terminated.store(true, Ordering::SeqCst);
        }
    }

    #[derive(Default)]
    struct CollectingSink {
        events: Mutex<Vec<DebugEvent>>,
    }

    impl CollectingSink {
        fn events(&self) -> Vec<DebugEvent> {
            self.events.lock().expect("events").clone()
        }
    }

    impl DebugEventSink for CollectingSink {
        fn emit(&self, event: DebugEvent) {
            self.events.lock().expect("events").push(event);
        }
    }

    fn start_fake_session(
        registry: &DebugSessionRegistry,
        root_key: &str,
        sink: Arc<CollectingSink>,
    ) -> (u64, FakeAdapterState) {
        let state = FakeAdapterState::default();
        let adapter_state = state.clone();
        let session_id = registry
            .start_session(root_key, sink, move |_emitter| {
                Ok(Box::new(FakeAdapter::new(adapter_state)))
            })
            .expect("start session");
        (session_id, state)
    }

    fn terminated_events(sink: &CollectingSink) -> Vec<DebugEvent> {
        sink.events()
            .into_iter()
            .filter(|event| matches!(event.payload, DebugEventPayload::Terminated { .. }))
            .collect()
    }

    #[test]
    fn start_session_emits_started_and_returns_incrementing_ids() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());

        let (first_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
        let (second_id, _) = start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

        assert_eq!(first_id, 1);
        assert_eq!(second_id, 2);
        let events = sink.events();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            DebugEvent {
                root_path: "/workspace/one".to_string(),
                session_id: 1,
                seq: 1,
                payload: DebugEventPayload::Started { session_id: 1 },
            }
        );
        assert_eq!(events[1].root_path, "/workspace/two");
        assert_eq!(
            events[1].payload,
            DebugEventPayload::Started { session_id: 2 }
        );
        assert_eq!(events[1].seq, 1);
    }

    #[test]
    fn start_for_same_root_terminates_previous_session() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());

        let (first_id, first_state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
        let (second_id, second_state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

        assert_ne!(first_id, second_id);
        assert!(first_state.is_terminated());
        assert!(!second_state.is_terminated());
        assert_eq!(
            registry.session_id_for_root("/workspace/one"),
            Some(second_id)
        );
        let terminated = terminated_events(&sink);
        assert_eq!(terminated.len(), 1);
        assert_eq!(terminated[0].session_id, first_id);
        assert_eq!(terminated[0].seq, 2);
        assert_eq!(
            terminated[0].payload,
            DebugEventPayload::Terminated { exit_code: None }
        );
    }

    #[test]
    fn start_session_propagates_factory_error_without_registering() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());

        let result = registry.start_session("/workspace/one", sink.clone(), |_emitter| {
            Err("Node inspector unavailable.".to_string())
        });

        assert_eq!(result, Err("Node inspector unavailable.".to_string()));
        assert_eq!(registry.session_id_for_root("/workspace/one"), None);
        assert!(sink.events().is_empty());
    }

    #[test]
    fn with_session_by_id_routes_to_matching_adapter() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (first_id, first_state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
        let (_second_id, second_state) =
            start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

        let result =
            registry.with_session_by_id(first_id, |adapter| adapter.step(StepKind::StepOver));

        assert_eq!(result, Ok(Ok(())));
        assert_eq!(first_state.calls(), vec!["step:StepOver".to_string()]);
        assert!(second_state.calls().is_empty());
    }

    #[test]
    fn with_session_by_root_returns_scripted_adapter_response() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let state = FakeAdapterState::default();
        let verified = vec![DebugBreakpoint {
            id: "bp-7".to_string(),
            file_path: "/workspace/one/src/app.ts".to_string(),
            line_number: 12,
            condition: None,
            enabled: true,
            verified: true,
        }];
        let adapter_state = state.clone();
        let scripted = verified.clone();
        registry
            .start_session("/workspace/one", sink, move |_emitter| {
                Ok(Box::new(FakeAdapter::with_breakpoint_response(
                    adapter_state,
                    Ok(scripted),
                )))
            })
            .expect("start session");

        let result = registry.with_session("/workspace/one", |adapter| {
            adapter.set_breakpoints("/workspace/one/src/app.ts", &[])
        });

        assert_eq!(result, Ok(Ok(verified)));
        assert_eq!(
            state.calls(),
            vec!["set_breakpoints:/workspace/one/src/app.ts:0".to_string()]
        );
    }

    #[test]
    fn with_session_for_unknown_root_and_id_returns_error() {
        let registry = DebugSessionRegistry::new();

        let by_root = registry.with_session("/workspace/none", |adapter| adapter.pause());
        let by_id = registry.with_session_by_id(99, |adapter| adapter.pause());

        assert_eq!(
            by_root,
            Err("No debug session for workspace /workspace/none.".to_string())
        );
        assert_eq!(by_id, Err("No debug session with id 99.".to_string()));
    }

    #[test]
    fn stop_terminates_adapter_and_emits_terminated_with_monotonic_seq() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (session_id, state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

        let stopped = registry.stop("/workspace/one");

        assert!(stopped);
        assert!(state.is_terminated());
        assert_eq!(registry.session_id_for_root("/workspace/one"), None);
        let events = sink.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].payload, DebugEventPayload::Started { session_id });
        assert_eq!(
            events[1].payload,
            DebugEventPayload::Terminated { exit_code: None }
        );
        assert_eq!(events[1].session_id, session_id);
        assert_eq!(events[0].seq, 1);
        assert_eq!(events[1].seq, 2);
    }

    #[test]
    fn stop_by_id_removes_only_matching_session() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (first_id, first_state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
        let (second_id, second_state) =
            start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

        let stopped = registry.stop_by_id(first_id);

        assert!(stopped);
        assert!(first_state.is_terminated());
        assert!(!second_state.is_terminated());
        assert_eq!(registry.session_id_for_root("/workspace/one"), None);
        assert_eq!(
            registry.session_id_for_root("/workspace/two"),
            Some(second_id)
        );
    }

    #[test]
    fn stop_for_unknown_targets_returns_false() {
        let registry = DebugSessionRegistry::new();

        assert!(!registry.stop("/workspace/none"));
        assert!(!registry.stop_by_id(42));
        assert!(!registry.finish_session(42, Some(0)));
    }

    #[test]
    fn finish_session_emits_terminated_with_exit_code_and_unregisters() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (session_id, state) =
            start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

        let finished = registry.finish_session(session_id, Some(3));

        assert!(finished);
        assert!(!state.is_terminated());
        assert_eq!(registry.session_id_for_root("/workspace/one"), None);
        let terminated = terminated_events(&sink);
        assert_eq!(terminated.len(), 1);
        assert_eq!(terminated[0].session_id, session_id);
        assert_eq!(terminated[0].seq, 2);
        assert_eq!(
            terminated[0].payload,
            DebugEventPayload::Terminated { exit_code: Some(3) }
        );
    }

    #[test]
    fn finish_then_stop_emits_single_terminated() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (session_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

        assert!(registry.finish_session(session_id, Some(0)));
        assert!(!registry.stop("/workspace/one"));
        assert!(!registry.stop_by_id(session_id));
        registry.stop_all();

        assert_eq!(terminated_events(&sink).len(), 1);
    }

    #[test]
    fn stop_then_finish_emits_single_terminated() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (session_id, _) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));

        assert!(registry.stop("/workspace/one"));
        assert!(!registry.finish_session(session_id, Some(0)));

        assert_eq!(terminated_events(&sink).len(), 1);
    }

    #[test]
    fn stop_all_terminates_every_session() {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (_, first_state) = start_fake_session(&registry, "/workspace/one", Arc::clone(&sink));
        let (_, second_state) = start_fake_session(&registry, "/workspace/two", Arc::clone(&sink));

        registry.stop_all();

        assert!(first_state.is_terminated());
        assert!(second_state.is_terminated());
        assert_eq!(registry.session_id_for_root("/workspace/one"), None);
        assert_eq!(registry.session_id_for_root("/workspace/two"), None);
    }

    #[test]
    fn dropping_registry_terminates_sessions() {
        let sink = Arc::new(CollectingSink::default());
        let state = FakeAdapterState::default();
        {
            let registry = DebugSessionRegistry::new();
            let adapter_state = state.clone();
            registry
                .start_session("/workspace/one", sink.clone(), move |_emitter| {
                    Ok(Box::new(FakeAdapter::new(adapter_state)))
                })
                .expect("start session");
        }

        assert!(state.is_terminated());
        assert_eq!(
            sink.events().last().map(|event| event.payload.clone()),
            Some(DebugEventPayload::Terminated { exit_code: None })
        );
    }

    #[test]
    fn emitter_seq_stays_monotonic_across_threads() {
        let registry = Arc::new(DebugSessionRegistry::new());
        let sink = Arc::new(CollectingSink::default());
        let captured_emitter: Arc<Mutex<Option<DebugEventEmitter>>> = Arc::new(Mutex::new(None));
        let state = FakeAdapterState::default();
        let adapter_state = state.clone();
        let emitter_slot = Arc::clone(&captured_emitter);
        registry
            .start_session("/workspace/one", sink.clone(), move |emitter| {
                *emitter_slot.lock().expect("emitter slot") = Some(emitter);
                Ok(Box::new(FakeAdapter::new(adapter_state)))
            })
            .expect("start session");
        let emitter = captured_emitter
            .lock()
            .expect("emitter slot")
            .clone()
            .expect("captured emitter");

        let handles: Vec<_> = (0..2)
            .map(|thread_index| {
                let emitter = emitter.clone();
                thread::spawn(move || {
                    for message_index in 0..50 {
                        emitter.emit(DebugEventPayload::Output {
                            stream: DebugOutputStream::Stdout,
                            text: format!("{thread_index}:{message_index}"),
                        });
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("emitter thread");
        }

        let events = sink.events();
        assert_eq!(events.len(), 101);
        let mut seqs: Vec<u64> = events.iter().map(|event| event.seq).collect();
        seqs.sort_unstable();
        assert_eq!(seqs, (1..=101).collect::<Vec<u64>>());
    }

    #[test]
    fn concurrent_starts_on_distinct_roots_register_both_sessions() {
        let registry = Arc::new(DebugSessionRegistry::new());
        let sink = Arc::new(CollectingSink::default());

        let handles: Vec<_> = ["/workspace/one", "/workspace/two"]
            .into_iter()
            .map(|root_key| {
                let registry = Arc::clone(&registry);
                let sink = Arc::clone(&sink);
                thread::spawn(move || {
                    let state = FakeAdapterState::default();
                    registry
                        .start_session(root_key, sink, move |_emitter| {
                            Ok(Box::new(FakeAdapter::new(state)))
                        })
                        .expect("start session")
                })
            })
            .collect();
        let session_ids: Vec<u64> = handles
            .into_iter()
            .map(|handle| handle.join().expect("start thread"))
            .collect();

        assert_ne!(session_ids[0], session_ids[1]);
        assert!(registry.session_id_for_root("/workspace/one").is_some());
        assert!(registry.session_id_for_root("/workspace/two").is_some());
        assert_eq!(sink.events().len(), 2);
    }

    #[test]
    fn concurrent_starts_on_same_root_keep_exactly_one_live_session() {
        let registry = Arc::new(DebugSessionRegistry::new());
        let sink = Arc::new(CollectingSink::default());

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let sink = Arc::clone(&sink);
                thread::spawn(move || {
                    let state = FakeAdapterState::default();
                    let adapter_state = state.clone();
                    let session_id = registry
                        .start_session("/workspace/one", sink, move |_emitter| {
                            Ok(Box::new(FakeAdapter::new(adapter_state)))
                        })
                        .expect("start session");
                    (session_id, state)
                })
            })
            .collect();
        let results: Vec<(u64, FakeAdapterState)> = handles
            .into_iter()
            .map(|handle| handle.join().expect("start thread"))
            .collect();

        let live_id = registry
            .session_id_for_root("/workspace/one")
            .expect("live session");
        let live: Vec<_> = results
            .iter()
            .filter(|(session_id, _)| *session_id == live_id)
            .collect();
        let terminated: Vec<_> = results
            .iter()
            .filter(|(session_id, _)| *session_id != live_id)
            .collect();
        assert_eq!(live.len(), 1);
        assert_eq!(terminated.len(), 1);
        assert!(!live[0].1.is_terminated());
        assert!(terminated[0].1.is_terminated());
        let terminated_seen = terminated_events(&sink);
        assert_eq!(terminated_seen.len(), 1);
        assert_eq!(terminated_seen[0].session_id, terminated[0].0);
    }

    #[test]
    fn debug_launch_target_serializes_with_kebab_case_kinds() {
        let node = DebugLaunchTarget::NodeScript {
            script_path: "/workspace/one/index.js".to_string(),
        };
        let test_file = DebugLaunchTarget::JsTestFile {
            runner: "vitest".to_string(),
            file_path: "/workspace/one/src/app.test.ts".to_string(),
        };

        assert_eq!(
            serde_json::to_value(&node).expect("serialize node target"),
            serde_json::json!({"kind": "node-script", "scriptPath": "/workspace/one/index.js"})
        );
        assert_eq!(
            serde_json::to_value(&test_file).expect("serialize test target"),
            serde_json::json!({
                "kind": "js-test-file",
                "runner": "vitest",
                "filePath": "/workspace/one/src/app.test.ts"
            })
        );
        let parsed: DebugLaunchTarget = serde_json::from_value(
            serde_json::json!({"kind": "node-script", "scriptPath": "/workspace/one/index.js"}),
        )
        .expect("deserialize node target");
        assert_eq!(parsed, node);
    }

    #[test]
    fn step_kind_serializes_as_frontend_wire_values() {
        assert_eq!(
            serde_json::to_value(StepKind::Continue).expect("serialize continue"),
            serde_json::json!("continue")
        );
        assert_eq!(
            serde_json::to_value(StepKind::StepOver).expect("serialize stepOver"),
            serde_json::json!("stepOver")
        );
        assert_eq!(
            serde_json::to_value(StepKind::StepInto).expect("serialize stepInto"),
            serde_json::json!("stepInto")
        );
        assert_eq!(
            serde_json::to_value(StepKind::StepOut).expect("serialize stepOut"),
            serde_json::json!("stepOut")
        );
        let parsed: StepKind =
            serde_json::from_value(serde_json::json!("stepOut")).expect("deserialize stepOut");
        assert_eq!(parsed, StepKind::StepOut);
    }

    #[test]
    fn debug_stop_reason_serializes_all_frontend_wire_values() {
        let expected = [
            (DebugStopReason::Breakpoint, "breakpoint"),
            (DebugStopReason::Step, "step"),
            (DebugStopReason::Pause, "pause"),
            (DebugStopReason::Exception, "exception"),
            (DebugStopReason::Entry, "entry"),
        ];

        for (reason, wire_value) in expected {
            assert_eq!(
                serde_json::to_value(reason).expect("serialize stop reason"),
                serde_json::json!(wire_value)
            );
            let parsed: DebugStopReason = serde_json::from_value(serde_json::json!(wire_value))
                .expect("deserialize stop reason");
            assert_eq!(parsed, reason);
        }
    }

    #[test]
    fn debug_breakpoint_deserializes_from_frontend_json() {
        let parsed: DebugBreakpoint = serde_json::from_value(serde_json::json!({
            "id": "bp-9",
            "filePath": "/workspace/one/src/app.ts",
            "lineNumber": 42,
            "condition": "user !== null",
            "enabled": true,
            "verified": false
        }))
        .expect("deserialize breakpoint");

        let expected = DebugBreakpoint {
            id: "bp-9".to_string(),
            file_path: "/workspace/one/src/app.ts".to_string(),
            line_number: 42,
            condition: Some("user !== null".to_string()),
            enabled: true,
            verified: false,
        };
        assert_eq!(parsed, expected);
        let round_tripped: DebugBreakpoint = serde_json::from_value(
            serde_json::to_value(&expected).expect("serialize breakpoint"),
        )
        .expect("round-trip breakpoint");
        assert_eq!(round_tripped, expected);
    }

    #[test]
    fn debug_start_response_serializes_with_status_tag() {
        assert_eq!(
            serde_json::to_value(DebugStartResponse::Ok { session_id: 3 })
                .expect("serialize ok response"),
            serde_json::json!({"status": "ok", "sessionId": 3})
        );
        assert_eq!(
            serde_json::to_value(DebugStartResponse::Unavailable {
                message: "Node runtime not found.".to_string()
            })
            .expect("serialize unavailable response"),
            serde_json::json!({"status": "unavailable", "message": "Node runtime not found."})
        );
        assert_eq!(
            serde_json::to_value(DebugStartResponse::Error {
                message: "Launch failed.".to_string()
            })
            .expect("serialize error response"),
            serde_json::json!({"status": "error", "message": "Launch failed."})
        );
    }

    #[test]
    fn debug_event_payload_serializes_with_kind_tag() {
        let stopped = DebugEventPayload::Stopped {
            reason: DebugStopReason::Breakpoint,
            frames: vec![DebugStackFrame {
                frame_id: 4,
                name: "handleRequest".to_string(),
                file_path: Some("/workspace/one/src/app.ts".to_string()),
                line_number: 12,
                column: 3,
            }],
        };
        let verified = DebugEventPayload::BreakpointsVerified {
            file_path: "/workspace/one/src/app.ts".to_string(),
            breakpoints: vec![DebugBreakpoint {
                id: "bp-1".to_string(),
                file_path: "/workspace/one/src/app.ts".to_string(),
                line_number: 12,
                condition: Some("count > 3".to_string()),
                enabled: true,
                verified: true,
            }],
        };

        assert_eq!(
            serde_json::to_value(DebugEventPayload::Started { session_id: 7 })
                .expect("serialize started"),
            serde_json::json!({"kind": "started", "sessionId": 7})
        );
        assert_eq!(
            serde_json::to_value(&stopped).expect("serialize stopped"),
            serde_json::json!({
                "kind": "stopped",
                "reason": "breakpoint",
                "frames": [{
                    "frameId": 4,
                    "name": "handleRequest",
                    "filePath": "/workspace/one/src/app.ts",
                    "lineNumber": 12,
                    "column": 3
                }]
            })
        );
        assert_eq!(
            serde_json::to_value(DebugEventPayload::Output {
                stream: DebugOutputStream::Stderr,
                text: "boom".to_string(),
            })
            .expect("serialize output"),
            serde_json::json!({"kind": "output", "stream": "stderr", "text": "boom"})
        );
        assert_eq!(
            serde_json::to_value(DebugEventPayload::Output {
                stream: DebugOutputStream::Stdout,
                text: "ready".to_string(),
            })
            .expect("serialize stdout output"),
            serde_json::json!({"kind": "output", "stream": "stdout", "text": "ready"})
        );
        assert_eq!(
            serde_json::to_value(DebugEventPayload::Terminated { exit_code: Some(1) })
                .expect("serialize terminated"),
            serde_json::json!({"kind": "terminated", "exitCode": 1})
        );
        assert_eq!(
            serde_json::to_value(DebugEventPayload::Terminated { exit_code: None })
                .expect("serialize terminated without exit code"),
            serde_json::json!({"kind": "terminated", "exitCode": null})
        );
        assert_eq!(
            serde_json::to_value(&verified).expect("serialize verified"),
            serde_json::json!({
                "kind": "breakpointsVerified",
                "filePath": "/workspace/one/src/app.ts",
                "breakpoints": [{
                    "id": "bp-1",
                    "filePath": "/workspace/one/src/app.ts",
                    "lineNumber": 12,
                    "condition": "count > 3",
                    "enabled": true,
                    "verified": true
                }]
            })
        );
    }

    #[test]
    fn debug_event_and_variable_info_use_camel_case_wire_format() {
        let event = DebugEvent {
            root_path: "/workspace/one".to_string(),
            session_id: 2,
            seq: 5,
            payload: DebugEventPayload::Resumed,
        };
        let variable = DebugVariableInfo {
            name: "user".to_string(),
            value: "User { id: 1 }".to_string(),
            value_type: Some("User".to_string()),
            variables_reference: 9,
        };

        assert_eq!(
            serde_json::to_value(&event).expect("serialize event"),
            serde_json::json!({
                "rootPath": "/workspace/one",
                "sessionId": 2,
                "seq": 5,
                "payload": {"kind": "resumed"}
            })
        );
        assert_eq!(
            serde_json::to_value(&variable).expect("serialize variable"),
            serde_json::json!({
                "name": "user",
                "value": "User { id: 1 }",
                "type": "User",
                "variablesReference": 9
            })
        );
    }
}
