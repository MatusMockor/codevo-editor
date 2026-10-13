use super::super::tunnel_dispatch::Dispatch;
use super::super::tunnel_stall::StallPolicy;
use super::*;
use http_body::Body;

fn dispatch(quiet: Duration) -> Dispatch {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .unix_socket(std::env::temp_dir().join("cv-transfer-unbound.sock"))
        .no_proxy()
        .build()
        .unwrap();
    let policy = StallPolicy {
        quiet,
        ..StallPolicy::DEFAULT
    };
    Dispatch::new(client, "test-only".into(), policy)
}

fn ends(policy: TransferPolicy) -> Instant {
    Instant::now() + policy.total
}

fn bounds(total: u64, idle: u64) -> TransferPolicy {
    TransferPolicy {
        total: Duration::from_millis(total),
        idle: Duration::from_millis(idle),
        local: Duration::from_millis(idle),
    }
}

fn timed_out<T>() -> Result<T, Failure> {
    Err(Failure::Transport(TIMED_OUT.into()))
}

async fn beating(pulse: Arc<Pulse>, every: Duration) {
    loop {
        tokio::time::sleep(every).await;
        pulse.progressed();
    }
}

#[test]
fn silence_ends_at_the_idle_bound_and_marks_the_tunnel_as_suspected() {
    let dispatch = dispatch(Duration::from_millis(10));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let started = Instant::now();
    let result = tauri::async_runtime::block_on(supervised(
        std::future::pending::<Result<(), Failure>>(),
        authority,
        None,
        bounds(10_000, 80),
        ends(bounds(10_000, 80)),
        Arc::default(),
        0,
    ));
    assert_eq!(result, timed_out());
    assert!(started.elapsed() >= Duration::from_millis(80));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(evidence.suspected().is_some());
}

#[test]
fn an_idle_timeout_after_progress_still_marks_the_tunnel_as_suspected() {
    let dispatch = dispatch(Duration::from_millis(10));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let pulse = Arc::new(Pulse::default());
    pulse.progressed();
    let result = tauri::async_runtime::block_on(supervised(
        std::future::pending::<Result<(), Failure>>(),
        authority,
        None,
        bounds(10_000, 80),
        ends(bounds(10_000, 80)),
        pulse,
        0,
    ));
    assert_eq!(result, timed_out());
    let seen = evidence.inbound().expect("progress is liveness evidence");
    let suspected = evidence.suspected().expect("silence after progress");
    assert!(suspected >= seen + Duration::from_millis(80));
}

#[test]
fn a_blocked_local_side_ends_as_a_local_failure_without_suspecting_the_tunnel() {
    let dispatch = dispatch(Duration::from_millis(10));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let pulse = Arc::new(Pulse::default());
    pulse.waits(true);
    let policy = TransferPolicy {
        local: Duration::from_millis(80),
        ..bounds(10_000, 5_000)
    };
    let started = Instant::now();
    let result = tauri::async_runtime::block_on(supervised(
        std::future::pending::<Result<(), Failure>>(),
        authority,
        None,
        policy,
        ends(policy),
        pulse,
        0,
    ));
    assert_eq!(result, Err(Failure::Local));
    assert!(started.elapsed() >= Duration::from_millis(80));
    assert!(started.elapsed() < Duration::from_secs(4));
    assert!(evidence.suspected().is_none());
    assert!(evidence.inbound().is_none());
}

#[test]
fn every_pulse_restarts_the_idle_bound_and_is_recorded_as_liveness_evidence() {
    let dispatch = dispatch(Duration::from_millis(10));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let pulse = Arc::new(Pulse::default());
    let result = tauri::async_runtime::block_on(async {
        let beats = tokio::spawn(beating(Arc::clone(&pulse), Duration::from_millis(15)));
        let exchange = async {
            tokio::time::sleep(Duration::from_millis(900)).await;
            Ok(7)
        };
        let result = supervised(
            exchange,
            authority,
            None,
            bounds(10_000, 300),
            ends(bounds(10_000, 300)),
            pulse,
            0,
        )
        .await;
        beats.abort();
        result
    });
    assert_eq!(result, Ok(7));
    assert!(evidence.inbound().is_some());
    assert!(evidence.suspected().is_none());
}

