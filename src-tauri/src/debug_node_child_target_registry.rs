#![allow(dead_code)] // Private multi-process foundation; no IPC/UI/config exposure.

use std::{
    any::Any,
    collections::{BTreeMap, BTreeSet},
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicU64, Ordering},
        Condvar, Mutex, MutexGuard,
    },
    thread::ThreadId,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_CHILD_TARGETS: usize = 32;
const MAX_ANCESTRY_DEPTH: usize = 32;
const MAX_FRAMES_PER_PAUSE: usize = 256;
const MAX_VARIABLES_PER_PAUSE: usize = 4_096;
const MAX_TARGET_ID_BYTES: usize = 256;
const MAX_BACKEND_ID_BYTES: usize = 4_096;
static NEXT_REGISTRY_INCARNATION: AtomicU64 = AtomicU64::new(1);

/// Trusted discovery implementations must construct a complete root-to-child process chain from
/// one kernel snapshot. The registry still validates every edge and process-group claim before it
/// publishes any target.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct ChildProcessIdentity {
    pid: u32,
    parent_pid: u32,
    process_group_id: u32,
    start_token: u64,
}

impl ChildProcessIdentity {
    pub(crate) fn new(
        pid: u32,
        parent_pid: u32,
        process_group_id: u32,
        start_token: u64,
    ) -> Result<Self, String> {
        if pid == 0 || process_group_id == 0 || start_token == 0 || start_token > MAX_SAFE_INTEGER {
            return Err("Invalid child process identity.".to_string());
        }
        Ok(Self {
            pid,
            parent_pid,
            process_group_id,
            start_token,
        })
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct ChildInspectorEndpoint {
    host: LoopbackInspectorHost,
    port: u16,
    target_id: Box<str>,
}

impl ChildInspectorEndpoint {
    pub(crate) fn new(
        host: LoopbackInspectorHost,
        port: u16,
        target_id: impl Into<Box<str>>,
    ) -> Result<Self, String> {
        let target_id = target_id.into();
        if port == 0
            || target_id.is_empty()
            || target_id.len() > MAX_TARGET_ID_BYTES
            || !target_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("Invalid child inspector endpoint.".to_string());
        }
        Ok(Self {
            host,
            port,
            target_id,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum LoopbackInspectorHost {
    Ipv4,
    Ipv6,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedChildInspectorObservation {
    ancestry: Vec<ChildProcessIdentity>,
    endpoint: ChildInspectorEndpoint,
}

impl VerifiedChildInspectorObservation {
    pub(crate) fn new(
        ancestry: Vec<ChildProcessIdentity>,
        endpoint: ChildInspectorEndpoint,
    ) -> Result<Self, String> {
        if ancestry.len() < 2 || ancestry.len() > MAX_ANCESTRY_DEPTH {
            return Err("Child inspector ancestry is incomplete or too deep.".to_string());
        }
        Ok(Self { ancestry, endpoint })
    }

    fn process(&self) -> &ChildProcessIdentity {
        self.ancestry
            .last()
            .expect("validated child inspector ancestry")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OwnedNodeProcessGroup {
    logical_session_id: u64,
    process_group_id: u32,
    registry_incarnation: u64,
    root_pid: u32,
    root_start_token: u64,
}

impl OwnedNodeProcessGroup {
    pub(crate) fn process_group_id(self) -> u32 {
        self.process_group_id
    }

    pub(crate) fn root_pid(self) -> u32 {
        self.root_pid
    }
}

/// Strategy boundary. Implementations own the launched root waiter and must not return until the
/// complete process group has been signalled and the root child has been reaped.
pub(crate) trait OwnedNodeProcessGroupReaper: Send {
    fn stop_and_reap(&mut self, group: OwnedNodeProcessGroup) -> Result<(), String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildTargetAuthority {
    logical_session_id: u64,
    process_start_token: u64,
    registry_incarnation: u64,
    target_generation: u64,
    target_pid: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildPauseAuthority {
    pause_epoch: u64,
    target: ChildTargetAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildFrameAuthority {
    frame_slot: u64,
    pause: ChildPauseAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildVariableAuthority {
    frame: ChildFrameAuthority,
    variable_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildFrameRoute {
    pub(crate) backend_frame_id: Box<str>,
    pub(crate) endpoint: ChildInspectorEndpoint,
    pub(crate) target: ChildTargetAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildTargetRoute {
    pub(crate) endpoint: ChildInspectorEndpoint,
    pub(crate) target: ChildTargetAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildInspectionRoute {
    pub(crate) backend_frame_id: Box<str>,
    pub(crate) backend_variable_reference: u64,
    pub(crate) endpoint: ChildInspectorEndpoint,
    pub(crate) target: ChildTargetAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TargetFingerprint {
    endpoint: ChildInspectorEndpoint,
    process: ChildProcessIdentity,
}

struct FrameRecord {
    backend_frame_id: Box<str>,
}

struct VariableRecord {
    backend_reference: u64,
    frame_slot: u64,
}

struct PauseRecord {
    epoch: u64,
    frames: BTreeMap<u64, FrameRecord>,
    frame_slots_by_backend_id: BTreeMap<Box<str>, u64>,
    variables: BTreeMap<u64, VariableRecord>,
}

struct TargetRecord {
    fingerprint: TargetFingerprint,
    generation: u64,
    pause: Option<PauseRecord>,
}

struct RegistryState<Reaper> {
    discovery_epoch: u64,
    group: OwnedNodeProcessGroup,
    next_frame_slot: u64,
    next_pause_epoch: u64,
    next_target_generation: u64,
    next_variable_slot: u64,
    reaper: Option<Reaper>,
    stop: RegistryStopState,
    targets: BTreeMap<(u32, u64), TargetRecord>,
}

enum RegistryStopState {
    Running,
    Stopping { owner: ThreadId },
    Stopped(Result<(), String>),
}

/// One registry represents one logical owned launch. Reconciliation, pause publication and stop
/// share one mutex, so a stale discovery or inspection capability cannot interleave with teardown.
pub(crate) struct NodeChildTargetRegistry<Reaper> {
    state: Mutex<RegistryState<Reaper>>,
    stop_finished: Condvar,
}

impl<Reaper: OwnedNodeProcessGroupReaper> NodeChildTargetRegistry<Reaper> {
    pub(crate) fn new(
        logical_session_id: u64,
        process_group_id: u32,
        root_pid: u32,
        root_start_token: u64,
        reaper: Reaper,
    ) -> Result<Self, String> {
        if logical_session_id == 0
            || logical_session_id > MAX_SAFE_INTEGER
            || process_group_id == 0
            || root_pid == 0
            || root_pid != process_group_id
            || root_start_token == 0
            || root_start_token > MAX_SAFE_INTEGER
        {
            return Err("Invalid owned Node process-group identity.".to_string());
        }
        let registry_incarnation = NEXT_REGISTRY_INCARNATION
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, next_counter_state)
            .map_err(|_| {
                "Owned Node child-target registry incarnation is exhausted.".to_string()
            })?;
        Ok(Self {
            state: Mutex::new(RegistryState {
                discovery_epoch: 0,
                group: OwnedNodeProcessGroup {
                    logical_session_id,
                    process_group_id,
                    registry_incarnation,
                    root_pid,
                    root_start_token,
                },
                next_frame_slot: 1,
                next_pause_epoch: 1,
                next_target_generation: 1,
                next_variable_slot: 1,
                reaper: Some(reaper),
                stop: RegistryStopState::Running,
                targets: BTreeMap::new(),
            }),
            stop_finished: Condvar::new(),
        })
    }

    /// Atomically replaces the complete authoritative child-target inventory.
    pub(crate) fn reconcile(
        &self,
        discovery_epoch: u64,
        observations: Vec<VerifiedChildInspectorObservation>,
    ) -> Result<Vec<ChildTargetAuthority>, String> {
        let mut state = self.lock()?;
        if !matches!(&state.stop, RegistryStopState::Running) {
            return Err("Owned Node child-target registry is stopped.".to_string());
        }
        if discovery_epoch == 0
            || discovery_epoch > MAX_SAFE_INTEGER
            || discovery_epoch <= state.discovery_epoch
            || observations.len() > MAX_CHILD_TARGETS
        {
            return Err("Stale or oversized child inspector inventory.".to_string());
        }

        let fingerprints = validate_inventory(state.group, observations)?;
        let replacements = fingerprints
            .iter()
            .filter(|(key, fingerprint)| {
                state
                    .targets
                    .get(key)
                    .is_none_or(|target| target.fingerprint != **fingerprint)
            })
            .count() as u64;
        if replacements > 0
            && state
                .next_target_generation
                .checked_add(replacements - 1)
                .is_none_or(|last| last > MAX_SAFE_INTEGER)
        {
            return Err("Child target generation is exhausted.".to_string());
        }

        let mut next_targets = BTreeMap::new();
        for (key, fingerprint) in fingerprints {
            let record = match state.targets.remove(&key) {
                Some(record) if record.fingerprint == fingerprint => record,
                _ => {
                    let generation = take_counter(&mut state.next_target_generation)?;
                    TargetRecord {
                        fingerprint,
                        generation,
                        pause: None,
                    }
                }
            };
            next_targets.insert(key, record);
        }
        state.targets = next_targets;
        state.discovery_epoch = discovery_epoch;
        Ok(state
            .targets
            .values()
            .map(|target| authority(state.group, target))
            .collect())
    }

    pub(crate) fn begin_pause(
        &self,
        target: &ChildTargetAuthority,
    ) -> Result<ChildPauseAuthority, String> {
        let mut state = self.lock()?;
        let key = target_key(target);
        ensure_target(&state, target)?;
        let epoch = take_counter(&mut state.next_pause_epoch)?;
        state
            .targets
            .get_mut(&key)
            .expect("validated child target")
            .pause = Some(PauseRecord {
            epoch,
            frames: BTreeMap::new(),
            frame_slots_by_backend_id: BTreeMap::new(),
            variables: BTreeMap::new(),
        });
        Ok(ChildPauseAuthority {
            pause_epoch: epoch,
            target: target.clone(),
        })
    }

    pub(crate) fn admit_frame(
        &self,
        pause: &ChildPauseAuthority,
        backend_frame_id: impl Into<Box<str>>,
    ) -> Result<ChildFrameAuthority, String> {
        let backend_frame_id = backend_frame_id.into();
        if !valid_backend_id(&backend_frame_id) {
            return Err("Invalid child inspector frame identity.".to_string());
        }
        let mut state = self.lock()?;
        ensure_pause(&state, pause)?;
        let key = target_key(&pause.target);
        if let Some(slot) = state.targets[&key]
            .pause
            .as_ref()
            .expect("validated child pause")
            .frame_slots_by_backend_id
            .get(&backend_frame_id)
            .copied()
        {
            return Ok(ChildFrameAuthority {
                frame_slot: slot,
                pause: pause.clone(),
            });
        }
        if state.targets[&key]
            .pause
            .as_ref()
            .expect("validated child pause")
            .frames
            .len()
            >= MAX_FRAMES_PER_PAUSE
        {
            return Err("Child inspector frame inventory is full.".to_string());
        }
        let slot = take_counter(&mut state.next_frame_slot)?;
        let current = state
            .targets
            .get_mut(&key)
            .expect("validated child target")
            .pause
            .as_mut()
            .expect("validated child pause");
        current
            .frame_slots_by_backend_id
            .insert(backend_frame_id.clone(), slot);
        current
            .frames
            .insert(slot, FrameRecord { backend_frame_id });
        Ok(ChildFrameAuthority {
            frame_slot: slot,
            pause: pause.clone(),
        })
    }

    pub(crate) fn admit_variable(
        &self,
        frame: &ChildFrameAuthority,
        backend_reference: u64,
    ) -> Result<ChildVariableAuthority, String> {
        if backend_reference == 0 || backend_reference > MAX_SAFE_INTEGER {
            return Err("Invalid child inspector variable reference.".to_string());
        }
        let mut state = self.lock()?;
        ensure_frame(&state, frame)?;
        let key = target_key(&frame.pause.target);
        if state.targets[&key]
            .pause
            .as_ref()
            .expect("validated child pause")
            .variables
            .len()
            >= MAX_VARIABLES_PER_PAUSE
        {
            return Err("Child inspector variable inventory is full.".to_string());
        }
        let slot = take_counter(&mut state.next_variable_slot)?;
        state
            .targets
            .get_mut(&key)
            .expect("validated child target")
            .pause
            .as_mut()
            .expect("validated child pause")
            .variables
            .insert(
                slot,
                VariableRecord {
                    backend_reference,
                    frame_slot: frame.frame_slot,
                },
            );
        Ok(ChildVariableAuthority {
            frame: frame.clone(),
            variable_slot: slot,
        })
    }

    pub(crate) fn resolve_frame(&self, frame: &ChildFrameAuthority) -> Option<ChildFrameRoute> {
        let state = self.lock().ok()?;
        ensure_frame(&state, frame).ok()?;
        let target = state.targets.get(&target_key(&frame.pause.target))?;
        let backend_frame_id = target
            .pause
            .as_ref()?
            .frames
            .get(&frame.frame_slot)?
            .backend_frame_id
            .clone();
        Some(ChildFrameRoute {
            backend_frame_id,
            endpoint: target.fingerprint.endpoint.clone(),
            target: frame.pause.target.clone(),
        })
    }

    pub(crate) fn resolve_target(&self, target: &ChildTargetAuthority) -> Option<ChildTargetRoute> {
        let state = self.lock().ok()?;
        ensure_target(&state, target).ok()?;
        Some(ChildTargetRoute {
            endpoint: state
                .targets
                .get(&target_key(target))?
                .fingerprint
                .endpoint
                .clone(),
            target: target.clone(),
        })
    }

    pub(crate) fn resolve_pause(&self, pause: &ChildPauseAuthority) -> Option<ChildTargetRoute> {
        let state = self.lock().ok()?;
        ensure_pause(&state, pause).ok()?;
        Some(ChildTargetRoute {
            endpoint: state
                .targets
                .get(&target_key(&pause.target))?
                .fingerprint
                .endpoint
                .clone(),
            target: pause.target.clone(),
        })
    }

    pub(crate) fn resolve_variable(
        &self,
        variable: &ChildVariableAuthority,
    ) -> Option<ChildInspectionRoute> {
        let state = self.lock().ok()?;
        ensure_frame(&state, &variable.frame).ok()?;
        let target = state
            .targets
            .get(&target_key(&variable.frame.pause.target))?;
        let pause = target.pause.as_ref()?;
        let variable_record = pause.variables.get(&variable.variable_slot)?;
        if variable_record.frame_slot != variable.frame.frame_slot {
            return None;
        }
        let frame = pause.frames.get(&variable.frame.frame_slot)?;
        Some(ChildInspectionRoute {
            backend_frame_id: frame.backend_frame_id.clone(),
            backend_variable_reference: variable_record.backend_reference,
            endpoint: target.fingerprint.endpoint.clone(),
            target: variable.frame.pause.target.clone(),
        })
    }

    pub(crate) fn resume(&self, pause: &ChildPauseAuthority) -> Result<(), String> {
        let mut state = self.lock()?;
        ensure_pause(&state, pause)?;
        state
            .targets
            .get_mut(&target_key(&pause.target))
            .expect("validated child target")
            .pause = None;
        Ok(())
    }

    /// Invalidates one exact target generation after its transport disconnects. A later discovery
    /// of the same PID/start-token/endpoint receives a fresh generation, so pre-disconnect target,
    /// pause, frame and variable capabilities cannot cross the reconnect boundary.
    pub(crate) fn invalidate_target(&self, target: &ChildTargetAuthority) -> Result<(), String> {
        let mut state = self.lock()?;
        ensure_target(&state, target)?;
        state.targets.remove(&target_key(target));
        Ok(())
    }

    /// Idempotent exact-once stop. No discovery or inspection can pass the registry lock between
    /// authority invalidation and process-group teardown.
    pub(crate) fn stop_and_reap(&self) -> Result<(), String> {
        let current_thread = std::thread::current().id();
        let (group, mut reaper) = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            loop {
                match &state.stop {
                    RegistryStopState::Running => {
                        state.targets.clear();
                        state.stop = RegistryStopState::Stopping {
                            owner: current_thread,
                        };
                        let reaper = state.reaper.take().ok_or_else(|| {
                            "Owned Node process-group reaper is unavailable.".to_string()
                        })?;
                        break (state.group, reaper);
                    }
                    RegistryStopState::Stopping { owner } if *owner == current_thread => {
                        return Err(
                            "Owned Node process-group stop is already in progress.".to_string()
                        );
                    }
                    RegistryStopState::Stopping { .. } => {
                        state = self
                            .stop_finished
                            .wait(state)
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                    }
                    RegistryStopState::Stopped(result) => return result.clone(),
                }
            }
        };

        let result = catch_unwind(AssertUnwindSafe(|| reaper.stop_and_reap(group))).unwrap_or_else(
            |payload| {
                Err(neutralize_panic_payload(
                    payload,
                    "Owned Node process-group reaper panicked during stop.",
                )
                .to_string())
            },
        );
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.stop = RegistryStopState::Stopped(result.clone());
        self.stop_finished.notify_all();
        result
    }

    fn lock(&self) -> Result<MutexGuard<'_, RegistryState<Reaper>>, String> {
        self.state
            .lock()
            .map_err(|_| "Owned Node child-target registry is unavailable.".to_string())
    }
}

pub(crate) fn neutralize_panic_payload(
    payload: Box<dyn Any + Send>,
    deterministic_error: &'static str,
) -> &'static str {
    std::mem::forget(payload);
    deterministic_error
}

fn validate_inventory(
    group: OwnedNodeProcessGroup,
    observations: Vec<VerifiedChildInspectorObservation>,
) -> Result<BTreeMap<(u32, u64), TargetFingerprint>, String> {
    let mut result = BTreeMap::new();
    let mut endpoint_sockets = BTreeSet::new();
    let mut process_identities = BTreeMap::new();
    let mut pids = BTreeSet::new();
    let mut target_ids = BTreeSet::new();
    for observation in observations {
        validate_ancestry(group, &observation.ancestry)?;
        for process in &observation.ancestry {
            if process_identities
                .insert(process.pid, process.clone())
                .is_some_and(|existing| existing != *process)
            {
                return Err("Ambiguous child inspector process inventory.".to_string());
            }
        }
        let process = observation.process().clone();
        if !pids.insert(process.pid) {
            return Err("Ambiguous child inspector process inventory.".to_string());
        }
        if !endpoint_sockets.insert((observation.endpoint.host, observation.endpoint.port))
            || !target_ids.insert(observation.endpoint.target_id.clone())
        {
            return Err("Ambiguous child inspector endpoint inventory.".to_string());
        }
        let key = (process.pid, process.start_token);
        if result
            .insert(
                key,
                TargetFingerprint {
                    endpoint: observation.endpoint,
                    process,
                },
            )
            .is_some()
        {
            return Err("Duplicate child inspector identity.".to_string());
        }
    }
    Ok(result)
}

fn validate_ancestry(
    group: OwnedNodeProcessGroup,
    ancestry: &[ChildProcessIdentity],
) -> Result<(), String> {
    if ancestry.len() < 2
        || ancestry.len() > MAX_ANCESTRY_DEPTH
        || ancestry[0].pid != group.root_pid
        || ancestry[0].start_token != group.root_start_token
        || ancestry.iter().any(|process| {
            process.process_group_id != group.process_group_id
                || process.pid == group.process_group_id && process.pid != group.root_pid
        })
        || ancestry
            .windows(2)
            .any(|edge| edge[1].parent_pid != edge[0].pid)
        || ancestry
            .iter()
            .map(|process| process.pid)
            .collect::<BTreeSet<_>>()
            .len()
            != ancestry.len()
    {
        return Err("Child inspector ancestry is not authoritative.".to_string());
    }
    Ok(())
}

fn ensure_target<Reaper>(
    state: &RegistryState<Reaper>,
    authority: &ChildTargetAuthority,
) -> Result<(), String> {
    if !matches!(&state.stop, RegistryStopState::Running)
        || authority.logical_session_id != state.group.logical_session_id
        || authority.registry_incarnation != state.group.registry_incarnation
    {
        return Err("Stale child target authority.".to_string());
    }
    let Some(target) = state.targets.get(&target_key(authority)) else {
        return Err("Stale child target authority.".to_string());
    };
    if target.generation != authority.target_generation {
        return Err("Stale child target generation.".to_string());
    }
    Ok(())
}

fn ensure_pause<Reaper>(
    state: &RegistryState<Reaper>,
    authority: &ChildPauseAuthority,
) -> Result<(), String> {
    ensure_target(state, &authority.target)?;
    let target = &state.targets[&target_key(&authority.target)];
    if target
        .pause
        .as_ref()
        .is_none_or(|pause| pause.epoch != authority.pause_epoch)
    {
        return Err("Stale child pause authority.".to_string());
    }
    Ok(())
}

fn ensure_frame<Reaper>(
    state: &RegistryState<Reaper>,
    authority: &ChildFrameAuthority,
) -> Result<(), String> {
    ensure_pause(state, &authority.pause)?;
    let target = &state.targets[&target_key(&authority.pause.target)];
    if !target
        .pause
        .as_ref()
        .expect("validated child pause")
        .frames
        .contains_key(&authority.frame_slot)
    {
        return Err("Stale child frame authority.".to_string());
    }
    Ok(())
}

fn authority(group: OwnedNodeProcessGroup, target: &TargetRecord) -> ChildTargetAuthority {
    ChildTargetAuthority {
        logical_session_id: group.logical_session_id,
        process_start_token: target.fingerprint.process.start_token,
        registry_incarnation: group.registry_incarnation,
        target_generation: target.generation,
        target_pid: target.fingerprint.process.pid,
    }
}

fn target_key(authority: &ChildTargetAuthority) -> (u32, u64) {
    (authority.target_pid, authority.process_start_token)
}

fn take_counter(counter: &mut u64) -> Result<u64, String> {
    let current = *counter;
    if current == 0 {
        return Err("Child debug authority counter is exhausted.".to_string());
    }
    *counter = next_counter_state(current)
        .ok_or_else(|| "Child debug authority counter is exhausted.".to_string())?;
    Ok(current)
}

fn next_counter_state(current: u64) -> Option<u64> {
    if current > MAX_SAFE_INTEGER {
        None
    } else {
        current.checked_add(1)
    }
}

fn valid_backend_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_BACKEND_ID_BYTES && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod counter_tests {
    use super::*;

    #[test]
    fn every_authority_counter_crosses_into_a_non_reusable_exhaustion_sentinel() {
        assert_eq!(
            next_counter_state(MAX_SAFE_INTEGER),
            Some(MAX_SAFE_INTEGER + 1)
        );
        assert_eq!(next_counter_state(MAX_SAFE_INTEGER + 1), None);

        let mut last = MAX_SAFE_INTEGER;
        assert_eq!(take_counter(&mut last), Ok(MAX_SAFE_INTEGER));
        assert_eq!(last, MAX_SAFE_INTEGER + 1);
        assert!(take_counter(&mut last).is_err());

        let mut exhausted = MAX_SAFE_INTEGER + 1;
        assert!(take_counter(&mut exhausted).is_err());
        assert_eq!(exhausted, MAX_SAFE_INTEGER + 1);
    }
}
