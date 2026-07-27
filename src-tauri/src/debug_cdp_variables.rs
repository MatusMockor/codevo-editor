//! Count-bounded CDP paging; descriptor byte limits are post-receipt, not wire bounds.

use self::set_expression_provenance::{SetExpressionReference, SetExpressionTarget};
use super::transport::{CdpClient, CdpShared};
use crate::debug_adapter::variable_name::is_valid_debug_variable_name;
use crate::debug_adapter::{
    DebugEvaluateFailure, DebugVariableFilter, DebugVariableInfo, DebugVariablePage,
    DebugVariablePageRequest,
};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

mod evaluate_name {
    include!("debug_cdp_evaluate_name.rs");
}
use evaluate_name::{
    evaluation_evaluate_name, evaluation_parent_accessor, is_reserved_binding_word,
    nested_evaluate_name, private_evaluate_name, scope_child_evaluate_name,
    simple_binding_identifier,
};

#[path = "debug_cdp_descriptor_snapshot_policy.rs"]
mod descriptor_snapshot_policy;
use descriptor_snapshot_policy::{retained_descriptor_prefix_search, validate_property_descriptor};

#[path = "debug_cdp_collection_variables.rs"]
mod collection_variables;
use collection_variables::{acquire_descriptor_sources_with_page_load, remote_object_access};

pub(super) mod set_variable {
    include!("debug_cdp_set_variable.rs");
}

pub(super) mod set_expression {
    include!("debug_cdp_set_expression.rs");
}

pub(super) mod set_expression_target {
    include!("debug_cdp_set_expression_target.rs");
}

pub(super) mod set_expression_provenance {
    include!("debug_cdp_set_expression_provenance.rs");
}

pub(super) mod set_expression_proof {
    include!("debug_cdp_set_expression_proof.rs");
}

pub(super) const MAX_CDP_PROPERTY_DESCRIPTORS: usize = 10_000;
pub(super) const MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION: usize = 512;
pub(super) const CDP_COLLECTION_ENTRY_WINDOW_SIZE: usize = 16;
pub(super) const CDP_COLLECTION_ENTRY_WINDOW_FUNCTION: &str = "function(start, count) { const page = [count > 0 ? this[start] : void 0, count > 1 ? this[start + 1] : void 0, count > 2 ? this[start + 2] : void 0, count > 3 ? this[start + 3] : void 0, count > 4 ? this[start + 4] : void 0, count > 5 ? this[start + 5] : void 0, count > 6 ? this[start + 6] : void 0, count > 7 ? this[start + 7] : void 0, count > 8 ? this[start + 8] : void 0, count > 9 ? this[start + 9] : void 0, count > 10 ? this[start + 10] : void 0, count > 11 ? this[start + 11] : void 0, count > 12 ? this[start + 12] : void 0, count > 13 ? this[start + 13] : void 0, count > 14 ? this[start + 14] : void 0, count > 15 ? this[start + 15] : void 0]; page.length = count; return page; }";
const _: () = assert!(MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION == 512);
const _: () = assert!(CDP_COLLECTION_ENTRY_WINDOW_SIZE == 16);
const _: () = assert!(
    (1 + MAX_CDP_COLLECTION_ENTRIES_PER_COLLECTION.div_ceil(CDP_COLLECTION_ENTRY_WINDOW_SIZE) * 2)
        * 8
        < MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE
);
pub(super) const MAX_CDP_PROPERTY_DESCRIPTOR_BYTES_PER_PAUSE: usize = 4 * 1024 * 1024;
pub(super) const MAX_CDP_OBJECT_REFERENCES_PER_PAUSE: usize = 4_096;
pub(super) const MAX_CDP_OBJECT_REFERENCE_BYTES_PER_PAUSE: usize = 4 * 1024 * 1024;
pub(super) const MAX_CDP_OBJECT_ID_BYTES: usize = 4 * 1024;
pub(super) const MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE: usize = 1024;
pub(super) const MAX_CDP_VARIABLE_MUTATIONS_PER_PAUSE: usize = 128;
const MAX_VARIABLE_PAGE_JSON_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug)]
pub(super) struct CachedPropertyDescriptor {
    property: Value,
    private: bool,
    indexed: bool,
    encoded_bytes: usize,
    prefix_bytes: usize,
}

#[derive(Clone, Debug)]
pub(super) struct PropertyDescriptorSnapshot {
    descriptors: Vec<CachedPropertyDescriptor>,
    indexed_indices: Vec<usize>,
    named_indices: Vec<usize>,
    complete: bool,
    limit_reason: Option<crate::debug_adapter::DebugVariablePageLimitReason>,
}

pub(super) type PropertyDescriptorSnapshots = HashMap<u64, Arc<PropertyDescriptorSnapshot>>;

pub(super) fn ensure_evaluation_owner(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
) -> Result<(), DebugEvaluateFailure> {
    let shared = shared
        .lock()
        .map_err(|error| DebugEvaluateFailure::exception(error.to_string()))?;
    let current = shared.pause.as_ref().is_some_and(|pause| {
        pause.pause_generation == pause_generation && pause.call_frame_ids.contains_key(&frame_id)
    });
    current.then_some(()).ok_or_else(|| {
        DebugEvaluateFailure::exception(
            "The debugger pause owner changed while evaluating the expression.",
        )
    })
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) enum MutableScopeKind {
    Local,
    Closure,
    Catch,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) enum ObjectReferenceMutation {
    ScopeSlot {
        call_frame_id: String,
        scope_number: u32,
        scope_kind: MutableScopeKind,
    },
    ObjectProperty {
        object_id: String,
    },
    ReadOnly,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) enum ObjectReferenceAccess {
    ScopeRoot,
    Object,
    Collection,
}

