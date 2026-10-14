use super::thread_requests_ipc::ThreadRequestsQuery;
use sha2::{Digest, Sha256};

const CURSOR_PREFIX: &str = "t:";
const FINGERPRINT_BYTES: usize = 16;

fn fingerprint(
    query: &ThreadRequestsQuery,
    (lease_serial, generation): (u64, u64),
    index: usize,
) -> Option<String> {
    let turns: Vec<(&str, u64, Option<u64>, bool)> = query
        .turns
        .iter()
        .map(|turn| {
            (
                turn.turn_id.as_str(),
                turn.started_at_epoch_ms,
                turn.interaction_sequence,
                turn.terminal,
            )
        })
        .collect();
    let scope = (
        &query.server_id,
        &query.runner_id,
        &query.thread_id,
        lease_serial,
        generation,
        index,
        turns,
    );
    let mut hasher = Sha256::new();
    serde_json::to_writer(&mut hasher, &scope).ok()?;
    let digest = hasher.finalize();
    Some(
        digest[..FINGERPRINT_BYTES]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

pub(super) fn issue(
    index: usize,
    query: &ThreadRequestsQuery,
    lease_serial: u64,
    generation: u64,
) -> Option<String> {
    Some(format!(
        "{CURSOR_PREFIX}{index}:{}",
        fingerprint(query, (lease_serial, generation), index)?
    ))
}

pub(super) fn resume(
    query: &ThreadRequestsQuery,
    lease_serial: u64,
    generation: u64,
) -> Option<usize> {
    let Some(cursor) = query.cursor.as_deref() else {
        return Some(0);
    };
    let (index, _) = cursor.strip_prefix(CURSOR_PREFIX)?.split_once(':')?;
    let index: usize = index.parse().ok()?;
    let issued = issue(index, query, lease_serial, generation)?;
    ((1..query.turns.len()).contains(&index) && issued == cursor).then_some(index)
}

#[cfg(test)]
mod tests {
    use super::super::interactions_fake::{task, turn};
    use super::super::thread_requests_ipc::is_cursor;
    use super::*;

    fn query(turns: usize, cursor: Option<String>) -> ThreadRequestsQuery {
        ThreadRequestsQuery {
            server_id: "srv-alpha".into(),
            runner_id: "runner-alpha".into(),
            thread_id: "5f0c2a9e-7b1d-4c3e-8a6f-0d1e2f3a4b5c".into(),
            turns: (1..=turns)
                .map(|index| turn(&task(index), 1_760_000_000_000, Some(1), false))
                .collect(),
            cursor,
        }
    }

    #[test]
    fn cursor_resumes_only_the_exact_turn_list_scope_and_lease_it_was_issued_for() {
        let issued = issue(8, &query(10, None), 3, 0).expect("cursor");
        assert!(is_cursor(&issued));
        assert!(issued.len() <= 40);
        assert!(issued.starts_with("t:8:"));
        assert_eq!(resume(&query(10, Some(issued.clone())), 3, 0), Some(8));
        assert_eq!(resume(&query(10, None), 3, 0), Some(0));
        assert_eq!(resume(&query(10, Some(issued.clone())), 4, 0), None);
        assert_eq!(resume(&query(10, Some(issued.clone())), 3, 1), None);
        assert_eq!(resume(&query(11, Some(issued.clone())), 3, 0), None);
        let mut reordered = query(10, Some(issued.clone()));
        reordered.turns.swap(0, 1);
        assert_eq!(resume(&reordered, 3, 0), None);
        let mut moved = query(10, Some(issued.clone()));
        moved.turns[9].interaction_sequence = Some(2);
        assert_eq!(resume(&moved, 3, 0), None);
        let mut ended = query(10, Some(issued.clone()));
        ended.turns[0].terminal = true;
        assert_eq!(resume(&ended, 3, 0), None);
        for (field, value) in [
            ("server", "srv-beta"),
            ("runner", "runner-beta"),
            ("thread", "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"),
        ] {
            let mut other = query(10, Some(issued.clone()));
            match field {
                "server" => other.server_id = value.into(),
                "runner" => other.runner_id = value.into(),
                _ => other.thread_id = value.into(),
            }
            assert_eq!(resume(&other, 3, 0), None, "{field}");
        }
        let fingerprint = issued.trim_start_matches("t:8:").to_string();
        for forged in [
            "t:8".to_string(),
            format!("t:0:{fingerprint}"),
            format!("t:08:{fingerprint}"),
            format!("t:+8:{fingerprint}"),
            format!("t:10:{fingerprint}"),
            format!("t:9:{fingerprint}"),
            format!("x:8:{fingerprint}"),
            "t".repeat(256),
        ] {
            assert_eq!(
                resume(&query(10, Some(forged.clone())), 3, 0),
                None,
                "{forged}"
            );
        }
        assert_eq!(resume(&query(0, Some(issued)), 3, 0), None);
    }
}
