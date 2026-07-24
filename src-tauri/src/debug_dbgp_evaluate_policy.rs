//! Side-effect policy boundary for PHP DBGp evaluation.

use super::{
    dbgp_error_message, variables::variable_from_property, PhpDbgpAdapter, NOT_PAUSED_ERROR,
};
use crate::debug_adapter::{
    DebugAdapter, DebugEvaluateContext, DebugEvaluateFailure, DebugEvaluatePolicy,
    DebugVariableInfo,
};

pub(super) fn evaluate(
    adapter: &mut PhpDbgpAdapter,
    frame_id: u64,
    expression: &str,
    policy: DebugEvaluatePolicy,
) -> Result<DebugVariableInfo, DebugEvaluateFailure> {
    if policy.context == DebugEvaluateContext::Clipboard {
        return Err(DebugEvaluateFailure::unsupported(
            "Clipboard evaluation is unavailable for PHP debug sessions.",
        ));
    }
    if policy.context == DebugEvaluateContext::Watch {
        let shared = adapter
            .inner
            .shared
            .lock()
            .map_err(|error| DebugEvaluateFailure::exception(error.to_string()))?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| DebugEvaluateFailure::exception(NOT_PAUSED_ERROR))?;
        if !pause.frame_depths.contains_key(&frame_id) {
            return Err(DebugEvaluateFailure::exception(format!(
                "Unknown debug frame {frame_id}."
            )));
        }
        return Err(DebugEvaluateFailure::unsupported(
            "Watch evaluation is unavailable for PHP debug sessions.",
        ));
    }
    adapter
        .evaluate(frame_id, expression)
        .map_err(DebugEvaluateFailure::exception)
}

pub(super) fn evaluate_repl(
    adapter: &mut PhpDbgpAdapter,
    frame_id: u64,
    expression: &str,
) -> Result<DebugVariableInfo, String> {
    let connection = adapter.inner.active_connection()?;
    let (pause_generation, depth) = {
        let shared = adapter
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
        let depth = *pause
            .frame_depths
            .get(&frame_id)
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?;
        (pause.generation, depth)
    };
    let response = connection.request("eval", &format!(" -d {depth}"), Some(expression))?;
    if let Some(error) = &response.error {
        return Err(dbgp_error_message(error, "eval"));
    }
    let property = response
        .properties
        .first()
        .ok_or_else(|| "Evaluation returned no result.".to_string())?;
    let mut shared = adapter
        .inner
        .shared
        .lock()
        .map_err(|error| error.to_string())?;
    if shared.pause.is_none() {
        return Err(NOT_PAUSED_ERROR.to_string());
    }
    if shared
        .pause
        .as_ref()
        .is_none_or(|pause| pause.generation != pause_generation)
    {
        return Err(NOT_PAUSED_ERROR.to_string());
    }
    let mut variable =
        variable_from_property(&mut shared, property, pause_generation, frame_id, depth, 0);
    variable.name = expression.to_string();
    Ok(variable)
}
