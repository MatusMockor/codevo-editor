use super::*;
use crate::agent_runtime_requests::model::{
    wire_name, RequestLifecycle, RuntimeRequest, ThreadRequests,
};
use crate::agent_runtime_requests::projection::{
    ProjectionError, ProjectionLimits, RequestProjection, ThreadRequestsPage, MAX_PAGE_BYTES,
    MAX_PULL_PAGES,
};
use std::collections::HashSet;

const CONTROL: &str = "\u{1}";

fn projection(boot: &Boot) -> RequestProjection {
    RequestProjection::new(Arc::clone(&boot.journal))
}

fn pull_in(
    boot: &Boot,
    root: &str,
    thread_id: &str,
    turn_ids: &[&str],
    cursor: Option<&str>,
) -> Result<ThreadRequestsPage, ProjectionError> {
    let turn_ids: Vec<String> = turn_ids.iter().map(|turn_id| turn_id.to_string()).collect();
    let page = projection(boot).page(&scope_of(root), thread_id, &turn_ids, cursor)?;
    assert_valid_on_the_wire(&page.message);
    Ok(page)
}

fn pull(
    boot: &Boot,
    turn_ids: &[&str],
    cursor: Option<&str>,
) -> Result<ThreadRequestsPage, ProjectionError> {
    pull_in(boot, ROOT, THREAD, turn_ids, cursor)
}

fn pull_with(
    projection: &RequestProjection,
    turn_ids: &[&str],
    cursor: Option<&str>,
) -> Result<ThreadRequestsPage, ProjectionError> {
    let turn_ids: Vec<String> = turn_ids.iter().map(|turn_id| turn_id.to_string()).collect();
    let page = projection.page(&scope_of(ROOT), THREAD, &turn_ids, cursor)?;
    assert_valid_on_the_wire(&page.message);
    assert!(serde_json::to_vec(&page).expect("encode the page").len() <= MAX_PAGE_BYTES);
    Ok(page)
}

fn chain_of(projection: &RequestProjection, turn_ids: &[&str]) -> Vec<ThreadRequestsPage> {
    let mut pages = vec![pull_with(projection, turn_ids, None).expect("first page")];
    while let Some(cursor) = pages.last().and_then(|page| page.next_cursor.clone()) {
        assert!(pages.len() < MAX_PULL_PAGES, "the chain never ended");
        assert_valid_cursor(&cursor);
        pages.push(pull_with(projection, turn_ids, Some(&cursor)).expect("continuation"));
    }
    pages
}

fn assert_valid_on_the_wire(message: &ThreadRequests) {
    let encoded = serde_json::to_value(message).expect("encode the message");
    let decoded: ThreadRequests =
        serde_json::from_value(encoded.clone()).expect("the message obeys the wire contract");
    assert_eq!(&decoded, message);
    assert_eq!(encoded["reset"], Value::Bool(false));
    assert_eq!(encoded["workspaceId"], Value::Null);
    assert!(decoded.parts().requests.len() <= 64);
}

fn chain(boot: &Boot, turn_ids: &[&str]) -> Vec<ThreadRequestsPage> {
    let mut pages = vec![pull(boot, turn_ids, None).expect("first page")];
    while let Some(cursor) = pages.last().and_then(|page| page.next_cursor.clone()) {
        assert!(pages.len() < MAX_PULL_PAGES, "the chain never ended");
        assert_valid_cursor(&cursor);
        pages.push(pull(boot, turn_ids, Some(&cursor)).expect("continuation"));
    }
    pages
}

fn assert_valid_cursor(cursor: &str) {
    assert!(cursor.len() <= 256, "{cursor}");
    assert!(
        cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte)),
        "{cursor}"
    );
}

fn status_of(request: &RuntimeRequest) -> String {
    wire_name(&request.status()).expect("status name")
}

fn described(request: &RuntimeRequest) -> String {
    let parts = request.parts();
    let reason = parts
        .lifecycle
        .reason()
        .and_then(|reason| wire_name(&reason))
        .unwrap_or_else(|| "live".to_string());
    format!(
        "{}/{}:{}:{reason}",
        parts.turn_id,
        parts.id,
        status_of(request)
    )
}

fn delivered(pages: &[ThreadRequestsPage]) -> Vec<&RuntimeRequest> {
    pages
        .iter()
        .flat_map(|page| page.message.parts().requests.iter())
        .collect()
}

