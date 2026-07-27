// Fail-closed CDP variable mutation owned by an exact pause, frame and reference.

use super::super::transport::{CdpClient, CdpShared};
use super::{
    assigned_evaluate_name, child_object_mutation, invalidate_all_descriptor_snapshots,
    is_writable_data_property, owned_object_reference_for_mutation, owner_is_current,
    register_child_object_reference, revoke_assigned_property_references,
    variable_from_remote_object, ObjectReferenceMutation, MAX_CDP_PROPERTY_DESCRIPTORS,
};
use crate::debug_adapter::variable_name::is_valid_debug_variable_name;
use crate::debug_adapter::{
    DebugSetVariableRequest, DebugSetVariableResult, DebugVariablePageRequest,
};
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};

const SET_VALUE_OBJECT_GROUP: &str = "codevo-set-value";
const ASSIGN_PROPERTY_FUNCTION: &str =
    "function(key, value) { this[key] = value; return this[key]; }";
const IDENTITY_FUNCTION: &str = "function() { return this; }";

pub(crate) fn set_variable(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    request: DebugSetVariableRequest,
) -> Result<DebugSetVariableResult, String> {
    if !is_valid_debug_variable_name(&request.name) {
        return Err("This debug variable name cannot be assigned.".to_string());
    }
    let owner_request = owner_request(&request);
    let parent = owned_object_reference_for_mutation(shared, owner_request)?;
    if matches!(parent.mutation, ObjectReferenceMutation::ReadOnly) {
        return Err("This debug variable is read-only.".to_string());
    }
    ensure_mutation_allowed(mutation_is_allowed)?;
    ensure_owner(shared, owner_request, false)?;
    revalidate_property(client, &parent, &request.name)?;

    let call_frame_id = exact_call_frame_id(shared, &request)?;
    let timeout_ms = u64::try_from(client.request_timeout.as_millis()).unwrap_or(u64::MAX);
    let evaluation_response = client.request(
        "Debugger.evaluateOnCallFrame",
        json!({
            "callFrameId": call_frame_id,
            "expression": format!("(\n{}\n)", request.value),
            "silent": true,
            "returnByValue": false,
            "generatePreview": false,
            "awaitPromise": false,
            "timeout": timeout_ms,
            "objectGroup": SET_VALUE_OBJECT_GROUP,
        }),
    );
    let _snapshot_invalidation = SnapshotInvalidationGuard {
        shared,
        request: owner_request,
    };
    let evaluation = match evaluation_response {
        Ok(evaluation) => evaluation,
        Err(_) => {
            release_evaluation_group(client);
            return Err(indeterminate_error());
        }
    };
    let evaluated = match evaluation_result(&evaluation) {
        Ok(evaluated) => evaluated.clone(),
        Err(_) => {
            release_evaluation_group(client);
            return Err(indeterminate_error());
        }
    };

    let assignment_result: Result<Option<Value>, String> = (|| {
        ensure_mutation_allowed(mutation_is_allowed)?;
        ensure_owner(shared, owner_request, false)?;
        revalidate_property(client, &parent, &request.name)?;
        match &parent.mutation {
            ObjectReferenceMutation::ScopeSlot {
                call_frame_id,
                scope_number,
                ..
            } => {
                client
                    .request(
                        "Debugger.setVariableValue",
                        json!({
                            "scopeNumber": scope_number,
                            "variableName": request.name,
                            "newValue": call_argument(&evaluated)?,
                            "callFrameId": call_frame_id,
                        }),
                    )
                    .map_err(|_| indeterminate_error())?;
                ensure_mutation_allowed(mutation_is_allowed).map_err(|_| indeterminate_error())?;
                ensure_owner(shared, owner_request, true)?;
                Ok(Some(fresh_scope_value(client, &evaluated)?))
            }
            ObjectReferenceMutation::ObjectProperty { object_id } => {
                ensure_mutation_allowed(mutation_is_allowed)?;
                ensure_owner(shared, owner_request, false)?;
                let response = client
                    .request(
                        "Runtime.callFunctionOn",
                        json!({
                            "objectId": object_id,
                            "functionDeclaration": ASSIGN_PROPERTY_FUNCTION,
                            "arguments": [
                                {"value": request.name},
                                call_argument(&evaluated)?,
                            ],
                            "silent": true,
                            "returnByValue": false,
                            "generatePreview": false,
                            "awaitPromise": false,
                        }),
                    )
                    .map_err(|_| indeterminate_error())?;
                evaluation_result(&response)?;
                Ok(None)
            }
            ObjectReferenceMutation::ReadOnly => unreachable!("rejected above"),
        }
    })();

    release_evaluation_group(client);
    let scope_assigned = assignment_result.map_err(|_| indeterminate_error())?;
    ensure_mutation_allowed(mutation_is_allowed).map_err(|_| indeterminate_error())?;
    ensure_owner(shared, owner_request, true)?;
    let mut actual_descriptor =
        revalidate_property(client, &parent, &request.name).map_err(|_| indeterminate_error())?;
    if let Some(scope_assigned) = scope_assigned {
        actual_descriptor["value"] = scope_assigned;
    }
    let assigned = actual_descriptor
        .get("value")
        .cloned()
        .ok_or_else(indeterminate_error)?;
    ensure_mutation_allowed(mutation_is_allowed).map_err(|_| indeterminate_error())?;
    ensure_owner(shared, owner_request, true)?;

    let evaluate_name = assigned_evaluate_name(&parent, &request.name);
    revoke_assigned_property_references(
        shared,
        request.pause_generation,
        request.frame_id,
        request.variables_reference,
        &request.name,
    )
    .map_err(|_| indeterminate_error())?;
    let mut value = variable_from_remote_object(
        &request.name,
        &assigned,
        shared,
        None,
        evaluate_name.clone(),
        ObjectReferenceMutation::ReadOnly,
    );
    value.can_set_value = Some(true);
    value.variables_reference = assigned
        .get("objectId")
        .and_then(Value::as_str)
        .and_then(|object_id| {
            let mutation = child_object_mutation(
                &parent.mutation,
                &actual_descriptor,
                &assigned,
                false,
                false,
            );
            register_child_object_reference(
                shared,
                (request.pause_generation, request.frame_id),
                request.variables_reference,
                &request.name,
                object_id,
                evaluate_name,
                mutation,
            )
        })
        .unwrap_or(0);
    exact_call_frame_id(shared, &request).map_err(|_| indeterminate_error())?;
    Ok(DebugSetVariableResult { value })
}

