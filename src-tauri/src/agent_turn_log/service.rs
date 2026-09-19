use super::append::append;
use super::connection::{open_turn_log, recover_write_ahead_log, OpenedTurnLog, TurnLogAccess};
use super::errors::{AgentTurnLogError, AgentTurnLogResult};
use super::integrity::forget_verified_database;
use super::open::open_lease;
use super::ownership::ThreadOwnershipProbe;
use super::page::{empty_page, read_page};
use super::paths::{
    delete_database_files, locate, orphan_database_paths, quarantine_corrupt_database,
    AgentTurnLogLocation,
};
use super::projection::{validate_lease, validate_page, validate_receipt, validate_summaries};
use super::schema::read_turn_meta;
use super::summary::summarize;
use super::validation::{
    validate_append_request, validate_delete_request, validate_open_request, validate_page_request,
    validate_summarize_request,
};
use super::wire::{
    AgentTurnLogLease, AgentTurnLogPage, AgentTurnLogScope, AgentTurnLogSummary,
    AppendAgentTurnLogReceipt, AppendAgentTurnLogRequest, DeleteAgentThreadLogRequest,
    DeleteAgentThreadLogResult, OpenAgentTurnLogRequest, ReadAgentTurnLogPageRequest,
    SummarizeAgentTurnLogsRequest,
};
use rusqlite::Connection;
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Mutex, PoisonError},
};

const MAX_POOLED_CONNECTIONS: usize = 4;
const MAX_SWEPT_ORPHANS: usize = 256;
const MAX_TRACKED_GENERATIONS: usize = 64;

struct PooledSlot {
    key: String,
    connection: Connection,
    writable: bool,
    generation: u64,
    ownership: ThreadOwnershipProbe,
}

pub(crate) struct AgentTurnLogStore {
    base_dir: PathBuf,
    pool: Mutex<VecDeque<PooledSlot>>,
    generations: Mutex<VecDeque<(String, u64)>>,
}

struct Checkout<'store> {
    store: &'store AgentTurnLogStore,
    slot: Option<PooledSlot>,
}

impl Drop for Checkout<'_> {
    fn drop(&mut self) {
        let Some(slot) = self.slot.take() else {
            return;
        };
        self.store.check_in(slot);
    }
}

