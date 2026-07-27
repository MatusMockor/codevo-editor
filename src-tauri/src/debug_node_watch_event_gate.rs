use crate::debug_adapter::{
    DebugEventEmitter, DebugEventPayload, DebugFunctionBreakpointVerification,
};
use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Arc, Mutex, MutexGuard};

const MAX_STAGED_EVENTS: usize = 256;
const MAX_STAGED_EVENT_BYTES: usize = 1024 * 1024;
const MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES: usize = 32 * 1024;
const RESERVED_DELIVERY_EVENTS: usize = 3;
const RESERVED_DELIVERY_BYTES: usize = RESERVED_DELIVERY_EVENTS * MAX_STAGED_EVENT_BYTES;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchEventDisposition {
    Delivered,
    Buffered,
    DroppedOverflow,
    DroppedLifecycle,
    DroppedStale,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchTransportEnd {
    Cancelled,
    Terminated,
}

#[derive(Clone)]
pub(crate) struct WatchEventGenerationLease {
    authority: Arc<GenerationAuthority>,
    generation: u64,
}

pub(crate) struct WatchEventPublicationLease {
    generation_authority: Arc<GenerationAuthority>,
    publication_authority: Arc<PublicationAuthority>,
    generation: u64,
}

pub(crate) struct WatchEventFlushLease {
    generation_authority: Arc<GenerationAuthority>,
    publication_authority: Arc<PublicationAuthority>,
    generation: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct WatchStartupFunctionBreakpointAuthority<'a> {
    pub(crate) desired_revision: u64,
    pub(crate) function_generation: u64,
    pub(crate) ordered_ids: &'a [String],
}

/// Single logical-session termination capability for one watch event gate.
///
/// The capability is intentionally opaque: transports can revoke their own
/// generations, but only the supervisor-owned finish path may seal the whole
/// logical session before the registry emits `Terminated`.
pub(crate) struct WatchLogicalFinishGate {
    gate: Arc<WatchDebugEventGate>,
    authority: Arc<LogicalFinishAuthority>,
}

struct GenerationAuthority;
struct PublicationAuthority;
struct LogicalFinishAuthority;

struct StagedEvents {
    authority: Arc<PublicationAuthority>,
    events: Vec<(DebugEventPayload, usize)>,
    serialized_bytes: usize,
    overflowed: bool,
}

enum PublicationState {
    Unpublished,
    Buffering(StagedEvents),
    Sealed(StagedEvents),
    Published,
}

struct ActiveGeneration {
    authority: Arc<GenerationAuthority>,
    generation: u64,
    paused: bool,
    startup_function_breakpoint_receipt_required: bool,
    startup_function_breakpoint_receipt: Option<StartupFunctionBreakpointReceipt>,
    publication: PublicationState,
}

struct StartupFunctionBreakpointReceipt {
    target_generation: u64,
    desired_revision: u64,
    function_generation: u64,
    payload: DebugEventPayload,
    serialized_bytes: usize,
    early_updates: Vec<(DebugEventPayload, usize)>,
}

struct WatchEventGateState {
    active: Option<ActiveGeneration>,
    next_generation: u64,
    started: bool,
    replacement_needs_resume: bool,
    terminal_sealed: bool,
}

struct WatchEventDelivery {
    queued: VecDeque<(DebugEventPayload, usize)>,
    queued_bytes: usize,
    reserved_events: usize,
    reserved_bytes: usize,
    in_flight: bool,
    draining: bool,
    terminal_sealed: bool,
}

/// Serializes events from replaceable watch transports into one logical debug
/// session. The wrapped emitter remains the sole owner of root, session and
/// global event sequence identity.
pub(crate) struct WatchDebugEventGate {
    emitter: DebugEventEmitter,
    operation: Mutex<()>,
    state: Mutex<WatchEventGateState>,
    delivery: Mutex<WatchEventDelivery>,
    logical_finish_authority: Arc<LogicalFinishAuthority>,
}

impl WatchDebugEventGate {
    pub(crate) fn new(emitter: DebugEventEmitter) -> Self {
        Self {
            emitter,
            operation: Mutex::new(()),
            state: Mutex::new(WatchEventGateState {
                active: None,
                next_generation: 1,
                started: false,
                replacement_needs_resume: false,
                terminal_sealed: false,
            }),
            delivery: Mutex::new(WatchEventDelivery {
                queued: VecDeque::new(),
                queued_bytes: 0,
                reserved_events: 0,
                reserved_bytes: 0,
                in_flight: false,
                draining: false,
                terminal_sealed: false,
            }),
            logical_finish_authority: Arc::new(LogicalFinishAuthority),
        }
    }

    pub(crate) fn logical_finish_gate(self: &Arc<Self>) -> WatchLogicalFinishGate {
        WatchLogicalFinishGate {
            gate: Arc::clone(self),
            authority: Arc::clone(&self.logical_finish_authority),
        }
    }

    pub(crate) fn activate_initial(&self) -> Option<WatchEventGenerationLease> {
        self.prepare_initial().inspect(|lease| {
            let _ = self.publish(lease);
        })
    }

    pub(crate) fn prepare_initial(&self) -> Option<WatchEventGenerationLease> {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        if state.started || state.terminal_sealed {
            return None;
        }
        state.started = true;
        Some(activate(&mut state, false))
    }

    /// Replaces the exact active generation. A paused transport contributes one
    /// `Resumed` event to invalidate its obsolete pause inventory; a running
    /// transport contributes no synthetic transition.
    pub(crate) fn replace(
        &self,
        lease: &WatchEventGenerationLease,
    ) -> Option<WatchEventGenerationLease> {
        let operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let active = state.active.as_ref()?;
        if !owns(active, lease) {
            return None;
        }
        let invalidate_pause = active.paused;
        let reservation = active_reservation(active);
        let Some(next) = state.next_generation.checked_add(1) else {
            if let Some((events, bytes)) = reservation {
                self.release_delivery_reservation(events, bytes);
            }
            state.active = None;
            return None;
        };
        let drain = if invalidate_pause {
            self.enqueue_delivery(DebugEventPayload::Resumed, true)?
        } else {
            false
        };
        state.next_generation = next;
        if let Some((events, bytes)) = reservation {
            self.release_delivery_reservation(events, bytes);
        }
        let replacement = activate(&mut state, true);
        drop(state);
        drop(operation);
        self.drain_if_owner(drain);
        Some(replacement)
    }

    pub(crate) fn prepare_replacement(&self) -> Option<WatchEventGenerationLease> {
        let operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        if !state.started || state.active.is_some() || state.terminal_sealed {
            return None;
        }
        let next = state.next_generation.checked_add(1)?;
        let resume = state.replacement_needs_resume;
        let drain = if resume {
            self.enqueue_delivery(DebugEventPayload::Resumed, true)?
        } else {
            false
        };
        state.next_generation = next;
        state.replacement_needs_resume = false;
        let lease = activate(&mut state, false);
        drop(state);
        drop(operation);
        self.drain_if_owner(drain);
        Some(lease)
    }

    pub(crate) fn publish(&self, lease: &WatchEventGenerationLease) -> bool {
        let Some(publication) = self.begin_publish(lease) else {
            return false;
        };
        let Some(flush) = self.seal_publish(&publication) else {
            return false;
        };
        self.flush_publish(&flush)
    }

    /// Retains the exact full ordered generation-1 verification before the
    /// target becomes visible. Generic CDP events remain rejected while the
    /// generation is unpublished, so a late-binding partial cannot overtake
    /// this receipt.
    pub(crate) fn retain_startup_function_breakpoint_receipt(
        &self,
        lease: &WatchEventGenerationLease,
        target_generation: u64,
        desired_revision: u64,
        function_generation: u64,
        ordered_ids: &[String],
        breakpoints: Vec<DebugFunctionBreakpointVerification>,
    ) -> bool {
        if target_generation != 1
            || function_generation != 1
            || lease.generation != target_generation
            || breakpoints.len() != ordered_ids.len()
            || !breakpoints
                .iter()
                .zip(ordered_ids)
                .all(|(verification, expected)| verification.id == *expected)
        {
            return false;
        }
        let payload = DebugEventPayload::FunctionBreakpointsVerified {
            generation: function_generation,
            breakpoints,
        };
        let Some(serialized_bytes) =
            serialized_size_within(&payload, MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES)
        else {
            return false;
        };
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if !owns(active, lease)
            || !matches!(&active.publication, PublicationState::Unpublished)
            || active.startup_function_breakpoint_receipt.is_some()
        {
            return false;
        }
        active.startup_function_breakpoint_receipt = Some(StartupFunctionBreakpointReceipt {
            target_generation,
            desired_revision,
            function_generation,
            payload,
            serialized_bytes,
            early_updates: Vec::new(),
        });
        active.startup_function_breakpoint_receipt_required = true;
        true
    }

    /// Atomically replaces the retained generation-1 receipt after the desired
    /// function-breakpoint authority changes during pre-publication
    /// reconciliation. The expected tuple is a compare-and-swap guard: a late
    /// reconciler cannot overwrite a newer receipt. Partial updates retained
    /// under the old authority are deliberately discarded.
    pub(crate) fn replace_startup_function_breakpoint_receipt(
        &self,
        lease: &WatchEventGenerationLease,
        target_generation: u64,
        expected: WatchStartupFunctionBreakpointAuthority<'_>,
        replacement: WatchStartupFunctionBreakpointAuthority<'_>,
        breakpoints: Vec<DebugFunctionBreakpointVerification>,
    ) -> bool {
        if target_generation != 1
            || lease.generation != target_generation
            || replacement.desired_revision <= expected.desired_revision
            || replacement.function_generation <= expected.function_generation
            || breakpoints.len() != replacement.ordered_ids.len()
            || !breakpoints
                .iter()
                .zip(replacement.ordered_ids)
                .all(|(verification, expected)| verification.id == *expected)
        {
            return false;
        }
        let payload = DebugEventPayload::FunctionBreakpointsVerified {
            generation: replacement.function_generation,
            breakpoints,
        };
        let Some(serialized_bytes) =
            serialized_size_within(&payload, MAX_STARTUP_FUNCTION_BREAKPOINT_RECEIPT_BYTES)
        else {
            return false;
        };
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if !owns(active, lease)
            || !active.startup_function_breakpoint_receipt_required
            || !matches!(&active.publication, PublicationState::Unpublished)
        {
            return false;
        }
        let expected_receipt_matches = active
            .startup_function_breakpoint_receipt
            .as_ref()
            .is_some_and(|receipt| {
                receipt.target_generation == target_generation
                    && receipt.desired_revision == expected.desired_revision
                    && receipt.function_generation == expected.function_generation
                    && payload_has_exact_ordered_ids(&receipt.payload, expected.ordered_ids)
            });
        if !expected_receipt_matches {
            return false;
        }
        active.startup_function_breakpoint_receipt = Some(StartupFunctionBreakpointReceipt {
            target_generation,
            desired_revision: replacement.desired_revision,
            function_generation: replacement.function_generation,
            payload,
            serialized_bytes,
            early_updates: Vec::new(),
        });
        true
    }

    pub(crate) fn begin_publish_with_startup_function_breakpoint_receipt(
        &self,
        lease: &WatchEventGenerationLease,
        target_generation: u64,
        desired_revision: u64,
        function_generation: u64,
        ordered_ids: &[String],
    ) -> Option<WatchEventPublicationLease> {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let active = state.active.as_mut()?;
        if !owns(active, lease)
            || !active.startup_function_breakpoint_receipt_required
            || !matches!(&active.publication, PublicationState::Unpublished)
        {
            return None;
        }
        let receipt_matches = active
            .startup_function_breakpoint_receipt
            .as_ref()
            .is_some_and(|receipt| {
                receipt.target_generation == target_generation
                    && receipt.desired_revision == desired_revision
                    && receipt.function_generation == function_generation
                    && payload_has_exact_ordered_ids(&receipt.payload, ordered_ids)
            });
        if !receipt_matches {
            return None;
        };
        let receipt = active
            .startup_function_breakpoint_receipt
            .take()
            .expect("validated startup receipt");
        Some(begin_buffering(active, lease, Some(receipt)))
    }

    /// Starts an exact, bounded publication transaction. Transport events are
    /// retained in order but remain invisible until the matching commit.
    pub(crate) fn begin_publish(
        &self,
        lease: &WatchEventGenerationLease,
    ) -> Option<WatchEventPublicationLease> {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let active = state.active.as_mut()?;
        if !owns(active, lease)
            || active.startup_function_breakpoint_receipt_required
            || !matches!(&active.publication, PublicationState::Unpublished)
        {
            return None;
        }
        Some(begin_buffering(active, lease, None))
    }

    /// Seals an exact transaction without invoking the external emitter.
    pub(crate) fn seal_publish(
        &self,
        publication: &WatchEventPublicationLease,
    ) -> Option<WatchEventFlushLease> {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let active = state.active.as_mut()?;
        if !owns_publication(active, publication) {
            return None;
        }
        let PublicationState::Buffering(staged) =
            std::mem::replace(&mut active.publication, PublicationState::Unpublished)
        else {
            return None;
        };
        if staged.overflowed {
            return None;
        }
        let reserved_events = staged.events.len();
        let reserved_bytes = staged.serialized_bytes;
        if !self.reserve_delivery(reserved_events, reserved_bytes) {
            return None;
        }
        active.publication = PublicationState::Sealed(staged);
        Some(WatchEventFlushLease {
            generation_authority: Arc::clone(&publication.generation_authority),
            publication_authority: Arc::clone(&publication.publication_authority),
            generation: publication.generation,
        })
    }

    /// Flushes a sealed transaction in exact FIFO order. This is deliberately
    /// separate from sealing so callers can release unrelated locks before an
    /// external sink callback becomes possible.
    pub(crate) fn flush_publish(&self, flush: &WatchEventFlushLease) -> bool {
        let operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if !owns_flush(active, flush) {
            return false;
        }
        let PublicationState::Sealed(staged) =
            std::mem::replace(&mut active.publication, PublicationState::Unpublished)
        else {
            return false;
        };
        let pause_state = staged
            .events
            .iter()
            .filter_map(|(payload, _)| pause_state_after(payload))
            .next_back();
        let Some(drain) = self.enqueue_reserved_staged_delivery(staged) else {
            return false;
        };
        active.publication = PublicationState::Published;
        if let Some(paused) = pause_state {
            active.paused = paused;
        }
        drop(state);
        drop(operation);
        self.drain_if_owner(drain);
        true
    }

    /// Discards only the exact staged transaction without exposing an event.
    pub(crate) fn abort_publish(&self, publication: &WatchEventPublicationLease) -> bool {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if !owns_publication(active, publication) {
            return false;
        }
        active.publication = PublicationState::Unpublished;
        true
    }

    pub(crate) fn abort_flush(&self, flush: &WatchEventFlushLease) -> bool {
        let _operation = lock_recover(&self.operation);
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        if !owns_flush(active, flush) {
            return false;
        }
        let PublicationState::Sealed(staged) =
            std::mem::replace(&mut active.publication, PublicationState::Unpublished)
        else {
            return false;
        };
        self.release_delivery_reservation(staged.events.len(), staged.serialized_bytes);
        true
    }

    pub(crate) fn emit(
        &self,
        lease: &WatchEventGenerationLease,
        payload: DebugEventPayload,
    ) -> WatchEventDisposition {
        self.emit_with_accept(lease, payload, || {})
    }

    /// Runs `on_accept` while generation ownership is still held, before an
    /// emergency close can revoke this accepted event's authority.
    pub(crate) fn emit_with_accept(
        &self,
        lease: &WatchEventGenerationLease,
        payload: DebugEventPayload,
        on_accept: impl FnOnce(),
    ) -> WatchEventDisposition {
        let mut on_accept = Some(on_accept);
        let operation = lock_recover(&self.operation);
        if matches!(
            payload,
            DebugEventPayload::Started { .. } | DebugEventPayload::Terminated { .. }
        ) {
            return WatchEventDisposition::DroppedLifecycle;
        }
        let mut state = lock_recover(&self.state);
        let Some(active) = state.active.as_mut() else {
            return WatchEventDisposition::DroppedStale;
        };
        if !owns(active, lease) {
            return WatchEventDisposition::DroppedStale;
        }
        if matches!(&active.publication, PublicationState::Unpublished) {
            let Some(receipt) = active.startup_function_breakpoint_receipt.as_mut() else {
                return WatchEventDisposition::DroppedStale;
            };
            let DebugEventPayload::FunctionBreakpointsVerified {
                generation,
                breakpoints,
            } = &payload
            else {
                return WatchEventDisposition::DroppedStale;
            };
            if *generation != receipt.function_generation
                || breakpoints.is_empty()
                || breakpoints.iter().enumerate().any(|(index, verification)| {
                    !payload_contains_function_breakpoint_id(&receipt.payload, &verification.id)
                        || breakpoints[..index]
                            .iter()
                            .any(|previous| previous.id == verification.id)
                })
                || receipt.early_updates.len() + 1 >= MAX_STAGED_EVENTS
            {
                return WatchEventDisposition::DroppedStale;
            }
            let retained_bytes = receipt
                .early_updates
                .iter()
                .fold(receipt.serialized_bytes, |total, (_, bytes)| total + bytes);
            let remaining_bytes = MAX_STAGED_EVENT_BYTES.saturating_sub(retained_bytes);
            let Some(payload_bytes) = serialized_size_within(&payload, remaining_bytes) else {
                return WatchEventDisposition::DroppedOverflow;
            };
            receipt.early_updates.push((payload, payload_bytes));
            on_accept.take().expect("single acceptance callback")();
            return WatchEventDisposition::Buffered;
        }
        if matches!(&active.publication, PublicationState::Published) {
            let pause_state = pause_state_after(&payload);
            let Some(drain) = self.enqueue_delivery(payload, pause_state.is_some()) else {
                return WatchEventDisposition::DroppedOverflow;
            };
            if let Some(paused) = pause_state {
                active.paused = paused;
            }
            on_accept.take().expect("single acceptance callback")();
            drop(state);
            drop(operation);
            self.drain_if_owner(drain);
            return WatchEventDisposition::Delivered;
        }
        if let PublicationState::Sealed(staged) = &mut active.publication {
            if staged.events.len() >= MAX_STAGED_EVENTS {
                return WatchEventDisposition::DroppedOverflow;
            }
            let remaining_bytes = MAX_STAGED_EVENT_BYTES.saturating_sub(staged.serialized_bytes);
            let Some(payload_bytes) = serialized_size_within(&payload, remaining_bytes) else {
                return WatchEventDisposition::DroppedOverflow;
            };
            if !self.reserve_delivery(1, payload_bytes) {
                return WatchEventDisposition::DroppedOverflow;
            }
            staged.serialized_bytes += payload_bytes;
            staged.events.push((payload, payload_bytes));
            on_accept.take().expect("single acceptance callback")();
            return WatchEventDisposition::Buffered;
        }
        let PublicationState::Buffering(StagedEvents {
            events,
            serialized_bytes,
            overflowed,
            ..
        }) = &mut active.publication
        else {
            unreachable!("publication state handled above");
        };
        if *overflowed || events.len() >= MAX_STAGED_EVENTS {
            *overflowed = true;
            return WatchEventDisposition::DroppedOverflow;
        }
        let remaining_bytes = MAX_STAGED_EVENT_BYTES.saturating_sub(*serialized_bytes);
        let Some(payload_bytes) = serialized_size_within(&payload, remaining_bytes) else {
            *overflowed = true;
            return WatchEventDisposition::DroppedOverflow;
        };
        *serialized_bytes += payload_bytes;
        events.push((payload, payload_bytes));
        on_accept.take().expect("single acceptance callback")();
        WatchEventDisposition::Buffered
    }

    /// Revokes the exact generation before invoking transport shutdown.
    /// Logical-session termination remains owned by `DebugSessionRegistry`.
    pub(crate) fn end_before_transport_close<T>(
        &self,
        lease: &WatchEventGenerationLease,
        _end: WatchTransportEnd,
        close: impl FnOnce() -> T,
    ) -> Option<T> {
        {
            let _operation = lock_recover(&self.operation);
            let mut state = lock_recover(&self.state);
            if !state
                .active
                .as_ref()
                .is_some_and(|active| owns(active, lease))
            {
                return None;
            }
            let active = state.active.take().expect("exact active generation");
            self.release_active_reservation(&active);
            state.replacement_needs_resume |= active.paused;
        }
        Some(close())
    }

    pub(crate) fn is_current(&self, lease: &WatchEventGenerationLease) -> bool {
        lock_recover(&self.state)
            .active
            .as_ref()
            .is_some_and(|active| owns(active, lease))
    }

    fn reserve_delivery(&self, events: usize, bytes: usize) -> bool {
        let mut delivery = lock_recover(&self.delivery);
        let retained_events =
            delivery.queued.len() + usize::from(delivery.in_flight) + delivery.reserved_events;
        let retained_bytes = delivery.queued_bytes + delivery.reserved_bytes;
        if delivery.terminal_sealed
            || events > MAX_STAGED_EVENTS.saturating_sub(retained_events)
            || bytes > MAX_STAGED_EVENT_BYTES.saturating_sub(retained_bytes)
        {
            return false;
        }
        delivery.reserved_events += events;
        delivery.reserved_bytes += bytes;
        true
    }

    fn release_delivery_reservation(&self, events: usize, bytes: usize) {
        let mut delivery = lock_recover(&self.delivery);
        delivery.reserved_events = delivery.reserved_events.saturating_sub(events);
        delivery.reserved_bytes = delivery.reserved_bytes.saturating_sub(bytes);
    }

    fn release_active_reservation(&self, active: &ActiveGeneration) {
        if let PublicationState::Sealed(staged) = &active.publication {
            self.release_delivery_reservation(staged.events.len(), staged.serialized_bytes);
        }
    }

    fn enqueue_reserved_staged_delivery(&self, staged: StagedEvents) -> Option<bool> {
        let mut delivery = lock_recover(&self.delivery);
        if delivery.terminal_sealed
            || delivery.reserved_events < staged.events.len()
            || delivery.reserved_bytes < staged.serialized_bytes
        {
            return None;
        }
        delivery.reserved_events -= staged.events.len();
        delivery.reserved_bytes -= staged.serialized_bytes;
        for (payload, bytes) in staged.events {
            delivery.queued.push_back((payload, bytes));
            delivery.queued_bytes += bytes;
        }
        Some(begin_delivery_drain(&mut delivery))
    }

    fn enqueue_delivery(&self, payload: DebugEventPayload, reserved: bool) -> Option<bool> {
        let max_events = MAX_STAGED_EVENTS
            + if reserved {
                RESERVED_DELIVERY_EVENTS
            } else {
                0
            };
        let max_bytes = MAX_STAGED_EVENT_BYTES + if reserved { RESERVED_DELIVERY_BYTES } else { 0 };
        let mut delivery = lock_recover(&self.delivery);
        if delivery.terminal_sealed {
            return None;
        }
        let retained_events =
            delivery.queued.len() + usize::from(delivery.in_flight) + delivery.reserved_events;
        let retained_bytes = delivery.queued_bytes + delivery.reserved_bytes;
        if retained_events >= max_events {
            return None;
        }
        let remaining = max_bytes.saturating_sub(retained_bytes);
        let bytes = serialized_size_within(&payload, remaining.min(MAX_STAGED_EVENT_BYTES))?;
        delivery.queued.push_back((payload, bytes));
        delivery.queued_bytes += bytes;
        Some(begin_delivery_drain(&mut delivery))
    }

    fn drain_if_owner(&self, owner: bool) {
        if !owner {
            return;
        }
        loop {
            let queued = {
                let mut delivery = lock_recover(&self.delivery);
                let Some((payload, bytes)) = delivery.queued.pop_front() else {
                    delivery.draining = false;
                    return;
                };
                delivery.in_flight = true;
                (payload, bytes)
            };
            self.emitter.emit(queued.0);
            let mut delivery = lock_recover(&self.delivery);
            delivery.queued_bytes = delivery.queued_bytes.saturating_sub(queued.1);
            delivery.in_flight = false;
        }
    }
}

impl WatchLogicalFinishGate {
    /// Atomically revokes generation authority and seals watch delivery before
    /// the registry-owned finish callback runs. Events already inside the sink
    /// callback remain in flight; queued watch events are discarded. The
    /// callback therefore cannot be delayed by a blocked watch sink drainer.
    pub(crate) fn finish<T>(&self, finish: impl FnOnce() -> T) -> Option<T> {
        {
            let _operation = lock_recover(&self.gate.operation);
            if !Arc::ptr_eq(&self.authority, &self.gate.logical_finish_authority) {
                return None;
            }
            let mut state = lock_recover(&self.gate.state);
            if state.terminal_sealed {
                return None;
            }
            state.terminal_sealed = true;
            state.active = None;
            state.replacement_needs_resume = false;

            let mut delivery = lock_recover(&self.gate.delivery);
            delivery.terminal_sealed = true;
            delivery.queued.clear();
            delivery.queued_bytes = 0;
            delivery.reserved_events = 0;
            delivery.reserved_bytes = 0;
        }
        Some(finish())
    }
}

fn begin_buffering(
    active: &mut ActiveGeneration,
    lease: &WatchEventGenerationLease,
    startup_receipt: Option<StartupFunctionBreakpointReceipt>,
) -> WatchEventPublicationLease {
    let publication_authority = Arc::new(PublicationAuthority);
    let mut events = Vec::new();
    let mut serialized_bytes = 0;
    if let Some(receipt) = startup_receipt {
        serialized_bytes = receipt.serialized_bytes;
        events.push((receipt.payload, receipt.serialized_bytes));
        for (payload, payload_bytes) in receipt.early_updates {
            serialized_bytes += payload_bytes;
            events.push((payload, payload_bytes));
        }
    }
    active.publication = PublicationState::Buffering(StagedEvents {
        authority: Arc::clone(&publication_authority),
        events,
        serialized_bytes,
        overflowed: false,
    });
    WatchEventPublicationLease {
        generation_authority: Arc::clone(&lease.authority),
        publication_authority,
        generation: lease.generation,
    }
}

fn payload_has_exact_ordered_ids(payload: &DebugEventPayload, ordered_ids: &[String]) -> bool {
    let DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } = payload else {
        return false;
    };
    breakpoints.len() == ordered_ids.len()
        && breakpoints
            .iter()
            .zip(ordered_ids)
            .all(|(verification, expected)| verification.id == *expected)
}

