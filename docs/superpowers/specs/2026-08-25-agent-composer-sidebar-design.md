# Agent Composer, Sidebar States and Visual Token Layer Design (Slice 3)

Date: 2026-08-25

Status: Proposed design, awaiting approval

## Goal

Give the agent composer the two launch controls every T3-Code-style
orchestrator has (model, permission/execution mode) as closed enums mapped to
verified CLI flags; record the launch options on every turn; make the thread
sidebar a real work queue (status classification, attention markers, quick
filter, status filter, keyboard navigation) without rerendering the workbench
on output events; and define the token layer that lets the lead build 2-3
visual variants of the agent chrome in the untracked preview playground
(`agent-preview.html` + `src/preview/agentPreview.tsx`) as a pure token swap.

Builds on slice 1 (`2026-08-24-agent-conversational-threads-design.md`,
`d7f29447`) and slice 2 (`2026-08-25-agent-git-flow-design.md`, `1a62e6b1`)
and keeps their conventions: fail-closed parsers, authority captured before
every `await` and revalidated after, bounded IPC, thin Rust facades, no
hotspot baseline growth.

## Verified starting point

TypeScript:

- `src/domain/agentTask.ts` (424 lines): `StartAgentTaskRequest` has exactly
  `taskId, workspaceId, repositoryRoot, cwd, isolation, prompt, agentCliPath,
  agentCliKind, resumeSessionId`; `validateStartAgentTaskRequest` enforces
  `exactKeys`. `AgentCliKind = "claudeCode" | "codex"`.
- `src/domain/agentThread.ts` (551 lines): `AgentTurn` has no launch
  information. `agentThreadWire.ts:306 parseTurn` is `exactKeys` closed;
  `serializeTurn` at line 86. Rust `AgentTurn` (`agent_thread_store.rs:118`)
  is `deny_unknown_fields`; slice 2 added `integration` with
  `#[serde(default)]` and no schema bump (`AGENT_THREAD_SCHEMA_VERSION = 1`).
- `src/domain/agentSettings.ts`: `AgentAppSettings { agentCliPath,
  agentCliKind, maxConcurrentAgentTasks }` is app-global; the only
  per-workspace agent setting is `WorkspaceSettings.agentIsolationPolicy`
  (`settings.ts:144`). `useAgentProjects.ts` only has
  `Pick<SettingsGateway, "loadWorkspaceSettings">`; there is no per-project
  save path from agent mode, and a save would write a whole snapshot loaded at
  admission (clobber risk for a root that is also an open tab).
- `src/application/useAgentTurnDispatch.ts` (616 lines): `TurnStart`
  (line 100) carries `agentCliPath/agentCliKind/resumeSessionId`;
  `runTurnStart` builds the IPC request at line 318; `startThread` reads
  `normalizeAgentCliKind(deps.getAgentCliKind())` at line 437; `sendFollowUp`
  uses `thread.provider.kind` at line 510. Admission lives in
  `agentTurnAdmission.ts` (`admitStart`, `admitFollowUp`).
- `src/application/useAgentThreads.ts:230 threadViews` rebuilds every
  `AgentThreadView` object whenever `store.state.threads` changes (each
  animation-frame flush while a turn runs), so any `React.memo` on rows would
  miss unless view identity is preserved per thread.
- `src/application/useAgentThreadStore.ts:327 persistIntent` maps reducer
  actions to save urgency (`immediate` / `coalesced`,
  `MIN_AGENT_THREAD_PERSIST_INTERVAL_MS = 1000`). `localStorage` is used only
  to delete the legacy pin key.
