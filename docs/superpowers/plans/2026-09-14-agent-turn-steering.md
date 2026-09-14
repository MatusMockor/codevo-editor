# Agent Turn Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user send further messages into a running local Claude Code turn; the message is written into the CLI's open stdin and rendered in the thread in order, the composer stays enabled and its primary control becomes Stop.

**Architecture:** The Rust supervisor retains the Claude child's stdin for the life of the turn behind a small `AgentTaskInput` seam, writes further `claude_user_frame` payloads on request, and closes the input once the stdout pump sees the `result` line. A new `steer_agent_task` IPC command carries prompt and attachments; the frontend admits a steer only for a running local Claude turn, appends a `userMessage` event on success and defers late messages to a bounded per-thread follow-up slot.

**Tech Stack:** Rust (std process, Tauri 2 commands), TypeScript (React 19, vitest), existing agent task IPC contract.

**Spec:** `docs/superpowers/specs/2026-09-14-agent-turn-steering-design.md` (sections 2 to 10). Read it first; the plan argues from it.

## Global Constraints

- No code comments; no `else`/`else if`; guard clauses; closed readonly contracts; `deny_unknown_fields` on every client-authored Rust struct; exhaustive `switch` with `never` checks in TS.
- Bounds (spec section 8): `MAX_AGENT_STEERS_PER_TURN = 32`, prompt `MAX_AGENT_PROMPT_BYTES = 32 KiB`, images `MAX_AGENT_TURN_IMAGE_BYTES = 40 MiB` per frame, write deadline `AGENT_STDIN_FRAME_DEADLINE = 30 s`, `MAX_DEFERRED_FOLLOW_UPS_PER_THREAD = 8`.
- Invariants INV-ORDER, INV-ONE-RESULT, INV-OWNER, INV-STOP, INV-BOUNDS (spec section 8) each get at least one test.
- Never hold the registry mutex across the stdin write. Never signal a process before its input is `ClosedByStop`.
- Codex exec turns never get an input (`take_input()` is `None`); a steer on them is `inputUnavailable`.
- Hotspot budget (`npm run size:hotspots`) must not be raised; `agent_task_supervisor.rs` (1749 lines) and `useAgentTurnDispatch.ts` (1019 lines) are already large: put new logic in new sibling modules where the task says so.
- Verification per task: focused tests while iterating, then the repository gates listed in CLAUDE.md before the slice is called done. Never `npm run build`.
- Commit messages: plain hyphens, no AI attribution.

---

## Stream S1: Rust input retention and steering (owner: one agent)

### Task 1: `AgentTaskInput` seam and retained Claude stdin

**Files:**
- Modify: `src-tauri/src/agent_task_spawner.rs` (`AgentChild` trait ~:523-536, `StdAgentChild` ~:684-688, `spawn` ~:551-601, `write_prompt_frame_on_a_dedicated_thread` ~:610-622)
- Create: `src-tauri/src/agent_task_input.rs` (new module registered from `lib_composition` the same way `agent_attachment_paths.rs` is; `lib.rs` is a hotspot, do not grow it)
- Test: `src-tauri/src/agent_task_spawner_tests.rs`, `src-tauri/src/agent_task_input_tests.rs` (new, `#[path]`-included like sibling test files)

**Interfaces:**
- Produces:
  ```rust
  pub trait AgentTaskInput: Send {
      fn write_frame(&mut self, frame: &[u8], deadline: std::time::Instant) -> std::io::Result<()>;
      fn close(&mut self);
  }
  pub struct StdAgentTaskInput { stdin: Option<std::process::ChildStdin> }
  pub enum AgentTaskInputState { Open, ClosedAfterResult, ClosedByStop, Detached }
  pub struct AgentTaskInputSlot { writer: Option<Box<dyn AgentTaskInput>>, state: AgentTaskInputState, frames_written: u32 }
  impl AgentTaskInputSlot {
      pub fn new(writer: Box<dyn AgentTaskInput>) -> Self;
      pub fn state(&self) -> AgentTaskInputState;
      pub fn write(&mut self, frame: &[u8], deadline: Instant, limit: u32) -> Result<(), AgentTaskSteerRejection>;
      pub fn close(&mut self, state: AgentTaskInputState);
  }
  #[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Clone, Copy)]
  #[serde(tag = "reason", rename_all = "camelCase", deny_unknown_fields)]
  pub enum AgentTaskSteerRejection { NotRegistered, NotRunning, NotSteerable, Stopping, InputClosed, InputUnavailable, LimitExceeded, WriteTimedOut, WriteFailed }
  pub const MAX_AGENT_STEERS_PER_TURN: u32 = 32;
  ```
  and on `AgentChild`: `fn take_input(&mut self) -> Option<Box<dyn AgentTaskInput>> { None }` (default), implemented by `StdAgentChild` to hand out the retained stdin once.
