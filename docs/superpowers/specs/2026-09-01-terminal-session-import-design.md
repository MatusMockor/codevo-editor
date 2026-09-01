# Terminal Session Import Design

Date: 2026-09-01

Status: Approved design, ready for implementation

## Goal

Codevo lists agent sessions the user ran directly in a terminal (`claude`,
`codex`) for a given project and lets the user continue any of them as a
normal Codevo thread. Import creates a persisted `AgentThread` whose
`provider.sessionId` is the external session id; the first follow-up goes
through the existing `sendFollowUp` resume path unchanged
(`claude -p ... --resume <id>`, `codex exec resume --json <id>`).

## Non-goals

- Live attach to a currently running terminal session. Import only; the
  external CLI process, if still running, is never touched.
- Rendering the full historical transcript inside the thread view. The thread
  starts empty (plus an imported provenance note); history is available in the
  bounded preview pane before import.
- Importing sessions from other machines, `~/.codex/archived_sessions`, VS
  Code extension sessions, or subagent/sidechain sessions.
- Writing anything under `~/.claude` or `~/.codex`. Both trees are read-only
  to Codevo.
- Editing or deleting external session files from the UI.

## Verified on-disk formats (this machine, 2026-09-01)

CLI versions: `claude` 2.1.252, `codex-cli` 0.149.1.

### Claude Code

Location: `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, one file
per session, appended in place on resume. Sibling directories named
`<session-uuid>/` hold `tool-results/` and `subagents/` payloads and are
skipped (only top-level `*.jsonl` files are sessions).

Encoding of `<encoded-cwd>` (verified empirically): every character of the
absolute cwd that is not `[A-Za-z0-9]` becomes `-`. Verified cases:

- `/Users/matusmockor/Developer/editor` -> `-Users-matusmockor-Developer-editor`
- `.../import-smoke/under_score.dir` -> `...-import-smoke-under-score-dir`
  (both `_` and `.` become `-`)
- `/Users/.../editor/.worktrees/agt-x` -> `...-editor--worktrees-agt-x`

The mapping is lossy (dashes in real path components survive unchanged), so a
directory name can collide across different cwds. The encoded name is only a
candidate filter; the authoritative check is the `cwd` field inside the file.

Line types observed across 34 real sessions: `user`, `assistant`,
`attachment`, `system`, `queue-operation`, `last-prompt`, `ai-title`,
`agent-name`, `mode`, `permission-mode`, `atis-latch`,
`file-history-snapshot`, `file-history-delta`. Metadata lines (`last-prompt`,
`ai-title`, `agent-name`, `mode`, `permission-mode`) carry no `cwd` and no
`timestamp`; message lines carry both. Real samples (content trimmed):

```json
{"type":"user","message":{"role":"user","content":"v tomto projekte je ..."},
 "promptSource":"typed","origin":{"kind":"human"},"userType":"external",
 "entrypoint":"cli","cwd":"/Users/matusmockor/Developer/editor",
 "sessionId":"987b95ad-c9bc-4d08-ae49-9b431efc8f87",
 "timestamp":"2026-07-29T08:21:39.241Z","version":"2.1.220","gitBranch":"main",
 "isSidechain":false,"uuid":"...","parentUuid":"...","promptId":"...",
 "permissionMode":"auto"}
{"type":"ai-title","aiTitle":"Security review multi-module release R14",
 "sessionId":"02fa9aec-f3ff-42c8-9e0b-1851a66dc812"}
{"type":"agent-name","agentName":"Codevo Editor workspace izolacia ...",
 "sessionId":"a34b0969-f018-46a7-aad0-23ebf1c9b804"}
```

Key facts for cheap extraction:

- Session id = filename stem (UUID). Repeated on every line as `sessionId`
  (older files also use `session_id` on assistant lines; not needed).
- `promptSource` on user lines distinguishes provenance: `typed` (interactive
  human prompt), `sdk` (driven through the SDK or `claude -p`, which is what
  Codevo itself and hook-driven reviews produce), plus `system`, `queued`,
  `suggestion_accepted`. Verified: a `claude -p` run records its prompt with
  `promptSource":"sdk"`; interactive terminal prompts record `typed`. Old
  files (pre promptSource) omit the field.
