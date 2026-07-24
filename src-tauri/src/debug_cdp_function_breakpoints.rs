use crate::debug_adapter::{
    DebugFunctionBreakpoint, DebugFunctionBreakpointVerification, DebugSessionRegistry,
};
use crate::debug_cdp::transport::CdpClient;
use crate::debug_session_registry::{
    retain_workspace_root, DebugWorkspaceAuthority, RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub(crate) const MAX_FUNCTION_BREAKPOINT_NAME_BYTES: usize = 256;
pub(crate) const MAX_FUNCTION_BREAKPOINT_SEGMENTS: usize = 8;
pub(crate) const MAX_FUNCTION_BREAKPOINTS: usize = 128;
const MAX_FUNCTION_BREAKPOINT_ID_BYTES: usize = 128;
pub(crate) const MAX_FUNCTION_BREAKPOINT_RERESOLUTION_SWEEPS: usize = 16;
const FUNCTION_BREAKPOINT_RERESOLUTION_QUIET_PERIOD: Duration = Duration::from_millis(10);
const STALE_FUNCTION_BREAKPOINT_AUTHORITY: &str = "Debug function breakpoint authority is stale.";

pub(crate) trait FunctionBreakpointCdp {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String>;
}

impl FunctionBreakpointCdp for CdpClient {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        CdpClient::request(self, method, params)
    }
}

#[derive(Default)]
pub(crate) struct FunctionBreakpointRegistrations {
    by_logical_id: HashMap<String, String>,
    unverified_by_logical_id: HashMap<String, String>,
    unpublished_cdp_ids: Vec<String>,
    reresolution_sweeps: usize,
}

pub(crate) struct FunctionBreakpointSessionState {
    pub(crate) registrations: Mutex<FunctionBreakpointRegistrations>,
    pub(crate) revision: AtomicU64,
    pub(crate) publication: Mutex<()>,
}

impl Default for FunctionBreakpointSessionState {
    fn default() -> Self {
        Self {
            registrations: Mutex::new(FunctionBreakpointRegistrations::default()),
            revision: AtomicU64::new(1),
            publication: Mutex::new(()),
        }
    }
}

impl<const N: usize> From<[(&str, &str); N]> for FunctionBreakpointRegistrations {
    fn from(entries: [(&str, &str); N]) -> Self {
        Self {
            by_logical_id: entries
                .into_iter()
                .map(|(logical, cdp)| (logical.to_string(), cdp.to_string()))
                .collect(),
            unverified_by_logical_id: HashMap::new(),
            unpublished_cdp_ids: Vec::new(),
            reresolution_sweeps: 0,
        }
    }
}

impl FunctionBreakpointRegistrations {
    fn reserve_reresolution_sweep(&mut self) -> bool {
        if self.unverified_by_logical_id.is_empty()
            || self.reresolution_sweeps >= MAX_FUNCTION_BREAKPOINT_RERESOLUTION_SWEEPS
        {
            return false;
        }
        self.reresolution_sweeps += 1;
        true
    }
}

