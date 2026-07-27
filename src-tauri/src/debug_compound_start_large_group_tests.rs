use super::tests::{start_compound_commit_test_member, CompoundCommitTestSink};
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn compound_request_with_member_count(member_count: usize) -> DebugCompoundStartRequest {
    let member = DebugCompoundStartMember {
        launch: DebugCompoundLaunchTarget::Script {
            script_path: "/workspace/a.js".to_string(),
            source_maps: None,
            smart_step: None,
            stop_on_entry: None,
        },
        breakpoints: Vec::new(),
        exception_pause_mode: DebugExceptionPauseMode::None,
        exception_type_filter: Vec::new(),
    };
    DebugCompoundStartRequest {
        root_path: "/workspace".to_string(),
        members: vec![member; member_count],
        stop_all: true,
    }
}

#[test]
fn compound_member_bound_accepts_eight_and_rejects_nine_fail_closed() {
    assert!(valid_request_shape(&compound_request_with_member_count(8)));
    assert!(!valid_request_shape(&compound_request_with_member_count(9)));
    assert_eq!(
        compound_start_error(),
        DebugCompoundStartResponse::Error {
            message: COMPOUND_START_ERROR.to_string(),
        }
    );
}

#[test]
fn eight_member_start_never_runs_more_than_one_member_factory_concurrently() {
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let result =
        tauri::async_runtime::block_on(start_compound_members_sequentially(0..8, |member| {
            let active = Arc::clone(&active);
            let maximum = Arc::clone(&maximum);
            async move {
                let concurrent = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum.fetch_max(concurrent, Ordering::SeqCst);
                std::thread::yield_now();
                active.fetch_sub(1, Ordering::SeqCst);
                Ok::<usize, ()>(member)
            }
        }))
        .expect("eight serialized starts");

    assert_eq!(result, (0..8).collect::<Vec<_>>());
    assert_eq!(maximum.load(Ordering::SeqCst), 1);
}

#[test]
fn late_eighth_member_failure_rolls_back_every_started_member() {
    let registry = DebugSessionRegistry::new();
    let root = "/workspace/compound-late-failure";
    let group = registry.begin_start_group(root).expect("startup group");
    let sink = Arc::new(CompoundCommitTestSink);
    let mut terminated = Vec::new();
    let mut session_ids = Vec::new();

    let result = tauri::async_runtime::block_on(start_compound_group_members(
        &registry,
        &group,
        0..8,
        |index| {
            if index == 7 {
                return std::future::ready(Err("late member failure".to_string()));
            }
            let (session_id, member_terminated) =
                start_compound_commit_test_member(&registry, &group, Arc::clone(&sink));
            session_ids.push(session_id);
            terminated.push(member_terminated);
            std::future::ready(Ok(session_id))
        },
    ));

    assert_eq!(result, Err("late member failure".to_string()));
    assert!(terminated
        .iter()
        .all(|member| member.load(Ordering::SeqCst)));
    assert!(session_ids
        .iter()
        .all(|session_id| !registry.owns_session(root, *session_id)));
    assert_eq!(registry.session_id_for_root(root), None);
    assert!(!registry.startup_group_is_current(&group));
}

#[test]
fn stop_all_reaps_all_eight_compound_members() {
    let registry = DebugSessionRegistry::new();
    let root = "/workspace/compound-stop-all";
    let group = registry.begin_start_group(root).expect("startup group");
    let sink = Arc::new(CompoundCommitTestSink);
    let members = (0..8)
        .map(|_| start_compound_commit_test_member(&registry, &group, Arc::clone(&sink)))
        .collect::<Vec<_>>();

    registry.stop_all();

    assert!(members
        .iter()
        .all(|(_, terminated)| terminated.load(Ordering::SeqCst)));
    assert!(members
        .iter()
        .all(|(session_id, _)| !registry.owns_session(root, *session_id)));
    assert_eq!(registry.session_id_for_root(root), None);
    assert!(!registry.startup_group_is_current(&group));
}

#[test]
fn natural_exit_stop_all_retires_all_eight_compound_members() {
    let registry = DebugSessionRegistry::new();
    let root = "/workspace/compound-natural-exit";
    let group = registry.begin_start_group(root).expect("startup group");
    let sink = Arc::new(CompoundCommitTestSink);
    let members = (0..8)
        .map(|_| start_compound_commit_test_member(&registry, &group, Arc::clone(&sink)))
        .collect::<Vec<_>>();

    assert!(registry.finish_group_session(&group, members[7].0, Some(1)));

    assert!(members[..7]
        .iter()
        .all(|(_, terminated)| terminated.load(Ordering::SeqCst)));
    assert!(members
        .iter()
        .all(|(session_id, _)| !registry.owns_session(root, *session_id)));
    assert_eq!(registry.session_id_for_root(root), None);
    assert!(!registry.startup_group_is_current(&group));
}