- Real user prompts vs plumbing: skip user lines with `isMeta: true`, with a
  `toolUseResult` key (tool results echo as `type":"user"`), and content
  starting with `<command-name>`, `<local-command-stdout>`,
  `<local-command-caveat>`, or any other `<`-prefixed local marker. Content is
  either a string or an array of blocks with `{type:"text", text}`.
- Started timestamp = first line that has a `timestamp` (ISO 8601). File head
  may open with untimestamped metadata lines, so scan a bounded head.
- Last activity = file mtime (cheap, accurate: files are append-updated).
- Title candidates in head order: `agent-name.agentName`, `ai-title.aiTitle`,
  else first real typed prompt clipped to thread title bounds.
- `~/.claude/__store.db` does not exist on this machine. `~/.claude/history.jsonl`
  exists (global prompt log; newer entries carry `sessionId` and `project`)
  but is global, prunable, and has no Codex coverage - rejected as an index;
  the per-project directory listing is the index.

### Codex

Location: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, one file
per thread, appended in place on resume (verified: resume from a different
cwd appended to the same file). First line is always `session_meta`:

```json
{"timestamp":"2026-08-25T11:15:20.604Z","type":"session_meta","payload":{
 "id":"01a038a1-c2ee-7642-98e4-c94d7a479e0c",
 "session_id":"01a038a1-c2ee-7642-98e4-c94d7a479e0c",
 "timestamp":"2026-08-25T11:15:20.451Z",
 "cwd":"/private/tmp/.../smoke/run2",
 "originator":"codex_exec","cli_version":"0.149.1","source":"exec"}}
```

`payload.id` (== `payload.session_id` == filename uuid) is the id that
`codex exec resume` accepts. `forked_from_id` appears on forked sessions and
is tolerated but unused. Provenance survey across 1038 real files:

| originator | source | count | meaning |
|---|---|---|---|
| Codex Desktop / codex_work_desktop | `{"subagent": ...}` (object) | 963 | subagent spawns - exclude |
| codex_exec | `"exec"` | 52 | terminal `codex exec` - include |
| codex-tui | `"cli"` | 2 | interactive terminal TUI - include |
| various | `"vscode"` | 21 | IDE extension - exclude |

Default inclusion rule (fail-closed): include only when `source` is exactly
the string `"exec"` or `"cli"`. Objects (subagent spawns), `"vscode"`, and
any unknown value are excluded and counted in `skipped`.

Message lines: `response_item` with `payload.type":"message"`,
`payload.role` in `developer | user | assistant`, content blocks
`input_text` / `output_text` with `text`. Real sample (trimmed):

```json
{"timestamp":"2026-08-19T10:06:31.627Z","type":"response_item","payload":{
 "type":"message","role":"user",
 "content":[{"type":"input_text","text":"ak ti dam miesto kde mam ..."}]}}
```

First real user prompt = first `response_item` message with `role":"user"`
whose text does not start with `<environment_context>`, `<user_instructions>`,
or another `<`-prefixed injected block (developer-role messages are always
skipped). Every line carries a top-level `timestamp`; last activity = file
mtime. Other observed line/payload types (`event_msg` with `task_started`,
`item_completed`, `token_count`, `turn_context`, `world_state`, `reasoning`,
`custom_tool_call`, ...) are ignored by the importer.

### Resume smoke tests (real CLIs, throwaway repos, 2026-09-01)

All commands exited 0 and context carried:

