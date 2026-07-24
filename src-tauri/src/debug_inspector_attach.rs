use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::Path;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_millis(750);
// Keep discovery bounded while allowing a busy workstation to schedule the
// inspector after the TCP handshake has completed.
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 256 * 1024;
const MAX_TARGET_FIELD_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct InspectorTargetWire {
    id: String,
    #[serde(rename = "type")]
    target_type: String,
    url: String,
    web_socket_debugger_url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InspectorAttachTarget {
    pub(crate) id: String,
    pub(crate) source_url: String,
    pub(crate) web_socket_url: String,
}

pub(crate) fn discover_single_node_target(
    root: &Path,
    port: u16,
) -> Result<InspectorAttachTarget, String> {
    if port == 0 {
        return Err("Node inspector attach port must be between 1 and 65535.".to_string());
    }
    let body = fetch_target_list(port)?;
    parse_target_list(root, port, &body)
}

fn fetch_target_list(port: u16) -> Result<Vec<u8>, String> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let mut stream = TcpStream::connect_timeout(&address.into(), CONNECT_TIMEOUT)
        .map_err(|_| "Unable to connect to the loopback Node inspector endpoint.".to_string())?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .and_then(|_| stream.set_write_timeout(Some(IO_TIMEOUT)))
        .map_err(|_| "Unable to configure the Node inspector discovery socket.".to_string())?;
    write!(
        stream,
        "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    )
    .and_then(|_| stream.flush())
    .map_err(|_| "Unable to request the Node inspector target list.".to_string())?;

    read_http_response(&mut stream)
}

fn read_http_response(reader: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                response.extend_from_slice(&chunk[..size]);
                if response.len() > MAX_HEADER_BYTES + MAX_BODY_BYTES {
                    return Err(
                        "Node inspector discovery response exceeded its safety limit.".to_string(),
                    );
                }
                if let Some(body) = parse_http_response_progress(&response)? {
                    return Ok(body);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    parse_http_response(&response)
}

fn parse_http_response(response: &[u8]) -> Result<Vec<u8>, String> {
    parse_http_response_progress(response)?
        .ok_or_else(|| "Node inspector returned an invalid HTTP response.".to_string())
}

fn parse_http_response_progress(response: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let Some(header_end) = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
    else {
        if response.len() > MAX_HEADER_BYTES {
            return Err("Node inspector HTTP headers exceeded their safety limit.".to_string());
        }
        return Ok(None);
    };
    if header_end > MAX_HEADER_BYTES {
        return Err("Node inspector HTTP headers exceeded their safety limit.".to_string());
    }
    let headers = std::str::from_utf8(&response[..header_end])
        .map_err(|_| "Node inspector returned invalid HTTP headers.".to_string())?;
    let mut lines = headers[..headers.len() - 4].split("\r\n");
    if !matches!(lines.next(), Some("HTTP/1.1 200 OK" | "HTTP/1.0 200 OK")) {
        return Err("Node inspector discovery did not return HTTP 200.".to_string());
    }
    let mut content_length = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| "Node inspector returned an invalid HTTP header.".to_string())?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "transfer-encoding" {
            return Err("Node inspector chunked responses are not accepted.".to_string());
        }
        if name == "content-length" {
            if content_length.is_some() {
                return Err("Node inspector returned duplicate Content-Length headers.".to_string());
            }
            content_length =
                Some(value.parse::<usize>().map_err(|_| {
                    "Node inspector returned an invalid Content-Length.".to_string()
                })?);
        }
    }
    let length = content_length
        .ok_or_else(|| "Node inspector response requires Content-Length.".to_string())?;
    if length > MAX_BODY_BYTES {
        return Err("Node inspector response body length is invalid or too large.".to_string());
    }
    let received = response.len().saturating_sub(header_end);
    if received < length {
        return Ok(None);
    }
    if received > length {
        return Err("Node inspector response body length is invalid or too large.".to_string());
    }
    Ok(Some(response[header_end..].to_vec()))
}

fn parse_target_list(root: &Path, port: u16, body: &[u8]) -> Result<InspectorAttachTarget, String> {
    let targets: Vec<InspectorTargetWire> = serde_json::from_slice(body)
        .map_err(|_| "Node inspector returned an invalid target list.".to_string())?;
    if targets.len() != 1 {
        return Err("Node inspector attach requires exactly one target.".to_string());
    }
    let target = targets.into_iter().next().expect("single target");
    if target.target_type != "node"
        || target.id.is_empty()
        || [&target.id, &target.url, &target.web_socket_debugger_url]
            .into_iter()
            .any(|value| {
                value.len() > MAX_TARGET_FIELD_BYTES || value.chars().any(char::is_control)
            })
    {
        return Err("Node inspector target metadata is invalid.".to_string());
    }
    validate_workspace_source_url(root, &target.url)?;
    validate_web_socket_url(port, &target.web_socket_debugger_url)?;
    Ok(InspectorAttachTarget {
        id: target.id,
        source_url: target.url,
        web_socket_url: target.web_socket_debugger_url,
    })
}

