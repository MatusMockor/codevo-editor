# JS/TS Project Isolation Slice - 2026-06-20

## Checkpoint

- Repo: `/Users/matusmockor/Developer/editor`
- Branch: `main...origin/main`
- Latest commits:
  - `34d5231 Isolate JS TS runtime actions by workspace`
  - `a985295 Filter JS TS LSP responses by workspace`
  - `8bcf9d8 Add JS TS workspace symbol provider`
  - `d379b08 Isolate JS TS project runtime events`
  - `548cbf0 Navigate Laravel model attributes`
- Current uncommitted WIP to preserve:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot observed:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

## Current JS/TS State

- Managed `typescript-language-server` runtime, document sync, diagnostics, providers, hierarchy, file operations, watcher refresh, settings, status caching, and inferred workspace startup are already implemented.
- Recent isolation work already root-keys document sync, runtime status, request/response routing, lazy resolves, command-backed edits, and runtime policy tests.
- Remaining high-value work should focus on holes where delayed responses, diagnostics, workspace edits, or provider fallbacks could still affect the active project after a tab switch.

## Slice Goal

Harden one remaining JS/TS Basic-mode workspace-isolation gap with regression coverage, without touching PHP/Laravel WIP.

## Delegation Plan

- Frontend explorer owns read-only analysis of JS/TS Monaco provider/controller stale-root guards.
- Backend explorer owns read-only analysis of Rust JS/TS LSP runtime routing, diagnostics, watcher, workspace-edit, and hierarchy guards.
- Main agent owns this plan file, final slice selection, integration edits, verification, commit, and push.

## Candidate Boundaries

- Prefer implementation in `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts` and its test if the gap is provider-local.
- Prefer implementation in Rust `src-tauri/src/lib.rs`/LSP modules and targeted Rust tests if the gap is backend-local.
- Avoid `src/application/useWorkbenchController.ts` unless the selected slice cannot be completed elsewhere, because that file currently contains unrelated PHP/Laravel WIP.

## Acceptance Criteria

- A stale or cross-project JS/TS runtime path has a concrete guard and regression test.
- Focused test for the touched area passes.
- `git diff --check` passes.
- Plan is updated with done/tests/commit status before moving to the next slice.

## Completed Slice: JS/TS Response Payload Filtering

- Added backend JS/TS-only output filtering for LSP payloads before they cross the Tauri boundary:
  - completion lists and `completionItem/resolve`
  - code actions and `codeAction/resolve`
  - CodeLens and `codeLens/resolve`
  - document links and `documentLink/resolve`
- The filters preserve safe inside-root workspace edits and strip/drop unsafe command, data, target, and no-op payloads that reference another project root.
- Added Rust regression coverage for unsafe completion, code-action, CodeLens, and document-link response payloads.
- Added frontend regression coverage proving in-flight JS/TS code-action lists are dropped after switching project tabs.
- PHP LSP command paths were reviewed after integration and left unchanged.

## Verification

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_response_ --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript code actions after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Current failure: `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`
  - This file was already dirty and is intentionally out of scope for this JS/TS slice.

## Commit Status

- Pending commit/push for:
  - `src-tauri/src/lib.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

## Next Candidate Slice

- Backend explorer found a follow-up gap in `src-tauri/src/lsp_session.rs`: post-handshake reader messages buffered during shutdown can still be processed after `stop_requested` is set.
- Next slice should add a stop guard before pending-response routing, `workspace/applyEdit`, and diagnostics emission, with tests for buffered diagnostics and workspace edits after stop.
