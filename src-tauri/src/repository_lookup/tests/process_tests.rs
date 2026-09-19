use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use super::super::process::{plan_command, run_bounded, ProcessError, ProcessLimits};
use super::super::process_guard::{ChildGuard, ProcessKillSwitch};
use super::fake_cli::{
    await_process_exit, detaching_sleep_command, process_is_alive, terminate_process,
    FakeCliDirectory, TEST_SEARCH_PATH,
};

const ALLOWED_ENVIRONMENT_KEYS: [&str; 22] = [
    "HOME",
    "PATH",
    "USER",
    "XDG_CONFIG_HOME",
    "GH_CONFIG_DIR",
    "GLAB_CONFIG_DIR",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "NO_PROXY",
    "no_proxy",
    "ALL_PROXY",
    "all_proxy",
    "SSL_CERT_FILE",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "NO_COLOR",
    "GH_PROMPT_DISABLED",
    "GH_NO_UPDATE_NOTIFIER",
    "GLAB_CHECK_UPDATE",
    "LC_ALL",
];

const SHELL_PROVIDED_ENVIRONMENT_KEYS: [&str; 3] = ["PWD", "SHLVL", "_"];

const REJECTED_ENVIRONMENT: [(&str, &str); 3] = [
    ("GH_TOKEN", "gho-parent-secret"),
    ("GITLAB_TOKEN", "glpat-parent-secret"),
    ("GH_HOST", "ghes.example.com"),
];

const FORWARDED_ENVIRONMENT: [(&str, &str); 3] = [
    ("https_proxy", "http://proxy.example.com:3128"),
    ("no_proxy", "localhost"),
    ("all_proxy", "socks5://proxy.example.com:1080"),
];

static KILL_STEPS: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
static SIGNALLING: AtomicBool = AtomicBool::new(false);

fn record_step(step: &'static str) {
    KILL_STEPS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(step);
}

fn slow_terminator(_process_id: u32) {
    SIGNALLING.store(true, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(100));
    record_step("signalled");
}

fn shell_command(script: &Path, home: &Path) -> std::process::Command {
    plan_command(
        Path::new("/bin/sh"),
        &[script.to_string_lossy().into_owned()],
        home,
        TEST_SEARCH_PATH,
    )
}

fn limits(timeout_ms: u64, stdout_bytes: usize) -> ProcessLimits {
    ProcessLimits {
        timeout: Duration::from_millis(timeout_ms),
        stdout_bytes,
        stderr_bytes: 8 * 1024,
    }
}

#[test]
fn timeout_reaps_the_whole_process_group_including_grandchildren() {
    let directory = FakeCliDirectory::create("timeout");
    let grandchild = directory.file("grandchild.pid");
    let script = directory.script(
        "gh",
        &format!(
            "sleep 300 &\necho $! > {}\nsleep 300",
            grandchild.to_string_lossy()
        ),
    );
    let command = shell_command(&script, directory.base());
    let kill = std::sync::Arc::new(ProcessKillSwitch::default());
    let runner = std::sync::Arc::clone(&kill);
    let started = Instant::now();
    let handle = std::thread::spawn(move || run_bounded(command, limits(2_000, 1024), &runner));

    assert!(directory.await_file("grandchild.pid"));
    assert_eq!(
        handle.join().expect("join the timed out run"),
        Err(ProcessError::TimedOut)
    );
    let elapsed = started.elapsed();
    assert!(elapsed < Duration::from_secs(8), "{elapsed:?}");
    let process_id = directory
        .read("grandchild.pid")
        .trim()
        .parse::<i32>()
        .expect("grandchild process id");
    assert!(await_process_exit(process_id));
}

#[test]
fn a_detached_grandchild_holding_stdout_cannot_outlive_the_deadline() {
    let Some(detaching_sleep) = detaching_sleep_command() else {
        return;
    };
    let directory = FakeCliDirectory::create("setsid");
    let grandchild = directory.file("grandchild.pid");
    let script = directory.script(
        "gh",
        &format!(
            "{detaching_sleep} &\necho $! > {}\nexit 0",
            grandchild.to_string_lossy()
        ),
    );
    let command = shell_command(&script, directory.base());
    let started = Instant::now();

    let result = run_bounded(command, limits(2_000, 1024), &ProcessKillSwitch::default());

    let elapsed = started.elapsed();
    assert!(directory.await_file("grandchild.pid"));
    let detached = directory
        .read("grandchild.pid")
        .trim()
        .parse::<i32>()
        .unwrap_or_default();
    terminate_process(detached);
    assert_eq!(result, Err(ProcessError::TimedOut));
    assert!(elapsed < Duration::from_secs(8), "{elapsed:?}");
}

