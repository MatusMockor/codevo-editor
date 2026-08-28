use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_STARTUP_DURATION_MS: f64 = 10.0 * 60.0 * 1_000.0;

pub(crate) struct StartupMetrics {
    process_started_epoch_ms: f64,
    first_paint_logged: AtomicBool,
}

impl StartupMetrics {
    pub(crate) fn new() -> Self {
        let process_started_epoch_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_secs_f64()
            * 1_000.0;
        Self::at_epoch_ms(process_started_epoch_ms)
    }

    fn at_epoch_ms(process_started_epoch_ms: f64) -> Self {
        Self {
            process_started_epoch_ms,
            first_paint_logged: AtomicBool::new(false),
        }
    }

    fn record_first_paint(
        &self,
        renderer_elapsed_ms: f64,
        paint_epoch_ms: f64,
    ) -> Result<f64, String> {
        if !renderer_elapsed_ms.is_finite()
            || !(0.0..=MAX_STARTUP_DURATION_MS).contains(&renderer_elapsed_ms)
            || !paint_epoch_ms.is_finite()
        {
            return Err("startup timing is outside the accepted bounds".to_string());
        }
        let process_elapsed_ms = paint_epoch_ms - self.process_started_epoch_ms;
        if !(0.0..=MAX_STARTUP_DURATION_MS).contains(&process_elapsed_ms) {
            return Err("startup timing is outside the accepted bounds".to_string());
        }
        if self.first_paint_logged.swap(true, Ordering::AcqRel) {
            return Err("startup first-paint timing was already recorded".to_string());
        }

        Ok(process_elapsed_ms)
    }
}

#[tauri::command]
pub(crate) fn log_startup_shell_painted(
    paint_epoch_ms: f64,
    renderer_elapsed_ms: f64,
    state: tauri::State<'_, StartupMetrics>,
) -> Result<(), String> {
    let process_elapsed_ms = state.record_first_paint(renderer_elapsed_ms, paint_epoch_ms)?;
    eprintln!(
        "CODEVO_STARTUP first_rail_paint_ms={process_elapsed_ms:.2} renderer_navigation_ms={renderer_elapsed_ms:.2}"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_paint_is_recorded_exactly_once() {
        let metrics = StartupMetrics::at_epoch_ms(1_000.0);
        assert_eq!(metrics.record_first_paint(4.25, 1_020.5), Ok(20.5));
        assert_eq!(
            metrics.record_first_paint(5.0, 1_030.0),
            Err("startup first-paint timing was already recorded".to_string())
        );
    }

    #[test]
    fn invalid_renderer_duration_does_not_consume_the_recording() {
        let metrics = StartupMetrics::at_epoch_ms(1_000.0);
        assert!(metrics.record_first_paint(f64::NAN, 1_001.0).is_err());
        assert!(metrics.record_first_paint(-1.0, 1_001.0).is_err());
        assert!(metrics.record_first_paint(0.0, 999.0).is_err());
        assert!(metrics.record_first_paint(0.0, 601_001.0).is_err());
        assert!(metrics.record_first_paint(0.0, 1_000.0).is_ok());
    }
}
