use super::*;

const ANSWERED_THREAD: &str = "agt-thread-0001";
const BUSY_THREAD: &str = "agt-thread-0002";

#[test]
fn answer_known_only_from_a_digest_keeps_its_thread_degraded_and_is_reported_after_a_restart() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        queued_turns: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let answered = boot.turn(ANSWERED_THREAD, "agt-turn-0001", "workspace-1");
    answered.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let busy = boot.turn(BUSY_THREAD, "agt-turn-0002", "workspace-1");
    busy.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let hold = boot.begin(&busy, "question-1");
    assert!(hold.is_recorded());
    busy.ask("question-2");
    assert_eq!(boot.journal.queued_turns(), 1);

    assert_eq!(answered.answer("question-1").map(|_| ()), Ok(()));

    assert!(eventually(|| boot.journal.health().lost_answers == 1));
    assert_eq!(
        failures(&boot, ANSWERED_THREAD),
        [("agt-turn-0001".to_string(), JournalFailure::AnswerLost)]
    );
    hold.settle(IntentSettlement::Reverted, boot.next_version());
    assert!(boot.journal.flush(FLUSH));
    answered.ask("question-2");
    assert!(boot.journal.flush(FLUSH));

    let incomplete = |boot: &Boot| {
        let read = boot.read(ROOT, ANSWERED_THREAD);
        (summary(&wire(&read)), read.unreadable, read.truncated)
    };
    let expected = (vec!["question-2:pending:-".to_string()], 1, true);
    assert_eq!(incomplete(&boot), expected);
    assert_eq!(
        failures(&boot, ANSWERED_THREAD),
        [("agt-turn-0001".to_string(), JournalFailure::AnswerLost)]
    );
    assert_eq!(
        boot.journal.thread_state(ANSWERED_THREAD),
        JournalState::Degraded
    );
    assert_eq!(boot.journal.thread_state(BUSY_THREAD), JournalState::Saved);
    assert_eq!(boot.journal.health().state, JournalState::Degraded);
    assert!(dump(&fixture)
        .iter()
        .any(|row| row.contains("/agt-turn-0001/question-1:resolved:")));

    drop((answered, busy, boot));
    let restarted = Boot::start(&fixture, "boot-0002");
    let (requests, unreadable, truncated) = incomplete(&restarted);
    assert_eq!(requests, ["question-2:expired:appRestarted"]);
    assert_eq!((unreadable, truncated), (1, true));
}
