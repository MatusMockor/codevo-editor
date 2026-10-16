use super::tunnel_dispatch::{Authority, TIMED_OUT};
use super::tunnel_http::{self, CLIENT_CAPABILITIES, CLIENT_CAPABILITIES_2, CONNECTION_FAILED};
use super::Session;
use bytes::Bytes;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch, Notify};

#[path = "tunnel_transfer_watchdog.rs"]
mod watchdog;
use watchdog::{Signals, Watchdog};

const BUFFERED_CHUNKS: usize = 2;
const REPLY_LIMIT: usize = 16 * 1024;
const BACKSTOP: Duration = Duration::from_secs(5);
const CLOSED: &str = "Runner connection changed during request.";
const UNAUTHORIZED: &str = "Runner request failed (HTTP 401).";
const UNREADABLE_RESPONSE: &str = "Unable to read runner response.";
const FAILED: &str = "Runner operation failed";

#[derive(Clone, Copy)]
pub(in crate::remote_runner) struct TransferPolicy {
    pub(in crate::remote_runner) total: Duration,
    pub(in crate::remote_runner) idle: Duration,
    pub(in crate::remote_runner) local: Duration,
}

impl TransferPolicy {
    pub(in crate::remote_runner) const FILE: Self = Self {
        total: Duration::from_secs(15 * 60),
        idle: Duration::from_secs(60),
        local: Duration::from_secs(60),
    };
}

#[derive(Debug, PartialEq, Eq)]
pub(in crate::remote_runner) enum Failure {
    Cancelled,
    Status(u16),
    Exceeded,
    Local,
    Unsupported,
    Transport(String),
}

impl Failure {
    fn unauthorized(&self) -> bool {
        match self {
            Self::Status(status) => *status == 401,
            Self::Transport(reason) => reason == UNAUTHORIZED,
            Self::Cancelled | Self::Exceeded | Self::Local | Self::Unsupported => false,
        }
    }

    fn unanswered(&self) -> bool {
        match self {
            Self::Transport(reason) => reason == TIMED_OUT || reason == CONNECTION_FAILED,
            Self::Cancelled
            | Self::Status(_)
            | Self::Exceeded
            | Self::Local
            | Self::Unsupported => false,
        }
    }
}

pub(in crate::remote_runner) struct UploadHead {
    pub(in crate::remote_runner) path: String,
    pub(in crate::remote_runner) headers: Vec<(&'static str, String)>,
    pub(in crate::remote_runner) length: u64,
    pub(in crate::remote_runner) capability: &'static str,
}

#[derive(Debug)]
pub(in crate::remote_runner) struct Reply {
    pub(in crate::remote_runner) status: u16,
    pub(in crate::remote_runner) body: Vec<u8>,
}

pub(super) struct Access {
    pub(super) client: reqwest::Client,
    pub(super) token: String,
    pub(super) expected: Option<String>,
    pub(super) authority: Authority,
}

impl Access {
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let request = self
            .client
            .request(method, format!("http://localhost{path}"))
            .bearer_auth(&self.token)
            .header(
                "x-codevo-client-capabilities",
                reqwest::header::HeaderValue::from_static(CLIENT_CAPABILITIES),
            )
            .header(
                "x-codevo-client-capabilities-2",
                reqwest::header::HeaderValue::from_static(CLIENT_CAPABILITIES_2),
            );
        let Some(id) = &self.expected else {
            return request;
        };
        request.header("x-codevo-runner-id", id)
    }

    async fn preflight(&self) -> Result<(), Failure> {
        self.authority.ended().map_err(Failure::Transport)?;
        let evidence = self.authority.evidence();
        tunnel_http::pinned_identity(&self.client, &self.token, self.expected.as_deref(), &|| {
            evidence.record_inbound()
        })
        .await
        .map_err(Failure::Transport)?;
        self.authority.ended().map_err(Failure::Transport)
    }

