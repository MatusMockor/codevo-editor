use crate::debug_adapter::{DebugBreakpoint, DebugEventPayload};
use crate::debug_source_map::SourceMapReceipt;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

pub(crate) const MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SCRIPT: usize = 64;
pub(crate) const MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SESSION: usize = 512;
const MAX_BREAKPOINT_REBIND_TRANSPORTS: usize = 64;
const MAX_BREAKPOINT_REBIND_WORK: usize = 64;
const MAX_PENDING_BREAKPOINT_REBIND_MAPS: usize = 256;
const BREAKPOINT_REBIND_QUIET_PERIOD: Duration = Duration::from_millis(10);

pub(crate) enum BreakpointRebindRequestFailure {
    Rejected(String),
    Uncertain,
}

pub(crate) trait BreakpointRebindCdp: Send + Sync {
    fn request(
        &self,
        method: &str,
        params: Value,
        reserve: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<Value, BreakpointRebindRequestFailure>;
}

#[derive(Clone)]
struct TransportAuthority {
    cdp: Arc<dyn BreakpointRebindCdp>,
    emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync>,
    fail_closed: Arc<dyn Fn() + Send + Sync>,
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    shared: Weak<Mutex<super::CdpShared>>,
    state: Arc<BreakpointRebindState>,
}

#[derive(Default)]
struct BreakpointRebindMutableState {
    attempts_by_script: HashMap<String, usize>,
    pending_ids: HashSet<String>,
    pending_maps: VecDeque<(SourceMapReceipt, String)>,
    scheduled: bool,
    session_attempts: usize,
    sweeps: usize,
}

#[derive(Default)]
struct BreakpointRebindState {
    mutable: Mutex<BreakpointRebindMutableState>,
    registration_generation: AtomicU64,
}

static TRANSPORTS: OnceLock<Mutex<Vec<TransportAuthority>>> = OnceLock::new();
static WORKER: OnceLock<Option<mpsc::SyncSender<TransportAuthority>>> = OnceLock::new();

pub(crate) fn register_transport(
    shared: &Arc<Mutex<super::CdpShared>>,
    cdp: Arc<dyn BreakpointRebindCdp>,
    emit: Arc<dyn Fn(DebugEventPayload) + Send + Sync>,
    is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    fail_closed: Arc<dyn Fn() + Send + Sync>,
) -> bool {
    let Ok(mut transports) = TRANSPORTS.get_or_init(|| Mutex::new(Vec::new())).lock() else {
        return false;
    };
    transports.retain(|transport| transport.shared.strong_count() > 0);
    if transports.len() >= MAX_BREAKPOINT_REBIND_TRANSPORTS {
        return false;
    }
    transports.push(TransportAuthority {
        cdp,
        emit,
        fail_closed,
        is_current,
        shared: Arc::downgrade(shared),
        state: Arc::new(BreakpointRebindState::default()),
    });
    true
}

pub(crate) fn begin_registration_mutation(shared: &Arc<Mutex<super::CdpShared>>) -> Option<u64> {
    let transport = transport_for(shared)?;
    transport
        .state
        .registration_generation
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
            if !generation.is_multiple_of(2) {
                return None;
            }
            generation.checked_add(1)
        })
        .ok()
        .and_then(|generation| generation.checked_add(1))
}

