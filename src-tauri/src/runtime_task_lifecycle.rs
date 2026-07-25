use crate::{
    js_test_tasks, js_test_watch, node_package_tasks, node_run_tasks,
    vscode_process_task_commands::VscodeProcessTaskCommandService, workspace_registry::WorkspaceId,
};
use tauri::{AppHandle, Manager};

pub(crate) trait RuntimeTaskLifecycleExt {
    fn request_stop_all_tasks(&self);
    fn request_stop_workspace_tasks(&self, workspace_id: &WorkspaceId);
}

impl RuntimeTaskLifecycleExt for AppHandle {
    fn request_stop_all_tasks(&self) {
        node_package_tasks::request_stop_all_in_app(self);
        node_run_tasks::request_stop_all_in_app(self);
        js_test_tasks::request_stop_all_in_app(self);
        js_test_watch::request_stop_all_in_app(self);
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_all();
        }
    }

    fn request_stop_workspace_tasks(&self, workspace_id: &WorkspaceId) {
        node_package_tasks::request_stop_workspace_in_app(self, workspace_id);
        node_run_tasks::request_stop_workspace_in_app(self, workspace_id);
        js_test_tasks::request_stop_workspace_in_app(self, workspace_id);
        js_test_watch::request_stop_workspace_in_app(self, workspace_id);
        if let Some(service) = self.try_state::<VscodeProcessTaskCommandService>() {
            service.request_stop_workspace(workspace_id);
        }
    }
}
