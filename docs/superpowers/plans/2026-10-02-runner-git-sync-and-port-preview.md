# Runner Git sync and dev-server port preview

Owner request: the same projects are worked on from the Mac (local threads) and through
the Codevo Runner on Linux (server threads). Server work must start from the latest
remote branch and come back to the PC through Git, and dev servers started on the server
must be viewable in the Mac browser through the existing SSH connection.

Status: plan only. No product code changed. Designs below are decisions, not options.

## 1. Where the code lives (verified)

| Part | Location | Notes |
| --- | --- | --- |
| Runner server | separate repo `/Users/matusmockor/Developer/codevo-runner` (GitHub `MatusMockor/codevo-runner`), NestJS + TypeScript, Node 24, `node:test` | Deployed as a systemd user service from `/home/codex/Developer/codevo-runner` (`deploy/codevo-runner.service.example`, README "Direct Linux deployment with systemd"). |
| Runner protocol | `GET /v1/runner` descriptor, `protocolVersion: 1` forever, capability flags | `src/server.ts:25-53` type, `:65-77` handler, `:106-109` effective flags. New optional flags are only sent to clients that announce them in `X-Codevo-Client-Capabilities` (`src/transport/http.ts:33-39`); this is mandatory because the editor parses the descriptor with `deny_unknown_fields` (Rust `descriptor.rs:15-54`, TS `remoteRunnerValidation.ts:327-348`). |
| Runner routes | regex allowlist `src/transport/boundary.ts:26-68`, body allowlist `:98-99`; strict per-route parsers with exact key sets | Errors `{ error: <code> }`, closed `ErrorCode` in `src/domain/contracts.ts:36-37`, status map `src/transport/http.ts:15-18`. |
| Runner Git | read-only helper `src/infrastructure/projects/git-command.ts` (no network env, 30 s, 256 KiB stdout, pinned cwd via python helper); network env only in clone `src/infrastructure/projects/clone.ts:87-123` | Worktree base is hard coded to `rev-parse HEAD` of the server checkout, `worktree add --detach` (`src/infrastructure/projects/index.ts:49-77`). |
| Runner processes | `LinuxProcessTree` (`src/infrastructure/execution/linux-process-tree.ts`) tracks descendants by `/proc` start time; owned map is private | Turn process trees are killed when the provider exits (`process-runner.ts:83`, `interactive-process.ts:47-63`). Terminals (`src/infrastructure/terminal/node-pty.ts`) keep their own tree until closed/idle. |
| Mac tunnel | `src-tauri/src/remote_runner/tunnel_process.rs:66-106` | One `ssh -T ... -L <0700 dir>/socket:127.0.0.1:4318` per connection, `ControlMaster=no`, `ControlPath=none`; owned by `Session` (`tunnel_session.rs:17-69`), generation-owned by `ConnectionLease` (`connection_lease.rs`). No control socket, so `ssh -O forward` is not possible today. |
| Upgrade path | Runner: stop service with no active tasks, back up `CODEVO_DATA_DIR`, `git pull && npm ci && npm run build`, start. SQLite `PRAGMA user_version` is 8 (`src/infrastructure/sqlite/database.ts:56-83`); a runner refuses a newer version. Editor: normal beta release. | Because flags are client-announced, deploy order is free: new editor + old runner hides the features; new runner + old editor never shows the new flags. |

Prerequisite (blocking): the runner checkout has uncommitted work (parallel execution and
instruction sync) in `execution-service.ts`, `runtime.ts`, `main.ts`, `config.ts`,
`domain/execution.ts`, `sqlite/index.ts`, `README.md`, `docs/architecture.md` and tests.
The owner must commit or land it before any runner slice starts. Runner agents never
stash, reset or rewrite it.

## 2. Decisions

1. Two new runner capabilities: `gitSync` and `portPreview`. Both are optional booleans,
   announced only to clients that send those tokens. `portPreview` is advertised only on
   Linux with execution enabled; `gitSync` whenever execution is enabled.
2. Server threads in worktree mode get a real local branch `codevo/<first 8 hex of the
   root task id>` (retry with the full 32 hex id on collision) created from
   `refs/remotes/origin/<base>` after a fetch. Existing detached worktrees keep working.
3. Push never forces, never pushes tags, always uses an explicit refspec
   `<sha>:refs/heads/<name>` against the remote named `origin`. Two closed targets:
   `thread-branch` (default) and `base-branch` (fast-forward only, explicit confirm).
4. Network Git (fetch, update, push) runs as runner-side operation jobs with an
   idempotency key, because a fetch or push can exceed the 25-35 s HTTP deadlines.
   Local Git (branches, status, commit) is synchronous with a 10 s deadline.
5. Port preview uses one dedicated `ssh -N -L 127.0.0.1:<lport>:<loopback>:<rport>`
   child per forward, owned by the connection `Session`. The main tunnel spawn contract is
   not changed (no ControlMaster). Forwards die with the connection generation.
6. Only ports that the runner reports as listening inside the thread's own process trees
   (running turn + its server terminal) can be forwarded. No arbitrary ports, no
   non-loopback targets.
7. Localhost links in server-thread answers never open the Mac's localhost. They open the
   forwarded port, or report truthfully why they cannot.
