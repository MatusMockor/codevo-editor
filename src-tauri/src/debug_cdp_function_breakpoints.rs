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
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub(crate) const MAX_FUNCTION_BREAKPOINT_NAME_BYTES: usize = 256;
pub(crate) const MAX_FUNCTION_BREAKPOINT_SEGMENTS: usize = 8;
pub(crate) const MAX_FUNCTION_BREAKPOINTS: usize = 128;
const MAX_FUNCTION_BREAKPOINT_ID_BYTES: usize = 128;
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
}

impl<const N: usize> From<[(&str, &str); N]> for FunctionBreakpointRegistrations {
    fn from(entries: [(&str, &str); N]) -> Self {
        Self {
            by_logical_id: entries
                .into_iter()
                .map(|(logical, cdp)| (logical.to_string(), cdp.to_string()))
                .collect(),
        }
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
