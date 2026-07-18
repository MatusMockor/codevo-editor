use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_DIAGNOSTICS: usize = 2_000;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;
const ESLINT_CACHE_DIR: &str = "eslint-cache";
const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;
const DOCUMENT_ANALYSIS_TIMEOUT: Duration = Duration::from_millis(1_500);
const WORKSPACE_ANALYSIS_TIMEOUT: Duration = Duration::from_secs(60);
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Default)]
pub struct EslintProcessRegistry {
    next_id: AtomicU64,
    roots: Mutex<HashMap<String, EslintRootLifecycle>>,
}

#[derive(Default)]
struct EslintRootLifecycle {
    generation: u64,
    closed: bool,
    processes: HashMap<u64, ActiveEslintProcess>,
}

#[derive(Clone)]
struct ActiveEslintProcess {
    process_id: u32,
    canceled: Arc<AtomicBool>,
}

#[derive(Clone)]
struct EslintLifecyclePermit {
    root_key: String,
    generation: u64,
}

impl EslintProcessRegistry {
    pub fn activate_root(&self, root_path: &Path) {
        let root_key = workspace_key(root_path);
        let Ok(mut roots) = self.roots.lock() else {
            return;
        };
        let lifecycle = roots.entry(root_key).or_default();
        if !lifecycle.closed {
            return;
        }
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        lifecycle.closed = false;
    }

    pub fn stop_root(&self, root_path: &Path) {
        self.stop_key(&workspace_key(root_path));
    }

    pub fn stop_all(&self) {
        let active = self.roots.lock().map(close_all_roots).unwrap_or_default();
        stop_active_processes(active);
    }

    fn stop_key(&self, root_key: &str) {
        let active = self
            .roots
            .lock()
            .ok()
            .map(|mut roots| close_root(&mut roots, root_key))
            .unwrap_or_default();
        stop_active_processes(active);
    }

    fn begin_run(&self, root: &Path) -> Result<EslintLifecyclePermit, String> {
        let root_key = workspace_key(root);
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| "ESLint lifecycle registry is unavailable.".to_string())?;
        let lifecycle = roots.entry(root_key.clone()).or_default();
        if lifecycle.closed {
            return Err("ESLint analysis was canceled because its workspace closed.".to_string());
        }
        Ok(EslintLifecyclePermit {
            root_key,
            generation: lifecycle.generation,
        })
    }

    fn register(
        self: &Arc<Self>,
        permit: &EslintLifecyclePermit,
        process_id: u32,
    ) -> Result<EslintProcessRegistration, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let canceled = Arc::new(AtomicBool::new(false));
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| "ESLint lifecycle registry is unavailable.".to_string())?;
        let Some(lifecycle) = roots.get_mut(&permit.root_key) else {
            return Err("ESLint analysis was canceled because its workspace closed.".to_string());
        };
        if lifecycle.closed || lifecycle.generation != permit.generation {
            return Err("ESLint analysis was canceled because its workspace closed.".to_string());
        }
        lifecycle.processes.insert(
            id,
            ActiveEslintProcess {
                process_id,
                canceled: Arc::clone(&canceled),
            },
        );
        Ok(EslintProcessRegistration {
            registry: Arc::clone(self),
            root_key: permit.root_key.clone(),
            id,
            canceled,
        })
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.roots
            .lock()
            .map(|roots| roots.values().map(|root| root.processes.len()).sum())
            .unwrap_or_default()
    }
}

fn close_root(
    roots: &mut HashMap<String, EslintRootLifecycle>,
    root_key: &str,
) -> Vec<(u64, ActiveEslintProcess)> {
    let lifecycle = roots.entry(root_key.to_string()).or_default();
    lifecycle.generation = lifecycle.generation.wrapping_add(1);
    lifecycle.closed = true;
    lifecycle.processes.drain().collect()
}

fn close_all_roots(
    mut roots: std::sync::MutexGuard<'_, HashMap<String, EslintRootLifecycle>>,
) -> Vec<(u64, ActiveEslintProcess)> {
    roots
        .values_mut()
        .flat_map(|lifecycle| {
            lifecycle.generation = lifecycle.generation.wrapping_add(1);
            lifecycle.closed = true;
            lifecycle.processes.drain()
        })
        .collect()
}

struct EslintProcessRegistration {
    registry: Arc<EslintProcessRegistry>,
    root_key: String,
    id: u64,
    canceled: Arc<AtomicBool>,
}

