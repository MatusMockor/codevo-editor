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

## Next Slice: JS/TS Signature Help Context

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6bae152 Log JS TS server message requests`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation

- Frontend explorer Locke completed a read-only scan and recommended bridging Monaco signature-help context to the TypeScript language server.
- Backend explorer Hypatia completed a read-only scan and queued `workspace/didChangeConfiguration` shape normalization as the next backend slice.
- Main agent owns integration because the selected signature-help slice crosses frontend, gateway, Tauri command, Rust request factory, and initialize capability wiring; splitting code edits now would create overlapping API contracts across layers.

### Why This Slice

- Monaco supplies signature-help trigger context, including trigger kind, trigger character, retrigger state, and active signature help.
- TypeScript-language-server uses this context to choose trigger reasons and preserve active overloads across retriggers.
- The editor already registers trigger/retrigger characters, but currently drops the context before calling the server, so comma/paren retriggers are less VS Code-like.

### Implementation Choice

- Add a small domain/Rust `LanguageServerSignatureHelpContext` model that mirrors safe LSP fields.
- Pass context only when Monaco provides useful trigger/retrigger metadata.
- Preserve a minimal active-signature-help payload from Monaco's previous result.
- Advertise `textDocument.signatureHelp.contextSupport` in JS/TS initialize capabilities.

### Acceptance Criteria

- JS/TS initialize capabilities advertise signature-help context support.
- Provider forwards trigger and retrigger signature-help context to the gateway.
- Tauri gateway and commands forward the optional context to Rust.
- Rust request factory serializes optional LSP signature-help context.
- Focused Rust, gateway, and provider tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Signature Help Context

- JS/TS initialize capabilities now advertise `textDocument.signatureHelp.contextSupport`.
- Monaco signature-help provider now forwards trigger kind, trigger character, retrigger state, and minimal active signature help to the gateway.
- Frontend feature types and Tauri gateway now carry optional signature-help context.
- Tauri JS/TS command accepts optional context and Rust request factory serializes it into `textDocument/signatureHelp`.
- PHP signature-help command remains context-free and unchanged in behavior.

### Verification: JS/TS Signature Help Context

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "signature help"`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml signature_help --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Signature Help Context

- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_features.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Candidate Slice: JS/TS DidChangeConfiguration Shape

- Backend explorer Hypatia identified that flat JS/TS settings should remain in the session cache for `workspace/configuration`, while `workspace/didChangeConfiguration` notifications should be sent with VS Code-like nested `typescript` and `javascript` settings.
- This is the next queued backend parity slice after the signature-help context commit.

