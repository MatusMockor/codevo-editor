use super::{
    detect_runner_in_workspace, ensure_registered_root_identity, parse_jest_json_with_limits,
    registered_root_path, runner_args, JsTestRunScope, JsTestRunner, MAX_CASES, MAX_REPORT_BYTES,
    MAX_SUITES, RESULT_LABEL, RESULT_SUBDIRECTORY, RUNNER_TIMEOUT,
};
use crate::{
    js_test_execution_root::{
        ensure_js_test_execution_context_identity, resolve_js_test_execution_context,
        retain_js_test_process_authority, JsTestExecutionContext, RetainedJsTestProcessAuthority,
        RetainedJsTestRunnerKind,
    },
    php_test_run::{PhpTestRunResponse, PhpTestTotals},
    terminal_task_process::TerminalTaskOwnership,
    test_run_support::prepare_result_path_with_extension,
    workspace_registry::WorkspaceId,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};

mod bounded_captured_stream {
    include!("bounded_captured_stream.rs");
}

use bounded_captured_stream::{
    read_bounded_captured_stream, BoundedCapturedStream, CAPTURED_STREAM_BYTES_LIMIT,
};
#[cfg(unix)]
#[path = "js_test_batch_authority.rs"]
mod authority;
#[cfg(unix)]
use authority::{
    retain_and_validate_package_manifest, RetainedBatchPackageManifest, RetainedBatchResultFile,
    RetainedBatchRunnerGeneration,
};
#[path = "js_test_batch_projection.rs"]
mod batch_projection;
use batch_projection::{validate_batch_projection, BatchProjectionBudget};
#[path = "js_test_batch_aggregate.rs"]
mod batch_aggregate;
use batch_aggregate::{aggregate_output, aggregate_totals};
#[path = "js_test_batch_validation.rs"]
mod validation;
use validation::{validate_owner_id, validate_package_roots};
#[cfg(test)]
use validation::{MAX_BATCH_OWNER_ID_BYTES, MAX_BATCH_PACKAGE_ROOT_BYTES};
#[cfg(all(test, unix))]
#[path = "js_test_fifo_test_support.rs"]
mod fifo_test_support;
#[cfg(all(test, unix))]
#[path = "js_test_pid_test_support.rs"]
pub(crate) mod test_support;

