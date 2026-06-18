# JavaScript and TypeScript VS Code Parity

## Goal

JavaScript and TypeScript language intelligence must work in Basic mode. PHP IDE Mode should control PHP/Laravel indexing and PHP language-server cost only; JS/TS support should feel like VS Code out of the box.

## What VS Code Does

- VS Code ships JavaScript and TypeScript support as a built-in extension named `TypeScript and JavaScript Language Features`.
- That extension uses TypeScript Language Service / `tsserver`, not the PHP-style project index.
- Project-wide IntelliSense depends on loading the project through `tsconfig.json` or `jsconfig.json`. If that cannot happen, VS Code drops to partial mode where only currently opened files are reliable.
- Programmatic language features include hover, completions, diagnostics, go to definition, formatting, refactoring, folding, and related navigation.
- The VS Code tsserver client sets inferred project options such as `allowJs`, `allowNonTsExtensions`, and `resolveJsonModule`, and has explicit process crash/restart handling.

Sources checked:

- https://code.visualstudio.com/docs/languages/typescript
- https://code.visualstudio.com/docs/nodejs/working-with-javascript
- https://code.visualstudio.com/api/language-extensions/overview
- https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
- https://github.com/microsoft/vscode/blob/main/extensions/typescript-language-features/src/typescriptServiceClient.ts

## Current State In Our Editor

- Monaco has a TypeScript worker wired for `typescript` and `javascript`.
- The editor already detects `.js`, `.jsx`, `.ts`, and `.tsx`.
- The indexer extracts lightweight JS/TS symbols for project symbol search.
- PHPactor remains PHP-only, which is correct because PHPactor must not receive JS/TS documents.
- JS/TS now has a managed `typescript-language-server` LSP runtime that is independent from PHP IDE Mode.
- JS/TS documents are synchronized with the managed language server and diagnostics are routed back to Monaco.
- JS/TS Monaco providers now cover hover, completions, signature help, go to definition, go to implementation, references, rename, code actions and document formatting.
- JS/TS file structure now uses managed language-server document symbols in Basic mode instead of relying on the PHP/index outline path.
- JS/TS `Cmd+O` type search now merges TypeScript workspace symbols with the local index, so Basic mode can find classes and interfaces before the lightweight index is warm.

## Implemented First Slice

- Configure Monaco TypeScript/JavaScript defaults on editor mount:
  - eager model sync
  - syntax and semantic diagnostics enabled
  - inferred project compiler options for JS/TS partial mode
- Route JS/TS `Cmd+B` to Monaco's native definition action.
- Route JS/TS `Cmd+Alt+B` to Monaco's native implementation action.
- Keep PHP navigation on our PHP controller and implementation chooser.

This gives a stronger Basic-mode partial experience without starting any PHP IDE process.

## Implemented Managed LSP Slice

- Added a managed JS/TS language-server runtime using `typescript-language-server --stdio`.
- Added workspace-root keyed JS/TS runtime status and document sync.
- Added JS/TS LSP feature commands for:
  - hover
  - completion
  - definition
  - implementation
  - references
  - rename
  - code actions
  - document formatting
- Added Monaco providers for JS/TS references, rename, quick fixes/refactors/source actions and formatting.
- Routed JS/TS quick-fix shortcut through Monaco so Option+Enter can surface tsserver actions.
- Added unit and Rust coverage for the new feature gateway, request factory and Monaco mappings.

## Implemented Executable Code Actions Slice

