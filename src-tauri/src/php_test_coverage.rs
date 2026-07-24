use crate::test_run_support::{
    is_executable_file, prepare_result_path_with_extension, ResultFileGuard,
};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const COVERAGE_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_CLOVER_BYTES: u64 = 8 * 1024 * 1024;
const COVERAGE_SUBDIRECTORY: &str = "php-test-coverage";

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PhpCloverCoverageResponse {
    Ok { content: String },
    Missing,
    TooLarge,
    Unavailable { message: String },
    Error { message: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PhpCoverageRunner {
    Artisan,
    PhpUnit(PathBuf),
}

enum CloverRead {
    Content(String),
    Missing,
    TooLarge,
}

pub async fn run_registered(
    root: File,
    app_data_base: PathBuf,
) -> Result<PhpCloverCoverageResponse, String> {
    crate::run_blocking_command(move || {
        let root_path = registered_root_path(&root)?;
        ensure_registered_root_identity(&root, &root_path)?;
        let response = run_at_root(
            &root_path,
            &app_data_base,
            |runner, current_root, output| {
                ensure_registered_root_identity(&root, current_root)?;
                let args = coverage_args(runner, output)?;
                let result = execute_runner_with_timeout(
                    runner_binary(runner),
                    &root,
                    current_root,
                    args,
                    COVERAGE_TIMEOUT,
                );
                ensure_registered_root_identity(&root, current_root)?;
                result
            },
        );
        ensure_registered_root_identity(&root, &root_path)?;
        Ok(response)
    })
    .await
}

fn run_at_root<F>(root: &Path, app_data_base: &Path, execute: F) -> PhpCloverCoverageResponse
where
    F: FnOnce(&PhpCoverageRunner, &Path, &Path) -> Result<(), String>,
{
    let _permit = match super::try_acquire_php_test_run() {
        Ok(permit) => permit,
        Err(()) => {
            return PhpCloverCoverageResponse::Unavailable {
                message: "Another PHP test run is already active.".to_string(),
            };
        }
    };
    let runner = match detect_runner(root) {
        Ok(Some(runner)) => runner,
        Ok(None) => {
            return PhpCloverCoverageResponse::Unavailable {
                message: "No PHP test runner is available in this workspace.".to_string(),
            };
        }
        Err(message) => return PhpCloverCoverageResponse::Error { message },
    };
    let output = match prepare_result_path_with_extension(
        app_data_base,
        COVERAGE_SUBDIRECTORY,
        "PHP test coverage",
        "xml",
    ) {
        Ok(path) => path,
        Err(message) => return PhpCloverCoverageResponse::Error { message },
    };
    let cleanup = ResultFileGuard(output.clone());
    if let Err(message) = ensure_output_outside_workspace(root, &output) {
        return PhpCloverCoverageResponse::Error { message };
    }
    if let Err(message) = execute(&runner, root, &output) {
        return PhpCloverCoverageResponse::Error { message };
    }
    let response = match read_clover_file(&output) {
        Ok(CloverRead::Content(content)) => PhpCloverCoverageResponse::Ok { content },
        Ok(CloverRead::Missing) => PhpCloverCoverageResponse::Missing,
        Ok(CloverRead::TooLarge) => PhpCloverCoverageResponse::TooLarge,
        Err(message) => PhpCloverCoverageResponse::Error { message },
    };
    drop(cleanup);
    response
}

fn detect_runner(root: &Path) -> Result<Option<PhpCoverageRunner>, String> {
    let artisan = root.join("artisan");
    if path_is_regular_nonsymlink(&artisan) {
        return Ok(Some(PhpCoverageRunner::Artisan));
    }
    if fs::symlink_metadata(&artisan).is_ok() {
        return Err("PHP Artisan runner is not a regular workspace file.".to_string());
    }
    let phpunit = root.join("vendor").join("bin").join("phpunit");
    if path_is_regular_nonsymlink(&phpunit) && is_executable_file(&phpunit) {
        return Ok(Some(PhpCoverageRunner::PhpUnit(PathBuf::from(
            "vendor/bin/phpunit",
        ))));
    }
    if fs::symlink_metadata(&phpunit).is_ok() {
        return Err("PHPUnit runner is not a regular executable workspace file.".to_string());
    }
    Ok(None)
}

fn path_is_regular_nonsymlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn runner_binary(runner: &PhpCoverageRunner) -> &Path {
    match runner {
        PhpCoverageRunner::Artisan => Path::new("php"),
        PhpCoverageRunner::PhpUnit(binary) => binary,
    }
}

fn coverage_args(runner: &PhpCoverageRunner, output: &Path) -> Result<Vec<String>, String> {
    let output = output
        .to_str()
        .ok_or_else(|| "PHP coverage output path is not valid UTF-8.".to_string())?
        .to_string();
    Ok(match runner {
        PhpCoverageRunner::Artisan => vec![
            "artisan".to_string(),
            "test".to_string(),
            "--coverage-clover".to_string(),
            output,
            "--no-interaction".to_string(),
        ],
        PhpCoverageRunner::PhpUnit(_) => vec![
            "--coverage-clover".to_string(),
            output,
            "--no-interaction".to_string(),
        ],
    })
}

fn ensure_output_outside_workspace(root: &Path, output: &Path) -> Result<(), String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|_| "Failed to resolve PHP coverage workspace.".to_string())?;
    let parent = output
        .parent()
        .ok_or_else(|| "PHP coverage output has no private parent directory.".to_string())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| "Failed to resolve PHP coverage output directory.".to_string())?;
    if canonical_parent.starts_with(canonical_root) {
        return Err("PHP coverage output must stay outside the workspace.".to_string());
    }
    Ok(())
}

