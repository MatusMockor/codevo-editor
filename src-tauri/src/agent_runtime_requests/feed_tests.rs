use super::*;
use crate::agent_runtime_requests::feed::{FeedLimits, RequestFeed, ThreadRequestsSink};
use crate::agent_runtime_requests::model::{wire_name, RuntimeRequest, ThreadRequests};
use crate::agent_runtime_requests::projection::{ProjectionLimits, RequestProjection};
use crate::agent_runtime_requests::scopes::TurnAuthority;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Condvar;

type Hook = Box<dyn Fn() + Send + Sync>;

#[derive(Default)]
struct Recording {
    invalidations: Mutex<Vec<String>>,
    messages: Mutex<Vec<ThreadRequests>>,
    closed_gate: Mutex<bool>,
    gate: Condvar,
    entered: AtomicUsize,
    hook: Mutex<Option<Hook>>,
}

impl Recording {
    fn close_gate(&self) {
        *self.closed_gate.lock().expect("gate") = true;
    }

    fn open_gate(&self) {
        *self.closed_gate.lock().expect("gate") = false;
        self.gate.notify_all();
    }

    fn published(&self) -> Vec<ThreadRequests> {
        self.messages.lock().expect("messages").clone()
    }
}

impl ThreadRequestsSink for Recording {
    fn invalidate(&self, epoch: &str) {
        self.invalidations
            .lock()
            .expect("invalidations")
            .push(epoch.to_string());
    }

    fn publish(&self, message: ThreadRequests) {
        self.entered.fetch_add(1, Ordering::SeqCst);
        if let Some(hook) = self.hook.lock().expect("hook").take() {
            hook();
        }
        let mut closed = self.closed_gate.lock().expect("gate");
        while *closed {
            closed = self.gate.wait(closed).expect("gate");
        }
        drop(closed);
        self.messages.lock().expect("messages").push(message);
    }
}

struct Fed {
    sink: Arc<Recording>,
    feed: RequestFeed,
    boot: Boot,
    read: usize,
}

impl Fed {
    fn start(fixture: &Fixture) -> Self {
        Self::start_with(
            Boot::start_with(fixture, "boot-0001", patient_answers()),
            FeedLimits::default(),
        )
    }

    fn start_with(boot: Boot, limits: FeedLimits) -> Self {
        let sink = Arc::new(Recording::default());
        let feed = RequestFeed::start_with_limits(
            &boot.journal,
            Arc::clone(&sink) as Arc<dyn ThreadRequestsSink>,
            limits,
            ProjectionLimits::default(),
        );
        assert!(feed.is_running());
        Self {
            sink,
            feed,
            boot,
            read: 0,
        }
    }

    fn settle(&self) {
        assert!(self.boot.journal.flush(FLUSH), "journal did not settle");
        assert!(self.feed.settle(FLUSH), "feed did not settle");
    }

    fn next(&mut self) -> Vec<ThreadRequests> {
        self.settle();
        let published = self.sink.published();
        let fresh = published[self.read..].to_vec();
        self.read = published.len();
        for message in &fresh {
            assert_pushed_on_the_wire(message);
        }
        fresh
    }
}

fn assert_pushed_on_the_wire(message: &ThreadRequests) {
    let encoded = serde_json::to_value(message).expect("encode the message");
    let decoded: ThreadRequests =
        serde_json::from_value(encoded.clone()).expect("the message obeys the wire contract");
    assert_eq!(&decoded, message);
    assert_eq!(encoded["epoch"], Value::String("boot-0001".into()));
    assert!(encoded["workspaceId"].is_string(), "{message:?}");
    assert!(message.parts().requests.len() <= 64);
}

fn described(request: &RuntimeRequest) -> String {
    let parts = request.parts();
    let reason = parts
        .lifecycle
        .reason()
        .and_then(|reason| wire_name(&reason))
        .unwrap_or_else(|| "live".to_string());
    let status = wire_name(&request.status()).expect("status name");
    format!("{}:{status}:{reason}", parts.id)
}