impl Drop for EslintProcessRegistration {
    fn drop(&mut self) {
        let Ok(mut roots) = self.registry.roots.lock() else {
            return;
        };
        let Some(lifecycle) = roots.get_mut(&self.root_key) else {
            return;
        };
        lifecycle.processes.remove(&self.id);
    }
}

fn stop_active_processes(active: Vec<(u64, ActiveEslintProcess)>) {
    for (_, process) in active {
        process.canceled.store(true, Ordering::Release);
        terminate_process_group(process.process_id);
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintDiagnostic {
    pub file_path: String,
    pub line: Option<u64>,
    pub column: Option<u64>,
    pub end_line: Option<u64>,
    pub end_column: Option<u64>,
    pub message: String,
    pub identifier: Option<String>,
    pub severity: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<EslintFix>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintFix {
    pub range: [usize; 2],
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintTotals {
    pub error_count: u64,
    pub warning_count: u64,
    pub file_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum EslintAnalysisResponse {
    Ok {
        diagnostics: Vec<EslintDiagnostic>,
        totals: EslintTotals,
    },
    Unavailable {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Error {
        message: String,
    },
}

pub async fn run_eslint_analysis(
    root_path: String,
    binary_path: Option<String>,
    registry: Arc<EslintProcessRegistry>,
) -> Result<EslintAnalysisResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_eslint_analysis_blocking(
            &root_path,
            binary_path.as_deref(),
            &registry,
            WORKSPACE_ANALYSIS_TIMEOUT,
        ))
    })
    .await
}

pub async fn run_eslint_document_analysis(
    root_path: String,
    file_path: String,
    content: String,
    binary_path: Option<String>,
    registry: Arc<EslintProcessRegistry>,
) -> Result<EslintAnalysisResponse, String> {
    crate::run_blocking_command(move || {
        Ok(run_eslint_document_analysis_blocking(
            &root_path,
            &file_path,
            &content,
            binary_path.as_deref(),
            &registry,
            DOCUMENT_ANALYSIS_TIMEOUT,
        ))
    })
    .await
}

fn run_eslint_document_analysis_blocking(
    root_path: &str,
    file_path: &str,
    content: &str,
    binary_path: Option<&str>,
    registry: &Arc<EslintProcessRegistry>,
    timeout: Duration,
) -> EslintAnalysisResponse {
    if content.len() > MAX_DOCUMENT_BYTES {
        return EslintAnalysisResponse::Error {
            message: format!(
                "ESLint fix-on-save skipped a document larger than {} MiB.",
                MAX_DOCUMENT_BYTES / 1024 / 1024
            ),
        };
    }

    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return EslintAnalysisResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let file = match resolve_workspace_file(&root, file_path) {
        Ok(file) => file,
        Err(message) => return EslintAnalysisResponse::Error { message },
    };
    let binary = match resolve_binary(&root, binary_path) {
        Ok(Some(binary)) => binary,
        Ok(None) => return EslintAnalysisResponse::Unavailable { message: None },
        Err(message) => return EslintAnalysisResponse::Error { message },
    };
    let mut command = Command::new(binary);
    command
        .args(eslint_document_args(&file))
        .env("LC_ALL", "C")
        .current_dir(&root)
        .stdin(Stdio::piped());
    configure_process_group(&mut command);
    let output = match run_managed_eslint(command, &root, Some(content), registry, timeout) {
        Ok(output) => output,
        Err(message) => return EslintAnalysisResponse::Error { message },
    };
    if matches!(output.status.code(), Some(0 | 1)) {
        return match parse_eslint_output(&root, &output.stdout) {
            Ok(response) => response,
            Err(_) => EslintAnalysisResponse::Error {
                message: stderr_tail(&output.stderr),
            },
        };
    }

    EslintAnalysisResponse::Error {
        message: stderr_tail(&output.stderr),
    }
}

fn run_eslint_analysis_blocking(
    root_path: &str,
    binary_path: Option<&str>,
    registry: &Arc<EslintProcessRegistry>,
    timeout: Duration,
) -> EslintAnalysisResponse {
    let root = match fs::canonicalize(root_path) {
        Ok(root) => root,
        Err(error) => {
            return EslintAnalysisResponse::Error {
                message: format!("Failed to resolve workspace root: {error}"),
            };
        }
    };
    let binary = match resolve_binary(&root, binary_path) {
        Ok(Some(binary)) => binary,
        Ok(None) => return EslintAnalysisResponse::Unavailable { message: None },
        Err(message) => return EslintAnalysisResponse::Error { message },
    };
    let cache_base = std::env::temp_dir()
        .join("mockor-editor")
        .join(ESLINT_CACHE_DIR);
    let mut command = Command::new(binary);
    command
        .args(eslint_args(&root, &cache_base))
        .env("LC_ALL", "C")
        .current_dir(&root)
        .stdin(Stdio::null());
    configure_process_group(&mut command);
    let output = match run_managed_eslint(command, &root, None, registry, timeout) {
        Ok(output) => output,
        Err(message) => return EslintAnalysisResponse::Error { message },
    };

    if matches!(output.status.code(), Some(0 | 1)) {
        return match parse_eslint_output(&root, &output.stdout) {
            Ok(response) => response,
            Err(_) => EslintAnalysisResponse::Error {
                message: stderr_tail(&output.stderr),
            },
        };
    }

    EslintAnalysisResponse::Error {
        message: stderr_tail(&output.stderr),
    }
}

struct ManagedEslintOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_managed_eslint(
    mut command: Command,
    root: &Path,
    input: Option<&str>,
    registry: &Arc<EslintProcessRegistry>,
    timeout: Duration,
) -> Result<ManagedEslintOutput, String> {
    let permit = registry.begin_run(root)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run ESLint: {error}"))?;
    let registration = register_spawned_process(registry, &permit, &mut child)?;
    let stdin = child.stdin.take();
    let stdout_reader = spawn_pipe_reader(child.stdout.take());
    let stderr_reader = spawn_pipe_reader(child.stderr.take());
    let input = input.map(str::as_bytes).map(ToOwned::to_owned);
    let writer = std::thread::spawn(move || {
        let (Some(mut stdin), Some(input)) = (stdin, input) else {
            return Ok(());
        };
        stdin.write_all(&input).map_err(|error| error.to_string())
    });
    let deadline = Instant::now() + timeout;

    let status = loop {
        if registration.canceled.load(Ordering::Acquire) {
            terminate_and_reap(&mut child);
            join_managed_threads(writer, stdout_reader, stderr_reader);
            return Err("ESLint analysis was canceled because its workspace closed.".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                terminate_process_group(child.id());
                terminate_and_reap(&mut child);
                join_managed_threads(writer, stdout_reader, stderr_reader);
                return Err(format!(
                    "ESLint timed out after {} ms.",
                    timeout.as_millis()
                ));
            }
            Ok(None) => std::thread::sleep(WAIT_POLL_INTERVAL),
            Err(error) => {
                terminate_process_group(child.id());
                terminate_and_reap(&mut child);
                join_managed_threads(writer, stdout_reader, stderr_reader);
                return Err(format!("Failed to wait for ESLint: {error}"));
            }
        }
    };

    let write_result = writer
        .join()
        .map_err(|_| "ESLint stdin writer panicked.".to_string())?;
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    write_result
        .map_err(|message| format!("Failed to send the current document to ESLint: {message}"))?;
    drop(registration);
    Ok(ManagedEslintOutput {
        status,
        stdout,
        stderr,
    })
}

fn register_spawned_process(
    registry: &Arc<EslintProcessRegistry>,
    permit: &EslintLifecyclePermit,
    child: &mut Child,
) -> Result<EslintProcessRegistration, String> {
    match registry.register(permit, child.id()) {
        Ok(registration) => Ok(registration),
        Err(message) => {
            terminate_process_group(child.id());
            terminate_and_reap(child);
            Err(message)
        }
    }
}

fn spawn_pipe_reader<R>(pipe: Option<R>) -> std::thread::JoinHandle<Vec<u8>>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let Some(mut pipe) = pipe else {
            return Vec::new();
        };
        let mut output = Vec::new();
        let _ = pipe.read_to_end(&mut output);
        output
    })
}

