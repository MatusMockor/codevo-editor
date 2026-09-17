#[path = "pending_connection.rs"]
mod pending_connection;
use pending_connection::PendingConnection;
#[path = "connection_lease.rs"]
mod connection_lease;
use super::{
    repository::{FileServerRepository, ServerRepository},
    transport,
    types::*,
};
pub(super) use connection_lease::ConnectionLease;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Registry {
    servers: Vec<Server>,
    epochs: HashMap<String, u64>,
    next_epoch: u64,
    closed: bool,
    pending: HashMap<String, Arc<PendingConnection>>,
    connections: HashMap<String, ConnectionLease>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct MemoryRepository(Mutex<Vec<Server>>);
    impl ServerRepository for MemoryRepository {
        fn load(&self) -> Result<Vec<Server>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, servers: &[Server]) -> Result<(), String> {
            *self.0.lock().unwrap() = servers.to_vec();
            Ok(())
        }
    }
    fn state() -> RemoteRunnerState {
        RemoteRunnerState::with_repository(Box::<MemoryRepository>::default()).unwrap()
    }
    fn server() -> Server {
        Server {
            id: "test".into(),
            name: "Test".into(),
            host: "127.0.0.1".into(),
            username: "codex".into(),
            port: 22,
            connected: true,
            runner_id: Some("runner-test".into()),
        }
    }
    #[test]
    fn removed_server_cannot_be_restored_by_late_connect() {
        let state = state();
        let stale_epoch = state.advance("test").unwrap();
        state.disconnect("test", true).unwrap();
        assert!(state.store("test", stale_epoch, Some(server())).is_err());
        assert!(state.list().unwrap().is_empty());
    }
    #[test]
    fn disconnect_is_durable_and_blocks_requests() {
        let state = state();
        let epoch = state.advance("test").unwrap();
        state.store("test", epoch, Some(server())).unwrap();
        state.disconnect("test", false).unwrap();
        assert!(!state.list().unwrap()[0].connected);
        assert!(!state.0.repository.load().unwrap()[0].connected);
        assert!(state
            .call("test", "GET", "/v1/runner", None, vec![])
            .unwrap_err()
            .contains("not connected"));
    }
    #[test]
    fn shutdown_rejects_late_connect_install_and_new_admission() {
        let state = state();
        let epoch = state.advance("test").unwrap();
        state.shutdown();
        state.shutdown();
        assert!(state.store("test", epoch, Some(server())).is_err());
        assert!(state.advance("test").is_err());
        assert!(state.connection_lease("test").is_err());
        assert!(state.list().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_waits_for_connection_already_transferred_to_retirement() {
        let state = state();
        let session = Arc::new(transport::Session::fixture());
        let lease = ConnectionLease::new(server(), Arc::clone(&session));
        state
            .0
            .registry
            .lock()
            .unwrap()
            .connections
            .insert("test".into(), lease.clone());
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let publisher = std::thread::spawn(move || {
            lease.publish_if_current(|| {
                entered_tx.send(()).unwrap();
                finish_rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
            })
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        let retiring = state.clone();
        let retire = std::thread::spawn(move || retiring.advance("test"));
        let start = std::time::Instant::now();
        while state
            .0
            .registry
            .lock()
            .unwrap()
            .connections
            .contains_key("test")
        {
            assert!(start.elapsed() < std::time::Duration::from_secs(2));
            std::thread::yield_now();
        }
        let stopping = state.clone();
        let (stopped_tx, stopped_rx) = std::sync::mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            stopping.shutdown();
            stopped_tx.send(()).unwrap();
        });
        assert!(stopped_rx.try_recv().is_err());
        finish_tx.send(()).unwrap();
        publisher.join().unwrap();
        retire.join().unwrap().unwrap();
        stopped_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        shutdown.join().unwrap();
        assert!(!session.is_alive());
    }

    #[test]
    fn excessive_message_is_rejected_before_connection() {
        let state = state();
        let request = CreateRequest {
            server_id: "test".into(),
            idempotency_key: "test".into(),
            provider: Provider::Codex,
            isolation: None,
            launch: None,
            instructions: None,
            parts: vec![Part::Text {
                text: "x".repeat(48_001),
            }],
        };
        assert!(state.create(request).unwrap_err().contains("limits"));
    }

    #[test]
    fn superseded_connection_during_disk_write_is_rolled_back() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc,
        };
        struct PausedRepository {
            data: Arc<Mutex<Vec<Server>>>,
            once: AtomicBool,
            started: mpsc::Sender<()>,
            resume: Mutex<mpsc::Receiver<()>>,
        }
        impl ServerRepository for PausedRepository {
            fn load(&self) -> Result<Vec<Server>, String> {
                Ok(self.data.lock().unwrap().clone())
            }
            fn save(&self, servers: &[Server]) -> Result<(), String> {
                if !self.once.swap(true, Ordering::SeqCst) {
                    self.started.send(()).unwrap();
                    self.resume
                        .lock()
                        .unwrap()
                        .recv_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                }
                *self.data.lock().unwrap() = servers.to_vec();
                Ok(())
            }
        }
        let data = Arc::new(Mutex::new(Vec::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let state = RemoteRunnerState::with_repository(Box::new(PausedRepository {
            data: Arc::clone(&data),
            once: AtomicBool::new(false),
            started: started_tx,
            resume: Mutex::new(resume_rx),
        }))
        .unwrap();
        let epoch = state.advance("test").unwrap();
        let pending = state.clone();
        let worker = std::thread::spawn(move || pending.store("test", epoch, Some(server())));
        started_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        state.advance("test").unwrap();
        resume_tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_err());
        assert!(state.list().unwrap().is_empty());
        assert!(data.lock().unwrap().is_empty());
    }
}

