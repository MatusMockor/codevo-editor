use std::{
    io::{self, Read},
    sync::{Arc, Mutex, PoisonError},
    thread,
    time::{Duration, Instant},
};

pub(crate) const CAPTURED_STREAM_BYTES_LIMIT: usize = 64 * 1024;
pub(crate) const CAPTURED_STREAM_DRAIN_GRACE: Duration = Duration::from_millis(1_000);
#[cfg(unix)]
const CAPTURED_STREAM_POLL_INTERVAL_MILLIS: libc::c_int = 25;
const CAPTURED_STREAM_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BoundedCapturedStream {
    pub(crate) raw_tail: Vec<u8>,
    pub(crate) text: String,
    pub(crate) truncated: bool,
    pub(crate) read_error: Option<String>,
}

#[cfg(unix)]
pub(crate) trait CapturedPipe: Read + std::os::fd::AsFd + Send + 'static {}

#[cfg(unix)]
impl<T: Read + std::os::fd::AsFd + Send + 'static> CapturedPipe for T {}

#[cfg(not(unix))]
pub(crate) trait CapturedPipe: Read + Send + 'static {}

#[cfg(not(unix))]
impl<T: Read + Send + 'static> CapturedPipe for T {}

#[derive(Clone, Debug, Default)]
pub(crate) struct CapturedStreamDrain {
    deadline: Arc<Mutex<Option<Instant>>>,
}

impl CapturedStreamDrain {
    pub(crate) fn begin(&self, grace: Duration) {
        let now = Instant::now();
        let deadline = now.checked_add(grace).unwrap_or(now);
        let mut current = self.deadline.lock().unwrap_or_else(PoisonError::into_inner);
        if current.is_some_and(|existing| existing <= deadline) {
            return;
        }
        *current = Some(deadline);
    }

    fn expired(&self) -> bool {
        self.deadline
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some_and(|deadline| Instant::now() >= deadline)
    }
}

pub(crate) struct CapturedPipeOutput {
    pub(crate) stdout: BoundedCapturedStream,
    pub(crate) stderr: BoundedCapturedStream,
}

pub(crate) struct CapturedPipeReaders {
    stdout: Option<thread::JoinHandle<BoundedCapturedStream>>,
    stderr: Option<thread::JoinHandle<BoundedCapturedStream>>,
    drain: CapturedStreamDrain,
}

impl CapturedPipeReaders {
    pub(crate) fn spawn(stdout: impl CapturedPipe, stderr: impl CapturedPipe) -> io::Result<Self> {
        let mut readers = Self {
            stdout: None,
            stderr: None,
            drain: CapturedStreamDrain::default(),
        };
        readers.stdout = Some(spawn_captured_reader(stdout, &readers.drain)?);
        readers.stderr = Some(spawn_captured_reader(stderr, &readers.drain)?);
        Ok(readers)
    }

    pub(crate) fn join_after_process_group_exit(
        mut self,
    ) -> Result<CapturedPipeOutput, &'static str> {
        self.drain.begin(CAPTURED_STREAM_DRAIN_GRACE);
        let stdout = join_captured_reader(self.stdout.take(), "stdout")?;
        let stderr = join_captured_reader(self.stderr.take(), "stderr")?;
        Ok(CapturedPipeOutput { stdout, stderr })
    }
}

impl Drop for CapturedPipeReaders {
    fn drop(&mut self) {
        self.drain.begin(Duration::ZERO);
    }
}

fn spawn_captured_reader(
    pipe: impl CapturedPipe,
    drain: &CapturedStreamDrain,
) -> io::Result<thread::JoinHandle<BoundedCapturedStream>> {
    let drain = drain.clone();
    thread::Builder::new()
        .name("captured-output-reader".to_string())
        .spawn(move || read_captured_pipe(pipe, CAPTURED_STREAM_BYTES_LIMIT, &drain))
}

fn join_captured_reader(
    reader: Option<thread::JoinHandle<BoundedCapturedStream>>,
    label: &'static str,
) -> Result<BoundedCapturedStream, &'static str> {
    reader.ok_or(label)?.join().map_err(|_| label)
}

struct CapturedTail {
    tail: Vec<u8>,
    limit: usize,
    truncated: bool,
}

impl CapturedTail {
    fn new(limit: usize) -> Self {
        Self {
            tail: Vec::with_capacity(limit),
            limit,
            truncated: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.tail.extend_from_slice(bytes);
        if self.tail.len() <= self.limit {
            return;
        }
        self.truncated = true;
        let excess = self.tail.len() - self.limit;
        self.tail.drain(..excess);
    }

    fn finish(self, read_error: Option<String>, incomplete: bool) -> BoundedCapturedStream {
        let (text, recapped) = utf8_suffix(&String::from_utf8_lossy(&self.tail), self.limit);
        BoundedCapturedStream {
            text,
            truncated: self.truncated || recapped || incomplete || read_error.is_some(),
            read_error,
            raw_tail: self.tail,
        }
    }
}

#[cfg(any(test, not(unix)))]
pub(crate) fn read_bounded_captured_stream(
    mut reader: impl Read,
    limit: usize,
) -> BoundedCapturedStream {
    let mut captured = CapturedTail::new(limit);
    let mut chunk = [0_u8; CAPTURED_STREAM_CHUNK_BYTES];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => return captured.finish(None, false),
            Ok(count) => captured.push(&chunk[..count]),
            Err(error) => return captured.finish(Some(error.to_string()), false),
        }
    }
}