fn join_managed_threads(
    writer: std::thread::JoinHandle<Result<(), String>>,
    stdout_reader: std::thread::JoinHandle<Vec<u8>>,
    stderr_reader: std::thread::JoinHandle<Vec<u8>>,
) {
    let _ = writer.join();
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
}

fn terminate_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(process_id: u32) {
    let Ok(process_group_id) = i32::try_from(process_id) else {
        return;
    };
    unsafe {
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_process_id: u32) {}

fn workspace_key(root: &Path) -> String {
    root.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintOutputFile {
    file_path: String,
    messages: Vec<EslintOutputMessage>,
    error_count: u64,
    warning_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintOutputMessage {
    rule_id: Option<String>,
    severity: u8,
    message: String,
    line: Option<u64>,
    column: Option<u64>,
    end_line: Option<u64>,
    end_column: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_fix")]
    fix: Option<EslintFix>,
}

fn deserialize_optional_fix<'de, D>(deserializer: D) -> Result<Option<EslintFix>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| serde_json::from_value(value).ok()))
}

fn parse_eslint_output(root: &Path, stdout: &[u8]) -> Result<EslintAnalysisResponse, String> {
    let output: Vec<EslintOutputFile> =
        serde_json::from_slice(stdout).map_err(|error| error.to_string())?;
    let error_count = output.iter().map(|file| file.error_count).sum();
    let warning_count = output.iter().map(|file| file.warning_count).sum();
    let file_count = output
        .iter()
        .filter(|file| file.error_count + file.warning_count > 0)
        .map(|file| &file.file_path)
        .collect::<BTreeSet<_>>()
        .len() as u64;
    let mut diagnostics = Vec::with_capacity(
        MAX_DIAGNOSTICS.min(output.iter().map(|file| file.messages.len()).sum()),
    );

    for file in output {
        let absolute_path = Path::new(&file.file_path);
        if !absolute_path.is_absolute() {
            continue;
        }
        let relative_path = match absolute_path.strip_prefix(root) {
            Ok(relative_path) => relative_path,
            Err(_) => continue,
        };
        let relative_path = relative_path.to_string_lossy().replace('\\', "/");

        for message in file.messages {
            if diagnostics.len() == MAX_DIAGNOSTICS {
                break;
            }
            diagnostics.push(EslintDiagnostic {
                file_path: relative_path.clone(),
                line: message.line,
                column: message.column,
                end_line: message.end_line,
                end_column: message.end_column,
                message: message.message,
                identifier: message.rule_id,
                severity: message.severity,
                fix: message.fix,
            });
        }
    }

    Ok(EslintAnalysisResponse::Ok {
        diagnostics,
        totals: EslintTotals {
            error_count,
            warning_count,
            file_count,
        },
    })
}

fn eslint_args(root: &Path, cache_base: &Path) -> Vec<String> {
    let mut args = vec![
        ".".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--no-color".to_string(),
    ];
    let cache_dir = workspace_cache_dir(cache_base, root);

    if fs::create_dir_all(&cache_dir).is_ok() {
        args.push("--cache".to_string());
        args.push("--cache-location".to_string());
        args.push(cache_dir.to_string_lossy().into_owned());
    }

    args
}

fn eslint_document_args(file: &Path) -> Vec<String> {
    vec![
        "--stdin".to_string(),
        "--stdin-filename".to_string(),
        file.to_string_lossy().into_owned(),
        "--format".to_string(),
        "json".to_string(),
        "--no-color".to_string(),
        "--no-cache".to_string(),
    ]
}

fn resolve_workspace_file(root: &Path, file_path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(file_path);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|error| format!("Failed to resolve ESLint document: {error}"))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| "ESLint document has no parent directory.".to_string())?
            .canonicalize()
            .map_err(|error| format!("Failed to resolve ESLint document parent: {error}"))?;
        let name = candidate
            .file_name()
            .ok_or_else(|| "ESLint document has no file name.".to_string())?;
        parent.join(name)
    };

    if resolved.strip_prefix(root).is_err() {
        return Err("ESLint document must stay inside the workspace root.".to_string());
    }

    Ok(resolved)
}

