use std::io::{self, BufRead, Write};

pub fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", payload.len())?;
    writer.write_all(payload)?;
    writer.flush()
}

pub fn read_message<R: BufRead>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut content_length = None;
    let mut in_header_block = false;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;

        if bytes_read == 0 {
            return Ok(None);
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);

        if trimmed.is_empty() {
            if !in_header_block {
                continue;
            }

            break;
        }

        let Some((name, value)) = trimmed.split_once(':') else {
            continue;
        };

        if name.eq_ignore_ascii_case("Content-Type") {
            in_header_block = true;
            continue;
        }

        if !name.eq_ignore_ascii_case("Content-Length") {
            continue;
        }

        in_header_block = true;
        content_length =
            value.trim().parse::<usize>().map(Some).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid Content-Length")
            })?;
    }

    let length = content_length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::{read_message, write_message};
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
}
