use super::runtime_requests::{integer_column, stored, text_column};
use crate::agent_questions::approvals::MAX_RETAINED_AGENT_APPROVALS;
use crate::agent_questions::MAX_RETAINED_AGENT_QUESTIONS;
use crate::agent_runtime_requests::model::RequestKind;
use crate::agent_runtime_requests::store::{StoreError, TurnKey};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SuppressedRequest {
    pub(super) id: String,
    pub(super) kind: RequestKind,
}

fn retained_by_session(kind: RequestKind) -> usize {
    match kind {
        RequestKind::Question => MAX_RETAINED_AGENT_QUESTIONS,
        RequestKind::Approval => MAX_RETAINED_AGENT_APPROVALS,
    }
}

struct StoredTurnState {
    owner: Option<String>,
    applied_sequence: Option<i64>,
    suppressed: Option<String>,
    incarnation: Option<i64>,
}

#[derive(Default)]
pub(super) struct TurnState {
    pub(super) incarnation: i64,
    pub(super) applied_sequence: i64,
    pub(super) suppressed: Vec<SuppressedRequest>,
    pub(super) stored: bool,
}

impl TurnState {
    pub(super) fn load(
        transaction: &Transaction<'_>,
        thread_id: &str,
        turn_id: &str,
        run_id: &str,
    ) -> Result<Self, StoreError> {
        let stored_state: Option<StoredTurnState> = stored(
            transaction
                .query_row(
                    "SELECT run_id,applied_sequence,suppressed,incarnation
                     FROM runtime_request_turns WHERE thread_id=?1 AND turn_id=?2",
                    [thread_id, turn_id],
                    |row| {
                        Ok(StoredTurnState {
                            owner: text_column(row, 0),
                            applied_sequence: integer_column(row, 1),
                            suppressed: text_column(row, 2),
                            incarnation: integer_column(row, 3),
                        })
                    },
                )
                .optional(),
        )?;
        let Some(StoredTurnState {
            owner: Some(owner),
            applied_sequence: Some(applied_sequence),
            suppressed,
            incarnation: Some(incarnation),
        }) = stored_state
        else {
            return Ok(Self::default());
        };
        if owner != run_id {
            return Ok(Self::default());
        }
        Ok(Self {
            incarnation,
            applied_sequence,
            suppressed: suppressed
                .and_then(|suppressed| serde_json::from_str(&suppressed).ok())
                .unwrap_or_default(),
            stored: true,
        })
    }

    pub(super) fn save(
        &self,
        transaction: &Transaction<'_>,
        thread_id: &str,
        turn_id: &str,
        run_id: &str,
    ) -> Result<(), StoreError> {
        let suppressed = serde_json::to_string(&self.suppressed).unwrap_or_else(|_| "[]".into());
        stored(transaction.execute(
            "INSERT INTO runtime_request_turns(
                thread_id,turn_id,run_id,applied_sequence,suppressed,incarnation)
             VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(thread_id,turn_id) DO UPDATE SET
                run_id=excluded.run_id,
                applied_sequence=excluded.applied_sequence,
                suppressed=excluded.suppressed,
                incarnation=excluded.incarnation",
            params![
                thread_id,
                turn_id,
                run_id,
                self.applied_sequence,
                suppressed,
                self.incarnation
            ],
        ))?;
        Ok(())
    }

    pub(super) fn suppresses(&self, request_id: &str) -> bool {
        self.suppressed
            .iter()
            .any(|suppressed| suppressed.id == request_id)
    }

    pub(super) fn suppress(&mut self, request: SuppressedRequest) {
        if self.suppresses(&request.id) {
            return;
        }
        let kind = request.kind;
        self.suppressed.push(request);
        let of_kind = |state: &Self| {
            state
                .suppressed
                .iter()
                .filter(|suppressed| suppressed.kind == kind)
                .count()
        };
        while of_kind(self) > retained_by_session(kind) {
            let Some(oldest) = self
                .suppressed
                .iter()
                .position(|suppressed| suppressed.kind == kind)
            else {
                return;
            };
            self.suppressed.remove(oldest);
        }
    }
}

pub(super) fn retain_turn_states(
    connection: &mut Connection,
    run_id: &str,
    known_turns: &[TurnKey],
) -> Result<u64, StoreError> {
    let transaction = stored(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let known: HashSet<(&str, &str)> = known_turns
        .iter()
        .map(|key| (key.thread_id.as_str(), key.turn_id.as_str()))
        .collect();
    let saved: Vec<(String, String)> = {
        let mut statement = stored(
            transaction
                .prepare("SELECT thread_id,turn_id FROM runtime_request_turns WHERE run_id=?1"),
        )?;
        let rows = stored(statement.query_map([run_id], |row| {
            Ok((text_column(row, 0), text_column(row, 1)))
        }))?;
        let mut saved = Vec::new();
        for row in rows {
            let (Some(thread_id), Some(turn_id)) = stored(row)? else {
                continue;
            };
            saved.push((thread_id, turn_id));
        }
        saved
    };
    let mut forgotten = 0;
    for (thread_id, turn_id) in &saved {
        if known.contains(&(thread_id.as_str(), turn_id.as_str())) {
            continue;
        }
        forgotten += stored(transaction.execute(
            "DELETE FROM runtime_request_turns WHERE thread_id=?1 AND turn_id=?2 AND run_id=?3",
            params![thread_id, turn_id, run_id],
        ))?;
    }
    stored(transaction.commit())?;
    Ok(u64::try_from(forgotten).unwrap_or(u64::MAX))
}
