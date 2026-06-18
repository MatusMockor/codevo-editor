# PhpStorm-Like Git Commit View Design

## Goal

Bring the Git sidebar closer to PhpStorm's Commit tool window by adding a real local commit workflow around the existing Git status and diff preview.

## Scope

This slice covers local Git operations only:

- grouped `Changes` and `Unversioned Files` sections with counts
- per-file and per-group checkboxes for commit inclusion
- toolbar actions for refresh, stage selected/all, unstage selected/all, and revert selected
- commit message textarea, `Commit` button, and commit-and-push action
- push operation for the current branch
- existing row click behavior continues to open the diff preview

Out of scope:

- amend last commit
- branch checkout or branch creation
- named changelists
- pre-commit hook UI

## Architecture

The current Git stack is kept: React panel -> workbench controller -> TypeScript Git gateway -> Tauri commands -> Rust Git gateway. New behavior extends those boundaries instead of introducing a parallel Git service.

The domain layer owns status grouping and staged-state interpretation. The UI renders groups and controls. The controller owns selected files, commit message, operation loading state, confirmations, and refresh-after-operation behavior. The Rust gateway shells out to `git` for local actions using validated relative paths.

## Data Model

`GitChangedFile` gains an `isStaged` boolean derived from porcelain status. Existing fields remain stable for diff preview.

The `GitGateway` contract gains:

- `stageFiles(rootPath, changes)`
- `unstageFiles(rootPath, changes)`
- `revertFiles(rootPath, changes)`
- `commit(rootPath, message, changes)`
- `push(rootPath)`

The Rust gateway mirrors these commands and validates every relative path through the existing `safe_relative_path` helper.

## UI Behavior

The sidebar tab presents a `Commit` panel. Repository state shows the current branch and action toolbar. Changes are grouped into tracked changes and unversioned files. Group checkboxes stage or unstage every file in the group; file checkboxes stage or unstage one file.

The commit button is enabled only when the repository has staged files and the message has non-empty text. After every Git operation, status refreshes and stale selections are pruned.

Revert uses confirmation because it discards local work. Untracked files are removed with `git clean -f -- <path>`, while tracked files use `git restore -- <path>`.

## Error Handling

All Git command failures flow through the existing workbench notice path. UI controls are disabled while a Git operation is running. Empty workspace, non-repository, loading, and clean repository states keep their current simple rendering.

## Testing

Tests cover:

- domain grouping and staged-state helpers
- Tauri gateway command names and argument shapes
- Git panel rendering and user interactions
- controller action flow for stage/commit refresh and commit message reset
- Rust porcelain parsing and path-safe command behavior where practical
