use super::{compile_time_config, error, tokens_equal};
use std::{
    cell::RefCell,
    sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SMOKE_MODE_ENV: &str = env!("CODEVO_PERF_CAPTURE_SMOKE");
static ACTIVATION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static WINDOW_LEASE_NONCE: AtomicU64 = AtomicU64::new(1);
const MAX_SAFE_TRANSITIONS: u64 = 9_007_199_254_740_991;
const MAIN_THREAD_DISPATCH_PENDING: u8 = 0;
const MAIN_THREAD_DISPATCH_RUNNING: u8 = 1;
const MAIN_THREAD_DISPATCH_CANCELLED: u8 = 2;
const MAIN_THREAD_DISPATCH_COMPLETE: u8 = 3;
const RESULT_DELIVERY_PENDING: u8 = 0;
const RESULT_DELIVERY_OFFERED: u8 = 1;
const RESULT_DELIVERY_ABANDONED: u8 = 2;

#[cfg(target_os = "macos")]
thread_local! {
    static NATIVE_WINDOW_LEASE: RefCell<Option<NativeWindowLease>> = const { RefCell::new(None) };
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PerfCaptureWindowSnapshot {
    lease_id: String,
    active: bool,
    hidden: bool,
    visible: bool,
    key: bool,
    minimized: bool,
    occluded: bool,
    occlusion_visible: bool,
    diagnostic_space_lease: bool,
    on_active_space: bool,
    window_stability_epoch: u64,
    app_activation_transitions: u64,
    occlusion_transitions: u64,
    key_transitions: u64,
    minimize_transitions: u64,
    transition_overflow: bool,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NativeWindowOriginal {
    hides_on_deactivate: bool,
    collection_behavior: usize,
    activation_policy: isize,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct WindowTransitionCounters {
    epoch: AtomicU64,
    app_activation: AtomicU64,
    occlusion: AtomicU64,
    key: AtomicU64,
    minimize: AtomicU64,
    overflow: AtomicBool,
}

#[cfg(target_os = "macos")]
struct NativeWindowLease {
    lease_id: String,
    window_pointer: usize,
    original: NativeWindowOriginal,
    activation_policy_lease: Option<isize>,
    diagnostic_policy_restored: bool,
    diagnostic_smoke: bool,
    counters: std::sync::Arc<WindowTransitionCounters>,
    _window: objc2::rc::Retained<objc2_app_kit::NSWindow>,
    notification_center: objc2::rc::Retained<objc2_foundation::NSNotificationCenter>,
    observers: Vec<
        objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>,
    >,
}

pub(super) async fn activate_window<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: Option<String>,
) -> Result<PerfCaptureWindowSnapshot, String> {
    authorize_activation(window.label(), &run_token)?;
    let diagnostic_smoke = diagnostic_smoke_enabled()?;
    let permit = claim_activation(&ACTIVATION_IN_FLIGHT)?;

    let (sender, receiver) = mpsc::sync_channel(1);
    let dispatch = std::sync::Arc::new(MainThreadLeaseDispatch::default());
    let callback_dispatch = std::sync::Arc::clone(&dispatch);
    let delivery = std::sync::Arc::new(MainThreadResultDelivery::default());
    let callback_delivery = std::sync::Arc::clone(&delivery);
    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            if !callback_dispatch.begin() {
                drop(permit);
                return;
            }
            let acquired_new_lease = lease_id.is_none();
            let result =
                activate_native_window(&native_window, diagnostic_smoke, lease_id.as_deref());
            callback_dispatch.complete();
            let result_abandoned = !callback_delivery.offer();
            let delivery_failed = !result_abandoned && sender.send(result.clone()).is_err();
            if (result_abandoned || delivery_failed) && acquired_new_lease {
                if let Ok(snapshot) = result {
                    let _ = release_native_window_lease(
                        &native_window,
                        diagnostic_smoke,
                        &snapshot.lease_id,
                    );
                }
            }
            drop(permit);
        })
        .map_err(|_| error("Performance capture window activation is unavailable."))?;

    tauri::async_runtime::spawn_blocking(move || {
        receive_activation_result(
            receiver,
            dispatch,
            delivery,
            "Performance capture window activation timed out.",
            "Performance capture window activation failed.",
        )
    })
    .await
    .map_err(|_| error("Performance capture window activation failed."))??
}

fn receive_activation_result<T>(
    receiver: mpsc::Receiver<T>,
    dispatch: std::sync::Arc<MainThreadLeaseDispatch>,
    delivery: std::sync::Arc<MainThreadResultDelivery>,
    timeout_message: &'static str,
    failure_message: &'static str,
) -> Result<T, String> {
    receive_activation_result_with_timeout(
        receiver,
        dispatch,
        delivery,
        Duration::from_secs(1),
        timeout_message,
        failure_message,
    )
}

fn receive_activation_result_with_timeout<T>(
    receiver: mpsc::Receiver<T>,
    dispatch: std::sync::Arc<MainThreadLeaseDispatch>,
    delivery: std::sync::Arc<MainThreadResultDelivery>,
    timeout: Duration,
    timeout_message: &'static str,
    failure_message: &'static str,
) -> Result<T, String> {
    match receiver.recv_timeout(timeout) {
        Ok(result) => Ok(result),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            dispatch.cancel_before_begin();
            if delivery.abandon_before_offer() {
                Err(error(timeout_message))
            } else {
                receiver.recv().map_err(|_| error(failure_message))
            }
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(error(failure_message)),
    }
}

fn receive_main_thread_result<T>(
    receiver: mpsc::Receiver<T>,
    dispatch: std::sync::Arc<MainThreadLeaseDispatch>,
    timeout_message: &'static str,
    failure_message: &'static str,
) -> Result<T, String> {
    receive_main_thread_result_with_timeout(
        receiver,
        dispatch,
        Duration::from_secs(1),
        timeout_message,
        failure_message,
    )
}

fn receive_main_thread_result_with_timeout<T>(
    receiver: mpsc::Receiver<T>,
    dispatch: std::sync::Arc<MainThreadLeaseDispatch>,
    timeout: Duration,
    timeout_message: &'static str,
    failure_message: &'static str,
) -> Result<T, String> {
    match receiver.recv_timeout(timeout) {
        Ok(result) => Ok(result),
        Err(mpsc::RecvTimeoutError::Timeout) if dispatch.cancel_before_begin() => {
            Err(error(timeout_message))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => receiver.recv().map_err(|_| error(failure_message)),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(error(failure_message)),
    }
}

#[derive(Default)]
struct MainThreadLeaseDispatch(AtomicU8);

impl MainThreadLeaseDispatch {
    fn begin(&self) -> bool {
        self.0
            .compare_exchange(
                MAIN_THREAD_DISPATCH_PENDING,
                MAIN_THREAD_DISPATCH_RUNNING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn cancel_before_begin(&self) -> bool {
        self.0
            .compare_exchange(
                MAIN_THREAD_DISPATCH_PENDING,
                MAIN_THREAD_DISPATCH_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn complete(&self) {
        let _ = self.0.compare_exchange(
            MAIN_THREAD_DISPATCH_RUNNING,
            MAIN_THREAD_DISPATCH_COMPLETE,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }
}

#[derive(Default)]
struct MainThreadResultDelivery(AtomicU8);

impl MainThreadResultDelivery {
    fn offer(&self) -> bool {
        self.0
            .compare_exchange(
                RESULT_DELIVERY_PENDING,
                RESULT_DELIVERY_OFFERED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    fn abandon_before_offer(&self) -> bool {
        self.0
            .compare_exchange(
                RESULT_DELIVERY_PENDING,
                RESULT_DELIVERY_ABANDONED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

fn diagnostic_smoke_enabled() -> Result<bool, String> {
    parse_smoke_mode(SMOKE_MODE_ENV)
}

fn parse_smoke_mode(value: &str) -> Result<bool, String> {
    match value {
        "0" => Ok(false),
        "1" => Ok(true),
        _ => Err(error("Performance capture smoke mode is not configured.")),
    }
}

struct ActivationPermit<'a>(&'a AtomicBool);

impl Drop for ActivationPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn claim_activation(state: &AtomicBool) -> Result<ActivationPermit<'_>, String> {
    state
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ActivationPermit(state))
        .map_err(|_| error("Performance capture window activation is already in progress."))
}

fn authorize_activation(window_label: &str, candidate_token: &str) -> Result<(), String> {
    let config = compile_time_config()?;
    if window_label != "main"
        || !tokens_equal(candidate_token.as_bytes(), config.run_token.as_bytes())
    {
        return Err(error("Performance capture window activation was rejected."));
    }
    Ok(())
}

fn authorize_existing_window_lease(
    candidate_lease_id: Option<&str>,
    existing_lease_id: &str,
    candidate_window_pointer: usize,
    existing_window_pointer: usize,
    diagnostic_smoke: bool,
    existing_diagnostic_smoke: bool,
) -> Result<(), String> {
    if candidate_lease_id != Some(existing_lease_id)
        || candidate_window_pointer != existing_window_pointer
        || diagnostic_smoke != existing_diagnostic_smoke
    {
        return Err(error("Performance capture window lease was rejected."));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum WindowTransitionKind {
    AppActivation,
    Occlusion,
    Key,
    Minimize,
}

#[cfg(target_os = "macos")]
impl WindowTransitionCounters {
    fn record(&self, kind: WindowTransitionKind) {
        increment_transition(&self.epoch, &self.overflow);
        let counter = match kind {
            WindowTransitionKind::AppActivation => &self.app_activation,
            WindowTransitionKind::Occlusion => &self.occlusion,
            WindowTransitionKind::Key => &self.key,
            WindowTransitionKind::Minimize => &self.minimize,
        };
        increment_transition(counter, &self.overflow);
    }

    fn reset(&self) {
        self.epoch.store(0, Ordering::Release);
        self.app_activation.store(0, Ordering::Release);
        self.occlusion.store(0, Ordering::Release);
        self.key.store(0, Ordering::Release);
        self.minimize.store(0, Ordering::Release);
        self.overflow.store(false, Ordering::Release);
    }
}

#[cfg(target_os = "macos")]
fn increment_transition(counter: &AtomicU64, overflow: &AtomicBool) {
    if counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
            (value < MAX_SAFE_TRANSITIONS).then_some(value + 1)
        })
        .is_err()
    {
        overflow.store(true, Ordering::Release);
    }
}

#[cfg(target_os = "macos")]
fn next_window_lease_id() -> String {
    let nonce = WINDOW_LEASE_NONCE.fetch_add(1, Ordering::Relaxed);
    let clock = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{:016x}-{clock:032x}-{nonce:016x}", std::process::id())
}

#[cfg(target_os = "macos")]
fn register_transition_observer(
    center: &objc2_foundation::NSNotificationCenter,
    name: &objc2_foundation::NSNotificationName,
    object: &objc2::runtime::AnyObject,
    counters: &std::sync::Arc<WindowTransitionCounters>,
    kind: WindowTransitionKind,
) -> objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>> {
    use block2::RcBlock;
    use objc2_foundation::NSNotification;
    use std::ptr::NonNull;

    let counters = std::sync::Arc::clone(counters);
    let block: RcBlock<dyn Fn(NonNull<NSNotification>)> =
        RcBlock::new(move |_notification| counters.record(kind));
    unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(name), Some(object), None, &block)
    }
}

#[cfg(target_os = "macos")]
fn activate_native_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    diagnostic_smoke: bool,
    candidate_lease_id: Option<&str>,
) -> Result<PerfCaptureWindowSnapshot, String> {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationPolicy, NSApplicationDidBecomeActiveNotification,
        NSApplicationDidResignActiveNotification, NSWindow, NSWindowDidBecomeKeyNotification,
        NSWindowDidChangeOcclusionStateNotification, NSWindowDidDeminiaturizeNotification,
        NSWindowDidMiniaturizeNotification, NSWindowDidResignKeyNotification,
    };
    use objc2_foundation::NSNotificationCenter;

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| error("Performance capture window activation is unavailable."))?;
    let pointer = window
        .ns_window()
        .map_err(|_| error("Performance capture window activation is unavailable."))?;
    let native_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| error("Performance capture window activation is unavailable."))?;
    let application = NSApplication::sharedApplication(main_thread);

    let lease_id = NATIVE_WINDOW_LEASE.with(|slot| {
        let mut slot = slot
            .try_borrow_mut()
            .map_err(|_| error("Performance capture window lease is unavailable."))?;
        if let Some(lease) = slot.as_ref() {
            authorize_existing_window_lease(
                candidate_lease_id,
                &lease.lease_id,
                pointer as usize,
                lease.window_pointer,
                diagnostic_smoke,
                lease.diagnostic_smoke,
            )?;
            return Ok(lease.lease_id.clone());
        }
        if candidate_lease_id.is_some() {
            return Err(error("Performance capture window lease was rejected."));
        }

        let retained_window = unsafe { Retained::retain(pointer.cast::<NSWindow>()) }
            .ok_or_else(|| error("Performance capture window lease is unavailable."))?;
        let original = NativeWindowOriginal {
            hides_on_deactivate: native_window.hidesOnDeactivate(),
            collection_behavior: native_window.collectionBehavior().0,
            activation_policy: application.activationPolicy().0,
        };
        let original_activation_policy =
            NSApplicationActivationPolicy(original.activation_policy);
        let capture_activation_policy = capture_activation_policy(original_activation_policy);
        let activation_policy_lease = if capture_activation_policy != original_activation_policy {
            if !application.setActivationPolicy(capture_activation_policy)
                || application.activationPolicy() != capture_activation_policy
            {
                if application.activationPolicy() != original_activation_policy
                    && (!application.setActivationPolicy(original_activation_policy)
                        || application.activationPolicy() != original_activation_policy)
                {
                    return Err(error(
                        "Performance capture application activation policy rollback could not be confirmed.",
                    ));
                }
                return Err(error(
                    "Performance capture application activation policy is unavailable.",
                ));
            }
            Some(capture_activation_policy.0)
        } else {
            None
        };
        let counters = std::sync::Arc::new(WindowTransitionCounters::default());
        let notification_center = NSNotificationCenter::defaultCenter();
        let window_object: &objc2::runtime::AnyObject = native_window;
        let application_object: &objc2::runtime::AnyObject = &application;
        let observers = unsafe {
            vec![
                register_transition_observer(
                    &notification_center,
                    NSApplicationDidBecomeActiveNotification,
                    application_object,
                    &counters,
                    WindowTransitionKind::AppActivation,
                ),
                register_transition_observer(
                    &notification_center,
                    NSApplicationDidResignActiveNotification,
                    application_object,
                    &counters,
                    WindowTransitionKind::AppActivation,
                ),
                register_transition_observer(
                    &notification_center,
                    NSWindowDidChangeOcclusionStateNotification,
                    window_object,
                    &counters,
                    WindowTransitionKind::Occlusion,
                ),
                register_transition_observer(
                    &notification_center,
                    NSWindowDidBecomeKeyNotification,
                    window_object,
                    &counters,
                    WindowTransitionKind::Key,
                ),
                register_transition_observer(
                    &notification_center,
                    NSWindowDidResignKeyNotification,
                    window_object,
                    &counters,
                    WindowTransitionKind::Key,
                ),
                register_transition_observer(
                    &notification_center,
                    NSWindowDidMiniaturizeNotification,
                    window_object,
                    &counters,
                    WindowTransitionKind::Minimize,
                ),
                register_transition_observer(
                    &notification_center,
                    NSWindowDidDeminiaturizeNotification,
                    window_object,
                    &counters,
                    WindowTransitionKind::Minimize,
                ),
            ]
        };
        let lease_id = next_window_lease_id();
        *slot = Some(NativeWindowLease {
            lease_id: lease_id.clone(),
            window_pointer: pointer as usize,
            original,
            activation_policy_lease,
            diagnostic_policy_restored: !diagnostic_smoke,
            diagnostic_smoke,
            counters,
            _window: retained_window,
            notification_center,
            observers,
        });

        if diagnostic_smoke {
            native_window.setHidesOnDeactivate(false);
            native_window.setCollectionBehavior(diagnostic_collection_behavior(
                native_window.collectionBehavior(),
            ));
        }
        Ok(lease_id)
    })?;

    application.unhide(None);
    if native_window.isMiniaturized() {
        native_window.deminiaturize(None);
    }
    native_window.orderFrontRegardless();
    native_window.makeKeyAndOrderFront(None);
    activate_direct_spawned_application(&application);
    native_window.makeKeyAndOrderFront(None);

    NATIVE_WINDOW_LEASE.with(|slot| {
        let slot = slot
            .try_borrow()
            .map_err(|_| error("Performance capture window lease is unavailable."))?;
        let lease = slot
            .as_ref()
            .filter(|lease| lease.lease_id == lease_id)
            .ok_or_else(|| error("Performance capture window lease is unavailable."))?;
        Ok(native_window_snapshot(&application, native_window, lease))
    })
}

#[cfg(target_os = "macos")]
fn activate_direct_spawned_application(application: &objc2_app_kit::NSApplication) {
    if objc2::runtime::NSObjectProtocol::respondsToSelector(application, objc2::sel!(activate)) {
        application.activate();
    } else {
        activate_direct_spawned_application_legacy(application);
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn activate_direct_spawned_application_legacy(application: &objc2_app_kit::NSApplication) {
    application.activateIgnoringOtherApps(true);
}

#[cfg(target_os = "macos")]
fn capture_activation_policy(
    original: objc2_app_kit::NSApplicationActivationPolicy,
) -> objc2_app_kit::NSApplicationActivationPolicy {
    use objc2_app_kit::NSApplicationActivationPolicy;

    if original == NSApplicationActivationPolicy::Prohibited {
        NSApplicationActivationPolicy::Regular
    } else {
        original
    }
}

#[cfg(target_os = "macos")]
fn native_window_snapshot(
    application: &objc2_app_kit::NSApplication,
    native_window: &objc2_app_kit::NSWindow,
    lease: &NativeWindowLease,
) -> PerfCaptureWindowSnapshot {
    use objc2_app_kit::NSWindowOcclusionState;

    let occlusion_visible = native_window
        .occlusionState()
        .contains(NSWindowOcclusionState::Visible);
    let observed_behavior = native_window.collectionBehavior();
    let diagnostic_space_lease = diagnostic_space_policy_is_applied(
        lease.diagnostic_smoke,
        native_window.hidesOnDeactivate(),
        observed_behavior,
    );
    let on_active_space = native_window.isOnActiveSpace();

    PerfCaptureWindowSnapshot {
        lease_id: lease.lease_id.clone(),
        active: application.isActive(),
        hidden: application.isHidden(),
        visible: native_window.isVisible(),
        key: native_window.isKeyWindow(),
        minimized: native_window.isMiniaturized(),
        occluded: !occlusion_visible,
        occlusion_visible,
        diagnostic_space_lease,
        on_active_space,
        window_stability_epoch: lease.counters.epoch.load(Ordering::Acquire),
        app_activation_transitions: lease.counters.app_activation.load(Ordering::Acquire),
        occlusion_transitions: lease.counters.occlusion.load(Ordering::Acquire),
        key_transitions: lease.counters.key.load(Ordering::Acquire),
        minimize_transitions: lease.counters.minimize.load(Ordering::Acquire),
        transition_overflow: lease.counters.overflow.load(Ordering::Acquire),
    }
}

#[cfg(target_os = "macos")]
fn diagnostic_space_policy_is_applied(
    diagnostic_smoke: bool,
    hides_on_deactivate: bool,
    observed_behavior: objc2_app_kit::NSWindowCollectionBehavior,
) -> bool {
    use objc2_app_kit::NSWindowCollectionBehavior;

    diagnostic_smoke
        && !hides_on_deactivate
        && observed_behavior.contains(NSWindowCollectionBehavior::CanJoinAllSpaces)
        && observed_behavior.contains(NSWindowCollectionBehavior::FullScreenAuxiliary)
        && !observed_behavior.intersects(
            NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::FullScreenPrimary
                | NSWindowCollectionBehavior::FullScreenNone,
        )
}

#[cfg(target_os = "macos")]
fn diagnostic_collection_behavior(
    original: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior;

    let mut desired = original;
    desired.remove(NSWindowCollectionBehavior::MoveToActiveSpace);
    desired.insert(NSWindowCollectionBehavior::CanJoinAllSpaces);
    desired.remove(
        NSWindowCollectionBehavior::FullScreenPrimary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::FullScreenNone,
    );
    desired.insert(NSWindowCollectionBehavior::FullScreenAuxiliary);
    desired
}

#[derive(Clone, Copy)]
enum WindowLeaseReadOperation {
    Snapshot,
    ResetBaseline,
}

pub(super) async fn snapshot_window_lease<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    authorize_activation(window.label(), &run_token)?;
    read_window_lease(window, lease_id, WindowLeaseReadOperation::Snapshot).await
}

pub(super) async fn reset_window_lease_baseline<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    authorize_activation(window.label(), &run_token)?;
    read_window_lease(window, lease_id, WindowLeaseReadOperation::ResetBaseline).await
}

async fn read_window_lease<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    lease_id: String,
    operation: WindowLeaseReadOperation,
) -> Result<PerfCaptureWindowSnapshot, String> {
    let diagnostic_smoke = diagnostic_smoke_enabled()?;
    let permit = claim_activation(&ACTIVATION_IN_FLIGHT)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let dispatch = std::sync::Arc::new(MainThreadLeaseDispatch::default());
    let callback_dispatch = std::sync::Arc::clone(&dispatch);
    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            if !callback_dispatch.begin() {
                drop(permit);
                return;
            }
            let result =
                read_native_window_lease(&native_window, diagnostic_smoke, &lease_id, operation);
            callback_dispatch.complete();
            let _ = sender.send(result);
            drop(permit);
        })
        .map_err(|_| error("Performance capture window lease read is unavailable."))?;

    tauri::async_runtime::spawn_blocking(move || {
        receive_main_thread_result(
            receiver,
            dispatch,
            "Performance capture window lease read timed out.",
            "Performance capture window lease read failed.",
        )
    })
    .await
    .map_err(|_| error("Performance capture window lease read failed."))??
}

