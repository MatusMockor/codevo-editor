# Agent Conversational Threads Design (Slice 1)

Date: 2026-08-24

Status: Approved design, implementation in progress

## Goal

Turn agent mode from "one prompt = one process run" into persisted, resumable
conversations. A thread owns a repository target (worktree or in-place) and a
provider session; each user prompt is a turn that spawns the configured CLI with
resume, streams structured events (assistant text, tool calls, results) instead
of a raw `<pre>`, and is persisted per workspace by a Rust-owned store. This is
the first slice toward T3 Code parity; visuals stay as they are.

## Verified starting point

- `src/domain/agentTask.ts`: `AgentTaskRecord` = one process run; status union
  `pending | running | exited | failed | stopped`; in-memory reducer with
  sequence dedupe and owner checks; nothing persisted.
- `src/application/useAgentTasks.ts` (1559 lines) owns dispatch, authority
  checks, isolation preview, change summary/diff, worktree lifecycle, orphan
  scan, and notices in one hook.
- `src-tauri/src/agent_task_spawner.rs`: `plan_agent_invocation` builds
  `claude -p -- <prompt>` or `codex exec -- <prompt>`, env whitelist, stdin null.
  `agent_task_supervisor.rs` forwards bounded 8 KiB UTF-8 chunks
  (`agent-task://output`) and status events (`agent-task://status`) with
  monotonic sequences; at most 4096 output events per task, then a single
  `truncated: true` event.
- Worktrees: `.worktrees/<id>` with branch `agent/<id>`; Rust validates only
  that the cwd lives inside `.worktrees/` (`ensure_worktree_path_in_base`).
- CLI flags verified on 2026-08-24 (`claude` 2.1.241, `codex-cli` 0.149.1) and
  exercised against real runs (fixtures captured, resume confirmed working):
  - `claude -p --output-format stream-json --verbose [--resume <id>] -- <prompt>`
    (session id in `{"type":"system","subtype":"init","session_id":...}`; the
    same id is repeated on every line and on the resumed run)
  - `codex exec --json -- <prompt>`;
    `codex exec resume --json <session_id> -- <prompt>`
    (session id in `{"type":"thread.started","thread_id":...}`; item types seen:
    `agent_message`, `command_execution`, `file_change`, `error`; a run emits
    `turn.started` ... `turn.completed`)
- Pins live in `localStorage` (`useAgentThreadPins.ts`) keyed by task id.
- `src-tauri/src/trust.rs` persists with plain `fs::write`; there is no reusable
  atomic-write helper in the crate.

## Non-goals

- Git commit, push, PR creation from a thread.
- Model picker, permission modes, sandbox flags, `--include-partial-messages`.
- Visual redesign of agent mode (slice 3). Only structural changes to
  `AgentThreadSession`, `AgentComposer`, `AgentThreadsSidebar`.
- Cross-machine sync, export, search of threads.
- Recreating a worktree that was deleted externally.
- Parsing anything from stderr beyond bounded raw lines.

## Architecture

```text
components/agentMode (presentation only)
        |
application: useAgentThreads (facade)
   |- useAgentThreadStore      load/persist/pins/interrupted reconcile
   |- useAgentTurnDispatch     new thread / follow-up / stop / event feed
   |- useAgentIsolationPreview isolation context + fresh status
   |- useAgentWorktreeLifecycle orphan scan (reconciled with store), remove, prune
   |- useAgentChangeSummary    changes + file diff per thread
        |
domain: agentThread (types, reducer, bounds), agentOutput/* (parsers),
        agentTask (task wire contract, unchanged shape + resumeSessionId)
        |
infrastructure: tauriAgentTaskGateway (+resumeSessionId),
                tauriAgentThreadStoreGateway (new)
        |
Rust: agent_task_spawner (resume args), agent_task_admission (cwd exclusive),
      agent_thread_store (new, JSON files, atomic write),
      lib_composition/agent_thread_store_commands (new thin facades)
```

Rust never parses provider output. It keeps forwarding bounded raw chunks;
TypeScript parses them incrementally into a closed event union.

## Domain model (`src/domain/agentThread.ts`)

### Identity and bounds

```ts
export const MAX_AGENT_THREADS_PER_ROOT = 64;
export const MAX_AGENT_TURNS_PER_THREAD = 64;
export const MAX_AGENT_EVENTS_PER_TURN = 512;
export const MAX_AGENT_EVENT_TEXT_BYTES = 16 * 1024;
export const MAX_AGENT_TOOL_SUMMARY_BYTES = 512;
export const MAX_AGENT_THREAD_TITLE_BYTES = 256;
export const MAX_AGENT_SESSION_ID_BYTES = 128;
export const AGENT_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
export const AGENT_THREAD_SCHEMA_VERSION = 1;
```