| step | command (cwd) | exit | evidence |
|---|---|---|---|
| 1 | `claude -p --output-format json -- "remember plum"` (repo-a) | 0 | `session_id 34fbe185-...` |
| 2 | `claude -p --resume 34fbe185-... -- "which word?"` (repo-a) | 0 | result `plum`, same session_id |
| 3 | same resume from repo-b (different cwd) | 0 | result `plum`; transcript appended under repo-a's project dir; repo-b dir created but empty |
| 4 | `codex exec --json -- "remember mango"` (repo-a) | 0 | `thread_id 01a05d25-...` |
| 5 | `codex exec resume --json 01a05d25-...` (repo-a) | 0 | agent_message `mango` |
| 6 | same resume from repo-b | 0 | `mango <repo-b path>`; same thread_id; same rollout file appended |

Conclusions: both CLIs resolve resume ids globally, independent of cwd, and
the resumed turn runs its tools in the invoking cwd. Codevo spawns follow-up
turns from the imported thread's repository root, which is exactly the cwd
the terminal session used, so no cwd caveat applies in the default flow.
Codex may emit MCP auth errors on stderr while still exiting 0; the existing
turn stream path already renders stderr as bounded `unknownLine` events.

## Discovery mapping

Given an admitted project `repositoryRoot`:

- Claude: encode `repositoryRoot` with the non-alphanumeric -> `-` rule, list
  `~/.claude/projects/<encoded>/*.jsonl` (files only, skip directories),
  newest mtime first, cap at `MAX_PROVIDER_FILES = 256` stat'ed files. For
  each candidate read a bounded head and require an exact `cwd ==
  repositoryRoot` match on the first cwd-bearing line (the encoding is lossy,
  so this check is mandatory); mismatches count as `skipped` with reason
  `foreignCwd`.
- Codex: walk `~/.codex/sessions/YYYY/MM/DD` for the last
  `CODEX_SCAN_DAYS = 30` days (directory names are derived from dates, never
  from input), newest day first, cap at `MAX_PROVIDER_FILES = 256` files
  opened. Read only the first line; require `type == "session_meta"`,
  `payload.cwd == repositoryRoot`, and an allowed `source`.
- Merge both providers, sort by last activity descending, cap the response at
  `MAX_EXTERNAL_SESSION_ENTRIES = 200` with a `truncated` flag.
- Sessions whose id already appears as `provider.sessionId` on a stored
  thread for that root are still listed but flagged `alreadyImported` (the TS
  layer computes the flag; Rust does not read the thread store).

## Rust module: `agent_session_history`

New file `src-tauri/src/agent_session_history.rs` plus command facade
`src-tauri/src/lib_composition/agent_session_history_commands.rs`, mounted
with `#[path = "../agent_session_history.rs"]` inside the facade exactly like
`agent_thread_store_commands.rs` mounts `agent_thread_store.rs`; `lib.rs`
stays at its baseline. Tests in `agent_session_history_tests.rs` against
committed fixtures. Both commands run through `run_blocking_command`,
requests are `deny_unknown_fields`, responses `Serialize` only, registered in
`lib_composition/runtime.rs`.

### Commands

```text
list_external_agent_sessions { repositoryRoot }
  -> { sessions: [ExternalAgentSessionSummary], skipped: number,
       truncated: bool }

preview_external_agent_session { provider, sessionId, repositoryRoot }
  -> ExternalAgentSessionPreview
```

```rust
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSessionSummary {
    provider: ExternalSessionProvider,     // "claudeCode" | "codex"
    session_id: String,                    // UUID, validated
    cwd: String,                           // == repositoryRoot, re-echoed
    title: String,                         // bounded, may be ""
    first_prompt: String,                  // bounded excerpt, may be ""
    started_at_epoch_ms: u64,
    last_activity_epoch_ms: u64,           // file mtime
    turn_count: u32,                       // user prompts found in head scan
    turn_count_exact: bool,                // false when the head cap cut off
    file_bytes: u64,
}

#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSessionPreview {
    provider: ExternalSessionProvider,
    session_id: String,
    exchanges: Vec<ExternalSessionExchange>, // role "user" | "assistant", text
    exchanges_truncated: bool,
    total_preview_bytes: u64,
}
```

### Bounded parsing