## Next Slice: JS/TS DidChangeConfiguration Shape

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4ad3472 Forward JS TS signature help context`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation

- Backend explorer Hypatia identified this gap and verified the existing `workspace_configuration_requests` tests were green before implementation.
- Main agent implemented directly because the slice is constrained to the Rust Tauri boundary and one private helper/test in `src-tauri/src/lib.rs`.

### Why This Slice

- `typescript-language-server` deep-merges `workspace/didChangeConfiguration` payloads into its workspace configuration.
- Language-specific settings such as CodeLens, inlay hints, format, suggest, and validation are read under `typescript` or `javascript` namespaces.
- The editor previously sent the flat settings shape used for `workspace/configuration` section replies, so runtime setting toggles could update the cache without updating TypeScript server behavior.

### Implementation Choice

- Keep the flat settings unchanged for `registry.update_server_configuration`, preserving `workspace/configuration` section replies.
- Send `workspace/didChangeConfiguration` with duplicated `typescript` and `javascript` language settings.
- Preserve root-level `implicitProjectConfiguration` and `formattingOptions`, because the TypeScript server reads inferred project config at the workspace root and still asks formatting options through the dedicated section.

### Acceptance Criteria

- JS/TS `workspace/didChangeConfiguration` notification settings include nested `typescript` and `javascript` settings.
- Flat `workspace/configuration` cache behavior remains unchanged.
- Existing workspace configuration request tests keep passing.
- Focused Rust helper test and full Rust suite pass.
- `git diff --check` passes.

### Completed Slice: JS/TS DidChangeConfiguration Shape

- JS/TS configuration notifications now wrap flat language settings under both `typescript` and `javascript`.
- Root-level `implicitProjectConfiguration` and `formattingOptions` are preserved in notification payloads.
- Session configuration cache still receives the original flat settings object for section-based `workspace/configuration` responses.
- Added Rust coverage for the flat-to-nested notification shape.

### Verification: JS/TS DidChangeConfiguration Shape

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_configuration_notifications_use_language_namespaces --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml workspace_configuration_requests --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS DidChangeConfiguration Shape

- Included files:
  - `src-tauri/src/lib.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Declaration Navigation

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2a7a2d2 Nest JS TS configuration updates`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Monaco exposes `registerDeclarationProvider`, and LSP exposes `textDocument/declaration`.
- TypeScript-language-server can advertise `declarationProvider`, giving VS Code-like "Go to Declaration" navigation.
- The editor currently wires definition, implementation, and type definition, but not declaration.

### Implementation Choice

- Add `declaration` to runtime capability parsing and frontend capability types.
- Add a request factory method and Tauri feature commands for `textDocument/declaration`.
- Register a JS/TS Monaco declaration provider that reuses the same active workspace guards and location mapping as definition.
- Preserve external declaration targets, matching the previous external JS/TS navigation decision for definition/typeDefinition/implementation.

### Acceptance Criteria

- JS/TS runtime status can report `declarationProvider`.
- Frontend JS/TS Monaco providers register declaration support for JS/TS languages.
- Tauri gateway and Rust feature factory can request `textDocument/declaration`.
- JS/TS declaration locations can include external file URI targets.
- Focused Rust, gateway, provider, and runtime tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Declaration Navigation

- Runtime capability models now include `declaration` and parse/report `declarationProvider`.
- TypeScript initialize capabilities advertise declaration support with `linkSupport`.
- Rust feature request factory and Tauri command handlers now issue `textDocument/declaration`.
- JS/TS Tauri gateway and Monaco providers now expose "Go to Declaration" for JavaScript and TypeScript language IDs.
- JS/TS declaration results preserve external file URI targets, matching definition, type definition, and implementation navigation behavior.

### Verification: JS/TS Declaration Navigation

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml declaration --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_navigation_locations_preserve_external_file_uris --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts src/components/languageServerMonacoProviders.test.ts src/components/EditorSurface.test.tsx src/application/useWorkbenchController.preview.test.tsx src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts src/domain/languageServerRuntime.test.ts src/domain/languageServerFeatures.test.ts src/domain/languageServerRuntimeStatusCache.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`
- NOTE: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` still reports unrelated formatting differences in `src-tauri/src/js_ts_file_watcher.rs`; the file was not changed for this slice.

### Commit Status: JS/TS Declaration Navigation

- Committed and pushed as `e080053 Add JS TS declaration navigation`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_features.rs`
  - `src-tauri/src/lsp_session.rs`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `src/components/EditorSurface.test.tsx`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/domain/languageServerRuntime.test.ts`
  - `src/domain/languageServerRuntime.ts`
  - `src/domain/languageServerRuntimeStatusCache.test.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.ts`
  - `src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Call Hierarchy Capability Advertisement

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e080053 Add JS TS declaration navigation`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Choice

- Backend explorer Aquinas completed a read-only scan and identified that `typescript-language-server` gates `callHierarchyProvider` on the client advertising `textDocument.callHierarchy`.
- The main agent will integrate this slice directly because the implementation is intentionally limited to `src-tauri/src/lsp.rs` and the explorer already provided the backend evidence.

### Why This Slice

- JS/TS call hierarchy UI and gateway paths already exist, including prepare, incoming, and outgoing calls.
- Runtime capability parsing already reads `callHierarchyProvider`.
- The TypeScript language server does not advertise call hierarchy unless the initialize request includes `textDocument.callHierarchy`.
- Without this capability advertisement, the existing call hierarchy UI path remains hidden for TypeScript projects even though the backend request pipeline is present.

### Implementation Choice

- Add `textDocument.callHierarchy.dynamicRegistration = false` to the JS/TS initialize capabilities.
- Keep the setting outside the large `json!` macro payload, matching the declaration capability approach and avoiding macro recursion growth.
- Add focused assertion coverage in `javascript_typescript_workspace_builds_typescript_language_server_plan`.
- Do not add type hierarchy to this slice; local `typescript-language-server` code shows a clear call hierarchy gate but no equivalent type hierarchy capability gate.

### Acceptance Criteria

- JS/TS initialize request advertises `textDocument.callHierarchy`.
- Existing JS/TS call hierarchy command/gateway path can become visible when the server advertises `callHierarchyProvider`.
- Focused Rust capability/request tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Call Hierarchy Capability Advertisement

- JS/TS initialize capabilities now advertise `textDocument.callHierarchy`.
- The setting is applied after the large initialize JSON payload, matching the declaration capability approach and avoiding additional `serde_json::json!` macro nesting.
- Existing call hierarchy gateway, command palette, request factory, parser, and workspace filtering paths remain unchanged and can now be enabled by `typescript-language-server` when TS version support is present.

### Verification: JS/TS Call Hierarchy Capability Advertisement

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml call_hierarchy --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml capability_values_are_normalized --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Call Hierarchy Capability Advertisement

- Committed and pushed as `1c4014b Advertise JS TS call hierarchy support`.
- Included files:
  - `src-tauri/src/lsp.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Move To File Refactor Support

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1c4014b Advertise JS TS call hierarchy support`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Choice

- Frontend explorer Volta recommended "Go to Source Definition" as a high-value remaining gap, but that slice needs `src/application/useWorkbenchController.ts`, which currently contains user PHP/Laravel WIP.
- The main agent is taking this safer backend/provider slice first because it avoids the WIP file while still unlocking a VS Code-like TypeScript refactor path.

### Why This Slice

- `typescript-language-server` reads `initializationOptions.supportsMoveToFileCodeAction` and only includes interactive TypeScript "Move to file" refactors when that flag is true and TypeScript is new enough.
- The editor already supports JS/TS code actions, `_typescript.applyRefactoring` command execution, server-initiated `workspace/applyEdit`, and workspace edit filtering.
- Monaco currently advertises broad refactor support, but not the `refactor.move` branch that TypeScript uses for move-file refactors.

### Implementation Choice

- Add `supportsMoveToFileCodeAction: true` to JS/TS initialization options.
- Add `refactor.move` to the LSP code action kind value set and Monaco JS/TS provider advertised action kinds.
- Keep this slice limited to feature advertisement; no new command palette action and no changes to `useWorkbenchController.ts`.

### Acceptance Criteria

- JS/TS initialize request advertises TypeScript move-to-file refactor support.
- LSP and Monaco code-action kind declarations include `refactor.move`.
- Focused Rust initialize-plan and frontend provider registration tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Move To File Refactor Support

- JS/TS initialize options now advertise `supportsMoveToFileCodeAction: true`, enabling TypeScript-language-server to surface supported interactive "Move to file" refactors on modern TypeScript versions.
- The JS/TS LSP code-action kind value set now includes `refactor.move`.
- The Monaco JS/TS code-action provider now advertises `refactor.move` alongside the existing quick fix, source, and refactor branches.
- This slice intentionally avoided `src/application/useWorkbenchController.ts` so the unrelated PHP/Laravel WIP remains untouched.

### Verification: JS/TS Move To File Refactor Support

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --quiet -- --test-threads=1`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`
- NOTE: A default parallel `cargo test --manifest-path src-tauri/Cargo.toml --quiet` run hit two unrelated git test temp-repo setup failures; the full suite passed when run serially.

### Commit Status: JS/TS Move To File Refactor Support

- Committed and pushed as `1969a66 Enable JS TS move-to-file refactors`.
- Included files:
  - `src-tauri/src/lsp.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Go To Source Definition

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1969a66 Enable JS TS move-to-file refactors`
- Existing PHP/Laravel WIP remains uncommitted and excluded:
  - `src/application/useWorkbenchController.ts`
  - `src/domain/phpFrameworkLaravel.ts`
  - `src/domain/phpMethodCompletions.test.ts`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Choice

- Frontend explorer Volta identified "Go to Source Definition" as a high-value VS Code parity gap.
- The main agent will implement the slice directly because the needed changes are narrow and the current `src/application/useWorkbenchController.ts` WIP is only an unrelated PHP import line.

### Why This Slice

- `typescript-language-server` already exposes `_typescript.goToSourceDefinition` through `executeCommandProvider.commands` on TypeScript 4.7+.
- The command returns navigation locations, not a workspace edit, so it should not reuse the existing generic JS/TS `executeCommand` path.
- Source definition is especially useful when a TypeScript definition points at generated or declaration files and the user wants the original source.

### Implementation Choice

- Add a JS/TS-specific `sourceDefinition` method to the feature gateway and domain interface.
- Add a Rust Tauri command that executes `_typescript.goToSourceDefinition` with `[uri, position]` and parses the response as navigation locations.
- Preserve external file URI results, matching definition/declaration/typeDefinition/implementation navigation.
- Add a command palette action using the existing active-workspace guards in `goToJavaScriptTypeScriptLanguageServerLocation`.

### Acceptance Criteria

- JS/TS source definition command sends `workspace/executeCommand` with `_typescript.goToSourceDefinition`.
- Source definition results can include external file URI targets.
- Workbench exposes "Go to Source Definition" only for an active JS/TS document with a running JS/TS server that advertises the command.
- Focused Rust, gateway, and workbench tests pass.
- `git diff --check` passes.

### Completed Slice: JS/TS Go To Source Definition

- Added a JS/TS-specific Tauri command for `_typescript.goToSourceDefinition` that returns navigation locations instead of trying to parse a workspace edit.
- Added runtime capability parsing for `executeCommandProvider.commands` so `sourceDefinition` is enabled only when the server advertises the TypeScript source-definition command.
- Added `sourceDefinition` to the frontend language-server gateway contract and wired the JS/TS command map to `javascript_typescript_text_document_source_definition`.
- Added a "Go to Source Definition" command palette action for active JS/TS documents with a running matching TS server.
- Kept the pre-existing PHP/Laravel import WIP in `src/application/useWorkbenchController.ts` out of scope and excluded from the intended commit.

### Verification: JS/TS Go To Source Definition

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml typescript_source_definition --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml capability_values_are_normalized --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml runtime_status_serializes_session_id --lib`
- PASS: `npm test -- src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts src/domain/languageServerRuntime.test.ts src/domain/languageServerFeatures.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "source definitions"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/components/languageServerMonacoProviders.test.ts src/components/EditorSurface.test.tsx`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts src/domain/languageServerRuntime.test.ts src/domain/languageServerRuntimeStatusCache.test.ts src/domain/languageServerFeatures.test.ts src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/components/languageServerMonacoProviders.test.ts src/components/EditorSurface.test.tsx`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --quiet -- --test-threads=1`
- PASS: `git diff --check`
- STILL BLOCKED by existing PHP/Laravel WIP: `npm run check`
  - Known failure remains `src/application/useWorkbenchController.ts(188,3): error TS6133: 'phpLaravelModelAccessorTargetFromSource' is declared but its value is never read.`

### Commit Status: JS/TS Go To Source Definition

- Committed and pushed as `a4350cd Add JS TS source definition navigation`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp_features.rs`
  - `src-tauri/src/lsp_session.rs`
  - `src/application/useWorkbenchController.ts` (source-definition hunks only; pre-existing PHP import excluded)
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `src/components/EditorSurface.test.tsx`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/domain/languageServerRuntime.test.ts`
  - `src/domain/languageServerRuntime.ts`
  - `src/domain/languageServerRuntimeStatusCache.test.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.ts`
  - `src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Inlay Hint Payload Filtering

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a44b8b6 Update PHP parity plan status`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Completion resolve, code-action resolve, CodeLens resolve, and document-link resolve already guard and filter JS/TS lazy payloads by workspace root.
- JS/TS inlay hints preserve `data` and label-part `location`, but the backend returned them without filtering and resolved them without an inbound payload guard.
- That left a small cross-project metadata leak risk even though the active workspace/session frontend guard was already present.

### Implementation Choice

- Keep the slice backend-contained in `src-tauri/src/lib.rs`.
- Strip unsafe inlay hint `data` payloads, clear unsafe label-part `location`, and keep visible labels/tooltips intact.
- Reject unsafe inbound inlay hint resolve payloads before sending them to the TypeScript language server.

### Acceptance Criteria

