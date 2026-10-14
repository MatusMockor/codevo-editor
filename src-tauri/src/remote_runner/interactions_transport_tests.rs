use super::super::super::interactions_fake::transport::*;
use super::*;
use std::collections::VecDeque;

#[test]
fn server_a_cannot_read_server_b_task() {
    let (lease_a, listener_a) = connection("server-a", "runner-a");
    let (lease_b, listener_b) = connection("server-b", "runner-b");
    let mut foreign = snapshot("empty");
    foreign["taskId"] = OTHER_TASK.into();
    let mut replies_a = VecDeque::from([live(), foreign]);
    let served_a = serve(listener_a, "runner-a", 4, move |_| {
        (200, replies_a.pop_front().unwrap_or(Value::Null))
    });
    let served_b = serve(listener_b, "runner-b", 2, |_| {
        (200, snapshot("answeredAndDecided"))
    });
    let now = Instant::now();
    let from_a = Exchange::open(&lease_a, "runner-a", TASK, now)
        .unwrap()
        .read()
        .unwrap();
    let from_b = Exchange::open(&lease_b, "runner-b", TASK, now)
        .unwrap()
        .read()
        .unwrap();
    assert_eq!(from_a.sequence, 3);
    assert_eq!(from_b.sequence, 6);
    assert!(from_a.questions[0].response_capability.is_some());
    assert_eq!(from_b.questions[0].response_capability, None);
    assert_eq!(
        Exchange::open(&lease_a, "runner-b", TASK, now).err(),
        Some(InteractionError::RunnerChanged)
    );
    assert_eq!(
        Exchange::open(&lease_a, "runner-a", TASK, now)
            .unwrap()
            .read()
            .unwrap_err(),
        InteractionError::Wire(WireError::ForeignTask)
    );
    assert!(!std::ptr::eq(
        lease_a.interaction_ledger(),
        lease_b.interaction_ledger()
    ));
    assert_eq!(lease_a.interaction_ledger().stamp(TASK, [1; 32]), 1);
    assert_eq!(lease_a.interaction_ledger().stamp(TASK, [2; 32]), 2);
    assert_eq!(lease_b.interaction_ledger().stamp(TASK, [1; 32]), 1);
    lease_a.revoke();
    assert_eq!(
        Exchange::open(&lease_a, "runner-a", TASK, now).err(),
        Some(InteractionError::Superseded)
    );
    let served_a = served_a.join().expect("server a");
    let served_b = served_b.join().expect("server b");
    let interactions = format!("GET {}", route("interactions"));
    assert_eq!(
        lines(&served_a),
        [
            "GET /v1/runner",
            interactions.as_str(),
            "GET /v1/runner",
            interactions.as_str()
        ]
    );
    assert_eq!(lines(&served_b), ["GET /v1/runner", interactions.as_str()]);
    assert!(served_a
        .iter()
        .all(|(head, _)| head.contains("x-codevo-runner-id: runner-a")));
    assert!(served_b
        .iter()
        .all(|(head, _)| head.contains("x-codevo-runner-id: runner-b")));
}

#[test]
fn real_transport_404_and_409_drive_fallback_and_not_answerable() {
    let (lease, listener) = connection("server-a", "runner-a");
    let questions = format!("GET {}", route("questions"));
    let answer_route = format!("POST {}", route(&format!("questions/{QUESTION}/answer")));
    let mut statuses = VecDeque::from(["pending", "pending", "expired"]);
    let served = serve(listener, "runner-a", 16, move |line| {
        if line == questions {
            let status = statuses.pop_front().unwrap_or("expired");
            return (200, json!({"items": [legacy_question(status)]}));
        }
        if line == answer_route {
            return (409, json!({"error": "conflict"}));
        }
        (404, json!({"error": "not_found"}))
    });
    let outcome = deliver(
        &lease,
        "runner-a",
        TASK,
        QUESTION,
        &choose("sqlite"),
        Instant::now(),
    )
    .settle(&lease)
    .unwrap();
    assert_eq!(
        wire(&outcome),
        json!({
            "kind": "notAnswerable",
            "request": composed(
                legacy_question("expired"),
                Some(json!({"type": "notResumable", "reason": "unknown"}))
            ),
        })
    );
    let served = served.join().expect("server");
    let requests: Vec<String> = lines(&served)
        .into_iter()
        .filter(|line| line != "GET /v1/runner")
        .collect();
    assert_eq!(
        requests,
        [
            format!("GET {}", route("interactions")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("questions")),
            format!("GET {}", route("approvals")),
            format!("GET {}", route("interactions")),
            format!("POST {}", route(&format!("questions/{QUESTION}/answer"))),
            format!("GET {}", route("questions")),
        ]
    );
    assert_eq!(served.len(), 16);
    let posted: Value = serde_json::from_str(&served[13].1).expect("posted answer");
    assert_eq!(
        posted,
        json!({"answers": [{"questionId": "storage", "optionIds": ["sqlite"], "text": ""}]})
    );
}

