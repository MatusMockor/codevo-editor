use super::errors::{sqlite, AgentTurnLogResult};
use super::payload::decode_event;
use super::schema::TurnMetaRow;
use super::wire::{
    AgentTurnLogAnchor, AgentTurnLogAnchorAt, AgentTurnLogEntry, AgentTurnLogLoss,
    AgentTurnLogLossKind, AgentTurnLogPage, ReadAgentTurnLogPageRequest,
};
use rusqlite::Connection;

#[derive(Clone, Copy, Debug)]
struct Budget {
    events: usize,
    bytes: usize,
}

#[derive(Default)]
struct Collected {
    entries: Vec<AgentTurnLogEntry>,
    bytes: usize,
    clipped: bool,
    unreadable: bool,
}

pub(crate) fn read_page(
    connection: &Connection,
    request: &ReadAgentTurnLogPageRequest,
    meta: Option<&TurnMetaRow>,
) -> AgentTurnLogResult<AgentTurnLogPage> {
    let turn_id = request.scope.turn_id.as_str();
    let budget = Budget {
        events: request.max_events as usize,
        bytes: request.max_bytes as usize,
    };
    let anchor_seq = request.anchor.seq.unwrap_or_default();
    let collected = match request.anchor.at {
        AgentTurnLogAnchorAt::Tail => descending(connection, turn_id, i64::MAX, budget)?,
        AgentTurnLogAnchorAt::Before => {
            descending(connection, turn_id, anchor_seq.saturating_sub(1), budget)?
        }
        AgentTurnLogAnchorAt::After => {
            ascending(connection, turn_id, anchor_seq.saturating_add(1), budget)?
        }
        AgentTurnLogAnchorAt::Around => around(connection, turn_id, anchor_seq, budget)?,
    };
    let loss = page_loss(meta, collected.unreadable);
    let Some(first) = collected.entries.first() else {
        return empty_anchored_page(connection, turn_id, request.anchor, loss);
    };
    let first_seq = first.seq;
    let last_seq = collected
        .entries
        .last()
        .map_or(first_seq, |entry| entry.seq);
    Ok(AgentTurnLogPage {
        entries: collected.entries,
        first_seq,
        last_seq,
        has_earlier: exists(connection, turn_id, "seq < ?2", first_seq)?,
        has_later: exists(connection, turn_id, "seq > ?2", last_seq)?,
        loss,
        clipped: collected.clipped,
    })
}

fn page_loss(meta: Option<&TurnMetaRow>, unreadable: bool) -> AgentTurnLogLoss {
    if unreadable {
        return AgentTurnLogLoss::of(AgentTurnLogLossKind::Unreadable);
    }
    meta.map_or(AgentTurnLogLoss::of(AgentTurnLogLossKind::None), |row| {
        row.loss
    })
}

pub(crate) fn empty_page() -> AgentTurnLogPage {
    AgentTurnLogPage {
        entries: Vec::new(),
        first_seq: 0,
        last_seq: 0,
        has_earlier: false,
        has_later: false,
        loss: AgentTurnLogLoss::of(AgentTurnLogLossKind::None),
        clipped: false,
    }
}

fn empty_anchored_page(
    connection: &Connection,
    turn_id: &str,
    anchor: AgentTurnLogAnchor,
    loss: AgentTurnLogLoss,
) -> AgentTurnLogResult<AgentTurnLogPage> {
    let seq = anchor.seq.unwrap_or_default();
    let (has_earlier, has_later) = match anchor.at {
        AgentTurnLogAnchorAt::Tail => (false, false),
        AgentTurnLogAnchorAt::Before => (false, exists(connection, turn_id, "seq >= ?2", seq)?),
        AgentTurnLogAnchorAt::After => (exists(connection, turn_id, "seq <= ?2", seq)?, false),
        AgentTurnLogAnchorAt::Around => (
            exists(connection, turn_id, "seq < ?2", seq)?,
            exists(connection, turn_id, "seq > ?2", seq)?,
        ),
    };
    Ok(AgentTurnLogPage {
        entries: Vec::new(),
        first_seq: 0,
        last_seq: 0,
        has_earlier,
        has_later,
        loss,
        clipped: false,
    })
}

fn around(
    connection: &Connection,
    turn_id: &str,
    seq: i64,
    budget: Budget,
) -> AgentTurnLogResult<Collected> {
    let backward = Budget {
        events: budget.events.div_ceil(2),
        bytes: budget.bytes,
    };
    let mut collected = descending(connection, turn_id, seq, backward)?;
    if collected.clipped || collected.entries.len() >= budget.events {
        return Ok(collected);
    }
    let forward = Budget {
        events: budget.events.saturating_sub(collected.entries.len()),
        bytes: budget.bytes.saturating_sub(collected.bytes),
    };
    if forward.bytes == 0 {
        collected.clipped = true;
        return Ok(collected);
    }
    let later = ascending(connection, turn_id, seq.saturating_add(1), forward)?;
    collected.entries.extend(later.entries);
    collected.bytes += later.bytes;
    collected.clipped = later.clipped;
    collected.unreadable = collected.unreadable || later.unreadable;
    Ok(collected)
}

fn descending(
    connection: &Connection,
    turn_id: &str,
    highest_seq: i64,
    budget: Budget,
) -> AgentTurnLogResult<Collected> {
    let mut collected = collect(
        connection,
        "SELECT seq, payload FROM events WHERE turn_id = ?1 AND seq <= ?2 ORDER BY seq DESC LIMIT ?3",
        turn_id,
        highest_seq,
        budget,
    )?;
    collected.entries.reverse();
    Ok(collected)
}

fn ascending(
    connection: &Connection,
    turn_id: &str,
    lowest_seq: i64,
    budget: Budget,
) -> AgentTurnLogResult<Collected> {
    collect(
        connection,
        "SELECT seq, payload FROM events WHERE turn_id = ?1 AND seq >= ?2 ORDER BY seq ASC LIMIT ?3",
        turn_id,
        lowest_seq,
        budget,
    )
}

fn collect(
    connection: &Connection,
    statement: &str,
    turn_id: &str,
    boundary: i64,
    budget: Budget,
) -> AgentTurnLogResult<Collected> {
    if budget.events == 0 {
        return Ok(Collected::default());
    }
    let mut prepared = sqlite(connection.prepare(statement))?;
    let mut rows =
        sqlite(prepared.query(rusqlite::params![turn_id, boundary, budget.events as i64]))?;
    let mut collected = Collected::default();
    while let Some(row) = sqlite(rows.next())? {
        let seq: i64 = sqlite(row.get(0))?;
        let payload: Vec<u8> = sqlite(row.get(1))?;
        let Some(event) = decode_event(&payload) else {
            collected.unreadable = true;
            continue;
        };
        let next_bytes = collected.bytes.saturating_add(payload.len());
        if next_bytes > budget.bytes && !collected.entries.is_empty() {
            collected.clipped = true;
            break;
        }
        collected.bytes = next_bytes;
        collected.entries.push(AgentTurnLogEntry { seq, event });
    }
    Ok(collected)
}

fn exists(
    connection: &Connection,
    turn_id: &str,
    predicate: &str,
    boundary: i64,
) -> AgentTurnLogResult<bool> {
    let statement =
        format!("SELECT EXISTS(SELECT 1 FROM events WHERE turn_id = ?1 AND {predicate})");
    let found: i64 = sqlite(connection.query_row(
        &statement,
        rusqlite::params![turn_id, boundary],
        |row| row.get(0),
    ))?;
    Ok(found != 0)
}
