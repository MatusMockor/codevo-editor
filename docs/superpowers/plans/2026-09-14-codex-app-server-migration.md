# Codex App-Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Codex turns through a long-lived `codex app-server` host per repository root instead of one `codex exec` process per turn, keeping every supervisor, admission and UI guarantee, and gaining subagent telemetry, steering and queued turns.

**Architecture:** A `CodexAppServerHostRegistry` owns one host process per repository root behind a JSON-RPC NDJSON transport with bounded queues and deadlines. Each Codex turn is a `CodexTurnChild` implementing `AgentChild` with `SharedSession` ownership, fed by a projection that rewrites app-server frames into a closed `CodexTurnEvent` NDJSON union, so the existing supervisor and frontend pipeline stay untouched. A third parser strategy decodes that union in TS.

**Tech Stack:** Rust (std process, threads, serde), codex-cli 0.154 app-server protocol (schema generated with `codex app-server generate-json-schema --out <dir>`), TypeScript parsers and domain.

**Spec:** `docs/superpowers/specs/2026-09-09-codex-app-server-transport.md` (sections 2 to 12; section 12 adds steering). Line references there predate the attachment work; re-derive from `main`.

## Global Constraints

- Everything in the steering plan's Global Constraints applies.
- Bounds (spec sections 2 and 3): `MAX_CODEX_APP_SERVER_HOSTS = 4`, `CODEX_HOST_IDLE_SHUTDOWN = 300 s`, `CODEX_HOST_START_TIMEOUT = 20 s`, `MAX_APP_SERVER_LINE_BYTES = 1 MiB` (fatal), writer queue 64 (full is fatal), per-turn inbound queue 4096, deadlines initialize 20 s, thread start/resume 30 s, turn start 30 s, turn interrupt 10 s, `MAX_SUBAGENT_THREADS_PER_TURN = 32`, unknown frames projected at most 8 per turn.
- `deny_unknown_fields` on client-authored params and on JSON-RPC envelopes; forward-compatible (`Option` + `default`) on server payloads; closed server unions carry an `Unrecognized { tag }` arm.
- A turn never signals the host's process group; `AgentTaskProcessOwnership::SharedSession` routes escalation to `force_kill()` only.
- Approvals fail closed: every approval, permission, user-input and elicitation request is answered with the declining variant and projected once as a bounded error naming the mode (interactive approvals are a later slice).
- Transport selection `codexTransport: "appServer" | "exec"` (default `appServer`), `codexAppServerArgs` bounded (16 args, 256 bytes each, ASCII printable, no `--listen`, `--code-mode-host`, `--strict-config`, NUL or newline).
- `lib.rs` stays a composition root; new modules register under `lib_composition` like `agent_attachment_paths.rs`.

---

### Task A: Protocol types (`codex_app_server_protocol.rs`)

**Files:** Create `src-tauri/src/codex_app_server_protocol.rs`, `src-tauri/src/codex_app_server_protocol_tests.rs`; fixtures under `src-tauri/tests/fixtures/codex_app_server/` copied from the generated schema directory (keep only the files the types cover).

