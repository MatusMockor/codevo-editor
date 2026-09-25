# Persistent Claude Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Background shells, `nohup` processes and subagents that a Claude turn starts keep running after the turn ends. Stop still ends everything when the user really means it.

**Architecture:** The plan has three fixes, and each one ships on its own:

1. **Fix 1 - gentle Stop (frontend only).** A pure domain stop policy plus an application stop controller. When the foreground has settled but background work is live, the first Esc/Stop asks for confirmation. The second press hard-stops.
2. **Fix 2 - clean-exit grace (Rust only).** When the process group exits on its own, it gets a bounded SIGTERM grace before the final SIGKILL. This lives in a process-group module extracted from the supervisor.
3. **Fix 3 - persistent session (Rust and frontend).** One long-lived `claude -p --input-format stream-json` process per thread, owned by a `ClaudeThreadSession` in a `ClaudeSessionRegistry`. Each turn is still one supervisor task with its own task id. That task sees a `SharedSession` child (the same seam Codex app-server turns already use), so turn settlement no longer closes stdin or signals the group. The process group belongs to the session. The session is reaped only on:
   - explicit hard Stop,
   - thread archive or delete,
   - workspace release or dispose,
   - worktree removal,
   - app exit,
   - registry Drop,
   - panic,
   - idle TTL,
   - cap eviction,
   - provider update,
   - a restart that the user confirmed.

**Tech Stack:** Rust (Tauri 2, std threads, libc process groups), TypeScript/React 19, Vitest, `cargo test`.

**Spec:** The problem statement is the verified investigation in "Background: current code map" below. It argues from `CLAUDE.md` (layering, workspace/async isolation, Rust backend rules, boundedness, testing). It also argues from `docs/superpowers/plans/2026-09-18-claude-background-lifecycle.md`, the existing background-lifecycle contract this plan extends. Reference implementation: t3code `apps/server/src/provider/Layers/ClaudeAdapter.ts` (long-lived query per thread, prompt queue at :4428, send-turn at :5272, `interruptTurn` = hard session stop at :5289) and `ProviderSessionReaper.ts` (30 min idle reaper that skips threads with live background work).

## Global Constraints

- Dependencies point inward: domain (pure) ← application (hooks and coordinators, ports only) ← infrastructure/IPC adapters ← composition roots (`App.tsx`, `useWorkbenchController.ts`, `src-tauri/src/lib.rs`, `lib_composition/runtime.rs`).
- Never execute user-derived shell strings. Every process is a typed, no-shell `AgentTaskSpawnPlan`.
- Signal a process group only while its leader is unreaped (the identity anchor). The single reaper sets a `reaping` flag under the same lock that every signal sender takes.
- Never hold a registry-wide mutex across process, filesystem, channel-send or callback work. Per-session locks may wrap a single non-blocking `kill(2)` or `proc_listpids` call only.
- Bounds and limits:
  - Live sessions: `MAX_LIVE_CLAUDE_SESSIONS = 8`.
  - Idle TTL: `30 min`.
  - Idle TTL with live detached group members: `12 h` (equals `AGENT_TASK_MAX_RUNTIME`).
  - Interrupt settle deadline: `10 s`.
  - Clean-exit grace: `2 s`.
  - Graceful then forced stop: `500 ms` + `500 ms`.
  - Turn output channel: `64` chunks of at most `8 KiB`.
  - Routed stdout line: `1 MiB`.
- Every late, duplicate, foreign, reordered or stale event fails closed. A session is reusable only for the exact `(workspace_id, thread_id)` key, the same generation, the same fingerprint (executable identity, provider generation, launch, argv without `--resume`, env, cwd and cwd inode) and the same conversation id.
- IPC contracts are closed: `deny_unknown_fields` in Rust, exact or bounded keys in TypeScript. The Rust and TypeScript sides are tested against the same JSON.
- No code comments (user rule) except tool-required annotations. No `else`/`else if` in new code where a guard clause fits (user rule; existing style is kept in hunks).
- Hotspot limits: 2000 lines and 10000 structural tokens per production file (`npm run size:hotspots`). `agent_task_supervisor.rs` is at 9779/10000, so it may only shrink or grow by a few tokens after Task 2.1.
- Never run `coderabbit`. Review goes to a read-only AI subagent. Subagents are read-only for git: the lead does every git operation.
- Commits go to `main` and carry no AI attribution. Commit only after the owner authorizes the slice. Never push or tag.
- Preserve the current dirty worktree: the redesign files in `git status`. None of them is owned by this plan, and none may be reformatted or reset.

## Review Focus

These are the five inputs most likely to hurt a user that the spec implies but that happy-path tests miss. Each has a pinning test in the owning task.

1. **A `nohup`/`&` background process started in turn 1 must still be alive after turn 1's terminal status, and turn 2 must run in the same CLI process.** Pinned by `background_process_survives_turn_end_and_next_turn_reuses_the_process` (Task 3.7).
2. **Esc pressed twice with a stale arm.** An arm left from a previous turn (or after the 10 s window) must not hard-stop a new turn. A second press within the window must. Pinned by `a stale arm from a previous turn never hard-stops a new turn` (Task 1.1) and `second press within the window hard-stops` (Task 1.2).
3. **Workspace A → B → A with the same thread id must never reuse A's first process.** Pinned by `workspace_a_b_a_never_reuses_a_foreign_owner_session` (Task 3.6).
4. **The CLI crashes while idle between turns.** The next turn must respawn with `--resume`, and the ended event must say `crashed`. Pinned by `idle_crash_is_reported_and_the_next_turn_respawns` (Task 3.6) and `a_crash_mid_turn_fails_only_that_turn_and_the_next_turn_respawns` (Task 3.7).
5. **A model/effort/mode change while background processes are live must not silently kill them.** The backend refuses without confirmation (TOCTOU guard). The frontend asks first. Pinned by `launch_change_refuses_without_confirmation_and_restarts_with_it` (Task 3.6) and `asks before a restart that would stop background processes, then sends with consent` (Task 3.12).

---

## Background: current code map (verified)

**Spawn (`src-tauri/src/agent_task_spawner.rs`)**
- `try_agent_invocation_args` (:494-525) builds `claude -p --output-format stream-json --verbose --permission-prompt-tool stdio --input-format stream-json --append-system-prompt ... [model/mode/effort/settings] [--resume <id>]`. For Claude the prompt is a stdin user frame (`claude_user_frame`, :425).
- `StdAgentProcessSpawner::spawn` (:653-726) spawns the process with `process_group(0)` (:688). It writes the uuid-tagged first frame on a dedicated thread and returns `StdAgentChild`.
- `force_kill` does `kill(-pgid, SIGKILL)` (:815-823).
- Codex app-server turns bypass this through `plan.app_server` (:654) and return a `SharedSession` child.

**Supervisor (`src-tauri/src/agent_task_supervisor.rs`, 1666 lines, 9779 tokens)**
- `AgentTaskRegistry::start` (:804) publishes an entry, and `start_published` (:853) spawns. Per task it runs 2 output pumps, a watchdog and a waiter.
- `run_output_pump` (:1259) feeds `close_input_after_result` (`agent_task_steering.rs:201-212`). After a settled root `result`, the stdin input is closed.
- `run_waiter_inner` (:1521) observes the exit, drains the pumps, then `group.reap(child)` (:1593). `AgentProcessGroup::reap` (:390) first runs `force_stop_after_observed_exit` (:348-381), which SIGKILLs the whole group on every exit path, including a clean exit.
- `complete()` (`agent_task_completion.rs`) releases the admission and the `ProviderTurnLease`, and calls `before_completion` (change capture) only when the group is reaped (:13).

**Settlement (`agent_task_result_detector.rs`)**
- `ResultLineDetector` settles when a root `result` arrives and no native background task (`task_started` without a terminal update) is live, and the `ClaudeInputLifecycle` (`agent_claude_input_lifecycle.rs`) has no pending steer.
- A failed result settles immediately (:121).

**Stop**
- `stop_owned` (:1030) → `escalate_group_stop` (`agent_task_stop_escalation.rs:53`): SIGTERM, 500 ms, SIGKILL.
- Frontend: Esc in `AgentComposer.tsx:555-560` and the Stop button both call `requestStop` (`useAgentComposerState.ts:358`), then `useAgentTurnDispatch.stop` (:838), then `stop_agent_task`. There is no confirmation and no interrupt anywhere; the Rust side never writes an outgoing `control_request`.

**Frontend turn model**
- `taskId == turnId` (`agentTurnStartRunner.ts:186-202`). A turn is running until its task status is terminal (`runningTurn`, `agentThread.ts:472`).
- A follow-up after settlement starts a new task with `resumeSessionId` (`useAgentTurnDispatch.sendFollowUp` :677-832).
- Steering targets the running task (`useAgentTurnSteer.ts:382`).
- The background banner (`AgentBackgroundWorkBanner.tsx`) is derived by `projectAgentBackgroundState`.

**Consequence**
Anything in the CLI's process group dies at turn end: `sh -c 'x &'`, `nohup`, and native background tasks once they finish. Esc during a background-only phase also kills everything.

**Installed CLI (2.1.281)**
The binary contains control subtypes `interrupt`, `set_model`, `set_permission_mode`, `set_max_thinking_tokens`, `end_session`, `apply_flag_settings`, and the system subtype `background_tasks_changed`. Task 3.0 verifies the behaviour against the real CLI before Fix 3 starts.

## Key design decisions

- **D1 (Fix 1: confirmation, not interrupt).**
  - Fix 1 uses confirmation, not `interrupt`, for "foreground settled + background live".
  - Why: once the foreground has settled there is no foreground query to interrupt. t3code documents that `interrupt()` can acknowledge while background tasks keep the CLI alive, and it treats Stop as a hard session boundary.
  - So the first press arms a 10 s confirmation. The second press (or "Stop everything") hard-stops.
  - The background banner's own button is already an explicit "stop background work" action, so it hard-stops directly.
- **D2 (Fix 2: grace only on an unrequested exit).**
  - The grace applies only when the leader exited on its own. Explicit stop, watchdog, reader fault and waiter failure keep today's immediate kill.
  - The grace ends early when `proc_listpids(PROC_PGRP_ONLY)` shows only the zombie leader (macOS). It waits the full bounded grace when membership is unknown (other Unix).
  - The final SIGKILL is always sent.
- **D3 (Fix 3: the turn stays a supervisor task).**
  - Each turn stays a supervisor task with its own id. Admission, the provider turn lease, the watchdog, the change capture, ordered output and the frontend turn model are all unchanged.
  - The only difference is the `AgentChild`: `ClaudeSessionTurnChild` reports `SharedSession` ownership, so the supervisor never signals an OS group for a turn.
    - "Exit" means the turn settled.
    - `force_kill` means hard-stop the session.
  - This reuses a seam that is already proven by Codex app-server turns.
- **D4 (settlement semantics unchanged).**
  - A turn still settles only when the root result has arrived, no native background task is live and no accepted steer is pending (existing `ResultLineDetector` contract).
  - In session mode a failed or interrupted result does not settle while native tasks are live (`ResultSettlePolicy::AwaitBackgroundWork`). An idle session therefore never owns live native tasks.
  - Untracked group members (`nohup`, `&`) are what survive between turns.
- **D5 (the session owns settlement).**
  - The session's single stdout reader thread routes bytes to the attached turn and owns the only detector, parsing each line once.
  - The supervisor pump skips its own detector for inputs where `provider_owns_settlement()` is true, so the lifecycle is never observed twice.
- **D6 (idle output fails closed).**
  - Idle root activity is anything other than `system/init`, keep-alives and control responses: `assistant`, `user`, `result`, `stream_event`, `control_request` and task starts.
  - It means a CLI-initiated turn Codevo cannot own, so the session ends with reason `unownedActivity`.
  - Surfacing CLI-initiated wake-ups is out of scope.
- **D7 (Stop in Fix 3).**
  - First press while the foreground is running: send `{"type":"control_request","request_id":<uuid>,"request":{"subtype":"interrupt"}}`.
    - The session keeps running, and so do the background processes.
    - The turn settles as `stopped` when the interrupted result arrives.
    - If it has not settled within 10 s, the session kills itself (`interruptTimedOut`).
  - Second press, or a press on a turn that is already interrupting: hard stop, which kills the session group, background included.
  - Foreground settled + background live: Fix 1 confirmation.
  - Codex, remote and legacy turns get `unsupported`, and the frontend falls back to a hard stop.
- **D8 (restart on change).**
  - Any fingerprint or conversation difference restarts the session, killing the old group and spawning with `--resume`.
  - If background processes are live, the backend refuses unless the start carries `sessionRestart: "stopBackground"` (error prefix `sessionRestartRequiresConfirmation:`).
  - The frontend preflights with `inspect_agent_thread_session` and asks first.
  - In-place `set_model`/`set_permission_mode` control requests are an explicit follow-up, not in this plan.
- **D9 (capacity and eviction).**
  - Cap 8 live sessions. When full, evict the idle session with no background members first, then least recently active, then lowest generation.
  - If every session is attached to a running turn, the new turn runs **ephemeral**: the unchanged legacy per-turn path, which gets Fix 2 grace. Nothing fails because of the cap.
- **D10 (truthful reporting).** Every session end emits `agent-session://ended {workspaceId, threadId, reason, backgroundProcessesStopped}`. The frontend shows a notice when background processes were stopped by anything other than the user's own Stop or End.
- **D11 (Codex is out of scope).**
  - Codex app-server hosts are already long-lived and shared per repository, and turn end only interrupts and unsubscribes (`codex_app_server_turn.rs:530-558`, `codex_app_server_host.rs:1099-1217`). The per-turn kill does not apply.
  - Codex `exec` transport stays per-process and is out of scope.
  - Residual risk: an idle Codex host retirement (300 s) still kills that host's group.
- **D12 (runner is out of scope).** The remote runner has its own lifecycle and is not in this repository. Remote threads keep today's behaviour and never see the new commands.

## File Structure

### Fix 1 (TypeScript)

| File | Action | Responsibility |
|---|---|---|
| `src/domain/agentStopPolicy.ts` | Create | Pure stop decision: ignore / hardStop / confirmBackground (Fix 3 adds interrupt) |
| `src/domain/agentStopPolicy.test.ts` | Create | Policy tests |
| `src/application/useAgentStopController.ts` | Create | Arm state, 10 s window, dispatch to the hard-stop port |
| `src/application/useAgentStopController.test.tsx` | Create | Controller tests (fake timers, `act`) |
| `src/components/agentMode/AgentStopConfirmationBanner.tsx` | Create | Composer banner with "Stop everything" / "Keep running" |
| `src/components/agentMode/AgentStopConfirmationBanner.test.tsx` | Create | Rendering and callbacks |
| `src/components/agentMode/useAgentComposerState.ts` | Modify (:343-362, :617) | Route `requestStop` through the controller; expose `onStopNow` and `stopConfirmation` |
| `src/components/agentMode/AgentComposer.tsx` | Modify (:94-146, :770-780) | New props; render the banner |
| `src/components/agentMode/AgentComposerController.tsx` | Modify (:105-140) | Memo equality for the new props |
| `src/components/agentMode/AgentModeView.tsx` | Modify (:1093) | Background banner button → `onStopNow` |
| `src/components/agentMode/useAgentComposerState.test.tsx` | Modify | Stop wiring test |

### Fix 2 (Rust)

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/agent_task_process_group.rs` | Create | Moved `AgentProcessGroup` + `AgentProcessGroupState`, clean-exit grace, `terminate_group_survivors` |
| `src-tauri/src/agent_task_supervisor.rs` | Modify | Remove the moved code; probe on the signal trait; `clean_exit_grace` tuning; test builder |
| `src-tauri/src/agent_task_stop_escalation.rs` | Modify (:13-28) | `for_child` takes the grace |
| `src-tauri/src/agent_task_supervisor_session_tests.rs` | Modify | Updated `for_child` call |
| `src-tauri/tests/support/agent_task_clean_exit_grace_tests.rs` | Create | Fake and real-process grace tests |
| `src-tauri/tests/agent_task_supervisor_tests.rs` | Modify (tail) | One `#[path] mod` include |

