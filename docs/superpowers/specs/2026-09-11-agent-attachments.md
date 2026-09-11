# Agent composer: image and file attachments

Date: 2026-09-11 - Status: proposed - Base: `main` @ df1d0bec

## 0. Behaviour rule

Anything pasted, dropped or picked into the composer is either attached as an image
(gif, jpeg, png, webp; HEIC converted when the webview can decode it) or inserted into
the prompt as one absolute-path line, never silently ignored and never sent partially.

Reference behaviour: cmux (drop anything, unattachable files become a path line) and
T3 Code (`apps/server/src/provider/Layers/ProviderService.ts:1554-1590` appends
`[Attached <type> "<name>" is saved at: <path>]` for every attachment; images
additionally go natively). This spec maps that onto our `claude -p` and `codex exec`
process transports.

### 0.1 Ingress classification (webview, pure domain function)

`classifyAgentAttachmentCandidate({ name, mime, hasPath, bytes })` in
`src/domain/agentAttachment.ts`, applied in this order, first match wins:

1. `mime` is `image/heic` or `image/heif`, or `mime` is empty or
   `application/octet-stream` and the name ends `.heic`/`.heif` -> `image` (HEIC).
2. `mime` is empty or `application/octet-stream` and the extension is
   gif/jpg/jpeg/png/webp -> `image` with the mime inferred from the extension.
3. `mime` is in the supported image set -> `image`.
4. everything else (other `image/*` such as svg, bmp, tiff; video; archives; text) ->
   `path` (deviation from T3, which reports "unsupported image" as an error: cmux and the
   owner want a path line instead, so unsupported images are ordinary files here).

Then by origin:

- `path` with an on-disk origin (drop, picker) -> `reference` attachment: no copy, the
  original absolute path is used in the line.
- `path` without an origin (paste of file bytes) -> `file` attachment: bytes are staged
  into the store (cap 50 MiB) and the store path is used in the line.
- `image` -> always staged into the store after the shrink pipeline (section 1).

### 0.2 Paste-claiming rule (T3, verbatim)

On `paste`, with `files = clipboardData.files` and `plainText = getData("text/plain")`:

1. if any file classifies as `image` -> claim: `preventDefault()`, attach every file
   (images as images, the rest as `file`);
2. else if `plainText.length > 0` -> do not claim, the default text paste runs and the
   files are ignored;
3. else if any file exists -> claim and attach every file as `file`.

Capacity and staging failures never block the claim decision; they are reported by the
attachment coordinator after the paste (T3's stated rationale: a gate here swallows the
paste with no feedback).

### 0.3 Prompt line format and placement

Exact formats, one line per attachment, composer order, joined by `\n`:

```text
[Attached image "<name>" is saved at: <storedPath>]
[Attached file "<name>" is saved at: <storedPath>]
[Attached file "<name>" is at: <path>]            (reference only)
```

`name` is the sanitised display name (section 2). The effective prompt is
`text + "\n\n" + lines` when text is non-empty, else `lines` alone; a turn with only
attachments and no text is allowed. The effective prompt is what the composer counts,
what `AgentTurn.prompt` persists, what the transcript renders and copies, and what the
spawner receives. `MAX_AGENT_PROMPT_BYTES` (32 KiB, `agent_task_spawner.rs:15`) applies
to the effective prompt unchanged; the composer counter includes each line at its
final length (the claim step below returns the exact line), and Send is disabled with
the existing "prompt too long" reason rather than dropping lines (deviation from T3,
which silently skips lines over its cap - that presents partial data as complete).
`launch.prompt()` (ultrathink prefix) applies to the effective prompt as today.

## 1. Limits

| Limit | Value | At the limit |
| --- | --- | --- |
| `MAX_AGENT_TURN_ATTACHMENTS` | 8 | 9th add refused: "Up to 8 attachments per message." |
| `MAX_AGENT_IMAGE_BYTES` (wire, per image) | 10 MiB | shrink pipeline; if still over -> refused "Image cannot be shrunk to 10 MiB." |
| `MAX_AGENT_IMAGE_SOURCE_BYTES` (decode guard) | 50 MiB | not decoded; path-backed -> becomes `reference` with notice "Too large to attach as an image, inserted as a path"; pasted -> refused |
| `MAX_AGENT_FILE_BYTES` (staged generic, paste only) | 50 MiB | refused "File is larger than 50 MiB." |
| `MAX_AGENT_TURN_IMAGE_BYTES` (aggregate per turn) | 40 MiB | add refused: "Images in this message exceed 40 MiB." (not in T3: our Claude transport is one JSON line on a pipe, section 4) |
| image dimensions | 1..=16384 px each | outside -> refused as undecodable |
| name | 1..=255 bytes | longer names truncated to 255 bytes on a char boundary, shown truncated |
| reference path | absolute, <= 4096 bytes | else refused "Path is not attachable." |
| pending lifetime | 24 h | swept at store open and on every stage call, bounded 512 entries per sweep |

