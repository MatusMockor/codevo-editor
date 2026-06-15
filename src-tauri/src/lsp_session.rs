use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
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
const STATUS_EVENT: &str = "language-server://status";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LanguageServerRuntimeStatus {
    Starting,
    Running,
    Stopped,
    Crashed { message: String },
}

pub trait EventSink: Send + Sync {
    fn emit_status(&self, status: LanguageServerRuntimeStatus);
}

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

        let _ = self.app.emit(STATUS_EVENT, status);
    }
}

pub trait ServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer>;
}

pub struct SpawnedServer {
    pub stdin: Box<dyn Write + Send>,
    pub stdout: Box<dyn Read + Send>,
    pub killer: Box<dyn ProcessKiller>,
}

pub trait ProcessKiller: Send {
    fn terminate(&mut self) -> io::Result<()>;
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
    fn terminate(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_some() {
            return Ok(());
        }

        let kill_error = self.child.kill().err();
        let wait_result = self.child.wait().map(|_| ());

        if let Some(error) = kill_error {
            if error.kind() != io::ErrorKind::InvalidInput {
                return Err(error);
            }
        }

        wait_result
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
    sink: Arc<dyn EventSink>,
    stop_requested: Arc<AtomicBool>,
}

pub struct LanguageServerSupervisor {
    session: Mutex<Option<RunningSession>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
}

impl LanguageServerSupervisor {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            status: Arc::new(Mutex::new(LanguageServerRuntimeStatus::Stopped)),
        }
    }

    pub fn status(&self) -> LanguageServerRuntimeStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(LanguageServerRuntimeStatus::Stopped)
    }

    pub fn start(
        &self,
        command: &LanguageServerCommand,
        initialize_request: &JsonRpcRequest,
        spawner: &dyn ServerProcessSpawner,
        sink: Arc<dyn EventSink>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        self.terminate_stale_session();
        self.begin_start(sink.as_ref())?;

        let spawned = match spawner.spawn(command) {
            Ok(spawned) => spawned,
            Err(error) => {
                let message = format!("Failed to start PHPactor: {error}");
                publish_crash(&self.status, sink.as_ref(), &message);
                return Err(message);
            }
        };

        let stdin = Arc::new(Mutex::new(spawned.stdin));
        let stop_requested = Arc::new(AtomicBool::new(false));
        let mut session = Some(RunningSession {
            stdin: Arc::clone(&stdin),
            killer: spawned.killer,
            reader: None,
            sink: Arc::clone(&sink),
            stop_requested: Arc::clone(&stop_requested),
        });

        if !self.install_session(&mut session)? {
            if let Some(session) = session {
                terminate_session(session);
            }

            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        let init_bytes = match serde_json::to_vec(initialize_request) {
            Ok(bytes) => bytes,
            Err(error) => {
                let message = format!("Failed to serialize initialize request: {error}");
                self.terminate_matching_session(&stop_requested);
                publish_crash(&self.status, sink.as_ref(), &message);
                return Err(message);
            }
        };

        if let Err(error) = write_with_session_stdin(&stdin, &init_bytes) {
            let message = format!("Failed to send initialize: {error}");
            self.terminate_matching_session(&stop_requested);
            publish_crash(&self.status, sink.as_ref(), &message);
            return Err(message);
        }

        let (handshake_tx, handshake_rx) = mpsc::channel();
        let mut reader = Some(spawn_reader(
            spawned.stdout,
            Arc::clone(&self.status),
            Arc::clone(&sink),
            Arc::clone(&stop_requested),
            handshake_tx,
            initialize_request.id,
        ));

        if !self.attach_reader(&stop_requested, &mut reader)? {
            if let Some(reader) = reader {
                let _ = reader.join();
            }

            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        match handshake_rx.recv_timeout(HANDSHAKE_TIMEOUT) {
            Ok(HandshakeOutcome::Ready) => {
                if stop_requested.load(Ordering::SeqCst) {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                if let Err(message) = send_initialized(&stdin) {
                    stop_requested.store(true, Ordering::SeqCst);
                    self.terminate_matching_session(&stop_requested);
                    publish_crash(&self.status, sink.as_ref(), &message);
                    return Err(message);
                }

                self.publish_running_if_starting(sink.as_ref(), &stop_requested)
            }
            Ok(HandshakeOutcome::Failed(message)) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                publish_crash(&self.status, sink.as_ref(), &message);
                Err(message)
            }
            Ok(HandshakeOutcome::Disconnected) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                let message = "PHPactor exited during the handshake.".to_string();
                publish_crash(&self.status, sink.as_ref(), &message);
                Err(message)
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
                let was_stopped = stop_requested.load(Ordering::SeqCst);
                self.terminate_matching_session(&stop_requested);
                if was_stopped {
                    return Ok(LanguageServerRuntimeStatus::Stopped);
                }

                let message = "PHPactor did not respond to initialize in time.".to_string();
                publish_crash(&self.status, sink.as_ref(), &message);
                Err(message)
            }
        }
    }

    pub fn stop(&self) -> LanguageServerRuntimeStatus {
        let Some(session) = self.take_session() else {
            set_status(&self.status, LanguageServerRuntimeStatus::Stopped);
            return LanguageServerRuntimeStatus::Stopped;
        };

        let sink = Arc::clone(&session.sink);
        terminate_session(session);

        publish(
            &self.status,
            sink.as_ref(),
            LanguageServerRuntimeStatus::Stopped,
        );
        LanguageServerRuntimeStatus::Stopped
    }

    pub fn send_notification(&self, notification: &JsonRpcNotification) -> Result<(), String> {
        if self.status() != LanguageServerRuntimeStatus::Running {
            return Ok(());
        }

        let Some(stdin) = self.session_stdin() else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(notification)
            .map_err(|error| format!("Failed to serialize LSP notification: {error}"))?;

        write_with_session_stdin(&stdin, &bytes)
            .map_err(|error| format!("Failed to send LSP notification: {error}"))
    }

    fn begin_start(&self, sink: &dyn EventSink) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;

        if is_active_status(&status) {
            return Err("Language server already running.".to_string());
        }

        *status = LanguageServerRuntimeStatus::Starting;
        sink.emit_status(LanguageServerRuntimeStatus::Starting);
        Ok(())
    }

    fn install_session(&self, session: &mut Option<RunningSession>) -> Result<bool, String> {
        let mut current = self.session.lock().map_err(|error| error.to_string())?;

        if self.status() != LanguageServerRuntimeStatus::Starting {
            return Ok(false);
        }

        if current.is_some() {
            return Ok(false);
        }

        *current = session.take();
        Ok(true)
    }

    fn attach_reader(
        &self,
        stop_requested: &Arc<AtomicBool>,
        reader: &mut Option<JoinHandle<()>>,
    ) -> Result<bool, String> {
        let mut current = self.session.lock().map_err(|error| error.to_string())?;
        let Some(session) = current.as_mut() else {
            return Ok(false);
        };

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return Ok(false);
        }

        session.reader = reader.take();
        Ok(true)
    }

    fn publish_running_if_starting(
        &self,
        sink: &dyn EventSink,
        stop_requested: &Arc<AtomicBool>,
    ) -> Result<LanguageServerRuntimeStatus, String> {
        let mut status = self.status.lock().map_err(|error| error.to_string())?;

        if stop_requested.load(Ordering::SeqCst) {
            *status = LanguageServerRuntimeStatus::Stopped;
            return Ok(LanguageServerRuntimeStatus::Stopped);
        }

        if let LanguageServerRuntimeStatus::Crashed { message } = &*status {
            self.terminate_matching_session(stop_requested);
            return Err(message.clone());
        }

        if *status != LanguageServerRuntimeStatus::Starting {
            return Ok(status.clone());
        }

        *status = LanguageServerRuntimeStatus::Running;
        sink.emit_status(LanguageServerRuntimeStatus::Running);
        Ok(LanguageServerRuntimeStatus::Running)
    }

    fn terminate_stale_session(&self) {
        if is_active_status(&self.status()) {
            return;
        }

        if let Some(session) = self.take_session() {
            terminate_session(session);
        }
    }

    fn terminate_matching_session(&self, stop_requested: &Arc<AtomicBool>) {
        let Some(session) = self.take_matching_session(stop_requested) else {
            return;
        };

        terminate_session(session);
    }

    fn take_matching_session(&self, stop_requested: &Arc<AtomicBool>) -> Option<RunningSession> {
        let Ok(mut current) = self.session.lock() else {
            return None;
        };
        let Some(session) = current.as_ref() else {
            return None;
        };

        if !Arc::ptr_eq(&session.stop_requested, stop_requested) {
            return None;
        }

        current.take()
    }

    fn take_session(&self) -> Option<RunningSession> {
        self.session.lock().ok()?.take()
    }

    fn session_stdin(&self) -> Option<Arc<Mutex<Box<dyn Write + Send>>>> {
        self.session
            .lock()
            .ok()?
            .as_ref()
            .map(|session| Arc::clone(&session.stdin))
    }
}

