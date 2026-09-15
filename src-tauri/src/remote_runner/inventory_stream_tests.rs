use super::*;

const EPOCH: &str = "a2345678-1234-4234-8234-123456789abc";
fn frame(kind: &str, revision: u64) -> String {
    serde_json::json!({"type":kind,"runnerId":"runner", "epoch":EPOCH,"revision":revision})
        .to_string()
}
#[test]
fn snapshot_is_required_and_duplicates_are_coalesced() {
    let mut cursor = Cursor::default();
    assert!(cursor.accept(&frame("changed", 1), "runner").is_err());
    assert_eq!(
        cursor.accept(&frame("snapshot", 3), "runner"),
        Ok(Some(InventoryChangeEvent::Connected))
    );
    assert_eq!(cursor.accept(&frame("changed", 2), "runner"), Ok(None));
    assert_eq!(cursor.accept(&frame("changed", 3), "runner"), Ok(None));
    assert_eq!(
        cursor.accept(&frame("changed", 5), "runner"),
        Ok(Some(InventoryChangeEvent::Changed))
    );
    assert!(cursor.accept(&frame("snapshot", 6), "runner").is_err());
}
#[test]
fn foreign_unsafe_malformed_and_unknown_frames_fail_closed() {
    for text in [
        frame("snapshot", 0).replace("runner\"", "foreign\""),
        frame("snapshot", 0).replace(EPOCH, "invalid"),
        frame("snapshot", 9_007_199_254_740_992),
        frame("unknown", 0),
        frame("snapshot", 0).replace("\"revision\":0", "\"revision\":-1"),
        frame("snapshot", 0).replace("\"revision\":0", "\"revision\":0,\"extra\":true"),
        "x".repeat(4097),
    ] {
        assert!(
            Cursor::default().accept(&text, "runner").is_err(),
            "accepted {text}"
        );
    }
    let mut cursor = Cursor::default();
    cursor.accept(&frame("snapshot", 0), "runner").unwrap();
    assert!(cursor
        .accept(
            &frame("changed", 1).replace(EPOCH, "b2345678-1234-4234-8234-123456789abc"),
            "runner"
        )
        .is_err());
}
#[test]
fn registry_reserves_capacity_until_canceled_worker_exits() {
    let state = InventoryStreamState::default();
    let registration = state.register(EPOCH, false).unwrap();
    state.cancel(EPOCH).unwrap();
    assert!(registration.owner.canceled());
    assert!(state.register(EPOCH, false).is_err());
    let mut registrations = vec![registration];
    for index in 1..MAX_SUBSCRIPTIONS {
        registrations.push(
            state
                .register(&format!("a2345678-1234-4234-8234-{index:012x}"), false)
                .unwrap(),
        );
    }
    assert!(state
        .register("b2345678-1234-4234-8234-123456789abc", false)
        .is_err());
    registrations.clear();
    assert!(state.register(EPOCH, false).is_ok());
}
#[test]
fn state_drop_cancels_and_stale_guard_cannot_remove_replacement() {
    let state = InventoryStreamState::default();
    let registration = state.register(EPOCH, false).unwrap();
    let replacement = Arc::new(Owner::default());
    state
        .0
        .lock()
        .unwrap()
        .insert(EPOCH.into(), replacement.clone());
    drop(registration);
    assert_eq!(state.0.lock().unwrap().len(), 1);
    drop(state);
    assert!(replacement.canceled());
}
#[test]
fn retry_and_contract_are_bounded() {
    assert!(retry_delay(0, EPOCH) >= Duration::from_secs(5));
    assert!(retry_delay(u32::MAX, EPOCH) <= Duration::from_secs(31));
    assert_eq!(
        serde_json::to_value(InventoryChangeEvent::Connected).unwrap(),
        serde_json::json!({"type":"connected"})
    );
    assert!(serde_json::from_value::<SubscribeChangesRequest>(
        serde_json::json!({"serverId":"a", "subscriptionId":EPOCH,"extra":true})
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn live_socket_coalesces_changes_and_stops_after_cancellation() {
    use std::os::unix::net::UnixStream;
    use std::sync::mpsc;
    use tungstenite::{protocol::Role, Message, WebSocket};
    let (client, server) = UnixStream::pair().unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    client
        .set_write_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    let mut server = WebSocket::from_raw_socket(server, Role::Server, None);
    let client = WebSocket::from_raw_socket(
        super::super::transport::DeadlineStream::new(client, HEARTBEAT_TIMEOUT),
        Role::Client,
        None,
    );
    let owner = Arc::new(Owner::default());
    let worker_owner = owner.clone();
    let (events, received) = mpsc::channel();
    let channel = Channel::new(move |event| {
        events.send(event).unwrap();
        Ok(())
    });
    let worker = std::thread::spawn(move || {
        read_socket(
            client,
            || true,
            "runner",
            &worker_owner,
            |event| worker_owner.publish(&channel, event),
        )
    });
    server
        .send(Message::Text(frame("snapshot", 0).into()))
        .unwrap();
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    for revision in 1..=30 {
        server
            .send(Message::Text(frame("changed", revision).into()))
            .unwrap();
    }
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(received.recv_timeout(Duration::from_millis(300)).is_err());
    owner.cancel();
    let started = Instant::now();
    assert!(worker.join().unwrap());
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[cfg(unix)]
#[test]
fn live_socket_revocation_prevents_late_publication() {
    use std::os::unix::net::UnixStream;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    };
    use tungstenite::{protocol::Role, Message, WebSocket};
    let (client, server) = UnixStream::pair().unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    let mut server = WebSocket::from_raw_socket(server, Role::Server, None);
    let client = WebSocket::from_raw_socket(
        super::super::transport::DeadlineStream::new(client, HEARTBEAT_TIMEOUT),
        Role::Client,
        None,
    );
    let current = Arc::new(AtomicBool::new(true));
    let worker_current = current.clone();
    let (events, received) = mpsc::channel();
    let channel = Channel::new(move |event| {
        events.send(event).unwrap();
        Ok(())
    });
    let worker = std::thread::spawn(move || {
        read_socket(
            client,
            || worker_current.load(Ordering::Acquire),
            "runner",
            &Owner::default(),
            |event| Owner::default().publish(&channel, event),
        )
    });
    server
        .send(Message::Text(frame("snapshot", 0).into()))
        .unwrap();
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    current.store(false, Ordering::Release);
    let _ = server.send(Message::Text(frame("changed", 1).into()));
    assert!(worker.join().unwrap());
    assert!(received.try_recv().is_err());
}

#[test]
fn unsubscribe_waits_for_pending_worker_ownership_transfer_and_exit() {
    use std::sync::mpsc;
    let state = InventoryStreamState::default();
    let registration = state.register(EPOCH, true).unwrap();
    let owner = registration.owner.clone();
    state.cancel(EPOCH).unwrap();
    let joining_owner = owner.clone();
    let (done, completed) = mpsc::channel();
    let joining = std::thread::spawn(move || {
        joining_owner.join();
        done.send(()).unwrap();
    });
    assert!(completed.recv_timeout(Duration::from_millis(30)).is_err());
    let (exit, exiting) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        exiting.recv().unwrap();
        drop(registration);
    });
    owner.started(Some(worker));
    assert!(completed.recv_timeout(Duration::from_millis(30)).is_err());
    exit.send(()).unwrap();
    completed.recv_timeout(Duration::from_secs(2)).unwrap();
    joining.join().unwrap();
    assert!(state.0.lock().unwrap().is_empty());
}

#[test]
fn simultaneous_cleanup_waiters_both_wait_for_worker_exit() {
    use std::sync::mpsc;
    let owner = Arc::new(Owner::default());
    let (exit, exiting) = mpsc::channel();
    owner.started(Some(std::thread::spawn(move || {
        exiting.recv().unwrap();
    })));
    let (done, completed) = mpsc::channel();
    let mut joiners = Vec::new();
    for _ in 0..2 {
        let owner = owner.clone();
        let done = done.clone();
        joiners.push(std::thread::spawn(move || {
            owner.join();
            done.send(()).unwrap();
        }));
    }
    assert!(completed.recv_timeout(Duration::from_millis(50)).is_err());
    exit.send(()).unwrap();
    for _ in 0..2 {
        completed.recv_timeout(Duration::from_secs(2)).unwrap();
    }
    for joiner in joiners {
        joiner.join().unwrap();
    }
}

#[cfg(unix)]
#[test]
fn cancel_interrupts_unfinished_fragment_trickle_inside_websocket_read() {
    use std::{io::Write, os::unix::net::UnixStream, sync::mpsc};
    use tungstenite::{protocol::Role, WebSocket};
    let (client, mut server) = UnixStream::pair().unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(250)))
        .unwrap();
    let client = WebSocket::from_raw_socket(
        super::super::transport::DeadlineStream::new(client, HEARTBEAT_TIMEOUT),
        Role::Client,
        None,
    );
    let owner = Arc::new(Owner::default());
    let worker_owner = owner.clone();
    let (done, completed) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        read_socket(
            client,
            || true,
            "runner",
            &worker_owner,
            |_| panic!("unfinished message was published"),
        );
        done.send(()).unwrap();
    });
    server.write_all(&[0x01, 0x00]).unwrap();
    let writer = std::thread::spawn(move || {
        while server.write_all(&[0x00, 0x00]).is_ok() {
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while owner.socket.lock().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(owner.socket.lock().unwrap().is_some());
    owner.cancel();
    completed.recv_timeout(Duration::from_secs(1)).unwrap();
    worker.join().unwrap();
    writer.join().unwrap();
}

#[test]
fn shutdown_is_idempotent_and_rejects_late_registration() {
    let state = InventoryStreamState::default();
    let registration = state.register(EPOCH, false).unwrap();
    state.shutdown();
    state.shutdown();
    assert!(registration.owner.canceled());
    drop(registration);
    assert!(state.register(EPOCH, false).is_err());
}
