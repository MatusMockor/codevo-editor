# Managed TypeScript Language Server Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a pinned TypeScript language server into the user's profile and run it with the user's Node runtime, so packaged macOS and Linux builds do not depend on bundled development `node_modules`.

**Architecture:** A Rust managed-tool module owns the profile directory, validates a host Node/npm toolchain, and runs npm on a background thread. Tool detection returns direct `lib/cli.mjs` and `tsserver.js` paths plus a resolved Node executable; the LSP planner invokes Node directly rather than a `.bin` shebang. The React workbench mirrors the managed PHPactor installation event, notice, and refresh lifecycle.

**Tech Stack:** Rust, Tauri 2 events/commands, Node/npm, TypeScript, React, Vitest.

## Global Constraints

- Support macOS and Linux; do not add Windows support as part of this change.
- Do not bundle Node.js, npm, TypeScript, or `typescript-language-server` in the application package.
- Install only under the existing user-profile managed-tool roots; never run npm in a workspace.
- Require Node 20 or newer, `typescript-language-server` 5.3.0, and TypeScript 5.8.3.
- Launch `node <tool-root>/node_modules/typescript-language-server/lib/cli.mjs --stdio`; never launch `node_modules/.bin/typescript-language-server` for managed or workspace packages.
- Preserve persisted `bundled` / `workspace` values; change only the user-facing `Bundled` label to `Managed`.

---

## File Structure

- `src-tauri/src/managed_javascript_typescript.rs`: profile-root selection, Node/npm validation, deterministic manifest, npm installer, and async-completion abstraction.
- `src-tauri/src/tools.rs`: direct package-entrypoint discovery and Node resolution for JavaScript/TypeScript plans.
- `src-tauri/src/lsp.rs`: turn resolved Node + CLI locations into an LSP command.
- `src-tauri/src/managed_javascript_typescript.rs`: update orphan cleanup to recognize `lib/cli.mjs` and managed `tsserver.js` paths.
- `src-tauri/src/lib.rs`: Tauri command, completion event, and handler registration.
- `src/domain/workspace.ts`, `src/infrastructure/tauriWorkspaceGateway.ts`: JavaScript/TypeScript install event gateway contract and Tauri adapter.
- `src/application/useWorkbenchController.ts`, `src/application/useNoticeToastRenderers.tsx`, `src/components/ManagedTypeScriptSetupNotice.tsx`: installation state, completion handling, grouped notice, and user actions.
- `src/components/SettingsDialog.tsx`: rename the preference label without changing its persisted value.

### Task 1: Implement managed tool bootstrap with Rust tests

**Files:**
- Modify: `src-tauri/src/managed_javascript_typescript.rs`
- Test: `src-tauri/src/managed_javascript_typescript.rs`

**Interfaces:**
- Produces `pub(crate) const MANAGED_TYPESCRIPT_LANGUAGE_SERVER_INSTALL_COMPLETED_EVENT: &str`.
- Produces `pub(crate) fn install_managed_typescript_language_server() -> Result<(), String>`.
- Produces `pub(crate) fn spawn_managed_typescript_language_server_install<S>(root: String, sink: S)` where `S: ManagedTypeScriptInstallEventSink`.
- Produces `pub(crate) fn managed_typescript_language_server_root() -> Result<PathBuf, String>` and `pub(crate) fn node_executable_path() -> Option<String>` for the detector/planner.

- [ ] **Step 1: Write failing managed-bootstrap tests**