fn is_open(request: &RuntimeRequest) -> bool {
    matches!(
        request.parts().lifecycle,
        RequestLifecycle::Pending | RequestLifecycle::Submitting { .. }
    )
}

fn ask_large(turn: &LiveTurn, request_id: &str) {
    let registered = turn.session.register(
        AgentQuestionRequest {
            id: request_id.to_string(),
            task_id: String::new(),
            provider: "codex".into(),
            questions: (0..4)
                .map(|index| AgentQuestion {
                    id: format!("q{index}"),
                    header: String::new(),
                    prompt: CONTROL.repeat(8192),
                    options: Vec::new(),
                    multiple: false,
                    allow_custom: true,
                })
                .collect(),
            status: AgentQuestionStatus::Pending,
            answers: None,
        },
        Arc::new(|_| Ok(())),
    );
    assert_eq!(registered, Ok(()));
}

struct ThreeTurns {
    boot: Boot,
    turns: Vec<LiveTurn>,
}

const TURNS: [&str; 5] = [
    "agt-turn-0001",
    "agt-turn-0002",
    "agt-turn-0003",
    "agt-turn-0004",
    "agt-turn-0005",
];

impl ThreeTurns {
    fn with_ninety_requests(fixture: &Fixture) -> Self {
        let boot = Boot::start(fixture, "boot-0001");
        let turns: Vec<LiveTurn> = TURNS[..3]
            .iter()
            .map(|turn_id| boot.turn(THREAD, turn_id, "workspace-1"))
            .collect();
        for turn in &turns {
            for index in 0..30 {
                turn.ask(&format!("question-{index:02}"));
                if index < 27 {
                    turn.session.cancel(&format!("question-{index:02}"));
                }
            }
            assert!(boot.journal.flush(FLUSH));
        }
        Self { boot, turns }
    }
}

#[test]
fn chain_of_pages_delivers_every_request_once_with_the_open_ones_first() {
    let fixture = Fixture::new();
    let seeded = ThreeTurns::with_ninety_requests(&fixture);

    let pages = chain(&seeded.boot, &TURNS[..3]);

    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].message.parts().requests.len(), 64);
    let all = delivered(&pages);
    assert_eq!(all.len(), 90);
    let keys: HashSet<(String, String)> = all
        .iter()
        .map(|request| (request.parts().turn_id.clone(), request.parts().id.clone()))
        .collect();
    assert_eq!(keys.len(), 90);
    let first_closed = all.iter().position(|request| !is_open(request));
    assert_eq!(first_closed, Some(9));
    assert!(all[9..].iter().all(|request| !is_open(request)));
    assert!(all[..9]
        .iter()
        .all(|request| request.parts().lifecycle == RequestLifecycle::Pending));
    for page in &pages {
        let parts = page.message.parts();
        assert_eq!(parts.epoch, "boot-0001");
        assert_eq!(parts.thread_id, THREAD);
        assert_eq!((parts.truncated, parts.unreadable), (false, 0));
    }
}

#[test]
fn cursor_of_another_turn_list_another_epoch_or_another_shape_is_rejected() {
    let fixture = Fixture::new();
    let seeded = ThreeTurns::with_ninety_requests(&fixture);
    let first = pull(&seeded.boot, &TURNS[..3], None).expect("first page");
    let cursor = first.next_cursor.expect("more pages");
    let stale =
        |turn_ids: &[&str], cursor: &str| pull(&seeded.boot, turn_ids, Some(cursor)).map(|_| ());

    assert_eq!(
        stale(&TURNS[..2], &cursor),
        Err(ProjectionError::StaleCursor)
    );
    let reordered = [TURNS[1], TURNS[0], TURNS[2]];
    assert_eq!(
        stale(&reordered, &cursor),
        Err(ProjectionError::StaleCursor)
    );
    let oversized = "c".repeat(257);
    for forged in [
        "",
        "nope",
        "c1.0000000000000000.1.o.0.-.",
        oversized.as_str(),
    ] {
        assert_eq!(
            stale(&TURNS[..3], forged),
            Err(ProjectionError::StaleCursor),
            "{forged}"
        );
    }
    let other_thread = pull_in(
        &seeded.boot,
        ROOT,
        "agt-thread-0009",
        &TURNS[..3],
        Some(&cursor),
    );
    assert_eq!(other_thread.map(|_| ()), Err(ProjectionError::StaleCursor));
    assert!(pull(&seeded.boot, &TURNS[..3], Some(&cursor)).is_ok());

    drop(seeded);
    let restarted = Boot::start(&fixture, "boot-0002");
    let after_restart = pull(&restarted, &TURNS[..3], Some(&cursor)).map(|_| ());
    assert_eq!(after_restart, Err(ProjectionError::StaleCursor));
    let fresh = pull(&restarted, &TURNS[..3], None).expect("a fresh pull in the new epoch");
    assert_eq!(fresh.message.parts().epoch, "boot-0002");
}