- JS/TS inlay hint responses cannot return `data` payload paths from another workspace.
- JS/TS inlay hint label-part locations outside the current workspace are cleared while labels/tooltips remain visible.
- JS/TS inlay hint resolve rejects inbound unsafe payloads and filters resolved hints.
- Focused Rust tests, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Inlay Hint Payload Filtering

- Added backend inlay hint payload filtering for JS/TS responses.
- Added an inbound JS/TS inlay hint resolve guard for unsafe `data` and label-part locations.
- Preserved visible inlay hint labels and tooltips while stripping unsafe metadata.
- Added Rust coverage for unsafe resolve payload rejection and response payload stripping.

### Verification: JS/TS Inlay Hint Payload Filtering

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_inlay_hint_resolve_guard_rejects_outside_payload_paths --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_response_inlay_hint_filter_strips_outside_payloads --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Inlay Hint Payload Filtering

- Committed and pushed as `b4297ee Filter JS TS inlay hint payloads`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Inlay Hint Label-Part Commands

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b6a7311 Update PHP parity plan status`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Monaco supports command metadata on inlay hint label parts.
- The editor already maps completion, code action, CodeLens, and completion-insert commands through a root-guarded JS/TS command executor.
- Earlier inlay slices intentionally left label-part commands unwired until a guarded design existed; the backend now has inlay payload filtering, so this is the adjacent missing metadata surface.

### Implementation Choice

- Extend the shared language-server inlay label-part model with an optional command.
- Parse, serialize, guard, and filter inlay label-part commands in Rust using the same command payload path guard as completion/code-action/CodeLens commands.
- Map frontend label-part commands through `mockor.javascriptTypeScript.executeLanguageServerCommand`, preserving the existing active-workspace guard.

### Acceptance Criteria

- Safe label-part commands are preserved and mapped to Monaco command payloads.
- Label-part command payloads outside the active workspace are stripped from responses and rejected for resolve.
- Stale label-part commands after a project-tab switch do not execute against the old workspace.
- Focused Rust and provider tests, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Inlay Hint Label-Part Commands

- Added optional inlay hint label-part commands to the shared frontend domain model.
- Rust now parses and serializes label-part commands while keeping existing `value` label-part conversion.
- JS/TS backend inlay hint filtering now strips unsafe label-part commands and rejects unsafe resolve payloads.
- Monaco inlay label parts now map safe commands through the existing root-guarded JS/TS command executor.
- Added provider coverage for command mapping and stale project-tab command suppression.

### Verification: JS/TS Inlay Hint Label-Part Commands

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml inlay_hint --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "maps references, rename edits|stale TypeScript lazy resolves"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Inlay Hint Label-Part Commands

- Committed and pushed as `f56ae6e Enable JS TS inlay label commands`.
- Included files:
  - `src/domain/languageServerFeatures.ts`
  - `src-tauri/src/lsp_features.rs`
  - `src-tauri/src/lib.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Inlay Hint Text Edits

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3e00071 Update PHP parity plan status`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- LSP inlay hints can carry `textEdits` for default hint application.
- Monaco supports inlay hint `textEdits` and applies them through its built-in inlay hint interaction.
- The editor already maps normal formatting/code-action/completion text edits, but inlay hints currently drop this metadata.

### Implementation Choice

- Extend the shared inlay hint model with optional `textEdits`.
- Parse and serialize inlay hint `textEdits` in Rust using the existing `LanguageServerTextEdit` shape.
- Map inlay text edits to Monaco with the existing root-guarded JS/TS inlay provider and shared text-edit mapper.

### Acceptance Criteria

- Safe inlay hint `textEdits` are preserved from LSP parse through Monaco provider output.
- Inlay hint resolve serializes existing `textEdits` back to the language server.
- Stale inlay hint resolve behavior after project-tab switches remains unchanged.
- Focused Rust and provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Inlay Hint Text Edits

- Added optional `textEdits` to the shared JS/TS inlay hint model.
- Rust now parses inlay hint `textEdits` and serializes them for `inlayHint/resolve`.
- Monaco inlay hints now receive mapped text edits through the existing text-edit mapper.
- Added Rust and provider coverage for parse, serialize, and Monaco mapping.

### Verification: JS/TS Inlay Hint Text Edits

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml inlay_hint --lib`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "maps references, rename edits|stale TypeScript lazy resolves"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Inlay Hint Text Edits

- Committed and pushed as `1b45078 Preserve JS TS inlay text edits`.
- Included files:
  - `src/domain/languageServerFeatures.ts`
  - `src-tauri/src/lsp_features.rs`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Linked Editing Null Results

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `cce3973 Update PHP parity plan status`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- LSP `textDocument/linkedEditingRange` may return `null` when the cursor is not on a linked-editable token.
- The backend commands parsed linked editing responses directly as an object, so a valid `null` result became a user-visible error.
- JS/TS light mode should match VS Code behavior here: no linked ranges should simply mean no edit session.

### Implementation Choice

- Add a shared linked-editing response parser in `src-tauri/src/lsp_features.rs`.
- Return `None` for `null`, preserve valid linked ranges, and keep malformed-object errors explicit.
- Reuse the parser from both PHP and JS/TS Tauri commands so the shared LSP surface stays consistent.

### Acceptance Criteria

- `null` linked-editing responses no longer report an error.
- Valid linked-editing ranges still parse with `wordPattern`.
- Malformed linked-editing responses still fail loudly.
- Focused Rust parser test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Linked Editing Null Results

- Added `parse_linked_editing_ranges_result` with explicit `null -> None` handling.
- Wired PHP and JS/TS linked-editing commands through the shared parser.
- Added regression coverage for valid ranges, `null`, and malformed payloads.

### Verification: JS/TS Linked Editing Null Results

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml parses_linked_editing_ranges_and_null_results --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Linked Editing Null Results

- Committed and pushed as `acdaf82 Handle null linked editing ranges`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp_features.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Code-Action Context Payload Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `acdaf82 Handle null linked editing ranges`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS code-action requests forward diagnostics from the editor back to the TypeScript language server.
- Diagnostics can carry opaque `data` payloads from a previous LSP response.
- Other JS/TS lazy payloads are root-guarded, but code-action request context data was not checked before being sent back to the selected runtime.

### Implementation Choice

- Add a backend guard for `LanguageServerCodeActionContext.diagnostics[*].data`.
- Reuse the existing recursive LSP JSON path checker so path-like fields and file URIs follow the same root rules as completion/code-action resolve payloads.
- Apply the guard only to JS/TS code-action requests, preserving existing PHP command behavior.

### Acceptance Criteria

- JS/TS code-action context diagnostic `data` inside the active root is accepted.
- JS/TS code-action context diagnostic `data` with outside absolute paths or outside file URIs is rejected before request routing.
- Existing code-action response filtering remains unchanged.
- Focused Rust guard test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Code-Action Context Payload Guard

- Added `ensure_lsp_code_action_context_payloads_in_workspace`.
- JS/TS code-action requests now reject outside-root diagnostic `data` before calling the runtime.
- Added regression coverage for inside path, outside path, and outside file URI diagnostic payloads.

### Verification: JS/TS Code-Action Context Payload Guard

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_code_action_context_guard_rejects_outside_diagnostic_data --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Code-Action Context Payload Guard

- Committed and pushed as `9db232f Guard JS TS code action diagnostic payloads`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: LSP Diagnostic Payload Isolation

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9db232f Guard JS TS code action diagnostic payloads`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Session diagnostics already reject a primary `textDocument/publishDiagnostics` URI outside the workspace root.
- Individual diagnostics can still carry `relatedInformation` locations and opaque `data` payloads.
- Those nested fields may contain file URIs or path-like metadata from another workspace, which would leak into the frontend diagnostics surface or later code-action requests.

### Implementation Choice

- Replace the primary-URI-only diagnostic check with a diagnostic event sanitizer.
- Keep the whole event only when the primary URI belongs to the session root.
- Drop outside-root related-information entries and clear unsafe diagnostic `data` while preserving the diagnostic itself.
- Reuse the same path-key heuristic as other JS/TS payload guards for diagnostic `data`.

### Acceptance Criteria

- Diagnostics for files outside the session root are still ignored.
- Diagnostics for active-root files keep safe related information and safe `data`.
- Related information outside the session root is removed.
- Diagnostic `data` containing outside-root paths or file URIs is cleared before emit.
- Focused Rust session test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: LSP Diagnostic Payload Isolation

- Added `filter_diagnostic_event_to_workspace` in the LSP session reader path.
- Related diagnostic locations outside the workspace root are removed before events reach the frontend.
- Diagnostic `data` is cleared when it carries outside-root path or file URI payloads.
- Added fake-session coverage for mixed inside/outside related information and safe/unsafe diagnostic metadata.

### Verification: LSP Diagnostic Payload Isolation

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml publish_diagnostics_filters_related_information_and_data_outside_session_root --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: LSP Diagnostic Payload Isolation

- Committed and pushed as `a4fc9a38 Filter LSP diagnostic payload paths`.
- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Lazy Payload Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a4fc9a38 Filter LSP diagnostic payload paths`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS Monaco providers already stored workspace roots on lazy payloads and command-backed edits.
- Same-root TypeScript server restarts can leave old completion, link, code-action, CodeLens, or inlay payloads in Monaco UI.
- Root-only guards allow those stale payloads to resolve or execute against the new session for the same project.

