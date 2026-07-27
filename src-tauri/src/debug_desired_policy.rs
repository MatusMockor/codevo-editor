use crate::debug_adapter::{
    DebugBreakpoint, DebugExceptionPauseMode, DebugFunctionBreakpoint, DebugJustMyCodePolicy,
};
use crate::debug_breakpoint_policy::{
    breakpoints_by_file, commit_live_breakpoints, prepare_live_breakpoints,
    validate_initial_breakpoints, DebugBreakpointAdapterKind,
};
use crate::debug_exception_type_filter::DebugExceptionTypeFilter;
use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::Arc;

const INITIAL_DESIRED_POLICY_REVISION: u64 = 1;
pub(crate) const INITIAL_FUNCTION_BREAKPOINT_GENERATION: u64 = 1;

/// Complete debugger policy that must be restored before a reconnected target
/// is allowed to run. Fields stay private so reconnect code cannot apply an
/// incomplete subset by accident.
#[derive(Clone, PartialEq)]
pub(crate) struct DesiredDebuggerPolicySnapshot {
    breakpoints: Vec<DebugBreakpoint>,
    exception_pause_mode: DebugExceptionPauseMode,
    exception_type_filter: DebugExceptionTypeFilter,
    breakpoints_active: bool,
    internal_step_filter: Option<DebugJustMyCodePolicy>,
    function_breakpoints: Vec<DebugFunctionBreakpoint>,
    function_breakpoint_generation: u64,
}

impl fmt::Debug for DesiredDebuggerPolicySnapshot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesiredDebuggerPolicySnapshot")
            .field("breakpoint_count", &self.breakpoints.len())
            .field("exception_pause_mode", &self.exception_pause_mode)
            .field(
                "exception_type_filter_count",
                &self.exception_type_filter.as_slice().len(),
            )
            .field("breakpoints_active", &self.breakpoints_active)
            .field("internal_step_filter", &self.internal_step_filter)
            .field(
                "function_breakpoint_count",
                &self.function_breakpoints.len(),
            )
            .finish()
    }
}

impl DesiredDebuggerPolicySnapshot {
    pub(crate) fn new(
        root: &Path,
        breakpoint_kind: DebugBreakpointAdapterKind,
        breakpoints: Vec<DebugBreakpoint>,
        exception_pause_mode: DebugExceptionPauseMode,
        breakpoints_active: bool,
        internal_step_filter: Option<DebugJustMyCodePolicy>,
    ) -> Result<Self, String> {
        Self::new_with_exception_filter(
            root,
            breakpoint_kind,
            breakpoints,
            exception_pause_mode,
            DebugExceptionTypeFilter::default(),
            breakpoints_active,
            internal_step_filter,
        )
    }

    pub(crate) fn new_with_exception_filter(
        root: &Path,
        breakpoint_kind: DebugBreakpointAdapterKind,
        breakpoints: Vec<DebugBreakpoint>,
        exception_pause_mode: DebugExceptionPauseMode,
        exception_type_filter: DebugExceptionTypeFilter,
        breakpoints_active: bool,
        internal_step_filter: Option<DebugJustMyCodePolicy>,
    ) -> Result<Self, String> {
        let breakpoints = validate_initial_breakpoints(root, breakpoint_kind, &breakpoints)?;
        Ok(Self {
            breakpoints,
            exception_pause_mode,
            exception_type_filter: if exception_pause_mode == DebugExceptionPauseMode::None {
                DebugExceptionTypeFilter::default()
            } else {
                exception_type_filter
            },
            breakpoints_active,
            internal_step_filter,
            function_breakpoints: Vec::new(),
            function_breakpoint_generation: INITIAL_FUNCTION_BREAKPOINT_GENERATION,
        })
    }

