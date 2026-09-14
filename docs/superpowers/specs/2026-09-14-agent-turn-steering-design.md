# Agent turn steering: send while the agent is running

Date: 2026-09-14 · Status: implementation under integration validation · Base: `main` @ 512605c4

## 0. Why

Today a follow-up sent while a turn runs is refused twice: the composer shows
"This thread is still running. Wait for the turn to finish."
(`agentModePresentation.ts:263`) and `admitFollowUp` rejects it again
(`agentTurnAdmission.ts:171`). T3 Code never blocks the composer: a message sent
during a turn is committed immediately and injected into the running turn
("steer"), Send turns into Stop, and the message renders as an ordinary user
bubble. Nothing waits for the turn to end.

Measured on this machine (2026-09-14):

- Claude Code 2.1.270 in `-p --input-format stream-json` mode consumes a second
  `{"type":"user"}` frame written mid-turn inside the same turn: the frame sent at
  7.0 s during a `sleep 4` tool call was answered right after that tool result,
  the run ended with exactly one `result` line (`num_turns: 2`), and the process
  then idled until stdin was closed and exited within a second.
- Codex app-server 0.154 exposes `turn/steer` (`threadId`, `expectedTurnId`,
  `input`, `clientUserMessageId`; response `turnId`), queues a `turn/start` sent
  during an active turn and announces it with `thread/queue/changed`, and rejects
  both with `activeTurnNotSteerable` while `/review` or `/compact` runs.

Codevo drops the Claude stdin handle right after the first frame
(`agent_task_spawner.rs:599-620`), so the process cannot be steered, and Codex
runs through `codex exec`, which has no input channel at all.

## 1. Scope

In scope, in delivery order:

1. **Claude steering, local threads.** Keep stdin open for the life of the turn,
   write further user frames into it, close it deterministically after `result`.
   Composer stays enabled while a turn runs; Enter sends a steer; the primary
   button becomes Stop.
2. **Codex steering through app-server.** Delivered by the app-server migration
   (`2026-09-09-codex-app-server-transport.md`, section 12 added by this spec):
   `turn/steer` first. When the active turn is not steerable, retain the message
   in the local bounded deferred FIFO and call ordinary `turn/start` only after
   the current turn is terminal. No already queued server turn is adopted.
3. **Remote runner.** The runner is a separate repository
   (`MatusMockor/codevo-runner`; this repo only holds the client under
   `src-tauri/src/remote_runner/`), and `continueTask` creates a child task only
   after the current one is terminal. Steering a server thread needs a runner
   endpoint (`POST /v1/tasks/{id}/steer`) plus a client outbox. That is its own
   spec after 1 and 2 land. Until then server threads keep today's block.

Out of scope: a visible multi-message queue with reorder or edit (T3 web has
none), steering `codex exec` (impossible, no stdin), changing what a turn is
(one process or one app-server turn stays one `AgentTurn`).

## 2. Semantics

- A steer is a user message appended to the **running turn**, not a new turn. The
  turn keeps its `turnId`, its task id and its output sequence. The intended
  lifecycle ends at the CLI result; the already-writing race below is an
  explicit limitation of that guarantee.
- Writes serialize behind the input owner and are time-boxed. A successful
  steer writes a complete frame. A failed write can have sent a partial frame;
  the input is then detached and the task stopped rather than replaying bytes.
- Attachments on a steer follow the same rules as on a start: claimed for the
  thread with the same owner authority, image bytes inlined for Claude, path
  lines injected into the prompt text, limits from the attachment spec.
- Once the result detector closes the input, new writes are rejected
  (`inputClosed`) and become deferred follow-ups (section 6). A write that
  already acquired the writer can race the result line. Closing cannot retract
  bytes already delivered: that race can start another CLI turn in the same
  process. A complete write is reported as delivered, never automatically
  retried; this is a residual protocol limitation requiring live QA.
- Stop (`stop_agent_task`) applies to the whole turn; steers already written are
  part of it and die with it. A steer never resurrects a stopping task.
- A steer never changes launch options; the launch of the running turn is the
  launch. The composer's traits picker is read-only for the steer text field
  while a turn runs (changing traits still applies to the next turn).

## 3. Rust: input retention and steering

### 3.1 Spawner (`agent_task_spawner.rs`)

- `AgentChild` gains `fn take_input(&mut self) -> Option<Box<dyn AgentTaskInput>>`.
  `AgentTaskInput: Send` has `fn write_frame(&mut self, frame: &[u8], deadline: Instant) -> io::Result<()>`
  and `fn close(&mut self)`. `StdAgentChild` implements it with the retained
  `ChildStdin`; the existing non-blocking `write_prompt_frame_before` (:625-671)
  becomes its `write_frame`. `FakeChild` in the supervisor tests records frames.