- Added `codeAction/resolve` support for JS/TS and the shared language-server feature contract.
- Added `workspace/executeCommand` support for JS/TS and PHP LSP feature gateways.
- Monaco now keeps command-only and data-only LSP code actions instead of dropping them.
- Resolved code actions can turn into real Monaco workspace edits.
- Executed language-server commands can apply returned workspace edits to open Monaco models.
- TypeScript `source.organizeImports` and direct-edit quick fixes now flow through the same executable path as VS Code-style actions.
- Server-initiated `workspace/applyEdit` requests now emit Tauri workspace-edit events and are applied to open Monaco models, which covers TypeScript command paths that do not return edits directly.
- Completion items now preserve richer LSP metadata (`textEdit`, `additionalTextEdits`, `sortText`, `filterText`, `commitCharacters`, snippet format) so auto imports and exact replacement ranges are not dropped.
- Completion lists now preserve LSP `isIncomplete`, and completion items preserve `preselect`, so Monaco can keep requesting narrowed suggestions and select the server-preferred item more like VS Code.
- `completionItem/resolve` is wired through the JS/TS language-server gateway and Monaco provider, matching the VS Code pattern of lazily resolving documentation and import edits for focused suggestions.
- `textDocument/inlayHint` is wired through the managed JS/TS language server and Monaco provider, giving light mode VS Code-style inline type/parameter hints when the server advertises support.
- `textDocument/signatureHelp` is wired through the managed JS/TS language server and Monaco provider, so function calls can show VS Code-style active signatures and parameter documentation.
- `textDocument/documentSymbol` is wired through the shared LSP gateway and JS/TS Basic-mode file structure, giving `Cmd+R` a VS Code-like outline for JavaScript and TypeScript files without PHP IDE Mode.
- `workspace/symbol` is wired through the shared LSP gateway and JS/TS `Cmd+O` search, giving Basic mode VS Code-like project symbol lookup from TypeScript server state.
- JavaScript/TypeScript service can now be set per workspace to Auto or Off. Off stops the running managed TS service, clears synced JS/TS state, and prevents Basic-mode auto-start.
- TypeScript version preference can now be set per workspace to Bundled or Workspace. Workspace mode prefers the project `node_modules/typescript/lib/tsserver.js` and restarts the managed JS/TS service when the preference changes.
- JavaScript/TypeScript validation and inlay hints are now per-workspace settings. Validation Off clears and ignores JS/TS diagnostics; inlay hints flow into TypeScript server preferences and restart the managed JS/TS service when changed.
- JavaScript/TypeScript Auto Imports is now a per-workspace setting. Off disables TypeScript module-export/import-statement completions and package.json auto-import suggestions in the managed JS/TS server preferences.
- Settings now include a per-workspace Restart JavaScript/TypeScript service action, so users can refresh the managed TS runtime after dependency or TypeScript-version changes without restarting the whole editor.
- Settings now include an Open JavaScript/TypeScript service log action. The managed runtime captures bounded server stderr per workspace and writes/opens a readable log file for debugging TS service startup, crashes, and degraded IntelliSense.
- Workspace detection now includes a JavaScript/TypeScript project descriptor for `package.json`, `tsconfig.json`, `jsconfig.json`, package manager and common framework markers. The status bar can show this JS/TS project context in Basic mode when editing JS/TS files.
- The managed LSP supervisor now answers TypeScript/JavaScript `workspace/configuration` requests with the runtime preferences derived from initialize settings, keeping tsserver-wrapper behavior aligned with service settings instead of returning empty configuration.
- TypeScript/JavaScript document highlights are now served by the managed language server in Basic mode, so symbol reads/writes under the cursor can be highlighted like VS Code.
- TypeScript/JavaScript selection ranges are now served by the managed language server in Basic mode, giving smart expand-selection data from tsserver instead of only word-based selection.
- TypeScript/JavaScript range formatting is now served by the managed language server in Basic mode, so formatting a selection uses the same LSP path as full document formatting.
- TypeScript/JavaScript document links are now served by the managed language server in Basic mode, including lazy `documentLink/resolve` for links whose target is resolved on demand.
- TypeScript/JavaScript folding ranges are now served by the managed language server in Basic mode, so code folding can follow TypeScript service structure instead of relying only on text indentation.
- TypeScript/JavaScript rename now uses `textDocument/prepareRename` when the server advertises it, giving Monaco the same VS Code-style rename range, placeholder, and rejection reason before applying workspace edits.
- TypeScript/JavaScript semantic tokens are now served by the managed language server in Basic mode and mapped into Monaco's document semantic token provider, giving VS Code-like symbol-aware highlighting beyond syntax colors when the server advertises support.
- Workspace detection now reads installed workspace TypeScript versions from `node_modules/typescript/package.json` and TypeScript dependency constraints from `package.json`. The status bar can show Bundled vs Workspace TypeScript context while editing JavaScript/TypeScript files, closer to VS Code's TypeScript version status.
- The managed TypeScript server configuration now sends VS Code-like completion/refactor preferences, inferred project defaults, and `formattingOptions` responses, so completion snippets, organize imports and file edits get the same client-side context that `typescript-language-server` expects from VS Code-style clients.
- TypeScript/JavaScript completion now advertises and preserves VS Code-like label details, commit characters, preselect support and insert/replace completion ranges, so method/function suggestions keep richer signature context and more precise replacement behavior.
- JS/TS document sync now sends VS Code-style language ids for React documents (`javascriptreact` and `typescriptreact`) while keeping editor model languages stable. The workspace, index and git language detectors also recognize Node/TypeScript module extensions (`.mjs`, `.cjs`, `.mts`, `.cts`), so those files no longer fall back to plaintext.
- TypeScript/JavaScript type-definition navigation is now wired through the managed language server and Monaco provider. Linked editing ranges are also advertised and mapped, enabling VS Code-style paired JSX tag editing when the TypeScript server supports it. Signature help now listens to TypeScript's `<` trigger and `)` retrigger as well as function-call commas.
- TypeScript/JavaScript CodeLens is wired through the managed language server and Monaco provider. References/implementations CodeLens is disabled by default and can be enabled per workspace in settings.
- TypeScript/JavaScript file rename edits now use `workspace/willRenameFiles` before local file rename and `workspace/didRenameFiles` after local file rename. Closed-file import edits are written to disk through the workspace layer, while open-file edits are applied to editor buffers.
- TypeScript/JavaScript file create/delete operations now notify the managed language server through `workspace/didChangeWatchedFiles`, so editor-originated file changes update the TypeScript project graph without requiring a service restart.

