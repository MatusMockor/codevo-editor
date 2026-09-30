use std::{collections::HashMap, io::Read, path::Path};

use serde::Deserialize;
use tauri::{
    plugin::TauriPlugin, AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow,
};
use tauri_plugin_window_state::StateFlags;

use super::startup_window_reveal::MAIN_WINDOW_LABEL;

pub(crate) const WINDOW_GEOMETRY_FILENAME: &str = "window-geometry.v1.json";
const MAX_WINDOW_GEOMETRY_FILE_BYTES: u64 = 64 * 1_024;
const MAX_SAVED_WINDOWS: usize = 16;
const MAX_ABS_COORDINATE: i32 = 1_000_000;
const MAX_DIMENSION: u32 = 100_000;
const TITLE_BAR_HEIGHT: i64 = 32;
const MIN_VISIBLE_TITLE_BAR_WIDTH: i64 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WindowFrame {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SavedWindowGeometry {
    pub(crate) frame: WindowFrame,
    pub(crate) maximized: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PluginWindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    prev_x: i32,
    prev_y: i32,
    maximized: bool,
    #[allow(dead_code)]
    visible: bool,
    #[allow(dead_code)]
    decorated: bool,
    #[allow(dead_code)]
    fullscreen: bool,
}

pub(crate) fn restored_window_geometry() -> StateFlags {
    let flags = StateFlags::SIZE | StateFlags::POSITION;
    if restores_maximized() {
        return flags | StateFlags::MAXIMIZED;
    }
    flags
}

fn restores_maximized() -> bool {
    !cfg!(target_os = "macos")
}

pub(crate) fn tracks_window_geometry(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}

pub(crate) fn window_geometry_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(restored_window_geometry())
        .with_filename(WINDOW_GEOMETRY_FILENAME)
        .with_filter(tracks_window_geometry)
        .skip_initial_state(MAIN_WINDOW_LABEL)
        .build()
}

pub(crate) fn parse_saved_window_geometry(raw: &[u8], label: &str) -> Option<SavedWindowGeometry> {
    if raw.len() as u64 > MAX_WINDOW_GEOMETRY_FILE_BYTES {
        return None;
    }
    let states: HashMap<String, PluginWindowState> = serde_json::from_slice(raw).ok()?;
    if states.len() > MAX_SAVED_WINDOWS {
        return None;
    }
    let state = states.get(label)?;
    let maximized = state.maximized && restores_maximized();
    let (x, y) = if maximized {
        (state.prev_x, state.prev_y)
    } else {
        (state.x, state.y)
    };
    if !valid_coordinate(x) || !valid_coordinate(y) {
        return None;
    }
    if !valid_dimension(state.width) || !valid_dimension(state.height) {
        return None;
    }
    Some(SavedWindowGeometry {
        frame: WindowFrame {
            x,
            y,
            width: state.width,
            height: state.height,
        },
        maximized,
    })
}

fn valid_coordinate(value: i32) -> bool {
    (-MAX_ABS_COORDINATE..=MAX_ABS_COORDINATE).contains(&value)
}

fn valid_dimension(value: u32) -> bool {
    (1..=MAX_DIMENSION).contains(&value)
}

pub(crate) fn fit_window_frame(
    saved: WindowFrame,
    work_areas: &[WindowFrame],
    primary: Option<WindowFrame>,
) -> Option<WindowFrame> {
    let visible = work_areas
        .iter()
        .copied()
        .filter(|area| title_bar_overlap(saved, *area) >= visible_title_bar_width(saved))
        .max_by_key(|area| title_bar_overlap(saved, *area));
    if let Some(area) = visible {
        return Some(clamp_into(saved, area));
    }
    let fallback = primary.or_else(|| work_areas.first().copied())?;
    Some(center_in(saved, fallback))
}

fn visible_title_bar_width(frame: WindowFrame) -> i64 {
    MIN_VISIBLE_TITLE_BAR_WIDTH.min(i64::from(frame.width))
}

fn title_bar_overlap(frame: WindowFrame, area: WindowFrame) -> i64 {
    let (frame_left, frame_right) = span(frame.x, frame.width);
    let (area_left, area_right) = span(area.x, area.width);
    let (area_top, area_bottom) = span(area.y, area.height);
    let bar_top = i64::from(frame.y);
    let bar_bottom = bar_top + TITLE_BAR_HEIGHT.min(i64::from(frame.height));
    if bar_top < area_top || bar_bottom > area_bottom {
        return 0;
    }
    (frame_right.min(area_right) - frame_left.max(area_left)).max(0)
}