- The initial Claude frame is still written on the dedicated thread with
  `AGENT_STDIN_FRAME_DEADLINE`, but the thread hands the handle back into the
  child's input slot instead of dropping it. Codex exec keeps `Stdio::null()` and
  `take_input()` returns `None`.
- `claude_user_frame(prompt, images)` (:378-402) is reused unchanged for steer
  frames.

### 3.2 Supervisor (`agent_task_supervisor.rs`)

- `AgentTaskEntry` gains `input: Option<Arc<Mutex<TaskInputState>>>` where
  `TaskInputState { writer: Option<Box<dyn AgentTaskInput>>, state: InputState }`,
  `InputState = Open | ClosedAfterResult | ClosedByStop | Detached`. Set in
  `start_published` next to `group` (:822).
- New `AgentTaskRegistry::steer_for_workspace(task_id, workspace_id, frame: Arc<[u8]>) -> Result<(), AgentTaskSteerRejection>`.
  Under the registry lock it copies the `stop_owned` checks (:903-916): owner
  match, `phase == Running`, `!stop_requested`, `!watchdog_timed_out`, input
  state `Open`. It clones the `Arc` and releases the registry lock before the
  write. The write takes only the input mutex, never the registry mutex, and
  is bounded by `AGENT_STDIN_FRAME_DEADLINE`. `MAX_AGENT_STEERS_PER_TURN = 32`
  and the encoded `MAX_AGENT_STEER_FRAME_BYTES` cap are enforced before
  touching the child. The cap is `ceil(40 MiB / 3) * 4 + 32 KiB * 6 + 64 KiB`: raw
  images retain their 40 MiB cap, base64 expansion is budgeted separately, and
  the remaining allowance covers worst-case prompt JSON escaping and framing.
- `AgentTaskSteerRejection` is a closed enum serialized with `tag = "reason"`:
  `notRegistered`, `notRunning`, `notSteerable`, `stopping`, `inputClosed`, `inputUnavailable`
  (Codex exec or detached), `limitExceeded`, `writeTimedOut`, `writeFailed`.
  Only `writeTimedOut` and `writeFailed` mark the input `Detached` and request a
  stop of the task, because a half-written frame corrupts the stream.
- **Closing after `result`.** The stdout pump (`run_output_pump`, :1179-1206) is
  byte-oriented. For tasks with a retained input it gains a `ResultLineDetector`:
  a bounded scanner that tracks line starts across chunks and matches the exact
  prefix `{"type":"result"` at a line start (Claude serializes `type` first;
  every fixture under `src/domain/agentOutput/fixtures/claude-*.jsonl` and the
  measured runs do). On a match it transitions the input to `ClosedAfterResult`
  and drops the writer, so the CLI reaches EOF and exits, and the existing
  waiter turns that into `Exited`. The detector keeps at most 32 bytes of
  pending prefix; it never buffers lines.
- Belt and braces: a new command `close_agent_task_input(task_id, workspace_id)`
  lets the frontend close the input when its parser sees `result`. Both paths
  are idempotent; whichever runs first wins.
- Stop and watchdog close the input (`ClosedByStop`) before signalling, so a
  steer racing a stop is rejected rather than written into a dying process.
- `complete()` drops the input with the admission and group.

### 3.3 Commands (`lib_composition/agent_task_commands.rs`)

- `SteerAgentTaskRequest { task_id, workspace_id, thread_id, prompt, attachments: Vec<StartAgentTaskAttachment> }`,
  `deny_unknown_fields`, same bounds as `StartAgentTaskRequest` (prompt 32 KiB,
  attachments per the attachment spec).
- `steer_agent_task` is a two-phase facade like `start_agent_task`: phase 1 in
  `run_blocking_command` resolves the task's metadata from the registry (owner,
  cwd, repository root), claims attachments with `resolve_agent_task_attachments`
  under that owner, checks `ensure_prompt_carries_attachment_lines`, builds the
  frame with `claude_user_frame`; phase 2 revalidates the owner and calls
  `steer_for_workspace`. Refusal retains attachments under the exact existing
  owner, matching task start semantics, so a kept draft or deferred follow-up
  can retry the same references. Refusal never broadly releases or deletes
  staged bytes: a batch can mix existing thread claims with new attachments.
  Task, workspace, thread and descriptor authority are checked before claims
  and again before the final write.
- `close_agent_task_input` is a thin facade over the registry.
- Registered in `runtime.rs` next to `stop_agent_task`.

## 4. IPC contract (TS)

