#[cfg(target_os = "macos")]
use crate::{
    CLOSE_ACTIVE_TAB_MENU_ID, FONT_ZOOM_IN_MENU_ID, FONT_ZOOM_OUT_MENU_ID, FONT_ZOOM_RESET_MENU_ID,
    OPEN_APPEARANCE_SETTINGS_MENU_ID, QUIT_APPLICATION_MENU_ID, TOGGLE_FONT_LIGATURES_MENU_ID,
};
#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    AppHandle,
};

#[cfg(target_os = "macos")]
pub(crate) fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let close_tab = MenuItemBuilder::with_id(CLOSE_ACTIVE_TAB_MENU_ID, "Close Tab")
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
    let increase_font = MenuItemBuilder::with_id(FONT_ZOOM_IN_MENU_ID, "Increase Editor Font Size")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let decrease_font =
        MenuItemBuilder::with_id(FONT_ZOOM_OUT_MENU_ID, "Decrease Editor Font Size")
            .accelerator("CmdOrCtrl+-")
            .build(app)?;
    let reset_font = MenuItemBuilder::with_id(FONT_ZOOM_RESET_MENU_ID, "Reset Editor Font Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let toggle_ligatures = MenuItemBuilder::with_id(
        TOGGLE_FONT_LIGATURES_MENU_ID,
        "Toggle Editor Font Ligatures",
    )
    .build(app)?;
    let appearance_settings =
        MenuItemBuilder::with_id(OPEN_APPEARANCE_SETTINGS_MENU_ID, "Open Appearance Settings")
            .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&increase_font)
        .item(&decrease_font)
        .item(&reset_font)
        .separator()
        .item(&toggle_ligatures)
        .separator()
        .item(&appearance_settings)
        .build()?;

    Menu::with_items(app, &[&file, &edit, &view])
}
