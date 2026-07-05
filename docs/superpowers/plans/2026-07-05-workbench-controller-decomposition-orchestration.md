# Workbench Controller Decomposition Orchestration

Date: 2026-07-05
Status: active checkpoint

## Goal

Continue the Workbench controller decomposition without looping after context
compaction. The main Codex thread acts as the orchestrator: it creates and
monitors Codex threads, integrates finished work, runs tests, and chooses the
next slice. Implementation should happen in separate Codex threads whenever the
slice can be isolated by file ownership.

Current operational goal:

- Continue only through Codex worker threads where possible.
- Main thread owns orchestration, monitoring, integration, tests, commits, and
  pushes.
- Do not manually implement a delegable slice in the main thread.
- Poll worker threads proactively through `read_thread` plus direct worktree
  `git status` / `git diff --stat` checks.
- Current next order:
  1. finish the remaining non-text search surfaces only after respecting the
     already extracted `useWorkbenchQuickOpen` and `useWorkbenchTextSearch`
     boundaries,
  2. monitor workers proactively through `read_thread` and direct worktree
     checks instead of waiting for the user,
  3. integrate only reviewed, non-overlapping worker patches,
  4. verify with focused tests, full preview tests, and full suite when the
     surface is user-facing,
  5. commit, push, and update this checkpoint after each shipped slice.
- Note: the Codex goal tool is blocked by an old paused goal in this thread.
  Treat this checkpoint as the active operational goal until that goal can be
  safely completed or replaced.

Current baseline from main:

- `src/application/useWorkbenchController.ts`: 22,141 lines after the
  workspace-edit, LSP runtime lifecycle, document tab, navigation,
  close-lifecycle, PHP code-action, file-operations, text-search, and
  Quick Open slices.
- Recent decomposition already extracted hooks for Git, TODOs/bookmarks/history,
  Latte/Neon/Blade intelligence, Laravel targets, engine terminal/navigation,
  PHP outline, floating surfaces, document sync, diagnostics, save/close
  lifecycle, and shared notice rendering.
- Remaining high-return regions:
  - Remaining non-text search surfaces: Open Class, workspace symbols, and
    Search Everywhere. Do not re-extract Quick Open or text search.
  - Generic LSP navigation panels.
  - Type inference/completions/hierarchy checks.

## Orchestration Rules

- Prefer Codex threads for implementation, not subagents, when the user asks for
  threads.
- The main thread must not duplicate thread work. It should do only:
  - small orientation,
  - thread creation,
  - thread monitoring,
  - integration/review,
  - test execution,
  - final commit/push when requested or when a completed slice should be saved.
- Each Codex thread must get a narrow ownership boundary and should avoid
  reverting unrelated work.
- If a slice is too coupled, the thread should return a precise extraction plan
  instead of forcing a risky patch.
- After compaction, continue from this file before starting any new work.

## Active Thread Plan

Create Codex threads for:

1. Workspace-edit file operations
   - Ownership: workspace edit application/reconciliation around
     `useWorkbenchController.ts` currently near `applyWorkspaceEditToOpenDocuments`,
     `applyJavaScriptTypeScriptLanguageServerWorkspaceEdit`,
     `applyPhpLanguageServerWorkspaceEdit`, rename/create/delete file hooks.
   - Desired output: focused hook/module extraction or a precise plan if too
     coupled.
   - Required tests: targeted workspace edit/controller tests and `npm run check`.
   - Thread: `019f2f75-2b29-7c63-bd14-6006560987ab`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkspaceEditFileOperations.ts`;
     controller line count is now 27,770 in the main working tree.

2. LSP runtime lifecycle mapping
   - Ownership: read-only or minimal patch only if low-risk.
   - Desired output: next slice proposal after workspace-edit ops, with test list
     and shared PHP/JS runtime boundaries.
   - Thread: `019f2f80-6f62-74f2-923b-abdb86958e63`
   - Status: completed.
   - Result: next worker slice should extract
     `useLanguageServerRuntimeLifecycle` from runtime planning/status/start-stop
     orchestration in `useWorkbenchController.ts`.

3. Controller responsibility audit
   - Ownership: read-only.
   - Desired output: updated decomposition scorecard: line count, remaining
     clusters, recommended ordering, risk notes.
   - Thread: `019f2f80-9c2a-7d73-906f-b267ffafdef4`
   - Status: completed.
   - Result: recommended order is LSP runtime lifecycle, document/workspace tab
     operations, then PHP code-action provider domain extraction.

4. LSP runtime lifecycle extraction
   - Ownership: runtime planning/probe refresh, runtime status caches/session
     guards, start/stop/restart/dispose flows, autostart, and status
     subscriptions.
   - Thread: `019f2f83-cb4d-7892-876c-e5da10add6c9`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useLanguageServerRuntimeLifecycle.ts`;
     controller line count is now 26,512 in the main working tree.

