use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IntelligenceMode {
    Basic,
    LightSmart,
    FullSmart,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SmartModeStatus {
    Off,
    Ready,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartModeState {
    pub mode: IntelligenceMode,
    pub status: SmartModeStatus,
    pub message: String,
}

pub struct SmartModeService {
    mode: IntelligenceMode,
}

impl SmartModeService {
    pub fn new() -> Self {
        Self {
            mode: IntelligenceMode::Basic,
        }
    }

    pub fn state(&self) -> SmartModeState {
        SmartModeState::from_mode(self.mode.clone())
    }

    pub fn set_mode(&mut self, mode: IntelligenceMode) -> SmartModeState {
        self.mode = mode;
        self.state()
    }
}

impl SmartModeState {
    fn from_mode(mode: IntelligenceMode) -> Self {
        match mode {
            IntelligenceMode::Basic => Self {
                mode,
                status: SmartModeStatus::Off,
                message: "Editor Mode active. Index and IDE services are stopped.".to_string(),
            },
            IntelligenceMode::LightSmart => Self {
                mode,
                status: SmartModeStatus::Ready,
                message: "Smart Index active. Workspace symbols are enabled.".to_string(),
            },
            IntelligenceMode::FullSmart => Self {
                mode,
                status: SmartModeStatus::Ready,
                message: "IDE Mode active. Index and language services are enabled.".to_string(),
            },
        }
    }
}

impl Default for SmartModeService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{IntelligenceMode, SmartModeService, SmartModeStatus};

    #[test]
    fn basic_mode_reports_smart_services_off() {
        let service = SmartModeService::new();
        let state = service.state();

        assert!(matches!(state.mode, IntelligenceMode::Basic));
        assert!(matches!(state.status, SmartModeStatus::Off));
    }

    #[test]
    fn setting_light_smart_mode_reports_ready_state() {
        let mut service = SmartModeService::new();
        let state = service.set_mode(IntelligenceMode::LightSmart);

        assert!(matches!(state.mode, IntelligenceMode::LightSmart));
        assert!(matches!(state.status, SmartModeStatus::Ready));
    }
}
