// Bounded, side-effect-free provenance proof for Watch-root Set Expression.

use super::super::transport::{CdpClient, CdpShared};
use super::set_expression_provenance::{SetExpressionTarget, StaticMemberRootAuthority};
use super::set_expression_target::{
    parse_static_member_target, StaticMemberRoot, StaticMemberSegment, StaticMemberTarget,
};
use super::{
    is_writable_data_property, safe_binding_identifier, ObjectReference, ObjectReferenceAccess,
    ObjectReferenceMutation, MAX_CDP_OBJECT_ID_BYTES, MAX_CDP_OBJECT_REFERENCES_PER_PAUSE,
    MAX_CDP_PROPERTY_DESCRIPTORS,
};
use crate::debug_adapter::variable_name::is_valid_debug_variable_name;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub(super) const MAX_SET_EXPRESSION_PROOF_REQUESTS_PER_PAUSE: usize = 2_048;
pub(super) const MAX_SET_EXPRESSION_PROOF_DESCRIPTORS_PER_PAUSE: usize = 100_000;
const MAX_STATIC_MEMBER_PROOF_DEPTH: usize = 8;
const STRICT_OBJECT_IDENTITY_FUNCTION: &str = "function(other) { return this === other; }";

pub(super) struct PreparedStaticAssignment {
    pub(super) variables_reference: u64,
    pub(super) name: String,
}

pub(super) fn prove_watch_set_expression_target(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    expression: &str,
) -> Option<SetExpressionTarget> {
    if let Some(name) = safe_binding_identifier(expression) {
        return prove_scope_slot(client, shared, pause_generation, frame_id, &name);
    }
    let parsed = parse_static_member_target(expression).ok()?;
    prove_static_member(client, shared, pause_generation, frame_id, &parsed)
}

fn prove_scope_slot(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    name: &str,
) -> Option<SetExpressionTarget> {
    for (variables_reference, scope) in exact_scopes(shared, pause_generation, frame_id)? {
        let properties =
            proof_properties(client, shared, pause_generation, frame_id, &scope.object_id)?;
        let matches = matching_descriptors(&properties, name);
        if matches.is_empty() {
            continue;
        }
        if matches.len() != 1
            || !is_writable_data_property(matches[0])
            || !matches!(scope.mutation, ObjectReferenceMutation::ScopeSlot { .. })
        {
            return None;
        }
        return exact_scope_is_current(shared, pause_generation, frame_id, variables_reference)
            .then_some(SetExpressionTarget::ScopeSlot {
                variables_reference,
                name: name.to_string(),
            });
    }
    None
}

fn prove_static_member(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    target: &StaticMemberTarget,
) -> Option<SetExpressionTarget> {
    if target.segments.is_empty() || target.segments.len() > MAX_STATIC_MEMBER_PROOF_DEPTH {
        return None;
    }
    let (root, mut current_object_id) =
        prove_static_root(client, shared, pause_generation, frame_id, &target.root)?;
    let mut expected_object_ids = vec![current_object_id.clone()];
    for (index, segment) in target.segments.iter().enumerate() {
        let name = segment_name(segment);
        if !valid_property_name(&name) {
            return None;
        }
        let properties = proof_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &current_object_id,
        )?;
        let matches = matching_descriptors(&properties, &name);
        if matches.len() != 1 {
            return None;
        }
        if index + 1 == target.segments.len() {
            if !is_writable_data_property(matches[0]) {
                return None;
            }
        } else {
            current_object_id = ordinary_data_object_id(matches[0])?.to_string();
            expected_object_ids.push(current_object_id.clone());
        }
    }
    exact_static_owner_is_current(shared, pause_generation, frame_id, &root).then_some(
        SetExpressionTarget::StaticProperty {
            root,
            segments: target.segments.clone(),
            expected_object_ids,
        },
    )
}

