use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const STARTUP_REVEAL_FALLBACK: Duration = Duration::from_millis(2_500);

#[derive(Default)]
pub(crate) struct StartupWindowReveal {
    revealed: AtomicBool,
}

impl StartupWindowReveal {
    fn claim(&self) -> bool {
        !self.revealed.swap(true, Ordering::AcqRel)
    }

    fn is_revealed(&self) -> bool {
        self.revealed.load(Ordering::Acquire)
    }
}

pub(crate) fn schedule_startup_reveal_fallback<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_REVEAL_FALLBACK).await;
        let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let state = handle.state::<StartupWindowReveal>();
        if !fallback_reveal_needed(state.is_revealed(), window.is_minimized()) {
            return;
        }
        if state.claim() {
            let _ = window.show();
        }
    });
}

#[tauri::command]
pub(crate) fn reveal_startup_window<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, StartupWindowReveal>,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("only the main window reveals itself at startup".to_string());
    }
    if !state.claim() {
        return Ok(());
    }
    window.show().map_err(|error| error.to_string())
}

pub(crate) fn fallback_reveal_needed(revealed: bool, minimized: tauri::Result<bool>) -> bool {
    if revealed {
        return false;
    }
    !matches!(minimized, Ok(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveals_a_window_the_frontend_never_showed() {
        assert!(fallback_reveal_needed(false, Ok(false)));
    }

    #[test]
    fn leaves_a_window_the_frontend_already_revealed_even_if_the_user_hid_it() {
        assert!(!fallback_reveal_needed(true, Ok(false)));
        assert!(!fallback_reveal_needed(
            true,
            Err(tauri::Error::WindowNotFound)
        ));
    }

    #[test]
    fn leaves_a_minimized_window_minimized() {
        assert!(!fallback_reveal_needed(false, Ok(true)));
    }

    #[test]
    fn reveals_when_the_minimized_state_cannot_be_read() {
        assert!(fallback_reveal_needed(
            false,
            Err(tauri::Error::WindowNotFound)
        ));
    }

    #[test]
    fn the_first_reveal_claims_the_window_and_cancels_the_fallback() {
        let reveal = StartupWindowReveal::default();
        assert!(!reveal.is_revealed());
        assert!(reveal.claim());
        assert!(reveal.is_revealed());
        assert!(!reveal.claim());
        assert!(!fallback_reveal_needed(reveal.is_revealed(), Ok(false)));
    }

    #[test]
    fn waits_past_a_normal_first_paint_but_under_a_noticeable_hang() {
        assert!(STARTUP_REVEAL_FALLBACK >= Duration::from_secs(2));
        assert!(STARTUP_REVEAL_FALLBACK <= Duration::from_secs(5));
    }
}
