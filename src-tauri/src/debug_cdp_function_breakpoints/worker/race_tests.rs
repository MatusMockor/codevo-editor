use super::*;
use crate::debug_cdp_function_breakpoints::HiddenPauseCapture;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

struct OvertakenInstallFakeCdp {
    blocked_install: usize,
    calls: Arc<Mutex<Vec<(String, Value)>>>,
    entered: mpsc::SyncSender<String>,
    first_install_release: Option<mpsc::Receiver<()>>,
    install_count: usize,
    replies: VecDeque<Result<Value, String>>,
}

impl FunctionBreakpointCdp for OvertakenInstallFakeCdp {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.calls
            .lock()
            .unwrap()
            .push((method.to_string(), params));
        self.entered.send(method.to_string()).unwrap();
        if method == "Debugger.setBreakpointOnFunctionCall" {
            self.install_count += 1;
            if self.install_count == self.blocked_install {
                if let Some(release) = self.first_install_release.take() {
                    release.recv().unwrap();
                }
            }
        }
        self.replies.pop_front().unwrap_or(Ok(json!({})))
    }
}

#[test]
fn hidden_step_overtaking_a_multi_install_sweep_rolls_back_and_publishes_every_candidate() {
    let state = Arc::new(FunctionBreakpointSessionState::default());
    state.desired_generation.store(1, Ordering::Release);
    state
        .registrations
        .lock()
        .unwrap()
        .unverified_by_logical_id
        .insert("fn-1".to_string(), "renderOne".to_string());
    state
        .registrations
        .lock()
        .unwrap()
        .unverified_by_logical_id
        .insert("fn-2".to_string(), "renderTwo".to_string());
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (entered_tx, entered_rx) = mpsc::sync_channel(8);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let cdp = OvertakenInstallFakeCdp {
        blocked_install: 2,
        calls: Arc::clone(&calls),
        entered: entered_tx,
        first_install_release: Some(release_rx),
        install_count: 0,
        replies: VecDeque::from([
            Ok(json!({"result":{"type":"function","objectId":"function:stale-1"}})),
            Ok(json!({"breakpointId":"cdp-stale-1"})),
            Ok(json!({"result":{"type":"function","objectId":"function:stale-2"}})),
            Ok(json!({"breakpointId":"cdp-stale-2"})),
            Ok(json!({})),
            Ok(json!({})),
            Ok(json!({"result":{"type":"function","objectId":"function:current-1"}})),
            Ok(json!({
                "internalProperties":[{
                    "name":"[[FunctionLocation]]",
                    "value":{"value":{
                        "scriptId":"entry-script",
                        "lineNumber":4,
                        "columnNumber":2
                    }}
                }]
            })),
            Ok(json!({"breakpointId":"cdp-current-1"})),
            Ok(json!({"result":{"type":"function","objectId":"function:current-2"}})),
            Ok(json!({
                "internalProperties":[{
                    "name":"[[FunctionLocation]]",
                    "value":{"value":{
                        "scriptId":"entry-script",
                        "lineNumber":8,
                        "columnNumber":2
                    }}
                }]
            })),
            Ok(json!({"breakpointId":"cdp-current-2"})),
        ]),
    };
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let emitted_for_worker = Arc::clone(&emitted);
    let (event_tx, event_rx) = mpsc::sync_channel(2);
    let failed_closed = Arc::new(AtomicBool::new(false));
    let failed_closed_for_worker = Arc::clone(&failed_closed);
    let (trigger_tx, trigger_rx) = mpsc::channel();
    let state_for_worker = Arc::clone(&state);
    let worker = thread::spawn(move || {
        run_reresolution_worker(
            trigger_rx,
            cdp,
            state_for_worker,
            crate::debug_cdp::transport::empty_shared_state_for_test(),
            Arc::new(move |payload| {
                emitted_for_worker.lock().unwrap().push(payload);
                event_tx.send(()).unwrap();
            }),
            Arc::new(|| true),
            Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
        );
    });

    trigger_tx.send(()).unwrap();
    for expected in [
        "Runtime.evaluate",
        "Debugger.setBreakpointOnFunctionCall",
        "Runtime.evaluate",
        "Debugger.setBreakpointOnFunctionCall",
    ] {
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            expected
        );
    }
    assert!(state.begin_hidden_continue_step().unwrap());
    assert_eq!(
        state.capture_hidden_continue_pause(&json!({
            "reason":"step",
            "hitBreakpoints":[],
            "callFrames":[{
                "callFrameId":"frame-1",
                "functionName":"renderOne",
                "url":"file:///workspace/server.js",
                "functionLocation":{
                    "scriptId":"entry-script",
                    "lineNumber":4,
                    "columnNumber":2
                },
                "location":{
                    "scriptId":"entry-script",
                    "lineNumber":4,
                    "columnNumber":2
                }
            }]
        })),
        HiddenPauseCapture::Captured
    );
    trigger_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    for expected in [
        "Debugger.removeBreakpoint",
        "Debugger.removeBreakpoint",
        "Runtime.evaluate",
        "Runtime.getProperties",
        "Debugger.setBreakpointOnFunctionCall",
        "Runtime.evaluate",
        "Runtime.getProperties",
        "Debugger.setBreakpointOnFunctionCall",
    ] {
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            expected
        );
    }
    event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    event_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    drop(trigger_tx);
    worker.join().unwrap();

    assert!(matches!(
        emitted.lock().unwrap().as_slice(),
        [
            DebugEventPayload::Stopped { .. },
            DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. }
        ] if breakpoints == &[
            DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true
            },
            DebugFunctionBreakpointVerification {
                id: "fn-2".to_string(),
                verified: true
            }
        ]
    ));
    assert!(!failed_closed.load(Ordering::Acquire));
    assert!(!state.has_hidden_continue_pause().unwrap());
    let registrations = state.registrations.lock().unwrap();
    assert_eq!(
        registrations.by_logical_id.get("fn-1").map(String::as_str),
        Some("cdp-current-1")
    );
    assert_eq!(
        registrations.by_logical_id.get("fn-2").map(String::as_str),
        Some("cdp-current-2")
    );
    drop(registrations);
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|(method, _)| method.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Runtime.evaluate",
            "Debugger.setBreakpointOnFunctionCall",
            "Runtime.evaluate",
            "Debugger.setBreakpointOnFunctionCall",
            "Debugger.removeBreakpoint",
            "Debugger.removeBreakpoint",
            "Runtime.evaluate",
            "Runtime.getProperties",
            "Debugger.setBreakpointOnFunctionCall",
            "Runtime.evaluate",
            "Runtime.getProperties",
            "Debugger.setBreakpointOnFunctionCall",
        ]
    );
}