#[test]
fn the_total_bound_ends_a_progressing_transfer_without_suspecting_the_tunnel() {
    let dispatch = dispatch(Duration::from_secs(3));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let pulse = Arc::new(Pulse::default());
    let started = Instant::now();
    let result = tauri::async_runtime::block_on(async {
        let beats = tokio::spawn(beating(Arc::clone(&pulse), Duration::from_millis(10)));
        let exchange = std::future::pending::<Result<(), Failure>>();
        let result = supervised(
            exchange,
            authority,
            None,
            bounds(250, 10_000),
            ends(bounds(250, 10_000)),
            pulse,
            0,
        )
        .await;
        beats.abort();
        result
    });
    assert_eq!(result, timed_out());
    assert!(started.elapsed() >= Duration::from_millis(250));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(evidence.suspected().is_none());
}

#[derive(Clone, Copy, Debug)]
enum Ending {
    Success,
    Failure,
    Cancel,
    Drop,
    Deadline,
}

#[test]
fn a_tail_suspends_the_stall_watch_until_its_deadline_and_releases_on_every_ending() {
    for ending in [
        Ending::Success,
        Ending::Failure,
        Ending::Cancel,
        Ending::Drop,
        Ending::Deadline,
    ] {
        let dispatch = dispatch(Duration::from_secs(3));
        let authority = dispatch.authority();
        let evidence = authority.evidence();
        let pulse = Arc::new(Pulse::default());
        let (answer, answered) = tokio::sync::oneshot::channel::<Result<(), Failure>>();
        let (cancel, cancelled) = watch::channel(false);
        let policy = bounds(5_000, 400);
        let started = Instant::now();
        let outcome = tauri::async_runtime::block_on(async {
            let exchange = async { answered.await.unwrap_or(Ok(())) };
            let supervising = tokio::spawn(supervised(
                exchange,
                authority,
                Some(cancelled),
                policy,
                ends(policy),
                Arc::clone(&pulse),
                8 * 1024 * 1024,
            ));
            assert!(evidence.held(Instant::now()).is_none());
            pulse.sent.store(true, Ordering::Release);
            pulse.progressed();
            let until = loop {
                if let Some(until) = evidence.held(Instant::now()) {
                    break until;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            };
            assert!(until <= Instant::now() + policy.idle, "{ending:?}");
            assert!(until <= started + policy.total, "{ending:?}");
            match ending {
                Ending::Success => answer.send(Ok(())).unwrap(),
                Ending::Failure => answer.send(Err(Failure::Status(503))).unwrap(),
                Ending::Cancel => drop(cancel.send_replace(true)),
                Ending::Drop => supervising.abort(),
                Ending::Deadline => {}
            }
            supervising.await.ok()
        });
        let expected = match ending {
            Ending::Success => Some(Ok(())),
            Ending::Failure => Some(Err(Failure::Status(503))),
            Ending::Cancel => Some(Err(Failure::Cancelled)),
            Ending::Drop => None,
            Ending::Deadline => Some(timed_out()),
        };
        assert_eq!(outcome, expected, "{ending:?}");
        assert!(evidence.held(Instant::now()).is_none(), "{ending:?}");
    }
}

#[test]
fn no_suspension_exists_while_a_transfer_is_still_streaming() {
    let dispatch = dispatch(Duration::from_secs(3));
    let authority = dispatch.authority();
    let evidence = authority.evidence();
    let pulse = Arc::new(Pulse::default());
    let result = tauri::async_runtime::block_on(async {
        let beats = tokio::spawn(beating(Arc::clone(&pulse), Duration::from_millis(10)));
        let exchange = async {
            for _ in 0..20 {
                tokio::time::sleep(Duration::from_millis(10)).await;
                assert!(evidence.held(Instant::now()).is_none());
            }
            Ok(())
        };
        let streaming = bounds(5_000, 2_000);
        let result = supervised(
            exchange,
            authority,
            None,
            streaming,
            ends(streaming),
            pulse,
            8 << 20,
        )
        .await;
        beats.abort();
        result
    });
    assert_eq!(result, Ok(()));
    assert!(evidence.inbound().is_some());
}

#[test]
fn a_closed_tunnel_and_an_exact_cancel_end_the_exchange() {
    let dispatch = dispatch(Duration::from_secs(3));
    let (cancel, cancelled) = watch::channel(false);
    let pending = std::future::pending::<Result<(), Failure>>;
    let result = tauri::async_runtime::block_on(async {
        let supervising = supervised(
            pending(),
            dispatch.authority(),
            Some(cancelled.clone()),
            bounds(5_000, 5_000),
            ends(bounds(5_000, 5_000)),
            Arc::default(),
            0,
        );
        let cancelling = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.send_replace(true);
        };
        tokio::join!(supervising, cancelling).0
    });
    assert_eq!(result, Err(Failure::Cancelled));
    let (unused, never) = watch::channel(false);
    drop(unused);
    let result = tauri::async_runtime::block_on(supervised(
        async { Ok(1) },
        dispatch.authority(),
        Some(never),
        bounds(5_000, 5_000),
        ends(bounds(5_000, 5_000)),
        Arc::default(),
        0,
    ));
    assert_eq!(result, Ok(1));
    let result = tauri::async_runtime::block_on(async {
        let supervising = supervised(
            pending(),
            dispatch.authority(),
            None,
            bounds(5_000, 5_000),
            ends(bounds(5_000, 5_000)),
            Arc::default(),
            0,
        );
        let closing = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            dispatch.close();
        };
        tokio::join!(supervising, closing).0
    });
    assert_eq!(result, Err(Failure::Transport(CLOSED.into())));
    let late = dispatch.authority();
    assert_eq!(late.ended(), Err(CLOSED.to_string()));
    let result = tauri::async_runtime::block_on(supervised(
        async { Ok(1) },
        late,
        None,
        bounds(5_000, 5_000),
        ends(bounds(5_000, 5_000)),
        Arc::default(),
        0,
    ));
    assert_eq!(result, Ok(1));
}

