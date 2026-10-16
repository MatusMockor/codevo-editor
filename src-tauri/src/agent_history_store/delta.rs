use super::{
    commit_save, halt_requests,
    legacy::{
        validate_agent_turn_event, AgentThread, AgentTurn, AgentTurnEvent,
        MAX_AGENT_EVENTS_PER_TURN,
    },
    sql, validate, AgentHistoryStore, TurnHaltRequest, MAX_PAGE_BYTES,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const MAX_HISTORY_DELTA_EDITS: usize = MAX_AGENT_EVENTS_PER_TURN;
pub(crate) const HISTORY_EVENTS_DIGEST_HEX_LENGTH: usize = 64;
const DELTA_FINGERPRINT_DOMAIN: &[u8] = b"agent-history-turn-delta-v1\0";
const EVENTS_DIGEST_DOMAIN: &[u8] = b"agent-history-turn-events-v1\0";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum HistoryEventEdit {
    Copy { start: u32, count: u32 },
    Insert { events: Vec<AgentTurnEvent> },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryTurnDelta {
    pub base_event_count: u32,
    pub base_events_digest: String,
    pub edits: Vec<HistoryEventEdit>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HistoryDeltaRefusal {
    BaseMismatch,
    MissingBase,
    InvalidDelta,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum HistoryDeltaOutcome {
    #[serde(rename_all = "camelCase")]
    Saved {
        revision: u64,
        events_digest: String,
    },
    NeedsFullSave {
        reason: HistoryDeltaRefusal,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaFingerprintInput<'a> {
    thread: &'a AgentThread,
    delta: &'a HistoryTurnDelta,
    halt_requests: &'a [TurnHaltRequest],
}

fn refuse(reason: HistoryDeltaRefusal) -> Result<HistoryDeltaOutcome, String> {
    Ok(HistoryDeltaOutcome::NeedsFullSave { reason })
}

impl AgentHistoryStore {
    pub(crate) fn save_turn_delta(
        &self,
        root: &str,
        owner: &str,
        thread: &AgentThread,
        expected_revision: u64,
        delta: &HistoryTurnDelta,
        halts: &[TurnHaltRequest],
    ) -> Result<HistoryDeltaOutcome, String> {
        if expected_revision >= super::legacy::MAX_AGENT_SAFE_INTEGER {
            return Err("Agent history revision is out of bounds.".into());
        }
        let Some(turn) = delta_turn(thread, delta) else {
            return refuse(HistoryDeltaRefusal::InvalidDelta);
        };
        if validate(root, thread).is_err()
            || halt_requests::validate(thread, halts).is_err()
            || inserted_events(delta).any(|event| validate_agent_turn_event(event).is_err())
        {
            return refuse(HistoryDeltaRefusal::InvalidDelta);
        }
        let encoded = serde_json::to_vec(&DeltaFingerprintInput {
            thread,
            delta,
            halt_requests: halts,
        })
        .map_err(|e| e.to_string())?;
        if encoded.len() > MAX_PAGE_BYTES {
            return refuse(HistoryDeltaRefusal::InvalidDelta);
        }
        let fingerprint = digest(DELTA_FINGERPRINT_DOMAIN, &encoded);
        self.with_connection(root, owner, |connection| {
            let tx = sql(
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            )?;
            let deleted: bool = sql(tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1)",
                [&thread.thread_id],
                |r| r.get(0),
            ))?;
            if deleted {
                return refuse(HistoryDeltaRefusal::MissingBase);
            }
            let stored: Option<(i64, Option<String>)> = sql(tx
                .query_row(
                    "SELECT revision,last_save_hash FROM threads WHERE thread_id=?1",
                    [&thread.thread_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional())?;
            let Some((actual, accepted)) = stored else {
                return refuse(HistoryDeltaRefusal::MissingBase);
            };
            let payload: Option<String> = sql(tx
                .query_row(
                    "SELECT payload FROM turns WHERE thread_id=?1 AND turn_id=?2",
                    rusqlite::params![thread.thread_id, turn.turn_id],
                    |row| row.get(0),
                )
                .optional())?;
            let Some(payload) = payload else {
                return refuse(HistoryDeltaRefusal::MissingBase);
            };
            let Ok(base) = serde_json::from_str::<AgentTurn>(&payload) else {
                return refuse(HistoryDeltaRefusal::BaseMismatch);
            };
            if base.turn_id != turn.turn_id {
                return refuse(HistoryDeltaRefusal::BaseMismatch);
            }
            if actual == expected_revision as i64 + 1
                && accepted.as_deref() == Some(fingerprint.as_str())
            {
                return Ok(HistoryDeltaOutcome::Saved {
                    revision: expected_revision + 1,
                    events_digest: history_events_digest(&base.events)?,
                });
            }
            if actual != expected_revision as i64
                || base.events.len() != delta.base_event_count as usize
                || history_events_digest(&base.events)? != delta.base_events_digest
            {
                return refuse(HistoryDeltaRefusal::BaseMismatch);
            }
            let Some(events) = apply_edits(base.events, &delta.edits) else {
                return refuse(HistoryDeltaRefusal::InvalidDelta);
            };
            let mut rebuilt = thread.clone();
            rebuilt.turns[0].events = events;
            if validate(root, &rebuilt).is_err()
                || serde_json::to_vec(&rebuilt)
                    .map_err(|e| e.to_string())?
                    .len()
                    > MAX_PAGE_BYTES
            {
                return refuse(HistoryDeltaRefusal::InvalidDelta);
            }
            match commit_save(tx, &rebuilt, expected_revision, halts, &fingerprint) {
                Ok(revision) => Ok(HistoryDeltaOutcome::Saved {
                    revision,
                    events_digest: history_events_digest(&rebuilt.turns[0].events)?,
                }),
                Err(_) => refuse(HistoryDeltaRefusal::InvalidDelta),
            }
        })
    }
}

pub(crate) fn history_events_digest(events: &[AgentTurnEvent]) -> Result<String, String> {
    let encoded = serde_json::to_vec(events).map_err(|e| e.to_string())?;
    Ok(digest(EVENTS_DIGEST_DOMAIN, &encoded))
}

fn digest(domain: &[u8], encoded: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(encoded);
    format!("{:x}", hasher.finalize())
}

fn inserted_events(delta: &HistoryTurnDelta) -> impl Iterator<Item = &AgentTurnEvent> {
    delta.edits.iter().flat_map(|edit| match edit {
        HistoryEventEdit::Insert { events } => events.as_slice(),
        HistoryEventEdit::Copy { .. } => &[],
    })
}

fn delta_turn<'a>(thread: &'a AgentThread, delta: &HistoryTurnDelta) -> Option<&'a AgentTurn> {
    let [turn] = thread.turns.as_slice() else {
        return None;
    };
    if !turn.events.is_empty()
        || delta.base_events_digest.len() != HISTORY_EVENTS_DIGEST_HEX_LENGTH
        || !delta
            .base_events_digest
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        || delta.base_event_count as usize > MAX_AGENT_EVENTS_PER_TURN
        || delta.edits.is_empty()
        || delta.edits.len() > MAX_HISTORY_DELTA_EDITS
    {
        return None;
    }
    let mut total = 0usize;
    for edit in &delta.edits {
        total = total.checked_add(match edit {
            HistoryEventEdit::Copy { count, .. } if *count > 0 => *count as usize,
            HistoryEventEdit::Insert { events } if !events.is_empty() => events.len(),
            HistoryEventEdit::Copy { .. } | HistoryEventEdit::Insert { .. } => return None,
        })?;
    }
    (total <= MAX_AGENT_EVENTS_PER_TURN).then_some(turn)
}

fn apply_edits(
    base: Vec<AgentTurnEvent>,
    edits: &[HistoryEventEdit],
) -> Option<Vec<AgentTurnEvent>> {
    let mut events = Vec::new();
    for edit in edits {
        match edit {
            HistoryEventEdit::Copy { start, count } => {
                let start = *start as usize;
                let end = start.checked_add(*count as usize)?;
                events.extend_from_slice(base.get(start..end)?);
            }
            HistoryEventEdit::Insert { events: inserted } => {
                events.extend(inserted.iter().cloned());
            }
        }
    }
    Some(events)
}
