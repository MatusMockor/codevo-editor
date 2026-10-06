use super::{
    codex_task_composition::CodexProviderHostLifecycle, ensure_workspace_id_bounds,
    StartAgentTaskRequest,
};
use crate::agent_task_spawner::{
    agent_launch::AgentLaunchOptions,
    agent_provider::runtime::{AgentProviderHostLifecycle, AgentProviderRuntimeRegistry},
    claude_session_policy::{
        ClaudeSessionBackgroundTasksEvent, ClaudeSessionBackgroundTurnEvent,
        ClaudeSessionEndReason, ClaudeSessionEndedEvent, ClaudeSessionInspection, ClaudeSessionKey,
    },
    claude_session_registry::{
        ClaudeSessionEventSink, ClaudeSessionRegistry, ClaudeSessionRequest,
    },
    claude_session_task_stop::{valid_stoppable_task_id, ClaudeBackgroundTaskStopOutcome},
    claude_session_turn::{session_fingerprint, ClaudeSessionAuthority, ClaudeSessionTurnPlan},
    validate_resume_session_id, AgentCliInvocation, AgentTaskSpawnPlan,
};
use crate::agent_task_supervisor::{
    agent_task_interrupt::AgentTaskInterruptOutcome, AgentTaskRegistry,
};
use crate::git_worktree::safe_agent_task_id;
use crate::run_blocking_command;
use crate::workspace_registry::WorkspaceId;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Weak},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Wry};

pub(crate) const AGENT_SESSION_ENDED_EVENT_CHANNEL: &str = "agent-session://ended";
pub(crate) const AGENT_SESSION_BACKGROUND_TURN_EVENT_CHANNEL: &str =
    "agent-session://background-turn";
pub(crate) const AGENT_SESSION_BACKGROUND_TASKS_EVENT_CHANNEL: &str =
    "agent-session://background-tasks";
pub(crate) const CLAUDE_SESSION_IDLE_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
const WORKTREE_SESSION_REAP_TIMEOUT: Duration = Duration::from_secs(5);
const BACKGROUND_TASK_STOP_DEADLINE: Duration = Duration::from_secs(5);
const INVALID_BACKGROUND_TASK_ID_ERROR: &str = "Invalid Claude background task id.";

pub(super) fn prepare_transport(
    plan: AgentTaskSpawnPlan,
    request: &StartAgentTaskRequest,
    repository_root: &Path,
    sessions: &Arc<ClaudeSessionRegistry>,
    validate_authority: ClaudeSessionAuthority,
) -> AgentTaskSpawnPlan {
    if !cfg!(unix)
        || request.agent_cli_kind != AgentCliInvocation::ClaudeCode
        || plan.stdin_frame_bytes().is_none()
    {
        return plan;
    }
    let session_request = ClaudeSessionRequest {
        key: ClaudeSessionKey {
            workspace_id: request.workspace_id.as_str().to_string(),
            thread_id: request.thread_id.clone(),
        },
        repository_root: repository_root.to_path_buf(),
        fingerprint: session_fingerprint(&plan, request.launch, request.provider_generation),
        resume_session_id: request.resume_session_id.clone(),
        restart: request.session_restart,
    };
    plan.with_claude_session(ClaudeSessionTurnPlan::new(
        Arc::clone(sessions),
        session_request,
        validate_authority,
    ))
}

pub(crate) struct AppHandleClaudeSessionEvents<R: Runtime = Wry>(pub(crate) AppHandle<R>);

impl<R: Runtime> ClaudeSessionEventSink for AppHandleClaudeSessionEvents<R> {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        let _ = self.0.emit(AGENT_SESSION_ENDED_EVENT_CHANNEL, event);
    }

    fn background_turn(&self, event: ClaudeSessionBackgroundTurnEvent) {
        let _ = self
            .0
            .emit(AGENT_SESSION_BACKGROUND_TURN_EVENT_CHANNEL, event);
    }

    fn background_tasks(&self, event: ClaudeSessionBackgroundTasksEvent) {
        let _ = self
            .0
            .emit(AGENT_SESSION_BACKGROUND_TASKS_EVENT_CHANNEL, event);
    }
}

