use self::watch_generation::{EndpointFingerprintError, InspectorEndpointFingerprint};
use crate::debug_adapter::{DebugEventEmitter, DebugOutputStream};
use crate::debug_commands::DebugSessionFactoryStartup;
use crate::debug_inspector_discovery::{
    discover_inspector_ws_url, ensure_no_additional_inspector_endpoint, inspector_endpoint_feed,
    spawn_output_pump, InspectorDiscoveryError, InspectorEndpointFeed, InspectorEndpointScanBudget,
    INSPECTOR_AMBIGUITY_WINDOW,
};
use crate::debug_node_launch::{NodeLaunchPlan, NodeLaunchProgram, INSPECT_FLAG};
use crate::debug_support::DebugProcessHandle;
use crate::managed_javascript_typescript::node_executable_path;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct SpawnedNodeInspector {
    child: Option<Child>,
    endpoints: Option<InspectorEndpointFeed>,
    pub(crate) process: DebugProcessHandle,
    pub(crate) ws_url: String,
}

pub(crate) fn spawn_node_inspector(
    launch: &NodeLaunchPlan,
    emitter: DebugEventEmitter,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<SpawnedNodeInspector, String> {
    spawn_node_inspector_with_workspace_directory(launch, None, emitter, startup_is_current)
}

/// Starts a trusted-workspace live-filesystem watch session from a retained cwd.
///
/// Node intentionally reopens the entrypoint and imported modules after file
/// changes; that is the watch input, not an immutable module-graph claim.
/// Workspace trust authorizes that code with the user's normal Node
/// permissions, while the retained root and registry generation protect IDE
/// ownership and revocation.
fn spawn_node_inspector_descriptor_bound(
    launch: &NodeLaunchPlan,
    workspace_directory: File,
    emitter: DebugEventEmitter,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<SpawnedNodeInspector, String> {
    spawn_node_inspector_with_workspace_directory(
        launch,
        Some(workspace_directory),
        emitter,
        startup_is_current,
    )
}

fn spawn_node_inspector_with_workspace_directory(
    launch: &NodeLaunchPlan,
    workspace_directory: Option<File>,
    emitter: DebugEventEmitter,
    startup_is_current: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<SpawnedNodeInspector, String> {
    #[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
    let (program, retained_executable): (PathBuf, Option<Arc<File>>) = match &launch.program {
        NodeLaunchProgram::Node => (
            PathBuf::from(node_executable_path().ok_or_else(|| {
                "Node.js runtime was not found. Install Node.js or set CODEVO_EDITOR_NODE_PATH."
                    .to_string()
            })?),
            None,
        ),
        NodeLaunchProgram::ExactNode { executable, .. } => {
            #[cfg(target_os = "linux")]
            {
                use std::os::fd::AsRawFd;
                let descriptor = executable.as_raw_fd();
                let path = PathBuf::from(format!("/proc/self/fd/{descriptor}"));
                (path, Some(Arc::clone(executable)))
            }
            #[cfg(not(target_os = "linux"))]
            {
                return Err(
                    "Native Node watch is unavailable because this platform cannot atomically execute the retained Node.js executable."
                        .to_string(),
                );
            }
        }
        NodeLaunchProgram::TrustedLiveNode { canonical_path, .. } => (canonical_path.clone(), None),
        NodeLaunchProgram::WorkspaceTool(path) => (path.clone(), None),
    };
    let mut command = Command::new(program);
    let arguments = match workspace_directory.as_ref() {
        Some(_) => descriptor_bound_watch_arguments(launch)?,
        None => launch.arguments.clone(),
    };
    command
        .args(arguments)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if workspace_directory.is_none() {
        command.current_dir(&launch.working_directory);
    }
    if launch.isolated_environment {
        command.env_clear();
        for key in ["HOME", "PATH", "TMPDIR", "SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command.env("LC_ALL", "C").envs(&launch.environment);
    }
    if launch.inspect_via_environment {
        command.env("NODE_OPTIONS", INSPECT_FLAG);
    }
    #[cfg(target_os = "linux")]
    if let Some(executable) = retained_executable {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        let descriptor = executable.as_raw_fd();
        unsafe {
            command.pre_exec(move || {
                let flags = libc::fcntl(descriptor, libc::F_GETFD);
                if flags < 0
                    || libc::fcntl(descriptor, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                let _ = &executable;
                Ok(())
            });
        }
    }
    #[cfg(unix)]
    if let Some(workspace_directory) = workspace_directory {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(workspace_directory.as_raw_fd()) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    if workspace_directory.is_some() {
        return Err(
            "Descriptor-bound native Node watch launch is unsupported on this platform."
                .to_string(),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    if let NodeLaunchProgram::TrustedLiveNode {
        canonical_path,
        fingerprint,
    } = &launch.program
    {
        // macOS has no descriptor-exec equivalent usable for the Homebrew Node
        // runtime. This trusted live-filesystem boundary deliberately performs
        // a strong JIT identity/content revalidation. It is fail-closed for
        // normal path drift and A-B-A replacement, but is not descriptor-atomic
        // against a malicious same-user rename in the final spawn interval.
        watch_runtime::verify_node_executable_fingerprint(canonical_path, fingerprint)?;
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to launch the Node.js debug process: {error}"))?;
    let process = DebugProcessHandle::from_process_id(child.id());
    let Some(stdout) = child.stdout.take() else {
        process.terminate();
        let _ = child.wait();
        return Err("The Node.js debug process has no stdout pipe.".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        process.terminate();
        let _ = child.wait();
        return Err("The Node.js debug process has no stderr pipe.".to_string());
    };
    let (url_tx, endpoint_feed) = inspector_endpoint_feed();
    let discovery_output_budget = Arc::new(InspectorEndpointScanBudget::new());
    let stdout_pump = match spawn_output_pump(
        stdout,
        DebugOutputStream::Stdout,
        emitter.clone(),
        Some((url_tx.clone(), Arc::clone(&discovery_output_budget))),
        Arc::clone(&startup_is_current),
    ) {
        Ok(pump) => pump,
        Err(error) => {
            process.terminate();
            let _ = child.wait();
            return Err(format!(
                "Unable to start the Node.js debugger stdout owner: {error}"
            ));
        }
    };
    let stderr_pump = match spawn_output_pump(
        stderr,
        DebugOutputStream::Stderr,
        emitter,
        Some((url_tx, Arc::clone(&discovery_output_budget))),
        Arc::clone(&startup_is_current),
    ) {
        Ok(pump) => pump,
        Err(error) => {
            process.terminate();
            let _ = child.wait();
            let _ = stdout_pump.join();
            return Err(format!(
                "Unable to start the Node.js debugger stderr owner: {error}"
            ));
        }
    };
    let ws_url = match discover_inspector_ws_url(
        &endpoint_feed,
        DISCOVERY_TIMEOUT,
        startup_is_current.as_ref(),
    ) {
        Ok(url) => url,
        Err(error) => {
            process.terminate();
            let _ = child.wait();
            let _ = stdout_pump.join();
            let _ = stderr_pump.join();
            return Err(discovery_error_message(error));
        }
    };
    drop(stdout_pump);
    drop(stderr_pump);
    discovery_output_budget.complete_startup();
    Ok(SpawnedNodeInspector {
        child: Some(child),
        endpoints: Some(endpoint_feed),
        process,
        ws_url,
    })
}

fn descriptor_bound_watch_arguments(launch: &NodeLaunchPlan) -> Result<Vec<String>, String> {
    let Some(script) = launch.arguments.last() else {
        return Err("Descriptor-bound native Node watch launch plan is invalid.".to_string());
    };
    let relative_script = std::path::Path::new(script)
        .strip_prefix(&launch.working_directory)
        .map_err(|_| "Descriptor-bound native Node watch script escaped its workspace.")?;
    if relative_script.as_os_str().is_empty()
        || relative_script.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("Descriptor-bound native Node watch script escaped its workspace.".to_string());
    }
    let relative_script = relative_script
        .to_str()
        .ok_or_else(|| "Descriptor-bound native Node watch script path is invalid.".to_string())?;
    let mut arguments = launch.arguments.clone();
    *arguments.last_mut().ok_or_else(|| {
        "Descriptor-bound native Node watch launch plan is invalid.".to_string()
    })? = relative_script.to_string();
    Ok(arguments)
}

impl SpawnedNodeInspector {
    /// Seeds generation one for the future watch controller. Discovery consumes
    /// the initial URL, so the continuing feed intentionally contains only
    /// duplicate or replacement observations emitted after startup.
    pub(crate) fn initial_watch_endpoint(
        &self,
    ) -> Result<InspectorEndpointFingerprint, EndpointFingerprintError> {
        InspectorEndpointFingerprint::parse_ws_url(&self.ws_url)
    }

    pub(crate) fn ensure_unambiguous(
        &self,
        startup_is_current: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<(), String> {
        ensure_no_additional_inspector_endpoint(
            self.endpoints
                .as_ref()
                .expect("spawned Node inspector endpoint ownership"),
            &self.ws_url,
            INSPECTOR_AMBIGUITY_WINDOW,
            startup_is_current,
        )
        .map_err(discovery_error_message)
    }

    pub(crate) fn terminate_and_wait(&mut self) {
        self.kill_group_and_reap();
    }

    fn kill_group_and_reap(&mut self) {
        if let Some(endpoints) = self.endpoints.take() {
            endpoints.cancel();
        }
        let Some(mut child) = self.child.take() else {
            return;
        };
        #[cfg(unix)]
        if let Ok(process_group_id) = i32::try_from(child.id()) {
            unsafe {
                libc::kill(-process_group_id, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        loop {
            match child.wait() {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Ok(_) | Err(_) => break,
            }
        }
    }

    fn into_watch_supervisor_parts(mut self) -> (Child, InspectorEndpointFeed) {
        let child = self
            .child
            .take()
            .expect("spawned Node inspector process ownership");
        let endpoints = self
            .endpoints
            .take()
            .expect("spawned Node inspector endpoint ownership");
        (child, endpoints)
    }

    #[cfg(test)]
    fn process_id_for_test(&self) -> u32 {
        self.child
            .as_ref()
            .expect("spawned Node inspector process ownership")
            .id()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn spawn_waiter_with_endpoint_feed(
        mut self,
        finish: Box<dyn FnOnce(Option<i32>) + Send>,
    ) -> InspectorEndpointFeed {
        let mut child = self
            .child
            .take()
            .expect("spawned Node inspector process ownership");
        let endpoints = self
            .endpoints
            .take()
            .expect("spawned Node inspector endpoint ownership");
        let cancellation = endpoints.cancellation_handle();
        thread::spawn(move || {
            let exit_code = child.wait().ok().and_then(|status| status.code());
            cancellation.cancel();
            finish(exit_code);
        });
        endpoints
    }

    pub(crate) fn spawn_waiter(self, finish: Box<dyn FnOnce(Option<i32>) + Send>) {
        drop(self.spawn_waiter_with_endpoint_feed(finish));
    }
}

impl Drop for SpawnedNodeInspector {
    fn drop(&mut self) {
        self.kill_group_and_reap();
    }
}

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_supervisor.rs"]
mod watch_supervisor;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_generation.rs"]
pub(crate) mod watch_generation;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_controller.rs"]
mod watch_controller;

#[allow(dead_code)]
#[path = "debug_node_watch_cdp.rs"]
mod watch_cdp;

#[path = "debug_node_watch_cdp_activation.rs"]
mod watch_cdp_activation;

#[path = "debug_node_watch_replay.rs"]
mod watch_replay;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_session_factory.rs"]
mod watch_session_factory;

#[path = "debug_node_watch_workspace_start.rs"]
mod watch_workspace_start;
pub(crate) use watch_workspace_start::{
    start_native_node_watch_intent_for_retained_workspace, NativeNodeWatchIntentWorkspaceStartup,
};

#[path = "debug_node_watch_start_gate.rs"]
mod watch_start_gate;

#[allow(dead_code)]
#[path = "debug_node_watch_runtime.rs"]
mod watch_runtime;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_control_proxy.rs"]
mod watch_control_proxy;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_adapter.rs"]
mod watch_adapter;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_breakpoint_sync.rs"]
mod watch_breakpoint_sync;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_command_worker.rs"]
mod watch_command_worker;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_cdp_command_runtime.rs"]
mod watch_cdp_command_runtime;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_inspection_contract.rs"]
mod watch_inspection_contract;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_node_watch_event_gate.rs"]
pub(crate) mod watch_event_gate;

#[cfg_attr(not(test), allow(dead_code))]
#[path = "debug_desired_policy.rs"]
pub(crate) mod watch_desired_policy;

#[cfg(all(test, unix))]
#[path = "debug_node_watch_real_integration_tests.rs"]
mod watch_real_integration_tests;

fn discovery_error_message(error: InspectorDiscoveryError) -> String {
    match error {
        InspectorDiscoveryError::Timeout => {
            "Timed out waiting for the Node.js inspector to start.".to_string()
        }
        InspectorDiscoveryError::Disconnected => {
            "The Node.js debug process exited before the inspector became available.".to_string()
        }
        InspectorDiscoveryError::Ambiguous => "Multiple Node.js inspector endpoints were discovered; refusing an ambiguous debug attachment."
            .to_string(),
        InspectorDiscoveryError::Stale => {
            "The workspace debugger lifecycle changed during startup.".to_string()
        }
    }
}
