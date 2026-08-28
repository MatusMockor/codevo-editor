use std::{
    io::{self, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard, TryLockError,
    },
    thread,
    time::{Duration, Instant},
};

pub(super) trait MessageWriteStrategy: Send + Sync {
    fn write_framed(
        &self,
        writer: &mut dyn Write,
        payload: &[u8],
        deadline: Instant,
    ) -> io::Result<()>;
}

type WriteFailureHandler = Arc<dyn Fn(&io::Error) + Send + Sync>;

pub(crate) struct SessionMessageWriter {
    // Strategy drops first so the Unix implementation restores fd flags before
    // the ChildStdin owning that fd is closed.
    failed: AtomicBool,
    failure_handler: Mutex<Option<WriteFailureHandler>>,
    strategy: Arc<dyn MessageWriteStrategy>,
    writer: Mutex<Box<dyn Write + Send>>,
}

impl SessionMessageWriter {
    #[cfg(test)]
    pub(super) fn from_direct(writer: Box<dyn Write + Send>) -> Arc<Self> {
        Self::from_strategy(writer, Arc::new(DirectMessageWriteStrategy))
    }

    #[cfg(test)]
    pub(super) fn from_strategy(
        writer: Box<dyn Write + Send>,
        strategy: Arc<dyn MessageWriteStrategy>,
    ) -> Arc<Self> {
        Arc::new(Self {
            failed: AtomicBool::new(false),
            failure_handler: Mutex::new(None),
            strategy,
            writer: Mutex::new(writer),
        })
    }

    pub(super) fn from_child_stdin(stdin: std::process::ChildStdin) -> io::Result<Arc<Self>> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let strategy = Arc::new(UnixNonblockingPipeStrategy::new(stdin.as_raw_fd())?);
            Ok(Arc::new(Self {
                failed: AtomicBool::new(false),
                failure_handler: Mutex::new(None),
                strategy,
                writer: Mutex::new(Box::new(stdin)),
            }))
        }

        #[cfg(not(unix))]
        {
            let _ = stdin;
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "bounded language-server stdin writes are unsupported on this platform",
            ))
        }
    }

    pub(super) fn write_message(&self, payload: &[u8], timeout: Duration) -> io::Result<()> {
        if self.failed.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "language-server stdin writer is poisoned",
            ));
        }
        if payload.len() > crate::lsp_transport::MAX_LSP_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "LSP message exceeds frame byte limit",
            ));
        }
        let deadline = Instant::now().checked_add(timeout).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "write deadline overflow")
        })?;
        let mut writer = lock_until(&self.writer, deadline)?;
        if self.failed.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "language-server stdin writer is poisoned",
            ));
        }
        let result = self.strategy.write_framed(&mut **writer, payload, deadline);
        let newly_failed = result.is_err() && !self.failed.swap(true, Ordering::AcqRel);
        drop(writer);
        if newly_failed {
            let error = result.as_ref().expect_err("failed write");
            if let Some(handler) = self
                .failure_handler
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
                .cloned()
            {
                handler(error);
            }
        }
        result
    }

    pub(super) fn set_failure_handler(&self, handler: WriteFailureHandler) {
        *self
            .failure_handler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handler);
    }
}

fn lock_until<T>(mutex: &Mutex<T>, deadline: Instant) -> io::Result<MutexGuard<'_, T>> {
    loop {
        match mutex.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(_)) => {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "stdin lock poisoned",
                ));
            }
            Err(TryLockError::WouldBlock) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "language-server stdin write timed out waiting for the writer",
                    ));
                }
                thread::sleep(remaining.min(Duration::from_millis(1)));
            }
        }
    }
}

#[cfg(test)]
struct DirectMessageWriteStrategy;

#[cfg(test)]
impl MessageWriteStrategy for DirectMessageWriteStrategy {
    fn write_framed(
        &self,
        writer: &mut dyn Write,
        payload: &[u8],
        _deadline: Instant,
    ) -> io::Result<()> {
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        writer.write_all(header.as_bytes())?;
        writer.write_all(payload)?;
        writer.flush()
    }
}

