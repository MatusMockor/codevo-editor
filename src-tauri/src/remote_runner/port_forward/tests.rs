use super::local_port;
use super::manager::{browser_url, RUNNER_PORT};
use super::registry::PortForwardRegistry;
use super::ssh_forward::{
    ForwardDestination, ForwardPlan, ForwardProgram, RemoteLoopback, SshForwardProgram,
};
use super::test_support::*;
use super::wire::{ForwardState, PortAddress, PortScheme};
use std::{
    net::{Ipv4Addr, TcpListener},
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

#[test]
fn open_refuses_an_unlisted_port_without_spawning() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    harness.listen(&scope, free_port(), PortAddress::LoopbackV4);
    let error = harness.open(&owner("w", 1), &scope, 4000).unwrap_err();
    assert!(error.contains("Nothing is listening on port 4000"));
    assert_eq!(harness.program.calls(), 0);
    assert_eq!(harness.registry.active(), 0);
    assert!(harness.opened.lock().unwrap().is_empty());
}

#[test]
fn open_never_forwards_the_runner_port() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    harness.listen(&scope, RUNNER_PORT, PortAddress::LoopbackV4);
    assert!(harness.open(&owner("w", 1), &scope, RUNNER_PORT).is_err());
    let listing = harness
        .list_at(&owner("w", 1), &scope, Instant::now())
        .unwrap();
    assert!(listing.ports.is_empty());
    assert_eq!(harness.program.calls(), 0);
}

#[test]
fn open_reuses_the_forward_for_the_same_key() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    let first = harness.open(&owner("w", 1), &scope, port).unwrap();
    let second = harness.open(&owner("w", 1), &scope, port).unwrap();
    assert_eq!(first, second);
    assert_eq!(first, port);
    assert_eq!(harness.program.calls(), 1);
    assert_eq!(harness.pids().len(), 1);
    assert_eq!(
        *harness.opened.lock().unwrap(),
        vec![format!("http://127.0.0.1:{port}/"); 2]
    );
    let listing = harness
        .list_at(&owner("w", 1), &scope, Instant::now())
        .unwrap();
    let forward = listing.ports[0].forward.unwrap();
    assert_eq!(forward.local_port, port);
    assert_eq!(forward.state, ForwardState::Open);
}

#[test]
fn limits_four_forwards_per_owner_and_eight_per_app() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let ports: Vec<u16> = (0..9).map(|_| free_port()).collect();
    for port in &ports {
        harness.listen(&scope, *port, PortAddress::LoopbackV4);
    }
    for port in &ports[..4] {
        harness.open(&owner("a", 1), &scope, *port).unwrap();
    }
    let owner_limit = harness.open(&owner("a", 1), &scope, ports[4]).unwrap_err();
    assert!(owner_limit.contains("per workspace"));
    for port in &ports[4..8] {
        harness.open(&owner("b", 1), &scope, *port).unwrap();
    }
    let app_limit = harness.open(&owner("c", 1), &scope, ports[8]).unwrap_err();
    assert!(app_limit.contains("at once"));
    assert_eq!(harness.registry.active(), 8);
    assert_eq!(harness.program.calls(), 8);
    harness.session.close();
    assert_eq!(harness.registry.active(), 0);
}

#[test]
fn session_close_kills_every_forward_process_group() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let ports = [free_port(), free_port()];
    for port in ports {
        harness.listen(&scope, port, PortAddress::LoopbackV4);
        harness.open(&owner("w", 1), &scope, port).unwrap();
    }
    let pids = harness.pids();
    assert_eq!(pids.len(), 2);
    assert!(pids.iter().all(|pid| group_alive(*pid)));
    harness.session.close();
    for pid in pids {
        assert!(group_gone(pid), "forward group {pid} survived close");
    }
    for port in ports {
        assert!(!local_port::accepting(port));
    }
    assert_eq!(harness.registry.active(), 0);
    assert!(harness.open(&owner("w", 1), &scope, ports[0]).is_err());
}

#[test]
fn dropping_the_session_kills_forwards() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    let pid = harness.pids()[0];
    let registry = Arc::clone(&harness.registry);
    drop(harness);
    assert!(group_gone(pid));
    assert_eq!(registry.active(), 0);
}

