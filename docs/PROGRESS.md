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

Current verification:

- `npm run check`: passing
- `npm test`: passing, 7 frontend tests
- `npm run build`: passing
- `npm audit --json`: zero vulnerabilities
- `cargo test`: passing, 4 Rust tests
- `npm run tauri build -- --debug --bundles app`: passing
- Browser smoke test: passing for shell, empty states, and command palette
- `coderabbit review --agent --base main`: completed; valid findings addressed

Known issues:

- `npm run tauri build -- --debug` with all default bundles fails during DMG packaging. The `.app` bundle succeeds. DMG packaging is deferred to Phase 8.
- Native file dialog cannot be fully tested in the regular browser smoke test.

Next implementation slice:

1. Add file quick-open and improved search foundation.
2. Add persisted settings beyond recent workspace.
3. Start Smart mode state machine as a backend-visible service, still without LSP/index side effects.
4. Add a real Problems/Status event surface for future LSP/index messages.
5. Start PHP workspace detection.