8. Agent-started dev servers live only while the turn runs (existing runner invariant:
   descendants never outlive the provider). The UI says so and points to the server
   Terminal for long-lived servers. Changing that invariant is out of scope.
9. Commit for server threads is enabled together with push (push without commit is
   useless when the agent did not commit). Compare URL is enabled after push.
   Integrate (merge into a checkout) stays blocked for server threads.

## 3. Feature A - Git sync

### 3.1 Runner API (capability `gitSync`)

All routes require bearer auth and the runner-id header rules of existing `/v1` routes.
`:projectId` uses the existing project id grammar; `:id` is a task uuid v4 and resolves to
that task's conversation workspace (`session.workspaceTaskId`). Unknown fields, query
strings and bodies on GET are rejected.

| Request | Body | Response |
| --- | --- | --- |
| `GET /v1/projects/:projectId/git/branches` | none | 200 `BranchList` |
| `POST /v1/projects/:projectId/git/fetch` | `{ idempotencyKey }` | 202 `GitOperation` (kind `fetch`) |
| `GET /v1/projects/:projectId/git/status` | none | 200 `CheckoutStatus` |
| `POST /v1/projects/:projectId/git/update` | `{ idempotencyKey }` | 202 `GitOperation` (kind `update`), or 409 `{ error }` on admission refusal |
| `GET /v1/tasks/:id/git/status` | none | 200 `ThreadGitStatus` |
| `POST /v1/tasks/:id/git/commit` | `{ message }` | 200 `{ commitSha, status: ThreadGitStatus }` |
| `POST /v1/tasks/:id/git/push` | `{ idempotencyKey, target }` | 202 `GitOperation` (kind `push`), or 409 `{ error }` |
| `GET /v1/git-operations/:id` | none | 200 `GitOperation` |
| `POST /v1/tasks/:id/start` (extended) | `{ projectId, base? }` | unchanged |

Schemas (all objects closed; `sha` is 40 or 64 lowercase hex; branch names use the
existing `validCloneBranch` grammar, at most 255 bytes, never `HEAD`):

```ts
type StartBase =
  | { kind: "origin-branch"; branch: string }   // worktree isolation only
  | { kind: "checkout-head" };                  // previous behaviour, no fetch

type BranchList = {
  defaultBranch: string | null;     // origin/HEAD target
  checkoutBranch: string | null;    // branch of the server checkout, null when detached
  fetchedAt: string | null;         // ISO time of the last successful fetch seen by the runner
  branches: { name: string; sha: string; committedAt: string }[]; // <= 500, newest first
  truncated: boolean;
};

type DirtySummary = { tracked: number; untracked: number; truncated: boolean }; // counts <= 10_000

type CheckoutStatus = {
  branch: string | null;
  headSha: string;
  upstream: { ref: string; ahead: number; behind: number } | null;
  dirty: DirtySummary;
  operation: "none" | "merge" | "rebase" | "cherry-pick" | "revert" | "bisect";
  inPlaceTaskActive: boolean;
  fetchedAt: string | null;
};

type ThreadGitStatus = {
  mode: "worktree" | "in-place";
  branch: string | null;                 // codevo/... for new worktrees, checkout branch for in-place
  headSha: string;
  base: { branch: string; sha: string; fetchedAt: string | null; ahead: number; behind: number } | null;
  published: { ref: string; ahead: number; behind: number } | null; // origin/<branch> if it exists
  dirty: DirtySummary;
  active: boolean;                       // a turn of this conversation is queued or running
};

type GitOperation = {
  id: string; kind: "fetch" | "update" | "push";
  status: "running" | "succeeded" | "failed";
  error: GitErrorCode | null;
  result:
    | null
    | { kind: "fetch"; fetchedAt: string }
    | { kind: "update"; headSha: string; fastForwarded: number }
    | { kind: "push"; remoteRef: string; pushedSha: string; created: boolean };
};

type GitErrorCode =
  | "git_remote_unavailable" | "git_auth_failed" | "git_timeout" | "git_no_remote"
  | "git_remote_unsupported" | "git_branch_not_found" | "git_detached_head"
  | "git_no_upstream" | "git_dirty" | "git_diverged" | "git_operation_in_progress"
  | "git_rejected_non_fast_forward" | "git_rejected" | "git_nothing_to_commit"
  | "git_identity_missing" | "busy" | "conflict";
```

Admission refusals use HTTP 409 with `{ error: <GitErrorCode> }`; the new codes are added
to `ErrorCode` and the status map. Operation failures are reported in the job, never as
raw Git output.

Limits:

- Commit message 1..4096 UTF-8 bytes, no NUL or other control characters except `\n`.
- Operation registry in memory: at most 64 retained operations, completed ones expire
  after 10 minutes; same idempotency key with identical input returns the same operation,
  with different input returns 409 `conflict`. A runner restart loses operations; the
  editor treats 404 on poll as "result unknown, refresh status".
- At most 2 network Git operations runner-wide, 1 per project (per-project async mutex
  shared with the start-time fetch). A fetch that completed less than 15 s ago is
  coalesced (returns a succeeded operation without running Git).
- Deadlines: fetch 60 s, update 60 s (fetch + merge), push 120 s, local ops 10 s. Process
  group killed on deadline or abort.
- Stderr is read up to 16 KiB only to classify the failure into a code, then discarded.