pub(super) fn scope_mutation(
    call_frame_id: Option<&str>,
    scope_number: usize,
    scope_type: &str,
) -> ObjectReferenceMutation {
    let scope_kind = match scope_type {
        "local" => MutableScopeKind::Local,
        "closure" => MutableScopeKind::Closure,
        "catch" => MutableScopeKind::Catch,
        _ => return ObjectReferenceMutation::ReadOnly,
    };
    let Some(call_frame_id) = call_frame_id
        .filter(|id| !id.is_empty() && id.len() <= MAX_CDP_OBJECT_ID_BYTES)
        .map(str::to_string)
    else {
        return ObjectReferenceMutation::ReadOnly;
    };
    let Ok(scope_number) = u32::try_from(scope_number) else {
        return ObjectReferenceMutation::ReadOnly;
    };
    ObjectReferenceMutation::ScopeSlot {
        call_frame_id,
        scope_number,
        scope_kind,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ObjectReference {
    pub(super) frame_id: u64,
    pub(super) object_id: String,
    pub(super) pause_generation: u64,
    pub(super) evaluate_name: Option<String>,
    pub(super) access: ObjectReferenceAccess,
    pub(super) mutation: ObjectReferenceMutation,
    pub(super) lineage: Option<ObjectReferenceLineage>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) struct ObjectReferenceLineage {
    parent_reference: u64,
    property_name: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) struct ObjectReferenceKey {
    frame_id: u64,
    object_id: String,
    evaluate_name: Option<String>,
    mutation: ObjectReferenceMutation,
    lineage: Option<ObjectReferenceLineage>,
    access: ObjectReferenceAccess,
}

struct ObjectReferenceRegistration<'a> {
    object_id: &'a str,
    evaluate_name: Option<String>,
    mutation: ObjectReferenceMutation,
    lineage: Option<ObjectReferenceLineage>,
    access: ObjectReferenceAccess,
}

pub(super) fn variable_from_remote_object(
    name: &str,
    remote: &Value,
    shared: &Arc<Mutex<CdpShared>>,
    owner: Option<(u64, u64)>,
    evaluate_name: Option<String>,
    mutation: ObjectReferenceMutation,
) -> DebugVariableInfo {
    let type_name = remote.get("type").and_then(Value::as_str);
    let value_type = match type_name {
        Some("object") => remote
            .get("className")
            .and_then(Value::as_str)
            .or_else(|| remote.get("subtype").and_then(Value::as_str))
            .or(type_name),
        other => other,
    }
    .map(str::to_string);
    let value = remote
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| remote.get("value").map(render_primitive_value))
        .unwrap_or_else(|| "undefined".to_string());
    let variables_reference = remote
        .get("objectId")
        .and_then(Value::as_str)
        .filter(|_| remote.get("subtype").and_then(Value::as_str) != Some("proxy"))
        .and_then(|object_id| {
            owner.and_then(|(pause_generation, frame_id)| {
                register_object_reference_with_lineage(
                    shared,
                    pause_generation,
                    frame_id,
                    ObjectReferenceRegistration {
                        object_id,
                        evaluate_name: evaluate_name
                            .as_deref()
                            .and_then(evaluation_parent_accessor),
                        mutation: mutation.clone(),
                        lineage: None,
                        access: remote_object_access(remote),
                    },
                )
            })
        })
        .unwrap_or(0);
    DebugVariableInfo {
        name: name.to_string(),
        value,
        value_type,
        evaluate_name,
        variables_reference,
        can_set_value: None,
        set_expression_reference: None,
    }
}

pub(super) fn safe_evaluation_name(expression: &str) -> Option<String> {
    evaluation_evaluate_name(expression)
}

pub(super) fn safe_binding_identifier(expression: &str) -> Option<String> {
    simple_binding_identifier(expression)
}

pub(super) fn is_reserved_target_root(value: &str) -> bool {
    is_reserved_binding_word(value) || value == "this"
}

pub(super) fn register_watch_set_expression_reference(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    expression: &str,
) -> Option<u64> {
    let target = set_expression_proof::prove_watch_set_expression_target(
        client,
        shared,
        pause_generation,
        frame_id,
        expression,
    )?;
    mint_watch_set_expression_reference(shared, pause_generation, frame_id, expression, target)
}

