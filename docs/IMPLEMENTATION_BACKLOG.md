# Implementation Backlog

Date: 2026-06-15
Status: Active backlog

Scale:

- S: 0.5-1 day
- M: 2-3 days
- L: 4-7 days
- XL: 1-2 weeks

## Critical Path

1. Scaffold Tauri + React + TypeScript + Vite.
2. Build Basic editor loop.
3. Add command registry and command palette.
4. Add file operations and recent workspace restore.
5. Add quick-open and search.
6. Add Smart mode lifecycle.
7. Add PHPactor LSP provider.
8. Add SQLite index service.
9. Add tree-sitter PHP symbols.
10. Add PHP tree and project symbol search.

## Phase 0: Repository And Tooling

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P0-01 | Initialize Tauri v2 app | M | Done | Desktop app starts and builds. |
| P0-02 | Add format/check/test scripts | S | Partial | TypeScript/Rust checks run; formatter coverage can expand. |
| P0-03 | Add frontend/Rust tests | M | Done | Vitest and Cargo tests pass. |
| P0-04 | Initialize git repository | S | Done | `main` exists with clean commit history conventions. |
| P0-05 | Add CI workflow | M | Pending | CI runs checks on push/PR. |

## Phase 1: Basic Editor Loop

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P1-01 | Workbench layout shell | M | Done | Activity bar, sidebar, editor, status bar render. |
| P1-02 | Workspace open flow | M | Done | Native folder picker loads root directory. |
| P1-03 | Lazy file tree | L | Done | Directories load on expansion and hide heavy defaults. |
| P1-04 | File open/read command | M | Done | File opens in Monaco. |
| P1-05 | Tabs | L | Done | Open files render as tabs with close/activate. |
| P1-06 | Dirty tracking and save | L | Done | Dirty state shows and saves through host command. |
| P1-07 | File operations | L | Done | Create file/folder, rename active file, delete active file. |
| P1-08 | Recent workspace restore | M | Done | Last workspace restores from local storage. |
| P1-09 | Settings persistence | M | Pending | App/workspace settings abstraction exists. |

## Phase 2: Navigation And Search

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P2-01 | Command registry | M | Done | Commands have id/title/category/enabled state. |
| P2-02 | Command palette | M | Done | Commands can be searched/executed. |
| P2-03 | File quick-open | L | Done | User can search files by path and open results. |
| P2-04 | Text search | L | Pending | Search respects ignores and streams results. |
| P2-05 | Navigation stack | M | Pending | Back/forward works across files/positions. |
| P2-06 | Status service | S | Partial | Status bar and Problems notice surface exist; backend event stream pending. |

## Phase 3: Smart Mode Foundation

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P3-01 | Smart mode state machine | M | Partial | Backend-visible state service exists; real service lifecycle pending. |
| P3-02 | Workspace trust model | M | Pending | Untrusted workspaces cannot execute project code. |
| P3-03 | Service supervisor | L | Pending | Services start/stop/restart and report health. |
| P3-04 | Background event bus | M | Pending | UI receives service status/log events. |
| P3-05 | Smart mode status UI | M | Partial | Status bar shows mode; detailed health pending. |

## Phase 4: PHP LSP Integration

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P4-01 | LSP transport prototype | XL | Pending | App can initialize local language server. |
| P4-00 | PHP workspace detection | M | Done | Composer package and PSR-4 roots are detected as data. |
| P4-02 | PHPactor provider | L | Pending | PHPactor starts for trusted PHP workspace. |
| P4-03 | Document sync | L | Pending | Open/change/save/close notifications work. |
| P4-04 | Diagnostics display | L | Pending | Diagnostics appear in editor/problems panel. |
| P4-05 | Hover/completion | L | Pending | Monaco requests route through LSP. |
| P4-06 | Go to definition | M | Pending | Definition opens target location. |
| P4-07 | Capability registry | M | Pending | Commands reflect provider capabilities. |
| P4-08 | Intelephense skeleton | M | Pending | User-configured binary can be selected. |

