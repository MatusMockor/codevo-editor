#![cfg_attr(test, allow(dead_code))] // Internal skeleton awaiting private watch-launch composition.

use super::watch_controller::{
    WatchReconnectController, WatchReconnectEffect, WatchReconnectFailure, WatchReconnectTerminal,
    WatchTargetConnector, WatchTargetPublisher, WatchTargetReplay,
};
use super::watch_generation::{InspectorEndpointFingerprint, TargetGeneration, WatchInstant};
use super::SpawnedNodeInspector;
use crate::debug_inspector_discovery::{
    InspectorEndpointFeed, InspectorEndpointFeedCancellation, InspectorEndpointFeedError,
};
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(25);
const TERMINATE_GRACE: Duration = Duration::from_millis(500);
const DISCONNECT_FEED_CAPACITY: usize = 16;

type SupervisorOwnerJob = Box<dyn FnOnce() + Send>;

fn spawn_supervisor_owner(job: SupervisorOwnerJob) -> io::Result<JoinHandle<()>> {
    spawn_supervisor_owner_with(job, |job| {
        thread::Builder::new()
            .name("native-node-watch-supervisor".to_string())
            .spawn(job)
    })
}

fn spawn_supervisor_owner_with(
    job: SupervisorOwnerJob,
    spawn: impl FnOnce(SupervisorOwnerJob) -> io::Result<JoinHandle<()>>,
) -> io::Result<JoinHandle<()>> {
    spawn(job)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WatchSupervisorTermination {
    Cancelled,
    SupervisorExited,
    ReconnectFailed(WatchReconnectFailure),
    Panicked,
}

/// Redacted logical result for one internal watch owner.
///
/// The closed enums deliberately carry no endpoint, workspace path or raw
/// transport message. `exit_code` remains available independently because a
/// reconnect failure and process-group teardown can both be relevant.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WatchSupervisorOutcome {
    termination: WatchSupervisorTermination,
    exit_code: Option<i32>,
}

impl WatchSupervisorOutcome {
    pub(crate) fn termination(self) -> WatchSupervisorTermination {
        self.termination
    }

