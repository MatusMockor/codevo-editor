# Agent Git Flow Design (Slice 2)

Date: 2026-08-25

Status: Proposed design, awaiting approval

## Goal

After an agent turn settles on a thread, let the user finish the work without
leaving the editor: review the changed files, commit them on the thread's
branch, push the branch (and reach the hosting site's compare/PR page),
integrate the branch into the project's main checkout, and clean the worktree
up. Additionally, open any changed file in the normal Monaco editor or as a
diff document so a review can happen with full editor tooling.

This slice builds directly on slice 1
(`2026-08-24-agent-conversational-threads-design.md`, commit `d7f29447`) and
keeps its conventions: fail-closed parsers, owner authority captured before
every `await` and revalidated after it, bounded IPC, thin Rust facades over
focused modules, no hotspot baseline growth.

## Verified starting point

TypeScript:

- `src/application/useAgentChangeSummary.ts` (348 lines): `showChanges` /
  `showFileDiff` already call `gitGateway.getStatus(worktreePath)` and
  `gitGateway.getDiff(worktreePath, change)` fenced by
  `isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)`.
  This proves the git gateway works against an arbitrary root; every
  `GitGateway` method takes `rootPath` first (`src/domain/git.ts:154-242`).
- `src/application/useAgentWorktreeLifecycle.ts` (376 lines):
  `removeWorktree(threadId)` prompts on dirty, calls
  `gitWorktreeGateway.removeWorktree(repositoryRoot, worktreePath, dirty)` and
  reports "The worktree was removed. Its branch was kept." Discard already
  exists; the branch is never deleted.
- `src/application/useAgentThreads.ts` (294 lines) composes the hooks and
  exposes `AgentThreadsSurface` (`src/application/agentThreadPorts.ts`).
  `gitGateway` is narrowed to `Pick<GitGateway, "getStatus" | "getDiff">`
  here, in `useWorkbenchAgents.ts:56` and `useWorkbenchControllerAgents.ts:62`.
- `GitGateway.commit(rootPath, message, changes)` requires staged, non-empty
  `changes`; `stageFiles` must run first (this is what
  `useGitWorkspace.ts:134-171 commitOneRepository` does, module-private).
  `GitGateway.push(rootPath)` runs bare `git push` (`git.rs:638`) and fails on a
  branch without upstream. `deleteBranch?(rootPath, name, { force })` exists
  (`delete_git_branch`). There is no merge, merge-base, remote URL, or
  `push -u` capability anywhere.
- Diff documents: `useGitDiffWorkspace.previewGitChange(change, { pin,
  repositoryRoot })` already takes an explicit `repositoryRoot` and opens
  `mockor-git-diff:<side>:<absolute path>` via
  `documentTabSession.openReadOnlyDocument`; it only requires the active
  workspace root to be current. `useWorkbenchDocumentTabs.openFile(entry,
  options)` refuses a path only when it belongs to a *different open workspace
  tab* (`useWorkbenchDocumentTabs.ts:229-237`). An agent worktree lives at
  `<repositoryRoot>/.worktrees/<threadId>`, inside the owning root.
- Agent mode: `useAgentModeState` is owned by the workspace owner key
  (switching tabs resets it). `App.tsx:1195-1201` keeps the editor surface
  mounted but `hidden` while agent mode is active, so `setAgentModeActive(false)`
  reveals an already opened tab with no remount. There is no callback from
  agent mode to the editor today.
- Persisted thread shape is closed on both sides: `parseAgentThread` uses
  `exactKeys` (`agentThreadWire.ts:122`) and Rust `AgentThread` is
  `deny_unknown_fields` (`agent_thread_store.rs:41`).

Rust:

- `git.rs` is a frozen hotspot (7113 lines / 44029 tokens, exact baseline).
  Its runner helpers (`git_command`, `run_git_remote`, `git_output_vec`,
  `safe_branch_name`) are private. No timeout or output cap exists in `git.rs`.
- `git_worktree.rs` (545 lines) has the hardened pattern to copy:
  `worktree_git_command` (`LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`,
  `-c core.hooksPath=/dev/null`, `-C <root>`), `run_worktree_command`
  (stdin null, stderr capped 8 KiB, stdout capped 256 KiB, kill on overflow),
  `ensure_worktree_path_in_base`, `read_bounded_stream`.
- `lib_composition/git_worktree_commands.rs` hard-refuses untrusted roots via
  `ensure_worktree_repository_trusted` (`UNTRUSTED_WORKTREE_REPOSITORY_ERROR`)
  while plain git commands only harden argv when untrusted.
- Registration: new module declared in `lib_composition/command_facades.rs`
  and listed in `lib_composition/runtime.rs` `generate_handler!`. Tests in
  `lib_composition/tests.rs` are `include!`d files sharing `temp_workspace`,
  `init_test_git_repo`, `run_test_git`, `path_string`.
- `tauri-plugin-opener` is a dependency; `tauriServerReadyExternalUrlOpener.ts`
  shows the validated `openUrl` pattern.
- `gh` 2.98 is installed and authenticated on the dev machine, but nothing in
  the tree resolves or runs system binaries by name except
  `tools.rs::find_path_tool`.

## Non-goals

- Creating pull requests from inside the app (see "PR decision"); reviewing
  PR comments; CI status.
- Rebase, squash, cherry-pick of thread commits, amend, partial (hunk) staging
  from agent mode, editing the author.
- Resolving merge conflicts inside agent mode. A conflicted integration is
  aborted and reported; the user resolves in the editor's git UI.
- In-place threads: commit and push are supported (the target is the
  repository root); integrate/remove are not applicable and are hidden.
- Multi-repository projects shipping several repositories at once; one thread
  targets exactly one repository.
- Opening files of a background-tab project in the editor (see trade-offs).
- Visual redesign (slice 3).

## Architecture

```text
components/agentMode: AgentShipPanel (new), AgentThreadSession (open actions)
        |
application: useAgentThreads (facade, +ship, +editor bridge)
   |- useAgentShipFlow          reducer-backed ship state machine per thread
   |- agentShipPolicy           pure preconditions and next-action rules
   |- useAgentWorktreeLifecycle removeWorktree gains { deleteBranch }
   |- useAgentEditorBridge      open file / open diff via injected callbacks
        |
domain: agentShip (state machine, bounded types, parsers)
        gitIntegration (wire types for ship status / push / integrate)
        agentThread (+ integration receipt field)
        |
infrastructure: tauriGitIntegrationGateway (+ IPC contract)
                tauriGitGateway (unchanged; stageFiles/commit/deleteBranch reused)
        |
Rust: git_integration.rs (new, own bounded runner),
      lib_composition/git_integration_commands.rs (new thin facades),
      agent_thread_store.rs (+ integration field, serde default)
```

## Decisions

### Commit

Reuse `GitGateway.stageFiles(worktreePath, changes)` then
`GitGateway.commit(worktreePath, message, changes)`. Both already run on the
Rust blocking pool, honour trust for the worktree root (the receipt's
`trusted` was set at creation), and return a fresh `GitStatus`. The change
list is the current summary from `useAgentChangeSummary` re-read immediately
before staging (never a cached list): the agent may have run again.

Message bounds: `MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES = 4096` (matches
`MAX_GIT_COMMIT_MESSAGE_LENGTH` in `gitCommitMessageHistory.ts`); trimmed,
non-empty, no NUL. The message prefills from the thread title, truncated on a
UTF-8 boundary. The workspace commit-message history is not touched
(`recordGitCommitMessage` is gated on the active workspace root by design).

Conflict-marker refusal in `git.rs stage` stays effective; its error surfaces
as `commitFailed`.

### Push

New Rust command `push_git_branch_upstream`. `git push -u <remote> <branch>`
where `<branch>` is the worktree's current branch (must equal
`agent/<threadId>` for worktree threads; for in-place threads it is the current
branch of the repository root) and `<remote>` is chosen by a closed rule:
the branch's configured upstream remote if any, else `origin` if it exists,
else the only remote if exactly one exists, else `noRemote`. Remote names are
validated with `git check-ref-format --branch`-style rules plus
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; they are never user-typed in this slice.

