#[path = "application_commands.rs"]
mod application_commands;
mod application_menu;
mod artisan;
mod blocking_command;
pub mod composer;
mod debug_adapter;
mod debug_breakpoint_policy;
mod debug_cdp;
mod debug_cdp_breakpoints;
mod debug_cdp_function_breakpoints;
mod debug_commands;
mod debug_dbgp;
mod debug_exception_type_filter;
mod debug_hit_condition;
mod debug_inspector_attach;
mod debug_inspector_discovery;
mod debug_inspector_startup;
mod debug_logpoint;
mod debug_node_attach_list_command;
mod debug_node_attach_start_command;
mod debug_node_env_file;
mod debug_node_launch;
mod debug_node_process;
mod debug_node_watch_start_command;
mod debug_session_registry;
mod debug_source_map;
mod debug_support;
mod eslint;
mod file_fuzzy_matcher;
mod file_uri_path;
pub mod file_watcher;
pub mod git;
mod git_commands;
pub mod ignore_matcher;
pub mod index;
pub mod index_reindex;
pub mod index_scan;
pub mod index_update;
#[cfg(test)]
mod javascript_typescript_real_integration_tests;
pub mod job_scheduler;
mod js_test_commands;
mod js_test_coverage_commands;
mod js_test_execution_root;
mod js_test_run;
mod js_test_tasks;
mod js_test_watch;
pub mod js_ts_file_watcher;
pub mod js_ts_symbols;
pub mod local_history;
mod lsp;
mod lsp_capability_support;
mod lsp_diagnostics;
mod lsp_document;
mod lsp_features;
mod lsp_incremental_document;
mod lsp_request_commands;
mod lsp_session;
mod lsp_transport;
mod lsp_workspace_edit_guard;
mod managed_install_commands;
mod managed_javascript_typescript;
mod managed_phpactor;
mod node_package_problem_matcher;
mod node_package_scripts;
mod node_package_tasks;
mod node_run_tasks;
mod package_commands;
mod package_tool_context;
pub mod php_file_outline;
pub mod php_parser;
pub mod php_symbols;
mod php_test_run;
pub mod php_tree;
mod phpstan;
mod pint;
mod prettier;
#[cfg_attr(test, allow(dead_code))]
mod process_task_plan;
mod process_task_resolver;
#[cfg_attr(test, allow(dead_code))]
mod process_task_runtime;
mod project;
mod project_commands;
mod quality_commands;
mod runtime_commands;
mod runtime_observability;
mod runtime_task_lifecycle;
mod search;
mod settings_fonts;
mod smart_mode;
mod symfony_commands;
mod terminal;
mod terminal_commands;
mod terminal_process_tree;
mod terminal_session;
mod terminal_session_events;
mod terminal_task_admission;
mod terminal_task_process;
mod test_run_support;
mod tools;
mod trust;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_commands;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_events;
#[cfg_attr(test, allow(dead_code))]
mod vscode_process_task_registry;
mod vscode_process_task_tauri;
mod vscode_process_tasks;
mod vscode_tasks_discovery;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod vscode_tasks_discovery_command;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
#[path = "vscode_tasks_discovery_unsupported.rs"]
mod vscode_tasks_discovery_command;
mod workspace;
mod workspace_commands;
mod workspace_directory_commands;
mod workspace_edit_commands;
mod workspace_file_commands;
pub mod workspace_file_watcher;
mod workspace_registry;
mod workspace_runtime;
mod workspace_source_discovery;
mod workspace_test_discovery;
mod workspace_trust_commands;
mod workspace_typescript;

#[cfg(target_os = "macos")]
use crate::application_menu::application_menu;
pub(crate) use crate::blocking_command::run_blocking_command;
use crate::debug_commands::*;
use crate::debug_node_attach_list_command::debug_list_node_attach_candidates;
use crate::debug_node_attach_start_command::debug_start_node_attach_candidate;
use crate::runtime_task_lifecycle::{shutdown_runtime_processes, RuntimeTaskLifecycleExt as _};
use crate::settings_fonts::cached_monospace_font_families;

#[cfg(test)]
use crate::application_commands::enumerate_monospace_font_families;
use crate::application_commands::{
    confirm_native_shutdown, list_monospace_font_families, quit_application,
    set_native_close_listener_ready, NativeCloseListenerState,
};

