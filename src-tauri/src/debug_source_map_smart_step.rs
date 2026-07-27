use super::{
    map_generated_entry, SourceMapDispatchState, SourceMapReceipt, SourceMapRegistry,
    SourceMapScriptIdentity,
};
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub(crate) enum GeneratedSourceMapClassification {
    Mapped,
    LoadedButUnmapped(SourceMapReceipt),
    Pending,
    Failed,
    Plain,
    Unknown,
}

pub(crate) struct SourceMapDispatchLease {
    dispatch_state: Option<Arc<SourceMapDispatchState>>,
    identity: Arc<SourceMapScriptIdentity>,
}

impl SourceMapDispatchLease {
    fn release_pin(&mut self) {
        if let Some(state) = self.dispatch_state.take() {
            state.pins.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

impl Drop for SourceMapDispatchLease {
    fn drop(&mut self) {
        self.release_pin();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SettledScriptKind {
    Failed,
    Plain,
}

pub(super) struct SettledScriptOutcome {
    pub(super) generated_url: String,
    pub(super) generation: u64,
    pub(super) kind: SettledScriptKind,
}

impl SourceMapRegistry {
    pub(crate) fn with_smart_step_enabled(mut self, enabled: bool) -> Self {
        self.smart_step_enabled = enabled;
        self
    }

    pub(crate) fn smart_step_enabled(&self) -> bool {
        self.smart_step_enabled
    }

    pub(crate) fn pin_dispatch(
        &self,
        receipt: &SourceMapReceipt,
    ) -> Option<SourceMapDispatchLease> {
        if !self.is_current_receipt(receipt)
            || receipt
                .dispatch_state
                .pins
                .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return None;
        }
        if receipt.dispatch_state.superseded.load(Ordering::Acquire) {
            receipt.dispatch_state.pins.store(0, Ordering::Release);
            return None;
        }
        Some(SourceMapDispatchLease {
            dispatch_state: Some(Arc::clone(&receipt.dispatch_state)),
            identity: Arc::clone(&receipt.identity),
        })
    }

    pub(crate) fn dispatch_lease_is_current(&self, lease: &SourceMapDispatchLease) -> bool {
        let Some(state) = lease.dispatch_state.as_ref() else {
            return false;
        };
        !state.superseded.load(Ordering::Acquire)
            && self.maps.iter().any(|entry| {
                Arc::ptr_eq(&entry.identity, &lease.identity)
                    && Arc::ptr_eq(&entry.dispatch_state, state)
            })
    }

    pub(crate) fn release_dispatch(&mut self, mut lease: SourceMapDispatchLease) {
        let state = lease.dispatch_state.as_ref().map(Arc::clone);
        let identity = Arc::clone(&lease.identity);
        lease.release_pin();
        if state.is_some_and(|state| state.superseded.load(Ordering::Acquire)) {
            self.remove_exact_unpinned_map(&identity);
        }
    }

    pub(crate) fn is_current_receipt(&self, receipt: &SourceMapReceipt) -> bool {
        !receipt.dispatch_state.superseded.load(Ordering::Acquire)
            && receipt.identity.transport_id == self.loader.inner.transport_id
            && self.maps.iter().any(|entry| {
                (Arc::ptr_eq(&entry.identity, &receipt.identity)
                    || entry.identity.as_ref() == receipt.identity.as_ref())
                    && Arc::ptr_eq(&entry.dispatch_state, &receipt.dispatch_state)
            })
    }

    pub(super) fn prune_superseded_unpinned_maps(&mut self) {
        let mut removed_tokens = 0usize;
        let mut removed_authorities = 0usize;
        self.maps.retain(|entry| {
            let remove = entry.dispatch_state.superseded.load(Ordering::Acquire)
                && entry.dispatch_state.pins.load(Ordering::Acquire) == 0;
            if remove {
                removed_tokens = removed_tokens.saturating_add(entry.token_count);
                removed_authorities =
                    removed_authorities.saturating_add(entry.source_authority_count);
            }
            !remove
        });
        self.token_count = self.token_count.saturating_sub(removed_tokens);
        self.source_authority_count = self
            .source_authority_count
            .saturating_sub(removed_authorities);
    }

    fn remove_exact_unpinned_map(&mut self, identity: &Arc<SourceMapScriptIdentity>) {
        let mut removed_tokens = 0usize;
        let mut removed_authorities = 0usize;
        self.maps.retain(|entry| {
            let remove = Arc::ptr_eq(&entry.identity, identity)
                && entry.dispatch_state.pins.load(Ordering::Acquire) == 0;
            if remove {
                removed_tokens = removed_tokens.saturating_add(entry.token_count);
                removed_authorities =
                    removed_authorities.saturating_add(entry.source_authority_count);
            }
            !remove
        });
        self.token_count = self.token_count.saturating_sub(removed_tokens);
        self.source_authority_count = self
            .source_authority_count
            .saturating_sub(removed_authorities);
    }

    pub(crate) fn mark_plain_script(&mut self, script_id: &str, generated_url: &str) {
        self.record_unmapped_script(script_id, generated_url, SettledScriptKind::Plain);
    }

    pub(crate) fn mark_failed_script(&mut self, script_id: &str, generated_url: &str) {
        self.record_unmapped_script(script_id, generated_url, SettledScriptKind::Failed);
    }

    fn record_unmapped_script(
        &mut self,
        script_id: &str,
        generated_url: &str,
        kind: SettledScriptKind,
    ) {
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
        self.remove_script(script_id);
        if let Some(pending) = self.pending.remove(script_id) {
            pending.complete();
        }
        self.settled_outcomes.insert(
            script_id.to_string(),
            SettledScriptOutcome {
                generated_url: generated_url.to_string(),
                generation,
                kind,
            },
        );
    }

    /// Classifies one exact CDP script/location without guessing across reused URLs.
    ///
    /// Only `LoadedButUnmapped` carries an exact current-map receipt suitable for
    /// smart-step. Every uncertain or unsettled state remains separately visible
    /// so callers can fail closed.
    pub(crate) fn classify_generated_for_script(
        &self,
        script_id: &str,
        generated_url: &str,
        line_number: u32,
        column: u32,
    ) -> GeneratedSourceMapClassification {
        let Some(entry) = self.maps.iter().rev().find(|entry| {
            !entry.dispatch_state.superseded.load(Ordering::Acquire)
                && entry.identity.script_id == script_id
                && entry.identity.generated_url == generated_url
                && entry.identity.transport_id == self.loader.inner.transport_id
        }) else {
            if self.pending.get(script_id).is_some_and(|pending| {
                pending.identity.generated_url == generated_url
                    && pending.identity.transport_id == self.loader.inner.transport_id
            }) {
                return GeneratedSourceMapClassification::Pending;
            }
            return match self.settled_outcomes.get(script_id) {
                Some(outcome)
                    if outcome.generated_url == generated_url
                        && self
                            .settled_generations
                            .get(script_id)
                            .is_some_and(|generation| *generation == outcome.generation) =>
                {
                    match outcome.kind {
                        SettledScriptKind::Failed => GeneratedSourceMapClassification::Failed,
                        SettledScriptKind::Plain => GeneratedSourceMapClassification::Plain,
                    }
                }
                _ => GeneratedSourceMapClassification::Unknown,
            };
        };
        let receipt = SourceMapReceipt {
            dispatch_state: Arc::clone(&entry.dispatch_state),
            identity: Arc::clone(&entry.identity),
        };
        if map_generated_entry(&self.loader, entry, line_number, column).is_some() {
            GeneratedSourceMapClassification::Mapped
        } else {
            GeneratedSourceMapClassification::LoadedButUnmapped(receipt)
        }
    }
}
