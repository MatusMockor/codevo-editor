use super::super::types::Server;
use super::{
    response_limit, validate_destination, RequestPermit, ACTIVE_REQUESTS, MAX_INPUT, TIMEOUT,
};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[path = "tunnel_http.rs"]
mod tunnel_http;
#[path = "tunnel_process.rs"]
mod tunnel_process;

/// An exact connection owner. Secrets and local endpoints never cross IPC.
pub(in crate::remote_runner) struct Session {
    process: Mutex<Option<tunnel_process::TunnelProcess>>,
    closed: AtomicBool,
    client: reqwest::Client,
    token: String,
}

impl Session {
    #[cfg(all(test, unix))]
    pub(in crate::remote_runner) fn fixture() -> Self {
        let process = tunnel_process::TunnelProcess::fixture();
        let client = process.client().unwrap();
        Self {
            process: Mutex::new(Some(process)),
            closed: AtomicBool::new(false),
            client,
            token: "test-only".into(),
        }
    }
    #[cfg(test)]
    pub(in crate::remote_runner) fn pid(&self) -> Option<u32> {
        self.process.lock().unwrap().as_ref().map(|p| p.pid())
    }
    #[cfg(test)]
    pub(in crate::remote_runner) fn connect(server: &Server) -> Result<Self, String> {
        Self::connect_with_cancellation(server, || false)
    }
    pub(in crate::remote_runner) fn connect_with_cancellation(
        server: &Server,
        canceled: impl Fn() -> bool,
    ) -> Result<Self, String> {
        validate_destination(&server.host, &server.username)?;
        let _permit = RequestPermit::acquire(&ACTIVE_REQUESTS)?;
        let (process, token) = tunnel_process::TunnelProcess::start(server, canceled)?;
        let client = process.client()?;
        Ok(Self {
            process: Mutex::new(Some(process)),
            closed: AtomicBool::new(false),
            client,
            token,
        })
    }

