use crate::terminal::{
    TerminalEventSink, TerminalOutputEvent, TerminalProfile, TerminalRuntimeStatus, TerminalSize,
};
use portable_pty::{
    native_pty_system, Child as PtyChild, ChildKiller as PtyChildKiller, CommandBuilder, MasterPty,
    PtySize,
};
use std::{
    collections::HashMap,
    env, fs,
    fs::{DirBuilder, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalLaunchRequest {
    pub cwd: PathBuf,
    pub profile: TerminalProfile,
    pub shell_integration_base_dir: Option<PathBuf>,
    pub size: TerminalSize,
}

pub struct SpawnedTerminal {
    pub child: Box<dyn TerminalChild>,
    pub reader: Box<dyn Read + Send>,
    pub resizer: Box<dyn TerminalResizer>,
    pub writer: Box<dyn Write + Send>,
}

pub trait TerminalPtySpawner {
    fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String>;
}

pub trait TerminalChild: Send {
    fn clone_killer(&self) -> Box<dyn TerminalKiller>;
    fn process_id(&self) -> Option<u32> {
        None
    }
    fn wait(&mut self) -> io::Result<TerminalExitStatus>;
}

pub trait TerminalKiller: Send {
    fn kill(&mut self) -> io::Result<()>;
}

pub trait TerminalResizer: Send {
    fn resize(&self, size: TerminalSize) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TerminalExitStatus {
    pub exit_code: Option<u32>,
}

pub struct PortablePtySpawner;

pub trait TerminalProfileProvider {
    fn profiles(&self) -> Vec<TerminalProfile>;

    fn resolve_profile(&self, profile_id: Option<&str>) -> Result<TerminalProfile, String> {
        let target_id = profile_id.unwrap_or(DEFAULT_TERMINAL_PROFILE_ID);

        for profile in self.profiles() {
            if profile.id == target_id {
                return Ok(profile);
            }
        }

        Err(format!("Unknown terminal profile: {target_id}"))
    }
}

pub struct LocalTerminalProfileProvider;

impl TerminalProfileProvider for LocalTerminalProfileProvider {
    fn profiles(&self) -> Vec<TerminalProfile> {
        let mut profiles = vec![default_profile()];
        profiles.extend(platform_profiles());
        profiles
    }
}

const DEFAULT_TERMINAL_PROFILE_ID: &str = "default";

impl TerminalPtySpawner for PortablePtySpawner {
    fn spawn(&self, request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
        let size = request.size.normalized();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(pty_size(size))
            .map_err(|error| format!("Failed to open terminal PTY: {error}"))?;
        let mut command = command_builder(
            &request.profile,
            request.shell_integration_base_dir.as_deref(),
        );
        command.cwd(request.cwd.as_os_str());
        command.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Failed to start terminal shell: {error}"))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Failed to read terminal output: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Failed to open terminal input: {error}"))?;

        Ok(SpawnedTerminal {
            child: Box::new(PortableTerminalChild { child }),
            reader,
            resizer: Box::new(PortableTerminalResizer {
                master: pair.master,
            }),
            writer,
        })
    }
}

struct PortableTerminalResizer {
    master: Box<dyn MasterPty + Send>,
}

impl TerminalResizer for PortableTerminalResizer {
    fn resize(&self, size: TerminalSize) -> Result<(), String> {
        self.master
            .resize(pty_size(size.normalized()))
            .map_err(|error| format!("Failed to resize terminal PTY: {error}"))
    }
}

struct PortableTerminalChild {
    child: Box<dyn PtyChild + Send + Sync>,
}

impl TerminalChild for PortableTerminalChild {
    fn clone_killer(&self) -> Box<dyn TerminalKiller> {
        Box::new(PortableTerminalKiller {
            killer: self.child.clone_killer(),
        })
    }

    fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }

    fn wait(&mut self) -> io::Result<TerminalExitStatus> {
        self.child.wait().map(|status| TerminalExitStatus {
            exit_code: Some(status.exit_code()),
        })
    }
}

struct PortableTerminalKiller {
    killer: Box<dyn PtyChildKiller + Send + Sync>,
}

impl TerminalKiller for PortableTerminalKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.killer.kill()
    }
}

struct RunningTerminalSession {
    cwd: PathBuf,
    process_tree_terminator: ProcessTreeTerminator,
    reader: Option<JoinHandle<()>>,
    resizer: Box<dyn TerminalResizer>,
    sink: Arc<dyn TerminalEventSink>,
    stop_requested: Arc<AtomicBool>,
    waiter: Option<JoinHandle<()>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

const TERMINAL_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);
const TERMINAL_FORCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);
const TERMINAL_THREAD_JOIN_TIMEOUT: Duration = Duration::from_millis(250);

struct ProcessTreeTerminator {
    fallback_killer: Box<dyn TerminalKiller>,
    force_timeout: Duration,
    graceful_timeout: Duration,
    process_group_id: Option<i32>,
    signal_sender: Box<dyn ProcessGroupSignalSender>,
}

trait ProcessGroupSignalSender: Send {
    fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()>;
}

