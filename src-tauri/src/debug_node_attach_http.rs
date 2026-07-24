use std::io::{Read, Write};

const MAX_RESPONSE_HEADER_BYTES: usize = 32 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 256 * 1024;
const READ_BUFFER_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NodeAttachHttpFailure {
    Io,
    HeaderTooLarge,
    MalformedResponse,
    UnexpectedStatus,
    AmbiguousFraming,
    UnsupportedTransferEncoding,
    BodyTooLarge,
    TruncatedBody,
}

/// Fetches exactly one bounded Node inspector target-list response over the
/// caller's already-connected and kernel-proven socket. This function never
/// reconnects and deliberately accepts only a single Content-Length framing;
/// chunked and close-delimited bodies are rejected.
pub(super) fn fetch_json_list(
    io: &mut (impl Read + Write),
    port: u16,
) -> Result<Vec<u8>, NodeAttachHttpFailure> {
    let request = format!(
        "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: keep-alive\r\n\r\n"
    );
    io.write_all(request.as_bytes())
        .map_err(|_| NodeAttachHttpFailure::Io)?;
    io.flush().map_err(|_| NodeAttachHttpFailure::Io)?;

    let mut received = Vec::new();
    let header_end = loop {
        if let Some(index) = find_bytes(&received, b"\r\n\r\n") {
            break index + 4;
        }
        if received.len() >= MAX_RESPONSE_HEADER_BYTES {
            return Err(NodeAttachHttpFailure::HeaderTooLarge);
        }
        let remaining = MAX_RESPONSE_HEADER_BYTES - received.len();
        let mut buffer = [0_u8; READ_BUFFER_BYTES];
        let chunk_len = remaining.min(buffer.len());
        let read = io
            .read(&mut buffer[..chunk_len])
            .map_err(|_| NodeAttachHttpFailure::Io)?;
        if read == 0 {
            return Err(NodeAttachHttpFailure::MalformedResponse);
        }
        received.extend_from_slice(&buffer[..read]);
    };

    let content_length = parse_headers(&received[..header_end])?;
    if content_length > MAX_RESPONSE_BODY_BYTES {
        return Err(NodeAttachHttpFailure::BodyTooLarge);
    }
    let response_end = header_end
        .checked_add(content_length)
        .ok_or(NodeAttachHttpFailure::BodyTooLarge)?;
    if received.len() > response_end {
        return Err(NodeAttachHttpFailure::AmbiguousFraming);
    }
    received
        .try_reserve(response_end.saturating_sub(received.len()))
        .map_err(|_| NodeAttachHttpFailure::BodyTooLarge)?;
    while received.len() < response_end {
        let mut buffer = [0_u8; READ_BUFFER_BYTES];
        let remaining = response_end - received.len();
        let chunk_len = remaining.min(buffer.len());
        let read = io
            .read(&mut buffer[..chunk_len])
            .map_err(|_| NodeAttachHttpFailure::Io)?;
        if read == 0 {
            return Err(NodeAttachHttpFailure::TruncatedBody);
        }
        received.extend_from_slice(&buffer[..read]);
    }
    Ok(received.split_off(header_end))
}

