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

## 2026-06-15: Workspace Trust State

Scope reviewed:

- Rust `WorkspaceTrustService`
- JSON trust storage under the app config directory
- Tauri trust commands
- frontend `WorkspaceTrustGateway`
- Trust Workspace command
- status bar trust label

### SOLID Review

- Single Responsibility: acceptable. Trust state and persistence are isolated from smart mode, PHP detection, and workspace file operations.
- Open/Closed: acceptable. Alternate trust stores can replace the current JSON-backed service behind the same command/gateway boundary.
- Liskov Substitution: acceptable. `WorkspaceTrustGateway` can be replaced by persisted or remote implementations.
- Interface Segregation: acceptable. Trust operations are separate from workspace file operations.
- Dependency Inversion: acceptable. Workbench depends on trust abstraction, not raw IPC.

### Pattern Review

- State service: persistent JSON-backed trust service with normalized roots.
- Adapter pattern: Tauri gateway adapts host trust commands.
- Command pattern: Trust Workspace command integrates with existing command registry.

### CodeRabbit Review

Valid finding addressed:

- Added rollback logic so `WorkspaceTrustService` restores in-memory trust state when persistence fails.

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

## 2026-06-15: Ripgrep Text Search

Scope reviewed:

- Rust `TextSearcher` trait
- `RipgrepTextSearcher` adapter
- Tauri `search_text` command
- Frontend `TextSearch` modal
- Cmd+Shift+F command registration

### SOLID Review

- Single Responsibility: acceptable. Ripgrep process execution and JSON parsing live in `search.rs`; UI only renders results.
- Open/Closed: acceptable. A future indexed text search provider can implement the same text-search contract.
- Liskov Substitution: acceptable for `TextSearcher`; tests cover parser behavior without invoking external process.
- Interface Segregation: acceptable. Text search remains separate from file search and workspace detection.
- Dependency Inversion: acceptable. Frontend uses `WorkspaceGateway.searchText`; only infrastructure knows Tauri IPC.

### Pattern Review

- Adapter pattern: `RipgrepTextSearcher` adapts an external local tool into domain-shaped results.
- Command pattern: `search.text` fits the existing command registry.
- Pipeline pattern: not introduced yet; streaming search can become a pipeline later.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke confirmed Search Text command registration and disabled state without workspace.

## 2026-06-15: PHP Tool Detection

Scope reviewed:

- Rust `PhpToolDetector`
- workspace `vendor/bin` lookup
- PATH lookup
- Tauri `detect_php_tools` command
- frontend tool availability model
- status bar provider label

### SOLID Review

- Single Responsibility: acceptable. Tool discovery is isolated in `tools.rs`.
- Open/Closed: acceptable. New PHP tools can be added to the detector without touching workspace parsing or UI rendering.
- Liskov Substitution: acceptable. `PhpToolDetector` can be replaced by a configured-path detector later.
- Interface Segregation: acceptable. Tool availability is separate from composer workspace detection.
- Dependency Inversion: acceptable. Frontend sees a gateway method, not PATH scanning logic.

### Pattern Review

- Strategy-ready detector: trait introduced before provider selection becomes more complex.
- Adapter pattern: Tauri command adapts host tool discovery to frontend status.
- Strategy pattern: full provider strategy remains for PHPactor/Intelephense LSP integration.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke confirmed command registration and disabled state without workspace.

### Known Follow-ups

- Browser cannot execute the full Tauri quick-open filesystem flow.
- File quick-open search is recursive host scanning with default ignores. Replace or augment it with indexed search in later phases.

## 2026-06-15: Workspace Gateway Interface Split

Scope reviewed:

- frontend workspace domain ports
- `TauriWorkspaceGateway` adapter declarations
- `useWorkbenchController` dependency usage

### SOLID Review

- Single Responsibility: improved. File operations, project detection, PHP tool discovery, file search, and text search now have separate contracts.
- Open/Closed: improved. Future indexed search, configured PHP tool lookup, or alternative workspace detection can replace one port without changing unrelated consumers.
- Liskov Substitution: improved. Each focused gateway can be substituted independently in tests or future adapters.
- Interface Segregation: improved. Workbench dependencies no longer require consumers to implement a broad workspace gateway when they only need one capability.
- Dependency Inversion: maintained. `TauriWorkspaceGateway` remains an infrastructure adapter; controller code depends on domain ports.

### Pattern Review