Thread ids and turn ids both use the existing `AGENT_TASK_ID_PATTERN`
(`agt-<base36 ms>-<hex4>`) minted by `mintAgentTaskId`. The thread id names the
worktree (`.worktrees/<threadId>`, branch `agent/<threadId>`); each turn id is
the supervisor `taskId` of that turn's process. Rust worktree validation is
unchanged because it checks base containment, not id equality.

### Types

```ts
export interface AgentThreadOwner {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly repositoryRoot: string;
}

export interface AgentThreadTarget {
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
}

export interface AgentProviderSession {
  readonly kind: AgentCliKind;
  readonly sessionId: string | null;
}

export type AgentThreadLifecycle = "running" | "settled" | "archived";

export type AgentTurnStatus = AgentTaskStatus | { readonly kind: "interrupted" };

export type AgentTurnEvent =
  | { readonly kind: "assistantText"; readonly text: string }
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "toolCall"; readonly toolId: string; readonly name: string;
      readonly inputSummary: string }
  | { readonly kind: "toolResult"; readonly toolId: string; readonly outputSummary: string;
      readonly isError: boolean }
  | { readonly kind: "result"; readonly text: string; readonly isError: boolean;
      readonly usage: AgentTurnUsage | null }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unknownLine"; readonly stream: AgentTaskOutputStream;
      readonly raw: string; readonly clipped: boolean };

export interface AgentTurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentTurn {
  readonly turnId: string;
  readonly prompt: string;
  readonly status: AgentTurnStatus;
  readonly startedAtEpochMs: number;
  readonly endedAtEpochMs: number | null;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly eventsTruncated: boolean;
  readonly lastStatusSequence: number;
  readonly lastOutputSequence: number;
}

export interface AgentThread {
  readonly threadId: string;
  readonly owner: AgentThreadOwner;
  readonly target: AgentThreadTarget;
  readonly provider: AgentProviderSession;
  readonly title: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly turns: ReadonlyArray<AgentTurn>;
  readonly turnsTruncated: boolean;
}

export function agentThreadLifecycle(thread: AgentThread): AgentThreadLifecycle;
// archived -> "archived"; last turn pending/running -> "running"; else "settled".
export function runningTurn(thread: AgentThread): AgentTurn | null;
```

Mapping from today's `AgentTaskRecord`: `owner.taskId -> turn.turnId`,
`owner.workspaceId -> thread.owner.ownerId`, `owner.repositoryRoot ->
thread.owner.repositoryRoot`, `isolation/worktreePath -> thread.target`,
`prompt/status/startedAtEpochMs/lastStatusSequence/lastOutputSequence ->
turn`, `outputTail/outputTruncated -> turn.events/eventsTruncated`.
`AgentTaskRecord`, `AgentTasksState`, `agentTasksReducer` and their tests are
removed; the status-ordering and owner checks in `applyAgentTaskStatusEvent`
move verbatim into `applyTurnStatusEvent`. `agentTask.ts` keeps the wire
contract only (`AgentTaskStatus`, events, requests, gateway, isolation policy).

### Reducer (`agentThreadsReducer`)

State: `{ readonly threads: ReadonlyMap<string, AgentThread> }` keyed by
threadId, containing threads of all admitted projects (each thread carries its
owner).

```ts
export type AgentThreadsAction =
  | { kind: "loaded"; owner: { rootKey: string; ownerId: string }; threads: ReadonlyArray<AgentThread> }
  | { kind: "threadCreated"; thread: AgentThread }
  | { kind: "turnStarted"; threadId: string; turn: AgentTurn }
  | { kind: "taskStatusEvent"; event: AgentTaskStatusEvent }
  | { kind: "turnEventsAppended"; turnId: string; outputSequence: number;
      events: ReadonlyArray<AgentTurnEvent>; sessionId: string | null; supervisorTruncated: boolean }
  | { kind: "turnInterrupted"; turnId: string }
  | { kind: "pinToggled"; threadId: string }
  | { kind: "archived"; threadId: string }
  | { kind: "deleted"; threadId: string }
  | { kind: "ownerReleased"; ownerId: string };
```

Rules:
- `taskStatusEvent` finds the thread by `turnId === event.taskId`; rejects
  mismatched `workspaceId`/`repositoryRoot`/`isolation`/`worktreePath`, stale
  or duplicate `sequence`, and events after a terminal status (exact port of
  the existing checks). Terminal status sets `endedAtEpochMs`.
