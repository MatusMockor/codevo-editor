use super::attachment_file_wire::UploadFileRequest;
use super::service::ConnectionLease;
use super::transport::{Session, StallPolicy, TransferPolicy};
use super::types::Server;
use crate::agent_file_source::{FileSources, CHUNK_BYTES};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

pub(super) const RUNNER_ID: &str = "runner-test";
pub(super) const ATTACHMENT_ID: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
pub(super) const CONNECTION_FAILED: &str =
    "Runner connection failed. The request outcome may be unknown.";
pub(super) const TIMED_OUT: &str = "Runner request timed out. Its outcome may be unknown.";
pub(super) const TUNNEL_CLOSED: &str = "Runner connection changed during request.";
pub(super) const WAIT: Duration = Duration::from_secs(10);
pub(super) const SILENCE: Duration = Duration::from_millis(400);

pub(super) fn swift() -> TransferPolicy {
    TransferPolicy {
        total: Duration::from_secs(20),
        idle: Duration::from_secs(10),
        local: Duration::from_secs(10),
    }
}

pub(super) fn ends(policy: TransferPolicy) -> Instant {
    Instant::now() + policy.total
}

pub(super) fn budget(policy: TransferPolicy) -> super::attachment_watch::Budget {
    super::attachment_watch::Budget::starting(Instant::now(), policy.total)
}

pub(super) fn server() -> Server {
    pinned(RUNNER_ID)
}

pub(super) fn pinned(runner_id: &str) -> Server {
    Server {
        id: "fixture".into(),
        name: "Fixture".into(),
        host: "localhost".into(),
        username: "test".into(),
        port: 22,
        connected: true,
        runner_id: Some(runner_id.into()),
    }
}

pub(super) struct StagedFile {
    _scratch: Scratch,
    pub(super) sources: FileSources,
    pub(super) source_id: String,
    pub(super) path: PathBuf,
}

impl StagedFile {
    pub(super) fn holding(name: &str, bytes: &[u8]) -> Self {
        let scratch = Scratch::new();
        let path = scratch.file(name, bytes);
        Self::stage(scratch, path)
    }

    pub(super) fn sparse(name: &str, length: u64) -> Self {
        let scratch = Scratch::new();
        let path = scratch.sparse(name, length);
        Self::stage(scratch, path)
    }

    fn stage(scratch: Scratch, path: PathBuf) -> Self {
        let sources = FileSources::default();
        let source_id = sources.stage(path.to_str().unwrap()).unwrap().source_id;
        Self {
            _scratch: scratch,
            sources,
            source_id,
            path,
        }
    }

    pub(super) fn request(&self, name: &str) -> UploadFileRequest {
        UploadFileRequest {
            server_id: "fixture".into(),
            attachment_id: ATTACHMENT_ID.into(),
            source_id: self.source_id.clone(),
            name: name.into(),
        }
    }
}

pub(super) fn stored_json(name: &str, bytes: usize, sha256: &str, media_type: &str) -> String {
    serde_json::json!({
        "attachment": {
            "id": ATTACHMENT_ID,
            "runnerId": RUNNER_ID,
            "name": name,
            "bytes": bytes,
            "sha256": sha256,
            "createdAt": "2026-10-13T00:00:00.000Z",
            "kind": "file",
            "mediaType": media_type,
        },
        "created": true,
    })
    .to_string()
}

pub(super) fn is_upload(head: &str) -> bool {
    head.starts_with(&format!("PUT /v1/attachments/{ATTACHMENT_ID} "))
}

pub(super) struct Received {
    pub(super) head: String,
    pub(super) body: Vec<u8>,
}

impl Received {
    pub(super) fn complete(&self) -> bool {
        self.body.len() == declared_length(&self.head)
    }
}

pub(super) struct Gate {
    pub(super) paused: mpsc::Receiver<()>,
    pub(super) resume: mpsc::Sender<()>,
    pub(super) received: mpsc::Receiver<Received>,
}