- Adapter pattern: one Tauri adapter implements multiple narrow ports.
- Facade composition: `App.tsx` composes the Tauri adapter into a `WorkbenchWorkspaceGateways` dependency object.
- Command pattern: unchanged; commands still invoke controller actions rather than infrastructure directly.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`

## 2026-06-15: PHPactor LSP Initialize Planning

Scope reviewed:

- Rust `LanguageServerPlanner` and `InitializeRequestFactory`
- `PhpactorLanguageServerPlanner`
- Tauri `plan_php_language_server` command
- frontend `LanguageServerGateway`
- workbench LSP readiness status label

### SOLID Review

- Single Responsibility: acceptable. LSP planning builds launch/initialize data only; it does not start, supervise, or sync documents.
- Open/Closed: acceptable. Additional language server planners can implement `LanguageServerPlanner` without changing PHPactor-specific logic.
- Liskov Substitution: acceptable. Initialize request factories are swappable, which keeps protocol payload generation testable.
- Interface Segregation: acceptable. Frontend language-server planning uses its own gateway instead of expanding workspace or smart-mode ports.
- Dependency Inversion: acceptable. Workbench depends on `LanguageServerGateway`; Tauri IPC remains in infrastructure.

### Pattern Review

- Strategy pattern: `LanguageServerPlanner` defines provider planning behavior.
- Factory pattern: `InitializeRequestFactory` creates JSON-RPC initialize payloads.
- Adapter pattern: Tauri command and frontend gateway adapt backend planning to UI state.
- Supervisor pattern: intentionally deferred until a real process transport is introduced.

### CodeRabbit Review

Valid finding addressed:

- Removed frontend-provided trust input from `plan_php_language_server`; the command now reads authoritative trust from `WorkspaceTrustService`.
- Final rerun returned 0 findings.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke passed after clean dev-server restart.

## 2026-06-15: PHPactor Setup Guidance UI

Scope reviewed:

- `createPhpactorSetupGuide` domain helper
- `LanguageServerSetup` modal
- command-palette action for non-ready PHPactor plans

### SOLID Review

- Single Responsibility: acceptable. Setup decision logic is in the domain helper; the modal renders a guide and copy actions only.
- Open/Closed: acceptable. Additional provider setup guides can be added beside the PHPactor helper without changing the command registry shape.
- Liskov Substitution: not heavily exercised; the guide model is plain data and easy to render from alternate sources.
- Interface Segregation: acceptable. No existing gateway or workspace contracts were expanded.
- Dependency Inversion: acceptable. UI depends on `LanguageServerPlan` data, not direct PHPactor detection logic.

### Pattern Review

- View model pattern: setup content is shaped before rendering.
- Command pattern: setup opens through the existing command registry.
- Adapter pattern: unchanged.

### CodeRabbit Review

- `coderabbit review --agent --base main`: 0 findings on the first pass.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `coderabbit review --agent --base main`

## 2026-06-15: LSP Process Transport

Scope reviewed:

- `lsp_transport` Content-Length framing codec
- `LanguageServerSupervisor`
- `ServerProcessSpawner`, `ProcessKiller`, and `EventSink` boundaries
- Tauri start/stop/status commands
- frontend language-server runtime gateway and status helpers
- workbench Start/Stop commands and crash notices
- workspace/trust runtime stop policy

### SOLID Review

- Single Responsibility: acceptable. Framing, process lifecycle, Tauri command glue, frontend runtime adapter, and UI orchestration are separated.
- Open/Closed: acceptable. Additional process spawners or event sinks can be introduced behind traits without changing supervisor logic.
- Liskov Substitution: acceptable. Tests use in-memory spawner/sink implementations against the same supervisor contract used by production.
- Interface Segregation: acceptable. Runtime status uses a dedicated frontend gateway and does not expand planning, workspace, or smart-mode ports.
- Dependency Inversion: strong. `LanguageServerSupervisor` depends on `ServerProcessSpawner`, `ProcessKiller`, and `EventSink` abstractions, not directly on Tauri or tests.

### Pattern Review

- Adapter pattern: Tauri runtime gateway adapts invoke/listen to a focused frontend port.
- Observer pattern: runtime status is published through `EventSink` and Tauri events.
- Strategy/boundary pattern: process spawning is behind `ServerProcessSpawner`.
- Supervisor pattern: `LanguageServerSupervisor` owns start/stop/handshake/crash status for one managed PHPactor process.

### Lifecycle Review

- Running sessions retain the server stdin writer so the LSP process does not see client EOF after initialize.
- `ProcessKiller::terminate` kills and waits for child processes to avoid zombies.
- `LanguageServerSupervisor` now owns its own internal session lock, so status and stop commands are not blocked by the full handshake timeout.
- Start/stop races during the initialize handshake are covered by tests and resolve to `Stopped` instead of false crashes.
- Workspace changes and trust revocation stop the runtime before showing the next workspace state.

### CodeRabbit Review

- Initial valid cleanup findings around spawned-process cleanup were addressed before the final pass.
- Final `coderabbit review --agent --fast --base main` returned 0 findings.

### Verification

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke passed for shell and runtime event subscription wiring.

## 2026-06-15: LSP Document Sync

Scope reviewed:

- `lsp_document` text-document notification factory
- `LanguageServerSupervisor::send_notification`
- Tauri text-document sync commands
- frontend `LanguageServerDocumentSyncGateway`
- PHP-only open replay, debounced full-text changes, save, close, and runtime cleanup

### SOLID Review

- Single Responsibility: acceptable. JSON-RPC document payload construction is isolated from process supervision and frontend orchestration.
- Open/Closed: acceptable for this foundation. Additional sync strategies or language providers can add factories/adapters later; capability-driven partial-sync/save-text negotiation is intentionally deferred to the provider capability registry slice.
- Liskov Substitution: acceptable. The frontend document-sync gateway is a narrow port and can be replaced by an in-memory or non-Tauri implementation.
- Interface Segregation: improved. Runtime lifecycle and document sync are separate frontend ports.
- Dependency Inversion: maintained. Workbench orchestration depends on document-sync abstractions, while Tauri command names stay in infrastructure.

### Pattern Review

- Factory pattern: `LspTextDocumentSyncNotificationFactory` creates protocol payloads.
- Adapter pattern: Tauri document-sync gateway adapts IPC commands to a focused frontend port.
- Observer-style state reaction: React effects replay open documents on `Running` and clear sync state on stop/crash.
- Debounce pattern: full-text `didChange` notifications are delayed briefly to avoid sending one message per keystroke.
- Queue pattern: sync operations are serialized per document so `didSave` and `didClose` cannot overtake a pending `didChange`.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `coderabbit review --agent --fast --base main`
- `coderabbit review --agent --fast --base main`

## 2026-06-15: LSP Diagnostics Bridge

Scope reviewed:

- `lsp_diagnostics` parser for `textDocument/publishDiagnostics`
- `EventSink` diagnostics emission through Tauri events
- frontend diagnostics gateway
- Problems panel notice grouping and per-document replacement
- session/version filtering for delayed diagnostics

### SOLID Review

- Single Responsibility: acceptable. Diagnostic parsing, event transport, frontend subscription, and Problems rendering remain separate.
- Open/Closed: acceptable. Additional LSP server notifications can add parser modules and gateway ports without changing document sync or runtime lifecycle.
- Liskov Substitution: acceptable. Diagnostics gateway is a narrow subscription port and can be replaced in tests or non-Tauri hosts.
- Interface Segregation: maintained. Runtime status, document sync, and diagnostics are separate ports.
- Dependency Inversion: maintained. Workbench depends on diagnostics abstractions, while Tauri event names stay in infrastructure.

### Pattern Review

- Adapter pattern: Tauri diagnostics gateway adapts event subscription to a frontend port.
- Observer pattern: backend reader publishes diagnostics through `DiagnosticsSink`; frontend reacts by replacing grouped Problems entries.
- Event publisher split: status and diagnostics use separate sink traits behind the process reader.
- Parser/factory boundary: backend diagnostic parser converts raw JSON-RPC values into typed diagnostic events before emission.
- Stale-event guard: frontend applies diagnostics only for the current running session and ignores older versioned diagnostics.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `coderabbit review --agent --fast --base main`

## 2026-06-15: LSP Capability Registry

Scope reviewed:

- PHPactor initialize-result capability extraction
- typed runtime `Running` status capabilities
- frontend capability helpers and status label display
- tests for provider capability normalization
- serde contract tests for frontend runtime-status event fields

### SOLID Review

- Single Responsibility: acceptable. Capability parsing stays in the process/session layer where initialize responses are handled; frontend helpers only expose normalized status data.
- Open/Closed: acceptable for this foundation. New provider capabilities can be added to `LanguageServerCapabilities` and consumed through domain helpers without changing Tauri event transport.
- Liskov Substitution: acceptable. Runtime gateways and test sinks receive the same typed status shape as production.
- Interface Segregation: maintained. Capability data extends runtime status only; document sync and diagnostics ports remain separate.
- Dependency Inversion: maintained. UI consumes capability data through the runtime gateway/domain helper boundary, not direct JSON-RPC payloads.

### Pattern Review

- Adapter pattern: Tauri runtime gateway continues to adapt typed backend status events to the frontend port.
- Observer pattern: capability data travels with the runtime status event already observed by the workbench.
- Registry pattern: `LanguageServerCapabilities` is now the normalized provider-feature registry for later hover, completion, and definition routing.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main`

### Subagent Review

Valid findings addressed:

- Added explicit `sessionId` serialization tests for runtime status events.
- Rejected malformed initialize results that omit valid server capabilities instead of silently reporting an all-false registry.

## 2026-06-15: LSP Feature Request Core

Scope reviewed:

- `LanguageServerSupervisor::send_request` request-response coordinator
- pending request registry with timeout, stop, and crash cleanup
- `lsp_features` request factories and response parsers
- Tauri commands for hover, completion, and definition requests
- frontend feature gateway port and Tauri adapter

### SOLID Review

- Single Responsibility: acceptable. Process request correlation remains in the supervisor; feature payload construction and parsing live in `lsp_features`; frontend IPC remains in a gateway adapter.
- Open/Closed: acceptable. Additional LSP text-document features can add factories/parsers without changing document sync, diagnostics, or runtime status ports.
- Liskov Substitution: acceptable. The frontend `LanguageServerFeaturesGateway` can be replaced by a fake or future non-Tauri implementation with the same behavior.
- Interface Segregation: maintained. Runtime lifecycle, document sync, diagnostics, and feature requests are separate ports.
- Dependency Inversion: maintained. UI-facing code depends on feature gateway/domain types, while Rust feature commands depend on supervisor abstractions rather than direct process handles.

### Pattern Review

