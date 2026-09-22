//! Read-only access to saved turn snapshots under exact workspace and trust authority.
use crate::{
    agent_turn_changes::{AgentTurnChangesStore, TurnChangesSummary, TurnFileDiff},
    run_blocking_command,
    trust::{WorkspaceTrustService, WorkspaceTrustSnapshot},
};
use serde::Deserialize;
use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Manager, State};

const MAX_READS: usize = 4;
static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);
struct ReadPermit<'a>(&'a AtomicUsize);
impl<'a> ReadPermit<'a> {
    fn acquire(active: &'a AtomicUsize) -> Result<Self, String> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_READS).then_some(count + 1)
            })
            .map(|_| Self(active))
            .map_err(|_| "Too many turn changes reads. Try again shortly.".into())
    }
}
impl Drop for ReadPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnChangesRequest {
    root_path: String,
    turn_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TurnDiffRequest {
    root_path: String,
    turn_id: String,
    relative_path: String,
}

fn validate_owner(root: &str, turn: &str) -> Result<(), String> {
    if root.is_empty()
        || root.len() > 4096
        || !Path::new(root).is_absolute()
        || root.chars().any(char::is_control)
        || turn.is_empty()
        || turn.len() > 256
        || turn.chars().any(char::is_control)
    {
        return Err("Invalid turn changes owner.".into());
    }
    Ok(())
}
fn validate_file(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 4096
        || path.split('/').count() > 64
        || path
            .chars()
            .any(|c| c <= '\u{1f}' || c == '\u{7f}' || c == '\\' || c == ':')
        || path.split('/').any(|part| {
            part.is_empty() || matches!(part, "." | "..") || part.eq_ignore_ascii_case(".git")
        })
    {
        return Err("Invalid turn file path.".into());
    }
    Ok(())
}
fn trust_snapshot(app: &AppHandle, root: &str) -> Result<WorkspaceTrustSnapshot, String> {
    let state = app.state::<Mutex<WorkspaceTrustService>>();
    let snapshot = state
        .lock()
        .map_err(|_| "Workspace trust unavailable.")?
        .snapshot_canonical(root);
    if !snapshot.trusted {
        return Err("Viewing turn changes requires a trusted workspace.".into());
    }
    Ok(snapshot)
}
fn check_trust(app: &AppHandle, expected: &WorkspaceTrustSnapshot) -> Result<(), String> {
    if trust_snapshot(app, &expected.root_path)? != *expected {
        return Err("Workspace trust changed while loading turn changes.".into());
    }
    Ok(())
}
fn retain_root(root: &str, trust: &WorkspaceTrustSnapshot) -> Result<(PathBuf, File), String> {
    let canonical =
        std::fs::canonicalize(root).map_err(|_| "Turn changes workspace is unavailable.")?;
    if canonical.to_str() != Some(trust.root_path.as_str()) {
        return Err("Workspace identity changed.".into());
    }
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = std::fs::OpenOptions::new();
        options
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
        options
    };
    #[cfg(not(unix))]
    let options = {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        options
    };
    let handle = options
        .open(&canonical)
        .map_err(|_| "Turn changes workspace is unavailable.")?;
    if !handle
        .metadata()
        .map_err(|_| "Workspace identity unavailable.")?
        .is_dir()
    {
        return Err("Invalid workspace directory.".into());
    }
    Ok((canonical, handle))
}

