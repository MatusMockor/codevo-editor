mod command_facades;

#[cfg(test)]
pub(crate) use command_facades::registered_runtime_root;
pub(crate) use command_facades::repository_lookup;
pub use command_facades::run;
pub(crate) use command_facades::{canonicalize_workspace_root, trusted_for, GitTrustState};
#[cfg(target_os = "macos")]
pub(crate) use command_facades::{
    CLOSE_ACTIVE_TAB_MENU_ID, OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID,
    WINDOW_ZOOM_IN_MENU_ID, WINDOW_ZOOM_OUT_MENU_ID, WINDOW_ZOOM_RESET_MENU_ID,
};