5. Document/workspace tab and open-file extraction
   - Ownership: regular document activation, preview/open/open-pinned flows,
     pinning, read-only document tabs, hover prefetch, and preview replacement
     safety logic.
   - Thread: `019f2f92-b069-7d83-9690-19ca28de5cf5`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchDocumentTabs.ts`;
     controller line count is now 25,905 in the main working tree.

6. Navigation/history extraction
   - Ownership: generic non-LSP navigation operations, quick-open/search
     result activation, recent-file activation/pruning, class/workspace symbol
     result activation, problem navigation jumps, navigation target opening,
     and navigation-aware file reads.
   - Thread: `019f3238-8944-77b3-9ddd-f447eafdfe7f`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchNavigation.ts`;
     controller line count is now 25,649 in the main working tree.

7. Close/save lifecycle extraction
   - Ownership: workspace-tab close flow, cached dirty workspace prompts,
     active/inactive workspace close cleanup, runtime/document sync teardown,
     and application quit command.
   - Thread: `019f3243-0c96-70c1-9ab0-f09770c1c7f6`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchCloseLifecycle.ts`;
     controller line count is now 25,518 in the main working tree.

8. PHP code-action extraction
   - Ownership: PHP code-action provider orchestration, create-class/create-view
     quick fixes, ordering/grouping, generate members, create-from-usage,
     implement/override methods, import/edit helpers, and related pure action
     builders.
   - Thread: `019f324a-9ba1-7b00-894e-318e30d9edf8`
   - Status: completed and integrated into main working tree.
  - Result: extracted `src/application/usePhpCodeActions.ts`; controller line
     count is now 23,199 in the main working tree.

9. Fresh post-extraction controller audit
   - Ownership: read-only.
   - Thread: `019f3342-7496-7960-a1ad-4acf781b2f91`
   - Status: completed.
   - Result: current controller line count is 23,199. Recommended next slices:
     `useWorkbenchFileOperations`, then `useWorkbenchSearchSurfaces`, then
     generic LSP navigation panels. Do not extract workspace open/session reset
     or the whole PHP semantic region yet because both are still too coupled.

10. File operations and external file events
   - Ownership: create/rename/delete file and folder flows, external file event
     handling, directory refresh queues, and reconciliation with extracted
     workspace-edit file operation helpers.
   - Desired output: `src/application/useWorkbenchFileOperations.ts` or a
     precise extraction plan if the worker finds hidden coupling.
   - Required invariants: preserve JS/TS `will/didRenameFiles`, PHP rename
     hooks, preview path remaps, stale-root guards after awaits, git diff
     pseudo-document separation, and dirty external-change safety.
   - Thread: `019f3348-ba1d-7762-94ff-3cd005080957`
   - Retry thread: `019f334c-3554-7740-a6b0-f2c21e041ff8` was started while
     the first worker appeared stalled; it was stopped after the first worker's
     clean diff was integrated.
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchFileOperations.ts`;
     controller line count is now 22,485 in the main working tree.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "rename|delete|create|external file|workspace edit|stale"` passed:
       223 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.
   - Next recommended worker slice from audit:
     `useWorkbenchSearchSurfaces` for Quick Open, Open Class, workspace symbols,
     Search Everywhere, text search, and replace-in-path state/effects.

11. Text search and replace-in-path
   - Ownership: text search state/effect, opening text search results,
     replace-in-path confirmation/run flow, dirty-open-document refresh after
     replace, stale-root guards, and reset helpers.
   - Thread: `019f3356-9345-73d0-a51f-a1545e59d6ca`
   - Broader abandoned thread: `019f3352-f42a-7282-bf6a-9500ce2d6eb3` started a
     wider search-surfaces extraction, but it duplicated ownership and was
     stopped in favor of this narrower slice.
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchTextSearch.ts`; controller
     line count is now 22,146 in the main working tree.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "Text Search|Replace|stale.*search|inactive project"` passed: 19 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.
   - Remaining search-surface follow-up: Quick Open, Open Class/workspace
     symbols, and Search Everywhere should be extracted separately rather than
     grouped with text search.

12. Quick Open
   - Ownership: Quick Open open/query/loading/results state, reset-on-open/close
     behavior, debounced file search, latency measurement, error reporting, and
     stale result dropping.
   - Thread: `019f3360-c207-7800-aa43-b3b7965f21a2`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchQuickOpen.ts`; controller
     line count is now 22,141 in the main working tree.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "Quick Open|stale.*search|inactive project"` passed: 24 tests.

13. Open Class and shared project-symbol search
   - Ownership: Open Class open/query/loading/results state, Open Class
     debounced search effect, `canSearchClassOpenSymbols`, shared
     `searchClassOpenSymbols`, workspace-symbol LSP conversion/de-dupe helpers,
     and PHP/JS runtime session guards required by that search.
   - Thread: `019f336a-3889-71f0-aedf-4ab3eaff63f7`
   - Broader overlapping thread: `019f3367-b236-7191-bade-1c81ee60e1c1`
     attempted Open Class + workspace symbols + Search Everywhere together. Do
     not integrate that work unless it is rebased after this slice and proves it
     has no duplicate controller ownership.
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchClassOpen.ts`; controller
     line count is now 21,876 in the main working tree.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "Open Class|workspace symbol|Search Everywhere|stale.*search|inactive project"`
       passed: 38 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.

14. Workspace Symbols
   - Ownership: Workspace Symbols open/query/loading/results state and the
     debounced effect that consumes `searchClassOpenSymbols`.
   - Thread: `019f3373-4f5e-7a81-9d6f-ce4b30b818aa`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchWorkspaceSymbols.ts`;
     controller line count is now 21,833 in the main working tree.
   - Strict boundary: do not move Quick Open, text search, Open Class,
     Search Everywhere, command registry, or navigation activation.
   - Main-thread verification after integration:
     - `npm run check`
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "workspace symbol|stale.*search|inactive project"` passed: 34 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.

15. Search Everywhere
   - Ownership: Search Everywhere open/query/loading raw file/symbol state,
     debounced combined search effect, and pure model composition if it can move
     without owning command registry.
   - Thread: `019f3373-9b8d-7222-ab47-eeae1f001034`
   - Status: active worker thread.
   - Strict boundary: do not move Quick Open, text search, Open Class,
     Workspace Symbols, command registry, or navigation activation.
   - Required verification before integration:
     - `npm run check`
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "Search Everywhere|stale.*search|inactive project"`
     - Full preview test if the diff is broad.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.
     - `npm test -- --run` passed: 230 files, 5117 tests.
   - Remaining search-surface follow-up: Open Class, workspace symbols, and
     Search Everywhere only. Existing broad worker `019f335e-47b0-73a2-a931-5ebf7e41fbbb`
     started before this integration, so review carefully for duplicated Quick
     Open ownership before applying any of its work.

