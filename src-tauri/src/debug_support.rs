use crate::debug_adapter::DebugBreakpoint;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const PROCESS_KILL_ESCALATION_DELAY: Duration = Duration::from_millis(500);

pub(crate) fn file_url_from_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for character in path.chars() {
        match character {
            ' ' => encoded.push_str("%20"),
            '%' => encoded.push_str("%25"),
            '#' => encoded.push_str("%23"),
            '?' => encoded.push_str("%3F"),
            _ => encoded.push(character),
        }
    }
    format!("file://{encoded}")
}

pub(crate) fn path_from_file_url(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    Some(percent_decode(path))
}

pub(crate) fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

pub(crate) fn validate_workspace_file(root: &Path, path: &str) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve the workspace root: {error}"))?;
    let candidate = PathBuf::from(path);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let metadata =
        fs::metadata(&candidate).map_err(|_| format!("Debug target `{path}` was not found."))?;
    if !metadata.is_file() {
        return Err(format!("Debug target `{path}` is not a file."));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Unable to resolve debug target `{path}`: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "Debug target `{path}` is outside the workspace root."
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

pub(crate) fn group_breakpoints_by_file(
    breakpoints: &[DebugBreakpoint],
) -> Vec<(String, Vec<DebugBreakpoint>)> {
    let mut grouped: Vec<(String, Vec<DebugBreakpoint>)> = Vec::new();
    for breakpoint in breakpoints {
        if let Some((_, entries)) = grouped
            .iter_mut()
            .find(|(file_path, _)| file_path == &breakpoint.file_path)
        {
            entries.push(breakpoint.clone());
            continue;
        }
        grouped.push((breakpoint.file_path.clone(), vec![breakpoint.clone()]));
    }
    grouped
}

#[derive(Clone, Copy)]
pub(crate) struct DebugProcessHandle {
    process_group_id: Option<i32>,
}

impl DebugProcessHandle {
    pub(crate) fn from_process_id(process_id: u32) -> Self {
        Self {
            process_group_id: i32::try_from(process_id).ok(),
        }
    }

    pub(crate) fn terminate(&self) {
        let Some(process_group_id) = self.process_group_id else {
            return;
        };
        signal_process_group(process_group_id, libc::SIGTERM);
        thread::spawn(move || {
            thread::sleep(PROCESS_KILL_ESCALATION_DELAY);
            signal_process_group(process_group_id, libc::SIGKILL);
        });
    }
}

#[cfg(all(test, unix))]
mod process_tests {
    use super::{DebugProcessHandle, PROCESS_KILL_ESCALATION_DELAY};
    use std::fs;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn terminate_kills_the_debuggee_process_group() {
        let child_pid_path = temporary_child_pid_path();
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $! > \"$1\"; wait")
            .arg("debug-process-group")
            .arg(&child_pid_path)
            .process_group(0);
        let mut child = command.spawn().expect("spawn process group");
        let child_process_id = wait_for_child_pid(&child_pid_path);

        DebugProcessHandle::from_process_id(child.id()).terminate();
        let deadline = Instant::now() + PROCESS_KILL_ESCALATION_DELAY + Duration::from_secs(2);

        while Instant::now() < deadline {
            if !process_is_running(child_process_id) {
                let _ = child.wait();
                let _ = fs::remove_file(child_pid_path);
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }

        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(child_pid_path);
        panic!("debuggee child process survived process-group termination");
    }

    fn temporary_child_pid_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("codevo-debug-child-{suffix}.pid"))
    }

    fn wait_for_child_pid(path: &PathBuf) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Ok(content) = fs::read_to_string(path) {
                return content.trim().parse().expect("child process id");
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("debuggee did not report its child process id");
    }

    fn process_is_running(process_id: u32) -> bool {
        let output = Command::new("/bin/ps")
            .args(["-o", "state=", "-p", &process_id.to_string()])
            .output()
            .expect("inspect child process");
        let state = String::from_utf8_lossy(&output.stdout);
        let state = state.trim();
        !state.is_empty() && !state.starts_with('Z')
    }
}

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) {
    unsafe {
        libc::kill(-process_group_id, signal);
    }
}

#[cfg(not(unix))]
fn signal_process_group(_process_group_id: i32, _signal: i32) {}
