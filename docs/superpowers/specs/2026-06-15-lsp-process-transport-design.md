# PHPactor LSP Process Transport — Design

Date: 2026-06-15
Status: Approved design, pending implementation plan
Backlog: P4-01 (LSP transport prototype), first vertical slice

## Overview

The editor already plans a PHPactor language server launch: `lsp.rs` produces a
`LanguageServerPlan` containing the launch command (executable, args, working
directory) and a JSON-RPC `initialize` request, but it never starts a process.
This slice adds the supervised JSON-RPC process transport that actually spawns
PHPactor, performs the LSP handshake, keeps the process alive, and reports its
runtime status to the UI.

## Goals (first slice)

- Spawn PHPactor from a `Ready` `LanguageServerPlan`.
- Perform the JSON-RPC handshake: send `initialize`, read `InitializeResult`,
  send `initialized`.
- Keep the process running (idle) until stopped or the app exits.
- Report runtime status (`Starting` / `Running` / `Stopped` / `Crashed`) to the
  frontend via Tauri events.
- Stop the process cleanly on command and best-effort on app exit / drop.

## Non-Goals (deferred to later slices)

- Document sync notifications (`didOpen` / `didChange` / `didSave` / `didClose`).
- Diagnostics routing (`publishDiagnostics` → Problems panel).
- Hover / completion / go-to-definition request routing.
- Automatic restart on crash (supervision restart policy).
- Auto-start when entering Smart mode (start is a manual command this slice).
- Full server log/stderr streaming UI.
- Handshake hardening beyond a basic bounded timeout.

## Approach

Approach A (selected): `std::process` + a dedicated reader thread + a generic
JSON-RPC framing codec over `BufRead`/`Write`. Adds **no new crate
dependencies** (uses `std` + the already-present `serde_json`). The framing and
handshake/lifecycle logic are fully unit-testable in memory; the only external
boundary (spawning the real PHPactor process) is isolated behind a trait so
tests never require PHPactor to be installed.

Rejected:

- Approach B (`tauri::async_runtime` + `tokio::process`): tokio `process`/`io`
  features are not guaranteed enabled through Tauri's re-export, and async
  complicates the testable codec seam, for little gain on blocking LSP IO.
- Approach C (`lsp-server` / `lsp-types` crates): new dependency, server-oriented,
  brings types unused by a lifecycle slice — over-engineering here.

## Architecture

New flat Rust modules alongside the existing `lsp.rs` (which stays a pure
planner), a thin Tauri command/event layer, and a new frontend runtime port.

```
lsp.rs            (exists)  planning: command + initialize request
lsp_transport.rs  (new)     LSP framing codec (Content-Length) over BufRead/Write
lsp_session.rs    (new)     reader thread + handshake + status state machine + EventSink
lib.rs            (change)  managed Mutex<LanguageServerSupervisor> + 3 commands + event emit
```

### Rust components

**`lsp_transport.rs` — framing codec (pure, testable)**

- `write_message<W: Write>(w: &mut W, payload: &[u8]) -> io::Result<()>` — writes
  `Content-Length: N\r\n\r\n` followed by the body bytes.
- `read_message<R: BufRead>(r: &mut R) -> io::Result<Option<Vec<u8>>>` — reads
  headers, parses `Content-Length`, reads the exact body; returns `None` on EOF.
- Operates on raw bytes; callers (de)serialize with `serde_json`.

**`lsp_session.rs` — lifecycle orchestrator**

- `LanguageServerRuntimeStatus` — enum serialized to the frontend:
  `Starting | Running | Stopped | Crashed { message }`.
- `EventSink` trait — `emit_status(&self, status: LanguageServerRuntimeStatus)`.
  Production implementation wraps Tauri `AppHandle`; tests use an in-memory
  collector. Keeps session logic free of Tauri types.
- `ServerProcessSpawner` trait — turns a launch command into piped stdio plus a
  kill/wait control handle. Real impl `ChildServerProcessSpawner` uses
  `std::process::Command`; tests use an in-memory scripted-server fake.
- `LanguageServerSupervisor` — managed-state service (mirrors `SmartModeService`
  shape). Holds an optional running session and a shared
  `Arc<Mutex<LanguageServerRuntimeStatus>>`. API: `start(...)`, `stop()`,
  `status()`. Refuses `start` while a session is already running.

**Handshake (bounded, via reader thread + channel):**

1. `start` sets status `Starting` and emits it, then spawns the child and a
   reader thread. The reader thread reads framed messages and forwards them on an
   `mpsc` channel; on EOF/error it sends a `Disconnected` marker. (`start` blocks
   until the handshake resolves, so the frontend observes `Starting` via the
   event before the `start` promise resolves with the `Running`/error outcome.)
2. `start` writes the `initialize` request to stdin, then `recv_timeout(~10s)`
   on the channel until it sees the response with the matching id.
3. On the `InitializeResult`, `start` writes the `initialized` notification, sets
   status `Running`, emits the event, and returns.
4. On timeout or `Disconnected` before the result, `start` kills the child, sets
   `Crashed { message }`, emits, and returns an error.
