use std::io::{ErrorKind, Read};
use std::os::unix::io::{AsRawFd, RawFd};
use std::time::Instant;

const CHUNK_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct StreamLimits {
    pub(super) stdout_bytes: usize,
    pub(super) stderr_bytes: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum StreamsResult {
    Complete { stdout: Vec<u8>, stderr: Vec<u8> },
    TooLarge,
    TimedOut,
    Failed,
}

pub(super) fn read_streams<O: Read + AsRawFd, E: Read + AsRawFd>(
    stdout: O,
    stderr: E,
    limits: StreamLimits,
    deadline: Instant,
) -> StreamsResult {
    if !set_non_blocking(stdout.as_raw_fd()) || !set_non_blocking(stderr.as_raw_fd()) {
        return StreamsResult::Failed;
    }
    let mut out = BoundedStream::new(stdout, limits.stdout_bytes, false);
    let mut err = BoundedStream::new(stderr, limits.stderr_bytes, true);
    loop {
        if out.finished && err.finished {
            return StreamsResult::Complete {
                stdout: out.into_buffer(),
                stderr: err.into_buffer(),
            };
        }
        let now = Instant::now();
        if now >= deadline {
            return StreamsResult::TimedOut;
        }
        let timeout = poll_millis(deadline.saturating_duration_since(now));
        let mut descriptors = [out.poll_descriptor(), err.poll_descriptor()];
        let ready = poll_descriptors(&mut descriptors, timeout);
        let Some(ready) = ready else {
            return StreamsResult::Failed;
        };
        if ready == 0 {
            continue;
        }
        if descriptors[0].revents != 0 && out.drain() {
            return StreamsResult::TooLarge;
        }
        if descriptors[1].revents != 0 {
            err.drain();
        }
    }
}

struct BoundedStream<R> {
    reader: R,
    buffer: Vec<u8>,
    chunk: Vec<u8>,
    limit: usize,
    received: usize,
    truncates: bool,
    finished: bool,
}

impl<R: Read + AsRawFd> BoundedStream<R> {
    fn new(reader: R, limit: usize, truncates: bool) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
            chunk: vec![0; CHUNK_BYTES],
            limit,
            received: 0,
            truncates,
            finished: false,
        }
    }

    fn poll_descriptor(&self) -> libc::pollfd {
        let fd = match self.finished {
            true => -1,
            false => self.reader.as_raw_fd(),
        };
        libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        }
    }

    fn drain(&mut self) -> bool {
        match self.reader.read(&mut self.chunk) {
            Ok(0) => {
                self.finished = true;
                false
            }
            Ok(count) => self.push(count),
            Err(error) if error.kind() == ErrorKind::WouldBlock => false,
            Err(error) if error.kind() == ErrorKind::Interrupted => false,
            Err(_) => {
                self.finished = true;
                false
            }
        }
    }

    fn push(&mut self, count: usize) -> bool {
        self.received = self.received.saturating_add(count);
        let retained = count.min(self.limit.saturating_sub(self.buffer.len()));
        self.buffer.extend_from_slice(&self.chunk[..retained]);
        if self.received <= self.limit {
            return false;
        }
        if self.truncates {
            return false;
        }
        true
    }

    fn into_buffer(self) -> Vec<u8> {
        self.buffer
    }
}

fn poll_millis(remaining: std::time::Duration) -> i32 {
    let millis = remaining.as_millis().min(i32::MAX as u128);
    i32::try_from(millis).unwrap_or(i32::MAX).max(1)
}

fn poll_descriptors(descriptors: &mut [libc::pollfd; 2], timeout: i32) -> Option<usize> {
    // SAFETY: the descriptor array is owned by the caller, correctly sized, and
    // every descriptor either belongs to a live pipe or is the ignored value -1.
    let result = unsafe { libc::poll(descriptors.as_mut_ptr(), 2, timeout) };
    if result >= 0 {
        return usize::try_from(result).ok();
    }
    if std::io::Error::last_os_error().kind() == ErrorKind::Interrupted {
        return Some(0);
    }
    None
}

fn set_non_blocking(fd: RawFd) -> bool {
    // SAFETY: `fd` is a live pipe descriptor owned by the calling reader for the
    // whole duration of these calls.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return false;
    }
    // SAFETY: see above; only the non-blocking bit is added to the existing flags.
    unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) >= 0 }
}
