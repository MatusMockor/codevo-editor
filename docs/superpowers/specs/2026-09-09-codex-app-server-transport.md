# Codex provider: `codex exec --json` to the `codex app-server` session protocol

Date: 2026-09-09 · Status: proposed · Base: `main` @ d4429873

## 0. Why

Measured on this machine: `codex exec --json` structurally omits all per-subagent
telemetry (only empty `collab_tool_call` items with `tool:"wait"`), while
`codex app-server` delivers `subAgentActivity` items (started, interacted,
interrupted, completed with `agentThreadId` and `agentPath`), every subagent as
its own thread so its reasoning, messages and command executions reach the client
keyed by `threadId`, per-thread `turn/completed durationMs`, and per-thread
`thread/tokenUsage/updated` with input, output, cached and reasoning tokens.
T3 Code uses app-server (bundle carries `codex.app-server.notification` and
`.request` sources, `thread/start` and `thread/resume` with a fresh-start
fallback, a provider setting for extra app-server launch arguments, and a
`SubAgentSessionSource` thread origin).

Authoritative protocol source: schema and TypeScript types generated from the
installed CLI in `scratchpad/subagent-probe/schema/` and `.../ts/`; real captures
in `as-sol.jsonl`, `as-sol2.jsonl` (app-server with subagents) and
`exec-proof.jsonl` (exec, for contrast); driver `probe_appserver.py`.

## 1. Inventory (measured, file:line)

| Concern | Location |
| --- | --- |
| argv template (`exec`, `exec resume --json`) | `src-tauri/src/agent_task_spawner.rs:211-244` |
| process plan, bounded env (7 vars), prompt cap 32 KiB | `agent_task_spawner.rs:15-20,169-209` |
| spawn: stdin null, pgid 0, non-blocking pipes | `agent_task_spawner.rs:333-390,419-460` |
| `AgentChild` / `AgentProcessSpawner` seams | `agent_task_spawner.rs:312-329` |
| supervisor caps: 4096 events x 8 KiB, 3600 s, 256 queued | `agent_task_supervisor.rs:20-41` |
| output pump, chunk publish, truncation marker | `agent_task_supervisor.rs:1179-1331` |
| pgid signal seam, escalate, watchdog, reap | `agent_task_supervisor.rs:110-120,1458-1539` |
| wire events `agent-task://status|output` | `agent_task_supervisor.rs:26-27,62-100` |
| launch options, Codex model and mode arg tables | `agent_launch.rs:96-126,386-411` |
| Tauri facades, start authority two-phase | `lib_composition/agent_task_commands.rs:196-360,500` |
| admission slots (global 64, in-place 1, cwd-exclusive) | `agent_task_admission.rs:8-18,53-92` |
| turn lease vs update lease (`turn_count > 0` blocks update) | `agent_provider_runtime.rs:220-257,435-480` |
| health and version probe timeout 5 s | `agent_provider_process.rs:28` |
| rollout session id scan (`~/.codex/sessions`, `rollout-`) | `agent_session_history.rs:32,121,495-600` |
| TS codex JSONL parser (`thread.started` to sessionId) | `src/domain/agentOutput/codexJsonl.ts:33-51` |
| parser strategy dispatch, `ParsedAgentLine` | `src/domain/agentOutput/agentOutputParser.ts:14-22,56-65` |
| line cap 256 KiB | `src/domain/agentOutput/lineSplitter.ts:3` |
| `AgentTurnEvent` union, per-turn caps | `src/domain/agentThread.ts:19-30,68-100` |
| per-turn stream state machine | `src/application/agentTurnOutputStream.ts` |

Largest observed server frame: 1442 B. `multi_agent_v2` is stable, no `--enable`
needed.

## 2. Process model

One app-server host per repository root, not per app and not per thread.

- Key: canonical repository root, `AgentCliInvocation::Codex`, provider
  generation, `ExecutableIdentity`. Any identity or generation change retires it.
