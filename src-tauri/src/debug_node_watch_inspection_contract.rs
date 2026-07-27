use crate::debug_adapter::variable_name::is_valid_debug_variable_name;
use crate::debug_adapter::{
    DebugEvaluateContext, DebugEvaluateFailure, DebugEvaluatePolicy, DebugScopeInfo,
    DebugSetExpressionRequest, DebugSetExpressionResult, DebugSetVariableRequest,
    DebugSetVariableResult, DebugStackFrame, DebugVariableInfo, DebugVariablePage,
    DebugVariablePageRequest,
};

pub(super) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_STACK_FRAMES: usize = 256;
const MAX_SCOPES: usize = 256;
const MAX_FRAME_NAME_BYTES: usize = 1_024;
const MAX_FRAME_PATH_BYTES: usize = 4_096;
const MAX_SCOPE_NAME_BYTES: usize = 1_024;
const MAX_STACK_STRING_BYTES: usize = 512 * 1_024;
const MAX_VARIABLE_PAGE_BYTES: usize = 1_024 * 1_024;
const MAX_VARIABLE_VALUE_BYTES: usize = 64 * 1_024;
const MAX_VARIABLE_TYPE_BYTES: usize = 256;
const MAX_VARIABLE_PAGE_START: u64 = 1_000_000;
const MAX_VARIABLE_PAGE_COUNT: u32 = 100;
const MAX_EVALUATE_EXPRESSION_BYTES: usize = 4_096;
const MAX_EVALUATE_MESSAGE_BYTES: usize = 4_096;
const MAX_SET_VARIABLE_NAME_BYTES: usize = 4_096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WatchSetVariableRequest {
    request: DebugSetVariableRequest,
}

impl WatchSetVariableRequest {
    pub(super) fn new(request: DebugSetVariableRequest) -> Result<Self, ()> {
        validate_nonzero_safe_integer(request.pause_generation)?;
        validate_nonzero_safe_integer(request.frame_id)?;
        validate_nonzero_safe_integer(request.variables_reference)?;
        if !is_valid_debug_variable_name(&request.name)
            || request.name.len() > MAX_SET_VARIABLE_NAME_BYTES
        {
            return Err(());
        }
        validate_mutation_value(&request.value, MAX_EVALUATE_EXPRESSION_BYTES)?;
        Ok(Self { request })
    }

    pub(super) fn request(&self) -> &DebugSetVariableRequest {
        &self.request
    }

    pub(super) fn expected_pause_epoch(&self) -> u64 {
        self.request.pause_generation
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.request.frame_id
    }

