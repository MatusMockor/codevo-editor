#[cfg(unix)]
use crate::lsp::{JsonRpcRequest, LanguageServerCommand};
#[cfg(unix)]
use serde_json::Value;
#[cfg(unix)]
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::Command,
};
use std::{env, fs};

pub const MANAGED_TYPESCRIPT_LANGUAGE_SERVER_INSTALL_COMPLETED_EVENT: &str =
    "typescript://managed-language-server-install-completed";
const MANAGED_TYPESCRIPT_LANGUAGE_SERVER_VERSION: &str = "5.3.0";
const MANAGED_TYPESCRIPT_VERSION: &str = "5.8.3";
const CODEVO_EDITOR_NODE_PATH: &str = "CODEVO_EDITOR_NODE_PATH";

pub(crate) trait ManagedTypeScriptInstallEventSink: Send + 'static {
    fn emit_completion(&self, root: String, error: Option<String>);
}

pub(crate) fn spawn_managed_typescript_language_server_install<S>(root: String, sink: S)
where
    S: ManagedTypeScriptInstallEventSink,
{
    std::thread::spawn(move || sink.emit_completion(root, install_managed_typescript_language_server().err()));
}

pub(crate) fn node_executable_path() -> Option<String> {
    let configured = env::var_os(CODEVO_EDITOR_NODE_PATH).map(PathBuf::from);
    if let Some(path) = configured.filter(|path| path.is_file()) {
        return Some(path.to_string_lossy().to_string());
    }
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|directory| directory.join("node"))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

pub(crate) fn install_managed_typescript_language_server() -> Result<(), String> {
    let root = managed_typescript_language_server_root()?;
    fs::create_dir_all(&root).map_err(|error| format!("Unable to create managed TypeScript directory: {error}"))?;
    fs::write(root.join("package.json"), managed_package_json())
        .map_err(|error| format!("Unable to write managed TypeScript package manifest: {error}"))?;
    let node = node_executable_path().ok_or_else(|| "Node.js 20 or newer is required to install the managed TypeScript IDE engine. Install Node.js and restart Codevo Editor.".to_string())?;
    let version = std::process::Command::new(&node).arg("--version").output()
        .map_err(|error| format!("Unable to run Node.js: {error}"))?;
    let version = String::from_utf8_lossy(&version.stdout);
    let major = version.trim().trim_start_matches('v').split('.').next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    if !version_status_success(&version, major) { return Err("Node.js 20 or newer is required to install the managed TypeScript IDE engine.".to_string()); }
    let npm = PathBuf::from(&node).parent().map(|dir| dir.join("npm")).filter(|path| path.is_file()).unwrap_or_else(|| PathBuf::from("npm"));
    let output = std::process::Command::new(npm).args(["install", "--omit=dev", "--no-audit", "--no-fund"])
        .current_dir(&root).output().map_err(|error| format!("Unable to run npm: {error}"))?;
    if output.status.success() { Ok(()) } else { Err(format!("Unable to install managed TypeScript IDE engine: {}", String::from_utf8_lossy(&output.stderr).trim())) }
}

pub(crate) fn managed_typescript_language_server_root() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "Unable to determine the home directory for the managed TypeScript IDE engine.".to_string())?;
    #[cfg(target_os = "macos")]
    { return Ok(home.join("Library/Application Support/Codevo Editor/tools/typescript-language-server")); }
    #[cfg(not(target_os = "macos"))]
    Ok(home.join(".codevo-editor/tools/typescript-language-server"))
}

fn managed_package_json() -> String {
    format!("{{\n  \"private\": true,\n  \"dependencies\": {{\n    \"typescript-language-server\": \"{MANAGED_TYPESCRIPT_LANGUAGE_SERVER_VERSION}\",\n    \"typescript\": \"{MANAGED_TYPESCRIPT_VERSION}\"\n  }}\n}}\n")
}

fn version_status_success(version: &str, major: u32) -> bool { !version.trim().is_empty() && major >= 20 }

