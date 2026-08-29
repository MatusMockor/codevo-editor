#[path = "agent_cli_discovery_commands.rs"]
mod agent_cli_discovery_commands;
#[path = "agent_cli_version_commands.rs"]
mod agent_cli_version_commands;
#[path = "agent_provider_commands.rs"]
mod agent_provider_commands;
#[path = "../agent_provider_sign_in.rs"]
mod agent_provider_sign_in;
#[path = "agent_provider_sign_in_commands.rs"]
mod agent_provider_sign_in_commands;
#[path = "agent_task_commands.rs"]
mod agent_task_commands;
#[path = "agent_thread_store_commands.rs"]
mod agent_thread_store_commands;
#[path = "directory_listing_commands.rs"]
mod directory_listing_commands;
#[path = "git_integration_commands.rs"]
mod git_integration_commands;
#[path = "git_worktree_commands.rs"]
mod git_worktree_commands;
#[path = "language_features_facade.rs"]
mod language_features_facade;
#[path = "language_runtime_facade.rs"]
mod language_runtime_facade;
#[path = "../startup_metrics.rs"]
mod startup_metrics;
#[path = "workspace_facade.rs"]
mod workspace_facade;
#[path = "workspace_services.rs"]
mod workspace_services;

pub(crate) use language_features_facade::{
    javascript_typescript_language_server_execute_command,
    javascript_typescript_language_server_execute_command_locations,
    javascript_typescript_text_document_document_link_resolve,
    javascript_typescript_text_document_document_links,
    javascript_typescript_text_document_document_symbols,
    javascript_typescript_text_document_folding_ranges,
    javascript_typescript_text_document_formatting,
    javascript_typescript_text_document_inlay_hint_resolve,
    javascript_typescript_text_document_inlay_hints,
    javascript_typescript_text_document_on_type_formatting,
    javascript_typescript_text_document_range_formatting,
    javascript_typescript_text_document_range_semantic_tokens,
    javascript_typescript_text_document_selection_ranges,
    javascript_typescript_text_document_signature_help,
    javascript_typescript_workspace_did_change_configuration,
    javascript_typescript_workspace_did_change_watched_files,
    javascript_typescript_workspace_did_create_files,
    javascript_typescript_workspace_did_delete_files,
    javascript_typescript_workspace_did_rename_files,
    javascript_typescript_workspace_will_create_files,
    javascript_typescript_workspace_will_delete_files,
    javascript_typescript_workspace_will_rename_files, language_server_execute_command,
    language_server_execute_command_locations, text_document_document_highlights,
    text_document_document_link_resolve, text_document_document_links,
    text_document_document_symbols, text_document_folding_ranges, text_document_formatting,
    text_document_inlay_hint_resolve, text_document_inlay_hints,
    text_document_linked_editing_ranges, text_document_on_type_formatting,
    text_document_range_formatting, text_document_range_semantic_tokens,
    text_document_selection_ranges, text_document_semantic_tokens, text_document_signature_help,
    text_document_will_create_files, text_document_will_delete_files,
    text_document_will_rename_files, workspace_did_change_configuration,
    workspace_did_change_watched_files, workspace_did_create_files, workspace_did_delete_files,
    workspace_did_rename_files, workspace_symbols,
};
pub(crate) use language_runtime_facade::{
    get_javascript_typescript_language_server_status, get_php_language_server_status,
    javascript_typescript_document_did_change, javascript_typescript_document_did_close,
    javascript_typescript_document_did_open, javascript_typescript_document_did_save,
    javascript_typescript_text_document_code_lens_resolve,
    javascript_typescript_text_document_code_lenses,
    javascript_typescript_text_document_completion,
    javascript_typescript_text_document_completion_resolve,
    javascript_typescript_text_document_hover, javascript_typescript_text_document_incoming_calls,
    javascript_typescript_text_document_outgoing_calls,
    javascript_typescript_text_document_prepare_call_hierarchy,
    javascript_typescript_text_document_prepare_rename,
    javascript_typescript_text_document_prepare_type_hierarchy,
    javascript_typescript_text_document_rename,
    javascript_typescript_text_document_type_hierarchy_subtypes,
    javascript_typescript_text_document_type_hierarchy_supertypes, registered_runtime_root,
    restart_language_runtime, reveal_item_in_dir, set_smart_mode,
    start_javascript_typescript_language_server, start_php_language_server,
    stop_all_javascript_typescript_language_servers, stop_all_php_language_servers,
    stop_javascript_typescript_language_server, stop_language_runtime, stop_php_language_server,
    text_document_code_action_resolve, text_document_code_actions, text_document_code_lens_resolve,
    text_document_code_lenses, text_document_completion, text_document_completion_resolve,
    text_document_declaration, text_document_definition, text_document_did_change,
    text_document_did_close, text_document_did_open, text_document_did_save, text_document_hover,
    text_document_implementation, text_document_incoming_calls, text_document_outgoing_calls,
    text_document_prepare_call_hierarchy, text_document_prepare_rename,
    text_document_prepare_type_hierarchy, text_document_references, text_document_rename,
    text_document_type_definition, text_document_type_hierarchy_subtypes,
    text_document_type_hierarchy_supertypes,
};
#[cfg(test)]
pub(crate) use workspace_facade::filter_lsp_locations_to_workspace;
pub(crate) use workspace_facade::{
    absolute_workspace_candidate, canonicalize_workspace_root, clear_workspace_index,
    dispose_registered_workspace, dispose_workspace_root,
    ensure_lsp_code_action_context_payloads_in_workspace,
    ensure_lsp_code_action_payload_in_workspace, ensure_lsp_path_in_workspace,
    ensure_lsp_position_in_workspace, ensure_lsp_uri_in_workspace,
    filter_bounded_lsp_locations_to_workspace, filter_lsp_code_action_to_workspace,
    filter_lsp_code_actions_to_workspace, filter_lsp_workspace_symbols_to_workspace,
    initialize_workspace_index, local_history_store, open_workspace_from_picker,
    parse_javascript_typescript_navigation_locations_result, parse_php_file_outline,
    parse_php_syntax, register_workspace_path, remove_workspace_index_file,
    resolve_existing_or_parent_path, rollback_workspace_registration, start_initial_metadata_scan,
    start_workspace_file_watch, start_workspace_reindex, stop_workspace_file_watch,
    unregister_workspace, upsert_workspace_index_file, workspace_root_for_disposal,
    LegacyLocalHistoryWorkspaceAuthorizer,
};
#[cfg(target_os = "macos")]
pub(crate) use workspace_facade::{
    CLOSE_ACTIVE_TAB_EVENT, CLOSE_ACTIVE_TAB_MENU_ID, FONT_ZOOM_IN_EVENT, FONT_ZOOM_IN_MENU_ID,
    FONT_ZOOM_OUT_EVENT, FONT_ZOOM_OUT_MENU_ID, FONT_ZOOM_RESET_EVENT, FONT_ZOOM_RESET_MENU_ID,
    NATIVE_CLOSE_REQUEST_EVENT, OPEN_APPEARANCE_SETTINGS_EVENT, OPEN_APPEARANCE_SETTINGS_MENU_ID,
    QUIT_APPLICATION_MENU_ID, TOGGLE_FONT_LIGATURES_EVENT, TOGGLE_FONT_LIGATURES_MENU_ID,
};
pub(crate) use workspace_services::{
    amend_git_commit, begin_project_symbol_search, cancel_project_symbol_search,
    checkout_git_remote_branch, commit_git_changes, create_git_branch, delete_git_branch,
    fetch_git_changes, get_git_current_branch, get_git_file_commit_diff, get_git_file_hunks,
    get_git_stash_diff, get_git_stash_list, get_local_history_version_content,
    get_local_history_versions, get_php_file_outline, get_php_tree, list_git_branches,
    list_git_remote_branches, plan_javascript_typescript_language_server, plan_php_language_server,
    pull_git_changes, push_git_changes, read_directory, read_text_file,
    record_local_history_snapshot, rename_git_branch, revert_git_files, revert_git_hunk,
    reword_git_commit, save_git_stash, search_files, search_project_symbols, search_text,
    stage_git_files, stage_git_hunk, stash_apply_git, stash_drop_git, stash_pop_git,
    switch_git_branch, trusted_for, unstage_git_files, unstage_git_hunk, GitTrustState,
    JavaScriptTypeScriptLanguageServerOptions,
};