async fn frame(body: &mut Outbound) -> Option<Result<Bytes, ()>> {
    let polled = std::future::poll_fn(|context| Pin::new(&mut *body).poll_frame(context)).await;
    polled.map(|frame| {
        frame
            .map_err(|_| ())
            .and_then(|frame| frame.into_data().map_err(|_| ()))
    })
}

fn outbound(length: u64) -> (mpsc::Sender<Bytes>, Outbound, Arc<Pulse>) {
    let (chunks, receiver) = mpsc::channel(BUFFERED_CHUNKS);
    let pulse = Arc::new(Pulse::default());
    let body = Outbound {
        chunks: receiver,
        remaining: length,
        pulse: Arc::clone(&pulse),
    };
    (chunks, body, pulse)
}

#[test]
fn the_body_declares_its_exact_length_and_ends_only_after_every_byte() {
    let (chunks, mut body, pulse) = outbound(5);
    assert_eq!(body.size_hint().exact(), Some(5));
    assert!(!body.is_end_stream());
    tauri::async_runtime::block_on(async {
        chunks.send(Bytes::from_static(b"abc")).await.unwrap();
        assert_eq!(frame(&mut body).await, Some(Ok(Bytes::from_static(b"abc"))));
        assert_eq!(body.size_hint().exact(), Some(2));
        assert!(!pulse.sent.load(Ordering::Acquire));
        chunks.send(Bytes::from_static(b"de")).await.unwrap();
        assert_eq!(frame(&mut body).await, Some(Ok(Bytes::from_static(b"de"))));
        assert!(pulse.sent.load(Ordering::Acquire));
        assert!(body.is_end_stream());
        assert_eq!(frame(&mut body).await, None);
    });
}

