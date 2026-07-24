// Fail-closed Watch-root mutation through an opaque, pause-owned target token.

use super::super::transport::{CdpClient, CdpShared};
use super::set_expression_proof::prepare_static_assignment;
use super::set_expression_provenance::{SetExpressionReference, SetExpressionTarget};
use super::set_variable::set_variable;
use super::ObjectReferenceAccess;
use crate::debug_adapter::{
    DebugSetExpressionRequest, DebugSetExpressionResult, DebugSetVariableRequest,
};
use std::sync::{Arc, Mutex};

pub(crate) fn set_expression(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    request: DebugSetExpressionRequest,
) -> Result<DebugSetExpressionResult, String> {
    if request.pause_generation == 0
        || request.frame_id == 0
        || request.set_expression_reference == 0
    {
        return Err("Invalid debug set-expression owner.".to_string());
    }
    let token = consume_exact_token(shared, &request)?;
    let expression = token.expression.clone();
    let assigned = (|| {
        let (variables_reference, name) = match &token.target {
            SetExpressionTarget::ScopeSlot {
                variables_reference,
                name,
            } => (*variables_reference, name.clone()),
            SetExpressionTarget::StaticProperty { .. } => {
                if !mutation_is_allowed() {
                    return Err("The debug session no longer permits mutations.".to_string());
                }
                let prepared = prepare_static_assignment(
                    client,
                    shared,
                    request.pause_generation,
                    request.frame_id,
                    &token.target,
                )?;
                (prepared.variables_reference, prepared.name)
            }
        };
        set_variable(
            client,
            shared,
            mutation_is_allowed,
            DebugSetVariableRequest {
                pause_generation: request.pause_generation,
                frame_id: request.frame_id,
                variables_reference,
                name,
                value: request.value,
            },
        )
    })();
    let invalidated = invalidate_after_attempt(shared, request.pause_generation, request.frame_id);
    if invalidated.is_err() {
        return Err(indeterminate_error());
    }
    let mut assigned = assigned?;
    // The assignment invalidates every derived object handle. Return only a
    // closed value snapshot; the frontend must re-evaluate to obtain fresh
    // Watch/object capabilities.
    assigned.value.variables_reference = 0;
    assigned.value.can_set_value = None;
    assigned.value.set_expression_reference = None;
    assigned.value.name = expression.clone();
    Ok(DebugSetExpressionResult {
        set_expression_reference: request.set_expression_reference,
        expression,
        value: assigned.value,
    })
}

fn consume_exact_token(
    shared: &Arc<Mutex<CdpShared>>,
    request: &DebugSetExpressionRequest,
) -> Result<SetExpressionReference, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
    {
        return Err("The debug set-expression owner is stale.".to_string());
    }
    let token = pause
        .set_expression_references
        .get(&request.set_expression_reference)
        .ok_or_else(|| "Unknown or already-used set-expression reference.".to_string())?;
    if token.pause_generation != request.pause_generation
        || token.frame_id != request.frame_id
        || token.expression != request.expression
    {
        return Err("The set-expression reference belongs to another debug owner.".to_string());
    }
    Ok(pause
        .set_expression_references
        .remove(&request.set_expression_reference)
        .expect("validated token"))
}

fn invalidate_after_attempt(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|_| indeterminate_error())?;
    let Some(pause) = state.pause.as_mut() else {
        return Ok(());
    };
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Ok(());
    }
    pause.set_expression_references.clear();
    pause
        .object_ids
        .retain(|_, reference| reference.access == ObjectReferenceAccess::ScopeRoot);
    let retained = pause
        .object_ids
        .keys()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    pause
        .object_reference_ids
        .retain(|_, reference| retained.contains(reference));
    Ok(())
}

fn indeterminate_error() -> String {
    "The debug expression mutation may have produced side effects, but its final result could not be proven; the result is indeterminate and was not retried."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_cdp::transport::PauseInventory;
    use crate::debug_cdp::variables::{register_object_reference, ObjectReferenceMutation};

    #[test]
    fn token_validation_is_exact_and_does_not_consume_a_mismatched_owner() {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 7,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(11, "frame".to_string());
        pause.set_expression_references.insert(
            13,
            SetExpressionReference {
                frame_id: 11,
                pause_generation: 7,
                expression: "count".to_string(),
                target: SetExpressionTarget::ScopeSlot {
                    variables_reference: 17,
                    name: "count".to_string(),
                },
            },
        );
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));
        let invalid = DebugSetExpressionRequest {
            pause_generation: 7,
            frame_id: 11,
            set_expression_reference: 13,
            expression: "other".to_string(),
            value: "2".to_string(),
        };

        assert!(consume_exact_token(&shared, &invalid).is_err());
        assert!(shared
            .lock()
            .expect("state")
            .pause
            .as_ref()
            .expect("pause")
            .set_expression_references
            .contains_key(&13));
    }

    #[test]
    fn invalidation_revokes_every_watch_token_after_an_attempt() {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 7,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(11, "frame".to_string());
        for (reference, expression) in [(13, "count"), (14, "other")] {
            pause.set_expression_references.insert(
                reference,
                SetExpressionReference {
                    frame_id: 11,
                    pause_generation: 7,
                    expression: expression.to_string(),
                    target: SetExpressionTarget::ScopeSlot {
                        variables_reference: 17,
                        name: expression.to_string(),
                    },
                },
            );
        }
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));
        let ephemeral = register_object_reference(
            &shared,
            7,
            11,
            "ephemeral-parent",
            None,
            ObjectReferenceMutation::ObjectProperty {
                object_id: "ephemeral-parent".to_string(),
            },
        )
        .expect("ephemeral object reference");
        invalidate_after_attempt(&shared, 7, 11).expect("invalidate");
        let state = shared.lock().expect("state");
        let pause = state.pause.as_ref().expect("pause");
        assert!(pause.set_expression_references.is_empty());
        assert!(!pause.object_ids.contains_key(&ephemeral));
        assert!(!pause
            .object_reference_ids
            .values()
            .any(|reference| *reference == ephemeral));
    }
}
