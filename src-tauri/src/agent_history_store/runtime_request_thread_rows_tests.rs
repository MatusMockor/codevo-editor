use super::*;
use crate::agent_runtime_requests::model::RuntimeRequest;
use crate::agent_runtime_requests::store::ThreadSummary;

fn read_thread(journaled: &Journaled, turn_id: &str) -> (ThreadSummary, Vec<String>) {
    let mut read = None;
    journaled
        .store
        .read_thread(&journaled.scope, THREAD, before_deadline(), &mut |rows| {
            let summary = rows.summary()?;
            let ids: Vec<String> = rows
                .entries(turn_id)?
                .into_iter()
                .map(|entry| entry.request_id)
                .collect();
            read = Some((summary, ids));
            Ok(())
        })
        .expect("read the thread");
    read.expect("read")
}

fn load(journaled: &Journaled, turn_id: &str, request_id: &str) -> Option<RuntimeRequest> {
    let mut loaded = None;
    journaled
        .store
        .read_thread(&journaled.scope, THREAD, before_deadline(), &mut |rows| {
            loaded = Some(rows.load(turn_id, request_id)?);
            Ok(())
        })
        .expect("load a request");
    loaded.flatten()
}

#[test]
fn malformed_rows_are_counted_as_unreadable_for_the_whole_thread() {
    let journaled = Journaled::new();
    journaled.apply(
        RUN,
        &snapshot(
            1,
            vec![
                question("question-1", ObservedState::Pending),
                question("question-2", ObservedState::Pending),
                question("question-3", ObservedState::Pending),
                question("question-4", ObservedState::Pending),
            ],
        ),
    );
    let (clean, listed) = read_thread(&journaled, TURN);
    assert_eq!((clean.unreadable, clean.incomplete), (0, false));
    assert_eq!(listed.len(), 4);
    journaled
        .raw()
        .execute_batch(
            "UPDATE runtime_requests SET kind='bogus' WHERE request_id='question-1';
             UPDATE runtime_requests SET version=-3 WHERE request_id='question-2';
             UPDATE runtime_requests SET body='{not json' WHERE request_id='question-3';",
        )
        .unwrap();

    let (headers, listed) = read_thread(&journaled, TURN);

    assert_eq!(headers.unreadable, 2);
    assert_eq!(listed, ["question-3", "question-4"]);
    assert!(load(&journaled, TURN, "question-3").is_none());
    let (decoded, _) = read_thread(&journaled, TURN);
    assert_eq!(decoded.unreadable, 3);
    let (other_turn, listed) = read_thread(&journaled, "agt-turn-0404");
    assert_eq!(other_turn.unreadable, 3);
    assert!(listed.is_empty());
    journaled
        .raw()
        .execute_batch("DELETE FROM runtime_requests WHERE request_id='question-3';")
        .unwrap();
    let (removed, _) = read_thread(&journaled, TURN);
    assert_eq!(removed.unreadable, 2);
}