## Full VS Code-Like Target

### Runtime

Add a managed JS/TS language-service runtime independent from PHP IDE Mode:

- `JavaScriptTypeScriptRuntimeGateway`
- `JavaScriptTypeScriptDocumentSyncGateway`
- `JavaScriptTypeScriptFeaturesGateway`
- Tauri supervisor keyed by workspace root
- managed `tsserver` or a thin LSP wrapper over tsserver
- bundled TypeScript fallback plus workspace TypeScript preference

Recommended first backend option:

- Use `typescript-language-server --stdio` as an LSP bridge for faster integration.
- Later replace or augment it with a direct tsserver client if we need exact VS Code protocol behavior.

### Project Detection

Detect JS/TS projects independently:

- `package.json`
- `tsconfig.json`
- `jsconfig.json`
- framework markers:
  - React / Next.js / Vite
  - Vue / Nuxt
  - Svelte / SvelteKit
  - Angular
  - Node / Express / NestJS
  - implemented for common package markers in the workspace descriptor

### Feature Expectations

Basic mode must support:

- hover
- completions and auto imports
- go to definition
- go to implementation
- find references
- rename symbol
- prepare rename / rename validation. Implemented through LSP-backed Monaco provider.
- workspace symbols
- document symbols
- diagnostics
- quick fixes
- organize imports
- workspace/configuration response. Implemented for managed JS/TS LSP preferences.
- formatting
- range formatting / format selection. Implemented through LSP-backed Monaco provider.
- document links. Implemented through LSP-backed Monaco provider with resolve support.
- folding ranges. Implemented through LSP-backed Monaco provider.
- inlay hints. Implemented through LSP-backed Monaco provider.
- signature help. Implemented through LSP-backed Monaco provider.
- document highlights. Implemented through LSP-backed Monaco provider.
- selection ranges / smart selection. Implemented through LSP-backed Monaco provider.
- semantic tokens / semantic highlighting. Implemented through LSP-backed Monaco provider.
- go to type definition. Implemented through LSP-backed Monaco provider.
- linked editing for JSX/TSX paired ranges. Implemented when the TypeScript language server advertises support.
- code lenses for references/implementations. Implemented through LSP-backed Monaco provider when enabled in workspace settings.
- update imports on file rename. Implemented through managed TypeScript LSP file-operation requests.
- file create/delete project graph refresh. Implemented for editor-originated JS/TS file operations through `workspace/didChangeWatchedFiles`.
- filesystem watcher refresh for external creates/changes/deletes. Still needed for full VS Code parity; should reuse the Rust workspace watcher with per-workspace JS/TS service lifecycle.
- document symbols / file structure. Implemented for JS/TS through managed LSP-backed `Cmd+R`.
- workspace symbols. Implemented for JS/TS-backed `Cmd+O` type search.
- JS/TS version status. Implemented in the workspace status label for Bundled, Workspace, installed workspace version, and dependency-only fallback.

### Isolation

With multi-project tabs:

- each project has its own JS/TS service state
- closing a project tab kills that project's tsserver
- switching projects must not leak diagnostics or navigation targets
- app quit kills all JS/TS processes

### Settings

Add settings:

- JavaScript/TypeScript service: Auto / Off
- TypeScript version: bundled / workspace. Done.
- JavaScript validation on/off. Done.
- Auto imports on/off. Done.
- Inlay hints on/off. Done.
- Restart JS/TS service. Done.
- Open JS/TS service log. Done.
- CodeLens on/off. Done.

## Tests

### Unit

- JS/TS editor actions use Monaco native navigation in partial mode.
- PHP editor actions still use PHP controller.
- TS/JS settings normalize and persist.
- Project detection finds `tsconfig`, `jsconfig`, and framework packages.

### Rust

- JS/TS runtime starts per workspace root.
- Stopping workspace A does not kill workspace B.
- Stop-all kills all tsserver children.
- Crashed tsserver does not restart forever.

### Integration

- Open a TS project in Basic mode and verify hover/completion/definition.
- Open a React/Next project and verify JSX/TSX completions.
- Verify `Cmd+B` and `Cmd+Alt+B` work without PHP IDE Mode.
- Verify closing a project tab leaves no tsserver process behind.

## Rollout

1. Partial-mode Monaco fixes.
2. JS/TS project detector and settings.
3. Managed tsserver/LSP runtime. Done for `typescript-language-server`.
4. Document sync and diagnostics routing. Done for managed JS/TS LSP.
5. Navigation, references, rename, quick fixes, organize imports. Mostly done; command-only LSP actions now resolve and execute, and server-initiated `workspace/applyEdit` now applies to open Monaco models.
6. Framework-specific plugins and deeper project setting parity.