struct Inner {
    registry: Mutex<Registry>,
    // Serializes repository writes, never held during network I/O.
    persistence: Mutex<()>,
    shutdown: Mutex<()>,
    repository: Box<dyn ServerRepository>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        for (_, lease) in self
            .registry
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .connections
            .drain()
        {
            lease.revoke();
        }
    }
}

#[derive(Clone)]
pub struct RemoteRunnerState(Arc<Inner>);

impl RemoteRunnerState {
    pub fn new(app_data: PathBuf) -> Result<Self, String> {
        Self::with_repository(Box::new(FileServerRepository(
            app_data.join("remote-servers.json"),
        )))
    }

    fn with_repository(repository: Box<dyn ServerRepository>) -> Result<Self, String> {
        let servers = repository.load()?;
        Ok(Self(Arc::new(Inner {
            registry: Mutex::new(Registry {
                servers,
                ..Registry::default()
            }),
            persistence: Mutex::new(()),
            shutdown: Mutex::new(()),
            repository,
        })))
    }

    pub(crate) fn shutdown(&self) {
        let _shutdown = self.0.shutdown.lock().unwrap_or_else(|e| e.into_inner());
        let (connections, pending) = {
            let mut registry = self.0.registry.lock().unwrap_or_else(|e| e.into_inner());
            registry.closed = true;
            (
                registry
                    .connections
                    .drain()
                    .map(|(_, lease)| lease)
                    .collect::<Vec<_>>(),
                registry
                    .pending
                    .drain()
                    .map(|(_, pending)| pending)
                    .collect::<Vec<_>>(),
            )
        };
        for pending in pending {
            pending.cancel_and_wait();
        }

        for lease in connections {
            lease.revoke();
        }
    }

    pub(super) fn list(&self) -> Result<Vec<Server>, String> {
        Ok(self
            .0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?
            .servers
            .clone())
    }

    fn advance(&self, server_id: &str) -> Result<u64, String> {
        let _retirement = self.0.shutdown.lock().unwrap_or_else(|e| e.into_inner());
        id(server_id)?;
        let mut registry = self
            .0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?;
        if registry.closed {
            return Err("Runner connections are shutting down".into());
        }
        if !registry.epochs.contains_key(server_id) && registry.epochs.len() >= 128 {
            return Err("Server connection operation limit reached; restart the editor".into());
        }
        registry.next_epoch = registry
            .next_epoch
            .checked_add(1)
            .ok_or("Server operation limit reached")?;
        let epoch = registry.next_epoch;
        registry.epochs.insert(server_id.into(), epoch);
        let previous = registry.connections.remove(server_id);
        let pending = registry.pending.remove(server_id);
        drop(registry);
        if let Some(pending) = pending {
            pending.cancel_and_wait();
        }
        if let Some(previous) = previous {
            previous.revoke();
        }
        Ok(epoch)
    }

    fn store(&self, server_id: &str, epoch: u64, server: Option<Server>) -> Result<(), String> {
        let _writer = self
            .0
            .persistence
            .lock()
            .map_err(|_| "Server storage unavailable")?;
        let mut servers = {
            let registry = self
                .0
                .registry
                .lock()
                .map_err(|_| "Server registry unavailable")?;
            if registry.closed || registry.epochs.get(server_id) != Some(&epoch) {
                return Err("Server connection was superseded".into());
            }
            registry.servers.clone()
        };
        servers.retain(|item| item.id != server_id);
        if let Some(server) = server {
            servers.push(server);
        }
        if servers.len() > 32 {
            return Err("At most 32 servers can be saved".into());
        }
        self.0.repository.save(&servers)?;
        let mut registry = self
            .0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?;
        if registry.closed || registry.epochs.get(server_id) != Some(&epoch) {
            let previous = registry.servers.clone();
            drop(registry);
            self.0.repository.save(&previous)?;
            return Err("Server connection was superseded".into());
        }
        registry.servers = servers;
        Ok(())
    }

