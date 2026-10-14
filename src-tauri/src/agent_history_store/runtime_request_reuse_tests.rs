use super::*;
use crate::agent_runtime_requests::model::RequestKind;
use crate::agent_runtime_requests::observed::{DigestedRequest, DigestedState};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

fn old_answer() -> ObservedState {
    ObservedState::Resolved(answers("Old answer."))
}

fn turn_states(journaled: &Journaled) -> Vec<String> {
    let connection = journaled.raw();
    let mut statement = connection
        .prepare("SELECT run_id||'/'||turn_id FROM runtime_request_turns ORDER BY 1")
        .expect("turn state statement");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("turn state rows");
    rows.map(|row| row.expect("turn state row")).collect()
}

#[test]
fn turn_ids_reused_in_the_same_run_never_hide_a_new_answer_behind_the_old_closed_request() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(1, vec![question("question-1", old_answer())]),
    );
    let completed = journaled.dump();

    let reused = journaled.apply(
        RUN,
        &snapshot(
            5,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!((reused.transitions, reused.skipped), (1, 1));
    assert!(journaled.read().truncated);
    let new_answer = journaled.store.record_intent(
        &journaled.scope,
        RUN,
        &intent("question-1", answers("New answer."), 6),
        before_deadline(),
    );
    assert_eq!(new_answer, Ok(IntentReceipt::NotJournaled));

    let answered_again = journaled.apply(
        RUN,
        &snapshot(
            7,
            vec![
                question(
                    "question-1",
                    ObservedState::Resolved(answers("New answer.")),
                ),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!((answered_again.transitions, answered_again.skipped), (0, 1));
    let closed_instead = journaled.apply(
        RUN,
        &snapshot(
            8,
            vec![
                question("question-1", expired()),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!((closed_instead.transitions, closed_instead.skipped), (0, 1));
    let same_answer = journaled.apply(
        RUN,
        &snapshot(
            9,
            vec![
                question("question-1", old_answer()),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!((same_answer.transitions, same_answer.skipped), (0, 0));

    assert_eq!(journaled.dump()[0], completed[0]);
    assert_eq!(
        journaled.wire()[0]["resolution"]["answers"][0]["text"],
        json!("Old answer.")
    );
}

#[test]
fn request_closed_by_a_previous_run_is_reported_when_a_new_turn_reuses_its_ids() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", old_answer()),
            ],
        ),
    );
    journaled.recover_as(NEXT_RUN, 60_000);
    let recovered = journaled.dump();

    let reused = journaled.apply(
        NEXT_RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", old_answer()),
                question("question-3", ObservedState::Pending),
            ],
        ),
    );

    assert_eq!((reused.transitions, reused.skipped), (1, 2));
    for request_id in ["question-1", "question-2"] {
        assert_eq!(
            journaled.intend(NEXT_RUN, request_id, 2),
            IntentReceipt::NotJournaled,
            "{request_id}"
        );
    }
    assert_eq!(journaled.dump()[..2], recovered[..]);
    assert!(journaled.read().truncated);
}

const REUSED: u64 = 2;

fn reused_snapshot(sequence: u64, requests: Vec<ObservedRequest>) -> TurnObservation {
    TurnObservation {
        incarnation: REUSED,
        ..snapshot(sequence, requests)
    }
}

fn settle_as(journaled: &Journaled, incarnation: u64, versions: (u64, u64)) -> bool {
    journaled
        .store
        .settle_intent(
            &journaled.scope,
            RUN,
            &IntentSettle {
                key: key(TURN),
                incarnation,
                request_id: "question-9".to_string(),
                intent_version: versions.0,
                settlement: IntentSettlement::DeliveryFailed,
                version: versions.1,
                at_epoch_ms: 9_000,
            },
            before_deadline(),
        )
        .expect("settle intent")
}

fn states(journaled: &Journaled) -> Vec<String> {
    journaled
        .dump()
        .iter()
        .map(|row| row.split(':').take(3).collect::<Vec<_>>().join(":"))
        .collect()
}

#[test]
fn newer_incarnation_of_a_turn_closes_what_its_predecessor_left_open_and_the_older_one_is_refused()
{
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                question("question-3", old_answer()),
            ],
        ),
    );
    assert_eq!(
        journaled.intend(RUN, "question-2", 2),
        IntentReceipt::Recorded
    );

    let reused = journaled.apply(
        RUN,
        &reused_snapshot(5, vec![question("question-9", ObservedState::Pending)]),
    );

    assert_eq!((reused.transitions, reused.superseded), (3, false));
    let taken_over = [
        "agt-turn-0001/question-1:expired:turnEnded",
        "agt-turn-0001/question-2:expired:answerUnconfirmed",
        "agt-turn-0001/question-3:resolved:-",
        "agt-turn-0001/question-9:pending:-",
    ];
    assert_eq!(states(&journaled), taken_over);
    let settled = journaled.dump();

    let late = journaled.apply(
        RUN,
        &snapshot(
            9,
            vec![
                question("question-1", old_answer()),
                question("question-2", old_answer()),
                question("question-8", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(
        late,
        ApplyReport {
            superseded: true,
            ..ApplyReport::default()
        }
    );
    assert_eq!(
        journaled.intend(RUN, "question-9", 10),
        IntentReceipt::NotJournaled
    );
    assert_eq!(journaled.dump(), settled);

    let current = AnswerIntent {
        incarnation: REUSED,
        ..intent("question-9", answers("Nothing else."), 11)
    };
    assert_eq!(
        journaled
            .store
            .record_intent(&journaled.scope, RUN, &current, before_deadline()),
        Ok(IntentReceipt::Recorded)
    );
    let submitting = journaled.dump();
    assert!(!settle_as(&journaled, INCARNATION, (11, 12)));
    assert_eq!(journaled.dump(), submitting);
    assert!(settle_as(&journaled, REUSED, (11, 12)));
    assert_eq!(
        states(&journaled)[3],
        "agt-turn-0001/question-9:expired:deliveryFailed"
    );
}

#[test]
fn intent_and_settlement_of_a_turn_whose_state_was_forgotten_are_refused() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-9", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(
        journaled.intend(RUN, "question-9", 2),
        IntentReceipt::Recorded
    );
    assert_eq!(
        journaled
            .store
            .retain_turn_states(&journaled.scope, RUN, &[]),
        Ok(1)
    );
    let forgotten = journaled.dump();

    assert_eq!(
        journaled.intend(RUN, "question-1", 3),
        IntentReceipt::NotJournaled
    );
    assert!(!settle_as(&journaled, INCARNATION, (2, 4)));
    assert_eq!(journaled.dump(), forgotten);
}

#[test]
fn digest_closes_saved_requests_and_counts_the_registrations_it_cannot_place() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                approval("approval-1", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(
        journaled.intend(RUN, "approval-1", 2),
        IntentReceipt::Recorded
    );
    let mut refused = snapshot(
        3,
        vec![
            question("question-1", expired()),
            question("question-2", old_answer()),
            approval("approval-1", ObservedState::Resolved(decision())),
            question("question-new", ObservedState::Pending),
        ],
    );
    refused.turn = refused.turn.into_digest();
    assert!(refused.turn.requests.is_empty());
    assert_eq!(
        refused.turn.digested[1],
        DigestedRequest {
            id: "question-2".to_string(),
            kind: RequestKind::Question,
            state: DigestedState::Resolved,
        }
    );

    let report = journaled.apply(RUN, &refused);

    assert_eq!((report.transitions, report.skipped), (3, 1));
    assert_eq!(report.lost_answers, 1);
    let read = journaled.read();
    assert_eq!(read.unreadable, 1);
    assert!(read.truncated);
    let wire = journaled.wire();
    assert_eq!(wire.len(), 2);
    assert_eq!(wire[0]["id"], json!("question-1"));
    assert_eq!(wire[0]["status"], json!("expired"));
    assert_eq!(wire[0]["responseCapability"]["reason"], json!("turnEnded"));
    assert_eq!(wire[1]["id"], json!("approval-1"));
    assert_eq!(wire[1]["status"], json!("resolved"));
    assert_eq!(
        wire[1]["resolution"],
        json!({"kind": "decision", "decision": "deny"})
    );
    assert_eq!(journaled.row_count(), 3);
    let again = journaled.apply(RUN, &refused);
    assert!(again.stale);

    let mut ended = snapshot(4, Vec::new());
    ended.turn = ended.turn.into_digest();
    assert_eq!(journaled.apply(RUN, &ended), ApplyReport::default());
}

#[test]
fn retained_turn_states_forget_only_turns_of_this_run_the_journal_no_longer_knows() {
    let journaled = Journaled::new();
    for turn_id in ["agt-turn-a", "agt-turn-b", "agt-turn-c"] {
        journaled.apply(
            RUN,
            &snapshot_of(
                turn_id,
                1,
                1_000,
                vec![question("question-1", ObservedState::Pending)],
            ),
        );
    }
    journaled.apply(
        NEXT_RUN,
        &snapshot_of(
            "agt-turn-foreign",
            1,
            1_000,
            vec![question("question-1", ObservedState::Pending)],
        ),
    );
    let rows = journaled.dump();

    let forgotten = journaled.store.retain_turn_states(
        &journaled.scope,
        RUN,
        &[
            key("agt-turn-a"),
            key("agt-turn-c"),
            key("agt-turn-unsaved"),
        ],
    );

    assert_eq!(forgotten, Ok(1));
    assert_eq!(
        turn_states(&journaled),
        [
            "boot-0001/agt-turn-a",
            "boot-0001/agt-turn-c",
            "boot-0002/agt-turn-foreign"
        ]
    );
    assert_eq!(journaled.dump(), rows);
    assert_eq!(
        journaled
            .store
            .retain_turn_states(&journaled.scope, RUN, &[]),
        Ok(2)
    );
    assert_eq!(turn_states(&journaled), ["boot-0002/agt-turn-foreign"]);
}

#[test]
fn intent_and_settlement_past_their_deadline_are_refused_before_touching_the_request() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
            ],
        ),
    );
    assert_eq!(
        journaled.intend(RUN, "question-2", 2),
        IntentReceipt::Recorded
    );
    let before = journaled.dump();

    let late_intent = journaled.store.record_intent(
        &journaled.scope,
        RUN,
        &intent("question-1", answers("Too late."), 3),
        Instant::now(),
    );
    let late_settlement = journaled.store.settle_intent(
        &journaled.scope,
        RUN,
        &IntentSettle {
            key: key(TURN),
            incarnation: INCARNATION,
            request_id: "question-2".to_string(),
            intent_version: 2,
            settlement: IntentSettlement::DeliveryFailed,
            version: 4,
            at_epoch_ms: 9_000,
        },
        Instant::now(),
    );

    assert_eq!(
        late_intent.map_err(|error| error.kind),
        Err(StoreErrorKind::DeadlineExceeded)
    );
    assert_eq!(
        late_settlement.map_err(|error| error.kind),
        Err(StoreErrorKind::DeadlineExceeded)
    );
    assert_eq!(journaled.dump(), before);
}