- `turnEventsAppended` rejects `outputSequence <= lastOutputSequence` and events
  for terminal/interrupted turns. Consecutive `assistantText` (and `reasoning`)
  events coalesce into the last event while the merged text stays within
  `MAX_AGENT_EVENT_TEXT_BYTES`; otherwise a new event is appended. Once
  `MAX_AGENT_EVENTS_PER_TURN` is reached, further events are dropped and
  `eventsTruncated = true` (never silently). `sessionId` is applied only when
  `provider.sessionId === null`; a later different id is ignored and reported
  by the dispatcher as a warning notice.
- `turnStarted` refuses when `runningTurn(thread) !== null`, when the thread is
  archived, or when the turn count is at the cap and the oldest turn is not
  terminal; otherwise evicts the oldest terminal turn and sets
  `turnsTruncated`.
- `loaded` replaces all threads whose `owner.rootKey === owner.rootKey`, but
  keeps any in-memory thread with a running turn for that owner (webview
  reload guard) and marks loaded turns that are `pending`/`running` as
  `interrupted` unless the same turnId is running in memory.
- Thread eviction: when a root exceeds `MAX_AGENT_THREADS_PER_ROOT`, evict
  settled/archived, unpinned first, oldest `updatedAtEpochMs` then threadId
  ascending; never evict a running thread.
- `ownerReleased` removes threads of that owner that have no running turn
  (mirrors `releaseProjectAgentTasks`).

All parsers in this file are fail-closed (`exactKeys`, bounded UTF-8 text,
closed enums) following the style in `agentTask.ts`.

## Output parsing (`src/domain/agentOutput/`)

Files:
- `lineSplitter.ts`: `splitLines(state, chunk) -> { state, lines, overflow }`.
  State is `{ pending: string; pendingBytes: number }`. A pending line above
  `MAX_AGENT_OUTPUT_LINE_BYTES = 256 * 1024` is discarded and reported as one
  `unknownLine { clipped: true, raw: "<line exceeded 256 KiB>" }`; the parser
  resynchronises at the next `\n`. Deterministic, no timers, O(chunk).
- `agentOutputParser.ts`: `createAgentOutputParserState(kind)`,
  `feedAgentOutput(state, stream, chunk) -> { state, events, sessionId }`, and
  `finishAgentOutput(state)` (flushes a trailing partial line as `unknownLine`
  if non-empty). stdout lines go to the provider strategy; stderr lines always
  become bounded `unknownLine` events (raw clipped to
  `MAX_AGENT_EVENT_TEXT_BYTES`).
- `claudeStreamJson.ts` (Strategy): `parseClaudeStreamJsonLine(line) ->
  ParsedAgentLine`.
- `codexJsonl.ts` (Strategy): `parseCodexJsonlLine(line, state) ->
  { result: ParsedAgentLine, state }` (needs per-item dedupe state:
  `Set<string>` of item ids already emitted as `toolCall`, bounded to 1024).
- `toolInputSummary.ts`: `summarizeToolInput(name, input)`; closed table:
  `Read/Edit/Write/MultiEdit -> input.file_path`, `Bash -> input.command`,
  `Grep/Glob -> input.pattern`, otherwise `JSON.stringify(input)`; always
  clipped to `MAX_AGENT_TOOL_SUMMARY_BYTES` on a UTF-8 boundary.

```ts
export type ParsedAgentLine =
  | { kind: "events"; events: ReadonlyArray<AgentTurnEvent>; sessionId: string | null }
  | { kind: "ignored" }
  | { kind: "unknown"; raw: string };
```

Claude mapping (stream-json, one JSON object per line; confirmed by captured
fixtures):
- `type: "system", subtype: "init"` -> `sessionId = session_id`, no event.
  Other `system` subtypes (`hook_started`, `hook_response`) -> `ignored`.
- `type: "assistant"` -> for each `message.content[]`: `text` -> `assistantText`;
  `tool_use` -> `toolCall { toolId: id, name, inputSummary }`; `thinking` ->
  `reasoning`.
- `type: "user"` -> for each `tool_result` -> `toolResult { toolId: tool_use_id,
  outputSummary: first 512 bytes of string/text content, isError }`.
- `type: "result"` -> `result { text: result ?? "", isError: is_error ||
  subtype !== "success", usage }` plus `sessionId`.
- Any other `type` (e.g. `rate_limit_event`) -> `ignored`. Non-JSON -> `unknown`.