#[cfg(unix)]
pub(crate) fn cleanup_orphaned_javascript_typescript_processes(
    command: &LanguageServerCommand,
    initialize_request: &JsonRpcRequest,
    root_path: &str,
    active_root_paths: &[String],
) {
    if !is_javascript_typescript_language_server_command(command, root_path) {
        return;
    }

    if should_cleanup_orphaned_javascript_typescript_processes(
        command,
        root_path,
        active_root_paths,
    ) {
        let Some(server_path) = typescript_language_server_path_in_command(command, root_path)
        else {
            return;
        };

        let server_pattern = regex_escape_literal(server_path);
        let _ = Command::new("pkill")
            .args(["-f", &format!("{server_pattern} .*--stdio( |$)")])
            .status();
    }

    for tsserver_path in
        tsserver_paths_for_active_cleanup(command, initialize_request, root_path, active_root_paths)
    {
        let tsserver_pattern = regex_escape_literal(&tsserver_path);
        let _ = Command::new("pkill")
            .args([
                "-f",
                &format!(
                    "{tsserver_pattern} .*--useInferredProjectPerProjectRoot .*--validateDefaultNpmLocation( |$)"
                ),
            ])
            .status();
    }
}

#[cfg(unix)]
pub(crate) fn should_cleanup_orphaned_javascript_typescript_processes(
    command: &LanguageServerCommand,
    root_path: &str,
    active_root_paths: &[String],
) -> bool {
    is_javascript_typescript_language_server_command(command, root_path)
        && !active_root_paths
            .iter()
            .any(|active_root_path| !workspace_root_keys_equal(active_root_path, root_path))
}

#[cfg(unix)]
fn is_javascript_typescript_language_server_command(
    command: &LanguageServerCommand,
    root_path: &str,
) -> bool {
    typescript_language_server_path_in_command(command, root_path).is_some()
        && command.args.iter().any(|arg| arg == "--stdio")
}

#[cfg(unix)]
fn typescript_language_server_path_in_command<'a>(
    command: &'a LanguageServerCommand,
    root_path: &str,
) -> Option<&'a str> {
    std::iter::once(&command.executable)
        .chain(command.args.iter())
        .map(String::as_str)
        .find(|candidate| is_typescript_language_server_path(candidate, root_path))
}

#[cfg(unix)]
fn is_typescript_language_server_path(path: &str, root_path: &str) -> bool {
    let normalized = normalize_path(path);
    if normalized.ends_with("/node_modules/typescript-language-server/lib/cli.mjs") {
        return true;
    }
    if !is_typescript_language_server_binary_name(
        &Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default(),
    ) {
        return false;
    }

    let root = normalized_workspace_root_key(root_path);
    normalized == format!("{root}/node_modules/.bin/typescript-language-server")
        || normalized.ends_with("/node_modules/.bin/typescript-language-server")
}

#[cfg(unix)]
fn tsserver_paths_for_cleanup(
    command: &LanguageServerCommand,
    initialize_request: &JsonRpcRequest,
    root_path: &str,
) -> Vec<String> {
    let mut paths = BTreeSet::new();

    if let Some(path) = tsserver_path_from_initialize_request(initialize_request) {
        if should_cleanup_tsserver_path(path, command, root_path) {
            paths.insert(path.to_string());
        }
    }

    for path in inferred_tsserver_paths(command, root_path) {
        if should_cleanup_tsserver_path(&path, command, root_path) {
            paths.insert(path);
        }
    }

    paths.into_iter().collect()
}

#[cfg(unix)]
fn tsserver_paths_for_active_cleanup(
    command: &LanguageServerCommand,
    initialize_request: &JsonRpcRequest,
    root_path: &str,
    active_root_paths: &[String],
) -> Vec<String> {
    let can_cleanup_shared_processes = should_cleanup_orphaned_javascript_typescript_processes(
        command,
        root_path,
        active_root_paths,
    );

    tsserver_paths_for_cleanup(command, initialize_request, root_path)
        .into_iter()
        .filter(|path| {
            can_cleanup_shared_processes || is_workspace_typescript_server_path(path, root_path)
        })
        .collect()
}

#[cfg(unix)]
fn tsserver_path_from_initialize_request(request: &JsonRpcRequest) -> Option<&str> {
    request
        .params
        .get("initializationOptions")
        .and_then(Value::as_object)
        .and_then(|options| options.get("tsserver"))
        .and_then(Value::as_object)
        .and_then(|tsserver| tsserver.get("path"))
        .and_then(Value::as_str)
}