- Owner: new `CodexAppServerHostRegistry` (Tauri managed state, sibling of
  `AgentTaskRegistry`), owning the child, its process group (`process_group(0)`),
  reader and writer threads, and a `Drop` that runs SIGTERM, SIGKILL and reap on
  the group exactly like `escalate_group_stop`.
- Rejected: one host per app (a crash takes every project down and violates the
  per-workspace isolation rule); one host per thread (loses the shared-server win
  and multiplies MCP startup).
- Bounds: `MAX_CODEX_APP_SERVER_HOSTS = 4` with LRU eviction of a host with zero
  live turns, `CODEX_HOST_IDLE_SHUTDOWN = 300 s`, `CODEX_HOST_START_TIMEOUT = 20 s`
  to a completed `initialize` round trip.
- Supervision: one handshake to ready state machine. Handshake failure, malformed
  frames, EOF or crash move the host to `Failed{reason}`, settle every live turn
  as failed and remove the host. No automatic restart of a live turn; the next
  start spawns a fresh host (one retry, then the error surfaces).
- Slots unchanged: admission still reserves one slot per turn; app-server threads
  are one to one with our threads.
- App quit or host death during a turn: `stop_agent_tasks_on_dispose` also drains
  the host registry, `turn/interrupt` per live turn, wait up to
  `GRACEFUL_STOP_TIMEOUT`, then kill the group. Turns settle as stopped and stay
  resumable because the server persists the rollout.

## 3. The wire (Rust client)

New modules under `src-tauri/src/`: `codex_app_server_protocol.rs` (typed
frames), `codex_app_server_transport.rs` (NDJSON framing, id correlation, bounded
queues), `codex_app_server_host.rs` (process ownership, handshake, routing),
`codex_app_server_turn.rs` (per-turn `AgentChild` adapter), `codex_turn_event.rs`
(projection).

Launch plan, typed and shell-free, extending `agent_invocation_args`:
`[<codex>, "app-server", "--listen", "stdio://"]` plus `launch.model_args()` plus
`extra_args`; `env_clear` plus `AGENT_TASK_INHERITED_ENV`; stdin, stdout and
stderr piped; `process_group(0)`; cwd is the repository root with the retained
`cwd_authority` descriptor. `extra_args` comes from the new provider setting,
parsed into at most 16 arguments of at most 256 bytes, ASCII printable, rejecting
`--listen`, `--code-mode-host`, `--strict-config` and anything with NUL or
newline. Sandbox and approval policy are never CLI arguments; they are per-thread
parameters.

Methods, as a closed enum: `initialize`, notification `initialized`,
`thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`,
`thread/unsubscribe`.

Framing and bounds: reader thread with `read_until(b'\n')` and
`MAX_APP_SERVER_LINE_BYTES = 1 MiB`; a longer line is fatal for the host because a
truncated JSON-RPC stream cannot be resynchronised. Writer thread with a bounded
channel of 64; a full queue is fatal, never blocking. Per-turn inbound queue of
4096 frames; overflow sets the existing truncated flag rather than dropping
silently. Monotonic u64 request ids in one map never held across I/O, with
deadlines: initialize 20 s, thread start or resume 30 s, turn start 30 s, turn
interrupt 10 s. A timeout removes the pending entry; a late response for an
unknown id is discarded. Unknown response ids, unknown notification methods and
undecodable params are counted and projected once per turn as a bounded
`unknownFrame`, never fatal. A server request with an unknown method is answered
with JSON-RPC error -32601; a server request is never left unanswered.

`deny_unknown_fields` rule per struct:
- Client-authored params and approval responses: `deny_unknown_fields`, with
  round-trip tests.
- Server-authored envelopes we classify (`JsonRpcMessage`, request, response,
  error): `deny_unknown_fields`; a malformed envelope is fatal.
- Server-authored payloads we project (thread started, item started or completed,
  turn started or completed, token usage updated, error, `ThreadItem`, `Thread`,
  `Turn`, token breakdown): forward compatible, no `deny_unknown_fields`, every
  optional field `Option<T>` with `default`, because the CLI adds fields between
  releases.
