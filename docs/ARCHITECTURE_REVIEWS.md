# Architecture Reviews

## 2026-06-15: Phase 0 / Basic Editor Shell Slice

Scope reviewed:

- Tauri scaffold
- Rust workspace file commands
- React workbench shell
- Monaco editor surface
- Lazy file tree
- Tabs and dirty/save state
- Command registry and command palette
- Basic/Light Smart mode placeholder

### SOLID Review

- Single Responsibility: acceptable for this slice. Rust filesystem behavior is isolated in `LocalWorkspaceFileRepository`; frontend gateway, command registry, and visual components each have focused responsibilities.
- Open/Closed: acceptable. New actions can be added through `CommandRegistry`; future host implementations can replace `WorkspaceGateway`; language/index features can be added without changing the file tree contract.
- Liskov Substitution: acceptable. `WorkspaceGateway` and `WorkspaceFileRepository` are small enough that alternative implementations can substitute the current local adapters.
- Interface Segregation: acceptable. Interfaces are currently narrow: directory read, text read, text write, command registration.
- Dependency Inversion: acceptable. UI depends on `WorkspaceGateway` shape and command abstractions, not raw Tauri `invoke` calls except inside the adapter.

### Pattern Review

- Command pattern: used for command palette and keyboard-triggered workbench actions.
- Adapter pattern: used by `TauriWorkspaceGateway` and `LocalWorkspaceFileRepository`.
- Repository pattern: used for local workspace filesystem access.
- Strategy pattern: not needed yet; reserved for PHP language providers.
- Observer/event pattern: not needed yet; reserved for index/LSP status streams.
- Pipeline pattern: not needed yet; reserved for indexing.

### Extension Notes

- `App.tsx` is still the main orchestrator and should be split once workspace/session state grows. Next likely extraction: `useWorkspaceController`, `useEditorSession`, and `useWorkbenchCommands`.
- File operations currently support read/write only. Create/rename/delete should go through the same Rust repository boundary.
- Basic mode is cleanly separated from the Smart mode placeholder; no indexer or LSP starts automatically.
- Monaco is isolated behind `EditorSurface`, but deeper editor services should avoid direct Monaco imports outside editor-specific modules.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `npm audit --json` reports zero vulnerabilities
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser visual smoke test at `http://127.0.0.1:1420/`

### Known Follow-ups

- Full default Tauri DMG packaging failed in debug mode during `bundle_dmg.sh`; app bundling succeeds with `--bundles app`. Keep DMG work for Phase 8 packaging.
- Browser smoke cannot exercise native Tauri file dialog. Add Tauri-level manual or automated desktop smoke coverage later.

## 2026-06-15: Basic File Operations And CodeRabbit Loop

Scope reviewed:

- File create/rename/delete commands
- Recent workspace restore
- Workbench controller extraction
- Command error handling
- CSP configuration
- Accessibility improvements for command palette, file tree, and tabs
- Cross-platform path helper fixes

### SOLID Review

- Single Responsibility: improved. `App.tsx` now composes UI only; workflow state lives in `useWorkbenchController`; prompting and Tauri calls are adapters.
- Open/Closed: improved. File commands were added through `CommandRegistry` without changing palette internals.
- Liskov Substitution: acceptable. `WorkspaceGateway` and `WorkbenchPrompter` can be replaced by test or future native implementations.
- Interface Segregation: acceptable. Gateway methods remain explicit and focused; no broad host service object has appeared yet.
- Dependency Inversion: improved. UI depends on gateway/prompter abstractions and not direct browser/Tauri APIs.

### Pattern Review

- Command pattern: still the right fit for palette, keyboard shortcuts, and future menus.
- Adapter pattern: used for Tauri workspace access and browser prompt/confirm.
- Repository pattern: Rust filesystem access remains behind `WorkspaceFileRepository`.
- Strategy/Observer/Pipeline: intentionally deferred until language providers, background services, and indexer exist.

### CodeRabbit Review

Valid findings addressed:

- Replaced disabled CSP with a restrictive CSP string.
- Fixed cross-platform path joining, parent extraction, filename extraction, and language detection.
- Added command error handling.
- Added query reset when command palette closes.
- Added root element null check.
- Improved tablist semantics, keyboard navigation, roving tabindex, and tabpanel linkage.
- Added file tree loading announcement and `aria-expanded`.
- Removed TOCTOU issue from directory creation.
- Upgraded React/ReactDOM and verified npm audit is clean.
- Improved Tauri startup error reporting.
- Added tests for path helpers and `isDirty`.

Skipped findings:

- None. The final CodeRabbit pass returned only a title casing issue, which was resolved by changing the document title to `Editor`.

### Verification

- `npm audit --json`
- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test after refactor and accessibility fixes
