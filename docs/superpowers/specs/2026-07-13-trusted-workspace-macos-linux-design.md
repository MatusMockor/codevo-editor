# Trusted Workspace macOS and Linux Design

## Goal

Provide the same trusted-workspace experience on macOS and Linux: users can
select a workspace with the native folder picker, and all workspace file
operations remain constrained to its registered descriptor root.

## Scope

Supported platforms are macOS and Linux. Windows remains outside this change's
support commitment.

## Architecture

The existing `WorkspaceRegistry` and `workspace_file_commands` implementation
is platform-neutral. The application will compile and register that same
implementation when the target is macOS or Linux, rather than maintaining
separate Linux commands or less-secure path-based fallbacks.

The Tauri dialog plugin will supply the native folder picker on both supported
platforms. A selected directory is registered as a trusted workspace and the
frontend continues to invoke descriptor-scoped commands with a workspace ID
and a relative path. The Rust registry verifies the workspace ID and resolves
the relative path beneath its registered root before file operations occur.

## Platform Behaviour

- macOS retains its current trusted workspace behavior.
- Linux receives the same picker, descriptor registry, scoped reads, image
  reads, directory listing, file and text search, mutations, replace, workspace
  edits, save operations, and local-history snapshots.
- Non-supported targets must not cause command-registration compilation errors.

## Error Handling

The existing command result types and errors remain unchanged. Invalid or
unregistered workspace IDs and paths outside a registered workspace continue
to be rejected by `WorkspaceRegistry` and `DescriptorFileRepository`.

## Verification

Add a Linux compilation regression check that exercises Tauri command
registration. Run the relevant Rust tests, TypeScript checks/tests, and the
AppImage bundle command. The produced AppImage is the acceptance artifact for
the Linux path.