fn mint_watch_set_expression_reference(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    expression: &str,
    target: SetExpressionTarget,
) -> Option<u64> {
    let mut state = shared.lock().ok()?;
    let pause = state.pause.as_mut()?;
    if pause.pause_generation != pause_generation
        || !pause.call_frame_ids.contains_key(&frame_id)
        || pause.set_expression_references.len() >= MAX_CDP_OBJECT_REFERENCES_PER_PAUSE
    {
        return None;
    }
    let owner_is_exact = match &target {
        SetExpressionTarget::ScopeSlot {
            variables_reference,
            ..
        } => pause
            .object_ids
            .get(variables_reference)
            .is_some_and(|owned| {
                owned.pause_generation == pause_generation
                    && owned.frame_id == frame_id
                    && owned.access == ObjectReferenceAccess::ScopeRoot
                    && matches!(owned.mutation, ObjectReferenceMutation::ScopeSlot { .. })
            }),
        SetExpressionTarget::StaticProperty {
            root,
            segments,
            expected_object_ids,
            ..
        } if !segments.is_empty() && expected_object_ids.len() == segments.len() => match root {
            set_expression_provenance::StaticMemberRootAuthority::Binding {
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
            set_expression_provenance::StaticMemberRootAuthority::This => pause
                .call_frame_this_object_ids
                .get(&frame_id)
                .is_some_and(|object_id| object_id == &expected_object_ids[0]),
        },
        SetExpressionTarget::StaticProperty { .. } => return None,
    };
    if !owner_is_exact {
        return None;
    }
    let token = state.allocate_id();
    if token > 9_007_199_254_740_991 {
        return None;
    }
    let pause = state.pause.as_mut()?;
    pause.set_expression_references.insert(
        token,
        SetExpressionReference {
            frame_id,
            pause_generation,
            expression: expression.to_string(),
            target,
        },
    );
    Some(token)
}

pub(super) fn assigned_evaluate_name(parent: &ObjectReference, name: &str) -> Option<String> {
    match parent.access {
        ObjectReferenceAccess::ScopeRoot => scope_child_evaluate_name(name, false),
        ObjectReferenceAccess::Object | ObjectReferenceAccess::Collection => {
            nested_evaluate_name(parent.evaluate_name.as_deref(), name, false)
        }
    }
}

pub(super) fn load_variables_page(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    filter: DebugVariableFilter,
) -> Result<DebugVariablePage, String> {
    validate_request(request)?;
    let parent = owned_object_reference(shared, request)?;
    let snapshot = descriptor_snapshot(client, shared, request, &parent)?;
    let descriptors_truncated = !snapshot.complete;
    let indices = match filter {
        DebugVariableFilter::Indexed => &snapshot.indexed_indices,
        DebugVariableFilter::Named => &snapshot.named_indices,
    };
    let available = indices.len() as u64;
    let total = (!descriptors_truncated).then_some(available);
    let mut variables = Vec::new();
    let mut aggregate_bytes = 2usize;
    let mut aggregate_truncated = false;
    let mut capability_truncated = false;
    let mut child_limit_reason = None;
    for descriptor_index in indices
        .iter()
        .skip(request.start as usize)
        .take(request.count as usize)
    {
        let descriptor = &snapshot.descriptors[*descriptor_index];
        let property = &descriptor.property;
        let private = descriptor.private;
        let remote = property.get("value").expect("filtered value descriptor");
        let name = property.get("name").and_then(Value::as_str).unwrap_or("");
        let valid_mutation_name = is_valid_debug_variable_name(name);
        let synthetic = property.get("symbol").is_some()
            || remote
                .get("subtype")
                .and_then(Value::as_str)
                .is_some_and(|subtype| subtype.starts_with("internal#"));
        let evaluate_name = if parent.access == ObjectReferenceAccess::ScopeRoot {
            scope_child_evaluate_name(name, synthetic)
        } else if private {
            private_evaluate_name(parent.evaluate_name.as_deref(), name, synthetic)
        } else {
            nested_evaluate_name(parent.evaluate_name.as_deref(), name, synthetic)
        };
        let mut variable = variable_from_remote_object(
            name,
            remote,
            shared,
            None,
            evaluate_name.clone(),
            ObjectReferenceMutation::ReadOnly,
        );
        variable.can_set_value = property_can_set_value(
            &parent.mutation,
            property,
            name,
            evaluate_name.as_deref(),
            private,
            synthetic,
        )
        .then_some(true);
        let has_child = remote.get("objectId").and_then(Value::as_str).is_some();
        let proxy = remote.get("subtype").and_then(Value::as_str) == Some("proxy");
        capability_truncated |= proxy;
        let encoded_bytes = serde_json::to_vec(&variable)
            .map_err(|error| format!("Unable to encode a debug variable: {error}"))?
            .len()
            + usize::from(!variables.is_empty())
            + if has_child { 20 } else { 0 };
        if aggregate_bytes.saturating_add(encoded_bytes) > MAX_VARIABLE_PAGE_JSON_BYTES {
            if variables.is_empty() {
                return Err("A debug variable exceeds the page size limit.".to_string());
            }
            aggregate_truncated = true;
            break;
        }
        if has_child {
            clear_reference_limit_reason(shared);
        }
        variable.variables_reference = remote
            .get("objectId")
            .and_then(Value::as_str)
            .filter(|_| remote.get("subtype").and_then(Value::as_str) != Some("proxy"))
            .and_then(|object_id| {
                if !valid_mutation_name {
                    return register_object_reference_with_lineage(
                        shared,
                        request.pause_generation,
                        request.frame_id,
                        ObjectReferenceRegistration {
                            object_id,
                            evaluate_name,
                            mutation: ObjectReferenceMutation::ReadOnly,
                            lineage: None,
                            access: remote_object_access(remote),
                        },
                    );
                }
                let mutation =
                    child_object_mutation(&parent.mutation, property, remote, private, synthetic);
                register_object_reference_with_lineage(
                    shared,
                    request.pause_generation,
                    request.frame_id,
                    ObjectReferenceRegistration {
                        object_id,
                        evaluate_name,
                        mutation,
                        lineage: Some(ObjectReferenceLineage {
                            parent_reference: request.variables_reference,
                            property_name: name.to_string(),
                        }),
                        access: remote_object_access(remote),
                    },
                )
            })
            .unwrap_or(0);
        if has_child && variable.variables_reference == 0 {
            if let Some(reason) = reference_limit_reason(shared) {
                child_limit_reason = Some(reason);
                break;
            }
        }
        aggregate_bytes += encoded_bytes;
        variables.push(variable);
    }
    if !owner_is_current(shared, request)? {
        return Err("The debug pause owner changed while loading variables.".to_string());
    }
    let returned = u32::try_from(variables.len()).unwrap_or(request.count);
    let consumed = request.start.saturating_add(u64::from(returned));
    let mut limit_reason = child_limit_reason;
    if capability_truncated {
        limit_reason = Some(crate::debug_adapter::DebugVariablePageLimitReason::Capability);
    }
    if aggregate_truncated {
        limit_reason = Some(crate::debug_adapter::DebugVariablePageLimitReason::PageBytes);
    }
    if descriptors_truncated {
        limit_reason = snapshot.limit_reason;
    }
    Ok(DebugVariablePage {
        variables,
        start: request.start,
        returned,
        total,
        next_start: (child_limit_reason.is_none() && consumed < available).then_some(consumed),
        truncated: descriptors_truncated
            || aggregate_truncated
            || capability_truncated
            || child_limit_reason.is_some(),
        limit_reason,
    })
}

fn reference_limit_reason(
    shared: &Arc<Mutex<CdpShared>>,
) -> Option<crate::debug_adapter::DebugVariablePageLimitReason> {
    shared.lock().ok().and_then(|state| {
        state
            .pause
            .as_ref()
            .and_then(|pause| pause.last_object_reference_limit_reason)
    })
}

fn clear_reference_limit_reason(shared: &Arc<Mutex<CdpShared>>) {
    if let Ok(mut state) = shared.lock() {
        if let Some(pause) = state.pause.as_mut() {
            pause.last_object_reference_limit_reason = None;
        }
    }
}

fn descriptor_snapshot(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
    parent: &ObjectReference,
) -> Result<Arc<PropertyDescriptorSnapshot>, String> {
    let cached = {
        let state = shared.lock().map_err(|error| error.to_string())?;
        let pause = state
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        pause
            .property_descriptor_snapshots
            .get(&request.variables_reference)
            .cloned()
    };
    if let Some(snapshot) = cached {
        return Ok(snapshot);
    }

    let acquisition = acquire_descriptor_sources_with_page_load(client, shared, request, parent)?;
    let mut descriptors = Vec::new();
    let mut snapshot_bytes = 0usize;
    let mut limit_reason = acquisition.limit_reason;
    for source in acquisition.sources {
        let property = &source.property;
        let private = source.private;
        validate_property_descriptor(property)?;
        if descriptors.len() >= MAX_CDP_PROPERTY_DESCRIPTORS {
            limit_reason =
                Some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount);
            break;
        }
        let encoded_bytes = serde_json::to_vec(property)
            .map_err(|error| format!("Unable to bound a debug property descriptor: {error}"))?
            .len();
        if snapshot_bytes.saturating_add(encoded_bytes)
            > MAX_CDP_PROPERTY_DESCRIPTOR_BYTES_PER_PAUSE
        {
            limit_reason =
                Some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorBytes);
            break;
        }
        snapshot_bytes += encoded_bytes;
        let indexed = source.indexed;
        descriptors.push(CachedPropertyDescriptor {
            property: source.property,
            private,
            indexed,
            encoded_bytes,
            prefix_bytes: snapshot_bytes,
        });
    }
    let mut snapshot = PropertyDescriptorSnapshot {
        descriptors,
        indexed_indices: Vec::new(),
        named_indices: Vec::new(),
        complete: limit_reason.is_none(),
        limit_reason,
    };

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
            .is_some_and(|owned| owned == parent)
    {
        return Err("The debug pause owner changed while acquiring variables.".to_string());
    }
    if let Some(existing) = pause
        .property_descriptor_snapshots
        .get(&request.variables_reference)
    {
        return Ok(Arc::clone(existing));
    }
    let remaining_count =
        MAX_CDP_PROPERTY_DESCRIPTORS.saturating_sub(pause.property_descriptor_count);
    let remaining_bytes =
        MAX_CDP_PROPERTY_DESCRIPTOR_BYTES_PER_PAUSE.saturating_sub(pause.property_descriptor_bytes);
    let count_bounded = remaining_count.min(snapshot.descriptors.len());
    let (retained_count, _) =
        retained_descriptor_prefix_search(&snapshot.descriptors[..count_bounded], remaining_bytes);
    let retained_bytes = snapshot
        .descriptors
        .get(retained_count.wrapping_sub(1))
        .map_or(0, |descriptor| descriptor.prefix_bytes);
    if retained_count < snapshot.descriptors.len() {
        snapshot.limit_reason = Some(if retained_count == count_bounded {
            crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount
        } else {
            crate::debug_adapter::DebugVariablePageLimitReason::DescriptorBytes
        });
    }
    if retained_count < snapshot.descriptors.len() {
        snapshot.descriptors.truncate(retained_count);
        snapshot.complete = false;
    }
    for (index, descriptor) in snapshot.descriptors.iter().enumerate() {
        if descriptor.property.get("value").is_none() {
            continue;
        }
        if descriptor.indexed {
            snapshot.indexed_indices.push(index);
        } else {
            snapshot.named_indices.push(index);
        }
    }
    pause.property_descriptor_count += snapshot.descriptors.len();
    pause.property_descriptor_bytes += retained_bytes;
    let snapshot = Arc::new(snapshot);
    pause
        .property_descriptor_snapshots
        .insert(request.variables_reference, Arc::clone(&snapshot));
    Ok(snapshot)
}

