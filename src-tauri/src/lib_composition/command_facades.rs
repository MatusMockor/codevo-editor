#[path = "agent_attachment_commands.rs"]
mod agent_attachment_commands;
#[path = "agent_cli_discovery_commands.rs"]
mod agent_cli_discovery_commands;
#[path = "agent_file_source_commands.rs"]
mod agent_file_source_commands;
#[path = "agent_image_source_commands.rs"]
mod agent_image_source_commands;
#[path = "agent_inline_image_commands.rs"]
mod agent_inline_image_commands;
#[path = "agent_linked_file_commands.rs"]
mod agent_linked_file_commands;
#[path = "agent_output_artifact_commands.rs"]
mod agent_output_artifact_commands;
#[path = "agent_provider_commands.rs"]
mod agent_provider_commands;
#[path = "../agent_provider_sign_in.rs"]
mod agent_provider_sign_in;
#[path = "agent_provider_sign_in_commands.rs"]
mod agent_provider_sign_in_commands;
#[path = "agent_provider_usage_commands.rs"]
mod agent_provider_usage_commands;
#[path = "agent_session_history_commands.rs"]
mod agent_session_history_commands;
#[path = "agent_task_commands.rs"]
mod agent_task_commands;
#[path = "agent_thread_store_commands.rs"]
mod agent_thread_store_commands;
#[path = "agent_turn_log_commands.rs"]
mod agent_turn_log_commands;
#[path = "app_update_check_commands.rs"]
mod app_update_check_commands;
#[path = "codex_limit_reset_commands.rs"]
mod codex_limit_reset_commands;
#[path = "directory_listing_commands.rs"]
mod directory_listing_commands;
#[path = "git_integration_commands.rs"]
mod git_integration_commands;
#[path = "git_surface_commands.rs"]
mod git_surface_commands;
#[path = "git_working_tree_commands.rs"]
mod git_working_tree_commands;
#[path = "git_worktree_commands.rs"]
mod git_worktree_commands;
#[cfg(target_os = "macos")]
#[path = "../macos_text_substitution.rs"]
mod macos_text_substitution;
#[path = "pull_request_commands.rs"]
mod pull_request_commands;
#[path = "remote_agent_replay_store_commands.rs"]
mod remote_agent_replay_store_commands;
#[path = "../repository_lookup/mod.rs"]
pub(crate) mod repository_lookup;
#[path = "repository_lookup_commands.rs"]
mod repository_lookup_commands;
#[path = "../startup_metrics.rs"]
mod startup_metrics;
#[path = "../startup_window_reveal.rs"]
mod startup_window_reveal;
#[cfg(target_os = "linux")]
#[path = "../webview_media_linux.rs"]
mod webview_media_linux;
#[path = "../window_geometry.rs"]
mod window_geometry;
#[path = "workspace_facade.rs"]
mod workspace_facade;
#[path = "../workspace_file_preview.rs"]
mod workspace_file_preview;
#[path = "workspace_file_preview_commands.rs"]
mod workspace_file_preview_commands;
#[path = "workspace_services.rs"]
mod workspace_services;

pub(crate) use workspace_facade::{
    adopt_workspace_admission, canonicalize_workspace_root, dispose_registered_workspace,
    dispose_workspace_root, open_workspace_from_picker, register_workspace_path,
    reveal_item_in_dir, rollback_workspace_registration, start_workspace_file_watch,
    stop_workspace_file_watch, unregister_workspace, workspace_root_for_disposal,
};
#[cfg(test)]
pub(crate) use workspace_facade::{
    normalize_path, register_picker_path_in_registry, register_workspace_path_in_registry,
    registered_runtime_root, reveal_path_in_workspace,
};
#[cfg(target_os = "macos")]
pub(crate) use workspace_facade::{
    CLOSE_ACTIVE_TAB_EVENT, CLOSE_ACTIVE_TAB_MENU_ID, NATIVE_CLOSE_REQUEST_EVENT,
    OPEN_APPEARANCE_SETTINGS_EVENT, OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID,
    WINDOW_ZOOM_IN_EVENT, WINDOW_ZOOM_IN_MENU_ID, WINDOW_ZOOM_OUT_EVENT, WINDOW_ZOOM_OUT_MENU_ID,
    WINDOW_ZOOM_RESET_EVENT, WINDOW_ZOOM_RESET_MENU_ID,
};
pub(crate) use workspace_services::{
    checkout_git_remote_branch, commit_git_changes, create_git_branch, delete_git_branch,
    fetch_git_changes, get_git_current_branch, list_git_branches, list_git_remote_branches,
    push_git_changes, read_directory, search_files, stage_git_files, switch_git_branch,
    trusted_for, GitTrustState,
};

#[path = "runtime.rs"]
mod runtime;

pub use runtime::run;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

#[path = "agent_history_commands.rs"]
mod agent_history_commands;
#[path = "agent_session_import_commands.rs"]
mod agent_session_import_commands;
