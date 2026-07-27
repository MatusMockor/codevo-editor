use std::io::{self, BufRead, Write};

const MAX_LSP_FRAME_BYTES: usize = 32 * 1024 * 1024;
const MAX_LSP_HEADER_BYTES: usize = 16 * 1024;
const MAX_LSP_HEADER_LINES: usize = 64;
const MAX_LSP_HEADER_LINE_BYTES: usize = 8 * 1024;

pub fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    if payload.len() > MAX_LSP_FRAME_BYTES {
        return Err(invalid_data("LSP message exceeds frame byte limit"));
    }

    write!(writer, "Content-Length: {}\r\n\r\n", payload.len())?;
    writer.write_all(payload)?;
    writer.flush()
}

pub fn read_message<R: BufRead>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut content_length = None;
    let mut in_header_block = false;
    let mut header_bytes = 0usize;
    let mut header_lines = 0usize;
    let mut line = Vec::new();

    loop {
        line.clear();
        let bytes_read = read_bounded_line(reader, &mut line)?;

        if bytes_read == 0 {
            return if in_header_block {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "truncated LSP header block",
                ))
            } else {
                Ok(None)
            };
        }

        header_bytes = header_bytes
            .checked_add(bytes_read)
            .filter(|bytes| *bytes <= MAX_LSP_HEADER_BYTES)
            .ok_or_else(|| invalid_data("LSP header block exceeds byte limit"))?;
        header_lines = header_lines
            .checked_add(1)
            .filter(|lines| *lines <= MAX_LSP_HEADER_LINES)
            .ok_or_else(|| invalid_data("LSP header block exceeds line limit"))?;

        let line = std::str::from_utf8(&line)
            .map_err(|_| invalid_data("LSP header contains invalid UTF-8"))?;
        let trimmed = line.trim_end_matches(['\r', '\n']);

        if trimmed.is_empty() {
            if !in_header_block {
                continue;
            }

            break;
        }

        let Some((name, value)) = trimmed.split_once(':') else {
            if in_header_block {
                return Err(invalid_data("malformed LSP header line"));
            }
            continue;
        };

        if malformed_reserved_header_name(name, "Content-Length")
            || malformed_reserved_header_name(name, "Content-Type")
            || (in_header_block && !is_ascii_header_name(name))
        {
            return Err(invalid_data("malformed LSP header name"));
        }

        if name.eq_ignore_ascii_case("Content-Type") {
            in_header_block = true;
            continue;
        }

        if !name.eq_ignore_ascii_case("Content-Length") {
            continue;
        }

        in_header_block = true;
        if content_length.is_some() {
            return Err(invalid_data("duplicate Content-Length"));
        }

        let value = trim_ascii_optional_whitespace(value);
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(invalid_data("invalid Content-Length"));
        }
        let length = value
            .parse::<u64>()
            .map_err(|_| invalid_data("invalid Content-Length"))?;
        if length > MAX_LSP_FRAME_BYTES as u64 {
            return Err(invalid_data("LSP message exceeds frame byte limit"));
        }
        content_length =
            Some(usize::try_from(length).map_err(|_| invalid_data("Content-Length overflow"))?);
    }

    let length = content_length.ok_or_else(|| invalid_data("missing Content-Length"))?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

fn read_bounded_line<R: BufRead>(reader: &mut R, line: &mut Vec<u8>) -> io::Result<usize> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(line.len());
        }

        let chunk_length = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line
            .len()
            .checked_add(chunk_length)
            .is_none_or(|length| length > MAX_LSP_HEADER_LINE_BYTES)
        {
            return Err(invalid_data("LSP header line exceeds byte limit"));
        }

        line.extend_from_slice(&available[..chunk_length]);
        reader.consume(chunk_length);

        if line.last() == Some(&b'\n') {
            return Ok(line.len());
        }
    }
}