fn prove_static_root(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRoot,
) -> Option<(StaticMemberRootAuthority, String)> {
    if *root == StaticMemberRoot::This {
        return exact_this_object_id(shared, pause_generation, frame_id)
            .map(|object_id| (StaticMemberRootAuthority::This, object_id));
    }
    let StaticMemberRoot::Binding(root_name) = root else {
        return None;
    };
    if !valid_property_name(root_name) {
        return None;
    }
    for (reference, scope) in exact_scopes(shared, pause_generation, frame_id)? {
        let properties =
            proof_properties(client, shared, pause_generation, frame_id, &scope.object_id)?;
        let matches = matching_descriptors(&properties, root_name);
        if matches.is_empty() {
            continue;
        }
        if matches.len() != 1
            || !matches!(scope.mutation, ObjectReferenceMutation::ScopeSlot { .. })
        {
            return None;
        }
        return ordinary_data_object_id(matches[0]).map(|object_id| {
            (
                StaticMemberRootAuthority::Binding {
                    root_scope_reference: reference,
                    root_name: root_name.clone(),
                },
                object_id.to_string(),
            )
        });
    }
    None
}

pub(super) fn prepare_static_assignment(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    target: &SetExpressionTarget,
) -> Result<PreparedStaticAssignment, String> {
    let SetExpressionTarget::StaticProperty {
        root,
        segments,
        expected_object_ids,
    } = target
    else {
        return Err("The set-expression target is not a static property.".to_string());
    };
    validate_static_shape(root, segments, expected_object_ids)?;
    let mut current_object_id =
        revalidate_static_root(client, shared, pause_generation, frame_id, root)?;
    if !same_object_identity(
        client,
        shared,
        pause_generation,
        frame_id,
        root,
        &expected_object_ids[0],
        &current_object_id,
    )? {
        return Err("The static-property root object changed before assignment.".to_string());
    }

    for (index, segment) in segments
        .iter()
        .take(segments.len().saturating_sub(1))
        .enumerate()
    {
        let name = segment_name(segment);
        let properties = proof_properties(
            client,
            shared,
            pause_generation,
            frame_id,
            &current_object_id,
        )
        .ok_or_else(|| "The static-property chain could not be revalidated.".to_string())?;
        let matches = matching_descriptors(&properties, &name);
        current_object_id = exact_ordinary_object_id(&matches)?;
        if !same_object_identity(
            client,
            shared,
            pause_generation,
            frame_id,
            root,
            &expected_object_ids[index + 1],
            &current_object_id,
        )? {
            return Err("The static-property object chain changed before assignment.".to_string());
        }
    }

    let terminal_name = segment_name(segments.last().expect("non-empty proof"));
    if !valid_property_name(&terminal_name) {
        return Err("The static-property terminal key is invalid.".to_string());
    }
    let terminal_properties = proof_properties(
        client,
        shared,
        pause_generation,
        frame_id,
        &current_object_id,
    )
    .ok_or_else(|| "The static-property terminal could not be revalidated.".to_string())?;
    let terminal_matches = matching_descriptors(&terminal_properties, &terminal_name);
    if terminal_matches.len() != 1 || !is_writable_data_property(terminal_matches[0]) {
        return Err("The static-property terminal is no longer safely writable.".to_string());
    }

    let variables_reference = register_ephemeral_parent(
        shared,
        pause_generation,
        frame_id,
        root,
        &expected_object_ids[0],
        current_object_id,
    )?;
    Ok(PreparedStaticAssignment {
        variables_reference,
        name: terminal_name,
    })
}

fn validate_static_shape(
    root: &StaticMemberRootAuthority,
    segments: &[StaticMemberSegment],
    expected_object_ids: &[String],
) -> Result<(), String> {
    if segments.is_empty()
        || segments.len() > MAX_STATIC_MEMBER_PROOF_DEPTH
        || expected_object_ids.len() != segments.len()
        || matches!(root, StaticMemberRootAuthority::Binding { root_name, .. } if !valid_property_name(root_name))
    {
        Err("The static-property proof shape is invalid.".to_string())
    } else {
        Ok(())
    }
}