- Adapter pattern: Tauri feature gateway and Tauri commands adapt between UI/domain types and backend LSP requests.
- Factory pattern: `LspTextDocumentFeatureRequestFactory` builds protocol request payloads.
- Request coordinator pattern: supervisor tracks pending JSON-RPC requests by id and routes reader responses to waiting callers.
- Parser boundary: hover, completion, and definition response normalization is isolated from transport lifecycle.

### Verification

- `npm run check`
- `npm test`
- `cargo test`

## 2026-06-15: LSP Monaco Hover And Completion

Scope reviewed:

- `languageServerMonacoProviders` adapter
- `EditorSurface` Monaco provider lifecycle
- capability-gated hover/completion requests
- pending document-change flush before LSP feature requests
- frontend tests for provider registration and response mapping

### SOLID Review

- Single Responsibility: acceptable. Provider registration and Monaco response mapping are isolated from `EditorSurface`; the surface owns mounting/lifecycle only.
- Open/Closed: acceptable. New Monaco-backed LSP providers can be added beside hover/completion without changing the Tauri gateway or document sync queue.
- Liskov Substitution: acceptable. The provider adapter depends on the `LanguageServerFeaturesGateway` port, so tests and future providers can substitute implementations.
- Interface Segregation: maintained. Feature requests use a dedicated gateway; document sync remains responsible only for didOpen/change/save/close.
- Dependency Inversion: maintained. Monaco provider logic depends on domain ports and helpers, not direct Tauri `invoke`.

### Pattern Review

- Adapter pattern: Monaco providers adapt editor calls into domain feature requests.
- Observer/lifecycle pattern: `EditorSurface` registers providers on Monaco mount and disposes them when the editor surface unmounts.
- Guard pattern: providers return empty/null results unless the active document is PHP, the runtime is running, and the capability is enabled.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: LSP Go To Definition

Scope reviewed:

- command-palette and F12 `editor.goToDefinition` command
- capability-gated definition feature requests
- LSP file URI and position mapping helpers
- cross-file target opening through existing workspace file gateway
- editor reveal target lifecycle in `EditorSurface`

### SOLID Review

- Single Responsibility: acceptable. The controller coordinates the workflow; domain helpers map URI/position values; `EditorSurface` only tracks cursor position and reveals requested targets.
- Open/Closed: acceptable. Future navigation stack support can wrap the same command without changing LSP request parsing or Monaco hover/completion providers.
- Liskov Substitution: acceptable. Definition requests use `LanguageServerFeaturesGateway`, so tests or alternate providers can replace Tauri IPC.
- Interface Segregation: maintained. Go-to-definition consumes the feature gateway and does not expand document sync or runtime lifecycle contracts.
- Dependency Inversion: maintained. The command depends on domain abstractions and existing file gateway methods, not direct Tauri calls.

### Pattern Review

- Command pattern: `editor.goToDefinition` is registered through the existing command registry and F12 keyboard path.
- Adapter pattern: LSP URI/position values are adapted to workspace paths and editor positions at the domain boundary.
- Reveal-target state pattern: controller stores a short-lived target and `EditorSurface` consumes/disposes it after positioning the editor.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Settings Persistence

Scope reviewed:

- `SettingsGateway` app/workspace settings port
- `BrowserSettingsGateway` localStorage adapter
- recent workspace restore through settings abstraction
- per-workspace Smart mode persistence
- settings normalization and adapter tests

### SOLID Review

- Single Responsibility: acceptable. Settings normalization lives in the domain; storage IO lives in the browser adapter; workbench orchestration only loads/saves through the port.
- Open/Closed: acceptable. A future Tauri-backed or synced settings store can replace `BrowserSettingsGateway` without changing the controller.
- Liskov Substitution: acceptable. `SettingsGateway` implementations can return the same app/workspace settings contracts.
- Interface Segregation: acceptable. Settings persistence is separate from workspace file, trust, smart-mode, and language-server gateways.
- Dependency Inversion: improved. `useWorkbenchController` no longer calls `localStorage` directly.

### Pattern Review

- Adapter pattern: `BrowserSettingsGateway` adapts localStorage to the settings port.
- Repository pattern: settings are read/written by key with domain normalization at the boundary.
- Guard pattern: invalid or missing persisted JSON falls back to defaults.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Navigation Stack

Scope reviewed:

- pure navigation history reducer
- tab/file/search/definition navigation recording
- command-palette Back/Forward commands
- Cmd/Ctrl+Alt+Left/Right keyboard routing
- editor reveal target reuse for restored locations

### SOLID Review

- Single Responsibility: acceptable. Navigation history mutation is isolated in `navigation.ts`; the workbench controller only coordinates recording and target application.
- Open/Closed: acceptable. Future breadcrumbs or richer jump sources can record `NavigationLocation` values without changing stack behavior.
- Liskov Substitution: acceptable. Navigation domain functions are pure and can be reused by alternate controller implementations.
- Interface Segregation: acceptable. Navigation does not expand workspace, settings, or language-server gateways.
- Dependency Inversion: maintained. The stack stores domain locations and applies them through existing file/editor abstractions.

### Pattern Review

- Command pattern: Back/Forward are registered through `CommandRegistry`.
- Memento/history pattern: previous editor locations are stored as lightweight path/position snapshots.
- Guard pattern: empty back/forward stacks disable commands and no-op safely.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Index Generation And Commit Guards

Scope reviewed:

- generation captured on scheduled jobs
- workspace cancellation advancing generation and removing pending workspace jobs
- scheduler-backed current/stale checks
- guarded DB-write commit helper in SQLite index layer
- tests proving stale upsert/remove operations cannot mutate SQLite rows

### SOLID Review

- Single Responsibility: acceptable. The scheduler owns in-memory generation state; the index store owns persistence; the commit helper owns final side-effect gating.
- Open/Closed: acceptable. Future scan, parse, write, and publish stages can reuse `IndexCommitScope` and scheduler generation checks without changing job payload routing.
- Liskov Substitution: acceptable. `IndexCommitGate` allows tests and future index services to provide alternate generation decisions.
- Interface Segregation: acceptable. DB commit gating is separate from queueing, watcher normalization, parsing, and SQLite SQL methods.
- Dependency Inversion: acceptable. SQLite guarded writes depend on the commit gate abstraction rather than concrete scheduler internals.

### Pattern Review

- Commit gate / Unit-of-Work guard: DB writes perform a final generation check before mutation.
- Strategy pattern: `IndexCommitGate` can be swapped for fake, scheduler-backed, or future persistent generation registries.
- Pipeline guard: generation checks are ready to be reused before future read, parse, commit, and publish stages.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Index Job Scheduler Foundation

Scope reviewed:

- in-memory scheduler with `watch-events`, `metadata-scan`, `parse`, `db-write`, and `maintenance` queues
- queue policy for deterministic cross-queue dequeue order
- FIFO ordering within each queue
- watcher batch routing into metadata scan and DB-write follow-up jobs
- tests for queue placement, ordering, policy override, delete/rename/rescan routing, and watch batch payloads

### SOLID Review

- Single Responsibility: acceptable. The scheduler owns queueing and routing intent only; it does not read files, parse PHP, or write SQLite rows.
- Open/Closed: acceptable. New job payloads and queue policies can be added without changing watcher or index storage adapters.
- Liskov Substitution: acceptable. `IndexJobScheduler` and `IndexWatchEventRouter` expose small contracts that can be replaced by a threaded or persistent scheduler later.
- Interface Segregation: acceptable. Scheduling, watcher event routing, and SQLite persistence stay separate.
- Dependency Inversion: acceptable. Future index services can depend on scheduler traits instead of concrete queue storage.

### Pattern Review

- Producer/Consumer queue: typed jobs are enqueued and dequeued by queue policy.
- Strategy pattern: `IndexJobQueuePolicy` controls cross-queue priority without hard-wiring consumer order.
- Command-like payloads: `IndexJobPayload` carries explicit job intent without introducing a broad command hierarchy.

