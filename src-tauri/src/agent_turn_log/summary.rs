use super::errors::AgentTurnLogResult;
use super::schema::{read_all_turn_meta, TurnMetaRow};
use super::wire::{AgentTurnLogSummary, MAX_SUMMARY_PROMPT_RESPONSE_BYTES, MAX_TURN_SUMMARIES};
use rusqlite::Connection;

pub(crate) fn summarize(
    connection: &Connection,
    include_prompts: bool,
) -> AgentTurnLogResult<Vec<AgentTurnLogSummary>> {
    let rows = read_all_turn_meta(connection, MAX_TURN_SUMMARIES)?;
    let carried = carried_flags(&rows, include_prompts);
    Ok(rows
        .into_iter()
        .zip(carried)
        .map(|(row, carried)| summary_of(row, carried))
        .collect())
}

fn carried_flags(rows: &[TurnMetaRow], include_prompts: bool) -> Vec<bool> {
    let mut carried = vec![false; rows.len()];
    if !include_prompts {
        return carried;
    }
    let mut remaining = MAX_SUMMARY_PROMPT_RESPONSE_BYTES;
    for (index, row) in rows.iter().enumerate().rev() {
        let Some(prompt) = row.prompt.as_ref() else {
            continue;
        };
        if prompt.len() > remaining {
            break;
        }
        remaining -= prompt.len();
        carried[index] = true;
    }
    carried
}

fn summary_of(mut row: TurnMetaRow, carried: bool) -> AgentTurnLogSummary {
    let prompt = row.prompt.take();
    let stored = prompt.is_some();
    AgentTurnLogSummary {
        turn_id: row.turn_id,
        event_count: row.event_count,
        bytes: row.bytes,
        loss: row.loss,
        sealed: row.sealed,
        digest: row.digest,
        prompt: match carried {
            true => prompt,
            false => None,
        },
        prompt_omitted: stored && !carried,
    }
}
