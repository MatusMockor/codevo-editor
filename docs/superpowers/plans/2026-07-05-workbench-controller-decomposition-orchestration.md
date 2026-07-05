# Workbench Controller Decomposition Orchestration

Date: 2026-07-05
Status: active checkpoint

## Goal

Continue the Workbench controller decomposition without looping after context
compaction. The main Codex thread acts as the orchestrator: it creates and
monitors Codex threads, integrates finished work, runs tests, and chooses the
next slice. Implementation should happen in separate Codex threads whenever the
slice can be isolated by file ownership.

Current baseline from main:

- `src/application/useWorkbenchController.ts`: 25,905 lines after the
  workspace-edit, LSP runtime lifecycle, and document tab slices.
- Recent decomposition already extracted hooks for Git, TODOs/bookmarks/history,
  Latte/Neon/Blade intelligence, Laravel targets, engine terminal/navigation,
  PHP outline, floating surfaces, document sync, diagnostics, save/close
  lifecycle, and shared notice rendering.
- Remaining high-return regions:
  - Document/tabs/open-file operations.
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
  - `npm run check` passed.
  - `npm test -- --run` passed: 230 files, 5117 tests.
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

1. Navigation/history operations
   - Anchors: `navigateBack`, `navigateForward`, history stack refs, active
     document jumps, symbol/open-file navigation that is not language-server
     specific.
2. Remaining close/save lifecycle split
   - Anchors: `closeDocument`, dirty document prompts, save-before-close
     handling, Mac window close fallback.
3. PHP code-action provider domain extraction
   - Anchors: code action ordering, create-from-usage, generate members,
     implement/override methods, Laravel/OOP action providers.

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