Shrink pipeline (`src/domain/agentImageShrink.ts`, runs in the webview off the React
render path via `createImageBitmap` + `OffscreenCanvas`, T3 `imageCompression.ts`):
pass-through when already <= 10 MiB and supported; otherwise longest edge 2048, then
quality 0.92 / 0.85 / 0.78 / 0.68 in webp (jpeg when webp encoding is unavailable, white
matte), then extra scale passes 0.75 / 0.55; refuse "unreadable" when decoding or every
encode throws, "too-large" when every pass overflows. Re-encoded names get the matching
`.webp`/`.jpg` extension. HEIC: native `createImageBitmap` only; when the platform
webview cannot decode it (Linux WebKitGTK), the file becomes a `reference` with the
notice above (deviation from T3's bundled `heic-to` wasm decoder: no new dependency,
truthful fallback).

The CLI is never pre-judged: whatever `claude` or `codex` prints when it rejects an image
(size, format, count) reaches the transcript verbatim through the existing stderr/unknown
line events and fails the turn the same way any other CLI error does.

## 2. Domain contract

`src/domain/agentAttachment.ts` (new, pure):

```ts
export type AgentImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type AgentAttachment =
  | { readonly kind: "image"; readonly attachmentId: string; readonly name: string;
      readonly mime: AgentImageMime; readonly bytes: number; readonly width: number;
      readonly height: number; readonly storedPath: string }
  | { readonly kind: "file"; readonly attachmentId: string; readonly name: string;
      readonly bytes: number; readonly storedPath: string }
  | { readonly kind: "reference"; readonly name: string; readonly path: string;
      readonly bytes: number };
```

- `attachmentId`: 32 lowercase hex chars (UUID v4 without dashes), minted by Rust only.
- `name`: 1..=255 bytes, no `/`, `\`, NUL or C0 controls, `"` replaced by `'`
  (`sanitizeAgentAttachmentName`), so the prompt line is unambiguous.
- `bytes`: safe non-negative integer within the kind's cap; `width`/`height` 1..=16384.
- `storedPath` and `path`: absolute, <= 4096 bytes. `storedPath` is store-owned display
  data: the transport never opens it, it re-resolves the id (section 3).
- `agentAttachmentPromptLine(attachment)` produces the section 0.3 line;
  `agentEffectivePrompt(text, attachments)` joins them; both have exhaustive `never`
  checks and tests for every kind.

`AgentTurn` (`src/domain/agentThread.ts:118`) gains `readonly attachments?:
ReadonlyArray<AgentAttachment>` as the last field. `agentThreadWire.ts` `serializeTurn`
emits `attachments` only when present and non-empty (`optionalField`), `parseTurn` adds
`"attachments"` to its optional-key allowlist and parses each entry through
`parseAgentAttachment(value, path)` (closed `kind`, unknown keys rejected, bounds above,
fail closed). Every existing fixture in `agentThreadWire.test.ts` must re-serialise
byte-for-byte; a new round-trip fixture carries one of each kind.

Rust mirror in `src-tauri/src/agent_thread_store.rs`, identical field order:

```rust
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentAttachment { Image { attachment_id, name, mime: AgentImageMime, bytes: u64,
  width: u32, height: u32, stored_path: String }, File { attachment_id, name, bytes, stored_path },
  Reference { name, path: String, bytes: u64 } }
// on AgentTurn, after cli_version:
#[serde(default, skip_serializing_if = "Vec::is_empty")] pub attachments: Vec<AgentAttachment>,
```

`validate_agent_turn` enforces the same bounds; the existing store round-trip and
"legacy document unchanged" tests gain the attachment cases, and a shared JSON fixture
(`src/domain/fixtures/agent-thread-with-attachments.json`) is asserted from both sides,
as the subagent-telemetry slice did.

