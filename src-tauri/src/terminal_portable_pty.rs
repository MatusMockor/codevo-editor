use super::*;
use portable_pty::{
    native_pty_system, Child as PtyChild, ChildKiller as PtyChildKiller, MasterPty,
};

pub struct PortablePtySpawner;

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
        #[cfg(unix)]
        if let Some(directory) = request.cwd_directory.as_ref() {
            command.cwd_fd(
                directory
                    .try_clone()
                    .map_err(|error| format!("Failed to retain terminal directory: {error}"))?,
            );
        }
        command.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Failed to start terminal shell: {error}"))?;
        let child: Box<dyn TerminalChild> = Box::new(PortableTerminalChild { child });
        finish_portable_spawn(child, pair.master)
    }
}

pub(super) fn finish_portable_spawn(
    child: Box<dyn TerminalChild>,
    master: Box<dyn MasterPty + Send>,
) -> Result<SpawnedTerminal, String> {
    let child = UnpublishedTerminalChild::new(child);
    let reader = master
        .try_clone_reader()
        .map_err(|error| format!("Failed to read terminal output: {error}"))?;
    let writer = master
        .take_writer()
        .map_err(|error| format!("Failed to open terminal input: {error}"))?;

    Ok(SpawnedTerminal {
        child: child.take(),
        reader,
        resizer: Box::new(PortableTerminalResizer { master }),
        writer,
    })
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

    fn try_wait(&mut self) -> io::Result<Option<TerminalExitStatus>> {
        self.child.try_wait().map(|status| {
            status.map(|status| TerminalExitStatus {
                exit_code: Some(status.exit_code()),
            })
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
