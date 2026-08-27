use serde::{Deserialize, Serialize};

#[path = "agent_provider.rs"]
pub mod agent_provider;
use std::{
    fs, io,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::Arc,
};

pub const MAX_AGENT_PROMPT_BYTES: usize = 32 * 1024;
pub const MAX_AGENT_CLI_PATH_BYTES: usize = 4 * 1024;
pub const MIN_AGENT_SESSION_ID_BYTES: usize = 8;
pub const MAX_AGENT_SESSION_ID_BYTES: usize = 128;
pub const AGENT_TASK_INHERITED_ENV: [&str; 7] =
    ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"];
pub const CLAUDE_CLI_BINARY_UNAVAILABLE_ERROR: &str =
    "The Claude CLI binary is missing or not executable (it may be updating). Retry in a moment.";
pub const CODEX_CLI_BINARY_UNAVAILABLE_ERROR: &str =
    "The Codex CLI binary is missing or not executable (it may be updating). Retry in a moment.";

#[path = "agent_launch.rs"]
pub mod agent_launch;

use agent_launch::{AgentLaunchOptions, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentCliInvocation {
    ClaudeCode,
    #[serde(rename = "codex")]
    CodexExec,
}

#[derive(Clone, Debug)]
pub struct AgentTaskSpawnPlan {
    program: PathBuf,
    executable_identity: agent_provider::process::ExecutableIdentity,
    args: Vec<String>,
    cwd: PathBuf,
    #[cfg(unix)]
    cwd_authority: Option<Arc<fs::File>>,
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

    #[cfg(unix)]
    pub(crate) fn with_cwd_authority(mut self, cwd_authority: Arc<fs::File>) -> Self {
        self.cwd_authority = Some(cwd_authority);
        self
    }

    #[cfg(not(unix))]
    pub(crate) fn with_cwd_authority(self, cwd_authority: Arc<fs::File>) -> Self {
        drop(cwd_authority);
        self
    }

    #[cfg(unix)]
    fn cwd_authority(&self) -> Option<&fs::File> {
        self.cwd_authority.as_deref()
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
        let identity_program = match program.is_file() {
            true => program.clone(),
            false => std::env::current_exe().expect("test executable path"),
        };
        Self {
            executable_identity: agent_provider::process::executable_identity(
                identity_program.to_str().expect("test executable path"),
            )
            .expect("test executable identity"),
            program,
            args,
            cwd,
            #[cfg(unix)]
            cwd_authority: None,
            env,
        }
    }
}

pub fn plan_agent_invocation(
    cli_path: &str,
    invocation: AgentCliInvocation,
    prompt: &str,
    cwd: &Path,
    resume_session_id: Option<&str>,
    launch: AgentLaunchOptions,
) -> Result<AgentTaskSpawnPlan, String> {
    if !launch.matches(invocation) {
        return Err(AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR.to_string());
    }
    if let Some(candidate) = resume_session_id {
        validate_resume_session_id(candidate)?;
    }
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
    let executable_identity = agent_provider::process::executable_identity(cli_path)
        .map_err(|_| agent_cli_binary_unavailable_error(invocation))?;
    if prompt.is_empty() {
        return Err("Agent prompt must not be empty.".to_string());
    }
    if prompt.len() > MAX_AGENT_PROMPT_BYTES {
        return Err("Agent prompt exceeds the supported length.".to_string());
    }
    if !cwd.is_absolute() {
        return Err("Agent working directory must be absolute.".to_string());
    }
    let args = agent_invocation_args(invocation, prompt, resume_session_id, launch);
    Ok(AgentTaskSpawnPlan {
        program: executable_identity.canonical_path.clone(),
        executable_identity,
        args,
        cwd: cwd.to_path_buf(),
        #[cfg(unix)]
        cwd_authority: None,
        env: inherited_environment(),
    })
}

fn agent_invocation_args(
    invocation: AgentCliInvocation,
    prompt: &str,
    resume_session_id: Option<&str>,
    launch: AgentLaunchOptions,
) -> Vec<String> {
    let resumed = resume_session_id.is_some();
    let mut template: Vec<&str> = match invocation {
        AgentCliInvocation::ClaudeCode => {
            vec!["-p", "--output-format", "stream-json", "--verbose"]
        }
        AgentCliInvocation::CodexExec if resumed => vec!["exec", "resume", "--json"],
        AgentCliInvocation::CodexExec => vec!["exec", "--json"],
    };
    template.extend_from_slice(launch.model_args());
    template.extend_from_slice(launch.mode_args(resumed));
    template.extend_from_slice(launch.effort_args());
    if let Some(session_id) = resume_session_id {
        match invocation {
            AgentCliInvocation::ClaudeCode => template.extend_from_slice(&["--resume", session_id]),
            AgentCliInvocation::CodexExec => template.push(session_id),
        }
    }
    template.push("--");
    template
        .into_iter()
        .map(str::to_string)
        .chain(std::iter::once(prompt.to_string()))
        .collect()
}

pub fn validate_resume_session_id(candidate: &str) -> Result<&str, String> {
    if candidate.len() < MIN_AGENT_SESSION_ID_BYTES {
        return Err("Agent session id is too short.".to_string());
    }
    if candidate.len() > MAX_AGENT_SESSION_ID_BYTES {
        return Err("Agent session id exceeds the supported length.".to_string());
    }
    let mut characters = candidate.chars();
    let Some(first) = characters.next() else {
        return Err("Agent session id is required.".to_string());
    };
    if !first.is_ascii_alphanumeric() {
        return Err("Agent session id must start with a letter or digit.".to_string());
    }
    if !characters
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(
            "Agent session id may contain only letters, digits, dashes, and underscores."
                .to_string(),
        );
    }
    Ok(candidate)
}