#[cfg(target_os = "macos")]
fn read_native_window_lease<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    diagnostic_smoke: bool,
    candidate_lease_id: &str,
    operation: WindowLeaseReadOperation,
) -> Result<PerfCaptureWindowSnapshot, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| error("Performance capture window lease read is unavailable."))?;
    let pointer = window
        .ns_window()
        .map_err(|_| error("Performance capture window lease read is unavailable."))?;
    let native_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| error("Performance capture window lease read is unavailable."))?;
    let application = NSApplication::sharedApplication(main_thread);

    NATIVE_WINDOW_LEASE.with(|slot| {
        let slot = slot
            .try_borrow()
            .map_err(|_| error("Performance capture window lease read is unavailable."))?;
        let lease = slot
            .as_ref()
            .filter(|lease| {
                lease.lease_id == candidate_lease_id
                    && lease.window_pointer == pointer as usize
                    && lease.diagnostic_smoke == diagnostic_smoke
            })
            .ok_or_else(|| error("Performance capture window lease read was rejected."))?;
        if matches!(operation, WindowLeaseReadOperation::ResetBaseline) {
            lease.counters.reset();
        }
        Ok(native_window_snapshot(&application, native_window, lease))
    })
}

#[cfg(not(target_os = "macos"))]
fn read_native_window_lease<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _diagnostic_smoke: bool,
    _candidate_lease_id: &str,
    _operation: WindowLeaseReadOperation,
) -> Result<PerfCaptureWindowSnapshot, String> {
    Err(error(
        "Performance capture window lease read is unavailable.",
    ))
}

