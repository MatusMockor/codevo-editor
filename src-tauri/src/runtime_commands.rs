use crate::lsp_session::{
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRuntimeStatus,
    PhpLanguageServerRegistry, RecentLspRequest,
};
use crate::runtime_observability::{
    self, LanguageRuntimeKind, PsProcessStatsProbe, RuntimeStateSource,
};
use serde_json::Value;
use std::fs;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

struct RegistryRuntimeStateSource {
    kind: LanguageRuntimeKind,
    label: &'static str,
    status: LanguageServerRuntimeStatus,
    pid: Option<u32>,
    recent_requests: Vec<RecentLspRequest>,
    stderr_tail: Vec<String>,
}

impl RuntimeStateSource for RegistryRuntimeStateSource {
    fn kind(&self) -> LanguageRuntimeKind {
        self.kind
    }

    fn label(&self) -> String {
        self.label.to_string()
    }

    fn status(&self) -> LanguageServerRuntimeStatus {
        self.status.clone()
    }

    fn pid(&self) -> Option<u32> {
        self.pid
    }

    fn recent_requests(&self) -> Vec<RecentLspRequest> {
        self.recent_requests.clone()
    }

    fn stderr_tail(&self) -> Vec<String> {
        self.stderr_tail.clone()
    }
}

/// Reads both runtime registries against one captured root so a report cannot
/// combine state from different workspace tabs.
#[tauri::command]
pub(crate) fn get_runtime_observability(
    root_path: String,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<Value, String> {
    let php_source = RegistryRuntimeStateSource {
        kind: LanguageRuntimeKind::Phpactor,
        label: "PHPactor",
        status: php_registry.status(&root_path),
        pid: php_registry.pid(&root_path),
        recent_requests: php_registry.recent_requests(&root_path),
        stderr_tail: php_registry.stderr_tail(&root_path),
    };
    let typescript_source = RegistryRuntimeStateSource {
        kind: LanguageRuntimeKind::Tsserver,
        label: "TypeScript language server",
        status: javascript_typescript_registry.status(&root_path),
        pid: javascript_typescript_registry.pid(&root_path),
        recent_requests: javascript_typescript_registry.recent_requests(&root_path),
        stderr_tail: javascript_typescript_registry.stderr_tail(&root_path),
    };

    let report = runtime_observability::build_runtime_observability_report(
        &root_path,
        &[&php_source as &dyn RuntimeStateSource, &typescript_source],
        &PsProcessStatsProbe,
    );

    serde_json::to_value(report)
        .map_err(|error| format!("Failed to serialize runtime observability: {error}"))
}

#[tauri::command]
pub(crate) fn open_language_runtime_log(
    root_path: String,
    kind: String,
    app: AppHandle,
    php_registry: State<'_, PhpLanguageServerRegistry>,
    javascript_typescript_registry: State<'_, JavaScriptTypeScriptLanguageServerRegistry>,
) -> Result<String, String> {
    let runtime_kind = LanguageRuntimeKind::from_str(&kind)
        .ok_or_else(|| format!("Unknown language runtime kind: {kind}"))?;
    let (runtime_label, log_file_prefix, mut log) = match runtime_kind {
        LanguageRuntimeKind::Phpactor => (
            "PHP language server",
            "php-language-server",
            php_registry.log(&root_path),
        ),
        LanguageRuntimeKind::Tsserver => (
            "JavaScript/TypeScript language server",
            "javascript-typescript-language-server",
            javascript_typescript_registry.log(&root_path),
        ),
    };

    if log.trim().is_empty() {
        log = format!("No {runtime_label} log has been captured for this workspace yet.\n");
    }

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Failed to resolve app log directory: {error}"))?;
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create app log directory: {error}"))?;
    let log_path = log_dir.join(format!(
        "{}-{}.log",
        log_file_prefix,
        sanitized_log_file_stem(&root_path)
    ));

    fs::write(&log_path, log)
        .map_err(|error| format!("Failed to write {runtime_label} log: {error}"))?;
    app.opener()
        .open_path(log_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| format!("Failed to open {runtime_label} log: {error}"))?;

    Ok(log_path.to_string_lossy().to_string())
}

fn sanitized_log_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if stem.is_empty() {
        return "workspace".to_string();
    }

    stem
}

#[cfg(test)]
mod tests {
    use super::sanitized_log_file_stem;

    #[test]
    fn log_file_stem_is_stable_and_cannot_create_path_components() {
        assert_eq!(
            sanitized_log_file_stem("/Users/dev/project one"),
            "Users_dev_project_one"
        );
        assert_eq!(sanitized_log_file_stem("../../"), "workspace");
        assert_eq!(sanitized_log_file_stem("project-a_2"), "project-a_2");
    }
}