fn invalidate_exact_owner_snapshots(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
        || !pause
            .object_ids
            .get(&request.variables_reference)
            .is_some_and(|reference| {
                reference.pause_generation == request.pause_generation
                    && reference.frame_id == request.frame_id
            })
    {
        return Err("The debug mutation owner changed.".to_string());
    }
    invalidate_all_descriptor_snapshots(pause);
    Ok(())
}

struct SnapshotInvalidationGuard<'a> {
    shared: &'a Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
}

impl Drop for SnapshotInvalidationGuard<'_> {
    fn drop(&mut self) {
        let _ = invalidate_exact_owner_snapshots(self.shared, self.request);
    }
}

fn owner_request(request: &DebugSetVariableRequest) -> DebugVariablePageRequest {
    DebugVariablePageRequest {
        pause_generation: request.pause_generation,
        frame_id: request.frame_id,
        variables_reference: request.variables_reference,
        start: 0,
        count: 1,
    }
}

fn exact_call_frame_id(
    shared: &Arc<Mutex<CdpShared>>,
    request: &DebugSetVariableRequest,
) -> Result<String, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_ref()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation {
        return Err("The debug pause owner is stale.".to_string());
    }
    pause
        .call_frame_ids
        .get(&request.frame_id)
        .cloned()
        .ok_or_else(|| format!("Unknown debug frame {}.", request.frame_id))
}

fn ensure_owner(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    after_side_effect: bool,
) -> Result<(), String> {
    if owner_is_current(shared, request)? {
        Ok(())
    } else if after_side_effect {
        Err(indeterminate_error())
    } else {
        Err("The debug pause owner changed before assigning the variable.".to_string())
    }
}

fn ensure_mutation_allowed(
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
) -> Result<(), String> {
    mutation_is_allowed()
        .then_some(())
        .ok_or_else(|| "The debug session no longer permits mutations.".to_string())
}

fn evaluation_result(response: &Value) -> Result<&Value, String> {
    if let Some(details) = response.get("exceptionDetails") {
        return Err(details
            .pointer("/exception/description")
            .and_then(Value::as_str)
            .or_else(|| details.get("text").and_then(Value::as_str))
            .unwrap_or("The value expression could not be evaluated.")
            .to_string());
    }
    response
        .get("result")
        .filter(|result| result.is_object())
        .ok_or_else(|| "The debug engine returned an invalid assigned value.".to_string())
}

fn call_argument(remote: &Value) -> Result<Value, String> {
    let mut argument = Map::new();
    if let Some(object_id) = remote.get("objectId").and_then(Value::as_str) {
        argument.insert("objectId".to_string(), Value::String(object_id.to_string()));
    } else if let Some(value) = remote.get("unserializableValue").and_then(Value::as_str) {
        argument.insert(
            "unserializableValue".to_string(),
            Value::String(value.to_string()),
        );
    } else if let Some(value) = remote.get("value") {
        argument.insert("value".to_string(), value.clone());
    } else if remote.get("type").and_then(Value::as_str) == Some("undefined") {
    } else {
        return Err("The debug engine returned an unsupported assigned value.".to_string());
    }
    Ok(Value::Object(argument))
}

fn release_evaluation_group(client: &CdpClient) {
    let _ = client.request(
        "Runtime.releaseObjectGroup",
        json!({"objectGroup": SET_VALUE_OBJECT_GROUP}),
    );
}

