# PHPactor LSP Process Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spawn the PHPactor language server from a `Ready` plan, perform the JSON-RPC handshake, keep it running, and report runtime status (`Starting`/`Running`/`Stopped`/`Crashed`) to the UI via Tauri events.

**Architecture:** A pure Content-Length framing codec (`lsp_transport.rs`) plus a lifecycle orchestrator (`lsp_session.rs`) that spawns the process behind a `ServerProcessSpawner` trait, runs the handshake on a reader thread bounded by a channel `recv_timeout`, and emits status through an `EventSink` trait. The real process spawn is the only external boundary; framing, handshake, and lifecycle are tested in-memory. A thin Tauri layer (`lib.rs`) exposes start/stop/status commands and an `AppHandle` event sink; the frontend adds a runtime gateway port, pure status helpers, and controller wiring.

**Tech Stack:** Rust (`std::process`, `std::io::pipe`, `std::sync::mpsc`, `serde_json`), Tauri v2 (`Emitter`, `@tauri-apps/api/event` `listen`), React + TypeScript, Vitest.

---

## File Structure

**Rust (`src-tauri/src/`):**
- Create `lsp_transport.rs` — `read_message`/`write_message` framing over `BufRead`/`Write`.
- Create `lsp_session.rs` — `LanguageServerRuntimeStatus`, `EventSink`, `ServerProcessSpawner`/`SpawnedServer`/`ProcessKiller`, `ChildServerProcessSpawner`, `AppHandleEventSink`, `LanguageServerSupervisor`.
- Modify `lib.rs` — declare modules; extract shared plan-building; add managed `Mutex<LanguageServerSupervisor>`; add `start_php_language_server`, `stop_php_language_server`, `get_php_language_server_status`; register handlers.

**Frontend (`src/`):**
- Create `domain/languageServerRuntime.ts` — runtime status type, runtime gateway port, pure helpers (`languageServerStatusLabel`, `languageServerCrashMessage`, `isLanguageServerActive`).
- Create `domain/languageServerRuntime.test.ts` — helper tests.
- Create `infrastructure/tauriLanguageServerRuntimeGateway.ts` — `invoke` start/stop + `listen` subscribe.
- Modify `application/useWorkbenchController.ts` — new gateway param, runtime status state, start/stop commands, subscribe effect, crash notice.
- Modify `App.tsx` — construct runtime gateway, pass it in, surface runtime status label.

**Docs:** `docs/PROGRESS.md`, `docs/IMPLEMENTATION_BACKLOG.md`, `docs/ARCHITECTURE_REVIEWS.md`.

---

## Task 1: LSP framing codec

**Files:**
- Create: `src-tauri/src/lsp_transport.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod lsp_transport;` near the other `mod` lines)

- [ ] **Step 1: Declare the module**

In `src-tauri/src/lib.rs`, add to the module list at the top (keep alphabetical with the existing `mod lsp;`):

```rust
mod lsp;
mod lsp_transport;
mod project;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/lsp_transport.rs`:

```rust
use std::io::{self, BufRead, Write};

/// Writes a single LSP message: `Content-Length: N\r\n\r\n` followed by `payload`.
pub fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", payload.len())?;
    writer.write_all(payload)?;
    writer.flush()
}

/// Reads a single LSP message body. Returns `Ok(None)` on clean EOF before any header.
pub fn read_message<R: BufRead>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;

        if read == 0 {
            return Ok(None);
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);

        if trimmed.is_empty() {
            break;
        }

        let Some((name, value)) = trimmed.split_once(':') else {
            continue;
        };

        if name.eq_ignore_ascii_case("Content-Length") {
            content_length = value
                .trim()
                .parse::<usize>()
                .map(Some)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid Content-Length"))?;
        }
    }

    let length = content_length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::{read_message, write_message};
    use std::io::Cursor;

    #[test]
    fn round_trips_a_single_message() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, b"{\"jsonrpc\":\"2.0\"}").expect("write");

        let mut reader = Cursor::new(buffer);
        let body = read_message(&mut reader).expect("read").expect("message");
        assert_eq!(body, b"{\"jsonrpc\":\"2.0\"}");
    }

    #[test]
    fn reads_consecutive_messages() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, b"first").expect("write");
        write_message(&mut buffer, b"second").expect("write");

        let mut reader = Cursor::new(buffer);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), b"first");
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), b"second");
    }

    #[test]
    fn returns_none_on_eof() {
        let mut reader = Cursor::new(Vec::new());
        assert!(read_message(&mut reader).expect("read").is_none());
    }

    #[test]
    fn parses_content_length_case_insensitively() {
        let raw = b"content-length: 2\r\n\r\nok".to_vec();
        let mut reader = Cursor::new(raw);
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), b"ok");
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lsp_transport`
Expected: PASS (4 tests). The implementation is included above because the codec is small and the tests assert its behavior directly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lsp_transport.rs src-tauri/src/lib.rs
git commit -m "Add LSP message framing codec"
```

---

## Task 2: Lifecycle supervisor — start, handshake, status, guard

**Files:**
- Create: `src-tauri/src/lsp_session.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod lsp_session;`)

- [ ] **Step 1: Declare the module**

In `src-tauri/src/lib.rs`, add after `mod lsp_transport;`:

```rust
mod lsp;
mod lsp_session;
mod lsp_transport;
```

- [ ] **Step 2: Write the implementation (types, traits, real spawner, supervisor)**

Create `src-tauri/src/lsp_session.rs`:

```rust
use crate::lsp::{JsonRpcRequest, LanguageServerCommand};
use crate::lsp_transport::{read_message, write_message};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{self, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LanguageServerRuntimeStatus {
    Starting,
    Running,
    Stopped,
    Crashed { message: String },
}

/// Sink for runtime status changes. Production wraps Tauri's `AppHandle`; tests collect.
pub trait EventSink: Send + Sync {
    fn emit_status(&self, status: LanguageServerRuntimeStatus);
}

/// Owned IO + control handle for a spawned language server process.
pub struct SpawnedServer {
    pub stdin: Box<dyn Write + Send>,
    pub stdout: Box<dyn Read + Send>,
    pub killer: Box<dyn ProcessKiller>,
}

pub trait ProcessKiller: Send {
    fn kill(&mut self) -> io::Result<()>;
}

/// The single external boundary: turning a launch command into a running process.
pub trait ServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer>;
}

