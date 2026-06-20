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

## Next Slice: Semantic Token Legend Parity

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2acf5b5 Allow external JS TS navigation targets`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- Semantic tokens are wired, but the JS/TS Monaco provider currently uses a hard-coded semantic token legend.
- TypeScript-language-server advertises its actual `semanticTokensProvider.legend` during initialize.
- If Monaco decodes token indexes with a different legend than the server used, semantic highlighting can be systematically wrong even while requests succeed.

### Delegation

- Worker owns:
  - `src-tauri/src/lsp_session.rs`
  - `src/domain/languageServerRuntime.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - focused tests for those files
- Main agent owns this plan document, integration review, verification, commit, and push.

### Acceptance Criteria

- Runtime capabilities preserve the server-advertised semantic token legend.
- JS/TS Monaco semantic-token provider returns the active runtime legend.
- Provider falls back to the current default legend when no usable server legend exists.
- Focused frontend/domain/Rust tests pass.
- `git diff --check` passes.

### Completed Slice: Semantic Token Legend Parity

- Runtime status capabilities now preserve the server-advertised `semanticTokensProvider.legend` as `semanticTokensLegend`.
- JS/TS Monaco semantic-token provider now reads the active runtime legend instead of always using the hard-coded fallback.
- The default legend remains as fallback for stopped runtimes, stale-root runtimes, or missing/malformed server legends.
- Added regression coverage for custom runtime legends and default fallback behavior.

### Verification: Semantic Token Legend Parity

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/domain/languageServerRuntime.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml semantic_token_legend_is_preserved_from_initialize_capabilities --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml capability_values_are_normalized --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: Semantic Token Legend Parity

- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `src/domain/languageServerRuntime.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: TypeScript Client File Watcher Mode

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e8b1115 Use JS TS semantic token legend from runtime`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- The editor already starts a per-workspace JS/TS filesystem watcher and sends `workspace/didChangeWatchedFiles` to the selected TypeScript language-server session.
- TypeScript-language-server only routes those watch events into tsserver watch management when:
  - `initializationOptions.tsserver.useClientFileWatcher` is enabled,
  - the client advertises `workspace.didChangeWatchedFiles.dynamicRegistration`,
  - the client advertises `workspace.didChangeWatchedFiles.relativePatternSupport`.
- Without this, external/editor file changes can be sent but mostly ignored by the TypeScript server's project graph.

### Implementation Choice

- This slice is backend-contained in `src-tauri/src/lsp.rs`.
- A backend explorer already identified the gap. Main agent implements this one directly because it is a one-file initialize-payload change with an existing nearby test, so an extra worker would add delay without reducing conflict risk.

### Acceptance Criteria

- JS/TS initialize payload enables `initializationOptions.tsserver.useClientFileWatcher`.
- JS/TS initialize capabilities advertise `workspace.didChangeWatchedFiles.dynamicRegistration` and `relativePatternSupport`.
- Existing `workspace/didChangeWatchedFiles` session routing remains unchanged.
- Focused Rust plan test passes.
- `git diff --check` passes.

### Completed Slice: TypeScript Client File Watcher Mode

- JS/TS initialize payload now sets `initializationOptions.tsserver.useClientFileWatcher` to `true`.
- JS/TS initialize capabilities now advertise:
  - `workspace.didChangeWatchedFiles.dynamicRegistration`
  - `workspace.didChangeWatchedFiles.relativePatternSupport`
- `configure_typescript_server_path` now merges the workspace/bundled tsserver path into existing `tsserver` options instead of replacing them, so the watcher flag survives TypeScript-version configuration.
- Existing per-workspace `workspace/didChangeWatchedFiles` routing remains unchanged.

### Verification: TypeScript Client File Watcher Mode

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml registry_routes_watched_file_changes_to_the_requested_workspace_only --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: TypeScript Client File Watcher Mode

