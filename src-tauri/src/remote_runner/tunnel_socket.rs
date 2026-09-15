use std::{
    io::{Read, Write},
    os::unix::net::UnixStream,
    time::{Duration, Instant},
};

/// Bounds one complete WebSocket message, including endless incomplete frames.
pub(in crate::remote_runner) struct DeadlineStream {
    socket: UnixStream,
    deadline: Instant,
}
impl DeadlineStream {
    pub(in crate::remote_runner) fn new(socket: UnixStream, timeout: Duration) -> Self {
        Self {
            socket,
            deadline: Instant::now() + timeout,
        }
    }
    pub(in crate::remote_runner) fn socket(&self) -> &UnixStream {
        &self.socket
    }
    pub(in crate::remote_runner) fn refresh_read_deadline(&mut self, timeout: Duration) {
        self.deadline = Instant::now() + timeout;
    }
}
impl Read for DeadlineStream {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        if Instant::now() >= self.deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Runner message timed out",
            ));
        }
        self.socket.read(bytes)
    }
}
impl Write for DeadlineStream {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.socket.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.socket.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_fragment_trickle_cannot_extend_message_deadline() {
        let (client, mut server) = UnixStream::pair().unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        let writer = std::thread::spawn(move || {
            if server.write_all(&[0x01, 0]).is_err() {
                return;
            }
            for _ in 0..200 {
                if server.write_all(&[0x00, 0]).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        let mut socket = tungstenite::WebSocket::from_raw_socket(
            DeadlineStream::new(client, Duration::from_millis(50)),
            tungstenite::protocol::Role::Client,
            None,
        );
        let started = Instant::now();
        assert!(
            matches!(socket.read(), Err(tungstenite::Error::Io(error)) if error.kind()==std::io::ErrorKind::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(socket);
        writer.join().unwrap();
    }
}