fn payload_contains_function_breakpoint_id(payload: &DebugEventPayload, id: &str) -> bool {
    let DebugEventPayload::FunctionBreakpointsVerified { breakpoints, .. } = payload else {
        return false;
    };
    breakpoints.iter().any(|verification| verification.id == id)
}

fn activate(state: &mut WatchEventGateState, published: bool) -> WatchEventGenerationLease {
    let authority = Arc::new(GenerationAuthority);
    let generation = state.next_generation;
    state.active = Some(ActiveGeneration {
        authority: Arc::clone(&authority),
        generation,
        paused: false,
        startup_function_breakpoint_receipt_required: false,
        startup_function_breakpoint_receipt: None,
        publication: if published {
            PublicationState::Published
        } else {
            PublicationState::Unpublished
        },
    });
    WatchEventGenerationLease {
        authority,
        generation,
    }
}

fn owns(active: &ActiveGeneration, lease: &WatchEventGenerationLease) -> bool {
    active.generation == lease.generation && Arc::ptr_eq(&active.authority, &lease.authority)
}

fn owns_publication(active: &ActiveGeneration, lease: &WatchEventPublicationLease) -> bool {
    active.generation == lease.generation
        && Arc::ptr_eq(&active.authority, &lease.generation_authority)
        && matches!(
            &active.publication,
            PublicationState::Buffering(StagedEvents { authority, .. })
                if Arc::ptr_eq(authority, &lease.publication_authority)
        )
}

