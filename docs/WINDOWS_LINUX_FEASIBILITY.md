# Windows And Linux Packaging Feasibility

Date: 2026-06-16
Status: Feasibility documented, artifacts not built locally

This document records what can be verified from the current macOS development host, what failed locally, and what is required to produce real Windows and Linux release artifacts.

## Source Baseline

- Tauri prerequisites, checked 2026-06-16: https://v2.tauri.app/start/prerequisites/
- Tauri Windows installer docs, checked 2026-06-16: https://v2.tauri.app/distribute/windows-installer/
- Tauri distribution overview, checked 2026-06-16: https://v2.tauri.app/distribute/
- Tauri configuration reference, checked 2026-06-16: https://v2.tauri.app/reference/config/
- Tauri Debian package docs, checked 2026-06-16: https://v2.tauri.app/distribute/debian/

External facts used by this plan:

- Windows development requires Microsoft C++ Build Tools and Microsoft Edge WebView2.
- MSI packaging requires the VBSCRIPT optional Windows feature.
- Cross-compiling Windows apps on Linux or macOS with NSIS is possible but caveated, less tested, and recommended only when VMs or CI cannot be used.
- Tauri officially supports the MSVC Windows target, so non-Windows cross setup is more involved.
- Linux packages should be built on Linux, ideally on the oldest supported baseline such as Ubuntu 22.04 or Debian 12 because glibc and WebKitGTK versions affect compatibility.
- Tauri bundle target names include `deb`, `rpm`, `appimage`, `nsis`, `msi`, `app`, and `dmg`, but the host CLI exposes only the targets that make sense for the current platform.

## Current Local State

Current host:

```text
rustc --print host-tuple
```

Result:

```text
aarch64-apple-darwin
```

Installed Rust targets:

```text
aarch64-apple-darwin
```

Current local packaging tools:

```text
cargo: present
rustc: present
cc: present
clang: present
zig: missing
x86_64-w64-mingw32-gcc: missing
makensis: missing
dpkg: missing
rpm: missing
appimagetool: missing
linuxdeploy: missing
```

Current Tauri config:

- `bundle.targets` is `all`.
- icons include `.ico`, `.icns`, and PNG assets.
- no `bundle.windows` block is configured.
- no `bundle.linux` block is configured.
- no sidecars are configured.
- no updater is configured.

Current macOS `tauri build --help` bundle values:

```text
ios, app, dmg
```

That means this host can build macOS/iOS-flavored bundles, but it cannot produce Windows or Linux installers directly through the current Tauri CLI invocation.

## Local Build Attempts

Windows NSIS attempt:

```sh
npm run tauri build -- --debug --target x86_64-pc-windows-msvc --bundles nsis
```

Result:

```text
Target x86_64-pc-windows-msvc is not installed.
```

Linux Debian attempt:

```sh
npm run tauri build -- --debug --target x86_64-unknown-linux-gnu --bundles deb
```

Result:

```text
invalid value 'deb' for '--bundles [<BUNDLES>...]'
possible values: ios, app, dmg
```

Windows Rust check attempt:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

Result:

```text
can't find crate for std
the x86_64-pc-windows-msvc target may not be installed
```

Linux Rust check attempt:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu
```

Result:

```text
can't find crate for core
the x86_64-unknown-linux-gnu target may not be installed
```

Frontend build note:

- the Windows Tauri attempt ran `npm run build` successfully before failing on the missing Rust target.

## Decision

Do not claim Windows or Linux package readiness yet.

First release remains macOS-first:

- macOS Apple Silicon debug bundle and debug DMG are verified.
- signed/notarized macOS release is planned but credentials are missing.
- Windows and Linux artifacts require dedicated runner work.

Preferred future path:

- build Windows on a Windows GitHub Actions runner or local Windows VM
- build Linux on an Ubuntu 22.04 or Debian 12 runner/container
- keep macOS releases on macOS runners
- avoid macOS-hosted Windows/Linux cross builds except as last-resort experiments

## Windows Feasibility

Recommended initial target:

- `x86_64-pc-windows-msvc`
- NSIS installer first
- MSI only after VBSCRIPT and WiX behavior are tested

Required Windows runner:

- Windows 10 or Windows 11
- Microsoft C++ Build Tools with Desktop development with C++
- Microsoft Edge WebView2 Runtime
- Rust stable toolchain
- Node and npm
- Tauri CLI
- NSIS for NSIS installer
- WiX and VBSCRIPT enabled for MSI installer if MSI is selected

Required signing decisions:

- Windows code signing certificate
- timestamp server
- local signing command or CI secret-backed signing
- decide whether unsigned internal test installers are allowed only for CI smoke

Windows runtime risks:

- terminal profiles use PowerShell and Command Prompt
- PHPactor, Intelephense, `rg`, PHP, and shell behavior depend on Windows `PATH` and executable suffix handling
- `PATHEXT` handling exists in tool discovery
- portable-pty behavior must be smoke-tested on Windows
- file paths, URI encoding, and workspace index hashing must be tested with drive-letter paths
- LSP `file:///C:/...` URI decoding may need a Windows-specific frontend fix because `URL.pathname` can produce `/C:/...`
- WebView2 installation mode should be chosen explicitly before public release

