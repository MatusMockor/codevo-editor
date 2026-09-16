use super::{commands::blocking, instruction_collection, instruction_wire::InstructionSnapshot};
use crate::{trust::WorkspaceTrustService, workspace_registry::WorkspaceRegistry};
use serde::Deserialize;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};
use tauri::Manager;

static ACTIVE_COLLECTIONS: AtomicUsize = AtomicUsize::new(0);

struct CollectionPermit;

impl CollectionPermit {
    fn acquire() -> Result<Self, String> {
        ACTIVE_COLLECTIONS
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 2).then_some(count + 1)
            })
            .map(|_| Self)
            .map_err(|_| "Instruction collection is busy; retry shortly".into())
    }
}

impl Drop for CollectionPermit {
    fn drop(&mut self) {
        ACTIVE_COLLECTIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectInstructionsRequest {
    root_path: Option<String>,
}

#[tauri::command]
pub async fn remote_runner_collect_instructions(
    app: tauri::AppHandle,
    request: CollectInstructionsRequest,
) -> Result<InstructionSnapshot, String> {
    let permit = CollectionPermit::acquire()?;
    blocking(move || {
        let _permit = permit;
        let registry = app.state::<WorkspaceRegistry>();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        collect(&registry, &trust, request)
    })
    .await
}

fn collect(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: CollectInstructionsRequest,
) -> Result<InstructionSnapshot, String> {
    collect_using(
        registry,
        trust,
        request,
        instruction_collection::collect_instructions_from_root,
    )
}

fn collect_using(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    request: CollectInstructionsRequest,
    read: impl FnOnce(Option<&std::fs::File>) -> Result<InstructionSnapshot, String>,
) -> Result<InstructionSnapshot, String> {
    let Some(root_path) = request.root_path else {
        let snapshot = read(None)?;
        snapshot.validate()?;
        return Ok(snapshot);
    };
    if root_path.is_empty() || root_path.len() > 4096 || root_path.contains('\0') {
        return Err("Invalid instruction workspace root".into());
    }
    let path = Path::new(&root_path);
    let descriptor = registry
        .descriptor_for_registered_path(path)
        .map_err(|_| "Instruction workspace is not registered")?;
    let canonical = descriptor
        .canonical_root_path
        .to_str()
        .ok_or("Invalid instruction workspace path")?;
    let expected_trust = trust
        .lock()
        .map_err(|_| "Workspace trust unavailable")?
        .snapshot(canonical);
    if !expected_trust.trusted {
        return Err("Trust this workspace before synchronizing its instructions".into());
    }
    let root = registry
        .clone_root_for_path(path)
        .map_err(|_| "Instruction workspace identity changed")?;
    let snapshot = read(Some(&root))?;
    let current = registry
        .descriptor_for_registered_path(path)
        .map_err(|_| "Instruction workspace is no longer registered")?;
    if current != descriptor {
        return Err("Instruction workspace changed during collection".into());
    }
    let current_root = registry
        .clone_root_for_path(path)
        .map_err(|_| "Instruction workspace identity changed")?;
    use std::os::unix::fs::MetadataExt;
    let original = root
        .metadata()
        .map_err(|_| "Instruction workspace unavailable")?;
    let current = current_root
        .metadata()
        .map_err(|_| "Instruction workspace unavailable")?;
    let visible = std::fs::metadata(&descriptor.canonical_root_path)
        .map_err(|_| "Instruction workspace path changed")?;
    if [current, visible]
        .iter()
        .any(|metadata| metadata.dev() != original.dev() || metadata.ino() != original.ino())
    {
        return Err("Instruction workspace identity changed".into());
    }
    if trust
        .lock()
        .map_err(|_| "Workspace trust unavailable")?
        .snapshot(canonical)
        != expected_trust
    {
        return Err("Workspace trust changed during instruction collection".into());
    }
    snapshot.validate()?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collection_rejects_unregistered_and_invalid_roots() {
        let registry = WorkspaceRegistry::new();
        let path = std::env::temp_dir().join(format!(
            "codevo-instruction-trust-{}-absent.json",
            std::process::id()
        ));
        let trust = Mutex::new(WorkspaceTrustService::load(path).unwrap());
        for root in ["", "\0", "/unregistered", &"x".repeat(4097)] {
            assert!(collect(
                &registry,
                &trust,
                CollectInstructionsRequest {
                    root_path: Some(root.into())
                }
            )
            .is_err());
        }
        assert!(serde_json::from_value::<CollectInstructionsRequest>(
            serde_json::json!({"rootPath":"/tmp","command":"x"})
        )
        .is_err());
    }
    #[test]
    fn collection_requires_trust_and_rejects_revocation_during_read() {
        let fixture = std::env::temp_dir().join(format!(
            "codevo-instruction-authority-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&fixture).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&fixture).unwrap();
        let root = descriptor.canonical_root_path.to_str().unwrap();
        let trust = Mutex::new(WorkspaceTrustService::load(fixture.join("trust.json")).unwrap());
        let request = || CollectInstructionsRequest {
            root_path: Some(root.into()),
        };
        assert!(collect_using(&registry, &trust, request(), |_| panic!("untrusted read")).is_err());
        trust.lock().unwrap().set(root, true).unwrap();
        assert!(collect_using(&registry, &trust, request(), |file| {
            assert!(file.is_some());
            trust.lock().unwrap().set(root, false).unwrap();
            trust.lock().unwrap().set(root, true).unwrap();
            Ok(InstructionSnapshot {
                version: 1,
                files: vec![],
            })
        })
        .unwrap_err()
        .contains("trust changed"));
        let moved = fixture.with_extension("moved");
        assert!(collect_using(&registry, &trust, request(), |_| {
            std::fs::rename(&fixture, &moved).unwrap();
            std::fs::create_dir(&fixture).unwrap();
            Ok(InstructionSnapshot {
                version: 1,
                files: vec![],
            })
        })
        .unwrap_err()
        .contains("identity changed"));
        std::fs::remove_dir_all(fixture).unwrap();
        std::fs::remove_dir_all(moved).unwrap();
    }
}
