use super::{
    ssh_forward::{ForwardDestination, ForwardProcess, RemoteLoopback},
    wire::{ForwardState, PortForward, PortScope},
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard, Weak},
    time::{Duration, Instant},
};

pub(super) const MAX_FORWARDS: usize = 8;
pub(super) const MAX_OWNER_FORWARDS: usize = 4;
const MISSING_GRACE: Duration = Duration::from_secs(30);
pub(super) const STALE_OWNER: &str =
    "This port preview belongs to a closed or replaced workspace. Reopen it to forward ports.";
pub(super) const CHANGED: &str = "Runner connection changed while forwarding the port.";
const CLOSED: &str = "Runner connection is closed. Reconnect the server.";
const ALREADY_OPENING: &str = "This server port is already being forwarded. Try again shortly.";

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct OwnerLease {
    pub(super) id: String,
    pub(super) generation: u64,
}

pub(super) trait OwnerAuthority: Send + Sync {
    fn is_live(&self, owner: &OwnerLease) -> bool;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ForwardKey {
    pub(super) owner: OwnerLease,
    pub(super) scope: PortScope,
    pub(super) port: u16,
}

impl ForwardKey {
    fn in_scope(&self, owner: &OwnerLease, scope: &PortScope) -> bool {
        self.owner == *owner && self.scope == *scope
    }
}

pub(super) enum Reservation {
    Open(u16),
    Pending(u64),
}

pub(super) enum Probe {
    Gone,
    Exited,
    Running,
}

#[derive(Default)]
struct RegistryState {
    owners: HashMap<String, usize>,
    active: usize,
    claimed: HashSet<u16>,
    sets: Vec<Weak<SetShared>>,
}

#[derive(Default)]
pub(in crate::remote_runner) struct PortForwardRegistry {
    state: Mutex<RegistryState>,
}

impl PortForwardRegistry {
    fn lock(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(super) fn release(&self, owner: &OwnerLease) {
        self.sweep(|key| key.owner == *owner);
    }

    pub(super) fn release_retired(&self, owner_id: &str, authority: &dyn OwnerAuthority) {
        for set in self.sets() {
            set.retire_dead(|owner| owner.id == owner_id, authority);
        }
    }

    pub(super) fn close_forward(&self, server_id: &str, key: &ForwardKey) {
        for set in self.sets() {
            if set.destination.server_id() == server_id {
                set.take(|entry| entry.key == *key);
            }
        }
    }

    pub(super) fn claim(self: &Arc<Self>, port: u16) -> Option<PortClaim> {
        if !self.lock().claimed.insert(port) {
            return None;
        }
        Some(PortClaim {
            registry: Arc::clone(self),
            port,
        })
    }

    #[cfg(test)]
    pub(super) fn active(&self) -> usize {
        self.lock().active
    }

    #[cfg(test)]
    pub(super) fn claimed(&self) -> usize {
        self.lock().claimed.len()
    }

    fn sweep(&self, retire: impl Fn(&ForwardKey) -> bool) {
        for set in self.sets() {
            set.take(|entry| retire(&entry.key));
        }
    }

    fn sets(&self) -> Vec<Arc<SetShared>> {
        let mut state = self.lock();
        state.sets.retain(|set| set.strong_count() > 0);
        state.sets.iter().filter_map(Weak::upgrade).collect()
    }

    fn track(&self, set: &Arc<SetShared>) {
        let mut state = self.lock();
        state.sets.retain(|tracked| tracked.strong_count() > 0);
        if !state
            .sets
            .iter()
            .any(|tracked| std::ptr::eq(tracked.as_ptr(), Arc::as_ptr(set)))
        {
            state.sets.push(Arc::downgrade(set));
        }
    }

    fn permit(self: &Arc<Self>, owner: &OwnerLease) -> Result<ForwardPermit, String> {
        let mut state = self.lock();
        if state.active >= MAX_FORWARDS {
            return Err(format!(
                "At most {MAX_FORWARDS} server ports can be forwarded at once. Stop one first."
            ));
        }
        let live = state.owners.entry(owner.id.clone()).or_insert(0);
        if *live >= MAX_OWNER_FORWARDS {
            return Err(format!(
                "At most {MAX_OWNER_FORWARDS} server ports can be forwarded per workspace, including other conversations. Stop one first."
            ));
        }
        *live += 1;
        state.active += 1;
        Ok(ForwardPermit {
            registry: Arc::clone(self),
            owner_id: owner.id.clone(),
        })
    }
}

pub(super) struct PortClaim {
    registry: Arc<PortForwardRegistry>,
    port: u16,
}

impl PortClaim {
    pub(super) fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for PortClaim {
    fn drop(&mut self) {
        self.registry.lock().claimed.remove(&self.port);
    }
}

struct ForwardPermit {
    registry: Arc<PortForwardRegistry>,
    owner_id: String,
}

impl Drop for ForwardPermit {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        state.active = state.active.saturating_sub(1);
        let remaining = state.owners.get_mut(&self.owner_id).map(|live| {
            *live = live.saturating_sub(1);
            *live
        });
        if remaining == Some(0) {
            state.owners.remove(&self.owner_id);
        }
    }
}

struct Entry {
    id: u64,
    key: ForwardKey,
    target: RemoteLoopback,
    process: Option<ForwardProcess>,
    claim: Option<PortClaim>,
    ready: bool,
    last_seen: Instant,
    last_checked: Instant,
    _permit: ForwardPermit,
}

impl Entry {
    fn exited(&mut self) -> bool {
        self.ready
            && self
                .process
                .as_mut()
                .is_none_or(|process| process.has_exited())
    }