`StartAgentTaskRequest` (`src/domain/agentTask.ts:50`, Rust
`agent_task_commands.rs:72`) gains `threadId: string` and `attachments:
ReadonlyArray<{ kind: "staged"; attachmentId } | { kind: "reference"; name; path }>`
(max 8, in prompt order). `StartAgentTaskResult` is unchanged.

## 3. Storage

Root: `app.path().app_data_dir()/agent-attachments/` (sibling of `agent-threads/`,
created with the existing `create_private_directory`, 0700; files 0600 via
`create_private_file`, `create_new`, written as `<id>.part` then renamed, `fsync`ed).

```text
agent-attachments/pending/<attachmentId>.<ext>          staged, unclaimed (24 h)
agent-attachments/threads/<threadId>/<attachmentId>.<ext>   claimed by a turn
```

- `ext` allowlist: images `png|jpg|gif|webp` derived from the verified mime (never from
  the name); staged files keep their extension when it matches `^[a-z0-9]{1,10}$` and
  is not `part`, else `bin`. Ids and thread ids are validated by pattern before any path
  is built, then the joined path is canonicalised and must start with the canonical root
  plus separator (T3 `attachmentPaths.ts`); files are opened `O_NOFOLLOW`, `fstat`
  must report a regular file whose size equals the recorded `bytes`. The webview never
  supplies a path to resolve; it supplies ids.
- Lifecycle: `stage` (pending, owned by `workspaceId` in the in-memory
  `AgentAttachmentRegistry`, cap 64 pending globally, 32 per workspace) -> `claim`
  (rename into `threads/<threadId>/`, all-or-nothing with rename-back compensation) ->
  referenced by the persisted turn -> deleted with `delete_agent_thread` (directory
  removed after the thread file). `release` deletes a pending file explicitly (composer
  remove). Sweeps: pending older than 24 h, `.part` older than 1 h, and
  `threads/<threadId>/` directories whose thread file does not exist and mtime > 24 h
  (orphans from rejected starts).
- Registry entries do not survive restart, so pending files from a previous process are
  unclaimable and are swept; composer drafts do not carry attachments across restarts.

Bytes over IPC: Tauri 2 raw bodies, not base64 JSON. `stage_agent_attachment_bytes`
receives `tauri::ipc::Request` with the binary body and a JSON header
`{ workspaceId, kind, name, mime, width, height }` (deny unknown fields); reads return
`tauri::ipc::Response::new(Vec<u8>)` (ArrayBuffer in TS). Base64 in JSON would cost
+33% and a 13 MiB string copy through serde per image; raw bodies cost one copy.
Path-backed generic files never pass through the webview at all (`reference`), and
path-backed images at or under 10 MiB are staged by `stage_agent_attachment_from_path`
(Rust copies from the opened fd, `O_NOFOLLOW`, regular file, size re-checked after
the copy); only path-backed images over 10 MiB or HEIC are read into the webview
(`read_agent_attachment_candidate`, guard 50 MiB) for the shrink pipeline. Rust verifies
the magic bytes of every staged image against the declared mime (png/jpeg/gif/webp
signatures) and refuses mismatches.

Commands (`src-tauri/src/lib_composition/agent_attachment_commands.rs`, thin facades
over `spawn_blocking`, registered in `lib.rs`): `stage_agent_attachment_bytes`,
`stage_agent_attachment_from_path`, `inspect_agent_attachment_candidate` (path ->
`{ bytes, isRegularFile, extensionMime }`), `read_agent_attachment_candidate`,
`claim_agent_attachments`, `release_agent_attachment`, `read_agent_attachment`
(`{ workspaceId, threadId, attachmentId }` -> bytes, for thumbnails),
`reveal_agent_attachment` (opens the resolved file with `tauri_plugin_opener`). Every
command takes `workspaceId`, checks the registered workspace like `agent_task_commands`
does, and the candidate/read/reveal paths pass through the same trust gate as agent
task starts. Stage results: `{ attachmentId, name, mime?, bytes, width?, height?,
promptLineBytesMax }`, claim results: `{ attachmentId, storedPath, promptLine }`.

## 4. Transport per provider behind one port

Application port `AgentAttachmentGateway` (`src/application/agentAttachmentPorts.ts`)
covers stage/release/claim/read/reveal; the existing `AgentTaskGateway` carries the
attachment references on start. In Rust the spawn plan gains

```rust
pub enum AgentPromptTransport { Argv(String), Stdin(Vec<u8>) }
pub struct AgentTaskSpawnPlan { ..., prompt: AgentPromptTransport, attachment_paths: Vec<PathBuf> }
```

