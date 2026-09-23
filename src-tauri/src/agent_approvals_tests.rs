use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

fn request(id: &str) -> AgentApprovalRequest {
    AgentApprovalRequest {
        id: id.into(),
        task_id: String::new(),
        provider: "claudeCode".into(),
        kind: AgentApprovalKind::Command,
        title: "Run a command".into(),
        detail: "npm test".into(),
        detail_truncated: false,
        facts: vec![AgentApprovalFact {
            label: "Directory".into(),
            value: "/repo".into(),
        }],
        decisions: vec![
            AgentApprovalDecision::AllowOnce,
            AgentApprovalDecision::Deny,
        ],
        status: AgentApprovalStatus::Pending,
        decision: None,
    }
}

fn recording() -> (
    AgentApprovalResponder,
    Arc<Mutex<Vec<AgentApprovalDecision>>>,
) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    (
        Arc::new(move |decision| {
            sink.lock().unwrap().push(decision);
            Ok(())
        }),
        seen,
    )
}

#[test]
fn answers_once_and_replays_the_identical_decision_without_resending() {
    let registry = AgentApprovalRegistry::default();
    let (responder, seen) = recording();
    registry.register(request("a-1"), responder).unwrap();
    let answered = registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .unwrap();
    assert_eq!(answered.status, AgentApprovalStatus::Approved);
    assert_eq!(answered.task_id, "task");
    registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .unwrap();
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::Deny)
        .is_err());
    assert_eq!(
        *seen.lock().unwrap(),
        vec![AgentApprovalDecision::AllowOnce]
    );
    assert!(!registry.has_pending());
}

#[test]
fn unknown_request_and_unoffered_decision_fail_closed() {
    let registry = AgentApprovalRegistry::default();
    let (responder, seen) = recording();
    registry.register(request("a-1"), responder).unwrap();
    assert!(registry
        .answer("task", "foreign", AgentApprovalDecision::AllowOnce)
        .is_err());
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::AllowForSession)
        .is_err());
    assert!(seen.lock().unwrap().is_empty());
    assert!(registry.has_pending());
}

#[test]
fn timeout_denies_the_provider_and_publishes_timed_out() {
    let registry = AgentApprovalRegistry::with_timeout(Duration::from_millis(30));
    let (responder, seen) = recording();
    registry.register(request("a-1"), responder).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while seen.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(*seen.lock().unwrap(), vec![AgentApprovalDecision::Deny]);
    assert_eq!(
        registry.list("task")[0].status,
        AgentApprovalStatus::TimedOut
    );
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .is_err());
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[test]
fn stop_close_expires_without_invoking_the_provider() {
    let registry = AgentApprovalRegistry::default();
    registry
        .register(request("a-1"), Arc::new(|_| panic!("closed responder")))
        .unwrap();
    registry.close();
    assert_eq!(
        registry.list("task")[0].status,
        AgentApprovalStatus::Expired
    );
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .is_err());
    assert!(registry
        .register(request("a-2"), Arc::new(|_| Ok(())))
        .is_err());
}

#[test]
fn stop_racing_a_successful_write_still_reports_the_delivered_decision() {
    let registry = Arc::new(AgentApprovalRegistry::default());
    let weak = Arc::downgrade(&registry);
    registry
        .register(
            request("a-1"),
            Arc::new(move |_| {
                weak.upgrade().unwrap().close();
                Ok(())
            }),
        )
        .unwrap();
    let answered = registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .unwrap();
    assert_eq!(answered.status, AgentApprovalStatus::Approved);
    assert_eq!(
        registry.list("task")[0].decision,
        Some(AgentApprovalDecision::AllowOnce)
    );
}

#[test]
fn stop_racing_a_failed_write_expires_without_reporting_delivery() {
    let registry = Arc::new(AgentApprovalRegistry::default());
    let weak = Arc::downgrade(&registry);
    registry
        .register(
            request("a-1"),
            Arc::new(move |_| {
                weak.upgrade().unwrap().close();
                Err("pipe closed".into())
            }),
        )
        .unwrap();
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .is_err());
    assert_eq!(
        registry.list("task")[0].status,
        AgentApprovalStatus::Expired
    );
}

#[test]
fn failed_delivery_expires_instead_of_reporting_approval() {
    let registry = AgentApprovalRegistry::default();
    registry
        .register(request("a-1"), Arc::new(|_| Err("pipe closed".into())))
        .unwrap();
    assert!(registry
        .answer("task", "a-1", AgentApprovalDecision::AllowOnce)
        .is_err());
    assert_eq!(
        registry.list("task")[0].status,
        AgentApprovalStatus::Expired
    );
}

#[test]
fn provider_cancel_and_resolution_settle_pending_approvals() {
    let registry = AgentApprovalRegistry::default();
    let count = Arc::new(AtomicUsize::new(0));
    for id in ["a-1", "a-2"] {
        let count = Arc::clone(&count);
        registry
            .register(
                request(id),
                Arc::new(move |_| {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }),
            )
            .unwrap();
    }
    registry.cancel("a-1");
    registry.expire("a-2");
    let listed = registry.list("task");
    assert_eq!(listed[0].status, AgentApprovalStatus::Cancelled);
    assert_eq!(listed[1].status, AgentApprovalStatus::Expired);
    assert_eq!(count.load(Ordering::SeqCst), 0);
}

#[test]
fn bounds_pending_count_duplicates_and_payload() {
    let registry = AgentApprovalRegistry::default();
    for index in 0..MAX_PENDING_AGENT_APPROVALS {
        registry
            .register(request(&format!("a-{index}")), Arc::new(|_| Ok(())))
            .unwrap();
    }
    assert_eq!(
        registry.register(request("a-overflow"), Arc::new(|_| Ok(()))),
        Err(TOO_MANY_PENDING_APPROVALS.to_string())
    );
    assert!(registry
        .register(request("a-0"), Arc::new(|_| Ok(())))
        .is_err());
    let fresh = AgentApprovalRegistry::default();
    let mut oversized = request("b-1");
    oversized.detail = "x".repeat(MAX_AGENT_APPROVAL_DETAIL_BYTES + 1);
    assert!(fresh.register(oversized, Arc::new(|_| Ok(()))).is_err());
    let mut without_deny = request("b-2");
    without_deny.decisions = vec![AgentApprovalDecision::AllowOnce];
    assert!(fresh.register(without_deny, Arc::new(|_| Ok(()))).is_err());
}

#[test]
fn bounded_text_respects_utf8_boundaries_and_strips_nul() {
    let (text, truncated) = bounded_text("ééé", 3);
    assert_eq!(text, "é");
    assert!(truncated);
    let (text, truncated) = bounded_text("a\0b", 16);
    assert_eq!(text, "ab");
    assert!(truncated);
    assert_eq!(bounded_text("ok", 16), ("ok".to_string(), false));
}