### Deferred

- Generation and stale-job commit guards remain in P5-05.
- Worker thread lifecycle and cancellation remain deferred until handlers and real index side effects exist.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Watcher Abstraction

Scope reviewed:

- normalized `WorkspaceWatchEvent` shape for native and Watchman sources
- native `notify` adapter and Watchman subscription parser
- preferred watcher fallback strategy
- ignore matcher integration for watcher events
- tests for create/modify/delete/rename, Watchman payloads, rescan hints, ignored paths, and fallback selection

### SOLID Review

- Single Responsibility: acceptable. `file_watcher.rs` owns watcher event contracts and backend adapters only; it does not schedule jobs, read file contents, parse code, or write SQLite rows.
- Open/Closed: acceptable. New watcher backends can implement `WorkspaceFileWatcher` without changing normalized event consumers.
- Liskov Substitution: acceptable. Native, Watchman, and fake test watchers all satisfy the same watch request/session contract.
- Interface Segregation: acceptable. Event sinks, watcher sessions, backend availability, and ignore matching remain separate interfaces.
- Dependency Inversion: acceptable. Future index scheduling can depend on `WorkspaceFileWatcher` and `WorkspaceWatchEventSink`, not concrete `notify` or Watchman process details.

### Pattern Review

- Adapter pattern: native `notify` events and Watchman subscription payloads are adapted into one workspace event shape.
- Strategy pattern: `PreferredWorkspaceFileWatcher` chooses Watchman or native watching behind the shared watcher interface.
- Observer pattern: `WorkspaceWatchEventSink` publishes event batches without coupling producers to future scheduler/indexer consumers.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Shared Ignore Matcher

Scope reviewed:

- `GitignoreWorkspaceIgnoreMatcher` scoped `.gitignore` loading
- default heavy-folder ignore policy
- workspace file-search integration
- tests for root `.gitignore`, nested `.gitignore`, negation, outside-root paths, and default excludes

### SOLID Review

- Single Responsibility: acceptable. Ignore decisions are isolated in `ignore_matcher.rs`; workspace search consumes the matcher without owning ignore parsing.
- Open/Closed: acceptable. Future watcher/index scans can depend on `WorkspaceIgnoreMatcher` and add settings-driven options without rewriting search traversal.
- Liskov Substitution: acceptable. The trait only exposes `is_ignored`, so alternate matchers can be substituted for tests or future workspace policies.
- Interface Segregation: acceptable. Ignore matching is separate from SQLite storage, workspace mutation, text search, and LSP services.
- Dependency Inversion: acceptable. Recursive workspace file search depends on the matcher abstraction instead of hard-coded `.gitignore` parsing.

### Pattern Review

- Strategy pattern: `WorkspaceIgnoreMatcher` gives scans and future watchers a swappable ignore policy.
- Adapter pattern: `GitignoreWorkspaceIgnoreMatcher` adapts the Rust `ignore` crate to the editor's workspace boundary.
- Policy object: `WorkspaceIgnoreOptions` carries editor-level default excludes without scattering lists across modules.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: SQLite Index Database Foundation

Scope reviewed:

- `SqliteWorkspaceIndex` connection setup
- schema migrations table and initial `workspace_files` table
- WAL journal mode and 5s busy timeout
- stable per-workspace index database path
- Tauri commands for initialize/upsert/remove file records
- canonical workspace path guard for index file commands, including symlink escape protection

### SOLID Review

- Single Responsibility: acceptable. SQLite connection setup, migrations, and file-record persistence are isolated in `index.rs`.
- Open/Closed: acceptable. Later metadata, symbol, and job tables can be added as migrations without changing existing file-record commands.
- Liskov Substitution: acceptable. `WorkspaceIndexStore` defines a small persistence contract for future in-memory or alternate stores in tests/services.
- Interface Segregation: acceptable. Index persistence is separate from workspace filesystem, search, LSP, and settings gateways.
- Dependency Inversion: acceptable. Tauri commands depend on the store trait methods rather than embedding SQL in command handlers.

### Pattern Review

- Repository pattern: `SqliteWorkspaceIndex` owns persistence for indexed workspace file records.
- Migration pattern: schema changes are tracked in `schema_migrations` and `PRAGMA user_version`.
- Adapter pattern: Tauri commands adapt root paths and payloads to the index store.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test

## 2026-06-15: Initial Metadata Scan

Scope reviewed:

- `LocalWorkspaceMetadataScanner` recursive metadata traversal
- extension-based metadata language detection
- `.gitignore` and default heavy-folder filtering through the shared ignore matcher
- symlink and outside-root safety behavior
- SQLite file-record writes through `WorkspaceIndexStore`
- non-blocking Tauri `start_initial_metadata_scan` command
- completion/failure notifications through `MetadataScanEventSink`
- integration-style Rust tests using temp workspaces and real SQLite databases

### SOLID Review

- Single Responsibility: acceptable. `index_scan.rs` owns metadata traversal and scan start orchestration only; SQLite schema stays in `index.rs`, ignore parsing stays in `ignore_matcher.rs`, and Tauri remains a thin adapter.
- Open/Closed: acceptable. New language metadata strategies can replace `MetadataLanguageDetector`; future progress or cancellation details can extend the event sink/start boundary without changing the scanner's persistence contract.
- Liskov Substitution: acceptable. `WorkspaceMetadataScanner`, `MetadataLanguageDetector`, `WorkspaceMetadataScanStarter`, and `WorkspaceIndexStore` are narrow enough for alternate implementations to substitute in future tests or services.
- Interface Segregation: acceptable. The scanner depends on focused ignore, language, and store contracts instead of a broad index service.
- Dependency Inversion: acceptable. Scan behavior writes through `WorkspaceIndexStore`; UI-facing code depends on `WorkspaceMetadataScanStarter` rather than concrete thread/process details.

### Pattern Review