fn fresh_scope_value(client: &CdpClient, evaluated: &Value) -> Result<Value, String> {
    let Some(object_id) = evaluated.get("objectId").and_then(Value::as_str) else {
        return Ok(evaluated.clone());
    };
    let response = client
        .request(
            "Runtime.callFunctionOn",
            json!({
                "objectId": object_id,
                "functionDeclaration": IDENTITY_FUNCTION,
                "arguments": [],
                "objectGroup": "",
                "silent": true,
                "returnByValue": false,
                "generatePreview": false,
                "awaitPromise": false,
            }),
        )
        .map_err(|_| indeterminate_error())?;
    evaluation_result(&response)
        .cloned()
        .map_err(|_| indeterminate_error())
}

fn revalidate_property(
    client: &CdpClient,
    parent: &super::ObjectReference,
    name: &str,
) -> Result<Value, String> {
    let response = client.request(
        "Runtime.getProperties",
        json!({
            "objectId": parent.object_id,
            "ownProperties": true,
            "generatePreview": false,
        }),
    )?;
    let properties = response
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "The debug engine returned invalid property descriptors.".to_string())?;
    if properties.len() > MAX_CDP_PROPERTY_DESCRIPTORS {
        return Err("The object has too many properties to mutate safely.".to_string());
    }
    let mut exact = properties.iter().filter(|property| {
        property.get("name").and_then(Value::as_str) == Some(name)
            && property.get("symbol").is_none()
    });
    let descriptor = exact.next().ok_or_else(|| {
        "The target property no longer exists as an own data property.".to_string()
    })?;
    let safe_scope_name = !matches!(parent.mutation, ObjectReferenceMutation::ScopeSlot { .. })
        || (name != "this" && assigned_evaluate_name(parent, name).is_some());
    if exact.next().is_some() || !is_writable_data_property(descriptor) || !safe_scope_name {
        return Err("The target property is no longer safely writable.".to_string());
    }
    Ok(descriptor.clone())
}

fn indeterminate_error() -> String {
    "The debug variable mutation may have produced side effects, but its final result could not be proven; the result is indeterminate and was not retried."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_cdp::transport::PauseInventory;
    use crate::debug_cdp::variables::{ObjectReference, ObjectReferenceAccess};

    #[test]
    fn call_argument_matches_cdp_for_special_primitives() {
        assert_eq!(
            call_argument(&json!({"type": "undefined"})).expect("undefined"),
            json!({})
        );
        for literal in ["NaN", "-0", "Infinity", "-Infinity", "42n"] {
            assert_eq!(
                call_argument(&json!({
                    "type": if literal.ends_with('n') { "bigint" } else { "number" },
                    "unserializableValue": literal
                }))
                .expect("special primitive"),
                json!({"unserializableValue": literal})
            );
        }
    }

    #[test]
    fn stale_owner_after_side_effect_is_explicitly_indeterminate() {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 7,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(11, "frame".to_string());
        pause.object_ids.insert(
            13,
            ObjectReference {
                frame_id: 11,
                object_id: "scope".to_string(),
                pause_generation: 7,
                evaluate_name: None,
                access: ObjectReferenceAccess::ScopeRoot,
                mutation: ObjectReferenceMutation::ReadOnly,
                lineage: None,
            },
        );
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));
        let request = DebugVariablePageRequest {
            pause_generation: 7,
            frame_id: 11,
            variables_reference: 13,
            start: 0,
            count: 1,
        };
        assert!(ensure_owner(&shared, request, false).is_ok());
        shared.lock().expect("state").invalidate_pause();
        assert!(ensure_owner(&shared, request, false)
            .expect_err("stale before side effect")
            .contains("before assigning"));
        let error = ensure_owner(&shared, request, true).expect_err("stale after side effect");
        assert!(error.contains("indeterminate"));
        assert!(error.contains("not retried"));
    }

    #[test]
    fn final_owner_check_uses_pause_and_frame_after_the_original_reference_is_revoked() {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 7,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(11, "frame".to_string());
        pause.object_ids.insert(
            13,
            ObjectReference {
                frame_id: 11,
                object_id: "object".to_string(),
                pause_generation: 7,
                evaluate_name: Some("object".to_string()),
                access: ObjectReferenceAccess::Object,
                mutation: ObjectReferenceMutation::ObjectProperty {
                    object_id: "object".to_string(),
                },
                lineage: None,
            },
        );
        state.pause = Some(pause);
        let shared = Arc::new(Mutex::new(state));
        let request = DebugSetVariableRequest {
            pause_generation: 7,
            frame_id: 11,
            variables_reference: 13,
            name: "key".to_string(),
            value: "2".to_string(),
        };

        revoke_assigned_property_references(&shared, 7, 11, 13, "key")
            .expect("revoke old property subtree");
        assert_eq!(
            exact_call_frame_id(&shared, &request).expect("pause and frame remain current"),
            "frame"
        );
        shared.lock().expect("state").invalidate_pause();
        assert!(exact_call_frame_id(&shared, &request).is_err());
    }
}
