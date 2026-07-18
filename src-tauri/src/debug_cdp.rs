#![allow(dead_code)] // Node CDP debug adapter awaiting the tauri debugger command wiring slice.

use crate::debug_adapter::{
    DebugAdapter, DebugBreakpoint, DebugEventEmitter, DebugEventPayload, DebugLaunchTarget,
    DebugOutputStream, DebugScopeInfo, DebugStackFrame, DebugStopReason, DebugVariableInfo,
    StepKind,
};
use crate::managed_javascript_typescript::node_executable_path;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Error as WsError, Message, WebSocket};

const WS_URL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);
const CDP_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(25);
const PROCESS_KILL_ESCALATION_DELAY: Duration = Duration::from_millis(500);
const INSPECT_FLAG: &str = "--inspect-brk=127.0.0.1:0";
const VITEST_ENTRY: &[&str] = &["node_modules", "vitest", "vitest.mjs"];
const JEST_ENTRY: &[&str] = &["node_modules", "jest", "bin", "jest.js"];

/// Runs on the process waiter thread with the debuggee's exit code once the
/// child exits. Wire it to `DebugSessionRegistry::finish_session(session_id,
/// exit_code)`; the adapter never emits `Terminated` itself. Invoked only
/// after `create_node_cdp_adapter` returns `Ok`; factory failures never call
/// it.
pub(crate) type DebugSessionFinish = Box<dyn FnOnce(Option<i32>) + Send>;

/// Node binary resolution reuses `managed_javascript_typescript`: the
/// `CODEVO_EDITOR_NODE_PATH` override first, then the first `node` on `PATH`.
pub(crate) fn create_node_cdp_adapter(
    root: &Path,
    launch_target: &DebugLaunchTarget,
    initial_breakpoints: &[DebugBreakpoint],
    emitter: DebugEventEmitter,
    finish: DebugSessionFinish,
) -> Result<Box<dyn DebugAdapter>, String> {
    let node = node_executable_path().ok_or_else(|| {
        "Node.js runtime was not found. Install Node.js or set CODEVO_EDITOR_NODE_PATH.".to_string()
    })?;
    let arguments = build_launch_arguments(root, launch_target)?;
    let mut command = Command::new(&node);
    command
        .args(&arguments)
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
        .map_err(|error| format!("Unable to launch the Node.js debug process: {error}"))?;
    let process_handle = DebugProcessHandle::from_process_id(child.id());
    let Some(stdout) = child.stdout.take() else {
        process_handle.terminate();
        let _ = child.wait();
        return Err("The Node.js debug process has no stdout pipe.".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        process_handle.terminate();
        let _ = child.wait();
        return Err("The Node.js debug process has no stderr pipe.".to_string());
    };
    spawn_output_pump(stdout, DebugOutputStream::Stdout, emitter.clone(), None);
    let (url_tx, url_rx) = mpsc::channel();
    spawn_output_pump(
        stderr,
        DebugOutputStream::Stderr,
        emitter.clone(),
        Some(url_tx),
    );
    let ws_url = match url_rx.recv_timeout(WS_URL_DISCOVERY_TIMEOUT) {
        Ok(url) => url,
        Err(RecvTimeoutError::Timeout) => {
            process_handle.terminate();
            let _ = child.wait();
            return Err("Timed out waiting for the Node.js inspector to start.".to_string());
        }
        Err(RecvTimeoutError::Disconnected) => {
            process_handle.terminate();
            let _ = child.wait();
            return Err(
                "The Node.js debug process exited before the inspector became available."
                    .to_string(),
            );
        }
    };
    let adapter = match NodeCdpAdapter::connect(
        &ws_url,
        emitter,
        initial_breakpoints,
        CDP_REQUEST_TIMEOUT,
        Some(process_handle),
    ) {
        Ok(adapter) => adapter,
        Err(error) => {
            process_handle.terminate();
            let _ = child.wait();
            return Err(error);
        }
    };
    thread::spawn(move || {
        let exit_code = child.wait().ok().and_then(|status| status.code());
        finish(exit_code);
    });
    Ok(Box::new(adapter))
}

fn build_launch_arguments(
    root: &Path,
    launch_target: &DebugLaunchTarget,
) -> Result<Vec<String>, String> {
    match launch_target {
        DebugLaunchTarget::NodeScript { script_path } => {
            let script = validate_workspace_file(root, script_path)?;
            Ok(vec![INSPECT_FLAG.to_string(), script])
        }
        DebugLaunchTarget::JsTestFile { runner, file_path } => {
            let file = validate_workspace_file(root, file_path)?;
            let entry = test_runner_entry(root, runner)?;
            if runner == "vitest" {
                return Ok(vec![
                    INSPECT_FLAG.to_string(),
                    entry,
                    "run".to_string(),
                    "--no-file-parallelism".to_string(),
                    file,
                ]);
            }
            Ok(vec![
                INSPECT_FLAG.to_string(),
                entry,
                "--runInBand".to_string(),
                file,
            ])
        }
    }
}

fn test_runner_entry(root: &Path, runner: &str) -> Result<String, String> {
    let segments = match runner {
        "vitest" => VITEST_ENTRY,
        "jest" => JEST_ENTRY,
        other => return Err(format!("Unsupported JavaScript test runner `{other}`.")),
    };
    let entry = segments
        .iter()
        .fold(root.to_path_buf(), |path, segment| path.join(segment));
    let is_file = fs::metadata(&entry)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false);
    if !is_file {
        return Err(format!(
            "The {runner} runtime is not installed in node_modules for this workspace."
        ));
    }
    Ok(entry.to_string_lossy().to_string())
}

fn validate_workspace_file(root: &Path, path: &str) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the workspace root: {error}"))?;
    let candidate = PathBuf::from(path);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let metadata =
        fs::metadata(&candidate).map_err(|_| format!("Debug target `{path}` was not found."))?;
    if !metadata.is_file() {
        return Err(format!("Debug target `{path}` is not a file."));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Unable to resolve debug target `{path}`: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "Debug target `{path}` is outside the workspace root."
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn spawn_output_pump<R: Read + Send + 'static>(
    reader: R,
    stream: DebugOutputStream,
    emitter: DebugEventEmitter,
    mut ws_url_sender: Option<mpsc::Sender<String>>,
) {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            if ws_url_sender.is_some() {
                if let Some(url) = parse_debugger_ws_url(&line) {
                    if let Some(sender) = ws_url_sender.take() {
                        let _ = sender.send(url);
                    }
                }
            }
            let text = mask_ws_url(&line);
            if text.is_empty() {
                continue;
            }
            emitter.emit(DebugEventPayload::Output { stream, text });
        }
    });
}

fn debugger_ws_url_regex() -> &'static Regex {
    static DEBUGGER_WS_URL: OnceLock<Regex> = OnceLock::new();
    DEBUGGER_WS_URL
        .get_or_init(|| Regex::new(r"Debugger listening on (ws://\S+)").expect("ws url regex"))
}

fn parse_debugger_ws_url(line: &str) -> Option<String> {
    debugger_ws_url_regex()
        .captures(line)
        .map(|captures| captures[1].to_string())
}

