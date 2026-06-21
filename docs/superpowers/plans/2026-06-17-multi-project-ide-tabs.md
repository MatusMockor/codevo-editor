# Multi-Project Tabs and Isolated IDE Runtime

## Goal

Make the editor support several open projects in a PhpStorm-like project tab strip, with workspace state, IDE mode, index state, terminal sessions, and language-server processes isolated per project.

The first implementation slice adds persistent project tabs and safe single-active-workspace switching. The full target is a runtime registry where multiple project tabs can have independent IDE engines without cross-talk.

## Current State

- The React workbench is currently a single active workspace controller.
- Workspace settings are already persisted per root path, so IDE mode, auto save, status-bar visibility, and session tabs can be isolated by workspace.
- The terminal backend supports multiple sessions by `sessionId`, and workspace disposal stops sessions rooted in the closed project.
- PHP and JavaScript/TypeScript language-server backends now use `LanguageServerRegistry` wrappers keyed by normalized workspace root. Each registry entry owns a `LanguageServerSupervisor`, so multiple project engines can be alive without sharing stdin, pending requests, status, or diagnostics sinks.
- LSP document sync and feature requests carry `rootPath` through Tauri commands, and backend tests cover routing notifications, requests, watched-file changes, server configuration, and workspace folders to the requested root only.
- Status, diagnostics, refresh, and workspace-edit event payloads include `rootPath`; frontend guards reject diagnostics by root/session/version and apply JS/TS background-tab diagnostics only to open matching tabs.
- Index events include `rootPath`, and workspace disposal cancels only the requested root's index lifecycle.
- Remaining risk is mostly orchestration and QA: proving tab switching, background runtime policy, and close/quit cleanup end-to-end across PHP, JS/TS, index, file watchers, terminals, diagnostics, and feature requests.

## Target Architecture

### Frontend

Use a small Project Tabs layer above the existing workbench:

- `AppSettings.workspaceTabs`: ordered root paths for open project tabs.
- `AppSettings.recentWorkspacePath`: active project path for startup compatibility.
- `ProjectTabs`: presentation-only component.
- `useWorkbenchController.activateWorkspaceTab(path)`: switch active workspace.
- `useWorkbenchController.closeWorkspaceTab(path)`: close a tab, stop active runtime if needed, then select a neighbor.

For the full parallel model, introduce `ProjectWorkbenchHost`:

- Each project tab owns one workbench state object.
- Only the active project renders editor UI.
- Inactive projects keep persisted state, but expensive runtime can be controlled by policy: keep alive, suspend, or stop on background.
- Keyboard handlers must be bound only by the active project.

### Backend

Replace singleton LSP runtime with a workspace-scoped registry:

- `LanguageServerRegistry`
  - `sessions: HashMap<WorkspaceRuntimeId, RunningSession>`
  - `statuses: HashMap<WorkspaceRuntimeId, LanguageServerRuntimeStatus>`
  - `next_session_id: AtomicU64`
- `WorkspaceRuntimeId`
  - canonical root path string for now
  - can later become a stable UUID if symlink support needs stronger identity
- Commands:
  - `get_php_language_server_status(root_path)`
  - `start_php_language_server(root_path)`
  - `stop_php_language_server(root_path)`
  - `stop_all_php_language_servers()`
  - `text_document_*` commands accept `root_path`
  - `text_document_completion/definition/implementation/hover` accept `root_path`
- Events:
  - status event payload includes `rootPath`
  - diagnostics event payload includes `rootPath`

This prevents project A diagnostics, completion, or implementation results from being applied to project B.

## Process Lifecycle Rules

- Opening a project tab must not kill another project unless runtime policy says "single active engine".
- Closing a project tab must stop:
  - that project's language server
  - terminal sessions rooted in that project
  - pending LSP requests
  - document sync queues
  - active file watchers owned by that workspace
- Toggling IDE Mode off for one project must:
  - stop only that project's LSP
  - clear only that project's index
  - leave other project tabs untouched
- App quit and window close must call stop-all for LSP and terminals.
- Stale diagnostics are ignored by both `rootPath` and `sessionId`.

## SOLID and Patterns