pub struct ChildServerProcessSpawner;

impl ServerProcessSpawner for ChildServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        let mut child = Command::new(&command.executable)
            .args(&command.args)
            .current_dir(&command.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "missing child stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "missing child stdout"))?;

        Ok(SpawnedServer {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            killer: Box::new(ChildKiller { child }),
        })
    }
}

struct ChildKiller {
    child: Child,
}

impl ProcessKiller for ChildKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.child.kill()
    }
}

enum HandshakeOutcome {
    Ready,
    Failed(String),
    Disconnected,
}

struct RunningSession {
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ProcessKiller>,
    reader: Option<JoinHandle<()>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    stop_requested: Arc<AtomicBool>,
}

pub struct LanguageServerSupervisor {
    session: Option<RunningSession>,
}

impl LanguageServerSupervisor {
    pub fn new() -> Self {
        Self { session: None }
    }

    pub fn status(&self) -> LanguageServerRuntimeStatus {
        match &self.session {
            Some(session) => session
                .status
                .lock()
                .map(|status| status.clone())
                .unwrap_or(LanguageServerRuntimeStatus::Stopped),
            None => LanguageServerRuntimeStatus::Stopped,
        }
    }

    fn is_active(&self) -> bool {
        matches!(
            self.status(),
            LanguageServerRuntimeStatus::Starting | LanguageServerRuntimeStatus::Running
        )
    }

    pub fn start(
        &mut self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        sink: Arc<dyn EventSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        if self.is_active() {
            return Err("Language server already running.".to_string());
        }

        let status = Arc::new(Mutex::new(LanguageServerRuntimeStatus::Starting));
        publish(&status, sink.as_ref(), LanguageServerRuntimeStatus::Starting);

        let spawned = spawner.spawn(command).map_err(|error| error.to_string())?;
        let stdin = Arc::new(Mutex::new(spawned.stdin));
        let mut killer = spawned.killer;
        let stop_requested = Arc::new(AtomicBool::new(false));

        let init_bytes = serde_json::to_vec(initialize_request).map_err(|e| e.to_string())?;
        if let Err(error) = write_message(&mut *lock(&stdin)?, &init_bytes) {
            let _ = killer.kill();
            let crashed = LanguageServerRuntimeStatus::Crashed {
                message: format!("Failed to send initialize: {error}"),
            };
            publish(&status, sink.as_ref(), crashed.clone());
            return Err(error.to_string());
        }

        let (handshake_tx, handshake_rx) = mpsc::channel::<HandshakeOutcome>();
        let init_id = initialize_request.id;
        let reader = spawn_reader(
            spawned.stdout,
            Arc::clone(&status),
            Arc::clone(&sink),
            Arc::clone(&stop_requested),
            handshake_tx,
            init_id,
        );

        match handshake_rx.recv_timeout(HANDSHAKE_TIMEOUT) {
            Ok(HandshakeOutcome::Ready) => {
                let initialized = json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} });
                let initialized_bytes = serde_json::to_vec(&initialized).map_err(|e| e.to_string())?;
                if let Err(error) = write_message(&mut *lock(&stdin)?, &initialized_bytes) {
                    let _ = killer.kill();
                    return Err(format!("Failed to send initialized: {error}"));
                }

