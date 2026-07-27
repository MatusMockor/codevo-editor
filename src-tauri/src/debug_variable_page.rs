use super::evaluate_wire::valid_optional_evaluate_name;
use crate::debug_adapter::variable_name::is_valid_debug_variable_name;
use crate::debug_adapter::{DebugVariablePage, DebugVariablePageRequest};

const MAX_PAGE_BYTES: usize = 1_024 * 1_024;
const MAX_VALUE_BYTES: usize = 64 * 1_024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn bound_variable_page(
    page: DebugVariablePage,
    request: DebugVariablePageRequest,
) -> Result<DebugVariablePage, String> {
    if page.start != request.start
        || page.variables.len() > request.count as usize
        || usize::try_from(page.returned).ok() != Some(page.variables.len())
        || page.truncated != page.limit_reason.is_some()
    {
        return Err("The debug adapter returned an invalid variable page.".to_string());
    }
    let adapter_consumed = page
        .start
        .checked_add(u64::from(page.returned))
        .ok_or_else(|| "The debug adapter returned an overflowing variable page.".to_string())?;
    if page.total.is_some_and(|total| total < adapter_consumed)
        || page.next_start.is_some_and(|next| {
            next != adapter_consumed
                || next <= page.start
                || page.total.is_some_and(|total| next > total)
        })
        || page.total.is_some_and(|total| {
            let exhausted_reference_capacity = page.truncated
                && page.next_start.is_none()
                && adapter_consumed < total
                && matches!(
                    page.limit_reason,
                    Some(
                        crate::debug_adapter::DebugVariablePageLimitReason::References
                            | crate::debug_adapter::DebugVariablePageLimitReason::ReferenceBytes
                    )
                );
            !exhausted_reference_capacity && page.next_start.is_some() != (adapter_consumed < total)
        })
        || (page.next_start.is_some() && page.total.is_none() && !page.truncated)
    {
        return Err("The debug adapter returned inconsistent variable pagination.".to_string());
    }
    for variable in &page.variables {
        let valid_type = variable.value_type.as_ref().is_none_or(|value_type| {
            !value_type.is_empty()
                && value_type.len() <= super::MAX_DEBUG_EVALUATE_TYPE_BYTES
                && !value_type.chars().any(char::is_control)
        });
        if variable.name.len() > MAX_VALUE_BYTES
            || (variable.can_set_value == Some(true)
                && !is_valid_debug_variable_name(&variable.name))
            || variable.value.len() > MAX_VALUE_BYTES
            || variable.variables_reference > MAX_SAFE_INTEGER
            || variable.can_set_value == Some(false)
            || !valid_type
            || !valid_optional_evaluate_name(variable.evaluate_name.as_deref())
        {
            return Err("The debug adapter returned an out-of-bounds variable.".to_string());
        }
    }
    let mut lower = 0usize;
    let mut upper = page.variables.len();
    while lower < upper {
        let candidate_len = lower + (upper - lower).div_ceil(2);
        let candidate = DebugVariablePage {
            returned: candidate_len as u32,
            variables: page.variables[..candidate_len].to_vec(),
            ..page.clone()
        };
        if serde_json::to_vec(&candidate)
            .map_err(|error| error.to_string())?
            .len()
            <= MAX_PAGE_BYTES
        {
            lower = candidate_len;
        } else {
            upper = candidate_len - 1;
        }
    }
    let variables = page.variables[..lower].to_vec();
    let aggregate_truncated = lower < page.variables.len();
    let returned = variables.len() as u32;
    let consumed = request
        .start
        .checked_add(returned as u64)
        .ok_or_else(|| "Debug variable page offset overflowed.".to_string())?;
    let reference_capacity_exhausted = page.truncated
        && page.next_start.is_none()
        && matches!(
            page.limit_reason,
            Some(
                crate::debug_adapter::DebugVariablePageLimitReason::References
                    | crate::debug_adapter::DebugVariablePageLimitReason::ReferenceBytes
            )
        );
    let has_more = !reference_capacity_exhausted
        && (page.total.is_some_and(|total| consumed < total)
            || page.next_start.is_some()
            || aggregate_truncated);
    Ok(DebugVariablePage {
        variables,
        start: request.start,
        returned,
        total: page.total,
        next_start: has_more.then_some(consumed),
        truncated: page.truncated || aggregate_truncated,
        limit_reason: page.limit_reason.or_else(|| {
            aggregate_truncated
                .then_some(crate::debug_adapter::DebugVariablePageLimitReason::PageBytes)
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::DebugVariablePageLimitReason;

    fn request() -> DebugVariablePageRequest {
        DebugVariablePageRequest {
            pause_generation: 1,
            frame_id: 1,
            variables_reference: 1,
            start: 0,
            count: 100,
        }
    }

    fn page() -> DebugVariablePage {
        DebugVariablePage {
            variables: Vec::new(),
            start: 0,
            returned: 0,
            total: Some(0),
            next_start: None,
            truncated: false,
            limit_reason: None,
        }
    }

    #[test]
    fn rejects_inconsistent_truncation_receipts() {
        assert!(bound_variable_page(
            DebugVariablePage {
                truncated: true,
                ..page()
            },
            request(),
        )
        .is_err());
        assert!(bound_variable_page(
            DebugVariablePage {
                limit_reason: Some(DebugVariablePageLimitReason::References),
                ..page()
            },
            request(),
        )
        .is_err());
    }

    #[test]
    fn preserves_terminal_reference_capacity_receipt_before_exact_total() {
        let bounded = bound_variable_page(
            DebugVariablePage {
                total: Some(20),
                truncated: true,
                limit_reason: Some(DebugVariablePageLimitReason::References),
                ..page()
            },
            request(),
        )
        .expect("truthful terminal reference receipt");
        assert_eq!(bounded.next_start, None);
        assert_eq!(bounded.total, Some(20));
        assert_eq!(
            bounded.limit_reason,
            Some(DebugVariablePageLimitReason::References)
        );
    }
}
