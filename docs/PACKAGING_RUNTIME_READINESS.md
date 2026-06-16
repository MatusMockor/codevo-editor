# Packaging Runtime Readiness

Date: 2026-06-16
Status: Desktop packaging audit

This document records what the packaged desktop app can rely on today, what it discovers from the host, and what must be hardened before release packaging.

## Summary

| Area | Current readiness | Release decision |
| --- | --- | --- |
| App bundle identity | Ready for desktop debug `.app` bundles | Product name, icon, version, identifier, publisher, and executable name are set. |
| PHPactor LSP runtime | Works when user-installed PHPactor is discoverable | Do not claim bundled PHPactor. Keep setup guidance visible. |
| Intelephense runtime | Detection exists, provider launch is pending | Treat as future backend selection work. |
| Terminal runtime | Works through host shell/PTY for trusted workspaces | Keep trust gate; document host shell dependency. |
| Workspace watcher | Not active as a packaged background service yet | Use explicit scan/reindex flows; Watchman is optional/future. |
| SQLite index | Ready for desktop debug bundles | Database lives under Tauri `app_config_dir` per workspace hash. |
| Text search | Works when host `rg` is discoverable | Do not claim bundled ripgrep. |
| Sidecars | None configured | First release is a host-runtime build; see `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`. |
| Trust/settings data | Ready for desktop debug bundles | Trust file and index DB are app-config scoped; settings are browser localStorage. |
| DMG packaging | Ready for debug desktop bundles | Default debug build produces `.app` and `.dmg`. |
| Signing/notarization | Planned, credentials missing | See `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`; no Developer ID identity is installed locally today. |
| Update channel | Manual first release | See `docs/UPDATE_CHANNEL_PLAN.md`; updater plugin and keys are not configured. |
| Windows/Linux packaging | Not ready | See `docs/WINDOWS_LINUX_FEASIBILITY.md`; local macOS host cannot produce those artifacts today. |

## Product And Bundle

- Product name: `Mockor Editor`
- Version: `0.1.0`
- Identifier: `dev.mockor.editor`
- Debug macOS app bundle: `src-tauri/target/debug/bundle/macos/Mockor Editor.app`
- Debug macOS DMG bundle: `src-tauri/target/debug/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg`
- Executable: `Contents/MacOS/mockor-editor`
- Icon resource: `Contents/Resources/icon.icns`
- Bundle category: `DeveloperTool`

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
- configured release signing identity
- notarization credentials or profile
- configured update channel
- Windows/Linux runner and signing policy
- sidecar bundle metadata

Verified DMG image info:

- Format: `UDZO`
- Format description: `UDIF read-only compressed (zlib)`
- Partition scheme: `GUID`

Signing and notarization plan:

- `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`
- Current local keychain check reports `0 valid identities found`.
- `notarytool` and `stapler` are available through `xcrun`.
- Xcode Command Line Tools are installed; Xcode.app is not installed.

Sidecar/runtime packaging plan:

- `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`
- `bundle.externalBin` is not configured.
- `tauri-plugin-shell` is not installed.
- Current release policy keeps PHP, PHPactor, Intelephense, Watchman, ripgrep, and terminal shells as host/runtime dependencies instead of bundled sidecars.

Update channel plan:

- `docs/UPDATE_CHANNEL_PLAN.md`
- `tauri-plugin-updater` is not installed.
- `@tauri-apps/plugin-updater` is not installed.
- `plugins.updater` is not configured.
- `bundle.createUpdaterArtifacts` uses the default disabled state.
- First release policy is manual DMG download; Tauri updater is deferred until signing keys, endpoints, CI, and UI are in place.

Windows/Linux feasibility:

- `docs/WINDOWS_LINUX_FEASIBILITY.md`
- current host target is `aarch64-apple-darwin`
- only `aarch64-apple-darwin` Rust target is installed
- local Windows and Linux build attempts fail before producing artifacts
- Windows and Linux releases require dedicated runners or VMs

## External Tool Discovery

### PHPactor

PHPactor is currently user-installed, not bundled. The backend detects it in this order:

1. Workspace `vendor/bin/phpactor`
2. `PATH`

The LSP command uses the detected executable with:

```text
phpactor language-server
```

Packaged-build behavior:

- Trusted PHP Composer workspaces can start PHPactor when detection succeeds.
- Untrusted workspaces are blocked before launch.
- Non-PHP Composer workspaces report LSP unavailable.
- Missing PHPactor reports setup guidance instead of launching.
- If PHPactor starts but fails the JSON-RPC handshake within the timeout, the runtime emits `Crashed`.
- A GUI-launched macOS `.app` may have a narrower `PATH` than an interactive shell.
- PHP itself is not detected separately; PHPactor/Composer scripts still require PHP to be available to the launched process.
- PHPactor stderr is discarded today, so spawn and handshake failures can surface as crash or timeout messages without detailed server logs.

Release policy:

- Keep PHPactor user-installed for the first release.
- Keep PHP user-installed for the first release.
- Wire persisted `phpactorPath` settings into backend detection or remove the field until it is actionable.

### Intelephense

Intelephense detection exists for workspace tool discovery, but an Intelephense runtime provider is still pending.

Packaged-build behavior:

- Do not present Intelephense as launch-ready.
- Keep backend preference UI descriptive until provider launch is implemented.
- Persisted `phpBackend`, `phpactorPath`, and `intelephensePath` settings are not runtime-active in backend planning yet.

Release policy:

- Do not launch or bundle Intelephense in the first release.
- Decide Node/Intelephense packaging policy before enabling provider selection.
- Wire persisted `intelephensePath` settings into backend detection when the provider lands.