                publish(&status, sink.as_ref(), LanguageServerRuntimeStatus::Running);
                self.session = Some(RunningSession {
                    stdin,
                    killer,
                    reader: Some(reader),
                    status: Arc::clone(&status),
                    stop_requested,
                });
                Ok(LanguageServerRuntimeStatus::Running)
            }
            Ok(HandshakeOutcome::Failed(message)) => {
                let _ = killer.kill();
                let crashed = LanguageServerRuntimeStatus::Crashed {
                    message: message.clone(),
                };
                publish(&status, sink.as_ref(), crashed);
                Err(message)
            }
            Ok(HandshakeOutcome::Disconnected) => {
                let _ = killer.kill();
                let message = "PHPactor exited during the handshake.".to_string();
                publish(
                    &status,
                    sink.as_ref(),
                    LanguageServerRuntimeStatus::Crashed { message: message.clone() },
                );
                Err(message)
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
                let _ = killer.kill();
                let message = "PHPactor did not respond to initialize in time.".to_string();
                publish(
                    &status,
                    sink.as_ref(),
                    LanguageServerRuntimeStatus::Crashed { message: message.clone() },
                );
                Err(message)
            }
        }
    }
}

impl Default for LanguageServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

fn lock<'a, T>(value: &'a Arc<Mutex<T>>) -> Result<std::sync::MutexGuard<'a, T>, String> {
    value.lock().map_err(|error| error.to_string())
}

fn publish(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn EventSink,
    next: LanguageServerRuntimeStatus,
) {
    if let Ok(mut current) = status.lock() {
        *current = next.clone();
    }
    sink.emit_status(next);
}

fn spawn_reader(
    stdout: Box<dyn Read + Send>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: Arc<dyn EventSink>,
    stop_requested: Arc<AtomicBool>,
    handshake_tx: mpsc::Sender<HandshakeOutcome>,
    init_id: u64,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut handshake_done = false;

        loop {
            match read_message(&mut reader) {
                Ok(Some(bytes)) => {
                    if handshake_done {
                        continue;
                    }

                    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                        continue;
                    };

                    if value.get("id") != Some(&json!(init_id)) {
                        continue;
                    }

                    if value.get("result").is_some() {
                        handshake_done = true;
                        let _ = handshake_tx.send(HandshakeOutcome::Ready);
                        continue;
                    }

                    let message = value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("PHPactor rejected initialize.")
                        .to_string();
                    let _ = handshake_tx.send(HandshakeOutcome::Failed(message));
                    return;
                }
                Ok(None) | Err(_) => {
                    if !handshake_done {
                        let _ = handshake_tx.send(HandshakeOutcome::Disconnected);
                        return;
                    }

                    if stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    publish(
                        &status,
                        sink.as_ref(),
                        LanguageServerRuntimeStatus::Crashed {
                            message: "PHPactor language server exited unexpectedly.".to_string(),
                        },
                    );
                    return;
                }
            }
        }
    })
}
```

- [ ] **Step 3: Add test scaffolding and the first two tests (happy path + guard)**

Append to `src-tauri/src/lsp_session.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::{JsonRpcRequest, LanguageServerCommand};
    use std::io::PipeWriter;
    use std::sync::mpsc::{Receiver, Sender};

    fn initialize_request() -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({}),
        }
    }

    fn command() -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "phpactor".to_string(),
            args: vec!["language-server".to_string()],
            working_directory: ".".to_string(),
        }
    }

    fn framed(value: Value) -> Vec<u8> {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &serde_json::to_vec(&value).unwrap()).unwrap();
        buffer
    }

    #[derive(Clone)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// In-memory stand-in for the external PHPactor process.
    struct FakeSpawner {
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        script: Vec<u8>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        keep_open: bool,
    }

    impl FakeSpawner {
        fn new(script: Vec<u8>, keep_open: bool) -> Self {
            Self {
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                script,
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }
    }

    impl ServerProcessSpawner for FakeSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            let (reader, mut writer) = std::io::pipe()?;
            writer.write_all(&self.script)?;

            if self.keep_open {
                *self.held_writer.lock().unwrap() = Some(writer);
            }

            Ok(SpawnedServer {
                stdin: Box::new(SharedWriter(self.stdin_capture.clone())),
                stdout: Box::new(reader),
                killer: Box::new(FakeKiller {
                    held: self.held_writer.clone(),
                }),
            })
        }
    }

    struct FakeKiller {
        held: Arc<Mutex<Option<PipeWriter>>>,
    }

    impl ProcessKiller for FakeKiller {
        fn kill(&mut self) -> io::Result<()> {
            *self.held.lock().unwrap() = None;
            Ok(())
        }
    }

    struct ChannelSink {
        tx: Mutex<Sender<LanguageServerRuntimeStatus>>,
    }

    impl ChannelSink {
        fn new() -> (Arc<Self>, Receiver<LanguageServerRuntimeStatus>) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl EventSink for ChannelSink {
        fn emit_status(&self, status: LanguageServerRuntimeStatus) {
            let _ = self.tx.lock().unwrap().send(status);
        }
    }

    fn wait_for(rx: &Receiver<LanguageServerRuntimeStatus>, target: &LanguageServerRuntimeStatus) {
        let deadline = Duration::from_secs(2);
        loop {
            let status = rx
                .recv_timeout(deadline)
                .unwrap_or_else(|_| panic!("expected status {target:?}"));
            if &status == target {
                return;
            }
        }
    }

    fn ready_script() -> Vec<u8> {
        framed(json!({ "jsonrpc": "2.0", "id": 1, "result": { "capabilities": {} } }))
    }

    #[test]
    fn successful_handshake_reports_running_and_sends_initialized() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = spawner.stdin_capture.clone();
        let (sink, _rx) = ChannelSink::new();
        let mut supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");

        assert_eq!(status, LanguageServerRuntimeStatus::Running);

        let written = capture.lock().unwrap().clone();
        let mut reader = std::io::Cursor::new(written);
        let first: Value = serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        let second: Value = serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        assert_eq!(first["method"], "initialize");
        assert_eq!(second["method"], "initialized");
    }

    #[test]
    fn rejects_start_when_already_running() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let mut supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, Arc::clone(&sink) as Arc<dyn EventSink>)
            .expect("first start");

        let error = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect_err("second start should fail");
        assert!(error.contains("already running"));
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session`
Expected: PASS (2 tests). If `std::io::pipe` is unresolved, confirm `rustc --version` ≥ 1.87 (the project is on 1.95).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lsp_session.rs src-tauri/src/lib.rs
git commit -m "Add language server supervisor start and handshake"
```