#[tauri::command]
pub(crate) async fn agent_turn_changes_get(
    app: AppHandle,
    request: TurnChangesRequest,
    store: State<'_, Arc<AgentTurnChangesStore>>,
) -> Result<TurnChangesSummary, String> {
    validate_owner(&request.root_path, &request.turn_id)?;
    let trust = trust_snapshot(&app, &request.root_path)?;
    let permit = ReadPermit::acquire(&ACTIVE_READS)?;
    let store = Arc::clone(&store);
    let worker_app = app.clone();
    let worker_trust = trust.clone();
    let (result, _permit) = run_blocking_command(move || {
        let result = (|| {
            check_trust(&worker_app, &worker_trust)?;
            let (root, authority) = retain_root(&request.root_path, &worker_trust)?;
            let result = store.get_with_authority(&root, &request.turn_id, &authority)?;
            check_trust(&worker_app, &worker_trust)?;
            Ok(result)
        })();
        Ok((result, permit))
    })
    .await?;
    check_trust(&app, &trust)?;
    result
}
#[tauri::command]
pub(crate) async fn agent_turn_changes_diff(
    app: AppHandle,
    request: TurnDiffRequest,
    store: State<'_, Arc<AgentTurnChangesStore>>,
) -> Result<TurnFileDiff, String> {
    validate_owner(&request.root_path, &request.turn_id)?;
    validate_file(&request.relative_path)?;
    let trust = trust_snapshot(&app, &request.root_path)?;
    let permit = ReadPermit::acquire(&ACTIVE_READS)?;
    let store = Arc::clone(&store);
    let worker_app = app.clone();
    let worker_trust = trust.clone();
    let (result, _permit) = run_blocking_command(move || {
        let result = (|| {
            check_trust(&worker_app, &worker_trust)?;
            let (root, authority) = retain_root(&request.root_path, &worker_trust)?;
            let result = store.file_diff_with_authority(
                &root,
                &request.turn_id,
                &request.relative_path,
                &authority,
            )?;
            check_trust(&worker_app, &worker_trust)?;
            Ok(result)
        })();
        Ok((result, permit))
    })
    .await?;
    check_trust(&app, &trust)?;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dropped_receiver_does_not_release_running_worker_admission() {
        let active = Arc::new(AtomicUsize::new(0));
        let worker_active = Arc::clone(&active);
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let permit = ReadPermit::acquire(&worker_active).unwrap();
            entered_tx.send(()).unwrap();
            finish_rx
                .recv_timeout(std::time::Duration::from_secs(3))
                .unwrap();
            let _ = result_tx.send(());
            drop(permit);
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        drop(result_rx);
        assert_eq!(active.load(Ordering::Acquire), 1);
        finish_tx.send(()).unwrap();
        worker.join().unwrap();
        assert_eq!(active.load(Ordering::Acquire), 0);
    }

    #[test]
    fn read_admission_is_bounded_and_raii_releases_on_failure() {
        let active = AtomicUsize::new(0);
        let permits: Vec<_> = (0..MAX_READS)
            .map(|_| ReadPermit::acquire(&active).unwrap())
            .collect();
        assert!(ReadPermit::acquire(&active).is_err());
        drop(permits);
        assert_eq!(active.load(Ordering::Acquire), 0);
        let _ = std::panic::catch_unwind(|| {
            let _permit = ReadPermit::acquire(&active).unwrap();
            panic!("simulated read failure");
        });
        assert_eq!(active.load(Ordering::Acquire), 0);
        assert!(ReadPermit::acquire(&active).is_ok());
    }
    #[test]
    fn closed_envelopes_and_bounded_owner() {
        assert!(validate_owner("/project", "turn-1").is_ok());
        for root in ["", "relative", "/project\n"] {
            assert!(validate_owner(root, "turn").is_err());
        }
        for turn in ["", "turn\n", &"x".repeat(257)] {
            assert!(validate_owner("/project", turn).is_err());
        }
        assert!(serde_json::from_value::<TurnChangesRequest>(
            serde_json::json!({"rootPath":"/project","turnId":"turn","command":"id"})
        )
        .is_err());
        assert!(serde_json::from_value::<TurnDiffRequest>(serde_json::json!({"rootPath":"/project","turnId":"turn","relativePath":"a","extra":true})).is_err());
    }
    #[test]
    fn files_are_normalized_relative_and_bounded() {
        assert!(validate_file("src/á file.ts").is_ok());
        for path in [
            "",
            "/etc/passwd",
            "a/../b",
            "a//b",
            ".git/config",
            "A/.GIT/x",
            "a\\b",
            "a\n",
            "C:/x",
        ] {
            assert!(validate_file(path).is_err(), "{path}");
        }
        assert!(validate_file(&vec!["a"; 65].join("/")).is_err());
        assert!(validate_file(&"é".repeat(2049)).is_err());
    }
}
