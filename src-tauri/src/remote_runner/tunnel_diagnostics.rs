use std::{io::Read, process::ChildStderr, sync::mpsc::Receiver};

const PREFIX_LIMIT: usize = 8192;

pub(super) enum HandshakeFailure {
    ReadinessTimedOut,
    ProcessExited,
    TokenUnavailable,
    Canceled,
}

impl HandshakeFailure {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::ReadinessTimedOut => "SSH tunnel readiness timed out.",
            Self::ProcessExited | Self::Canceled => {
                "SSH tunnel connection failed. Check SSH access and runner authentication."
            }
            Self::TokenUnavailable => "SSH tunnel authentication failed.",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FailureReason {
    HostUnreachable,
    ConnectionTimedOut,
    ConnectionRefused,
    HostNotResolved,
    HostKeyNotTrusted,
    AuthenticationDenied,
    ForwardFailed,
    Unknown,
}

impl FailureReason {
    pub(super) fn message(self, fallback: &'static str) -> &'static str {
        match self {
            Self::HostUnreachable => "SSH tunnel host is unreachable.",
            Self::ConnectionTimedOut => "SSH tunnel connection timed out.",
            Self::ConnectionRefused => "SSH tunnel connection was refused.",
            Self::HostNotResolved => "SSH tunnel host name could not be resolved.",
            Self::HostKeyNotTrusted => "SSH tunnel host key is not trusted or has changed.",
            Self::AuthenticationDenied => "SSH tunnel authentication was denied.",
            Self::ForwardFailed => "SSH tunnel port forwarding failed.",
            Self::Unknown => fallback,
        }
    }
}

struct Diagnostic {
    bytes: Vec<u8>,
    truncated: bool,
}

fn classify(diagnostic: &Diagnostic) -> FailureReason {
    if diagnostic.truncated {
        return FailureReason::Unknown;
    }
    let text = match std::str::from_utf8(&diagnostic.bytes) {
        Ok(text) => text,
        Err(_) => return FailureReason::Unknown,
    };
    let mut reason = FailureReason::Unknown;
    for line in text.lines() {
        let candidate = classify_line(line);
        if candidate == FailureReason::Unknown {
            continue;
        }
        if reason != FailureReason::Unknown && reason != candidate {
            return FailureReason::Unknown;
        }
        reason = candidate;
    }
    reason
}

fn classify_line(line: &str) -> FailureReason {
    if line.starts_with("ssh: connect to host ") {
        for (suffix, reason) in [
            (": No route to host", FailureReason::HostUnreachable),
            (": Network is unreachable", FailureReason::HostUnreachable),
            (": Host is down", FailureReason::HostUnreachable),
            (": Operation timed out", FailureReason::ConnectionTimedOut),
            (": Connection timed out", FailureReason::ConnectionTimedOut),
            (": Connection refused", FailureReason::ConnectionRefused),
        ] {
            if line.ends_with(suffix) {
                return reason;
            }
        }
        return FailureReason::Unknown;
    }
    if line.starts_with("ssh: Could not resolve hostname ") {
        return FailureReason::HostNotResolved;
    }
    if is_authentication_denial(line) {
        return FailureReason::AuthenticationDenied;
    }
    if line == "Host key verification failed."
        || line.starts_with("@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!")
    {
        return FailureReason::HostKeyNotTrusted;
    }
    if line.starts_with("Could not request local forwarding") || line.starts_with("unix_listener:")
    {
        return FailureReason::ForwardFailed;
    }
    FailureReason::Unknown
}

fn is_authentication_denial(line: &str) -> bool {
    let Some((account, methods)) = line.split_once(": Permission denied (") else {
        return false;
    };
    account.contains('@') && !account.contains(char::is_whitespace) && methods.ends_with(").")
}

fn read_prefix(mut reader: impl Read) -> Diagnostic {
    let mut diagnostic = Diagnostic {
        bytes: Vec::with_capacity(PREFIX_LIMIT),
        truncated: false,
    };
    let mut buffer = [0; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return diagnostic,
            Ok(count) => {
                let retained = count.min(PREFIX_LIMIT - diagnostic.bytes.len());
                diagnostic.bytes.extend_from_slice(&buffer[..retained]);
                diagnostic.truncated |= retained < count;
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                return Diagnostic {
                    bytes: Vec::new(),
                    truncated: false,
                }
            }
        }
    }
}

pub(super) fn drain(stderr: ChildStderr) -> std::io::Result<Receiver<FailureReason>> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("runner-ssh-stderr".into())
        .spawn(move || {
            let _ = sender.send(classify(&read_prefix(stderr)));
        })?;
    Ok(receiver)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reason(input: &[u8]) -> FailureReason {
        classify(&read_prefix(input))
    }

