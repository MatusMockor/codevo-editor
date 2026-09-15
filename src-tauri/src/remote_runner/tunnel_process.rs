use super::Server;
use std::{
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

// Fixed code only. No token appears in argv, diagnostics, disk or IPC.
const BOOTSTRAP: &str = "import os,sys\nt=open(os.path.expanduser('~/.config/codevo-runner/runner-token')).read(4097).strip()\nif not t or len(t)>4096 or any(ord(c)<33 or ord(c)>126 for c in t): sys.exit(1)\nsys.stdout.write(t+'\\n');sys.stdout.flush()\nsys.stdin.buffer.read(1)";

pub(super) struct TunnelProcess {
    child: Child,
    reaped: bool,
    directory: PrivateDirectory,
}
struct PrivateDirectory(PathBuf);
impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.0.join("socket"));
        let _ = std::fs::remove_dir(&self.0);
    }
}
impl TunnelProcess {
    #[cfg(all(test, unix))]
    pub(super) fn fixture() -> Self {
        use std::os::unix::process::CommandExt;
        let child = Command::new("sleep")
            .arg("60")
            .process_group(0)
            .spawn()
            .unwrap();
        let directory = PrivateDirectory(
            std::env::temp_dir().join(format!("codevo-test-owned-{}", child.id())),
        );
        std::fs::create_dir(&directory.0).unwrap();
        Self {
            child,
            directory,
            reaped: false,
        }
    }
    #[cfg(test)]
    pub(super) fn pid(&self) -> u32 {
        self.child.id()
    }
    #[cfg(unix)]
    pub(super) fn start(
        server: &Server,
        canceled: impl Fn() -> bool,
    ) -> Result<(Self, String), String> {
        use std::os::unix::{ffi::OsStrExt, process::CommandExt};
        if canceled() {
            return Err("Runner connection was canceled.".into());
        }
        let mut template = b"/tmp/codevo-ssh-XXXXXX\0".to_vec();
        let pointer = unsafe { libc::mkdtemp(template.as_mut_ptr().cast()) };
        if pointer.is_null() {
            return Err("Unable to create private runner connection.".into());
        }
        let path = unsafe { std::ffi::CStr::from_ptr(pointer) };
        let directory =
            PrivateDirectory(PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())));
        let forward = format!("{}:127.0.0.1:4318", directory.0.join("socket").display());
        let command = format!("python3 -c '{}'", BOOTSTRAP.replace('\'', "'\\''"));
        let child = Command::new("ssh")
            .args([
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "ForwardAgent=no",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ControlMaster=no",
                "-o",
                "ControlPath=none",
                "-o",
                "ControlPersist=no",
                "-o",
                "ForkAfterAuthentication=no",
                "-o",
                "ConnectTimeout=8",
                "-o",
                "ServerAliveInterval=5",
                "-o",
                "ServerAliveCountMax=2",
                "-L",
                &forward,
                "-p",
                &server.port.to_string(),
                "-l",
                &server.username,
                "--",
                &server.host,
                &command,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|_| "Unable to start SSH tunnel.".to_string())?;
        let mut process = Self {
            child,
            directory,
            reaped: false,
        };
        let mut stdout = process
            .child
            .stdout
            .take()
            .ok_or("Unable to open SSH handshake.")?;
        use std::os::fd::AsRawFd;
        let fd = stdout.as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err("Unable to configure SSH handshake.".into());
        }
        let start = Instant::now();
        let mut output = Vec::new();
        loop {
            if canceled() || start.elapsed() >= Duration::from_secs(12) || !process.is_alive() {
                return Err(
                    "SSH tunnel connection failed. Check SSH access and runner authentication."
                        .into(),
                );
            }
            let mut buffer = [0; 4098];
            match stdout.read(&mut buffer) {
                Ok(0) => return Err("SSH tunnel authentication failed.".into()),
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => return Err("SSH tunnel authentication failed.".into()),
            }
            if output.len() > 4097 {
                return Err("Invalid runner authentication.".into());
            }
            if output.last() == Some(&b'\n') {
                output.pop();
                if output.is_empty() || output.iter().any(|b| !(33..=126).contains(b)) {
                    return Err("Invalid runner authentication.".into());
                }
                return Ok((
                    process,
                    String::from_utf8(output).map_err(|_| "Invalid runner authentication.")?,
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    #[cfg(not(unix))]
    pub(super) fn start(_: &Server, _: impl Fn() -> bool) -> Result<(Self, String), String> {
        Err("SSH runner connections require macOS or Linux.".into())
    }
    pub(super) fn client(&self) -> Result<reqwest::Client, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(5));
        #[cfg(unix)]
        let builder = builder.unix_socket(self.directory.0.join("socket"));
        builder
            .build()
            .map_err(|_| "Unable to configure runner HTTP connection.".into())
    }
    #[cfg(unix)]
    pub(super) fn socket_path(&self) -> PathBuf {
        self.directory.0.join("socket")
    }
    pub(super) fn is_alive(&mut self) -> bool {
        if self.reaped {
            return false;
        }
        #[cfg(unix)]
        {
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
                if unsafe { information.assume_init().si_pid() } == 0 {
                    return true;
                }
                // Retain the zombie leader until group cleanup, so its ID cannot be reused.
                self.terminate();
                return false;
            }
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD) {
                self.reaped = true;
            }
            false
        }
        #[cfg(not(unix))]
        {
            matches!(self.child.try_wait(), Ok(None))
        }
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
impl Drop for TunnelProcess {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn already_reaped_process_is_marked_before_drop() {
        let mut process = TunnelProcess::fixture();
        process.child.kill().unwrap();
        let started = Instant::now();
        while process.is_alive() {
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(process.reaped);
        assert!(!process.is_alive());
        // Drop's reaped guard returns before signaling the cached process-group number.
        drop(process);
    }
}