pub(crate) struct AgentProviderHostLifecycles {
    pub(crate) codex: CodexProviderHostLifecycle,
    pub(crate) claude: Arc<ClaudeSessionRegistry>,
}

impl AgentProviderHostLifecycle for AgentProviderHostLifecycles {
    fn retire_idle_hosts(&self, provider: AgentCliInvocation) -> Result<(), String> {
        self.codex.retire_idle_hosts(provider)?;
        if provider == AgentCliInvocation::ClaudeCode {
            self.claude.retire_idle_for_update();
        }
        Ok(())
    }
}

pub(crate) fn spawn_idle_session_retirement(
    sessions: Weak<ClaudeSessionRegistry>,
    interval: Duration,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            let Some(registry) = sessions.upgrade() else {
                break;
            };
            let _ =
                tauri::async_runtime::spawn_blocking(move || registry.retire_idle(Instant::now()))
                    .await;
        }
    });
}

pub(crate) fn end_sessions_for_root<R: Runtime>(
    app: &AppHandle<R>,
    workspace_id: Option<&str>,
    root: &Path,
) {
    let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() else {
        return;
    };
    sessions.end_for_root(workspace_id, root, ClaudeSessionEndReason::Released);
}

pub(crate) fn end_sessions_for_workspace<R: Runtime>(app: &AppHandle<R>, workspace_id: &str) {
    let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() else {
        return;
    };
    sessions.end_for_workspace(workspace_id, ClaudeSessionEndReason::Released);
}

pub(crate) fn end_sessions_on_root_dispose<R: Runtime>(
    app: &AppHandle<R>,
    workspace_id: Option<&str>,
    root: &Path,
) {
    end_sessions_for_root(app, None, root);
    let Some(workspace_id) = workspace_id else {
        return;
    };
    end_sessions_for_workspace(app, workspace_id);
}

