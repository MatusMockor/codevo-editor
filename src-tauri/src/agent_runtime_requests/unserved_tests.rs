use super::projection_race::PausingStore;
use super::rotation::{described, fast_rotation, feed, settle, Sink};
use super::*;
use crate::agent_runtime_requests::feed::FeedLimits;
use crate::agent_runtime_requests::model::ThreadRequests;
use crate::agent_runtime_requests::projection::{
    ProjectionError, RequestProjection, ThreadRequestsPage,
};
use crate::agent_runtime_requests::store::RuntimeRequestStore;

const LIVE_TURN: &str = "agt-turn-0002";

fn probing() -> FeedLimits {
    FeedLimits {
        probe: Duration::from_millis(100),
        ..fast_rotation()
    }
}

fn pull(boot: &Boot) -> Result<ThreadRequestsPage, ProjectionError> {
    RequestProjection::new(Arc::clone(&boot.journal)).page(
        &scope_of(ROOT),
        THREAD,
        &[TURN.to_string(), LIVE_TURN.to_string()],
        None,
    )
}

fn shown(message: &ThreadRequests) -> Vec<String> {
    message
        .parts()
        .requests
        .iter()
        .map(|request| format!("{}/{}", request.parts().turn_id, described(request)))
        .collect()
}

fn flags(message: &ThreadRequests) -> (JournalState, bool) {
    (message.parts().journal, message.parts().truncated)
}

fn pushed(sink: &Sink, id: &str) -> (JournalState, bool) {
    let messages = sink.messages.lock().expect("messages").clone();
    let message = messages
        .iter()
        .rfind(|message| {
            message
                .parts()
                .requests
                .iter()
                .any(|request| request.parts().id == id)
        })
        .expect("a push of the live request");
    flags(message)
}

fn assert_live_only(boot: &Boot, sink: &Sink, live: &LiveTurn) {
    let page = pull(boot).expect("a live-only page");
    assert_eq!(flags(&page.message), (JournalState::Degraded, true));
    assert_eq!(
        shown(&page.message),
        ["agt-turn-0002/question-2:pending:live"]
    );
    assert_eq!(page.next_cursor, None);
    assert_eq!(pushed(sink, "question-2"), (JournalState::Degraded, true));
    live.ask("question-3");
    assert!(boot.journal.flush(FLUSH));
    assert!(eventually(|| sink
        .messages
        .lock()
        .expect("messages")
        .iter()
        .any(|message| shown(message)
            .iter()
            .any(|shown| shown.contains("question-3")))));
    assert_eq!(pushed(sink, "question-3"), (JournalState::Degraded, true));
    std::thread::sleep(Duration::from_millis(500));
    assert!(sink.invalidations().is_empty());
    let messages = sink.messages.lock().expect("messages").clone();
    assert!(messages.iter().all(|message| !message.parts().reset));
}

fn assert_history_adopted(boot: &Boot, sink: &Sink) {
    assert!(eventually(|| sink
        .messages
        .lock()
        .expect("messages")
        .iter()
        .any(
            |message| message.parts().reset && message.parts().thread_id == THREAD
        )));
    assert_eq!(boot.journal.unserved().failing(), 0);
    let healed = pull(boot).expect("the stored history");
    let shown = shown(&healed.message);
    assert!(!healed.message.parts().truncated, "{shown:?}");
    assert!(
        shown
            .iter()
            .any(|shown| shown.starts_with("agt-turn-0001/question-1:expired:")),
        "{shown:?}"
    );
    assert!(shown.contains(&"agt-turn-0002/question-2:pending:live".to_string()));
}

fn earlier_run(fixture: &Fixture) -> Boot {
    let earlier = Boot::start(fixture, "boot-0001");
    earlier.turn(THREAD, TURN, "workspace-1").ask("question-1");
    assert!(earlier.journal.flush(FLUSH));
    earlier
}

#[test]
fn second_instance_without_the_lease_serves_live_requests_until_the_lease_frees() {
    let fixture = Fixture::new();
    let first = earlier_run(&fixture);
    let second = Boot::start(&fixture, "boot-0002");
    let (sink, feed) = feed(&second, probing());
    let live = second.turn(THREAD, LIVE_TURN, "workspace-1");
    live.ask("question-2");
    settle(&second, &feed);

    assert_live_only(&second, &sink, &live);
    drop(first);

    assert_history_adopted(&second, &sink);
}

#[test]
fn unreadable_history_serves_live_requests_until_it_heals_and_deletion_still_fails() {
    let fixture = Fixture::new();
    drop(earlier_run(&fixture));
    let store = Arc::new(PausingStore::over(&fixture));
    store.fail_reads.store(true, Ordering::SeqCst);
    let boot = Boot::start_over(
        Arc::clone(&store) as Arc<dyn RuntimeRequestStore>,
        "boot-0002",
        patient_answers(),
    );
    let (sink, feed) = feed(&boot, probing());
    let live = boot.turn(THREAD, LIVE_TURN, "workspace-1");
    live.ask("question-2");
    settle(&boot, &feed);

    assert_live_only(&boot, &sink, &live);
    store.fail_reads.store(false, Ordering::SeqCst);

    assert_history_adopted(&boot, &sink);
    fixture.store.save(ROOT, &owner(), &thread(), 0).unwrap();
    fixture.store.delete(ROOT, &owner(), THREAD).unwrap();
    assert_eq!(pull(&boot).map(|_| ()), Err(ProjectionError::ThreadDeleted));
}