    fn forward(&self) -> Option<PortForward> {
        let local_port = self.claim.as_ref()?.port;
        let state = match self.ready {
            true => ForwardState::Open,
            false => ForwardState::Opening,
        };
        Some(PortForward { local_port, state })
    }
}

#[derive(Default)]
struct Table {
    closed: bool,
    next_id: u64,
    entries: Vec<Entry>,
}

struct SetShared {
    destination: ForwardDestination,
    table: Mutex<Table>,
}

impl SetShared {
    fn lock(&self) -> MutexGuard<'_, Table> {
        self.table.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn take(&self, mut retire: impl FnMut(&mut Entry) -> bool) {
        let removed: Vec<Entry> = self
            .lock()
            .entries
            .extract_if(.., |entry| retire(entry))
            .collect();
        drop(removed);
    }

    fn retire_dead(&self, select: impl Fn(&OwnerLease) -> bool, authority: &dyn OwnerAuthority) {
        let owners: HashSet<OwnerLease> = self
            .lock()
            .entries
            .iter()
            .map(|entry| entry.key.owner.clone())
            .filter(|owner| select(owner))
            .collect();
        let dead: HashSet<OwnerLease> = owners
            .into_iter()
            .filter(|owner| !authority.is_live(owner))
            .collect();
        if dead.is_empty() {
            return;
        }
        self.take(|entry| dead.contains(&entry.key.owner));
    }
}

pub(in crate::remote_runner) struct ForwardSet(Arc<SetShared>);

impl ForwardSet {
    pub(in crate::remote_runner) fn new(destination: ForwardDestination) -> Self {
        Self(Arc::new(SetShared {
            destination,
            table: Mutex::new(Table::default()),
        }))
    }

    pub(in crate::remote_runner) fn close(&self) {
        let removed = {
            let mut table = self.0.lock();
            table.closed = true;
            std::mem::take(&mut table.entries)
        };
        drop(removed);
    }

    pub(super) fn destination(&self) -> &ForwardDestination {
        &self.0.destination
    }

    pub(super) fn reserve(
        &self,
        registry: &Arc<PortForwardRegistry>,
        key: &ForwardKey,
        target: RemoteLoopback,
        now: Instant,
    ) -> Result<Reservation, String> {
        registry.track(&self.0);
        let mut retired: Vec<Entry> = Vec::new();
        let mut table = self.0.lock();
        if table.closed {
            return Err(CLOSED.into());
        }
        retired.extend(table.entries.extract_if(.., |entry| {
            entry.exited() || (entry.key == *key && entry.ready && entry.target != target)
        }));
        if let Some(entry) = table.entries.iter().find(|entry| entry.key == *key) {
            return match (entry.ready, entry.claim.as_ref()) {
                (true, Some(claim)) => Ok(Reservation::Open(claim.port)),
                _ => Err(ALREADY_OPENING.into()),
            };
        }
        let permit = registry.permit(&key.owner)?;
        table.next_id += 1;
        let id = table.next_id;
        table.entries.push(Entry {
            id,
            key: key.clone(),
            target,
            process: None,
            claim: None,
            ready: false,
            last_seen: now,
            last_checked: now,
            _permit: permit,
        });
        Ok(Reservation::Pending(id))
    }