fn ws_url_token_regex() -> &'static Regex {
    static WS_URL_TOKEN: OnceLock<Regex> = OnceLock::new();
    WS_URL_TOKEN.get_or_init(|| Regex::new(r"(ws://[^/\s]+)/\S+").expect("ws token regex"))
}

fn mask_ws_url(text: &str) -> String {
    ws_url_token_regex()
        .replace_all(text, "${1}/<redacted>")
        .to_string()
}

fn file_url_from_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for character in path.chars() {
        match character {
            ' ' => encoded.push_str("%20"),
            '%' => encoded.push_str("%25"),
            '#' => encoded.push_str("%23"),
            '?' => encoded.push_str("%3F"),
            _ => encoded.push(character),
        }
    }
    format!("file://{encoded}")
}

fn path_from_file_url(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    Some(percent_decode(path))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn map_stop_reason(reason: &str) -> DebugStopReason {
    match reason {
        "step" => DebugStopReason::Step,
        "exception" | "promiseRejection" => DebugStopReason::Exception,
        _ => DebugStopReason::Breakpoint,
    }
}

fn scope_display_name(scope_type: &str) -> String {
    let mut characters = scope_type.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => "Scope".to_string(),
    }
}

#[derive(Clone, Copy)]
struct DebugProcessHandle {
    process_group_id: Option<i32>,
}

impl DebugProcessHandle {
    fn from_process_id(process_id: u32) -> Self {
        Self {
            process_group_id: i32::try_from(process_id).ok(),
        }
    }

    fn terminate(&self) {
        let Some(process_group_id) = self.process_group_id else {
            return;
        };
        signal_process_group(process_group_id, libc::SIGTERM);
        thread::spawn(move || {
            thread::sleep(PROCESS_KILL_ESCALATION_DELAY);
            signal_process_group(process_group_id, libc::SIGKILL);
        });
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) {
    unsafe {
        libc::kill(-process_group_id, signal);
    }
}

#[cfg(not(unix))]
fn signal_process_group(_process_group_id: i32, _signal: i32) {}

#[derive(Default)]
struct PauseInventory {
    call_frame_ids: HashMap<u64, String>,
    frames: Vec<DebugStackFrame>,
    object_ids: HashMap<u64, String>,
    scopes: HashMap<u64, Vec<DebugScopeInfo>>,
}

struct BreakpointResolutionTarget {
    breakpoint_id: String,
    file_path: String,
}

struct CdpShared {
    breakpoints_by_file: HashMap<String, Vec<DebugBreakpoint>>,
    cdp_ids_by_file: HashMap<String, Vec<String>>,
    first_pause_seen: bool,
    next_id: u64,
    pause: Option<PauseInventory>,
    pending_resolutions: HashMap<String, u32>,
    resolution_index: HashMap<String, BreakpointResolutionTarget>,
    suppress_next_resumed: bool,
}

impl CdpShared {
    fn new() -> Self {
        Self {
            breakpoints_by_file: HashMap::new(),
            cdp_ids_by_file: HashMap::new(),
            first_pause_seen: false,
            next_id: 1,
            pause: None,
            pending_resolutions: HashMap::new(),
            resolution_index: HashMap::new(),
            suppress_next_resumed: false,
        }
    }

    fn allocate_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

type PendingCdpRequests = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

struct CdpClient {
    io_thread: Option<JoinHandle<()>>,
    next_request_id: Arc<AtomicU64>,
    outgoing: mpsc::Sender<String>,
    pending: PendingCdpRequests,
    request_timeout: Duration,
    shutdown_requested: Arc<AtomicBool>,
}

impl CdpClient {
    fn start(
        socket: WebSocket<MaybeTlsStream<TcpStream>>,
        shared: Arc<Mutex<CdpShared>>,
        emitter: DebugEventEmitter,
        request_timeout: Duration,
    ) -> Self {
        let pending: PendingCdpRequests = Arc::new(Mutex::new(HashMap::new()));
        let (outgoing_tx, outgoing_rx) = mpsc::channel();
        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let next_request_id = Arc::new(AtomicU64::new(1));
        let context = SocketLoopContext {
            emitter,
            next_request_id: Arc::clone(&next_request_id),
            outgoing: outgoing_rx,
            pending: Arc::clone(&pending),
            shared,
            shutdown: Arc::clone(&shutdown_requested),
        };
        let io_thread = thread::spawn(move || run_socket_loop(socket, context));
        Self {
            io_thread: Some(io_thread),
            next_request_id,
            outgoing: outgoing_tx,
            pending,
            request_timeout,
            shutdown_requested,
        }
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
            pending.insert(id, tx);
        }
        let payload = json!({"id": id, "method": method, "params": params}).to_string();
        if self.outgoing.send(payload).is_err() {
            remove_pending_cdp_request(&self.pending, id);
            return Err(format!(
                "Debugger connection is closed; unable to send `{method}`."
            ));
        }
        match rx.recv_timeout(self.request_timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                remove_pending_cdp_request(&self.pending, id);
                Err(format!("Debugger request `{method}` timed out."))
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(format!("Debugger connection closed during `{method}`."))
            }
        }
    }

    fn shutdown(&mut self) {
        self.shutdown_requested.store(true, Ordering::SeqCst);
        if let Some(handle) = self.io_thread.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for CdpClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn remove_pending_cdp_request(pending: &PendingCdpRequests, id: u64) {
    if let Ok(mut pending) = pending.lock() {
        pending.remove(&id);
    }
}

fn reject_pending_cdp_requests(pending: &PendingCdpRequests) {
    if let Ok(mut pending) = pending.lock() {
        pending.clear();
    }
}

struct SocketLoopContext {
    emitter: DebugEventEmitter,
    next_request_id: Arc<AtomicU64>,
    outgoing: mpsc::Receiver<String>,
    pending: PendingCdpRequests,
    shared: Arc<Mutex<CdpShared>>,
    shutdown: Arc<AtomicBool>,
}

fn run_socket_loop(mut socket: WebSocket<MaybeTlsStream<TcpStream>>, context: SocketLoopContext) {
    loop {
        if context.shutdown.load(Ordering::SeqCst) {
            let _ = socket.close(None);
            break;
        }
        let mut write_failed = false;
        while let Ok(payload) = context.outgoing.try_recv() {
            if socket.send(Message::text(payload)).is_err() {
                write_failed = true;
                break;
            }
        }
        if write_failed {
            break;
        }
        let text = match socket.read() {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(WsError::Io(error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                continue;
            }
            Err(_) => break,
        };
        if let Some(reply) = handle_incoming_message(text.as_str(), &context) {
            if socket.send(Message::text(reply)).is_err() {
                break;
            }
        }
    }
    reject_pending_cdp_requests(&context.pending);
}

fn handle_incoming_message(text: &str, context: &SocketLoopContext) -> Option<String> {
    let message: Value = serde_json::from_str(text).ok()?;
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        dispatch_response(id, &message, &context.pending);
        return None;
    }
    match message.get("method").and_then(Value::as_str) {
        Some("Debugger.paused") => {
            handle_paused(message.get("params").unwrap_or(&Value::Null), context)
        }
        Some("Debugger.resumed") => {
            handle_resumed(context);
            None
        }
        Some("Debugger.breakpointResolved") => {
            handle_breakpoint_resolved(message.get("params").unwrap_or(&Value::Null), context);
            None
        }
        _ => None,
    }
}

fn dispatch_response(id: u64, message: &Value, pending: &PendingCdpRequests) {
    let sender = pending
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&id));
    let Some(sender) = sender else {
        return;
    };
    let outcome = match message.get("error") {
        Some(error) => Err(error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string())),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    let _ = sender.send(outcome);
}