#[test]
fn owner_release_kills_only_that_owners_forwards() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let (first, second) = (free_port(), free_port());
    harness.listen(&scope, first, PortAddress::LoopbackV4);
    harness.listen(&scope, second, PortAddress::LoopbackV4);
    harness.open(&owner("a", 3), &scope, first).unwrap();
    harness.open(&owner("b", 1), &scope, second).unwrap();
    let pids = harness.pids();
    super::release_owner(&harness.registry, "a", 3);
    let survivors = harness.pids();
    assert_eq!(survivors.len(), 1);
    let released: Vec<u32> = pids
        .into_iter()
        .filter(|pid| !survivors.contains(pid))
        .collect();
    assert!(group_gone(released[0]));
    assert!(group_alive(survivors[0]));
    assert_eq!(harness.registry.active(), 1);
}

#[test]
fn retired_workspace_admission_releases_only_its_forwards() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let (editor, agent) = (free_port(), free_port());
    harness.listen(&scope, editor, PortAddress::LoopbackV4);
    harness.listen(&scope, agent, PortAddress::LoopbackV4);
    harness.open(&owner("ws", 12), &scope, editor).unwrap();
    harness.open(&owner("ws", 11), &scope, agent).unwrap();
    harness.release_retired("ws");
    assert_eq!(harness.pids().len(), 2);
    harness.authority.revoke(&owner("ws", 12));
    harness.release_retired("ws");
    assert_eq!(harness.pids().len(), 1);
    let listing = harness
        .list_at(&owner("ws", 11), &scope, Instant::now())
        .unwrap();
    let agent_forward = listing.ports.iter().find(|p| p.port == agent).unwrap();
    assert!(agent_forward.forward.is_some());
    assert!(harness
        .list_at(&owner("ws", 12), &scope, Instant::now())
        .is_err());
}

#[test]
fn listing_retires_forwards_of_admissions_dropped_without_close() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("ws", 5), &scope, port).unwrap();
    let old = harness.pids()[0];
    harness.authority.revoke(&owner("ws", 5));
    harness
        .list_at(&owner("ws", 6), &scope, Instant::now())
        .unwrap();
    assert!(harness.pids().is_empty());
    assert!(group_gone(old));
    assert_eq!(harness.registry.active(), 0);
}

#[test]
fn owner_limit_counts_every_admission_of_a_workspace() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let ports: Vec<u16> = (0..5).map(|_| free_port()).collect();
    for port in &ports {
        harness.listen(&scope, *port, PortAddress::LoopbackV4);
    }
    for (index, port) in ports[..4].iter().enumerate() {
        harness
            .open(&owner("ws", 1 + (index as u64 % 2)), &scope, *port)
            .unwrap();
    }
    assert!(harness
        .open(&owner("ws", 2), &scope, ports[4])
        .unwrap_err()
        .contains("per workspace"));
}

#[test]
fn owner_generation_distinguishes_a_b_a() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    let old = harness.pids()[0];
    harness.authority.revoke(&owner("w", 1));
    assert!(harness.open(&owner("w", 1), &scope, port).is_err());
    assert!(harness
        .list_at(&owner("w", 1), &scope, Instant::now())
        .is_err());
    let listing = harness
        .list_at(&owner("w", 2), &scope, Instant::now())
        .unwrap();
    assert!(listing.ports[0].forward.is_none());
    harness.release_retired("w");
    assert!(group_gone(old));
    let local = harness.open(&owner("w", 2), &scope, port).unwrap();
    assert_eq!(harness.pids().len(), 1);
    assert!(local_port::accepting(local));
}

#[test]
fn release_owner_ignores_invalid_owner() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    super::release_owner(&harness.registry, "w", 0);
    super::release_owner(&harness.registry, "w\n", 1);
    assert_eq!(harness.pids().len(), 1);
}