pub(crate) fn finish_registration_mutation(
    shared: &Arc<Mutex<super::CdpShared>>,
    in_flight_generation: u64,
) -> Option<u64> {
    if in_flight_generation.is_multiple_of(2) {
        return None;
    }
    let committed_generation = in_flight_generation.checked_add(1)?;
    let transport = transport_for(shared)?;
    transport
        .state
        .registration_generation
        .compare_exchange(
            in_flight_generation,
            committed_generation,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .ok()
        .map(|_| committed_generation)
}

pub(crate) fn enqueue(
    shared: &Arc<Mutex<super::CdpShared>>,
    receipt: SourceMapReceipt,
    script_id: String,
) -> bool {
    let Some(transport) = transport_for(shared) else {
        return false;
    };
    let Ok(mut state) = transport.state.mutable.lock() else {
        (transport.fail_closed)();
        return false;
    };
    if state.pending_ids.contains(&script_id) {
        if let Some(pending) = state
            .pending_maps
            .iter_mut()
            .find(|pending| pending.1 == script_id)
        {
            pending.0 = receipt;
        }
    } else {
        if state.pending_maps.len() >= MAX_PENDING_BREAKPOINT_REBIND_MAPS {
            drop(state);
            (transport.fail_closed)();
            return false;
        }
        state.pending_ids.insert(script_id.clone());
        state.pending_maps.push_back((receipt, script_id));
    }
    if state.scheduled {
        return false;
    }
    state.scheduled = true;
    true
}

pub(crate) fn schedule(shared: &Arc<Mutex<super::CdpShared>>) {
    let transport = transport_for(shared);
    let Some(transport) = transport else {
        return;
    };
    let Some(worker) = worker() else {
        (transport.fail_closed)();
        return;
    };
    match worker.try_send(transport) {
        Ok(()) => {}
        Err(mpsc::TrySendError::Full(transport)) => (transport.fail_closed)(),
        Err(mpsc::TrySendError::Disconnected(transport)) => (transport.fail_closed)(),
    }
}

fn transport_for(shared: &Arc<Mutex<super::CdpShared>>) -> Option<TransportAuthority> {
    TRANSPORTS
        .get()
        .and_then(|transports| transports.lock().ok())
        .and_then(|transports| {
            transports.iter().find_map(|transport| {
                transport
                    .shared
                    .upgrade()
                    .filter(|candidate| Arc::ptr_eq(candidate, shared))
                    .map(|_| transport.clone())
            })
        })
}

fn worker() -> Option<&'static mpsc::SyncSender<TransportAuthority>> {
    WORKER
        .get_or_init(|| {
            let (sender, receiver) = mpsc::sync_channel(MAX_BREAKPOINT_REBIND_WORK);
            std::thread::Builder::new()
                .name("debug-breakpoint-rebind-worker".to_string())
                .spawn(move || run_worker(receiver))
                .ok()
                .map(|_| sender)
        })
        .as_ref()
}

fn run_worker(receiver: mpsc::Receiver<TransportAuthority>) {
    while let Ok(first) = receiver.recv() {
        let mut batch = vec![first];
        loop {
            match receiver.recv_timeout(BREAKPOINT_REBIND_QUIET_PERIOD) {
                Ok(transport) if batch.len() < MAX_BREAKPOINT_REBIND_WORK => batch.push(transport),
                Ok(transport) => (transport.fail_closed)(),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let mut seen = HashSet::new();
        for transport in batch {
            let Some(shared) = transport.shared.upgrade() else {
                continue;
            };
            let identity = Arc::as_ptr(&shared) as usize;
            if !seen.insert(identity) {
                continue;
            }
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                process_transport(&transport, &shared);
            }))
            .is_err()
            {
                (transport.fail_closed)();
            }
        }
    }
}

struct PendingBreakpoint {
    breakpoint: DebugBreakpoint,
    canonical_path: PathBuf,
    file_path: String,
    old_cdp_id: Option<String>,
}

struct PendingBreakpointSnapshot {
    breakpoint: DebugBreakpoint,
    file_path: String,
    old: Option<(String, PathBuf)>,
}

struct RebindCandidate {
    breakpoint: DebugBreakpoint,
    file_path: String,
    map_receipt: SourceMapReceipt,
    mapped_column: u32,
    mapped_line: u32,
    mapped_url: String,
    old_cdp_id: Option<String>,
    revision: u64,
    source_path: String,
}