### 3.2 Runner Git process plans (no shell)

New `src/infrastructure/projects/git-network.ts` owns the network environment, extracted
from `clone.ts` so clone and sync share one audited plan:

- Env: strip all `GIT_*`; set `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/bin/false`,
  `SSH_ASKPASS=/bin/false`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ForwardAgent=no
  -o ClearAllForwardings=yes -o ConnectTimeout=15`. Authentication is the service
  account's existing SSH keys and known hosts; HTTPS uses the existing
  `prepareCloneProviderAuth` (gh/glab helper for exactly the origin host) or stays
  anonymous. The editor's agent is never forwarded.
- Fixed `-c` prefix: `core.hooksPath=/dev/null`, `core.fsmonitor=false`,
  `credential.helper=`, `protocol.allow=never`, `protocol.https.allow=always`,
  `protocol.ssh.allow=always`, `http.followRedirects=false`, `commit.gpgSign=false`,
  `tag.gpgSign=false`, `push.followTags=false`, `fetch.recurseSubmodules=false`.
- Before any network op: read `remote.origin.url` and `remote.origin.pushurl` with
  `git config --local --no-includes --get`; both (when present) must pass
  `validCloneUrl` (no credentials, no local/file URLs), otherwise `git_remote_unsupported`.
  Missing origin is `git_no_remote`.
- Spawn: `spawn('git', args, { shell: false, detached: true })` through the pinned-cwd
  helper with the workspace dev/ino identity, stdin closed, stdout bounded 256 KiB.

Commands (argument vectors are fixed; only validated branch names and shas are inserted):

| Operation | Plan |
| --- | --- |
| fetch | `fetch --prune --no-tags --no-recurse-submodules --quiet origin` |
| branches | `for-each-ref --sort=-committerdate --count=501 --format=%(refname:strip=3)%00%(objectname)%00%(committerdate:iso-strict) refs/remotes/origin/`, `symbolic-ref --quiet refs/remotes/origin/HEAD`, `symbolic-ref --quiet --short HEAD` |
| status | `status --porcelain=v2 --branch -z --untracked-files=normal` (count only, stop counting at 10 000), `rev-list --left-right --count A...B`, presence of `MERGE_HEAD`/`rebase-merge`/`rebase-apply`/`CHERRY_PICK_HEAD`/`REVERT_HEAD`/`BISECT_LOG` in the git dir |
| update (checkout) | under the project mutex: refuse `busy` if an in-place turn of the project is queued/running; refuse detached, no upstream, in-progress operation, any tracked change (`git_dirty`); fetch; refuse `git_diverged` when ahead > 0 and behind > 0; `merge --ff-only --no-edit @{upstream}`; a failure caused by untracked files maps to `git_dirty` |
| start with `origin-branch` | in `GitProjectWorkspace.prepare`: project mutex, fetch (coalesced), `rev-parse --verify --end-of-options refs/remotes/origin/<branch>^{commit}` (missing: `git_branch_not_found`), `worktree add -b codevo/<id8> -- <cwd> <sha>`; write `workspace-git/<taskId>` (`{ version: 1, baseBranch, baseSha, threadBranch, fetchedAt }`, `wx`, 0600). A fetch failure fails the turn with the bounded code before the provider starts; there is no silent fallback to the stale checkout. |
| start with `checkout-head` or no base | unchanged (`rev-parse HEAD`, `--detach`) |
| commit | refuse while `active`; `add --all -- .`, then `-c user.name=<cfg> -c user.email=<cfg> commit --no-verify --quiet -F -` with the message on stdin. Identity comes from new runner config `CODEVO_GIT_AUTHOR_NAME` / `CODEVO_GIT_AUTHOR_EMAIL` (validated, no control chars, <= 256 bytes); when unset, the repo-local `user.name`/`user.email`; neither: `git_identity_missing`. Nothing staged: `git_nothing_to_commit`. |
| push `thread-branch` | refuse while `active`; resolve `HEAD` sha once; `push --porcelain --no-verify --no-follow-tags origin <sha>:refs/heads/<branch>`, where branch is the recorded `threadBranch`, the in-place checkout branch, or `codevo/<id8>` for a legacy detached worktree |
| push `base-branch` | worktree with a recorded base only; same plan with `refs/heads/<baseBranch>`; Git's own non-fast-forward rejection maps to `git_rejected_non_fast_forward` |

Workspace lease: `GitProjectWorkspace` gets a per-workspace async mutex. Commit and push
hold it; `prepare` and `resume` acquire it before returning a cwd (waiting at most 130 s,
then `busy`), so a follow-up turn cannot start in the middle of a commit. The `active`
check uses a new read-only query `conversationActive(workspaceTaskId)` in
`sqlite/database.ts`.

Persistence: start `base` is stored on the task row in a new nullable `git_base` TEXT
column (validated JSON) through the existing `PRAGMA table_info` probe migration; bump
`user_version` to 9. Workspace metadata v1 is not changed, so `validateWorkspace` keeps
its exact comparison.

Security notes for the runner side:

- A same-uid agent can edit `.git/config` (filters, url rewrites). Runner Git runs as the
  same uid, with command-line overrides for hooks, fsmonitor, credentials, protocols and
  signing, bounded time and process-group kill. This is no privilege gain over the agent
  itself; clean/smudge filters are a documented residual.
- No ref name or sha from the editor reaches argv without grammar validation; refspecs
  never contain `+`, `:` from user input or wildcards.

### 3.3 Mac Rust (editor)

New `src-tauri/src/remote_runner/git_sync.rs` (+ `git_sync_tests.rs`), following the
generation-safe pattern of `thread_management.rs:191-251` and `surfaces.rs:247-269`:

- One closed `RemoteGitOperation` enum (`#[serde(tag = "operation", deny_unknown_fields)]`):
  `projectBranches`, `projectFetch`, `projectStatus`, `projectUpdate`, `threadStatus`,
  `threadCommit`, `threadPush`, `operation`. Request carries `serverId`, `runnerId`, the
  operation and its typed fields. Ids validated with existing `id()` / `uuid()`, branch
  with `project_clone::branch_name`, message bytes as above, target as a closed enum.