fn only_record(messages: &[ThreadRequests]) -> (String, u64) {
    assert_eq!(messages.len(), 1, "{messages:?}");
    let parts = messages[0].parts();
    assert!(!parts.reset);
    assert_eq!(parts.thread_id, THREAD);
    assert_eq!(parts.workspace_id.as_deref(), Some("workspace-1"));
    assert_eq!(parts.requests.len(), 1, "{:?}", parts.requests);
    let request = &parts.requests[0];
    assert_eq!(request.parts().turn_id, TURN);
    (described(request), request.parts().version)
}

#[test]
fn every_transition_is_pushed_once_for_its_turn_with_a_higher_version() {
    let fixture = Fixture::new();
    let mut fed = Fed::start(&fixture);
    let turn = fed.boot.turn(THREAD, TURN, "workspace-1");
    let mut pushed: Vec<(String, u64)> = Vec::new();

    turn.ask("question-1");
    pushed.push(only_record(&fed.next()));
    let attempt = fed.boot.begin(&turn, "question-1");
    assert!(attempt.is_recorded());
    pushed.push(only_record(&fed.sink_next()));
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    pushed.push(only_record(&fed.sink_next()));
    attempt.delivered();
    assert!(fed.next().is_empty());

    turn.ask("question-2");
    pushed.push(only_record(&fed.next()));
    turn.session.cancel("question-2");
    pushed.push(only_record(&fed.next()));

    turn.ask_approval("approval-1");
    pushed.push(only_record(&fed.next()));
    let decided =
        turn.session
            .approvals()
            .answer(TURN, "approval-1", AgentApprovalDecision::AllowOnce);
    assert_eq!(decided.map(|_| ()), Ok(()));
    pushed.push(only_record(&fed.next()));

    turn.ask("question-3");
    pushed.push(only_record(&fed.next()));
    let reverted = fed.boot.begin(&turn, "question-3");
    pushed.push(only_record(&fed.sink_next()));
    reverted.settle(IntentSettlement::Reverted, fed.boot.next_version());
    pushed.push(only_record(&fed.next()));
    turn.session.finish();
    pushed.push(only_record(&fed.next()));

    let states: Vec<&str> = pushed.iter().map(|(state, _)| state.as_str()).collect();
    assert_eq!(
        states,
        [
            "question-1:pending:live",
            "question-1:submitting:unknown",
            "question-1:resolved:unknown",
            "question-2:pending:live",
            "question-2:cancelled:providerCancelled",
            "approval-1:pending:live",
            "approval-1:resolved:unknown",
            "question-3:pending:live",
            "question-3:submitting:unknown",
            "question-3:pending:live",
            "question-3:expired:turnEnded",
        ]
    );
    let versions: Vec<u64> = pushed.iter().map(|(_, version)| *version).collect();
    assert!(
        versions.windows(2).all(|pair| pair[0] < pair[1]),
        "{versions:?}"
    );

    let stale = turn.session.snapshot(TURN, "workspace-1");
    fed.boot.journal.observe(turn.scope.as_ref(), THREAD, stale);
    assert!(fed.next().is_empty(), "an unchanged turn was pushed again");
    let pulled = RequestProjection::new(Arc::clone(&fed.boot.journal))
        .page(&scope_of(ROOT), THREAD, &[TURN.to_string()], None)
        .expect("pull");
    assert_eq!(pulled.message.parts().requests.len(), 4);
    assert!(fed.next().is_empty(), "a pull caused a push");
}

impl Fed {
    fn sink_next(&mut self) -> Vec<ThreadRequests> {
        assert!(self.feed.settle(FLUSH), "feed did not settle");
        let published = self.sink.published();
        let fresh = published[self.read..].to_vec();
        self.read = published.len();
        for message in &fresh {
            assert_pushed_on_the_wire(message);
        }
        fresh
    }
}