use crate::debug_adapter::DebugSessionRegistry;
use crate::file_uri_path::path_from_file_uri;
use crate::git::{
    safe_stash_index, CommandGitRepositoryGateway, GitBranch, GitChangedFile, GitCommit,
    GitDiffHunk, GitFileDiff, GitRepositoryGateway, GitStashEntry, GitStatus,
};
use crate::git_commands::{
    cherry_pick_git_commit, detect_git_repositories, get_git_blame, get_git_branches,
    get_git_commit_details, get_git_commit_diff, get_git_commit_files, get_git_commit_graph_page,
    get_git_commit_log, get_git_diff, get_git_file_history, get_git_repo_status, get_git_status,
    revert_git_commit,
};
use crate::index::{
    workspace_index_path, ProjectSymbolSearchResult, SqliteWorkspaceIndex, WorkspaceFileRecord,
    WorkspaceIndexMaintenanceStore, WorkspaceIndexStore, WorkspaceIndexSummary,
    WorkspacePhpFileOutlineStore, WorkspacePhpTreeStore, WorkspaceSymbolSearchStore,
};
use crate::index_reindex::{
    LocalWorkspaceReindexStarter, WorkspaceReindexRequest, WorkspaceReindexStarter,
};
use crate::index_scan::{
    IndexProgressEvent, InitialMetadataScanStart, MetadataScanCompletionEvent,
    MetadataScanEventSink, WorkspaceReindexMode, INDEX_PROGRESS_EVENT,
    METADATA_SCAN_COMPLETED_EVENT,
};
use crate::job_scheduler::WorkspaceIndexLifecycle;
use crate::js_test_run::batch::JsTestBatchRegistry;
use crate::js_ts_file_watcher::JavaScriptTypeScriptWorkspaceWatchRegistry;
use crate::local_history::{LocalHistoryStore, LocalHistoryVersion};
use crate::lsp::{
    JsonRpcNotification, JsonRpcRequest, LanguageServerCommand, LanguageServerPlan,
    LanguageServerPlanStatus, LanguageServerPlanner, PhpLanguageServerSettings,
    PhpactorLanguageServerPlanner,
};
use crate::lsp_capability_support::{
    supports_code_action_resolve as lsp_status_supports_code_action_resolve,
    supports_inlay_hint_resolve as lsp_status_supports_inlay_hint_resolve,
};
use crate::lsp_document::{
    LspTextDocumentSyncNotificationFactory, TextDocumentContent, TextDocumentPath,
    TextDocumentSyncNotificationFactory,
};
use crate::lsp_features::{
    parse_call_hierarchy_items_result, parse_code_action_result, parse_completion_item_result,
    parse_completion_result, parse_definition_result, parse_document_highlights_result,
    parse_document_links_result, parse_document_symbols_result, parse_folding_ranges_result,
    parse_formatting_result, parse_hover_result, parse_incoming_calls_result,
    parse_inlay_hint_result, parse_inlay_hints_result, parse_linked_editing_ranges_result,
    parse_optional_workspace_edit_result, parse_outgoing_calls_result, parse_prepare_rename_result,
    parse_resolved_code_action_result, parse_selection_ranges_result, parse_semantic_tokens_result,
    parse_signature_help_result, parse_type_hierarchy_items_result, parse_workspace_edit_result,
    parse_workspace_symbols_result, validate_code_action_context,
    validate_code_action_request_range, validate_code_action_resolve_request,
    LanguageServerCallHierarchyItem, LanguageServerCodeAction, LanguageServerCodeActionCommand,
    LanguageServerCodeActionContext, LanguageServerCodeLens, LanguageServerCompletionContext,
    LanguageServerCompletionItem, LanguageServerCompletionList, LanguageServerDocumentHighlight,
    LanguageServerDocumentLink, LanguageServerDocumentSymbol, LanguageServerFoldingRange,
    LanguageServerFormattingOptions, LanguageServerHover, LanguageServerIncomingCall,
    LanguageServerInlayHint, LanguageServerInlayHintLabel, LanguageServerLinkedEditingRanges,
    LanguageServerLocation, LanguageServerOutgoingCall, LanguageServerPosition,
    LanguageServerPrepareRenameResult, LanguageServerRange, LanguageServerSelectionRange,
    LanguageServerSemanticTokens, LanguageServerSignatureHelp, LanguageServerSignatureHelpContext,
    LanguageServerTextEdit, LanguageServerTypeHierarchyItem, LanguageServerWorkspaceEdit,
    LanguageServerWorkspaceSymbol, LspTextDocumentFeatureRequestFactory, TextDocumentCompletion,
    TextDocumentFeatureRequestFactory, TextDocumentFormatting, TextDocumentInlayHintRange,
    TextDocumentOnTypeFormatting, TextDocumentPosition, TextDocumentRange,
    TextDocumentRangeFormatting, TextDocumentRename, TextDocumentSelectionRange,
    TextDocumentSignatureHelp, WorkspaceFileChange, WorkspaceFileCreate, WorkspaceFileDelete,
    WorkspaceFileRename,
};
use crate::lsp_incremental_document::{
    canonical_document_identity as canonical_lsp_document_identity,
    javascript_typescript_document_did_change_bounded,
    javascript_typescript_document_did_close_bounded,
    javascript_typescript_document_did_open_bounded, DocumentChangeAdmissionRegistry,
};
use crate::lsp_session::{
    language_server_status_payload, AppHandleEventSink, ChildServerProcessSpawner, DiagnosticsSink,
    JavaScriptTypeScriptLanguageServerRegistry, LanguageServerRequestError,
    LanguageServerRuntimeStatus, PhpLanguageServerRegistry, RefreshSink, RestartController,
    StatusSink, WorkspaceEditSink,
};
use crate::lsp_workspace_edit_guard::{
    ensure_lsp_workspace_edit_paths_in_workspace, workspace_file_operation_uris,
};
use crate::php_file_outline::{
    build_php_file_outline, php_symbol_outline_record, PhpFileOutline, PhpFileOutlineSymbolRecord,
};
use crate::php_parser::{PhpSyntaxDiagnostic, PhpSyntaxParser, TreeSitterPhpParser};
use crate::php_symbols::{PhpSymbolExtractor, TreeSitterPhpSymbolExtractor};
use crate::php_tree::PhpTree;
use crate::project::{ComposerWorkspaceDetector, WorkspaceDetector};
use crate::search::{RipgrepTextSearcher, TextSearchOptions, TextSearchResult, TextSearcher};
use crate::smart_mode::{IntelligenceMode, SmartModeService, SmartModeState};
use crate::terminal_session::TerminalSupervisor;
use crate::tools::{LocalPhpToolDetector, PhpToolDetector};
use crate::trust::WorkspaceTrustService;
use crate::workspace::{
    FileEntry, FileSearchResult, LocalWorkspaceFileRepository, WorkspaceFileRepository,
};
#[cfg(test)]
use crate::workspace_edit_commands::{
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
use crate::workspace_edit_commands::{
    apply_workspace_edit, workspace_apply_workspace_edit,
    workspace_apply_workspace_edit_transaction,
};
use crate::workspace_file_watcher::WorkspaceFileChangeWatchRegistry;
use crate::workspace_registry::{ManagedWorkspaceDescriptor, WorkspaceId, WorkspaceRegistry};
use crate::workspace_runtime::{
    dispose_workspace_root as dispose_workspace_runtime_root, WorkspaceRuntimeDisposal,
};
#[cfg(test)]
use crate::workspace_typescript::build_javascript_typescript_language_server_plan;
use crate::workspace_typescript::{
    build_javascript_typescript_language_server_plan_with_trust,
    capture_javascript_typescript_workspace_trust,
    revalidate_javascript_typescript_workspace_trust,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    io,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
mod lib_composition;

pub use lib_composition::run;
pub(crate) use lib_composition::{
    absolute_workspace_candidate, canonicalize_workspace_root,
    ensure_lsp_code_action_context_payloads_in_workspace,
    ensure_lsp_code_action_payload_in_workspace, ensure_lsp_path_in_workspace,
    ensure_lsp_position_in_workspace, ensure_lsp_uri_in_workspace,
    filter_lsp_code_action_to_workspace, filter_lsp_code_actions_to_workspace,
    filter_lsp_locations_to_workspace, filter_lsp_workspace_symbols_to_workspace,
    local_history_store, parse_javascript_typescript_navigation_locations_result,
    registered_runtime_root, resolve_existing_or_parent_path, trusted_for,
    workspace_root_for_disposal, GitTrustState, JavaScriptTypeScriptLanguageServerOptions,
    LegacyLocalHistoryWorkspaceAuthorizer,
};
#[cfg(target_os = "macos")]
pub(crate) use lib_composition::{
    CLOSE_ACTIVE_TAB_MENU_ID, FONT_ZOOM_IN_MENU_ID, FONT_ZOOM_OUT_MENU_ID, FONT_ZOOM_RESET_MENU_ID,
    OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID, TOGGLE_FONT_LIGATURES_MENU_ID,
};
