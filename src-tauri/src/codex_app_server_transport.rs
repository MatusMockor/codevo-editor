use super::codex_app_server_protocol::{
    classify_notification, ClientMethod, ClientNotificationMethod, JsonRpcClientNotification,
    JsonRpcError, JsonRpcIncoming, JsonRpcRequest, RequestId, ServerNotification, JSON_RPC_VERSION,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

// Outbound requests and retained inbound metadata keep their original 1 MiB budget.
pub const MAX_APP_SERVER_LINE_BYTES: usize = 1024 * 1024;
// A single reader per host admits at most 16 MiB temporarily, before projection.
// This is separate from the bounded per-turn queues; large control frames still fail.
pub const MAX_APP_SERVER_WIRE_BYTES: usize = 16 * 1024 * 1024;
#[path = "codex_app_server_inbound.rs"]
mod inbound;
pub const APP_SERVER_WRITE_QUEUE_CAPACITY: usize = 64;
pub const MAX_TURN_INBOUND_FRAMES: usize = 4096;
pub const MAX_TURN_INBOUND_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_ORPHAN_INBOUND_BYTES: usize = 1024 * 1024;
pub const MAX_PENDING_REQUESTS: usize = 64;
pub const MAX_TRANSPORT_ROUTES: usize = 64 * 33;
pub const MAX_SUBAGENT_THREADS_PER_TURN: usize = 32;
pub const MAX_APP_SERVER_THREAD_ID_BYTES: usize = 128;
pub const MAX_ORPHAN_THREADS: usize = 8;
pub const MAX_ORPHAN_FRAMES_PER_THREAD: usize = 256;
pub const JSON_RPC_METHOD_NOT_FOUND: i64 = -32601;
pub const JSON_RPC_METHOD_NOT_FOUND_MESSAGE: &str = "Method not found.";

pub const APP_SERVER_LINE_LIMIT_ERROR: &str =
    "Codex app-server sent an unsupported oversized frame; the session was stopped and output may be incomplete.";
pub const APP_SERVER_OUTBOUND_LIMIT_ERROR: &str =
    "The request exceeds the Codex app-server message limit and was not sent.";
pub const APP_SERVER_WRITE_QUEUE_ERROR: &str = "Codex app-server write queue overflowed.";
pub const APP_SERVER_EOF_ERROR: &str = "Codex app-server closed its output stream.";
pub const APP_SERVER_READ_ERROR: &str = "Codex app-server output stream failed.";
pub const APP_SERVER_CLOSED_ERROR: &str = "Codex app-server session is closed.";
pub const APP_SERVER_STDIN_UNAVAILABLE_ERROR: &str = "Codex app-server stdin pipe is unavailable.";
pub const APP_SERVER_STDOUT_UNAVAILABLE_ERROR: &str =
    "Codex app-server stdout pipe is unavailable.";

#[derive(Debug, Clone, PartialEq)]
pub enum CodexRpcFailure {
    Rpc(JsonRpcError),
    Timeout,
    HostFailed { reason: String },
}

impl CodexRpcFailure {
    pub fn message(&self) -> String {
        match self {
            Self::Rpc(error) => error.message.clone(),
            Self::Timeout => "Codex app-server did not answer in time.".to_string(),
            Self::HostFailed { reason } => reason.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnFrame {
    Notification(Box<ServerNotification>),
    UnknownFrame { method: String },
    ServerRequestDeclined { method: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnFrameRecvError {
    Timeout,
    Closed { reason: String },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CodexTransportStats {
    pub unknown_frames: u64,
    pub undecodable_frames: u64,
    pub unrouted_frames: u64,
    pub late_responses: u64,
}

pub trait CodexServerRequestHandler: Send + Sync {
    fn decline(&self, method: &str, params: &Value) -> Option<Value>;
}

pub struct CodexAppServerStreams {
    pub input: Box<dyn Write + Send>,
    pub output: Box<dyn Read + Send>,
}

struct BufferedFrame {
    frame: TurnFrame,
    bytes: usize,
}

#[derive(Default)]
struct TurnFrameQueueState {
    frames: VecDeque<BufferedFrame>,
    bytes: usize,
    truncated: bool,
    closed: Option<String>,
}

#[derive(Default)]
struct TurnFrameQueue {
    state: Mutex<TurnFrameQueueState>,
    signal: Condvar,
}

impl TurnFrameQueue {
    fn locked(&self) -> MutexGuard<'_, TurnFrameQueueState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn push(&self, frame: BufferedFrame) {
        let mut state = self.locked();
        if state.closed.is_some() {
            return;
        }
        if state.frames.len() >= MAX_TURN_INBOUND_FRAMES
            || state.bytes.saturating_add(frame.bytes) > MAX_TURN_INBOUND_BYTES
        {
            state.truncated = true;
            return;
        }
        state.bytes += frame.bytes;
        state.frames.push_back(frame);
        drop(state);
        self.signal.notify_all();
    }

    fn close(&self, reason: &str) {
        let mut state = self.locked();
        if state.closed.is_none() {
            state.closed = Some(reason.to_string());
        }
        drop(state);
        self.signal.notify_all();
    }

    fn truncated(&self) -> bool {
        self.locked().truncated
    }

    fn closed(&self) -> Option<String> {
        self.locked().closed.clone()
    }

    fn try_recv(&self) -> Option<TurnFrame> {
        let mut state = self.locked();
        let frame = state.frames.pop_front()?;
        state.bytes -= frame.bytes;
        Some(frame.frame)
    }

    fn recv_timeout(&self, timeout: Duration) -> Result<TurnFrame, TurnFrameRecvError> {
        let deadline = Instant::now() + timeout;
        let mut state = self.locked();
        loop {
            if let Some(frame) = state.frames.pop_front() {
                state.bytes -= frame.bytes;
                return Ok(frame.frame);
            }
            if let Some(reason) = state.closed.clone() {
                return Err(TurnFrameRecvError::Closed { reason });
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(TurnFrameRecvError::Timeout);
            }
            let (next, _) = self
                .signal
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner);
            state = next;
        }
    }
}

#[derive(Default)]
struct RouteTable {
    routes: HashMap<String, Arc<TurnFrameQueue>>,
    orphans: HashMap<String, VecDeque<BufferedFrame>>,
    orphan_loss: HashSet<String>,
    orphan_order: VecDeque<String>,
}

impl RouteTable {
    fn retain_orphan(&mut self, thread_id: &str, frame: BufferedFrame) {
        if !self.orphans.contains_key(thread_id) {
            if self.orphan_order.len() >= MAX_ORPHAN_THREADS {
                if let Some(evicted) = self.orphan_order.pop_front() {
                    self.orphans.remove(&evicted);
                    self.orphan_loss.insert(evicted);
                }
            }
            self.orphan_order.push_back(thread_id.to_string());
            self.orphans.insert(thread_id.to_string(), VecDeque::new());
        }
        let Some(buffered) = self.orphans.get_mut(thread_id) else {
            return;
        };
        while buffered.len() >= MAX_ORPHAN_FRAMES_PER_THREAD
            || buffered
                .iter()
                .map(|frame| frame.bytes)
                .sum::<usize>()
                .saturating_add(frame.bytes)
                > MAX_ORPHAN_INBOUND_BYTES
        {
            self.orphan_loss.insert(thread_id.to_string());
            if buffered.pop_front().is_none() {
                return;
            }
        }
        buffered.push_back(frame);
    }

    fn take_orphans(&mut self, thread_id: &str) -> VecDeque<BufferedFrame> {
        self.orphan_order.retain(|entry| entry != thread_id);
        self.orphans.remove(thread_id).unwrap_or_default()
    }
}

type PendingOutcome = Result<Value, CodexRpcFailure>;

struct TransportShared {
    pending: Mutex<HashMap<u64, SyncSender<PendingOutcome>>>,
    routes: Mutex<RouteTable>,
    failure: Mutex<Option<String>>,
    writer: Mutex<Option<SyncSender<Vec<u8>>>>,
    handler: Arc<dyn CodexServerRequestHandler>,
    next_id: AtomicU64,
    unknown_frames: AtomicU64,
    undecodable_frames: AtomicU64,
    unrouted_frames: AtomicU64,
    late_responses: AtomicU64,
}

impl TransportShared {
    fn failure(&self) -> Option<String> {
        self.failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn fail(&self, reason: &str) {
        {
            let mut failure = self.failure.lock().unwrap_or_else(PoisonError::into_inner);
            if failure.is_some() {
                return;
            }
            *failure = Some(reason.to_string());
        }
        self.writer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        let pending =
            std::mem::take(&mut *self.pending.lock().unwrap_or_else(PoisonError::into_inner));
        for (_, sender) in pending {
            let _ = sender.try_send(Err(CodexRpcFailure::HostFailed {
                reason: reason.to_string(),
            }));
        }
        let queues: Vec<Arc<TurnFrameQueue>> = self
            .routes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .routes
            .values()
            .cloned()
            .collect();
        for queue in queues {
            queue.close(reason);
        }
    }

    fn write_line(&self, mut line: Vec<u8>) -> Result<(), CodexRpcFailure> {
        if line.len() > MAX_APP_SERVER_LINE_BYTES {
            return Err(CodexRpcFailure::HostFailed {
                reason: APP_SERVER_OUTBOUND_LIMIT_ERROR.to_string(),
            });
        }
        line.push(b'\n');
        let sender = {
            let writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
            match writer.as_ref() {
                Some(sender) => sender.clone(),
                None => {
                    return Err(CodexRpcFailure::HostFailed {
                        reason: self
                            .failure()
                            .unwrap_or_else(|| APP_SERVER_CLOSED_ERROR.to_string()),
                    })
                }
            }
        };
        match sender.try_send(line) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.fail(APP_SERVER_WRITE_QUEUE_ERROR);
                Err(CodexRpcFailure::HostFailed {
                    reason: APP_SERVER_WRITE_QUEUE_ERROR.to_string(),
                })
            }
            Err(TrySendError::Disconnected(_)) => Err(CodexRpcFailure::HostFailed {
                reason: self
                    .failure()
                    .unwrap_or_else(|| APP_SERVER_CLOSED_ERROR.to_string()),
            }),
        }
    }

    fn settle(&self, id: &RequestId, outcome: PendingOutcome) {
        let pending = id.correlated().and_then(|correlated| {
            let mut map = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
            map.remove(&correlated)
        });
        let Some(sender) = pending else {
            self.late_responses.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let _ = sender.try_send(outcome);
    }

    fn route(&self, thread_id: Option<String>, frame: TurnFrame, bytes: usize) {
        if self.failure().is_some() {
            return;
        }
        let frame = BufferedFrame { frame, bytes };
        let Some(thread_id) = thread_id else {
            self.unrouted_frames.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let mut table = self.routes.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(queue) = table.routes.get(thread_id.as_str()).map(Arc::clone) else {
            table.retain_orphan(thread_id.as_str(), frame);
            if table.orphan_loss.len() > MAX_ORPHAN_FRAMES_PER_THREAD {
                drop(table);
                self.fail("Codex app-server orphan loss tracking limit reached.");
            }
            return;
        };
        drop(table);
        queue.push(frame);
    }

    fn dispatch(&self, line: &[u8]) {
        let Ok(incoming) = serde_json::from_slice::<JsonRpcIncoming>(line) else {
            self.dispatch_undecodable(line);
            return;
        };
        match incoming {
            JsonRpcIncoming::Response { id, result } => self.settle(&id, Ok(result)),
            JsonRpcIncoming::Error { id, error } => {
                self.settle(&id, Err(CodexRpcFailure::Rpc(error)))
            }
            JsonRpcIncoming::Notification { method, params } => {
                self.dispatch_notification(method, params, line.len())
            }
            JsonRpcIncoming::ServerRequest { id, method, params } => {
                self.dispatch_server_request(id, method, params, line.len())
            }
        }
    }

    fn dispatch_undecodable(&self, line: &[u8]) {
        self.undecodable_frames.fetch_add(1, Ordering::Relaxed);
        self.unknown_frames.fetch_add(1, Ordering::Relaxed);
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            self.unrouted_frames.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if let (Some(id), Some(_)) = (value.get("id"), value.get("method")) {
            let _ = self.write_line(server_request_error(id, -32600, "Invalid request."));
        }
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("undecodable")
            .to_string();
        let thread_id = frame_thread_id(value.get("params").unwrap_or(&value));
        self.route(thread_id, TurnFrame::UnknownFrame { method }, line.len());
    }

    fn dispatch_notification(&self, method: String, params: Value, bytes: usize) {
        let thread_id = frame_thread_id(&params);
        match classify_notification(method.as_str(), params) {
            ServerNotification::Ignored { .. } => (),
            ServerNotification::Unknown { method } => {
                self.unknown_frames.fetch_add(1, Ordering::Relaxed);
                self.route(thread_id, TurnFrame::UnknownFrame { method }, bytes);
            }
            notification => self.route(
                thread_id,
                TurnFrame::Notification(Box::new(notification)),
                bytes,
            ),
        }
    }

    fn dispatch_server_request(&self, id: Value, method: String, params: Value, bytes: usize) {
        let thread_id = frame_thread_id(&params);
        let Some(result) = self.handler.decline(method.as_str(), &params) else {
            self.unknown_frames.fetch_add(1, Ordering::Relaxed);
            let _ = self.write_line(server_request_error(
                &id,
                JSON_RPC_METHOD_NOT_FOUND,
                JSON_RPC_METHOD_NOT_FOUND_MESSAGE,
            ));
            self.route(thread_id, TurnFrame::UnknownFrame { method }, bytes);
            return;
        };
        let _ = self.write_line(server_request_result(&id, result));
        self.route(
            thread_id,
            TurnFrame::ServerRequestDeclined { method },
            bytes,
        );
    }
}

fn server_request_result(id: &Value, result: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "result": result,
    }))
    .unwrap_or_default()
}

fn server_request_error(id: &Value, code: i64, message: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "error": { "code": code, "message": message },
    }))
    .unwrap_or_default()
}

