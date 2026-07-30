mod command_facades;

pub use command_facades::run;
pub(crate) use command_facades::{
    absolute_workspace_candidate, canonicalize_workspace_root,
    ensure_lsp_code_action_context_payloads_in_workspace,
    ensure_lsp_code_action_payload_in_workspace, ensure_lsp_path_in_workspace,
    ensure_lsp_position_in_workspace, ensure_lsp_uri_in_workspace,
    filter_bounded_lsp_locations_to_workspace, filter_lsp_code_action_to_workspace,
    filter_lsp_code_actions_to_workspace, filter_lsp_workspace_symbols_to_workspace,
    local_history_store, parse_javascript_typescript_navigation_locations_result,
    registered_runtime_root, resolve_existing_or_parent_path, trusted_for,
    workspace_root_for_disposal, GitTrustState, JavaScriptTypeScriptLanguageServerOptions,
    LegacyLocalHistoryWorkspaceAuthorizer,
};
#[cfg(target_os = "macos")]
pub(crate) use command_facades::{
    CLOSE_ACTIVE_TAB_MENU_ID, FONT_ZOOM_IN_MENU_ID, FONT_ZOOM_OUT_MENU_ID, FONT_ZOOM_RESET_MENU_ID,
    OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID, TOGGLE_FONT_LIGATURES_MENU_ID,
};