    pub(crate) fn with_initial_function_breakpoints(
        mut self,
        breakpoints: Vec<DebugFunctionBreakpoint>,
    ) -> Result<Self, String> {
        crate::debug_cdp_function_breakpoints::validate_function_breakpoints(&breakpoints)?;
        self.function_breakpoints = breakpoints;
        self.function_breakpoint_generation = INITIAL_FUNCTION_BREAKPOINT_GENERATION;
        Ok(self)
    }
}

/// Closed startup sequence. The ordering is part of the type's contract:
/// debugger setup always completes before the target may run.
#[derive(Clone, PartialEq)]
pub(crate) enum DesiredDebuggerReplayStep {
    EnableRuntime,
    EnableDebugger,
    ApplyInternalStepFilter(Option<DebugJustMyCodePolicy>),
    SetExceptionPause {
        mode: DebugExceptionPauseMode,
        exception_type_filter: DebugExceptionTypeFilter,
    },
    SetBreakpointsActive(bool),
    SetBreakpoints {
        file_path: String,
        breakpoints: Vec<DebugBreakpoint>,
    },
    SetFunctionBreakpoints {
        breakpoints: Vec<DebugFunctionBreakpoint>,
        generation: u64,
    },
    RunIfWaitingForDebugger,
}

impl fmt::Debug for DesiredDebuggerReplayStep {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EnableRuntime => formatter.write_str("EnableRuntime"),
            Self::EnableDebugger => formatter.write_str("EnableDebugger"),
            Self::ApplyInternalStepFilter(policy) => formatter
                .debug_tuple("ApplyInternalStepFilter")
                .field(policy)
                .finish(),
            Self::SetExceptionPause {
                mode,
                exception_type_filter,
            } => formatter
                .debug_struct("SetExceptionPause")
                .field("mode", mode)
                .field(
                    "exception_type_filter_count",
                    &exception_type_filter.as_slice().len(),
                )
                .finish(),
            Self::SetBreakpointsActive(active) => formatter
                .debug_tuple("SetBreakpointsActive")
                .field(active)
                .finish(),
            Self::SetBreakpoints { breakpoints, .. } => formatter
                .debug_struct("SetBreakpoints")
                .field("breakpoint_count", &breakpoints.len())
                .finish(),
            Self::SetFunctionBreakpoints { breakpoints, .. } => formatter
                .debug_struct("SetFunctionBreakpoints")
                .field("breakpoint_count", &breakpoints.len())
                .finish(),
            Self::RunIfWaitingForDebugger => formatter.write_str("RunIfWaitingForDebugger"),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct DesiredDebuggerReplayPlan {
    revision: u64,
    steps: Vec<DesiredDebuggerReplayStep>,
}

impl DesiredDebuggerReplayPlan {
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn steps(&self) -> &[DesiredDebuggerReplayStep] {
        &self.steps
    }

    #[cfg(test)]
    pub(crate) fn from_steps_for_test(
        revision: u64,
        steps: Vec<DesiredDebuggerReplayStep>,
    ) -> Self {
        Self { revision, steps }
    }
}

impl fmt::Debug for DesiredDebuggerReplayPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesiredDebuggerReplayPlan")
            .field("revision", &self.revision)
            .field("step_count", &self.steps.len())
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DesiredDebuggerReplayCommitError {
    Stale,
}

struct DesiredDebuggerPolicyAuthority;

/// Validated candidate for replacing exactly one file's desired breakpoints.
///
/// The authority and snapshots stay private: callers can carry a transaction
/// across protocol work, but cannot forge or retarget it to another policy.
pub(crate) struct PreparedDesiredBreakpointReplacement {
    authority: Arc<DesiredDebuggerPolicyAuthority>,
    base_revision: u64,
    base_snapshot: DesiredDebuggerPolicySnapshot,
    replacement: DesiredDebuggerPolicySnapshot,
    replacement_revision: u64,
    file_path: String,
    file_breakpoints: Vec<DebugBreakpoint>,
}

impl PreparedDesiredBreakpointReplacement {
    pub(crate) fn file_path(&self) -> &str {
        &self.file_path
    }

