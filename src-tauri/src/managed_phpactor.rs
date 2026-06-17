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
pub(crate) fn cleanup_orphaned_managed_phpactor_processes(command: &LanguageServerCommand) {
    if !is_managed_phpactor_command(command) {
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