    pub(super) fn connect(&self, request: ConnectRequest) -> Result<Server, String> {
        let server = request.validate()?;
        let epoch = self.advance(&server.id)?;
        let pending = PendingConnection::new();
        let completion = pending.completion();
        {
            let mut registry = self
                .0
                .registry
                .lock()
                .map_err(|_| "Server registry unavailable")?;
            if registry.closed || registry.epochs.get(&server.id) != Some(&epoch) {
                return Err("Server connection was superseded".into());
            }
            registry
                .pending
                .insert(server.id.clone(), Arc::clone(&pending));
        }
        let server_id = server.id.clone();
        let result = self.connect_pending(server, epoch, &pending);
        drop(completion);
        let mut registry = self
            .0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?;
        if registry
            .pending
            .get(&server_id)
            .is_some_and(|current| Arc::ptr_eq(current, &pending))
        {
            registry.pending.remove(&server_id);
        }
        if registry.closed {
            return Err("Runner connections are shutting down".into());
        }
        result
    }

    fn connect_pending(
        &self,
        mut server: Server,
        epoch: u64,
        pending: &PendingConnection,
    ) -> Result<Server, String> {
        server.runner_id = self
            .list()?
            .iter()
            .find(|s| s.id == server.id)
            .and_then(|s| s.runner_id.clone());
        let session = pending.start(&server)?;
        let info = session.request(&server, "GET", "/v1/runner", None, vec![])?;
        let runner_id = super::descriptor::validate(info)?;
        if self
            .list()?
            .iter()
            .find(|s| s.id == server.id)
            .and_then(|s| s.runner_id.as_ref())
            .is_some_and(|previous| previous != &runner_id)
        {
            return Err("Runner identity changed. Remove this server and add it again to connect to the replacement.".into());
        }
        server.runner_id = Some(runner_id);
        self.store(&server.id, epoch, Some(server.clone()))?;
        let mut registry = self
            .0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?;
        if registry.closed || registry.epochs.get(&server.id) != Some(&epoch) {
            return Err("Server connection was superseded".into());
        }
        registry.connections.insert(
            server.id.clone(),
            ConnectionLease::new(server.clone(), session),
        );
        Ok(server)
    }

    pub(super) fn disconnect(&self, server_id: &str, remove: bool) -> Result<(), String> {
        let epoch = self.advance(server_id)?;
        let server = if remove {
            None
        } else {
            let mut server = self
                .list()?
                .into_iter()
                .find(|s| s.id == server_id)
                .ok_or("Server not found")?;
            server.connected = false;
            Some(server)
        };
        self.store(server_id, epoch, server)
    }

    pub(super) fn call(
        &self,
        server_id: &str,
        method: &str,
        path: &str,
        body: Option<Value>,
        headers: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let lease = self.connection_lease(server_id)?;
        let session = lease.session()?;
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        let value = session.request(lease.server(), method, path, body, headers)?;
        if !lease.is_current() {
            return Err("Server connection changed during request".into());
        }
        Ok(value)
    }

    pub(super) fn connection_lease(&self, server_id: &str) -> Result<ConnectionLease, String> {
        id(server_id)?;
        self.0
            .registry
            .lock()
            .map_err(|_| "Server registry unavailable")?
            .connections
            .get(server_id)
            .filter(|lease| lease.is_current())
            .cloned()
            .ok_or("Server is not connected".into())
    }

    pub(super) fn create(&self, request: CreateRequest) -> Result<Value, String> {
        let body = request.body()?;
        self.call(&request.server_id, "POST", "/v1/tasks", Some(body), vec![])
    }

    pub(super) fn upload(&self, request: UploadRequest) -> Result<Value, String> {
        use base64::Engine;
        id(&request.attachment_id)?;
        if !matches!(request.media_type.as_str(), "image/png" | "image/jpeg")
            || request.name.is_empty()
            || request.name.len() > 255
            || request.name.chars().any(char::is_control)
            || request.base64.len() > 11_184_812
        {
            return Err("Invalid image attachment".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&request.base64)
            .map_err(|_| "Invalid image encoding")?;
        if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
            return Err("Image exceeds runner limit".into());
        }
        let filename: String = url::form_urlencoded::byte_serialize(request.name.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        self.call(
            &request.server_id,
            "PUT",
            &format!("/v1/attachments/{}", request.attachment_id),
            Some(json!({"base64":request.base64})),
            vec![
                ("content-type".into(), request.media_type),
                ("x-file-name".into(), filename),
            ],
        )
    }
}