struct SystemProcessGroupSignalSender;

impl ProcessGroupSignalSender for SystemProcessGroupSignalSender {
    #[cfg(unix)]
    fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()> {
        let result = unsafe { libc::kill(-process_group_id, signal) };

        if result == 0 {
            return Ok(());
        }

        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }

        Err(error)
    }

    #[cfg(not(unix))]
    fn send(&self, _process_group_id: i32, _signal: i32) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Process-group signals are unavailable on this platform.",
        ))
    }
}

impl ProcessTreeTerminator {
    fn new(process_id: Option<u32>, fallback_killer: Box<dyn TerminalKiller>) -> Self {
        Self {
            fallback_killer,
            force_timeout: TERMINAL_FORCE_SHUTDOWN_TIMEOUT,
            graceful_timeout: TERMINAL_GRACEFUL_SHUTDOWN_TIMEOUT,
            process_group_id: process_id.and_then(|process_id| i32::try_from(process_id).ok()),
            signal_sender: Box::new(SystemProcessGroupSignalSender),
        }
    }

    #[cfg(test)]
    fn with_dependencies(
        process_group_id: i32,
        fallback_killer: Box<dyn TerminalKiller>,
        signal_sender: Box<dyn ProcessGroupSignalSender>,
        graceful_timeout: Duration,
        force_timeout: Duration,
    ) -> Self {
        Self {
            fallback_killer,
            force_timeout,
            graceful_timeout,
            process_group_id: Some(process_group_id),
            signal_sender,
        }
    }

    fn terminate(&mut self, waiter: Option<&JoinHandle<()>>) {
        if self.process_group_id.is_none() {
            let _ = self.fallback_killer.kill();
            wait_for_thread(waiter, self.force_timeout);
            return;
        }

        if self.signal_process_group(libc::SIGTERM).is_err() {
            let _ = self.fallback_killer.kill();
        }
        if wait_for_thread(waiter, self.graceful_timeout) {
            return;
        }

        if self.signal_process_group(libc::SIGKILL).is_err() {
            let _ = self.fallback_killer.kill();
        }
        wait_for_thread(waiter, self.force_timeout);
    }

    fn signal_process_group(&self, signal: i32) -> io::Result<()> {
        let Some(process_group_id) = self.process_group_id else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Terminal process group is unavailable.",
            ));
        };
        self.signal_sender.send(process_group_id, signal)
    }
}

pub struct TerminalSupervisor {
    next_session_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<u64, RunningTerminalSession>>>,
}

impl TerminalSupervisor {
    pub fn new() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start(
        &self,
        cwd: PathBuf,
        size: TerminalSize,
        profile: TerminalProfile,
        shell_integration_base_dir: Option<PathBuf>,
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        let request = TerminalLaunchRequest {
            cwd: cwd.clone(),
            profile,
            shell_integration_base_dir,
            size: size.normalized(),
        };
        sink.emit_status(TerminalRuntimeStatus::Starting { session_id });

        let spawned = match spawner.spawn(&request) {
            Ok(spawned) => spawned,
            Err(message) => {
                sink.emit_status(TerminalRuntimeStatus::Crashed {
                    message: message.clone(),
                    session_id,
                });
                return Err(message);
            }
        };
        let stop_requested = Arc::new(AtomicBool::new(false));
        let writer = Arc::new(Mutex::new(spawned.writer));
        let child = spawned.child;
        let process_id = child.process_id();
        let killer = child.clone_killer();
        let reader = spawn_reader(
            spawned.reader,
            Arc::clone(&sink),
            Arc::clone(&stop_requested),
            session_id,
        )?;
        let waiter = spawn_waiter(
            child,
            Arc::clone(&sink),
            Arc::clone(&stop_requested),
            session_id,
        )?;
        let status = TerminalRuntimeStatus::Running {
            cols: request.size.cols,
            cwd: cwd.to_string_lossy().to_string(),
            rows: request.size.rows,
            session_id,
        };

        self.insert_session(
            session_id,
            RunningTerminalSession {
                cwd,
                process_tree_terminator: ProcessTreeTerminator::new(process_id, killer),
                reader: Some(reader),
                resizer: spawned.resizer,
                sink: Arc::clone(&sink),
                stop_requested,
                waiter: Some(waiter),
                writer,
            },
        )?;
        sink.emit_status(status.clone());
        Ok(status)
    }

