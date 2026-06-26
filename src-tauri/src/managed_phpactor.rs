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

/// File name of the minimal PHP `php.ini` generated next to the managed
/// PHPactor install. Launching PHPactor via `php -c <this file>` makes PHP load
/// this minimal configuration *instead of* the user's main `php.ini`, so broken
/// or noisy user extensions (e.g. a misconfigured `extension=imagick.so`) never
/// emit PHP startup warnings onto stdout — the channel PHPactor uses for the LSP
/// handshake.
const MANAGED_PHP_INI_FILE_NAME: &str = "codevo-php.ini";

/// Minimal `php.ini` body for the managed PHPactor interpreter. It intentionally
/// loads NO user extensions. PHPactor only requires `mbstring` and `tokenizer`,
/// which are compiled into the standard PHP builds we target (e.g. Homebrew PHP),
/// so no `extension=` lines are needed here. The decisive effect is replacing the
/// user's main `php.ini` (which may enable a broken `imagick`) with this clean,
/// warning-free configuration. `display_errors`/`error_reporting` are pinned so a
/// stray notice never reaches stdout and corrupts the handshake.
///
/// OPcache is enabled (including for the CLI SAPI, since PHPactor is a long-running
/// PHP CLI process). PHPactor is a large PHP application that, without bytecode
/// caching, recompiles its sources on every request — enabling OPcache caches the
/// compiled bytecode and meaningfully lowers per-request CPU in IDE/PHP mode. The
/// OPcache engine itself is provided by the host PHP's own `conf.d`, which is
/// still scanned when PHPactor launches via `php -c <this ini>`, so NO
/// `zend_extension=opcache` line is needed (and adding one would risk a
/// missing-library startup warning on stdout that would corrupt the handshake).
/// When the host PHP lacks OPcache entirely, these `opcache.*` directives are
/// silently ignored by PHP — no startup warning — so the configuration stays
/// safe across PHP builds. `validate_timestamps=1` keeps edits picked up promptly.
const MANAGED_PHP_INI_BODY: &str = "; Codevo Editor managed PHP configuration for PHPactor.\n; Generated automatically — do not edit. This file replaces the user's\n; main php.ini when PHPactor is launched, isolating the LSP handshake from\n; broken or noisy user extensions (e.g. imagick).\ndisplay_errors = Off\ndisplay_startup_errors = Off\nerror_reporting = 0\n; Bytecode caching for the long-running PHPactor CLI process: lowers\n; per-request CPU by avoiding recompilation. Inert (no startup warning) when\n; the host PHP has no OPcache; the engine is loaded by the host PHP's conf.d.\nopcache.enable = 1\nopcache.enable_cli = 1\nopcache.memory_consumption = 128\nopcache.max_accelerated_files = 10000\nopcache.validate_timestamps = 1\n";

/// Idempotently ensures the managed minimal `php.ini` exists next to the managed
/// PHPactor install, returning its absolute path. Safe to call repeatedly: it
/// rewrites the file only when missing or its contents drifted from the expected
/// body, so upgrades to the managed config self-heal without redundant writes.
pub(crate) fn ensure_managed_php_ini() -> Result<PathBuf, String> {
    let phpactor_root = managed_phpactor_root()?;

    ensure_managed_php_ini_in(&phpactor_root)
}

fn ensure_managed_php_ini_in(phpactor_root: &Path) -> Result<PathBuf, String> {
    let ini_path = phpactor_root.join(MANAGED_PHP_INI_FILE_NAME);

    if managed_php_ini_is_current(&ini_path) {
        return Ok(ini_path);
    }

    fs::write(&ini_path, MANAGED_PHP_INI_BODY)
        .map_err(|error| format!("Unable to write managed PHP configuration: {error}"))?;

    Ok(ini_path)
}

fn managed_php_ini_is_current(ini_path: &Path) -> bool {
    fs::read_to_string(ini_path)
        .map(|contents| contents == MANAGED_PHP_INI_BODY)
        .unwrap_or(false)
}

pub(crate) fn install_managed_phpactor() -> Result<(), String> {
    let phpactor_root = managed_phpactor_root()?;

    // Always (re)materialise the minimal php.ini so a freshly installed engine —
    // or one whose config drifted — launches with a clean, isolated interpreter.
    ensure_managed_php_ini_in(&phpactor_root)?;

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

    // The managed PHPactor binary path may be the command executable (direct
    // launch fallback) or appear in the args (when launched via an isolated
    // `php -c <ini> <phpactor> language-server` interpreter). Match on the
    // PHPactor path itself so cleanup works for both launch shapes.
    let Some(phpactor_path) = managed_phpactor_path_in_command(command) else {
        return;
    };

    let phpactor_pattern = regex_escape_literal(phpactor_path);
    let workspace_pattern = regex_escape_literal(&command.working_directory);

    let _ = Command::new("pkill")
        .args(["-f", &format!("{phpactor_pattern} language-server")])
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
    managed_phpactor_path_in_command(command).is_some()
        && command.args.iter().any(|arg| arg == "language-server")
}

/// Finds the managed PHPactor binary path within a launch command, whether it is
/// the executable (direct launch) or one of the args (isolated `php` launch).
#[cfg(unix)]
fn managed_phpactor_path_in_command(command: &LanguageServerCommand) -> Option<&str> {
    std::iter::once(&command.executable)
        .chain(command.args.iter())
        .map(String::as_str)
        .find(|candidate| is_managed_phpactor_path(candidate))
}