built by `agent_invocation_args` from the validated request: ids are re-resolved in
`threads/<threadId>/` (containment, size, magic bytes) immediately before the plan is
built, and for every staged attachment the exact section 0.3 line must occur in the
prompt as a whole line, else the start is rejected with the definite
"Agent prompt does not match its attachments." (the client cannot forge a path line).

Codex: `["exec", "--json", "--skip-git-repo-check", <model>, <mode>, <effort>, <settings>,
"-i", <resolved image path>, ... , "--", <prompt>]` and for resume `["exec", "resume",
"--json", "--skip-git-repo-check", ..., "-i", <path>, ..., <sessionId>, "--", <prompt>]`;
the new `attachment_args(&attachment_paths)` group goes after `settings_args()` and before
the session id. Paths are the store's resolved paths, never user paths. Generic files and
references contribute nothing to argv. Prompt stays positional; stdin stays `null`.

Claude: argv becomes `["-p", "--output-format", "stream-json", "--verbose",
"--input-format", "stream-json", <model>, <mode>, <effort>, <settings>, ["--resume", id]]`
for every Claude turn (with or without images): no `--`, no positional prompt. The prompt
travels as one stdin line, then stdin is closed:

```json
{"type":"user","message":{"role":"user","content":[
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}},
  {"type":"text","text":"<effective prompt>"}]}}
```