#[cfg(unix)]
fn read_captured_pipe(
    mut pipe: impl CapturedPipe,
    limit: usize,
    drain: &CapturedStreamDrain,
) -> BoundedCapturedStream {
    let mut captured = CapturedTail::new(limit);
    let mut chunk = [0_u8; CAPTURED_STREAM_CHUNK_BYTES];
    loop {
        if drain.expired() {
            return captured.finish(None, true);
        }
        match wait_until_readable(&pipe) {
            Ok(false) => continue,
            Ok(true) => {}
            Err(error) => return captured.finish(Some(error.to_string()), false),
        }
        match pipe.read(&mut chunk) {
            Ok(0) => return captured.finish(None, false),
            Ok(count) => captured.push(&chunk[..count]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return captured.finish(Some(error.to_string()), false),
        }
    }
}

#[cfg(not(unix))]
fn read_captured_pipe(
    pipe: impl CapturedPipe,
    limit: usize,
    _drain: &CapturedStreamDrain,
) -> BoundedCapturedStream {
    read_bounded_captured_stream(pipe, limit)
}

#[cfg(unix)]
fn wait_until_readable(pipe: &impl std::os::fd::AsFd) -> io::Result<bool> {
    use std::os::fd::AsRawFd;

    let mut descriptor = libc::pollfd {
        fd: pipe.as_fd().as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    let ready = unsafe { libc::poll(&mut descriptor, 1, CAPTURED_STREAM_POLL_INTERVAL_MILLIS) };
    if ready >= 0 {
        return Ok(ready > 0);
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::Interrupted {
        return Ok(false);
    }
    Err(error)
}

fn utf8_suffix(value: &str, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value.to_string(), false);
    }
    let mut start = value.len() - limit;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    (value[start..].to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    #[cfg(unix)]
    fn wait_until_consumed(observer: &impl std::os::fd::AsFd) {
        use std::os::fd::AsRawFd;

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let mut pending: libc::c_int = 0;
            assert_eq!(
                unsafe { libc::ioctl(observer.as_fd().as_raw_fd(), libc::FIONREAD, &mut pending) },
                0
            );
            if pending == 0 {
                return;
            }
            assert!(Instant::now() < deadline, "reader never consumed the pipe");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[cfg(unix)]
    #[test]
    fn drain_stops_reading_a_pipe_still_held_by_a_foreign_writer() {
        use std::io::Write;

        let (reader, mut writer) = io::pipe().expect("pipe");
        let observer = reader.try_clone().expect("observe pipe");
        writer.write_all(b"partial").expect("write partial output");
        let drain = CapturedStreamDrain::default();
        let reader_drain = drain.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let handle = thread::spawn(move || {
            let _ = sender.send(read_captured_pipe(
                reader,
                CAPTURED_STREAM_BYTES_LIMIT,
                &reader_drain,
            ));
        });
        wait_until_consumed(&observer);
        assert!(receiver.try_recv().is_err());

        drain.begin(Duration::from_millis(50));
        let captured = receiver.recv_timeout(Duration::from_secs(5));
        drop(writer);
        handle.join().expect("reader thread");
        let captured = captured.expect("reader must stop at the drain deadline");

        assert_eq!(captured.text, "partial");
        assert!(captured.truncated);
        assert_eq!(captured.read_error, None);
    }

    #[cfg(unix)]
    #[test]
    fn drain_keeps_complete_output_when_every_writer_closes_in_time() {
        use std::io::Write;

        let (reader, mut writer) = io::pipe().expect("pipe");
        writer.write_all(b"complete").expect("write output");
        drop(writer);
        let drain = CapturedStreamDrain::default();
        drain.begin(Duration::from_secs(5));

        let captured = read_captured_pipe(reader, CAPTURED_STREAM_BYTES_LIMIT, &drain);

        assert_eq!(captured.text, "complete");
        assert!(!captured.truncated);
        assert_eq!(captured.read_error, None);
    }

    #[test]
    fn drain_keeps_the_earliest_deadline() {
        let drain = CapturedStreamDrain::default();
        assert!(!drain.expired());
        drain.begin(Duration::ZERO);
        drain.begin(Duration::from_secs(60));
        assert!(drain.expired());
    }

    #[cfg(unix)]
    #[test]
    fn readers_join_within_the_drain_grace_after_process_group_exit() {
        use std::io::Write;

        let (stdout, mut stdout_writer) = io::pipe().expect("stdout pipe");
        let (stderr, stderr_writer) = io::pipe().expect("stderr pipe");
        let observer = stdout.try_clone().expect("observe stdout");
        stdout_writer.write_all(b"out").expect("write stdout");
        drop(stderr_writer);
        let readers = CapturedPipeReaders::spawn(stdout, stderr).expect("spawn readers");
        wait_until_consumed(&observer);

        let (sender, receiver) = std::sync::mpsc::channel();
        let joiner = thread::spawn(move || {
            let _ = sender.send(readers.join_after_process_group_exit());
        });
        let output = receiver.recv_timeout(CAPTURED_STREAM_DRAIN_GRACE + Duration::from_secs(5));
        drop(stdout_writer);
        joiner.join().expect("joiner thread");
        let output = output
            .expect("readers must join within the drain grace")
            .expect("reader threads");

        assert_eq!(output.stdout.text, "out");
        assert!(output.stdout.truncated);
        assert_eq!(output.stderr.text, "");
        assert!(!output.stderr.truncated);
    }

    #[test]
    fn retains_exact_boundary_without_truncation_and_tail_after_overflow() {
        let exact = read_bounded_captured_stream(Cursor::new(vec![b'a'; 8]), 8);
        assert_eq!(exact.text, "aaaaaaaa");
        assert_eq!(exact.raw_tail, b"aaaaaaaa");
        assert!(!exact.truncated);
        assert_eq!(exact.read_error, None);

        let overflow = read_bounded_captured_stream(Cursor::new(b"0123456789"), 8);
        assert_eq!(overflow.text, "23456789");
        assert_eq!(overflow.raw_tail, b"23456789");
        assert!(overflow.truncated);
        assert_eq!(overflow.read_error, None);
    }

    #[test]
    fn production_cap_is_closed_at_exactly_sixty_four_kibibytes() {
        let exact = read_bounded_captured_stream(
            Cursor::new(vec![b'x'; CAPTURED_STREAM_BYTES_LIMIT]),
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(exact.raw_tail.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert_eq!(exact.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(!exact.truncated);

        let overflow = read_bounded_captured_stream(
            Cursor::new(vec![b'y'; CAPTURED_STREAM_BYTES_LIMIT + 1]),
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(overflow.raw_tail.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert_eq!(overflow.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(overflow.truncated);
    }

    #[test]
    fn lossy_utf8_is_recapped_to_a_valid_bounded_suffix() {
        let captured = read_bounded_captured_stream(Cursor::new([0xff; 8]), 8);
        assert_eq!(captured.text, "��");
        assert_eq!(captured.text.len(), 6);
        assert!(captured.truncated);
        assert_eq!(captured.read_error, None);
    }

    #[test]
    fn split_and_incomplete_unicode_are_decoded_from_the_raw_tail() {
        let value = "prefix-žltý-🦀";
        for split in 0..=value.len() {
            let reader = SplitReader::new(value.as_bytes(), split);
            let captured = read_bounded_captured_stream(reader, CAPTURED_STREAM_BYTES_LIMIT);
            assert_eq!(captured.text, value, "split at byte {split}");
            assert!(!captured.truncated);
            assert_eq!(captured.read_error, None);
        }

        let incomplete = read_bounded_captured_stream(Cursor::new([b'a', 0xf0, 0x9f, 0xa6]), 16);
        assert_eq!(incomplete.text, "a�");
        assert!(!incomplete.truncated);
    }

    #[test]
    fn unicode_tail_never_splits_a_scalar() {
        let captured = read_bounded_captured_stream(Cursor::new("až🦀".as_bytes()), 5);
        assert_eq!(captured.text, "🦀");
        assert!(captured.truncated);
        assert!(captured.text.len() <= 5);
    }

    #[test]
    fn preserves_partial_tail_and_records_read_error() {
        let captured = read_bounded_captured_stream(
            ErrorReader {
                delivered: false,
                bytes: b"partial",
            },
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(captured.text, "partial");
        assert!(captured.truncated);
        assert_eq!(
            captured.read_error.as_deref(),
            Some("synthetic read failure")
        );
    }

    struct SplitReader<'a> {
        bytes: &'a [u8],
        position: usize,
        split: usize,
    }

    impl<'a> SplitReader<'a> {
        fn new(bytes: &'a [u8], split: usize) -> Self {
            Self {
                bytes,
                position: 0,
                split,
            }
        }
    }

    impl Read for SplitReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.position == self.bytes.len() {
                return Ok(0);
            }
            let boundary = if self.position < self.split {
                self.split
            } else {
                self.bytes.len()
            };
            let count = (boundary - self.position).min(buffer.len());
            buffer[..count].copy_from_slice(&self.bytes[self.position..self.position + count]);
            self.position += count;
            Ok(count)
        }
    }

    struct ErrorReader<'a> {
        bytes: &'a [u8],
        delivered: bool,
    }

    impl Read for ErrorReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.delivered {
                return Err(io::Error::other("synthetic read failure"));
            }
            self.delivered = true;
            buffer[..self.bytes.len()].copy_from_slice(self.bytes);
            Ok(self.bytes.len())
        }
    }
}