fn span(origin: i32, length: u32) -> (i64, i64) {
    let start = i64::from(origin);
    (start, start + i64::from(length))
}

fn clamp_into(frame: WindowFrame, area: WindowFrame) -> WindowFrame {
    let width = frame.width.min(area.width);
    let height = frame.height.min(area.height);
    WindowFrame {
        x: clamp_axis(frame.x, width, area.x, area.width),
        y: clamp_axis(frame.y, height, area.y, area.height),
        width,
        height,
    }
}

fn center_in(frame: WindowFrame, area: WindowFrame) -> WindowFrame {
    let width = frame.width.min(area.width);
    let height = frame.height.min(area.height);
    WindowFrame {
        x: centered_axis(width, area.x, area.width),
        y: centered_axis(height, area.y, area.height),
        width,
        height,
    }
}

fn clamp_axis(origin: i32, length: u32, area_origin: i32, area_length: u32) -> i32 {
    let low = i64::from(area_origin);
    let high = low + i64::from(area_length) - i64::from(length);
    narrow(i64::from(origin).clamp(low, high.max(low)))
}

fn centered_axis(length: u32, area_origin: i32, area_length: u32) -> i32 {
    let slack = (i64::from(area_length) - i64::from(length)).max(0);
    narrow(i64::from(area_origin) + slack / 2)
}

fn narrow(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(if value < 0 { i32::MIN } else { i32::MAX })
}

pub(crate) fn restore_main_window_geometry<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let Some(raw) = read_bounded(&config_dir.join(WINDOW_GEOMETRY_FILENAME)) else {
        return;
    };
    let Some(saved) = parse_saved_window_geometry(&raw, MAIN_WINDOW_LABEL) else {
        return;
    };
    apply_saved_geometry(&window, saved);
}

fn read_bounded(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut raw = Vec::new();
    file.take(MAX_WINDOW_GEOMETRY_FILE_BYTES + 1)
        .read_to_end(&mut raw)
        .ok()?;
    Some(raw)
}

fn apply_saved_geometry<R: Runtime>(window: &WebviewWindow<R>, saved: SavedWindowGeometry) {
    let work_areas: Vec<WindowFrame> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| frame_of(monitor.work_area()))
        .collect();
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| frame_of(monitor.work_area()));
    let Some(frame) = fit_window_frame(saved.frame, &work_areas, primary) else {
        return;
    };
    let _ = window.set_size(PhysicalSize::new(frame.width, frame.height));
    let _ = window.set_position(PhysicalPosition::new(frame.x, frame.y));
    if saved.maximized {
        let _ = window.maximize();
    }
}

