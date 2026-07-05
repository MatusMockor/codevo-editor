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
- If a slice can be split without shared file ownership, split it into multiple
  Codex worktree threads. The main thread should orchestrate, not implement.
- After starting workers, poll them proactively through `read_thread` and
  direct worktree checks. Do not wait for the user to say they finished.
- Poll worker threads proactively through `read_thread` plus direct worktree
  `git status` / `git diff --stat` checks.
- Current next order:
  1. create/audit Codex worker threads before each remaining controller
     extraction,
  2. integrate only reviewed, non-overlapping worker patches,
  3. verify with focused tests, full preview tests, and full suite when the
     surface is user-facing,
  4. commit, push, and update this checkpoint after each shipped slice,
  5. after each PHP/Laravel semantic extraction, re-audit the remaining
     controller clusters before choosing the next worker slice.
- Note: the Codex goal tool is blocked by an old paused goal in this thread.
  Treat this checkpoint as the active operational goal until that goal can be
  safely completed or replaced.

Current baseline from main:

- `src/application/useWorkbenchController.ts`: 16,975 lines after the
  workspace-edit, LSP runtime lifecycle, document tab, navigation,
  close-lifecycle, PHP code-action, file-operations, text-search, Quick Open,
  PHP semantic resolver, Laravel registry/relation/model-type, method-return,
  and expression-type resolver slices.
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
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchSearchEverywhere.ts`;
     controller line count is now 21,705 in the main working tree. The
     floating-surface contract now receives `resetSearchEverywhere` instead of
     raw Search Everywhere file/symbol setters.
   - Strict boundary: do not move Quick Open, text search, Open Class,
     Workspace Symbols, command registry, or navigation activation.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "Search Everywhere|stale.*search|inactive project"` passed: 23 tests.
     - `npm test -- src/application/useFloatingSurfaces.test.tsx` passed: 10
       tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.
     - `npm test -- --run` passed: 230 files, 5117 tests.
   - Old broad workers for combined search surfaces should remain ignored unless
     explicitly restarted from this baseline; all non-text search surface slices
     are already integrated.

16. LSP location navigation and implementation chooser
   - Ownership: implementation chooser state, LSP location target conversion,
     `goToLanguageServerLocation`,
     `goToJavaScriptTypeScriptLanguageServerLocation`, and command-facing
     definition/declaration/type-definition/implementation callbacks.
   - Thread: `019f3381-474c-7170-b66c-541516267ff0`
   - Worktree: `/Users/matusmockor/.codex/worktrees/e29b/editor`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchLanguageNavigation.ts`;
     controller line count is now 20,471 in the main working tree.
   - Strict boundary: do not move call hierarchy, type hierarchy, references,
     Open Class, Workspace Symbols, Search Everywhere, Quick Open, Text Search,
     or PHP semantic resolver/type inference logic.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "definition|implementation|declaration|type definition|implementation chooser|Cmd\\+B|stale|inactive project"`
       passed: 284 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.