- Repository pattern: metadata rows are persisted through `WorkspaceIndexStore` and `SqliteWorkspaceIndex`.
- Strategy pattern: `MetadataLanguageDetector` isolates extension-to-language decisions from traversal.
- Adapter pattern: `start_initial_metadata_scan` adapts Tauri paths/app config into a scan request; `LocalWorkspaceMetadataScanStarter` adapts scan work to a detached background thread.
- Observer pattern: `MetadataScanEventSink` reports completed and failed background scans without coupling traversal to Tauri.
- Pipeline direction: traversal already separates ignore filtering, metadata extraction, and store writes, leaving room for parser and symbol stages in Phase 6.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main` passed with 0 findings after addressing one valid fire-and-forget scan finding

## 2026-06-15: Incremental Index Updates

Scope reviewed:

- `WorkspaceMetadataScanner::collect_path` for targeted metadata extraction
- `LocalWorkspaceIndexIncrementalUpdater` watch-event application
- scheduler-routed metadata and DB-write jobs
- guarded SQLite commits through `commit_index_db_write`
- modify, delete, rename, and ignored-file integration tests using temp workspaces and real SQLite databases

### SOLID Review

- Single Responsibility: acceptable. Metadata collection remains in `index_scan.rs`; incremental orchestration lives in `index_update.rs`; SQLite mutation remains owned by `index.rs`; watch normalization remains owned by `file_watcher.rs`.
- Open/Closed: acceptable. New event sources can feed `WorkspaceWatchEventBatch`, and future parse/symbol stages can extend job handling without replacing the scheduler or store contracts.
- Liskov Substitution: acceptable. The updater depends on `WorkspaceMetadataScanner` and `WorkspaceIndexStore`, so alternate scanners/stores can be substituted for future services or tests.
- Interface Segregation: acceptable. Incremental update behavior consumes narrow scheduler, scanner, and store contracts instead of a broad workspace service.
- Dependency Inversion: acceptable. The updater coordinates abstractions and guarded operations; concrete SQLite and local metadata scanning are default adapters.

### Pattern Review

- Pipeline pattern: watch events flow through routing, metadata collection, guarded DB write operations, and later parse stages.
- Repository pattern: all persisted file metadata changes still go through `WorkspaceIndexStore`.
- Strategy pattern: metadata language detection remains replaceable behind the scanner.
- Command pattern: `IndexDbWriteOperation` models removals and upserts as explicit write commands.
- Guard pattern: `IndexCommitGate` prevents stale scheduled jobs from mutating SQLite.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: Index Progress UI

Scope reviewed:

- `indexProgress` domain state, labels, completion messages, and notice severity helpers
- `TauriIndexProgressGateway` start command and completion event adapter
- command-palette `Start Index Scan` action
- workbench controller scan state, race guard for fast completion events, and grouped Problems notices
- status bar index phase/count/error label
- frontend domain and infrastructure tests

### SOLID Review

- Single Responsibility: acceptable. Domain helpers own progress derivation; the Tauri gateway owns IPC/event adaptation; the controller coordinates workflow state; `StatusBar` only renders labels.
- Open/Closed: acceptable. Future progress phases can extend `IndexProgressState` and event handling without changing the SQLite scanner or scheduler.
- Liskov Substitution: acceptable. `IndexProgressGateway` can be replaced by tests, a future service supervisor, or a non-Tauri host implementation.
- Interface Segregation: acceptable. Index progress is separate from workspace file, PHP tool, LSP runtime, diagnostics, and settings gateways.
- Dependency Inversion: acceptable. Workbench orchestration depends on `IndexProgressGateway` rather than direct `invoke`/`listen` calls.

### Pattern Review

- Adapter pattern: `TauriIndexProgressGateway` adapts Tauri commands and events to frontend domain contracts.
- Observer pattern: metadata scan completion events update status and Problems notices without coupling the backend scanner to UI components.
- Command pattern: index scanning is exposed as a command-palette action, not a hidden automatic side effect.
- State reducer direction: pure helpers handle start/completion transitions and labels, leaving room for richer progress phases in later service work.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: Tree-Sitter PHP Parser Foundation

Scope reviewed:

- `tree-sitter` and `tree-sitter-php` dependency integration
- `PhpSyntaxParser` abstraction
- `TreeSitterPhpParser` grammar adapter
- `PhpSyntaxTree` summary for root kind/range, syntax errors, and missing nodes
- valid and incomplete PHP fixture tests

### SOLID Review

- Single Responsibility: acceptable. `php_parser.rs` owns PHP syntax parsing only; it does not extract symbols, write SQLite rows, or schedule index jobs.
- Open/Closed: acceptable. Symbol extraction can consume `PhpSyntaxParser`/`PhpSyntaxTree` without changing parser setup; alternate PHP grammars or parser configurations can replace the concrete adapter.
- Liskov Substitution: acceptable. The parser trait returns the same syntax tree contract for valid and recoverable incomplete input.
- Interface Segregation: acceptable. The parser API exposes only parse behavior and summary/root access, not future symbol or composer concerns.
- Dependency Inversion: acceptable. Future symbol extraction can depend on `PhpSyntaxParser` instead of directly constructing tree-sitter parsers.

### Pattern Review

- Adapter pattern: `TreeSitterPhpParser` adapts tree-sitter PHP grammar loading to the editor parser contract.
- Strategy pattern: `PhpSyntaxParser` lets future parser implementations or test parsers substitute behind the same boundary.
- Tolerant parser pattern: parse success is separated from syntax health through `PhpSyntaxTreeSummary`, allowing incomplete files to remain indexable with errors recorded.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: PHP Symbol Extraction

Scope reviewed:

- `PhpSymbolExtractor` abstraction
- tree-sitter-backed symbol traversal
- namespace context handling
- class/interface/trait/enum declarations
- methods, functions, and constants with fully qualified names
- symbol source ranges and container names
- valid and incomplete PHP fixture coverage

### SOLID Review

- Single Responsibility: acceptable. `php_symbols.rs` extracts structural symbols only; parsing, SQLite writes, scheduler jobs, and UI rendering stay in separate modules.
- Open/Closed: acceptable. New symbol kinds or richer metadata can extend `PhpSymbolKind`/`PhpSymbol` without changing parser setup or index storage contracts.
- Liskov Substitution: acceptable. `PhpSymbolExtractor` can be replaced by a query-based extractor or test extractor while preserving the output contract.
- Interface Segregation: acceptable. Symbol extraction consumes `PhpSyntaxTree` and source text only, not workspace, Composer, or database services.
- Dependency Inversion: acceptable. Future parse jobs can depend on `PhpSymbolExtractor` rather than concrete tree-sitter traversal.

### Pattern Review

- Visitor pattern: recursive traversal visits syntax nodes and emits symbols according to node kind.
- Strategy pattern: `PhpSymbolExtractor` provides a swappable extraction boundary.
- Value object pattern: `PhpSymbol`, `PhpSymbolKind`, and `PhpSymbolRange` carry extracted data without persistence concerns.
- Tolerant extraction: incomplete files can still produce available class/method symbols while parser error health remains separate.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: Composer Metadata Detector

Scope reviewed:

- `ComposerMetadataDetector` abstraction
- `LocalComposerMetadataDetector` parser for `composer.json`
- `composer.lock` package and dev-package metadata
- `vendor/composer/installed.json` object and legacy array metadata
- root PSR-4 and classmap roots
- package PSR-4/classmap roots, version, type, dev, and install path metadata
- workspace descriptor and TypeScript contract expansion

### SOLID Review

- Single Responsibility: acceptable. `composer.rs` parses Composer data files only; `project.rs` adapts the result into a workspace descriptor and SQLite writes remain outside this slice.
- Open/Closed: acceptable. Additional Composer metadata sources can extend the detector without changing Tauri commands or workspace file services.
- Liskov Substitution: acceptable. `ComposerMetadataDetector` lets workspace detection use any compatible metadata provider.
- Interface Segregation: acceptable. Composer detection exposes package/autoload data only, not file-tree, LSP, parser, or index write behavior.
- Dependency Inversion: improved. Workspace detection depends on the Composer detector trait rather than inline JSON parsing.

### Pattern Review

- Detector/Strategy pattern: Composer metadata lookup is a swappable strategy.
- Adapter pattern: `ComposerWorkspaceDetector` adapts Composer project metadata into the UI-facing workspace descriptor.
- Value object pattern: Composer roots and packages carry parsed data without side effects.
- Repository boundary deferred: SQLite persistence is intentionally reserved for the symbol/index write slice.

### Verification

- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: Symbol DB Writes

Scope reviewed:

- SQLite schema version 2 migration
- `workspace_symbols` table and query indexes
- `WorkspaceSymbolStore` contract
- `WorkspaceFileSymbols` and symbol value objects
- transactional per-file symbol replacement
- guarded DB-write command for replacing file symbols
- symbol rollback, file isolation, and file delete cascade tests

### SOLID Review

- Single Responsibility: acceptable. `index.rs` persists workspace file and symbol records; PHP parsing/extraction remains in parser modules.
- Open/Closed: acceptable. Future parse jobs can add symbol write operations through the symbol store contract without changing workspace file metadata writes.
- Liskov Substitution: acceptable. The `WorkspaceSymbolStore` trait can be backed by SQLite or an in-memory test adapter with the same replace/list semantics.
- Interface Segregation: improved. Symbol persistence has a focused store trait separate from `WorkspaceIndexStore`.
- Dependency Inversion: acceptable. Higher-level indexing code can depend on the symbol store abstraction rather than concrete SQLite transactions.

### Pattern Review

- Repository pattern: `SqliteWorkspaceIndex` implements focused storage traits for metadata and symbols.
- Unit of Work pattern: `replace_file_symbols` deletes and inserts one file's symbol set inside a single transaction.
- Value object pattern: symbol kind, range, and record structs carry storage data without parser behavior.
- Migration pattern: schema version 2 adds symbol tables independently of file metadata.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml index::tests::`
- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-15: Project Symbol Search