#[test]
fn child_process_spawned_while_the_lease_is_held_does_not_inherit_it() {
    let first = Journaled::new();
    let mut child = Command::new("/bin/sleep")
        .arg("30")
        .spawn()
        .expect("spawn a child process");
    let Journaled {
        fixture,
        store,
        scope,
    } = first;
    drop(store);
    let second = HistoryRuntimeRequestStore::new(fixture.base.clone());

    let claimed = second.claim_root(&scope, NEXT_RUN, 1);
    let killed = child.kill();
    let reaped = child.wait();

    assert!(matches!(claimed, Ok(RootClaim::Acquired(_))), "{claimed:?}");
    assert!(killed.is_ok());
    assert!(reaped.is_ok());
}

#[test]
fn lease_held_by_another_process_is_respected_until_that_process_exits() {
    let fixture = Fixture::new();
    let scope = HistoryScope {
        root_key: ROOT.to_string(),
        owner_id: owner(),
    };
    AgentHistoryStore::new(fixture.base.clone())
        .load(ROOT, &scope.owner_id)
        .expect("create the history database");
    let lease =
        connection::database_path(&fixture.base, ROOT).with_file_name("runtime-requests.lock");
    let mut holder = Command::new("perl")
        .arg("-e")
        .arg(
            "use Fcntl qw(:flock); open(my $lease, '>>', $ARGV[0]) or die; \
             flock($lease, LOCK_EX) or die; $| = 1; print \"locked\\n\"; <STDIN>;",
        )
        .arg(&lease)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("perl holds the lease in another process");
    let mut announced = String::new();
    BufReader::new(holder.stdout.take().expect("holder output"))
        .read_line(&mut announced)
        .expect("holder announcement");
    let store = HistoryRuntimeRequestStore::new(fixture.base.clone());

    let while_held = store.claim_root(&scope, RUN, 1);
    drop(holder.stdin.take());
    let exited = holder.wait();
    let after_exit = store.claim_root(&scope, RUN, 2);

    assert_eq!(announced, "locked\n");
    assert_eq!(while_held, Ok(RootClaim::HeldByAnotherInstance));
    assert!(exited.is_ok_and(|status| status.success()));
    assert!(
        matches!(after_exit, Ok(RootClaim::Acquired(_))),
        "{after_exit:?}"
    );
}
