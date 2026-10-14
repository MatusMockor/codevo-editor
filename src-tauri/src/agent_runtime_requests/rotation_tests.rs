use super::projection_race::PausingStore;
use super::*;
use crate::agent_runtime_requests::abandonment::RotationPolicy;
use crate::agent_runtime_requests::feed::{FeedLimits, RequestFeed, ThreadRequestsSink};
use crate::agent_runtime_requests::model::{wire_name, RuntimeRequest, ThreadRequests};
use crate::agent_runtime_requests::projection::{
    ProjectionError, ProjectionLimits, RequestProjection,
};
use crate::agent_runtime_requests::store::RuntimeRequestStore;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

#[derive(Default)]
struct Sink {
    messages: Mutex<Vec<ThreadRequests>>,
    invalidations: Mutex<Vec<String>>,
    invalidated_at: Mutex<Vec<Instant>>,
    closed_gate: Mutex<bool>,
    gate: std::sync::Condvar,
    entered: AtomicUsize,
}

impl Sink {
    fn close_gate(&self) {
        *self.closed_gate.lock().expect("gate") = true;
    }

    fn open_gate(&self) {
        *self.closed_gate.lock().expect("gate") = false;
        self.gate.notify_all();
    }

    fn invalidations(&self) -> Vec<String> {
        self.invalidations.lock().expect("invalidations").clone()
    }
}

impl ThreadRequestsSink for Sink {
    fn publish(&self, message: ThreadRequests) {
        self.entered.fetch_add(1, Ordering::SeqCst);
        let mut closed = self.closed_gate.lock().expect("gate");
        while *closed {
            closed = self.gate.wait(closed).expect("gate");
        }
        drop(closed);
        self.messages.lock().expect("messages").push(message);
    }