Codex mapping (`--json` JSONL; confirmed by captured fixtures):
- `thread.started` -> `sessionId = thread_id`.
- `item.started`/`item.completed` with `item.type`:
  `agent_message` -> `assistantText(item.text)` on `item.completed` only;
  `reasoning` -> `reasoning(item.text)` on completed;
  `command_execution` -> `toolCall { toolId: item.id, name: "shell", inputSummary:
  item.command }` on started (deduped by id), `toolResult { outputSummary:
  item.aggregated_output, isError: exit_code !== 0 }` on completed;
  `file_change` -> `toolCall { name: "apply_patch", inputSummary: joined paths }`;
  `mcp_tool_call` -> `toolCall { name: server/tool }`; `web_search` ->
  `toolCall { name: "web_search", inputSummary: query }`; `error` -> `error`
  (non-fatal; the fixtures show MCP auth errors emitted as `error` items before
  a successful turn).
- `turn.completed` -> `result { text: "", isError: false, usage }`;
  `turn.failed` -> `result { text: error.message, isError: true, usage: null }`;
  `error` -> `error`.
- `turn.started`, `item.updated`, `todo_list` -> `ignored`.

Session id values are validated against `AGENT_SESSION_ID_PATTERN` at parse
time; a malformed id is dropped (never forwarded to a CLI argument).

## Follow-up turns and resume

### Rust spawner (`agent_task_spawner.rs`)

`plan_agent_invocation(cli_path, invocation, prompt, cwd, resume_session_id:
Option<&str>)`. Argument plans:

| provider | first turn | follow-up |
|---|---|---|
| claudeCode | `-p --output-format stream-json --verbose -- <prompt>` | `-p --output-format stream-json --verbose --resume <id> -- <prompt>` |
| codex | `exec --json -- <prompt>` | `exec resume --json <id> -- <prompt>` |

`resume_session_id` is validated in Rust with the same pattern
(`^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`, so it can never be parsed as a flag).
Unit tests assert the exact argv for all four cases and rejection of
`-` prefixed or oversize ids.

### Wire contract change (`StartAgentTaskRequest`)

Add `resumeSessionId: string | null` on both sides (`deny_unknown_fields` in
Rust, `exactKeys` in TS). No other IPC change to task start/stop/ack.

### Admission (`agent_task_admission.rs`)

Add cwd exclusivity: `reserve` fails with
`AGENT_TASK_CWD_EXCLUSIVE_ERROR = "An agent task is already running in this
working directory."` when any live admission has the same canonical cwd.
This makes "one running turn per thread" enforced in Rust as well as TS
(in-place already had it via `occupies_working_tree`). Global/repository
limits unchanged.

### Session id capture

The TS parser captures the id (Claude `system/init.session_id`, Codex
`thread.started.thread_id`) and the dispatcher stores it on the thread via
`turnEventsAppended.sessionId`. Claude's `--session-id <uuid>` was considered
(would let us mint ids) and rejected for this slice: Codex has no equivalent,
and a single capture path keeps one code path and one failure mode.

## Persistence (Rust-owned store)

### Layout

`<app_data_dir>/agent-threads/<fnv1a64hex(rootKey)>/<threadId>.json`, one
file per thread, no index (the directory listing is the index). `fnv1a64hex`
is ported to Rust so `ownerId == "agent-root:" + dirname` can be checked
without a second key.

Each file:

```json
{ "schemaVersion": 1, "thread": { ...AgentThread wire shape... } }
```

Bounds: `MAX_AGENT_THREAD_FILE_BYTES = 1 MiB`, `MAX_AGENT_THREADS_PER_ROOT =
64` files, `MAX_AGENT_THREAD_ROOT_BYTES = 16 MiB` per root directory,
`MAX_UNREADABLE_REPORTS = 16`.

### Commands (`lib_composition/agent_thread_store_commands.rs`)

All run through `run_blocking_command`; request structs are
`deny_unknown_fields`; responses are `Serialize` only.

- `load_agent_threads { rootKey, ownerId } -> { threads: [AgentThread],
  unreadable: [{ threadId, reason }], evicted: number }`
- `save_agent_thread { rootKey, ownerId, thread } -> null` (upsert; validates
  `thread.owner.rootKey/ownerId` equal the request, size cap, turn/event
  caps, status enum, then atomic write, then eviction)
- `delete_agent_thread { rootKey, ownerId, threadId } -> null`