#[cfg(unix)]
fn is_managed_phpactor_path(path: &str) -> bool {
    // Require both a managed-root marker AND a phpactor binary file name so a
    // sibling artefact under the same root (e.g. the managed `codevo-php.ini`
    // passed via `php -c`) is never mistaken for the phpactor binary. The pkill
    // pattern relies on this being the binary that is immediately followed by
    // `language-server` on the process command line.
    if !is_managed_phpactor_binary_name(
        &Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default(),
    ) {
        return false;
    }

    let normalized = path.to_lowercase();
    normalized.contains("mockor editor/tools/phpactor") || normalized.contains(".mockor-editor")
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

#[cfg(test)]
mod managed_php_ini_tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mockor-managed-ini-{label}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn generates_minimal_php_ini_without_user_extensions() {
        let root = temp_dir("generate");

        let ini_path = ensure_managed_php_ini_in(&root).expect("ensure managed php ini");

        assert_eq!(ini_path, root.join(MANAGED_PHP_INI_FILE_NAME));
        let contents = fs::read_to_string(&ini_path).expect("read managed php ini");
        // The whole point: it must not load any user extension (no imagick), and
        // must keep startup output off stdout so the LSP handshake stays clean.
        // Inspect directive lines only so explanatory comments don't trip the check.
        assert!(!has_active_directive(&contents, "extension"));
        assert!(!directive_lines(&contents).any(|line| line.to_lowercase().contains("imagick")));
        assert!(contents.contains("display_errors = Off"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn ensure_managed_php_ini_is_idempotent() {
        let root = temp_dir("idempotent");

        let first = ensure_managed_php_ini_in(&root).expect("first ensure");
        let first_contents = fs::read_to_string(&first).expect("read first");
        let second = ensure_managed_php_ini_in(&root).expect("second ensure");
        let second_contents = fs::read_to_string(&second).expect("read second");

        assert_eq!(first, second);
        assert_eq!(first_contents, second_contents);

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn managed_php_ini_enables_opcache_for_phpactor() {
        let root = temp_dir("opcache");

        let ini_path = ensure_managed_php_ini_in(&root).expect("ensure managed php ini");
        let contents = fs::read_to_string(&ini_path).expect("read managed php ini");

        // PHPactor is a large, long-running PHP CLI process that reparses bytecode
        // on every request. Enabling OPcache (including for the CLI SAPI) caches
        // the compiled bytecode and lowers per-request CPU. These directives are
        // inert no-ops when the OPcache zend_extension is absent (PHP silently
        // ignores unknown `opcache.*` keys), so they never emit a startup warning
        // that would corrupt the LSP handshake.
        assert!(has_active_directive(&contents, "opcache.enable"));
        assert!(directive_lines(&contents).any(|line| {
            let normalized = line.replace(' ', "");
            normalized == "opcache.enable=1"
        }));
        assert!(directive_lines(&contents).any(|line| {
            let normalized = line.replace(' ', "");
            normalized == "opcache.enable_cli=1"
        }));

        // Enabling OPcache must NOT pull in any user extension or load a missing
        // `.so` (no `zend_extension=`/`extension=` lines): the OPcache engine is
        // provided by the host PHP's own `conf.d`, which is still scanned under
        // `php -c <this ini>`. Adding an explicit load line would risk a
        // missing-library startup warning on stdout.
        assert!(!has_active_directive(&contents, "zend_extension"));
        assert!(!has_active_directive(&contents, "extension"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn ensure_managed_php_ini_rewrites_drifted_contents() {
        let root = temp_dir("drift");
        let ini_path = root.join(MANAGED_PHP_INI_FILE_NAME);
        fs::write(&ini_path, "extension=imagick.so\n").expect("seed drifted ini");

        ensure_managed_php_ini_in(&root).expect("ensure managed php ini");

        let contents = fs::read_to_string(&ini_path).expect("read repaired ini");
        assert_eq!(contents, MANAGED_PHP_INI_BODY);
        assert!(!directive_lines(&contents).any(|line| line.to_lowercase().contains("imagick")));

        fs::remove_dir_all(root).expect("cleanup");
    }

    /// Yields non-comment, non-blank directive lines from a `php.ini` body.
    fn directive_lines(contents: &str) -> impl Iterator<Item = &str> {
        contents
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with(';'))
    }

    fn has_active_directive(contents: &str, key: &str) -> bool {
        directive_lines(contents).any(|line| line.starts_with(key))
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
            env: Vec::new(),
        };

        assert!(!should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace",
            &[],
        ));
    }

    #[test]
    fn cleanup_recognizes_managed_phpactor_launched_through_isolated_php_interpreter() {
        // The isolated launcher shape: executable is `php`, the managed phpactor
        // binary lives in the args after `-c <managed.ini>`.
        let command = LanguageServerCommand {
            executable: "/opt/homebrew/bin/php".to_string(),
            args: vec![
                "-c".to_string(),
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/codevo-php.ini"
                    .to_string(),
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
                    .to_string(),
                "language-server".to_string(),
            ],
            working_directory: "/workspace-a".to_string(),
            env: Vec::new(),
        };

        assert!(is_managed_phpactor_command(&command));
        assert_eq!(
            managed_phpactor_path_in_command(&command),
            Some(
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
            )
        );
        assert!(should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-a",
            &[],
        ));
        assert!(!should_cleanup_orphaned_managed_phpactor_processes(
            &command,
            "/workspace-a",
            &["/workspace-b".to_string()],
        ));
    }

    fn managed_command(workspace: &str) -> LanguageServerCommand {
        LanguageServerCommand {
            args: vec!["language-server".to_string()],
            executable:
                "/Users/dev/Library/Application Support/Mockor Editor/tools/phpactor/vendor/bin/phpactor"
                    .to_string(),
            working_directory: workspace.to_string(),
            env: Vec::new(),
        }
    }
}
