use super::errors::{sequence_gap, sqlite, AgentTurnLogError, AgentTurnLogResult};
use super::payload::{encode_ops, EncodedOp};
use super::schema::{read_turn_meta, update_turn_meta, TurnMetaRow};
use super::wire::{
    AgentTurnLogBudget, AppendAgentTurnLogReceipt, AppendAgentTurnLogRequest, MAX_LOG_COUNTER,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::Value;

pub(crate) fn append(
    connection: &mut Connection,
    request: &AppendAgentTurnLogRequest,
) -> AgentTurnLogResult<AppendAgentTurnLogReceipt> {
    let ops = encode_ops(&request.ops)?;
    let transaction = sqlite(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let turn_id = request.scope.turn_id.as_str();
    let Some(mut meta) = read_turn_meta(&transaction, turn_id)? else {
        return Err(AgentTurnLogError::SupersededWriter);
    };
    if meta.writer_epoch != request.writer_epoch {
        return Err(AgentTurnLogError::SupersededWriter);
    }
    if meta.sealed {
        return append_lifecycle_to_sealed_turn(transaction, request, meta);
    }
    if meta.next_seq != request.expected_next_seq {
        return Err(AgentTurnLogError::SequenceGap(Some(meta.next_seq)));
    }
    let plan = plan_ops(&ops, &meta)?;
    let replaced_bytes = existing_bytes(&transaction, turn_id, &plan.replacements)?;
    let added_bytes: i64 = plan.appends.iter().map(|op| op.payload.len() as i64).sum();
    let replacement_bytes: i64 = plan
        .replacements
        .iter()
        .map(|op| op.payload.len() as i64)
        .sum();
    let turn_bytes = meta
        .bytes
        .checked_sub(replaced_bytes)
        .and_then(|bytes| bytes.checked_add(added_bytes))
        .and_then(|bytes| bytes.checked_add(replacement_bytes))
        .filter(|bytes| (0..=MAX_LOG_COUNTER).contains(bytes))
        .ok_or(AgentTurnLogError::BudgetExhausted)?;
    let appended_count = plan.appends.len() as i64;
    let next_seq = checked_counter(meta.next_seq, appended_count)?;
    let event_count = checked_counter(meta.event_count, appended_count)?;
    for op in &plan.replacements {
        replace_event(&transaction, turn_id, op)?;
    }
    for op in &plan.appends {
        insert_event(&transaction, turn_id, op)?;
    }
    meta.next_seq = next_seq;
    meta.event_count = event_count;
    meta.bytes = turn_bytes;
    meta.first_seq = plan.first_seq;
    meta.sealed = meta.sealed || request.seal;
    if !request.loss.is_none() {
        meta.loss = request.loss;
    }
    if let Some(digest) = request.digest.as_ref() {
        meta.digest = Some(digest.clone());
        meta.digest_through_seq = meta.next_seq - 1;
    }
    if let Some(lifecycle) = request.lifecycle.as_ref() {
        meta.lifecycle = Some(lifecycle.clone());
    }
    update_turn_meta(&transaction, &meta)?;
    sqlite(transaction.commit())?;
    Ok(receipt_of(&meta))
}

fn append_lifecycle_to_sealed_turn(
    transaction: Transaction<'_>,
    request: &AppendAgentTurnLogRequest,
    mut meta: TurnMetaRow,
) -> AgentTurnLogResult<AppendAgentTurnLogReceipt> {
    let Some(lifecycle) = lifecycle_only_request(request) else {
        return Err(AgentTurnLogError::Sealed);
    };
    if meta.next_seq != request.expected_next_seq {
        return Err(AgentTurnLogError::SequenceGap(Some(meta.next_seq)));
    }
    if let Some(stored) = meta.lifecycle.as_ref() {
        return if stored == lifecycle {
            Ok(receipt_of(&meta))
        } else {
            Err(AgentTurnLogError::Sealed)
        };
    }
    meta.lifecycle = Some(lifecycle.clone());
    update_turn_meta(&transaction, &meta)?;
    sqlite(transaction.commit())?;
    Ok(receipt_of(&meta))
}

fn lifecycle_only_request(request: &AppendAgentTurnLogRequest) -> Option<&Value> {
    if !request.ops.is_empty() || request.seal {
        return None;
    }
    request.lifecycle.as_ref()
}

fn receipt_of(meta: &TurnMetaRow) -> AppendAgentTurnLogReceipt {
    AppendAgentTurnLogReceipt {
        persisted_through_seq: meta.next_seq - 1,
        next_seq: meta.next_seq,
        turn_bytes: meta.bytes,
        budget: AgentTurnLogBudget::Ok,
    }
}

struct AppendPlan<'ops> {
    appends: Vec<&'ops EncodedOp>,
    replacements: Vec<&'ops EncodedOp>,
    first_seq: i64,
}

fn plan_ops<'ops>(
    ops: &'ops [EncodedOp],
    meta: &TurnMetaRow,
) -> AgentTurnLogResult<AppendPlan<'ops>> {
    let mut appends = Vec::new();
    let mut replacements = Vec::new();
    for op in ops {
        if op.seq >= meta.next_seq {
            appends.push(op);
            continue;
        }
        if meta.event_count == 0 || op.seq < meta.first_seq {
            return Err(sequence_gap());
        }
        replacements.push(op);
    }
    let first_seq = match meta.event_count == 0 {
        true => appends.first().map_or(meta.first_seq, |op| op.seq),
        false => meta.first_seq,
    };
    Ok(AppendPlan {
        appends,
        replacements,
        first_seq,
    })
}

fn existing_bytes(
    connection: &Connection,
    turn_id: &str,
    replacements: &[&EncodedOp],
) -> AgentTurnLogResult<i64> {
    let mut total = 0i64;
    for op in replacements {
        let bytes: Option<i64> = sqlite(
            connection
                .query_row(
                    "SELECT bytes FROM events WHERE turn_id = ?1 AND seq = ?2",
                    rusqlite::params![turn_id, op.seq],
                    |row| row.get(0),
                )
                .optional(),
        )?;
        let Some(bytes) = bytes else {
            return Err(sequence_gap());
        };
        total = checked_counter(total, bytes)?;
    }
    Ok(total)
}

fn replace_event(connection: &Connection, turn_id: &str, op: &EncodedOp) -> AgentTurnLogResult<()> {
    let changed = sqlite(connection.execute(
        "UPDATE events SET kind = ?3, bytes = ?4, payload = ?5 WHERE turn_id = ?1 AND seq = ?2",
        rusqlite::params![
            turn_id,
            op.seq,
            op.kind,
            op.payload.len() as i64,
            op.payload
        ],
    ))?;
    if changed != 1 {
        return Err(sequence_gap());
    }
    Ok(())
}

fn insert_event(connection: &Connection, turn_id: &str, op: &EncodedOp) -> AgentTurnLogResult<()> {
    sqlite(connection.execute(
        "INSERT INTO events (turn_id, seq, kind, bytes, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            turn_id,
            op.seq,
            op.kind,
            op.payload.len() as i64,
            op.payload
        ],
    ))?;
    Ok(())
}

fn checked_counter(current: i64, added: i64) -> AgentTurnLogResult<i64> {
    current
        .checked_add(added)
        .filter(|value| current >= 0 && added >= 0 && *value <= MAX_LOG_COUNTER)
        .ok_or(AgentTurnLogError::BudgetExhausted)
}