- `plan()` maps each variant to a fixed method + path + body. Execution through
  `state.connection_lease(server_id)` and `project_management::call_lease`, rejecting a
  runner-id mismatch, with lease generation checked before and after the call.
- Responses are validated in Rust with strict serde structs mirroring section 3.1 before
  they cross IPC.
- Commands: `remote_runner_git` (single entry point taking the enum).
- Start extension: `StartRequest` (`types.rs:57-61`) gains optional `base`, a closed enum
  serialised only when present; `remote_runner_start_task` (`commands.rs:128-145`) sends
  `{ projectId, base }`.

### 3.4 TypeScript application and UI

Domain (pure):

- `src/domain/remoteGitSync.ts`: types of section 3.1, `RemoteStartBase`, parsers with
  exact keys, `remoteGitErrorMessage(code)` copy, mapping `ThreadGitStatus` ->
  `GitShipStatus` (worktree = thread branch, primary = `origin/<base>` with `dirty: false`,
  relation = base ahead/behind, remote = `origin` + published ahead/behind + compare URL).
- `remoteCompareUrl(identity, base, branch)` for github.com, gitlab.com, bitbucket.org,
  from the sanitized repository identity the editor already loads
  (`tauriRemoteRepositoryIdentityGateway.ts`).

Infrastructure: `src/infrastructure/tauriRemoteGitSyncGateway.ts` implementing a
`RemoteGitSyncPort` (one method per operation, plus `awaitOperation(id, signal)` polling
every 1 s, max 150 s, 404 -> `unknown`).

Application:

- `src/application/useRemoteProjectGit.ts`: branches/status/fetch/update for one exact
  `(serverId, runnerId, projectId)` key; captures the key before every await and drops
  results whose key changed (A -> B -> A safe through a monotonic generation).
- `src/application/remoteThreadShip.ts` + `useRemoteThreadShip.ts`: reuses the pure
  `agentShipReducer` from `src/domain/agentShip.ts` and exposes
  `refreshShipStatus/commit/push/openCompareUrl` with the same `AgentShipStepResult`
  contract as the local flow. Commit always commits all changes (no partial selection).
- `remoteAgentSurface.ts`: when the thread's server advertises `gitSync`, route
  `refreshShipStatus`, `commitThreadChanges`, `pushThreadBranch`, `openThreadCompareUrl`
  to the remote ship; everything else (integrate, worktree removal, file actions) stays
  `REMOTE_ACTION_UNAVAILABLE`. Without the capability nothing changes.
- `useRemoteAgentMutations.ts`: `start` accepts `base` and sends it only with `gitSync`.

UI (taste >= 7):

- Server new-thread strip (`AgentComposerDrawerStart.tsx`): with `New worktree`, a
  `RemoteBaseBranchPicker` replaces the hidden local branch picker. Opening it triggers a
  coalesced fetch, shows "Fetched 2 min ago" / "Fetching...", lists origin branches
  (search, at most 500, truncated note), default = origin default branch, first item
  "Current server checkout (<branch>)" = `checkout-head`. With `Server checkout`
  (in-place) it shows the checkout branch read-only with `↑n ↓n`, a dirty dot, and an
  `Update from origin` action (disabled with the exact reason: dirty, diverged, detached,
  no upstream, a thread is running here).
- After sending: the location line and sidebar row show `codevo/<id8> from origin/<base>`.
- Thread header ship action (`agentThreadHeaderPresentation.ts`) and ship banner work for
  server threads: `Commit`, `Push`, `↑n` unpublished, `↓n behind origin/<base>`,
  `Open compare` after push, and a `Push to <base>` menu item only when behind base is 0,
  behind a confirmation ("Push directly to <base> on origin?").
- Errors use `remoteGitErrorMessage`, never raw Git text.

## 4. Feature B - Dev-server port preview

### 4.1 Runner discovery (capability `portPreview`)

| Request | Response |
| --- | --- |
| `GET /v1/tasks/:id/ports` | 200 `PortList` for the conversation of `:id`: the queued/running turn's provider process tree plus the terminal session `(projectId, workspaceTaskId)` |
| `GET /v1/projects/:projectId/ports` | 200 `PortList` for the project terminal `(projectId, null)` plus running in-place turns of that project |