fn validate_request(request: DebugVariablePageRequest) -> Result<(), String> {
    if request.pause_generation == 0
        || request.frame_id == 0
        || request.variables_reference == 0
        || request.start > 1_000_000
        || request.count == 0
        || request.count > 100
    {
        return Err("Invalid debug variables page request.".to_string());
    }
    Ok(())
}

pub(super) fn owned_object_reference(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<ObjectReference, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_ref()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
    {
        return Err("The debug pause owner is stale.".to_string());
    }
    let owned = pause
        .object_ids
        .get(&request.variables_reference)
        .ok_or_else(|| {
            format!(
                "Unknown variables reference {}.",
                request.variables_reference
            )
        })?
        .clone();
    if owned.pause_generation != request.pause_generation {
        return Err("The variables reference belongs to another debug pause.".to_string());
    }
    if owned.frame_id != request.frame_id {
        return Err("The variables reference belongs to another debug frame.".to_string());
    }
    Ok(owned)
}

pub(super) fn owned_object_reference_for_mutation(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<ObjectReference, String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != request.pause_generation
        || !pause.call_frame_ids.contains_key(&request.frame_id)
    {
        return Err("The debug pause owner is stale.".to_string());
    }
    let owned = pause
        .object_ids
        .get(&request.variables_reference)
        .ok_or_else(|| {
            format!(
                "Unknown variables reference {}.",
                request.variables_reference
            )
        })?
        .clone();
    if owned.pause_generation != request.pause_generation || owned.frame_id != request.frame_id {
        return Err("The variables reference belongs to another debug owner.".to_string());
    }
    if pause.variable_mutations >= MAX_CDP_VARIABLE_MUTATIONS_PER_PAUSE {
        return Err("The debug variable mutation limit was reached for this pause.".to_string());
    }
    pause.variable_mutations += 1;
    Ok(owned)
}

pub(super) fn owner_is_current(
    shared: &Arc<Mutex<CdpShared>>,
    request: DebugVariablePageRequest,
) -> Result<bool, String> {
    let state = shared.lock().map_err(|error| error.to_string())?;
    Ok(state.pause.as_ref().is_some_and(|pause| {
        pause.pause_generation == request.pause_generation
            && pause.call_frame_ids.contains_key(&request.frame_id)
            && pause
                .object_ids
                .get(&request.variables_reference)
                .is_some_and(|owned| {
                    owned.pause_generation == request.pause_generation
                        && owned.frame_id == request.frame_id
                })
    }))
}

pub(super) fn register_object_reference(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    object_id: &str,
    evaluate_name: Option<String>,
    mutation: ObjectReferenceMutation,
) -> Option<u64> {
    register_object_reference_with_lineage(
        shared,
        pause_generation,
        frame_id,
        ObjectReferenceRegistration {
            object_id,
            evaluate_name,
            mutation,
            lineage: None,
            access: ObjectReferenceAccess::Object,
        },
    )
}

pub(super) fn register_child_object_reference(
    shared: &Arc<Mutex<CdpShared>>,
    owner: (u64, u64),
    parent_reference: u64,
    property_name: &str,
    object_id: &str,
    evaluate_name: Option<String>,
    mutation: ObjectReferenceMutation,
) -> Option<u64> {
    let (pause_generation, frame_id) = owner;
    register_object_reference_with_lineage(
        shared,
        pause_generation,
        frame_id,
        ObjectReferenceRegistration {
            object_id,
            evaluate_name,
            mutation,
            lineage: Some(ObjectReferenceLineage {
                parent_reference,
                property_name: property_name.to_string(),
            }),
            access: ObjectReferenceAccess::Object,
        },
    )
}

fn register_object_reference_with_lineage(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    registration: ObjectReferenceRegistration<'_>,
) -> Option<u64> {
    let ObjectReferenceRegistration {
        object_id,
        evaluate_name,
        mutation,
        lineage,
        access,
    } = registration;
    if object_id.is_empty() || object_id.len() > MAX_CDP_OBJECT_ID_BYTES {
        return None;
    }
    let mut state = shared.lock().ok()?;
    let is_current_owner = state.pause.as_ref().is_some_and(|pause| {
        pause.pause_generation == pause_generation && pause.call_frame_ids.contains_key(&frame_id)
    });
    if !is_current_owner {
        return None;
    }
    if let Some(child_lineage) = &lineage {
        let pause = state.pause.as_ref()?;
        let mut cursor = Some(child_lineage.parent_reference);
        let mut visited = std::collections::HashSet::new();
        while let Some(reference) = cursor {
            if !visited.insert(reference) {
                return None;
            }
            let ancestor = pause.object_ids.get(&reference)?;
            if ancestor.pause_generation != pause_generation || ancestor.frame_id != frame_id {
                return None;
            }
            if ancestor.object_id == object_id {
                return (ancestor.mutation == mutation).then_some(reference);
            }
            cursor = ancestor
                .lineage
                .as_ref()
                .map(|lineage| lineage.parent_reference);
        }
    }
    let key = ObjectReferenceKey {
        frame_id,
        object_id: object_id.to_string(),
        evaluate_name: evaluate_name.clone(),
        mutation: mutation.clone(),
        lineage: lineage.clone(),
        access,
    };
    if let Some(reference) = state
        .pause
        .as_ref()?
        .object_reference_ids
        .get(&key)
        .copied()
    {
        return Some(reference);
    }
    if state.pause.as_ref()?.object_ids.len() >= MAX_CDP_OBJECT_REFERENCES_PER_PAUSE {
        // Child handles may alias handles already exposed to the UI, so an
        // individual Runtime.releaseObject here could invalidate a retained
        // reference. Refuse local ownership instead; the next pause replaces
        // the complete bounded inventory under a new owner generation.
        state.pause.as_mut()?.last_object_reference_limit_reason =
            Some(crate::debug_adapter::DebugVariablePageLimitReason::References);
        return None;
    }
    let reference = state.allocate_id();
    let pause = state.pause.as_mut()?;
    let owned = ObjectReference {
        frame_id,
        object_id: object_id.to_string(),
        pause_generation,
        evaluate_name,
        access,
        mutation,
        lineage,
    };
    if try_reserve_keyed_object_reference_bytes(pause, &owned, &key).is_err() {
        return None;
    }
    pause.object_ids.insert(reference, owned);
    pause.object_reference_ids.insert(key, reference);
    Some(reference)
}