- Head: read at most `HEAD_READ_BYTES = 256 KiB`, split on `\n`, drop a
  trailing partial line. Per line, `serde_json::from_str` into a tolerant
  internal `RawSessionLine` (a small struct of the few optional fields we
  extract; unknown line types and unknown fields inside lines are ignored by
  design because both CLIs evolve their logs, but every extracted field is
  strictly validated: closed enums, bounded UTF-8, exact cwd equality).
- Tail: read at most `TAIL_READ_BYTES = 64 KiB` from the end, discard the
  first partial line, used for preview's trailing exchanges and as timestamp
  fallback when mtime is unavailable.
- Preview: head scan + tail scan, emitting user/assistant text exchanges,
  each clipped to `MAX_AGENT_EVENT_TEXT_BYTES` (16 KiB) on a UTF-8 boundary,
  total response capped at `PREVIEW_TOTAL_BYTES = 64 KiB`, at most
  `MAX_PREVIEW_EXCHANGES = 40`; overflow sets `exchanges_truncated`.
- Claude interactive filter: a summary is emitted only when the head scan
  found at least one `typed` user prompt (legacy files without `promptSource`
  qualify with a plain-string human prompt not starting with `<`). Files with
  only `sdk`/hook prompts (Codevo's own turns, automated reviews) are
  counted in `skipped`, not listed.
- `turn_count` counts qualifying user prompts inside the head window;
  `turn_count_exact = false` when the window ended before EOF (UI renders
  `N+`). Verified fixture evidence: the committed interactive fixture has 6
  typed prompts.

### Security and validation

- Strictly read-only; no file under `~/.claude` or `~/.codex` is ever
  created, modified, or deleted.
- `repositoryRoot` must be an absolute path; the command canonicalizes it and
  requires it to match the request value (symlink alias fails closed) before
  any home-directory access. The TS gateway only ever passes admitted project
  repository roots.
- `sessionId` in `preview` is validated against
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
  (case-insensitive) before being used in any file name; the claude path is
  built as `<projects>/<encoded>/<sessionId>.jsonl`, the codex path is found
  by the bounded date walk matching `rollout-*-<sessionId>.jsonl`. No other
  request field ever reaches a path.
- All I/O happens on the blocking pool; no registry mutex is involved.

## TS domain and infrastructure

New `src/domain/externalAgentSession.ts`:

- `ExternalAgentSessionSummary`, `ExternalAgentSessionPreview`,
  `ExternalSessionExchange` readonly types mirroring the wire shapes plus
  `readonly alreadyImportedThreadId: string | null` computed in application.
- Fail-closed parsers in the `agentThreadWire.ts` style: `exactKeys`, closed
  provider enum (`claudeCode | codex` reusing `AgentCliKind`), UUID session
  id check, bounded UTF-8 text, unsigned safe integers, bounded arrays
  (`MAX_EXTERNAL_SESSION_ENTRIES`, `MAX_PREVIEW_EXCHANGES`). Unknown
  provider or malformed entry rejects the whole response (TypeError), the
  hook reports one bounded notice.

New `src/infrastructure/tauriExternalSessionIpcContract.ts` +
`tauriExternalSessionGateway.ts` following
`tauriAgentThreadStoreIpcContract.ts` / `tauriAgentThreadStoreGateway.ts`
(non-Tauri runtime returns an empty snapshot). Port added to
`src/application/agentThreadPorts.ts`:

```ts
export interface ExternalSessionGateway {
  listExternalSessions(request: { repositoryRoot: string }):
    Promise<ExternalSessionListSnapshot>;
  previewExternalSession(request: {
    provider: AgentCliKind; sessionId: string; repositoryRoot: string;
  }): Promise<ExternalAgentSessionPreview>;
}
```

## Application: `useExternalSessions`

New `src/application/useExternalSessions.ts` (focused hook, target <= 350
lines):

- Inputs: `externalSessionGateway`, `store: AgentThreadStoreSurface`,
  project authority deps (`projects`, `launchIdentityForProject`), `setNotice`.
- `open(target: { rootKey; repositoryRoot })`: captures
  `AgentProjectAuthority` before the await, loads the list once, revalidates
  owner after the await, drops stale results by monotonic request generation
  (A -> B -> A safe). No polling, no watcher; a manual `reload()` re-runs the
  same flow. `close()` clears state.
- `preview(sessionId)`: same authority capture/revalidate pattern; one
  in-flight preview, superseded requests cancelled by generation.
- Decorates each summary with `alreadyImportedThreadId` by scanning the store
  state for a thread with the same `owner.repositoryRoot`, `provider.kind`,
  and `provider.sessionId`.
- Exposes `{ state: "closed" | "loading" | "ready" | "failed", sessions,
  skipped, truncated, preview, importPending }` plus the actions.

## UI

Palette-style dialog `AgentTerminalSessionsPalette.tsx` reusing the
quick-open shell conventions of `AgentThreadSearchPalette.tsx` (input row,
listbox with roving active index, `PaletteFooter`, Escape/Arrow/Home/End
handling, `agent-menu`/palette CSS tokens):

- Row: provider glyph (`AgentProviderGlyph`), title (or first prompt when the
  session has no title), relative time (`agentClock` conventions), turn count
  (`N` or `N+`), an `Imported` badge when `alreadyImportedThreadId` is set.
- Filter input matches title + first prompt, client-side over the bounded
  list (max 200 rows; plain array filter, no virtualization needed).
- Preview pane under or beside the list renders the bounded exchanges of the
  active row, lazily fetched; truncation notes rendered truthfully
  ("Preview shows the beginning and end of a long session").
- Primary action "Continue in Codevo" (Enter); on an `Imported` row it
  selects the existing thread instead.
- Footer line reports `skipped` and `truncated` counts truthfully, e.g.
  "12 automated or foreign sessions hidden".

Entry points:

- Project gear menu: extend `AgentProjectMenuCommand` in
  `agentSidebarPresentation.ts` with `"terminalSessions"` (label
  "Terminal sessions...", History icon) handled next to the existing
  commands in the rail command bridge.
- Empty rail state: `AgentThreadList.tsx` `EmptyState` gains a link-style
  button "Import a terminal session" when the scoped project has no threads.

## Thread linkage

### Domain change

`AgentThread` gains an optional provenance field:

```ts
export interface AgentThreadExternalOrigin {
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly importedAtEpochMs: number;
}
// AgentThread: readonly externalOrigin: AgentThreadExternalOrigin | null;
```

Wire backward compatibility follows the existing pattern exactly:
`agentThreadWire.ts` adds `externalOrigin` to the optional key list of
`boundedKeys` (absent parses as `null`, like `integration` /
`viewedAtEpochMs`), serializes it back verbatim, and validates
`externalOrigin.provider === provider.kind` and
`externalOrigin.sessionId` as a session id. Rust `agent_thread_store.rs`
adds `#[serde(default)] external_origin: Option<AgentThreadExternalOrigin>`
with its own `deny_unknown_fields` struct. Old store files load unchanged;
new files loaded by an old build would fail `deny_unknown_fields`, which is
acceptable forward-versioning (same policy as every prior field addition).

### Import flow (`useAgentTurnDispatch.importExternalSession` or a small
dedicated coordinator owned by stream D)

