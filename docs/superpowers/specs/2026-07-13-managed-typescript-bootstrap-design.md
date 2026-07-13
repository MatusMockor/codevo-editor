# Managed TypeScript Language Server Bootstrap Design

## Goal

Make JavaScript and TypeScript language intelligence work in macOS and Linux
desktop packages without shipping Node.js or the application's development
`node_modules` directory inside the package.

The experience will match the managed PHPactor flow: a trusted workspace whose
configured language server is unavailable shows a one-click setup notice. The
user explicitly starts an installation into their profile; the application
then refreshes and starts the server.

## Scope

This change supports the existing macOS and Linux desktop targets. It does not
bundle Node.js, npm, TypeScript, or `typescript-language-server` into the app,
and it does not manage project dependencies.

The packaged app must never discover and launch the source checkout's
`node_modules` directory. Development builds may retain their existing local
fallbacks for contributor convenience, but packaged builds select only the
managed installation, a workspace installation when selected, or an explicit
system tool.

## Tool Selection

The existing persisted `bundled` / `workspace` version preference remains
backward compatible. Its settings UI label changes from **Bundled** to
**Managed**, because the default is a user-profile installation rather than a
package resource.

- **Managed**: use the pinned user-profile installation. If it is unavailable,
  display the setup notice; do not silently use a source-checkout dependency.
- **Workspace**: prefer `node_modules` in the trusted workspace. If its
  language-server package is absent, fall back to the managed installation;
  otherwise display the setup notice.
- An explicit tool override continues to take precedence where the existing
  tool-detection contract supports one.

The workspace TypeScript version remains authoritative in Workspace mode. In
Managed mode, the bootstrap installs both the language server and its pinned
TypeScript version so the server has a complete, repeatable toolchain.

## Managed Installation and Launch

The installer materializes a versioned package manifest under the existing
per-user managed root:

`~/.codevo-editor/tools/typescript-language-server`

On macOS, the application-support root remains the preferred equivalent,
consistent with the detector's existing lookup order. The bootstrap invokes a
host Node/npm toolchain, honoring a Codevo Node-path override when present and
otherwise resolving it from `PATH`. It requires a supported Node version (the
current `typescript-language-server` 5.3.0 requires Node 20 or newer) and a
compatible npm command.

The generated manifest pins the shipped development versions:

- `typescript-language-server` 5.3.0
- `typescript` 5.8.3

The background worker runs a non-interactive production-only npm install. It
reports a clear failure when Node or npm cannot be found, the Node version is
unsupported, or the package download fails. It is idempotent: a matching
installation is reused; a version mismatch is repaired by npm.

At runtime Codevo does not execute `node_modules/.bin/typescript-language-server`.
That wrapper has an `env node` shebang, which is unreliable for AppImage and
other GUI launches. Instead, the planner launches the resolved Node executable
directly with the managed or workspace package's
`typescript-language-server/lib/cli.mjs` entrypoint and `--stdio`. The
existing TypeScript server and Vue-plugin resolution continue to feed the LSP
initialization settings.

## UI and Events

The frontend follows the PHPactor lifecycle pattern:

1. A trusted workspace probes the selected JavaScript/TypeScript tool source.
2. If the selected server is unavailable, it creates a grouped warning notice.
3. The toast offers **Install now** and **Manual install**. Install now invokes
   a Tauri command that starts the bootstrap worker and keeps the UI responsive.
4. The backend emits a completion event containing the workspace root and an
   optional installation error.
5. On success, the frontend re-probes, refreshes the LSP plan, and starts the
   normal lifecycle. On failure, it leaves the notice actionable and displays
   the specific error.

The notice appears only when the workspace is trusted and the JavaScript /
TypeScript service is enabled. Manual setup opens the existing language-server
setup surface.

## Safety and Error Handling

Bootstrap is an explicit user action and writes only beneath the user's managed
tool directory. It does not run npm in a workspace, modify project manifests,
or bypass workspace trust. The npm child process has no LSP stdio connection;
its output is captured for a diagnostic error message.

Missing managed tools result in an unavailable LSP plan instead of attempting
to execute a development path. A malformed or partial installation is treated
as unavailable and can be repaired by Install now.

## Verification

Tests will cover:

- managed-root selection, package manifest creation, idempotence, and failures
  from missing/unsupported Node or npm;
- command construction that invokes Node plus `lib/cli.mjs`, never the `.bin`
  wrapper;
- Managed and Workspace precedence, including workspace fallback to managed;
- Tauri command registration, completion events, and notice lifecycle;
- existing Rust and TypeScript checks, plus an AppImage build and a packaged
  launch smoke test using the managed bootstrap.