```ts
type PortList = {
  ports: {
    port: number;                                   // 1024..65535
    address: "loopback-v4" | "loopback-v6" | "any-v4" | "any-v6";
    source: "agent" | "terminal";
    process: string;                                // /proc comm, printable ASCII <= 15 bytes, else "unknown"
  }[];                                              // <= 32, sorted by port
  truncated: boolean;
  scannedAt: string;
};
```

Implementation:

- `LinuxProcessTree` gains `snapshot()` returning `{ pid, start }` of currently owned
  processes after `observe()`. Executors register the tree for the conversation in a new
  `ProcessOwnershipRegistry` (application port; register on spawn, unregister on exit);
  `TerminalProcess` gains `ownedProcesses()`.
- `src/infrastructure/execution/listening-ports.ts`: for each owned pid read
  `/proc/<pid>/fd` (<= 1024 entries per pid, <= 16 384 total), collect `socket:[inode]`,
  re-check the pid start time after reading (pid reuse guard); parse `/proc/net/tcp` and
  `/proc/net/tcp6` (<= 4 MiB each, state `0A` LISTEN only); keep sockets whose inode is
  owned and whose bind address is 127.0.0.1, ::1, 0.0.0.0 or ::. Specific non-loopback
  binds are excluded (cannot be reached through a loopback forward). Ports below 1024 and
  the runner's own listen port are excluded.
- Bounds: 2 s scan deadline, 1 s cache per scope, at most 4 concurrent scans (`busy`).
- Non-Linux: capability false, routes absent.

### 4.2 Mac Rust forward manager

New module `src-tauri/src/remote_runner/port_forward/`:

- `ssh_forward.rs` - process plan and RAII `ForwardProcess`:
  `ssh -N -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ForwardAgent=no
  -o ForwardX11=no -o ExitOnForwardFailure=yes -o ControlMaster=no -o ControlPath=none
  -o ControlPersist=no -o ForkAfterAuthentication=no -o PermitLocalCommand=no
  -o GatewayPorts=no -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2
  -L 127.0.0.1:<lport>:<127.0.0.1|[::1]>:<rport> -p <port> -l <user> -- <host>`.
  stdin/stdout null, stderr bounded to 4 KiB for failure classification, `process_group(0)`,
  `kill(-pgid, SIGKILL)` + wait on Drop. Host and user come from the stored `Server` and
  pass the existing `validate_destination`. The ssh program path is injected through a
  small trait so tests use a fake.
- `local_port.rs`: prefer `lport == rport` when both 127.0.0.1 and ::1 are free on the
  Mac, otherwise an ephemeral port from binding `127.0.0.1:0`. A bind race is caught by
  `ExitOnForwardFailure`; retry once with a new ephemeral port.
- Readiness: poll `TcpStream::connect(127.0.0.1:lport)` every 50 ms for at most 10 s while
  the child is alive; otherwise kill and report.
- `registry.rs`: `ForwardSet` stored in `Session` (`tunnel_session.rs`) together with a
  copy of the validated destination, so `Session::close()` and Drop (disconnect, revoke,
  shutdown, failed reconnect) kill every forward of that generation. Key:
  `(owner_id, scope, remote_port)`. Limits: 4 forwards per owner per connection, 8 per
  app. The mutex is never held across spawn, readiness, HTTP or kill: reserve a pending
  slot with a monotonic id, release, spawn, re-lock and commit only if the slot and
  connection generation are still current, else kill.
