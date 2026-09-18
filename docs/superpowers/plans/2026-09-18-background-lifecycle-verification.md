# Claude background lifecycle verification

The deterministic fixtures launch real child processes that emit Claude-shaped
stream events. They do not invoke Claude, call an AI service, or assert that a
textual promise automatically schedules monitoring.

## Desktop process boundary

`src-tauri/tests/agent_task_supervisor_tests.rs` contains
`real_process_background_monitor_keeps_stdin_until_delayed_answer`.
The fixture reads the initial prompt, emits a `local_bash` task start and early
successful result, then delays its task notification and parent assistant answer.
Closing stdin cancels its worker. A second delay after the notification verifies
that the notification itself cannot terminate the session before the final answer.

The actual macOS supervisor/spawner integration passed (one test, 0.44 seconds).
The test was subsequently renamed to clarify that its provider is simulated.
Repository-wide verification is coordinated separately by the lead agent.

## Linux runner boundary

On `codex@192.168.1.110`, source, tests, package manifests, TypeScript configuration,
and install scripts were copied into disposable `/tmp/codevo-background-qa.*`
directories. No credentials, private configuration, production checkout, or
service files were copied or changed. Node v24.19.0 was used.

- Isolated installation, typecheck, build and full tests passed: 336 passed,
  two skipped, zero failed.
- After the final paused-task handling change, the three focused suites passed:
  23 passed, zero failed.
- Exact regression proof: only `claude-interactive.ts` was replaced with its
  pre-change Git HEAD version inside the disposable directory. The EOF-sensitive
  test failed because the delayed `Pipeline finished` answer was absent.
- Restoring the corrected file and rebuilding made the same test pass (one test,
  approximately 99 ms).

Both disposable directories were removed. The production user service remained
active with unchanged PID 167897 before and after validation. Nothing was deployed.

## Scope of proof

These tests prove retention and delivery through the native and Linux process
boundaries, including the concrete early-stdin-close regression. They do not prove
that a particular historical screenshot contained a real background task, nor do
they turn an assistant's prose promise into a durable scheduled job. No real AI
conversation was created or modified during this verification.