    pub fn stop_root(&self, root: &Path) -> Result<(), String> {
        let sessions = {
            let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            let session_ids = sessions
                .iter()
                .filter_map(|(session_id, session)| {
                    if session.cwd == root {
                        Some(*session_id)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();

            session_ids
                .into_iter()
                .filter_map(|session_id| {
                    sessions
                        .remove(&session_id)
                        .map(|session| (session_id, session))
                })
                .collect::<Vec<_>>()
        };

        for (session_id, session) in sessions {
            let sink = Arc::clone(&session.sink);
            terminate_session(session);
            sink.emit_status(TerminalRuntimeStatus::Stopped { session_id });
        }

        Ok(())
    }

    pub fn write_input(&self, session_id: u64, data: &str) -> Result<(), String> {
        let writer = match self.session_writer(session_id) {
            Some(writer) => writer,
            None => return Ok(()),
        };
        let mut writer = writer.lock().map_err(|error| error.to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| format!("Failed to write terminal input: {error}"))
    }

    pub fn resize(&self, session_id: u64, size: TerminalSize) -> Result<(), String> {
        let size = size.normalized();
        let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        let session = match sessions.get(&session_id) {
            Some(session) => session,
            None => return Ok(()),
        };

        session.resizer.resize(size)
    }

    pub fn stop(&self, session_id: u64) -> Result<TerminalRuntimeStatus, String> {
        let session = match self.take_session(session_id) {
            Some(session) => session,
            None => {
                return Ok(TerminalRuntimeStatus::Stopped { session_id });
            }
        };
        let sink = Arc::clone(&session.sink);
        terminate_session(session);
        let status = TerminalRuntimeStatus::Stopped { session_id };
        sink.emit_status(status.clone());
        Ok(status)
    }

    pub fn stop_all(&self) {
        let sessions = match self.sessions.lock() {
            Ok(mut sessions) => sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };

        for session in sessions {
            terminate_session(session);
        }
    }

    fn insert_session(
        &self,
        session_id: u64,
        session: RunningTerminalSession,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        sessions.insert(session_id, session);
        Ok(())
    }

    fn session_writer(&self, session_id: u64) -> Option<Arc<Mutex<Box<dyn Write + Send>>>> {
        self.sessions
            .lock()
            .ok()?
            .get(&session_id)
            .map(|session| Arc::clone(&session.writer))
    }

    fn take_session(&self, session_id: u64) -> Option<RunningTerminalSession> {
        self.sessions.lock().ok()?.remove(&session_id)
    }
}

impl Default for TerminalSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for TerminalSupervisor {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn spawn_reader(
    mut reader: Box<dyn Read + Send>,
    sink: Arc<dyn TerminalEventSink>,
    stop_requested: Arc<AtomicBool>,
    session_id: u64,
) -> Result<JoinHandle<()>, String> {
    thread::Builder::new()
        .name("terminal-reader".to_string())
        .spawn(move || {
            let mut buffer = [0_u8; 8192];

            loop {
                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }

                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(count) => {
                        sink.emit_output(TerminalOutputEvent {
                            data: String::from_utf8_lossy(&buffer[..count]).to_string(),
                            session_id,
                        });
                    }
                    Err(error) => {
                        if stop_requested.load(Ordering::SeqCst) {
                            return;
                        }

                        sink.emit_status(TerminalRuntimeStatus::Crashed {
                            message: format!("Terminal output stream failed: {error}"),
                            session_id,
                        });
                        return;
                    }
                }
            }
        })
        .map_err(|error| format!("Failed to start terminal reader: {error}"))
}

fn spawn_waiter(
    mut child: Box<dyn TerminalChild>,
    sink: Arc<dyn TerminalEventSink>,
    stop_requested: Arc<AtomicBool>,
    session_id: u64,
) -> Result<JoinHandle<()>, String> {
    thread::Builder::new()
        .name("terminal-waiter".to_string())
        .spawn(move || {
            let status = child.wait();

            if stop_requested.load(Ordering::SeqCst) {
                return;
            }

            match status {
                Ok(status) => sink.emit_status(TerminalRuntimeStatus::Exited {
                    exit_code: status.exit_code,
                    session_id,
                }),
                Err(error) => sink.emit_status(TerminalRuntimeStatus::Crashed {
                    message: format!("Terminal process wait failed: {error}"),
                    session_id,
                }),
            }
        })
        .map_err(|error| format!("Failed to start terminal waiter: {error}"))
}

fn terminate_session(mut session: RunningTerminalSession) {
    session.stop_requested.store(true, Ordering::SeqCst);
    session
        .process_tree_terminator
        .terminate(session.waiter.as_ref());

    drop(session.writer);
    drop(session.resizer);

    if let Some(reader) = take_finished_thread(&mut session.reader, TERMINAL_THREAD_JOIN_TIMEOUT) {
        let _ = reader.join();
    }

    if let Some(waiter) = take_finished_thread(&mut session.waiter, TERMINAL_THREAD_JOIN_TIMEOUT) {
        let _ = waiter.join();
    }
}

fn wait_for_thread(thread: Option<&JoinHandle<()>>, timeout: Duration) -> bool {
    let Some(thread) = thread else {
        return true;
    };
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if thread.is_finished() {
            return true;
        }

        thread::sleep(Duration::from_millis(10));
    }

    thread.is_finished()
}

fn take_finished_thread(
    thread: &mut Option<JoinHandle<()>>,
    timeout: Duration,
) -> Option<JoinHandle<()>> {
    if !wait_for_thread(thread.as_ref(), timeout) {
        return None;
    }

    thread.take()
}

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize {
        cols: size.cols,
        pixel_height: 0,
        pixel_width: 0,
        rows: size.rows,
    }
}