    async fn preflight_capable(&self, capability: &str) -> Result<(), Failure> {
        self.authority.ended().map_err(Failure::Transport)?;
        let evidence = self.authority.evidence();
        let descriptor =
            tunnel_http::descriptor(&self.client, &self.token, self.expected.as_deref(), &|| {
                evidence.record_inbound()
            })
            .await
            .map_err(Failure::Transport)?;
        self.authority.ended().map_err(Failure::Transport)?;
        let capable = descriptor
            .get("capabilities")
            .and_then(|capabilities| capabilities.get(capability))
            .and_then(serde_json::Value::as_bool);
        if capable != Some(true) {
            return Err(Failure::Unsupported);
        }
        Ok(())
    }
}

#[derive(Default)]
struct Pulse {
    beat: Notify,
    beats: AtomicU64,
    waiting: AtomicBool,
    sent: AtomicBool,
}

impl Pulse {
    fn progressed(&self) {
        self.beats.fetch_add(1, Ordering::AcqRel);
        self.beat.notify_one();
    }

    fn waits(&self, waiting: bool) {
        if self.waiting.swap(waiting, Ordering::AcqRel) == waiting {
            return;
        }
        self.beat.notify_one();
    }

    fn signals(&self) -> Signals {
        Signals {
            beats: self.beats.load(Ordering::Acquire),
            waiting: self.waiting.load(Ordering::Acquire),
            sent: self.sent.load(Ordering::Acquire),
        }
    }
}

#[derive(Debug)]
struct Interrupted;

impl std::fmt::Display for Interrupted {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("upload interrupted")
    }
}

impl std::error::Error for Interrupted {}

struct Outbound {
    chunks: mpsc::Receiver<Bytes>,
    remaining: u64,
    pulse: Arc<Pulse>,
}

impl http_body::Body for Outbound {
    type Data = Bytes;
    type Error = Interrupted;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<http_body::Frame<Bytes>, Interrupted>>> {
        if self.remaining == 0 {
            return Poll::Ready(None);
        }
        let Poll::Ready(chunk) = self.chunks.poll_recv(context) else {
            self.pulse.waits(true);
            return Poll::Pending;
        };
        self.pulse.waits(false);
        let Some(chunk) = chunk else {
            return Poll::Ready(Some(Err(Interrupted)));
        };
        let length = chunk.len() as u64;
        if length == 0 || length > self.remaining {
            return Poll::Ready(Some(Err(Interrupted)));
        }
        self.remaining -= length;
        if self.remaining == 0 {
            self.pulse.sent.store(true, Ordering::Release);
        }
        self.pulse.progressed();
        Poll::Ready(Some(Ok(http_body::Frame::data(chunk))))
    }

    fn is_end_stream(&self) -> bool {
        self.remaining == 0
    }

    fn size_hint(&self) -> http_body::SizeHint {
        http_body::SizeHint::with_exact(self.remaining)
    }
}

async fn cancelled(cancel: &mut Option<watch::Receiver<bool>>) {
    let Some(cancel) = cancel else {
        return std::future::pending().await;
    };
    if cancel.wait_for(|cancelled| *cancelled).await.is_err() {
        std::future::pending::<()>().await;
    }
}

async fn supervised<T>(
    exchange: impl Future<Output = Result<T, Failure>>,
    mut authority: Authority,
    mut cancel: Option<watch::Receiver<bool>>,
    policy: TransferPolicy,
    deadline: Instant,
    pulse: Arc<Pulse>,
    outbound: u64,
) -> Result<T, Failure> {
    tokio::pin!(exchange);
    let evidence = authority.evidence();
    let mut watchdog = Watchdog::new(policy, outbound, deadline, Instant::now());
    let mut _grace = None;
    loop {
        let wake = tokio::time::Instant::from_std(watchdog.wake());
        tokio::select! {
            biased;
            reason = authority.revoked() => return Err(Failure::Transport(reason)),
            _ = cancelled(&mut cancel) => return Err(Failure::Cancelled),
            result = &mut exchange => {
                let suspect = watchdog.suspect().filter(|_| result.as_ref().is_err_and(Failure::unanswered));
                if let Some(since) = suspect {
                    evidence.suspect(since, Instant::now());
                }
                return result;
            }
            _ = pulse.beat.notified() => {
                let now = Instant::now();
                let observed = watchdog.observe(pulse.signals(), now);
                if observed.progressed {
                    evidence.record_inbound_at(now);
                }
                if observed.tail {
                    _grace = watchdog.tail_until().map(|until| evidence.hold(until));
                }
            }
            _ = tokio::time::sleep_until(wake) => {
                let now = Instant::now();
                let Some(expiry) = watchdog.expired(now) else {
                    continue;
                };
                if let Some(since) = expiry.suspect {
                    evidence.suspect(since, now);
                }
                return Err(expiry.failure);
            }
        }
    }
}

