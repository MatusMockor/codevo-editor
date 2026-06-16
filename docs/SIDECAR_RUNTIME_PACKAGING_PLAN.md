# Sidecar And Runtime Packaging Plan

Date: 2026-06-16
Status: First-release runtime policy documented

This plan decides how `Mockor Editor` handles PHP, PHPactor, Intelephense, Watchman, ripgrep, terminal shells, and index storage in packaged desktop builds.

## Source Baseline

- Tauri external binaries guide, last updated 2026-06-15: https://v2.tauri.app/develop/sidecar/
- Tauri Node.js sidecar guide, last updated 2026-01-07: https://v2.tauri.app/learn/sidecar-nodejs/
- PHPactor standalone install docs: https://phpactor.readthedocs.io/en/master/usage/standalone.html
- Intelephense docs: https://intelephense.com/docs
- Watchman install docs: https://facebook.github.io/watchman/docs/install.html
- ripgrep README and install notes: https://github.com/BurntSushi/ripgrep

External facts used by this plan:

- Tauri `bundle.externalBin` packages sidecar binaries and requires target-triple file names such as `name-aarch64-apple-darwin`.
- Tauri sidecars can be launched from Rust through the shell plugin, and frontend sidecar access requires explicit shell permissions.
- Tauri's Node sidecar guide recommends packaging JavaScript into a self-contained binary or shipping a Node runtime plus readable resources, each with different size and security tradeoffs.
- PHPactor requires PHP 8.2 and can be installed as a PHAR on `PATH`.
- Intelephense is an LSP server and the current npm package exposes an `intelephense` bin entry.
- Watchman can be installed through Homebrew, MacPorts, or prebuilt binaries; its macOS prebuilt binaries are documented as unsigned.
- ripgrep provides an `rg` binary with macOS, Linux, and Windows downloads.

## Current Repository State

No sidecars are configured today:

```text
src-tauri/tauri.conf.json -> bundle.externalBin: null
src-tauri/capabilities/default.json -> core:default, dialog:default, opener:default
src-tauri/binaries -> not present
tauri-plugin-shell -> not present
```

Current local host tools:

```text
php: /opt/homebrew/bin/php, PHP 8.4.22
rg: /opt/homebrew/bin/rg, ripgrep 15.1.0
phpactor: not found
intelephense: not found
watchman: not found
target triple: aarch64-apple-darwin
```

Current code paths:

- PHPactor and Intelephense discovery checks workspace `vendor/bin`, then `PATH`.
- PHPactor LSP launch uses the discovered executable with `language-server`.
- Intelephense is detected but no backend runtime provider launches it.
- Text search launches `rg` from `PATH`.
- Watchman availability probes `watchman --version`, but the Watchman watcher adapter returns unsupported.
- Terminal launches the host default shell or `$SHELL` through `portable-pty` after workspace trust.
- SQLite index storage is app-config scoped and does not depend on external binaries.
- `rusqlite` uses the `bundled` feature, so SQLite is an in-process dependency rather than a separate executable.

## First Release Policy

The first signed release remains a host-runtime build:

| Runtime | First release policy | User promise |
| --- | --- | --- |
| PHP | User-installed | Required only for PHPactor or user terminal workflows. |
| PHPactor | User-installed | Supported when workspace `vendor/bin/phpactor` or app-visible `PATH` detection succeeds. |
| Intelephense | Detection only | Do not present as launch-ready until backend provider exists. |
| Watchman | Not supported | Native scan/reindex is the supported path; Watchman remains future work. |
| ripgrep | User-installed | Text search works when `rg` is app-visible; missing `rg` shows setup guidance. |
| Terminal shell | Host shell | Terminal depends on the host shell and trusted workspace. |
| SQLite index | Bundled Rust/runtime dependency | App owns index DB location and migrations. |

Rationale:

- This matches current code behavior.
- It avoids bundling PHP runtimes, Node runtimes, unsigned Watchman binaries, and licensed language-server assets before their support contracts are clear.
- It keeps signing and notarization scope limited to the app bundle in the first release.
- It gives users accurate setup guidance instead of implying a self-contained IDE runtime.

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

1. Explicit user setting path, once settings paths are backend-active.
2. Workspace-local tool, when project-local execution is semantically correct.
3. Bundled sidecar, when the release owns that runtime.
4. Host `PATH`.
5. Unavailable status with setup guidance.

## Runtime Decisions

### PHP

Decision: do not bundle PHP in the first release.

Current state:

- PHP is not detected independently.
- PHPactor scripts and user terminal commands rely on the host process environment.

Future bundled PHP requirements:

- choose macOS `aarch64`, `x86_64`, or universal runtime
- include required extensions such as `mbstring` for PHPactor
- sign PHP executable, extension modules, and dynamic libraries
- provide license notices for PHP and bundled extensions
- avoid mutating user `PATH`
- run PHPactor smoke tests with the bundled PHP path and with host PHP hidden

### PHPactor

Decision: keep PHPactor user-installed for the first release.

Current state:

- Detection is `workspace vendor/bin` first, then `PATH`.
- Launch command is the detected PHPactor path plus `language-server`.
- Workspaces must be trusted before launch.
- PHPactor stderr is discarded today.

Future sidecar options:

- bundle `phpactor.phar` as a resource and require host PHP
- bundle PHP plus `phpactor.phar`
- bundle a wrapper sidecar that pins PHP and PHPactor together

Future requirements before bundling:

- activate `phpactorPath` setting in backend planning
- capture stderr or structured logs for support
- document PHPactor version and PHP version
- sign every executable involved in the launch chain
- test Composer workspaces with and without workspace `vendor/bin/phpactor`