- `src/domain/agentTask.ts`: `SteerAgentTaskRequest`, `AgentTaskSteerRejection`
  (closed union mirroring Rust), `validateSteerAgentTaskRequest`, and
  `AgentTaskGateway.steerAgentTask` / `closeAgentTaskInput`.
- `tauriAgentTaskIpcContract.ts` pins the two new command names and decodes the
  rejection as a typed error (never a bare string), with tests in
  `tauriAgentTaskIpcContract.test.ts` and a Rust round-trip in
  `agent_task_commands_tests.rs`.

## 5. Domain and persistence

- New `AgentTurnEvent` variant
  `{ kind: "userMessage"; text: string; attachments?: ReadonlyArray<AgentTurnAttachment> }`
  bounded by `MAX_AGENT_EVENT_TEXT_BYTES`. It is client-originated: it is
  appended when the steer IPC succeeds, so the message is visible in the exact
  position between the assistant output that preceded it and what follows.
- `AgentThreadsAction` gains `turnSteered { threadId, turnId, event }`. The
  reducer appends without touching `lastOutputSequence` (the existing
  `turnEventsAppended` guard on stale sequence stays for provider output).
  Per-turn caps apply; a steer that would exceed `MAX_AGENT_EVENTS_PER_TURN` is
  rejected before the IPC call.
- `agentThreadWire.ts` adds `userMessage` to the kind whitelist and `exactKeys`.
  Schema version stays 1; this is the same downgrade posture as attachments
  (an older build fails closed on a thread containing a steer) and is recorded
  in the known gaps of the attachments spec.
- `agentTurnOutputStream.ts`: unchanged; `sawResult` already exists and now also
  triggers `closeAgentTaskInput` (belt and braces) from `useAgentTurnDispatch`.

## 6. Application: admission and dispatch

- `agentTurnAdmission.ts`: new `admitSteer(deps, request, inFlightThreads)`.
  Conditions: thread exists, not archived, `runningTurn(thread)` is non-null
  **and** it is Claude or a Codex turn with captured `codexTransport === "appServer"`
  **and** the thread is local
  (not a server thread), prompt valid (`admitPrompt`), attachments owner matches
  the thread owner, steer count under `MAX_AGENT_STEERS_PER_TURN`. It returns
  `{ thread, turn, authority, prompt }`. `admitFollowUp` keeps its running block
  for the cases `admitSteer` does not cover (Codex exec until app-server lands,
  server threads until the runner spec lands), so those keep today's notice.
- `useAgentTurnDispatch.ts`: `steer(request)` captures authority, calls
  `gateway.steerAgentTask`, revalidates the thread still runs the same
  `turnId` after the await, then dispatches `turnSteered`. On rejection:
  - `inputClosed`, `notRunning` or `notSteerable`: the message goes into a **deferred follow-up
    slot** for that thread (`deferredFollowUpsRef: Map<threadId, AgentFollowUpRequest[]>`,
    bounded 8 per thread and 64 threads, FIFO; overflow keeps the draft rather
    than evicting another thread). Pending turns are refused before IPC. When
    the turn settles (`onTurnTerminal`), the head is
    dispatched through the existing `sendFollowUp`; a late rejection received
    after terminal settlement arms the same drain. Each subsequent one goes out
    when its predecessor settles. The composer renders deferred messages as user
    bubbles below the running turn with a small "Queued" chip and an "Remove"
    control; Stop on the thread clears the slot with a notice. This slot is not
    persisted: an app restart drops it. Stop and project release also cancel
    an already draining follow-up across attachment preparation and launch.
    Failed deferred submission clears the remaining FIFO with a notice; stale
    owner replies cannot enqueue or publish into a replacement workspace.
  - `stopping`, `limitExceeded`, `inputUnavailable`: notice, message stays in the
    composer.
  - `writeTimedOut`, `writeFailed`: notice, the task is being stopped by Rust,
    message stays in the composer.
- `stop(threadId)` also clears the deferred slot.
- Dangerous-launch confirmation is not re-asked for a steer (the running turn
  already carries the confirmed launch).

## 7. Composer and thread UI

- `agentFollowUpBlockedReason` no longer returns the running notice for local
  Claude threads; `useComposerMode` yields a new `mode.kind === "steer"` when
  the thread is running and steerable, with placeholder "Message the running
  agent" and accessible submit name "Send to running agent".
- Primary action while running: the arrow button is replaced by a **Stop**
  button (square icon, `aria-label="Stop agent"`, calls `agents.stop`). Enter and
  Cmd/Ctrl+Enter submit the steer, exactly like T3 desktop. When the prompt
  field is non-empty the Stop button keeps its place and the send affordance is
  the keyboard; a tooltip on Stop names the shortcut. On touch-width layouts
  (<600 px) both Stop and Send render, as T3 does.
