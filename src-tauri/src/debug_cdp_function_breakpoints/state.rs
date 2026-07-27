use super::installation::FunctionBreakpointRegistrations;
use crate::debug_adapter::DebugFunctionBreakpointVerification;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

const MAX_ORDINARY_STARTUP_RERESOLUTION_STEPS: u16 = 64;

pub(crate) struct FunctionBreakpointSessionState {
    pub(crate) registrations: Mutex<FunctionBreakpointRegistrations>,
    pub(crate) revision: AtomicU64,
    pub(crate) desired_generation: AtomicU64,
    pub(crate) publication: Mutex<()>,
    pub(super) hidden_continue_pause: Mutex<Option<HiddenContinuePause>>,
    pub(super) hidden_continue_pending: Mutex<Option<HiddenContinueAuthority>>,
    exact_watch_entry_url: Mutex<Option<String>>,
    exact_watch_entry_script_id: Mutex<Option<String>>,
    exact_entry_bootstrap: Mutex<Option<ExactEntryBootstrap>>,
    exact_watch_bootstrap_consumed: AtomicBool,
}

pub(crate) struct FunctionBreakpointVerificationReceipt {
    revision: u64,
    generation: u64,
    breakpoints: Vec<DebugFunctionBreakpointVerification>,
}

impl FunctionBreakpointVerificationReceipt {
    pub(crate) fn new(
        revision: u64,
        generation: u64,
        breakpoints: Vec<DebugFunctionBreakpointVerification>,
    ) -> Self {
        Self {
            revision,
            generation,
            breakpoints,
        }
    }

    pub(crate) fn into_breakpoints(self) -> Vec<DebugFunctionBreakpointVerification> {
        self.breakpoints
    }

    pub(crate) fn publish_if_current(
        self,
        state: &FunctionBreakpointSessionState,
        is_current: &(impl Fn() -> bool + ?Sized),
        publish: impl FnOnce(u64, Vec<DebugFunctionBreakpointVerification>) -> Result<(), String>,
    ) -> Result<(), String> {
        let _publication = state
            .publication
            .lock()
            .map_err(|error| error.to_string())?;
        if !is_current()
            || state.revision.load(Ordering::Acquire) != self.revision
            || state.desired_generation.load(Ordering::Acquire) != self.generation
        {
            return Err("Debug function breakpoint verification receipt is stale.".to_string());
        }
        publish(self.generation, self.breakpoints)
    }
}

#[derive(Clone)]
pub(super) struct HiddenContinueAuthority {
    bootstrap: HiddenBootstrap,
    pub(super) desired_generation: u64,
    pub(super) exact_function_location: Option<(String, u64, u64)>,
    pub(super) exact_script_id: Option<String>,
    pub(super) expected_location: Option<(u64, u64)>,
    remaining_steps: u16,
    pub(super) revision: u64,
}

