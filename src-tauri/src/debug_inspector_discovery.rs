use crate::debug_adapter::{DebugEventEmitter, DebugEventPayload, DebugOutputStream};
use crate::debug_node_process::watch_generation::InspectorEndpointFingerprint;
use regex::Regex;
use std::io::{self, BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) const INSPECTOR_AMBIGUITY_WINDOW: Duration = Duration::from_millis(200);
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const MAX_OUTPUT_LINE_BYTES: usize = 64 * 1024;
const MAX_DISCOVERY_OUTPUT_BYTES: u64 = 1024 * 1024;
const ENDPOINT_FEED_CAPACITY: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum InspectorDiscoveryError {
    Ambiguous,
    Disconnected,
    Stale,
    Timeout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum InspectorEndpointFeedError {
    Cancelled,
    Disconnected,
    InvalidEndpoint,
    Overflow,
    Timeout,
}

#[derive(Clone)]
pub(crate) struct InspectorEndpointPublisher {
    sender: SyncSender<String>,
    overflowed: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

pub(crate) struct InspectorEndpointFeed {
    receiver: Receiver<String>,
    overflowed: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

pub(crate) struct InspectorEndpointScanBudget {
    observed_bytes: AtomicU64,
    startup_complete: AtomicBool,
}

#[derive(Clone)]
pub(crate) struct InspectorEndpointFeedCancellation {
    cancelled: Arc<AtomicBool>,
}

impl InspectorEndpointScanBudget {
    pub(crate) fn new() -> Self {
        Self {
            observed_bytes: AtomicU64::new(0),
            startup_complete: AtomicBool::new(false),
        }
    }

    pub(crate) fn complete_startup(&self) {
        self.startup_complete.store(true, Ordering::Release);
    }
}

pub(crate) fn inspector_endpoint_feed() -> (InspectorEndpointPublisher, InspectorEndpointFeed) {
    let (sender, receiver) = mpsc::sync_channel(ENDPOINT_FEED_CAPACITY);
    let overflowed = Arc::new(AtomicBool::new(false));
    let cancelled = Arc::new(AtomicBool::new(false));
    (
        InspectorEndpointPublisher {
            sender,
            overflowed: Arc::clone(&overflowed),
            cancelled: Arc::clone(&cancelled),
        },
        InspectorEndpointFeed {
            receiver,
            overflowed,
            cancelled,
        },
    )
}

impl InspectorEndpointPublisher {
    fn publish(&self, endpoint: String) {
        if self.cancelled.load(Ordering::Acquire) || self.overflowed.load(Ordering::Acquire) {
            return;
        }
        match self.sender.try_send(endpoint) {
            Ok(()) | Err(TrySendError::Disconnected(_)) => {}
            Err(TrySendError::Full(_)) => {
                self.overflowed.store(true, Ordering::Release);
            }
        }
    }

    fn mark_overflowed(&self) {
        self.overflowed.store(true, Ordering::Release);
    }
}

impl InspectorEndpointFeed {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn cancellation_handle(&self) -> InspectorEndpointFeedCancellation {
        InspectorEndpointFeedCancellation {
            cancelled: Arc::clone(&self.cancelled),
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn receive_fingerprint(
        &self,
        timeout: Duration,
    ) -> Result<InspectorEndpointFingerprint, InspectorEndpointFeedError> {
        let endpoint = self.receive_url(timeout)?;
        InspectorEndpointFingerprint::parse_ws_url(&endpoint)
            .map_err(|_| InspectorEndpointFeedError::InvalidEndpoint)
    }

    fn receive_url(&self, timeout: Duration) -> Result<String, InspectorEndpointFeedError> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.cancelled.load(Ordering::Acquire) {
                return Err(InspectorEndpointFeedError::Cancelled);
            }
            if self.overflowed.load(Ordering::Acquire) {
                return Err(InspectorEndpointFeedError::Overflow);
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(InspectorEndpointFeedError::Timeout);
            }
            match self
                .receiver
                .recv_timeout(deadline.saturating_duration_since(now).min(POLL_INTERVAL))
            {
                Ok(endpoint) => {
                    if self.overflowed.load(Ordering::Acquire) {
                        return Err(InspectorEndpointFeedError::Overflow);
                    }
                    return Ok(endpoint);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(InspectorEndpointFeedError::Disconnected)
                }
            }
        }
    }
}

impl InspectorEndpointFeedCancellation {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

pub(crate) fn spawn_output_pump<R: Read + Send + 'static>(
    reader: R,
    stream: DebugOutputStream,
    emitter: DebugEventEmitter,
    ws_url_sender: Option<(InspectorEndpointPublisher, Arc<InspectorEndpointScanBudget>)>,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> std::io::Result<thread::JoinHandle<()>> {
    spawn_output_pump_with(
        reader,
        stream,
        emitter,
        ws_url_sender,
        startup_is_current,
        |job| {
            thread::Builder::new()
                .name("node-inspector-output-pump".to_string())
                .spawn(job)
        },
    )
}

type OutputPumpJob = Box<dyn FnOnce() + Send>;

fn spawn_output_pump_with<R: Read + Send + 'static>(
    reader: R,
    stream: DebugOutputStream,
    emitter: DebugEventEmitter,
    ws_url_sender: Option<(InspectorEndpointPublisher, Arc<InspectorEndpointScanBudget>)>,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
    spawn: impl FnOnce(OutputPumpJob) -> std::io::Result<thread::JoinHandle<()>>,
) -> std::io::Result<thread::JoinHandle<()>> {
    let job = Box::new(move || {
        let mut reader = BufReader::new(reader);
        let mut line = Vec::with_capacity(1024);
        loop {
            if !startup_is_current() {
                break;
            }
            let Ok(Some((truncated, consumed_bytes))) = read_bounded_line(&mut reader, &mut line)
            else {
                break;
            };
            let mut text = String::from_utf8_lossy(&line).to_string();
            if truncated {
                text.push_str("…<truncated>");
            }
            if let Some((sender, observed_bytes)) = ws_url_sender.as_ref() {
                publish_discovered_endpoint(&text, consumed_bytes, sender, observed_bytes);
            }
            let text = redact_inspector_url(&text);
            if !text.is_empty() {
                emitter.emit(DebugEventPayload::Output { stream, text });
            }
        }
    });
    spawn_output_pump_job_with(job, spawn)
}

fn spawn_output_pump_job_with(
    job: OutputPumpJob,
    spawn: impl FnOnce(OutputPumpJob) -> std::io::Result<thread::JoinHandle<()>>,
) -> std::io::Result<thread::JoinHandle<()>> {
    spawn(job)
}

fn publish_discovered_endpoint(
    text: &str,
    consumed_bytes: u64,
    sender: &InspectorEndpointPublisher,
    budget: &InspectorEndpointScanBudget,
) {
    if budget.startup_complete.load(Ordering::Acquire) {
        if let Some(url) = parse_debugger_ws_url(text) {
            sender.publish(url);
        }
        return;
    }
    let previous = budget
        .observed_bytes
        .fetch_add(consumed_bytes, Ordering::Relaxed);
    if previous.saturating_add(consumed_bytes) > MAX_DISCOVERY_OUTPUT_BYTES {
        sender.mark_overflowed();
    } else if let Some(url) = parse_debugger_ws_url(text) {
        sender.publish(url);
    }
}

pub(crate) fn discover_inspector_ws_url(
    feed: &InspectorEndpointFeed,
    timeout: Duration,
    is_current: &(dyn Fn() -> bool + Send + Sync),
) -> Result<String, InspectorDiscoveryError> {
    let deadline = Instant::now() + timeout;
    let mut endpoint: Option<String> = None;
    let mut settle_deadline: Option<Instant> = None;
    loop {
        if !is_current() {
            return Err(InspectorDiscoveryError::Stale);
        }
        let now = Instant::now();
        if settle_deadline.is_some_and(|settle| now >= settle) {
            return endpoint.ok_or(InspectorDiscoveryError::Disconnected);
        }
        if now >= deadline {
            return Err(InspectorDiscoveryError::Timeout);
        }
        let next_deadline = settle_deadline.map_or(deadline, |settle| settle.min(deadline));
        let wait = next_deadline
            .saturating_duration_since(now)
            .min(POLL_INTERVAL);
        match feed.receive_url(wait) {
            Ok(candidate) => match endpoint.as_ref() {
                Some(current) if current != &candidate => {
                    return Err(InspectorDiscoveryError::Ambiguous)
                }
                Some(_) => {}
                None => {
                    endpoint = Some(candidate);
                    settle_deadline = Some(Instant::now() + INSPECTOR_AMBIGUITY_WINDOW);
                }
            },
            Err(InspectorEndpointFeedError::Timeout) => {}
            Err(InspectorEndpointFeedError::Disconnected) => {
                if !is_current() {
                    return Err(InspectorDiscoveryError::Stale);
                }
                return endpoint.ok_or(InspectorDiscoveryError::Disconnected);
            }
            Err(InspectorEndpointFeedError::Cancelled) => {
                return Err(InspectorDiscoveryError::Stale)
            }
            Err(InspectorEndpointFeedError::Overflow)
            | Err(InspectorEndpointFeedError::InvalidEndpoint) => {
                return Err(InspectorDiscoveryError::Ambiguous)
            }
        }
    }
}

pub(crate) fn ensure_no_additional_inspector_endpoint(
    feed: &InspectorEndpointFeed,
    expected: &str,
    window: Duration,
    is_current: &(dyn Fn() -> bool + Send + Sync),
) -> Result<(), InspectorDiscoveryError> {
    let deadline = Instant::now() + window;
    loop {
        if !is_current() {
            return Err(InspectorDiscoveryError::Stale);
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok(());
        }
        match feed.receive_url(deadline.saturating_duration_since(now).min(POLL_INTERVAL)) {
            Ok(candidate) if candidate != expected => {
                return Err(InspectorDiscoveryError::Ambiguous)
            }
            Ok(_) | Err(InspectorEndpointFeedError::Timeout) => {}
            Err(InspectorEndpointFeedError::Disconnected) => return Ok(()),
            Err(InspectorEndpointFeedError::Cancelled) => {
                return Err(InspectorDiscoveryError::Stale)
            }
            Err(InspectorEndpointFeedError::Overflow)
            | Err(InspectorEndpointFeedError::InvalidEndpoint) => {
                return Err(InspectorDiscoveryError::Ambiguous)
            }
        }
    }
}

pub(crate) fn redact_inspector_url(text: &str) -> String {
    ws_url_token_regex()
        .replace_all(text, "${1}/<redacted>")
        .to_string()
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    output: &mut Vec<u8>,
) -> io::Result<Option<(bool, u64)>> {
    output.clear();
    let mut truncated = false;
    let mut consumed_bytes = 0_u64;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((consumed_bytes != 0).then_some((truncated, consumed_bytes)));
        }
        let consumed = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        let payload = &available[..consumed];
        consumed_bytes = consumed_bytes.saturating_add(payload.len() as u64);
        let remaining = MAX_OUTPUT_LINE_BYTES.saturating_sub(output.len());
        output.extend_from_slice(&payload[..payload.len().min(remaining)]);
        truncated |= payload.len() > remaining;
        let reached_newline = payload.last() == Some(&b'\n');
        reader.consume(consumed);
        if reached_newline {
            while matches!(output.last(), Some(b'\n' | b'\r')) {
                output.pop();
            }
            return Ok(Some((truncated, consumed_bytes)));
        }
    }
}

fn debugger_ws_url_regex() -> &'static Regex {
    static DEBUGGER_WS_URL: OnceLock<Regex> = OnceLock::new();
    DEBUGGER_WS_URL.get_or_init(|| {
        Regex::new(
            r"^Debugger listening on (ws://127\.0\.0\.1:([0-9]{1,5})/[A-Za-z0-9_-]{1,128})\s*$",
        )
        .expect("ws url regex")
    })
}