#[cfg(test)]
pub(crate) use language_features_facade::javascript_typescript_did_change_configuration_settings;
#[cfg(test)]
pub(crate) use workspace_facade::{
    ensure_lsp_call_hierarchy_item_in_workspace, ensure_lsp_code_lens_payload_in_workspace,
    ensure_lsp_completion_item_payload_in_workspace, ensure_lsp_document_link_payload_in_workspace,
    ensure_lsp_inlay_hint_payload_in_workspace, ensure_lsp_text_document_content_in_workspace,
    ensure_lsp_text_document_path_in_workspace, ensure_lsp_type_hierarchy_item_in_workspace,
    ensure_path_in_workspace, filter_lsp_call_hierarchy_items_to_workspace,
    filter_lsp_code_lenses_to_workspace, filter_lsp_completion_list_to_workspace,
    filter_lsp_document_links_to_workspace, filter_lsp_incoming_calls_to_workspace,
    filter_lsp_inlay_hints_to_workspace, filter_lsp_outgoing_calls_to_workspace,
    filter_lsp_type_hierarchy_items_to_workspace, filter_lsp_workspace_edit_to_workspace,
    normalize_path, register_picker_path_in_registry, register_workspace_path_in_registry,
    reveal_path_in_workspace,
};
#[cfg(test)]
pub(crate) use workspace_services::ensure_local_history_relative_path;

#[path = "runtime.rs"]
mod runtime;

pub use runtime::run;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