fn same_object_identity(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRootAuthority,
    captured_object_id: &str,
    current_object_id: &str,
) -> Result<bool, String> {
    if [captured_object_id, current_object_id]
        .into_iter()
        .any(|id| id.is_empty() || id.len() > MAX_CDP_OBJECT_ID_BYTES)
    {
        return Err("The static-property object identity is invalid.".to_string());
    }
    ensure_static_owner(shared, pause_generation, frame_id, root)?;
    if captured_object_id == current_object_id {
        return Ok(true);
    }
    reserve_proof_request(shared, pause_generation, frame_id)
        .ok_or_else(|| "The static-property identity proof budget was exhausted.".to_string())?;
    let timeout_ms = u64::try_from(client.request_timeout.as_millis()).unwrap_or(u64::MAX);
    let response = client
        .request(
            "Runtime.callFunctionOn",
            json!({
                "objectId": captured_object_id,
                "functionDeclaration": STRICT_OBJECT_IDENTITY_FUNCTION,
                "arguments": [{"objectId": current_object_id}],
                "silent": true,
                "returnByValue": true,
                "generatePreview": false,
                "awaitPromise": false,
                "timeout": timeout_ms,
            }),
        )
        .map_err(|_| "The static-property object identity could not be proven.".to_string())?;
    ensure_static_owner(shared, pause_generation, frame_id, root)?;
    if response.get("exceptionDetails").is_some() {
        return Err("The static-property object identity proof failed.".to_string());
    }
    let result = response
        .get("result")
        .ok_or_else(|| "The static-property object identity response is invalid.".to_string())?;
    if result.get("type").and_then(Value::as_str) != Some("boolean") {
        return Err("The static-property object identity response is invalid.".to_string());
    }
    result
        .get("value")
        .and_then(Value::as_bool)
        .ok_or_else(|| "The static-property object identity response is invalid.".to_string())
}

fn exact_ordinary_object_id(matches: &[&Value]) -> Result<String, String> {
    if matches.len() != 1 {
        return Err("The static-property descriptor is no longer exact.".to_string());
    }
    ordinary_data_object_id(matches[0])
        .map(str::to_string)
        .ok_or_else(|| {
            "The static-property descriptor is no longer an ordinary data object.".to_string()
        })
}

fn exact_static_root(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    reference: u64,
) -> Result<ObjectReference, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_ref()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The static-property proof owner is stale.".to_string());
    }
    let owned = pause
        .object_ids
        .get(&reference)
        .filter(|owned| {
            owned.pause_generation == pause_generation
                && owned.frame_id == frame_id
                && owned.access == ObjectReferenceAccess::ScopeRoot
                && matches!(owned.mutation, ObjectReferenceMutation::ScopeSlot { .. })
        })
        .cloned()
        .ok_or_else(|| "The static-property root scope is no longer exact.".to_string())?;
    Ok(owned)
}

