use super::Server;
use std::{
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[path = "tunnel_diagnostics.rs"]
mod tunnel_diagnostics;
use tunnel_diagnostics::{FailureReason, HandshakeFailure};

// Fixed code only. No token appears in argv, diagnostics, disk or IPC.
const BOOTSTRAP: &str = "import os,sys\nt=open(os.path.expanduser('~/.config/codevo-runner/runner-token')).read(4097).strip()\nif not t or len(t)>4096 or any(ord(c)<33 or ord(c)>126 for c in t): sys.exit(1)\nsys.stdout.write(t+'\\n');sys.stdout.flush()\nsys.stdin.buffer.read(1)";

pub(super) struct TunnelProcess {
    child: Child,
    reaped: bool,
    directory: PrivateDirectory,
    stderr: Option<std::sync::mpsc::Receiver<FailureReason>>,
    failure_reason: FailureReason,
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
        Self::fixture_script("exec sleep 60")
    }
    #[cfg(all(test, unix))]
    fn fixture_script(script: &str) -> Self {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("sh")
            .args(["-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let directory = PrivateDirectory(
            std::env::temp_dir().join(format!("codevo-test-owned-{}", child.id())),
        );
        std::fs::create_dir(&directory.0).unwrap();
        let stderr = Some(tunnel_diagnostics::drain(child.stderr.take().unwrap()).unwrap());
        Self {
            child,
            directory,
            reaped: false,
            stderr,
            failure_reason: FailureReason::Unknown,
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
                "ConnectTimeout=10",
                "-o",
                "LogLevel=INFO",
                "-o",
                "ServerAliveInterval=10",
                "-o",
                "ServerAliveCountMax=3",
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
            .stderr(Stdio::piped())
            .env("LC_ALL", "C")
            .process_group(0)
            .spawn()
            .map_err(|_| "Unable to start SSH tunnel.".to_string())?;
        let mut process = Self {
            child,
            directory,
            reaped: false,
            stderr: None,
            failure_reason: FailureReason::Unknown,
        };
        let stderr = process
            .child
            .stderr
            .take()
            .ok_or("Unable to open SSH handshake.")?;
        process.stderr = Some(
            tunnel_diagnostics::drain(stderr).map_err(|_| "Unable to configure SSH handshake.")?,
        );
        let token = process.readiness_token(canceled)?;
        Ok((process, token))
    }
    #[cfg(unix)]
    fn readiness_token(&mut self, canceled: impl Fn() -> bool) -> Result<String, String> {
        let mut stdout = self
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
            if canceled() {
                return Err(HandshakeFailure::Canceled.message().into());
            }
            if start.elapsed() >= Duration::from_secs(20) {
                return Err(self.handshake_failure(HandshakeFailure::ReadinessTimedOut));
            }
            if !self.is_alive() {
                return Err(self.handshake_failure(HandshakeFailure::ProcessExited));
            }
            let mut buffer = [0; 4098];
            match stdout.read(&mut buffer) {
                Ok(0) => return Err(self.handshake_failure(HandshakeFailure::TokenUnavailable)),
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => return Err(self.handshake_failure(HandshakeFailure::TokenUnavailable)),
            }
            if output.len() > 4097 {
                return Err("Invalid runner authentication.".into());
            }
            if output.last() == Some(&b'\n') {
                output.pop();
                if output.is_empty() || output.iter().any(|b| !(33..=126).contains(b)) {
                    return Err("Invalid runner authentication.".into());
                }
                return String::from_utf8(output)
                    .map_err(|_| "Invalid runner authentication.".into());
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
    fn handshake_failure(&mut self, phase: HandshakeFailure) -> String {
        self.terminate();
        self.failure_reason.message(phase.message()).into()
    }
    fn terminate(&mut self) {
        if self.reaped {
            self.finish_stderr();
            return;
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as i32), libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reaped = true;
        self.finish_stderr();
    }
    fn finish_stderr(&mut self) {
        if let Some(stderr) = self.stderr.take() {
            self.failure_reason = stderr
                .recv_timeout(Duration::from_millis(300))
                .unwrap_or(FailureReason::Unknown);
        }
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
        assert!(process.stderr.is_none());
        assert!(!process.is_alive());
        // Drop's reaped guard returns before signaling the cached process-group number.
        drop(process);
    }

    #[test]
    fn dropping_process_reaps_its_process_group() {
        let mut process = TunnelProcess::fixture_script("sleep 60 & printf ready; wait");
        let mut ready = [0; 5];
        process
            .child
            .stdout
            .take()
            .unwrap()
            .read_exact(&mut ready)
            .unwrap();
        assert_eq!(&ready, b"ready");
        let pid = process.pid();
        let started = Instant::now();
        process.terminate();
        assert_eq!(process.failure_reason, FailureReason::Unknown);
        drop(process);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }

    struct StrayProcess {
        pid: Option<i32>,
        stdout: std::io::BufReader<std::process::ChildStdout>,
    }

    impl StrayProcess {
        fn cleanup(mut self) {
            use std::os::fd::AsRawFd;
            if let Some(pid) = self.pid.take() {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
            let fd = self.stdout.get_ref().as_raw_fd();
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            assert!(flags >= 0);
            assert_eq!(
                unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) },
                0
            );
            let started = Instant::now();
            loop {
                match self.stdout.read(&mut [0; 1]) {
                    Ok(0) => return,
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => panic!("stray process cleanup failed: {error}"),
                }
                assert!(started.elapsed() < Duration::from_secs(2));
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    impl Drop for StrayProcess {
        fn drop(&mut self) {
            if let Some(pid) = self.pid.take() {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
    }

    fn escaped_stderr_holder() -> (TunnelProcess, StrayProcess) {
        use std::io::{BufRead, BufReader};
        let mut process = TunnelProcess::fixture_script(
            "exec perl -e 'use POSIX; pipe(my $r, my $w) or die; my $pid = fork(); die unless defined $pid; if (!$pid) { close $r; setsid() >= 0 or die; print $w \"ready\\n\"; close $w; sleep 60; exit; } close $w; <$r>; print \"$pid\\n\"; $| = 1; <STDIN>;'",
        );
        let mut pid = String::new();
        let mut stdout = BufReader::new(process.child.stdout.take().unwrap());
        stdout.read_line(&mut pid).unwrap();
        let pid = pid.trim().parse().unwrap();
        let stray = StrayProcess {
            pid: Some(pid),
            stdout,
        };
        assert_ne!(unsafe { libc::getpgid(pid) }, process.pid() as i32);
        (process, stray)
    }

    #[test]
    fn escaped_stderr_holder_does_not_block_terminate_or_drop() {
        let (mut process, stray) = escaped_stderr_holder();
        let started = Instant::now();
        process.terminate();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(process.failure_reason, FailureReason::Unknown);
        assert!(process.stderr.is_none());
        stray.cleanup();
        drop(process);

        let (process, stray) = escaped_stderr_holder();
        let started = Instant::now();
        drop(process);
        assert!(started.elapsed() < Duration::from_secs(2));
        stray.cleanup();
    }

    #[test]
    fn exited_leader_with_escaped_stderr_holder_does_not_block_is_alive() {
        use std::io::Write;
        let (mut process, stray) = escaped_stderr_holder();
        process
            .child
            .stdin
            .take()
            .unwrap()
            .write_all(b"exit\n")
            .unwrap();
        let started = Instant::now();
        while process.is_alive() {
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(process.failure_reason, FailureReason::Unknown);
        assert!(process.stderr.is_none());
        stray.cleanup();
        drop(process);
    }

    #[test]
    fn handshake_phases_preserve_unknown_fallbacks_and_use_fixed_diagnostics() {
        for (phase, expected) in [
            (
                HandshakeFailure::ReadinessTimedOut,
                "SSH tunnel readiness timed out.",
            ),
            (
                HandshakeFailure::ProcessExited,
                "SSH tunnel connection failed. Check SSH access and runner authentication.",
            ),
            (
                HandshakeFailure::TokenUnavailable,
                "SSH tunnel authentication failed.",
            ),
            (
                HandshakeFailure::Canceled,
                "SSH tunnel connection failed. Check SSH access and runner authentication.",
            ),
        ] {
            let mut process = TunnelProcess::fixture_script(
                "printf 'bash: ~/.bash_profile: Permission denied\\n' >&2; exit 255",
            );
            process
                .child
                .stdout
                .take()
                .unwrap()
                .read_to_end(&mut Vec::new())
                .unwrap();
            assert_eq!(process.handshake_failure(phase), expected);
            assert!(process.reaped);
            assert!(process.stderr.is_none());
        }
        let mut process = TunnelProcess::fixture_script(
            "printf 'u@h: Permission denied (publickey).\\n' >&2; exit 255",
        );
        process
            .child
            .stdout
            .take()
            .unwrap()
            .read_to_end(&mut Vec::new())
            .unwrap();
        assert_eq!(
            process.handshake_failure(HandshakeFailure::ProcessExited),
            "SSH tunnel authentication was denied."
        );
    }
}