fn handle_paused(params: &Value, context: &SocketLoopContext) -> Option<String> {
    let reason_text = params
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let hit_user_breakpoint = params
        .get("hitBreakpoints")
        .and_then(Value::as_array)
        .is_some_and(|hits| !hits.is_empty());
    {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        if !shared.first_pause_seen {
            shared.first_pause_seen = true;
            let is_entry_pause =
                !hit_user_breakpoint && matches!(reason_text, "other" | "Break on start");
            if is_entry_pause {
                shared.suppress_next_resumed = true;
                let id = context.next_request_id.fetch_add(1, Ordering::SeqCst);
                return Some(
                    json!({"id": id, "method": "Debugger.resume", "params": {}}).to_string(),
                );
            }
        }
    }
    let reason = map_stop_reason(reason_text);
    let frames = {
        let Ok(mut shared) = context.shared.lock() else {
            return None;
        };
        let inventory = build_pause_inventory(params, &mut shared);
        let frames = inventory.frames.clone();
        shared.pause = Some(inventory);
        frames
    };
    context
        .emitter
        .emit(DebugEventPayload::Stopped { reason, frames });
    None
}

fn handle_resumed(context: &SocketLoopContext) {
    let should_emit = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        shared.pause = None;
        if shared.suppress_next_resumed {
            shared.suppress_next_resumed = false;
            false
        } else {
            true
        }
    };
    if should_emit {
        context.emitter.emit(DebugEventPayload::Resumed);
    }
}

fn handle_breakpoint_resolved(params: &Value, context: &SocketLoopContext) {
    let Some(cdp_breakpoint_id) = params.get("breakpointId").and_then(Value::as_str) else {
        return;
    };
    let Some(resolved_line) = params
        .pointer("/location/lineNumber")
        .and_then(Value::as_u64)
        .map(|line| line as u32 + 1)
    else {
        return;
    };
    let resolved = {
        let Ok(mut shared) = context.shared.lock() else {
            return;
        };
        apply_breakpoint_resolution(&mut shared, cdp_breakpoint_id, resolved_line)
    };
    let Some((file_path, breakpoints)) = resolved else {
        return;
    };
    context
        .emitter
        .emit(DebugEventPayload::BreakpointsVerified {
            file_path,
            breakpoints,
        });
}

/// A resolution for a not-yet-registered CDP breakpoint id is buffered in
/// `pending_resolutions` so `set_breakpoints` can consume it after the
/// `setBreakpointByUrl` response lands.
fn apply_breakpoint_resolution(
    state: &mut CdpShared,
    cdp_breakpoint_id: &str,
    resolved_line: u32,
) -> Option<(String, Vec<DebugBreakpoint>)> {
    let Some(target) = state.resolution_index.remove(cdp_breakpoint_id) else {
        state
            .pending_resolutions
            .insert(cdp_breakpoint_id.to_string(), resolved_line);
        return None;
    };
    let breakpoints = state.breakpoints_by_file.get_mut(&target.file_path)?;
    let entry = breakpoints
        .iter_mut()
        .find(|breakpoint| breakpoint.id == target.breakpoint_id)?;
    entry.verified = true;
    entry.line_number = resolved_line;
    Some((target.file_path, breakpoints.clone()))
}

fn build_pause_inventory(params: &Value, state: &mut CdpShared) -> PauseInventory {
    let mut inventory = PauseInventory::default();
    let empty = Vec::new();
    let call_frames = params
        .get("callFrames")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    for call_frame in call_frames {
        let frame_id = state.allocate_id();
        let name = call_frame
            .get("functionName")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("(anonymous)")
            .to_string();
        let file_path = call_frame
            .get("url")
            .and_then(Value::as_str)
            .and_then(path_from_file_url);
        let line_number = call_frame
            .pointer("/location/lineNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32
            + 1;
        let column = call_frame
            .pointer("/location/columnNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32
            + 1;
        inventory.frames.push(DebugStackFrame {
            frame_id,
            name,
            file_path,
            line_number,
            column,
        });
        if let Some(call_frame_id) = call_frame.get("callFrameId").and_then(Value::as_str) {
            inventory
                .call_frame_ids
                .insert(frame_id, call_frame_id.to_string());
        }
        let mut scopes = Vec::new();
        for scope in call_frame
            .get("scopeChain")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
        {
            let Some(object_id) = scope.pointer("/object/objectId").and_then(Value::as_str) else {
                continue;
            };
            let scope_type = scope.get("type").and_then(Value::as_str).unwrap_or("scope");
            let reference = state.allocate_id();
            inventory
                .object_ids
                .insert(reference, object_id.to_string());
            scopes.push(DebugScopeInfo {
                name: scope_display_name(scope_type),
                variables_reference: reference,
                expensive: scope_type == "global",
            });
        }
        inventory.scopes.insert(frame_id, scopes);
    }
    inventory
}

fn variable_from_remote_object(
    name: &str,
    remote: &Value,
    shared: &Arc<Mutex<CdpShared>>,
) -> DebugVariableInfo {
    let type_name = remote.get("type").and_then(Value::as_str);
    let value_type = match type_name {
        Some("object") => remote
            .get("className")
            .and_then(Value::as_str)
            .or_else(|| remote.get("subtype").and_then(Value::as_str))
            .or(type_name),
        other => other,
    }
    .map(str::to_string);
    let value = remote
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| remote.get("value").map(render_primitive_value))
        .unwrap_or_else(|| "undefined".to_string());
    let variables_reference = remote
        .get("objectId")
        .and_then(Value::as_str)
        .and_then(|object_id| register_object_reference(shared, object_id))
        .unwrap_or(0);
    DebugVariableInfo {
        name: name.to_string(),
        value,
        value_type,
        variables_reference,
    }
}

fn render_primitive_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn register_object_reference(shared: &Arc<Mutex<CdpShared>>, object_id: &str) -> Option<u64> {
    let mut state = shared.lock().ok()?;
    let reference = state.allocate_id();
    let pause = state.pause.as_mut()?;
    pause.object_ids.insert(reference, object_id.to_string());
    Some(reference)
}

struct NodeCdpAdapter {
    client: CdpClient,
    process: Option<DebugProcessHandle>,
    shared: Arc<Mutex<CdpShared>>,
}

impl NodeCdpAdapter {
    fn connect(
        ws_url: &str,
        emitter: DebugEventEmitter,
        initial_breakpoints: &[DebugBreakpoint],
        request_timeout: Duration,
        process: Option<DebugProcessHandle>,
    ) -> Result<Self, String> {
        let (socket, _response) = tungstenite::connect(ws_url).map_err(|error| {
            mask_ws_url(&format!(
                "Unable to connect to the Node.js inspector: {error}"
            ))
        })?;
        if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
            stream
                .set_read_timeout(Some(SOCKET_POLL_INTERVAL))
                .map_err(|error| format!("Unable to configure the inspector socket: {error}"))?;
        }
        let shared = Arc::new(Mutex::new(CdpShared::new()));
        let client = CdpClient::start(
            socket,
            Arc::clone(&shared),
            emitter.clone(),
            request_timeout,
        );
        let mut adapter = Self {
            client,
            process,
            shared,
        };
        adapter.client.request("Runtime.enable", json!({}))?;
        adapter.client.request("Debugger.enable", json!({}))?;
        for (file_path, breakpoints) in group_breakpoints_by_file(initial_breakpoints) {
            let verified = adapter.set_breakpoints(&file_path, &breakpoints)?;
            emitter.emit(DebugEventPayload::BreakpointsVerified {
                file_path,
                breakpoints: verified,
            });
        }
        adapter
            .client
            .request("Runtime.runIfWaitingForDebugger", json!({}))?;
        Ok(adapter)
    }
}