pub(super) struct HiddenContinuePause {
    pub(super) authority: HiddenContinueAuthority,
    pub(super) params: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HiddenStartupStep {
    None,
    StepInto,
    StepOver,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum OrdinaryStartupRearm {
    ContinueToNextLocation,
    Exhausted,
    NotApplicable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HiddenPauseCapture {
    Captured,
    PassThrough,
    Revoke,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExactEntryBootstrap {
    Ordinary,
    Watch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HiddenBootstrap {
    None,
    OrdinaryStartup,
    WatchStartup,
}

impl Default for FunctionBreakpointSessionState {
    fn default() -> Self {
        Self {
            registrations: Mutex::new(FunctionBreakpointRegistrations::default()),
            revision: AtomicU64::new(1),
            desired_generation: AtomicU64::new(0),
            publication: Mutex::new(()),
            hidden_continue_pause: Mutex::new(None),
            hidden_continue_pending: Mutex::new(None),
            exact_watch_entry_url: Mutex::new(None),
            exact_watch_entry_script_id: Mutex::new(None),
            exact_entry_bootstrap: Mutex::new(None),
            exact_watch_bootstrap_consumed: AtomicBool::new(false),
        }
    }
}

impl FunctionBreakpointSessionState {
    pub(crate) fn admit_new_generation(&self, generation: u64) -> Result<(), String> {
        if generation <= self.desired_generation.load(Ordering::Acquire) {
            return Err("Debug function breakpoint generation is stale.".to_string());
        }
        self.desired_generation.store(generation, Ordering::Release);
        Ok(())
    }

    pub(crate) fn bind_exact_watch_entry_url(&self, url: String) -> Result<(), String> {
        self.bind_exact_entry_url(url, ExactEntryBootstrap::Watch)
    }

    pub(crate) fn bind_exact_startup_entry_url(&self, url: String) -> Result<(), String> {
        self.bind_exact_entry_url(url, ExactEntryBootstrap::Ordinary)
    }

    fn bind_exact_entry_url(
        &self,
        url: String,
        bootstrap: ExactEntryBootstrap,
    ) -> Result<(), String> {
        if !url.starts_with("file://") || url.len() > 16_384 || url.chars().any(char::is_control) {
            return Err("Node debug entry URL is invalid.".to_string());
        }
        let mut bound = self
            .exact_watch_entry_url
            .lock()
            .map_err(|error| error.to_string())?;
        match bound.as_ref() {
            Some(existing) if existing == &url => {
                let existing_bootstrap = self
                    .exact_entry_bootstrap
                    .lock()
                    .map_err(|error| error.to_string())?;
                if existing_bootstrap.as_ref() == Some(&bootstrap) {
                    Ok(())
                } else {
                    Err("Node debug entry bootstrap is already bound.".to_string())
                }
            }
            Some(_) => Err("Native Node watch entry URL is already bound.".to_string()),
            None => {
                *bound = Some(url);
                *self
                    .exact_entry_bootstrap
                    .lock()
                    .map_err(|error| error.to_string())? = Some(bootstrap);
                Ok(())
            }
        }
    }

    pub(crate) fn observe_script_parsed(&self, params: &Value) -> Result<(), ()> {
        let Some(url) = params.get("url").and_then(Value::as_str) else {
            return Ok(());
        };
        let exact_url = self.exact_watch_entry_url.lock().map_err(|_| ())?.clone();
        if exact_url.as_deref() != Some(url) {
            return Ok(());
        }
        let script_id = params
            .get("scriptId")
            .and_then(Value::as_str)
            .filter(|script_id| {
                !script_id.is_empty()
                    && script_id.len() <= 128
                    && !script_id.chars().any(char::is_control)
            })
            .ok_or(())?;
        let mut observed = self.exact_watch_entry_script_id.lock().map_err(|_| ())?;
        match observed.as_deref() {
            Some(existing) if existing == script_id => Ok(()),
            Some(_) => Err(()),
            None => {
                *observed = Some(script_id.to_string());
                Ok(())
            }
        }
    }

    pub(super) fn has_hidden_continue_pause(&self) -> Result<bool, ()> {
        self.hidden_continue_pause
            .lock()
            .map(|pause| pause.is_some())
            .map_err(|_| ())
    }

    pub(crate) fn begin_hidden_continue_step(&self) -> Result<bool, ()> {
        self.begin_hidden_step(None, None, HiddenBootstrap::None, 0)
    }

    #[cfg(test)]
    pub(crate) fn arm_unresolved_for_hidden_continue_test(&self) {
        self.registrations
            .lock()
            .unwrap()
            .unverified_by_logical_id
            .insert("test-function".to_string(), "testFunction".to_string());
    }

    pub(crate) fn begin_hidden_startup_step(
        &self,
        params: &Value,
    ) -> Result<HiddenStartupStep, ()> {
        let exact_url_is_bound = self.exact_watch_entry_url.lock().map_err(|_| ())?.is_some();
        if !exact_url_is_bound {
            return Ok(
                if self.begin_hidden_step(None, None, HiddenBootstrap::None, 0)? {
                    HiddenStartupStep::StepInto
                } else {
                    HiddenStartupStep::None
                },
            );
        }
        let has_unresolved = !self
            .registrations
            .lock()
            .map_err(|_| ())?
            .unverified_by_logical_id
            .is_empty();
        if !has_unresolved {
            return Ok(HiddenStartupStep::None);
        }
        let script_id = self
            .exact_watch_entry_script_id
            .lock()
            .map_err(|_| ())?
            .clone()
            .ok_or(())?;
        let paused_script_id = params
            .pointer("/callFrames/0/location/scriptId")
            .and_then(Value::as_str);
        if paused_script_id != Some(script_id.as_str())
            || self.desired_generation.load(Ordering::Acquire) == 0
            || self
                .exact_watch_bootstrap_consumed
                .swap(true, Ordering::AcqRel)
        {
            return Err(());
        }
        let bootstrap = self
            .exact_entry_bootstrap
            .lock()
            .map_err(|_| ())?
            .ok_or(())?;
        let (hidden_bootstrap, remaining_steps, step) = match bootstrap {
            ExactEntryBootstrap::Ordinary => (
                HiddenBootstrap::OrdinaryStartup,
                MAX_ORDINARY_STARTUP_RERESOLUTION_STEPS,
                HiddenStartupStep::StepInto,
            ),
            ExactEntryBootstrap::Watch => (
                HiddenBootstrap::WatchStartup,
                0,
                HiddenStartupStep::StepOver,
            ),
        };
        let exact_function_location = if bootstrap == ExactEntryBootstrap::Ordinary {
            let function_location = params.pointer("/callFrames/0/functionLocation").ok_or(())?;
            let function_script_id = function_location
                .get("scriptId")
                .and_then(Value::as_str)
                .filter(|candidate| *candidate == script_id)
                .ok_or(())?;
            Some((
                function_script_id.to_string(),
                function_location
                    .get("lineNumber")
                    .and_then(Value::as_u64)
                    .ok_or(())?,
                function_location
                    .get("columnNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            ))
        } else {
            None
        };
        if !self.begin_hidden_step(
            Some(script_id),
            exact_function_location,
            hidden_bootstrap,
            remaining_steps,
        )? {
            return Err(());
        }
        Ok(step)
    }

    fn begin_hidden_step(
        &self,
        exact_script_id: Option<String>,
        exact_function_location: Option<(String, u64, u64)>,
        bootstrap: HiddenBootstrap,
        remaining_steps: u16,
    ) -> Result<bool, ()> {
        let has_unresolved = self
            .registrations
            .lock()
            .map_err(|_| ())
            .map(|registrations| !registrations.unverified_by_logical_id.is_empty())?;
        if !has_unresolved {
            return Ok(false);
        }
        let revision = self.revision.load(Ordering::Acquire);
        let desired_generation = self.desired_generation.load(Ordering::Acquire);
        let mut pending = self.hidden_continue_pending.lock().map_err(|_| ())?;
        if pending.is_some() {
            return Err(());
        }
        *pending = Some(HiddenContinueAuthority {
            bootstrap,
            desired_generation,
            exact_function_location,
            exact_script_id,
            expected_location: None,
            remaining_steps,
            revision,
        });
        Ok(true)
    }

    pub(super) fn rearm_ordinary_startup_step(
        &self,
        pause: &HiddenContinuePause,
    ) -> Result<OrdinaryStartupRearm, ()> {
        let authority = &pause.authority;
        if authority.bootstrap != HiddenBootstrap::OrdinaryStartup {
            return Ok(OrdinaryStartupRearm::NotApplicable);
        }
        if authority.remaining_steps == 0 {
            return Ok(OrdinaryStartupRearm::Exhausted);
        }
        if authority.revision != self.revision.load(Ordering::Acquire)
            || authority.desired_generation != self.desired_generation.load(Ordering::Acquire)
            || self
                .registrations
                .lock()
                .map_err(|_| ())?
                .unverified_by_logical_id
                .is_empty()
        {
            return Err(());
        }
        authority.exact_script_id.as_deref().ok_or(())?;
        authority.exact_function_location.as_ref().ok_or(())?;
        let mut pending = self.hidden_continue_pending.lock().map_err(|_| ())?;
        if pending.is_some() {
            return Err(());
        }
        *pending = Some(HiddenContinueAuthority {
            expected_location: None,
            remaining_steps: authority.remaining_steps - 1,
            ..authority.clone()
        });
        Ok(OrdinaryStartupRearm::ContinueToNextLocation)
    }

    pub(super) fn bind_pending_ordinary_startup_location(
        &self,
        line_number: u64,
        column_number: u64,
    ) -> Result<(), ()> {
        let mut pending = self.hidden_continue_pending.lock().map_err(|_| ())?;
        let authority = pending.as_mut().ok_or(())?;
        if authority.bootstrap != HiddenBootstrap::OrdinaryStartup
            || authority.expected_location.is_some()
        {
            return Err(());
        }
        authority.expected_location = Some((line_number, column_number));
        Ok(())
    }

    pub(crate) fn capture_hidden_continue_pause(&self, params: &Value) -> HiddenPauseCapture {
        let Ok(mut pending) = self.hidden_continue_pending.lock() else {
            return HiddenPauseCapture::Revoke;
        };
        let Some(authority) = pending.clone() else {
            return HiddenPauseCapture::PassThrough;
        };
        let hit_breakpoints_are_empty = params
            .get("hitBreakpoints")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty);
        let exact_function_frames: Vec<_> = params
            .get("callFrames")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|frame| exact_function_location_matches(frame, &authority))
            .collect();
        let exact_function_frame_is_unambiguous = exact_function_frames.len() == 1;
        let expected_location_frames: Vec<_> = params
            .get("callFrames")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|frame| expected_location_matches(frame, &authority))
            .collect();
        let exact_continue_location =
            exact_function_frame_is_unambiguous && expected_location_frames.len() == 1;
        let is_exact_internal_step = hit_breakpoints_are_empty
            && (params.get("reason").and_then(Value::as_str) == Some("step")
                || (authority.bootstrap == HiddenBootstrap::OrdinaryStartup
                    && params.get("reason").and_then(Value::as_str) == Some("other")
                    && exact_continue_location));
        if !is_exact_internal_step {
            *pending = None;
            return HiddenPauseCapture::PassThrough;
        }
        let exact_script_matches = authority
            .exact_script_id
            .as_deref()
            .is_none_or(|script_id| {
                if authority.bootstrap == HiddenBootstrap::OrdinaryStartup {
                    return exact_function_frame_is_unambiguous
                        && exact_function_frames.first().is_some_and(|frame| {
                            frame.pointer("/location/scriptId").and_then(Value::as_str)
                                == Some(script_id)
                        });
                }
                params
                    .pointer("/callFrames/0/location/scriptId")
                    .and_then(Value::as_str)
                    == Some(script_id)
            });
        if authority.revision != self.revision.load(Ordering::Acquire)
            || authority.desired_generation != self.desired_generation.load(Ordering::Acquire)
            || !exact_script_matches
        {
            *pending = None;
            return HiddenPauseCapture::Revoke;
        }
        let Ok(mut pause) = self.hidden_continue_pause.lock() else {
            *pending = None;
            return HiddenPauseCapture::Revoke;
        };
        if pause.is_some() {
            *pending = None;
            return HiddenPauseCapture::Revoke;
        }
        *pause = Some(HiddenContinuePause {
            authority,
            params: params.clone(),
        });
        *pending = None;
        HiddenPauseCapture::Captured
    }

    pub(crate) fn cancel_hidden_continue_step(&self) -> Result<(), ()> {
        *self.hidden_continue_pending.lock().map_err(|_| ())? = None;
        *self.hidden_continue_pause.lock().map_err(|_| ())? = None;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn exhaust_pending_ordinary_startup_steps_for_test(&self) {
        self.hidden_continue_pending
            .lock()
            .expect("pending ordinary startup test lock")
            .as_mut()
            .expect("pending ordinary startup authority")
            .remaining_steps = 0;
    }

    pub(super) fn take_hidden_continue_pause(&self) -> Result<Option<HiddenContinuePause>, ()> {
        self.hidden_continue_pause
            .lock()
            .map(|mut pause| pause.take())
            .map_err(|_| ())
    }
}

pub(super) fn exact_function_location_matches(
    frame: &Value,
    authority: &HiddenContinueAuthority,
) -> bool {
    let Some((script_id, line_number, column_number)) = authority.exact_function_location.as_ref()
    else {
        return false;
    };
    frame.get("functionLocation").is_some_and(|location| {
        location.get("scriptId").and_then(Value::as_str) == Some(script_id.as_str())
            && location.get("lineNumber").and_then(Value::as_u64) == Some(*line_number)
            && location
                .get("columnNumber")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                == *column_number
    })
}

pub(super) fn expected_location_matches(
    frame: &Value,
    authority: &HiddenContinueAuthority,
) -> bool {
    let Some((line_number, column_number)) = authority.expected_location else {
        return false;
    };
    frame.get("location").is_some_and(|location| {
        location.get("scriptId").and_then(Value::as_str) == authority.exact_script_id.as_deref()
            && location.get("lineNumber").and_then(Value::as_u64) == Some(line_number)
            && location
                .get("columnNumber")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                == column_number
    })
}
