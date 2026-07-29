# Feature implementation notes

This file documents how selected app features are implemented and how to use them in code.

## Toast notifications

The editor uses a shared notice/toast pipeline.

### Files

- `src/application/workbenchNotice.ts`
  - `WorkbenchNotice` model and factory helpers.
- `src/application/useWorkbenchController.ts`
  - Maintains toast/notices state.
- `src/application/useNoticeToastRenderers.tsx`
  - Maps notice payloads to toast UI renderers.
- `src/components/NoticeToastHost.tsx`
  - Displays toasts and tracks dismissals.
- `src/components/ToastNotification.tsx`
  - Reusable toast UI component with template types and action handlers.
- `src/components/ManagedPhpactorSetupNotice.tsx`
  - Concrete notice implementation for missing PHPactor setup.
- `src/App.tsx`
  - Shell wiring; mounts `NoticeToastHost` and connects workbench state.
- `src/App.css`
  - Toast styling, variants, and animations.

### How to add/update a toast in code

1. Create a notice payload in your feature logic.
2. Choose a notice identity strategy:
   - Include `groupKey` for replaceable/grouped notices.
   - Omit `groupKey` for one-off one-time notices.
3. Push/replace notices in `useWorkbenchController`.
4. Add or update a renderer in `useNoticeToastRenderers.tsx` for the notice payload.

### How to use grouped notices

- Use a stable key such as `feature-name:<scope>` for lifecycle-aware replacement.
- Dismissing a grouped notice is tracked by `group:` + group key.
- If source state still requires that grouped notice, it can be reintroduced.

## Adding feature notes

For new feature work, append a section in this file with:

- A short behavior description
- Affected files
- Integration points in state and commands/events
- Any side effects and error handling

Use the same pattern for other features that need contributor-facing implementation guidance.

## Quick Open routing and seed ownership

Quick Open parses one closed query model before it searches or routes:

- ordinary text searches files;
- `>` opens Commands;
- `@` opens symbols in the current file;
- `#` opens workspace symbols;
- `path:line[:column]` opens an exact file location;
- `:line[:column]` offers a confirmable current-file location.

Paste and completed IME composition forward the exact parsed text after the prefix.
Typing only a prefix transfers focus with an empty seed so subsequent characters are
entered in the destination picker. Command Palette and File Structure consume their
seed only on a closed-to-open transition; ordinary opening supplies an empty seed.
Workspace Symbols clears its controlled query when closed. This prevents stale
one-shot state from leaking through A→B→A surface transitions.

Backend truncation is a separate field and is never inferred from a full frontend page.
The visible syntax hint has an explicit accessible label.

### Main files

- `src/domain/quickOpenQuery.ts`
- `src/application/useWorkbenchQuickOpen.ts`
- `src/application/useQuickOpenPrefixDispatch.ts`
- `src/components/QuickOpen.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/FileStructure.tsx`

## Docked text search and dirty overlays

Workspace search is a bottom-panel view. Opening it remembers the previous panel per
workspace; closing it restores that view and visibility. Native Rust search remains
authoritative for disk content. A browser worker computes a latest-wins overlay for
unsaved documents, and application ownership merges or replaces results only for the
exact dirty snapshot and workspace generation.

Dirty-buffer semantics are intentionally narrower than native disk search:

- literal case-sensitive and case-insensitive matching is supported;
- regex and `wholeWord` are unsupported because JavaScript `RegExp` does not share the
  native Rust regex language, linear-time guarantee, or Unicode word boundaries;
- non-empty file masks are unsupported because ignore/mask policy belongs to native
  search;
- an unsupported mode returns no approximate dirty rows and adds an explicit
  limitation/truncated reason.

The worker clone boundary is hard-capped at 16 documents, 4,096 dirty paths, 256 Ki
UTF-16 code units per document, 1 Mi aggregate code units, 768 KiB UTF-8 per document,
3 MiB aggregate UTF-8, 500 results, 4,096 code points per preview, and a 2 MiB response.
The default deadline is one second. A superseding request or abort terminates the old
worker.

### Main files

- `src/application/useDockedTextSearch.ts`
- `src/application/dirtyTextSearchComputation.ts`
- `src/application/dirtyTextSearchMatcher.ts`
- `src/infrastructure/browserDirtyTextSearchGateway.ts`
- `src/infrastructure/dirtyTextSearch.worker.ts`
- `src-tauri/src/workspace_file_commands/workspace_file_search.rs`

## Editor MRU, navigation persistence, and model retention

Open-editor MRU order is scoped by project and editor group. It reconciles tab changes,
commits on Control release, restores focus, and retains at most 64 inactive scope
orders.

Navigation persistence snapshots editor groups, documents, view state, sidebar, and
bottom-panel state only after session restore is authoritative. Scheduled saves are
flushed before workspace departure, and errors are published only for the still-active
root.

