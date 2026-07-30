#![cfg(all(unix, not(target_os = "solaris")))]

use crate::ensure_lsp_position_in_workspace;
use crate::lsp::{
    file_uri, InitializeRequestFactory, JsonRpcNotification, LanguageServerCommand,
    TypeScriptInitializeRequestFactory,
};
use crate::lsp_diagnostics::LanguageServerDiagnosticEvent;
use crate::lsp_features::TextDocumentPosition;
use crate::lsp_session::{
    ChildServerProcessSpawner, DiagnosticsSink, JavaScriptTypeScriptLanguageServerRegistry,
    LanguageServerRuntimeStatus, StatusSink,
};
use crate::managed_javascript_typescript::node_executable_path;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError};
use std::time::{Duration, Instant, SystemTime};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
const REAL_SERVER_LOCK_TIMEOUT: Duration = Duration::from_secs(60);
static REAL_SERVER_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct StatusChannel(Mutex<Sender<LanguageServerRuntimeStatus>>);

impl StatusChannel {
    fn new() -> Arc<Self> {
        let (sender, _receiver) = mpsc::channel();
        Arc::new(Self(Mutex::new(sender)))
    }
}

impl StatusSink for StatusChannel {
    fn emit_status(&self, status: LanguageServerRuntimeStatus) {
        if let Ok(sender) = self.0.lock() {
            let _ = sender.send(status);
        }
    }
}

struct DiagnosticsChannel(Mutex<Sender<LanguageServerDiagnosticEvent>>);

impl DiagnosticsChannel {
    fn new() -> (Arc<Self>, Receiver<LanguageServerDiagnosticEvent>) {
        let (sender, receiver) = mpsc::channel();
        (Arc::new(Self(Mutex::new(sender))), receiver)
    }
}

impl DiagnosticsSink for DiagnosticsChannel {
    fn emit_diagnostics(&self, event: LanguageServerDiagnosticEvent) {
        if let Ok(sender) = self.0.lock() {
            let _ = sender.send(event);
        }
    }
}

struct TempWorkspace(PathBuf);

impl TempWorkspace {
    fn new(label: &str) -> Self {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codevo-{label}-{suffix}"));
        fs::create_dir_all(&root).expect("create integration workspace");
        Self(
            root.canonicalize()
                .expect("canonical integration workspace"),
        )
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct RunningRegistry<'a> {
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    root: String,
}

impl Drop for RunningRegistry<'_> {
    fn drop(&mut self) {
        self.registry.stop(&self.root);
    }
}

#[cfg(unix)]
#[test]
fn real_typescript_server_keeps_project_reference_intelligence_inside_workspace() {
    let _serial = lock_real_server_tests();
    let Some(runtime) = real_typescript_runtime() else {
        eprintln!(
            "skipping real TypeScript integration: Node, typescript-language-server, or tsserver is unavailable"
        );
        return;
    };

    let workspace = TempWorkspace::new("typescript-project-references");
    let outside = TempWorkspace::new("typescript-outside-root");
    let fixture = write_project_reference_fixture(&workspace.0);
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let (diagnostics_sink, diagnostics_receiver) = DiagnosticsChannel::new();
    let root = workspace.0.to_string_lossy().to_string();
    let _running = start_real_session(&registry, &root, &runtime, diagnostics_sink);

    open_document(
        &registry,
        &root,
        &fixture.package_a,
        &fixture.package_a_source,
    );
    open_document(
        &registry,
        &root,
        &fixture.package_b,
        &fixture.package_b_source,
    );
    assert!(fixture
        .package_b_source
        .contains("from \"@codevo/package-a\""));
    assert!(!fixture.package_b_source.contains("../package-a"));

    let referenced_definition = request(
        &registry,
        &root,
        "textDocument/typeDefinition",
        position_params(
            &fixture.package_b,
            position_after_last(&fixture.package_b_source, "alphaValue"),
        ),
    );
    let definition_uris = location_uris(&referenced_definition);
    assert!(
        definition_uris
            .iter()
            .any(|uri| uri == &file_uri(&fixture.package_a)),
        "project-reference source redirect should resolve into package A source: {referenced_definition:#}"
    );
    assert!(
        definition_uris
            .iter()
            .all(|uri| uri.starts_with(&file_uri(&workspace.0))),
        "definition leaked outside the active monorepo: {definition_uris:?}"
    );
    open_document(&registry, &root, &fixture.control, &fixture.control_source);
    let control_definition = request(
        &registry,
        &root,
        "textDocument/typeDefinition",
        position_params(
            &fixture.control,
            position_after_last(&fixture.control_source, "alphaValue"),
        ),
    );
    assert_eq!(
        location_uris(&control_definition),
        vec![file_uri(&fixture.package_a_declaration)],
        "the no-reference control must resolve through published declarations, not source redirect"
    );

    let alpha_completion = completion_labels(request(
        &registry,
        &root,
        "textDocument/completion",
        position_params(
            &fixture.package_b,
            position_after(&fixture.package_b_source, "alphaValue."),
        ),
    ));
    assert!(alpha_completion.iter().any(|label| label == "alphaMember"));
    assert!(!alpha_completion.iter().any(|label| label == "betaMember"));

    let beta_completion = completion_labels(request(
        &registry,
        &root,
        "textDocument/completion",
        position_params(
            &fixture.package_b,
            position_after(&fixture.package_b_source, "betaValue."),
        ),
    ));
    assert!(beta_completion.iter().any(|label| label == "betaMember"));
    assert!(!beta_completion.iter().any(|label| label == "alphaMember"));

    let package_b_uri = file_uri(&fixture.package_b);
    let (diagnostic, observed_diagnostics) =
        wait_for_diagnostic(&diagnostics_receiver, &package_b_uri);
    assert!(
        diagnostic
            .diagnostics
            .iter()
            .any(|item| item.message.contains("not assignable to type 'number'")),
        "expected the real tsserver type error for package B: {diagnostic:?}"
    );
    assert_eq!(diagnostic.uri, package_b_uri);
    assert!(diagnostic.uri.starts_with(&file_uri(&workspace.0)));
    assert!(
        observed_diagnostics
            .iter()
            .all(|event| event.uri.starts_with(&file_uri(&workspace.0))),
        "diagnostics leaked outside the active workspace: {observed_diagnostics:?}"
    );
    assert!(
        observed_diagnostics
            .iter()
            .filter(|event| event.uri == file_uri(&fixture.package_a))
            .all(|event| event.diagnostics.is_empty()),
        "clean package A received package B diagnostics: {observed_diagnostics:?}"
    );

    let outside_file = outside.0.join("foreign.ts");
    fs::write(&outside_file, "export const foreign = true;\n").expect("write outside file");
    let rejected = ensure_lsp_position_in_workspace(
        &root,
        &TextDocumentPosition {
            path: outside_file.to_string_lossy().to_string(),
            line: 0,
            character: 0,
        },
    );
    assert!(
        rejected.is_err(),
        "the command boundary must reject a document from a sibling workspace"
    );
}