fn frame_thread_id(params: &Value) -> Option<String> {
    let candidate = params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| {
            params
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(Value::as_str)
        })
        .or_else(|| params.get("conversationId").and_then(Value::as_str))?;
    if candidate.is_empty() || candidate.len() > MAX_APP_SERVER_THREAD_ID_BYTES {
        return None;
    }
    Some(candidate.to_string())
}

enum BoundedLine {
    Line,
    Eof,
    Oversized,
}

fn read_bounded_line(
    reader: &mut dyn BufRead,
    line: &mut Vec<u8>,
    limit: usize,
) -> std::io::Result<BoundedLine> {
    loop {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if available.is_empty() {
            return Ok(match line.is_empty() {
                true => BoundedLine::Eof,
                false => BoundedLine::Line,
            });
        }
        let (consumed, complete) = match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => (index + 1, true),
            None => (available.len(), false),
        };
        let copied = match complete {
            true => consumed - 1,
            false => consumed,
        };
        if line.len().saturating_add(copied) > limit {
            reader.consume(consumed);
            return Ok(BoundedLine::Oversized);
        }
        line.extend_from_slice(&available[..copied]);
        reader.consume(consumed);
        if complete {
            return Ok(BoundedLine::Line);
        }
    }
}

fn read_loop(output: Box<dyn Read + Send>, shared: Arc<TransportShared>) {
    let mut reader = BufReader::new(output);
    let mut line: Vec<u8> = Vec::new();
    loop {
        line.clear();
        match read_bounded_line(&mut reader, &mut line, MAX_APP_SERVER_WIRE_BYTES) {
            Ok(BoundedLine::Eof) => {
                shared.fail(APP_SERVER_EOF_ERROR);
                return;
            }
            Ok(BoundedLine::Oversized) => {
                shared.fail(APP_SERVER_LINE_LIMIT_ERROR);
                return;
            }
            Err(_) => {
                shared.fail(APP_SERVER_READ_ERROR);
                return;
            }
            Ok(BoundedLine::Line) => (),
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        if line.len() > MAX_APP_SERVER_LINE_BYTES {
            match inbound::project_large_notification(&line) {
                Ok(projected) => shared.dispatch(&projected),
                Err(()) => {
                    shared.fail(APP_SERVER_LINE_LIMIT_ERROR);
                    return;
                }
            }
            // Do not retain the exceptional wire buffer for the lifetime of the host.
            line = Vec::new();
        } else {
            shared.dispatch(line.as_slice());
        }
    }
}

fn write_loop(
    mut input: Box<dyn Write + Send>,
    commands: Receiver<Vec<u8>>,
    shared: Arc<TransportShared>,
) {
    while let Ok(line) = commands.recv() {
        if shared.failure().is_some() {
            return;
        }
        if input.write_all(line.as_slice()).is_err() || input.flush().is_err() {
            shared.fail(APP_SERVER_CLOSED_ERROR);
            return;
        }
    }
}

struct TransportWorkerGuard(Arc<TransportShared>);

impl Drop for TransportWorkerGuard {
    fn drop(&mut self) {
        self.0.fail(APP_SERVER_CLOSED_ERROR);
    }
}

pub struct CodexAppServerTransport {
    shared: Arc<TransportShared>,
}

impl CodexAppServerTransport {
    pub fn connect(
        streams: CodexAppServerStreams,
        handler: Arc<dyn CodexServerRequestHandler>,
    ) -> Self {
        let (sender, receiver) = sync_channel::<Vec<u8>>(APP_SERVER_WRITE_QUEUE_CAPACITY);
        let shared = Arc::new(TransportShared {
            pending: Mutex::new(HashMap::new()),
            routes: Mutex::new(RouteTable::default()),
            failure: Mutex::new(None),
            writer: Mutex::new(Some(sender)),
            handler,
            next_id: AtomicU64::new(1),
            unknown_frames: AtomicU64::new(0),
            undecodable_frames: AtomicU64::new(0),
            unrouted_frames: AtomicU64::new(0),
            late_responses: AtomicU64::new(0),
        });
        let CodexAppServerStreams { input, output } = streams;
        let reader_shared = Arc::clone(&shared);
        thread::Builder::new()
            .name("codex-app-server-reader".to_string())
            .spawn(move || {
                let _guard = TransportWorkerGuard(Arc::clone(&reader_shared));
                read_loop(output, reader_shared);
            })
            .map(|_| ())
            .unwrap_or_else(|_| shared.fail(APP_SERVER_READ_ERROR));
        let writer_shared = Arc::clone(&shared);
        thread::Builder::new()
            .name("codex-app-server-writer".to_string())
            .spawn(move || {
                let _guard = TransportWorkerGuard(Arc::clone(&writer_shared));
                write_loop(input, receiver, writer_shared);
            })
            .map(|_| ())
            .unwrap_or_else(|_| shared.fail(APP_SERVER_CLOSED_ERROR));
        Self { shared }
    }

    pub fn spawn(
        child: &mut Child,
        handler: Arc<dyn CodexServerRequestHandler>,
    ) -> Result<Self, String> {
        let input = child
            .stdin
            .take()
            .ok_or_else(|| APP_SERVER_STDIN_UNAVAILABLE_ERROR.to_string())?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| APP_SERVER_STDOUT_UNAVAILABLE_ERROR.to_string())?;
        Ok(Self::connect(
            CodexAppServerStreams {
                input: Box::new(input),
                output: Box::new(output),
            },
            handler,
        ))
    }

    pub fn request(
        &self,
        method: ClientMethod,
        params: Value,
        deadline: Duration,
    ) -> Result<Value, CodexRpcFailure> {
        let id = self
            .shared
            .next_id
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |id| id.checked_add(1))
            .map_err(|_| CodexRpcFailure::HostFailed {
                reason: "Codex app-server request identifier limit reached.".to_string(),
            })?;
        let (sender, receiver) = sync_channel::<PendingOutcome>(1);
        {
            let mut pending = self
                .shared
                .pending
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if pending.len() >= MAX_PENDING_REQUESTS {
                return Err(CodexRpcFailure::HostFailed {
                    reason: "Codex app-server pending request limit reached.".to_string(),
                });
            }
            pending.insert(id, sender);
        }
        if let Some(reason) = self.shared.failure() {
            self.forget(id);
            return Err(CodexRpcFailure::HostFailed { reason });
        }
        let line = serde_json::to_vec(&JsonRpcRequest { id, method, params }).map_err(|_| {
            self.forget(id);
            CodexRpcFailure::HostFailed {
                reason: APP_SERVER_CLOSED_ERROR.to_string(),
            }
        })?;
        if let Err(failure) = self.shared.write_line(line) {
            self.forget(id);
            return Err(failure);
        }
        match receiver.recv_timeout(deadline) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                self.forget(id);
                Err(CodexRpcFailure::Timeout)
            }
            Err(RecvTimeoutError::Disconnected) => {
                self.forget(id);
                Err(CodexRpcFailure::HostFailed {
                    reason: self
                        .shared
                        .failure()
                        .unwrap_or_else(|| APP_SERVER_CLOSED_ERROR.to_string()),
                })
            }
        }
    }

    pub fn notify(
        &self,
        method: ClientNotificationMethod,
        params: Value,
    ) -> Result<(), CodexRpcFailure> {
        let line =
            serde_json::to_vec(&JsonRpcClientNotification { method, params }).map_err(|_| {
                CodexRpcFailure::HostFailed {
                    reason: APP_SERVER_CLOSED_ERROR.to_string(),
                }
            })?;
        self.shared.write_line(line)
    }

    pub fn subscribe(&self, thread_id: &str) -> TurnFrameReceiver {
        let queue = Arc::new(TurnFrameQueue::default());
        {
            let mut table = self
                .shared
                .routes
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if thread_id.is_empty()
                || thread_id.len() > MAX_APP_SERVER_THREAD_ID_BYTES
                || table.routes.contains_key(thread_id)
                || table.routes.len() >= MAX_TRANSPORT_ROUTES
            {
                queue.close("Codex app-server thread route is unavailable.");
            }
            if queue.closed().is_none() {
                table
                    .routes
                    .insert(thread_id.to_string(), Arc::clone(&queue));
                let buffered = table.take_orphans(thread_id);
                queue.locked().truncated |= table.orphan_loss.remove(thread_id);
                for frame in buffered {
                    queue.push(frame);
                }
            }
        }
        if let Some(reason) = self.shared.failure() {
            queue.close(reason.as_str());
        }
        TurnFrameReceiver {
            shared: Arc::clone(&self.shared),
            queue,
            threads: Mutex::new(if thread_id.len() <= MAX_APP_SERVER_THREAD_ID_BYTES {
                vec![thread_id.to_string()]
            } else {
                Vec::new()
            }),
        }
    }

    pub fn answer_server_request(&self, id: Value, result: Value) {
        let _ = self.shared.write_line(server_request_result(&id, result));
    }

    pub fn fail(&self, reason: &str) {
        self.shared.fail(reason);
    }

    pub fn failure(&self) -> Option<String> {
        self.shared.failure()
    }

    pub fn pending_requests(&self) -> usize {
        self.shared
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    pub fn stats(&self) -> CodexTransportStats {
        CodexTransportStats {
            unknown_frames: self.shared.unknown_frames.load(Ordering::Relaxed),
            undecodable_frames: self.shared.undecodable_frames.load(Ordering::Relaxed),
            unrouted_frames: self.shared.unrouted_frames.load(Ordering::Relaxed),
            late_responses: self.shared.late_responses.load(Ordering::Relaxed),
        }
    }

    fn forget(&self, id: u64) {
        let mut pending = self
            .shared
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        pending.remove(&id);
    }
}

