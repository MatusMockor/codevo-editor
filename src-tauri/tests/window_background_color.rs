use std::path::Path;

use tauri::utils::config::{Color, WindowConfig};

fn startup_side_tone() -> Color {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../index.html");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{} must be readable: {error}", path.display()));
    let root = source
        .split_once(":root {")
        .unwrap_or_else(|| panic!("{} must declare the startup token block", path.display()))
        .1;
    let declaration = root
        .split_once("--startup-side:")
        .unwrap_or_else(|| panic!("{} must declare --startup-side", path.display()))
        .1;
    let value = declaration
        .split_once(';')
        .unwrap_or_else(|| panic!("{} must terminate --startup-side", path.display()))
        .0
        .trim();
    value
        .parse()
        .unwrap_or_else(|error: String| panic!("--startup-side must be a colour: {error}"))
}

fn main_window(config_file: &str) -> WindowConfig {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(config_file);
    let source = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("{} must be readable: {error}", path.display());
    });
    let document: serde_json::Value = serde_json::from_str(&source).unwrap_or_else(|error| {
        panic!("{} must be valid json: {error}", path.display());
    });
    let windows = document["app"]["windows"]
        .as_array()
        .unwrap_or_else(|| panic!("{} must declare app.windows", path.display()));
    let main = windows
        .iter()
        .find(|window| window["label"] == "main")
        .unwrap_or_else(|| panic!("{} must declare the main window", path.display()));

    serde_json::from_value(main.clone()).unwrap_or_else(|error| {
        panic!(
            "{} main window must be a valid tauri window config: {error}",
            path.display()
        );
    })
}

#[test]
fn base_main_window_paints_the_startup_side_tone_behind_the_webview() {
    assert_eq!(
        main_window("tauri.conf.json").background_color,
        Some(startup_side_tone())
    );
}

#[test]
fn macos_main_window_paints_the_startup_side_tone_behind_the_webview() {
    assert_eq!(
        main_window("tauri.macos.conf.json").background_color,
        Some(startup_side_tone())
    );
}
