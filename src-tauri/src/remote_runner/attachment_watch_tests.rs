use super::super::attachment_test_support::*;
use super::super::transport::Session;
use super::*;
use std::sync::Arc;

fn seconds(start: Instant, seconds: u64) -> Instant {
    start + Duration::from_secs(seconds)
}

#[test]
fn one_budget_bounds_opening_transport_and_publication_from_its_start() {
    let start = Instant::now();
    let budget = Budget::starting(start, Duration::from_secs(900));
    let patience = Duration::from_secs(60);
    assert_eq!(budget.deadline(), seconds(start, 900));
    assert_eq!(budget.bound(start, patience), seconds(start, 60));
    assert_eq!(
        budget.bound(seconds(start, 500), patience),
        seconds(start, 560)
    );
    assert_eq!(
        budget.bound(seconds(start, 840), patience),
        seconds(start, 900)
    );
    assert_eq!(
        budget.bound(seconds(start, 870), patience),
        seconds(start, 900)
    );
    assert_eq!(
        budget.bound(seconds(start, 950), patience),
        seconds(start, 900)
    );
    assert!(!budget.spent(seconds(start, 899)));
    assert!(budget.spent(seconds(start, 900)));
    let copied = budget;
    assert_eq!(copied.deadline(), budget.deadline());
}

fn guard(session: &Session, total: Duration, cancel: Option<watch::Receiver<bool>>) -> Guard {
    Guard::new(Budget::starting(Instant::now(), total), session, cancel)
}

#[test]
fn a_wait_ends_at_its_patience_or_at_the_operation_deadline_whichever_is_first() {
    let session = Session::fixture();
    for (total, patience) in [(10_000, 80), (80, 10_000)] {
        let mut guard = guard(&session, Duration::from_millis(total), None);
        let started = Instant::now();
        let interrupted = tauri::async_runtime::block_on(async {
            guard.interrupted(Duration::from_millis(patience)).await
        });
        assert_eq!(interrupted, Interrupted::Stalled);
        assert!(started.elapsed() >= Duration::from_millis(70));
        assert!(started.elapsed() < WAIT / 4);
    }
}

#[test]
fn a_wait_ends_at_once_on_cancel_or_when_the_tunnel_is_closed() {
    let session = Session::fixture();
    let (cancel, cancelled) = watch::channel(false);
    let mut cancelling = guard(&session, WAIT, Some(cancelled));
    let interrupted = tauri::async_runtime::block_on(async {
        let waiting = cancelling.interrupted(WAIT);
        let cancelling = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.send_replace(true);
        };
        tokio::join!(waiting, cancelling).0
    });
    assert_eq!(interrupted, Interrupted::Cancelled);
    let mut closing = guard(&session, WAIT, None);
    let started = Instant::now();
    let interrupted = tauri::async_runtime::block_on(async {
        let waiting = closing.interrupted(WAIT);
        let closing = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            session.close();
        };
        tokio::join!(waiting, closing).0
    });
    assert_eq!(interrupted, Interrupted::Revoked(TUNNEL_CLOSED.into()));
    assert!(started.elapsed() < WAIT / 4);
    let mut late = guard(&session, WAIT, None);
    let interrupted = tauri::async_runtime::block_on(async { late.interrupted(WAIT).await });
    assert_eq!(interrupted, Interrupted::Revoked(TUNNEL_CLOSED.into()));
}

#[test]
fn an_interruption_names_the_connection_change_before_any_local_cause() {
    let session = Arc::new(Session::fixture());
    let lease = ConnectionLease::new(server(), Arc::clone(&session));
    let refusal =
        |interrupted: Interrupted| interrupted.refusal(&lease, "cancelled", "changed", "stalled");
    assert_eq!(refusal(Interrupted::Cancelled), "cancelled");
    assert_eq!(refusal(Interrupted::Stalled), "stalled");
    assert_eq!(refusal(Interrupted::Revoked("closed".into())), "closed");
    lease.revoke();
    assert_eq!(refusal(Interrupted::Revoked("closed".into())), "changed");
    assert_eq!(refusal(Interrupted::Stalled), "stalled");
}
