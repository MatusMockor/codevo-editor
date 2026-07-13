# Trusted Workspace macOS and Linux Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing trusted-workspace command path on macOS and Linux so a Linux AppImage provides the same scoped workspace functionality.

**Architecture:** Keep one descriptor-scoped command API while adding Linux syscall adapters for the macOS-specific filesystem primitives. Linux resolves untrusted descendants with `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)`, preserves mode and xattrs during atomic saves, and uses `renameat2` for no-replace and exchange operations. macOS-only menu and close-window behavior remain unchanged.

**Tech Stack:** Rust, Tauri 2, `tauri-plugin-dialog`, React/TypeScript, Vite.

## Global Constraints

- Support macOS and Linux with the same trusted descriptor security model.
- Do not introduce path-based Linux fallbacks or duplicate command implementations.
- Keep Windows outside this change's support commitment.
- Preserve macOS-only menus and native close handling.

---

### Task 1: Port the retained-root registry to Linux

**Files:**
- Modify: `src-tauri/src/workspace_registry.rs:1-390`
- Test: `src-tauri/src/workspace_registry.rs` Linux tests for registered roots, rejected traversal, and rejected symlinks.

**Interfaces:**
- Consumes: A selected workspace root and untrusted descriptor-relative paths.
- Produces: Retained root descriptors that can safely open regular descendant files on macOS and Linux.

- [ ] **Step 1: Run the failing Linux compilation regression check**

Run: `cd src-tauri && cargo check`

Expected: FAIL because the registry is compiled only for macOS and Linux lacks the retained-root state and syscall implementation.

- [ ] **Step 2: Make the trusted workspace implementation platform-neutral**

In `workspace_registry.rs`, compile shared registry state for macOS and Linux. Keep Darwin's retained-FD APIs unchanged and add Linux adapters that:

- open a selected root as a directory FD;
- resolve a descendant with `openat2` and `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`;
- use `/proc/self/fd/<fd>` for the retained root path;
- return `Unknown` for filesystem case and Unicode policies on Linux;
- retain the existing tests and enable their Linux variants.

- [ ] **Step 3: Run registry tests on Linux**

Run: `cd src-tauri && cargo check`

Expected: PASS; Linux rejects traversal and symlink escapes while allowing regular descendants.

- [ ] **Step 4: Commit the registry port**

```bash
git add src-tauri/src/workspace_registry.rs
git commit -m "feat: port workspace registry to linux"
```

### Task 2: Port descriptor file operations and Tauri registration

**Files:**
- Modify: `src-tauri/src/workspace_file_commands.rs`, `src-tauri/src/lib.rs:1-650`
- Test: `src-tauri/src/workspace_file_commands.rs` Linux tests.

**Interfaces:**
- Consumes: `WorkspaceRegistry` retained root descriptors.
- Produces: The existing workspace-scoped Tauri commands on macOS and Linux.

- [ ] **Step 1: Write Linux regression tests**

Add Linux assertions for saving an executable or non-default-mode file, preserving its `user.*` xattr, and refusing symlinked paths.

- [ ] **Step 2: Verify the tests fail before the Linux adapters exist**

Run: `cd src-tauri && cargo test workspace_file_commands`

Expected: FAIL to compile because the macOS-only file-command APIs are unavailable on Linux.

- [ ] **Step 3: Implement Linux filesystem adapters**

Replace macOS-only operations with cfg-selected helpers: `openat2` for full relative resolution, `renameat2(RENAME_NOREPLACE | RENAME_EXCHANGE)` for atomic mutation operations, Linux xattr syscalls plus `fchmod` for save metadata, and Linux errno clearing before `readdir`. Leave Darwin implementations intact.

Remove the macOS-only guards from trusted-workspace imports, commands, picker, cleanup, and module registration in `lib.rs`. Remove non-macOS error-only picker and registry command variants. Keep macOS-only menus and close handling guarded.

- [ ] **Step 4: Run the command regression suite**

Run: `cd src-tauri && cargo test workspace_file_commands`

Expected: PASS, including Linux mode/xattr preservation and scoped-operation tests.

- [ ] **Step 5: Verify Tauri command registration**

Run: `cd src-tauri && cargo check`

Expected: PASS with no missing `__tauri_command_name_workspace_*` macro errors.

- [ ] **Step 6: Commit the Linux command port**

```bash
git add src-tauri/src/workspace_file_commands.rs src-tauri/src/lib.rs
git commit -m "feat: enable trusted workspace commands on linux"
```

### Task 3: Verify the app and Linux packaging path

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
