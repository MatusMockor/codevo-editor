use crate::debug_adapter::{DebugFunctionBreakpoint, DebugFunctionBreakpointVerification};
use crate::debug_cdp::transport::CdpClient;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

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
    pub(super) by_logical_id: HashMap<String, String>,
    pub(super) unverified_by_logical_id: HashMap<String, String>,
    pub(super) unpublished_cdp_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct FunctionLocation {
    pub(super) column_number: u64,
    pub(super) line_number: u64,
    pub(super) script_id: String,
}

pub(super) struct InstalledFunctionBreakpoint {
    pub(super) breakpoint_id: String,
    pub(super) function_location: Option<FunctionLocation>,
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
        }
    }
}

impl FunctionBreakpointRegistrations {
    pub(super) fn reserve_reresolution_sweep(&mut self) -> bool {
        !self.unverified_by_logical_id.is_empty()
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
        )?;
        ensure_current(&is_current)?;
        let Some(object_id) = Some(evaluated)
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
        )?;
        let cdp_id = installed
            .get("breakpointId")
            .and_then(Value::as_str)
            .map(str::to_string);
        if cdp_id.is_none() {
            return Err(
                "Node debugger returned an invalid function breakpoint result.".to_string(),
            );
        }
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
    let Some(installed) =
        evaluate_and_install_function_breakpoint(cdp, function_name, false, is_current)?
    else {
        return Ok(None);
    };
    registrations
        .by_logical_id
        .insert(id.to_string(), installed.breakpoint_id);
    registrations.unverified_by_logical_id.remove(id);
    ensure_current(is_current)?;
    Ok(Some(DebugFunctionBreakpointVerification {
        id: id.to_string(),
        verified: true,
    }))
}

pub(super) fn evaluate_and_install_function_breakpoint(
    cdp: &mut impl FunctionBreakpointCdp,
    function_name: &str,
    capture_function_location: bool,
    is_current: &impl Fn() -> bool,
) -> Result<Option<InstalledFunctionBreakpoint>, String> {
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
    )?;
    ensure_current(is_current)?;
    let Some(object_id) = Some(evaluated)
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
    let function_location = if capture_function_location {
        let properties = cdp.request(
            "Runtime.getProperties",
            json!({
                "objectId":object_id,
                "ownProperties":false,
                "accessorPropertiesOnly":false,
                "generatePreview":false
            }),
        )?;
        parse_function_location(&properties)
    } else {
        None
    };
    ensure_current(is_current)?;
    let installed = cdp.request(
        "Debugger.setBreakpointOnFunctionCall",
        json!({"objectId":object_id}),
    )?;
    let Some(cdp_id) = installed
        .get("breakpointId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        ensure_current(is_current)?;
        return Err("Node debugger returned an invalid function breakpoint result.".to_string());
    };
    Ok(Some(InstalledFunctionBreakpoint {
        breakpoint_id: cdp_id,
        function_location,
    }))
}

fn parse_function_location(response: &Value) -> Option<FunctionLocation> {
    let value = response
        .get("internalProperties")
        .and_then(Value::as_array)?
        .iter()
        .find(|property| {
            property.get("name").and_then(Value::as_str) == Some("[[FunctionLocation]]")
        })?
        .get("value")?
        .get("value")?;
    Some(FunctionLocation {
        column_number: value.get("columnNumber")?.as_u64()?,
        line_number: value.get("lineNumber")?.as_u64()?,
        script_id: value.get("scriptId")?.as_str()?.to_string(),
    })
}

pub(super) fn parse_call_frame_function_location(value: &Value) -> Option<FunctionLocation> {
    Some(FunctionLocation {
        column_number: value.get("columnNumber")?.as_u64()?,
        line_number: value.get("lineNumber")?.as_u64()?,
        script_id: value.get("scriptId")?.as_str()?.to_string(),
    })
}

pub(super) fn ensure_current(is_current: &impl Fn() -> bool) -> Result<(), String> {
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
