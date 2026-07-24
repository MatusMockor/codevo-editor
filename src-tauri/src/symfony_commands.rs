use crate::{
    debug_support::DebugProcessHandle,
    trust::WorkspaceTrustService,
    workspace_registry::{opened_root_path, WorkspaceId, WorkspaceRegistry},
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    fs::File,
    io::{self, Read},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const COMPOSER_BYTES_LIMIT: usize = 256 * 1024;
const OUTPUT_BYTES_LIMIT: usize = 2 * 1024 * 1024;
const ERROR_BYTES_LIMIT: usize = 32 * 1024;
const RESPONSE_MESSAGE_UNITS_LIMIT: usize = 4_096;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_COMMANDS: usize = 4_000;
const MAX_ROUTES: usize = 10_000;
const MAX_SERVICES: usize = 20_000;
const NAME_UNITS_LIMIT: usize = 512;
const DESCRIPTION_UNITS_LIMIT: usize = 8_192;
const VALUE_UNITS_LIMIT: usize = 4_096;
const COMMAND_ALIASES_LIMIT: usize = 64;
const ROUTE_METHODS_LIMIT: usize = 32;
const ROUTE_METHOD_UNITS_LIMIT: usize = 64;
const MAX_CONCURRENT_PROCESSES_PER_WORKSPACE: usize = 3;
const MAX_CONCURRENT_PROCESSES_GLOBAL: usize = 12;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymfonyConsoleCommand {
    name: String,
    description: String,
    aliases: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymfonyRoute {
    name: String,
    path: String,
    methods: Vec<String>,
    controller: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SymfonyService {
    id: String,
    class_name: Option<String>,
    alias: Option<String>,
    public: Option<bool>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum SymfonyConsoleCommandsResponse {
    Ok {
        commands: Vec<SymfonyConsoleCommand>,
        total: usize,
        truncated: bool,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum SymfonyRoutesResponse {
    Ok {
        routes: Vec<SymfonyRoute>,
        total: usize,
        truncated: bool,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum SymfonyServicesResponse {
    Ok {
        services: Vec<SymfonyService>,
        total: usize,
        truncated: bool,
    },
    Unavailable {
        message: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug)]
struct AuthorizedSymfonyWorkspace {
    root: File,
    root_identity: std::path::PathBuf,
    workspace_id: WorkspaceId,
}

#[derive(Debug)]
struct SymfonyProcessPermit {
    workspace_id: WorkspaceId,
}

#[derive(Default)]
struct SymfonyProcessCounts {
    by_workspace: HashMap<WorkspaceId, usize>,
    total: usize,
}

static SYMFONY_PROCESS_COUNTS: OnceLock<Mutex<SymfonyProcessCounts>> = OnceLock::new();

impl SymfonyProcessPermit {
    fn acquire(workspace_id: &WorkspaceId) -> Result<Self, ConsoleFailure> {
        let mut counts = SYMFONY_PROCESS_COUNTS
            .get_or_init(|| Mutex::new(SymfonyProcessCounts::default()))
            .lock()
            .map_err(|error| ConsoleFailure::Error(error.to_string()))?;
        let workspace_count = counts.by_workspace.get(workspace_id).copied().unwrap_or(0);
        if workspace_count >= MAX_CONCURRENT_PROCESSES_PER_WORKSPACE
            || counts.total >= MAX_CONCURRENT_PROCESSES_GLOBAL
        {
            return Err(ConsoleFailure::Error(
                "Symfony workspace inspection concurrency limit reached.".to_string(),
            ));
        }
        counts
            .by_workspace
            .insert(workspace_id.clone(), workspace_count + 1);
        counts.total += 1;
        Ok(Self {
            workspace_id: workspace_id.clone(),
        })
    }
}

impl Drop for SymfonyProcessPermit {
    fn drop(&mut self) {
        let Ok(mut counts) = SYMFONY_PROCESS_COUNTS
            .get_or_init(|| Mutex::new(SymfonyProcessCounts::default()))
            .lock()
        else {
            return;
        };
        if let Some(count) = counts.by_workspace.get_mut(&self.workspace_id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.by_workspace.remove(&self.workspace_id);
            }
        }
        counts.total = counts.total.saturating_sub(1);
    }
}

#[derive(Debug)]
enum PreparedSymfonyWorkspace {
    Ready(AuthorizedSymfonyWorkspace),
    Unavailable(String),
}

#[derive(Debug, Eq, PartialEq)]
enum SymfonyDetectionFailure {
    Unavailable(String),
    Error(String),
}

#[derive(Debug, Eq, PartialEq)]
enum ConsoleFailure {
    Unavailable(String),
    Error(String),
}

#[derive(Debug)]
struct CommandOutput {
    stdout: Vec<u8>,
}

#[tauri::command]
pub(crate) async fn list_symfony_console_commands(
    app: AppHandle,
    workspace_id: WorkspaceId,
) -> Result<SymfonyConsoleCommandsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let authorized = match prepare_workspace(&app, &workspace_id)? {
            PreparedSymfonyWorkspace::Ready(authorized) => authorized,
            PreparedSymfonyWorkspace::Unavailable(message) => {
                return Ok(SymfonyConsoleCommandsResponse::Unavailable { message });
            }
        };
        Ok(
            match run_console(
                authorized,
                &["list", "--format=json", "--short", "--no-interaction"],
                COMMAND_TIMEOUT,
            ) {
                Ok(output) => parse_commands(&output.stdout)
                    .unwrap_or_else(|message| SymfonyConsoleCommandsResponse::Error { message }),
                Err(ConsoleFailure::Unavailable(message)) => {
                    SymfonyConsoleCommandsResponse::Unavailable { message }
                }
                Err(ConsoleFailure::Error(message)) => {
                    SymfonyConsoleCommandsResponse::Error { message }
                }
            },
        )
    })
    .await
    .map_err(|error| format!("Symfony command worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_symfony_routes(
    app: AppHandle,
    workspace_id: WorkspaceId,
) -> Result<SymfonyRoutesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let authorized = match prepare_workspace(&app, &workspace_id)? {
            PreparedSymfonyWorkspace::Ready(authorized) => authorized,
            PreparedSymfonyWorkspace::Unavailable(message) => {
                return Ok(SymfonyRoutesResponse::Unavailable { message });
            }
        };
        Ok(
            match run_console(
                authorized,
                &["debug:router", "--format=json", "--no-interaction"],
                COMMAND_TIMEOUT,
            ) {
                Ok(output) => parse_routes(&output.stdout)
                    .unwrap_or_else(|message| SymfonyRoutesResponse::Error { message }),
                Err(ConsoleFailure::Unavailable(message)) => {
                    SymfonyRoutesResponse::Unavailable { message }
                }
                Err(ConsoleFailure::Error(message)) => SymfonyRoutesResponse::Error { message },
            },
        )
    })
    .await
    .map_err(|error| format!("Symfony route worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_symfony_services(
    app: AppHandle,
    workspace_id: WorkspaceId,
) -> Result<SymfonyServicesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let authorized = match prepare_workspace(&app, &workspace_id)? {
            PreparedSymfonyWorkspace::Ready(authorized) => authorized,
            PreparedSymfonyWorkspace::Unavailable(message) => {
                return Ok(SymfonyServicesResponse::Unavailable { message });
            }
        };
        Ok(
            match run_console(
                authorized,
                &["debug:container", "--format=json", "--no-interaction"],
                COMMAND_TIMEOUT,
            ) {
                Ok(output) => parse_services(&output.stdout)
                    .unwrap_or_else(|message| SymfonyServicesResponse::Error { message }),
                Err(ConsoleFailure::Unavailable(message)) => {
                    SymfonyServicesResponse::Unavailable { message }
                }
                Err(ConsoleFailure::Error(message)) => SymfonyServicesResponse::Error { message },
            },
        )
    })
    .await
    .map_err(|error| format!("Symfony service worker failed: {error}"))?
}

fn prepare_workspace(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
) -> Result<PreparedSymfonyWorkspace, String> {
    let registry = app.state::<WorkspaceRegistry>();
    let trust = app.state::<Mutex<WorkspaceTrustService>>();
    let authorized = match authorize_workspace_services(&registry, &trust, workspace_id) {
        Ok(authorized) => authorized,
        Err(SymfonyDetectionFailure::Unavailable(message)) => {
            return Ok(PreparedSymfonyWorkspace::Unavailable(message));
        }
        Err(SymfonyDetectionFailure::Error(message)) => return Err(message),
    };
    match detect_symfony(&registry, workspace_id) {
        Ok(()) => Ok(PreparedSymfonyWorkspace::Ready(authorized)),
        Err(SymfonyDetectionFailure::Unavailable(message)) => {
            Ok(PreparedSymfonyWorkspace::Unavailable(message))
        }
        Err(SymfonyDetectionFailure::Error(message)) => Err(message),
    }
}

fn authorize_workspace_services(
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    workspace_id: &WorkspaceId,
) -> Result<AuthorizedSymfonyWorkspace, SymfonyDetectionFailure> {
    let _operation = registry
        .lock_operations()
        .map_err(|error| SymfonyDetectionFailure::Error(error.to_string()))?;
    let descriptor = registry.descriptor(workspace_id).map_err(|_| {
        SymfonyDetectionFailure::Unavailable("Symfony workspace is not registered.".to_string())
    })?;
    let root = registry.clone_root(workspace_id).map_err(|_| {
        SymfonyDetectionFailure::Unavailable("Symfony workspace is not registered.".to_string())
    })?;
    let root_identity = opened_root_path(&root).map_err(|error| {
        SymfonyDetectionFailure::Error(format!(
            "Failed to capture Symfony workspace identity: {error}"
        ))
    })?;
    if root_identity != descriptor.canonical_root_path {
        return Err(SymfonyDetectionFailure::Error(
            "Registered Symfony workspace identity changed.".to_string(),
        ));
    }
    let trust_root = descriptor.selected_root_path.to_str().ok_or_else(|| {
        SymfonyDetectionFailure::Error("Symfony workspace path is not valid UTF-8.".to_string())
    })?;
    if !trust
        .lock()
        .map_err(|error| SymfonyDetectionFailure::Error(error.to_string()))?
        .get(trust_root)
        .trusted
    {
        return Err(SymfonyDetectionFailure::Unavailable(
            "Trust this workspace before running Symfony Console.".to_string(),
        ));
    }
    Ok(AuthorizedSymfonyWorkspace {
        root,
        root_identity,
        workspace_id: workspace_id.clone(),
    })
}

fn detect_symfony(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
) -> Result<(), SymfonyDetectionFailure> {
    match registry.open_descendant(workspace_id, "bin/console".as_ref()) {
        Ok(file) if file.metadata().is_ok_and(|metadata| metadata.is_file()) => {}
        Ok(_) => {
            return Err(SymfonyDetectionFailure::Unavailable(
                "Symfony Console is not available in this workspace.".to_string(),
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(SymfonyDetectionFailure::Unavailable(
                "Symfony Console is not available in this workspace.".to_string(),
            ));
        }
        Err(error) => {
            return Err(SymfonyDetectionFailure::Error(format!(
                "Failed to inspect Symfony Console safely: {error}"
            )));
        }
    }
    let composer = registry
        .open_descendant(workspace_id, "composer.json".as_ref())
        .map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                SymfonyDetectionFailure::Unavailable(
                    "Symfony composer.json is not available in this workspace.".to_string(),
                )
            } else {
                SymfonyDetectionFailure::Error(format!(
                    "Failed to inspect Symfony composer.json safely: {error}"
                ))
            }
        })?;
    let source = read_bounded_utf8(composer, COMPOSER_BYTES_LIMIT)
        .map_err(SymfonyDetectionFailure::Error)?;
    let manifest: Value = serde_json::from_str(&source).map_err(|error| {
        SymfonyDetectionFailure::Error(format!("Symfony composer.json is not valid JSON: {error}"))
    })?;
    let is_symfony = ["require", "require-dev"].iter().any(|section| {
        manifest
            .get(section)
            .and_then(Value::as_object)
            .is_some_and(|packages| {
                packages.contains_key("symfony/framework-bundle")
                    || packages.contains_key("symfony/symfony")
            })
    });
    if !is_symfony {
        return Err(SymfonyDetectionFailure::Unavailable(
            "Symfony Framework is not detected in this workspace.".to_string(),
        ));
    }
    Ok(())
}

fn run_console(
    authorized: AuthorizedSymfonyWorkspace,
    arguments: &[&str],
    timeout: Duration,
) -> Result<CommandOutput, ConsoleFailure> {
    run_console_with_binary(authorized, std::path::Path::new("php"), arguments, timeout)
}

fn run_console_with_binary(
    authorized: AuthorizedSymfonyWorkspace,
    binary: &std::path::Path,
    arguments: &[&str],
    timeout: Duration,
) -> Result<CommandOutput, ConsoleFailure> {
    let _permit = SymfonyProcessPermit::acquire(&authorized.workspace_id)?;
    if !opened_root_path(&authorized.root).is_ok_and(|current| current == authorized.root_identity)
    {
        return Err(ConsoleFailure::Error(
            "Registered Symfony workspace identity is no longer available.".to_string(),
        ));
    }
    let mut command = Command::new(binary);
    command
        .arg("bin/console")
        .args(arguments)
        .env("LC_ALL", "C")
        .env("SHELL_VERBOSITY", "-1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        let root_fd = authorized.root.as_raw_fd();
        command.pre_exec(move || {
            if libc::fchdir(root_fd) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setpgid(0, 0) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    #[cfg(not(unix))]
    command.current_dir(opened_root_path(&authorized.root).unwrap_or_default());

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            ConsoleFailure::Unavailable("PHP is not available.".to_string())
        } else {
            ConsoleFailure::Error(format!("Failed to start Symfony Console: {error}"))
        }
    })?;
    let overflowed = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take().map(|pipe| {
        let overflowed = Arc::clone(&overflowed);
        thread::spawn(move || bounded_output(pipe, OUTPUT_BYTES_LIMIT, overflowed))
    });
    let stderr = child.stderr.take().map(|pipe| {
        let overflowed = Arc::clone(&overflowed);
        thread::spawn(move || bounded_output(pipe, ERROR_BYTES_LIMIT, overflowed))
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if overflowed.load(Ordering::Acquire) {
            DebugProcessHandle::from_process_id(child.id()).terminate();
            let _ = child.wait();
            break Err("Symfony Console output exceeded the safety limit.".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                DebugProcessHandle::from_process_id(child.id()).terminate();
                let _ = child.wait();
                break Err(format!(
                    "Symfony Console timed out after {} seconds.",
                    timeout.as_secs_f64()
                ));
            }
            Err(error) => {
                DebugProcessHandle::from_process_id(child.id()).terminate();
                let _ = child.wait();
                break Err(format!("Failed to inspect Symfony Console: {error}"));
            }
        }
    };
    let stdout = join_output(stdout);
    let stderr = join_output(stderr);
    if overflowed.load(Ordering::Acquire) {
        return Err(ConsoleFailure::Error(
            "Symfony Console output exceeded the safety limit.".to_string(),
        ));
    }
    match status {
        Ok(status) if status.success() => Ok(CommandOutput { stdout }),
        Ok(status) => {
            let message = output_message(
                &stderr,
                &stdout,
                &format!("Symfony Console exited with status {status}."),
            );
            let requested_debug_command = arguments
                .first()
                .is_some_and(|argument| argument.starts_with("debug:"));
            let unsupported_machine_output = message.contains("--format")
                && (message.contains("does not exist") || message.contains("not supported"));
            if (requested_debug_command
                && (message.contains(" is not defined")
                    || message.contains("There are no commands defined")))
                || unsupported_machine_output
            {
                Err(ConsoleFailure::Unavailable(message))
            } else {
                Err(ConsoleFailure::Error(message))
            }
        }
        Err(message) => Err(ConsoleFailure::Error(output_message(
            &stderr, &stdout, &message,
        ))),
    }
}

trait ConsoleOutput: Read + Send + 'static {}
impl ConsoleOutput for ChildStdout {}
impl ConsoleOutput for ChildStderr {}

fn bounded_output(
    mut pipe: impl ConsoleOutput,
    limit: usize,
    overflowed: Arc<AtomicBool>,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    while let Ok(read) = pipe.read(&mut chunk) {
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > limit {
            overflowed.store(true, Ordering::Release);
        } else {
            bytes.extend_from_slice(&chunk[..read]);
        }
    }
    bytes
}

fn join_output(handle: Option<thread::JoinHandle<Vec<u8>>>) -> Vec<u8> {
    handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

fn output_message(primary: &[u8], secondary: &[u8], fallback: &str) -> String {
    let bytes = if primary.is_empty() {
        secondary
    } else {
        primary
    };
    if bytes.is_empty() {
        return fallback.to_string();
    }
    let message = String::from_utf8_lossy(bytes);
    let message = message.trim();
    tail_utf16_bounded(message, RESPONSE_MESSAGE_UNITS_LIMIT)
}

fn parse_json_object(stdout: &[u8], label: &str) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_slice(stdout)
        .map_err(|_| format!("Symfony {label} returned invalid JSON."))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("Symfony {label} did not return a JSON object."))
}

fn parse_commands(stdout: &[u8]) -> Result<SymfonyConsoleCommandsResponse, String> {
    let root = parse_json_object(stdout, "command list")?;
    let values = root
        .get("commands")
        .and_then(Value::as_array)
        .ok_or_else(|| "Symfony command list is missing commands.".to_string())?;
    let mut commands = Vec::with_capacity(values.len());
    for value in values {
        let object = value
            .as_object()
            .ok_or_else(|| "Symfony command entry is invalid.".to_string())?;
        let name = required_string(object, "name", "Symfony command")?;
        validate_utf16_units(&name, NAME_UNITS_LIMIT, "Symfony command name")?;
        let description = optional_string(object, "description")?.unwrap_or_default();
        validate_utf16_units(
            &description,
            DESCRIPTION_UNITS_LIMIT,
            "Symfony command description",
        )?;
        let mut aliases = optional_string_array(object, "usage")?.unwrap_or_default();
        if aliases.len() > COMMAND_ALIASES_LIMIT {
            return Err("Symfony command has too many aliases.".to_string());
        }
        for alias in &aliases {
            validate_utf16_units(alias, NAME_UNITS_LIMIT, "Symfony command alias")?;
        }
        aliases.sort();
        aliases.dedup();
        let command = SymfonyConsoleCommand {
            name,
            description,
            aliases,
        };
        commands.push(command);
    }
    commands.sort_by(|left, right| left.name.cmp(&right.name));
    for duplicate in commands.windows(2) {
        if duplicate[0].name == duplicate[1].name && duplicate[0] != duplicate[1] {
            return Err("Symfony command list contains conflicting duplicates.".to_string());
        }
    }
    commands.dedup();
    let total = commands.len();
    let truncated = total > MAX_COMMANDS;
    commands.truncate(MAX_COMMANDS);
    Ok(SymfonyConsoleCommandsResponse::Ok {
        commands,
        total,
        truncated,
    })
}

fn parse_routes(stdout: &[u8]) -> Result<SymfonyRoutesResponse, String> {
    let values = parse_json_object(stdout, "router debug")?;
    let mut routes = Vec::with_capacity(values.len());
    for (name, value) in values {
        validate_utf16_units(&name, NAME_UNITS_LIMIT, "Symfony route name")?;
        let object = value
            .as_object()
            .ok_or_else(|| "Symfony route entry is invalid.".to_string())?;
        let path = required_string(object, "path", "Symfony route")?;
        validate_utf16_units(&path, VALUE_UNITS_LIMIT, "Symfony route path")?;
        let mut methods: Vec<_> = required_string(object, "method", "Symfony route")?
            .split('|')
            .filter(|method| *method != "ANY" && !method.is_empty())
            .map(str::to_string)
            .collect();
        methods.sort();
        methods.dedup();
        if methods.len() > ROUTE_METHODS_LIMIT {
            return Err("Symfony route has too many methods.".to_string());
        }
        for method in &methods {
            validate_utf16_units(method, ROUTE_METHOD_UNITS_LIMIT, "Symfony route method")?;
        }
        let controller = object
            .get("defaults")
            .and_then(Value::as_object)
            .and_then(|defaults| defaults.get("_controller"))
            .and_then(Value::as_str)
            .filter(|controller| !controller.is_empty())
            .map(str::to_string);
        if let Some(controller) = &controller {
            validate_utf16_units(controller, VALUE_UNITS_LIMIT, "Symfony route controller")?;
        }
        let route = SymfonyRoute {
            name,
            path,
            methods,
            controller,
        };
        routes.push(route);
    }
    routes.sort_by(|left, right| left.name.cmp(&right.name));
    let total = routes.len();
    let truncated = total > MAX_ROUTES;
    routes.truncate(MAX_ROUTES);
    Ok(SymfonyRoutesResponse::Ok {
        routes,
        total,
        truncated,
    })
}

fn parse_services(stdout: &[u8]) -> Result<SymfonyServicesResponse, String> {
    let root = parse_json_object(stdout, "container debug")?;
    let definitions = required_object(&root, "definitions", "Symfony container")?;
    let aliases = required_object(&root, "aliases", "Symfony container")?;
    let concrete_services = required_object(&root, "services", "Symfony container")?;
    let estimated_total = definitions
        .len()
        .saturating_add(aliases.len())
        .saturating_add(concrete_services.len());
    let mut services = Vec::with_capacity(estimated_total);
    for (id, value) in definitions {
        validate_utf16_units(id, VALUE_UNITS_LIMIT, "Symfony service id")?;
        let object = value
            .as_object()
            .ok_or_else(|| "Symfony service entry is invalid.".to_string())?;
        let class_name =
            optional_string(object, "class")?.filter(|class_name| !class_name.is_empty());
        if let Some(class_name) = &class_name {
            validate_utf16_units(class_name, VALUE_UNITS_LIMIT, "Symfony service class")?;
        }
        let service = SymfonyService {
            id: id.clone(),
            class_name,
            alias: None,
            public: optional_bool(object, "public")?,
        };
        services.push(service);
    }
    for (id, value) in aliases {
        validate_utf16_units(id, VALUE_UNITS_LIMIT, "Symfony service id")?;
        let object = value
            .as_object()
            .ok_or_else(|| "Symfony service alias entry is invalid.".to_string())?;
        let alias = required_string(object, "service", "Symfony service alias")?;
        validate_utf16_units(&alias, VALUE_UNITS_LIMIT, "Symfony service alias")?;
        let service = SymfonyService {
            id: id.clone(),
            class_name: None,
            alias: Some(alias),
            public: optional_bool(object, "public")?,
        };
        services.push(service);
    }
    for (id, value) in concrete_services {
        validate_utf16_units(id, VALUE_UNITS_LIMIT, "Symfony service id")?;
        let class_name = value
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "Symfony concrete service entry is invalid.".to_string())?;
        let class_name = (!class_name.is_empty()).then_some(class_name);
        if let Some(class_name) = &class_name {
            validate_utf16_units(
                class_name,
                VALUE_UNITS_LIMIT,
                "Symfony concrete service class",
            )?;
        }
        services.push(SymfonyService {
            id: id.clone(),
            class_name,
            alias: None,
            public: None,
        });
    }
    services.sort_by(|left, right| left.id.cmp(&right.id));
    if services
        .windows(2)
        .any(|duplicate| duplicate[0].id == duplicate[1].id)
    {
        return Err("Symfony container contains duplicate service identities.".to_string());
    }
    let total = services.len();
    let truncated = total > MAX_SERVICES;
    services.truncate(MAX_SERVICES);
    Ok(SymfonyServicesResponse::Ok {
        services,
        total,
        truncated,
    })
}