### Fix 3 (Rust)

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/agent_task_result_detector.rs` | Modify | `ResultSettlePolicy`, `consume_message`, `rearm`, accessors |
| `src-tauri/src/agent_task_result_detector_tests.rs` | Modify | New detector tests |
| `src-tauri/src/agent_claude_input_lifecycle.rs` | Modify | `abandon_all`, `pub(crate) command_id` |
| `src-tauri/src/agent_task_input.rs` | Modify | Trait `provider_owns_settlement`/`interrupt`; `AgentTaskInputSlot::interrupt` |
| `src-tauri/src/claude_session_policy.rs` | Create | Pure: key, fingerprint, disposition, eviction, idle retirement, tuning, reasons, wire enums |
| `src-tauri/src/claude_session_policy_tests.rs` | Create | Policy tests |
| `src-tauri/src/claude_session_router.rs` | Create | Line router: turn/idle split, settle, interrupt ack, unowned activity |
| `src-tauri/src/claude_session_router_tests.rs` | Create | Router tests |
| `src-tauri/src/claude_thread_session.rs` | Create | Session process owner: readers, waiter, attach, interrupt, terminate, RAII |
| `src-tauri/src/claude_session_turn.rs` | Create | `ClaudeSessionTurnPlan`, `ClaudeSessionTurnChild`, `ClaudeSessionTurnInput`, `TurnOutputReader`, fingerprint builder |
| `src-tauri/src/agent_task_input_tests.rs` | Modify | Slot interrupt tests |
| `src-tauri/tests/support/fake_claude_cli.rs` | Create | Shared Python fake Claude CLI |
| `src-tauri/tests/support/claude_thread_session_tests.rs` | Create | Session-level real-process tests |
| `src-tauri/tests/support/claude_session_registry_tests.rs` | Create | Registry reuse/restart/cap/A→B→A/reaping tests |
| `src-tauri/src/claude_session_registry.rs` | Create | Keyed sessions, acquire/reuse/restart/cap/eviction, end paths, idle retire, inspect, Drop |
| `src-tauri/src/agent_task_spawner.rs` | Modify | Module declarations, `with_claude_session`, `spawn_bound_process`, `spawn_per_turn_process`, dispatch |
| `src-tauri/src/agent_task_interrupt.rs` | Create | `AgentTaskRegistry::interrupt_for_thread`, `AgentTaskInterruptOutcome` |
| `src-tauri/src/agent_task_supervisor.rs` | Modify (tiny) | `interrupt_requested` field, module declaration, `system_process_group_signals()` |
| `src-tauri/src/agent_task_steering.rs` | Modify | `result_watch` skip; interrupting → `Stopping` |
| `src-tauri/src/agent_task_completion.rs` | Modify | An interrupted turn resolves to `Stopped` |
| `src-tauri/src/lib_composition/claude_session_composition.rs` | Create | `prepare_transport`, commands, event sink, composite provider lifecycle |
| `src-tauri/src/lib_composition/agent_task_commands.rs` | Modify | Request field, module declaration, start wiring, stop-for-root, dispose |
| `src-tauri/src/lib_composition/git_worktree_commands.rs` | Modify (:136-149) | Reap sessions in a removed worktree |
| `src-tauri/src/lib_composition/agent_thread_store_commands.rs` | Modify (:94-104) | End the session on delete |
| `src-tauri/src/lib_composition/runtime.rs` | Modify (:194-226, :615-640) | Construct and manage the registry, idle loop, commands |
| `src-tauri/src/runtime_task_lifecycle.rs` | Modify (:82-92) | Close admission and shut sessions down at exit |
| `src-tauri/tests/support/claude_session_supervisor_tests.rs` | Create | Supervised end-to-end tests: survival, Stop, crash, fallback |
| `src-tauri/tests/agent_task_supervisor_tests.rs` | Modify (tail) | Include |
| `src-tauri/tests/agent_root_lease_tests.rs` | No change | Compiles the new modules through `agent_task_spawner.rs` |

### Fix 3 (TypeScript)

| File | Action | Responsibility |
|---|---|---|
| `src/domain/agentThreadSession.ts` | Create | Session wire types, parsers, restart policy, ended-notice text |
| `src/domain/agentThreadSession.test.ts` | Create | Parser tests |
| `src/domain/agentTask.ts` | Modify | Optional `sessionRestart`; export three validators |
| `src/infrastructure/tauriAgentThreadSessionGateway.ts` | Create | Commands and the event subscription |
| `src/infrastructure/tauriAgentThreadSessionGateway.test.ts` | Create | Gateway tests |
| `src/application/workbenchDefaultGateways.ts` | Modify | `defaultAgentThreadSessionGateway` |
| `src/application/useWorkbenchAgents.ts` | Modify (:88, :463) | Pass the gateway |
| `src/application/useAgentThreadSessionLifecycle.ts` | Create | interrupt / endSession / inspectRestart / ended notices |
| `src/application/useAgentThreadSessionLifecycle.test.tsx` | Create | Hook tests |
| `src/application/useAgentThreads.ts` | Modify (:107-125, :433-474) | Wire the lifecycle; end the session on archive/delete; surface methods |
| `src/application/useRemoteAgentStableSurface.ts` | Modify | Stable wrappers for the three new surface methods |
| `src/application/useAgentTurnDispatch.test.tsx` | Modify | Restart-policy pass-through test |
| `src/infrastructure/tauriAgentTaskIpcContract.ts` | Modify | Import `failureMessageOf` from the domain |
| `src/application/agentThreadPorts.ts` | Modify | Optional surface methods; `sessionRestart` on the follow-up request |
| `src/application/useAgentTurnDispatch.ts` | Modify (sendFollowUp) | Pass `sessionRestart` through |
| `src/application/agentTurnStartRunner.ts` | Modify (:186-202) | Include `sessionRestart` in the start request |
| `src/domain/agentStopPolicy.ts` (+ test) | Modify | Interrupt branch |
| `src/application/useAgentStopController.ts` (+ test) | Modify | Interrupt state |
| `src/components/agentMode/AgentStopConfirmationBanner.tsx` (+ test) | Modify | "Interrupting" variant |
| `src/components/agentMode/useAgentComposerState.ts` (+ test) | Modify | Interrupt port; restart confirmation |
| `src/components/agentMode/AgentComposer.tsx` | Modify | `sessionRestartConfirmation` banner; `sessionRestartConfirmed` submission flag |
| `src/components/agentMode/AgentComposerController.tsx` | Modify | Memo equality |
| `src/components/agentMode/agentThreadContextMenuModel.ts` (+ test) | Modify | "End Claude session" item |
| `src/components/agentMode/agentSidebarPresentation.ts` | Modify (:91) | `endSession` command kind |
| `src/components/agentMode/useAgentThreadMenuCommands.ts` | Modify (:245) | Dispatch `endSession` |
| `src/components/agentMode/AgentThreadRow.tsx` | Modify (:100) | Menu context `claudeSession` |
| `src/components/agentMode/AgentThreadHeader.tsx` | Modify (:90) | Menu context `claudeSession` |

## Ownership and parallel streams

One writer per file. The lead integrates and runs gates. Reviewers are read-only.

**Stream A - Fix 1 (starts immediately, parallel with B).**
- Suggested executor: an Opus 5 frontend agent.
- Owns every Fix 1 TypeScript file above.

**Stream B - Fix 2 (starts immediately, parallel with A).**
- Suggested executor: Opus 5.
- Owns every Fix 2 Rust file.
- `tests/agent_task_supervisor_tests.rs` is owned by B until Fix 2 is committed, then by stream C2.

**Stream C - Fix 3 (starts after Fix 2 is committed; depends on `terminate_group_survivors`).**
- Task 3.0 is a lead-run probe and must pass first.

| Sub-stream | Tasks | Dependency | Owns |
|---|---|---|---|
| C1 | 3.1, 3.2, 3.3 | Parallel after 3.0 | Detector and lifecycle files; the policy and router files |
| C2 | 3.4, 3.5, 3.6, 3.7 | After C1 | Spawner, session, turn, registry, interrupt, supervisor hunks, the integration tests |
| C3 | 3.8 | After C2 | Composition and `lib_composition/*` hunks |
| C4 | 3.9 | Parallel with C2 (the wire shapes are fixed in this plan) | TypeScript contracts and gateway |
| C5 | 3.10-3.13 | After C4 | Frontend behaviour files; `useAgentComposerState.ts`, `AgentComposer.tsx` and `AgentComposerController.tsx` transfer from A only after Fix 1 is committed |

Suggested executors: fable-5.1 for C2 (the hardest ownership and race work), Opus 5 for the rest.

**Independent reviewer after each fix:** a read-only Opus 5 subagent. For Fix 3 Rust, add a second read-only review by fable-5.1 (process and cleanup state is hard to verify).

**Worktree coordination:** the only overlapping files with the current dirty worktree are none. `useAgentComposerState.ts`, `AgentComposer.tsx` and `AgentComposerController.tsx` are clean in `git status`. Re-check with `git status --short` before each stream starts. If any owned file became dirty from another session, stop and ask the lead.

---
## Fix 1 - Stop gently while background work runs

Estimated size: about 180 production lines and 260 test lines (TypeScript only). It ships alone.

### Task 1.1: Pure stop policy

**Files:**
- Create: `src/domain/agentStopPolicy.ts`
- Test: `src/domain/agentStopPolicy.test.ts`

**Interfaces:**
- Consumes: `projectAgentBackgroundState`, `resolveAgentBackgroundActivity` (`src/domain/agentBackgroundActivity.ts`) and `AgentTurn` (`src/domain/agentThread.ts`).
- Produces:
  - `AGENT_STOP_CONFIRMATION_WINDOW_MS = 10_000`
  - `interface AgentStopArm { threadId: string; turnId: string; armedAtEpochMs: number }`
  - `type AgentStopDecision = { kind: "ignore" } | { kind: "hardStop"; turnId: string } | { kind: "confirmBackground"; turnId: string; liveTaskCount: number }`
  - `interface AgentStopRequest { threadId: string; turn: AgentTurn | null; arm: AgentStopArm | null; nowEpochMs: number }`
  - `decideAgentStop(request: AgentStopRequest): AgentStopDecision`
  - `agentStopArmIsLive(arm: AgentStopArm | null, threadId: string, turnId: string, nowEpochMs: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "./agentThread";
import {
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  agentStopArmIsLive,
  decideAgentStop,
} from "./agentStopPolicy";

const result: AgentTurnEvent = { kind: "result", text: "Started", isError: false, usage: null };
const shell = (
  status: Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"],
): AgentTurnEvent => ({
  kind: "backgroundTask",
  taskId: "watch",
  status,
  taskType: "shell",
  description: "npm run dev",
});
const assistant: AgentTurnEvent = { kind: "assistantText", text: "Working" };

function turn(events: ReadonlyArray<AgentTurnEvent>, turnId = "agt-1-t1"): AgentTurn {
  return {
    turnId,
    prompt: "Start the dev server",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: events.length,
    launch: null,
    cliVersion: null,
  };
}

describe("decideAgentStop", () => {
  it("ignores a thread without a running turn", () => {
    expect(decideAgentStop({ threadId: "t", turn: null, arm: null, nowEpochMs: 5 })).toEqual({
      kind: "ignore",
    });
  });

  it("hard-stops while the foreground is still running", () => {
    expect(
      decideAgentStop({ threadId: "t", turn: turn([assistant]), arm: null, nowEpochMs: 5 }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("hard-stops when the foreground settled and no background work is live", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), shell("completed"), result]),
        arm: null,
        nowEpochMs: 5,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("asks for confirmation when only background work is live", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm: null,
        nowEpochMs: 5,
      }),
    ).toEqual({ kind: "confirmBackground", turnId: "agt-1-t1", liveTaskCount: 1 });
  });

  it("hard-stops on the second press inside the confirmation window", () => {
    const arm = { threadId: "t", turnId: "agt-1-t1", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm,
        nowEpochMs: 100 + AGENT_STOP_CONFIRMATION_WINDOW_MS - 1,
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("a stale arm from a previous turn never hard-stops a new turn", () => {
    const arm = { threadId: "t", turnId: "agt-1-t0", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result], "agt-1-t1"),
        arm,
        nowEpochMs: 200,
      }),
    ).toEqual({ kind: "confirmBackground", turnId: "agt-1-t1", liveTaskCount: 1 });
  });

  it("an expired arm asks again instead of stopping", () => {
    const arm = { threadId: "t", turnId: "agt-1-t1", armedAtEpochMs: 100 };
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm,
        nowEpochMs: 100 + AGENT_STOP_CONFIRMATION_WINDOW_MS,
      }).kind,
    ).toBe("confirmBackground");
  });
});

describe("agentStopArmIsLive", () => {
  it("rejects another thread, a future arm and a missing arm", () => {
    const arm = { threadId: "t", turnId: "x", armedAtEpochMs: 100 };
    expect(agentStopArmIsLive(arm, "other", "x", 150)).toBe(false);
    expect(agentStopArmIsLive(arm, "t", "x", 50)).toBe(false);
    expect(agentStopArmIsLive(null, "t", "x", 150)).toBe(false);
    expect(agentStopArmIsLive(arm, "t", "x", 150)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/domain/agentStopPolicy.test.ts`
Expected: FAIL with `Failed to resolve import "./agentStopPolicy"`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "./agentBackgroundActivity";
import type { AgentTurn } from "./agentThread";

export const AGENT_STOP_CONFIRMATION_WINDOW_MS = 10_000;

export interface AgentStopArm {
  readonly threadId: string;
  readonly turnId: string;
  readonly armedAtEpochMs: number;
}

export type AgentStopDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "hardStop"; readonly turnId: string }
  | {
      readonly kind: "confirmBackground";
      readonly turnId: string;
      readonly liveTaskCount: number;
    };

export interface AgentStopRequest {
  readonly threadId: string;
  readonly turn: AgentTurn | null;
  readonly arm: AgentStopArm | null;
  readonly nowEpochMs: number;
}

export function decideAgentStop(request: AgentStopRequest): AgentStopDecision {
  const { turn } = request;
  if (turn === null) return { kind: "ignore" };
  if (agentStopArmIsLive(request.arm, request.threadId, turn.turnId, request.nowEpochMs)) {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  const activity = resolveAgentBackgroundActivity(
    projectAgentBackgroundState(turn.events, true, turn.eventsTruncated),
    "settled",
  );
  if (!activity.foregroundSettled || activity.phase === "inactive") {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  return {
    kind: "confirmBackground",
    turnId: turn.turnId,
    liveTaskCount: activity.tasks.length,
  };
}

export function agentStopArmIsLive(
  arm: AgentStopArm | null,
  threadId: string,
  turnId: string,
  nowEpochMs: number,
): boolean {
  if (arm === null) return false;
  if (arm.threadId !== threadId || arm.turnId !== turnId) return false;
  const age = nowEpochMs - arm.armedAtEpochMs;
  return age >= 0 && age < AGENT_STOP_CONFIRMATION_WINDOW_MS;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/domain/agentStopPolicy.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Hand over for review.** The lead commits after review and owner authorization:

```bash
git add src/domain/agentStopPolicy.ts src/domain/agentStopPolicy.test.ts
git commit -m "feat(agent): add stop policy that confirms before ending background work"
```

### Task 1.2: Stop controller, confirmation banner and composer wiring

**Files:**
- Create: `src/application/useAgentStopController.ts`, `src/application/useAgentStopController.test.tsx`
- Create: `src/components/agentMode/AgentStopConfirmationBanner.tsx`, `src/components/agentMode/AgentStopConfirmationBanner.test.tsx`
- Modify: `src/components/agentMode/useAgentComposerState.ts:343-362` (stop wiring) and `:617` (composerProps)
- Modify: `src/components/agentMode/AgentComposer.tsx:94-146` (props) and `:776-780` (banners)
- Modify: `src/components/agentMode/AgentComposerController.tsx` (`agentComposerControllerPropsEqual`)
- Modify: `src/components/agentMode/AgentModeView.tsx:1093`
- Test: `src/components/agentMode/useAgentComposerState.test.tsx` (new case)

**Interfaces:**
- Consumes: `decideAgentStop` and `AGENT_STOP_CONFIRMATION_WINDOW_MS` from Task 1.1.
- Produces:
  - `useAgentStopController(options: AgentStopControllerOptions): AgentStopController`, where
    - `AgentStopControllerOptions = { readRunningTurn(threadId): AgentTurn | null; hardStop(threadId): Promise<void>; now?(): number }`
    - `AgentStopController = { confirmation: AgentStopConfirmation | null; requestStop(threadId): void; stopNow(threadId): void; cancelStop(): void }`
    - `AgentStopConfirmation = { threadId: string; liveTaskCount: number }`
  - `AgentStopConfirmationView = { liveTaskCount: number; onCancel(): void }`
  - `AgentComposerProps.onStopNow?(): void` and `AgentComposerProps.stopConfirmation?: AgentStopConfirmationView | null`

- [ ] **Step 1: Write the failing controller test**

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../domain/agentThread";
import { AGENT_STOP_CONFIRMATION_WINDOW_MS } from "../domain/agentStopPolicy";
import { useAgentStopController } from "./useAgentStopController";

const backgroundOnly: ReadonlyArray<AgentTurnEvent> = [
  { kind: "backgroundTask", taskId: "watch", status: "starting", taskType: "shell" },
  { kind: "result", text: "Started", isError: false, usage: null },
];

function turn(events: ReadonlyArray<AgentTurnEvent>, turnId = "agt-1-t1"): AgentTurn {
  return {
    turnId,
    prompt: "Start the dev server",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: events.length,
    launch: null,
    cliVersion: null,
  };
}

describe("useAgentStopController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(current: AgentTurn | null) {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    let now = 1_000;
    const hook = renderHook(() =>
      useAgentStopController({
        readRunningTurn: () => current,
        hardStop,
        now: () => now,
      }),
    );
    return {
      hook,
      hardStop,
      advance(ms: number) {
        now += ms;
        act(() => {
          vi.advanceTimersByTime(ms);
        });
      },
    };
  }

  it("hard-stops immediately while the foreground runs", () => {
    const { hook, hardStop } = setup(turn([{ kind: "assistantText", text: "Working" }]));
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("second press within the window hard-stops", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).toEqual({ threadId: "thread-1", liveTaskCount: 1 });
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("disarms after the window so a late press asks again", () => {
    const { hook, hardStop, advance } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    advance(AGENT_STOP_CONFIRMATION_WINDOW_MS);
    expect(hook.result.current.confirmation).toBeNull();
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).not.toBeNull();
  });

  it("cancel keeps the work running", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.cancelStop());
    expect(hook.result.current.confirmation).toBeNull();
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
  });

  it("stopNow ends everything without asking", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.stopNow("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/application/useAgentStopController.test.tsx`
Expected: FAIL with `Failed to resolve import "./useAgentStopController"`.

- [ ] **Step 3: Implement the controller**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTurn } from "../domain/agentThread";
import {
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
  decideAgentStop,
  type AgentStopArm,
  type AgentStopDecision,
} from "../domain/agentStopPolicy";

export interface AgentStopControllerOptions {
  readonly readRunningTurn: (threadId: string) => AgentTurn | null;
  readonly hardStop: (threadId: string) => Promise<void>;
  readonly now?: () => number;
}

export interface AgentStopConfirmation {
  readonly threadId: string;
  readonly liveTaskCount: number;
}

export interface AgentStopController {
  readonly confirmation: AgentStopConfirmation | null;
  requestStop(threadId: string): void;
  stopNow(threadId: string): void;
  cancelStop(): void;
}

export function useAgentStopController(options: AgentStopControllerOptions): AgentStopController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const armRef = useRef<AgentStopArm | null>(null);
  const [confirmation, setConfirmation] = useState<AgentStopConfirmation | null>(null);

  const cancelStop = useCallback((): void => {
    armRef.current = null;
    setConfirmation(null);
  }, []);

  useEffect(() => {
    if (confirmation === null) return;
    const timer = setTimeout(cancelStop, AGENT_STOP_CONFIRMATION_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [cancelStop, confirmation]);

  const stopNow = useCallback(
    (threadId: string): void => {
      cancelStop();
      void optionsRef.current.hardStop(threadId);
    },
    [cancelStop],
  );

  const requestStop = useCallback(
    (threadId: string): void => {
      const { readRunningTurn, now = Date.now } = optionsRef.current;
      const nowEpochMs = now();
      const decision: AgentStopDecision = decideAgentStop({
        threadId,
        turn: readRunningTurn(threadId),
        arm: armRef.current,
        nowEpochMs,
      });
      switch (decision.kind) {
        case "ignore":
          cancelStop();
          return;
        case "hardStop":
          stopNow(threadId);
          return;
        case "confirmBackground":
          armRef.current = { threadId, turnId: decision.turnId, armedAtEpochMs: nowEpochMs };
          setConfirmation({ threadId, liveTaskCount: decision.liveTaskCount });
          return;
        default:
          unsupportedDecision(decision);
      }
    },
    [cancelStop, stopNow],
  );

  return { confirmation, requestStop, stopNow, cancelStop };
}

function unsupportedDecision(decision: never): never {
  throw new Error(`Unsupported stop decision: ${JSON.stringify(decision)}`);
}
```

- [ ] **Step 4: Run the controller test and confirm it passes**

Run: `npx vitest run src/application/useAgentStopController.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing banner test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AgentStopConfirmationBanner,
  agentStopConfirmationText,
} from "./AgentStopConfirmationBanner";

describe("AgentStopConfirmationBanner", () => {
  it("renders nothing without a pending confirmation", () => {
    const { container } = render(
      <AgentStopConfirmationBanner confirmation={null} onConfirm={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers stopping everything or keeping the work running", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <AgentStopConfirmationBanner
        confirmation={{ liveTaskCount: 2, onCancel }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(agentStopConfirmationText(2))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop everything" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("words the count truthfully", () => {
    expect(agentStopConfirmationText(1)).toBe(
      "1 background task is still running. Press Esc again or choose Stop everything to end it.",
    );
    expect(agentStopConfirmationText(3)).toBe(
      "3 background tasks are still running. Press Esc again or choose Stop everything to end them.",
    );
    expect(agentStopConfirmationText(0)).toBe(
      "Background work is still running. Press Esc again or choose Stop everything to end it.",
    );
  });
});
```

- [ ] **Step 6: Implement the banner**

```tsx
import { AlertTriangle } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";

export interface AgentStopConfirmationView {
  readonly liveTaskCount: number;
  onCancel(): void;
}

export function AgentStopConfirmationBanner({
  confirmation,
  onConfirm,
}: {
  readonly confirmation: AgentStopConfirmationView | null;
  readonly onConfirm: (() => void) | undefined;
}) {
  if (confirmation === null) return null;
  return (
    <ComposerBanner
      actions={
        <>
          {onConfirm === undefined ? null : (
            <button className="cv-banner-action" onClick={onConfirm} type="button">
              Stop everything
            </button>
          )}
          <button className="cv-banner-action" onClick={confirmation.onCancel} type="button">
            Keep running
          </button>
        </>
      }
      icon={<AlertTriangle size={12} strokeWidth={1.5} />}
      tone="warn"
    >
      {agentStopConfirmationText(confirmation.liveTaskCount)}
    </ComposerBanner>
  );
}

export function agentStopConfirmationText(liveTaskCount: number): string {
  if (liveTaskCount <= 0) {
    return "Background work is still running. Press Esc again or choose Stop everything to end it.";
  }
  if (liveTaskCount === 1) {
    return "1 background task is still running. Press Esc again or choose Stop everything to end it.";
  }
  return `${liveTaskCount} background tasks are still running. Press Esc again or choose Stop everything to end them.`;
}
```

- [ ] **Step 7: Run the banner test and confirm it passes**

Run: `npx vitest run src/components/agentMode/AgentStopConfirmationBanner.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 8: Write the failing composer-state test.** Add it to `src/components/agentMode/useAgentComposerState.test.tsx` inside `describe("useAgentComposerState")`, and add the helper next to `steerableThreadView`:

```tsx
  it("asks before stopping background-only work and stops on the second press", () => {
    const stop = vi.fn(async () => undefined);
    render(threadsSurfaceFixture({ threads: [backgroundOnlyThreadView()], stop }));
    act(() => current().navigation.selectThread("agt-1"));

    act(() => current().composer.composerProps.onStop?.());
    expect(stop).not.toHaveBeenCalled();
    expect(current().composer.composerProps.stopConfirmation?.liveTaskCount).toBe(1);

    act(() => current().composer.composerProps.onStop?.());
    expect(stop).toHaveBeenCalledWith("agt-1");
    expect(current().composer.composerProps.stopConfirmation).toBeNull();
  });

  it("stops at once from the explicit stop-everything action", () => {
    const stop = vi.fn(async () => undefined);
    render(threadsSurfaceFixture({ threads: [backgroundOnlyThreadView()], stop }));
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onStopNow?.());
    expect(stop).toHaveBeenCalledWith("agt-1");
  });
```

```tsx
function backgroundOnlyThreadView(): AgentThreadView {
  const base = steerableThreadView();
  const running: AgentTurn = {
    turnId: "agt-1-t1",
    prompt: "Start the dev server",
    status: { kind: "running" },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [
      { kind: "backgroundTask", taskId: "watch", status: "starting", taskType: "shell" },
      { kind: "result", text: "Started", isError: false, usage: null },
    ],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 2,
    launch: defaultAgentLaunchOptions("claudeCode"),
    cliVersion: null,
  };
  return { ...base, thread: { ...base.thread, turns: [running] } };
}
```

Run: `npx vitest run src/components/agentMode/useAgentComposerState.test.tsx -t "background-only|stop-everything"`
Expected: FAIL (`stopConfirmation` is undefined and `stop` was called on the first press).

- [ ] **Step 9: Wire the composer state.** In `src/components/agentMode/useAgentComposerState.ts`, replace the block at :357-362 (`const stopThread = agents.stop; const requestStop = useCallback(...)`) with:

```ts
  const stopThread = agents.stop;
  const selectedThreadRef = useRef(selectedThread);
  selectedThreadRef.current = selectedThread;
  const stopController = useAgentStopController({
    readRunningTurn: (threadId) => {
      const view = selectedThreadRef.current;
      if (view === null || view.thread.threadId !== threadId) return null;
      return runningTurn(view.thread);
    },
    hardStop: stopThread,
  });
  const {
    cancelStop,
    confirmation: pendingStop,
    requestStop: requestControlledStop,
    stopNow: stopControlledNow,
  } = stopController;
  const requestStop = useCallback((): void => {
    const threadId = runningThreadIdRef.current;
    if (threadId === null) return;
    requestControlledStop(threadId);
  }, [requestControlledStop]);
  const stopNow = useCallback((): void => {
    const threadId = runningThreadIdRef.current;
    if (threadId === null) return;
    stopControlledNow(threadId);
  }, [stopControlledNow]);
  const stopConfirmation = useMemo(
    () =>
      pendingStop === null || pendingStop.threadId !== runningThreadId
        ? null
        : { liveTaskCount: pendingStop.liveTaskCount, onCancel: cancelStop },
    [cancelStop, pendingStop, runningThreadId],
  );
```

Also:
- Add these imports: `import { useAgentStopController } from "../../application/useAgentStopController";` and `runningTurn` from `../../domain/agentThread` (skip it if it is already imported).
- In the `composerProps` object (:617), next to `onStop: requestStop,`, add:

```ts
    onStopNow: stopNow,
    stopConfirmation,
```

- [ ] **Step 10: Add the composer props and render the banner.** In `src/components/agentMode/AgentComposer.tsx`:

  1. Add the import:
     ```ts
     import {
       AgentStopConfirmationBanner,
       type AgentStopConfirmationView,
     } from "./AgentStopConfirmationBanner";
     ```
  2. In `AgentComposerProps`, after `onStop?(): void;`:
     ```ts
       onStopNow?(): void;
       readonly stopConfirmation?: AgentStopConfirmationView | null;
     ```
  3. Destructure `onStopNow` and `stopConfirmation = null` in the component parameters.
  4. Inside the `banners={<>...</>}` fragment, directly after `{banners}`, add:
     ```tsx
     <AgentStopConfirmationBanner confirmation={stopConfirmation} onConfirm={onStopNow} />
     ```

  Esc handling stays as is. The second Esc calls `onStop`, the controller sees the live arm and hard-stops.

- [ ] **Step 11: Keep the memoized composer truthful.** In `agentComposerControllerPropsEqual` in `src/components/agentMode/AgentComposerController.tsx`, directly after `leftProps.onStop === rightProps.onStop &&`, add:

```ts
    leftProps.onStopNow === rightProps.onStopNow &&
    leftProps.stopConfirmation === rightProps.stopConfirmation &&
```

- [ ] **Step 12: Route the background banner's explicit button to the immediate stop.** In `src/components/agentMode/AgentModeView.tsx:1093`, change `onStopBackground={composer.composerProps.onStop}` to:

```tsx
                  onStopBackground={composer.composerProps.onStopNow}
```

- [ ] **Step 13: Run the focused tests**

Run: `npx vitest run src/components/agentMode/useAgentComposerState.test.tsx src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentComposer.interaction.test.tsx src/components/agentMode/AgentComposerController.test.tsx src/application/useAgentStopController.test.tsx src/components/agentMode/AgentStopConfirmationBanner.test.tsx src/domain/agentStopPolicy.test.ts`
Expected: PASS. The existing "steers the running Claude turn..." test still sees `stop` called on the first press, because its turn has no background work.

- [ ] **Step 14: Run the fast frontend gates for this slice**

Run: `npm run check && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps && npm run size:hotspots && npm run format:check:changed; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 15: Independent review, then commit.** Send a read-only Opus 5 review with this brief: "Review Fix 1 diff. Check stale-arm and A→B→A thread switch, Esc key repeat, memo equality, no stop fired on first press when background-only, banner button still immediate." After it approves and the owner authorizes, the lead runs:

```bash
git add src/application/useAgentStopController.ts src/application/useAgentStopController.test.tsx src/components/agentMode/AgentStopConfirmationBanner.tsx src/components/agentMode/AgentStopConfirmationBanner.test.tsx src/components/agentMode/useAgentComposerState.ts src/components/agentMode/useAgentComposerState.test.tsx src/components/agentMode/AgentComposer.tsx src/components/agentMode/AgentComposerController.tsx src/components/agentMode/AgentModeView.tsx
git commit -m "feat(agent): confirm before Esc/Stop ends live background work"
```

---
## Fix 2 - Clean-exit grace

Estimated size: about 150 changed production lines (plus about 170 moved lines) and 300 test lines (Rust only). It ships alone and runs in parallel with Fix 1.

### Task 2.1: Extract the process-group owner out of the supervisor (pure move)

This makes token room: `agent_task_supervisor.rs` is at 9779/10000 structural tokens. Behaviour does not change.

**Files:**
- Create: `src-tauri/src/agent_task_process_group.rs`
- Modify: `src-tauri/src/agent_task_supervisor.rs`. Delete the `AgentProcessGroupState` enum and `struct AgentProcessGroup` + `impl AgentProcessGroup` (currently :283-425). Add the module include.

**Interfaces:**
- Produces (visible in the `agent_task_supervisor` module tree): `AgentProcessGroupState`, `AgentProcessGroup::{new, signal, force_stop, force_requested, observe_exit, reap, try_wait, is_reaped, state}`, and the field `input`.

- [ ] **Step 1: Record the baseline.** Run `cd src-tauri && cargo test --lib agent_task_supervisor && cargo test --test agent_task_supervisor_tests && cargo test --test agent_root_lease_tests; echo "exit=$?"`. Expected: `exit=0`. Then run `npm run size:hotspots`. Expected: PASS, and `agent_task_supervisor.rs` shows 9779 tokens.

- [ ] **Step 2: Create `src-tauri/src/agent_task_process_group.rs`** with the moved code, unchanged except for `pub(super)` visibility:

```rust
use super::{AgentProcessGroupSignalSender, KILL_PROCESS_GROUP_SIGNAL};
use crate::agent_task_spawner::{
    agent_task_input::{AgentTaskInputSlot, AgentTaskInputState},
    AgentChild,
};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

#[derive(Clone, Copy)]
pub(super) enum AgentProcessGroupState {
    Active { process_group_id: i32 },
    SharedSession,
    Released,
    CleanupUncertain,
}

pub(super) struct AgentProcessGroup {
    state: Mutex<AgentProcessGroupState>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    force_requested: AtomicBool,
    cleanup_verified: AtomicBool,
    pub(super) input: std::sync::OnceLock<Arc<AgentTaskInputSlot>>,
}

impl AgentProcessGroup {
    pub(super) fn new(
        process_group_id: i32,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(AgentProcessGroupState::Active { process_group_id }),
            signals,
            force_requested: AtomicBool::new(false),
            cleanup_verified: AtomicBool::new(false),
            input: std::sync::OnceLock::new(),
        })
    }
```

Continue the file by moving, byte for byte, the bodies of `signal`, `force_stop`, `close_input`, `force_stop_after_observed_exit`, `force_requested`, `observe_exit`, `reap`, `try_wait`, `is_reaped` and `state` from `agent_task_supervisor.rs:305-424`, and close the `impl`. Mark `signal`, `force_stop`, `force_requested`, `observe_exit`, `reap`, `try_wait`, `is_reaped` and `state` as `pub(super)`. `close_input` and `force_stop_after_observed_exit` stay private.

- [ ] **Step 3: Wire the module into the supervisor.** In `agent_task_supervisor.rs`, after the `agent_task_pending_stops` module block (:18-21), add:

```rust
#[path = "agent_task_process_group.rs"]
mod process_group;

use process_group::{AgentProcessGroup, AgentProcessGroupState};
```

Delete the moved definitions. Also remove the now-unused `MutexGuard` import and `force_requested`/`cleanup_verified` `AtomicBool` uses from the top-level `use` list only if the compiler reports them unused. `AtomicBool` is still used by `AgentOutputPumps`.

- [ ] **Step 4: Prove behaviour is unchanged.** Run the Step 1 commands again. Expected: `exit=0`, the same test counts, and `npm run size:hotspots` passes with `agent_task_supervisor.rs` about 900 tokens lower.

- [ ] **Step 5: Hand over.** The lead commits after review:

```bash
git add src-tauri/src/agent_task_process_group.rs src-tauri/src/agent_task_supervisor.rs
git commit -m "refactor(agent): move process-group ownership out of the task supervisor"
```

### Task 2.2: Bounded SIGTERM grace on an unrequested exit

**Files:**
- Modify: `src-tauri/src/agent_task_process_group.rs` (from Task 2.1)
- Modify: `src-tauri/src/agent_task_supervisor.rs`:
  - the signal trait (:137-143)
  - the system sender (:145-183)
  - `macos_group_contains_only_leader` (:204-247)
  - `AgentTaskRuntimeTuning` (:519-533)
  - `with_dependencies` (:755-778)
  - `start_published` (:889-892)
- Modify: `src-tauri/src/agent_task_stop_escalation.rs:13-28`
- Modify: `src-tauri/src/agent_task_supervisor_session_tests.rs` (5 `for_child` calls)
- Create: `src-tauri/tests/support/agent_task_clean_exit_grace_tests.rs`
- Modify: `src-tauri/tests/agent_task_supervisor_tests.rs` (tail include)

**Interfaces:**
- Produces:
  - `AgentProcessGroupSignalSender::group_has_members_besides_leader(&self, process_group_id: i32) -> Option<bool>` (default `None`)
  - `pub(crate) fn terminate_group_survivors(signals: &dyn AgentProcessGroupSignalSender, process_group_id: i32, grace: Duration, aborted: &dyn Fn() -> bool)`, re-exported from `agent_task_supervisor`. Task 3.5 uses it.
  - `AgentTaskRegistry::with_clean_exit_grace_for_tests(self, grace: Duration) -> Self` (`#[cfg(test)]`)
  - `pub fn system_process_group_signals() -> Arc<dyn AgentProcessGroupSignalSender>`. Task 3.8 uses it.
  - `AgentProcessGroup::for_child(child, signals, clean_exit_grace: Duration)`

- [ ] **Step 1: Write the failing fake-process tests.** Create `src-tauri/tests/support/agent_task_clean_exit_grace_tests.rs`:

```rust
use super::*;

struct ScriptedProbeSignals {
    sent: Mutex<Vec<(i32, Instant)>>,
    members: Mutex<VecDeque<Option<bool>>>,
    fallback: Option<bool>,
}

impl ScriptedProbeSignals {
    fn new(script: Vec<Option<bool>>, fallback: Option<bool>) -> Arc<Self> {
        Arc::new(Self {
            sent: Mutex::new(Vec::new()),
            members: Mutex::new(script.into()),
            fallback,
        })
    }

    fn sent(&self) -> Vec<(i32, Instant)> {
        self.sent.lock().expect("sent lock").clone()
    }

    fn kinds(&self) -> Vec<i32> {
        self.sent().into_iter().map(|(signal, _)| signal).collect()
    }
}

impl AgentProcessGroupSignalSender for ScriptedProbeSignals {
    fn send(&self, _process_group_id: i32, signal: i32) -> Result<(), String> {
        self.sent
            .lock()
            .expect("sent lock")
            .push((signal, Instant::now()));
        Ok(())
    }

    fn group_has_members_besides_leader(&self, _process_group_id: i32) -> Option<bool> {
        self.members
            .lock()
            .expect("members lock")
            .pop_front()
            .unwrap_or(self.fallback)
    }
}

struct GraceFixture {
    registry: AgentTaskRegistry,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
    spawner: Arc<FakeSpawner>,
}

fn grace_fixture(signals: &Arc<ScriptedProbeSignals>, grace: Duration) -> GraceFixture {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let spawner = Arc::new(FakeSpawner::default());
    let registry = AgentTaskRegistry::with_dependencies(
        Arc::clone(&admission),
        Arc::clone(&spawner) as Arc<dyn AgentProcessSpawner>,
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        Arc::clone(signals) as Arc<dyn AgentProcessGroupSignalSender>,
        Duration::from_secs(60),
        Duration::from_millis(100),
        Duration::from_millis(200),
    )
    .with_clean_exit_grace_for_tests(grace);
    GraceFixture {
        registry,
        admission,
        sink,
        spawner,
    }
}

fn start_fake(fixture: &GraceFixture, task_id: &str, process: &Arc<FakeProcess>, pgid: i32) {
    let root = unique_path(task_id);
    fixture
        .spawner
        .script(FakeSpawnOutcome::Child(FakeChildSpec::new(process, pgid).build()));
    let admission = fixture
        .admission
        .reserve(
            &workspace("ws-agent-tests"),
            &root,
            &root,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let request = AgentTaskStartRequest {
        isolation: AgentTaskIsolation::InPlace,
        worktree_path: None,
        ..start_request(task_id, &root)
    };
    fixture
        .registry
        .start(request, fake_plan(&root), admission)
        .expect("start");
    fixture.registry.acknowledge(task_id).expect("acknowledge");
}

fn run_clean_exit(signals: &Arc<ScriptedProbeSignals>, grace: Duration, task_id: &str) -> Instant {
    let fixture = grace_fixture(signals, grace);
    let started = Instant::now();
    start_fake(&fixture, task_id, &FakeProcess::new(Some(0), None), 9701);
    assert!(wait_until(Duration::from_secs(10), || fixture
        .sink
        .has_terminal_status(task_id)));
    assert!(matches!(
        statuses_for(&fixture.sink, task_id)
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Exited { exit_code: 0 })
    ));
    started
}

#[test]
fn clean_exit_terms_surviving_members_then_kills_once_they_leave() {
    let signals = ScriptedProbeSignals::new(vec![Some(true), Some(true), Some(false)], Some(false));
    let started = run_clean_exit(&signals, Duration::from_secs(5), "agt-grace-leave");
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn clean_exit_grace_is_bounded_and_always_ends_with_kill() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    run_clean_exit(&signals, Duration::from_millis(300), "agt-grace-bounded");
    let sent = signals.sent();
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    let gap = sent[1].1.duration_since(sent[0].1);
    assert!(
        gap >= Duration::from_millis(300) && gap < Duration::from_millis(1500),
        "grace gap {gap:?}"
    );
}

#[test]
fn clean_exit_without_other_members_skips_sigterm() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(false));
    run_clean_exit(&signals, Duration::from_secs(5), "agt-grace-alone");
    assert_eq!(signals.kinds(), vec![KILL_PROCESS_GROUP_SIGNAL]);
}

#[test]
fn unknown_membership_waits_the_whole_bounded_grace() {
    let signals = ScriptedProbeSignals::new(Vec::new(), None);
    run_clean_exit(&signals, Duration::from_millis(200), "agt-grace-unknown");
    let sent = signals.sent();
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(sent[1].1.duration_since(sent[0].1) >= Duration::from_millis(200));
}

#[test]
fn requested_stop_never_waits_for_the_clean_exit_grace() {
    let signals = ScriptedProbeSignals::new(Vec::new(), Some(true));
    let fixture = grace_fixture(&signals, Duration::from_secs(5));
    start_fake(&fixture, "agt-grace-stop", &FakeProcess::new(None, None), 9702);
    let stopped_at = Instant::now();
    fixture.registry.stop("agt-grace-stop").expect("stop");
    assert!(wait_until(Duration::from_secs(10), || fixture
        .sink
        .has_terminal_status("agt-grace-stop")));
    assert!(stopped_at.elapsed() < Duration::from_secs(3));
    assert_eq!(
        signals.kinds(),
        vec![TERMINATE_PROCESS_GROUP_SIGNAL, KILL_PROCESS_GROUP_SIGNAL]
    );
    assert!(matches!(
        statuses_for(&fixture.sink, "agt-grace-stop")
            .last()
            .map(|event| &event.status),
        Some(AgentTaskStatusPayload::Stopped)
    ));
}
```

Append to `src-tauri/tests/agent_task_supervisor_tests.rs`:

```rust
#[path = "support/agent_task_clean_exit_grace_tests.rs"]
mod clean_exit_grace;
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests clean_exit_grace`
Expected: compile FAIL, `no method named with_clean_exit_grace_for_tests` / `group_has_members_besides_leader is not a member of trait`.

- [ ] **Step 3: Add the probe to the signal trait and the system sender.** In `agent_task_supervisor.rs`, extend the trait:

```rust
pub trait AgentProcessGroupSignalSender: Send + Sync {
    fn send(&self, process_group_id: i32, signal: i32) -> Result<(), String>;

    fn send_after_observed_exit(&self, process_group_id: i32, signal: i32) -> Result<(), String> {
        self.send(process_group_id, signal)
    }

    fn group_has_members_besides_leader(&self, _process_group_id: i32) -> Option<bool> {
        None
    }
}
```

In `impl AgentProcessGroupSignalSender for SystemAgentProcessGroupSignalSender`, add:

```rust
    #[cfg(target_os = "macos")]
    fn group_has_members_besides_leader(&self, process_group_id: i32) -> Option<bool> {
        macos_group_members(process_group_id)
            .map(|members| members.iter().any(|pid| *pid != process_group_id))
    }
```

Replace the body of `macos_group_contains_only_leader` (macOS variant) with a split. The `proc_listpids` code moves verbatim into `macos_group_members`, which returns `Some(members)` at the point that currently computes `members`, and `None` on every early `return false`:

```rust
#[cfg(target_os = "macos")]
fn macos_group_contains_only_leader(process_group_id: i32) -> bool {
    macos_group_members(process_group_id).is_some_and(|members| {
        !members.is_empty() && members.iter().all(|pid| *pid == process_group_id)
    })
}

#[cfg(target_os = "macos")]
fn macos_group_members(process_group_id: i32) -> Option<Vec<i32>> {
    const PROC_PGRP_ONLY: u32 = 2;
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_listpids(
            process_type: u32,
            type_info: u32,
            buffer: *mut libc::c_void,
            buffer_size: i32,
        ) -> i32;
    }

    let group = u32::try_from(process_group_id).ok()?;
    let required = unsafe { proc_listpids(PROC_PGRP_ONLY, group, std::ptr::null_mut(), 0) };
    if required <= 0 {
        return None;
    }
    let mut pids = vec![0_i32; required as usize / std::mem::size_of::<i32>() + 1];
    let bytes = unsafe {
        proc_listpids(
            PROC_PGRP_ONLY,
            group,
            pids.as_mut_ptr().cast(),
            i32::try_from(pids.len() * std::mem::size_of::<i32>()).unwrap_or(i32::MAX),
        )
    };
    if bytes <= 0 {
        return None;
    }
    let returned = bytes as usize;
    let capacity = pids.len() * std::mem::size_of::<i32>();
    if returned >= capacity || !returned.is_multiple_of(std::mem::size_of::<i32>()) {
        return None;
    }
    let count = returned / std::mem::size_of::<i32>();
    Some(pids[..count].iter().copied().filter(|pid| *pid > 0).collect())
}
```

Add the public constructor next to the system sender:

```rust
pub fn system_process_group_signals() -> Arc<dyn AgentProcessGroupSignalSender> {
    Arc::new(SystemAgentProcessGroupSignalSender)
}
```

- [ ] **Step 4: Add the grace to tuning.** In `agent_task_supervisor.rs`:

```rust
const CLEAN_EXIT_GRACE: Duration = Duration::from_secs(2);
```

Give `AgentTaskRuntimeTuning` a `clean_exit_grace: Duration` field. Set it to `CLEAN_EXIT_GRACE` in `Default`, and to `Duration::ZERO` in `with_dependencies`, which keeps every existing fake signal sequence unchanged. Add:

```rust
    #[cfg(test)]
    pub fn with_clean_exit_grace_for_tests(mut self, grace: Duration) -> Self {
        if let Some(shared) = Arc::get_mut(&mut self.shared) {
            shared.tuning.clean_exit_grace = grace;
        }
        self
    }
```

Re-export the helper under the `process_group` module declaration:

```rust
pub(crate) use process_group::terminate_group_survivors;
```

In `start_published`, change the group construction to:

```rust
        unpublished.group = Some(AgentProcessGroup::for_child(
            spawned.as_ref(),
            Arc::clone(&self.shared.signals),
            self.shared.tuning.clean_exit_grace,
        ));
```

- [ ] **Step 5: Implement the grace in `agent_task_process_group.rs`.**
  - Add the fields `clean_exit_grace: Duration` and `stop_signalled: AtomicBool`.
  - `new` takes `clean_exit_grace: Duration`.
  - `signal` starts with `self.stop_signalled.store(true, Ordering::SeqCst);`.
  - `reap` calls `self.cleanup_after_observed_exit()` where it called `self.force_stop_after_observed_exit()`.
  - Extend the imports with `super::{TERMINATE_PROCESS_GROUP_SIGNAL, WAIT_POLL_INTERVAL}`, `std::thread` and `std::time::{Duration, Instant}`.
  - Add:

```rust
impl AgentProcessGroup {
    fn cleanup_after_observed_exit(&self) -> Result<(), String> {
        let state = *self.state();
        if let AgentProcessGroupState::Active { process_group_id } = state {
            let aborted =
                || self.force_requested() || self.stop_signalled.load(Ordering::SeqCst);
            terminate_group_survivors(
                self.signals.as_ref(),
                process_group_id,
                self.clean_exit_grace,
                &aborted,
            );
        }
        self.force_stop_after_observed_exit()
    }
}

pub(crate) fn terminate_group_survivors(
    signals: &dyn AgentProcessGroupSignalSender,
    process_group_id: i32,
    grace: Duration,
    aborted: &dyn Fn() -> bool,
) {
    if grace.is_zero() || process_group_id <= 0 || aborted() {
        return;
    }
    let members = || {
        catch_unwind(AssertUnwindSafe(|| {
            signals.group_has_members_besides_leader(process_group_id)
        }))
        .unwrap_or(None)
    };
    if members() == Some(false) {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        signals.send_after_observed_exit(process_group_id, TERMINATE_PROCESS_GROUP_SIGNAL)
    }));
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if aborted() || members() == Some(false) {
            return;
        }
        thread::sleep(WAIT_POLL_INTERVAL);
    }
}
```

In `agent_task_stop_escalation.rs`, `for_child` gains the parameter:

```rust
    pub(super) fn for_child(
        child: &dyn AgentChild,
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        clean_exit_grace: Duration,
    ) -> Arc<Self> {
        match child.ownership() {
            AgentTaskProcessOwnership::OwnedGroup { process_group_id } => {
                Self::new(process_group_id, signals, clean_exit_grace)
            }
            AgentTaskProcessOwnership::SharedSession => {
                let group = Self::new(0, signals, Duration::ZERO);
                *group.state() = AgentProcessGroupState::SharedSession;
                group
            }
        }
    }
```

In `agent_task_supervisor_session_tests.rs`, change the five calls to `AgentProcessGroup::for_child(&child, Arc::new(NoProcessSignals), Duration::ZERO)`.

- [ ] **Step 6: Run the fake tests and the whole supervisor suite**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests clean_exit_grace && cargo test --test agent_task_supervisor_tests && cargo test --test agent_root_lease_tests && cargo test --lib agent_task; echo "exit=$?"`
Expected: `exit=0`. All 5 new tests pass, and every existing test passes unchanged.

### Task 2.3: Real-process grace regression

**Files:**
- Modify: `src-tauri/tests/support/agent_task_clean_exit_grace_tests.rs` (append)

**Interfaces:**
- Consumes: the production grace of 2 s through `AgentTaskRegistry::new` from Task 2.2.

- [ ] **Step 1: Append the real-process tests**

```rust
fn real_registry() -> (AgentTaskRegistry, Arc<AgentTaskAdmissionRegistry>, Arc<RecordingSink>) {
    let admission = Arc::new(AgentTaskAdmissionRegistry::new());
    let sink = Arc::new(RecordingSink::default());
    let registry = AgentTaskRegistry::new(
        Arc::clone(&admission),
        Arc::new(StdAgentProcessSpawner),
        Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
    );
    (registry, admission, sink)
}

fn start_shell(label: &str, script: &str) -> (PathBuf, Arc<RecordingSink>, AgentTaskRegistry, Instant) {
    let shell = probe_binary(&["/bin/sh"]).expect("POSIX shell");
    let cwd = unique_path(label);
    fs::create_dir_all(&cwd).expect("cwd");
    let (registry, admission_registry, sink) = real_registry();
    let admission = admission_registry
        .reserve(
            &workspace("ws-agent-tests"),
            &cwd,
            &cwd,
            AgentTaskIsolation::InPlace,
        )
        .expect("admission");
    let plan = AgentTaskSpawnPlan::for_tests(
        shell,
        vec!["-c".to_string(), script.to_string()],
        cwd.clone(),
        Vec::new(),
    );
    let started = Instant::now();
    registry
        .start(start_request(label, &cwd), plan, admission)
        .expect("start");
    registry.acknowledge(label).expect("acknowledge");
    (cwd, sink, registry, started)
}

fn read_pid(path: &Path) -> i32 {
    fs::read_to_string(path)
        .expect("pid file")
        .trim()
        .parse()
        .expect("numeric pid")
}

fn process_gone(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

#[test]
fn clean_exit_delivers_sigterm_to_a_same_group_descendant_before_the_kill() {
    let (cwd, sink, _registry, _) = start_shell(
        "agt-grace-term",
        "( trap 'echo graceful > term.txt; exit 0' TERM; while :; do sleep 0.05; done ) </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; exit 0",
    );
    assert!(wait_until(Duration::from_secs(10), || sink
        .has_terminal_status("agt-grace-term")));
    assert!(
        wait_until(Duration::from_secs(5), || fs::read_to_string(
            cwd.join("term.txt")
        )
        .is_ok_and(|text| text.trim() == "graceful")),
        "descendant never received SIGTERM before the final kill"
    );
    let pid = read_pid(&cwd.join("descendant.pid"));
    assert!(wait_until(Duration::from_secs(5), || process_gone(pid)));
    let _ = fs::remove_dir_all(cwd);
}

#[test]
fn clean_exit_kills_a_descendant_that_ignores_sigterm_after_the_grace() {
    let (cwd, sink, _registry, started) = start_shell(
        "agt-grace-ignore",
        "( trap '' TERM; while :; do sleep 0.05; done ) </dev/null >/dev/null 2>&1 & echo $! > descendant.pid; exit 0",
    );
    assert!(wait_until(Duration::from_secs(12), || sink
        .has_terminal_status("agt-grace-ignore")));
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1500) && elapsed < Duration::from_secs(8),
        "terminal after {elapsed:?}"
    );
    let pid = read_pid(&cwd.join("descendant.pid"));
    let gone = wait_until(Duration::from_secs(5), || process_gone(pid));
    if !gone {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    assert!(gone, "descendant survived the final SIGKILL");
    let _ = fs::remove_dir_all(cwd);
}
```

- [ ] **Step 2: Run the tests and confirm they pass.** The existing `normal_leader_exit_cleans_same_group_descendant_after_prompt_eof` must also still pass.

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests grace -- --test-threads=1 && cargo test --test agent_task_supervisor_tests normal_leader_exit; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 3: Rust gates for this slice**

Run: `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test --lib && cargo test --tests; echo "exit=$?"` then `npm run size:hotspots; echo "exit=$?"`
Expected: `exit=0` twice. If a Node-watch test fails under load, rerun it alone after freeing port 9229 (known flake, see memory). Never raise a baseline.

- [ ] **Step 4: Independent review, then commit.** Send a read-only Opus 5 review with this brief: "Fix 2: the grace only on an unrequested exit, the lock not held during the grace (the `let state = *self.state();` copy), the final SIGKILL always sent, the leader unreaped during the grace, the macOS probe parsing unchanged." After approval and owner authorization:

```bash
git add src-tauri/src/agent_task_process_group.rs src-tauri/src/agent_task_supervisor.rs src-tauri/src/agent_task_stop_escalation.rs src-tauri/src/agent_task_supervisor_session_tests.rs src-tauri/tests/support/agent_task_clean_exit_grace_tests.rs src-tauri/tests/agent_task_supervisor_tests.rs
git commit -m "fix(agent): give a cleanly exiting agent group a bounded SIGTERM grace"
```

---
## Fix 3 - Persistent Claude session per thread

Estimated size: about 1,500 Rust production lines, 1,100 Rust test lines, 550 TypeScript production lines and 600 TypeScript test lines (about 3,700 in total). Every sub-slice below compiles and passes gates on its own. The feature becomes user-visible only in Task 3.8, when composition attaches the session plan.

### Task 3.0: Protocol probe against the installed CLI (lead-run, gating)

This task checks the assumptions Fix 3 depends on:
- stdin stays open after `result`,
- a second user frame runs in the same process and conversation,
- `interrupt` gets a `control_response` and a result without killing the process,
- there is no unprompted output while idle.

It spends a few cents of the owner's Claude usage. **Ask the owner before running it.** It is a manual probe, not a test, and is never committed.

**Files:** scratch only: `$HOME/tmp/codevo-claude-session-probe/probe.py`.

- [ ] **Step 1: Write the probe**

```bash
mkdir -p "$HOME/tmp/codevo-claude-session-probe"
cat > "$HOME/tmp/codevo-claude-session-probe/probe.py" <<'PY'
import json, os, shutil, signal, subprocess, sys, tempfile, threading, time, uuid

CLAUDE = shutil.which("claude")
if CLAUDE is None:
    sys.exit("claude is not on PATH")
work = tempfile.mkdtemp(prefix="codevo-session-probe-")
proc = subprocess.Popen(
    [CLAUDE, "-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
     "--permission-prompt-tool", "stdio", "--permission-mode", "bypassPermissions"],
    cwd=work, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, bufsize=1, start_new_session=True,
)
events = []
lock = threading.Lock()

def pump():
    for line in proc.stdout:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        with lock:
            events.append((time.monotonic(), message))

threading.Thread(target=pump, daemon=True).start()

def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()

def user(text):
    uid = str(uuid.uuid4())
    send({"uuid": uid, "type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}})
    return uid

def root_results():
    with lock:
        return [m for _, m in events if m.get("type") == "result" and m.get("parent_tool_use_id") is None]

def wait(predicate, timeout):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.1)
    return False

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

report = {}
u1 = user("Use the Bash tool to run exactly: nohup sleep 600 >/dev/null 2>&1 & echo $! > bg.pid ; then reply DONE.")
report["turn1_result"] = wait(lambda: len(root_results()) >= 1, 180)
time.sleep(3)
report["cli_alive_after_result"] = proc.poll() is None
bg_path = os.path.join(work, "bg.pid")
bg = int(open(bg_path).read().strip()) if os.path.exists(bg_path) else None
report["background_alive_after_result"] = bg is not None and alive(bg)
with lock:
    report["lifecycle_states_for_turn1"] = sorted({m.get("state") for _, m in events if m.get("type") == "command_lifecycle" and m.get("command_uuid") == u1})
idle_from = time.monotonic()
time.sleep(5)
with lock:
    report["idle_output"] = [f"{m.get('type')}/{m.get('subtype')}" for t, m in events if t >= idle_from]
user("Reply with the single word SECOND.")
report["turn2_result"] = wait(lambda: len(root_results()) >= 2, 120)
with lock:
    report["session_ids"] = sorted({m.get("session_id") for _, m in events if m.get("session_id")})
    report["init_frames"] = sum(1 for _, m in events if m.get("type") == "system" and m.get("subtype") == "init")
user("Use the Bash tool to run: for i in $(seq 1 120); do echo $i; sleep 1; done ; then reply COUNTED.")
time.sleep(8)
rid = str(uuid.uuid4())
sent = time.monotonic()
send({"type": "control_request", "request_id": rid, "request": {"subtype": "interrupt"}})
report["turn3_result_after_interrupt"] = wait(lambda: len(root_results()) >= 3, 30)
report["interrupt_to_result_seconds"] = round(time.monotonic() - sent, 2)
with lock:
    report["interrupt_response"] = next((m for _, m in events if m.get("type") == "control_response" and (m.get("response") or {}).get("request_id") == rid), None)
results = root_results()
report["turn3_result"] = None if len(results) < 3 else {"subtype": results[2].get("subtype"), "is_error": results[2].get("is_error")}
report["cli_alive_after_interrupt"] = proc.poll() is None
report["background_alive_after_interrupt"] = bg is not None and alive(bg)
closed = time.monotonic()
proc.stdin.close()
report["cli_exited_after_stdin_close"] = wait(lambda: proc.poll() is not None, 30)
report["exit_seconds_after_stdin_close"] = round(time.monotonic() - closed, 2)
for target in [proc.pid]:
    try:
        os.killpg(target, signal.SIGKILL)
    except ProcessLookupError:
        pass
if bg is not None and alive(bg):
    os.kill(bg, signal.SIGKILL)
print(json.dumps(report, indent=2))
PY
```

- [ ] **Step 2: Run it (after owner approval)**

Run: `python3 "$HOME/tmp/codevo-claude-session-probe/probe.py" > "$HOME/tmp/codevo-claude-session-probe/report.json"; echo "exit=$?"; cat "$HOME/tmp/codevo-claude-session-probe/report.json"`

Expected, all of these must hold:
- `turn1_result`, `cli_alive_after_result` and `background_alive_after_result` are `true`.
- `turn2_result` is `true`, and `session_ids` has exactly one id.
- `interrupt_response.response.subtype` is `"success"`.
- `turn3_result_after_interrupt` and `cli_alive_after_interrupt` are `true`.
- `idle_output` contains no `assistant/*`, `result/*`, `user/*` or `stream_event/*`.

- [ ] **Step 3: Gate.**

  **If any required value differs, stop Fix 3.** Report the JSON to the owner, because the design assumption is false. Fixes 1 and 2 stand alone.

  If the values hold, copy these observed shapes into the fake CLI in Task 3.7 (the fake must emit what the real CLI emits):
  - `turn3_result.subtype`
  - `lifecycle_states_for_turn1`
  - `init_frames`, which tells you whether `system/init` is emitted per turn or once

#### Probe results (2026-09-25)

**Verdict: the gate passes. Fix 3 may proceed, with the amendment in finding F1 below.**

Setup:
- CLI 2.1.281, macOS. Scratch dir `/tmp/codevo-claude-probe.*` (mode 0700), outside the repo.
- The plan's probe script ran with small additions: raw event and sent-frame capture, a 4th turn after the interrupt, a descendant `ps` snapshot, and `try/finally` cleanup by exact PID and PGID.
- Final run used the default model (`system/init.model` = `claude-opus-5-5[1m]`) with effort unset. An earlier run with `--model claude-haiku-4-5-20251001` produced the same frames and values.
- A second mini-probe checked native `run_in_background`.
- Every started process was confirmed gone afterwards (`ps -p` exit 1).

Argv:

`claude -p --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio --permission-mode bypassPermissions`

Frames sent on stdin, one JSON object per line:
- `{"uuid":"<u>","type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`
- `{"type":"control_request","request_id":"<r>","request":{"subtype":"interrupt"}}`

Report values against the Step 2 expectations (default model):

| Key | Value | Expected |
|-----|-------|----------|
| `turn1_result` | `true` | pass |
| `cli_alive_after_result` | `true` | pass |
| `background_alive_after_result` | `true` (the nohup `sleep 600` has ppid 1 and its own pgid) | pass |
| `lifecycle_states_for_turn1` | `["completed","queued","started"]` | shape recorded |
| `idle_output` (5 s after turn 1) | `[]` | pass |
| `turn2_result` | `true` | pass |
| `session_ids` | exactly 1 | pass |
| `init_frames` after 2 turns | `2`, so `system/init` is emitted **once per turn** (4 after 4 turns) | shape recorded |
| `interrupt_response` | `{"type":"control_response","response":{"subtype":"success","request_id":"<r>","response":{"still_queued":[]}}}` | pass |
| `turn3_result_after_interrupt` | `true`; the result came 0.1 s after the interrupt | pass |
| `turn3_result` | `{"subtype":"error_during_execution","is_error":true}` | shape recorded |
| `cli_alive_after_interrupt` | `true` | pass |
| extra: turn 4 after the interrupt | `success`, result `"FOURTH"`, same session | pass |
| `cli_exited_after_stdin_close` | `true`, 0.41 s, exit code 0 | recorded |
| `background_alive_after_cli_exit` | `true`: the nohup'd process outlives a clean CLI exit | recorded |

Observed ordering for a normal turn:
1. `command_lifecycle{state:queued, command_uuid:<u>}`
2. `command_lifecycle{state:started}`
3. `system/init` (the first turn is also preceded by `system/hook_started` and `system/hook_response` frames from the user's SessionStart hooks)
4. `system/thinking_tokens*`, `assistant*`, and `user`(tool_result)`*`
5. `result{subtype:success, stop_reason:end_turn, terminal_reason:completed, result_index:n, user_message_uuid:<u>, user_message_uuids:[<u>], queued_turn_count:0}`
6. `command_lifecycle{state:completed}`

`total_cost_usd` in each `result` is cumulative for the process, not per turn.

Observed ordering for the interrupted turn (the interrupt was sent while a foreground Bash `for ... sleep 1` loop ran):
1. `control_response{success, still_queued:[]}`
2. `system/task_notification{status:"stopped"}` for the foreground `local_bash` task
3. `user` tool_result with the text "The user doesn't want to proceed with this tool use...", then `user` text `[Request interrupted by user for tool use]`
4. `result{subtype:"error_during_execution", is_error:true, stop_reason:"tool_use", terminal_reason:"aborted_tools", errors:["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"], user_message_uuid:<u>}`
5. `command_lifecycle{state:"cancelled"}`

The Bash child tree was gone 2 s later. The foreground Bash task also emits `system/task_started{is_backgrounded:false, task_type:"local_bash"}`.

Findings for Fix 3:

- **F1 (design-impacting): a native background task produces an unprompted turn when it finishes.** The mini-probe prompt asked for Bash with `run_in_background: true` running `sleep 15`, then a reply of STARTED. The frames were:
  1. `system/background_tasks_changed{tasks:[{task_id, task_type:"local_bash", description}]}` and `system/task_started{is_backgrounded:true}`
  2. `result success "STARTED"` and `command_lifecycle completed`
  3. About 14 s of silence
  4. `system/background_tasks_changed{tasks:[]}`, `system/task_updated{patch:{status:"completed"}}`, `system/task_notification{status:"completed", output_file, summary}`
  5. **A new turn with no user frame:** `system/init`, then `assistant`, then `result{subtype:success, user_message_uuid:null, result_index:1}`, with **no `command_lifecycle` frames**

  The same happened on Haiku and the default model. So "no unprompted output while idle" holds only while no native background task is live. Fix 3 must:
  - treat an idle-session root `result` whose `user_message_uuid` is null as an unsolicited turn, not as a turn it owns;
  - route or record that unsolicited turn instead of attributing it to the next user turn;
  - not settle a live Codevo turn on it.

  Task 3.7's fake CLI must emit this sequence.

- **F2: `command_lifecycle` is the exact per-user-frame correlation.** Its `command_uuid` equals the `uuid` field of the sent user frame. The `result.user_message_uuid` equals it too. The terminal states seen were `completed` and `cancelled`.
- **F3: the Bash tool runs each command in its own session and process group.** The zsh wrapper has stat `Ss` and pgid equal to its own pid, not the CLI's pgid. A `nohup ... &` child keeps the wrapper's pgid and is reparented to pid 1. A signal to the CLI's process group (`agent_task_spawner.rs` `process_group(0)`) therefore does not reach Bash-tool descendants directly. Whatever currently kills them at turn end is the CLI's own teardown, not our group signal. Fix 2 and Fix 3 should not assume group membership.
- **F4:** After stdin closes on an idle session, the CLI exits 0 within about 0.4 to 0.6 s. It leaves detached (nohup) processes running.

Cost and calls: 4 CLI processes, 10 user turns and 2 unprompted turns in total:
- Haiku: main probe (4 turns, $0.048) and background mini-probe (1 user turn plus 1 unprompted turn, $0.039)
- Default model: main probe (4 turns, $0.209) and background mini-probe ($0.190)

The dollar figures are API-equivalent `total_cost_usd` values. The only session transcripts are under `~/.claude/projects/-private-tmp-codevo-claude-probe-*`.

### Task 3.1: Detector settle policy, re-arm and single-parse entry; lifecycle abandon

**Files:**
- Modify: `src-tauri/src/agent_task_result_detector.rs`
- Modify: `src-tauri/src/agent_task_result_detector_tests.rs` (append)
- Modify: `src-tauri/src/agent_claude_input_lifecycle.rs`

**Interfaces:**
- Produces:
  - `enum ResultSettlePolicy { SettleOnFailure (default), AwaitBackgroundWork }`
  - `ResultLineDetector::with_settle_policy(self, ResultSettlePolicy) -> Self`
  - `ResultLineDetector::consume_message(&mut self, &serde_json::Value) -> Result<bool, &'static str>`
  - `ResultLineDetector::rearm(&mut self, Option<Arc<ClaudeInputLifecycle>>)`
  - `ResultLineDetector::live_task_count(&self) -> usize`
  - `ResultLineDetector::session_id(&self) -> Option<&str>`
  - `pub fn lifecycle_candidate(line: &[u8]) -> bool`
  - `ClaudeInputLifecycle::abandon_all(&self)`
  - `pub(crate) fn command_id() -> String`

- [ ] **Step 1: Write the failing tests.** Append to `agent_task_result_detector_tests.rs`:

```rust
fn parsed(line: &[u8]) -> serde_json::Value {
    serde_json::from_slice(line).expect("fixture json")
}

const FAILED: &[u8] =
    b"{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true}\n";

#[test]
fn await_background_policy_keeps_a_failed_result_open_while_tasks_live() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(FAILED).unwrap());
    assert!(!detector.feed(DONE).unwrap());
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn await_background_policy_settles_a_failed_result_without_live_tasks() {
    let mut detector =
        ResultLineDetector::new().with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork);
    assert!(detector.feed(FAILED).unwrap());
}

#[test]
fn legacy_policy_still_settles_a_failed_result_immediately() {
    let mut detector = ResultLineDetector::new();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(detector.feed(FAILED).unwrap());
}

#[test]
fn rearm_allows_a_second_settlement_and_keeps_tombstones_and_session() {
    let mut detector = ResultLineDetector::new();
    detector
        .feed(b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-abcdefgh\"}\n")
        .unwrap();
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert!(!detector.feed(DONE).unwrap());
    assert!(detector.feed(RESULT).unwrap());
    detector.rearm(None);
    assert!(!detector.feed(start("watch").as_bytes()).unwrap());
    assert_eq!(detector.live_task_count(), 0, "a tombstoned task cannot resurrect");
    assert_eq!(detector.session_id(), Some("sess-abcdefgh"));
    assert!(detector.feed(RESULT).unwrap());
}

#[test]
fn consume_message_matches_feed() {
    let mut by_value = ResultLineDetector::new();
    assert!(!by_value.consume_message(&parsed(start("watch").as_bytes())).unwrap());
    assert!(!by_value.consume_message(&parsed(RESULT)).unwrap());
    assert!(!by_value.consume_message(&parsed(DONE)).unwrap());
    assert!(by_value.consume_message(&parsed(RESULT)).unwrap());
    assert!(!by_value.consume_message(&parsed(RESULT)).unwrap());
}
```

Append to the `tests` module of `agent_claude_input_lifecycle.rs`:

```rust
    #[test]
    fn abandon_all_lets_an_interrupted_turn_settle_and_ignores_late_cancellations() {
        let ledger = ready();
        let (id, _) = ledger.reserve(b"{}\n").unwrap();
        ledger.abandon_all();
        ledger.observe(&event(&id, "cancelled")).unwrap();
        ledger.observe(&json!({"type":"result"})).unwrap();
        assert!(ledger.close_if_settled());
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --lib agent_task_result_detector agent_claude_input_lifecycle`
Expected: compile FAIL, `cannot find type ResultSettlePolicy` / `no method named abandon_all`.

- [ ] **Step 3: Implement in `agent_task_result_detector.rs`**
  - Add `use std::sync::Arc;`.
  - Add the field `policy: ResultSettlePolicy` to `ResultLineDetector`. `Default` still derives, because the enum derives `Default`.
  - Delete the doc-comment sentence "This does not retain idle sessions for hypothetical later notifications." It becomes false.
  - Then:

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ResultSettlePolicy {
    #[default]
    SettleOnFailure,
    AwaitBackgroundWork,
}

impl ResultLineDetector {
    pub fn with_settle_policy(mut self, policy: ResultSettlePolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn rearm(
        &mut self,
        lifecycle: Option<
            Arc<crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle>,
        >,
    ) {
        self.fired = false;
        self.result_candidate = false;
        self.root_output = false;
        self.lifecycle = lifecycle;
    }

    pub fn live_task_count(&self) -> usize {
        self.live.len()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session.as_deref()
    }

    pub fn consume_message(&mut self, message: &Value) -> Result<bool, &'static str> {
        if self.fired {
            return Ok(false);
        }
        let settled = self.consume_value(message)?;
        if settled {
            self.fired = true;
        }
        Ok(settled)
    }
}
```

  Refactor `consume_line` to parse and delegate:

```rust
    fn consume_line(&mut self, line: &[u8]) -> Result<bool, &'static str> {
        let Ok(message) = serde_json::from_slice::<Value>(line) else {
            return Ok(false);
        };
        self.consume_value(&message)
    }
```

  Rename the old body, starting from the `parent_tool_use_id` check, to `fn consume_value(&mut self, message: &Value) -> Result<bool, &'static str>`, reading `message` instead of `&message`. In its `Some("result")` arm, replace `Ok(failed || self.settled())` with:

```rust
                let settle_on_failure = failed && self.policy == ResultSettlePolicy::SettleOnFailure;
                Ok(settle_on_failure || self.settled())
```

  Change `fn lifecycle_candidate` to `pub fn lifecycle_candidate`.

- [ ] **Step 4: Implement in `agent_claude_input_lifecycle.rs`.** Change `fn command_id()` to `pub(crate) fn command_id()` and add:

```rust
    pub fn abandon_all(&self) {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pending
            .clear();
    }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --lib agent_task_result_detector agent_claude_input_lifecycle && cargo test --test agent_task_supervisor_tests; echo "exit=$?"`
Expected: `exit=0`. The legacy supervisor behaviour is unchanged.

### Task 3.2: Pure session policy

**Files:**
- Create: `src-tauri/src/claude_session_policy.rs`
- Create: `src-tauri/src/claude_session_policy_tests.rs`
- Modify: `src-tauri/src/agent_task_spawner.rs`. Declare the module next to the Codex modules (:13-22). Each later Fix 3 task adds its own module declaration in the same place, because a declaration without its file does not compile:

```rust
#[path = "claude_session_policy.rs"]
pub mod claude_session_policy;
```

**Interfaces:**
- Produces everything the later tasks name:
  - `ClaudeSessionKey { workspace_id, thread_id }`
  - `ExecutableFingerprint`
  - `ClaudeSessionFingerprint`
  - `ClaudeSessionTuning` (+ `end_timeout()`)
  - `ClaudeSessionRestartPolicy { RefuseIfBackground, StopBackground }` (Deserialize, camelCase)
  - `ClaudeSessionEndReason` (Serialize, camelCase)
  - `ClaudeSessionEndedEvent { workspace_id, thread_id, reason, background_processes_stopped }` (Serialize, camelCase)
  - `ClaudeSessionRestartReason` (+ `needs_confirmation`)
  - `ClaudeSessionDisposition { Spawn, Reuse, Busy, Restart(reason) }`
  - `SessionAvailability { Idle, Attached, Ending }`
  - `LiveSessionFacts<'a>`, `RequestedSessionFacts<'a>`
  - `decide_session_disposition`
  - `EvictionCandidate`, `choose_eviction`
  - `idle_retirement_due`
  - `ClaudeSessionInspection` (Serialize, tag `kind`), `inspect_session`
  - `args_without_resume`
  - Constants `MAX_LIVE_CLAUDE_SESSIONS`, `CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR`, `CLAUDE_SESSION_BUSY_ERROR`, `CLAUDE_SESSION_STOP_TIMEOUT_ERROR`

- [ ] **Step 1: Write the failing tests** in `src-tauri/src/claude_session_policy_tests.rs`:

```rust
use super::*;
use crate::agent_task_spawner::agent_launch::{AgentLaunchOptions, ClaudeEffortChoice};
use std::time::{Duration, Instant};

fn fingerprint() -> ClaudeSessionFingerprint {
    ClaudeSessionFingerprint {
        executable: ExecutableFingerprint {
            path: PathBuf::from("/opt/claude"),
            size_bytes: 10,
            modified_epoch_ms: 20,
            device: 1,
            inode: 2,
        },
        provider_generation: 7,
        launch: AgentLaunchOptions::default(),
        args_without_resume: vec!["-p".to_string()],
        env: vec![("HOME".to_string(), "/home/a".to_string())],
        cwd: PathBuf::from("/repo"),
        cwd_identity: Some((1, 99)),
    }
}

fn live<'a>(
    fingerprint: &'a ClaudeSessionFingerprint,
    conversation: Option<&'a str>,
    availability: SessionAvailability,
) -> Option<LiveSessionFacts<'a>> {
    Some(LiveSessionFacts {
        fingerprint,
        conversation,
        availability,
    })
}

fn asked<'a>(
    fingerprint: &'a ClaudeSessionFingerprint,
    resume: Option<&'a str>,
) -> RequestedSessionFacts<'a> {
    RequestedSessionFacts {
        fingerprint,
        resume_session_id: resume,
    }
}

#[test]
fn spawns_without_a_live_session() {
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(None, asked(&wanted, None)),
        ClaudeSessionDisposition::Spawn
    );
}

#[test]
fn reuses_only_an_idle_identical_session_on_the_same_conversation() {
    let current = fingerprint();
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Idle),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Reuse
    );
}

#[test]
fn an_attached_session_is_busy_and_an_ending_one_is_replaced() {
    let current = fingerprint();
    let wanted = fingerprint();
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Attached),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Busy
    );
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Ending),
            asked(&wanted, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::Unhealthy)
    );
}

#[test]
fn provider_generation_or_binary_changes_restart_without_confirmation() {
    let current = fingerprint();
    let mut wanted = fingerprint();
    wanted.provider_generation = 8;
    let decision = decide_session_disposition(
        live(&current, Some("sess-1"), SessionAvailability::Idle),
        asked(&wanted, Some("sess-1")),
    );
    assert_eq!(
        decision,
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged)
    );
    assert!(!ClaudeSessionRestartReason::ProviderChanged.needs_confirmation());
    let mut rebuilt = fingerprint();
    rebuilt.executable.inode = 3;
    assert_eq!(
        decide_session_disposition(
            live(&current, Some("sess-1"), SessionAvailability::Idle),
            asked(&rebuilt, Some("sess-1"))
        ),
        ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged)
    );
}

#[test]
fn launch_args_env_or_cwd_identity_changes_restart_with_confirmation() {
    let current = fingerprint();
    let mut effort = fingerprint();
    effort.launch = match effort.launch {
        AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            context,
            fast_mode,
            thinking_mode,
            chrome,
            ..
        } => AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            effort: ClaudeEffortChoice::Low,
            context,
            fast_mode,
            thinking_mode,
            chrome,
        },
        other => other,
    };
    let mut recreated_cwd = fingerprint();
    recreated_cwd.cwd_identity = Some((1, 100));
    for wanted in [effort, recreated_cwd] {
        assert_eq!(
            decide_session_disposition(
                live(&current, Some("sess-1"), SessionAvailability::Idle),
                asked(&wanted, Some("sess-1"))
            ),
            ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::LaunchChanged)
        );
    }
    assert!(ClaudeSessionRestartReason::LaunchChanged.needs_confirmation());
}

#[test]
fn a_fresh_or_different_conversation_restarts() {
    let current = fingerprint();
    let wanted = fingerprint();
    for resume in [None, Some("sess-2")] {
        assert_eq!(
            decide_session_disposition(
                live(&current, Some("sess-1"), SessionAvailability::Idle),
                asked(&wanted, resume)
            ),
            ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ConversationChanged)
        );
    }
}

#[test]
fn args_without_resume_strips_only_the_resume_pair() {
    let args: Vec<String> = ["-p", "--resume", "sess-1", "--model", "opus"]
        .into_iter()
        .map(str::to_string)
        .collect();
    assert_eq!(args_without_resume(&args), vec!["-p", "--model", "opus"]);
}

fn candidate(key: &str, attached: bool, background: Option<bool>, age_secs: u64, generation: u64, now: Instant) -> EvictionCandidate {
    EvictionCandidate {
        key: ClaudeSessionKey {
            workspace_id: "ws".to_string(),
            thread_id: key.to_string(),
        },
        generation,
        attached,
        background,
        last_activity: now - Duration::from_secs(age_secs),
    }
}

#[test]
fn eviction_prefers_idle_sessions_without_background_then_oldest_then_lowest_generation() {
    let now = Instant::now();
    let candidates = vec![
        candidate("busy", true, Some(false), 900, 1, now),
        candidate("background-old", false, Some(true), 800, 2, now),
        candidate("quiet-new", false, Some(false), 10, 3, now),
        candidate("quiet-old", false, Some(false), 500, 4, now),
    ];
    assert_eq!(
        choose_eviction(&candidates).map(|key| key.thread_id.as_str()),
        Some("quiet-old")
    );
    let tie = vec![
        candidate("b", false, None, 100, 9, now),
        candidate("a", false, None, 100, 5, now),
    ];
    assert_eq!(
        choose_eviction(&tie).map(|key| key.thread_id.as_str()),
        Some("a")
    );
    assert!(choose_eviction(&[candidate("busy", true, None, 1, 1, now)]).is_none());
}

#[test]
fn idle_retirement_uses_the_detached_work_ttl_only_for_proven_background_members() {
    let tuning = ClaudeSessionTuning::default();
    let now = Instant::now();
    let idle_since = now - tuning.idle_ttl;
    assert!(idle_retirement_due(&tuning, SessionAvailability::Idle, Some(false), idle_since, now));
    assert!(idle_retirement_due(&tuning, SessionAvailability::Idle, None, idle_since, now));
    assert!(!idle_retirement_due(&tuning, SessionAvailability::Idle, Some(true), idle_since, now));
    assert!(!idle_retirement_due(&tuning, SessionAvailability::Attached, Some(false), now - tuning.detached_work_ttl, now));
    assert!(idle_retirement_due(&tuning, SessionAvailability::Idle, Some(true), now - tuning.detached_work_ttl, now));
}

#[test]
fn inspection_and_ended_event_serialize_to_the_pinned_wire_shape() {
    assert_eq!(
        serde_json::to_string(&ClaudeSessionInspection::Restart { background_processes: true }).unwrap(),
        r#"{"kind":"restart","backgroundProcesses":true}"#
    );
    assert_eq!(
        serde_json::to_string(&ClaudeSessionInspection::None).unwrap(),
        r#"{"kind":"none"}"#
    );
    let event = ClaudeSessionEndedEvent {
        workspace_id: "ws-1".to_string(),
        thread_id: "agt-1-0a1c".to_string(),
        reason: ClaudeSessionEndReason::IdleTimeout,
        background_processes_stopped: true,
    };
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","reason":"idleTimeout","backgroundProcessesStopped":true}"#
    );
    let policy: ClaudeSessionRestartPolicy = serde_json::from_str(r#""stopBackground""#).unwrap();
    assert_eq!(policy, ClaudeSessionRestartPolicy::StopBackground);
}

#[test]
fn inspect_reports_restart_for_a_changed_launch_or_conversation() {
    let current = fingerprint();
    let facts = LiveSessionFacts {
        fingerprint: &current,
        conversation: Some("sess-1"),
        availability: SessionAvailability::Idle,
    };
    assert_eq!(
        inspect_session(Some((facts, true)), &current.launch, Some("sess-1"), 7),
        ClaudeSessionInspection::Reuse { background_processes: true }
    );
    let facts = LiveSessionFacts {
        fingerprint: &current,
        conversation: Some("sess-1"),
        availability: SessionAvailability::Idle,
    };
    assert_eq!(
        inspect_session(Some((facts, false)), &current.launch, Some("sess-2"), 7),
        ClaudeSessionInspection::Restart { background_processes: false }
    );
    assert_eq!(
        inspect_session(None, &current.launch, None, 7),
        ClaudeSessionInspection::None
    );
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --lib claude_session_policy`
Expected: compile FAIL (module file missing).

- [ ] **Step 3: Implement `src-tauri/src/claude_session_policy.rs`**

```rust
use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub const MAX_LIVE_CLAUDE_SESSIONS: usize = 8;
pub const CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR: &str = "sessionRestartRequiresConfirmation: Continuing restarts Claude for this thread and stops the background processes it started.";
pub const CLAUDE_SESSION_BUSY_ERROR: &str =
    "This thread's Claude session is busy. Retry in a moment.";
pub const CLAUDE_SESSION_STOP_TIMEOUT_ERROR: &str =
    "The previous Claude session for this thread could not be stopped in time.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClaudeSessionTuning {
    pub max_live_sessions: usize,
    pub idle_ttl: Duration,
    pub detached_work_ttl: Duration,
    pub interrupt_deadline: Duration,
    pub graceful_stop: Duration,
    pub force_stop: Duration,
    pub clean_exit_grace: Duration,
    pub reader_drain: Duration,
}

impl Default for ClaudeSessionTuning {
    fn default() -> Self {
        Self {
            max_live_sessions: MAX_LIVE_CLAUDE_SESSIONS,
            idle_ttl: Duration::from_secs(30 * 60),
            detached_work_ttl: Duration::from_secs(12 * 60 * 60),
            interrupt_deadline: Duration::from_secs(10),
            graceful_stop: Duration::from_millis(500),
            force_stop: Duration::from_millis(500),
            clean_exit_grace: Duration::from_secs(2),
            reader_drain: Duration::from_secs(2),
        }
    }
}

impl ClaudeSessionTuning {
    pub fn end_timeout(&self) -> Duration {
        self.graceful_stop + self.force_stop + self.reader_drain + Duration::from_secs(1)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ClaudeSessionKey {
    pub workspace_id: String,
    pub thread_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutableFingerprint {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_epoch_ms: u64,
    pub device: u64,
    pub inode: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaudeSessionFingerprint {
    pub executable: ExecutableFingerprint,
    pub provider_generation: u64,
    pub launch: AgentLaunchOptions,
    pub args_without_resume: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
    pub cwd_identity: Option<(u64, u64)>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionRestartPolicy {
    #[default]
    RefuseIfBackground,
    StopBackground,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionEndReason {
    Stopped,
    Exited,
    Crashed,
    ProtocolError,
    IdleTimeout,
    Evicted,
    Restarted,
    Released,
    ThreadEnded,
    ProviderUpdated,
    Shutdown,
    UnownedActivity,
    InterruptTimedOut,
    InputFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionEndedEvent {
    pub workspace_id: String,
    pub thread_id: String,
    pub reason: ClaudeSessionEndReason,
    pub background_processes_stopped: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaudeSessionRestartReason {
    ProviderChanged,
    LaunchChanged,
    ConversationChanged,
    Unhealthy,
}

impl ClaudeSessionRestartReason {
    pub fn needs_confirmation(self) -> bool {
        matches!(self, Self::LaunchChanged | Self::ConversationChanged)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaudeSessionDisposition {
    Spawn,
    Reuse,
    Busy,
    Restart(ClaudeSessionRestartReason),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionAvailability {
    Idle,
    Attached,
    Ending,
}

pub struct LiveSessionFacts<'a> {
    pub fingerprint: &'a ClaudeSessionFingerprint,
    pub conversation: Option<&'a str>,
    pub availability: SessionAvailability,
}

pub struct RequestedSessionFacts<'a> {
    pub fingerprint: &'a ClaudeSessionFingerprint,
    pub resume_session_id: Option<&'a str>,
}

pub fn decide_session_disposition(
    live: Option<LiveSessionFacts<'_>>,
    requested: RequestedSessionFacts<'_>,
) -> ClaudeSessionDisposition {
    let Some(live) = live else {
        return ClaudeSessionDisposition::Spawn;
    };
    match live.availability {
        SessionAvailability::Attached => return ClaudeSessionDisposition::Busy,
        SessionAvailability::Ending => {
            return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::Unhealthy)
        }
        SessionAvailability::Idle => {}
    }
    if live.fingerprint.executable != requested.fingerprint.executable
        || live.fingerprint.provider_generation != requested.fingerprint.provider_generation
    {
        return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged);
    }
    if live.fingerprint != requested.fingerprint {
        return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::LaunchChanged);
    }
    match (live.conversation, requested.resume_session_id) {
        (Some(current), Some(wanted)) if current == wanted => ClaudeSessionDisposition::Reuse,
        _ => ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ConversationChanged),
    }
}

#[derive(Clone, Debug)]
pub struct EvictionCandidate {
    pub key: ClaudeSessionKey,
    pub generation: u64,
    pub attached: bool,
    pub background: Option<bool>,
    pub last_activity: Instant,
}

pub fn choose_eviction(candidates: &[EvictionCandidate]) -> Option<&ClaudeSessionKey> {
    candidates
        .iter()
        .filter(|candidate| !candidate.attached)
        .min_by_key(|candidate| {
            (
                candidate.background == Some(true),
                candidate.last_activity,
                candidate.generation,
            )
        })
        .map(|candidate| &candidate.key)
}

pub fn idle_retirement_due(
    tuning: &ClaudeSessionTuning,
    availability: SessionAvailability,
    background: Option<bool>,
    idle_since: Instant,
    now: Instant,
) -> bool {
    if availability != SessionAvailability::Idle {
        return false;
    }
    let ttl = match background {
        Some(true) => tuning.detached_work_ttl,
        Some(false) | None => tuning.idle_ttl,
    };
    now.saturating_duration_since(idle_since) >= ttl
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClaudeSessionInspection {
    None,
    Reuse {
        #[serde(rename = "backgroundProcesses")]
        background_processes: bool,
    },
    Restart {
        #[serde(rename = "backgroundProcesses")]
        background_processes: bool,
    },
}

pub fn inspect_session(
    live: Option<(LiveSessionFacts<'_>, bool)>,
    launch: &AgentLaunchOptions,
    resume_session_id: Option<&str>,
    provider_generation: u64,
) -> ClaudeSessionInspection {
    let Some((facts, background_processes)) = live else {
        return ClaudeSessionInspection::None;
    };
    let reusable = facts.availability == SessionAvailability::Idle
        && facts.fingerprint.launch == *launch
        && facts.fingerprint.provider_generation == provider_generation
        && resume_session_id.is_some()
        && facts.conversation == resume_session_id;
    if reusable {
        return ClaudeSessionInspection::Reuse {
            background_processes,
        };
    }
    ClaudeSessionInspection::Restart {
        background_processes,
    }
}

pub fn args_without_resume(args: &[String]) -> Vec<String> {
    let mut kept = Vec::with_capacity(args.len());
    let mut skip_value = false;
    for arg in args {
        if skip_value {
            skip_value = false;
            continue;
        }
        if arg == "--resume" {
            skip_value = true;
            continue;
        }
        kept.push(arg.clone());
    }
    kept
}

#[cfg(test)]
#[path = "claude_session_policy_tests.rs"]
mod tests;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --lib claude_session_policy`
Expected: PASS (11 tests).

### Task 3.3: Session stdout router

**Files:**
- Create: `src-tauri/src/claude_session_router.rs`
- Create: `src-tauri/src/claude_session_router_tests.rs`
- Modify: `src-tauri/src/agent_task_spawner.rs` (module declaration `#[path = "claude_session_router.rs"] pub mod claude_session_router;`)

**Interfaces:**
- Consumes: the Task 3.1 detector API.
- Produces:
  - `ClaudeSessionRouter::{new, attach(Arc<ClaudeInputLifecycle>), detach, interrupt_sent(String), conversation() -> Option<&str>, live_background_tasks() -> usize, feed(&[u8]) -> RouterStep}`
  - `RouterStep { turn_bytes: usize, settled: bool, interrupt_acknowledged: bool, unowned_activity: bool, failure: Option<&'static str> }`

- [ ] **Step 1: Write the failing tests** in `claude_session_router_tests.rs`:

```rust
use super::*;
use crate::agent_task_spawner::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;

const ASSISTANT: &[u8] = b"{\"type\":\"assistant\",\"session_id\":\"sess-abcdefgh\",\"message\":{\"content\":[]}}\n";
const RESULT: &[u8] = b"{\"type\":\"result\",\"subtype\":\"success\",\"num_turns\":1,\"session_id\":\"sess-abcdefgh\"}\n";
const INIT: &[u8] = b"{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-abcdefgh\"}\n";
const KEEP_ALIVE: &[u8] = b"{\"type\":\"keep_alive\"}\n";

fn attached() -> ClaudeSessionRouter {
    let mut router = ClaudeSessionRouter::new();
    router.attach(Arc::new(ClaudeInputLifecycle::new()));
    router
}

#[test]
fn an_attached_turn_owns_bytes_up_to_and_including_the_settling_line() {
    let mut router = attached();
    let chunk = [ASSISTANT, RESULT, KEEP_ALIVE].concat();
    let step = router.feed(&chunk);
    assert!(step.settled);
    assert_eq!(step.turn_bytes, ASSISTANT.len() + RESULT.len());
    assert!(!step.unowned_activity);
    assert_eq!(router.conversation(), Some("sess-abcdefgh"));
}

#[test]
fn settlement_across_chunk_boundaries_is_found_exactly_once() {
    let stream = [ASSISTANT, RESULT].concat();
    for split in 1..stream.len() {
        let mut router = attached();
        let first = router.feed(&stream[..split]);
        let second = router.feed(&stream[split..]);
        assert_eq!(first.turn_bytes, split, "split {split}");
        assert_eq!(usize::from(first.settled) + usize::from(second.settled), 1, "split {split}");
        assert_eq!(first.turn_bytes + second.turn_bytes, stream.len(), "split {split}");
    }
}

#[test]
fn a_live_background_task_keeps_the_turn_attached_past_the_result() {
    let mut router = attached();
    let started = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"watch\",\"task_type\":\"local_bash\"}\n";
    let done = b"{\"type\":\"system\",\"subtype\":\"task_notification\",\"task_id\":\"watch\",\"status\":\"completed\"}\n";
    assert!(!router.feed(started).settled);
    assert!(!router.feed(RESULT).settled);
    assert_eq!(router.live_background_tasks(), 1);
    assert!(!router.feed(done).settled);
    assert!(router.feed(RESULT).settled);
}

#[test]
fn idle_root_activity_is_unowned_but_metadata_is_not() {
    let mut router = ClaudeSessionRouter::new();
    for benign in [INIT, KEEP_ALIVE] {
        let step = router.feed(benign);
        assert_eq!(step.turn_bytes, 0);
        assert!(!step.unowned_activity);
    }
    assert!(router.feed(ASSISTANT).unowned_activity);
    let mut router = ClaudeSessionRouter::new();
    assert!(router
        .feed(b"{\"type\":\"control_request\",\"request_id\":\"r1\",\"request\":{\"subtype\":\"can_use_tool\"}}\n")
        .unowned_activity);
}

#[test]
fn interrupt_acknowledgement_matches_only_the_pending_request() {
    let mut router = attached();
    router.interrupt_sent("req-1".to_string());
    let foreign = b"{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"req-2\"}}\n";
    let own = b"{\"type\":\"control_response\",\"response\":{\"subtype\":\"success\",\"request_id\":\"req-1\"}}\n";
    assert!(!router.feed(foreign).interrupt_acknowledged);
    assert!(router.feed(own).interrupt_acknowledged);
    assert!(!router.feed(own).interrupt_acknowledged, "acknowledged once");
}

#[test]
fn an_interrupted_failed_result_settles_the_turn() {
    let mut router = attached();
    let failed = b"{\"type\":\"result\",\"subtype\":\"error_during_execution\",\"is_error\":true}\n";
    assert!(router.feed(failed).settled);
}

#[test]
fn an_oversized_lifecycle_line_is_a_protocol_failure() {
    let mut router = attached();
    let mut line = b"{\"type\":\"system\",\"subtype\":\"task_started\",\"pad\":\"".to_vec();
    line.resize(1024 * 1024 + 16, b'x');
    assert!(router.feed(&line).failure.is_some());
}

#[test]
fn reattach_after_settlement_starts_a_fresh_turn_boundary() {
    let mut router = attached();
    assert!(router.feed(RESULT).settled);
    router.attach(Arc::new(ClaudeInputLifecycle::new()));
    let step = router.feed(ASSISTANT);
    assert_eq!(step.turn_bytes, ASSISTANT.len());
    assert!(!step.settled);
    assert!(router.feed(RESULT).settled);
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --lib claude_session_router`
Expected: compile FAIL.

- [ ] **Step 3: Implement `claude_session_router.rs`**

```rust
use super::agent_task_input::claude_lifecycle::ClaudeInputLifecycle;
use crate::agent_task_supervisor::agent_task_result_detector::{
    lifecycle_candidate, ResultLineDetector, ResultSettlePolicy,
};
use serde_json::Value;
use std::sync::Arc;

const MAX_ROUTED_LINE_BYTES: usize = 1024 * 1024;
const OVERSIZED_FRAME_ERROR: &str = "Claude session frame exceeded its size limit.";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RouterStep {
    pub turn_bytes: usize,
    pub settled: bool,
    pub interrupt_acknowledged: bool,
    pub unowned_activity: bool,
    pub failure: Option<&'static str>,
}

pub struct ClaudeSessionRouter {
    detector: ResultLineDetector,
    attached: bool,
    pending_interrupt: Option<String>,
    line: Vec<u8>,
    skipping: bool,
}

impl Default for ClaudeSessionRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeSessionRouter {
    pub fn new() -> Self {
        Self {
            detector: ResultLineDetector::new()
                .with_settle_policy(ResultSettlePolicy::AwaitBackgroundWork),
            attached: false,
            pending_interrupt: None,
            line: Vec::new(),
            skipping: false,
        }
    }

    pub fn attach(&mut self, lifecycle: Arc<ClaudeInputLifecycle>) {
        self.detector.rearm(Some(lifecycle));
        self.attached = true;
        self.pending_interrupt = None;
    }

    pub fn detach(&mut self) {
        self.detector.rearm(None);
        self.attached = false;
        self.pending_interrupt = None;
    }

    pub fn interrupt_sent(&mut self, request_id: String) {
        self.pending_interrupt = Some(request_id);
    }

    pub fn conversation(&self) -> Option<&str> {
        self.detector.session_id()
    }

    pub fn live_background_tasks(&self) -> usize {
        self.detector.live_task_count()
    }

    pub fn feed(&mut self, chunk: &[u8]) -> RouterStep {
        let mut step = RouterStep::default();
        let owned_from_start = self.attached;
        let mut settled_at: Option<usize> = None;
        for (index, byte) in chunk.iter().enumerate() {
            if *byte != b'\n' {
                self.push(*byte, &mut step);
                if step.failure.is_some() {
                    break;
                }
                continue;
            }
            if !self.skipping {
                let line = std::mem::take(&mut self.line);
                let was_attached = self.attached;
                self.route(&line, &mut step);
                if was_attached && !self.attached && settled_at.is_none() {
                    settled_at = Some(index + 1);
                }
            }
            self.line.clear();
            self.skipping = false;
            if step.failure.is_some() {
                break;
            }
        }
        step.turn_bytes = match (owned_from_start, settled_at) {
            (false, _) => 0,
            (true, Some(end)) => end,
            (true, None) => chunk.len(),
        };
        step
    }

    fn push(&mut self, byte: u8, step: &mut RouterStep) {
        if self.skipping {
            return;
        }
        if self.line.len() < MAX_ROUTED_LINE_BYTES {
            self.line.push(byte);
            return;
        }
        if lifecycle_candidate(&self.line) {
            step.failure = Some(OVERSIZED_FRAME_ERROR);
        }
        self.line.clear();
        self.skipping = true;
    }

    fn route(&mut self, line: &[u8], step: &mut RouterStep) {
        let Ok(message) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        if self.acknowledges_interrupt(&message) {
            step.interrupt_acknowledged = true;
        }
        if !self.attached {
            if unowned_root_activity(&message) {
                step.unowned_activity = true;
            }
            let _ = self.detector.consume_message(&message);
            return;
        }
        match self.detector.consume_message(&message) {
            Ok(true) => {
                step.settled = true;
                self.attached = false;
                self.pending_interrupt = None;
            }
            Ok(false) => {}
            Err(message) => step.failure = Some(message),
        }
    }

    fn acknowledges_interrupt(&mut self, message: &Value) -> bool {
        if message.get("type").and_then(Value::as_str) != Some("control_response") {
            return false;
        }
        let id = message
            .pointer("/response/request_id")
            .and_then(Value::as_str);
        if id.is_none() || id != self.pending_interrupt.as_deref() {
            return false;
        }
        self.pending_interrupt = None;
        true
    }
}

fn unowned_root_activity(message: &Value) -> bool {
    if !message.get("parent_tool_use_id").is_none_or(Value::is_null) {
        return false;
    }
    match message.get("type").and_then(Value::as_str) {
        Some("assistant" | "user" | "result" | "stream_event" | "control_request") => true,
        Some("system") => matches!(
            message.get("subtype").and_then(Value::as_str),
            Some("task_started" | "task_progress")
        ),
        _ => false,
    }
}

#[cfg(test)]
#[path = "claude_session_router_tests.rs"]
mod tests;
```

`acknowledges_interrupt` is evaluated before detaching, so an acknowledgement that arrives in the same chunk as the settling result is still matched.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --lib claude_session_router claude_session_policy agent_task_result_detector; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 5: C1 review checkpoint.** Send a read-only Opus 5 review of Tasks 3.1-3.3: "pure modules; no process, no locks, closed enums, chunk-boundary correctness, fail-closed oversize." The lead commits after approval:

```bash
git add src-tauri/src/agent_task_result_detector.rs src-tauri/src/agent_task_result_detector_tests.rs src-tauri/src/agent_claude_input_lifecycle.rs src-tauri/src/claude_session_policy.rs src-tauri/src/claude_session_policy_tests.rs src-tauri/src/claude_session_router.rs src-tauri/src/claude_session_router_tests.rs src-tauri/src/agent_task_spawner.rs
git commit -m "feat(agent): add pure Claude session policy and stdout router"
```

### Task 3.4: Input interrupt port and spawner extraction (behaviour-preserving)

**Files:**
- Modify: `src-tauri/src/agent_task_input.rs` (trait :62-81, `AgentTaskInputSlot` :113-300)
- Modify: `src-tauri/src/agent_task_input_tests.rs` (append)
- Modify: `src-tauri/src/agent_task_spawner.rs`:
  - `StdAgentProcessSpawner::spawn` :653-726 becomes `spawn_bound_process` + `spawn_per_turn_process`
  - add a non-unix `observe_exit_without_reaping` stub

**Interfaces:**
- Produces:
  - `AgentTaskInput::provider_owns_settlement(&self) -> bool` (default `false`)
  - `AgentTaskInput::interrupt(&mut self, deadline: Instant) -> io::Result<()>` (default `Unsupported`)
  - `enum AgentTaskInterruptRejection { Unsupported, Unavailable, WriteFailed }`
  - `AgentTaskInputSlot::provider_owns_settlement(&self) -> bool`
  - `AgentTaskInputSlot::interrupt(&self, deadline) -> Result<(), AgentTaskInterruptRejection>`
  - `pub(crate) fn spawn_bound_process(plan: &AgentTaskSpawnPlan, stdin: Stdio) -> Result<(Child, i32), String>`
  - `pub(crate) fn spawn_per_turn_process(plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String>`

- [ ] **Step 1: Write the failing input tests.** Append to `agent_task_input_tests.rs`:

```rust
struct InterruptingWriter {
    interrupts: Arc<AtomicUsize>,
    failure: Option<io::ErrorKind>,
}

impl AgentTaskInput for InterruptingWriter {
    fn provider_owns_settlement(&self) -> bool {
        true
    }

    fn write_frame(&mut self, _frame: &[u8], _deadline: Instant) -> io::Result<()> {
        Ok(())
    }

    fn interrupt(&mut self, _deadline: Instant) -> io::Result<()> {
        self.interrupts.fetch_add(1, Ordering::SeqCst);
        match self.failure {
            Some(kind) => Err(io::Error::from(kind)),
            None => Ok(()),
        }
    }

    fn close(&mut self) {}
}

fn interrupting_slot(failure: Option<io::ErrorKind>) -> (AgentTaskInputSlot, Arc<AtomicUsize>) {
    let interrupts = Arc::new(AtomicUsize::new(0));
    let writer = InterruptingWriter {
        interrupts: Arc::clone(&interrupts),
        failure,
    };
    (AgentTaskInputSlot::new(Box::new(writer), None), interrupts)
}

#[test]
fn legacy_writers_neither_own_settlement_nor_interrupt() {
    let slot = slot_with(RecordingWriter::new());
    assert!(!slot.provider_owns_settlement());
    assert_eq!(
        slot.interrupt(deadline()),
        Err(AgentTaskInterruptRejection::Unsupported)
    );
}

#[test]
fn a_session_writer_interrupts_and_maps_failures_truthfully() {
    let (slot, interrupts) = interrupting_slot(None);
    assert!(slot.provider_owns_settlement());
    assert_eq!(slot.interrupt(deadline()), Ok(()));
    assert_eq!(interrupts.load(Ordering::SeqCst), 1);
    let (slot, _) = interrupting_slot(Some(io::ErrorKind::WouldBlock));
    assert_eq!(
        slot.interrupt(deadline()),
        Err(AgentTaskInterruptRejection::Unavailable)
    );
    let (slot, _) = interrupting_slot(Some(io::ErrorKind::BrokenPipe));
    assert_eq!(
        slot.interrupt(deadline()),
        Err(AgentTaskInterruptRejection::WriteFailed)
    );
}

#[test]
fn a_closed_slot_refuses_to_interrupt() {
    let (slot, interrupts) = interrupting_slot(None);
    slot.close(AgentTaskInputState::ClosedByStop);
    assert_eq!(
        slot.interrupt(deadline()),
        Err(AgentTaskInterruptRejection::Unavailable)
    );
    assert_eq!(interrupts.load(Ordering::SeqCst), 0);
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --lib agent_task_input`
Expected: compile FAIL, `cannot find type AgentTaskInterruptRejection`.

- [ ] **Step 3: Implement in `agent_task_input.rs`.** Add to the `AgentTaskInput` trait:

```rust
    fn provider_owns_settlement(&self) -> bool {
        false
    }
    fn interrupt(&mut self, _deadline: Instant) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
```

Add the rejection type:

```rust
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum AgentTaskInterruptRejection {
    Unsupported,
    Unavailable,
    WriteFailed,
}
```

Give `AgentTaskInputSlot` a `provider_owns_settlement: bool` field, captured in `new` from `writer.provider_owns_settlement()` before the writer is boxed into the mutex. Add:

```rust
    pub fn provider_owns_settlement(&self) -> bool {
        self.provider_owns_settlement
    }

    pub fn interrupt(&self, deadline: Instant) -> Result<(), AgentTaskInterruptRejection> {
        if self.state().rejection().is_some() {
            return Err(AgentTaskInterruptRejection::Unavailable);
        }
        let mut writer = lock_before(&self.writer, deadline)
            .map_err(|_| AgentTaskInterruptRejection::WriteFailed)?;
        let Some(handle) = writer.as_mut() else {
            return Err(AgentTaskInterruptRejection::Unavailable);
        };
        match handle.interrupt(deadline) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::Unsupported => {
                Err(AgentTaskInterruptRejection::Unsupported)
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Err(AgentTaskInterruptRejection::Unavailable)
            }
            Err(_) => Err(AgentTaskInterruptRejection::WriteFailed),
        }
    }
```

- [ ] **Step 4: Split the spawner.** In `agent_task_spawner.rs`, replace `impl AgentProcessSpawner for StdAgentProcessSpawner` with this. The two bodies are the old code cut at the point where `process_group_id` is known:

```rust
impl AgentProcessSpawner for StdAgentProcessSpawner {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        if let Some(app_server) = &plan.app_server {
            return app_server.spawn();
        }
        spawn_per_turn_process(plan)
    }
}

pub(crate) fn spawn_bound_process(
    plan: &AgentTaskSpawnPlan,
    stdin: Stdio,
) -> Result<(Child, i32), String> {
    let mut bound = plan
        .executable_identity
        .bound_command()
        .map_err(|_| "Agent CLI executable identity changed before launch.".to_string())?;
    let command = bound.command_mut();
    command
        .args(plan.args())
        .env_clear()
        .envs(plan.env().iter().cloned())
        .stdin(stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;

        if let Some(cwd_authority) = plan.cwd_authority() {
            let cwd_fd = cwd_authority.as_raw_fd();
            unsafe {
                command.pre_exec(move || {
                    if libc::fchdir(cwd_fd) == 0 {
                        return Ok(());
                    }
                    Err(io::Error::last_os_error())
                });
            }
        }
        if plan.cwd_authority().is_none() {
            command.current_dir(plan.cwd());
        }
        command.process_group(0);
    }
    #[cfg(not(unix))]
    command.current_dir(plan.cwd());
    let mut child = match bound.spawn() {
        Ok(child) => child,
        Err(agent_provider::process::BoundExecutableSpawnFailure::IdentityChanged) => {
            return Err("Agent CLI executable identity changed before launch.".to_string());
        }
        Err(agent_provider::process::BoundExecutableSpawnFailure::Spawn(error)) => {
            return Err(format!("Unable to launch agent task: {error}"));
        }
    };
    let Ok(process_group_id) = i32::try_from(child.id()) else {
        let _ = child.kill();
        let _ = reap_child(&mut child);
        return Err("Agent process identifier is not addressable.".to_string());
    };
    Ok((child, process_group_id))
}

pub(crate) fn spawn_per_turn_process(
    plan: &AgentTaskSpawnPlan,
) -> Result<Box<dyn AgentChild>, String> {
    let stdin = match plan.stdin_frame() {
        Some(_) => Stdio::piped(),
        None => Stdio::null(),
    };
    let (mut child, process_group_id) = spawn_bound_process(plan, stdin)?;
    let lifecycle = plan
        .stdin_frame()
        .map(|_| Arc::new(agent_task_input::claude_lifecycle::ClaudeInputLifecycle::new()));
    let input = plan.stdin_frame().and_then(|frame| {
        let retained: RetainedChildStdin =
            Arc::new(RetainedAgentStdin::new(child.stdin.take()?));
        let frame = lifecycle.as_ref().map_or_else(
            || Arc::clone(frame),
            |lifecycle| lifecycle.initial_frame(frame).into(),
        );
        write_prompt_frame_on_a_dedicated_thread(&retained, frame);
        Some(retained)
    });
    let questions = input
        .as_ref()
        .map(|_| Arc::new(crate::agent_questions::AgentQuestionSession::new()));
    let question_input = input.clone();
    Ok(Box::new(StdAgentChild {
        child,
        process_group_id,
        observed_exit_code: None,
        input,
        questions,
        question_input,
        lifecycle,
    }))
}
```

Add the non-unix stub next to the unix `observe_exit_without_reaping`:

```rust
#[cfg(not(unix))]
pub(crate) fn observe_exit_without_reaping(_child: &Child) -> io::Result<bool> {
    Err(io::ErrorKind::Unsupported.into())
}
```

- [ ] **Step 5: Run the tests and confirm they pass, with the spawner behaviour unchanged**

Run: `cd src-tauri && cargo test --lib agent_task_input agent_task_spawner && cargo test --test agent_task_supervisor_tests; echo "exit=$?"`
Expected: `exit=0`.

### Task 3.5: Session process owner and per-turn child

**Files:**
- Create: `src-tauri/src/claude_thread_session.rs`
- Create: `src-tauri/src/claude_session_turn.rs`
- Modify: `src-tauri/src/agent_task_spawner.rs` (module declarations below the router declaration):

```rust
#[path = "claude_thread_session.rs"]
pub mod claude_thread_session;
#[path = "claude_session_turn.rs"]
pub mod claude_session_turn;
```

- Create: `src-tauri/tests/support/fake_claude_cli.rs` (shared fake CLI)
- Create: `src-tauri/tests/support/claude_thread_session_tests.rs`
- Modify: `src-tauri/tests/agent_task_supervisor_tests.rs` (tail includes)

**Interfaces:**
- Consumes:
  - `terminate_group_survivors` and `system_process_group_signals` (Task 2.2)
  - the router (Task 3.3)
  - `spawn_bound_process` and the input trait (Task 3.4)
  - `command_id` and `abandon_all` (Task 3.1)
- Produces:
  - `trait ClaudeSessionOwner { fn session_ended(&self, key: &ClaudeSessionKey, generation: u64, reason: ClaudeSessionEndReason, background_processes_stopped: bool) }`
  - `ClaudeSessionIdentity { key, generation, fingerprint, repository_root }`
  - `ClaudeSessionFacts { availability, fingerprint, conversation, generation, idle_since, last_activity }`
  - `enum TurnOutcome { Settled, Interrupted, ProcessExited(i32), Failed(&'static str) }`
  - `ClaudeThreadSession::{start, attach_turn(&[u8]), terminate(reason), kill_now(reason), wait_reaped(Duration) -> bool, facts(), has_background_processes(), background_processes() -> Option<bool>, key(), generation(), repository_root(), cwd(), stdin()}`
  - `ClaudeSessionTurnChild` (an `AgentChild` with `SharedSession` ownership, plus `outcome()`)
  - `ClaudeSessionTurnInput` (an `AgentTaskInput` with `provider_owns_settlement() == true`)
  - `TurnOutputReader`

- [ ] **Step 1: Write the shared fake CLI.** Create `src-tauri/tests/support/fake_claude_cli.rs`. The emitted frames must match what the Task 3.0 probe observed. If the probe showed a different interrupted-result subtype, or `system/init` only once per process, adjust the two marked lines to match, and nothing else.

```rust
use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionFingerprint, ExecutableFingerprint,
};

pub(crate) const FAKE_CLAUDE_PY: &str = r#"
import json, os, subprocess, sys, threading, time
state_dir = sys.argv[1]
session_id = os.environ.get("FAKE_CLAUDE_SESSION", "sess-fixture-0001")
with open(os.path.join(state_dir, "cli.pid"), "a") as handle:
    handle.write(f"{os.getpid()}\n")
busy = None
ignore_interrupt = False
lock = threading.Lock()

def emit(message):
    with lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

def result(ok=True, subtype="success"):
    emit({"type": "result", "subtype": subtype, "is_error": not ok, "num_turns": 1,
          "result": "ok" if ok else "", "session_id": session_id})

def late_activity():
    time.sleep(0.3)
    emit({"type": "assistant", "session_id": session_id, "message": {"content": [{"type": "text", "text": "unprompted"}]}})

for raw in sys.stdin:
    try:
        frame = json.loads(raw)
    except ValueError:
        continue
    kind = frame.get("type")
    if kind == "control_request":
        request = frame.get("request") or {}
        if request.get("subtype") == "interrupt":
            emit({"type": "control_response", "response": {"subtype": "success", "request_id": frame.get("request_id")}})
            if busy is not None and not ignore_interrupt:
                emit({"type": "command_lifecycle", "command_uuid": busy, "state": "completed"})
                result(ok=False, subtype="error_during_execution")  # probe: interrupted result subtype
                busy = None
        continue
    if kind != "user":
        continue
    uid = frame.get("uuid", "")
    content = frame["message"]["content"]
    text = content if isinstance(content, str) else "".join(block.get("text", "") for block in content if block.get("type") == "text")
    emit({"type": "system", "subtype": "init", "session_id": session_id})  # probe: init per turn
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": "started"})
    emit({"type": "assistant", "session_id": session_id, "message": {"content": [{"type": "text", "text": "echo:" + text}]}})
    if text.startswith("spawn-background"):
        subprocess.run(["/bin/sh", "-c", "sleep 300 </dev/null >/dev/null 2>&1 & echo $! > \"$1\"", "sh",
                        os.path.join(state_dir, "background.pid")], check=True)
    if text.startswith("crash"):
        os._exit(9)
    if text.startswith("slow"):
        busy = uid
        ignore_interrupt = text.startswith("slow-ignore")
        continue
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": "completed"})
    result()
    if text.startswith("late-activity"):
        threading.Thread(target=late_activity, daemon=True).start()
"#;

pub(crate) struct FakeCli {
    pub(crate) dir: PathBuf,
    python: PathBuf,
}

impl FakeCli {
    pub(crate) fn new(label: &str) -> Self {
        let dir = unique_path(label);
        fs::create_dir_all(&dir).expect("fake cli directory");
        let python = probe_binary(&[
            "/usr/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
        ])
        .expect("python3 for the fake Claude CLI");
        Self { dir, python }
    }

    pub(crate) fn plan(&self, session_id: &str, prompt: &str) -> AgentTaskSpawnPlan {
        AgentTaskSpawnPlan::for_tests(
            self.python.clone(),
            vec![
                "-u".to_string(),
                "-c".to_string(),
                FAKE_CLAUDE_PY.to_string(),
                self.dir.to_string_lossy().into_owned(),
            ],
            self.dir.clone(),
            vec![
                ("FAKE_CLAUDE_SESSION".to_string(), session_id.to_string()),
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ],
        )
        .with_stdin_frame_for_tests(claude_user_frame(prompt, &[]))
    }

    pub(crate) fn fingerprint(&self, generation: u64, launch: AgentLaunchOptions) -> ClaudeSessionFingerprint {
        ClaudeSessionFingerprint {
            executable: ExecutableFingerprint {
                path: self.python.clone(),
                size_bytes: 0,
                modified_epoch_ms: 0,
                device: 0,
                inode: 0,
            },
            provider_generation: generation,
            launch,
            args_without_resume: vec!["fake".to_string()],
            env: Vec::new(),
            cwd: self.dir.clone(),
            cwd_identity: None,
        }
    }

    pub(crate) fn cli_pids(&self) -> Vec<i32> {
        fs::read_to_string(self.dir.join("cli.pid"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }

    pub(crate) fn background_pid(&self) -> Option<i32> {
        fs::read_to_string(self.dir.join("background.pid"))
            .ok()
            .and_then(|text| text.trim().parse().ok())
    }
}

impl Drop for FakeCli {
    fn drop(&mut self) {
        for pid in self.cli_pids().into_iter().chain(self.background_pid()) {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
}

pub(crate) fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

pub(crate) fn gone_within(pid: i32, timeout: Duration) -> bool {
    wait_until(timeout, || !alive(pid))
}
```

`alive` treats a zombie as alive. Descendants are reparented to launchd/init, which reaps them, so `gone_within` converges.

Append to `tests/agent_task_supervisor_tests.rs`:

```rust
#[path = "support/fake_claude_cli.rs"]
mod fake_claude_cli;

#[path = "support/claude_thread_session_tests.rs"]
mod claude_thread_session_tests;
```

- [ ] **Step 2: Write the failing session tests.** Create `src-tauri/tests/support/claude_thread_session_tests.rs`:

```rust
use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionEndReason, ClaudeSessionKey, ClaudeSessionTuning, CLAUDE_SESSION_BUSY_ERROR,
};
use agent_task_spawner::claude_session_turn::ClaudeSessionTurnChild;
use agent_task_spawner::claude_thread_session::{
    ClaudeSessionIdentity, ClaudeSessionOwner, ClaudeThreadSession, TurnOutcome,
};
use agent_task_spawner::spawn_bound_process;
use agent_task_supervisor::system_process_group_signals;
use std::process::Stdio;
use std::sync::Weak;

#[derive(Default)]
struct RecordingOwner {
    ended: Mutex<Vec<(ClaudeSessionEndReason, bool)>>,
}

impl ClaudeSessionOwner for RecordingOwner {
    fn session_ended(
        &self,
        _key: &ClaudeSessionKey,
        _generation: u64,
        reason: ClaudeSessionEndReason,
        background_processes_stopped: bool,
    ) {
        self.ended
            .lock()
            .expect("ended lock")
            .push((reason, background_processes_stopped));
    }
}

impl RecordingOwner {
    fn reasons(&self) -> Vec<ClaudeSessionEndReason> {
        self.ended
            .lock()
            .expect("ended lock")
            .iter()
            .map(|(reason, _)| *reason)
            .collect()
    }
}

fn start_session(
    cli: &FakeCli,
    owner: &Arc<RecordingOwner>,
    tuning: ClaudeSessionTuning,
) -> Arc<ClaudeThreadSession> {
    let plan = cli.plan("sess-fixture-0001", "unused");
    let spawned = spawn_bound_process(&plan, Stdio::piped()).expect("spawn fake cli");
    let weak: Weak<RecordingOwner> = Arc::downgrade(owner);
    let weak: Weak<dyn ClaudeSessionOwner> = weak;
    ClaudeThreadSession::start(
        ClaudeSessionIdentity {
            key: ClaudeSessionKey {
                workspace_id: "ws-agent-tests".to_string(),
                thread_id: "thread-a".to_string(),
            },
            generation: 1,
            fingerprint: cli.fingerprint(1, AgentLaunchOptions::default()),
            repository_root: cli.dir.clone(),
        },
        spawned,
        system_process_group_signals(),
        tuning,
        weak,
    )
    .expect("session start")
}

fn drain(reader: &mut dyn Read, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut collected = Vec::new();
    let mut buffer = [0_u8; 4096];
    while Instant::now() < deadline {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => collected.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("turn reader failed: {error}"),
        }
    }
    String::from_utf8_lossy(&collected).into_owned()
}

fn run_turn(session: &Arc<ClaudeThreadSession>, prompt: &str) -> (String, ClaudeSessionTurnChild) {
    let mut turn = session
        .attach_turn(&claude_user_frame(prompt, &[]))
        .expect("attach turn");
    let mut stdout = turn.stdout_reader().expect("turn stdout");
    let output = drain(stdout.as_mut(), Duration::from_secs(10));
    (output, turn)
}

#[test]
fn a_session_runs_two_turns_in_one_process_and_keeps_background_alive() {
    let cli = FakeCli::new("session-two-turns");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (output, mut first) = run_turn(&session, "spawn-background");
    assert!(output.contains("echo:spawn-background"), "{output}");
    assert!(first.observe_exit().expect("observe"));
    assert_eq!(first.reap(), Ok(0));
    assert_eq!(first.outcome(), Some(TurnOutcome::Settled));
    let background = cli.background_pid().expect("background pid");
    thread::sleep(Duration::from_millis(300));
    assert!(alive(background), "background process died at turn end");
    let (output, mut second) = run_turn(&session, "hello");
    assert!(output.contains("echo:hello"), "{output}");
    assert_eq!(second.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1, "the second turn must reuse the process");
    assert!(alive(background));
    session.terminate(ClaudeSessionEndReason::Stopped);
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert!(gone_within(background, Duration::from_secs(5)));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Stopped]);
}

#[test]
fn a_settled_turn_refuses_later_frames_without_ending_the_session() {
    let cli = FakeCli::new("session-late-steer");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "hello");
    let mut input = turn.take_input().expect("turn input");
    let refused = input.write_frame(b"{}\n", Instant::now() + Duration::from_secs(1));
    assert_eq!(refused.map_err(|error| error.kind()), Err(io::ErrorKind::WouldBlock));
    assert!(owner.reasons().is_empty());
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(Duration::from_secs(5)));
}

#[test]
fn attaching_while_a_turn_runs_is_busy() {
    let cli = FakeCli::new("session-busy");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let _running = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("first attach");
    assert_eq!(
        session
            .attach_turn(&claude_user_frame("again", &[]))
            .err()
            .as_deref(),
        Some(CLAUDE_SESSION_BUSY_ERROR)
    );
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(Duration::from_secs(5)));
}

#[test]
fn interrupt_settles_the_turn_and_keeps_the_process() {
    let cli = FakeCli::new("session-interrupt");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let mut turn = session
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    assert!(wait_until(Duration::from_secs(5), || {
        let mut buffer = [0_u8; 4096];
        matches!(stdout.read(&mut buffer), Ok(count) if count > 0)
    }));
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let _ = drain(stdout.as_mut(), Duration::from_secs(10));
    assert_eq!(turn.reap(), Ok(0));
    assert_eq!(turn.outcome(), Some(TurnOutcome::Interrupted));
    let (output, mut next) = run_turn(&session, "after");
    assert!(output.contains("echo:after"));
    assert_eq!(next.reap(), Ok(0));
    assert_eq!(cli.cli_pids().len(), 1);
    session.kill_now(ClaudeSessionEndReason::Shutdown);
    assert!(session.wait_reaped(Duration::from_secs(5)));
}

#[test]
fn an_ignored_interrupt_is_bounded_and_ends_the_session() {
    let cli = FakeCli::new("session-interrupt-ignored");
    let owner = Arc::new(RecordingOwner::default());
    let tuning = ClaudeSessionTuning {
        interrupt_deadline: Duration::from_millis(300),
        ..ClaudeSessionTuning::default()
    };
    let session = start_session(&cli, &owner, tuning);
    let mut turn = session
        .attach_turn(&claude_user_frame("slow-ignore", &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let mut input = turn.take_input().expect("input");
    thread::sleep(Duration::from_millis(200));
    input
        .interrupt(Instant::now() + Duration::from_secs(2))
        .expect("interrupt written");
    let _ = drain(stdout.as_mut(), Duration::from_secs(10));
    assert!(matches!(turn.outcome(), Some(TurnOutcome::ProcessExited(_))));
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::InterruptTimedOut]);
}

#[test]
fn a_crash_mid_turn_reports_the_exit_code() {
    let cli = FakeCli::new("session-crash");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "crash");
    assert_eq!(turn.reap(), Ok(9));
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Crashed]);
}

#[test]
fn idle_crash_is_reported_without_a_turn() {
    let cli = FakeCli::new("session-idle-crash");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "hello");
    assert_eq!(turn.reap(), Ok(0));
    let cli_pid = cli.cli_pids()[0];
    unsafe {
        libc::kill(cli_pid, libc::SIGKILL);
    }
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::Crashed]);
    assert!(session.attach_turn(&claude_user_frame("again", &[])).is_err());
}

#[test]
fn unowned_idle_activity_ends_the_session() {
    let cli = FakeCli::new("session-unowned");
    let owner = Arc::new(RecordingOwner::default());
    let session = start_session(&cli, &owner, ClaudeSessionTuning::default());
    let (_, mut turn) = run_turn(&session, "late-activity");
    assert_eq!(turn.reap(), Ok(0));
    assert!(session.wait_reaped(Duration::from_secs(5)));
    assert_eq!(owner.reasons(), vec![ClaudeSessionEndReason::UnownedActivity]);
}
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_thread_session_tests`
Expected: compile FAIL (modules missing).

- [ ] **Step 4: Implement `src-tauri/src/claude_session_turn.rs`**

```rust
use super::{
    agent_claude_questions::ClaudeQuestionReader,
    agent_task_input::{claude_lifecycle::ClaudeInputLifecycle, AgentTaskInput},
    claude_session_policy::ClaudeSessionEndReason,
    claude_thread_session::{ClaudeThreadSession, TurnOutcome, TurnSettlement},
    AgentChild, AgentTaskProcessOwnership,
};
use crate::agent_questions::AgentQuestionSession;
use std::{
    io::{self, Read},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, RecvTimeoutError},
        Arc,
    },
    time::{Duration, Instant},
};

const TURN_READ_POLL: Duration = Duration::from_millis(10);
const TURN_REAPED_BEFORE_SETTLEMENT: &str = "Claude turn was reaped before it settled.";

pub struct TurnOutputReader {
    receiver: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    offset: usize,
}

impl TurnOutputReader {
    pub fn new(receiver: Receiver<Vec<u8>>) -> Self {
        Self {
            receiver,
            pending: Vec::new(),
            offset: 0,
        }
    }
}

impl Read for TurnOutputReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.offset >= self.pending.len() {
            match self.receiver.recv_timeout(TURN_READ_POLL) {
                Ok(chunk) => {
                    self.pending = chunk;
                    self.offset = 0;
                }
                Err(RecvTimeoutError::Timeout) => return Err(io::ErrorKind::WouldBlock.into()),
                Err(RecvTimeoutError::Disconnected) => return Ok(0),
            }
        }
        let count = buffer.len().min(self.pending.len() - self.offset);
        buffer[..count].copy_from_slice(&self.pending[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}

pub struct ClaudeSessionTurnChild {
    session: Arc<ClaudeThreadSession>,
    settlement: Arc<TurnSettlement>,
    stdout: Option<Receiver<Vec<u8>>>,
    stderr: Option<Receiver<Vec<u8>>>,
    questions: Arc<AgentQuestionSession>,
    input: Option<ClaudeSessionTurnInput>,
}

impl ClaudeSessionTurnChild {
    pub(crate) fn new(
        session: Arc<ClaudeThreadSession>,
        turn: u64,
        settlement: Arc<TurnSettlement>,
        stdout: Receiver<Vec<u8>>,
        stderr: Receiver<Vec<u8>>,
        lifecycle: Arc<ClaudeInputLifecycle>,
    ) -> Self {
        let input = ClaudeSessionTurnInput {
            session: Arc::clone(&session),
            turn,
            lifecycle,
            closed: Arc::new(AtomicBool::new(false)),
        };
        Self {
            session,
            settlement,
            stdout: Some(stdout),
            stderr: Some(stderr),
            questions: Arc::new(AgentQuestionSession::new()),
            input: Some(input),
        }
    }

    pub fn outcome(&self) -> Option<TurnOutcome> {
        self.settlement.outcome()
    }
}

impl AgentChild for ClaudeSessionTurnChild {
    fn take_questions(&mut self) -> Option<Arc<AgentQuestionSession>> {
        Some(Arc::clone(&self.questions))
    }

    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let receiver = self
            .stdout
            .take()
            .ok_or_else(|| "Agent stdout pipe is unavailable.".to_string())?;
        Ok(Box::new(ClaudeQuestionReader::new(
            TurnOutputReader::new(receiver),
            Arc::clone(&self.questions),
            self.session.stdin(),
        )))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let receiver = self
            .stderr
            .take()
            .ok_or_else(|| "Agent stderr pipe is unavailable.".to_string())?;
        Ok(Box::new(TurnOutputReader::new(receiver)))
    }

    fn observe_exit(&mut self) -> Result<bool, String> {
        if let Some(error) = self.questions.failure() {
            return Err(error);
        }
        Ok(self.settlement.outcome().is_some())
    }

    fn reap(&mut self) -> Result<i32, String> {
        match self.settlement.outcome() {
            Some(TurnOutcome::Settled | TurnOutcome::Interrupted) => Ok(0),
            Some(TurnOutcome::ProcessExited(code)) => Ok(code),
            Some(TurnOutcome::Failed(message)) => Err(message.to_string()),
            None => Err(TURN_REAPED_BEFORE_SETTLEMENT.to_string()),
        }
    }

    fn process_group_id(&self) -> i32 {
        0
    }

    fn ownership(&self) -> AgentTaskProcessOwnership {
        AgentTaskProcessOwnership::SharedSession
    }

    fn force_kill(&mut self) -> Result<(), String> {
        self.session.terminate(ClaudeSessionEndReason::Stopped);
        Ok(())
    }

    fn take_input(&mut self) -> Option<Box<dyn AgentTaskInput>> {
        self.input
            .take()
            .map(|input| Box::new(input) as Box<dyn AgentTaskInput>)
    }
}

pub struct ClaudeSessionTurnInput {
    session: Arc<ClaudeThreadSession>,
    turn: u64,
    lifecycle: Arc<ClaudeInputLifecycle>,
    closed: Arc<AtomicBool>,
}

impl AgentTaskInput for ClaudeSessionTurnInput {
    fn claude_lifecycle(&self) -> Option<Arc<ClaudeInputLifecycle>> {
        Some(Arc::clone(&self.lifecycle))
    }

    fn provider_owns_settlement(&self) -> bool {
        true
    }

    fn write_frame(&mut self, frame: &[u8], deadline: Instant) -> io::Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        self.session.write_turn_frame(self.turn, frame, deadline)
    }

    fn interrupt(&mut self, deadline: Instant) -> io::Result<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        self.session.interrupt_turn(self.turn, deadline)
    }

    fn close(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
    }

    fn cancellation_flag(&self) -> Option<Arc<AtomicBool>> {
        Some(Arc::clone(&self.closed))
    }
}
```

- [ ] **Step 5: Implement `src-tauri/src/claude_thread_session.rs`**

```rust
use super::{
    agent_task_input::{
        claude_lifecycle::{command_id, ClaudeInputLifecycle},
        RetainedAgentStdin, RetainedChildStdin,
    },
    claude_session_policy::{
        ClaudeSessionEndReason, ClaudeSessionFingerprint, ClaudeSessionKey, ClaudeSessionTuning,
        SessionAvailability, CLAUDE_SESSION_BUSY_ERROR,
    },
    claude_session_router::ClaudeSessionRouter,
    claude_session_turn::ClaudeSessionTurnChild,
    configure_agent_output_reader, exit_code_of, observe_exit_without_reaping, reap_child,
    AGENT_STDIN_FRAME_DEADLINE,
};
use crate::agent_task_supervisor::{
    terminate_group_survivors, AgentProcessGroupSignalSender, KILL_PROCESS_GROUP_SIGNAL,
    TERMINATE_PROCESS_GROUP_SIGNAL,
};
use std::{
    io::{self, Read},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdout},
    sync::{
        mpsc::{sync_channel, SyncSender},
        Arc, Condvar, Mutex, MutexGuard, PoisonError, Weak,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const SESSION_POLL: Duration = Duration::from_millis(10);
const TURN_CHANNEL_CAPACITY: usize = 64;
const SESSION_OUTPUT_CHUNK_BYTES: usize = 8 * 1024;
const SESSION_INPUT_FAILED: &str = "Claude session input failed.";

pub trait ClaudeSessionOwner: Send + Sync {
    fn session_ended(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        reason: ClaudeSessionEndReason,
        background_processes_stopped: bool,
    );
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnOutcome {
    Settled,
    Interrupted,
    ProcessExited(i32),
    Failed(&'static str),
}

#[derive(Default)]
pub struct TurnSettlement {
    outcome: Mutex<Option<TurnOutcome>>,
}

impl TurnSettlement {
    pub fn outcome(&self) -> Option<TurnOutcome> {
        *lock(&self.outcome)
    }

    fn settle(&self, outcome: TurnOutcome) {
        lock(&self.outcome).get_or_insert(outcome);
    }
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionIdentity {
    pub key: ClaudeSessionKey,
    pub generation: u64,
    pub fingerprint: ClaudeSessionFingerprint,
    pub repository_root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionFacts {
    pub availability: SessionAvailability,
    pub fingerprint: ClaudeSessionFingerprint,
    pub conversation: Option<String>,
    pub generation: u64,
    pub idle_since: Instant,
    pub last_activity: Instant,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SessionPhase {
    Idle,
    Attached,
    Ending,
    Dead,
}

#[derive(Clone, Copy)]
enum SessionStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy)]
enum FrameWrite {
    First,
    Subsequent,
}

struct AttachedTurn {
    turn: u64,
    stdout: SyncSender<Vec<u8>>,
    stderr: SyncSender<Vec<u8>>,
    settlement: Arc<TurnSettlement>,
    lifecycle: Arc<ClaudeInputLifecycle>,
    interrupt_deadline: Option<Instant>,
}

struct SessionState {
    phase: SessionPhase,
    attached: Option<AttachedTurn>,
    next_turn: u64,
    first_frame_written: bool,
    idle_since: Instant,
    last_activity: Instant,
    end_reason: Option<ClaudeSessionEndReason>,
    ending_since: Option<Instant>,
    force_sent: bool,
    reaping: bool,
    background_at_end: Option<bool>,
}

pub struct ClaudeThreadSession {
    identity: ClaudeSessionIdentity,
    process_group_id: i32,
    stdin: RetainedChildStdin,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    tuning: ClaudeSessionTuning,
    owner: Weak<dyn ClaudeSessionOwner>,
    state: Mutex<SessionState>,
    dead: Condvar,
    router: Mutex<ClaudeSessionRouter>,
}

impl ClaudeThreadSession {
    pub(crate) fn start(
        identity: ClaudeSessionIdentity,
        spawned: (Child, i32),
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        tuning: ClaudeSessionTuning,
        owner: Weak<dyn ClaudeSessionOwner>,
    ) -> Result<Arc<Self>, String> {
        let (mut child, process_group_id) = spawned;
        let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
            abandon_child(signals.as_ref(), process_group_id, &mut child);
            return Err("Claude session pipes are unavailable.".to_string());
        };
        let configured = configure_agent_output_reader(&stdout)
            .and_then(|()| configure_agent_output_reader(&stderr));
        if let Err(error) = configured {
            abandon_child(signals.as_ref(), process_group_id, &mut child);
            return Err(error);
        }
        let now = Instant::now();
        let session = Arc::new(Self {
            identity,
            process_group_id,
            stdin: Arc::new(RetainedAgentStdin::new(stdin)),
            signals,
            tuning,
            owner,
            state: Mutex::new(SessionState {
                phase: SessionPhase::Idle,
                attached: None,
                next_turn: 0,
                first_frame_written: false,
                idle_since: now,
                last_activity: now,
                end_reason: None,
                ending_since: None,
                force_sent: false,
                reaping: false,
                background_at_end: None,
            }),
            dead: Condvar::new(),
            router: Mutex::new(ClaudeSessionRouter::new()),
        });
        let readers = match session.spawn_readers(stdout, stderr) {
            Ok(readers) => readers,
            Err(error) => {
                abandon_child(session.signals.as_ref(), process_group_id, &mut child);
                return Err(error);
            }
        };
        let slot = Arc::new(Mutex::new(Some(child)));
        let waiter_slot = Arc::clone(&slot);
        let waiter = Arc::clone(&session);
        let spawned_waiter = thread::Builder::new()
            .name("claude-session-waiter".to_string())
            .spawn(move || {
                let child = lock(&waiter_slot).take();
                if let Some(child) = child {
                    waiter.run_waiter(child, readers);
                }
            });
        if let Err(error) = spawned_waiter {
            if let Some(mut child) = lock(&slot).take() {
                abandon_child(session.signals.as_ref(), process_group_id, &mut child);
            }
            return Err(format!("Unable to start the Claude session waiter: {error}"));
        }
        Ok(session)
    }

    pub(crate) fn attach_turn(
        self: &Arc<Self>,
        frame: &[u8],
    ) -> Result<ClaudeSessionTurnChild, String> {
        let lifecycle = Arc::new(ClaudeInputLifecycle::new());
        let (stdout_sender, stdout_receiver) = sync_channel(TURN_CHANNEL_CAPACITY);
        let (stderr_sender, stderr_receiver) = sync_channel(TURN_CHANNEL_CAPACITY);
        let settlement = Arc::new(TurnSettlement::default());
        let (turn, write) = {
            let mut router = lock(&self.router);
            let mut state = self.state();
            if state.phase != SessionPhase::Idle {
                return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
            }
            state.next_turn += 1;
            let turn = state.next_turn;
            state.phase = SessionPhase::Attached;
            state.last_activity = Instant::now();
            state.attached = Some(AttachedTurn {
                turn,
                stdout: stdout_sender,
                stderr: stderr_sender,
                settlement: Arc::clone(&settlement),
                lifecycle: Arc::clone(&lifecycle),
                interrupt_deadline: None,
            });
            router.attach(Arc::clone(&lifecycle));
            let write = match std::mem::replace(&mut state.first_frame_written, true) {
                false => FrameWrite::First,
                true => FrameWrite::Subsequent,
            };
            (turn, write)
        };
        self.write_initial_frame(turn, lifecycle.initial_frame(frame), write);
        Ok(ClaudeSessionTurnChild::new(
            Arc::clone(self),
            turn,
            settlement,
            stdout_receiver,
            stderr_receiver,
            lifecycle,
        ))
    }

    pub(crate) fn write_turn_frame(
        &self,
        turn: u64,
        frame: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        if !self.turn_is_attached(turn) {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        self.stdin.write_frame(frame, deadline)
    }

    pub(crate) fn interrupt_turn(&self, turn: u64, deadline: Instant) -> io::Result<()> {
        let request_id = command_id();
        {
            let mut router = lock(&self.router);
            let mut state = self.state();
            let Some(attached) = state
                .attached
                .as_mut()
                .filter(|attached| attached.turn == turn)
            else {
                return Err(io::ErrorKind::WouldBlock.into());
            };
            if attached.interrupt_deadline.is_some() {
                return Ok(());
            }
            attached.interrupt_deadline = Some(Instant::now() + self.tuning.interrupt_deadline);
            attached.lifecycle.abandon_all();
            router.interrupt_sent(request_id.clone());
        }
        self.stdin.write_frame(&interrupt_frame(&request_id), deadline)
    }

    pub fn terminate(&self, reason: ClaudeSessionEndReason) {
        let background = self.background_processes();
        if !self.request_end(reason, background) {
            return;
        }
        self.stdin.request_close();
        self.kill_group(TERMINATE_PROCESS_GROUP_SIGNAL);
    }

    pub fn kill_now(&self, reason: ClaudeSessionEndReason) {
        let background = self.background_processes();
        self.request_end(reason, background);
        self.stdin.request_close();
        self.state().force_sent = true;
        self.kill_group(KILL_PROCESS_GROUP_SIGNAL);
    }

    pub fn wait_reaped(&self, timeout: Duration) -> bool {
        let state = self.state();
        let (state, _) = self
            .dead
            .wait_timeout_while(state, timeout, |state| state.phase != SessionPhase::Dead)
            .unwrap_or_else(PoisonError::into_inner);
        state.phase == SessionPhase::Dead
    }

    pub fn facts(&self) -> ClaudeSessionFacts {
        let conversation = lock(&self.router).conversation().map(str::to_string);
        let state = self.state();
        ClaudeSessionFacts {
            availability: match state.phase {
                SessionPhase::Idle => SessionAvailability::Idle,
                SessionPhase::Attached => SessionAvailability::Attached,
                SessionPhase::Ending | SessionPhase::Dead => SessionAvailability::Ending,
            },
            fingerprint: self.identity.fingerprint.clone(),
            conversation,
            generation: self.identity.generation,
            idle_since: state.idle_since,
            last_activity: state.last_activity,
        }
    }

    pub fn background_processes(&self) -> Option<bool> {
        let state = self.state();
        if state.reaping || state.phase == SessionPhase::Dead {
            return Some(false);
        }
        catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .group_has_members_besides_leader(self.process_group_id)
        }))
        .unwrap_or(None)
    }

    pub fn has_background_processes(&self) -> bool {
        self.background_processes() == Some(true)
    }

    pub fn key(&self) -> &ClaudeSessionKey {
        &self.identity.key
    }

    pub fn generation(&self) -> u64 {
        self.identity.generation
    }

    pub fn repository_root(&self) -> &Path {
        &self.identity.repository_root
    }

    pub fn cwd(&self) -> &Path {
        &self.identity.fingerprint.cwd
    }

    pub fn stdin(&self) -> RetainedChildStdin {
        Arc::clone(&self.stdin)
    }

    fn state(&self) -> MutexGuard<'_, SessionState> {
        lock(&self.state)
    }

    fn phase(&self) -> SessionPhase {
        self.state().phase
    }

    fn turn_is_attached(&self, turn: u64) -> bool {
        self.state()
            .attached
            .as_ref()
            .is_some_and(|attached| attached.turn == turn)
    }

    fn end_requested(&self) -> bool {
        self.state().end_reason.is_some()
    }

    fn request_end(&self, reason: ClaudeSessionEndReason, background: Option<bool>) -> bool {
        let mut state = self.state();
        if state.phase == SessionPhase::Dead || state.end_reason.is_some() {
            return false;
        }
        state.end_reason = Some(reason);
        state.ending_since = Some(Instant::now());
        state.background_at_end = background;
        state.phase = SessionPhase::Ending;
        true
    }

    fn kill_group(&self, signal: i32) {
        let state = self.state();
        if state.reaping || self.process_group_id <= 0 {
            return;
        }
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals.send(self.process_group_id, signal)
        }));
    }

    fn spawn_readers(
        self: &Arc<Self>,
        stdout: ChildStdout,
        stderr: ChildStderr,
    ) -> Result<Vec<JoinHandle<()>>, String> {
        let out = Arc::clone(self);
        let stdout_reader = thread::Builder::new()
            .name("claude-session-stdout".to_string())
            .spawn(move || out.pump(stdout, SessionStream::Stdout))
            .map_err(|error| format!("Unable to start the Claude session reader: {error}"))?;
        let err = Arc::clone(self);
        let stderr_reader = thread::Builder::new()
            .name("claude-session-stderr".to_string())
            .spawn(move || err.pump(stderr, SessionStream::Stderr))
            .map_err(|error| format!("Unable to start the Claude session reader: {error}"))?;
        Ok(vec![stdout_reader, stderr_reader])
    }

    fn pump(&self, mut reader: impl Read, stream: SessionStream) {
        let mut buffer = vec![0_u8; SESSION_OUTPUT_CHUNK_BYTES];
        loop {
            if self.phase() == SessionPhase::Dead {
                return;
            }
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(count) => match stream {
                    SessionStream::Stdout => self.route_stdout(&buffer[..count]),
                    SessionStream::Stderr => self.route_stderr(&buffer[..count]),
                },
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(SESSION_POLL)
                }
                Err(_) => return,
            }
        }
    }

    fn route_stdout(&self, bytes: &[u8]) {
        let (step, sender) = {
            let mut router = lock(&self.router);
            let step = router.feed(bytes);
            let mut state = self.state();
            state.last_activity = Instant::now();
            (step, state.attached.as_ref().map(|turn| turn.stdout.clone()))
        };
        if let (Some(sender), true) = (sender, step.turn_bytes > 0) {
            let _ = sender.send(bytes[..step.turn_bytes.min(bytes.len())].to_vec());
        }
        if let Some(message) = step.failure {
            self.fail_attached(message);
            self.terminate(ClaudeSessionEndReason::ProtocolError);
            return;
        }
        if step.settled {
            self.finish_attached_turn();
        }
        if step.unowned_activity {
            self.terminate(ClaudeSessionEndReason::UnownedActivity);
        }
    }

    fn route_stderr(&self, bytes: &[u8]) {
        let sender = self
            .state()
            .attached
            .as_ref()
            .map(|turn| turn.stderr.clone());
        if let Some(sender) = sender {
            let _ = sender.send(bytes.to_vec());
        }
    }

    fn finish_attached_turn(&self) {
        let finished = {
            let mut state = self.state();
            let Some(turn) = state.attached.take() else {
                return;
            };
            if state.phase == SessionPhase::Attached {
                state.phase = SessionPhase::Idle;
            }
            state.idle_since = Instant::now();
            turn
        };
        let outcome = match finished.interrupt_deadline {
            Some(_) => TurnOutcome::Interrupted,
            None => TurnOutcome::Settled,
        };
        finished.settlement.settle(outcome);
    }

    fn fail_attached(&self, message: &'static str) {
        let failed = self.state().attached.take();
        if let Some(turn) = failed {
            turn.settlement.settle(TurnOutcome::Failed(message));
        }
    }

    fn fail_turn(&self, turn: u64, message: &'static str) {
        let failed = {
            let mut state = self.state();
            match state.attached.as_ref() {
                Some(attached) if attached.turn == turn => state.attached.take(),
                _ => None,
            }
        };
        if let Some(failed) = failed {
            failed.settlement.settle(TurnOutcome::Failed(message));
        }
    }

    fn write_initial_frame(self: &Arc<Self>, turn: u64, frame: Vec<u8>, write: FrameWrite) {
        let session = Arc::clone(self);
        let spawned = thread::Builder::new()
            .name("claude-session-input".to_string())
            .spawn(move || {
                let deadline = Instant::now() + AGENT_STDIN_FRAME_DEADLINE;
                let written = match write {
                    FrameWrite::First => session.stdin.write_first_frame(&frame, deadline),
                    FrameWrite::Subsequent => session.stdin.write_frame(&frame, deadline),
                };
                if written.is_ok() {
                    return;
                }
                session.fail_turn(turn, SESSION_INPUT_FAILED);
                session.terminate(ClaudeSessionEndReason::InputFailed);
            });
        if spawned.is_ok() {
            return;
        }
        self.fail_turn(turn, SESSION_INPUT_FAILED);
        self.terminate(ClaudeSessionEndReason::InputFailed);
    }

    fn enforce_deadlines(&self) {
        let now = Instant::now();
        let (interrupt_overdue, force_due) = {
            let mut state = self.state();
            let overdue = state
                .attached
                .as_ref()
                .and_then(|turn| turn.interrupt_deadline)
                .is_some_and(|deadline| now >= deadline);
            let force_due = !state.force_sent
                && state
                    .ending_since
                    .is_some_and(|since| now.duration_since(since) >= self.tuning.graceful_stop);
            if force_due {
                state.force_sent = true;
            }
            (overdue, force_due)
        };
        if interrupt_overdue {
            self.terminate(ClaudeSessionEndReason::InterruptTimedOut);
        }
        if force_due {
            self.kill_group(KILL_PROCESS_GROUP_SIGNAL);
        }
    }

    fn wait_for_leader_exit(&self, child: &Child) {
        loop {
            match observe_exit_without_reaping(child) {
                Ok(true) => return,
                Ok(false) => {}
                Err(_) => {
                    self.kill_now(ClaudeSessionEndReason::Crashed);
                    return;
                }
            }
            self.enforce_deadlines();
            thread::sleep(SESSION_POLL);
        }
    }

    fn run_waiter(self: Arc<Self>, mut child: Child, readers: Vec<JoinHandle<()>>) {
        if catch_unwind(AssertUnwindSafe(|| self.wait_for_leader_exit(&child))).is_err() {
            self.kill_now(ClaudeSessionEndReason::Crashed);
        }
        let observed_background = self.background_processes();
        let grace = match self.end_requested() {
            true => Duration::ZERO,
            false => self.tuning.clean_exit_grace,
        };
        let aborted = || self.end_requested();
        terminate_group_survivors(
            self.signals.as_ref(),
            self.process_group_id,
            grace,
            &aborted,
        );
        let _ = catch_unwind(AssertUnwindSafe(|| {
            self.signals
                .send_after_observed_exit(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL)
        }));
        wait_for_readers(&readers, self.tuning.reader_drain);
        self.state().reaping = true;
        let exit_code = reap_child(&mut child).map(exit_code_of).unwrap_or(-1);
        let (reason, background_stopped) = self.finish_dead(exit_code, observed_background);
        let Some(owner) = self.owner.upgrade() else {
            return;
        };
        let _ = catch_unwind(AssertUnwindSafe(|| {
            owner.session_ended(
                &self.identity.key,
                self.identity.generation,
                reason,
                background_stopped,
            )
        }));
    }

    fn finish_dead(
        &self,
        exit_code: i32,
        observed_background: Option<bool>,
    ) -> (ClaudeSessionEndReason, bool) {
        let (attached, reason, stopped) = {
            let mut state = self.state();
            state.phase = SessionPhase::Dead;
            let reason = state.end_reason.unwrap_or(match exit_code {
                0 => ClaudeSessionEndReason::Exited,
                _ => ClaudeSessionEndReason::Crashed,
            });
            let stopped = state.background_at_end.or(observed_background) == Some(true);
            (state.attached.take(), reason, stopped)
        };
        self.dead.notify_all();
        if let Some(turn) = attached {
            turn.settlement.settle(TurnOutcome::ProcessExited(exit_code));
        }
        (reason, stopped)
    }
}

impl Drop for ClaudeThreadSession {
    fn drop(&mut self) {
        let state = self.state.get_mut().unwrap_or_else(PoisonError::into_inner);
        if state.phase == SessionPhase::Dead || state.reaping || self.process_group_id <= 0 {
            return;
        }
        let _ = self
            .signals
            .send(self.process_group_id, KILL_PROCESS_GROUP_SIGNAL);
    }
}

fn abandon_child(
    signals: &dyn AgentProcessGroupSignalSender,
    process_group_id: i32,
    child: &mut Child,
) {
    let _ = signals.send(process_group_id, KILL_PROCESS_GROUP_SIGNAL);
    let _ = child.kill();
    let _ = reap_child(child);
}

fn wait_for_readers(readers: &[JoinHandle<()>], timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if readers.iter().all(JoinHandle::is_finished) {
            return;
        }
        thread::sleep(SESSION_POLL);
    }
}

fn interrupt_frame(request_id: &str) -> Vec<u8> {
    let mut frame = serde_json::to_vec(&serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": {"subtype": "interrupt"}
    }))
    .unwrap_or_default();
    frame.push(b'\n');
    frame
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
```

These are the ownership invariants the reviewer must check:
- The waiter is the only reaper.
- `reaping` is set under `state` before `reap_child`.
- `kill_group` checks `reaping` under the same lock, so no signal reaches a reused pgid.
- The lock order is always `router → state`.
- A channel `send` never runs under a lock.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_thread_session_tests -- --test-threads=1; echo "exit=$?"`
Expected: `exit=0` (8 tests).

- [ ] **Step 7: Lint this slice.** Run `cd src-tauri && cargo clippy --all-targets -- -D warnings && npm --prefix .. run size:hotspots; echo "exit=$?"`. Expected: `exit=0`. `claude_thread_session.rs` must stay under 2000 lines and 10000 tokens. If it does not, move `pump`, `route_stdout`, `route_stderr` and `wait_for_readers` into `claude_session_output.rs` as an `impl ClaudeThreadSession` block, and do not raise the limit.

### Task 3.6: Session registry and spawner dispatch

**Files:**
- Create: `src-tauri/src/claude_session_registry.rs`
- Modify: `src-tauri/src/claude_session_turn.rs` (append `ClaudeSessionTurnPlan`, `session_fingerprint`)
- Modify: `src-tauri/src/agent_task_spawner.rs`:
  - add the module declaration `#[path = "claude_session_registry.rs"] pub mod claude_session_registry;`
  - add the plan field `claude_session`, set to `None` in `for_tests` and in `plan_agent_invocation_with_authority_and_environment`
  - add `with_claude_session` and `stdin_frame_bytes`
  - dispatch in `StdAgentProcessSpawner::spawn`
- Create: `src-tauri/tests/support/claude_session_registry_tests.rs`
- Modify: `src-tauri/tests/agent_task_supervisor_tests.rs` (tail include)

**Interfaces:**
- Consumes: the session API from Task 3.5 and the policy from Task 3.2.
- Produces:
  - `trait ClaudeSessionEventSink { fn ended(&self, event: ClaudeSessionEndedEvent) }`
  - `#[derive(Clone, Debug)] ClaudeSessionRequest { key, repository_root, fingerprint, resume_session_id: Option<String>, restart: ClaudeSessionRestartPolicy }`
  - `enum ClaudeSessionLease { Session(Arc<ClaudeThreadSession>), Ephemeral }`
  - `ClaudeSessionRegistry::{new(signals, events), with_tuning(signals, events, tuning), acquire(&request, spawn) -> Result<ClaudeSessionLease, String>, end_for_thread(workspace_id, thread_id, reason) -> bool, end_for_root(Option<&str>, &Path, reason), end_for_root_and_reap(&Path, Duration) -> bool, close_admission(), shutdown_all() -> bool, retire_idle(Instant), retire_idle_for_update(), inspect(workspace_id, thread_id, &AgentLaunchOptions, Option<&str>, u64) -> ClaudeSessionInspection, live_sessions() -> usize}`
  - `ClaudeSessionTurnPlan::new(Arc<ClaudeSessionRegistry>, ClaudeSessionRequest, Arc<dyn Fn() -> Result<(), String> + Send + Sync>)`
  - `session_fingerprint(&AgentTaskSpawnPlan, AgentLaunchOptions, u64) -> ClaudeSessionFingerprint`
  - `AgentTaskSpawnPlan::with_claude_session(self, ClaudeSessionTurnPlan) -> Self`
  - `AgentTaskSpawnPlan::stdin_frame_bytes(&self) -> Option<&Arc<[u8]>>`

- [ ] **Step 1: Write the failing registry tests.** Create `src-tauri/tests/support/claude_session_registry_tests.rs`:

```rust
use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::{AgentLaunchOptions, ClaudeEffortChoice};
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionEndReason, ClaudeSessionEndedEvent, ClaudeSessionInspection, ClaudeSessionKey,
    ClaudeSessionRestartPolicy, ClaudeSessionTuning, CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR,
};
use agent_task_spawner::claude_session_registry::{
    ClaudeSessionEventSink, ClaudeSessionLease, ClaudeSessionRegistry, ClaudeSessionRequest,
};
use agent_task_spawner::claude_thread_session::ClaudeThreadSession;
use agent_task_spawner::spawn_bound_process;
use agent_task_supervisor::system_process_group_signals;
use std::process::Stdio;
use std::sync::atomic::AtomicUsize;

#[derive(Default)]
pub(crate) struct RecordingSessionEvents {
    events: Mutex<Vec<ClaudeSessionEndedEvent>>,
}

impl ClaudeSessionEventSink for RecordingSessionEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        self.events.lock().expect("events lock").push(event);
    }
}

impl RecordingSessionEvents {
    pub(crate) fn reasons_for(&self, thread_id: &str) -> Vec<ClaudeSessionEndReason> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .filter(|event| event.thread_id == thread_id)
            .map(|event| event.reason)
            .collect()
    }

    pub(crate) fn last_for(&self, thread_id: &str) -> Option<ClaudeSessionEndedEvent> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .rev()
            .find(|event| event.thread_id == thread_id)
            .cloned()
    }
}

pub(crate) fn session_registry(
    tuning: ClaudeSessionTuning,
) -> (Arc<ClaudeSessionRegistry>, Arc<RecordingSessionEvents>) {
    let events = Arc::new(RecordingSessionEvents::default());
    let registry = Arc::new(ClaudeSessionRegistry::with_tuning(
        system_process_group_signals(),
        Arc::clone(&events) as Arc<dyn ClaudeSessionEventSink>,
        tuning,
    ));
    (registry, events)
}

pub(crate) fn session_request(
    cli: &FakeCli,
    workspace: &str,
    thread: &str,
    resume: Option<&str>,
    launch: AgentLaunchOptions,
    restart: ClaudeSessionRestartPolicy,
) -> ClaudeSessionRequest {
    ClaudeSessionRequest {
        key: ClaudeSessionKey {
            workspace_id: workspace.to_string(),
            thread_id: thread.to_string(),
        },
        repository_root: cli.dir.clone(),
        fingerprint: cli.fingerprint(1, launch),
        resume_session_id: resume.map(str::to_string),
        restart,
    }
}

struct Acquired {
    session: Option<Arc<ClaudeThreadSession>>,
    spawned: bool,
}

fn acquire(registry: &ClaudeSessionRegistry, cli: &FakeCli, request: &ClaudeSessionRequest) -> Result<Acquired, String> {
    let spawns = AtomicUsize::new(0);
    let lease = registry.acquire(request, || {
        spawns.fetch_add(1, Ordering::SeqCst);
        spawn_bound_process(&cli.plan("sess-fixture-0001", "unused"), Stdio::piped())
    })?;
    let spawned = spawns.load(Ordering::SeqCst) == 1;
    Ok(match lease {
        ClaudeSessionLease::Session(session) => Acquired {
            session: Some(session),
            spawned,
        },
        ClaudeSessionLease::Ephemeral => Acquired {
            session: None,
            spawned,
        },
    })
}

fn settle(session: &Arc<ClaudeThreadSession>, prompt: &str) {
    let mut turn = session
        .attach_turn(&claude_user_frame(prompt, &[]))
        .expect("attach");
    let mut stdout = turn.stdout_reader().expect("stdout");
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut buffer = [0_u8; 4096];
    while Instant::now() < deadline {
        match stdout.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => thread::sleep(Duration::from_millis(5)),
        }
    }
    assert!(turn.observe_exit().expect("observe"));
}

fn claude_launch(effort: ClaudeEffortChoice) -> AgentLaunchOptions {
    match AgentLaunchOptions::default() {
        AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            context,
            fast_mode,
            thinking_mode,
            chrome,
            ..
        } => AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            effort,
            context,
            fast_mode,
            thinking_mode,
            chrome,
        },
        other => other,
    }
}

const RESUME: Option<&str> = Some("sess-fixture-0001");

#[test]
fn a_matching_follow_up_reuses_the_live_session() {
    let cli = FakeCli::new("registry-reuse");
    let (registry, _) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let first = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("first");
    let session = first.session.expect("session");
    assert!(first.spawned);
    settle(&session, "hello");
    let second = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", RESUME, launch, ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("second");
    assert!(!second.spawned);
    assert!(Arc::ptr_eq(&session, &second.session.expect("reused")));
    assert!(registry.shutdown_all());
}

#[test]
fn workspace_a_b_a_never_reuses_a_foreign_owner_session() {
    let cli = FakeCli::new("registry-aba");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let a = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, policy)).expect("a");
    settle(a.session.as_ref().expect("a session"), "hello");
    let b = acquire(&registry, &cli, &session_request(&cli, "ws-b", "t1", RESUME, launch, policy)).expect("b");
    assert!(b.spawned, "a new owner must never inherit the old owner's process");
    settle(b.session.as_ref().expect("b session"), "hello");
    let back = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", RESUME, launch, policy)).expect("a again");
    assert!(back.spawned, "returning to A must not resurrect A's first process");
    let pids = cli.cli_pids();
    assert_eq!(pids.len(), 3);
    assert!(gone_within(pids[0], Duration::from_secs(5)));
    assert!(gone_within(pids[1], Duration::from_secs(5)));
    assert_eq!(events.reasons_for("t1"), vec![ClaudeSessionEndReason::Released, ClaudeSessionEndReason::Released]);
    assert!(registry.shutdown_all());
}

#[test]
fn concurrent_sessions_are_capped_with_deterministic_eviction() {
    let cli = FakeCli::new("registry-cap");
    let (registry, events) = session_registry(ClaudeSessionTuning {
        max_live_sessions: 2,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    for thread in ["t1", "t2"] {
        let acquired = acquire(&registry, &cli, &session_request(&cli, "ws-a", thread, None, launch, policy)).expect("acquire");
        settle(acquired.session.as_ref().expect("session"), "hello");
        thread::sleep(Duration::from_millis(20));
    }
    let third = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t3", None, launch, policy)).expect("third");
    assert!(third.session.is_some());
    assert_eq!(events.reasons_for("t1"), vec![ClaudeSessionEndReason::Evicted]);
    assert!(events.reasons_for("t2").is_empty());
    assert_eq!(registry.live_sessions(), 2);
    assert!(registry.shutdown_all());
}

#[test]
fn when_every_session_is_busy_the_next_turn_runs_ephemeral() {
    let cli = FakeCli::new("registry-ephemeral");
    let (registry, _) = session_registry(ClaudeSessionTuning {
        max_live_sessions: 1,
        ..ClaudeSessionTuning::default()
    });
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let busy = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, policy)).expect("busy");
    let _running = busy
        .session
        .as_ref()
        .expect("session")
        .attach_turn(&claude_user_frame("slow", &[]))
        .expect("attach");
    let next = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t2", None, launch, policy)).expect("next");
    assert!(next.session.is_none());
    assert!(!next.spawned);
    assert!(registry.shutdown_all());
}

#[cfg(target_os = "macos")]
#[test]
fn launch_change_refuses_without_confirmation_and_restarts_with_it() {
    let cli = FakeCli::new("registry-restart");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let high = claude_launch(ClaudeEffortChoice::High);
    let low = claude_launch(ClaudeEffortChoice::Low);
    let first = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, high, ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("first");
    settle(first.session.as_ref().expect("session"), "spawn-background");
    let background = cli.background_pid().expect("background pid");
    let refused = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", RESUME, low, ClaudeSessionRestartPolicy::RefuseIfBackground));
    assert_eq!(refused.err().as_deref(), Some(CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR));
    assert!(alive(background), "a refused restart must not touch background work");
    let restarted = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", RESUME, low, ClaudeSessionRestartPolicy::StopBackground)).expect("confirmed restart");
    assert!(restarted.spawned);
    assert!(gone_within(background, Duration::from_secs(5)));
    let ended = events.last_for("t1").expect("ended event");
    assert_eq!(ended.reason, ClaudeSessionEndReason::Restarted);
    assert!(ended.background_processes_stopped);
    assert!(registry.shutdown_all());
}

#[test]
fn a_fresh_conversation_request_restarts_the_session() {
    let cli = FakeCli::new("registry-fresh");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::StopBackground;
    let first = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, policy)).expect("first");
    settle(first.session.as_ref().expect("session"), "hello");
    let fresh = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, policy)).expect("fresh");
    assert!(fresh.spawned);
    assert_eq!(events.reasons_for("t1"), vec![ClaudeSessionEndReason::Restarted]);
    assert!(registry.shutdown_all());
}

#[test]
fn idle_crash_is_reported_and_the_next_turn_respawns() {
    let cli = FakeCli::new("registry-idle-crash");
    let (registry, events) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    let policy = ClaudeSessionRestartPolicy::RefuseIfBackground;
    let first = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, policy)).expect("first");
    settle(first.session.as_ref().expect("session"), "hello");
    unsafe {
        libc::kill(cli.cli_pids()[0], libc::SIGKILL);
    }
    assert!(wait_until(Duration::from_secs(5), || events.reasons_for("t1") == vec![ClaudeSessionEndReason::Crashed]));
    assert_eq!(registry.live_sessions(), 0);
    let next = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", RESUME, launch, policy)).expect("respawn");
    assert!(next.spawned);
    assert!(registry.shutdown_all());
}

fn live_background_session(label: &str, tuning: ClaudeSessionTuning) -> (FakeCli, Arc<ClaudeSessionRegistry>, Arc<RecordingSessionEvents>, i32) {
    let cli = FakeCli::new(label);
    let (registry, events) = session_registry(tuning);
    let acquired = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, AgentLaunchOptions::default(), ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("acquire");
    settle(acquired.session.as_ref().expect("session"), "spawn-background");
    let background = cli.background_pid().expect("background pid");
    (cli, registry, events, background)
}

#[test]
fn ending_a_thread_kills_its_group() {
    let (_cli, registry, events, background) = live_background_session("reap-thread", ClaudeSessionTuning::default());
    assert!(registry.end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events.reasons_for("t1") == vec![ClaudeSessionEndReason::ThreadEnded]));
    assert!(wait_until(Duration::from_secs(5), || registry.live_sessions() == 0));
    assert!(!registry.end_for_thread("ws-a", "t1", ClaudeSessionEndReason::ThreadEnded));
}

#[test]
fn releasing_a_root_ends_only_that_owners_sessions() {
    let (cli, registry, events, background) = live_background_session("reap-root", ClaudeSessionTuning::default());
    let other = acquire(&registry, &cli, &session_request(&cli, "ws-b", "t2", None, AgentLaunchOptions::default(), ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("other owner");
    settle(other.session.as_ref().expect("session"), "hello");
    registry.end_for_root(Some("ws-a"), &cli.dir, ClaudeSessionEndReason::Released);
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events.reasons_for("t1") == vec![ClaudeSessionEndReason::Released]));
    assert!(events.reasons_for("t2").is_empty());
    assert!(registry.end_for_root_and_reap(&cli.dir, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || registry.live_sessions() == 0));
}

#[test]
fn shutdown_closes_admission_and_reaps_everything() {
    let (cli, registry, _events, background) = live_background_session("reap-shutdown", ClaudeSessionTuning::default());
    assert!(registry.shutdown_all());
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(acquire(&registry, &cli, &session_request(&cli, "ws-a", "t9", None, AgentLaunchOptions::default(), ClaudeSessionRestartPolicy::RefuseIfBackground)).is_err());
}

#[test]
fn dropping_the_registry_kills_every_session() {
    let (cli, registry, _events, background) = live_background_session("reap-drop", ClaudeSessionTuning::default());
    let cli_pid = cli.cli_pids()[0];
    drop(registry);
    assert!(gone_within(cli_pid, Duration::from_secs(5)));
    assert!(gone_within(background, Duration::from_secs(5)));
}

#[test]
fn idle_ttl_and_provider_update_retire_idle_sessions() {
    let tuning = ClaudeSessionTuning {
        idle_ttl: Duration::from_millis(50),
        detached_work_ttl: Duration::from_millis(50),
        ..ClaudeSessionTuning::default()
    };
    let (_cli, registry, events, background) = live_background_session("reap-idle", tuning);
    thread::sleep(Duration::from_millis(100));
    registry.retire_idle(Instant::now());
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || events.reasons_for("t1") == vec![ClaudeSessionEndReason::IdleTimeout]));

    let (_cli, registry, events, _) = live_background_session("reap-update", ClaudeSessionTuning::default());
    registry.retire_idle_for_update();
    assert!(wait_until(Duration::from_secs(5), || events.reasons_for("t1") == vec![ClaudeSessionEndReason::ProviderUpdated]));
}

#[test]
fn inspect_reports_none_reuse_and_restart() {
    let cli = FakeCli::new("registry-inspect");
    let (registry, _) = session_registry(ClaudeSessionTuning::default());
    let launch = AgentLaunchOptions::default();
    assert_eq!(registry.inspect("ws-a", "t1", &launch, None, 1), ClaudeSessionInspection::None);
    let acquired = acquire(&registry, &cli, &session_request(&cli, "ws-a", "t1", None, launch, ClaudeSessionRestartPolicy::RefuseIfBackground)).expect("acquire");
    settle(acquired.session.as_ref().expect("session"), "hello");
    assert!(matches!(registry.inspect("ws-a", "t1", &launch, RESUME, 1), ClaudeSessionInspection::Reuse { .. }));
    assert!(matches!(registry.inspect("ws-a", "t1", &claude_launch(ClaudeEffortChoice::Low), RESUME, 1), ClaudeSessionInspection::Restart { .. }));
    assert!(registry.shutdown_all());
}
```

Append the include to `tests/agent_task_supervisor_tests.rs`:

```rust
#[path = "support/claude_session_registry_tests.rs"]
mod claude_session_registry_tests;
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_session_registry_tests`
Expected: compile FAIL (the registry module is missing).

- [ ] **Step 3: Implement `src-tauri/src/claude_session_registry.rs`**

```rust
use super::{
    agent_launch::AgentLaunchOptions,
    claude_session_policy::{
        choose_eviction, decide_session_disposition, idle_retirement_due, inspect_session,
        ClaudeSessionDisposition, ClaudeSessionEndReason, ClaudeSessionEndedEvent,
        ClaudeSessionFingerprint, ClaudeSessionInspection, ClaudeSessionKey,
        ClaudeSessionRestartPolicy, ClaudeSessionTuning, EvictionCandidate, LiveSessionFacts,
        RequestedSessionFacts, SessionAvailability, CLAUDE_SESSION_BUSY_ERROR,
        CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR, CLAUDE_SESSION_STOP_TIMEOUT_ERROR,
    },
    claude_thread_session::{ClaudeSessionIdentity, ClaudeSessionOwner, ClaudeThreadSession},
};
use crate::agent_task_supervisor::AgentProcessGroupSignalSender;
use std::{
    collections::{HashMap, HashSet},
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::Child,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard, PoisonError, Weak,
    },
    time::{Duration, Instant},
};

pub const CLAUDE_SESSION_ADMISSION_CLOSED_ERROR: &str = "Agent task startup is closed.";

pub trait ClaudeSessionEventSink: Send + Sync {
    fn ended(&self, event: ClaudeSessionEndedEvent);
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionRequest {
    pub key: ClaudeSessionKey,
    pub repository_root: PathBuf,
    pub fingerprint: ClaudeSessionFingerprint,
    pub resume_session_id: Option<String>,
    pub restart: ClaudeSessionRestartPolicy,
}

pub enum ClaudeSessionLease {
    Session(Arc<ClaudeThreadSession>),
    Ephemeral,
}

pub struct ClaudeSessionRegistry {
    inner: Arc<RegistryInner>,
}

struct RegistryInner {
    state: Mutex<RegistryState>,
    signals: Arc<dyn AgentProcessGroupSignalSender>,
    events: Arc<dyn ClaudeSessionEventSink>,
    tuning: ClaudeSessionTuning,
    next_generation: AtomicU64,
}

#[derive(Default)]
struct RegistryState {
    sessions: HashMap<ClaudeSessionKey, Arc<ClaudeThreadSession>>,
    starting: HashSet<ClaudeSessionKey>,
    closed: bool,
}

struct StartingGuard {
    inner: Arc<RegistryInner>,
    key: ClaudeSessionKey,
}

impl Drop for StartingGuard {
    fn drop(&mut self) {
        self.inner.state().starting.remove(&self.key);
    }
}

impl ClaudeSessionRegistry {
    pub fn new(
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        events: Arc<dyn ClaudeSessionEventSink>,
    ) -> Self {
        Self::with_tuning(signals, events, ClaudeSessionTuning::default())
    }

    pub fn with_tuning(
        signals: Arc<dyn AgentProcessGroupSignalSender>,
        events: Arc<dyn ClaudeSessionEventSink>,
        tuning: ClaudeSessionTuning,
    ) -> Self {
        Self {
            inner: Arc::new(RegistryInner {
                state: Mutex::new(RegistryState::default()),
                signals,
                events,
                tuning,
                next_generation: AtomicU64::new(0),
            }),
        }
    }

    pub fn acquire(
        &self,
        request: &ClaudeSessionRequest,
        spawn: impl FnOnce() -> Result<(Child, i32), String>,
    ) -> Result<ClaudeSessionLease, String> {
        let (existing, displaced) = self.inner.snapshot(&request.key)?;
        for session in displaced {
            self.inner
                .end_and_wait(&session, ClaudeSessionEndReason::Released)?;
        }
        if let Some(session) = existing {
            if self.inner.keep_or_end(&session, request)? {
                return Ok(ClaudeSessionLease::Session(session));
            }
        }
        let Some(_starting) = self.inner.reserve_slot(&request.key)? else {
            return Ok(ClaudeSessionLease::Ephemeral);
        };
        let spawned = spawn()?;
        let generation = self.inner.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let owner: Weak<RegistryInner> = Arc::downgrade(&self.inner);
        let owner: Weak<dyn ClaudeSessionOwner> = owner;
        let session = ClaudeThreadSession::start(
            ClaudeSessionIdentity {
                key: request.key.clone(),
                generation,
                fingerprint: request.fingerprint.clone(),
                repository_root: request.repository_root.clone(),
            },
            spawned,
            Arc::clone(&self.inner.signals),
            self.inner.tuning,
            owner,
        )?;
        self.inner.insert(&request.key, &session)?;
        Ok(ClaudeSessionLease::Session(session))
    }

    pub fn end_for_thread(
        &self,
        workspace_id: &str,
        thread_id: &str,
        reason: ClaudeSessionEndReason,
    ) -> bool {
        let key = ClaudeSessionKey {
            workspace_id: workspace_id.to_string(),
            thread_id: thread_id.to_string(),
        };
        let session = self.inner.state().sessions.get(&key).cloned();
        let Some(session) = session else {
            return false;
        };
        session.terminate(reason);
        true
    }

    pub fn end_for_root(
        &self,
        workspace_id: Option<&str>,
        root: &Path,
        reason: ClaudeSessionEndReason,
    ) {
        for session in self.inner.matching(workspace_id, root) {
            session.terminate(reason);
        }
    }

    pub fn end_for_root_and_reap(&self, root: &Path, timeout: Duration) -> bool {
        let sessions = self.inner.matching(None, root);
        for session in &sessions {
            session.terminate(ClaudeSessionEndReason::Released);
        }
        let deadline = Instant::now() + timeout;
        sessions
            .iter()
            .all(|session| session.wait_reaped(deadline.saturating_duration_since(Instant::now())))
    }

    pub fn close_admission(&self) {
        self.inner.state().closed = true;
    }

    pub fn shutdown_all(&self) -> bool {
        self.close_admission();
        let sessions = self.inner.all();
        for session in &sessions {
            session.terminate(ClaudeSessionEndReason::Shutdown);
        }
        let deadline = Instant::now() + self.inner.tuning.end_timeout();
        sessions
            .iter()
            .all(|session| session.wait_reaped(deadline.saturating_duration_since(Instant::now())))
    }

    pub fn retire_idle(&self, now: Instant) {
        for session in self.inner.all() {
            let facts = session.facts();
            let due = idle_retirement_due(
                &self.inner.tuning,
                facts.availability,
                session.background_processes(),
                facts.idle_since,
                now,
            );
            if due {
                session.terminate(ClaudeSessionEndReason::IdleTimeout);
            }
        }
    }

    pub fn retire_idle_for_update(&self) {
        for session in self.inner.all() {
            if session.facts().availability == SessionAvailability::Idle {
                session.terminate(ClaudeSessionEndReason::ProviderUpdated);
            }
        }
    }

    pub fn inspect(
        &self,
        workspace_id: &str,
        thread_id: &str,
        launch: &AgentLaunchOptions,
        resume_session_id: Option<&str>,
        provider_generation: u64,
    ) -> ClaudeSessionInspection {
        let key = ClaudeSessionKey {
            workspace_id: workspace_id.to_string(),
            thread_id: thread_id.to_string(),
        };
        let session = self.inner.state().sessions.get(&key).cloned();
        let Some(session) = session else {
            return ClaudeSessionInspection::None;
        };
        let facts = session.facts();
        let background = session.has_background_processes();
        inspect_session(
            Some((
                LiveSessionFacts {
                    fingerprint: &facts.fingerprint,
                    conversation: facts.conversation.as_deref(),
                    availability: facts.availability,
                },
                background,
            )),
            launch,
            resume_session_id,
            provider_generation,
        )
    }

    pub fn live_sessions(&self) -> usize {
        self.inner.state().sessions.len()
    }
}

impl Drop for ClaudeSessionRegistry {
    fn drop(&mut self) {
        self.inner.state().closed = true;
        for session in self.inner.all() {
            session.kill_now(ClaudeSessionEndReason::Shutdown);
        }
    }
}

impl RegistryInner {
    fn state(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn all(&self) -> Vec<Arc<ClaudeThreadSession>> {
        self.state().sessions.values().cloned().collect()
    }

    fn matching(&self, workspace_id: Option<&str>, root: &Path) -> Vec<Arc<ClaudeThreadSession>> {
        self.state()
            .sessions
            .values()
            .filter(|session| {
                workspace_id.is_none_or(|expected| session.key().workspace_id == expected)
                    && (session.repository_root() == root || session.cwd().starts_with(root))
            })
            .cloned()
            .collect()
    }

    #[allow(clippy::type_complexity)]
    fn snapshot(
        &self,
        key: &ClaudeSessionKey,
    ) -> Result<(Option<Arc<ClaudeThreadSession>>, Vec<Arc<ClaudeThreadSession>>), String> {
        let state = self.state();
        if state.closed {
            return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
        }
        if state.starting.contains(key) {
            return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
        }
        let displaced = state
            .sessions
            .iter()
            .filter(|(candidate, _)| {
                candidate.thread_id == key.thread_id && candidate.workspace_id != key.workspace_id
            })
            .map(|(_, session)| Arc::clone(session))
            .collect();
        Ok((state.sessions.get(key).cloned(), displaced))
    }

    fn keep_or_end(
        &self,
        session: &Arc<ClaudeThreadSession>,
        request: &ClaudeSessionRequest,
    ) -> Result<bool, String> {
        let facts = session.facts();
        let disposition = decide_session_disposition(
            Some(LiveSessionFacts {
                fingerprint: &facts.fingerprint,
                conversation: facts.conversation.as_deref(),
                availability: facts.availability,
            }),
            RequestedSessionFacts {
                fingerprint: &request.fingerprint,
                resume_session_id: request.resume_session_id.as_deref(),
            },
        );
        match disposition {
            ClaudeSessionDisposition::Reuse => Ok(true),
            ClaudeSessionDisposition::Busy => Err(CLAUDE_SESSION_BUSY_ERROR.to_string()),
            ClaudeSessionDisposition::Spawn => Ok(false),
            ClaudeSessionDisposition::Restart(reason) => {
                let refuse = reason.needs_confirmation()
                    && request.restart == ClaudeSessionRestartPolicy::RefuseIfBackground
                    && session.has_background_processes();
                if refuse {
                    return Err(CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR.to_string());
                }
                self.end_and_wait(session, ClaudeSessionEndReason::Restarted)?;
                Ok(false)
            }
        }
    }

    fn reserve_slot(
        self: &Arc<Self>,
        key: &ClaudeSessionKey,
    ) -> Result<Option<StartingGuard>, String> {
        for _ in 0..self.tuning.max_live_sessions.max(1) {
            let sessions = {
                let mut state = self.state();
                if state.closed {
                    return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
                }
                if state.starting.contains(key) {
                    return Err(CLAUDE_SESSION_BUSY_ERROR.to_string());
                }
                if state.sessions.len() + state.starting.len() < self.tuning.max_live_sessions {
                    state.starting.insert(key.clone());
                    return Ok(Some(StartingGuard {
                        inner: Arc::clone(self),
                        key: key.clone(),
                    }));
                }
                state.sessions.values().cloned().collect::<Vec<_>>()
            };
            let candidates: Vec<EvictionCandidate> = sessions
                .iter()
                .map(|session| {
                    let facts = session.facts();
                    EvictionCandidate {
                        key: session.key().clone(),
                        generation: facts.generation,
                        attached: facts.availability != SessionAvailability::Idle,
                        background: session.background_processes(),
                        last_activity: facts.last_activity,
                    }
                })
                .collect();
            let victim = choose_eviction(&candidates)
                .and_then(|key| sessions.iter().find(|session| session.key() == key));
            let Some(victim) = victim else {
                return Ok(None);
            };
            self.end_and_wait(victim, ClaudeSessionEndReason::Evicted)?;
        }
        Ok(None)
    }

    fn insert(
        &self,
        key: &ClaudeSessionKey,
        session: &Arc<ClaudeThreadSession>,
    ) -> Result<(), String> {
        let mut state = self.state();
        if state.closed {
            drop(state);
            session.kill_now(ClaudeSessionEndReason::Shutdown);
            return Err(CLAUDE_SESSION_ADMISSION_CLOSED_ERROR.to_string());
        }
        state.sessions.insert(key.clone(), Arc::clone(session));
        Ok(())
    }

    fn end_and_wait(
        &self,
        session: &Arc<ClaudeThreadSession>,
        reason: ClaudeSessionEndReason,
    ) -> Result<(), String> {
        session.terminate(reason);
        if !session.wait_reaped(self.tuning.end_timeout()) {
            return Err(CLAUDE_SESSION_STOP_TIMEOUT_ERROR.to_string());
        }
        let mut state = self.state();
        if state
            .sessions
            .get(session.key())
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            state.sessions.remove(session.key());
        }
        Ok(())
    }
}

impl ClaudeSessionOwner for RegistryInner {
    fn session_ended(
        &self,
        key: &ClaudeSessionKey,
        generation: u64,
        reason: ClaudeSessionEndReason,
        background_processes_stopped: bool,
    ) {
        {
            let mut state = self.state();
            if state
                .sessions
                .get(key)
                .is_some_and(|session| session.generation() == generation)
            {
                state.sessions.remove(key);
            }
        }
        let event = ClaudeSessionEndedEvent {
            workspace_id: key.workspace_id.clone(),
            thread_id: key.thread_id.clone(),
            reason,
            background_processes_stopped,
        };
        let _ = catch_unwind(AssertUnwindSafe(|| self.events.ended(event)));
    }
}
```

- [ ] **Step 4: Append the spawner-facing plan to `claude_session_turn.rs`**

```rust
use super::{
    claude_session_policy::{args_without_resume, ClaudeSessionFingerprint, ExecutableFingerprint},
    claude_session_registry::{ClaudeSessionLease, ClaudeSessionRegistry, ClaudeSessionRequest},
    agent_launch::AgentLaunchOptions,
    spawn_bound_process, spawn_per_turn_process, AgentTaskSpawnPlan,
};
use std::process::Stdio;

pub type ClaudeSessionAuthority = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

#[derive(Clone)]
pub struct ClaudeSessionTurnPlan {
    registry: Arc<ClaudeSessionRegistry>,
    request: ClaudeSessionRequest,
    validate_authority: ClaudeSessionAuthority,
}

impl std::fmt::Debug for ClaudeSessionTurnPlan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClaudeSessionTurnPlan")
            .field("thread_id", &self.request.key.thread_id)
            .finish_non_exhaustive()
    }
}

impl ClaudeSessionTurnPlan {
    pub fn new(
        registry: Arc<ClaudeSessionRegistry>,
        request: ClaudeSessionRequest,
        validate_authority: ClaudeSessionAuthority,
    ) -> Self {
        Self {
            registry,
            request,
            validate_authority,
        }
    }

    pub(crate) fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let Some(frame) = plan.stdin_frame_bytes() else {
            return spawn_per_turn_process(plan);
        };
        let lease = self
            .registry
            .acquire(&self.request, || spawn_bound_process(plan, Stdio::piped()))?;
        let ClaudeSessionLease::Session(session) = lease else {
            return spawn_per_turn_process(plan);
        };
        if let Err(error) = (self.validate_authority)() {
            session.terminate(ClaudeSessionEndReason::Released);
            return Err(error);
        }
        session
            .attach_turn(frame)
            .map(|turn| Box::new(turn) as Box<dyn AgentChild>)
    }
}

pub fn session_fingerprint(
    plan: &AgentTaskSpawnPlan,
    launch: AgentLaunchOptions,
    provider_generation: u64,
) -> ClaudeSessionFingerprint {
    let identity = plan.executable_identity();
    ClaudeSessionFingerprint {
        executable: executable_fingerprint(identity),
        provider_generation,
        launch,
        args_without_resume: args_without_resume(plan.args()),
        env: plan.env().to_vec(),
        cwd: plan.cwd().to_path_buf(),
        cwd_identity: cwd_identity(plan),
    }
}

#[cfg(unix)]
fn executable_fingerprint(
    identity: &super::agent_provider::process::ExecutableIdentity,
) -> ExecutableFingerprint {
    ExecutableFingerprint {
        path: identity.canonical_path.clone(),
        size_bytes: identity.size_bytes,
        modified_epoch_ms: identity.modified_epoch_ms,
        device: identity.device,
        inode: identity.inode,
    }
}

#[cfg(not(unix))]
fn executable_fingerprint(
    identity: &super::agent_provider::process::ExecutableIdentity,
) -> ExecutableFingerprint {
    ExecutableFingerprint {
        path: identity.canonical_path.clone(),
        size_bytes: identity.size_bytes,
        modified_epoch_ms: identity.modified_epoch_ms,
        device: 0,
        inode: 0,
    }
}

#[cfg(unix)]
fn cwd_identity(plan: &AgentTaskSpawnPlan) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    plan.retained_cwd_authority()
        .and_then(|directory| directory.metadata().ok())
        .map(|metadata| (metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn cwd_identity(_plan: &AgentTaskSpawnPlan) -> Option<(u64, u64)> {
    None
}
```

Merge these `use` lines into the file's existing `use super::{...}` block rather than keeping two blocks.

- [ ] **Step 5: Add the plan field and the spawner dispatch.** In `agent_task_spawner.rs`:
  - Add `claude_session: Option<claude_session_turn::ClaudeSessionTurnPlan>,` to `AgentTaskSpawnPlan`, with `claude_session: None,` in both constructors.
  - Add:

```rust
    pub fn with_claude_session(
        mut self,
        plan: claude_session_turn::ClaudeSessionTurnPlan,
    ) -> Self {
        self.claude_session = Some(plan);
        self
    }

    pub(crate) fn stdin_frame_bytes(&self) -> Option<&Arc<[u8]>> {
        self.stdin_frame()
    }
```

  - Make `StdAgentProcessSpawner::spawn` check the session first:

```rust
        if let Some(session) = &plan.claude_session {
            return session.spawn(plan);
        }
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_session_registry_tests claude_thread_session_tests -- --test-threads=1 && cargo test --test agent_root_lease_tests && cargo test --lib; echo "exit=$?"`
Expected: `exit=0`.

### Task 3.7: Supervisor integration - interrupt, stopped resolution, settlement ownership

**Files:**
- Create: `src-tauri/src/agent_task_interrupt.rs`
- Modify: `src-tauri/src/agent_task_supervisor.rs`:
  - `AgentTaskEntry` gains `interrupt_requested: bool` (:568-613)
  - add the module declaration next to the steering module (:12-13)
- Modify: `src-tauri/src/agent_task_steering.rs` (`result_watch` :16-20, `steerable_input` :158-181)
- Modify: `src-tauri/src/agent_task_completion.rs` (`resolve_terminal_status` call :55)
- Create: `src-tauri/tests/support/claude_session_supervisor_tests.rs`
- Modify: `src-tauri/tests/agent_task_supervisor_tests.rs` (tail include)

**Interfaces:**
- Consumes: the Task 3.4 slot interrupt and the Tasks 3.5/3.6 sessions.
- Produces:
  - `AgentTaskRegistry::interrupt_for_thread(&self, task_id: &str, workspace_id: &str, thread_id: &str) -> AgentTaskInterruptOutcome`
  - `#[serde(tag = "kind", rename_all = "camelCase")] enum AgentTaskInterruptOutcome { Interrupting, Unsupported, Unavailable, Stopping }`

- [ ] **Step 1: Write the failing supervised tests.** Create `src-tauri/tests/support/claude_session_supervisor_tests.rs`:

```rust
use super::claude_session_registry_tests::{session_registry, session_request, RecordingSessionEvents};
use super::fake_claude_cli::*;
use super::*;
use agent_task_spawner::agent_launch::AgentLaunchOptions;
use agent_task_spawner::claude_session_policy::{
    ClaudeSessionEndReason, ClaudeSessionRestartPolicy, ClaudeSessionTuning,
};
use agent_task_spawner::claude_session_registry::ClaudeSessionRegistry;
use agent_task_spawner::claude_session_turn::ClaudeSessionTurnPlan;
use agent_task_supervisor::agent_task_interrupt::AgentTaskInterruptOutcome;

const WORKSPACE: &str = "ws-agent-tests";
const RESUME: Option<&str> = Some("sess-fixture-0001");

struct SessionHarness {
    cli: FakeCli,
    sessions: Arc<ClaudeSessionRegistry>,
    events: Arc<RecordingSessionEvents>,
    tasks: AgentTaskRegistry,
    admission: Arc<AgentTaskAdmissionRegistry>,
    sink: Arc<RecordingSink>,
}

impl SessionHarness {
    fn new(label: &str, tuning: ClaudeSessionTuning) -> Self {
        let cli = FakeCli::new(label);
        let (sessions, events) = session_registry(tuning);
        let admission = Arc::new(AgentTaskAdmissionRegistry::new());
        let sink = Arc::new(RecordingSink::default());
        let tasks = AgentTaskRegistry::new(
            Arc::clone(&admission),
            Arc::new(StdAgentProcessSpawner),
            Arc::clone(&sink) as Arc<dyn AgentTaskEventSink>,
        );
        Self {
            cli,
            sessions,
            events,
            tasks,
            admission,
            sink,
        }
    }

    fn start_turn(
        &self,
        task_id: &str,
        thread_id: &str,
        prompt: &str,
        resume: Option<&str>,
    ) -> Result<(), String> {
        let request = session_request(
            &self.cli,
            WORKSPACE,
            thread_id,
            resume,
            AgentLaunchOptions::default(),
            ClaudeSessionRestartPolicy::RefuseIfBackground,
        );
        let plan = self
            .cli
            .plan("sess-fixture-0001", prompt)
            .with_claude_session(ClaudeSessionTurnPlan::new(
                Arc::clone(&self.sessions),
                request,
                Arc::new(|| Ok(())),
            ));
        let admission = self
            .admission
            .reserve(
                &workspace(WORKSPACE),
                &self.cli.dir,
                &self.cli.dir,
                AgentTaskIsolation::InPlace,
            )
            .expect("admission");
        self.tasks.start(
            AgentTaskStartRequest {
                task_id: task_id.to_string(),
                thread_id: thread_id.to_string(),
                workspace_id: WORKSPACE.to_string(),
                repository_root: self.cli.dir.clone(),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
            },
            plan,
            admission,
        )?;
        self.tasks.acknowledge(task_id)
    }

    fn terminal(&self, task_id: &str) -> AgentTaskStatusPayload {
        assert!(
            wait_until(Duration::from_secs(15), || self.sink.has_terminal_status(task_id)),
            "{task_id} never reached a terminal status"
        );
        statuses_for(&self.sink, task_id)
            .last()
            .map(|event| event.status.clone())
            .expect("terminal status")
    }

    fn stdout(&self, task_id: &str) -> String {
        outputs_for(&self.sink, task_id)
            .iter()
            .filter(|event| event.stream == AgentTaskOutputStream::Stdout)
            .map(|event| event.chunk.as_str())
            .collect()
    }

    fn settle_with_background(&self, task_id: &str) -> i32 {
        self.start_turn(task_id, "thread-a", "spawn-background", None)
            .expect("background turn");
        assert!(matches!(
            self.terminal(task_id),
            AgentTaskStatusPayload::Exited { exit_code: 0 }
        ));
        self.cli.background_pid().expect("background pid")
    }
}

impl Drop for SessionHarness {
    fn drop(&mut self) {
        self.sessions.shutdown_all();
    }
}

#[test]
fn background_process_survives_turn_end_and_next_turn_reuses_the_process() {
    let harness = SessionHarness::new("supervised-survival", ClaudeSessionTuning::default());
    let background = harness.settle_with_background("agt-sess-1");
    thread::sleep(Duration::from_millis(500));
    assert!(alive(background), "the turn end killed the agent's background process");
    harness
        .start_turn("agt-sess-2", "thread-a", "hello", RESUME)
        .expect("turn 2");
    assert!(matches!(
        harness.terminal("agt-sess-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert!(harness.stdout("agt-sess-2").contains("echo:hello"));
    assert_eq!(harness.cli.cli_pids().len(), 1, "turn 2 must run in the same CLI process");
    assert!(alive(background));
}

#[test]
fn first_stop_interrupts_the_foreground_and_keeps_background_work() {
    let harness = SessionHarness::new("supervised-interrupt", ClaudeSessionTuning::default());
    let background = harness.settle_with_background("agt-int-1");
    harness
        .start_turn("agt-int-2", "thread-a", "slow", RESUME)
        .expect("slow turn");
    assert!(wait_until(Duration::from_secs(5), || harness
        .stdout("agt-int-2")
        .contains("echo:slow")));
    assert_eq!(
        harness.tasks.interrupt_for_thread("agt-int-2", WORKSPACE, "thread-a"),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert!(matches!(harness.terminal("agt-int-2"), AgentTaskStatusPayload::Stopped));
    assert!(alive(background));
    assert!(alive(harness.cli.cli_pids()[0]));
    assert!(harness.events.reasons_for("thread-a").is_empty());
}

#[test]
fn second_stop_ends_the_session_and_its_background_work() {
    let harness = SessionHarness::new("supervised-second-stop", ClaudeSessionTuning::default());
    let background = harness.settle_with_background("agt-stop-1");
    harness
        .start_turn("agt-stop-2", "thread-a", "slow-ignore", RESUME)
        .expect("slow turn");
    assert!(wait_until(Duration::from_secs(5), || harness
        .stdout("agt-stop-2")
        .contains("echo:slow-ignore")));
    assert_eq!(
        harness.tasks.interrupt_for_thread("agt-stop-2", WORKSPACE, "thread-a"),
        AgentTaskInterruptOutcome::Interrupting
    );
    assert_eq!(
        harness.tasks.interrupt_for_thread("agt-stop-2", WORKSPACE, "thread-a"),
        AgentTaskInterruptOutcome::Interrupting,
        "a repeated interrupt is idempotent"
    );
    harness
        .tasks
        .stop_for_workspace("agt-stop-2", WORKSPACE)
        .expect("hard stop");
    assert!(matches!(harness.terminal("agt-stop-2"), AgentTaskStatusPayload::Stopped));
    assert!(gone_within(background, Duration::from_secs(5)));
    assert!(gone_within(harness.cli.cli_pids()[0], Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || harness
        .events
        .reasons_for("thread-a")
        == vec![ClaudeSessionEndReason::Stopped]));
}

#[test]
fn interrupt_is_unsupported_for_a_per_turn_process_and_foreign_owners() {
    let harness = SessionHarness::new("supervised-unsupported", ClaudeSessionTuning::default());
    harness
        .start_turn("agt-own-1", "thread-a", "slow", None)
        .expect("turn");
    assert!(wait_until(Duration::from_secs(5), || harness
        .stdout("agt-own-1")
        .contains("echo:slow")));
    assert_eq!(
        harness.tasks.interrupt_for_thread("agt-own-1", "ws-other", "thread-a"),
        AgentTaskInterruptOutcome::Unavailable
    );
    assert_eq!(
        harness.tasks.interrupt_for_thread("agt-own-1", WORKSPACE, "thread-b"),
        AgentTaskInterruptOutcome::Unavailable
    );
    harness
        .tasks
        .stop_for_workspace("agt-own-1", WORKSPACE)
        .expect("stop");
    assert!(matches!(harness.terminal("agt-own-1"), AgentTaskStatusPayload::Stopped));
}

#[test]
fn a_crash_mid_turn_fails_only_that_turn_and_the_next_turn_respawns() {
    let harness = SessionHarness::new("supervised-crash", ClaudeSessionTuning::default());
    harness
        .start_turn("agt-crash-1", "thread-a", "hello", None)
        .expect("turn 1");
    harness.terminal("agt-crash-1");
    harness
        .start_turn("agt-crash-2", "thread-a", "crash", RESUME)
        .expect("turn 2");
    assert!(matches!(
        harness.terminal("agt-crash-2"),
        AgentTaskStatusPayload::Exited { exit_code: 9 }
    ));
    assert!(wait_until(Duration::from_secs(5), || harness
        .events
        .reasons_for("thread-a")
        == vec![ClaudeSessionEndReason::Crashed]));
    harness
        .start_turn("agt-crash-3", "thread-a", "hello", RESUME)
        .expect("turn 3");
    assert!(matches!(
        harness.terminal("agt-crash-3"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    assert_eq!(harness.cli.cli_pids().len(), 2);
}

#[test]
fn an_unpublished_start_failure_kills_a_fresh_session() {
    let harness = SessionHarness::new("supervised-start-failure", ClaudeSessionTuning::default());
    harness.tasks.fail_next_waiter_start_for_tests();
    let error = harness
        .start_turn("agt-fail-1", "thread-a", "slow", None)
        .expect_err("injected waiter failure");
    assert!(error.contains("injected"), "{error}");
    assert!(wait_until(Duration::from_secs(5), || !harness.cli.cli_pids().is_empty()));
    assert!(gone_within(harness.cli.cli_pids()[0], Duration::from_secs(5)));
    assert!(wait_until(Duration::from_secs(5), || harness.sessions.live_sessions() == 0));
}

#[test]
fn a_steer_after_settlement_is_refused_and_the_session_survives() {
    let harness = SessionHarness::new("supervised-late-steer", ClaudeSessionTuning::default());
    harness
        .start_turn("agt-late-1", "thread-a", "hello", None)
        .expect("turn");
    harness.terminal("agt-late-1");
    let refused = harness.tasks.steer_for_workspace(
        "agt-late-1",
        WORKSPACE,
        Arc::from(claude_user_frame("late", &[]).as_slice()),
    );
    assert!(refused.is_err());
    assert!(alive(harness.cli.cli_pids()[0]));
    assert!(harness.events.reasons_for("thread-a").is_empty());
}

#[test]
fn a_turn_without_a_free_slot_falls_back_to_a_per_turn_process() {
    let harness = SessionHarness::new(
        "supervised-ephemeral",
        ClaudeSessionTuning {
            max_live_sessions: 1,
            ..ClaudeSessionTuning::default()
        },
    );
    harness
        .start_turn("agt-eph-1", "thread-a", "slow", None)
        .expect("busy turn");
    assert!(wait_until(Duration::from_secs(5), || harness
        .stdout("agt-eph-1")
        .contains("echo:slow")));
    harness
        .start_turn("agt-eph-2", "thread-b", "hello", None)
        .expect("ephemeral turn");
    assert!(matches!(
        harness.terminal("agt-eph-2"),
        AgentTaskStatusPayload::Exited { exit_code: 0 }
    ));
    let pids = harness.cli.cli_pids();
    assert_eq!(pids.len(), 2);
    assert!(gone_within(pids[1], Duration::from_secs(5)), "an ephemeral turn must not leave its process behind");
    assert!(alive(pids[0]));
}
```

Append the include to `tests/agent_task_supervisor_tests.rs`:

```rust
#[path = "support/claude_session_supervisor_tests.rs"]
mod claude_session_supervisor_tests;
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_session_supervisor_tests`
Expected: compile FAIL, `could not find agent_task_interrupt`.

- [ ] **Step 3: Implement `src-tauri/src/agent_task_interrupt.rs`**

```rust
use super::{AgentTaskPhase, AgentTaskRegistry};
use crate::agent_task_spawner::{
    agent_task_input::AgentTaskInterruptRejection, AGENT_STDIN_FRAME_DEADLINE,
};
use serde::Serialize;
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentTaskInterruptOutcome {
    Interrupting,
    Unsupported,
    Unavailable,
    Stopping,
}

impl AgentTaskRegistry {
    pub fn interrupt_for_thread(
        &self,
        task_id: &str,
        workspace_id: &str,
        thread_id: &str,
    ) -> AgentTaskInterruptOutcome {
        let input = {
            let mut state = self.shared.state();
            let Some(entry) = state.entries.get_mut(task_id) else {
                return AgentTaskInterruptOutcome::Unavailable;
            };
            if entry.metadata.workspace_id != workspace_id || entry.metadata.thread_id != thread_id
            {
                return AgentTaskInterruptOutcome::Unavailable;
            }
            if entry.stop_requested
                || entry.watchdog_timed_out
                || !matches!(entry.phase, AgentTaskPhase::Running)
            {
                return AgentTaskInterruptOutcome::Unavailable;
            }
            if entry.interrupt_requested {
                return AgentTaskInterruptOutcome::Interrupting;
            }
            let Some(input) = entry.input.clone() else {
                return AgentTaskInterruptOutcome::Unsupported;
            };
            if !input.provider_owns_settlement() {
                return AgentTaskInterruptOutcome::Unsupported;
            }
            entry.interrupt_requested = true;
            input
        };
        match input.interrupt(Instant::now() + AGENT_STDIN_FRAME_DEADLINE) {
            Ok(()) => AgentTaskInterruptOutcome::Interrupting,
            Err(AgentTaskInterruptRejection::WriteFailed) => {
                let _ = self.stop_owned(task_id, Some(workspace_id));
                AgentTaskInterruptOutcome::Stopping
            }
            Err(AgentTaskInterruptRejection::Unsupported) => {
                self.clear_interrupt(task_id);
                AgentTaskInterruptOutcome::Unsupported
            }
            Err(AgentTaskInterruptRejection::Unavailable) => {
                self.clear_interrupt(task_id);
                AgentTaskInterruptOutcome::Unavailable
            }
        }
    }

    fn clear_interrupt(&self, task_id: &str) {
        if let Some(entry) = self.shared.state().entries.get_mut(task_id) {
            entry.interrupt_requested = false;
        }
    }
}
```

- [ ] **Step 4: Supervisor, steering and completion hunks**
  - `agent_task_supervisor.rs`:
    - Add `interrupt_requested: bool,` to `AgentTaskEntry` after `stop_requested`, and `interrupt_requested: false,` in `AgentTaskEntry::new`.
    - Add after the steering module:
      ```rust
      #[path = "agent_task_interrupt.rs"]
      pub mod agent_task_interrupt;
      ```
  - `agent_task_steering.rs`, `result_watch`:
    ```rust
    pub(super) fn result_watch(input: Option<Arc<AgentTaskInputSlot>>) -> Option<AgentTaskResultWatch> {
        let input = input?;
        if input.provider_owns_settlement() {
            return None;
        }
        let detector = ResultLineDetector::new().with_lifecycle(input.claude_lifecycle());
        Some((input, detector))
    }
    ```
  - `agent_task_steering.rs`, `steerable_input`: change `if entry.stop_requested || entry.watchdog_timed_out {` to `if entry.stop_requested || entry.interrupt_requested || entry.watchdog_timed_out {`.
  - `agent_task_completion.rs`: change the call to `resolve_terminal_status(entry.stop_requested || entry.interrupt_requested, entry.watchdog_timed_out, payload)`.

- [ ] **Step 5: Run the tests and confirm they pass, then run the whole supervisor surface**

Run: `cd src-tauri && cargo test --test agent_task_supervisor_tests claude_session -- --test-threads=1 && cargo test --test agent_task_supervisor_tests && cargo test --test agent_root_lease_tests && cargo test --lib; echo "exit=$?"`
Expected: `exit=0`. Run `npm run size:hotspots` too. Expected: PASS, and `agent_task_supervisor.rs` is still below 10000 tokens.

- [ ] **Step 6: C2 review checkpoint.** Run two independent read-only reviews, fable-5.1 and Opus 5, with this brief:

  "Review Tasks 3.4-3.7 for:
  - process-group anchor safety (the `reaping` flag under `state`, the single reaper),
  - lock order router→state,
  - no channel send under a lock,
  - every reaping path: stop, interrupt deadline, crash, idle TTL, eviction, root release, shutdown, Drop, panic in waiter, unpublished-start Drop,
  - A→B→A owner displacement,
  - the ephemeral fallback,
  - turn output ordering at settlement,
  - stdin frame deadlines.

  Verify findings against code before reporting; do not overstate."

  Fix confirmed findings with a regression test each. The lead commits after both reviews approve:

```bash
git add src-tauri/src/agent_task_input.rs src-tauri/src/agent_task_input_tests.rs src-tauri/src/agent_task_spawner.rs src-tauri/src/claude_thread_session.rs src-tauri/src/claude_session_turn.rs src-tauri/src/claude_session_registry.rs src-tauri/src/agent_task_interrupt.rs src-tauri/src/agent_task_supervisor.rs src-tauri/src/agent_task_steering.rs src-tauri/src/agent_task_completion.rs src-tauri/tests/support/fake_claude_cli.rs src-tauri/tests/support/claude_thread_session_tests.rs src-tauri/tests/support/claude_session_registry_tests.rs src-tauri/tests/support/claude_session_supervisor_tests.rs src-tauri/tests/agent_task_supervisor_tests.rs
git commit -m "feat(agent): run Claude turns in a persistent per-thread session"
```

The runtime is not wired yet. Composition still builds plans without `with_claude_session`, so production behaviour is unchanged until Task 3.8.

### Task 3.8: Composition, Tauri commands and every reaping hook

**Files:**
- Create: `src-tauri/src/lib_composition/claude_session_composition.rs`
- Modify: `src-tauri/src/lib_composition/agent_task_commands.rs`:
  - module declaration next to `codex_task_composition` (:70-71)
  - `StartAgentTaskRequest` (:103-120)
  - start path (:630-660)
  - `stop_agent_tasks_for_root` (:927-938)
  - `stop_agent_tasks_on_dispose` (:1232-1247)
- Modify: `src-tauri/src/lib_composition/git_worktree_commands.rs:136-149`
- Modify: `src-tauri/src/lib_composition/agent_thread_store_commands.rs:94-104`
- Modify: `src-tauri/src/lib_composition/runtime.rs:194-226` (construction) and `:615-640` (command registration)
- Modify: `src-tauri/src/runtime_task_lifecycle.rs:82-92`

**Interfaces:**
- Consumes: the registry, turn plan and fingerprint (Task 3.6), and the interrupt (Task 3.7).
- Produces:
  - Tauri commands:
    - `interrupt_agent_task({taskId, workspaceId, threadId}) -> {kind}`
    - `inspect_agent_thread_session({workspaceId, threadId, resumeSessionId, launch}) -> {kind, backgroundProcesses?}`
    - `end_agent_thread_session({workspaceId, threadId}) -> {ended}`
  - Event `agent-session://ended`
  - Optional field `sessionRestart` on `start_agent_task`

- [ ] **Step 1: Write the failing composition tests.** Put them at the bottom of the new file (the file is created in Step 3; write the test module first and run it to see the failure):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_task_spawner::claude_session_policy::ClaudeSessionEndedEvent;
    use crate::agent_task_supervisor::system_process_group_signals;
    use serde_json::json;

    struct NoEvents;

    impl ClaudeSessionEventSink for NoEvents {
        fn ended(&self, _event: ClaudeSessionEndedEvent) {}
    }

    fn start_request(extra: serde_json::Value) -> Result<StartAgentTaskRequest, serde_json::Error> {
        let mut value = json!({
            "taskId": "agt-1-0a1b",
            "workspaceId": "ws-1",
            "projectRoot": "/repo",
            "repositoryRoot": "/repo",
            "cwd": "/repo",
            "isolation": "in-place",
            "prompt": "hi",
            "agentCliKind": "claudeCode",
            "resumeSessionId": null,
            "launch": serde_json::to_value(AgentLaunchOptions::default()).expect("launch"),
            "providerGeneration": 1,
            "threadId": "agt-1-0a1c"
        });
        if let (Some(target), Some(extra)) = (value.as_object_mut(), extra.as_object()) {
            target.extend(extra.clone());
        }
        serde_json::from_value(value)
    }

    fn registry() -> Arc<ClaudeSessionRegistry> {
        Arc::new(ClaudeSessionRegistry::new(
            system_process_group_signals(),
            Arc::new(NoEvents),
        ))
    }

    fn plan() -> AgentTaskSpawnPlan {
        AgentTaskSpawnPlan::for_tests(
            std::env::current_exe().expect("test binary"),
            vec!["-p".to_string()],
            PathBuf::from("/repo"),
            Vec::new(),
        )
    }

    #[test]
    fn a_claude_stdin_plan_gets_a_session_plan() {
        let request = start_request(json!({})).expect("request");
        let prepared = prepare_transport(
            plan().with_stdin_frame_for_tests(b"{}\n".to_vec()),
            &request,
            Path::new("/repo"),
            &registry(),
            Arc::new(|| Ok(())),
        );
        assert_eq!(prepared.has_claude_session(), cfg!(unix));
    }

    #[test]
    fn an_argv_plan_stays_on_the_per_turn_path() {
        let request = start_request(json!({})).expect("request");
        let prepared = prepare_transport(plan(), &request, Path::new("/repo"), &registry(), Arc::new(|| Ok(())));
        assert!(!prepared.has_claude_session());
    }

    #[test]
    fn start_requests_default_to_refusing_a_background_restart() {
        assert_eq!(
            start_request(json!({})).expect("default").session_restart,
            ClaudeSessionRestartPolicy::RefuseIfBackground
        );
        assert_eq!(
            start_request(json!({"sessionRestart": "stopBackground"}))
                .expect("explicit")
                .session_restart,
            ClaudeSessionRestartPolicy::StopBackground
        );
        assert!(start_request(json!({"sessionRestart": "always"})).is_err());
    }

    #[test]
    fn session_requests_are_closed() {
        assert!(serde_json::from_value::<AgentThreadSessionRequest>(json!({
            "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "extra": 1
        }))
        .is_err());
        assert!(serde_json::from_value::<InterruptAgentTaskRequest>(json!({
            "taskId": "agt-1-0a1b", "workspaceId": "ws-1", "threadId": "agt-1-0a1c"
        }))
        .is_ok());
        assert!(serde_json::from_value::<InspectAgentThreadSessionRequest>(json!({
            "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "resumeSessionId": null,
            "launch": serde_json::to_value(AgentLaunchOptions::default()).expect("launch")
        }))
        .is_ok());
    }

    #[test]
    fn wire_shapes_match_the_frontend_contract() {
        assert_eq!(AGENT_SESSION_ENDED_EVENT_CHANNEL, "agent-session://ended");
        assert_eq!(
            serde_json::to_string(&AgentTaskInterruptOutcome::Interrupting).expect("json"),
            r#"{"kind":"interrupting"}"#
        );
        assert_eq!(
            serde_json::to_string(&EndAgentThreadSessionResult { ended: true }).expect("json"),
            r#"{"ended":true}"#
        );
    }
}
```

Add a test-only accessor to `AgentTaskSpawnPlan` in `agent_task_spawner.rs`:

```rust
    #[cfg(test)]
    pub fn has_claude_session(&self) -> bool {
        self.claude_session.is_some()
    }
```

Run: `cd src-tauri && cargo test --lib claude_session_composition`
Expected: compile FAIL (the functions do not exist yet).

- [ ] **Step 2: Add the request field and the module.** In `agent_task_commands.rs`:
  1. Import `crate::agent_task_spawner::claude_session_policy::{ClaudeSessionEndReason, ClaudeSessionRestartPolicy}` and `crate::agent_task_spawner::claude_session_registry::ClaudeSessionRegistry`.
  2. Add to `StartAgentTaskRequest`, after `attachments`:
     ```rust
         #[serde(default)]
         session_restart: ClaudeSessionRestartPolicy,
     ```
  3. Declare the module after `codex_task_composition`:
     ```rust
     #[path = "claude_session_composition.rs"]
     pub(crate) mod claude_session_composition;
     ```

- [ ] **Step 3: Implement `claude_session_composition.rs`** (above the test module):

```rust
use super::{
    codex_task_composition::CodexProviderHostLifecycle, ensure_workspace_id_bounds,
    safe_agent_task_id, StartAgentTaskRequest,
};
use crate::agent_task_spawner::{
    agent_launch::AgentLaunchOptions,
    agent_provider::runtime::{AgentProviderHostLifecycle, AgentProviderRuntimeRegistry},
    claude_session_policy::{
        ClaudeSessionEndReason, ClaudeSessionEndedEvent, ClaudeSessionInspection, ClaudeSessionKey,
        ClaudeSessionRestartPolicy,
    },
    claude_session_registry::{ClaudeSessionEventSink, ClaudeSessionRegistry, ClaudeSessionRequest},
    claude_session_turn::{session_fingerprint, ClaudeSessionAuthority, ClaudeSessionTurnPlan},
    validate_resume_session_id, AgentCliInvocation, AgentTaskSpawnPlan,
};
use crate::agent_task_supervisor::{agent_task_interrupt::AgentTaskInterruptOutcome, AgentTaskRegistry};
use crate::run_blocking_command;
use crate::workspace_registry::WorkspaceId;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(test)]
use std::path::PathBuf;

pub(crate) const AGENT_SESSION_ENDED_EVENT_CHANNEL: &str = "agent-session://ended";

pub(super) fn prepare_transport(
    plan: AgentTaskSpawnPlan,
    request: &StartAgentTaskRequest,
    repository_root: &Path,
    sessions: &Arc<ClaudeSessionRegistry>,
    validate_authority: ClaudeSessionAuthority,
) -> AgentTaskSpawnPlan {
    if !cfg!(unix)
        || request.agent_cli_kind != AgentCliInvocation::ClaudeCode
        || plan.stdin_frame_bytes().is_none()
    {
        return plan;
    }
    let session_request = ClaudeSessionRequest {
        key: ClaudeSessionKey {
            workspace_id: request.workspace_id.as_str().to_string(),
            thread_id: request.thread_id.clone(),
        },
        repository_root: repository_root.to_path_buf(),
        fingerprint: session_fingerprint(&plan, request.launch, request.provider_generation),
        resume_session_id: request.resume_session_id.clone(),
        restart: request.session_restart,
    };
    plan.with_claude_session(ClaudeSessionTurnPlan::new(
        Arc::clone(sessions),
        session_request,
        validate_authority,
    ))
}

pub(crate) struct AppHandleClaudeSessionEvents(pub(crate) AppHandle);

impl ClaudeSessionEventSink for AppHandleClaudeSessionEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        let _ = self.0.emit(AGENT_SESSION_ENDED_EVENT_CHANNEL, event);
    }
}

pub(crate) struct AgentProviderHostLifecycles {
    pub(crate) codex: CodexProviderHostLifecycle,
    pub(crate) claude: Arc<ClaudeSessionRegistry>,
}

impl AgentProviderHostLifecycle for AgentProviderHostLifecycles {
    fn retire_idle_hosts(&self, provider: AgentCliInvocation) -> Result<(), String> {
        self.codex.retire_idle_hosts(provider)?;
        if provider == AgentCliInvocation::ClaudeCode {
            self.claude.retire_idle_for_update();
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InterruptAgentTaskRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    thread_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentThreadSessionRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InspectAgentThreadSessionRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    resume_session_id: Option<String>,
    launch: AgentLaunchOptions,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndAgentThreadSessionResult {
    ended: bool,
}

#[tauri::command]
pub(crate) async fn interrupt_agent_task(
    app: AppHandle,
    request: InterruptAgentTaskRequest,
) -> Result<AgentTaskInterruptOutcome, String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    run_blocking_command(move || {
        Ok(app.state::<AgentTaskRegistry>().interrupt_for_thread(
            &task_id,
            request.workspace_id.as_str(),
            &thread_id,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_agent_thread_session(
    request: InspectAgentThreadSessionRequest,
    sessions: State<'_, Arc<ClaudeSessionRegistry>>,
    providers: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<ClaudeSessionInspection, String> {
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    if let Some(candidate) = request.resume_session_id.as_deref() {
        validate_resume_session_id(candidate)?;
    }
    let sessions = Arc::clone(&sessions);
    let providers = Arc::clone(&providers);
    run_blocking_command(move || {
        let Some((_, receipt)) = providers.policy_snapshot(AgentCliInvocation::ClaudeCode) else {
            return Ok(ClaudeSessionInspection::None);
        };
        Ok(sessions.inspect(
            request.workspace_id.as_str(),
            &thread_id,
            &request.launch,
            request.resume_session_id.as_deref(),
            receipt.provider_generation,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn end_agent_thread_session(
    request: AgentThreadSessionRequest,
    sessions: State<'_, Arc<ClaudeSessionRegistry>>,
) -> Result<EndAgentThreadSessionResult, String> {
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let sessions = Arc::clone(&sessions);
    run_blocking_command(move || {
        Ok(EndAgentThreadSessionResult {
            ended: sessions.end_for_thread(
                request.workspace_id.as_str(),
                &thread_id,
                ClaudeSessionEndReason::ThreadEnded,
            ),
        })
    })
    .await
}
```

Use whichever path the compiler requires for `AgentProviderRuntimeRegistry` (it lives in `agent_task_spawner::agent_provider::runtime`, the same import as `ProviderTurnLease` in `agent_task_commands.rs:15`).

- [ ] **Step 4: Wire the start path.** In `start_owned_agent_task`:
  1. Give the closure an explicit type: `let validate_authority: ClaudeSessionAuthority = Arc::new(move || { ... });`, importing `ClaudeSessionAuthority`.
  2. Pass `Arc::clone(&validate_authority)` to `codex_task_composition::prepare_transport`.
  3. Directly after that `?;`, add:

```rust
        let plan = claude_session_composition::prepare_transport(
            plan,
            &request,
            &registry_request.repository_root,
            app.state::<Arc<ClaudeSessionRegistry>>().inner(),
            validate_authority,
        );
```

  `AGENT_TASK_STARTS_CLOSED_ERROR` is already mapped to the busy error after `start`. The session admission-closed error uses the same text, so the mapping covers both.

- [ ] **Step 5: Wire every reaping hook**
  - `stop_agent_tasks_for_root` gains the parameter `sessions: State<'_, Arc<ClaudeSessionRegistry>>`, and after `stop_for_workspace_root` calls:
    ```rust
        sessions.end_for_root(
            Some(request.workspace_id.as_str()),
            &root,
            ClaudeSessionEndReason::Released,
        );
    ```
  - `stop_agent_tasks_on_dispose`, after `agent_tasks.stop_for_root(root);`:
    ```rust
        if let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() {
            sessions.end_for_root(None, root, ClaudeSessionEndReason::Released);
        }
    ```
  - `git_worktree_commands.rs`, `AppWorktreeRemovalHooks::stop_agent_tasks`, becomes:
    ```rust
        fn stop_agent_tasks(&self, worktree_path: &Path) -> Result<(), String> {
            if let Some(registry) = self.app.try_state::<AgentTaskRegistry>() {
                if !registry.stop_for_root_and_reap(worktree_path) {
                    return Err(
                        "Agent processes in this worktree could not be stopped in time.".to_string(),
                    );
                }
            }
            let Some(sessions) = self.app.try_state::<Arc<ClaudeSessionRegistry>>() else {
                return Ok(());
            };
            if !sessions.end_for_root_and_reap(worktree_path, std::time::Duration::from_secs(5)) {
                return Err(
                    "Agent processes in this worktree could not be stopped in time.".to_string(),
                );
            }
            Ok(())
        }
    ```
  - `agent_thread_store_commands.rs`, `delete_agent_thread`, gains `sessions: State<'_, Arc<ClaudeSessionRegistry>>`. Before the closure: `let sessions = Arc::clone(&sessions);`. Inside it, after `ensure_agent_root_owner(...)?;`:
    ```rust
            sessions.end_for_thread(
                &request.owner_id,
                &request.thread_id,
                ClaudeSessionEndReason::ThreadEnded,
            );
    ```
  - `runtime_task_lifecycle.rs`: after the `agent_tasks.close_start_admission()` block, add
    ```rust
        if let Some(sessions) = app.try_state::<Arc<crate::agent_task_spawner::claude_session_registry::ClaudeSessionRegistry>>() {
            sessions.close_admission();
        }
    ```
    After the `agent_tasks.shutdown_all()` block, add
    ```rust
        if let Some(sessions) = app.try_state::<Arc<crate::agent_task_spawner::claude_session_registry::ClaudeSessionRegistry>>() {
            sessions.shutdown_all();
        }
    ```
  - `runtime.rs`:
    - Replace the `host_lifecycle` line (:196) with:
      ```rust
      let claude_sessions = Arc::new(agent_task_spawner::claude_session_registry::ClaudeSessionRegistry::new(
          agent_task_supervisor::system_process_group_signals(),
          Arc::new(agent_task_commands::claude_session_composition::AppHandleClaudeSessionEvents(app.handle().clone())),
      ));
      let host_lifecycle = Arc::new(agent_task_commands::claude_session_composition::AgentProviderHostLifecycles {
          codex: agent_task_commands::codex_task_composition::CodexProviderHostLifecycle(Arc::clone(&codex_hosts)),
          claude: Arc::clone(&claude_sessions),
      });
      let idle_sessions = Arc::downgrade(&claude_sessions);
      tauri::async_runtime::spawn(async move {
          loop {
              tokio::time::sleep(std::time::Duration::from_secs(60)).await;
              let Some(sessions) = idle_sessions.upgrade() else { break; };
              let _ = tauri::async_runtime::spawn_blocking(move || sessions.retire_idle(std::time::Instant::now())).await;
          }
      });
      app.manage(claude_sessions);
      ```
      Make `codex_task_composition` `pub(crate)` if it is not visible from `runtime.rs` (it is already reached through `agent_task_commands::codex_task_composition` at :196).
    - Register the three commands next to `agent_task_commands::stop_agent_tasks_for_root`:
      ```rust
                  agent_task_commands::claude_session_composition::interrupt_agent_task,
                  agent_task_commands::claude_session_composition::inspect_agent_thread_session,
                  agent_task_commands::claude_session_composition::end_agent_thread_session,
      ```

- [ ] **Step 6: Run the tests and confirm they pass, then run the Rust gates for the slice**

Run: `cd src-tauri && cargo test --lib claude_session_composition && cargo check --all-targets && cargo test --lib && cargo test --tests && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings; echo "exit=$?"`
Expected: `exit=0`. The existing `agent_task_commands_tests.rs` and steering tests must still pass. Where they build a `StartAgentTaskRequest` through serde, `sessionRestart` defaults.

- [ ] **Step 7: Review and commit.** Send a read-only Opus 5 review with this brief: "Every reaping hook reached: dispose, stopAgentTasksForRoot, worktree removal, delete, shutdown, provider update, idle loop. The async commands run blocking work off the UI runtime. The authority is re-checked before attaching to a reused session. The request types are closed." After approval and owner authorization:

```bash
git add src-tauri/src/lib_composition/claude_session_composition.rs src-tauri/src/lib_composition/agent_task_commands.rs src-tauri/src/lib_composition/git_worktree_commands.rs src-tauri/src/lib_composition/agent_thread_store_commands.rs src-tauri/src/lib_composition/runtime.rs src-tauri/src/runtime_task_lifecycle.rs src-tauri/src/agent_task_spawner.rs
git commit -m "feat(agent): wire persistent Claude sessions into the runtime and every reaping path"
```

### Task 3.9: Frontend session contracts and gateway

**Files:**
- Create: `src/domain/agentThreadSession.ts`, `src/domain/agentThreadSession.test.ts`
- Modify: `src/domain/agentTask.ts`:
  - export `agentTaskId`, `agentWorkspaceId`, `record`, `exactKeys`, `booleanFlag`, `invalid`
  - add `AgentSessionRestartPolicy` and optional `sessionRestart` to `StartAgentTaskRequest` and its validator
  - receive `failureMessageOf`, moved from the IPC contract
- Modify: `src/infrastructure/tauriAgentTaskIpcContract.ts` (import `failureMessageOf` instead of defining it)
- Create: `src/infrastructure/tauriAgentThreadSessionGateway.ts`, `src/infrastructure/tauriAgentThreadSessionGateway.test.ts`
- Modify: `src/application/workbenchDefaultGateways.ts`
- Modify: `src/application/useWorkbenchAgents.ts:88, :463`

**Interfaces:**
- Produces:
  - `AgentSessionRestartPolicy = "refuseIfBackground" | "stopBackground"`
  - `StartAgentTaskRequest.sessionRestart?`
  - `AgentSessionEndReason`, `AgentSessionEndedEvent`, `AgentTaskInterruptOutcome`, `AgentSessionInspection`
  - `InterruptAgentTaskRequest`, `AgentThreadSessionRequest`, `InspectAgentThreadSessionRequest`
  - `interface AgentThreadSessionGateway { interruptAgentTask, inspectAgentThreadSession, endAgentThreadSession, subscribeAgentSessionEnded }`
  - The parsers and validators below
  - `agentSessionEndedNotice(event): string | null`
  - `isAgentSessionRestartConfirmationError(error: unknown): boolean`
  - `TauriAgentThreadSessionGateway`
  - `defaultAgentThreadSessionGateway`
  - `UseWorkbenchAgentsOptions.agentThreadSessionGateway?`

- [ ] **Step 1: Write the failing contract tests** in `src/domain/agentThreadSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultAgentLaunchOptions } from "./agentLaunch";
import { validateStartAgentTaskRequest, type StartAgentTaskRequest } from "./agentTask";
import {
  agentSessionEndedNotice,
  isAgentSessionRestartConfirmationError,
  parseAgentSessionEndedEvent,
  parseAgentSessionInspection,
  parseAgentTaskInterruptOutcome,
  parseEndAgentThreadSessionResult,
  validateAgentThreadSessionRequest,
  validateInspectAgentThreadSessionRequest,
  validateInterruptAgentTaskRequest,
} from "./agentThreadSession";

const START: StartAgentTaskRequest = {
  taskId: "agt-1-0a1b",
  threadId: "agt-1-0a1c",
  workspaceId: "ws-1",
  projectRoot: "/repo",
  repositoryRoot: "/repo",
  cwd: "/repo",
  isolation: "in-place",
  prompt: "continue",
  agentCliKind: "claudeCode",
  resumeSessionId: "sess-fixture-0001",
  launch: defaultAgentLaunchOptions("claudeCode"),
  providerGeneration: 1,
  attachments: [],
};

describe("agent thread session contracts", () => {
  it("keeps the start request unchanged without a restart policy and accepts only known policies", () => {
    expect(validateStartAgentTaskRequest(START)).toEqual(START);
    expect(validateStartAgentTaskRequest({ ...START, sessionRestart: "stopBackground" })).toEqual({
      ...START,
      sessionRestart: "stopBackground",
    });
    expect(() => validateStartAgentTaskRequest({ ...START, sessionRestart: "always" })).toThrow(
      TypeError,
    );
  });

  it("parses the pinned interrupt, inspection and end shapes", () => {
    expect(parseAgentTaskInterruptOutcome({ kind: "interrupting" })).toEqual({ kind: "interrupting" });
    expect(() => parseAgentTaskInterruptOutcome({ kind: "maybe" })).toThrow(TypeError);
    expect(parseAgentSessionInspection({ kind: "restart", backgroundProcesses: true })).toEqual({
      kind: "restart",
      backgroundProcesses: true,
    });
    expect(parseAgentSessionInspection({ kind: "none" })).toEqual({ kind: "none" });
    expect(() => parseAgentSessionInspection({ kind: "none", backgroundProcesses: true })).toThrow(
      TypeError,
    );
    expect(parseEndAgentThreadSessionResult({ ended: true })).toBe(true);
    expect(() => parseEndAgentThreadSessionResult({ ended: "yes" })).toThrow(TypeError);
  });

  it("parses the ended event exactly as the backend serializes it", () => {
    const event = {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      reason: "idleTimeout",
      backgroundProcessesStopped: true,
    };
    expect(parseAgentSessionEndedEvent(event)).toEqual(event);
    expect(() => parseAgentSessionEndedEvent({ ...event, reason: "other" })).toThrow(TypeError);
    expect(() => parseAgentSessionEndedEvent({ ...event, extra: 1 })).toThrow(TypeError);
  });

  it("validates closed session requests", () => {
    expect(
      validateInterruptAgentTaskRequest({ taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).toEqual({ taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" });
    expect(() =>
      validateAgentThreadSessionRequest({ workspaceId: "ws-1", threadId: "../escape" }),
    ).toThrow(TypeError);
    expect(
      validateInspectAgentThreadSessionRequest({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      }).resumeSessionId,
    ).toBeNull();
  });

  it("recognises only the confirmation-prefixed restart rejection", () => {
    expect(
      isAgentSessionRestartConfirmationError(
        "sessionRestartRequiresConfirmation: Continuing restarts Claude for this thread and stops the background processes it started.",
      ),
    ).toBe(true);
    expect(isAgentSessionRestartConfirmationError(new Error("Agent task startup is closed."))).toBe(false);
  });

  it("tells the user only when something other than their own action stopped background processes", () => {
    const base = { workspaceId: "ws-1", threadId: "agt-1-0a1c", backgroundProcessesStopped: true } as const;
    expect(agentSessionEndedNotice({ ...base, reason: "idleTimeout" })).toBe(
      "The Claude session was idle too long, so the background processes it started in this thread were stopped.",
    );
    expect(agentSessionEndedNotice({ ...base, reason: "stopped" })).toBeNull();
    expect(agentSessionEndedNotice({ ...base, reason: "threadEnded" })).toBeNull();
    expect(
      agentSessionEndedNotice({ ...base, reason: "crashed", backgroundProcessesStopped: false }),
    ).toBeNull();
  });
});
```

Run: `npx vitest run src/domain/agentThreadSession.test.ts`
Expected: FAIL (the module is missing).

- [ ] **Step 2: Extend `agentTask.ts`**
  - Add `export` to `agentTaskId`, `agentWorkspaceId`, `record`, `exactKeys`, `booleanFlag` and `invalid`.
  - Add:

```ts
export type AgentSessionRestartPolicy = "refuseIfBackground" | "stopBackground";

export function agentSessionRestartPolicy(value: unknown, path: string): AgentSessionRestartPolicy {
  if (value === "refuseIfBackground" || value === "stopBackground") return value;
  invalid(path, "refuseIfBackground or stopBackground");
}
```

  - Add `readonly sessionRestart?: AgentSessionRestartPolicy;` to `StartAgentTaskRequest`.
  - In `validateStartAgentTaskRequest`, replace `exactKeys(request, [...13 fields...], "request")` with `boundedKeys(request, [...same 13 fields...], ["sessionRestart"], "request")`.
  - End the returned object with:

```ts
    ...(request.sessionRestart === undefined
      ? {}
      : { sessionRestart: agentSessionRestartPolicy(request.sessionRestart, "request.sessionRestart") }),
```

- [ ] **Step 3: Implement `src/domain/agentThreadSession.ts`**

```ts
import { parseAgentLaunchOptions, type AgentLaunchOptions } from "./agentLaunch";
import {
  agentTaskId,
  agentWorkspaceId,
  booleanFlag,
  exactKeys,
  invalid,
  isAgentSessionId,
  record,
  type AgentSessionRestartPolicy,
} from "./agentTask";

export type { AgentSessionRestartPolicy } from "./agentTask";

export const AGENT_SESSION_ENDED_EVENT = "agent-session://ended" as const;
export const AGENT_SESSION_RESTART_CONFIRMATION_PREFIX = "sessionRestartRequiresConfirmation:" as const;

export type AgentSessionEndReason =
  | "stopped"
  | "exited"
  | "crashed"
  | "protocolError"
  | "idleTimeout"
  | "evicted"
  | "restarted"
  | "released"
  | "threadEnded"
  | "providerUpdated"
  | "shutdown"
  | "unownedActivity"
  | "interruptTimedOut"
  | "inputFailed";

const END_REASONS: ReadonlyArray<AgentSessionEndReason> = [
  "stopped",
  "exited",
  "crashed",
  "protocolError",
  "idleTimeout",
  "evicted",
  "restarted",
  "released",
  "threadEnded",
  "providerUpdated",
  "shutdown",
  "unownedActivity",
  "interruptTimedOut",
  "inputFailed",
];

export interface AgentSessionEndedEvent {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly reason: AgentSessionEndReason;
  readonly backgroundProcessesStopped: boolean;
}

export type AgentTaskInterruptOutcome = {
  readonly kind: "interrupting" | "unsupported" | "unavailable" | "stopping";
};

export type AgentSessionInspection =
  | { readonly kind: "none" }
  | { readonly kind: "reuse" | "restart"; readonly backgroundProcesses: boolean };

export interface InterruptAgentTaskRequest {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface AgentThreadSessionRequest {
  readonly workspaceId: string;
  readonly threadId: string;
}

export interface InspectAgentThreadSessionRequest extends AgentThreadSessionRequest {
  readonly resumeSessionId: string | null;
  readonly launch: AgentLaunchOptions;
}

export interface AgentThreadSessionGateway {
  interruptAgentTask(request: InterruptAgentTaskRequest): Promise<AgentTaskInterruptOutcome>;
  inspectAgentThreadSession(request: InspectAgentThreadSessionRequest): Promise<AgentSessionInspection>;
  endAgentThreadSession(request: AgentThreadSessionRequest): Promise<boolean>;
  subscribeAgentSessionEnded(handler: (event: AgentSessionEndedEvent) => void): Promise<() => void>;
}

export function validateInterruptAgentTaskRequest(value: unknown): InterruptAgentTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["taskId", "workspaceId", "threadId"], "request");
  return {
    taskId: agentTaskId(request.taskId, "request.taskId"),
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
  };
}

export function validateAgentThreadSessionRequest(value: unknown): AgentThreadSessionRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "threadId"], "request");
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
  };
}

export function validateInspectAgentThreadSessionRequest(
  value: unknown,
): InspectAgentThreadSessionRequest {
  const request = record(value, "request");
  exactKeys(request, ["workspaceId", "threadId", "resumeSessionId", "launch"], "request");
  if (request.resumeSessionId !== null && !isAgentSessionId(request.resumeSessionId)) {
    invalid("request.resumeSessionId", "null or an agent session id");
  }
  return {
    workspaceId: agentWorkspaceId(request.workspaceId, "request.workspaceId"),
    threadId: agentTaskId(request.threadId, "request.threadId"),
    resumeSessionId: request.resumeSessionId,
    launch: parseAgentLaunchOptions(request.launch, "request.launch"),
  };
}

export function parseAgentTaskInterruptOutcome(value: unknown): AgentTaskInterruptOutcome {
  const outcome = record(value, "result");
  exactKeys(outcome, ["kind"], "result");
  switch (outcome.kind) {
    case "interrupting":
    case "unsupported":
    case "unavailable":
    case "stopping":
      return { kind: outcome.kind };
    default:
      return invalid("result.kind", "interrupting, unsupported, unavailable or stopping");
  }
}

export function parseAgentSessionInspection(value: unknown): AgentSessionInspection {
  const inspection = record(value, "result");
  if (inspection.kind === "none") {
    exactKeys(inspection, ["kind"], "result");
    return { kind: "none" };
  }
  exactKeys(inspection, ["kind", "backgroundProcesses"], "result");
  const backgroundProcesses = booleanFlag(inspection.backgroundProcesses, "result.backgroundProcesses");
  if (inspection.kind === "reuse") return { kind: "reuse", backgroundProcesses };
  if (inspection.kind === "restart") return { kind: "restart", backgroundProcesses };
  return invalid("result.kind", "none, reuse or restart");
}

export function parseEndAgentThreadSessionResult(value: unknown): boolean {
  const result = record(value, "result");
  exactKeys(result, ["ended"], "result");
  return booleanFlag(result.ended, "result.ended");
}

export function parseAgentSessionEndedEvent(value: unknown): AgentSessionEndedEvent {
  const event = record(value, "event");
  exactKeys(event, ["workspaceId", "threadId", "reason", "backgroundProcessesStopped"], "event");
  const reason = END_REASONS.find((known) => known === event.reason);
  if (reason === undefined) invalid("event.reason", "a known session end reason");
  return {
    workspaceId: agentWorkspaceId(event.workspaceId, "event.workspaceId"),
    threadId: agentTaskId(event.threadId, "event.threadId"),
    reason,
    backgroundProcessesStopped: booleanFlag(
      event.backgroundProcessesStopped,
      "event.backgroundProcessesStopped",
    ),
  };
}

export function isAgentSessionRestartConfirmationError(error: unknown): boolean {
  return failureMessageOf(error).startsWith(AGENT_SESSION_RESTART_CONFIRMATION_PREFIX);
}

export function agentSessionEndedNotice(event: AgentSessionEndedEvent): string | null {
  if (!event.backgroundProcessesStopped) return null;
  const cause = sessionEndCause(event.reason);
  if (cause === null) return null;
  return `${cause}, so the background processes it started in this thread were stopped.`;
}

function sessionEndCause(reason: AgentSessionEndReason): string | null {
  switch (reason) {
    case "stopped":
    case "threadEnded":
    case "restarted":
    case "released":
    case "shutdown":
      return null;
    case "exited":
      return "Claude exited";
    case "crashed":
      return "Claude stopped unexpectedly";
    case "protocolError":
      return "Claude sent a message Codevo could not accept";
    case "idleTimeout":
      return "The Claude session was idle too long";
    case "evicted":
      return "Too many Claude sessions were open";
    case "providerUpdated":
      return "Claude was updated";
    case "unownedActivity":
      return "Claude started work on its own";
    case "interruptTimedOut":
      return "Claude did not stop the current step in time";
    case "inputFailed":
      return "Codevo could not deliver your message to Claude";
    default:
      return unsupportedReason(reason);
  }
}

function unsupportedReason(reason: never): never {
  throw new TypeError(`Unsupported session end reason: ${String(reason)}.`);
}
```

`failureMessageOf` moves from `tauriAgentTaskIpcContract.ts` (bottom of the file) into `agentTask.ts` as an exported function with the identical body. The IPC contract then imports it from `../domain/agentTask`. Add `failureMessageOf` to this file's import list from `./agentTask`.

- [ ] **Step 4: Run the contract tests and confirm they pass**

Run: `npx vitest run src/domain/agentThreadSession.test.ts src/domain/agentTask.test.ts src/infrastructure/tauriAgentTaskGateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing gateway test** in `src/infrastructure/tauriAgentThreadSessionGateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  END_AGENT_THREAD_SESSION_IPC_COMMAND,
  INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND,
  INTERRUPT_AGENT_TASK_IPC_COMMAND,
  TauriAgentThreadSessionGateway,
} from "./tauriAgentThreadSessionGateway";

describe("TauriAgentThreadSessionGateway", () => {
  it("invokes closed commands and parses their results", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === INTERRUPT_AGENT_TASK_IPC_COMMAND) return { kind: "interrupting" };
      if (command === INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND) return { kind: "restart", backgroundProcesses: true };
      if (command === END_AGENT_THREAD_SESSION_IPC_COMMAND) return { ended: true };
      throw new Error(`unexpected ${command}`);
    });
    const gateway = new TauriAgentThreadSessionGateway(invoke, vi.fn(), () => true);
    await expect(
      gateway.interruptAgentTask({ taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toEqual({ kind: "interrupting" });
    await expect(
      gateway.inspectAgentThreadSession({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    ).resolves.toEqual({ kind: "restart", backgroundProcesses: true });
    await expect(
      gateway.endAgentThreadSession({ workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(INTERRUPT_AGENT_TASK_IPC_COMMAND, {
      request: { taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" },
    });
  });

  it("degrades truthfully without the native runtime", async () => {
    const invoke = vi.fn();
    const gateway = new TauriAgentThreadSessionGateway(invoke, vi.fn(), () => false);
    await expect(
      gateway.interruptAgentTask({ taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toEqual({ kind: "unsupported" });
    await expect(
      gateway.endAgentThreadSession({ workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("drops malformed ended events and forwards valid ones", async () => {
    let deliver: ((event: { payload: unknown }) => void) | null = null;
    const listen = vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      deliver = handler;
      return () => undefined;
    });
    const gateway = new TauriAgentThreadSessionGateway(vi.fn(), listen, () => true);
    const handler = vi.fn();
    await gateway.subscribeAgentSessionEnded(handler);
    deliver?.({ payload: { nope: true } });
    deliver?.({
      payload: { workspaceId: "ws-1", threadId: "agt-1-0a1c", reason: "crashed", backgroundProcessesStopped: false },
    });
    expect(listen).toHaveBeenCalledWith("agent-session://ended", expect.any(Function));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Implement the gateway** in `src/infrastructure/tauriAgentThreadSessionGateway.ts`:

```ts
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AGENT_SESSION_ENDED_EVENT,
  parseAgentSessionEndedEvent,
  parseAgentSessionInspection,
  parseAgentTaskInterruptOutcome,
  parseEndAgentThreadSessionResult,
  validateAgentThreadSessionRequest,
  validateInspectAgentThreadSessionRequest,
  validateInterruptAgentTaskRequest,
  type AgentSessionEndedEvent,
  type AgentSessionInspection,
  type AgentTaskInterruptOutcome,
  type AgentThreadSessionGateway,
  type AgentThreadSessionRequest,
  type InspectAgentThreadSessionRequest,
  type InterruptAgentTaskRequest,
} from "../domain/agentThreadSession";
import type { AgentTaskRuntimeDetector, ListenToAgentTaskEvent } from "./tauriAgentTaskGateway";
import type { InvokeAgentTaskCommand } from "./tauriAgentTaskIpcContract";

export const INTERRUPT_AGENT_TASK_IPC_COMMAND = "interrupt_agent_task" as const;
export const INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND = "inspect_agent_thread_session" as const;
export const END_AGENT_THREAD_SESSION_IPC_COMMAND = "end_agent_thread_session" as const;

const invokeSessionCommand: InvokeAgentTaskCommand = (command, args) => invoke(command, args);
const listenToSessionEvents: ListenToAgentTaskEvent = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriAgentThreadSessionGateway implements AgentThreadSessionGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentTaskCommand = invokeSessionCommand,
    private readonly listenToEvent: ListenToAgentTaskEvent = listenToSessionEvents,
    private readonly isRuntimeAvailable: AgentTaskRuntimeDetector = isTauri,
  ) {}

  async interruptAgentTask(request: InterruptAgentTaskRequest): Promise<AgentTaskInterruptOutcome> {
    if (!this.isRuntimeAvailable()) return { kind: "unsupported" };
    return parseAgentTaskInterruptOutcome(
      await this.invokeCommand(INTERRUPT_AGENT_TASK_IPC_COMMAND, {
        request: validateInterruptAgentTaskRequest(request),
      }),
    );
  }

  async inspectAgentThreadSession(
    request: InspectAgentThreadSessionRequest,
  ): Promise<AgentSessionInspection> {
    if (!this.isRuntimeAvailable()) return { kind: "none" };
    return parseAgentSessionInspection(
      await this.invokeCommand(INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND, {
        request: validateInspectAgentThreadSessionRequest(request),
      }),
    );
  }

  async endAgentThreadSession(request: AgentThreadSessionRequest): Promise<boolean> {
    if (!this.isRuntimeAvailable()) return false;
    return parseEndAgentThreadSessionResult(
      await this.invokeCommand(END_AGENT_THREAD_SESSION_IPC_COMMAND, {
        request: validateAgentThreadSessionRequest(request),
      }),
    );
  }

  subscribeAgentSessionEnded(
    handler: (event: AgentSessionEndedEvent) => void,
  ): Promise<() => void> {
    if (!this.isRuntimeAvailable()) return Promise.resolve(() => undefined);
    return this.listenToEvent(AGENT_SESSION_ENDED_EVENT, (event) => {
      const decoded = decodeEndedEvent(event.payload);
      if (decoded === null) return;
      handler(decoded);
    });
  }
}

function decodeEndedEvent(payload: unknown): AgentSessionEndedEvent | null {
  try {
    return parseAgentSessionEndedEvent(payload);
  } catch {
    return null;
  }
}
```

In `src/application/workbenchDefaultGateways.ts`, add `export const defaultAgentThreadSessionGateway = new TauriAgentThreadSessionGateway();` following the existing `defaultAgentTaskGateway` pattern. In `useWorkbenchAgents.ts`:
- add `readonly agentThreadSessionGateway?: AgentThreadSessionGateway;` to the options (:88);
- pass `agentThreadSessionGateway: options.agentThreadSessionGateway ?? defaultAgentThreadSessionGateway,` in the `useAgentThreads({...})` call (:463).

- [ ] **Step 7: Run the tests and confirm they pass, then run the fast gates**

Run: `npx vitest run src/domain/agentThreadSession.test.ts src/infrastructure/tauriAgentThreadSessionGateway.test.ts src/infrastructure/tauriAgentTaskGateway.test.ts src/domain/agentTask.test.ts && npm run check; echo "exit=$?"`
Expected: `exit=0`. `useAgentThreads` does not yet accept the new dependency; Task 3.10 adds it. If `npm run check` fails only on that property, do Task 3.10 Step 3's `AgentThreadsDependencies` hunk here.

### Task 3.10: Application session lifecycle - end on archive/delete, ended notices, restart pass-through

**Files:**
- Create: `src/application/useAgentThreadSessionLifecycle.ts`, `src/application/useAgentThreadSessionLifecycle.test.tsx`
- Modify: `src/application/useAgentThreads.ts` (dependencies :107-125, `remove` :433-454, `archive` :466-474, returned surface)
- Modify: `src/application/agentThreadPorts.ts` (`AgentFollowUpRequest` :327-332, `AgentThreadsSurface` :405)
- Modify: `src/application/useRemoteAgentStableSurface.ts` (three stable wrappers)
- Modify: `src/application/useAgentTurnDispatch.ts` (`runTurnStart` call in `sendFollowUp`, :786-815)
- Modify: `src/application/agentTurnStartRunner.ts` (`AgentTurnStart` :42-66, `startAgentTask` payload :186-202)

**Interfaces:**
- Consumes: the Task 3.9 gateway and types.
- Produces:
  - `useAgentThreadSessionLifecycle(options): { interrupt(threadId): Promise<boolean>; endSession(thread: AgentThread): Promise<void>; inspectRestart(threadId, launch): Promise<"proceed" | "confirm"> }`
  - `AgentThreadsSurface.interrupt?`, `.endSession?(threadId)`, `.inspectSessionRestart?`
  - `AgentFollowUpRequest.sessionRestart?`
  - `AgentTurnStart.sessionRestart?`

- [ ] **Step 1: Write the failing hook test**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import type {
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { useAgentThreadSessionLifecycle } from "./useAgentThreadSessionLifecycle";

const running: AgentTurn = {
  turnId: "agt-1-t2",
  prompt: "continue",
  status: { kind: "running" },
  startedAtEpochMs: 1,
  endedAtEpochMs: null,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 0,
  launch: defaultAgentLaunchOptions("claudeCode"),
  cliVersion: null,
};

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId: "agt-1-0a1c",
    owner: { ...base.owner, ownerId: "ws-1" },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    ...overrides,
  };
}

function gateway(overrides: Partial<AgentThreadSessionGateway> = {}) {
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  const fake: AgentThreadSessionGateway = {
    interruptAgentTask: vi.fn(async () => ({ kind: "interrupting" as const })),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" as const })),
    endAgentThreadSession: vi.fn(async () => true),
    subscribeAgentSessionEnded: vi.fn(async (handler) => {
      ended = handler;
      return unsubscribe;
    }),
    ...overrides,
  };
  return { fake, unsubscribe, emit: (event: AgentSessionEndedEvent) => ended?.(event) };
}

function render(current: AgentThread | undefined, fake: AgentThreadSessionGateway) {
  const setNotice = vi.fn();
  const reportError = vi.fn();
  const hook = renderHook(() =>
    useAgentThreadSessionLifecycle({
      gateway: fake,
      readThread: () => current,
      setNotice,
      reportError,
    }),
  );
  return { hook, setNotice, reportError };
}

describe("useAgentThreadSessionLifecycle", () => {
  it("interrupts only the running local Claude turn with its exact owner", async () => {
    const { fake } = gateway();
    const { hook } = render(thread({ turns: [running] }), fake);
    await expect(hook.result.current.interrupt("agt-1-0a1c")).resolves.toBe(true);
    expect(fake.interruptAgentTask).toHaveBeenCalledWith({
      taskId: "agt-1-t2",
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
    });
  });

  it("falls back when the runtime cannot interrupt or the thread is not Claude", async () => {
    const { fake } = gateway({ interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" as const })) });
    const { hook } = render(thread({ turns: [running] }), fake);
    await expect(hook.result.current.interrupt("agt-1-0a1c")).resolves.toBe(false);
    const codex = render(
      thread({ turns: [running], provider: { kind: "codex", sessionId: null } }),
      gateway().fake,
    );
    await expect(codex.hook.result.current.interrupt("agt-1-0a1c")).resolves.toBe(false);
  });

  it("asks before a restart only when background processes would stop", async () => {
    const restart = gateway({
      inspectAgentThreadSession: vi.fn(async () => ({ kind: "restart" as const, backgroundProcesses: true })),
    });
    const launch = defaultAgentLaunchOptions("claudeCode");
    const { hook } = render(thread(), restart.fake);
    await expect(hook.result.current.inspectRestart("agt-1-0a1c", launch)).resolves.toBe("confirm");
    expect(restart.fake.inspectAgentThreadSession).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      resumeSessionId: "sess-fixture-0001",
      launch,
    });
    const quiet = render(
      thread(),
      gateway({ inspectAgentThreadSession: vi.fn(async () => ({ kind: "restart" as const, backgroundProcesses: false })) }).fake,
    );
    await expect(quiet.hook.result.current.inspectRestart("agt-1-0a1c", launch)).resolves.toBe("proceed");
  });

  it("proceeds when inspection fails instead of blocking the message", async () => {
    const broken = gateway({ inspectAgentThreadSession: vi.fn(async () => Promise.reject(new Error("ipc"))) });
    const { hook, reportError } = render(thread(), broken.fake);
    await expect(
      hook.result.current.inspectRestart("agt-1-0a1c", defaultAgentLaunchOptions("claudeCode")),
    ).resolves.toBe("proceed");
    expect(reportError).toHaveBeenCalled();
  });

  it("ends the exact owner's session", async () => {
    const { fake } = gateway();
    const { hook } = render(undefined, fake);
    await act(async () => hook.result.current.endSession(thread()));
    expect(fake.endAgentThreadSession).toHaveBeenCalledWith({ workspaceId: "ws-1", threadId: "agt-1-0a1c" });
  });

  it("notifies only for this owner's unrequested background loss and unsubscribes on unmount", async () => {
    const { fake, emit, unsubscribe } = gateway();
    const { hook, setNotice } = render(thread(), fake);
    await waitFor(() => expect(fake.subscribeAgentSessionEnded).toHaveBeenCalled());
    act(() => emit({ workspaceId: "ws-other", threadId: "agt-1-0a1c", reason: "idleTimeout", backgroundProcessesStopped: true }));
    act(() => emit({ workspaceId: "ws-1", threadId: "agt-1-0a1c", reason: "threadEnded", backgroundProcessesStopped: true }));
    expect(setNotice).not.toHaveBeenCalled();
    act(() => emit({ workspaceId: "ws-1", threadId: "agt-1-0a1c", reason: "idleTimeout", backgroundProcessesStopped: true }));
    expect(setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: "The Claude session was idle too long, so the background processes it started in this thread were stopped.",
      action: null,
    });
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/application/useAgentThreadSessionLifecycle.test.tsx`
Expected: FAIL (the module is missing).

- [ ] **Step 2: Implement `src/application/useAgentThreadSessionLifecycle.ts`**

```ts
import { useCallback, useEffect, useRef } from "react";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { runningTurn, type AgentThread } from "../domain/agentThread";
import {
  agentSessionEndedNotice,
  type AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { AGENT_TASKS_SOURCE, attempt, warning, type AgentTasksNotice } from "./agentProjectAuthority";

export type AgentSessionRestartVerdict = "proceed" | "confirm";

export interface AgentThreadSessionLifecycleOptions {
  readonly gateway: AgentThreadSessionGateway | undefined;
  readonly readThread: (threadId: string) => AgentThread | undefined;
  readonly setNotice: (notice: AgentTasksNotice) => void;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentThreadSessionLifecycle {
  interrupt(threadId: string): Promise<boolean>;
  endSession(thread: AgentThread): Promise<void>;
  inspectRestart(threadId: string, launch: AgentLaunchOptions): Promise<AgentSessionRestartVerdict>;
}

export function useAgentThreadSessionLifecycle(
  options: AgentThreadSessionLifecycleOptions,
): AgentThreadSessionLifecycle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const gateway = options.gateway;

  useEffect(() => {
    if (gateway === undefined) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void gateway
      .subscribeAgentSessionEnded((event) => {
        const { readThread, setNotice } = optionsRef.current;
        const thread = readThread(event.threadId);
        if (thread === undefined || thread.owner.ownerId !== event.workspaceId) return;
        const message = agentSessionEndedNotice(event);
        if (message !== null) setNotice(warning(message));
      })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unsubscribe = stop;
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [gateway]);

  const interrupt = useCallback(async (threadId: string): Promise<boolean> => {
    const { gateway: current, readThread, reportError } = optionsRef.current;
    const thread = readThread(threadId);
    if (current === undefined || thread === undefined) return false;
    if (thread.provider.kind !== "claudeCode") return false;
    const turn = runningTurn(thread);
    if (turn === null) return false;
    const outcome = await attempt(() =>
      current.interruptAgentTask({
        taskId: turn.turnId,
        workspaceId: thread.owner.ownerId,
        threadId,
      }),
    );
    if (!outcome.ok) {
      reportError(AGENT_TASKS_SOURCE, outcome.error);
      return false;
    }
    return outcome.value.kind === "interrupting" || outcome.value.kind === "stopping";
  }, []);

  const endSession = useCallback(async (thread: AgentThread): Promise<void> => {
    const { gateway: current, reportError } = optionsRef.current;
    if (current === undefined || thread.provider.kind !== "claudeCode") return;
    const ended = await attempt(() =>
      current.endAgentThreadSession({ workspaceId: thread.owner.ownerId, threadId: thread.threadId }),
    );
    if (!ended.ok) reportError(AGENT_TASKS_SOURCE, ended.error);
  }, []);

  const inspectRestart = useCallback(
    async (threadId: string, launch: AgentLaunchOptions): Promise<AgentSessionRestartVerdict> => {
      const { gateway: current, readThread, reportError } = optionsRef.current;
      const thread = readThread(threadId);
      if (current === undefined || thread === undefined) return "proceed";
      if (thread.provider.kind !== "claudeCode") return "proceed";
      const inspection = await attempt(() =>
        current.inspectAgentThreadSession({
          workspaceId: thread.owner.ownerId,
          threadId,
          resumeSessionId: thread.provider.sessionId,
          launch,
        }),
      );
      if (!inspection.ok) {
        reportError(AGENT_TASKS_SOURCE, inspection.error);
        return "proceed";
      }
      const value = inspection.value;
      return value.kind === "restart" && value.backgroundProcesses ? "confirm" : "proceed";
    },
    [],
  );

  return { interrupt, endSession, inspectRestart };
}
```

A failed inspection proceeds because the backend still enforces the confirmation. The worst case is the typed rejection, never a silent kill.

- [ ] **Step 3: Wire it into `useAgentThreads.ts` and the ports.**
  - In `AgentThreadsDependencies` add `readonly agentThreadSessionGateway?: AgentThreadSessionGateway;`.
  - After the `dispatch` hook, add:

```ts
  const sessionLifecycle = useAgentThreadSessionLifecycle({
    gateway: dependencies.agentThreadSessionGateway,
    readThread: (threadId) => store.currentState().threads.get(threadId),
    setNotice,
    reportError,
  });
  const endThreadSession = useCallback(
    async (threadId: string): Promise<void> => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined || !ownsThread(projects, thread)) return;
      await sessionLifecycle.endSession(thread);
    },
    [projects, sessionLifecycle, store],
  );
```

  `sessionLifecycle` is a new object on every render. Destructure `const { endSession, interrupt: interruptSession, inspectRestart } = sessionLifecycle;` and depend on those stable callbacks instead.

  - In `remove`, capture the thread before removal and end its session after a successful removal. Insert after `if (store.currentState().threads.has(threadId)) return false;`:

```ts
      void endSession(thread);
```

  - In `archive`, replace the body's last line with:

```ts
      const archived = store.currentState().threads.get(threadId)?.archived === true;
      if (archived) void endSession(thread);
      return archived;
```

  - Add to the returned surface object: `interrupt: interruptSession, endSession: endThreadSession, inspectSessionRestart: inspectRestart,`.
  - In `agentThreadPorts.ts`:
    - `AgentFollowUpRequest` gains `readonly sessionRestart?: AgentSessionRestartPolicy;`.
    - `AgentThreadsSurface` gains, after `stop(threadId: string): Promise<void>;`:

```ts
  interrupt?(threadId: string): Promise<boolean>;
  endSession?(threadId: string): Promise<void>;
  inspectSessionRestart?(threadId: string, launch: AgentLaunchOptions): Promise<"proceed" | "confirm">;
```

  - In `useRemoteAgentStableSurface.ts`'s `methods`, next to `unarchive`, add:

```ts
      interrupt: (threadId: string) => current.current.interrupt?.(threadId) ?? Promise.resolve(false),
      endSession: (threadId: string) => current.current.endSession?.(threadId) ?? Promise.resolve(),
      inspectSessionRestart: (threadId: string, launch: AgentLaunchOptions) =>
        current.current.inspectSessionRestart?.(threadId, launch) ?? Promise.resolve("proceed" as const),
```

- [ ] **Step 4: Pass the restart policy through to the start request.**
  - `agentTurnStartRunner.ts`: add `readonly sessionRestart?: AgentSessionRestartPolicy;` to `AgentTurnStart`, and in the `startAgentTask({...})` payload after `attachments: start.attachmentReferences,` add:

```ts
      ...(start.sessionRestart === undefined ? {} : { sessionRestart: start.sessionRestart }),
```

  - `useAgentTurnDispatch.ts` `sendFollowUp`: in the `runTurnStart({...})` argument, after `launch,`, add:

```ts
          ...(request.sessionRestart === undefined ? {} : { sessionRestart: request.sessionRestart }),
```

  Add one test to the `sendFollowUp` block of `src/application/useAgentTurnDispatch.test.tsx`, using the existing harness names:

```tsx
  it("forwards a confirmed session restart to the start request", async () => {
    const harness = await renderDispatch();
    const threadId = await harness.startSettledThread();
    await act(async () => {
      await harness.hook().sendFollowUp({
        threadId,
        prompt: "switch model",
        launch: defaultAgentLaunchOptions("claudeCode"),
        sessionRestart: "stopBackground",
      });
    });
    expect(harness.startedRequests.at(-1)?.sessionRestart).toBe("stopBackground");
  });
```

  If the harness names a settled-thread helper differently (search `describe("sendFollowUp"` at :1336 for the helper used by its first test), use that helper. The assertion stays identical.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/application/useAgentThreadSessionLifecycle.test.tsx src/application/useAgentTurnDispatch.test.tsx src/application/useAgentThreads.test.tsx src/application/useUnifiedAgentThreads.test.tsx src/application/useWorkbenchAgents.test.ts && npm run check; echo "exit=$?"`
Expected: `exit=0`.

### Task 3.11: First Stop interrupts the foreground, second Stop ends everything

**Files:**
- Modify: `src/domain/agentStopPolicy.ts` (+ test)
- Modify: `src/application/useAgentStopController.ts` (+ test)
- Modify: `src/components/agentMode/AgentStopConfirmationBanner.tsx` (+ test)
- Modify: `src/components/agentMode/useAgentComposerState.ts` (+ test)

**Interfaces:**
- Consumes: `AgentThreadsSurface.interrupt?` from Task 3.10.
- Produces:
  - `AgentStopRequest.interruptAvailable: boolean`
  - `AgentStopRequest.interruptedTurnId: string | null`
  - `AgentStopDecision` gains `{ kind: "interrupt"; turnId: string }`
  - `AgentStopControllerOptions.interrupt?(threadId): Promise<boolean>`
  - `AgentStopConfirmation` becomes `{ kind: "confirmBackground"; threadId; liveTaskCount } | { kind: "interrupting"; threadId }`
  - `AgentStopConfirmationView` becomes `{ kind: "confirmBackground"; liveTaskCount; onCancel } | { kind: "interrupting"; onCancel }`

- [ ] **Step 1: Write the failing policy tests.** Append to `agentStopPolicy.test.ts`, and add `interruptAvailable: false, interruptedTurnId: null` to every existing `decideAgentStop({...})` call:

```ts
describe("decideAgentStop with an interruptible session", () => {
  it("interrupts a running foreground first", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: null,
      }),
    ).toEqual({ kind: "interrupt", turnId: "agt-1-t1" });
  });

  it("hard-stops once this turn was already interrupted", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: "agt-1-t1",
      }),
    ).toEqual({ kind: "hardStop", turnId: "agt-1-t1" });
  });

  it("still asks before ending background-only work", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([shell("starting"), result]),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: null,
      }).kind,
    ).toBe("confirmBackground");
  });

  it("a previous turn's interrupt never hard-stops a new turn", () => {
    expect(
      decideAgentStop({
        threadId: "t",
        turn: turn([assistant], "agt-1-t2"),
        arm: null,
        nowEpochMs: 5,
        interruptAvailable: true,
        interruptedTurnId: "agt-1-t1",
      }),
    ).toEqual({ kind: "interrupt", turnId: "agt-1-t2" });
  });
});
```

- [ ] **Step 2: Extend the policy**

```ts
export type AgentStopDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "hardStop"; readonly turnId: string }
  | { readonly kind: "interrupt"; readonly turnId: string }
  | {
      readonly kind: "confirmBackground";
      readonly turnId: string;
      readonly liveTaskCount: number;
    };

export interface AgentStopRequest {
  readonly threadId: string;
  readonly turn: AgentTurn | null;
  readonly arm: AgentStopArm | null;
  readonly nowEpochMs: number;
  readonly interruptAvailable: boolean;
  readonly interruptedTurnId: string | null;
}

export function decideAgentStop(request: AgentStopRequest): AgentStopDecision {
  const { turn } = request;
  if (turn === null) return { kind: "ignore" };
  if (agentStopArmIsLive(request.arm, request.threadId, turn.turnId, request.nowEpochMs)) {
    return { kind: "hardStop", turnId: turn.turnId };
  }
  if (request.interruptedTurnId === turn.turnId) return { kind: "hardStop", turnId: turn.turnId };
  const activity = resolveAgentBackgroundActivity(
    projectAgentBackgroundState(turn.events, true, turn.eventsTruncated),
    "settled",
  );
  if (activity.foregroundSettled && activity.phase !== "inactive") {
    return {
      kind: "confirmBackground",
      turnId: turn.turnId,
      liveTaskCount: activity.tasks.length,
    };
  }
  if (request.interruptAvailable && !activity.foregroundSettled) {
    return { kind: "interrupt", turnId: turn.turnId };
  }
  return { kind: "hardStop", turnId: turn.turnId };
}
```

- [ ] **Step 3: Write the failing controller tests.** Append to `useAgentStopController.test.tsx`:

```tsx
describe("useAgentStopController with interrupt", () => {
  it("interrupts first, shows the interrupting state and hard-stops on the second press", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    const current = turn([{ kind: "assistantText", text: "Working" }]);
    const hook = renderHook(() =>
      useAgentStopController({ readRunningTurn: () => current, hardStop, interrupt, now: () => 1_000 }),
    );
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(interrupt).toHaveBeenCalledWith("thread-1");
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).toEqual({ kind: "interrupting", threadId: "thread-1" });
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
  });

  it("hard-stops at once when the runtime cannot interrupt", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => false);
    const current = turn([{ kind: "assistantText", text: "Working" }]);
    const hook = renderHook(() =>
      useAgentStopController({ readRunningTurn: () => current, hardStop, interrupt, now: () => 1_000 }),
    );
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });
});
```

Update the Fix 1 expectation `toEqual({ threadId: "thread-1", liveTaskCount: 1 })` to `toEqual({ kind: "confirmBackground", threadId: "thread-1", liveTaskCount: 1 })`.

- [ ] **Step 4: Extend the controller**
  - `AgentStopControllerOptions` gains `readonly interrupt?: (threadId: string) => Promise<boolean>;`.
  - `AgentStopConfirmation` becomes the union above.
  - Add `const interruptedRef = useRef<{ threadId: string; turnId: string } | null>(null);`. In `requestStop`, pass:

```ts
        interruptAvailable: optionsRef.current.interrupt !== undefined,
        interruptedTurnId:
          interruptedRef.current?.threadId === threadId ? interruptedRef.current.turnId : null,
```

  - Set `confirmation` in the `confirmBackground` case to `{ kind: "confirmBackground", threadId, liveTaskCount: decision.liveTaskCount }`.
  - Add the new case:

```ts
        case "interrupt": {
          const interrupt = optionsRef.current.interrupt;
          if (interrupt === undefined) {
            stopNow(threadId);
            return;
          }
          interruptedRef.current = { threadId, turnId: decision.turnId };
          setConfirmation({ kind: "interrupting", threadId });
          void interrupt(threadId).then((accepted) => {
            if (accepted) return;
            interruptedRef.current = null;
            stopNow(threadId);
          });
          return;
        }
```

  - `cancelStop` does not clear `interruptedRef`. A second press on the same turn must still hard-stop after the banner is dismissed. Any turn change makes the ref irrelevant through the `turnId` comparison.

- [ ] **Step 5: Banner variants.** In `AgentStopConfirmationBanner.tsx`:
  - `AgentStopConfirmationView` becomes `{ readonly kind: "confirmBackground"; readonly liveTaskCount: number; onCancel(): void } | { readonly kind: "interrupting"; onCancel(): void }`.
  - Render the text as `confirmation.kind === "interrupting" ? AGENT_STOP_INTERRUPTING_TEXT : agentStopConfirmationText(confirmation.liveTaskCount)`, with:

```ts
export const AGENT_STOP_INTERRUPTING_TEXT =
  "Stopping the current step. Background processes keep running. Press Esc again to stop everything.";
```

  - For `interrupting`, render only "Stop everything" (`onConfirm`) and "Dismiss" (`onCancel`).
  - Add a banner test asserting the interrupting text and both buttons. Update the existing test fixtures to include `kind: "confirmBackground"`.

- [ ] **Step 6: Composer wiring.** In `useAgentComposerState.ts`:
  - Pass `interrupt: agents.interrupt` to `useAgentStopController`, and add `"interrupt"` to the `AgentComposerSurface` Pick.
  - Build `stopConfirmation` from the union:

```ts
  const stopConfirmation = useMemo(() => {
    if (pendingStop === null || pendingStop.threadId !== runningThreadId) return null;
    if (pendingStop.kind === "interrupting") return { kind: "interrupting" as const, onCancel: cancelStop };
    return { kind: "confirmBackground" as const, liveTaskCount: pendingStop.liveTaskCount, onCancel: cancelStop };
  }, [cancelStop, pendingStop, runningThreadId]);
```

  Add a composer-state test next to Fix 1's:

```tsx
  it("interrupts a running Claude foreground first and stops everything on the second press", async () => {
    const stop = vi.fn(async () => undefined);
    const interrupt = vi.fn(async () => true);
    render(threadsSurfaceFixture({ threads: [steerableThreadView()], stop, interrupt }));
    act(() => current().navigation.selectThread("agt-1"));
    await act(async () => current().composer.composerProps.onStop?.());
    expect(interrupt).toHaveBeenCalledWith("agt-1");
    expect(stop).not.toHaveBeenCalled();
    expect(current().composer.composerProps.stopConfirmation?.kind).toBe("interrupting");
    await act(async () => current().composer.composerProps.onStop?.());
    expect(stop).toHaveBeenCalledWith("agt-1");
  });
```

  The existing "steers the running Claude turn..." test does not provide `interrupt`, so it keeps the immediate hard stop.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run src/domain/agentStopPolicy.test.ts src/application/useAgentStopController.test.tsx src/components/agentMode/AgentStopConfirmationBanner.test.tsx src/components/agentMode/useAgentComposerState.test.tsx; echo "exit=$?"`
Expected: `exit=0`.

### Task 3.12: Ask before a restart that would stop background processes

**Files:**
- Modify: `src/components/agentMode/useAgentComposerState.ts` (`submit` :446-535, `composerProps`, the Pick)
- Modify: `src/components/agentMode/AgentComposer.tsx` (`AgentComposerSubmission` :94-98, props, banner)
- Modify: `src/components/agentMode/AgentComposerController.tsx` (memo equality)
- Test: `src/components/agentMode/useAgentComposerState.test.tsx`

**Interfaces:**
- Consumes: `AgentThreadsSurface.inspectSessionRestart?` and `AgentFollowUpRequest.sessionRestart?` (Task 3.10).
- Produces:
  - `AgentComposerSubmission.sessionRestartConfirmed?: boolean`
  - `AgentComposerProps.sessionRestartConfirmation?: { onCancel(): void } | null`

- [ ] **Step 1: Write the failing test**

```tsx
  it("asks before a restart that would stop background processes, then sends with consent", async () => {
    const sendFollowUp = vi.fn(async () => true);
    const inspectSessionRestart = vi.fn(async () => "confirm" as const);
    render(threadsSurfaceFixture({ threads: [surfaceThreadView()], sendFollowUp, inspectSessionRestart }));
    act(() => current().navigation.selectThread("agt-1"));
    act(() => current().composer.composerProps.onPromptChange("Use the faster model"));
    const launch = defaultAgentLaunchOptions("claudeCode");

    await act(async () => {
      current().composer.composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false });
    });
    expect(inspectSessionRestart).toHaveBeenCalledWith("agt-1", launch);
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(current().composer.composerProps.prompt).toBe("Use the faster model");
    expect(current().composer.composerProps.sessionRestartConfirmation).not.toBeNull();

    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch,
        dangerousLaunchConfirmed: false,
        sessionRestartConfirmed: true,
      });
    });
    expect(sendFollowUp).toHaveBeenCalledWith({
      threadId: "agt-1",
      prompt: "Use the faster model",
      launch,
      dangerousLaunchConfirmed: false,
      sessionRestart: "stopBackground",
    });
    expect(current().composer.composerProps.sessionRestartConfirmation).toBeNull();
  });
```

Run: `npx vitest run src/components/agentMode/useAgentComposerState.test.tsx -t "restart that would stop"`
Expected: FAIL.

- [ ] **Step 2: Implement the guard.** In `useAgentComposerState.ts`:
  - Add `"inspectSessionRestart"` to the `AgentComposerSurface` Pick.
  - Add `const [sessionRestartPending, setSessionRestartPending] = useState<string | null>(null);` and `const inspectSessionRestart = agents.inspectSessionRestart;`.
  - In `submit`, directly after `if (authority === null) return false;`:

```ts
      if (
        authority.kind === "followUp" &&
        !authority.steer &&
        submission.sessionRestartConfirmed !== true &&
        threadQueuedEdit?.threadId !== authority.threadId &&
        inspectSessionRestart !== undefined
      ) {
        const verdict = await inspectSessionRestart(authority.threadId, submission.launch);
        if (!composerSubmissionAuthorityEqual(submissionAuthorityRef.current, authority)) return false;
        if (verdict === "confirm") {
          setSessionRestartPending(authority.threadId);
          return false;
        }
      }
```

  - In the non-steer `sendFollowUp({...})` call, add after `dangerousLaunchConfirmed`:

```ts
            ...(submission.sessionRestartConfirmed === true
              ? { sessionRestart: "stopBackground" as const }
              : {}),
```

  - Directly before that call, add `setSessionRestartPending(null);`.
  - Add `inspectSessionRestart` to `submit`'s dependency array.
  - Expose it:

```ts
  const sessionRestartConfirmation = useMemo(
    () =>
      sessionRestartPending === null || sessionRestartPending !== selectedThread?.thread.threadId
        ? null
        : { onCancel: () => setSessionRestartPending(null) },
    [selectedThread?.thread.threadId, sessionRestartPending],
  );
```

  - Add `sessionRestartConfirmation,` to `composerProps`.

- [ ] **Step 3: Render the consent banner.** In `AgentComposer.tsx`:
  - Add `readonly sessionRestartConfirmed?: boolean;` to `AgentComposerSubmission`.
  - Add `readonly sessionRestartConfirmation?: { onCancel(): void } | null;` to the props, destructured with default `null`.
  - In the banners fragment, add:

```tsx
          {sessionRestartConfirmation !== null && (
            <ComposerBanner
              actions={
                <>
                  <button
                    className="cv-banner-action"
                    onClick={() =>
                      onSubmit({
                        launch: effectiveLaunch,
                        dangerousLaunchConfirmed: dangerousLaunch,
                        sessionRestartConfirmed: true,
                      })
                    }
                    type="button"
                  >
                    Restart and send
                  </button>
                  <button
                    className="cv-banner-action"
                    onClick={sessionRestartConfirmation.onCancel}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              }
              icon={<AlertTriangle size={12} strokeWidth={1.5} />}
              tone="warn"
            >
              Sending this restarts Claude for this thread and stops the background processes it
              started.
            </ComposerBanner>
          )}
```

  - In `agentComposerControllerPropsEqual`, add `leftProps.sessionRestartConfirmation === rightProps.sessionRestartConfirmation &&`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/components/agentMode/useAgentComposerState.test.tsx src/components/agentMode/AgentComposer.test.tsx src/components/agentMode/AgentComposerController.test.tsx; echo "exit=$?"`
Expected: `exit=0`. The existing "sends a follow-up..." test is unchanged, because the fixture has no `inspectSessionRestart`.

### Task 3.13: "End Claude session" in the thread menu

**Files:**
- Modify: `src/components/agentMode/agentThreadContextMenuModel.ts` (context :67-78; items :110) + `agentThreadContextMenuModel.test.ts`
- Modify: `src/components/agentMode/agentSidebarPresentation.ts:91` (command union)
- Modify: `src/components/agentMode/useAgentThreadMenuCommands.ts:245`
- Modify: `src/components/agentMode/AgentThreadRow.tsx:100`, `src/components/agentMode/AgentThreadHeader.tsx:90`

**Interfaces:**
- Consumes: `AgentThreadsSurface.endSession?` (Task 3.10).
- Produces:
  - `AgentThreadContextMenuContext.claudeSession?: boolean`
  - command `{ kind: "endSession" }`

- [ ] **Step 1: Write the failing model test.** Append to `agentThreadContextMenuModel.test.ts`, reusing its `base` context:

```ts
  it("offers ending the Claude session only for an idle local Claude thread", () => {
    const labels = (context: typeof base) =>
      agentThreadContextMenu(context).flatMap((node) => ("label" in node ? [node.label] : []));
    expect(labels({ ...base, claudeSession: true })).toContain("End Claude session");
    expect(labels({ ...base, claudeSession: true, running: true })).not.toContain("End Claude session");
    expect(labels({ ...base, claudeSession: true, archived: true })).not.toContain("End Claude session");
    expect(labels(base)).not.toContain("End Claude session");
  });
```

Look up the node's label property in `AgentThreadMenuNode` and adjust the extractor to it if it is not called `label`. The assertions stay the same.

- [ ] **Step 2: Implement.**
  - Add `readonly claudeSession?: boolean;` to the context.
  - Add `| { readonly kind: "endSession" }` to the command union at `agentSidebarPresentation.ts:91`.
  - After the `stop` item, add:

```ts
  if (context.claudeSession === true && !context.running && !context.archived) {
    nodes.push(item("endSession", "End Claude session", "stop", command({ kind: "endSession" })));
  }
```

  - In `useAgentThreadMenuCommands.ts`, add:

```ts
        case "endSession":
          void agents.endSession?.(threadId);
          return;
```

  - In `AgentThreadRow.tsx:100` and `AgentThreadHeader.tsx:90`, add to the context object:

```ts
      claudeSession: view.thread.provider.kind === "claudeCode" && view.execution?.kind !== "remote",
```

  In the header the variable is `thread` (nullable), so there use `thread !== null && thread.thread.provider.kind === "claudeCode" && thread.execution?.kind !== "remote"`.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `npx vitest run src/components/agentMode/agentThreadContextMenuModel.test.ts src/components/agentMode/AgentThreadContextMenu.test.tsx src/components/agentMode/AgentThreadRow.test.tsx src/components/agentMode/AgentThreadHeader.test.tsx; echo "exit=$?"`
Expected: `exit=0`. Missing test files are ignored by vitest. Run the ones that exist.

- [ ] **Step 4: Frontend fast gates and review.** Run `npm run check && npm run lint -- --max-warnings 0 && npm run lint:exhaustive-deps && npm run size:hotspots && npm run format:check:changed; echo "exit=$?"`. Expected: `exit=0`.

  Send an independent read-only Opus 5 review with this brief: "Tasks 3.9-3.13: closed contracts equal to the Rust JSON, no await without an authority re-check, memo equality for new props, remote threads never reach local session commands, notices only for unrequested background loss, UI copy truthful."

  After approval and owner authorization:

```bash
git add src/domain/agentThreadSession.ts src/domain/agentThreadSession.test.ts src/domain/agentTask.ts src/infrastructure/tauriAgentThreadSessionGateway.ts src/infrastructure/tauriAgentThreadSessionGateway.test.ts src/infrastructure/tauriAgentTaskIpcContract.ts src/application/workbenchDefaultGateways.ts src/application/useWorkbenchAgents.ts src/application/useAgentThreadSessionLifecycle.ts src/application/useAgentThreadSessionLifecycle.test.tsx src/application/useAgentThreads.ts src/application/agentThreadPorts.ts src/application/useRemoteAgentStableSurface.ts src/application/useAgentTurnDispatch.ts src/application/useAgentTurnDispatch.test.tsx src/application/agentTurnStartRunner.ts src/domain/agentStopPolicy.ts src/domain/agentStopPolicy.test.ts src/application/useAgentStopController.ts src/application/useAgentStopController.test.tsx src/components/agentMode/AgentStopConfirmationBanner.tsx src/components/agentMode/AgentStopConfirmationBanner.test.tsx src/components/agentMode/useAgentComposerState.ts src/components/agentMode/useAgentComposerState.test.tsx src/components/agentMode/AgentComposer.tsx src/components/agentMode/AgentComposerController.tsx src/components/agentMode/agentThreadContextMenuModel.ts src/components/agentMode/agentThreadContextMenuModel.test.ts src/components/agentMode/agentSidebarPresentation.ts src/components/agentMode/useAgentThreadMenuCommands.ts src/components/agentMode/AgentThreadRow.tsx src/components/agentMode/AgentThreadHeader.tsx
git commit -m "feat(agent): interrupt-first Stop, restart consent and session end controls"
```

---
## Wrap-up

### Task W1: Full repository gates

Run every gate after each fix lands, not only once at the end. Each command's exit code is checked with `echo "exit=$?"`, because a pipe to `tail` would hide it.

- [ ] **Step 1: Frontend gates**

```bash
cd /Users/matusmockor/Developer/editor
npm run check; echo "check=$?"
npm run lint -- --max-warnings 0; echo "lint=$?"
npm run lint:exhaustive-deps; echo "deps=$?"
npm run build; echo "build=$?"
npm run size:hotspots; echo "hotspots=$?"
npm run format:check; echo "format=$?"
npm run format:check:changed; echo "format-changed=$?"
npm test -- --run; echo "test=$?"
npm run test:coverage; echo "coverage=$?"
git diff --check; echo "diff-check=$?"
```

Expected: every value is `0`. `npm run build` is listed in this repository's `CLAUDE.md` gates, which take precedence over the global "no build for verification" preference.

- [ ] **Step 2: Rust gates**

```bash
cd /Users/matusmockor/Developer/editor/src-tauri
cargo check --all-targets; echo "check=$?"
cargo test --lib; echo "lib=$?"
cargo test --tests; echo "tests=$?"
cargo fmt --all -- --check; echo "fmt=$?"
cargo clippy --all-targets -- -D warnings; echo "clippy=$?"
```

Expected: every value is `0`.
- Node-watch tests are known to be flaky under load. If one fails, free port 9229 by killing only the exact orphaned PID from `lsof -ti tcp:9229`, then rerun that test alone, then rerun the whole binary.
- The fake-CLI session tests spawn real processes. If they are flaky under parallel load, run `cargo test --test agent_task_supervisor_tests claude_ -- --test-threads=1` and then the full binary again. Never add retries or sleeps to make a test pass.
- If a test leaks processes, fix the leak. `FakeCli::drop` is the only allowed cleanup net.

- [ ] **Step 3: Leak check.** After the Rust suite, run `pgrep -fl "FAKE_CLAUDE\|sess-fixture\|sleep 300"; echo "exit=$?"`. Expected: `exit=1` (no survivors). If anything survives, it is a P1 lifecycle bug.

### Task W2: Independent reviews

- [ ] **Step 1: Whole-change review (read-only Opus 5 subagent).** The prompt must include:
  - this plan path,
  - `git diff <base>..HEAD`,
  - `CLAUDE.md`,
  - the instruction "Verify every finding in code before reporting; classify P0-P3; list what is proven vs. assumed; do not edit."

  Focus areas:
  - process-group anchor safety and reaping paths,
  - A→B→A,
  - authority re-check after every await (TS) and before every side effect (Rust),
  - bounded queues and timeouts,
  - truthful copy,
  - contract parity between Rust and TypeScript JSON.
- [ ] **Step 2: Second opinion on process lifecycle (read-only fable-5.1 subagent).** Scope: `claude_thread_session.rs`, `claude_session_registry.rs`, `agent_task_process_group.rs`, and the supervisor hunks. Same instructions.
- [ ] **Step 3: Fix the confirmed P0/P1 findings.**
  - Each fix comes with a regression test, then rerun W1.
  - Document rejected findings with a reason in the final report.
  - Do not call the work done while any P0/P1 finding is open.

### Task W3: QA build and Codex computer-use QA

- [ ] **Step 1: Build the QA app from the reviewed tip.** The lead runs this:

```bash
QA_SHA="$(git -C /Users/matusmockor/Developer/editor rev-parse HEAD)"
git -C "$HOME/tmp/codevo-qa/tree" checkout --detach "$QA_SHA"; echo "exit=$?"
cd "$HOME/tmp/codevo-qa/tree" && npm ci; echo "exit=$?"
npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'; echo "exit=$?"
osascript -e 'tell application "/Users/matusmockor/tmp/codevo-qa/app/Codevo QA.app" to quit'
rm -rf "$HOME/tmp/codevo-qa/app/Codevo QA.app"
ditto "$HOME/tmp/codevo-qa/tree/src-tauri/target/debug/bundle/macos/Codevo QA.app" "$HOME/tmp/codevo-qa/app/Codevo QA.app"
open "$HOME/tmp/codevo-qa/app/Codevo QA.app"
osascript -e 'tell application "Codevo QA" to activate'
```

Expected: the app launches. An exit code of 1 caused only by the missing updater signing key is acceptable; a compile error is not. Open the trusted git project `~/tmp/codevo-qa-p2` in the QA app. Never touch "Codevo Editor" (`dev.mockor.editor`).

- [ ] **Step 2: Write the QA prompt**

```bash
cat "$HOME/tmp/codevo-qa/qa_common_rules.txt" > "$HOME/tmp/codevo-qa/qa_prompt_session.txt"
cat >> "$HOME/tmp/codevo-qa/qa_prompt_session.txt" <<'QA'

Time budget about 45 minutes.
CONTEXT: Persistent Claude session QA. Project codevo-qa-p2 is trusted and open in "Codevo QA".
THIS RUN MUST USE A CLAUDE THREAD (the feature is Claude-only). In the model picker choose the cheapest Claude model offered that is not Haiku, with the lowest reasoning effort. Keep prompts short.
Before EVERY screenshot activate "Codevo QA" so its window is frontmost. ATTACH ONLY - never launch, open, restart or close any app. Never touch "Codevo Editor".
You cannot run shell commands yourself; every check below reads what the in-app agent's own Bash tool prints in the conversation.

STEPS
S1 Start a new Claude thread in codevo-qa-p2 with: Run exactly this with the Bash tool, then reply DONE: nohup sh -c 'while true; do date >> /tmp/codevo-qa-bg.log; sleep 1; done' >/dev/null 2>&1 & echo started
   Expected: the turn finishes with DONE and the composer is idle (no Stop button).
S2 Wait 15 seconds after S1 finished. Send: Run with the Bash tool: wc -l < /tmp/codevo-qa-bg.log; sleep 3; wc -l < /tmp/codevo-qa-bg.log  and reply with both numbers.
   Expected: the second number is larger than the first - the background shell survived the end of the turn. FAIL if the numbers are equal or the file is missing.
S3 Send: Run with the Bash tool: sleep 60   While it runs, press Esc ONCE.
   Expected: a banner "Stopping the current step. Background processes keep running. Press Esc again to stop everything." appears, and the turn ends as stopped within about 10 seconds.
   Then send the S2 command again. Expected: the second number is larger than the first (the interrupt did not kill background work).
S4 Send: Run with the Bash tool: sleep 60   While it runs, press Esc, then press Esc again within 3 seconds.
   Expected: the turn stops at once.
   Then send the S2 command again. Expected: both numbers are EQUAL - the second Stop ended everything, including the background shell. FAIL if the numbers still grow.
S5 Send: Use the Bash tool with run_in_background set to true to run: sleep 120   then reply WAITING.
   When the conversation shows background work still running and the composer still shows Stop, press Esc ONCE.
   Expected: a warning banner "1 background task is still running. Press Esc again or choose Stop everything to end it." with buttons "Stop everything" and "Keep running"; the turn keeps running. Click "Keep running": the banner disappears and the work continues. Press Esc twice: the turn stops.
S6 With the thread idle, open the thread's context menu in the sidebar.
   Expected: an item "End Claude session". Click it. No error appears.
S7 Repeat S1 to start the background writer again. After DONE, change the reasoning effort in the composer to a different value and send: hi
   Expected: a banner "Sending this restarts Claude for this thread and stops the background processes it started." with "Restart and send" and "Cancel". Click Cancel: the prompt "hi" stays in the composer. Click send again, then "Restart and send": the reply arrives.
   Then send the S2 command. Expected: EQUAL numbers (the confirmed restart stopped the writer).
S8 Cleanup: send: Run with the Bash tool: pkill -f codevo-qa-bg.log; rm -f /tmp/codevo-qa-bg.log; echo cleaned
QA
```

- [ ] **Step 3: Run the QA.** It runs in the background; poll the log.

```bash
QA_MINUTES=45 python3 "$HOME/tmp/codevo-qa/qa_orchestrator_v2.py" "$HOME/tmp/codevo-qa/qa_prompt_session.txt" "$HOME/tmp/codevo-qa-import" > "$HOME/tmp/codevo-qa/qa_session.log" 2>&1; echo "exit=$?"
```

- Poll `$HOME/tmp/codevo-qa/qa_session.log` for `===== QA REPORT =====` or `TIMEOUT`.
- If it shows `COMPUTER_USE_UNAVAILABLE`, stop. This failure is structural. Give the owner the prompt file to paste into their own interactive `codex` session, and do not retry headless.
- Never kill Codex broadly; kill only the orchestrator's exact PID.

- [ ] **Step 4: Lead-side verification after QA.** Run `pgrep -fl codevo-qa-bg.log; echo "exit=$?"`. Expected: `exit=1`. Any survivor after S4/S7/S8 is a P1 bug.

- [ ] **Step 5: Fix loop.**
  - Verify each FAIL in code before fixing it.
  - Fix it with a regression test.
  - Rerun W1, rebuild, and rerun only the failed steps.
  - Delete the scratch QA prompt afterwards (it lives outside the repo).

### Task W4: Final commit and report

- [ ] **Step 1: Pre-commit hygiene.** Run `git status --short` and confirm that only files in this plan's File Structure are staged. The pre-existing redesign changes stay untouched. Commits go to `main` with no AI attribution and no `Co-Authored-By`. Do not push or tag.
- [ ] **Step 2: Report to the owner.** Include:
  - the gates, each with its exit code,
  - the review verdicts (Opus 5 and fable-5.1) with fixed and rejected findings,
  - the QA table S1-S8,
  - what is proven versus unsupported (see Risks),
  - the fixes shipped.

---

## Self-review

**Spec coverage**

- Fix 1 (gentle Stop while background runs): Tasks 1.1-1.2. Confirmation was chosen over interrupt, for the reason in D1.
- Fix 2 (clean-exit grace, bounded, final SIGKILL kept): Tasks 2.1-2.3.
- Fix 3 (persistent session):
  - Stdin is not closed after the result, and follow-ups are frames into the same process: Tasks 3.3, 3.5 and 3.7 (`result_watch` skip; `attach_turn`).
  - The process group is owned by the thread session: Task 3.5 (`ClaudeThreadSession`) and Task 3.7 (`SharedSession` turn child).
  - Turn/task ids are separate from process identity: task id = turn id, session key = `(workspace_id, thread_id)` plus generation (Tasks 3.2, 3.5, 3.6).
  - Owner lease/generation and fail-closed A→B→A: the random per-registration workspace id plus the displacement rule, and the authority re-check before attach (Tasks 3.6 and 3.8). Test: `workspace_a_b_a_never_reuses_a_foreign_owner_session`.
  - Reaping paths, all in Tasks 3.5-3.8 with tests:

    | Path | Where |
    |---|---|
    | Explicit Stop | `second_stop_...` |
    | Thread archive/delete | Task 3.10 + delete command |
    | Workspace release (`stopAgentTasksForRoot`) | `releasing_a_root_...` |
    | Dispose | Task 3.8 |
    | Worktree removal | Task 3.8 |
    | Registry Drop (app exit) | `dropping_the_registry_...` + `shutdown_all` |
    | `UnpublishedAgentTask` Drop | `an_unpublished_start_failure_...` |
    | Panic | `run_waiter` `catch_unwind` → `kill_now`, supervisor panic → `force_kill` → `terminate` |
    | Idle TTL | `idle_ttl_and_provider_update_...` |
    | Provider update | same test |

  - Cap with deterministic eviction plus the ephemeral fallback: `concurrent_sessions_are_capped_...`, `when_every_session_is_busy_...`, `a_turn_without_a_free_slot_...`.
  - Model/effort/mode change → truthful restart with consent: Tasks 3.2, 3.6 and 3.12.
  - CLI crash mid-session and stale session id:
    - `a_crash_mid_turn_...` and `idle_crash_...`.
    - A stale `--resume` id makes the respawned CLI exit, so that turn fails through the existing `noteResumeFailure` → `providerSessionInvalidated` path (`useAgentTurnDispatch.ts:991-1014`), which is unchanged.
    - A conversation mismatch restarts: `a_fresh_conversation_request_restarts_the_session`.
  - Codex: scoped out with evidence in D11.
- Regression tests requested:
  - background survival: 3.5, 3.7
  - Stop first/second press: 1.2, 3.7, 3.11
  - reaping paths: 3.6, 3.7
  - A→B→A: 3.6
  - concurrent cap: 3.6, 3.7
  - crash/restart: 3.5, 3.6, 3.7
- Wrap-up (full gates, independent Opus review, Codex QA with background survival and second-Stop kill): W1-W3.

**Placeholder scan**
- No TBD or "similar to" remains. Two steps name a lookup instead of repeating code: the sendFollowUp harness helper name in Task 3.10 Step 4, and the menu node label property in Task 3.13 Step 1. Both give the exact assertion and where to find the one identifier.

**Type consistency.** These names are used identically across tasks:
- `ClaudeSessionEndReason`, `ClaudeSessionRestartPolicy`, `ClaudeSessionTurnPlan::new(registry, request, authority)`
- `AgentTaskInterruptOutcome` (`interrupting|unsupported|unavailable|stopping`)
- `AgentSessionInspection` (`none|reuse|restart` + `backgroundProcesses`)
- `AgentStopConfirmation` (union after 3.11)
- `sessionRestart` / `session_restart`
- `agent-session://ended`

**Review Focus**: each of the five items has a named test in its owning task.

## Risks and open questions

1. **CLI protocol assumptions.** Task 3.0 gates the whole of Fix 3. If the CLI emits `system/init` only once, or uses a different interrupted-result subtype, only the fake-CLI lines change. If stdin-idle output exists (keep-alives), `unowned_root_activity` already ignores unknown types. A CLI that self-initiates turns while idle (scheduled wake-ups) ends the session as `unownedActivity`. That is truthful, but it loses that work. Surfacing CLI-initiated turns (t3code "synthetic turns") is a follow-up.
2. **Non-macOS membership probe.** On other Unix systems the probe returns unknown. The clean-exit grace then always waits the full 2 s, idle TTL uses 30 min (not 12 h), and restart consent is never asked, because background membership cannot be proven. Codevo targets macOS; Linux keeps correct but less graceful behaviour.
3. **Escaped processes.** `setsid`/`disown` into a new session leaves the group. Such processes were never killed before and still are not. Only same-group members are owned.
4. **Idle resource cost.** Up to 8 idle Claude CLIs (~150-300 MB RSS each) can stay alive for up to 30 min, or 12 h with detached work. That is bounded by the cap and the TTL. The numbers are estimates; measure RSS during QA and lower the cap if needed.
5. **Change capture timing.** `before_completion` ("After" snapshot) now runs at settlement while background processes may still be writing. Their later writes land in the next turn's capture. This is truthful per turn, but it differs from before.
6. **Interrupt with queued steers.** Accepted-but-unprocessed steers are abandoned on interrupt (`abandon_all`). The frontend already shows them in the turn, which then ends `stopped`. Whether to re-queue them is a follow-up UX decision.
7. **Trust revocation.** Revoking workspace trust does not end idle sessions today, because no existing hook does that for tasks either. The next turn fails authority and ends the session (Task 3.6 `validate_authority`). An idle session with background work survives until TTL. A trust-revocation hook is a follow-up.
8. **Runner / remote threads.** Unchanged (D12).
9. **Codex idle host retirement** still kills a Codex host's group after 300 s idle (D11).

## Size estimate per fix

| Fix | Production | Tests | Notes |
|---|---|---|---|
| 1 Gentle Stop | ~180 lines TS | ~260 lines TS | Ships alone; frontend only |
| 2 Clean-exit grace | ~150 lines Rust (+~170 moved) | ~300 lines Rust | Ships alone; frees supervisor tokens for Fix 3 |
| 3 Persistent session | ~1,500 lines Rust + ~550 lines TS | ~1,100 lines Rust + ~600 lines TS | Behind the Task 3.0 probe; user-visible from Task 3.8 |

Execution recommendation: subagent-driven. Fix 3's Rust tasks depend tightly on each other's interfaces, and a lifecycle mistake kills user processes, so each task needs a fresh reviewer before the next one starts.
