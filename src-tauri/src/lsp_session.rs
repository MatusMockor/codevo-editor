use crate::lsp::{JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
use crate::lsp_transport::read_message;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{self, BufReader, Read};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

mod capabilities;
mod configuration_bounds;
mod diagnostic_authority;
mod document_sync_capability;
mod event_sinks;
mod pending_requests;
mod request_dispatch;
mod restart_policy;
mod runtime_telemetry;
mod server_configuration;
mod server_process;
mod server_requests;
mod session_cleanup;
mod session_transitions;
mod session_writer;
mod start_cleanup;
mod status_publication;
mod supervisor_lifecycle;
mod transport_failure;
mod workspace_runtime_identity;

use capabilities::parse_capabilities;
pub use capabilities::LanguageServerCapabilities;
#[cfg(test)]
use capabilities::SemanticTokensLegend;
pub(crate) use configuration_bounds::validate_settings as validate_server_configuration_settings;
use diagnostic_authority::consume_diagnostic_bytes;
pub use document_sync_capability::DocumentSyncCapability;
pub(crate) use event_sinks::language_server_status_payload;
pub(crate) use event_sinks::LanguageServerEventSinks;
#[cfg(test)]
use event_sinks::{
    diagnostics_event_payload, refresh_event_payload, status_event_payload,
    workspace_edit_event_payload, NoopRefreshSink, NoopWorkspaceEditSink,
};
#[allow(unused_imports)]
pub use event_sinks::{
    AppHandleEventSink, DiagnosticsSink, LanguageServerRefreshEvent, LanguageServerRefreshFeature,
    LanguageServerWorkspaceEditEvent, RefreshSink, StatusSink, WorkspaceEditSink,
};
use pending_requests::{
    decode_session_message, reject_pending_requests, route_pending_response,
    PendingRequestCancellationReceipt, PendingRequestRegistry, PendingRequests,
    PendingResponseReceipt,
};
#[cfg(test)]
use pending_requests::{
    parse_response_result, PendingRequestAdmissionError, MAX_PENDING_REQUESTS_PER_SESSION,
};
use request_dispatch::{
    prepare_cancel_pending_request, send_request_with_timeout, CancellationTransport,
    ExactSessionNotificationTransport,
};
pub use restart_policy::RestartController;
use restart_policy::RestartOutcome;
#[cfg(test)]
use restart_policy::{RestartDecision, RestartPolicy};
pub use runtime_telemetry::RecentLspRequest;
#[cfg(test)]
use runtime_telemetry::STDERR_TAIL_CAPACITY;
use runtime_telemetry::{
    append_runtime_log, record_recent_request, reset_request_telemetry, reset_runtime_log,
    snapshot_recent_requests, snapshot_stderr_tail, spawn_stderr_reader, RecentRequests,
    RuntimeLog, StderrTail, StderrTailBuffer,
};
#[cfg(test)]
use server_process::{ChildKiller, SpawnedServer};
pub use server_process::{ChildServerProcessSpawner, ProcessKiller, ServerProcessSpawner};
use server_requests::{respond_to_server_request, server_window_message, workspace_guard_path};
use session_cleanup::{
    cleanup_session, publish_crash_for_active_session, reserve_session_ownership,
    retain_cleanup_task, retain_process_termination, retain_provisional_process,
    retain_session_readers, terminate_or_retain_process, terminate_process, terminate_session,
    LifecycleGate, LifecycleOperation, ProcessKillerSlot, SessionCleanupOutcome,
    SessionCleanupTask, SessionOwnershipPermit, SharedProcessKiller,
};
#[cfg(test)]
use session_transitions::cancellable_backoff;
use session_transitions::{
    clone_command, clone_initialize_request, set_status, RestartContext, StartKind,
};
use session_writer::SessionMessageWriter;
use status_publication::StatusPublicationQueue;
use transport_failure::transport_failure_message;
use workspace_runtime_identity::{workspace_runtime_id, workspace_runtime_id_candidates};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const PHP_STATUS_EVENT: &str = "language-server://status";
pub const PHP_DIAGNOSTICS_EVENT: &str = "language-server://diagnostics";
pub const PHP_REFRESH_EVENT: &str = "language-server://refresh";
pub const PHP_WORKSPACE_EDIT_EVENT: &str = "language-server://workspace-edit";
pub const JAVASCRIPT_TYPESCRIPT_STATUS_EVENT: &str =
    "javascript-typescript-language-server://status";
pub const JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT: &str =
    "javascript-typescript-language-server://diagnostics";
pub const JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT: &str =
    "javascript-typescript-language-server://refresh";
pub const JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT: &str =
    "javascript-typescript-language-server://workspace-edit";
type SessionRequestParts = (
    u64,
    Arc<SessionMessageWriter>,
    PendingRequests,
    Arc<CancellationTransport>,
);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectResyncRequestOutcome {
    Admitted,
    SupersededByFreshSession,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExactSessionNotificationOutcome {
    Admitted,
    Stale,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LanguageServerRequestError {
    Response { code: i64, message: String },
    Message(String),
}

impl std::fmt::Display for LanguageServerRequestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Response { message, .. } | Self::Message(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for LanguageServerRequestError {}

impl From<String> for LanguageServerRequestError {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

impl From<&str> for LanguageServerRequestError {
    fn from(message: &str) -> Self {
        Self::Message(message.to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LanguageServerRuntimeStatus {
    Starting {
        #[serde(rename = "sessionId")]
        session_id: u64,
    },
    Running {
        #[serde(rename = "sessionId")]
        session_id: u64,
        capabilities: LanguageServerCapabilities,
    },
    Stopped,
    Crashed {
        message: String,
    },
}

enum HandshakeOutcome {
    Ready(LanguageServerCapabilities),
    Failed(String),
    Disconnected,
}

struct RunningSession {
    ownership_permit: Option<SessionOwnershipPermit>,
    cancellation_transport: Arc<CancellationTransport>,
    exact_notification_transport: Arc<ExactSessionNotificationTransport>,
    pid: Option<u32>,
    stderr_reader: Option<JoinHandle<()>>,
    stdin: Arc<SessionMessageWriter>,
    killer: SharedProcessKiller,
    pending_requests: PendingRequests,
    reader: Option<JoinHandle<()>>,
    server_configuration: Arc<Mutex<Value>>,
    session_id: u64,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
}

pub struct LanguageServerSupervisor {
    cleanup_task: Mutex<Option<SessionCleanupTask>>,
    cleanup_terminal_failure: Mutex<Option<String>>,
    lifecycle_gate: LifecycleGate,
    log: RuntimeLog,
    recent_requests: RecentRequests,
    stderr_tail: StderrTail,
    next_request_id: AtomicU64,
    next_session_id: Arc<AtomicU64>,
    server_label: &'static str,
    session: Mutex<Option<RunningSession>>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    status_publications: Arc<StatusPublicationQueue>,
}

mod registry;
pub use registry::{
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRegistry, PhpLanguageServerRegistry,
};

fn send_initialized(stdin: &Arc<SessionMessageWriter>) -> Result<(), String> {
    let initialized = json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} });
    let initialized_bytes = serde_json::to_vec(&initialized)
        .map_err(|error| format!("Failed to serialize initialized notification: {error}"))?;
    write_with_session_stdin(stdin, &initialized_bytes)
        .map_err(|error| format!("Failed to send initialized: {error}"))
}

fn write_with_session_stdin(stdin: &Arc<SessionMessageWriter>, payload: &[u8]) -> io::Result<()> {
    stdin.write_message(payload, REQUEST_TIMEOUT)
}

fn is_active_status(status: &LanguageServerRuntimeStatus) -> bool {
    matches!(
        status,
        LanguageServerRuntimeStatus::Starting { .. } | LanguageServerRuntimeStatus::Running { .. }
    )
}

#[allow(clippy::too_many_arguments)]
fn spawn_reader(
    stdout: Box<dyn Read + Send>,
    stdin: Arc<SessionMessageWriter>,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    status_publications: Arc<StatusPublicationQueue>,
    runtime_log: RuntimeLog,
    diagnostics_sink: Arc<dyn DiagnosticsSink>,
    workspace_edit_sink: Arc<dyn WorkspaceEditSink>,
    refresh_sink: Arc<dyn RefreshSink>,
    pending_requests: PendingRequests,
    status_sink: Arc<dyn StatusSink>,
    stop_requested: Arc<AtomicBool>,
    handshake_tx: mpsc::Sender<HandshakeOutcome>,
    init_id: u64,
    session_id: u64,
    server_label: &'static str,
    server_configuration: Arc<Mutex<Value>>,
    workspace_root: String,
    restart_context: Option<Arc<RestartContext>>,
    killer: SharedProcessKiller,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut handshake_done = false;

        loop {
            match read_message(&mut reader) {
                Ok(Some(bytes)) => {
                    if handshake_done && stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    if handshake_done
                        && consume_diagnostic_bytes(
                            &bytes,
                            session_id,
                            &workspace_root,
                            diagnostics_sink.as_ref(),
                        )
                    {
                        continue;
                    }

                    let Ok(value) = decode_session_message(&bytes, &pending_requests) else {
                        continue;
                    };

                    if let Some(message) = server_window_message(&value, server_label) {
                        append_runtime_log(&runtime_log, &message.chunk);

                        if !message.requires_response {
                            continue;
                        }
                    }

                    if handshake_done {
                        if stop_requested.load(Ordering::SeqCst) {
                            return;
                        }

                        match route_pending_response(&pending_requests, &value) {
                            PendingResponseReceipt::Routed
                            | PendingResponseReceipt::RegistryUnavailable
                            | PendingResponseReceipt::SessionClosed => continue,
                            PendingResponseReceipt::Unmatched => {}
                        }

                        if respond_to_server_request(
                            &stdin,
                            &value,
                            workspace_edit_sink.as_ref(),
                            refresh_sink.as_ref(),
                            session_id,
                            &server_configuration,
                            &workspace_root,
                        )
                        .is_ok()
                        {
                            continue;
                        }

                        continue;
                    }

                    if value.get("id") != Some(&json!(init_id)) {
                        continue;
                    }

                    if value.get("result").is_some() {
                        let Ok(capabilities) = parse_capabilities(&value) else {
                            let _ = handshake_tx.send(HandshakeOutcome::Failed(
                                format!(
                                    "{server_label} initialize response did not include valid server capabilities."
                                )
                                    .to_string(),
                            ));
                            return;
                        };

                        handshake_done = true;
                        let _ = handshake_tx.send(HandshakeOutcome::Ready(capabilities));
                        continue;
                    }

                    let message = value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Language server rejected initialize.")
                        .to_string();
                    let _ = handshake_tx.send(HandshakeOutcome::Failed(message));
                    return;
                }
                Ok(None) => {
                    terminate_or_retain_process(&killer);

                    if !handshake_done {
                        let _ = handshake_tx.send(HandshakeOutcome::Disconnected);
                        return;
                    }

                    if stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    reject_pending_requests(
                        &pending_requests,
                        "Language server exited unexpectedly.",
                    );
                    let published_crash = publish_crash_for_active_session(
                        &status,
                        status_publications.as_ref(),
                        &status_sink,
                        &stop_requested,
                        session_id,
                        &format!("{server_label} exited unexpectedly."),
                    );

                    if published_crash {
                        maybe_restart_after_crash(&restart_context, &stop_requested);
                    }
                    return;
                }
                Err(error) => {
                    let message = transport_failure_message(server_label, &error);
                    terminate_or_retain_process(&killer);

                    if !handshake_done {
                        let _ = handshake_tx.send(HandshakeOutcome::Failed(message));
                        return;
                    }

                    if stop_requested.load(Ordering::SeqCst) {
                        return;
                    }

                    reject_pending_requests(&pending_requests, &message);
                    publish_crash_for_active_session(
                        &status,
                        status_publications.as_ref(),
                        &status_sink,
                        &stop_requested,
                        session_id,
                        &message,
                    );
                    return;
                }
            }
        }
    })
}

/// Consult the restart controller after an unexpected crash and, if a restart
/// is allowed, schedule a backed-off re-spawn for the same workspace. A
/// requested shutdown (`stop_requested`) or an exhausted budget leaves the
/// session in the already-published `Crashed` state — no infinite loop.
fn maybe_restart_after_crash(
    restart_context: &Option<Arc<RestartContext>>,
    stop_requested: &Arc<AtomicBool>,
) {
    let Some(context) = restart_context else {
        return;
    };

    let stop = stop_requested.load(Ordering::SeqCst);

    match context.controller.evaluate_crash(stop) {
        RestartOutcome::GiveUp => {}
        RestartOutcome::Restart { delay } => {
            Arc::clone(context).restart_after(delay);
        }
    }
}

#[cfg(test)]
mod tests {
    mod diagnostics_projection_tests;
    #[cfg(unix)]
    mod real_process_lifecycle_tests;
    mod registry_capacity_tests;
    mod request_cancellation_tests;
    mod session_cleanup_tests;
    mod start_cleanup_tests;
    mod transport_failure_tests;

    #[cfg(unix)]
    use super::ChildKiller;
    use super::{
        cancellable_backoff, parse_response_result, terminate_process, workspace_runtime_id,
        ChildServerProcessSpawner, DiagnosticsSink, JavaScriptTypeScriptLanguageServerRegistry,
        LanguageServerCapabilities, LanguageServerEventSinks, LanguageServerRefreshEvent,
        LanguageServerRefreshFeature, LanguageServerRegistry, LanguageServerRequestError,
        LanguageServerRuntimeStatus, LanguageServerSupervisor, LanguageServerWorkspaceEditEvent,
        NoopRefreshSink, NoopWorkspaceEditSink, PhpLanguageServerRegistry, ProcessKiller,
        ProcessKillerSlot, RefreshSink, RestartController, RestartDecision, RestartOutcome,
        RestartPolicy, SemanticTokensLegend, ServerProcessSpawner, SessionMessageWriter,
        SharedProcessKiller, SpawnedServer, StartKind, StatusSink, WorkspaceEditSink,
    };
    use crate::lsp::{file_uri, JsonRpcNotification, JsonRpcRequest, LanguageServerCommand};
    use crate::lsp_diagnostics::{
        LanguageServerDiagnosticEvent, LanguageServerDiagnosticProjection,
        LanguageServerDiagnosticProjectionReason, LanguageServerDiagnosticSeverityCounts,
    };
    use crate::lsp_features::LanguageServerWorkspaceEdit;
    use crate::lsp_transport::{read_message, write_message};
    use serde_json::{json, Value};
    use std::fs;
    use std::io::{self, PipeWriter, Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Arc, Barrier, Mutex};
    use std::time::{Duration, Instant, SystemTime};

    #[test]
    fn response_error_preserves_json_rpc_code_for_command_serialization() {
        let error = parse_response_result(&json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": {
                "code": -32802,
                "message": "Server cancelled obsolete code action"
            }
        }))
        .expect_err("response should be an error");

        assert_eq!(
            error,
            LanguageServerRequestError::Response {
                code: -32802,
                message: "Server cancelled obsolete code action".to_string(),
            }
        );
        assert_eq!(
            serde_json::to_value(error).expect("serialize command error"),
            json!({
                "code": -32802,
                "message": "Server cancelled obsolete code action"
            })
        );
    }

    #[test]
    fn response_error_without_code_keeps_legacy_string_serialization() {
        let error = parse_response_result(&json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": { "message": "PHPactor request failed" }
        }))
        .expect_err("response should be an error");

        assert_eq!(
            serde_json::to_value(error).expect("serialize command error"),
            json!("PHPactor request failed")
        );
    }

    #[cfg(unix)]
    #[test]
    fn child_server_process_spawner_applies_phpactor_isolation_env() {
        let command = LanguageServerCommand {
            executable: "env".to_string(),
            args: Vec::new(),
            working_directory: "/tmp".to_string(),
            env: vec![
                ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
                (
                    "PHP_INI_SCAN_DIR".to_string(),
                    "/managed/empty-php-conf.d".to_string(),
                ),
            ],
        };

        let spawner = ChildServerProcessSpawner;
        let mut spawned = spawner.spawn(&command).expect("spawn env");
        drop(spawned.stdin);

        let mut stdout = String::new();
        spawned
            .stdout
            .read_to_string(&mut stdout)
            .expect("read env stdout");
        spawned.killer.terminate().expect("terminate env");

        assert!(stdout.contains("PHPRC=/managed/codevo-php.ini\n"));
        assert!(stdout.contains("PHP_INI_SCAN_DIR=/managed/empty-php-conf.d\n"));
    }

    #[test]
    fn successful_handshake_reports_running_and_sends_initialized() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(status, running_status());
        wait_for(&rx, &starting_status());
        wait_for(&rx, &running_status());

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        let initialize: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();
        let initialized: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(initialize["method"], "initialize");
        assert_eq!(initialized["method"], "initialized");
    }

    #[test]
    fn captures_language_server_stderr_in_runtime_log() {
        let spawner =
            FakeSpawner::new(ready_script(), true).with_stderr(b"tsserver warning\n".to_vec());
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for_log(&supervisor, "tsserver warning");

        let log = supervisor.log();

        assert!(log.contains("TypeScript language server session 1 started"));
        assert!(log.contains("tsserver warning"));
    }

    #[test]
    fn captures_stderr_tail_as_bounded_recent_lines() {
        let stderr = b"first warning\nsecond warning\nthird warning\n".to_vec();
        let spawner = FakeSpawner::new(ready_script(), true).with_stderr(stderr);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for_log(&supervisor, "third warning");

        let tail = supervisor.stderr_tail();

        assert_eq!(
            tail,
            vec![
                "first warning".to_string(),
                "second warning".to_string(),
                "third warning".to_string(),
            ]
        );
    }

    #[test]
    fn stderr_tail_is_bounded_to_capacity() {
        let mut script = Vec::new();
        for line in 0..(super::STDERR_TAIL_CAPACITY + 10) {
            script.extend_from_slice(format!("line {line}\n").as_bytes());
        }
        let last_line = format!("line {}", super::STDERR_TAIL_CAPACITY + 9);
        let spawner = FakeSpawner::new(ready_script(), true).with_stderr(script);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for_log(&supervisor, &last_line);

        let tail = supervisor.stderr_tail();

        assert_eq!(tail.len(), super::STDERR_TAIL_CAPACITY);
        assert_eq!(tail.last(), Some(&last_line));
        assert_eq!(tail.first(), Some(&"line 10".to_string()));
    }

    #[test]
    fn records_recent_request_latency_and_success() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new_with_label("Test server"));

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor
                .send_request("textDocument/completion", json!({ "marker": "x" }))
                .expect("send completion")
        });
        let request_id = wait_for_captured_request_id(&capture, "textDocument/completion");
        write_held_message(
            &held,
            json!({ "jsonrpc": "2.0", "id": request_id, "result": { "items": [] } }),
        );
        request.join().expect("request thread");

        let recent = supervisor.recent_requests();

        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].method, "textDocument/completion");
        assert!(recent[0].success);
    }

    #[test]
    fn records_failed_request_as_unsuccessful() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new_with_label("Test server"));

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor.send_request("textDocument/hover", json!({}))
        });
        let request_id = wait_for_captured_request_id(&capture, "textDocument/hover");
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": { "code": -32603, "message": "boom" },
            }),
        );
        let error = request
            .join()
            .expect("request thread")
            .expect_err("request should preserve the server error");

        let recent = supervisor.recent_requests();

        assert_eq!(
            error,
            LanguageServerRequestError::Response {
                code: -32603,
                message: "boom".to_string(),
            }
        );
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].method, "textDocument/hover");
        assert!(!recent[0].success);
    }

    #[test]
    fn captures_language_server_launch_env_in_runtime_log() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("PHPactor language server");
        let mut command = command();
        command.executable = "/usr/bin/php".to_string();
        command.args = vec![
            "-n".to_string(),
            "-c".to_string(),
            "/managed/codevo-php.ini".to_string(),
            "/managed/vendor/bin/phpactor".to_string(),
            "language-server".to_string(),
        ];
        command.env = vec![
            ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
            (
                "PHP_INI_SCAN_DIR".to_string(),
                "/managed/empty-php-conf.d".to_string(),
            ),
        ];

        supervisor
            .start(
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let log = supervisor.log();

        assert!(log.contains(
            "command: /usr/bin/php -n -c /managed/codevo-php.ini /managed/vendor/bin/phpactor language-server"
        ));
        assert!(log.contains("PHPRC=/managed/codevo-php.ini"));
        assert!(log.contains("PHP_INI_SCAN_DIR=/managed/empty-php-conf.d"));
    }

    #[test]
    fn captures_language_server_window_messages_in_runtime_log() {
        let mut script = framed(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": {
                "type": 2,
                "message": "Using TypeScript 5.4.5 from workspace",
            },
        }));
        script.extend(ready_script());
        let spawner = FakeSpawner::new(script, true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "method": "window/showMessage",
                "params": {
                    "type": 1,
                    "message": "tsconfig.json contains an unsupported option",
                },
            }),
        );

        wait_for_log(
            &supervisor,
            "[TypeScript language server logMessage warning] Using TypeScript 5.4.5 from workspace",
        );
        wait_for_log(
            &supervisor,
            "[TypeScript language server showMessage error] tsconfig.json contains an unsupported option",
        );
    }

    #[test]
    fn captures_language_server_show_message_requests_in_runtime_log_and_responds() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new_with_label("TypeScript language server");

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 42,
                "method": "window/showMessageRequest",
                "params": {
                    "type": 3,
                    "message": "Install missing @types/node declarations?",
                    "actions": [{ "title": "Install" }],
                },
            }),
        );

        wait_for_log(
            &supervisor,
            "[TypeScript language server showMessageRequest info] Install missing @types/node declarations?",
        );
        let response = wait_for_captured_response(&capture, 42);

        assert_eq!(response["result"], Value::Null);
    }

    #[test]
    fn sends_notification_after_successful_handshake() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        supervisor
            .send_notification_for_session(
                1,
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({ "textDocument": { "uri": "file:///tmp/User.php" } }),
                },
            )
            .expect("send notification");

        let written = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(written);
        read_message(&mut reader).unwrap().unwrap();
        read_message(&mut reader).unwrap().unwrap();
        let notification: Value =
            serde_json::from_slice(&read_message(&mut reader).unwrap().unwrap()).unwrap();

        assert_eq!(notification["method"], "textDocument/didSave");
    }

    #[test]
    fn rapid_restart_drops_stale_close_and_keeps_replacement_document_open() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        *held.lock().expect("held writer lock") = None;
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        supervisor
            .send_notification_for_session(
                2,
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didOpen".to_string(),
                    params: json!({ "textDocument": { "uri": "file:///tmp/User.php" } }),
                },
            )
            .expect("open replacement document");
        supervisor
            .send_notification_for_session(
                1,
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didClose".to_string(),
                    params: json!({ "textDocument": { "uri": "file:///tmp/User.php" } }),
                },
            )
            .expect("drop stale close");

        let methods = captured_messages(&capture)
            .into_iter()
            .filter_map(|message| message["method"].as_str().map(str::to_string))
            .collect::<Vec<_>>();
        assert!(methods.contains(&"textDocument/didOpen".to_string()));
        assert!(!methods.contains(&"textDocument/didClose".to_string()));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Running { session_id: 2, .. }
        ));
    }

    #[test]
    fn repeated_replacement_rejects_every_stale_document_notification_generation() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        *held.lock().expect("held writer lock") = None;
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
        *held.lock().expect("replacement writer lock") = None;
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 3,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        for stale_session_id in [1, 2] {
            for method in [
                "textDocument/didOpen",
                "textDocument/didChange",
                "textDocument/didSave",
                "textDocument/didClose",
            ] {
                supervisor
                    .send_notification_for_session(
                        stale_session_id,
                        &JsonRpcNotification {
                            jsonrpc: "2.0".to_string(),
                            method: method.to_string(),
                            params: json!({
                                "textDocument": {
                                    "uri": format!(
                                        "file:///tmp/stale-{stale_session_id}-{method}.ts"
                                    )
                                }
                            }),
                        },
                    )
                    .expect("stale notification is rejected without failing the caller");
            }
        }
        supervisor
            .send_notification_for_session(
                3,
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didOpen".to_string(),
                    params: json!({
                        "textDocument": { "uri": "file:///tmp/current.ts" }
                    }),
                },
            )
            .expect("current notification");

        let document_notifications = captured_messages(&capture)
            .into_iter()
            .filter(|message| {
                message["method"]
                    .as_str()
                    .is_some_and(|method| method.starts_with("textDocument/did"))
            })
            .collect::<Vec<_>>();
        assert_eq!(document_notifications.len(), 1);
        assert_eq!(
            document_notifications[0]["params"]["textDocument"]["uri"],
            "file:///tmp/current.ts"
        );
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Running { session_id: 3, .. }
        ));
    }

    #[test]
    fn registry_keeps_workspace_sessions_isolated() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert_eq!(
            registry.running_roots(),
            vec![
                "/tmp/workspace-a".to_string(),
                "/tmp/workspace-b".to_string()
            ]
        );

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(matches!(
            registry.status("/tmp/workspace-b"),
            LanguageServerRuntimeStatus::Running { .. }
        ));
        assert_eq!(
            registry.running_roots(),
            vec!["/tmp/workspace-b".to_string()]
        );

        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry.running_roots().is_empty());
    }

    #[test]
    fn javascript_typescript_registry_records_launch_context_until_stop() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let command = command();
        let initialize_request = initialize_request();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request,
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let runtime_id = workspace_runtime_id("/tmp/workspace-a");
        let context = registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .get(&runtime_id)
            .cloned()
            .expect("stored launch context");

        assert_eq!(context.root_path, "/tmp/workspace-a");
        assert_eq!(context.command.executable, command.executable);
        assert_eq!(context.command.args, command.args);
        assert_eq!(context.command.working_directory, command.working_directory);
        assert_eq!(context.command.env, command.env);
        assert_eq!(
            context.initialize_request.jsonrpc,
            initialize_request.jsonrpc
        );
        assert_eq!(context.initialize_request.id, initialize_request.id);
        assert_eq!(context.initialize_request.method, initialize_request.method);
        assert_eq!(context.initialize_request.params, initialize_request.params);

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn javascript_typescript_runtime_panel_stop_keeps_runtime_restartable() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        assert_eq!(
            registry.stop_preserving_launch_context("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(registry.pid("/tmp/workspace-a"), None);
        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            1,
            "runtime-panel Stop must keep the last launch command for Restart"
        );

        let restart_spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let status = registry
            .restart_with_auto_restart(
                "/tmp/workspace-a",
                restart_spawner,
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("restart after runtime-panel stop");

        assert!(matches!(
            status,
            LanguageServerRuntimeStatus::Running { .. }
        ));
        registry.stop_all();
    }

    #[test]
    fn javascript_typescript_registry_stop_all_drains_launch_contexts() {
        let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            2
        );
        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn php_registry_records_launch_context_until_stop() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let mut command = command();
        command.executable = "/usr/bin/php".to_string();
        command.args = vec![
            "-n".to_string(),
            "-c".to_string(),
            "/managed/codevo-php.ini".to_string(),
            "/Users/dev/Library/Application Support/Codevo Editor/tools/phpactor/vendor/bin/phpactor"
                .to_string(),
            "language-server".to_string(),
        ];
        command.env = vec![
            ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
            (
                "PHP_INI_SCAN_DIR".to_string(),
                "/managed/empty-php-conf.d".to_string(),
            ),
        ];

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let runtime_id = workspace_runtime_id("/tmp/workspace-a");
        let context = registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .get(&runtime_id)
            .cloned()
            .expect("stored launch context");

        assert_eq!(context.root_path, "/tmp/workspace-a");
        assert_eq!(context.command.executable, command.executable);
        assert_eq!(context.command.args, command.args);
        assert_eq!(context.command.working_directory, command.working_directory);
        assert_eq!(context.command.env, command.env);

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn php_runtime_panel_stop_keeps_runtime_restartable() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let command = phpactor_managed_command();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        assert_eq!(
            registry.stop_preserving_launch_context("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(registry.pid("/tmp/workspace-a"), None);
        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            1,
            "runtime-panel Stop must keep the last launch command for Restart"
        );

        let restart_spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (restart_sink, _restart_rx) = ChannelSink::new();
        let status = registry
            .restart_with_auto_restart(
                "/tmp/workspace-a",
                restart_spawner,
                restart_sink,
                noop_diagnostics_sink(),
                Arc::new(NoopWorkspaceEditSink),
                Arc::new(NoopRefreshSink),
                test_restart_controller(),
            )
            .expect("restart after runtime-panel stop");

        assert!(matches!(
            status,
            LanguageServerRuntimeStatus::Running { .. }
        ));
        registry.stop_all();
    }

    #[test]
    fn php_registry_stop_all_drains_launch_contexts() {
        let registry = PhpLanguageServerRegistry::new();
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();
        let command = phpactor_managed_command();

        registry
            .start(
                "/tmp/workspace-a",
                &command,
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command,
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert_eq!(
            registry
                .launch_contexts
                .lock()
                .expect("launch contexts")
                .len(),
            2
        );
        assert_eq!(registry.stop_all(), LanguageServerRuntimeStatus::Stopped);
        assert!(registry
            .launch_contexts
            .lock()
            .expect("launch contexts")
            .is_empty());
    }

    #[test]
    fn registry_drop_stops_all_workspace_sessions() {
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        {
            let registry = LanguageServerRegistry::new_with_label("Test server");

            registry
                .start(
                    "/tmp/workspace-a",
                    &command(),
                    &initialize_request(),
                    &spawner_a,
                    sink_a,
                    noop_diagnostics_sink(),
                )
                .expect("start workspace a");
            registry
                .start(
                    "/tmp/workspace-b",
                    &command(),
                    &initialize_request(),
                    &spawner_b,
                    sink_b,
                    noop_diagnostics_sink(),
                )
                .expect("start workspace b");

            assert_eq!(
                registry.running_roots(),
                vec![
                    "/tmp/workspace-a".to_string(),
                    "/tmp/workspace-b".to_string()
                ]
            );
            assert!(held_a.lock().expect("workspace a writer").is_some());
            assert!(held_b.lock().expect("workspace b writer").is_some());
        }

        assert!(held_a.lock().expect("workspace a writer").is_none());
        assert!(held_b.lock().expect("workspace b writer").is_none());
    }

    #[test]
    #[cfg(unix)]
    fn registry_stop_resolves_missing_symlink_alias_root() {
        use std::os::unix::fs::symlink;

        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let parent = temp_workspace("lsp-stop-alias-parent");
        let root = parent.join("workspace");
        fs::create_dir_all(&root).expect("workspace root");
        let root = root.canonicalize().expect("canonical workspace root");
        let alias_parent = temp_path("lsp-stop-alias-link");
        symlink(&parent, &alias_parent).expect("workspace parent symlink");
        let alias_root = alias_parent.join("workspace");

        registry
            .start(
                &path_string(&root),
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");
        fs::remove_dir_all(&root).expect("remove workspace root");

        assert!(matches!(
            registry.status(&path_string(&alias_root)),
            LanguageServerRuntimeStatus::Running { .. }
        ));
        assert_eq!(
            registry.stop(&path_string(&alias_root)),
            LanguageServerRuntimeStatus::Stopped
        );
        assert!(registry.running_roots().is_empty());
    }

    #[test]
    fn registry_routes_notifications_to_the_requested_workspace_only() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                    }),
                },
            )
            .expect("send workspace b notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/didSave"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "textDocument/didSave"
                && message["params"]["textDocument"]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
    }

    #[test]
    fn registry_start_with_auto_restart_recovers_crashed_workspace() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();

        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-workspace",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start with auto restart");
        wait_for(&rx, &running_status());

        // Simulate an unexpected crash for this workspace's server.
        *held.lock().expect("held writer lock") = None;

        // The registry start path must re-spawn the *same* workspace's server and
        // return it to running. A plain start path (no auto-restart) would leave
        // the session permanently Crashed.
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
    }

    #[test]
    fn registry_auto_restart_is_isolated_per_workspace() {
        let registry = LanguageServerRegistry::new_with_label("Test server");
        let spawner_a = Arc::new(FakeSpawner::new(ready_script(), true));
        let spawner_b = Arc::new(FakeSpawner::new(ready_script(), true));
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, rx_a) = ChannelSink::new();
        let (sink_b, rx_b) = ChannelSink::new();

        // Each workspace gets its OWN restart controller -> per-workspace
        // isolation, no shared restart budget across open project tabs.
        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-a",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner_a) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink_a,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start workspace a");
        registry
            .start_with_auto_restart(
                "/tmp/auto-restart-b",
                &command(),
                &initialize_request(),
                Arc::clone(&spawner_b) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink_b,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start workspace b");
        wait_for(&rx_a, &running_status());
        wait_for(
            &rx_b,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        // Crash only workspace A's server. Its supervisor must auto-restart it.
        *held_a.lock().expect("held writer a lock") = None;
        wait_for(
            &rx_a,
            &LanguageServerRuntimeStatus::Running {
                session_id: 3,
                capabilities: LanguageServerCapabilities::default(),
            },
        );

        // Workspace B is completely unaffected by A's crash/restart: it stays on
        // its original session and never receives a spurious status event.
        assert!(held_b.lock().expect("held writer b lock").is_some());
        assert_eq!(
            registry.status("/tmp/auto-restart-b"),
            LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            }
        );
    }

    #[test]
    fn registry_routes_watched_file_changes_to_the_requested_workspace_only() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "workspace/didChangeWatchedFiles".to_string(),
                    params: json!({
                        "changes": [
                            {
                                "uri": "file:///tmp/workspace-b/src/App.ts",
                                "type": 2,
                            },
                        ],
                    }),
                },
            )
            .expect("send workspace b file-change notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "workspace/didChangeWatchedFiles"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "workspace/didChangeWatchedFiles"
                && message["params"]["changes"][0]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
    }

    #[test]
    fn registry_routes_requests_to_the_requested_workspace_only() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        let request_registry = Arc::clone(&registry);
        let request = std::thread::spawn(move || {
            request_registry
                .send_request(
                    "/tmp/workspace-b",
                    "textDocument/hover",
                    json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                        "position": { "line": 1, "character": 4 },
                    }),
                )
                .expect("send workspace b request")
                .expect("workspace b request result")
        });
        let request_id = wait_for_captured_request_id(&capture_b, "textDocument/hover");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/hover"));

        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": { "contents": "workspace b hover" },
            }),
        );

        let result = request.join().expect("request thread");

        assert_eq!(result["contents"], "workspace b hover");
    }

    #[test]
    fn send_request_async_routes_to_requested_workspace_off_thread() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command(),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command(),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        let request_registry = Arc::clone(&registry);
        let request_future = request_registry.send_request_async(
            "/tmp/workspace-b",
            "textDocument/hover",
            json!({
                "textDocument": {
                    "uri": "file:///tmp/workspace-b/src/App.ts",
                },
                "position": { "line": 1, "character": 4 },
            }),
        );
        let request = tauri::async_runtime::spawn(async move {
            request_future
                .await
                .expect("send workspace b request")
                .expect("workspace b request result")
        });
        let request_id = wait_for_captured_request_id(&capture_b, "textDocument/hover");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/hover"));

        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": { "contents": "workspace b hover" },
            }),
        );

        let result = tauri::async_runtime::block_on(request).expect("request join");

        assert_eq!(result["contents"], "workspace b hover");
    }

    #[test]
    fn send_request_async_handles_concurrent_in_flight_requests() {
        let registry = Arc::new(LanguageServerRegistry::new_with_label("Test server"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, _rx) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace",
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start workspace");

        let first_future = registry.send_request_async(
            "/tmp/workspace",
            "textDocument/hover",
            json!({ "marker": "first" }),
        );
        let first = tauri::async_runtime::spawn(async move {
            first_future
                .await
                .expect("first send")
                .expect("first result")
        });
        let second_future = registry.send_request_async(
            "/tmp/workspace",
            "textDocument/definition",
            json!({ "marker": "second" }),
        );
        let second = tauri::async_runtime::spawn(async move {
            second_future
                .await
                .expect("second send")
                .expect("second result")
        });

        let first_id = wait_for_captured_request_id(&capture, "textDocument/hover");
        let second_id = wait_for_captured_request_id(&capture, "textDocument/definition");
        assert_ne!(first_id, second_id);

        // Respond out of order to prove each in-flight request resolves on its
        // own pending channel.
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": second_id,
                "result": { "answer": "second" },
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": first_id,
                "result": { "answer": "first" },
            }),
        );

        let first_result = tauri::async_runtime::block_on(first).expect("first join");
        let second_result = tauri::async_runtime::block_on(second).expect("second join");

        assert_eq!(first_result["answer"], "first");
        assert_eq!(second_result["answer"], "second");
    }

    #[test]
    fn registry_keeps_server_configuration_and_workspace_folders_isolated() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        registry
            .update_server_configuration(
                "/tmp/workspace-b",
                json!({
                    "suggest": {
                        "autoImports": false,
                        "completeFunctionCalls": true,
                    },
                    "validate": {
                        "enable": false,
                    },
                }),
            )
            .expect("update workspace b configuration");

        write_held_message(
            &held_a,
            json!({
                "jsonrpc": "2.0",
                "id": 51,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "typescript.validate" }
                    ]
                }
            }),
        );
        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": 52,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "typescript.validate" }
                    ]
                }
            }),
        );

        let response_a = wait_for_captured_response(&capture_a, 51);
        let response_b = wait_for_captured_response(&capture_b, 52);

        assert_eq!(response_a["result"][0]["autoImports"], true);
        assert_eq!(response_a["result"][0]["completeFunctionCalls"], false);
        assert_eq!(response_a["result"][1]["enable"], true);
        assert_eq!(response_b["result"][0]["autoImports"], false);
        assert_eq!(response_b["result"][0]["completeFunctionCalls"], true);
        assert_eq!(response_b["result"][1]["enable"], false);

        write_held_message(
            &held_a,
            json!({
                "jsonrpc": "2.0",
                "id": 61,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );
        write_held_message(
            &held_b,
            json!({
                "jsonrpc": "2.0",
                "id": 62,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );

        let folders_a = wait_for_captured_response(&capture_a, 61);
        let folders_b = wait_for_captured_response(&capture_b, 62);

        assert_eq!(folders_a["result"][0]["uri"], "file:///tmp/workspace-a");
        assert_eq!(folders_a["result"][0]["name"], "workspace-a");
        assert_eq!(folders_b["result"][0]["uri"], "file:///tmp/workspace-b");
        assert_eq!(folders_b["result"][0]["name"], "workspace-b");
    }

    #[test]
    fn registry_stop_releases_requested_workspace_without_stopping_other_workspace() {
        let registry = LanguageServerRegistry::new_with_label("TypeScript language server");
        let spawner_a = FakeSpawner::new(ready_script(), true);
        let spawner_b = FakeSpawner::new(ready_script(), true);
        let capture_a = Arc::clone(&spawner_a.stdin_capture);
        let capture_b = Arc::clone(&spawner_b.stdin_capture);
        let held_a = Arc::clone(&spawner_a.held_writer);
        let held_b = Arc::clone(&spawner_b.held_writer);
        let (sink_a, _rx_a) = ChannelSink::new();
        let (sink_b, _rx_b) = ChannelSink::new();

        registry
            .start(
                "/tmp/workspace-a",
                &command_for_root("/tmp/workspace-a"),
                &initialize_request(),
                &spawner_a,
                sink_a,
                noop_diagnostics_sink(),
            )
            .expect("start workspace a");
        registry
            .start(
                "/tmp/workspace-b",
                &command_for_root("/tmp/workspace-b"),
                &initialize_request(),
                &spawner_b,
                sink_b,
                noop_diagnostics_sink(),
            )
            .expect("start workspace b");

        assert!(held_a.lock().expect("workspace a writer").is_some());
        assert!(held_b.lock().expect("workspace b writer").is_some());

        assert_eq!(
            registry.stop("/tmp/workspace-a"),
            LanguageServerRuntimeStatus::Stopped
        );

        assert!(held_a.lock().expect("workspace a writer").is_none());
        assert!(held_b.lock().expect("workspace b writer").is_some());
        assert!(matches!(
            registry.status("/tmp/workspace-b"),
            LanguageServerRuntimeStatus::Running { .. }
        ));

        registry
            .send_notification(
                "/tmp/workspace-a",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-a/src/App.ts",
                        },
                    }),
                },
            )
            .expect("stopped workspace notification is ignored");
        registry
            .send_notification(
                "/tmp/workspace-b",
                &JsonRpcNotification {
                    jsonrpc: "2.0".to_string(),
                    method: "textDocument/didSave".to_string(),
                    params: json!({
                        "textDocument": {
                            "uri": "file:///tmp/workspace-b/src/App.ts",
                        },
                    }),
                },
            )
            .expect("send workspace b notification");

        assert!(!captured_messages(&capture_a)
            .iter()
            .any(|message| message["method"] == "textDocument/didSave"));
        assert!(captured_messages(&capture_b).iter().any(|message| {
            message["method"] == "textDocument/didSave"
                && message["params"]["textDocument"]["uri"] == "file:///tmp/workspace-b/src/App.ts"
        }));
    }

    #[test]
    fn initialize_result_capabilities_are_reported_on_running_status() {
        let spawner = FakeSpawner::new(ready_script_with_capabilities(), true);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let status = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(
            status,
            LanguageServerRuntimeStatus::Running {
                session_id: 1,
                capabilities: LanguageServerCapabilities {
                    call_hierarchy: false,
                    code_action: false,
                    code_action_resolve: false,
                    code_lens: false,
                    declaration: true,
                    hover: true,
                    completion: true,
                    definition: true,
                    document_highlight: false,
                    document_link: false,
                    document_symbol: false,
                    document_sync: Default::default(),
                    did_create_files: false,
                    did_delete_files: false,
                    did_rename_files: false,
                    folding_range: false,
                    formatting: false,
                    implementation: true,
                    inlay_hint: false,
                    inlay_hint_resolve: false,
                    linked_editing_range: false,
                    on_type_formatting: false,
                    on_type_formatting_trigger_characters: None,
                    prepare_rename: false,
                    range_formatting: false,
                    references: false,
                    rename: false,
                    selection_range: false,
                    semantic_tokens: false,
                    semantic_tokens_legend: None,
                    signature_help: false,
                    source_definition: false,
                    type_definition: false,
                    type_hierarchy: false,
                    will_create_files: false,
                    will_delete_files: false,
                    will_rename_files: false,
                    workspace_symbol: false,
                },
            }
        );
        wait_for(&rx, &starting_status());
        wait_for(&rx, &status);
    }

    #[test]
    fn runtime_status_serializes_session_id_for_frontend_events() {
        let document_sync = json!({
            "changeKind": "none",
            "openClose": false,
            "save": { "kind": "unsupported" }
        });
        let status = LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities {
                call_hierarchy: true,
                code_action: true,
                code_action_resolve: false,
                code_lens: true,
                declaration: true,
                hover: true,
                completion: false,
                definition: true,
                document_highlight: true,
                document_link: true,
                document_symbol: true,
                document_sync: Default::default(),
                did_create_files: true,
                did_delete_files: true,
                did_rename_files: true,
                folding_range: true,
                formatting: true,
                implementation: false,
                inlay_hint: true,
                inlay_hint_resolve: true,
                linked_editing_range: true,
                on_type_formatting: true,
                on_type_formatting_trigger_characters: Some(vec![
                    "}".to_string(),
                    ";".to_string(),
                    "\n".to_string(),
                ]),
                prepare_rename: true,
                range_formatting: true,
                references: true,
                rename: true,
                selection_range: true,
                semantic_tokens: true,
                semantic_tokens_legend: Some(SemanticTokensLegend {
                    token_types: vec!["decorator".to_string(), "enumMember".to_string()],
                    token_modifiers: vec!["static".to_string(), "async".to_string()],
                }),
                signature_help: true,
                source_definition: true,
                type_definition: true,
                type_hierarchy: true,
                will_create_files: true,
                will_delete_files: true,
                will_rename_files: true,
                workspace_symbol: true,
            },
        };

        let serialized = serde_json::to_value(status).expect("serialize status");
        assert_eq!(serialized["kind"], "running");
        assert_eq!(serialized["sessionId"], 1);
        assert_eq!(serialized["capabilities"]["documentSync"], document_sync);
        assert_eq!(serialized["capabilities"]["completion"], false);
        assert_eq!(
            serialized["capabilities"]["onTypeFormattingTriggerCharacters"],
            json!(["}", ";", "\n"])
        );
        assert_eq!(
            serialized["capabilities"]["semanticTokensLegend"],
            json!({
                "tokenTypes": ["decorator", "enumMember"],
                "tokenModifiers": ["static", "async"],
            })
        );
        assert_eq!(
            serde_json::to_value(LanguageServerRuntimeStatus::Starting { session_id: 2 })
                .expect("serialize starting"),
            json!({
                "kind": "starting",
                "sessionId": 2,
            })
        );
    }

    #[test]
    fn event_payloads_include_workspace_root() {
        assert_eq!(
            super::language_server_status_payload(
                "/tmp/workspace-a",
                LanguageServerRuntimeStatus::Starting { session_id: 8 },
            ),
            json!({
                "kind": "starting",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 8,
            }),
        );
        assert_eq!(
            super::status_event_payload("/tmp/workspace-a", LanguageServerRuntimeStatus::Stopped),
            json!({
                "kind": "stopped",
                "rootPath": "/tmp/workspace-a",
            }),
        );
        let diagnostic_event = LanguageServerDiagnosticEvent {
            diagnostics: Vec::new(),
            projection: LanguageServerDiagnosticProjection::Complete {
                published_count: 0,
                retained_count: 0,
                severity_counts: LanguageServerDiagnosticSeverityCounts::default(),
                retained_utf8_bytes: 2,
            },
            session_id: 7,
            uri: file_uri(Path::new("/tmp/workspace-a/src/App.php")),
            version: Some(3),
        };
        assert_eq!(
            serde_json::to_value(super::diagnostics_event_payload(
                "/tmp/workspace-a",
                &diagnostic_event,
            ))
            .expect("serialize borrowed diagnostics payload"),
            json!({
                "diagnostics": [],
                "projection": {
                    "kind": "complete",
                    "publishedCount": 0,
                    "retainedCount": 0,
                    "severityCounts": {
                        "error": 0,
                        "warning": 0,
                        "information": 0,
                        "hint": 0,
                    },
                    "retainedUtf8Bytes": 2,
                },
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
                "uri": file_uri(Path::new("/tmp/workspace-a/src/App.php")),
                "version": 3,
            }),
        );
        assert_eq!(
            super::refresh_event_payload(
                "/tmp/workspace-a",
                LanguageServerRefreshEvent {
                    feature: LanguageServerRefreshFeature::CodeLens,
                    session_id: 7,
                },
            ),
            json!({
                "feature": "codeLens",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
            }),
        );
        assert_eq!(
            super::workspace_edit_event_payload(
                "/tmp/workspace-a",
                LanguageServerWorkspaceEditEvent {
                    edit: LanguageServerWorkspaceEdit {
                        changes: Default::default(),
                        document_versions: Default::default(),
                        file_operations: Vec::new(),
                    },
                    label: Some("Apply edit".to_string()),
                    session_id: 7,
                },
            ),
            json!({
                "edit": {
                    "changes": {},
                },
                "label": "Apply edit",
                "rootPath": "/tmp/workspace-a",
                "sessionId": 7,
            }),
        );
    }
    #[test]
    fn malformed_initialize_result_reports_crashed_and_errors() {
        let spawner = FakeSpawner::new(malformed_initialize_result_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("malformed initialize result should fail");

        assert!(error.contains("valid server capabilities"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn notification_is_noop_when_server_is_stopped() {
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .send_notification(&JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didSave".to_string(),
                params: json!({}),
            })
            .expect("stopped notification should be ignored");
    }

    #[test]
    fn publish_diagnostics_messages_emit_diagnostic_events() {
        let root = test_workspace_root("diagnostics-inside-root");
        let source_path = root.join("src/User.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        writer
            .write_all(&framed(json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": file_uri(&source_path),
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 1, "character": 2 },
                                "end": { "line": 1, "character": 3 }
                            },
                            "severity": 2,
                            "source": "phpactor",
                            "message": "Possible issue"
                        }
                    ]
                }
            })))
            .expect("write diagnostics");
        drop(held);

        let event = diagnostics_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("diagnostic event");

        assert_eq!(event.session_id, 1);
        assert_eq!(event.uri, file_uri(&source_path));
        assert_eq!(event.diagnostics[0].message, "Possible issue");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn publish_diagnostics_filters_related_information_and_data_outside_session_root() {
        let root = test_workspace_root("diagnostics-related-root");
        let outside = test_workspace_root("diagnostics-related-outside");
        let source_path = root.join("src/User.ts");
        let inside_related_path = root.join("src/Related.ts");
        let outside_related_path = outside.join("src/Secret.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        fs::create_dir_all(inside_related_path.parent().expect("inside related parent"))
            .expect("inside related parent");
        fs::create_dir_all(
            outside_related_path
                .parent()
                .expect("outside related parent"),
        )
        .expect("outside related parent");
        let mixed_case_file_uri = |path: &Path| file_uri(path).replacen("file:", "FiLe:", 1);
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        writer
            .write_all(&framed(json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": file_uri(&source_path),
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 1, "character": 2 },
                                "end": { "line": 1, "character": 3 }
                            },
                            "severity": 2,
                            "source": "tsserver",
                            "message": "Issue with unsafe metadata",
                            "codeDescription": {
                                "href": mixed_case_file_uri(&outside.join("docs/unsafe.html"))
                            },
                            "data": {
                                "uri": mixed_case_file_uri(&outside.join("src/FixTarget.ts"))
                            },
                            "relatedInformation": [
                                {
                                    "location": {
                                        "uri": file_uri(&inside_related_path),
                                        "range": {
                                            "start": { "line": 2, "character": 4 },
                                            "end": { "line": 2, "character": 8 }
                                        }
                                    },
                                    "message": "Inside related info"
                                },
                                {
                                    "location": {
                                        "uri": mixed_case_file_uri(&outside_related_path),
                                        "range": {
                                            "start": { "line": 3, "character": 5 },
                                            "end": { "line": 3, "character": 9 }
                                        }
                                    },
                                    "message": "Outside related info"
                                }
                            ]
                        },
                        {
                            "range": {
                                "start": { "line": 5, "character": 2 },
                                "end": { "line": 5, "character": 3 }
                            },
                            "severity": 3,
                            "source": "tsserver",
                            "message": "Issue with safe metadata",
                            "codeDescription": {
                                "href": "https://typescript.example/docs/safe"
                            },
                            "data": {
                                "file": path_string(&root.join("src/SafeFix.ts"))
                            }
                        }
                    ]
                }
            })))
            .expect("write diagnostics");
        drop(held);

        let event = diagnostics_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("diagnostic event");

        assert_eq!(event.uri, file_uri(&source_path));
        assert_eq!(event.diagnostics.len(), 2);
        assert_eq!(event.diagnostics[0].code_description_href, None);
        assert_eq!(event.diagnostics[0].data, None);
        assert_eq!(event.diagnostics[0].related_information.len(), 1);
        assert_eq!(
            event.diagnostics[0].related_information[0].uri,
            file_uri(&inside_related_path)
        );
        assert_eq!(
            event.diagnostics[1].code_description_href.as_deref(),
            Some("https://typescript.example/docs/safe")
        );
        assert_eq!(
            event.diagnostics[1]
                .data
                .as_ref()
                .and_then(|data| data.get("file")),
            Some(&json!(path_string(&root.join("src/SafeFix.ts"))))
        );
        let retained_utf8_bytes = serde_json::to_vec(&event.diagnostics)
            .expect("serialize filtered diagnostics")
            .len();
        assert!(matches!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                published_count: 2,
                retained_count: 2,
                omitted_count: 0,
                retained_utf8_bytes: projected_bytes,
                ref reasons,
                sanitized_field_count: 3,
                ..
            } if projected_bytes == retained_utf8_bytes
                && reasons == &[LanguageServerDiagnosticProjectionReason::Field]
        ));
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn publish_diagnostics_ignores_file_uris_outside_session_root() {
        let root = test_workspace_root("diagnostics-root");
        let outside = test_workspace_root("diagnostics-outside");
        let sibling = root
            .parent()
            .expect("workspace parent")
            .join(format!("{}-sibling", unique_suffix()));
        fs::create_dir_all(&sibling).expect("sibling root");
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        for uri in [
            file_uri(&outside.join("src/Secret.ts")),
            file_uri(&sibling.join("src/Neighbor.ts")),
        ] {
            writer
                .write_all(&framed(json!({
                    "jsonrpc": "2.0",
                    "method": "textDocument/publishDiagnostics",
                    "params": {
                        "uri": uri,
                        "diagnostics": [
                            {
                                "range": {
                                    "start": { "line": 1, "character": 2 },
                                    "end": { "line": 1, "character": 3 }
                                },
                                "severity": 2,
                                "source": "tsserver",
                                "message": "Outside issue"
                            }
                        ]
                    }
                })))
                .expect("write diagnostics");
        }
        drop(held);

        assert!(diagnostics_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
        fs::remove_dir_all(sibling).expect("cleanup sibling");
    }

    #[test]
    fn stop_ignores_buffered_diagnostics_from_stale_session() {
        let root = test_workspace_root("stop-buffered-diagnostics-root");
        let source_path = root.join("src/User.ts");
        fs::create_dir_all(source_path.parent().expect("source parent")).expect("source parent");
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": file_uri(&source_path),
                "diagnostics": [
                    {
                        "range": {
                            "start": { "line": 1, "character": 2 },
                            "end": { "line": 1, "character": 3 }
                        },
                        "severity": 2,
                        "source": "tsserver",
                        "message": "Stale issue"
                    }
                ]
            }
        })));
        let (sink, status_rx, diagnostics_sink, diagnostics_rx) = ChannelSink::with_diagnostics();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                sink,
                diagnostics_sink,
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(diagnostics_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        fs::remove_dir_all(root).expect("cleanup root");
    }

    #[test]
    fn stop_ignores_buffered_window_messages_from_stale_session() {
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": {
                "type": 3,
                "message": "stale message after stop"
            }
        })));
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(!supervisor.log().contains("stale message after stop"));
    }

    #[test]
    fn workspace_apply_edit_requests_emit_workspace_edit_and_acknowledge_success() {
        let root = test_workspace_root("apply-edit-success");
        let changed_uri = file_uri(&root.join("User.ts"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::channel();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    workspace_edit_sink,
                    Arc::new(NoopRefreshSink),
                ),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 42,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Organize imports",
                    "edit": {
                        "changes": {
                            changed_uri.clone(): [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 4 }
                                    },
                                    "newText": "type"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let event = workspace_edit_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("workspace edit event");

        assert_eq!(event.session_id, 1);
        assert_eq!(event.label.as_deref(), Some("Organize imports"));
        assert_eq!(
            event.edit.changes.get(&changed_uri).expect("changed file")[0].new_text,
            "type"
        );

        let response = wait_for_captured_response(&capture, 42);
        assert_eq!(response["result"]["applied"], true);
    }

    #[test]
    fn workspace_refresh_requests_emit_refresh_events_and_acknowledge() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (refresh_sink, refresh_rx) = ChannelRefreshSink::channel();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_event_sinks(
                &command(),
                &initialize_request(),
                &spawner,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    refresh_sink,
                ),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 46,
                "method": "workspace/codeLens/refresh",
                "params": null
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 47,
                "method": "workspace/inlayHint/refresh",
                "params": null
            }),
        );
        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 48,
                "method": "workspace/semanticTokens/refresh",
                "params": null
            }),
        );

        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("code lens refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::CodeLens,
            }
        );
        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("inlay hint refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::InlayHint,
            }
        );
        assert_eq!(
            refresh_rx
                .recv_timeout(Duration::from_secs(2))
                .expect("semantic tokens refresh"),
            LanguageServerRefreshEvent {
                session_id: 1,
                feature: LanguageServerRefreshFeature::SemanticTokens,
            }
        );
        assert_eq!(
            wait_for_captured_response(&capture, 46)["result"],
            Value::Null
        );
        assert_eq!(
            wait_for_captured_response(&capture, 47)["result"],
            Value::Null
        );
        assert_eq!(
            wait_for_captured_response(&capture, 48)["result"],
            Value::Null
        );
    }

    #[test]
    fn workspace_apply_edit_requests_reject_paths_outside_workspace() {
        let root = test_workspace_root("apply-edit-root");
        let outside_root = test_workspace_root("apply-edit-outside");
        let outside_uri = file_uri(&outside_root.join("Secret.ts"));
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::channel();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    workspace_edit_sink,
                    Arc::new(NoopRefreshSink),
                ),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 43,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Move secret",
                    "edit": {
                        "changes": {
                            outside_uri: [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 0 }
                                    },
                                    "newText": "secret"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 43);
        assert_eq!(response["result"]["applied"], false);
        assert!(response["result"]["failureReason"]
            .as_str()
            .expect("failure reason")
            .contains("outside the workspace root"));
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(200))
            .is_err());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 44,
                "method": "workspace/applyEdit",
                "params": {
                    "label": "Virtual edit",
                    "edit": {
                        "changes": {
                            "untitled:Scratch.ts": [
                                {
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 0 }
                                    },
                                    "newText": "virtual"
                                }
                            ]
                        }
                    }
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 44);
        assert_eq!(response["result"]["applied"], false);
        assert!(response["result"]["failureReason"]
            .as_str()
            .expect("failure reason")
            .contains("file URI"));
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(200))
            .is_err());
    }

    #[test]
    fn stop_ignores_buffered_workspace_apply_edit_from_stale_session() {
        let root = test_workspace_root("stop-buffered-apply-edit-root");
        let changed_uri = file_uri(&root.join("User.ts"));
        let spawner = FakeSpawner::new(ready_script(), true).with_terminate_script(framed(json!({
            "jsonrpc": "2.0",
            "id": 91,
            "method": "workspace/applyEdit",
            "params": {
                "label": "Stale organize imports",
                "edit": {
                    "changes": {
                        changed_uri.clone(): [
                            {
                                "range": {
                                    "start": { "line": 0, "character": 0 },
                                    "end": { "line": 0, "character": 4 }
                                },
                                "newText": "type"
                            }
                        ]
                    }
                }
            }
        })));
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let (workspace_edit_sink, workspace_edit_rx) = ChannelWorkspaceEditSink::channel();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start_with_workspace_edit_sink(
                &command_for_root(path_string(&root).as_str()),
                &initialize_request(),
                &spawner,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    workspace_edit_sink,
                    Arc::new(NoopRefreshSink),
                ),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert!(workspace_edit_rx
            .recv_timeout(Duration::from_millis(150))
            .is_err());
        assert!(!captured_messages(&capture)
            .iter()
            .any(|message| message.get("id").and_then(Value::as_u64) == Some(91)));
        fs::remove_dir_all(root).expect("cleanup root");
    }

    #[test]
    fn workspace_configuration_requests_return_typescript_settings() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();
        let initialize_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({
                "initializationOptions": {
                    "formattingOptions": {
                        "insertSpaces": false,
                        "tabSize": 8
                    },
                    "preferences": {
                        "includeCompletionsForModuleExports": false,
                        "includeInlayFunctionLikeReturnTypeHints": false,
                        "includeInlayParameterNameHints": "none",
                        "importModuleSpecifierEnding": "minimal",
                        "importModuleSpecifierPreference": "project-relative",
                        "mockorCodeLensEnabled": true,
                        "mockorValidationEnabled": false,
                        "preferTypeOnlyAutoImports": true,
                        "quotePreference": "single"
                    }
                }
            }),
        };

        supervisor
            .start(
                &command(),
                &initialize_request,
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 43,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.preferences" },
                        { "section": "javascript.suggest" },
                        { "section": "typescript.inlayHints" },
                        { "section": "typescript.referencesCodeLens" },
                        { "section": "typescript.implementationsCodeLens" },
                        { "section": "typescript.validate" },
                        { "section": "typescript.format" },
                        { "section": "javascript.format" },
                        { "section": "typescript.updateImportsOnFileMove" },
                        { "section": "formattingOptions" },
                        { "section": "typescript.implicitProjectConfiguration" },
                        { "section": "editor" }
                    ]
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 43);

        assert_eq!(
            response["result"][0]["includeCompletionsForModuleExports"],
            false
        );
        assert_eq!(
            response["result"][0]["importModuleSpecifierEnding"],
            "minimal"
        );
        assert_eq!(
            response["result"][0]["importModuleSpecifierPreference"],
            "project-relative"
        );
        assert_eq!(response["result"][0]["preferTypeOnlyAutoImports"], true);
        assert_eq!(response["result"][0]["quotePreference"], "single");
        assert_eq!(response["result"][1]["autoImports"], false);
        assert_eq!(response["result"][1]["completeFunctionCalls"], false);
        assert_eq!(response["result"][2]["parameterNames"]["enabled"], "none");
        assert_eq!(response["result"][3]["enabled"], true);
        assert_eq!(response["result"][3]["showOnAllFunctions"], false);
        assert_eq!(response["result"][4]["enabled"], true);
        assert_eq!(response["result"][5]["enable"], false);
        assert_eq!(response["result"][6]["enable"], true);
        assert_eq!(
            response["result"][6]["insertSpaceAfterCommaDelimiter"],
            true
        );
        assert_eq!(response["result"][7]["semicolons"], "ignore");
        assert_eq!(response["result"][8]["enabled"], "never");
        assert_eq!(response["result"][9]["tabSize"], 8);
        assert_eq!(response["result"][9]["insertSpaces"], false);
        assert_eq!(response["result"][10]["strict"], true);
        assert_eq!(response["result"][10]["module"], 99);
        assert_eq!(response["result"][10]["target"], 11);
        assert_eq!(response["result"][11], json!({}));
    }

    #[test]
    fn workspace_configuration_requests_use_updated_session_settings() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        supervisor
            .update_server_configuration(json!({
                "suggest": {
                    "autoImports": false,
                    "completeFunctionCalls": true,
                },
                "preferences": {
                    "includeCompletionsForModuleExports": false,
                    "importModuleSpecifierEnding": "js",
                    "importModuleSpecifierPreference": "relative",
                    "mockorCodeLensEnabled": true,
                    "preferTypeOnlyAutoImports": true,
                    "quotePreference": "double",
                },
                "formattingOptions": {
                    "insertSpaces": false,
                    "tabSize": 8,
                },
                "referencesCodeLens": {
                    "enabled": true,
                    "showOnAllFunctions": false,
                },
                "updateImportsOnFileMove": {
                    "enabled": "never",
                },
                "validate": {
                    "enable": false,
                },
            }))
            .expect("update configuration");

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 45,
                "method": "workspace/configuration",
                "params": {
                    "items": [
                        { "section": "typescript.suggest" },
                        { "section": "javascript.preferences" },
                        { "section": "typescript.referencesCodeLens" },
                        { "section": "javascript.validate" },
                        { "section": "javascript.updateImportsOnFileMove" },
                        { "section": "formattingOptions" }
                    ]
                }
            }),
        );

        let response = wait_for_captured_response(&capture, 45);

        assert_eq!(response["result"][0]["autoImports"], false);
        assert_eq!(response["result"][0]["completeFunctionCalls"], true);
        assert_eq!(
            response["result"][1]["includeCompletionsForModuleExports"],
            false
        );
        assert_eq!(response["result"][1]["importModuleSpecifierEnding"], "js");
        assert_eq!(
            response["result"][1]["importModuleSpecifierPreference"],
            "relative"
        );
        assert_eq!(response["result"][1]["mockorCodeLensEnabled"], true);
        assert_eq!(response["result"][1]["preferTypeOnlyAutoImports"], true);
        assert_eq!(response["result"][1]["quotePreference"], "double");
        assert_eq!(response["result"][2]["enabled"], true);
        assert_eq!(response["result"][3]["enable"], false);
        assert_eq!(response["result"][4]["enabled"], "never");
        assert_eq!(response["result"][5]["insertSpaces"], false);
        assert_eq!(response["result"][5]["tabSize"], 8);
    }

    #[test]
    fn workspace_folder_requests_return_the_session_root() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, status_rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();
        let command = LanguageServerCommand {
            executable: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/tmp/workspace-a".to_string(),
            env: Vec::new(),
        };

        supervisor
            .start(
                &command,
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&status_rx, &running_status());

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": 44,
                "method": "workspace/workspaceFolders",
                "params": null
            }),
        );

        let response = wait_for_captured_response(&capture, 44);

        assert_eq!(response["result"][0]["uri"], "file:///tmp/workspace-a");
        assert_eq!(response["result"][0]["name"], "workspace-a");
    }

    #[test]
    fn request_response_is_correlated_after_handshake() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor
                .send_request_with_timeout(
                    "textDocument/hover",
                    json!({
                        "textDocument": { "uri": "file:///tmp/User.php" },
                        "position": { "line": 1, "character": 2 },
                    }),
                    Duration::from_secs(2),
                )
                .expect("send request")
                .expect("request result")
        });
        let request_id = wait_for_captured_request_id(&capture, "textDocument/hover");

        write_held_message(
            &held,
            json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "contents": "Hover text",
                },
            }),
        );

        let result = request.join().expect("request thread");
        assert_eq!(result["contents"], "Hover text");
        assert_eq!(supervisor.pending_request_count(), 0);
    }

    #[test]
    fn request_timeout_removes_pending_waiter() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let error = supervisor
            .send_request_with_timeout("textDocument/hover", json!({}), Duration::from_millis(10))
            .expect_err("request should time out");

        assert!(error.to_string().contains("timed out"));
        assert_eq!(supervisor.pending_request_count(), 0);
    }

    #[test]
    fn stop_rejects_pending_request() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let capture = Arc::clone(&spawner.stdin_capture);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        let request_supervisor = Arc::clone(&supervisor);
        let request = std::thread::spawn(move || {
            request_supervisor.send_request_with_timeout(
                "textDocument/definition",
                json!({}),
                Duration::from_secs(2),
            )
        });
        wait_for_captured_request_id(&capture, "textDocument/definition");

        supervisor.stop();

        let error = request
            .join()
            .expect("request thread")
            .expect_err("request should be rejected");
        assert!(error.to_string().contains("stopped"));
    }

    #[test]
    fn rejects_start_when_already_running() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                Arc::clone(&sink) as Arc<dyn StatusSink>,
                noop_diagnostics_sink(),
            )
            .expect("first start");

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("second start should fail");

        assert!(error.contains("already running"));
    }

    #[test]
    fn handshake_failure_reports_crashed_and_errors() {
        let spawner = FakeSpawner::new(Vec::new(), false);
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("start should fail");

        assert!(error.contains("handshake"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn unexpected_crash_auto_restarts_session_and_returns_to_running() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        // Simulate an unexpected crash: drop the server's stdout writer.
        *held.lock().expect("held writer lock") = None;

        // The supervisor should re-spawn for the same workspace and come back up.
        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Running {
                session_id: 2,
                capabilities: LanguageServerCapabilities::default(),
            },
        );
    }

    #[test]
    fn cancellable_backoff_returns_supervisor_when_workspace_stays_open() {
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let weak = Arc::downgrade(&supervisor);

        // A short backoff over a workspace that stays open must run to completion
        // and hand back the live supervisor so the restart can proceed.
        let upgraded =
            cancellable_backoff(&weak, Duration::from_millis(20), Duration::from_millis(5));

        assert!(
            upgraded.is_some(),
            "an open workspace must yield its supervisor after the backoff"
        );
    }

    #[test]
    fn cancellable_backoff_bails_immediately_when_workspace_closes() {
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let weak = Arc::downgrade(&supervisor);

        // Simulate a workspace close (registry stop_all / stop) dropping the only
        // strong reference shortly after the backoff begins.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            drop(supervisor);
        });

        let started = Instant::now();
        // Backoff total is multiple seconds; if cancellation works the call must
        // return promptly after the supervisor is dropped, never near the full delay.
        let upgraded =
            cancellable_backoff(&weak, Duration::from_secs(30), Duration::from_millis(5));
        let elapsed = started.elapsed();

        assert!(
            upgraded.is_none(),
            "a closed workspace must not yield a supervisor to restart"
        );
        assert!(
            elapsed < Duration::from_secs(1),
            "backoff must cancel promptly when the workspace closes, took {elapsed:?}"
        );
    }

    #[test]
    fn legitimate_stop_does_not_trigger_restart() {
        let spawner = Arc::new(FakeSpawner::new(ready_script(), true));
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());

        supervisor
            .start_with_auto_restart(
                &command(),
                &initialize_request(),
                Arc::clone(&spawner) as Arc<dyn ServerProcessSpawner + Send + Sync>,
                LanguageServerEventSinks::new(
                    sink,
                    noop_diagnostics_sink(),
                    Arc::new(NoopWorkspaceEditSink),
                    Arc::new(NoopRefreshSink),
                ),
                test_restart_controller(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        let status = supervisor.stop();

        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        wait_for(&rx, &LanguageServerRuntimeStatus::Stopped);
        // Give any erroneous restart a chance to surface, then confirm stopped.
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn restart_start_kind_aborts_when_session_already_stopped() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();
        let status_sink: Arc<dyn StatusSink> = sink;

        // Simulate a workspace that was stopped after it crashed.
        supervisor.force_status(LanguageServerRuntimeStatus::Stopped);

        let result = supervisor.begin_start(&status_sink, 7, StartKind::Restart);

        assert!(result.is_err());
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn restart_start_kind_proceeds_when_session_still_crashed() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();
        let status_sink: Arc<dyn StatusSink> = sink;

        supervisor.force_status(LanguageServerRuntimeStatus::Crashed {
            message: "boom".to_string(),
        });

        supervisor
            .begin_start(&status_sink, 7, StartKind::Restart)
            .expect("restart should resume a crashed session");

        assert_eq!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Starting { session_id: 7 }
        );
    }

    #[test]
    fn fresh_start_kind_proceeds_from_stopped() {
        let supervisor = LanguageServerSupervisor::new();
        let (sink, _rx) = ChannelSink::new();
        let status_sink: Arc<dyn StatusSink> = sink;

        supervisor.force_status(LanguageServerRuntimeStatus::Stopped);

        supervisor
            .begin_start(&status_sink, 9, StartKind::Fresh)
            .expect("fresh start should proceed from stopped");

        assert_eq!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Starting { session_id: 9 }
        );
    }

    fn test_restart_controller() -> Arc<RestartController> {
        Arc::new(RestartController::new(RestartPolicy::new(
            3,
            Duration::from_secs(60),
            Duration::from_millis(0),
        )))
    }

    #[test]
    fn crash_during_run_emits_crashed_status() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let held = Arc::clone(&spawner.held_writer);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        *held.lock().expect("held writer lock") = None;

        wait_for(
            &rx,
            &LanguageServerRuntimeStatus::Crashed {
                message: "PHPactor exited unexpectedly.".to_string(),
            },
        );
    }

    #[test]
    fn stop_after_running_emits_stopped_without_crash() {
        let spawner = FakeSpawner::new(ready_script(), true);
        let (sink, rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");
        wait_for(&rx, &running_status());

        let status = supervisor.stop();

        assert_eq!(status, LanguageServerRuntimeStatus::Stopped);
        wait_for(&rx, &LanguageServerRuntimeStatus::Stopped);
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn running_session_keeps_stdin_open_until_stop() {
        let dropped = Arc::new(AtomicUsize::new(0));
        let spawner = FakeSpawner::with_stdin(
            ready_script(),
            true,
            Box::new(DropCountingWriter {
                dropped: Arc::clone(&dropped),
                writes: Arc::new(Mutex::new(Vec::new())),
            }),
        );
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect("start");

        assert_eq!(dropped.load(Ordering::SeqCst), 0);

        supervisor.stop();

        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stop_during_handshake_interrupts_start_without_crash() {
        let spawner = Arc::new(FakeSpawner::new(Vec::new(), true));
        let (sink, rx) = ChannelSink::new();
        let supervisor = Arc::new(LanguageServerSupervisor::new());
        let start_supervisor = Arc::clone(&supervisor);
        let start_sink = Arc::clone(&sink);
        let start_spawner = Arc::clone(&spawner);

        let start = std::thread::spawn(move || {
            start_supervisor
                .start(
                    &command(),
                    &initialize_request(),
                    start_spawner.as_ref(),
                    start_sink,
                    noop_diagnostics_sink(),
                )
                .expect("start should stop cleanly")
        });

        wait_for(&rx, &starting_status());

        assert_eq!(supervisor.stop(), LanguageServerRuntimeStatus::Stopped);
        assert_eq!(
            start.join().expect("start thread"),
            LanguageServerRuntimeStatus::Stopped
        );
        assert_eq!(supervisor.status(), LanguageServerRuntimeStatus::Stopped);
    }

    #[test]
    fn spawn_failure_reports_crashed_status() {
        let spawner = FailingSpawner;
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("spawn should fail");

        assert!(error.contains("Failed to start PHPactor"));
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn initialized_write_failure_kills_process_and_reports_crashed_status() {
        let spawner =
            FakeSpawner::with_stdin(ready_script(), true, Box::new(FailingOnInitializedWriter));
        let (sink, _rx) = ChannelSink::new();
        let supervisor = LanguageServerSupervisor::new();

        let error = supervisor
            .start(
                &command(),
                &initialize_request(),
                &spawner,
                sink,
                noop_diagnostics_sink(),
            )
            .expect_err("initialized write should fail");

        assert!(error.contains("initialized"));
        assert!(spawner.held_writer.lock().expect("held writer").is_none());
        assert!(matches!(
            supervisor.status(),
            LanguageServerRuntimeStatus::Crashed { .. }
        ));
    }

    #[test]
    fn restart_policy_allows_restart_for_unexpected_crash_within_limit() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        assert!(policy.should_restart(now));
    }

    #[test]
    fn restart_policy_never_restarts_after_requested_shutdown() {
        let policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));

        assert!(!RestartDecision::for_shutdown(&policy));
    }

    #[test]
    fn restart_policy_stops_after_max_attempts_within_window() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        for _ in 0..3 {
            assert!(policy.should_restart(now));
            policy.record_attempt(now);
        }

        assert!(!policy.should_restart(now));
    }

    #[test]
    fn restart_policy_uses_exponential_backoff_per_attempt() {
        let policy = RestartPolicy::new(4, Duration::from_secs(60), Duration::from_secs(1));

        assert_eq!(policy.backoff_delay(0), Duration::from_secs(1));
        assert_eq!(policy.backoff_delay(1), Duration::from_secs(2));
        assert_eq!(policy.backoff_delay(2), Duration::from_secs(4));
    }

    #[test]
    fn restart_policy_caps_backoff_at_thirty_seconds() {
        let policy = RestartPolicy::new(20, Duration::from_secs(600), Duration::from_secs(1));

        assert_eq!(policy.backoff_delay(10), Duration::from_secs(30));
    }

    #[test]
    fn restart_policy_clamps_large_attempt_index_to_cap_not_zero() {
        let policy = RestartPolicy::new(100, Duration::from_secs(600), Duration::from_secs(1));

        // Indices that would truncate a u32 shift must still clamp to the cap.
        assert_eq!(policy.backoff_delay(40), Duration::from_secs(30));
        assert_eq!(policy.backoff_delay(64), Duration::from_secs(30));
        assert_eq!(policy.backoff_delay(1000), Duration::from_secs(30));
    }

    #[test]
    fn restart_policy_forgets_attempts_outside_the_window() {
        let mut policy = RestartPolicy::new(2, Duration::from_secs(60), Duration::from_secs(1));
        let start = Instant::now();

        policy.record_attempt(start);
        policy.record_attempt(start);
        assert!(!policy.should_restart(start));

        let later = start + Duration::from_secs(61);
        assert!(policy.should_restart(later));
    }

    #[test]
    fn restart_policy_reset_clears_attempt_history() {
        let mut policy = RestartPolicy::new(2, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        policy.record_attempt(now);
        policy.record_attempt(now);
        assert!(!policy.should_restart(now));

        policy.reset();

        assert!(policy.should_restart(now));
    }

    #[test]
    fn restart_policy_next_attempt_index_grows_within_window_and_resets() {
        let mut policy = RestartPolicy::new(3, Duration::from_secs(60), Duration::from_secs(1));
        let now = Instant::now();

        assert_eq!(policy.next_attempt_index(now), 0);
        policy.record_attempt(now);
        assert_eq!(policy.next_attempt_index(now), 1);
        policy.record_attempt(now);
        assert_eq!(policy.next_attempt_index(now), 2);

        policy.reset();
        assert_eq!(policy.next_attempt_index(now), 0);
    }

    #[test]
    fn restart_controller_decides_restart_only_for_unexpected_crash() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
    }

    #[test]
    fn restart_controller_does_not_restart_when_shutdown_requested() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(true),
            RestartOutcome::GiveUp
        ));
    }

    #[test]
    fn restart_controller_gives_up_after_exhausting_attempts() {
        let controller = RestartController::new(RestartPolicy::new(
            2,
            Duration::from_secs(60),
            Duration::from_secs(1),
        ));

        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::Restart { .. }
        ));
        assert!(matches!(
            controller.evaluate_crash(false),
            RestartOutcome::GiveUp
        ));
    }

    fn initialize_request() -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({}),
        }
    }

    fn command() -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "phpactor".to_string(),
            args: vec!["language-server".to_string()],
            working_directory: ".".to_string(),
            env: Vec::new(),
        }
    }

    fn phpactor_managed_command() -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "/usr/bin/php".to_string(),
            args: vec![
                "-n".to_string(),
                "-c".to_string(),
                "/managed/codevo-php.ini".to_string(),
                "/Users/dev/Library/Application Support/Codevo Editor/tools/phpactor/vendor/bin/phpactor"
                    .to_string(),
                "language-server".to_string(),
            ],
            working_directory: ".".to_string(),
            env: vec![
                ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
                (
                    "PHP_INI_SCAN_DIR".to_string(),
                    "/managed/empty-php-conf.d".to_string(),
                ),
            ],
        }
    }

    fn command_for_root(root_path: &str) -> LanguageServerCommand {
        LanguageServerCommand {
            executable: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: root_path.to_string(),
            env: Vec::new(),
        }
    }

    fn test_workspace_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{unique}"));
        fs::create_dir_all(&root).expect("workspace root");
        root
    }

    fn ready_script() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} },
        }))
    }

    fn ready_script_with_capabilities() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "capabilities": {
                    "hoverProvider": true,
                    "completionProvider": { "triggerCharacters": [">"] },
                    "declarationProvider": true,
                    "definitionProvider": true,
                    "implementationProvider": true,
                }
            },
        }))
    }

    fn malformed_initialize_result_script() -> Vec<u8> {
        framed(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {},
        }))
    }

    fn framed(value: Value) -> Vec<u8> {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &serde_json::to_vec(&value).unwrap()).unwrap();
        buffer
    }

    fn wait_for(rx: &Receiver<LanguageServerRuntimeStatus>, target: &LanguageServerRuntimeStatus) {
        let deadline = Duration::from_secs(2);

        loop {
            let status = rx
                .recv_timeout(deadline)
                .unwrap_or_else(|_| panic!("expected status {target:?}"));

            if &status == target {
                return;
            }
        }
    }

    fn wait_for_log(supervisor: &LanguageServerSupervisor, needle: &str) {
        let deadline = Instant::now() + Duration::from_secs(2);

        while Instant::now() < deadline {
            if supervisor.log().contains(needle) {
                return;
            }

            std::thread::sleep(Duration::from_millis(10));
        }

        panic!("expected runtime log to contain {needle:?}");
    }

    fn wait_for_captured_request_id(capture: &Arc<Mutex<Vec<u8>>>, method: &str) -> u64 {
        let deadline = Instant::now() + Duration::from_secs(2);

        loop {
            for value in captured_messages(capture) {
                if value["method"] == method {
                    return value["id"].as_u64().expect("request id");
                }
            }

            if Instant::now() >= deadline {
                panic!("expected captured request {method}");
            }

            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_captured_response(capture: &Arc<Mutex<Vec<u8>>>, id: u64) -> Value {
        let deadline = Instant::now() + Duration::from_secs(2);

        loop {
            for value in captured_messages(capture) {
                if value.get("id").and_then(Value::as_u64) == Some(id)
                    && value.get("result").is_some()
                {
                    return value;
                }
            }

            if Instant::now() >= deadline {
                panic!("expected captured response {id}");
            }

            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn captured_messages(capture: &Arc<Mutex<Vec<u8>>>) -> Vec<Value> {
        let buffer = capture.lock().expect("capture lock").clone();
        let mut reader = std::io::Cursor::new(buffer);
        let mut messages = Vec::new();

        while let Ok(Some(bytes)) = read_message(&mut reader) {
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                messages.push(value);
            }
        }

        messages
    }

    fn write_held_message(held: &Arc<Mutex<Option<PipeWriter>>>, value: Value) {
        let mut held = held.lock().expect("held writer lock");
        let writer = held.as_mut().expect("held writer");
        writer
            .write_all(&framed(value))
            .expect("write held message");
    }

    fn starting_status() -> LanguageServerRuntimeStatus {
        LanguageServerRuntimeStatus::Starting { session_id: 1 }
    }

    fn running_status() -> LanguageServerRuntimeStatus {
        LanguageServerRuntimeStatus::Running {
            session_id: 1,
            capabilities: LanguageServerCapabilities::default(),
        }
    }

    fn noop_diagnostics_sink() -> Arc<dyn DiagnosticsSink> {
        Arc::new(NoopDiagnosticsSink)
    }

    #[derive(Clone)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().expect("capture lock").extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct DropCountingWriter {
        dropped: Arc<AtomicUsize>,
        writes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for DropCountingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.writes
                .lock()
                .expect("drop counting writer lock")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Drop for DropCountingWriter {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct FakeSpawner {
        auto_close_after: Option<Duration>,
        stderr_script: Vec<u8>,
        stdin_capture: Arc<Mutex<Vec<u8>>>,
        stdin: Arc<Mutex<Option<Arc<SessionMessageWriter>>>>,
        script: Vec<u8>,
        terminate_script: Vec<u8>,
        terminate_count: Arc<AtomicUsize>,
        held_writer: Arc<Mutex<Option<PipeWriter>>>,
        keep_open: bool,
    }

    impl FakeSpawner {
        fn new(script: Vec<u8>, keep_open: bool) -> Self {
            Self {
                auto_close_after: None,
                stderr_script: Vec::new(),
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(None)),
                script,
                terminate_script: Vec::new(),
                terminate_count: Arc::new(AtomicUsize::new(0)),
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stdin(script: Vec<u8>, keep_open: bool, stdin: Box<dyn Write + Send>) -> Self {
            Self::with_session_stdin(script, keep_open, SessionMessageWriter::from_direct(stdin))
        }

        fn with_session_stdin(
            script: Vec<u8>,
            keep_open: bool,
            stdin: Arc<SessionMessageWriter>,
        ) -> Self {
            Self {
                auto_close_after: None,
                stderr_script: Vec::new(),
                stdin_capture: Arc::new(Mutex::new(Vec::new())),
                stdin: Arc::new(Mutex::new(Some(stdin))),
                script,
                terminate_script: Vec::new(),
                terminate_count: Arc::new(AtomicUsize::new(0)),
                held_writer: Arc::new(Mutex::new(None)),
                keep_open,
            }
        }

        fn with_stderr(mut self, stderr_script: Vec<u8>) -> Self {
            self.stderr_script = stderr_script;
            self
        }

        fn with_auto_close_after(mut self, delay: Duration) -> Self {
            self.auto_close_after = Some(delay);
            self
        }

        fn with_terminate_script(mut self, terminate_script: Vec<u8>) -> Self {
            self.terminate_script = terminate_script;
            self
        }
    }

    impl ServerProcessSpawner for FakeSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            let (reader, mut writer) = std::io::pipe()?;
            writer.write_all(&self.script)?;
            let stderr = if self.stderr_script.is_empty() {
                None
            } else {
                let (stderr_reader, mut stderr_writer) = std::io::pipe()?;
                stderr_writer.write_all(&self.stderr_script)?;
                drop(stderr_writer);
                Some(Box::new(stderr_reader) as Box<dyn std::io::Read + Send>)
            };

            if self.keep_open || self.auto_close_after.is_some() {
                *self.held_writer.lock().expect("held writer lock") = Some(writer);
            }
            if let Some(delay) = self.auto_close_after {
                let held_writer = Arc::clone(&self.held_writer);
                std::thread::spawn(move || {
                    std::thread::sleep(delay);
                    let _ = held_writer.lock().expect("held writer lock").take();
                });
            }

            let stdin = self
                .stdin
                .lock()
                .expect("stdin lock")
                .take()
                .unwrap_or_else(|| {
                    SessionMessageWriter::from_direct(Box::new(SharedWriter(Arc::clone(
                        &self.stdin_capture,
                    ))))
                });
            Ok(SpawnedServer {
                stderr,
                stdin,
                stdout: Box::new(reader),
                killer: Box::new(FakeKiller {
                    held: Arc::clone(&self.held_writer),
                    terminate_script: self.terminate_script.clone(),
                    terminate_count: Arc::clone(&self.terminate_count),
                }),
            })
        }
    }

    struct FakeKiller {
        held: Arc<Mutex<Option<PipeWriter>>>,
        terminate_script: Vec<u8>,
        terminate_count: Arc<AtomicUsize>,
    }

    impl ProcessKiller for FakeKiller {
        fn terminate(&mut self) -> io::Result<()> {
            self.terminate_count.fetch_add(1, Ordering::SeqCst);
            let mut writer = self.held.lock().expect("held writer lock").take();

            if let Some(writer) = writer.as_mut() {
                writer.write_all(&self.terminate_script)?;
            }

            Ok(())
        }
    }

    struct FailingSpawner;

    impl ServerProcessSpawner for FailingSpawner {
        fn spawn(&self, _command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
            Err(io::Error::new(io::ErrorKind::NotFound, "missing phpactor"))
        }
    }

    struct FailingOnInitializedWriter;

    impl Write for FailingOnInitializedWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if String::from_utf8_lossy(buf).contains("initialized") {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "initialized write failed",
                ));
            }

            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct ChannelSink {
        tx: Mutex<Sender<LanguageServerRuntimeStatus>>,
    }

    impl ChannelSink {
        fn new() -> (Arc<Self>, Receiver<LanguageServerRuntimeStatus>) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }

        fn with_diagnostics() -> (
            Arc<Self>,
            Receiver<LanguageServerRuntimeStatus>,
            Arc<dyn DiagnosticsSink>,
            Receiver<LanguageServerDiagnosticEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            let (diagnostics_sink, diagnostics_rx) = ChannelDiagnosticsSink::channel();
            (
                Arc::new(Self { tx: Mutex::new(tx) }),
                rx,
                diagnostics_sink,
                diagnostics_rx,
            )
        }
    }

    impl StatusSink for ChannelSink {
        fn emit_status(&self, status: LanguageServerRuntimeStatus) {
            let _ = self.tx.lock().expect("sink lock").send(status);
        }
    }

    struct ChannelDiagnosticsSink {
        tx: Mutex<Sender<LanguageServerDiagnosticEvent>>,
    }

    impl ChannelDiagnosticsSink {
        fn channel() -> (
            Arc<dyn DiagnosticsSink>,
            Receiver<LanguageServerDiagnosticEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl DiagnosticsSink for ChannelDiagnosticsSink {
        fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent) {
            let _ = self.tx.lock().expect("diagnostics sink lock").send(event);
        }
    }

    struct ChannelWorkspaceEditSink {
        tx: Mutex<Sender<LanguageServerWorkspaceEditEvent>>,
    }

    impl ChannelWorkspaceEditSink {
        fn channel() -> (
            Arc<dyn WorkspaceEditSink>,
            Receiver<LanguageServerWorkspaceEditEvent>,
        ) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl WorkspaceEditSink for ChannelWorkspaceEditSink {
        fn emit_workspace_edit(&self, event: LanguageServerWorkspaceEditEvent) -> bool {
            self.tx
                .lock()
                .expect("workspace edit sink lock")
                .send(event)
                .is_ok()
        }
    }

    struct ChannelRefreshSink {
        tx: Mutex<Sender<LanguageServerRefreshEvent>>,
    }

    impl ChannelRefreshSink {
        fn channel() -> (Arc<dyn RefreshSink>, Receiver<LanguageServerRefreshEvent>) {
            let (tx, rx) = mpsc::channel();
            (Arc::new(Self { tx: Mutex::new(tx) }), rx)
        }
    }

    impl RefreshSink for ChannelRefreshSink {
        fn emit_refresh(&self, event: LanguageServerRefreshEvent) -> bool {
            self.tx
                .lock()
                .expect("refresh sink lock")
                .send(event)
                .is_ok()
        }
    }

    struct NoopDiagnosticsSink;

    impl DiagnosticsSink for NoopDiagnosticsSink {
        fn emit_diagnostics(&self, _event: LanguageServerDiagnosticEvent) {
            // no-op for status-only tests
        }
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = temp_path(label);
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical temp workspace")
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("editor-lsp-{label}-{}", unique_suffix()))
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    fn _unique_label(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        format!("{prefix}-{nanos}")
    }
}