#[cfg(unix)]
#[test]
fn real_typescript_server_honors_nearest_extended_config_for_typescript_and_javascript() {
    let _serial = lock_real_server_tests();
    let Some(runtime) = real_typescript_runtime() else {
        eprintln!(
            "skipping real TypeScript integration: Node, typescript-language-server, or tsserver is unavailable"
        );
        return;
    };

    let workspace = TempWorkspace::new("typescript-extended-nearest-config");
    let fixture = write_extended_config_fixture(&workspace.0);
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let (diagnostics_sink, diagnostics_receiver) = DiagnosticsChannel::new();
    let root = workspace.0.to_string_lossy().to_string();
    let _running = start_real_session(&registry, &root, &runtime, diagnostics_sink);

    open_document(
        &registry,
        &root,
        &fixture.consumer,
        &fixture.consumer_source,
    );
    open_document(&registry, &root, &fixture.direct, &fixture.direct_source);
    open_document(&registry, &root, &fixture.barrel, &fixture.barrel_source);
    open_document(
        &registry,
        &root,
        &fixture.reexported,
        &fixture.reexported_source,
    );
    open_document(
        &registry,
        &root,
        &fixture.relative,
        &fixture.relative_source,
    );
    open_javascript_document(
        &registry,
        &root,
        &fixture.checked_javascript,
        &fixture.checked_javascript_source,
    );
    let checked_uri = file_uri(&fixture.checked_javascript);
    let (checked_diagnostic, checked_observed_diagnostics) =
        wait_for_diagnostic(&diagnostics_receiver, &checked_uri);

    assert_definition_resolves_to(
        &registry,
        &root,
        &fixture.consumer,
        &fixture.consumer_source,
        "directValue.directMember",
        &fixture.direct,
    );
    assert_definition_resolves_to(
        &registry,
        &root,
        &fixture.consumer,
        &fixture.consumer_source,
        "reexportedValue.reexportedMember",
        &fixture.reexported,
    );
    assert_definition_resolves_to(
        &registry,
        &root,
        &fixture.consumer,
        &fixture.consumer_source,
        "relativeValue.relativeMember",
        &fixture.relative,
    );

    let member_completion = request(
        &registry,
        &root,
        "textDocument/completion",
        position_params(
            &fixture.consumer,
            position_after(&fixture.consumer_source, "directValue."),
        ),
    );
    let direct_member = completion_items(member_completion)
        .into_iter()
        .find(|item| item.get("label").and_then(Value::as_str) == Some("directMember"))
        .unwrap_or_else(|| panic!("real completion must offer directMember"));
    let resolved_member = request(&registry, &root, "completionItem/resolve", direct_member);
    assert_eq!(
        resolved_member.get("label").and_then(Value::as_str),
        Some("directMember"),
        "completion resolve must retain the selected real server item"
    );

    let direct_usage = position_after_last(&fixture.consumer_source, "directValue");
    let references = request(
        &registry,
        &root,
        "textDocument/references",
        json!({
            "textDocument": { "uri": file_uri(&fixture.consumer) },
            "position": { "line": direct_usage.0, "character": direct_usage.1 },
            "context": { "includeDeclaration": true },
        }),
    );
    let reference_uris = location_uris(&references);
    assert!(
        reference_uris.contains(&file_uri(&fixture.direct))
            && reference_uris.contains(&file_uri(&fixture.consumer)),
        "references must include the aliased declaration and consumer: {references:#}"
    );
    assert!(
        reference_uris
            .iter()
            .all(|uri| uri.starts_with(&file_uri(&workspace.0))),
        "references leaked outside the active workspace: {reference_uris:?}"
    );

    let direct_declaration = position_after(&fixture.direct_source, "directValue");
    let rename = request(
        &registry,
        &root,
        "textDocument/rename",
        json!({
            "textDocument": { "uri": file_uri(&fixture.direct) },
            "position": {
                "line": direct_declaration.0,
                "character": direct_declaration.1,
            },
            "newName": "renamedDirectValue",
        }),
    );
    let rename_uris = workspace_edit_uris(&rename);
    assert!(
        rename_uris.contains(&file_uri(&fixture.direct))
            && rename_uris.contains(&file_uri(&fixture.consumer)),
        "rename must edit the aliased declaration and consumer: {rename:#}"
    );
    assert!(
        rename_uris
            .iter()
            .all(|uri| uri.starts_with(&file_uri(&workspace.0))),
        "rename leaked outside the active workspace: {rename_uris:?}"
    );

    open_document(
        &registry,
        &root,
        &fixture.unresolved_import,
        &fixture.unresolved_import_source,
    );
    let unresolved_uri = file_uri(&fixture.unresolved_import);
    let (unresolved_diagnostic, _) = wait_for_diagnostic(&diagnostics_receiver, &unresolved_uri);
    let unresolved_diagnostics = diagnostics_as_lsp_values(&unresolved_diagnostic);
    let code_actions = request(
        &registry,
        &root,
        "textDocument/codeAction",
        json!({
            "textDocument": { "uri": unresolved_uri },
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 11 },
            },
            "context": {
                "diagnostics": unresolved_diagnostics,
                "only": ["quickfix"],
            },
        }),
    );
    let import_action = code_actions
        .as_array()
        .and_then(|actions| {
            actions.iter().find(|action| {
                action
                    .get("title")
                    .and_then(Value::as_str)
                    .is_some_and(|title| title.to_ascii_lowercase().contains("import"))
            })
        })
        .unwrap_or_else(|| {
            panic!("missing import must produce a real quick-fix code action: {code_actions:#}")
        });
    let import_edit = import_action
        .get("edit")
        .unwrap_or_else(|| panic!("missing-import quick fix must carry a workspace edit"));
    assert_eq!(
        workspace_edit_uris(import_edit),
        vec![file_uri(&fixture.unresolved_import)],
        "the auto-import edit must target only the unresolved document"
    );
    assert!(
        import_edit.to_string().contains("directValue"),
        "the real auto-import edit must insert the missing symbol: {import_edit:#}"
    );

    assert!(
        checked_diagnostic
            .diagnostics
            .iter()
            .any(|item| item.message.contains("not assignable to type 'number'")),
        "the nearest config must enable allowJs/checkJs for its JavaScript source: {checked_diagnostic:?}"
    );
    assert!(
        checked_observed_diagnostics
            .iter()
            .all(|event| event.uri.starts_with(&file_uri(&workspace.0))),
        "extended-config diagnostics leaked outside the active workspace: {checked_observed_diagnostics:?}"
    );
}