fn exact_this_object_id(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Option<String> {
    let state = shared.lock().ok()?;
    let pause = state.pause.as_ref()?;
    (pause.pause_generation == pause_generation && pause.call_frame_ids.contains_key(&frame_id))
        .then(|| pause.call_frame_this_object_ids.get(&frame_id).cloned())
        .flatten()
}

fn ensure_static_owner(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRootAuthority,
) -> Result<(), String> {
    match root {
        StaticMemberRootAuthority::Binding {
            root_scope_reference,
            ..
        } => exact_static_root(shared, pause_generation, frame_id, *root_scope_reference).map(drop),
        StaticMemberRootAuthority::This => exact_this_object_id(shared, pause_generation, frame_id)
            .map(drop)
            .ok_or_else(|| "The static-property `this` owner is stale.".to_string()),
    }
}

fn exact_static_owner_is_current(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRootAuthority,
) -> bool {
    ensure_static_owner(shared, pause_generation, frame_id, root).is_ok()
}

fn revalidate_static_root(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRootAuthority,
) -> Result<String, String> {
    match root {
        StaticMemberRootAuthority::This => exact_this_object_id(shared, pause_generation, frame_id)
            .ok_or_else(|| "The static-property `this` owner is stale.".to_string()),
        StaticMemberRootAuthority::Binding {
            root_scope_reference,
            root_name,
        } => {
            let scope =
                exact_static_root(shared, pause_generation, frame_id, *root_scope_reference)?;
            let properties =
                proof_properties(client, shared, pause_generation, frame_id, &scope.object_id)
                    .ok_or_else(|| {
                        "The static-property root could not be revalidated.".to_string()
                    })?;
            exact_ordinary_object_id(&matching_descriptors(&properties, root_name))
        }
    }
}

fn register_ephemeral_parent(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    root: &StaticMemberRootAuthority,
    expected_root_object_id: &str,
    object_id: String,
) -> Result<u64, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_ref()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation
        || !pause.call_frame_ids.contains_key(&frame_id)
        || pause.object_ids.len() >= MAX_CDP_OBJECT_REFERENCES_PER_PAUSE
    {
        return Err("The static-property proof owner or reference capacity changed.".to_string());
    }
    let root_is_exact = match root {
        StaticMemberRootAuthority::Binding {
            root_scope_reference,
            ..
        } => pause
            .object_ids
            .get(root_scope_reference)
            .is_some_and(|owned| {
                owned.pause_generation == pause_generation
                    && owned.frame_id == frame_id
                    && owned.access == ObjectReferenceAccess::ScopeRoot
                    && matches!(owned.mutation, ObjectReferenceMutation::ScopeSlot { .. })
            }),
        StaticMemberRootAuthority::This => pause
            .call_frame_this_object_ids
            .get(&frame_id)
            .is_some_and(|object_id| object_id == expected_root_object_id),
    };
    if !root_is_exact {
        return Err("The static-property root scope changed before assignment.".to_string());
    }
    let reference = state.allocate_id();
    let pause = state.pause.as_mut().expect("validated pause");
    pause.object_ids.insert(
        reference,
        ObjectReference {
            frame_id,
            object_id: object_id.clone(),
            pause_generation,
            evaluate_name: None,
            access: ObjectReferenceAccess::Object,
            mutation: ObjectReferenceMutation::ObjectProperty { object_id },
            lineage: None,
        },
    );
    Ok(reference)
}

fn exact_scopes(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Option<Vec<(u64, ObjectReference)>> {
    let state = shared.lock().ok()?;
    let pause = state.pause.as_ref()?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return None;
    }
    pause
        .scopes
        .get(&frame_id)?
        .iter()
        .map(|scope| {
            let owned = pause.object_ids.get(&scope.variables_reference)?;
            (owned.pause_generation == pause_generation
                && owned.frame_id == frame_id
                && owned.access == ObjectReferenceAccess::ScopeRoot)
                .then(|| (scope.variables_reference, owned.clone()))
        })
        .collect()
}

fn proof_properties(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    object_id: &str,
) -> Option<Vec<Value>> {
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return None;
    }
    reserve_proof_request(shared, pause_generation, frame_id)?;
    let response = client
        .request(
            "Runtime.getProperties",
            json!({
                "objectId": object_id,
                "ownProperties": true,
                "generatePreview": false,
            }),
        )
        .ok()?;
    let properties = response.get("result")?.as_array()?;
    let descriptor_count = ["result", "privateProperties", "internalProperties"]
        .into_iter()
        .filter_map(|key| response.get(key).and_then(Value::as_array))
        .try_fold(0usize, |count, descriptors| {
            count.checked_add(descriptors.len())
        })?;
    charge_proof_descriptors(shared, pause_generation, frame_id, descriptor_count)?;
    (descriptor_count <= MAX_CDP_PROPERTY_DESCRIPTORS).then(|| properties.clone())
}