impl Drop for CodexAppServerTransport {
    fn drop(&mut self) {
        self.shared.fail(APP_SERVER_CLOSED_ERROR);
    }
}

pub struct TurnFrameReceiver {
    shared: Arc<TransportShared>,
    queue: Arc<TurnFrameQueue>,
    threads: Mutex<Vec<String>>,
}

impl TurnFrameReceiver {
    pub fn root_thread_id(&self) -> String {
        self.locked_threads()
            .first()
            .cloned()
            .unwrap_or_else(String::new)
    }

    pub fn thread_ids(&self) -> Vec<String> {
        self.locked_threads().clone()
    }

    pub fn attached_threads(&self) -> usize {
        self.locked_threads().len()
    }

    pub fn attach_thread(&self, thread_id: &str) -> bool {
        if thread_id.is_empty() || thread_id.len() > MAX_APP_SERVER_THREAD_ID_BYTES {
            return false;
        }
        let mut threads = self.locked_threads();
        if threads.iter().any(|entry| entry == thread_id) {
            return true;
        }
        if threads.len() > MAX_SUBAGENT_THREADS_PER_TURN {
            return false;
        }
        if self.queue.closed().is_some() {
            return false;
        }
        {
            let mut table = self
                .shared
                .routes
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if table.routes.contains_key(thread_id) || table.routes.len() >= MAX_TRANSPORT_ROUTES {
                return false;
            }
            table
                .routes
                .insert(thread_id.to_string(), Arc::clone(&self.queue));
            let buffered = table.take_orphans(thread_id);
            self.queue.locked().truncated |= table.orphan_loss.remove(thread_id);
            for frame in buffered {
                self.queue.push(frame);
            }
            threads.push(thread_id.to_string());
        }
        true
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Result<TurnFrame, TurnFrameRecvError> {
        self.queue.recv_timeout(timeout)
    }

    pub fn try_recv(&self) -> Option<TurnFrame> {
        self.queue.try_recv()
    }

    pub fn truncated(&self) -> bool {
        self.queue.truncated()
    }

    pub fn closed(&self) -> Option<String> {
        self.queue.closed()
    }

    fn locked_threads(&self) -> MutexGuard<'_, Vec<String>> {
        self.threads.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Drop for TurnFrameReceiver {
    fn drop(&mut self) {
        let threads = std::mem::take(&mut *self.locked_threads());
        let mut table = self
            .shared
            .routes
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        for thread_id in threads {
            let owned = table
                .routes
                .get(thread_id.as_str())
                .is_some_and(|queue| Arc::ptr_eq(queue, &self.queue));
            if owned {
                table.routes.remove(thread_id.as_str());
            }
        }
    }
}

#[cfg(test)]
#[path = "codex_app_server_transport_tests.rs"]
mod tests;