fn process_transport(transport: &TransportAuthority, shared: &Arc<Mutex<super::CdpShared>>) {
    if !(transport.is_current)() {
        (transport.fail_closed)();
        return;
    }
    let receipts = {
        let Ok(mut state) = transport.state.mutable.lock() else {
            (transport.fail_closed)();
            return;
        };
        state.scheduled = false;
        let receipts = state.pending_maps.drain(..).collect::<Vec<_>>();
        state.pending_ids.clear();
        if !receipts.is_empty() {
            state.sweeps = state.sweeps.saturating_add(1);
        }
        receipts
    };
    for (receipt, script_id) in receipts {
        if !process_receipt(transport, shared, receipt, &script_id) {
            return;
        }
    }
}

fn process_receipt(
    transport: &TransportAuthority,
    shared: &Arc<Mutex<super::CdpShared>>,
    receipt: SourceMapReceipt,
    script_id: &str,
) -> bool {
    let Some((revision, pending)) = snapshot_pending(transport, shared, &receipt, script_id) else {
        (transport.fail_closed)();
        return false;
    };
    for pending_breakpoint in pending {
        if !(transport.is_current)() {
            (transport.fail_closed)();
            return false;
        }
        let candidate = {
            let Ok(state) = shared.lock() else {
                (transport.fail_closed)();
                return false;
            };
            let Some(source_maps) = state.source_maps.as_ref() else {
                return true;
            };
            if !registration_is_current(transport, revision) {
                return true;
            }
            match pending_breakpoint.breakpoint.column_number {
                Some(column) => source_maps.map_original_position_candidate(
                    &pending_breakpoint.canonical_path,
                    pending_breakpoint.breakpoint.line_number,
                    column,
                ),
                None => source_maps.map_original_line_candidate(
                    &pending_breakpoint.canonical_path,
                    pending_breakpoint.breakpoint.line_number,
                ),
            }
        };
        let Some(validated) = candidate.and_then(|candidate| candidate.validate_with_receipt())
        else {
            continue;
        };
        if validated.receipt.generation() != receipt.generation() {
            continue;
        }
        let reserved = {
            let Ok(state) = shared.lock() else {
                (transport.fail_closed)();
                return false;
            };
            if !registration_is_current(transport, revision)
                || !locked_authority_is_current(
                    transport,
                    revision,
                    &state,
                    &receipt,
                    &pending_breakpoint.file_path,
                    &pending_breakpoint.breakpoint.id,
                )
            {
                false
            } else {
                reserve_attempt(transport, script_id)
            }
        };
        if !reserved {
            continue;
        }
        let candidate = RebindCandidate {
            breakpoint: pending_breakpoint.breakpoint,
            file_path: pending_breakpoint.file_path,
            map_receipt: validated.receipt,
            mapped_column: validated.location.column,
            mapped_line: validated.location.line_number,
            mapped_url: validated.location.url,
            old_cdp_id: pending_breakpoint.old_cdp_id,
            revision,
            source_path: pending_breakpoint
                .canonical_path
                .to_string_lossy()
                .into_owned(),
        };
        if !install_candidate(transport, shared, candidate) {
            return false;
        }
    }
    true
}

