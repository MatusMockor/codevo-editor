use std::thread;
use std::time::Duration;

const PROCESS_KILL_ESCALATION_DELAY: Duration = Duration::from_millis(500);

pub(crate) fn terminate_process_group(process_id: u32) {
    let Ok(process_group_id) = i32::try_from(process_id) else {
        return;
    };
    signal_process_group(process_group_id, libc::SIGTERM);
    if thread::Builder::new()
        .name("process-group-kill-escalation".to_string())
        .spawn(move || {
            thread::sleep(PROCESS_KILL_ESCALATION_DELAY);
            signal_process_group(process_group_id, libc::SIGKILL);
        })
        .is_err()
    {
        signal_process_group(process_group_id, libc::SIGKILL);
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

#[cfg(all(test, unix))]
mod tests {
    use super::{terminate_process_group, PROCESS_KILL_ESCALATION_DELAY};
    use std::fs;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn terminate_kills_the_whole_process_group() {
        let child_pid_path = temporary_child_pid_path();
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $! > \"$1\"; wait")
            .arg("process-group")
            .arg(&child_pid_path)
            .process_group(0);
        let mut child = command.spawn().expect("spawn process group");
        let child_process_id = wait_for_child_pid(&child_pid_path);

        terminate_process_group(child.id());
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
        panic!("child process survived process-group termination");
    }

    fn temporary_child_pid_path() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("codevo-process-group-child-{suffix}.pid"))
    }

    fn wait_for_child_pid(path: &PathBuf) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Some(process_id) = fs::read_to_string(path)
                .ok()
                .and_then(|content| content.trim().parse().ok())
            {
                return process_id;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("process group did not report its child process id");
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