fn parse_debugger_ws_url(line: &str) -> Option<String> {
    let captures = debugger_ws_url_regex().captures(line)?;
    let port = captures.get(2)?.as_str().parse::<u16>().ok()?;
    (port != 0).then(|| captures[1].to_string())
}

fn ws_url_token_regex() -> &'static Regex {
    static WS_URL_TOKEN: OnceLock<Regex> = OnceLock::new();
    WS_URL_TOKEN.get_or_init(|| Regex::new(r"(ws://[^/\s]+)/\S+").expect("ws token regex"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_node_process::watch_generation::{
        WatchGenerationCoordinator, WatchGenerationEffect, WatchGenerationEvent,
        WatchGenerationPolicy, WatchInstant,
    };
    use std::io::BufReader;

    const UUID_A: &str = "11111111-1111-4111-8111-111111111111";
    const UUID_B: &str = "22222222-2222-4222-8222-222222222222";

    fn endpoint_url(port: u16, uuid: &str) -> String {
        format!("ws://127.0.0.1:{port}/{uuid}")
    }

    fn coordinator() -> WatchGenerationCoordinator {
        WatchGenerationCoordinator::new(WatchGenerationPolicy::new(10, 64).expect("valid policy"))
    }

    #[test]
    fn parses_only_bounded_loopback_debugger_urls() {
        let valid = "Debugger listening on ws://127.0.0.1:53219/child-endpoint";
        assert_eq!(
            parse_debugger_ws_url(valid),
            Some("ws://127.0.0.1:53219/child-endpoint".to_string())
        );
        for line in [
            "prefix Debugger listening on ws://127.0.0.1:4100/token",
            "Debugger listening on ws://0.0.0.0:4100/token",
            "Debugger listening on ws://127.0.0.1:0/token",
            "Debugger listening on ws://127.0.0.1:70000/token",
            "Debugger listening on ws://127.0.0.1:4100/token/path",
        ] {
            assert_eq!(parse_debugger_ws_url(line), None, "accepted {line}");
        }
    }

    #[test]
    fn discovers_one_wrapper_child_endpoint() {
        let (sender, feed) = inspector_endpoint_feed();
        sender.publish("ws://127.0.0.1:53219/child-endpoint".to_string());
        drop(sender);
        assert_eq!(
            discover_inspector_ws_url(&feed, Duration::from_secs(1), &|| true),
            Ok("ws://127.0.0.1:53219/child-endpoint".to_string())
        );
    }

    #[test]
    fn rejects_ambiguous_wrapper_child_endpoints() {
        let (sender, feed) = inspector_endpoint_feed();
        sender.publish("ws://127.0.0.1:41001/first".into());
        sender.publish("ws://127.0.0.1:41002/second".into());
        assert_eq!(
            discover_inspector_ws_url(&feed, Duration::from_secs(1), &|| true),
            Err(InspectorDiscoveryError::Ambiguous)
        );
    }

    #[test]
    fn discovery_timeout_fails_closed() {
        let (_sender, feed) = inspector_endpoint_feed();
        assert_eq!(
            discover_inspector_ws_url(&feed, Duration::from_millis(40), &|| true),
            Err(InspectorDiscoveryError::Timeout)
        );
    }

    #[test]
    fn stale_discovery_fails_closed() {
        let (_sender, feed) = inspector_endpoint_feed();
        assert_eq!(
            discover_inspector_ws_url(&feed, Duration::from_secs(1), &|| false),
            Err(InspectorDiscoveryError::Stale)
        );
    }

    #[test]
    fn late_wrapper_child_endpoint_fails_closed() {
        let (sender, feed) = inspector_endpoint_feed();
        sender.publish("ws://127.0.0.1:41002/child".into());
        assert_eq!(
            ensure_no_additional_inspector_endpoint(
                &feed,
                "ws://127.0.0.1:41001/wrapper",
                Duration::from_secs(1),
                &|| true,
            ),
            Err(InspectorDiscoveryError::Ambiguous)
        );
    }

    #[test]
    fn output_reader_caps_lines() {
        let source = format!("{}\nnext\n", "x".repeat(MAX_OUTPUT_LINE_BYTES + 100));
        let mut reader = BufReader::new(source.as_bytes());
        let mut output = Vec::new();
        assert_eq!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            Some((true, (MAX_OUTPUT_LINE_BYTES + 101) as u64))
        );
        assert_eq!(output.len(), MAX_OUTPUT_LINE_BYTES);
        assert_eq!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            Some((false, 5))
        );
        assert_eq!(output, b"next");
    }

    #[test]
    fn injected_output_pump_spawn_failure_is_returned() {
        let error = spawn_output_pump_job_with(Box::new(|| {}), |_| {
            Err(io::Error::new(
                io::ErrorKind::ResourceBusy,
                "injected output-pump spawn failure",
            ))
        })
        .expect_err("spawn failure should be returned");

        assert_eq!(error.kind(), io::ErrorKind::ResourceBusy);
        assert_eq!(error.to_string(), "injected output-pump spawn failure");
    }

    #[test]
    fn redacts_inspector_tokens() {
        assert_eq!(
            redact_inspector_url("Debugger listening on ws://127.0.0.1:4100/secret"),
            "Debugger listening on ws://127.0.0.1:4100/<redacted>"
        );
    }

    #[test]
    fn feed_delivers_duplicate_current_endpoint_without_advancing_generation() {
        let (sender, feed) = inspector_endpoint_feed();
        let url = endpoint_url(41001, UUID_A);
        sender.publish(url.clone());
        sender.publish(url);
        let mut coordinator = coordinator();
        let first = feed
            .receive_fingerprint(Duration::from_millis(20))
            .expect("first endpoint");
        assert!(matches!(
            coordinator.handle(
                WatchGenerationEvent::EndpointObserved(first),
                WatchInstant::from_ticks(1),
            ),
            WatchGenerationEffect::Activated(generation) if generation.get() == 1
        ));
        let duplicate = feed
            .receive_fingerprint(Duration::from_millis(20))
            .expect("duplicate endpoint");
        assert!(matches!(
            coordinator.handle(
                WatchGenerationEvent::EndpointObserved(duplicate),
                WatchInstant::from_ticks(2),
            ),
            WatchGenerationEffect::IgnoredCurrentEndpoint(_)
        ));
    }

    #[test]
    fn feed_requires_matching_disconnect_before_distinct_endpoint_handoff() {
        let (sender, feed) = inspector_endpoint_feed();
        sender.publish(endpoint_url(41001, UUID_A));
        sender.publish(endpoint_url(41002, UUID_B));
        let first = feed
            .receive_fingerprint(Duration::from_millis(20))
            .expect("first endpoint");
        let second = feed
            .receive_fingerprint(Duration::from_millis(20))
            .expect("replacement endpoint");

        let mut premature = coordinator();
        assert!(matches!(
            premature.handle(
                WatchGenerationEvent::EndpointObserved(first.clone()),
                WatchInstant::from_ticks(1),
            ),
            WatchGenerationEffect::Activated(_)
        ));
        assert!(matches!(
            premature.handle(
                WatchGenerationEvent::EndpointObserved(second.clone()),
                WatchInstant::from_ticks(2),
            ),
            WatchGenerationEffect::Terminal(_)
        ));

        let mut handed_off = coordinator();
        let generation = match handed_off.handle(
            WatchGenerationEvent::EndpointObserved(first.clone()),
            WatchInstant::from_ticks(1),
        ) {
            WatchGenerationEffect::Activated(generation) => generation,
            effect => panic!("unexpected activation effect: {effect:?}"),
        };
        assert!(matches!(
            handed_off.handle(
                WatchGenerationEvent::TargetClosed {
                    generation,
                    endpoint: first,
                },
                WatchInstant::from_ticks(2),
            ),
            WatchGenerationEffect::AwaitingReplacement { .. }
        ));
        assert!(matches!(
            handed_off.handle(
                WatchGenerationEvent::EndpointObserved(second),
                WatchInstant::from_ticks(3),
            ),
            WatchGenerationEffect::Activated(next) if next.get() == 2
        ));
    }

    #[test]
    fn feed_fails_closed_when_endpoint_capacity_overflows() {
        let (sender, feed) = inspector_endpoint_feed();
        for port in 40_000..40_000 + ENDPOINT_FEED_CAPACITY as u16 + 1 {
            sender.publish(endpoint_url(port, UUID_A));
        }
        assert_eq!(
            feed.receive_fingerprint(Duration::from_millis(20)),
            Err(InspectorEndpointFeedError::Overflow)
        );
    }

    #[test]
    fn feed_cancel_unblocks_receiver_and_discards_late_endpoint() {
        let (sender, feed) = inspector_endpoint_feed();
        let cancellation = feed.cancellation_handle();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let reader_barrier = Arc::clone(&barrier);
        let reader = thread::spawn(move || {
            reader_barrier.wait();
            feed.receive_fingerprint(Duration::from_secs(1))
        });
        barrier.wait();
        cancellation.cancel();
        sender.publish(endpoint_url(41001, UUID_A));
        assert_eq!(
            reader.join().expect("reader thread"),
            Err(InspectorEndpointFeedError::Cancelled)
        );
    }

    #[test]
    fn discovery_budget_counts_bytes_discarded_from_oversized_lines() {
        let source = format!("{}\n", "x".repeat(MAX_DISCOVERY_OUTPUT_BYTES as usize + 1));
        let mut reader = BufReader::new(source.as_bytes());
        let mut output = Vec::new();
        let (truncated, consumed_bytes) = read_bounded_line(&mut reader, &mut output)
            .expect("bounded read")
            .expect("line");
        assert!(truncated);
        assert_eq!(consumed_bytes, MAX_DISCOVERY_OUTPUT_BYTES + 2);

        let (sender, feed) = inspector_endpoint_feed();
        let budget = InspectorEndpointScanBudget::new();
        publish_discovered_endpoint(
            &String::from_utf8_lossy(&output),
            consumed_bytes,
            &sender,
            &budget,
        );
        assert_eq!(
            feed.receive_fingerprint(Duration::from_millis(20)),
            Err(InspectorEndpointFeedError::Overflow)
        );
    }

    #[test]
    fn completed_startup_discovers_endpoint_after_one_megabyte_of_ordinary_output() {
        let (sender, feed) = inspector_endpoint_feed();
        let budget = InspectorEndpointScanBudget::new();
        budget.complete_startup();
        publish_discovered_endpoint(
            "ordinary application output",
            MAX_DISCOVERY_OUTPUT_BYTES + 1,
            &sender,
            &budget,
        );
        let endpoint_line = format!("Debugger listening on {}", endpoint_url(41001, UUID_A));
        publish_discovered_endpoint(&endpoint_line, endpoint_line.len() as u64, &sender, &budget);
        assert_eq!(
            feed.receive_fingerprint(Duration::from_millis(20)),
            InspectorEndpointFingerprint::parse_ws_url(&endpoint_url(41001, UUID_A))
                .map_err(|_| InspectorEndpointFeedError::InvalidEndpoint)
        );
    }
}
