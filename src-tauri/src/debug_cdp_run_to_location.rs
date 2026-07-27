use super::transport::{CdpClient, CdpShared};
use super::*;

pub(super) enum RunToLocationFailure {
    Message(String),
    Cleanup,
}

impl From<String> for RunToLocationFailure {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

pub(super) fn run_to_location(
    client: &CdpClient,
    shared: &Arc<Mutex<CdpShared>>,
    mutation_is_allowed: &(dyn Fn() -> bool + Send + Sync),
    pause_generation: u64,
    file_path: &str,
    line_number: u32,
    column_number: u32,
) -> Result<(), RunToLocationFailure> {
    ensure_startup_current(mutation_is_allowed)?;
    ensure_pause_owner(shared, pause_generation, "is stale")?;
    let canonical_file = fs::canonicalize(file_path)
        .map_err(|error| format!("Unable to resolve run-to-location source: {error}"))?;
    let mapped_candidate = shared.lock().ok().and_then(|shared| {
        shared.source_maps.as_ref().and_then(|source_maps| {
            source_maps.map_original_position_candidate(&canonical_file, line_number, column_number)
        })
    });
    let mapped = mapped_candidate
        .and_then(|candidate| candidate.validate_with_receipt())
        .and_then(|validated| {
            shared
                .lock()
                .ok()
                .and_then(|shared| {
                    shared
                        .source_maps
                        .as_ref()
                        .map(|source_maps| source_maps.is_current_receipt(&validated.receipt))
                })
                .unwrap_or(false)
                .then_some(validated.location)
        });
    ensure_startup_current(mutation_is_allowed)?;
    ensure_pause_owner(shared, pause_generation, "is stale")?;
    let url = mapped
        .as_ref()
        .map(|location| location.url.clone())
        .unwrap_or_else(|| file_url_from_path(&canonical_file.to_string_lossy()));
    let target_line = mapped
        .as_ref()
        .map(|location| location.line_number)
        .unwrap_or(line_number);
    let target_column = mapped
        .as_ref()
        .map(|location| location.column)
        .unwrap_or(column_number);
    let set_result = client.request(
        "Debugger.setBreakpointByUrl",
        json!({
            "url": url,
            "lineNumber": target_line.saturating_sub(1),
            "columnNumber": target_column.saturating_sub(1),
        }),
    )?;
    let temporary_id = set_result
        .get("breakpointId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let location = first_resolved_location(&set_result);

    // breakpointResolved may race the response. Clear only this ephemeral id;
    // it must never become part of persistent breakpoint bookkeeping.
    if let Some(temporary_id) = temporary_id.as_deref() {
        clear_pending_resolution(shared, temporary_id);
        let remove = || {
            client.request(
                "Debugger.removeBreakpoint",
                json!({ "breakpointId": temporary_id }),
            )
        };
        let removal = remove().or_else(|_| remove());
        clear_pending_resolution(shared, temporary_id);
        if removal.is_err() {
            return Err(RunToLocationFailure::Cleanup);
        }
    }

    let location = location.ok_or_else(|| {
        RunToLocationFailure::Message(
            "The requested source location is not loaded or could not be resolved.".to_string(),
        )
    })?;
    if temporary_id.is_none() {
        return Err(RunToLocationFailure::Message(
            "The debugger did not return a temporary breakpoint id.".to_string(),
        ));
    }
    ensure_pause_owner(
        shared,
        pause_generation,
        "changed while resolving the location",
    )?;
    ensure_startup_current(mutation_is_allowed)?;
    client.request(
        "Debugger.continueToLocation",
        json!({ "location": location, "targetCallFrames": "any" }),
    )?;
    Ok(())
}

fn first_resolved_location(result: &Value) -> Option<Value> {
    let location = result.get("locations")?.as_array()?.first()?;
    let script_id = location.get("scriptId")?.as_str()?;
    let line_number = location.get("lineNumber")?.as_u64()?;
    let column_number = location
        .get("columnNumber")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some(json!({
        "scriptId": script_id,
        "lineNumber": line_number,
        "columnNumber": column_number,
    }))
}

fn clear_pending_resolution(shared: &Arc<Mutex<CdpShared>>, temporary_id: &str) {
    if let Ok(mut shared) = shared.lock() {
        shared.pending_resolutions.remove(temporary_id);
    }
}

fn ensure_pause_owner(
    shared: &Arc<Mutex<CdpShared>>,
    pause_generation: u64,
    stale_reason: &str,
) -> Result<(), RunToLocationFailure> {
    let current = shared
        .lock()
        .map_err(|error| error.to_string())?
        .pause
        .as_ref()
        .map(|pause| pause.pause_generation);
    if current == Some(pause_generation) {
        Ok(())
    } else {
        Err(RunToLocationFailure::Message(format!(
            "The debugger pause generation {stale_reason}."
        )))
    }
}