fn object_reference_retained_bytes(
    object_id: &str,
    evaluate_name: Option<&str>,
    mutation: &ObjectReferenceMutation,
    lineage: Option<&ObjectReferenceLineage>,
) -> usize {
    let mutation_bytes = match mutation {
        ObjectReferenceMutation::ScopeSlot { call_frame_id, .. } => call_frame_id.len(),
        ObjectReferenceMutation::ObjectProperty { object_id } => object_id.len(),
        ObjectReferenceMutation::ReadOnly => 0,
    };
    object_id
        .len()
        .saturating_add(evaluate_name.map_or(0, str::len))
        .saturating_add(mutation_bytes)
        .saturating_add(lineage.map_or(0, |lineage| lineage.property_name.len()))
        .saturating_add(64)
}

fn object_reference_key_retained_bytes(key: &ObjectReferenceKey) -> usize {
    object_reference_retained_bytes(
        &key.object_id,
        key.evaluate_name.as_deref(),
        &key.mutation,
        key.lineage.as_ref(),
    )
}

fn try_reserve_keyed_object_reference_bytes(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
    reference: &ObjectReference,
    key: &ObjectReferenceKey,
) -> Result<(), crate::debug_adapter::DebugVariablePageLimitReason> {
    reserve_object_reference_bytes(
        pause,
        object_reference_retained_bytes(
            &reference.object_id,
            reference.evaluate_name.as_deref(),
            &reference.mutation,
            reference.lineage.as_ref(),
        )
        .saturating_add(object_reference_key_retained_bytes(key)),
    )
}

pub(super) fn try_reserve_object_reference_bytes(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
    reference: &ObjectReference,
) -> Result<(), crate::debug_adapter::DebugVariablePageLimitReason> {
    let retained_bytes = object_reference_retained_bytes(
        &reference.object_id,
        reference.evaluate_name.as_deref(),
        &reference.mutation,
        reference.lineage.as_ref(),
    );
    reserve_object_reference_bytes(pause, retained_bytes)
}

fn reserve_object_reference_bytes(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
    retained_bytes: usize,
) -> Result<(), crate::debug_adapter::DebugVariablePageLimitReason> {
    if pause.object_reference_bytes.saturating_add(retained_bytes)
        > MAX_CDP_OBJECT_REFERENCE_BYTES_PER_PAUSE
    {
        pause.last_object_reference_limit_reason =
            Some(crate::debug_adapter::DebugVariablePageLimitReason::ReferenceBytes);
        return Err(crate::debug_adapter::DebugVariablePageLimitReason::ReferenceBytes);
    }
    pause.object_reference_bytes += retained_bytes;
    Ok(())
}

pub(super) fn child_object_mutation(
    parent_mutation: &ObjectReferenceMutation,
    property: &Value,
    remote: &Value,
    private: bool,
    synthetic: bool,
) -> ObjectReferenceMutation {
    if matches!(parent_mutation, ObjectReferenceMutation::ReadOnly) {
        return ObjectReferenceMutation::ReadOnly;
    }
    let Some(object_id) = remote.get("objectId").and_then(Value::as_str) else {
        return ObjectReferenceMutation::ReadOnly;
    };
    let unsupported_remote = remote
        .get("subtype")
        .and_then(Value::as_str)
        .is_some_and(|subtype| subtype == "proxy" || subtype.starts_with("internal#"));
    let writable_data_property = is_writable_data_property(property);
    if private
        || synthetic
        || unsupported_remote
        || !writable_data_property
        || object_id.is_empty()
        || object_id.len() > MAX_CDP_OBJECT_ID_BYTES
    {
        ObjectReferenceMutation::ReadOnly
    } else {
        ObjectReferenceMutation::ObjectProperty {
            object_id: object_id.to_string(),
        }
    }
}

fn property_can_set_value(
    parent_mutation: &ObjectReferenceMutation,
    property: &Value,
    name: &str,
    evaluate_name: Option<&str>,
    private: bool,
    synthetic: bool,
) -> bool {
    if !is_valid_debug_variable_name(name)
        || private
        || synthetic
        || !is_writable_data_property(property)
    {
        return false;
    }
    match parent_mutation {
        ObjectReferenceMutation::ScopeSlot { .. } => evaluate_name.is_some() && name != "this",
        ObjectReferenceMutation::ObjectProperty { .. } => true,
        ObjectReferenceMutation::ReadOnly => false,
    }
}

pub(super) fn is_writable_data_property(property: &Value) -> bool {
    property.get("value").is_some()
        && property.get("writable").and_then(Value::as_bool) == Some(true)
        && property.get("get").is_none()
        && property.get("set").is_none()
}

pub(super) fn revoke_assigned_property_references(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    frame_id: u64,
    parent_reference: u64,
    property_name: &str,
) -> Result<(), String> {
    let mut state = shared.lock().map_err(|error| error.to_string())?;
    let pause = state
        .pause
        .as_mut()
        .ok_or_else(|| "The debugger is not paused.".to_string())?;
    if pause.pause_generation != pause_generation || !pause.call_frame_ids.contains_key(&frame_id) {
        return Err("The debug pause owner is stale.".to_string());
    }
    let parent = pause
        .object_ids
        .get(&parent_reference)
        .ok_or_else(|| "The variables reference belongs to another debug owner.".to_string())?;
    if parent.pause_generation != pause_generation || parent.frame_id != frame_id {
        return Err("The variables reference belongs to another debug owner.".to_string());
    }
    let mut removed = std::collections::HashSet::new();
    loop {
        let before = removed.len();
        for (reference_id, reference) in &pause.object_ids {
            let Some(lineage) = &reference.lineage else {
                continue;
            };
            if (lineage.parent_reference == parent_reference
                && lineage.property_name == property_name)
                || removed.contains(&lineage.parent_reference)
            {
                removed.insert(*reference_id);
            }
        }
        if removed.len() == before {
            break;
        }
    }
    pause
        .object_ids
        .retain(|reference_id, _| !removed.contains(reference_id));
    pause
        .object_reference_ids
        .retain(|_, reference_id| !removed.contains(reference_id));
    recalculate_object_reference_bytes(pause);
    removed.insert(parent_reference);
    invalidate_descriptor_snapshots(pause, &removed);
    Ok(())
}

fn invalidate_descriptor_snapshots(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
    references: &std::collections::HashSet<u64>,
) {
    pause
        .property_descriptor_snapshots
        .retain(|reference, _| !references.contains(reference));
    pause.property_descriptor_count = pause
        .property_descriptor_snapshots
        .values()
        .map(|snapshot| snapshot.descriptors.len())
        .sum();
    pause.property_descriptor_bytes = pause
        .property_descriptor_snapshots
        .values()
        .flat_map(|snapshot| &snapshot.descriptors)
        .map(|descriptor| descriptor.encoded_bytes)
        .sum();
}