**Interfaces (produced):**
```rust
pub enum ClientMethod { Initialize, ThreadStart, ThreadResume, TurnStart, TurnSteer, TurnInterrupt, ThreadUnsubscribe }
pub struct JsonRpcRequest { pub id: u64, pub method: ClientMethod, pub params: serde_json::Value }
pub enum JsonRpcIncoming { Response { id: u64, result: Value }, Error { id: u64, error: JsonRpcError }, Notification { method: String, params: Value }, ServerRequest { id: Value, method: String, params: Value } }
pub struct InitializeParams { ... } pub struct ThreadStartParams { cwd, model: Option<String>, sandbox: SandboxPolicy, approval_policy: ApprovalPolicy, .. }
pub struct ThreadResumeParams { thread_id, cwd, .. , exclude_turns: bool }
pub struct TurnStartParams { thread_id, input: Vec<UserInput>, cwd: Option<String>, sandbox_policy: Option<SandboxPolicy>, approval_policy: Option<ApprovalPolicy>, model: Option<String>, client_user_message_id: Option<String> }
pub struct TurnSteerParams { thread_id, expected_turn_id, input: Vec<UserInput>, client_user_message_id: Option<String> }
pub struct TurnInterruptParams { thread_id, turn_id }
pub enum UserInput { Text { text: String }, LocalImage { path: String }, Unrecognized { tag: String } }
pub enum ServerNotification { ThreadStarted(..), TurnStarted(..), TurnCompleted(..), ItemStarted(..), ItemCompleted(..), ThreadTokenUsageUpdated(..), ThreadCompacted(..), ThreadQueueChanged { thread_id }, Error(..), Ignored { method: String }, Unknown { method: String } }
pub enum ThreadItem { AgentMessage{..}, Reasoning{..}, CommandExecution{..}, FileChange{..}, McpToolCall{..}, WebSearch{..}, SubAgentActivity{..}, Unrecognized { tag: String } }
pub enum CodexRpcErrorKind { ActiveTurnNotSteerable, Other }
pub fn classify_error(error: &JsonRpcError) -> CodexRpcErrorKind;
```
- [ ] Tests: every `ThreadItem` tag in the schema either decodes to a variant or to `Unrecognized`; server payloads with extra fields decode; client params reject unknown fields; envelope with a missing `jsonrpc` field is an error; `activeTurnNotSteerable` classifies; round-trip of each client params struct.
- [ ] Implement; `cargo test --lib codex_app_server_protocol`; clippy; fmt; commit `feat(codex): type the app-server protocol`.

### Task B: Transport and host (`codex_app_server_transport.rs`, `codex_app_server_host.rs`)

**Files:** Create both modules + `_tests.rs`; a fake app-server test binary under `src-tauri/tests/bin/fake_codex_app_server.rs` (scripted from a JSONL fixture and fault flags via env).

**Interfaces (produced):**
```rust
pub struct CodexAppServerTransport; // reader + writer threads, bounded channels
impl CodexAppServerTransport { pub fn spawn(child: Child) -> Result<Self, String>; pub fn request(&self, method: ClientMethod, params: Value, deadline: Duration) -> Result<Value, CodexRpcFailure>; pub fn subscribe(&self, thread_id: &str) -> TurnFrameReceiver; pub fn answer_server_request(&self, id: Value, result: Value); }
pub struct CodexAppServerHostRegistry; // Tauri managed state
pub struct CodexHostKey { repository_root: PathBuf, generation: u64, identity: ExecutableIdentity }
impl CodexAppServerHostRegistry { pub fn host_for(&self, key: CodexHostKey, plan: &CodexHostLaunchPlan) -> Result<Arc<CodexAppServerHost>, String>; pub fn retire_idle(&self); pub fn drain_for_dispose(&self); }
impl CodexAppServerHost { pub fn start_thread(&self, ..) -> Result<ThreadHandle, CodexRpcFailure>; pub fn resume_thread(&self, ..) -> Result<ThreadHandle, CodexRpcFailure>; pub fn start_turn(&self, ..) -> Result<TurnHandle, CodexRpcFailure>; pub fn steer_turn(&self, ..) -> Result<(), CodexRpcFailure>; pub fn interrupt_turn(&self, ..) -> Result<(), CodexRpcFailure>; }
```
- [ ] Tests: frame split at arbitrary byte boundaries; oversized line fatal; unknown notification counted not fatal; unknown server request answered `-32601`; id correlation under interleaving; late response discarded; request timeout removes the pending entry; write-queue overflow fatal; handshake failure moves the host to `Failed`; host death settles live turns; two roots get two hosts; LRU eviction at five; idle shutdown; `Drop` reaps the group.
- [ ] Implement; `cargo test --lib codex_app_server_host codex_app_server_transport`; commit `feat(codex): host and drive codex app-server per repository`.

### Task D: Projection (`codex_turn_event.rs`)

**Files:** Create module + tests; golden fixtures `src-tauri/tests/fixtures/codex_app_server/*.jsonl` recorded from a real run of `codex app-server` (script in `scratchpad`, fixture committed).

