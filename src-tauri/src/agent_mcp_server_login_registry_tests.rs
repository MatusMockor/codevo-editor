use super::*;
use crate::agent_mcp_server_login_protocol::McpLoginProviderStep;
use crate::agent_mcp_server_manage_domain::is_valid_login_id;
use std::sync::mpsc;

const AUTH_URL: &str = "https://auth.example/authorize?state=s";
const WAIT: Duration = Duration::from_secs(10);

fn owned() -> McpLoginOwner {
    Arc::new(|| Ok(()))
}

fn awaiting() -> McpLoginAnnouncement {
    Ok(McpLoginProviderStep::AwaitingCallback(AUTH_URL.to_string()))
}

fn until_cancelled(session: &McpLoginSession) {
    let deadline = Instant::now() + WAIT;
    while !session.is_cancelled() {
        assert!(Instant::now() < deadline, "session was never cancelled");
        thread::sleep(Duration::from_millis(2));
    }
}

fn wait_for(description: &str, ready: impl Fn() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !ready() {
        assert!(Instant::now() < deadline, "{description}");
        thread::sleep(Duration::from_millis(2));
    }
}

fn pending(registry: &AgentMcpLoginRegistry, exited: &Arc<AtomicBool>) -> Arc<McpLoginSession> {
    let exited = Arc::clone(exited);
    let session = registry
        .begin(owned(), move |session| {
            session.step_known(awaiting());
            until_cancelled(&session);
            exited.store(true, Ordering::Release);
            false
        })
        .expect("session");
    assert_eq!(session.wait_step(WAIT), awaiting());
    session
}

#[test]
fn a_session_gets_an_opaque_backend_generated_login_id() {
    let registry = AgentMcpLoginRegistry::default();
    let first = registry.begin(owned(), |_| true).expect("first");
    let second = registry.begin(owned(), |_| true).expect("second");
    assert!(is_valid_login_id(first.login_id()));
    assert!(is_valid_login_id(second.login_id()));
    assert_eq!(first.login_id().len(), 32);
    assert_ne!(first.login_id(), second.login_id());
    assert_eq!(MCP_LOGIN_RETENTION, Duration::from_secs(60));
}

#[test]
fn a_pending_session_reports_its_step_then_its_terminal_state() {
    let registry = AgentMcpLoginRegistry::default();
    let (finish, finished) = mpsc::channel::<bool>();
    let session = registry
        .begin(owned(), move |session| {
            session.step_known(awaiting());
            session.step_known(Err(McpLoginFailure::Unavailable));
            finished.recv_timeout(WAIT).unwrap_or(false)
        })
        .expect("session");
    assert_eq!(session.wait_step(WAIT), awaiting());
    assert_eq!(
        session.wait_step(Duration::ZERO),
        Err(McpLoginFailure::Unavailable)
    );
    let login_id = session.login_id().to_string();
    assert_eq!(
        registry.state(&login_id),
        Ok(AgentMcpServerLoginState::Pending)
    );
    finish.send(true).expect("finish");
    wait_for("session never succeeded", || {
        registry.state(&login_id) == Ok(AgentMcpServerLoginState::Succeeded)
    });
    assert_eq!(
        registry.state(&login_id),
        Ok(AgentMcpServerLoginState::Succeeded)
    );
}

#[test]
fn a_failed_session_keeps_its_state_until_the_retention_expires() {
    let registry = AgentMcpLoginRegistry::with_retention(Duration::from_millis(300));
    let session = registry
        .begin(owned(), |session| {
            session.step_known(awaiting());
            false
        })
        .expect("session");
    assert_eq!(session.wait_step(WAIT), awaiting());
    let login_id = session.login_id().to_string();
    wait_for("session never failed", || {
        registry.state(&login_id) == Ok(AgentMcpServerLoginState::Failed)
    });
    thread::sleep(Duration::from_millis(350));
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    assert!(registry.slot().is_none());
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
}