fn required_string(object: &Map<String, Value>, key: &str, label: &str) -> Result<String, String> {
    optional_string(object, key)?.ok_or_else(|| format!("{label} is missing {key}."))
}

fn required_object<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a Map<String, Value>, String> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{label} is missing or has invalid {key}."))
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("Symfony field {key} is invalid."))
        })
        .transpose()
}

fn optional_bool(object: &Map<String, Value>, key: &str) -> Result<Option<bool>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| format!("Symfony field {key} is invalid."))
        })
        .transpose()
}

fn optional_string_array(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<Vec<String>>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_array()
                .ok_or_else(|| format!("Symfony field {key} is invalid."))?
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| format!("Symfony field {key} is invalid."))
                })
                .collect()
        })
        .transpose()
}

fn validate_utf16_units(value: &str, limit: usize, label: &str) -> Result<(), String> {
    if value.encode_utf16().take(limit + 1).count() > limit {
        return Err(format!("{label} exceeds the safety limit."));
    }
    Ok(())
}

fn tail_utf16_bounded(value: &str, limit: usize) -> String {
    if value.encode_utf16().count() <= limit {
        return value.to_string();
    }
    let mut retained_units = 0;
    let mut retained = Vec::new();
    for character in value.chars().rev() {
        let units = character.len_utf16();
        if retained_units + units > limit {
            break;
        }
        retained_units += units;
        retained.push(character);
    }
    retained.into_iter().rev().collect()
}