    pub(super) fn attach(
        &self,
        id: u64,
        claim: PortClaim,
        process: ForwardProcess,
    ) -> Result<(), String> {
        let mut replaced = (Some(claim), Some(process));
        let mut table = self.0.lock();
        if table.closed {
            return Err(CHANGED.into());
        }
        let entry = table
            .entries
            .iter_mut()
            .find(|entry| entry.id == id && !entry.ready)
            .ok_or(CHANGED)?;
        std::mem::swap(&mut entry.claim, &mut replaced.0);
        std::mem::swap(&mut entry.process, &mut replaced.1);
        Ok(())
    }

    pub(super) fn probe(&self, id: u64) -> Probe {
        let mut table = self.0.lock();
        if table.closed {
            return Probe::Gone;
        }
        let Some(entry) = table.entries.iter_mut().find(|entry| entry.id == id) else {
            return Probe::Gone;
        };
        match entry.process.as_mut().map(ForwardProcess::has_exited) {
            Some(false) => Probe::Running,
            Some(true) => Probe::Exited,
            None => Probe::Gone,
        }
    }

    pub(super) fn retire_dead(&self, authority: &dyn OwnerAuthority) {
        self.0.retire_dead(|_| true, authority);
    }

    pub(super) fn mark_ready(&self, id: u64) -> Result<u16, String> {
        let mut table = self.0.lock();
        if table.closed {
            return Err(CLOSED.into());
        }
        let entry = table
            .entries
            .iter_mut()
            .find(|entry| entry.id == id && !entry.ready)
            .ok_or(CHANGED)?;
        let running = entry
            .process
            .as_mut()
            .is_some_and(|process| !process.has_exited());
        let port = entry.claim.as_ref().map(PortClaim::port);
        let (true, Some(port)) = (running, port) else {
            return Err(CHANGED.into());
        };
        entry.ready = true;
        Ok(port)
    }

    pub(super) fn discard(&self, id: u64) {
        self.0.take(|entry| entry.id == id);
    }

    pub(super) fn abandon(&self, id: u64) {
        self.0.take(|entry| entry.id == id && !entry.ready);
    }

    pub(super) fn remove(&self, key: &ForwardKey) {
        self.0.take(|entry| entry.key == *key);
    }

    pub(super) fn reconcile(
        &self,
        owner: &OwnerLease,
        scope: &PortScope,
        listed: Option<&[u16]>,
        now: Instant,
    ) -> Vec<(u16, PortForward)> {
        let mut removed: Vec<Entry> = Vec::new();
        let mut table = self.0.lock();
        removed.extend(table.entries.extract_if(.., |entry| {
            entry.exited()
                || (entry.key.in_scope(owner, scope)
                    && entry.ready
                    && listed.is_some_and(|ports| !ports.contains(&entry.key.port))
                    && now.saturating_duration_since(entry.last_seen) >= MISSING_GRACE)
        }));
        let mut forwards = Vec::new();
        for entry in table
            .entries
            .iter_mut()
            .filter(|entry| entry.key.in_scope(owner, scope))
        {
            entry.last_checked = now;
            if listed.is_none_or(|ports| ports.contains(&entry.key.port)) {
                entry.last_seen = now;
            }
            if let Some(forward) = entry.forward() {
                forwards.push((entry.key.port, forward));
            }
        }
        drop(table);
        drop(removed);
        forwards
    }

    pub(super) fn stale_scope(
        &self,
        owner: &OwnerLease,
        current: &PortScope,
        now: Instant,
    ) -> Option<PortScope> {
        let mut table = self.0.lock();
        let scope = table
            .entries
            .iter()
            .filter(|entry| {
                entry.key.owner == *owner
                    && entry.key.scope != *current
                    && entry.ready
                    && now.saturating_duration_since(entry.last_checked) >= MISSING_GRACE
            })
            .min_by_key(|entry| entry.last_checked)
            .map(|entry| entry.key.scope.clone())?;
        for entry in table
            .entries
            .iter_mut()
            .filter(|entry| entry.key.in_scope(owner, &scope))
        {
            entry.last_checked = now;
        }
        Some(scope)
    }

    #[cfg(test)]
    pub(super) fn forward_pids(&self) -> Vec<u32> {
        self.0
            .lock()
            .entries
            .iter()
            .filter_map(|entry| entry.process.as_ref().map(ForwardProcess::pid))
            .collect()
    }
}