Windows smoke checklist:

1. Build NSIS installer on Windows.
2. Install on a clean Windows user profile.
3. Verify app title, icon, and bundle identity.
4. Open a workspace under a path with spaces.
5. Run file read/write/rename/delete flows.
6. Run Quick Open and text search with and without `rg`.
7. Trust a PHP Composer workspace and verify PHPactor behavior with missing and present PHPactor.
8. Open Terminal with PowerShell and Command Prompt.
9. Run soft, PHP-language, and hard reindex.
10. Verify app restart restores session and index state.

## Linux Feasibility

Recommended initial target:

- `x86_64-unknown-linux-gnu`
- `.deb` first on Ubuntu 22.04 or Debian 12 baseline
- AppImage after `.deb` smoke is stable
- RPM only after Fedora/RHEL packaging requirements are checked

Required Linux runner:

- Ubuntu 22.04 or Debian 12 base
- Rust stable toolchain
- Node and npm
- WebKitGTK 4.1 development packages
- GTK 3 development packages
- AppIndicator packages if tray support is added later
- packaging tools for selected targets: `dpkg`, `rpm`, AppImage tooling

Required signing decisions:

- whether `.deb`, `.rpm`, AppImage, or repository metadata is signed
- whether Linux release artifacts are distributed directly, through package repositories, or through GitHub Releases

Linux runtime risks:

- GUI apps on Linux may not inherit shell dotfile `PATH`, like macOS GUI apps
- WebKitGTK version and glibc baseline affect compatibility
- terminal uses host default shell or `$SHELL`
- host `rg`, PHP, PHPactor, Intelephense, and Watchman visibility must be smoke-tested
- `.desktop` metadata and icon installation must be verified
- file permissions and executable detection must be checked on real Linux filesystems

Linux smoke checklist:

1. Build `.deb` on Ubuntu 22.04 or Debian 12.
2. Install the package on a clean user profile.
3. Verify `.desktop` entry, icon, title, and launch from desktop environment.
4. Open a workspace under a path with spaces.
5. Run file read/write/rename/delete flows.
6. Run Quick Open and text search with and without `rg`.
7. Trust a PHP Composer workspace and verify PHPactor behavior with missing and present PHPactor.
8. Open Terminal using the host shell.
9. Run soft, PHP-language, and hard reindex.
10. Verify app restart restores session and index state.

## Cross-Platform Runtime Notes

Host-runtime policy still applies:

- PHP is not bundled.
- PHPactor is not bundled.
- Intelephense is not launch-ready.
- Watchman is unsupported.
- ripgrep is not bundled.
- terminal shells are host-provided.

In-process runtime dependencies:

- SQLite is bundled through `rusqlite`.
- PHP symbol parsing uses Rust and tree-sitter, not PHP.
- native notify is a Rust dependency, but live watcher service exposure is still future work.

Data locations:

- trust state uses Tauri `app_config_dir`.
- workspace index DBs use `app_config_dir/workspace-indexes/<workspace-hash>.sqlite3`.
- moving a workspace creates a separate index DB because the path hash changes.

## Required Follow-Up

- Add Windows CI packaging job.
- Add Linux CI packaging job.
- Decide Windows installer type: NSIS first, MSI later.
- Decide Linux package order: `.deb` first, AppImage later, RPM later.
- Add platform-specific release smoke scripts or checklists.
- Add Windows signing plan.
- Add Linux artifact signing or repository policy.
- Fix or test Windows LSP file URI decoding before claiming Windows language-server support.
- Test Composer `vendor/bin/phpactor.bat` and `.cmd` wrapper launching on Windows.
- Re-run sidecar and updater plans once Windows/Linux artifacts exist.
