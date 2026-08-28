use crate::{
    agent_task_spawner::agent_provider,
    managed_javascript_typescript, managed_phpactor,
    workspace_registry::{
        ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistrationAuthority, WorkspaceRegistry,
    },
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const MAX_ROOT_PATH_BYTES: usize = 32_768;
const MAX_WORKSPACE_ID_BYTES: usize = 1_024;
const MAX_INSTALL_ERROR_BYTES: usize = 4_096;
const INVALID_INSTALL_ERROR: &str = "Managed install failed with an invalid error response.";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManagedInstallRequest {
    root_path: String,
    workspace_id: WorkspaceId,
    admission_token: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedInstallCompletionEvent {
    root_path: String,
    workspace_id: WorkspaceId,
    admission_token: u64,
    error: Option<String>,
}

struct AppHandleManagedPhpactorInstallEventSink {
    app: AppHandle,
    request: ManagedInstallRequest,
}

struct AppHandleManagedTypeScriptInstallEventSink {
    app: AppHandle,
    request: ManagedInstallRequest,
}

impl managed_javascript_typescript::ManagedTypeScriptInstallEventSink
    for AppHandleManagedTypeScriptInstallEventSink
{
    fn emit_completion(&self, root: String, error: Option<String>) {
        let registry = self.app.state::<WorkspaceRegistry>();
        let Some(event) = authorized_completion_event(&registry, &self.request, &root, error)
        else {
            return;
        };
        let _ = self.app.emit(
            managed_javascript_typescript::MANAGED_TYPESCRIPT_LANGUAGE_SERVER_INSTALL_COMPLETED_EVENT,
            event,
        );
    }
}

impl managed_phpactor::ManagedPhpactorInstallEventSink
    for AppHandleManagedPhpactorInstallEventSink
{
    fn emit_completion(&self, root: String, error: Option<String>) {
        let registry = self.app.state::<WorkspaceRegistry>();
        let Some(event) = authorized_completion_event(&registry, &self.request, &root, error)
        else {
            return;
        };
        let _ = self.app.emit(
            managed_phpactor::MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT,
            event,
        );
    }
}

#[tauri::command]
pub(crate) fn install_managed_phpactor(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    request: ManagedInstallRequest,
) -> Result<(), String> {
    let authority = validate_and_claim_request(&registry, &request)?;
    managed_phpactor::spawn_managed_phpactor_install(
        request.root_path.clone(),
        AppHandleManagedPhpactorInstallEventSink { app, request },
    );
    drop(authority);
    Ok(())
}

#[tauri::command]
pub(crate) fn install_managed_typescript_language_server(
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    request: ManagedInstallRequest,
) -> Result<(), String> {
    let authority = validate_and_claim_request(&registry, &request)?;
    managed_javascript_typescript::spawn_managed_typescript_language_server_install(
        request.root_path.clone(),
        AppHandleManagedTypeScriptInstallEventSink { app, request },
    );
    drop(authority);
    Ok(())
}

fn validate_and_claim_request<'a>(
    registry: &'a WorkspaceRegistry,
    request: &ManagedInstallRequest,
) -> Result<WorkspaceRegistrationAuthority<'a>, String> {
    validate_request(request)?;
    let authority = registry
        .claim_latest_registration(&request.workspace_id, request.admission_token)
        .map_err(|error| error.to_string())?;
    if request_root_matches(request, authority.descriptor()) {
        return Ok(authority);
    }
    Err("Managed install root does not match its registered workspace.".to_string())
}

fn authorized_completion_event(
    registry: &WorkspaceRegistry,
    request: &ManagedInstallRequest,
    worker_root: &str,
    error: Option<String>,
) -> Option<ManagedInstallCompletionEvent> {
    if worker_root != request.root_path {
        return None;
    }
    let authority = registry
        .claim_latest_registration(&request.workspace_id, request.admission_token)
        .ok()?;
    if !request_root_matches(request, authority.descriptor()) {
        return None;
    }
    let event = ManagedInstallCompletionEvent {
        root_path: request.root_path.clone(),
        workspace_id: request.workspace_id.clone(),
        admission_token: request.admission_token,
        error: bounded_install_error(error),
    };
    drop(authority);
    Some(event)
}

fn validate_request(request: &ManagedInstallRequest) -> Result<(), String> {
    if request.admission_token == 0 || request.admission_token > MAX_JAVASCRIPT_SAFE_INTEGER {
        return Err("Managed install admission token is invalid.".to_string());
    }
    if request.root_path.is_empty()
        || request.root_path.len() > MAX_ROOT_PATH_BYTES
        || request.root_path.contains('\0')
        || request.root_path.trim() != request.root_path
        || request.root_path.chars().any(char::is_control)
        || !Path::new(&request.root_path).is_absolute()
    {
        return Err("Managed install root path is invalid.".to_string());
    }
    let workspace_id = request.workspace_id.as_str();
    if workspace_id.is_empty()
        || workspace_id.len() > MAX_WORKSPACE_ID_BYTES
        || workspace_id.contains('\0')
        || workspace_id.trim() != workspace_id
        || workspace_id.chars().any(char::is_control)
    {
        return Err("Managed install workspace id is invalid.".to_string());
    }
    Ok(())
}

