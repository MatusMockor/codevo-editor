use super::*;
use std::time::Instant;

fn shell(script: &str) -> Command {
    let mut command = Command::new("sh");
    command.arg("-c").arg(script);
    command
}

#[test]
fn prefix_runner_returns_complete_output_uncapped() {
    let result = run_bounded_command_prefix(shell("printf abc"), Duration::from_secs(10), 8);
    assert_eq!(result, Ok((b"abc".to_vec(), false)));
}

#[test]
fn prefix_runner_returns_exact_limit_uncapped() {
    let result = run_bounded_command_prefix(shell("printf abcd"), Duration::from_secs(10), 4);
    assert_eq!(result, Ok((b"abcd".to_vec(), false)));
}

#[test]
fn prefix_runner_caps_endless_output_and_kills_the_process_group() {
    let started = Instant::now();
    let result = run_bounded_command_prefix(shell("yes x"), Duration::from_secs(20), 1_000);
    assert_eq!(result, Ok(("x\n".repeat(500).into_bytes(), true)));
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn prefix_runner_reports_failures_and_timeouts() {
    let failed =
        run_bounded_command_prefix(shell("echo broken >&2; exit 3"), Duration::from_secs(10), 8);
    let timed_out = run_bounded_command_prefix(shell("sleep 5"), Duration::from_millis(200), 8);
    assert_eq!(failed, Err(CommandError::Failed("broken".to_string())));
    assert_eq!(
        timed_out,
        Err(CommandError::TimedOut(Duration::from_millis(200)))
    );
}
