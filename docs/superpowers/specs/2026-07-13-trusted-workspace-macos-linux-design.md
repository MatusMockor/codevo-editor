# Trusted Workspace macOS and Linux Design

## Goal

Provide the same trusted-workspace experience on macOS and Linux: users can
select a workspace with the native folder picker, and all workspace file
operations remain constrained to its registered descriptor root.

## Scope

Supported platforms are macOS and Linux. Windows remains outside this change's
support commitment.

## Architecture

The existing registry and file-command architecture is shared, but its current
low-level filesystem calls are macOS-specific. The application will retain one
descriptor-scoped command API while providing small platform-specific syscall
adapters for macOS and Linux; it will not use path-based Linux fallbacks.

The Tauri dialog plugin will supply the native folder picker on both supported
platforms. A selected directory is registered as a trusted workspace and the
frontend continues to invoke descriptor-scoped commands with a workspace ID
and a relative path. The Rust registry verifies the workspace ID and resolves
the relative path beneath its registered root before file operations occur.

On Linux, the registry will retain a directory file descriptor and resolve
untrusted descendant paths with `openat2` using `RESOLVE_BENEATH` and
`RESOLVE_NO_SYMLINKS`. This provides the equivalent protection against path
escape and symlink races supplied by the current macOS flags. Linux will derive
the retained root's display path through `/proc/self/fd/<fd>`, report unknown
case and Unicode-normalization properties where they cannot be safely probed,
and use Linux `renameat2` and xattr syscalls for atomic mutations and metadata
preservation.

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
