use super::{legacy::AgentTurn, sql, TurnPage, MAX_PAGE_TURNS};
use rusqlite::{Connection, OptionalExtension};
pub(super) fn read(
    connection: &Connection,
    root: &str,
    id: &str,
    before: Option<&str>,
    budget: usize,
) -> Result<TurnPage, String> {
    let payload: Option<String> = sql(connection
        .query_row(
            "SELECT payload FROM threads WHERE thread_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional())?;
    let payload = payload.ok_or("The saved thread is unavailable.")?;
    let mut header: super::legacy::AgentThread =
        serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    super::validate(root, &header)?;
    if header.thread_id != id {
        return Err(super::legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
    }
    let revision: i64 = sql(connection.query_row(
        "SELECT revision FROM threads WHERE thread_id=?1",
        [id],
        |row| row.get(0),
    ))?;
    if revision < 1 || revision > super::legacy::MAX_AGENT_SAFE_INTEGER as i64 {
        return Err("Invalid saved history revision.".into());
    }
    let cursor = match before {
        None => i64::MAX,
        Some(turn) => sql(connection
            .query_row(
                "SELECT ordinal FROM turns WHERE thread_id=?1 AND turn_id=?2",
                [id, turn],
                |r| r.get::<_, i64>(0),
            )
            .optional())?
        .ok_or("Agent history cursor does not belong to this thread.")?,
    };
    let mut statement=sql(connection.prepare("SELECT turn_id,payload FROM turns WHERE thread_id=?1 AND ordinal<?2 ORDER BY ordinal DESC LIMIT ?3"))?;
    let rows = sql(statement.query_map(
        rusqlite::params![id, cursor, MAX_PAGE_TURNS as i64 + 1],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    ))?;
    let mut turns = Vec::<AgentTurn>::new();
    let mut bytes = 0;
    let mut has_earlier = false;
    for row in rows {
        let (turn_id, payload) = sql(row)?;
        if turns.len() == MAX_PAGE_TURNS || bytes + payload.len() + 1 > budget {
            has_earlier = true;
            break;
        }
        let turn: AgentTurn = serde_json::from_str(&payload)
            .map_err(|e| format!("Unable to decode saved agent turn: {e}"))?;
        if turn.turn_id != turn_id {
            return Err("The saved turn identifier is invalid.".into());
        }
        header.turns = vec![turn.clone()];
        super::validate(root, &header)?;
        bytes += payload.len() + 1;
        turns.push(turn);
    }
    turns.reverse();
    let before_turn_id = turns.first().map(|turn| turn.turn_id.clone());
    Ok(TurnPage {
        turns,
        has_earlier,
        before_turn_id,
        revision: revision as u64,
    })
}