Scope reviewed:

- `WorkspaceSymbolSearchStore` read-side contract
- ranked SQLite project symbol query
- project symbol result DTO serialization
- Tauri `search_project_symbols` command
- TypeScript project symbol domain and Tauri gateway adapter
- real SQLite tests for ranking, wildcard escaping, empty query, and constant exclusion

### SOLID Review

- Single Responsibility: acceptable. Symbol search reads indexed symbol rows only; symbol extraction, index writes, and UI rendering remain separate.
- Open/Closed: acceptable. Ranking can evolve inside the search store without changing the storage write contract or Tauri command shape.
- Liskov Substitution: acceptable. Search consumers can depend on `WorkspaceSymbolSearchStore` or `ProjectSymbolSearchGateway` with alternate implementations.
- Interface Segregation: improved. Project symbol search has a read-side Rust trait and a dedicated TypeScript domain/gateway, separate from workspace file operations.
- Dependency Inversion: acceptable. Tauri command code depends on the search store abstraction implemented by SQLite.

### Pattern Review

- Repository pattern: `SqliteWorkspaceIndex` serves indexed symbol search results from persisted rows.
- Query object pattern: the SQL query encapsulates ranking and filtering for project symbols.
- Adapter pattern: Tauri and TypeScript gateways adapt IPC to the domain-facing contract.
- Value object pattern: `ProjectSymbolSearchResult` carries search data without UI behavior.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml index::tests::`
- `npm run check`
- `npm test`
- `cargo test`
- `npm run build`
- `npm run tauri build -- --debug --bundles app`
- `coderabbit review --agent --fast --base main` passed with 0 findings

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

## 2026-06-16: PHP Tree Panel

Scope reviewed:

- `php_tree.rs` read-model builder for namespace/type/member trees
- `WorkspacePhpTreeStore` SQLite read-side contract
- Tauri `get_php_tree` command
- TypeScript PHP tree domain and Tauri gateway adapter
- workbench sidebar view state, PHP tree refresh command, and symbol navigation
- `PhpTreePanel` recursive renderer and sidebar tab UI

### SOLID Review

- Single Responsibility: acceptable. Tree building, SQLite reads, Tauri IPC, controller orchestration, and rendering each live in focused modules.
- Open/Closed: acceptable. More symbol kinds or alternate tree grouping can extend the read-model builder without changing symbol writes or the file tree.
- Liskov Substitution: acceptable. `WorkspacePhpTreeStore` and `PhpTreeGateway` expose narrow contracts that can be replaced by alternate stores or test adapters.
- Interface Segregation: improved. PHP tree loading is separate from workspace file, text search, project symbol search, and index progress contracts.
- Dependency Inversion: acceptable. The workbench depends on `PhpTreeGateway`; UI components receive data and callbacks rather than invoking Tauri directly.

### Pattern Review

- Repository pattern: `SqliteWorkspaceIndex` serves a PHP tree read-model from persisted symbol rows.
- Builder pattern: `build_php_tree` assembles namespace/type/member nodes from flat symbol records.
- Adapter pattern: Tauri command and frontend gateway adapt IPC to the domain-facing contract.
- Command pattern: PHP tree show/refresh actions integrate through the existing command registry.
- Composite pattern: `PhpTreeNode` recursively models namespaces, types, and members.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml php_tree`
- `cargo test --manifest-path src-tauri/Cargo.toml loads_php_tree_from_indexed_symbols`
- `npm test -- tauriPhpTreeGateway`
- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test for sidebar tabs and non-Tauri fallback
- `coderabbit review --agent --fast --base main` passed with 0 findings after fixing the placeholder container kind finding

## 2026-06-16: PHP File Outlines In File Tree

Scope reviewed:

- `php_file_outline.rs` file-scoped read-model builder
- `WorkspacePhpFileOutlineStore` SQLite read-side contract
- Tauri `get_php_file_outline` command with workspace path guard
- TypeScript PHP file outline domain, helper, and Tauri gateway adapter
- workbench controller cache/loading/expanded state for per-file outlines
- file tree renderer extension for expandable PHP files

### SOLID Review

- Single Responsibility: acceptable. File outlines are separate from project PHP tree loading, filesystem directory reads, and parser/index writes.
- Open/Closed: acceptable. Additional outline node kinds or richer display metadata can extend the outline read model without changing file tree directory loading.
- Liskov Substitution: acceptable. `WorkspacePhpFileOutlineStore` and `PhpFileOutlineGateway` can be replaced by alternate implementations with the same file-scoped contract.
- Interface Segregation: improved. File outline loading is its own port, separate from project symbol search and project PHP tree gateways.
- Dependency Inversion: acceptable. The controller depends on the outline gateway abstraction; `FileTree` receives data/callbacks and does not invoke Tauri.

### Pattern Review

- Repository pattern: `SqliteWorkspaceIndex` exposes file outline reads through a focused store trait.
- Builder/Composite pattern: `build_php_file_outline` maps flat per-file symbols into expandable type/member nodes.
- Adapter pattern: Tauri command and frontend gateway adapt IPC to the domain-facing outline contract.
- Presenter/controller pattern: `useWorkbenchController` owns cache/loading/expanded orchestration while `FileTree` remains a renderer.
- Guard pattern: workspace path validation protects the file outline command before querying SQLite.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml php_file_outline`
- `cargo test --manifest-path src-tauri/Cargo.toml loads_php_file_outline_for_one_indexed_file`
- `npm test -- phpFileOutline tauriPhpFileOutlineGateway`
- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test for file tree shell and non-Tauri fallback
- `coderabbit review --agent --fast --base main` passed with 0 findings

## 2026-06-16: Workspace Reindex Commands

Scope reviewed:

- `WorkspaceReindexMode` for soft, language, and hard runs
- `index_reindex.rs` background reindex starter and pipeline
- SQLite maintenance reads/clears for workspace files and language symbols
- PHP parser/extractor integration into symbol replacement writes
- Tauri `start_workspace_reindex` command
- frontend `IndexProgressGateway.startReindex`
- command-palette actions for soft reindex, PHP symbol reindex, and hard rebuild

### SOLID Review

- Single Responsibility: acceptable. Reindex orchestration lives in `index_reindex.rs`; metadata scanning, PHP parsing, symbol extraction, SQLite storage, and UI commands remain separate modules.
- Open/Closed: acceptable. New reindex strategies can extend `WorkspaceReindexMode` and the pipeline without changing file tree or PHP tree rendering.
- Liskov Substitution: acceptable. The reindex starter follows the same async starter/event-sink shape as the metadata scan starter.
- Interface Segregation: improved. Maintenance reads/clears are isolated from normal index reads, symbol search, and file outline stores.
- Dependency Inversion: acceptable. The frontend depends on `IndexProgressGateway`; the Tauri command adapts IPC to the backend starter.

### Pattern Review

- Pipeline pattern: reindex runs scan, diff/clear, parse, symbol extraction, DB replacement, and event publication.
- Strategy pattern: `WorkspaceReindexMode` selects soft, PHP-language, or hard rebuild behavior.
- Repository pattern: `SqliteWorkspaceIndex` exposes focused maintenance and symbol write operations.
- Adapter pattern: Tauri and TypeScript gateways adapt reindex commands to the UI-facing contract.
- Command pattern: command palette entries trigger the three reindex modes.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml index_reindex`
- `cargo test --manifest-path src-tauri/Cargo.toml clearing_`
- `npm test -- indexProgress tauriIndexProgressGateway`
- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test for shell and non-Tauri fallback
- `coderabbit review --agent --fast --base main`: passing with 0 findings after the hard rebuild removed-file count fix

