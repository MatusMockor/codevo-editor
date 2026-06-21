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

## Next Slice: JS/TS Application Workspace Edit Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fc66380d Record JS TS workspace edit root contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice is limited to the application-side JS/TS workspace edit applier.
- Main agent implemented directly because the affected helper and regression coverage are in the workbench controller preview surface.

### Why This Slice

- The Monaco JS/TS provider now requires workspace edit contexts to carry `rootPath`.
- The application-side applier still accepted `context.rootPath` as optional and fell back to the active workspace.
- That fallback kept a rootless edit application path alive below the provider contract.

### Implementation Choice

- Require `context.rootPath` in `applyJavaScriptTypeScriptLanguageServerWorkspaceEdit`.
- Require roots for open-document workspace edit application and changed-open-path detection.
- Remove optional-root guards that allowed rootless edit filtering to apply broadly.

### Acceptance Criteria

- JS/TS workspace edits without a compile-time root are no longer accepted by the application applier.
- Existing root-filtered open and closed file behavior remains unchanged.
- Focused workspace-edit preview tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: JS/TS Application Workspace Edit Root Contract

- Tightened the workbench JS/TS workspace edit applier context to require `rootPath`.
- Tightened open-document workspace edit helpers to require explicit root filtering.
- Preserved existing workspace edit behavior for rooted command, code-action, server, and rename flows.

### Verification: JS/TS Application Workspace Edit Root Contract

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace edits|workspace edit file operations|reapply JavaScript TypeScript workspace edits|filters JavaScript TypeScript workspace edits"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Application Workspace Edit Root Contract

- Committed and pushed as `f2036f97 Require roots for JS TS application workspace edits`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: PHP Provider Runtime Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4e394b1e Record JS TS application workspace edit root contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice moves the same explicit-root isolation rule into the generic PHP Monaco provider.
- Main agent implemented directly because the affected provider guard and tests are in one file pair.

### Why This Slice

- JS/TS provider runtime checks now require explicit root ownership.
- The PHP Monaco provider still treated a rootless running runtime status as valid for the active workspace root.
- A delayed or malformed rootless PHP runtime status should not enable hover, completion, code actions, selection ranges, or command-backed edits for whatever project tab is active.

### Implementation Choice

- Require `status.rootPath` to match the requested root before enabling PHP Monaco provider requests.
- Require `status.rootPath` to match before executing PHP LSP command-backed edits.
- Update provider test fixtures to model rooted PHP runtime status by default.
- Add a regression proving rootless PHP runtime status does not request hover or flush pending changes.

### Acceptance Criteria

- Rooted matching PHP runtime statuses still enable provider requests.
- Rootless PHP runtime statuses do not enable PHP LSP hover.
- Existing stale-root PHP provider guards keep passing.
- Focused PHP provider tests, full PHP provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: PHP Provider Runtime Root Guard

- Tightened PHP Monaco provider runtime checks to require explicit root ownership.
- Updated provider fixtures to return rooted PHP runtime status by default.
- Added regression coverage for rootless PHP runtime hover suppression.

### Verification: PHP Provider Runtime Root Guard

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "explicit workspace root|another workspace root|flushes pending changes and maps hover responses|maps completion responses|requests LSP code actions|resolves LSP-backed code actions"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Runtime Root Guard

- Committed and pushed as `3b5dfd05 Require rooted PHP provider runtime status`.
- Included files:
  - `src/components/languageServerMonacoProviders.ts`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: PHP Provider Workspace Edit Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7a53ce28 Record PHP provider runtime root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens PHP Monaco provider workspace-edit helpers after the rooted runtime provider guard.
- Main agent implemented directly because the helper signatures and tests are in the PHP provider file pair.

### Why This Slice

- PHP provider command-backed edits and code-action edits already know the workspace root that requested them.
- Internal PHP workspace-edit helpers still accepted an optional root, preserving an unfiltered fallback when root was missing.
- Requiring root for edit conversion and open-model application makes PHP edit filtering non-optional.

### Implementation Choice

- Require `rootPath` for PHP Monaco workspace edit conversion.
- Require `rootPath` for PHP open-model workspace edit application.
- Extend the code-action mapping regression with a neighboring workspace edit that must be filtered out.

### Acceptance Criteria

- PHP code-action workspace edits still map inside-root edits.
- Neighboring workspace edits are filtered from Monaco edits.
- PHP LSP command-backed edits still require an active rooted runtime.
- Focused PHP provider tests, full PHP provider tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: PHP Provider Workspace Edit Root Contract

- Tightened PHP provider workspace-edit helpers to require explicit root ownership.
- Removed optional-root fallbacks from PHP edit conversion and open-model application.
- Added provider regression coverage for filtering a neighboring workspace edit out of Monaco code-action edits.

### Verification: PHP Provider Workspace Edit Root Contract

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "requests LSP code actions and maps edits|resolves LSP-backed code actions|rootless|workspace root"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Workspace Edit Root Contract

- Committed and pushed as `46bca8e5 Require roots for PHP provider workspace edits`.
- Included files:
  - `src/components/languageServerMonacoProviders.ts`
  - `src/components/languageServerMonacoProviders.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: PHP Diagnostics Explicit Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5232d8dd Record PHP provider workspace edit root contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens application-side PHP diagnostic routing.
- Main agent implemented directly because the guard and regression live in the workbench controller preview surface.

### Why This Slice

- The diagnostic event type now requires `rootPath`, and JS/TS diagnostics already reject rootless events.
- The PHP diagnostic handler still fell back to the active workspace when `event.rootPath` was missing.
- Rootless or malformed PHP diagnostics should not be assigned to whichever project tab is active.

### Implementation Choice

- Require `event.rootPath` before applying PHP diagnostics.
- Keep rooted same-workspace diagnostics behavior unchanged.
- Add a malformed rootless PHP diagnostic regression using `as any`.

### Acceptance Criteria

- Rootless PHP diagnostics do not create Problems notices or diagnostics state.
- Rooted JS/TS diagnostics and rootless JS/TS diagnostic regressions still pass.
- Focused diagnostics preview tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: PHP Diagnostics Explicit Root Guard

- Tightened PHP diagnostic routing to reject missing-root events.
- Added regression coverage proving rootless PHP diagnostics are ignored.
- Preserved rooted diagnostic handling for existing PHP and JS/TS paths.

### Verification: PHP Diagnostics Explicit Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP diagnostics without an explicit workspace root|diagnostics without an explicit workspace root|shows JavaScript and TypeScript diagnostics"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Diagnostics Explicit Root Guard

- Committed and pushed as `bc5b3a7f Require roots for PHP diagnostics`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: PHP Runtime Status Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `af84b1e7 Record PHP diagnostics root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens application-side PHP runtime status routing.
- Main agent implemented directly because the status handler, PHP autostart fallback, and preview regression all live in the workbench controller surface.

### Why This Slice

- PHP runtime subscription status still fell back to the active workspace root when `status.rootPath` was missing.
- A malformed rootless PHP `running` event could therefore activate document sync and LSP-backed UI for whichever project tab was active.
- Direct `start(workspaceRoot)` results still need a safe fallback because the caller already knows the root it requested.

### Implementation Choice

- Require PHP runtime status updates to have `status.rootPath` unless a direct caller supplies a known fallback root.
- Pass `workspaceRoot` as the fallback for manual PHP start and PHP IDE autostart.
- Leave subscription events without a fallback so rootless status payloads are ignored.
- Add a preview regression proving rootless PHP runtime status does not open PHP documents into LSP, while rooted status still does.

### Acceptance Criteria

- Rootless PHP runtime status events do not replace the rooted stopped status for the active workspace.
- Rootless PHP runtime status events do not trigger PHP document sync.
- Rooted PHP runtime status events still activate runtime state and document sync.
- PHP IDE autostart still records a running status when `start(workspaceRoot)` resolves.
- Focused preview tests, full preview tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: PHP Runtime Status Root Guard

- Tightened PHP runtime status handling to reject rootless subscription events.
- Preserved manual start and autostart behavior with explicit request-root fallback.
- Added regression coverage for rootless PHP runtime status suppression and rooted status activation.

### Verification: PHP Runtime Status Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|auto-starts PHP IDE services while initial runtime status is still unknown"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Runtime Status Root Guard