#[test]
fn read_finished_before_disconnect_and_reconnect_is_not_published() {
    let (state, directory) = state();
    let (first, first_listener) = connection("server-a", "runner-a");
    state.install_connection(first);
    let served_first = serve(first_listener, "runner-a", 2, |_| (200, live()));
    let captured = admit_connection(&state, "server-a", "runner-a").unwrap();
    let now = Instant::now();
    let finished = read_under(&captured.clone(), "runner-a", TASK, now);
    assert_eq!(finished.as_ref().map(|read| read.sequence), Ok(3));
    state.disconnect("server-a", false).unwrap();
    let (second, second_listener) = connection("server-a", "runner-a");
    state.install_connection(second);
    assert_eq!(
        settle_read(&captured, finished).unwrap_err(),
        InteractionError::Superseded
    );
    let served_second = serve(second_listener, "runner-a", 2, |_| {
        (200, snapshot("answeredAndDecided"))
    });
    let current = admit_connection(&state, "server-a", "runner-a").unwrap();
    let fresh = settle_read(
        &current,
        read_under(&current.clone(), "runner-a", TASK, now),
    )
    .unwrap();
    assert_eq!(fresh.sequence, 6);
    assert_eq!(served_first.join().expect("first runner").len(), 2);
    assert_eq!(served_second.join().expect("second runner").len(), 2);
    drop(state);
    assert!(std::fs::remove_dir_all(directory).is_ok());
}

#[test]
fn answer_finished_before_disconnect_and_reconnect_reports_uncertain_delivery() {
    let (state, directory) = state();
    let (first, first_listener) = connection("server-a", "runner-a");
    state.install_connection(first);
    let mut approved = legacy_approval("approved");
    approved["decision"] = "allowOnce".into();
    let interactions = format!("GET {}", route("interactions"));
    let served_first = serve(first_listener, "runner-a", 4, move |line| {
        if line == interactions {
            return (200, live());
        }
        (200, json!({"request": approved}))
    });
    let captured = admit_connection(&state, "server-a", "runner-a").unwrap();
    let delivery = deliver(
        &captured.clone(),
        "runner-a",
        TASK,
        APPROVAL,
        &decide("allowOnce"),
        Instant::now(),
    );
    state.disconnect("server-a", false).unwrap();
    let (second, second_listener) = connection("server-a", "runner-a");
    state.install_connection(second);
    assert_eq!(
        delivery.settle(&captured).unwrap_err(),
        InteractionError::DeliveryUncertain
    );
    let served_first = served_first.join().expect("first runner");
    assert_eq!(
        lines(&served_first),
        [
            "GET /v1/runner".to_string(),
            format!("GET {}", route("interactions")),
            "GET /v1/runner".to_string(),
            format!("POST {}", route(&format!("approvals/{APPROVAL}/answer"))),
        ]
    );
    assert!(never_contacted(&second_listener));
    drop(state);
    assert!(std::fs::remove_dir_all(directory).is_ok());
}

#[test]
fn answer_through_server_a_never_reaches_server_b() {
    let (state, directory) = state();
    let (lease_a, listener_a) = connection("server-a", "runner-a");
    let (lease_b, listener_b) = connection("server-b", "runner-b");
    state.install_connection(lease_a);
    state.install_connection(lease_b);
    let served_a = serve(listener_a, "runner-a", 4, |_| {
        (404, json!({"error": "not_found"}))
    });
    assert_eq!(
        admit_connection(&state, "server-a", "runner-b").err(),
        Some(InteractionError::RunnerChanged)
    );
    assert_eq!(
        admit_connection(&state, "server-b", "runner-a").err(),
        Some(InteractionError::RunnerChanged)
    );
    let through_a = admit_connection(&state, "server-a", "runner-a").unwrap();
    let now = Instant::now();
    let forged = deliver(
        &through_a.clone(),
        "runner-b",
        TASK,
        APPROVAL,
        &decide("allowOnce"),
        now,
    );
    assert_eq!(
        forged.settle(&through_a).unwrap_err(),
        InteractionError::RunnerChanged
    );
    let delivery = deliver(
        &through_a.clone(),
        "runner-a",
        TASK,
        APPROVAL,
        &decide("allowOnce"),
        now,
    );
    assert_eq!(
        delivery.settle(&through_a).unwrap_err(),
        InteractionError::TaskNotFound
    );
    assert_eq!(
        lines(&served_a.join().expect("server a")),
        [
            "GET /v1/runner".to_string(),
            format!("GET {}", route("interactions")),
            "GET /v1/runner".to_string(),
            format!("GET {}", route("questions")),
        ]
    );
    assert!(never_contacted(&listener_b));
    drop(state);
    assert!(!directory.exists());
}