- Single Responsibility: UI tabs manage project selection only; runtime registry manages processes only.
- Open/Closed: new language backends can implement the same workspace-scoped runtime gateway without changing UI tab code.
- Liskov Substitution: Tauri and test runtime gateways must obey the same workspace-keyed contract.
- Interface Segregation: split runtime status, document sync, feature requests, and diagnostics into focused gateways.
- Dependency Inversion: `useWorkbenchController` depends on gateway interfaces, not Tauri commands.
- Patterns:
  - Registry for workspace runtime sessions.
  - Strategy for background runtime policy.
  - Facade for language-server features in the frontend.
  - Observer for status/diagnostic/index events.

## Test Plan

### Unit Tests

- Settings:
  - normalize `workspaceTabs`
  - keep `recentWorkspacePath` backward-compatible
  - dedupe and trim tab paths
- Controller:
  - opening a workspace adds one project tab
  - switching tabs stops the active singleton runtime in the first slice
  - switching tabs preserves tab list
  - closing an inactive tab does not change active workspace
  - closing active tab chooses the next neighbor
  - closing last tab stops runtime and clears workspace state
  - dirty active workspace prompts before close
- Runtime domain:
  - status events are accepted only for matching `rootPath`
  - diagnostics are accepted only for matching `rootPath` and `sessionId`
  - stale sessions cannot apply diagnostics

### Rust Tests

- `LanguageServerRegistry` can start two sessions for two roots.
- Starting root B does not terminate root A.
- Stopping root A leaves root B running.
- `stop_all` terminates every child process.
- Dropping the registry terminates every child process.
- Pending requests for a stopped root are rejected.
- Document sync for root A writes only to root A stdin.
- Feature requests route to the correct root.

### Integration Tests

- Open Laravel project A and Node/PHP project B.
- Turn IDE Mode on only for A.
- Switch to B: B shows its own Basic/IDE state, A state is preserved.
- Turn IDE Mode on for B: both roots report separate status.
- Close A: A LSP is killed, B LSP still responds.
- Quit app: no PHPactor, shell, terminal, or watcher child process remains.

### Manual QA

- Open two Laravel projects and verify project tab switching feels like PhpStorm.
- Verify completion for `$request->` comes from the active project only.
- Verify go to implementation does not open a file from the inactive project.
- Verify index status and status bar path belong to the active project.
- Verify closing a project tab with unsaved changes prompts before losing edits.

## Implementation Phases

1. Persistent project tabs with safe single-active-workspace switching.
2. Workspace-scoped LSP gateway types in TypeScript.
3. Rust `LanguageServerRegistry` replacing singleton supervisor state. Completed in code; keep adding regression coverage as leak risks appear.
4. Route document sync and feature requests by root path. Completed in code; continue validating active/background project behavior from the frontend.
5. Route diagnostics and status events by root path. Completed in code for payloads and guards; continue validating UI notice and Problems routing.
6. Per-project runtime policy setting: keep alive, suspend on background, or single active engine.
7. Full manual QA against PhpStorm behavior.

## Progress Log

### Slice: Root-Aware Language Server Diagnostics Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `177bc51c Record Laravel mutation terminal commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Ensure language-server diagnostic events are rejected by workspace root as well as session and document version.

#### Implementation Choice

- Extend `shouldApplyLanguageServerDiagnostics` with an optional current workspace root.
- Compare event and current roots through normalized workspace root keys.
- Pass the active PHP workspace root and JS/TS diagnostic event root through controller call-sites.

#### Acceptance Criteria

- Diagnostics from another workspace root are rejected at the domain guard.
- Existing PHP active-workspace diagnostics and JS/TS background-tab diagnostics still apply correctly.
- Focused/full diagnostics/controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/domain/languageServerDiagnostics.test.ts`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "diagnostics.*workspace|workspace.*diagnostics|ignores PHP diagnostics without an explicit workspace root|caches JavaScript and TypeScript diagnostics for background project tabs|does not sync JavaScript and TypeScript documents with a runtime from another project tab"`
- PASS: `npm test -- src/domain/languageServerDiagnostics.test.ts src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `8548e8b8 Guard diagnostics by workspace root`.

### Slice: Workspace LSP Isolation Plan Reconciliation - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `14093157 Record workspace diagnostics guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Keep the multi-project IDE tabs plan aligned with the current workspace-scoped LSP implementation so future slices target remaining leak risks instead of already-completed singleton work.

#### Implementation Choice

- Update `Current State` to reflect existing `LanguageServerRegistry` wrappers for PHP and JS/TS.
- Record that document sync, feature requests, status, diagnostics, refresh, and workspace-edit events now carry workspace roots.
- Mark registry, root-routed feature requests, and rooted diagnostics/status phases as completed in code while preserving remaining orchestration and QA risks.

