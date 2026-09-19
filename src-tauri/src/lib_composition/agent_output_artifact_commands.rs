use super::{
    agent_attachment_commands::resolve_agent_attachment_owner,
    agent_thread_store_commands::agent_thread_store::{
        AgentThread, AgentThreadStore, AgentTurn, AgentTurnStatus,
    },
};
use crate::{
    agent_task_supervisor::AgentTaskIsolation,
    run_blocking_command,
    workspace_registry::{WorkspaceId, WorkspaceRegistry},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
#[path = "../agent_artifact_errors.rs"]
pub(crate) mod errors;
#[path = "../agent_output_artifact_store.rs"]
pub(crate) mod store;
use store::{ArtifactMetadata, ArtifactOwner, OutputArtifactStore};

const TURN_END_MTIME_SKEW_MS: u64 = 2_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResolveRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    turn_id: String,
    path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadRequest {
    workspace_id: WorkspaceId,
    thread_id: String,
    turn_id: String,
    artifact_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactFileLocation {
    file_path: String,
}

fn load_thread(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    thread_id: &str,
    turn_id: &str,
) -> Result<(AgentThread, PathBuf), String> {
    crate::git_worktree::safe_agent_task_id(thread_id)?;
    crate::git_worktree::safe_agent_task_id(turn_id)?;
    let resolved = resolve_agent_attachment_owner(app, workspace_id)?;
    let descriptor = app
        .state::<WorkspaceRegistry>()
        .descriptor(&resolved.workspace_id)
        .map_err(|e| e.to_string())?;
    let threads = app.state::<Arc<AgentThreadStore>>();
    for key in resolved.root_keys {
        if let Some(thread) = threads
            .load(&key)?
            .threads
            .into_iter()
            .find(|t| t.thread_id == thread_id)
        {
            let turn = thread
                .turns
                .iter()
                .find(|t| t.turn_id == turn_id)
                .ok_or("Artifact turn is unavailable.")?;
            if !turn.status.is_terminal() {
                return Err("Artifacts are available after the turn finishes.".into());
            }
            let repository = PathBuf::from(&thread.owner.repository_root)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if repository != descriptor.canonical_root_path {
                return Err("Artifact repository does not match its registered owner.".into());
            }
            return Ok((thread, repository));
        }
    }
    Err("Artifact thread is unavailable.".into())
}
fn root(thread: &AgentThread, repository: PathBuf) -> Result<PathBuf, String> {
    match thread.target.isolation {
        AgentTaskIsolation::InPlace if thread.target.worktree_path.is_none() => Ok(repository),
        AgentTaskIsolation::Worktree => {
            let path = thread
                .target
                .worktree_path
                .as_ref()
                .ok_or("Artifact worktree is unavailable.")?;
            let candidate = PathBuf::from(path);
            let expected = crate::git_worktree::agent_worktree_path(&repository, "placeholder");
            let base = expected.parent().ok_or("Invalid artifact worktree base.")?;
            if candidate == base
                || !candidate.starts_with(base)
                || candidate.components().any(|c| {
                    matches!(
                        c,
                        std::path::Component::ParentDir | std::path::Component::CurDir
                    )
                })
            {
                return Err("Artifact worktree aliases are not supported.".into());
            }
            Ok(candidate)
        }
        _ => Err("Invalid artifact workspace.".into()),
    }
}
fn is_newest_terminal_turn(turns: &[AgentTurn], turn_id: &str) -> bool {
    let Some(index) = turns.iter().position(|turn| turn.turn_id == turn_id) else {
        return false;
    };
    !turns[index + 1..]
        .iter()
        .any(|turn| turn.status.is_terminal())
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceMtimeBound {
    Unconstrained,
    AtMostEpochMs(u64),
    Unverifiable,
}
fn source_mtime_bound(turns: &[AgentTurn], turn_id: &str) -> SourceMtimeBound {
    let Some(index) = turns.iter().position(|turn| turn.turn_id == turn_id) else {
        return SourceMtimeBound::Unverifiable;
    };
    let Some(successor) = turns[index + 1..]
        .iter()
        .find(|turn| !matches!(turn.status, AgentTurnStatus::Pending))
    else {
        return SourceMtimeBound::Unconstrained;
    };
    let Some(ended) = turns[index].ended_at_epoch_ms else {
        return SourceMtimeBound::Unverifiable;
    };
    let skewed = ended.saturating_add(TURN_END_MTIME_SKEW_MS);
    if successor.started_at_epoch_ms == 0 {
        return SourceMtimeBound::AtMostEpochMs(skewed);
    }
    SourceMtimeBound::AtMostEpochMs(skewed.min(successor.started_at_epoch_ms))
}
fn source_mtime_limit(turns: &[AgentTurn], turn_id: &str) -> Result<Option<u64>, String> {
    match source_mtime_bound(turns, turn_id) {
        SourceMtimeBound::Unverifiable => Err(errors::TURN_END_UNRECORDED.into()),
        SourceMtimeBound::Unconstrained => Ok(None),
        SourceMtimeBound::AtMostEpochMs(limit) => Ok(Some(limit)),
    }
}
fn same_root_identity(expected: &File, actual: &File) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let expected = expected.metadata().map_err(|e| e.to_string())?;
    let actual = actual.metadata().map_err(|e| e.to_string())?;
    if expected.dev() != actual.dev() || expected.ino() != actual.ino() {
        return Err("Artifact workspace changed.".into());
    }
    Ok(())
}
fn locate_contained(
    store: &OutputArtifactStore,
    root: &Path,
    root_descriptor: &File,
    reference: &str,
    reopen_root: impl Fn() -> Result<File, String>,
) -> Result<PathBuf, String> {
    let file = store.locate(root, root_descriptor, reference)?;
    same_root_identity(root_descriptor, &reopen_root()?)?;
    Ok(file)
}
fn open_root_descriptor(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    root: &Path,
    repository: &Path,
) -> Result<File, String> {
    if root == repository {
        return registry.clone_root(workspace_id).map_err(|e| e.to_string());
    }
    registry
        .open_directory_descendant(
            workspace_id,
            root.strip_prefix(repository)
                .map_err(|_| "Invalid artifact root.")?,
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn resolve_agent_output_artifact(
    app: AppHandle,
    request: ResolveRequest,
) -> Result<ArtifactMetadata, String> {
    run_blocking_command(move || {
        resolve_saved_output_artifact(
            &app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
            &request.path,
        )
    })
    .await
}
pub(super) fn resolve_saved_output_artifact(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    thread_id: &str,
    turn_id: &str,
    path: &str,
) -> Result<ArtifactMetadata, String> {
    let request = ResolveRequest {
        workspace_id: workspace_id.clone(),
        thread_id: thread_id.into(),
        turn_id: turn_id.into(),
        path: path.into(),
    };
    let (thread, repository) = load_thread(
        app,
        &request.workspace_id,
        &request.thread_id,
        &request.turn_id,
    )?;
    let root = root(&thread, repository.clone())?;
    let owner = ArtifactOwner {
        root_key: &thread.owner.root_key,
        thread_id: &request.thread_id,
        turn_id: &request.turn_id,
    };
    let initial_registration =
        resolve_agent_attachment_owner(app, &request.workspace_id)?.workspace_id;
    if let Some(metadata) =
        app.state::<Arc<OutputArtifactStore>>()
            .existing(&owner, &root, &request.path)?
    {
        validate_still_owned(
            app,
            &request.workspace_id,
            &initial_registration,
            &thread,
            &request.turn_id,
        )?;
        return Ok(metadata);
    }
    if !is_newest_terminal_turn(&thread.turns, &request.turn_id) {
        return Err(errors::SNAPSHOT_MISSING.into());
    }
    let max_source_mtime_ms = source_mtime_limit(&thread.turns, &request.turn_id)?;
    let resolved = resolve_agent_attachment_owner(app, &request.workspace_id)?;
    let registry = app.state::<WorkspaceRegistry>();
    let root_descriptor =
        open_root_descriptor(&registry, &resolved.workspace_id, &root, &repository)?;
    let revalidate = || {
        validate_still_owned(
            app,
            &request.workspace_id,
            &initial_registration,
            &thread,
            &request.turn_id,
        )?;
        let (latest, _) = load_thread(
            app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
        )?;
        if !is_newest_terminal_turn(&latest.turns, &request.turn_id) {
            return Err(errors::CONVERSATION_ADVANCED.into());
        }
        let current_owner = resolve_agent_attachment_owner(app, &request.workspace_id)?;
        if current_owner.workspace_id != resolved.workspace_id {
            return Err("Artifact owner changed.".into());
        }
        let current = open_root_descriptor(&registry, &resolved.workspace_id, &root, &repository)?;
        same_root_identity(&root_descriptor, &current)
    };
    app.state::<Arc<OutputArtifactStore>>().resolve_registered(
        &ArtifactOwner {
            root_key: &thread.owner.root_key,
            thread_id: &request.thread_id,
            turn_id: &request.turn_id,
        },
        &root,
        &root_descriptor,
        &request.path,
        max_source_mtime_ms,
        revalidate,
    )
}
fn located_artifact_file(app: &AppHandle, request: &ResolveRequest) -> Result<PathBuf, String> {
    let (thread, repository) = load_thread(
        app,
        &request.workspace_id,
        &request.thread_id,
        &request.turn_id,
    )?;
    let root = root(&thread, repository.clone())?;
    let registration = resolve_agent_attachment_owner(app, &request.workspace_id)?.workspace_id;
    let registry = app.state::<WorkspaceRegistry>();
    let descriptor = open_root_descriptor(&registry, &registration, &root, &repository)?;
    let store = app.state::<Arc<OutputArtifactStore>>();
    let file = locate_contained(&store, &root, &descriptor, &request.path, || {
        open_root_descriptor(&registry, &registration, &root, &repository)
    })?;
    validate_still_owned(
        app,
        &request.workspace_id,
        &registration,
        &thread,
        &request.turn_id,
    )?;
    Ok(file)
}
#[tauri::command]
pub(crate) async fn locate_agent_output_artifact_file(
    app: AppHandle,
    request: ResolveRequest,
) -> Result<ArtifactFileLocation, String> {
    run_blocking_command(move || {
        let file = located_artifact_file(&app, &request)?;
        Ok(ArtifactFileLocation {
            file_path: displayable(&file)?,
        })
    })
    .await
}
trait RevealArtifactFile {
    fn reveal(&self, path: &Path) -> Result<(), String>;
}
struct SystemFileViewer<'a>(&'a AppHandle);
impl RevealArtifactFile for SystemFileViewer<'_> {
    fn reveal(&self, path: &Path) -> Result<(), String> {
        self.0
            .opener()
            .reveal_item_in_dir(path)
            .map_err(|error| format!("Unable to reveal the artifact: {error}"))
    }
}
fn reveal_located_artifact_file(
    locate: impl FnOnce() -> Result<PathBuf, String>,
    viewer: &dyn RevealArtifactFile,
) -> Result<(), String> {
    let file = locate()?;
    viewer.reveal(&file)
}
#[tauri::command]
pub(crate) async fn reveal_agent_output_artifact_file(
    app: AppHandle,
    request: ResolveRequest,
) -> Result<(), String> {
    run_blocking_command(move || {
        reveal_located_artifact_file(
            || located_artifact_file(&app, &request),
            &SystemFileViewer(&app),
        )
    })
    .await
}
fn displayable(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Artifact path is not supported.".into())
}
#[tauri::command]
pub(crate) async fn read_agent_output_artifact(
    app: AppHandle,
    request: ReadRequest,
) -> Result<tauri::ipc::Response, String> {
    run_blocking_command(move || {
        let (thread, _) = load_thread(
            &app,
            &request.workspace_id,
            &request.thread_id,
            &request.turn_id,
        )?;
        let registration =
            resolve_agent_attachment_owner(&app, &request.workspace_id)?.workspace_id;
        let bytes = app.state::<Arc<OutputArtifactStore>>().read(
            &ArtifactOwner {
                root_key: &thread.owner.root_key,
                thread_id: &request.thread_id,
                turn_id: &request.turn_id,
            },
            &request.artifact_id,
        )?;
        validate_still_owned(
            &app,
            &request.workspace_id,
            &registration,
            &thread,
            &request.turn_id,
        )?;
        Ok(bytes)
    })
    .await
    .map(tauri::ipc::Response::new)
}

fn validate_still_owned(
    app: &AppHandle,
    owner: &WorkspaceId,
    registration: &WorkspaceId,
    expected: &AgentThread,
    turn_id: &str,
) -> Result<(), String> {
    if resolve_agent_attachment_owner(app, owner)?.workspace_id != *registration {
        return Err("Artifact owner changed.".into());
    }
    let (current, _) = load_thread(app, owner, &expected.thread_id, turn_id)?;
    if current.owner != expected.owner || current.target != expected.target {
        return Err("Artifact thread owner changed.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        super::agent_thread_store_commands::agent_thread_store::{AgentTurn, AgentTurnStatus},
        errors, is_newest_terminal_turn, locate_contained, reveal_located_artifact_file,
        source_mtime_bound, source_mtime_limit, OutputArtifactStore, RevealArtifactFile,
        SourceMtimeBound, TURN_END_MTIME_SKEW_MS,
    };
    use std::{
        cell::RefCell,
        fs,
        fs::File,
        path::{Path, PathBuf},
    };

    fn ended(turn_id: &str, ended_at_epoch_ms: Option<u64>) -> AgentTurn {
        AgentTurn {
            ended_at_epoch_ms,
            ..turn(turn_id, AgentTurnStatus::Exited { exit_code: 0 })
        }
    }

    fn started(turn_id: &str, status: AgentTurnStatus, started_at_epoch_ms: u64) -> AgentTurn {
        AgentTurn {
            started_at_epoch_ms,
            ..turn(turn_id, status)
        }
    }

    fn turn(turn_id: &str, status: AgentTurnStatus) -> AgentTurn {
        AgentTurn {
            codex_transport: None,
            turn_id: turn_id.into(),
            prompt: String::new(),
            status,
            started_at_epoch_ms: 0,
            ended_at_epoch_ms: None,
            events: Vec::new(),
            events_truncated: false,
            subagent_lifecycle: None,
            last_status_sequence: 0,
            last_output_sequence: 0,
            stream_metrics: None,
            launch: None,
            cli_version: None,
            attachments: Vec::new(),
        }
    }

    #[test]
    fn a_queued_follow_up_does_not_orphan_the_finished_turn() {
        let turns = [
            turn("turn-one", AgentTurnStatus::Exited { exit_code: 0 }),
            turn("turn-two", AgentTurnStatus::Running),
            turn("turn-three", AgentTurnStatus::Pending),
        ];
        assert!(is_newest_terminal_turn(&turns, "turn-one"));
    }

    #[test]
    fn a_terminal_successor_still_refuses_the_older_turn() {
        let turns = [
            turn("turn-one", AgentTurnStatus::Exited { exit_code: 0 }),
            turn("turn-two", AgentTurnStatus::Stopped),
            turn("turn-three", AgentTurnStatus::Running),
        ];
        assert!(!is_newest_terminal_turn(&turns, "turn-one"));
        assert!(is_newest_terminal_turn(&turns, "turn-two"));
    }

    #[test]
    fn the_last_turn_and_unknown_turns_keep_their_existing_verdict() {
        let turns = [
            turn("turn-one", AgentTurnStatus::Exited { exit_code: 0 }),
            turn(
                "turn-two",
                AgentTurnStatus::Failed {
                    message: "boom".into(),
                },
            ),
        ];
        assert!(is_newest_terminal_turn(&turns, "turn-two"));
        assert!(!is_newest_terminal_turn(&turns, "turn-missing"));
        assert!(!is_newest_terminal_turn(&[], "turn-one"));
    }

    #[test]
    fn a_running_successor_bounds_the_capture_to_the_turn_end() {
        let turns = [
            ended("turn-one", Some(1_700_000_000_000)),
            turn("turn-two", AgentTurnStatus::Running),
        ];
        assert!(is_newest_terminal_turn(&turns, "turn-one"));
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::AtMostEpochMs(1_700_000_000_000 + TURN_END_MTIME_SKEW_MS)
        );
    }

    #[test]
    fn a_successor_start_bounds_the_capture_before_the_skew_window() {
        let turns = [
            ended("turn-one", Some(1_700_000_000_000)),
            started(
                "turn-two",
                AgentTurnStatus::Running,
                1_700_000_000_000 + 100,
            ),
        ];
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::AtMostEpochMs(1_700_000_000_000 + 100)
        );
    }

    #[test]
    fn only_the_first_started_successor_bounds_the_capture() {
        let turns = [
            ended("turn-one", Some(1_700_000_000_000)),
            started("turn-two", AgentTurnStatus::Pending, 1_700_000_000_000 + 50),
            started(
                "turn-three",
                AgentTurnStatus::Running,
                1_700_000_000_000 + 900,
            ),
        ];
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::AtMostEpochMs(1_700_000_000_000 + 900)
        );
    }

    #[test]
    fn a_successor_without_a_recorded_start_keeps_the_turn_end_bound() {
        let turns = [
            ended("turn-one", Some(1_700_000_000_000)),
            started("turn-two", AgentTurnStatus::Running, 0),
        ];
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::AtMostEpochMs(1_700_000_000_000 + TURN_END_MTIME_SKEW_MS)
        );
    }

    #[test]
    fn a_started_successor_without_a_turn_end_refuses_the_capture() {
        let turns = [
            ended("turn-one", None),
            turn("turn-two", AgentTurnStatus::Running),
        ];
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::Unverifiable
        );
        assert_eq!(
            source_mtime_bound(&turns, "turn-missing"),
            SourceMtimeBound::Unverifiable
        );
    }

    #[test]
    fn a_pending_only_tail_keeps_the_capture_unconstrained() {
        let turns = [
            ended("turn-one", Some(1_700_000_000_000)),
            turn("turn-two", AgentTurnStatus::Pending),
            turn("turn-three", AgentTurnStatus::Pending),
        ];
        assert_eq!(
            source_mtime_bound(&turns, "turn-one"),
            SourceMtimeBound::Unconstrained
        );
        assert_eq!(
            source_mtime_bound(&turns, "turn-three"),
            SourceMtimeBound::Unconstrained
        );
    }

    #[test]
    fn the_newest_terminal_turn_rule_matches_the_cross_language_manifest() {
        let manifest: serde_json::Value = serde_json::from_str(errors::MANIFEST)
            .expect("parse the cross-language artifact error contract");
        assert_eq!(
            manifest.get("newestTerminalTurnRule").unwrap(),
            errors::NEWEST_TERMINAL_TURN_RULE
        );
        let with_terminal_successor = [
            turn("turn-one", AgentTurnStatus::Exited { exit_code: 0 }),
            turn("turn-two", AgentTurnStatus::Stopped),
        ];
        let without_terminal_successor = [
            turn("turn-one", AgentTurnStatus::Exited { exit_code: 0 }),
            turn("turn-two", AgentTurnStatus::Running),
            turn("turn-three", AgentTurnStatus::Pending),
        ];
        assert!(!is_newest_terminal_turn(
            &with_terminal_successor,
            "turn-one"
        ));
        assert!(is_newest_terminal_turn(
            &without_terminal_successor,
            "turn-one"
        ));
        assert!(is_newest_terminal_turn(
            &with_terminal_successor,
            "turn-two"
        ));
    }

    #[derive(Default)]
    struct RecordedViewer(RefCell<Vec<PathBuf>>);
    impl RevealArtifactFile for RecordedViewer {
        fn reveal(&self, path: &Path) -> Result<(), String> {
            self.0.borrow_mut().push(path.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn revealing_hands_the_contained_path_to_the_reveal_action() {
        let viewer = RecordedViewer::default();
        let contained = PathBuf::from("/workspace/app/report.html");

        reveal_located_artifact_file(|| Ok(contained.clone()), &viewer).expect("reveal the file");

        assert_eq!(viewer.0.borrow().as_slice(), [contained]);
    }

    #[test]
    fn a_refused_location_never_reaches_the_reveal_action() {
        let viewer = RecordedViewer::default();

        assert_eq!(
            reveal_located_artifact_file(|| Err("Artifact owner changed.".into()), &viewer)
                .unwrap_err(),
            "Artifact owner changed."
        );
        assert!(viewer.0.borrow().is_empty());
    }

    #[test]
    fn the_reveal_command_never_launches_the_artifact_with_its_default_program() {
        const SOURCE: &str = include_str!("agent_output_artifact_commands.rs");
        assert!(SOURCE.contains(concat!("reveal_item", "_in_dir")));
        assert!(!SOURCE.contains(concat!("open", "_path")));
    }

    #[test]
    fn a_turn_without_a_recorded_end_is_reported_as_unverifiable() {
        let turns = [
            ended("turn-one", None),
            turn("turn-two", AgentTurnStatus::Running),
        ];

        assert_eq!(
            source_mtime_limit(&turns, "turn-one").unwrap_err(),
            errors::TURN_END_UNRECORDED
        );
        assert_eq!(
            source_mtime_limit(&turns, "turn-one").unwrap_err(),
            serde_json::from_str::<serde_json::Value>(errors::MANIFEST)
                .expect("parse the cross-language artifact error contract")["backendMessages"]
                ["unverifiable"][0]
                .as_str()
                .expect("the contracted unverifiable message")
        );
        assert_ne!(
            source_mtime_limit(&turns, "turn-one").unwrap_err(),
            errors::CHANGED_AFTER_TURN_ENDED
        );
        assert_eq!(source_mtime_limit(&turns, "turn-two"), Ok(None));
    }

    struct Temp(PathBuf);
    impl Temp {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "codevo-artifact-locate-{}-{label}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create the temporary root");
            Self(
                path.canonicalize()
                    .expect("canonicalize the temporary root"),
            )
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn locating_fails_closed_when_the_root_identity_changed_after_the_filesystem_work() {
        let temp = Temp::new("identity");
        let root = temp.0.join("workspace");
        let foreign = temp.0.join("foreign");
        fs::create_dir_all(&root).expect("create the workspace root");
        fs::create_dir_all(&foreign).expect("create the foreign root");
        fs::write(root.join("report.html"), "<h1>Report</h1>").expect("write the artifact");
        fs::write(foreign.join("report.html"), "<h1>Foreign</h1>").expect("write the artifact");
        let store = OutputArtifactStore::new(temp.0.join("storage"));
        let descriptor = File::open(&root).expect("open the workspace root");

        assert_eq!(
            locate_contained(&store, &root, &descriptor, "report.html", || File::open(
                &root
            )
            .map_err(|error| error.to_string()))
            .expect("locate the artifact"),
            root.join("report.html")
        );
        assert_eq!(
            locate_contained(&store, &root, &descriptor, "report.html", || File::open(
                &foreign
            )
            .map_err(|error| error.to_string()))
            .unwrap_err(),
            "Artifact workspace changed."
        );
    }
}