pub(super) fn gated(
    name: &'static str,
    media_type: &'static str,
) -> (impl Fn(String, UnixStream) + Send + Sync + 'static, Gate) {
    let (pause, paused) = mpsc::channel();
    let (resume, resumed) = mpsc::channel::<()>();
    let (seen, received) = mpsc::channel();
    let resumed = std::sync::Mutex::new(resumed);
    let route = move |head: String, mut socket: UnixStream| {
        if !is_upload(&head) {
            return respond(&mut socket, 200, b"{\"ok\":true}");
        }
        let declared = declared_length(&head);
        let mut body = read_up_to(&mut socket, CHUNK_BYTES.min(declared));
        let _ = pause.send(());
        let _ = resumed.lock().unwrap().recv_timeout(WAIT);
        body.extend(read_up_to(&mut socket, declared - body.len()));
        if body.len() == declared {
            let reply = stored_json(name, declared, &sha256(&body), media_type);
            respond(&mut socket, 201, reply.as_bytes());
        }
        let _ = seen.send(Received { head, body });
    };
    (
        route,
        Gate {
            paused,
            resume,
            received,
        },
    )
}

pub(super) fn storing(
    status: u16,
    reply: impl Fn(&Received) -> String + Send + Sync + 'static,
) -> (
    impl Fn(String, UnixStream) + Send + Sync + 'static,
    mpsc::Receiver<Received>,
) {
    let (seen, received) = mpsc::channel();
    let route = move |head: String, mut socket: UnixStream| {
        let body = read_up_to(&mut socket, declared_length(&head));
        let received = Received { head, body };
        respond(&mut socket, status, reply(&received).as_bytes());
        let _ = seen.send(received);
    };
    (route, received)
}

pub(super) struct Scratch(pub(super) PathBuf);

impl Scratch {
    pub(super) fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-file-attachment-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(super) fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    pub(super) fn sparse(&self, name: &str, length: u64) -> PathBuf {
        let path = self.0.join(name);
        std::fs::File::create(&path)
            .unwrap()
            .set_len(length)
            .unwrap();
        path
    }

    pub(super) fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn privileged() -> bool {
    unsafe { libc::geteuid() == 0 }
}

pub(super) fn content(length: usize) -> Vec<u8> {
    let mut state = 0x9e37_79b9_u32;
    (0..length)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 24) as u8
        })
        .collect()
}

pub(super) fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn settles(condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + WAIT;
    while !condition() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    true
}

pub(super) fn read_head(socket: &mut UnixStream) -> String {
    let mut head = Vec::new();
    let mut byte = [0];
    while !head.ends_with(b"\r\n\r\n") && matches!(socket.read(&mut byte), Ok(1)) {
        head.push(byte[0]);
    }
    String::from_utf8_lossy(&head).into_owned()
}

pub(super) fn header<'a>(head: &'a str, name: &str) -> Vec<&'a str> {
    head.split("\r\n")
        .skip(1)
        .filter_map(|line| line.split_once(": "))
        .filter(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value)
        .collect()
}