## 2026-06-16: xterm.js Terminal View

Scope reviewed:

- lazy-loaded bottom panel Terminal view
- Problems/Terminal bottom panel host and command-palette switching
- xterm lifecycle helper with FitAddon and ResizeObserver integration
- view-only terminal contract before PTY streaming exists

### SOLID Review

- Single Responsibility: acceptable. `BottomPanel` owns panel selection chrome, `ProblemsPanel` renders notices, `TerminalPanel` adapts React to xterm, and `terminalSession` owns imperative lifecycle.
- Open/Closed: acceptable. Future PTY sessions can plug into `TerminalPanel` without changing Problems rendering or editor tabs.
- Liskov Substitution: acceptable. `terminalSession` depends on small terminal/fit/observer shapes that tests can replace at the external-library boundary.
- Interface Segregation: improved. Terminal lifecycle options expose only open/write/fit/dispose and no PTY/input contract yet.
- Dependency Inversion: acceptable. The workbench controller exposes panel state; concrete xterm imports stay behind the terminal component boundary.

### Pattern Review

- Adapter pattern: `TerminalPanel` adapts `@xterm/xterm`, FitAddon, `ResizeObserver`, and `requestAnimationFrame` into the app component model.
- Strategy-ready state: `BottomPanelView` selects the active bottom-panel view without coupling Problems to Terminal behavior.
- Command pattern: command palette actions expose Problems and Terminal panel switching.
- Lazy-loading boundary: xterm assets are loaded only when the terminal view is first activated.

### Verification

- `npm run check`
- `npm test`: 72 frontend tests
- `npm run build`
- `npm audit --json`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test for Problems/Terminal switching and nonblank xterm render
- `coderabbit review --agent --fast --base main`: passing with 0 findings

## 2026-06-16: Rust PTY Service

Scope reviewed:

- `portable-pty` backend adapter
- terminal DTOs, output/status events, and Tauri commands
- `TerminalSupervisor` session lifecycle, reader/waiter threads, input writer, resize, and stop
- frontend terminal gateway and xterm streaming session helper
- trusted-workspace guard before shell startup

### SOLID Review

- Single Responsibility: acceptable. Terminal DTOs live in `terminal.rs`, PTY lifecycle lives in `terminal_session.rs`, Tauri commands adapt IPC, and xterm streaming lives in the component helper.
- Open/Closed: acceptable. Additional terminal sessions and profiles can extend the session/gateway contracts without changing Problems or editor tabs.
- Liskov Substitution: improved. Tests use fake `TerminalPtySpawner`, child, killer, resizer, writer, and event sink implementations against narrow traits.
- Interface Segregation: acceptable. Input, resize, child waiting, process killing, output events, and frontend gateway calls use focused contracts.
- Dependency Inversion: acceptable. Frontend terminal code depends on `TerminalGateway`; backend supervisor depends on PTY traits rather than raw `portable-pty` types.

### Pattern Review

- Adapter pattern: `PortablePtySpawner` adapts `portable-pty`; `TauriTerminalGateway` adapts IPC to the frontend port; `TerminalPanel` adapts xterm.
- Observer pattern: backend terminal output and status are emitted as events, and frontend output subscription writes to xterm.
- Repository-like supervisor: `TerminalSupervisor` owns session lookup and lifecycle state behind a focused API.
- Command pattern: Tauri commands expose start, input, resize, and stop operations.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml terminal_session`
- `npm run check`
- `npm test -- terminalSession tauriTerminalGateway`
- Full gate passing; `coderabbit review --agent --fast --base main` passing with 0 findings

## 2026-06-16: Terminal Profiles

Scope reviewed:

- backend terminal profile DTO and local profile provider
- `list_terminal_profiles` command
- profile-aware `start_terminal_session`
- frontend terminal profile gateway contract and bottom-panel selector
- xterm session restart when profile selection changes

### SOLID Review

- Single Responsibility: acceptable. Profile discovery is separate from PTY session lifecycle, and profile selection UI is contained in the bottom panel.
- Open/Closed: acceptable. More profile sources can extend `TerminalProfileProvider` without changing `TerminalSupervisor` behavior.
- Liskov Substitution: acceptable. Profile provider resolution is trait-based and testable.
- Interface Segregation: acceptable. `TerminalGateway` exposes profile listing separately from start/input/resize/stop.
- Dependency Inversion: acceptable. UI consumes `TerminalGateway` and backend start command resolves a profile before calling the PTY adapter.

### Pattern Review

- Strategy pattern: `TerminalProfile` selects the shell command strategy for PTY launch.
- Adapter pattern: `LocalTerminalProfileProvider` adapts platform/environment shell data to the app profile contract.
- Command pattern: Tauri profile list and profile-aware start commands expose the backend feature.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml terminal_session`
- `npm run check`
- `npm test -- terminalSession tauriTerminalGateway`
- Full gate passing; `coderabbit review --agent --fast --base main` passing with 0 findings after trimming `SHELL` profile values

## 2026-06-16: Settings UI

Scope reviewed:

- expanded app/workspace settings contracts and browser storage normalization
- Settings dialog for mode, trust, PHP backend preference, tool paths, extra ignores, and appearance
- workbench settings open/save orchestration and command-palette/shortcut entry points
- theme tokenization for the app shell plus Monaco theme selection

### SOLID Review

- Single Responsibility: acceptable. Settings normalization stays in the domain, storage remains in `BrowserSettingsGateway`, `SettingsDialog` owns draft form presentation, and `useWorkbenchController` owns the save use-case.
- Open/Closed: acceptable. New persisted settings extend `AppSettings`/`WorkspaceSettings` without changing the storage adapter API or unrelated workbench commands.
- Liskov Substitution: acceptable. `SettingsGateway` implementations can load and save the broader settings contracts with the same methods.
- Interface Segregation: acceptable. Settings persistence remains separate from trust, smart mode, PHP tool detection, terminal, and index gateways.
- Dependency Inversion: acceptable. UI components depend on settings values and callbacks, while the controller depends on gateway abstractions.

### Pattern Review

- Adapter pattern: `BrowserSettingsGateway` adapts localStorage to the settings port.
- Repository pattern: app/workspace settings are loaded and saved as normalized records behind key-based storage.
- Command pattern: Settings can be opened through the activity bar, command palette, and keyboard shortcut.
- Strategy-ready preference model: PHP backend, theme, and ignore settings are modeled as swappable preferences for later backend/runtime integration.

### Residual Risk

- PHP backend preference, custom tool paths, and extra ignore patterns are persisted and surfaced in UI, but deeper backend consumers still need follow-up integration where runtime behavior depends on them.

### Verification

- `npm run check`
- `npm test -- settings browserSettingsGateway`
- `npm test`: 78 frontend tests
- `npm run build`
- Browser smoke test for Settings gear, command-palette entry, `Cmd+,`, theme save, responsive layout, and console errors
- Full gate passing; `coderabbit review --agent --fast --base main` passing with 0 findings

## 2026-06-16: Index Health Panel

Scope reviewed:

