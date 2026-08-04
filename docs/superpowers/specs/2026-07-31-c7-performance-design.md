# C7 Performance Design

Date: 2026-07-31

Status: Approved design, pending implementation plan

## Goal

Make everyday JS/TS editing in Codevo feel light, immediate, and snappy like VS Code
on large TypeScript files and large monorepos. C7 is measurement-driven: nothing is
optimized without a measured gap, and completion is judged against a VS Code baseline
captured on identical fixtures.

## Priorities (user-defined)

1. Profiling of typing and tab switching in large TS files.
2. Quick Open and symbols in large monorepos.
3. Retention of Monaco models, providers, and LSP documents - removal of unnecessary
   renders and work.
4. Real latencies of completion, Go to Definition, References, rename, and Problems.
5. Memory stability during long usage and project switching.
6. Closing concrete JS/TS gaps found by measurement.

## Out of scope

- Debugger, Debug Console, multi-process debugging.
- Nette/PHP feature expansion.
- New features except those required to close a measured JS/TS gap.
- Any weakening of workspace ownership, boundedness, or fail-closed rules. Speed is
  never bought with isolation or correctness.

## Acceptance criterion

Comparison against VS Code (stock install, built-in TypeScript) measured on the same
fixtures with the same scenarios:

- Interactive operations (typing, tab switch, Quick Open first results, completion,
  Go to Definition): p95 <= 1.25x VS Code p95.
- Heavier operations (References, rename, Problems publish):
  p95 <= 1.5x VS Code p95.
- Where VS Code cannot be measured scriptably (raw keystroke-to-render), Codevo is
  measured absolutely with a target of < 16 ms p95 per frame commit.
- Memory: after warmup, no monotonic growth trend across repeated project-switch
  cycles; retained entity counts return to baseline after each cycle.

## Slice C7.1 - Measurement foundation

Five components; all three build streams (fixtures, instrumentation, VS Code
baseline) are independent and can run in parallel.

### 1. Fixture generator

- `scripts/perf/generate-fixtures.mjs`, deterministic (seeded), output to
  `perf/fixtures/` (gitignored, generated on demand).
- Large TS files: 5k / 20k / 100k lines with realistic patterns (imports,
  interfaces, union types, barrel exports).
- Monorepo: ~50 packages, ~10k files, tsconfig project references, cross-package
  imports.
- Adversarial cases: minified single-line file, huge union types.
- One real public monorepo (cloned locally, never committed) is used for manual
  feel validation in addition to the synthetic fixtures.

### 2. In-app perf instrumentation

- Thin perf port in the application layer; `performance.mark/measure` around:
  keystroke -> render commit, tab switch -> editor visible, Quick Open -> first
  results, LSP request -> response (completion, definition, references, rename,
  Problems publish), project switch.
- Bounded ring buffer; export via a dev-only command to JSON.
- Enabled by env var in debug builds; zero overhead in release.

### 3. Scenario runner

- Reuses the existing QA bridge (`debug:qa` / `VITE_CODEVO_QA_BRIDGE`).
- Opens a fixture workspace, simulates typing bursts in large files, tab cycling,
  Quick Open queries, and LSP operations; collects marks into `perf/results/*.json`
  (untracked).

### 4. VS Code baseline

- Small extension + runner in `tools/vscode-baseline/`; opens the same fixtures in
  stock VS Code and runs the same operations via the VS Code API, writing latencies
  to JSON.
- Run manually; measured numbers are committed as `perf/baselines/vscode.json`
  (small file) so gates can compare against them repeatedly.

### 5. Gap report

- Script merges Codevo results vs the VS Code baseline into a p50/p95 + ratio table
  per C7 priority.
- The first gap report decides the ordering of the optimization slices.

## Slices C7.2 - C7.6 - Optimization

Ordering follows the user priorities; the gap report may reorder it, and any
reordering is reported explicitly before work starts.

- **C7.2 Typing and tab switching in large TS files.** Composition-root rerenders on
  keystroke/cursor, cloning of large state, tokenization and decorations on tab
  switch.
- **C7.3 Quick Open and symbols in large monorepos.** Ranking, first-results
  latency, `@`/`#` symbols across ~50 packages, index caching.
- **C7.4 Retention of Monaco models, providers, LSP documents.** Deterministic
  eviction, no dangling providers/subscriptions, removal of measured unnecessary
  work (extra renders, repeated projections).
- **C7.5 Latencies of completion, Go to Definition, References, rename, Problems.**
  Round-trips to the TS server, debounce/cancellation, result projections.
- **C7.6 Memory stability.** Long runs and project switching (methodology below).

Every slice has the same shape: hypothesis from measurement -> fix -> re-measure
against the VS Code baseline -> regression guard where deterministic (e.g.
renders-per-keystroke counter tests, retained model/provider counts after close,
vitest bench for pure hot functions). Implementation is delegated to subagents per
project rules (file ownership, read-only adversarial review, full gates before a
slice closes).

## C7.6 Memory stability methodology

- Scripted long run via the QA bridge: 30 cycles of project switches A -> B -> A,
  opening/closing ~100 tabs, repeated searches and LSP operations.
- After each cycle record JS heap + Tauri process RSS and retained entity counts
  (models, providers, LSP documents, watchers).
- Criterion: after warmup, no monotonic growth trend; retained entity counts return
  to baseline after each cycle.
- Concrete leaks are triaged with heap snapshots.

## Gates and evidence

- All existing repository gates remain (TS check, ESLint, build, Vitest, hotspot,
  format, Cargo matrix).
- New: a short perf smoke scenario runnable locally (verifies instrumentation and
  runner work); deterministic regression guards from slices run inside normal
  `npm test`.
- The full perf run (all scenarios + gap report) is a manual step when closing each
  slice, not CI.
- Summary tables (Codevo vs VS Code, before/after per slice) go to
  `docs/PERFORMANCE.md`; raw JSON results and fixtures stay untracked.
- No invented percentages - only measured numbers with date and fixture version.