### Implementation Choice

- Capture the active TypeScript runtime `sessionId` in feature/document/workspace-symbol request contexts.
- Store `sessionId` on backed Monaco completion items, document links, code actions, CodeLens, inlay hints, and command payloads.
- Guard lazy resolves, command execution, and in-flight provider responses by both active root and active session.

### Acceptance Criteria

- Lazy payloads created under session 1 do not resolve after the same workspace restarts into session 2.
- Command-backed edits created under session 1 do not execute after same-root restart.
- Existing project-tab switch stale guards remain green.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Lazy Payload Session Guard

- Added `__languageServerSessionId` to JS/TS-backed Monaco payloads.
- Added session-aware active checks for lazy resolves and command execution.
- Provider responses now drop in-flight results if the same root moved to a newer session before the response returns.
- Added regression coverage for same-root TypeScript session restart across completion, document link, code action, CodeLens, inlay hint, and command-backed edit paths.

### Verification: JS/TS Lazy Payload Session Guard

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "same-root session restart|stale TypeScript lazy resolves"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Lazy Payload Session Guard

- Committed and pushed as `bd0a4b7d Guard JS TS lazy payloads by session`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Workspace Edit Repeated URI Merge

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bd0a4b7d Guard JS TS lazy payloads by session`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- LSP workspace edits can include text edits in both `changes` and `documentChanges`.
- A server may also send multiple `documentChanges` entries for the same URI.
- The parser used `BTreeMap::insert`, so later entries replaced earlier edits for the same file, making rename/code-action application partial.

### Implementation Choice

- Add a small append helper for workspace text edits.
- Merge repeated URI entries while preserving parse order.
- Keep file operation parsing unchanged.

### Acceptance Criteria

- Text edits from `changes` and repeated `documentChanges` for the same URI are all preserved.
- Existing workspace edit parsing and file-operation tests remain green.
- Focused Rust parser test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: Workspace Edit Repeated URI Merge

- Workspace edit parsing now appends text edits for repeated URIs instead of overwriting previous entries.
- Added regression coverage for a URI repeated across `changes` and multiple `documentChanges` entries.

### Verification: Workspace Edit Repeated URI Merge

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml parses_workspace_edit_merges_repeated_text_edits_for_same_uri --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Workspace Edit Repeated URI Merge

- Committed and pushed as `2668370d Merge repeated LSP workspace edits`.
- Included files:
  - `src-tauri/src/lsp_features.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Workspace Edit Resource Operations Capability

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2668370d Merge repeated LSP workspace edits`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The backend parses and applies LSP workspace file operations for create, rename, and delete.
- The TypeScript initialize capabilities only advertised `workspaceEdit.documentChanges`.
- If the server does not see `resourceOperations`, it may withhold file-operation edits that the editor can already handle.

### Implementation Choice

- Advertise `workspace.workspaceEdit.resourceOperations` as `["create", "rename", "delete"]` for the TypeScript language-server client.
- Extend the existing TypeScript planner initialize test.

### Acceptance Criteria

- TypeScript initialize request advertises workspace edit create/rename/delete resource operations.
- Existing workspace edit parser/apply behavior remains unchanged.
- Focused Rust planner test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Workspace Edit Resource Operations Capability

- Added workspace edit resource-operation capability advertising for TypeScript language-server initialization.
- Added planner coverage for the advertised `create`, `rename`, and `delete` operations.

### Verification: JS/TS Workspace Edit Resource Operations Capability

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Workspace Edit Resource Operations Capability

- Committed and pushed as `d3449b0b Advertise JS TS workspace edit operations`.
- Included files:
  - `src-tauri/src/lsp.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Watched Files Capability Alignment

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d3449b0b Advertise JS TS workspace edit operations`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The TypeScript initialize request advertised dynamic watched-files registration.
- The session reader currently ignores `client/registerCapability`, and JS/TS file watching is handled by a fixed per-workspace watcher.
- Advertising dynamic registration could make the server expect a registration path the client does not implement.

### Implementation Choice

- Set `workspace.didChangeWatchedFiles.dynamicRegistration` to `false` for the TypeScript client capabilities.
- Keep `relativePatternSupport` advertised because the static watcher path can still represent workspace-relative patterns.
- Update the existing TypeScript initialize planner test.

### Acceptance Criteria

- TypeScript initialize request no longer advertises dynamic watched-file registration.
- Existing JS/TS watcher behavior remains unchanged.
- Focused Rust planner test, serial Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Watched Files Capability Alignment

- Changed the TypeScript client watched-files capability to `dynamicRegistration: false`.
- Updated planner coverage for the aligned capability value.

### Verification: JS/TS Watched Files Capability Alignment

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Watched Files Capability Alignment

- Committed and pushed as `dbdf8f2c Align JS TS watched file capability`.
- Included files:
  - `src-tauri/src/lsp.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS File Structure Command Enablement

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dbdf8f2c Align JS TS watched file capability`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The file-structure controller path already loads JS/TS document symbols through the TypeScript language server.
- The command registry still enabled `editor.fileStructure` only for PHP language-server documents.
- JS/TS users could call the direct controller API in tests, but the actual command palette action stayed disabled.

### Implementation Choice

- Enable `editor.fileStructure` for JS/TS documents only when the active workspace has a running TypeScript service with `documentSymbol` capability.
- Preserve the existing PHP command enablement.
- Convert the existing JS/TS file-structure preview test to use the command path and assert enablement.

### Acceptance Criteria

- `editor.fileStructure` is enabled for an active `.ts` document with running JS/TS `documentSymbol` support.
- Running the command opens the JS/TS file structure and loads document symbols.
- Existing PHP file-structure behavior remains unchanged.
- Focused/full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS File Structure Command Enablement

- Updated `editor.fileStructure` command enablement to include JS/TS documents with a running document-symbol-capable TypeScript service.
- Added preview coverage that runs JS/TS file structure through the command registry.

### Verification: JS/TS File Structure Command Enablement

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "loads JavaScript and TypeScript file structure"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: JS/TS File Structure Command Enablement

- Committed and pushed as `a0dfaba9 Enable JS TS file structure command`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Lazy Resolve Document Sync

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a0dfaba9 Enable JS TS file structure command`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Normal JS/TS Monaco providers flush pending document changes before asking the TypeScript language server.
- Lazy resolve paths for completion items, document links, code actions, code lenses, and inlay hints reused stored LSP payloads without flushing the source document first.
- A project tab or same-root TypeScript session could change while a pending flush was still in flight, allowing stale resolve or command work to run against the wrong active workspace/session.

### Implementation Choice

- Store the source document path on JS/TS language-server backed Monaco payloads.
- Flush that source path before lazy resolve calls and language-server command execution.
- Re-check the active workspace root and TypeScript session after the flush, before calling the LSP or applying workspace edits.
- Preserve the existing stale-payload guards after LSP calls.

### Acceptance Criteria

- Lazy JS/TS completion/code action/document link/code lens/inlay resolve requests flush the source document before reaching the LSP.
- Switching project tabs or TypeScript sessions during that flush drops the lazy resolve/command without calling the stale LSP session.
- Existing JS/TS provider behavior remains unchanged for active payloads.
- Focused provider tests, full provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Lazy Resolve Document Sync