#[test]
fn blocked_emitter_never_stalls_the_writer_and_more_than_a_page_of_changes_is_a_reset() {
    let fixture = Fixture::new();
    let mut fed = Fed::start(&fixture);
    let turn = fed.boot.turn(THREAD, TURN, "workspace-1");
    fed.sink.close_gate();
    turn.ask("question-000");
    assert!(eventually(|| fed.sink.entered.load(Ordering::SeqCst) == 1));

    for index in 1..=70 {
        let id = format!("question-{index:03}");
        turn.ask(&id);
        turn.session.cancel(&id);
        assert!(
            fed.boot.journal.flush(FLUSH),
            "the writer waited for the emitter"
        );
    }
    let attempt = fed.boot.begin(&turn, "question-000");
    assert!(attempt.is_recorded());
    attempt.settle(IntentSettlement::Reverted, fed.boot.next_version());
    assert!(
        fed.boot.journal.flush(FLUSH),
        "the writer waited for the emitter"
    );
    assert_eq!(dump(&fixture).len(), 71);
    assert!(fed.sink.published().is_empty());
    assert!(!fed.feed.settle(Duration::from_millis(50)));

    fed.sink.open_gate();
    let pushed = fed.next();

    assert_eq!(pushed.len(), 2, "{pushed:?}");
    assert_eq!(pushed[0].parts().requests.len(), 1);
    assert!(!pushed[0].parts().reset);
    assert!(pushed[1].parts().reset);
    assert!(pushed[1].parts().requests.is_empty());
    turn.ask("question-next");
    let (state, _) = only_record(&fed.next());
    assert_eq!(state, "question-next:pending:live");
}

#[test]
fn sink_is_called_without_any_journal_session_or_feed_lock_held() {
    let fixture = Fixture::new();
    let mut fed = Fed::start(&fixture);
    let turn = fed.boot.turn(THREAD, TURN, "workspace-1");
    let finished = Arc::new(AtomicBool::new(false));
    let (journal, session, done) = (
        Arc::clone(&fed.boot.journal),
        Arc::clone(&turn.session),
        Arc::clone(&finished),
    );
    let scope = turn.scope.clone();
    *fed.sink.hook.lock().expect("hook") = Some(Box::new(move || {
        let _ = journal.health();
        let _ = journal.queued_turns();
        let _ = journal.thread_state(THREAD);
        let _ = journal.live_turns();
        let _ = journal.flush(Duration::ZERO);
        drop(journal.track_turn(&scope_of(ROOT), THREAD, "agt-turn-0002"));
        let _ = session.list(TURN);
        let reentrant = session.snapshot(TURN, "workspace-1");
        journal.observe(scope.as_ref(), THREAD, reentrant);
        let pulled = RequestProjection::new(Arc::clone(&journal)).page(
            &scope_of(ROOT),
            THREAD,
            &[TURN.to_string()],
            None,
        );
        done.store(pulled.is_ok(), Ordering::SeqCst);
    }));

    turn.ask("question-1");
    assert!(eventually(|| finished.load(Ordering::SeqCst)));

    let pushed = fed.next();
    let (state, _) = only_record(&pushed);
    assert_eq!(
        state,
        "question-1:pending:live",
        "{pushed:?} {:?}",
        turn.session.list(TURN)
    );
}

#[test]
fn pending_request_of_a_running_turn_is_pushed_while_the_journal_cannot_be_written() {
    let fixture = Fixture::new();
    let mut fed = Fed::start(&fixture);
    set_base_mode(&fixture, READ_ONLY);
    let turn = fed.boot.turn(THREAD, TURN, "workspace-1");

    turn.ask("question-1");
    let degraded = fed.next();

    set_base_mode(&fixture, WRITABLE);
    let records: Vec<String> = degraded
        .iter()
        .flat_map(|message| message.parts().requests.iter().map(described))
        .collect();
    assert_eq!(records, ["question-1:pending:live"]);
    let last = degraded.last().expect("a pushed message").parts();
    assert_eq!(last.journal, JournalState::Degraded);
    assert!(degraded.iter().all(|message| !message.parts().reset));

    turn.ask("question-2");
    let recovered = fed.next();

    let reset = recovered.last().expect("a pushed message").parts();
    assert_eq!(reset.journal, JournalState::Saved);
    assert!(recovered.iter().any(|message| message.parts().reset));
    let saved: Vec<String> = recovered
        .iter()
        .flat_map(|message| message.parts().requests.iter().map(described))
        .collect();
    assert!(
        saved.contains(&"question-2:pending:live".to_string()),
        "{saved:?}"
    );
    assert_eq!(dump(&fixture).len(), 2);
    assert_eq!(turn.answer("question-1").map(|_| ()), Ok(()));
    let (state, _) = only_record(&fed.next());
    assert_eq!(state, "question-1:resolved:unknown");
}