pub(super) async fn release_window_lease<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    run_token: String,
    lease_id: String,
) -> Result<PerfCaptureWindowSnapshot, String> {
    authorize_activation(window.label(), &run_token)?;
    let diagnostic_smoke = diagnostic_smoke_enabled()?;
    let permit = claim_activation(&ACTIVATION_IN_FLIGHT)?;

    let (sender, receiver) = mpsc::sync_channel(1);
    let dispatch = std::sync::Arc::new(MainThreadLeaseDispatch::default());
    let callback_dispatch = std::sync::Arc::clone(&dispatch);
    let native_window = window.clone();
    window
        .run_on_main_thread(move || {
            if !callback_dispatch.begin() {
                drop(permit);
                return;
            }
            let result = release_native_window_lease(&native_window, diagnostic_smoke, &lease_id);
            callback_dispatch.complete();
            let _ = sender.send(result);
            drop(permit);
        })
        .map_err(|_| error("Performance capture window lease release is unavailable."))?;

    tauri::async_runtime::spawn_blocking(move || {
        receive_main_thread_result(
            receiver,
            dispatch,
            "Performance capture window lease release timed out.",
            "Performance capture window lease release failed.",
        )
    })
    .await
    .map_err(|_| error("Performance capture window lease release failed."))??
}

