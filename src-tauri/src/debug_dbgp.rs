#![allow(dead_code)] // PHP Xdebug DBGp adapter awaiting the tauri debugger command wiring slice.

use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEventEmitter, DebugEventPayload, DebugLaunchTarget,
    DebugOutputStream, DebugScopeInfo, DebugStackFrame, DebugStopReason, DebugVariableInfo,
    StepKind,
};
use crate::debug_support::{
    file_url_from_path, group_breakpoints_by_file, path_from_file_url, validate_workspace_file,
    DebugProcessHandle,
};
use crate::tools::php_executable_path;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader as XmlReader;
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DBGP_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_DBGP_PACKET_LENGTH: usize = 16 * 1024 * 1024;
const XDEBUG_ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(25);
const DEFAULT_LISTEN_PORT: u16 = 9003;
const PHP_MISSING_ERROR: &str =
    "PHP runtime was not found. Install PHP or set CODEVO_EDITOR_PHP_PATH.";
const XDEBUG_CONNECT_ERROR: &str = "The PHP process started but Xdebug never connected. Is the Xdebug extension installed and enabled?";
const NOT_CONNECTED_ERROR: &str = "The PHP debugger is not connected.";
const NOT_PAUSED_ERROR: &str = "The debugger is not paused.";
const DBGP_FEATURES: &[(&str, &str)] = &[
    ("max_depth", "1"),
    ("max_children", "100"),
    ("max_data", "4096"),
    ("notify_ok", "1"),
    ("resolved_breakpoints", "1"),
];

/// Runs with the debuggee's exit code once the session ends. Wire it to
/// `DebugSessionRegistry::finish_session(session_id, exit_code)`; the adapter
/// never emits `Terminated` itself. Script mode reports the PHP process exit
/// code from the waiter thread; listen mode reports `None` when the Xdebug
/// connection closes. Invoked only after `create_php_dbgp_adapter` returns
/// `Ok`; factory failures never call it.
pub(crate) type DebugSessionFinish = Box<dyn FnOnce(Option<i32>) + Send>;

type FinishSlot = Arc<Mutex<Option<DebugSessionFinish>>>;

struct ConnectionFinish {
    callback: FinishSlot,
    listener_shutdown: Arc<AtomicBool>,
}

/// PHP binary resolution reuses `tools::php_executable_path`: the
/// `CODEVO_EDITOR_PHP_PATH` override first, then the first `php` on `PATH`.
/// The adapter always plays the DBGp IDE role as a TCP server bound
/// exclusively to 127.0.0.1; the Xdebug engine connects to us.
pub(crate) fn create_php_dbgp_adapter(
    root: &Path,
    launch_target: &DebugLaunchTarget,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String> {
    match launch_target {
        DebugLaunchTarget::PhpScript { script_path } => {
            create_script_session(root, script_path, initial_breakpoints, emitter, finish)
        }
        DebugLaunchTarget::PhpTestFile { file_path } => {
            create_test_session(root, file_path, initial_breakpoints, emitter, finish)
        }
        DebugLaunchTarget::PhpListen { port } => create_listen_session(
            port.unwrap_or(DEFAULT_LISTEN_PORT),
            initial_breakpoints,
            emitter,
            finish,
        ),
        _ => Err("Unsupported launch target for the PHP debugger.".to_string()),
    }
}

fn create_script_session(
    root: &Path,
    script_path: &str,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String> {
    let script = validate_workspace_file(root, script_path)?;
    create_process_session(
        root,
        move |port| build_php_launch_arguments(port, &script),
        initial_breakpoints,
        emitter,
        finish,
    )
}

fn create_test_session(
    root: &Path,
    file_path: &str,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String> {
    let file = validate_workspace_file(root, file_path)?;
    let runner = resolve_php_test_runner(root)?;
    create_process_session(
        root,
        move |port| build_php_test_launch_arguments(port, &runner, &file),
        initial_breakpoints,
        emitter,
        finish,
    )
}

fn create_process_session<F>(
    root: &Path,
    build_arguments: F,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String>
where
    F: FnOnce(u16) -> Vec<String>,
{
    let php = php_executable_path().ok_or_else(|| PHP_MISSING_ERROR.to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Unable to open a local port for Xdebug: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Unable to resolve the Xdebug listener port: {error}"))?
        .port();
    let mut command = Command::new(&php);
    command
        .args(build_arguments(port))
        .current_dir(root)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to launch the PHP debug process: {error}"))?;
    let process_handle = DebugProcessHandle::from_process_id(child.id());
    let Some(stdout) = child.stdout.take() else {
        process_handle.terminate();
        let _ = child.wait();
        return Err("The PHP debug process has no stdout pipe.".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        process_handle.terminate();
        let _ = child.wait();
        return Err("The PHP debug process has no stderr pipe.".to_string());
    };
    spawn_process_output_pump(stdout, DebugOutputStream::Stdout, emitter.clone());
    spawn_process_output_pump(stderr, DebugOutputStream::Stderr, emitter.clone());
    let stream = match accept_with_timeout(&listener, XDEBUG_ACCEPT_TIMEOUT) {
        Ok(stream) => stream,
        Err(_) => {
            process_handle.terminate();
            let _ = child.wait();
            return Err(XDEBUG_CONNECT_ERROR.to_string());
        }
    };
    let inner = new_adapter_inner(initial_breakpoints, emitter);
    attach_connection(Arc::clone(&inner), stream, None)?;
    thread::spawn(move || {
        let exit_code = child.wait().ok().and_then(|status| status.code());
        finish(exit_code);
    });
    Ok(Box::new(PhpDbgpAdapter {
        inner,
        process: Some(process_handle),
        listener_shutdown: None,
    }))
}

fn create_listen_session(
    port: u16,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| {
        format!(
            "Unable to listen for Xdebug on 127.0.0.1:{port}; the port is already in use: {error}"
        )
    })?;
    let actual_port = listener
        .local_addr()
        .map_err(|error| format!("Unable to resolve the Xdebug listener port: {error}"))?
        .port();
    let inner = new_adapter_inner(initial_breakpoints, emitter);
    inner.emitter.emit(DebugEventPayload::Output {
        stream: DebugOutputStream::Stdout,
        text: format!("Listening for Xdebug connections on 127.0.0.1:{actual_port}..."),
    });
    let shutdown = Arc::new(AtomicBool::new(false));
    let finish_slot: FinishSlot = Arc::new(Mutex::new(Some(finish)));
    let accept_inner = Arc::clone(&inner);
    let accept_shutdown = Arc::clone(&shutdown);
    thread::spawn(move || run_accept_loop(listener, accept_inner, accept_shutdown, finish_slot));
    Ok(Box::new(PhpDbgpAdapter {
        inner,
        process: None,
        listener_shutdown: Some(shutdown),
    }))
}

/// The first Xdebug connection wins the session; later connections are
/// accepted and dropped immediately so a rogue second request cannot hijack
/// or stall the active session.
fn run_accept_loop(
    listener: TcpListener,
    inner: Arc<DbgpAdapterInner>,
    shutdown: Arc<AtomicBool>,
    finish_slot: FinishSlot,
) {
    if listener.set_nonblocking(true).is_err() {
        return;
    }
    let mut connected = false;
    loop {
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if connected {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                connected = true;
                let _ = stream.set_nonblocking(false);
                let _ = attach_connection(
                    Arc::clone(&inner),
                    stream,
                    Some(ConnectionFinish {
                        callback: Arc::clone(&finish_slot),
                        listener_shutdown: Arc::clone(&shutdown),
                    }),
                );
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_POLL_INTERVAL);
            }
            Err(_) => return,
        }
    }
}

fn build_php_launch_arguments(port: u16, script: &str) -> Vec<String> {
    vec![
        "-dxdebug.mode=debug".to_string(),
        "-dxdebug.start_with_request=yes".to_string(),
        "-dxdebug.client_host=127.0.0.1".to_string(),
        format!("-dxdebug.client_port={port}"),
        script.to_string(),
    ]
}

fn build_php_test_launch_arguments(port: u16, runner: &str, file: &str) -> Vec<String> {
    let mut arguments = build_php_launch_arguments(port, runner);
    arguments.push(file.to_string());
    arguments
}

fn resolve_php_test_runner(root: &Path) -> Result<String, String> {
    for name in ["pest", "phpunit"] {
        let candidate = root.join("vendor").join("bin").join(name);

        if !candidate.is_file() {
            continue;
        }

        let resolved = candidate
            .canonicalize()
            .map_err(|error| format!("Unable to resolve the PHP test runner: {error}"))?;

        if !resolved.starts_with(root) {
            return Err("The PHP test runner resolves outside the workspace.".to_string());
        }

        return Ok(resolved.to_string_lossy().into_owned());
    }

    Err("No local Pest or PHPUnit runner is available in vendor/bin.".to_string())
}

fn accept_with_timeout(listener: &TcpListener, timeout: Duration) -> Result<TcpStream, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Unable to configure the Xdebug listener: {error}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nonblocking(false);
                return Ok(stream);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Timed out waiting for Xdebug to connect.".to_string());
                }
                thread::sleep(ACCEPT_POLL_INTERVAL);
            }
            Err(error) => return Err(format!("Unable to accept the Xdebug connection: {error}")),
        }
    }
}

