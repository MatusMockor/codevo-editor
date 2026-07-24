use crate::ensure_lsp_uri_in_workspace;
use crate::lsp_features::{LanguageServerWorkspaceEdit, LanguageServerWorkspaceFileOperation};

pub(crate) fn ensure_lsp_workspace_edit_paths_in_workspace(
    root_path: &str,
    edit: &LanguageServerWorkspaceEdit,
) -> Result<(), String> {
    for uri in edit.changes.keys() {
        ensure_workspace_edit_uri(root_path, uri)?;
    }

    for uri in edit.document_versions.keys() {
        ensure_workspace_edit_uri(root_path, uri)?;
    }

    for operation in &edit.file_operations {
        for uri in workspace_file_operation_uris(operation) {
            ensure_workspace_edit_uri(root_path, uri)?;
        }
    }

    Ok(())
}

pub(crate) fn workspace_file_operation_uris(
    operation: &LanguageServerWorkspaceFileOperation,
) -> Vec<&str> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, .. }
        | LanguageServerWorkspaceFileOperation::Delete { uri, .. } => vec![uri.as_str()],
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri, new_uri, ..
        } => vec![old_uri.as_str(), new_uri.as_str()],
    }
}

fn ensure_workspace_edit_uri(root_path: &str, uri: &str) -> Result<(), String> {
    if !uri.starts_with("file://") {
        return Err("Workspace edit URI must be a file URI.".to_string());
    }

    ensure_lsp_uri_in_workspace(root_path, uri)
}