5. After the handshake the reader thread keeps running. A later `Disconnected`
   (EOF) sets `Crashed` and emits the event. Server-initiated notifications are
   discarded this slice (routing arrives in later slices).

### Tauri layer (`lib.rs`)

- New managed state: `Mutex<LanguageServerSupervisor>`.
- Commands:
  - `start_php_language_server(root_path, app, trust_service, supervisor)` —
    builds the plan (must be `Ready`, reusing the existing planner + authoritative
    trust), then `supervisor.start(ChildServerProcessSpawner, AppHandleEventSink)`.
  - `stop_php_language_server(supervisor)`.
  - `get_php_language_server_status(supervisor)`.
- Event channel: `language-server://status` carrying the runtime status payload.

### Frontend changes

- `languageServer.ts` — new `LanguageServerRuntimeGateway` port, kept separate
  from the planner port (interface segregation, matching the existing
  gateway-split convention):

  ```ts
  interface LanguageServerRuntimeGateway {
    start(rootPath: string): Promise<void>;
    stop(): Promise<void>;
    subscribeStatus(cb: (s: LanguageServerRuntimeStatus) => void): Promise<UnsubscribeFn>;
  }
  ```

  plus a `LanguageServerRuntimeStatus` type mirroring the Rust enum.
- `infrastructure/tauriLanguageServerRuntimeGateway.ts` — `invoke` for start/stop;
  `listen("language-server://status")` for `subscribeStatus`.
- `application/useWorkbenchController.ts`:
  - commands `smart.startLanguageServer` / `smart.stopLanguageServer` (enabled by
    `plan.status === "ready"` and running state respectively),
  - a `useEffect` that subscribes to status events and unsubscribes on cleanup,
  - a `languageServerRuntimeStatus` value reflected in the status bar label
    (extends the existing LSP readiness label),
  - a `WorkbenchNotice` pushed to the Problems panel on `Crashed`.
- `App.tsx` — no extra changes; status flows through the controller.

## Data flow

```
"Start PHP Language Server" command
  → invoke start_php_language_server(rootPath)
  → plan (must be Ready) → supervisor.start(spawner, sink)
       spawn phpactor + reader thread
       write initialize → recv_timeout result → write initialized
       status = Running, emit event
  → FE listen("language-server://status") → status bar "PHPactor: running"

Run: reader thread reads; on EOF/error → status = Crashed, emit → FE notice + label
Stop / app exit: supervisor.stop() → kill child → status = Stopped, emit
```

## Error handling & supervision policy

- Start while already running → error "Language server already running".
- Start while plan not `Ready` → error with the plan message (untrusted / not PHP
  / PHPactor missing). The command is also disabled in the palette unless
  `plan.status === "ready"`.
- Crash before handshake → timeout/`Disconnected` → kill + `Crashed { message }`,
  returns error.
- Crash during run (EOF) → reader thread sets `Crashed` + emits; **no auto-restart**
  this slice — the user restarts via the command.
- Stop / app exit → kill child, `Stopped` + emit. Child is also killed on
  supervisor `Drop` (best-effort, to avoid zombie processes).
- PHPactor stderr → read and discarded this slice (optionally capture the first
  lines for the `Crashed` message); full log streaming is deferred.

## Testing strategy

Follows the project rule: real collaborators / in-memory infrastructure; mock
only the true external boundary (the real PHPactor process).

- **`lsp_transport` (Rust unit):** framing round-trip over `Cursor`; multiple
  consecutive messages; EOF → `None`; truncated body handling.
- **`lsp_session` (Rust):** handshake and lifecycle with an in-memory fake
  spawner (a scripted server speaking JSON-RPC over in-memory streams) plus an
  in-memory `EventSink` collector:
  - successful handshake → `Running`, with `initialize` and `initialized` sent,
  - server sends no result / immediate EOF → `Crashed`,
  - start while already running → error,
  - EOF during run → `Crashed` emitted.
  - The real `ChildServerProcessSpawner` (actual phpactor spawn) is covered only
    by a manual/desktop smoke (it requires PHPactor installed); it is thin glue.
- **Frontend (`vitest`):** runtime gateway/controller with an in-memory fake
  `LanguageServerRuntimeGateway` — start sets the running label; an emitted
  `Crashed` adds a notice. No real Tauri/IPC.

## Quality gates (per project standard)

- `npm run check`
- `npm test`
- `npm run build`
- `cargo test`
- `coderabbit review --agent --base main` (local CLI; repo has no git remote, so
  the PR + CodeRabbit GitHub-app loop does not apply — work ships via direct
  commits to `main`, matching project history)
- Browser smoke for the frontend command/status wiring
- Record the SOLID/pattern review in `docs/ARCHITECTURE_REVIEWS.md`

## Follow-ups (next slices)

- Document sync notifications (P4-03).
- Diagnostics display via `publishDiagnostics` → Problems panel (P4-04).
- Request routing for hover/completion/definition (P4-05/06).
- Restart policy / supervised health (P3-03).
- Auto-start on Smart mode + capability registry (P4-07).
- Server log/stderr stream surface.