- `mod.rs` commands (all `deny_unknown_fields`, run through `commands::blocking`):
  - `remote_port_list { serverId, runnerId, ownerId, scope }` -> runner `PortList`
    validated strictly, annotated with `forward: { localPort, state } | null` for that
    owner; also prunes forwards whose process died or whose port has been missing from
    the listing for >= 30 s.
  - `remote_port_open { serverId, runnerId, ownerId, scope, port, scheme, path }` ->
    re-fetches the listing from the runner (authoritative allowlist at the Rust
    boundary), refuses ports not listed, reuses or creates the forward, revalidates the
    lease generation, then opens `scheme://127.0.0.1:<lport><path>` with the opener from
    Rust. `scheme` is `http|https`; `path` starts with `/`, <= 2048 bytes, no control
    characters, no `\`. Returns `{ localPort }` for display.
  - `remote_port_close { serverId, ownerId, scope, port }`.
  - `remote_port_release_owner { ownerId }`, wired into the existing workspace owner
    release path (`contracts/workspace-owner-release-wire.json`) so closing a workspace
    tab releases its forwards.
  - `scope` is `{ kind: "task", taskId } | { kind: "project", projectId }`.
- No pid, ssh argv, socket path or token crosses IPC.

Security review of exposing server ports (record in the review of slice S5):

- Exposure is loopback-only on the Mac (`127.0.0.1`), never `GatewayPorts`, and only to
  `127.0.0.1`/`::1` on the server. The forward cannot pivot into the server's network.
- Any local process or user on the Mac can connect to an open forward, and a web page in
  the Mac browser can reach it like any local dev server (CSRF, DNS rebinding against the
  dev server). Same exposure model as VS Code port forwarding; forwards are explicit,
  bounded, visible and closed with their owner.
- The port allowlist is least-exposure product policy enforced in Rust, not a server
  security boundary: the SSH account can already forward anything. TOCTOU between listing
  and forwarding is narrowed by re-listing in `remote_port_open` and pruning on
  disappearance; it cannot pin the remote socket owner.
- Each forward re-authenticates with the same non-interactive key/agent and strict host
  key as the main tunnel; agents that require per-use confirmation will prompt per forward.

### 4.3 TypeScript application and UI

- `src/domain/remotePortPreview.ts`: `PortList` parser, forward state union
  (`none | opening | open(localPort) | failed(reason)`), and the pure
  `classifyLoopbackUrl(url)` for `http|https` URLs whose host is `localhost`,
  `127.0.0.1`, `[::1]` or `0.0.0.0`, with an explicit port 1024..65535 and no userinfo.
- `src/infrastructure/tauriRemotePortPreviewGateway.ts`.
- `src/application/useRemotePortPreview.ts`: for the selected server thread only; polls
  `remote_port_list` every 5 s while a turn runs or the server terminal is open and the
  window is focused, every 30 s otherwise, never when the server lacks `portPreview`.
  Exact owner/thread/generation captured before each await; stale results are dropped.
- Markdown links: `AgentMarkdownLink` gains `{ kind: "loopback", url, scheme, port, path }`
  (`src/domain/agentMarkdown/agentMarkdownLink.ts`); `activateAgentMarkdownLink` handles
  it exhaustively. Local threads open the URL unchanged. Server threads call the
  `serverLoopback` port: forward + open when listed; otherwise a notice "Nothing is
  listening on port 3000 for this server conversation." Without `portPreview`: "This link
  points to <server>. Update the runner to open server ports from this computer." Never
  the Mac's localhost. The link title says "Opens <server>:3000 through the SSH connection".
- `RemotePortPreviewMenu` in the thread header (server threads with `portPreview`): a
  compact `Ports` chip with a count; the popover lists `3000 node · agent` with
  `Open in browser`, `Copy local URL`, `Stop forwarding`, and the note "Servers started
  by the agent stop when the turn ends. Use the server Terminal to keep one running."

## 5. Compatibility

- Editor without the runner flag: branch picker, Update from origin, server ship actions,
  Ports chip and server link forwarding are hidden or show the update notice; existing
  behaviour unchanged (start body without `base`).
- Runner with the flags and an older editor: flags not announced, routes unused, start
  without `base` keeps `HEAD`/detached behaviour.
- Runner downgrade after migration 9 is refused by the old runner (fail closed); back up
  the data directory before upgrading (documented in runner README).
- Existing detached server worktrees: status reports `branch: null` with base `null`;
  push `thread-branch` publishes `codevo/<id8>` from the detached head; `base-branch` is
  not offered.

## 6. Contracts and tests on both sides

Shared fixtures (written in S0, byte-identical copies in the runner repo under
`test/fixtures/`, checked with `cmp` by the lead before each commit):

- `contracts/remote-git-sync-wire.json`: accepted and rejected examples for every request
  body and response of section 3.1, including unknown fields, oversize message, bad
  branch grammar, `+refs` attempts, 41-hex sha, unknown error code, unknown operation kind.
- `contracts/remote-port-preview-wire.json`: accepted/rejected `PortList`, scope and open
  requests (port 0, 80, 65536, unknown address kind, userinfo URL, `\` path, 2049-byte path).

Consumers: runner `test/git-sync-contract.test.ts` and `test/port-preview-contract.test.ts`;
editor Rust `git_sync_tests.rs` and `port_forward/tests.rs`; TS
`remoteGitSync.test.ts` and `remotePortPreview.test.ts`.

## 7. Slices, ownership and order

Executor guidance (user model table): S0 mechanical -> gpt-6-astra; S1, S2, S3, S5 ->
opus-5 with a fable-5.1 adversarial review; S4, S6 (UI) -> opus-5 or a taste >= 7
frontend agent; final review fable-5.1. Every slice: failing test first, focused tests,
independent read-only review, then the full gates of its repo. Subagents never run
stash/checkout/reset; the lead commits.

```text
S0 contracts + plumbing (both repos)
 ├─ S1 runner git sync ──────────── S2 runner port discovery      (same agent, sequential)
 ├─ S3 editor git core ──────────── S4 editor git UI
 └─ S5 editor forward manager ───── S6 editor port UI + links
                                   S7 integration, docs, live E2E (lead)
