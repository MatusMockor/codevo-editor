//! Workspace-edit command façade and transactional descriptor implementation.
//!
//! The implementation fragments share one nested private scope. Only Tauri commands
//! escape in production; the root test module receives an explicit test-only seam.

mod implementation {
    use crate::file_uri_path::path_from_file_uri;
    use crate::lsp_features::{
        LanguageServerPosition, LanguageServerRange, LanguageServerTextEdit,
        LanguageServerWorkspaceEdit, LanguageServerWorkspaceFileOperation,
        LanguageServerWorkspaceFileOperationOptions,
    };
    use crate::lsp_workspace_edit_guard::ensure_lsp_workspace_edit_paths_in_workspace;
    use crate::run_blocking_command;
    use crate::trust::WorkspaceTrustService;
    use crate::workspace::{
        apply_text_edits_to_content, apply_text_edits_to_files, LocalWorkspaceFileRepository,
        WorkspaceFileRepository, WorkspaceTextEdit, WorkspaceTextPosition, WorkspaceTextRange,
    };
    use crate::workspace_file_commands::{
        FileCommandResult, MutationResult, WorkspaceEditResult,
        WorkspaceFileRepository as DescriptorFileRepository,
    };
    use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
    use serde::Serialize;
    #[cfg(test)]
    use std::cell::Cell;
    use std::collections::{BTreeMap, BTreeSet};
    use std::ffi::{CStr, CString};
    use std::fs::{self, File};
    use std::io::{self, Read, Write};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::os::unix::io::{AsRawFd, FromRawFd};
    use std::path::{Component, Path, PathBuf};
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};

    include!("workspace_edit_commands/transaction.rs");
    include!("workspace_edit_commands/descriptor.rs");
}

pub(super) use implementation::{
    apply_workspace_edit, workspace_apply_workspace_edit,
    workspace_apply_workspace_edit_transaction,
};

#[cfg(test)]
pub(super) use implementation::{
    abort_transaction_current_path, apply_descriptor_workspace_edit,
    apply_transactional_descriptor_workspace_edit,
    apply_trusted_transactional_descriptor_workspace_edit,
    apply_trusted_transactional_descriptor_workspace_edit_with_hooks, descriptor_file_identity,
    descriptor_transaction_file_snapshot, guarded_descriptor_cleanup,
    guarded_descriptor_cleanup_with_terminal_hook,
    with_test_parent_transaction_recovery_byte_limit, with_test_parent_transaction_recovery_limit,
    workspace_text_edits_from_language_server, CommittedTransactionPath, DescriptorTransactionPath,
    StagedTransactionFile, TransactionalWorkspaceEditRequest, MAX_TRANSACTION_AFFECTED_PATHS,
    MAX_TRANSACTION_FILE_OPERATIONS,
};