fn spawn_process_output_pump<R: Read + Send + 'static>(
    reader: R,
    stream: DebugOutputStream,
    emitter: DebugEventEmitter,
) {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            let Ok(text) = line else {
                break;
            };
            if text.is_empty() {
                continue;
            }
            emitter.emit(DebugEventPayload::Output { stream, text });
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum DbgpStatus {
    AwaitingConnection,
    Starting,
    Running,
    Break,
    Stopped,
}

#[derive(Clone)]
enum VariableSlot {
    Context {
        depth: u32,
        context_id: u32,
    },
    Property {
        depth: u32,
        context_id: u32,
        fullname: String,
    },
}

#[derive(Default)]
struct PauseInventory {
    frame_depths: HashMap<u64, u32>,
    frames: Vec<DebugStackFrame>,
    scopes: HashMap<u64, Vec<DebugScopeInfo>>,
    slots: HashMap<u64, VariableSlot>,
}

struct BreakpointResolutionTarget {
    breakpoint_id: String,
    file_path: String,
}

struct DbgpShared {
    status: DbgpStatus,
    breakpoints_by_file: HashMap<String, Vec<DebugBreakpoint>>,
    dbgp_ids_by_file: HashMap<String, Vec<String>>,
    queued_files: Vec<String>,
    resolution_index: HashMap<String, BreakpointResolutionTarget>,
    pending_resolutions: HashMap<String, u32>,
    pause: Option<PauseInventory>,
    next_reference: u64,
}

impl DbgpShared {
    fn allocate_reference(&mut self) -> u64 {
        let reference = self.next_reference;
        self.next_reference += 1;
        reference
    }
}

struct DbgpAdapterInner {
    connection: Mutex<Option<Arc<DbgpConnection>>>,
    emitter: DebugEventEmitter,
    shared: Mutex<DbgpShared>,
}

impl DbgpAdapterInner {
    fn active_connection(&self) -> Result<Arc<DbgpConnection>, String> {
        self.connection
            .lock()
            .map_err(|error| error.to_string())?
            .clone()
            .ok_or_else(|| NOT_CONNECTED_ERROR.to_string())
    }
}

fn new_adapter_inner(
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
) -> Arc<DbgpAdapterInner> {
    let mut breakpoints_by_file = HashMap::new();
    for (file_path, breakpoints) in group_breakpoints_by_file(initial_breakpoints) {
        let stored: Vec<DebugBreakpoint> = breakpoints
            .into_iter()
            .map(|mut breakpoint| {
                breakpoint.verified = false;
                breakpoint
            })
            .collect();
        breakpoints_by_file.insert(file_path, stored);
    }
    Arc::new(DbgpAdapterInner {
        connection: Mutex::new(None),
        emitter,
        shared: Mutex::new(DbgpShared {
            status: DbgpStatus::AwaitingConnection,
            breakpoints_by_file,
            dbgp_ids_by_file: HashMap::new(),
            queued_files: Vec::new(),
            resolution_index: HashMap::new(),
            pending_resolutions: HashMap::new(),
            pause: None,
            next_reference: 1,
        }),
    })
}

type PendingDbgpRequests = Arc<Mutex<HashMap<u64, mpsc::Sender<DbgpResponse>>>>;

struct DbgpConnection {
    continuations: Mutex<HashMap<u64, DebugStopReason>>,
    next_transaction_id: AtomicU64,
    pending: PendingDbgpRequests,
    request_timeout: Duration,
    writer: Mutex<TcpStream>,
}

impl DbgpConnection {
    fn send_command(&self, line: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|error| error.to_string())?;
        writer
            .write_all(line.as_bytes())
            .and_then(|_| writer.write_all(&[0]))
            .map_err(|_| "The Xdebug connection is closed.".to_string())
    }

    fn request(
        &self,
        command: &str,
        arguments: &str,
        data: Option<&str>,
    ) -> Result<DbgpResponse, String> {
        let transaction_id = self.next_transaction_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
            pending.insert(transaction_id, tx);
        }
        let mut line = format!("{command} -i {transaction_id}{arguments}");
        if let Some(data) = data {
            line.push_str(" -- ");
            line.push_str(&BASE64_STANDARD.encode(data));
        }
        if let Err(error) = self.send_command(&line) {
            remove_pending_dbgp_request(&self.pending, transaction_id);
            return Err(error);
        }
        match rx.recv_timeout(self.request_timeout) {
            Ok(response) => Ok(response),
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_dbgp_request(&self.pending, transaction_id);
                Err(format!("Xdebug request `{command}` timed out."))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(format!("The Xdebug connection closed during `{command}`."))
            }
        }
    }

    fn send_continuation(&self, command: &str, reason: DebugStopReason) -> Result<(), String> {
        let transaction_id = self.next_transaction_id.fetch_add(1, Ordering::SeqCst);
        {
            let mut continuations = self
                .continuations
                .lock()
                .map_err(|error| error.to_string())?;
            continuations.insert(transaction_id, reason);
        }
        self.send_command(&format!("{command} -i {transaction_id}"))
    }

    fn fire_and_forget(&self, command: &str) {
        let transaction_id = self.next_transaction_id.fetch_add(1, Ordering::SeqCst);
        let _ = self.send_command(&format!("{command} -i {transaction_id}"));
    }

    fn close(&self) {
        if let Ok(writer) = self.writer.lock() {
            let _ = writer.shutdown(Shutdown::Both);
        }
    }
}

fn remove_pending_dbgp_request(pending: &PendingDbgpRequests, transaction_id: u64) {
    if let Ok(mut pending) = pending.lock() {
        pending.remove(&transaction_id);
    }
}

fn reject_pending_dbgp_requests(pending: &PendingDbgpRequests) {
    if let Ok(mut pending) = pending.lock() {
        pending.clear();
    }
}

enum DriverMessage {
    Init(DbgpInit),
    Continuation {
        response: DbgpResponse,
        reason: DebugStopReason,
    },
    Notify(DbgpNotify),
    Disconnected,
}

fn attach_connection(
    inner: Arc<DbgpAdapterInner>,
    stream: TcpStream,
    finish: Option<ConnectionFinish>,
) -> Result<(), String> {
    let writer = stream
        .try_clone()
        .map_err(|error| format!("Unable to clone the Xdebug socket: {error}"))?;
    let connection = Arc::new(DbgpConnection {
        continuations: Mutex::new(HashMap::new()),
        next_transaction_id: AtomicU64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
        request_timeout: DBGP_REQUEST_TIMEOUT,
        writer: Mutex::new(writer),
    });
    {
        let mut slot = inner.connection.lock().map_err(|error| error.to_string())?;
        slot.replace(Arc::clone(&connection));
    }
    {
        let mut shared = inner.shared.lock().map_err(|error| error.to_string())?;
        shared.status = DbgpStatus::Starting;
    }
    let (driver_tx, driver_rx) = mpsc::channel();
    let reader_connection = Arc::clone(&connection);
    let reader_emitter = inner.emitter.clone();
    thread::spawn(move || run_reader(stream, reader_connection, driver_tx, reader_emitter));
    thread::spawn(move || run_driver(inner, connection, driver_rx, finish));
    Ok(())
}

fn run_reader(
    stream: TcpStream,
    connection: Arc<DbgpConnection>,
    driver: mpsc::Sender<DriverMessage>,
    emitter: DebugEventEmitter,
) {
    let mut reader = BufReader::new(stream);
    loop {
        let packet = match read_dbgp_packet(&mut reader) {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(error) => {
                emitter.emit(DebugEventPayload::Output {
                    stream: DebugOutputStream::Stderr,
                    text: error,
                });
                connection.close();
                break;
            }
        };
        let Some(message) = parse_dbgp_message(&packet) else {
            continue;
        };
        match message {
            DbgpMessage::Init(init) => {
                let _ = driver.send(DriverMessage::Init(init));
            }
            DbgpMessage::Notify(notify) => {
                let _ = driver.send(DriverMessage::Notify(notify));
            }
            DbgpMessage::Response(response) => route_response(&connection, &driver, response),
        }
    }
    reject_pending_dbgp_requests(&connection.pending);
    let _ = driver.send(DriverMessage::Disconnected);
}

fn route_response(
    connection: &DbgpConnection,
    driver: &mpsc::Sender<DriverMessage>,
    response: DbgpResponse,
) {
    let Some(transaction_id) = response.transaction_id else {
        return;
    };
    let continuation_reason = connection
        .continuations
        .lock()
        .ok()
        .and_then(|mut continuations| continuations.remove(&transaction_id));
    if let Some(reason) = continuation_reason {
        let _ = driver.send(DriverMessage::Continuation { response, reason });
        return;
    }
    let sender = connection
        .pending
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&transaction_id));
    if let Some(sender) = sender {
        let _ = sender.send(response);
    }
}

fn read_dbgp_packet(reader: &mut impl BufRead) -> Result<Option<String>, String> {
    let mut length_bytes = Vec::new();
    let read = reader
        .read_until(0, &mut length_bytes)
        .map_err(|error| error.to_string())?;
    if read == 0 {
        return Ok(None);
    }
    if length_bytes.pop() != Some(0) {
        return Ok(None);
    }
    let length: usize = std::str::from_utf8(&length_bytes)
        .ok()
        .and_then(|text| text.trim().parse().ok())
        .ok_or_else(|| "Malformed DBGp packet length.".to_string())?;
    if length > MAX_DBGP_PACKET_LENGTH {
        return Err(format!(
            "DBGp packet length {length} exceeds the {MAX_DBGP_PACKET_LENGTH}-byte limit; closing the Xdebug connection."
        ));
    }
    let mut xml = vec![0u8; length];
    reader
        .read_exact(&mut xml)
        .map_err(|error| error.to_string())?;
    let mut terminator = [0u8; 1];
    reader
        .read_exact(&mut terminator)
        .map_err(|error| error.to_string())?;
    Ok(Some(String::from_utf8_lossy(&xml).to_string()))
}

fn run_driver(
    inner: Arc<DbgpAdapterInner>,
    connection: Arc<DbgpConnection>,
    receiver: mpsc::Receiver<DriverMessage>,
    finish: Option<ConnectionFinish>,
) {
    while let Ok(message) = receiver.recv() {
        match message {
            DriverMessage::Init(_) => {
                if handle_init(&inner, &connection).is_err() {
                    connection.close();
                }
            }
            DriverMessage::Continuation { response, reason } => {
                handle_continuation(&inner, &connection, &response, reason);
            }
            DriverMessage::Notify(notify) => handle_notify(&inner, &notify),
            DriverMessage::Disconnected => break,
        }
    }
    if let Ok(mut shared) = inner.shared.lock() {
        shared.status = DbgpStatus::Stopped;
        shared.pause = None;
    }
    let Some(finish) = finish else {
        return;
    };
    finish.listener_shutdown.store(true, Ordering::SeqCst);
    let callback = finish.callback.lock().ok().and_then(|mut slot| slot.take());
    if let Some(callback) = callback {
        callback(None);
    }
}

