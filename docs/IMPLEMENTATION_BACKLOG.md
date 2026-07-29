# Implementation Backlog

Date: 2026-07-28

Status: Active JS/TS/Node/Express backlog

The former Fleet/PHP phase list is historical. PHP and framework features remain in the
product, but this backlog orders work by the current JavaScript, TypeScript, Node.js,
and Express direction.

## Current Integration Wave

| Area                             | Status                       | Acceptance                                                                                                                                                                                       |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quick Open syntax and handoff    | Integrated; full gates green | File search supports `>`, `@`, `#`, exact pasted/IME seed handoff, typed-prefix continuation, `path:line[:column]`, ordinary reopen reset, accessible guidance, and truthful backend truncation. |
| Docked workspace search          | Integrated; full gates green | Search lives in the bottom panel, preserves the prior panel, combines native disk results with exact-owner dirty overlays, and exposes limitations instead of approximate data.                  |
| Dirty-buffer search worker       | Integrated; full gates green | Latest request cancels the previous worker; request, clone, time, result, preview, and response budgets are validated on both sides of the worker boundary.                                      |
| Open-editor MRU                  | Integrated; full gates green | `Ctrl+Tab`/reverse traversal is scoped to the exact project and editor group, restores focus, handles tab mutation, and bounds retained scopes.                                                  |
| Navigation session persistence   | Integrated; full gates green | Editor groups, open resources, view state, and navigation state persist only after restore ownership is established; stale workspace failures cannot publish into another root.                  |
| Transient Monaco model lifecycle | Integrated; full gates green | Closed models are disposed when they are no longer open or navigation-owned; active and still-retained models survive, and replacement reveal waits for the live model.                          |
| Workspace package graph          | Integrated; full gates green | Bounded package/workspace globs and package ownership support monorepo scripts, tests, routes, and Problems without guessing through overflow.                                                   |
| Exact cancellable JS/TS LSP      | Integrated; full gates green | Requests and document notifications carry exact session authority; superseded work cancels or fails stale, and workspace watcher resync targets only the accepted session.                       |
| Bounded Rust file/text search    | Integrated; full gates green | Directory visits, file bytes, result count, response previews, cancellation, and truncation are explicit; blocking traversal stays off the UI runtime.                                           |
| Editor change-hunk worker        | Integrated; full gates green | Diff computation is latest-owner-wins, cancellable, timed, and degrades visibly for over-budget files.                                                                                           |
| Watcher overflow and resync      | Integrated; full gates green | Batches are bounded; queue/batch loss triggers exact-session project resync or a truthful rescan, never partial concrete replay.                                                                 |

The lead's integrated frontend and Rust gate run is green; the exact receipt is
recorded in `docs/PROGRESS.md` and `docs/IDE_PARITY.md`.

## P0 — Integration And Truth

- Resolve any integration failures without weakening exact workspace/session ownership.
- Run the complete frontend and Rust gate matrix from `CLAUDE.md`.
- Run representative desktop QA for Quick Open handoff, docked search, MRU switching,
  session restore, stale workspace transitions, and large-file degradation.
- Record final gate counts only after one clean integrated run.
- Keep documentation aligned with observable behavior and explicit limits.

## P1 — Editing Responsiveness

- Measure keystroke-to-render, tab switch, Quick Open, symbol navigation, and search
  latency on representative small, large, and monorepo fixtures.
- Reduce composition-root rerenders and repeated cloning on cursor/content changes.
- Continue extracting coherent ownership from `App.tsx`,
  `useWorkbenchController.ts`, and Rust composition hotspots without raising baselines.
- Audit Monaco model retention, token warming, decorations, diagnostics, and provider
  registration for deterministic eviction.
- Add regression evidence for cancellation storms, rapid typing, A→B→A workspace
  switching, and large result sets.

## P1 — JavaScript/TypeScript Editing

- Close capability-gated gaps in completion, auto-imports, hover, definitions,
  declarations, type definitions, implementations, references, rename, code actions,
  formatting, selection formatting, symbols, and hierarchies.
- Preserve fail-closed enablement when the exact JS/TS runtime is not running or does
  not advertise a feature.
- Improve TSConfig/project-reference and monorepo package ownership handling.
- Keep large-file LSP retirement and fresh re-entry exact and reversible.
- Verify light/dark semantic-token and diagnostic rendering without main-thread stalls.

## P1 — Navigation And Search

- Improve Quick Open ranking and large-workspace latency while retaining visit/result
  caps and explicit truncation.
- Add a shared, safe dirty-buffer matcher before enabling regex, `wholeWord`, or file
  masks for unsaved documents. Until then those modes remain explicitly unsupported
  for the dirty overlay.
- Profile the worker structured-clone cost at the current hard caps: 16 documents,
  4,096 dirty paths, 256 Ki code units per document, 1 Mi aggregate code units,
  768 KiB UTF-8 per document, 3 MiB aggregate UTF-8, 500 results, and 2 MiB response.
- Preserve navigation history and model disposal across preview tabs, split groups,
  renames, deletes, and workspace restoration.
- Keep search result rendering paginated/windowed and keyboard accessible.

## P1 — Node And Express Project Work

- Harden package ownership for nested workspaces and incomplete/truncated graphs.
- Improve package scripts, tasks, Jest/Vitest discovery/results/coverage, and Problems
  attribution using the same package graph authority.
- Expand static Express route intelligence only where source ownership and bounded
  parsing can be proven; dynamic runtime paths remain explicit omissions.
- Maintain strict no-shell, trusted-workspace, retained-root execution boundaries.

## P2 — Platform Gaps

- Child/multi-process Node debugging and universal DAP remain unsupported until exact
  multi-target ownership is production-wired and accepted.
- Windows native watch and Windows file/reparse identity need separate hardening.
- Remote/container runtimes and an extension platform require independent product and
  security designs.
- macOS signing/notarization and packaged smoke remain release work.

## Secondary PHP And Framework Track

Maintain existing PHPactor/Intelephense, Composer/PSR-4, PHPStan, Pint, PHPUnit/Pest,
Laravel, Nette, Blade, Latte, and NEON capabilities. New PHP/Nette parity work resumes
only when the user explicitly changes the priority. Completing a JS/TS milestone never
changes the product priority automatically.

## Quality Gates

Before finishing a slice:

- run TypeScript check, ESLint, build, Vitest, hotspot and formatting gates;
- run Cargo check, library/integration tests, Rustfmt, and zero-warning Clippy;
- run relevant desktop/browser QA;
- use a separate read-only subagent for adversarial review;
- run `git diff --check`;
- report focused evidence separately from full integrated evidence.
