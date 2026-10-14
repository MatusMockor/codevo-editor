use super::*;

const OTHER_THREAD: &str = "agt-thread-0002";

fn forgetful() -> JournalLimits {
    JournalLimits {
        retired_turns: 0,
        ..patient_answers()
    }
}

fn watermarks(fixture: &Fixture) -> Vec<String> {
    let connection = raw_history(fixture);
    let mut statement = connection
        .prepare("SELECT thread_id||'/'||turn_id FROM runtime_request_turns ORDER BY 1")
        .expect("watermark statement");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("watermark rows");
    rows.map(|row| row.expect("watermark row")).collect()
}

fn incarnation_of(turn: &LiveTurn) -> u64 {
    turn.scope
        .as_ref()
        .map(|scope| scope.incarnation)
        .expect("scoped turn")
}

#[test]
fn turn_identifiers_stay_refused_until_the_earlier_turn_with_them_has_no_journal_work_left() {
    let fixture = Fixture::new();
    let boot = Boot::start_with(&fixture, "boot-0001", forgetful());
    let mut first = boot.turn(THREAD, TURN, "workspace-1");
    let mut bystander = boot.turn(OTHER_THREAD, "agt-turn-0002", "workspace-1");
    first.ask("question-1");
    bystander.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    assert_eq!(watermarks(&fixture).len(), 2);
    let attempt = boot.begin(&first, "question-1");
    assert!(attempt.is_recorded());
    first.ask("question-2");

    drop(first.tracking.take());
    drop(bystander.tracking.take());

    assert!(eventually(
        || watermarks(&fixture) == [format!("{THREAD}/{TURN}")]
    ));
    for root in [ROOT, OTHER_ROOT] {
        let reused = boot.journal.track_turn(&scope_of(root), THREAD, TURN);
        assert!(reused.is_err(), "{root}");
    }
    assert_eq!(boot.journal.queued_turns(), 1);
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD))),
        ["question-1:submitting:unknown"]
    );

    attempt.settle(IntentSettlement::Reverted, boot.next_version());

    assert_eq!(
        summary(&boot.settled()),
        ["question-1:pending:-", "question-2:pending:-"]
    );
    assert_eq!(boot.journal.health().state, JournalState::Saved);
    assert!(boot
        .journal
        .track_turn(&scope_of(ROOT), THREAD, TURN)
        .is_ok());
}

#[test]
fn turn_reusing_forgotten_identifiers_is_a_new_incarnation_the_earlier_one_can_no_longer_touch() {
    let fixture = Fixture::new();
    let boot = Boot::start_with(&fixture, "boot-0001", forgetful());
    let mut first = boot.turn(THREAD, TURN, "workspace-1");
    first.ask("question-1");
    first.ask("question-2");
    assert_eq!(boot.settled().len(), 2);
    drop(first.tracking.take());

    let second = boot.turn(THREAD, TURN, "workspace-2");
    assert!(incarnation_of(&second) > incarnation_of(&first));
    second.ask("question-9");
    let taken_over = [
        "question-1:expired:turnEnded",
        "question-2:expired:turnEnded",
        "question-9:pending:-",
    ];
    assert_eq!(summary(&boot.settled()), taken_over);
    assert_eq!(boot.journal.health().state, JournalState::Saved);
    let settled = dump(&fixture);

    first.ask("question-3");
    assert_eq!(first.answer("question-2").map(|_| ()), Ok(()));
    assert_eq!(summary(&boot.settled()), taken_over);
    assert_eq!(dump(&fixture), settled);
    assert_eq!(boot.journal.health().late_snapshots, 2);
    assert_eq!(
        failures(&boot, THREAD),
        [(TURN.to_string(), JournalFailure::TurnForgotten)]
    );

    let outdated = boot.begin(&first, "question-1");
    assert!(!outdated.is_recorded());
    assert_eq!(first.answer("question-1").map(|_| ()), Ok(()));
    outdated.delivered();
    assert_eq!(dump(&fixture), settled);
    assert_eq!(boot.journal.health().unsaved_answers, 1);

    second.ask("question-10");
    let current = boot.begin(&second, "question-9");
    assert!(current.is_recorded());
    assert_eq!(second.answer("question-9").map(|_| ()), Ok(()));
    current.delivered();

    assert_eq!(
        summary(&boot.settled()),
        [
            "question-1:expired:turnEnded",
            "question-2:expired:turnEnded",
            "question-9:resolved:unknown",
            "question-10:pending:-",
        ]
    );
    assert_eq!(
        failures(&boot, THREAD),
        [(TURN.to_string(), JournalFailure::AnswerUnsaved)]
    );
    assert_eq!(boot.journal.thread_state(THREAD), JournalState::Degraded);
}

#[test]
fn history_directory_redirected_to_another_project_degrades_the_journal_and_spares_that_project() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    let neighbour = boot.turn_in(OTHER_ROOT, OTHER_THREAD, "agt-turn-0002", "workspace-2");
    turn.ask("question-1");
    neighbour.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let directory_of = |root: &str| {
        connection::database_path(&fixture.base, root)
            .parent()
            .expect("history directory")
            .to_path_buf()
    };
    let (own, other) = (directory_of(ROOT), directory_of(OTHER_ROOT));
    let spared = dump_of(&fixture, OTHER_ROOT);
    fs::rename(&own, own.with_extension("moved")).expect("move the history directory away");
    std::os::unix::fs::symlink(&other, &own).expect("redirect the history directory");

    let attempt = boot.begin(&turn, "question-1");
    assert!(!attempt.is_recorded());
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    attempt.delivered();
    assert!(boot.journal.flush(FLUSH));

    assert_eq!(turn.delivered(), 1);
    assert_eq!(dump_of(&fixture, OTHER_ROOT), spared);
    let health = boot.journal.health();
    assert_eq!(health.state, JournalState::Degraded);
    assert_eq!(health.unsaved_answers, 1);
    assert_eq!(
        failures(&boot, THREAD),
        [(
            TURN.to_string(),
            JournalFailure::WriteFailed(StoreErrorKind::Unavailable)
        )]
    );
    assert_eq!(boot.journal.thread_state(OTHER_THREAD), JournalState::Saved);
    neighbour.ask("question-2");
    assert!(boot.journal.flush(FLUSH));
    assert_eq!(dump_of(&fixture, OTHER_ROOT).len(), 2);
}