fn handle_init(
    inner: &Arc<DbgpAdapterInner>,
    connection: &Arc<DbgpConnection>,
) -> Result<(), String> {
    for (feature, value) in DBGP_FEATURES {
        connection.request("feature_set", &format!(" -n {feature} -v {value}"), None)?;
    }
    let files: Vec<String> = {
        let shared = inner.shared.lock().map_err(|error| error.to_string())?;
        shared.breakpoints_by_file.keys().cloned().collect()
    };
    for file_path in files {
        let breakpoints = {
            let shared = inner.shared.lock().map_err(|error| error.to_string())?;
            shared
                .breakpoints_by_file
                .get(&file_path)
                .cloned()
                .unwrap_or_default()
        };
        let applied = apply_breakpoints(inner, connection, &file_path, &breakpoints)?;
        inner.emitter.emit(DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints: applied,
        });
    }
    {
        let mut shared = inner.shared.lock().map_err(|error| error.to_string())?;
        shared.status = DbgpStatus::Running;
    }
    connection.send_continuation("run", DebugStopReason::Breakpoint)
}

fn handle_continuation(
    inner: &Arc<DbgpAdapterInner>,
    connection: &Arc<DbgpConnection>,
    response: &DbgpResponse,
    reason: DebugStopReason,
) {
    match response.status.as_deref() {
        Some("break") => handle_break(inner, connection, reason),
        Some("stopping") | Some("stopped") => {
            if response.status.as_deref() == Some("stopping") {
                connection.fire_and_forget("stop");
            }
            connection.close();
        }
        _ => {}
    }
}

fn handle_break(
    inner: &Arc<DbgpAdapterInner>,
    connection: &Arc<DbgpConnection>,
    reason: DebugStopReason,
) {
    let queued_files: Vec<String> = {
        let Ok(mut shared) = inner.shared.lock() else {
            return;
        };
        shared.status = DbgpStatus::Break;
        std::mem::take(&mut shared.queued_files)
    };
    for file_path in queued_files {
        let breakpoints = {
            let Ok(shared) = inner.shared.lock() else {
                return;
            };
            shared
                .breakpoints_by_file
                .get(&file_path)
                .cloned()
                .unwrap_or_default()
        };
        let Ok(applied) = apply_breakpoints(inner, connection, &file_path, &breakpoints) else {
            continue;
        };
        inner.emitter.emit(DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints: applied,
        });
    }
    let Ok(stack_response) = connection.request("stack_get", "", None) else {
        return;
    };
    let Ok(context_response) = connection.request("context_names", "", None) else {
        return;
    };
    let frames = {
        let Ok(mut shared) = inner.shared.lock() else {
            return;
        };
        let mut inventory = PauseInventory::default();
        for entry in &stack_response.stack {
            let frame_id = shared.allocate_reference();
            inventory.frame_depths.insert(frame_id, entry.level);
            inventory.frames.push(DebugStackFrame {
                frame_id,
                name: entry.where_name.clone(),
                file_path: entry.filename.as_deref().and_then(path_from_file_url),
                // DBGp line numbers are already 1-based; no conversion.
                line_number: entry.lineno,
                column: 1,
            });
            let mut scopes = Vec::new();
            for context in &context_response.contexts {
                let reference = shared.allocate_reference();
                inventory.slots.insert(
                    reference,
                    VariableSlot::Context {
                        depth: entry.level,
                        context_id: context.id,
                    },
                );
                scopes.push(DebugScopeInfo {
                    name: context.name.clone(),
                    variables_reference: reference,
                    expensive: context.name == "Superglobals",
                });
            }
            inventory.scopes.insert(frame_id, scopes);
        }
        let frames = inventory.frames.clone();
        shared.pause = Some(inventory);
        frames
    };
    inner
        .emitter
        .emit(DebugEventPayload::Stopped { reason, frames });
}

fn handle_notify(inner: &Arc<DbgpAdapterInner>, notify: &DbgpNotify) {
    if notify.name != "breakpoint_resolved" {
        return;
    }
    let Some(info) = &notify.breakpoint else {
        return;
    };
    let resolved = {
        let Ok(mut shared) = inner.shared.lock() else {
            return;
        };
        apply_breakpoint_resolution(&mut shared, &info.id, info.lineno)
    };
    let Some((file_path, breakpoints)) = resolved else {
        return;
    };
    inner.emitter.emit(DebugEventPayload::BreakpointsVerified {
        file_path,
        breakpoints,
    });
}

/// A resolution for a not-yet-registered DBGp breakpoint id is buffered in
/// `pending_resolutions` so `apply_breakpoints` can consume it after the
/// `breakpoint_set` response lands.
fn apply_breakpoint_resolution(
    state: &mut DbgpShared,
    dbgp_breakpoint_id: &str,
    resolved_line: Option<u32>,
) -> Option<(String, Vec<DebugBreakpoint>)> {
    let Some(target) = state.resolution_index.remove(dbgp_breakpoint_id) else {
        state
            .pending_resolutions
            .insert(dbgp_breakpoint_id.to_string(), resolved_line.unwrap_or(0));
        return None;
    };
    let breakpoints = state.breakpoints_by_file.get_mut(&target.file_path)?;
    let entry = breakpoints
        .iter_mut()
        .find(|breakpoint| breakpoint.id == target.breakpoint_id)?;
    entry.verified = true;
    if let Some(line) = resolved_line {
        entry.line_number = line;
    }
    Some((target.file_path, breakpoints.clone()))
}

fn apply_breakpoints(
    inner: &DbgpAdapterInner,
    connection: &DbgpConnection,
    file_path: &str,
    breakpoints: &[DebugBreakpoint],
) -> Result<Vec<DebugBreakpoint>, String> {
    let previous_ids = {
        let mut shared = inner.shared.lock().map_err(|error| error.to_string())?;
        let ids = shared
            .dbgp_ids_by_file
            .remove(file_path)
            .unwrap_or_default();
        for id in &ids {
            shared.resolution_index.remove(id);
        }
        ids
    };
    for breakpoint_id in previous_ids {
        let _ = connection.request("breakpoint_remove", &format!(" -d {breakpoint_id}"), None);
    }
    let file_url = fs::canonicalize(file_path)
        .ok()
        .map(|canonical| file_url_from_path(&canonical.to_string_lossy()));
    let mut registered_ids = Vec::new();
    let mut applied = Vec::with_capacity(breakpoints.len());
    for breakpoint in breakpoints {
        let mut updated = breakpoint.clone();
        updated.verified = false;
        let Some(file_url) = file_url.as_ref() else {
            applied.push(updated);
            continue;
        };
        if !breakpoint.enabled {
            applied.push(updated);
            continue;
        }
        let breakpoint_kind = if breakpoint.condition.is_some() {
            "conditional"
        } else {
            "line"
        };
        // DBGp line numbers are already 1-based; no conversion.
        let arguments = format!(
            " -t {breakpoint_kind} -f {file_url} -n {}",
            breakpoint.line_number
        );
        let Ok(response) = connection.request(
            "breakpoint_set",
            &arguments,
            breakpoint.condition.as_deref(),
        ) else {
            applied.push(updated);
            continue;
        };
        if response.error.is_some() {
            applied.push(updated);
            continue;
        }
        let Some(dbgp_id) = response.breakpoint_id.clone() else {
            applied.push(updated);
            continue;
        };
        registered_ids.push(dbgp_id.clone());
        if response.resolved.as_deref() == Some("resolved") {
            updated.verified = true;
        } else {
            let mut shared = inner.shared.lock().map_err(|error| error.to_string())?;
            match shared.pending_resolutions.remove(&dbgp_id) {
                Some(line) => {
                    updated.verified = true;
                    if line > 0 {
                        updated.line_number = line;
                    }
                }
                None => {
                    shared.resolution_index.insert(
                        dbgp_id,
                        BreakpointResolutionTarget {
                            breakpoint_id: breakpoint.id.clone(),
                            file_path: file_path.to_string(),
                        },
                    );
                }
            }
        }
        applied.push(updated);
    }
    {
        let mut shared = inner.shared.lock().map_err(|error| error.to_string())?;
        shared
            .dbgp_ids_by_file
            .insert(file_path.to_string(), registered_ids);
        shared
            .breakpoints_by_file
            .insert(file_path.to_string(), applied.clone());
    }
    Ok(applied)
}

struct PhpDbgpAdapter {
    inner: Arc<DbgpAdapterInner>,
    listener_shutdown: Option<Arc<AtomicBool>>,
    process: Option<DebugProcessHandle>,
}

impl PhpDbgpAdapter {
    fn shutdown(&mut self) {
        if let Some(shutdown) = self.listener_shutdown.take() {
            shutdown.store(true, Ordering::SeqCst);
        }
        let connection = self
            .inner
            .connection
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        if let Some(connection) = connection {
            connection.fire_and_forget("stop");
            connection.close();
        }
        if let Some(process) = self.process.take() {
            process.terminate();
        }
        if let Ok(mut shared) = self.inner.shared.lock() {
            shared.status = DbgpStatus::Stopped;
            shared.pause = None;
        }
    }