Ownership: `ownerId` must equal `agent_root_owner_id(rootKey)`; mismatch is an
error. The store is not trust-gated (it holds only the user's own conversation
text) but paths inside a thread are never used by the store for filesystem
access.

### Atomic write and locking

`agent_thread_store.rs` exposes `AgentThreadStore::new(base_dir)` with
`load(root_key)`, `save(root_key, document)`, `delete(root_key, thread_id)`.
Writes: `create_dir_all`, write `<threadId>.json.tmp-<nanos>`, `sync_all`,
`rename` onto the final name, then `sync` the directory on unix. A global
`Mutex<HashMap<String, Arc<Mutex<()>>>>` hands out a per-root lock; the global
lock is released before any filesystem call, and the per-root lock is held for
the duration of one save/delete/load (RAII guard). Stray `*.tmp-*` files are
deleted during `load`.

### Corruption and eviction

- A file that fails JSON parsing, schema version check, bounds, or owner check
  is left in place, skipped, and reported in `unreadable` (bounded). The UI
  shows one bounded warning notice: "N saved threads could not be read and were
  skipped." Nothing is auto-deleted.
- Eviction on `save` (deterministic): while file count > 64 or total bytes >
  16 MiB, delete the file whose thread is settled/archived and unpinned with the
  smallest `(updatedAtEpochMs, threadId)`; running threads and pinned threads
  are never evicted; if nothing is evictable the save is rejected with a
  bounded error and the UI notice says the store is full.

### Pins

Pins move into the store as `thread.pinned`. Justification: pins reference
thread ids that now live in the store, eviction must respect pins, and two
sources of truth would let a pin outlive or precede its thread. There is
nothing to migrate: pre-slice pins point at task ids that were never
persisted. `useAgentThreadStore` removes the legacy
`mockor.agents.threadPins.<rootKey>` localStorage key on first load for that
root; `useAgentThreadPins.ts` and its test are deleted.

### Persist cadence

`useAgentThreadStore` writes a thread when: it is created, a turn starts, a
turn reaches terminal/interrupted, pin/archive toggles, session id is captured,
or at most once per second while a turn is running (coalesced events). Writes
for a thread are serialised (one in flight, one pending). A save that fails is
retried on the next trigger; failure surfaces once as a warning notice.

## Application layer

### Shared authority helper (`src/application/agentProjectAuthority.ts`)

Extract from `useAgentTasks.ts` unchanged: `AgentProjectAuthority`,
`projectAuthority`, `isCurrentProjectOwner`, `projectByRootKey`,
`projectByOwnerId`, `owningProjectForRepository`, `sameProjectAuthority`,
`attempt`, `tryOrReport`, notice constructors. Every coordinator captures
`AgentProjectAuthority { rootKey, ownerId, generation }` before an `await` and
calls `isCurrentProjectOwner` after each `await` and before each dispatch or
side effect.

### Ports (`src/application/agentThreadPorts.ts`)

```ts
export interface AgentThreadStoreGateway {
  loadAgentThreads(request: { rootKey: string; ownerId: string }): Promise<AgentThreadStoreSnapshot>;
  saveAgentThread(request: { rootKey: string; ownerId: string; thread: AgentThread }): Promise<void>;
  deleteAgentThread(request: { rootKey: string; ownerId: string; threadId: string }): Promise<void>;
}
export interface AgentThreadStoreSurface {
  readonly state: AgentThreadsState;
  readonly loadedRootKeys: ReadonlySet<string>;
  dispatchAction(action: AgentThreadsAction): void;
  togglePin(threadId: string): void;
  archive(threadId: string): void;
  remove(threadId: string): void;
}
```

Implemented by `src/infrastructure/tauriAgentThreadStoreGateway.ts` +
`tauriAgentThreadStoreIpcContract.ts` with the same validate/parse pattern as
`tauriAgentTaskIpcContract.ts`.

### `useAgentThreadStore(deps)`

- Inputs: `agentThreadStoreGateway`, `projects`, `agentModeActive`,
  `reportError`, `setNotice`.
- For each project in `projects` (admitted), when `agentModeActive` becomes
  true or the project's `(rootKey, ownerId, generation)` changes, capture the
  authority, `await load`, revalidate, dispatch `loaded`. Results for a stale
  generation are dropped (A -> B -> A produces a new generation and a fresh
  load).
- Owns the reducer and the persist queue described above.
- Exposes `AgentThreadStoreSurface`.

### `useAgentTurnDispatch(deps)`