    fn invalidate(&self, epoch: &str) {
        self.invalidated_at
            .lock()
            .expect("invalidation times")
            .push(Instant::now());
        self.invalidations
            .lock()
            .expect("invalidations")
            .push(epoch.to_string());
    }
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

#[derive(Default)]
struct Client {
    epoch: Option<String>,
    known: HashMap<(String, String), (u64, String)>,
    taken: usize,
}

impl Client {
    fn merge(&mut self, message: &ThreadRequests) {
        let parts = message.parts();
        if self.epoch.as_deref() != Some(parts.epoch.as_str()) || parts.reset {
            self.known.clear();
            self.epoch = Some(parts.epoch.clone());
        }
        for request in &parts.requests {
            let key = (request.parts().turn_id.clone(), request.parts().id.clone());
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

    fn invalidated(&mut self, epoch: &str) {
        self.known.clear();
        self.epoch = Some(epoch.to_string());
    }

    fn catch_up(&mut self, sink: &Sink, boot: &Boot, turn_ids: &[&str]) {
        let messages = sink.messages.lock().expect("messages").clone();
        for message in &messages[self.taken..] {
            self.merge(message);
        }
        self.taken = messages.len();
        if sink
            .invalidations()
            .last()
            .is_some_and(|epoch| self.epoch.as_deref() != Some(epoch.as_str()))
        {
            let epoch = sink.invalidations().last().cloned().expect("an epoch");
            self.invalidated(&epoch);
        }
        self.merge(&pull(boot, turn_ids));
    }

    fn state(&self, turn_id: &str, id: &str) -> Option<&str> {
        self.known
            .get(&(turn_id.to_string(), id.to_string()))
            .map(|(_, state)| state.as_str())
    }
}

fn pull(boot: &Boot, turn_ids: &[&str]) -> ThreadRequests {
    let turn_ids: Vec<String> = turn_ids.iter().map(|turn_id| turn_id.to_string()).collect();
    RequestProjection::new(Arc::clone(&boot.journal))
        .page(&scope_of(ROOT), THREAD, &turn_ids, None)
        .expect("pull")
        .message
}

fn fast_rotation() -> FeedLimits {
    FeedLimits {
        rotation: RotationPolicy {
            interval: Duration::from_millis(400),
            grace: Duration::from_millis(50),
            ..RotationPolicy::default()
        },
        ..FeedLimits::default()
    }
}

fn feed(boot: &Boot, limits: FeedLimits) -> (Arc<Sink>, RequestFeed) {
    let sink = Arc::new(Sink::default());
    let feed = RequestFeed::start_with_limits(
        &boot.journal,
        Arc::clone(&sink) as Arc<dyn ThreadRequestsSink>,
        limits,
        ProjectionLimits::default(),
    );
    (sink, feed)
}

fn settle(boot: &Boot, feed: &RequestFeed) {
    assert!(boot.journal.flush(FLUSH));
    assert!(feed.settle(FLUSH));
}

#[test]
fn obsolete_incarnation_never_projects_the_rows_of_the_turn_that_reused_its_ids() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        retired_turns: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let (sink, feed) = feed(&boot, FeedLimits::default());
    let mut old = boot.turn(THREAD, TURN, "workspace-1");
    let busy = boot.turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    old.ask("question-1");
    settle(&boot, &feed);
    let mut client = Client::default();
    client.catch_up(&sink, &boot, &[TURN]);
    assert_eq!(
        client.state(TURN, "question-1"),
        Some("question-1:pending:live")
    );
    let entered = sink.entered.load(Ordering::SeqCst);
    sink.close_gate();
    busy.ask("question-1");
    assert!(eventually(
        || sink.entered.load(Ordering::SeqCst) == entered + 1
    ));

    drop(old.tracking.take());
    old.session.finish();
    assert!(boot.journal.flush(FLUSH));
    for index in 3..6 {
        drop(boot.turn(
            "agt-thread-0003",
            &format!("agt-turn-000{index}"),
            "workspace-3",
        ));
    }
    let reused = boot.turn(THREAD, TURN, "workspace-1");
    reused.ask("question-2");
    assert!(boot.journal.flush(FLUSH));
    sink.open_gate();
    settle(&boot, &feed);
    client.catch_up(&sink, &boot, &[TURN]);

    assert_eq!(
        client.state(TURN, "question-2"),
        Some("question-2:pending:live")
    );
    assert_eq!(boot.journal.abandoned_turns(), 0);
    assert!(sink.invalidations().is_empty());
}

#[test]
fn panic_inside_a_store_write_leaves_pulls_and_rotation_working() {
    let fixture = Fixture::new();
    let store = Arc::new(PausingStore::over(&fixture));
    let boot = Boot::start_over(
        Arc::clone(&store) as Arc<dyn RuntimeRequestStore>,
        "boot-0001",
        patient_answers(),
    );
    let (sink, feed) = feed(&boot, fast_rotation());
    let mut turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    settle(&boot, &feed);
    store.panic_next_apply.store(true, Ordering::SeqCst);
    turn.ask("question-2");
    settle(&boot, &feed);
    turn.ask("question-3");
    settle(&boot, &feed);
    let mut client = Client::default();
    client.catch_up(&sink, &boot, &[TURN]);
    assert_eq!(
        client.state(TURN, "question-3"),
        Some("question-3:pending:live")
    );

    drop(turn.tracking.take());
    assert!(eventually(|| !sink.invalidations().is_empty()));
    settle(&boot, &feed);
    client.catch_up(&sink, &boot, &[TURN]);

    for id in ["question-1", "question-2", "question-3"] {
        assert_eq!(
            client.state(TURN, id).map(str::to_string),
            Some(format!("{id}:expired:turnEnded"))
        );
    }
}

#[test]
fn sustained_writes_on_another_project_never_starve_a_pull() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let mut ended = boot.turn(THREAD, TURN, "workspace-1");
    ended.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    drop(ended.tracking.take());
    let busy = boot.turn_in(
        OTHER_ROOT,
        "agt-thread-0002",
        "agt-turn-0002",
        "workspace-2",
    );
    let stop = Arc::new(AtomicBool::new(false));
    let writer = {
        let stop = Arc::clone(&stop);
        let session = Arc::clone(&busy.session);
        let journal = Arc::clone(&boot.journal);
        std::thread::spawn(move || {
            let mut index = 0u32;
            while !stop.load(Ordering::SeqCst) {
                let id = format!("question-{index}");
                let registered = session.register(
                    AgentQuestionRequest {
                        id: id.clone(),
                        task_id: String::new(),
                        provider: "codex".into(),
                        questions: vec![AgentQuestion {
                            id: "notes".into(),
                            header: String::new(),
                            prompt: "Anything else to consider?".into(),
                            options: Vec::new(),
                            multiple: false,
                            allow_custom: true,
                        }],
                        status: AgentQuestionStatus::Pending,
                        answers: None,
                    },
                    Arc::new(|_| Ok(())),
                );
                assert_eq!(registered, Ok(()));
                session.cancel(&id);
                let _ = journal.flush(Duration::from_millis(5));
                index += 1;
            }
        })
    };

