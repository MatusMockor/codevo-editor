use super::LanguageServerCommand;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufReader, Read};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};

const RUNTIME_LOG_MAX_BYTES: usize = 128 * 1024;

/// Number of most-recent LSP requests retained per runtime for the diagnostic
/// cockpit. Bounded so the ring buffer can never leak memory under a long-lived
/// session that issues thousands of completion/hover requests.
const RECENT_REQUESTS_CAPACITY: usize = 20;

/// Number of trailing stderr lines retained per runtime. Bounded independently
/// from the full runtime log so the panel can show a crash/stderr tail inline
/// without copying the whole (128 KiB) log on every refresh.
pub(super) const STDERR_TAIL_CAPACITY: usize = 30;

/// Hard cap on a single stderr line. A runtime that emits a huge line without a
/// newline (or never terminates the line) must not grow the pending buffer
/// without bound.
const STDERR_LINE_MAX_BYTES: usize = 4 * 1024;

/// One recorded LSP request with its measured round-trip latency and outcome,
/// surfaced in the diagnostic cockpit's "recent requests" table.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentLspRequest {
    pub method: String,
    pub latency_ms: u64,
    pub success: bool,
}

pub(super) type RuntimeLog = Arc<Mutex<String>>;
pub(super) type RecentRequests = Arc<Mutex<VecDeque<RecentLspRequest>>>;
pub(super) type StderrTail = Arc<Mutex<StderrTailBuffer>>;

#[derive(Default)]
pub(super) struct StderrTailBuffer {
    completed: VecDeque<String>,
    pending: String,
}

impl StderrTailBuffer {
    fn clear(&mut self) {
        self.completed.clear();
        self.pending.clear();
    }
}

pub(super) fn record_recent_request(buffer: &RecentRequests, record: RecentLspRequest) {
    let Ok(mut requests) = buffer.lock() else {
        return;
    };

    requests.push_back(record);

    while requests.len() > RECENT_REQUESTS_CAPACITY {
        requests.pop_front();
    }
}

pub(super) fn snapshot_recent_requests(buffer: &RecentRequests) -> Vec<RecentLspRequest> {
    let Ok(requests) = buffer.lock() else {
        return Vec::new();
    };

    requests.iter().rev().cloned().collect()
}

fn append_stderr_tail(tail: &StderrTail, chunk: &str) {
    let Ok(mut buffer) = tail.lock() else {
        return;
    };

    let mut segments = chunk.split('\n').peekable();

    while let Some(segment) = segments.next() {
        push_bounded_pending(&mut buffer.pending, segment);

        if segments.peek().is_none() {
            break;
        }

        let line = std::mem::take(&mut buffer.pending);
        buffer.completed.push_back(line);

        while buffer.completed.len() > STDERR_TAIL_CAPACITY {
            buffer.completed.pop_front();
        }
    }
}

fn push_bounded_pending(pending: &mut String, segment: &str) {
    if pending.len() >= STDERR_LINE_MAX_BYTES {
        return;
    }

    let remaining = STDERR_LINE_MAX_BYTES - pending.len();

    if segment.len() <= remaining {
        pending.push_str(segment);
        return;
    }

    let mut take_to = remaining;
    while take_to > 0 && !segment.is_char_boundary(take_to) {
        take_to -= 1;
    }
    pending.push_str(&segment[..take_to]);
}

pub(super) fn snapshot_stderr_tail(tail: &StderrTail) -> Vec<String> {
    let Ok(buffer) = tail.lock() else {
        return Vec::new();
    };

    buffer
        .completed
        .iter()
        .cloned()
        .chain(std::iter::once(buffer.pending.clone()))
        .filter(|line| !line.is_empty())
        .collect()
}

pub(super) fn reset_runtime_log(
    log: &RuntimeLog,
    server_label: &str,
    session_id: u64,
    command: &LanguageServerCommand,
) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let command_line = std::iter::once(command.executable.clone())
        .chain(command.args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    let env_lines = command
        .env
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");
    let env_block = if env_lines.is_empty() {
        "env: (none)".to_string()
    } else {
        format!("env:\n{env_lines}")
    };
    let header = format!(
        "{server_label} session {session_id} started at {timestamp}\nworking directory: {}\ncommand: {command_line}\n{env_block}\n\n",
        command.working_directory,
    );

    if let Ok(mut current) = log.lock() {
        *current = header;
    }
}