#[derive(Default)]
struct Client {
    known: HashMap<(String, String, String), (u64, String)>,
}

impl Client {
    fn merge(&mut self, message: &ThreadRequests) {
        let parts = message.parts();
        if parts.reset {
            let thread = parts.thread_id.clone();
            self.known.retain(|(known, _, _), _| known != &thread);
        }
        for request in &parts.requests {
            let key = (
                parts.thread_id.clone(),
                request.parts().turn_id.clone(),
                request.parts().id.clone(),
            );
            let newer = self
                .known
                .get(&key)
                .is_none_or(|(version, _)| request.parts().version > *version);
            if newer {
                self.known
                    .insert(key, (request.parts().version, described(request)));
            }
        }
    }

    fn state(&self, thread_id: &str, turn_id: &str, id: &str) -> Option<String> {
        let key = (thread_id.to_string(), turn_id.to_string(), id.to_string());
        self.known.get(&key).map(|(_, state)| state.clone())
    }
}

impl Client {
    fn receive(&mut self, boot: &Boot, messages: &[ThreadRequests], turns: &[(&str, &str)]) {
        for message in messages {
            self.merge(message);
            if !message.parts().reset {
                continue;
            }
            let thread_id = message.parts().thread_id.as_str();
            let turn_ids: Vec<&str> = turns
                .iter()
                .filter(|(thread, _)| *thread == thread_id)
                .map(|(_, turn)| *turn)
                .collect();
            self.merge(&pulled(boot, thread_id, &turn_ids));
        }
    }
}

fn pulled(boot: &Boot, thread_id: &str, turn_ids: &[&str]) -> ThreadRequests {
    let turn_ids: Vec<String> = turn_ids.iter().map(|turn_id| turn_id.to_string()).collect();
    RequestProjection::new(Arc::clone(&boot.journal))
        .page(&scope_of(ROOT), thread_id, &turn_ids, None)
        .expect("pull")
        .message
}

#[test]
fn discarding_an_unsaved_final_snapshot_still_supersedes_what_the_client_holds() {
    let fixture = Fixture::new();
    let store = Arc::new(HistoryRuntimeRequestStore::with_snapshot_busy_timeout(
        fixture.base.clone(),
        Duration::from_millis(20),
    ));
    let limits = JournalLimits {
        ended_turns: 1,
        ..patient_answers()
    };
    let mut fed = Fed::start_with(
        Boot::start_over(store, "boot-0001", limits),
        FeedLimits::default(),
    );
    let mut first = fed.boot.turn(THREAD, TURN, "workspace-1");
    let mut second = fed
        .boot
        .turn("agt-thread-0002", "agt-turn-0002", "workspace-1");
    first.ask("question-1");
    second.ask("question-1");
    let turns = [(THREAD, TURN), ("agt-thread-0002", "agt-turn-0002")];
    let mut client = Client::default();
    let initial = fed.next();
    client.receive(&fed.boot, &initial, &turns);
    assert_eq!(
        client.state(THREAD, TURN, "question-1").as_deref(),
        Some("question-1:pending:live"),
        "{initial:?}"
    );
    let blocker = raw_history(&fixture);
    blocker
        .execute_batch("BEGIN IMMEDIATE;")
        .expect("hold the write lock");
    fed.sink.close_gate();

    drop(first.tracking.take());
    first.session.finish();
    drop(second.tracking.take());
    second.session.finish();
    assert!(fed.boot.journal.flush(FLUSH));
    blocker
        .execute_batch("ROLLBACK;")
        .expect("release the write lock");
    drop(blocker);
    assert_eq!(
        summary(&wire(&fed.boot.read(ROOT, THREAD))),
        ["question-1:pending:-"]
    );
    fed.sink.open_gate();

    let after_ending = fed.next();
    client.receive(&fed.boot, &after_ending, &turns);
    let pushed = client.state(THREAD, TURN, "question-1");
    let pull = pulled(&fed.boot, THREAD, &[TURN]);
    client.merge(&pull);

    assert_ne!(pushed.as_deref(), Some("question-1:pending:live"));
    assert_eq!(
        client.state(THREAD, TURN, "question-1").as_deref(),
        Some("question-1:expired:turnEnded")
    );
    assert_eq!(pull.parts().journal, JournalState::Degraded);
}