fn snapshot_pending(
    transport: &TransportAuthority,
    shared: &Arc<Mutex<super::CdpShared>>,
    receipt: &SourceMapReceipt,
    script_id: &str,
) -> Option<(u64, Vec<PendingBreakpoint>)> {
    let state = shared.lock().ok()?;
    let source_maps = state.source_maps.as_ref()?;
    let revision = transport
        .state
        .registration_generation
        .load(Ordering::Acquire);
    if !revision.is_multiple_of(2) {
        return Some((revision, Vec::new()));
    }
    if !source_maps.is_current_receipt(receipt) {
        return Some((revision, Vec::new()));
    }
    if remaining_attempts(transport, script_id)? == 0 {
        return Some((revision, Vec::new()));
    }
    let mut snapshot = state
        .breakpoints_by_file
        .iter()
        .flat_map(|(file_path, breakpoints)| {
            breakpoints
                .iter()
                .filter(|breakpoint| breakpoint.enabled && !breakpoint.verified)
                .map(move |breakpoint| (file_path, breakpoint))
        })
        .take(super::MAX_PENDING_BREAKPOINT_RESOLUTIONS)
        .map(|(file_path, breakpoint)| PendingBreakpointSnapshot {
            breakpoint: breakpoint.clone(),
            file_path: file_path.clone(),
            old: None,
        })
        .collect::<Vec<_>>();
    let pending_keys = snapshot
        .iter()
        .map(|pending| (pending.file_path.as_str(), pending.breakpoint.id.as_str()))
        .collect::<HashSet<_>>();
    let mut reverse_resolution_index = HashMap::with_capacity(pending_keys.len());
    for (cdp_id, target) in &state.resolution_index {
        if !pending_keys.contains(&(target.file_path.as_str(), target.breakpoint_id.as_str())) {
            continue;
        }
        let key = (target.file_path.clone(), target.breakpoint_id.clone());
        let candidate = (cdp_id.clone(), PathBuf::from(&target.source_path));
        reverse_resolution_index
            .entry(key)
            .and_modify(|existing: &mut (String, PathBuf)| {
                if candidate.0 < existing.0 {
                    *existing = candidate.clone();
                }
            })
            .or_insert(candidate);
    }
    for pending in &mut snapshot {
        pending.old = reverse_resolution_index
            .remove(&(pending.file_path.clone(), pending.breakpoint.id.clone()));
    }
    drop(state);
    let pending = snapshot
        .into_iter()
        .filter_map(|snapshot| {
            let (old_cdp_id, canonical_path) = match snapshot.old {
                Some((cdp_id, path)) => (Some(cdp_id), path),
                None => (None, fs::canonicalize(&snapshot.file_path).ok()?),
            };
            Some(PendingBreakpoint {
                breakpoint: snapshot.breakpoint,
                canonical_path,
                file_path: snapshot.file_path,
                old_cdp_id,
            })
        })
        .collect();
    Some((revision, pending))
}