```rust
#[test]
fn managed_manifest_pins_language_server_and_typescript() {
    let root = temporary_root("managed-typescript-manifest");
    write_managed_package_manifest(&root).expect("write manifest");
    assert_eq!(fs::read_to_string(root.join("package.json")).unwrap(), MANAGED_PACKAGE_JSON);
}

#[test]
fn node_override_wins_only_when_it_is_executable() {
    let _guard = TYPESCRIPT_ENV_VAR_TEST_LOCK.lock().unwrap();
    // Set CODEVO_EDITOR_NODE_PATH to an executable temporary file, then to a
    // missing path; assert the former resolves and the latter falls back.
}

#[test]
fn install_reports_node_and_npm_failures_without_touching_a_workspace() {
    // Inject a command runner that returns a missing-node error and assert the
    // error names Node/npm and the test workspace has no package.json change.
}
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `rtk cargo test managed_javascript_typescript -- --nocapture`

Expected: FAIL because the installer, manifest writer, and Node resolver do not exist.

- [ ] **Step 3: Add the managed installer and command abstraction**

```rust
const MANAGED_TYPESCRIPT_LANGUAGE_SERVER_VERSION: &str = "5.3.0";
const MANAGED_TYPESCRIPT_VERSION: &str = "5.8.3";
const CODEVO_EDITOR_NODE_PATH: &str = "CODEVO_EDITOR_NODE_PATH";

pub(crate) trait ManagedTypeScriptInstallEventSink: Send + 'static {
    fn emit_completion(&self, root: String, error: Option<String>);
}

pub(crate) fn install_managed_typescript_language_server() -> Result<(), String> {
    let root = managed_typescript_language_server_root()?;
    write_managed_package_manifest(&root)?;
    run_npm(&root, ["install", "--omit=dev", "--no-audit", "--no-fund"])?;
    verify_managed_installation(&root)
}
```

Implement `run_npm` through an injectable test-only runner. Resolve `node` from a valid `CODEVO_EDITOR_NODE_PATH` first and then `PATH`; run `node --version`, parse its major version, and reject versions below 20. Resolve npm from the Node executable's sibling directory before `PATH`, capture stdout/stderr, and include the command's failure text in the returned error. Build the exact package manifest from `MANAGED_PACKAGE_JSON`; create the root before writing it and invoke npm with `current_dir(root)`.

- [ ] **Step 4: Run the Rust module tests**

Run: `rtk cargo test managed_javascript_typescript -- --nocapture`

Expected: PASS, including manifest, Node override, version floor, npm error, idempotence, and background completion tests.

- [ ] **Step 5: Commit the managed bootstrap**

```bash
rtk git add src-tauri/src/managed_javascript_typescript.rs
rtk git commit -m "feat: bootstrap managed typescript server"
```

### Task 2: Detect direct JavaScript/TypeScript package entrypoints and plan Node launches

**Files:**
- Modify: `src-tauri/src/tools.rs`
- Modify: `src-tauri/src/lsp.rs`
- Modify: `src-tauri/src/managed_javascript_typescript.rs`
- Test: `src-tauri/src/tools.rs`
- Test: `src-tauri/src/lsp.rs`
- Test: `src-tauri/src/managed_javascript_typescript.rs`

**Interfaces:**
- Extends `JavaScriptTypeScriptToolAvailability` with `node: Option<ToolLocation>`.
- `typescript_language_server.path` becomes `<node_modules>/typescript-language-server/lib/cli.mjs` for Managed and Workspace sources.
- `TypeScriptLanguageServerPlanner::ready_plan` produces `LanguageServerCommand { executable: node.path, args: vec![server.path, "--stdio".to_string()], .. }`.

- [ ] **Step 1: Write failing detection and planner tests**

```rust
#[test]
fn managed_preference_returns_cli_mjs_and_resolved_node() {
    let tools = detector.detect(Some(&workspace), JavaScriptTypeScriptToolPreference::Bundled).unwrap();
    assert!(tools.typescript_language_server.unwrap().path.ends_with(
        "node_modules/typescript-language-server/lib/cli.mjs"
    ));
    assert_eq!(tools.node.unwrap().source, ToolSource::Path);
}

