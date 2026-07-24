use crate::debug_cdp::{
    NodeAttachCandidateList, NodeAttachCandidatePickerItem, NodeAttachCandidatePublicationRegistry,
};
use crate::debug_session_registry::{
    retain_workspace_root, retained_workspace_authority, DebugWorkspaceAuthority,
    RetainedDebugWorkspaceRoot,
};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const MAX_ROOT_PATH_BYTES: usize = 32 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NodeDebugAttachCandidateListRequest {
    root_path: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) enum NodeDebugAttachCandidateListResult {
    Ok {
        candidates: Vec<NodeDebugAttachCandidateWire>,
        truncated: bool,
    },
    Unavailable,
    Error,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeDebugAttachCandidateWire {
    candidate_lease_id: String,
    label: String,
    detail: String,
    port: u16,
}

impl From<NodeAttachCandidatePickerItem> for NodeDebugAttachCandidateWire {
    fn from(candidate: NodeAttachCandidatePickerItem) -> Self {
        Self {
            candidate_lease_id: candidate.lease_id,
            label: candidate.label,
            detail: candidate.detail,
            port: candidate.port,
        }
    }
}

#[tauri::command]
pub(crate) async fn debug_list_node_attach_candidates(
    request: NodeDebugAttachCandidateListRequest,
    app: AppHandle,
    publications: State<'_, Arc<NodeAttachCandidatePublicationRegistry>>,
) -> Result<NodeDebugAttachCandidateListResult, String> {
    if !valid_root_path(&request.root_path) {
        return Ok(NodeDebugAttachCandidateListResult::Error);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, publications);
        return Ok(NodeDebugAttachCandidateListResult::Unavailable);
    }

    #[cfg(target_os = "macos")]
    {
        let worker_publications = Arc::clone(publications.inner());
        let worker_app = app.clone();
        let root_path = request.root_path;
        let listing = crate::run_blocking_command(move || {
            let workspace_registry = worker_app.state::<WorkspaceRegistry>();
            let trust = worker_app.state::<Mutex<WorkspaceTrustService>>();
            let (retained, trust_snapshot) =
                retain_trusted_workspace(&workspace_registry, &trust, &root_path)
                    .map_err(|_| "Node attach candidate listing failed.".to_string())?;
            let transaction = worker_publications
                .begin_listing()
                .map_err(|_| "Node attach candidate listing failed.".to_string())?;
            let terminals = worker_app.state::<crate::terminal_session::TerminalSupervisor>();
            let result = transaction.list_from_workspace(Arc::clone(&retained), &terminals, || {
                trust_snapshot_current(&trust, &trust_snapshot)
            });
            if result.is_err()
                || revalidate_workspace(
                    &workspace_registry,
                    &root_path,
                    &retained,
                    &trust_snapshot.root_path,
                )
                .is_err()
            {
                return Err("Node attach candidate listing failed.".to_string());
            }
            let trust_guard = trust
                .lock()
                .map_err(|_| "Node attach candidate listing failed.".to_string())?;
            if trust_guard.snapshot(&trust_snapshot.root_path) != trust_snapshot {
                drop(trust_guard);
                return Err("Node attach candidate listing failed.".to_string());
            }
            transaction
                .commit()
                .map_err(|_| "Node attach candidate listing failed.".to_string())?;
            drop(trust_guard);
            result.map_err(|_| "Node attach candidate listing failed.".to_string())
        })
        .await;

        let listing = match listing {
            Ok(listing) => listing,
            Err(_) => return Ok(NodeDebugAttachCandidateListResult::Error),
        };
        Ok(ok_result(listing))
    }
}

fn valid_root_path(root_path: &str) -> bool {
    !root_path.is_empty()
        && root_path.len() <= MAX_ROOT_PATH_BYTES
        && !root_path.chars().any(char::is_control)
}

fn retain_trusted_workspace(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    root_path: &str,
) -> Result<
    (
        Arc<RetainedDebugWorkspaceRoot>,
        crate::trust::WorkspaceTrustSnapshot,
    ),
    (),
> {
    let retained = Arc::new(retain_workspace_root(registry, root_path).map_err(|_| ())?);
    let root_key = retained
        .live_path()
        .map_err(|_| ())?
        .to_str()
        .ok_or(())?
        .to_owned();
    let DebugWorkspaceAuthority::RetainedWorkspace { canonical_root, .. } = &retained.authority
    else {
        return Err(());
    };
    if canonical_root != &root_key
        || retained_workspace_authority(registry, root_path).map_err(|_| ())? != retained.authority
    {
        return Err(());
    }
    let snapshot = trust.lock().map_err(|_| ())?.snapshot(&root_key);
    if !snapshot.trusted || snapshot.root_path != root_key {
        return Err(());
    }
    Ok((retained, snapshot))
}

fn revalidate_workspace(
    registry: &WorkspaceRegistry,
    root_path: &str,
    retained: &RetainedDebugWorkspaceRoot,
    root_key: &str,
) -> Result<(), ()> {
    if retained.live_path().map_err(|_| ())?.to_str() != Some(root_key)
        || retained_workspace_authority(registry, root_path).map_err(|_| ())? != retained.authority
    {
        return Err(());
    }
    Ok(())
}