Wave 1 parallel: S1, S3, S5.   Wave 2 parallel: S2, S4, S6.
```

### S0 - Contracts and plumbing (one agent, serial, both repos)

Editor writes:
- `contracts/remote-git-sync-wire.json`, `contracts/remote-port-preview-wire.json` (new)
- `src-tauri/src/remote_runner/descriptor.rs` (+ `gitSync`, `portPreview` optional flags,
  strict tests)
- `src-tauri/src/remote_runner/tunnel_http.rs` (`CLIENT_CAPABILITIES` += `gitSync,portPreview`)
- `src/domain/remoteRunner.ts`, `src/domain/remoteRunnerValidation.ts`,
  `src/domain/remoteRunnerCapabilities.test.ts` (capability keys only)
- `src-tauri/src/remote_runner/git_sync.rs` and `src-tauri/src/remote_runner/port_forward/mod.rs`
  as stubs with the final command signatures returning "not available", `mod.rs`
  re-exports, registration in `src-tauri/src/lib_composition/runtime.rs`

Runner writes:
- `test/fixtures/remote-git-sync-wire.json`, `test/fixtures/remote-port-preview-wire.json`
- `src/server.ts` (descriptor type, effective flags from `services.gitSync` /
  `services.ports`, client gating like `turnChanges`)
- `src/transport/boundary.ts` (all routes of 3.1 and 4.1, body allowlist for fetch,
  update, commit, push, start)
- `src/transport/services.ts` (optional `gitSync`, `ports` slots)
- `src/domain/contracts.ts`, `src/transport/http.ts` (new error codes, 409 mapping)
- `src/application/git-sync-ports.ts`, `src/application/port-preview-ports.ts` (interfaces)
- `src/transport/git-sync-controller.ts`, `src/transport/port-preview-controller.ts`
  (thin delegation, registered in `server.ts`)

Tests: descriptor gating (announced vs not announced), boundary 404/405/400 for every new
route, Rust/TS capability strictness. Forbidden: everything else.

### S1 - Runner Git sync (agent A, codevo-runner)

Writes: `src/domain/git-sync.ts` (parsers, error classification),
`src/application/git-sync-service.ts` (operation registry, mutexes, coalescing),
`src/infrastructure/projects/git-network.ts` (new), `src/infrastructure/projects/git-sync.ts`
(new), `src/infrastructure/projects/workspace-git.ts` (new record file),
`src/infrastructure/projects/clone.ts` (use `git-network.ts`),
`src/infrastructure/projects/index.ts` (base-aware `prepare`, workspace lease),
`src/infrastructure/sqlite/database.ts` (`git_base` column, migration 9,
`conversationActive`), `src/application/execution-service.ts` (parse `base` in `start`,
pass to `queueTask`/`prepare`), `src/application/execution-ports.ts`, `src/config.ts`
(author identity), `src/runtime.ts` (wire `gitSync`), `docs/api.md`, README upgrade note.

Tests (real git, the `ssh` PATH stub of `test/project-clone-git.test.ts` extended to
dispatch `git-upload-pack` and `git-receive-pack`): contract fixture; start from
`origin/feature` after a remote commit lands; fetch failure fails the turn with
`git_remote_unavailable` and no provider launch; missing branch; legacy detached task;
commit refused while running; commit identity missing; push thread branch creates the
remote ref; second push is a no-op; non-fast-forward base push rejected and never forced;
update refuses dirty, diverged, detached, no upstream, in-place turn running; idempotent
operation key replay and conflicting replay; coalesced fetch; deadline kill leaves no
process; `pushurl` with credentials refused; concurrent follow-up waits for the lease;
migration 8 -> 9 and refusal of 10.

### S2 - Runner port discovery (agent A after S1)

Writes: `src/infrastructure/execution/linux-process-tree.ts` (`snapshot()`),
`src/infrastructure/execution/listening-ports.ts` (new),
`src/application/process-ownership.ts` (new registry),
`src/application/port-preview-service.ts` (new), `process-runner.ts`,
`interactive-process.ts`, `src/infrastructure/terminal/node-pty.ts`,
`src/application/terminal-ports.ts`, `src/application/terminal-service.ts`,
`src/application/execution-service.ts` (register trees per conversation), `src/runtime.ts`
(wire `ports`), `docs/api.md`.

Tests (Linux CI): node http server child under a tracked tree is listed with
`source: agent`; listener in a terminal session listed as `terminal`; unrelated process
on another port excluded; specific non-loopback bind excluded; port < 1024 excluded;
turn exit removes the port; pid reuse guard; fd and line limits produce `truncated`;
cache and `busy`; foreign task id 404; contract fixture.

### S3 - Editor Git core (agent B)

Writes: `src-tauri/src/remote_runner/git_sync.rs`, `git_sync_tests.rs` (new),
`src-tauri/src/remote_runner/types.rs` (`StartRequest.base`),
`src-tauri/src/remote_runner/commands.rs` (start body), `src/domain/remoteGitSync.ts`
(+ test), `src/domain/remoteGitSyncValidation.ts` (+ test, registered from
`remoteRunnerValidation.ts` with an import only),
`src/infrastructure/tauriRemoteGitSyncGateway.ts` (+ test),
`src/application/useRemoteProjectGit.ts`, `src/application/remoteThreadShip.ts`,
`src/application/useRemoteThreadShip.ts` (+ tests),
`src/application/useRemoteAgentMutations.ts` (+ test).

Tests: fixture accept/reject in Rust and TS; lease generation change between request
and response fails closed; runner-id mismatch; operation polling with 404 -> unknown;
A -> B -> A thread switch drops stale status; ship reducer transitions for remote
commit/push failures; start body includes `base` only with `gitSync`.

### S4 - Editor Git UI (agent B after S3)

Writes: `src/components/agentMode/AgentComposerDrawerStart.tsx`,
`src/components/agentMode/RemoteBaseBranchPicker.tsx` (new),
`src/components/agentMode/RemoteCheckoutUpdateAction.tsx` (new),
`src/components/agentMode/agentComposerStrip.ts`,
`src/application/useRemoteDraftGitBase.ts` (new draft state, keeps
`useAgentComposerState.ts` unchanged except one hook call),
`src/application/useUnifiedAgentThreads.ts` (pass base, route ship),
`src/application/remoteAgentSurface.ts`, `src/components/agentMode/useAgentShipActions.ts`,
`src/components/agentMode/agentThreadHeaderPresentation.ts`,
`src/domain/agentWorkspaceLocation.ts` (branch-from-base label), their tests.
Forbidden: `AgentModeView.tsx`, `AgentThreadHeader.tsx`, `AgentThreadSession.tsx`,
markdown link files.

Tests: picker fetch on open, default branch selection, `checkout-head` item, truncated
note, search; Update from origin disabled reasons and success refresh; ship actions
enabled only with `gitSync`; integrate still blocked; push-to-base confirmation and
disabled when behind; error copy per code; draft switching server/project resets base.

### S5 - Editor forward manager (agent C)

Writes: `src-tauri/src/remote_runner/port_forward/{mod.rs,registry.rs,ssh_forward.rs,local_port.rs,tests.rs}`,
`src-tauri/src/remote_runner/tunnel_session.rs` (owns `ForwardSet` + destination),
`src-tauri/src/remote_runner/connection_lease.rs` (accessor only if required),
the workspace owner release hook file located by the agent (one call),
`src/domain/remotePortPreview.ts` (+ test),
`src/infrastructure/tauriRemotePortPreviewGateway.ts` (+ test),
`src/application/useRemotePortPreview.ts` (+ test).

Tests (fake ssh via the injected program trait that binds the requested local port):
open refuses an unlisted port; reuse for the same key; 5th forward per owner and 9th per
app refused; `Session::close` kills every forward process group (no survivors);
owner release kills only that owner's forwards; generation change during readiness kills
the new child and fails closed; bind collision falls back to an ephemeral port; process
death pruned; port missing >= 30 s pruned; path/scheme validation; IPv6 loopback target
uses `[::1]`; TS polling cadence, focus pause, stale result drop on thread switch.

### S6 - Editor port UI and link rewriting (agent C after S5)

Writes: `src/domain/agentMarkdown/agentMarkdownLink.ts` (+ test),
`src/components/agentMode/agentMarkdownLinks.ts` (+ test),
`src/components/agentMode/AgentThreadSession.tsx` (pass `serverLoopback` through the
prose context), `src/components/agentMode/RemotePortPreviewMenu.tsx` (+ css, test, new),
`src/components/agentMode/AgentThreadHeader.tsx` (slot),
`src/components/agentMode/AgentModeView.tsx` (one prop; must stay below the 10 000 token
hotspot limit).

Tests: classification table (localhost, 127.0.0.1, [::1], 0.0.0.0, no port, port 80,
userinfo, https); local thread unchanged; server thread opens through the port and never
calls `openExternal` with a loopback URL; unlisted port notice; capability-missing
notice; menu actions and agent-lifetime note; keyboard access.

### S7 - Integration, docs and live verification (lead)

- Docs: `docs/remote-runner-editor.md` sections "Git sync" and "Open server ports"
  (single owner to avoid conflicts); runner `docs/api.md` and README are already
  updated by S1/S2.
- Independent read-only reviews: fable-5.1 adversarial review of S1+S2 (process plans,
  refspecs, config injection, limits) and S5 (process ownership, cleanup, exposure);
  a second reviewer for the UI slices.
- Editor gates: everything in `CLAUDE.md` "Testing and completion criteria" plus
  `git diff --check`. Runner gates: `npm run check`, `npm test`, `git diff --check`.
- Live E2E against a deployed runner (deploying to the server needs the owner's go-ahead):
  start a server thread on `origin/<branch>` right after pushing from the Mac; commit and
  push from the server thread and `git fetch` it on the Mac; Update from origin on a
  clean and a dirty checkout; start `npm run dev` in the server Terminal and from an agent
  turn, open both through the Ports chip and a `http://localhost:<port>` link; disconnect
  the server and confirm every forward process is gone (`pgrep -f "ssh -N"` scoped to the
  recorded PIDs, never a broad kill).