#[cfg(target_os = "macos")]
fn release_native_window_lease<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    diagnostic_smoke: bool,
    candidate_lease_id: &str,
) -> Result<PerfCaptureWindowSnapshot, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationPolicy, NSWindow, NSWindowCollectionBehavior,
    };

    let main_thread = MainThreadMarker::new()
        .ok_or_else(|| error("Performance capture window lease release is unavailable."))?;
    let pointer = window
        .ns_window()
        .map_err(|_| error("Performance capture window lease release is unavailable."))?;
    let native_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| error("Performance capture window lease release is unavailable."))?;
    let application = NSApplication::sharedApplication(main_thread);

    NATIVE_WINDOW_LEASE.with(|slot| {
        let mut slot = slot
            .try_borrow_mut()
            .map_err(|_| error("Performance capture window lease release is unavailable."))?;
        let lease = slot
            .as_mut()
            .filter(|lease| {
                lease.lease_id == candidate_lease_id
                    && lease.window_pointer == pointer as usize
                    && lease.diagnostic_smoke == diagnostic_smoke
            })
            .ok_or_else(|| error("Performance capture window lease release was rejected."))?;

        let measurement_snapshot = native_window_snapshot(&application, native_window, lease);
        let original_activation_policy =
            NSApplicationActivationPolicy(lease.original.activation_policy);
        let mut restoration_failed = false;
        if lease.diagnostic_smoke && !lease.diagnostic_policy_restored {
            native_window.setHidesOnDeactivate(lease.original.hides_on_deactivate);
            native_window.setCollectionBehavior(NSWindowCollectionBehavior(
                lease.original.collection_behavior,
            ));
            if native_window.hidesOnDeactivate() != lease.original.hides_on_deactivate
                || native_window.collectionBehavior().0 != lease.original.collection_behavior
            {
                restoration_failed = true;
            } else {
                lease.diagnostic_policy_restored = true;
            }
        }
        if let Some(leased_policy) = lease.activation_policy_lease {
            let owned_policy_is_current =
                application.activationPolicy() == NSApplicationActivationPolicy(leased_policy);
            let policy_restored = owned_policy_is_current
                && application.setActivationPolicy(original_activation_policy)
                && application.activationPolicy() == original_activation_policy;
            if policy_restored {
                lease.activation_policy_lease = None;
            } else {
                restoration_failed = true;
            }
        }
        if restoration_failed {
            return Err(error(
                "Performance capture window lease restoration could not be confirmed.",
            ));
        }

        for observer in lease.observers.drain(..) {
            let observer_object: &objc2::runtime::AnyObject =
                AsRef::<objc2::runtime::AnyObject>::as_ref(&observer);
            unsafe { lease.notification_center.removeObserver(observer_object) };
        }
        let released_snapshot = finalize_released_snapshot(
            &measurement_snapshot,
            native_window_snapshot(&application, native_window, lease),
        );
        *slot = None;
        Ok(released_snapshot)
    })
}

