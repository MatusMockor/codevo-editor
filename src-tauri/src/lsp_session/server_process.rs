use super::session_writer::SessionMessageWriter;
use crate::lsp::LanguageServerCommand;
use std::{
    io::{self, Read},
    process::{Child, Command, Stdio},
    sync::Arc,
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(unix)]
use std::time::Duration;

pub trait ServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer>;
}

pub struct SpawnedServer {
    pub stderr: Option<Box<dyn Read + Send>>,
    pub stdin: Arc<SessionMessageWriter>,
    pub stdout: Box<dyn Read + Send>,
    pub killer: Box<dyn ProcessKiller>,
}

pub trait ProcessKiller: Send {
    fn terminate(&mut self) -> io::Result<()>;

    fn pid(&self) -> Option<u32> {
        None
    }
}

pub struct ChildServerProcessSpawner;

impl ServerProcessSpawner for ChildServerProcessSpawner {
    fn spawn(&self, command: &LanguageServerCommand) -> io::Result<SpawnedServer> {
        let mut command_builder = Command::new(&command.executable);
        command_builder
            .args(&command.args)
            .current_dir(&command.working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &command.env {
            command_builder.env(key, value);
        }

        #[cfg(unix)]
        command_builder.process_group(0);

        let mut child = command_builder.spawn()?;
        #[cfg(unix)]
        let process_group_id = child.id() as i32;

        let setup = (|| {
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| io::Error::other("missing child stdin"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| io::Error::other("missing child stdout"))?;
            let stderr = child
                .stderr
                .take()
                .map(|stderr| Box::new(stderr) as Box<dyn Read + Send>);
            let stdin = SessionMessageWriter::from_child_stdin(stdin)?;
            Ok::<_, io::Error>((stdin, stdout, stderr))
        })();
        let (stdin, stdout, stderr) = match setup {
            Ok(setup) => setup,
            Err(error) => {
                cleanup_failed_child(
                    &mut child,
                    #[cfg(unix)]
                    process_group_id,
                );
                return Err(error);
            }
        };

        Ok(SpawnedServer {
            stderr,
            stdin,
            stdout: Box::new(stdout),
            killer: Box::new(ChildKiller {
                child,
                #[cfg(unix)]
                process_group_id,
            }),
        })
    }
}

fn cleanup_failed_child(child: &mut Child, #[cfg(unix)] process_group_id: i32) {
    #[cfg(unix)]
    let _ = signal_process_group(process_group_id, libc::SIGKILL);
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) struct ChildKiller {
    pub(super) child: Child,
    #[cfg(unix)]
    pub(super) process_group_id: i32,
}

impl ProcessKiller for ChildKiller {
    fn pid(&self) -> Option<u32> {
        Some(self.child.id())
    }

    fn terminate(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_some() {
            #[cfg(unix)]
            let _ = signal_process_group(self.process_group_id, libc::SIGKILL);
            return Ok(());
        }

        #[cfg(unix)]
        {
            let _ = signal_process_group(self.process_group_id, libc::SIGTERM);
            std::thread::sleep(Duration::from_millis(150));

            if self.child.try_wait()?.is_none() {
                let _ = signal_process_group(self.process_group_id, libc::SIGKILL);
            }
        }

        let kill_error = self.child.kill().err();
        let wait_result = self.child.wait().map(|_| ());

        #[cfg(unix)]
        let _ = signal_process_group(self.process_group_id, libc::SIGKILL);

        if let Some(error) = kill_error {
            if error.kind() != io::ErrorKind::InvalidInput {
                return Err(error);
            }
        }

        wait_result
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) -> io::Result<()> {
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