    pub(super) fn variables_reference(&self) -> u64 {
        self.request.variables_reference
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchSetVariableResult {
    pause_epoch: u64,
    frame_id: u64,
    variables_reference: u64,
    result: DebugSetVariableResult,
}

impl WatchSetVariableResult {
    pub(super) fn new(
        request: &WatchSetVariableRequest,
        result: DebugSetVariableResult,
    ) -> Result<Self, ()> {
        let value = Self {
            pause_epoch: request.expected_pause_epoch(),
            frame_id: request.frame_id(),
            variables_reference: request.variables_reference(),
            result,
        };
        value.validate(request)?;
        Ok(value)
    }

    pub(super) fn into_result(self) -> DebugSetVariableResult {
        self.result
    }

    pub(super) fn validate(&self, request: &WatchSetVariableRequest) -> Result<(), ()> {
        WatchSetVariableRequest::new(request.request().clone())?;
        if self.pause_epoch != request.expected_pause_epoch()
            || self.frame_id != request.frame_id()
            || self.variables_reference != request.variables_reference()
            || self.result.value.name != request.request().name
            || self.result.value.can_set_value != Some(true)
        {
            return Err(());
        }
        validate_variable(&self.result.value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WatchSetExpressionRequest {
    request: DebugSetExpressionRequest,
}

impl WatchSetExpressionRequest {
    pub(super) fn new(request: DebugSetExpressionRequest) -> Result<Self, ()> {
        validate_nonzero_safe_integer(request.pause_generation)?;
        validate_nonzero_safe_integer(request.frame_id)?;
        validate_nonzero_safe_integer(request.set_expression_reference)?;
        validate_evaluate_text(&request.expression, MAX_EVALUATE_EXPRESSION_BYTES)?;
        if request.expression.chars().any(char::is_control) {
            return Err(());
        }
        validate_mutation_value(&request.value, MAX_VARIABLE_VALUE_BYTES)?;
        Ok(Self { request })
    }

    pub(super) fn request(&self) -> &DebugSetExpressionRequest {
        &self.request
    }

    pub(super) fn expected_pause_epoch(&self) -> u64 {
        self.request.pause_generation
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.request.frame_id
    }

    pub(super) fn set_expression_reference(&self) -> u64 {
        self.request.set_expression_reference
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchSetExpressionResult {
    pause_epoch: u64,
    frame_id: u64,
    result: DebugSetExpressionResult,
}

impl WatchSetExpressionResult {
    pub(super) fn new(
        request: &WatchSetExpressionRequest,
        result: DebugSetExpressionResult,
    ) -> Result<Self, ()> {
        let value = Self {
            pause_epoch: request.expected_pause_epoch(),
            frame_id: request.frame_id(),
            result,
        };
        value.validate(request)?;
        Ok(value)
    }

    pub(super) fn into_result(self) -> DebugSetExpressionResult {
        self.result
    }

    pub(super) fn validate(&self, request: &WatchSetExpressionRequest) -> Result<(), ()> {
        WatchSetExpressionRequest::new(request.request().clone())?;
        if self.pause_epoch != request.expected_pause_epoch()
            || self.frame_id != request.frame_id()
            || self.result.set_expression_reference != request.set_expression_reference()
            || self.result.expression != request.request().expression
            || self.result.value.name != request.request().expression
            || self.result.value.variables_reference != 0
            || self.result.value.can_set_value.is_some()
            || self.result.value.set_expression_reference.is_some()
        {
            return Err(());
        }
        validate_evaluate_value(&self.result.value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct WatchVariablesRequest {
    request: DebugVariablePageRequest,
}

impl WatchVariablesRequest {
    pub(super) fn new(request: DebugVariablePageRequest) -> Result<Self, ()> {
        validate_nonzero_safe_integer(request.pause_generation)?;
        validate_nonzero_safe_integer(request.frame_id)?;
        validate_nonzero_safe_integer(request.variables_reference)?;
        if request.start > MAX_VARIABLE_PAGE_START
            || request.count == 0
            || request.count > MAX_VARIABLE_PAGE_COUNT
        {
            return Err(());
        }
        Ok(Self { request })
    }

    pub(super) fn request(self) -> DebugVariablePageRequest {
        self.request
    }

    pub(super) fn expected_pause_epoch(self) -> u64 {
        self.request.pause_generation
    }

    pub(super) fn frame_id(self) -> u64 {
        self.request.frame_id
    }

    pub(super) fn variables_reference(self) -> u64 {
        self.request.variables_reference
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchVariablesResult {
    pause_epoch: u64,
    frame_id: u64,
    variables_reference: u64,
    page: DebugVariablePage,
}

impl WatchVariablesResult {
    pub(super) fn new(request: WatchVariablesRequest, page: DebugVariablePage) -> Result<Self, ()> {
        let result = Self {
            pause_epoch: request.expected_pause_epoch(),
            frame_id: request.frame_id(),
            variables_reference: request.variables_reference(),
            page,
        };
        result.validate(request)?;
        Ok(result)
    }

    pub(super) fn pause_epoch(&self) -> u64 {
        self.pause_epoch
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.frame_id
    }

    pub(super) fn variables_reference(&self) -> u64 {
        self.variables_reference
    }

    pub(super) fn page(&self) -> &DebugVariablePage {
        &self.page
    }

    pub(super) fn into_page(self) -> DebugVariablePage {
        self.page
    }

    pub(super) fn validate(&self, request: WatchVariablesRequest) -> Result<(), ()> {
        WatchVariablesRequest::new(request.request())?;
        if self.pause_epoch != request.expected_pause_epoch()
            || self.frame_id != request.frame_id()
            || self.variables_reference != request.variables_reference()
            || self.page.start != request.request().start
            || self.page.variables.len() > request.request().count as usize
            || usize::try_from(self.page.returned).ok() != Some(self.page.variables.len())
        {
            return Err(());
        }
        let consumed = self
            .page
            .start
            .checked_add(u64::from(self.page.returned))
            .ok_or(())?;
        if consumed > MAX_SAFE_INTEGER
            || self
                .page
                .total
                .is_some_and(|total| total > MAX_SAFE_INTEGER || total < consumed)
            || self.page.next_start.is_some_and(|next| {
                next > MAX_SAFE_INTEGER
                    || next != consumed
                    || next <= self.page.start
                    || self.page.total.is_some_and(|total| next > total)
            })
            || self
                .page
                .total
                .is_some_and(|total| self.page.next_start.is_some() != (consumed < total))
            || (self.page.next_start.is_some() && self.page.total.is_none() && !self.page.truncated)
        {
            return Err(());
        }
        for variable in &self.page.variables {
            validate_variable(variable)?;
        }
        (serde_json::to_vec(&self.page).map_err(|_| ())?.len() <= MAX_VARIABLE_PAGE_BYTES)
            .then_some(())
            .ok_or(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WatchEvaluateRequest {
    expected_pause_epoch: u64,
    frame_id: u64,
    expression: String,
    policy: DebugEvaluatePolicy,
}

impl WatchEvaluateRequest {
    pub(super) fn new(
        expected_pause_epoch: u64,
        frame_id: u64,
        expression: String,
        policy: DebugEvaluatePolicy,
    ) -> Result<Self, ()> {
        validate_nonzero_safe_integer(expected_pause_epoch)?;
        validate_nonzero_safe_integer(frame_id)?;
        validate_evaluate_expression_text(&expression, MAX_EVALUATE_EXPRESSION_BYTES)?;
        let valid_policy = match policy.context {
            DebugEvaluateContext::Watch => !policy.allow_side_effects,
            DebugEvaluateContext::Repl | DebugEvaluateContext::Clipboard => {
                policy.allow_side_effects
            }
        };
        if !valid_policy {
            return Err(());
        }
        Ok(Self {
            expected_pause_epoch,
            frame_id,
            expression,
            policy,
        })
    }

    pub(super) fn expected_pause_epoch(&self) -> u64 {
        self.expected_pause_epoch
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.frame_id
    }

    pub(super) fn expression(&self) -> &str {
        &self.expression
    }

    pub(super) fn policy(&self) -> DebugEvaluatePolicy {
        self.policy
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchEvaluateResult {
    pause_epoch: u64,
    frame_id: u64,
    outcome: Result<DebugVariableInfo, DebugEvaluateFailure>,
}

impl WatchEvaluateResult {
    pub(super) fn new(
        request: &WatchEvaluateRequest,
        outcome: Result<DebugVariableInfo, DebugEvaluateFailure>,
    ) -> Result<Self, ()> {
        let result = Self {
            pause_epoch: request.expected_pause_epoch(),
            frame_id: request.frame_id(),
            outcome,
        };
        result.validate(request)?;
        Ok(result)
    }

    pub(super) fn pause_epoch(&self) -> u64 {
        self.pause_epoch
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.frame_id
    }

    pub(super) fn into_outcome(self) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
        self.outcome
    }

    pub(super) fn validate(&self, request: &WatchEvaluateRequest) -> Result<(), ()> {
        WatchEvaluateRequest::new(
            request.expected_pause_epoch(),
            request.frame_id(),
            request.expression().to_string(),
            request.policy(),
        )?;
        if self.pause_epoch != request.expected_pause_epoch() || self.frame_id != request.frame_id()
        {
            return Err(());
        }
        match &self.outcome {
            Ok(value) => validate_evaluate_value(value),
            Err(failure) => validate_evaluate_text(&failure.message, MAX_EVALUATE_MESSAGE_BYTES),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct WatchStackTraceRequest {
    expected_pause_epoch: u64,
}

impl WatchStackTraceRequest {
    pub(super) fn new(expected_pause_epoch: u64) -> Result<Self, ()> {
        validate_nonzero_safe_integer(expected_pause_epoch)?;
        Ok(Self {
            expected_pause_epoch,
        })
    }

    pub(super) fn expected_pause_epoch(self) -> u64 {
        self.expected_pause_epoch
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct WatchScopesRequest {
    expected_pause_epoch: u64,
    frame_id: u64,
}

impl WatchScopesRequest {
    pub(super) fn new(expected_pause_epoch: u64, frame_id: u64) -> Result<Self, ()> {
        validate_nonzero_safe_integer(expected_pause_epoch)?;
        validate_nonzero_safe_integer(frame_id)?;
        Ok(Self {
            expected_pause_epoch,
            frame_id,
        })
    }

    pub(super) fn expected_pause_epoch(self) -> u64 {
        self.expected_pause_epoch
    }

    pub(super) fn frame_id(self) -> u64 {
        self.frame_id
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchStackTraceResult {
    pause_epoch: u64,
    frames: Vec<DebugStackFrame>,
    truncated: bool,
}

impl WatchStackTraceResult {
    pub(super) fn new(pause_epoch: u64, mut frames: Vec<DebugStackFrame>) -> Result<Self, ()> {
        validate_nonzero_safe_integer(pause_epoch)?;
        let truncated = frames.len() > MAX_STACK_FRAMES;
        frames.truncate(MAX_STACK_FRAMES);
        let result = Self {
            pause_epoch,
            frames,
            truncated,
        };
        result.validate()?;
        Ok(result)
    }

    pub(super) fn snapshot<'a>(
        pause_epoch: u64,
        frames: impl IntoIterator<Item = &'a DebugStackFrame>,
        mut is_current: impl FnMut() -> bool,
    ) -> Result<Self, ()> {
        validate_nonzero_safe_integer(pause_epoch)?;
        let mut copied = Vec::with_capacity(MAX_STACK_FRAMES);
        let mut aggregate_string_bytes = 0_usize;
        let mut truncated = false;
        for frame in frames.into_iter().take(MAX_STACK_FRAMES + 1) {
            if !is_current() {
                return Err(());
            }
            if copied.len() == MAX_STACK_FRAMES {
                truncated = true;
                break;
            }
            validate_frame(frame, &mut aggregate_string_bytes)?;
            copied.push(frame.clone());
        }
        if !is_current() {
            return Err(());
        }
        Ok(Self {
            pause_epoch,
            frames: copied,
            truncated,
        })
    }

    pub(super) fn pause_epoch(&self) -> u64 {
        self.pause_epoch
    }

    pub(super) fn frames(&self) -> &[DebugStackFrame] {
        &self.frames
    }

    pub(super) fn truncated(&self) -> bool {
        self.truncated
    }

    pub(super) fn validate(&self) -> Result<(), ()> {
        validate_nonzero_safe_integer(self.pause_epoch)?;
        if self.frames.len() > MAX_STACK_FRAMES {
            return Err(());
        }
        let mut aggregate_string_bytes = 0_usize;
        for frame in &self.frames {
            validate_frame(frame, &mut aggregate_string_bytes)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct WatchScopesResult {
    pause_epoch: u64,
    frame_id: u64,
    scopes: Vec<DebugScopeInfo>,
}

impl WatchScopesResult {
    pub(super) fn new(
        pause_epoch: u64,
        frame_id: u64,
        scopes: Vec<DebugScopeInfo>,
    ) -> Result<Self, ()> {
        let result = Self {
            pause_epoch,
            frame_id,
            scopes,
        };
        result.validate()?;
        Ok(result)
    }

    pub(super) fn snapshot<'a>(
        pause_epoch: u64,
        frame_id: u64,
        scopes: impl IntoIterator<Item = &'a DebugScopeInfo>,
        mut is_current: impl FnMut() -> bool,
    ) -> Result<Self, ()> {
        validate_nonzero_safe_integer(pause_epoch)?;
        validate_nonzero_safe_integer(frame_id)?;
        let mut copied = Vec::with_capacity(MAX_SCOPES);
        for scope in scopes.into_iter().take(MAX_SCOPES + 1) {
            if !is_current() {
                return Err(());
            }
            if copied.len() == MAX_SCOPES {
                return Err(());
            }
            validate_scope(scope)?;
            copied.push(scope.clone());
        }
        if !is_current() {
            return Err(());
        }
        Ok(Self {
            pause_epoch,
            frame_id,
            scopes: copied,
        })
    }

    pub(super) fn pause_epoch(&self) -> u64 {
        self.pause_epoch
    }

    pub(super) fn frame_id(&self) -> u64 {
        self.frame_id
    }

    pub(super) fn scopes(&self) -> &[DebugScopeInfo] {
        &self.scopes
    }

    pub(super) fn validate(&self) -> Result<(), ()> {
        validate_nonzero_safe_integer(self.pause_epoch)?;
        validate_nonzero_safe_integer(self.frame_id)?;
        if self.scopes.len() > MAX_SCOPES {
            return Err(());
        }
        for scope in &self.scopes {
            validate_scope(scope)?;
        }
        Ok(())
    }
}

fn validate_frame(frame: &DebugStackFrame, aggregate_string_bytes: &mut usize) -> Result<(), ()> {
    validate_nonzero_safe_integer(frame.frame_id)?;
    validate_text(&frame.name, MAX_FRAME_NAME_BYTES)?;
    *aggregate_string_bytes = (*aggregate_string_bytes)
        .checked_add(frame.name.len())
        .ok_or(())?;
    if let Some(file_path) = frame.file_path.as_deref() {
        validate_text(file_path, MAX_FRAME_PATH_BYTES)?;
        *aggregate_string_bytes = (*aggregate_string_bytes)
            .checked_add(file_path.len())
            .ok_or(())?;
    }
    (*aggregate_string_bytes <= MAX_STACK_STRING_BYTES)
        .then_some(())
        .ok_or(())
}

fn validate_scope(scope: &DebugScopeInfo) -> Result<(), ()> {
    validate_text(&scope.name, MAX_SCOPE_NAME_BYTES)?;
    validate_nonzero_safe_integer(scope.variables_reference)
}

fn validate_variable(variable: &DebugVariableInfo) -> Result<(), ()> {
    if variable.name.len() > MAX_VARIABLE_VALUE_BYTES
        || variable.value.len() > MAX_VARIABLE_VALUE_BYTES
        || variable.variables_reference > MAX_SAFE_INTEGER
        || variable
            .set_expression_reference
            .is_some_and(|reference| reference == 0 || reference > MAX_SAFE_INTEGER)
        || variable.can_set_value == Some(false)
        || variable.value_type.as_ref().is_some_and(|value_type| {
            value_type.is_empty()
                || value_type.len() > MAX_VARIABLE_TYPE_BYTES
                || value_type.chars().any(char::is_control)
        })
        || variable
            .evaluate_name
            .as_deref()
            .is_some_and(|evaluate_name| {
                evaluate_name.trim().is_empty()
                    || evaluate_name.len() > MAX_EVALUATE_EXPRESSION_BYTES
                    || evaluate_name.chars().any(char::is_control)
            })
        || (variable.can_set_value == Some(true) && !is_valid_debug_variable_name(&variable.name))
    {
        return Err(());
    }
    Ok(())
}

fn validate_evaluate_value(variable: &DebugVariableInfo) -> Result<(), ()> {
    validate_variable(variable)?;
    (variable.name.len() <= MAX_EVALUATE_EXPRESSION_BYTES
        && has_valid_evaluate_expression_characters(&variable.name))
    .then_some(())
    .ok_or(())
}

fn validate_nonzero_safe_integer(value: u64) -> Result<(), ()> {
    (value > 0 && value <= MAX_SAFE_INTEGER)
        .then_some(())
        .ok_or(())
}

fn validate_evaluate_text(value: &str, maximum_bytes: usize) -> Result<(), ()> {
    (value.len() <= maximum_bytes
        && !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_control() && character != '\t'))
    .then_some(())
    .ok_or(())
}

fn validate_evaluate_expression_text(value: &str, maximum_bytes: usize) -> Result<(), ()> {
    (!value.is_empty()
        && value.len() <= maximum_bytes
        && has_valid_evaluate_expression_characters(value))
    .then_some(())
    .ok_or(())
}

fn has_valid_evaluate_expression_characters(value: &str) -> bool {
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\t' | '\n' => {}
            '\r' if characters.peek() == Some(&'\n') => {}
            _ if character.is_control() => return false,
            _ => {}
        }
    }
    true
}

fn validate_mutation_value(value: &str, maximum_bytes: usize) -> Result<(), ()> {
    (value.len() <= maximum_bytes
        && !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r')))
    .then_some(())
    .ok_or(())
}

fn validate_text(value: &str, maximum_bytes: usize) -> Result<(), ()> {
    (value.len() <= maximum_bytes && !value.chars().any(char::is_control))
        .then_some(())
        .ok_or(())
}

#[cfg(test)]
#[path = "debug_node_watch_inspection_contract_tests.rs"]
mod tests;
