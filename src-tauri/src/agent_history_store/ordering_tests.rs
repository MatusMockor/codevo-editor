use super::*;

fn settled_turn(index: usize) -> AgentTurn {
    let mut settled = running_turn(index);
    settled.status = legacy::AgentTurnStatus::Exited { exit_code: 0 };
    settled.ended_at_epoch_ms = Some(3);
    settled.last_status_sequence = 2;
    settled
}

fn background_reply(index: usize) -> AgentTurn {
    let mut reply = turn(index);
    reply.prompt = "Background reply".into();
    reply.status = legacy::AgentTurnStatus::Exited { exit_code: 0 };
    reply
}

fn prompted_turn(index: usize) -> AgentTurn {
    serde_json::from_value(json!({"turnId":format!("agt-turn-{index:04}"),"prompt":"follow-up","status":{"kind":"failed","message":"spawn failed"},"startedAtEpochMs":4,"endedAtEpochMs":5,"events":[],"eventsTruncated":false,"lastStatusSequence":1,"lastOutputSequence":0,"launch":{"provider":"claudeCode","model":"opus","mode":"plan"},"cliVersion":null})).unwrap()
}

fn ids(indices: &[usize]) -> Vec<String> {
    indices
        .iter()
        .map(|index| format!("agt-turn-{index:04}"))
        .collect()
}

fn order_after(batches: Vec<Vec<AgentTurn>>) -> Vec<String> {
    let fixture = Fixture::new();
    let mut saved = thread();
    for (revision, turns) in [vec![turn(0)], vec![turn(0), running_turn(1)]]
        .into_iter()
        .chain(batches)
        .enumerate()
    {
        saved.turns = turns;
        fixture
            .store
            .save(ROOT, &owner(), &saved, revision as u64)
            .unwrap();
    }
    let reopened = AgentHistoryStore::new(fixture.base.clone());
    saved_order(&reopened, &saved.thread_id)
}

#[test]
fn a_background_reply_and_the_settled_lead_turn_saved_in_one_batch_keep_the_batch_order() {
    assert_eq!(
        order_after(vec![vec![turn(0), background_reply(2), settled_turn(1)]]),
        ids(&[0, 2, 1])
    );
    assert_eq!(
        order_after(vec![vec![turn(0), settled_turn(1), background_reply(2)]]),
        ids(&[0, 1, 2])
    );
}

#[test]
fn a_background_reply_and_the_settled_lead_turn_saved_in_two_batches_keep_the_save_order() {
    assert_eq!(
        order_after(vec![
            vec![turn(0), background_reply(2), running_turn(1)],
            vec![turn(0), background_reply(2), settled_turn(1)],
        ]),
        ids(&[0, 2, 1])
    );
    assert_eq!(
        order_after(vec![
            vec![turn(0), settled_turn(1)],
            vec![turn(0), settled_turn(1), background_reply(2)],
        ]),
        ids(&[0, 1, 2])
    );
    assert_eq!(
        order_after(vec![vec![background_reply(2)], vec![settled_turn(1)]]),
        ids(&[0, 2, 1])
    );
    assert_eq!(
        order_after(vec![vec![settled_turn(1)], vec![background_reply(2)]]),
        ids(&[0, 1, 2])
    );
}

#[test]
fn a_stale_running_turn_left_by_a_crash_is_ordered_by_the_batch_that_follows_it() {
    let mut recovered = running_turn(1);
    recovered.status = legacy::AgentTurnStatus::Interrupted;
    assert_eq!(
        order_after(vec![vec![turn(0), recovered, background_reply(2)]]),
        ids(&[0, 1, 2])
    );
    assert_eq!(
        order_after(vec![vec![turn(0), running_turn(1), background_reply(2)]]),
        ids(&[0, 1, 2])
    );
    assert_eq!(
        order_after(vec![vec![background_reply(2)], vec![background_reply(3)]]),
        ids(&[0, 2, 3, 1])
    );
}

#[test]
fn a_prompted_finished_turn_saved_while_the_last_turn_runs_follows_the_same_rule() {
    assert_eq!(
        order_after(vec![vec![turn(0), prompted_turn(2), running_turn(1)]]),
        ids(&[0, 2, 1])
    );
    assert_eq!(order_after(vec![vec![prompted_turn(2)]]), ids(&[0, 2, 1]));
    assert_eq!(
        order_after(vec![vec![turn(0), running_turn(1), prompted_turn(2)]]),
        ids(&[0, 1, 2])
    );
}