    for _ in 0..20 {
        let page = pull(&boot, &[TURN]);
        let listed: Vec<String> = page.parts().requests.iter().map(described).collect();
        assert_eq!(listed, ["question-1:expired:turnEnded"]);
    }

    stop.store(true, Ordering::SeqCst);
    writer.join().expect("the writer thread");
}

fn paged_turn(boot: &Boot) -> (LiveTurn, RequestProjection) {
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    for index in 0..10 {
        let id = format!("question-{index:02}");
        turn.ask(&id);
        turn.session.cancel(&id);
    }
    assert!(boot.journal.flush(FLUSH));
    let one_record = pull(boot, &[TURN]).parts().requests[0].clone();
    let cost = serde_json::to_vec(&one_record).expect("encode").len() + 1;
    let projection = RequestProjection::with_limits(
        Arc::clone(&boot.journal),
        ProjectionLimits {
            page_bytes: 1024 + cost + cost / 2,
            ..ProjectionLimits::default()
        },
    );
    (turn, projection)
}

#[test]
fn rotation_during_a_page_never_mixes_epochs_in_one_answer() {
    let fixture = Fixture::new();
    let store = Arc::new(PausingStore::over(&fixture));
    let boot = Boot::start_over(
        Arc::clone(&store) as Arc<dyn RuntimeRequestStore>,
        "boot-0001",
        patient_answers(),
    );
    let (_turn, projection) = paged_turn(&boot);
    let turn_ids = [TURN.to_string()];
    let journal = Arc::clone(&boot.journal);
    *store.after_first_entries.lock().expect("hook") = Some(Box::new(move || {
        journal.rotate_epoch(RotationPolicy::default());
    }));

    let first = projection
        .page(&scope_of(ROOT), THREAD, &turn_ids, None)
        .expect("the first page after a rotation");

    assert_eq!(first.message.parts().epoch, "boot-0001.1");
    let cursor = first.next_cursor.expect("more pages");
    let second = projection
        .page(&scope_of(ROOT), THREAD, &turn_ids, Some(&cursor))
        .expect("the cursor belongs to the epoch of its page");
    assert_eq!(second.message.parts().epoch, "boot-0001.1");
    let cursor = second.next_cursor.expect("more pages");
    let journal = Arc::clone(&boot.journal);
    *store.after_first_entries.lock().expect("hook") = Some(Box::new(move || {
        journal.rotate_epoch(RotationPolicy::default());
    }));
    assert_eq!(
        projection
            .page(&scope_of(ROOT), THREAD, &turn_ids, Some(&cursor))
            .map(|_| ()),
        Err(ProjectionError::StaleCursor)
    );
}

#[test]
fn epoch_rotates_at_most_once_per_interval_and_only_while_abandonment_persists() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let (sink, feed) = feed(&boot, fast_rotation());
    let mut finished = boot.turn("agt-thread-0009", "agt-turn-0009", "workspace-1");
    finished.ask("question-1");
    settle(&boot, &feed);
    drop(finished.tracking.take());
    finished.session.finish();
    settle(&boot, &feed);
    std::thread::sleep(Duration::from_millis(250));
    assert!(
        sink.invalidations().is_empty(),
        "a normal finish rotated the epoch"
    );

