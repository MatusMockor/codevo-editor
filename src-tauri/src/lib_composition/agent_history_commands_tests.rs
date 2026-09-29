use super::*;
use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use crate::agent_task_spawner::claude_session_policy::{
    ClaudeSessionBackgroundTurnEvent, ClaudeSessionEndedEvent, ClaudeSessionFingerprint,
    ClaudeSessionKey, ClaudeSessionRestartPolicy, ExecutableFingerprint,
};
use crate::agent_task_spawner::claude_session_registry::{
    ClaudeSessionEventSink, ClaudeSessionLease, ClaudeSessionRequest,
};
use crate::agent_task_supervisor::system_process_group_signals;
use serde_json::json;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const WORKSPACE_ID: &str = "ws-0123456789abcdef0123456789abcdef";
const THREAD_ID: &str = "agt-1-0a1c";

#[derive(Default)]
struct RecordingEvents {
    ended: Mutex<Vec<ClaudeSessionEndedEvent>>,
}

impl ClaudeSessionEventSink for RecordingEvents {
    fn ended(&self, event: ClaudeSessionEndedEvent) {
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    }

    fn background_turn(&self, _event: ClaudeSessionBackgroundTurnEvent) {}
}

impl RecordingEvents {
    fn reasons(&self) -> Vec<ClaudeSessionEndReason> {
        self.ended
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .map(|event| event.reason)
            .collect()
    }
}

struct Fixture {
    base: PathBuf,
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let base = std::env::temp_dir().join(format!(
            "codevo-history-delete-{label}-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        let root = base.join("project");
        std::fs::create_dir_all(root.join("repo")).expect("project root");
        std::fs::create_dir_all(base.join("data")).expect("history base");
        let root = std::fs::canonicalize(root).expect("canonical root");
        Self { base, root }
    }

    fn root_key(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

fn fingerprint(cwd: &Path) -> ClaudeSessionFingerprint {
    ClaudeSessionFingerprint {
        executable: ExecutableFingerprint {
            path: PathBuf::from("/bin/sleep"),
            size_bytes: 0,
            modified_epoch_ms: 0,
            device: 0,
            inode: 0,
        },
        provider_generation: 1,
        launch: AgentLaunchOptions::default(),
        args_without_resume: vec!["30".to_string()],
        env: Vec::new(),
        cwd: cwd.to_path_buf(),
        cwd_identity: None,
    }
}

fn start_session(sessions: &ClaudeSessionRegistry, repository_root: &Path) {
    let request = ClaudeSessionRequest {
        key: ClaudeSessionKey {
            workspace_id: WORKSPACE_ID.to_string(),
            thread_id: THREAD_ID.to_string(),
        },
        repository_root: repository_root.to_path_buf(),
        fingerprint: fingerprint(repository_root),
        resume_session_id: None,
        restart: ClaudeSessionRestartPolicy::RefuseIfBackground,
    };
    let lease = sessions
        .acquire(&request, || {
            let child = Command::new("/bin/sleep")
                .arg("30")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .process_group(0)
                .spawn()
                .map_err(|error| error.to_string())?;
            let process_group_id = i32::try_from(child.id()).map_err(|error| error.to_string())?;
            Ok((child, process_group_id))
        })
        .expect("acquire session");
    assert!(matches!(lease, ClaudeSessionLease::Session(_)));
}

fn delete(
    app: &tauri::App<tauri::test::MockRuntime>,
    root_key: &str,
    owner_id: &str,
) -> Result<(), String> {
    let request = serde_json::from_value::<HistoryThreadRequest>(json!({
        "rootKey": root_key,
        "ownerId": owner_id,
        "threadId": THREAD_ID
    }))
    .expect("request");
    tauri::async_runtime::block_on(delete_agent_history_thread(
        request,
        app.state(),
        app.state(),
    ))
}

#[test]
fn deleting_a_history_thread_ends_its_claude_session_after_the_owner_check() {
    let fixture = Fixture::new("owner");
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app");
    let events = Arc::new(RecordingEvents::default());
    let sessions = Arc::new(ClaudeSessionRegistry::new(
        system_process_group_signals(),
        Arc::clone(&events) as Arc<dyn ClaudeSessionEventSink>,
    ));
    app.manage(Arc::new(AgentHistoryStore::new(fixture.base.join("data"))));
    app.manage(Arc::clone(&sessions));
    start_session(&sessions, &fixture.root.join("repo"));
    let owner_id = agent_history_store::legacy::agent_root_owner_id(&fixture.root_key());

    assert!(delete(&app, &fixture.root_key(), "agent-root:0000000000000000").is_err());
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(sessions.live_sessions(), 1);
    assert!(events.reasons().is_empty());

    delete(&app, &fixture.root_key(), &owner_id).expect("delete");
    let deadline = Instant::now() + Duration::from_secs(5);
    while sessions.live_sessions() > 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(sessions.live_sessions(), 0);
    assert_eq!(events.reasons(), vec![ClaudeSessionEndReason::ThreadEnded]);
    assert!(sessions.shutdown_all());
}