impl AgentTurnLogStore {
    pub(crate) fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            pool: Mutex::new(VecDeque::new()),
            generations: Mutex::new(VecDeque::new()),
        }
    }

    pub(crate) fn open(
        &self,
        request: &OpenAgentTurnLogRequest,
    ) -> AgentTurnLogResult<AgentTurnLogLease> {
        validate_open_request(request)?;
        let lease = self
            .with_connection(&request.scope, TurnLogAccess::ReadWrite, |slot| {
                open_lease(&mut slot.connection, request)
            })?
            .ok_or(AgentTurnLogError::Unreadable)?;
        validate_lease(&lease)?;
        Ok(lease)
    }

    pub(crate) fn append(
        &self,
        request: &AppendAgentTurnLogRequest,
    ) -> AgentTurnLogResult<AppendAgentTurnLogReceipt> {
        validate_append_request(request)?;
        let receipt = self
            .with_connection(&request.scope, TurnLogAccess::ReadWrite, |slot| {
                append(&mut slot.connection, request)
            })?
            .ok_or(AgentTurnLogError::Unreadable)?;
        validate_receipt(&receipt)?;
        Ok(receipt)
    }

    pub(crate) fn read_page(
        &self,
        request: &ReadAgentTurnLogPageRequest,
    ) -> AgentTurnLogResult<AgentTurnLogPage> {
        validate_page_request(request)?;
        let page = self.with_connection(&request.scope, TurnLogAccess::ReadOnly, |slot| {
            let meta = read_turn_meta(&slot.connection, &request.scope.turn_id)?;
            read_page(&slot.connection, request, meta.as_ref())
        })?;
        let page = page.unwrap_or_else(empty_page);
        validate_page(&page)?;
        Ok(page)
    }

    pub(crate) fn summarize(
        &self,
        request: &SummarizeAgentTurnLogsRequest,
    ) -> AgentTurnLogResult<Vec<AgentTurnLogSummary>> {
        validate_summarize_request(request)?;
        let scope = AgentTurnLogScope {
            root_key: request.root_key.clone(),
            owner_id: request.owner_id.clone(),
            thread_id: request.thread_id.clone(),
            turn_id: String::new(),
        };
        let summaries = self
            .with_connection(&scope, TurnLogAccess::ReadOnly, |slot| {
                summarize(&slot.connection, request.include_prompts)
            })?
            .unwrap_or_default();
        validate_summaries(&summaries)?;
        Ok(summaries)
    }

    pub(crate) fn delete_thread_log(
        &self,
        request: &DeleteAgentThreadLogRequest,
    ) -> AgentTurnLogResult<DeleteAgentThreadLogResult> {
        validate_delete_request(request)?;
        let location = locate(
            &self.base_dir,
            &request.root_key,
            &request.owner_id,
            &request.thread_id,
        )?;
        self.invalidate(&location.key);
        forget_verified_database(&location.database);
        let deleted = delete_database_files(&location)?;
        Ok(DeleteAgentThreadLogResult { deleted })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn sweep_orphan_logs(
        &self,
        root_key: &str,
        owner_id: &str,
        live_thread_ids: &[String],
    ) -> AgentTurnLogResult<Vec<PathBuf>> {
        orphan_database_paths(
            &self.base_dir,
            root_key,
            owner_id,
            live_thread_ids,
            MAX_SWEPT_ORPHANS,
        )
    }

    #[cfg(test)]
    pub(super) fn with_pooled_connection<T>(
        &self,
        scope: &AgentTurnLogScope,
        work: impl FnOnce(&Connection) -> T,
    ) -> AgentTurnLogResult<Option<T>> {
        self.with_connection(scope, TurnLogAccess::ReadWrite, |slot| {
            Ok(work(&slot.connection))
        })
    }

    fn with_connection<T>(
        &self,
        scope: &AgentTurnLogScope,
        access: TurnLogAccess,
        work: impl FnOnce(&mut PooledSlot) -> AgentTurnLogResult<T>,
    ) -> AgentTurnLogResult<Option<T>> {
        let location = locate(
            &self.base_dir,
            &scope.root_key,
            &scope.owner_id,
            &scope.thread_id,
        )?;
        let mut checkout = self.check_out(&location, access, &scope.root_key, &scope.thread_id)?;
        let Some(slot) = checkout.slot.as_mut() else {
            return Ok(None);
        };
        slot.ownership.revalidate()?;
        let outcome = work(slot);
        let Err(error) = &outcome else {
            return outcome.map(Some);
        };
        if *error == AgentTurnLogError::Corrupt {
            let corrupt = checkout.slot.take().map(|slot| slot.connection);
            return Err(self.quarantine(&location, corrupt));
        }
        if !error.retains_connection() {
            checkout.slot = None;
        }
        Err(*error)
    }

    fn check_out(
        &self,
        location: &AgentTurnLogLocation,
        access: TurnLogAccess,
        root_key: &str,
        thread_id: &str,
    ) -> AgentTurnLogResult<Checkout<'_>> {
        if let Some(slot) = self.take_pooled(&location.key, access) {
            return Ok(self.checkout_of(Some(slot)));
        }
        let generation = self.generation_of(&location.key);
        let Some((connection, writable)) = self.connect(location, access)? else {
            return Ok(self.checkout_of(None));
        };
        Ok(self.checkout_of(Some(PooledSlot {
            key: location.key.clone(),
            connection,
            writable,
            generation,
            ownership: ThreadOwnershipProbe::new(
                location.thread_document.clone(),
                root_key.to_string(),
                thread_id.to_string(),
            ),
        })))
    }

    fn connect(
        &self,
        location: &AgentTurnLogLocation,
        access: TurnLogAccess,
    ) -> AgentTurnLogResult<Option<(Connection, bool)>> {
        let writable = access == TurnLogAccess::ReadWrite;
        match open_turn_log(location, access) {
            Ok(opened) => self.accepted(location, opened, writable),
            Err(AgentTurnLogError::Unreadable) if !writable => self.recover_for_read(location),
            Err(error) => Err(error),
        }
    }

    fn recover_for_read(
        &self,
        location: &AgentTurnLogLocation,
    ) -> AgentTurnLogResult<Option<(Connection, bool)>> {
        let recovered = recover_write_ahead_log(location)?;
        self.accepted(location, recovered, false)
    }

    fn accepted(
        &self,
        location: &AgentTurnLogLocation,
        opened: OpenedTurnLog,
        writable: bool,
    ) -> AgentTurnLogResult<Option<(Connection, bool)>> {
        match opened {
            OpenedTurnLog::Ready(connection) => Ok(Some((connection, writable))),
            OpenedTurnLog::Absent => Ok(None),
            OpenedTurnLog::Corrupt(connection) => Err(self.quarantine(location, Some(connection))),
        }
    }

    fn quarantine(
        &self,
        location: &AgentTurnLogLocation,
        connection: Option<Connection>,
    ) -> AgentTurnLogError {
        forget_verified_database(&location.database);
        let quarantined = quarantine_corrupt_database(&location.database);
        drop(connection);
        self.invalidate(&location.key);
        quarantined
    }

    fn checkout_of(&self, slot: Option<PooledSlot>) -> Checkout<'_> {
        Checkout { store: self, slot }
    }

    fn take_pooled(&self, key: &str, access: TurnLogAccess) -> Option<PooledSlot> {
        let slot = {
            let mut pool = self.pool.lock().unwrap_or_else(PoisonError::into_inner);
            let index = pool.iter().position(|slot| slot.key == key)?;
            pool.remove(index)?
        };
        if access == TurnLogAccess::ReadWrite && !slot.writable {
            return None;
        }
        if slot.generation != self.generation_of(key) {
            return None;
        }
        Some(slot)
    }

    fn generation_of(&self, key: &str) -> u64 {
        let generations = self
            .generations
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        generations
            .iter()
            .find(|(tracked, _)| tracked == key)
            .map(|(_, generation)| *generation)
            .unwrap_or_default()
    }

    fn invalidate(&self, key: &str) {
        {
            let mut generations = self
                .generations
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let previous = generations
                .iter()
                .position(|(tracked, _)| tracked == key)
                .and_then(|index| generations.remove(index))
                .map(|(_, generation)| generation)
                .unwrap_or_default();
            generations.push_back((key.to_string(), previous.wrapping_add(1)));
            if generations.len() > MAX_TRACKED_GENERATIONS {
                generations.pop_front();
            }
        }
        self.evict(key);
    }

    fn evict(&self, key: &str) {
        let evicted: Vec<PooledSlot> = {
            let mut pool = self.pool.lock().unwrap_or_else(PoisonError::into_inner);
            let mut evicted = Vec::new();
            while let Some(index) = pool.iter().position(|slot| slot.key == key) {
                evicted.extend(pool.remove(index));
            }
            evicted
        };
        drop(evicted);
    }

    fn check_in(&self, slot: PooledSlot) {
        if slot.generation != self.generation_of(&slot.key) {
            return;
        }
        let evicted = {
            let mut pool = self.pool.lock().unwrap_or_else(PoisonError::into_inner);
            pool.retain(|pooled| pooled.key != slot.key);
            pool.push_back(slot);
            match pool.len() > MAX_POOLED_CONNECTIONS {
                true => pool.pop_front(),
                false => None,
            }
        };
        drop(evicted);
    }
}