#[test]
fn an_unknown_login_id_is_inactive() {
    let registry = AgentMcpLoginRegistry::default();
    assert_eq!(
        registry.state("0123456789abcdef").err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    let exited = Arc::new(AtomicBool::new(false));
    let session = pending(&registry, &exited);
    assert_eq!(
        registry.state("0123456789abcdef").err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    registry.cancel("0123456789abcdef");
    assert!(!exited.load(Ordering::Acquire));
    assert_eq!(
        registry.state(session.login_id()),
        Ok(AgentMcpServerLoginState::Pending)
    );
}

#[test]
fn cancel_reaps_the_session_before_returning_and_is_idempotent() {
    let registry = AgentMcpLoginRegistry::default();
    let exited = Arc::new(AtomicBool::new(false));
    let session = pending(&registry, &exited);
    let login_id = session.login_id().to_string();
    registry.cancel(&login_id);
    assert!(exited.load(Ordering::Acquire));
    assert!(session.is_cancelled());
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    registry.cancel(&login_id);
    assert_eq!(session.wait_step(WAIT), Err(McpLoginFailure::Inactive));
}

#[test]
fn a_second_login_cancels_and_reaps_the_first_before_it_starts() {
    let registry = AgentMcpLoginRegistry::default();
    let first_exited = Arc::new(AtomicBool::new(false));
    let first = pending(&registry, &first_exited);
    let observed = Arc::clone(&first_exited);
    let (started, start) = mpsc::channel::<bool>();
    let second = registry
        .begin(owned(), move |session| {
            let _ = started.send(observed.load(Ordering::Acquire));
            session.step_known(awaiting());
            until_cancelled(&session);
            false
        })
        .expect("second");
    assert!(first_exited.load(Ordering::Acquire));
    assert_eq!(start.recv_timeout(WAIT), Ok(true));
    assert_eq!(
        registry.state(first.login_id()).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    assert_eq!(first.wait_step(WAIT), Err(McpLoginFailure::Inactive));
    assert_eq!(second.wait_step(WAIT), awaiting());
    assert_eq!(
        registry.state(second.login_id()),
        Ok(AgentMcpServerLoginState::Pending)
    );
    registry.cancel(first.login_id());
    assert_eq!(
        registry.state(second.login_id()),
        Ok(AgentMcpServerLoginState::Pending)
    );
}

#[test]
fn a_step_that_never_arrives_times_out_and_a_discarded_session_is_forgotten() {
    let registry = AgentMcpLoginRegistry::default();
    let exited = Arc::new(AtomicBool::new(false));
    let body_exited = Arc::clone(&exited);
    let session = registry
        .begin(owned(), move |session| {
            until_cancelled(&session);
            body_exited.store(true, Ordering::Release);
            true
        })
        .expect("session");
    let started = Instant::now();
    assert_eq!(
        session.wait_step(Duration::from_millis(120)),
        Err(McpLoginFailure::TimedOut)
    );
    assert!(started.elapsed() >= Duration::from_millis(120));
    let other = Arc::new(McpLoginSession::new(
        "0123456789abcdef".to_string(),
        owned(),
    ));
    registry.discard(&other);
    assert!(!exited.load(Ordering::Acquire));
    registry.discard(&session);
    assert!(exited.load(Ordering::Acquire));
    assert_eq!(
        registry.state(session.login_id()).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
}

#[test]
fn a_session_that_ends_without_a_step_reports_unavailable() {
    let registry = AgentMcpLoginRegistry::default();
    let session = registry.begin(owned(), |_| false).expect("session");
    assert_eq!(session.wait_step(WAIT), Err(McpLoginFailure::Unavailable));
}

#[test]
fn a_panicking_session_fails_without_poisoning_the_registry() {
    let registry = AgentMcpLoginRegistry::default();
    let session = registry
        .begin(owned(), |session| {
            session.step_known(awaiting());
            let _progress = session.progress();
            panic!("login session panicked");
        })
        .expect("session");
    let login_id = session.login_id().to_string();
    wait_for("panicked session never settled", || {
        registry.state(&login_id) == Ok(AgentMcpServerLoginState::Failed)
    });
    assert!(session.progress.is_poisoned());
    assert_eq!(session.wait_step(WAIT), awaiting());
    assert!(session.wait_settled(WAIT));
    let exited = Arc::new(AtomicBool::new(false));
    let next = pending(&registry, &exited);
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    assert_eq!(
        registry.state(next.login_id()),
        Ok(AgentMcpServerLoginState::Pending)
    );
    registry.cancel(next.login_id());
    assert!(exited.load(Ordering::Acquire));
    assert!(!registry.slot.is_poisoned());
}

#[test]
fn dropping_the_registry_reaps_the_active_session() {
    let registry = AgentMcpLoginRegistry::default();
    let exited = Arc::new(AtomicBool::new(false));
    let session = pending(&registry, &exited);
    drop(registry);
    assert!(exited.load(Ordering::Acquire));
    assert!(session.is_cancelled());
}

#[test]
fn shutdown_reaps_the_active_session_and_refuses_new_ones() {
    let registry = AgentMcpLoginRegistry::default();
    let exited = Arc::new(AtomicBool::new(false));
    let session = pending(&registry, &exited);
    registry.shutdown();
    assert!(exited.load(Ordering::Acquire));
    assert_eq!(
        registry.state(session.login_id()).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
    assert_eq!(
        registry.begin(owned(), |_| true).err(),
        Some(McpLoginFailure::Unavailable)
    );
    registry.shutdown();
}

#[test]
fn concurrent_logins_leave_exactly_one_active_session() {
    let registry = Arc::new(AgentMcpLoginRegistry::default());
    let running = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let most = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sessions: Vec<_> = thread::scope(|scope| {
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let registry = Arc::clone(&registry);
                let running = Arc::clone(&running);
                let most = Arc::clone(&most);
                scope.spawn(move || {
                    registry.begin(owned(), move |session| {
                        let now = running.fetch_add(1, Ordering::AcqRel) + 1;
                        most.fetch_max(now, Ordering::AcqRel);
                        session.step_known(awaiting());
                        until_cancelled(&session);
                        running.fetch_sub(1, Ordering::AcqRel);
                        false
                    })
                })
            })
            .collect();
        workers
            .into_iter()
            .filter_map(|worker| worker.join().expect("worker").ok())
            .collect()
    });
    wait_for("superseded sessions never stopped", || {
        running.load(Ordering::Acquire) <= 1
    });
    let pending: Vec<_> = sessions
        .iter()
        .filter(|session| {
            registry.state(session.login_id()) == Ok(AgentMcpServerLoginState::Pending)
        })
        .collect();
    assert_eq!(pending.len(), 1);
    assert_eq!(running.load(Ordering::Acquire), 1);
    assert_eq!(most.load(Ordering::Acquire), 1);
    registry.shutdown();
    assert_eq!(running.load(Ordering::Acquire), 0);
}

fn revocable(revoked: &Arc<AtomicBool>) -> McpLoginOwner {
    let revoked = Arc::clone(revoked);
    Arc::new(move || {
        if revoked.load(Ordering::Acquire) {
            return Err("owner revoked".to_string());
        }
        Ok(())
    })
}

#[test]
fn a_pending_session_whose_owner_is_revoked_is_reaped_instead_of_published() {
    let registry = AgentMcpLoginRegistry::default();
    let revoked = Arc::new(AtomicBool::new(false));
    let exited = Arc::new(AtomicBool::new(false));
    let body_exited = Arc::clone(&exited);
    let session = registry
        .begin(revocable(&revoked), move |session| {
            session.step_known(awaiting());
            until_cancelled(&session);
            body_exited.store(true, Ordering::Release);
            false
        })
        .expect("session");
    assert_eq!(session.wait_step(WAIT), awaiting());
    let login_id = session.login_id().to_string();
    assert_eq!(
        registry.state(&login_id),
        Ok(AgentMcpServerLoginState::Pending)
    );
    revoked.store(true, Ordering::Release);
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some("owner revoked")
    );
    assert!(exited.load(Ordering::Acquire));
    assert!(registry.is_idle());
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
}

#[test]
fn a_succeeded_session_is_not_published_once_its_owner_is_revoked() {
    let registry = AgentMcpLoginRegistry::default();
    let revoked = Arc::new(AtomicBool::new(false));
    let session = registry
        .begin(revocable(&revoked), |session| {
            session.step_known(awaiting());
            true
        })
        .expect("session");
    let login_id = session.login_id().to_string();
    wait_for("session never succeeded", || {
        registry.state(&login_id) == Ok(AgentMcpServerLoginState::Succeeded)
    });
    revoked.store(true, Ordering::Release);
    assert_eq!(
        registry.state_without_owner_check(&login_id),
        Ok(AgentMcpServerLoginState::Succeeded)
    );
    assert_eq!(
        registry.state(&login_id).err().as_deref(),
        Some("owner revoked")
    );
    assert!(registry.is_idle());
    assert_eq!(
        registry
            .state_without_owner_check(&login_id)
            .err()
            .as_deref(),
        Some(AGENT_MCP_SERVER_LOGIN_INACTIVE_ERROR)
    );
}
