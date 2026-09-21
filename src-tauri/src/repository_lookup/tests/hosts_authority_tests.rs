use std::sync::Arc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use super::super::clock::TestClock;
use super::super::hosts::{HOSTS_CACHE_TTL, HOSTS_REFRESH_DEBOUNCE};
use super::super::plan::CliProgram;
use super::super::resolver::{ExecutableResolver, ResolvedExecutable};
use super::super::service::RepositoryLookupService;
use super::super::wire::{
    RepositoryHostsState, RepositoryLookupFailureReason, RepositoryLookupOutcome,
};
use super::fake_cli::TEST_SEARCH_PATH;
use super::fake_cli::{request, FakeCliDirectory};

const AUTH_STATUS: &str = concat!(
    "if [ \"$1\" = \"auth\" ]; then\n",
    "  echo 'spawn' >> SPAWNS\n",
    "  echo 'gitlab.example.com'\n",
    "  echo '  Logged in to gitlab.example.com as tester (keyring)'\n",
    "  exit 0\n",
    "fi\n",
    "echo '{}'\n"
);

fn glab(directory: &FakeCliDirectory) {
    let body = AUTH_STATUS.replace("SPAWNS", &directory.file("glab.spawns").to_string_lossy());
    directory.script("glab", &body);
}

fn spawn_count(directory: &FakeCliDirectory) -> usize {
    directory.read("glab.spawns").lines().count()
}

fn unknown_host_lookup(service: &Arc<RepositoryLookupService>) -> RepositoryLookupOutcome {
    service.lookup(request(
        "gitlab",
        "gitlab.internal.example",
        "platform/billing-service",
    ))
}

#[test]
fn an_unknown_host_refreshes_once_and_then_answers_from_the_debounce_window() {
    let directory = FakeCliDirectory::create("hosts-debounce");
    glab(&directory);
    let service = directory.service();

    let first = unknown_host_lookup(&service);
    directory.advance_past_spawn_interval();
    let second = unknown_host_lookup(&service);
    directory.advance_past_spawn_interval();
    let third = unknown_host_lookup(&service);

    assert_eq!(first, RepositoryLookupOutcome::HostNotAllowed);
    assert_eq!(second, RepositoryLookupOutcome::HostNotAllowed);
    assert_eq!(third, RepositoryLookupOutcome::HostNotAllowed);
    assert_eq!(spawn_count(&directory), 1);
}

#[test]
fn an_unknown_host_refreshes_again_once_the_debounce_window_expires() {
    let directory = FakeCliDirectory::create("hosts-debounce-expiry");
    glab(&directory);
    let service = directory.service();

    let first = unknown_host_lookup(&service);
    directory.clock().advance(HOSTS_REFRESH_DEBOUNCE);
    let second = unknown_host_lookup(&service);

    assert_eq!(first, RepositoryLookupOutcome::HostNotAllowed);
    assert_eq!(second, RepositoryLookupOutcome::HostNotAllowed);
    assert_eq!(spawn_count(&directory), 2);
    assert!(HOSTS_REFRESH_DEBOUNCE < HOSTS_CACHE_TTL);
}

#[test]
fn a_lookup_refresh_never_supersedes_a_running_hosts_call() {
    let directory = FakeCliDirectory::create("hosts-contention");
    glab(&directory);
    let service = directory.service();
    let lease = service
        .hosts_slot()
        .acquire()
        .expect("occupy the hosts slot");

    let started = Instant::now();
    let outcome = unknown_host_lookup(&service);
    let elapsed = started.elapsed();

    assert_eq!(
        outcome,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Busy
        }
    );
    assert!(!lease.superseded());
    assert!(!service.hosts_slot().has_waiter());
    assert!(elapsed < Duration::from_secs(1), "{elapsed:?}");
    assert_eq!(spawn_count(&directory), 0);
    drop(lease);
}

#[test]
fn back_to_back_refreshes_without_a_usable_cli_report_the_missing_cli_and_contention() {
    let directory = FakeCliDirectory::create("hosts-spawn-interval");
    let service = directory.service();

    let first = unknown_host_lookup(&service);
    let second = unknown_host_lookup(&service);
    directory.advance_past_spawn_interval();
    let third = unknown_host_lookup(&service);

    assert_eq!(first, RepositoryLookupOutcome::CliMissing);
    assert_eq!(
        second,
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Busy
        }
    );
    assert_eq!(third, RepositoryLookupOutcome::CliMissing);
}