pub(super) fn declared_length(head: &str) -> usize {
    header(head, "content-length")
        .first()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

pub(super) fn read_up_to(socket: &mut UnixStream, wanted: usize) -> Vec<u8> {
    let mut body = Vec::with_capacity(wanted.min(1 << 20));
    let mut buffer = [0_u8; 16 * 1024];
    while body.len() < wanted {
        let room = (wanted - body.len()).min(buffer.len());
        match socket.read(&mut buffer[..room]) {
            Ok(0) | Err(_) => break,
            Ok(count) => body.extend_from_slice(&buffer[..count]),
        }
    }
    body
}

pub(super) fn respond(socket: &mut UnixStream, status: u16, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = socket.write_all(head.as_bytes());
    let _ = socket.write_all(body);
}

pub(super) fn descriptor(file_attachments: Option<bool>) -> String {
    let mut descriptor = serde_json::json!({
        "protocolVersion": 1,
        "runnerId": RUNNER_ID,
        "name": "Fixture",
        "capabilities": { "taskExecution": true, "eventReplay": true },
    });
    if let Some(supported) = file_attachments {
        descriptor["capabilities"]["fileAttachments"] = supported.into();
    }
    descriptor.to_string()
}

fn is_identity(head: &str) -> bool {
    head.starts_with("GET /v1/runner ")
}

pub(super) struct Runner {
    pub(super) lease: ConnectionLease,
    pub(super) session: Arc<Session>,
    pub(super) connections: Arc<AtomicUsize>,
    silent: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    accepting: Option<std::thread::JoinHandle<()>>,
}

impl Runner {
    pub(super) fn serve(route: impl Fn(String, UnixStream) + Send + Sync + 'static) -> Self {
        Self::serve_on(Session::fixture(), server(), descriptor(Some(true)), route)
    }

    pub(super) fn serve_describing(
        descriptor: String,
        route: impl Fn(String, UnixStream) + Send + Sync + 'static,
    ) -> Self {
        Self::serve_on(Session::fixture(), server(), descriptor, route)
    }

    pub(super) fn serve_as(
        expected: &str,
        route: impl Fn(String, UnixStream) + Send + Sync + 'static,
    ) -> Self {
        Self::serve_on(
            Session::fixture(),
            pinned(expected),
            descriptor(Some(true)),
            route,
        )
    }

    pub(super) fn serve_with(
        policy: StallPolicy,
        route: impl Fn(String, UnixStream) + Send + Sync + 'static,
    ) -> Self {
        Self::serve_on(
            Session::fixture_with_stall_policy(policy),
            server(),
            descriptor(Some(true)),
            route,
        )
    }

    fn serve_on(
        session: Session,
        server: Server,
        descriptor: String,
        route: impl Fn(String, UnixStream) + Send + Sync + 'static,
    ) -> Self {
        let session = Arc::new(session);
        let listener = UnixListener::bind(session.socket_path()).unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let connections = Arc::new(AtomicUsize::new(0));
        let (stopped, counted) = (Arc::clone(&stop), Arc::clone(&connections));
        let silent = Arc::new(AtomicBool::new(false));
        let silenced = Arc::clone(&silent);
        let route = Arc::new(route);
        let accepting = std::thread::spawn(move || {
            let mut workers = Vec::new();
            while !stopped.load(Ordering::Acquire) {
                let Ok((mut socket, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                };
                socket.set_nonblocking(false).unwrap();
                socket.set_read_timeout(Some(WAIT)).unwrap();
                socket.set_write_timeout(Some(WAIT)).unwrap();
                let route = Arc::clone(&route);
                let counted = Arc::clone(&counted);
                let descriptor = descriptor.clone();
                let silenced = Arc::clone(&silenced);
                workers.push(std::thread::spawn(move || {
                    let head = read_head(&mut socket);
                    if is_identity(&head) && silenced.load(Ordering::Acquire) {
                        return std::thread::sleep(SILENCE);
                    }
                    if is_identity(&head) {
                        return respond(&mut socket, 200, descriptor.as_bytes());
                    }
                    counted.fetch_add(1, Ordering::AcqRel);
                    route(head, socket);
                }));
            }
            for worker in workers {
                let _ = worker.join();
            }
        });
        Self {
            lease: ConnectionLease::new(server, Arc::clone(&session)),
            session,
            connections,
            silent,
            stop,
            accepting: Some(accepting),
        }
    }

    pub(super) fn silence_identity(&self) {
        self.silent.store(true, Ordering::Release);
    }

    pub(super) fn routed(&self) -> usize {
        self.connections.load(Ordering::Acquire)
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.lease.revoke();
        if let Some(accepting) = self.accepting.take() {
            let _ = accepting.join();
        }
    }
}
