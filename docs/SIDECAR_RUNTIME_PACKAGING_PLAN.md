# Sidecar And Runtime Packaging Plan

Date: 2026-10-15
Status: Runtime policy for the agent app

This plan decides how `Codevo` handles agent CLIs, Git, package managers, terminal shells, and app data in packaged desktop builds.

Codevo is an agent app. The code editor and its runtimes (PHP, PHPactor, Intelephense, the TypeScript language server, Watchman, ripgrep-based text search, test runners, the SQLite workspace index, and tree-sitter parsing) were removed by owner decision, so they are no longer part of the packaging policy. Earlier versions of this plan covered them; that history is kept in Git.

## Source Baseline

- Tauri external binaries guide: https://v2.tauri.app/develop/sidecar/
- Tauri Node.js sidecar guide: https://v2.tauri.app/learn/sidecar-nodejs/

External facts used by this plan:

- Tauri `bundle.externalBin` packages sidecar binaries and requires target-triple file names such as `name-aarch64-apple-darwin`.
- Tauri sidecars can be launched from Rust through the shell plugin, and frontend sidecar access requires explicit shell permissions.
- Tauri's Node sidecar guide recommends packaging JavaScript into a self-contained binary or shipping a Node runtime plus readable resources, each with different size and security tradeoffs.

## Current Repository State

No sidecars are configured:

```text
src-tauri/tauri.conf.json -> bundle.externalBin: not configured
src-tauri/binaries -> not present
tauri-plugin-shell -> not present
```

Current code paths:

- Claude Code and Codex are discovered from the login-shell `PATH`, bounded well-known installation directories, or an absolute override in **Settings > Providers**.
- Agent turns, sign-in terminals, regular terminals, and package-script runs share one effective `PATH`.
- Git, worktree, diff, history, and shipping flows launch host `git`.
- Package scripts run through the host package manager after workspace trust.
- Terminal launches the host default shell or `$SHELL` through `portable-pty` after workspace trust.
- The remote runner connects through host `ssh` with strict host-key checking.
- Agent threads, turn logs, turn changes, and history are stored under the Tauri app data directory; `rusqlite` uses the `bundled` feature where SQLite is used, so SQLite is an in-process dependency.

## Release Policy

Releases remain host-runtime builds:

| Runtime | Policy | User promise |
| --- | --- | --- |
| Claude Code, Codex | User-installed | Discovered automatically; **Settings > Providers** shows install, sign-in, and update guidance. |
| Node.js | User-installed | Required by npm-installed agent CLIs and project scripts. |
| Git | User-installed | Required for worktrees, diff, history, and shipping. |
| Package managers | User-installed | Scripts use the project's package manager from the effective `PATH`. |
| SSH | Host `ssh` | Required only for the remote runner. |
| Terminal shell | Host shell | Terminal depends on the host shell and trusted workspace. |

Rationale:

- This matches current code behavior.
- Agent CLIs update often and are authenticated per user; bundling them would pin stale versions and complicate sign-in.
- It keeps signing and notarization scope limited to the app bundle.
- It gives users accurate setup guidance instead of implying a self-contained runtime.

## Future Sidecar Contract

Any future sidecar implementation must be explicit and backend-owned.

Required packaging steps:

1. Add binaries under `src-tauri/binaries/`.
2. Name each binary with the Tauri target-triple suffix.
3. Add `bundle.externalBin` entries in `src-tauri/tauri.conf.json`.
4. Add `tauri-plugin-shell` only when the launch path uses Tauri sidecar APIs.
5. Add capability entries for exact sidecar names and constrained arguments only.
6. Launch sidecars through Rust service ports, not directly from arbitrary frontend commands.
7. Sign every nested executable and dynamic library before notarization.
8. Verify `codesign`, `spctl`, `stapler`, and notary logs against sidecar-containing artifacts.
9. Add smoke tests that prove sidecar and host-tool detection choose the intended runtime.
10. Include license files and version metadata for every bundled tool.

Recommended detection order after sidecars exist:

1. Explicit user setting path.
2. Bundled sidecar, when the release owns that runtime.
3. Host login-shell `PATH` and bounded well-known directories.
4. Unavailable status with setup guidance.

## Security And Permissions Policy

- Do not add broad shell permissions.
- Do not expose arbitrary command execution to the frontend.
- Keep agent, terminal, and package-script launch behind workspace trust.
- If sidecars are added, give each sidecar exact-name permissions and constrained arguments.
- Do not add remote download or self-update behavior for sidecars outside the app updater policy.
- Treat sidecar logs as local diagnostics and avoid leaking workspace paths to remote services.

## Signing And Notarization Impact

The current policy introduces no extra nested code.

If sidecars are added:

- sign the app bundle after sidecars are copied into the bundle
- verify each nested executable with `codesign --verify --strict --verbose=2`
- inspect `codesign -dv --verbose=4` for each sidecar
- notarize the final DMG and inspect notary logs for nested code failures
- staple and validate the DMG
- run Gatekeeper checks from `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`

## Packaged Smoke Matrix

Before release, test:

1. GUI-launched `.app` with a narrow `PATH`: providers are still discovered.
2. Each provider missing, installed but signed out, and signed in.
3. Absolute provider path override and return to **Auto**.
4. Git missing and present.
5. Thread in the local checkout and in an isolated worktree.
6. Package script in a trusted workspace; blocked in an untrusted workspace.
7. Terminal in trusted and untrusted workspaces.
8. Terminal echo, resize, shell profile, and process exit/crash visibility.
9. Remote runner connect with a verified host key; refused with an unknown host key.

Future sidecar smoke adds:

- each configured target triple
- sidecar preferred over `PATH` only when policy says so
- sidecar missing from bundle
- sidecar unsigned or rejected by Gatekeeper
- sidecar crash and diagnostic output

## Follow-Up Implementation Slices

- Add terminal status subscription in the frontend gateway so exit/crash states remain visible after startup, if not already covered.
- Add a support command or doc for resetting trust, settings, and agent data.