fn readiness_race(change: impl FnOnce(&Harness), synchronous: bool) {
    let directory = std::env::temp_dir().join(format!(
        "codevo-forward-race-{}-{}",
        std::process::id(),
        free_port()
    ));
    std::fs::create_dir(&directory).unwrap();
    let mut harness = Harness::new(Behaviour::Listen);
    harness.program.pid_file = Some(directory.join("pid"));
    *harness.program.delay.lock().unwrap() = 3.0;
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    let harness = Arc::new(harness);
    let opener = Arc::clone(&harness);
    let worker_scope = scope.clone();
    let worker = std::thread::spawn(move || opener.open(&owner("w", 1), &worker_scope, port));
    let pid_file = directory.join("pid");
    assert!(wait_for(
        || std::fs::read_to_string(&pid_file).is_ok_and(|pid| !pid.is_empty())
    ));
    let pid: u32 = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
    change(&harness);
    if synchronous {
        assert!(group_gone(pid), "pending child survived the owner close");
    }
    assert!(worker.join().unwrap().is_err());
    assert!(group_gone(pid));
    assert!(!local_port::accepting(port));
    assert!(harness.pids().is_empty());
    assert_eq!(harness.registry.active(), 0);
    assert_eq!(harness.registry.claimed(), 0);
    assert!(harness.opened.lock().unwrap().is_empty());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn connection_change_during_readiness_kills_the_child() {
    readiness_race(
        |harness| harness.connected.store(false, Ordering::SeqCst),
        false,
    );
}

#[test]
fn owner_retired_during_readiness_kills_the_child() {
    readiness_race(|harness| harness.authority.revoke(&owner("w", 1)), false);
}

#[test]
fn owner_release_during_readiness_kills_the_child() {
    readiness_race(
        |harness| super::release_owner(&harness.registry, "w", 1),
        true,
    );
}

#[test]
fn session_close_during_readiness_kills_the_child() {
    readiness_race(|harness| harness.session.close(), true);
}

#[test]
fn concurrent_opens_never_share_a_local_port() {
    let mut harness = Harness::new(Behaviour::Listen);
    *harness.program.delay.lock().unwrap() = 0.5;
    harness.program.pid_file = None;
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    let harness = Arc::new(harness);
    let workers: Vec<_> = ["a", "b"]
        .into_iter()
        .map(|id| {
            let opener = Arc::clone(&harness);
            let scope = scope.clone();
            std::thread::spawn(move || opener.open(&owner(id, 1), &scope, port))
        })
        .collect();
    let locals: Vec<u16> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap().unwrap())
        .collect();
    assert_ne!(locals[0], locals[1]);
    assert!(locals.contains(&port));
    assert_eq!(harness.pids().len(), 2);
    assert_eq!(harness.registry.claimed(), 2);
    harness.session.close();
    assert_eq!(harness.registry.claimed(), 0);
}

#[test]
fn bind_collision_falls_back_to_an_ephemeral_port() {
    let harness = Harness::new(Behaviour::CollideFirst);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    let local = harness.open(&owner("w", 1), &scope, port).unwrap();
    let plans = harness.program.plans.lock().unwrap().clone();
    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].0, port);
    assert_eq!(plans[1].0, local);
    assert_ne!(local, port);
    assert!(local_port::accepting(local));
}

#[test]
fn occupied_preferred_port_uses_an_ephemeral_port() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let blocker = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = blocker.local_addr().unwrap().port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    let local = harness.open(&owner("w", 1), &scope, port).unwrap();
    assert_ne!(local, port);
    assert!(local >= 1024);
    assert_eq!(harness.program.calls(), 1);
}

#[test]
fn dead_forward_process_is_pruned() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    let pid = harness.pids()[0];
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
    assert!(wait_for(|| {
        harness
            .list_at(&owner("w", 1), &scope, Instant::now())
            .unwrap()
            .ports[0]
            .forward
            .is_none()
    }));
    assert!(harness.pids().is_empty());
    assert_eq!(harness.registry.active(), 0);
}

#[test]
fn port_missing_for_thirty_seconds_is_pruned() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    let pid = harness.pids()[0];
    harness.stop_listening();
    let start = Instant::now();
    harness
        .list_at(&owner("w", 1), &scope, start + Duration::from_secs(29))
        .unwrap();
    assert_eq!(harness.pids(), vec![pid]);
    harness
        .list_at(&owner("w", 1), &scope, start + Duration::from_secs(31))
        .unwrap();
    assert!(harness.pids().is_empty());
    assert!(group_gone(pid));
}

#[test]
fn listing_another_scope_sweeps_stale_forwards_of_the_owner() {
    let harness = Harness::new(Behaviour::Listen);
    let (scope, other) = (task(TASK_A), task(TASK_B));
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    harness.stop_listening();
    let start = Instant::now();
    let before = harness.listings.load(Ordering::SeqCst);
    harness
        .list_at(&owner("w", 1), &other, start + Duration::from_secs(5))
        .unwrap();
    assert_eq!(harness.listings.load(Ordering::SeqCst), before + 1);
    assert_eq!(harness.pids().len(), 1);
    harness
        .list_at(&owner("w", 1), &other, start + Duration::from_secs(31))
        .unwrap();
    assert_eq!(harness.listings.load(Ordering::SeqCst), before + 3);
    assert!(harness.pids().is_empty());
}

#[test]
fn truncated_listing_never_prunes_missing_ports() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    harness.stop_listening();
    harness.truncated.store(true, Ordering::SeqCst);
    harness
        .list_at(
            &owner("w", 1),
            &scope,
            Instant::now() + Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(harness.pids().len(), 1);
}

