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

Current verification:

- `npm run check`: passing
- `npm test`: passing, 42 frontend tests
- `npm run build`: passing
- `npm audit --json`: zero vulnerabilities
- `cargo test`: passing, 52 Rust tests
- `npm run tauri build -- --debug --bundles app`: passing
- Browser smoke test: passing for shell, empty states, command palette, language-server runtime subscription wiring, and non-Tauri development fallback
- `coderabbit review --agent --fast --base main`: passing with 0 findings after go-to-definition routing.

Known issues:

- `npm run tauri build -- --debug` with all default bundles fails during DMG packaging. The `.app` bundle succeeds. DMG packaging is deferred to Phase 8.
- Native file dialog cannot be fully tested in the regular browser smoke test.

Next implementation slice:

1. Add persisted settings beyond recent workspace.
2. Add navigation stack.