#[test]
fn invalid_queries_are_refused_and_an_empty_turn_list_is_an_empty_message() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    assert!(boot.journal.flush(FLUSH));

    let empty = pull(&boot, &[], None).expect("an empty turn list");

    let parts = empty.message.parts();
    assert!(parts.requests.is_empty());
    assert_eq!(parts.epoch, "boot-0001");
    assert_eq!(parts.journal, JournalState::Saved);
    assert_eq!(empty.next_cursor, None);
    let many: Vec<String> = (0..33)
        .map(|index| format!("agt-turn-{index:04}"))
        .collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    let refused = [
        pull(&boot, &many, None),
        pull(&boot, &[TURN, TURN], None),
        pull(&boot, &["not a turn id"], None),
        pull_in(&boot, ROOT, "not a thread id", &[TURN], None),
    ];
    for query in refused {
        assert_eq!(query.map(|_| ()), Err(ProjectionError::InvalidQuery));
    }
    assert_eq!(pull(&boot, &many[..32], None).map(|_| ()), Ok(()));
}

#[test]
fn live_session_wins_over_stored_rows_and_lists_what_is_not_saved_yet() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turn = boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    turn.ask("question-2");
    turn.ask("question-3");
    assert!(boot.journal.flush(FLUSH));
    let saved = pull(&boot, &[TURN], None).expect("saved rows");
    let saved_versions: Vec<u64> = saved
        .message
        .parts()
        .requests
        .iter()
        .map(|request| request.parts().version)
        .collect();
    let hold = boot.begin(&turn, "question-3");
    assert!(hold.is_recorded());

    turn.session.cancel("question-1");
    assert_eq!(turn.answer("question-2").map(|_| ()), Ok(()));
    turn.ask("question-4");
    assert_eq!(boot.journal.queued_turns(), 1);
    let overlaid = pull(&boot, &[TURN], None).expect("overlaid rows");

    let requests = &overlaid.message.parts().requests;
    let listed: Vec<String> = requests.iter().map(described).collect();
    assert_eq!(
        listed,
        [
            "agt-turn-0001/question-3:submitting:unknown",
            "agt-turn-0001/question-4:pending:live",
            "agt-turn-0001/question-1:cancelled:providerCancelled",
            "agt-turn-0001/question-2:resolved:unknown",
        ]
    );
    let by_id = |id: &str| {
        requests
            .iter()
            .find(|request| request.parts().id == id)
            .expect("listed request")
            .parts()
    };
    assert!(by_id("question-1").version > saved_versions[0]);
    assert!(by_id("question-2").version > saved_versions[1]);
    assert!(by_id("question-2").lifecycle.resolution().is_some());
    assert_eq!(by_id("question-4").order, 3);
    assert_eq!(overlaid.message.parts().journal, JournalState::Saved);
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD))),
        [
            "question-1:pending:-",
            "question-2:pending:-",
            "question-3:submitting:unknown"
        ]
    );

    hold.settle(IntentSettlement::Reverted, boot.next_version());
    assert!(boot.journal.flush(FLUSH));
    let settled = pull(&boot, &[TURN], None).expect("settled rows");
    let settled: Vec<String> = settled
        .message
        .parts()
        .requests
        .iter()
        .map(described)
        .collect();
    assert_eq!(
        settled,
        [
            "agt-turn-0001/question-3:pending:live",
            "agt-turn-0001/question-4:pending:live",
            "agt-turn-0001/question-1:cancelled:providerCancelled",
            "agt-turn-0001/question-2:resolved:unknown",
        ]
    );
}