---

## Task 3: Supervisor — stop, crash detection, drop cleanup

**Files:**
- Modify: `src-tauri/src/lsp_session.rs`

- [ ] **Step 1: Add `stop` and `Drop` to the supervisor**

In `src-tauri/src/lsp_session.rs`, add a `stop` method inside `impl LanguageServerSupervisor` (after `start`):

```rust
    pub fn stop(&mut self) -> LanguageServerRuntimeStatus {
        let Some(mut session) = self.session.take() else {
            return LanguageServerRuntimeStatus::Stopped;
        };

        session.stop_requested.store(true, Ordering::SeqCst);
        let _ = session.killer.kill();

        if let Ok(mut status) = session.status.lock() {
            *status = LanguageServerRuntimeStatus::Stopped;
        }

        if let Some(reader) = session.reader.take() {
            let _ = reader.join();
        }

        LanguageServerRuntimeStatus::Stopped
    }
```

Then add a `Drop` implementation at the end of the file (before `#[cfg(test)]`):

```rust
impl Drop for LanguageServerSupervisor {
    fn drop(&mut self) {
        if let Some(session) = self.session.as_mut() {
            session.stop_requested.store(true, Ordering::SeqCst);
            let _ = session.killer.kill();
        }
    }
}
```

- [ ] **Step 2: Write the failing tests**

Add these tests inside the existing `mod tests` block in `src-tauri/src/lsp_session.rs`:

```rust
    #[test]
    fn crash_during_run_emits_crashed_status() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = spawner.held_writer.clone();
        let (sink, rx) = ChannelSink::new();
        let mut supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");
        wait_for(&rx, &LanguageServerRuntimeStatus::Running);

        // Simulate the process dying: drop the held stdout writer -> reader sees EOF.
        *held.lock().unwrap() = None;

        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Crashed {
                message: "PHPactor language server exited unexpectedly.".to_string(),
            },
        );
    }

    #[test]
    fn handshake_failure_reports_crashed_and_errors() {
        // Empty script + keep_open=false -> immediate EOF before any result.
        let spawner = FakeSpawner::new(Vec::new(), false);
        let (sink, _rx) = ChannelSink::new();
        let mut supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect_err("start should fail");

        assert!(error.contains("handshake"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn stop_after_crash_does_not_emit_crashed() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, rx) = ChannelSink::new();
        let mut supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");
        wait_for(&rx, &LanguageServerRuntimeStatus::Running);

        let status = supervisor.stop();
        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        // stop killed the process; the reader sees EOF but stop_requested suppresses Crashed.
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml lsp_session`
Expected: PASS (5 tests total).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lsp_session.rs
git commit -m "Add language server supervisor stop and crash detection"
```

---

## Task 4: Wire supervisor into Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update imports**

In `src-tauri/src/lib.rs`, replace the `lsp` import line and add the session + emitter imports:

```rust
use lsp::{
    JsonRpcRequest, LanguageServerCommand, LanguageServerPlan, LanguageServerPlanStatus,
    LanguageServerPlanner, PhpactorLanguageServerPlanner,
};
use lsp_session::{
    AppHandleEventSink, ChildServerProcessSpawner, EventSink, LanguageServerRuntimeStatus,
    LanguageServerSupervisor,
};
```

Add to the existing `use std::sync::Mutex;` line:

```rust
use std::sync::{Arc, Mutex};
```

Add (with the other `use tauri::...` line):

```rust
use tauri::{AppHandle, Manager, State};
```

- [ ] **Step 2: Add the `AppHandleEventSink` to `lsp_session.rs`**

Append to `src-tauri/src/lsp_session.rs` (after the `ChildServerProcessSpawner` impl, before the tests):

```rust
pub struct AppHandleEventSink {
    app: tauri::AppHandle,
}