#### Acceptance Criteria

- The plan no longer claims PHP LSP is a singleton.
- The plan no longer claims document sync and feature requests are rootless.
- Remaining work is described as orchestration/runtime policy/end-to-end leak validation rather than already-completed registry replacement.
- `git diff --check` passes.

#### Verification

- PASS: inspected `src-tauri/src/lsp_session.rs` for `LanguageServerRegistry`, rooted event payloads, and registry routing tests.
- PASS: inspected `src-tauri/src/lib.rs` call-sites showing `root_path` on document sync and feature commands.
- PASS: `git diff --check`

#### Commit Status

- Committed as `426a1017 Reconcile workspace LSP isolation plan`.

### Slice: Inactive Workspace PHP Document Sync Cleanup - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `340c07a6 Record workspace LSP plan reconciliation commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Close PHP language-server document sync state before disposing an inactive workspace tab runtime.

#### Implementation Choice

- Update the inactive tab close branch to close both PHP and JS/TS synced documents before `disposeWorkspace`.
- Add a controller regression test that opens a PHP document in workspace A, switches to workspace B, then closes inactive workspace A and verifies PHP `didClose` happened before workspace disposal.

#### Acceptance Criteria

- Closing an inactive workspace tab does not dispose a PHP runtime before document sync cleanup.
- JS/TS inactive-tab cleanup remains unchanged.
- Runtime disposal still runs after document sync cleanup.
- Focused/full controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "does not dispose an inactive PHP project runtime before closing synced documents|removes an inactive project tab without changing the active workspace"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `9c276315 Close inactive PHP workspace documents`.

### Slice: Inactive Workspace Runtime Disposal Fallback Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2c61a68a Record inactive PHP workspace document cleanup commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove inactive workspace tab close still falls back to explicit runtime stops when unified workspace disposal fails.

#### Implementation Choice

- Add controller coverage for an inactive tab close where `disposeWorkspace` rejects.
- Verify fallback cleanup stops the PHP language server, JavaScript/TypeScript language server, and terminal sessions for the closed root while keeping the active workspace unchanged.

#### Acceptance Criteria

- `closeWorkspaceTab` keeps the tab close path resilient when the workspace runtime disposal gateway rejects.
- The fallback targets only the closed inactive root.
- The active workspace tab remains selected.
- Focused/full controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "falls back to explicit runtime stops when inactive project disposal fails|removes an inactive project tab without changing the active workspace"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `7725b2e5 Cover inactive workspace disposal fallback`.

### Slice: Active Workspace Runtime Disposal Fallback Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `49ce46e2 Record inactive workspace disposal fallback commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove active workspace tab close still falls back to explicit runtime stops when unified workspace disposal fails before switching to the next tab.

#### Implementation Choice

- Add controller coverage for an active tab close where `disposeWorkspace` rejects.
- Verify fallback cleanup stops the PHP language server, JavaScript/TypeScript language server, and terminal sessions for the closed root, then activates the neighboring workspace.

#### Acceptance Criteria

- `closeWorkspaceTab` keeps the active tab close path resilient when the workspace runtime disposal gateway rejects.
- The fallback targets only the closed active root.
- The next workspace tab becomes active after cleanup.
- Focused/full controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "falls back to explicit runtime stops when active project disposal fails|stops active project runtimes before switching to the next project tab|falls back to explicit per-runtime stops when workspace runtime disposal fails"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `49377f28 Cover active workspace disposal fallback`.

### Slice: Last Workspace Runtime Disposal Fallback Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `79e9bb97 Record active workspace disposal fallback commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove closing the final workspace tab still falls back to explicit runtime stops when unified workspace disposal fails.

#### Implementation Choice

- Add controller coverage for a last-tab close where `disposeWorkspace` rejects.
- Verify fallback cleanup stops the PHP language server, JavaScript/TypeScript language server, and terminal sessions for the closed root, then clears the active workspace and tab list.

#### Acceptance Criteria

- `closeWorkspaceTab` keeps the final tab close path resilient when the workspace runtime disposal gateway rejects.
- The fallback targets the closed root.
- The workbench ends with no active workspace and no workspace tabs.
- Focused/full controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "falls back to explicit runtime stops when last project disposal fails|clears the workbench and stops runtime when the last project tab closes"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `82cdcf27 Cover final workspace disposal fallback`.

