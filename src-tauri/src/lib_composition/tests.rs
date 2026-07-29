use super::{
    amend_git_commit, create_git_branch, delete_git_branch, ensure_local_history_relative_path,
    ensure_lsp_call_hierarchy_item_in_workspace,
    ensure_lsp_code_action_context_payloads_in_workspace,
    ensure_lsp_code_action_payload_in_workspace, ensure_lsp_code_lens_payload_in_workspace,
    ensure_lsp_completion_item_payload_in_workspace, ensure_lsp_document_link_payload_in_workspace,
    ensure_lsp_inlay_hint_payload_in_workspace, ensure_lsp_path_in_workspace,
    ensure_lsp_position_in_workspace, ensure_lsp_text_document_content_in_workspace,
    ensure_lsp_text_document_path_in_workspace, ensure_lsp_type_hierarchy_item_in_workspace,
    ensure_path_in_workspace, fetch_git_changes, filter_lsp_call_hierarchy_items_to_workspace,
    filter_lsp_code_actions_to_workspace, filter_lsp_code_lenses_to_workspace,
    filter_lsp_completion_list_to_workspace, filter_lsp_document_links_to_workspace,
    filter_lsp_incoming_calls_to_workspace, filter_lsp_inlay_hints_to_workspace,
    filter_lsp_locations_to_workspace, filter_lsp_outgoing_calls_to_workspace,
    filter_lsp_type_hierarchy_items_to_workspace, filter_lsp_workspace_edit_to_workspace,
    filter_lsp_workspace_symbols_to_workspace, get_git_current_branch, get_git_file_commit_diff,
    get_git_file_hunks, get_git_stash_diff, get_git_stash_list,
    javascript_typescript_did_change_configuration_settings, list_git_branches, normalize_path,
    parse_javascript_typescript_navigation_locations_result, parse_php_file_outline,
    parse_php_syntax, pull_git_changes, read_directory, read_text_file,
    register_workspace_path_in_registry, rename_git_branch, reveal_path_in_workspace,
    revert_git_hunk, reword_git_commit, save_git_stash, search_files, stage_git_files,
    stage_git_hunk, stash_apply_git, stash_drop_git, stash_pop_git, switch_git_branch,
    unstage_git_hunk, workspace_root_for_disposal, JavaScriptTypeScriptLanguageServerOptions,
    LegacyLocalHistoryWorkspaceAuthorizer,
};
use crate::application_commands::enumerate_monospace_font_families;
use crate::artisan::ArtisanRoutesResponse;
use crate::debug_adapter::{
    DebugEvent, DebugEventSink, DebugLaunchTarget, DebugSessionRegistry, DebugStartResponse,
};
use crate::debug_commands::{
    debug_evaluate_with_trust, debug_start_with_trust, stop_debug_session_blocking,
};
use crate::eslint::{EslintAnalysisResponse, EslintProcessRegistry};
use crate::file_uri_path::path_from_file_uri;
use crate::git_commands::{get_git_blame, get_git_file_history, get_git_status};
use crate::local_history::LocalHistoryStore;
use crate::lsp::file_uri;
use crate::lsp_capability_support::{
    supports_code_action_resolve as lsp_status_supports_code_action_resolve,
    supports_inlay_hint_resolve as lsp_status_supports_inlay_hint_resolve,
};
use crate::lsp_document::{TextDocumentContent, TextDocumentPath};
use crate::lsp_features::parse_definition_result;
use crate::lsp_features::{
    LanguageServerCallHierarchyItem, LanguageServerCodeAction, LanguageServerCodeActionCommand,
    LanguageServerCodeActionContext, LanguageServerCodeLens, LanguageServerCompletionItem,
    LanguageServerCompletionList, LanguageServerDocumentLink, LanguageServerIncomingCall,
    LanguageServerInlayHint, LanguageServerInlayHintLabel, LanguageServerLocation,
    LanguageServerOutgoingCall, LanguageServerPosition, LanguageServerRange,
    LanguageServerTextEdit, LanguageServerTypeHierarchyItem, LanguageServerWorkspaceEdit,
    LanguageServerWorkspaceFileOperation, LanguageServerWorkspaceFileOperationOptions,
    LanguageServerWorkspaceSymbol, TextDocumentPosition,
};
use crate::lsp_incremental_document::canonical_document_identity as canonical_lsp_document_identity;
use crate::lsp_session::{LanguageServerCapabilities, LanguageServerRuntimeStatus};
use crate::lsp_workspace_edit_guard::ensure_lsp_workspace_edit_paths_in_workspace;
use crate::php_file_outline::PhpFileOutlineNodeKind;
use crate::php_test_run::PhpTestRunResponse;
use crate::phpstan::PhpStanAnalysisResponse;
use crate::pint::PintFormatResponse;
use crate::prettier::PrettierFormatResponse;
use crate::quality_commands::{
    run_artisan_route_list_with_trust, run_eslint_analysis_with_trust,
    run_php_tests_junit_with_trust, run_phpstan_analysis_with_trust, run_pint_format_with_trust,
    run_prettier_format_with_trust,
};
use crate::settings_fonts::cached_monospace_font_families;
use crate::trust::WorkspaceTrustService;
use crate::workspace::FileEntryKind;
use crate::workspace_edit_commands::{
    abort_transaction_current_path, apply_descriptor_workspace_edit,
    apply_transactional_descriptor_workspace_edit,
    apply_trusted_transactional_descriptor_workspace_edit,
    apply_trusted_transactional_descriptor_workspace_edit_with_hooks, apply_workspace_edit,
    descriptor_file_identity, descriptor_transaction_file_snapshot, guarded_descriptor_cleanup,
    guarded_descriptor_cleanup_with_terminal_hook,
    with_test_parent_transaction_recovery_byte_limit, with_test_parent_transaction_recovery_limit,
    workspace_text_edits_from_language_server, CommittedTransactionPath, DescriptorTransactionPath,
    StagedTransactionFile, TransactionalWorkspaceEditRequest, MAX_TRANSACTION_AFFECTED_PATHS,
    MAX_TRANSACTION_FILE_OPERATIONS,
};
use crate::workspace_file_commands::WorkspaceEditResult;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use crate::workspace_typescript::build_javascript_typescript_language_server_plan;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::ffi::{CString, OsStr};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Barrier, Mutex, OnceLock};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

include!("test_workspace_transactions.rs");
include!("test_transaction_recovery.rs");
include!("test_git_commands.rs");
include!("test_git_history_and_branches.rs");
include!("test_workspace_guards.rs");
include!("test_runtime_trust.rs");