impl AppHandleEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for AppHandleEventSink {
    fn emit_status(&self, status: LanguageServerRuntimeStatus) {
        use tauri::Emitter;
        let _ = self.app.emit("language-server://status", status);
    }
}
```

- [ ] **Step 3: Extract shared plan building and add the commands**

In `src-tauri/src/lib.rs`, replace the existing `plan_php_language_server` command with a shared helper plus the three runtime commands:

```rust
fn build_php_language_server_plan(
    root_path: &str,
    trust: &Mutex<WorkspaceTrustService>,
) -> Result<LanguageServerPlan, String> {
    let root = PathBuf::from(root_path);
    let trusted = {
        let service = trust.lock().map_err(|error| error.to_string())?;
        service.get(root_path).trusted
    };
    let descriptor = ComposerWorkspaceDetector
        .detect(&root)
        .map_err(|error| error.to_string())?;
    let tools = LocalPhpToolDetector
        .detect(Some(&root))
        .map_err(|error| error.to_string())?;
    Ok(PhpactorLanguageServerPlanner::new().plan(&root, trusted, &descriptor, &tools))
}

#[tauri::command]
fn plan_php_language_server(
    root_path: String,
    service: State<'_, Mutex<WorkspaceTrustService>>,
) -> Result<LanguageServerPlan, String> {
    build_php_language_server_plan(&root_path, &service)
}

#[tauri::command]
fn start_php_language_server(
    root_path: String,
    app: AppHandle,
    trust: State<'_, Mutex<WorkspaceTrustService>>,
    supervisor: State<'_, Mutex<LanguageServerSupervisor>>,
) -> Result<LanguageServerRuntimeStatus, String> {
    let plan = build_php_language_server_plan(&root_path, &trust)?;

    if !matches!(plan.status, LanguageServerPlanStatus::Ready) {
        return Err(plan.message);
    }

    let command: LanguageServerCommand = plan
        .command
        .ok_or_else(|| "Plan is missing a launch command.".to_string())?;
    let initialize_request: JsonRpcRequest = plan
        .initialize_request
        .ok_or_else(|| "Plan is missing an initialize request.".to_string())?;

    let sink: Arc<dyn EventSink> = Arc::new(AppHandleEventSink::new(app));
    let mut supervisor = supervisor.lock().map_err(|error| error.to_string())?;
    supervisor.start(&command, &initialize_request, &ChildServerProcessSpawner, sink)
}

#[tauri::command]
fn stop_php_language_server(
    supervisor: State<'_, Mutex<LanguageServerSupervisor>>,
) -> Result<LanguageServerRuntimeStatus, String> {
    let mut supervisor = supervisor.lock().map_err(|error| error.to_string())?;
    Ok(supervisor.stop())
}

#[tauri::command]
fn get_php_language_server_status(
    supervisor: State<'_, Mutex<LanguageServerSupervisor>>,
) -> Result<LanguageServerRuntimeStatus, String> {
    let supervisor = supervisor.lock().map_err(|error| error.to_string())?;
    Ok(supervisor.status())
}
```

- [ ] **Step 4: Register state and handlers**

In `run()`, add the managed supervisor next to the smart mode service:

```rust
        .manage(Mutex::new(SmartModeService::new()))
        .manage(Mutex::new(LanguageServerSupervisor::new()))
```

Add the three commands to `tauri::generate_handler!` (keep the list sorted):

```rust
            get_php_language_server_status,
            get_smart_mode_state,
            get_workspace_trust,
            plan_php_language_server,
            read_directory,
            read_text_file,
            rename_path,
            search_files,
            search_text,
            set_smart_mode,
            set_workspace_trust,
            start_php_language_server,
            stop_php_language_server,
            write_text_file
