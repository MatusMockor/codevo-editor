const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Closed authority boundary used when a fresh CDP target must continue an
/// earlier target's pause-generation lineage. Keeping construction private to
/// the debugger prevents arbitrary wire values from becoming trusted epochs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PauseGenerationFloor(u64);

impl PauseGenerationFloor {
    pub(crate) const INITIAL: Self = Self(0);

    pub(crate) fn try_from_epoch(epoch: u64) -> Result<Self, String> {
        if epoch >= MAX_SAFE_INTEGER {
            return Err("The debug pause generation is exhausted.".to_string());
        }
        Ok(Self(epoch))
    }

    pub(crate) fn epoch(self) -> u64 {
        self.0
    }
}

impl CdpShared {
    pub(in crate::debug_cdp) fn new(source_maps: Option<SourceMapRegistry>) -> Self {
        Self::new_with_smart_step(source_maps, PauseGenerationFloor::INITIAL, false)
    }

    pub(in crate::debug_cdp) fn new_at_pause_generation_floor(
        source_maps: Option<SourceMapRegistry>,
        floor: PauseGenerationFloor,
    ) -> Self {
        Self::new_with_smart_step(source_maps, floor, false)
    }

    pub(in crate::debug_cdp) fn new_with_smart_step(
        source_maps: Option<SourceMapRegistry>,
        floor: PauseGenerationFloor,
        smart_step_enabled: bool,
    ) -> Self {
        Self {
            breakpoint_hits: CdpBreakpointHitRegistry::default(),
            breakpoints_by_file: HashMap::new(),
            cdp_ids_by_file: HashMap::new(),
            first_pause_seen: false,
            explicit_pause_requested: false,
            internal_action: None,
            next_id: 1,
            pause_generation_epoch: floor.0,
            pause: None,
            pending_explicit_pause: None,
            pending_restart_frame: None,
            pending_resolutions: HashMap::new(),
            resolution_index: HashMap::new(),
            suppress_next_resumed: false,
            source_maps,
            smart_step_dispatch_lease: None,
            smart_step_fallback: None,
            smart_step_policy: super::smart_step::StepPolicy::new(smart_step_enabled),
            startup_validation: None,
        }
    }

    pub(in crate::debug_cdp) fn allocate_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(super) fn advance_pause_generation(&mut self) -> Option<u64> {
        let next = self.pause_generation_epoch.checked_add(1)?;
        if next > MAX_SAFE_INTEGER {
            return None;
        }
        self.pause_generation_epoch = next;
        Some(next)
    }

    pub(in crate::debug_cdp) fn invalidate_pause(&mut self) {
        self.pause = None;
        let _ = self.advance_pause_generation();
    }

    pub(crate) fn cancel_smart_step(&mut self) {
        if let Some(lease) = self.smart_step_dispatch_lease.take() {
            if let Some(source_maps) = self.source_maps.as_mut() {
                source_maps.release_dispatch(lease);
            }
        }
        self.smart_step_fallback = None;
        self.smart_step_policy.cancel();
    }
}

#[cfg(test)]
pub(crate) fn exhausted_pause_generation_shared_state_for_test() -> CdpShared {
    CdpShared::new_at_pause_generation_floor(None, PauseGenerationFloor(MAX_SAFE_INTEGER))
}