- Included files:
  - `src-tauri/src/lsp.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Directory Watch Events

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `312128b Enable JS TS client file watcher mode`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- The previous slice enables TypeScript-language-server's client-side watch-event bridge.
- TypeScript server watch management can register directory watchers. The bridge matches directory watcher paths against incoming `workspace/didChangeWatchedFiles` changes.
- Our JS/TS watcher currently drops all directory events, so bulk directory creates/deletes/renames can leave tsserver's project graph stale if the OS/backend reports only directory-level changes.

### Implementation Choice

- This slice is backend-contained in `src-tauri/src/js_ts_file_watcher.rs`.
- Main agent implements directly because it is a one-file mapping/test update following the backend explorer's read-only analysis.

### Acceptance Criteria

- Directory create/delete/rename events inside the workspace are forwarded as LSP watched-file changes.
- PHP and unsupported file events remain ignored.
- Root guards and cross-root rename behavior remain strict.
- Focused Rust watcher tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Directory Watch Events

- Directory create/modify/delete events inside the JS/TS workspace now map to `workspace/didChangeWatchedFiles` changes.
- Directory renames now map to deleted + created changes, matching file rename behavior.
- Unsupported file extensions, PHP files, rescan events, and outside-root paths remain filtered out.
- Existing cross-root rename behavior remains strict: only the side inside the watched workspace is forwarded.

### Verification: JS/TS Directory Watch Events

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml js_ts_file_watcher --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Directory Watch Events

- Included files:
  - `src-tauri/src/js_ts_file_watcher.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: TypeScript Source Action Kinds

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `176ee93 Forward JS TS directory watch events`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- TypeScript-language-server documents TypeScript-specific source action kinds such as `source.organizeImports.ts`, `source.removeUnusedImports.ts`, `source.sortImports.ts`, `source.addMissingImports.ts`, and `source.fixAll.ts`.
- The editor currently advertises only generic source action kinds to the server and Monaco.
- Adding the TS-specific kinds improves VS Code-like Source Actions discovery while reusing the existing code action/resolve/execute-command pipeline.

### Implementation Choice

- This slice is limited to:
  - `src-tauri/src/lsp.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - focused tests in existing nearby files
- Main agent implements directly because the change is a small advertised-kind expansion and does not touch PHP WIP.

### Acceptance Criteria

- JS/TS initialize capabilities include TypeScript-specific source action kinds.
- Monaco JS/TS code action provider advertises the same TypeScript-specific source action kinds.
- Existing command execution path remains unchanged.
- Focused frontend and Rust tests pass.
- `git diff --check` passes.

### Completed Slice: TypeScript Source Action Kinds

- JS/TS initialize capabilities now include TypeScript-language-server source action kinds:
  - `source.fixAll.ts`
  - `source.addMissingImports.ts`
  - `source.organizeImports.ts`
  - `source.removeUnused.ts`
  - `source.removeUnusedImports.ts`
  - `source.sortImports.ts`
- Monaco JS/TS code action provider advertises the same TypeScript-specific source action kinds.
- Existing code action resolve/execute-command path remains unchanged and continues to handle returned edits/commands.

### Verification: TypeScript Source Action Kinds

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "registers VS Code-like navigation"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: TypeScript Source Action Kinds

- Included files:
  - `src-tauri/src/lsp.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Rich Inlay Hint Label Parts

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0d73ddc Advertise TypeScript source action kinds`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- TypeScript can return inlay hint labels as structured label parts, not just strings.
- Monaco supports `InlayHintLabelPart[]`, including per-part tooltip and location metadata.
- Our parser currently flattens label parts into a string, dropping richer VS Code-like hover/click context.

### Implementation Choice

- Preserve `label`, `tooltip`, and `location` for label parts.
- Do not wire label-part commands in this slice, because that would add a new command execution surface needing separate root/path guard design.
- Files are limited to shared feature types, Rust parser, JS/TS Monaco mapping, and focused tests.

### Acceptance Criteria

- Rust parser preserves inlay hint string labels and structured label parts.
- Frontend domain type models inlay hint label as string or label parts.
- JS/TS Monaco provider maps label parts to Monaco `InlayHintLabelPart[]` with tooltip/location.
- Focused Rust and provider tests pass.
- `git diff --check` passes.

### Completed Slice: Rich Inlay Hint Label Parts

- Rust inlay hint parsing now preserves both plain string labels and structured label parts.
- Structured parts keep `label`, `tooltip`, and `location` metadata for Monaco.
- Frontend domain types now model inlay hints as `string | LanguageServerInlayHintLabelPart[]`.
- JS/TS Monaco provider maps label parts into Monaco `InlayHintLabelPart[]` while leaving label-part commands unwired for a separate guarded design.

### Verification: Rich Inlay Hint Label Parts

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml parses_inlay_hints_with_string_and_part_labels --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "maps references, rename edits"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: Rich Inlay Hint Label Parts

- Included files:
  - `src-tauri/src/lsp_features.rs`
  - `src/domain/languageServerFeatures.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Server Refresh Requests

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6bc7a38 Preserve JS TS inlay hint label parts`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- The TypeScript language server can ask the client to refresh dynamic editor surfaces such as CodeLens and inlay hints.
- CodeLens refresh support is already advertised, but server refresh requests are only acknowledged and do not cause Monaco providers to re-query.
- Inlay hint refresh support is not advertised yet.

### Implementation Choice

- Add a typed refresh event with `feature`, `rootPath`, and `sessionId` metadata.
- Emit refresh events from Rust when handling `workspace/codeLens/refresh` and `workspace/inlayHint/refresh` requests.
- Add a JS/TS Tauri refresh gateway and optional provider subscription.
- Fire Monaco provider `onDidChange` events only for the active workspace and current runtime session.

### Acceptance Criteria

- JS/TS initialize capabilities advertise inlay hint refresh support.
- Rust session emits refresh events and still acknowledges the server request.
- JS/TS Monaco CodeLens provider exposes `onDidChange`; inlay hint provider exposes `onDidChangeInlayHints`.
- Refresh events from stale sessions, inactive workspaces, or unknown features are ignored.
- Focused Rust and provider tests pass.

### Completed Slice: JS/TS Server Refresh Requests

- JS/TS initialize capabilities now advertise workspace inlay hint refresh support.
- Rust language-server sessions emit typed refresh events for `workspace/codeLens/refresh` and `workspace/inlayHint/refresh` while acknowledging both requests.
- App/Tauri wiring now includes a JS/TS refresh gateway separate from workspace edits.
- JS/TS Monaco providers subscribe to refresh events and fire CodeLens/Inlay refresh hooks only for the active workspace and current runtime session.
- Stale session, inactive workspace, and unknown refresh feature events are ignored.

### Verification: JS/TS Server Refresh Requests

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml workspace_refresh_requests_emit_refresh_events_and_acknowledge --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "refreshes CodeLens"`
- PASS: `npm test -- src/infrastructure/tauriLanguageServerRefreshGateway.test.ts`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerRefreshGateway.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Server Refresh Requests

- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_session.rs`
  - `src/App.tsx`
  - `src/components/EditorSurface.tsx`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/infrastructure/tauriLanguageServerRefreshGateway.ts`
  - `src/infrastructure/tauriLanguageServerRefreshGateway.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Semantic Tokens Refresh

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f08d4ab Refresh JS TS code lens and inlay providers`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- Monaco document semantic token providers support an `onDidChange` event.
- The TypeScript language server can ask clients to refresh semantic tokens via `workspace/semanticTokens/refresh` when project state or configuration changes.
- The previous refresh slice added shared refresh infrastructure, so semantic token refresh can be added without a new event channel.

### Implementation Choice

- Extend the typed refresh feature union with `semanticTokens`.
- Advertise `workspace.semanticTokens.refreshSupport` in the JS/TS initialize capabilities.
- Emit the refresh event from Rust for `workspace/semanticTokens/refresh`.
- Reuse the JS/TS refresh gateway and active workspace/session filtering before firing Monaco semantic token provider `onDidChange`.

### Acceptance Criteria

- JS/TS initialize capabilities advertise semantic token refresh support.
- Rust session emits a `semanticTokens` refresh event and acknowledges the server request.
- JS/TS Monaco semantic token provider exposes `onDidChange`.
- Stale session, inactive workspace, and unknown refresh feature events remain ignored.
- Focused Rust and provider tests pass.

### Completed Slice: JS/TS Semantic Tokens Refresh

- JS/TS initialize capabilities now advertise `workspace.semanticTokens.refreshSupport`.
- Rust session refresh handling now emits `semanticTokens` refresh events for `workspace/semanticTokens/refresh`.
- The shared JS/TS refresh gateway/provider path now supports `semanticTokens` alongside CodeLens and inlay hints.
- Monaco document semantic token provider now exposes `onDidChange`, guarded by active workspace and current runtime session checks.

### Verification: JS/TS Semantic Tokens Refresh

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml workspace_refresh_requests_emit_refresh_events_and_acknowledge --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "refreshes CodeLens"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerRefreshGateway.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Semantic Tokens Refresh

- Included files:
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_session.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Inlay Hint Resolve

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3a113dc Refresh JS TS semantic tokens on server request`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`

### Why This Slice

- Monaco supports `resolveInlayHint`.
- TypeScript can use LSP `inlayHint/resolve` to lazily provide tooltip and label-part metadata.
- We now preserve structured inlay label parts, so resolving hints closes another VS Code-like fidelity gap.

### Implementation Choice

- Preserve LSP inlay hint `data` payload so resolve requests can round-trip server-owned metadata.
- Advertise only the resolve properties we map safely: `tooltip`, `label.tooltip`, and `label.location`.
- Do not expose label-part commands or inlay text edits in this slice.
- Keep provider resolve guarded by active workspace/session root, matching CodeLens resolve behavior.