#[cfg(unix)]
trait UnixPipeIo: Send + Sync {
    fn get_flags(&self, fd: libc::c_int) -> io::Result<libc::c_int>;
    fn set_flags(&self, fd: libc::c_int, flags: libc::c_int) -> io::Result<()>;
    fn write(&self, fd: libc::c_int, bytes: &[u8]) -> io::Result<usize>;
    fn poll_writable(&self, fd: libc::c_int, deadline: Instant) -> io::Result<bool>;
}

#[cfg(unix)]
struct LibcUnixPipeIo;

#[cfg(unix)]
impl UnixPipeIo for LibcUnixPipeIo {
    fn get_flags(&self, fd: libc::c_int) -> io::Result<libc::c_int> {
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(flags)
        }
    }

    fn set_flags(&self, fd: libc::c_int, flags: libc::c_int) -> io::Result<()> {
        if unsafe { libc::fcntl(fd, libc::F_SETFL, flags) } < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn write(&self, fd: libc::c_int, bytes: &[u8]) -> io::Result<usize> {
        let written = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
        if written < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(written as usize)
        }
    }

    fn poll_writable(&self, fd: libc::c_int, deadline: Instant) -> io::Result<bool> {
        let mut descriptor = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(false);
            }
            let timeout_ms = duration_to_poll_millis(remaining);
            let result = unsafe { libc::poll(&mut descriptor, 1, timeout_ms) };
            if result > 0 {
                if descriptor.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "language-server stdin pipe closed",
                    ));
                }
                return Ok(descriptor.revents & libc::POLLOUT != 0);
            }
            if result == 0 {
                return Ok(false);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

#[cfg(unix)]
fn duration_to_poll_millis(timeout: Duration) -> libc::c_int {
    if timeout.is_zero() {
        return 0;
    }
    let millis = timeout.as_millis();
    let rounded = millis + u128::from(!timeout.subsec_nanos().is_multiple_of(1_000_000));
    rounded.min(libc::c_int::MAX as u128) as libc::c_int
}

#[cfg(unix)]
struct UnixNonblockingPipeStrategy {
    fd: libc::c_int,
    io: Arc<dyn UnixPipeIo>,
    original_flags: libc::c_int,
}

#[cfg(unix)]
impl UnixNonblockingPipeStrategy {
    fn new(fd: libc::c_int) -> io::Result<Self> {
        Self::new_with_io(fd, Arc::new(LibcUnixPipeIo))
    }

    fn new_with_io(fd: libc::c_int, io: Arc<dyn UnixPipeIo>) -> io::Result<Self> {
        let original_flags = io.get_flags(fd)?;
        io.set_flags(fd, original_flags | libc::O_NONBLOCK)?;
        Ok(Self {
            fd,
            io,
            original_flags,
        })
    }
}

#[cfg(unix)]
impl MessageWriteStrategy for UnixNonblockingPipeStrategy {
    fn write_framed(
        &self,
        _writer: &mut dyn Write,
        payload: &[u8],
        deadline: Instant,
    ) -> io::Result<()> {
        let header = format!("Content-Length: {}\r\n\r\n", payload.len());
        let mut frame = Vec::with_capacity(header.len() + payload.len());
        frame.extend_from_slice(header.as_bytes());
        frame.extend_from_slice(payload);
        let mut cursor = 0;

        while cursor < frame.len() {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "language-server stdin write timed out",
                ));
            }
            match self.io.write(self.fd, &frame[cursor..]) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "language-server stdin wrote zero bytes",
                    ));
                }
                Ok(written) => cursor += written,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if deadline <= Instant::now() || !self.io.poll_writable(self.fd, deadline)? {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "language-server stdin write timed out",
                        ));
                    }
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for UnixNonblockingPipeStrategy {
    fn drop(&mut self) {
        let _ = self.io.set_flags(self.fd, self.original_flags);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        net::Shutdown,
        os::fd::AsRawFd,
        os::unix::net::UnixStream,
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Condvar,
        },
    };

    enum WriteStep {
        Bytes(usize),
        Error(io::ErrorKind),
    }

    struct ScriptedUnixPipeIo {
        flags: Mutex<libc::c_int>,
        poll_deadlines: Mutex<Vec<Instant>>,
        polls: Mutex<VecDeque<io::Result<bool>>>,
        set_flags: Mutex<Vec<libc::c_int>>,
        writes: Mutex<VecDeque<WriteStep>>,
        written: Mutex<Vec<u8>>,
    }

    impl ScriptedUnixPipeIo {
        fn new(writes: Vec<WriteStep>, polls: Vec<io::Result<bool>>) -> Self {
            Self {
                flags: Mutex::new(0),
                poll_deadlines: Mutex::new(Vec::new()),
                polls: Mutex::new(polls.into()),
                set_flags: Mutex::new(Vec::new()),
                writes: Mutex::new(writes.into()),
                written: Mutex::new(Vec::new()),
            }
        }
    }

    impl UnixPipeIo for ScriptedUnixPipeIo {
        fn get_flags(&self, _fd: libc::c_int) -> io::Result<libc::c_int> {
            Ok(*self.flags.lock().expect("flags"))
        }

        fn set_flags(&self, _fd: libc::c_int, flags: libc::c_int) -> io::Result<()> {
            *self.flags.lock().expect("flags") = flags;
            self.set_flags.lock().expect("set flags").push(flags);
            Ok(())
        }

        fn write(&self, _fd: libc::c_int, bytes: &[u8]) -> io::Result<usize> {
            match self.writes.lock().expect("writes").pop_front() {
                Some(WriteStep::Bytes(limit)) => {
                    let written = limit.min(bytes.len());
                    self.written
                        .lock()
                        .expect("written")
                        .extend_from_slice(&bytes[..written]);
                    Ok(written)
                }
                Some(WriteStep::Error(kind)) => Err(io::Error::new(kind, "scripted write")),
                None => {
                    self.written
                        .lock()
                        .expect("written")
                        .extend_from_slice(bytes);
                    Ok(bytes.len())
                }
            }
        }

        fn poll_writable(&self, _fd: libc::c_int, deadline: Instant) -> io::Result<bool> {
            self.poll_deadlines
                .lock()
                .expect("poll deadlines")
                .push(deadline);
            self.polls
                .lock()
                .expect("polls")
                .pop_front()
                .unwrap_or(Ok(true))
        }
    }

    struct NoopWriter;

    impl Write for NoopWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn scripted_writer(io: Arc<ScriptedUnixPipeIo>) -> Arc<SessionMessageWriter> {
        let strategy = Arc::new(UnixNonblockingPipeStrategy::new_with_io(7, io).expect("strategy"));
        SessionMessageWriter::from_strategy(Box::new(NoopWriter), strategy)
    }

    #[test]
    fn partial_eintr_and_eagain_writes_preserve_one_frame_and_deadline() {
        let io = Arc::new(ScriptedUnixPipeIo::new(
            vec![
                WriteStep::Bytes(3),
                WriteStep::Error(io::ErrorKind::Interrupted),
                WriteStep::Error(io::ErrorKind::WouldBlock),
                WriteStep::Bytes(2),
                WriteStep::Error(io::ErrorKind::WouldBlock),
            ],
            vec![Ok(true), Ok(true)],
        ));
        scripted_writer(Arc::clone(&io))
            .write_message(b"hello", Duration::from_secs(1))
            .expect("bounded write");
        assert_eq!(
            io.written.lock().expect("written").as_slice(),
            b"Content-Length: 5\r\n\r\nhello"
        );
        let deadlines = io.poll_deadlines.lock().expect("poll deadlines");
        assert_eq!(deadlines.len(), 2);
        assert_eq!(deadlines[0], deadlines[1]);
    }

    #[test]
    fn poll_timeout_is_fail_closed() {
        let io = Arc::new(ScriptedUnixPipeIo::new(
            vec![WriteStep::Error(io::ErrorKind::WouldBlock)],
            vec![Ok(false)],
        ));
        assert_eq!(
            scripted_writer(io)
                .write_message(b"x", Duration::from_secs(1))
                .expect_err("timeout")
                .kind(),
            io::ErrorKind::TimedOut
        );
    }

    #[test]
    fn partial_frame_failure_poisons_writer_before_another_frame_can_start() {
        let io = Arc::new(ScriptedUnixPipeIo::new(
            vec![
                WriteStep::Bytes(3),
                WriteStep::Error(io::ErrorKind::WouldBlock),
            ],
            vec![Ok(false)],
        ));
        let writer = scripted_writer(Arc::clone(&io));
        assert_eq!(
            writer
                .write_message(b"first", Duration::from_secs(1))
                .expect_err("partial timeout")
                .kind(),
            io::ErrorKind::TimedOut
        );
        let captured_after_failure = io.written.lock().expect("written").clone();
        assert_eq!(
            writer
                .write_message(b"second", Duration::from_secs(1))
                .expect_err("poisoned writer")
                .kind(),
            io::ErrorKind::BrokenPipe
        );
        assert_eq!(
            *io.written.lock().expect("written"),
            captured_after_failure,
            "a second frame must never be appended after a partial first frame"
        );
    }

    #[test]
    fn peer_close_is_preserved() {
        let io = Arc::new(ScriptedUnixPipeIo::new(
            vec![WriteStep::Error(io::ErrorKind::BrokenPipe)],
            vec![],
        ));
        assert_eq!(
            scripted_writer(io)
                .write_message(b"x", Duration::from_secs(1))
                .expect_err("broken pipe")
                .kind(),
            io::ErrorKind::BrokenPipe
        );
    }

    #[test]
    fn strategy_restores_flags_without_closing_fd() {
        let (reader, writer) = std::io::pipe().expect("pipe");
        let fd = writer.as_raw_fd();
        let original = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        let strategy = UnixNonblockingPipeStrategy::new(fd).expect("strategy");
        assert_ne!(
            unsafe { libc::fcntl(fd, libc::F_GETFL) } & libc::O_NONBLOCK,
            0
        );
        drop(strategy);
        assert!(unsafe { libc::fcntl(fd, libc::F_GETFL) } >= 0);
        assert_eq!(unsafe { libc::fcntl(fd, libc::F_GETFL) }, original);
        drop(reader);
        drop(writer);
    }

    struct DropOrderObservingUnixPipeIo {
        original_flags: libc::c_int,
        set_flags_calls: AtomicUsize,
        restored_while_owned: AtomicBool,
        writer_owned: Arc<AtomicBool>,
    }

    struct OwnershipObservingWriter {
        stream: UnixStream,
        owned: Arc<AtomicBool>,
    }

    impl Write for OwnershipObservingWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.stream.write(bytes)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.stream.flush()
        }
    }

    impl Drop for OwnershipObservingWriter {
        fn drop(&mut self) {
            self.owned.store(false, Ordering::SeqCst);
        }
    }

    impl UnixPipeIo for DropOrderObservingUnixPipeIo {
        fn get_flags(&self, fd: libc::c_int) -> io::Result<libc::c_int> {
            LibcUnixPipeIo.get_flags(fd)
        }

        fn set_flags(&self, fd: libc::c_int, flags: libc::c_int) -> io::Result<()> {
            let previous_calls = self.set_flags_calls.load(Ordering::SeqCst);
            let is_restore = previous_calls > 0 && flags == self.original_flags;
            if is_restore && !self.writer_owned.load(Ordering::SeqCst) {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "writer owner dropped before strategy",
                ));
            }
            LibcUnixPipeIo.set_flags(fd, flags)?;
            self.set_flags_calls.fetch_add(1, Ordering::SeqCst);
            if is_restore {
                self.restored_while_owned.store(true, Ordering::SeqCst);
            }
            Ok(())
        }

        fn write(&self, fd: libc::c_int, bytes: &[u8]) -> io::Result<usize> {
            LibcUnixPipeIo.write(fd, bytes)
        }

        fn poll_writable(&self, fd: libc::c_int, deadline: Instant) -> io::Result<bool> {
            LibcUnixPipeIo.poll_writable(fd, deadline)
        }
    }

    #[test]
    fn owned_descriptor_reports_real_epipe_and_drops_strategy_before_fd_owner() {
        let (reader, writer) = UnixStream::pair().expect("socket pair");
        let fd = writer.as_raw_fd();
        let original_flags = LibcUnixPipeIo.get_flags(fd).expect("original flags");
        let writer_owned = Arc::new(AtomicBool::new(true));
        let io = Arc::new(DropOrderObservingUnixPipeIo {
            original_flags,
            set_flags_calls: AtomicUsize::new(0),
            restored_while_owned: AtomicBool::new(false),
            writer_owned: Arc::clone(&writer_owned),
        });
        let strategy =
            Arc::new(UnixNonblockingPipeStrategy::new_with_io(fd, io.clone()).expect("strategy"));
        writer
            .shutdown(Shutdown::Write)
            .expect("close the owned write direction");
        let session = SessionMessageWriter::from_strategy(
            Box::new(OwnershipObservingWriter {
                stream: writer,
                owned: writer_owned,
            }),
            strategy,
        );

        let error = session
            .write_message(b"closed writer", Duration::from_secs(1))
            .expect_err("closed writer");
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
        drop(session);
        assert!(
            io.restored_while_owned.load(Ordering::SeqCst),
            "strategy must restore descriptor flags before the writer owner closes it"
        );
        drop(reader);
    }

    struct PermanentlyUnavailableStrategy {
        calls: AtomicUsize,
    }

    impl MessageWriteStrategy for PermanentlyUnavailableStrategy {
        fn write_framed(
            &self,
            _writer: &mut dyn Write,
            _payload: &[u8],
            _deadline: Instant,
        ) -> io::Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Err(io::Error::new(io::ErrorKind::TimedOut, "unavailable"))
        }
    }

    #[test]
    fn permanently_unavailable_strategy_returns_without_spawning_and_poison_closes_writer() {
        let strategy = Arc::new(PermanentlyUnavailableStrategy {
            calls: AtomicUsize::new(0),
        });
        let writer = SessionMessageWriter::from_strategy(Box::new(NoopWriter), strategy.clone());
        assert_eq!(
            writer
                .write_message(b"one", Duration::from_millis(1))
                .expect_err("first timeout")
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(
            writer
                .write_message(b"two", Duration::from_millis(1))
                .expect_err("poisoned writer")
                .kind(),
            io::ErrorKind::BrokenPipe
        );
        assert_eq!(strategy.calls.load(Ordering::SeqCst), 1);
    }

    struct DeadlineBlockingStrategy {
        entered: Mutex<Option<mpsc::Sender<()>>>,
        gate: Condvar,
        released: Mutex<bool>,
    }

    impl DeadlineBlockingStrategy {
        fn release_with_timeout(&self) {
            *self.released.lock().expect("released") = true;
            self.gate.notify_all();
        }
    }

    impl MessageWriteStrategy for DeadlineBlockingStrategy {
        fn write_framed(
            &self,
            _writer: &mut dyn Write,
            _payload: &[u8],
            _deadline: Instant,
        ) -> io::Result<()> {
            if let Some(entered) = self.entered.lock().expect("entered").take() {
                let _ = entered.send(());
            }
            let released = self.released.lock().expect("released");
            let _released = self
                .gate
                .wait_while(released, |released| !*released)
                .expect("release-only wait");
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "language-server stdin write timed out",
            ))
        }
    }

    struct DeadlineStrategyThreadGuard {
        occupied: Option<std::thread::JoinHandle<io::Result<()>>>,
        strategy: Arc<DeadlineBlockingStrategy>,
        waiting: Option<std::thread::JoinHandle<()>>,
    }

    impl DeadlineStrategyThreadGuard {
        fn new(
            strategy: Arc<DeadlineBlockingStrategy>,
            occupied: std::thread::JoinHandle<io::Result<()>>,
        ) -> Self {
            Self {
                occupied: Some(occupied),
                strategy,
                waiting: None,
            }
        }

        fn install_waiting(&mut self, waiting: std::thread::JoinHandle<()>) {
            self.waiting = Some(waiting);
        }

        fn join_waiting(&mut self) {
            if let Some(waiting) = self.waiting.take() {
                waiting.join().expect("waiting write");
            }
        }

        fn release_and_join_occupied(&mut self) -> io::Result<()> {
            self.strategy.release_with_timeout();
            self.occupied
                .take()
                .expect("occupied write handle")
                .join()
                .expect("occupied write")
        }
    }

    impl Drop for DeadlineStrategyThreadGuard {
        fn drop(&mut self) {
            self.strategy.release_with_timeout();
            if let Some(waiting) = self.waiting.take() {
                let _ = waiting.join();
            }
            if let Some(occupied) = self.occupied.take() {
                let _ = occupied.join();
            }
        }
    }

    #[test]
    fn waiting_for_writer_mutex_uses_the_same_deadline_and_leaves_no_inner_thread() {
        let (entered_tx, entered_rx) = mpsc::channel();
        let strategy = Arc::new(DeadlineBlockingStrategy {
            entered: Mutex::new(Some(entered_tx)),
            gate: Condvar::new(),
            released: Mutex::new(false),
        });
        let writer = SessionMessageWriter::from_strategy(Box::new(NoopWriter), strategy.clone());
        let occupied_writer = Arc::clone(&writer);
        let occupied = std::thread::spawn(move || {
            occupied_writer.write_message(b"occupied", Duration::from_secs(60))
        });
        let mut thread_guard = DeadlineStrategyThreadGuard::new(Arc::clone(&strategy), occupied);
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first write owns mutex");

        let waiting_writer = Arc::clone(&writer);
        let (waiting_started_tx, waiting_started_rx) = mpsc::channel();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let waiting = std::thread::spawn(move || {
            waiting_started_tx
                .send(())
                .expect("waiting write start signal");
            let result = waiting_writer
                .write_message(b"waiting", Duration::from_millis(10))
                .map_err(|error| error.kind());
            waiting_tx.send(result).expect("waiting write result");
        });
        thread_guard.install_waiting(waiting);
        waiting_started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("waiting write did not start");
        assert_eq!(
            waiting_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("waiting write hung while the writer mutex remained occupied"),
            Err(io::ErrorKind::TimedOut)
        );
        thread_guard.join_waiting();

        assert_eq!(
            thread_guard
                .release_and_join_occupied()
                .expect_err("occupied timeout")
                .kind(),
            io::ErrorKind::TimedOut,
            "the occupied write fails only after the test releases its independent gate"
        );
    }

    struct PartialFailureRaceStrategy {
        calls: AtomicUsize,
        entered: Mutex<Option<mpsc::Sender<()>>>,
        gate: Condvar,
        released: Mutex<bool>,
    }

    impl MessageWriteStrategy for PartialFailureRaceStrategy {
        fn write_framed(
            &self,
            _writer: &mut dyn Write,
            _payload: &[u8],
            _deadline: Instant,
        ) -> io::Result<()> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call != 0 {
                return Ok(());
            }
            if let Some(entered) = self.entered.lock().expect("entered").take() {
                entered.send(()).expect("signal first write");
            }
            let released = self.released.lock().expect("released");
            let _released = self
                .gate
                .wait_while(released, |released| !*released)
                .expect("failure gate");
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "partial framed write failed",
            ))
        }
    }

    #[test]
    fn queued_writer_cannot_enter_strategy_between_partial_failure_and_poison() {
        let (entered_tx, entered_rx) = mpsc::channel();
        let strategy = Arc::new(PartialFailureRaceStrategy {
            calls: AtomicUsize::new(0),
            entered: Mutex::new(Some(entered_tx)),
            gate: Condvar::new(),
            released: Mutex::new(false),
        });
        let writer = SessionMessageWriter::from_strategy(Box::new(NoopWriter), strategy.clone());
        let first_writer = Arc::clone(&writer);
        let first = std::thread::spawn(move || {
            first_writer.write_message(b"first", Duration::from_secs(1))
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first strategy entered");
        let second_writer = Arc::clone(&writer);
        let second = std::thread::spawn(move || {
            second_writer.write_message(b"second", Duration::from_secs(1))
        });
        *strategy.released.lock().expect("released") = true;
        strategy.gate.notify_all();

        assert_eq!(
            first
                .join()
                .expect("first")
                .expect_err("first failure")
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(
            second
                .join()
                .expect("second")
                .expect_err("poisoned second")
                .kind(),
            io::ErrorKind::BrokenPipe
        );
        assert_eq!(strategy.calls.load(Ordering::SeqCst), 1);
    }
}