    fn build_variables(
        &self,
        properties: &[DbgpProperty],
        depth: u32,
        context_id: u32,
        expected_total: Option<u32>,
    ) -> Result<Vec<DebugVariableInfo>, String> {
        let mut shared = self
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        if shared.pause.is_none() {
            return Err(NOT_PAUSED_ERROR.to_string());
        }
        let mut variables = Vec::with_capacity(properties.len());
        for property in properties {
            variables.push(variable_from_property(
                &mut shared,
                property,
                depth,
                context_id,
            ));
        }
        if let Some(total) = expected_total {
            if (total as usize) > properties.len() {
                variables.push(DebugVariableInfo {
                    name: "...".to_string(),
                    value: format!("({} more)", total as usize - properties.len()),
                    value_type: None,
                    variables_reference: 0,
                });
            }
        }
        Ok(variables)
    }
}

fn variable_from_property(
    shared: &mut DbgpShared,
    property: &DbgpProperty,
    depth: u32,
    context_id: u32,
) -> DebugVariableInfo {
    let variables_reference = match (&property.fullname, property.has_children) {
        (Some(fullname), true) => {
            let reference = shared.allocate_reference();
            if let Some(pause) = shared.pause.as_mut() {
                pause.slots.insert(
                    reference,
                    VariableSlot::Property {
                        depth,
                        context_id,
                        fullname: fullname.clone(),
                    },
                );
                reference
            } else {
                0
            }
        }
        _ => 0,
    };
    DebugVariableInfo {
        name: property.name.clone(),
        value: property_display_value(property),
        value_type: property
            .classname
            .clone()
            .or_else(|| property.property_type.clone()),
        variables_reference,
    }
}

fn property_display_value(property: &DbgpProperty) -> String {
    match property.property_type.as_deref() {
        Some("object") => property
            .classname
            .clone()
            .unwrap_or_else(|| "object".to_string()),
        Some("array") => format!("array({})", property.numchildren),
        Some("null") => "null".to_string(),
        Some("uninitialized") => "uninitialized".to_string(),
        _ => {
            let mut value = property.value.clone();
            if property.size.is_some_and(|size| size > value.len()) {
                value.push_str("...");
            }
            value
        }
    }
}

fn dbgp_error_message(error: &DbgpError, command: &str) -> String {
    if !error.message.is_empty() {
        return error.message.clone();
    }
    format!("Xdebug command `{command}` failed (code {}).", error.code)
}

fn quote_argument(value: &str) -> String {
    if !value.contains(' ') && !value.contains('"') {
        return value.to_string();
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

impl DebugAdapter for PhpDbgpAdapter {
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        let connection = self
            .inner
            .connection
            .lock()
            .map_err(|error| error.to_string())?
            .clone();
        let status = {
            let shared = self
                .inner
                .shared
                .lock()
                .map_err(|error| error.to_string())?;
            shared.status
        };
        if let Some(connection) = connection {
            if matches!(status, DbgpStatus::Starting | DbgpStatus::Break) {
                return apply_breakpoints(&self.inner, &connection, file_path, breakpoints);
            }
        }
        let stored: Vec<DebugBreakpoint> = breakpoints
            .iter()
            .map(|breakpoint| {
                let mut updated = breakpoint.clone();
                updated.verified = false;
                updated
            })
            .collect();
        let mut shared = self
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        shared
            .breakpoints_by_file
            .insert(file_path.to_string(), stored.clone());
        if shared.status == DbgpStatus::Running
            && !shared.queued_files.iter().any(|queued| queued == file_path)
        {
            shared.queued_files.push(file_path.to_string());
        }
        Ok(stored)
    }

    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        let connection = self.inner.active_connection()?;
        {
            let mut shared = self
                .inner
                .shared
                .lock()
                .map_err(|error| error.to_string())?;
            if shared.status != DbgpStatus::Break {
                return Err("The PHP script is not paused.".to_string());
            }
            shared.status = DbgpStatus::Running;
            shared.pause = None;
        }
        let (command, reason) = match kind {
            StepKind::Continue => ("run", DebugStopReason::Breakpoint),
            StepKind::StepOver => ("step_over", DebugStopReason::Step),
            StepKind::StepInto => ("step_into", DebugStopReason::Step),
            StepKind::StepOut => ("step_out", DebugStopReason::Step),
        };
        connection.send_continuation(command, reason)?;
        self.inner.emitter.emit(DebugEventPayload::Resumed);
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        Err("Xdebug cannot pause a running script.".to_string())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        let shared = self
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
        Ok(pause.frames.clone())
    }

    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        let shared = self
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
        pause
            .scopes
            .get(&frame_id)
            .cloned()
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))
    }

    fn variables(&mut self, reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
        let connection = self.inner.active_connection()?;
        let slot = {
            let shared = self
                .inner
                .shared
                .lock()
                .map_err(|error| error.to_string())?;
            let pause = shared
                .pause
                .as_ref()
                .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
            pause
                .slots
                .get(&reference)
                .cloned()
                .ok_or_else(|| format!("Unknown variables reference {reference}."))?
        };
        match slot {
            VariableSlot::Context { depth, context_id } => {
                let response = connection.request(
                    "context_get",
                    &format!(" -d {depth} -c {context_id}"),
                    None,
                )?;
                if let Some(error) = &response.error {
                    return Err(dbgp_error_message(error, "context_get"));
                }
                self.build_variables(&response.properties, depth, context_id, None)
            }
            VariableSlot::Property {
                depth,
                context_id,
                fullname,
            } => {
                let arguments = format!(
                    " -d {depth} -c {context_id} -n {} -p 0",
                    quote_argument(&fullname)
                );
                let response = connection.request("property_get", &arguments, None)?;
                if let Some(error) = &response.error {
                    return Err(dbgp_error_message(error, "property_get"));
                }
                let property = response
                    .properties
                    .into_iter()
                    .next()
                    .ok_or_else(|| "Xdebug returned no property data.".to_string())?;
                let total = property.numchildren;
                self.build_variables(&property.children, depth, context_id, Some(total))
            }
        }
    }

    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        let connection = self.inner.active_connection()?;
        let depth = {
            let shared = self
                .inner
                .shared
                .lock()
                .map_err(|error| error.to_string())?;
            let pause = shared
                .pause
                .as_ref()
                .ok_or_else(|| NOT_PAUSED_ERROR.to_string())?;
            *pause
                .frame_depths
                .get(&frame_id)
                .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?
        };
        let response = connection.request("eval", &format!(" -d {depth}"), Some(expression))?;
        if let Some(error) = &response.error {
            return Err(dbgp_error_message(error, "eval"));
        }
        let property = response
            .properties
            .first()
            .ok_or_else(|| "Evaluation returned no result.".to_string())?;
        let mut shared = self
            .inner
            .shared
            .lock()
            .map_err(|error| error.to_string())?;
        if shared.pause.is_none() {
            return Err(NOT_PAUSED_ERROR.to_string());
        }
        let mut variable = variable_from_property(&mut shared, property, 0, 0);
        variable.name = expression.to_string();
        Ok(variable)
    }

    fn terminate(&mut self) {
        self.shutdown();
    }
}

impl Drop for PhpDbgpAdapter {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Debug, Default)]
struct DbgpInit {
    file_uri: String,
}

#[derive(Debug, Default)]
struct DbgpNotify {
    name: String,
    breakpoint: Option<DbgpNotifyBreakpoint>,
}

#[derive(Debug, Default)]
struct DbgpNotifyBreakpoint {
    id: String,
    lineno: Option<u32>,
}

#[derive(Clone, Debug, Default)]
struct DbgpError {
    code: String,
    message: String,
}

#[derive(Debug, Default)]
struct DbgpStackEntry {
    level: u32,
    where_name: String,
    filename: Option<String>,
    lineno: u32,
}

#[derive(Debug, Default)]
struct DbgpContextName {
    id: u32,
    name: String,
}

#[derive(Clone, Debug, Default)]
struct DbgpProperty {
    name: String,
    fullname: Option<String>,
    property_type: Option<String>,
    classname: Option<String>,
    has_children: bool,
    numchildren: u32,
    size: Option<usize>,
    encoding: Option<String>,
    raw_text: String,
    value: String,
    children: Vec<DbgpProperty>,
}

#[derive(Debug, Default)]
struct DbgpResponse {
    command: String,
    transaction_id: Option<u64>,
    status: Option<String>,
    breakpoint_id: Option<String>,
    resolved: Option<String>,
    error: Option<DbgpError>,
    stack: Vec<DbgpStackEntry>,
    contexts: Vec<DbgpContextName>,
    properties: Vec<DbgpProperty>,
}

enum DbgpMessage {
    Init(DbgpInit),
    Notify(DbgpNotify),
    Response(DbgpResponse),
}