fn command_builder(
    profile: &TerminalProfile,
    shell_integration_base_dir: Option<&Path>,
) -> CommandBuilder {
    let Some(shell_integration_base_dir) = shell_integration_base_dir else {
        return base_command_builder(profile);
    };

    let command = profile.command.clone().or_else(|| env::var("SHELL").ok());
    let Some(command) = command else {
        return base_command_builder(profile);
    };
    let shell = Path::new(&command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let Some(integration_dir) = prepare_shell_integration(shell_integration_base_dir) else {
        return base_command_builder(profile);
    };

    if shell == "bash" {
        let mut builder = CommandBuilder::new(command);
        builder.args([
            "--rcfile".as_ref(),
            integration_dir
                .join("editor-shell-integration.bash")
                .as_os_str(),
            "-i".as_ref(),
        ]);
        return builder;
    }

    if shell == "zsh" {
        let mut builder = CommandBuilder::new(command);

        if let Some(zdotdir) = builder.get_env("ZDOTDIR").map(|value| value.to_owned()) {
            builder.env("EDITOR_ORIGINAL_ZDOTDIR", zdotdir);
        }

        builder.env("ZDOTDIR", integration_dir);
        builder.arg("-i");
        return builder;
    }

    base_command_builder(profile)
}

fn base_command_builder(profile: &TerminalProfile) -> CommandBuilder {
    if let Some(command) = profile.command.as_deref() {
        return CommandBuilder::new(command);
    }

    CommandBuilder::new_default_prog()
}

fn prepare_shell_integration(base_dir: &Path) -> Option<PathBuf> {
    let directory = base_dir.join("terminal-shell-integration");
    ensure_private_directory(&directory).ok()?;
    write_owned_file(
        directory.join("editor-shell-integration.bash"),
        include_str!("../resources/editor-shell-integration.bash"),
    )
    .ok()?;
    write_owned_file(
        directory.join(".zshenv"),
        include_str!("../resources/editor-shell-integration.zshenv"),
    )
    .ok()?;
    write_owned_file(
        directory.join(".zprofile"),
        include_str!("../resources/editor-shell-integration.zprofile"),
    )
    .ok()?;
    write_owned_file(
        directory.join(".zshrc"),
        include_str!("../resources/editor-shell-integration.zsh"),
    )
    .ok()?;
    write_owned_file(
        directory.join(".zlogin"),
        include_str!("../resources/editor-shell-integration.zlogin"),
    )
    .ok()?;

    Some(directory)
}

fn ensure_private_directory(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_private_directory(path, &metadata)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => create_private_directory(path)?,
        Err(error) => return Err(error),
    }

    let metadata = fs::symlink_metadata(path)?;
    validate_private_directory(path, &metadata)
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    let mut builder = DirBuilder::new();
    builder.recursive(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }

    builder.create(path)
}

fn validate_private_directory(path: &Path, metadata: &fs::Metadata) -> io::Result<()> {
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Shell integration path is not an owned directory.",
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Shell integration directory has an unexpected owner.",
            ));
        }

        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }

    Ok(())
}

fn write_owned_file(path: PathBuf, contents: &str) -> io::Result<()> {
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Shell integration rc path is not an owned file.",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW).mode(0o600);
    }

    let mut file = options.open(&path)?;

    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Shell integration rc path is not a regular file.",
        ));
    }

    file.write_all(contents.as_bytes())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }

    let metadata = fs::symlink_metadata(path)?;

    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Shell integration rc path is a symlink.",
        ));
    }

    Ok(())
}

fn default_profile() -> TerminalProfile {
    TerminalProfile {
        command: None,
        id: DEFAULT_TERMINAL_PROFILE_ID.to_string(),
        label: "Default Shell".to_string(),
    }
}