fn request_root_matches(
    request: &ManagedInstallRequest,
    descriptor: &ManagedWorkspaceDescriptor,
) -> bool {
    let requested_root = Path::new(&request.root_path);
    requested_root == descriptor.selected_root_path
        || requested_root == descriptor.canonical_root_path
}

fn bounded_install_error(error: Option<String>) -> Option<String> {
    let error = error?;
    let sanitized = agent_provider::sanitized_tail(error.as_bytes(), &[])
        .chars()
        .map(|character| {
            if character.is_control() {
                return ' ';
            }
            character
        })
        .collect::<String>();
    let sanitized = bounded_utf8_tail(sanitized.trim(), MAX_INSTALL_ERROR_BYTES);
    if sanitized.is_empty() {
        return Some(INVALID_INSTALL_ERROR.to_string());
    }
    Some(sanitized)
}

fn bounded_utf8_tail(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_string();
    }
    let mut start = value.len() - maximum_bytes;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].trim().to_string()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-managed-install-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn request(
        registration: &crate::workspace_registry::registration::WorkspaceRegistration,
    ) -> ManagedInstallRequest {
        ManagedInstallRequest {
            root_path: registration
                .descriptor
                .canonical_root_path
                .to_string_lossy()
                .to_string(),
            workspace_id: registration.receipt.workspace_id.clone(),
            admission_token: registration.receipt.admission_token,
        }
    }

    #[test]
    fn strict_request_rejects_unknown_fields() {
        let parsed = serde_json::from_value::<ManagedInstallRequest>(json!({
            "rootPath": "/tmp/workspace",
            "workspaceId": "workspace",
            "admissionToken": 1,
            "unexpected": true
        }));

        assert!(parsed.is_err());
    }

    #[test]
    fn same_root_replacement_emits_only_the_exact_latest_registration() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("same-root-replacement");
        let first = registry.register_with_receipt(&root).unwrap();
        let first_request = request(&first);
        validate_and_claim_request(&registry, &first_request).unwrap();
        let replacement = registry.register_with_receipt(&root).unwrap();
        let replacement_request = request(&replacement);
        validate_and_claim_request(&registry, &replacement_request).unwrap();

        let stale_event =
            authorized_completion_event(&registry, &first_request, &first_request.root_path, None);
        let current_event = authorized_completion_event(
            &registry,
            &replacement_request,
            &replacement_request.root_path,
            Some("install failed".to_string()),
        );

        assert_eq!(stale_event, None);
        assert!(!registry.operations_locked_for_test());
        assert_eq!(
            current_event,
            Some(ManagedInstallCompletionEvent {
                root_path: replacement_request.root_path,
                workspace_id: replacement_request.workspace_id,
                admission_token: replacement_request.admission_token,
                error: Some("install failed".to_string()),
            })
        );
    }

    #[test]
    fn completion_rejects_worker_root_drift_and_bounds_errors() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("completion-validation");
        let registration = registry.register_with_receipt(&root).unwrap();
        let request = request(&registration);

        assert_eq!(
            authorized_completion_event(&registry, &request, "/tmp/foreign", None),
            None
        );
        assert_eq!(
            authorized_completion_event(
                &registry,
                &request,
                &request.root_path,
                Some("é".repeat(MAX_INSTALL_ERROR_BYTES)),
            )
            .unwrap()
            .error,
            Some("é".repeat(MAX_INSTALL_ERROR_BYTES / 2))
        );
    }

    #[test]
    fn completion_redacts_closed_secret_patterns_before_publication() {
        let registry = WorkspaceRegistry::new();
        let root = temp_root("completion-redaction");
        let registration = registry.register_with_receipt(&root).unwrap();
        let request = request(&registration);
        let event = authorized_completion_event(
            &registry,
            &request,
            &request.root_path,
            Some(
                "Authorization: Bearer bearer-secret _authToken=npm-secret npm_abcdef123456 api-key=api-secret https://user:password@example.com"
                    .to_string(),
            ),
        )
        .unwrap();
        let error = event.error.unwrap();

        assert!(error.len() <= MAX_INSTALL_ERROR_BYTES);
        assert!(error.contains("[redacted]"));
        for secret in [
            "bearer-secret",
            "npm-secret",
            "npm_abcdef123456",
            "api-secret",
            "user:password",
        ] {
            assert!(!error.contains(secret), "{error}");
        }
    }
}