### Watchman

Watchman is optional. The current preferred watcher abstraction can probe `watchman --version`, but no Tauri command starts a live packaged watcher service today.

Packaged-build behavior:

- Explicit scan and reindex flows are the real packaged indexing paths today.
- Native notify normalization exists, but it is not exposed as a packaged start/stop service.
- Watchman subscription parsing is tested, but the `WatchmanWorkspaceFileWatcher` adapter still returns unsupported.

Release policy:

- Treat Watchman as unsupported in packaged builds until subscriptions are implemented end to end.
- Add service health UI for watcher backend and rescan-required events before claiming Watchman support.

### Ripgrep

Text search currently shells out to `rg`.

Packaged-build behavior:

- Text search works when ripgrep is installed and visible to the app process.
- Missing `rg` returns a user-facing error that asks the user to install ripgrep.
- `rg` is not listed in Tauri `externalBin` and is not bundled.

Release policy:

- Keep ripgrep user-installed for the first release.
- Add packaged smoke coverage with and without `rg` visible to the GUI app process.

## Runtime Status And Crash Semantics

### Language Server

Backend status event:

```text
language-server://status
```

Statuses:

- `starting`
- `running`
- `stopped`
- `crashed`

Crash sources covered today:

- process spawn failure
- malformed initialize response
- handshake timeout/failure
- JSON-RPC reader failure
- request timeout or stopped pending request
- initialized notification write failure

Frontend behavior:

- Runtime status feeds the status bar and command enablement.
- Crash messages become Problems notices.
- Diagnostics are emitted through `language-server://diagnostics`.

Release follow-up:

- Add packaged smoke checks using a real trusted PHP fixture with PHPactor installed.
- Add a log view or exportable runtime diagnostics before release builds.

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
- Backend `exited` and `crashed` statuses exist, but the frontend terminal gateway currently subscribes only to output after start.

Crash sources covered today:

- PTY open failure
- shell spawn failure
- output stream failure
- process wait failure

Release follow-up:

- Add a packaged smoke test that opens Terminal in a trusted temp workspace.
- Decide whether shell profile customization belongs in settings.

### Index And Reindex

Index database path:

```text
app_config_dir / workspace_index_path(root)
```

Current storage shape:

```text
app_config_dir / workspace-indexes / <workspace-hash>.sqlite3
```

Current behavior:

- SQLite opens with migrations, WAL, and busy timeout.
- `rusqlite` uses bundled SQLite, so no external SQLite sidecar is required.
- Initial metadata scans emit `index://metadata-scan-completed`.
- Scan/reindex reports include bounded error and skipped-file details.
- Reindex paths are guarded to stay inside the workspace root.
- Stale jobs are generation-gated before DB writes.
- Index paths are derived from absolute workspace roots, so moving a workspace creates a separate index DB.

Release follow-up:

- Add a packaged smoke test that opens a PHP fixture, runs soft/PHP/hard reindex, and verifies the Index health panel.
- Verify DB creation under app config, WAL writability, deleted DB recovery, and corrupt DB support flow.
- Add a maintenance command or support doc for deleting a corrupt workspace index DB.

### Trust And Settings

Trust file:

```text
app_config_dir / workspace-trust.json
```

Settings:

- App and workspace settings are currently stored in browser localStorage.
- Workspace trust is backend-visible and persisted under the Tauri app config directory.
- App config write permissions are required for trust and index persistence.

Release follow-up:

- Decide whether settings should move to a backend settings file before signing/release.
- Document how support can reset trust/settings/index state.

## Security And Permissions

Current Tauri capability file grants:

- `core:default`
- `dialog:default`
- `opener:default`

Current CSP permits:

- self-hosted app code and styles
- Tauri IPC origins
- asset protocol images
- data fonts/images
- blob workers

Release follow-up:

- Re-check capabilities after sidecars, update channel, file associations, and signing are added.
- Keep terminal and LSP launch behind workspace trust.
- Basic file read/write/search/index commands are custom Rust command surfaces and are not trust-gated today.
- No external web fetches are expected from the app shell.

## Required Packaged Smoke Before Release

1. Build `npm run tauri build -- --debug` and verify both `.app` and `.dmg` outputs.
2. Inspect the DMG with `hdiutil imageinfo`.
3. Launch `Mockor Editor.app` from Finder and verify title, icon, and executable.
4. Open an untrusted PHP Composer fixture.
5. Verify PHPactor is blocked until trust is granted.
6. Trust the workspace and start PHPactor when PHPactor is available.
7. Repeat with missing PHPactor or missing PHP and confirm setup/crash messaging.
8. Open Terminal in the trusted workspace, run `echo`, and resize the panel.
9. Verify untrusted workspaces block Terminal launch.
10. Run soft, PHP, and hard reindex from the Index panel.
11. Verify text search with and without `rg` visible to the GUI app process.
12. Verify packaged behavior without Watchman installed.
13. Verify app restart preserves trust, session, and index state.
14. Verify deleting the workspace index DB allows recovery through hard reindex.
15. For release artifacts, verify code signing, notarization, stapling, and Gatekeeper checks from `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`.
16. Confirm release notes list no bundled PHP, PHPactor, Intelephense, Watchman, ripgrep, or shell, matching `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`.
17. Confirm release notes state the manual update policy from `docs/UPDATE_CHANNEL_PLAN.md`.
18. Do not publish Windows or Linux artifacts until `docs/WINDOWS_LINUX_FEASIBILITY.md` smoke checklists pass on real platform runners.

## Phase 8 Follow-Ups

- Release CI plan.
- Packaged smoke automation.
