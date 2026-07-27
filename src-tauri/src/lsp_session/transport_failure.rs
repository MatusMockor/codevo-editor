use std::io;

pub(super) fn transport_failure_message(server_label: &str, error: &io::Error) -> String {
    let reason = match error.kind() {
        io::ErrorKind::InvalidData => bounded_invalid_transport_reason(error),
        io::ErrorKind::UnexpectedEof => "LSP message was truncated".to_string(),
        _ => "LSP transport I/O failed".to_string(),
    };
    format!("{server_label} transport failed: {reason}.")
}

fn bounded_invalid_transport_reason(error: &io::Error) -> String {
    const ALLOWED_REASONS: &[&str] = &[
        "LSP header block exceeds byte limit",
        "LSP header block exceeds line limit",
        "LSP header contains invalid UTF-8",
        "LSP header line exceeds byte limit",
        "LSP message exceeds frame byte limit",
        "Content-Length overflow",
        "duplicate Content-Length",
        "invalid Content-Length",
        "malformed LSP header name",
        "malformed LSP header line",
        "missing Content-Length",
    ];
    let reason = error.to_string();
    if ALLOWED_REASONS.contains(&reason.as_str()) {
        reason
    } else {
        "invalid LSP framing".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::transport_failure_message;
    use std::io;

    #[test]
    fn preserves_allowlisted_protocol_reason() {
        let error = io::Error::new(
            io::ErrorKind::InvalidData,
            "LSP message exceeds frame byte limit",
        );

        assert_eq!(
            transport_failure_message("TypeScript", &error),
            "TypeScript transport failed: LSP message exceeds frame byte limit."
        );
    }

    #[test]
    fn redacts_unbounded_or_unknown_io_error_details() {
        let error = io::Error::new(io::ErrorKind::InvalidData, "x".repeat(64 * 1024));

        assert_eq!(
            transport_failure_message("TypeScript", &error),
            "TypeScript transport failed: invalid LSP framing."
        );
    }
}
