use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::super::service::RepositoryLookupService;
use super::super::wire::{RepositoryHostsState, RepositoryLookupOutcome};
use super::fake_cli::{request, FakeCliDirectory};

const GITHUB_VIEW: &str = concat!(
    "cat <<'JSON'\n",
    r#"{"nameWithOwner":"acme/storefront-api","visibility":"PUBLIC","defaultBranchRef":{"name":"main"},"#,
    r#""url":"https://github.com/acme/storefront-api","#,
    r#""sshUrl":"git@github.com:acme/storefront-api.git"}"#,
    "\nJSON"
);

const GITHUB_AUTH: &str = "echo 'Logged in to github.com account tester'\nexit 0";

fn lookup(service: &Arc<RepositoryLookupService>) -> RepositoryLookupOutcome {
    service.lookup(request("github", "github.com", "acme/storefront-api"))
}

fn blocking_first_call(directory: &FakeCliDirectory, marker: &str, answer: &str) {
    let marker = directory.file(marker);
    directory.script(
        "gh",
        &format!(
            "if [ -f {marker} ]; then\n{answer}\nexit 0\nfi\ntouch {marker}\nsleep 300",
            marker = marker.to_string_lossy()
        ),
    );
}

#[test]
fn a_double_tap_inside_the_spawn_interval_still_answers_the_newest_request() {
    let directory = FakeCliDirectory::create("slot-double-tap");
    blocking_first_call(&directory, "started.marker", GITHUB_VIEW);
    let service = directory.service();
    let first_service = Arc::clone(&service);
    let first = thread::spawn(move || lookup(&first_service));
    assert!(directory.await_file("started.marker"));

    let started = Instant::now();
    let second = lookup(&service);
    let elapsed = started.elapsed();

    assert!(
        matches!(second, RepositoryLookupOutcome::Ok { .. }),
        "{second:?}"
    );
    assert_eq!(
        first.join().expect("join the superseded lookup"),
        RepositoryLookupOutcome::Superseded
    );
    assert!(elapsed < Duration::from_secs(8), "{elapsed:?}");
}

#[test]
fn a_lookup_inside_the_spawn_interval_waits_for_it_instead_of_failing() {
    let directory = FakeCliDirectory::create("slot-spawn-interval");
    directory.script("gh", GITHUB_VIEW);
    let service = directory.service();

    let first = lookup(&service);
    let started = Instant::now();
    let second = lookup(&service);
    let waited = started.elapsed();
    directory.advance_past_spawn_interval();
    let started = Instant::now();
    let third = lookup(&service);
    let admitted = started.elapsed();

    for outcome in [&first, &second, &third] {
        assert!(
            matches!(outcome, RepositoryLookupOutcome::Ok { .. }),
            "{outcome:?}"
        );
    }
    assert!(waited >= Duration::from_millis(200), "{waited:?}");
    assert!(admitted < Duration::from_millis(200), "{admitted:?}");
}

#[test]
fn a_hosts_dialog_reopened_inside_the_spawn_interval_still_reports_hosts() {
    let directory = FakeCliDirectory::create("slot-hosts-reopen");
    directory.script("gh", GITHUB_AUTH);
    let service = directory.service();

    let first = service.hosts();
    let second = service.hosts();

    assert!(
        matches!(first.github, RepositoryHostsState::Ready { .. }),
        "{first:?}"
    );
    assert!(
        matches!(second.github, RepositoryHostsState::Ready { .. }),
        "{second:?}"
    );
}