Monaco model lifetime follows navigation ownership rather than retaining every model
ever opened. The active model, open document models, and models still required by
navigation history survive. A model that belongs to none of those owners is disposed;
navigation waits for a live replacement model before revealing a restored location.

### Main files

- `src/application/useOpenEditorsMru.ts`
- `src/application/useWorkbenchNavigationSessionPersistence.ts`
- `src/components/EditorSurface.tsx`
- `src/components/editorRuntimeModels.ts`

## Workspace package graph

The package graph is a pure bounded model used by monorepo-aware scripts, tests,
Express routes, and Problems attribution. It accepts at most 128 workspace glob
patterns, 256 glob expansions, 256 package manifests, 2,000 source paths, and eight
specifier segments. Over-budget or malformed authority is explicit and consumers must
not invent a nearest package from an incomplete graph.

### Main files

- `src/domain/workspacePackageGraph.ts`
- `src/domain/workspacePackageForPath.ts`
- `src/application/useWorkbenchWorkspacePackageGraph.ts`
- `src/application/useWorkspacePackageGraph.ts`

## Exact cancellable JS/TS LSP and watcher resync

JavaScript/TypeScript LSP requests and document notifications are bound to the exact
workspace root and accepted language-server session. Superseded requests cancel;
late, foreign, and replacement-session responses fail stale. The latest-value document
mailbox coalesces edits without allowing a dropped A→B→A owner to publish.

Watch delivery is bounded. Batch or queue overflow does not replay a partial set of
concrete file events. It requests project resynchronization for the exact accepted LSP
session; if that session cannot accept resync, the frontend receives a truthful rescan
signal. Retry and replacement retain generation ownership.

## Background editor change hunks

Change-hunk calculation runs in a reusable browser worker instead of blocking the UI
thread. A newer active-editor request aborts and terminates older computation.
Responses must match owner, path, and generation. Files over the configured large-file
policy return an explicit degraded result with no hunks, and worker failure or timeout
is surfaced as unavailable.

### Main files

- `src/application/editorChangeHunksComputation.ts`
- `src/application/useOwnedEditorChangeHunks.ts`
- `src/infrastructure/browserEditorChangeHunksGateway.ts`
- `src/infrastructure/editorChangeHunks.worker.ts`

## JavaScript coverage viewport projection

JavaScript coverage reports are indexed once by immutable report identity. The active-editor application policy selects an exact workspace-owned, clean file; the Monaco adapter then binary-searches its already sorted line records for the visible viewport.

### Files

- `src/domain/jsTestCoverageDecorations.ts`
  - Immutable report/path lookup facade and editor-neutral line projection.
- `src/application/jsTestCoverageDecorationSelection.ts`
  - Workspace, report, file and dirty-document authority checks.
- `src/components/jsTestCoverageDecorationWindow.ts`
  - Bounded visible-range normalization, binary-search selection and decoration/inline-label caps.
- `src/components/useJsTestCoverageEditorDecorations.ts`
  - Exact model subscription, refresh and cleanup ownership.

The adapter returns at most 256 decorations and 128 inline hit-count labels. It reads at most 64 Monaco visible ranges per pass and marks retained decorations when additional ranges were omitted. Do not restore a full-file clone, sort or decoration map before viewport selection.

## JavaScript/TypeScript LSP change mailbox

Document changes use a latest-value mailbox keyed by the exact workspace root and LSP session. Only the current entry may drain or publish an error; drop, clear, re-entry and replacement revoke older work. Every document notification also carries `expectedSessionId` through the gateway so the Rust session rejects stale writes.

## Bounded stopped stacks and variable pages

Stopped events retain at most 256 strictly validated frames with unique IDs. `framesTruncated` is preserved to the windowed Call Stack so a bounded prefix or an empty inspectable result is never presented as complete.

Variable-page requests settle malformed current responses into a retryable error and release all request admission. Reducer ownership prevents stale, reordered and A→B→A settlement from clearing a newer flight.

## Current private debugger foundations

The child-target multiplexer routes private stack, variables and resume operations with exact target authority so endpoint reuse cannot address or disconnect a replacement target. It is deliberately unwired and disabled; contributors must not expose it as child or multi-process debugging until production composition and lifecycle acceptance are separately complete.

The dynamic source-map registry foundation prepares maps asynchronously without filesystem work under the shared debugger lock. Exact `scriptId`, transport and registration generation fence pending work, commits and lookup receipts. One worker has a 32-job queue; the registry fails closed above 64 pending maps, 256 committed maps, 250,000 tokens per map, 1,000,000 tokens per session, 256 retained source-file authorities per map or 512 per session. Independent review and the focused/full Rust gates are clean. This foundation does not include `smartStep`, late breakpoint reconciliation or full source-map parity.