1. Validate: project owner current for the target root, session id valid,
   provider CLI configured.
2. Duplicate check: if any stored thread for that `repositoryRoot` has
   `provider.sessionId === sessionId` and matching kind, select it, show
   "This session is already imported.", done. (This also covers ids that
   entered the store through Codevo's own turns - id collision resolves to
   selection, never a second thread.)
3. Mint a threadId, build the record with `turns: []`,
   `provider: { kind, sessionId }`,
   `target: { isolation: "in-place", worktreePath: null }`,
   `externalOrigin: { provider, sessionId, importedAtEpochMs: now }`,
   `title` from the summary (fallback `agentThreadTitle(firstPrompt)`),
   `integration: null`, `viewedAtEpochMs: now`.
4. Dispatch `threadCreated`, persist through the existing store save path,
   select the thread, close the palette. No process is spawned at import.
5. The next user prompt flows through the untouched `sendFollowUp`:
   `admitFollowUp` already accepts a settled thread with a non-null session
   id, and `runTurnStart` passes `resumeSessionId` to the spawner.

Verified feasibility of the empty-turns thread: `runningTurn` returns null,
lifecycle is `settled`, attention `settled`, unread false; the TS wire parser
(`boundedArray` has no minimum) and the Rust store (max-only check on
`turns.len()`) both accept zero turns.