- `startThread(request: AgentThreadStartRequest)`: today's `dispatch` minus
  isolation preview (delegated) plus creating the `AgentThread` record and the
  first turn. Worktree creation uses `threadId`; `startAgentTask` uses
  `taskId = turnId`, `resumeSessionId: null`.
- `sendFollowUp({ threadId, prompt })`: validates prompt bounds, thread not
  archived, `runningTurn === null`, project owner current for
  `thread.owner`, live task count below the configured limit, CLI configured
  and `provider.kind === current agentCliKind` (if the user switched providers
  the notice says "This thread was started with <kind>; start a new thread"),
  `provider.sessionId !== null` (otherwise "This thread has no resumable
  session; start a new thread"), worktree present (from
  `useAgentWorktreeLifecycle.isWorktreeMissing`). Then mints a turnId,
  dispatches `turnStarted`, starts the task with `cwd = worktreePath ??
  repositoryRoot` and `resumeSessionId`, acknowledges, and handles the same
  compensation paths as today (`stop` on owner loss, uncertain start notice).
- Subscribes once to status and output events. Output handling: keep a mutable
  `Map<turnId, AgentOutputParserState>` in a ref; per chunk run
  `feedAgentOutput`, append events to a per-turn pending buffer, and flush
  buffers to the reducer via a single `requestAnimationFrame` (or 16 ms
  `setTimeout` in tests) as one `turnEventsAppended` per turn. Terminal status
  flushes synchronously first, then calls `finishAgentOutput`, then dispatches
  the status. Parser states for terminal turns are deleted.
- `stop(threadId)` stops the running turn.

### `useAgentIsolationPreview(deps)`

`isolationContext`, `refreshIsolationStatus`, `isolationPreview`, request
generations and confirmation key, unchanged behaviour. `liveAgentTasksInRepository`
counts running turns in that repository.

### `useAgentWorktreeLifecycle(deps)`

- `refreshOrphanedWorktrees`: lists worktrees per trusted project repository
  (owner-validated as today) and marks as orphan any `.worktrees/*` path not
  referenced by a loaded thread for that repository (`threads` come from the
  store surface). Until the root is loaded, no orphans are reported for it.
- `missingWorktreeThreadIds`: threads whose `target.worktreePath` is not in the
  listed worktrees (or is `prunable`). Follow-up is blocked for them and the
  session shows "The worktree for this thread no longer exists."
- `removeWorktree(threadId)` (settled threads only), `removeOrphanedWorktree`,
  `pruneOrphanedWorktrees`, uncertain worktree retention: unchanged logic.

### `useAgentChangeSummary(deps)`

`showChanges/hideChanges/showFileDiff/hideFileDiff` keyed by threadId instead
of taskId; unchanged logic.

### `useAgentThreads(deps)` facade

Composes the five hooks and returns `AgentThreadsSurface`:

```ts
export interface AgentThreadView {
  readonly thread: AgentThread;
  readonly lifecycle: AgentThreadLifecycle;
  readonly repositoryLabel: string;
  readonly worktreeRemoved: boolean;
  readonly worktreeMissing: boolean;
  readonly changeSummary: AgentTaskChangeSummary | null;
}
export interface AgentThreadsSurface {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly repositories, orphanedWorktrees, notice, dispatching, agentCliConfigured,
           liveTaskCount, maxConcurrentAgentTasks;   // as today
  isolationPreview, refreshIsolationStatus;          // as today
  startThread(request: AgentThreadStartRequest): Promise<{ threadId: string } | null>;
  sendFollowUp(request: { threadId: string; prompt: string }): Promise<boolean>;
  stop(threadId: string): Promise<void>;
  togglePin(threadId: string): void;
  archive(threadId: string): void;
  remove(threadId: string): void;              // deletes from store; blocked while running
  hasLiveTasksForOwner, stopProjectTasks, releaseProjectTasks;  // as today
  removeOrphanedWorktree, pruneOrphanedWorktrees, showChanges, hideChanges,
  showFileDiff, hideFileDiff, removeWorktree, configureAgentCli, dismissNotice;
}
```

`useAgentTasks.ts` and `useAgentTasks.test.ts` are deleted;
`useWorkbenchAgents.ts` wires `useAgentThreads` and passes
`agentThreadStoreGateway` (default from `workbenchDefaultGateways.ts`) and
`agentModeActive`.

Every new module stays well under the hotspot limits; target <= 600 lines
each. No baseline entries are added.

## UI (structure only)

