# Option D: a Claude turn settles at its own result

Status: proposal, not implemented. Follow-up to the background-reply fix (option C), which records each unprompted reply immediately and, while a user turn is running, inserts it before that running turn.

## Problem

In persistent-session mode a Claude turn stays `running` after its own result until every native background task it started has drained (plan D4, detector policy `ResultSettlePolicy::AwaitBackgroundWork`). The CLI is idle during that wait, so when a background task finishes it starts an unprompted turn. Codevo records that reply while its own turn is still `running`, so option C has to place the reply before the turn that caused it. The transcript order is wrong, "Turn N" labels shift, and output capture needs a special mtime rule.

## Option D

A session-mode Claude turn settles when its own result has arrived and no armed foreground task is live. Native background-scope tasks (`task_started` without `is_backgrounded:false`: async agents, `run_in_background` shells, monitors) no longer hold the turn open. They exist only at session level, which already has:

- the router's live native-task count and the `agent-session://background-tasks` snapshot,
- the thread-row "N agents running" status and the session dock with per-task Stop,
- restart consent, eviction preference and the detached-work idle TTL keyed on `background_tasks() > 0`,
- inherited-task semantics (A14), so a later turn never waits for them.

Unprompted replies then arrive after the turn has settled and append naturally as background turns, the same as t3code. Option C's insert-before-running path remains only as a fallback for the race where a reply lands during a turn that is still streaming.

## What changes

Rust (session mode only; the legacy per-turn path keeps `SettleOnFailure` and keeps waiting, because closing stdin there would end the CLI and its tasks):

- Detector: under `AwaitBackgroundWork`, drop the "live background-scope task blocks settlement" rule. Settlement requires our own result (or an interrupted result), no armed foreground task (`armed_foreground_live`), and a settled ledger (pending steers). Background-scope tasks become inherited at settlement, so they are never attributed to the next turn.
- Router: drain settlement becomes unnecessary for background scope. Keep it for foreground tasks.
- `settle_finished_foreground` / the "interrupt only foreground" natural-settle path (P3-3) becomes the normal path and can be simplified.
- No wire change. Snapshot, ended and background-turn events stay as they are.

Frontend:

- Turn-level background waiting disappears for Claude session turns: `foregroundSettled`, `useAgentBackgroundWait`, the in-turn background banner and `agentBackgroundIndicatorPresentation` stop driving a running turn. Thread and dock status come only from the session snapshot.
- Stop policy: the "foreground settled, background live" confirmation inside a running turn (`agentStopPolicy` confirmBackground) no longer applies to Claude session turns. The idle-session confirmation and per-task Stop already cover it.
- Queue and steering: a message sent while agents still run becomes a normal follow-up (a new turn in the same process) instead of a steer into a waiting turn. That is t3code's behaviour and needs a queue/steer review (`agentDeferredBoundaryTracker`, `useAgentTurnSteer`).
- Codex and remote threads are unchanged.

## Invariants: D compared with A

Option A keeps D4 and instead allows a terminal turn after a running turn.

| Area | Option D | Option A |
|---|---|---|
| "The running turn is the last turn" | Kept | Broken. `runningTurn`, `threadByLiveTurnId`, `steerThreadIsCurrent`, `flushThread`, restart-consent offers, the session view's live-turn lookups, `onTurnSettled`, the minimap and the Rust history ordinal rule all need changes |
| Restart consent | Unchanged (already session-level) | Unchanged |
| Idle TTL / eviction | Unchanged (already session-level). A session is Idle sooner, so the TTL clock starts at the result; the 12 h detached-work TTL still protects live tasks | Unchanged |
| Stop semantics | First Stop on a running turn interrupts the foreground only; background work is stopped per task or with End session. The in-turn confirmBackground path goes away for Claude session turns | Unchanged |
| "Waiting for N agents" UX | Moves from the turn to the thread row and session dock (already built). The turn shows done once Claude answered | Unchanged |
| Change capture per turn | The "after" snapshot is taken at the result; background writes land in no turn (already true for writes after settle, Risk 5 in the persistent-session plan) | Unchanged |
| Transcript order | Correct by construction | Correct, but needs the new ordering rule in store and history |
| Output capture mtime bound | Normal sequential rule | Needs a rule for terminal turns after a running one |

Risk: D concentrates the change in one Rust policy plus frontend removals of turn-level waiting; the dangerous invariant ("active turn is last") stays intact. A touches many order-sensitive call sites in TS and Rust persistence. D is the lower-risk option and matches t3code.

## Migration

- Persisted threads need no migration. Turns already stored with a background turn before a formerly running turn keep that order; the loader accepts it because the running turn was last at save time and is terminal now.
- Turn logs are per turn id and unaffected.
- A thread whose last turn is persisted as `running` from an older build at shutdown is handled by the existing restore path.

## Tests to add before implementing

- Detector/router: own result with a live background-scope task settles immediately; the task stays live at session level and is inherited; a foreground task still blocks; pending steers still block; interrupted results unchanged.
- Fake CLI (`native-background`, `agent-resume`): the turn settles at the result; the unprompted reply arrives after settlement and is appended (no insert-before path); the session snapshot shows the task until its notification.
- Supervisor: the turn reaches Exited{0} at the result while the task is live; the next turn reuses the process and is not blocked.
- Frontend: thread row and dock show the agents after the turn settled; Esc on the idle thread reaches the background confirmation; a follow-up during live agents starts a new turn; the background reply appends after the settled turn; queue drain behaves as before.
- Legacy per-turn path: unchanged (still waits).

## Rollout

Ship behind no flag; it is a pure session-mode policy change. Run the persistent-session QA steps S1-S12 again, with S5 updated: the turn completes at Claude's answer and the dock shows the background task.