### Acceptance Criteria

- JS/TS initialize capabilities advertise inlay hint resolve support properties.
- Rust can serialize `inlayHint/resolve` and parse the resolved hint.
- Tauri feature gateway exposes `resolveInlayHint`.
- JS/TS Monaco provider resolves backed inlay hints and ignores stale workspace hints.
- Focused Rust, gateway, and provider tests pass.

### Completed Slice: JS/TS Inlay Hint Resolve

- JS/TS initialize capabilities now advertise safe inlay hint resolve properties:
  - `tooltip`
  - `label.tooltip`
  - `label.location`
- Rust now preserves inlay hint `data`, serializes `inlayHint/resolve`, converts app label parts back to LSP `value` parts, and parses resolved hints.
- Tauri feature gateway now exposes `resolveInlayHint` for PHP and JS/TS command sets.
- JS/TS Monaco inlay provider now implements `resolveInlayHint` with active workspace guards and non-enumerable backing metadata.
- Label-part commands and inlay text edits remain intentionally unwired for a separate guarded design.

### Verification: JS/TS Inlay Hint Resolve

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml inlay_hint_resolve_request_serializes_hint_data --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml parses_inlay_hints_with_string_and_part_labels --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "maps references, rename edits"`
- PASS: `npm test -- src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts src/components/languageServerMonacoProviders.test.ts src/components/EditorSurface.test.tsx`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Inlay Hint Resolve

- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_features.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `src/components/EditorSurface.test.tsx`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Server Window Messages Runtime Log

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `165e129 Resolve JS TS inlay hints lazily`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The runtime log already captures process stderr, which is useful when the TypeScript language server crashes or starts noisily.
- LSP servers also report important startup, project, and tsserver messages via `window/logMessage` and `window/showMessage` notifications on stdout.
- Capturing those messages in the same bounded runtime log improves JS/TS diagnostics without changing editor behavior or touching PHP/Laravel WIP.

### Implementation Choice

- Keep this backend-contained in `src-tauri/src/lsp_session.rs`.
- Append both pre-handshake and post-handshake `window/logMessage`/`window/showMessage` notifications to the existing bounded runtime log.
- Leave request/response, diagnostics, refresh, and workspace-edit routing unchanged.

### Acceptance Criteria

- Runtime log includes LSP `window/logMessage` notifications with severity.
- Runtime log includes LSP `window/showMessage` notifications with severity.
- Messages emitted before initialize completes are captured.
- Focused Rust test passes.
- `git diff --check` passes.

### Completed Slice: Server Window Messages Runtime Log

- Runtime log now captures `window/logMessage` notifications from the language server stdout reader.
- Runtime log now captures `window/showMessage` notifications with the same bounded-log behavior used for stderr.
- Messages emitted before the initialize handshake completes are captured before normal handshake filtering.
- Request/response routing, diagnostics, refresh, and workspace-edit handling remain unchanged.

### Verification: Server Window Messages Runtime Log

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml captures_language_server_window_messages_in_runtime_log --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: Server Window Messages Runtime Log

- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Server Show Message Requests Runtime Log

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b9b1a8d Capture JS TS server window messages`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- LSP servers can send `window/showMessageRequest` prompts, which VS Code surfaces to the user with actions.
- The editor currently replies with the default `null` result for unknown requests, which is acceptable as "no action selected", but the prompt itself is invisible.
- Logging these prompts preserves the diagnostic value without adding a new UI decision surface.

### Implementation Choice

- Extend the existing server-window-message runtime-log path to include `window/showMessageRequest`.
- Continue routing request messages after logging so the existing JSON-RPC response path still acknowledges the request.
- Make the `window/showMessageRequest` null response explicit in the request handler.

### Acceptance Criteria

- Runtime log includes `window/showMessageRequest` messages with severity.
- `window/showMessageRequest` still receives a JSON-RPC response.
- Existing `window/logMessage` and `window/showMessage` notification behavior remains unchanged.
- Focused Rust test passes.
- `git diff --check` passes.

### Completed Slice: Server Show Message Requests Runtime Log

- Runtime log now captures `window/showMessageRequest` prompt messages with severity.
- Request messages continue through the normal server-request path after logging, so the language server still receives a JSON-RPC response.
- The request handler now explicitly treats `window/showMessageRequest` as a no-selection `null` result.
- Existing notification logging for `window/logMessage` and `window/showMessage` remains unchanged.

### Verification: Server Show Message Requests Runtime Log

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml captures_language_server_show_message_requests_in_runtime_log_and_responds --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: Server Show Message Requests Runtime Log

- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`