impl Default for LanguageServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for LanguageServerSupervisor {
    fn drop(&mut self) {
        let Ok(mut current) = self.session.lock() else {
            return;
        };

        if let Some(session) = current.take() {
            terminate_session(session);
        }
    }
}

fn send_initialized(stdin: &Arc<Mutex<Box<dyn Write + Send>>>) -> Result<(), String> {
    let initialized = json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} });
    let initialized_bytes = serde_json::to_vec(&initialized)
        .map_err(|error| format!("Failed to serialize initialized notification: {error}"))?;
    write_with_session_stdin(stdin, &initialized_bytes)
        .map_err(|error| format!("Failed to send initialized: {error}"))
}

fn write_with_session_stdin(
    stdin: &Arc<Mutex<Box<dyn Write + Send>>>,
    payload: &[u8],
) -> io::Result<()> {
    let mut stdin = stdin
        .lock()
        .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "stdin lock poisoned"))?;
    write_message(&mut *stdin, payload)
}

fn terminate_session(mut session: RunningSession) {
    session.stop_requested.store(true, Ordering::SeqCst);
    let _ = session.killer.terminate();

    if let Some(reader) = session.reader.take() {
        let _ = reader.join();
    }
}

fn is_active_status(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Starting | LanguageServerRuntimeStatus::Running
    )
}