fn reserve_proof_request(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Option<()> {
    let mut state = shared.lock().ok()?;
    let pause = state.pause.as_mut()?;
    if pause.pause_generation != pause_generation
        || !pause.call_frame_ids.contains_key(&frame_id)
        || pause.set_expression_proof_requests >= MAX_SET_EXPRESSION_PROOF_REQUESTS_PER_PAUSE
    {
        return None;
    }
    pause.set_expression_proof_requests += 1;
    Some(())
}

fn charge_proof_descriptors(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    count: usize,
) -> Option<()> {
    let mut state = shared.lock().ok()?;
    let pause = state.pause.as_mut()?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return None;
    }
    let next = pause.set_expression_proof_descriptors.checked_add(count)?;
    if next > MAX_SET_EXPRESSION_PROOF_DESCRIPTORS_PER_PAUSE {
        pause.set_expression_proof_descriptors = MAX_SET_EXPRESSION_PROOF_DESCRIPTORS_PER_PAUSE;
        return None;
    }
    pause.set_expression_proof_descriptors = next;
    Some(())
}

fn exact_scope_is_current(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    reference: u64,
) -> bool {
    shared.lock().ok().is_some_and(|state| {
        state.pause.as_ref().is_some_and(|pause| {
            pause.pause_generation == pause_generation
                && pause.call_frame_ids.contains_key(&frame_id)
                && pause.object_ids.get(&reference).is_some_and(|owned| {
                    owned.pause_generation == pause_generation
                        && owned.frame_id == frame_id
                        && owned.access == ObjectReferenceAccess::ScopeRoot
                        && matches!(owned.mutation, ObjectReferenceMutation::ScopeSlot { .. })
                })
        })
    })
}

fn matching_descriptors<'a>(properties: &'a [Value], name: &str) -> Vec<&'a Value> {
    properties
        .iter()
        .filter(|property| {
            property.get("name").and_then(Value::as_str) == Some(name)
                && property.get("symbol").is_none()
        })
        .collect()
}