#[test]
fn a_user_hosts_call_rechecks_the_cli_once_the_debounce_window_expires() {
    let directory = FakeCliDirectory::create("hosts-user-refresh");
    glab(&directory);
    let service = directory.service();

    let first = service.hosts();
    directory.clock().advance(Duration::from_secs(2));
    let debounced = service.hosts();
    let debounced_spawns = spawn_count(&directory);
    directory.clock().advance(Duration::from_secs(4));
    let refreshed = service.hosts();

    for snapshot in [&first, &debounced, &refreshed] {
        assert!(
            matches!(snapshot.gitlab, RepositoryHostsState::Ready { .. }),
            "{snapshot:?}"
        );
    }
    assert_eq!(debounced_spawns, 1);
    assert_eq!(spawn_count(&directory), 2);
    assert!(HOSTS_REFRESH_DEBOUNCE < HOSTS_CACHE_TTL);
}

#[test]
fn a_refresh_superseded_by_a_user_hosts_call_reports_busy() {
    let directory = FakeCliDirectory::create("hosts-superseded");
    let marker = directory.file("auth.marker");
    directory.script(
        "glab",
        &format!(
            "if [ \"$1\" = \"auth\" ]; then\n  if [ -f {marker} ]; then\n    echo 'gitlab.example.com'\n    echo '  Logged in to gitlab.example.com as tester (keyring)'\n    exit 0\n  fi\n  touch {marker}\n  sleep 300\nfi\necho '{{}}'\n",
            marker = marker.to_string_lossy()
        ),
    );
    let service = directory.service();
    let lookup_service = Arc::clone(&service);
    let lookup = thread::spawn(move || unknown_host_lookup(&lookup_service));
    assert!(directory.await_file("auth.marker"));
    directory.advance_past_spawn_interval();

    let snapshot = service.hosts();

    assert_eq!(
        lookup.join().expect("join the superseded lookup"),
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Busy
        }
    );
    assert!(
        matches!(snapshot.gitlab, RepositoryHostsState::Ready { .. }),
        "{snapshot:?}"
    );
}

#[test]
fn a_superseded_refresh_reports_busy_even_when_its_process_cannot_start() {
    struct HeldResolver {
        path: std::path::PathBuf,
        first: AtomicBool,
        entered: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    impl ExecutableResolver for HeldResolver {
        fn resolve(&self, program: CliProgram) -> Option<ResolvedExecutable> {
            if program.executable_name() != "glab" {
                return None;
            }
            let path = if self.first.swap(false, Ordering::SeqCst) {
                self.entered.send(()).expect("publish held refresh");
                self.release
                    .lock()
                    .expect("release lock")
                    .recv_timeout(Duration::from_secs(10))
                    .expect("release held refresh");
                self.path.with_file_name("missing-cli")
            } else {
                self.path.clone()
            };
            Some(ResolvedExecutable {
                path,
                search_path: TEST_SEARCH_PATH.to_owned(),
            })
        }
    }
    let directory = FakeCliDirectory::create("hosts-superseded-spawn-error");
    glab(&directory);
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let clock = Arc::new(TestClock::new());
    let service = Arc::new(RepositoryLookupService::with_clock(
        Arc::new(HeldResolver {
            path: directory.file("glab"),
            first: AtomicBool::new(true),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
        directory.base().to_path_buf(),
        clock.clone(),
    ));
    let lookup_service = Arc::clone(&service);
    let lookup = thread::spawn(move || unknown_host_lookup(&lookup_service));
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("refresh entered resolver");
    // Remove the admission delay so observing the waiter under the slot mutex
    // also proves that it has marked the running refresh superseded.
    clock.advance(Duration::from_secs(1));
    let hosts_service = Arc::clone(&service);
    let hosts = thread::spawn(move || hosts_service.hosts());
    let deadline = Instant::now() + Duration::from_secs(10);
    while !service.hosts_slot().has_waiter() {
        assert!(
            Instant::now() < deadline,
            "user hosts call did not supersede refresh"
        );
        thread::yield_now();
    }
    release_tx
        .send(())
        .expect("release failed spawn after supersession");
    assert_eq!(
        lookup.join().expect("lookup joined"),
        RepositoryLookupOutcome::Failed {
            reason: RepositoryLookupFailureReason::Busy,
        }
    );
    assert!(matches!(
        hosts.join().expect("hosts joined").gitlab,
        RepositoryHostsState::Ready { .. }
    ));
}
