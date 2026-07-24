use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub const WORKSPACE_FOLDER_PLACEHOLDER: &str = "${workspaceFolder}";
// Kept equal to the discovery parser caps; these become shared imports when
// the isolated resolver is wired into the parser module.
pub const PROCESS_TASK_MAX_ARGS: usize = 128;
pub const PROCESS_TASK_MAX_ENV: usize = 128;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessTaskDefinition {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessTaskEnvironmentPolicy {
    pub allowed_explicit_keys: BTreeSet<String>,
    pub inherited_baseline: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProcessTaskProgramKind {
    BackendNode,
    WorkspaceExecutable,
    WorkspaceTool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessTaskExecutionPlan {
    program: PathBuf,
    program_kind: ProcessTaskProgramKind,
    args: Box<[String]>,
    cwd: PathBuf,
    env: BTreeMap<String, String>,
}

impl ProcessTaskExecutionPlan {
    pub(crate) fn new(
        program: PathBuf,
        program_kind: ProcessTaskProgramKind,
        args: Vec<String>,
        cwd: PathBuf,
        env: BTreeMap<String, String>,
    ) -> Self {
        Self {
            program,
            program_kind,
            args: args.into_boxed_slice(),
            cwd,
            env,
        }
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn program_kind(&self) -> &ProcessTaskProgramKind {
        &self.program_kind
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    pub fn env(&self) -> &BTreeMap<String, String> {
        &self.env
    }
}