- `AgentThreadSession`: header (repo label, title, lifecycle badge); body maps
  `thread.turns` to `<AgentTurnView>` (`React.memo`, keyed by turnId). Each turn
  renders the prompt bubble (existing `agent-prompt` classes), then its events:
  `assistantText` as paragraphs, `reasoning` collapsed under a "reasoning"
  microlabel, `toolCall` as a compact row `name  inputSummary` with the paired
  `toolResult` status (ok/error) when present, `result` as the existing
  `agent-finale`, `error` as `agent-finale--bad`, `unknownLine` under a
  collapsed "raw output" group. Only the last `MAX_RENDERED_EVENTS_PER_TURN =
  200` events of a turn are rendered with a "N earlier events hidden" note.
  Turn status `interrupted` shows "Interrupted by app restart". Changes/diff
  section unchanged.
- `AgentComposer`: new prop `mode: { kind: "new" } | { kind: "followUp";
  threadTitle: string; blockedReason: string | null }` and `onNewThread()`.
  In follow-up mode the project/repository/isolation controls are hidden
  (target is fixed by the thread), the submit label is "Send", and a
  "New thread" button escapes to new mode. `blockedReason` disables submit and
  is shown as the caption.
- `AgentModeView`: `selectedThreadId` state; selecting a thread puts the
  composer in follow-up mode; submit routes to `sendFollowUp` or `startThread`;
  "New thread" clears selection. Pins come from the surface (no
  `useAgentThreadPins`).
- `AgentThreadsSidebar`: rows show `agentThreadLifecycleLabel(lifecycle)` and
  the running turn count; archived threads appear under a collapsed
  "Archived" group per repository. Presentation helpers move to
  `agentModePresentation.ts` (`agentThreadLifecycleLabel`, `agentThreadTone`
  taking `AgentThreadLifecycle` + last turn status, `agentTurnStatusLabel`).

## Data flow

1. Agent mode entry -> `useAgentThreadStore` loads each admitted root
   (owner-validated) -> `loaded` -> sidebar lists threads.
2. User writes a prompt with no selection -> `startThread` -> worktree (if
   any) -> `threadCreated` + `turnStarted` -> `start_agent_task` (no resume) ->
   ack -> chunks -> parser -> `turnEventsAppended` (batched per frame) ->
   `sessionId` captured -> persisted.
3. User selects the thread and sends a follow-up -> `sendFollowUp` ->
   `turnStarted` -> `start_agent_task { resumeSessionId }` -> same stream.
4. Terminal status -> flush parser, `taskStatusEvent`, persist, refresh change
   summary and orphan scan (as today).
5. Project release / workspace switch -> `ownerReleased` for that owner; a
   later re-admission with a new generation reloads from disk.

## Failure modes

| Failure | Behaviour |
|---|---|
| CLI lacks `--resume`/`exec resume` (older binary) | The process exits non-zero with usage text on stderr; the turn ends `exited` with `unknownLine` events showing the stderr; notice: "The agent CLI rejected the resume request. Update the CLI or start a new thread." Detection: exit code != 0 and no `sessionId`/`result` seen. |
| Session id never arrives | Thread stays `provider.sessionId === null`; follow-up is blocked with a bounded reason; the first turn still renders fully. |
| Session id changes on a later turn | Ignored; warning notice once per thread. |
| App restart mid-turn | On load, `pending`/`running` turns become `interrupted`; lifecycle `settled`; follow-up allowed if a session id exists. |
| Webview reload while the supervisor still runs the task | `loaded` keeps in-memory running turns; a supervisor task with no in-memory turn is stopped by the existing `retainWorkspaceAgentTasks` semantics via `stopProjectTasks` on release. |
| Worktree deleted externally | `worktreeMissing`; follow-up blocked; remove/prune available; thread text retained. |
| Store file corrupt / wrong schema / oversize | Skipped, reported in `unreadable`, one bounded notice; no deletion. |
| Store full / unevictable | Save rejected; notice; in-memory thread continues. |
| Output line > 256 KiB | Dropped as one clipped `unknownLine`; parsing resumes at next newline. |
| Supervisor `truncated: true` | `eventsTruncated = true`; session shows "Later output was dropped to bound memory." |
| Owner generation changes during dispatch/load | Result discarded; started task stopped (existing compensation); worktree retained as uncertain. |
| Two follow-ups racing on one thread | Second is rejected in TS (`runningTurn !== null`) and in Rust (cwd exclusivity). |

## Performance

- Parsing is O(chunk) with a bounded pending buffer; no re-parse of the tail.
- One reducer action per running turn per animation frame regardless of chunk
  rate; assistant text coalesces so event counts stay small.