### Slice: PHP Code Action Stored Payload Root Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b10bc30a Record final workspace disposal fallback commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.
- Delegation note: subagent spawn was attempted for parallel JS/TS isolation audit, but the agent thread limit was reached, so the main agent implemented this tightly scoped slice directly.

#### Goal

- Prevent stale PHP code-action stored payloads from resolving or executing after all project tabs are closed.

#### Implementation Choice

- Make the generic PHP Monaco provider treat a missing active workspace root as inactive for stored workspace payloads.
- Reuse that active-root guard inside the PHP runtime-active check used by code-action resolve and execute-command paths.
- Add a regression proving PHP code-action resolve and execute-command are skipped when `getWorkspaceRoot()` returns `null`, even if the runtime status still looks running for the stale root.

#### Acceptance Criteria

- PHP code-action resolve does not call the LSP gateway when no project tab is active.
- PHP execute-command does not call the LSP gateway when no project tab is active.
- Existing wrong-root and rootless-runtime PHP guards still pass.
- Generic PHP provider tests, JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "does not resolve or execute PHP code-action commands when no project tab is active|does not resolve or execute PHP code-action commands when the runtime status belongs to another workspace root|does not resolve or execute PHP code-action commands when the runtime status has no explicit workspace root"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `a78a36ba Guard PHP code actions without active workspace`.

### Slice: PHP Selection Range Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `232af060 Record PHP code action root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight PHP selection range requests are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a Monaco provider regression that starts a PHP selection range request under `/project`, clears the active workspace root before the gateway resolves, and verifies the stale result resolves to `null`.
- Keep the gateway assertion pinned to the original `/project` request root, proving the provider captures request context while still rejecting the response after active-root loss.

#### Acceptance Criteria

- In-flight PHP selection ranges do not reach Monaco after `getWorkspaceRoot()` returns `null`.
- Existing project-switch selection range guard still passes.
- Generic PHP provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "drops in-flight PHP selection ranges when no project tab is active|drops in-flight PHP selection ranges after switching project tabs"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `f67f3398 Cover PHP selection ranges without active workspace`.

### Slice: PHP Hover Active Workspace Loss Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9407ac56 Record PHP selection range root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent stale PHP hover responses from reaching Monaco after the active project tab closes or the workspace root changes mid-request.

#### Implementation Choice

- Re-check the captured request root after pending document flush and again after the PHP LSP hover response resolves.
- Suppress stale hover errors once the request root is no longer the active workspace root.
- Add a regression that starts a hover request under `/project`, clears the active workspace root before the delayed LSP response, and verifies Monaco receives `null`.

#### Acceptance Criteria

- PHP hover does not call the LSP gateway after active-root loss during flush.
- PHP hover drops in-flight LSP responses after active-root loss.
- Stale hover failures are not reported after the request root becomes inactive.
- Generic PHP provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "drops in-flight PHP hover when no project tab is active|flushes pending changes and maps hover responses"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `57b94029 Guard PHP hover after workspace loss`.

### Slice: PHP Completion Active Workspace Loss Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `c6713fff Record PHP hover root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent stale PHP completion results from returning after the active project tab closes while completion work is in flight.

#### Implementation Choice

- Carry the captured active workspace root through local PHP method completion calculation.
- Drop typed receiver, local-variable, and LSP completion suggestions if the captured root is no longer active after async completion work resumes.
- Re-check the captured LSP request root after pending document flush and again after the PHP LSP completion response resolves.
- Suppress stale completion errors once the request root is no longer active.

#### Acceptance Criteria

- PHP completions return no suggestions after `getWorkspaceRoot()` becomes `null` mid-request.
- In-flight LSP completion responses do not reach Monaco after active-root loss.
- Local PHP suggestions computed from a stale project tab are dropped after active-root loss.
- Generic PHP provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "drops in-flight PHP completions when no project tab is active|maps completion responses to Monaco suggestions"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `8834fa70 Guard PHP completions after workspace loss`.

### Slice: PHP Signature Help Active Workspace Loss Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `b78a29b0 Record PHP completion root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent stale typed PHP signature help from returning after the active project tab closes while parameter hint lookup is in flight.

#### Implementation Choice

- Re-check the captured active workspace root after the async PHP method signature provider resolves.
- Suppress stale signature provider errors once the captured root is no longer active.
- Add a regression that starts signature help under `/project`, clears the active workspace root before the delayed signature response, and verifies Monaco receives `null`.

