use std::process::{Child, Command};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::remote_runner) struct ForwardDestination {
    server_id: String,
    host: String,
    username: String,
    port: u16,
}

impl ForwardDestination {
    pub(in crate::remote_runner) fn new(
        server_id: &str,
        host: &str,
        username: &str,
        port: u16,
    ) -> Self {
        Self {
            server_id: server_id.into(),
            host: host.into(),
            username: username.into(),
            port,
        }
    }

    pub(super) fn server_id(&self) -> &str {
        &self.server_id
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RemoteLoopback {
    V4,
    V6,
}

impl RemoteLoopback {
    fn host(self) -> &'static str {
        match self {
            Self::V4 => "127.0.0.1",
            Self::V6 => "[::1]",
        }
    }
}

pub(super) struct ForwardPlan<'a> {
    pub(super) destination: &'a ForwardDestination,
    pub(super) local_port: u16,
    pub(super) target: RemoteLoopback,
    pub(super) remote_port: u16,
}

impl ForwardPlan<'_> {
    pub(super) fn local_forward(&self) -> String {
        format!(
            "127.0.0.1:{}:{}:{}",
            self.local_port,
            self.target.host(),
            self.remote_port
        )
    }
}

pub(super) trait ForwardProgram: Send + Sync {
    fn command(&self, plan: &ForwardPlan<'_>) -> Command;
}

pub(super) struct SshForwardProgram;

const SSH_OPTIONS: [&str; 14] = [
    "BatchMode=yes",
    "StrictHostKeyChecking=yes",
    "ForwardAgent=no",
    "ForwardX11=no",
    "ExitOnForwardFailure=yes",
    "ControlMaster=no",
    "ControlPath=none",
    "ControlPersist=no",
    "ForkAfterAuthentication=no",
    "PermitLocalCommand=no",
    "GatewayPorts=no",
    "ConnectTimeout=8",
    "ServerAliveInterval=5",
    "ServerAliveCountMax=2",
];

impl ForwardProgram for SshForwardProgram {
    fn command(&self, plan: &ForwardPlan<'_>) -> Command {
        let mut command = Command::new("ssh");
        command.args(["-N", "-T"]);
        for option in SSH_OPTIONS {
            command.args(["-o", option]);
        }
        command
            .args(["-L", &plan.local_forward()])
            .args(["-p", &plan.destination.port.to_string()])
            .args(["-l", &plan.destination.username])
            .args(["--", &plan.destination.host]);
        command
    }
}

pub(super) struct ForwardProcess {
    child: Child,
    reaped: bool,
}

impl ForwardProcess {
    #[cfg(unix)]
    pub(super) fn spawn(mut command: Command) -> Result<Self, String> {
        use std::{os::unix::process::CommandExt, process::Stdio};
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|_| "Unable to start the SSH port forward.".to_string())?;
        Ok(Self {
            child,
            reaped: false,
        })
    }

    #[cfg(not(unix))]
    pub(super) fn spawn(_: Command) -> Result<Self, String> {
        Err("Server port forwarding requires macOS or Linux.".into())
    }

    #[cfg(test)]
    pub(super) fn pid(&self) -> u32 {
        self.child.id()
    }

    #[cfg(unix)]
    pub(super) fn has_exited(&mut self) -> bool {
        if self.reaped {
            return true;
        }
        let mut information = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                self.child.id(),
                information.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            return unsafe { information.assume_init().si_pid() } != 0;
        }
        if std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD) {
            self.reaped = true;
        }
        true
    }

    #[cfg(not(unix))]
    pub(super) fn has_exited(&mut self) -> bool {
        !matches!(self.child.try_wait(), Ok(None))
    }

    fn terminate(&mut self) {
        if self.reaped {
            return;
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reaped = true;
    }
}

impl Drop for ForwardProcess {
    fn drop(&mut self) {
        self.terminate();
    }
}