    let mut first = boot.turn(THREAD, TURN, "workspace-1");
    first.ask("question-1");
    settle(&boot, &feed);
    let mut client = Client::default();
    client.catch_up(&sink, &boot, &[TURN, "agt-turn-0002"]);
    drop(first.tracking.take());
    assert!(eventually(|| sink.invalidations().len() == 1));
    let rotated_at = Instant::now();
    let mut second = boot.turn(THREAD, "agt-turn-0002", "workspace-1");
    second.ask("question-1");
    settle(&boot, &feed);
    drop(second.tracking.take());
    settle(&boot, &feed);
    std::thread::sleep(Duration::from_millis(150));
    if rotated_at.elapsed() < Duration::from_millis(380) {
        assert_eq!(sink.invalidations().len(), 1);
    }
    assert!(eventually(|| sink.invalidations().len() == 2));
    let times = sink
        .invalidated_at
        .lock()
        .expect("invalidation times")
        .clone();
    assert!(
        times[1] - times[0] >= Duration::from_millis(400),
        "{times:?}"
    );
    assert_eq!(sink.invalidations(), ["boot-0001.1", "boot-0001.2"]);
    client.catch_up(&sink, &boot, &[TURN, "agt-turn-0002"]);

    assert_eq!(client.epoch.as_deref(), Some("boot-0001.2"));
    assert_eq!(
        client.state(TURN, "question-1"),
        Some("question-1:expired:turnEnded")
    );
    assert_eq!(
        client.state("agt-turn-0002", "question-1"),
        Some("question-1:expired:turnEnded")
    );
}

#[test]
fn reuse_of_the_ids_in_another_project_never_hides_this_projects_final_update() {
    let fixture = Fixture::new();
    let limits = JournalLimits {
        retired_turns: 1,
        ..patient_answers()
    };
    let boot = Boot::start_with(&fixture, "boot-0001", limits);
    let (sink, feed) = feed(&boot, FeedLimits::default());
    let mut own = boot.turn(THREAD, TURN, "workspace-1");
    let busy = boot.turn("agt-thread-0002", "agt-turn-0002", "workspace-2");
    own.ask("question-1");
    settle(&boot, &feed);
    let mut client = Client::default();
    client.catch_up(&sink, &boot, &[TURN]);
    assert_eq!(
        client.state(TURN, "question-1"),
        Some("question-1:pending:live")
    );
    let entered = sink.entered.load(Ordering::SeqCst);
    sink.close_gate();
    busy.ask("question-1");
    assert!(eventually(
        || sink.entered.load(Ordering::SeqCst) == entered + 1
    ));

    drop(own.tracking.take());
    own.session.finish();
    assert!(boot.journal.flush(FLUSH));
    for index in 3..6 {
        drop(boot.turn(
            "agt-thread-0003",
            &format!("agt-turn-000{index}"),
            "workspace-3",
        ));
    }
    let elsewhere = boot.turn_in(OTHER_ROOT, THREAD, TURN, "workspace-9");
    elsewhere.ask("question-7");
    assert!(boot.journal.flush(FLUSH));
    let pushed_before = sink.messages.lock().expect("messages").len();
    sink.open_gate();
    settle(&boot, &feed);

    let messages = sink.messages.lock().expect("messages").clone();
    for message in &messages[pushed_before..] {
        if message.parts().workspace_id.as_deref() == Some("workspace-1") {
            client.merge(message);
        }
    }
    assert_eq!(
        client.state(TURN, "question-1"),
        Some("question-1:expired:turnEnded")
    );
}

fn abandoned_turn(boot: &Boot, turn_id: &str) -> LiveTurn {
    abandoned_turn_in(boot, THREAD, turn_id)
}

fn abandoned_turn_in(boot: &Boot, thread_id: &str, turn_id: &str) -> LiveTurn {
    let mut turn = boot.turn(thread_id, turn_id, "workspace-1");
    turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    drop(turn.tracking.take());
    turn
}

