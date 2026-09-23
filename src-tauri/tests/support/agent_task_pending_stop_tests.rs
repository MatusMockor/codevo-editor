use super::*;
use agent_task_supervisor::agent_task_pending_stops::AGENT_TASK_STOPPED_BEFORE_START_ERROR;

const WORKSPACE: &str = "ws-agent-tests";

fn start_in_place(fixture: &Fixture, task_id: &str, workspace_id: &str) -> Result<(), String> {
    let root = unique_path("pending-stop");
    let admission = fixture
        .admission
        .reserve(
            &workspace(workspace_id),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    fixture
        .registry
        .start(
            AgentTaskStartRequest {
                workspace_id: workspace_id.to_string(),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
                ..start_request(task_id, &root)
            },
            fake_plan(&root),
            admission,
        )
        .map(|_| ())
}

fn admission_is_released(fixture: &Fixture) -> bool {
    let root = unique_path("pending-stop-probe");
    (0..AGENT_TASK_GLOBAL_LIMIT)
        .map(|_| {
            fixture.admission.reserve(
                &workspace("ws-probe"),
                &root,
                &root,
                AgentTaskIsolation::InPlace,
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .is_ok()
}

#[test]
fn a_stop_for_an_unregistered_task_prevents_its_later_start() {
    let fixture = fixture(Duration::from_secs(60));
    fixture
        .spawner
        .script(FakeSpawnOutcome::Fail("must remain queued".to_string()));
    fixture
        .registry
        .stop_for_workspace("agt-early-stop", WORKSPACE)
        .expect("stop is recorded for a task that is still starting");
    assert!(fixture
        .registry
        .stop_pending_before_start("agt-early-stop", WORKSPACE));

    let error = start_in_place(&fixture, "agt-early-stop", WORKSPACE).expect_err("stopped start");

    assert_eq!(error, AGENT_TASK_STOPPED_BEFORE_START_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 1);
    assert!(!fixture
        .registry
        .stop_pending_before_start("agt-early-stop", WORKSPACE));
    assert!(fixture.registry.acknowledge("agt-early-stop").is_err());
    assert!(admission_is_released(&fixture));
}

#[test]
fn a_pending_stop_is_consumed_once_and_never_blocks_another_task() {
    let fixture = fixture(Duration::from_secs(60));
    for _ in 0..2 {
        fixture
            .spawner
            .script(FakeSpawnOutcome::Fail("spawn refused".to_string()));
    }
    fixture
        .registry
        .stop_for_workspace("agt-stopped", WORKSPACE)
        .expect("stop recorded");

    let other = start_in_place(&fixture, "agt-other", WORKSPACE).expect_err("spawn refused");
    assert_ne!(other, AGENT_TASK_STOPPED_BEFORE_START_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 1);

    let stopped = start_in_place(&fixture, "agt-stopped", WORKSPACE).expect_err("stopped");
    assert_eq!(stopped, AGENT_TASK_STOPPED_BEFORE_START_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 1);

    let retried = start_in_place(&fixture, "agt-stopped", WORKSPACE).expect_err("spawn refused");
    assert_ne!(retried, AGENT_TASK_STOPPED_BEFORE_START_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 0);
}

#[test]
fn a_foreign_workspace_stop_cannot_cancel_another_workspace_start() {
    let fixture = fixture(Duration::from_secs(60));
    fixture
        .spawner
        .script(FakeSpawnOutcome::Fail("spawn refused".to_string()));
    fixture
        .registry
        .stop_for_workspace("agt-owned", "ws-foreign")
        .expect("stop recorded");

    assert!(!fixture
        .registry
        .stop_pending_before_start("agt-owned", WORKSPACE));
    let error = start_in_place(&fixture, "agt-owned", WORKSPACE).expect_err("spawn refused");
    assert_ne!(error, AGENT_TASK_STOPPED_BEFORE_START_ERROR);
    assert_eq!(fixture.spawner.pending_outcomes(), 0);
}

#[test]
fn a_failed_start_command_discards_its_pending_stop() {
    let fixture = fixture(Duration::from_secs(60));
    fixture
        .registry
        .stop_for_workspace("agt-discarded", WORKSPACE)
        .expect("stop recorded");

    fixture
        .registry
        .discard_pending_stop("agt-discarded", "ws-foreign");
    assert!(fixture
        .registry
        .stop_pending_before_start("agt-discarded", WORKSPACE));
    fixture
        .registry
        .discard_pending_stop("agt-discarded", WORKSPACE);

    assert!(!fixture
        .registry
        .stop_pending_before_start("agt-discarded", WORKSPACE));
}