    pub(crate) fn file_breakpoints(&self) -> &[DebugBreakpoint] {
        &self.file_breakpoints
    }
}

impl fmt::Debug for PreparedDesiredBreakpointReplacement {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedDesiredBreakpointReplacement")
            .field("base_revision", &self.base_revision)
            .field("replacement_revision", &self.replacement_revision)
            .field("breakpoint_count", &self.replacement.breakpoints.len())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesiredBreakpointReplacementCommitError {
    Stale,
}

pub(crate) struct PreparedDesiredPolicyUpdate {
    authority: Arc<DesiredDebuggerPolicyAuthority>,
    base_revision: u64,
    base_snapshot: DesiredDebuggerPolicySnapshot,
    replacement: DesiredDebuggerPolicySnapshot,
    replacement_revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesiredPolicyUpdateCommitError {
    Stale,
}

/// Revisioned, pure desired-state holder. Validation finishes before either the
/// snapshot or its revision changes, which makes rejected replacements atomic.
pub(crate) struct DesiredDebuggerPolicy {
    authority: Arc<DesiredDebuggerPolicyAuthority>,
    revision: u64,
    last_applied_revision: Option<u64>,
    snapshot: DesiredDebuggerPolicySnapshot,
}

impl fmt::Debug for DesiredDebuggerPolicy {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesiredDebuggerPolicy")
            .field("revision", &self.revision)
            .field("last_applied_revision", &self.last_applied_revision)
            .field("snapshot", &self.snapshot)
            .finish()
    }
}

impl DesiredDebuggerPolicy {
    pub(crate) fn new(snapshot: DesiredDebuggerPolicySnapshot) -> Self {
        Self {
            authority: Arc::new(DesiredDebuggerPolicyAuthority),
            revision: INITIAL_DESIRED_POLICY_REVISION,
            last_applied_revision: None,
            snapshot,
        }
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn snapshot(&self) -> DesiredDebuggerPolicySnapshot {
        self.snapshot.clone()
    }

    pub(crate) fn prepare_breakpoint_replacement(
        &self,
        root: &Path,
        breakpoint_kind: DebugBreakpointAdapterKind,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<PreparedDesiredBreakpointReplacement, String> {
        let mut replacement_by_file = breakpoints_by_file(&self.snapshot.breakpoints);
        let (canonical_file_path, normalized) = prepare_live_breakpoints(
            root,
            breakpoint_kind,
            &replacement_by_file,
            file_path,
            breakpoints,
        )?;
        commit_live_breakpoints(
            &mut replacement_by_file,
            canonical_file_path.clone(),
            normalized.clone(),
        );
        let breakpoints = replacement_by_file
            .into_iter()
            .collect::<BTreeMap<_, _>>()
            .into_values()
            .flatten()
            .collect();
        let mut replacement = self.snapshot.clone();
        replacement.breakpoints = breakpoints;
        let replacement_revision = if replacement == self.snapshot {
            self.revision
        } else {
            self.revision
                .checked_add(1)
                .ok_or_else(|| "Debugger desired policy revision is exhausted.".to_string())?
        };
        Ok(PreparedDesiredBreakpointReplacement {
            authority: Arc::clone(&self.authority),
            base_revision: self.revision,
            base_snapshot: self.snapshot.clone(),
            replacement,
            replacement_revision,
            file_path: canonical_file_path,
            file_breakpoints: normalized,
        })
    }

    pub(crate) fn commit_breakpoint_replacement(
        &mut self,
        prepared: PreparedDesiredBreakpointReplacement,
    ) -> Result<u64, DesiredBreakpointReplacementCommitError> {
        if !Arc::ptr_eq(&self.authority, &prepared.authority)
            || self.revision != prepared.base_revision
            || self.snapshot != prepared.base_snapshot
        {
            return Err(DesiredBreakpointReplacementCommitError::Stale);
        }
        self.snapshot = prepared.replacement;
        self.revision = prepared.replacement_revision;
        Ok(self.revision)
    }

    pub(crate) fn prepare_breakpoints_active(
        &self,
        active: bool,
    ) -> Result<PreparedDesiredPolicyUpdate, String> {
        let mut replacement = self.snapshot.clone();
        replacement.breakpoints_active = active;
        self.prepare_policy_update(replacement)
    }

    pub(crate) fn prepare_exception_pause(
        &self,
        mode: DebugExceptionPauseMode,
        exception_type_filter: DebugExceptionTypeFilter,
    ) -> Result<PreparedDesiredPolicyUpdate, String> {
        let mut replacement = self.snapshot.clone();
        replacement.exception_pause_mode = mode;
        replacement.exception_type_filter = if mode == DebugExceptionPauseMode::None {
            DebugExceptionTypeFilter::default()
        } else {
            exception_type_filter
        };
        self.prepare_policy_update(replacement)
    }

    pub(crate) fn prepare_function_breakpoint_replacement(
        &self,
        breakpoints: &[DebugFunctionBreakpoint],
        generation: u64,
    ) -> Result<PreparedDesiredPolicyUpdate, String> {
        if generation == 0 || generation > 9_007_199_254_740_991 {
            return Err("Function breakpoint generation is invalid.".to_string());
        }
        crate::debug_cdp_function_breakpoints::validate_function_breakpoints(breakpoints)?;
        let mut replacement = self.snapshot.clone();
        replacement.function_breakpoints = breakpoints.to_vec();
        replacement.function_breakpoint_generation = generation;
        self.prepare_policy_update(replacement)
    }

    pub(crate) fn commit_policy_update(
        &mut self,
        prepared: PreparedDesiredPolicyUpdate,
    ) -> Result<u64, DesiredPolicyUpdateCommitError> {
        if !Arc::ptr_eq(&self.authority, &prepared.authority)
            || self.revision != prepared.base_revision
            || self.snapshot != prepared.base_snapshot
        {
            return Err(DesiredPolicyUpdateCommitError::Stale);
        }
        self.snapshot = prepared.replacement;
        self.revision = prepared.replacement_revision;
        Ok(self.revision)
    }

    fn prepare_policy_update(
        &self,
        replacement: DesiredDebuggerPolicySnapshot,
    ) -> Result<PreparedDesiredPolicyUpdate, String> {
        let replacement_revision = if replacement == self.snapshot {
            self.revision
        } else {
            self.revision
                .checked_add(1)
                .ok_or_else(|| "Debugger desired policy revision is exhausted.".to_string())?
        };
        Ok(PreparedDesiredPolicyUpdate {
            authority: Arc::clone(&self.authority),
            base_revision: self.revision,
            base_snapshot: self.snapshot.clone(),
            replacement,
            replacement_revision,
        })
    }

    pub(crate) fn replace(
        &mut self,
        root: &Path,
        breakpoint_kind: DebugBreakpointAdapterKind,
        breakpoints: Vec<DebugBreakpoint>,
        exception_pause_mode: DebugExceptionPauseMode,
        breakpoints_active: bool,
        internal_step_filter: Option<DebugJustMyCodePolicy>,
    ) -> Result<u64, String> {
        let mut replacement = DesiredDebuggerPolicySnapshot::new(
            root,
            breakpoint_kind,
            breakpoints,
            exception_pause_mode,
            breakpoints_active,
            internal_step_filter,
        )?;
        if exception_pause_mode != DebugExceptionPauseMode::None {
            replacement.exception_type_filter = self.snapshot.exception_type_filter.clone();
        }
        replacement.function_breakpoints = self.snapshot.function_breakpoints.clone();
        if replacement == self.snapshot {
            return Ok(self.revision);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| "Debugger desired policy revision is exhausted.".to_string())?;
        self.snapshot = replacement;
        self.revision = revision;
        Ok(revision)
    }

    pub(crate) fn replay_plan(&self) -> DesiredDebuggerReplayPlan {
        let mut grouped = BTreeMap::<String, Vec<DebugBreakpoint>>::new();
        for breakpoint in &self.snapshot.breakpoints {
            grouped
                .entry(breakpoint.file_path.clone())
                .or_default()
                .push(breakpoint.clone());
        }

        let mut steps = Vec::with_capacity(grouped.len() + 7);
        steps.push(DesiredDebuggerReplayStep::EnableRuntime);
        steps.push(DesiredDebuggerReplayStep::EnableDebugger);
        steps.push(DesiredDebuggerReplayStep::ApplyInternalStepFilter(
            self.snapshot.internal_step_filter,
        ));
        steps.push(DesiredDebuggerReplayStep::SetExceptionPause {
            mode: self.snapshot.exception_pause_mode,
            exception_type_filter: self.snapshot.exception_type_filter.clone(),
        });
        steps.push(DesiredDebuggerReplayStep::SetBreakpointsActive(
            self.snapshot.breakpoints_active,
        ));
        steps.extend(grouped.into_iter().map(|(file_path, breakpoints)| {
            DesiredDebuggerReplayStep::SetBreakpoints {
                file_path,
                breakpoints,
            }
        }));
        steps.push(DesiredDebuggerReplayStep::SetFunctionBreakpoints {
            breakpoints: self.snapshot.function_breakpoints.clone(),
            generation: self.snapshot.function_breakpoint_generation,
        });
        steps.push(DesiredDebuggerReplayStep::RunIfWaitingForDebugger);
        DesiredDebuggerReplayPlan {
            revision: self.revision,
            steps,
        }
    }

    pub(crate) fn commit_replay(
        &mut self,
        plan: DesiredDebuggerReplayPlan,
    ) -> Result<(), DesiredDebuggerReplayCommitError> {
        if plan.revision != self.revision || plan != self.replay_plan() {
            return Err(DesiredDebuggerReplayCommitError::Stale);
        }
        self.last_applied_revision = Some(plan.revision);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_breakpoint_policy::{MAX_BREAKPOINTS_PER_FILE, MAX_BREAKPOINTS_PER_SESSION};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: std::path::PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-desired-debug-policy-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).expect("create fixture");
            Self { root }
        }

        fn file(&self, name: &str) -> String {
            let path = self.root.join(name);
            fs::write(&path, "debugger;\n").expect("write source fixture");
            fs::canonicalize(path)
                .expect("canonicalize source fixture")
                .to_string_lossy()
                .into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn breakpoint(file_path: &str, id: impl Into<String>, line_number: u32) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.into(),
            file_path: file_path.to_string(),
            line_number,
            column_number: None,
            condition: None,
            hit_condition: None,
            log_message: None,
            enabled: true,
            verified: false,
        }
    }

