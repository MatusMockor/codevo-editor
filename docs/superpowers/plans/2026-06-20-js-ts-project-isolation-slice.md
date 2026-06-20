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

- Committed and pushed:
  - `a2f4cd1 Filter JS TS response payloads by workspace`
- Included files:
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

## Completed Slice: Stopped-Session Reader Guard

- Added a post-handshake `stop_requested` guard in `src-tauri/src/lsp_session.rs` before processing pending responses, server requests, or diagnostics.
- Extended the fake LSP process killer to write a final framed message during termination, which simulates a buffered server message arriving after the session stop flag has been set.
- Added regression tests proving stopped sessions ignore:
  - buffered `textDocument/publishDiagnostics`
  - buffered `workspace/applyEdit`

## Verification: Stopped-Session Reader Guard

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml stop_ignores_buffered --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

## Commit Status: Stopped-Session Reader Guard

- Committed and pushed:
  - `9d853d1 Ignore stopped JS TS LSP session messages`
- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Final Bounded Scan: JS/TS Isolation

- Checked the TypeScript Monaco provider registrations against stale-switch regression coverage.
- Re-read the provider path for hover, completions, signature help, definitions, references, rename, code actions, CodeLens, formatting, inlay hints, document symbols, links, folding ranges, selection ranges, linked editing, semantic tokens, and workspace symbols.
- Confirmed the frontend provider pattern consistently:
  - captures the active workspace before async work,
  - flushes pending document changes only for the still-active root,
  - re-checks the stored workspace root before returning data, applying edits, resolving lazy payloads, or reporting errors.
- Checked backend JS/TS LSP response filters for location, workspace symbol, workspace edit, hierarchy, completion, code action, CodeLens, document link, and command payload paths.
- No further small, high-confidence code slice was identified in this scan.
- Remaining useful validation is runtime GUI QA across two real JS/TS projects, plus unblocking the repo-wide `npm run check` failure in the existing PHP/Laravel WIP when that work is in scope.

## Commit Status: Final Checkpoint

- This section records the final doc-only checkpoint for the current pass.

## Next Slice: External JS/TS Navigation Targets

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1c2e1a3 Record JS TS isolation final scan`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Frontend provider tests already model VS Code-like JS/TS navigation to external read-only targets such as dependency `.d.ts` files and bundled TypeScript library files.
- The backend JS/TS commands currently root-filter all location responses, including `definition`, `implementation`, and `typeDefinition`.
- That protects isolation, but it also drops legitimate TypeScript navigation targets outside the project root. References and workspace symbols should stay workspace-filtered because those surfaces are project-wide result lists.

### Delegation

- Worker owns `src-tauri/src/lib.rs` only:
  - let JS/TS definition/implementation/typeDefinition return parsed locations without workspace filtering,
  - keep JS/TS references and workspace symbols root-filtered,
  - add focused Rust regression coverage.
- Main agent owns this plan document, integration review, verification, commit, and push.

### Acceptance Criteria

- JS/TS definition/implementation/typeDefinition can preserve external file URI targets from the selected runtime response.
- JS/TS references still drop outside-root locations.
- PHP command paths remain unchanged.
- Focused Rust tests pass.
- `git diff --check` passes.

### Completed Slice: External JS/TS Navigation Targets

- JS/TS `definition`, `implementation`, and `typeDefinition` backend commands now preserve external file URI locations from the selected TypeScript runtime response.
- JS/TS `references` remains root-filtered, so project-wide reference lists still cannot leak locations from another workspace.
- PHP LSP command paths were left unchanged.
- Added Rust regression coverage proving:
  - external JS/TS navigation locations are preserved,
  - external JS/TS reference locations are still dropped.

### Verification: External JS/TS Navigation Targets

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_navigation_locations_preserve_external_file_uris --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_reference_locations_drop_external_file_uris --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: External JS/TS Navigation Targets

- Included files:
  - `src-tauri/src/lib.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`
