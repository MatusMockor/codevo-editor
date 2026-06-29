# Codevo Editor QA Orchestration Checkpoint - 2026-06-29

## Current Head
- Branch: `main`
- Latest commit: `752054dd Remove Vue from current QA scope`
- Worktree at checkpoint creation: clean
- No running `mockor-editor`, `phpactor`, `typescript-language-server`, or `tsserver` processes.

## Important Scope Decision
- Vue is explicitly out of the current QA/roadmap scope.
- Do not spend time on `.vue`, Vue, or Nuxt testing now.
- JavaScript/TypeScript work still matters, but only generic JS/TS Basic-mode parity.

## Already Verified In Real UI
Fresh `npm run debug` was used, not an old `.app` bundle.

- Opened two project tabs:
  - `/Users/matusmockor/Developer/kontentino/api`
  - `/Users/matusmockor/Developer/vue2-datepicker` before Vue was removed from scope
- API project:
  - IDE Mode ON
  - `PHPactor: running`
  - index completed around 3025 files
  - quick-open opened a newly created PHP file with content, not blank
  - temporary PHP syntax error showed diagnostics
  - deleting that temp PHP file cleared diagnostics and closed stale editor state
  - `.phpactor.json` opened as JSON with no schema warning
  - Git panel rendered, not blank
  - Cmd+Q closed the app and left no phpactor/tsserver/editor processes
- Generic popup visual smoke:
  - Quick Open popup rendered with dark themed chrome, selected row, and footer hints.

## Recent Implemented And Pushed Work
- `445d1bda` Cover PHP refactor generators
- `7c1c51b8` Harden PHP inspections edge cases
- `eae0b970` Avoid unsafe promoted constructor generation
- `a139f1be` Lock Monaco popup chrome styling
- `b23353c8` Cover Git workflow UI regressions
- `3f840e3f` Infer Eloquent find array results
- `af11a4b5` Reconcile trait host chained diagnostics
- `93e7cdf3` Harden project-scoped semantic inference
  - JS/TS document sync rootPath isolation test
  - Laravel repository PHPDoc generic inference before naming conventions
  - `$this` resolves to the containing class in multi-class PHP files
- `752054dd` Remove Vue from current QA scope

## Validation Already Run After `93e7cdf3`
- `npm test -- src/infrastructure/tauriLanguageServerDocumentSyncGateway.test.ts src/domain/phpSemanticEngine.test.ts src/domain/phpMethodCompletions.test.ts`
- `npm run check`
- `git diff --check`
- full `npm test` -> 3798 passed

## Current QA Plan After Vue Removal
Read `docs/QA_TEST_PLAN.md`. Critical sections are now:

1. Section 14 - Per-project isolation
2. Section 15 - Lifecycle / stability
3. Section 16 - Regression fixes
4. Section 6 - Visual/theme popup sweep
5. Section 9 - Git workflow
6. Section 1/3 - PHP code actions and Laravel completions
7. Section 8/11/12/13 - Light mode, command/keymap, JSON schema, EditorConfig

## Orchestration Rules Going Forward
- Main agent is orchestrator/integrator.
- Delegate disjoint slices to workers.
- Workers must not overlap write sets.
- Workers must not touch Vue/Nuxt.
- Workers should implement only narrow, proven gaps.
- Every completed slice must have focused tests.
- Main agent integrates, runs `npm run check`, full `npm test`, and relevant `cargo test` if backend changed.
- Real UI QA still needs Computer Use from the main agent.
- Commit and push only green, verified slices.
- Always end a QA cycle by checking:
  - `git status --short`
  - `pgrep -fl 'mockor-editor|phpactor|typescript-language-server|tsserver' || true`

## Remaining Work To Parallelize
- Worker A: Generic JS/TS Basic-mode parity and isolation gaps, no Vue.
- Worker B: PHP/Laravel code action and completion QA gaps.
- Worker C: Git workflow and change gutter QA coverage gaps.
- Worker D: Settings/keymap/status bar/EditorConfig/JSON schema QA gaps.
- Main: Real UI visual/theme sweep and integration.