#### Acceptance Criteria

- PHP signature help returns `null` after `getWorkspaceRoot()` becomes `null` mid-request.
- Stale signature provider failures are not reported after active-root loss.
- Existing typed signature mapping still passes.
- Generic PHP provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "drops in-flight PHP signature help when no project tab is active|maps typed PHP method signatures to Monaco parameter hints"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `410a3bb5 Guard PHP signature help after workspace loss`.

### Slice: PHP Code Action Active Workspace Loss Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `5163d811 Record PHP signature root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent stale PHP LSP code actions from returning after the active project tab closes while the code action request is in flight.

#### Implementation Choice

- Convert `provideCodeActions` to async control flow so it can re-check the captured root after pending document flush and again after the LSP code-action response resolves.
- Return only local code actions when the captured root is no longer active.
- Suppress stale LSP code-action errors once the request root is inactive.
- Add a regression that starts code actions under `/project`, clears the active workspace root before the delayed LSP response, and verifies no LSP actions reach Monaco.

#### Acceptance Criteria

- In-flight PHP LSP code actions are dropped after `getWorkspaceRoot()` becomes `null`.
- Local quickfix fallback behavior remains available when no LSP request can be made.
- Existing LSP code-action mapping and wrong-root guards still pass.
- Generic PHP provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts -t "drops in-flight PHP LSP code actions when no project tab is active|requests LSP code actions and maps edits, commands and diagnostics"`
- PASS: `npm test -- src/components/languageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `0b4247e5 Guard PHP code actions after workspace loss`.

### Slice: TypeScript Completion Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `2ada73b6 Record PHP code action root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight TypeScript completions are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a JS/TS Monaco provider regression that starts completion under `/project`, clears the active workspace root before the delayed completion response, and verifies Monaco receives an empty suggestion list.
- Keep the gateway assertion pinned to `/project`, proving request capture remains stable while response delivery is blocked after active-root loss.

#### Acceptance Criteria

- In-flight TypeScript completions return no suggestions after `getWorkspaceRoot()` becomes `null`.
- Existing project-switch completion guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript completions when no project tab is active|drops in-flight TypeScript completions after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `92c793a1 Cover TypeScript completions without active workspace`.

### Slice: TypeScript Code Action Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `bcc762f4 Record TypeScript completion root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight TypeScript code actions are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a JS/TS Monaco provider regression that starts quickfix code actions under `/project`, clears the active workspace root before the delayed code-action response, and verifies Monaco receives an empty action list.
- Keep the gateway assertion pinned to `/project`, proving request capture remains stable while response delivery is blocked after active-root loss.

#### Acceptance Criteria

- In-flight TypeScript code actions return no actions after `getWorkspaceRoot()` becomes `null`.
- Existing project-switch code-action guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript code actions when no project tab is active|drops in-flight TypeScript code actions after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `22808a25 Cover TypeScript code actions without active workspace`.

### Slice: TypeScript Document Link Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `84f86c9d Record TypeScript code action root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight TypeScript document links are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a JS/TS Monaco provider regression that starts document link lookup under `/project`, clears the active workspace root before the delayed response, and verifies Monaco receives an empty link list.
- Keep the gateway assertion pinned to `/project`, proving request capture remains stable while response delivery is blocked after active-root loss.

#### Acceptance Criteria

- In-flight TypeScript document links return no links after `getWorkspaceRoot()` becomes `null`.
- Existing project-switch document-link guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript document links when no project tab is active|drops in-flight TypeScript document links after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `49b86c5e Cover TypeScript document links without active workspace`.

### Slice: TypeScript Selection Range Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `37a8c0d8 Record TypeScript document link root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight TypeScript selection ranges are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a JS/TS Monaco provider regression that starts selection ranges under `/project`, clears the active workspace root before the delayed response, and verifies Monaco receives `null`.
- Keep the gateway assertion pinned to `/project`, proving request capture remains stable while response delivery is blocked after active-root loss.

#### Acceptance Criteria

- In-flight TypeScript selection ranges return `null` after `getWorkspaceRoot()` becomes `null`.
- Existing project-switch selection range guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript selection ranges when no project tab is active|drops in-flight TypeScript selection ranges after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `dd16a360 Cover TypeScript selection ranges without active workspace`.

### Slice: TypeScript Session-Aware Provider Error Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `1bad59f9 Record TypeScript selection range root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent stale JS/TS provider errors from an old runtime session from surfacing after the TypeScript language server restarts in the same workspace root.