- Committed and pushed as `b280bb63 Require roots for PHP runtime status events`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `src/application/useWorkbenchController.preview.test.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: LSP Reader Stop Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5d50c82e Record PHP runtime status root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice closes the backend shutdown reader gap noted near the top of this plan.
- Main agent implemented directly because the guard and fake-process regression both live in `src-tauri/src/lsp_session.rs`.

### Why This Slice

- The LSP reader checked `stop_requested` after parsing and handling `window/*` messages.
- During shutdown, the fake or real process can still have post-handshake messages buffered in stdout after the stop flag is set.
- Those stale post-stop messages should not update runtime logs, route responses, emit diagnostics, emit workspace edits, or acknowledge server requests.

### Implementation Choice

- Check `stop_requested` immediately after reading a post-handshake message and before parsing or handling it.
- Preserve handshake behavior so initialize success/failure still reaches the starter thread.
- Add a regression where the fake killer writes a `window/logMessage` during stop; the stopped session must not append that stale message to the runtime log.

### Acceptance Criteria

- Buffered post-stop `window/logMessage` payloads are ignored.
- Existing buffered post-stop diagnostics and workspace-edit guards keep passing.
- The full `lsp_session` test module and full Rust test suite pass.
- The touched Rust file is rustfmt-clean.

### Completed Slice: LSP Reader Stop Guard

- Added an early post-handshake stop guard to the LSP reader loop.
- Added regression coverage for stale buffered window messages during stop.
- Preserved existing handshake, diagnostics, workspace-edit, request/response, and runtime-log behavior while the session is active.

### Verification: LSP Reader Stop Guard

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml stop_ignores_buffered_window_messages_from_stale_session`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session::tests::`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
- PASS: `rustfmt --edition 2021 --check src-tauri/src/lsp_session.rs`
- PASS: `npm run check`
- PASS: `git diff --check`
- NOTE: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` still reports pre-existing formatting differences in `src-tauri/src/js_ts_file_watcher.rs`, `src-tauri/src/lib.rs`, and `src-tauri/src/lsp.rs`; those files were not changed for this slice.

### Commit Status: LSP Reader Stop Guard

- Committed and pushed as `24f15b94 Ignore stopped LSP reader messages`.
- Included files:
  - `src-tauri/src/lsp_session.rs`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Runtime Gateway Direct Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `077609c2 Record LSP reader stop guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the frontend infrastructure runtime gateway contract.
- Main agent implemented directly because the direct command normalization and tests live in the Tauri runtime gateway file pair.

### Why This Slice

- Direct root-scoped runtime calls already receive a requested workspace root, but the gateway returned backend statuses unchanged.
- Outside Tauri, `getStatus`, `stop`, and `start` also returned rootless statuses, preserving a root fallback burden in the workbench layer.
- Subscription events should remain raw so malformed rootless events continue to be rejected by application/provider root guards.

### Implementation Choice

- Add the requested `rootPath` to direct `getStatus(rootPath)`, `start(rootPath)`, and `stop(rootPath)` results when the returned status lacks one.
- Preserve an explicit backend-provided `rootPath` if it is already present.
- Root browser-development fallback statuses for direct calls.
- Leave `subscribeStatus` payloads untouched.

### Acceptance Criteria

- Direct runtime command results are rooted to the requested workspace when the backend omits `rootPath`.
- Browser-development fallback statuses are rooted to the requested workspace.
- Subscription status events are still delivered exactly as received.
- Runtime-status controller regressions still pass.
- Gateway tests, preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: Runtime Gateway Direct Root Contract

- Rooted direct Tauri runtime gateway results for `getStatus`, `start`, and `stop`.
- Kept subscription payloads raw to preserve malformed-event coverage.
- Updated runtime gateway tests and reran controller runtime-status regressions.

### Verification: Runtime Gateway Direct Root Contract

- PASS: `npm test -- src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|runtime status events without an explicit workspace root|auto-starts PHP IDE services while initial runtime status is still unknown|auto-starts JavaScript and TypeScript service while initial runtime status is still unknown"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Runtime Gateway Direct Root Contract

- Committed and pushed as `df4f6d57 Root direct runtime gateway statuses`.
- Included files:
  - `src/infrastructure/tauriLanguageServerRuntimeGateway.ts`
  - `src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Runtime Status Label Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2ebc8012 Record runtime gateway root contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the UI-facing runtime status label contract.
- Main agent implemented directly because the guard lives in the runtime domain helper and the active labels live in `App.tsx`.

### Why This Slice

- `languageServerStatusBelongsToWorkspace` still treated a rootless runtime status as belonging to a provided workspace root.
- Application and provider guards now reject rootless runtime events, but the UI label helper still preserved the old permissive fallback.
- Runtime labels should only render for the active workspace when the status explicitly belongs to that workspace.

### Implementation Choice

- Keep generic labels unchanged when no workspace root is supplied.
- When a workspace root is supplied, reject runtime statuses that do not carry a `rootPath`.
- Pass the active `workbench.workspaceRoot` into PHP and JavaScript/TypeScript runtime labels in `App.tsx`.

### Acceptance Criteria

- Rootless runtime statuses do not render project-scoped status labels.
- Rooted matching statuses still render labels.
- Rooted mismatching statuses still suppress labels.
- Domain runtime tests, StatusBar tests, focused preview runtime tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: Runtime Status Label Root Guard

- Tightened workspace membership for runtime status labels.
- Rooted the main app's PHP and TS Server label checks to the active workspace.
- Added regression coverage for rootless status-label suppression when a workspace root is provided.

### Verification: Runtime Status Label Root Guard

- PASS: `npm test -- src/domain/languageServerRuntime.test.ts`
- PASS: `npm test -- src/components/StatusBar.test.tsx`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|runtime status events without an explicit workspace root"`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Runtime Status Label Root Guard

- Committed and pushed as `04b9b467 Require roots for runtime status labels`.
- Included files:
  - `src/App.tsx`
  - `src/domain/languageServerRuntime.ts`
  - `src/domain/languageServerRuntime.test.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: Controller Runtime Workspace Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `024a9097 Record runtime status label root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the controller-side runtime workspace helper and PHP document sync effect.
- Main agent implemented directly because the helper and sync effect are both in `src/application/useWorkbenchController.ts`.

### Why This Slice

- `isLanguageServerStatusForWorkspace` still treated a status with no `rootPath` and no tracked `statusRoot` as matching the active workspace.
- PHP document sync only checked `kind === "running"`, unlike the JS/TS sync path that already used the workspace-aware runtime helper.
- A rootless runtime state should not unlock document sync for the active workspace.

### Implementation Choice

- Require either `status.rootPath` or tracked `statusRoot` before a runtime status can belong to a workspace.
- Route PHP document sync through `isRunningLanguageServerForWorkspace`.
- Keep rooted direct statuses and rooted subscription statuses working unchanged.

### Acceptance Criteria

- Rootless runtime state without tracked root no longer belongs to the active workspace.
- PHP document sync only runs for a rooted running status matching the active workspace.
- Existing PHP/JS rootless runtime regressions keep passing.
- Full preview controller tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: Controller Runtime Workspace Root Guard

- Tightened controller runtime workspace matching to require an explicit root source.
- Reused the workspace-aware running-status helper for PHP document sync.
- Preserved rooted runtime startup, autostart, and subscription behavior.

### Verification: Controller Runtime Workspace Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|runtime status events without an explicit workspace root|syncs preview documents with the language server|auto-starts PHP IDE services while initial runtime status is still unknown"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Controller Runtime Workspace Root Guard

- Committed and pushed as `9a2d3e11 Require roots for controller runtime status matching`.
- Included files:
  - `src/application/useWorkbenchController.ts`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: App Runtime Label Workspace Memo Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `7dba706f Record controller runtime root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice closes a UI follow-up from the runtime status label guard.
- Main agent implemented directly because the remaining rootless label call and stale memo dependencies were in `src/App.tsx`.

### Why This Slice

- The main PHP and TS Server labels now pass `workspaceRoot`, but their `useMemo` dependency lists did not include `workbench.workspaceRoot`.
- The toolbar `smartModeSummary` still called `languageServerStatusLabel` without a workspace root, preserving one rootless PHP runtime label path.
- Workspace-tab switches should recompute runtime labels and should not display rootless runtime state as active IDE status.

### Implementation Choice

- Add `workbench.workspaceRoot` to PHP and JS/TS runtime label memo dependencies.
- Pass the actual `workspaceRoot` into `smartModeSummary` instead of a boolean.
- Root the toolbar PHPactor status label with that workspace root.

### Acceptance Criteria

- Runtime labels recompute when the active workspace root changes.
- Toolbar IDE summary does not accept rootless runtime statuses for a workspace.
- Existing status label tests and typecheck pass.

### Completed Slice: App Runtime Label Workspace Memo Guard

- Rooted the toolbar smart-mode runtime label.
- Added workspace root to App runtime label memo dependencies.
- Preserved existing no-workspace, basic, smart-index, untrusted, plan-ready, and setup-needed labels.

### Verification: App Runtime Label Workspace Memo Guard

- PASS: `npm run check`
- PASS: `npm test -- src/components/StatusBar.test.tsx src/domain/languageServerRuntime.test.ts`
- PASS: `git diff --check`

### Commit Status: App Runtime Label Workspace Memo Guard

- Committed and pushed as `a4c2c2ea Root App runtime status labels by workspace`.
- Included files:
  - `src/App.tsx`
  - `docs/superpowers/plans/2026-06-20-js-ts-project-isolation-slice.md`

## Next Slice: LSP Event Sink Explicit Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d2daa173 Record Laravel fluent through named arguments commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens the backend event-sink root contract after the frontend/runtime root guards.
- Main agent implemented directly because the affected code is local to `src-tauri/src/lsp_session.rs`.

### Why This Slice

- Runtime, diagnostics, refresh, and workspace-edit event routing now requires explicit workspace roots at the frontend boundaries.
- The Tauri `AppHandleEventSink` was only constructed through rooted constructors, but internally still stored its root as `Option<String>`.
- That optional helper shape kept a rootless backend event payload path available to future callers.

### Implementation Choice

- Store a required `String` root on `AppHandleEventSink`.
- Make status, diagnostics, refresh, and workspace-edit payload helpers accept `&str` and always write `rootPath`.
- Extend backend regression coverage across all four payload helper surfaces.

### Acceptance Criteria

- Runtime status event payloads always include `rootPath`.
- Diagnostics event payloads always include `rootPath`.
- Refresh and workspace-edit event payloads always include `rootPath`.
- Focused Rust payload tests, Rust lib tests, `rustfmt --check`, `npm run check`, and `git diff --check` pass.

### Completed Slice: LSP Event Sink Explicit Root Contract

- Made the Tauri LSP app event sink root mandatory.
- Removed optional-root branches from backend event payload helpers.
- Added regression coverage for rooted status, diagnostics, refresh, and workspace-edit payloads.

### Verification: LSP Event Sink Explicit Root Contract

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml event_payloads_include_workspace_root --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `rustfmt --check src-tauri/src/lsp_session.rs`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: LSP Event Sink Explicit Root Contract

- Committed and pushed as `374dd226 Require roots for LSP event sink payloads`.

## Next Slice: LSP Direct Status Response Root Contract

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `51e800f6 Record LSP event sink root contract commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Delegation Notes

- This slice tightens root-scoped backend command responses after the event-sink root contract.
- Main agent implemented directly because the change is limited to Tauri command adapters and the existing LSP status payload helper.

### Why This Slice

- Direct frontend gateway calls already root missing backend statuses defensively.
- The Rust `get/start/stop` Tauri commands are root-scoped and know the requested workspace root, but still returned rootless `LanguageServerRuntimeStatus` enum values.
- Returning rooted status JSON from the backend makes the direct command contract match status events and reduces reliance on frontend fallback behavior.

### Implementation Choice

- Export the rooted status payload helper from `lsp_session.rs` for crate-local command adapters.
- Return rooted JSON payloads from PHP and JS/TS `getStatus`, `start`, and `stop` commands.
- Keep `stop_all_*` responses rootless because they are intentionally not scoped to one workspace root.

### Acceptance Criteria

- PHP direct `getStatus`, `start`, and `stop` command responses include `rootPath`.
- JS/TS direct `getStatus`, `start`, and `stop` command responses include `rootPath`.
- Existing status event payloads stay rooted.
- Focused Rust payload tests, Rust lib tests, `npm run check`, and `git diff --check` pass.

### Completed Slice: LSP Direct Status Response Root Contract

- Reused the rooted status payload helper for root-scoped Tauri command responses.
- Changed direct PHP and JS/TS LSP `get/start/stop` command adapters to return rooted JSON.
- Preserved unrooted `stop_all_*` responses for non-root-scoped shutdown commands.

### Verification: LSP Direct Status Response Root Contract

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml event_payloads_include_workspace_root --lib`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
- PASS: `rustfmt --check src-tauri/src/lsp_session.rs`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: LSP Direct Status Response Root Contract

- Committed and pushed as `bdaf85a0 Root direct LSP status command responses`.

## Next Slice: Runtime Gateway Direct Root Strictness

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `09bd1ac9 Record Laravel relation method collection commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Backend direct `get/start/stop` LSP status commands now return rooted payloads.
- The frontend runtime gateway still filled in the requested root when a direct backend response was rootless, which could mask a backend regression and let a rootless `running` status look active for the requested workspace.
- Workspace isolation is stronger if direct runtime responses must carry the requested root explicitly.

### Implementation Choice

- Accept a direct runtime response only when `status.rootPath` matches the requested root.
- Treat rootless or mismatched direct runtime responses as a safe `stopped` status for the requested root.
- Keep browser/outside-Tauri fallback statuses rooted locally.

### Acceptance Criteria

- Direct rootless `running` responses are not converted into active requested-workspace statuses.
- Direct mismatched-root `running` responses are not accepted for the requested workspace.
- Rooted direct responses with the requested root keep working.
- Focused runtime gateway tests, `npm run check`, and `git diff --check` pass.

### Verification: Runtime Gateway Direct Root Strictness

- PASS: `npm test -- src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Runtime Gateway Direct Root Strictness

- Committed as `9e0742a0 Reject rootless direct runtime statuses`.

## Next Slice: JS/TS Autostart Probe Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f65e08b8 Record runtime gateway direct root strictness commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The frontend runtime gateway now rejects rootless direct runtime statuses.
- The workbench JS/TS autostart probe still treated a rootless `getStatus()` result as belonging to the requested root through a local fallback.
- If a future gateway or test double returned rootless `running`, autostart could incorrectly decide the active workspace already had a running TypeScript service.

### Implementation Choice

- Preserve `latestStatusRoot` as `null` when a probe response has no explicit root.
- Use workspace-aware active/crashed status helpers for autostart probe decisions.
- Add preview coverage proving a rootless probe result does not suppress JS/TS autostart.

### Acceptance Criteria

- Rootless JS/TS `getStatus()` probe responses do not suppress autostart.
- Rooted active or crashed statuses for the requested workspace still suppress autostart as before.
- Focused preview tests, `npm run check`, and `git diff --check` pass.

### Verification: JS/TS Autostart Probe Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless JavaScript and TypeScript status probe"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless JavaScript and TypeScript status probe|does not restart a crashed JavaScript"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Autostart Probe Root Guard

- Committed as `62705f69 Guard JS TS autostart probe roots`.

## Next Slice: Controller Direct Runtime Status Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `76eac183 Record JS TS autostart probe root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The runtime gateway rejects unsafe direct runtime responses, and JS/TS autostart now treats rootless probes as rootless.
- The workbench controller still accepted a fallback workspace root in direct status handlers, which meant a future gateway or test double could return a rootless `running` or `crashed` status and have it cached as active for the requested workspace.
- The initial runtime status effects also rooted direct `getStatus()` snapshots locally instead of routing them through the same root guard.

### Implementation Choice

- Derive a fallback root only for rootless `stopped` statuses.
- Require `starting`, `running`, and `crashed` statuses to carry an explicit `rootPath` before the controller caches or displays them.
- Route initial PHP and JS/TS direct `getStatus()` snapshots through the guarded handlers.
- Update default preview test gateways to model the direct gateway contract by returning rooted statuses, while keeping custom rootless gateways for regression coverage.

### Acceptance Criteria

- Rootless JS/TS direct `start()` responses do not become active statuses for the current workspace.
- Rootless direct `getStatus()` snapshots are guarded by the same handler path.
- Safe `stopped` fallbacks still root stop/status cleanup results for the requested workspace.
- Focused preview tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: Controller Direct Runtime Status Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless JavaScript and TypeScript restart response"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless JavaScript and TypeScript status probe|rootless JavaScript and TypeScript restart response"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Controller Direct Runtime Status Root Guard

- Committed as `11bffa0e Guard controller runtime status roots`.

## Next Slice: Controller Stop Runtime Response Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b0e02432 Fix controller runtime root guard plan record`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Direct `start()` and initial `getStatus()` paths now reject rootless or mismatched active runtime responses.
- The controller stop helpers still cached direct `stop()` responses under the requested root without checking whether the returned status explicitly belonged to that root.
- A malformed rootless or mismatched `running` stop response could therefore re-mark PHPactor or the TypeScript server as active for the workspace that was just stopped.

### Implementation Choice

- Normalize direct stop responses through a requested-root guard before caching or displaying them.
- Accept stop responses only when their explicit `rootPath` matches the requested root.
- Convert rootless or mismatched stop responses into a safe `stopped` status for the requested root.
- Add PHP and JS/TS preview regressions for rootless `running` stop responses.

### Acceptance Criteria

- Rootless PHP direct `stop()` responses do not become active statuses for the current workspace.
- Rootless JS/TS direct `stop()` responses do not become active statuses for the current workspace.
- Rooted matching stop responses still cache/display normally.
- Focused stop-response preview tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: Controller Stop Runtime Response Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless .* stop response"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Controller Stop Runtime Response Root Guard

- Committed as `0437289b Guard controller stop runtime roots`.

## Next Slice: PHP Controller Runtime Workspace Gates

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8fd2e20f Record Laravel relation terminal variant commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP runtime direct and subscription handlers now reject rootless or mismatched active statuses before caching them.
- Several downstream PHP controller gates still checked only `languageServerRuntimeStatus.kind`, relying on upstream correctness instead of the same workspace-aware runtime helper used elsewhere.
- Keeping document sync, diagnostics, navigation, readiness, and command enablement behind one workspace-aware runtime check reduces the chance that stale or malformed status state can reactivate PHP IDE features for the wrong workspace.

### Implementation Choice

- Replace PHP `kind === "running"` / `kind !== "running"` checks in controller feature gates with `isRunningLanguageServerForWorkspace(...)`.
- Cover PHP IDE readiness, diagnostics session matching, document `didOpen`, document change scheduling, PHP go-to navigation, and PHP implementation command enablement.
- Use existing rootless PHP runtime, PHP document sync, and PHP implementation preview regressions to verify behavior because rootless active statuses are already blocked at ingress.

### Acceptance Criteria

- PHP document sync and pending changes require a running status rooted to the active workspace.
- PHP diagnostics session matching requires a running status rooted to the diagnostic workspace.
- PHP go-to navigation and implementation command enablement require a running status rooted to the active workspace.
- Focused PHP preview tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Controller Runtime Workspace Gates

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|waits for PHP didOpen|opens implementation targets from an explicit editor position|asks which implementation"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Controller Runtime Workspace Gates

- Committed as `4fbadc07 Gate PHP runtime features by workspace`.

## Next Slice: Workspace Runtime Status Helper Root Fallback

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9edfe71e Record PHP controller runtime gate commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Runtime ingress handlers now require explicit roots for active statuses.
- The shared workspace status helper still allowed a separate `statusRoot` fallback to make rootless `starting`, `running`, or `crashed` statuses look workspace-scoped.
- Keeping that fallback only for safe `stopped` statuses aligns the helper with the direct/runtime handler contract.

### Implementation Choice

- Preserve `status.rootPath` as the primary source of workspace ownership.
- Allow `statusRoot` fallback only when the status is `stopped`.
- Re-run rootless/runtime preview regressions and the full controller preview suite.

### Acceptance Criteria

- Rootless active statuses cannot be treated as belonging to a workspace by the shared helper.
- Rootless stopped statuses can still use the local safe fallback.
- Focused rootless runtime tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: Workspace Runtime Status Helper Root Fallback

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rootless|runtime status events without an explicit workspace root|rootless .* response|PHP runtime"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Workspace Runtime Status Helper Root Fallback

- Committed as `1842d91f Restrict runtime status root fallback`.

## Next Slice: PHP Autostart Direct Status Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ae5c7d1d Record runtime status fallback commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Direct runtime responses are now expected to be rooted, and active rootless responses are rejected before being cached.
- PHP IDE autostart still used the raw `start(workspaceRoot)` response to decide whether startup had completed.
- A malformed rootless or mismatched `running` start response could leave the PHP autostart root marked as already attempted without caching a usable running status, preventing the retry loop from recovering.

### Implementation Choice

- Treat PHP autostart as complete only when the direct start response is `running` for the requested workspace root.
- If a direct start response is active but does not belong to the requested root, clear the autostart root marker and bump the existing retry version.
- Preserve rooted `starting`, rooted `running`, root-scoped crash retry, and non-crash stopped behavior.

### Acceptance Criteria

- Rooted PHP autostart `running` responses still clear retry attempts.
- Rootless or mismatched active PHP autostart responses do not mark startup complete and trigger another autostart attempt.
- Focused PHP autostart preview tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Autostart Direct Status Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP IDE service autostart"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Autostart Direct Status Root Guard

- Committed as `d4a6a98e Guard PHP autostart direct roots`.

## Next Slice: JS/TS Autostart Direct Status Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `62b339a2 Record PHP autostart root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS autostart already rejects rootless status probes and rootless restart responses.
- The direct `start(requestedRoot)` autostart response still flowed into the runtime handler unchanged.
- A malformed rootless or mismatched active `start()` response could be ignored by the handler while leaving the JS/TS autostart marker set, so the workspace would not retry and would not get a usable rooted runtime status.

### Implementation Choice

- Keep rooted direct `start()` responses flowing through the existing runtime handler.
- When direct JS/TS autostart returns an active status that does not explicitly belong to the requested root, clear the autostart marker and pass a safe requested-root `stopped` status through the existing handler.
- Use the resulting state change to let the existing autostart effect retry without adding a separate retry loop.

### Acceptance Criteria

- Rooted JS/TS autostart `running` responses still activate the workspace.
- Rootless active JS/TS autostart responses do not mark the workspace as settled and allow a follow-up rooted `start()` response to activate.
- Focused JS/TS autostart preview tests, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: JS/TS Autostart Direct Status Root Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "JavaScript and TypeScript autostart|rootless JavaScript and TypeScript status probe"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JS/TS Autostart Direct Status Root Guard

- Committed as `bfac47aa Guard JS TS autostart direct roots`.

## Next Slice: PHP Command Runtime Workspace Gates

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `61224970 Record JS TS autostart root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP document sync, diagnostics, navigation, and provider paths already use workspace-aware runtime checks.
- The PHP Start/Stop command enablement and PHP IDE autostart suppression still used raw `isLanguageServerActive(languageServerRuntimeStatus)` or raw `kind === "crashed"` checks.
- Those gates should make the same workspace ownership decision as the rest of the controller, even if stale state from another workspace or malformed test doubles reach the command/autostart surface.

### Implementation Choice

- Gate the Start PHP Language Server command with `isLanguageServerActiveForWorkspace(...)`.
- Gate the Stop PHP Language Server command with `isLanguageServerActiveForWorkspace(...)`.
- Gate PHP autostart suppression with `isLanguageServerActiveForWorkspace(...)` and `isCrashedLanguageServerForWorkspace(...)`.
- Add the PHP runtime status root to the command registry memo dependencies.

### Acceptance Criteria

- PHP Start/Stop command enablement is scoped to the active workspace root.
- PHP autostart is suppressed only by an active or crashed PHP runtime status that belongs to the active workspace root.
- Existing rootless PHP runtime and PHP autostart regressions, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Command Runtime Workspace Gates

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP runtime status events without an explicit workspace root|PHP IDE service autostart|rootless PHP stop response"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Command Runtime Workspace Gates

- Committed as `3e1045b4 Gate PHP runtime commands by workspace`.

## Next Slice: App IDE Activity Runtime Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5eaf9d13 Record PHP command runtime gate commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Runtime labels in `App.tsx` already pass the active workspace root into `languageServerStatusLabel(...)`.
- The status-bar IDE activity state still inspected raw PHP and JS/TS runtime `kind` values without checking whether those statuses belonged to the active workspace.
- A stale, rootless, or mismatched active runtime status should not make the active workspace status bar look active, scanning, or problematic.

### Implementation Choice

- Thread `workspaceRoot` into the App IDE activity helpers.
- Add a small runtime-kind helper that ignores runtime statuses without a matching explicit root when a workspace root is active.
- Export the pure helper for focused unit coverage instead of rendering the full app.

### Acceptance Criteria

- Rootless or mismatched runtime statuses do not drive the active workspace IDE activity state.
- Rooted matching runtime statuses still drive active/scanning/problem status-bar state.
- Focused App/StatusBar tests, `npm run check`, and `git diff --check` pass.

### Verification: App IDE Activity Runtime Root Guard

- PASS: `npm test -- src/App.test.ts`
- PASS: `npm test -- src/App.test.ts src/components/StatusBar.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: App IDE Activity Runtime Root Guard

- Committed as `bdda5240 Root IDE activity runtime state by workspace`.

## Next Slice: EditorSurface JS/TS Defaults Runtime Root Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9ae40b26 Record IDE activity root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `EditorSurface` configures Monaco TypeScript/JavaScript defaults based on whether the managed JS/TS language server is active.
- That decision still checked only `javaScriptTypeScriptLanguageServerRuntimeStatus.kind === "running"`.
- A rootless or stale running status from another workspace should not disable Monaco's built-in JS/TS providers and diagnostics for the active workspace.

### Implementation Choice

- Add a local `EditorSurface` helper that treats the managed JS/TS runtime as active only when it is running and explicitly rooted to the active workspace.
- Include `workspaceRoot` in the Monaco defaults effect dependencies.
- Extend the `EditorSurface` Monaco mock with TypeScript defaults and cover rootless, stale-root, and matching-root runtime status cases.

### Acceptance Criteria

- Rootless or mismatched running JS/TS runtime statuses keep built-in Monaco JS/TS providers and diagnostics enabled for the active workspace.
- Matching rooted running JS/TS runtime status still disables Monaco's built-ins so the managed server owns those features.
- Focused `EditorSurface` and defaults tests, `npm run check`, and `git diff --check` pass.

### Verification: EditorSurface JS/TS Defaults Runtime Root Guard

- PASS: `npm test -- src/components/EditorSurface.test.tsx -t "Monaco JavaScript and TypeScript built-ins"`
- PASS: `npm test -- src/components/EditorSurface.test.tsx src/components/typescriptJavascriptDefaults.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: EditorSurface JS/TS Defaults Runtime Root Guard

- Committed as `5cb6a37f Root JS TS editor defaults by workspace`.

## Next Slice: PHP Provider Code Action Root Guard Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `6f29f386 Record Laravel relation finder variant commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The PHP Monaco provider already requires a running runtime status with an explicit `rootPath` matching the active workspace before LSP-backed provider requests can run.
- Hover, completion, and selection range had direct stale/rootless runtime coverage.
- Code actions use the same shared request gate, but did not have a focused regression proving rootless or mismatched runtime status cannot flush the active document or ask the PHP LSP for actions.

### Implementation Choice

- Add direct PHP code action regressions for a runtime status owned by another workspace root.
- Add direct PHP code action regressions for a rootless running runtime status.
- Keep the slice coverage-only because the existing shared provider guard already enforces the runtime root contract.

### Acceptance Criteria

- Rootless PHP runtime status does not trigger LSP code action requests.
- Mismatched-root PHP runtime status does not trigger LSP code action requests.
- Existing LSP code action mapping, local quickfix behavior, full provider tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Provider Code Action Root Guard Coverage

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "LSP code actions"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Code Action Root Guard Coverage

- Committed as `672d3db2 Cover PHP code action runtime roots`.

## Next Slice: PHP Provider Lazy Code Action Root Guard Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f15c4f84 Record PHP code action root guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP LSP-backed code action requests are now directly covered for rootless and mismatched runtime statuses.
- The same provider also has lazy code action resolve and command-backed edit paths that reuse stored workspace-root payloads.
- Those lazy paths already check the current runtime root before asking the gateway, but did not have direct rootless/mismatched runtime coverage.

### Implementation Choice

- Extend the Monaco test mock so it stores the registered PHP language server command handler.
- Add direct regressions proving rootless and mismatched runtime statuses do not call `resolveCodeAction`.
- Add direct regressions proving rootless and mismatched runtime statuses do not execute command-backed PHP LSP actions.
- Keep the slice coverage-only because the production guard was already in place.

### Acceptance Criteria

- Rootless PHP runtime status does not resolve backed code actions or execute command-backed actions.
- Mismatched-root PHP runtime status does not resolve backed code actions or execute command-backed actions.
- Focused/full PHP provider tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Provider Lazy Code Action Root Guard Coverage

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "resolve or execute PHP code-action commands"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Lazy Code Action Root Guard Coverage

- Committed as `5156e711 Cover PHP lazy code action runtime roots`.

## Next Slice: PHP Provider Completion Rootless Runtime Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5eec9001 Record project morph map completion commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP completion already had direct coverage for a running runtime status owned by another workspace root.
- Hover, code actions, lazy code actions, and selection ranges had rootless runtime guard coverage.
- Completion used the same shared request gate, but did not have a focused regression proving a rootless running PHP runtime cannot flush the active document or ask the PHP LSP for completions.

### Implementation Choice

- Add a rootless PHP completion regression next to the existing mismatched-root completion test.
- Keep local PHP variable completions available while proving no LSP completion request or document flush occurs.
- Keep the slice coverage-only because the shared provider guard already enforces the runtime root contract.

### Acceptance Criteria

- Rootless PHP runtime status does not trigger LSP completion requests.
- Rootless PHP runtime status does not flush pending PHP document changes for completion.
- Local PHP variable completions remain available.
- Focused/full PHP provider tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Provider Completion Rootless Runtime Coverage

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "does not request completion when the PHP runtime status"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Completion Rootless Runtime Coverage

- Committed as `cd7d6431 Cover PHP completion rootless runtime`.

## Next Slice: PHP Provider Selection Range Rootless Runtime Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `660d0270 Record PHP completion rootless runtime commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP selection ranges already had direct coverage for mismatched runtime roots and stale in-flight results after project-tab switches.
- Rootless PHP runtime status should also be rejected before flushing the active document or asking the PHP LSP for selection ranges.
- The production path uses the shared provider request gate, so this locks the same root contract for selection ranges explicitly.

### Implementation Choice

- Add a rootless PHP selection range regression next to the existing mismatched-root selection range test.
- Assert the provider returns `null` without flushing pending document changes and without calling `selectionRanges`.
- Keep the slice coverage-only because the shared provider guard already enforces the runtime root contract.

### Acceptance Criteria

- Rootless PHP runtime status does not trigger LSP selection range requests.
- Rootless PHP runtime status does not flush pending PHP document changes for selection ranges.
- Existing selection range mapping, stale in-flight selection guards, full provider tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Provider Selection Range Rootless Runtime Coverage

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "does not request selection ranges when the PHP runtime status"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Provider Selection Range Rootless Runtime Coverage

- Committed as `a2b82227 Cover PHP selection range rootless runtime`.

## Next Slice: PHP Signature Help Tab Switch Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `112824ae Record PHP selection range rootless runtime commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP signature help is local/controller-backed rather than LSP-backed, so it does not use runtime-root gates.
- It still captures the active PHP document root and must drop delayed results after project-tab switches.
- Existing coverage dropped delayed signature help when no project tab was active, but not when another project tab became active.

### Implementation Choice

- Add a focused regression where signature help starts in `/project`, the active workspace changes to `/other`, and the delayed signature result resolves.
- Assert the stale result returns `null` and does not populate Monaco signature help.
- Keep the slice coverage-only because the provider already checks the stored workspace root after async signature resolution.

### Acceptance Criteria

- Delayed PHP signature help results are ignored after switching to another project tab.
- Existing no-active-project signature guard and signature mapping behavior remains unchanged.
- Focused/full PHP provider tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Signature Help Tab Switch Coverage

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "PHP signature help"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Signature Help Tab Switch Coverage

- Committed as `a5324db8 Cover PHP signature help tab switches`.

## Next Slice: JavaScript TypeScript Hover Definition Tab Switch Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0d019687 Record PHPStan Psalm class-string preview commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{0}: On main: wip macOS release CI`

### Why This Slice

- JS/TS Monaco providers already guard active root/session through shared request helpers.
- Existing stale-result provider tests covered completions, code actions, document links, workspace symbols, selection ranges, lazy resolves, and command edits.
- Hover and definition are core VS Code navigation surfaces with different return shapes, so explicit tab-switch coverage protects the shared guard against regressions.

### Implementation Choice

- Add coverage-only regressions in `src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`.
- Start hover and definition requests in `/project`, switch the active workspace root to `/other`, resolve the stale server result, and assert the provider returns `null`.
- Keep production code unchanged because the shared `isFeatureRequestActive` guard already drops stale results.

### Acceptance Criteria

- In-flight JS/TS hover results are ignored after switching project tabs.
- In-flight JS/TS definition results are ignored after switching project tabs.
- Existing completion tab-switch coverage, full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

### Verification: JavaScript TypeScript Hover Definition Tab Switch Coverage

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "TypeScript hovers after switching|TypeScript definitions after switching|TypeScript completions after switching"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JavaScript TypeScript Hover Definition Tab Switch Coverage

- Committed as `0d613175 Cover JavaScript TypeScript hover definition tab switches`.

## Next Slice: PHP DidClose Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `da182b88 Record JavaScript TypeScript hover definition tab switch commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only explorer audit found that PHP `didClose` failures still reported through the global language-server error path.
- If a PHP document close from `/workspace-a` rejected after switching to `/workspace-b`, the stale error could create a `Language Server` notice in the newly active workspace.
- The sibling JS/TS close path already guards the originating root/session, so PHP should use the same active-workspace contract.

### Implementation Choice

- Capture the PHP runtime session before sending `textDocument/didClose`.
- Ignore close failures when the captured session is no longer current.
- Report close failures through `reportLanguageServerErrorForActiveWorkspaceRoot`.
- Apply the same root/session-aware reporting to the PHP bulk-close path used during workspace cleanup.
- Add a preview regression for a stale PHP `didClose` rejection after switching project tabs.

### Acceptance Criteria

- Stale PHP `didClose` errors do not surface in another active workspace tab.
- Same-root PHP didSave stale-error coverage remains green.
- Existing close/save preview coverage remains green.
- `npm run check` and `git diff --check` pass.

### Verification: PHP DidClose Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP did-close errors after switching|PHP did-save errors after same-root"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "did-close|didClose|closeDocument|closes synced|did-save|didSave"`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP DidClose Active Workspace Guard

- Committed as `89ad8cbe Guard PHP didClose errors by active workspace`.

## Next Slice: JavaScript TypeScript Workspace Symbols Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ebc5c244 Record PHP didClose guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only explorer audit found that Cmd+O JS/TS workspace symbols checked the active root after async results but not the originating TypeScript language-server session.
- A same-root tsserver restart while `workspace/symbol` was in flight could let stale symbols populate class search results or stale errors create notices.
- Existing coverage handled project-tab switches, but not same-root session restarts.

### Implementation Choice

- Capture the JS/TS language-server session id before starting the `workspaceSymbols` request.
- Drop resolved symbols unless the captured session is still active for the requested root.
- Suppress stale workspace-symbol errors after same-root restarts.
- Add preview regressions for stale result and stale error paths after publishing a newer same-root JS/TS runtime session.

### Acceptance Criteria

- Stale JS/TS Cmd+O workspace-symbol results do not populate class-open results after a same-root session restart.
- Stale JS/TS Cmd+O workspace-symbol errors do not create notices after a same-root session restart.
- Existing tab-switch workspace-symbol coverage remains green.
- Focused, broader, full preview controller tests, `npm run check`, and `git diff --check` pass.

### Verification: JavaScript TypeScript Workspace Symbols Session Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace symbol"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace symbol|Cmd\\+O|class search|interfaces in Cmd\\+O"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: JavaScript TypeScript Workspace Symbols Session Guard

- Committed as `821a5733 Guard JavaScript TypeScript workspace symbols by session`.

## Next Slice: JavaScript TypeScript Provider Same-Root Response Coverage

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dd8fb77c Record JavaScript TypeScript workspace symbols guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 828 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only explorer audit noted that provider same-root restart coverage mostly proved completion error handling and lazy resolves.
- Hover, references, and rename already use the shared provider root/session guard, but lacked direct successful-response regressions after same-root session restarts.
- These provider return shapes are distinct: hover payload, reference locations, and rename workspace edits.

### Implementation Choice

- Add a coverage-only JS/TS Monaco provider regression.
- Start each provider request under session 1, switch the active runtime status to session 2 for the same root, resolve the stale server response, and assert the provider returns `null`.
- Keep production code unchanged because `isFeatureRequestActive` already filters stale same-root sessions.

### Acceptance Criteria

- Stale hover responses are ignored after same-root session restart.
- Stale references responses are ignored after same-root session restart.
- Stale rename edits are ignored after same-root session restart.
- Focused/full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

### Verification: JavaScript TypeScript Provider Same-Root Response Coverage

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "same-root session restart"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: JavaScript TypeScript Provider Same-Root Response Coverage

- Committed as `6c0caa84 Cover JavaScript TypeScript provider same-root responses`.

## Next Slice: Runtime Subscription Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e5a9ac35 Record JavaScript TypeScript provider same-root response commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP and JS/TS runtime status subscriptions already ignored status events after effect cleanup.
- Their `subscribeStatus(...).catch(...)` paths still reported errors without checking whether the originating workspace effect was active.
- A delayed subscription rejection from `/workspace-a` after switching to `/workspace-b` could surface as a stale runtime notice in the new workspace.

### Implementation Choice

- Gate PHP runtime subscription failures by the effect `active` flag and current workspace root before reporting.
- Gate JS/TS runtime subscription failures the same way.
- Add the same current-root guard to the JS/TS `getStatus` catch path for symmetry with PHP.
- Add preview regressions for stale PHP and JS/TS runtime subscription rejections after switching workspace tabs.

### Acceptance Criteria

- Stale PHP runtime subscription errors do not create `Language Server` notices after switching workspace tabs.
- Stale JS/TS runtime subscription errors do not create `JavaScript/TypeScript` notices after switching workspace tabs.
- Existing runtime status, document sync, and project-tab tests remain green.
- Focused/broader preview tests, `npm run check`, and `git diff --check` pass.

### Verification: Runtime Subscription Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "runtime subscription errors"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "runtime status|runtime subscription|same-root did-open|session errors scoped|project tab"`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: Runtime Subscription Active Workspace Guard

- Committed as `c33f2b7c Guard runtime subscription errors by active workspace`.

## Next Slice: PHP Autostart Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b5912b6b Record runtime subscription guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only explorer audit found that PHP IDE autostart rejections reported through the global language-server error path.
- If `/workspace-a` was auto-starting PHPactor and rejected after switching to `/workspace-b`, the stale failure could show a `Language Server` notice in the new workspace and schedule a stale retry tick.
- Manual PHP language-server start already had an active-root guard; autostart needed the same contract.

### Implementation Choice

- Keep the autostart root cleanup first so the old workspace is not left stuck as auto-starting.
- After cleanup, ignore rejection handling unless the original workspace root is still active.
- Add a preview regression where `/workspace-a` autostart rejects after switching to `/workspace-b`.

### Acceptance Criteria

- Stale PHP IDE autostart errors do not create notices or messages after switching workspace tabs.
- Existing autostart retry and crash retry behavior remains green while staying on the same workspace.
- Focused/broader preview tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Autostart Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP IDE service autostart"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "autostart|manual PHP language server start|runtime subscription errors|runtime status"`
- PASS: `npm run check`
- PASS: `git diff --check`

### Commit Status: PHP Autostart Active Workspace Guard

- Committed as `fec5f2cc Guard PHP autostart errors by active workspace`.

## Next Slice: Text Search Result Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1043a3db Record PHP autostart guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 832 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only explorer audit found that `openTextSearchResult` ignored the boolean result from `openFile`.
- `openFile` already rejects paths owned by inactive workspace tabs, but the text-search callback still closed the panel and set an `Opened ...` message.
- `openClassSearchResult` already had the correct guard, so text search should mirror that behavior.

### Implementation Choice

- Capture the result of `openFile` in `openTextSearchResult`.
- Return early when the file was not opened.
- Add a preview regression where `/workspace-b` receives a stale text-search result for `/workspace-a`.

### Acceptance Criteria

- Stale text-search results from inactive workspace tabs do not activate the stale file.
- The text-search panel stays open when the stale result is rejected.
- The active workspace message does not claim that the stale result opened.
- Focused/broader/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification: Text Search Result Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "text search|inactive project tabs|stale open file"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "text search|Quick Open|Open Class|open file|inactive project tabs"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: Text Search Result Active Workspace Guard

- Committed as `46059ab1 Guard text search result opens by active workspace`.

## Next Slice: Quick Open Result Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ce9d4c73 Record text search guard commit`
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Quick Open used the same risky callback shape as text search: it awaited `openFile` and closed the panel without checking whether the open succeeded.
- `openFile` already rejects results owned by inactive workspace tabs.
- Quick Open should stay open when a stale inactive-tab result is refused.

### Implementation Choice

- Capture the boolean result from `openFile` in `openSearchResult`.
- Return early when the stale file was not opened.
- Add a preview regression where `/workspace-b` receives a stale Quick Open result for `/workspace-a`.

### Acceptance Criteria

- Stale Quick Open results from inactive workspace tabs do not activate the stale file.
- Quick Open stays open when the stale result is rejected.
- The stale file is not read from disk.
- Focused/broader/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification: Quick Open Result Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Quick Open|text search|inactive project tabs"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Quick Open|text search|Open Class|open file|inactive project tabs|stale open file"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: Quick Open Result Active Workspace Guard

- Committed as `b586f283 Guard Quick Open result opens by active workspace`.

## Next Slice: JavaScript TypeScript Autostart Cleanup Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bea24771 Record Quick Open guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 834 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- JS/TS autostart already guarded stale error reporting by active workspace root.
- If a startup promise resolved or rejected after switching tabs, the old root could remain recorded as auto-starting.
- Returning to that project could then skip a fresh autostart because `autoStartedJavaScriptTypeScriptLanguageServerRootRef` still pointed at the stale root.

### Implementation Choice

- Clear the JS/TS autostart root ref before returning from stale success callbacks.
- Clear the same ref before handling startup failures.
- Keep active-root error reporting as-is.
- Add a preview regression where `/workspace-a` startup rejects after switching to `/workspace-b`, then switching back to `/workspace-a` can start again.

### Acceptance Criteria

- Stale JS/TS autostart failures do not create active-workspace notices after switching tabs.
- Stale JS/TS autostart failures do not leave the original workspace stuck as auto-starting.
- Existing JS/TS autostart probe and runtime lifecycle tests remain green.
- Focused/broader/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification: JavaScript TypeScript Autostart Cleanup Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "JavaScript and TypeScript.*autostart|rootless JavaScript and TypeScript status probe|initial runtime status"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "autostart|runtime status|runtime subscription|JavaScript and TypeScript service"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: JavaScript TypeScript Autostart Cleanup Guard

- Committed as `d3d1dc01 Clear stale JavaScript TypeScript autostart state`.

## Next Slice: PHP Diagnostic Filter Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2079af23 Record JavaScript TypeScript autostart cleanup commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 835 tests)
- Worktree carried the in-progress diagnostic guard edit at slice resume.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP diagnostic application already rejected stale roots and sessions before applying diagnostics.
- The async contextual PHP diagnostic filter still used a generic language-server catch handler.
- If a root-sensitive filter dependency rejected after switching project tabs, the active workspace could receive a stale `Language Server` notice from the previous tab.

### Implementation Choice

- Move the PHP language-server session freshness helper above the diagnostic callback so the diagnostic catch can use it safely.
- Guard diagnostic filter errors by the current workspace root and captured PHP LSP session before reporting.
- Route remaining failures through the active-workspace root-specific language-server reporter.
- Add a preview regression where a stale trait host-method diagnostic search rejects after switching from `/workspace-a` to `/workspace-b`.

### Acceptance Criteria

- Stale PHP diagnostic filter failures do not surface notices in the newly active workspace.
- Active-root PHP diagnostic failures can still report through the existing language-server notice path.
- Existing stale diagnostic traversal and trait host-method guards remain green.
- Focused/broader/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Diagnostic Filter Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale PHP diagnostic filter|stale PHP trait host-method search|stale PHP method hierarchy diagnostic traversal"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "diagnostic|Diagnostics|runtime subscription"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: PHP Diagnostic Filter Active Workspace Guard

- Committed as `54c53d07 Guard PHP diagnostic filter errors by active workspace`.

## Next Slice: Workspace Settings Load Request Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `710038f8 Record PHP diagnostic filter guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 835 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `openWorkspacePath` awaited `settingsGateway.loadWorkspaceSettings(path)` before publishing the active root.
- A stale `/workspace-a` settings load could resolve or reject after `/workspace-b` became active.
- On rejection it could report a stale `Settings` notice into the active workspace; on resolution it could flip the active root back to the old tab.

### Implementation Choice

- Add an `openWorkspaceRequestTokenRef` next to the other request tokens.
- Capture a token at the start of each workspace-open request.
- Abort stale requests after close-document cleanup and after workspace settings load.
- Suppress stale settings-load errors before they reach the global `Settings` reporter.
- Add a preview regression where a pending `/workspace-a` settings load rejects after activating `/workspace-b`.

### Acceptance Criteria

- Stale workspace settings load failures do not create active-workspace `Settings` notices.
- Stale workspace settings load completions cannot overwrite the active workspace root.
- Normal workspace tab activation and settings save/rollback behavior remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Settings Load Request Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace settings load|stale directory load|workspace detection"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace tab|project tab|Settings|workspace settings|status bar|session persistence|directory load"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`
- PASS: `npm test` (64 files, 837 tests)

### Commit Status: Workspace Settings Load Request Guard

- Committed as `760c863d Guard workspace settings load by open request`.

## Next Slice: PHP Method Definition Miss Message Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0b839775 Record workspace settings load guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 837 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- A read-only audit found that `goToPhpMethodCallDefinition` awaited root-sensitive PHP helpers without checking that the original workspace tab was still active.
- The direct target opener already refused stale navigation after a tab switch.
- After that refusal, the outer callback could still set a stale `No typed target found ...` message in the newly active workspace.

### Implementation Choice

- Snapshot the requested workspace root at the start of `goToPhpMethodCallDefinition`.
- Add active-root checks after awaited receiver, direct target, builder model, scope, and dynamic-where resolution.
- Return before setting the miss message when the command belongs to an inactive project tab.
- Extend the existing stale contextual PHP method target regression to assert that no stale miss message appears.

### Acceptance Criteria

- Stale contextual PHP method go-to-definition requests do not open targets from inactive tabs.
- Stale contextual PHP method go-to-definition requests do not set miss messages in the active tab.
- Existing indexed and contextual go-to-definition tests remain green.
- Focused/broader/full preview tests, `npm run check`, and `git diff --check` pass.

### Verification: PHP Method Definition Miss Message Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "contextual PHP method targets|contextual PHP property targets|contextual PHP static method targets|No typed target"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "go to definition|Go to Definition|definition|contextual PHP|indexed go to definition"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `git diff --check`

### Commit Status: PHP Method Definition Miss Message Guard

- Committed as `f3793bbf Guard PHP method definition messages by active workspace`.

## Next Slice: PHP Property Static Definition Miss Message Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `10c14082 Record PHP method definition guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 837 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The previous slice guarded PHP method-call definition miss messages after a workspace tab switch.
- The adjacent member-property and static-method definition callbacks had the same shape: awaited root-sensitive helpers, then set a miss message if no target opened.
- Existing stale navigation tests already covered the target refusal, but did not assert that the active workspace message stayed clean.

### Implementation Choice

- Snapshot the requested workspace root in `goToPhpMemberPropertyDefinition` and `goToPhpStaticMethodCallDefinition`.
- Check active-root freshness after each awaited helper and before setting miss messages.
- Capture target-open booleans explicitly so stale results can return before message publication.
- Extend existing stale property and static dynamic-where target tests with miss-message assertions.

### Acceptance Criteria

- Stale contextual PHP property go-to-definition requests do not set relation miss messages in the active tab.
- Stale static/dynamic-where go-to-definition requests do not set typed-target miss messages in the active tab.
- Existing PHP definition navigation behavior remains green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: PHP Property Static Definition Miss Message Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "contextual PHP method targets|contextual PHP property targets|Laravel dynamic where target candidates|No relation method found|No typed target found"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "go to definition|Go to Definition|definition|contextual PHP|Laravel dynamic where|Laravel model attribute|request method hint"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 837 tests)
- PASS: `git diff --check`

### Commit Status: PHP Property Static Definition Miss Message Guard

- Committed as `aadd08e5 Guard PHP property static definition messages by workspace`.

## Next Slice: Workspace Open Follow-Up Request Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5f27b7bc Record PHP property static definition guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 837 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- The workspace-open request token already stopped stale requests before root publication.
- After root publication, the same `openWorkspacePath` request still awaited app settings persistence, background runtime cleanup, and smart-mode activation.
- If the user switched project tabs during those awaits, the stale request could report `Settings` or `IDE Mode` errors into the new active workspace, or apply the old smart-mode result.

### Implementation Choice

- Reuse `openWorkspaceRequestTokenRef` for the follow-up awaits inside `openWorkspacePath`.
- Drop stale settings/runtime persistence errors before reporting.
- Drop stale smart-mode completions and errors before applying mode state or reporting.
- Add preview regressions for pending workspace-open settings persistence and pending workspace-open smart-mode activation.

### Acceptance Criteria

- Stale workspace-open settings persistence failures do not create active-workspace `Settings` notices.
- Stale workspace-open smart-mode failures do not create active-workspace `IDE Mode` notices.
- Stale workspace-open smart-mode completions do not apply to the newly active workspace.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Open Follow-Up Request Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace-open settings|workspace-open smart mode|workspace settings load|stale smart mode errors|stale directory load"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace tab|project tab|Settings|workspace settings|smart mode|IDE Mode|directory load"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 839 tests)
- PASS: `git diff --check`

### Commit Status: Workspace Open Follow-Up Request Guard

- Committed as `32c040dd Guard workspace open follow-up awaits by request`.

## Next Slice: Rename Success Active Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ef646cd7 Record workspace open follow-up guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 839 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `renameActiveDocument` already guarded stale rename errors and several intermediate awaits by active workspace root.
- After a successful rename, it awaited `refreshDirectory(parentPath)` and then set `Renamed ...`.
- If the user switched project tabs while that refresh was pending, the stale success message could appear in the new workspace.

### Implementation Choice

- Add the missing active-root check immediately after the directory refresh and before the success message.
- Add a preview regression where the parent directory refresh is held after a successful rename, the user switches to `/workspace-b`, and the stale refresh then resolves.

### Acceptance Criteria

- Stale rename errors remain suppressed after switching project tabs.
- Successful stale rename continuations do not publish `Renamed ...` messages into the active workspace.
- Existing create/rename/delete file-operation tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Rename Success Active Workspace Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "stale rename|rename success|did-rename|rename edits"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "rename|create file|create folder|delete|watched files|open file"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 840 tests)
- PASS: `git diff --check`

### Commit Status: Rename Success Active Workspace Guard

- Committed as `6905bd76 Guard rename success by active workspace`.

## Next Slice: Managed PHPactor Install Loading Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3b04ff4d Record rename success guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 840 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Managed PHPactor install completion/error paths already avoided stale messages after project-tab switches.
- The global `installingManagedPhpactor` loading flag was not rooted.
- A pending install from `/workspace-a` could keep `/workspace-b` looking busy, and a stale `finally` could clear a newer install's loading state.

### Implementation Choice

- Track the workspace root that owns the managed PHPactor install.
- Reset the install loading state when opening another workspace.
- Ignore duplicate install requests only for the same owning root.
- Clear the loading state in `finally` only if the finishing request still owns the install root.
- Extend existing managed install stale completion/error tests to assert the loading flag is cleared after switching tabs.

### Acceptance Criteria

- Stale managed PHPactor installs do not keep the newly active workspace in an installing state.
- Stale managed PHPactor completions/errors still do not publish messages or notices into the active workspace.
- PHP language-server plan/start/autostart tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Managed PHPactor Install Loading Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "managed PHPactor install|managed install|PHP language server plan"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "PHP language server|managed PHPactor|manual PHP|PHP autostart|Language Server"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 840 tests)
- PASS: `git diff --check`

### Commit Status: Managed PHPactor Install Loading Guard

- Committed as `335f00ae Guard managed PHPactor install loading by workspace`.

## Next Slice: Workspace Directory Open Continuation Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9185c167 Record managed PHPactor install guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 840 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `openWorkspacePath` used its request token before and during early workspace settings/follow-up awaits.
- A stale workspace open could still continue after `loadDirectory(path)` resolved, even though the user had already switched to another project tab.
- That stale continuation could start trust/detection/session follow-up work for the inactive workspace.

### Implementation Choice

- Reuse `openWorkspaceRequestTokenRef` after the root directory load.
- Return before trust/detection/session continuation when a newer workspace-open request has superseded the current one.
- Add a preview regression where `/workspace-a` directory load resolves after activating `/workspace-b`, and verify `/workspace-a` trust lookup never starts.

### Acceptance Criteria

- Stale workspace root directory completions do not continue the old workspace-open pipeline.
- Existing stale directory error and workspace settings load guards remain green.
- Workspace tab/trust/detection lifecycle tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Directory Open Continuation Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "directory load|workspace opens|workspace settings load|workspace-open"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace tab|project tab|workspace detection|workspace trust|directory load|workspace opens|workspace settings"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 841 tests)
- PASS: `git diff --check`

### Commit Status: Workspace Directory Open Continuation Guard

- Committed as `91542fe4 Guard workspace directory open continuations`.

## Next Slice: Settings Save Continuation Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5e8e8cce Record workspace directory open guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 841 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `saveWorkbenchSettings` already guarded later workspace-settings persistence and final success messages.
- Early awaits, including app-settings persistence, runtime-policy cleanup, and smart-mode resolution, could still continue after switching project tabs.
- The PHP language-server stop path also used the implicit current root instead of the requested settings-save root.

### Implementation Choice

- Check the requested workspace root immediately after app-settings persistence.
- Add active-root checks after runtime policy cleanup and smart-mode resolution.
- Stop the PHP language server with the requested root when settings disable smart mode.
- Add active-root checks after PHP/JS runtime stop, trust refresh, and index transitions before continuing.
- Add a preview regression where app-settings persistence resolves after switching tabs and verify the stale save does not invoke `setMode("fullSmart")`.

### Acceptance Criteria

- Stale settings saves do not continue into smart-mode application for inactive workspaces.
- Stale settings saves do not publish `Settings saved.` into the active workspace.
- Existing settings, IDE mode, runtime policy, and workspace tab tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Settings Save Continuation Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "settings saves|workspace settings save|stale configuration|Settings saved|status bar setting"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Settings|settings|IDE Mode|smart mode|workspace tab|project tab|configuration|runtime policy"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 842 tests)
- PASS: `git diff --check`

### Commit Status: Settings Save Continuation Guard

- Committed as `59d25b98 Guard settings save continuations by workspace`.

## Next Slice: Workspace Trust Toggle Continuation Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `73a2a908 Record settings save continuation guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 842 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Workspace trust toggle already ignored stale `setTrust` errors after tab switches.
- After a successful trust revoke, it stopped the PHP runtime and then refreshed the PHP language-server plan.
- If the user switched tabs while the runtime stop was pending, the stale toggle could still continue into PHP plan work for the inactive workspace.

### Implementation Choice

- Stop the PHP language server using the requested trust-toggle root.
- Check the active workspace root after runtime stop.
- Check the active workspace root after PHP language-server plan refresh.
- Add a preview regression where `/workspace-a` trust revoke blocks on PHP runtime stop, the user switches to `/workspace-b`, and the stale completion must not request a PHP plan for `/workspace-a`.

### Acceptance Criteria

- Stale trust toggles do not continue PHP language-server planning for inactive workspaces.
- Existing stale trust error behavior remains green.
- PHP language-server lifecycle tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Trust Toggle Continuation Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace trust|trust toggles|PHP runtime|workspace detection"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "workspace trust|workspace tab|project tab|PHP language server|Language Server|managed PHPactor|manual PHP"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 843 tests)
- PASS: `git diff --check`

### Commit Status: Workspace Trust Toggle Continuation Guard

- Committed as `af0c8c71 Guard workspace trust toggle continuations`.

## Next Slice: Diagnostics Subscription Cleanup Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `8063061a Record workspace trust toggle guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 843 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP and JS/TS diagnostics gateway subscriptions used cleanup flags for callbacks and dispose registration.
- Their rejection handlers ignored the cleanup/root state.
- A stale diagnostics subscription rejection from a previous project tab could report `Language Server` or `JavaScript/TypeScript` notices into the newly active workspace.

### Implementation Choice

- Guard PHP diagnostics subscription rejection by the effect cleanup flag and captured workspace root.
- Guard JS/TS diagnostics subscription rejection by the effect cleanup flag and captured workspace root.
- Include `workspaceRoot` in both diagnostics subscription effect dependencies.
- Add preview regressions where stale PHP and JS/TS diagnostics subscription promises reject after switching from `/workspace-a` to `/workspace-b`.

### Acceptance Criteria

- Stale diagnostics subscription failures do not set active-workspace messages or notices after project-tab switches.
- Runtime subscription stale guards remain green.
- Existing diagnostic filtering and language-server subscription tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Diagnostics Subscription Cleanup Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "diagnostic subscription|runtime subscription|diagnostics subscription"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "diagnostic|Diagnostics|runtime subscription|subscription|Language Server|JavaScript/TypeScript"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 845 tests)
- PASS: `git diff --check`

### Commit Status: Diagnostics Subscription Cleanup Guard

- Committed as `f0c1d7de Guard diagnostics subscription errors by workspace`.

## Next Slice: Metadata Subscription Cleanup Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `0489345e Record diagnostics subscription guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 845 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Index metadata scan completion subscription used an active flag for events and dispose registration.
- Its rejection handler reported `Index` errors without checking cleanup or active workspace root.
- A stale metadata subscription rejection could surface an `Index` notice after switching project tabs.

### Implementation Choice

- Capture the workspace root for the metadata subscription effect.
- Guard metadata subscription rejections by cleanup state and captured root.
- Add `workspaceRoot` to the effect dependencies.
- Add a preview regression where a pending metadata subscription rejects after switching from `/workspace-a` to `/workspace-b`.

### Acceptance Criteria

- Stale metadata subscription failures do not set active-workspace messages or `Index` notices after project-tab switches.
- Existing metadata clear and index clear stale guards remain green.
- Index/smart-mode/workspace lifecycle tests remain green.
- Focused/broader/full preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Metadata Subscription Cleanup Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "metadata scan|metadata subscription|index clear|Index"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "Index|index|metadata|smart mode|workspace tab|project tab"`
- PASS: `npm run check`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm test` (64 files, 846 tests)
- PASS: `git diff --check`

### Commit Status: Metadata Subscription Cleanup Guard

- Committed as `403d2b1e Guard metadata subscription errors by workspace`.

## Next Slice: Hierarchy Navigation Panel Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `ca5a338f Record metadata subscription guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 846 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `openNavigationTarget` already returns `false` when a row target belongs to an inactive workspace tab.
- Call hierarchy, type hierarchy, and implementation chooser callbacks closed their floating UI before checking that result.
- A stale row/target from another project tab could dismiss the active workspace panel even though the file open was correctly refused.

### Implementation Choice

- Keep the implementation chooser open unless `openNavigationTarget` succeeds.
- Keep call hierarchy and type hierarchy views open unless their row navigation succeeds.
- Add preview regressions where the active `/workspace-b` hierarchy panel receives a stale row pointing at `/workspace-a`.

### Acceptance Criteria

- Stale hierarchy row clicks from inactive project tabs do not read stale files.
- Stale hierarchy row clicks from inactive project tabs do not close the active workspace hierarchy panel.
- Successful hierarchy row and implementation chooser navigation still closes the relevant floating UI.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Hierarchy Navigation Panel Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (314 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 848 tests)
- PASS: `git diff --check`

### Commit Status: Hierarchy Navigation Panel Guard

- Committed as `28e6df7f Guard hierarchy navigation panels by workspace`.

## Next Slice: Navigation History Open Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a02ebe3b Record hierarchy navigation guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 848 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `openNavigationTarget` and direct LSP navigation branches recorded the current location before the target open succeeded.
- A stale row/target from an inactive project tab could be correctly refused by `openFile`, but still leave a fake `navigation.back` entry.
- JS/TS navigation also recorded history before rechecking whether the original LSP session was still active.

### Implementation Choice

- Capture the previous navigation location before opening, but record it only after the open succeeds.
- Apply the same delayed-history write to PHP and JS/TS direct LSP navigation branches.
- Keep JS/TS implementation chooser closure delayed until the single-target open succeeds.
- Extend stale hierarchy and stale JS/TS declaration regressions to assert `navigation.back` stays disabled.

### Acceptance Criteria

- Failed or stale navigation attempts do not mutate navigation history.
- Stale hierarchy row clicks from inactive project tabs do not enable `navigation.back`.
- Stale JS/TS LSP results after a project-tab switch do not enable `navigation.back`.
- Successful navigation still records history so existing back-navigation coverage remains green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Navigation History Open Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (314 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 848 tests)
- PASS: `git diff --check`

### Commit Status: Navigation History Open Guard

- Committed as `ca122aa8 Guard navigation history after stale opens`.

## Next Slice: Invalid Navigation Target Session Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c9d6c8cc Record navigation history guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 848 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP and JS/TS LSP navigation resolved target URIs before rechecking whether the original session/root was still active.
- If a stale LSP response arrived after switching project tabs and contained an invalid URI, the inactive request could set `Could not open ... target.` in the active workspace.
- The stale result was not opening files, but it could still leak user-visible command state.

### Implementation Choice

- Recheck the captured PHP LSP session before converting/reporting the target URI.
- Recheck the captured JS/TS LSP session before converting/reporting the target URI.
- Add stale invalid-target regressions for PHP definition and JS/TS declaration after switching from `/workspace-a` to `/workspace-b`.
- Keep the navigation-history assertions from the previous slice on these stale paths.

### Acceptance Criteria

- Stale invalid PHP LSP targets do not set `Could not open definition target.` after project-tab switches.
- Stale invalid JS/TS LSP targets do not set `Could not open declaration target.` after project-tab switches.
- Stale invalid navigation responses do not enable `navigation.back`.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Invalid Navigation Target Session Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (316 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 850 tests)
- PASS: `git diff --check`

### Commit Status: Invalid Navigation Target Session Guard

- Committed as `be1bcff2 Guard invalid navigation target messages by session`.

## Next Slice: Directory Loading Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `97b5d92f Record invalid navigation target guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 850 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Directory load results/errors were guarded by active workspace root.
- The shared `loadingDirectories` set was not reset when opening or clearing a workspace.
- A pending `/workspace-a` directory load could leave `/workspace-a` marked as loading in the state of `/workspace-b` until the stale promise settled.

### Implementation Choice

- Clear `loadingDirectories` when clearing the active workspace.
- Clear `loadingDirectories` when opening a workspace after cached/fresh workspace state is applied.
- Extend the stale directory-load regression to assert `/workspace-a` is no longer in `loadingDirectories` after switching to `/workspace-b`.

### Acceptance Criteria

- Switching project tabs clears stale directory loading state immediately.
- Stale directory load errors still do not report workspace notices after switches.
- Existing stale workspace-open directory guard remains green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Directory Loading Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (316 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 850 tests)
- PASS: `git diff --check`

### Commit Status: Directory Loading Reset Guard

- Committed as `8e7c9dcb Reset directory loading on workspace switches`.

## Next Slice: JavaScript/TypeScript Outline Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f8fb1a76 Record directory loading reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 850 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP outline cache/loading state was reset on workspace open, but JS/TS file outline cache/loading state was not.
- Closing and reopening a workspace could reuse stale JS/TS file structure data without asking the language server again.
- The leak was visible when reopening the same workspace path after closing the last project tab.

### Implementation Choice

- Clear JS/TS file outline cache and loading paths when clearing the active workspace.
- Clear JS/TS file outline cache and loading paths when opening a workspace.
- Add a close/reopen regression that expects a second `documentSymbols` request and a fresh outline label.

### Acceptance Criteria

- Closing and reopening a workspace reloads JS/TS file structure from the language server.
- JS/TS outline loading state is cleared alongside PHP outline loading state on workspace reset.
- Existing stale file-structure session guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: JavaScript/TypeScript Outline Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: JavaScript/TypeScript Outline Reset Guard

- Committed as `d6ebdfc7 Reset JavaScript TypeScript outlines on workspace close`.

## Next Slice: PHP Workspace Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `4dc6a510 Record JavaScript TypeScript outline reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `openWorkspacePath` reset PHP tree, outline caches, expanded outline paths, and outline loading sets.
- `clearActiveWorkspace` did not reset that PHP workspace state when closing the last project tab.
- Closing the final workspace tab could leave PHP tree/outline state hanging around while no workspace was active.

### Implementation Choice

- Reset PHP tree, expanded PHP tree nodes, and PHP tree loading state on active workspace clear.
- Reset PHP outline caches, inherited outline cache, expanded PHP file paths, outline loading sets, and outline expanded nodes on active workspace clear.
- Extend the last-tab-close regression by loading a PHP tree first, then asserting the tree is empty and not loading after close.

### Acceptance Criteria

- Closing the last project tab clears PHP tree state immediately.
- Closing the last project tab clears PHP outline cache/loading state alongside JS/TS outline cache/loading state.
- Existing runtime disposal and workspace tab close behavior remains green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: PHP Workspace Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: PHP Workspace Clear Reset Guard

- Committed as `5e34f045 Reset PHP workspace state on last tab close`.

## Next Slice: Workspace UI Search Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e663d153 Record PHP workspace clear reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Closing/opening workspace reset panel visibility but left some search query/loading/result state alive.
- Quick Open and Text Search query text could survive closing the last project tab.
- Open workspace reset class-search query/results but did not consistently reset Quick Open/Text Search state.

### Implementation Choice

- Reset Class Open query/loading/results when clearing the active workspace.
- Reset Quick Open query/loading/results when clearing or opening a workspace.
- Reset Text Search query/loading/results when clearing or opening a workspace.
- Extend the last-tab-close regression to seed Quick Open, Class Open, Text Search, and PHP tree state before close, then assert they are cleared.

### Acceptance Criteria

- Closing the last project tab clears search panel open/query/loading state.
- Opening another workspace does not inherit Quick Open or Text Search query/loading/result state.
- PHP tree reset from the previous slice remains covered in the same close regression.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace UI Search Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: Workspace UI Search Reset Guard

- Committed as `2c0d571e Reset workspace UI state on last tab close`.

## Next Slice: Bottom Panel Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `508d847e Record workspace UI reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `clearActiveWorkspace` reset the bottom panel view to Problems but did not hide the bottom panel.
- Closing the last project tab could leave a visible bottom panel from the previous workspace even though no workspace was active.

### Implementation Choice

- Hide the bottom panel when clearing the active workspace.
- Extend the last-tab-close regression to open the terminal panel before closing and assert the panel is hidden afterward.

### Acceptance Criteria

- Closing the last project tab hides the bottom panel.
- Closing the last project tab resets the bottom panel view to Problems.
- Existing workspace UI and PHP state reset assertions remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Bottom Panel Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: Bottom Panel Clear Reset Guard

- Committed as `17df1def Hide bottom panel when clearing workspace`.

## Next Slice: Editor Reveal Target Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `42fca7da Record bottom panel clear reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `editorRevealTarget` was not cleared when opening or clearing a workspace.
- A reveal target from a previous project tab could survive into the next workspace or into the no-workspace state after closing the last tab.

### Implementation Choice

- Clear `editorRevealTarget` when clearing the active workspace.
- Clear `editorRevealTarget` after applying cached/fresh workspace state during workspace open.
- Extend the last-tab-close regression by creating a reveal target through a PHP outline node and asserting it is cleared after close.

### Acceptance Criteria

- Closing the last project tab clears active editor reveal targets.
- Opening another workspace clears stale reveal targets regardless of cached/fresh workspace state.
- Existing navigation/reveal regressions remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Editor Reveal Target Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: Editor Reveal Target Reset Guard

- Committed as `ef9af570 Clear editor reveal target on workspace reset`.

## Next Slice: Transient Message Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5acd89dc Record editor reveal reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Workspace reset cleared panel/search/reveal state but did not clear the transient status/error message.
- A message from the previous project tab could remain visible after closing the last tab or opening another workspace.

### Implementation Choice

- Clear `message` when clearing the active workspace.
- Clear `message` when applying a workspace open reset.
- Extend the last-tab-close regression by seeding a transient command error message and asserting it clears after close.

### Acceptance Criteria

- Closing the last project tab clears transient messages.
- Opening another workspace clears transient messages from the previous workspace.
- Existing stale-message guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Transient Message Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: Transient Message Reset Guard

- Committed as `48551de2 Clear transient message on workspace reset`.

## Next Slice: Workspace Notice Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `25546c01 Record transient message reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `reportError` writes both `message` and a persistent notice.
- The previous transient-message reset cleared `message`, but workspace reset still left old notices visible.
- A notice from a previous project tab could remain after closing the last workspace or opening another workspace.

### Implementation Choice

- Clear `notices` when clearing the active workspace.
- Clear `notices` when applying a workspace open reset.
- Extend the last-tab-close regression to seed an error notice and assert notices are empty after close.

### Acceptance Criteria

- Closing the last project tab clears stale notices.
- Opening another workspace clears notices from the previous workspace.
- Existing stale error/notice guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Notice Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (317 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 851 tests)
- PASS: `git diff --check`

### Commit Status: Workspace Notice Reset Guard

- Committed as `b0bceecb Clear notices on workspace reset`.

## Next Slice: PHP Crash Dedupe Workspace Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `599b0245 Record workspace notice reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 851 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- PHP language-server crash notices were deduplicated through a single global `lastLanguageServerCrashRef`.
- Switching project tabs cleared visible notices, but the crash dedupe ref could still suppress the same crash message in the next workspace.
- A PHP crash in `/workspace-b` could fail to publish a notice if `/workspace-a` crashed with the same text first.

### Implementation Choice

- Reset the PHP crash dedupe ref when clearing the active workspace.
- Reset the PHP crash dedupe ref when opening a workspace.
- Add a regression that publishes the same PHP crash message for `/workspace-a` and `/workspace-b` and expects each active project tab to get its own Language Server notice.

### Acceptance Criteria

- The same PHP crash message is reported once per active project tab.
- Switching project tabs does not carry the previous workspace's PHP crash dedupe state forward.
- Existing stale runtime subscription and crash-notice guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: PHP Crash Dedupe Workspace Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (318 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 852 tests)
- PASS: `git diff --check`

### Commit Status: PHP Crash Dedupe Workspace Reset Guard

- Committed as `6a704fb0 Reset PHP crash dedupe on workspace switches`.

## Next Slice: Workspace Settings Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `fd0df286 Record PHP crash dedupe reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 852 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Closing the last project tab reset `intelligenceMode`, but left `workspaceSettings` and `workspaceSettingsRef` from the closed workspace intact.
- No-workspace UI and subsequent command paths could still observe the previous workspace's settings.

### Implementation Choice

- Reset workspace settings through `applyWorkspaceSettings(defaultWorkspaceSettings())` when clearing the active workspace.
- Extend the last-tab-close regression with non-default workspace settings and assert default settings after close.

### Acceptance Criteria

- Closing the last project tab resets workspace settings state and ref to defaults.
- Intelligence mode, JS/TS validation, and status bar settings no longer leak into the no-workspace state.
- Existing workspace reset assertions remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Workspace Settings Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (318 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 852 tests)
- PASS: `git diff --check`

### Commit Status: Workspace Settings Clear Reset Guard

- Committed as `8f369f44 Reset workspace settings on last tab close`.

## Next Slice: Diagnostics Clear Workspace Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `a3a7fb41 Record workspace settings reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 852 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Opening a workspace cleared PHP and JavaScript/TypeScript diagnostics, but clearing the active workspace did not.
- Closing the last project tab could leave stale PHP or JS/TS diagnostics in the no-workspace controller state.
- That violated the tab-isolation goal because diagnostics are workspace-scoped runtime/LSP output.

### Implementation Choice

- Reuse the existing PHP and JS/TS diagnostic clear helpers from `clearActiveWorkspace`.
- Keep the JavaScript/TypeScript diagnostics root cache reset in the same clear path.
- Add a regression that seeds both PHP and TypeScript diagnostics, closes the only project tab, and asserts the merged diagnostics map is empty.

### Acceptance Criteria

- Closing the last project tab clears PHP diagnostics.
- Closing the last project tab clears JavaScript/TypeScript diagnostics.
- Existing diagnostic switching, stale subscription, and workspace reset guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Diagnostics Clear Workspace Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (319 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 853 tests)
- PASS: `git diff --check`

### Commit Status: Diagnostics Clear Workspace Reset Guard

- Committed as `ab16f338 Clear diagnostics on workspace reset`.

## Next Slice: PHP IDE Readiness Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `3450e964 Record diagnostics reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 853 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `phpIdeReadinessVersion` drives the editor-side PHP completion readiness trigger.
- Opening a workspace reset the PHP readiness dedupe signature and version, but clearing the active workspace did not.
- Closing the last project tab could leave a stale readiness tick/signature in the no-workspace controller state.

### Implementation Choice

- Reset `lastPhpIdeReadinessSignatureRef` when clearing the active workspace.
- Reset `phpIdeReadinessVersion` to `0` in the same clear path.
- Extend the last-tab-close regression to publish an index completion event, observe a PHP IDE readiness tick, close the only project tab, and assert the readiness version resets.

### Acceptance Criteria

- Closing the last project tab clears PHP IDE readiness dedupe state.
- Closing the last project tab resets the public readiness version to `0`.
- Existing workspace reset, PHP runtime, and diagnostic guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: PHP IDE Readiness Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (319 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 853 tests)
- PASS: `git diff --check`

### Commit Status: PHP IDE Readiness Clear Reset Guard

- Committed as `e85d4c42 Reset PHP readiness on workspace clear`.

## Next Slice: Managed PHPactor Install Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `d738932f Record PHP readiness reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 853 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Opening a workspace reset managed PHPactor install root/loading state, but clearing the active workspace did not.
- Closing the last project tab during a pending managed PHPactor install could leave `installingManagedPhpactor` true in the no-workspace state.
- A stale install completion should not repopulate messages or loading state after the workspace is gone.

### Implementation Choice

- Reset `installingManagedPhpactorRootRef` when clearing the active workspace.
- Reset `installingManagedPhpactor` to `false` in the same clear path.
- Add a regression that starts a pending managed PHPactor install, closes the only project tab, resolves the install, and asserts loading/message state stays cleared.

### Acceptance Criteria

- Closing the last project tab clears managed PHPactor install loading state.
- A stale managed install completion after last-tab close does not publish a success message.
- Existing managed install switch guards and workspace reset guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Managed PHPactor Install Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (320 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 854 tests)
- PASS: `git diff --check`

### Commit Status: Managed PHPactor Install Clear Reset Guard

- Committed as `578358f5 Clear managed install state on workspace reset`.

## Next Slice: File Structure Scope Clear Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `dd3aeeea Record managed install reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 854 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Opening a workspace reset File Structure scope to `current`, but clearing the active workspace only closed the panel.
- Closing the last project tab could leave `fileStructureScope` set to `inherited` in no-workspace controller state.
- File Structure scope is workspace/editor UI state and should not survive a full workspace clear.

### Implementation Choice

- Reset `fileStructureScope` to `current` when clearing the active workspace.
- Extend the last-tab-close regression to seed File Structure as open with `inherited` scope and assert both the panel and scope reset after close.

### Acceptance Criteria

- Closing the last project tab closes File Structure.
- Closing the last project tab resets File Structure scope to `current`.
- Existing workspace reset and outline guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: File Structure Scope Clear Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (320 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 854 tests)
- PASS: `git diff --check`

### Commit Status: File Structure Scope Clear Reset Guard

- Committed as `47fcec79 Reset file structure scope on workspace clear`.

## Next Slice: Runtime Status No-Workspace Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `acabbbc6 Record file structure reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 854 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Runtime status handlers rejected mismatched roots only when an active workspace root existed.
- After closing the last project tab, a delayed PHP or JavaScript/TypeScript runtime status event could repopulate runtime state in the no-workspace controller.
- PHP status handling also cached the rooted status before checking whether it still belonged to the active workspace.

### Implementation Choice

- Require PHP runtime status roots to match the current active workspace before caching or publishing state.
- Keep JavaScript/TypeScript background-tab status caching for open tabs, but require a current active root match before publishing active runtime state.
- Add regressions for PHP and JS/TS runtime status events arriving after the last project tab closes.

### Acceptance Criteria

- PHP runtime status events after last-tab close do not repopulate active runtime state.
- JavaScript/TypeScript runtime status events after last-tab close do not repopulate active runtime state.
- Existing rootless status, closed-tab status, and runtime subscription guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Runtime Status No-Workspace Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (322 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 856 tests)
- PASS: `git diff --check`

### Commit Status: Runtime Status No-Workspace Guard

- Committed as `3015bbd0 Guard runtime status after workspace clear`.

## Next Slice: Active Editor Position Workspace Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `27ade8c9 Record runtime no-workspace guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 856 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `activeEditorPositionRef` was not reset when clearing or opening/switching workspaces.
- A new project tab could run navigation before the editor reported a fresh cursor position and accidentally reuse a cursor position from the previous workspace.
- JS/TS and PHP provider commands use this ref when no explicit position is supplied.

### Implementation Choice

- Reset `activeEditorPositionRef` when clearing the active workspace.
- Reset `activeEditorPositionRef` when opening or activating a workspace path.
- Add a JS/TS navigation regression that seeds a cursor position in `/workspace-a`, switches to `/workspace-b`, opens a file without updating the cursor, and asserts go-to-definition does not call the provider.

### Acceptance Criteria

- Closing the last project tab clears the active editor position ref.
- Switching/opening a workspace clears the active editor position ref before provider commands run.
- Existing JS/TS navigation, stale navigation, and provider guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Active Editor Position Workspace Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (323 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 857 tests)
- PASS: `git diff --check`

### Commit Status: Active Editor Position Workspace Reset Guard

- Committed as `57c21895 Reset editor position on workspace changes`.

## Next Slice: Hierarchy Panels Workspace Reset Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `f342f6af Record editor position reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 857 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Call Hierarchy, Type Hierarchy, and implementation chooser state were not reset when clearing or opening workspaces.
- Those panels are populated from workspace-scoped LSP/provider responses.
- Closing the last project tab could leave a stale hierarchy panel visible in no-workspace state.

### Implementation Choice

- Clear implementation chooser, Call Hierarchy, and Type Hierarchy when clearing the active workspace.
- Clear the same panels when opening or activating another workspace.
- Add a JS/TS Call Hierarchy regression that opens a hierarchy view, closes the only project tab, and asserts all navigation overlays are null.

### Acceptance Criteria

- Closing the last project tab clears Call Hierarchy state.
- Workspace clear/open also clears Type Hierarchy and implementation chooser state.
- Existing hierarchy, implementation, and stale navigation guards remain green.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Hierarchy Panels Workspace Reset Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (324 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 858 tests)
- PASS: `git diff --check`

### Commit Status: Hierarchy Panels Workspace Reset Guard

- Committed as `5aef0ed3 Reset hierarchy panels on workspace changes`.

## Next Slice: Pending Workspace Open Tab-Close Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5da94d03 Record hierarchy reset commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 858 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Workspace open requests were token-guarded against newer open requests, but not explicitly tied to the project tab path being opened.
- Closing a project tab while its workspace open flow was still pending could leave that stale flow current by token.
- A stale open flow must not continue into trust/detection/session restoration after the tab is gone.

### Implementation Choice

- Track the workspace path associated with the current open request.
- Treat an open request as current only when both the token and path still match.
- Invalidate a pending open request when closing the project tab for the same root.
- Add a regression that closes the only tab during a pending workspace settings load and asserts stale continuation never reaches workspace detection.

### Acceptance Criteria

- Closing a project tab cancels its pending workspace-open request.
- Resolving the stale settings load after close does not restore the workspace root or tabs.
- Stale workspace detection does not run after the tab was closed.
- Focused preview tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Pending Workspace Open Tab-Close Guard

- PASS: `npm test -- useWorkbenchController.preview.test.tsx` (325 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 859 tests)
- PASS: `git diff --check`

### Commit Status: Pending Workspace Open Tab-Close Guard

- Committed as `cd48cca3 Cancel pending workspace opens on tab close`.

## Next Slice: Active Project Close Pending Open Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `119ea591 Record pending workspace open guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 859 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- `closeWorkspaceTab` removed the active project tab only after async synced-document cleanup, runtime disposal, and settings persistence.
- While that close was pending, `currentWorkspaceRootRef` still pointed at the closing workspace.
- A pending `openFile` read from the closing workspace could finish in that window, pass the active-root guard, and write editor state for a tab the user had already closed.
- The close-driven handoff to the next project tab also used the same workspace-open path as normal tab switching, which could cache the closing workspace's state even though the tab was being removed.

### Implementation Choice

- Invalidate pending editor/file/diff/baseline request tokens immediately after the active project close is confirmed.
- Add an `openWorkspacePath` option to skip caching the previous workspace when the switch is caused by closing that previous workspace.
- Keep normal project-tab activation caching unchanged.
- Add a regression that starts a pending file open in `/workspace-a`, begins closing `/workspace-a`, holds runtime disposal, resolves the file read, and asserts the stale open is canceled before `/workspace-b` activates.

### Acceptance Criteria

- Pending file opens cannot write editor state while the active project tab is closing.
- Closing an active project tab does not re-cache the workspace being removed.
- Normal project-tab activation and cached-state behavior remain unchanged.
- Focused project-tab tests, full preview controller tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: Active Project Close Pending Open Guard

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "pending file opens|open file errors|project tab"` (128 tests)
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx` (326 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 860 tests)
- PASS: `git diff --check`

### Commit Status: Active Project Close Pending Open Guard

- Committed and pushed as `4d0652ef Cancel pending file opens on active tab close`.

### Parallel Audit Queue

- JS/TS P0: symbol rename currently returns a Monaco-only workspace edit; closed-file edits from TypeScript rename are not persisted through the controller/filesystem applier.
- JS/TS P0: versioned `documentChanges` are flattened away, so stale document-version edits can be applied to changed open models.
- PHP/Laravel P0: managed PHPactor orphan cleanup can kill sibling workspace-tab sessions because cleanup targets the shared managed executable too broadly.
- PHP/Laravel P0: PHP diagnostics/runtime status are active-root only and lack JS/TS-style background-tab caching.
- PHP/Laravel P0: PHP LSP command outputs need the same Tauri boundary workspace filtering as JS/TS for locations, edits, commands, and workspace symbols.
- PHP provider P1: Monaco PHP providers need same-root session stamping like JS/TS providers to drop stale hover/completion/code-action results after session restart.

## Next Slice: JavaScript TypeScript Rename Workspace Applier

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `77c0844f Record active close guard commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 860 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Planck's JS/TS audit identified a P0 VS Code parity gap: editor symbol rename returned a Monaco-only workspace edit.
- Monaco can update the active/open model, but closed-file edits from TypeScript rename were not routed through the controller/filesystem applier.
- That means a TypeScript rename touching unopened import consumers could be lost instead of persisted like VS Code.

### Implementation Choice

- Keep the old Monaco WorkspaceEdit fallback when no controller applier is supplied.
- When the controller applier exists, apply the TypeScript rename workspace edit through the same `applyWorkspaceEditWithOpenModels` path used by server/applyEdit and command edits.
- Return an empty Monaco WorkspaceEdit after applying through the guarded applier so Monaco treats rename as handled without applying the same open-model edits twice.
- Add provider coverage for an edit that touches the open model, a closed file in the same root, and a sibling workspace path.

### Acceptance Criteria

- Open-model rename edits still update the open Monaco model.
- Closed-file rename edits are passed to `applyWorkspaceEdit` for filesystem persistence.
- Sibling workspace rename edits are filtered out.
- Existing stale rename, command edit, code action, and workspace edit provider tests remain green.
- Focused provider tests, full provider tests, `npm run check`, full `npm test`, and `git diff --check` pass.

### Verification: JavaScript TypeScript Rename Workspace Applier

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "rename edits|rename requests|workspace applier|workspace edits"` (8 tests)
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts` (61 tests)
- PASS: `npm run check`
- PASS: `npm test` (64 files, 861 tests)
- PASS: `git diff --check`

### Commit Status: JavaScript TypeScript Rename Workspace Applier

- Committed and pushed as `762ee135 Persist TypeScript rename workspace edits`.

## Next Slice: Managed PHPactor Sibling Cleanup Guard

### Checkpoint Before Slice

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `acb02d2e Record TypeScript rename applier commit`
- Full suite checkpoint before this slice:
  - PASS: `npm test` (64 files, 861 tests)
- Worktree was clean at slice start.
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`

### Why This Slice

- Hubble's PHP/Laravel audit identified a P0 workspace-tab isolation bug in managed PHPactor startup.
- Starting managed PHPactor for `/workspace-b` could call orphan cleanup before the registry start.
- The cleanup used a broad `pkill -f "{managed phpactor executable} language-server"` pattern that did not include the workspace root.
- Because all tabs share the same managed PHPactor binary, starting PHPactor in one tab could terminate an already running sibling tab's PHPactor session.

### Implementation Choice

- Make `LanguageServerRegistry::running_roots()` available to runtime code, not just tests.
- Pass the PHP registry's active roots into managed PHPactor cleanup during PHP runtime start.
- Allow broad orphan cleanup only for managed PHPactor commands when no active sibling workspace root exists.
- Preserve cleanup for cold starts where no managed PHPactor root is currently running.
- Add unit coverage for cold-start cleanup, same-root/trailing-slash cleanup, active sibling suppression, and non-managed command suppression.

### Acceptance Criteria

- Starting managed PHPactor for a new workspace does not run broad orphan cleanup while another workspace tab has an active PHP runtime.
- Cold-start orphan cleanup still runs for managed PHPactor when there are no active sibling roots.
- Workspace registry running-root behavior remains unchanged.
- Targeted managed PHPactor tests, registry isolation tests, full Tauri lib tests, targeted rustfmt check, and `git diff --check` pass.

### Verification: Managed PHPactor Sibling Cleanup Guard

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml managed_phpactor --lib` (4 tests)
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml registry_keeps_workspace_sessions_isolated --lib` (1 test)
- PASS: `rustfmt --check src-tauri/src/managed_phpactor.rs`
- PASS: `cargo test --manifest-path src-tauri/Cargo.toml --lib` (306 tests)
- NOTE: broader `rustfmt --check` through `lib.rs` still reports pre-existing unrelated formatting differences in `src-tauri/src/js_ts_file_watcher.rs`, `src-tauri/src/lib.rs`, and `src-tauri/src/lsp.rs`.

### Commit Status: Managed PHPactor Sibling Cleanup Guard

- Committed and pushed as `4431ea11 Guard managed PHPactor cleanup by active roots`.
