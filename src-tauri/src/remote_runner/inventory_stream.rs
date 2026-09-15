//! Owned, bounded subscriptions to inventory invalidations (never transcript payloads).
use super::{service::RemoteRunnerState, types};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

#[path = "inventory_stream_protocol.rs"]
mod protocol;
use protocol::Cursor;

const MAX_SUBSCRIPTIONS: usize = 16;
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(30);
const PING_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InventoryChangeEvent {
    Connected,
    Changed,
    Disconnected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscribeChangesRequest {
    server_id: String,
    subscription_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionRequest {
    subscription_id: String,
}

#[derive(Default)]
struct Worker {
    pending: bool,
    handle: Option<std::thread::JoinHandle<()>>,
}

#[derive(Default)]
struct Owner {
    canceled: Mutex<bool>,
    worker: Mutex<Worker>,
    ready: Condvar,
    #[cfg(unix)]
    socket: Mutex<Option<std::os::unix::net::UnixStream>>,
}
impl Owner {
    fn cancel(&self) {
        *self
            .canceled
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = true;
        #[cfg(unix)]
        if let Some(socket) = self
            .socket
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
    }
    fn canceled(&self) -> bool {
        *self
            .canceled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
    fn started(&self, handle: Option<std::thread::JoinHandle<()>>) {
        let mut worker = self
            .worker
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        worker.pending = false;
        worker.handle = handle;
        self.ready.notify_all();
    }
    fn join(&self) {
        let worker = self
            .worker
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut worker = self
            .ready
            .wait_while(worker, |worker| worker.pending)
            .unwrap_or_else(|error| error.into_inner());
        let handle = worker.handle.take();
        if let Some(handle) = handle {
            let _ = handle.join();
        }
        drop(worker);
    }
    fn publish(
        &self,
        channel: &Channel<InventoryChangeEvent>,
        event: InventoryChangeEvent,
    ) -> bool {
        let mut canceled = self
            .canceled
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if *canceled {
            return false;
        }
        if channel.send(event).is_err() {
            *canceled = true;
            return false;
        }
        true
    }
}

#[cfg(unix)]
struct ActiveSocket<'a>(&'a Owner);
#[cfg(unix)]
impl Drop for ActiveSocket<'_> {
    fn drop(&mut self) {
        self.0
            .socket
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
    }
}
#[cfg(unix)]
fn attach_socket<'a>(
    owner: &'a Owner,
    socket: &std::os::unix::net::UnixStream,
) -> Option<ActiveSocket<'a>> {
    let canceled = owner
        .canceled
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if *canceled {
        return None;
    }
    let socket = socket.try_clone().ok()?;
    *owner
        .socket
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(socket);
    Some(ActiveSocket(owner))
}

type Registry = Arc<Mutex<HashMap<String, Arc<Owner>>>>;

#[derive(Default)]
pub struct InventoryStreamState(Registry, AtomicBool);
impl Drop for InventoryStreamState {
    fn drop(&mut self) {
        self.shutdown();
    }
}
impl InventoryStreamState {
    pub(crate) fn shutdown(&self) {
        self.1.store(true, Ordering::Release);
        let owners: Vec<_> = self
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .cloned()
            .collect();
        for owner in &owners {
            owner.cancel();
        }
        for owner in owners {
            owner.join();
        }
    }
}

struct Registration {
    registry: Registry,
    id: String,
    owner: Arc<Owner>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if registry
            .get(&self.id)
            .is_some_and(|owner| Arc::ptr_eq(owner, &self.owner))
        {
            registry.remove(&self.id);
        }
    }
}
impl InventoryStreamState {
    fn register(&self, id: &str, pending_worker: bool) -> Result<Registration, String> {
        types::uuid(id)?;
        let mut registry = self
            .0
            .lock()
            .map_err(|_| "Subscription registry unavailable")?;
        if self.1.load(Ordering::Acquire) {
            return Err("Runner subscriptions are shut down".into());
        }
        if registry.contains_key(id) || registry.len() >= MAX_SUBSCRIPTIONS {
            return Err("Runner subscription limit or duplicate subscription".into());
        }
        let owner = Arc::new(Owner::default());
        owner
            .worker
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pending = pending_worker;
        registry.insert(id.into(), owner.clone());
        Ok(Registration {
            registry: self.0.clone(),
            id: id.into(),
            owner,
        })
    }
    fn cancel(&self, id: &str) -> Result<Option<Arc<Owner>>, String> {
        types::uuid(id)?;
        let owner = self
            .0
            .lock()
            .map_err(|_| "Subscription registry unavailable")?
            .get(id)
            .cloned();
        if let Some(owner) = &owner {
            owner.cancel();
        }
        Ok(owner)
    }
}

#[tauri::command]
pub async fn remote_runner_subscribe_changes(
    state: tauri::State<'_, RemoteRunnerState>,
    subscriptions: tauri::State<'_, InventoryStreamState>,
    request: SubscribeChangesRequest,
    on_event: Channel<InventoryChangeEvent>,
) -> Result<(), String> {
    let lease = state.connection_lease(&request.server_id)?;
    let registration = subscriptions.register(&request.subscription_id, true)?;
    let owner = registration.owner.clone();
    let worker = std::thread::Builder::new()
        .name("runner-inventory".into())
        .spawn(move || {
            run(lease, registration, on_event);
        });
    match worker {
        Ok(worker) => {
            owner.started(Some(worker));
            Ok(())
        }
        Err(_) => {
            owner.started(None);
            Err("Could not start runner subscription".into())
        }
    }
}