- Added source-path tracking to JS/TS language-server backed Monaco payloads.
- Flushed the source document before lazy completion, document-link, code-action, code-lens, and inlay-hint resolves.
- Flushed the source document before JS/TS language-server command execution.
- Re-checked active workspace root and TypeScript session after the flush before calling the LSP or applying edits.
- Added regression coverage for lazy resolve/command races while switching project tabs during pending flushes.

### Verification: JS/TS Lazy Resolve Document Sync

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "flushes pending document changes before resolving TypeScript completion items|drops TypeScript code action resolves after switching project tabs during document flush|drops TypeScript commands after switching project tabs during document flush|resolves TypeScript completion items through the language server|maps TypeScript completion commands through the guarded language server executor"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Lazy Resolve Document Sync

- Committed and pushed as `5119be34 Flush JS TS lazy resolves before LSP calls`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Navigation Target Open Isolation

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5119be34 Flush JS TS lazy resolves before LSP calls`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS language-server navigation already re-checked the active workspace after document flush and after the LSP response.
- The command still opened the target path and then set reveal/message without re-checking whether the user switched project tabs while the target file was loading.
- The shared `openFile` request token was not invalidated by workspace switches, so an in-flight target open from a previous tab could still update active editor state after a switch.

### Implementation Choice

- Invalidate in-flight `openFile` requests when clearing the active workspace or switching to a different workspace root.
- Add a post-open active-root check in JS/TS language-server navigation before setting reveal target and message.
- Add preview coverage for switching from `/workspace-a` to `/workspace-b` while a JS/TS definition target file read is still pending.

### Acceptance Criteria

- Switching project tabs while a JS/TS LSP navigation target is loading does not reveal or message the stale target.
- In-flight file opens from a previous workspace are invalidated by workspace switch/clear.
- Existing JS/TS definition navigation still opens and reveals targets while the workspace remains active.
- Focused preview tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Navigation Target Open Isolation

- Invalidated in-flight `openFile` requests when clearing the workspace or switching to a different workspace root.
- Added a JS/TS language-server navigation root re-check after target open and before reveal/message updates.
- Added preview coverage for switching project tabs while a JS/TS definition target file is still loading.

### Verification: JS/TS Navigation Target Open Isolation

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "drops stale JavaScript and TypeScript navigation after switching project tabs during target open|opens JavaScript and TypeScript definitions through workbench commands"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Navigation Target Open Isolation

- Committed and pushed as `175a8274 Guard JS TS navigation during tab switches`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Range Semantic Tokens

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `54f3cd01 Record Laravel relation string commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- Existing subagent slots were full, so read-only scans were queued on existing agents and direct implementation continued.
- Backend scan found a later candidate: diagnostic `codeDescription.href` workspace isolation.
- Frontend scan found a later JS/TS candidate: same-root runtime session guard for workbench navigation.
- This slice stayed on range semantic tokens because the TypeScript language server and Monaco both support the missing capability and the gap was concrete end-to-end.

### Why This Slice

- `typescript-language-server` advertises both full and range semantic tokens when the client supports range requests.
- Monaco exposes `registerDocumentRangeSemanticTokensProvider`, but the JS/TS provider registered only the full-document provider.
- The Tauri gateway and Rust request factory exposed only `textDocument/semanticTokens/full`, so viewport/range token refreshes could not use the narrower LSP path.

### Implementation Choice

- Add `rangeSemanticTokens` to the shared language-server feature gateway contract.
- Map default PHP and JS/TS Tauri command names separately, preserving workspace-root request routing.
- Register Monaco document range semantic-token providers for all JS/TS language ids.
- Reuse existing pending document flush, active-root guard, semantic-token legend, and token conversion behavior.
- Advertise `semanticTokens.requests.range: true` in the TypeScript initialize request.
- Add Rust request factory and Tauri commands for `textDocument/semanticTokens/range`.

### Acceptance Criteria

- JS/TS range semantic tokens call the JS/TS gateway with the active root, document path, and converted LSP range.
- In-flight JS/TS range semantic token responses are dropped after a project tab switch.
- TypeScript initialize capabilities advertise range semantic-token support.
- Default and JS/TS Tauri gateway command maps route range semantic tokens to the correct command names.
- Focused provider/gateway tests, TypeScript check, Rust semantic/capability tests, serial Rust lib tests, and `git diff --check` pass.

### Completed Slice: JS/TS Range Semantic Tokens

- Added JS/TS Monaco document range semantic-token registration and stale-root protection.
- Added `rangeSemanticTokens` to the gateway contract and Tauri command maps.
- Added PHP and JS/TS Tauri commands backed by `textDocument/semanticTokens/range`.
- Enabled TypeScript client range semantic-token capability advertising.
- Added frontend, gateway, Rust request factory, and capability coverage.

### Verification: JS/TS Range Semantic Tokens

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "semantic token"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm test -- src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts src/components/EditorSurface.test.tsx src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml semantic_tokens --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml javascript_typescript_workspace_builds_typescript_language_server_plan --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `git diff --check`

### Commit Status: JS/TS Range Semantic Tokens

- Committed and pushed as `66c4b483 Add JS TS range semantic tokens`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `src/domain/languageServerFeatures.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.ts`
  - `src/infrastructure/tauriLanguageServerFeaturesGateway.test.ts`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp.rs`
  - `src-tauri/src/lsp_features.rs`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `src/components/EditorSurface.test.tsx`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Same-Root Navigation Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5e0b8577 Record JS TS range semantic token commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The previous navigation isolation slice guarded project-tab/root switches while JS/TS navigation was in flight.
- The JS/TS navigation command captured the requested root but not the active TypeScript language-server `sessionId`.
- A same-root TypeScript runtime restart during an in-flight definition/source-definition/implementation request could let a stale response open/reveal a target for a dead session.

### Implementation Choice

- Capture the running JS/TS `sessionId` at command start.
- Re-check the active workspace root and current cached JS/TS runtime session after document flush, after the LSP response, after implementation target mapping, and after target open.
- Use a guarded single-implementation target open path for JS/TS so that implementation navigation gets the same session checks as definition/source-definition.
- Suppress stale errors from the old JS/TS session after a same-root restart.

### Acceptance Criteria

- If the same workspace's TypeScript session restarts while a JS/TS definition request is in flight, the stale result is ignored.
- Existing project-tab switch navigation guard still works.
- Existing successful JS/TS definition navigation still opens and reveals the target.
- Focused preview tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Same-Root Navigation Session Guard

- Added same-root JS/TS session checks to guarded workbench navigation.
- Added guarded JS/TS single implementation target opening.
- Added regression coverage for dropping a stale definition response after a same-root TypeScript session restart.

### Verification: JS/TS Same-Root Navigation Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "same-root session restart|switching project tabs during target open|opens JavaScript and TypeScript definitions through workbench commands"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Same-Root Navigation Session Guard

- Committed and pushed as `07fd0a18 Guard JS TS navigation by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Diagnostic Code Description URI Isolation

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0a96e386 Record JS TS navigation session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Diagnostic isolation already filters primary diagnostic URIs, `relatedInformation`, and diagnostic `data` payload paths.
- `diagnostic.codeDescription.href` is another URI-bearing diagnostic field and was emitted untouched.
- A language server could send a `file://` code-description URL outside the session root, leaking a cross-workspace local path through diagnostics.

### Implementation Choice

- Preserve web and other non-file documentation links.
- Clear `codeDescription.href` only when it is a `file://` URI outside the active language-server workspace root.
- Extend the existing diagnostic related-information/data isolation regression test to cover unsafe file href removal and safe HTTPS href preservation.

### Acceptance Criteria

- Diagnostics keep safe HTTPS `codeDescription.href` values.
- Diagnostics drop outside-workspace `file://` code-description href values.
- Existing diagnostic related-info/data filtering behavior remains unchanged.
- Focused diagnostics tests, serial Rust lib tests, and `git diff --check` pass.

### Completed Slice: Diagnostic Code Description URI Isolation

- Added backend diagnostic filtering for outside-workspace `file://` `codeDescription.href` values.
- Added regression coverage for removing unsafe local diagnostic documentation links while preserving safe web links.

### Verification: Diagnostic Code Description URI Isolation

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml publish_diagnostics_filters_related_information_and_data_outside_session_root --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml parses_publish_diagnostics_notification --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `git diff --check`

### Commit Status: Diagnostic Code Description URI Isolation