    #[test]
    fn classifies_standard_ssh_failure_lines() {
        for (text, expected) in [
            (
                "ssh: connect to host h port 22: No route to host",
                FailureReason::HostUnreachable,
            ),
            (
                "ssh: connect to host h port 22: Network is unreachable",
                FailureReason::HostUnreachable,
            ),
            (
                "ssh: connect to host h port 22: Host is down",
                FailureReason::HostUnreachable,
            ),
            (
                "ssh: connect to host h port 22: Operation timed out",
                FailureReason::ConnectionTimedOut,
            ),
            (
                "ssh: connect to host h port 22: Connection timed out",
                FailureReason::ConnectionTimedOut,
            ),
            (
                "ssh: connect to host h port 22: Connection refused",
                FailureReason::ConnectionRefused,
            ),
            (
                "ssh: Could not resolve hostname h: nodename nor servname provided, or not known",
                FailureReason::HostNotResolved,
            ),
            (
                "Host key verification failed.\r",
                FailureReason::HostKeyNotTrusted,
            ),
            (
                "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
                FailureReason::HostKeyNotTrusted,
            ),
            (
                "u@h: Permission denied (publickey).",
                FailureReason::AuthenticationDenied,
            ),
            (
                "Could not request local forwarding.",
                FailureReason::ForwardFailed,
            ),
            (
                "unix_listener: cannot bind to path /tmp/socket: Address already in use",
                FailureReason::ForwardFailed,
            ),
        ] {
            assert_eq!(reason(format!("{text}\n").as_bytes()), expected);
        }
    }

    #[test]
    fn remote_output_and_unanchored_patterns_are_unknown() {
        for line in [
            "/home/u/.bashrc: line 12: bind: warning: line editing not enabled",
            "PermissionError: [Errno 13] Permission denied: '.../runner-token'",
            "bash: ~/.bash_profile: Permission denied",
            "error: /home/u/.config/tool: Permission denied (os error 13)",
            "u@h said: Permission denied (publickey).",
            "u@h: Permission denied (publickey)",
            "bind [127.0.0.1]:42219: Address already in use",
            "Welcome: Host key verification failed",
            "Welcome: Host key verification failed.",
            "No route to host",
            "Connection refused",
            "Could not resolve hostname h",
            "REMOTE HOST IDENTIFICATION HAS CHANGED",
            "bind: failed",
            "bind [/private/socket]: failed",
            "Address already in use",
            "remote port forwarding failed for listen port 22",
        ] {
            assert_eq!(reason(line.as_bytes()), FailureReason::Unknown);
            assert_eq!(
                reason(format!("{line}\nbootstrap exited unsuccessfully\n").as_bytes()),
                FailureReason::Unknown
            );
        }
    }

    #[test]
    fn unknown_ambiguous_and_non_utf8_diagnostics_fail_closed() {
        for input in [
            &b""[..],
            &b"garbage bootstrap error"[..],
            &b"u@h: Permission denied (publickey).\nssh: connect to host h port 22: Connection refused"[..],
            &b"u@h: Permission denied (publickey).\xff"[..],
        ] {
            assert_eq!(reason(input), FailureReason::Unknown);
        }
        assert_eq!(
            FailureReason::Unknown.message("existing failure"),
            "existing failure"
        );
        assert_eq!(reason(b"ssh: connect to host h port 22: No route to host\nssh: connect to host h port 22: Network is unreachable"), FailureReason::HostUnreachable);
    }

    #[test]
    fn reader_marks_discarded_output_and_classifier_fails_closed() {
        let mut bytes = b"u@h: Permission denied (publickey).\n".to_vec();
        bytes.resize(PREFIX_LIMIT, b'x');
        let complete = read_prefix(bytes.as_slice());
        assert!(!complete.truncated);
        assert_eq!(classify(&complete), FailureReason::AuthenticationDenied);
        bytes.push(b'x');
        let truncated = read_prefix(bytes.as_slice());
        assert_eq!(truncated.bytes.len(), PREFIX_LIMIT);
        assert!(truncated.truncated);
        assert_eq!(classify(&truncated), FailureReason::Unknown);
    }

    #[cfg(unix)]
    #[test]
    fn drains_output_larger_than_the_pipe_while_retaining_only_the_prefix() {
        use std::{
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let mut child = Command::new("sh")
            .args(["-c", "printf 'u@h: Permission denied (publickey).\\n' >&2; dd if=/dev/zero bs=1024 count=1024 >&2 2>/dev/null"])
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stderr = child.stderr.take().unwrap();
        let reader = std::thread::spawn(move || read_prefix(stderr));
        let started = Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            if started.elapsed() >= Duration::from_secs(5) {
                child.kill().unwrap();
                child.wait().unwrap();
                reader.join().unwrap();
                panic!("stderr producer blocked");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let diagnostic = reader.join().unwrap();
        assert_eq!(diagnostic.bytes.len(), PREFIX_LIMIT);
        assert!(diagnostic.truncated);
        assert!(diagnostic
            .bytes
            .starts_with(b"u@h: Permission denied (publickey).\n"));
        assert_eq!(classify(&diagnostic), FailureReason::Unknown);
    }
}
