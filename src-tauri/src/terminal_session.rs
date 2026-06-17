use crate::terminal::{
    TerminalEventSink, TerminalOutputEvent, TerminalProfile, TerminalRuntimeStatus, TerminalSize,
};
use portable_pty::{
    native_pty_system, Child as PtyChild, ChildKiller as PtyChildKiller, CommandBuilder, MasterPty,
    PtySize,
};
use std::{
    collections::HashMap,
    env,
    io::{self, Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalLaunchRequest {
    pub cwd: PathBuf,
    pub profile: TerminalProfile,
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
        let mut command = command_builder(&request.profile);
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
    killer: Box<dyn TerminalKiller>,
    reader: Option<JoinHandle<()>>,
    resizer: Box<dyn TerminalResizer>,
    sink: Arc<dyn TerminalEventSink>,
    stop_requested: Arc<AtomicBool>,
    waiter: Option<JoinHandle<()>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
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
        spawner: &dyn TerminalPtySpawner,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalRuntimeStatus, String> {
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);
        let request = TerminalLaunchRequest {
            cwd: cwd.clone(),
            profile,
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
                killer,
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
    let _ = session.killer.kill();

    if let Some(reader) = session.reader.take() {
        let _ = reader.join();
    }

    if let Some(waiter) = session.waiter.take() {
        let _ = waiter.join();
    }
}

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize {
        cols: size.cols,
        pixel_height: 0,
        pixel_width: 0,
        rows: size.rows,
    }
}

fn command_builder(profile: &TerminalProfile) -> CommandBuilder {
    match profile.command.as_deref() {
        Some(command) => CommandBuilder::new(command),
        None => CommandBuilder::new_default_prog(),
    }
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
        LocalTerminalProfileProvider, SpawnedTerminal, TerminalChild, TerminalExitStatus,
        TerminalKiller, TerminalLaunchRequest, TerminalProfileProvider, TerminalPtySpawner,
        TerminalResizer, TerminalSupervisor,
    };
    use crate::terminal::{
        TerminalEventSink, TerminalOutputEvent, TerminalProfile, TerminalRuntimeStatus,
        TerminalSize,
    };
    use std::{
        io::{self, Cursor, Read, Write},
        path::PathBuf,
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

    fn default_test_profile() -> TerminalProfile {
        TerminalProfile {
            command: None,
            id: "default".to_string(),
            label: "Default Shell".to_string(),
        }
    }
}