#[test]
fn feed_that_cannot_remember_another_dirty_turn_resets_that_turns_own_thread() {
    let fixture = Fixture::new();
    let limits = FeedLimits {
        turns: 1,
        ..FeedLimits::default()
    };
    let mut fed = Fed::start_with(
        Boot::start_with(&fixture, "boot-0001", patient_answers()),
        limits,
    );
    let first = fed.boot.turn(THREAD, TURN, "workspace-1");
    let second = fed
        .boot
        .turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    first.ask("question-1");
    second.ask("question-1");
    let mut client = Client::default();
    for message in fed.next() {
        client.merge(&message);
    }
    let published_before = fed.sink.entered.load(Ordering::SeqCst);
    fed.sink.close_gate();
    first.ask("question-2");
    assert!(eventually(
        || fed.sink.entered.load(Ordering::SeqCst) == published_before + 1
    ));
    first.ask("question-3");
    second.session.cancel("question-1");
    assert!(fed.boot.journal.flush(FLUSH));

    fed.sink.open_gate();
    let pushed = fed.next();

    let resets: Vec<&str> = pushed
        .iter()
        .filter(|message| message.parts().reset)
        .map(|message| message.parts().thread_id.as_str())
        .collect();
    assert_eq!(resets, ["agt-thread-0002"], "{pushed:?}");
    for message in &pushed {
        client.merge(message);
    }
    assert_eq!(
        client.state("agt-thread-0002", "agt-turn-0002", "question-1"),
        None
    );
    let pull = RequestProjection::new(Arc::clone(&fed.boot.journal))
        .page(
            &scope_of(ROOT),
            "agt-thread-0002",
            &["agt-turn-0002".to_string()],
            None,
        )
        .expect("pull")
        .message;
    client.merge(&pull);
    assert_eq!(
        client
            .state("agt-thread-0002", "agt-turn-0002", "question-1")
            .as_deref(),
        Some("question-1:cancelled:providerCancelled")
    );
    assert_eq!(
        client.state(THREAD, TURN, "question-3").as_deref(),
        Some("question-3:pending:live")
    );
}

#[test]
fn forgotten_feed_entry_never_turns_a_replayed_snapshot_into_a_push() {
    let fixture = Fixture::new();
    let limits = FeedLimits {
        turns: 1,
        ..FeedLimits::default()
    };
    let mut fed = Fed::start_with(
        Boot::start_with(&fixture, "boot-0001", patient_answers()),
        limits,
    );
    let first = fed.boot.turn(THREAD, TURN, "workspace-1");
    first.ask("question-1");
    assert_eq!(fed.next().len(), 1);
    let unchanged = first.session.snapshot(TURN, "workspace-1");
    let second = fed
        .boot
        .turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    second.ask("question-1");
    assert_eq!(fed.next().len(), 1);

    fed.boot
        .journal
        .observe(first.scope.as_ref(), THREAD, unchanged);
    let republished = first.session.snapshot(TURN, "workspace-1");
    fed.boot
        .journal
        .observe(first.scope.as_ref(), THREAD, republished);

    assert!(fed.next().is_empty(), "an unchanged turn was pushed again");
    first.ask("question-2");
    let (state, _) = only_record(&fed.next());
    assert_eq!(state, "question-2:pending:live");
}

