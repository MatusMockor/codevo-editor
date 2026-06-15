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

Current verification:

- `npm run check`: passing
- `npm test`: passing, 7 frontend tests
- `npm run build`: passing
- `npm audit --json`: zero vulnerabilities
- `cargo test`: passing, 14 Rust tests
- `npm run tauri build -- --debug --bundles app`: passing
- Browser smoke test: passing for shell, empty states, and command palette
- `coderabbit review --agent --base main`: passing; valid trust rollback finding addressed and final rerun returned 0 findings.

Known issues:

- `npm run tauri build -- --debug` with all default bundles fails during DMG packaging. The `.app` bundle succeeds. DMG packaging is deferred to Phase 8.
- Native file dialog cannot be fully tested in the regular browser smoke test.

Next implementation slice:

1. Add persisted settings beyond recent workspace.
2. Start LSP transport prototype.
3. Add PHPactor process setup guidance UI.
4. Add PHPactor initialization prototype.
5. Add diagnostics/problems bridge.