pub(super) fn invalidate_all_descriptor_snapshots(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
) {
    pause.property_descriptor_snapshots.clear();
    pause.property_descriptor_count = 0;
    pause.property_descriptor_bytes = 0;
}

pub(super) fn recalculate_object_reference_bytes(
    pause: &mut crate::debug_cdp::transport::PauseInventory,
) {
    let owned_bytes: usize = pause
        .object_ids
        .values()
        .map(|reference| {
            object_reference_retained_bytes(
                &reference.object_id,
                reference.evaluate_name.as_deref(),
                &reference.mutation,
                reference.lineage.as_ref(),
            )
        })
        .sum();
    let key_bytes: usize = pause
        .object_reference_ids
        .keys()
        .map(object_reference_key_retained_bytes)
        .sum();
    pause.object_reference_bytes = owned_bytes.saturating_add(key_bytes);
}

fn render_primitive_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use crate::debug_cdp::transport::PauseInventory;

    fn paused_shared() -> Arc<Mutex<CdpShared>> {
        let mut shared = CdpShared::new(None);
        let mut pause = PauseInventory {
            pause_generation: 1,
            ..PauseInventory::default()
        };
        pause.call_frame_ids.insert(7, "frame-7".to_string());
        shared.pause = Some(pause);
        Arc::new(Mutex::new(shared))
    }

    fn read_only() -> ObjectReferenceMutation {
        ObjectReferenceMutation::ReadOnly
    }

    #[test]
    fn descriptor_byte_prefix_search_is_logarithmic_at_the_ten_thousand_cap() {
        let descriptors = (1..=MAX_CDP_PROPERTY_DESCRIPTORS)
            .map(|index| CachedPropertyDescriptor {
                property: json!({"name": index.to_string(), "value": {"type": "number"}}),
                private: false,
                indexed: true,
                encoded_bytes: 10,
                prefix_bytes: index * 10,
            })
            .collect::<Vec<_>>();

        let (retained, probes) = retained_descriptor_prefix_search(&descriptors, 54_321);
        assert_eq!(retained, 5_432);
        assert!(probes <= 14, "binary search used {probes} probes");
        let (all, all_probes) = retained_descriptor_prefix_search(&descriptors, usize::MAX);
        assert_eq!(all, MAX_CDP_PROPERTY_DESCRIPTORS);
        assert!(all_probes <= 14, "binary search used {all_probes} probes");
    }

    #[test]
    fn keyed_reference_byte_reservation_counts_both_retained_copies() {
        let object_id = "o".repeat(MAX_CDP_OBJECT_ID_BYTES);
        let evaluate_name = Some("value".repeat(512));
        let owned = ObjectReference {
            frame_id: 7,
            object_id: object_id.clone(),
            pause_generation: 1,
            evaluate_name: evaluate_name.clone(),
            access: ObjectReferenceAccess::Object,
            mutation: read_only(),
            lineage: None,
        };
        let key = ObjectReferenceKey {
            frame_id: 7,
            object_id,
            evaluate_name,
            mutation: read_only(),
            lineage: None,
            access: ObjectReferenceAccess::Object,
        };
        let one_copy = object_reference_retained_bytes(
            &owned.object_id,
            owned.evaluate_name.as_deref(),
            &owned.mutation,
            owned.lineage.as_ref(),
        );
        let mut pause = PauseInventory::default();

        try_reserve_keyed_object_reference_bytes(&mut pause, &owned, &key)
            .expect("first keyed reference");
        assert_eq!(pause.object_reference_bytes, one_copy * 2);
        while try_reserve_keyed_object_reference_bytes(&mut pause, &owned, &key).is_ok() {}
        assert!(pause.object_reference_bytes <= MAX_CDP_OBJECT_REFERENCE_BYTES_PER_PAUSE);
        assert_eq!(
            pause.last_object_reference_limit_reason,
            Some(crate::debug_adapter::DebugVariablePageLimitReason::ReferenceBytes)
        );
    }

    #[test]
    fn owner_lookup_and_cache_revocation_do_not_consume_or_replenish_acquisition_budget() {
        let shared = paused_shared();
        {
            let mut state = shared.lock().expect("state");
            let pause = state.pause.as_mut().expect("pause");
            pause.variable_page_loads = MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE - 1;
            pause.object_ids.insert(
                13,
                ObjectReference {
                    frame_id: 7,
                    object_id: "scope-13".to_string(),
                    pause_generation: 1,
                    evaluate_name: None,
                    access: ObjectReferenceAccess::ScopeRoot,
                    mutation: ObjectReferenceMutation::ReadOnly,
                    lineage: None,
                },
            );
        }
        let request = DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 7,
            variables_reference: 13,
            start: 0,
            count: 1,
        };
        owned_object_reference(&shared, request).expect("owned reference");
        revoke_assigned_property_references(&shared, 1, 7, 13, "missing")
            .expect("first cache revocation");
        revoke_assigned_property_references(&shared, 1, 7, 13, "missing")
            .expect("repeated cache revocation");

        owned_object_reference(&shared, request).expect("owned reference remains valid");
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .variable_page_loads,
            MAX_CDP_VARIABLE_PAGE_LOADS_PER_PAUSE - 1
        );
    }

    #[test]
    fn scope_mutation_preserves_zero_based_scope_order_and_only_safe_scope_kinds() {
        for (scope_number, scope_type, expected_kind) in [
            (0, "local", MutableScopeKind::Local),
            (1, "closure", MutableScopeKind::Closure),
            (2, "catch", MutableScopeKind::Catch),
        ] {
            assert_eq!(
                scope_mutation(Some("call-frame"), scope_number, scope_type),
                ObjectReferenceMutation::ScopeSlot {
                    call_frame_id: "call-frame".to_string(),
                    scope_number: scope_number as u32,
                    scope_kind: expected_kind,
                }
            );
        }
        for scope_type in [
            "global",
            "module",
            "with",
            "block",
            "script",
            "eval",
            "wasm-expression-stack",
            "unknown",
            "",
        ] {
            assert_eq!(
                scope_mutation(Some("call-frame"), 3, scope_type),
                ObjectReferenceMutation::ReadOnly
            );
        }
        assert_eq!(
            scope_mutation(None, 0, "local"),
            ObjectReferenceMutation::ReadOnly
        );
        assert_eq!(
            scope_mutation(Some(""), 0, "local"),
            ObjectReferenceMutation::ReadOnly
        );
        assert_eq!(
            scope_mutation(Some("call-frame"), u32::MAX as usize + 1, "local"),
            ObjectReferenceMutation::ReadOnly
        );
        assert_eq!(
            scope_mutation(Some(&"x".repeat(MAX_CDP_OBJECT_ID_BYTES + 1)), 0, "local"),
            ObjectReferenceMutation::ReadOnly
        );
    }

    #[test]
    fn child_object_mutation_requires_an_ordinary_writable_own_data_descriptor() {
        let ordinary = json!({"objectId": "child", "type": "object"});
        let writable = json!({"name": "child", "writable": true, "value": ordinary.clone()});
        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "parent".to_string(),
                },
                &writable,
                &ordinary,
                false,
                false,
            ),
            ObjectReferenceMutation::ObjectProperty {
                object_id: "child".to_string()
            }
        );
        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ReadOnly,
                &writable,
                &ordinary,
                false,
                false,
            ),
            ObjectReferenceMutation::ReadOnly
        );
        assert!(property_can_set_value(
            &ObjectReferenceMutation::ScopeSlot {
                call_frame_id: "frame".to_string(),
                scope_number: 0,
                scope_kind: MutableScopeKind::Local,
            },
            &writable,
            "child",
            Some("child"),
            false,
            false,
        ));
        assert!(property_can_set_value(
            &ObjectReferenceMutation::ObjectProperty {
                object_id: "parent".to_string(),
            },
            &writable,
            "child",
            Some("parent.child"),
            false,
            false,
        ));
        assert!(!property_can_set_value(
            &ObjectReferenceMutation::ReadOnly,
            &writable,
            "child",
            Some("child"),
            false,
            false,
        ));
        for (name, evaluate_name) in [("this", Some("this")), ("not a binding", None)] {
            assert!(!property_can_set_value(
                &ObjectReferenceMutation::ScopeSlot {
                    call_frame_id: "frame".to_string(),
                    scope_number: 0,
                    scope_kind: MutableScopeKind::Local,
                },
                &writable,
                name,
                evaluate_name,
                false,
                false,
            ));
        }
        for descriptor in [
            json!({"name": "child", "writable": false, "value": ordinary.clone()}),
            json!({"name": "child", "value": ordinary.clone()}),
            json!({"name": "child", "get": {"type": "function"}}),
            json!({"name": "child", "set": {"type": "function"}, "value": ordinary.clone()}),
        ] {
            assert_eq!(
                child_object_mutation(
                    &ObjectReferenceMutation::ObjectProperty {
                        object_id: "parent".to_string(),
                    },
                    &descriptor,
                    &ordinary,
                    false,
                    false,
                ),
                ObjectReferenceMutation::ReadOnly
            );
        }
        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "parent".to_string(),
                },
                &json!({"name": "#child", "writable": true, "value": ordinary.clone()}),
                &ordinary,
                true,
                false,
            ),
            ObjectReferenceMutation::ReadOnly
        );
        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "parent".to_string(),
                },
                &json!({"name": "symbol", "writable": true, "value": ordinary.clone()}),
                &ordinary,
                false,
                true,
            ),
            ObjectReferenceMutation::ReadOnly
        );
        for subtype in ["proxy", "internal#entry"] {
            let remote = json!({"objectId": "child", "type": "object", "subtype": subtype});
            assert_eq!(
                child_object_mutation(
                    &ObjectReferenceMutation::ObjectProperty {
                        object_id: "parent".to_string(),
                    },
                    &json!({"name": "child", "writable": true, "value": remote.clone()}),
                    &remote,
                    false,
                    false,
                ),
                ObjectReferenceMutation::ReadOnly
            );
        }
        let oversized = json!({
            "objectId": "x".repeat(MAX_CDP_OBJECT_ID_BYTES + 1),
            "type": "object"
        });
        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "parent".to_string(),
                },
                &json!({"name": "child", "writable": true, "value": oversized.clone()}),
                &oversized,
                false,
                false,
            ),
            ObjectReferenceMutation::ReadOnly
        );
    }

    #[test]
    fn read_only_object_provenance_is_transitive_for_every_fail_closed_origin() {
        let ordinary = json!({"objectId": "child", "type": "object"});
        let proxy = json!({"objectId": "child", "type": "object", "subtype": "proxy"});
        let internal = json!({"objectId": "child", "type": "object", "subtype": "internal#entry"});
        let roots = [
            (
                json!({"name": "frozen", "writable": false, "value": ordinary.clone()}),
                ordinary.clone(),
                false,
            ),
            (
                json!({"name": "#private", "writable": true, "value": ordinary.clone()}),
                ordinary.clone(),
                true,
            ),
            (
                json!({"name": "proxy", "writable": true, "value": proxy.clone()}),
                proxy,
                false,
            ),
            (
                json!({"name": "internal", "writable": true, "value": internal.clone()}),
                internal,
                false,
            ),
        ];
        let writable_descendant =
            json!({"name": "descendant", "writable": true, "value": ordinary.clone()});

        for (root_descriptor, root_remote, private) in roots {
            let root_mutation = child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "mutable-parent".to_string(),
                },
                &root_descriptor,
                &root_remote,
                private,
                false,
            );
            assert_eq!(root_mutation, ObjectReferenceMutation::ReadOnly);
            assert_eq!(
                child_object_mutation(
                    &root_mutation,
                    &writable_descendant,
                    &ordinary,
                    false,
                    false,
                ),
                ObjectReferenceMutation::ReadOnly
            );
            assert!(!property_can_set_value(
                &root_mutation,
                &writable_descendant,
                "descendant",
                Some("owner.descendant"),
                false,
                false,
            ));
        }

        assert_eq!(
            child_object_mutation(
                &ObjectReferenceMutation::ObjectProperty {
                    object_id: "mutable-parent".to_string(),
                },
                &writable_descendant,
                &ordinary,
                false,
                false,
            ),
            ObjectReferenceMutation::ObjectProperty {
                object_id: "child".to_string()
            }
        );
    }

    #[test]
    fn cache_identity_includes_mutation_provenance() {
        let shared = paused_shared();
        let read_only = register_object_reference(
            &shared,
            1,
            7,
            "shared-object",
            Some("owner.child".to_string()),
            ObjectReferenceMutation::ReadOnly,
        )
        .expect("read-only reference");
        let writable = register_object_reference(
            &shared,
            1,
            7,
            "shared-object",
            Some("owner.child".to_string()),
            ObjectReferenceMutation::ObjectProperty {
                object_id: "shared-object".to_string(),
            },
        )
        .expect("writable reference");
        assert_ne!(read_only, writable);
        assert_eq!(
            register_object_reference(
                &shared,
                1,
                7,
                "shared-object",
                Some("owner.child".to_string()),
                ObjectReferenceMutation::ObjectProperty {
                    object_id: "shared-object".to_string(),
                },
            ),
            Some(writable)
        );
    }

    #[test]
    fn selective_revocation_removes_only_the_replaced_property_subtree() {
        let shared = paused_shared();
        let mutation = ObjectReferenceMutation::ObjectProperty {
            object_id: "root".to_string(),
        };
        let root = register_object_reference(
            &shared,
            1,
            7,
            "root",
            Some("root".to_string()),
            mutation.clone(),
        )
        .expect("root");
        let other_root = register_object_reference(
            &shared,
            1,
            7,
            "other-root",
            Some("other".to_string()),
            mutation.clone(),
        )
        .expect("other root");
        let replaced = register_child_object_reference(
            &shared,
            (1, 7),
            root,
            "target",
            "old-target",
            Some("root.target".to_string()),
            mutation.clone(),
        )
        .expect("old target");
        let descendant = register_child_object_reference(
            &shared,
            (1, 7),
            replaced,
            "nested",
            "old-descendant",
            Some("root.target.nested".to_string()),
            mutation.clone(),
        )
        .expect("descendant");
        let sibling = register_child_object_reference(
            &shared,
            (1, 7),
            root,
            "sibling",
            "sibling",
            Some("root.sibling".to_string()),
            mutation.clone(),
        )
        .expect("sibling");
        let alias = register_child_object_reference(
            &shared,
            (1, 7),
            other_root,
            "alias",
            "old-target",
            Some("other.alias".to_string()),
            mutation,
        )
        .expect("alias through unrelated parent");
        assert_ne!(replaced, alias);

        revoke_assigned_property_references(&shared, 1, 7, root, "target")
            .expect("selective revocation");
        let state = shared.lock().expect("state");
        let references = &state.pause.as_ref().expect("pause").object_ids;
        assert!(references.contains_key(&root));
        assert!(references.contains_key(&other_root));
        assert!(references.contains_key(&sibling));
        assert!(references.contains_key(&alias));
        assert!(!references.contains_key(&replaced));
        assert!(!references.contains_key(&descendant));
    }

    #[test]
    fn ancestor_cycles_reuse_the_existing_reference_without_creating_an_edge() {
        let shared = paused_shared();
        let mutation = ObjectReferenceMutation::ObjectProperty {
            object_id: "root".to_string(),
        };
        let root = register_object_reference(
            &shared,
            1,
            7,
            "root",
            Some("root".to_string()),
            mutation.clone(),
        )
        .expect("root");
        let child = register_child_object_reference(
            &shared,
            (1, 7),
            root,
            "child",
            "child",
            Some("root.child".to_string()),
            mutation.clone(),
        )
        .expect("child");
        let cycle = register_child_object_reference(
            &shared,
            (1, 7),
            child,
            "parent",
            "root",
            Some("root.child.parent".to_string()),
            mutation,
        );
        assert_eq!(cycle, Some(root));
        assert_eq!(
            shared
                .lock()
                .expect("state")
                .pause
                .as_ref()
                .expect("pause")
                .object_ids
                .len(),
            2
        );
    }

    #[test]
    fn ancestor_cycle_reuse_never_launders_read_only_provenance() {
        let shared = paused_shared();
        let mutable = ObjectReferenceMutation::ObjectProperty {
            object_id: "root".to_string(),
        };
        let root = register_object_reference(
            &shared,
            1,
            7,
            "root",
            Some("root".to_string()),
            mutable.clone(),
        )
        .expect("mutable root");
        let child = register_child_object_reference(
            &shared,
            (1, 7),
            root,
            "child",
            "child",
            Some("root.child".to_string()),
            mutable,
        )
        .expect("mutable child");

        assert_eq!(
            register_child_object_reference(
                &shared,
                (1, 7),
                child,
                "back",
                "root",
                Some("root.child.back".to_string()),
                ObjectReferenceMutation::ReadOnly,
            ),
            None
        );
        let state = shared.lock().expect("state");
        let references = &state.pause.as_ref().expect("pause").object_ids;
        assert_eq!(references.len(), 2);
        assert_eq!(
            references.get(&root).expect("root").mutation,
            ObjectReferenceMutation::ObjectProperty {
                object_id: "root".to_string()
            }
        );
    }

    #[test]
    fn parent_lookup_preserves_provenance_and_rejects_stale_or_cross_frame_owners() {
        let shared = paused_shared();
        let expected_mutation = ObjectReferenceMutation::ScopeSlot {
            call_frame_id: "frame-7".to_string(),
            scope_number: 2,
            scope_kind: MutableScopeKind::Catch,
        };
        {
            let mut state = shared.lock().expect("shared");
            state.pause.as_mut().expect("pause").object_ids.insert(
                11,
                ObjectReference {
                    frame_id: 7,
                    object_id: "scope-catch".to_string(),
                    pause_generation: 1,
                    evaluate_name: None,
                    access: ObjectReferenceAccess::ScopeRoot,
                    mutation: expected_mutation.clone(),
                    lineage: None,
                },
            );
        }
        let request = DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 7,
            variables_reference: 11,
            start: 0,
            count: 1,
        };
        let owned = owned_object_reference(&shared, request).expect("owned reference");
        assert_eq!(owned.mutation, expected_mutation);
        assert_eq!(owned.access, ObjectReferenceAccess::ScopeRoot);

        for invalid in [
            DebugVariablePageRequest {
                pause_generation: 2,
                ..request
            },
            DebugVariablePageRequest {
                frame_id: 8,
                ..request
            },
        ] {
            assert!(owned_object_reference(&shared, invalid).is_err());
        }
    }

    #[test]
    fn cache_dedupes_thousands_caps_unique_references_and_resets_with_pause_inventory() {
        let shared = paused_shared();
        let first = register_object_reference(
            &shared,
            1,
            7,
            "stable-object",
            Some("owner.child".to_string()),
            read_only(),
        )
        .expect("first reference");
        for _ in 0..10_000 {
            assert_eq!(
                register_object_reference(
                    &shared,
                    1,
                    7,
                    "stable-object",
                    Some("owner.child".to_string()),
                    read_only(),
                ),
                Some(first)
            );
        }
        assert_eq!(
            shared
                .lock()
                .expect("shared")
                .pause
                .as_ref()
                .expect("pause")
                .object_ids
                .len(),
            1
        );
        assert_eq!(
            register_object_reference(
                &shared,
                1,
                7,
                "",
                Some("owner.empty".to_string()),
                read_only(),
            ),
            None
        );
        assert_eq!(
            register_object_reference(
                &shared,
                1,
                7,
                &"x".repeat(MAX_CDP_OBJECT_ID_BYTES + 1),
                Some("owner.oversized".to_string()),
                read_only(),
            ),
            None
        );

        for index in 1..MAX_CDP_OBJECT_REFERENCES_PER_PAUSE {
            assert!(register_object_reference(
                &shared,
                1,
                7,
                &format!("object-{index}"),
                Some(format!("owner.child{index}")),
                read_only(),
            )
            .is_some());
        }
        assert_eq!(
            register_object_reference(
                &shared,
                1,
                7,
                "over-cap",
                Some("owner.last".to_string()),
                read_only(),
            ),
            None
        );

        {
            let mut shared = shared.lock().expect("shared");
            let mut next_pause = PauseInventory {
                pause_generation: 2,
                ..PauseInventory::default()
            };
            next_pause
                .call_frame_ids
                .insert(7, "frame-7-next".to_string());
            shared.pause = Some(next_pause);
        }
        assert!(register_object_reference(
            &shared,
            2,
            7,
            "after-reset",
            Some("owner.reset".to_string()),
            read_only(),
        )
        .is_some());
    }
}