    fn snapshot(
        fixture: &Fixture,
        breakpoints: Vec<DebugBreakpoint>,
    ) -> DesiredDebuggerPolicySnapshot {
        DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            breakpoints,
            DebugExceptionPauseMode::Uncaught,
            true,
            Some(DebugJustMyCodePolicy::NodeInternalsAndDependencies),
        )
        .expect("valid snapshot")
    }

    #[test]
    fn snapshot_is_exact_bounded_and_defensively_cloned() {
        let fixture = Fixture::new();
        let file = fixture.file("entry.ts");
        let original = breakpoint(&file, "private-id", 7);
        let mut input = vec![original.clone()];
        let stored = snapshot(&fixture, input.clone());
        input[0].line_number = 99;

        assert_eq!(stored.breakpoints, vec![original]);
        let mut clone = stored.clone();
        clone.breakpoints[0].line_number = 42;
        assert_eq!(stored.breakpoints[0].line_number, 7);
        assert_eq!(clone.breakpoints[0].line_number, 42);

        let debug = format!("{stored:?}");
        assert!(debug.contains("breakpoint_count: 1"));
        assert!(!debug.contains("private-id"));
        assert!(!debug.contains(&file));
    }

    #[test]
    fn initial_function_breakpoints_replay_at_generation_one_before_target_release() {
        let fixture = Fixture::new();
        let function_breakpoint = DebugFunctionBreakpoint {
            id: "initial-function".to_string(),
            function_name: "startServer".to_string(),
            enabled: true,
        };
        let snapshot = snapshot(&fixture, Vec::new())
            .with_initial_function_breakpoints(vec![function_breakpoint.clone()])
            .expect("valid initial function breakpoint");
        let plan = DesiredDebuggerPolicy::new(snapshot).replay_plan();
        let function_index = plan
            .steps()
            .iter()
            .position(|step| {
                matches!(
                    step,
                    DesiredDebuggerReplayStep::SetFunctionBreakpoints {
                        breakpoints,
                        generation: INITIAL_FUNCTION_BREAKPOINT_GENERATION,
                    } if breakpoints == std::slice::from_ref(&function_breakpoint)
                )
            })
            .expect("initial function breakpoint replay");
        let release_index = plan
            .steps()
            .iter()
            .position(|step| matches!(step, DesiredDebuggerReplayStep::RunIfWaitingForDebugger))
            .expect("target release");
        assert!(function_index < release_index);
    }

