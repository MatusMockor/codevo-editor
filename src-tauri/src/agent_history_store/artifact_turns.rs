use super::{
    legacy::{self, AgentThread, AgentThreadOwner, AgentThreadTarget, AgentTurnStatus},
    sql,
};
use rusqlite::{types::Value, Connection, OptionalExtension};

pub(crate) const MAX_ARTIFACT_LATER_TURNS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ArtifactFactsError {
    MalformedTurn,
    Storage(String),
}

impl From<String> for ArtifactFactsError {
    fn from(error: String) -> Self {
        Self::Storage(error)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ArtifactTurnFact {
    pub turn_id: String,
    pub status: AgentTurnStatus,
    pub started_at_epoch_ms: u64,
    pub ended_at_epoch_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ArtifactThreadFacts {
    pub thread_id: String,
    pub owner: AgentThreadOwner,
    pub target: AgentThreadTarget,
    pub turns: Vec<ArtifactTurnFact>,
    pub successors_truncated: bool,
}

pub(super) fn read(
    connection: &Connection,
    root: &str,
    thread_id: &str,
    turn_id: &str,
) -> Result<Option<ArtifactThreadFacts>, ArtifactFactsError> {
    let deleted: bool = sql(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1)",
        [thread_id],
        |row| row.get(0),
    ))?;
    if deleted {
        return Ok(None);
    }
    let payload: Option<String> = sql(connection
        .query_row(
            "SELECT payload FROM threads WHERE thread_id=?1",
            [thread_id],
            |row| row.get(0),
        )
        .optional())?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    let header: AgentThread = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    super::validate(root, &header)?;
    if header.thread_id != thread_id {
        return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.to_string().into());
    }
    let (turns, successors_truncated) = turn_facts(connection, thread_id, turn_id)?;
    Ok(Some(ArtifactThreadFacts {
        thread_id: header.thread_id,
        owner: header.owner,
        target: header.target,
        turns,
        successors_truncated,
    }))
}

fn turn_facts(
    connection: &Connection,
    thread_id: &str,
    turn_id: &str,
) -> Result<(Vec<ArtifactTurnFact>, bool), ArtifactFactsError> {
    let ordinal: Option<i64> = sql(connection
        .query_row(
            "SELECT ordinal FROM turns WHERE thread_id=?1 AND turn_id=?2",
            [thread_id, turn_id],
            |row| row.get(0),
        )
        .optional())?;
    let Some(ordinal) = ordinal else {
        return Ok((Vec::new(), false));
    };
    let window = MAX_ARTIFACT_LATER_TURNS + 1;
    let mut statement = sql(connection.prepare(
        "SELECT turn_id,json_extract(payload,'$.status'),json_extract(payload,'$.startedAtEpochMs'),json_extract(payload,'$.endedAtEpochMs') FROM turns WHERE thread_id=?1 AND ordinal>=?2 ORDER BY ordinal ASC LIMIT ?3",
    ))?;
    let rows = sql(statement.query_map(
        rusqlite::params![thread_id, ordinal, window as i64 + 1],
        |row| {
            Ok((
                row.get::<_, Value>(0)?,
                row.get::<_, Value>(1)?,
                row.get::<_, Value>(2)?,
                row.get::<_, Value>(3)?,
            ))
        },
    ))?;
    let mut facts = Vec::new();
    for row in rows {
        let (id, status, started, ended) = sql(row)?;
        if facts.len() == window {
            return Ok((facts, true));
        }
        facts.push(fact(id, status, started, ended).ok_or(ArtifactFactsError::MalformedTurn)?);
    }
    Ok((facts, false))
}

fn fact(turn_id: Value, status: Value, started: Value, ended: Value) -> Option<ArtifactTurnFact> {
    let Value::Text(turn_id) = turn_id else {
        return None;
    };
    crate::git_worktree::safe_agent_task_id(&turn_id).ok()?;
    let Value::Text(status) = status else {
        return None;
    };
    let status: AgentTurnStatus = serde_json::from_str(&status).ok()?;
    let Value::Integer(started) = started else {
        return None;
    };
    Some(ArtifactTurnFact {
        turn_id,
        status,
        started_at_epoch_ms: epoch(started)?,
        ended_at_epoch_ms: optional_epoch(ended)?,
    })
}

fn optional_epoch(value: Value) -> Option<Option<u64>> {
    match value {
        Value::Null => Some(None),
        Value::Integer(value) => epoch(value).map(Some),
        _ => None,
    }
}

fn epoch(value: i64) -> Option<u64> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value <= legacy::MAX_AGENT_SAFE_INTEGER)
}