#[cfg(unix)]
#[test]
fn real_typescript_server_keeps_parallel_workspace_sessions_isolated() {
    let _serial = lock_real_server_tests();
    let Some(runtime) = real_typescript_runtime() else {
        eprintln!(
            "skipping real TypeScript integration: Node, typescript-language-server, or tsserver is unavailable"
        );
        return;
    };

    let workspace_a = TempWorkspace::new("typescript-parallel-a");
    let workspace_b = TempWorkspace::new("typescript-parallel-b");
    let fixture_a = write_project_reference_fixture(&workspace_a.0);
    let fixture_b = write_project_reference_fixture(&workspace_b.0);
    let root_a = workspace_a.0.to_string_lossy().to_string();
    let root_b = workspace_b.0.to_string_lossy().to_string();
    let registry = JavaScriptTypeScriptLanguageServerRegistry::new();
    let (diagnostics_a, receiver_a) = DiagnosticsChannel::new();
    let (diagnostics_b, receiver_b) = DiagnosticsChannel::new();
    let _running_a = start_real_session(&registry, &root_a, &runtime, diagnostics_a);
    let _running_b = start_real_session(&registry, &root_b, &runtime, diagnostics_b);

    assert_eq!(
        registry.running_roots(),
        vec![root_a.clone(), root_b.clone()]
    );
    assert_ne!(
        registry.pid(&root_a),
        registry.pid(&root_b),
        "parallel roots must own distinct language-server processes"
    );

    open_document(
        &registry,
        &root_a,
        &fixture_a.package_a,
        &fixture_a.package_a_source,
    );
    open_document(
        &registry,
        &root_a,
        &fixture_a.package_b,
        &fixture_a.package_b_source,
    );
    open_document(
        &registry,
        &root_b,
        &fixture_b.package_a,
        &fixture_b.package_a_source,
    );
    open_document(
        &registry,
        &root_b,
        &fixture_b.package_b,
        &fixture_b.package_b_source,
    );

    let response_a = request(
        &registry,
        &root_a,
        "textDocument/typeDefinition",
        position_params(
            &fixture_a.package_b,
            position_after_last(&fixture_a.package_b_source, "alphaValue"),
        ),
    );
    let response_b = request(
        &registry,
        &root_b,
        "textDocument/typeDefinition",
        position_params(
            &fixture_b.package_b,
            position_after_last(&fixture_b.package_b_source, "alphaValue"),
        ),
    );
    assert_eq!(
        location_uris(&response_a),
        vec![file_uri(&fixture_a.package_a)]
    );
    assert_eq!(
        location_uris(&response_b),
        vec![file_uri(&fixture_b.package_a)]
    );
    assert!(location_uris(&response_a)
        .iter()
        .all(|uri| !uri.starts_with(&file_uri(&workspace_b.0))));
    assert!(location_uris(&response_b)
        .iter()
        .all(|uri| !uri.starts_with(&file_uri(&workspace_a.0))));

    let (event_a, observed_a) = wait_for_diagnostic(&receiver_a, &file_uri(&fixture_a.package_b));
    let (event_b, observed_b) = wait_for_diagnostic(&receiver_b, &file_uri(&fixture_b.package_b));
    assert!(event_a.uri.starts_with(&file_uri(&workspace_a.0)));
    assert!(event_b.uri.starts_with(&file_uri(&workspace_b.0)));
    assert!(observed_a
        .iter()
        .all(|event| event.uri.starts_with(&file_uri(&workspace_a.0))));
    assert!(observed_b
        .iter()
        .all(|event| event.uri.starts_with(&file_uri(&workspace_b.0))));
}

