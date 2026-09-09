use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Instant,
};

fn serve(response: Vec<u8>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/latest", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = [0; 4096];
        let count = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..count]).to_lowercase();
        assert!(request.starts_with("get /latest http/1.1"));
        assert!(!request.contains("authorization:"));
        let _ = stream.write_all(&response);
    });
    (endpoint, worker)
}

fn response(status: &str, body: &[u8]) -> Vec<u8> {
    let mut bytes = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

fn query(bytes: Vec<u8>) -> Result<String, RegistryVersionError> {
    let (endpoint, worker) = serve(bytes);
    let result =
        tauri::async_runtime::block_on(fetch_version(&endpoint, || false, Duration::from_secs(2)));
    worker.join().unwrap();
    result
}

#[test]
fn public_metadata_reads_only_strict_version_without_running_a_cli() {
    assert_eq!(
        query(response(
            "200 OK",
            br#"{"name":"ignored","version":"0.153.4","scripts":{"postinstall":"ignored"}}"#
        )),
        Ok("0.153.4".to_string())
    );
    for bytes in [
        br#"{"version":"release 1.2.3"}"#.as_slice(),
        br#"{"version":"v1.2.3"}"#,
        br#"{"version":"1.2.3\n"}"#,
        br#"{"version":null}"#,
        br#"{"version":"1.2.3","version":"2.3.4"}"#,
        br#"{"name":"missing"}"#,
        b"not json",
    ] {
        assert_eq!(
            parse_version(bytes),
            Err(RegistryVersionError::InvalidResponse)
        );
    }
}

#[test]
fn errors_and_redirects_do_not_become_available_versions() {
    for status in ["404 Not Found", "429 Too Many Requests", "503 Unavailable"] {
        assert_eq!(
            query(response(status, br#"{"version":"1.2.3"}"#)),
            Err(RegistryVersionError::Unavailable)
        );
    }
    assert_eq!(
        query(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()),
        Err(RegistryVersionError::Unavailable)
    );
}

#[test]
fn declared_and_streamed_response_sizes_are_bounded() {
    assert_eq!(
        query(response("200 OK", &vec![b' '; MAX_METADATA_BYTES + 1])),
        Err(RegistryVersionError::ResponseTooLarge)
    );
    let mut bytes =
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
    bytes.extend_from_slice(format!("{:x}\r\n", MAX_METADATA_BYTES + 1).as_bytes());
    bytes.extend_from_slice(&vec![b' '; MAX_METADATA_BYTES + 1]);
    bytes.extend_from_slice(b"\r\n0\r\n\r\n");
    assert_eq!(query(bytes), Err(RegistryVersionError::ResponseTooLarge));
}

#[test]
fn cancellation_before_request_prevents_network_work() {
    assert_eq!(
        tauri::async_runtime::block_on(fetch_version(
            "http://127.0.0.1:1/latest",
            || true,
            REQUEST_TIMEOUT
        )),
        Err(RegistryVersionError::Cancelled)
    );
}

fn stalled_request(
    cancel: bool,
    send_headers: bool,
) -> (Result<String, RegistryVersionError>, Duration) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/latest", listener.local_addr().unwrap());
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&cancelled);
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        if send_headers {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{")
                .unwrap();
        }
        signal.store(cancel, Ordering::Release);
        let mut remaining = Vec::new();
        stream.read_to_end(&mut remaining).unwrap();
    });
    let start = Instant::now();
    let result = tauri::async_runtime::block_on(fetch_version(
        &endpoint,
        || cancelled.load(Ordering::Acquire),
        Duration::from_millis(250),
    ));
    let elapsed = start.elapsed();
    worker.join().unwrap();
    (result, elapsed)
}

#[test]
fn cancellation_drops_an_in_flight_request_and_closes_its_connection() {
    for send_headers in [false, true] {
        let (result, elapsed) = stalled_request(true, send_headers);
        assert_eq!(result, Err(RegistryVersionError::Cancelled));
        assert!(elapsed < Duration::from_secs(1));
    }
}

#[test]
fn timeout_drops_an_in_flight_request_and_closes_its_connection() {
    for send_headers in [false, true] {
        let (result, elapsed) = stalled_request(false, send_headers);
        assert_eq!(result, Err(RegistryVersionError::Timeout));
        assert!(elapsed < Duration::from_secs(1));
    }
}