- Closed server unions we branch on (`ThreadItem::type`, `TurnStatus`,
  `SubAgentActivityKind`, `CommandExecutionStatus`): an unknown tag deserializes
  into an explicit `Unrecognized{ tag }` arm that projects to `unknownFrame` and
  is never treated as success.

## 4. Supervisor seam: a turn is a session, not a process

`AgentChild` gains a closed ownership discriminator:

```rust
pub enum AgentTaskProcessOwnership { OwnedGroup { process_group_id: i32 }, SharedSession }
```

`process_group_id()` is replaced by `ownership()`. Claude and the exec fallback
return `OwnedGroup` and every existing signal, escalate and reap path is
unchanged. Codex app-server turns return `SharedSession`, and the supervisor's
escalate, watchdog and reap branch to `force_kill()` only: a turn must never
signal the shared host's process group.

`CodexTurnChild` implements `AgentChild`: `stdout_reader()` is the read end of an
in-process pipe fed by the projection; `stderr_reader()` is a bounded 4 KiB ring
of host stderr replayed once on failure; `force_kill()` sends `turn/interrupt`
then closes the writer end after `GRACEFUL_STOP_TIMEOUT`; exit observation comes
from the turn's terminal state; `Drop` (an RAII turn lease) unregisters the route,
interrupts if still live and decrements the host's live-turn count.

`AgentTaskSpawnPlan` gains a closed `transport: CodexTransport::{Exec, AppServer}`
and the spawner dispatches on it. All existing prompt, path, cwd and identity
validation runs unchanged for both.

## 5. Event mapping

Rust projects app-server frames into a closed NDJSON union `CodexTurnEvent`
(`{"v":1,"t":...}`) written into the turn pipe, so the supervisor's sequencing,
acknowledgement, 4096-event cap, 8 KiB chunking and truncation marker apply
untouched. Every string is bounded before serialization; command output is
clipped to `MAX_AGENT_TOOL_SUMMARY_BYTES`.

| app-server input | condition | `CodexTurnEvent` | `AgentTurnEvent` |
| --- | --- | --- | --- |
| thread start or resume result | - | `session{threadId}` | sessionId only |
| `thread/started` | root thread | `session{threadId}` | sessionId only |
| `item/completed` agentMessage | root | `text{role:"assistant"}` | assistantText |
| `item/completed` reasoning | root | `text{role:"reasoning"}` | reasoning |
| `item/started` commandExecution | root | `toolCall{name:"shell"}` | toolCall |
| `item/completed` commandExecution | root | `toolResult{isError:exit!=0}` | toolResult |
| `item/started` fileChange | root | `toolCall{name:"apply_patch"}` | toolCall |
| `item/started` mcpToolCall | root | `toolCall{name:"server/tool"}` | toolCall |
| `item/started` webSearch | root | `toolCall{name:"web_search"}` | toolCall |
| `item/*` subAgentActivity | started only, deduped by item id | `subagent{kind,agentThreadId,agentPath}` | new subagentActivity |
| any item on a non-root threadId | thread in known subagent set | `subagentItem{agentThreadId,inner}` | new subagentEvent |
| `thread/tokenUsage/updated` | root | `usage{scope:"thread"}` | result usage on turn end |
| `thread/tokenUsage/updated` | subagent | `usage{scope:"subagent"}` | new subagentUsage |
| `turn/completed` | root | `result{isError,durationMs,usage}` | result |
| `turn/completed` | subagent | `subagentTurnCompleted{...}` | new subagentTurnDone |
| `thread/compacted` | root | `compaction{before,after}` | contextCompaction |
| error notification | any | `error{message,threadId}` | error |
| deltas, mcpServer, account, status changed, remote control | - | dropped | - |
| unknown method, unknown tag, undecodable params | - | `unknownFrame{method}` at most 8 per turn | unknownLine |

Thread carriage: the host holds `root_thread_id` and a bounded
`subagent_threads: HashMap<ThreadId, AgentPath>` (cap 32 per turn) populated only
from `subAgentActivity.agentThreadId` on the root thread. Items on a thread that
is neither root nor registered are `unknownFrame` and never merge into the parent
log, so the UI can render subagents as their own collapsible groups.

