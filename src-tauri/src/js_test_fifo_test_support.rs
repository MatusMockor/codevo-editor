use std::{
    ffi::CString,
    fs,
    io::Read,
    os::unix::{ffi::OsStrExt, io::AsRawFd},
    path::Path,
    time::{Duration, Instant},
};

pub(crate) fn open_fifo(path: &Path) -> fs::File {
    let native_path = CString::new(path.as_os_str().as_bytes()).expect("fifo path");
    let result = unsafe { libc::mkfifo(native_path.as_ptr(), 0o600) };
    assert_eq!(
        result,
        0,
        "create fifo at {}: {}",
        path.display(),
        std::io::Error::last_os_error()
    );
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .expect("open fifo")
}

pub(crate) fn read_start_events(
    events: &mut fs::File,
    buffer: &mut [u8],
    timeout: Duration,
    label: &str,
) {
    let deadline = Instant::now() + timeout;
    let mut filled = 0;
    while filled < buffer.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "{label}: only {filled} of {} start events arrived before the deadline",
            buffer.len()
        );
        let mut descriptor = libc::pollfd {
            fd: events.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut descriptor, 1, remaining.as_millis() as libc::c_int) };
        assert!(
            ready >= 0,
            "{label} poll: {}",
            std::io::Error::last_os_error()
        );
        if ready == 0 {
            continue;
        }
        filled += events
            .read(&mut buffer[filled..])
            .expect("read start events");
    }
}