- The initial frame thread (`write_prompt_frame_on_a_dedicated_thread`) writes the first frame, then stores the `ChildStdin` back into a shared `Arc<Mutex<Option<ChildStdin>>>` owned by `StdAgentChild` instead of dropping it. `take_input()` wraps that shared slot so a steer that arrives before the first frame finished waits on the same mutex (INV-ORDER).

- [ ] **Step 1: Failing tests** in `agent_task_input_tests.rs`: `slot_writes_frames_in_order_and_counts_them` (fake writer records bytes), `slot_rejects_after_close_after_result` (`InputClosed`), `slot_rejects_after_close_by_stop` (`Stopping`), `slot_enforces_the_steer_limit` (33rd write → `LimitExceeded`), `slot_marks_detached_on_write_failure` (writer returns `Err` → `WriteFailed`, state `Detached`, later write `InputUnavailable`), `timed_out_write_is_write_timed_out` (writer returns `ErrorKind::TimedOut`).
- [ ] **Step 2: Run** `cargo test --lib agent_task_input` → compile failure.
- [ ] **Step 3: Implement** the module; move `write_prompt_frame_before` and its `poll` helper from the spawner into `StdAgentTaskInput::write_frame`.
- [ ] **Step 4:** In the spawner test file, change `a_claude_plan_pipes_its_frame_and_closes_stdin_so_the_child_exits` into `a_claude_plan_pipes_its_frame_and_keeps_stdin_open_until_the_input_closes`: after spawn, `take_input()` is `Some`, the child is still alive after the frame, and exits after `close()`. Add `a_codex_plan_has_no_input` asserting `take_input()` is `None`.
- [ ] **Step 5: Run** `cargo test --lib agent_task_spawner agent_task_input`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check`.
- [ ] **Step 6: Commit** `feat(agents): retain the Claude stdin behind an input seam`.

### Task 2: Registry steering, result detector, close on stop

**Files:**
- Modify: `src-tauri/src/agent_task_supervisor.rs` (`AgentTaskEntry` ~:525-540, `start_published` ~:775-865, `stop_owned` ~:902-922, `run_output_pump` ~:1179-1206, `run_watchdog` ~:1474-1503, `complete` ~:1540-1579)
- Create: `src-tauri/src/agent_task_result_detector.rs` (+ `agent_task_result_detector_tests.rs`)
- Test: `src-tauri/tests/agent_task_supervisor_tests.rs` (`FakeChild` ~:197-254 gains a recording input)

**Interfaces:**
- Produces:
  ```rust
  pub struct ResultLineDetector { at_line_start: bool, matched: usize }
  impl ResultLineDetector {
      pub const PREFIX: &'static [u8] = b"{\"type\":\"result\"";
      pub fn new() -> Self;
      pub fn feed(&mut self, chunk: &[u8]) -> bool;
  }
  impl AgentTaskRegistry {
      pub fn steer_for_workspace(&self, task_id: &str, workspace_id: &WorkspaceId, frame: Arc<[u8]>) -> Result<(), AgentTaskSteerRejection>;
      pub fn close_input_for_workspace(&self, task_id: &str, workspace_id: &WorkspaceId) -> Result<(), AgentTaskSteerRejection>;
  }
  ```
  `AgentTaskEntry.input: Option<Arc<Mutex<AgentTaskInputSlot>>>`.
- `feed` returns true exactly once per stream when `PREFIX` appears at a line start (start of stream or right after `\n`), across arbitrary chunk boundaries; it never allocates.
- `steer_for_workspace`: lock registry → checks (owner, `phase == Running`, `!stop_requested`, `!watchdog_timed_out`, input present) → clone `Arc` → unlock → `slot.write(frame, now + AGENT_STDIN_FRAME_DEADLINE, MAX_AGENT_STEERS_PER_TURN)`. On `WriteTimedOut | WriteFailed` call the existing stop path for the task after the write (INV-STOP through `ClosedByStop`).
- `stop_owned` and the watchdog call `slot.close(ClosedByStop)` before `escalate_stop`.
- `run_output_pump` for stdout, when the entry has an input, feeds the detector and on `true` calls `slot.close(ClosedAfterResult)`.

- [ ] **Step 1: Detector tests**: prefix at stream start; prefix after `\n` split across two chunks at every byte offset (loop 0..PREFIX.len()); prefix in the middle of a line is ignored; `{"type":"resultx"` is not a match (require the next byte to be `,` or `}`); returns true only once.
- [ ] **Step 2: Run** `cargo test --lib agent_task_result_detector` → fails; implement; passes.
- [ ] **Step 3: Supervisor integration tests** (`tests/agent_task_supervisor_tests.rs`): `steer_writes_the_frame_to_the_running_child`; `steer_after_result_line_is_input_closed` (fake stdout emits `{"type":"result",...}\n` then steer); `steer_on_stopped_task_is_stopping` and stop closes input before the signal (assert order via the recording child); `steer_with_foreign_workspace_is_not_registered`; `steer_on_child_without_input_is_input_unavailable`; `write_failure_detaches_and_stops_the_task` (turn settles `Stopped`); `close_input_for_workspace_is_idempotent`.
- [ ] **Step 4: Run** `cargo test --test agent_task_supervisor_tests`, `cargo test --lib agent_task_supervisor`, clippy, fmt.
- [ ] **Step 5: Commit** `feat(agents): steer a running task through its retained input`.

## Stream S2: IPC commands and TS gateway (owner: one agent, after S1)

### Task 3: `steer_agent_task` and `close_agent_task_input` commands

**Files:**
- Modify: `src-tauri/src/lib_composition/agent_task_commands.rs` (~:83-123 request structs, ~:221-258 attachment resolution, ~:428-537 facades), `src-tauri/src/lib_composition/runtime.rs` (invoke handler ~:530-541)
- Test: `src-tauri/src/lib_composition/agent_task_commands_tests.rs`

**Interfaces:**
- Produces:
  ```rust
  #[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
  pub struct SteerAgentTaskRequest { task_id: String, workspace_id: WorkspaceId, thread_id: String, prompt: String, #[serde(default)] attachments: Vec<StartAgentTaskAttachment> }
  #[tauri::command] pub(crate) async fn steer_agent_task(app: AppHandle, request: SteerAgentTaskRequest, state: AgentTaskRuntimeState<'_>) -> Result<(), AgentTaskSteerRejection>;
  #[tauri::command] pub(crate) fn close_agent_task_input(request: AgentTaskReferenceRequest, state: AgentTaskRuntimeState<'_>) -> Result<(), AgentTaskSteerRejection>;
  ```
  Command names on the wire: `steer_agent_task`, `close_agent_task_input`. Errors are the serialized `AgentTaskSteerRejection` object (`{ "reason": "inputClosed" }`), never a string.
- Phase 1 (`run_blocking_command`): `safe_agent_task_id`, `ensure_workspace_id_bounds`, prompt bound (`MAX_AGENT_PROMPT_BYTES`), read the task's metadata from the registry (add `AgentTaskRegistry::metadata_for_workspace(task_id, workspace_id) -> Option<AgentTaskMetadata>` in S1's file if missing; coordinate through the lead), claim attachments with `resolve_agent_task_attachments` under `AgentAttachmentOwner { workspace_id, thread_id, root_keys }`, `ensure_prompt_carries_attachment_lines`, build `claude_user_frame(prompt, images)`. Phase 2: `registry.steer_for_workspace`. On rejection retain exact-owner claims and staged bytes for draft/deferred retry, matching start semantics; do not broadly release a mixed claim batch.

- [ ] **Step 1: Tests**: request rejects unknown fields; oversized prompt rejected before touching the registry; a steer on an unknown task returns `{reason:"notRegistered"}` as JSON; exact-owner attachments retained on rejection and reusable on retry (use the existing in-memory store fixtures in the file); `close_agent_task_input` on unknown task `notRegistered`.
- [ ] **Step 2:** Implement, register in `runtime.rs`, run `cargo test --lib agent_task_commands`, clippy, fmt.
- [ ] **Step 3: Commit** `feat(agents): expose steering over the task IPC`.

### Task 4: TS domain contract and gateway

**Files:**
- Modify: `src/domain/agentTask.ts` (~:62-99), `src/infrastructure/tauriAgentTaskIpcContract.ts` (~:18-56, :121-130), `src/infrastructure/tauriAgentTaskGateway.ts` (~:39-88)
- Test: `src/domain/agentTask.test.ts`, `src/infrastructure/tauriAgentTaskIpcContract.test.ts`, `src/infrastructure/tauriAgentTaskGateway.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SteerAgentTaskRequest { readonly taskId: string; readonly workspaceId: string; readonly threadId: string; readonly prompt: string; readonly attachments?: ReadonlyArray<StartAgentTaskAttachment>; }
  export type AgentTaskSteerRejectionReason = "notRegistered" | "notRunning" | "notSteerable" | "stopping" | "inputClosed" | "inputUnavailable" | "limitExceeded" | "writeTimedOut" | "writeFailed";
  export interface AgentTaskSteerRejection { readonly reason: AgentTaskSteerRejectionReason; }
  export type AgentTaskSteerResult = { readonly kind: "accepted" } | { readonly kind: "rejected"; readonly rejection: AgentTaskSteerRejection };
  export function validateSteerAgentTaskRequest(request: SteerAgentTaskRequest): SteerAgentTaskRequest;
  export function parseAgentTaskSteerRejection(value: unknown): AgentTaskSteerRejection | null;
  export const MAX_AGENT_STEERS_PER_TURN = 32;
  // AgentTaskGateway
  steerAgentTask(request: SteerAgentTaskRequest): Promise<AgentTaskSteerResult>;
  closeAgentTaskInput(request: AgentTaskReferenceRequest): Promise<void>;
  ```
  Gateway: an invoke error that parses as a rejection becomes `{kind:"rejected"}`; anything else rethrows. `closeAgentTaskInput` swallows `inputClosed`/`notRunning`/`notRegistered` (idempotent close) and rethrows the rest.
- [ ] **Step 1: Tests**: command-name pin adds the two names; rejection decoder accepts every reason and rejects an unknown one; `validateSteerAgentTaskRequest` rejects a bad task id, an oversized prompt, unknown keys; gateway maps invoke errors as specified.
- [ ] **Step 2:** Implement; `npx vitest run src/domain/agentTask.test.ts src/infrastructure`; `npx tsc --noEmit`.
- [ ] **Step 3: Commit** `feat(agents): add the steering contract to the task gateway`.

## Stream S3: domain, wire and application (owner: one agent, in parallel with S1; codes against Task 4's types, adding them to `agentTask.ts` itself if S2 has not landed and telling the lead)

### Task 5: `userMessage` event, `turnSteered` action, wire round-trip

**Files:**
- Modify: `src/domain/agentThread.ts` (`AgentTurnEvent` ~:86-132, `AgentThreadsAction` ~:201-257, reducer ~:590-620), `src/domain/agentThreadWire.ts` (`parseTurnEvent` ~:668-731, `turnEventKind` ~:835-850, serializer)
- Test: `src/domain/agentThread.test.ts`, `src/domain/agentThreadWire.test.ts`

**Interfaces:**
- Produces:
  ```ts
  | { readonly kind: "userMessage"; readonly text: string; readonly attachments?: ReadonlyArray<AgentTurnAttachment> }
  | { readonly type: "turnSteered"; readonly threadId: string; readonly turnId: string; readonly event: Extract<AgentTurnEvent, { kind: "userMessage" }> }
  export function steerCount(turn: AgentTurn): number;
  ```
  Reducer: `turnSteered` appends to the running turn only when `turn.turnId` matches and the turn is non-terminal; it does not change `lastOutputSequence`; caps (`MAX_AGENT_EVENTS_PER_TURN`, `MAX_AGENT_EVENT_BYTES_PER_TURN`) apply and set `eventsTruncated` exactly as provider events do. Text bounded by `MAX_AGENT_EVENT_TEXT_BYTES`.
- [ ] **Step 1: Tests**: reducer appends in order between provider events; ignores a stale `turnId`; ignores a terminal turn; caps mark truncation; wire serialize/parse round-trips `userMessage` with and without attachments; unknown extra key rejected; a schema-1 fixture without the kind still parses; `steerCount` counts only `userMessage`.
- [ ] **Step 2:** Implement; `npx vitest run src/domain/agentThread.test.ts src/domain/agentThreadWire.test.ts`.
- [ ] **Step 3: Commit** `feat(agents): record steered user messages inside a turn`.

### Task 6: `admitSteer` and dispatch with deferred follow-ups

**Files:**
- Modify: `src/application/agentTurnAdmission.ts` (~:146-220), `src/application/agentThreadPorts.ts` (~:253-284), `src/application/useAgentTurnDispatch.ts` (~:155-190 refs, ~:224-267 status, ~:717-843 follow-up and stop)
- Create: `src/application/agentDeferredFollowUps.ts` (pure, bounded FIFO per thread) + test
- Test: `src/application/agentTurnAdmission.test.ts`, `src/application/useAgentTurnDispatch.test.tsx` (or the existing dispatch suite), `src/application/agentDeferredFollowUps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AgentSteerRequest { readonly threadId: string; readonly prompt: string; readonly attachments?: ReadonlyArray<AgentComposerAttachmentReference>; readonly attachmentOwner?: AgentAttachmentOwnerRef; }
  export interface AdmittedSteer { readonly thread: AgentThread; readonly turn: AgentTurn; readonly authority: AgentThreadAuthority; readonly prompt: string; }
  export function admitSteer(deps: AgentTurnAdmissionDependencies, request: AgentSteerRequest, inFlightThreads: ReadonlySet<string>): AdmittedSteer | null;
  export function agentThreadIsSteerable(thread: AgentThread): boolean; // running, local, launch.provider === "claudeCode"
  // agentDeferredFollowUps.ts
  export const MAX_DEFERRED_FOLLOW_UPS_PER_THREAD = 8;
  export interface DeferredFollowUp { readonly id: string; readonly request: AgentFollowUpRequest; readonly queuedAtEpochMs: number; }
  export type DeferredFollowUps = ReadonlyMap<string, ReadonlyArray<DeferredFollowUp>>;
  export function enqueueDeferred(map, threadId, entry): { map: DeferredFollowUps; accepted: boolean };
  export function takeDeferredHead(map, threadId): { map: DeferredFollowUps; head: DeferredFollowUp | null };
  export function removeDeferred(map, threadId, id): DeferredFollowUps;
  export function clearDeferred(map, threadId): DeferredFollowUps;
  // useAgentTurnDispatch return value
  steer(request: AgentSteerRequest): Promise<"sent" | "deferred" | "kept">;
  removeDeferredFollowUp(threadId: string, id: string): void;
  deferredFollowUps: DeferredFollowUps;
  ```
  `steer`: `admitSteer` → capture `{threadId, turnId, ownerId}` → `gateway.steerAgentTask({taskId: turn.turnId, workspaceId: ownerId, threadId, prompt, attachments})` → after the await revalidate `runningTurn(thread)?.turnId === turnId` and owner unchanged (drop silently with a notice otherwise) → dispatch `turnSteered`. Rejections: `inputClosed | notRunning | notSteerable` → `enqueueDeferred` (notice when full); `stopping | limitExceeded | inputUnavailable | writeTimedOut | writeFailed` → notice, prompt stays. `onTurnTerminal` → `takeDeferredHead` → `sendFollowUp(head.request)`. `stop` → `clearDeferred` + notice. When `sawResult` flips on a stream, call `gateway.closeAgentTaskInput` once (belt and braces).
- [ ] **Step 1: Tests**: admission matrix from the spec (running local Claude → admitted; Codex → null with today's notice from `admitFollowUp` untouched; server thread → null; archived → null; 32 steers already → null with notice; invalid prompt → null); dispatch success appends `turnSteered`; stale turn after await drops; `inputClosed` defers and head is sent on terminal, second one after the first settles; stop clears; deferred FIFO bounded at 8; `closeAgentTaskInput` called once per stream on result.
- [ ] **Step 2:** Implement; `npx vitest run src/application`; `npm run lint:exhaustive-deps` must not increase the budget.
- [ ] **Step 3: Commit** `feat(agents): steer running Claude turns and defer late messages`.

## Stream S4: composer and thread UI (owner: one agent, after S3 and S2)

### Task 7: Steer mode, Stop control, bubbles

**Files:**
- Modify: `src/components/agentMode/agentModePresentation.ts` (~:253-286), `useAgentComposerState.ts` (~:279-286, :328-390, :567-610, :710-728), `AgentComposer.tsx` (~:161-188, :394-410, :529-551, :607-611), `AgentTurnParts.tsx`, `agentThread.css`, `agentComposer.css`, `useAgentThreads.ts` (~:593-597 surface), `useUnifiedAgentThreads.ts` (~:494-495)
- Test: `AgentComposer.test.tsx`, `useAgentComposerState.test.tsx`, `agentModePresentation.test.ts`, `agentThreadTurns.test.tsx`, `agentThreadStyles.test.ts`, `cssBorderContract.test.ts`, `cssTokenContract.test.ts`

**Interfaces:**
- Consumes: `agentThreadIsSteerable`, `steer`, `deferredFollowUps`, `removeDeferredFollowUp`, `stop` from Task 6.
- Produces: `useComposerMode` returns `{ kind: "steer"; threadId }` when steerable; `agentFollowUpBlockedReason` returns `null` for steerable threads; `AgentComposer` prop `running: boolean` and `onStop(): void`; submit accessible name `"Send to running agent"`, placeholder `"Message the running agent"`; Stop button `aria-label="Stop agent"`, class `agent-composer__stop`, square icon (`Square` from lucide), tooltip `Stop (Esc)`; touch layout (`max-width: 600px`) renders both Stop and Send. Deferred bubbles: `.agent-prompt__bubble` + `.agent-prompt__chip--queued` with text `Queued` and a `Remove` button (`aria-label="Remove queued message"`). `AgentTurnParts` renders `userMessage` events with the existing prompt bubble renderer (attachments included).
- CSS contracts: zero borders, `outline` only under `:focus-visible`, colours from the `--agent-*` ladder, radii 8/10/12/14; keep `LEGACY_BORDER_RATCHET` unchanged.
- [ ] **Step 1: Tests**: composer enabled while running for a steerable thread; Enter submits a steer (calls `steer`, not `sendFollowUp`); Stop button rendered while running and calls `onStop`; not steerable (Codex) keeps the blocked notice and the arrow disabled; traits picker disabled in steer mode; `userMessage` renders as a prompt bubble in order; deferred entry renders with `Queued` and Remove calls `removeDeferredFollowUp`; style test pins the Stop control tokens; CSS contracts pass.
- [ ] **Step 2:** Implement; `npx vitest run src/components/agentMode src/components/cssBorderContract.test.ts src/components/cssTokenContract.test.ts`.
- [ ] **Step 3: Commit** `feat(agents): keep the composer open while a turn runs`.

## Integration decisions (2026-09-14)

- The app-server fallback is the same local bounded deferred FIFO, submitted as
  an ordinary follow-up only after terminal settlement. No already queued server
  turn is adopted. Stop and owner replacement cancel pending drains as well.
- Attachment refusal preserves exact-owner references for retries. A broad
  release is unsafe for mixed existing/new claims and differs from task start.
- Result close prevents new writes, but cannot undo bytes from a writer already
  in flight. The spec records this residual race; never automatically replay a
  successfully delivered message.
- The frame cap budgets encoded base64, not just raw images:
  `ceil(40 MiB / 3) * 4 + 32 KiB * 6 + 64 KiB`. The raw image cap stays 40 MiB.
- Steps remain unchecked until integrated gates and live QA are verified by the
  lead. A focused test result is not completion of the whole plan.


Current verification is complete as recorded below and in the handoff: all
applicable automated gates passed, including the last fallback repair. Native
fallback/next-turn and six-minute idle/restart checks passed. Actual provider
update could not be exercised because the installed version was current;
automated eligibility coverage is not a live update test.

## Completion

- Independent read-only review (different model) per stream before commit; lead runs the full gates from CLAUDE.md; manual run: three-step sleeping Claude turn, one steer mid-run, confirm a single `result`, the bubble order, no leaked `claude` process (`pgrep -fl claude`), and that a steer sent after `result` appears as Queued and runs as the next turn.

### Final verification record (2026-09-14)

The implementation and independent reviews are complete in the uncommitted tree.
All applicable repository gates passed after the last fallback repair; final native
steer/resume, persistence, Stop, shutdown, read-only, project isolation, exec resume,
host failure, idle restart, and rollout-loss follow-up checks passed as recorded in
`2026-09-14-steering-handoff.md`. A real CLI upgrade was unavailable because the
installed version was current. Historical commit steps above remain unchecked: no
commit, push, or release was performed.