// This is cooperative admission between test processes owned by the same user,
// not a security boundary against a hostile same-UID process (which could also
// signal or kill the tests). The private directory, no-follow opens, link checks,
// and post-flock identity verification reject stale/preinstalled entries and
// replacement races that overlap acquisition. They cannot prevent an authorized
// same-UID process from replacing a path after the final identity check.
struct RealServerTestGuard {
    _thread_guard: MutexGuard<'static, ()>,
    _lock_directory: File,
    process_lock: File,
}

impl Drop for RealServerTestGuard {
    fn drop(&mut self) {
        let _ = self.process_lock.set_len(0);
        // SAFETY: `process_lock` owns this live file descriptor for the full
        // lifetime of the advisory lock. Unlocking it cannot invalidate the
        // descriptor, and the kernel also releases the lock if this process dies.
        let _ = unsafe { libc::flock(self.process_lock.as_raw_fd(), libc::LOCK_UN) };
    }
}

fn lock_real_server_tests() -> RealServerTestGuard {
    let deadline = Instant::now() + REAL_SERVER_LOCK_TIMEOUT;
    let thread_lock = REAL_SERVER_TEST_LOCK.get_or_init(|| Mutex::new(()));
    let thread_guard = loop {
        match thread_lock.try_lock() {
            Ok(guard) => break guard,
            Err(TryLockError::Poisoned(poisoned)) => break poisoned.into_inner(),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(TryLockError::WouldBlock) => {
                panic!(
                    "timed out after {}s waiting for the in-process real TypeScript test lock",
                    REAL_SERVER_LOCK_TIMEOUT.as_secs()
                );
            }
        }
    };
    // SAFETY: `getuid` has no preconditions and does not access memory.
    let current_uid = unsafe { libc::getuid() };
    let lock_directory_path =
        std::env::temp_dir().join(format!("codevo-editor-real-test-locks-{current_uid}"));
    let (lock_directory, mut process_lock) =
        acquire_process_lock(&lock_directory_path, current_uid, deadline);

    process_lock
        .set_len(0)
        .expect("truncate real TypeScript test lock metadata");
    process_lock
        .seek(SeekFrom::Start(0))
        .expect("seek real TypeScript test lock metadata");
    writeln!(
        process_lock,
        "pid={}, manifest={}",
        std::process::id(),
        env!("CARGO_MANIFEST_DIR")
    )
    .expect("write real TypeScript test lock metadata");
    process_lock
        .flush()
        .expect("flush real TypeScript test lock metadata");

    RealServerTestGuard {
        _thread_guard: thread_guard,
        _lock_directory: lock_directory,
        process_lock,
    }
}

