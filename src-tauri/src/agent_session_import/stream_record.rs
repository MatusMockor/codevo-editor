//! Stream a common inline-image JSONL record without retaining its base64 payload.
use super::*;
use std::io::{BufRead, BufReader};
const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
pub(super) struct Record {
    pub bytes: usize,
    pub ended: bool,
    pub truncated: bool,
    pub exchange: Option<ExternalSessionExchange>,
}
pub(super) fn read(
    file: &mut fs::File,
    offset: u64,
    snapshot_bytes: u64,
    provider: ExternalSessionProvider,
    session: &str,
    root: &str,
    cutoff: u64,
) -> Result<Record, String> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let mut line = LineReader {
        input: BufReader::new(file.take(snapshot_bytes - offset)),
        bytes: 0,
        ended: false,
    };
    let parsed = parse_exchange(&mut line, provider, session, root, cutoff)?;
    std::io::copy(&mut line, &mut std::io::sink()).map_err(|_| SOURCE_CHANGED.to_string())?;
    let (exchange, truncated) = match parsed {
        Some((exchange, truncated)) => (Some(exchange), truncated),
        None => (None, true),
    };
    Ok(Record {
        bytes: line.bytes,
        ended: line.ended || offset + line.bytes as u64 == snapshot_bytes,
        truncated: truncated || !line.ended,
        exchange,
    })
}
struct LineReader<R> {
    input: R,
    bytes: usize,
    ended: bool,
}
impl<R: BufRead> Read for LineReader<R> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if self.ended || self.bytes >= MAX_RECORD_BYTES || output.is_empty() {
            return Ok(0);
        }
        let available = self.input.fill_buf()?;
        if available.is_empty() {
            self.ended = true;
            return Ok(0);
        }
        let limit = available
            .len()
            .min(output.len())
            .min(MAX_RECORD_BYTES - self.bytes);
        let count = available[..limit]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(limit);
        output[..count].copy_from_slice(&available[..count]);
        self.ended = available[count - 1] == b'\n';
        self.input.consume(count);
        self.bytes += count;
        Ok(count)
    }
}

pub(super) fn validate_claude(file: &mut fs::File, root: &str, session: &str) -> bool {
    if file.seek(SeekFrom::Start(0)).is_err() {
        return false;
    }
    let mut line = LineReader {
        input: BufReader::new(file),
        bytes: 0,
        ended: false,
    };
    serde_json::from_reader::<_, RawClaudeLine>(&mut line).is_ok_and(|line| {
        line.cwd.as_deref() == Some(root)
            && line
                .session_id
                .as_deref()
                .is_none_or(|id| id.eq_ignore_ascii_case(session))
    })
}