- Committed and pushed as `9b049395 Filter diagnostic code description file links`.
- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Hierarchy Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5c6f09cb Record diagnostic code description filter commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- A read-only frontend scan identified the same-root session gap in `openCallHierarchy` and `openTypeHierarchy`.
- The backend scan did not need to block this slice because the affected flow is in the workbench command UI.

### Why This Slice

- JS/TS navigation now drops stale same-root TypeScript session results, but hierarchy command views still used root-only guards.
- `openCallHierarchy` and `openTypeHierarchy` each perform multi-step LSP work after the initial command.
- A same-root TypeScript runtime restart during `prepareCallHierarchy`, incoming/outgoing calls, `prepareTypeHierarchy`, or subtype/supertype requests could populate hierarchy UI with stale results from the old session.

### Implementation Choice

- Add a shared controller callback that checks the active workspace root and cached JS/TS runtime `sessionId`.
- Reuse that shared session guard in JS/TS navigation, call hierarchy, and type hierarchy command flows.
- Re-check the session after document flush, after prepare calls, after hierarchy follow-up calls, and before error reporting.
- Add same-root restart regressions for both call hierarchy and type hierarchy.

### Acceptance Criteria

- Same-root TypeScript session restarts drop stale call hierarchy results before incoming/outgoing calls run.
- Same-root TypeScript session restarts drop stale type hierarchy results before supertype/subtype calls run.
- Existing successful call/type hierarchy command flows still work.
- Focused hierarchy tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Hierarchy Same-Root Session Guard

- Added shared JS/TS root + session guard in the workbench controller.
- Applied same-root session checks to JS/TS call hierarchy and type hierarchy command flows.
- Added regression coverage for stale same-root session restarts in both hierarchy views.

### Verification: JS/TS Hierarchy Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "call hierarchy.*same-root session restart|type hierarchy.*same-root session restart|opens JavaScript and TypeScript call hierarchy|opens JavaScript and TypeScript type hierarchy"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Hierarchy Same-Root Session Guard

- Committed and pushed as `3a70ef4a Guard JS TS hierarchy by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Workspace Edit Non-File URI Rejection

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7015f90c Record JS TS hierarchy session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- A read-only backend scan identified that server-initiated workspace edits rejected outside `file://` paths but accepted arbitrary non-file URI schemes.

### Why This Slice

- `workspace/applyEdit` emits server-initiated workspace edit events after validation and acknowledges success/failure to the language server.
- The existing guard rejected outside `file://` targets but treated `untitled:`, `https:`, and other non-file URIs as safe.
- The editor's workspace model applies file-backed edits, so accepting non-file edit targets is inconsistent with root/session isolation and response-side workspace edit filtering.

### Implementation Choice

- Keep general LSP URI guards permissive where web/document links can be valid.
- Add dedicated workspace-edit URI guards that require `file://` and then require the URI path to stay inside the active workspace root.
- Cover both direct Tauri workspace edit guards and server-initiated `workspace/applyEdit` requests.

### Acceptance Criteria

- In-root `file://` workspace edit targets still pass.
- Outside-root `file://` workspace edit targets still fail.
- Non-file workspace edit targets fail before any workspace edit event is emitted.
- Focused workspace edit guard tests, serial Rust lib tests, and `git diff --check` pass.

### Completed Slice: Workspace Edit Non-File URI Rejection

- Added dedicated workspace-edit URI validation for Tauri guards and `workspace/applyEdit`.
- Rejected non-file URI edit targets before acknowledging server-initiated workspace edits.
- Added regression coverage for non-file `changes` keys and file-operation URIs.

### Verification: Workspace Edit Non-File URI Rejection

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_workspace_edit_guard_rejects_paths_outside_workspace_root --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml workspace_apply_edit_requests_reject_paths_outside_workspace --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `git diff --check`

### Commit Status: Workspace Edit Non-File URI Rejection

- Committed and pushed as `ca58e108 Reject non-file workspace edit URIs`.
- Included files:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS File Structure Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `68f08cee Record workspace edit URI guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS navigation and hierarchy command flows now drop stale same-root TypeScript session responses.
- JS/TS file structure still loaded document symbols with only a root check after the async LSP request.
- A same-root TypeScript runtime restart during `documentSymbols` could store stale outline data in the active workspace.

### Implementation Choice

- Reuse the shared workbench JS/TS root + session guard for file-structure document-symbol loads.
- Guard successful outline writes and error reporting by session.
- Keep final loading cleanup root-scoped so stale same-root responses clear the spinner without writing stale outline data.
- Add same-root restart regression coverage for JS/TS file structure.

### Acceptance Criteria

- Same-root TypeScript session restarts drop stale JS/TS file-structure outlines.
- Stale same-root file-structure loads still clear the loading state.
- Existing successful JS/TS file-structure command flow still works.
- Focused file-structure tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS File Structure Same-Root Session Guard

- Applied the shared JS/TS session guard to file-structure document-symbol loads.
- Preserved loading cleanup after stale same-root file-structure responses.
- Added regression coverage for stale JS/TS file-structure results after same-root TypeScript session restart.

### Verification: JS/TS File Structure Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "file structure.*same-root session restart|loads JavaScript and TypeScript file structure"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS File Structure Same-Root Session Guard

- Committed and pushed as `e9e8a7c3 Guard JS TS file structure by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Rename Edit Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a8c9440b Record JS TS file structure session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS navigation, hierarchy, and file-structure flows now drop stale same-root TypeScript session responses.
- File rename still awaited `willRenameFiles` with only root checks before applying import-update workspace edits.
- A same-root TypeScript runtime restart during `willRenameFiles` could allow stale import edits from the old session to touch files before the user's rename continued.

### Implementation Choice

- Capture the running JS/TS `sessionId` before calling `willRenameFiles`.
- Reuse the shared root + session guard before applying returned workspace edits, before reporting `willRenameFiles` errors, and before showing import-update messages.
- Keep the user's actual same-root file rename moving after a stale `willRenameFiles` response; only the stale import edit is dropped.
- Add regression coverage for stale same-root `willRenameFiles` responses.

### Acceptance Criteria

- Same-root TypeScript session restarts drop stale `willRenameFiles` workspace edits.
- The requested file rename still proceeds in the same active workspace.
- The post-rename `didRenameFiles` notification can still go to the current JS/TS service.
- Focused rename tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Rename Edit Same-Root Session Guard

- Added same-root JS/TS session checks around `willRenameFiles` import-edit application.
- Preserved physical file rename behavior after stale same-root import edits.
- Added regression coverage for stale rename edits after same-root TypeScript session restart.

### Verification: JS/TS Rename Edit Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rename edits|asks the JavaScript TypeScript service for import edits|same-root session restart"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Rename Edit Same-Root Session Guard

- Committed and pushed as `387d42e5 Guard JS TS rename edits by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Settings Configuration Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `407e8e48 Record JS TS rename session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice touched the same workbench controller and preview test boundary only.
- Main agent implemented directly because a parallel worker would have targeted the same files and increased conflict risk for a narrow session-guard change.

### Why This Slice

- Settings save notifies the running TypeScript service with `didChangeConfiguration` when JS/TS auto-import, CodeLens, inlay-hint, or validation settings change.
- If the same workspace root restarts the TypeScript runtime while that notification is in flight, a stale reject from the old session could bubble into the global `Settings` error path.
- The expected behavior is to keep real current-session configuration errors visible while dropping stale errors from replaced same-root sessions.

### Implementation Choice

- Capture the running JS/TS `sessionId` before sending `didChangeConfiguration`.
- Reuse the shared active root + session guard before rethrowing configuration notification errors.
- Let stale same-root configuration rejects be ignored so the settings save can continue and show the normal success message.
- Add regression coverage for a pending configuration notification that rejects after session `15` is replaced by session `16` on the same root.

### Acceptance Criteria

- Current-session `didChangeConfiguration` failures still surface as `Settings` errors.
- Same-root stale `didChangeConfiguration` failures after TypeScript session restart are ignored.
- Settings save still persists settings and finishes with `Settings saved.`.
- Focused settings tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Settings Configuration Same-Root Session Guard

- Added a same-root JS/TS session check around settings `didChangeConfiguration` error handling.
- Preserved real current-session settings errors by rethrowing only when the captured session is still active.
- Added regression coverage for stale same-root TypeScript configuration notification errors during settings save.

### Verification: JS/TS Settings Configuration Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "configuration|workspace settings change|same-root session restart"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Settings Configuration Same-Root Session Guard