#[test]
fn ready_plan_invokes_node_with_cli_entrypoint() {
    let command = plan.command.unwrap();
    assert_eq!(command.executable, "/usr/bin/node");
    assert_eq!(command.args, vec!["/tools/node_modules/typescript-language-server/lib/cli.mjs", "--stdio"]);
}
```

Add tests for Workspace preference selecting workspace CLI/tsserver first, Workspace falling back to managed, Managed never selecting a build-checkout `bundled_node_modules_roots()` path, unavailable Node yielding an unavailable plan, and cleanup matching `lib/cli.mjs` plus its sibling `tsserver.js`.

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `rtk cargo test 'tools::tests::javascript_typescript' 'lsp::tests::javascript_typescript' managed_javascript_typescript -- --nocapture`

Expected: FAIL because the availability type has no Node location and the planner still executes the `.bin` wrapper.

- [ ] **Step 3: Implement direct-entrypoint discovery and command construction**

```rust
fn find_typescript_language_server_in_node_modules(
    node_modules: &Path,
    source: ToolSource,
) -> Option<ToolLocation> {
    let path = node_modules.join("typescript-language-server").join("lib").join("cli.mjs");
    path.is_file().then(|| tool_location("cli.mjs", path, source))
}

LanguageServerCommand {
    executable: node.path.clone(),
    args: vec![server.path.clone(), "--stdio".to_string()],
    working_directory: root.to_string_lossy().to_string(),
    env: Vec::new(),
}
```

Use the managed root from Task 1 and project `node_modules` only; remove package-build directory probing from the packaged selection path. Keep an explicit PATH tool only as a final legacy fallback where a valid Node is also resolved. Update `typescript_language_server_path_in_command` to recognize `typescript-language-server/lib/cli.mjs`, derive `node_modules` from that path, and preserve cleanup protection for workspace-specific `tsserver.js` processes.

- [ ] **Step 4: Run targeted Rust tests**

Run: `rtk cargo test 'tools::tests::javascript_typescript' 'lsp::tests::javascript_typescript' managed_javascript_typescript -- --nocapture`

Expected: PASS; all command assertions must name Node as the executable and `lib/cli.mjs` as the first argument.

- [ ] **Step 5: Commit detection and planner changes**

```bash
rtk git add src-tauri/src/tools.rs src-tauri/src/lsp.rs src-tauri/src/managed_javascript_typescript.rs
rtk git commit -m "feat: launch typescript server with managed node"
```

### Task 3: Expose the managed TypeScript installer through Tauri

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces Tauri command `install_managed_typescript_language_server(app: AppHandle, root: String)`.
- Emits `typescript://managed-language-server-install-completed` payload `{ root: String, error: Option<String> }`.

- [ ] **Step 1: Write a failing command-registration and event-sink test**

```rust
#[test]
fn managed_typescript_install_event_contains_workspace_and_error() {
    let event = ManagedTypeScriptInstallCompletionEvent {
        root: "/workspace".to_string(),
        error: Some("Node 20 or newer is required".to_string()),
    };
    assert_eq!(event.root, "/workspace");
    assert!(event.error.unwrap().contains("Node 20"));
}
```

Add the command to the existing `tauri::generate_handler!` compilation regression test so a missing registration fails at compile time.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `rtk cargo test managed_typescript_install -- --nocapture`

Expected: FAIL because the event type and command are absent.

- [ ] **Step 3: Add the event adapter and command**

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedTypeScriptInstallCompletionEvent { root: String, error: Option<String> }

#[tauri::command]
fn install_managed_typescript_language_server(app: AppHandle, root: String) {
    managed_javascript_typescript::spawn_managed_typescript_language_server_install(
        root,
        AppHandleManagedTypeScriptInstallEventSink { app },
    );
}
```

Make the sink emit `typescript://managed-language-server-install-completed`, and add the command beside `install_managed_phpactor` in the generated handler list.

- [ ] **Step 4: Run Tauri/Rust command tests**

Run: `rtk cargo test managed_typescript_install -- --nocapture && rtk cargo check`

Expected: PASS and command registration compiles.

- [ ] **Step 5: Commit the Tauri bridge**

```bash
rtk git add src-tauri/src/lib.rs
rtk git commit -m "feat: expose managed typescript installer"
```

### Task 4: Add frontend gateway, installation state, and completion lifecycle

**Files:**
- Modify: `src/domain/workspace.ts`
- Modify: `src/infrastructure/tauriWorkspaceGateway.ts`
- Modify: `src/application/useWorkbenchController.ts`
- Test: `src/infrastructure/tauriWorkspaceGateway.test.ts`
- Test: `src/application/useWorkbenchController.preview.test.tsx`

