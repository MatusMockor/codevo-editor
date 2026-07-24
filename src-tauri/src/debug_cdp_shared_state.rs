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
        Self::new_at_pause_generation_floor(source_maps, PauseGenerationFloor::INITIAL)
    }

    pub(in crate::debug_cdp) fn new_at_pause_generation_floor(
        source_maps: Option<SourceMapRegistry>,
        floor: PauseGenerationFloor,
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
}
