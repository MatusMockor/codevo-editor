//! Typed wire events for Node package task lifecycle and diagnostics.

use crate::{
    node_package_problem_matcher::{
        NodePackageProblem, NodePackageProblemSeverity, NodePackageProblemSource,
        NodePackageTaskOutputStream,
    },
    workspace_registry::WorkspaceId,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub(crate) const NODE_PACKAGE_TASK_STATUS_EVENT: &str = "node-package-task://status";
pub(crate) const NODE_PACKAGE_TASK_OUTPUT_EVENT: &str = "node-package-task://output";
pub(crate) const NODE_PACKAGE_TASK_PROBLEMS_EVENT: &str = "node-package-task://problems";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageTaskStatusEvent {
    pub(crate) run_id: String,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) session_id: u64,
    pub(crate) manifest_relative_path: String,
    pub(crate) script_name: String,
    #[serde(flatten)]
    pub(crate) state: NodePackageTaskEventState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageTaskOwner {
    pub(crate) run_id: String,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) session_id: u64,
    pub(crate) manifest_relative_path: String,
    pub(crate) script_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageTaskOutputEvent {
    pub(crate) owner: NodePackageTaskOwner,
    pub(crate) sequence: u32,
    pub(crate) stream: &'static str,
    pub(crate) data: String,
    pub(crate) truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageTaskProblemWire {
    pub(crate) file_path: String,
    pub(crate) line_number: u32,
    pub(crate) column: u32,
    pub(crate) severity: &'static str,
    pub(crate) message: String,
    pub(crate) code: Option<String>,
    pub(crate) source: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum NodePackageTaskProblemsState {
    Reset,
    Append {
        problems: Vec<NodePackageTaskProblemWire>,
        total: u32,
        truncated: bool,
    },
    Complete {
        problems: Vec<NodePackageTaskProblemWire>,
        total: u32,
        truncated: bool,
    },
    Clear,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePackageTaskProblemsEvent {
    pub(crate) owner: NodePackageTaskOwner,
    pub(crate) sequence: u32,
    #[serde(flatten)]
    pub(crate) state: NodePackageTaskProblemsState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum NodePackageTaskEventState {
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

pub(crate) trait NodePackageTaskEventSink {
    fn emit_status(&self, event: NodePackageTaskStatusEvent);
    fn emit_output(&self, event: NodePackageTaskOutputEvent);
    fn emit_problems(&self, event: NodePackageTaskProblemsEvent);
}

pub(crate) struct AppNodePackageTaskEventSink(pub(crate) AppHandle);

impl NodePackageTaskEventSink for AppNodePackageTaskEventSink {
    fn emit_status(&self, event: NodePackageTaskStatusEvent) {
        let _ = self.0.emit(NODE_PACKAGE_TASK_STATUS_EVENT, event);
    }

    fn emit_output(&self, event: NodePackageTaskOutputEvent) {
        let _ = self.0.emit(NODE_PACKAGE_TASK_OUTPUT_EVENT, event);
    }

    fn emit_problems(&self, event: NodePackageTaskProblemsEvent) {
        let _ = self.0.emit(NODE_PACKAGE_TASK_PROBLEMS_EVENT, event);
    }
}

#[cfg(test)]
pub(crate) struct NoopNodePackageTaskEventSink;

#[cfg(test)]
impl NodePackageTaskEventSink for NoopNodePackageTaskEventSink {
    fn emit_status(&self, _event: NodePackageTaskStatusEvent) {}
    fn emit_output(&self, _event: NodePackageTaskOutputEvent) {}
    fn emit_problems(&self, _event: NodePackageTaskProblemsEvent) {}
}

pub(crate) fn output_stream_name(stream: NodePackageTaskOutputStream) -> &'static str {
    match stream {
        NodePackageTaskOutputStream::Stdout => "stdout",
        NodePackageTaskOutputStream::Stderr => "stderr",
    }
}

pub(crate) fn problem_wire(problem: NodePackageProblem) -> NodePackageTaskProblemWire {
    NodePackageTaskProblemWire {
        file_path: problem.file_path,
        line_number: problem.line_number,
        column: problem.column,
        severity: match problem.severity {
            NodePackageProblemSeverity::Error => "error",
            NodePackageProblemSeverity::Warning => "warning",
        },
        message: problem.message,
        code: problem.code,
        source: match problem.source {
            NodePackageProblemSource::TypeScript => "TypeScript",
            NodePackageProblemSource::Eslint => "ESLint",
        },
    }
}