- bounded metadata scan skipped/error detail records
- PHP reindex error detail records for read, parse, and symbol-write failures
- frontend index progress state with detail lists and run logs
- bottom-panel Index tab with summary, details, logs, and reindex actions
- command-palette `Show Index` entry

### SOLID Review

- Single Responsibility: acceptable. Scanner/reindex code records health details in `MetadataScanReport`; frontend domain helpers shape logs; `IndexHealthPanel` only renders current state and invokes callbacks.
- Open/Closed: acceptable. More health detail sources can extend `MetadataScanReport` and progress state without changing the panel structure.
- Liskov Substitution: acceptable. The existing index progress gateway still consumes the same completion event flow with a richer report payload.
- Interface Segregation: acceptable. Index health uses progress/report contracts and does not add terminal, settings, or workspace-file responsibilities.
- Dependency Inversion: acceptable. The panel depends on state and callbacks; controller remains the gateway orchestrator.

### Pattern Review

- Observer pattern: backend completion events update index health state and logs in the controller.
- Command pattern: Index panel display and reindex operations are exposed through command registry actions.
- Bounded log/read-model pattern: scan details capture inspectable health records while capping retained entries.
- Adapter pattern: existing Tauri index progress gateway adapts enriched backend event payloads to the frontend port.

### Residual Risk

- The panel shows current and recent run health, not a persistent historical index log. Watcher/incremental runtime health remains a later service-supervisor concern.

### Verification

- `cargo test --manifest-path src-tauri/Cargo.toml index_scan`
- `cargo test --manifest-path src-tauri/Cargo.toml index_reindex`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 144 Rust tests
- `npm run check`
- `npm test -- indexProgress bottomPanel tauriIndexProgressGateway`
- `npm test`: 80 frontend tests
- `npm run build`
- `npm audit --json`
- Browser smoke test for Index tab, command palette entry, disabled no-workspace actions, responsive bottom-panel header, and console errors
- Full gate passing; `coderabbit review --agent --fast --base main` passing with 0 findings after fixing duplicate detail-row keys

## 2026-06-16: Session Restore

Scope reviewed:

- workspace session settings schema for open tabs, active tab, sidebar view, and bottom-panel view
- browser settings adapter normalization and persistence
- workbench restore flow that reopens saved tabs from real workspace files
- guarded session save effect after restore completes

### SOLID Review

- Single Responsibility: acceptable. Session normalization lives in the settings domain, storage remains in `BrowserSettingsGateway`, and the controller owns restore orchestration.
- Open/Closed: acceptable. Session state extends `WorkspaceSettings` without changing the settings gateway port or UI components.
- Liskov Substitution: acceptable. Existing settings gateway implementations continue to load/save the expanded workspace settings contract.
- Interface Segregation: acceptable. Session restore does not add methods to workspace file, terminal, index, or language-server gateways.
- Dependency Inversion: acceptable. Restore uses the existing `WorkspaceFileGateway` abstraction to read real files instead of direct host APIs.

### Pattern Review

- Repository pattern: per-workspace session is persisted with workspace settings behind the settings repository boundary.
- Adapter pattern: `BrowserSettingsGateway` adapts localStorage to the richer workspace settings shape.
- Guarded restore workflow: session persistence is disabled until restore completes so opening a workspace cannot overwrite the previous session with reset state.

### Residual Risk

- Restore reopens saved files from disk and does not persist dirty unsaved buffers. Crash-safe dirty buffer restore remains a separate feature.

### Verification

- `npm run check`
- `npm test -- settings browserSettingsGateway`
- `npm test`: 81 frontend tests
- `npm run build`
- Browser smoke test for timestamped clean session-load startup
- Full gate passing; `coderabbit review --agent --fast --base main` passing with 0 findings

## 2026-06-16: Theme Polish

Scope reviewed:

- semantic active-state foreground token for readable selected rows in dark and light themes
- first-render system theme preference handling
- Monaco and xterm theme mapping from app settings
- xterm theme updates without restarting the terminal session
- pure contrast coverage for app active states and terminal text palettes

### SOLID Review

- Single Responsibility: acceptable. Theme resolution and terminal palettes live in the settings domain, contrast calculation is a separate pure helper, `App.tsx` composes resolved editor/terminal themes, and `TerminalPanel` only adapts the resolved theme to xterm.
- Open/Closed: acceptable. Additional app themes or terminal palettes can extend the domain mapping without changing terminal session lifecycle code.
- Liskov Substitution: acceptable. `TerminalPanel` still depends on the `TerminalGateway` port and accepts a `TerminalTheme` value without coupling to a concrete settings store.
- Interface Segregation: acceptable. Theme polish did not expand workspace, terminal gateway, index, or language-server contracts.
- Dependency Inversion: acceptable. UI consumers receive resolved theme data from the composition root, while terminal lifecycle still depends on the existing session adapter boundary.

### Pattern Review

- Strategy pattern: `monacoThemeForAppTheme` and `terminalThemeForAppTheme` choose editor/terminal rendering strategies from the app theme preference and system preference.
- Adapter pattern: `TerminalPanel` adapts the domain `TerminalTheme` value to xterm options and applies updates to the existing xterm instance.
- Semantic token pattern: selected tree row foreground uses `--color-active-text` instead of a hard-coded white foreground.

### Residual Risk

- Browser smoke verified system mode on the current host preference. Automated OS preference emulation can be added later if the Browser viewport/runtime grows that capability.

### Verification

- `npm run check`
- `npm test -- themeContrast settings TerminalPanel`
- `npm test`: 86 frontend tests
- `npm run build`
- `npm audit --json`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 144 Rust tests
- `npm run tauri build -- --debug --bundles app`
- Browser smoke test for light/dark/system theme switching, active-state token values, terminal lazy-load rendering, dark reset, and console errors
- `coderabbit review --agent --fast --base main`: passing with 0 findings

## 2026-06-16: Product Icon And Metadata

Scope reviewed:

- `Mockor Editor` product, window, HTML title, package, and bundle metadata
- custom source SVG and generated desktop icon assets for Tauri bundle targets
- web favicon replacement for the scaffold Vite/Tauri assets
- Rust package rename to align the internal executable with product packaging

### SOLID Review

- Single Responsibility: acceptable. Product identity is confined to packaging metadata, static icon assets, and the HTML shell.
- Open/Closed: acceptable. Future signing, notarization, update channel, and sidecar metadata can extend the bundle config without changing editor runtime code.
- Liskov Substitution: not materially affected. Runtime ports and service abstractions are unchanged.
- Interface Segregation: acceptable. No application service or gateway contracts changed.
- Dependency Inversion: not materially affected. This slice stays at the packaging/static asset boundary.

### Pattern Review

- Configuration-as-policy: Tauri bundle metadata carries product identity separately from runtime behavior.
- Generated asset pipeline: a single source SVG is used to generate the desktop icon set consumed by the bundle config.

### Residual Risk

- DMG packaging remains in P8-02B.
- Mobile Android/iOS icon readiness remains out of scope for this desktop packaging slice.
- License and homepage bundle fields remain unset until the project has explicit values.

### Verification

- `npm run check`
- `npm test`: 86 frontend tests
- `npm run build`
- `npm audit --json`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 144 Rust tests
- `npm run tauri build -- --debug --bundles app`
- `Info.plist` check for `CFBundleName`, `CFBundleDisplayName`, `CFBundleExecutable`, `CFBundleIdentifier`, `CFBundleShortVersionString`, and `CFBundleIconFile`
- Browser smoke test for `Mockor Editor` document title, `/app-icon.svg` favicon, shell render, and console errors
- `coderabbit review --agent --fast --base main`: passing with 0 findings