fn acquire_process_lock(
    lock_directory_path: &Path,
    current_uid: u32,
    deadline: Instant,
) -> (File, File) {
    loop {
        let lock_directory = open_private_lock_directory(lock_directory_path, current_uid);
        let lock_path = lock_directory_path.join("typescript-server.lock");
        let mut process_lock = open_process_lock(&lock_path, current_uid);

        // SAFETY: `process_lock` remains alive in the returned guard. `flock`
        // only operates on its valid file descriptor and does not take ownership.
        let result =
            unsafe { libc::flock(process_lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result == 0 {
            if paths_still_name_locked_files(
                &lock_directory,
                lock_directory_path,
                &process_lock,
                &lock_path,
                current_uid,
            ) {
                return (lock_directory, process_lock);
            }

            // The directory or lockfile was replaced between open and flock.
            // Release the old inode before retrying through the authoritative paths.
            // SAFETY: the descriptor is valid and remains owned by `process_lock`.
            let _ = unsafe { libc::flock(process_lock.as_raw_fd(), libc::LOCK_UN) };
        } else {
            let error = std::io::Error::last_os_error();
            let retryable = matches!(
                error.kind(),
                std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
            );
            if !retryable {
                panic!(
                    "failed to acquire real TypeScript test lock {}: {error}",
                    lock_path.display()
                );
            }
            if Instant::now() >= deadline {
                panic_lock_timeout(&mut process_lock, &lock_path);
            }
        }

        if Instant::now() >= deadline {
            panic!(
                "timed out after {}s retrying replaced real TypeScript test lock {}",
                REAL_SERVER_LOCK_TIMEOUT.as_secs(),
                lock_path.display()
            );
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn open_private_lock_directory(path: &Path, current_uid: u32) -> File {
    let create_result = fs::DirBuilder::new().mode(0o700).create(path);
    if let Err(error) = create_result {
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::AlreadyExists,
            "failed to create private real TypeScript test lock directory {}: {error}",
            path.display()
        );
    }

    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .unwrap_or_else(|error| {
            panic!(
                "failed to open private real TypeScript test lock directory {}: {error}",
                path.display()
            )
        });
    let metadata = directory.metadata().unwrap_or_else(|error| {
        panic!(
            "failed to inspect private real TypeScript test lock directory {}: {error}",
            path.display()
        )
    });
    assert!(
        metadata.file_type().is_dir() && metadata.uid() == current_uid,
        "real TypeScript test lock directory must be owned by uid {current_uid}: {}",
        path.display()
    );
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o700);
    directory
        .set_permissions(permissions)
        .unwrap_or_else(|error| {
            panic!(
                "failed to restrict real TypeScript test lock directory {}: {error}",
                path.display()
            )
        });
    directory
}

fn open_process_lock(path: &Path, current_uid: u32) -> File {
    let process_lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .unwrap_or_else(|error| {
            panic!(
                "failed to open real TypeScript test lock {}: {error}",
                path.display()
            )
        });
    let metadata = process_lock.metadata().unwrap_or_else(|error| {
        panic!(
            "failed to inspect real TypeScript test lock {}: {error}",
            path.display()
        )
    });
    assert!(
        metadata.file_type().is_file()
            && metadata.uid() == current_uid
            && metadata.nlink() == 1,
        "real TypeScript test lock must be a regular, singly-linked file owned by uid {current_uid}: {}",
        path.display()
    );
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o600);
    process_lock
        .set_permissions(permissions)
        .unwrap_or_else(|error| {
            panic!(
                "failed to restrict real TypeScript test lock {}: {error}",
                path.display()
            )
        });
    process_lock
}

fn paths_still_name_locked_files(
    lock_directory: &File,
    lock_directory_path: &Path,
    process_lock: &File,
    lock_path: &Path,
    current_uid: u32,
) -> bool {
    file_matches_path(lock_directory, lock_directory_path, current_uid, false)
        && file_matches_path(process_lock, lock_path, current_uid, true)
}

fn file_matches_path(
    file: &File,
    path: &Path,
    current_uid: u32,
    require_single_link: bool,
) -> bool {
    let Ok(file_metadata) = file.metadata() else {
        return false;
    };
    let Ok(path_metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    let same_kind = (file_metadata.file_type().is_file() && path_metadata.file_type().is_file())
        || (file_metadata.file_type().is_dir() && path_metadata.file_type().is_dir());
    same_kind
        && file_metadata.uid() == current_uid
        && path_metadata.uid() == current_uid
        && (!require_single_link || (file_metadata.nlink() == 1 && path_metadata.nlink() == 1))
        && file_metadata.dev() == path_metadata.dev()
        && file_metadata.ino() == path_metadata.ino()
}

fn panic_lock_timeout(process_lock: &mut File, lock_path: &Path) -> ! {
    let mut owner = String::new();
    let owner = process_lock
        .seek(SeekFrom::Start(0))
        .ok()
        .and_then(|_| {
            Read::by_ref(process_lock)
                .take(512)
                .read_to_string(&mut owner)
                .ok()
        })
        .map(|_| owner)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown owner".to_string());
    panic!(
        "timed out after {}s waiting for real TypeScript test lock {} ({})",
        REAL_SERVER_LOCK_TIMEOUT.as_secs(),
        lock_path.display(),
        owner.trim()
    );
}

struct TypeScriptRuntime {
    node: PathBuf,
    server: PathBuf,
    tsserver: PathBuf,
}

fn start_real_session<'a>(
    registry: &'a JavaScriptTypeScriptLanguageServerRegistry,
    root: &str,
    runtime: &TypeScriptRuntime,
    diagnostics_sink: Arc<dyn DiagnosticsSink>,
) -> RunningRegistry<'a> {
    let mut initialize_request = TypeScriptInitializeRequestFactory.create(Path::new(root));
    initialize_request.params["initializationOptions"]["tsserver"]["path"] =
        Value::String(runtime.tsserver.to_string_lossy().to_string());
    let command = LanguageServerCommand {
        executable: runtime.node.to_string_lossy().to_string(),
        args: vec![
            runtime.server.to_string_lossy().to_string(),
            "--stdio".to_string(),
        ],
        working_directory: root.to_string(),
        env: Vec::new(),
    };
    let status = registry
        .start(
            root,
            &command,
            &initialize_request,
            &ChildServerProcessSpawner,
            StatusChannel::new(),
            diagnostics_sink,
        )
        .expect("start real typescript-language-server");
    assert!(
        matches!(status, LanguageServerRuntimeStatus::Running { .. }),
        "real TypeScript language server did not reach Running: {status:?}"
    );
    RunningRegistry {
        registry,
        root: root.to_string(),
    }
}

fn real_typescript_runtime() -> Option<TypeScriptRuntime> {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .to_path_buf();
    let server = repository.join("node_modules/typescript-language-server/lib/cli.mjs");
    let tsserver = repository.join("node_modules/typescript/lib/tsserver.js");
    let node = PathBuf::from(node_executable_path()?);

    if !server.is_file() || !tsserver.is_file() {
        if std::env::var_os("CI").is_some() {
            panic!("real TypeScript integration runtime is missing; run npm ci before cargo test");
        }
        return None;
    }

    assert_supported_node(&node);
    Some(TypeScriptRuntime {
        node,
        server,
        tsserver,
    })
}

fn assert_supported_node(node: &Path) {
    let mut child = Command::new(node)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("found Node executable could not start: {error}"));
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("found Node executable timed out during version probe");
            }
            Err(error) => panic!("found Node executable version probe failed: {error}"),
        }
    };
    assert!(
        status.success(),
        "found Node executable returned a non-zero status during version probe: {status}"
    );
    let mut stdout = Vec::new();
    child
        .stdout
        .take()
        .expect("Node version stdout")
        .read_to_end(&mut stdout)
        .expect("read Node version stdout");
    let version = String::from_utf8(stdout).expect("Node version must be UTF-8");
    let major = version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_else(|| panic!("found Node executable returned invalid version: {version:?}"));
    assert!(
        major >= 20,
        "Node.js 20 or newer is required, found {version:?}"
    );
}