#### Implementation Choice

- Replace root-only provider error reporting with session-aware guards for feature requests.
- Use stored payload session checks for lazy resolves and execute-command payloads.
- Use workspace-edit event session checks before reporting server-initiated workspace edit failures.
- Add a regression where a completion request starts in `/project` with `sessionId: 1`, the runtime restarts to `sessionId: 2`, and the stale request rejects without calling `reportError`.

#### Acceptance Criteria

- Stale JS/TS provider errors are suppressed after same-root runtime session restart.
- Existing stale-error suppression after project tab switch still passes.
- Lazy payload and workspace edit event error reporting now use the same root/session invariant as their success paths.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops stale TypeScript provider errors after same-root session restart|drops stale TypeScript provider errors after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `73752f47 Guard TypeScript provider errors by session`.

### Slice: TypeScript Lazy Resolve Session Error Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `9c590c12 Record TypeScript session error guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove stale JS/TS lazy resolve errors are suppressed after the TypeScript runtime restarts in the same workspace root.

#### Implementation Choice

- Add a completion resolve regression that starts from a stored payload created in `/project` with `sessionId: 1`.
- Restart the active runtime to `sessionId: 2` before the delayed resolve rejects.
- Verify the provider returns the original Monaco completion item and does not call `reportError`, while still proving the stale resolve request had reached the gateway.

#### Acceptance Criteria

- Stale completion resolve errors do not surface after same-root runtime session restart.
- Existing same-root lazy resolve success-path guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops stale TypeScript completion resolve errors after same-root session restart|ignores stale TypeScript lazy resolves after same-root session restart"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `ab341f6d Cover TypeScript lazy resolve errors by session`.

### Slice: TypeScript Workspace Symbol Rootless Active Guard Coverage - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `e8a124a0 Record TypeScript lazy resolve error guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prove in-flight TypeScript workspace symbol results are dropped when the last project tab closes before the LSP response returns.

#### Implementation Choice

- Add a workspace symbol regression that starts a query under `/project`, clears the active workspace root before the delayed response, and verifies the symbol picker receives an empty list.
- Keep the gateway assertion pinned to `/project`, proving request capture remains stable while response delivery is blocked after active-root loss.

#### Acceptance Criteria

- In-flight TypeScript workspace symbols return no symbols after `getWorkspaceRoot()` becomes `null`.
- Existing project-switch workspace symbol guard still passes.
- Full JS/TS provider tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts -t "drops in-flight TypeScript workspace symbols when no project tab is active|drops in-flight TypeScript workspace symbols after switching project tabs"`
- PASS: `npm test -- src/components/javascriptTypescriptLanguageServerMonacoProviders.test.ts`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `b3c28189 Cover TypeScript workspace symbols without active workspace`.

### Slice: Normalized Index Root PHP Refresh Guard - 2026-06-21

#### Checkpoint

- Branch: `main...origin/main`
- Latest pushed commit observed:
  - `06b1b787 Record TypeScript workspace symbol root guard commit`
- Stash snapshot still present:
  - `stash@{Tue Jun 16 15:29:26 2026}: On main: wip macOS release CI`
- Worktree was clean at slice start.

#### Goal

- Prevent active PHP tree and file-outline refreshes from being skipped when index progress reports the active workspace root with a harmless trailing slash difference.

#### Implementation Choice

- Replace direct `indexProgress.rootPath !== workspaceRoot` checks with `workspaceRootKeysEqual`.
- Add a controller regression where the active workspace is `/workspace`, index progress starts with `/workspace/`, and the PHP sidebar still refreshes the PHP tree for `/workspace`.

#### Acceptance Criteria

- Index progress rooted at `/workspace/` is treated as active for `/workspace`.
- PHP tree refreshes are not skipped for equivalent workspace root spellings.
- Existing restored IDE indexing behavior still passes.
- Focused/full controller preview tests, `npm run check`, and `git diff --check` pass.

#### Verification

- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx -t "refreshes the PHP tree for index progress roots that only differ by a trailing slash|starts indexing when a restored workspace is already in IDE mode"`
- PASS: `npm test -- src/application/useWorkbenchController.preview.test.tsx`
- PASS: `npm run check`
- PASS: `git diff --check`

#### Commit Status

- Committed as `0e99c5db Normalize index progress roots for PHP refreshes`.