fn read_bounded_utf8(mut file: File, limit: usize) -> Result<String, String> {
    let mut bytes = Vec::new();
    file.by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read composer.json: {error}"))?;
    if bytes.len() > limit {
        return Err("composer.json exceeds the 256 KiB limit.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "composer.json is not valid UTF-8.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn workspace(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-symfony-{label}-{nonce}"));
        fs::create_dir_all(root.join("bin")).expect("workspace");
        fs::write(root.join("bin/console"), "<?php").expect("console");
        fs::write(
            root.join("composer.json"),
            r#"{"require":{"symfony/framework-bundle":"^7.0"}}"#,
        )
        .expect("composer");
        root
    }

    fn trust(root: &Path) -> Mutex<WorkspaceTrustService> {
        Mutex::new(WorkspaceTrustService::load(root.join("trust.json")).expect("trust service"))
    }

    fn workspace_id(label: &str) -> WorkspaceId {
        serde_json::from_value(Value::String(label.to_string())).expect("workspace id")
    }

    #[test]
    fn unregistered_untrusted_and_non_symfony_workspaces_fail_closed() {
        let root = workspace("authorization");
        let registry = WorkspaceRegistry::new();
        let unknown: WorkspaceId = serde_json::from_str(r#""unknown""#).expect("id");
        assert!(matches!(
            authorize_workspace_services(&registry, &trust(&root), &unknown),
            Err(SymfonyDetectionFailure::Unavailable(message)) if message.contains("not registered")
        ));
        let descriptor = registry.register(&root).expect("register");
        assert!(matches!(
            authorize_workspace_services(&registry, &trust(&root), &descriptor.workspace_id),
            Err(SymfonyDetectionFailure::Unavailable(message)) if message.contains("Trust this workspace")
        ));

        let trusted = trust(&root);
        trusted
            .lock()
            .expect("trust lock")
            .set(root.to_str().expect("root"), true)
            .expect("trust");
        assert!(
            authorize_workspace_services(&registry, &trusted, &descriptor.workspace_id).is_ok()
        );
        fs::write(
            root.join("composer.json"),
            r#"{"require":{"symfony/console":"^7"}}"#,
        )
        .expect("composer");
        assert!(matches!(
            detect_symfony(&registry, &descriptor.workspace_id),
            Err(SymfonyDetectionFailure::Unavailable(message)) if message.contains("not detected")
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn console_and_composer_symlinks_are_rejected() {
        let root = workspace("symlink");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("console"), "<?php").expect("outside console");
        fs::remove_file(root.join("bin/console")).expect("remove console");
        symlink(outside.join("console"), root.join("bin/console")).expect("symlink");
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&root).expect("register");
        assert!(detect_symfony(&registry, &descriptor.workspace_id).is_err());
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn command_route_and_service_json_are_strict_and_deterministic() {
        assert_eq!(
            parse_commands(
                br#"{"commands":[{"name":"cache:clear","description":"Clear","usage":[]},{"name":"about","description":"Info","usage":["info"]}]}"#,
            ),
            Ok(SymfonyConsoleCommandsResponse::Ok {
                commands: vec![
                    SymfonyConsoleCommand { name: "about".into(), description: "Info".into(), aliases: vec!["info".into()] },
                    SymfonyConsoleCommand { name: "cache:clear".into(), description: "Clear".into(), aliases: vec![] },
                ],
                total: 2,
                truncated: false,
            })
        );
        assert_eq!(
            parse_routes(br#"{"home":{"path":"/","method":"GET","defaults":{"_controller":"App\\Controller\\HomeController"}}}"#),
            Ok(SymfonyRoutesResponse::Ok {
                routes: vec![SymfonyRoute { name: "home".into(), path: "/".into(), methods: vec!["GET".into()], controller: Some("App\\Controller\\HomeController".into()) }],
                total: 1,
                truncated: false,
            })
        );
        assert_eq!(
            parse_services(br#"{"definitions":{"logger":{"class":"Monolog\\Logger","public":false}},"aliases":{"mailer":{"service":"mailer.transport","public":true}},"services":{"request_stack":"Symfony\\Component\\HttpFoundation\\RequestStack"}}"#),
            Ok(SymfonyServicesResponse::Ok {
                services: vec![
                    SymfonyService { id: "logger".into(), class_name: Some("Monolog\\Logger".into()), alias: None, public: Some(false) },
                    SymfonyService { id: "mailer".into(), class_name: None, alias: Some("mailer.transport".into()), public: Some(true) },
                    SymfonyService { id: "request_stack".into(), class_name: Some("Symfony\\Component\\HttpFoundation\\RequestStack".into()), alias: None, public: None },
                ],
                total: 3,
                truncated: false,
            })
        );
    }

    #[test]
    fn legitimate_mixed_route_controllers_and_empty_service_classes_are_nullable() {
        assert_eq!(
            parse_routes(
                br#"{"dynamic":{"path":"/dynamic","method":"ANY","defaults":{"_controller":["service","method"]}}}"#,
            ),
            Ok(SymfonyRoutesResponse::Ok {
                routes: vec![SymfonyRoute {
                    name: "dynamic".into(),
                    path: "/dynamic".into(),
                    methods: vec![],
                    controller: None,
                }],
                total: 1,
                truncated: false,
            })
        );
        assert_eq!(
            parse_services(
                br#"{"definitions":{"abstract.service":{"class":"","public":false}},"aliases":{},"services":{"runtime.service":""}}"#,
            ),
            Ok(SymfonyServicesResponse::Ok {
                services: vec![
                    SymfonyService {
                        id: "abstract.service".into(),
                        class_name: None,
                        alias: None,
                        public: Some(false),
                    },
                    SymfonyService {
                        id: "runtime.service".into(),
                        class_name: None,
                        alias: None,
                        public: None,
                    },
                ],
                total: 2,
                truncated: false,
            })
        );
    }

    #[test]
    fn malformed_and_inconsistent_json_is_rejected() {
        assert!(parse_commands(br#"{"commands":{"about":{"name":"other"}}}"#).is_err());
        assert!(parse_routes(br#"{"home":{"path":7}}"#).is_err());
        assert!(parse_services(br#"[]"#).is_err());
        assert!(parse_commands(b"warning before json").is_err());
    }

    #[test]
    fn response_counts_and_utf16_fields_are_bounded() {
        let commands: Vec<_> = (0..=MAX_COMMANDS)
            .map(|index| {
                serde_json::json!({
                    "name": format!("command:{index:05}"),
                    "description": "",
                    "usage": []
                })
            })
            .collect();
        let source = serde_json::to_vec(&serde_json::json!({ "commands": commands }))
            .expect("command fixture");
        let SymfonyConsoleCommandsResponse::Ok {
            commands,
            total,
            truncated,
        } = parse_commands(&source).expect("bounded commands")
        else {
            panic!("expected ok response");
        };
        assert_eq!(commands.len(), MAX_COMMANDS);
        assert_eq!(total, MAX_COMMANDS + 1);
        assert!(truncated);

        let oversized_name = "😀".repeat(NAME_UNITS_LIMIT / 2 + 1);
        let source = serde_json::to_vec(&serde_json::json!({
            "commands": [{"name": oversized_name, "description": "", "usage": []}]
        }))
        .expect("utf16 fixture");
        assert!(parse_commands(&source)
            .expect_err("UTF-16 overflow")
            .contains("safety limit"));

        let error = "😀".repeat(RESPONSE_MESSAGE_UNITS_LIMIT);
        let bounded = output_message(error.as_bytes(), b"", "fallback");
        assert!(bounded.encode_utf16().count() <= RESPONSE_MESSAGE_UNITS_LIMIT);
        assert!(bounded.ends_with('😀'));
    }

    #[test]
    fn authorized_process_rejects_a_moved_root_before_spawn() {
        let root = workspace("identity");
        let moved = root.with_extension("moved");
        let authorized = AuthorizedSymfonyWorkspace {
            root: File::open(&root).expect("open root"),
            root_identity: fs::canonicalize(&root).expect("identity"),
            workspace_id: workspace_id("identity"),
        };
        fs::rename(&root, &moved).expect("move root");
        fs::create_dir_all(&root).expect("replacement root");
        let result = run_console_with_binary(
            authorized,
            Path::new("/definitely/not/executed"),
            &["list"],
            Duration::from_millis(20),
        );
        assert!(matches!(
            result,
            Err(ConsoleFailure::Error(message)) if message.contains("identity")
        ));
        fs::remove_dir_all(root).expect("cleanup replacement");
        fs::remove_dir_all(moved).expect("cleanup moved");
    }

    #[test]
    fn response_wire_contracts_are_exactly_tagged() {
        assert_eq!(
            serde_json::to_value(SymfonyRoutesResponse::Unavailable {
                message: "no router".into()
            })
            .expect("json"),
            serde_json::json!({"status":"unavailable","message":"no router"})
        );
        assert_eq!(
            serde_json::to_value(SymfonyServicesResponse::Error {
                message: "bad".into()
            })
            .expect("json"),
            serde_json::json!({"status":"error","message":"bad"})
        );
    }

    #[test]
    fn process_permits_bound_parallel_workspace_inspection_and_release_on_drop() {
        let workspace_id = workspace_id("permit-bound");
        let permits: Vec<_> = (0..MAX_CONCURRENT_PROCESSES_PER_WORKSPACE)
            .map(|_| SymfonyProcessPermit::acquire(&workspace_id).expect("permit"))
            .collect();
        assert!(matches!(
            SymfonyProcessPermit::acquire(&workspace_id),
            Err(ConsoleFailure::Error(message)) if message.contains("concurrency limit")
        ));
        drop(permits);
        assert!(SymfonyProcessPermit::acquire(&workspace_id).is_ok());
    }

    #[test]
    fn process_timeout_output_limit_and_exit_errors_are_bounded() {
        let root = workspace("process");
        let php_dir = root.join("fake-bin");
        fs::create_dir_all(&php_dir).expect("bin");
        let fake_php = php_dir.join("php");
        fs::write(&fake_php, "#!/bin/sh\ncase \"$1\" in\n  *console) shift;;\nesac\ncase \"$1\" in\n  slow) sleep 2;;\n  noisy) yes x | head -c 2200000;;\n  fail) echo denied >&2; exit 9;;\n  *) printf '{\"commands\":{}}';;\nesac\n").expect("script");
        let mut permissions = fs::metadata(&fake_php).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&fake_php, permissions).expect("permissions");
        let authorized = || AuthorizedSymfonyWorkspace {
            root: File::open(&root).expect("root"),
            root_identity: fs::canonicalize(&root).expect("identity"),
            workspace_id: workspace_id("process"),
        };
        assert!(matches!(
            run_console_with_binary(authorized(), &fake_php, &["slow"], Duration::from_millis(40)),
            Err(ConsoleFailure::Error(message)) if message.contains("timed out")
        ));
        assert!(matches!(
            run_console_with_binary(authorized(), &fake_php, &["noisy"], Duration::from_secs(10)),
            Err(ConsoleFailure::Error(message)) if message.contains("safety limit")
        ));
        assert!(matches!(
            run_console_with_binary(authorized(), &fake_php, &["fail"], Duration::from_secs(2)),
            Err(ConsoleFailure::Error(message)) if message == "denied"
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