17. Hierarchy and references panels
   - Ownership: call hierarchy, type hierarchy, references/file references
     panel state and open-row/open-panel orchestration.
   - Thread: `019f3381-912d-7010-a52e-0f2d33d4dc08`
   - Worktree: `/Users/matusmockor/.codex/worktrees/31b2/editor`
   - Status: completed and integrated into main working tree.
   - Result: extracted `src/application/useWorkbenchSymbolPanels.ts`;
     controller line count is now 21,055 in the main working tree.
   - Strict boundary: do not move definition/declaration/type-definition/
     implementation navigation or implementation chooser, and do not move PHP
     semantic/type resolver/completion regions.
   - Main-thread verification after integration:
     - `npm run check` passed.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx -t
       "call hierarchy|type hierarchy|references|file references|stale|inactive project"`
       passed: 205 tests.
     - `npm test -- src/application/useWorkbenchController.preview.test.tsx`
       passed: 867 tests.

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

The post-LSP PHP semantic audit completed on 2026-07-05 from thread
`019f3397-dde6-71a1-933c-c24376ec10cf`.

Current baseline:

- Main commit: `0f0c10e2`.
- `src/application/useWorkbenchController.ts`: 20,471 lines.
- Already extracted in this phase:
  - `src/application/useWorkbenchSymbolPanels.ts`.
  - `src/application/useWorkbenchLanguageNavigation.ts`.

Remaining PHP/Laravel/OOP clusters:

1. PHP expression/Laravel chain resolver remaining from the broader semantic
   area.
2. PHP/Laravel completions/signatures/inlay hints around lines `10991-12035`.
3. PHP contextual Laravel/navigation definitions around lines `12438-15468`.
4. Laravel migration/provider source registries around lines `1085-1108` and
   `6139-6414`.

Completed worker integrations:

1. `019f339b-3457-7413-bc6e-ffcebaeb7b4f`
   - Title: Extract PHP completion provider.
   - Integrated as a smaller safe slice:
     `src/application/usePhpMethodCompletionResolvers.ts`.
   - Moved receiver/static PHP method completion resolvers and local merge
     helper out of `useWorkbenchController.ts`.
   - `providePhpMethodCompletions` intentionally remains in the controller
     until Laravel target/source collectors are split.
   - Controller line count after integration: 20,314.
   - Main-thread verification:
     - `npm run check` passed.
     - Focused preview completion/Laravel test passed: 222 tests.
     - PHP completion/Laravel domain tests passed: 143 tests.
     - Full preview test passed: 867 tests.
2. `019f339b-8184-7b71-8eaf-a3c9d32379dc`
   - Title: Extract PHP diagnostic context filter.
   - Integrated as `src/application/usePhpDiagnosticContextFilter.ts`.
   - Moved contextual PHP/PHPactor false-positive filtering orchestration out
     of `useWorkbenchController.ts`.
   - Preserved explicit dependency injection for Laravel magic checks, trait
     host checks, type resolution, and framework source contexts.
   - Controller line count after integration: 19,991.
   - Main-thread verification:
     - `npm run check` passed.
     - Focused preview diagnostic/Laravel/stale test passed: 234 tests.
     - PHP diagnostic filter and Laravel correctness domain tests passed:
       76 tests.
     - Full preview test passed: 867 tests.
3. `019f339d-1b51-73a1-8c6e-67d534678903`
   - Title: Extract PHP semantic resolver.
   - Result: broad 3,185-line `usePhpSemanticResolver.ts` extraction was
     tested green in its worker worktree but not integrated.
   - Reason: worker was based on `0f0c10e2` and conflicts conceptually with
     the already integrated completion/diagnostic hooks.
   - Use it only as a blueprint for smaller current-main semantic slices.
4. `019f33ac-ac5a-7ff2-8d11-4ea79afc1dc0`
   - Title: Extract git diff preview close.
   - Integrated as `src/application/useGitDiffPreviewCloseLifecycle.ts`.
   - Added focused hook test:
     `src/application/useGitDiffPreviewCloseLifecycle.test.tsx`.
   - Moved git diff pseudo-document close and selected-change fallback
     orchestration out of `useWorkbenchController.ts`.
   - Controller line count after integration: 19,924.
   - Main-thread verification:
     - `npm run check` passed.
     - `useDocumentLifecycle` tests passed: 15 tests.
     - `useFloatingSurfaces` tests passed: 10 tests.
     - Git diff boundary/click tests passed: 6 tests.
     - Focused close/dirty/git-diff preview tests passed: 56 tests.
     - New hook test passed: 1 test.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5118 tests.
5. `019f33af-6cab-75f3-ad5a-ea2ccb4c7107`
   - Title: Extract PHP semantic resolver.
   - Integrated as a current-main mini-slice:
     `src/application/usePhpSemanticResolver.ts`.
   - Moved low-risk PHP class/type reference resolution, declared return type
     resolution, framework binding lookup, and class source path lookup out of
     `useWorkbenchController.ts`.
   - Intentionally left expression inference, Laravel collectors, navigation,
     completions provider, and diagnostics filter ownership in the existing
     controller/hooks.
   - Preserved `usePhpMethodCompletionResolvers` and
     `usePhpDiagnosticContextFilter` as consumers of explicit resolver
     dependencies.
   - Controller line count after integration: 19,444.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic/completion/Laravel domain tests passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel preview tests passed:
       290 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5118 tests.
6. `019f33b7-bf8e-7da0-b986-e42d11fd48f3`
   - Title: Audit Laravel resolver slice.
   - Integrated as `src/application/usePhpLaravelMethodGenericModelType.ts`.
   - Moved repository/builder/collection generic model carrier inference out of
     `useWorkbenchController.ts`.
   - Kept the recursive PHP expression resolver, completion provider,
     diagnostics filter, navigation callbacks, and Laravel source registries
     in their existing owners.
   - Controller line count after integration: 19,372.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic/completion/Laravel domain tests passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel/repository preview
       tests passed: 296 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5118 tests.
7. `019f33b7-be69-7991-9c5b-5b3d65bc26f5`
   - Title: Extract Laravel source registries.
   - Integrated as `src/application/useLaravelSourceRegistries.ts`.
   - Moved Laravel migration/provider source registries, lazy source loading,
     source signatures, path invalidation, and reset lifecycle out of
     `useWorkbenchController.ts`.
   - Kept diagnostics reclassification, navigation, completion providers, and
     non-Laravel framework logic outside the registry hook.
   - Controller line count after integration: 19,179.
   - Main-thread verification:
     - `npm run check` passed.
     - Focused Laravel/migration/provider/diagnostic/completion/stale preview
       tests passed: 404 tests.
     - Laravel correctness and PHP diagnostic filter domain tests passed:
       76 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5118 tests.
8. `019f33c3-c424-7603-80a5-adaa78d3bac0`
   - Title: Extract navigation history lifecycle.
   - Integrated as `src/application/useNavigationHistoryLifecycle.ts`.
   - Moved navigation history state ownership, explicit reset, and explicit
     restore for workspace-cache lifecycle out of `useWorkbenchController.ts`.
   - Kept existing back/forward playback in `useNavigationHistory`, generic
     open/reveal orchestration in `useWorkbenchNavigation`, git diff pseudo-tab
     behavior, close/save lifecycle, PHP code actions, and LSP-specific
     definition/implementation wiring in their existing owners.
   - Controller line count after integration: 19,178.
   - Main-thread verification:
     - `npm run check` passed.
     - `useNavigationHistory` hook tests passed: 25 tests.
     - Focused navigation/history/git-diff/tab preview tests passed:
       867 tests.
     - Navigation, git diff preview close, and editor surface tests passed:
       136 tests.
     - Full suite passed: 231 files, 5119 tests.
9. `019f33c3-c5cd-7c73-99e4-efb894c9369c`
   - Title: Audit navigation history boundary.
   - Result: no code changes.
   - Confirmed the safe boundary: keep navigation/history playback and generic
     open/reveal hooks separate from document tab lifecycle, git diff
     pseudo-doc opening, and LSP-specific navigation orchestration.
10. `019f33cc-34ca-71b0-b450-18d9ce5f38f6`
   - Title: Extract close/save lifecycle.
   - Result: no code changes.
   - Confirmed the requested close/save lifecycle slice is already extracted
     into `src/application/useDocumentLifecycle.ts`.
   - Verification in worker:
     - `npm run check` passed.
     - Document lifecycle and git diff preview close tests passed: 16 tests.
     - Focused close/dirty/save/tab/git-diff/read-only/modified preview tests
       passed: 867 tests.
11. `019f33cc-36b7-7732-8c84-224c7e9ec9a7`
   - Title: Audit close/save boundary.
   - Result: no code changes.
   - Confirmed `useDocumentLifecycle.ts` is the correct owner for active
     document save/close/Cmd+W behavior, while command registry glue,
     controller-owned state mirrors, and git diff selected-preview close
     behavior must remain separate.
12. `019f33d1-663e-79f2-a509-203dbe549c11`
   - Title: Extract PHP code action provider.
   - Integrated as `src/application/usePhpCodeActionProvider.ts`.
   - Moved app-side PHP code-action provider wiring and the cross-file
     implement/override member collectors out of `useWorkbenchController.ts`.
   - Preserved generated PHP behavior in `usePhpCodeActions`, Monaco provider
     registration/disposal in `languageServerMonacoProviders`, and semantic
     resolver, diagnostics filter, and completion provider ownership in their
     existing modules.
   - Controller line count after integration: 18,950.
   - Main-thread verification:
     - `npm run check` passed.
     - Focused code-action preview tests passed: 32 tests.
     - Focused Monaco provider code-action tests passed: 28 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5119 tests.
13. `019f33d1-6786-7732-ba87-05267022b0ae`
   - Title: Audit PHP code-action boundary.
   - Result: no code changes.
   - Confirmed `usePhpCodeActions` should remain owner of descriptor
     construction, ordering, categories, and generated actions, while file
     mutation side effects and Monaco registration/disposal stay outside.
14. `019f33d8-96ac-7761-b2a7-1920de821d07`
   - Title: Extract Laravel relation resolver.
   - Integrated as `src/application/usePhpLaravelRelationResolver.ts`.
   - Moved Laravel model property/relation type inference, relation-path owner
     resolution, relation target helpers, collection generic model helpers,
     morph-to factory detection, and shared template-return substitution out of
     `useWorkbenchController.ts`.
   - Kept recursive expression resolution, method-return resolution,
     completion provider wiring, diagnostics, navigation callbacks, and
     JS/TS runtime ownership in their existing modules.
   - Controller line count after integration: 18,466.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic engine, method completions, and Laravel correctness tests
       passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel/relation/builder
       preview tests passed: 300 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5119 tests.
15. `019f33d8-96ac-7761-b2a7-193699a432ad`
   - Title: Audit workbench resolver slice.
   - Result: no code changes.
   - Confirmed the safe boundary was the lower-level Laravel model
     property/relation helpers, not the recursive expression resolver or
     method-return resolver.
16. `019f33e3-55ee-7941-8f5d-3d590aebf6ba`
   - Title: Extract PHP method-return resolver.
   - Integrated as `src/application/usePhpMethodReturnTypeResolver.ts`.
   - Moved recursive PHP method return resolution, declared return handling,
     return-expression traversal, trait/mixin/supertype traversal, Laravel
     facade target handling, MorphTo morph-map return refinement, and builder
     terminal model lookup through the existing builder resolver ref.
   - Kept Eloquent builder model resolution, Laravel collection model
     resolution, expression resolution, completion provider wiring,
     diagnostics, navigation, and JS/TS runtime ownership in the controller or
     existing modules.
   - Controller line count after integration: 18,049.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic engine, method completions, and Laravel correctness tests
       passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel/expression/return
       preview tests passed: 314 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5119 tests.
17. `019f33e3-5696-7f51-823d-b0b2a63d29f6`
   - Title: Audit PHP resolver extraction.
   - Result: no code changes.
   - Confirmed the safe micro-slice was `resolvePhpMethodReturnType` only.
     Explicitly warned against moving the builder, collection, and expression
     resolver cluster in the same slice because those functions feed provider
     surfaces and remain mutually recursive.
18. `019f33eb-eaae-7d81-98f4-dfce17dfada2`
   - Title: Extract Laravel model-type resolvers.
   - Integrated as `src/application/usePhpLaravelModelTypeResolvers.ts`.
   - Moved Eloquent builder model type resolution, Laravel collection model
     type resolution, and their local recursion/helper logic out of
     `useWorkbenchController.ts`.
   - Kept `resolvePhpExpressionType`, provider-facing registrations, refs,
     diagnostics, navigation, code actions, and JS/TS runtime ownership in the
     controller or existing modules.
   - Controller line count after integration: 17,584.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic engine, method completions, and Laravel correctness tests
       passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel/expression/return/
       collection preview tests passed: 315 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5119 tests.
19. `019f33f5-a35c-7ec2-97f3-8d01ae0425a8`
   - Title: Audit PHP type resolver extraction.
   - Result: no code changes.
   - Confirmed a narrow expression resolver extraction is now safe if it moves
     only `resolvePhpExpressionType` plus its private class-string helper and
     keeps completions, diagnostics, navigation, code actions, provider
     registration, and JS/TS runtime ownership outside the hook.
   - Explicit dependency warning: the extracted hook must inject
     `resolvePhpSemanticTypeReference` to avoid stale type normalization.
20. `019f33f5-a2b0-71c2-84b4-4c462ab6f286`
   - Title: Audit PHP expression resolver.
   - Integrated as `src/application/usePhpExpressionTypeResolver.ts`.
   - Moved recursive PHP expression type resolution and private class-string
     argument detection out of `useWorkbenchController.ts`.
   - Kept provider-facing completion/diagnostic/navigation/code-action
     behavior, refs, root/session guards, and JS/TS runtime ownership in the
     controller or existing modules.
   - Controller line count after integration: 16,975.
   - Main-thread verification:
     - `npm run check` passed.
     - PHP semantic engine, method completions, and Laravel correctness tests
       passed: 187 tests.
     - Focused completion/definition/diagnostic/Laravel/relation/attribute/
       builder/repository/scope/magic/expression/return/collection preview
       tests passed: 315 tests.
     - Full preview test passed: 867 tests.
     - Full suite passed: 231 files, 5119 tests.
21. `019f33ff-5099-7150-bee0-24c99b53fb86`
   - Title: Audit next controller slice.
   - Result: no code changes.
   - Recommended next production slice:
     `providePhpMethodSignature` plus `providePhpParameterInlayHints`, extracted
     into a small hook such as `src/application/usePhpSignatureHelpProvider.ts`.
   - Rationale: this provider layer depends on already extracted PHP method
     completion resolvers, does not own Laravel target collection, and avoids
     the larger PHP navigation/file-opening surface.
   - Explicitly do not extract next:
     `providePhpMethodCompletions` and PHP/Laravel definition/navigation
     callbacks, because they still mix Laravel collectors, provider caches,
     indexed fallback, and file-opening side effects.
22. `019f33ff-5145-76d3-9e36-21bb1cb3d695`
   - Title: Audit PHP resolver hook tests.
   - Integrated as `src/application/useLaravelSourceRegistries.test.tsx`.
   - Added focused hook coverage for root-scoped Laravel source context
     merging, path-scoped invalidation, and stale in-flight load dropping when
     the active workspace root changes.
   - Main-thread verification:
     - `npm test -- src/application/useLaravelSourceRegistries.test.tsx`
       passed: 3 tests.
     - `npm test -- src/application/phpLaravelMigrationSources.test.ts
       src/application/phpLaravelProviderSources.test.ts` passed: 22 tests.
     - `npm run check` passed.

Integration order:

1. Do not revisit the expression resolver extraction; it is integrated and
   verified.
2. Next production worker slice is PHP signature help + PHP parameter inlay
   hints only, using the audit from thread
   `019f33ff-5099-7150-bee0-24c99b53fb86`.
3. Do not move PHP method completions or PHP/Laravel navigation in that same
   slice.
4. Follow-up focused hook tests for newly extracted provider/registry modules
   are acceptable only as separate, non-overlapping worker slices.

For every worker:

- Poll with `read_thread` and direct worktree `git status` / `git diff --stat`.
- Reject patches that duplicate ownership in both controller and hook.
- Preserve per-project tab isolation, PHP/JS boundaries, Laravel provider
  separation from future Nette, modified-document safety, and git diff/editor
  tab separation.
- Run focused tests requested by the worker, then `npm run check`, full preview
  tests, and full suite for broad user-facing diffs.