fn publish_crash(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn EventSink,
    message: &str,
) {
    publish(
        status,
        sink,
        LanguageServerRuntimeStatus::Crashed {
            message: message.to_string(),
        },
    );
}

fn publish(
    status: &Arc<Mutex<LanguageServerRuntimeStatus>>,
    sink: &dyn EventSink,
    next: LanguageServerRuntimeStatus,
) {
    set_status(status, next.clone());
    sink.emit_status(next);
}

fn set_status(status: &Arc<Mutex<LanguageServerRuntimeStatus>>, next: LanguageServerRuntimeStatus) {
    if let Ok(mut current) = status.lock() {
        *current = next;
    }
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

                    publish_crash(
                        &status,
                        sink.as_ref(),
                        "PHPactor language server exited unexpectedly.",
                    );
                    return;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{
        EventSink, LanguageServerRuntimeStatus, LanguageServerSupervisor, ProcessKiller,
        ServerProcessSpawner, SpawnedServer,
    };
    use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
    use crate::lsp_transport::{read_message, write_message};
    use serde_json::{json, Value};
    use std::io::{self, PipeWriter, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime};

    #[test]
    fn successful_handshake_reports_running_and_sends_initialized() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");

        assert_eq!(status, LanguageServerRuntimeStatus::Running);
        wait_for(&rx, &LanguageServerRuntimeStatus::Starting);
        wait_for(&rx, &LanguageServerRuntimeStatus::Running);

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        let initialize: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        let initialized: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(initialize["method"], "initialize");
        assert_eq!(initialized["method"], "initialized");
    }

    #[test]
    fn sends_notification_after_successful_handshake() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");
        supervisor
            .send_notification(&JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didSave".to_string(),
                params: json!({ "textDocument": { "uri": "file:///tmp/User.php" } }),
            })
            .expect("send notification");

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        read_message(&mut reader).unwrap().unwrap();
        read_message(&mut reader).unwrap().unwrap();
        let notification: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(notification["method"], "textDocument/didSave");
    }

    #[test]
    fn notification_is_noop_when_server_is_stopped() {
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .send_notification(&JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didSave".to_string(),
                params: json!({}),
            })
            .expect("stopped notification should be ignored");
    }

    #[test]
    fn rejects_start_when_already_running() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                Arc::clone(&sink) as Arc<dyn EventSink>,
            )
            .expect("first start");

        let error = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect_err("second start should fail");

        assert!(error.contains("already running"));
    }

    #[test]
    fn handshake_failure_reports_crashed_and_errors() {
        let spawner = FakeSpawner::new(Vec::new(), false);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

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
    fn crash_during_run_emits_crashed_status() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");
        wait_for(&rx, &LanguageServerRuntimeStatus::Running);

        *held.lock().expect("held writer lock") = None;

        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Crashed {
                message: "PHPactor language server exited unexpectedly.".to_string(),
            },
        );
    }

    #[test]
    fn stop_after_running_emits_stopped_without_crash() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");
        wait_for(&rx, &LanguageServerRuntimeStatus::Running);

        let status = supervisor.stop();

        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        wait_for(&rx, &LanguageServerRuntimeStatus::Stopped);
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn running_session_keeps_stdin_open_until_stop() {
        let dropped = Arc::new(AtomicUsize::new(0));
        let spawner = FakeSpawner::with_stdin(
            ready_script(),
            true,
            Box::new(DropCountingWriter {
                dropped: Arc::clone(&dropped),
                writes: Arc::new(Mutex::new(Vec::new())),
            }),
        );
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect("start");

        assert_eq!(dropped.load(Ordering::SeqCst), 0);

        supervisor.stop();

        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stop_during_handshake_interrupts_start_without_crash() {
        let spawner = Arc::new(FakeSpawner::new(Vec::new(), true));
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let start_supervisor = Arc::clone(&supervisor);
        let start_sink = Arc::clone(&sink);
        let start_spawner = Arc::clone(&spawner);

        let start = std::thread::spawn(move || {
            start_supervisor
                .start(
                    &command(),
                    &initialize_request(),
                    start_spawner.as_ref(),
                    start_sink,
                )
                .expect("start should stop cleanly")
        });

        wait_for(&rx, &LanguageServerRuntimeStatus::Starting);

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert_eq!(
            start.join().expect("start thread"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn spawn_failure_reports_crashed_status() {
        let spawner = FailingSpawner;
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect_err("spawn should fail");

        assert!(error.contains("Failed to start PHPactor"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn initialized_write_failure_kills_process_and_reports_crashed_status() {
        let spawner =
            FakeSpawner::with_stdin(ready_script(), true, Box::new(FailingOnInitializedWriter));
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(&command(), &initialize_request(), &spawner, sink)
            .expect_err("initialized write should fail");

        assert!(error.contains("initialized"));
        assert!(spawner.held_writer.lock().expect("held writer").is_none());
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

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

    fn ready_script() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} },
        }))
    }

    fn framed(value: Value) -> Vec<u8> {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &serde_json::to_vec(&value).unwrap()).unwrap();
        buffer
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

    #[derive(Clone)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().expect("capture lock").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct DropCountingWriter {
        dropped: Arc<AtomicUsize>,
        writes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for DropCountingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.writes
                .lock()
                .expect("drop counting writer lock")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Drop for DropCountingWriter {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct FakeSpawner {
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        stdin: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
        script: Vec<u8>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        keep_open: bool,
    }

    impl FakeSpawner {
        fn new(script: Vec<u8>, keep_open: bool) -> Self {
            Self {
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(None)),
                script,
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stdin(script: Vec<u8>, keep_open: bool, stdin: Box<dyn Write + Send>) -> Self {
            Self {
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(Some(stdin))),
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
                *self.held_writer.lock().expect("held writer lock") = Some(writer);
            }

            Ok(SpawnedServer {
                stdin: self
                    .stdin
                    .lock()
                    .expect("stdin lock")
                    .take()
                    .unwrap_or_else(|| Box::new(SharedWriter(Arc::clone(&self.stdin_capture)))),
                stdout: Box::new(reader),
                killer: Box::new(FakeKiller {
                    held: Arc::clone(&self.held_writer),
                }),
            })
        }
    }

    struct FakeKiller {
        held: Arc<Mutex<Option<PipeWriter>>>,
    }

    impl ProcessKiller for FakeKiller {
        fn terminate(&mut self) -> io::Result<()> {
            *self.held.lock().expect("held writer lock") = None;
            Ok(())
        }
    }

    struct FailingSpawner;

    impl ServerProcessSpawner for FailingSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            Err(io::Error::new(io::ErrorKind::NotFound, "missing phpactor"))
        }
    }

    struct FailingOnInitializedWriter;

    impl Write for FailingOnInitializedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if String::from_utf8_lossy(buf).contains("initialized") {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "initialized write failed",
                ));
            }

            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
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
            let _ = self.tx.lock().expect("sink lock").send(status);
        }
    }

    fn _unique_label(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        format!("{prefix}-{nanos}")
    }
}