fn workspace_cache_dir(cache_base: &Path, root: &Path) -> PathBuf {
    let normalized_root = root.to_string_lossy().replace('\\', "/");
    cache_base.join(format!("{:016x}", stable_hash(&normalized_root)))
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

fn resolve_binary(root: &Path, binary_path: Option<&str>) -> Result<Option<PathBuf>, String> {
    let (candidate, is_explicit) = match binary_path {
        Some(path) if path.trim().is_empty() => {
            return Err("ESLint binary path must not be empty.".to_string());
        }
        Some(path) => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                (path, true)
            } else {
                (root.join(path), true)
            }
        }
        None => (root.join("node_modules").join(".bin").join("eslint"), false),
    };

    if !is_executable_file(&candidate) {
        if is_explicit {
            return Err(format!(
                "Configured ESLint binary is missing or not executable: {}",
                candidate.display()
            ));
        }
        return Ok(None);
    }

    candidate
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("Failed to resolve ESLint binary: {error}"))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn stderr_tail(stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let mut tail: String = stderr.chars().rev().take(2_000).collect();
    tail = tail.chars().rev().collect();
    tail
}

#[cfg(test)]
mod tests {
    use super::{
        configure_process_group, eslint_args, eslint_document_args, parse_eslint_output,
        register_spawned_process, run_eslint_analysis_blocking,
        run_eslint_document_analysis_blocking, workspace_cache_dir, EslintAnalysisResponse,
        EslintProcessRegistry, MAX_DIAGNOSTICS,
    };
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    #[cfg(unix)]
    use std::{io::Write, os::unix::fs::PermissionsExt};