Isolation is `in-place` deliberately and truthfully: the terminal session ran
at the repository root, so continuing must run there too; a worktree would
re-target the conversation's paths to a different checkout. The composer
caption for an imported thread states "Runs in the project checkout -
imported sessions continue where the terminal session ran." The in-place
turn-time safety (dirty-tree preflight, cwd exclusivity in Rust admission)
already applies on the follow-up path.

The imported provenance note ("Imported from terminal session <id>") is
rendered by `AgentThreadSession` as a system-note row derived from
`thread.externalOrigin`, and the thread header/row show an "Imported" badge.
Deviation from the original directive: the note is presentation derived from
the persisted `externalOrigin`, not a synthetic persisted turn event -
one source of truth, no fake event in the closed `AgentTurnEvent` union, and
the note survives every reload by construction.

## Failure modes

| Failure | Behaviour |
|---|---|
| `~/.claude/projects/<encoded>` missing | Empty claude list, zero skipped; not an error. |
| Session file unreadable / permission denied | Counted in `skipped`; listing continues. |
| Malformed JSON line inside a session file | Line ignored; if no qualifying metadata is found within the head cap the file counts as `skipped`. |
| Huge session file (this machine has a 13 MB live one) | Head/tail caps bound all reads; `turn_count_exact = false`; preview marks truncation. |
| Session cwd differs from the project root (encoded-name collision) | Excluded, `skipped` reason `foreignCwd`; never listed for the wrong project. |
| Session id fails UUID validation | Request rejected (preview) or file skipped (listing); id never reaches argv or a path. |
| Resume rejected by the CLI (session pruned, too-old binary) | Follow-up turn exits non-zero; existing failure path renders stderr `unknownLine` events; notice "The agent CLI rejected the resume request." Thread and note remain; user can retry or start a new thread. |
| Session deleted between listing and import | Import still succeeds (it needs only id + title); the first follow-up surfaces the CLI's resume error as above. |
| Id collision with an existing thread | Duplicate check selects the existing thread; no second thread is created. |
| Store full / save rejected | Existing store-full notice; no thread appears. |
| Project released / owner generation changes mid-flight | Captured authority fails revalidation; results dropped fail-closed. |
| Palette opened for an untrusted or closed project | Gear entry disabled; the hook refuses to load without a current owner. |

## Performance

- Listing does bounded I/O only: <= 256 stat calls plus <= 256 KiB head read
  per candidate file per provider, on the Rust blocking pool; the UI thread
  renders at most 200 rows with no virtualization needed.
- Load happens on palette open only; no polling, no filesystem watcher.
- Preview is one bounded head+tail read for one file on demand.
- Measure before merge: listing latency on this machine's real data
  (34 editor claude sessions incl. a 13 MB file; 1038 codex files, 30-day
  window) - target < 150 ms off the UI thread; add a Rust test asserting
  read amount stays within caps for an adversarial oversized fixture.

## Testing plan

Fixtures captured 2026-09-01 into the session scratchpad (real, unredacted,
kept out of the repo):