fn owns_flush(active: &ActiveGeneration, lease: &WatchEventFlushLease) -> bool {
    active.generation == lease.generation
        && Arc::ptr_eq(&active.authority, &lease.generation_authority)
        && matches!(
            &active.publication,
            PublicationState::Sealed(StagedEvents { authority, .. })
                if Arc::ptr_eq(authority, &lease.publication_authority)
        )
}

fn active_reservation(active: &ActiveGeneration) -> Option<(usize, usize)> {
    match &active.publication {
        PublicationState::Sealed(staged) => Some((staged.events.len(), staged.serialized_bytes)),
        _ => None,
    }
}

fn pause_state_after(payload: &DebugEventPayload) -> Option<bool> {
    match payload {
        DebugEventPayload::Stopped { .. } => Some(true),
        DebugEventPayload::Resumed => Some(false),
        _ => None,
    }
}

fn begin_delivery_drain(delivery: &mut WatchEventDelivery) -> bool {
    if delivery.draining {
        false
    } else {
        delivery.draining = true;
        true
    }
}

struct BoundedByteCounter {
    bytes: usize,
    limit: usize,
}

impl Write for BoundedByteCounter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(next) = self.bytes.checked_add(buffer.len()) else {
            return Err(io::Error::other("staged event size overflow"));
        };
        if next > self.limit {
            return Err(io::Error::other("staged event byte limit exceeded"));
        }
        self.bytes = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serialized_size_within(payload: &DebugEventPayload, limit: usize) -> Option<usize> {
    let mut counter = BoundedByteCounter { bytes: 0, limit };
    serde_json::to_writer(&mut counter, payload)
        .ok()
        .map(|()| counter.bytes)
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "debug_node_watch_event_gate_tests.rs"]
mod tests;