pub(crate) fn reap_sessions_in_worktree<R: Runtime>(app: &AppHandle<R>, worktree: &Path) -> bool {
    let Some(sessions) = app.try_state::<Arc<ClaudeSessionRegistry>>() else {
        return true;
    };
    sessions.end_for_root_and_reap(worktree, WORKTREE_SESSION_REAP_TIMEOUT)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InterruptAgentTaskRequest {
    task_id: String,
    workspace_id: WorkspaceId,
    thread_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentThreadSessionRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InspectAgentThreadSessionRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    resume_session_id: Option<String>,
    launch: AgentLaunchOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StopAgentBackgroundTaskRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    task_id: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndAgentThreadSessionResult {
    ended: bool,
}

#[tauri::command]
pub(crate) async fn interrupt_agent_task(
    app: AppHandle,
    request: InterruptAgentTaskRequest,
) -> Result<AgentTaskInterruptOutcome, String> {
    let task_id = safe_agent_task_id(&request.task_id)?;
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    run_blocking_command(move || {
        Ok(app.state::<AgentTaskRegistry>().interrupt_for_thread(
            &task_id,
            request.workspace_id.as_str(),
            &thread_id,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_agent_thread_session(
    request: InspectAgentThreadSessionRequest,
    sessions: State<'_, Arc<ClaudeSessionRegistry>>,
    providers: State<'_, Arc<AgentProviderRuntimeRegistry>>,
) -> Result<ClaudeSessionInspection, String> {
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    if let Some(candidate) = request.resume_session_id.as_deref() {
        validate_resume_session_id(candidate)?;
    }
    if !matches!(request.launch, AgentLaunchOptions::ClaudeCode { .. }) {
        return Ok(ClaudeSessionInspection::None);
    }
    let sessions = Arc::clone(&sessions);
    let providers = Arc::clone(&providers);
    run_blocking_command(move || {
        let Some((_, receipt)) = providers.policy_snapshot(AgentCliInvocation::ClaudeCode) else {
            return Ok(ClaudeSessionInspection::None);
        };
        Ok(sessions.inspect(
            request.workspace_id.as_str(),
            &thread_id,
            &request.launch,
            request.resume_session_id.as_deref(),
            receipt.provider_generation,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn end_agent_thread_session(
    request: AgentThreadSessionRequest,
    sessions: State<'_, Arc<ClaudeSessionRegistry>>,
) -> Result<EndAgentThreadSessionResult, String> {
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    let sessions = Arc::clone(&sessions);
    run_blocking_command(move || {
        Ok(EndAgentThreadSessionResult {
            ended: sessions.end_for_thread(
                request.workspace_id.as_str(),
                &thread_id,
                ClaudeSessionEndReason::ThreadEnded,
            ),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn stop_agent_background_task(
    request: StopAgentBackgroundTaskRequest,
    sessions: State<'_, Arc<ClaudeSessionRegistry>>,
) -> Result<ClaudeBackgroundTaskStopOutcome, String> {
    let thread_id = safe_agent_task_id(&request.thread_id)?;
    ensure_workspace_id_bounds(&request.workspace_id)?;
    if !valid_stoppable_task_id(&request.task_id) {
        return Err(INVALID_BACKGROUND_TASK_ID_ERROR.to_string());
    }
    let sessions = Arc::clone(&sessions);
    run_blocking_command(move || {
        Ok(sessions.stop_background_task(
            request.workspace_id.as_str(),
            &thread_id,
            &request.task_id,
            Instant::now() + BACKGROUND_TASK_STOP_DEADLINE,
        ))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_task_spawner::claude_session_policy::{
        ClaudeSessionBackgroundReply, ClaudeSessionBackgroundTask, ClaudeSessionBackgroundTaskType,
        ClaudeSessionRestartPolicy, ClaudeSessionTuning,
    };
    use crate::agent_task_spawner::claude_session_registry::ClaudeSessionLease;
    use crate::agent_task_spawner::claude_thread_session::{ClaudeThreadSession, TurnOutcome};
    use crate::agent_task_spawner::claude_user_frame;
    use crate::agent_task_spawner::codex_app_server_host::CodexAppServerHostRegistry;
    use crate::agent_task_supervisor::system_process_group_signals;
    use serde_json::json;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::test::MockRuntime;
    use tauri::Listener;

    const EVENT_WAIT: Duration = Duration::from_secs(10);

    struct NoEvents;

    impl ClaudeSessionEventSink for NoEvents {
        fn ended(&self, _event: ClaudeSessionEndedEvent) {}

        fn background_turn(&self, _event: ClaudeSessionBackgroundTurnEvent) {}

        fn background_tasks(&self, _event: ClaudeSessionBackgroundTasksEvent) {}
    }

    fn start_request(extra: serde_json::Value) -> Result<StartAgentTaskRequest, serde_json::Error> {
        let mut value = json!({
            "taskId": "agt-1-0a1b",
            "workspaceId": "ws-1",
            "projectRoot": "/repo",
            "repositoryRoot": "/repo",
            "cwd": "/repo",
            "isolation": "in-place",
            "prompt": "hi",
            "agentCliKind": "claudeCode",
            "resumeSessionId": null,
            "launch": serde_json::to_value(AgentLaunchOptions::default()).expect("launch"),
            "providerGeneration": 1,
            "threadId": "agt-1-0a1c"
        });
        if let (Some(target), Some(extra)) = (value.as_object_mut(), extra.as_object()) {
            target.extend(extra.clone());
        }
        serde_json::from_value(value)
    }

    fn registry() -> Arc<ClaudeSessionRegistry> {
        Arc::new(ClaudeSessionRegistry::new(
            system_process_group_signals(),
            Arc::new(NoEvents),
        ))
    }

    fn plan_at(cwd: &Path) -> AgentTaskSpawnPlan {
        AgentTaskSpawnPlan::for_tests(
            std::env::current_exe().expect("test binary"),
            vec!["-p".to_string()],
            cwd.to_path_buf(),
            Vec::new(),
        )
    }

    fn plan() -> AgentTaskSpawnPlan {
        plan_at(Path::new("/repo"))
    }

    fn accept_authority() -> ClaudeSessionAuthority {
        Arc::new(|| Ok(()))
    }

    fn mock_app(
        tuning: ClaudeSessionTuning,
    ) -> (tauri::App<MockRuntime>, Arc<ClaudeSessionRegistry>) {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app");
        let sessions = Arc::new(ClaudeSessionRegistry::with_tuning(
            system_process_group_signals(),
            Arc::new(AppHandleClaudeSessionEvents(app.handle().clone())),
            tuning,
        ));
        app.manage(Arc::clone(&sessions));
        (app, sessions)
    }

    fn listen(app: &tauri::App<MockRuntime>, channel: &'static str) -> mpsc::Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        app.listen_any(channel, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        receiver
    }

    fn ended_payload(receiver: &mpsc::Receiver<String>) -> serde_json::Value {
        let payload = receiver.recv_timeout(EVENT_WAIT).expect("ended event");
        serde_json::from_str(&payload).expect("ended json")
    }

    #[cfg(unix)]
    const SETTLING_FAKE_CLAUDE: &str = r#"
import json, sys
def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()
for raw in sys.stdin:
    frame = json.loads(raw)
    if frame.get("type") != "user":
        continue
    uid = frame.get("uuid", "")
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": "queued"})
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": "started"})
    emit({"type": "system", "subtype": "init", "session_id": "sess-fixture-composition"})
    emit({"type": "result", "subtype": "success", "is_error": False, "num_turns": 1, "result": "ok",
          "session_id": "sess-fixture-composition", "user_message_uuid": uid,
          "user_message_uuids": [uid], "total_cost_usd": 0.01})
    emit({"type": "command_lifecycle", "command_uuid": uid, "state": "completed"})
"#;

    #[cfg(unix)]
    fn acquire_session(
        sessions: &ClaudeSessionRegistry,
        key: (&str, &str),
        root: &Path,
        argv: &[&str],
    ) -> Arc<ClaudeThreadSession> {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let request = ClaudeSessionRequest {
            key: ClaudeSessionKey {
                workspace_id: key.0.to_string(),
                thread_id: key.1.to_string(),
            },
            repository_root: root.to_path_buf(),
            fingerprint: session_fingerprint(&plan_at(root), AgentLaunchOptions::default(), 1),
            resume_session_id: None,
            restart: ClaudeSessionRestartPolicy::RefuseIfBackground,
        };
        let lease = sessions
            .acquire(&request, || {
                let child = Command::new(argv[0])
                    .args(&argv[1..])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .process_group(0)
                    .spawn()
                    .map_err(|error| error.to_string())?;
                let process_group_id =
                    i32::try_from(child.id()).map_err(|error| error.to_string())?;
                Ok((child, process_group_id))
            })
            .expect("acquire session");
        let session = match lease {
            ClaudeSessionLease::Session(session) => Some(session),
            ClaudeSessionLease::Ephemeral => None,
        };
        session.expect("expected a live session, not an ephemeral lease")
    }

    #[cfg(unix)]
    fn start_unattached_session(
        sessions: &ClaudeSessionRegistry,
        workspace_id: &str,
        thread_id: &str,
        root: &Path,
    ) {
        acquire_session(
            sessions,
            (workspace_id, thread_id),
            root,
            &["/bin/sleep", "30"],
        );
    }

    #[cfg(unix)]
    fn start_settled_session(
        sessions: &ClaudeSessionRegistry,
        workspace_id: &str,
        thread_id: &str,
    ) {
        let session = acquire_session(
            sessions,
            (workspace_id, thread_id),
            Path::new("/repo"),
            &[
                "python3",
                "-c",
                SETTLING_FAKE_CLAUDE,
                "FAKE_CLAUDE_COMPOSITION",
            ],
        );
        let turn = session
            .attach_turn(&claude_user_frame("hi", &[]))
            .expect("attach turn");
        let deadline = std::time::Instant::now() + EVENT_WAIT;
        while turn.outcome().is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(turn.outcome(), Some(TurnOutcome::Settled));
    }

    #[test]
    fn a_claude_stdin_plan_gets_a_session_plan() {
        let request = start_request(json!({})).expect("request");
        let prepared = prepare_transport(
            plan().with_stdin_frame_for_tests(b"{}\n".to_vec()),
            &request,
            Path::new("/repo"),
            &registry(),
            accept_authority(),
        );
        assert_eq!(prepared.has_claude_session(), cfg!(unix));
    }

    #[test]
    fn an_argv_plan_stays_on_the_per_turn_path() {
        let request = start_request(json!({})).expect("request");
        let prepared = prepare_transport(
            plan(),
            &request,
            Path::new("/repo"),
            &registry(),
            accept_authority(),
        );
        assert!(!prepared.has_claude_session());
    }

    #[test]
    fn a_codex_stdin_plan_never_gets_a_session_plan() {
        let request = start_request(json!({"agentCliKind": "codex"})).expect("request");
        let prepared = prepare_transport(
            plan().with_stdin_frame_for_tests(b"{}\n".to_vec()),
            &request,
            Path::new("/repo"),
            &registry(),
            accept_authority(),
        );
        assert!(!prepared.has_claude_session());
    }

    #[test]
    fn start_requests_default_to_refusing_a_background_restart() {
        assert_eq!(
            start_request(json!({})).expect("default").session_restart,
            ClaudeSessionRestartPolicy::RefuseIfBackground
        );
        assert_eq!(
            start_request(json!({"sessionRestart": "stopBackground"}))
                .expect("explicit")
                .session_restart,
            ClaudeSessionRestartPolicy::StopBackground
        );
        assert!(start_request(json!({"sessionRestart": "always"})).is_err());
    }

    #[test]
    fn session_requests_are_closed() {
        assert!(serde_json::from_value::<AgentThreadSessionRequest>(json!({
            "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "extra": 1
        }))
        .is_err());
        assert!(serde_json::from_value::<AgentThreadSessionRequest>(json!({
            "workspaceId": "ws-1", "threadId": "agt-1-0a1c"
        }))
        .is_ok());
        assert!(serde_json::from_value::<InterruptAgentTaskRequest>(json!({
            "taskId": "agt-1-0a1b", "workspaceId": "ws-1", "threadId": "agt-1-0a1c"
        }))
        .is_ok());
        assert!(serde_json::from_value::<InterruptAgentTaskRequest>(json!({
            "taskId": "agt-1-0a1b", "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "force": true
        }))
        .is_err());
        let launch = serde_json::to_value(AgentLaunchOptions::default()).expect("launch");
        assert!(
            serde_json::from_value::<InspectAgentThreadSessionRequest>(json!({
                "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "resumeSessionId": null,
                "launch": launch
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<InspectAgentThreadSessionRequest>(json!({
                "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "resumeSessionId": null,
                "launch": launch, "fingerprint": "x"
            }))
            .is_err()
        );
    }

    #[test]
    fn wire_shapes_match_the_frontend_contract() {
        assert_eq!(AGENT_SESSION_ENDED_EVENT_CHANNEL, "agent-session://ended");
        assert_eq!(
            AGENT_SESSION_BACKGROUND_TURN_EVENT_CHANNEL,
            "agent-session://background-turn"
        );
        for (outcome, wire) in [
            (
                AgentTaskInterruptOutcome::Interrupting,
                r#"{"kind":"interrupting"}"#,
            ),
            (
                AgentTaskInterruptOutcome::Unsupported,
                r#"{"kind":"unsupported"}"#,
            ),
            (
                AgentTaskInterruptOutcome::Unavailable,
                r#"{"kind":"unavailable"}"#,
            ),
            (
                AgentTaskInterruptOutcome::Stopping,
                r#"{"kind":"stopping"}"#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&outcome).expect("json"), wire);
        }
        for (inspection, wire) in [
            (ClaudeSessionInspection::None, r#"{"kind":"none"}"#),
            (
                ClaudeSessionInspection::Reuse {
                    background_tasks: false,
                },
                r#"{"kind":"reuse","backgroundTasks":false}"#,
            ),
            (
                ClaudeSessionInspection::Restart {
                    background_tasks: true,
                },
                r#"{"kind":"restart","backgroundTasks":true}"#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&inspection).expect("json"), wire);
        }
        assert_eq!(
            serde_json::to_string(&EndAgentThreadSessionResult { ended: true }).expect("json"),
            r#"{"ended":true}"#
        );
    }

    #[test]
    fn the_app_handle_sink_emits_both_session_channels() {
        let (app, _sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        let background = listen(&app, AGENT_SESSION_BACKGROUND_TURN_EVENT_CHANNEL);
        let sink = AppHandleClaudeSessionEvents(app.handle().clone());

        sink.ended(ClaudeSessionEndedEvent {
            workspace_id: "ws-1".to_string(),
            thread_id: "agt-1-0a1c".to_string(),
            reason: ClaudeSessionEndReason::IdleTimeout,
            background_tasks_live: true,
        });
        sink.background_turn(ClaudeSessionBackgroundTurnEvent {
            workspace_id: "ws-1".to_string(),
            thread_id: "agt-1-0a1c".to_string(),
            output: "{\"type\":\"result\"}\n".to_string(),
            truncated: false,
            complete: true,
        });

        assert_eq!(
            ended.recv_timeout(EVENT_WAIT).expect("ended"),
            r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","reason":"idleTimeout","backgroundTasksLive":true}"#
        );
        assert_eq!(
            background
                .recv_timeout(EVENT_WAIT)
                .expect("background turn"),
            r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","output":"{\"type\":\"result\"}\n","truncated":false,"complete":true}"#
        );
    }

    #[test]
    fn the_app_handle_sink_emits_the_background_tasks_level() {
        let (app, _sessions) = mock_app(ClaudeSessionTuning::default());
        let tasks = listen(&app, AGENT_SESSION_BACKGROUND_TASKS_EVENT_CHANNEL);
        let sink = AppHandleClaudeSessionEvents(app.handle().clone());

        sink.background_tasks(ClaudeSessionBackgroundTasksEvent {
            workspace_id: "ws-1".to_string(),
            thread_id: "agt-1-0a1c".to_string(),
            total: 1,
            agents: 1,
            tasks: vec![ClaudeSessionBackgroundTask {
                task_id: "a4b355dcf6056a875".to_string(),
                task_type: ClaudeSessionBackgroundTaskType::Agent,
                description: Some("Live Codex model catalog like Claude".to_string()),
            }],
            reply: ClaudeSessionBackgroundReply::None,
        });
        sink.background_tasks(ClaudeSessionBackgroundTasksEvent {
            workspace_id: "ws-1".to_string(),
            thread_id: "agt-1-0a1c".to_string(),
            total: 0,
            agents: 0,
            tasks: Vec::new(),
            reply: ClaudeSessionBackgroundReply::InProgress,
        });

        assert_eq!(
            AGENT_SESSION_BACKGROUND_TASKS_EVENT_CHANNEL,
            "agent-session://background-tasks"
        );
        assert_eq!(
            tasks.recv_timeout(EVENT_WAIT).expect("background tasks"),
            r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":1,"agents":1,"tasks":[{"taskId":"a4b355dcf6056a875","taskType":"agent","description":"Live Codex model catalog like Claude"}],"reply":"none"}"#
        );
        assert_eq!(
            tasks.recv_timeout(EVENT_WAIT).expect("reply level"),
            r#"{"workspaceId":"ws-1","threadId":"agt-1-0a1c","total":0,"agents":0,"tasks":[],"reply":"inProgress"}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn provider_update_retires_idle_claude_sessions_only_for_claude() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        start_settled_session(&sessions, "ws-1", "agt-1-0a1c");
        let lifecycle = AgentProviderHostLifecycles {
            codex: CodexProviderHostLifecycle(Arc::new(CodexAppServerHostRegistry::standard())),
            claude: Arc::clone(&sessions),
        };

        lifecycle
            .retire_idle_hosts(AgentCliInvocation::CodexExec)
            .expect("codex update");
        assert_eq!(sessions.live_sessions(), 1);

        lifecycle
            .retire_idle_hosts(AgentCliInvocation::ClaudeCode)
            .expect("claude update");
        let event = ended_payload(&ended);
        assert_eq!(event["reason"], "providerUpdated");
        assert_eq!(event["threadId"], "agt-1-0a1c");
        assert_eq!(sessions.live_sessions(), 0);
        assert!(sessions.shutdown_all());
    }

    #[cfg(unix)]
    #[test]
    fn root_release_is_keyed_by_the_exact_workspace() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        start_unattached_session(&sessions, "ws-a", "agt-1-0a1c", Path::new("/repo"));

        end_sessions_for_root(app.handle(), Some("ws-b"), Path::new("/repo"));
        assert!(ended.recv_timeout(Duration::from_millis(300)).is_err());
        assert_eq!(sessions.live_sessions(), 1);

        end_sessions_for_root(app.handle(), Some("ws-a"), Path::new("/repo"));
        let event = ended_payload(&ended);
        assert_eq!(event["reason"], "released");
        assert_eq!(event["workspaceId"], "ws-a");
        assert_eq!(sessions.live_sessions(), 0);
        assert!(sessions.shutdown_all());
    }

    #[cfg(unix)]
    #[test]
    fn dispose_releases_sessions_of_every_workspace_under_the_root() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        start_unattached_session(&sessions, "ws-a", "agt-1-0a1c", Path::new("/repo"));
        start_unattached_session(&sessions, "ws-b", "agt-2-0a1c", Path::new("/other"));

        end_sessions_for_root(app.handle(), None, Path::new("/repo"));
        let deadline = std::time::Instant::now() + EVENT_WAIT;
        while sessions.live_sessions() > 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(sessions.live_sessions(), 1);
        assert!(sessions.shutdown_all());
        assert_eq!(sessions.live_sessions(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn workspace_release_ends_every_session_of_that_workspace_only() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        let released = "ws-0123456789abcdef0123456789abcdef";
        let other = "ws-fedcba9876543210fedcba9876543210";
        start_unattached_session(
            &sessions,
            released,
            "agt-1-0a1c",
            Path::new("/worktrees/agt-1-0a1b"),
        );
        start_unattached_session(&sessions, other, "agt-2-0a1c", Path::new("/repo"));

        end_sessions_for_root(app.handle(), Some(released), Path::new("/repo"));
        assert!(ended.recv_timeout(Duration::from_millis(300)).is_err());
        assert_eq!(sessions.live_sessions(), 2);

        end_sessions_for_workspace(app.handle(), released);
        let event = ended_payload(&ended);
        assert_eq!(event["reason"], "released");
        assert_eq!(event["workspaceId"], released);
        assert_eq!(event["threadId"], "agt-1-0a1c");
        assert!(ended.recv_timeout(Duration::from_millis(300)).is_err());
        assert_eq!(sessions.live_sessions(), 1);
        assert!(sessions.shutdown_all());
    }

    #[cfg(unix)]
    #[test]
    fn root_dispose_also_ends_the_disposed_workspace_sessions_outside_the_root() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let disposed = "ws-0123456789abcdef0123456789abcdef";
        let other = "ws-fedcba9876543210fedcba9876543210";
        start_unattached_session(
            &sessions,
            disposed,
            "agt-1-0a1c",
            Path::new("/worktrees/agt-1-0a1b"),
        );
        start_unattached_session(&sessions, other, "agt-2-0a1c", Path::new("/repo"));
        start_unattached_session(&sessions, other, "agt-3-0a1c", Path::new("/other"));

        end_sessions_on_root_dispose(app.handle(), Some(disposed), Path::new("/repo"));
        let deadline = std::time::Instant::now() + EVENT_WAIT;
        while sessions.live_sessions() > 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(sessions.live_sessions(), 1);

        end_sessions_on_root_dispose(app.handle(), None, Path::new("/repo"));
        assert_eq!(sessions.live_sessions(), 1);
        assert!(sessions.shutdown_all());
        assert_eq!(sessions.live_sessions(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn worktree_removal_reaps_sessions_inside_the_worktree() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let worktree = Path::new("/repo/.codevo/worktrees/agt-1-0a1b");
        start_unattached_session(&sessions, "ws-1", "agt-1-0a1c", worktree);
        start_unattached_session(&sessions, "ws-1", "agt-2-0a1c", Path::new("/repo"));

        assert!(reap_sessions_in_worktree(app.handle(), worktree));
        assert_eq!(sessions.live_sessions(), 1);
        assert!(reap_sessions_in_worktree(app.handle(), worktree));
        assert!(sessions.shutdown_all());
    }

    #[cfg(unix)]
    #[test]
    fn the_end_command_is_keyed_by_the_exact_workspace_and_thread() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        start_unattached_session(&sessions, "ws-a", "agt-1-0a1c", Path::new("/repo"));
        let end = |workspace_id: &str, thread_id: &str| {
            let request = serde_json::from_value::<AgentThreadSessionRequest>(json!({
                "workspaceId": workspace_id, "threadId": thread_id
            }))
            .expect("request");
            tauri::async_runtime::block_on(end_agent_thread_session(request, app.state()))
        };

        assert!(end("ws-a", "Bad Id").is_err());
        assert!(end("", "agt-1-0a1c").is_err());
        assert!(!end("ws-b", "agt-1-0a1c").expect("foreign workspace").ended);
        assert!(!end("ws-a", "agt-9-0a1c").expect("foreign thread").ended);
        assert_eq!(sessions.live_sessions(), 1);

        assert!(end("ws-a", "agt-1-0a1c").expect("owner").ended);
        let event = ended_payload(&ended);
        assert_eq!(event["reason"], "threadEnded");
        assert!(sessions.shutdown_all());
    }

    #[test]
    fn background_task_stop_requests_are_closed() {
        assert!(
            serde_json::from_value::<StopAgentBackgroundTaskRequest>(json!({
                "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "taskId": "b8kzpiexm"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<StopAgentBackgroundTaskRequest>(json!({
                "workspaceId": "ws-1", "threadId": "agt-1-0a1c", "taskId": "b8kzpiexm",
                "force": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StopAgentBackgroundTaskRequest>(json!({
                "workspaceId": "ws-1", "threadId": "agt-1-0a1c"
            }))
            .is_err()
        );
        assert_eq!(
            serde_json::to_string(&ClaudeBackgroundTaskStopOutcome::NotLive).expect("json"),
            r#"{"kind":"notLive"}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_background_task_stop_command_is_keyed_by_the_exact_owner_and_a_valid_task_id() {
        let (app, sessions) = mock_app(ClaudeSessionTuning::default());
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        start_unattached_session(&sessions, "ws-a", "agt-1-0a1c", Path::new("/repo"));
        let stop = |workspace_id: &str, thread_id: &str, task_id: &str| {
            let request = serde_json::from_value::<StopAgentBackgroundTaskRequest>(json!({
                "workspaceId": workspace_id, "threadId": thread_id, "taskId": task_id
            }))
            .expect("request");
            tauri::async_runtime::block_on(stop_agent_background_task(request, app.state()))
        };

        assert!(stop("ws-a", "Bad Id", "b8kzpiexm").is_err());
        assert!(stop("", "agt-1-0a1c", "b8kzpiexm").is_err());
        assert!(stop("ws-a", "agt-1-0a1c", "").is_err());
        assert!(stop("ws-a", "agt-1-0a1c", "bad\nid").is_err());
        assert!(stop("ws-a", "agt-1-0a1c", &"x".repeat(257)).is_err());
        assert_eq!(
            stop("ws-b", "agt-1-0a1c", "b8kzpiexm").expect("foreign workspace"),
            ClaudeBackgroundTaskStopOutcome::NoSession
        );
        assert_eq!(
            stop("ws-a", "agt-9-0a1c", "b8kzpiexm").expect("foreign thread"),
            ClaudeBackgroundTaskStopOutcome::NoSession
        );
        assert_eq!(
            stop("ws-a", "agt-1-0a1c", "b8kzpiexm").expect("owner"),
            ClaudeBackgroundTaskStopOutcome::NotLive
        );
        assert!(ended.recv_timeout(Duration::from_millis(200)).is_err());
        assert_eq!(sessions.live_sessions(), 1);
        assert!(sessions.shutdown_all());
    }

    #[cfg(unix)]
    #[test]
    fn the_idle_loop_retires_sessions_off_the_ui_runtime() {
        let tuning = ClaudeSessionTuning {
            idle_ttl: Duration::ZERO,
            ..ClaudeSessionTuning::default()
        };
        let (app, sessions) = mock_app(tuning);
        let ended = listen(&app, AGENT_SESSION_ENDED_EVENT_CHANNEL);
        start_settled_session(&sessions, "ws-1", "agt-1-0a1c");

        spawn_idle_session_retirement(Arc::downgrade(&sessions), Duration::from_millis(20));

        let event = ended_payload(&ended);
        assert_eq!(event["reason"], "idleTimeout");
        assert!(sessions.shutdown_all());
    }
}
