use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sourcemap::SourceMap;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, Read};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::debug_support::path_from_file_url;

pub(crate) const MAX_SOURCE_MAP_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_SOURCE_MAPS: usize = 256;
pub(crate) const MAX_SOURCE_MAP_TOKENS_PER_MAP: usize = 250_000;
pub(crate) const MAX_SOURCE_MAP_TOKENS_TOTAL: usize = 1_000_000;
const MAX_SOURCE_MAP_SOURCES: usize = 4_096;
const MAX_SOURCE_AUTHORITIES_PER_MAP: usize = 256;
const MAX_SOURCE_AUTHORITIES_TOTAL: usize = 512;
const MAX_SCRIPT_ID_BYTES: usize = 4 * 1024;
pub(crate) const MAX_SOURCE_MAP_URL_BYTES: usize = 8 * 1024 * 1024;
const MAX_GENERATED_URL_BYTES: usize = 16 * 1024;
const MAX_SOURCE_MAP_DIAGNOSTICS: usize = 16;
const MAX_SOURCE_MAP_DIAGNOSTIC_BYTES: usize = 1_024;
const MAX_SOURCE_MAP_TOMBSTONES: usize = MAX_SOURCE_MAPS * 2;
const MAX_PENDING_SOURCE_MAPS: usize = 64;
const SOURCE_MAP_DIAGNOSTICS_SUPPRESSED: &str =
    "Additional source-map diagnostics were suppressed for this debug session.";