**Interfaces (produced):** `pub enum CodexTurnEvent { Session{thread_id}, Text{role, text}, ToolCall{..}, ToolResult{..}, Subagent{..}, SubagentItem{..}, Usage{..}, Result{..}, SubagentTurnCompleted{..}, Compaction{..}, Queued{client_user_message_id}, Error{..}, UnknownFrame{method} }` serialized as `{"v":1,"t":"..."}` NDJSON lines; `pub struct CodexTurnProjection { root_thread_id, subagent_threads: HashMap<String, String> }` with `fn project(&mut self, notification: ServerNotification) -> Vec<CodexTurnEvent>`; mapping table from spec section 5 plus `Queued`.
- [ ] Tests: the mapping table row by row; subagent items never merge into the root; cap 32 subagent threads; unknown frames capped at 8; strings bounded by `MAX_AGENT_TOOL_SUMMARY_BYTES`; golden fixture projection is byte-identical.
- [ ] Implement; commit `feat(codex): project app-server frames into turn events`.

### Task C: Supervisor seam (`agent_task_spawner.rs`, `agent_task_supervisor.rs`, `codex_app_server_turn.rs`) — after Task B, Task D and steering Task 2

**Interfaces (produced):** `pub enum AgentTaskProcessOwnership { OwnedGroup { process_group_id: i32 }, SharedSession }`; `AgentChild::ownership()` replaces `process_group_id()`; `CodexTurnChild` implements `AgentChild` (stdout = projection pipe, stderr = 4 KiB ring, `force_kill` = `turn/interrupt` then close, `take_input` = a `CodexTurnInput` that maps a frame to `turn/steer`, falling back to `turn/start` on `ActiveTurnNotSteerable` and emitting `Queued`); `AgentTaskSpawnPlan.transport: CodexTransport::{Exec, AppServer}`; `AgentTaskInput` becomes generic over `AgentTaskInputFrame::{Bytes(Arc<[u8]>), CodexInput(Vec<UserInput>)}`.
- [ ] Tests: escalate/watchdog/reap on `SharedSession` never signals a group (fake host records); interrupt on stop; steer maps to `turn/steer`; not-steerable falls back and projects `Queued`; drop of the turn lease unregisters the route; exec transport unchanged (existing tests).
- [ ] Implement; `cargo test --lib agent_task_supervisor agent_task_spawner`, `cargo test --test agent_task_supervisor_tests`; commit `feat(codex): run codex turns as app-server sessions`.

### Task E: TS parser and domain

**Files:** Create `src/domain/agentOutput/codexAppServer.ts` (+ test, fixtures generated by Task D); modify `agentOutputParser.ts` (`strategyFor` gains a third strategy keyed by a new `AgentOutputParserState.transport`), `agentThread.ts` (`subagentActivity`, `subagentEvent`, `subagentUsage`, `subagentTurnDone`, `queued` variants; `AgentTurnUsage.cachedInputTokens`, `reasoningOutputTokens` optional), `agentThreadWire.ts`.
- [ ] Tests: golden fixtures parse to the expected events; subagent items never appear in the parent list; caps; unknown `t` becomes `unknownLine`; schema-1 threads still parse; wire round-trip of the new variants.
- [ ] Implement; commit `feat(codex): parse app-server turn events`.

### Task F: Settings and composition

**Files:** `src/domain/agentProviderSettings.ts` (+ test), `src-tauri/src/lib_composition/agent_task_commands.rs`, `agent_provider_runtime.rs` (update lease pre-step shuts idle hosts; a live turn still refuses), `runtime.rs` (managed state), Settings UI field for transport and extra args.
- [ ] Tests: settings parse/serialize with defaults; changing transport bumps the revision; update refused during a turn and allowed after; dispose drains hosts.
- [ ] Implement; commit `feat(codex): choose the codex transport in settings`.

### Task G: UI and presentation

**Files:** `src/components/agentMode/*` for subagent groups (collapsible, per-thread duration and usage), `Queued` chip on the steered bubble, truthful host states ("Starting Codex session", "Session unavailable" with retry).
- [ ] Tests: subagent group rendering; queued chip; host state notices; CSS contracts.
- [ ] Implement; commit `feat(codex): show app-server subagents and session state`.

## Ordering and completion

A → (B ∥ D) → C (needs steering Task 2 first) → (E ∥ F) → G. Independent review per task; full gates per CLAUDE.md; QA checklist from spec section 11 in the built app.