#[test]
fn owner_loss_after_first_multi_install_removes_every_unpublished_candidate() {
    let state = Arc::new(FunctionBreakpointSessionState::default());
    state.desired_generation.store(1, Ordering::Release);
    {
        let mut registrations = state.registrations.lock().unwrap();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "renderOne".to_string());
        registrations
            .unverified_by_logical_id
            .insert("fn-2".to_string(), "renderTwo".to_string());
    }
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (entered_tx, entered_rx) = mpsc::sync_channel(8);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let cdp = OvertakenInstallFakeCdp {
        blocked_install: 2,
        calls: Arc::clone(&calls),
        entered: entered_tx,
        first_install_release: Some(release_rx),
        install_count: 0,
        replies: VecDeque::from([
            Ok(json!({"result":{"type":"function","objectId":"function:1"}})),
            Ok(json!({"breakpointId":"cdp-1"})),
            Ok(json!({"result":{"type":"function","objectId":"function:2"}})),
            Ok(json!({"breakpointId":"cdp-2"})),
            Ok(json!({})),
            Ok(json!({})),
        ]),
    };
    let allowed = Arc::new(AtomicBool::new(true));
    let allowed_for_worker = Arc::clone(&allowed);
    let failed_closed = Arc::new(AtomicBool::new(false));
    let failed_closed_for_worker = Arc::clone(&failed_closed);
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let emitted_for_worker = Arc::clone(&emitted);
    let (trigger_tx, trigger_rx) = mpsc::channel();
    let state_for_worker = Arc::clone(&state);
    let worker = thread::spawn(move || {
        run_reresolution_worker(
            trigger_rx,
            cdp,
            state_for_worker,
            crate::debug_cdp::transport::empty_shared_state_for_test(),
            Arc::new(move |payload| emitted_for_worker.lock().unwrap().push(payload)),
            Arc::new(move || allowed_for_worker.load(Ordering::Acquire)),
            Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
        );
    });

    trigger_tx.send(()).unwrap();
    for expected in [
        "Runtime.evaluate",
        "Debugger.setBreakpointOnFunctionCall",
        "Runtime.evaluate",
        "Debugger.setBreakpointOnFunctionCall",
    ] {
        assert_eq!(
            entered_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            expected
        );
    }
    allowed.store(false, Ordering::Release);
    release_tx.send(()).unwrap();
    drop(trigger_tx);
    worker.join().unwrap();

    assert!(failed_closed.load(Ordering::Acquire));
    assert!(emitted.lock().unwrap().is_empty());
    let registrations = state.registrations.lock().unwrap();
    assert!(registrations.by_logical_id.is_empty());
    assert!(registrations.unpublished_cdp_ids.is_empty());
    assert_eq!(registrations.unverified_by_logical_id.len(), 2);
    drop(registrations);
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|(method, _)| method.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Runtime.evaluate",
            "Debugger.setBreakpointOnFunctionCall",
            "Runtime.evaluate",
            "Debugger.setBreakpointOnFunctionCall",
            "Debugger.removeBreakpoint",
            "Debugger.removeBreakpoint",
        ]
    );
}