- Committed and pushed as `84fe55e9 Guard JS TS settings config by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS File Operation Notification Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8284d56e Record JS TS settings config session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is tightly coupled to existing workbench file-operation command tests.
- Main agent implemented directly to avoid multiple workers editing the same controller and preview test file.

### Why This Slice

- Rename import edits and settings configuration now ignore stale same-root TypeScript session errors.
- File-operation notifications still reported `didRenameFiles` and `didChangeWatchedFiles` errors using root-only checks.
- A TypeScript runtime restart while these notifications are in flight could surface stale errors from the replaced same-root session even though the file operation itself completed.

### Implementation Choice

- Capture the running JS/TS `sessionId` before sending `didRenameFiles`.
- Capture the running JS/TS `sessionId` before sending `didChangeWatchedFiles`.
- Reuse the shared active root + session guard before reporting notification errors.
- Keep successful notification and file-operation behavior unchanged.

### Acceptance Criteria

- Same-root stale `didRenameFiles` failures after TypeScript session restart are ignored.
- Same-root stale `didChangeWatchedFiles` failures after TypeScript session restart are ignored.
- Completed file rename/create flows continue after stale notification errors.
- Focused notification tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS File Operation Notification Same-Root Session Guard

- Added same-root JS/TS session checks around `didRenameFiles` error reporting.
- Added same-root JS/TS session checks around `didChangeWatchedFiles` error reporting.
- Added regression coverage for stale same-root TypeScript session errors during file rename and watched-file notifications.

### Verification: JS/TS File Operation Notification Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "did-rename errors|watched-file errors|notifies the JavaScript TypeScript service after rename|notifies the JavaScript TypeScript service when a JS TS file is created"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS File Operation Notification Same-Root Session Guard

- Committed and pushed as `d71efb6b Guard JS TS file notifications by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Document Sync Runtime Session Resync

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fb094738 Record JS TS file notification session guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is inside the workbench controller document-sync lifecycle and its existing preview tests.
- Main agent implemented directly because the discovered gap was a tight integration between runtime status, document-sync refs, and open-document resync.

### Why This Slice

- The JS/TS document-sync effect reset documents when the runtime stopped, but a same-root TypeScript session change from running session A to running session B did not clear sync state.
- That meant open documents could remain marked as synced to the old session and miss `didOpen` for the new session.
- A stale `didOpen` failure from the old session could also delete sync state that already belonged to the new same-root session.

### Implementation Choice

- Track a JS/TS document-sync runtime signature from `root + sessionId`.
- Reset JS/TS document-sync state and re-open visible documents whenever the active runtime signature changes.
- Split the existing session guard into:
  - current session for a root,
  - active current session for UI command flows.
- Guard `didOpen` catch cleanup/reporting so stale old-session failures do not delete current-session sync state.

### Acceptance Criteria

- Same-root TypeScript session restart re-sends `didOpen` for already open JS/TS documents.
- Stale `didOpen` failures from the replaced session do not show JavaScript/TypeScript errors.
- Stale `didOpen` failures from the replaced session do not prevent later `didChange` notifications in the new session.
- Focused document-sync tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Document Sync Runtime Session Resync

- Added JS/TS document-sync runtime signature tracking.
- Reset JS/TS document-sync refs on same-root runtime session changes so open documents sync into the new TypeScript session.
- Added stale-session protection around `didOpen` catch cleanup.
- Added regression coverage proving a stale same-root `didOpen` failure does not break subsequent `didChange` sync in the new session.

### Verification: JS/TS Document Sync Runtime Session Resync

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "did-open failure|does not sync JavaScript and TypeScript documents with a runtime from another project tab"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Document Sync Runtime Session Resync

- Committed and pushed as `d3b5c910 Resync JS TS documents on session change`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Document Sync Error Same-Root Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8ec7a4af Record JS TS document sync session resync commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is a direct follow-up in the same document-sync controller and preview test surface.
- Main agent implemented directly because the guard logic shares the same refs and helper functions as the previous session-resync slice.

### Why This Slice

- Open-document resync on JS/TS session change now works, but pending `didChange`, `didSave`, and `didClose` operations could still reject after a same-root TypeScript session restart.
- Those stale rejects could surface false JavaScript/TypeScript errors even though the current session had already replaced the old one.
- `didClose` also needed the same guard pattern to avoid reporting stale close-sync errors after session replacement.

### Implementation Choice

- Reuse the current-session-for-root guard introduced in the previous document-sync slice.
- Capture the JS/TS `sessionId` before queued `didChange`, `didSave`, and `didClose` operations.
- Suppress errors only when the captured session is no longer current for that root.
- Preserve current-session error reporting for real sync failures.

### Acceptance Criteria

- Same-root stale `didChange` failures after TypeScript session restart are ignored.
- Same-root stale `didSave` failures after TypeScript session restart are ignored while save flow completes.
- Same-root stale `didClose` failures after TypeScript session restart are ignored while close flow completes.
- Focused sync tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Document Sync Error Same-Root Session Guard

- Added same-root session guards around timer-driven JS/TS `didChange` sync errors.
- Added same-root session guards around explicit flush `didChange` errors.
- Added same-root session guards around JS/TS `didSave` and `didClose` errors.
- Added regression coverage for stale same-root `didChange`, `didSave`, and `didClose` failures.

### Verification: JS/TS Document Sync Error Same-Root Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "did-change errors|did-save errors|did-close errors"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Document Sync Error Same-Root Session Guard

- Committed and pushed as `7d494f60 Guard JS TS document sync errors by session`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Diagnostics Explicit Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4f95f2ef Record JS TS document sync error guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is a narrow frontend diagnostic routing guard.
- Main agent implemented directly because the affected code and regression live in one workbench controller test surface.

### Why This Slice

- Backend JS/TS diagnostics normally include `rootPath`, but the frontend type still allowed missing-root diagnostic events.
- A missing-root JS/TS diagnostic was previously assigned to the active workspace root, which is too permissive for multi-project isolation.
- JS/TS diagnostics should only route when the event explicitly names the workspace root that produced them.

### Implementation Choice

- Require `event.rootPath` before applying JS/TS diagnostics.
- Keep PHP diagnostic fallback behavior unchanged.
- Add regression coverage for a same-session JS/TS diagnostic event without `rootPath`.

### Acceptance Criteria

- JS/TS diagnostics with explicit matching root still show in Problems.
- JS/TS diagnostics without explicit root are ignored.
- Focused diagnostics tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Diagnostics Explicit Root Guard

- Tightened JS/TS diagnostic routing to reject missing-root events.
- Added regression coverage proving rootless JS/TS diagnostics do not create Problems notices or diagnostics state.

### Verification: JS/TS Diagnostics Explicit Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "diagnostics without an explicit workspace root|shows JavaScript and TypeScript diagnostics"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Diagnostics Explicit Root Guard

- Committed and pushed as `0ee68c5a Require roots for JS TS diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Provider Event Explicit Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `65cb6f8a Record JS TS diagnostics root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is provider-local and limited to Monaco JS/TS event routing.
- Main agent implemented directly because the affected provider guard and tests are in one file pair.

### Why This Slice

- Backend JS/TS workspace-edit and refresh events normally include `rootPath`, but the frontend event types allowed it to be missing.
- Missing-root provider events were previously accepted when the session id matched, which is too permissive for project-tab isolation.
- Server-initiated edits and refreshes should only affect the active project when the event explicitly names that project root.

### Implementation Choice

- Require `event.rootPath` in JS/TS server-initiated workspace edit activation.
- Require `event.rootPath` in JS/TS provider refresh event activation.
- Extend existing provider tests with rootless events that would have been accepted before the guard.

### Acceptance Criteria

- Rooted active workspace-edit events still apply.
- Rootless workspace-edit events are ignored.
- Rooted active refresh events still notify CodeLens, inlay hints, and semantic tokens.
- Rootless refresh events are ignored.
- Focused provider tests, full provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Provider Event Explicit Root Guard

- Tightened JS/TS workspace-edit event routing to require an explicit workspace root.
- Tightened JS/TS refresh event routing to require an explicit workspace root.
- Added regression coverage for rootless server-initiated workspace edit and refresh events.

### Verification: JS/TS Provider Event Explicit Root Guard

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "server-initiated workspace edits|refreshes CodeLens"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Provider Event Explicit Root Guard