    #[test]
    fn parses_messages_with_ranges_severities_and_uncapped_totals() {
        let root = temp_workspace("eslint-files");
        let file = root.join("src").join("index.ts");
        let response = parse_fixture(
            &root,
            json!([{
                "filePath": file,
                "messages": [
                    { "ruleId": "no-console", "severity": 1, "message": "Unexpected console statement.", "line": 4, "column": 3 },
                    { "ruleId": "semi", "severity": 2, "message": "Missing semicolon.", "line": 4, "column": 20, "endLine": 4, "endColumn": 21 }
                ],
                "errorCount": 1,
                "warningCount": 1
            }]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].file_path, "src/index.ts");
        assert_eq!(diagnostics[0].severity, 1);
        assert_eq!(diagnostics[0].identifier.as_deref(), Some("no-console"));
        assert_eq!(diagnostics[1].end_line, Some(4));
        assert_eq!(diagnostics[1].end_column, Some(21));
        assert_eq!(totals.error_count, 1);
        assert_eq!(totals.warning_count, 1);
        assert_eq!(totals.file_count, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn parses_present_absent_and_malformed_fixes() {
        let root = temp_workspace("eslint-fixes");
        let file = root.join("src").join("index.ts");
        let response = parse_fixture(
            &root,
            json!([{
                "filePath": file,
                "messages": [
                    { "ruleId": "semi", "severity": 2, "message": "Fixable", "line": 1, "column": 1, "fix": { "range": [4, 5], "text": ";" } },
                    { "ruleId": "quotes", "severity": 1, "message": "Absent", "line": 2, "column": 1 },
                    { "ruleId": "indent", "severity": 1, "message": "Malformed", "line": 3, "column": 1, "fix": { "range": [2], "text": "  " } },
                    { "ruleId": "comma", "severity": 1, "message": "Partial", "line": 4, "column": 1, "fix": { "range": [8, 9] } }
                ],
                "errorCount": 1,
                "warningCount": 3
            }]),
        );
        let (diagnostics, _) = ok_parts(response);

        assert_eq!(
            diagnostics[0].fix.as_ref().map(|fix| fix.range),
            Some([4, 5])
        );
        assert_eq!(
            diagnostics[0].fix.as_ref().map(|fix| fix.text.as_str()),
            Some(";")
        );
        assert_eq!(diagnostics[1].fix, None);
        assert_eq!(diagnostics[2].fix, None);
        assert_eq!(diagnostics[3].fix, None);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn drops_relative_and_outside_files_but_keeps_their_totals() {
        let root = temp_workspace("eslint-root");
        let inside = root.join("inside.js");
        let outside = root.parent().expect("parent").join("outside.js");
        let response = parse_fixture(
            &root,
            json!([
                eslint_file(&inside, 2, 0, "Inside"),
                eslint_file(&outside, 1, 0, "Outside"),
                { "filePath": "relative.js", "messages": [{ "ruleId": null, "severity": 1, "message": "Relative", "line": 1, "column": 1 }], "errorCount": 0, "warningCount": 1 }
            ]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file_path, "inside.js");
        assert_eq!(totals.error_count, 3);
        assert_eq!(totals.warning_count, 1);
        assert_eq!(totals.file_count, 3);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn caps_diagnostics_without_changing_totals() {
        let root = temp_workspace("eslint-cap");
        let file = root.join("many.js");
        let messages: Vec<_> = (0..(MAX_DIAGNOSTICS + 10))
            .map(|line| json!({ "ruleId": "rule", "severity": 2, "message": format!("Error {line}"), "line": line + 1, "column": 1 }))
            .collect();
        let response = parse_fixture(
            &root,
            json!([{ "filePath": file, "messages": messages, "errorCount": MAX_DIAGNOSTICS + 10, "warningCount": 7 }]),
        );
        let (diagnostics, totals) = ok_parts(response);

        assert_eq!(diagnostics.len(), MAX_DIAGNOSTICS);
        assert_eq!(totals.error_count, (MAX_DIAGNOSTICS + 10) as u64);
        assert_eq!(totals.warning_count, 7);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_unavailable_without_explicit_or_workspace_binary() {
        let root = temp_workspace("eslint-unavailable");
        let response = run_eslint_analysis_blocking(
            root.to_str().expect("root"),
            None,
            &test_registry(),
            Duration::from_secs(2),
        );
        assert_eq!(
            response,
            EslintAnalysisResponse::Unavailable { message: None }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn returns_error_for_missing_explicit_binary() {
        let root = temp_workspace("eslint-explicit");
        let configured = root.join("tools").join("eslint");
        let response = run_eslint_analysis_blocking(
            root.to_str().expect("root"),
            Some(configured.to_str().expect("binary")),
            &test_registry(),
            Duration::from_secs(2),
        );

        match response {
            EslintAnalysisResponse::Error { message } => {
                assert!(message.contains(configured.to_str().expect("binary")));
                assert!(message.contains("missing or not executable"));
            }
            other => panic!("expected error response, got {other:?}"),
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn accepts_exit_one_diagnostics_and_reports_exit_two_and_bad_json() {
        let root = temp_workspace("eslint-script-results");
        let linted = root.join("linted.js");
        let exit_one = executable_script(
            &root,
            "exit-one",
            &format!("#!/bin/sh\nprintf '[{{\"filePath\":\"{}\",\"messages\":[{{\"ruleId\":\"semi\",\"severity\":2,\"message\":\"Missing semicolon.\",\"line\":1,\"column\":1}}],\"errorCount\":1,\"warningCount\":0}}]'\nexit 1\n", linted.display()),
        );
        let exit_two = executable_script(
            &root,
            "exit-two",
            "#!/bin/sh\necho 'Could not find config file.' >&2\nexit 2\n",
        );
        let bad_json = executable_script(
            &root,
            "bad-json",
            "#!/bin/sh\necho 'not-json'\necho 'bad JSON context' >&2\nexit 0\n",
        );

        let ok = run_eslint_analysis_blocking(
            root.to_str().expect("root"),
            Some(exit_one.to_str().expect("binary")),
            &test_registry(),
            Duration::from_secs(2),
        );
        assert_eq!(ok_parts(ok).0.len(), 1);
        assert_eq!(
            run_eslint_analysis_blocking(
                root.to_str().expect("root"),
                Some(exit_two.to_str().expect("binary")),
                &test_registry(),
                Duration::from_secs(2),
            ),
            EslintAnalysisResponse::Error {
                message: "Could not find config file.\n".to_string(),
            }
        );
        assert_eq!(
            run_eslint_analysis_blocking(
                root.to_str().expect("root"),
                Some(bad_json.to_str().expect("binary")),
                &test_registry(),
                Duration::from_secs(2),
            ),
            EslintAnalysisResponse::Error {
                message: "bad JSON context\n".to_string(),
            }
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn builds_contract_argv_with_per_workspace_cache() {
        let cache_base = temp_workspace("eslint-cache-base");
        let root = Path::new("/workspace/project");
        let cache_dir = cache_base.join("3d0ae75b40dc9e45");

        assert_eq!(workspace_cache_dir(&cache_base, root), cache_dir);

        assert_eq!(
            eslint_args(root, &cache_base),
            vec![
                ".".to_string(),
                "--format".to_string(),
                "json".to_string(),
                "--no-color".to_string(),
                "--cache".to_string(),
                "--cache-location".to_string(),
                cache_dir.to_string_lossy().into_owned(),
            ]
        );
        assert!(cache_dir.is_dir());
        fs::remove_dir_all(cache_base).expect("cleanup cache base");
    }

    #[test]
    fn omits_cache_argv_when_cache_directory_cannot_be_created() {
        let root = temp_workspace("eslint-cache-fallback");
        let cache_base = root.join("not-a-directory");
        fs::write(&cache_base, "occupied").expect("create blocking file");

        assert_eq!(
            eslint_args(&root, &cache_base),
            vec![".", "--format", "json", "--no-color"]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn builds_current_document_argv_without_a_stale_cache() {
        assert_eq!(
            eslint_document_args(Path::new("/workspace/src/current.ts")),
            vec![
                "--stdin",
                "--stdin-filename",
                "/workspace/src/current.ts",
                "--format",
                "json",
                "--no-color",
                "--no-cache",
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn analyses_the_current_buffer_via_stdin_and_rejects_cross_root_paths() {
        let root = temp_workspace("eslint-current-buffer");
        let source_dir = root.join("src");
        fs::create_dir_all(&source_dir).expect("source directory");
        let file = source_dir.join("current.ts");
        fs::write(&file, "saved content").expect("saved fixture");
        let script = executable_script(
            &root,
            "stdin-eslint",
            &format!(
                "#!/bin/sh\ncontent=$(cat)\n[ \"$content\" = \"dirty current content\" ] || exit 2\nprintf '[{{\"filePath\":\"{}\",\"messages\":[{{\"ruleId\":\"semi\",\"severity\":2,\"message\":\"Fix current buffer\",\"line\":1,\"column\":1,\"fix\":{{\"range\":[0,5],\"text\":\"fixed\"}}}}],\"errorCount\":1,\"warningCount\":0}}]'\n",
                file.display()
            ),
        );

        let response = run_eslint_document_analysis_blocking(
            root.to_str().expect("root"),
            file.to_str().expect("file"),
            "dirty current content",
            Some(script.to_str().expect("binary")),
            &test_registry(),
            Duration::from_secs(2),
        );
        let (diagnostics, _) = ok_parts(response);
        assert_eq!(
            diagnostics[0].fix.as_ref().map(|fix| fix.text.as_str()),
            Some("fixed")
        );

        let outside = root.parent().expect("parent").join("outside.ts");
        assert!(matches!(
            run_eslint_document_analysis_blocking(
                root.to_str().expect("root"),
                outside.to_str().expect("outside"),
                "content",
                Some(script.to_str().expect("binary")),
                &test_registry(),
                Duration::from_secs(2),
            ),
            EslintAnalysisResponse::Error { message } if message.contains("workspace root")
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn document_timeout_kills_and_unregisters_the_process() {
        let root = temp_workspace("eslint-timeout");
        let source = root.join("current.ts");
        fs::write(&source, "const value = 1").expect("source fixture");
        let script = executable_script(
            &root,
            "hanging-eslint",
            "#!/bin/sh\ncat >/dev/null\nsleep 30\n",
        );
        let registry = test_registry();

        let response = run_eslint_document_analysis_blocking(
            root.to_str().expect("root"),
            source.to_str().expect("source"),
            "const value = 2",
            Some(script.to_str().expect("binary")),
            &registry,
            Duration::from_millis(150),
        );

        assert!(matches!(
            response,
            EslintAnalysisResponse::Error { message } if message.contains("timed out")
        ));
        assert_eq!(registry.active_count(), 0);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn workspace_close_cancels_only_that_roots_eslint_processes() {
        let root_a = temp_workspace("eslint-close-a");
        let root_b = temp_workspace("eslint-close-b");
        let registry = test_registry();
        let thread_a = spawn_hanging_document_analysis(&root_a, Arc::clone(&registry));
        let thread_b = spawn_hanging_document_analysis(&root_b, Arc::clone(&registry));
        wait_until(Duration::from_secs(2), || registry.active_count() == 2);
        wait_until(Duration::from_secs(2), || {
            root_a.join("descendant.pid").exists()
        });
        let descendant_pid: i32 = fs::read_to_string(root_a.join("descendant.pid"))
            .expect("descendant pid")
            .trim()
            .parse()
            .expect("numeric pid");

        registry.stop_root(&root_a);
        let response_a = thread_a.join().expect("root A analysis thread");
        assert!(matches!(
            response_a,
            EslintAnalysisResponse::Error { message } if message.contains("workspace closed")
        ));
        assert_eq!(registry.active_count(), 1);
        assert!(
            unsafe { libc::kill(descendant_pid, 0) } != 0,
            "ESLint descendant {descendant_pid} survived workspace cleanup",
        );

        registry.stop_all();
        let response_b = thread_b.join().expect("root B analysis thread");
        assert!(matches!(
            response_b,
            EslintAnalysisResponse::Error { message } if message.contains("workspace closed")
        ));
        assert_eq!(registry.active_count(), 0);
        fs::remove_dir_all(root_a).expect("cleanup root A");
        fs::remove_dir_all(root_b).expect("cleanup root B");
    }

    #[test]
    #[cfg(unix)]
    fn workspace_close_during_startup_rejects_and_reaps_late_process_registration() {
        let root = temp_workspace("eslint-close-startup");
        let registry = test_registry();
        let permit = registry.begin_run(&root).expect("startup permit");
        let descendant_file = root.join("descendant.pid");
        let script = executable_script(
            &root,
            "late-eslint",
            &format!(
                "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n",
                descendant_file.display()
            ),
        );
        let mut command = Command::new(script);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn late ESLint");
        wait_until(Duration::from_secs(2), || descendant_file.exists());
        let descendant_pid: i32 = fs::read_to_string(&descendant_file)
            .expect("descendant pid")
            .trim()
            .parse()
            .expect("numeric descendant pid");

        registry.stop_root(&root);
        let result = register_spawned_process(&registry, &permit, &mut child);

        assert!(matches!(result, Err(message) if message.contains("workspace closed")));
        assert!(child.try_wait().expect("child status").is_some());
        assert_eq!(registry.active_count(), 0);
        assert!(
            unsafe { libc::kill(descendant_pid, 0) } != 0,
            "late ESLint descendant {descendant_pid} survived workspace close",
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    #[cfg(unix)]
    fn trust_revoke_during_startup_blocks_late_registration_until_reactivated() {
        let root = temp_workspace("eslint-revoke-startup");
        let registry = test_registry();
        let stale_permit = registry.begin_run(&root).expect("startup permit");
        let script = executable_script(&root, "late-eslint", "#!/bin/sh\nsleep 30\n");
        let mut command = Command::new(&script);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn late ESLint");

        registry.stop_root(&root);
        let result = register_spawned_process(&registry, &stale_permit, &mut child);

        assert!(matches!(result, Err(message) if message.contains("workspace closed")));
        assert!(child.try_wait().expect("child status").is_some());
        assert!(registry.begin_run(&root).is_err());
        registry.activate_root(&root);
        assert!(registry.begin_run(&root).is_ok());
        assert_eq!(registry.active_count(), 0);
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn eslint_file(
        path: &Path,
        error_count: usize,
        warning_count: usize,
        message: &str,
    ) -> serde_json::Value {
        json!({
            "filePath": path,
            "messages": [{ "ruleId": "rule", "severity": 2, "message": message, "line": 1, "column": 1 }],
            "errorCount": error_count,
            "warningCount": warning_count
        })
    }

    fn parse_fixture(root: &Path, fixture: serde_json::Value) -> EslintAnalysisResponse {
        parse_eslint_output(root, fixture.to_string().as_bytes()).expect("valid ESLint fixture")
    }

    fn ok_parts(
        response: EslintAnalysisResponse,
    ) -> (Vec<super::EslintDiagnostic>, super::EslintTotals) {
        match response {
            EslintAnalysisResponse::Ok {
                diagnostics,
                totals,
            } => (diagnostics, totals),
            other => panic!("expected ok response, got {other:?}"),
        }
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{label}-{nanos}"));
        fs::create_dir_all(&path).expect("temp workspace");
        path.canonicalize().expect("canonical workspace")
    }

    fn test_registry() -> Arc<EslintProcessRegistry> {
        Arc::new(EslintProcessRegistry::default())
    }

    #[cfg(unix)]
    fn spawn_hanging_document_analysis(
        root: &Path,
        registry: Arc<EslintProcessRegistry>,
    ) -> std::thread::JoinHandle<EslintAnalysisResponse> {
        let source = root.join("current.ts");
        fs::write(&source, "const value = 1").expect("source fixture");
        let script = executable_script(
            root,
            "hanging-eslint",
            &format!(
                "#!/bin/sh\nsleep 30 &\necho $! > '{}'\ncat >/dev/null\nwait\n",
                root.join("descendant.pid").display()
            ),
        );
        let root = root.to_path_buf();
        std::thread::spawn(move || {
            run_eslint_document_analysis_blocking(
                root.to_str().expect("root"),
                source.to_str().expect("source"),
                "const value = 2",
                Some(script.to_str().expect("binary")),
                &registry,
                Duration::from_secs(10),
            )
        })
    }

    fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
        let deadline = std::time::Instant::now() + timeout;
        while !predicate() {
            assert!(std::time::Instant::now() < deadline, "condition timed out");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn executable_script(root: &Path, name: &str, contents: &str) -> PathBuf {
        let path = root.join(name);
        let mut file = fs::File::create(&path).expect("create script fixture");
        file.write_all(contents.as_bytes())
            .expect("write script fixture");
        let mut permissions = file.metadata().expect("script metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("make script executable");
        path
    }
}