## Phase 5: Index Service

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P5-01 | SQLite workspace DB | L | Pending | Migrations, WAL, busy timeout. |
| P5-02 | Ignore matcher | M | Pending | `.gitignore` behavior shared by scan/events. |
| P5-03 | Watcher abstraction | L | Pending | Watchman/native fallback expose same events. |
| P5-04 | Job scheduler | L | Pending | Watch, metadata, parse, write, maintenance queues. |
| P5-05 | Cancellation/generation | M | Pending | Stale jobs cannot commit. |
| P5-06 | Initial metadata scan | L | Pending | Eligible files recorded without blocking UI. |
| P5-07 | Incremental updates | L | Pending | Modify/delete/rename updates DB. |
| P5-08 | Index progress UI | M | Pending | User sees file counts, phases, errors. |

## Phase 6: PHP Structural Index

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P6-01 | tree-sitter PHP parser | L | Pending | Handles valid and incomplete fixtures. |
| P6-02 | Symbol extraction | XL | Pending | Classes, interfaces, traits, enums, methods, functions, constants. |
| P6-03 | Composer detector | L | Pending | PSR-4 roots/classmaps/packages parsed as data. |
| P6-04 | Symbol DB writes | M | Pending | Per-file symbols replace transactionally. |
| P6-05 | Project symbol search | M | Pending | Search classes/functions/methods from SQLite. |
| P6-06 | PHP tree panel | L | Pending | Namespaces/classes/members render from index. |
| P6-07 | File tree members mode | L | Pending | PHP files expand into indexed members. |
| P6-08 | Reindex commands | M | Pending | Soft/language/hard reindex commands. |

## Phase 7: Terminal And Polish

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P7-01 | xterm.js view | M | Pending | Terminal panel renders. |
| P7-02 | Rust PTY service | L | Pending | Shell streams input/output. |
| P7-03 | Terminal profiles | M | Pending | User can select shell/profile. |
| P7-04 | Settings UI | L | Pending | Mode, PHP backend, paths, ignores, theme. |
| P7-05 | Index health panel | M | Pending | Errors/skipped files/logs inspectable. |
| P7-06 | Session restore | M | Pending | Tabs/layout restore after restart. |
| P7-07 | Theme polish | L | Pending | Light/dark themes and contrast checks. |

## Phase 8: Packaging

| ID | Task | Size | Status | Acceptance |
| --- | --- | --- | --- | --- |
| P8-01 | Product icon/metadata | S | Pending | Product-specific icon/name/version. |
| P8-02 | macOS app packaging | M | Partial | `.app` debug bundle passes; DMG pending. |
| P8-03 | Sidecar packaging plan | L | Pending | PHPactor/LSP/index packaging documented. |
| P8-04 | Update channel research | M | Pending | Signing/update mechanism decided. |
| P8-05 | Windows/Linux feasibility | L | Pending | Builds attempted and blockers documented. |

## Quality Gates

Before finishing an implementation slice:

- Run TypeScript checks.
- Run frontend tests.
- Run Rust tests.
- Run relevant build or app bundle smoke test.
- Run browser smoke for frontend changes.
- Run `coderabbit review --agent --base main`.
- Address valid findings.
- Document SOLID/pattern review in `docs/ARCHITECTURE_REVIEWS.md`.

## Architecture Checklist

- Single Responsibility: one clear reason to change.
- Open/Closed: extend through commands, providers, adapters, registries.
- Liskov Substitution: provider/store/service implementations are swappable.
- Interface Segregation: focused contracts, no god services.
- Dependency Inversion: UI depends on abstractions.
- Guard clauses and early returns.
- Patterns only where useful: Command, Strategy, Adapter, Repository, Observer, Pipeline.
- Internal behavior tests use real collaborators and temp/in-memory infrastructure.
