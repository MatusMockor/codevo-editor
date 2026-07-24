use super::*;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "codevo-desired-transaction-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create fixture");
        Self { root }
    }

    fn file(&self, name: &str) -> String {
        let path = self.root.join(name);
        fs::write(&path, "debugger;\n").expect("write fixture");
        fs::canonicalize(path)
            .expect("canonicalize fixture")
            .to_string_lossy()
            .into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn breakpoint(file_path: &str, id: &str, line_number: u32) -> DebugBreakpoint {
    DebugBreakpoint {
        id: id.to_string(),
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

fn snapshot(fixture: &Fixture, breakpoints: Vec<DebugBreakpoint>) -> DesiredDebuggerPolicySnapshot {
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
fn prepared_replacement_is_owned_redacted_and_preserves_other_policy() {
    let fixture = Fixture::new();
    let old_file = fixture.file("old.ts");
    let new_file = fixture.file("new.ts");
    let initial = DesiredDebuggerPolicySnapshot::new(
        &fixture.root,
        DebugBreakpointAdapterKind::Node,
        vec![breakpoint(&old_file, "old", 1)],
        DebugExceptionPauseMode::All,
        false,
        Some(DebugJustMyCodePolicy::Dependencies),
    )
    .expect("initial snapshot");
    let mut policy = DesiredDebuggerPolicy::new(initial);
    let mut replacement = breakpoint(&new_file, "secret-breakpoint-id", 7);
    replacement.condition = Some("token === 'secret-value'".to_string());
    let mut input = vec![replacement.clone()];
    let prepared = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &new_file,
            &input,
        )
        .expect("prepare replacement");
    input[0].line_number = 99;

    let debug = format!("{prepared:?}");
    assert!(debug.contains("breakpoint_count: 2"));
    assert!(!debug.contains("secret-breakpoint-id"));
    assert!(!debug.contains("secret-value"));
    assert!(!debug.contains(&new_file));

    assert_eq!(
        policy
            .commit_breakpoint_replacement(prepared)
            .expect("commit replacement"),
        INITIAL_DESIRED_POLICY_REVISION + 1
    );
    assert_eq!(policy.snapshot.breakpoints.len(), 2);
    assert!(policy
        .snapshot
        .breakpoints
        .contains(&breakpoint(&old_file, "old", 1)));
    assert!(policy.snapshot.breakpoints.contains(&replacement));
    assert_eq!(
        policy.snapshot.exception_pause_mode,
        DebugExceptionPauseMode::All
    );
    assert!(!policy.snapshot.breakpoints_active);
    assert_eq!(
        policy.snapshot.internal_step_filter,
        Some(DebugJustMyCodePolicy::Dependencies)
    );

    let remove_new_file = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &new_file,
            &[],
        )
        .expect("prepare file removal");
    policy
        .commit_breakpoint_replacement(remove_new_file)
        .expect("commit file removal");
    assert_eq!(
        policy.snapshot.breakpoints,
        vec![breakpoint(&old_file, "old", 1)]
    );
}

#[test]
fn commit_invalidates_old_replay_but_replay_commit_does_not_invalidate_prepare() {
    let fixture = Fixture::new();
    let file = fixture.file("replay.ts");
    let mut policy =
        DesiredDebuggerPolicy::new(snapshot(&fixture, vec![breakpoint(&file, "old", 1)]));
    let old_plan = policy.replay_plan();
    let prepared = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "new", 2)],
        )
        .expect("prepare while replay is in flight");

    assert!(policy.commit_replay(old_plan.clone()).is_ok());
    policy
        .commit_breakpoint_replacement(prepared)
        .expect("replay bookkeeping does not change desired authority");
    assert_eq!(
        policy.commit_replay(old_plan),
        Err(DesiredDebuggerReplayCommitError::Stale)
    );
    let current = policy.replay_plan();
    assert!(policy.commit_replay(current).is_ok());
}