New TS variants in `src/domain/agentThread.ts`, all readonly and bounded:

```
| { kind:"subagentActivity"; agentThreadId; agentPath; activity:"started"|"interacted"|"interrupted"|"completed" }
| { kind:"subagentEvent"; agentThreadId; event: AgentTurnEvent }
| { kind:"subagentUsage"; agentThreadId; usage: AgentThreadTokenUsage }
| { kind:"subagentTurnDone"; agentThreadId; durationMs: number|null; isError: boolean }
```

`AgentTurnUsage` gains `cachedInputTokens` and `reasoningOutputTokens`, both
optional and defaulted to null so persisted threads parse. Byte accounting and
text coalescing get exhaustive arms for the four new variants; `subagentEvent`
never coalesces across different `agentThreadId`. Existing per-turn caps stay;
add `MAX_SUBAGENT_THREADS_PER_TURN = 32`.

New TS parser `src/domain/agentOutput/codexAppServer.ts` selected by a third
strategy in `agentOutputParser.ts`; `codexJsonl.ts` stays for the exec fallback.

## 6. Session identity and resume

- One persisted id: `AgentProviderSession.sessionId` now holds the app-server
  `thread.id`, which is the same rollout id, so history scanning and terminal
  session import keep matching. No schema bump.
- Existing threads carry an exec-era id that is the same rollout id, so
  `thread/resume` works for them with no migration.
- Resume: with a session id, `thread/resume{threadId, cwd, sandbox,
  approvalPolicy, model, excludeTurns:true}`; without one, `thread/start`.
- Fresh-start fallback as T3 does: on a recoverable resume error (JSON-RPC error,
  timeout, or a mismatched thread id in the result) the host issues `thread/start`
  once, emits a bounded notice that the previous session could not be resumed and
  a new one was started, and reports the new id through the existing session
  channel. Host-fatal errors do not fall back.
- Imported terminal-session threads keep their external origin; the first turn
  takes the resume path and may fall back, leaving the origin intact.

## 7. Migration and rollback

- Execution modes map to per-thread parameters: default `approvalPolicy:"never"`;
  read only adds `sandbox:"read-only"`; workspace write and auto add
  `sandbox:"workspace-write"`; full access adds `sandbox:"danger-full-access"`.
  `approvalPolicy:"never"` preserves today's non-interactive exec semantics.
- Approvals fail closed: every approval, permission, user-input and elicitation
  request is answered with the declining variant regardless of mode and projected
  once as a bounded error naming the mode that forbade it. Interactive approval is
  a later phase the wire already anticipates.
- Transport selection: new provider preferences `codexTransport` with values
  `appServer` (default) and `exec`, plus `codexAppServerArgs` for extra launch
  arguments, mirrored in Rust. Changing either bumps the settings revision, which
  invalidates turn leases and retires hosts without affecting a live turn.
- Truthful UI: starting a session, session unavailable with a reason and a retry,
  never a fabricated running state; a turn that starts while the host is starting
  stays pending.

## 8. Risks

1. Update lease: the host holds no turn lease, so `acquire_update` gains a
   pre-step that shuts down idle hosts; a live turn still refuses the update, and
   a host is never resurrected while updating.
2. Zombies: host `Drop`, registry `Drop` and dispose all run the escalation on the
   host process group; a panicking reader or writer converts to host failure and
   the group is still reaped.
3. Long-session memory: subagent map cap 32 per turn, frame queue 4096, stderr
   ring 4 KiB, idle shutdown, host LRU cap, and `thread/unsubscribe` on every
   settled turn.
4. Frame size: 1 MiB server cap (fatal, no silent resync), projected lines well
   under the 256 KiB line cap.
5. Sandbox and cwd per thread come from the validated authority; a resumed thread
   whose cwd differs is treated as a recoverable resume error.
