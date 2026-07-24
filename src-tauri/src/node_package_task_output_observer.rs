//! Bridges package process byte streams into tagged output and bounded problem events.

use super::{
    tagged_utf8::TaggedOutputDecoders, AppNodePackageTaskEventSink,
    NodePackageTaskProblemMatcherKind, NodePackageTaskRegistry,
};
use crate::{
    node_package_problem_matcher::{
        NodePackageProblemMatcher, NodePackageProblemMatcherKind, NodePackageTaskOutputStream,
    },
    node_package_scripts::NodePackageTaskOutputObserver,
};
use std::{
    fs::File,
    path::Path,
    sync::{Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

pub(super) struct AppNodePackageTaskOutputObserver {
    app: AppHandle,
    matcher: Mutex<Option<NodePackageProblemMatcher>>,
    matcher_kind: Option<NodePackageTaskProblemMatcherKind>,
    run_id: String,
    tagged_output: Mutex<TaggedOutputDecoders>,
}

impl AppNodePackageTaskOutputObserver {
    pub(super) fn new(
        app: AppHandle,
        run_id: String,
        matcher_kind: Option<NodePackageTaskProblemMatcherKind>,
    ) -> Self {
        Self {
            app,
            matcher: Mutex::new(None),
            matcher_kind,
            run_id,
            tagged_output: Mutex::new(TaggedOutputDecoders::default()),
        }
    }

    fn matcher(&self) -> MutexGuard<'_, Option<NodePackageProblemMatcher>> {
        self.matcher
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn tagged_output(&self) -> MutexGuard<'_, TaggedOutputDecoders> {
        self.tagged_output
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl NodePackageTaskOutputObserver for AppNodePackageTaskOutputObserver {
    fn prepare(
        &self,
        workspace_root: &File,
        workspace_path: &Path,
        package_directory: &File,
        package_path: &Path,
    ) -> Result<(), String> {
        let Some(kind) = self.matcher_kind else {
            return Ok(());
        };
        let matcher = NodePackageProblemMatcher::new(
            kind.into(),
            workspace_root,
            workspace_path,
            package_directory,
            package_path,
        )?;
        *self.matcher() = Some(matcher);
        Ok(())
    }

    fn observe(&self, stream: NodePackageTaskOutputStream, bytes: &[u8]) {
        let sink = AppNodePackageTaskEventSink(self.app.clone());
        let tasks = self.app.state::<NodePackageTaskRegistry>();
        let tagged_output = self.tagged_output().push(stream, bytes);
        tasks.record_output_text(&self.run_id, stream, &tagged_output, &sink);
        let (problems, snapshot) = {
            let mut matcher = self.matcher();
            let Some(matcher) = matcher.as_mut() else {
                return;
            };
            let problems = matcher.push_bytes(stream, bytes);
            let snapshot = matcher.snapshot();
            (problems, snapshot)
        };
        tasks.append_problems(&self.run_id, problems, &snapshot, &sink);
    }

    fn finish(&self, stream: NodePackageTaskOutputStream) {
        let tagged_output = self.tagged_output().finish(stream);
        self.app
            .state::<NodePackageTaskRegistry>()
            .record_output_text(
                &self.run_id,
                stream,
                &tagged_output,
                &AppNodePackageTaskEventSink(self.app.clone()),
            );
        let (problems, snapshot) = {
            let mut matcher = self.matcher();
            let Some(matcher) = matcher.as_mut() else {
                return;
            };
            let problems = matcher.finish_stream(stream);
            let snapshot = matcher.snapshot();
            (problems, snapshot)
        };
        self.app.state::<NodePackageTaskRegistry>().append_problems(
            &self.run_id,
            problems,
            &snapshot,
            &AppNodePackageTaskEventSink(self.app.clone()),
        );
    }

    fn finish_task(&self, preserve_problems: bool) {
        let snapshot = self
            .matcher()
            .as_ref()
            .map(NodePackageProblemMatcher::snapshot);
        self.app.state::<NodePackageTaskRegistry>().finish_problems(
            &self.run_id,
            snapshot,
            preserve_problems,
            &AppNodePackageTaskEventSink(self.app.clone()),
        );
    }
}

impl From<NodePackageTaskProblemMatcherKind> for NodePackageProblemMatcherKind {
    fn from(value: NodePackageTaskProblemMatcherKind) -> Self {
        match value {
            NodePackageTaskProblemMatcherKind::Typescript => Self::TypeScript,
            NodePackageTaskProblemMatcherKind::Eslint => Self::EslintStylish,
        }
    }
}