pub(crate) const MAX_JS_TEST_BATCH_PACKAGES: usize = 8;
const JS_TEST_BATCH_CONCURRENCY: usize = 2;
const MAX_LIVE_JS_TEST_BATCHES: usize = 16;
const MAX_LIVE_JS_TEST_BATCHES_PER_WORKSPACE: usize = 2;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JsTestBatchPackageRequest {
    package_root_relative_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JsTestBatchRequest {
    run_id: String,
    workspace_id: WorkspaceId,
    packages: Vec<JsTestBatchPackageRequest>,
}

impl JsTestBatchRequest {
    pub(crate) fn run_id(&self) -> &str {
        &self.run_id
    }

    pub(crate) fn workspace_id(&self) -> &WorkspaceId {
        &self.workspace_id
    }

    pub(crate) fn into_package_roots(self) -> Vec<String> {
        self.packages
            .into_iter()
            .map(|package| package.package_root_relative_path)
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum JsTestBatchRunner {
    Jest,
    Vitest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestBatchPackageAuthority {
    package_root_relative_path: String,
    runner: JsTestBatchRunner,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestBatchOutputStream {
    text: String,
    truncated: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestBatchOutput {
    stdout: JsTestBatchOutputStream,
    stderr: JsTestBatchOutputStream,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsTestBatchPackageResult {
    authority: JsTestBatchPackageAuthority,
    response: PhpTestRunResponse,
    output: JsTestBatchOutput,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum JsTestBatchOutcome {
    Ok {
        packages: Vec<JsTestBatchPackageResult>,
        totals: PhpTestTotals,
    },
    Cancelled {
        authorities: Vec<JsTestBatchPackageAuthority>,
        output: JsTestBatchOutput,
    },
    Unavailable {
        message: String,
        authorities: Vec<JsTestBatchPackageAuthority>,
    },
    Error {
        message: String,
        authorities: Vec<JsTestBatchPackageAuthority>,
        output: JsTestBatchOutput,
    },
}

pub(crate) struct PreparedJsTestBatch {
    registered_root: Arc<fs::File>,
    workspace_root: PathBuf,
    packages: Vec<PreparedJsTestPackage>,
}

struct PreparedJsTestPackage {
    index: usize,
    authority_receipt: JsTestBatchPackageAuthority,
    execution: JsTestExecutionContext,
    #[cfg(unix)]
    package_manifest_authority: RetainedBatchPackageManifest,
    runner: JsTestRunner,
    process_authority: RetainedJsTestProcessAuthority,
    #[cfg(unix)]
    result_authority: RetainedBatchResultFile,
    #[cfg(unix)]
    runner_generation: RetainedBatchRunnerGeneration,
}

enum PackageExecutionFailure {
    Cancelled {
        output: Option<JsTestBatchOutput>,
    },
    Failed {
        message: String,
        output: Option<JsTestBatchOutput>,
    },
}

impl PackageExecutionFailure {
    fn failed(message: String) -> Self {
        Self::Failed {
            message,
            output: None,
        }
    }

    fn failed_with_output(message: String, output: JsTestBatchOutput) -> Self {
        Self::Failed {
            message,
            output: Some(output),
        }
    }
}

struct ExecutedPackage {
    execution: JsTestExecutionContext,
    #[cfg(unix)]
    package_manifest_authority: RetainedBatchPackageManifest,
    #[cfg(unix)]
    runner_generation: RetainedBatchRunnerGeneration,
    result: JsTestBatchPackageResult,
}

struct OwnedBatchChild {
    child: std::process::Child,
    ownership: TerminalTaskOwnership,
}

impl Drop for OwnedBatchChild {
    fn drop(&mut self) {
        if self.ownership.active_process_group_id().is_some() {
            self.ownership.terminate();
            let _ = self.ownership.wait_after_terminate(&mut self.child);
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct JsTestBatchCancellation {
    cancelled: Arc<AtomicBool>,
    active: Arc<Mutex<HashMap<usize, TerminalTaskOwnership>>>,
}

impl JsTestBatchCancellation {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn request_stop(&self) -> bool {
        let first = !self.cancelled.swap(true, Ordering::SeqCst);
        let owners = self
            .active()
            .values()
            .cloned()
            .collect::<Vec<TerminalTaskOwnership>>();
        owners.iter().for_each(|owner| {
            owner.request_stop();
        });
        first || !owners.is_empty()
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn activate(&self, index: usize, ownership: TerminalTaskOwnership) -> Result<(), String> {
        let mut active = self.active();
        if self.is_cancelled() {
            ownership.request_stop();
            return Err(
                "JavaScript test batch was cancelled before package activation.".to_string(),
            );
        }
        if active.insert(index, ownership).is_some() {
            return Err("JavaScript test batch package activated twice.".to_string());
        }
        Ok(())
    }

    fn finish(&self, index: usize) {
        self.active().remove(&index);
    }

    fn active(&self) -> MutexGuard<'_, HashMap<usize, TerminalTaskOwnership>> {
        self.active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(Clone, Default)]
pub(crate) struct JsTestBatchRegistry {
    entries: Arc<Mutex<HashMap<String, (WorkspaceId, JsTestBatchCancellation)>>>,
}

pub(crate) struct JsTestBatchReservation {
    registry: JsTestBatchRegistry,
    run_id: String,
    workspace_id: WorkspaceId,
    cancellation: JsTestBatchCancellation,
}

impl JsTestBatchReservation {
    pub(crate) fn cancellation(&self) -> JsTestBatchCancellation {
        self.cancellation.clone()
    }
}

impl Drop for JsTestBatchReservation {
    fn drop(&mut self) {
        let _ = self.registry.request_stop(&self.run_id, &self.workspace_id);
        self.registry.finish(&self.run_id, &self.workspace_id);
    }
}

impl JsTestBatchRegistry {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn reserve(
        &self,
        run_id: &str,
        workspace_id: &WorkspaceId,
    ) -> Result<JsTestBatchReservation, String> {
        validate_owner_id(run_id, "runId")?;
        validate_owner_id(workspace_id.as_str(), "workspaceId")?;
        let mut entries = self.entries();
        if entries.contains_key(run_id) {
            return Err("A JavaScript test batch with this runId already exists.".to_string());
        }
        if entries.len() >= MAX_LIVE_JS_TEST_BATCHES {
            return Err("Global JavaScript test batch limit reached.".to_string());
        }
        if entries
            .values()
            .filter(|(owner, _)| owner == workspace_id)
            .count()
            >= MAX_LIVE_JS_TEST_BATCHES_PER_WORKSPACE
        {
            return Err("Workspace JavaScript test batch limit reached.".to_string());
        }
        let cancellation = JsTestBatchCancellation::new();
        entries.insert(
            run_id.to_string(),
            (workspace_id.clone(), cancellation.clone()),
        );
        Ok(JsTestBatchReservation {
            registry: self.clone(),
            run_id: run_id.to_string(),
            workspace_id: workspace_id.clone(),
            cancellation,
        })
    }

    pub(crate) fn finish(&self, run_id: &str, workspace_id: &WorkspaceId) {
        let mut entries = self.entries();
        if entries
            .get(run_id)
            .is_some_and(|(owner, _)| owner == workspace_id)
        {
            entries.remove(run_id);
        }
    }

    pub(crate) fn request_stop(
        &self,
        run_id: &str,
        workspace_id: &WorkspaceId,
    ) -> Result<bool, String> {
        validate_owner_id(run_id, "runId")?;
        validate_owner_id(workspace_id.as_str(), "workspaceId")?;
        let cancellation = {
            let entries = self.entries();
            let Some((owner, cancellation)) = entries.get(run_id) else {
                return Ok(false);
            };
            if owner != workspace_id {
                return Err("JavaScript test batch belongs to a different workspace.".to_string());
            }
            cancellation.clone()
        };
        Ok(cancellation.request_stop())
    }

    pub(crate) fn stop_all(&self) {
        let cancellations = self
            .entries()
            .values()
            .map(|(_, cancellation)| cancellation.clone())
            .collect::<Vec<_>>();
        cancellations.iter().for_each(|cancellation| {
            cancellation.request_stop();
        });
    }

    pub(crate) fn request_stop_workspace(&self, workspace_id: &WorkspaceId) {
        let cancellations = self
            .entries()
            .values()
            .filter(|(owner, _)| owner == workspace_id)
            .map(|(_, cancellation)| cancellation.clone())
            .collect::<Vec<_>>();
        cancellations.iter().for_each(|cancellation| {
            cancellation.request_stop();
        });
    }

    fn entries(&self) -> MutexGuard<'_, HashMap<String, (WorkspaceId, JsTestBatchCancellation)>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.entries().is_empty()
    }
}

#[cfg(unix)]
pub(crate) fn prepare_registered_js_test_batch(
    registered_root: fs::File,
    app_data_base: &Path,
    package_roots: Vec<String>,
) -> Result<PreparedJsTestBatch, String> {
    let workspace_root = registered_root_path(&registered_root)?;
    ensure_registered_root_identity(&registered_root, &workspace_root)?;
    let normalized_roots = validate_package_roots(package_roots)?;
    let registered_root = Arc::new(registered_root);
    let mut packages = Vec::with_capacity(normalized_roots.len());

    for (index, (relative_text, relative_path)) in normalized_roots.into_iter().enumerate() {
        ensure_registered_root_identity(&registered_root, &workspace_root)?;
        let execution = resolve_js_test_execution_context(
            &workspace_root,
            &relative_text,
            JsTestRunScope::All,
        )?;
        ensure_js_test_execution_context_identity(&execution)?;
        let package_manifest_authority =
            retain_and_validate_package_manifest(&execution.execution_root)?;
        let runner = detect_runner_in_workspace(
            &execution.execution_root,
            &execution.package_root_path,
            &workspace_root,
        )?
        .ok_or_else(|| {
            format!(
                "No JavaScript test runner is available for package `{}`.",
                display_package_root(&relative_text)
            )
        })?;
        let (binary, runner_kind, runner_receipt) = match &runner {
            JsTestRunner::Jest(binary) => (
                binary,
                RetainedJsTestRunnerKind::Jest,
                JsTestBatchRunner::Jest,
            ),
            JsTestRunner::Vitest(binary) => (
                binary,
                RetainedJsTestRunnerKind::Vitest,
                JsTestBatchRunner::Vitest,
            ),
        };
        let process_authority = retain_js_test_process_authority(&execution, binary, runner_kind)?;
        let runner_generation = RetainedBatchRunnerGeneration::capture(binary)?;
        let result_path = prepare_result_path_with_extension(
            app_data_base,
            RESULT_SUBDIRECTORY,
            RESULT_LABEL,
            "json",
        )?;
        let result_authority = RetainedBatchResultFile::create(result_path)?;
        let normalized_text = if relative_path.as_os_str().is_empty() {
            String::new()
        } else {
            relative_path.to_string_lossy().into_owned()
        };
        packages.push(PreparedJsTestPackage {
            index,
            authority_receipt: JsTestBatchPackageAuthority {
                package_root_relative_path: normalized_text,
                runner: runner_receipt,
            },
            execution,
            package_manifest_authority,
            runner,
            process_authority,
            result_authority,
            runner_generation,
        });
    }
    ensure_registered_root_identity(&registered_root, &workspace_root)?;
    Ok(PreparedJsTestBatch {
        registered_root,
        workspace_root,
        packages,
    })
}

pub(crate) fn execute_prepared_js_test_batch(
    prepared: PreparedJsTestBatch,
    cancellation: JsTestBatchCancellation,
) -> JsTestBatchOutcome {
    execute_prepared_js_test_batch_with_timeout_policy(
        prepared,
        cancellation,
        Arc::new(ElapsedBatchTimeout(RUNNER_TIMEOUT)),
    )
}

trait BatchTimeoutPolicy: Send + Sync {
    fn expired(&self, started_at: Instant) -> bool;
}

struct ElapsedBatchTimeout(Duration);

impl BatchTimeoutPolicy for ElapsedBatchTimeout {
    fn expired(&self, started_at: Instant) -> bool {
        started_at.elapsed() >= self.0
    }
}

fn execute_prepared_js_test_batch_with_timeout_policy(
    prepared: PreparedJsTestBatch,
    cancellation: JsTestBatchCancellation,
    timeout_policy: Arc<dyn BatchTimeoutPolicy>,
) -> JsTestBatchOutcome {
    let authorities = prepared
        .packages
        .iter()
        .map(|package| package.authority_receipt.clone())
        .collect::<Vec<_>>();
    if cancellation.is_cancelled() {
        return JsTestBatchOutcome::Cancelled {
            authorities,
            output: JsTestBatchOutput::default(),
        };
    }

    let package_count = prepared.packages.len();
    let queue = Arc::new(Mutex::new(VecDeque::from(prepared.packages)));
    let registered_root = prepared.registered_root;
    let workspace_root = prepared.workspace_root;
    let (result_tx, result_rx) = mpsc::channel();
    let workers = package_count.min(JS_TEST_BATCH_CONCURRENCY);
    let projection_budget = Arc::new(BatchProjectionBudget::default());

    let worker_start = thread::scope(|scope| {
        let mut handles = Vec::with_capacity(workers);
        for _ in 0..workers {
            let queue = Arc::clone(&queue);
            let registered_root = Arc::clone(&registered_root);
            let workspace_root = workspace_root.clone();
            let worker_cancellation = cancellation.clone();
            let result_tx = result_tx.clone();
            let projection_budget = Arc::clone(&projection_budget);
            let timeout_policy = Arc::clone(&timeout_policy);
            match thread::Builder::new()
                .name("js-test-batch-worker".to_string())
                .spawn_scoped(scope, move || loop {
                    if worker_cancellation.is_cancelled() {
                        break;
                    }
                    let package = queue
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .pop_front();
                    let Some(package) = package else {
                        break;
                    };
                    let index = package.index;
                    let result = execute_prepared_package(
                        package,
                        &registered_root,
                        &workspace_root,
                        &worker_cancellation,
                        &projection_budget,
                        timeout_policy.as_ref(),
                    );
                    if matches!(result, Err(PackageExecutionFailure::Failed { .. })) {
                        worker_cancellation.request_stop();
                    }
                    if result_tx.send((index, result)).is_err() {
                        worker_cancellation.request_stop();
                        break;
                    }
                }) {
                Ok(handle) => handles.push(handle),
                Err(error) => {
                    cancellation.request_stop();
                    for handle in handles {
                        let _ = handle.join();
                    }
                    return Err(format!(
                        "Failed to start JavaScript test batch worker: {error}"
                    ));
                }
            }
        }
        for handle in handles {
            if handle.join().is_err() {
                cancellation.request_stop();
                return Err("JavaScript test batch worker panicked.".to_string());
            }
        }
        Ok(())
    });
    drop(result_tx);

    let mut ordered = Vec::with_capacity(package_count);
    ordered.resize_with(package_count, || None);
    let mut first_error = None;
    let mut saw_cancelled_package = false;
    let mut failure_outputs = Vec::new();
    for (index, result) in result_rx {
        match result {
            Ok(package) => ordered[index] = Some(package),
            Err(PackageExecutionFailure::Failed { message, output }) => {
                if first_error.is_none() {
                    first_error = Some(message);
                }
                failure_outputs.extend(output);
            }
            Err(PackageExecutionFailure::Cancelled { output }) => {
                saw_cancelled_package = true;
                failure_outputs.extend(output);
            }
        }
    }
    let aggregate_current_output = || {
        aggregate_output(
            ordered
                .iter()
                .flatten()
                .map(|package| &package.result.output)
                .chain(failure_outputs.iter()),
        )
    };
    if let Err(message) = worker_start {
        return JsTestBatchOutcome::Error {
            message,
            authorities,
            output: aggregate_current_output(),
        };
    }
    if first_error.is_none() && (cancellation.is_cancelled() || saw_cancelled_package) {
        return JsTestBatchOutcome::Cancelled {
            authorities,
            output: aggregate_current_output(),
        };
    }
    if let Some(message) = first_error {
        return JsTestBatchOutcome::Error {
            message,
            authorities,
            output: aggregate_current_output(),
        };
    }
    if ordered.iter().any(Option::is_none) {
        return JsTestBatchOutcome::Error {
            message: "JavaScript test batch ended without an exact result for every package."
                .to_string(),
            authorities,
            output: aggregate_current_output(),
        };
    }
    if let Err(message) = ordered
        .iter()
        .flatten()
        .try_for_each(ExecutedPackage::ensure_publication_authority)
    {
        return JsTestBatchOutcome::Error {
            message,
            authorities,
            output: aggregate_current_output(),
        };
    }
    if let Err(message) = ensure_registered_root_identity(&registered_root, &workspace_root) {
        return JsTestBatchOutcome::Error {
            message,
            authorities,
            output: aggregate_current_output(),
        };
    }
    let packages = ordered
        .into_iter()
        .flatten()
        .map(|package| package.result)
        .collect::<Vec<_>>();
    if let Err(message) = validate_batch_projection(&packages) {
        return JsTestBatchOutcome::Error {
            message,
            authorities,
            output: aggregate_output(packages.iter().map(|package| &package.output)),
        };
    }
    let totals = aggregate_totals(&packages);
    JsTestBatchOutcome::Ok { packages, totals }
}

fn execute_prepared_package(
    package: PreparedJsTestPackage,
    registered_root: &fs::File,
    workspace_root: &Path,
    cancellation: &JsTestBatchCancellation,
    projection_budget: &BatchProjectionBudget,
    timeout_policy: &dyn BatchTimeoutPolicy,
) -> Result<ExecutedPackage, PackageExecutionFailure> {
    let PreparedJsTestPackage {
        index,
        authority_receipt,
        execution,
        #[cfg(unix)]
        package_manifest_authority,
        runner,
        process_authority,
        result_authority,
        #[cfg(unix)]
        runner_generation,
    } = package;
    let result_path = result_authority.path().to_path_buf();
    ensure_registered_root_identity(registered_root, workspace_root)
        .map_err(PackageExecutionFailure::failed)?;
    ensure_js_test_execution_context_identity(&execution)
        .map_err(PackageExecutionFailure::failed)?;
    #[cfg(unix)]
    package_manifest_authority
        .ensure_identity()
        .map_err(PackageExecutionFailure::failed)?;
    #[cfg(unix)]
    runner_generation
        .ensure_identity()
        .map_err(PackageExecutionFailure::failed)?;
    process_authority
        .ensure_spawn_identity()
        .map_err(PackageExecutionFailure::failed)?;
    if cancellation.is_cancelled() {
        return Err(PackageExecutionFailure::Cancelled { output: None });
    }

    let args = runner_args(&runner, &result_path, None);
    let mut command = process_authority.into_command(args);
    command
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|error| {
        PackageExecutionFailure::failed(format!(
            "Failed to start JavaScript test batch package `{}`: {error}",
            display_package_root(&authority_receipt.package_root_relative_path)
        ))
    })?;
    let process_group_id = match i32::try_from(child.id()) {
        Ok(process_group_id) => process_group_id,
        Err(_) => {
            #[cfg(unix)]
            crate::debug_support::DebugProcessHandle::from_process_id(child.id()).terminate();
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
            return Err(PackageExecutionFailure::failed(
                "JavaScript test batch process id is invalid.".to_string(),
            ));
        }
    };
    let ownership = TerminalTaskOwnership::new(0, index as u64, process_group_id);
    let mut owned_child = OwnedBatchChild {
        child,
        ownership: ownership.clone(),
    };
    let stdout = owned_child.child.stdout.take().ok_or_else(|| {
        PackageExecutionFailure::failed(
            "JavaScript test batch runner has no stdout pipe.".to_string(),
        )
    })?;
    let stderr = owned_child.child.stderr.take().ok_or_else(|| {
        PackageExecutionFailure::failed(
            "JavaScript test batch runner has no stderr pipe.".to_string(),
        )
    })?;
    let stdout_reader =
        thread::spawn(move || read_bounded_captured_stream(stdout, CAPTURED_STREAM_BYTES_LIMIT));
    let stderr_reader =
        thread::spawn(move || read_bounded_captured_stream(stderr, CAPTURED_STREAM_BYTES_LIMIT));
    if let Err(message) = cancellation.activate(index, ownership.clone()) {
        ownership.terminate();
        let _ = ownership.wait_after_terminate(&mut owned_child.child);
        let _ = stdout_reader.join();
        let _ = stderr_reader.join();
        return if cancellation.is_cancelled() {
            Err(PackageExecutionFailure::Cancelled { output: None })
        } else {
            Err(PackageExecutionFailure::failed(message))
        };
    }

    let started_at = Instant::now();
    let wait_result = loop {
        match ownership.try_wait(&mut owned_child.child) {
            Ok(Some(_)) => break Ok(()),
            Ok(None) if cancellation.is_cancelled() => {
                ownership.request_stop();
            }
            Ok(None) if timeout_policy.expired(started_at) => {
                ownership.terminate();
                let _ = ownership.wait_after_terminate(&mut owned_child.child);
                break Err(format!(
                    "JavaScript test batch package `{}` timed out.",
                    display_package_root(&authority_receipt.package_root_relative_path)
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                ownership.terminate();
                let _ = ownership.wait_after_terminate(&mut owned_child.child);
                break Err(format!(
                    "Failed to reap JavaScript test batch package `{}`: {error}",
                    display_package_root(&authority_receipt.package_root_relative_path)
                ));
            }
        }
    };
    cancellation.finish(index);
    let stdout = join_stream(stdout_reader, "stdout").map_err(PackageExecutionFailure::failed)?;
    let stderr = join_stream(stderr_reader, "stderr").map_err(PackageExecutionFailure::failed)?;
    let output = JsTestBatchOutput {
        stdout: stream_output(&stdout),
        stderr: stream_output(&stderr),
    };
    if let Err(message) = wait_result {
        return Err(PackageExecutionFailure::failed_with_output(message, output));
    }
    if cancellation.is_cancelled() || ownership.was_stop_requested() {
        return Err(PackageExecutionFailure::Cancelled {
            output: Some(output),
        });
    }
    if let Some(error) = stdout.read_error.or(stderr.read_error) {
        return Err(PackageExecutionFailure::failed_with_output(
            format!("Failed to read JavaScript test batch package output: {error}"),
            output,
        ));
    }
    ensure_registered_root_identity(registered_root, workspace_root)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    ensure_js_test_execution_context_identity(&execution)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    result_authority
        .ensure_path_identity()
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    let report_length = result_authority
        .validated_len(MAX_REPORT_BYTES)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    projection_budget
        .reserve_report_bytes(report_length)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    let json = match result_authority.read_exact(report_length) {
        Ok(json) => json,
        Err(message) => {
            projection_budget.release_report_bytes(report_length);
            return Err(PackageExecutionFailure::failed_with_output(message, output));
        }
    };
    let response = projection_budget
        .parse_and_reserve(&json, workspace_root)
        .map_err(|error| {
            PackageExecutionFailure::failed_with_output(
                format!(
                    "Failed to process JavaScript test batch package `{}` report: {error}",
                    display_package_root(&authority_receipt.package_root_relative_path)
                ),
                output.clone(),
            )
        })?;
    ensure_registered_root_identity(registered_root, workspace_root)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    ensure_js_test_execution_context_identity(&execution)
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    #[cfg(unix)]
    package_manifest_authority
        .ensure_identity()
        .map_err(|message| PackageExecutionFailure::failed_with_output(message, output.clone()))?;
    Ok(ExecutedPackage {
        execution,
        #[cfg(unix)]
        package_manifest_authority,
        #[cfg(unix)]
        runner_generation,
        result: JsTestBatchPackageResult {
            authority: authority_receipt,
            response,
            output,
        },
    })
}

impl ExecutedPackage {
    fn ensure_publication_authority(&self) -> Result<(), String> {
        ensure_js_test_execution_context_identity(&self.execution)?;
        #[cfg(unix)]
        self.package_manifest_authority.ensure_identity()?;
        #[cfg(unix)]
        self.runner_generation.ensure_identity()?;
        Ok(())
    }
}

fn join_stream(
    reader: thread::JoinHandle<BoundedCapturedStream>,
    label: &str,
) -> Result<BoundedCapturedStream, String> {
    reader
        .join()
        .map_err(|_| format!("JavaScript test batch {label} reader panicked."))
}

fn stream_output(stream: &BoundedCapturedStream) -> JsTestBatchOutputStream {
    JsTestBatchOutputStream {
        text: stream.text.clone(),
        truncated: stream.truncated,
    }
}

fn display_package_root(value: &str) -> &str {
    if value.is_empty() {
        "."
    } else {
        value
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::php_test_run::{PhpTestCase, PhpTestStatus, PhpTestSuite};
    use fifo_test_support::{open_fifo, read_start_events};
    use std::{io::Write, os::unix::fs::PermissionsExt, sync::atomic::AtomicU64};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-js-test-batch-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).expect("create root");
        root
    }

    fn install_package(root: &Path, relative: &str, runner: JsTestBatchRunner, body: &str) {
        let package = root.join(relative);
        fs::create_dir_all(&package).expect("create package");
        let runner_name = match runner {
            JsTestBatchRunner::Jest => "jest",
            JsTestBatchRunner::Vitest => "vitest",
        };
        fs::write(
            package.join("package.json"),
            format!(r#"{{"devDependencies":{{"{runner_name}":"1"}}}}"#),
        )
        .expect("write manifest");
        let binary = package.join("node_modules/.bin").join(runner_name);
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("create binary parent");
        fs::write(&binary, format!("#!/bin/sh\n{body}\n")).expect("write runner");
        let mut permissions = fs::metadata(&binary).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("permissions");
    }

    fn report_script(marker: &str) -> String {
        format!(
            "output=''\nfor arg in \"$@\"; do case \"$arg\" in --outputFile=*) output=\"${{arg#--outputFile=}}\";; esac; done\nprintf '%s' '{{\"testResults\":[{{\"name\":\"{marker}.test.js\",\"status\":\"passed\",\"assertionResults\":[{{\"title\":\"works\",\"fullName\":\"works\",\"status\":\"passed\",\"duration\":1}}]}}]}}' > \"$output\""
        )
    }

    fn registered(root: &Path) -> fs::File {
        fs::File::open(root).expect("open registered root")
    }

    fn app_data(root: &Path) -> PathBuf {
        root.parent().expect("workspace parent").join(format!(
            "{}-app-data",
            root.file_name().expect("workspace name").to_string_lossy()
        ))
    }

    fn cleanup(root: PathBuf) {
        let data = app_data(&root);
        fs::remove_dir_all(root).expect("cleanup workspace");
        if data.exists() {
            fs::remove_dir_all(data).expect("cleanup app data");
        }
    }

    #[test]
    fn request_and_outcome_wire_contracts_are_closed_and_owner_independent() {
        assert!(
            serde_json::from_value::<JsTestBatchRequest>(serde_json::json!({
                "runId": "batch-1",
                "workspaceId": "workspace-1",
                "packages": [{"packageRootRelativePath": "packages/a"}],
                "unknown": true
            }))
            .is_err()
        );
        let outcome = JsTestBatchOutcome::Cancelled {
            authorities: vec![JsTestBatchPackageAuthority {
                package_root_relative_path: "packages/a".to_string(),
                runner: JsTestBatchRunner::Vitest,
            }],
            output: JsTestBatchOutput::default(),
        };
        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            serde_json::json!({
                "status": "cancelled",
                "authorities": [{
                    "packageRootRelativePath": "packages/a",
                    "runner": "vitest"
                }],
                "output": {
                    "stdout": {"text": "", "truncated": false},
                    "stderr": {"text": "", "truncated": false}
                }
            })
        );
    }

    #[test]
    fn rejects_empty_over_limit_duplicate_ancestor_and_non_normal_roots() {
        assert!(validate_package_roots(Vec::new()).is_err());
        assert!(validate_package_roots(
            (0..=MAX_JS_TEST_BATCH_PACKAGES)
                .map(|index| format!("packages/{index}"))
                .collect()
        )
        .unwrap_err()
        .contains("safety limit"));
        assert!(validate_package_roots(vec!["a".into(), "a".into()])
            .unwrap_err()
            .contains("duplicate"));
        assert!(
            validate_package_roots(vec!["packages".into(), "packages/a".into()])
                .unwrap_err()
                .contains("non-overlapping")
        );
        assert!(validate_package_roots(vec!["packages/../a".into()]).is_err());
        for malformed in [
            "packages//a",
            "packages/a/",
            r"packages\a",
            "packages/\na",
            "packages/\u{202e}hidden",
        ] {
            assert!(
                validate_package_roots(vec![malformed.to_string()]).is_err(),
                "{malformed:?} must fail closed"
            );
        }
    }

    #[test]
    fn prepares_nested_jest_and_vitest_before_running_and_aggregates_in_stable_order() {
        let root = temp_root("nested");
        install_package(
            &root,
            "apps/api",
            JsTestBatchRunner::Jest,
            &report_script("api"),
        );
        install_package(
            &root,
            "packages/ui",
            JsTestBatchRunner::Vitest,
            &report_script("ui"),
        );
        let app_data = app_data(&root);
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data,
            vec!["packages/ui".into(), "apps/api".into()],
        )
        .expect("prepare");
        let outcome = execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new());
        let JsTestBatchOutcome::Ok { packages, totals } = outcome else {
            panic!("expected successful batch, got {outcome:?}");
        };
        assert_eq!(packages.len(), 2);
        assert_eq!(
            packages[0].authority.package_root_relative_path,
            "packages/ui"
        );
        assert_eq!(packages[0].authority.runner, JsTestBatchRunner::Vitest);
        assert_eq!(packages[1].authority.package_root_relative_path, "apps/api");
        assert_eq!(packages[1].authority.runner, JsTestBatchRunner::Jest);
        assert_eq!(totals.tests, 2);
        cleanup(root);
    }

    #[test]
    fn malformed_manifest_and_more_than_eight_packages_fail_before_any_spawn() {
        let root = temp_root("preflight");
        let starts = root.join("starts");
        for index in 0..MAX_JS_TEST_BATCH_PACKAGES {
            install_package(
                &root,
                &format!("packages/{index}"),
                JsTestBatchRunner::Vitest,
                &format!("printf x >> '{}'", starts.display()),
            );
        }
        fs::write(root.join("packages/7/package.json"), "{").expect("break manifest");
        let error = match prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            (0..MAX_JS_TEST_BATCH_PACKAGES)
                .map(|index| format!("packages/{index}"))
                .collect(),
        ) {
            Ok(_) => panic!("malformed manifest must fail"),
            Err(error) => error,
        };
        assert!(error.contains("manifest is invalid"));
        assert!(!starts.exists());
        cleanup(root);
    }

    #[test]
    fn concurrency_is_exactly_bounded_to_two() {
        let root = temp_root("concurrency");
        let markers = root.join("markers");
        fs::create_dir_all(&markers).expect("create marker directory");
        let active = markers.join("active");
        let peak = markers.join("peak");
        fs::write(&peak, "").expect("prepare peak marker");
        for index in 0..4 {
            let synchronization = if index < 2 {
                let own = markers.join(format!("ready-{index}"));
                let other = markers.join(format!("ready-{}", 1 - index));
                format!(
                    "touch '{}'\nattempt=0\nwhile [ ! -f '{}' ] && [ \"$attempt\" -lt 200 ]; do attempt=$((attempt + 1)); sleep 0.01; done\n[ -f '{}' ] || exit 9\nprintf '2\\n' >> '{}'\n",
                    own.display(),
                    other.display(),
                    other.display(),
                    peak.display()
                )
            } else {
                String::new()
            };
            install_package(
                &root,
                &format!("packages/{index}"),
                JsTestBatchRunner::Vitest,
                &format!(
                    "{synchronization}mkdir '{}.$$.lock'\ncount=$(find '{}' -name 'active.*.lock' | wc -l | tr -d ' ')\nprintf '%s\\n' \"$count\" >> '{}'\nsleep 0.05\nrmdir '{}.$$.lock'\n{}",
                    active.display(),
                    root.display(),
                    peak.display(),
                    active.display(),
                    report_script(&format!("package-{index}"))
                ),
            );
        }
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            (0..4).map(|index| format!("packages/{index}")).collect(),
        )
        .expect("prepare");
        let outcome = execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new());
        assert!(
            matches!(outcome, JsTestBatchOutcome::Ok { .. }),
            "unexpected outcome: {outcome:?}"
        );
        let observed = fs::read_to_string(peak).expect("read peak");
        assert!(observed
            .lines()
            .all(|line| line.parse::<usize>().unwrap() <= 2));
        assert!(
            observed.lines().any(|line| line == "2"),
            "expected overlap evidence, observed {observed:?}"
        );
        cleanup(root);
    }

    #[test]
    fn cancellation_reaps_the_complete_active_child_set_and_publishes_no_partial_results() {
        let root = temp_root("cancel");
        let markers = root.join("markers");
        fs::create_dir_all(&markers).expect("create marker directory");
        let ready = markers.join("ready");
        fs::write(&ready, "").expect("prepare ready marker");
        for index in 0..3 {
            install_package(
                &root,
                &format!("packages/{index}"),
                JsTestBatchRunner::Vitest,
                &format!("printf x >> '{}'\nsleep 30", ready.display()),
            );
        }
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            (0..3).map(|index| format!("packages/{index}")).collect(),
        )
        .expect("prepare");
        let cancellation = JsTestBatchCancellation::new();
        let worker_cancellation = cancellation.clone();
        let worker =
            thread::spawn(move || execute_prepared_js_test_batch(prepared, worker_cancellation));
        let deadline = Instant::now() + Duration::from_secs(2);
        while fs::read(&ready).map_or(0, |bytes| bytes.len()) < 2 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(cancellation.request_stop());
        assert!(matches!(
            worker.join().expect("join"),
            JsTestBatchOutcome::Cancelled { .. } | JsTestBatchOutcome::Error { .. }
        ));
        assert!(cancellation.active().is_empty());
        cleanup(root);
    }

    #[test]
    fn partial_start_failure_rolls_back_and_reaps_every_started_sibling() {
        let root = temp_root("partial-start");
        let markers = root.join("markers");
        fs::create_dir_all(&markers).expect("create markers");
        let ready = markers.join("ready");
        let release_a = markers.join("release-a");
        let hold_b = markers.join("hold-b");
        let child_pid = markers.join("child-pid");
        let mut ready_events = open_fifo(&ready);
        let mut release_a_event = open_fifo(&release_a);
        let _hold_b_event = open_fifo(&hold_b);
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            &format!(
                "printf a > '{}'\nread event < '{}'\n{}",
                ready.display(),
                release_a.display(),
                report_script("a")
            ),
        );
        install_package(
            &root,
            "packages/b",
            JsTestBatchRunner::Vitest,
            &format!(
                "printf '%s' $$ > '{}.tmp'\nmv '{}.tmp' '{}'\nprintf b > '{}'\nread event < '{}'",
                child_pid.display(),
                child_pid.display(),
                child_pid.display(),
                ready.display(),
                hold_b.display()
            ),
        );
        install_package(
            &root,
            "packages/c",
            JsTestBatchRunner::Vitest,
            &report_script("c"),
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec![
                "packages/a".into(),
                "packages/b".into(),
                "packages/c".into(),
            ],
        )
        .expect("prepare");
        let worker = thread::spawn(move || {
            execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new())
        });
        let mut started = [0; 2];
        read_start_events(
            &mut ready_events,
            &mut started,
            Duration::from_secs(5),
            "sibling starts",
        );
        started.sort();
        assert_eq!(
            started,
            [b'a', b'b'],
            "both siblings must signal their exact start event"
        );
        let pid_contents =
            fs::read_to_string(&child_pid).expect("read child pid after start event");
        let pid = pid_contents.trim().parse::<i32>();
        assert!(
            pid.is_ok(),
            "child pid must be parseable after package b signals readiness: {pid_contents:?}"
        );
        let pid = pid.unwrap_or_default();
        let binary = root.join("packages/c/node_modules/.bin/vitest");
        fs::rename(&binary, binary.with_extension("old")).expect("replace third runner");
        fs::write(&binary, "#!/bin/sh\nexit 0\n").expect("replacement runner");
        let mut permissions = fs::metadata(&binary)
            .expect("replacement metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).expect("replacement permissions");
        release_a_event
            .write_all(b"go\n")
            .expect("release first package");
        assert!(matches!(
            worker.join().expect("join batch"),
            JsTestBatchOutcome::Error { .. }
        ));
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        cleanup(root);
    }

    #[test]
    fn package_identity_replacement_after_prepare_fails_closed_without_publishing_packages() {
        let root = temp_root("replacement");
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            &report_script("a"),
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec!["packages/a".into()],
        )
        .expect("prepare");
        fs::rename(root.join("packages/a"), root.join("packages/a-old")).expect("move old");
        fs::create_dir_all(root.join("packages/a")).expect("replacement");
        let outcome = execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new());
        assert!(matches!(outcome, JsTestBatchOutcome::Error { .. }));
        cleanup(root);
    }

    #[test]
    fn in_place_manifest_change_after_prepare_fails_closed() {
        let root = temp_root("manifest-change");
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            &report_script("a"),
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec!["packages/a".into()],
        )
        .expect("prepare");
        fs::write(
            root.join("packages/a/package.json"),
            r#"{"devDependencies":{"vitest":"2"}}"#,
        )
        .expect("mutate manifest in place");
        assert!(matches!(
            execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new()),
            JsTestBatchOutcome::Error { .. }
        ));
        cleanup(root);
    }

    #[test]
    fn concurrent_same_inode_manifest_rewrite_fails_closed_before_publication() {
        let root = temp_root("manifest-concurrent-rewrite");
        let markers = root.join("markers");
        fs::create_dir_all(&markers).expect("create markers");
        let ready = markers.join("ready");
        let release = markers.join("release");
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            &format!(
                "touch '{}'\nwhile [ ! -f '{}' ]; do sleep 0.01; done\n{}",
                ready.display(),
                release.display(),
                report_script("a")
            ),
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec!["packages/a".into()],
        )
        .expect("prepare");
        let worker = thread::spawn(move || {
            execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new())
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while !ready.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists(), "runner must be active before rewrite");
        fs::write(
            root.join("packages/a/package.json"),
            r#"{"devDependencies":{"vitest":"same-inode-rewrite"}}"#,
        )
        .expect("rewrite retained inode");
        fs::write(release, "go").expect("release runner");
        assert!(matches!(
            worker.join().expect("join batch"),
            JsTestBatchOutcome::Error { .. }
        ));
        cleanup(root);
    }

    #[test]
    fn report_path_replacement_fails_closed_and_publishes_no_package_results() {
        let root = temp_root("report-replacement");
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            "output=''\nfor arg in \"$@\"; do case \"$arg\" in --outputFile=*) output=\"${arg#--outputFile=}\";; esac; done\nrm -f \"$output\"\nprintf '%s' '{\"testResults\":[]}' > \"$output\"",
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec!["packages/a".into()],
        )
        .expect("prepare");
        let outcome = execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new());
        let JsTestBatchOutcome::Error {
            message,
            authorities,
            ..
        } = outcome
        else {
            panic!("replacement must fail the whole batch");
        };
        assert!(message.contains("report identity changed"));
        assert_eq!(authorities.len(), 1);
        cleanup(root);
    }

    #[test]
    fn registry_is_exact_owner_bound_and_stop_is_idempotent() {
        let registry = JsTestBatchRegistry::new();
        let workspace_a: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-a")).unwrap();
        let workspace_b: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-b")).unwrap();
        let oversized_workspace: WorkspaceId =
            serde_json::from_value(serde_json::json!("w".repeat(MAX_BATCH_OWNER_ID_BYTES + 1)))
                .unwrap();
        assert!(registry.reserve("run", &oversized_workspace).is_err());
        assert!(registry
            .reserve(&"r".repeat(MAX_BATCH_OWNER_ID_BYTES + 1), &workspace_a)
            .is_err());
        let reservation = registry.reserve("run-1", &workspace_a).expect("reserve");
        let cancellation = reservation.cancellation();
        assert!(registry.reserve("run-1", &workspace_a).is_err());
        assert!(registry.request_stop("run-1", &workspace_b).is_err());
        assert!(registry.request_stop("run-1", &workspace_a).expect("stop"));
        assert!(!cancellation.request_stop());
        drop(reservation);
        assert!(!registry
            .request_stop("run-1", &workspace_a)
            .expect("late stop"));
    }

    #[test]
    fn registry_stop_all_cancels_every_generation_without_holding_its_registry_lock() {
        let registry = JsTestBatchRegistry::new();
        let workspace_a: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-a")).unwrap();
        let workspace_b: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-b")).unwrap();
        let reservation_a = registry.reserve("run-a", &workspace_a).expect("reserve a");
        let reservation_b = registry.reserve("run-b", &workspace_b).expect("reserve b");
        let cancellation_a = reservation_a.cancellation();
        let cancellation_b = reservation_b.cancellation();
        registry.stop_all();
        assert!(cancellation_a.is_cancelled());
        assert!(cancellation_b.is_cancelled());
        assert!(registry.entries().contains_key("run-a"));
        assert!(registry.entries().contains_key("run-b"));
    }

    #[test]
    fn registry_workspace_stop_cancels_only_the_exact_workspace_generations() {
        let registry = JsTestBatchRegistry::new();
        let workspace_a: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-a")).unwrap();
        let workspace_b: WorkspaceId =
            serde_json::from_value(serde_json::json!("workspace-b")).unwrap();
        let reservation_a = registry.reserve("run-a", &workspace_a).expect("reserve a");
        let reservation_b = registry.reserve("run-b", &workspace_b).expect("reserve b");
        let cancellation_a = reservation_a.cancellation();
        let cancellation_b = reservation_b.cancellation();
        registry.request_stop_workspace(&workspace_a);
        assert!(cancellation_a.is_cancelled());
        assert!(!cancellation_b.is_cancelled());
    }

    #[test]
    fn aggregate_output_is_bounded_and_truthfully_truncated() {
        let output = JsTestBatchOutput {
            stdout: JsTestBatchOutputStream {
                text: "x".repeat(CAPTURED_STREAM_BYTES_LIMIT),
                truncated: false,
            },
            stderr: JsTestBatchOutputStream::default(),
        };
        let aggregate = aggregate_output([&output, &output].into_iter());
        assert_eq!(aggregate.stdout.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(aggregate.stdout.truncated);
    }

    fn projected_package(case_count: usize, root: &str) -> JsTestBatchPackageResult {
        JsTestBatchPackageResult {
            authority: JsTestBatchPackageAuthority {
                package_root_relative_path: root.to_string(),
                runner: JsTestBatchRunner::Vitest,
            },
            response: PhpTestRunResponse::Ok {
                suites: vec![PhpTestSuite {
                    name: Some(format!("{root}/suite")),
                    tests: Some(case_count as u64),
                    failures: Some(0),
                    errors: Some(0),
                    skipped: Some(0),
                    time: Some(1.0),
                    cases: (0..case_count)
                        .map(|index| PhpTestCase {
                            name: Some(format!("case-{index}")),
                            classname: None,
                            file: None,
                            line: None,
                            time: Some(0.0),
                            status: PhpTestStatus::Passed,
                            message: None,
                        })
                        .collect(),
                }],
                totals: PhpTestTotals {
                    tests: case_count as u64,
                    failures: 0,
                    errors: 0,
                    skipped: 0,
                    time: Some(1.0),
                },
            },
            output: JsTestBatchOutput::default(),
        }
    }

    #[test]
    fn aggregate_projection_accepts_exact_case_limit_and_rejects_limit_plus_one() {
        let exact = vec![
            projected_package(MAX_CASES / 2, "packages/a"),
            projected_package(MAX_CASES - (MAX_CASES / 2), "packages/b"),
        ];
        assert!(validate_batch_projection(&exact).is_ok());
        let overflow = vec![
            projected_package(MAX_CASES / 2, "packages/a"),
            projected_package(MAX_CASES - (MAX_CASES / 2) + 1, "packages/b"),
        ];
        assert!(validate_batch_projection(&overflow)
            .unwrap_err()
            .contains("aggregate safety limit"));
    }

    fn raw_report(case_count: usize) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "testResults": [{
                "name": "suite.test.js",
                "status": "passed",
                "assertionResults": (0..case_count).map(|index| serde_json::json!({
                    "title": format!("case-{index}"),
                    "fullName": format!("case-{index}"),
                    "status": "passed",
                    "duration": 1
                })).collect::<Vec<_>>()
            }]
        }))
        .expect("serialize report")
    }

    fn raw_report_script(report: &[u8], before: &str) -> String {
        let report = std::str::from_utf8(report).expect("UTF-8 JSON report");
        assert!(!report.contains('\''), "fixture must be shell-quote safe");
        format!(
            "{before}\noutput=''\nfor arg in \"$@\"; do case \"$arg\" in --outputFile=*) output=\"${{arg#--outputFile=}}\";; esac; done\nprintf '%s' '{report}' > \"$output\""
        )
    }

    #[test]
    fn shared_parse_budget_rejects_second_package_before_projecting_over_five_thousand() {
        let budget = BatchProjectionBudget::default();
        let first = raw_report(2_500);
        budget
            .reserve_report_bytes(first.len() as u64)
            .expect("reserve first report");
        assert!(budget
            .parse_and_reserve(&first, Path::new("/workspace"))
            .is_ok());
        let second = raw_report(2_501);
        budget
            .reserve_report_bytes(second.len() as u64)
            .expect("reserve second report");
        let error = budget
            .parse_and_reserve(&second, Path::new("/workspace"))
            .expect_err("aggregate case limit must reject second package");
        assert!(error.contains("remaining batch safety limit"));
        let state = budget
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert_eq!(state.cases, 2_500);
        assert_eq!(state.suites, 1);
    }

    #[test]
    fn aggregate_budget_exhaustion_cancels_and_reaps_sibling_without_partial_publication() {
        let root = temp_root("aggregate-budget-cancel");
        let markers = root.join("markers");
        fs::create_dir_all(&markers).expect("create markers");
        let ready = markers.join("ready");
        let sibling_pid = markers.join("sibling-pid");
        let _ready_event = open_fifo(&ready);
        install_package(
            &root,
            "packages/a",
            JsTestBatchRunner::Vitest,
            &raw_report_script(
                &raw_report(3_000),
                &format!("read event < '{}'", ready.display()),
            ),
        );
        install_package(
            &root,
            "packages/b",
            JsTestBatchRunner::Vitest,
            &format!(
                "printf '%s' $$ > '{}.tmp'\nmv '{}.tmp' '{}'\nprintf 'b\\n' > '{}'\nsleep 30",
                sibling_pid.display(),
                sibling_pid.display(),
                sibling_pid.display(),
                ready.display()
            ),
        );
        install_package(
            &root,
            "packages/c",
            JsTestBatchRunner::Vitest,
            &raw_report_script(&raw_report(2_001), ""),
        );
        let prepared = prepare_registered_js_test_batch(
            registered(&root),
            &app_data(&root),
            vec![
                "packages/a".into(),
                "packages/b".into(),
                "packages/c".into(),
            ],
        )
        .expect("prepare");
        let outcome = execute_prepared_js_test_batch(prepared, JsTestBatchCancellation::new());
        let JsTestBatchOutcome::Error { message, .. } = outcome else {
            panic!("aggregate overflow must atomically fail the whole batch");
        };
        assert!(message.contains("remaining batch safety limit"));
        let pid = test_support::wait_for_parseable_pid(&sibling_pid, "sibling pid");
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        cleanup(root);
    }

    mod timeout_tests {
        use super::*;
        include!("js_test_batch_timeout_tests.rs");
    }
}

#[cfg(all(test, unix))]
#[path = "js_test_batch_contract_tests.rs"]
mod contract_tests;
