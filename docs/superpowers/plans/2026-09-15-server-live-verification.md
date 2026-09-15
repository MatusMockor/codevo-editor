# Server update and native verification, September 15

Linux became available and the user authorized resuming deployment and verification.
Runner source was staged under `/home/codex/Developer/.agent/runner-updates/20260915-stream-search/staging`.
All 173 tests passed on Linux, without platform skips. No new OS packages or database
migration were necessary. After checking that tasks and clones were idle, the existing
systemd user service was stopped, source/runtime and SQLite were backed up, and the
tested source/runtime installed in `/home/codex/Developer/codevo-runner`.

The service restarted as PID 20742. Runner identity stayed
`0080d352-dbb1-477d-9eda-c5f3f47d1b70`, the original 20 tasks were preserved, and the
history search endpoint responded successfully. Private config, credentials, projects
and workspaces were preserved. Backup: `.../20260915-stream-search/backup`, mode 0700.
For rollback restore runtime/source; do not routinely replace the database with an
older backup after new tasks have been created.

## Native editor proof

Built current source as the separate `Codevo Editor QA` native app. In the existing
thread interface, selected Linux and the disposable `Live E2E verification` project.

1. Started task `c204ed05-8c17-4e3d-886d-bf80b983f96c` from the composer. Observed
   streamed output and the foreground `sleep 45` command, then quit the QA app.
   No QA process or owned SSH tunnel remained locally. The server completed the
   task and created `server-resume-20260915.txt` containing `codex-ubuntu`.
2. Reopened QA, explicitly reconnected the saved Linux server, and selected the
   test project without opening the completed thread. Searched `LANTERN-40141`,
   a computed answer absent from the input prompt. Search returned the saved
   assistant response. Enter opened the thread, loaded its history, displayed
   `1 of 1`, and visibly highlighted that answer in the original UI.
3. Sent continuation `a12b0690-5dba-41f7-b421-80fb096ce9ce`, asking for the remembered
   first-turn phrase without supplying it again or reading files. The visible
   response was `EMBER-7236`. Both turns used provider session
   `01a0a4d7-ed16-7262-92e8-234360f9fb50`.
4. Started cancellation turn `e1c79a57-ecc1-4df8-9ac5-6a10cba9d70e` with foreground
   `sleep 90`. Selected **Stop** from the thread actions menu. UI showed Stopped;
   the database recorded cancelled, provider PID 23029 and sleep PID 23694 were
   gone, and the service PID stayed 20742.

An independent read-only agent verified completion, server file contents, shared
provider session, stopped task and no active tasks. Two idle samples 59 seconds
apart found one unchanged owned SSH tunnel and the same established runner
connection. These samples do not prove the absence of transient processes between
observations or independently inspect WebSocket frames.

The latest Rust live transport test separately passed: 20 reads through one SSH
process, median 7.196 ms / p95 11.566 ms, with process reaping verified on close.

## Remaining limits

- Reopening currently requires explicitly reconnecting the saved server; this test
  does not demonstrate automatic reconnect at application startup.
- The supplemental native image-picker test selected the prepared PNG and enabled
  Open, but subsequent app accessibility calls timed out. Native and WebContent
  process samples showed normal event loops, not a demonstrated app deadlock.
  Native picker-to-provider delivery remains unverified; do not call it passed.
- Remote file/terminal opening, remote imported-session discovery and a synchronized
  offline history index are outside this verification.
- Test tasks and the isolated worktree are retained as evidence, not deleted.

Detailed logs and independent JSON evidence:
`/Users/matusmockor/.codex/task-logs/server-resume-20260915/`.