    #[test]
    fn snapshot_reuses_per_file_and_session_limits() {
        let fixture = Fixture::new();
        let first = fixture.file("first.ts");
        let file_limit = (0..MAX_BREAKPOINTS_PER_FILE)
            .map(|index| breakpoint(&first, format!("file-{index}"), index as u32 + 1))
            .collect();
        assert!(DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            file_limit,
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .is_ok());
        let over_file_limit = (0..=MAX_BREAKPOINTS_PER_FILE)
            .map(|index| breakpoint(&first, format!("file-{index}"), index as u32 + 1))
            .collect();
        assert!(DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            over_file_limit,
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .is_err());

        let file_count = MAX_BREAKPOINTS_PER_SESSION.div_ceil(MAX_BREAKPOINTS_PER_FILE);
        let files = (0..file_count)
            .map(|index| fixture.file(&format!("total-{index}.ts")))
            .collect::<Vec<_>>();
        let session_limit = (0..MAX_BREAKPOINTS_PER_SESSION)
            .map(|index| {
                breakpoint(
                    &files[index / MAX_BREAKPOINTS_PER_FILE],
                    format!("session-{index}"),
                    (index % MAX_BREAKPOINTS_PER_FILE) as u32 + 1,
                )
            })
            .collect();
        assert!(DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            session_limit,
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .is_ok());
        let over_session_limit = (0..=MAX_BREAKPOINTS_PER_SESSION)
            .map(|index| {
                breakpoint(
                    &files[index / MAX_BREAKPOINTS_PER_FILE],
                    format!("session-{index}"),
                    (index % MAX_BREAKPOINTS_PER_FILE) as u32 + 1,
                )
            })
            .collect();
        assert!(DesiredDebuggerPolicySnapshot::new(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            over_session_limit,
            DebugExceptionPauseMode::None,
            true,
            None,
        )
        .is_err());
    }

