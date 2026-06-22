use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::lsp::LanguageServerCommand;

const COMPOSER_COMMAND: &str = if cfg!(windows) {
    "composer.bat"
} else {
    "composer"
};
const MANAGED_PHP_ACTOR_VERSION: &str = "2026.05.30.2";
const MOCKOR_EDITOR_PHPACTOR_PATH: &str = "MOCKOR_EDITOR_PHPACTOR_PATH";

pub const MANAGED_PHPACTOR_INSTALL_COMPLETED_EVENT: &str =
    "php://managed-phpactor-install-completed";

/// Receives the result of a managed PHPactor install that ran on a background
/// thread. Implementations decouple the install worker from the Tauri runtime
/// so the worker stays unit-testable without an `AppHandle`.
pub(crate) trait ManagedPhpactorInstallEventSink: Send + 'static {
    fn emit_completion(&self, root: String, error: Option<String>);
}

/// Runs the (blocking) managed PHPactor install on a dedicated thread and
/// reports completion (success or failure) through `sink`. Returns immediately
/// so the Tauri command never blocks the UI thread. The install logic itself is
/// unchanged — this is only a threading + reporting wrapper.
pub(crate) fn spawn_managed_phpactor_install<S>(root: String, sink: S)
where
    S: ManagedPhpactorInstallEventSink,
{
    std::thread::spawn(move || {
        let error = install_managed_phpactor().err();
        sink.emit_completion(root, error);
    });
}

pub(crate) fn install_managed_phpactor() -> Result<(), String> {
    let phpactor_root = managed_phpactor_root()?;

    if managed_phpactor_binary_exists(&phpactor_root) {
        return Ok(());
    }

    let composer_json = phpactor_root.join("composer.json");
    if !composer_json.exists() {
        run_composer_command(
            &phpactor_root,
            &[
                "init",
                "--name",
                "mockor/editor-php-engine",
                "--type",
                "project",
                "--no-interaction",
            ],
            "Initialize managed PHP IDE engine project",
        )?;
    }

    run_composer_command(
        &phpactor_root,
        &["config", "minimum-stability", "dev"],
        "Configure managed PHP IDE engine stability",
    )?;
    run_composer_command(
        &phpactor_root,
        &["config", "prefer-stable", "true"],
        "Configure managed PHP IDE engine stability preference",
    )?;
    run_composer_command(
        &phpactor_root,
        &[
            "require",
            &format!("phpactor/phpactor:{MANAGED_PHP_ACTOR_VERSION}"),
            "-W",
            "--no-interaction",
        ],
        "Install managed PHP IDE engine",
    )?;

    Ok(())
}

#[cfg(unix)]
pub(crate) fn cleanup_orphaned_managed_phpactor_processes(
    command: &LanguageServerCommand,
    root_path: &str,
    active_root_paths: &[String],
) {
    if !should_cleanup_orphaned_managed_phpactor_processes(command, root_path, active_root_paths) {
        return;
    }

    let executable_pattern = regex_escape_literal(&command.executable);
    let workspace_pattern = regex_escape_literal(&command.working_directory);

    let _ = Command::new("pkill")
        .args(["-f", &format!("{executable_pattern} language-server")])
        .status();
    let _ = Command::new("pkill")
        .args([
            "-f",
            &format!("find {workspace_pattern} -mindepth 1 -newercc .*amp-fs-watch"),
        ])
        .status();
}

#[cfg(unix)]
pub(crate) fn should_cleanup_orphaned_managed_phpactor_processes(
    command: &LanguageServerCommand,
    root_path: &str,
    active_root_paths: &[String],
) -> bool {
    is_managed_phpactor_command(command)
        && !active_root_paths
            .iter()
            .any(|active_root_path| !workspace_root_keys_equal(active_root_path, root_path))
}

#[cfg(unix)]
fn is_managed_phpactor_command(command: &LanguageServerCommand) -> bool {
    let executable_path = command.executable.to_lowercase();
    (executable_path.contains("mockor editor/tools/phpactor")
        || executable_path.contains(".mockor-editor"))
        && command.args.iter().any(|arg| arg == "language-server")
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

fn managed_phpactor_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    for home in managed_home_dirs() {
        if cfg!(unix) {
            roots.push(
                home.join("Library")
                    .join("Application Support")
                    .join("Mockor Editor")
                    .join("tools")
                    .join("phpactor"),
            );
        }

        roots.push(home.join(".mockor-editor").join("tools").join("phpactor"));
    }

    roots
}

fn managed_home_dirs() -> Vec<PathBuf> {
    let mut homes = Vec::new();

    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        homes.push(home);
    }

    if let Some(home) = env::var_os("USERPROFILE").map(PathBuf::from) {
        if !homes.contains(&home) {
            homes.push(home);
        }
    }

    homes
}

#[cfg(unix)]
fn workspace_root_keys_equal(left: &str, right: &str) -> bool {
    normalized_workspace_root_key(left) == normalized_workspace_root_key(right)
}

#[cfg(unix)]
fn normalized_workspace_root_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');

    if trimmed.is_empty() && normalized.starts_with('/') {
        return "/".to_string();
    }

    trimmed.to_string()
}