#[cfg(not(windows))]
fn platform_profiles() -> Vec<TerminalProfile> {
    match env::var("SHELL") {
        Ok(shell) if !shell.trim().is_empty() => {
            let shell = shell.trim().to_string();

            vec![TerminalProfile {
                command: Some(shell.clone()),
                id: format!("shell:{shell}"),
                label: shell_label(&shell),
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(windows)]
fn platform_profiles() -> Vec<TerminalProfile> {
    vec![
        TerminalProfile {
            command: Some("powershell.exe".to_string()),
            id: "powershell".to_string(),
            label: "PowerShell".to_string(),
        },
        TerminalProfile {
            command: Some("cmd.exe".to_string()),
            id: "cmd".to_string(),
            label: "Command Prompt".to_string(),
        },
    ]
}

fn shell_label(shell: &str) -> String {
    PathBuf::from(shell)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| shell.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        command_builder, prepare_shell_integration, LocalTerminalProfileProvider,
        PortablePtySpawner, ProcessGroupSignalSender, ProcessTreeTerminator, SpawnedTerminal,
        TerminalChild, TerminalExitStatus, TerminalKiller, TerminalLaunchRequest,
        TerminalProfileProvider, TerminalPtySpawner, TerminalResizer, TerminalSupervisor,
    };
    use crate::terminal::{
        TerminalEventSink, TerminalOutputEvent, TerminalProfile, TerminalRuntimeStatus,
        TerminalSize,
    };
    use std::{
        io::{self, Cursor, Read, Write},
        path::{Path, PathBuf},
        sync::{Arc, Condvar, Mutex},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn start_emits_statuses_and_terminal_output() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let spawner = FakeTerminalSpawner::with_reader(Cursor::new(b"ready\r\n".to_vec()));

        let status = supervisor
            .start(
                PathBuf::from("/workspace"),
                TerminalSize {
                    cols: 100,
                    rows: 30,
                },
                default_test_profile(),
                None,
                &spawner,
                sink.clone(),
            )
            .expect("start terminal");

        wait_for(|| !sink.outputs().is_empty());

        assert_eq!(
            status,
            TerminalRuntimeStatus::Running {
                cols: 100,
                cwd: "/workspace".to_string(),
                rows: 30,
                session_id: 1,
            }
        );
        assert_eq!(sink.outputs()[0].data, "ready\r\n");
        assert!(sink
            .statuses()
            .contains(&TerminalRuntimeStatus::Starting { session_id: 1 }));
    }

    #[test]
    fn write_input_sends_bytes_to_target_session() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let reader = BlockingReader::default();
        let writer = SharedWriter::default();
        let written = writer.bytes();
        let spawner = FakeTerminalSpawner::new(Box::new(reader), Box::new(writer));

        supervisor
            .start(
                PathBuf::from("/workspace"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &spawner,
                sink,
            )
            .expect("start terminal");
        supervisor
            .write_input(1, "echo hi\r")
            .expect("write terminal input");

        assert_eq!(written.lock().expect("written").as_slice(), b"echo hi\r");
    }

    #[test]
    fn resize_target_session_updates_resizer() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let resizer = RecordingTerminalResizer::default();
        let resized = resizer.sizes();
        let spawner = FakeTerminalSpawner::with_resizer(
            Box::new(BlockingReader::default()),
            Box::new(SharedWriter::default()),
            Box::new(resizer),
        );

        supervisor
            .start(
                PathBuf::from("/workspace"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &spawner,
                sink,
            )
            .expect("start terminal");
        supervisor
            .resize(
                1,
                TerminalSize {
                    cols: 120,
                    rows: 40,
                },
            )
            .expect("resize terminal");

        assert_eq!(
            resized.lock().expect("resized").as_slice(),
            &[TerminalSize {
                cols: 120,
                rows: 40
            }]
        );
    }

    #[test]
    fn stop_kills_and_reports_target_session() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let process = RecordingTerminalChild::blocking();
        let killed = process.killed();
        let spawner = FakeTerminalSpawner::with_child(
            Box::new(BlockingReader::default()),
            Box::new(SharedWriter::default()),
            Box::new(process),
        );

        supervisor
            .start(
                PathBuf::from("/workspace"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &spawner,
                sink.clone(),
            )
            .expect("start terminal");

        assert_eq!(
            supervisor.stop(1).expect("stop terminal"),
            TerminalRuntimeStatus::Stopped { session_id: 1 }
        );
        assert_eq!(*killed.lock().expect("killed"), 1);
        assert!(sink
            .statuses()
            .contains(&TerminalRuntimeStatus::Stopped { session_id: 1 }));
    }

    #[test]
    fn stop_root_kills_only_matching_workspace_sessions() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let workspace_a_process = RecordingTerminalChild::blocking();
        let workspace_a_killed = workspace_a_process.killed();
        let workspace_b_process = RecordingTerminalChild::blocking();
        let workspace_b_killed = workspace_b_process.killed();
        let workspace_a_spawner = FakeTerminalSpawner::with_child(
            Box::new(BlockingReader::default()),
            Box::new(SharedWriter::default()),
            Box::new(workspace_a_process),
        );
        let workspace_b_spawner = FakeTerminalSpawner::with_child(
            Box::new(BlockingReader::default()),
            Box::new(SharedWriter::default()),
            Box::new(workspace_b_process),
        );

        supervisor
            .start(
                PathBuf::from("/workspace-a"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &workspace_a_spawner,
                sink.clone(),
            )
            .expect("start workspace a terminal");
        supervisor
            .start(
                PathBuf::from("/workspace-b"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &workspace_b_spawner,
                sink.clone(),
            )
            .expect("start workspace b terminal");

        supervisor
            .stop_root(Path::new("/workspace-a"))
            .expect("stop workspace a terminals");

        assert_eq!(*workspace_a_killed.lock().expect("workspace a killed"), 1);
        assert_eq!(*workspace_b_killed.lock().expect("workspace b killed"), 0);
        assert!(sink
            .statuses()
            .contains(&TerminalRuntimeStatus::Stopped { session_id: 1 }));
    }

    #[test]
    fn process_tree_terminator_escalates_without_blocking_on_stuck_waiter() {
        let child = RecordingTerminalChild::blocking();
        let killed = child.killed();
        let signals = Arc::new(Mutex::new(Vec::new()));
        let signal_sender = RecordingProcessGroupSignalSender {
            signals: Arc::clone(&signals),
        };
        let mut terminator = ProcessTreeTerminator::with_dependencies(
            42,
            child.clone_killer(),
            Box::new(signal_sender),
            Duration::from_millis(10),
            Duration::from_millis(10),
        );
        let waiter = thread::spawn(|| thread::sleep(Duration::from_millis(100)));
        let started = Instant::now();

        terminator.terminate(Some(&waiter));

        assert!(started.elapsed() < Duration::from_millis(80));
        assert_eq!(
            signals.lock().expect("signals").as_slice(),
            &[(42, libc::SIGTERM), (42, libc::SIGKILL)]
        );
        assert_eq!(*killed.lock().expect("killed"), 0);
        waiter.join().expect("waiter");
    }

    #[cfg(unix)]
    #[test]
    fn stop_reaps_shell_and_background_process_group() {
        let test_dir = terminal_process_test_dir("process-group");
        std::fs::create_dir_all(&test_dir).expect("create terminal process test directory");
        let pid_file = test_dir.join("pids");
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let profile = TerminalProfile {
            command: Some("/bin/sh".to_string()),
            id: "integration-shell".to_string(),
            label: "Integration Shell".to_string(),
        };

        supervisor
            .start(
                test_dir.clone(),
                TerminalSize::default(),
                profile,
                None,
                &PortablePtySpawner,
                sink.clone(),
            )
            .expect("start real terminal");
        supervisor
            .write_input(1, "set +H; set +m\r")
            .expect("disable shell job control");
        thread::sleep(Duration::from_millis(50));
        supervisor
            .write_input(
                1,
                &format!(
                    "sleep 30 & child=$!; printf '%s %s\\n' \"$$\" \"$child\" > '{}'\r",
                    pid_file.display()
                ),
            )
            .expect("start background terminal process");
        wait_for(|| pid_file.is_file());
        let process_ids = read_process_ids(&pid_file);

        supervisor.stop(1).expect("stop real terminal");
        wait_for(|| {
            process_ids
                .iter()
                .all(|process_id| !process_exists(*process_id))
        });

        assert!(process_ids
            .iter()
            .all(|process_id| !process_exists(*process_id)));
        let _ = std::fs::remove_dir_all(test_dir);
    }

    #[test]
    fn process_exit_reports_exited_status() {
        let supervisor = TerminalSupervisor::new();
        let sink = Arc::new(RecordingTerminalSink::default());
        let process = RecordingTerminalChild::exited(7);
        let spawner = FakeTerminalSpawner::with_child(
            Box::new(Cursor::new(Vec::new())),
            Box::new(SharedWriter::default()),
            Box::new(process),
        );

        supervisor
            .start(
                PathBuf::from("/workspace"),
                TerminalSize::default(),
                default_test_profile(),
                None,
                &spawner,
                sink.clone(),
            )
            .expect("start terminal");
        wait_for(|| {
            sink.statuses().contains(&TerminalRuntimeStatus::Exited {
                exit_code: Some(7),
                session_id: 1,
            })
        });
    }

    #[test]
    fn local_profiles_include_default_and_resolve_it() {
        let provider = LocalTerminalProfileProvider;
        let profile = provider.resolve_profile(None).expect("default profile");

        assert_eq!(profile.id, "default");
        assert!(provider
            .profiles()
            .iter()
            .any(|profile| profile.id == "default"));
    }

    #[test]
    fn command_builder_gates_bash_rcfile_injection() {
        let profile = TerminalProfile {
            command: Some("/bin/bash".to_string()),
            id: "bash".to_string(),
            label: "bash".to_string(),
        };

        let app_data = shell_integration_test_data_dir("bash");
        let disabled = command_builder(&profile, None);
        let enabled = command_builder(&profile, Some(&app_data));

        assert_eq!(disabled.get_argv(), &["/bin/bash"]);
        assert_eq!(enabled.get_argv()[0], "/bin/bash");
        assert_eq!(enabled.get_argv()[1], "--rcfile");
        assert!(Path::new(&enabled.get_argv()[2]).ends_with("editor-shell-integration.bash"));
        assert!(Path::new(&enabled.get_argv()[2]).starts_with(&app_data));
        assert_eq!(enabled.get_argv()[3], "-i");
        let _ = std::fs::remove_dir_all(app_data);
    }

    #[test]
    fn command_builder_gates_zsh_zdotdir_injection() {
        let profile = TerminalProfile {
            command: Some("/bin/zsh".to_string()),
            id: "zsh".to_string(),
            label: "zsh".to_string(),
        };

        let app_data = shell_integration_test_data_dir("zsh");
        let disabled = command_builder(&profile, None);
        let enabled = command_builder(&profile, Some(&app_data));

        assert!(disabled.get_env("ZDOTDIR").is_none());
        assert!(enabled.get_env("ZDOTDIR").is_some());
        assert_eq!(enabled.get_argv(), &["/bin/zsh", "-i"]);
        let _ = std::fs::remove_dir_all(app_data);
    }

    #[cfg(unix)]
    #[test]
    fn shell_integration_directory_is_private_and_outside_shared_temp() {
        use std::os::unix::fs::PermissionsExt;

        let app_data = shell_integration_test_data_dir("permissions");
        let directory = prepare_shell_integration(&app_data).expect("shell integration directory");
        let metadata = directory.metadata().expect("shell integration metadata");

        assert!(!directory.starts_with(std::env::temp_dir()));
        assert_eq!(metadata.permissions().mode() & 0o777, 0o700);
        for startup_file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            assert!(directory.join(startup_file).is_file());
        }
        assert!(!directory
            .symlink_metadata()
            .expect("shell integration symlink metadata")
            .file_type()
            .is_symlink());
        let _ = std::fs::remove_dir_all(app_data);
    }

    #[cfg(unix)]
    #[test]
    fn shell_integration_rejects_planted_rc_symlink() {
        use std::os::unix::fs::symlink;

        let app_data = shell_integration_test_data_dir("symlink");
        let directory = prepare_shell_integration(&app_data).expect("shell integration directory");
        let bash_rc = directory.join("editor-shell-integration.bash");
        let target = app_data.join("attacker-controlled");
        std::fs::remove_file(&bash_rc).expect("remove generated bash rc");
        std::fs::write(&target, "unchanged").expect("symlink target");
        symlink(&target, &bash_rc).expect("planted bash rc symlink");

        assert!(prepare_shell_integration(&app_data).is_none());
        assert_eq!(
            std::fs::read_to_string(&target).expect("symlink target contents"),
            "unchanged"
        );
        let _ = std::fs::remove_dir_all(app_data);
    }

    fn shell_integration_test_data_dir(name: &str) -> PathBuf {
        std::env::current_dir()
            .expect("current directory")
            .join("target/terminal-shell-integration-tests")
            .join(format!("{name}-{}", std::process::id()))
    }

    #[derive(Default)]
    struct RecordingTerminalSink {
        outputs: Mutex<Vec<TerminalOutputEvent>>,
        statuses: Mutex<Vec<TerminalRuntimeStatus>>,
    }

    impl RecordingTerminalSink {
        fn outputs(&self) -> Vec<TerminalOutputEvent> {
            self.outputs.lock().expect("outputs").clone()
        }

        fn statuses(&self) -> Vec<TerminalRuntimeStatus> {
            self.statuses.lock().expect("statuses").clone()
        }
    }

    impl TerminalEventSink for RecordingTerminalSink {
        fn emit_output(&self, event: TerminalOutputEvent) {
            self.outputs.lock().expect("outputs").push(event);
        }

        fn emit_status(&self, status: TerminalRuntimeStatus) {
            self.statuses.lock().expect("statuses").push(status);
        }
    }

    struct FakeTerminalSpawner {
        child: Arc<Mutex<Option<Box<dyn TerminalChild>>>>,
        reader: Arc<Mutex<Option<Box<dyn Read + Send>>>>,
        resizer: Arc<Mutex<Option<Box<dyn TerminalResizer>>>>,
        writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    }

    impl FakeTerminalSpawner {
        fn new(reader: Box<dyn Read + Send>, writer: Box<dyn Write + Send>) -> Self {
            Self::with_parts(
                reader,
                writer,
                Box::new(RecordingTerminalResizer::default()),
                Box::new(RecordingTerminalChild::blocking()),
            )
        }

        fn with_child(
            reader: Box<dyn Read + Send>,
            writer: Box<dyn Write + Send>,
            child: Box<dyn TerminalChild>,
        ) -> Self {
            Self::with_parts(
                reader,
                writer,
                Box::new(RecordingTerminalResizer::default()),
                child,
            )
        }

        fn with_reader<R: Read + Send + 'static>(reader: R) -> Self {
            Self::new(Box::new(reader), Box::new(SharedWriter::default()))
        }

        fn with_resizer(
            reader: Box<dyn Read + Send>,
            writer: Box<dyn Write + Send>,
            resizer: Box<dyn TerminalResizer>,
        ) -> Self {
            Self::with_parts(
                reader,
                writer,
                resizer,
                Box::new(RecordingTerminalChild::blocking()),
            )
        }

        fn with_parts(
            reader: Box<dyn Read + Send>,
            writer: Box<dyn Write + Send>,
            resizer: Box<dyn TerminalResizer>,
            child: Box<dyn TerminalChild>,
        ) -> Self {
            Self {
                child: Arc::new(Mutex::new(Some(child))),
                reader: Arc::new(Mutex::new(Some(reader))),
                resizer: Arc::new(Mutex::new(Some(resizer))),
                writer: Arc::new(Mutex::new(Some(writer))),
            }
        }
    }

    impl TerminalPtySpawner for FakeTerminalSpawner {
        fn spawn(&self, _request: &TerminalLaunchRequest) -> Result<SpawnedTerminal, String> {
            Ok(SpawnedTerminal {
                child: self
                    .child
                    .lock()
                    .expect("child")
                    .take()
                    .expect("fake child"),
                reader: self
                    .reader
                    .lock()
                    .expect("reader")
                    .take()
                    .expect("fake reader"),
                resizer: self
                    .resizer
                    .lock()
                    .expect("resizer")
                    .take()
                    .expect("fake resizer"),
                writer: self
                    .writer
                    .lock()
                    .expect("writer")
                    .take()
                    .expect("fake writer"),
            })
        }
    }

    #[derive(Default)]
    struct RecordingTerminalResizer {
        sizes: Arc<Mutex<Vec<TerminalSize>>>,
    }

    impl RecordingTerminalResizer {
        fn sizes(&self) -> Arc<Mutex<Vec<TerminalSize>>> {
            Arc::clone(&self.sizes)
        }
    }

    impl TerminalResizer for RecordingTerminalResizer {
        fn resize(&self, size: TerminalSize) -> Result<(), String> {
            self.sizes.lock().expect("sizes").push(size);
            Ok(())
        }
    }

    #[derive(Clone)]
    struct RecordingTerminalChild {
        exit_code: Option<u32>,
        killed: Arc<Mutex<usize>>,
        signal: Arc<(Mutex<bool>, Condvar)>,
    }

    impl RecordingTerminalChild {
        fn blocking() -> Self {
            Self {
                exit_code: None,
                killed: Arc::new(Mutex::new(0)),
                signal: Arc::new((Mutex::new(false), Condvar::new())),
            }
        }

        fn exited(exit_code: u32) -> Self {
            Self {
                exit_code: Some(exit_code),
                killed: Arc::new(Mutex::new(0)),
                signal: Arc::new((Mutex::new(true), Condvar::new())),
            }
        }

        fn killed(&self) -> Arc<Mutex<usize>> {
            Arc::clone(&self.killed)
        }
    }

    impl TerminalChild for RecordingTerminalChild {
        fn clone_killer(&self) -> Box<dyn TerminalKiller> {
            Box::new(RecordingTerminalKiller {
                killed: Arc::clone(&self.killed),
                signal: Arc::clone(&self.signal),
            })
        }

        fn wait(&mut self) -> io::Result<TerminalExitStatus> {
            let (lock, cvar) = &*self.signal;
            let mut completed = lock.lock().expect("completed");

            while !*completed {
                completed = cvar.wait(completed).expect("completed");
            }

            Ok(TerminalExitStatus {
                exit_code: self.exit_code,
            })
        }
    }

    struct RecordingTerminalKiller {
        killed: Arc<Mutex<usize>>,
        signal: Arc<(Mutex<bool>, Condvar)>,
    }

    struct RecordingProcessGroupSignalSender {
        signals: Arc<Mutex<Vec<(i32, i32)>>>,
    }

    impl ProcessGroupSignalSender for RecordingProcessGroupSignalSender {
        fn send(&self, process_group_id: i32, signal: i32) -> io::Result<()> {
            self.signals
                .lock()
                .expect("signals")
                .push((process_group_id, signal));
            Ok(())
        }
    }

    impl TerminalKiller for RecordingTerminalKiller {
        fn kill(&mut self) -> io::Result<()> {
            *self.killed.lock().expect("killed") += 1;
            let (lock, cvar) = &*self.signal;
            *lock.lock().expect("completed") = true;
            cvar.notify_all();
            Ok(())
        }
    }

    #[derive(Default)]
    struct SharedWriter {
        bytes: Arc<Mutex<Vec<u8>>>,
    }

    impl SharedWriter {
        fn bytes(&self) -> Arc<Mutex<Vec<u8>>> {
            Arc::clone(&self.bytes)
        }
    }

    impl Write for SharedWriter {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.bytes.lock().expect("bytes").extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct BlockingReader;

    impl Read for BlockingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            thread::sleep(Duration::from_millis(25));
            Ok(0)
        }
    }

    fn wait_for(mut predicate: impl FnMut() -> bool) {
        let started = Instant::now();

        while started.elapsed() < Duration::from_secs(2) {
            if predicate() {
                return;
            }

            thread::sleep(Duration::from_millis(10));
        }

        panic!("condition was not met");
    }

    #[cfg(unix)]
    fn terminal_process_test_dir(name: &str) -> PathBuf {
        std::env::current_dir()
            .expect("current directory")
            .join("target/terminal-process-tests")
            .join(format!("{name}-{}", std::process::id()))
    }

    #[cfg(unix)]
    fn read_process_ids(path: &Path) -> Vec<i32> {
        std::fs::read_to_string(path)
            .expect("terminal process ids")
            .split_whitespace()
            .map(|value| value.parse::<i32>().expect("terminal process id"))
            .collect()
    }

    #[cfg(unix)]
    fn process_exists(process_id: i32) -> bool {
        let result = unsafe { libc::kill(process_id, 0) };
        if result == 0 {
            return true;
        }

        io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
    }

    fn default_test_profile() -> TerminalProfile {
        TerminalProfile {
            command: None,
            id: "default".to_string(),
            label: "Default Shell".to_string(),
        }
    }
}