pub(crate) fn inherited_environment() -> Vec<(String, String)> {
    AGENT_TASK_INHERITED_ENV
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| ((*key).to_string(), value))
        })
        .collect()
}

pub fn agent_cli_binary_unavailable_error(invocation: AgentCliInvocation) -> String {
    match invocation {
        AgentCliInvocation::ClaudeCode => CLAUDE_CLI_BINARY_UNAVAILABLE_ERROR.to_string(),
        AgentCliInvocation::CodexExec => CODEX_CLI_BINARY_UNAVAILABLE_ERROR.to_string(),
    }
}

pub trait AgentChild: Send {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn try_wait(&mut self) -> Result<Option<i32>, String>;
    fn process_group_id(&self) -> i32;
    fn force_kill(&mut self) -> Result<(), String>;
}

pub trait AgentProcessSpawner: Send + Sync {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String>;
}

pub struct StdAgentProcessSpawner;

impl AgentProcessSpawner for StdAgentProcessSpawner {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        if !plan.executable_identity.retained_is_current()
            || agent_provider::process::executable_identity(
                plan.program()
                    .to_str()
                    .ok_or_else(|| "Agent CLI path is invalid.".to_string())?,
            )
            .ok()
            .as_ref()
                != Some(&plan.executable_identity)
        {
            return Err("Agent CLI executable identity changed before launch.".to_string());
        }
        let mut bound = plan
            .executable_identity
            .bound_command()
            .map_err(|_| "Agent CLI executable identity changed before launch.".to_string())?;
        let command = bound.command_mut();
        command
            .args(plan.args())
            .env_clear()
            .envs(plan.env().iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::process::CommandExt;

            if let Some(cwd_authority) = plan.cwd_authority() {
                let cwd_fd = cwd_authority.as_raw_fd();
                unsafe {
                    command.pre_exec(move || {
                        if libc::fchdir(cwd_fd) == 0 {
                            return Ok(());
                        }
                        Err(io::Error::last_os_error())
                    });
                }
            }
            if plan.cwd_authority().is_none() {
                command.current_dir(plan.cwd());
            }
            command.process_group(0);
        }
        #[cfg(not(unix))]
        command.current_dir(plan.cwd());
        let mut child = match bound.spawn() {
            Ok(child) => child,
            Err(agent_provider::process::BoundExecutableSpawnFailure::IdentityChanged) => {
                return Err("Agent CLI executable identity changed before launch.".to_string());
            }
            Err(agent_provider::process::BoundExecutableSpawnFailure::Spawn(error)) => {
                return Err(format!("Unable to launch agent task: {error}"));
            }
        };
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

    fn force_kill(&mut self) -> Result<(), String> {
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.process_group_id, libc::SIGKILL);
        }
        self.child
            .kill()
            .map_err(|error| format!("Unable to kill agent child: {error}"))
    }
}