## Current Local Findings

- Workspace edit region was extracted on 2026-07-05 into
  `src/application/useWorkspaceEditFileOperations.ts`.
- It includes:
  - open-document application with version guards,
  - per-root filtering,
  - JS/TS and PHP file-operation reconciliation,
  - directory refresh after file operations,
  - JS/TS and PHP `willRenameFiles`,
  - JS/TS create/delete notifications and watched-file fallback,
  - PHP rename notifications.
- Important invariant: preserve per-project/session guards and open-document
  version checks.
- Main-thread verification after integration:
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
    "workspace edit|willRenameFiles|didRenameFiles|willCreateFiles|didCreateFiles|willDeleteFiles|didDeleteFiles|watched files|rename edits|create edits|delete edits"`
    passed: 22 tests.
  - `npm run check` passed.
- Document/workspace tab region was extracted on 2026-07-05 into
  `src/application/useWorkbenchDocumentTabs.ts`.
- It includes:
  - document activation,
  - preview/open/open-pinned flows,
  - read-only document tab opening,
  - hover prefetch and cancel prefetch,
  - preview-tab replacement safety logic.
- Important invariant: git diff loading stays controller-owned to preserve
  git diff/editor tab separation.
- Main-thread verification after integration:
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
- PHP code-action region was extracted on 2026-07-05 into
  `src/application/usePhpCodeActions.ts`.
- It includes:
  - PHP code-action provider orchestration,
  - create-class and create-view quick fixes,
  - action ordering and visual grouping,
  - generate members/accessors/constructors,
  - create-from-usage actions,
  - implement/override methods,
  - import/edit helper construction.
- Important invariant: cross-file collectors and navigation-owned flows remain
  controller-owned; PHP action hook exposes only the shared hierarchy helpers
  needed by those callers.
- Main-thread verification after integration:
  - `npm run check` passed.
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
- Close/save lifecycle region was extracted on 2026-07-05 into
  `src/application/useWorkbenchCloseLifecycle.ts`.
- It includes:
  - workspace-tab close flow,
  - dirty cached workspace prompts,
  - active/inactive workspace close cleanup,
  - language-server document sync teardown,
  - project runtime stop/forget logic,
  - application quit command.
- Important invariant: document-level close/save/autosave remains owned by
  `useDocumentLifecycle`.
- Main-thread verification after integration:
  - `npm run check` passed.
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
  - `npm run check` passed.
  - `npm test -- --run` passed: 230 files, 5117 tests.
- Navigation/history region was extracted on 2026-07-05 into
  `src/application/useWorkbenchNavigation.ts`.
- It includes:
  - Quick Open file activation,
  - recent-file activation and stale recent-file pruning,
  - Open Class/workspace-symbol result activation,
  - Search Everywhere item activation,
  - shared `openPathForNavigation` / `openNavigationTarget`,
  - problem notice and next/previous problem jumps,
  - `readNavigationFileContent`.
- Important invariant: LSP-specific definition/implementation ownership stays
  in the controller and still consumes the shared navigation primitives.
- Main-thread verification after integration:
  - `npm run check` passed.
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
- LSP runtime lifecycle region was extracted on 2026-07-05 into
  `src/application/useLanguageServerRuntimeLifecycle.ts`.
- It includes:
  - PHP and JS/TS runtime plan refreshes,
  - PHP workspace tooling probe,
  - per-root runtime status caches and session guards,
  - PHP/JS runtime start, stop, restart, project disposal, and background
    disposal flows,
  - PHP and JS/TS autostart/status subscription effects.
- Important invariant: PHP and JS/TS runtime families remain separate and all
  root/session stale-event guards are preserved.
- Main-thread verification after integration:
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
    "runtime|autostart|manual stop|language service|workspace runtime|single-active|IDE mode is being disabled"`
    passed: 58 tests.
  - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
    passed: 867 tests.
  - `npm run check` passed.

## Completion Criteria For This Slice

- Controller line count decreases meaningfully or a documented blocker explains
  why the slice is not yet safe.
- No PHP/JS feature leak across project tabs.
- Existing tests remain green.
- New focused tests cover any extracted behavior.

## Next Worker Slice

Delegate the next high-return controller slice from current `main`.

Recommended next candidates:

1. Re-audit the controller responsibility clusters after the large PHP
   code-action extraction.
2. Pick the next high-return slice based on the audit rather than guessing from
   stale anchors.

Preserve:

- per-project tab isolation.
- modified-document safety.
- git diff/editor tab separation.
- PHP/JS feature boundaries.

Suggested tests:

- focused `useWorkbenchController.preview.test.tsx` patterns around the chosen
  slice,
- `npm run check`,
- full `npm test -- src/application/useWorkbenchController.preview.test.tsx`
  before integration.
