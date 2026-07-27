//! Pause-owned, bounded DBGp variable paging.

use super::*;

pub(super) fn variables(
    adapter: &mut PhpDbgpAdapter,
    reference: u64,
) -> Result<Vec<DebugVariableInfo>, String> {
    let (pause_generation, frame_id) = {
        let shared = adapter
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
        let frame_id = match pause.slots.get(&reference) {
            Some(VariableSlot::Context { frame_id, .. })
            | Some(VariableSlot::Property { frame_id, .. }) => *frame_id,
            None => return Err(format!("Unknown variables reference {reference}.")),
        };
        (pause.generation, frame_id)
    };
    variables_page(
        adapter,
        DebugVariablePageRequest {
            pause_generation,
            frame_id,
            variables_reference: reference,
            start: 0,
            count: 100,
        },
    )
    .map(|page| page.variables)
}

pub(super) fn current_pause_generation(adapter: &PhpDbgpAdapter) -> Option<u64> {
    adapter
        .inner
        .shared
        .lock()
        .ok()
        .and_then(|shared| shared.pause.as_ref().map(|pause| pause.generation))
}

pub(super) fn variables_page(
    adapter: &mut PhpDbgpAdapter,
    request: DebugVariablePageRequest,
) -> Result<DebugVariablePage, String> {
    let connection = adapter.inner.active_connection()?;
    let slot = {
        let shared = adapter
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
        pause
            .slots
            .get(&request.variables_reference)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Unknown variables reference {}.",
                    request.variables_reference
                )
            })?
    };
    match slot {
        VariableSlot::Context {
            pause_generation,
            frame_id,
            depth,
            context_id,
        } => context_page(
            adapter,
            &connection,
            request,
            pause_generation,
            frame_id,
            depth,
            context_id,
        ),
        VariableSlot::Property {
            pause_generation,
            frame_id,
            depth,
            context_id,
            fullname,
        } => property_page(
            adapter,
            &connection,
            request,
            pause_generation,
            frame_id,
            depth,
            context_id,
            &fullname,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn context_page(
    adapter: &PhpDbgpAdapter,
    connection: &DbgpConnection,
    request: DebugVariablePageRequest,
    pause_generation: u64,
    frame_id: u64,
    depth: u32,
    context_id: u32,
) -> Result<DebugVariablePage, String> {
    validate_owner(request, pause_generation, frame_id)?;
    let response =
        connection.request("context_get", &format!(" -d {depth} -c {context_id}"), None)?;
    if let Some(error) = &response.error {
        return Err(dbgp_error_message(error, "context_get"));
    }
    validate_after_io(&adapter.inner, request)?;
    let start = usize::try_from(request.start).unwrap_or(usize::MAX);
    let end = start
        .saturating_add(request.count as usize)
        .min(response.properties.len());
    let selected = response.properties.get(start..end).unwrap_or_default();
    let variables = build_variables(
        adapter,
        selected,
        pause_generation,
        frame_id,
        depth,
        context_id,
    )?;
    let truncated = response.properties.len() >= 100;
    Ok(DebugVariablePage {
        returned: variables.len() as u32,
        variables,
        start: request.start,
        total: None,
        next_start: None,
        truncated,
        limit_reason: truncated
            .then_some(crate::debug_adapter::DebugVariablePageLimitReason::DescriptorCount),
    })
}

#[allow(clippy::too_many_arguments)]
fn property_page(
    adapter: &PhpDbgpAdapter,
    connection: &DbgpConnection,
    request: DebugVariablePageRequest,
    pause_generation: u64,
    frame_id: u64,
    depth: u32,
    context_id: u32,
    fullname: &str,
) -> Result<DebugVariablePage, String> {
    validate_owner(request, pause_generation, frame_id)?;
    let first_page = request.start / 100;
    let requested_end = request.start.saturating_add(request.count as u64);
    let last_page = requested_end.saturating_sub(1) / 100;
    let mut indexed = Vec::new();
    let mut total = None;
    for page in first_page..=last_page.min(first_page + 1) {
        let arguments = format!(
            " -d {depth} -c {context_id} -n {} -p {page}",
            quote_argument(fullname)
        );
        let response = connection.request("property_get", &arguments, None)?;
        if let Some(error) = &response.error {
            return Err(dbgp_error_message(error, "property_get"));
        }
        let property = response
            .properties
            .into_iter()
            .next()
            .ok_or_else(|| "Xdebug returned no property data.".to_string())?;
        total = Some(property.numchildren as u64);
        let actual_page = property.page.unwrap_or(page as u32) as u64;
        let page_size = property.page_size.unwrap_or(100).max(1) as u64;
        for (offset, child) in property.children.into_iter().enumerate() {
            indexed.push((actual_page * page_size + offset as u64, child));
        }
    }
    validate_after_io(&adapter.inner, request)?;
    indexed.sort_by_key(|(index, _)| *index);
    let selected: Vec<DbgpProperty> = indexed
        .into_iter()
        .filter(|(index, _)| *index >= request.start && *index < requested_end)
        .map(|(_, property)| property)
        .collect();
    let variables = build_variables(
        adapter,
        &selected,
        pause_generation,
        frame_id,
        depth,
        context_id,
    )?;
    let returned = variables.len() as u32;
    let consumed = request.start.saturating_add(returned as u64);
    Ok(DebugVariablePage {
        variables,
        start: request.start,
        returned,
        total,
        next_start: total
            .is_some_and(|total| consumed < total)
            .then_some(consumed),
        truncated: false,
        limit_reason: None,
    })
}

fn build_variables(
    adapter: &PhpDbgpAdapter,
    properties: &[DbgpProperty],
    pause_generation: u64,
    frame_id: u64,
    depth: u32,
    context_id: u32,
) -> Result<Vec<DebugVariableInfo>, String> {
    let mut shared = adapter
        .inner
        .shared
        .lock()
        .map_err(|error| error.to_string())?;
    if shared
        .pause
        .as_ref()
        .is_none_or(|pause| pause.generation != pause_generation)
    {
        return Err(NOT_PAUSED_ERROR.to_string());
    }
    Ok(properties
        .iter()
        .map(|property| {
            variable_from_property(
                &mut shared,
                property,
                pause_generation,
                frame_id,
                depth,
                context_id,
            )
        })
        .collect())
}

pub(super) fn variable_from_property(
    shared: &mut DbgpShared,
    property: &DbgpProperty,
    pause_generation: u64,
    frame_id: u64,
    depth: u32,
    context_id: u32,
) -> DebugVariableInfo {
    let variables_reference = match (&property.fullname, property.has_children) {
        (Some(fullname), true) => {
            let reference = shared.allocate_reference();
            if let Some(pause) = shared.pause.as_mut() {
                pause.slots.insert(
                    reference,
                    VariableSlot::Property {
                        pause_generation,
                        frame_id,
                        depth,
                        context_id,
                        fullname: fullname.clone(),
                    },
                );
                reference
            } else {
                0
            }
        }
        _ => 0,
    };
    DebugVariableInfo {
        name: property.name.clone(),
        value: property_display_value(property),
        value_type: property
            .classname
            .clone()
            .or_else(|| property.property_type.clone()),
        evaluate_name: None,
        variables_reference,
        can_set_value: None,
        set_expression_reference: None,
    }
}

fn property_display_value(property: &DbgpProperty) -> String {
    match property.property_type.as_deref() {
        Some("object") => property
            .classname
            .clone()
            .unwrap_or_else(|| "object".to_string()),
        Some("array") => format!("array({})", property.numchildren),
        Some("null") => "null".to_string(),
        Some("uninitialized") => "uninitialized".to_string(),
        _ => {
            let mut value = property.value.clone();
            if property.size.is_some_and(|size| size > value.len()) {
                value.push_str("...");
            }
            value
        }
    }
}

fn validate_owner(
    request: DebugVariablePageRequest,
    pause_generation: u64,
    frame_id: u64,
) -> Result<(), String> {
    if request.pause_generation != pause_generation {
        return Err("The debugger pause generation is stale.".to_string());
    }
    if request.frame_id != frame_id {
        return Err("The variables reference belongs to another debug frame.".to_string());
    }
    Ok(())
}

fn validate_after_io(
    inner: &DbgpAdapterInner,
    request: DebugVariablePageRequest,
) -> Result<(), String> {
    let shared = inner.shared.lock().map_err(|error| error.to_string())?;
    let pause = shared
        .pause
        .as_ref()
        .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
    if pause.generation != request.pause_generation
        || !pause.frame_depths.contains_key(&request.frame_id)
    {
        return Err("The debugger pause generation is stale.".to_string());
    }
    Ok(())
}
