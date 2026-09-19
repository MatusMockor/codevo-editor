use super::agent_thread_store::MAX_AGENT_CONTEXT_MODEL_BYTES;
use super::errors::{sequence_gap, AgentTurnLogError, AgentTurnLogResult};
use super::paths::ensure_scope_authority;
use super::wire::{
    AgentTurnDigestWire, AgentTurnLogAnchorAt, AgentTurnLogEntry, AgentTurnLogLoss,
    AgentTurnLogLossKind, AgentTurnLogScope, AppendAgentTurnLogRequest,
    DeleteAgentThreadLogRequest, OpenAgentTurnLogRequest, ReadAgentTurnLogPageRequest,
    SummarizeAgentTurnLogsRequest, AGENT_TURN_DIGEST_VERSION, AGENT_TURN_LOG_SEQ_BASE,
    MAX_APPEND_OPS, MAX_DIGEST_BYTES, MAX_DIGEST_CAPACITIES, MAX_PAGE_BYTES, MAX_PAGE_EVENTS,
    MAX_TURN_PROMPT_BYTES,
};
use crate::git_worktree::safe_agent_task_id;
use std::collections::HashSet;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) fn validate_open_request(request: &OpenAgentTurnLogRequest) -> AgentTurnLogResult<()> {
    validate_scope(&request.scope)?;
    validate_loss(request.prior_loss)?;
    validate_turn_prompt(request.prompt.as_deref())
}

fn validate_turn_prompt(prompt: Option<&str>) -> AgentTurnLogResult<()> {
    let Some(prompt) = prompt else {
        return Ok(());
    };
    if prompt.is_empty() || prompt.len() > MAX_TURN_PROMPT_BYTES || prompt.contains('\0') {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    Ok(())
}

pub(crate) fn validate_append_request(
    request: &AppendAgentTurnLogRequest,
) -> AgentTurnLogResult<()> {
    validate_scope(&request.scope)?;
    validate_loss(request.loss)?;
    if request.writer_epoch < 1 {
        return Err(AgentTurnLogError::SupersededWriter);
    }
    if request.expected_next_seq < AGENT_TURN_LOG_SEQ_BASE {
        return Err(sequence_gap());
    }
    if request.ops.len() > MAX_APPEND_OPS {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    validate_op_order(&request.ops, request.expected_next_seq)?;
    let Some(digest) = request.digest.as_ref() else {
        return Ok(());
    };
    validate_digest(digest)
}

pub(crate) fn validate_page_request(
    request: &ReadAgentTurnLogPageRequest,
) -> AgentTurnLogResult<()> {
    validate_scope(&request.scope)?;
    if request.max_events < 1 || request.max_events > MAX_PAGE_EVENTS {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    if request.max_bytes < 1 || request.max_bytes > MAX_PAGE_BYTES {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    let anchored = request.anchor.at != AgentTurnLogAnchorAt::Tail;
    match request.anchor.seq {
        Some(seq) if anchored && seq >= AGENT_TURN_LOG_SEQ_BASE => Ok(()),
        None if !anchored => Ok(()),
        _ => Err(sequence_gap()),
    }
}

pub(crate) fn validate_summarize_request(
    request: &SummarizeAgentTurnLogsRequest,
) -> AgentTurnLogResult<()> {
    ensure_scope_authority(&request.root_key, &request.owner_id)?;
    safe_agent_task_id(&request.thread_id).map_err(|_| AgentTurnLogError::OwnerMismatch)?;
    Ok(())
}

pub(crate) fn validate_delete_request(
    request: &DeleteAgentThreadLogRequest,
) -> AgentTurnLogResult<()> {
    ensure_scope_authority(&request.root_key, &request.owner_id)?;
    safe_agent_task_id(&request.thread_id).map_err(|_| AgentTurnLogError::OwnerMismatch)?;
    Ok(())
}

fn validate_scope(scope: &AgentTurnLogScope) -> AgentTurnLogResult<()> {
    ensure_scope_authority(&scope.root_key, &scope.owner_id)?;
    safe_agent_task_id(&scope.thread_id).map_err(|_| AgentTurnLogError::OwnerMismatch)?;
    safe_agent_task_id(&scope.turn_id).map_err(|_| AgentTurnLogError::OwnerMismatch)?;
    Ok(())
}

pub(crate) fn validate_loss(loss: AgentTurnLogLoss) -> AgentTurnLogResult<()> {
    let timestamped = loss.kind == AgentTurnLogLossKind::DiskBudget;
    match loss.at_epoch_ms {
        Some(at_epoch_ms) if timestamped && at_epoch_ms <= MAX_SAFE_INTEGER => Ok(()),
        None if !timestamped => Ok(()),
        _ => Err(AgentTurnLogError::BudgetExhausted),
    }
}

fn validate_op_order(ops: &[AgentTurnLogEntry], expected_next_seq: i64) -> AgentTurnLogResult<()> {
    let mut previous: Option<i64> = None;
    let mut next_append = expected_next_seq;
    for op in ops {
        if op.seq < AGENT_TURN_LOG_SEQ_BASE {
            return Err(sequence_gap());
        }
        if previous.is_some_and(|previous| op.seq <= previous) {
            return Err(sequence_gap());
        }
        previous = Some(op.seq);
        if op.seq < expected_next_seq {
            continue;
        }
        if op.seq != next_append {
            return Err(sequence_gap());
        }
        next_append += 1;
    }
    Ok(())
}

pub(crate) fn validate_digest(digest: &AgentTurnDigestWire) -> AgentTurnLogResult<()> {
    if digest.version != AGENT_TURN_DIGEST_VERSION {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    let context = &digest.context;
    if context.capacities.len() > MAX_DIGEST_CAPACITIES {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    let mut models = HashSet::new();
    for capacity in &context.capacities {
        validate_model(&capacity.model)?;
        if capacity.context_window == 0 || capacity.context_window > MAX_SAFE_INTEGER {
            return Err(AgentTurnLogError::BudgetExhausted);
        }
        if !models.insert(capacity.model.as_str()) {
            return Err(AgentTurnLogError::BudgetExhausted);
        }
    }
    if let Some(primary) = context.primary.as_ref() {
        validate_model(&primary.model)?;
        if primary.input_tokens > MAX_SAFE_INTEGER {
            return Err(AgentTurnLogError::BudgetExhausted);
        }
    }
    if let Some(current) = context.current {
        if current.context_window == 0
            || current.context_window > MAX_SAFE_INTEGER
            || current.used_tokens > MAX_SAFE_INTEGER
        {
            return Err(AgentTurnLogError::BudgetExhausted);
        }
    }
    let encoded = serde_json::to_vec(digest).map_err(|_| AgentTurnLogError::BudgetExhausted)?;
    if encoded.len() > MAX_DIGEST_BYTES {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    Ok(())
}

fn validate_model(model: &str) -> AgentTurnLogResult<()> {
    if model.is_empty()
        || model.len() > MAX_AGENT_CONTEXT_MODEL_BYTES
        || model.chars().any(char::is_control)
    {
        return Err(AgentTurnLogError::BudgetExhausted);
    }
    Ok(())
}