fn ordinary_data_object_id(property: &Value) -> Option<&str> {
    if property.get("get").is_some() || property.get("set").is_some() {
        return None;
    }
    let remote = property.get("value")?;
    if remote.get("type").and_then(Value::as_str) != Some("object")
        || remote
            .get("subtype")
            .and_then(Value::as_str)
            .is_some_and(|subtype| subtype == "proxy" || subtype.starts_with("internal#"))
    {
        return None;
    }
    remote
        .get("objectId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= MAX_CDP_OBJECT_ID_BYTES)
}

fn segment_name(segment: &StaticMemberSegment) -> String {
    match segment {
        StaticMemberSegment::Member(name) | StaticMemberSegment::StringKey(name) => name.clone(),
        StaticMemberSegment::CanonicalNumericIndex(index) => index.to_string(),
    }
}

fn valid_property_name(name: &str) -> bool {
    is_valid_debug_variable_name(name) && !matches!(name, "__proto__" | "prototype" | "constructor")
}

#[cfg(test)]
mod tests {
    use super::super::mint_watch_set_expression_reference;
    use super::super::set_expression_provenance::SetExpressionReference;
    use super::super::MAX_CDP_OBJECT_REFERENCES_PER_PAUSE;
    use super::*;
    use crate::debug_adapter::DebugScopeInfo;
    use crate::debug_cdp::transport::PauseInventory;

    fn paused_shared() -> Arc<Mutex<CdpShared>> {
        let mut state = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 7,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(11, "frame".to_string());
        state.pause = Some(pause);
        Arc::new(Mutex::new(state))
    }

    #[test]
    fn proof_budgets_are_exact_monotonic_and_new_pause_owned() {
        let shared = paused_shared();
        {
            let mut state = shared.lock().expect("state");
            let pause = state.pause.as_mut().expect("pause");
            pause.set_expression_proof_requests = MAX_SET_EXPRESSION_PROOF_REQUESTS_PER_PAUSE - 1;
            pause.set_expression_proof_descriptors =
                MAX_SET_EXPRESSION_PROOF_DESCRIPTORS_PER_PAUSE - 1;
        }
        assert_eq!(reserve_proof_request(&shared, 7, 11), Some(()));
        assert_eq!(reserve_proof_request(&shared, 7, 11), None);
        assert_eq!(reserve_proof_request(&shared, 8, 11), None);
        assert_eq!(reserve_proof_request(&shared, 7, 12), None);
        assert_eq!(charge_proof_descriptors(&shared, 7, 11, 2), None);
        assert_eq!(charge_proof_descriptors(&shared, 8, 11, 0), None);
        let state = shared.lock().expect("state");
        let pause = state.pause.as_ref().expect("pause");
        assert_eq!(
            pause.set_expression_proof_requests,
            MAX_SET_EXPRESSION_PROOF_REQUESTS_PER_PAUSE
        );
        assert_eq!(
            pause.set_expression_proof_descriptors,
            MAX_SET_EXPRESSION_PROOF_DESCRIPTORS_PER_PAUSE
        );
        assert_eq!(PauseInventory::default().set_expression_proof_requests, 0);
        assert_eq!(
            PauseInventory::default().set_expression_proof_descriptors,
            0
        );
    }

    #[test]
    fn invalid_nearer_scope_inventory_aborts_instead_of_falling_through() {
        let shared = paused_shared();
        let mut state = shared.lock().expect("state");
        let pause = state.pause.as_mut().expect("pause");
        pause.scopes.insert(
            11,
            vec![
                DebugScopeInfo {
                    name: "Local".to_string(),
                    variables_reference: 90,
                    expensive: false,
                },
                DebugScopeInfo {
                    name: "Closure".to_string(),
                    variables_reference: 91,
                    expensive: false,
                },
            ],
        );
        pause.object_ids.insert(
            91,
            ObjectReference {
                frame_id: 11,
                object_id: "outer".to_string(),
                pause_generation: 7,
                evaluate_name: None,
                access: ObjectReferenceAccess::ScopeRoot,
                mutation: ObjectReferenceMutation::ReadOnly,
                lineage: None,
            },
        );
        drop(state);
        assert_eq!(exact_scopes(&shared, 7, 11), None);
        assert!(shared
            .lock()
            .expect("state")
            .pause
            .as_ref()
            .expect("pause")
            .set_expression_references
            .is_empty());
    }

    #[test]
    fn static_target_uses_the_last_shared_token_slot_atomically() {
        let shared = paused_shared();
        {
            let mut state = shared.lock().expect("state");
            let pause = state.pause.as_mut().expect("pause");
            pause.object_ids.insert(
                17,
                ObjectReference {
                    frame_id: 11,
                    object_id: "scope".to_string(),
                    pause_generation: 7,
                    evaluate_name: None,
                    access: ObjectReferenceAccess::ScopeRoot,
                    mutation: ObjectReferenceMutation::ScopeSlot {
                        call_frame_id: "frame".to_string(),
                        scope_number: 0,
                        scope_kind: super::super::MutableScopeKind::Local,
                    },
                    lineage: None,
                },
            );
            for offset in 0..(MAX_CDP_OBJECT_REFERENCES_PER_PAUSE - 1) {
                pause.set_expression_references.insert(
                    10_000 + offset as u64,
                    SetExpressionReference {
                        frame_id: 11,
                        pause_generation: 7,
                        expression: "seed".to_string(),
                        target: SetExpressionTarget::ScopeSlot {
                            variables_reference: 17,
                            name: "seed".to_string(),
                        },
                    },
                );
            }
        }
        let static_target = SetExpressionTarget::StaticProperty {
            root: StaticMemberRootAuthority::Binding {
                root_scope_reference: 17,
                root_name: "root".to_string(),
            },
            segments: vec![StaticMemberSegment::Member("leaf".to_string())],
            expected_object_ids: vec!["object".to_string()],
        };
        assert!(
            mint_watch_set_expression_reference(&shared, 7, 11, "root.leaf", static_target)
                .is_some()
        );
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .set_expression_references
                .len(),
            MAX_CDP_OBJECT_REFERENCES_PER_PAUSE
        );
        assert_eq!(
            mint_watch_set_expression_reference(
                &shared,
                7,
                11,
                "count",
                SetExpressionTarget::ScopeSlot {
                    variables_reference: 17,
                    name: "count".to_string(),
                },
            ),
            None
        );
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .set_expression_references
                .len(),
            MAX_CDP_OBJECT_REFERENCES_PER_PAUSE
        );
    }

    #[test]
    fn malformed_shape_and_ephemeral_capacity_or_owner_fail_without_mutable_parent() {
        let segments = vec![StaticMemberSegment::Member("leaf".to_string())];
        let root = StaticMemberRootAuthority::Binding {
            root_scope_reference: 17,
            root_name: "root".to_string(),
        };
        assert!(validate_static_shape(&root, &segments, &[]).is_err());
        assert!(validate_static_shape(&root, &[], &[]).is_err());
        assert!(validate_static_shape(&root, &segments, &["object".to_string()]).is_ok());

        let shared = paused_shared();
        {
            let mut state = shared.lock().expect("state");
            let pause = state.pause.as_mut().expect("pause");
            pause.object_ids.insert(
                17,
                ObjectReference {
                    frame_id: 11,
                    object_id: "scope".to_string(),
                    pause_generation: 7,
                    evaluate_name: None,
                    access: ObjectReferenceAccess::ScopeRoot,
                    mutation: ObjectReferenceMutation::ScopeSlot {
                        call_frame_id: "frame".to_string(),
                        scope_number: 0,
                        scope_kind: super::super::MutableScopeKind::Local,
                    },
                    lineage: None,
                },
            );
        }
        assert!(
            register_ephemeral_parent(&shared, 7, 12, &root, "object", "parent".to_string())
                .is_err()
        );
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .object_ids
                .len(),
            1
        );

        {
            let mut state = shared.lock().expect("state");
            let pause = state.pause.as_mut().expect("pause");
            for reference in 18..=(MAX_CDP_OBJECT_REFERENCES_PER_PAUSE as u64 + 16) {
                pause.object_ids.insert(
                    reference,
                    ObjectReference {
                        frame_id: 11,
                        object_id: format!("object-{reference}"),
                        pause_generation: 7,
                        evaluate_name: None,
                        access: ObjectReferenceAccess::Object,
                        mutation: ObjectReferenceMutation::ReadOnly,
                        lineage: None,
                    },
                );
            }
        }
        let before = shared
            .lock()
            .expect("state")
            .pause
            .as_ref()
            .expect("pause")
            .object_ids
            .len();
        assert_eq!(before, MAX_CDP_OBJECT_REFERENCES_PER_PAUSE);
        assert!(
            register_ephemeral_parent(&shared, 7, 11, &root, "object", "parent".to_string())
                .is_err()
        );
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .object_ids
                .len(),
            before
        );
    }

    #[test]
    fn this_tokens_and_ephemeral_parents_require_the_exact_authoritative_receiver() {
        let shared = paused_shared();
        let segments = vec![StaticMemberSegment::Member("leaf".to_string())];
        let target = |expected: &str| SetExpressionTarget::StaticProperty {
            root: StaticMemberRootAuthority::This,
            segments: segments.clone(),
            expected_object_ids: vec![expected.to_string()],
        };
        assert_eq!(
            mint_watch_set_expression_reference(&shared, 7, 11, "this.leaf", target("this-1")),
            None,
            "a missing receiver must fail closed"
        );
        shared
            .lock()
            .expect("state")
            .pause
            .as_mut()
            .expect("pause")
            .call_frame_this_object_ids
            .insert(11, "this-1".to_string());
        assert!(
            mint_watch_set_expression_reference(&shared, 7, 11, "this.leaf", target("this-1"))
                .is_some()
        );
        assert_eq!(
            mint_watch_set_expression_reference(&shared, 7, 11, "this.leaf", target("this-2")),
            None,
            "a changed receiver must not mint a token"
        );
        shared
            .lock()
            .expect("state")
            .pause
            .as_mut()
            .expect("pause")
            .call_frame_this_object_ids
            .remove(&11);
        assert!(register_ephemeral_parent(
            &shared,
            7,
            11,
            &StaticMemberRootAuthority::This,
            "this-1",
            "parent".to_string()
        )
        .is_err());
    }
}