fn trust_snapshot_current(
    trust: &Mutex<WorkspaceTrustService>,
    expected: &crate::trust::WorkspaceTrustSnapshot,
) -> Result<(), crate::debug_cdp::NodeAttachCandidateListClosed> {
    let current = trust
        .lock()
        .map_err(|_| crate::debug_cdp::NodeAttachCandidateListClosed)?
        .snapshot(&expected.root_path);
    if current == *expected && current.trusted {
        Ok(())
    } else {
        Err(crate::debug_cdp::NodeAttachCandidateListClosed)
    }
}

fn ok_result(listing: NodeAttachCandidateList) -> NodeDebugAttachCandidateListResult {
    NodeDebugAttachCandidateListResult::Ok {
        candidates: listing.candidates.into_iter().map(Into::into).collect(),
        truncated: listing.truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::Duration;

    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: std::path::PathBuf,
        registry: WorkspaceRegistry,
        trust: Arc<Mutex<WorkspaceTrustService>>,
    }

    impl Fixture {
        fn new() -> Self {
            let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "editor-node-attach-list-command-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&root).expect("create fixture");
            let registry = WorkspaceRegistry::new();
            registry.register(&root).expect("register fixture");
            let mut trust =
                WorkspaceTrustService::load(root.join("trust.json")).expect("load trust");
            trust
                .set(root.to_str().expect("UTF-8 root"), true)
                .expect("trust fixture");
            Self {
                root,
                registry,
                trust: Arc::new(Mutex::new(trust)),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn request_and_result_are_exact_redacted_wire_contracts() {
        assert!(
            serde_json::from_value::<NodeDebugAttachCandidateListRequest>(json!({
                "rootPath": "/workspace"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<NodeDebugAttachCandidateListRequest>(json!({
                "rootPath": "/workspace",
                "extra": true
            }))
            .is_err()
        );

        let result = ok_result(NodeAttachCandidateList {
            candidates: vec![NodeAttachCandidatePickerItem {
                lease_id: "0123456789abcdef0123456789abcdef".to_string(),
                label: "Node 42".to_string(),
                detail: "Integrated terminal · 127.0.0.1:9229".to_string(),
                port: 9_229,
            }],
            truncated: true,
        });
        assert_eq!(
            serde_json::to_value(result).expect("serialize result"),
            json!({
                "status": "ok",
                "candidates": [{
                    "candidateLeaseId": "0123456789abcdef0123456789abcdef",
                    "label": "Node 42",
                    "detail": "Integrated terminal · 127.0.0.1:9229",
                    "port": 9229
                }],
                "truncated": true
            })
        );
        assert_eq!(
            serde_json::to_value(NodeDebugAttachCandidateListResult::Unavailable)
                .expect("serialize unavailable"),
            json!({"status": "unavailable"})
        );
        assert_eq!(
            serde_json::to_value(NodeDebugAttachCandidateListResult::Error)
                .expect("serialize error"),
            json!({"status": "error"})
        );
    }

    #[test]
    fn authority_requires_registered_exact_live_root_and_trust() {
        let fixture = Fixture::new();
        let root = fixture.root.to_str().expect("UTF-8 root");
        assert!(retain_trusted_workspace(&fixture.registry, &fixture.trust, root).is_ok());

        fixture
            .trust
            .lock()
            .expect("trust lock")
            .set(root, false)
            .expect("revoke trust");
        assert!(retain_trusted_workspace(&fixture.registry, &fixture.trust, root).is_err());
        assert!(
            retain_trusted_workspace(&fixture.registry, &fixture.trust, &format!("{root}/."))
                .is_err()
        );
    }

    #[test]
    fn retained_authority_rejects_unregister_and_root_replacement() {
        let fixture = Fixture::new();
        let root_text = fixture.root.to_str().expect("UTF-8 root").to_string();
        let (retained, trust_snapshot) =
            retain_trusted_workspace(&fixture.registry, &fixture.trust, &root_text)
                .expect("retain trusted root");
        let descriptor = fixture
            .registry
            .descriptor_for_registered_path(&fixture.root)
            .expect("descriptor");
        fixture
            .registry
            .unregister(&descriptor.workspace_id)
            .expect("unregister");
        let moved = fixture.root.with_extension("moved");
        fs::rename(&fixture.root, &moved).expect("rename retained root");
        fs::create_dir(&fixture.root).expect("replace selected path");

        assert!(revalidate_workspace(
            &fixture.registry,
            &root_text,
            &retained,
            &trust_snapshot.root_path,
        )
        .is_err());
        fs::remove_dir(&fixture.root).expect("remove replacement");
        fs::rename(moved, &fixture.root).expect("restore fixture");
    }

    #[test]
    fn trust_revoke_and_regrant_complete_during_blocked_work_and_aba_is_rejected() {
        let fixture = Fixture::new();
        let root = fixture.root.to_str().expect("UTF-8 root").to_string();
        let trust = Arc::clone(&fixture.trust);
        let expected = trust.lock().expect("trust lock").snapshot(&root);
        let (blocked_sender, blocked_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let worker_trust = Arc::clone(&trust);
        let worker = std::thread::spawn(move || {
            blocked_sender.send(()).expect("announce blocked work");
            release_receiver
                .recv_timeout(Duration::from_secs(1))
                .expect("release blocked work");
            trust_snapshot_current(&worker_trust, &expected)
        });
        blocked_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("work reached blocking boundary");

        {
            let mut service = trust.try_lock().expect("network work holds no trust lock");
            service.set(&root, false).expect("revoke");
            service.set(&root, true).expect("regrant");
        }
        release_sender.send(()).expect("release worker");
        assert!(worker.join().expect("worker").is_err());
    }
}