#[test]
fn deleted_conversation_forwards_are_swept_after_grace() {
    let harness = Harness::new(Behaviour::Listen);
    let (scope, other) = (task(TASK_A), task(TASK_B));
    let port = free_port();
    harness.listen(&scope, port, PortAddress::LoopbackV4);
    harness.open(&owner("w", 1), &scope, port).unwrap();
    harness.gone.lock().unwrap().push(scope.clone());
    harness
        .list_at(
            &owner("w", 1),
            &other,
            Instant::now() + Duration::from_secs(31),
        )
        .unwrap();
    assert!(harness.pids().is_empty());
    assert_eq!(harness.registry.active(), 0);
}

#[test]
fn ipv6_only_listener_is_forwarded_to_ipv6_loopback() {
    let harness = Harness::new(Behaviour::Listen);
    let scope = task(TASK_A);
    let (v6, dual) = (free_port(), free_port());
    harness.listen(&scope, v6, PortAddress::LoopbackV6);
    harness.listen(&scope, dual, PortAddress::LoopbackV4);
    harness.listen(&scope, dual, PortAddress::AnyV6);
    harness.open(&owner("w", 1), &scope, v6).unwrap();
    harness.open(&owner("w", 1), &scope, dual).unwrap();
    let plans = harness.program.plans.lock().unwrap().clone();
    assert_eq!(plans[0].1, RemoteLoopback::V6);
    assert_eq!(plans[1].1, RemoteLoopback::V4);
}

#[test]
fn ssh_plan_binds_local_loopback_and_targets_server_loopback() {
    let destination = ForwardDestination::new("linux", "example.com", "codex", 2222);
    for (target, expected) in [
        (RemoteLoopback::V4, "127.0.0.1:5000:127.0.0.1:3000"),
        (RemoteLoopback::V6, "127.0.0.1:5000:[::1]:3000"),
    ] {
        let command = SshForwardProgram.command(&ForwardPlan {
            destination: &destination,
            local_port: 5000,
            target,
            remote_port: 3000,
        });
        assert_eq!(command.get_program(), "ssh");
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let forward = args.iter().position(|arg| arg == "-L").unwrap();
        assert_eq!(args[forward + 1], expected);
        assert_eq!(args[args.len() - 2..], ["--", "example.com"]);
        for option in [
            "BatchMode=yes",
            "StrictHostKeyChecking=yes",
            "ExitOnForwardFailure=yes",
            "GatewayPorts=no",
            "ForwardAgent=no",
            "ControlPath=none",
        ] {
            assert!(args.iter().any(|arg| arg == option), "missing {option}");
        }
        assert!(args.iter().any(|arg| arg == "-N"));
        assert!(args.windows(2).any(|pair| pair == ["-p", "2222"]));
        assert!(args.windows(2).any(|pair| pair == ["-l", "codex"]));
    }
}

#[test]
fn browser_url_is_loopback_only_and_validates_path() {
    assert_eq!(
        browser_url(PortScheme::Https, 5173, "/app?tab=1#top").unwrap(),
        "https://127.0.0.1:5173/app?tab=1#top"
    );
    assert_eq!(
        browser_url(PortScheme::Http, 3000, "//evil.example/x").unwrap(),
        "http://127.0.0.1:3000//evil.example/x"
    );
    assert_eq!(
        browser_url(PortScheme::Http, 3000, "/a b").unwrap(),
        "http://127.0.0.1:3000/a%20b"
    );
    for path in ["", "app", "/a\\b", "/a\nb", "http://x"] {
        assert!(browser_url(PortScheme::Http, 3000, path).is_err(), "{path}");
    }
    assert!(browser_url(PortScheme::Http, 3000, &format!("/{}", "a".repeat(2048))).is_err());
}

#[test]
fn shared_registry_counts_forwards_across_sessions() {
    let registry = Arc::new(PortForwardRegistry::default());
    let first = Harness::with_registry(Behaviour::Listen, Arc::clone(&registry));
    let second = Harness::with_registry(Behaviour::Listen, Arc::clone(&registry));
    let scope = task(TASK_A);
    let ports: Vec<u16> = (0..5).map(|_| free_port()).collect();
    for port in &ports {
        first.listen(&scope, *port, PortAddress::LoopbackV4);
        second.listen(&scope, *port, PortAddress::LoopbackV4);
    }
    for port in &ports[..2] {
        first.open(&owner("w", 1), &scope, *port).unwrap();
    }
    for port in &ports[2..4] {
        second.open(&owner("w", 1), &scope, *port).unwrap();
    }
    assert!(second.open(&owner("w", 1), &scope, ports[4]).is_err());
    super::release_owner(&registry, "w", 1);
    assert!(first.pids().is_empty());
    assert!(second.pids().is_empty());
    assert_eq!(registry.active(), 0);
}