fn frame_of(area: &tauri::PhysicalRect<i32, u32>) -> WindowFrame {
    WindowFrame {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN_AREA: WindowFrame = WindowFrame {
        x: 0,
        y: 50,
        width: 2_560,
        height: 1_550,
    };
    const RIGHT_AREA: WindowFrame = WindowFrame {
        x: 2_560,
        y: 0,
        width: 1_920,
        height: 1_080,
    };

    fn frame(x: i32, y: i32, width: u32, height: u32) -> WindowFrame {
        WindowFrame {
            x,
            y,
            width,
            height,
        }
    }

    fn plugin_state(extra: &str) -> String {
        format!(
            r#"{{"main":{{"width":1400,"height":900,"x":120,"y":80,"prev_x":10,"prev_y":20,"maximized":false,"visible":true,"decorated":false,"fullscreen":false{extra}}}}}"#
        )
    }

    #[test]
    fn restores_size_and_position_and_leaves_visibility_to_the_startup_reveal() {
        let flags = restored_window_geometry();
        assert!(flags.contains(StateFlags::SIZE));
        assert!(flags.contains(StateFlags::POSITION));
        assert!(!flags.contains(StateFlags::VISIBLE));
        assert!(!flags.contains(StateFlags::DECORATIONS));
        assert!(!flags.contains(StateFlags::FULLSCREEN));
    }

    #[test]
    fn never_restores_a_zoomed_frameless_window_as_maximized_on_macos() {
        let flags = restored_window_geometry();
        assert_eq!(
            flags.contains(StateFlags::MAXIMIZED),
            !cfg!(target_os = "macos")
        );
        let raw = plugin_state("").replace(r#""maximized":false"#, r#""maximized":true"#);
        let saved = parse_saved_window_geometry(raw.as_bytes(), MAIN_WINDOW_LABEL).unwrap();
        assert_eq!(saved.maximized, !cfg!(target_os = "macos"));
    }

    #[test]
    fn tracks_only_the_main_window() {
        assert!(tracks_window_geometry(MAIN_WINDOW_LABEL));
        assert!(!tracks_window_geometry("artifact-preview"));
        assert!(!tracks_window_geometry(""));
    }

    #[test]
    fn parses_the_saved_main_window_frame() {
        let saved =
            parse_saved_window_geometry(plugin_state("").as_bytes(), MAIN_WINDOW_LABEL).unwrap();
        assert_eq!(saved.frame, frame(120, 80, 1_400, 900));
        assert!(!saved.maximized);
    }

    #[test]
    fn rejects_corrupt_unknown_oversized_and_out_of_range_state() {
        let cases = [
            "not json".to_string(),
            plugin_state(r#","extra":1"#),
            plugin_state("").replace(r#""width":1400"#, r#""width":0"#),
            plugin_state("").replace(r#""width":1400"#, r#""width":4294967295"#),
            plugin_state("").replace(r#""x":120"#, r#""x":2147483647"#),
            plugin_state("").replace(r#""x":120"#, r#""x":99999999999"#),
            plugin_state("").replace(r#""y":80"#, r#""y":-2000000"#),
            plugin_state("").replace("main", "other"),
            format!("{{\"main\":{}}}", " ".repeat(70_000)),
        ];
        for raw in cases {
            assert_eq!(
                parse_saved_window_geometry(raw.as_bytes(), MAIN_WINDOW_LABEL),
                None,
                "{raw:.80}"
            );
        }
    }

    #[test]
    fn keeps_a_frame_that_already_fits_its_monitor() {
        let saved = frame(200, 120, 1_400, 900);
        assert_eq!(
            fit_window_frame(saved, &[MAIN_AREA, RIGHT_AREA], Some(MAIN_AREA)),
            Some(saved)
        );
    }

    #[test]
    fn keeps_the_window_on_the_secondary_monitor_it_was_closed_on() {
        let saved = frame(2_700, 100, 1_200, 800);
        assert_eq!(
            fit_window_frame(saved, &[MAIN_AREA, RIGHT_AREA], Some(MAIN_AREA)),
            Some(saved)
        );
    }

    #[test]
    fn shrinks_and_moves_a_frame_larger_than_its_work_area() {
        let saved = frame(2_600, 10, 3_000, 2_000);
        assert_eq!(
            fit_window_frame(saved, &[MAIN_AREA, RIGHT_AREA], Some(MAIN_AREA)),
            Some(frame(2_560, 0, 1_920, 1_080))
        );
    }

    #[test]
    fn recenters_on_the_primary_monitor_when_the_title_bar_would_be_unreachable() {
        let only_corner_visible = frame(-1_300, 1_500, 1_400, 900);
        assert_eq!(
            fit_window_frame(only_corner_visible, &[MAIN_AREA], Some(MAIN_AREA)),
            Some(frame(580, 375, 1_400, 900))
        );
        let above_the_menu_bar = frame(100, 20, 1_400, 900);
        assert_eq!(
            fit_window_frame(above_the_menu_bar, &[MAIN_AREA], Some(MAIN_AREA)),
            Some(frame(580, 375, 1_400, 900))
        );
    }

    #[test]
    fn recenters_when_the_saved_monitor_was_disconnected() {
        let saved = frame(2_700, 100, 1_200, 800);
        assert_eq!(
            fit_window_frame(saved, &[MAIN_AREA], None),
            Some(frame(680, 425, 1_200, 800))
        );
    }

    #[test]
    fn leaves_the_window_alone_without_any_monitor_information() {
        assert_eq!(fit_window_frame(frame(0, 0, 800, 600), &[], None), None);
    }

    #[test]
    fn stays_in_range_at_the_coordinate_limits() {
        let area = frame(
            -MAX_ABS_COORDINATE,
            -MAX_ABS_COORDINATE,
            MAX_DIMENSION,
            MAX_DIMENSION,
        );
        let saved = frame(
            MAX_ABS_COORDINATE,
            MAX_ABS_COORDINATE,
            MAX_DIMENSION,
            MAX_DIMENSION,
        );
        assert_eq!(
            fit_window_frame(saved, &[area], Some(area)),
            Some(frame(
                -MAX_ABS_COORDINATE,
                -MAX_ABS_COORDINATE,
                MAX_DIMENSION,
                MAX_DIMENSION
            ))
        );
    }
}
