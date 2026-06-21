# Multi-Project Tabs and Isolated IDE Runtime

## Goal

Make the editor support several open projects in a PhpStorm-like project tab strip, with workspace state, IDE mode, index state, terminal sessions, and language-server processes isolated per project.

The first implementation slice adds persistent project tabs and safe single-active-workspace switching. The full target is a runtime registry where multiple project tabs can have independent IDE engines without cross-talk.

## Current State

- The React workbench is currently a single active workspace controller.
- Workspace settings are already persisted per root path, so IDE mode, auto save, status-bar visibility, and session tabs can be isolated by workspace.
- The terminal backend already supports multiple sessions by `sessionId`, and the frontend disposes the active terminal session when `rootPath` changes.
- The PHP language-server backend is still a singleton: `LanguageServerSupervisor` stores `Mutex<Option<RunningSession>>`.
- LSP document sync and feature requests do not carry a workspace key, so completion/definition/implementation requests cannot be safely routed when more than one project engine is alive.
- Index events already include `rootPath`, which makes per-workspace index UI routing practical.

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
3. Rust `LanguageServerRegistry` replacing singleton supervisor state.
4. Route document sync and feature requests by root path.
5. Route diagnostics and status events by root path.
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

- Pending implementation commit.