static NEXT_SOURCE_MAP_TRANSPORT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MappedSourceLocation {
    pub file_path: String,
    pub line_number: u32,
    pub column: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MappedGeneratedLocation {
    pub url: String,
    pub line_number: u32,
    pub column: u32,
}

#[derive(Clone)]
pub(crate) struct SourceMapLoader {
    inner: Arc<SourceMapLoaderInner>,
}

struct SourceMapLoaderInner {
    root: PathBuf,
    root_directory: File,
    transport_id: u64,
    next_generation: AtomicU64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SourceMapScriptIdentity {
    transport_id: u64,
    generation: u64,
    script_id: String,
    generated_url: String,
}

#[derive(Clone, Copy)]
struct ReverseSegment {
    source_column: u32,
    generated_line: u32,
    generated_column: u32,
}

pub(crate) struct PreparedSourceMap {
    line_starts: HashMap<u32, (u32, u32, u32, u32)>,
    identity: SourceMapScriptIdentity,
    completion: Arc<SourceMapCompletion>,
    map: SourceMap,
    reverse: HashMap<(u32, u32), Vec<ReverseSegment>>,
    source_ids_by_path: HashMap<PathBuf, Vec<u32>>,
    source_paths: Vec<Option<RetainedSourcePath>>,
    source_authority_count: usize,
    token_count: usize,
}

pub(crate) struct SourceMapPreparation {
    generated: RetainedSourcePath,
    identity: SourceMapScriptIdentity,
    loader: SourceMapLoader,
    source_map: ReservedSourceMap,
    completion: Arc<SourceMapCompletion>,
}

enum ReservedSourceMap {
    External {
        authority: RetainedSourcePath,
        source_base: PathBuf,
    },
    Inline {
        encoded: String,
        source_base: PathBuf,
    },
}

#[derive(Clone)]
pub(crate) struct SourceMapSettlement {
    identity: SourceMapScriptIdentity,
    completion: Arc<SourceMapCompletion>,
}

struct SourceMapCompletion {
    completed: Mutex<bool>,
    wake: Condvar,
}

struct RegisteredSourceMap {
    dispatch_state: Arc<SourceMapDispatchState>,
    line_starts: HashMap<u32, (u32, u32, u32, u32)>,
    identity: Arc<SourceMapScriptIdentity>,
    map: SourceMap,
    reverse: HashMap<(u32, u32), Vec<ReverseSegment>>,
    source_ids_by_path: HashMap<PathBuf, Vec<u32>>,
    source_paths: Vec<Option<RetainedSourcePath>>,
    source_authority_count: usize,
    token_count: usize,
}

#[derive(Clone)]
struct RetainedSourcePath {
    display_path: PathBuf,
    file: Arc<File>,
    relative_path: PathBuf,
}

pub(crate) struct MappedSourceCandidate {
    authority: RetainedSourcePath,
    column: u32,
    line_number: u32,
    loader: SourceMapLoader,
    receipt: SourceMapReceipt,
}

pub(crate) struct MappedGeneratedCandidate {
    authority: RetainedSourcePath,
    loader: SourceMapLoader,
    location: MappedGeneratedLocation,
    receipt: SourceMapReceipt,
}

#[derive(Clone)]
pub(crate) struct SourceMapReceipt {
    dispatch_state: Arc<SourceMapDispatchState>,
    identity: Arc<SourceMapScriptIdentity>,
}

struct SourceMapDispatchState {
    pins: AtomicUsize,
    superseded: AtomicBool,
}

#[path = "debug_source_map_smart_step.rs"]
mod smart_step;
pub(crate) use smart_step::{GeneratedSourceMapClassification, SourceMapDispatchLease};
use smart_step::{SettledScriptKind, SettledScriptOutcome};

pub(crate) struct ValidatedMappedSource {
    pub(crate) location: MappedSourceLocation,
    pub(crate) receipt: SourceMapReceipt,
}

pub(crate) struct ValidatedMappedGenerated {
    pub(crate) location: MappedGeneratedLocation,
    pub(crate) receipt: SourceMapReceipt,
}

pub(crate) struct SourceMapRegistry {
    loader: SourceMapLoader,
    maps: Vec<RegisteredSourceMap>,
    token_count: usize,
    source_authority_count: usize,
    source_authority_limit: usize,
    settled_generations: HashMap<String, u64>,
    settled_outcomes: HashMap<String, SettledScriptOutcome>,
    pending: HashMap<String, SourceMapSettlement>,
    stale_generation_floor: u64,
    diagnostics_emitted: usize,
    diagnostics_suppressed_reported: bool,
    smart_step_enabled: bool,
}

impl SourceMapReceipt {
    pub(crate) fn generation(&self) -> u64 {
        self.identity.generation
    }
}

// Descriptor-backed loading and path confinement live in a separate implementation
// unit so the registry stays focused on session state and prepared indexes.
include!("debug_source_map_descriptor.rs");

impl SourceMapRegistry {
    pub(crate) fn new(root: &Path) -> Result<Self, String> {
        Ok(Self {
            loader: SourceMapLoader::new(root)?,
            maps: Vec::new(),
            token_count: 0,
            source_authority_count: 0,
            source_authority_limit: MAX_SOURCE_AUTHORITIES_TOTAL,
            settled_generations: HashMap::new(),
            settled_outcomes: HashMap::new(),
            pending: HashMap::new(),
            stale_generation_floor: 0,
            diagnostics_emitted: 0,
            diagnostics_suppressed_reported: false,
            smart_step_enabled: true,
        })
    }

    pub(crate) fn loader(&self) -> SourceMapLoader {
        self.loader.clone()
    }

    #[cfg(test)]
    pub(crate) fn new_with_source_authority_limit_for_test(
        root: &Path,
        limit: usize,
    ) -> Result<Self, String> {
        let mut registry = Self::new(root)?;
        registry.source_authority_limit = limit;
        Ok(registry)
    }

    #[cfg(test)]
    pub(crate) fn retained_source_authority_count_for_test(&self) -> usize {
        self.source_authority_count
    }

    pub(crate) fn accepts_script_identity(&self, script_id: &str, generated_url: &str) -> bool {
        validate_identity_component(script_id, MAX_SCRIPT_ID_BYTES, "script id").is_ok()
            && validate_identity_component(generated_url, MAX_GENERATED_URL_BYTES, "generated URL")
                .is_ok()
    }

    pub(crate) fn register_script(
        &mut self,
        generated_url: &str,
        source_map_url: &str,
    ) -> Result<(), String> {
        self.evict_script(generated_url);
        let prepared = self
            .loader
            .prepare_preloaded(generated_url, source_map_url)?;
        self.commit_script(prepared)
    }

    pub(crate) fn commit_script(&mut self, prepared: PreparedSourceMap) -> Result<(), String> {
        self.commit_script_with_receipt(prepared).map(|_| ())
    }

    pub(crate) fn commit_script_with_receipt(
        &mut self,
        prepared: PreparedSourceMap,
    ) -> Result<SourceMapReceipt, String> {
        let settlement = SourceMapSettlement {
            identity: prepared.identity.clone(),
            completion: Arc::clone(&prepared.completion),
        };
        let result = self.commit_script_inner(prepared);
        self.finish_pending(&settlement);
        result
    }

    fn commit_script_inner(
        &mut self,
        prepared: PreparedSourceMap,
    ) -> Result<SourceMapReceipt, String> {
        self.prune_superseded_unpinned_maps();
        if prepared.identity.transport_id != self.loader.inner.transport_id {
            return Err("Source-map result belongs to a stale debugger transport.".to_string());
        }
        if self
            .pending
            .get(&prepared.identity.script_id)
            .is_some_and(|pending| pending.identity != prepared.identity)
        {
            return Err("Source-map result belongs to a replaced pending script.".to_string());
        }
        if prepared.identity.generation <= self.stale_generation_floor {
            return Err("Source-map result belongs to a stale script generation.".to_string());
        }
        if self
            .settled_generations
            .get(&prepared.identity.script_id)
            .is_some_and(|generation| *generation >= prepared.identity.generation)
        {
            return Err("Source-map result belongs to a stale script generation.".to_string());
        }
        for entry in self.maps.iter().filter(|entry| {
            entry.identity.script_id == prepared.identity.script_id
                && entry.dispatch_state.pins.load(Ordering::Acquire) > 0
        }) {
            entry
                .dispatch_state
                .superseded
                .store(true, Ordering::Release);
        }
        let replaced = self.maps.iter().position(|entry| {
            entry.identity.script_id == prepared.identity.script_id
                && entry.dispatch_state.pins.load(Ordering::Acquire) == 0
        });
        let replaced_tokens = replaced
            .map(|index| self.maps[index].token_count)
            .unwrap_or(0);
        let replaced_authorities = replaced
            .map(|index| self.maps[index].source_authority_count)
            .unwrap_or(0);
        if replaced.is_none() && self.maps.len() >= MAX_SOURCE_MAPS {
            self.settle_failed_identity(&prepared.identity);
            return Err(format!(
                "Source-map registry exceeds the {MAX_SOURCE_MAPS}-map limit."
            ));
        }
        let Some(next_token_count) = self
            .token_count
            .saturating_sub(replaced_tokens)
            .checked_add(prepared.token_count)
        else {
            self.settle_failed_identity(&prepared.identity);
            return Err("Source-map token accounting overflowed.".to_string());
        };
        if next_token_count > MAX_SOURCE_MAP_TOKENS_TOTAL {
            self.settle_failed_identity(&prepared.identity);
            return Err(format!(
                "Source-map registry exceeds the {MAX_SOURCE_MAP_TOKENS_TOTAL}-token limit."
            ));
        }
        let Some(next_authority_count) = self
            .source_authority_count
            .saturating_sub(replaced_authorities)
            .checked_add(prepared.source_authority_count)
        else {
            self.settle_failed_identity(&prepared.identity);
            return Err("Source-map authority accounting overflowed.".to_string());
        };
        if next_authority_count > self.source_authority_limit {
            self.settle_failed_identity(&prepared.identity);
            return Err(format!(
                "Source-map registry exceeds the {}-source-authority limit.",
                self.source_authority_limit
            ));
        }
        if let Some(index) = replaced {
            self.maps.remove(index);
        }
        self.token_count = next_token_count;
        self.source_authority_count = next_authority_count;
        self.record_settled_generation(
            prepared.identity.script_id.clone(),
            prepared.identity.generation,
        );
        self.settled_outcomes.remove(&prepared.identity.script_id);
        let dispatch_state = Arc::new(SourceMapDispatchState {
            pins: AtomicUsize::new(0),
            superseded: AtomicBool::new(false),
        });
        let identity = Arc::new(prepared.identity);
        self.maps.push(RegisteredSourceMap {
            dispatch_state: Arc::clone(&dispatch_state),
            line_starts: prepared.line_starts,
            identity: Arc::clone(&identity),
            map: prepared.map,
            reverse: prepared.reverse,
            source_ids_by_path: prepared.source_ids_by_path,
            source_paths: prepared.source_paths,
            source_authority_count: prepared.source_authority_count,
            token_count: prepared.token_count,
        });
        Ok(SourceMapReceipt {
            dispatch_state,
            identity,
        })
    }

    pub(crate) fn mark_pending(&mut self, settlement: SourceMapSettlement) -> Result<(), String> {
        if self.settlement_is_stale(&settlement) {
            settlement.complete();
            return Err("Source-map preparation belongs to a stale script.".to_string());
        }
        if let Some(current) = self.pending.get(&settlement.identity.script_id) {
            if current.identity.generation >= settlement.identity.generation {
                settlement.complete();
                return Err("Source-map preparation belongs to a stale script.".to_string());
            }
        } else if self.pending.len() >= MAX_PENDING_SOURCE_MAPS {
            settlement.complete();
            return Err(format!(
                "Source-map registry exceeds the {MAX_PENDING_SOURCE_MAPS}-pending-map limit."
            ));
        }
        self.remove_script(&settlement.identity.script_id);
        if let Some(replaced) = self
            .pending
            .insert(settlement.identity.script_id.clone(), settlement)
        {
            replaced.complete();
        }
        Ok(())
    }

    pub(crate) fn pending_settlement(
        &self,
        script_id: &str,
        generated_url: &str,
    ) -> Option<SourceMapSettlement> {
        self.pending.get(script_id).and_then(|pending| {
            (pending.identity.generated_url == generated_url).then(|| pending.clone())
        })
    }

    pub(crate) fn evict_script(&mut self, generated_url: &str) {
        let mut removed = 0usize;
        let mut removed_authorities = 0usize;
        self.maps.retain(|entry| {
            let matches = entry.identity.generated_url == generated_url;
            let pinned = entry.dispatch_state.pins.load(Ordering::Acquire) > 0;
            if matches && pinned {
                entry
                    .dispatch_state
                    .superseded
                    .store(true, Ordering::Release);
            }
            let keep = !matches || pinned;
            if !keep {
                removed = removed.saturating_add(entry.token_count);
                removed_authorities =
                    removed_authorities.saturating_add(entry.source_authority_count);
            }
            keep
        });
        self.token_count = self.token_count.saturating_sub(removed);
        self.source_authority_count = self
            .source_authority_count
            .saturating_sub(removed_authorities);
        let pending = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.identity.generated_url == generated_url)
            .map(|(script_id, _)| script_id.clone())
            .collect::<Vec<_>>();
        for script_id in pending {
            if let Some(pending) = self.pending.remove(&script_id) {
                pending.complete();
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn evict_exact_script(&mut self, script_id: &str, generated_url: &str) {
        if !self.accepts_script_identity(script_id, generated_url) {
            return;
        }
        let generation = self
            .loader
            .inner
            .next_generation
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .unwrap_or(u64::MAX);
        self.record_settled_generation(script_id.to_string(), generation);
        self.settled_outcomes.remove(script_id);
        self.remove_script(script_id);
        if let Some(pending) = self.pending.remove(script_id) {
            pending.complete();
        }
    }

    pub(crate) fn settle_failed_preparation(&mut self, settlement: SourceMapSettlement) {
        let should_settle = settlement.identity.transport_id == self.loader.inner.transport_id
            && settlement.identity.generation > self.stale_generation_floor
            && self
                .settled_generations
                .get(&settlement.identity.script_id)
                .is_none_or(|generation| *generation < settlement.identity.generation);
        if should_settle {
            self.settle_failed_identity(&settlement.identity);
        }
        self.finish_pending(&settlement);
    }

    fn finish_pending(&mut self, settlement: &SourceMapSettlement) {
        if self
            .pending
            .get(&settlement.identity.script_id)
            .is_some_and(|pending| pending.identity == settlement.identity)
        {
            self.pending.remove(&settlement.identity.script_id);
        }
        settlement.complete();
    }

    fn settlement_is_stale(&self, settlement: &SourceMapSettlement) -> bool {
        settlement.identity.transport_id != self.loader.inner.transport_id
            || settlement.identity.generation <= self.stale_generation_floor
            || self
                .settled_generations
                .get(&settlement.identity.script_id)
                .is_some_and(|generation| *generation >= settlement.identity.generation)
    }

    fn settle_failed_identity(&mut self, identity: &SourceMapScriptIdentity) {
        self.record_settled_generation(identity.script_id.clone(), identity.generation);
        self.remove_script(&identity.script_id);
        self.settled_outcomes.insert(
            identity.script_id.clone(),
            SettledScriptOutcome {
                generated_url: identity.generated_url.clone(),
                generation: identity.generation,
                kind: SettledScriptKind::Failed,
            },
        );
    }

    fn remove_script(&mut self, script_id: &str) {
        let mut removed = 0usize;
        let mut removed_authorities = 0usize;
        self.maps.retain(|entry| {
            let matches = entry.identity.script_id == script_id;
            let pinned = entry.dispatch_state.pins.load(Ordering::Acquire) > 0;
            if matches && pinned {
                entry
                    .dispatch_state
                    .superseded
                    .store(true, Ordering::Release);
            }
            let keep = !matches || pinned;
            if !keep {
                removed = removed.saturating_add(entry.token_count);
                removed_authorities =
                    removed_authorities.saturating_add(entry.source_authority_count);
            }
            keep
        });
        self.token_count = self.token_count.saturating_sub(removed);
        self.source_authority_count = self
            .source_authority_count
            .saturating_sub(removed_authorities);
    }

    fn record_settled_generation(&mut self, script_id: String, generation: u64) {
        if !self.settled_generations.contains_key(&script_id)
            && self.settled_generations.len() >= MAX_SOURCE_MAP_TOMBSTONES
        {
            if let Some((oldest_id, oldest_generation)) = self
                .settled_generations
                .iter()
                .min_by_key(|(_, generation)| **generation)
                .map(|(script_id, generation)| (script_id.clone(), *generation))
            {
                self.settled_generations.remove(&oldest_id);
                self.settled_outcomes.remove(&oldest_id);
                self.stale_generation_floor = self.stale_generation_floor.max(oldest_generation);
            }
        }
        self.settled_generations.insert(script_id, generation);
    }

    pub(crate) fn source_map_diagnostic(&mut self, error: &str) -> Option<String> {
        if self.diagnostics_emitted < MAX_SOURCE_MAP_DIAGNOSTICS {
            self.diagnostics_emitted += 1;
            let prefix = "[debugger] Source map ignored: ";
            let suffix = "\n";
            let available =
                MAX_SOURCE_MAP_DIAGNOSTIC_BYTES.saturating_sub(prefix.len() + suffix.len());
            let (message, truncated) = truncate_utf8(error, available);
            return Some(if truncated {
                format!("{prefix}{message}…{suffix}")
            } else {
                format!("{prefix}{message}{suffix}")
            });
        }
        if !self.diagnostics_suppressed_reported {
            self.diagnostics_suppressed_reported = true;
            return Some(format!("[debugger] {SOURCE_MAP_DIAGNOSTICS_SUPPRESSED}\n"));
        }
        None
    }

    pub(crate) fn map_generated_for_script(
        &self,
        script_id: &str,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> Option<MappedSourceLocation> {
        self.map_generated_candidate_for_script(script_id, generated_url, line_number, column)?
            .validate()
    }

    pub(crate) fn map_generated_candidate_for_script(
        &self,
        script_id: &str,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> Option<MappedSourceCandidate> {
        let entry = self.maps.iter().rev().find(|entry| {
            !entry.dispatch_state.superseded.load(Ordering::Acquire)
                && entry.identity.script_id == script_id
                && entry.identity.generated_url == generated_url
                && entry.identity.transport_id == self.loader.inner.transport_id
        })?;
        map_generated_entry(&self.loader, entry, line_number, column)
    }

    pub(crate) fn map_generated(
        &self,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> Option<MappedSourceLocation> {
        self.map_generated_candidate(generated_url, line_number, column)?
            .validate()
    }

    pub(crate) fn map_generated_candidate(
        &self,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> Option<MappedSourceCandidate> {
        let entry = self.maps.iter().rev().find(|entry| {
            !entry.dispatch_state.superseded.load(Ordering::Acquire)
                && entry.identity.generated_url == generated_url
        })?;
        map_generated_entry(&self.loader, entry, line_number, column)
    }

    #[cfg(test)]
    pub(crate) fn map_original_line(
        &self,
        source_path: &Path,
        line_number: u32,
    ) -> Option<MappedGeneratedLocation> {
        self.map_original_candidate(source_path, line_number, None)?
            .validate()
    }

    #[cfg(test)]
    pub(crate) fn map_original_position(
        &self,
        source_path: &Path,
        line_number: u32,
        column: u32,
    ) -> Option<MappedGeneratedLocation> {
        if column == 0 {
            return None;
        }
        self.map_original_candidate(source_path, line_number, Some(column - 1))?
            .validate()
    }

    pub(crate) fn map_original_line_candidate(
        &self,
        source_path: &Path,
        line_number: u32,
    ) -> Option<MappedGeneratedCandidate> {
        self.map_original_candidate(source_path, line_number, None)
    }

    pub(crate) fn map_original_position_candidate(
        &self,
        source_path: &Path,
        line_number: u32,
        column: u32,
    ) -> Option<MappedGeneratedCandidate> {
        self.map_original_candidate(source_path, line_number, Some(column.checked_sub(1)?))
    }

    fn map_original_candidate(
        &self,
        source_path: &Path,
        line_number: u32,
        requested_column: Option<u32>,
    ) -> Option<MappedGeneratedCandidate> {
        let source_path = normalize_absolute_path(source_path)?;
        if !source_path.starts_with(&self.loader.inner.root) {
            return None;
        }
        let source_line = line_number.checked_sub(1)?;
        for entry in self.maps.iter().rev() {
            if entry.dispatch_state.superseded.load(Ordering::Acquire) {
                continue;
            }
            let Some(source_ids) = entry.source_ids_by_path.get(&source_path) else {
                continue;
            };
            let mut best: Option<(
                u32,
                std::cmp::Reverse<u32>,
                ReverseSegment,
                RetainedSourcePath,
            )> = None;
            for source_id in source_ids {
                let Some(authority) = entry
                    .source_paths
                    .get(*source_id as usize)
                    .and_then(Option::as_ref)
                else {
                    continue;
                };
                let Some(segments) = entry.reverse.get(&(*source_id, source_line)) else {
                    continue;
                };
                for segment in segments {
                    if requested_column.is_some_and(|column| segment.source_column > column) {
                        continue;
                    }
                    let rank = (
                        if requested_column.is_some() {
                            segment.source_column
                        } else {
                            u32::MAX - segment.source_column
                        },
                        std::cmp::Reverse(segment.generated_column),
                        *segment,
                        authority.clone(),
                    );
                    if best
                        .as_ref()
                        .is_none_or(|current| (current.0, current.1) < (rank.0, rank.1))
                    {
                        best = Some(rank);
                    }
                }
            }
            if let Some((_, _, segment, authority)) = best {
                return Some(MappedGeneratedCandidate {
                    authority,
                    loader: self.loader.clone(),
                    location: MappedGeneratedLocation {
                        url: entry.identity.generated_url.clone(),
                        line_number: segment.generated_line.checked_add(1)?,
                        column: segment.generated_column.checked_add(1)?,
                    },
                    receipt: SourceMapReceipt {
                        dispatch_state: Arc::clone(&entry.dispatch_state),
                        identity: Arc::clone(&entry.identity),
                    },
                });
            }
        }
        None
    }
}

impl SourceMapPreparation {
    pub(crate) fn settlement(&self) -> SourceMapSettlement {
        SourceMapSettlement {
            identity: self.identity.clone(),
            completion: Arc::clone(&self.completion),
        }
    }

    pub(crate) fn prepare(self) -> Result<PreparedSourceMap, String> {
        if !self.loader.validate_source_authority(&self.generated) {
            return Err("Generated script authority changed before map preparation.".to_string());
        }
        let (bytes, source_base) = self.loader.read_reserved_source_map(self.source_map)?;
        let map = SourceMap::from_slice(&bytes)
            .map_err(|error| format!("Unable to parse source map: {error}"))?;
        prepare_index(
            &self.loader,
            self.identity,
            self.completion,
            map,
            &source_base,
        )
    }
}

impl SourceMapSettlement {
    pub(crate) fn wait_until(&self, deadline: Instant) -> bool {
        let Ok(mut completed) = self.completion.completed.lock() else {
            return true;
        };
        while !*completed {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            if remaining == Duration::ZERO {
                return false;
            }
            let Ok((next, timeout)) = self.completion.wake.wait_timeout(completed, remaining)
            else {
                return true;
            };
            completed = next;
            if timeout.timed_out() && !*completed {
                return false;
            }
        }
        true
    }

    pub(crate) fn identity_key(&self) -> (u64, u64) {
        (self.identity.transport_id, self.identity.generation)
    }

    pub(crate) fn complete(&self) {
        let Ok(mut completed) = self.completion.completed.lock() else {
            self.completion.wake.notify_all();
            return;
        };
        *completed = true;
        self.completion.wake.notify_all();
    }
}

impl SourceMapCompletion {
    fn new() -> Self {
        Self {
            completed: Mutex::new(false),
            wake: Condvar::new(),
        }
    }
}

fn prepare_index(
    loader: &SourceMapLoader,
    identity: SourceMapScriptIdentity,
    completion: Arc<SourceMapCompletion>,
    map: SourceMap,
    source_base: &Path,
) -> Result<PreparedSourceMap, String> {
    let token_count = usize::try_from(map.get_token_count()).unwrap_or(usize::MAX);
    if token_count > MAX_SOURCE_MAP_TOKENS_PER_MAP {
        return Err(format!(
            "Source map exceeds the {MAX_SOURCE_MAP_TOKENS_PER_MAP}-token per-map limit."
        ));
    }
    let source_count = usize::try_from(map.get_source_count()).unwrap_or(usize::MAX);
    if source_count > MAX_SOURCE_MAP_SOURCES {
        return Err(format!(
            "Source map exceeds the {MAX_SOURCE_MAP_SOURCES}-source limit."
        ));
    }
    let mut referenced_source_ids = HashSet::new();
    for token in map.tokens() {
        if token.get_src_line() == u32::MAX
            || token.get_src_col() == u32::MAX
            || token.get_dst_line() == u32::MAX
            || token.get_dst_col() == u32::MAX
        {
            return Err("Source map contains an out-of-range coordinate.".to_string());
        }
        if token.get_src_id() != u32::MAX {
            referenced_source_ids.insert(token.get_src_id());
        }
    }
    if referenced_source_ids.len() > MAX_SOURCE_AUTHORITIES_PER_MAP {
        return Err(format!(
            "Source map exceeds the {MAX_SOURCE_AUTHORITIES_PER_MAP}-source-authority per-map limit."
        ));
    }
    let mut source_paths = Vec::with_capacity(source_count);
    let mut source_ids_by_path: HashMap<PathBuf, Vec<u32>> = HashMap::new();
    for source_id in 0..map.get_source_count() {
        let resolved = if referenced_source_ids.contains(&source_id) {
            Some(
                map.get_source(source_id)
                    .ok_or_else(|| "Source map contains a missing source.".to_string())
                    .and_then(|source| retain_source_path(loader, source_base, source))
                    .map_err(|_| {
                        "Source map references a source that is not an existing file inside the workspace."
                            .to_string()
                    })?,
            )
        } else {
            None
        };
        if let Some(authority) = &resolved {
            source_ids_by_path
                .entry(authority.display_path.clone())
                .or_default()
                .push(source_id);
        }
        source_paths.push(resolved);
    }
    if source_ids_by_path.is_empty() {
        return Err("Source map does not reference a source inside the workspace.".to_string());
    }
    let mut reverse: HashMap<(u32, u32), Vec<ReverseSegment>> = HashMap::new();
    let mut line_starts = HashMap::new();
    for token in map.tokens() {
        let source_id = token.get_src_id();
        if source_id == u32::MAX
            || source_paths
                .get(source_id as usize)
                .and_then(Option::as_ref)
                .is_none()
        {
            continue;
        }
        let generated_line = token.get_dst_line();
        let generated_column = token.get_dst_col();
        line_starts.entry(generated_line).or_insert((
            generated_column,
            source_id,
            token.get_src_line(),
            token.get_src_col(),
        ));
        reverse
            .entry((source_id, token.get_src_line()))
            .or_default()
            .push(ReverseSegment {
                source_column: token.get_src_col(),
                generated_line,
                generated_column,
            });
    }
    for segments in reverse.values_mut() {
        segments.sort_unstable_by_key(|segment| {
            (
                segment.source_column,
                segment.generated_line,
                segment.generated_column,
            )
        });
    }
    Ok(PreparedSourceMap {
        line_starts,
        identity,
        completion,
        map,
        reverse,
        source_ids_by_path,
        source_paths,
        source_authority_count: referenced_source_ids.len(),
        token_count,
    })
}

fn map_generated_entry(
    loader: &SourceMapLoader,
    entry: &RegisteredSourceMap,
    line_number: u32,
    column: u32,
) -> Option<MappedSourceCandidate> {
    let token = entry.map.lookup_token(line_number, column);
    let exact = token
        .filter(|token| token.get_dst_line() == line_number)
        .map(|token| {
            (
                token.get_src_id(),
                token.get_src_line(),
                token.get_src_col(),
            )
        });
    let (source_id, source_line, source_column) = exact.or_else(|| {
        entry
            .line_starts
            .get(&line_number)
            .filter(|(generated_column, _, _, _)| column == 0 && *generated_column > 0)
            .map(|(_, source_id, source_line, source_column)| {
                (*source_id, *source_line, *source_column)
            })
    })?;
    let authority = entry
        .source_paths
        .get(source_id as usize)?
        .as_ref()?
        .clone();
    Some(MappedSourceCandidate {
        authority,
        line_number: source_line.checked_add(1)?,
        column: source_column.checked_add(1)?,
        loader: loader.clone(),
        receipt: SourceMapReceipt {
            dispatch_state: Arc::clone(&entry.dispatch_state),
            identity: Arc::clone(&entry.identity),
        },
    })
}

impl MappedSourceCandidate {
    pub(crate) fn validate(self) -> Option<MappedSourceLocation> {
        self.validate_with_receipt()
            .map(|validated| validated.location)
    }

    pub(crate) fn validate_with_receipt(self) -> Option<ValidatedMappedSource> {
        self.loader
            .validate_source_authority(&self.authority)
            .then(|| ValidatedMappedSource {
                receipt: self.receipt,
                location: MappedSourceLocation {
                    file_path: self.authority.display_path.to_string_lossy().to_string(),
                    line_number: self.line_number,
                    column: self.column,
                },
            })
    }
}

impl MappedGeneratedCandidate {
    #[cfg(test)]
    pub(crate) fn validate(self) -> Option<MappedGeneratedLocation> {
        self.validate_with_receipt()
            .map(|validated| validated.location)
    }

    pub(crate) fn validate_with_receipt(self) -> Option<ValidatedMappedGenerated> {
        self.loader
            .validate_source_authority(&self.authority)
            .then_some(ValidatedMappedGenerated {
                location: self.location,
                receipt: self.receipt,
            })
    }
}

fn retain_source_path(
    loader: &SourceMapLoader,
    source_base: &Path,
    source: &str,
) -> Result<RetainedSourcePath, String> {
    let raw_path = path_from_file_url(source)
        .map(PathBuf::from)
        .unwrap_or_else(|| source_base.join(source));
    loader.retain_existing_workspace_file(&raw_path)
}

fn read_bounded(reader: &mut File, limit: usize) -> io::Result<Vec<u8>> {
    let metadata = reader.metadata()?;
    if metadata.len() > limit as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "source map exceeds the byte limit",
        ));
    }
    let mut bytes = Vec::with_capacity((metadata.len() as usize).min(limit));
    reader.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "source map exceeds the byte limit",
        ));
    }
    Ok(bytes)
}

fn normalize_absolute_path(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    normalized.is_absolute().then_some(normalized)
}

fn validate_identity_component(value: &str, limit: usize, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > limit
        || value.chars().any(|character| character.is_control())
    {
        return Err(format!(
            "Source-map {label} is invalid or exceeds its limit."
        ));
    }
    Ok(())
}

fn truncate_utf8(value: &str, maximum_bytes: usize) -> (&str, bool) {
    if value.len() <= maximum_bytes {
        return (value, false);
    }
    let mut boundary = maximum_bytes.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    (&value[..boundary], true)
}

fn inline_base64_payload(url: &str) -> Option<&str> {
    let (metadata, payload) = url.split_once(',')?;
    (metadata.starts_with("data:application/json") && metadata.ends_with(";base64"))
        .then_some(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_support::file_url_from_path;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn same_url_scripts_retain_exact_a_b_a_mapping_by_script_identity() {
        let root = fixture("same-url-identity");
        let generated = root.join("dist/app.js");
        let source_a = root.join("src/a.ts");
        let source_b = root.join("src/b.ts");
        let source_c = root.join("src/c.ts");
        write(&generated, "compiled();\n");
        for source in [&source_a, &source_b, &source_c] {
            write(source, "source();\n");
        }
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let loader_registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = loader_registry.loader();
        let mut registry = loader_registry;

        for (script_id, source) in [("A", "a.ts"), ("B", "b.ts"), ("C", "c.ts")] {
            let map = root.join(format!("dist/{script_id}.map"));
            write(
                &map,
                &format!(
                    r#"{{"version":3,"file":"app.js","sources":["../src/{source}"],"names":[],"mappings":"AAAA"}}"#
                ),
            );
            let prepared = loader
                .prepare_script(
                    script_id,
                    &generated_url,
                    &file_url_from_path(&map.to_string_lossy()),
                )
                .expect("prepare exact script");
            registry
                .commit_script(prepared)
                .expect("commit exact script");
        }

        for (script_id, expected) in [("A", source_a), ("B", source_b), ("C", source_c)] {
            assert_eq!(
                registry
                    .map_generated_for_script(script_id, &generated_url, 0, 0)
                    .expect("exact old script mapping")
                    .file_path,
                expected.to_string_lossy()
            );
        }
    }

    include!("debug_source_map_smart_step_tests.rs");

    #[test]
    fn pending_receipts_are_bounded_and_rejection_is_immediately_settled() {
        let root = fixture("pending-cap");
        let generated = root.join("dist/app.js");
        write(&generated, "compiled();\n");
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        let mut admitted = Vec::new();
        for index in 0..MAX_PENDING_SOURCE_MAPS {
            let request = loader
                .reserve_script(
                    &format!("script-{index}"),
                    &generated_url,
                    "data:application/json;base64,e30=",
                )
                .expect("bounded reservation");
            let settlement = request.settlement();
            registry
                .mark_pending(settlement.clone())
                .expect("pending slot");
            admitted.push(settlement);
        }
        let overflow = loader
            .reserve_script(
                "overflow",
                &generated_url,
                "data:application/json;base64,e30=",
            )
            .expect("overflow reservation");
        let overflow_settlement = overflow.settlement();
        assert!(registry
            .mark_pending(overflow_settlement.clone())
            .expect_err("pending cap")
            .contains("pending-map limit"));
        assert!(overflow_settlement.wait_until(Instant::now()));
        assert!(admitted
            .iter()
            .all(|settlement| !settlement.wait_until(Instant::now())));
    }

    #[test]
    fn stale_generation_and_foreign_transport_results_fail_closed() {
        let first_root = fixture("generation-first");
        let second_root = fixture("generation-second");
        let generated = first_root.join("dist/app.js");
        let source_a = first_root.join("src/a.ts");
        let source_b = first_root.join("src/b.ts");
        let map_a = first_root.join("dist/a.map");
        let map_b = first_root.join("dist/b.map");
        write(&generated, "compiled();\n");
        write(&source_a, "a();\n");
        write(&source_b, "b();\n");
        write(
            &map_a,
            r#"{"version":3,"file":"app.js","sources":["../src/a.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        write(
            &map_b,
            r#"{"version":3,"file":"app.js","sources":["../src/b.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut first = SourceMapRegistry::new(&first_root).expect("first registry");
        let loader = first.loader();
        let older = loader
            .prepare_script(
                "same-script",
                &generated_url,
                &file_url_from_path(&map_a.to_string_lossy()),
            )
            .expect("older");
        let newer = loader
            .prepare_script(
                "same-script",
                &generated_url,
                &file_url_from_path(&map_b.to_string_lossy()),
            )
            .expect("newer");
        first.commit_script(newer).expect("commit newer");
        assert!(first
            .commit_script(older)
            .expect_err("reordered result")
            .contains("stale script generation"));
        assert_eq!(
            first
                .map_generated_for_script("same-script", &generated_url, 0, 0)
                .expect("new mapping retained")
                .file_path,
            source_b.to_string_lossy()
        );

        let mut second = SourceMapRegistry::new(&second_root).expect("second registry");
        let foreign = loader
            .prepare_script(
                "foreign",
                &generated_url,
                &file_url_from_path(&map_a.to_string_lossy()),
            )
            .expect("foreign prepared result");
        assert_eq!(
            second.commit_script(foreign),
            Err("Source-map result belongs to a stale debugger transport.".to_string())
        );
    }

    #[test]
    fn invalid_different_url_replacement_removes_old_script_and_fences_delayed_work() {
        let root = fixture("different-url-failure");
        let generated_a = root.join("dist/a.js");
        let generated_b = root.join("dist/b.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.map");
        write(&generated_a, "a();\n");
        write(&generated_b, "b();\n");
        write(&source, "source();\n");
        write(
            &map,
            r#"{"version":3,"file":"a.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let url_a = file_url_from_path(&generated_a.to_string_lossy());
        let url_b = file_url_from_path(&generated_b.to_string_lossy());
        let map_url = file_url_from_path(&map.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        registry
            .commit_script(
                loader
                    .prepare_script("script", &url_a, &map_url)
                    .expect("initial"),
            )
            .expect("initial commit");
        let delayed = loader
            .prepare_script("script", &url_a, &map_url)
            .expect("delayed old result");

        registry.evict_exact_script("script", &url_b);

        assert!(registry
            .map_generated_for_script("script", &url_a, 0, 0)
            .is_none());
        assert!(registry.map_original_line(&source, 1).is_none());
        assert!(registry
            .commit_script(delayed)
            .expect_err("delayed generation")
            .contains("stale script generation"));
    }

    include!("debug_cdp/tests/debug_source_map_registry_forward_lookup_tests.rs");

    #[test]
    fn rejects_oversized_external_and_inline_maps_before_parsing() {
        let root = fixture("byte-limits");
        let generated = root.join("dist/app.js");
        let external = root.join("dist/app.js.map");
        write(&generated, "compiled();\n");
        fs::write(&external, vec![b'x'; MAX_SOURCE_MAP_BYTES + 1]).expect("oversized map");
        let registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        let generated_url = file_url_from_path(&generated.to_string_lossy());

        let external_error = loader
            .prepare_script(
                "external",
                &generated_url,
                &file_url_from_path(&external.to_string_lossy()),
            )
            .err()
            .expect("external cap");
        assert!(external_error.contains("limit"));

        let inline = format!(
            "data:application/json;base64,{}",
            STANDARD.encode(vec![b'x'; MAX_SOURCE_MAP_BYTES + 1])
        );
        let inline_error = loader
            .prepare_script("inline", &generated_url, &inline)
            .err()
            .expect("inline cap");
        assert!(inline_error.contains("limit"));
    }

    #[test]
    fn map_and_token_storms_fail_closed_without_evicting_admitted_maps() {
        let root = fixture("admission-limits");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.js.map");
        write(&generated, "compiled();\n");
        write(&source, "source();\n");
        write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&map.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        for index in 0..MAX_SOURCE_MAPS {
            registry
                .commit_script(
                    loader
                        .prepare_script(&format!("script-{index}"), &generated_url, &map_url)
                        .expect("prepared map"),
                )
                .expect("admitted map");
        }
        let overflow = loader
            .prepare_script("overflow", &generated_url, &map_url)
            .expect("prepared overflow");
        assert!(registry
            .commit_script(overflow)
            .expect_err("map cap")
            .contains("map limit"));
        assert!(registry
            .map_generated_for_script("script-0", &generated_url, 0, 0)
            .is_some());

        registry.evict_exact_script("script-255", &generated_url);
        registry.token_count = MAX_SOURCE_MAP_TOKENS_TOTAL;
        let token_overflow = loader
            .prepare_script("token-overflow", &generated_url, &map_url)
            .expect("prepared token overflow");
        assert!(registry
            .commit_script(token_overflow)
            .expect_err("token cap")
            .contains("token limit"));
    }

    #[test]
    fn tombstones_are_bounded_and_mapless_unknown_scripts_retain_nothing() {
        let root = fixture("tombstone-bound");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.map");
        write(&generated, "compiled();\n");
        write(&source, "source();\n");
        write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&map.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        for index in 0..(MAX_SOURCE_MAP_TOMBSTONES + 32) {
            let script_id = format!("script-{index}");
            registry
                .commit_script(
                    registry
                        .loader()
                        .prepare_script(&script_id, &generated_url, &map_url)
                        .expect("prepare"),
                )
                .expect("commit");
            registry.evict_exact_script(&script_id, &generated_url);
        }
        assert!(registry.settled_generations.len() <= MAX_SOURCE_MAP_TOMBSTONES);
        assert!(registry.stale_generation_floor > 0);

        for index in 0..1_000 {
            registry.evict_exact_script(&format!("unknown-{index}"), &generated_url);
        }
        assert!(registry.settled_generations.len() <= MAX_SOURCE_MAP_TOMBSTONES);
        let retained = registry.settled_generations.len();
        registry.evict_exact_script(&"x".repeat(MAX_SCRIPT_ID_BYTES + 1), &generated_url);
        assert_eq!(registry.settled_generations.len(), retained);
    }

    #[test]
    fn rejects_a_single_map_that_exceeds_the_token_limit() {
        let root = fixture("per-map-token-limit");
        let source = root.join("src/app.ts");
        write(&source, "source();\n");
        let loader = SourceMapRegistry::new(&root).expect("registry").loader();
        let mut builder = sourcemap::SourceMapBuilder::new(Some("app.js"));
        for line in 0..=MAX_SOURCE_MAP_TOKENS_PER_MAP as u32 {
            builder.add(line, 0, 0, 0, Some("../src/app.ts"), None, false);
        }
        let error = prepare_index(
            &loader,
            SourceMapScriptIdentity {
                transport_id: loader.inner.transport_id,
                generation: 1,
                script_id: "token-storm".to_string(),
                generated_url: file_url_from_path(&root.join("dist/app.js").to_string_lossy()),
            },
            Arc::new(SourceMapCompletion::new()),
            builder.into_sourcemap(),
            &root.join("dist"),
        )
        .err()
        .expect("per-map token cap");

        assert!(error.contains("per-map limit"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_map_and_replaced_workspace_authority_are_rejected() {
        use std::os::unix::fs::symlink;
        let sandbox = fixture("path-authority");
        let root = sandbox.join("workspace");
        let replacement = sandbox.join("replacement");
        let outside = sandbox.join("outside.map");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let linked_map = root.join("dist/app.js.map");
        write(&generated, "compiled();\n");
        write(&source, "source();\n");
        write(
            &outside,
            r#"{"version":3,"file":"app.js","sources":["src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        symlink(&outside, &linked_map).expect("map symlink");
        let registry = SourceMapRegistry::new(&root).expect("registry");
        let loader = registry.loader();
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        assert!(loader
            .prepare_script(
                "symlink",
                &generated_url,
                &file_url_from_path(&linked_map.to_string_lossy()),
            )
            .err()
            .expect("nofollow map")
            .contains("retained workspace authority"));

        fs::rename(&root, &replacement).expect("retain old directory elsewhere");
        fs::create_dir_all(&root).expect("replacement namespace");
        assert_eq!(
            loader
                .prepare_script("replaced", &generated_url, "app.js.map")
                .err()
                .expect("root identity"),
            "Debugger workspace authority changed."
        );
    }

    #[cfg(unix)]
    #[test]
    fn registered_forward_mapping_rejects_replaced_root_and_source_leaf() {
        let root = fixture("post-register-authority");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.map");
        write(&generated, "compiled();\n");
        write(&source, "original();\n");
        write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        registry
            .commit_script(
                registry
                    .loader()
                    .prepare_script(
                        "script",
                        &generated_url,
                        &file_url_from_path(&map.to_string_lossy()),
                    )
                    .expect("prepared"),
            )
            .expect("commit");
        fs::remove_file(&source).expect("remove retained source path");
        write(&source, "replacement();\n");
        assert!(registry
            .map_generated_for_script("script", &generated_url, 0, 0)
            .is_none());

        let moved = root.with_extension("moved");
        fs::rename(&root, &moved).expect("move retained root");
        fs::create_dir_all(root.join("src")).expect("replacement root");
        assert!(registry
            .map_generated_for_script("script", &generated_url, 0, 0)
            .is_none());
    }

    #[test]
    fn preparation_can_complete_while_registry_commit_lock_is_held() {
        let root = fixture("prepare-outside-lock");
        let generated = root.join("dist/app.js");
        let source = root.join("src/app.ts");
        let map = root.join("dist/app.js.map");
        write(&generated, "compiled();\n");
        write(&source, "source();\n");
        write(
            &map,
            r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#,
        );
        let registry = Arc::new(std::sync::Mutex::new(
            SourceMapRegistry::new(&root).expect("registry"),
        ));
        let loader = registry.lock().expect("registry lock").loader();
        let generated_url = file_url_from_path(&generated.to_string_lossy());
        let map_url = file_url_from_path(&map.to_string_lossy());
        let held = registry.lock().expect("held commit lock");
        let (tx, rx) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            tx.send(loader.prepare_script("script", &generated_url, &map_url))
                .expect("send prepared");
        });

        assert!(rx
            .recv_timeout(Duration::from_secs(1))
            .expect("preparation must not need registry lock")
            .is_ok());
        drop(held);
    }

    #[test]
    fn failure_diagnostics_are_bounded_and_report_suppression_once() {
        let root = fixture("diagnostic-budget");
        let mut registry = SourceMapRegistry::new(&root).expect("registry");
        for _ in 0..MAX_SOURCE_MAP_DIAGNOSTICS {
            assert!(registry.source_map_diagnostic("bad map").is_some());
        }
        assert_eq!(
            registry
                .source_map_diagnostic("overflow")
                .expect("suppression diagnostic"),
            format!("[debugger] {SOURCE_MAP_DIAGNOSTICS_SUPPRESSED}\n")
        );
        assert!(registry.source_map_diagnostic("more").is_none());

        let mut bounded = SourceMapRegistry::new(&root).expect("bounded registry");
        let diagnostic = bounded
            .source_map_diagnostic(&"é".repeat(MAX_SOURCE_MAP_DIAGNOSTIC_BYTES))
            .expect("bounded diagnostic");
        assert!(diagnostic.len() <= MAX_SOURCE_MAP_DIAGNOSTIC_BYTES + "…".len());
        assert!(diagnostic.ends_with("…\n"));
    }

    #[test]
    fn rejects_unrepresentable_one_based_coordinates() {
        let root = fixture("coordinate-bound");
        let source = root.join("src/app.ts");
        write(&source, "source();\n");
        let loader = SourceMapRegistry::new(&root).expect("registry").loader();
        let mut builder = sourcemap::SourceMapBuilder::new(Some("app.js"));
        builder.add(u32::MAX, 0, 0, 0, Some("../src/app.ts"), None, false);
        let error = prepare_index(
            &loader,
            SourceMapScriptIdentity {
                transport_id: loader.inner.transport_id,
                generation: 1,
                script_id: "boundary".to_string(),
                generated_url: file_url_from_path(&root.join("dist/app.js").to_string_lossy()),
            },
            Arc::new(SourceMapCompletion::new()),
            builder.into_sourcemap(),
            &root.join("dist"),
        )
        .err()
        .expect("coordinate rejection");
        assert!(error.contains("out-of-range coordinate"));
    }

    fn fixture(name: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let root = std::env::temp_dir().join(format!(
            "codevo-source-map-registry-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("fixture root");
        root.canonicalize().expect("canonical fixture")
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent");
        }
        fs::write(path, content).expect("fixture write");
    }
}
