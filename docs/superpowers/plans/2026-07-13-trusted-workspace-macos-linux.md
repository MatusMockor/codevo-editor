# Trusted Workspace macOS and Linux Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing trusted-workspace command path on macOS and Linux so a Linux AppImage provides the same scoped workspace functionality.

**Architecture:** Remove the macOS-only compilation gates from the platform-neutral trusted-workspace registry integration. The same `WorkspaceRegistry`, descriptor file repository, dialog-backed picker, and registered Tauri command set will run on both desktop targets. macOS-only menu and close-window behavior remain unchanged.

**Tech Stack:** Rust, Tauri 2, `tauri-plugin-dialog`, React/TypeScript, Vite.

## Global Constraints

- Support macOS and Linux with the same trusted descriptor security model.
- Do not introduce path-based Linux fallbacks or duplicate command implementations.
- Keep Windows outside this change's support commitment.
- Preserve macOS-only menus and native close handling.

---

### Task 1: Compile the trusted workspace commands for Linux

**Files:**
- Modify: `src-tauri/src/lib.rs:1-150, 300-650`
- Test: Linux Rust compilation of `src-tauri/src/lib.rs` and its Tauri handler registration.

**Interfaces:**
- Consumes: `WorkspaceRegistry`, `workspace_file_commands::*`, and `tauri_plugin_dialog::DialogExt`.
- Produces: The existing Tauri commands (`open_workspace_from_picker`, `workspace_read_text_file`, `workspace_save_text_file`, and related descriptor commands) on Linux as well as macOS.

- [ ] **Step 1: Run the failing Linux compilation regression check**

Run: `cd src-tauri && cargo check`

Expected: FAIL because `workspace_read_text_file` is registered in `tauri::generate_handler!` but is not compiled on Linux.

- [ ] **Step 2: Make the trusted workspace implementation platform-neutral**

In `src-tauri/src/lib.rs`, remove the `#[cfg(target_os = "macos")]` guards from:

```rust
mod workspace_file_commands;
use tauri_plugin_dialog::DialogExt;
use workspace_file_commands::{ /* existing imports */ };
```

Remove the macOS-only guards from the descriptor registry cleanup and from every trusted workspace command. Remove the non-macOS error-only implementations of `open_workspace_from_picker`, `unregister_workspace`, and `get_workspace_descriptor`, leaving the existing registry-backed definitions as the single implementation.

Keep the `tauri::menu` imports, menu constants, `application_menu`, and the `WindowEvent::CloseRequested` interception macOS-only.

- [ ] **Step 3: Run the regression check again**

Run: `cd src-tauri && cargo check`

Expected: PASS with no missing `__tauri_command_name_workspace_*` macro errors.

- [ ] **Step 4: Run Rust unit tests for the trusted command dependencies**

Run: `cd src-tauri && cargo test workspace_registry workspace_file_commands`

Expected: PASS; registered workspace IDs continue to constrain relative paths and mutations.

- [ ] **Step 5: Commit the implementation**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: enable trusted workspaces on linux"
```

### Task 2: Verify the app and Linux packaging path

**Files:**
- Verify: `package.json`, `src-tauri/tauri.conf.json`, and the AppImage artifact under `src-tauri/target/release/bundle/appimage/`.

**Interfaces:**
- Consumes: The existing `npm run tauri build -- --bundles appimage` script forwarding and Tauri bundle configuration.
- Produces: A release AppImage compiled with the descriptor-scoped Tauri commands.

- [ ] **Step 1: Type-check the frontend**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 2: Run the frontend test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Build the Linux AppImage**

Run: `npm run tauri build -- --bundles appimage`

Expected: PASS and produce `src-tauri/target/release/bundle/appimage/*.AppImage`.

- [ ] **Step 4: Inspect the artifact**

Run: `file src-tauri/target/release/bundle/appimage/*.AppImage`

Expected: an ELF 64-bit x86-64 AppImage executable.

- [ ] **Step 5: Commit the approved plan record**

```bash
git add docs/superpowers/plans/2026-07-13-trusted-workspace-macos-linux.md
git commit -m "docs: plan linux trusted workspace support"
```
