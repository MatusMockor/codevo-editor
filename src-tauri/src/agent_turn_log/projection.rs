use super::errors::{AgentTurnLogError, AgentTurnLogResult};
use super::validation::{validate_digest, validate_loss};
use super::wire::{
    AgentTurnLogLease, AgentTurnLogPage, AgentTurnLogSummary, AppendAgentTurnLogReceipt,
    AGENT_TURN_LOG_SEQ_BASE, MAX_TURN_SUMMARIES,
};
use std::collections::HashSet;

pub(crate) fn validate_lease(lease: &AgentTurnLogLease) -> AgentTurnLogResult<()> {
    if lease.writer_epoch < 1 || lease.next_seq < AGENT_TURN_LOG_SEQ_BASE {
        return Err(AgentTurnLogError::Unreadable);
    }
    let Some(digest) = lease.digest.as_ref() else {
        if lease.digest_through_seq != 0 {
            return Err(AgentTurnLogError::Unreadable);
        }
        return Ok(());
    };
    validate_digest(digest)?;
    if lease.digest_through_seq < AGENT_TURN_LOG_SEQ_BASE
        || lease.digest_through_seq > lease.next_seq - 1
    {
        return Err(AgentTurnLogError::Unreadable);
    }
    Ok(())
}

pub(crate) fn validate_receipt(receipt: &AppendAgentTurnLogReceipt) -> AgentTurnLogResult<()> {
    if receipt.next_seq < AGENT_TURN_LOG_SEQ_BASE
        || receipt.persisted_through_seq != receipt.next_seq - 1
        || receipt.turn_bytes < 0
    {
        return Err(AgentTurnLogError::Unreadable);
    }
    Ok(())
}

pub(crate) fn validate_page(page: &AgentTurnLogPage) -> AgentTurnLogResult<()> {
    validate_loss(page.loss)?;
    let Some(first) = page.entries.first() else {
        if page.first_seq != 0 || page.last_seq != 0 {
            return Err(AgentTurnLogError::Unreadable);
        }
        return Ok(());
    };
    let mut previous: Option<i64> = None;
    for entry in &page.entries {
        if entry.seq < AGENT_TURN_LOG_SEQ_BASE {
            return Err(AgentTurnLogError::Unreadable);
        }
        if previous.is_some_and(|previous| entry.seq <= previous) {
            return Err(AgentTurnLogError::Unreadable);
        }
        previous = Some(entry.seq);
    }
    if page.first_seq != first.seq || Some(page.last_seq) != previous {
        return Err(AgentTurnLogError::Unreadable);
    }
    Ok(())
}

pub(crate) fn validate_summaries(summaries: &[AgentTurnLogSummary]) -> AgentTurnLogResult<()> {
    if summaries.len() > MAX_TURN_SUMMARIES {
        return Err(AgentTurnLogError::Unreadable);
    }
    let mut turn_ids = HashSet::new();
    for summary in summaries {
        validate_loss(summary.loss)?;
        if summary.event_count < 0 || summary.bytes < 0 {
            return Err(AgentTurnLogError::Unreadable);
        }
        if !turn_ids.insert(summary.turn_id.as_str()) {
            return Err(AgentTurnLogError::Unreadable);
        }
        if let Some(digest) = summary.digest.as_ref() {
            validate_digest(digest)?;
        }
    }
    Ok(())
}