#[test]
fn the_body_fails_instead_of_ending_short_long_or_empty() {
    tauri::async_runtime::block_on(async {
        let (chunks, mut body, pulse) = outbound(5);
        chunks.send(Bytes::from_static(b"abc")).await.unwrap();
        assert_eq!(frame(&mut body).await, Some(Ok(Bytes::from_static(b"abc"))));
        drop(chunks);
        assert_eq!(frame(&mut body).await, Some(Err(())));
        assert!(!pulse.sent.load(Ordering::Acquire));
        let (chunks, mut body, pulse) = outbound(2);
        chunks.send(Bytes::from_static(b"abc")).await.unwrap();
        assert_eq!(frame(&mut body).await, Some(Err(())));
        assert!(!pulse.sent.load(Ordering::Acquire));
        let (chunks, mut body, _pulse) = outbound(2);
        chunks.send(Bytes::new()).await.unwrap();
        assert_eq!(frame(&mut body).await, Some(Err(())));
    });
}

#[test]
fn the_body_reports_when_it_is_waiting_for_the_local_reader() {
    let (chunks, mut body, pulse) = outbound(2);
    let waker = std::task::Waker::noop();
    let mut context = Context::from_waker(waker);
    assert!(!pulse.signals().waiting);
    assert!(Pin::new(&mut body).poll_frame(&mut context).is_pending());
    assert_eq!(
        pulse.signals(),
        Signals {
            beats: 0,
            waiting: true,
            sent: false
        }
    );
    chunks.try_send(Bytes::from_static(b"ab")).unwrap();
    assert!(Pin::new(&mut body).poll_frame(&mut context).is_ready());
    assert_eq!(
        pulse.signals(),
        Signals {
            beats: 1,
            waiting: false,
            sent: true
        }
    );
}

#[test]
fn a_full_consumer_queue_is_reported_as_a_local_wait_until_it_drains() {
    let (sender, mut receiver) = mpsc::channel(1);
    let pulse = Pulse::default();
    tauri::async_runtime::block_on(async {
        hand_over(&sender, Bytes::from_static(b"a"), &pulse)
            .await
            .unwrap();
        assert!(!pulse.signals().waiting);
        let blocked = hand_over(&sender, Bytes::from_static(b"b"), &pulse);
        let draining = async {
            while !pulse.signals().waiting {
                tokio::task::yield_now().await;
            }
            assert_eq!(receiver.recv().await, Some(Bytes::from_static(b"a")));
        };
        assert_eq!(tokio::join!(blocked, draining).0, Ok(()));
        assert!(!pulse.signals().waiting);
        drop(receiver);
        assert_eq!(
            hand_over(&sender, Bytes::from_static(b"c"), &pulse).await,
            Err(Failure::Transport(CLOSED.into()))
        );
    });
}

#[test]
fn the_chunk_queue_applies_backpressure_after_two_chunks() {
    let (chunks, _body, _pulse) = outbound(1 << 20);
    assert_eq!(BUFFERED_CHUNKS, 2);
    assert!(chunks.try_send(Bytes::from_static(b"a")).is_ok());
    assert!(chunks.try_send(Bytes::from_static(b"b")).is_ok());
    assert!(chunks.try_send(Bytes::from_static(b"c")).is_err());
}

#[test]
fn the_file_policy_matches_the_runner_limits() {
    assert_eq!(TransferPolicy::FILE.total, Duration::from_secs(900));
    assert_eq!(TransferPolicy::FILE.idle, Duration::from_secs(60));
    assert_eq!(TransferPolicy::FILE.local, Duration::from_secs(60));
}

#[test]
fn an_operation_deadline_that_is_nearly_spent_ends_the_exchange_at_that_instant() {
    let dispatch = dispatch(Duration::from_secs(3));
    let policy = bounds(60_000, 30_000);
    let deadline = Instant::now() + Duration::from_millis(120);
    let started = Instant::now();
    let result = tauri::async_runtime::block_on(supervised(
        std::future::pending::<Result<(), Failure>>(),
        dispatch.authority(),
        None,
        policy,
        deadline,
        Arc::default(),
        0,
    ));
    assert_eq!(result, timed_out());
    assert!(started.elapsed() >= Duration::from_millis(100));
    assert!(started.elapsed() < Duration::from_secs(5));
}