    pub(in crate::remote_runner) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        // Only process ownership is locked; no network work is performed under it.
        let process = self
            .process
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        drop(process);
    }

    pub(in crate::remote_runner) fn is_alive(&self) -> bool {
        !self.closed.load(Ordering::Acquire)
            && self
                .process
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_mut()
                .is_some_and(|process| process.is_alive())
    }

    #[cfg(unix)]
    pub(in crate::remote_runner) fn connect_websocket(
        &self,
        runner_id: &str,
        canceled: impl Fn() -> bool,
    ) -> Result<tungstenite::WebSocket<super::DeadlineStream>, String> {
        use tungstenite::client::IntoClientRequest;
        if !self.is_alive() {
            return Err("Runner connection is closed.".into());
        }
        let started = std::time::Instant::now();
        let path = self
            .process
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .ok_or("Runner connection is closed.")?
            .socket_path();
        let socket = tauri::async_runtime::block_on(async {
            let connecting = tokio::net::UnixStream::connect(path);
            tokio::pin!(connecting);
            loop {
                if canceled() || self.closed.load(Ordering::Acquire) || started.elapsed() >= std::time::Duration::from_secs(5) { return Err("Runner event connection canceled or timed out.".to_string()); }
                tokio::select! {
                    result = &mut connecting => return result.map_err(|_| "Unable to open runner event connection.".to_string()),
                    _ = tokio::time::sleep(std::time::Duration::from_millis(25)) => {},
                }
            }
        })?.into_std().map_err(|_| "Unable to configure runner events.")?;
        let mut request = "ws://localhost/v1/changes"
            .into_client_request()
            .map_err(|_| "Invalid runner event request.")?;
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {}", self.token)
                .parse()
                .map_err(|_| "Invalid runner authentication.")?,
        );
        request.headers_mut().insert(
            "x-codevo-runner-id",
            runner_id.parse().map_err(|_| "Invalid runner identity.")?,
        );
        let config = tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(4096))
            .max_frame_size(Some(4096));
        let mut handshake = tungstenite::client::client_with_config(
            request,
            super::DeadlineStream::new(socket, std::time::Duration::from_secs(5)),
            Some(config),
        );
        let mut websocket = loop {
            if canceled()
                || self.closed.load(Ordering::Acquire)
                || started.elapsed() >= std::time::Duration::from_secs(5)
            {
                return Err("Runner event connection canceled or timed out.".into());
            }
            match handshake {
                Ok((socket, _)) => break socket,
                Err(tungstenite::HandshakeError::Interrupted(pending)) => {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                    handshake = pending.handshake();
                }
                Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(response)))
                    if response.status().as_u16() == 401 =>
                {
                    self.close();
                    return Err("Runner authentication changed. Retry to reconnect.".into());
                }
                Err(_) => return Err("Unable to connect runner event stream.".into()),
            }
        };
        websocket
            .get_ref()
            .socket()
            .set_nonblocking(false)
            .map_err(|_| "Unable to configure runner events.")?;
        websocket
            .get_ref()
            .socket()
            .set_read_timeout(Some(std::time::Duration::from_millis(250)))
            .map_err(|_| "Unable to configure runner events.")?;
        websocket
            .get_ref()
            .socket()
            .set_write_timeout(Some(std::time::Duration::from_millis(250)))
            .map_err(|_| "Unable to configure runner events.")?;
        websocket
            .get_mut()
            .refresh_read_deadline(std::time::Duration::from_secs(30));
        if self.closed.load(Ordering::Acquire) {
            return Err("Runner connection is closed.".into());
        }
        Ok(websocket)
    }

    pub(in crate::remote_runner) fn request(
        &self,
        server: &Server,
        method: &str,
        path: &str,
        body: Option<Value>,
        headers: Vec<(String, String)>,
    ) -> Result<Value, String> {
        let _permit = RequestPermit::acquire(&ACTIVE_REQUESTS)?;
        if !self.is_alive() {
            return Err("Runner connection is closed. Reconnect the server.".into());
        }
        let request = tunnel_http::prepare(method, path, body, headers)?;
        let result = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                TIMEOUT,
                tunnel_http::request(
                    &self.client,
                    &self.token,
                    server.runner_id.as_deref(),
                    request,
                    response_limit(method, path),
                ),
            )
            .await
            .map_err(|_| "Runner request timed out. Its outcome may be unknown.".to_string())?
        });
        if result
            .as_ref()
            .err()
            .is_some_and(|e| e == "Runner request failed (HTTP 401).")
        {
            self.close();
        }
        if self.closed.load(Ordering::Acquire) {
            return Err("Runner connection changed during request.".into());
        }
        result
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn fixture_server() -> Server {
        Server {
            id: "fixture".into(),
            name: "Fixture".into(),
            host: "localhost".into(),
            username: "test".into(),
            port: 22,
            connected: true,
            runner_id: None,
        }
    }
    #[test]
    fn authentication_failure_closes_tunnel_without_replaying_request() {
        use std::io::{Read, Write};
        let session = Session::fixture();
        let path = session
            .process
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .socket_path();
        let listener = std::os::unix::net::UnixListener::bind(path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut byte = [0];
                socket.read_exact(&mut byte).unwrap();
                bytes.push(byte[0]);
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            socket
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });
        assert!(session
            .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
            .is_err());
        server.join().unwrap();
        assert!(!session.is_alive());
        assert!(session
            .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
            .is_err());
    }
    #[test]
    fn websocket_handshake_has_total_deadline_and_observes_cancellation() {
        use std::io::Read;
        for cancel in [true, false] {
            let session = Session::fixture();
            let path = session
                .process
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .socket_path();
            let listener = std::os::unix::net::UnixListener::bind(path).unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(7)))
                    .unwrap();
                let _ = socket.read_to_end(&mut Vec::new());
            });
            let started = std::time::Instant::now();
            assert!(session
                .connect_websocket("pinned", || cancel
                    && started.elapsed() >= std::time::Duration::from_millis(50))
                .is_err());
            assert!(started.elapsed() < std::time::Duration::from_secs(if cancel { 2 } else { 6 }));
            server.join().unwrap();
        }
    }
    #[test]
    #[ignore = "requires explicit live runner SSH configuration"]
    fn live_tunnel_reuses_process_for_twenty_requests_and_reaps_on_close() {
        let server = Server {
            id: "live-transport-test".into(),
            name: "Live verification".into(),
            host: std::env::var("CODEVO_RUNNER_LIVE_HOST").expect("explicit live host"),
            username: std::env::var("CODEVO_RUNNER_LIVE_USER").expect("explicit live user"),
            port: 22,
            connected: true,
            runner_id: Some(
                std::env::var("CODEVO_RUNNER_LIVE_ID").expect("explicit pinned runner identity"),
            ),
        };
        let session = Session::connect(&server).unwrap();
        let pid = session.pid().unwrap();
        let mut samples = Vec::new();
        for _ in 0..20 {
            let start = std::time::Instant::now();
            let value = session
                .request(&server, "GET", "/v1/runner", None, vec![])
                .unwrap();
            assert_eq!(
                value.get("runnerId").and_then(Value::as_str),
                server.runner_id.as_deref()
            );
            assert_eq!(session.pid(), Some(pid));
            assert!(session.is_alive());
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        samples.sort_by(f64::total_cmp);
        eprintln!(
            "persistent tunnel 20 reads median_ms={:.3} p95_ms={:.3}; one owned SSH process",
            (samples[9] + samples[10]) / 2.0,
            samples[18]
        );
        session.close();
        assert!(!session.is_alive());
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
}