fn group_breakpoints_by_file(
    breakpoints: &[DebugBreakpoint],
) -> Vec<(String, Vec<DebugBreakpoint>)> {
    let mut grouped: Vec<(String, Vec<DebugBreakpoint>)> = Vec::new();
    for breakpoint in breakpoints {
        if let Some((_, entries)) = grouped
            .iter_mut()
            .find(|(file_path, _)| file_path == &breakpoint.file_path)
        {
            entries.push(breakpoint.clone());
            continue;
        }
        grouped.push((breakpoint.file_path.clone(), vec![breakpoint.clone()]));
    }
    grouped
}

impl DebugAdapter for NodeCdpAdapter {
    fn set_breakpoints(
        &mut self,
        file_path: &str,
        breakpoints: &[DebugBreakpoint],
    ) -> Result<Vec<DebugBreakpoint>, String> {
        let previous_ids = {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            let ids = shared.cdp_ids_by_file.remove(file_path).unwrap_or_default();
            for id in &ids {
                shared.resolution_index.remove(id);
            }
            ids
        };
        for breakpoint_id in previous_ids {
            let _ = self.client.request(
                "Debugger.removeBreakpoint",
                json!({"breakpointId": breakpoint_id}),
            );
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
            let mut params = json!({
                "url": file_url.as_str(),
                "lineNumber": breakpoint.line_number.saturating_sub(1),
            });
            if let Some(condition) = &breakpoint.condition {
                params["condition"] = json!(condition);
            }
            if let Ok(result) = self.client.request("Debugger.setBreakpointByUrl", params) {
                if let Some(breakpoint_id) = result.get("breakpointId").and_then(Value::as_str) {
                    registered_ids.push(breakpoint_id.to_string());
                    let resolved_line = result
                        .pointer("/locations/0/lineNumber")
                        .and_then(Value::as_u64)
                        .map(|line| line as u32 + 1);
                    match resolved_line {
                        Some(line) => {
                            updated.verified = true;
                            updated.line_number = line;
                        }
                        None => {
                            let mut shared =
                                self.shared.lock().map_err(|error| error.to_string())?;
                            match shared.pending_resolutions.remove(breakpoint_id) {
                                Some(line) => {
                                    updated.verified = true;
                                    updated.line_number = line;
                                }
                                None => {
                                    shared.resolution_index.insert(
                                        breakpoint_id.to_string(),
                                        BreakpointResolutionTarget {
                                            breakpoint_id: breakpoint.id.clone(),
                                            file_path: file_path.to_string(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                }
            }
            applied.push(updated);
        }
        {
            let mut shared = self.shared.lock().map_err(|error| error.to_string())?;
            shared
                .cdp_ids_by_file
                .insert(file_path.to_string(), registered_ids);
            shared
                .breakpoints_by_file
                .insert(file_path.to_string(), applied.clone());
        }
        Ok(applied)
    }

    fn step(&mut self, kind: StepKind) -> Result<(), String> {
        let method = match kind {
            StepKind::Continue => "Debugger.resume",
            StepKind::StepOver => "Debugger.stepOver",
            StepKind::StepInto => "Debugger.stepInto",
            StepKind::StepOut => "Debugger.stepOut",
        };
        self.client.request(method, json!({}))?;
        Ok(())
    }

    fn pause(&mut self) -> Result<(), String> {
        self.client.request("Debugger.pause", json!({}))?;
        Ok(())
    }

    fn stack_trace(&mut self) -> Result<Vec<DebugStackFrame>, String> {
        let shared = self.shared.lock().map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        Ok(pause.frames.clone())
    }

    fn scopes(&mut self, frame_id: u64) -> Result<Vec<DebugScopeInfo>, String> {
        let shared = self.shared.lock().map_err(|error| error.to_string())?;
        let pause = shared
            .pause
            .as_ref()
            .ok_or_else(|| "The debugger is not paused.".to_string())?;
        pause
            .scopes
            .get(&frame_id)
            .cloned()
            .ok_or_else(|| format!("Unknown debug frame {frame_id}."))
    }

    fn variables(&mut self, reference: u64) -> Result<Vec<DebugVariableInfo>, String> {
        let object_id = {
            let shared = self.shared.lock().map_err(|error| error.to_string())?;
            let pause = shared
                .pause
                .as_ref()
                .ok_or_else(|| "The debugger is not paused.".to_string())?;
            pause
                .object_ids
                .get(&reference)
                .cloned()
                .ok_or_else(|| format!("Unknown variables reference {reference}."))?
        };
        let result = self.client.request(
            "Runtime.getProperties",
            json!({"objectId": object_id, "ownProperties": true}),
        )?;
        let empty = Vec::new();
        let properties = result
            .get("result")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let mut variables = Vec::new();
        for property in properties {
            let Some(remote) = property.get("value") else {
                continue;
            };
            let name = property.get("name").and_then(Value::as_str).unwrap_or("");
            variables.push(variable_from_remote_object(name, remote, &self.shared));
        }
        Ok(variables)
    }

    fn evaluate(&mut self, frame_id: u64, expression: &str) -> Result<DebugVariableInfo, String> {
        let call_frame_id = {
            let shared = self.shared.lock().map_err(|error| error.to_string())?;
            let pause = shared
                .pause
                .as_ref()
                .ok_or_else(|| "The debugger is not paused.".to_string())?;
            pause
                .call_frame_ids
                .get(&frame_id)
                .cloned()
                .ok_or_else(|| format!("Unknown debug frame {frame_id}."))?
        };
        let result = self.client.request(
            "Debugger.evaluateOnCallFrame",
            json!({
                "callFrameId": call_frame_id,
                "expression": expression,
                "throwOnSideEffect": false,
            }),
        )?;
        if let Some(details) = result.get("exceptionDetails") {
            let message = details
                .pointer("/exception/description")
                .and_then(Value::as_str)
                .or_else(|| details.get("text").and_then(Value::as_str))
                .unwrap_or("Evaluation failed.");
            return Err(message.to_string());
        }
        Ok(variable_from_remote_object(
            expression,
            result.get("result").unwrap_or(&Value::Null),
            &self.shared,
        ))
    }

    fn terminate(&mut self) {
        self.client.shutdown();
        if let Some(process) = self.process.take() {
            process.terminate();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_adapter::{DebugEvent, DebugEventSink, DebugSessionRegistry};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicU32;
    use std::time::Instant;

    const MOCK_REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
    const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_millis(250);
    const EVENT_WAIT_TIMEOUT: Duration = Duration::from_secs(3);
    const WORKSPACE_KEY: &str = "/workspace/debug";
    const CLOSE_MARKER: &str = "<<close-connection>>";

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

    type MockResponder = Box<dyn FnMut(u64, &str, &Value) -> Vec<String> + Send>;

    struct MockCdpServer {
        _handle: JoinHandle<()>,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
        url: String,
    }

    impl MockCdpServer {
        fn start(mut responder: MockResponder) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
            let port = listener.local_addr().expect("mock server addr").port();
            let requests: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
            let recorded = Arc::clone(&requests);
            let handle = thread::spawn(move || {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let Ok(mut socket) = tungstenite::accept(stream) else {
                    return;
                };
                loop {
                    let message = match socket.read() {
                        Ok(message) => message,
                        Err(_) => break,
                    };
                    let text = match message {
                        Message::Text(text) => text,
                        Message::Close(_) => break,
                        _ => continue,
                    };
                    let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else {
                        continue;
                    };
                    let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
                    let method = request
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let params = request.get("params").cloned().unwrap_or(Value::Null);
                    recorded
                        .lock()
                        .expect("mock requests")
                        .push((method.clone(), params.clone()));
                    for reply in responder(id, &method, &params) {
                        if reply == CLOSE_MARKER {
                            let _ = socket.close(None);
                            return;
                        }
                        if socket.send(Message::text(reply)).is_err() {
                            return;
                        }
                    }
                }
            });
            Self {
                _handle: handle,
                requests,
                url: format!("ws://127.0.0.1:{port}/mock-session"),
            }
        }

        fn requests(&self) -> Vec<(String, Value)> {
            self.requests.lock().expect("mock requests").clone()
        }

        fn methods(&self) -> Vec<String> {
            self.requests()
                .into_iter()
                .map(|(method, _)| method)
                .collect()
        }

        fn params_for(&self, method: &str) -> Vec<Value> {
            self.requests()
                .into_iter()
                .filter(|(request_method, _)| request_method == method)
                .map(|(_, params)| params)
                .collect()
        }
    }

    fn ok(id: u64) -> String {
        json!({"id": id, "result": {}}).to_string()
    }

    fn result(id: u64, result: Value) -> String {
        json!({"id": id, "result": result}).to_string()
    }

    fn error_reply(id: u64, message: &str) -> String {
        json!({"id": id, "error": {"message": message}}).to_string()
    }

    fn event(method: &str, params: Value) -> String {
        json!({"method": method, "params": params}).to_string()
    }

    fn simple_responder() -> MockResponder {
        Box::new(|id, _method, _params| vec![ok(id)])
    }

    fn breakpoint_paused_params() -> Value {
        json!({
            "reason": "other",
            "callFrames": [
                {
                    "callFrameId": "cf-0",
                    "functionName": "handleRequest",
                    "url": "file:///workspace/demo/src/app.js",
                    "location": {"scriptId": "5", "lineNumber": 41, "columnNumber": 4},
                    "scopeChain": [
                        {"type": "local", "object": {"objectId": "scope-local-1"}},
                        {"type": "global", "object": {"objectId": "scope-global-1"}}
                    ]
                },
                {
                    "callFrameId": "cf-1",
                    "functionName": "",
                    "url": "node:internal/modules/run_main",
                    "location": {"lineNumber": 0, "columnNumber": 0},
                    "scopeChain": []
                },
                {
                    "callFrameId": "cf-2",
                    "functionName": "load",
                    "url": "file:///workspace/demo/my%20module.js",
                    "location": {"lineNumber": 7},
                    "scopeChain": []
                }
            ]
        })
    }

    fn flow_responder() -> MockResponder {
        Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event("Debugger.paused", breakpoint_paused_params()),
            ],
            "Debugger.stepOver" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event(
                    "Debugger.paused",
                    json!({"reason": "step", "callFrames": []}),
                ),
            ],
            "Debugger.stepInto" => vec![
                ok(id),
                event("Debugger.resumed", json!({})),
                event(
                    "Debugger.paused",
                    json!({"reason": "exception", "callFrames": []}),
                ),
            ],
            "Runtime.getProperties" => vec![result(
                id,
                json!({
                    "result": [
                        {"name": "count", "value": {"type": "number", "value": 7, "description": "7"}},
                        {"name": "label", "value": {"type": "string", "value": "ready"}},
                        {
                            "name": "user",
                            "value": {
                                "type": "object",
                                "className": "User",
                                "description": "User",
                                "objectId": "obj-user-1"
                            }
                        },
                        {"name": "hidden"}
                    ]
                }),
            )],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({"result": {"type": "number", "value": 42, "description": "42"}}),
            )],
            _ => vec![ok(id)],
        })
    }

    fn start_session_with_mock(
        server_url: &str,
        initial_breakpoints: Vec<DebugBreakpoint>,
        request_timeout: Duration,
    ) -> (DebugSessionRegistry, Arc<CollectingSink>) {
        let registry = DebugSessionRegistry::new();
        let sink = Arc::new(CollectingSink::default());
        let url = server_url.to_string();
        registry
            .start_session(WORKSPACE_KEY, sink.clone(), move |emitter| {
                NodeCdpAdapter::connect(&url, emitter, &initial_breakpoints, request_timeout, None)
                    .map(|adapter| Box::new(adapter) as Box<dyn DebugAdapter>)
            })
            .expect("start mock session");
        (registry, sink)
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

    fn breakpoint_fixture_file(name: &str) -> PathBuf {
        let root = temp_root(name);
        let file = root.join("src").join("app.js");
        write_file(&file, "console.log('breakpoint fixture');");
        file
    }

    fn temp_root(name: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let directory = std::env::temp_dir().join(format!(
            "debug-cdp-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).expect("create temp root");
        directory.canonicalize().expect("canonicalize temp root")
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(path, content).expect("write fixture file");
    }

    #[test]
    fn parses_debugger_ws_url_from_stderr_fixture_lines() {
        let fixture = [
            "Debugger listening on ws://127.0.0.1:53219/9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
            "For help, see: https://nodejs.org/en/docs/inspector",
            "plain program output",
        ];

        let parsed: Vec<Option<String>> = fixture
            .iter()
            .map(|line| parse_debugger_ws_url(line))
            .collect();

        assert_eq!(
            parsed[0],
            Some("ws://127.0.0.1:53219/9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8".to_string())
        );
        assert_eq!(parsed[1], None);
        assert_eq!(parsed[2], None);
    }

    #[test]
    fn masks_ws_url_token_in_output_lines_and_error_strings() {
        let masked_line = mask_ws_url(
            "Debugger listening on ws://127.0.0.1:53219/9f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
        );
        let masked_error = mask_ws_url(
            "Unable to connect to the Node.js inspector: ws://127.0.0.1:53219/9f1a2b3c failed",
        );

        assert_eq!(
            masked_line,
            "Debugger listening on ws://127.0.0.1:53219/<redacted>"
        );
        assert_eq!(
            masked_error,
            "Unable to connect to the Node.js inspector: ws://127.0.0.1:53219/<redacted> failed"
        );
        assert_eq!(mask_ws_url("plain output"), "plain output");
    }

    #[test]
    fn file_url_round_trip_encodes_and_decodes_special_characters() {
        let url = file_url_from_path("/workspace/demo/my app 100%.js");

        assert_eq!(url, "file:///workspace/demo/my%20app%20100%25.js");
        assert_eq!(
            path_from_file_url(&url),
            Some("/workspace/demo/my app 100%.js".to_string())
        );
        assert_eq!(path_from_file_url("node:internal/modules"), None);
    }

    #[test]
    fn builds_node_script_launch_arguments_with_inspect_brk() {
        let root = temp_root("node-script");
        let script = root.join("index.js");
        write_file(&script, "console.log('hi');");

        let arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: script.to_string_lossy().to_string(),
            },
        )
        .expect("build arguments");

        assert_eq!(
            arguments,
            vec![
                INSPECT_FLAG.to_string(),
                script.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn builds_vitest_and_jest_launch_arguments() {
        let root = temp_root("test-runners");
        let vitest_entry = root.join("node_modules/vitest/vitest.mjs");
        let jest_entry = root.join("node_modules/jest/bin/jest.js");
        let test_file = root.join("src/app.test.js");
        write_file(&vitest_entry, "export {}");
        write_file(&jest_entry, "module.exports = {}");
        write_file(&test_file, "test('x', () => {});");

        let vitest_arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "vitest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
            },
        )
        .expect("vitest arguments");
        let jest_arguments = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "jest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
            },
        )
        .expect("jest arguments");

        assert_eq!(
            vitest_arguments,
            vec![
                INSPECT_FLAG.to_string(),
                vitest_entry.to_string_lossy().to_string(),
                "run".to_string(),
                "--no-file-parallelism".to_string(),
                test_file.to_string_lossy().to_string(),
            ]
        );
        assert_eq!(
            jest_arguments,
            vec![
                INSPECT_FLAG.to_string(),
                jest_entry.to_string_lossy().to_string(),
                "--runInBand".to_string(),
                test_file.to_string_lossy().to_string(),
            ]
        );
    }

    #[test]
    fn rejects_launch_targets_outside_the_workspace_root() {
        let root = temp_root("containment-root");
        let outside = temp_root("containment-outside").join("escape.js");
        write_file(&outside, "console.log('nope');");

        let error = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: outside.to_string_lossy().to_string(),
            },
        )
        .expect_err("outside target must fail");

        assert!(error.contains("outside the workspace root"));
    }