#[test]
fn committed_transaction_produces_deterministic_complete_replay() {
    let fixture = Fixture::new();
    let z_file = fixture.file("z.ts");
    let a_file = fixture.file("a.ts");
    let mut policy = DesiredDebuggerPolicy::new(snapshot(&fixture, Vec::new()));
    let z_prepared = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &z_file,
            &[
                breakpoint(&z_file, "z-first", 9),
                breakpoint(&z_file, "z-second", 10),
            ],
        )
        .expect("prepare z set");
    policy
        .commit_breakpoint_replacement(z_prepared)
        .expect("commit z set");
    let a_prepared = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &a_file,
            &[breakpoint(&a_file, "a", 1)],
        )
        .expect("prepare a set");
    policy
        .commit_breakpoint_replacement(a_prepared)
        .expect("commit a set");

    let first = policy.replay_plan();
    assert_eq!(first, policy.replay_plan());
    let batches = first
        .steps()
        .iter()
        .filter_map(|step| match step {
            DesiredDebuggerReplayStep::SetBreakpoints {
                file_path,
                breakpoints,
            } => Some((
                file_path.as_str(),
                breakpoints
                    .iter()
                    .map(|breakpoint| breakpoint.id.as_str())
                    .collect::<Vec<_>>(),
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        batches,
        vec![
            (a_file.as_str(), vec!["a"]),
            (z_file.as_str(), vec!["z-first", "z-second"]),
        ]
    );
    assert!(matches!(
        first.steps().last(),
        Some(DesiredDebuggerReplayStep::RunIfWaitingForDebugger)
    ));
}

#[test]
fn competing_transactions_and_foreign_authority_fail_closed() {
    let fixture = Fixture::new();
    let file = fixture.file("competing.ts");
    let initial = snapshot(&fixture, vec![breakpoint(&file, "old", 1)]);
    let mut policy = DesiredDebuggerPolicy::new(initial.clone());
    let first = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "first", 2)],
        )
        .expect("first");
    let second = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "second", 3)],
        )
        .expect("second");
    policy
        .commit_breakpoint_replacement(first)
        .expect("first wins");
    let winner = policy.snapshot();
    let winner_revision = policy.revision();
    assert_eq!(
        policy.commit_breakpoint_replacement(second),
        Err(DesiredBreakpointReplacementCommitError::Stale)
    );

    let foreign = DesiredDebuggerPolicy::new(initial);
    let foreign_transaction = foreign
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "foreign", 4)],
        )
        .expect("foreign");
    assert_eq!(
        policy.commit_breakpoint_replacement(foreign_transaction),
        Err(DesiredBreakpointReplacementCommitError::Stale)
    );
    assert_eq!(policy.snapshot(), winner);
    assert_eq!(policy.revision(), winner_revision);
}

#[test]
fn invalid_prepare_has_no_side_effect_and_does_not_revoke_valid_token() {
    let fixture = Fixture::new();
    let file = fixture.file("invalid.ts");
    let other_file = fixture.file("other.ts");
    let initial = snapshot(&fixture, vec![breakpoint(&other_file, "occupied", 1)]);
    let mut policy = DesiredDebuggerPolicy::new(initial.clone());
    let applied = policy.replay_plan();
    policy.commit_replay(applied).expect("mark applied");
    let initial_applied_revision = policy.last_applied_revision;
    let valid = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "valid", 2)],
        )
        .expect("valid");
    assert!(policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "occupied", 3)],
        )
        .is_err());
    assert!(policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&other_file, "mismatched-path", 4)],
        )
        .is_err());
    assert_eq!(policy.revision(), INITIAL_DESIRED_POLICY_REVISION);
    assert_eq!(policy.snapshot(), initial);
    assert_eq!(policy.last_applied_revision, initial_applied_revision);
    policy
        .commit_breakpoint_replacement(valid)
        .expect("valid token remains current");
}

#[test]
fn exact_base_and_revision_exhaustion_are_checked_atomically() {
    let fixture = Fixture::new();
    let file = fixture.file("exact.ts");
    let initial = snapshot(&fixture, vec![breakpoint(&file, "old", 1)]);
    let mut policy = DesiredDebuggerPolicy::new(initial.clone());
    let stale = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "new", 2)],
        )
        .expect("prepare");
    policy.snapshot.breakpoints[0].line_number = 8;
    assert_eq!(
        policy.commit_breakpoint_replacement(stale),
        Err(DesiredBreakpointReplacementCommitError::Stale)
    );
    assert_eq!(policy.revision(), INITIAL_DESIRED_POLICY_REVISION);
    assert_eq!(policy.snapshot.breakpoints[0].line_number, 8);

    policy.snapshot = initial.clone();
    policy.revision = u64::MAX;
    assert!(policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "changed", 9)],
        )
        .is_err());
    assert_eq!(policy.revision(), u64::MAX);
    assert_eq!(policy.snapshot(), initial);

    let unchanged = policy
        .prepare_breakpoint_replacement(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &initial.breakpoints,
        )
        .expect("idempotent prepare at max");
    assert_eq!(
        policy
            .commit_breakpoint_replacement(unchanged)
            .expect("idempotent commit at max"),
        u64::MAX
    );
    assert_eq!(policy.snapshot(), initial);
}