fn install_candidate(
    transport: &TransportAuthority,
    shared: &Arc<Mutex<super::CdpShared>>,
    candidate: RebindCandidate,
) -> bool {
    let current = || authority_is_current(transport, shared, &candidate);
    let mut params = json!({
        "url": candidate.mapped_url,
        "lineNumber": candidate.mapped_line.saturating_sub(1),
        "columnNumber": candidate.mapped_column.saturating_sub(1),
    });
    if let Some(condition) = candidate.breakpoint.condition.as_ref() {
        params["condition"] = json!(condition);
    }
    let result = match transport
        .cdp
        .request("Debugger.setBreakpointByUrl", params, &current)
    {
        Ok(result) => result,
        Err(BreakpointRebindRequestFailure::Rejected(_)) => return true,
        Err(BreakpointRebindRequestFailure::Uncertain) => {
            (transport.fail_closed)();
            return false;
        }
    };
    let Some(cdp_id) = result
        .get("breakpointId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return true;
    };
    if !current() {
        if !(transport.is_current)() {
            (transport.fail_closed)();
            return false;
        }
        return remove_stale_install(transport, &cdp_id);
    }
    if let Some(old_cdp_id) = candidate.old_cdp_id.as_ref() {
        match transport.cdp.request(
            "Debugger.removeBreakpoint",
            json!({"breakpointId": old_cdp_id}),
            &current,
        ) {
            Ok(_) => {}
            Err(BreakpointRebindRequestFailure::Rejected(message)) => {
                if !current() {
                    return remove_stale_install(transport, &cdp_id);
                }
                if !breakpoint_removal_was_not_found(&message) {
                    return remove_stale_install(transport, &cdp_id);
                }
            }
            Err(BreakpointRebindRequestFailure::Uncertain) => {
                (transport.fail_closed)();
                return false;
            }
        }
        if !current() {
            if !(transport.is_current)() {
                (transport.fail_closed)();
                return false;
            }
            return remove_stale_install(transport, &cdp_id);
        }
    }
    let response_position = result
        .pointer("/locations/0/lineNumber")
        .and_then(Value::as_u64)
        .and_then(|line| u32::try_from(line).ok())
        .and_then(|line| {
            let column = result
                .pointer("/locations/0/columnNumber")
                .and_then(Value::as_u64)
                .map_or(Some(0), |column| u32::try_from(column).ok())?;
            Some(super::GeneratedPosition {
                line,
                column,
                script_identity: super::generated_script_identity(
                    result.pointer("/locations/0/scriptId"),
                ),
            })
        });
    let publication = {
        let Ok(mut state) = shared.lock() else {
            let _ = remove_stale_install(transport, &cdp_id);
            (transport.fail_closed)();
            return false;
        };
        if !(transport.is_current)()
            || !registration_is_current(transport, candidate.revision)
            || !locked_authority_is_current(
                transport,
                candidate.revision,
                &state,
                &candidate.map_receipt,
                &candidate.file_path,
                &candidate.breakpoint.id,
            )
        {
            drop(state);
            return remove_stale_install(transport, &cdp_id);
        }
        remove_old_registration(&mut state, candidate.old_cdp_id.as_deref());
        state
            .cdp_ids_by_file
            .entry(candidate.file_path.clone())
            .or_default()
            .push(cdp_id.clone());
        state
            .breakpoint_hits
            .register(cdp_id.clone(), &candidate.breakpoint);
        state.resolution_index.insert(
            cdp_id.clone(),
            super::BreakpointResolutionTarget {
                breakpoint_id: candidate.breakpoint.id.clone(),
                column_number: candidate.breakpoint.column_number,
                file_path: candidate.file_path.clone(),
                generated_url: candidate.mapped_url.clone(),
                source_path: candidate.source_path.clone(),
            },
        );
        let position = response_position.or_else(|| state.pending_resolutions.remove(&cdp_id));
        position
            .and_then(|position| super::apply_breakpoint_resolution(&mut state, &cdp_id, position))
    };
    if let Some((file_path, breakpoints)) = publication {
        if !publication_is_current(transport, shared, &candidate, &cdp_id) {
            if !(transport.is_current)() {
                (transport.fail_closed)();
                return false;
            }
            return true;
        }
        (transport.emit)(DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints,
        });
    }
    true
}

fn publication_is_current(
    transport: &TransportAuthority,
    shared: &Arc<Mutex<super::CdpShared>>,
    candidate: &RebindCandidate,
    cdp_id: &str,
) -> bool {
    if !(transport.is_current)() {
        return false;
    }
    if !registration_is_current(transport, candidate.revision) {
        return false;
    }
    shared.lock().ok().is_some_and(|state| {
        state
            .source_maps
            .as_ref()
            .is_some_and(|source_maps| source_maps.is_current_receipt(&candidate.map_receipt))
            && state
                .breakpoints_by_file
                .get(&candidate.file_path)
                .is_some_and(|breakpoints| {
                    breakpoints.iter().any(|breakpoint| {
                        breakpoint.id == candidate.breakpoint.id && breakpoint.verified
                    })
                })
            && state
                .cdp_ids_by_file
                .get(&candidate.file_path)
                .is_some_and(|ids| ids.iter().any(|id| id == cdp_id))
    })
}

fn authority_is_current(
    transport: &TransportAuthority,
    shared: &Arc<Mutex<super::CdpShared>>,
    candidate: &RebindCandidate,
) -> bool {
    if !(transport.is_current)() {
        return false;
    }
    if !registration_is_current(transport, candidate.revision) {
        return false;
    }
    shared.lock().ok().is_some_and(|state| {
        locked_authority_is_current(
            transport,
            candidate.revision,
            &state,
            &candidate.map_receipt,
            &candidate.file_path,
            &candidate.breakpoint.id,
        )
    })
}

