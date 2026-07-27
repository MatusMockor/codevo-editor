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