#[test]
fn stdout_beyond_the_limit_reports_output_too_large() {
    let directory = FakeCliDirectory::create("overflow");
    let script = directory.script("gh", "head -c 8192 /dev/zero | tr '\\0' a");
    let command = plan_command(&script, &[], directory.base(), TEST_SEARCH_PATH);

    let result = run_bounded(command, limits(10_000, 1024), &ProcessKillSwitch::default());

    assert_eq!(result, Err(ProcessError::OutputTooLarge));
}

#[test]
fn stdout_at_the_limit_is_returned() {
    let directory = FakeCliDirectory::create("bounded");
    let script = directory.script("gh", "head -c 1024 /dev/zero | tr '\\0' a");
    let command = plan_command(&script, &[], directory.base(), TEST_SEARCH_PATH);

    let output = run_bounded(command, limits(10_000, 1024), &ProcessKillSwitch::default())
        .expect("bounded output");

    assert_eq!(output.stdout.len(), 1024);
    assert!(output.success);
}

#[test]
fn dropping_the_child_guard_kills_and_reaps_the_group() {
    let directory = FakeCliDirectory::create("drop");
    let grandchild = directory.file("grandchild.pid");
    let script = directory.script(
        "gh",
        &format!(
            "sleep 300 &\necho $! > {}\nsleep 300",
            grandchild.to_string_lossy()
        ),
    );
    let command = shell_command(&script, directory.base());

    let guard = ChildGuard::spawn(command).expect("spawn fake cli");
    let child = i32::try_from(guard.process_id()).expect("child process id");
    assert!(directory.await_file("grandchild.pid"));
    let descendant = directory
        .read("grandchild.pid")
        .trim()
        .parse::<i32>()
        .expect("grandchild process id");
    assert!(process_is_alive(child));
    drop(guard);

    assert!(await_process_exit(child));
    assert!(await_process_exit(descendant));
}

#[test]
fn the_kill_switch_terminates_a_running_process() {
    let directory = FakeCliDirectory::create("kill-switch");
    let script = directory.script("gh", "sleep 300");
    let command = plan_command(&script, &[], directory.base(), TEST_SEARCH_PATH);
    let kill = std::sync::Arc::new(ProcessKillSwitch::default());
    let killer = std::sync::Arc::clone(&kill);
    let handle = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        killer.kill();
    });

    let output = run_bounded(command, limits(10_000, 1024), &kill).expect("killed output");

    handle.join().expect("join killer");
    assert!(!output.success);
    assert_eq!(output.exit_code, None);
}

#[test]
fn deregistration_waits_for_an_in_flight_kill_signal() {
    let kill = Arc::new(ProcessKillSwitch::with_terminator(slow_terminator));
    let registration = kill.register(424_242);
    assert!(registration.accepted());
    let killer = Arc::clone(&kill);
    let handle = thread::spawn(move || killer.kill());
    while !SIGNALLING.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(1));
    }

    drop(registration);
    record_step("deregistered");

    handle.join().expect("join the killing thread");
    let steps = KILL_STEPS.lock().unwrap_or_else(PoisonError::into_inner);
    assert_eq!(*steps, vec!["signalled", "deregistered"]);
}

#[test]
fn the_child_environment_is_cleared_to_the_allow_list() {
    let directory = FakeCliDirectory::create("environment");
    let script = directory.script("gh", "env");
    for (key, value) in REJECTED_ENVIRONMENT
        .iter()
        .chain(FORWARDED_ENVIRONMENT.iter())
    {
        std::env::set_var(key, value);
    }
    let command = shell_command(&script, directory.base());

    let output = run_bounded(
        command,
        limits(10_000, 64 * 1024),
        &ProcessKillSwitch::default(),
    );

    for (key, _) in REJECTED_ENVIRONMENT
        .iter()
        .chain(FORWARDED_ENVIRONMENT.iter())
    {
        std::env::remove_var(key);
    }
    let output = output.expect("environment output");
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let allowed = ALLOWED_ENVIRONMENT_KEYS
        .iter()
        .chain(SHELL_PROVIDED_ENVIRONMENT_KEYS.iter())
        .collect::<BTreeSet<_>>();
    for line in text.lines() {
        let Some((key, _)) = line.split_once('=') else {
            continue;
        };
        assert!(allowed.contains(&key), "unexpected environment key {key}");
    }
    assert!(!text.contains("CARGO"));
    assert!(!text.contains("RUST_"));
    assert!(text.contains("NO_COLOR=1"));
    assert!(text.contains("LC_ALL=C"));
    assert!(text.contains(&format!("PATH={TEST_SEARCH_PATH}")));
    assert!(text.contains(&format!("HOME={}", directory.base().to_string_lossy())));
    for (key, value) in REJECTED_ENVIRONMENT {
        assert!(!text.contains(key), "{key}");
        assert!(!text.contains(value), "{value}");
    }
    for (key, value) in FORWARDED_ENVIRONMENT {
        assert!(text.contains(&format!("{key}={value}")), "{key}");
    }
}