fn remaining(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now()) + BACKSTOP
}

async fn bounded(response: &mut reqwest::Response, pulse: &Pulse) -> Result<Vec<u8>, Failure> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Failure::Transport(UNREADABLE_RESPONSE.into()))?
    {
        pulse.progressed();
        if chunk.len() > REPLY_LIMIT.saturating_sub(body.len()) {
            return Err(Failure::Exceeded);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn put(
    access: Access,
    head: UploadHead,
    body: Outbound,
    deadline: Instant,
    pulse: Arc<Pulse>,
) -> Result<Reply, Failure> {
    access.preflight_capable(head.capability).await?;
    pulse.progressed();
    let mut request = access
        .request(reqwest::Method::PUT, &head.path)
        .header(reqwest::header::CONTENT_LENGTH, head.length)
        .timeout(remaining(deadline));
    for (name, value) in head.headers {
        request = request.header(name, value);
    }
    let mut response = request
        .body(reqwest::Body::wrap(body))
        .send()
        .await
        .map_err(|_| Failure::Transport(CONNECTION_FAILED.into()))?;
    pulse.progressed();
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(Failure::Status(status));
    }
    let body = bounded(&mut response, &pulse).await?;
    Ok(Reply { status, body })
}

async fn get(
    access: Access,
    path: String,
    limit: u64,
    deadline: Instant,
    chunks: mpsc::Sender<Bytes>,
    pulse: Arc<Pulse>,
) -> Result<(), Failure> {
    access.preflight().await?;
    pulse.progressed();
    let mut response = access
        .request(reqwest::Method::GET, &path)
        .timeout(remaining(deadline))
        .send()
        .await
        .map_err(|_| Failure::Transport(CONNECTION_FAILED.into()))?;
    pulse.progressed();
    let status = response.status().as_u16();
    if status != 200 {
        return Err(Failure::Status(status));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(Failure::Exceeded);
    }
    let mut received = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Failure::Transport(UNREADABLE_RESPONSE.into()))?
    {
        pulse.progressed();
        received = received.saturating_add(chunk.len() as u64);
        if received > limit {
            return Err(Failure::Exceeded);
        }
        hand_over(&chunks, chunk, &pulse).await?;
    }
    Ok(())
}

async fn hand_over(
    chunks: &mpsc::Sender<Bytes>,
    chunk: Bytes,
    pulse: &Pulse,
) -> Result<(), Failure> {
    let chunk = match chunks.try_send(chunk) {
        Ok(()) => return Ok(()),
        Err(mpsc::error::TrySendError::Closed(_)) => return Err(Failure::Transport(CLOSED.into())),
        Err(mpsc::error::TrySendError::Full(chunk)) => chunk,
    };
    pulse.waits(true);
    let sent = chunks.send(chunk).await;
    pulse.waits(false);
    sent.map_err(|_| Failure::Transport(CLOSED.into()))
}

struct Exchange<T>(Option<tauri::async_runtime::JoinHandle<Result<T, Failure>>>);

impl<T> Exchange<T> {
    async fn outcome(&mut self) -> Result<T, Failure> {
        let Some(task) = self.0.as_mut() else {
            return Err(Failure::Transport(FAILED.into()));
        };
        let result = task
            .await
            .unwrap_or_else(|_| Err(Failure::Transport(FAILED.into())));
        self.0 = None;
        result
    }
}

