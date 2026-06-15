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

## 2026-06-15: Quick Open Slice

Scope reviewed:

- Rust recursive file search
- Tauri `search_files` command
- Frontend `WorkspaceGateway.searchFiles`
- Quick Open modal
- Cmd+P command registration

### SOLID Review

- Single Responsibility: acceptable. Search traversal lives in the Rust repository; Quick Open only renders/search-selects; controller coordinates state.
- Open/Closed: acceptable. Quick Open was added as a command and modal without changing command palette behavior.
- Liskov Substitution: acceptable. Search is part of `WorkspaceGateway`, so a future indexed search provider can replace the Tauri implementation behind the same contract.
- Interface Segregation: acceptable for now, though `WorkspaceGateway` should be split if it grows beyond workspace file operations.
- Dependency Inversion: acceptable. UI consumes `searchFiles` through the gateway abstraction, not raw Tauri IPC.

### Pattern Review

- Command pattern: `file.quickOpen` fits the existing command registry.
- Adapter pattern: `TauriWorkspaceGateway` adapts Tauri IPC to the frontend contract.
- Repository pattern: Rust search reuses the local workspace repository boundary.
- Pipeline pattern: intentionally not introduced; full search/index pipelines belong to later phases.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`

## 2026-06-15: PHP Workspace Detection

Scope reviewed:

- Rust `ComposerWorkspaceDetector`
- Tauri `detect_workspace` command
- Frontend workspace descriptor types
- Status bar PHP/Composer label

### SOLID Review

- Single Responsibility: acceptable. Composer detection is isolated in `project.rs` and only parses project metadata as data.
- Open/Closed: acceptable. Additional detectors can be added behind the `WorkspaceDetector` trait.
- Liskov Substitution: acceptable. Alternative detector implementations can return the same `WorkspaceDescriptor`.
- Interface Segregation: acceptable. Detection is exposed as one focused gateway method.
- Dependency Inversion: acceptable. UI consumes a descriptor through `WorkspaceGateway`, not direct filesystem parsing.

### Pattern Review

- Repository/Detector boundary: `WorkspaceDetector` fits as a focused project metadata detector.
- Adapter pattern: Tauri command adapts Rust detector output to frontend types.
- Strategy pattern: not fully needed yet, but the trait leaves room for multiple detectors later.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke confirmed empty workspace state still renders.

## 2026-06-15: Problems Notice Surface

Scope reviewed:

- `WorkbenchNotice` model
- Problems panel UI
- Workbench error reporting into notices
- Browser layout smoke for panel/status/editor relationship

### SOLID Review

- Single Responsibility: acceptable. Notice creation is separate from rendering; Problems panel only displays notices and clears them.
- Open/Closed: acceptable. Future LSP diagnostics and index health events can append notices without changing panel rendering.
- Liskov Substitution: not heavily exercised yet; future event sources should emit the same notice shape.
- Interface Segregation: acceptable. Problems panel receives only notices and clear callback.
- Dependency Inversion: acceptable. Error-producing flows report through controller helpers rather than importing UI components.

### Pattern Review

- Observer/event pattern: introduced only as a local notice surface; backend event streaming remains deferred.
- Adapter pattern: not needed in this slice.
- Command pattern: unchanged.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke confirmed panel geometry and empty state.
- Browser smoke confirmed command registration and disabled state without workspace.

### Known Follow-ups

- Browser cannot execute the full Tauri quick-open filesystem flow.
- Search is recursive host scanning with default ignores. Replace or augment with indexed/ripgrep-backed search in later phases.
- CodeRabbit review for this slice was delayed by free CLI rate limit and must run before committing this slice.

## 2026-06-15: Smart Mode State Service

Scope reviewed:

- Rust `SmartModeService`
- Tauri `get_smart_mode_state` and `set_smart_mode` commands
- Frontend `SmartModeGateway`
- Workbench smart-mode toggle routed through backend state

### SOLID Review

- Single Responsibility: acceptable. `SmartModeService` owns smart mode state only; it does not start LSP/indexer services yet.
- Open/Closed: acceptable. Future `LightSmart` and `FullSmart` side effects can attach behind the service boundary without changing UI controls.
- Liskov Substitution: acceptable. `SmartModeGateway` can be replaced by test or future remote implementations.
- Interface Segregation: acceptable. Smart mode is separate from workspace file operations.
- Dependency Inversion: improved. Workbench depends on `SmartModeGateway`, not direct Tauri IPC.

### Pattern Review

- State machine: minimal version introduced for Basic, Light Smart, and Full Smart.
- Adapter pattern: `TauriSmartModeGateway` adapts IPC to the frontend contract.
- Observer pattern: deferred until background service events exist.
- Strategy pattern: deferred until PHP provider selection exists.

### CodeRabbit Review

Valid findings addressed:

- Added workspace guard for Cmd+P.
- Added `aria-label` to Quick Open input.

Additional final sanity review attempt:

- A later CodeRabbit run hit the free CLI rate limit. The last completed review findings were addressed before commit.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
