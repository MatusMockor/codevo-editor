use super::errors::AgentTurnLogResult;
use super::schema::{read_all_turn_meta, read_turn_meta, TurnMetaRow};
use super::wire::{
    lifecycle_bytes, AgentTurnLogSummary, MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES,
    MAX_SUMMARY_PROMPT_RESPONSE_BYTES, MAX_TURN_SUMMARIES,
};
use rusqlite::Connection;

#[derive(Clone, Copy)]
struct Carried {
    prompt: bool,
    lifecycle: bool,
}

pub(crate) fn summarize(
    connection: &Connection,
    turn_id: Option<&str>,
    include_prompts: bool,
    include_lifecycles: bool,
) -> AgentTurnLogResult<Vec<AgentTurnLogSummary>> {
    let rows = match turn_id {
        Some(turn_id) => read_turn_meta(connection, turn_id)?.into_iter().collect(),
        None => read_all_turn_meta(connection, MAX_TURN_SUMMARIES)?,
    };
    let prompts = carried_flags(
        &sizes(&rows, |row| row.prompt.as_ref().map(String::len)),
        include_prompts,
        MAX_SUMMARY_PROMPT_RESPONSE_BYTES,
    );
    let lifecycles = carried_flags(
        &sizes(&rows, |row| row.lifecycle.as_ref().map(lifecycle_bytes)),
        include_lifecycles,
        MAX_SUMMARY_LIFECYCLE_RESPONSE_BYTES,
    );
    Ok(rows
        .into_iter()
        .zip(prompts)
        .zip(lifecycles)
        .map(|((row, prompt), lifecycle)| summary_of(row, Carried { prompt, lifecycle }))
        .collect())
}

fn sizes(
    rows: &[TurnMetaRow],
    measure: impl Fn(&TurnMetaRow) -> Option<usize>,
) -> Vec<Option<usize>> {
    rows.iter().map(measure).collect()
}

fn carried_flags(sizes: &[Option<usize>], include: bool, budget: usize) -> Vec<bool> {
    let mut carried = vec![false; sizes.len()];
    if !include {
        return carried;
    }
    let mut remaining = budget;
    for (index, size) in sizes.iter().enumerate().rev() {
        let Some(size) = size else {
            continue;
        };
        if *size > remaining {
            break;
        }
        remaining -= size;
        carried[index] = true;
    }
    carried
}

fn summary_of(mut row: TurnMetaRow, carried: Carried) -> AgentTurnLogSummary {
    let prompt = row.prompt.take();
    let lifecycle = row.lifecycle.take();
    let stored_prompt = prompt.is_some();
    let stored_lifecycle = lifecycle.is_some();
    AgentTurnLogSummary {
        turn_id: row.turn_id,
        event_count: row.event_count,
        bytes: row.bytes,
        loss: row.loss,
        sealed: row.sealed,
        digest: row.digest,
        prompt: match carried.prompt {
            true => prompt,
            false => None,
        },
        prompt_omitted: stored_prompt && !carried.prompt,
        lifecycle: match carried.lifecycle {
            true => lifecycle,
            false => None,
        },
        lifecycle_omitted: stored_lifecycle && !carried.lifecycle,
    }
}
