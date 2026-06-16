# Progress

## 2026-06-15

Completed:

- Initialized Tauri v2 + React + TypeScript + Vite project.
- Added Monaco editor integration.
- Added Tauri dialog plugin.
- Added Rust workspace file repository and commands:
  - `read_directory`
  - `read_text_file`
  - `write_text_file`
- Added Basic-mode workbench UI:
  - activity bar
  - file sidebar
  - lazy directory tree
  - editor tabs
  - Monaco editor surface
  - status bar
  - command palette
- Added command registry with unit tests.
- Added Rust tests for local workspace file repository.
- Updated dependencies to resolve npm audit findings.
- Verified app bundle build with `npm run tauri build -- --debug --bundles app`.
- Added file create, folder create, active-file rename, active-file delete, and workspace refresh commands.
- Extracted workbench orchestration into `useWorkbenchController`.
- Added prompt adapter and Tauri workspace gateway abstractions.
- Added recent workspace restore through local storage.
- Added CSP configuration instead of disabled CSP.
- Added CodeRabbit review loop and fixed valid findings.
- Added accessibility improvements for command palette, file tree, and tabs.
- Added path helper and dirty-state unit tests.
- Added backend file search command and Quick Open UI command.
- Added backend-visible Smart mode state service and Tauri smart mode gateway.
- Added PHP/Composer workspace detection from `composer.json`.
- Added Problems panel and workbench notice model for future diagnostics/status events.
- Added ripgrep-backed text search command and modal.
- Added PHPactor/Intelephense tool detection from workspace `vendor/bin` and `PATH`.
- Added persistent backend-visible workspace trust state and Trust Workspace command.
- Split frontend workspace gateway into focused file, detection, tool, file-search, and text-search ports.
- Added PHPactor LSP planning command that builds a launch command and JSON-RPC initialize request without starting a process.
- Added frontend language-server gateway and status label for PHPactor LSP readiness.
- Added PHPactor setup guidance modal and command-palette action for non-ready LSP plans.
- Added supervised JSON-RPC process transport that frames LSP messages, starts/stops PHPactor, performs the initialize handshake, and reports runtime status through Tauri events.
- Added frontend language-server runtime gateway, runtime status helpers, command-palette Start/Stop actions, and crash notices.
- Added LSP text document sync foundation for PHP `didOpen`, debounced full-text `didChange`, `didSave`, and `didClose` notifications.
- Added LSP diagnostics bridge from `textDocument/publishDiagnostics` into the Problems panel with per-document replacement.
- Added PHPactor capability registry from initialize results for hover, completion, and definition support.
- Added LSP request-response core with hover, completion, and definition Tauri command adapters.
- Registered PHPactor-backed Monaco hover and completion providers gated by runtime capabilities.
- Added app-native PHPactor go-to-definition command that opens target files and reveals target positions.
- Added app/workspace settings gateway with persisted recent workspace and per-workspace Smart mode.
- Added navigation back/forward stack with command-palette actions and keyboard shortcuts.
- Added SQLite workspace index database foundation with migrations, WAL, busy timeout, and file record commands.
- Added shared ignore matcher with `.gitignore` scopes, default heavy-folder excludes, and workspace file-search integration.
- Added workspace watcher abstraction with normalized native/Watchman event shape and Watchman-to-native fallback strategy.
- Added in-memory index job scheduler foundation with watch, metadata, parse, DB-write, and maintenance queues.
- Added index generation guards and guarded SQLite DB-write commits so stale jobs cannot mutate the index.
- Added initial metadata scan service with `.gitignore` filtering, symlink skipping, SQLite file-record writes, completion/failure events, and a non-blocking Tauri start command.
- Added incremental index updates that route watch events through the scheduler and apply guarded SQLite upsert/remove writes for modify, delete, rename, and ignored-file cases.
- Added index progress UI plumbing with a Tauri gateway, command-palette scan action, status bar counts/phases, and Problems notices for scan errors.
- Added tree-sitter PHP parser foundation with tolerant valid/incomplete PHP fixture coverage.
- Added PHP symbol extraction for namespaced classes, interfaces, traits, enums, methods, functions, and constants.
- Added Composer metadata detection for root PSR-4/classmap roots plus lock/installed package metadata as data.
- Added SQLite symbol storage with transactional per-file symbol replacement, rollback coverage, and cascade cleanup when files are removed.
- Added project symbol search over SQLite symbols with ranked class/type/function/method results and a Tauri/TypeScript gateway contract.
- Added PHP tree panel backed by indexed namespaces, types, functions, methods, and constants.
- Added PHP file outlines in the file tree backed by per-file indexed symbols.
- Added soft, PHP-language, and hard workspace reindex commands with background PHP symbol parsing.
- Added a lazy-loaded xterm.js terminal view in the bottom panel with Problems/Terminal switching.
- Added a trusted-workspace Rust PTY service with terminal session start/input/resize/stop commands and output events.
- Added terminal profile listing and selection for default/platform shells.
- Added Settings UI with persisted mode, trust, PHP backend preference, tool paths, extra ignore patterns, and theme selection.
- Added Index health panel with bounded skipped/error details, run logs, and reindex actions.
- Added per-workspace session restore for open tabs, active tab, sidebar view, and bottom-panel view.
- Added theme polish with semantic active-state foregrounds, accessible terminal palettes, first-render system preference handling, and xterm theme updates without restarting the terminal session.

Current verification:

- `npm run check`: passing
- `npm test`: passing, 86 frontend tests
- `npm run build`: passing
- `npm audit --json`: zero vulnerabilities
- `cargo test`: passing, 144 Rust tests
- `npm run tauri build -- --debug --bundles app`: passing
- Browser smoke test: passing for shell, sidebar tabs, file-outline and reindex UI wiring, bottom-panel Problems/Index/Terminal switching, xterm rendering, terminal non-Tauri fallback, empty states, command palette, language-server runtime subscription wiring, Settings dialog open/save/theme/responsive behavior, Index health responsive behavior, timestamped session-load smoke, light/dark/system theme switching, terminal lazy-load rendering after theme changes, and non-Tauri development fallback
- `coderabbit review --agent --fast --base main`: passing with 0 findings after the Theme polish slice.

Known issues:

- `npm run tauri build -- --debug` with all default bundles fails during DMG packaging. The `.app` bundle succeeds. DMG packaging is deferred to Phase 8.
- Native file dialog cannot be fully tested in the regular browser smoke test.

Next implementation slice:

1. Add product icon/metadata.
2. Audit packaged service runtime readiness before deeper packaging work.