6. Health and version probes are unchanged and take their own short-lived process.
7. Windows and Linux: process groups and fchdir are unix-only already; on Windows
   the host uses `current_dir` and `Child::kill`. Ship behind the setting there
   first.

## 9. Streams (disjoint ownership)

| # | Stream | Owns | Validation |
| --- | --- | --- | --- |
| A | Protocol types | `codex_app_server_protocol.rs` + tests | `cargo test --lib codex_app_server_protocol` |
| B | Transport and host | `codex_app_server_transport.rs`, `codex_app_server_host.rs` + tests | `cargo test --lib codex_app_server_host` |
| C | Supervisor seam | `agent_task_spawner.rs`, `agent_task_supervisor.rs`, `codex_app_server_turn.rs` | `cargo test --lib agent_task_supervisor` |
| D | Projection | `codex_turn_event.rs` + tests, `agent_launch.rs` | `cargo test --lib codex_turn_event` |
| E | TS parser and domain | `codexAppServer.ts`, `agentOutputParser.ts`, `agentThread.ts`, `agentThreadWire.ts` | `npm test -- --run src/domain` |
| F | Settings and composition | `agentProviderSettings.ts`, `agent_task_commands.rs`, `agent_provider_runtime.rs`, `lib.rs` | `npm test -- --run src/domain/agentProviderSettings`, `cargo test --lib` |
| G | UI and presentation | `src/components/agentMode/*`, `agentModePresentation.ts` | `npm test -- --run src/components/agentMode` |

Ordering: A, then B and D in parallel, then C, then E and F, then G. Only one
writer per file; C must not run in parallel with any other stream touching the
supervisor.

## 10. Test plan

Rust unit: frame split at arbitrary byte boundaries; oversized line fatal;
unknown notification counted not fatal; unknown server request answered -32601;
id correlation under interleaving; late response discarded; request timeout
removes the pending entry; write-queue overflow fatal; forward-compatible payloads
decode with unknown fields; client params reject unknown fields; every
`ThreadItem` tag from the generated schema either projects or yields
`Unrecognized`.

Rust integration with a fake app-server test binary replaying `as-sol2.jsonl` and
scripted faults (no initialize answer, EOF mid-turn, resume error to fallback,
oversized frame, approval storm, slow writer): happy turn; interrupt; host death
settles turns; dispose drains and reaps; workspace A to B to A never routes to a
stale owner; update refused during a turn and allowed after; two roots get two
hosts; LRU eviction at five.

TS parity: golden fixtures generated by the Rust projection from `as-sol2.jsonl`,
asserted byte-identical in Rust and parsed into events in TS; subagent items never
appear in the parent list; caps produce the truncated flag; unknown tags become
`unknownLine`; schema-1 persisted threads still parse.

Full gates before completion: `npm run check`, `npm run lint -- --max-warnings 0`,
`npm run build`, `npm run size:hotspots`, `npm run format:check`,
`npm test -- --run`, then in `src-tauri` sequentially `cargo check --all-targets`,
`cargo test --lib`, `cargo test --tests`, `cargo fmt --all -- --check`,
`cargo clippy --all-targets -- -D warnings`, plus `git diff --check`.

## 11. QA checklist (built app)

1. Codex thread in workspace write, prompt spawning two subagents: both appear as
   named groups with their own reasoning, messages and shell calls; the parent log
   has no subagent noise.
2. Per-thread duration and token usage (input, output, cached, reasoning) for the
   parent and each subagent.
3. Follow-up turn resumes with no session-changed notice.
4. Delete the rollout file, then follow up: one fresh-start notice, the turn runs.
5. Stop a running turn: settles within about a second, no codex process remains.
6. Quit the app mid-turn: no orphaned app-server process.
7. Read-only mode: a write attempt is declined with a visible reason.
8. Provider update during a turn is refused, allowed after it settles.
9. Switch project tabs A to B to A during a turn: no cross-tab output.
10. Toggle the transport to exec: old behaviour returns, threads still resume.
11. Idle six minutes: the host exits and the next turn restarts it transparently.
12. Kill the host mid-turn: the turn settles failed with a truthful message and a
    working retry.