impl<T> Drop for Exchange<T> {
    fn drop(&mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
        }
    }
}

fn settled<T>(session: &Session, result: Result<T, Failure>) -> Result<T, Failure> {
    if result.as_ref().is_err_and(Failure::unauthorized) {
        session.close();
    }
    if session.dispatch.is_stalled() {
        session.close();
        return Err(Failure::Transport(CONNECTION_FAILED.into()));
    }
    if session.closed.load(Ordering::Acquire) {
        return Err(Failure::Transport(CLOSED.into()));
    }
    result
}

pub(in crate::remote_runner) struct Transfer<'a, T> {
    session: &'a Session,
    exchange: Exchange<T>,
}

impl<T> Transfer<'_, T> {
    pub(in crate::remote_runner) async fn settled(&mut self) -> Result<T, Failure> {
        let result = self.exchange.outcome().await;
        settled(self.session, result)
    }

    #[cfg(test)]
    pub(in crate::remote_runner) fn finish(mut self) -> Result<T, Failure> {
        tauri::async_runtime::block_on(self.settled())
    }
}

pub(in crate::remote_runner) struct UploadFeed {
    chunks: mpsc::Sender<Bytes>,
    ended: watch::Receiver<()>,
}

impl UploadFeed {
    pub(in crate::remote_runner) fn send(&mut self, chunk: Vec<u8>) -> bool {
        let Self { chunks, ended } = self;
        tauri::async_runtime::block_on(async {
            tokio::select! {
                biased;
                _ = ended.changed() => false,
                sent = chunks.send(Bytes::from(chunk)) => sent.is_ok(),
            }
        })
    }
}

pub(super) fn upload<'a>(
    session: &'a Session,
    access: Access,
    head: UploadHead,
    policy: TransferPolicy,
    deadline: Instant,
    cancel: watch::Receiver<bool>,
) -> (UploadFeed, Transfer<'a, Reply>) {
    let (chunks, receiver) = mpsc::channel(BUFFERED_CHUNKS);
    let (alive, ended) = watch::channel(());
    let pulse = Arc::new(Pulse::default());
    let authority = access.authority.clone();
    let outbound = head.length;
    let body = Outbound {
        chunks: receiver,
        remaining: head.length,
        pulse: Arc::clone(&pulse),
    };
    let task = tauri::async_runtime::spawn(async move {
        let _alive = alive;
        let exchange = put(access, head, body, deadline, Arc::clone(&pulse));
        supervised(
            exchange,
            authority,
            Some(cancel),
            policy,
            deadline,
            pulse,
            outbound,
        )
        .await
    });
    let transfer = Transfer {
        session,
        exchange: Exchange(Some(task)),
    };
    (UploadFeed { chunks, ended }, transfer)
}

pub(in crate::remote_runner) struct DownloadFeed {
    chunks: mpsc::Receiver<Bytes>,
}

impl DownloadFeed {
    pub(in crate::remote_runner) fn next(&mut self) -> Option<Bytes> {
        tauri::async_runtime::block_on(self.chunks.recv())
    }
}

pub(super) fn download<'a>(
    session: &'a Session,
    access: Access,
    path: String,
    limit: u64,
    policy: TransferPolicy,
    deadline: Instant,
) -> (DownloadFeed, Transfer<'a, ()>) {
    let (sender, chunks) = mpsc::channel(BUFFERED_CHUNKS);
    let pulse = Arc::new(Pulse::default());
    let authority = access.authority.clone();
    let task = tauri::async_runtime::spawn(async move {
        let exchange = get(access, path, limit, deadline, sender, Arc::clone(&pulse));
        supervised(exchange, authority, None, policy, deadline, pulse, 0).await
    });
    let transfer = Transfer {
        session,
        exchange: Exchange(Some(task)),
    };
    (DownloadFeed { chunks }, transfer)
}

#[cfg(all(test, unix))]
#[path = "tunnel_transfer_tests.rs"]
mod tests;