struct ProjectReferenceFixture {
    package_a: PathBuf,
    package_a_declaration: PathBuf,
    package_b: PathBuf,
    control: PathBuf,
    package_a_source: String,
    package_b_source: String,
    control_source: String,
}

struct ExtendedConfigFixture {
    barrel: PathBuf,
    checked_javascript: PathBuf,
    consumer: PathBuf,
    direct: PathBuf,
    reexported: PathBuf,
    relative: PathBuf,
    unresolved_import: PathBuf,
    barrel_source: String,
    checked_javascript_source: String,
    consumer_source: String,
    direct_source: String,
    reexported_source: String,
    relative_source: String,
    unresolved_import_source: String,
}

fn write_extended_config_fixture(root: &Path) -> ExtendedConfigFixture {
    let app_source_root = root.join("apps/api/src");
    let core_root = root.join("shared/core");
    let barrel_root = root.join("shared/barrel");
    fs::create_dir_all(&app_source_root).expect("create nested application source");
    fs::create_dir_all(&core_root).expect("create aliased core source");
    fs::create_dir_all(&barrel_root).expect("create barrel source");

    fs::write(
        root.join("tsconfig.base.json"),
        r#"{
  "compilerOptions": {
    "baseUrl": ".",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "paths": {
      "@core/*": ["shared/core/*"],
      "@barrel": ["shared/barrel/index.ts"]
    },
    "strict": true,
    "target": "ES2022"
  }
}
"#,
    )
    .expect("write base tsconfig");
    fs::write(
        root.join("tsconfig.json"),
        r#"{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "allowJs": false,
    "checkJs": false
  },
  "files": []
}
"#,
    )
    .expect("write root tsconfig control");
    fs::write(
        root.join("apps/api/tsconfig.json"),
        r#"{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
"#,
    )
    .expect("write nearest application tsconfig");

    let direct_source =
        "export const directValue = { directMember: \"direct\" } as const;\n".to_string();
    let reexported_source =
        "export const reexportedValue = { reexportedMember: \"barrel\" } as const;\n".to_string();
    let barrel_source = "export { reexportedValue } from \"./reexported.js\";\n".to_string();
    let relative_source =
        "export const relativeValue = { relativeMember: \"relative\" } as const;\n".to_string();
    let consumer_source = r#"import { directValue } from "@core/direct";
import { reexportedValue } from "@barrel";
import { relativeValue } from "./relative.js";

directValue.directMember;
reexportedValue.reexportedMember;
relativeValue.relativeMember;
"#
    .to_string();
    let checked_javascript_source =
        "/** @type {number} */\nconst checkedValue = \"wrong\";\ncheckedValue;\n".to_string();
    let unresolved_import_source = "directValue.directMember;\n".to_string();

    let direct = core_root.join("direct.ts");
    let reexported = barrel_root.join("reexported.ts");
    let barrel = barrel_root.join("index.ts");
    let relative = app_source_root.join("relative.ts");
    let consumer = app_source_root.join("consumer.ts");
    let checked_javascript = app_source_root.join("checked.js");
    let unresolved_import = app_source_root.join("unresolved-import.ts");
    fs::write(&direct, &direct_source).expect("write directly aliased source");
    fs::write(&reexported, &reexported_source).expect("write re-exported source");
    fs::write(&barrel, &barrel_source).expect("write barrel source");
    fs::write(&relative, &relative_source).expect("write relative source");
    fs::write(&consumer, &consumer_source).expect("write TypeScript consumer");
    fs::write(&checked_javascript, &checked_javascript_source)
        .expect("write checked JavaScript source");
    fs::write(&unresolved_import, &unresolved_import_source)
        .expect("write unresolved import source");

    ExtendedConfigFixture {
        barrel,
        checked_javascript,
        consumer,
        direct,
        reexported,
        relative,
        unresolved_import,
        barrel_source,
        checked_javascript_source,
        consumer_source,
        direct_source,
        reexported_source,
        relative_source,
        unresolved_import_source,
    }
}