#[test]
fn finished_turns_and_recovered_rows_are_served_after_a_restart() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let finished = boot.turn(THREAD, TURNS[0], "workspace-1");
    finished.ask("question-1");
    finished.ask("question-2");
    assert_eq!(finished.answer("question-1").map(|_| ()), Ok(()));
    finished.session.finish();
    let interrupted = boot.turn(THREAD, TURNS[1], "workspace-1");
    interrupted.ask("question-1");
    interrupted.ask_approval("approval-1");
    assert!(boot.journal.flush(FLUSH));
    drop((finished, interrupted, boot));

    let restarted = Boot::start(&fixture, "boot-0002");
    let page = pull(&restarted, &TURNS[..2], None).expect("rows after the restart");

    let parts = page.message.parts();
    assert_eq!(parts.epoch, "boot-0002");
    let listed: Vec<String> = parts.requests.iter().map(described).collect();
    assert_eq!(
        listed,
        [
            "agt-turn-0001/question-1:resolved:unknown",
            "agt-turn-0001/question-2:expired:turnEnded",
            "agt-turn-0002/question-1:expired:appRestarted",
            "agt-turn-0002/approval-1:expired:appRestarted",
        ]
    );
    assert!(parts.requests.iter().all(|request| !is_open(request)));
    assert_eq!(page.next_cursor, None);
    assert_eq!(restarted.journal.live_turns(), 0);
}

#[test]
fn pull_without_the_journal_lease_is_live_only_and_a_deleted_thread_still_fails() {
    let fixture = Fixture::new();
    let owner_boot = Boot::start(&fixture, "boot-0001");
    let turn = owner_boot.turn(THREAD, TURN, "workspace-1");
    turn.ask("question-1");
    assert!(owner_boot.journal.flush(FLUSH));
    let other = Boot::start(&fixture, "boot-0002");

    let live_only = pull(&other, &[TURN], None).expect("a live-only page");

    let parts = live_only.message.parts();
    assert_eq!(
        (parts.journal, parts.truncated),
        (JournalState::Degraded, true)
    );
    assert!(parts.requests.is_empty());
    assert_eq!(live_only.next_cursor, None);
    assert_eq!(pull(&owner_boot, &[TURN], None).map(|_| ()), Ok(()));

    fixture.store.save(ROOT, &owner(), &thread(), 0).unwrap();
    fixture.store.delete(ROOT, &owner(), THREAD).unwrap();
    assert_eq!(
        pull(&owner_boot, &[TURN], None).map(|_| ()),
        Err(ProjectionError::ThreadDeleted)
    );
}

fn keys_of(pages: &[ThreadRequestsPage]) -> Vec<(String, String)> {
    delivered(pages)
        .iter()
        .map(|request| (request.parts().turn_id.clone(), request.parts().id.clone()))
        .collect()
}

#[test]
fn continuation_after_the_projection_changed_is_stale_and_a_restart_delivers_everything() {
    let fixture = Fixture::new();
    let seeded = ThreeTurns::with_ninety_requests(&fixture);
    let first = pull(&seeded.boot, &TURNS[..3], None).expect("first page");
    let cursor = first.next_cursor.clone().expect("more pages");
    assert!(pull(&seeded.boot, &TURNS[..3], Some(&cursor)).is_ok());

    seeded.turns[2].ask("question-new");
    assert!(seeded.boot.journal.flush(FLUSH));

    assert_eq!(
        pull(&seeded.boot, &TURNS[..3], Some(&cursor)).map(|_| ()),
        Err(ProjectionError::StaleCursor)
    );
    let restarted = chain(&seeded.boot, &TURNS[..3]);
    let keys = keys_of(&restarted);
    let unique: HashSet<&(String, String)> = keys.iter().collect();
    assert_eq!((keys.len(), unique.len()), (91, 91));
    assert!(keys.contains(&("agt-turn-0003".to_string(), "question-new".to_string())));

    let again = pull(&seeded.boot, &TURNS[..3], None).expect("first page");
    let again_cursor = again.next_cursor.expect("more pages");
    seeded.turns[0].session.cancel("question-27");
    assert!(seeded.boot.journal.flush(FLUSH));
    assert_eq!(
        pull(&seeded.boot, &TURNS[..3], Some(&again_cursor)).map(|_| ()),
        Err(ProjectionError::StaleCursor)
    );
}

