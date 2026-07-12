use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    modes_by_workspace: HashMap<String, IntelligenceMode>,
}

impl SmartModeService {
    pub fn new() -> Self {
        Self {
            modes_by_workspace: HashMap::new(),
        }
    }

    pub fn state(&self, workspace_root: &str) -> SmartModeState {
        let mode = self
            .modes_by_workspace
            .get(workspace_root)
            .cloned()
            .unwrap_or(IntelligenceMode::Basic);
        SmartModeState::from_mode(mode)
    }

    pub fn set_mode(&mut self, workspace_root: &str, mode: IntelligenceMode) -> SmartModeState {
        self.modes_by_workspace
            .insert(workspace_root.to_string(), mode);
        self.state(workspace_root)
    }

    pub fn remove_workspace(&mut self, workspace_root: &str) {
        self.modes_by_workspace.remove(workspace_root);
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
        let state = service.state("/workspace");

        assert!(matches!(state.mode, IntelligenceMode::Basic));
        assert!(matches!(state.status, SmartModeStatus::Off));
    }

    #[test]
    fn setting_light_smart_mode_reports_ready_state() {
        let mut service = SmartModeService::new();
        let state = service.set_mode("/workspace", IntelligenceMode::LightSmart);

        assert!(matches!(state.mode, IntelligenceMode::LightSmart));
        assert!(matches!(state.status, SmartModeStatus::Ready));
    }

    #[test]
    fn workspace_modes_are_isolated_and_removable() {
        let mut service = SmartModeService::new();

        service.set_mode("/workspace-a", IntelligenceMode::FullSmart);
        service.set_mode("/workspace-b", IntelligenceMode::Basic);

        assert!(matches!(
            service.state("/workspace-a").mode,
            IntelligenceMode::FullSmart
        ));
        assert!(matches!(
            service.state("/workspace-b").mode,
            IntelligenceMode::Basic
        ));

        service.remove_workspace("/workspace-a");

        assert!(matches!(
            service.state("/workspace-a").mode,
            IntelligenceMode::Basic
        ));
        assert!(matches!(
            service.state("/workspace-b").mode,
            IntelligenceMode::Basic
        ));
    }
}