**Interfaces:**
- Produces `ManagedTypeScriptInstallCompletionEvent` and `JavaScriptTypeScriptToolGateway` with `installManagedTypeScriptLanguageServer` and `subscribeManagedTypeScriptLanguageServerInstall`.
- Adds `installingManagedTypeScriptLanguageServer: boolean` and `installManagedTypeScriptLanguageServer(): Promise<void>` to the workbench view model.

- [ ] **Step 1: Write failing Tauri gateway and controller tests**

```ts
it("schedules a managed TypeScript installation and subscribes to its event", async () => {
  await gateway.installManagedTypeScriptLanguageServer("/workspace");
  expect(invoke).toHaveBeenCalledWith("install_managed_typescript_language_server", { root: "/workspace" });
});

it("refreshes the TypeScript plan only after a successful active-workspace completion", async () => {
  emitCompletion({ root: "/workspace", error: null });
  await flushAsyncTurns();
  expect(planJavaScriptTypeScriptLanguageServer).toHaveBeenCalledWith("/workspace", expect.anything());
});
```

Also assert error completion clears the busy state, reports the backend message, and does not refresh a different active workspace.

- [ ] **Step 2: Run the frontend tests and verify they fail**

Run: `rtk npm test -- --run src/infrastructure/tauriWorkspaceGateway.test.ts src/application/useWorkbenchController.preview.test.tsx`

Expected: FAIL because the TypeScript installer gateway and completion subscription do not exist.

- [ ] **Step 3: Implement the gateway and controller lifecycle**

```ts
export interface JavaScriptTypeScriptToolGateway {
  installManagedTypeScriptLanguageServer(root: string): Promise<void>;
  subscribeManagedTypeScriptLanguageServerInstall(
    listener: (event: ManagedTypeScriptInstallCompletionEvent) => void,
  ): Promise<ManagedTypeScriptInstallUnsubscribeFn>;
}
```

Use the exact lifecycle guard already used for PHPactor: capture the root before invoking, make the busy flag root-specific, ignore stale events, clear the flag on every completion, call `refreshJavaScriptTypeScriptLanguageServerPlan` after success, and surface `event.error` through the active-workspace error reporter. Keep the install command non-blocking: the frontend waits only for the completion event.

- [ ] **Step 4: Run the focused frontend tests**

Run: `rtk npm test -- --run src/infrastructure/tauriWorkspaceGateway.test.ts src/application/useWorkbenchController.preview.test.tsx`

Expected: PASS for successful install, failure, stale workspace, and duplicate-click handling.

- [ ] **Step 5: Commit the lifecycle**

```bash
rtk git add src/domain/workspace.ts src/infrastructure/tauriWorkspaceGateway.ts src/application/useWorkbenchController.ts src/infrastructure/tauriWorkspaceGateway.test.ts src/application/useWorkbenchController.preview.test.tsx
rtk git commit -m "feat: add managed typescript install lifecycle"
```

### Task 5: Present the setup notice and rename the preference label

**Files:**
- Create: `src/components/ManagedTypeScriptSetupNotice.tsx`
- Modify: `src/application/useNoticeToastRenderers.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Test: `src/components/ManagedTypeScriptSetupNotice.test.tsx`
- Test: `src/application/useNoticeToastRenderers.test.tsx`
- Test: `src/components/SettingsDialog.test.tsx`

**Interfaces:**
- Produces `managedTypeScriptSetupNoticeToastRenderer(context)` with group key `typescript-setup:<workspace-root>`.
- Extends `NoticeToastRendererContext` with `onInstallManagedTypeScriptLanguageServer` and `isInstallingManagedTypeScriptLanguageServer`.

- [ ] **Step 1: Write failing notice and settings tests**

```tsx
it("renders an install action for a trusted workspace with an unavailable TypeScript plan", () => {
  render(<ManagedTypeScriptSetupNotice onDismiss={vi.fn()} onInstallNow={install} onOpenManualSetup={manual} isInstalling={false} />);
  expect(screen.getByRole("button", { name: "Install now" })).toBeEnabled();
});