- `AgentTurnView` is memoised; a chunk rerenders only the running turn.
- Rendering is capped at 200 events per turn; sidebar rows use existing
  memoised presentation.
- Persist writes are coalesced to <= 1/s per running thread, files <= 1 MiB,
  and run on the Rust blocking pool.
- Regression guards: a test counting `AgentTurnView` renders while feeding 500
  chunks (expect <= number of frames flushed, not chunks).

## Testing strategy

### Fixtures (`src/domain/agentOutput/fixtures/`)

Captured on 2026-08-24 from real CLIs in a throwaway repo, scrubbed (absolute
paths -> `/repo`, hook ids kept), each <= 64 KiB, committed:
`claude-first-turn.jsonl`, `claude-resume-turn.jsonl`, `codex-first-turn.jsonl`,
`codex-resume-turn.jsonl`. Capture procedure for refreshing them:

```bash
mkdir -p /tmp/agent-fixture && cd /tmp/agent-fixture && git init -q && echo hi > a.txt
claude -p --output-format stream-json --verbose -- "Append the line 'hello' to a.txt using a tool, then reply with one word: done." > claude-first-turn.jsonl
SID=$(grep -m1 '"subtype":"init"' claude-first-turn.jsonl | sed -E 's/.*"session_id":"([^"]+)".*/\1/')
claude -p --output-format stream-json --verbose --resume "$SID" -- "What did you append? One word." > claude-resume-turn.jsonl
codex exec --json -- "Append the line 'hello' to a.txt, then reply with one word: done." > codex-first-turn.jsonl
TID=$(grep -m1 '"thread.started"' codex-first-turn.jsonl | sed -E 's/.*"thread_id":"([^"]+)".*/\1/')
codex exec resume --json "$TID" -- "What did you append? One word." > codex-resume-turn.jsonl
```

### Domain tests

- Line splitter: partial lines across chunks, CRLF, empty lines, oversize line
  recovery, trailing partial line at finish.
- Each strategy against fixtures: exact event sequence snapshot, session id
  captured exactly once, unknown `type` -> ignored, non-JSON -> unknown,
  malformed session id dropped, bounded summaries.
- Reducer: status ordering/ownership (ported tests), coalescing and caps,
  one-running-turn rule, interrupted marking on `loaded`, eviction order,
  parser round trip (`parseAgentThread(serialize(thread))` identity), rejects
  unknown fields.

### Rust tests

- Spawner argv for the four invocations; rejected ids.
- Admission cwd exclusivity.
- Store: atomic write leaves no tmp file after a simulated failure, corrupt
  file skipped and reported, schema version mismatch skipped, eviction order
  deterministic, owner mismatch rejected, oversize document rejected,
  concurrent saves to two roots do not serialise on the global lock.
- Command facades: `deny_unknown_fields` rejections.

### React tests (`act`/`waitFor`)

- Store hook: load on agent mode entry, A -> B -> A reload with generation
  change discards the late A result; persist coalescing; legacy pin key
  removed.
- Dispatch hook: new thread + follow-up argv (`resumeSessionId` passed), one
  running turn per thread, follow-up blocked reasons, late/foreign/duplicate
  output after terminal ignored, owner loss after `startAgentTask` triggers
  stop, batched event flush count.
- Worktree lifecycle: orphan = worktree without a persisted thread; missing
  worktree marks the thread.
- Components: session renders prompt bubbles, tool rows, result; composer
  follow-up mode and "New thread" escape; sidebar lifecycle labels.

### Gates

All gates listed in `CLAUDE.md` (`npm run check`, lint, build,
`size:hotspots`, format checks, `npm test -- --run`, cargo check/test/fmt/clippy,
`git diff --check`).

## Implementation streams

- S0 (sequential, first): shared contracts - `src/domain/agentThread.ts`,
  `agentTask.ts` changes, `agentOutput/agentOutputParser.ts` type surface,
  `application/agentThreadPorts.ts`, `application/agentProjectAuthority.ts`,
  Rust `resume_session_id` field and store serde types, command names.
- A: domain parsers, fixtures, reducer tests.
- B: Rust spawner/admission/store/commands.
- C1: `useAgentThreadStore`, `useAgentWorktreeLifecycle`,
  `useAgentChangeSummary`, store IPC contract + gateway, pins removal.
- C2: `useAgentTurnDispatch`, `useAgentIsolationPreview`, `useAgentThreads`,
  `useWorkbenchAgents` wiring, task IPC contract, `useAgentTasks` deletion.
- D: `src/components/agentMode/*`.
- Lead: composition root wiring, full gates, independent adversarial review.
