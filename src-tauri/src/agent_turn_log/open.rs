use super::errors::{sqlite, AgentTurnLogResult};
use super::schema::{insert_turn_meta, read_turn_meta, update_turn_meta, TurnMetaRow};
use super::wire::{
    AgentTurnLogLease, AgentTurnLogLoss, OpenAgentTurnLogRequest, AGENT_TURN_LOG_SEQ_BASE,
};
use rusqlite::{Connection, TransactionBehavior};

pub(crate) fn open_lease(
    connection: &mut Connection,
    request: &OpenAgentTurnLogRequest,
) -> AgentTurnLogResult<AgentTurnLogLease> {
    let transaction = sqlite(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let turn_id = request.scope.turn_id.as_str();
    let row = match read_turn_meta(&transaction, turn_id)? {
        Some(mut existing) => {
            existing.writer_epoch += 1;
            if existing.loss.is_none() {
                existing.loss = request.prior_loss;
            }
            update_turn_meta(&transaction, &existing)?;
            existing
        }
        None => {
            let created = fresh_row(turn_id.to_string(), request.prior_loss);
            insert_turn_meta(&transaction, &created)?;
            created
        }
    };
    sqlite(transaction.commit())?;
    Ok(AgentTurnLogLease {
        writer_epoch: row.writer_epoch,
        next_seq: row.next_seq,
        digest: row.digest,
        digest_through_seq: row.digest_through_seq,
    })
}

fn fresh_row(turn_id: String, loss: AgentTurnLogLoss) -> TurnMetaRow {
    TurnMetaRow {
        turn_id,
        writer_epoch: 1,
        next_seq: AGENT_TURN_LOG_SEQ_BASE,
        first_seq: 0,
        event_count: 0,
        bytes: 0,
        loss,
        sealed: false,
        digest: None,
        digest_through_seq: 0,
    }
}