fn managed_phpactor_root() -> Result<PathBuf, String> {
    if let Some(managed_root) = managed_phpactor_root_from_override() {
        fs::create_dir_all(&managed_root)
            .map_err(|error| format!("Unable to create managed PHPactor directory: {error}"))?;

        return Ok(managed_root);
    }

    let managed_roots = managed_phpactor_roots();

    if managed_roots.is_empty() {
        return Err(
            "Unable to resolve a home directory for managed PHPactor (set HOME or USERPROFILE)."
                .to_string(),
        );
    }

    let selected_root = managed_roots
        .iter()
        .find(|root| root.exists())
        .cloned()
        .unwrap_or_else(|| managed_roots[0].clone());

    fs::create_dir_all(&selected_root)
        .map_err(|error| format!("Unable to create managed PHPactor directory: {error}"))?;

    Ok(selected_root)
}

fn managed_phpactor_root_from_override() -> Option<PathBuf> {
    let path = env::var_os(MOCKOR_EDITOR_PHPACTOR_PATH).map(PathBuf::from)?;
    let binary_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_managed_phpactor_binary_name(&binary_name) {
        return Some(path);
    }

    let bin_dir = path.parent()?;

    if let Some(vendor_dir) = bin_dir.parent() {
        if bin_dir.file_name().is_some_and(|name| name == "bin")
            && vendor_dir.file_name().is_some_and(|name| name == "vendor")
        {
            if let Some(root) = vendor_dir.parent() {
                return Some(root.to_path_buf());
            }
        }
    }

    Some(bin_dir.to_path_buf())
}

fn is_managed_phpactor_binary_name(name: &str) -> bool {
    matches!(
        name,
        "phpactor" | "phpactor.exe" | "phpactor.bat" | "phpactor.cmd"
    )
}

fn managed_phpactor_binary_exists(root: &Path) -> bool {
    if !cfg!(windows) {
        return root.join("vendor").join("bin").join("phpactor").is_file();
    }

    root.join("vendor")
        .join("bin")
        .join("phpactor.exe")
        .is_file()
        || root
            .join("vendor")
            .join("bin")
            .join("phpactor.bat")
            .is_file()
        || root
            .join("vendor")
            .join("bin")
            .join("phpactor.cmd")
            .is_file()
}

fn run_composer_command(root: &Path, args: &[&str], context: &str) -> Result<(), String> {
    let command = Command::new(COMPOSER_COMMAND)
        .current_dir(root)
        .args(args)
        .output()
        .map_err(|error| format!("{context}: unable to run Composer: {error}"))?;

    if command.status.success() {
        return Ok(());
    }

    let output = String::from_utf8_lossy(&command.stderr).trim().to_string();
    let fallback_output = String::from_utf8_lossy(&command.stdout).trim().to_string();
    let details = if output.is_empty() {
        fallback_output
    } else {
        output
    };
    let status = command
        .status
        .code()
        .map_or_else(|| "terminated".to_string(), |code| code.to_string());

    Err(format!("{context} failed ({status}): {details}"))
}

#[cfg(test)]
mod install_worker_tests {
    use super::*;
    use std::sync::mpsc;

    struct ChannelSink {
        sender: mpsc::Sender<(String, Option<String>)>,
    }

    impl ManagedPhpactorInstallEventSink for ChannelSink {
        fn emit_completion(&self, root: String, error: Option<String>) {
            let _ = self.sender.send((root, error));
        }
    }

    #[test]
    fn spawned_install_reports_completion_with_requesting_root() {
        let (sender, receiver) = mpsc::channel();
        let temp_dir = std::env::temp_dir().join(format!(
            "mockor-managed-phpactor-test-{}",
            std::process::id()
        ));
        // Point the install at an isolated, composer-less directory so the
        // worker resolves quickly without mutating any real managed root.
        std::env::set_var(MOCKOR_EDITOR_PHPACTOR_PATH, &temp_dir);

        spawn_managed_phpactor_install(
            "/workspace-a".to_string(),
            ChannelSink {
                sender: sender.clone(),
            },
        );

        let (root, _error) = receiver
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("install worker should report completion");

        std::env::remove_var(MOCKOR_EDITOR_PHPACTOR_PATH);
        let _ = fs::remove_dir_all(&temp_dir);

        assert_eq!(root, "/workspace-a");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn cleanup_is_allowed_for_managed_phpactor_without_active_sibling_roots() {
        let command = managed_command("/workspace-a");

        assert!(should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-a",
            &[],
        ));
        assert!(should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-a",
            &["/workspace-a/".to_string()],
        ));
    }

    #[test]
    fn cleanup_is_skipped_for_managed_phpactor_when_another_workspace_is_running() {
        let command = managed_command("/workspace-b");

        assert!(!should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-b",
            &["/workspace-a".to_string()],
        ));
        assert!(!should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-b",
            &["/workspace-a".to_string(), "/workspace-b".to_string()],
        ));
    }

    #[test]
    fn cleanup_is_skipped_for_non_managed_phpactor_commands() {
        let command = LanguageServerCommand {
            args: vec!["language-server".to_string()],
            executable: "/workspace/vendor/bin/phpactor".to_string(),
            working_directory: "/workspace".to_string(),
        };

        assert!(!should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace",
            &[],
        ));
    }

    fn managed_command(workspace: &str) -> LanguageServerCommand {
        LanguageServerCommand {
            args: vec!["language-server".to_string()],
            executable:
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
                    .to_string(),
            working_directory: workspace.to_string(),
        }
    }
}
