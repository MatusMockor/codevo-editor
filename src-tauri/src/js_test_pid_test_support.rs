use std::{
    fs,
    path::Path,
    thread,
    time::{Duration, Instant},
};

pub(crate) fn wait_for_parseable_pid(path: &Path, label: &str) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut last_read = None;
    let mut last_read_error = None;
    while Instant::now() < deadline {
        match fs::read_to_string(path) {
            Ok(contents) => {
                last_read_error = None;
                if let Ok(pid) = contents.trim().parse::<i32>() {
                    return pid;
                }
                last_read = Some(contents);
            }
            Err(error) => {
                last_read_error = Some(error.to_string());
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    let parsed = last_read
        .as_deref()
        .and_then(|contents| contents.trim().parse::<i32>().ok());
    assert!(
        parsed.is_some(),
        "timed out waiting for {label} at {} to contain a parseable pid; last read: {last_read:?}; last read error: {last_read_error:?}",
        path.display()
    );
    parsed.unwrap_or_default()
}

pub(crate) fn await_parseable_pid_while(
    path: &Path,
    label: &str,
    running: impl Fn() -> bool,
) -> i32 {
    loop {
        if let Some(pid) = read_parseable_pid(path) {
            return pid;
        }
        if !running() {
            let pid = read_parseable_pid(path);
            assert!(
                pid.is_some(),
                "the process exited before writing {label} at {}",
                path.display()
            );
            return pid.unwrap_or_default();
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(crate) fn await_file_while(path: &Path, label: &str, running: impl Fn() -> bool) {
    while !path.is_file() {
        assert!(
            running() || path.is_file(),
            "the process exited before creating {label} at {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(5));
    }
}

pub(crate) fn assert_process_reaped(pid: i32) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if unsafe { libc::kill(pid, 0) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "process {pid} remained alive after its process group was reaped"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_parseable_pid(path: &Path) -> Option<i32> {
    fs::read_to_string(path).ok()?.trim().parse::<i32>().ok()
}
