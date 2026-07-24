use crate::workspace_registry::WorkspaceId;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub(crate) const VSCODE_PROCESS_TASK_EVENT: &str = "vscode-process-task://event";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VscodeProcessTaskOwner {
    pub(crate) run_id: String,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) session_id: u64,
    pub(crate) label: String,
    pub(crate) config_revision: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum VscodeProcessTaskEvent {
    Output {
        owner: VscodeProcessTaskOwner,
        sequence: u32,
        stream: VscodeProcessTaskOutputStream,
        data: String,
        truncated: bool,
    },
    Status {
        owner: VscodeProcessTaskOwner,
        sequence: u32,
        #[serde(flatten)]
        state: VscodeProcessTaskStatus,
    },
    Step {
        owner: VscodeProcessTaskOwner,
        sequence: u32,
        label: String,
        index: u16,
        total: u16,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VscodeProcessTaskOutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub(crate) enum VscodeProcessTaskStatus {
    Running,
    Exited {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    Failed {
        message: String,
    },
    Stopped,
}

pub(crate) trait VscodeProcessTaskEventSink: Send + Sync {
    fn emit(&self, event: VscodeProcessTaskEvent);
}

pub(crate) struct AppVscodeProcessTaskEventSink(pub(crate) AppHandle);

impl VscodeProcessTaskEventSink for AppVscodeProcessTaskEventSink {
    fn emit(&self, event: VscodeProcessTaskEvent) {
        let _ = self.0.emit(VSCODE_PROCESS_TASK_EVENT, event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn owner() -> VscodeProcessTaskOwner {
        VscodeProcessTaskOwner {
            run_id: "run-1".to_string(),
            workspace_id: serde_json::from_str("\"workspace-1\"").expect("valid workspace id"),
            session_id: 7,
            label: "typecheck".to_string(),
            config_revision: format!("sha256:{}", "a".repeat(64)),
        }
    }

    #[test]
    fn output_wire_matches_the_strict_frontend_contract() {
        let value = serde_json::to_value(VscodeProcessTaskEvent::Output {
            owner: owner(),
            sequence: 2,
            stream: VscodeProcessTaskOutputStream::Stderr,
            data: "failure\n".to_string(),
            truncated: false,
        })
        .expect("serialize output event");
        assert_eq!(
            value,
            json!({
                "kind": "output",
                "owner": {
                    "runId": "run-1",
                    "workspaceId": "workspace-1",
                    "sessionId": 7,
                    "label": "typecheck",
                    "configRevision": format!("sha256:{}", "a".repeat(64)),
                },
                "sequence": 2,
                "stream": "stderr",
                "data": "failure\n",
                "truncated": false,
            })
        );
    }

    #[test]
    fn status_variants_have_exact_discriminated_shapes() {
        let running = serde_json::to_value(VscodeProcessTaskEvent::Status {
            owner: owner(),
            sequence: 1,
            state: VscodeProcessTaskStatus::Running,
        })
        .expect("serialize running event");
        assert_eq!(running["kind"], "status");
        assert_eq!(running["status"], "running");
        assert!(running.get("exitCode").is_none());

        let exited = serde_json::to_value(VscodeProcessTaskEvent::Status {
            owner: owner(),
            sequence: 3,
            state: VscodeProcessTaskStatus::Exited { exit_code: Some(2) },
        })
        .expect("serialize exited event");
        assert_eq!(exited["status"], "exited");
        assert_eq!(exited["exitCode"], 2);

        let failed = serde_json::to_value(VscodeProcessTaskEvent::Status {
            owner: owner(),
            sequence: 4,
            state: VscodeProcessTaskStatus::Failed {
                message: "unavailable".to_string(),
            },
        })
        .expect("serialize failed event");
        assert_eq!(failed["status"], "failed");
        assert_eq!(failed["message"], "unavailable");
    }

    #[test]
    fn step_wire_has_the_minimal_exact_shape() {
        let value = serde_json::to_value(VscodeProcessTaskEvent::Step {
            owner: owner(),
            sequence: 2,
            label: "lint".to_string(),
            index: 1,
            total: 2,
        })
        .expect("serialize step event");
        assert_eq!(
            value,
            json!({
                "kind": "step",
                "owner": {
                    "runId": "run-1",
                    "workspaceId": "workspace-1",
                    "sessionId": 7,
                    "label": "typecheck",
                    "configRevision": format!("sha256:{}", "a".repeat(64)),
                },
                "sequence": 2,
                "label": "lint",
                "index": 1,
                "total": 2,
            })
        );
    }
}