fn write_project_reference_fixture(root: &Path) -> ProjectReferenceFixture {
    let package_a_root = root.join("packages/package-a");
    let package_b_root = root.join("packages/package-b");
    let control_root = root.join("packages/control-no-reference");
    fs::create_dir_all(package_a_root.join("src")).expect("create package A");
    fs::create_dir_all(package_a_root.join("dist")).expect("create package A declarations");
    fs::create_dir_all(package_b_root.join("src")).expect("create package B");
    fs::create_dir_all(control_root.join("src")).expect("create no-reference control");
    fs::create_dir_all(root.join("node_modules/@codevo")).expect("create workspace node_modules");

    fs::write(
        root.join("tsconfig.json"),
        "{\n  \"files\": [],\n  \"references\": [\n    { \"path\": \"./packages/package-a\" },\n    { \"path\": \"./packages/package-b\" }\n  ]\n}\n",
    )
    .expect("write root tsconfig");
    fs::write(
        root.join("package.json"),
        "{\n  \"private\": true,\n  \"workspaces\": [\"packages/*\"]\n}\n",
    )
    .expect("write workspace package.json");
    fs::write(
        package_a_root.join("package.json"),
        "{\n  \"name\": \"@codevo/package-a\",\n  \"version\": \"1.0.0\",\n  \"types\": \"dist/index.d.ts\"\n}\n",
    )
    .expect("write package A package.json");
    fs::write(
        package_b_root.join("package.json"),
        "{\n  \"name\": \"@codevo/package-b\",\n  \"version\": \"1.0.0\",\n  \"dependencies\": { \"@codevo/package-a\": \"workspace:*\" }\n}\n",
    )
    .expect("write package B package.json");
    fs::write(
        control_root.join("package.json"),
        "{\n  \"name\": \"@codevo/control\",\n  \"version\": \"1.0.0\",\n  \"dependencies\": { \"@codevo/package-a\": \"workspace:*\" }\n}\n",
    )
    .expect("write control package.json");
    fs::write(package_a_root.join("tsconfig.json"), package_tsconfig(&[]))
        .expect("write package A tsconfig");
    fs::write(
        package_b_root.join("tsconfig.json"),
        package_tsconfig(&["../package-a"]),
    )
    .expect("write package B tsconfig");
    fs::write(control_root.join("tsconfig.json"), package_tsconfig(&[]))
        .expect("write control tsconfig");

    let package_a_source = "export interface AlphaShape {\n  alphaMember: string;\n}\n\nexport const alphaValue: AlphaShape = { alphaMember: \"alpha\" };\n".to_string();
    let package_b_source = "import { alphaValue } from \"@codevo/package-a\";\n\ninterface BetaShape {\n  betaMember: number;\n}\n\nconst betaValue: BetaShape = { betaMember: 2 };\nalphaValue.alphaMember;\nbetaValue.betaMember;\nconst broken: number = \"wrong\";\n".to_string();
    let control_source =
        "import { alphaValue } from \"@codevo/package-a\";\nalphaValue.alphaMember;\n".to_string();
    let package_a = package_a_root.join("src/index.ts");
    let package_a_declaration = package_a_root.join("dist/index.d.ts");
    let package_b = package_b_root.join("src/index.ts");
    let control = control_root.join("src/index.ts");
    fs::write(&package_a, &package_a_source).expect("write package A source");
    fs::write(&package_b, &package_b_source).expect("write package B source");
    fs::write(&control, &control_source).expect("write control source");
    fs::write(
        &package_a_declaration,
        "export interface AlphaShape {\n  alphaMember: string;\n}\nexport declare const alphaValue: AlphaShape;\n",
    )
    .expect("write package A declaration output");
    std::os::unix::fs::symlink(&package_a_root, root.join("node_modules/@codevo/package-a"))
        .expect("link package A into workspace node_modules");

    ProjectReferenceFixture {
        package_a,
        package_a_declaration,
        package_b,
        control,
        package_a_source,
        package_b_source,
        control_source,
    }
}

fn package_tsconfig(references: &[&str]) -> String {
    let references = references
        .iter()
        .map(|path| format!(r#"{{ "path": "{path}" }}"#))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{{\n  \"compilerOptions\": {{\n    \"composite\": true,\n    \"declaration\": true,\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\",\n    \"outDir\": \"dist\",\n    \"rootDir\": \"src\",\n    \"strict\": true,\n    \"target\": \"ES2022\"\n  }},\n  \"include\": [\"src/**/*.ts\"],\n  \"references\": [{references}]\n}}\n"
    )
}

fn open_document(
    registry: &JavaScriptTypeScriptLanguageServerRegistry,
    root: &str,
    path: &Path,
    text: &str,
) {
    registry
        .send_notification(
            root,
            &JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didOpen".to_string(),
                params: json!({
                    "textDocument": {
                        "uri": file_uri(path),
                        "languageId": "typescript",
                        "version": 1,
                        "text": text,
                    }
                }),
            },
        )
        .expect("open TypeScript document");
}