fn locked_authority_is_current(
    transport: &TransportAuthority,
    revision: u64,
    state: &super::CdpShared,
    receipt: &SourceMapReceipt,
    file_path: &str,
    breakpoint_id: &str,
) -> bool {
    registration_is_current(transport, revision)
        && state
            .source_maps
            .as_ref()
            .is_some_and(|source_maps| source_maps.is_current_receipt(receipt))
        && state
            .breakpoints_by_file
            .get(file_path)
            .is_some_and(|breakpoints| {
                breakpoints
                    .iter()
                    .any(|breakpoint| breakpoint.id == breakpoint_id && !breakpoint.verified)
            })
}

fn registration_is_current(transport: &TransportAuthority, revision: u64) -> bool {
    revision.is_multiple_of(2)
        && transport
            .state
            .registration_generation
            .load(Ordering::Acquire)
            == revision
}

fn breakpoint_removal_was_not_found(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("breakpoint not found")
        || normalized.contains("could not find breakpoint")
        || normalized.contains("no breakpoint with")
}

fn remaining_attempts(transport: &TransportAuthority, script_id: &str) -> Option<usize> {
    let state = transport.state.mutable.lock().ok()?;
    let session = MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SESSION.saturating_sub(state.session_attempts);
    let script = MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SCRIPT.saturating_sub(
        state
            .attempts_by_script
            .get(script_id)
            .copied()
            .unwrap_or(0),
    );
    Some(session.min(script))
}

fn reserve_attempt(transport: &TransportAuthority, script_id: &str) -> bool {
    let Ok(mut state) = transport.state.mutable.lock() else {
        (transport.fail_closed)();
        return false;
    };
    if state.session_attempts >= MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SESSION {
        return false;
    }
    let attempts = state
        .attempts_by_script
        .entry(script_id.to_string())
        .or_default();
    if *attempts >= MAX_BREAKPOINT_REBIND_ATTEMPTS_PER_SCRIPT {
        return false;
    }
    *attempts = attempts.saturating_add(1);
    state.session_attempts = state.session_attempts.saturating_add(1);
    true
}

#[cfg(test)]
pub(crate) fn counters_for_test(
    shared: &Arc<Mutex<super::CdpShared>>,
) -> Option<(usize, usize, u64)> {
    let transport = transport_for(shared)?;
    let state = transport.state.mutable.lock().ok()?;
    Some((
        state.sweeps,
        state.session_attempts,
        transport
            .state
            .registration_generation
            .load(Ordering::Acquire),
    ))
}

fn remove_old_registration(state: &mut super::CdpShared, old_cdp_id: Option<&str>) {
    let Some(old_cdp_id) = old_cdp_id else {
        return;
    };
    state.resolution_index.remove(old_cdp_id);
    state.pending_resolutions.remove(old_cdp_id);
    state.breakpoint_hits.remove(old_cdp_id);
    for ids in state.cdp_ids_by_file.values_mut() {
        ids.retain(|id| id != old_cdp_id);
    }
}

fn remove_stale_install(transport: &TransportAuthority, cdp_id: &str) -> bool {
    if !(transport.is_current)() {
        (transport.fail_closed)();
        return false;
    }
    match transport.cdp.request(
        "Debugger.removeBreakpoint",
        json!({"breakpointId": cdp_id}),
        transport.is_current.as_ref(),
    ) {
        Ok(_) => true,
        Err(BreakpointRebindRequestFailure::Rejected(message)) => {
            if breakpoint_removal_was_not_found(&message) {
                return true;
            }
            (transport.fail_closed)();
            false
        }
        Err(BreakpointRebindRequestFailure::Uncertain) => {
            (transport.fail_closed)();
            false
        }
    }
}

#[cfg(test)]
#[path = "debug_cdp/tests/debug_cdp_breakpoint_rebind_tests.rs"]
mod tests;