pub(super) fn spawn_stderr_reader(
    stderr: Box<dyn Read + Send>,
    log: RuntimeLog,
    stderr_tail: StderrTail,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0_u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(count) => {
                    let chunk = String::from_utf8_lossy(&buffer[..count]);
                    append_runtime_log(&log, &chunk);
                    append_stderr_tail(&stderr_tail, &chunk);
                }
            }
        }
    })
}

pub(super) fn reset_request_telemetry(recent_requests: &RecentRequests, stderr_tail: &StderrTail) {
    if let Ok(mut requests) = recent_requests.lock() {
        requests.clear();
    }

    if let Ok(mut tail) = stderr_tail.lock() {
        tail.clear();
    }
}

pub(super) fn append_runtime_log(log: &RuntimeLog, chunk: &str) {
    let Ok(mut current) = log.lock() else {
        return;
    };

    current.push_str(chunk);

    if current.len() <= RUNTIME_LOG_MAX_BYTES {
        return;
    }

    let mut trim_to = current.len() - RUNTIME_LOG_MAX_BYTES;
    while trim_to < current.len() && !current.is_char_boundary(trim_to) {
        trim_to += 1;
    }
    current.drain(..trim_to);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_requests_are_newest_first_and_bounded() {
        let buffer = Arc::new(Mutex::new(VecDeque::new()));
        for index in 0..(RECENT_REQUESTS_CAPACITY + 5) {
            record_recent_request(
                &buffer,
                RecentLspRequest {
                    method: format!("method/{index}"),
                    latency_ms: index as u64,
                    success: true,
                },
            );
        }

        let recent = snapshot_recent_requests(&buffer);
        assert_eq!(recent.len(), RECENT_REQUESTS_CAPACITY);
        assert_eq!(
            recent[0].method,
            format!("method/{}", RECENT_REQUESTS_CAPACITY + 4)
        );
        assert_eq!(recent[0].latency_ms, (RECENT_REQUESTS_CAPACITY + 4) as u64);
    }

    #[test]
    fn stderr_tail_coalesces_line_split_across_reads() {
        let tail = Arc::new(Mutex::new(StderrTailBuffer::default()));
        append_stderr_tail(&tail, "PHP Fatal err");
        append_stderr_tail(&tail, "or: boom\n");
        assert_eq!(snapshot_stderr_tail(&tail), vec!["PHP Fatal error: boom"]);
    }

    #[test]
    fn stderr_tail_trailing_newline_does_not_add_phantom_line() {
        let tail = Arc::new(Mutex::new(StderrTailBuffer::default()));
        append_stderr_tail(&tail, "one\ntwo\n");
        assert_eq!(snapshot_stderr_tail(&tail), vec!["one", "two"]);
    }

    #[test]
    fn stderr_tail_caps_unterminated_line_to_bound() {
        let tail = Arc::new(Mutex::new(StderrTailBuffer::default()));
        append_stderr_tail(&tail, &"x".repeat(STDERR_LINE_MAX_BYTES * 4));
        let snapshot = snapshot_stderr_tail(&tail);
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].len(), STDERR_LINE_MAX_BYTES);
    }

    #[test]
    fn stderr_tail_surfaces_pending_partial_line() {
        let tail = Arc::new(Mutex::new(StderrTailBuffer::default()));
        append_stderr_tail(&tail, "Segmentation fault");
        assert_eq!(snapshot_stderr_tail(&tail), vec!["Segmentation fault"]);
    }

    #[test]
    fn restart_clears_request_telemetry_per_root() {
        let recent = Arc::new(Mutex::new(VecDeque::new()));
        let tail = Arc::new(Mutex::new(StderrTailBuffer::default()));
        record_recent_request(
            &recent,
            RecentLspRequest {
                method: "textDocument/hover".to_string(),
                latency_ms: 5,
                success: true,
            },
        );
        append_stderr_tail(&tail, "stale warning\n");

        reset_request_telemetry(&recent, &tail);

        assert!(snapshot_recent_requests(&recent).is_empty());
        assert!(snapshot_stderr_tail(&tail).is_empty());
    }
}