fn invalid_data(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn malformed_reserved_header_name(name: &str, reserved: &str) -> bool {
    if name.eq_ignore_ascii_case(reserved) {
        return false;
    }

    name.trim().eq_ignore_ascii_case(reserved)
        || (name
            .get(..reserved.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(reserved))
            && !is_ascii_header_name(name))
}

fn trim_ascii_optional_whitespace(value: &str) -> &str {
    value.trim_matches([' ', '\t'])
}

fn is_ascii_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

#[cfg(test)]
mod tests {
    use super::{
        read_message, write_message, MAX_LSP_FRAME_BYTES, MAX_LSP_HEADER_BYTES,
        MAX_LSP_HEADER_LINES, MAX_LSP_HEADER_LINE_BYTES,
    };
    use std::io::Cursor;

    #[test]
    fn round_trips_single_message() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, br#"{"jsonrpc":"2.0"}"#).expect("write message");

        let mut reader = Cursor::new(buffer);
        let body = read_message(&mut reader)
            .expect("read message")
            .expect("body");

        assert_eq!(body, br#"{"jsonrpc":"2.0"}"#);
    }

    #[test]
    fn reads_consecutive_messages() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, b"first").expect("write first");
        write_message(&mut buffer, b"second").expect("write second");

        let mut reader = Cursor::new(buffer);

        assert_eq!(
            read_message(&mut reader)
                .expect("read first")
                .expect("first"),
            b"first"
        );
        assert_eq!(
            read_message(&mut reader)
                .expect("read second")
                .expect("second"),
            b"second"
        );
    }

    #[test]
    fn returns_none_on_clean_eof_before_headers() {
        let mut reader = Cursor::new(Vec::new());

        assert!(read_message(&mut reader).expect("read eof").is_none());
    }

    #[test]
    fn parses_content_length_case_insensitively() {
        let mut reader = Cursor::new(b"content-length: 2\r\n\r\nok".to_vec());

        assert_eq!(
            read_message(&mut reader)
                .expect("read message")
                .expect("body"),
            b"ok"
        );
    }

    #[test]
    fn skips_startup_noise_before_headers() {
        let mut reader = Cursor::new(
            b"\nWarning: PHP Startup: Unable to load dynamic library 'imagick.so'\n  detail line\n\nContent-Type: application/vscode-jsonrpc; charset=utf8\r\nContent-Length: 2\r\n\r\nok"
                .to_vec(),
        );

        assert_eq!(
            read_message(&mut reader)
                .expect("read message")
                .expect("body"),
            b"ok"
        );
    }

    #[test]
    fn accepts_content_type_before_content_length() {
        let mut reader = Cursor::new(
            b"Content-Type: application/vscode-jsonrpc; charset=utf8\r\nContent-Length: 2\r\n\r\nok"
                .to_vec(),
        );

        assert_eq!(
            read_message(&mut reader)
                .expect("read message")
                .expect("body"),
            b"ok"
        );
    }

    #[test]
    fn rejects_lsp_header_block_missing_content_length() {
        let mut reader = Cursor::new(
            b"Content-Type: application/vscode-jsonrpc; charset=utf8\r\n\r\nbody".to_vec(),
        );

        let error = read_message(&mut reader).expect_err("missing length should fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_truncated_body() {
        let mut reader = Cursor::new(b"Content-Length: 5\r\n\r\nabc".to_vec());

        let error = read_message(&mut reader).expect_err("truncated body should fail");

        assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn rejects_truncated_header_block() {
        let mut reader = Cursor::new(b"Content-Length: 0\r\n".to_vec());

        let error = read_message(&mut reader).expect_err("truncated header must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn accepts_frame_at_exact_byte_limit() {
        let mut message = format!("Content-Length: {MAX_LSP_FRAME_BYTES}\r\n\r\n").into_bytes();
        message.resize(message.len() + MAX_LSP_FRAME_BYTES, b'x');
        let mut reader = Cursor::new(message);

        let body = read_message(&mut reader)
            .expect("exact-cap frame")
            .expect("body");

        assert_eq!(body.len(), MAX_LSP_FRAME_BYTES);
    }

    #[test]
    fn rejects_frame_above_byte_limit_before_reading_or_allocating_body() {
        let header = format!("Content-Length: {}\r\n\r\n", MAX_LSP_FRAME_BYTES + 1);
        let mut reader = Cursor::new(header.into_bytes());

        let error = read_message(&mut reader).expect_err("cap + 1 must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(
            &reader.get_ref()[reader.position() as usize..],
            b"\r\n",
            "the oversized frame must be rejected from its header without reading a body"
        );
    }

    #[test]
    fn write_rejects_frame_above_byte_limit_without_partial_header() {
        let payload = vec![b'x'; MAX_LSP_FRAME_BYTES + 1];
        let mut output = Vec::new();

        let error = write_message(&mut output, &payload).expect_err("cap + 1 must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(output.is_empty());
    }

    #[test]
    fn rejects_duplicate_content_length_even_when_values_match() {
        let mut reader = Cursor::new(b"Content-Length: 2\r\nContent-Length: 2\r\n\r\nok".to_vec());

        let error = read_message(&mut reader).expect_err("duplicate length must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_conflicting_content_lengths() {
        let mut reader = Cursor::new(b"Content-Length: 2\r\nContent-Length: 3\r\n\r\nok!".to_vec());

        let error = read_message(&mut reader).expect_err("conflicting lengths must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_malformed_and_overflowing_content_lengths() {
        for value in [
            "two",
            "-1",
            "+2",
            "\u{00a0}2",
            "2\u{000b}3",
            "18446744073709551616",
        ] {
            let mut reader = Cursor::new(format!("Content-Length: {value}\r\n\r\n").into_bytes());

            let error = read_message(&mut reader).expect_err("invalid length must fail");

            assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        }
    }

    #[test]
    fn accepts_only_ascii_optional_whitespace_around_content_length() {
        for value in ["2", " 2", "2 ", "\t2\t"] {
            let mut reader = Cursor::new(format!("Content-Length:{value}\r\n\r\nok").into_bytes());

            assert_eq!(
                read_message(&mut reader).expect("ASCII OWS").expect("body"),
                b"ok"
            );
        }
    }

    #[test]
    fn rejects_whitespace_inside_reserved_header_name() {
        for name in [
            "Content-Length ",
            "Content-Length\t",
            " Content-Length",
            "Content-Length\u{00a0}",
            "Content-Length\u{000b}",
            "Content-Length\u{0000}",
        ] {
            let mut reader =
                Cursor::new(format!("{name}: 999\r\nContent-Length: 2\r\n\r\nok").into_bytes());

            let error = read_message(&mut reader).expect_err("malformed name must fail");

            assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        }
    }

    #[test]
    fn rejects_malformed_line_after_header_block_starts() {
        let mut reader = Cursor::new(
            b"Content-Type: application/vscode-jsonrpc\r\nnot-a-header\r\n\r\n".to_vec(),
        );

        let error = read_message(&mut reader).expect_err("malformed header must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_header_line_above_byte_limit() {
        let mut message = vec![b'x'; MAX_LSP_HEADER_LINE_BYTES + 1];
        message.extend_from_slice(b"\nContent-Length: 0\r\n\r\n");
        let mut reader = Cursor::new(message);

        let error = read_message(&mut reader).expect_err("overlong line must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_header_block_above_byte_limit() {
        let mut message = b"Content-Type: application/vscode-jsonrpc\r\n".to_vec();
        while message.len() <= MAX_LSP_HEADER_BYTES {
            let remaining = MAX_LSP_HEADER_LINE_BYTES.saturating_sub(3);
            message.extend(std::iter::repeat_n(b'x', remaining));
            message.extend_from_slice(b":\r\n");
        }
        message.extend_from_slice(b"Content-Length: 0\r\n\r\n");
        let mut reader = Cursor::new(message);

        let error = read_message(&mut reader).expect_err("oversized header block must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_header_block_above_line_limit() {
        let mut message = b"Content-Type: application/vscode-jsonrpc\r\n".to_vec();
        for index in 1..MAX_LSP_HEADER_LINES {
            message.extend_from_slice(format!("X-{index}: ok\r\n").as_bytes());
        }
        message.extend_from_slice(b"\r\n");
        let mut reader = Cursor::new(message);

        let error = read_message(&mut reader).expect_err("too many headers must fail");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }
}
