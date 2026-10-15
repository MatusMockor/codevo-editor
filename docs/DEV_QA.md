# Dev QA

Codevo is an agent app. Development QA combines the scripted smoke runner with a
short manual desktop pass over the agent workflows.

## Scripted smoke

`scripts/qa-smoke.mjs` runs a named smoke mode:

```sh
npm run smoke            # same as fast
npm run smoke:fast
npm run smoke:extended
npm run smoke:full
npm run smoke:desktop
```

Modes:

- `fast`: TypeScript check and a targeted Vitest profile for agent layout and
  surfaces, workspace runtime lifecycle, projects, thread store, turn dispatch,
  stop, ship flow, and the Files viewer tree. This is the default.
- `extended`: slower agent regression files for thread session lifecycle,
  pending interactions, threads, scripts, Git history, providers, remote
  projection, and the agent app workspace and close races.
- `full`: TypeScript check, the full Vitest suite, targeted Rust backend tests
  (agent turn changes and logs, agent history, terminal sessions, Git
  worktrees), and the production build.
- `desktop`: debug Tauri build, a short desktop boot, and a check that no
  debug app process remains afterwards.

Each step has a timeout, and the runner terminates the step's whole process tree
on timeout, failure, or Ctrl+C. The profiles are defined in
`scripts/qa-smoke.mjs` and checked by `scripts/qa-smoke.test.mjs`.

The smoke modes are iteration tools. Before calling a slice complete, run the
full gate list in `CLAUDE.md`.

## Desktop debug launch

```sh
npm run debug         # build and launch the desktop app in debug mode
npm run debug:smoke   # build, boot for a few seconds, then verify cleanup
```

`scripts/debug-tauri.mjs` stops a previous debug app and its child processes
before starting, cleans an oversized Rust target directory, and cleans up the
app's process tree on exit. `debug:smoke` refuses to run while a matching debug
app is already running; set `CODEVO_EDITOR_SMOKE_CLEAN_EXISTING=1` to let it stop
that app first. `CODEVO_EDITOR_SMOKE_RUN_MS` and
`CODEVO_EDITOR_SMOKE_CLEANUP_GRACE_MS` tune the boot and cleanup windows.

## Manual desktop pass

Run this against a real project after changes that touch the agent workflow:

1. Open a project, trust it, and add a second project.
2. Start a Claude Code or Codex thread in the local checkout; follow the
   streaming transcript and answer an approval or question.
3. Start a thread in an isolated worktree and send a follow-up.
4. Switch projects and threads while a turn is running (A -> B -> A) and check
   that no output, diff, or terminal leaks between them.
5. Open each right-panel surface: terminal, Files (read-only viewer), diff,
   Git, scripts, pull request, history, and agents.
6. Commit and push thread changes, then integrate and remove the worktree.
7. Stop a running turn, revoke trust on a project with a running agent, and
   close a project tab with live work.
8. Check **Settings**: providers, MCP servers, and keymap.
9. If a runner is configured, run a remote thread and open the remote Files
   viewer, diff, and terminal.
10. Restart the app and confirm threads, projects, and layout restore.