#[test]
fn rotation_for_an_unchanged_orphan_happens_once_and_then_stays_quiet() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let (sink, feed) = feed(&boot, fast_rotation());
    let _orphan = abandoned_turn(&boot, TURN);
    let mut client = Client::default();
    assert!(eventually(|| sink.invalidations().len() == 1));

    for _ in 0..4 {
        client.catch_up(&sink, &boot, &[TURN]);
        std::thread::sleep(Duration::from_millis(450));
    }
    settle(&boot, &feed);

    assert_eq!(sink.invalidations(), ["boot-0001.1"]);
    assert_eq!(boot.journal.abandoned_turns(), 0);
    assert_eq!(boot.journal.reconciled_turns(), 1);
    assert_eq!(
        client.state(TURN, "question-1"),
        Some("question-1:expired:turnEnded")
    );
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD))),
        ["question-1:pending:-"]
    );
}

const KEPT_THREAD: &str = "agt-thread-0002";
const KEPT_TURN: &str = "agt-turn-0002";

fn pull_in(boot: &Boot, thread_id: &str, turn_id: &str) -> ThreadRequests {
    RequestProjection::new(Arc::clone(&boot.journal))
        .page(&scope_of(ROOT), thread_id, &[turn_id.to_string()], None)
        .expect("pull")
        .message
}

fn flags(message: &ThreadRequests) -> (JournalState, bool) {
    (message.parts().journal, message.parts().truncated)
}

fn listed(message: &ThreadRequests) -> Vec<String> {
    message.parts().requests.iter().map(described).collect()
}

#[test]
fn orphan_beyond_the_reconciled_memory_degrades_its_thread_instead_of_rotating_again() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let limits = FeedLimits {
        rotation: RotationPolicy {
            reconciled: 1,
            ..fast_rotation().rotation
        },
        ..FeedLimits::default()
    };
    let (sink, feed) = feed(&boot, limits);
    let _forgotten = abandoned_turn_in(&boot, THREAD, TURN);
    let stored = wire(&boot.read(ROOT, THREAD));
    assert_eq!(flags(&pull(&boot, &[TURN])), (JournalState::Saved, false));
    assert!(eventually(|| sink.invalidations().len() == 1));
    let _kept = abandoned_turn_in(&boot, KEPT_THREAD, KEPT_TURN);
    let kept_stored = wire(&boot.read(ROOT, KEPT_THREAD));
    pull_in(&boot, KEPT_THREAD, KEPT_TURN);
    assert!(eventually(|| sink.invalidations().len() == 2));
    assert_eq!(boot.journal.reconciled_turns(), 1);
    assert_eq!(boot.journal.unreconciled_turns(), 1);

    for _ in 0..4 {
        let forgotten = pull(&boot, &[TURN]);
        assert_eq!(flags(&forgotten), (JournalState::Degraded, true));
        assert_eq!(listed(&forgotten), ["question-1:expired:turnEnded"]);
        let kept = pull_in(&boot, KEPT_THREAD, KEPT_TURN);
        assert_eq!(flags(&kept), (JournalState::Saved, false));
        assert_eq!(listed(&kept), ["question-1:expired:turnEnded"]);
        std::thread::sleep(Duration::from_millis(450));
    }
    settle(&boot, &feed);
    assert_eq!(sink.invalidations(), ["boot-0001.1", "boot-0001.2"]);
    assert_eq!(boot.journal.abandoned_turns(), 0);
    assert_eq!(wire(&boot.read(ROOT, THREAD)), stored);
    assert_eq!(wire(&boot.read(ROOT, KEPT_THREAD)), kept_stored);
    assert_eq!(summary(&stored), ["question-1:pending:-"]);

    let live = boot.turn(THREAD, "agt-turn-0003", "workspace-1");
    live.ask("question-2");
    settle(&boot, &feed);
    let messages = sink.messages.lock().expect("messages").clone();
    let pushed = messages
        .iter()
        .rfind(|message| listed(message).contains(&"question-2:pending:live".to_string()))
        .expect("a push for the live turn");
    assert_eq!(pushed.parts().thread_id, THREAD);
    assert_eq!(flags(pushed), (JournalState::Degraded, true));
    assert_eq!(sink.invalidations().len(), 2);
}