fn parse_headers(headers: &[u8]) -> Result<usize, NodeAttachHttpFailure> {
    let text =
        std::str::from_utf8(headers).map_err(|_| NodeAttachHttpFailure::MalformedResponse)?;
    let mut lines = text
        .strip_suffix("\r\n\r\n")
        .ok_or(NodeAttachHttpFailure::MalformedResponse)?
        .split("\r\n");
    let status = lines
        .next()
        .ok_or(NodeAttachHttpFailure::MalformedResponse)?;
    let mut status_parts = status.split(' ');
    let version = status_parts
        .next()
        .ok_or(NodeAttachHttpFailure::MalformedResponse)?;
    let code = status_parts
        .next()
        .ok_or(NodeAttachHttpFailure::MalformedResponse)?;
    if !matches!(version, "HTTP/1.0" | "HTTP/1.1")
        || code.len() != 3
        || !code.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(NodeAttachHttpFailure::MalformedResponse);
    }
    if code != "200" {
        return Err(NodeAttachHttpFailure::UnexpectedStatus);
    }

    let mut content_length = None;
    let mut transfer_encoding = false;
    for line in lines {
        if line.is_empty()
            || line.starts_with([' ', '\t'])
            || line
                .bytes()
                .any(|byte| byte.is_ascii_control() && byte != b'\t')
        {
            return Err(NodeAttachHttpFailure::MalformedResponse);
        }
        let (name, value) = line
            .split_once(':')
            .ok_or(NodeAttachHttpFailure::MalformedResponse)?;
        if name.is_empty()
            || !name.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#'
                            ..=b'\'' | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
                    )
            })
        {
            return Err(NodeAttachHttpFailure::MalformedResponse);
        }
        let value = value.trim_matches([' ', '\t']);
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() || value.is_empty() {
                return Err(NodeAttachHttpFailure::AmbiguousFraming);
            }
            let parsed = value
                .parse::<usize>()
                .map_err(|_| NodeAttachHttpFailure::MalformedResponse)?;
            content_length = Some(parsed);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            transfer_encoding = true;
        }
    }
    if transfer_encoding {
        return if content_length.is_some() {
            Err(NodeAttachHttpFailure::AmbiguousFraming)
        } else {
            Err(NodeAttachHttpFailure::UnsupportedTransferEncoding)
        };
    }
    content_length.ok_or(NodeAttachHttpFailure::AmbiguousFraming)
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    struct ScriptedIo {
        response: Cursor<Vec<u8>>,
        request: Vec<u8>,
    }

    impl ScriptedIo {
        fn new(response: impl Into<Vec<u8>>) -> Self {
            Self {
                response: Cursor::new(response.into()),
                request: Vec::new(),
            }
        }
    }

    impl Read for ScriptedIo {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.response.read(buffer)
        }
    }

    impl Write for ScriptedIo {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.request.extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn response(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
        let mut response = format!("{status}\r\n{headers}\r\n\r\n").into_bytes();
        response.extend_from_slice(body);
        response
    }

    #[test]
    fn accepts_exact_bounded_content_length_and_writes_only_json_list_request() {
        let body = br#"[{"id":"target"}]"#;
        let mut io = ScriptedIo::new(response(
            "HTTP/1.1 200 OK",
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}",
                body.len()
            ),
            body,
        ));
        assert_eq!(fetch_json_list(&mut io, 9_229), Ok(body.to_vec()));
        assert_eq!(
            io.request,
            b"GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:9229\r\nAccept: application/json\r\nConnection: keep-alive\r\n\r\n"
        );
    }

    #[test]
    fn rejects_redirect_malformed_and_truncated_responses() {
        let mut redirect = ScriptedIo::new(response(
            "HTTP/1.1 302 Found",
            "Location: http://attacker/\r\nContent-Length: 0",
            b"",
        ));
        assert_eq!(
            fetch_json_list(&mut redirect, 9_229),
            Err(NodeAttachHttpFailure::UnexpectedStatus)
        );

        let mut malformed = ScriptedIo::new(b"HTTP/1.1 200 OK\nContent-Length: 0\n\n".to_vec());
        assert_eq!(
            fetch_json_list(&mut malformed, 9_229),
            Err(NodeAttachHttpFailure::MalformedResponse)
        );

        let mut truncated =
            ScriptedIo::new(response("HTTP/1.1 200 OK", "Content-Length: 4", b"[]"));
        assert_eq!(
            fetch_json_list(&mut truncated, 9_229),
            Err(NodeAttachHttpFailure::TruncatedBody)
        );
    }

    #[test]
    fn rejects_oversize_chunked_and_ambiguous_framing() {
        let mut oversized =
            ScriptedIo::new(response("HTTP/1.1 200 OK", "Content-Length: 262145", b""));
        assert_eq!(
            fetch_json_list(&mut oversized, 9_229),
            Err(NodeAttachHttpFailure::BodyTooLarge)
        );

        let mut chunked = ScriptedIo::new(response(
            "HTTP/1.1 200 OK",
            "Transfer-Encoding: chunked",
            b"2\r\n[]\r\n0\r\n\r\n",
        ));
        assert_eq!(
            fetch_json_list(&mut chunked, 9_229),
            Err(NodeAttachHttpFailure::UnsupportedTransferEncoding)
        );

        let mut duplicate = ScriptedIo::new(response(
            "HTTP/1.1 200 OK",
            "Content-Length: 2\r\nContent-Length: 2",
            b"[]",
        ));
        assert_eq!(
            fetch_json_list(&mut duplicate, 9_229),
            Err(NodeAttachHttpFailure::AmbiguousFraming)
        );

        let mut smuggled = ScriptedIo::new(response(
            "HTTP/1.1 200 OK",
            "Content-Length: 2\r\nTransfer-Encoding: chunked",
            b"[]",
        ));
        assert_eq!(
            fetch_json_list(&mut smuggled, 9_229),
            Err(NodeAttachHttpFailure::AmbiguousFraming)
        );
    }
}