it("labels the persisted bundled preference as Managed", () => {
  renderSettings({ javaScriptTypeScriptVersion: "bundled" });
  expect(screen.getByText("Managed")).toBeVisible();
});
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run: `rtk npm test -- --run src/components/ManagedTypeScriptSetupNotice.test.tsx src/application/useNoticeToastRenderers.test.tsx src/components/SettingsDialog.test.tsx`

Expected: FAIL because the notice renderer and Managed label are absent.

- [ ] **Step 3: Implement the notice and wire it into the renderer map**

```tsx
export function managedTypeScriptSetupNoticeGroupKey(workspaceRoot: string | null): string | null {
  return workspaceRoot ? `typescript-setup:${workspaceRoot}` : null;
}
```

Render a warning toast titled `TypeScript IDE Engine missing`, describing the one-click user-profile bootstrap (not bundled), with `Manual install` and busy-aware `Install now` actions. Show it only for trusted workspaces with the JavaScript/TypeScript service enabled and an unavailable JavaScript/TypeScript LSP plan. Change `<option value="bundled">Bundled</option>` to `<option value="bundled">Managed</option>` without changing the value or settings normalizer.

- [ ] **Step 4: Run UI tests and TypeScript check**

Run: `rtk npm test -- --run src/components/ManagedTypeScriptSetupNotice.test.tsx src/application/useNoticeToastRenderers.test.tsx src/components/SettingsDialog.test.tsx && rtk npm run check`

Expected: PASS; the stored `bundled` setting still serializes and renders as Managed.

- [ ] **Step 5: Commit the setup UI**

```bash
rtk git add src/components/ManagedTypeScriptSetupNotice.tsx src/application/useNoticeToastRenderers.tsx src/components/SettingsDialog.tsx src/components/ManagedTypeScriptSetupNotice.test.tsx src/application/useNoticeToastRenderers.test.tsx src/components/SettingsDialog.test.tsx
rtk git commit -m "feat: prompt to install managed typescript server"
```

### Task 6: Verify the packaged behavior

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-managed-typescript-bootstrap-design.md` only if actual pinned versions or verification outcomes differ from the approved design.

**Interfaces:**
- Consumes all previous tasks.
- Produces a macOS/Linux-safe AppImage verification record in the final handoff; no package resources are added.

- [ ] **Step 1: Run complete static and focused test suites**

Run:

```bash
rtk cargo test tools::tests lsp::tests managed_javascript_typescript -- --nocapture
rtk npm run check
rtk npm test -- --run src/infrastructure/tauriWorkspaceGateway.test.ts src/components/ManagedTypeScriptSetupNotice.test.tsx src/application/useNoticeToastRenderers.test.tsx
```

Expected: all targeted tests PASS.

- [ ] **Step 2: Build an AppImage and inspect the package contents**

Run:

```bash
rtk npm run tauri build -- --bundles appimage
rtk proxy find src-tauri/target/release/bundle/appimage -maxdepth 1 -type f -name '*.AppImage' -printf '%f %s bytes\n'
```

Expected: an x86_64 AppImage is produced; its build configuration contains no Node binary or application `node_modules` resource.

- [ ] **Step 3: Smoke test the managed launch path**

Run the AppImage from a GUI-like environment whose inherited `PATH` does not contain a development checkout. With a supported system Node/npm available, click Install now and confirm the emitted plan command has the Node executable followed by `typescript-language-server/lib/cli.mjs --stdio`; repeat with Node unavailable and confirm the notice reports the actionable requirement instead of `/usr/bin/env: node`.

- [ ] **Step 4: Commit any verification-driven documentation correction**

```bash
rtk git add docs/superpowers/specs/2026-07-13-managed-typescript-bootstrap-design.md
rtk git commit -m "docs: record managed typescript verification"
```

Only create this commit if Step 3 exposed a necessary accurate-doc update; otherwise leave the committed spec unchanged.