fn read_clover_file(path: &Path) -> Result<CloverRead, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CloverRead::Missing)
        }
        Err(_) => return Err("Failed to inspect PHP Clover report.".to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("PHP Clover report is not a regular private file.".to_string());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "Failed to open PHP Clover report.".to_string())?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| "Failed to inspect opened PHP Clover report.".to_string())?;
    if !opened_metadata.is_file() {
        return Err("PHP Clover report is not a regular private file.".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.dev() != opened_metadata.dev() || metadata.ino() != opened_metadata.ino() {
            return Err("PHP Clover report identity changed before it was opened.".to_string());
        }
    }
    let size = opened_metadata.len();
    if size > MAX_CLOVER_BYTES {
        return Ok(CloverRead::TooLarge);
    }
    let mut bytes = Vec::with_capacity((size as usize).min(64 * 1024));
    file.take(MAX_CLOVER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Failed to read PHP Clover report.".to_string())?;
    if bytes.len() as u64 > MAX_CLOVER_BYTES {
        return Ok(CloverRead::TooLarge);
    }
    if bytes.is_empty() {
        return Ok(CloverRead::Missing);
    }
    String::from_utf8(bytes)
        .map(CloverRead::Content)
        .map_err(|_| "PHP Clover report is not valid UTF-8.".to_string())
}

fn execute_runner_with_timeout(
    binary: &Path,
    root: &File,
    _root_path: &Path,
    args: Vec<String>,
    timeout: Duration,
) -> Result<(), String> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    unsafe {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        let root_fd = root.as_raw_fd();
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
    {
        let _ = root;
        command.current_dir(_root_path);
    }
    #[cfg(unix)]
    fn terminate_and_reap(child: &mut std::process::Child) {
        if let Ok(process_group_id) = i32::try_from(child.id()) {
            // SAFETY: the child was placed in its own process group before exec.
            unsafe {
                libc::kill(-process_group_id, libc::SIGKILL);
            }
        }
        let _ = child.wait();
    }
    #[cfg(not(unix))]
    fn terminate_and_reap(child: &mut std::process::Child) {
        let _ = child.kill();
        let _ = child.wait();
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Failed to start PHP coverage runner.".to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Err(_) => {
                terminate_and_reap(&mut child);
                return Err("Failed to inspect PHP coverage runner.".to_string());
            }
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err("PHP coverage runner failed.".to_string()),
            Ok(None) => {}
        }
        if Instant::now() >= deadline {
            terminate_and_reap(&mut child);
            return Err(format!(
                "PHP coverage runner timed out after {} seconds.",
                timeout.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
fn registered_root_path(root: &File) -> Result<PathBuf, String> {
    crate::workspace_registry::opened_root_path(root)
        .map_err(|_| "Registered PHP coverage workspace is unavailable.".to_string())
}

#[cfg(unix)]
fn ensure_registered_root_identity(root: &File, path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let registered = root
        .metadata()
        .map_err(|_| "Failed to inspect registered PHP coverage workspace.".to_string())?;
    let current = fs::metadata(path)
        .map_err(|_| "Registered PHP coverage workspace path is unavailable.".to_string())?;
    if registered.dev() != current.dev() || registered.ino() != current.ino() {
        return Err("Registered PHP coverage workspace identity changed.".to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn registered_root_path(_root: &File) -> Result<PathBuf, String> {
    Err("Registered PHP coverage workspaces are unsupported on this platform.".to_string())
}

#[cfg(not(unix))]
fn ensure_registered_root_identity(_root: &File, _path: &Path) -> Result<(), String> {
    Err("Registered PHP coverage workspaces are unsupported on this platform.".to_string())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        os::unix::fs::{symlink, PermissionsExt},
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc, Arc, Mutex as StdMutex,
        },
        thread,
    };

    #[test]
    fn runner_arguments_are_fixed() {
        let output = Path::new("/private/coverage.xml");
        assert_eq!(
            coverage_args(&PhpCoverageRunner::Artisan, output).unwrap(),
            [
                "artisan",
                "test",
                "--coverage-clover",
                "/private/coverage.xml",
                "--no-interaction"
            ]
        );
        assert_eq!(
            coverage_args(
                &PhpCoverageRunner::PhpUnit(PathBuf::from("phpunit")),
                output
            )
            .unwrap(),
            [
                "--coverage-clover",
                "/private/coverage.xml",
                "--no-interaction"
            ]
        );
    }

    #[test]
    fn response_variants_have_exact_tagged_wire_shapes() {
        assert_eq!(
            serde_json::to_value(PhpCloverCoverageResponse::Ok {
                content: "<coverage/>".to_string()
            })
            .unwrap(),
            serde_json::json!({"status": "ok", "content": "<coverage/>"})
        );
        assert_eq!(
            serde_json::to_value(PhpCloverCoverageResponse::Missing).unwrap(),
            serde_json::json!({"status": "missing"})
        );
        assert_eq!(
            serde_json::to_value(PhpCloverCoverageResponse::TooLarge).unwrap(),
            serde_json::json!({"status": "tooLarge"})
        );
        assert_eq!(
            serde_json::to_value(PhpCloverCoverageResponse::Unavailable {
                message: "busy".to_string()
            })
            .unwrap(),
            serde_json::json!({"status": "unavailable", "message": "busy"})
        );
        assert_eq!(
            serde_json::to_value(PhpCloverCoverageResponse::Error {
                message: "failed".to_string()
            })
            .unwrap(),
            serde_json::json!({"status": "error", "message": "failed"})
        );
    }

    #[test]
    fn detects_artisan_then_phpunit_and_rejects_runner_symlinks() {
        let root = fixture("detect");
        assert_eq!(detect_runner(&root).unwrap(), None);
        let phpunit = root.join("vendor/bin/phpunit");
        fs::create_dir_all(phpunit.parent().unwrap()).unwrap();
        fs::write(&phpunit, "runner").unwrap();
        fs::set_permissions(&phpunit, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            detect_runner(&root).unwrap(),
            Some(PhpCoverageRunner::PhpUnit(_))
        ));
        fs::write(root.join("artisan"), "artisan").unwrap();
        assert_eq!(
            detect_runner(&root).unwrap(),
            Some(PhpCoverageRunner::Artisan)
        );
        fs::remove_file(root.join("artisan")).unwrap();
        fs::remove_file(&phpunit).unwrap();
        symlink("/bin/true", &phpunit).unwrap();
        assert!(detect_runner(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nofollow_reader_distinguishes_missing_too_large_and_invalid_utf8() {
        let root = fixture("read");
        let report = root.join("coverage.xml");
        assert!(matches!(
            read_clover_file(&report).unwrap(),
            CloverRead::Missing
        ));
        fs::write(&report, []).unwrap();
        assert!(matches!(
            read_clover_file(&report).unwrap(),
            CloverRead::Missing
        ));
        fs::write(&report, vec![b'x'; MAX_CLOVER_BYTES as usize + 1]).unwrap();
        assert!(matches!(
            read_clover_file(&report).unwrap(),
            CloverRead::TooLarge
        ));
        fs::write(&report, [0xff]).unwrap();
        assert!(read_clover_file(&report).is_err());
        fs::remove_file(&report).unwrap();
        let outside = root.join("outside.xml");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, &report).unwrap();
        assert!(read_clover_file(&report).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_private_report_on_every_result_path() {
        let _serial = super::super::PHP_TEST_RUN_TEST_SERIAL.lock().unwrap();
        let root = runner_fixture("cleanup");
        let app_data = root.with_extension("app-data");
        let observed = Arc::new(StdMutex::new(None::<PathBuf>));
        let captured = Arc::clone(&observed);
        let response = run_at_root(&root, &app_data, move |_runner, _root, output| {
            *captured.lock().unwrap() = Some(output.to_path_buf());
            fs::write(output, "<coverage/>").unwrap();
            Ok(())
        });
        assert!(matches!(response, PhpCloverCoverageResponse::Ok { .. }));
        assert!(!observed.lock().unwrap().as_ref().unwrap().exists());

        let failed = Arc::new(StdMutex::new(None::<PathBuf>));
        let captured = Arc::clone(&failed);
        let response = run_at_root(&root, &app_data, move |_runner, _root, output| {
            *captured.lock().unwrap() = Some(output.to_path_buf());
            fs::write(output, "partial").unwrap();
            Err("runner failed".to_string())
        });
        assert!(matches!(response, PhpCloverCoverageResponse::Error { .. }));
        assert!(!failed.lock().unwrap().as_ref().unwrap().exists());

        let missing = Arc::new(StdMutex::new(None::<PathBuf>));
        let captured = Arc::clone(&missing);
        let response = run_at_root(&root, &app_data, move |_runner, _root, output| {
            *captured.lock().unwrap() = Some(output.to_path_buf());
            Ok(())
        });
        assert_eq!(response, PhpCloverCoverageResponse::Missing);
        assert!(!missing.lock().unwrap().as_ref().unwrap().exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(app_data).unwrap();
    }

    #[test]
    fn rejects_concurrency_and_output_inside_workspace() {
        let _serial = super::super::PHP_TEST_RUN_TEST_SERIAL.lock().unwrap();
        let root = runner_fixture("lease");
        let _held = super::super::try_acquire_php_test_run().unwrap();
        assert!(matches!(
            run_at_root(&root, root.parent().unwrap(), |_runner, _root, _output| Ok(
                ()
            )),
            PhpCloverCoverageResponse::Unavailable { .. }
        ));
        drop(_held);
        assert!(ensure_output_outside_workspace(&root, &root.join("private/report.xml")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_junit_run_blocks_clover_coverage() {
        let _serial = super::super::PHP_TEST_RUN_TEST_SERIAL.lock().unwrap();
        let junit_root = runner_fixture("junit-holds-admission");
        let junit_app_data = junit_root.with_extension("junit-app-data");
        let junit_app_data_for_thread = junit_app_data.clone();
        let junit_root_string = junit_root.to_string_lossy().into_owned();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let junit = thread::spawn(move || {
            super::super::run_php_tests_blocking_admitted_with(
                &junit_root_string,
                &junit_app_data_for_thread,
                None,
                move |_runner, _root, output, _filter| {
                    entered_tx.send(()).unwrap();
                    let _ = release_rx.recv();
                    fs::write(output, "<testsuite/>").unwrap();
                    Ok(Vec::new())
                },
            )
        });
        entered_rx.recv().unwrap();

        let coverage_root = runner_fixture("junit-blocks-coverage");
        let coverage_app_data = coverage_root.with_extension("coverage-app-data");
        let response = run_at_root(
            &coverage_root,
            &coverage_app_data,
            |_runner, _root, _output| panic!("coverage runner must not execute"),
        );
        assert!(matches!(
            response,
            PhpCloverCoverageResponse::Unavailable { .. }
        ));

        release_tx.send(()).unwrap();
        assert!(matches!(
            junit.join().unwrap(),
            super::super::PhpTestRunResponse::Ok { .. }
        ));
        fs::remove_dir_all(junit_root).unwrap();
        fs::remove_dir_all(junit_app_data).unwrap();
        fs::remove_dir_all(coverage_root).unwrap();
        fs::remove_dir_all(coverage_app_data).ok();
    }

    #[test]
    fn active_clover_coverage_blocks_junit_run() {
        let _serial = super::super::PHP_TEST_RUN_TEST_SERIAL.lock().unwrap();
        let coverage_root = runner_fixture("coverage-holds-admission");
        let coverage_app_data = coverage_root.with_extension("coverage-holder-app-data");
        let coverage_root_for_thread = coverage_root.clone();
        let coverage_app_data_for_thread = coverage_app_data.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let coverage = thread::spawn(move || {
            run_at_root(
                &coverage_root_for_thread,
                &coverage_app_data_for_thread,
                move |_runner, _root, output| {
                    entered_tx.send(()).unwrap();
                    let _ = release_rx.recv();
                    fs::write(output, "<coverage/>").unwrap();
                    Ok(())
                },
            )
        });
        entered_rx.recv().unwrap();

        let junit_root = runner_fixture("coverage-blocks-junit");
        let junit_app_data = junit_root.with_extension("blocked-junit-app-data");
        let response = super::super::run_php_tests_blocking_admitted_with(
            junit_root.to_str().unwrap(),
            &junit_app_data,
            None,
            |_runner, _root, _output, _filter| panic!("JUnit runner must not execute"),
        );
        assert!(matches!(
            response,
            super::super::PhpTestRunResponse::Unavailable { .. }
        ));

        release_tx.send(()).unwrap();
        assert!(matches!(
            coverage.join().unwrap(),
            PhpCloverCoverageResponse::Ok { .. }
        ));
        fs::remove_dir_all(coverage_root).unwrap();
        fs::remove_dir_all(coverage_app_data).unwrap();
        fs::remove_dir_all(junit_root).unwrap();
    }

    #[test]
    fn bounded_execution_times_out_and_reaps_the_process() {
        let root = fixture("timeout");
        let root_fd = File::open(&root).unwrap();
        let result = execute_runner_with_timeout(
            Path::new("/bin/sleep"),
            &root_fd,
            &root,
            vec!["2".to_string()],
            Duration::from_millis(10),
        );
        assert!(result.unwrap_err().contains("timed out"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registered_execution_stays_bound_to_the_retained_directory_fd() {
        let root = fixture("retained-cwd");
        let retained = root.with_extension("retained");
        let output = root.with_extension("observed");
        fs::write(root.join("marker"), "retained").unwrap();
        let root_fd = File::open(&root).unwrap();
        fs::rename(&root, &retained).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("marker"), "replacement").unwrap();

        execute_runner_with_timeout(
            Path::new("/bin/sh"),
            &root_fd,
            &root,
            vec![
                "-c".to_string(),
                "cat marker > \"$1\"".to_string(),
                "php-coverage-cwd-test".to_string(),
                output.to_string_lossy().into_owned(),
            ],
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&output).unwrap(), "retained");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(retained).unwrap();
        fs::remove_file(output).unwrap();
    }

    fn runner_fixture(label: &str) -> PathBuf {
        let root = fixture(label);
        fs::write(root.join("artisan"), "artisan").unwrap();
        root
    }

    fn fixture(label: &str) -> PathBuf {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "mockor-php-coverage-{label}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