## 8. Residual risks

- Agent-started dev servers stop at the end of the turn; only terminal-started servers
  persist. A supervised "keep running" service is a separate feature.
- Forwards are reachable by any local process/user on the Mac and by browser pages
  (DNS rebinding/CSRF against the dev server), as with any local dev server.
- The allowlist is client-side least exposure; a different server process can bind a
  just-released port before the forward is used.
- Opening `127.0.0.1:<lport>` instead of `localhost` can break apps that hard-code a
  `localhost` origin for cookies or OAuth callbacks; same-number ports reduce but do not
  remove this.
- Same-uid agents can influence repository config (clean/smudge filters) used by runner
  commit; bounded in time and process group, no privilege gain.
- The start-time fetch adds up to 60 s before the provider starts and fails the turn when
  origin is unreachable (truthful, user can choose the current checkout instead).
- Fetch updates remote-tracking refs shared by all worktrees and the checkout of that
  project; expected Git behaviour, but visible to concurrent threads.
- `Push to <base>` bypasses review workflows on hosts without branch protection; it is
  non-force, confirmed and fast-forward only.
- Operation results are not durable across a runner restart; the editor reports
  "unknown" and refreshes status instead of guessing.
- SQLite migration 9 blocks runner downgrade without the backup.
- User SSH config `LocalForward` entries for the same host can make forward processes
  fail; the error is reported, not worked around.