- `src/components/agentMode/AgentModeView.tsx` (440 lines): owns
  `selectedThreadId`, three collapse sets (`collapsedProjectRootKeys`,
  `collapsedRepositoryRoots`, `expandedArchivedRoots`) as plain `useState`,
  and `now` state ticked by `setInterval(nowTickMs = 30_000)`. Collapse state
  is NOT persisted anywhere (the brief's assumption was wrong); it resets when
  agent mode remounts. `now` rerenders the whole view every 30 s, and every
  `agents.threads` change rerenders sidebar, session, info column and composer.
- `AgentThreadsSidebar.tsx` (476 lines): project -> repository -> threads,
  archived collapsed per repository, pins first
  (`orderPinnedThreadsFirst`), orphans, trust notice, release button. No
  status grouping, no filter, no keyboard handling; only the session's
  `AgentTurnView` is memoised.
- `agentModePresentation.ts` (1064 lines, not a tracked hotspot but the
  largest agent module): `agentThreadTone`, `agentProjectGroups`,
  `agentFollowUpBlockedReason`, `agentShipStatusUnread` (unread here means
  "ship status not yet fetched", not user attention).
- `AgentComposer.tsx` (334 lines): project/repository selects, isolation
  checkbox, unsafe in-place confirmation, byte counter, submit; follow-up mode
  hides target controls. No model/mode controls.
- `AgentsSettingsSection.tsx` (144 lines): CLI path, CLI kind, concurrency,
  isolation policy.
- `src/preview/agentPreview.tsx` (416 lines, untracked): renders
  `WorkbenchToolbar`, `AgentModeView`, `AgentStatusBar` with a fake
  `AgentThreadsSurface` and fake `AgentThread`/`AgentTurn` literals; `t`
  toggles `data-theme` between `calm-dark` and `light`, `?state=empty` clears
  threads. Any new required field on `AgentTurn`, `AgentThreadView`,
  `AgentThreadsSurface` or `AgentModeViewProps` must be added there or it
  stops compiling (`npm run check` includes `src/preview`).
- `src/App.css` (9547 lines): the agent block starts at `.agent-mode`
  (line 7663) where 13 `--agent-*` tokens derive from theme tokens, and runs
  with interruptions to `.agent-ship` (line 9545); toolbar/status-bar agent
  rules at 9025-9047; responsive rules at 9094-9198. Theme primitives are
  `--color-*` on `:root` (dark) and `.app-shell[data-theme=...]` blocks
  (lines 82-575), aliases at 577-627. `agentModeResponsiveStyles.test.ts`
  reads `App.css` by path and asserts selector bodies.
- Hotspots: `npm run size:hotspots` passes ("23 tracked file(s), 1 aggregate
  group(s), 2000 raw lines / 10000 structural tokens for new production
  files"). The script only scans `.rs/.ts/.tsx`; `App.css` is not tracked, so
  its size is a maintainability problem, not a gate problem.

Rust:

- `agent_task_spawner.rs` (430 lines): `plan_agent_invocation(cli_path,
  invocation, prompt, cwd, resume_session_id)`; `agent_invocation_args` is a
  four-arm `match` over `(invocation, resume)` with unit tests asserting exact
  argv. `validate_resume_session_id` rejects flag-like ids.
- `lib_composition/agent_task_commands.rs:32 StartAgentTaskRequest`
  (`deny_unknown_fields`) -> `prepare_agent_task_start` (line 143) ->
  `plan_agent_invocation` (line 165). Trust is checked before the blocking
  pool; admission reserves cwd exclusivity.
- `agent_thread_store.rs` (1440 lines): `AgentTurn` struct at line 118, bound
  checks on save; `AgentProviderSession.kind: AgentCliInvocation`.

## CLI flag evidence (captured 2026-08-25)

Versions: `claude --version` -> `2.1.245 (Claude Code)`; `codex --version` ->
`codex-cli 0.149.1`. `claude -p --help` prints the same option table as
`claude --help`.

`claude --help`:

```text
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  --dangerously-skip-permissions        Bypass all permission checks.
                                        Recommended only for sandboxes with no
                                        internet access.
  --allow-dangerously-skip-permissions  Enable bypassing all permission checks
                                        as an option, without it being enabled
                                        by default. Recommended only for
                                        sandboxes with no internet access.
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --fallback-model <model>              Enable automatic fallback to specified
                                        model(s) when the default model is
                                        overloaded or not available. ...
```

`codex exec --help` (options shared with `codex --help`):

```text
  -m, --model <MODEL>
          Model the agent should use
  -s, --sandbox <SANDBOX_MODE>
          Select the sandbox policy to use when executing model-generated shell commands
          [possible values: read-only, workspace-write, danger-full-access]
      --approve-for-me
          Route approval requests through automatic review using the workspace-write sandbox
      --dangerously-bypass-approvals-and-sandbox
          Skip all confirmation prompts and execute commands without sandboxing. EXTREMELY
          DANGEROUS. Intended solely for running in environments that are externally sandboxed
      --json
          Print events to stdout as JSONL
```

`codex --help` additionally lists `-a, --ask-for-approval <APPROVAL_POLICY>`
(`on-request`, `never`); `codex exec --help` does not list it, and there is
no `--full-auto` flag on this version.

`codex exec resume --help` (`Usage: codex exec resume [OPTIONS] [SESSION_ID]
[PROMPT]`) lists `-m, --model <MODEL>`, `--json`,
`--dangerously-bypass-approvals-and-sandbox` and `-c, --config <key=value>`,
but NOT `--sandbox`. A resumed Codex turn therefore cannot receive `-s`; the
design uses the documented config override form `-c sandbox_mode="<mode>"`
(a fixed literal from the argv table, not user input) and marks it for a
smoke test before merge (open question 1).

Consequence for non-interactive runs: the supervisor spawns with
`stdin(Stdio::null())`, so no permission prompt can ever be answered. A mode
that would prompt turns into tool denials reported inside the stream
(Claude: `tool_result.is_error`, Codex: `command_execution` with non-zero
exit). This is truthful and already rendered as `toolResult { isError }`.

## Non-goals

- Free-text model names, `--fallback-model`, `--effort` (open question 3),
  `--allowedTools`/`--tools`, `--append-system-prompt`, MCP config,
  `--approve-for-me`, `-a on-request` (would hang without stdin).
- Parsing plan-mode output differently. In `-p` mode Claude's plan arrives as
  ordinary `assistant`/`result` lines; it renders as text. No plan-specific
  UI in this slice.
- Changing the provider of an existing thread (still blocked by
  `agentFollowUpBlockedReason`).
- Persisting collapse state or the filter across restarts (kept in memory, as
  today; open question 4).
- Choosing the final palette. This spec defines the token layer and design
  direction; the lead builds variants in the preview for the user to pick.
- Search over turn content (filter is titles only).

## Domain model

### `src/domain/agentLaunch.ts` (new, <= 220 lines)

```ts
export const CLAUDE_MODEL_CHOICES = ["default", "fable", "opus", "sonnet"] as const;
export type ClaudeModelChoice = (typeof CLAUDE_MODEL_CHOICES)[number];

export const CLAUDE_PERMISSION_MODES =
  ["default", "plan", "acceptEdits", "bypassPermissions"] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

export const CODEX_MODEL_CHOICES = ["default", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] as const;
export type CodexModelChoice = (typeof CODEX_MODEL_CHOICES)[number];

export const CODEX_EXECUTION_MODES =
  ["default", "readOnly", "workspaceWrite", "dangerFullAccess"] as const;
export type CodexExecutionMode = (typeof CODEX_EXECUTION_MODES)[number];

export type AgentLaunchOptions =
  | { readonly provider: "claudeCode"; readonly model: ClaudeModelChoice;
      readonly mode: ClaudePermissionMode }
  | { readonly provider: "codex"; readonly model: CodexModelChoice;
      readonly mode: CodexExecutionMode };

export function defaultAgentLaunchOptions(provider: AgentCliKind): AgentLaunchOptions;
export function parseAgentLaunchOptions(value: unknown, path: string): AgentLaunchOptions;
export function isDangerousAgentLaunch(options: AgentLaunchOptions): boolean;
// claudeCode/bypassPermissions or codex/dangerFullAccess
export function agentLaunchOptionsEqual(a: AgentLaunchOptions, b: AgentLaunchOptions): boolean;
```

Rules:

- `default` for both fields means "pass no flag; the CLI resolves its own
  configuration". This is what slices 1-2 do today, so the empty choice
  reproduces current argv byte for byte.
- The allow-lists are closed literal tuples. Codex ids are seeded from the
  names in use on this machine; before merge each id is smoke-tested with
  `codex exec -m <id> --json -- "reply ok"` (open question 2). A wrong id is
  a turn-level failure (CLI exits non-zero, `unknownLine` stderr, notice),
  never a security issue, because no user string reaches argv.
- `parseAgentLaunchOptions` uses `exactKeys(["provider","model","mode"])` and
  rejects any value outside the tuple for that provider (fail closed, style
  of `agentTask.ts`).
- Labels live in presentation (`agentLaunchModelLabel`,
  `agentLaunchModeLabel`, `agentLaunchModeHint`), never in the domain.

### `src/domain/agentTask.ts`

`StartAgentTaskRequest` gains `readonly launch: AgentLaunchOptions`.
`validateStartAgentTaskRequest` adds `"launch"` to `exactKeys`, parses it
with `parseAgentLaunchOptions`, and rejects `launch.provider !==
agentCliKind` ("request.launch.provider: expected the agent CLI kind").
`agentCliKind` stays because the Rust invocation enum and the store already
key on it; the equality check keeps the duplication honest.

### `src/domain/agentThread.ts` + `agentThreadWire.ts`

```ts
export interface AgentTurn {
  // existing fields unchanged
  readonly launch: AgentLaunchOptions | null;   // null = recorded before slice 3
  readonly viewedAtEpochMs?: never;             // (not on turns; see thread)
}
export interface AgentThread {
  // existing fields unchanged
  readonly viewedAtEpochMs: number | null;      // last time the user opened it
}
```

- `parseTurn` accepts a missing `launch` key (v1 documents) and maps it to
  `null`; when present it must parse. `serializeTurn` always writes it.
  `parseAgentThread` treats a missing `viewedAtEpochMs` as `null`. No schema
  bump (same approach as slice 2's `integration`), so old files keep loading
  and new files keep `schemaVersion: 1`.
- New actions: `{ kind: "threadViewed"; threadId; atEpochMs }` (sets
  `viewedAtEpochMs`, no-op if unchanged or thread missing) and `turnStarted`
  carries the `launch` on the `AgentTurn` it already contains (no new field on
  the action).
- `AgentThreadAttention = "running" | "attention" | "settled" | "archived"`
  with `agentThreadAttention(thread)`: archived -> `archived`; running turn ->
  `running`; last turn `failed`, `interrupted`, `stopped`, or `exited` with
  `exitCode !== 0` -> `attention`; otherwise `settled`.
- `agentThreadUnread(thread)`: last turn terminal with `endedAtEpochMs !==
  null` and (`viewedAtEpochMs === null` or `endedAtEpochMs > viewedAtEpochMs`).
  Pure; the "not while selected" rule is applied by the view.
- `lastUsedAgentLaunch(threads, rootKey, provider)`: newest
  `turn.launch` (by `startedAtEpochMs`, tie on turnId) among threads with
  `owner.rootKey === rootKey` whose `launch.provider === provider`, else
  `null`.

### Persistence decision for "last used model/mode per project root"

Chosen: derive it from the store (`lastUsedAgentLaunch`) plus in-memory
composer state for an unsent change. No new file, no IPC, no settings write,
nothing to migrate, exact-owner by construction (threads already carry
`owner.rootKey`). Trade-off: deleting every thread of a root forgets the
preference; acceptable. Rejected: `WorkspaceSettings` field (needs a save path
from agent mode and can clobber a background tab's snapshot), `localStorage`
(slice 1 just removed the last such key), a new Rust preferences store (a
module, two commands, a gateway and tests for one enum pair).

### Rust wire types (`agent_task_spawner.rs`)

```rust
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeModelChoice { Default, Fable, Opus, Sonnet }
#[derive(...)] #[serde(rename_all = "camelCase")]
pub enum ClaudePermissionMode { Default, Plan, AcceptEdits, BypassPermissions }
#[derive(...)]
pub enum CodexModelChoice {
    #[serde(rename = "default")] Default,
    #[serde(rename = "gpt-5.6-sol")] Gpt56Sol,
    #[serde(rename = "gpt-5.5")] Gpt55,
    #[serde(rename = "gpt-5.4")] Gpt54,
}
#[derive(...)] #[serde(rename_all = "camelCase")]
pub enum CodexExecutionMode { Default, ReadOnly, WorkspaceWrite, DangerFullAccess }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "provider", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentLaunchOptions {
    ClaudeCode { model: ClaudeModelChoice, mode: ClaudePermissionMode },
    Codex { model: CodexModelChoice, mode: CodexExecutionMode },
}

impl AgentLaunchOptions {
    pub fn invocation(&self) -> AgentCliInvocation;
    fn model_args(&self) -> Vec<&'static str>;   // [] or ["--model", "opus"] / ["-m", "gpt-5.5"]
    fn mode_args(&self, resumed: bool) -> Vec<&'static str>;
}
```

`plan_agent_invocation` gains `launch: AgentLaunchOptions` and returns
`Err("Agent launch options do not match the agent CLI kind.")` when
`launch.invocation() != invocation`. Every argv fragment is a `&'static str`
from the tables below; nothing is formatted from request data except the
already-validated resume id and the prompt after `--`.

### Argv tables (exhaustive, unit-tested on both sides)

Claude (`claude`), prefix `-p --output-format stream-json --verbose`:

| model | fragment |
|---|---|
| default | (none) |
| fable | `--model fable` |
| opus | `--model opus` |
| sonnet | `--model sonnet` |

| mode | fragment |
|---|---|
| default | (none) |
| plan | `--permission-mode plan` |
| acceptEdits | `--permission-mode acceptEdits` |
| bypassPermissions | `--dangerously-skip-permissions` |

Order: prefix, model, mode, `--resume <id>` (follow-up only), `--`, prompt.
Example: `-p --output-format stream-json --verbose --model opus
--permission-mode acceptEdits --resume <id> -- <prompt>`.

Codex (`codex`):

| model | fragment |
|---|---|
| default | (none) |
| gpt-5.6-sol | `-m gpt-5.6-sol` |
| gpt-5.5 | `-m gpt-5.5` |
| gpt-5.4 | `-m gpt-5.4` |

| mode | first turn (`exec`) | follow-up (`exec resume`) |
|---|---|---|
| default | (none) | (none) |
| readOnly | `--sandbox read-only` | `-c sandbox_mode="read-only"` |
| workspaceWrite | `--sandbox workspace-write` | `-c sandbox_mode="workspace-write"` |
| dangerFullAccess | `--dangerously-bypass-approvals-and-sandbox` | `--dangerously-bypass-approvals-and-sandbox` |

Order first turn: `exec --json <model> <mode> -- <prompt>`. Follow-up: `exec
resume --json <model> <mode> <id> -- <prompt>` (options before the positional
session id, matching the slice 1 template that puts `--json` before the id).

`bypassPermissions` maps to `--dangerously-skip-permissions` rather than
`--permission-mode bypassPermissions` because the help text presents the
former as the direct switch and the latter may depend on
`--allow-dangerously-skip-permissions`; the smoke test in open question 1
confirms or swaps this single table row.

## Application layer

### Ports (`agentThreadPorts.ts`)

```ts
export interface AgentThreadStartRequest {
  // existing
  readonly launch: AgentLaunchOptions;
}
export interface AgentFollowUpRequest {
  readonly threadId: string;
  readonly prompt: string;
  readonly launch: AgentLaunchOptions;
}
export interface AgentThreadView {
  // existing
  readonly attention: AgentThreadAttention;
  readonly unread: boolean;                       // agentThreadUnread(thread)
}
export interface AgentThreadsSurface {
  // existing
  markThreadViewed(threadId: string): void;
  lastUsedLaunch(projectRootKey: string): AgentLaunchOptions | null;
}
```

### `useAgentTurnDispatch.ts`

- `TurnStart` gains `launch`. `startThread` uses `request.launch` after
  `admitStart` validated `launch.provider === agentCliKind` (else
  `failure("The selected model or mode belongs to a different provider.")`).
  `sendFollowUp` validates `launch.provider === thread.provider.kind`.
- The pending `AgentTurn` created by `pendingTurn` records `launch`, so
  `turnStarted` persists it immediately (existing `immediate` intent).
- Authority: unchanged pattern; `launch` is an immutable value captured with
  the request, so no revalidation beyond the existing owner checks.
- Dangerous modes (`isDangerousAgentLaunch`) require the same confirmation
  style as unsafe in-place: the composer shows a checkbox "Run without
  permission checks in this repository" and the request carries
  `dangerousLaunchConfirmed: true`; dispatch rejects a dangerous launch
  without it. The confirmation is per submit (never remembered), while the
  choice itself is remembered as last-used.

### `useAgentThreadStore.ts`

- `threadViewed` -> `saveIntent(threadId, "coalesced")` (at most one write per
  second per thread; a burst of arrow-key selections does not thrash disk).
- No change to load/eviction; `viewedAtEpochMs` is not an eviction input.

### `useAgentThreads.ts`

- `agentThreadViews` becomes identity-preserving: keep a `Map<threadId,
  AgentThreadView>` in a ref and return the previous object when `thread`,
  `changeSummary`, `ship`, `editorAvailability`, both worktree flags,
  `projectOrigin` and `repositoryLabel` are `===`. Because the reducer
  replaces only the changed thread, a running turn's flush yields one new view
  object; all other rows keep identity and `React.memo` rows skip.
- `markThreadViewed(threadId)` dispatches `threadViewed` with `now()`.
- `lastUsedLaunch(rootKey)` = `lastUsedAgentLaunch(threads, rootKey,
  currentCliKind)`.

### Clock isolation (`src/components/agentMode/agentClock.tsx`, new)

`AgentClockProvider` owns the 30 s `setInterval` and publishes `now` through
context; `useAgentNow()` is consumed only by leaf `AgentRelativeTime`
components (sidebar row meta, session prompt meta, info column). `AgentModeView`
drops its `now` state, so a tick rerenders only the time leaves. Tests keep
`nowTickMs` as a provider prop.

## Rust changes (strict IPC)

- `agent_task_spawner.rs`: enums above; `plan_agent_invocation(..., launch)`;
  `agent_invocation_args(invocation, prompt, resume, launch)` builds
  `prefix + model_args + mode_args(resumed) + resume + ["--", prompt]`.
  Tests: exact argv for every (provider, model, mode, resume) combination via a
  table-driven test (4 x 4 x 2 per provider = 64 cases), provider mismatch
  rejected, `deny_unknown_fields`/unknown variant rejected by serde
  (`{"provider":"claudeCode","model":"claude-opus-4"}` fails).
- `lib_composition/agent_task_commands.rs`: `StartAgentTaskRequest` gains
  `launch: AgentLaunchOptions`; `prepare_agent_task_start` passes it through
  and returns the mismatch error before admission. Facade test: a request with
  `launch.provider` != `agent_cli_kind` is refused; a request missing `launch`
  is refused (closed contract on both sides, so TS must always send it).
- `agent_thread_store.rs`: `AgentTurn` gains `#[serde(default)] pub launch:
  Option<AgentLaunchOptions>`; `AgentThread` gains `#[serde(default)] pub
  viewed_at_epoch_ms: Option<u64>`. Bounds unchanged (enum payloads are
  fixed-size). Tests: v1 document without the fields loads; document with an
  unknown mode string is reported `unreadable`, not deleted.
- No new commands, channels, or trust rules.

## UI structure (`src/components/agentMode`)

### Composer (`AgentComposer.tsx`, target <= 380 lines after extraction)

- New props: `launch: AgentLaunchOptions`, `launchProvider: AgentCliKind`,
  `onLaunchChange(next)`, `dangerousConfirmed: boolean`,
  `onDangerousConfirmedChange`.
- A new `AgentLaunchControls.tsx` (<= 160 lines) renders two compact
  `<select>`s in the composer row, left of the target chip: model (labels
  "Default model", "Fable", "Opus", "Sonnet" / "GPT-5.6 Sol", ...) and mode
  (Claude: "Default permissions", "Plan only", "Accept edits", "Bypass
  permissions"; Codex: "Default sandbox", "Read-only", "Workspace write",
  "Full access"). Each option carries a one-line `title` hint from
  `agentLaunchModeHint`. A dangerous choice shows a warning row (same
  `.agent-composer__unsafe` pattern) with the confirmation checkbox; submit is
  blocked until checked.
- Follow-up mode keeps both selects visible (flags are per invocation) and
  seeds them from the thread's last turn `launch` (or provider default when
  `null`).
- New-thread mode seeds from `agents.lastUsedLaunch(projectRootKey)` when the
  target project changes and the user has not touched the controls in this
  session (`AgentModeView` keeps `launchChoice: { rootKey, launch } | null`,
  mirroring `isolationChoice`).
- Provider switch in settings while the composer is open resets the choice to
  the new provider default (the union makes a stale pair unrepresentable).

### Turn record display

- `AgentThreadSession` prompt meta gains `model · mode` after the isolation
  word when `turn.launch !== null` (e.g. `opus · accept edits`); nothing is
  shown for pre-slice turns.
- `AgentThreadInfoColumn` shows a "launch" section for the selected thread's
  latest turn: model and mode labels, plus "Bypasses permission checks" in the
  warning tone when dangerous.

### Sidebar (`AgentThreadsSidebar.tsx` -> split)

Files: `AgentThreadsSidebar.tsx` (shell, header, filters, keyboard; <= 300),
`AgentThreadsSidebarGroups.tsx` (project/repository/archived sections, moved
verbatim; <= 320), `AgentThreadRow.tsx` (memoised row + orphan list; <= 200).

- Header: title, live count, a text input `Filter threads` (bounded to
  `MAX_AGENT_THREAD_FILTER_CHARS = 128`, `useDeferredValue`, case-insensitive
  substring over `agentThreadDisplayTitle`), and a segmented status filter
  `All | Running | Attention | Idle | Archived` (`AgentThreadStatusFilter`
  closed union, default `all`). Filter state lives in `AgentModeView`
  (memory only). Empty result shows "No threads match" and a "Clear filters"
  link.
- Ordering inside a repository: running, attention, settled; pinned first
  within each band; then `updatedAtEpochMs` desc. Archived stays a collapsed
  sub-group and is hidden unless the status filter is `all`/`archived`.
  Implemented in `agentProjectGroups` via a new `AgentThreadListQuery {
  text, status }` argument, so grouping stays pure and tested.
- Row: status dot (tone as today), title, meta line `<status> · <time> ·
  <model>` (model only when present), an unread marker (small filled dot
  before the title, `aria-label="Unread result"`) when `view.unread && !selected`,
  and the attention tone on the dot for `attention` threads. Rows are
  `React.memo` keyed on `view` identity + `selected` + `focused`.
- Marking viewed: `AgentModeView` calls `agents.markThreadViewed(threadId)`
  in an effect keyed on `selectedThreadId` and again when the selected
  thread's last turn reaches a terminal status (so a result that lands while
  the thread is open never becomes unread).
- Keyboard: the rail list is a listbox-like roving-tabindex region
  (`role="list"` wrapper, rows keep `role="button"` with `tabIndex` 0 for the
  focused row and -1 otherwise). `ArrowDown/ArrowUp` move focus through the
  visible rows in DOM order (computed from the filtered groups as
  `visibleThreadIds`), `Home/End` jump, `Enter`/`Space` select, `p` toggles
  pin on the focused row, `Escape` returns focus to the filter input. Focus is
  moved with `element.focus()` on `[data-thread-id]`; focus does not select.
- Collapse state: still in-memory in `AgentModeView` (open question 4).

### Status bar

`AgentStatusBar` adds `attentionCount` ("2 need attention") and renders the
selected thread's model/mode when a thread is selected; props-only, no state.

### Preview playground

`src/preview/agentPreview.tsx` must add `launch` on every fake `AgentTurn`
(mix of `null` and real values), `viewedAtEpochMs` on threads,
`attention`/`unread` on views, `markThreadViewed`/`lastUsedLaunch` on the
surface, and a `?variant=` query parameter that sets
`data-agent-variant` on `.agent-mode` (see below). The file stays untracked
and is not part of any stream's validation beyond `npm run check`.

## Visual direction and token layer

Direction: "quiet instrument panel". The current chrome has an ambient depth
treatment (radial glows, scanline, well shadows) that competes with the
content. The redesign keeps the three-column structure and lets exactly one
thing glow: the live state. Everything else is flat surfaces separated by
hairlines, with hierarchy carried by type weight and spacing, not by boxes.

- Hierarchy: rail (dense, secondary) < session (primary reading surface) <
  composer (the one raised element) ; info column is quiet reference text.
- Spacing scale (`--agent-space-*`): 2, 4, 8, 12, 16, 24, 32 px. Rail row
  padding 8/12, session gutter 28, composer box max-width 760 (unchanged).
- Type scale (`--agent-fs-*`): 2xs 10.5, xs 11, sm 12, md 13, lg 15, xl 18;
  line heights 1.35 (rows), 1.55 (prose). Mono only for meta/tool rows.
- Color roles (`--agent-*`): `canvas`, `rail`, `raised`, `well`, `hairline`,
  `hairline-strong`, `text-strong`, `text`, `text-muted`, `text-subtle`,
  `live`, `live-soft`, `glow`, `ok`, `attention`, `danger`, `stopped`,
  `archived`, `focus-ring`. All derive from theme primitives, so light and
  every dark theme are covered by construction; variants only change the
  mixes.
- Density: rail rows two lines at 44 px, one-line mode when the rail is
  narrower than 220 px (title only). Session turns separated by 24 px, not
  cards.
- Motion: 120 ms hover, 180 ms selection bar, 200 ms mode enter; the live dot
  pulse is the only looping animation; all honour `prefers-reduced-motion`.

Token mechanics:

1. Move the whole agent block (lines 7663-9198 agent rules and 9200-9547,
   plus the toolbar/status-bar agent rules) into
   `src/components/agentMode/agentMode.css`, imported from `App.css` with
   `@import "./components/agentMode/agentMode.css";` at the top (Vite inlines
   it; the preview keeps importing `App.css`). Pure move first, one commit,
   `agentModeResponsiveStyles.test.ts` switches to reading the new file.
2. The base tokens stay on `.agent-mode`; variants are
   `.agent-mode[data-agent-variant="a"] { ... }` blocks that reassign tokens
   only (no selectors, no layout). The preview sets the attribute from
   `?variant=`; production leaves it unset until the user picks, then the
   chosen block becomes the base and the others are deleted.
3. Suggested variants for the lead to build (names only, not palettes):
   A "Graphite" (flat, hairline-led, no glow except live), B "Paper"
   (raised composer and session cards, soft shadows, warmer surfaces),
   C "Signal" (keeps a restrained accent glow and stronger contrast).

## Failure modes

| Failure | Behaviour |
|---|---|
| Launch provider mismatches CLI kind (TS or Rust) | Rejected before spawn with a bounded notice; nothing started. |
| Model id unknown to the CLI | CLI exits non-zero; turn `exited N` with stderr as `unknownLine`; notice "The agent CLI rejected the selected model." (detected as exit != 0 with no session id, same heuristic as slice 1's resume failure). |
| Mode needs a prompt (stdin is null) | Tools are denied inside the stream; rendered as error tool results; the turn still settles. |
| `-c sandbox_mode=` unsupported on resume | Same path as unknown model; open question 1 removes the row if the smoke test fails. |
| Old thread files without `launch`/`viewedAtEpochMs` | Load as `null`; UI shows no model; all settled threads count as unread once, then clear on view. |
| Thread file with invalid launch enum | Skipped and reported `unreadable`; never deleted. |
| Dangerous mode without confirmation | Submit disabled; dispatch also rejects (defence in depth). |
| Filter text over 128 chars | Input `maxLength`; domain query clips on a UTF-16 boundary. |
| Keyboard focus on a row that the filter removes | Focus falls back to the first visible row, else the filter input. |
| `threadViewed` for a thread deleted meanwhile | Reducer no-op, no persist. |
| Owner generation changes between selection and `markThreadViewed` | Reducer keys by threadId in the current state; a foreign thread is absent and ignored. |

## Performance

- Output flush rerenders one memoised row and one `AgentTurnView`; sidebar
  groups recompute in O(threads) with stable view identity; measured by a test
  counting row renders while feeding 300 output events (expect <= flush count
  for the running row, 0 for others).
- `now` ticks rerender only `AgentRelativeTime` leaves (test: `AgentModeView`
  render-probe count unchanged across three ticks).
- Filtering is O(threads) per deferred keystroke over <= 64 threads per root;
  no indexes needed.
- `threadViewed` saves are coalesced; no write on pure focus movement.

## Testing plan

Domain (vitest): launch parser accepts every tuple pair and rejects unknown
ids, cross-provider pairs, extra keys; `defaultAgentLaunchOptions` round trip;
`isDangerousAgentLaunch`; `agentThreadAttention`/`agentThreadUnread` truth
tables (all six turn statuses, viewed before/after end, null); `lastUsedAgentLaunch`
picks the newest by time then id and ignores other roots/providers;
wire round trip with and without `launch`/`viewedAtEpochMs`;
`validateStartAgentTaskRequest` rejects missing or mismatched `launch`.

Application (vitest, real collaborators): dispatch passes `launch` into the
gateway request for new and follow-up turns; mismatch rejected; dangerous
launch without confirmation rejected; `threadViewed` persist coalesced;
view identity preserved for untouched threads across an output flush;
`lastUsedLaunch` after a turn.

Components (jsdom, `act`/`waitFor`): composer renders provider-specific
options, seeds from last used, warns and blocks on dangerous modes, keeps
controls in follow-up mode; sidebar filter text/status, ordering bands,
unread marker appears and clears on selection, keyboard navigation (arrows,
Home/End, Enter, Escape) with focus assertions; status bar attention count;
`agentModeResponsiveStyles.test.ts` against the moved CSS file;
`AgentThreadSession` prompt meta shows model/mode only when present.

Rust: table-driven argv tests (both providers, all pairs, first and resume),
provider mismatch, serde rejections, store defaults for old documents.

Manual smoke before merge (lead, real CLIs in a throwaway repo): one Claude
turn with `--model sonnet --permission-mode acceptEdits`, one resumed Codex
turn with `-c sandbox_mode="workspace-write"`, one `-m` per Codex id; record
results in the commit message body.

Gates: `npm run check`, `npm run lint -- --max-warnings 0`,
`npm run size:hotspots`, `npm run format:check`, `npm run format:check:changed`,
`npm test -- --run`, `cargo check --all-targets`, `cargo test --lib`,
`cargo test --tests`, `cargo fmt --all -- --check`,
`cargo clippy --all-targets -- -D warnings`, `git diff --check`. `npm run
build` only as the final gate, not for iteration.

## Implementation streams (disjoint write scopes)

S0 (sequential, lead or one agent, first): `src/domain/agentLaunch.ts`
(types + parser), `agentTask.ts` request field, `agentThread.ts` type
additions (`launch`, `viewedAtEpochMs`, `AgentThreadAttention`, action),
`agentThreadPorts.ts` additions, Rust enums + `StartAgentTaskRequest` field
+ store fields with `todo!()`-free minimal bodies, and the preview file
updated so `npm run check` passes.

Then in parallel:

- **A: Domain** - `agentLaunch.ts` helpers + test, `agentThread.ts` reducer
  (`threadViewed`), `agentThreadWire.ts` + test, `agentTask.test.ts`.
  Forbidden: application, components, Rust.
  Validate: `npx vitest run src/domain/agentLaunch src/domain/agentThread src/domain/agentTask`.
- **B: Rust** - `agent_task_spawner.rs`, `lib_composition/agent_task_commands.rs`,
  `agent_thread_store.rs`, `lib_composition/tests.rs` includes. Forbidden:
  everything else in `src-tauri`. Validate: `cargo check --all-targets`,
  `cargo test --lib agent_task_spawner`, `cargo test --lib agent_thread_store`,
  `cargo test --tests`, `cargo fmt --all -- --check`,
  `cargo clippy --all-targets -- -D warnings`.
- **C: Application** - `useAgentTurnDispatch.ts` + test,
  `agentTurnAdmission.ts` + test, `useAgentThreadStore.ts` + test,
  `useAgentThreads.ts` + test, `tauriAgentTaskIpcContract.ts` + test,
  `useWorkbenchAgents.ts` if a dependency is added. Forbidden: components,
  domain, Rust. Validate: `npx vitest run src/application/useAgentTurnDispatch
  src/application/agentTurnAdmission src/application/useAgentThreadStore
  src/application/useAgentThreads src/infrastructure/tauriAgentTask`,
  `npm run check`, `npm run size:hotspots`.
- **D1: UI sidebar** - `AgentThreadsSidebar.tsx` (split into the three files
  above) + tests, `agentClock.tsx`, `AgentStatusBar.tsx` + test, the
  grouping/filter/attention helpers in `agentModePresentation.ts` (lines
  41-66, 112-190, 498-668 region) + test. Forbidden: composer files,
  `AgentModeView.tsx` (D3), application, domain.
- **D2: UI composer** - `AgentComposer.tsx`, `AgentLaunchControls.tsx` +
  tests, `AgentThreadSession.tsx` prompt meta + test,
  `AgentThreadInfoColumn.tsx` launch section + test, the launch label helpers
  in `agentModePresentation.ts` (appended at the end of the file only, to
  avoid overlapping D1's regions). Forbidden: sidebar files, `AgentModeView.tsx`.
- **D3: CSS move + tokens + `AgentModeView.tsx` wiring** (lead, after D1/D2
  land): `agentMode.css` extraction, token layer, variant blocks,
  `agentModeResponsiveStyles.test.ts`, `AgentModeView.tsx` + test, preview
  `?variant=`. Forbidden: anything D1/D2 own until they are merged.
- **E: Read-only adversarial review** (a different agent from each author):
  argv tables against the quoted help text, provider mismatch on both sides,
  dangerous-mode confirmation bypass attempts, view identity/memo proof,
  keyboard focus trap and ARIA, persist coalescing, hotspot budgets, preview
  compiles. Findings return to the owning stream.

Lead: integration, smoke test, full gates, commit to `main` after review and
explicit authorization, then build the A/B/C variants in the preview and hand
the user the choice.

## Open questions

1. Does `claude -p --dangerously-skip-permissions` run as expected under the
   supervisor (stdin null), and does `codex exec resume -c
   sandbox_mode="workspace-write"` apply the sandbox? Both are answered by
   the pre-merge smoke test; a negative answer changes one table row each.
2. Which Codex model ids should ship in the allow-list? Seeded with
   `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4`; each must pass the smoke test or be
   dropped. Claude aliases come straight from the help text.
3. Add `--effort <level>` (Claude) as a third closed enum now, or defer? It
   is cheap (one tuple, one table) but adds a third control to the composer.
   Deferred here; trivially added to `AgentLaunchOptions.claudeCode`.
4. Persist rail collapse state and the status filter per root? Both are
   in-memory today. If wanted, a per-root `agentRailState` in the thread
   store directory would be the place, not `localStorage`.
5. Should selecting `plan` mode label the submit button "Plan" and show a
   plan badge on the turn, given no special parsing exists? Proposed: badge
   from `turn.launch.mode` only (already covered by the meta line).