- Back-pressure: at most one steer in flight per thread (`dispatching` state);
  a second Enter while one is in flight is ignored with the existing spinner.
- Thread rendering: `AgentTurnParts` renders `userMessage` events with the same
  bubble as the turn prompt (`.agent-prompt__bubble`), including the attachment
  chips and lightbox behaviour from the attachments spec. Deferred follow-ups
  render below the last turn with the "Queued" chip.
- The traits picker is disabled (not hidden) while composing a steer, with the
  running turn's traits shown.

## 8. Failure modes and invariants

- INV-ORDER: the initial prompt completes before a steer can write; complete
  frames serialize on the input owner without interleaving their bytes.
- INV-RESULT-CLOSE: no new writer is admitted after `ClosedAfterResult`. A
  writer already in flight may have delivered bytes before close, so one
  result per process cannot be guaranteed in that narrow race (section 2).
- INV-OWNER: every steer revalidates `workspace_id` against the task metadata
  inside the registry lock and again after every await in the frontend
  (thread, running turn id, owner id).
- INV-STOP: a stop or watchdog moves the input to `ClosedByStop` before any
  signal; a steer after that is `stopping`.
- INV-BOUNDS: 32 steers per turn, 32 KiB prompt, 40 MiB inline images per frame,
  30 s per write, 8 deferred follow-ups per thread.
- Half-written frame: `writeFailed`/`writeTimedOut` detaches the input and
  requests a stop; the turn settles as Stopped with a notice naming the cause.
  A resumed follow-up then continues from the CLI's persisted session.
- Process exits before the frame is written (crash): `notRunning` from the
  registry, message deferred, turn settles through the normal waiter path.
- Workspace A → B → A: the steer carries the owner id captured at admission;
  the registry rejects a mismatch with `notRegistered`.

## 9. Streams (disjoint ownership)

| #   | Stream                  | Owns                                                                                                                                                                       | Validation                                                                                                   |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| S1  | Rust input + supervisor | `agent_task_spawner.rs`, `agent_task_supervisor.rs`, their tests, `tests/agent_task_supervisor_tests.rs`                                                                   | `cargo test --lib agent_task_spawner agent_task_supervisor`, `cargo test --test agent_task_supervisor_tests` |
| S2  | Rust commands + IPC     | `lib_composition/agent_task_commands.rs` + tests, `runtime.rs` registration, `src/domain/agentTask.ts`, `tauriAgentTaskIpcContract.ts`, `tauriAgentTaskGateway.ts` + tests | `cargo test --lib agent_task_commands`, `npm test -- --run src/infrastructure src/domain/agentTask`          |
| S3  | Domain + application    | `agentThread.ts`, `agentThreadWire.ts`, `agentTurnAdmission.ts`, `useAgentTurnDispatch.ts`, `agentThreadPorts.ts` + tests                                                  | `npm test -- --run src/domain/agentThread src/application`                                                   |
| S4  | UI                      | `AgentComposer.tsx`, `useAgentComposerState.ts`, `agentModePresentation.ts`, `AgentTurnParts.tsx`, `agentThread.css`, `agentComposer.css` + tests                          | `npm test -- --run src/components/agentMode`                                                                 |

Ordering: S1 and S3 in parallel (S3 codes against the IPC types agreed in
section 4 with a fake gateway), then S2 (needs S1's registry API), then S4.
S1 must not run concurrently with any app-server stream that touches the
supervisor (stream C of the app-server spec); app-server streams A, B, D, E
may run alongside S1 to S4 because they own new files.

## 10. Test plan

Rust: frame written while running and observed by the fake child; steer after
`ClosedAfterResult` rejected; detector matches the prefix across a chunk
boundary and never matches mid-line; detector ignores `{"type":"result"` inside
a longer line; stop closes input before signal; owner mismatch rejected; limit
32 rejected; write timeout detaches and stops; Codex exec `inputUnavailable`;
commands round-trip every rejection tag; exact-owner attachments survive
refusal and retry without duplication or cross-thread claims.

TS: admission matrix (running Claude local → admitted; Codex exec → today's
notice; server thread → today's notice; archived → rejected; limit); dispatch
revalidates turn id after await; `inputClosed` defers and the deferred head is
sent on terminal; stop clears deferred; wire round-trip of `userMessage`;
reducer appends without moving `lastOutputSequence`; composer renders Stop while
running and submits a steer on Enter; touch layout renders both buttons;
`AgentTurnParts` renders the bubble in order.

Full gates before completion per CLAUDE.md, then a real run: start a Claude
turn that sleeps in three steps, steer it, confirm one `result`, no leaked
process, and the bubble order in the thread.
