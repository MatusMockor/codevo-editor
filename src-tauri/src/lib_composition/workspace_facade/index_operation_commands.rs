use super::{
    workspace_index_database_path, AppHandleMetadataScanEventSink, WorkspaceIndexClearResult,
};
use crate::index::{SqliteWorkspaceIndex, WorkspaceIndexMaintenanceStore};
use crate::index_reindex::{
    LocalWorkspaceReindexStarter, WorkspaceReindexRequest, WorkspaceReindexStarter,
};
use crate::index_scan::operation_authority::WorkspaceIndexOperationAuthority;
use crate::index_scan::{InitialMetadataScanStart, MetadataScanEventSink, WorkspaceReindexMode};
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::workspace_registry::{
    ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistrationOperationLease, WorkspaceRegistry,
};
use serde::Deserialize;
use std::{num::NonZeroU32, path::Path, sync::Arc};
use tauri::{AppHandle, Manager, State};

const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const MAX_ROOT_PATH_BYTES: usize = 32_768;
const MAX_WORKSPACE_ID_BYTES: usize = 1_024;
const MAX_LANGUAGE_BYTES: usize = 64;

#[tauri::command]
pub(crate) fn clear_workspace_index(
    request: WorkspaceIndexMutationRequest,
    registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<WorkspaceIndexClearResult, String> {
    validate_mutation_request(&request)?;
    let registration = reserve_mutation(&request, &registry)?;
    let root = registered_request_root(&request, registration.descriptor())?;
    let database_path = workspace_index_database_path(&app, root)?;
    let root_key = root.to_string_lossy().to_string();
    let clear = || {
        let index =
            SqliteWorkspaceIndex::open(&database_path).map_err(|error| error.to_string())?;
        index
            .clear_workspace_files()
            .map(|_| ())
            .map_err(|error| error.to_string())
    };
    match app.try_state::<WorkspaceIndexLifecycle>() {
        Some(index_lifecycle) => registration
            .with_current_commit(|| {
                index_lifecycle.cancel_workspace_and_block_writes(&root_key, clear)
            })
            .map_err(|error| error.to_string())??,
        None => registration
            .with_current_commit(clear)
            .map_err(|error| error.to_string())??,
    }

    Ok(WorkspaceIndexClearResult {
        database_path: database_path.to_string_lossy().to_string(),
        root_path: root_key,
        status: "cleared",
    })
}

#[tauri::command]
pub(crate) fn start_initial_metadata_scan(
    request: StartInitialMetadataScanRequest,
    registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    start_workspace_reindex_operation(
        request.authority,
        request.operation_generation,
        WorkspaceReindexMode::Soft,
        None,
        &registry,
        app,
    )
}

#[tauri::command]
pub(crate) fn start_workspace_reindex(
    request: StartWorkspaceReindexRequest,
    registry: State<'_, WorkspaceRegistry>,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    start_workspace_reindex_operation(
        request.authority,
        request.operation_generation,
        request.mode,
        request.language,
        &registry,
        app,
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartInitialMetadataScanRequest {
    #[serde(flatten)]
    authority: WorkspaceIndexMutationRequest,
    operation_generation: NonZeroU32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartWorkspaceReindexRequest {
    #[serde(flatten)]
    authority: WorkspaceIndexMutationRequest,
    language: Option<String>,
    mode: WorkspaceReindexMode,
    operation_generation: NonZeroU32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceIndexMutationRequest {
    admission_token: u64,
    root_path: String,
    workspace_id: WorkspaceId,
}

fn start_workspace_reindex_operation(
    request: WorkspaceIndexMutationRequest,
    operation_generation: NonZeroU32,
    mode: WorkspaceReindexMode,
    language: Option<String>,
    registry: &WorkspaceRegistry,
    app: AppHandle,
) -> Result<InitialMetadataScanStart, String> {
    validate_mutation_request(&request)?;
    validate_reindex_language(mode, language.as_deref())?;
    let registration = reserve_mutation(&request, registry)?;
    let root = registered_request_root(&request, registration.descriptor())?.to_path_buf();
    let database_path = workspace_index_database_path(&app, &root)?;
    let root_key = root.to_string_lossy().to_string();
    let lifecycle = app
        .try_state::<WorkspaceIndexLifecycle>()
        .ok_or_else(|| "Workspace index lifecycle is unavailable.".to_string())?;
    let operation_authority =
        begin_operation_authority(registration, &lifecycle, &root_key, operation_generation)?;
    let starter = LocalWorkspaceReindexStarter;
    let event_sink: Arc<dyn MetadataScanEventSink> =
        Arc::new(AppHandleMetadataScanEventSink::new(app));

    starter
        .start(
            WorkspaceReindexRequest {
                database_path,
                language,
                mode,
                operation_authority: Some(operation_authority),
                operation_generation,
                root_path: root,
            },
            event_sink,
        )
        .map_err(|error| error.to_string())
}

fn validate_reindex_language(
    mode: WorkspaceReindexMode,
    language: Option<&str>,
) -> Result<(), String> {
    if mode != WorkspaceReindexMode::Language && language.is_none() {
        return Ok(());
    }
    let Some(language) = language else {
        return Err("Index language is invalid.".to_string());
    };
    if mode != WorkspaceReindexMode::Language
        || invalid_bounded_text(language, MAX_LANGUAGE_BYTES)
        || !matches!(language, "javascript" | "php" | "typescript")
    {
        return Err("Index language is invalid.".to_string());
    }
    Ok(())
}

fn begin_operation_authority(
    registration: WorkspaceRegistrationOperationLease,
    lifecycle: &WorkspaceIndexLifecycle,
    root_key: &str,
    operation_generation: NonZeroU32,
) -> Result<WorkspaceIndexOperationAuthority, String> {
    let lifecycle_token = registration
        .with_current_commit(|| {
            lifecycle.begin_workspace_operation(root_key, operation_generation.get())
        })
        .map_err(|error| error.to_string())??;
    WorkspaceIndexOperationAuthority::new(lifecycle_token, registration)
        .map_err(|error| error.to_string())
}

fn validate_mutation_request(request: &WorkspaceIndexMutationRequest) -> Result<(), String> {
    if request.admission_token == 0 || request.admission_token > MAX_JAVASCRIPT_SAFE_INTEGER {
        return Err("Index admission token is invalid.".to_string());
    }
    if invalid_bounded_text(&request.root_path, MAX_ROOT_PATH_BYTES)
        || !Path::new(&request.root_path).is_absolute()
    {
        return Err("Index root path is invalid.".to_string());
    }
    if invalid_bounded_text(request.workspace_id.as_str(), MAX_WORKSPACE_ID_BYTES) {
        return Err("Index workspace id is invalid.".to_string());
    }
    Ok(())
}

fn reserve_mutation(
    request: &WorkspaceIndexMutationRequest,
    registry: &WorkspaceRegistry,
) -> Result<WorkspaceRegistrationOperationLease, String> {
    registry
        .reserve_latest_registration_operation(&request.workspace_id, request.admission_token)
        .map_err(|error| error.to_string())
}

fn invalid_bounded_text(value: &str, max_bytes: usize) -> bool {
    value.is_empty() || value.len() > max_bytes || value.contains('\0')
}

fn registered_request_root<'a>(
    request: &WorkspaceIndexMutationRequest,
    descriptor: &'a ManagedWorkspaceDescriptor,
) -> Result<&'a Path, String> {
    let requested = Path::new(&request.root_path);
    if requested == descriptor.selected_root_path || requested == descriptor.canonical_root_path {
        return Ok(&descriptor.canonical_root_path);
    }
    Err("Index root does not match its registered workspace.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        begin_operation_authority, reserve_mutation, validate_mutation_request,
        validate_reindex_language, StartInitialMetadataScanRequest, StartWorkspaceReindexRequest,
        WorkspaceIndexMutationRequest,
    };
    use crate::index_scan::WorkspaceReindexMode;
    use crate::job_scheduler::WorkspaceIndexLifecycle;
    use crate::workspace_registry::WorkspaceRegistry;
    use serde_json::json;
    use std::{
        fs,
        num::NonZeroU32,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn mutation_requests_require_exact_authority_fields() {
        assert!(
            serde_json::from_value::<WorkspaceIndexMutationRequest>(json!({
                "admissionToken": 7,
                "rootPath": "/workspace",
                "workspaceId": "workspace-1"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<WorkspaceIndexMutationRequest>(json!({
                "admissionToken": 7,
                "rootPath": "/workspace",
                "workspaceId": "workspace-1",
                "unknown": true
            }))
            .is_err()
        );

        for payload in [
            json!({
                "admissionToken": 0,
                "rootPath": "/workspace",
                "workspaceId": "workspace-1"
            }),
            json!({
                "admissionToken": 7,
                "rootPath": "relative",
                "workspaceId": "workspace-1"
            }),
            json!({
                "admissionToken": 7,
                "rootPath": "/workspace",
                "workspaceId": ""
            }),
        ] {
            let request = serde_json::from_value(payload).expect("request shape");
            assert!(validate_mutation_request(&request).is_err());
        }
    }

    #[test]
    fn language_is_utf8_byte_bounded() {
        assert!(
            validate_reindex_language(WorkspaceReindexMode::Language, Some("typescript")).is_ok()
        );
        assert!(
            validate_reindex_language(WorkspaceReindexMode::Language, Some(&"é".repeat(32)))
                .is_err()
        );
        assert!(
            validate_reindex_language(WorkspaceReindexMode::Language, Some(&"é".repeat(33)))
                .is_err()
        );
        assert!(validate_reindex_language(WorkspaceReindexMode::Language, Some("")).is_err());
        assert!(
            validate_reindex_language(WorkspaceReindexMode::Language, Some("php\0foreign"))
                .is_err()
        );
        assert!(validate_reindex_language(WorkspaceReindexMode::Language, None).is_err());
        assert!(validate_reindex_language(WorkspaceReindexMode::Soft, Some("php")).is_err());
    }

    #[test]
    fn initial_scan_request_requires_bounded_generation_and_exact_fields() {
        let request: StartInitialMetadataScanRequest = serde_json::from_value(json!({
            "admissionToken": 7,
            "operationGeneration": 4_294_967_295_u64,
            "rootPath": "/workspace",
            "workspaceId": "workspace-1"
        }))
        .expect("valid request");

        assert_eq!(request.operation_generation.get(), u32::MAX);
        assert!(
            serde_json::from_value::<StartInitialMetadataScanRequest>(json!({
                "admissionToken": 7,
                "operationGeneration": 0,
                "rootPath": "/workspace",
                "workspaceId": "workspace-1"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StartInitialMetadataScanRequest>(json!({
                "admissionToken": 7,
                "operationGeneration": 4_294_967_296_u64,
                "rootPath": "/workspace",
                "workspaceId": "workspace-1"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<StartInitialMetadataScanRequest>(json!({
                "admissionToken": 7,
                "operationGeneration": 7,
                "rootPath": "/workspace",
                "unknown": true,
                "workspaceId": "workspace-1"
            }))
            .is_err()
        );
    }

    #[test]
    fn reindex_request_requires_generation_and_exact_fields() {
        let request: StartWorkspaceReindexRequest = serde_json::from_value(json!({
            "admissionToken": 7,
            "language": "php",
            "mode": "language",
            "operationGeneration": 7,
            "rootPath": "/workspace",
            "workspaceId": "workspace-1"
        }))
        .expect("valid request");

        assert_eq!(request.operation_generation.get(), 7);
        assert!(
            serde_json::from_value::<StartWorkspaceReindexRequest>(json!({
                "admissionToken": 7,
                "language": null,
                "mode": "soft",
                "rootPath": "/workspace",
                "workspaceId": "workspace-1"
            }))
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn mutation_reservation_rejects_replaced_admission() {
        let root = temporary_workspace("index-mutation-stale");
        let registry = WorkspaceRegistry::new();
        let first = registry
            .register_with_receipt(&root)
            .expect("first registration");
        registry
            .register_with_receipt(&root)
            .expect("replacement registration");
        let request: WorkspaceIndexMutationRequest = serde_json::from_value(json!({
            "admissionToken": first.receipt.admission_token,
            "rootPath": first.descriptor.canonical_root_path,
            "workspaceId": first.receipt.workspace_id
        }))
        .expect("request");

        assert!(reserve_mutation(&request, &registry).is_err());

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn replacement_before_lifecycle_begin_cannot_cancel_replacement_root() {
        let root = temporary_workspace("index-begin-stale");
        let registry = WorkspaceRegistry::new();
        let first = registry
            .register_with_receipt(&root)
            .expect("first registration");
        let lease = registry
            .reserve_latest_registration_operation(
                &first.receipt.workspace_id,
                first.receipt.admission_token,
            )
            .expect("operation lease");
        let root_key = first
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .to_string();
        registry
            .register_with_receipt(&root)
            .expect("replacement registration");
        let lifecycle = WorkspaceIndexLifecycle::new();

        assert!(begin_operation_authority(
            lease,
            &lifecycle,
            &root_key,
            NonZeroU32::new(7).expect("generation")
        )
        .is_err());
        assert_eq!(lifecycle.current_generation(&root_key), 0);

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn reordered_generation_cannot_supersede_newer_operation() {
        let root = temporary_workspace("index-generation-order");
        let registry = WorkspaceRegistry::new();
        let registration = registry.register_with_receipt(&root).expect("registration");
        let newer_lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .expect("newer lease");
        let stale_lease = registry
            .reserve_latest_registration_operation(
                &registration.receipt.workspace_id,
                registration.receipt.admission_token,
            )
            .expect("stale lease");
        let root_key = registration
            .descriptor
            .canonical_root_path
            .to_string_lossy()
            .to_string();
        let lifecycle = WorkspaceIndexLifecycle::new();

        let newer = begin_operation_authority(
            newer_lease,
            &lifecycle,
            &root_key,
            NonZeroU32::new(8).expect("generation"),
        )
        .expect("newer operation");
        assert!(begin_operation_authority(
            stale_lease,
            &lifecycle,
            &root_key,
            NonZeroU32::new(7).expect("generation")
        )
        .is_err());
        assert!(newer.is_current());

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    fn temporary_workspace(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("create workspace");
        root
    }
}