#[cfg(unix)]
pub(crate) fn observe_exit_without_reaping(child: &Child) -> io::Result<bool> {
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

pub(crate) fn reap_child(child: &mut Child) -> io::Result<std::process::ExitStatus> {
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

#[cfg(test)]
mod tests {
    use super::agent_launch::{
        ClaudeEffortChoice, ClaudeModelChoice, ClaudePermissionMode, CodexExecutionMode,
        CodexModelChoice,
    };
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static CWD_AUTHORITY_NONCE: AtomicU64 = AtomicU64::new(0);

    const SESSION_ID: &str = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";

    const CLAUDE_MODELS: [ClaudeModelChoice; 4] = [
        ClaudeModelChoice::Default,
        ClaudeModelChoice::Fable,
        ClaudeModelChoice::Opus,
        ClaudeModelChoice::Sonnet,
    ];
    const CLAUDE_MODES: [ClaudePermissionMode; 4] = [
        ClaudePermissionMode::Default,
        ClaudePermissionMode::Plan,
        ClaudePermissionMode::AcceptEdits,
        ClaudePermissionMode::BypassPermissions,
    ];
    const CODEX_MODELS: [CodexModelChoice; 4] = [
        CodexModelChoice::Default,
        CodexModelChoice::Gpt56Sol,
        CodexModelChoice::Gpt55,
        CodexModelChoice::Gpt54,
    ];
    const CODEX_MODES: [CodexExecutionMode; 4] = [
        CodexExecutionMode::Default,
        CodexExecutionMode::ReadOnly,
        CodexExecutionMode::WorkspaceWrite,
        CodexExecutionMode::DangerFullAccess,
    ];

    const CLAUDE_EFFORTS: [ClaudeEffortChoice; 6] = [
        ClaudeEffortChoice::Default,
        ClaudeEffortChoice::Low,
        ClaudeEffortChoice::Medium,
        ClaudeEffortChoice::High,
        ClaudeEffortChoice::Xhigh,
        ClaudeEffortChoice::Max,
    ];

    fn claude_default() -> AgentLaunchOptions {
        AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Default,
            mode: ClaudePermissionMode::Default,
            effort: ClaudeEffortChoice::Default,
        }
    }

    fn codex_default() -> AgentLaunchOptions {
        AgentLaunchOptions::Codex {
            model: CodexModelChoice::Default,
            mode: CodexExecutionMode::Default,
        }
    }

    #[cfg(unix)]
    #[test]
    fn retained_cwd_authority_cannot_be_redirected_by_path_replacement() {
        let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
        let fixture = std::env::temp_dir().join(format!(
            "agent-task-retained-cwd-{}-{nonce}",
            std::process::id()
        ));
        let original = fixture.join("original");
        let retained = fixture.join("retained");
        fs::create_dir_all(&original).expect("create original cwd");
        let cwd_authority = Arc::new(fs::File::open(&original).expect("open cwd authority"));
        let plan = AgentTaskSpawnPlan::for_tests(
            PathBuf::from("/bin/pwd"),
            Vec::new(),
            original.clone(),
            inherited_environment(),
        )
        .with_cwd_authority(cwd_authority);
        fs::rename(&original, &retained).expect("move retained cwd");
        fs::create_dir_all(&original).expect("replace original cwd path");

        let mut child = StdAgentProcessSpawner
            .spawn(&plan)
            .expect("spawn retained cwd");
        let mut stdout = String::new();
        child
            .stdout_reader()
            .expect("stdout reader")
            .read_to_string(&mut stdout)
            .expect("read stdout");
        let mut stderr = String::new();
        child
            .stderr_reader()
            .expect("stderr reader")
            .read_to_string(&mut stderr)
            .expect("read stderr");
        let exit_code = child.try_wait().expect("wait for pwd");

        assert_eq!(exit_code, Some(0), "stderr: {stderr}");
        assert_eq!(
            PathBuf::from(stdout.trim()),
            retained.canonicalize().expect("canonical retained cwd")
        );
        fs::remove_dir_all(&fixture).expect("remove cwd fixture");
    }

    #[cfg(unix)]
    #[test]
    fn retained_cli_identity_rejects_path_replacement_before_spawn() {
        use std::os::unix::fs::PermissionsExt;

        let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
        let fixture = std::env::temp_dir().join(format!(
            "agent-task-retained-cli-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&fixture).expect("fixture");
        let cli = fixture.join("claude");
        fs::write(&cli, "#!/bin/sh\nexit 0\n").expect("cli");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");
        let plan = plan_agent_invocation(
            cli.to_str().expect("path"),
            AgentCliInvocation::ClaudeCode,
            "stop",
            &fixture,
            None,
            claude_default(),
        )
        .expect("plan");
        fs::rename(&cli, fixture.join("retained")).expect("rename");
        fs::write(&cli, "#!/bin/sh\nexit 7\n").expect("replacement");
        fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).expect("permissions");

        let error = match StdAgentProcessSpawner.spawn(&plan) {
            Ok(_) => panic!("replacement accepted"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            "Agent CLI executable identity changed before launch."
        );
        fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn spawn_plan_removes_configured_symlink_indirection() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let nonce = CWD_AUTHORITY_NONCE.fetch_add(1, Ordering::SeqCst);
        let fixture = std::env::temp_dir().join(format!(
            "agent-task-cli-symlink-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&fixture).expect("fixture");
        let retained = fixture.join("retained");
        fs::write(&retained, "#!/bin/sh\nexit 0\n").expect("cli");
        fs::set_permissions(&retained, fs::Permissions::from_mode(0o755)).expect("permissions");
        let configured = fixture.join("configured");
        symlink(&retained, &configured).expect("symlink");
        let plan = plan_agent_invocation(
            configured.to_str().expect("path"),
            AgentCliInvocation::ClaudeCode,
            "stop",
            &fixture,
            None,
            claude_default(),
        )
        .expect("plan");

        assert_eq!(
            plan.program,
            retained.canonicalize().expect("canonical cli")
        );
        fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[test]
    fn claude_first_turn_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::ClaudeCode,
                "do it",
                None,
                claude_default()
            ),
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--",
                "do it"
            ]
        );
    }

    #[test]
    fn claude_follow_up_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::ClaudeCode,
                "do it",
                Some(SESSION_ID),
                claude_default()
            ),
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--resume",
                SESSION_ID,
                "--",
                "do it"
            ]
        );
    }

    #[test]
    fn codex_first_turn_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::CodexExec,
                "do it",
                None,
                codex_default()
            ),
            ["exec", "--json", "--", "do it"]
        );
    }

    #[test]
    fn codex_follow_up_default_launch_keeps_the_pre_launch_argv_byte_for_byte() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::CodexExec,
                "do it",
                Some(SESSION_ID),
                codex_default()
            ),
            ["exec", "resume", "--json", SESSION_ID, "--", "do it"]
        );
    }

    #[test]
    fn claude_argv_places_model_then_mode_then_resume_before_the_prompt_separator() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::ClaudeCode,
                "do it",
                Some(SESSION_ID),
                AgentLaunchOptions::ClaudeCode {
                    model: ClaudeModelChoice::Opus,
                    mode: ClaudePermissionMode::AcceptEdits,
                    effort: ClaudeEffortChoice::Default,
                }
            ),
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--model",
                "opus",
                "--permission-mode",
                "acceptEdits",
                "--resume",
                SESSION_ID,
                "--",
                "do it"
            ]
        );
    }

    #[test]
    fn codex_resume_argv_places_options_before_the_positional_session_id() {
        assert_eq!(
            agent_invocation_args(
                AgentCliInvocation::CodexExec,
                "do it",
                Some(SESSION_ID),
                AgentLaunchOptions::Codex {
                    model: CodexModelChoice::Gpt55,
                    mode: CodexExecutionMode::WorkspaceWrite,
                }
            ),
            [
                "exec",
                "resume",
                "--json",
                "-m",
                "gpt-5.5",
                "-c",
                "sandbox_mode=\"workspace-write\"",
                SESSION_ID,
                "--",
                "do it"
            ]
        );
    }

    #[test]
    fn claude_argv_table_covers_every_model_mode_and_resume_combination() {
        for model in CLAUDE_MODELS {
            for mode in CLAUDE_MODES {
                for effort in CLAUDE_EFFORTS {
                    let launch = AgentLaunchOptions::ClaudeCode {
                        model,
                        mode,
                        effort,
                    };
                    for resume in [None, Some(SESSION_ID)] {
                        let mut expected: Vec<String> =
                            ["-p", "--output-format", "stream-json", "--verbose"]
                                .into_iter()
                                .map(str::to_string)
                                .collect();
                        expected.extend(launch.model_args().iter().map(|arg| (*arg).to_string()));
                        expected.extend(
                            launch
                                .mode_args(resume.is_some())
                                .iter()
                                .map(|arg| (*arg).to_string()),
                        );
                        expected.extend(launch.effort_args().iter().map(|arg| (*arg).to_string()));
                        if let Some(session_id) = resume {
                            expected.push("--resume".to_string());
                            expected.push(session_id.to_string());
                        }
                        expected.push("--".to_string());
                        expected.push("do it".to_string());
                        assert_eq!(
                            agent_invocation_args(
                                AgentCliInvocation::ClaudeCode,
                                "do it",
                                resume,
                                launch
                            ),
                            expected,
                            "claude {model:?}/{mode:?}/{effort:?} resume={}",
                            resume.is_some()
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn codex_argv_table_covers_every_model_mode_and_resume_combination() {
        for model in CODEX_MODELS {
            for mode in CODEX_MODES {
                let launch = AgentLaunchOptions::Codex { model, mode };
                for resume in [None, Some(SESSION_ID)] {
                    let mut expected: Vec<String> = match resume {
                        Some(_) => vec!["exec", "resume", "--json"],
                        None => vec!["exec", "--json"],
                    }
                    .into_iter()
                    .map(str::to_string)
                    .collect();
                    expected.extend(launch.model_args().iter().map(|arg| (*arg).to_string()));
                    expected.extend(
                        launch
                            .mode_args(resume.is_some())
                            .iter()
                            .map(|arg| (*arg).to_string()),
                    );
                    if let Some(session_id) = resume {
                        expected.push(session_id.to_string());
                    }
                    expected.push("--".to_string());
                    expected.push("do it".to_string());
                    assert_eq!(
                        agent_invocation_args(
                            AgentCliInvocation::CodexExec,
                            "do it",
                            resume,
                            launch
                        ),
                        expected,
                        "codex {model:?}/{mode:?} resume={}",
                        resume.is_some()
                    );
                }
            }
        }
    }

    #[test]
    fn planning_rejects_launch_options_from_another_provider() {
        let mismatch = plan_agent_invocation(
            "",
            AgentCliInvocation::ClaudeCode,
            "do it",
            Path::new("/workspace"),
            None,
            codex_default(),
        )
        .expect_err("cross-provider launch must be refused");
        assert_eq!(mismatch, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);

        let reversed = plan_agent_invocation(
            "",
            AgentCliInvocation::CodexExec,
            "do it",
            Path::new("/workspace"),
            None,
            claude_default(),
        )
        .expect_err("cross-provider launch must be refused");
        assert_eq!(reversed, AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR);
    }

    #[test]
    fn accepts_session_ids_within_the_safe_pattern() {
        assert_eq!(
            validate_resume_session_id("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"),
            Ok("0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b")
        );
        assert!(validate_resume_session_id("abcd_efg").is_ok());
        assert!(validate_resume_session_id(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES)).is_ok());
    }

    #[test]
    fn rejects_flag_like_short_oversize_and_non_ascii_session_ids() {
        assert!(validate_resume_session_id("-resume-me").is_err());
        assert!(validate_resume_session_id("--flag123").is_err());
        assert!(validate_resume_session_id("short").is_err());
        assert!(validate_resume_session_id("").is_err());
        assert!(validate_resume_session_id(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES + 1)).is_err());
        assert!(validate_resume_session_id("has space").is_err());
        assert!(validate_resume_session_id("sess/ion1").is_err());
        assert!(validate_resume_session_id("sessi\u{00f3}n01").is_err());
    }

    #[test]
    fn planning_rejects_unsafe_resume_session_ids_before_any_other_work() {
        let flag_like = plan_agent_invocation(
            "",
            AgentCliInvocation::ClaudeCode,
            "do it",
            Path::new("/workspace"),
            Some("--dangerously-skip-permissions"),
            claude_default(),
        )
        .expect_err("flag-like resume id must be refused");
        let oversize = plan_agent_invocation(
            "",
            AgentCliInvocation::CodexExec,
            "do it",
            Path::new("/workspace"),
            Some(&"a".repeat(MAX_AGENT_SESSION_ID_BYTES + 1)),
            codex_default(),
        )
        .expect_err("oversize resume id must be refused");

        assert!(flag_like.contains("session id"), "got: {flag_like}");
        assert!(oversize.contains("session id"), "got: {oversize}");
    }
}