### Intelephense

Decision: do not launch or bundle Intelephense in the first release.

Current state:

- Detection checks `vendor/bin/intelephense` and `PATH`.
- Settings UI stores `intelephensePath`, but backend planning does not consume it yet.
- No Rust provider starts Intelephense today.
- Current npm metadata reports `intelephense` version `1.18.4`, a bin entry at `lib/intelephense.js`, and a package license field of `SEE LICENSE IN LICENSE.txt`.

Future provider requirements:

- define an Intelephense planner and runtime provider behind the existing LSP abstractions
- activate `phpBackend` and `intelephensePath` settings in backend planning
- decide whether to use host Node, a Node sidecar binary, or Node runtime plus JS resources
- perform license review before bundling
- add feature gating for freemium or licensed capabilities
- add packaged smoke for install missing, host install visible, configured path, and sidecar path

### Watchman

Decision: mark Watchman unsupported for first release.

Current state:

- Availability check probes `watchman --version`.
- Preferred watcher falls back to native notify when Watchman launch is unavailable.
- Watchman subscription normalization is tested.
- `WatchmanWorkspaceFileWatcher` returns unsupported.
- No Tauri command starts a live watcher service.

Future support requirements:

- implement start/stop lifecycle for watcher sessions
- surface backend choice and health in UI
- handle rescan-required events end to end
- test watch overflow and workspace rename behavior
- avoid bundling Meta's unsigned macOS binaries without signing and notarization validation

### ripgrep

Decision: keep ripgrep user-installed for the first release.

Current state:

- Text search launches `Command::new("rg")`.
- Missing `rg` produces a user-facing setup error.
- Query output is parsed from `--json`.

Future sidecar requirements:

- add `rg` as `bundle.externalBin` for each supported target
- include MIT or Unlicense license notice
- launch through a backend-owned sidecar adapter
- keep the current `--json` parser contract
- smoke test host `rg`, missing host `rg`, and bundled `rg`
- verify large-result limiting and ignored directory behavior in packaged app builds

### Terminal Shells

Decision: terminal remains a host-shell feature.

Current state:

- Terminal launch is trust-gated.
- Default shell comes from `portable-pty`.
- Unix profile reads `$SHELL`.
- Windows profiles are PowerShell and Command Prompt.

Release notes must say terminal uses the user's shell and inherited process environment. A macOS GUI app can have a narrower environment than an interactive shell.

### SQLite Index

Decision: keep index runtime inside the Rust app; no sidecar required.

Current state:

- SQLite opens under Tauri `app_config_dir`.
- Workspace DB path is `workspace-indexes/<workspace-hash>.sqlite3`.
- Migrations, WAL, busy timeout, guarded writes, and PHP symbol parsing are in Rust.
- tree-sitter PHP is a Rust dependency, not an external sidecar.
- Reindex opens SQLite directly and parses PHP via Rust/tree-sitter, not through a PHP binary.

Future requirements:

- support command for resetting a corrupt workspace index
- package smoke for new workspace, restored workspace, moved workspace, and deleted DB recovery
- keep DB writes generation-gated as indexing expands

## Security And Permissions Policy

- Do not add broad shell permissions for the first release.
- Do not expose arbitrary command execution to the frontend.
- Keep LSP and terminal launch behind workspace trust.
- Revisit trust gating for custom Rust file/search/index commands before public release.
- If sidecars are added, give each sidecar exact-name permissions and constrained arguments.
- Do not add remote download or self-update behavior for sidecars before P8-04 update-channel decisions.
- Treat sidecar logs as local diagnostics and avoid leaking workspace paths to remote services.

## Signing And Notarization Impact

No extra nested code is introduced by the first-release policy.

If sidecars are added:

- sign the app bundle after sidecars are copied into the bundle
- verify each nested executable with `codesign --verify --strict --verbose=2`
- inspect `codesign -dv --verbose=4` for each sidecar
- notarize the final DMG and inspect notary logs for nested code failures
- staple and validate the DMG
- run Gatekeeper checks from `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`

## Packaged Smoke Matrix

Before release, test:

1. PHP Composer workspace with `vendor/bin/phpactor`.
2. PHP Composer workspace without PHPactor.
3. Host `PATH` visible with PHP and `rg`.
4. GUI-launched `.app` with a narrow `PATH`.
5. Text search with `rg` visible.
6. Text search with `rg` hidden.
7. PHPactor launch with PHP hidden or broken.
8. Intelephense preference selected while provider launch is unavailable.
9. Watchman absent.
10. Terminal in trusted workspace.
11. Terminal in untrusted workspace.
12. Terminal echo, resize, shell profile, and process exit/crash visibility.
13. Soft, PHP-language, and hard reindex on a PHP fixture.
14. Index DB creation under app config, WAL writability, DB delete, and recovery through hard reindex.

Future sidecar smoke adds:

- each configured target triple
- sidecar preferred over `PATH` only when policy says so
- sidecar missing from bundle
- sidecar unsigned or rejected by Gatekeeper
- sidecar crash and diagnostic output

## Follow-Up Implementation Slices

- Activate settings paths in backend tool discovery.
- Add runtime diagnostics capture for PHPactor stderr.
- Decide whether `rg` should become the first bundled sidecar.
- Implement Watchman session lifecycle or remove Watchman preference from packaged claims.
- Implement Intelephense provider only after Node/licensing policy is settled.
- Add reset-index support command.
- Add terminal status subscription in the frontend gateway so exit/crash states remain visible after startup.
- Revisit trust gates for file, search, and index commands before public release.
