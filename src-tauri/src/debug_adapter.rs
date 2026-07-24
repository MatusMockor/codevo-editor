#![allow(dead_code)] // Protocol-agnostic debugger core awaiting the CDP adapter and command wiring slices.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

pub use crate::debug_hit_condition::DebugHitCondition;

pub use crate::debug_session_registry::{
    DebugEventEmitter, DebugSessionRegistry, DebugStartupPermit,
};

#[cfg(test)]
#[path = "debug_adapter_wire_tests.rs"]
mod wire_tests;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugBreakpoint {
    pub id: String,
    pub file_path: String,
    pub line_number: u32,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_positive_u32",
        skip_serializing_if = "Option::is_none"
    )]
    pub column_number: Option<u32>,
    pub condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hit_condition: Option<DebugHitCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_message: Option<String>,
    pub enabled: bool,
    #[serde(default)]
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugFunctionBreakpoint {
    pub id: String,
    pub function_name: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugFunctionBreakpointVerification {
    pub id: String,
    pub verified: bool,
}

fn deserialize_optional_positive_u32<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = u32::deserialize(deserializer)?;
    if value == 0 {
        return Err(D::Error::custom(
            "inline breakpoint column must be at least 1",
        ));
    }
    Ok(Some(value))
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugVariableInfo {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluate_name: Option<String>,
    pub variables_reference: u64,
    #[serde(
        default,
        skip_serializing_if = "can_set_value_is_absent",
        deserialize_with = "deserialize_can_set_value"
    )]
    pub can_set_value: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_set_expression_reference"
    )]
    pub set_expression_reference: Option<u64>,
}

fn deserialize_set_expression_reference<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = u64::deserialize(deserializer)?;
    if value == 0 || value > 9_007_199_254_740_991 {
        return Err(D::Error::custom(
            "setExpressionReference must be a positive JavaScript-safe integer",
        ));
    }
    Ok(Some(value))
}

fn can_set_value_is_absent(value: &Option<bool>) -> bool {
    *value != Some(true)
}