```text
/private/tmp/claude-501/-Users-matusmockor-Developer-editor/a42f7bfd-b90d-48ff-a523-8dc2d517ba75/scratchpad/import-fixtures/
  claude-interactive-typed.jsonl   (real interactive session, 6 typed prompts, 331 KB)
  claude-print-mode-smoke.jsonl    (claude -p + --resume, sdk promptSource, 107 KB)
  codex-tui-interactive.jsonl      (originator codex-tui, source cli, 448 KB)
  codex-exec-smoke.jsonl           (codex exec + resume, source exec, 114 KB)
```

Committed fixtures must be synthetic or trimmed excerpts of these with
absolute paths scrubbed to `/repo` and prompts shortened; keep each under
16 KiB. Cover: typed vs sdk claude files, metadata-first heads
(`last-prompt`/`mode` before any timestamped line), `<command-name>` and
`isMeta` user lines, codex session_meta for all four provenance shapes
(exec, cli, vscode, subagent object), a file with a partial trailing line,
and an oversize synthetic file exceeding the head cap.

- Rust (`agent_session_history_tests.rs`): encoding function (slash, dot,
  underscore, dashes preserved); cwd-mismatch exclusion; provenance
  filtering fail-closed on unknown source; head/tail caps respected (assert
  bytes read); turn count exactness flag; preview truncation; UUID
  rejection; `deny_unknown_fields` request rejection; unreadable file
  counted skipped; date-window walk bounds.
- TS domain: parser accepts the valid wire snapshot, rejects unknown keys,
  unknown provider, oversized arrays, malformed ids;
  `agentThreadWire` round-trips `externalOrigin` and parses legacy threads
  without it; provider/kind mismatch rejected.
- Application (`act`/`waitFor`): open loads once and never polls; A -> B -> A
  generation change drops the late result; `alreadyImportedThreadId`
  decoration; import creates+persists+selects; duplicate import selects the
  existing thread; owner loss mid-import fails closed; empty-turns thread
  accepts a follow-up dispatch with `resumeSessionId` equal to the external
  id (assert argv through the existing spawner contract test double).
- Components: palette rows (glyph, relative time, `N+` count, Imported
  badge), filter, preview pane truncation note, gear menu entry, empty-state
  link, imported provenance note in `AgentThreadSession`.
- Gates: full repository gate list from `CLAUDE.md` (npm check/lint/build/
  size:hotspots/format/test, cargo check/test/fmt/clippy, `git diff --check`).

## Implementation streams (disjoint ownership)

- S0 (sequential, first) - contracts: `src/domain/externalAgentSession.ts`
  (types + parser skeleton), `externalOrigin` in `src/domain/agentThread.ts`
  + `agentThreadWire.ts`, port additions in
  `src/application/agentThreadPorts.ts`, Rust wire structs +
  `external_origin` serde field in `agent_thread_store.rs`, command names.
- A - Rust history module: `agent_session_history.rs`,
  `lib_composition/agent_session_history_commands.rs`, runtime.rs
  registration, Rust fixtures + tests. Forbidden: TS files.
- B - TS gateway + hook: `tauriExternalSessionIpcContract.ts`,
  `tauriExternalSessionGateway.ts`, `useExternalSessions.ts`,
  `workbenchDefaultGateways.ts` wiring, hook tests. Forbidden: components,
  Rust, dispatch.
- C - UI: `AgentTerminalSessionsPalette.tsx` + CSS,
  `agentSidebarPresentation.ts` menu command, `AgentThreadList.tsx` empty
  state, `AgentThreadSession` provenance note, badge presentation, component
  tests. Forbidden: application hooks other than props wiring, Rust.
- D - linkage + dispatch: import coordinator on top of
  `useAgentTurnDispatch`/`useAgentThreads` surface, duplicate selection,
  composer caption for imported threads, `AgentModeView` palette hosting and
  command bridge wiring, flow tests. Forbidden: parser internals, Rust.
- E - independent read-only adversarial review after A-D land, then lead runs
  full gates and integrates.

A depends only on S0; B/C/D depend on S0 and integrate through the lead; C
and D share no files (palette hosting lives in D's `AgentModeView` change,
palette component in C).