### PR decision: push and open the compare URL, no `gh`

Recommendation: do **not** integrate `gh` in slice 2. Reasons:

1. The only closed no-shell runners that exist are `git_worktree.rs` (git only,
   `-C` hard-coded) and the agent supervisor (streaming, 1 h watchdog, event
   channels). `process_task_resolver` structurally forbids system binaries.
   Running `gh` would need a fourth process runner with a wall-clock timeout,
   env allowlist including credentials (`GH_TOKEN`, keyring access), absolute
   path discovery (`tools.rs::find_path_tool` precedent), a bounded JSON parser
   for `gh pr create --json`, and a settings entry for the binary. That is a
   slice on its own, and its failure modes (auth expiry, browser login prompt,
   host mismatch) are not bounded by anything we control.
2. `git remote get-url` plus a closed host table gives the same user outcome
   in one hop: push, then open
   `https://github.com/<owner>/<repo>/compare/<base>...<branch>?expand=1`
   (GitHub), `.../-/merge_requests/new?merge_request[source_branch]=<branch>`
   (GitLab), or `.../pull-requests/new?source=<branch>` (Bitbucket). Unknown
   hosts yield `compareUrl: null` and the panel says "Pushed. Open a pull
   request on your hosting site." with the branch name copyable.
3. It keeps "no raw shell command strings" and "no executable payloads" trivially
   true: the compare URL is derived in Rust from bounded git output, validated
   as `https` with a host from the closed table, and opened through the
   existing `tauri-plugin-opener` `openUrl` path.

`gh` support can be added later as an optional `ShipPublishStrategy` without
touching the state machine (the `pushed` state already carries the receipt it
would need).

### Integrate (merge into the main checkout)

New Rust command `integrate_git_worktree_branch` executed in the primary
checkout (`repositoryRoot`). Two modes, chosen by the user in the panel, both
run with `--no-edit` and hooks disabled:

- `fastForward`: `git merge --ff-only <branch>`.
- `merge`: `git merge --no-ff --no-edit -m "Merge agent/<id> (<title>)" <branch>`.

Preconditions enforced in Rust immediately before the merge (the "confirm" half
of the two-phase protocol):