fn deserialize_can_set_value<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    match bool::deserialize(deserializer)? {
        true => Ok(Some(true)),
        false => Err(D::Error::custom("canSetValue must be true when present")),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DebugVariablePageRequest {
    pub pause_generation: u64,
    pub frame_id: u64,
    pub variables_reference: u64,
    pub start: u64,
    pub count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugSetVariableRequest {
    pub pause_generation: u64,
    pub frame_id: u64,
    pub variables_reference: u64,
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugSetVariableResult {
    pub value: DebugVariableInfo,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugSetExpressionRequest {
    pub pause_generation: u64,
    pub frame_id: u64,
    pub set_expression_reference: u64,
    pub expression: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugSetExpressionResult {
    pub set_expression_reference: u64,
    pub expression: String,
    pub value: DebugVariableInfo,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DebugCompletionRoot {
    Binding(String),
    This,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DebugCompletionQuery {
    Lexical {
        prefix: String,
    },
    Member {
        root: DebugCompletionRoot,
        path: Vec<String>,
        prefix: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugCompletionRequest {
    pub pause_generation: u64,
    pub frame_id: u64,
    pub query: DebugCompletionQuery,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugCompletionItem {
    pub label: String,
    pub kind: DebugCompletionItemKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugCompletionItemKind {
    Variable,
    Property,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugCompletionResult {
    pub items: Vec<DebugCompletionItem>,
    pub is_incomplete: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariablePage {
    pub variables: Vec<DebugVariableInfo>,
    pub start: u64,
    pub returned: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_start: Option<u64>,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugEvaluateContext {
    Repl,
    Watch,
    Clipboard,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DebugEvaluatePolicy {
    pub context: DebugEvaluateContext,
    pub allow_side_effects: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DebugEvaluateErrorKind {
    Exception,
    SideEffect,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugEvaluateFailure {
    pub kind: DebugEvaluateErrorKind,
    pub message: String,
}

impl DebugEvaluateFailure {
    pub fn exception(message: impl Into<String>) -> Self {
        Self {
            kind: DebugEvaluateErrorKind::Exception,
            message: message.into(),
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            kind: DebugEvaluateErrorKind::Unsupported,
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugStopReason {
    Breakpoint,
    Step,
    Pause,
    Exception,
    Entry,
    Restart,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Continue,
    StepOver,
    StepInto,
    StepOut,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugExceptionPauseMode {
    #[default]
    None,
    Uncaught,
    All,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JsTestDebugRunner {
    Jest,
    Vitest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JsTestDebugNameMatch {
    Exact,
    Prefix,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DebugJustMyCodePolicy {
    Dependencies,
    NodeInternals,
    NodeInternalsAndDependencies,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum JsTestDebugSelection {
    File,
    Suite {
        #[serde(rename = "fullName")]
        full_name: String,
    },
    Test {
        #[serde(rename = "fullName")]
        full_name: String,
        #[serde(rename = "nameMatch")]
        name_match: JsTestDebugNameMatch,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum DebugLaunchTarget {
    #[serde(rename = "node-attach", rename_all = "camelCase")]
    NodeAttach { port: u16 },
    #[serde(rename = "node-script", rename_all = "camelCase")]
    NodeScript { script_path: String },
    #[serde(rename = "js-test-file", rename_all = "camelCase")]
    JsTestFile {
        runner: String,
        file_path: String,
        package_root_path: String,
    },
    #[serde(rename = "node-configured-script", rename_all = "camelCase")]
    NodeConfiguredScript {
        script_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        just_my_code: Option<DebugJustMyCodePolicy>,
    },
    #[serde(rename = "js-configured-test", rename_all = "camelCase")]
    JsConfiguredTest {
        runner: String,
        file_path: String,
        package_root_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
    },
    #[serde(rename = "js-test-selection", rename_all = "camelCase")]
    JsTestSelection {
        runner: JsTestDebugRunner,
        file_path: String,
        package_root_path: String,
        selection: JsTestDebugSelection,
    },
    #[serde(rename = "node-npm-script", rename_all = "camelCase")]
    NodeNpmScript {
        script: String,
        package_root_path: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        just_my_code: Option<DebugJustMyCodePolicy>,
    },
    #[serde(rename = "php-script", rename_all = "camelCase")]
    PhpScript { script_path: String },
    #[serde(rename = "php-test-file", rename_all = "camelCase")]
    PhpTestFile { file_path: String },
    #[serde(rename = "php-listen", rename_all = "camelCase")]
    PhpListen { port: Option<u16> },
}

impl DebugLaunchTarget {
    pub(crate) fn just_my_code(&self) -> Option<DebugJustMyCodePolicy> {
        match self {
            Self::NodeConfiguredScript { just_my_code, .. }
            | Self::NodeNpmScript { just_my_code, .. } => *just_my_code,
            Self::NodeAttach { .. }
            | Self::NodeScript { .. }
            | Self::JsTestFile { .. }
            | Self::JsConfiguredTest { .. }
            | Self::JsTestSelection { .. }
            | Self::PhpScript { .. }
            | Self::PhpTestFile { .. }
            | Self::PhpListen { .. } => None,
        }
    }

    pub(crate) fn is_node(&self) -> bool {
        matches!(
            self,
            Self::NodeAttach { .. }
                | Self::NodeScript { .. }
                | Self::JsTestFile { .. }
                | Self::NodeConfiguredScript { .. }
                | Self::JsConfiguredTest { .. }
                | Self::JsTestSelection { .. }
                | Self::NodeNpmScript { .. }
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DebugEventPayload {
    #[serde(rename_all = "camelCase")]
    Started {
        session_id: u64,
    },
    #[serde(rename_all = "camelCase")]
    Stopped {
        reason: DebugStopReason,
        frames: Vec<DebugStackFrame>,
        pause_generation: u64,
    },
    Resumed,
    #[serde(rename_all = "camelCase")]
    Output {
        stream: DebugOutputStream,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Terminated {
        exit_code: Option<i32>,
    },
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
    Ok {
        session_id: u64,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

pub trait DebugAdapter: Send {
    fn confirm_launch(&mut self) -> Result<(), String> {
        Err("This debug session has no pending launch confirmation.".to_string())
    }
    fn set_breakpoints_active(&mut self, _active: bool) -> Result<(), String> {
        Err("Breakpoint activation is only available for Node.js debug sessions.".to_string())
    }
    fn set_function_breakpoints(
        &mut self,
        _breakpoints: &[DebugFunctionBreakpoint],
    ) -> Result<Vec<DebugFunctionBreakpointVerification>, String> {
        Err("Function breakpoints are only available for Node.js debug sessions.".to_string())
    }
    fn set_exception_pause(&mut self, _mode: DebugExceptionPauseMode) -> Result<(), String> {
        Err("Exception pause modes are only available for Node.js debug sessions.".to_string())
    }
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String>;
    fn step(&mut self, kind: StepKind) -> Result<(), String>;
    fn pause(&mut self) -> Result<(), String>;
    fn restart_frame(&mut self, _pause_generation: u64, _frame_id: u64) -> Result<(), String> {
        Err("Restart frame is only available for paused Node.js debug sessions.".to_string())
    }
    fn run_to_location(
        &mut self,
        _pause_generation: u64,
        _file_path: &str,
        _line_number: u32,
        _column_number: u32,
    ) -> Result<(), String> {
        Err("Run to location is only available for paused Node.js debug sessions.".to_string())
    }
    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String>;
    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String>;
    fn current_pause_generation(&self) -> Option<u64> {
        None
    }
    fn variables(&mut self, _reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
        Err("Paged debug variables are unavailable for this adapter.".to_string())
    }
    fn variables_page(
        &mut self,
        request: DebugVariablePageRequest,
    ) -> Result<DebugVariablePage, String> {
        let variables = self.variables(request.variables_reference)?;
        let total = variables.len() as u64;
        let start = usize::try_from(request.start)
            .unwrap_or(usize::MAX)
            .min(variables.len());
        let end = start
            .saturating_add(request.count as usize)
            .min(variables.len());
        let variables = variables[start..end].to_vec();
        let returned = variables.len() as u32;
        let consumed = request.start.saturating_add(returned as u64);
        Ok(DebugVariablePage {
            variables,
            start: request.start,
            returned,
            total: Some(total),
            next_start: (consumed < total).then_some(consumed),
            truncated: false,
        })
    }
    fn set_variable(
        &mut self,
        _request: DebugSetVariableRequest,
    ) -> Result<DebugSetVariableResult, String> {
        Err("Unsupported: setting debug variables is unavailable for this adapter.".to_string())
    }
    fn set_expression(
        &mut self,
        _request: DebugSetExpressionRequest,
    ) -> Result<DebugSetExpressionResult, String> {
        Err("Unsupported: setting debug expressions is unavailable for this adapter.".to_string())
    }
    fn completions(
        &mut self,
        _request: DebugCompletionRequest,
    ) -> Result<DebugCompletionResult, String> {
        Err("Debug completions are only available for paused Node.js debug sessions.".to_string())
    }
    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String>;
    fn evaluate_with_policy(
        &mut self,
        frame_id: u64,
        expression: &str,
        policy: DebugEvaluatePolicy,
    ) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        if policy.context == DebugEvaluateContext::Watch {
            return Err(DebugEvaluateFailure::unsupported(
                "Watch evaluation is unavailable for this debug adapter.",
            ));
        }
        if policy.context == DebugEvaluateContext::Clipboard {
            return Err(DebugEvaluateFailure::unsupported(
                "Clipboard evaluation is unavailable for this debug adapter.",
            ));
        }
        self.evaluate(frame_id, expression)
            .map_err(DebugEvaluateFailure::exception)
    }
    fn disconnect(&mut self) {
        self.terminate();
    }
    fn terminate(&mut self);
}

/// `emit` must not synchronously call back into `DebugSessionRegistry`: it can
/// run while the (non-reentrant) per-session adapter mutex is held.
/// `emit` must also be non-blocking: adapters invoke it from their protocol IO
/// threads, where a blocked sink stalls request/response handling.
pub trait DebugEventSink: Send + Sync {
    fn emit(&self, event: DebugEvent);
}
#[path = "debug_variable_name.rs"]
pub(crate) mod variable_name;