```

- [ ] **Step 5: Verify it compiles and all Rust tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (existing 18 + 4 codec + 5 session = 27 tests). The commands themselves are thin glue exercised by manual desktop smoke (Task 8); the supervisor logic is covered by the in-memory tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/lsp_session.rs
git commit -m "Expose language server start, stop, and status commands"
```

---

## Task 5: Frontend runtime domain (types, port, pure helpers)

**Files:**
- Create: `src/domain/languageServerRuntime.ts`
- Create: `src/domain/languageServerRuntime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/languageServerRuntime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isLanguageServerActive,
  languageServerCrashMessage,
  languageServerStatusLabel,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";

describe("languageServerStatusLabel", () => {
  it("labels each running state and hides the stopped state", () => {
    expect(languageServerStatusLabel(null)).toBeNull();
    expect(languageServerStatusLabel({ kind: "starting" })).toBe("PHPactor: starting");
    expect(languageServerStatusLabel({ kind: "running" })).toBe("PHPactor: running");
    expect(languageServerStatusLabel({ kind: "crashed", message: "boom" })).toBe(
      "PHPactor: crashed",
    );
    expect(languageServerStatusLabel({ kind: "stopped" })).toBeNull();
  });
});

describe("languageServerCrashMessage", () => {
  it("returns the message only for crashed status", () => {
    expect(languageServerCrashMessage({ kind: "crashed", message: "boom" })).toBe("boom");
    expect(languageServerCrashMessage({ kind: "running" })).toBeNull();
  });
});

describe("isLanguageServerActive", () => {
  it("treats starting and running as active", () => {
    expect(isLanguageServerActive({ kind: "starting" })).toBe(true);
    expect(isLanguageServerActive({ kind: "running" })).toBe(true);
    expect(isLanguageServerActive({ kind: "crashed", message: "x" })).toBe(false);
    expect(isLanguageServerActive({ kind: "stopped" })).toBe(false);
    expect(isLanguageServerActive(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/languageServerRuntime.test.ts`
Expected: FAIL with "Cannot find module './languageServerRuntime'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/languageServerRuntime.ts`:

```ts
export type LanguageServerRuntimeStatus =
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "crashed"; message: string };

export type UnsubscribeFn = () => void;

export interface LanguageServerRuntimeGateway {
  start(rootPath: string): Promise<void>;
  stop(): Promise<void>;
  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn>;
}

export function languageServerStatusLabel(
  status: LanguageServerRuntimeStatus | null,
): string | null {
  if (!status) {
    return null;
  }

  if (status.kind === "starting") {
    return "PHPactor: starting";
  }

  if (status.kind === "running") {
    return "PHPactor: running";
  }

  if (status.kind === "crashed") {
    return "PHPactor: crashed";
  }

  return null;
}

export function languageServerCrashMessage(
  status: LanguageServerRuntimeStatus,
): string | null {
  if (status.kind !== "crashed") {
    return null;
  }

  return status.message;
}

export function isLanguageServerActive(
  status: LanguageServerRuntimeStatus | null,
): boolean {
  if (!status) {
    return false;
  }

  return status.kind === "starting" || status.kind === "running";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/languageServerRuntime.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/domain/languageServerRuntime.ts src/domain/languageServerRuntime.test.ts
git commit -m "Add frontend language server runtime domain"
```

---

## Task 6: Frontend runtime gateway adapter

**Files:**
- Create: `src/infrastructure/tauriLanguageServerRuntimeGateway.ts`

- [ ] **Step 1: Write the adapter**

Create `src/infrastructure/tauriLanguageServerRuntimeGateway.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
  UnsubscribeFn,
} from "../domain/languageServerRuntime";

const STATUS_EVENT = "language-server://status";

export class TauriLanguageServerRuntimeGateway
  implements LanguageServerRuntimeGateway
{
  async start(rootPath: string): Promise<void> {
    await invoke("start_php_language_server", { rootPath });
  }

  async stop(): Promise<void> {
    await invoke("stop_php_language_server");
  }

  subscribeStatus(
    listener: (status: LanguageServerRuntimeStatus) => void,
  ): Promise<UnsubscribeFn> {
    return listen<LanguageServerRuntimeStatus>(STATUS_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run check`
Expected: PASS (no type errors). This adapter mirrors the existing untested Tauri gateways; its behavior is covered by the desktop smoke in Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/tauriLanguageServerRuntimeGateway.ts
git commit -m "Add Tauri language server runtime gateway"
```

---

## Task 7: Wire runtime gateway into the controller and shell

**Files:**
- Modify: `src/application/useWorkbenchController.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the runtime domain in the controller**

In `src/application/useWorkbenchController.ts`, add after the existing `languageServerSetup` import (line ~14):

```ts
import {
  isLanguageServerActive,
  languageServerCrashMessage,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  type UnsubscribeFn,
} from "../domain/languageServerRuntime";
```

- [ ] **Step 2: Add the gateway parameter**