    #[test]
    fn rejected_replacement_is_atomic_and_valid_change_advances_revision_once() {
        let fixture = Fixture::new();
        let file = fixture.file("atomic.ts");
        let initial = snapshot(&fixture, vec![breakpoint(&file, "one", 1)]);
        let mut policy = DesiredDebuggerPolicy::new(initial.clone());

        let invalid = vec![
            breakpoint(&file, "duplicate", 2),
            breakpoint(&file, "duplicate", 3),
        ];
        assert!(policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                invalid,
                DebugExceptionPauseMode::All,
                false,
                None,
            )
            .is_err());
        assert_eq!(policy.revision(), INITIAL_DESIRED_POLICY_REVISION);
        assert_eq!(policy.snapshot(), initial);

        let next = policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                vec![breakpoint(&file, "two", 2)],
                DebugExceptionPauseMode::All,
                false,
                Some(DebugJustMyCodePolicy::Dependencies),
            )
            .expect("replace desired state");
        assert_eq!(next, INITIAL_DESIRED_POLICY_REVISION + 1);
        assert_eq!(policy.revision(), next);

        let unchanged = policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                vec![breakpoint(&file, "two", 2)],
                DebugExceptionPauseMode::All,
                false,
                Some(DebugJustMyCodePolicy::Dependencies),
            )
            .expect("idempotent replacement");
        assert_eq!(unchanged, next);
    }

    #[test]
    fn replay_order_is_deterministic_and_run_is_always_last() {
        let fixture = Fixture::new();
        let z_file = fixture.file("z.ts");
        let a_file = fixture.file("a.ts");
        let policy = DesiredDebuggerPolicy::new(snapshot(
            &fixture,
            vec![
                breakpoint(&z_file, "z", 9),
                breakpoint(&a_file, "a", 1),
                breakpoint(&z_file, "z-two", 10),
            ],
        ));
        let plan = policy.replay_plan();

        assert!(matches!(
            plan.steps.as_slice(),
            [
                DesiredDebuggerReplayStep::EnableRuntime,
                DesiredDebuggerReplayStep::EnableDebugger,
                DesiredDebuggerReplayStep::ApplyInternalStepFilter(Some(
                    DebugJustMyCodePolicy::NodeInternalsAndDependencies
                )),
                DesiredDebuggerReplayStep::SetExceptionPause {
                    mode: DebugExceptionPauseMode::Uncaught,
                    exception_type_filter: _,
                },
                DesiredDebuggerReplayStep::SetBreakpointsActive(true),
                DesiredDebuggerReplayStep::SetBreakpoints { .. },
                DesiredDebuggerReplayStep::SetBreakpoints { .. },
                DesiredDebuggerReplayStep::SetFunctionBreakpoints { .. },
                DesiredDebuggerReplayStep::RunIfWaitingForDebugger,
            ]
        ));
        let DesiredDebuggerReplayStep::SetBreakpoints {
            file_path: first_path,
            breakpoints: first_breakpoints,
        } = &plan.steps[5]
        else {
            panic!("first deterministic breakpoint batch");
        };
        assert_eq!(first_path, &a_file);
        assert_eq!(first_breakpoints[0].id, "a");
        let DesiredDebuggerReplayStep::SetBreakpoints {
            file_path: second_path,
            breakpoints: second_breakpoints,
        } = &plan.steps[6]
        else {
            panic!("second deterministic breakpoint batch");
        };
        assert_eq!(second_path, &z_file);
        assert_eq!(
            second_breakpoints
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["z", "z-two"]
        );
    }

    #[test]
    fn exception_type_filter_is_replayed_atomically_and_none_clears_it() {
        let fixture = Fixture::new();
        let filter =
            DebugExceptionTypeFilter::parse(vec!["TypeError".to_string()]).expect("valid filter");
        let snapshot = DesiredDebuggerPolicySnapshot::new_with_exception_filter(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            Vec::new(),
            DebugExceptionPauseMode::All,
            filter.clone(),
            true,
            None,
        )
        .expect("filtered snapshot");
        let mut policy = DesiredDebuggerPolicy::new(snapshot);
        assert!(policy.replay_plan().steps().contains(
            &DesiredDebuggerReplayStep::SetExceptionPause {
                mode: DebugExceptionPauseMode::All,
                exception_type_filter: filter.clone(),
            }
        ));
        policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                Vec::new(),
                DebugExceptionPauseMode::Uncaught,
                true,
                None,
            )
            .expect("replace while preserving filter");
        assert!(policy.replay_plan().steps().contains(
            &DesiredDebuggerReplayStep::SetExceptionPause {
                mode: DebugExceptionPauseMode::Uncaught,
                exception_type_filter: filter.clone(),
            }
        ));

        let prepared = policy
            .prepare_exception_pause(DebugExceptionPauseMode::None, filter)
            .expect("prepare none policy");
        policy
            .commit_policy_update(prepared)
            .expect("commit none policy");
        assert!(policy.replay_plan().steps().contains(
            &DesiredDebuggerReplayStep::SetExceptionPause {
                mode: DebugExceptionPauseMode::None,
                exception_type_filter: DebugExceptionTypeFilter::default(),
            }
        ));
    }

    #[test]
    fn mutation_during_replay_makes_old_plan_commit_stale() {
        let fixture = Fixture::new();
        let file = fixture.file("revision.ts");
        let mut policy =
            DesiredDebuggerPolicy::new(snapshot(&fixture, vec![breakpoint(&file, "old", 1)]));
        let old_plan = policy.replay_plan();

        policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                vec![breakpoint(&file, "new", 2)],
                DebugExceptionPauseMode::All,
                false,
                Some(DebugJustMyCodePolicy::NodeInternals),
            )
            .expect("mutate during replay");
        assert_eq!(
            policy.commit_replay(old_plan),
            Err(DesiredDebuggerReplayCommitError::Stale)
        );
        let current = policy.replay_plan();
        assert!(policy.commit_replay(current).is_ok());
        assert_eq!(policy.last_applied_revision, Some(policy.revision()));
    }

    #[test]
    fn replay_plan_clone_is_exact_and_independent_without_debug_secret_leakage() {
        let fixture = Fixture::new();
        let file = fixture.file("clone.ts");
        let mut sensitive = breakpoint(&file, "secret-breakpoint-id", 4);
        sensitive.condition = Some("token === 'secret-value'".to_string());
        let mut policy = DesiredDebuggerPolicy::new(snapshot(&fixture, vec![sensitive]));
        let plan = policy.replay_plan();
        let mut clone = plan.clone();

        assert_eq!(clone, plan);
        clone.steps.pop();
        assert_ne!(clone, plan);
        assert_eq!(
            policy.commit_replay(clone),
            Err(DesiredDebuggerReplayCommitError::Stale)
        );
        assert!(matches!(
            plan.steps.last(),
            Some(DesiredDebuggerReplayStep::RunIfWaitingForDebugger)
        ));
        let debug = format!("{plan:?}");
        assert!(!debug.contains("secret-breakpoint-id"));
        assert!(!debug.contains("secret-value"));
        assert!(!debug.contains(&file));
        let breakpoint_step_debug = format!("{:?}", plan.steps()[5]);
        assert!(!breakpoint_step_debug.contains("secret-breakpoint-id"));
        assert!(!breakpoint_step_debug.contains("secret-value"));
        assert!(!breakpoint_step_debug.contains(&file));
    }

    #[test]
    fn revision_exhaustion_rejects_replacement_without_partial_mutation() {
        let fixture = Fixture::new();
        let file = fixture.file("exhaustion.ts");
        let initial = snapshot(&fixture, vec![breakpoint(&file, "old", 1)]);
        let mut policy = DesiredDebuggerPolicy::new(initial.clone());
        policy.revision = u64::MAX;

        assert!(policy
            .replace(
                &fixture.root,
                DebugBreakpointAdapterKind::Node,
                vec![breakpoint(&file, "new", 2)],
                DebugExceptionPauseMode::All,
                false,
                None,
            )
            .is_err());
        assert_eq!(policy.revision(), u64::MAX);
        assert_eq!(policy.snapshot(), initial);
    }
}

#[cfg(test)]
#[path = "debug_desired_policy_transaction_tests.rs"]
mod transaction_tests;