#[cfg(unix)]
fn inferred_tsserver_paths(command: &LanguageServerCommand, root_path: &str) -> Vec<String> {
    let mut paths = Vec::new();

    paths.push(
        Path::new(root_path)
            .join("node_modules")
            .join("typescript")
            .join("lib")
            .join("tsserver.js")
            .to_string_lossy()
            .to_string(),
    );

    if let Some(server_path) =
        typescript_language_server_path_in_command(command, root_path).map(PathBuf::from)
    {
        if let Some(node_modules) = node_modules_root_from_typescript_language_server_path(&server_path) {
            paths.push(
                node_modules
                    .join("typescript")
                    .join("lib")
                    .join("tsserver.js")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    paths
}

#[cfg(unix)]
fn should_cleanup_tsserver_path(
    path: &str,
    command: &LanguageServerCommand,
    root_path: &str,
) -> bool {
    if !path.ends_with("/tsserver.js") && !path.ends_with("\\tsserver.js") {
        return false;
    }

    let normalized = normalize_path(path);
    let root = normalized_workspace_root_key(root_path);
    if normalized.starts_with(&format!("{root}/node_modules/typescript/lib/")) {
        return true;
    }

    if let Some(server_path) = typescript_language_server_path_in_command(command, root_path) {
        if let Some(node_modules) = node_modules_root_from_typescript_language_server_path(Path::new(server_path)) {
            let expected = normalize_path(
                &node_modules
                    .join("typescript")
                    .join("lib")
                    .join("tsserver.js")
                    .to_string_lossy(),
            );
            if normalized == expected {
                return true;
            }
        }
    }

    false
}

#[cfg(unix)]
fn is_workspace_typescript_server_path(path: &str, root_path: &str) -> bool {
    if !path.ends_with("/tsserver.js") && !path.ends_with("\\tsserver.js") {
        return false;
    }

    let normalized = normalize_path(path);
    let root = normalized_workspace_root_key(root_path);

    normalized.starts_with(&format!("{root}/node_modules/typescript/lib/"))
}

#[cfg(unix)]
fn node_modules_root_from_bin_tool_path(path: &Path) -> Option<PathBuf> {
    let bin_dir = path.parent()?;
    if !bin_dir.file_name().is_some_and(|name| name == ".bin") {
        return None;
    }

    let node_modules = bin_dir.parent()?;
    if !node_modules
        .file_name()
        .is_some_and(|name| name == "node_modules")
    {
        return None;
    }

    Some(node_modules.to_path_buf())
}

#[cfg(unix)]
fn node_modules_root_from_typescript_language_server_path(path: &Path) -> Option<PathBuf> {
    node_modules_root_from_bin_tool_path(path).or_else(|| {
        let package = path.parent()?.parent()?;
        if package.file_name()?.to_str()? != "typescript-language-server" {
            return None;
        }
        Some(package.parent()?.to_path_buf())
    })
}

#[cfg(unix)]
fn is_typescript_language_server_binary_name(name: &str) -> bool {
    name == "typescript-language-server"
}

#[cfg(unix)]
fn workspace_root_keys_equal(left: &str, right: &str) -> bool {
    normalized_workspace_root_key(left) == normalized_workspace_root_key(right)
}

#[cfg(unix)]
fn normalized_workspace_root_key(path: &str) -> String {
    normalize_path(path).trim_end_matches('/').to_string()
}

#[cfg(unix)]
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(unix)]
fn regex_escape_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());

    for character in value.chars() {
        if matches!(
            character,
            '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\'
        ) {
            escaped.push('\\');
        }

        escaped.push(character);
    }

    escaped
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn cleanup_is_allowed_for_workspace_typescript_language_server_without_active_sibling_roots() {
        let command = workspace_command("/workspace-a");

        assert!(should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
        assert!(should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &["/workspace-a/".to_string()],
        ));
    }

    #[test]
    fn cleanup_is_skipped_for_typescript_language_server_when_another_workspace_is_running() {
        let command = workspace_command("/workspace-b");

        assert!(!should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-b",
            &["/workspace-a".to_string()],
        ));
        assert!(!should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-b",
            &["/workspace-a".to_string(), "/workspace-b".to_string()],
        ));
    }

    #[test]
    fn cleanup_is_skipped_for_unrelated_commands() {
        let command = LanguageServerCommand {
            executable: "/workspace-a/node_modules/.bin/eslint".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(!should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
    }

    #[test]
    fn cleanup_is_skipped_for_typescript_language_server_without_stdio() {
        let command = LanguageServerCommand {
            executable: "/workspace-a/node_modules/.bin/typescript-language-server".to_string(),
            args: vec!["--log-level".to_string(), "4".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(!should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
    }

    #[test]
    fn cleanup_recognizes_managed_typescript_language_server() {
        let command = LanguageServerCommand {
            executable: "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/.bin/typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
    }

    #[test]
    fn cleanup_recognizes_bundled_typescript_language_server() {
        let command = LanguageServerCommand {
            executable: "/Applications/Codevo Editor.app/Contents/Resources/node_modules/.bin/typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
    }

    #[test]
    fn cleanup_skips_global_typescript_language_server_outside_node_modules() {
        let command = LanguageServerCommand {
            executable: "/usr/local/bin/typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(!should_cleanup_orphaned_javascript_typescript_processes(
            &command,
            "/workspace-a",
            &[],
        ));
    }

    #[test]
    fn tsserver_cleanup_uses_workspace_initialize_path() {
        let command = workspace_command("/workspace-a");
        let request = initialize_request_with_tsserver_path(
            "/workspace-a/node_modules/typescript/lib/tsserver.js",
        );

        assert_eq!(
            tsserver_paths_for_cleanup(&command, &request, "/workspace-a"),
            vec!["/workspace-a/node_modules/typescript/lib/tsserver.js".to_string()],
        );
    }

    #[test]
    fn tsserver_cleanup_skips_unrelated_initialize_path() {
        let command = workspace_command("/workspace-a");
        let request =
            initialize_request_with_tsserver_path("/other/node_modules/typescript/lib/tsserver.js");

        assert_eq!(
            tsserver_paths_for_cleanup(&command, &request, "/workspace-a"),
            vec!["/workspace-a/node_modules/typescript/lib/tsserver.js".to_string()],
        );
    }

    #[test]
    fn active_sibling_workspace_still_allows_workspace_local_tsserver_cleanup() {
        let command = workspace_command("/workspace-a");
        let request = initialize_request_with_tsserver_path(
            "/workspace-a/node_modules/typescript/lib/tsserver.js",
        );

        assert_eq!(
            tsserver_paths_for_active_cleanup(
                &command,
                &request,
                "/workspace-a",
                &["/workspace-b".to_string()],
            ),
            vec!["/workspace-a/node_modules/typescript/lib/tsserver.js".to_string()],
        );
    }

    #[test]
    fn active_sibling_workspace_blocks_shared_managed_tsserver_cleanup() {
        let command = LanguageServerCommand {
            executable: "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/.bin/typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };
        let request = initialize_request_with_tsserver_path(
            "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/typescript/lib/tsserver.js",
        );

        assert_eq!(
            tsserver_paths_for_active_cleanup(
                &command,
                &request,
                "/workspace-a",
                &["/workspace-b".to_string()],
            ),
            vec!["/workspace-a/node_modules/typescript/lib/tsserver.js".to_string()],
        );
    }

    #[test]
    fn shared_managed_tsserver_cleanup_is_allowed_without_active_sibling_workspaces() {
        let command = LanguageServerCommand {
            executable: "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/.bin/typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };
        let request = initialize_request_with_tsserver_path(
            "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/typescript/lib/tsserver.js",
        );

        assert_eq!(
            tsserver_paths_for_active_cleanup(&command, &request, "/workspace-a", &[]),
            vec![
                "/Users/dev/Library/Application Support/Codevo Editor/tools/typescript-language-server/node_modules/typescript/lib/tsserver.js"
                    .to_string(),
                "/workspace-a/node_modules/typescript/lib/tsserver.js"
                    .to_string()
            ],
        );
    }

    fn initialize_request_with_tsserver_path(path: &str) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: serde_json::json!({
                "initializationOptions": {
                    "tsserver": {
                        "path": path,
                    },
                },
            }),
        }
    }

    fn workspace_command(workspace: &str) -> LanguageServerCommand {
        LanguageServerCommand {
            executable: format!("{workspace}/node_modules/.bin/typescript-language-server"),
            args: vec!["--stdio".to_string()],
            working_directory: workspace.to_string(),
            env: Vec::new(),
        }
    }
}