fn validate_workspace_source_url(root: &Path, url: &str) -> Result<(), String> {
    if url.contains(['?', '#']) {
        return Err("Node inspector target URL is invalid.".to_string());
    }
    let path = crate::debug_support::path_from_file_url(url)
        .ok_or_else(|| "Node inspector target must identify a workspace file.".to_string())?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Unable to resolve the debug workspace root.".to_string())?;
    let canonical_source = Path::new(&path)
        .canonicalize()
        .map_err(|_| "Unable to resolve the Node inspector target file.".to_string())?;
    if !canonical_source.is_file() || canonical_source.strip_prefix(canonical_root).is_err() {
        return Err("Node inspector target is outside the workspace root.".to_string());
    }
    Ok(())
}

fn validate_web_socket_url(port: u16, url: &str) -> Result<(), String> {
    let prefix = format!("ws://127.0.0.1:{port}/");
    let token = url.strip_prefix(&prefix).ok_or_else(|| {
        "Node inspector WebSocket URL must use the requested loopback port.".to_string()
    })?;
    if token.is_empty()
        || token.len() > 128
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Node inspector WebSocket target token is invalid.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::fs;
    use std::net::TcpListener;
    use std::thread;

    struct FragmentedReader {
        chunks: VecDeque<Vec<u8>>,
    }

    impl FragmentedReader {
        fn new(chunks: &[&[u8]]) -> Self {
            Self {
                chunks: chunks.iter().map(|chunk| chunk.to_vec()).collect(),
            }
        }
    }

    impl Read for FragmentedReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let Some(chunk) = self.chunks.pop_front() else {
                return Ok(0);
            };
            assert!(chunk.len() <= buffer.len());
            buffer[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn parses_one_confined_loopback_node_target() {
        let root = fixture("valid");
        let file = root.join("server.js");
        fs::write(&file, "setInterval(() => {}, 1000)").unwrap();
        let body = serde_json::to_vec(&serde_json::json!([{
            "id":"node-one", "type":"node", "url": format!("file://{}", file.display()),
            "webSocketDebuggerUrl":"ws://127.0.0.1:9229/node-one"
        }]))
        .unwrap();
        assert!(parse_target_list(&root, 9229, &body).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_ambiguity_wrong_type_host_port_and_workspace_escape() {
        let root = fixture("reject");
        let outside = fixture("outside");
        let source = outside.join("server.js");
        fs::write(&source, "x").unwrap();
        for value in [
            serde_json::json!([]),
            serde_json::json!([{"id":"a","type":"node","url":format!("file://{}", source.display()),"webSocketDebuggerUrl":"ws://127.0.0.1:9229/a"},{"id":"b","type":"node","url":format!("file://{}", source.display()),"webSocketDebuggerUrl":"ws://127.0.0.1:9229/b"}]),
            serde_json::json!([{"id":"a","type":"page","url":format!("file://{}", source.display()),"webSocketDebuggerUrl":"ws://127.0.0.1:9229/a"}]),
            serde_json::json!([{"id":"a","type":"node","url":format!("file://{}", source.display()),"webSocketDebuggerUrl":"ws://localhost:9229/a"}]),
            serde_json::json!([{"id":"a","type":"node","url":format!("file://{}", source.display()),"webSocketDebuggerUrl":"ws://127.0.0.1:9230/a"}]),
        ] {
            assert!(parse_target_list(&root, 9229, &serde_json::to_vec(&value).unwrap()).is_err());
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn http_parser_requires_bounded_exact_non_chunked_body() {
        let valid = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]";
        assert_eq!(parse_http_response(valid).unwrap(), b"[]");
        for invalid in [
            &b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\n\r\n"[..],
            &b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n[]"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n[]"[..],
        ] {
            assert!(parse_http_response(invalid).is_err());
        }
        assert!(parse_http_response(&vec![b'x'; MAX_HEADER_BYTES + 1]).is_err());
    }

    #[test]
    fn http_reader_accepts_fragmented_headers_and_body() {
        let mut reader = FragmentedReader::new(&[
            b"HTTP/1.",
            b"1 200 OK\r\nContent-L",
            b"ength: 2\r\nConnection: close\r\n\r",
            b"\n[",
            b"]",
        ]);
        assert_eq!(read_http_response(&mut reader).unwrap(), b"[]");
    }

    #[test]
    fn discovery_connects_only_to_the_requested_loopback_port() {
        let root = fixture("network");
        let source = root.join("server.js");
        fs::write(&source, "x").unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = serde_json::to_vec(&serde_json::json!([{
            "id":"network", "type":"node", "url":format!("file://{}", source.display()),
            "webSocketDebuggerUrl":format!("ws://127.0.0.1:{port}/network")
        }]))
        .unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            let request = String::from_utf8_lossy(&request);
            assert!(request.starts_with("GET /json/list HTTP/1.1\r\n"));
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        assert_eq!(
            discover_single_node_target(&root, port).unwrap().id,
            "network"
        );
        server.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    fn read_http_request(stream: &mut TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut chunk = [0_u8; 64];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let size = stream.read(&mut chunk).unwrap();
            assert!(size > 0, "client closed before completing HTTP request");
            request.extend_from_slice(&chunk[..size]);
            assert!(
                request.len() <= 4 * 1024,
                "HTTP request fixture exceeded cap"
            );
        }
        request
    }

    fn fixture(label: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("codevo-attach-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }
}