fn parse_dbgp_message(xml: &str) -> Option<DbgpMessage> {
    let mut reader = XmlReader::from_reader(xml.as_bytes());
    let mut buffer = Vec::new();
    let mut init: Option<DbgpInit> = None;
    let mut notify: Option<DbgpNotify> = None;
    let mut response: Option<DbgpResponse> = None;
    let mut property_stack: Vec<DbgpProperty> = Vec::new();
    let mut in_error_message = false;
    let mut error_text = String::new();
    loop {
        let event = reader.read_event_into(&mut buffer).ok()?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let is_empty = matches!(event, Event::Empty(_));
                match element.name().local_name().as_ref() {
                    b"init" => {
                        init = Some(DbgpInit {
                            file_uri: attribute_value(&reader, element, b"fileuri")
                                .unwrap_or_default(),
                        });
                    }
                    b"response" => response = Some(response_from_attributes(&reader, element)),
                    b"notify" => {
                        notify = Some(DbgpNotify {
                            name: attribute_value(&reader, element, b"name").unwrap_or_default(),
                            breakpoint: None,
                        });
                    }
                    b"breakpoint" => {
                        if let Some(notify) = notify.as_mut() {
                            notify.breakpoint = Some(DbgpNotifyBreakpoint {
                                id: attribute_value(&reader, element, b"id").unwrap_or_default(),
                                lineno: attribute_value(&reader, element, b"lineno")
                                    .and_then(|value| value.parse().ok()),
                            });
                        }
                    }
                    b"stack" => {
                        if let Some(response) = response.as_mut() {
                            response.stack.push(DbgpStackEntry {
                                level: attribute_value(&reader, element, b"level")
                                    .and_then(|value| value.parse().ok())
                                    .unwrap_or(0),
                                where_name: attribute_value(&reader, element, b"where")
                                    .unwrap_or_else(|| "{main}".to_string()),
                                filename: attribute_value(&reader, element, b"filename"),
                                lineno: attribute_value(&reader, element, b"lineno")
                                    .and_then(|value| value.parse().ok())
                                    .unwrap_or(1),
                            });
                        }
                    }
                    b"context" => {
                        if let Some(response) = response.as_mut() {
                            response.contexts.push(DbgpContextName {
                                id: attribute_value(&reader, element, b"id")
                                    .and_then(|value| value.parse().ok())
                                    .unwrap_or(0),
                                name: attribute_value(&reader, element, b"name")
                                    .unwrap_or_default(),
                            });
                        }
                    }
                    b"property" => {
                        let property = property_from_attributes(&reader, element);
                        if is_empty {
                            attach_property(property, &mut property_stack, response.as_mut());
                        } else {
                            property_stack.push(property);
                        }
                    }
                    b"error" => {
                        if let Some(response) = response.as_mut() {
                            response.error = Some(DbgpError {
                                code: attribute_value(&reader, element, b"code")
                                    .unwrap_or_default(),
                                message: String::new(),
                            });
                        }
                    }
                    b"message" => {
                        let has_error = response
                            .as_ref()
                            .is_some_and(|response| response.error.is_some());
                        if has_error && !is_empty {
                            in_error_message = true;
                            error_text.clear();
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(text) => {
                let Ok(decoded) = text.decode() else {
                    continue;
                };
                if in_error_message {
                    error_text.push_str(&decoded);
                    continue;
                }
                if let Some(property) = property_stack.last_mut() {
                    property.raw_text.push_str(&decoded);
                }
            }
            Event::CData(text) => {
                let Ok(decoded) = text.decode() else {
                    continue;
                };
                if in_error_message {
                    error_text.push_str(&decoded);
                    continue;
                }
                if let Some(property) = property_stack.last_mut() {
                    property.raw_text.push_str(&decoded);
                }
            }
            Event::End(element) => match element.name().local_name().as_ref() {
                b"property" => {
                    let Some(property) = property_stack.pop() else {
                        continue;
                    };
                    attach_property(property, &mut property_stack, response.as_mut());
                }
                b"message" if in_error_message => {
                    in_error_message = false;
                    if let Some(error) = response.as_mut().and_then(|r| r.error.as_mut()) {
                        error.message = error_text.trim().to_string();
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    if let Some(init) = init {
        return Some(DbgpMessage::Init(init));
    }
    if let Some(notify) = notify {
        return Some(DbgpMessage::Notify(notify));
    }
    response.map(DbgpMessage::Response)
}

fn attach_property(
    mut property: DbgpProperty,
    property_stack: &mut [DbgpProperty],
    response: Option<&mut DbgpResponse>,
) {
    property.value = if property.encoding.as_deref() == Some("base64") {
        BASE64_STANDARD
            .decode(property.raw_text.trim())
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default()
    } else {
        property.raw_text.trim().to_string()
    };
    if let Some(parent) = property_stack.last_mut() {
        parent.children.push(property);
        return;
    }
    if let Some(response) = response {
        response.properties.push(property);
    }
}

fn response_from_attributes(reader: &XmlReader<&[u8]>, element: &BytesStart<'_>) -> DbgpResponse {
    DbgpResponse {
        command: attribute_value(reader, element, b"command").unwrap_or_default(),
        transaction_id: attribute_value(reader, element, b"transaction_id")
            .and_then(|value| value.parse().ok()),
        status: attribute_value(reader, element, b"status"),
        breakpoint_id: attribute_value(reader, element, b"id"),
        resolved: attribute_value(reader, element, b"resolved"),
        error: None,
        stack: Vec::new(),
        contexts: Vec::new(),
        properties: Vec::new(),
    }
}

fn property_from_attributes(reader: &XmlReader<&[u8]>, element: &BytesStart<'_>) -> DbgpProperty {
    DbgpProperty {
        name: attribute_value(reader, element, b"name").unwrap_or_default(),
        fullname: attribute_value(reader, element, b"fullname"),
        property_type: attribute_value(reader, element, b"type"),
        classname: attribute_value(reader, element, b"classname"),
        has_children: attribute_value(reader, element, b"children").as_deref() == Some("1"),
        numchildren: attribute_value(reader, element, b"numchildren")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        size: attribute_value(reader, element, b"size").and_then(|value| value.parse().ok()),
        encoding: attribute_value(reader, element, b"encoding"),
        raw_text: String::new(),
        value: String::new(),
        children: Vec::new(),
    }
}

fn attribute_value(
    reader: &XmlReader<&[u8]>,
    element: &BytesStart<'_>,
    name: &[u8],
) -> Option<String> {
    for attribute in element.attributes().flatten() {
        if attribute.key.local_name().as_ref() != name {
            continue;
        }
        return attribute
            .decode_and_unescape_value(reader.decoder())
            .ok()
            .map(|value| value.into_owned());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugEvent, DebugEventSink, DebugSessionRegistry};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicU32;

    const EVENT_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
    const WORKSPACE_KEY: &str = "/workspace/php-debug";
    const CLOSE_MARKER: &str = "<<close-connection>>";
    const XMLNS: &str =
        "xmlns=\"urn:debugger_protocol_v1\" xmlns:xdebug=\"https://xdebug.org/dbgp/xdebug\"";

    #[derive(Default)]
    struct CollectingSink {
        events: Mutex<Vec<DebugEvent>>,
    }

    impl CollectingSink {
        fn events(&self) -> Vec<DebugEvent> {
            self.events.lock().expect("events").clone()
        }

        fn payloads(&self) -> Vec<DebugEventPayload> {
            self.events()
                .into_iter()
                .map(|event| event.payload)
                .collect()
        }
    }

    impl DebugEventSink for CollectingSink {
        fn emit(&self, event: DebugEvent) {
            self.events.lock().expect("events").push(event);
        }
    }

    #[derive(Clone, Debug)]
    struct DbgpCommand {
        name: String,
        transaction_id: u64,
        arguments: HashMap<String, String>,
        data: Option<String>,
    }

    /// Parses the space-separated IDE command wire format. Quoted arguments are
    /// not handled; test fixtures only use fullnames without spaces.
    fn parse_command(line: &str) -> DbgpCommand {
        let (head, data) = match line.split_once(" -- ") {
            Some((head, data)) => (head, Some(data)),
            None => (line, None),
        };
        let mut tokens = head.split_whitespace();
        let name = tokens.next().unwrap_or_default().to_string();
        let mut arguments = HashMap::new();
        let mut transaction_id = 0;
        while let Some(token) = tokens.next() {
            let Some(flag) = token.strip_prefix('-') else {
                continue;
            };
            let value = tokens.next().unwrap_or_default().to_string();
            if flag == "i" {
                transaction_id = value.parse().unwrap_or(0);
            }
            arguments.insert(flag.to_string(), value);
        }
        let data = data.map(|encoded| {
            String::from_utf8_lossy(&BASE64_STANDARD.decode(encoded.trim()).unwrap_or_default())
                .to_string()
        });
        DbgpCommand {
            name,
            transaction_id,
            arguments,
            data,
        }
    }

    type MockXdebugResponder = Box<dyn FnMut(&DbgpCommand) -> Vec<String> + Send>;

    /// Scripted TCP client playing the Xdebug engine role: it connects to the
    /// adapter's listener, sends the init packet, then answers IDE commands
    /// with canned Xdebug 3 XML packets (mirror of `MockCdpServer`).
    struct MockXdebugClient {
        commands: Arc<Mutex<Vec<DbgpCommand>>>,
        writer: Arc<Mutex<TcpStream>>,
        _handle: thread::JoinHandle<()>,
    }

    impl MockXdebugClient {
        fn connect(port: u16, mut responder: MockXdebugResponder) -> Self {
            let stream = TcpStream::connect(("127.0.0.1", port)).expect("connect mock client");
            let writer = Arc::new(Mutex::new(stream.try_clone().expect("clone mock stream")));
            let commands: Arc<Mutex<Vec<DbgpCommand>>> = Arc::new(Mutex::new(Vec::new()));
            send_engine_packet(&writer, &init_xml("/workspace/php/index.php"));
            let recorded = Arc::clone(&commands);
            let reply_writer = Arc::clone(&writer);
            let handle = thread::spawn(move || {
                let mut reader = BufReader::new(stream);
                loop {
                    let mut raw = Vec::new();
                    let Ok(read) = reader.read_until(0, &mut raw) else {
                        break;
                    };
                    if read == 0 {
                        break;
                    }
                    if raw.last() == Some(&0) {
                        raw.pop();
                    }
                    let command = parse_command(&String::from_utf8_lossy(&raw));
                    recorded
                        .lock()
                        .expect("mock commands")
                        .push(command.clone());
                    for reply in responder(&command) {
                        if reply == CLOSE_MARKER {
                            if let Ok(stream) = reply_writer.lock() {
                                let _ = stream.shutdown(Shutdown::Both);
                            }
                            return;
                        }
                        send_engine_packet(&reply_writer, &reply);
                    }
                }
            });
            Self {
                commands,
                writer,
                _handle: handle,
            }
        }

        fn commands(&self) -> Vec<DbgpCommand> {
            self.commands.lock().expect("mock commands").clone()
        }

        fn command_names(&self) -> Vec<String> {
            self.commands()
                .into_iter()
                .map(|command| command.name)
                .collect()
        }

        fn inject(&self, xml: &str) {
            send_engine_packet(&self.writer, xml);
        }

        fn close(&self) {
            if let Ok(stream) = self.writer.lock() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }

    fn send_engine_packet(writer: &Arc<Mutex<TcpStream>>, xml: &str) {
        let mut payload = Vec::with_capacity(xml.len() + 8);
        payload.extend_from_slice(xml.len().to_string().as_bytes());
        payload.push(0);
        payload.extend_from_slice(xml.as_bytes());
        payload.push(0);
        let Ok(mut stream) = writer.lock() else {
            return;
        };
        let _ = stream.write_all(&payload);
    }

    fn init_xml(script: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<init {XMLNS} fileuri=\"{}\" language=\"PHP\" xdebug:language_version=\"8.3.0\" protocol_version=\"1.0\" appid=\"123\" idekey=\"CODEVO\"></init>",
            file_url_from_path(script)
        )
    }

    fn response_xml(
        command: &str,
        transaction_id: u64,
        extra_attributes: &str,
        body: &str,
    ) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<response {XMLNS} command=\"{command}\" transaction_id=\"{transaction_id}\"{extra_attributes}>{body}</response>"
        )
    }

    fn breakpoint_set_response(transaction_id: u64, breakpoint_id: &str, resolved: bool) -> String {
        let state = if resolved { "resolved" } else { "unresolved" };
        response_xml(
            "breakpoint_set",
            transaction_id,
            &format!(" state=\"enabled\" id=\"{breakpoint_id}\" resolved=\"{state}\""),
            "",
        )
    }

    fn break_response(command: &str, transaction_id: u64) -> String {
        response_xml(
            command,
            transaction_id,
            " status=\"break\" reason=\"ok\"",
            "<xdebug:message filename=\"file:///workspace/php/index.php\" lineno=\"5\"/>",
        )
    }

    fn stack_response(transaction_id: u64) -> String {
        response_xml(
            "stack_get",
            transaction_id,
            "",
            concat!(
                "<stack where=\"App\\Service::handle\" level=\"0\" type=\"file\" ",
                "filename=\"file:///workspace/php/src/my%20service.php\" lineno=\"7\"/>",
                "<stack where=\"{main}\" level=\"1\" type=\"file\" ",
                "filename=\"file:///workspace/php/index.php\" lineno=\"12\"/>"
            ),
        )
    }

    fn context_names_response(transaction_id: u64) -> String {
        response_xml(
            "context_names",
            transaction_id,
            "",
            "<context name=\"Locals\" id=\"0\"/><context name=\"Superglobals\" id=\"1\"/>",
        )
    }

    fn context_get_response(transaction_id: u64) -> String {
        let label = BASE64_STANDARD.encode("ready");
        let clipped = BASE64_STANDARD.encode("abcde");
        response_xml(
            "context_get",
            transaction_id,
            " context=\"0\"",
            &format!(
                concat!(
                    "<property name=\"$count\" fullname=\"$count\" type=\"int\">7</property>",
                    "<property name=\"$label\" fullname=\"$label\" type=\"string\" ",
                    "size=\"5\" encoding=\"base64\"><![CDATA[{label}]]></property>",
                    "<property name=\"$clipped\" fullname=\"$clipped\" type=\"string\" ",
                    "size=\"10\" encoding=\"base64\"><![CDATA[{clipped}]]></property>",
                    "<property name=\"$user\" fullname=\"$user\" type=\"object\" ",
                    "classname=\"App\\User\" children=\"1\" numchildren=\"2\" page=\"0\" ",
                    "pagesize=\"100\"></property>"
                ),
                label = label,
                clipped = clipped,
            ),
        )
    }

    fn property_get_response(transaction_id: u64) -> String {
        let name = BASE64_STANDARD.encode("Ana");
        response_xml(
            "property_get",
            transaction_id,
            "",
            &format!(
                concat!(
                    "<property name=\"$user\" fullname=\"$user\" type=\"object\" ",
                    "classname=\"App\\User\" children=\"1\" numchildren=\"150\" page=\"0\" ",
                    "pagesize=\"100\">",
                    "<property name=\"id\" fullname=\"$user-&gt;id\" type=\"int\">1</property>",
                    "<property name=\"name\" fullname=\"$user-&gt;name\" type=\"string\" ",
                    "size=\"3\" encoding=\"base64\"><![CDATA[{name}]]></property>",
                    "</property>"
                ),
                name = name,
            ),
        )
    }

    fn eval_response(transaction_id: u64) -> String {
        let value = BASE64_STANDARD.encode("evaluated");
        response_xml(
            "eval",
            transaction_id,
            "",
            &format!(
                "<property type=\"string\" size=\"9\" encoding=\"base64\"><![CDATA[{value}]]></property>"
            ),
        )
    }

    fn eval_error_response(transaction_id: u64) -> String {
        response_xml(
            "eval",
            transaction_id,
            "",
            "<error code=\"206\"><message><![CDATA[Cannot evaluate]]></message></error>",
        )
    }

    fn notify_resolved_xml(breakpoint_id: &str, lineno: u32) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<notify {XMLNS} name=\"breakpoint_resolved\"><breakpoint type=\"line\" resolved=\"resolved\" filename=\"file:///workspace/php/index.php\" lineno=\"{lineno}\" state=\"enabled\" hit_count=\"0\" hit_value=\"0\" id=\"{breakpoint_id}\"></breakpoint></notify>"
        )
    }

    fn default_replies(command: &DbgpCommand) -> Vec<String> {
        let transaction_id = command.transaction_id;
        match command.name.as_str() {
            "feature_set" => vec![response_xml(
                "feature_set",
                transaction_id,
                " feature=\"x\" success=\"1\"",
                "",
            )],
            "breakpoint_set" => vec![breakpoint_set_response(
                transaction_id,
                &format!("dbgp-bp-{transaction_id}"),
                true,
            )],
            "run" | "step_over" | "step_into" | "step_out" => {
                vec![break_response(&command.name, transaction_id)]
            }
            "stack_get" => vec![stack_response(transaction_id)],
            "context_names" => vec![context_names_response(transaction_id)],
            "context_get" => vec![context_get_response(transaction_id)],
            "property_get" => vec![property_get_response(transaction_id)],
            "eval" => vec![eval_response(transaction_id)],
            "stop" => vec![response_xml(
                "stop",
                transaction_id,
                " status=\"stopped\" reason=\"ok\"",
                "",
            )],
            _ => vec![response_xml(&command.name, transaction_id, "", "")],
        }
    }

    fn default_responder() -> MockXdebugResponder {
        Box::new(|command| default_replies(command))
    }

    fn scripted_responder(
        mut overrides: impl FnMut(&DbgpCommand) -> Option<Vec<String>> + Send + 'static,
    ) -> MockXdebugResponder {
        Box::new(move |command| overrides(command).unwrap_or_else(|| default_replies(command)))
    }

    struct ListenSession {
        registry: DebugSessionRegistry,
        sink: Arc<CollectingSink>,
        port: u16,
        finish_receiver: mpsc::Receiver<Option<i32>>,
    }

    fn start_listen_session(
        root: &Path,
        initial_breakpoints: Vec<DebugBreakpoint>,
    ) -> ListenSession {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let (finish_tx, finish_receiver) = mpsc::channel();
        let root = root.to_path_buf();
        registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                create_php_dbgp_adapter(
                    &root,
                    &DebugLaunchTarget::PhpListen { port: Some(0) },
                    &initial_breakpoints,
                    emitter,
                    Box::new(move |exit_code| {
                        let _ = finish_tx.send(exit_code);
                    }),
                )
            })
            .expect("start listen session");
        let port = wait_for(
            || listen_port_from_events(&sink),
            EVENT_WAIT_TIMEOUT,
            "listening output event",
        );
        ListenSession {
            registry,
            sink,
            port,
            finish_receiver,
        }
    }

    fn listen_port_from_events(sink: &CollectingSink) -> Option<u16> {
        sink.payloads()
            .into_iter()
            .find_map(|payload| match payload {
                DebugEventPayload::Output { text, .. } => text
                    .strip_prefix("Listening for Xdebug connections on 127.0.0.1:")?
                    .strip_suffix("...")?
                    .parse()
                    .ok(),
                _ => None,
            })
    }

    fn wait_for<T>(predicate: impl Fn() -> Option<T>, timeout: Duration, description: &str) -> T {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(value) = predicate() {
                return value;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {description}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_command(client: &MockXdebugClient, name: &str) -> DbgpCommand {
        let expected = name.to_string();
        wait_for(
            || {
                client
                    .commands()
                    .into_iter()
                    .find(|command| command.name == expected)
            },
            EVENT_WAIT_TIMEOUT,
            name,
        )
    }

    fn wait_for_stopped(
        sink: &CollectingSink,
        index: usize,
    ) -> (DebugStopReason, Vec<DebugStackFrame>) {
        wait_for(
            || {
                sink.payloads()
                    .into_iter()
                    .filter_map(|payload| match payload {
                        DebugEventPayload::Stopped { reason, frames } => Some((reason, frames)),
                        _ => None,
                    })
                    .nth(index)
            },
            EVENT_WAIT_TIMEOUT,
            "stopped event",
        )
    }

    fn verified_events(sink: &CollectingSink) -> Vec<(String, Vec<DebugBreakpoint>)> {
        sink.payloads()
            .into_iter()
            .filter_map(|payload| match payload {
                DebugEventPayload::BreakpointsVerified {
                    file_path,
                    breakpoints,
                } => Some((file_path, breakpoints)),
                _ => None,
            })
            .collect()
    }

    fn breakpoint(
        file_path: &str,
        id: &str,
        line_number: u32,
        condition: Option<&str>,
        enabled: bool,
    ) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.to_string(),
            file_path: file_path.to_string(),
            line_number,
            condition: condition.map(str::to_string),
            enabled,
            verified: false,
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let directory = std::env::temp_dir().join(format!(
            "debug-dbgp-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).expect("create temp root");
        directory.canonicalize().expect("canonicalize temp root")
    }

    fn breakpoint_fixture_file(name: &str) -> PathBuf {
        let root = temp_root(name);
        let file = root.join("src").join("app.php");
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(&file, "<?php echo 'breakpoint fixture';").expect("write fixture file");
        file
    }

    #[test]
    fn listen_handshake_applies_features_and_initial_breakpoints_before_run() {
        let file = breakpoint_fixture_file("handshake");
        let file_path = file.to_string_lossy().to_string();
        let session = start_listen_session(
            file.parent().expect("fixture parent"),
            vec![
                breakpoint(&file_path, "bp-1", 12, Some("count > 3"), true),
                breakpoint(&file_path, "bp-2", 20, None, false),
            ],
        );
        let client = MockXdebugClient::connect(session.port, default_responder());

        wait_for_command(&client, "run");

        let names: Vec<String> = client.command_names().into_iter().take(7).collect();
        assert_eq!(
            names,
            vec![
                "feature_set",
                "feature_set",
                "feature_set",
                "feature_set",
                "feature_set",
                "breakpoint_set",
                "run",
            ]
        );
        let features: Vec<(String, String)> = client
            .commands()
            .into_iter()
            .filter(|command| command.name == "feature_set")
            .map(|command| {
                (
                    command.arguments.get("n").cloned().unwrap_or_default(),
                    command.arguments.get("v").cloned().unwrap_or_default(),
                )
            })
            .collect();
        assert_eq!(
            features,
            vec![
                ("max_depth".to_string(), "1".to_string()),
                ("max_children".to_string(), "100".to_string()),
                ("max_data".to_string(), "4096".to_string()),
                ("notify_ok".to_string(), "1".to_string()),
                ("resolved_breakpoints".to_string(), "1".to_string()),
            ]
        );
        let set = wait_for_command(&client, "breakpoint_set");
        assert_eq!(
            set.arguments.get("t").map(String::as_str),
            Some("conditional")
        );
        assert_eq!(
            set.arguments.get("f").cloned(),
            Some(file_url_from_path(&file_path))
        );
        assert_eq!(set.arguments.get("n").map(String::as_str), Some("12"));
        assert_eq!(set.data.as_deref(), Some("count > 3"));
        let verified = wait_for(
            || verified_events(&session.sink).into_iter().next(),
            EVENT_WAIT_TIMEOUT,
            "breakpoints verified event",
        );
        assert_eq!(verified.0, file_path);
        assert_eq!(verified.1.len(), 2);
        assert!(verified.1[0].verified);
        assert_eq!(verified.1[0].line_number, 12);
        assert!(!verified.1[1].verified);
    }

    #[test]
    fn break_status_emits_stopped_with_decoded_one_based_frames() {
        let root = temp_root("break-frames");
        let session = start_listen_session(&root, Vec::new());
        let _client = MockXdebugClient::connect(session.port, default_responder());

        let (reason, frames) = wait_for_stopped(&session.sink, 0);

        assert_eq!(reason, DebugStopReason::Breakpoint);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].name, "App\\Service::handle");
        assert_eq!(
            frames[0].file_path,
            Some("/workspace/php/src/my service.php".to_string())
        );
        assert_eq!(frames[0].line_number, 7);
        assert_eq!(frames[1].name, "{main}");
        assert_eq!(
            frames[1].file_path,
            Some("/workspace/php/index.php".to_string())
        );
        assert_eq!(frames[1].line_number, 12);
        let resumed = session
            .sink
            .payloads()
            .into_iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count();
        assert_eq!(resumed, 0);
    }

    #[test]
    fn step_commands_emit_resumed_and_stop_with_step_reason() {
        let root = temp_root("step");
        let session = start_listen_session(&root, Vec::new());
        let client = MockXdebugClient::connect(session.port, default_responder());
        wait_for_stopped(&session.sink, 0);

        session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
            .expect("session")
            .expect("step over");
        let (reason, _) = wait_for_stopped(&session.sink, 1);

        assert_eq!(reason, DebugStopReason::Step);
        assert!(client.command_names().contains(&"step_over".to_string()));
        let resumed = session
            .sink
            .payloads()
            .into_iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count();
        assert_eq!(resumed, 1);
    }

    #[test]
    fn variables_decode_base64_values_and_page_property_children() {
        let root = temp_root("variables");
        let session = start_listen_session(&root, Vec::new());
        let client = MockXdebugClient::connect(session.port, default_responder());
        let (_, frames) = wait_for_stopped(&session.sink, 0);

        let scopes = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.scopes(frames[0].frame_id))
            .expect("session")
            .expect("scopes");
        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[0].name, "Locals");
        assert!(!scopes[0].expensive);
        assert_eq!(scopes[1].name, "Superglobals");
        assert!(scopes[1].expensive);

        let variables = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables(scopes[0].variables_reference)
            })
            .expect("session")
            .expect("variables");
        let context_get = wait_for_command(&client, "context_get");
        assert_eq!(
            context_get.arguments.get("d").map(String::as_str),
            Some("0")
        );
        assert_eq!(
            context_get.arguments.get("c").map(String::as_str),
            Some("0")
        );
        assert_eq!(variables.len(), 4);
        assert_eq!(variables[0].name, "$count");
        assert_eq!(variables[0].value, "7");
        assert_eq!(variables[0].value_type, Some("int".to_string()));
        assert_eq!(variables[0].variables_reference, 0);
        assert_eq!(variables[1].name, "$label");
        assert_eq!(variables[1].value, "ready");
        assert_eq!(variables[2].name, "$clipped");
        assert_eq!(variables[2].value, "abcde...");
        assert_eq!(variables[3].name, "$user");
        assert_eq!(variables[3].value, "App\\User");
        assert_eq!(variables[3].value_type, Some("App\\User".to_string()));
        assert!(variables[3].variables_reference > 0);

        let children = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables(variables[3].variables_reference)
            })
            .expect("session")
            .expect("child variables");
        let property_get = wait_for_command(&client, "property_get");
        assert_eq!(
            property_get.arguments.get("n").map(String::as_str),
            Some("$user")
        );
        assert_eq!(
            property_get.arguments.get("d").map(String::as_str),
            Some("0")
        );
        assert_eq!(
            property_get.arguments.get("c").map(String::as_str),
            Some("0")
        );
        assert_eq!(children.len(), 3);
        assert_eq!(children[0].name, "id");
        assert_eq!(children[0].value, "1");
        assert_eq!(children[1].name, "name");
        assert_eq!(children[1].value, "Ana");
        assert_eq!(children[2].name, "...");
        assert_eq!(children[2].value, "(148 more)");
        assert_eq!(children[2].variables_reference, 0);
    }

    #[test]
    fn breakpoints_set_while_running_are_queued_and_flushed_on_break() {
        let file = breakpoint_fixture_file("queued");
        let file_path = file.to_string_lossy().to_string();
        let session = start_listen_session(file.parent().expect("fixture parent"), Vec::new());
        let client = MockXdebugClient::connect(
            session.port,
            scripted_responder(|command| (command.name == "run").then(Vec::new)),
        );
        let run = wait_for_command(&client, "run");

        let queued = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    &file_path,
                    &[breakpoint(&file_path, "bp-9", 30, None, true)],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        assert_eq!(queued.len(), 1);
        assert!(!queued[0].verified);
        assert!(!client
            .command_names()
            .contains(&"breakpoint_set".to_string()));

        client.inject(&break_response("run", run.transaction_id));

        let set = wait_for_command(&client, "breakpoint_set");
        assert_eq!(set.arguments.get("n").map(String::as_str), Some("30"));
        assert_eq!(set.arguments.get("t").map(String::as_str), Some("line"));
        let verified = wait_for(
            || verified_events(&session.sink).into_iter().next(),
            EVENT_WAIT_TIMEOUT,
            "flushed breakpoints verified event",
        );
        assert_eq!(verified.0, file_path);
        assert!(verified.1[0].verified);
        wait_for_stopped(&session.sink, 0);
    }

    #[test]
    fn second_connection_is_dropped_while_first_stays_active() {
        let root = temp_root("second-conn");
        let session = start_listen_session(&root, Vec::new());
        let _client = MockXdebugClient::connect(session.port, default_responder());
        let (_, frames) = wait_for_stopped(&session.sink, 0);

        let mut second = TcpStream::connect(("127.0.0.1", session.port)).expect("second connect");
        second
            .set_read_timeout(Some(Duration::from_secs(3)))
            .expect("read timeout");
        let mut buffer = [0u8; 16];
        let read = second.read(&mut buffer).expect("second connection read");
        assert_eq!(read, 0, "second connection must be dropped");

        let evaluated = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "count($items)")
            })
            .expect("session")
            .expect("evaluate on first connection");
        assert_eq!(evaluated.name, "count($items)");
        assert_eq!(evaluated.value, "evaluated");
    }

    #[test]
    fn connection_close_finishes_the_session_without_exit_code() {
        let root = temp_root("finish");
        let session = start_listen_session(&root, Vec::new());
        let client = MockXdebugClient::connect(session.port, default_responder());
        wait_for_stopped(&session.sink, 0);

        client.close();

        let exit_code = session
            .finish_receiver
            .recv_timeout(EVENT_WAIT_TIMEOUT)
            .expect("finish callback");
        assert_eq!(exit_code, None);
        let rebound = wait_for(
            || TcpListener::bind(("127.0.0.1", session.port)).ok(),
            EVENT_WAIT_TIMEOUT,
            "released Xdebug listener port",
        );
        drop(rebound);
    }

    #[test]
    fn dropping_listen_adapter_stops_accept_loop_and_releases_port() {
        let root = temp_root("drop-listener");
        let sink = Arc::new(CollectingSink::default());
        let registry = DebugSessionRegistry::new();
        registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                create_php_dbgp_adapter(
                    &root,
                    &DebugLaunchTarget::PhpListen { port: Some(0) },
                    &[],
                    emitter,
                    Box::new(|_| {}),
                )
            })
            .expect("listen adapter");
        let port = wait_for(
            || listen_port_from_events(&sink),
            EVENT_WAIT_TIMEOUT,
            "listener port",
        );

        drop(registry);

        let rebound = wait_for(
            || TcpListener::bind(("127.0.0.1", port)).ok(),
            EVENT_WAIT_TIMEOUT,
            "drop-released listener port",
        );
        drop(rebound);
    }

    #[test]
    fn evaluate_uses_selected_frame_depth_and_rejects_unknown_frames() {
        let root = temp_root("eval-depth");
        let session = start_listen_session(&root, Vec::new());
        let client = MockXdebugClient::connect(session.port, default_responder());
        let (_, frames) = wait_for_stopped(&session.sink, 0);

        session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[1].frame_id, "$invoice")
            })
            .expect("session")
            .expect("evaluate parent frame");
        let command = wait_for_command(&client, "eval");
        assert_eq!(command.arguments.get("d").map(String::as_str), Some("1"));

        let error = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(999_999, "$invoice")
            })
            .expect("session")
            .expect_err("unknown frame");
        assert_eq!(error, "Unknown debug frame 999999.");
        assert_eq!(
            client
                .commands()
                .into_iter()
                .filter(|command| command.name == "eval")
                .count(),
            1
        );
    }

    #[test]
    fn oversized_packet_length_closes_the_connection_without_allocating() {
        let root = temp_root("oversized");
        let session = start_listen_session(&root, Vec::new());
        let mut stream =
            TcpStream::connect(("127.0.0.1", session.port)).expect("connect rogue peer");

        stream
            .write_all(b"999999999999\0")
            .expect("write oversized length");

        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .expect("read timeout");
        let mut buffer = [0u8; 16];
        let read = stream.read(&mut buffer).unwrap_or(0);
        assert_eq!(read, 0, "connection must be closed");
        let exit_code = session
            .finish_receiver
            .recv_timeout(EVENT_WAIT_TIMEOUT)
            .expect("finish callback");
        assert_eq!(exit_code, None);
        let error_output = wait_for(
            || {
                session
                    .sink
                    .payloads()
                    .into_iter()
                    .find_map(|payload| match payload {
                        DebugEventPayload::Output {
                            stream: DebugOutputStream::Stderr,
                            text,
                        } => Some(text),
                        _ => None,
                    })
            },
            EVENT_WAIT_TIMEOUT,
            "oversized packet error output",
        );
        assert!(error_output.contains("exceeds"));
    }

    #[test]
    fn malformed_inbound_packets_are_ignored() {
        let root = temp_root("malformed");
        let session = start_listen_session(&root, Vec::new());
        let _client = MockXdebugClient::connect(
            session.port,
            scripted_responder(|command| {
                (command.name == "eval").then(|| {
                    vec![
                        "{ this is not xml".to_string(),
                        "<unexpected/>".to_string(),
                        eval_response(command.transaction_id),
                    ]
                })
            }),
        );
        let (_, frames) = wait_for_stopped(&session.sink, 0);

        let evaluated = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "1 + 1")
            })
            .expect("session")
            .expect("evaluate after malformed packets");

        assert_eq!(evaluated.value, "evaluated");
    }

    #[test]
    fn listen_bind_conflict_returns_already_in_use_error() {
        let blocker = TcpListener::bind(("127.0.0.1", 0)).expect("bind blocker");
        let port = blocker.local_addr().expect("blocker addr").port();
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let root = temp_root("bind-conflict");

        let error = registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                create_php_dbgp_adapter(
                    &root,
                    &DebugLaunchTarget::PhpListen { port: Some(port) },
                    &[],
                    emitter,
                    Box::new(|_| {}),
                )
            })
            .expect_err("bind conflict must fail");

        assert!(error.contains("already in use"));
        assert!(error.contains(&port.to_string()));
    }

    #[test]
    fn accept_timeout_reports_missing_xdebug_connection() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");

        let error = accept_with_timeout(&listener, Duration::from_millis(50))
            .expect_err("accept must time out");

        assert!(error.contains("Timed out"));
        assert_eq!(
            XDEBUG_CONNECT_ERROR,
            "The PHP process started but Xdebug never connected. Is the Xdebug extension installed and enabled?"
        );
    }

    #[test]
    fn builds_php_script_launch_arguments_with_xdebug_flags() {
        let arguments = build_php_launch_arguments(9007, "/workspace/php/bin/run.php");

        assert_eq!(
            arguments,
            vec![
                "-dxdebug.mode=debug".to_string(),
                "-dxdebug.start_with_request=yes".to_string(),
                "-dxdebug.client_host=127.0.0.1".to_string(),
                "-dxdebug.client_port=9007".to_string(),
                "/workspace/php/bin/run.php".to_string(),
            ]
        );
    }

    #[test]
    fn builds_php_test_launch_arguments_without_a_shell() {
        let arguments = build_php_test_launch_arguments(
            9007,
            "/workspace/vendor/bin/pest",
            "/workspace/tests/Feature/InvoiceTest.php",
        );

        assert_eq!(
            arguments,
            vec![
                "-dxdebug.mode=debug".to_string(),
                "-dxdebug.start_with_request=yes".to_string(),
                "-dxdebug.client_host=127.0.0.1".to_string(),
                "-dxdebug.client_port=9007".to_string(),
                "/workspace/vendor/bin/pest".to_string(),
                "/workspace/tests/Feature/InvoiceTest.php".to_string(),
            ]
        );
    }

    #[test]
    fn keeps_php_test_runner_and_file_as_single_arguments() {
        let runner = "/workspace with spaces/vendor/bin/pest";
        let file = "/workspace with spaces/tests/Feature/Invoice; touch owned Test.php";
        let arguments = build_php_test_launch_arguments(9007, runner, file);

        assert_eq!(arguments.get(4).map(String::as_str), Some(runner));
        assert_eq!(arguments.get(5).map(String::as_str), Some(file));
        assert_eq!(arguments.len(), 6);
    }

    #[test]
    fn resolves_local_pest_before_phpunit_and_rejects_missing_runners() {
        let root = temp_root("test-runner");
        let vendor_bin = root.join("vendor").join("bin");
        fs::create_dir_all(&vendor_bin).expect("create vendor bin");
        fs::write(vendor_bin.join("phpunit"), "phpunit").expect("write phpunit");

        assert!(resolve_php_test_runner(&root)
            .expect("resolve phpunit")
            .ends_with("vendor/bin/phpunit"));

        fs::write(vendor_bin.join("pest"), "pest").expect("write pest");
        assert!(resolve_php_test_runner(&root)
            .expect("resolve pest")
            .ends_with("vendor/bin/pest"));

        let empty = temp_root("missing-test-runner");
        assert!(resolve_php_test_runner(&empty)
            .expect_err("missing runner")
            .contains("No local Pest or PHPUnit"));
    }

    #[test]
    fn script_targets_outside_or_missing_and_unsupported_targets_fail_fast() {
        let root = temp_root("bad-targets");
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());

        let missing_root = root.clone();
        let missing = registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                create_php_dbgp_adapter(
                    &missing_root,
                    &DebugLaunchTarget::PhpScript {
                        script_path: "absent.php".to_string(),
                    },
                    &[],
                    emitter,
                    Box::new(|_| {}),
                )
            })
            .expect_err("missing script must fail");
        let unsupported = registry
            .start_session(WORKSPACE_KEY, sink, move |emitter| {
                create_php_dbgp_adapter(
                    &root,
                    &DebugLaunchTarget::NodeScript {
                        script_path: "index.js".to_string(),
                    },
                    &[],
                    emitter,
                    Box::new(|_| {}),
                )
            })
            .expect_err("unsupported target must fail");

        assert!(missing.contains("was not found"));
        assert!(unsupported.contains("Unsupported launch target"));
    }

    #[test]
    fn pause_reports_that_xdebug_cannot_interrupt() {
        let root = temp_root("pause");
        let session = start_listen_session(&root, Vec::new());
        let _client = MockXdebugClient::connect(session.port, default_responder());
        wait_for_stopped(&session.sink, 0);

        let error = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session")
            .expect_err("pause must fail");

        assert_eq!(error, "Xdebug cannot pause a running script.");
    }

    #[test]
    fn evaluate_surfaces_engine_errors() {
        let root = temp_root("eval-error");
        let session = start_listen_session(&root, Vec::new());
        let _client = MockXdebugClient::connect(
            session.port,
            scripted_responder(|command| {
                (command.name == "eval").then(|| vec![eval_error_response(command.transaction_id)])
            }),
        );
        let (_, frames) = wait_for_stopped(&session.sink, 0);

        let error = session
            .registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "nope()")
            })
            .expect("session")
            .expect_err("evaluate must fail");

        assert_eq!(error, "Cannot evaluate");
    }

    #[test]
    fn notify_breakpoint_resolved_marks_breakpoints_verified() {
        let file = breakpoint_fixture_file("notify-resolved");
        let file_path = file.to_string_lossy().to_string();
        let session = start_listen_session(
            file.parent().expect("fixture parent"),
            vec![breakpoint(&file_path, "bp-1", 12, None, true)],
        );
        let client = MockXdebugClient::connect(
            session.port,
            scripted_responder(|command| {
                (command.name == "breakpoint_set").then(|| {
                    vec![breakpoint_set_response(
                        command.transaction_id,
                        "dbgp-77",
                        false,
                    )]
                })
            }),
        );
        wait_for_command(&client, "run");
        let initial = wait_for(
            || verified_events(&session.sink).into_iter().next(),
            EVENT_WAIT_TIMEOUT,
            "initial breakpoints verified event",
        );
        assert!(!initial.1[0].verified);

        client.inject(&notify_resolved_xml("dbgp-77", 14));

        let resolved = wait_for(
            || verified_events(&session.sink).into_iter().nth(1),
            EVENT_WAIT_TIMEOUT,
            "resolved breakpoints verified event",
        );
        assert_eq!(resolved.0, file_path);
        assert!(resolved.1[0].verified);
        assert_eq!(resolved.1[0].line_number, 14);
    }
}