#[test]
fn every_page_fits_its_byte_budget_including_the_envelope() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turns = [
        boot.turn(THREAD, TURNS[0], "workspace-1"),
        boot.turn(THREAD, TURNS[1], "workspace-1"),
    ];
    for turn in &turns {
        for index in 0..16 {
            ask_large(turn, &format!("question-{index:02}"));
            turn.session.cancel(&format!("question-{index:02}"));
            assert!(boot.journal.flush(FLUSH));
        }
    }
    let projection = projection(&boot);

    let pages = chain_of(&projection, &TURNS[..2]);

    assert!(pages.len() >= 2, "{}", pages.len());
    let largest = pages
        .iter()
        .map(|page| serde_json::to_vec(page).expect("encode").len())
        .max()
        .expect("pages");
    assert!(largest <= MAX_PAGE_BYTES, "{largest}");
    assert!(largest * 10 >= MAX_PAGE_BYTES * 9, "{largest}");
    let keys = keys_of(&pages);
    let unique: HashSet<&(String, String)> = keys.iter().collect();
    assert_eq!((keys.len(), unique.len()), (32, 32));
}

#[test]
fn real_chain_of_the_maximum_length_ends_truncated_instead_of_running_on() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let turns: Vec<LiveTurn> = TURNS
        .iter()
        .map(|turn_id| boot.turn(THREAD, turn_id, "workspace-1"))
        .collect();
    for turn in &turns {
        for index in 0..30 {
            turn.ask(&format!("question-{index:02}"));
            turn.session.cancel(&format!("question-{index:02}"));
        }
        assert!(boot.journal.flush(FLUSH));
    }
    let sample = pull(&boot, &TURNS[..1], None).expect("a sample page");
    let largest = sample
        .message
        .parts()
        .requests
        .iter()
        .map(|request| serde_json::to_vec(request).expect("encode").len() + 1)
        .max()
        .expect("records");
    let projection = RequestProjection::with_limits(
        Arc::clone(&boot.journal),
        ProjectionLimits {
            page_bytes: 1024 + largest + largest / 2,
            ..ProjectionLimits::default()
        },
    );

    let pages = chain_of(&projection, &TURNS);

    assert_eq!(pages.len(), MAX_PULL_PAGES);
    assert!(pages
        .iter()
        .all(|page| page.message.parts().requests.len() == 1));
    let last = pages.last().expect("pages").message.parts();
    assert!(last.truncated);
    assert!(pages[..MAX_PULL_PAGES - 1]
        .iter()
        .all(|page| !page.message.parts().truncated));
    let keys = keys_of(&pages);
    let unique: HashSet<&(String, String)> = keys.iter().collect();
    assert_eq!((keys.len(), unique.len()), (MAX_PULL_PAGES, MAX_PULL_PAGES));
}

fn by_id(page: &ThreadRequestsPage) -> Vec<(String, u64)> {
    let mut listed: Vec<(String, u64)> = page
        .message
        .parts()
        .requests
        .iter()
        .map(|request| (described(request), request.parts().version))
        .collect();
    listed.sort();
    listed
}

#[test]
fn request_of_an_ended_turn_is_closed_at_its_stored_version_and_asks_for_a_new_epoch() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let mut ended = boot.turn(THREAD, TURN, "workspace-1");
    ended.ask("question-1");
    ended.ask("question-2");
    assert!(boot.journal.flush(FLUSH));
    let sent = boot.begin(&ended, "question-2");
    assert!(sent.is_recorded());
    drop(sent);
    let live = pull(&boot, &[TURN], None).expect("live rows");
    let held = by_id(&live);
    assert_eq!(held[0].0, "agt-turn-0001/question-1:pending:live");
    assert_eq!(held[1].0, "agt-turn-0001/question-2:submitting:unknown");

    assert_eq!(boot.journal.abandoned_turns(), 0);
    drop(ended.tracking.take());
    let after = pull(&boot, &[TURN], None).expect("rows of the ended turn");
    let repeated = pull(&boot, &[TURN], None).expect("rows of the ended turn again");

    let after = by_id(&after);
    assert_eq!(
        after[0],
        (
            "agt-turn-0001/question-1:expired:turnEnded".to_string(),
            held[0].1
        )
    );
    assert_eq!(after[1], held[1]);
    assert_eq!(by_id(&repeated), after);
    assert_eq!(boot.journal.abandoned_turns(), 1);

    ended.session.finish();
    assert!(boot.journal.flush(FLUSH));
    assert_eq!(boot.journal.abandoned_turns(), 0);
    let finished = pull(&boot, &[TURN], None).expect("rows after the finish");
    let finished = by_id(&finished);
    assert_eq!(finished[0].0, after[0].0);
    assert!(finished[0].1 > held[0].1);
    assert_eq!(
        finished[1].0,
        "agt-turn-0001/question-2:expired:answerUnconfirmed"
    );
    assert!(finished[1].1 > after[1].1);
    assert_eq!(
        summary(&wire(&boot.read(ROOT, THREAD))),
        [
            "question-1:expired:turnEnded",
            "question-2:expired:answerUnconfirmed"
        ]
    );
    let stored_versions: Vec<u64> = boot
        .read(ROOT, THREAD)
        .requests
        .iter()
        .map(|request| request.parts().version)
        .collect();
    assert_eq!(stored_versions, [finished[0].1, finished[1].1]);
    let unknown = pull(&boot, &["agt-turn-0404"], None).expect("an unknown turn");
    assert!(unknown.message.parts().requests.is_empty());
}

