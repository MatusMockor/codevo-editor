# PhpStorm-Like Git Commit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PhpStorm-like local commit workflow to the existing Git sidebar.

**Architecture:** Extend the existing Git domain, gateway, controller, and sidebar panel. Keep diff preview behavior read-only and add local Git operations through validated Tauri commands.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri v2, Rust std `Command`.

---

## Files

- Modify: `src/domain/git.ts` and `src/domain/git.test.ts` for staged state, grouping, and gateway methods.
- Modify: `src/infrastructure/tauriGitGateway.ts` and `src/infrastructure/tauriGitGateway.test.ts` for new Tauri command wrappers.
- Modify: `src-tauri/src/git.rs` and `src-tauri/src/lib.rs` for local Git operations.
- Modify: `src/components/GitChangesPanel.tsx` and add `src/components/GitChangesPanel.test.tsx` for the Commit UI.
- Modify: `src/application/useWorkbenchController.ts` and tests for controller action wiring.
- Modify: `src/App.tsx` and `src/App.css` for props and layout.

## Task 1: Domain Status Model

- [ ] Add a failing domain test proving staged changes are detected and changes are grouped into tracked changes and unversioned files.
- [ ] Run `npm test -- src/domain/git.test.ts` and confirm the new test fails because helpers/fields do not exist.
- [ ] Add `isStaged` to `GitChangedFile`, add `GitChangeGroup`, `groupGitChanges`, and `hasStagedGitChanges`.
- [ ] Run `npm test -- src/domain/git.test.ts` and confirm it passes.

## Task 2: Gateway Operations

- [ ] Add failing gateway tests for `stageFiles`, `unstageFiles`, `revertFiles`, and `commit`.
- [ ] Run `npm test -- src/infrastructure/tauriGitGateway.test.ts` and confirm failures reference missing methods.
- [ ] Implement TypeScript gateway methods and no-op browser fallbacks.
- [ ] Extend Rust `GitRepositoryGateway` with `stage`, `unstage`, `revert`, and `commit`; expose Tauri commands in `lib.rs`.
- [ ] Add Rust tests for staged porcelain parsing.
- [ ] Run `npm test -- src/infrastructure/tauriGitGateway.test.ts` and `cd src-tauri && cargo test git`.

## Task 3: Commit Panel Component

- [ ] Add failing component tests for grouped sections, row preview, checkbox action, commit message typing, and commit button callback.
- [ ] Run `npm test -- src/components/GitChangesPanel.test.tsx` and confirm missing UI/props failures.
- [ ] Rewrite `GitChangesPanel` as a Commit panel with toolbar, groups, checkboxes, message field, and action buttons.
- [ ] Add focused CSS for the new layout without changing global tree behavior.
- [ ] Run `npm test -- src/components/GitChangesPanel.test.tsx`.

## Task 4: Workbench Wiring

- [ ] Add failing controller tests for staging a file and committing staged files with refresh/reset behavior.
- [ ] Run the focused controller test and confirm missing action failures.
- [ ] Add controller state for commit message and Git operation loading; implement stage, unstage, revert, commit wrappers.
- [ ] Pass new props from `App.tsx` into `GitChangesPanel`.
- [ ] Run the focused controller test.

## Task 5: Verification

- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `cd src-tauri && cargo test git`.
- [ ] Inspect `git diff --stat` and `git status --short` before final response.