fn finalize_released_snapshot(
    measurement_snapshot: &PerfCaptureWindowSnapshot,
    mut restored_snapshot: PerfCaptureWindowSnapshot,
) -> PerfCaptureWindowSnapshot {
    restored_snapshot.window_stability_epoch = measurement_snapshot.window_stability_epoch;
    restored_snapshot.app_activation_transitions = measurement_snapshot.app_activation_transitions;
    restored_snapshot.occlusion_transitions = measurement_snapshot.occlusion_transitions;
    restored_snapshot.key_transitions = measurement_snapshot.key_transitions;
    restored_snapshot.minimize_transitions = measurement_snapshot.minimize_transitions;
    restored_snapshot.transition_overflow = measurement_snapshot.transition_overflow;
    restored_snapshot.diagnostic_space_lease = false;
    restored_snapshot
}

#[cfg(not(target_os = "macos"))]
fn activate_native_window<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _diagnostic_smoke: bool,
    _candidate_lease_id: Option<&str>,
) -> Result<PerfCaptureWindowSnapshot, String> {
    Err(error(
        "Performance capture window activation is unavailable.",
    ))
}

#[cfg(not(target_os = "macos"))]
fn release_native_window_lease<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _diagnostic_smoke: bool,
    _candidate_lease_id: &str,
) -> Result<PerfCaptureWindowSnapshot, String> {
    Err(error(
        "Performance capture window lease release is unavailable.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn activation_admission_requires_the_main_window_and_exact_token() {
        assert_eq!(authorize_activation("main", TOKEN), Ok(()));
        assert_eq!(
            authorize_activation("secondary", TOKEN),
            Err("Performance capture window activation was rejected.".to_owned())
        );
        assert_eq!(
            authorize_activation("main", "wrong-token"),
            Err("Performance capture window activation was rejected.".to_owned())
        );
    }

    #[test]
    fn existing_window_lease_admission_requires_exact_identity() {
        assert_eq!(
            authorize_existing_window_lease(Some("lease-1"), "lease-1", 0x1234, 0x1234, true, true,),
            Ok(())
        );
        for rejected in [
            authorize_existing_window_lease(None, "lease-1", 0x1234, 0x1234, true, true),
            authorize_existing_window_lease(Some("lease-2"), "lease-1", 0x1234, 0x1234, true, true),
            authorize_existing_window_lease(Some("lease-1"), "lease-1", 0x5678, 0x1234, true, true),
            authorize_existing_window_lease(
                Some("lease-1"),
                "lease-1",
                0x1234,
                0x1234,
                false,
                true,
            ),
        ] {
            assert_eq!(
                rejected,
                Err("Performance capture window lease was rejected.".to_owned())
            );
        }
    }

    #[test]
    fn activation_snapshot_has_the_bounded_camel_case_wire_shape() {
        let snapshot = PerfCaptureWindowSnapshot {
            lease_id: "lease-1".to_owned(),
            active: true,
            hidden: false,
            visible: true,
            key: true,
            minimized: false,
            occluded: false,
            occlusion_visible: true,
            diagnostic_space_lease: true,
            on_active_space: false,
            window_stability_epoch: 7,
            app_activation_transitions: 2,
            occlusion_transitions: 1,
            key_transitions: 3,
            minimize_transitions: 1,
            transition_overflow: false,
        };

        assert_eq!(
            serde_json::to_value(snapshot).expect("serialize snapshot"),
            serde_json::json!({
                "leaseId": "lease-1",
                "active": true,
                "hidden": false,
                "visible": true,
                "key": true,
                "minimized": false,
                "occluded": false,
                "occlusionVisible": true,
                "diagnosticSpaceLease": true,
                "onActiveSpace": false,
                "windowStabilityEpoch": 7,
                "appActivationTransitions": 2,
                "occlusionTransitions": 1,
                "keyTransitions": 3,
                "minimizeTransitions": 1,
                "transitionOverflow": false
            })
        );
    }

    #[test]
    fn released_snapshot_clears_only_the_policy_lease_and_keeps_restored_space_state() {
        let measurement_snapshot = snapshot_fixture(true, false, 7);
        let restored_snapshot = snapshot_fixture(true, true, 99);

        let released_snapshot =
            finalize_released_snapshot(&measurement_snapshot, restored_snapshot);

        assert!(!released_snapshot.diagnostic_space_lease);
        assert!(released_snapshot.on_active_space);
        assert_eq!(released_snapshot.window_stability_epoch, 7);
    }

    fn snapshot_fixture(
        diagnostic_space_lease: bool,
        on_active_space: bool,
        window_stability_epoch: u64,
    ) -> PerfCaptureWindowSnapshot {
        PerfCaptureWindowSnapshot {
            lease_id: "lease-1".to_owned(),
            active: true,
            hidden: false,
            visible: true,
            key: true,
            minimized: false,
            occluded: false,
            occlusion_visible: true,
            diagnostic_space_lease,
            on_active_space,
            window_stability_epoch,
            app_activation_transitions: 2,
            occlusion_transitions: 1,
            key_transitions: 3,
            minimize_transitions: 1,
            transition_overflow: false,
        }
    }

    #[test]
    fn smoke_mode_is_closed_to_exact_compile_time_values() {
        assert_eq!(parse_smoke_mode("0"), Ok(false));
        assert_eq!(parse_smoke_mode("1"), Ok(true));
        assert_eq!(
            parse_smoke_mode("true"),
            Err("Performance capture smoke mode is not configured.".to_owned())
        );
        assert_eq!(
            parse_smoke_mode(""),
            Err("Performance capture smoke mode is not configured.".to_owned())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn diagnostic_space_behavior_preserves_unrelated_bits_and_exclusivity() {
        use objc2_app_kit::NSWindowCollectionBehavior;

        let auxiliary = diagnostic_collection_behavior(
            NSWindowCollectionBehavior::Managed | NSWindowCollectionBehavior::MoveToActiveSpace,
        );
        assert!(auxiliary.contains(NSWindowCollectionBehavior::Managed));
        assert!(auxiliary.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(auxiliary.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
        assert!(!auxiliary.contains(NSWindowCollectionBehavior::MoveToActiveSpace));

        let primary = diagnostic_collection_behavior(
            NSWindowCollectionBehavior::Managed | NSWindowCollectionBehavior::FullScreenPrimary,
        );
        assert!(!primary.contains(NSWindowCollectionBehavior::FullScreenPrimary));
        assert!(primary.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));

        let fullscreen_none = diagnostic_collection_behavior(
            NSWindowCollectionBehavior::Managed | NSWindowCollectionBehavior::FullScreenNone,
        );
        assert!(!fullscreen_none.contains(NSWindowCollectionBehavior::FullScreenNone));
        assert!(fullscreen_none.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn capture_activation_policy_promotes_only_unactivatable_processes() {
        use objc2_app_kit::NSApplicationActivationPolicy;

        assert_eq!(
            capture_activation_policy(NSApplicationActivationPolicy::Prohibited),
            NSApplicationActivationPolicy::Regular,
        );
        assert_eq!(
            capture_activation_policy(NSApplicationActivationPolicy::Accessory),
            NSApplicationActivationPolicy::Accessory,
        );
        assert_eq!(
            capture_activation_policy(NSApplicationActivationPolicy::Regular),
            NSApplicationActivationPolicy::Regular,
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn diagnostic_space_lease_reports_only_the_exact_policy_readback() {
        use objc2_app_kit::NSWindowCollectionBehavior;

        let exact_policy = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        assert!(diagnostic_space_policy_is_applied(
            true,
            false,
            exact_policy | NSWindowCollectionBehavior::Managed,
        ));
        assert!(!diagnostic_space_policy_is_applied(
            false,
            false,
            exact_policy,
        ));
        assert!(!diagnostic_space_policy_is_applied(
            true,
            true,
            exact_policy,
        ));

        for conflicting_behavior in [
            NSWindowCollectionBehavior::MoveToActiveSpace,
            NSWindowCollectionBehavior::FullScreenPrimary,
            NSWindowCollectionBehavior::FullScreenNone,
        ] {
            assert!(!diagnostic_space_policy_is_applied(
                true,
                false,
                exact_policy | conflicting_behavior,
            ));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn transition_baseline_reset_and_generation_are_isolated() {
        let old_generation = std::sync::Arc::new(WindowTransitionCounters::default());
        old_generation.record(WindowTransitionKind::AppActivation);
        old_generation.record(WindowTransitionKind::Key);
        assert_eq!(old_generation.epoch.load(Ordering::Acquire), 2);

        old_generation.reset();
        assert_eq!(old_generation.epoch.load(Ordering::Acquire), 0);
        assert_eq!(old_generation.key.load(Ordering::Acquire), 0);

        let new_generation = std::sync::Arc::new(WindowTransitionCounters::default());
        old_generation.record(WindowTransitionKind::Occlusion);
        assert_eq!(old_generation.epoch.load(Ordering::Acquire), 1);
        assert_eq!(new_generation.epoch.load(Ordering::Acquire), 0);
        assert_ne!(next_window_lease_id(), next_window_lease_id());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn transition_counters_saturate_and_fail_closed_on_overflow() {
        let counters = WindowTransitionCounters::default();
        counters
            .epoch
            .store(MAX_SAFE_TRANSITIONS, Ordering::Release);
        counters.key.store(MAX_SAFE_TRANSITIONS, Ordering::Release);

        counters.record(WindowTransitionKind::Key);

        assert_eq!(counters.epoch.load(Ordering::Acquire), MAX_SAFE_TRANSITIONS);
        assert_eq!(counters.key.load(Ordering::Acquire), MAX_SAFE_TRANSITIONS);
        assert!(counters.overflow.load(Ordering::Acquire));
    }

    #[test]
    fn activation_admission_is_single_flight_and_releases_with_its_permit() {
        let state = AtomicBool::new(false);
        let permit = claim_activation(&state).expect("claim first activation");

        thread::scope(|scope| {
            scope.spawn(|| {
                assert_eq!(
                    claim_activation(&state).err(),
                    Some(
                        "Performance capture window activation is already in progress.".to_owned()
                    )
                );
            });
        });

        drop(permit);
        assert!(claim_activation(&state).is_ok());
    }

    #[test]
    fn timed_out_main_thread_dispatch_cannot_begin_late() {
        let dispatch = MainThreadLeaseDispatch::default();
        let mut lease_mutation_ran = false;

        assert!(dispatch.cancel_before_begin());
        if dispatch.begin() {
            lease_mutation_ran = true;
            dispatch.complete();
        }
        assert!(!lease_mutation_ran);
        assert!(!dispatch.cancel_before_begin());
    }

    #[test]
    fn running_main_thread_dispatch_cannot_be_cancelled_as_pending() {
        let dispatch = MainThreadLeaseDispatch::default();

        assert!(dispatch.begin());
        assert!(!dispatch.cancel_before_begin());
        dispatch.complete();
        assert!(!dispatch.begin());
    }

    #[test]
    fn started_dispatch_delivers_across_the_timeout_boundary() {
        let dispatch = std::sync::Arc::new(MainThreadLeaseDispatch::default());
        let callback_dispatch = std::sync::Arc::clone(&dispatch);
        let (sender, receiver) = mpsc::sync_channel(1);

        thread::scope(|scope| {
            scope.spawn(move || {
                assert!(callback_dispatch.begin());
                thread::sleep(Duration::from_millis(10));
                callback_dispatch.complete();
                sender.send(7).expect("receiver retains exact ownership");
            });

            assert_eq!(
                receive_main_thread_result_with_timeout(
                    receiver,
                    dispatch,
                    Duration::from_millis(1),
                    "timed out",
                    "failed",
                ),
                Ok(7),
            );
        });
    }

    #[test]
    fn timed_out_activation_abandons_result_before_buffered_send_and_requires_compensation() {
        let dispatch = std::sync::Arc::new(MainThreadLeaseDispatch::default());
        let delivery = std::sync::Arc::new(MainThreadResultDelivery::default());
        let callback_dispatch = std::sync::Arc::clone(&dispatch);
        let callback_delivery = std::sync::Arc::clone(&delivery);
        let (sender, receiver) = mpsc::sync_channel(1);
        let compensation_ran = std::sync::Arc::new(AtomicBool::new(false));
        let callback_compensation = std::sync::Arc::clone(&compensation_ran);

        thread::scope(|scope| {
            scope.spawn(move || {
                assert!(callback_dispatch.begin());
                thread::sleep(Duration::from_millis(10));
                callback_dispatch.complete();
                if callback_delivery.offer() {
                    sender.send(7).expect("owned result delivery");
                } else {
                    callback_compensation.store(true, Ordering::Release);
                }
            });

            assert_eq!(
                receive_activation_result_with_timeout(
                    receiver,
                    dispatch,
                    delivery,
                    Duration::from_millis(1),
                    "timed out",
                    "failed",
                ),
                Err("timed out".to_owned()),
            );
        });

        assert!(compensation_ran.load(Ordering::Acquire));
        assert!(MainThreadLeaseDispatch::default().begin());
    }
}
