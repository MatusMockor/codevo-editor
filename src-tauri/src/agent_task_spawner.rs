use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

pub const MAX_AGENT_PROMPT_BYTES: usize = 32 * 1024;
pub const MAX_AGENT_CLI_PATH_BYTES: usize = 4 * 1024;
pub const AGENT_TASK_INHERITED_ENV: [&str; 7] =
    ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"];

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCliInvocation {
    ClaudeCode,
    #[serde(rename = "codex")]
    CodexExec,
}

#[derive(Clone, Debug)]
pub struct AgentTaskSpawnPlan {
    program: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: Vec<(String, String)>,
}

impl AgentTaskSpawnPlan {
    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    pub fn env(&self) -> &[(String, String)] {
        &self.env
    }

    #[cfg(test)]
    pub fn for_tests(
        program: PathBuf,
        args: Vec<String>,
        cwd: PathBuf,
        env: Vec<(String, String)>,
    ) -> Self {
        Self {
            program,
            args,
            cwd,
            env,
        }
    }
}

pub fn plan_agent_invocation(
    cli_path: &str,
    invocation: AgentCliInvocation,
    prompt: &str,
    cwd: &Path,
) -> Result<AgentTaskSpawnPlan, String> {
    if cli_path.is_empty() {
        return Err("Agent CLI path is not configured.".to_string());
    }
    if cli_path.len() > MAX_AGENT_CLI_PATH_BYTES {
        return Err("Agent CLI path exceeds the supported length.".to_string());
    }
    let program = Path::new(cli_path);
    if !program.is_absolute() {
        return Err("Agent CLI path must be absolute.".to_string());
    }
    let metadata = fs::metadata(program)
        .map_err(|error| format!("Agent CLI path is not readable: {error}"))?;
    if !metadata.is_file() {
        return Err("Agent CLI path is not a regular file.".to_string());
    }
    ensure_executable(&metadata)?;
    if prompt.is_empty() {
        return Err("Agent prompt must not be empty.".to_string());
    }
    if prompt.len() > MAX_AGENT_PROMPT_BYTES {
        return Err("Agent prompt exceeds the supported length.".to_string());
    }
    if !cwd.is_absolute() {
        return Err("Agent working directory must be absolute.".to_string());
    }
    let args = match invocation {
        AgentCliInvocation::ClaudeCode => {
            vec!["-p".to_string(), "--".to_string(), prompt.to_string()]
        }
        AgentCliInvocation::CodexExec => {
            vec!["exec".to_string(), "--".to_string(), prompt.to_string()]
        }
    };
    Ok(AgentTaskSpawnPlan {
        program: program.to_path_buf(),
        args,
        cwd: cwd.to_path_buf(),
        env: inherited_environment(),
    })
}

fn inherited_environment() -> Vec<(String, String)> {
    AGENT_TASK_INHERITED_ENV
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| ((*key).to_string(), value))
        })
        .collect()
}

#[cfg(unix)]
fn ensure_executable(metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 == 0 {
        return Err("Agent CLI path is not executable.".to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_metadata: &fs::Metadata) -> Result<(), String> {
    Ok(())
}

pub trait AgentChild: Send {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn try_wait(&mut self) -> Result<Option<i32>, String>;
    fn process_group_id(&self) -> i32;
}

pub trait AgentProcessSpawner: Send + Sync {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String>;
}

pub struct StdAgentProcessSpawner;

impl AgentProcessSpawner for StdAgentProcessSpawner {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let mut command = Command::new(plan.program());
        command
            .args(plan.args())
            .current_dir(plan.cwd())
            .env_clear()
            .envs(plan.env().iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Unable to launch agent task: {error}"))?;
        let Ok(process_group_id) = i32::try_from(child.id()) else {
            let _ = child.kill();
            let _ = reap_child(&mut child);
            return Err("Agent process identifier is not addressable.".to_string());
        };
        Ok(Box::new(StdAgentChild {
            child,
            process_group_id,
        }))
    }
}

struct StdAgentChild {
    child: Child,
    process_group_id: i32,
}

impl AgentChild for StdAgentChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let stdout = self
            .child
            .stdout
            .take()
            .ok_or_else(|| "Agent stdout pipe is unavailable.".to_string())?;
        Ok(Box::new(stdout))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let stderr = self
            .child
            .stderr
            .take()
            .ok_or_else(|| "Agent stderr pipe is unavailable.".to_string())?;
        Ok(Box::new(stderr))
    }

    #[cfg(unix)]
    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        if !observe_exit_without_reaping(&self.child)
            .map_err(|error| format!("Unable to observe agent exit: {error}"))?
        {
            return Ok(None);
        }
        unsafe {
            libc::kill(-self.process_group_id, libc::SIGKILL);
        }
        let status = reap_child(&mut self.child)
            .map_err(|error| format!("Unable to reap agent: {error}"))?;
        Ok(Some(exit_code_of(status)))
    }

    #[cfg(not(unix))]
    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        let status = self
            .child
            .try_wait()
            .map_err(|error| format!("Unable to observe agent exit: {error}"))?;
        Ok(status.map(exit_code_of))
    }

    fn process_group_id(&self) -> i32 {
        self.process_group_id
    }
}

#[cfg(unix)]
fn observe_exit_without_reaping(child: &Child) -> io::Result<bool> {
    loop {
        let mut information = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                child.id(),
                information.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            let information = unsafe { information.assume_init() };
            return Ok(unsafe { information.si_pid() } != 0);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn reap_child(child: &mut Child) -> io::Result<std::process::ExitStatus> {
    loop {
        match child.wait() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => return result,
        }
    }
}

#[cfg(unix)]
fn exit_code_of(status: std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    if let Some(code) = status.code() {
        return code;
    }
    status.signal().map_or(-1, |signal| 128 + signal)
}

#[cfg(not(unix))]
fn exit_code_of(status: std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(-1)
}