fn open_javascript_document(
    registry: &JavaScriptTypeScriptLanguageServerRegistry,
    root: &str,
    path: &Path,
    text: &str,
) {
    registry
        .send_notification(
            root,
            &JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "textDocument/didOpen".to_string(),
                params: json!({
                    "textDocument": {
                        "uri": file_uri(path),
                        "languageId": "javascript",
                        "version": 1,
                        "text": text,
                    }
                }),
            },
        )
        .expect("open JavaScript document");
}

fn assert_definition_resolves_to(
    registry: &JavaScriptTypeScriptLanguageServerRegistry,
    root: &str,
    consumer: &Path,
    consumer_source: &str,
    usage: &str,
    expected_path: &Path,
) {
    let result = request(
        registry,
        root,
        "textDocument/definition",
        position_params(consumer, position_after(consumer_source, usage)),
    );
    assert!(
        location_uris(&result)
            .iter()
            .any(|uri| uri == &file_uri(expected_path)),
        "{usage:?} should resolve to {} through the real server: {result:#}",
        expected_path.display()
    );
}

fn request(
    registry: &JavaScriptTypeScriptLanguageServerRegistry,
    root: &str,
    method: &str,
    params: Value,
) -> Value {
    registry
        .send_request(root, method, params)
        .unwrap_or_else(|error| {
            panic!(
                "{method} failed: {error}; language-server stderr tail: {:?}",
                registry.stderr_tail(root)
            )
        })
        .unwrap_or_else(|| {
            panic!(
                "{method} returned no result; language-server stderr tail: {:?}",
                registry.stderr_tail(root)
            )
        })
}

fn position_params(path: &Path, (line, character): (u64, u64)) -> Value {
    json!({
        "textDocument": { "uri": file_uri(path) },
        "position": { "line": line, "character": character },
    })
}

fn position_after(source: &str, needle: &str) -> (u64, u64) {
    let offset = source.find(needle).expect("fixture needle") + needle.len();
    position_at_offset(source, offset)
}

fn position_after_last(source: &str, needle: &str) -> (u64, u64) {
    let offset = source.rfind(needle).expect("fixture needle") + needle.len();
    position_at_offset(source, offset)
}

fn position_at_offset(source: &str, offset: usize) -> (u64, u64) {
    let prefix = &source[..offset];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() as u64;
    let character = prefix
        .rsplit_once('\n')
        .map_or(prefix.len(), |(_, tail)| tail.len()) as u64;
    (line, character)
}

fn completion_labels(result: Value) -> Vec<String> {
    completion_items(result)
        .into_iter()
        .filter_map(|item| {
            item.get("label")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn completion_items(result: Value) -> Vec<Value> {
    let items = result
        .get("items")
        .and_then(Value::as_array)
        .or_else(|| result.as_array())
        .cloned()
        .unwrap_or_default();
    items
}

fn location_uris(result: &Value) -> Vec<String> {
    let items = result
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![result.clone()]);
    items
        .into_iter()
        .filter_map(|item| {
            item.get("uri")
                .or_else(|| item.get("targetUri"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn workspace_edit_uris(result: &Value) -> Vec<String> {
    let mut uris = result
        .get("changes")
        .and_then(Value::as_object)
        .map(|changes| changes.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(document_changes) = result.get("documentChanges").and_then(Value::as_array) {
        for change in document_changes {
            for uri in [
                change.pointer("/textDocument/uri"),
                change.get("uri"),
                change.get("oldUri"),
                change.get("newUri"),
            ]
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            {
                uris.push(uri.to_string());
            }
        }
    }
    uris.sort_unstable();
    uris.dedup();
    uris
}

fn diagnostics_as_lsp_values(event: &LanguageServerDiagnosticEvent) -> Vec<Value> {
    event
        .diagnostics
        .iter()
        .map(|diagnostic| {
            json!({
                "range": {
                    "start": {
                        "line": diagnostic.line,
                        "character": diagnostic.character,
                    },
                    "end": {
                        "line": diagnostic.end_line,
                        "character": diagnostic.end_character,
                    },
                },
                "message": diagnostic.message,
                "code": diagnostic.code,
                "source": diagnostic.source,
                "data": diagnostic.data,
            })
        })
        .collect()
}

fn wait_for_diagnostic(
    receiver: &Receiver<LanguageServerDiagnosticEvent>,
    expected_uri: &str,
) -> (
    LanguageServerDiagnosticEvent,
    Vec<LanguageServerDiagnosticEvent>,
) {
    let deadline = std::time::Instant::now() + RESPONSE_TIMEOUT;
    let mut observed = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let event = receiver
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("timed out waiting for diagnostics for {expected_uri}"));
        observed.push(event.clone());
        if event.uri == expected_uri && !event.diagnostics.is_empty() {
            return (event, observed);
        }
    }
}
