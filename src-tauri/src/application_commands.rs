//! Native application lifecycle and settings commands.

use super::*;

#[tauri::command]
pub(super) fn quit_application(
    app: AppHandle,
    js_test_batches: State<'_, Arc<JsTestBatchRegistry>>,
) {
    shutdown_runtime_processes(&app, &js_test_batches);
    app.exit(0);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum NativeCloseKind {
    Close,
    Quit,
}

#[derive(Default)]
pub(super) struct NativeCloseListenerState {
    pub(super) ready: AtomicBool,
}

#[tauri::command]
pub(super) fn set_native_close_listener_ready(
    state: State<'_, NativeCloseListenerState>,
    ready: bool,
) {
    state.ready.store(ready, Ordering::Release);
}

#[tauri::command]
pub(super) fn confirm_native_shutdown(
    app: AppHandle,
    kind: NativeCloseKind,
    js_test_batches: State<'_, Arc<JsTestBatchRegistry>>,
) {
    shutdown_runtime_processes(&app, &js_test_batches);
    match kind {
        NativeCloseKind::Quit => app.exit(0),
        NativeCloseKind::Close => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.destroy();
            }
        }
    }
}

/// Process-wide cache of system monospace font families.
static MONOSPACE_FONT_FAMILIES_CACHE: OnceLock<Vec<String>> = OnceLock::new();

/// Lists the monospace font families exposed to the `Settings` font picker.
///
/// The `fontdb` system scan walks every installed font (100ms-1s+ on macOS), so
/// it must never run on the WebView main thread. The work is handed to Tokio's
/// blocking pool (same off-main-thread discipline as the index/git commands) and
/// the result is cached after the first enumeration.
#[tauri::command]
pub(super) async fn list_monospace_font_families() -> Vec<String> {
    run_blocking_command(|| {
        Ok(cached_monospace_font_families(
            &MONOSPACE_FONT_FAMILIES_CACHE,
            enumerate_monospace_font_families,
        )
        .clone())
    })
    .await
    .unwrap_or_default()
}

/// Performs the raw `fontdb` system scan, collecting de-duplicated, sorted
/// monospace font family names. This is the expensive, blocking work.
pub(super) fn enumerate_monospace_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();

    for face in database.faces().filter(|face| face.monospaced) {
        for (family, _) in &face.families {
            let trimmed = family.trim();

            if !trimmed.is_empty() {
                families.insert(trimmed.to_string());
            }
        }
    }

    families.into_iter().collect()
}