    #[test]
    fn rejects_missing_targets_and_uninstalled_runners() {
        let root = temp_root("missing-targets");
        let test_file = root.join("src/app.test.js");
        write_file(&test_file, "test('x', () => {});");

        let missing_script = build_launch_arguments(
            &root,
            &DebugLaunchTarget::NodeScript {
                script_path: root.join("absent.js").to_string_lossy().to_string(),
            },
        )
        .expect_err("missing script must fail");
        let missing_runner = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "vitest".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
            },
        )
        .expect_err("missing runner must fail");
        let unsupported_runner = build_launch_arguments(
            &root,
            &DebugLaunchTarget::JsTestFile {
                runner: "mocha".to_string(),
                file_path: test_file.to_string_lossy().to_string(),
            },
        )
        .expect_err("unsupported runner must fail");

        assert!(missing_script.contains("was not found"));
        assert!(missing_runner.contains("not installed"));
        assert!(unsupported_runner.contains("Unsupported JavaScript test runner"));
    }

    #[test]
    fn handshake_sends_enable_sequence_before_run_if_waiting() {
        let server = MockCdpServer::start(simple_responder());

        let (_registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Runtime.runIfWaitingForDebugger".to_string(),
            ]
        );
    }

    #[test]
    fn initial_breakpoints_are_set_before_run_and_verified_with_adjusted_lines() {
        let file = breakpoint_fixture_file("initial-bps");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setBreakpointByUrl" => vec![result(
                id,
                json!({
                    "breakpointId": "cdp-bp-1",
                    "locations": [{"scriptId": "1", "lineNumber": 12, "columnNumber": 0}]
                }),
            )],
            _ => vec![ok(id)],
        }));

        let (_registry, sink) = start_session_with_mock(
            &server.url,
            vec![
                breakpoint(&file_path, "bp-1", 12, Some("count > 3"), true),
                breakpoint(&file_path, "bp-2", 20, None, false),
            ],
            MOCK_REQUEST_TIMEOUT,
        );

        assert_eq!(
            server.methods(),
            vec![
                "Runtime.enable".to_string(),
                "Debugger.enable".to_string(),
                "Debugger.setBreakpointByUrl".to_string(),
                "Runtime.runIfWaitingForDebugger".to_string(),
            ]
        );
        let set_params = server.params_for("Debugger.setBreakpointByUrl");
        assert_eq!(set_params.len(), 1);
        assert_eq!(
            set_params[0],
            json!({
                "url": file_url_from_path(&file_path),
                "lineNumber": 11,
                "condition": "count > 3",
            })
        );
        let verified = sink
            .payloads()
            .into_iter()
            .find_map(|payload| match payload {
                DebugEventPayload::BreakpointsVerified {
                    file_path,
                    breakpoints,
                } => Some((file_path, breakpoints)),
                _ => None,
            })
            .expect("breakpoints verified event");
        assert_eq!(verified.0, file_path);
        assert_eq!(verified.1.len(), 2);
        assert!(verified.1[0].verified);
        assert_eq!(verified.1[0].line_number, 13);
        assert_eq!(verified.1[0].condition, Some("count > 3".to_string()));
        assert!(!verified.1[1].verified);
        assert_eq!(verified.1[1].line_number, 20);
    }

    #[test]
    fn set_breakpoints_removes_previous_file_breakpoints_before_setting_new_ones() {
        let file = breakpoint_fixture_file("replace-bps");
        let file_path = file.to_string_lossy().to_string();
        let counter = Arc::new(AtomicU64::new(1));
        let responder_counter = Arc::clone(&counter);
        let server = MockCdpServer::start(Box::new(move |id, method, params| match method {
            "Debugger.setBreakpointByUrl" => {
                let next = responder_counter.fetch_add(1, Ordering::SeqCst);
                let line = params
                    .get("lineNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                vec![result(
                    id,
                    json!({
                        "breakpointId": format!("cdp-bp-{next}"),
                        "locations": [{"scriptId": "1", "lineNumber": line, "columnNumber": 0}]
                    }),
                )]
            }
            _ => vec![ok(id)],
        }));
        let (registry, _sink) = start_session_with_mock(
            &server.url,
            vec![breakpoint(&file_path, "bp-1", 12, None, true)],
            MOCK_REQUEST_TIMEOUT,
        );

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    &file_path,
                    &[breakpoint(&file_path, "bp-2", 30, None, true)],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        let methods = server.methods();
        let remove_position = methods
            .iter()
            .position(|method| method == "Debugger.removeBreakpoint")
            .expect("remove request");
        let second_set_position = methods
            .iter()
            .rposition(|method| method == "Debugger.setBreakpointByUrl")
            .expect("second set request");
        assert!(remove_position < second_set_position);
        assert_eq!(
            server.params_for("Debugger.removeBreakpoint"),
            vec![json!({"breakpointId": "cdp-bp-1"})]
        );
        assert_eq!(updated.len(), 1);
        assert!(updated[0].verified);
        assert_eq!(updated[0].line_number, 30);
    }

    #[test]
    fn set_breakpoints_marks_rejected_breakpoints_as_unverified() {
        let file = breakpoint_fixture_file("rejected-bps");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, params| match method {
            "Debugger.setBreakpointByUrl" => {
                if params.get("lineNumber").and_then(Value::as_u64) == Some(99) {
                    return vec![error_reply(id, "Cannot set breakpoint")];
                }
                vec![result(
                    id,
                    json!({
                        "breakpointId": "cdp-bp-ok",
                        "locations": [{"scriptId": "1", "lineNumber": 9, "columnNumber": 0}]
                    }),
                )]
            }
            _ => vec![ok(id)],
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    &file_path,
                    &[
                        breakpoint(&file_path, "bp-1", 10, None, true),
                        breakpoint(&file_path, "bp-2", 100, None, true),
                    ],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        assert!(updated[0].verified);
        assert_eq!(updated[0].line_number, 10);
        assert!(!updated[1].verified);
    }

    #[test]
    fn breakpoints_with_empty_locations_stay_pending_until_breakpoint_resolved() {
        let file = breakpoint_fixture_file("pending-bps");
        let file_path = file.to_string_lossy().to_string();
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Debugger.setBreakpointByUrl" => vec![result(
                id,
                json!({"breakpointId": "cdp-bp-pending", "locations": []}),
            )],
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.breakpointResolved",
                    json!({
                        "breakpointId": "cdp-bp-pending",
                        "location": {"scriptId": "9", "lineNumber": 14, "columnNumber": 0}
                    }),
                ),
            ],
            _ => vec![ok(id)],
        }));

        let (_registry, sink) = start_session_with_mock(
            &server.url,
            vec![breakpoint(&file_path, "bp-1", 12, None, true)],
            MOCK_REQUEST_TIMEOUT,
        );
        let verified_events = wait_for(
            || {
                let events: Vec<(String, Vec<DebugBreakpoint>)> = sink
                    .payloads()
                    .into_iter()
                    .filter_map(|payload| match payload {
                        DebugEventPayload::BreakpointsVerified {
                            file_path,
                            breakpoints,
                        } => Some((file_path, breakpoints)),
                        _ => None,
                    })
                    .collect();
                (events.len() >= 2).then_some(events)
            },
            EVENT_WAIT_TIMEOUT,
            "breakpoint resolution events",
        );

        assert_eq!(verified_events[0].0, file_path);
        assert!(!verified_events[0].1[0].verified);
        assert_eq!(verified_events[0].1[0].line_number, 12);
        assert_eq!(verified_events[1].0, file_path);
        assert!(verified_events[1].1[0].verified);
        assert_eq!(verified_events[1].1[0].line_number, 15);
    }

    #[test]
    fn breakpoint_resolutions_for_unknown_ids_are_buffered_until_registration() {
        let mut state = CdpShared::new();
        let file_path = "/workspace/debug/src/app.js".to_string();

        let buffered = apply_breakpoint_resolution(&mut state, "cdp-early", 15);

        assert!(buffered.is_none());
        assert_eq!(state.pending_resolutions.get("cdp-early"), Some(&15));

        state.resolution_index.insert(
            "cdp-known".to_string(),
            BreakpointResolutionTarget {
                breakpoint_id: "bp-9".to_string(),
                file_path: file_path.clone(),
            },
        );
        state.breakpoints_by_file.insert(
            file_path.clone(),
            vec![breakpoint(&file_path, "bp-9", 10, None, true)],
        );
        let resolved =
            apply_breakpoint_resolution(&mut state, "cdp-known", 22).expect("resolved breakpoint");

        assert_eq!(resolved.0, file_path);
        assert!(resolved.1[0].verified);
        assert_eq!(resolved.1[0].line_number, 22);
    }

    #[test]
    fn set_breakpoints_for_unresolvable_paths_returns_unverified_without_cdp_calls() {
        let server = MockCdpServer::start(simple_responder());
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let missing_file = "/nonexistent/debug-cdp/app.js";

        let updated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.set_breakpoints(
                    missing_file,
                    &[breakpoint(missing_file, "bp-1", 5, None, true)],
                )
            })
            .expect("session")
            .expect("set breakpoints");

        assert_eq!(updated.len(), 1);
        assert!(!updated[0].verified);
        assert!(!server
            .methods()
            .contains(&"Debugger.setBreakpointByUrl".to_string()));
    }

    #[test]
    fn entry_pause_is_auto_resumed_without_events_and_next_pause_emits_mapped_frames() {
        let server = MockCdpServer::start(flow_responder());

        let (_registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (reason, frames) = wait_for_stopped(&sink, 0);

        assert_eq!(reason, DebugStopReason::Breakpoint);
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].name, "handleRequest");
        assert_eq!(
            frames[0].file_path,
            Some("/workspace/demo/src/app.js".to_string())
        );
        assert_eq!(frames[0].line_number, 42);
        assert_eq!(frames[0].column, 5);
        assert_eq!(frames[1].name, "(anonymous)");
        assert_eq!(frames[1].file_path, None);
        assert_eq!(frames[1].line_number, 1);
        assert_eq!(frames[1].column, 1);
        assert_eq!(
            frames[2].file_path,
            Some("/workspace/demo/my module.js".to_string())
        );
        assert_eq!(frames[2].line_number, 8);
        assert_eq!(frames[2].column, 1);
        let resume_requests = server
            .methods()
            .into_iter()
            .filter(|method| method == "Debugger.resume")
            .count();
        assert_eq!(resume_requests, 1);
        let resumed_events = sink
            .payloads()
            .into_iter()
            .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
            .count();
        assert_eq!(resumed_events, 0);
    }

    #[test]
    fn first_pause_hitting_a_user_breakpoint_stops_instead_of_auto_resuming() {
        let mut paused_params = breakpoint_paused_params();
        paused_params["hitBreakpoints"] = json!(["cdp-bp-1"]);
        let server = MockCdpServer::start(Box::new(move |id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => {
                vec![ok(id), event("Debugger.paused", paused_params.clone())]
            }
            _ => vec![ok(id)],
        }));

        let (_registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (reason, frames) = wait_for_stopped(&sink, 0);

        assert_eq!(reason, DebugStopReason::Breakpoint);
        assert_eq!(frames.len(), 3);
        assert!(!server.methods().contains(&"Debugger.resume".to_string()));
    }

    #[test]
    fn malformed_inbound_messages_are_ignored() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.pause" {
                return vec![
                    "{ this is not json".to_string(),
                    json!({"unexpected": true}).to_string(),
                    ok(id),
                ];
            }
            vec![ok(id)]
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let paused = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session");

        assert_eq!(paused, Ok(()));
    }

    #[test]
    fn socket_close_mid_pending_request_fails_with_connection_closed() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.pause" {
                return vec![CLOSE_MARKER.to_string()];
            }
            vec![ok(id)]
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session")
            .expect_err("request must fail on close");

        assert!(error.contains("connection closed"));
    }

    #[test]
    fn scopes_and_variables_are_served_from_the_pause_cache_and_get_properties() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let stack = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.stack_trace())
            .expect("session")
            .expect("stack trace");
        let scopes = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.scopes(frames[0].frame_id))
            .expect("session")
            .expect("scopes");
        let variables = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables(scopes[0].variables_reference)
            })
            .expect("session")
            .expect("variables");

        assert_eq!(stack, frames);
        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[0].name, "Local");
        assert!(!scopes[0].expensive);
        assert_eq!(scopes[1].name, "Global");
        assert!(scopes[1].expensive);
        assert_eq!(
            server.params_for("Runtime.getProperties"),
            vec![json!({"objectId": "scope-local-1", "ownProperties": true})]
        );
        assert_eq!(variables.len(), 3);
        assert_eq!(variables[0].name, "count");
        assert_eq!(variables[0].value, "7");
        assert_eq!(variables[0].value_type, Some("number".to_string()));
        assert_eq!(variables[0].variables_reference, 0);
        assert_eq!(variables[1].name, "label");
        assert_eq!(variables[1].value, "ready");
        assert_eq!(variables[2].name, "user");
        assert_eq!(variables[2].value, "User");
        assert_eq!(variables[2].value_type, Some("User".to_string()));
        assert!(variables[2].variables_reference > 0);
        let nested = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.variables(variables[2].variables_reference)
            })
            .expect("session")
            .expect("nested variables");
        assert_eq!(nested.len(), 3);
    }

    #[test]
    fn evaluate_uses_the_call_frame_id_without_side_effects() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let evaluated = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "count + 1")
            })
            .expect("session")
            .expect("evaluate");

        assert_eq!(
            server.params_for("Debugger.evaluateOnCallFrame"),
            vec![json!({
                "callFrameId": "cf-0",
                "expression": "count + 1",
                "throwOnSideEffect": false,
            })]
        );
        assert_eq!(evaluated.name, "count + 1");
        assert_eq!(evaluated.value, "42");
        assert_eq!(evaluated.value_type, Some("number".to_string()));
        assert_eq!(evaluated.variables_reference, 0);
    }

    #[test]
    fn evaluate_surfaces_exception_details_as_errors() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| match method {
            "Runtime.runIfWaitingForDebugger" => vec![
                ok(id),
                event(
                    "Debugger.paused",
                    json!({"reason": "Break on start", "callFrames": []}),
                ),
            ],
            "Debugger.resume" => vec![ok(id), event("Debugger.paused", breakpoint_paused_params())],
            "Debugger.evaluateOnCallFrame" => vec![result(
                id,
                json!({
                    "result": {"type": "object", "subtype": "error"},
                    "exceptionDetails": {
                        "text": "Uncaught",
                        "exception": {"description": "ReferenceError: nope is not defined"}
                    }
                }),
            )],
            _ => vec![ok(id)],
        }));
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| {
                adapter.evaluate(frames[0].frame_id, "nope")
            })
            .expect("session")
            .expect_err("evaluation must fail");

        assert_eq!(error, "ReferenceError: nope is not defined");
    }

    #[test]
    fn step_commands_map_to_cdp_methods_and_resume_events_flow_through() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        wait_for_stopped(&sink, 0);

        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
            .expect("session")
            .expect("step over");
        let (step_reason, _) = wait_for_stopped(&sink, 1);
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepInto))
            .expect("session")
            .expect("step into");
        let (exception_reason, _) = wait_for_stopped(&sink, 2);
        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOut))
            .expect("session")
            .expect("step out");

        assert_eq!(step_reason, DebugStopReason::Step);
        assert_eq!(exception_reason, DebugStopReason::Exception);
        let methods = server.methods();
        assert!(methods.contains(&"Debugger.stepOver".to_string()));
        assert!(methods.contains(&"Debugger.stepInto".to_string()));
        assert!(methods.contains(&"Debugger.stepOut".to_string()));
        let resumed_events = wait_for(
            || {
                let count = sink
                    .payloads()
                    .into_iter()
                    .filter(|payload| matches!(payload, DebugEventPayload::Resumed))
                    .count();
                (count >= 2).then_some(count)
            },
            EVENT_WAIT_TIMEOUT,
            "resumed events",
        );
        assert_eq!(resumed_events, 2);
    }

    #[test]
    fn resume_clears_the_pause_cache() {
        let server = MockCdpServer::start(flow_responder());
        let (registry, sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);
        let (_, frames) = wait_for_stopped(&sink, 0);

        registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.step(StepKind::StepOver))
            .expect("session")
            .expect("step over");
        wait_for(
            || {
                sink.payloads()
                    .into_iter()
                    .any(|payload| matches!(payload, DebugEventPayload::Resumed))
                    .then_some(())
            },
            EVENT_WAIT_TIMEOUT,
            "resumed event",
        );
        wait_for_stopped(&sink, 1);

        let stale_scopes = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.scopes(frames[0].frame_id))
            .expect("session");

        assert!(stale_scopes.is_err());
    }

    #[test]
    fn pause_sends_debugger_pause_and_stack_trace_requires_a_pause() {
        let server = MockCdpServer::start(simple_responder());
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), MOCK_REQUEST_TIMEOUT);

        let paused = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session");
        let stack = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.stack_trace())
            .expect("session");

        assert_eq!(paused, Ok(()));
        assert!(server.methods().contains(&"Debugger.pause".to_string()));
        assert_eq!(stack, Err("The debugger is not paused.".to_string()));
    }

    #[test]
    fn unanswered_requests_time_out_instead_of_hanging() {
        let server = MockCdpServer::start(Box::new(|id, method, _params| {
            if method == "Debugger.pause" {
                return Vec::new();
            }
            vec![ok(id)]
        }));
        let (registry, _sink) =
            start_session_with_mock(&server.url, Vec::new(), SHORT_REQUEST_TIMEOUT);

        let error = registry
            .with_session(WORKSPACE_KEY, |adapter| adapter.pause())
            .expect("session")
            .expect_err("request must time out");

        assert!(error.contains("timed out"));
    }
}