#[test]
fn queued_final_update_keeps_its_watermark_after_the_tracker_forgot_the_turn() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        retired_turns: 1,
        ..patient_answers()
    };
    let mut fed = Fed::start_with(
        Boot::start_with(&fixture, "boot-0001", limits),
        FeedLimits::default(),
    );
    let mut ended = fed.boot.turn(THREAD, TURN, "workspace-1");
    let busy = fed
        .boot
        .turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    ended.ask("question-1");
    assert_eq!(fed.next().len(), 1);
    let published_before = fed.sink.entered.load(Ordering::SeqCst);
    fed.sink.close_gate();
    busy.ask("question-1");
    assert!(eventually(
        || fed.sink.entered.load(Ordering::SeqCst) == published_before + 1
    ));

    drop(ended.tracking.take());
    ended.session.finish();
    assert!(fed.boot.journal.flush(FLUSH));
    for index in 3..6 {
        drop(fed.boot.turn(
            "agt-thread-0003",
            &format!("agt-turn-000{index}"),
            "workspace-3",
        ));
    }
    assert_eq!(
        fed.boot.journal.pushed_through(&ended_authority(&ended)),
        None
    );
    fed.sink.open_gate();
    let pushed = fed.next();

    let finals: Vec<&ThreadRequests> = pushed
        .iter()
        .filter(|message| message.parts().thread_id == THREAD)
        .collect();
    assert_eq!(finals.len(), 1, "{pushed:?}");
    assert!(!finals[0].parts().reset);
    let records: Vec<String> = finals[0].parts().requests.iter().map(described).collect();
    assert_eq!(records, ["question-1:expired:turnEnded"]);
}

fn ended_authority(turn: &LiveTurn) -> TurnAuthority {
    let scope = turn.scope.clone().expect("a scoped turn");
    TurnAuthority::of_task(&scope, &turn.thread_id, &turn.turn_id)
}

#[test]
fn queued_resets_keep_their_workspace_and_overflowing_resets_move_to_a_new_epoch() {
    let fixture = Fixture::new();
    let limits = FeedLimits {
        turns: 1,
        threads: 1,
        resets: 1,
        ..FeedLimits::default()
    };
    let mut fed = Fed::start_with(
        Boot::start_with(&fixture, "boot-0001", patient_answers()),
        limits,
    );
    let first = fed.boot.turn(THREAD, TURN, "workspace-1");
    let second = fed
        .boot
        .turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    let third = fed
        .boot
        .turn("agt-thread-0003", "agt-turn-0003", "workspace-3");
    fed.next();
    let published_before = fed.sink.entered.load(Ordering::SeqCst);
    fed.sink.close_gate();
    first.ask("question-1");
    assert!(eventually(
        || fed.sink.entered.load(Ordering::SeqCst) == published_before + 1
    ));
    first.ask("question-2");
    second.ask("question-1");
    third.ask("question-1");
    assert!(fed.boot.journal.flush(FLUSH));

    fed.sink.open_gate();
    let pushed = fed.sink_next_unchecked();

    let resets: Vec<(&str, Option<&str>, &str)> = pushed
        .iter()
        .filter(|message| message.parts().reset)
        .map(|message| {
            let parts = message.parts();
            (
                parts.thread_id.as_str(),
                parts.workspace_id.as_deref(),
                parts.epoch.as_str(),
            )
        })
        .collect();
    assert!(
        resets.contains(&("agt-thread-0002", Some("workspace-2"), "boot-0001.1")),
        "{resets:?}"
    );
    assert_eq!(
        *fed.sink.invalidations.lock().expect("invalidations"),
        ["boot-0001.1"]
    );
    let pulled = RequestProjection::new(Arc::clone(&fed.boot.journal))
        .page(&scope_of(ROOT), THREAD, &[TURN.to_string()], None)
        .expect("pull");
    assert_eq!(pulled.message.parts().epoch, "boot-0001.1");
}

impl Fed {
    fn sink_next_unchecked(&mut self) -> Vec<ThreadRequests> {
        self.settle();
        let published = self.sink.published();
        let fresh = published[self.read..].to_vec();
        self.read = published.len();
        fresh
    }
}
