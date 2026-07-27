mod command;
mod installation;
mod state;
mod worker;

pub(crate) use command::debug_set_function_breakpoints;
pub(crate) use installation::{
    replace_function_breakpoints, validate_function_breakpoints, FunctionBreakpointCdp,
};
pub(crate) use state::{
    FunctionBreakpointSessionState, FunctionBreakpointVerificationReceipt, HiddenPauseCapture,
    HiddenStartupStep,
};
pub(crate) use worker::run_reresolution_worker;

#[cfg(test)]
use command::DebugSetFunctionBreakpointsRequest;
#[cfg(test)]
use installation::{
    reresolve_function_breakpoints, validate_function_name, FunctionBreakpointRegistrations,
    FunctionLocation,
};
#[cfg(test)]
use worker::{resume_after_hidden_continue_pause, HiddenPauseSettleContext};

#[cfg(test)]
#[path = "debug_cdp/tests/debug_cdp_function_breakpoint_real_integration_tests.rs"]
mod real_integration_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugFunctionBreakpoint, DebugFunctionBreakpointVerification};
    use serde_json::{json, Value};
    use std::cell::Cell;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, Receiver, SyncSender};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    #[derive(Default)]
    struct FakeCdp {
        calls: Vec<(String, Value)>,
        replies: VecDeque<Result<Value, String>>,
    }

    impl FunctionBreakpointCdp for FakeCdp {
        fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.push((method.to_string(), params));
            self.replies.pop_front().unwrap_or(Ok(json!({})))
        }
    }

    struct WorkerFakeCdp {
        calls: Arc<Mutex<Vec<(String, Value)>>>,
        replies: VecDeque<Result<Value, String>>,
        request_entered: SyncSender<String>,
        continue_request: Option<Receiver<()>>,
        blocked_method: Option<&'static str>,
    }

    impl FunctionBreakpointCdp for WorkerFakeCdp {
        fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
            self.calls
                .lock()
                .expect("worker fake calls lock")
                .push((method.to_string(), params));
            let _ = self.request_entered.try_send(method.to_string());
            if self.blocked_method == Some(method) {
                self.continue_request
                    .as_ref()
                    .expect("blocked request receiver")
                    .recv_timeout(Duration::from_millis(500))
                    .expect("blocked request released");
            }
            self.replies.pop_front().unwrap_or(Ok(json!({})))
        }
    }

    fn unresolved_worker_state() -> Arc<FunctionBreakpointSessionState> {
        let state = Arc::new(FunctionBreakpointSessionState::default());
        state
            .registrations
            .lock()
            .expect("registrations lock")
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        state
    }

    fn captured_worker_state() -> Arc<FunctionBreakpointSessionState> {
        let state = unresolved_worker_state();
        state.desired_generation.store(1, Ordering::Release);
        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[]
            })),
            HiddenPauseCapture::Captured
        );
        state
    }

    fn spawn_worker(
        cdp: WorkerFakeCdp,
        state: Arc<FunctionBreakpointSessionState>,
        emit: Arc<dyn Fn(crate::debug_adapter::DebugEventPayload) + Send + Sync>,
        is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> (SyncSender<()>, JoinHandle<()>) {
        spawn_worker_with_fail_closed(cdp, state, emit, is_current, Arc::new(|| {}))
    }

    fn spawn_worker_with_fail_closed(
        cdp: WorkerFakeCdp,
        state: Arc<FunctionBreakpointSessionState>,
        emit: Arc<dyn Fn(crate::debug_adapter::DebugEventPayload) + Send + Sync>,
        is_current: Arc<dyn Fn() -> bool + Send + Sync>,
        fail_closed: Arc<dyn Fn() + Send + Sync>,
    ) -> (SyncSender<()>, JoinHandle<()>) {
        let (trigger, triggers) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            run_reresolution_worker(
                triggers,
                cdp,
                state,
                crate::debug_cdp::transport::empty_shared_state_for_test(),
                emit,
                is_current,
                fail_closed,
            );
        });
        (trigger, worker)
    }

    fn join_worker_with_timeout(worker: JoinHandle<()>) {
        let (joined_tx, joined_rx) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let result = worker.join();
            let _ = joined_tx.send(result);
        });
        assert!(joined_rx
            .recv_timeout(Duration::from_millis(500))
            .expect("worker joined before timeout")
            .is_ok());
    }

    fn breakpoint(id: &str, function_name: &str, enabled: bool) -> DebugFunctionBreakpoint {
        DebugFunctionBreakpoint {
            id: id.to_string(),
            function_name: function_name.to_string(),
            enabled,
        }
    }

    #[test]
    fn validates_the_same_closed_identifier_path_grammar_at_the_rust_boundary() {
        for name in ["render", "$start", "_private", "app.render", "a.b2.$call"] {
            assert!(validate_function_name(name).is_ok());
        }
        for name in [
            "",
            " render",
            "render ",
            "app..render",
            "app[render]",
            "app.render()",
            "app?.render",
            "app;process.exit()",
            "app\nrender",
            "app`render`",
            "1render",
            "éclair",
            "a.b.c.d.e.f.g.h.i",
        ] {
            assert!(validate_function_name(name).is_err());
        }
        assert!(validate_function_name(&"a".repeat(257)).is_err());
    }

    #[test]
    fn resolves_functions_without_serializing_values_and_registers_the_object_id() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:7"}})),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-1", "app.render", true)],
            || true,
        )
        .unwrap();

        assert_eq!(
            result,
            vec![DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true,
            }]
        );
        assert_eq!(
            cdp.calls,
            vec![
                (
                    "Runtime.evaluate".to_string(),
                    json!({
                        "expression":"app.render",
                        "silent":true,
                        "returnByValue":false,
                        "awaitPromise":false,
                        "throwOnSideEffect":true
                    }),
                ),
                (
                    "Debugger.setBreakpointOnFunctionCall".to_string(),
                    json!({"objectId":"function:7"}),
                ),
            ]
        );
    }

    #[test]
    fn reports_unresolved_and_disabled_names_as_unverified_without_registration() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([Ok(json!({
                "result":{"type":"undefined"},
                "exceptionDetails":{"text":"ReferenceError"}
            }))]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[
                breakpoint("fn-1", "missing", true),
                breakpoint("fn-2", "disabled", false),
            ],
            || true,
        )
        .unwrap();

        assert_eq!(
            result,
            vec![
                DebugFunctionBreakpointVerification {
                    id: "fn-1".to_string(),
                    verified: false,
                },
                DebugFunctionBreakpointVerification {
                    id: "fn-2".to_string(),
                    verified: false,
                },
            ]
        );
        assert_eq!(cdp.calls.len(), 1);
        assert_eq!(cdp.calls[0].0, "Runtime.evaluate");
        assert_eq!(
            registrations
                .unverified_by_logical_id
                .get("fn-1")
                .map(String::as_str),
            Some("missing")
        );
        assert!(!registrations.unverified_by_logical_id.contains_key("fn-2"));
    }

    #[test]
    fn reresolves_only_still_unverified_names_with_side_effects_forbidden() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:9"}})),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "app.render".to_string());
        registrations
            .by_logical_id
            .insert("fn-2".to_string(), "cdp-fn-2".to_string());

        let verification =
            reresolve_function_breakpoints(&mut cdp, &mut registrations, || true).unwrap();

        assert_eq!(
            verification,
            vec![DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true,
            }]
        );
        assert_eq!(
            cdp.calls,
            vec![
                (
                    "Runtime.evaluate".to_string(),
                    json!({
                        "expression":"app.render",
                        "silent":true,
                        "returnByValue":false,
                        "awaitPromise":false,
                        "throwOnSideEffect":true
                    }),
                ),
                (
                    "Debugger.setBreakpointOnFunctionCall".to_string(),
                    json!({"objectId":"function:9"}),
                ),
            ]
        );
        assert!(registrations.unverified_by_logical_id.is_empty());
        assert_eq!(
            registrations.by_logical_id.get("fn-1").map(String::as_str),
            Some("cdp-fn-1")
        );
    }

    #[test]
    fn reresolution_rechecks_authority_after_evaluation_before_installing() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([Ok(
                json!({"result":{"type":"function","objectId":"function:9"}}),
            )]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        let checks = Cell::new(0);

        let result = reresolve_function_breakpoints(&mut cdp, &mut registrations, || {
            let current = checks.get();
            checks.set(current + 1);
            current == 0
        });

        assert!(result.is_err());
        assert_eq!(cdp.calls.len(), 1);
        assert_eq!(cdp.calls[0].0, "Runtime.evaluate");
        assert!(registrations.by_logical_id.is_empty());
        assert!(registrations.unverified_by_logical_id.contains_key("fn-1"));
    }

    #[test]
    fn reresolution_tracks_an_install_before_rejecting_stale_publication() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:9"}})),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        let checks = Cell::new(0);

        let result = reresolve_function_breakpoints(&mut cdp, &mut registrations, || {
            let current = checks.get();
            checks.set(current + 1);
            current < 3
        });

        assert!(result.is_err());
        assert_eq!(cdp.calls.len(), 2);
        assert_eq!(
            registrations.by_logical_id.get("fn-1").map(String::as_str),
            Some("cdp-fn-1")
        );
        assert!(registrations.unverified_by_logical_id.is_empty());
    }

    #[test]
    fn unresolved_names_remain_eligible_for_late_dynamic_scripts() {
        let mut registrations = FunctionBreakpointRegistrations::default();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());

        for _ in 0..256 {
            assert!(registrations.reserve_reresolution_sweep());
        }

        replace_function_breakpoints(
            &mut FakeCdp::default(),
            &mut registrations,
            &[breakpoint("fn-2", "next", true)],
            || true,
        )
        .unwrap();
        assert!(registrations.reserve_reresolution_sweep());
    }

    #[test]
    fn hidden_continue_captures_only_an_exact_step_pause_without_user_breakpoints() {
        let state = FunctionBreakpointSessionState::default();
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());

        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"exception",
                "callFrames":[]
            })),
            HiddenPauseCapture::PassThrough
        );

        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":["user-line"],
                "callFrames":[]
            })),
            HiddenPauseCapture::PassThrough
        );

        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[]
            })),
            HiddenPauseCapture::Captured
        );
    }

    #[test]
    fn hidden_step_entry_and_cancel_propagate_poison_instead_of_authorizing_resume() {
        let registrations_poisoned = FunctionBreakpointSessionState::default();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = registrations_poisoned.registrations.lock().unwrap();
            panic!("poison hidden-step registrations");
        }));
        assert_eq!(registrations_poisoned.begin_hidden_continue_step(), Err(()));

        let pending_poisoned = FunctionBreakpointSessionState::default();
        pending_poisoned
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = pending_poisoned.hidden_continue_pending.lock().unwrap();
            panic!("poison hidden-step pending receipt");
        }));
        assert_eq!(pending_poisoned.begin_hidden_continue_step(), Err(()));
        assert_eq!(pending_poisoned.cancel_hidden_continue_step(), Err(()));

        let pause_poisoned = FunctionBreakpointSessionState::default();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = pause_poisoned.hidden_continue_pause.lock().unwrap();
            panic!("poison hidden-step captured pause");
        }));
        assert_eq!(pause_poisoned.cancel_hidden_continue_step(), Err(()));
    }

    #[test]
    fn duplicate_hidden_continue_is_busy_instead_of_authorizing_a_plain_resume() {
        let state = FunctionBreakpointSessionState::default();
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());

        assert_eq!(state.begin_hidden_continue_step(), Ok(true));
        assert_eq!(state.begin_hidden_continue_step(), Err(()));
        assert!(state.hidden_continue_pending.lock().unwrap().is_some());
    }

    #[test]
    fn exact_watch_bootstrap_is_single_use_step_over_for_the_bound_entry_script() {
        let state = FunctionBreakpointSessionState::default();
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "globalThis.render".to_string());
        state.desired_generation.store(1, Ordering::Release);
        state
            .bind_exact_watch_entry_url("file:///workspace/server.js".to_string())
            .unwrap();
        state
            .observe_script_parsed(&json!({
                "url":"file:///workspace/server.js",
                "scriptId":"entry-script"
            }))
            .unwrap();
        let entry_pause = json!({
            "reason":"Break on start",
            "callFrames":[{
                "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0}
            }]
        });

        assert_eq!(
            state.begin_hidden_startup_step(&entry_pause),
            Ok(HiddenStartupStep::StepOver)
        );
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":95}
                }]
            })),
            HiddenPauseCapture::Captured
        );
        assert_eq!(state.begin_hidden_startup_step(&entry_pause), Err(()));
    }

    #[test]
    fn exact_watch_bootstrap_revokes_foreign_step_or_mutated_generation_but_passes_user_stops() {
        fn armed_state() -> FunctionBreakpointSessionState {
            let state = FunctionBreakpointSessionState::default();
            state
                .registrations
                .lock()
                .unwrap()
                .unverified_by_logical_id
                .insert("fn-1".to_string(), "globalThis.render".to_string());
            state.desired_generation.store(1, Ordering::Release);
            state
                .bind_exact_watch_entry_url("file:///workspace/server.js".to_string())
                .unwrap();
            state
                .observe_script_parsed(&json!({
                    "url":"file:///workspace/server.js",
                    "scriptId":"entry-script"
                }))
                .unwrap();
            assert_eq!(
                state.begin_hidden_startup_step(&json!({
                    "reason":"Break on start",
                    "callFrames":[{
                        "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0}
                    }]
                })),
                Ok(HiddenStartupStep::StepOver)
            );
            state
        }

        let foreign = armed_state();
        assert_eq!(
            foreign.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{"scriptId":"foreign-script","lineNumber":10,"columnNumber":0}
                }]
            })),
            HiddenPauseCapture::Revoke
        );

        let mutated = armed_state();
        mutated.desired_generation.store(2, Ordering::Release);
        assert_eq!(
            mutated.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":95}
                }]
            })),
            HiddenPauseCapture::Revoke
        );

        let exception = armed_state();
        assert_eq!(
            exception.capture_hidden_continue_pause(&json!({
                "reason":"exception",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":95}
                }]
            })),
            HiddenPauseCapture::PassThrough
        );

        let line_breakpoint = armed_state();
        assert_eq!(
            line_breakpoint.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":["user-line"],
                "callFrames":[{
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":95}
                }]
            })),
            HiddenPauseCapture::PassThrough
        );
    }

    fn ordinary_startup_state() -> FunctionBreakpointSessionState {
        let state = FunctionBreakpointSessionState::default();
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "globalThis.render".to_string());
        state.desired_generation.store(1, Ordering::Release);
        state
            .bind_exact_startup_entry_url("file:///workspace/server.js".to_string())
            .unwrap();
        state
            .observe_script_parsed(&json!({
                "url":"file:///workspace/server.js",
                "scriptId":"entry-script"
            }))
            .unwrap();
        assert_eq!(
            state.begin_hidden_startup_step(&json!({
                "reason":"Break on start",
                "callFrames":[{
                    "callFrameId":"entry-frame",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0}
                }]
            })),
            Ok(HiddenStartupStep::StepInto)
        );
        state
    }

    #[test]
    fn ordinary_startup_continue_location_is_exact_single_use_and_user_stops_pass_through() {
        let exact = ordinary_startup_state();
        assert_eq!(
            exact.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[
                    {"location":{"scriptId":"node-internal","lineNumber":151,"columnNumber":4}},
                    {
                        "callFrameId":"entry-frame",
                        "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":13}
                    }
                ]
            })),
            HiddenPauseCapture::Captured
        );
        let pause = exact.take_hidden_continue_pause().unwrap().unwrap();
        assert_eq!(
            exact.rearm_ordinary_startup_step(&pause),
            Ok(state::OrdinaryStartupRearm::ContinueToNextLocation)
        );
        exact.bind_pending_ordinary_startup_location(0, 45).unwrap();
        assert_eq!(
            exact.capture_hidden_continue_pause(&json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"entry-frame",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                }]
            })),
            HiddenPauseCapture::Captured
        );

        for pause in [
            json!({
                "reason":"exception",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"entry-frame",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                }]
            }),
            json!({
                "reason":"other",
                "hitBreakpoints":["user-line-breakpoint"],
                "callFrames":[{
                    "callFrameId":"entry-frame",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                }]
            }),
            json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"foreign-frame",
                    "functionLocation":{"scriptId":"foreign-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"foreign-script","lineNumber":0,"columnNumber":45}
                }]
            }),
            json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"different-invocation",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":3,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                }]
            }),
            json!({
                "reason":"other",
                "hitBreakpoints":[],
                "callFrames":[
                    {
                        "callFrameId":"ambiguous-a",
                        "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                    },
                    {
                        "callFrameId":"ambiguous-b",
                        "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":45}
                    }
                ]
            }),
        ] {
            let state = ordinary_startup_state();
            assert_eq!(
                state.capture_hidden_continue_pause(&json!({
                    "reason":"step",
                    "hitBreakpoints":[],
                    "callFrames":[{
                        "callFrameId":"entry-frame",
                        "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                        "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":13}
                    }]
                })),
                HiddenPauseCapture::Captured
            );
            let hidden = state.take_hidden_continue_pause().unwrap().unwrap();
            assert_eq!(
                state.rearm_ordinary_startup_step(&hidden),
                Ok(state::OrdinaryStartupRearm::ContinueToNextLocation)
            );
            state.bind_pending_ordinary_startup_location(0, 45).unwrap();
            assert_eq!(
                state.capture_hidden_continue_pause(&pause),
                HiddenPauseCapture::PassThrough
            );
        }
    }

    #[test]
    fn ordinary_startup_budget_exhaustion_fails_closed_without_silent_resume() {
        let state = ordinary_startup_state();
        state.exhaust_pending_ordinary_startup_steps_for_test();
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "callFrameId":"entry-frame",
                    "functionLocation":{"scriptId":"entry-script","lineNumber":0,"columnNumber":0},
                    "location":{"scriptId":"entry-script","lineNumber":0,"columnNumber":13}
                }]
            })),
            HiddenPauseCapture::Captured
        );
        let shared = crate::debug_cdp::transport::empty_shared_state_for_test();
        let failed_closed = AtomicBool::new(false);
        let mut cdp = FakeCdp::default();

        resume_after_hidden_continue_pause(
            &mut cdp,
            &state,
            &[],
            HiddenPauseSettleContext {
                shared: &shared,
                emit: &|_| {},
                is_current: &|| true,
                sweep_revision: 1,
                sweep_generation: 1,
                fail_closed: &|| failed_closed.store(true, Ordering::Release),
            },
        );

        assert!(failed_closed.load(Ordering::Acquire));
        assert!(cdp.calls.is_empty());
    }

    #[test]
    fn exact_watch_entry_script_identity_cannot_be_rebound_within_one_target() {
        let state = FunctionBreakpointSessionState::default();
        state
            .bind_exact_watch_entry_url("file:///workspace/server.js".to_string())
            .unwrap();
        state
            .observe_script_parsed(&json!({
                "url":"file:///workspace/server.js",
                "scriptId":"entry-script"
            }))
            .unwrap();

        assert!(state
            .observe_script_parsed(&json!({
                "url":"file:///workspace/server.js",
                "scriptId":"replacement-script"
            }))
            .is_err());
    }

    #[test]
    fn policy_removal_between_candidate_resolution_and_hidden_settle_never_publishes_stale_stop() {
        let state = FunctionBreakpointSessionState::default();
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "globalThis.render".to_string());
        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "functionLocation":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":20
                    },
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":95
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .clear();
        state.revision.store(2, Ordering::Release);
        let shared = crate::debug_cdp::transport::empty_shared_state_for_test();
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_callback = Arc::clone(&emitted);
        let failed_closed = AtomicBool::new(false);
        let mut cdp = FakeCdp::default();

        resume_after_hidden_continue_pause(
            &mut cdp,
            &state,
            &[FunctionLocation {
                script_id: "entry-script".to_string(),
                line_number: 0,
                column_number: 20,
            }],
            HiddenPauseSettleContext {
                shared: &shared,
                emit: &move |payload| emitted_for_callback.lock().unwrap().push(payload),
                is_current: &|| true,
                sweep_revision: 1,
                sweep_generation: 1,
                fail_closed: &|| failed_closed.store(true, Ordering::Release),
            },
        );

        assert_eq!(cdp.calls, vec![("Debugger.resume".to_string(), json!({}))]);
        assert!(emitted.lock().unwrap().is_empty());
        assert!(!failed_closed.load(Ordering::Acquire));
    }

    #[test]
    fn target_authority_loss_before_hidden_settle_fails_closed_without_pause_or_cdp_mutation() {
        let state = FunctionBreakpointSessionState::default();
        state.desired_generation.store(1, Ordering::Release);
        state
            .registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "globalThis.render".to_string());
        assert!(state.begin_hidden_continue_step().unwrap());
        assert_eq!(
            state.capture_hidden_continue_pause(&json!({
                "reason":"step",
                "hitBreakpoints":[],
                "callFrames":[{
                    "location":{
                        "scriptId":"entry-script",
                        "lineNumber":0,
                        "columnNumber":95
                    }
                }]
            })),
            HiddenPauseCapture::Captured
        );
        let shared = crate::debug_cdp::transport::empty_shared_state_for_test();
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_callback = Arc::clone(&emitted);
        let failed_closed = AtomicBool::new(false);
        let mut cdp = FakeCdp::default();

        resume_after_hidden_continue_pause(
            &mut cdp,
            &state,
            &[],
            HiddenPauseSettleContext {
                shared: &shared,
                emit: &move |payload| emitted_for_callback.lock().unwrap().push(payload),
                is_current: &|| false,
                sweep_revision: 1,
                sweep_generation: 1,
                fail_closed: &|| failed_closed.store(true, Ordering::Release),
            },
        );

        assert!(failed_closed.load(Ordering::Acquire));
        assert!(cdp.calls.is_empty());
        assert!(emitted.lock().unwrap().is_empty());
    }

    #[test]
    fn resolved_hidden_pause_inventory_uncertainty_fails_closed_without_hanging_target() {
        fn captured_state() -> FunctionBreakpointSessionState {
            let state = FunctionBreakpointSessionState::default();
            state.desired_generation.store(1, Ordering::Release);
            state
                .registrations
                .lock()
                .unwrap()
                .unverified_by_logical_id
                .insert("fn-1".to_string(), "globalThis.render".to_string());
            assert!(state.begin_hidden_continue_step().unwrap());
            assert_eq!(
                state.capture_hidden_continue_pause(&json!({
                    "reason":"step",
                    "hitBreakpoints":[],
                    "callFrames":[{
                        "functionLocation":{
                            "scriptId":"entry-script",
                            "lineNumber":0,
                            "columnNumber":20
                        },
                        "location":{
                            "scriptId":"entry-script",
                            "lineNumber":0,
                            "columnNumber":95
                        }
                    }]
                })),
                HiddenPauseCapture::Captured
            );
            state
        }

        fn settle(
            state: &FunctionBreakpointSessionState,
            shared: &Mutex<crate::debug_cdp::transport::CdpShared>,
            resolved_current_function: bool,
            resume_fails: bool,
        ) -> (FakeCdp, bool, Vec<crate::debug_adapter::DebugEventPayload>) {
            let emitted = Arc::new(Mutex::new(Vec::new()));
            let emitted_for_callback = Arc::clone(&emitted);
            let failed_closed = AtomicBool::new(false);
            let mut cdp = FakeCdp {
                replies: resume_fails
                    .then(|| Err("resume failed".to_string()))
                    .into_iter()
                    .collect(),
                ..FakeCdp::default()
            };
            let resolved_locations = resolved_current_function
                .then(|| FunctionLocation {
                    script_id: "entry-script".to_string(),
                    line_number: 0,
                    column_number: 20,
                })
                .into_iter()
                .collect::<Vec<_>>();
            resume_after_hidden_continue_pause(
                &mut cdp,
                state,
                &resolved_locations,
                HiddenPauseSettleContext {
                    shared,
                    emit: &move |payload| emitted_for_callback.lock().unwrap().push(payload),
                    is_current: &|| true,
                    sweep_revision: 1,
                    sweep_generation: 1,
                    fail_closed: &|| failed_closed.store(true, Ordering::Release),
                },
            );
            let events = emitted.lock().unwrap().clone();
            (cdp, failed_closed.load(Ordering::Acquire), events)
        }

        let exhausted = Mutex::new(
            crate::debug_cdp::transport::exhausted_pause_generation_shared_state_for_test(),
        );
        let (cdp, failed_closed, events) = settle(&captured_state(), &exhausted, true, false);
        assert!(failed_closed);
        assert!(cdp.calls.is_empty());
        assert!(events.is_empty());

        let poisoned = crate::debug_cdp::transport::empty_shared_state_for_test();
        let poisoned_for_panic = Arc::clone(&poisoned);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = poisoned_for_panic.lock().unwrap();
            panic!("poison hidden-pause shared state");
        }));
        let (cdp, failed_closed, events) =
            settle(&captured_state(), poisoned.as_ref(), true, false);
        assert!(failed_closed);
        assert!(cdp.calls.is_empty());
        assert!(events.is_empty());

        let exhausted = Mutex::new(
            crate::debug_cdp::transport::exhausted_pause_generation_shared_state_for_test(),
        );
        let (cdp, failed_closed, events) = settle(&captured_state(), &exhausted, false, true);
        assert!(failed_closed);
        assert_eq!(cdp.calls, vec![("Debugger.resume".to_string(), json!({}))]);
        assert!(events.is_empty());

        let poisoned = crate::debug_cdp::transport::empty_shared_state_for_test();
        let poisoned_for_panic = Arc::clone(&poisoned);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = poisoned_for_panic.lock().unwrap();
            panic!("poison fallback hidden-pause shared state");
        }));
        let (cdp, failed_closed, events) =
            settle(&captured_state(), poisoned.as_ref(), false, true);
        assert!(failed_closed);
        assert!(cdp.calls.is_empty());
        assert!(events.is_empty());
    }

    #[test]
    fn worker_collapses_a_script_parsed_storm_into_one_debounced_sweep() {
        let state = unresolved_worker_state();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::sync_channel(4);
        let cdp = WorkerFakeCdp {
            calls: Arc::clone(&calls),
            replies: VecDeque::from([Ok(json!({"result":{"type":"undefined"}}))]),
            request_entered: entered_tx,
            continue_request: None,
            blocked_method: None,
        };
        let (trigger, worker) = spawn_worker(cdp, state, Arc::new(|_| {}), Arc::new(|| true));

        trigger.send(()).expect("initial trigger");
        for _ in 0..32 {
            let _ = trigger.try_send(());
        }
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("debounced sweep request"),
            "Runtime.evaluate"
        );
        drop(trigger);
        join_worker_with_timeout(worker);

        let calls = calls.lock().expect("worker fake calls lock");
        assert_eq!(
            calls
                .iter()
                .filter(|(method, _)| method == "Runtime.evaluate")
                .count(),
            1
        );
    }

    #[test]
    fn worker_suppresses_a_stale_sweep_when_replacement_bumps_revision_mid_evaluation() {
        let state = unresolved_worker_state();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_worker = Arc::clone(&emitted);
        let (entered_tx, entered_rx) = mpsc::sync_channel(4);
        let (continue_tx, continue_rx) = mpsc::sync_channel(1);
        let cdp = WorkerFakeCdp {
            calls: Arc::clone(&calls),
            replies: VecDeque::from([Ok(
                json!({"result":{"type":"function","objectId":"function:9"}}),
            )]),
            request_entered: entered_tx,
            continue_request: Some(continue_rx),
            blocked_method: Some("Runtime.evaluate"),
        };
        let (trigger, worker) = spawn_worker(
            cdp,
            Arc::clone(&state),
            Arc::new(move |payload| {
                emitted_for_worker
                    .lock()
                    .expect("emitted payload lock")
                    .push(payload);
            }),
            Arc::new(|| true),
        );

        trigger.send(()).expect("initial trigger");
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("evaluation entered"),
            "Runtime.evaluate"
        );
        let _publication = state
            .publication
            .try_lock()
            .expect("publication lock released");
        let mut registrations = state
            .registrations
            .try_lock()
            .expect("registrations lock released during CDP");
        registrations.unverified_by_logical_id.clear();
        registrations
            .unverified_by_logical_id
            .insert("fn-2".to_string(), "replacement".to_string());
        state.revision.fetch_add(1, Ordering::AcqRel);
        drop(registrations);
        continue_tx.send(()).expect("release evaluation");
        drop(trigger);
        join_worker_with_timeout(worker);

        let calls = calls.lock().expect("worker fake calls lock");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "Runtime.evaluate");
        assert!(emitted.lock().expect("emitted payload lock").is_empty());
    }

    #[test]
    fn worker_joins_promptly_when_the_trigger_sender_is_dropped() {
        let state = unresolved_worker_state();
        let (entered_tx, _entered_rx) = mpsc::sync_channel(1);
        let cdp = WorkerFakeCdp {
            calls: Arc::new(Mutex::new(Vec::new())),
            replies: VecDeque::new(),
            request_entered: entered_tx,
            continue_request: None,
            blocked_method: None,
        };
        let (trigger, worker) = spawn_worker(cdp, state, Arc::new(|_| {}), Arc::new(|| true));

        drop(trigger);
        join_worker_with_timeout(worker);
    }

    #[test]
    fn captured_worker_pause_fails_closed_on_authority_loss_or_poisoned_invariants() {
        fn assert_fails_closed(
            state: Arc<FunctionBreakpointSessionState>,
            is_current: Arc<dyn Fn() -> bool + Send + Sync>,
        ) {
            let (failed_closed_tx, failed_closed_rx) = mpsc::sync_channel(1);
            let (entered_tx, _entered_rx) = mpsc::sync_channel(1);
            let cdp = WorkerFakeCdp {
                calls: Arc::new(Mutex::new(Vec::new())),
                replies: VecDeque::new(),
                request_entered: entered_tx,
                continue_request: None,
                blocked_method: None,
            };
            let (trigger, worker) = spawn_worker_with_fail_closed(
                cdp,
                state,
                Arc::new(|_| panic!("poisoned worker must not emit")),
                is_current,
                Arc::new(move || {
                    let _ = failed_closed_tx.try_send(());
                }),
            );
            trigger.send(()).expect("resolution trigger");
            failed_closed_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("worker must fail closed before its trigger disconnects");
            drop(trigger);
            join_worker_with_timeout(worker);
        }

        assert_fails_closed(captured_worker_state(), Arc::new(|| false));

        let publication_poisoned = captured_worker_state();
        let publication_for_panic = Arc::clone(&publication_poisoned);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = publication_for_panic.publication.lock().unwrap();
            panic!("poison function-breakpoint publication");
        }));
        assert_fails_closed(publication_poisoned, Arc::new(|| true));

        let registrations_poisoned = captured_worker_state();
        let registrations_for_panic = Arc::clone(&registrations_poisoned);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = registrations_for_panic.registrations.lock().unwrap();
            panic!("poison function-breakpoint registrations");
        }));
        assert_fails_closed(registrations_poisoned, Arc::new(|| true));

        let hidden_pause_poisoned = captured_worker_state();
        let hidden_pause_for_panic = Arc::clone(&hidden_pause_poisoned);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _guard = hidden_pause_for_panic.hidden_continue_pause.lock().unwrap();
            panic!("poison function-breakpoint hidden pause");
        }));
        assert_fails_closed(hidden_pause_poisoned, Arc::new(|| true));
    }

    #[test]
    fn worker_revocation_after_install_removes_the_unpublished_cdp_breakpoint() {
        let state = unresolved_worker_state();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let allowed = Arc::new(AtomicBool::new(true));
        let allowed_for_worker = Arc::clone(&allowed);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_worker = Arc::clone(&emitted);
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let (entered_tx, entered_rx) = mpsc::sync_channel(4);
        let (continue_tx, continue_rx) = mpsc::sync_channel(1);
        let cdp = WorkerFakeCdp {
            calls: Arc::clone(&calls),
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:9"}})),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
                Ok(json!({})),
            ]),
            request_entered: entered_tx,
            continue_request: Some(continue_rx),
            blocked_method: Some("Debugger.setBreakpointOnFunctionCall"),
        };
        let (trigger, worker) = spawn_worker_with_fail_closed(
            cdp,
            Arc::clone(&state),
            Arc::new(move |payload| {
                emitted_for_worker
                    .lock()
                    .expect("emitted payload lock")
                    .push(payload);
            }),
            Arc::new(move || allowed_for_worker.load(Ordering::Acquire)),
            Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
        );

        trigger.send(()).expect("initial trigger");
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("evaluation entered"),
            "Runtime.evaluate"
        );
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("install entered"),
            "Debugger.setBreakpointOnFunctionCall"
        );
        allowed.store(false, Ordering::Release);
        continue_tx.send(()).expect("release install");
        drop(trigger);
        join_worker_with_timeout(worker);

        let calls = calls.lock().expect("worker fake calls lock");
        assert_eq!(
            calls
                .iter()
                .map(|(method, _)| method.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Runtime.evaluate",
                "Debugger.setBreakpointOnFunctionCall",
                "Debugger.removeBreakpoint"
            ]
        );
        assert_eq!(calls[2].1, json!({"breakpointId":"cdp-fn-1"}));
        assert!(emitted.lock().expect("emitted payload lock").is_empty());
        assert!(state
            .registrations
            .lock()
            .expect("registrations lock")
            .by_logical_id
            .is_empty());
        assert!(failed_closed.load(Ordering::Acquire));
    }

    #[test]
    fn worker_fails_closed_when_an_async_install_ack_is_uncertain() {
        let state = unresolved_worker_state();
        let failed_closed = Arc::new(AtomicBool::new(false));
        let failed_closed_for_worker = Arc::clone(&failed_closed);
        let (entered_tx, entered_rx) = mpsc::sync_channel(4);
        let cdp = WorkerFakeCdp {
            calls: Arc::new(Mutex::new(Vec::new())),
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:9"}})),
                Err("install acknowledgement timeout".to_string()),
            ]),
            request_entered: entered_tx,
            continue_request: None,
            blocked_method: None,
        };
        let (trigger, worker) = spawn_worker_with_fail_closed(
            cdp,
            state,
            Arc::new(|_| {}),
            Arc::new(|| true),
            Arc::new(move || failed_closed_for_worker.store(true, Ordering::Release)),
        );

        trigger.send(()).expect("resolution trigger");
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("evaluation entered"),
            "Runtime.evaluate"
        );
        assert_eq!(
            entered_rx
                .recv_timeout(Duration::from_millis(500))
                .expect("install entered"),
            "Debugger.setBreakpointOnFunctionCall"
        );
        drop(trigger);
        join_worker_with_timeout(worker);

        assert!(failed_closed.load(Ordering::Acquire));
    }

    #[test]
    fn generation_admission_rejects_same_or_older_state_before_revision_mutation() {
        let state = FunctionBreakpointSessionState::default();
        assert!(state.admit_new_generation(1).is_ok());
        assert!(state.admit_new_generation(2).is_ok());
        let revision_before_stale = state.revision.load(Ordering::Acquire);
        let mut cdp = FakeCdp::default();

        for delayed_generation in [2, 1] {
            let _publication = state.publication.lock().unwrap();
            let result = state
                .admit_new_generation(delayed_generation)
                .and_then(|()| {
                    let mut registrations = state.registrations.lock().unwrap();
                    replace_function_breakpoints(
                        &mut cdp,
                        &mut registrations,
                        &[breakpoint("stale", "app.stale", true)],
                        || true,
                    )
                    .map(|_| ())
                });
            assert!(result.is_err());
        }
        assert_eq!(state.desired_generation.load(Ordering::Acquire), 2);
        assert_eq!(
            state.revision.load(Ordering::Acquire),
            revision_before_stale
        );
        assert!(cdp.calls.is_empty());
        assert!(state.registrations.lock().unwrap().by_logical_id.is_empty());
        assert!(state.admit_new_generation(3).is_ok());
    }

    #[test]
    fn startup_verification_receipt_publishes_once_only_for_exact_revision_generation_and_owner() {
        fn verification() -> Vec<DebugFunctionBreakpointVerification> {
            vec![DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true,
            }]
        }

        let state = FunctionBreakpointSessionState::default();
        state.revision.store(2, Ordering::Release);
        state.desired_generation.store(1, Ordering::Release);
        let published = Cell::new(0);
        FunctionBreakpointVerificationReceipt::new(2, 1, verification())
            .publish_if_current(&state, &|| true, |generation, breakpoints| {
                assert_eq!(generation, 1);
                assert_eq!(breakpoints, verification());
                published.set(published.get() + 1);
                Ok(())
            })
            .expect("exact receipt publishes");
        assert_eq!(published.get(), 1);

        for (revision, generation, owner_epoch) in [(3, 1, 1), (2, 2, 1), (2, 1, 3)] {
            let emitted = Cell::new(false);
            let captured_owner_epoch = 1;
            let error =
                FunctionBreakpointVerificationReceipt::new(revision, generation, verification())
                    .publish_if_current(&state, &|| owner_epoch == captured_owner_epoch, |_, _| {
                        emitted.set(true);
                        Ok(())
                    })
                    .expect_err("stale receipt rejected");
            assert!(error.contains("stale"));
            assert!(!emitted.get());
        }
    }

    #[test]
    fn function_verification_event_has_the_exact_frontend_wire_shape() {
        let payload = crate::debug_adapter::DebugEventPayload::FunctionBreakpointsVerified {
            generation: 7,
            breakpoints: vec![DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true,
            }],
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({
                "kind":"functionBreakpointsVerified",
                "generation":7,
                "breakpoints":[{"id":"fn-1","verified":true}]
            })
        );
    }

    #[test]
    fn replacement_removes_previous_cdp_ids_before_resolving_the_new_set() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({})),
                Ok(json!({"result":{"type":"function","objectId":"function:8"}})),
                Ok(json!({"breakpointId":"cdp-fn-2"})),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::from([("fn-old", "cdp-fn-old")]);
        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-2", "next", true)],
            || true,
        )
        .unwrap();

        assert!(result[0].verified);
        assert_eq!(cdp.calls[0].0, "Debugger.removeBreakpoint");
        assert_eq!(cdp.calls[0].1, json!({"breakpointId":"cdp-fn-old"}));
        assert_eq!(cdp.calls[1].0, "Runtime.evaluate");
    }

    #[test]
    fn removal_failure_keeps_the_cdp_id_tracked_for_a_later_replacement() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([Err("transport timeout".to_string())]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::from([("fn-old", "cdp-fn-old")]);

        let result = replace_function_breakpoints(&mut cdp, &mut registrations, &[], || true);

        assert!(result.is_err());
        assert_eq!(
            registrations
                .by_logical_id
                .get("fn-old")
                .map(String::as_str),
            Some("cdp-fn-old")
        );
    }

    #[test]
    fn install_transport_failure_is_not_reported_as_an_unverified_success() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:7"}})),
                Err("transport timeout".to_string()),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();

        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-1", "render", true)],
            || true,
        );

        assert_eq!(result, Err("transport timeout".to_string()));
        assert!(registrations.by_logical_id.is_empty());
        assert!(registrations.unverified_by_logical_id.is_empty());
    }

    #[test]
    fn authority_flip_after_install_keeps_the_cdp_id_tracked() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([
                Ok(json!({"result":{"type":"function","objectId":"function:7"}})),
                Ok(json!({"breakpointId":"cdp-fn-1"})),
            ]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        let checks = Cell::new(0);

        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-1", "render", true)],
            || {
                let current = checks.get();
                checks.set(current + 1);
                current < 3
            },
        );

        assert!(result.is_err());
        assert_eq!(
            registrations.by_logical_id.get("fn-1").map(String::as_str),
            Some("cdp-fn-1")
        );

        replace_function_breakpoints(&mut cdp, &mut registrations, &[], || true)
            .expect("tracked stale install remains removable");
        assert_eq!(
            cdp.calls.last(),
            Some(&(
                "Debugger.removeBreakpoint".to_string(),
                json!({"breakpointId":"cdp-fn-1"})
            ))
        );
        assert!(registrations.by_logical_id.is_empty());
    }

    #[test]
    fn stale_authority_stops_before_each_cdp_mutation() {
        let mut cdp = FakeCdp::default();
        let mut registrations = FunctionBreakpointRegistrations::default();
        assert!(replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-1", "render", true)],
            || false,
        )
        .is_err());
        assert!(cdp.calls.is_empty());
    }

    #[test]
    fn authority_is_rechecked_after_each_cdp_acknowledgement() {
        let mut cdp = FakeCdp {
            replies: VecDeque::from([Ok(
                json!({"result":{"type":"function","objectId":"function:7"}}),
            )]),
            ..FakeCdp::default()
        };
        let mut registrations = FunctionBreakpointRegistrations::default();
        let checks = Cell::new(0);
        let result = replace_function_breakpoints(
            &mut cdp,
            &mut registrations,
            &[breakpoint("fn-1", "render", true)],
            || {
                let current = checks.get();
                checks.set(current + 1);
                current == 0
            },
        );
        assert!(result.is_err());
        assert_eq!(cdp.calls.len(), 1);
        assert_eq!(cdp.calls[0].0, "Runtime.evaluate");
    }

    #[test]
    fn command_request_is_closed_and_revalidates_names() {
        let valid = json!({
            "rootPath":"/workspace",
            "sessionId":7,
            "generation":1,
            "breakpoints":[{"id":"fn-1","functionName":"app.render","enabled":true}]
        });
        let request =
            serde_json::from_value::<DebugSetFunctionBreakpointsRequest>(valid.clone()).unwrap();
        assert!(request.validate().is_ok());

        for missing in ["rootPath", "sessionId", "generation", "breakpoints"] {
            let mut candidate = valid.clone();
            candidate.as_object_mut().unwrap().remove(missing);
            assert!(
                serde_json::from_value::<DebugSetFunctionBreakpointsRequest>(candidate).is_err()
            );
        }
        let mut injected = valid.clone();
        injected["breakpoints"][0]["functionName"] = json!("app.render()");
        let request =
            serde_json::from_value::<DebugSetFunctionBreakpointsRequest>(injected).unwrap();
        assert!(request.validate().is_err());
        let mut unknown = valid;
        unknown["unexpected"] = json!(true);
        assert!(serde_json::from_value::<DebugSetFunctionBreakpointsRequest>(unknown).is_err());
    }
}