#[test]
fn pull_waits_no_longer_than_its_budget_and_a_cold_claim_never_blocks_the_writer() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let healthy = boot.turn(THREAD, TURN, "workspace-1");
    healthy.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    AgentHistoryStore::new(fixture.base.clone())
        .load(OTHER_ROOT, &scope_of(OTHER_ROOT).owner_id)
        .expect("create the other history");
    let blocker = rusqlite::Connection::open(connection::database_path(&fixture.base, OTHER_ROOT))
        .expect("open the other history");
    blocker
        .execute_batch("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;")
        .expect("lock the other history");
    let budget = Duration::from_millis(300);
    let projection = RequestProjection::with_limits(
        Arc::clone(&boot.journal),
        ProjectionLimits {
            read_budget: budget,
            ..ProjectionLimits::default()
        },
    );
    let pull_cold = || {
        let started = Instant::now();
        let refused = projection.page(&scope_of(OTHER_ROOT), THREAD, &[TURN.to_string()], None);
        (started.elapsed(), refused)
    };

    let (waited, refused) = pull_cold();

    assert!(waited >= budget - Duration::from_millis(50), "{waited:?}");
    assert!(waited < budget + Duration::from_millis(700), "{waited:?}");
    let live_only = refused.expect("a live-only page");
    let parts = live_only.message.parts();
    assert_eq!(
        (parts.journal, parts.truncated),
        (JournalState::Degraded, true)
    );
    assert_eq!(boot.journal.unserved().failing(), 1);
    let (waited_again, _) = pull_cold();
    assert!(
        waited_again < budget + Duration::from_millis(700),
        "{waited_again:?}"
    );
    let started = Instant::now();
    healthy.ask("question-2");
    assert!(boot.journal.flush(Duration::from_secs(2)));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(summary(&wire(&boot.read(ROOT, THREAD))).len(), 2);

    blocker.execute_batch("ROLLBACK;").expect("unlock");
    drop(blocker);
    assert!(eventually(|| {
        pull_cold().1.is_ok() && boot.journal.unserved().failing() == 0
    }));
}

#[test]
fn journal_health_of_another_project_reusing_the_thread_id_never_leaks_in() {
    let fixture = Fixture::new();
    let boot = Boot::start(&fixture, "boot-0001");
    let healthy = boot.turn(THREAD, TURN, "workspace-1");
    healthy.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    let roots = fixture.base.join("agent-history").join("v2");
    let set_roots_mode = |mode: u32| {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&roots, fs::Permissions::from_mode(mode)).expect("set permissions");
    };
    set_roots_mode(READ_ONLY);
    let failing = boot.turn_in(OTHER_ROOT, THREAD, "agt-turn-0002", "workspace-2");
    failing.ask("question-1");
    assert!(boot.journal.flush(FLUSH));
    set_roots_mode(WRITABLE);

    assert_eq!(
        boot.journal.thread_state_in(&scope_of(OTHER_ROOT), THREAD),
        JournalState::Degraded
    );
    let page = pull(&boot, &[TURN], None).expect("the healthy project");
    assert_eq!(page.message.parts().journal, JournalState::Saved);
    assert_eq!(
        projection(&boot).journal_state(&scope_of(ROOT), THREAD),
        JournalState::Saved
    );
}
