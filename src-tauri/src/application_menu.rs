#[cfg(target_os = "macos")]
use crate::lib_composition::{
    WINDOW_ZOOM_IN_MENU_ID, WINDOW_ZOOM_OUT_MENU_ID, WINDOW_ZOOM_RESET_MENU_ID,
};
#[cfg(target_os = "macos")]
use crate::{CLOSE_ACTIVE_TAB_MENU_ID, OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID};
#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    AppHandle,
};

#[cfg(target_os = "macos")]
pub(crate) fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let close_tab = MenuItemBuilder::with_id(CLOSE_ACTIVE_TAB_MENU_ID, "Close")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT_APPLICATION_MENU_ID, "Quit Codevo Editor")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&close_tab)
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let zoom_in = MenuItemBuilder::with_id(WINDOW_ZOOM_IN_MENU_ID, "Zoom In").build(app)?;
    let zoom_out = MenuItemBuilder::with_id(WINDOW_ZOOM_OUT_MENU_ID, "Zoom Out").build(app)?;
    let reset_zoom =
        MenuItemBuilder::with_id(WINDOW_ZOOM_RESET_MENU_ID, "Reset Zoom").build(app)?;
    let appearance_settings =
        MenuItemBuilder::with_id(OPEN_APPEARANCE_SETTINGS_MENU_ID, "Open Appearance Settings")
            .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&reset_zoom)
        .separator()
        .item(&appearance_settings)
        .build()?;

    Menu::with_items(app, &[&file, &edit, &view])
}