#[tauri::command]
pub async fn remote_runner_unsubscribe_changes(
    subscriptions: tauri::State<'_, InventoryStreamState>,
    request: SubscriptionRequest,
) -> Result<(), String> {
    let owner = subscriptions.cancel(&request.subscription_id)?;
    if let Some(owner) = owner {
        tauri::async_runtime::spawn_blocking(move || owner.join())
            .await
            .map_err(|_| "Runner subscription cleanup failed")?;
    }
    Ok(())
}

fn retry_delay(attempt: u32, id: &str) -> Duration {
    let seconds = 5u64.saturating_mul(1 << attempt.min(3)).min(30);
    let jitter = id.bytes().fold(0u64, |sum, byte| sum + u64::from(byte)) % 1001;
    Duration::from_millis(seconds * 1000 + jitter)
}

#[cfg(unix)]
fn run(
    lease: super::service::ConnectionLease,
    registration: Registration,
    channel: Channel<InventoryChangeEvent>,
) {
    let mut attempt = 0;
    while !registration.owner.canceled() && lease.is_current() {
        let connected = lease
            .session_with_cancellation(|| registration.owner.canceled())
            .and_then(|session| {
                session.connect_websocket(lease.runner_id(), || {
                    registration.owner.canceled() || !lease.is_current()
                })
            });
        if registration.owner.canceled() || !lease.is_current() {
            break;
        }
        if let Ok(socket) = connected {
            if read_socket(
                socket,
                || lease.is_current(),
                lease.runner_id(),
                &registration.owner,
                |event| publish_owned(&lease, &registration.owner, &channel, event),
            ) {
                attempt = 0;
            }
        }
        if registration.owner.canceled() || !lease.is_current() {
            break;
        }
        if !publish_owned(
            &lease,
            &registration.owner,
            &channel,
            InventoryChangeEvent::Disconnected,
        ) {
            break;
        }
        let deadline = Instant::now() + retry_delay(attempt, &registration.id);
        attempt = attempt.saturating_add(1);
        while Instant::now() < deadline && !registration.owner.canceled() && lease.is_current() {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(not(unix))]
fn run(
    lease: super::service::ConnectionLease,
    registration: Registration,
    channel: Channel<InventoryChangeEvent>,
) {
    publish_owned(
        &lease,
        &registration.owner,
        &channel,
        InventoryChangeEvent::Disconnected,
    );
}

fn publish_owned(
    lease: &super::service::ConnectionLease,
    owner: &Owner,
    channel: &Channel<InventoryChangeEvent>,
    event: InventoryChangeEvent,
) -> bool {
    let mut sent = false;
    lease.publish_if_current(|| {
        sent = owner.publish(channel, event);
    });
    sent
}

#[cfg(unix)]
fn read_socket(
    mut socket: tungstenite::WebSocket<super::transport::DeadlineStream>,
    is_current: impl Fn() -> bool,
    runner_id: &str,
    owner: &Owner,
    publish: impl Fn(InventoryChangeEvent) -> bool,
) -> bool {
    use tungstenite::{Error, Message};
    let Some(_active_socket) = attach_socket(owner, socket.get_ref().socket()) else {
        return false;
    };
    let mut cursor = Cursor::default();
    let started = Instant::now();
    let mut last_frame = started;
    let mut frame_window = started;
    let mut frame_count = 0u32;
    let mut last_ping = Instant::now();
    let mut last_emit = Instant::now();
    let mut pending_change = false;
    while !owner.canceled() && is_current() && last_frame.elapsed() < HEARTBEAT_TIMEOUT {
        if cursor.0.is_none() && started.elapsed() >= HEARTBEAT_TIMEOUT {
            break;
        }
        if last_ping.elapsed() >= PING_INTERVAL {
            if socket.send(Message::Ping(Vec::new().into())).is_err() {
                break;
            }
            last_ping = Instant::now();
        }
        match socket.read() {
            Ok(message) => {
                last_frame = Instant::now();
                socket.get_mut().refresh_read_deadline(HEARTBEAT_TIMEOUT);
                if frame_window.elapsed() >= Duration::from_secs(1) {
                    frame_window = last_frame;
                    frame_count = 0;
                }
                frame_count += 1;
                if frame_count > 128 {
                    break;
                }
                if owner.canceled() || !is_current() {
                    break;
                }
                match message {
                    Message::Text(text) => match cursor.accept(&text, runner_id) {
                        Ok(Some(InventoryChangeEvent::Connected)) => {
                            if !publish(InventoryChangeEvent::Connected) {
                                break;
                            }
                        }
                        Ok(Some(InventoryChangeEvent::Changed)) => pending_change = true,
                        Ok(None) => {}
                        _ => break,
                    },
                    Message::Ping(_) | Message::Pong(_) => {}
                    _ => break,
                }
            }
            Err(Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
        if pending_change && last_emit.elapsed() >= Duration::from_millis(250) {
            if owner.canceled() || !is_current() || !publish(InventoryChangeEvent::Changed) {
                break;
            }
            pending_change = false;
            last_emit = Instant::now();
        }
    }
    cursor.0.is_some()
}

#[cfg(test)]
#[path = "inventory_stream_tests.rs"]
mod tests;