- Committed and pushed as `1d34bc60 Require roots for JS TS provider events`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Provider Event Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c3774758 Record JS TS provider event root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the TypeScript event contract after the provider runtime guard.
- Main agent implemented directly because the change is limited to domain event types and existing provider/infra fixtures.

### Why This Slice

- Provider runtime guards now reject rootless JS/TS workspace-edit and refresh events.
- The shared TypeScript event interfaces still described `rootPath` as optional, which kept the old permissive contract alive for new callers.
- Rooted event types make the isolation boundary explicit at compile time while retaining malformed-event regression coverage with `as any`.

### Implementation Choice

- Make `LanguageServerWorkspaceEditEvent.rootPath` required.
- Make `LanguageServerRefreshEvent.rootPath` required.
- Mark rootless provider regression events as intentionally malformed with `as any`.

### Acceptance Criteria

- Tauri workspace-edit and refresh gateway fixtures still satisfy the rooted event contract.
- Provider rootless-event runtime regressions still pass as malformed input tests.
- Focused provider/infra tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Provider Event Root Contract

- Tightened workspace-edit and refresh event interfaces to require `rootPath`.
- Kept defensive malformed rootless event tests in the provider suite.

### Verification: JS/TS Provider Event Root Contract

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts src/infrastructure/tauriLanguageServerWorkspaceEditGateway.test.ts src/infrastructure/tauriLanguageServerRefreshGateway.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Provider Event Root Contract

- Committed and pushed as `76a5b559 Require roots in JS TS provider event contracts`.
- Included files:
  - `src/domain/languageServerFeatures.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Provider Runtime Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d12bd230 Record JS TS provider event contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is provider-local and follows the explicit-root event work.
- Main agent implemented directly because the change is limited to provider helper logic and its test helper.

### Why This Slice

- JS/TS provider event routing now requires rooted events, but provider request helpers still treated a rootless running runtime status as usable for the active root.
- That fallback could let Monaco providers send requests through a runtime status that was not explicitly tied to the active workspace.
- Provider request, semantic-token legend, workspace-edit, and refresh event helpers should only trust a running status whose `rootPath` matches the active workspace root.

### Implementation Choice

- Require `status.rootPath` in provider runtime lookup.
- Require `status.rootPath` for semantic-token legend selection.
- Require `status.rootPath` in workspace-edit and refresh event session checks.
- Update provider test helper to return rooted runtime statuses by default.
- Add a regression proving completions are not requested from a rootless runtime status.

### Acceptance Criteria

- Rooted matching runtime statuses still enable provider requests.
- Rootless runtime statuses do not enable TypeScript completions.
- Provider event routing still requires matching root and session.
- Full provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Provider Runtime Root Guard

- Tightened provider runtime status checks to require explicit root ownership.
- Updated provider fixtures to model rooted TypeScript runtime status by default.
- Added regression coverage for rootless runtime completion suppression.

### Verification: JS/TS Provider Runtime Root Guard

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "rootless runtime status|requests TypeScript language-server completions"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Provider Runtime Root Guard

- Committed and pushed as `255007c0 Require rooted JS TS provider runtime status`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Diagnostics Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `112b4e3b Record JS TS provider runtime root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the TypeScript diagnostic event contract after the JS/TS runtime guard.
- Main agent implemented directly because the change is limited to domain event types and existing diagnostic fixtures.

### Why This Slice

- JS/TS diagnostic routing now rejects events without an explicit `rootPath`.
- The shared TypeScript diagnostic event interface still described missing roots as valid, which left the old permissive contract available to new callers.
- Rooted diagnostic event types make the workspace boundary explicit at compile time while keeping malformed-event regression coverage with `as any`.

### Implementation Choice

- Make `LanguageServerDiagnosticEvent.rootPath` required.
- Update valid domain, infrastructure, JS/TS, and PHP preview diagnostic fixtures with explicit workspace roots.
- Keep the rootless JS/TS diagnostic regression as intentionally malformed input with `as any`.

### Acceptance Criteria

- Valid diagnostic events now satisfy a rooted event contract.
- Rootless JS/TS diagnostic runtime regression still proves malformed events are ignored.
- Focused diagnostics tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Diagnostics Root Contract

- Tightened the shared diagnostic event interface to require `rootPath`.
- Updated diagnostic fixtures to model rooted events by default.
- Preserved the rootless JS/TS diagnostic regression as a malformed event test.

### Verification: JS/TS Diagnostics Root Contract

- PASS: `npm test -- src/domain/languageServerDiagnostics.test.ts src/infrastructure/tauriLanguageServerDiagnosticsGateway.test.ts src/application/useWorkbenchController.preview.test.tsx -t "diagnostics without an explicit workspace root|shows JavaScript and TypeScript diagnostics|languageServerDiagnostics|TauriLanguageServerDiagnosticsGateway"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test -- src/domain/languageServerDiagnostics.test.ts src/infrastructure/tauriLanguageServerDiagnosticsGateway.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Diagnostics Root Contract

- Committed and pushed as `362d79e2 Require roots in JS TS diagnostic events`.
- Included files:
  - `src/domain/languageServerDiagnostics.ts`
  - `src/domain/languageServerDiagnostics.test.ts`
  - `src/infrastructure/tauriLanguageServerDiagnosticsGateway.test.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Runtime Status Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `580cd457 Record JS TS diagnostic event contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is limited to JS/TS runtime status event routing in the workbench controller.
- Main agent implemented directly because the guard and regression both live in the preview controller surface.

### Why This Slice

- JS/TS provider and diagnostic paths now require explicit workspace roots.
- Runtime status subscription events still fell back to the currently active workspace when `rootPath` was missing.
- A delayed rootless status event after a tab switch could mark the active project as running and trigger document sync for the wrong runtime session.

### Implementation Choice

- Require JS/TS subscription status events to include `rootPath`.
- Preserve direct `start(requestedRoot)` responses by passing the known request root as an explicit fallback.
- Keep PHP runtime status fallback behavior unchanged.
- Add a regression proving rootless JS/TS status events do not unlock document sync, while rooted status events still do.

### Acceptance Criteria

- Rootless JS/TS status events are ignored.
- Rooted JS/TS status events still update the active project and sync open JS/TS documents.
- Restart and autostart paths still handle direct `start(root)` results.
- Focused runtime status tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Runtime Status Root Guard

- Tightened JS/TS runtime status event handling to require explicit root ownership unless a direct caller supplies the request root.
- Added regression coverage for rootless JS/TS runtime status events.
- Preserved rooted status activation and document sync behavior.

### Verification: JS/TS Runtime Status Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "runtime status events without an explicit workspace root|does not sync JavaScript and TypeScript documents with a runtime from another project tab"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Runtime Status Root Guard

- Committed and pushed as `b64f491e Require roots for JS TS runtime status events`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: JS/TS Workspace Edit Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `cf13e83a Record JS TS runtime status root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is provider-local and only tightens JS/TS Monaco workspace-edit helper contracts.
- Main agent implemented directly because all call sites are in `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`.

### Why This Slice

- JS/TS server-initiated edits, command edits, code-action edits, and rename edits all already carry a known workspace root.
- The internal workspace-edit helpers still accepted optional roots, which preserved a fallback where an undefined root could leave edits unfiltered.
- Requiring the root in helper contracts makes cross-workspace edit filtering non-optional.

### Implementation Choice

- Make `JavaScriptTypeScriptWorkspaceEditApplicationContext.rootPath` required.
- Require `rootPath` for JS/TS workspace-edit conversion, file-operation filtering, open-model application, and post-Monaco workspace edit application.
- Remove the no-root fallback that returned unfiltered edits/file operations.

### Acceptance Criteria

- All JS/TS workspace edit call sites still provide an explicit root.
- Cross-root workspace edit filtering remains covered by existing provider tests.
- Focused workspace-edit provider tests, full provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Workspace Edit Root Contract

- Tightened JS/TS workspace-edit helper signatures to require explicit root ownership.
- Removed optional-root fallbacks from workspace edit and file-operation filtering helpers.
- Preserved existing code-action, command, rename, and server-initiated edit behavior.

### Verification: JS/TS Workspace Edit Root Contract

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "workspace edit|code actions|server-initiated workspace edits|file operations"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Workspace Edit Root Contract

- Committed and pushed as `60d14975 Require roots for JS TS workspace edits`.
- Included files:
  - `src/components/javascriptTypescriptLanguageServerMonacoProviders.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`
