# Packaging Runtime Readiness

Date: 2026-10-15
Status: Desktop packaging audit for the agent app

This document records what the packaged desktop app can rely on today, what it discovers from the host, and what must be hardened before release packaging.

Codevo is an agent app. The code editor, language servers (PHPactor, Intelephense, the TypeScript language server), workspace indexes, text search, test runners, and eslint/prettier integration were removed by owner decision, so the packaged app no longer discovers or launches those tools.

## Summary

| Area | Current readiness | Release decision |
| --- | --- | --- |
| App bundle identity | Ready for desktop `.app` bundles | Product name, icon, version, identifier, publisher, and executable name are set. |
| Agent CLIs (Claude Code, Codex) | Discovered from the login-shell `PATH` and bounded well-known directories | Not bundled; **Settings > Providers** shows install and sign-in guidance. |
| Terminal runtime | Works through host shell/PTY for trusted workspaces | Keep trust gate; document host shell dependency. |
| Git and worktrees | Works when host `git` is discoverable | Not bundled; required for worktree, diff, history, and shipping flows. |
| Package scripts | Runs through the host package manager for trusted workspaces | Not bundled; uses the same effective `PATH` as agent turns. |
| Remote runner | SSH tunnel to an existing Linux runner | Host `ssh` and a verified known-hosts entry are required; see `docs/remote-runner-editor.md`. |
| Sidecars | None configured | Host-runtime build; see `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`. |
| Trust/settings data | Ready | Trust file is app-config scoped; agent threads and history are app-data scoped; settings are browser localStorage. |
| DMG packaging | Ready | Release builds produce `.app` and `.dmg`. |
| Signing/notarization | See plan | `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`. |
| Update channel | Tauri updater on the `beta` channel | See `docs/UPDATE_CHANNEL_PLAN.md` and `docs/release.md`. |
| macOS release CI | Workflow ready | `.github/workflows/macos-release.yml`; see `docs/MACOS_RELEASE_CI.md`. |
| Windows/Linux packaging | Not ready | See `docs/WINDOWS_LINUX_FEASIBILITY.md`. |

## Product And Bundle

- Product name: `Codevo`
- Identifier: `dev.mockor.editor`
- Executable: `Contents/MacOS/codevo-editor`
- Icon resource: `Contents/Resources/icon.icns`
- Bundle category: `DeveloperTool`

### One-Time Bundle Rename Migration

`Codevo Editor.app` has a different bundle name from the previous `Mockor Editor.app`. Before the first Codevo-branded release or any manual upgrade to it, remove the existing `Mockor Editor.app` from `/Applications` and install `Codevo Editor.app` from the new DMG. Copying the new bundle without removing the old one can leave both applications installed and launchable. This is a one-time manual replacement; no release or updater migration machinery is implemented.

The later rename from `Codevo Editor` to `Codevo` changes the bundle name again, to `Codevo.app`. The in-app updater replaces the running bundle in place, so an updated install keeps the folder name `Codevo Editor.app` while the app itself reports `Codevo`. A fresh DMG install creates a separate `Codevo.app` with the same identifier and settings; remove the old `Codevo Editor.app` after the new one opens. This is a one-time manual step.

Verified `Info.plist` fields:

- `CFBundleName`
- `CFBundleDisplayName`
- `CFBundleExecutable`
- `CFBundleIdentifier`
- `CFBundleShortVersionString`
- `CFBundleIconFile`

Release metadata still missing:

- license identifier or license file
- homepage
- Windows/Linux runner and signing policy
- sidecar bundle metadata

## External Tool Discovery

### Agent CLIs

Claude Code and Codex are not bundled. Codevo discovers them from the login-shell `PATH` and bounded well-known installation directories, or from an absolute path override in **Settings > Providers**.

Packaged-build behavior:

- A GUI-launched macOS `.app` may have a narrower `PATH` than an interactive shell; discovery uses the login-shell `PATH` to compensate.
- The same effective `PATH` applies to agent turns, sign-in terminals, regular terminals, and package-script runs.
- Agents start only in trusted projects.
- Missing or unauthenticated providers show install and sign-in guidance instead of failing silently.

### Git

Git is not bundled. Worktree isolation, diff, history, commit, push, pull request, and integration flows require host `git` visible to the app process.

### Package Scripts

Package scripts run through the host package manager in trusted workspaces, with no shell command strings and bounded output and time.

## Runtime Status And Crash Semantics

### Terminal

Backend events:

```text
terminal://status
terminal://output
```

Statuses:

- `starting`
- `running`
- `stopped`
- `exited`
- `crashed`

Packaged-build behavior:

- Terminal launch requires a trusted workspace.
- Default shell is provided by `portable-pty`.
- Platform profile uses `$SHELL` on Unix-like systems.
- Windows profiles are PowerShell and Command Prompt.
- Stop requests kill and join reader/waiter threads.
- A GUI-launched macOS `.app` may not inherit the same shell environment or `PATH` as an interactive terminal.

Crash sources covered today:

- PTY open failure
- shell spawn failure
- output stream failure
- process wait failure

### Trust, Settings, And Agent Data

Trust file:

```text
app_config_dir / workspace-trust.json
```

Settings and data:

- App and workspace settings are stored in browser localStorage.
- Workspace trust is backend-visible and persisted under the Tauri app config directory.
- Agent threads, turn logs, turn changes, and history are persisted under the Tauri app data directory.
- Data left by removed IDE features (`local-history/`, `workspace-indexes/`, test-result and coverage caches) is no longer read; the CHANGELOG lists what can be deleted manually.

Release follow-up:

- Document how support can reset trust, settings, and agent data.

## Security And Permissions

The Tauri capability file grants core window and webview permissions, dialog, notification, opener (including reveal in Finder), process restart, and updater download/install. Re-check capabilities after any new plugin, sidecar, or file association is added.

Release follow-up:

- Keep terminal, agent, and package-script launch behind workspace trust.
- No external web fetches are expected from the app shell beyond the updater endpoint and provider/runner flows.

## Required Packaged Smoke Before Release

1. Build the release bundle and verify both `.app` and `.dmg` outputs.
2. Inspect the DMG with `hdiutil imageinfo`.
3. Launch `Codevo.app` from Finder and verify title, icon, and executable.
4. Open an untrusted project and verify agents, terminal, and scripts are blocked until trust is granted.
5. Verify provider discovery from a Finder launch, with and without each CLI installed.
6. Start a Claude Code or Codex thread in the local checkout and in an isolated worktree.
7. Review the diff and browse files in the read-only Files viewer.
8. Commit and push thread changes, then integrate and remove a worktree.
9. Open Terminal in the trusted workspace, run `echo`, and resize the panel.
10. Run a package script from the Scripts surface.
11. Verify app restart preserves trust, session, and threads.
12. For release artifacts, verify code signing, notarization, stapling, and Gatekeeper checks from `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`.
13. Verify the updater finds and installs a newer `beta` build.
14. Do not publish Windows or Linux artifacts until explicitly reprioritized.