- primary checkout is clean (`status --porcelain=v1 --untracked-files=no` empty;
  untracked files are allowed, matching git's own merge safety);
- primary `HEAD` equals `expectedPrimaryHead` and the branch tip equals
  `expectedBranchHead` captured by `get_git_ship_status` (stale expectations
  fail closed with `staleExpectation`);
- primary current branch is a real branch (not detached) and is not the agent
  branch itself;
- `expectedPrimaryBranch` equals the current primary branch.

On a conflicting merge Rust runs `git merge --abort`, verifies
`MERGE_HEAD` is gone, and returns `conflicted` with the bounded conflicted file
list (`git diff --name-only --diff-filter=U`, max 200 entries, `truncated`
flag). If the abort itself fails, the result is `abortFailed` and the panel
tells the user the main checkout is mid-merge and must be resolved in the git
UI; nothing else is attempted.

Integration never pushes the primary branch; the user pushes from the git UI.

### Remove after integrate

Reuse `remove_git_worktree` (existing disposal hooks stop agent tasks, dispose
runtimes, revoke worktree trust) followed by `delete_git_branch` with
`force: false` (`git branch -d`, which git only accepts when the branch is
merged). Branch deletion is offered only after `integrated`; on "Discard" the
branch is kept as today (an explicit checkbox "also delete branch agent/<id>"
uses `force: true` and requires the dirty-worktree confirmation to have been
answered).

### Editor integration

Open in editor: `openFile({ name, path: <worktreeAbsolutePath>, kind: "file" },
{ pin: true, recordNavigation: true })` then `setAgentModeActive(false)`.
Allowed only when `projectOrigin === "active-tab"` for the thread's project
(the worktree path is then inside the current workspace root, so all existing
containment checks pass). For `background-tab` / `closed-tab-live-tasks`
projects the action is disabled with the caption "Switch to this project's tab
to open files."

Open diff: `openGitChange(change, worktreePath)` with the same origin gate,
then `setAgentModeActive(false)`. The document path
`mockor-git-diff:worktree:<absolute worktree file path>` is unique per
worktree and the diff is computed against `repositoryRoot = worktreePath`, so
it never collides with the main checkout's diff of the same relative file.

Trade-off, stated plainly: files from a worktree open as documents of the
owning project root. Language servers, diagnostics, and git decorations
attribute them to that root (TypeScript will typically find the worktree's own
`tsconfig` upward, git decorations resolve the mapping of the main repository
and show the file as untracked/ignored). This is acceptable for review-and-fix
edits and is the smallest correct option: opening the worktree as a workspace
tab would create a second agent project root, a second lease, and a second
trust decision for a directory that is deleted minutes later. The
alternative remains available manually (File > Open Folder on the worktree).

### Persistence

Add `integration: AgentThreadIntegration | null` to `AgentThread`
(`agentThread.ts`, `agentThreadWire.ts` serialize/parse, Rust
`AgentThread` with `#[serde(default)]`). Schema version stays 1: absent means
`null`, unknown keys still fail. The field is a compact receipt, not the live
state machine:

```ts
export interface AgentThreadIntegration {
  readonly lastCommitSha: string | null;        // 40 hex
  readonly pushed: { remote: string; branch: string } | null;
  readonly integrated: { intoBranch: string; mergeSha: string; mode: AgentShipIntegrationMode } | null;
  readonly branchDeleted: boolean;
}
```

The live ship state is in-memory only; on reload the panel is rebuilt from the
receipt plus a fresh `get_git_ship_status`.

## Domain model

### `src/domain/gitIntegration.ts` (wire types, parsers)

```ts
export const MAX_GIT_INTEGRATION_CONFLICT_FILES = 200;
export const MAX_GIT_INTEGRATION_REMOTE_BYTES = 128;
export const MAX_GIT_INTEGRATION_URL_BYTES = 2048;
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface GitShipStatus {
  readonly worktree: {
    readonly branch: string;                 // current branch in worktreePath
    readonly head: string;                   // sha
    readonly dirty: boolean;
    readonly changeCount: number;            // bounded by Rust to 10_000
  };
  readonly primary: {
    readonly branch: string | null;          // null = detached
    readonly head: string;
    readonly dirty: boolean;                 // tracked changes only
  };
  readonly relation: {
    readonly aheadOfPrimary: number;         // rev-list --count primary..branch
    readonly behindPrimary: number;          // rev-list --count branch..primary
    readonly fastForwardable: boolean;       // merge-base == primary.head
  };
  readonly remote: {
    readonly name: string;
    readonly upstream: { readonly ahead: number; readonly behind: number } | null;
    readonly compareUrl: string | null;
  } | null;
}

export type GitIntegrationMode = "fastForward" | "merge";

export type GitIntegrationOutcome =
  | { readonly kind: "integrated"; readonly mergeSha: string; readonly intoBranch: string }
  | { readonly kind: "conflicted"; readonly files: ReadonlyArray<string>; readonly truncated: boolean }
  | { readonly kind: "primaryDirty" }
  | { readonly kind: "primaryDetached" }
  | { readonly kind: "staleExpectation" }
  | { readonly kind: "notFastForward" }
  | { readonly kind: "abortFailed"; readonly message: string };

export interface GitPushReceipt {
  readonly remote: string;
  readonly branch: string;
  readonly compareUrl: string | null;
}

export interface GitIntegrationGateway {
  getShipStatus(request: { repositoryRoot: string; worktreePath: string | null }): Promise<GitShipStatus>;
  pushBranchUpstream(request: { repositoryRoot: string; worktreePath: string | null }): Promise<GitPushReceipt>;
  integrateWorktreeBranch(request: {
    repositoryRoot: string;
    worktreePath: string;
    mode: GitIntegrationMode;
    expectedPrimaryBranch: string;
    expectedPrimaryHead: string;
    expectedBranchHead: string;
    mergeMessage: string;
  }): Promise<GitIntegrationOutcome>;
}
```

`worktreePath: null` means "the repository root itself" (in-place threads);
Rust then uses the root for the worktree side and rejects `integrate`.

Parsers (`parseGitShipStatus`, `parseGitIntegrationOutcome`,
`parseGitPushReceipt`) follow `gitWorktree.ts`: `exactKeys`, bounded UTF-8,
closed enums, `compareUrl` must be `https://` with a host from the closed
table, counts are non-negative integers <= 1_000_000.

### `src/domain/agentShip.ts` (state machine)

```ts
export const MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES = 4096;
export const MAX_AGENT_SHIP_FAILURE_BYTES = 1024;

export type AgentShipIntegrationMode = GitIntegrationMode;

export type AgentShipStep = "commit" | "push" | "integrate" | "removeWorktree";

export type AgentShipFailure =
  | { readonly step: "commit"; readonly reason: "nothingToCommit" | "gitError"; readonly message: string }
  | { readonly step: "push"; readonly reason: "noRemote" | "rejected" | "authRequired" | "gitError"; readonly message: string }
  | { readonly step: "integrate"; readonly outcome: Exclude<GitIntegrationOutcome, { kind: "integrated" }> }
  | { readonly step: "removeWorktree"; readonly reason: "dirty" | "gitError" | "branchNotMerged"; readonly message: string }
  | { readonly step: AgentShipStep; readonly reason: "authorityLost" };

export type AgentShipState =
  | { readonly kind: "idle"; readonly status: GitShipStatus | null; readonly loadingStatus: boolean }
  | { readonly kind: "committing"; readonly status: GitShipStatus; readonly message: string }
  | { readonly kind: "committed"; readonly status: GitShipStatus; readonly commitSha: string }
  | { readonly kind: "pushing"; readonly status: GitShipStatus; readonly commitSha: string | null }
  | { readonly kind: "pushed"; readonly status: GitShipStatus; readonly receipt: GitPushReceipt }
  | { readonly kind: "integrating"; readonly status: GitShipStatus; readonly mode: AgentShipIntegrationMode }
  | { readonly kind: "integrated"; readonly status: GitShipStatus; readonly mergeSha: string; readonly intoBranch: string }
  | { readonly kind: "removingWorktree"; readonly status: GitShipStatus; readonly deleteBranch: boolean }
  | { readonly kind: "worktreeRemoved"; readonly branchDeleted: boolean }
  | { readonly kind: "failed"; readonly status: GitShipStatus | null; readonly failure: AgentShipFailure; readonly resumeFrom: AgentShipState["kind"] };

export type AgentShipAction =
  | { readonly kind: "statusRequested" }
  | { readonly kind: "statusLoaded"; readonly status: GitShipStatus }
  | { readonly kind: "statusFailed"; readonly message: string }
  | { readonly kind: "commitStarted"; readonly message: string }
  | { readonly kind: "commitSucceeded"; readonly commitSha: string; readonly status: GitShipStatus }
  | { readonly kind: "pushStarted" }
  | { readonly kind: "pushSucceeded"; readonly receipt: GitPushReceipt; readonly status: GitShipStatus }
  | { readonly kind: "integrateStarted"; readonly mode: AgentShipIntegrationMode }
  | { readonly kind: "integrateSucceeded"; readonly mergeSha: string; readonly intoBranch: string; readonly status: GitShipStatus }
  | { readonly kind: "removeStarted"; readonly deleteBranch: boolean }
  | { readonly kind: "removeSucceeded"; readonly branchDeleted: boolean }
  | { readonly kind: "stepFailed"; readonly failure: AgentShipFailure }
  | { readonly kind: "reset" };

export function agentShipReducer(state: AgentShipState, action: AgentShipAction): AgentShipState;
export function initialAgentShipState(receipt: AgentThreadIntegration | null): AgentShipState;
export function agentShipTransitionAllowed(state: AgentShipState, action: AgentShipAction): boolean;
```

Rules (exhaustive `switch`, `never` check; an action that is not allowed for
the current state returns the state unchanged, and the hook reports it as a
programming-error notice in dev builds):

- `*Started` is allowed only from `idle`, `committed`, `pushed`, `integrated`,
  or `failed` with a matching `resumeFrom`; never from a busy state.
- `statusLoaded` is allowed in any non-busy state and replaces `status`
  (a fresh status may reveal that a step is no longer needed, e.g. clean tree
  after an external commit; `agentShipPolicy` decides what to show).
- `stepFailed` moves to `failed` and records `resumeFrom` = the state before
  the busy state, so "Retry" is exact.
- `reset` returns to `idle` with the last `status` kept.
- `initialAgentShipState(receipt)`: `integrated` receipt -> `integrated`;
  `pushed` receipt -> `pushed`; `lastCommitSha` -> `committed`; else `idle`.
  The hook immediately requests a fresh status so the receipt never
  overstates reality (a receipt without matching git state falls back to
  `idle` via `agentShipPolicy.reconcile`).

### `src/application/agentShipPolicy.ts` (pure)

```ts
export type AgentShipAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "blocked"; readonly reason: string };

export function commitAvailability(view: AgentThreadView, state: AgentShipState): AgentShipAvailability;
export function pushAvailability(view: AgentThreadView, state: AgentShipState): AgentShipAvailability;
export function integrateAvailability(view: AgentThreadView, state: AgentShipState, mode: AgentShipIntegrationMode): AgentShipAvailability;
export function removeAvailability(view: AgentThreadView, state: AgentShipState): AgentShipAvailability;
export function reconcile(state: AgentShipState, status: GitShipStatus): AgentShipState;
export function defaultCommitMessage(thread: AgentThread): string;
export function defaultIntegrationMode(status: GitShipStatus): AgentShipIntegrationMode;
```

Blocking reasons are bounded literal strings: "Stop the agent first.", "The
worktree no longer exists.", "Nothing to commit.", "Commit before pushing.",
"No remote is configured for this repository.", "The main checkout has
uncommitted changes.", "The main checkout is detached.", "The branch is behind
the main checkout; use Merge instead of Fast-forward.", "Integrate the branch
before deleting it.", "In-place threads have nothing to integrate."

## Application layer

### `useAgentShipFlow(deps)` (new, target <= 450 lines)

```ts
export interface AgentShipFlowDependencies {
  readonly gitGateway: Pick<GitGateway, "getStatus" | "stageFiles" | "commit" | "deleteBranch">;
  readonly gitIntegrationGateway: GitIntegrationGateway;
  readonly gitWorktreeGateway: Pick<GitWorktreeGateway, "removeWorktree">;
  readonly externalUrlOpener: { openExternal(url: string): Promise<void> } | null;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly missingWorktreeThreadIds: ReadonlySet<string>;
  readonly dispatchThreadAction: (action: AgentThreadsAction) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onWorktreeRemoved: (threadId: string) => void;
}

export interface AgentShipFlowSurface {
  readonly states: ReadonlyMap<string, AgentShipState>;
  refreshShipStatus(threadId: string): Promise<void>;
  commit(threadId: string, message: string): Promise<void>;
  push(threadId: string): Promise<void>;
  openCompareUrl(threadId: string): Promise<void>;
  integrate(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
  removeWorktree(threadId: string, options: { deleteBranch: boolean }): Promise<void>;
  resetShip(threadId: string): void;
  clear(threadId: string): void;
}
```

Every operation follows the same skeleton, mirroring
`useAgentWorktreeLifecycle.removeWorktree`:

1. Resolve `thread`, refuse if `runningTurn(thread) !== null` or the thread is
   in `missingWorktreeThreadIds`; resolve the project via `projectByOwnerId`,
   capture `authority = projectAuthority(project)` plus `repositoryRoot`,
   `worktreePath`, `threadId`.
2. Check `agentShipTransitionAllowed` and dispatch `*Started` (synchronous, so
   a second click is rejected by the reducer).
3. `await` gateway call(s); after **each** `await` call
   `isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)`
   and, on loss, dispatch `stepFailed { reason: "authorityLost" }` and stop
   (no compensation is possible or needed: git operations are atomic per
   command).
4. Dispatch `*Succeeded`, then persist the receipt through
   `dispatchThreadAction({ kind: "integrationRecorded", threadId, integration })`.

Per-thread serialization: a `Map<threadId, Promise<void>>` tail ensures at most
one in-flight ship operation per thread; operations on different threads run
concurrently. Rust additionally refuses concurrent integrations into the same
primary root (see Rust section).

`commit(threadId, message)`: validate message bounds; `status =
await gitGateway.getStatus(worktreePath)`; if `changes.length === 0` fail with
`nothingToCommit`; `await stageFiles(worktreePath, status.changes)`; `await
commit(worktreePath, message, status.changes)`; then `refreshShipStatus`
(which yields `worktree.head` = new sha; the reducer stores it as
`commitSha`).

`push(threadId)`: `receipt = await gitIntegrationGateway.pushBranchUpstream`;
error classification is done on the bounded error string in Rust and returned
as a typed failure (`noRemote`, `rejected` for non-fast-forward, `authRequired`
for "Authentication failed"/"could not read Username", else `gitError`).

`integrate(threadId, mode)`: requires `state.status` (fresh, <= 30 s old,
otherwise refresh first); confirm via `prompter.confirm` when `mode ===
"merge"` and `status.relation.behindPrimary > 0` ("The branch is N commits
behind <primary>. Merge anyway?"); call `integrateWorktreeBranch` with the
expected heads from `state.status`; map the outcome.

`removeWorktree(threadId, { deleteBranch })`: if the worktree is dirty
(fresh status) confirm with the existing `DIRTY_WORKTREE_CONFIRMATION`; call
`gitWorktreeGateway.removeWorktree(repositoryRoot, worktreePath, dirty)`;
then, if `deleteBranch`, `gitGateway.deleteBranch(repositoryRoot,
status.worktree.branch, { force: state.kind !== "integrated" })`; notify
`onWorktreeRemoved(threadId)` so `useAgentWorktreeLifecycle` marks the thread
removed and refreshes orphans. The existing
`useAgentWorktreeLifecycle.removeWorktree` stays for the info column's
"Remove worktree" (discard) and gains no new behaviour; the ship panel calls the
ship-flow variant.

`openCompareUrl`: opens `state.receipt.compareUrl` through
`externalUrlOpener`; `null` opener (non-Tauri) shows the URL as text.

### `useAgentEditorBridge(deps)` (new, <= 120 lines)

```ts
export interface AgentEditorBridgeDependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly editor: AgentEditorBridgePort | null;
}
export interface AgentEditorBridgePort {
  openFile(entry: FileEntry, options: { pin: true; recordNavigation: true }): Promise<boolean>;
  openGitChange(change: GitChangedFile, repositoryRoot: string): Promise<void>;
  leaveAgentMode(): void;
}
export interface AgentEditorBridgeSurface {
  canOpenInEditor(threadId: string): AgentShipAvailability;
  openChangedFile(threadId: string, change: GitChangedFile): Promise<void>;
  openChangedFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
}
```

Gate: project exists, `origin === "active-tab"`, `change.path` starts with
`${worktreePath}/` (or `${repositoryRoot}/` for in-place), file status is not
`deleted` (deleted files open as diff only). After the `await openFile`, the
bridge revalidates the project generation before `leaveAgentMode()`; if the
owner changed meanwhile it stays in agent mode.

The port is implemented in `useWorkbenchControllerAgents.ts` from three
values that already exist before the agents wiring in
`useWorkbenchController.ts` (`openFileRef` line 1034, `openGitChange` line
1636, `setAgentModeActive` line 615):

```ts
editorBridge: { openFileRef, openGitChange, leaveAgentMode: () => setAgentModeActive(false) },
```

`useWorkbenchController.ts` and `App.tsx` are both exactly at their hotspot
baselines. The controller change is one option line; the implementer must run
`npm run size:hotspots` and, if the raw-line or structural-token budget is
exceeded, offset it by moving the `useWorkbenchControllerAgents` option block
into a `workbenchControllerAgentOptions.ts` builder (untracked file) rather
than bumping the baseline. `App.tsx` is not touched: `AgentModeScreen` already
receives the whole `WorkbenchAgentsSurface`.

### Facade changes (`useAgentThreads.ts`, `agentThreadPorts.ts`)

`AgentThreadView` gains `readonly ship: AgentShipState` and
`readonly editorAvailability: AgentShipAvailability`.
`AgentThreadsSurface` gains:

```ts
refreshShipStatus(threadId: string): Promise<void>;
commitThreadChanges(threadId: string, message: string): Promise<void>;
pushThreadBranch(threadId: string): Promise<void>;
openThreadCompareUrl(threadId: string): Promise<void>;
integrateThreadBranch(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
removeThreadWorktree(threadId: string, options: { deleteBranch: boolean }): Promise<void>;
resetThreadShip(threadId: string): void;
openChangedFile(threadId: string, change: GitChangedFile): Promise<void>;
openChangedFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
```

`AgentThreadsDependencies.gitGateway` widens to
`Pick<GitGateway, "getStatus" | "getDiff" | "stageFiles" | "commit" | "deleteBranch">`
and gains `gitIntegrationGateway`, `externalUrlOpener`, `editorBridge`
(propagated through `useWorkbenchAgents.ts` and
`useWorkbenchControllerAgents.ts`; defaults in `workbenchDefaultGateways.ts`).
`onTurnTerminal` additionally calls `refreshShipStatus(threadId)` when a ship
state exists for the thread, so the panel updates after each turn.

Reducer addition in `agentThread.ts`:

```ts
| { readonly kind: "integrationRecorded"; readonly threadId: string; readonly integration: AgentThreadIntegration }
```

It refuses when the thread is missing or archived; it bumps
`updatedAtEpochMs`; the store persists on this action (add to the trigger
list in `useAgentThreadStore`).

## Rust backend

### `src-tauri/src/git_integration.rs` (new, target <= 900 lines incl. tests)

Own bounded runner, copied from `git_worktree.rs` and generalised:

```rust
pub const MAX_INTEGRATION_STDOUT_BYTES: usize = 256 * 1024;
pub const MAX_INTEGRATION_STDERR_BYTES: usize = 8 * 1024;
pub const MAX_INTEGRATION_CONFLICT_FILES: usize = 200;
pub const MAX_INTEGRATION_CHANGE_COUNT: usize = 10_000;
pub const MAX_REMOTE_NAME_BYTES: usize = 128;
pub const MAX_COMPARE_URL_BYTES: usize = 2048;
pub const MAX_MERGE_MESSAGE_BYTES: usize = 1024;
pub const INTEGRATION_NETWORK_TIMEOUT: Duration = Duration::from_secs(120);
pub const INTEGRATION_LOCAL_TIMEOUT: Duration = Duration::from_secs(30);

fn integration_git_command(root: &Path) -> Command;   // LC_ALL=C, GIT_TERMINAL_PROMPT=0, -c core.hooksPath=/dev/null, -c core.fsmonitor=false, -C root
fn run_integration_command(root: &Path, args: &[&OsStr], timeout: Duration) -> Result<String, String>;
```

`run_integration_command`: `stdin(null)`, `process_group(0)`, stdout/stderr
read on threads through `read_bounded_stream` (reuse the `pub(crate)` one in
`git_worktree.rs`), a watchdog thread that kills the process group on timeout
(`kill(-pgid, SIGKILL)`), child waited in all paths (RAII `ChildGuard` whose
`Drop` kills and reaps). Errors are the trimmed stderr (<= 8 KiB) or a fixed
string.

Public functions (all take canonical, validated paths):

```rust
pub struct ShipTargets { pub repository_root: PathBuf, pub worktree: PathBuf }
pub fn resolve_ship_targets(repository_root: &Path, worktree_path: Option<&Path>) -> Result<ShipTargets, String>;
// worktree Some => ensure_worktree_path_in_base(root, worktree); None => worktree = root

pub fn ship_status(targets: &ShipTargets) -> Result<GitShipStatus, String>;
pub fn push_branch_upstream(targets: &ShipTargets) -> Result<GitPushReceipt, PushFailure>;
pub fn integrate_branch(targets: &ShipTargets, request: &IntegrationRequest) -> Result<GitIntegrationOutcome, String>;
pub fn compare_url(remote_url: &str, base: &str, branch: &str) -> Option<String>;   // pure, closed host table
pub fn choose_remote(upstream_remote: Option<&str>, remotes: &[String]) -> Option<String>; // pure
```

argv used (all literal, arguments validated):

| purpose | argv (in `-C <dir>`) |
|---|---|
| branch | `branch --show-current` |
| head | `rev-parse --verify HEAD` |
| dirty (worktree) | `status --porcelain=v1 -z --untracked-files=all` (count only, capped) |
| dirty (primary) | `status --porcelain=v1 -z --untracked-files=no` |
| ahead/behind | `rev-list --left-right --count <primary>...<branch>` |
| merge-base | `merge-base <primary> <branch>` |
| remotes | `remote` ; `remote get-url --push <name>` |
| upstream | `rev-parse --abbrev-ref --symbolic-full-name @{u}` ; `rev-list --left-right --count @{u}...HEAD` |
| push | `push -u -- <remote> <branch>` (network timeout) |
| integrate ff | `merge --ff-only -- <branch>` |
| integrate merge | `merge --no-ff --no-edit -m <message> -- <branch>` |
| conflict list | `diff --name-only --diff-filter=U` |
| abort | `merge --abort` then `rev-parse --verify --quiet MERGE_HEAD` must fail |

Branch names pass a local `safe_branch_name` (no leading `-`, no `@{`, no
control chars, <= 512 bytes, then `check-ref-format --branch`). The agent
branch must additionally start with `agent/` when `worktree_path` is `Some`.

### `src-tauri/src/lib_composition/git_integration_commands.rs` (new)

```rust
pub(crate) const UNTRUSTED_INTEGRATION_REPOSITORY_ERROR: &str =
    "Shipping agent changes requires a trusted repository.";
pub(crate) const INTEGRATION_IN_PROGRESS_ERROR: &str =
    "Another integration is already running for this repository.";

#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShipStatusRequest { repository_root: String, worktree_path: Option<String> }

#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PushBranchUpstreamRequest { repository_root: String, worktree_path: Option<String> }

#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IntegrateWorktreeBranchRequest {
    repository_root: String,
    worktree_path: String,
    mode: GitIntegrationMode,            // enum { FastForward, Merge }, rename_all camelCase
    expected_primary_branch: String,
    expected_primary_head: String,       // 40 hex
    expected_branch_head: String,        // 40 hex
    merge_message: String,               // <= 1024 bytes, no NUL
}

#[tauri::command] pub(crate) async fn get_git_ship_status(request: ShipStatusRequest, trust: GitTrustState<'_>) -> Result<GitShipStatus, String>;
#[tauri::command] pub(crate) async fn push_git_branch_upstream(request: PushBranchUpstreamRequest, trust: GitTrustState<'_>) -> Result<GitPushReceipt, String>;
#[tauri::command] pub(crate) async fn integrate_git_worktree_branch(request: IntegrateWorktreeBranchRequest, trust: GitTrustState<'_>, guard: State<'_, IntegrationLocks>) -> Result<GitIntegrationOutcome, String>;
```

Responses are `Serialize` only, `rename_all = "camelCase"`, and
`GitIntegrationOutcome` is `#[serde(tag = "kind")]`. Push failures are
returned as `Err(String)` prefixed with a closed code (`noRemote:`,
`rejected:`, `authRequired:`, `gitError:`) that the TS contract parses into the
typed failure; the message after the prefix is <= 1 KiB.

Trust: `ensure_integration_repository_trusted(trusted_for(&trust,
&repository_root)?)` hard-refuses (pattern of
`ensure_worktree_repository_trusted`); for `worktree_path: Some` the worktree
root must also be trusted. All bodies run in `run_blocking_command`.

`IntegrationLocks`: `Mutex<HashSet<PathBuf>>` of canonical primary roots with
an RAII `IntegrationPermit` that removes the entry on `Drop` (including panic
unwind); the mutex is held only to insert/remove, never across git work. A
second `integrate` on the same root fails fast with
`INTEGRATION_IN_PROGRESS_ERROR`.

Registration: `command_facades.rs` module declaration and re-export;
`runtime.rs` handler list (three entries) and `.manage(IntegrationLocks::default())`.

### `agent_thread_store.rs`

`AgentThread` gains `#[serde(default)] pub integration:
Option<AgentThreadIntegration>` with nested `deny_unknown_fields` structs
mirroring the TS shape; bounds validated in `validate_thread` (sha 40 hex,
remote/branch <= 512 bytes).

### Infrastructure (TS)

`src/infrastructure/tauriGitIntegrationIpcContract.ts` with
`GET_GIT_SHIP_STATUS_IPC_COMMAND = "get_git_ship_status"`,
`PUSH_GIT_BRANCH_UPSTREAM_IPC_COMMAND = "push_git_branch_upstream"`,
`INTEGRATE_GIT_WORKTREE_BRANCH_IPC_COMMAND = "integrate_git_worktree_branch"`,
request validators and response parsers; `tauriGitIntegrationGateway.ts`
mirrors `TauriGitWorktreeGateway` (injectable `invokeCommand`, non-Tauri
returns rejection "Git unavailable."). The existing `TauriGitGateway` is reused
unchanged for stage/commit/deleteBranch.

## UI structure (`src/components/agentMode`)

- New `AgentShipPanel.tsx` (<= 350 lines), rendered inside
  `AgentThreadSession` below the changes section when the thread is
  `settled`, has `isolation === "worktree"` or `"in-place"`, and
  `!worktreeRemoved && !worktreeMissing`. Sections, in order, each a
  `.agent-info__section` with an `.agent-microlabel`:
  1. **Status line**: branch `agent/<id>`, `+N/-M vs <primary>`, main checkout
     clean/dirty, remote name or "no remote". Refresh `.agent-linkbutton`.
  2. **Commit**: textarea (prefilled title, bounded), "Commit N files" button
     (`.agent-info__action--main`). Disabled reason shown as caption.
  3. **Push**: "Push branch" button; after `pushed`: "Open compare page"
     (`compareUrl`) or the branch name with "Copy" when no URL.
  4. **Integrate** (worktree only): radio `Fast-forward` / `Merge commit`
     (default from `defaultIntegrationMode`), "Integrate into <primary>" button.
     Truthful states: "Main checkout has uncommitted changes" (blocked),
     "Detached HEAD" (blocked), conflict list after `conflicted` with "Merge
     aborted; the main checkout is unchanged.", `abortFailed` as
     `.agent-note--bad`.
  5. **Clean up** (worktree only, after `integrated`): checkbox "Delete branch
     agent/<id>", "Remove worktree" (`.agent-info__action--danger`).
  Every busy state disables all buttons and shows `.agent-dot--running` with
  the step label; `failed` shows the bounded message with "Retry" and
  "Dismiss" (`resetThreadShip`).
- `AgentThreadSession.tsx`: the changes list rows gain two `.agent-linkbutton`s
  per file, "Open" and "Diff", wired to `onOpenChangedFile` /
  `onOpenChangedFileDiff`; disabled with the availability reason as `title`
  when `editorAvailability.kind === "blocked"`. Props added:
  `onOpenChangedFile`, `onOpenChangedFileDiff`, and a `ship` prop group
  forwarded to `AgentShipPanel`. To respect its 460-line size, the existing
  `AgentThreadChanges` / `AgentThreadDiff` helpers move to
  `AgentThreadChanges.tsx` (pure move, same tests).
- `AgentThreadInfoColumn.tsx`: "Remove worktree" stays (discard path); its
  label becomes "Discard worktree" when `ship.kind !== "integrated"` to be
  truthful about the branch being kept.
- `AgentModeView.tsx`: forwards the new surface members; no state added.
- `agentModePresentation.ts`: `agentShipStepLabel(state)`,
  `agentShipFailureLabel(failure)` (bounded strings), `compareHostLabel(url)`.
- CSS: reuse existing classes; the only new selectors are
  `.agent-ship`, `.agent-ship__row`, `.agent-ship__message` in `App.css`
  (`agentModeResponsiveStyles.test.ts` must be extended if the grid changes;
  it should not).

## Failure modes

| Failure | Behaviour |
|---|---|
| Commit with no changes | `failed { commit, nothingToCommit }`; status refreshed; button disabled with "Nothing to commit." |
| Conflict markers in a staged file | `stage` refuses (existing); `failed { commit, gitError }` with git's message. |
| Push: no remote | Rust returns `noRemote:`; panel shows "No remote is configured" and offers the branch name; integrate still available. |
| Push rejected (non-fast-forward) | `failed { push, rejected }`: "The remote branch has newer commits. Pull them in the editor's git UI, then retry." |
| Push needs credentials / prompt | `GIT_TERMINAL_PROMPT=0` makes git fail immediately; `authRequired`: "Git could not authenticate. Configure a credential helper or SSH key, then retry." |
| Push exceeds 120 s | process group killed; `gitError` "Push timed out." |
| Unknown hosting site | `compareUrl: null`; pushed state shows branch + "Copy". |
| Main checkout dirty | Rust `primaryDirty` (also pre-blocked in UI from status); no merge attempted. |
| Main checkout detached / on agent branch | `primaryDetached` / request rejected; blocked in UI. |
| Fast-forward impossible | `notFastForward`; UI suggests "Merge commit". |
| Merge conflict | `merge --abort`, verified; `conflicted` with file list (<= 200, `truncated`). |
| Abort fails | `abortFailed`; panel: "The main checkout is in a conflicted merge. Resolve it in the Git panel." Ship state stays `failed`; no further ship steps until status shows a clean primary. |
| Heads moved between status and integrate | `staleExpectation`; UI refreshes status and asks to retry. |
| Two integrations into one repository | second fails fast with `INTEGRATION_IN_PROGRESS_ERROR`. |
| Two ship operations on one thread | second rejected by reducer (`agentShipTransitionAllowed`) and per-thread tail. |
| Worktree deleted externally mid-flow | `getStatus` fails; `failed { gitError }`; `missingWorktreeThreadIds` blocks further steps. |
| Owner generation changes after an `await` | `stepFailed { authorityLost }`; no state published; git result discarded (git state on disk is whatever the command left, which is consistent by construction). |
| Branch delete refused (not merged) | `failed { removeWorktree, branchNotMerged }`; worktree is already removed; message says the branch was kept. |
| Untrusted repository or worktree | hard refusal `UNTRUSTED_INTEGRATION_REPOSITORY_ERROR`; panel hidden with "Trust this project to ship changes." |
| Store rejects the receipt | existing "save failed" notice; in-memory state continues. |
| Opening a file whose project is a background tab | blocked with caption; no navigation. |
| Opening a deleted file | "Open" disabled, "Diff" available. |
| In-place thread | Integrate/Clean-up sections hidden; commit/push act on the repository root. |

## Performance

- `get_git_ship_status` runs at most seven short git invocations, all bounded
  and on the blocking pool; it is requested on panel mount, after each ship
  step, on turn terminal, and on manual refresh only (no polling).
- The panel is `React.memo` keyed by `ship` state and `status`; it never
  rerenders for turn output.
- Change counts are capped in Rust (10 000) so a huge worktree status does not
  serialize a file list twice (`getStatus` for commit still returns the list,
  bounded by existing `MAX_AGENT_TASK_CHANGE_ROWS` for display).
- Output caps and timeouts as listed; no unbounded `Command::output()` in the
  new module.

## Testing strategy

### Domain (vitest)

- `agentShip.test.ts`: every legal transition; illegal transitions are no-ops;
  `resumeFrom` correctness; `initialAgentShipState` from each receipt shape;
  `reconcile` drops a `committed` receipt whose sha is not the worktree head.
- `gitIntegration.test.ts`: parser round trips; rejects unknown keys, non-https
  compare URLs, hosts outside the table, negative counts, malformed shas.
- `agentShipPolicy.test.ts`: availability matrix (running turn, missing
  worktree, dirty primary, detached, in-place, behind primary).

### Application (vitest, real collaborators, `act`/`waitFor`)

Harness pattern from `useAgentWorktreeLifecycle.test.tsx`: hand-built fake
`gitGateway`, `gitIntegrationGateway`, `gitWorktreeGateway` with `deferred()`
promises.

- `useAgentShipFlow.test.tsx`: commit stages exactly the fresh status list;
  A -> B -> A generation change between `stageFiles` and `commit` yields
  `authorityLost` and no `commitSucceeded`; push failure prefixes map to typed
  failures; integrate passes the exact expected heads; `conflicted` outcome
  renders files and leaves state resumable; two rapid `push` calls execute one
  gateway call; `removeWorktree` with `deleteBranch` after `integrated` uses
  `force: false`; receipt persisted via `integrationRecorded`; unmount during
  an in-flight push publishes nothing.
- `useAgentEditorBridge.test.tsx`: background-tab project blocked; active-tab
  opens file with `pin: true` then leaves agent mode; owner change after
  `openFile` resolves does not leave agent mode; deleted file blocked for open,
  allowed for diff; diff called with `repositoryRoot === worktreePath`.
- `useAgentThreads.test.tsx`: new surface members wired; `onTurnTerminal`
  refreshes ship status only when a state exists.
- `useAgentThreadStore.test.tsx`: `integrationRecorded` triggers a save; a
  loaded thread without `integration` parses as `null`.

### Components (vitest jsdom)

- `AgentShipPanel.test.tsx`: each state renders the truthful copy; buttons
  disabled in busy states; conflict list capped note; compare URL button
  present only when non-null; retry dispatches the right action.
- `AgentThreadSession.test.tsx`: Open/Diff buttons and their disabled captions;
  render-count probes unchanged.
- `AgentModeView.test.tsx`: `surface()` helper extended with the new members.

### Rust

- `git_integration.rs` unit tests with a hermetic `TempRepository` fixture
  (copy of the one in `git_worktree_commands.rs`) plus a bare remote:
  ship status ahead/behind/fast-forwardable; `choose_remote` table;
  `compare_url` for GitHub https/ssh, GitLab, Bitbucket, unknown -> `None`,
  oversize -> `None`; push sets upstream and second push is a no-op; push to a
  repo without remote -> `noRemote`; push after remote advanced -> `rejected`;
  ff integrate; no-ff integrate creates a merge commit with the given message;
  conflict -> `conflicted` with file list and `MERGE_HEAD` absent afterwards;
  dirty primary -> `primaryDirty` and nothing changed; stale head ->
  `staleExpectation`; detached -> `primaryDetached`; branch name with leading
  `-` rejected; timeout kills a stalled process (use a `git` alias script only
  if the harness allows, else unit-test the watchdog with `sleep`).
- `lib_composition/test_git_integration.rs` (`include!`d): `deny_unknown_fields`
  rejections; untrusted refusal; `IntegrationLocks` permit released on error
  and on panic (`catch_unwind`); command round trip against a temp repo.
- `agent_thread_store.rs`: round trip with and without `integration`; bounds
  rejection.

### Gates

All gates in `CLAUDE.md` plus `git diff --check`. Run
`npm run size:hotspots` after the controller wiring; no baseline entry may be
added or raised.

## Implementation streams

Shared contracts first (S0, sequential, lead or one agent):
`src/domain/gitIntegration.ts`, `src/domain/agentShip.ts` (types only),
`AgentThreadIntegration` + `integrationRecorded` in `src/domain/agentThread.ts`
and `agentThreadWire.ts`, `AgentThreadsSurface`/`AgentThreadView` additions in
`src/application/agentThreadPorts.ts`, Rust serde structs and command names in
`git_integration.rs` (signatures with `todo!()` bodies are acceptable for S0).

Then in parallel, non-overlapping write scopes:

- **A: Domain and policy** - `src/domain/agentShip.ts` (reducer),
  `src/domain/agentShip.test.ts`, `src/domain/gitIntegration.test.ts`,
  `src/application/agentShipPolicy.ts` + test. Validate:
  `npx vitest run src/domain/agentShip src/domain/gitIntegration src/application/agentShipPolicy`.
- **B: Rust** - `src-tauri/src/git_integration.rs`,
  `src-tauri/src/lib_composition/git_integration_commands.rs`,
  `test_git_integration.rs` + one line in `tests.rs`, `command_facades.rs`,
  `runtime.rs`, `agent_thread_store.rs` field. Forbidden: `git.rs`,
  `git_worktree.rs` (except making `read_bounded_stream` reachable if it is
  not already `pub(crate)`). Validate: `cargo check --all-targets`,
  `cargo test --lib git_integration`, `cargo test --lib agent_thread_store`,
  `cargo test --tests`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`.
- **C: Application and infrastructure** - `useAgentShipFlow.ts` + test,
  `useAgentEditorBridge.ts` + test, `useAgentThreads.ts`, `useAgentThreadStore.ts`
  (persist trigger), `useWorkbenchAgents.ts`, `useWorkbenchControllerAgents.ts`,
  `workbenchDefaultGateways.ts`, `tauriGitIntegrationIpcContract.ts` + test,
  `tauriGitIntegrationGateway.ts` + test, and the single option line in
  `useWorkbenchController.ts`. Forbidden: components, domain reducers, Rust.
  Validate: `npx vitest run src/application/useAgentShipFlow src/application/useAgentEditorBridge src/application/useAgentThreads src/infrastructure/tauriGitIntegration`, `npm run check`, `npm run size:hotspots`.
- **D: UI and component tests** - `AgentShipPanel.tsx` + test,
  `AgentThreadChanges.tsx` (extracted), `AgentThreadSession.tsx` + test,
  `AgentThreadInfoColumn.tsx` + test, `AgentModeView.tsx` + test,
  `agentModePresentation.ts` + test, `App.css` agent block. Builds against the
  S0 surface types with a local fake until C lands. Forbidden: application
  hooks, domain, Rust. Validate: `npx vitest run src/components/agentMode`,
  `npm run lint -- --max-warnings 0`.
- **E: Read-only adversarial review** (different agent from each author):
  authority revalidation after every `await` in C, two-phase confirm in B,
  argv injection surface (branch/remote/message), timeout and process-group
  cleanup, truthful UI states in D, hotspot budgets. Findings go back to the
  owning stream.

Lead: integration, full gate run, commit to `main` after review, report
implemented capability versus remaining gaps (PR creation, conflict
resolution in agent mode, background-tab file opening).

## Open questions

1. Should `merge` mode default to `--no-ff` always, or fast-forward when
   possible and merge otherwise ("auto")? The design proposes an explicit
   choice with a computed default; an "auto" third mode is a one-line reducer
   addition if preferred.
2. Should integration also delete the remote branch after push + integrate
   (`git push <remote> --delete <branch>`)? Excluded for now; it is a second
   network mutation with its own failure modes.
3. Should the compare URL open automatically after a successful push, or only
   on click? Proposed: on click only (no surprise browser windows).
4. Is a merge-message template setting wanted, or is
   `Merge agent/<id> (<title>)` acceptable for this slice?