pub(crate) fn validate_function_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_FUNCTION_BREAKPOINT_NAME_BYTES {
        return Err("Function breakpoint name is empty or too long.".to_string());
    }
    let segments: Vec<_> = name.split('.').collect();
    if segments.len() > MAX_FUNCTION_BREAKPOINT_SEGMENTS
        || segments.iter().any(|segment| !valid_identifier(segment))
    {
        return Err("Function breakpoint name must be a JavaScript identifier path.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_function_breakpoints(
    breakpoints: &[DebugFunctionBreakpoint],
) -> Result<(), String> {
    if breakpoints.len() > MAX_FUNCTION_BREAKPOINTS {
        return Err("Too many function breakpoints.".to_string());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for breakpoint in breakpoints {
        if breakpoint.id.is_empty()
            || breakpoint.id.len() > MAX_FUNCTION_BREAKPOINT_ID_BYTES
            || breakpoint.id.contains('\0')
            || !ids.insert(breakpoint.id.as_str())
        {
            return Err("Function breakpoint id is invalid or duplicated.".to_string());
        }
        validate_function_name(&breakpoint.function_name)?;
        if !names.insert(breakpoint.function_name.as_str()) {
            return Err("Function breakpoint name is duplicated.".to_string());
        }
    }
    Ok(())
}

pub(crate) fn replace_function_breakpoints(
    cdp: &mut impl FunctionBreakpointCdp,
    registrations: &mut FunctionBreakpointRegistrations,
    breakpoints: &[DebugFunctionBreakpoint],
    is_current: impl Fn() -> bool,
) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
    validate_function_breakpoints(breakpoints)?;
    registrations.unverified_by_logical_id.clear();
    registrations.reresolution_sweeps = 0;
    let previous: Vec<_> = registrations
        .by_logical_id
        .iter()
        .map(|(logical_id, breakpoint_id)| (logical_id.clone(), breakpoint_id.clone()))
        .collect();
    for (logical_id, breakpoint_id) in previous {
        ensure_current(&is_current)?;
        cdp.request(
            "Debugger.removeBreakpoint",
            json!({"breakpointId":breakpoint_id}),
        )?;
        if registrations.by_logical_id.get(&logical_id) == Some(&breakpoint_id) {
            registrations.by_logical_id.remove(&logical_id);
        }
        ensure_current(&is_current)?;
    }
    let unpublished = registrations.unpublished_cdp_ids.clone();
    for breakpoint_id in unpublished {
        ensure_current(&is_current)?;
        cdp.request(
            "Debugger.removeBreakpoint",
            json!({"breakpointId":breakpoint_id}),
        )?;
        registrations
            .unpublished_cdp_ids
            .retain(|tracked| tracked != &breakpoint_id);
        ensure_current(&is_current)?;
    }

    let mut verification = Vec::with_capacity(breakpoints.len());
    for breakpoint in breakpoints {
        if !breakpoint.enabled {
            verification.push(unverified(&breakpoint.id));
            continue;
        }
        ensure_current(&is_current)?;
        let evaluated = cdp.request(
            "Runtime.evaluate",
            json!({
                "expression":breakpoint.function_name,
                "silent":true,
                "returnByValue":false,
                "awaitPromise":false,
                "throwOnSideEffect":true
            }),
        );
        ensure_current(&is_current)?;
        let Some(object_id) = evaluated
            .ok()
            .filter(|response| response.get("exceptionDetails").is_none())
            .and_then(|response| response.get("result").cloned())
            .filter(|remote| remote.get("type").and_then(Value::as_str) == Some("function"))
            .and_then(|remote| {
                remote
                    .get("objectId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        else {
            registrations
                .unverified_by_logical_id
                .insert(breakpoint.id.clone(), breakpoint.function_name.clone());
            verification.push(unverified(&breakpoint.id));
            continue;
        };
        ensure_current(&is_current)?;
        let installed = cdp.request(
            "Debugger.setBreakpointOnFunctionCall",
            json!({"objectId":object_id}),
        );
        let cdp_id = installed.ok().and_then(|response| {
            response
                .get("breakpointId")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        if let Some(cdp_id) = &cdp_id {
            registrations
                .by_logical_id
                .insert(breakpoint.id.clone(), cdp_id.clone());
        }
        ensure_current(&is_current)?;
        let Some(_) = cdp_id else {
            registrations
                .unverified_by_logical_id
                .insert(breakpoint.id.clone(), breakpoint.function_name.clone());
            verification.push(unverified(&breakpoint.id));
            continue;
        };
        verification.push(DebugFunctionBreakpointVerification {
            id: breakpoint.id.clone(),
            verified: true,
        });
    }
    Ok(verification)
}

#[cfg(test)]
pub(crate) fn reresolve_function_breakpoints(
    cdp: &mut impl FunctionBreakpointCdp,
    registrations: &mut FunctionBreakpointRegistrations,
    is_current: impl Fn() -> bool,
) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
    let pending: Vec<_> = registrations
        .unverified_by_logical_id
        .iter()
        .map(|(id, name)| (id.clone(), name.clone()))
        .collect();
    let mut verification = Vec::new();
    for (id, function_name) in pending {
        if let Some(verified) =
            reresolve_function_breakpoint(cdp, registrations, &id, &function_name, &is_current)?
        {
            verification.push(verified);
        }
    }
    Ok(verification)
}

#[cfg(test)]
fn reresolve_function_breakpoint(
    cdp: &mut impl FunctionBreakpointCdp,
    registrations: &mut FunctionBreakpointRegistrations,
    id: &str,
    function_name: &str,
    is_current: &impl Fn() -> bool,
) -> Result<Option<DebugFunctionBreakpointVerification>, String> {
    if registrations.by_logical_id.contains_key(id)
        || registrations
            .unverified_by_logical_id
            .get(id)
            .map(String::as_str)
            != Some(function_name)
    {
        return Ok(None);
    }
    let Some(cdp_id) = evaluate_and_install_function_breakpoint(cdp, function_name, is_current)?
    else {
        return Ok(None);
    };
    registrations.by_logical_id.insert(id.to_string(), cdp_id);
    registrations.unverified_by_logical_id.remove(id);
    ensure_current(is_current)?;
    Ok(Some(DebugFunctionBreakpointVerification {
        id: id.to_string(),
        verified: true,
    }))
}

fn evaluate_and_install_function_breakpoint(
    cdp: &mut impl FunctionBreakpointCdp,
    function_name: &str,
    is_current: &impl Fn() -> bool,
) -> Result<Option<String>, String> {
    ensure_current(is_current)?;
    let evaluated = cdp.request(
        "Runtime.evaluate",
        json!({
            "expression":function_name,
            "silent":true,
            "returnByValue":false,
            "awaitPromise":false,
            "throwOnSideEffect":true
        }),
    );
    ensure_current(is_current)?;
    let Some(object_id) = evaluated
        .ok()
        .filter(|response| response.get("exceptionDetails").is_none())
        .and_then(|response| response.get("result").cloned())
        .filter(|remote| remote.get("type").and_then(Value::as_str) == Some("function"))
        .and_then(|remote| {
            remote
                .get("objectId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    else {
        return Ok(None);
    };
    ensure_current(is_current)?;
    let installed = cdp.request(
        "Debugger.setBreakpointOnFunctionCall",
        json!({"objectId":object_id}),
    );
    let Some(cdp_id) = installed.ok().and_then(|response| {
        response
            .get("breakpointId")
            .and_then(Value::as_str)
            .map(str::to_string)
    }) else {
        ensure_current(is_current)?;
        return Ok(None);
    };
    Ok(Some(cdp_id))
}

pub(crate) fn run_reresolution_worker(
    triggers: Receiver<()>,
    mut cdp: impl FunctionBreakpointCdp,
    state: Arc<FunctionBreakpointSessionState>,
    emit: Arc<dyn Fn(crate::debug_adapter::DebugEventPayload) + Send + Sync>,
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) {
    while triggers.recv().is_ok() {
        loop {
            match triggers.recv_timeout(FUNCTION_BREAKPOINT_RERESOLUTION_QUIET_PERIOD) {
                Ok(()) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if !is_current() {
            return;
        }
        let Ok(publication_guard) = state.publication.lock() else {
            return;
        };
        let Ok(mut registrations_guard) = state.registrations.lock() else {
            return;
        };
        if !registrations_guard.reserve_reresolution_sweep() {
            continue;
        }
        let sweep_revision = state.revision.load(Ordering::Acquire);
        let pending: Vec<_> = registrations_guard
            .unverified_by_logical_id
            .iter()
            .map(|(id, name)| (id.clone(), name.clone()))
            .collect();
        drop(registrations_guard);
        drop(publication_guard);
        let mut resolved = Vec::new();
        for (id, function_name) in pending {
            if state.revision.load(Ordering::Acquire) != sweep_revision || !is_current() {
                break;
            }
            let Ok(registrations_guard) = state.registrations.lock() else {
                return;
            };
            let candidate_is_unresolved = !registrations_guard.by_logical_id.contains_key(&id)
                && registrations_guard
                    .unverified_by_logical_id
                    .get(&id)
                    .map(String::as_str)
                    == Some(function_name.as_str());
            drop(registrations_guard);
            if !candidate_is_unresolved {
                continue;
            }
            let result =
                evaluate_and_install_function_breakpoint(&mut cdp, &function_name, &|| {
                    is_current() && state.revision.load(Ordering::Acquire) == sweep_revision
                });
            match result {
                Ok(Some(cdp_id)) => {
                    let Ok(publication_guard) = state.publication.lock() else {
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        return;
                    };
                    let candidate_is_current =
                        is_current() && state.revision.load(Ordering::Acquire) == sweep_revision;
                    let Ok(mut registrations_guard) = state.registrations.lock() else {
                        drop(publication_guard);
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        return;
                    };
                    let candidate_is_current = candidate_is_current
                        && !registrations_guard.by_logical_id.contains_key(&id)
                        && registrations_guard
                            .unverified_by_logical_id
                            .get(&id)
                            .map(String::as_str)
                            == Some(function_name.as_str());
                    if candidate_is_current {
                        registrations_guard
                            .by_logical_id
                            .insert(id.clone(), cdp_id.clone());
                        registrations_guard.unverified_by_logical_id.remove(&id);
                    }
                    drop(registrations_guard);
                    drop(publication_guard);
                    if !candidate_is_current {
                        remove_or_track_unpublished_install(&mut cdp, &state, cdp_id);
                        if !is_current() {
                            return;
                        }
                        break;
                    }
                    resolved.push(DebugFunctionBreakpointVerification { id, verified: true });
                }
                Ok(None) => {}
                Err(_) if !is_current() => return,
                Err(_) => break,
            }
        }
        if resolved.is_empty() || !is_current() {
            continue;
        }
        let Ok(_publication) = state.publication.lock() else {
            return;
        };
        if state.revision.load(Ordering::Acquire) != sweep_revision || !is_current() {
            continue;
        }
        emit(
            crate::debug_adapter::DebugEventPayload::FunctionBreakpointsVerified {
                breakpoints: resolved,
            },
        );
    }
}

fn remove_or_track_unpublished_install(
    cdp: &mut impl FunctionBreakpointCdp,
    state: &FunctionBreakpointSessionState,
    cdp_id: String,
) {
    if cdp
        .request("Debugger.removeBreakpoint", json!({"breakpointId":cdp_id}))
        .is_ok()
    {
        return;
    }
    let mut registrations = match state.registrations.lock() {
        Ok(registrations) => registrations,
        Err(poisoned) => poisoned.into_inner(),
    };
    if registrations.unpublished_cdp_ids.contains(&cdp_id) {
        return;
    }
    registrations.unpublished_cdp_ids.push(cdp_id);
}

fn ensure_current(is_current: &impl Fn() -> bool) -> Result<(), String> {
    if !is_current() {
        return Err(STALE_FUNCTION_BREAKPOINT_AUTHORITY.to_string());
    }
    Ok(())
}

fn valid_identifier(segment: &str) -> bool {
    let mut characters = segment.bytes();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() && first != b'_' && first != b'$' {
        return false;
    }
    characters.all(|character| {
        character.is_ascii_alphanumeric() || character == b'_' || character == b'$'
    })
}

fn unverified(id: &str) -> DebugFunctionBreakpointVerification {
    DebugFunctionBreakpointVerification {
        id: id.to_string(),
        verified: false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DebugSetFunctionBreakpointsRequest {
    root_path: String,
    session_id: u64,
    breakpoints: Vec<DebugFunctionBreakpoint>,
}

impl DebugSetFunctionBreakpointsRequest {
    fn validate(&self) -> Result<(), String> {
        if self.root_path.is_empty()
            || self.root_path.len() > 4_096
            || self.root_path.chars().any(char::is_control)
        {
            return Err("Debug workspace root is invalid.".to_string());
        }
        if self.session_id == 0 || self.session_id > 9_007_199_254_740_991 {
            return Err("Debug session id must be a positive JavaScript-safe integer.".to_string());
        }
        validate_function_breakpoints(&self.breakpoints)
    }
}

fn retain_function_breakpoint_workspace(
    registry: &WorkspaceRegistry,
    root_path: &str,
) -> Result<RetainedDebugWorkspaceRoot, String> {
    let retained = retain_workspace_root(registry, root_path)?;
    let root_key = retained.live_path()?.to_string_lossy().into_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    };
    if canonical_root != &root_key {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    }
    Ok(retained)
}

#[tauri::command]
pub(crate) async fn debug_set_function_breakpoints(
    request: DebugSetFunctionBreakpointsRequest,
    registry: State<'_, Arc<DebugSessionRegistry>>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
    request.validate()?;
    let retained = retain_function_breakpoint_workspace(&workspace_registry, &request.root_path)?;
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err("Debug workspace identity changed before function breakpoints.".to_string());
    };
    let root_key = canonical_root.clone();
    let authority = retained.authority.clone();
    let registry = Arc::clone(registry.inner());
    crate::run_blocking_command(move || {
        let _retained = retained;
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust_guard = trust.lock().map_err(|error| error.to_string())?;
        if !trust_guard.get(&root_key).trusted {
            return Err("Trust this workspace to control the debugger.".to_string());
        }
        registry.mutate_for_session_authorized(request.session_id, &authority, |adapter| {
            adapter.set_function_breakpoints(&request.breakpoints)
        })?
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::DebugFunctionBreakpoint;
    use serde_json::{json, Value};
    use std::cell::Cell;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, SyncSender};
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

    fn spawn_worker(
        cdp: WorkerFakeCdp,
        state: Arc<FunctionBreakpointSessionState>,
        emit: Arc<dyn Fn(crate::debug_adapter::DebugEventPayload) + Send + Sync>,
        is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> (SyncSender<()>, JoinHandle<()>) {
        let (trigger, triggers) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            run_reresolution_worker(triggers, cdp, state, emit, is_current);
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
    fn script_parse_sweeps_are_capped_per_desired_replacement_generation() {
        let mut registrations = FunctionBreakpointRegistrations::default();
        registrations
            .unverified_by_logical_id
            .insert("fn-1".to_string(), "render".to_string());

        for _ in 0..MAX_FUNCTION_BREAKPOINT_RERESOLUTION_SWEEPS {
            assert!(registrations.reserve_reresolution_sweep());
        }

        assert!(!registrations.reserve_reresolution_sweep());

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
    fn worker_revocation_after_install_removes_the_unpublished_cdp_breakpoint() {
        let state = unresolved_worker_state();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let allowed = Arc::new(AtomicBool::new(true));
        let allowed_for_worker = Arc::clone(&allowed);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_worker = Arc::clone(&emitted);
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
        let (trigger, worker) = spawn_worker(
            cdp,
            Arc::clone(&state),
            Arc::new(move |payload| {
                emitted_for_worker
                    .lock()
                    .expect("emitted payload lock")
                    .push(payload);
            }),
            Arc::new(move || allowed_for_worker.load(Ordering::Acquire)),
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
    }

    #[test]
    fn function_verification_event_has_the_exact_frontend_wire_shape() {
        let payload = crate::debug_adapter::DebugEventPayload::FunctionBreakpointsVerified {
            breakpoints: vec![DebugFunctionBreakpointVerification {
                id: "fn-1".to_string(),
                verified: true,
            }],
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({
                "kind":"functionBreakpointsVerified",
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
            "breakpoints":[{"id":"fn-1","functionName":"app.render","enabled":true}]
        });
        let request =
            serde_json::from_value::<DebugSetFunctionBreakpointsRequest>(valid.clone()).unwrap();
        assert!(request.validate().is_ok());

        for missing in ["rootPath", "sessionId", "breakpoints"] {
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