    pub(crate) fn exit_code(self) -> Option<i32> {
        self.exit_code
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WatchTargetDisconnect {
    generation: TargetGeneration,
    endpoint: InspectorEndpointFingerprint,
}

#[derive(Clone)]
pub(crate) struct WatchTargetDisconnectPublisher {
    sender: SyncSender<WatchTargetDisconnect>,
    overflowed: Arc<AtomicBool>,
}

pub(crate) struct WatchTargetDisconnectFeed {
    receiver: Receiver<WatchTargetDisconnect>,
    overflowed: Arc<AtomicBool>,
}

#[cfg(test)]
impl WatchTargetDisconnectFeed {
    pub(crate) fn event_count_for_test(&self) -> usize {
        let mut count = 0;
        while self.receiver.try_recv().is_ok() {
            count += 1;
        }
        count
    }
}

pub(crate) fn watch_target_disconnect_feed(
) -> (WatchTargetDisconnectPublisher, WatchTargetDisconnectFeed) {
    let (sender, receiver) = mpsc::sync_channel(DISCONNECT_FEED_CAPACITY);
    let overflowed = Arc::new(AtomicBool::new(false));
    (
        WatchTargetDisconnectPublisher {
            sender,
            overflowed: Arc::clone(&overflowed),
        },
        WatchTargetDisconnectFeed {
            receiver,
            overflowed,
        },
    )
}

impl WatchTargetDisconnectPublisher {
    pub(crate) fn publish(
        &self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
    ) {
        if self.overflowed.load(Ordering::Acquire) {
            return;
        }
        let event = WatchTargetDisconnect {
            generation,
            endpoint,
        };
        match self.sender.try_send(event) {
            Ok(()) | Err(TrySendError::Disconnected(_)) => {}
            Err(TrySendError::Full(_)) => self.overflowed.store(true, Ordering::Release),
        }
    }
}

pub(crate) trait WatchSupervisorController {
    fn seed_initial(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect;
    fn observe_endpoint(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect;
    fn target_closed(
        &mut self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect;
    fn deadline_elapsed(&mut self, now: WatchInstant) -> WatchReconnectEffect;
    fn supervisor_exited(&mut self) -> WatchReconnectEffect;
    fn cancel(&mut self, now: WatchInstant) -> WatchReconnectEffect;
}

impl<Connector, Replay, Publisher> WatchSupervisorController
    for WatchReconnectController<Connector, Replay, Publisher>
where
    Connector: WatchTargetConnector,
    Replay: WatchTargetReplay<Connector::Target>,
    Publisher: WatchTargetPublisher<Connector::Target>,
{
    fn seed_initial(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.seed_initial(endpoint, now)
    }

    fn observe_endpoint(
        &mut self,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.observe_endpoint(endpoint, now)
    }

    fn target_closed(
        &mut self,
        generation: TargetGeneration,
        endpoint: InspectorEndpointFingerprint,
        now: WatchInstant,
    ) -> WatchReconnectEffect {
        self.target_closed(generation, endpoint, now)
    }

    fn deadline_elapsed(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        self.deadline_elapsed(now)
    }

    fn supervisor_exited(&mut self) -> WatchReconnectEffect {
        self.supervisor_exited()
    }

    fn cancel(&mut self, now: WatchInstant) -> WatchReconnectEffect {
        self.cancel(now)
    }
}

trait WatchEndpointSource {
    fn receive(
        &self,
        timeout: Duration,
    ) -> Result<InspectorEndpointFingerprint, InspectorEndpointFeedError>;
    fn cancel(&self);
}

impl WatchEndpointSource for InspectorEndpointFeed {
    fn receive(
        &self,
        timeout: Duration,
    ) -> Result<InspectorEndpointFingerprint, InspectorEndpointFeedError> {
        self.receive_fingerprint(timeout)
    }

    fn cancel(&self) {
        self.cancel();
    }
}

enum DisconnectPoll {
    Event(WatchTargetDisconnect),
    Empty,
    Failed,
}

trait WatchDisconnectSource {
    fn poll(&self) -> DisconnectPoll;
}

impl WatchDisconnectSource for WatchTargetDisconnectFeed {
    fn poll(&self) -> DisconnectPoll {
        if self.overflowed.load(Ordering::Acquire) {
            return DisconnectPoll::Failed;
        }
        match self.receiver.try_recv() {
            Ok(event) => DisconnectPoll::Event(event),
            Err(TryRecvError::Empty) => DisconnectPoll::Empty,
            Err(TryRecvError::Disconnected) => DisconnectPoll::Failed,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SupervisorPoll {
    Running,
    Exited(Option<i32>),
    Failed,
}

trait WatchSupervisorProcess {
    fn poll(&mut self) -> SupervisorPoll;
    fn terminate_group(&mut self);
    fn kill_group(&mut self);
    fn wait(&mut self) -> Option<i32>;
}

struct SpawnedWatchProcess {
    child: Child,
    process_group_id: Option<i32>,
    reaped: bool,
}

impl SpawnedWatchProcess {
    fn new(child: Child) -> Self {
        Self {
            process_group_id: i32::try_from(child.id()).ok(),
            child,
            reaped: false,
        }
    }
}

impl WatchSupervisorProcess for SpawnedWatchProcess {
    fn poll(&mut self) -> SupervisorPoll {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                self.reaped = true;
                SupervisorPoll::Exited(status.code())
            }
            Ok(None) => SupervisorPoll::Running,
            Err(_) => SupervisorPoll::Failed,
        }
    }

    fn terminate_group(&mut self) {
        self.signal_group(libc::SIGTERM);
    }

    fn kill_group(&mut self) {
        self.signal_group(libc::SIGKILL);
        let _ = self.child.kill();
    }

    fn wait(&mut self) -> Option<i32> {
        match self.child.wait() {
            Ok(status) => {
                self.reaped = true;
                status.code()
            }
            Err(_) => None,
        }
    }
}

impl SpawnedWatchProcess {
    #[cfg(unix)]
    fn signal_group(&self, signal: i32) {
        if let Some(process_group_id) = self.process_group_id {
            unsafe {
                libc::kill(-process_group_id, signal);
            }
        }
    }

    #[cfg(not(unix))]
    fn signal_group(&self, _signal: i32) {}
}

impl Drop for SpawnedWatchProcess {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        self.kill_group();
        let _ = self.wait();
    }
}

trait WatchSupervisorClock {
    fn now(&self) -> WatchInstant;
    fn sleep(&mut self, duration: Duration);
}

struct MonotonicWatchClock {
    started_at: Instant,
}

impl MonotonicWatchClock {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

impl WatchSupervisorClock for MonotonicWatchClock {
    fn now(&self) -> WatchInstant {
        let millis = self.started_at.elapsed().as_millis();
        WatchInstant::from_ticks(u64::try_from(millis).unwrap_or(u64::MAX))
    }

    fn sleep(&mut self, duration: Duration) {
        thread::sleep(duration);
    }
}

pub(crate) struct WatchSupervisorHandle {
    cancellation: WatchSupervisorCancellation,
    endpoint_cancellation: InspectorEndpointFeedCancellation,
    worker: Option<JoinHandle<()>>,
}

#[derive(Clone, Default)]
pub(crate) struct WatchSupervisorCancellation {
    revoked: Arc<AtomicBool>,
}

impl WatchSupervisorCancellation {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
    }

    pub(super) fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }
}

impl WatchSupervisorHandle {
    pub(crate) fn stop(mut self) {
        self.revoke_and_wait();
    }

    fn revoke_and_wait(&mut self) {
        self.cancellation.revoke();
        self.endpoint_cancellation.cancel();
        if let Some(worker) = self.worker.take() {
            join_owner_worker(worker);
        }
    }
}

fn join_owner_worker(worker: JoinHandle<()>) {
    if worker.thread().id() == thread::current().id() {
        return;
    }
    let _ = worker.join();
}

impl Drop for WatchSupervisorHandle {
    fn drop(&mut self) {
        self.revoke_and_wait();
    }
}

impl SpawnedNodeInspector {
    pub(crate) fn spawn_watch_supervisor<Controller>(
        self,
        controller: Controller,
        disconnects: WatchTargetDisconnectFeed,
        cancellation: WatchSupervisorCancellation,
        finish: Box<dyn FnOnce(WatchSupervisorOutcome) + Send>,
    ) -> Result<WatchSupervisorHandle, String>
    where
        Controller: WatchSupervisorController + Send + 'static,
    {
        let initial_endpoint = self
            .initial_watch_endpoint()
            .map_err(|_| "The Node.js watch inspector endpoint is invalid.".to_string())?;
        self.spawn_watch_supervisor_with_initial_endpoint(
            initial_endpoint,
            controller,
            disconnects,
            cancellation,
            finish,
        )
    }

    pub(crate) fn spawn_watch_supervisor_with_initial_endpoint<Controller>(
        self,
        initial_endpoint: InspectorEndpointFingerprint,
        controller: Controller,
        disconnects: WatchTargetDisconnectFeed,
        cancellation: WatchSupervisorCancellation,
        finish: Box<dyn FnOnce(WatchSupervisorOutcome) + Send>,
    ) -> Result<WatchSupervisorHandle, String>
    where
        Controller: WatchSupervisorController + Send + 'static,
    {
        let Self {
            child, endpoints, ..
        } = self;
        let endpoint_cancellation = endpoints.cancellation_handle();
        let worker_cancellation = cancellation.clone();
        // Construct the fail-safe process owner before thread creation. If
        // Builder::spawn fails, dropping its closure drops this owner and
        // synchronously kills/reaps the complete process group.
        let process = SpawnedWatchProcess::new(child);
        let worker = spawn_supervisor_owner(Box::new(move || {
            let mut process = process;
            let mut clock = MonotonicWatchClock::new();
            run_watch_supervisor_and_finish(
                controller,
                endpoints,
                disconnects,
                &mut process,
                &mut clock,
                worker_cancellation.revoked.as_ref(),
                initial_endpoint,
                finish,
            );
        }))
        .map_err(|error| format!("Unable to start Node watch supervisor owner: {error}"))?;
        Ok(WatchSupervisorHandle {
            cancellation,
            endpoint_cancellation,
            worker: Some(worker),
        })
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "keeps the owned lifecycle inputs explicit and independently fakeable"
)]
fn run_watch_supervisor_and_finish<Controller, Endpoints, Disconnects, Process, Clock, Finish>(
    controller: Controller,
    endpoints: Endpoints,
    disconnects: Disconnects,
    process: &mut Process,
    clock: &mut Clock,
    cancelled: &AtomicBool,
    initial_endpoint: InspectorEndpointFingerprint,
    finish: Finish,
) where
    Controller: WatchSupervisorController,
    Endpoints: WatchEndpointSource,
    Disconnects: WatchDisconnectSource,
    Process: WatchSupervisorProcess,
    Clock: WatchSupervisorClock,
    Finish: FnOnce(WatchSupervisorOutcome),
{
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        run_watch_supervisor(
            controller,
            endpoints,
            disconnects,
            process,
            clock,
            cancelled,
            initial_endpoint,
        )
    }))
    .unwrap_or_else(|_| WatchSupervisorOutcome {
        termination: WatchSupervisorTermination::Panicked,
        exit_code: terminate_and_reap(process, clock),
    });
    finish(outcome);
}

fn run_watch_supervisor<Controller, Endpoints, Disconnects, Process, Clock>(
    mut controller: Controller,
    endpoints: Endpoints,
    disconnects: Disconnects,
    process: &mut Process,
    clock: &mut Clock,
    cancelled: &AtomicBool,
    initial_endpoint: InspectorEndpointFingerprint,
) -> WatchSupervisorOutcome
where
    Controller: WatchSupervisorController,
    Endpoints: WatchEndpointSource,
    Disconnects: WatchDisconnectSource,
    Process: WatchSupervisorProcess,
    Clock: WatchSupervisorClock,
{
    if let Some(terminal) =
        terminal_from_effect(controller.seed_initial(initial_endpoint, clock.now()))
    {
        endpoints.cancel();
        return reconnect_outcome(terminal, terminate_and_reap(process, clock));
    }

    loop {
        let now = clock.now();
        let mut natural_exit = None;
        let effect = if cancelled.load(Ordering::Acquire) {
            controller.cancel(now)
        } else {
            match process.poll() {
                SupervisorPoll::Exited(code) => {
                    natural_exit = Some(code);
                    controller.supervisor_exited()
                }
                SupervisorPoll::Failed => controller.supervisor_exited(),
                SupervisorPoll::Running => match disconnects.poll() {
                    DisconnectPoll::Event(event) => {
                        controller.target_closed(event.generation, event.endpoint, now)
                    }
                    DisconnectPoll::Failed => controller.supervisor_exited(),
                    DisconnectPoll::Empty => match endpoints.receive(EVENT_POLL_INTERVAL) {
                        Ok(endpoint) => controller.observe_endpoint(endpoint, clock.now()),
                        Err(InspectorEndpointFeedError::Timeout) => {
                            controller.deadline_elapsed(clock.now())
                        }
                        Err(InspectorEndpointFeedError::Cancelled) => {
                            controller.cancel(clock.now())
                        }
                        Err(
                            InspectorEndpointFeedError::Disconnected
                            | InspectorEndpointFeedError::InvalidEndpoint
                            | InspectorEndpointFeedError::Overflow,
                        ) => controller.supervisor_exited(),
                    },
                },
            }
        };
        if let Some(terminal) = terminal_from_effect(effect) {
            endpoints.cancel();
            return match natural_exit {
                Some(exit_code) => WatchSupervisorOutcome {
                    termination: WatchSupervisorTermination::SupervisorExited,
                    exit_code,
                },
                None => reconnect_outcome(terminal, terminate_and_reap(process, clock)),
            };
        }
    }
}

fn terminal_from_effect(effect: WatchReconnectEffect) -> Option<WatchReconnectTerminal> {
    match effect {
        WatchReconnectEffect::Terminal(terminal) => Some(terminal),
        WatchReconnectEffect::Activated(_)
        | WatchReconnectEffect::AwaitingReplacement(_)
        | WatchReconnectEffect::Ignored => None,
    }
}

fn reconnect_outcome(
    terminal: WatchReconnectTerminal,
    exit_code: Option<i32>,
) -> WatchSupervisorOutcome {
    let termination = match terminal {
        WatchReconnectTerminal::Cancelled => WatchSupervisorTermination::Cancelled,
        WatchReconnectTerminal::Failed(failure) => {
            WatchSupervisorTermination::ReconnectFailed(failure)
        }
    };
    WatchSupervisorOutcome {
        termination,
        exit_code,
    }
}

fn terminate_and_reap<Process, Clock>(process: &mut Process, clock: &mut Clock) -> Option<i32>
where
    Process: WatchSupervisorProcess,
    Clock: WatchSupervisorClock,
{
    if let SupervisorPoll::Exited(code) = process.poll() {
        return code;
    }
    process.terminate_group();
    let deadline = clock
        .now()
        .checked_add(u64::try_from(TERMINATE_GRACE.as_millis()).unwrap_or(u64::MAX));
    while deadline.is_some_and(|deadline| clock.now() < deadline) {
        match process.poll() {
            SupervisorPoll::Exited(code) => return code,
            SupervisorPoll::Running | SupervisorPoll::Failed => {
                clock.sleep(EVENT_POLL_INTERVAL);
            }
        }
    }
    process.kill_group();
    process.wait()
}

#[cfg(test)]
#[path = "debug_node_watch_supervisor_tests.rs"]
mod tests;