Change the hook signature to accept the runtime gateway before `prompter`:

```ts
export function useWorkbenchController(
  workspaceGateways: WorkbenchWorkspaceGateways,
  smartModeGateway: SmartModeGateway,
  workspaceTrustGateway: WorkspaceTrustGateway,
  languageServerGateway: LanguageServerGateway,
  languageServerRuntimeGateway: LanguageServerRuntimeGateway,
  prompter: WorkbenchPrompter,
) {
```

- [ ] **Step 3: Add runtime status state**

After the `languageServerSetupOpen` state (line ~68), add:

```ts
  const [languageServerRuntimeStatus, setLanguageServerRuntimeStatus] =
    useState<LanguageServerRuntimeStatus | null>(null);
```

- [ ] **Step 4: Add start/stop callbacks**

After the `toggleWorkspaceTrust` callback (around line ~540), add:

```ts
  const startLanguageServer = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    try {
      await languageServerRuntimeGateway.start(workspaceRoot);
    } catch (error) {
      reportError("Language Server", error);
    }
  }, [languageServerRuntimeGateway, reportError, workspaceRoot]);

  const stopLanguageServer = useCallback(async () => {
    try {
      await languageServerRuntimeGateway.stop();
      setLanguageServerRuntimeStatus({ kind: "stopped" });
    } catch (error) {
      reportError("Language Server", error);
    }
  }, [languageServerRuntimeGateway, reportError]);
```

- [ ] **Step 5: Register the start/stop commands**

In the `commandRegistry` `useMemo`, after the `smart.phpactorSetup` registration (line ~655), add:

```ts
    registry.register({
      id: "smart.startLanguageServer",
      title: "Start PHP Language Server",
      category: "Smart Mode",
      isEnabled: () =>
        languageServerPlan?.status === "ready" &&
        !isLanguageServerActive(languageServerRuntimeStatus),
      run: startLanguageServer,
    });

    registry.register({
      id: "smart.stopLanguageServer",
      title: "Stop PHP Language Server",
      category: "Smart Mode",
      isEnabled: () => isLanguageServerActive(languageServerRuntimeStatus),
      run: stopLanguageServer,
    });
```

Add `languageServerRuntimeStatus`, `startLanguageServer`, and `stopLanguageServer` to the `useMemo` dependency array (alongside `languageServerPlan`):

```ts
  }, [
    createDirectory,
    createFile,
    deleteActiveDocument,
    openWorkspace,
    refreshWorkspace,
    renameActiveDocument,
    saveActiveDocument,
    startLanguageServer,
    stopLanguageServer,
    toggleSmartMode,
    toggleWorkspaceTrust,
    languageServerPlan,
    languageServerRuntimeStatus,
    workspaceTrust,
  ]);
```

- [ ] **Step 6: Subscribe to status events**

After the text-search `useEffect` (line ~831), add a new effect:

```ts
  useEffect(() => {
    let active = true;
    let unsubscribe: UnsubscribeFn | null = null;

    languageServerRuntimeGateway
      .subscribeStatus((status) => {
        setLanguageServerRuntimeStatus(status);
        const crash = languageServerCrashMessage(status);

        if (crash) {
          reportError("Language Server", crash);
        }
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch((error) => reportError("Language Server", error));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [languageServerRuntimeGateway, reportError]);
```

- [ ] **Step 7: Export the new values**

In the returned object (line ~833), add (keep alphabetical-ish with the existing `languageServer*` keys):

```ts
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerSetupOpen,
```

and near `startLanguageServer`/`stopLanguageServer` siblings (with the other callbacks):

```ts
    startLanguageServer,
    stopLanguageServer,
```

- [ ] **Step 8: Update `App.tsx`**

In `src/App.tsx`, add the import (after the `TauriLanguageServerGateway` import, line ~15):

```ts
import { TauriLanguageServerRuntimeGateway } from "./infrastructure/tauriLanguageServerRuntimeGateway";
```

Add the domain helper import (after the `isDirty` import, line ~13):

```ts
import { languageServerStatusLabel } from "./domain/languageServerRuntime";
```

Construct the gateway next to the others (line ~31):

```ts
const languageServerGateway = new TauriLanguageServerGateway();
const languageServerRuntimeGateway = new TauriLanguageServerRuntimeGateway();
```

Pass it into the hook (line ~35):

```ts
  const workbench = useWorkbenchController(
    workspaceGateways,
    smartModeGateway,
    workspaceTrustGateway,
    languageServerGateway,
    languageServerRuntimeGateway,
    workbenchPrompter,
  );
```

Replace the `languageServerLabel` `useMemo` (line ~69) so runtime status takes precedence over plan readiness:

```ts
  const languageServerLabel = useMemo(() => {
    const runtimeLabel = languageServerStatusLabel(
      workbench.languageServerRuntimeStatus,
    );

    if (runtimeLabel) {
      return runtimeLabel;
    }

    const plan = workbench.languageServerPlan;

    if (!plan) {
      return null;
    }

    if (plan.status === "ready") {
      return "PHPactor LSP ready";
    }

    if (plan.status === "blocked") {
      return "LSP blocked";
    }

    return "LSP unavailable";
  }, [workbench.languageServerPlan, workbench.languageServerRuntimeStatus]);
```

- [ ] **Step 9: Verify typecheck, tests, and build pass**

Run: `npm run check && npm test && npm run build`
Expected: PASS — typecheck clean, 13 frontend tests (10 existing + 3 new runtime suites), production build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/application/useWorkbenchController.ts src/App.tsx
git commit -m "Wire language server runtime status into the workbench"
```

---

## Task 8: Quality gate, manual smoke, and documentation

**Files:**
- Modify: `docs/PROGRESS.md`
- Modify: `docs/IMPLEMENTATION_BACKLOG.md`
- Modify: `docs/ARCHITECTURE_REVIEWS.md`

- [ ] **Step 1: Run the full quality gate**

```bash
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all pass (frontend 13 tests, Rust 27 tests).

- [ ] **Step 2: Desktop smoke for the real spawn path**

If PHPactor is installed for a trusted PHP workspace, manually confirm: open the workspace, trust it, run "Start PHP Language Server" from the palette, and observe the status bar change to "PHPactor: running"; run "Stop PHP Language Server" and observe it clear. Record the result (or note it as deferred if PHPactor is unavailable in the environment).

```bash
npm run tauri build -- --debug --bundles app
```

- [ ] **Step 3: Update PROGRESS, BACKLOG, and ARCHITECTURE_REVIEWS**

In `docs/PROGRESS.md`, add a completed entry: "Added supervised JSON-RPC process transport that spawns PHPactor, performs the LSP handshake, and reports runtime status via Tauri events." Update the "Next implementation slice" list to drop the completed transport item and lead with the diagnostics/document-sync slices.

In `docs/IMPLEMENTATION_BACKLOG.md`, change P4-01 status from `Partial` to reflect the shipped transport (e.g. `Done` for the lifecycle transport, with sync/diagnostics tracked under P4-03/P4-04).

In `docs/ARCHITECTURE_REVIEWS.md`, add a `2026-06-15: LSP Process Transport` section covering: SOLID review (SRP across codec/session/commands; OCP via `ServerProcessSpawner`/`EventSink`; DIP — supervisor depends on traits, not Tauri/`std::process`), pattern review (Adapter for the Tauri command + frontend gateway, Strategy/Boundary for the spawner, Observer for the event sink), and the verification list.

- [ ] **Step 4: Run the CodeRabbit pre-commit review loop**

```bash
coderabbit review --agent --base main
```

Triage findings (fix valid, skip invalid with a one-line reason), re-validate, and re-run until it reports 0 findings.

- [ ] **Step 5: Commit**

```bash
git add docs/PROGRESS.md docs/IMPLEMENTATION_BACKLOG.md docs/ARCHITECTURE_REVIEWS.md
git commit -m "Document LSP process transport slice"
```

Note: the repo has no git remote, so shipping is direct commits to `main` (matching project history); the ship-phase PR + GitHub-app loop does not apply.

---

## Self-Review Notes

- **Spec coverage:** codec (Task 1) ✓; status enum/EventSink/spawner traits/supervisor start+handshake+guard (Task 2) ✓; stop/crash/drop (Task 3) ✓; Tauri commands + AppHandle sink + event (Task 4) ✓; frontend runtime port + helpers (Task 5) ✓; runtime adapter with `listen` (Task 6) ✓; controller commands + subscribe effect + crash notice + status label (Task 7) ✓; quality gates + docs + CodeRabbit (Task 8) ✓. Non-goals (sync, diagnostics, auto-restart, auto-start) are intentionally absent.
- **Type consistency:** `LanguageServerRuntimeStatus` Rust enum is internally tagged (`#[serde(tag = "kind", rename_all = "camelCase")]`) and mirrored by the TS discriminated union on `kind`; the `crashed` variant carries `message` on both sides. Command names (`start_php_language_server`, `stop_php_language_server`, `get_php_language_server_status`) and the event name (`language-server://status`) match between Rust and the adapter. `isLanguageServerActive` / `languageServerStatusLabel` / `languageServerCrashMessage` are used with the same signatures defined in Task 5.
- **Known race (accepted for this slice):** if PHPactor disconnects in the brief window between the handshake result and `start` publishing `Running`, the reader may publish `Crashed` and then `start` overwrites it with `Running`; documented as acceptable because PHPactor stays alive after a successful handshake. Handshake timeout hardening beyond the 10s bound is deferred.