Text block last (T3 `ClaudeAdapter.ts`: the CLI treats the last text block as the
prompt). `StdAgentProcessSpawner` sets `Stdio::piped()` for `Stdin` plans and a
dedicated writer thread writes the frame with a 30 s deadline and ignores EPIPE (the
child's own stderr explains an early exit); the plan holds the frame bytes, so the
supervisor, `AgentChild` seam and process-group ownership are unchanged. One transport
for all Claude turns also removes the prompt from `ps` output.

Tests: the Claude argv table (`claude_argv_table_covers_every_model_mode_and_resume_combination`)
keeps every model/mode/effort/resume row and asserts both the new argv and the exact
stdin frame bytes per row; the Codex table gains rows with 0, 1 and 8 images asserting
`-i` placement for fresh and resumed invocations; the byte-for-byte fixtures from the
probes (section 5) are asserted against the frame builder.

## 5. Mandated probes (gate before any implementation stream starts)

Run against the installed CLIs, scripts in the session scratchpad, only fixtures committed:

1. Claude: `claude -p --output-format stream-json --verbose --input-format stream-json
   --model <x> --permission-mode <y>` with the frame above on stdin (one 200 KB png),
   stdin closed after the line; repeat with `--resume <id>` on the resulting session and
   with the ultrathink prefix. Must prove: the image is seen (ask "what colour is the
   square"), the process exits after `result` on stdin EOF, and `--resume` accepts the
   frame. Capture stdout to `src/domain/agentOutput/fixtures/claude-image-turn.jsonl`
   and the exact frame to `src/domain/agentOutput/fixtures/claude-image-turn.input.jsonl`.
2. Codex: `codex exec --json --skip-git-repo-check -i <png> -- "<prompt>"` and
   `codex exec resume --json --skip-git-repo-check -i <png> <sessionId> -- "<prompt>"`.
   Must prove `-i` is accepted by `resume` and the image is seen. Capture to
   `src/domain/agentOutput/fixtures/codex-image-turn.jsonl` and
   `codex-image-resume-turn.jsonl`.

If a probe fails, the spec is amended (for Claude a fallback is `--input-format` only on
image turns; for Codex resume, images become path lines on resumed threads) and the
result is reported to the owner before implementation begins.

## 6. Rendering

Composer (`AgentComposer.tsx`, new `AgentComposerAttachments.tsx`,
`useAgentComposerAttachments.ts`, `agentComposer.css`): a strip above the textarea with
56 px thumbnails (`object-fit: cover`, `--agent-radius-md`) for images and chips (icon,
name, size) for `file`/`reference`; each has a remove button (releases pending files);
states `staging` (spinner, Send disabled), `ready`, `failed` (reason inline, must be
removed before Send). A drop ring on the composer while a native drag is over it
(`getCurrentWebview().onDragDropEvent`, position hit-tested against the composer
bounds); an attach button in the controls row opens `@tauri-apps/plugin-dialog`
`open({ multiple: true })`. Keyboard: paste as section 0.2, Backspace on an empty
textarea with the last attachment focused removes it.

Transcript (`AgentTurnParts.tsx` `AgentTurnPrompt`, `agentThread.css`): the prompt text
renders as today (path lines included, so search and copy see them); below it, images
in a wrapping grid bounded to 320 x 240 px (`object-fit: contain`, `--agent-radius-lg`),
click -> `reveal_agent_attachment`; `file`/`reference` as chips with the name. Thumbnail
bytes come from `read_agent_attachment` through an application-layer LRU
(`useAgentAttachmentImages`, 24 entries / 64 MiB, blob URLs revoked on eviction and on
workspace generation change). A missing or unreadable file renders a "Image unavailable"
chip, never a broken image. Copy of the prompt copies the effective prompt only.

Imported turns: `agentImportedTurns` and `AgentImportedHistory` render the same
`AgentTurnAttachments` component from `ExternalSessionExchange.attachments`
(new optional `ReadonlyArray<{ kind: "image"; mime } | { kind: "file"; name }>`), which
the Rust readers derive from Claude `image` content blocks and from section 0.3 lines
in Codex/Claude user text (`agent_session_history.rs` `claude_exchange` /
`codex_exchange`, bounded 8 per exchange). Imported images render as an "Image (from
session file)" chip in this slice; the bytes stay in the session file. Both readers and
`AgentThreadExternalExchange` (store) get the field with the same omit-when-empty rule.

CSS: tokens only, no `border`/`border-color`, radii through `--agent-radius-*` (8/10/12/14);
`agentThreadStyles.test.ts` and `agentModeTokens.test.ts` gain the new selectors.

## 7. Isolation and failure paths

- Every staged draft attachment records `{ workspaceId, rootKey, ownerGeneration }`
  captured before the stage call and revalidated after it; A -> B -> A produces a new
  generation, so `admitStart`/`admitFollowUp` drop attachments whose generation differs,
  release them, and show "Attachments from a previous workspace session were discarded".
  Rust independently refuses claims whose registry `workspaceId` differs.
- Claim happens in `useAgentTurnDispatch` after admission and before `startAgentTask`;
  authority is rechecked after the claim await; a stale result stops the task if one was
  started (existing pattern at lines 433-470) and the claimed files are deleted with the
  thread they belong to.
- Cancelled or stopped turn: files stay claimed under the thread (the turn record exists).
- Start rejected after claim: the failed turn keeps its attachments; a thread that was
  never persisted leaves an orphan directory the sweep removes after 24 h.
- Disk full / unwritable: stage returns "Unable to save the attachment: <io error>",
  the `.part` file is removed, the chip shows `failed`.
- Unreadable file, symlink, non-regular file, size change between inspect and copy:
  refused with a definite message; nothing is staged.
- Unsupported type is never an error: it becomes `reference`/`file` (section 0.1).
- Over caps: messages from section 1; the message never sends partially.
- Attachment missing at start (swept, deleted): definite "Attachment is no longer
  available. Remove it and try again." and the turn is not created.
- Imported thread receives a follow-up with attachments: the thread id exists, so the
  path is the same as a live thread.

## 8. Streams, ownership, tests, QA

Ordering: probes (section 5) -> S1, S2, S3 in parallel -> S4 -> S5 and S6 in parallel ->
read-only adversarial review by a different agent -> full gates.

| Stream | Owns (write) | Forbidden |
| --- | --- | --- |
| S1 domain + wire (TS) | `src/domain/agentAttachment.ts` (+test), `agentThread.ts`, `agentThreadWire.ts` (+test), `agentTask.ts` (+test), `src/domain/fixtures/agent-thread-with-attachments.json` | everything under `src-tauri`, `src/components`, `src/application` |
| S2 Rust store | `src-tauri/src/agent_attachment_store.rs` (new), `agent_thread_store.rs`, `lib_composition/agent_attachment_commands.rs` (new), `lib.rs` (registration only) | `agent_task_spawner.rs`, `agent_task_commands.rs`, `agent_task_supervisor.rs` |
| S3 Rust transport | `agent_task_spawner.rs`, `agent_task_supervisor.rs`, `lib_composition/agent_task_commands.rs`, `agent_launch.rs` (only if `attachment_args` lands there) | `lib.rs`, store files, all TS |
| S4 application + gateway | `src/application/agentAttachmentPorts.ts`, `useAgentComposerAttachments.ts`, `useAgentAttachmentImages.ts`, `useAgentTurnDispatch.ts`, `agentThreadPorts.ts`, `src/infrastructure/tauriAgentAttachmentGateway.ts` (+ ipc contract, tests), `tauriAgentTaskIpcContract.ts` | `src/components`, `src-tauri` |
| S5 UI | `AgentComposer.tsx`, `AgentComposerAttachments.tsx` (new), `AgentTurnParts.tsx`, `AgentTurnAttachments.tsx` (new), `agentComposer.css`, `agentThread.css`, their tests, style contract tests | `src/application`, `src/domain`, `src-tauri` |
| S6 imported parity | `src-tauri/src/agent_session_history.rs`, `src/domain/externalAgentSession.ts`, `agentImportedPresentation.ts`, `AgentImportedHistory.tsx` (+tests) | everything else |

Test plan:

- Domain: classification table (every rule in 0.1 including empty mime + extension),
  paste-claiming table (0.2), prompt line and effective prompt for each kind, name
  sanitisation, byte counting against `MAX_AGENT_PROMPT_BYTES`, shrink pipeline
  outcomes with stubbed canvas (pass-through, ladder, scale fallback, unreadable).
- Wire: TS and Rust round-trip on the shared fixture; legacy documents unchanged;
  unknown `kind` and unknown field rejected; over-bound `bytes`/`width` rejected.
- Store (Rust): containment (`..`, absolute, symlink, foreign thread id), magic byte
  mismatch, claim compensation on partial failure, wrong-workspace claim, sweep
  boundaries, delete-with-thread, 0600/0700 modes.
- Spawner: argv tables per section 4; stdin frame bytes equal the probe fixture;
  missing attachment, forged line and cap overflow rejected; writer EPIPE tolerated.
- Gateway/application: A -> B -> A drops stale attachments; claim result with a stale
  generation stops the started task; LRU eviction revokes blob URLs; failed stage keeps
  Send disabled.
- UI: paste with image + text claims, text-only paste passes through, drop over and
  outside the composer, picker path, remove releases, transcript renders image, file,
  reference, unavailable; imported exchange with attachments renders chips; copy text
  equals the effective prompt.

Manual QA checklist for the owner:

1. Cmd+Shift+4 screenshot to clipboard, Cmd+V in the composer: thumbnail appears; send
   to Claude and to Codex; the reply describes the screenshot; transcript shows it inline.
2. Drop a 30 MB png: thumbnail appears after shrinking; the sent size shown is <= 10 MiB.
3. Drop an `.mp4`: chip appears; the prompt gains `[Attached file "x.mp4" is at: /...]`.
4. Pick a `.pdf` with the attach button: chip and a path line; the agent can read it.
5. Paste text while the clipboard also has a file: text pastes, nothing is attached.
6. Add 9 images: the 9th is refused with the message from section 1.
7. Send, then open a second project tab and return: the earlier thread still shows its
   images; a draft with attachments started before the switch reports the discard notice.
8. Delete the thread: its `agent-attachments/threads/<id>` directory is gone.
9. Follow-up on a resumed Claude thread and on a resumed Codex thread with an image.
10. Import a Claude session that contained an image: the imported turn shows the chip.

## 9. Open questions for the owner

1. Composer drafts with attachments across app restart: pending files are swept and the
   draft loses them (this spec). Should drafts persist attachments instead?
2. Imported Claude sessions: should import materialise base64 images into the thread's
   attachment directory so they render inline (bounded 8 per exchange, 10 MiB each), or
   is the chip enough?
3. Reference attachments keep the user's original path (cmux behaviour) rather than a
   store copy (T3 behaviour). Confirm that a moved or deleted source going stale in old
   threads is acceptable.
4. Should the attach button also be exposed as a slash command / hotkey in
   `agentComposerCommand.ts`, and which key?

## Resolved open questions (2026-09-11, from T3 Code source and cmux behaviour)

1. Draft persistence: pending attachments live in the store and survive a restart; a draft whose bytes never finished staging is dropped on hydration, as T3 does with unfinished uploads. Unclaimed pending files expire after 24 h.
2. Imported sessions: chips with the file name only. Inline pixels are shown only when the exchange carries a path that resolves inside the attachments store; nothing is fetched or copied to make that true.
3. Stale reference path: the composer checks existence at send time and shows a visible "missing" state on the chip, but still sends the path line - the agent reports what it finds, which matches cmux.
4. Attach hotkey: none. Paste, drop and the picker button are the three entry points, as in T3.
