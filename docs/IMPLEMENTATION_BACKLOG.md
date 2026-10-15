# Implementation Backlog

Date: 2026-10-15

Status: Active agent-app backlog

Codevo is an agent app. The code editor (Monaco), LSP, Problems, test explorer,
coverage, eslint/prettier integration, PHP/JavaScript language intelligence, and the
classic workbench were removed by owner decision in Phase 2. The former editor,
JS/TS/Node/Express, and PHP/framework backlogs are historical; see
`docs/archive/PROGRESS.md` and `docs/ARCHITECTURE_REVIEWS.md` for that record. Do not
reintroduce removed IDE features unless the user explicitly asks.

## P0 - Integration And Truth

- Finish the IDE removal without weakening exact workspace, thread, and session
  ownership.
- Run the complete frontend and Rust gate matrix from `CLAUDE.md`.
- Run representative desktop QA for thread start and follow-up, worktree isolation,
  right-panel surfaces, shipping, remote runner, settings, and the updater.
- Record final gate counts only after one clean integrated run.
- Keep documentation aligned with observable behavior and explicit limits.

## P1 - Agent Responsiveness

- Measure startup paint, thread switch, transcript streaming, transcript scrolling,
  Files viewer, and diff latency on representative small, large, and monorepo projects.
- Reduce composition-root rerenders and repeated cloning on agent events.
- Keep transcripts, viewer files, diffs, and terminal output windowed and bounded with
  deterministic eviction.
- Add regression evidence for cancellation storms, fast streaming, A->B->A workspace
  switching, and large result sets.

## P1 - Agent Workflows

- Harden thread lifecycle: approvals, questions, steering, checkpoints, background
  turns, and notifications.
- Improve review and shipping: diff, commit, push, pull request, and worktree
  integration.
- Keep package scripts, Git, history, and terminal surfaces scoped to the exact
  project or thread checkout.
- Maintain strict no-shell, trusted-workspace, retained-root execution boundaries.

## P1 - Remote Runner

- Keep remote Files read-only, with bounded listing and viewing.
- Harden runner streaming handoff, reconnect, and remote Git sync.

## P2 - Platform Gaps

- Windows native watch and Windows file/reparse identity need separate hardening.
- Remote/container runtimes and an extension platform require independent product and
  security designs.
- macOS signing/notarization and packaged smoke remain release work.

## Quality Gates

Before finishing a slice:

- run TypeScript check, ESLint, build, Vitest, hotspot and formatting gates;
- run Cargo check, library/integration tests, Rustfmt, and zero-warning Clippy;
- run relevant desktop/browser QA;
- use a separate read-only subagent for adversarial review;
- run `git diff --check`;
- report focused evidence separately from full integrated evidence.
