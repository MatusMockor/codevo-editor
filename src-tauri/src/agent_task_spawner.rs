use serde::{Deserialize, Serialize};

use crate::effective_executable_environment::EffectiveExecutablePath;

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
pub const MAX_AGENT_TURN_IMAGE_BYTES: u64 = 40 * 1024 * 1024;
pub const AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR: &str =
    "Agent image attachments do not match the provider transport.";
pub const AGENT_TURN_IMAGE_BUDGET_ERROR: &str =
    "Images in this message exceed the supported size for one turn.";
pub const AGENT_STDIN_FRAME_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentPromptTransport {
    Argv(String),
    Stdin(Arc<[u8]>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentImageAttachment {
    Path(PathBuf),
    Inline { media_type: String, data: Vec<u8> },
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
    prompt: AgentPromptTransport,
    attachment_paths: Vec<PathBuf>,
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

    pub fn prompt(&self) -> &AgentPromptTransport {
        &self.prompt
    }

    pub fn attachment_paths(&self) -> &[PathBuf] {
        &self.attachment_paths
    }

    fn stdin_frame(&self) -> Option<&Arc<[u8]>> {
        match &self.prompt {
            AgentPromptTransport::Stdin(frame) => Some(frame),
            AgentPromptTransport::Argv(_) => None,
        }
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
            prompt: AgentPromptTransport::Argv(String::new()),
            attachment_paths: Vec::new(),
        }
    }

    #[cfg(test)]
    pub fn with_stdin_frame_for_tests(mut self, frame: Vec<u8>) -> Self {
        self.prompt = AgentPromptTransport::Stdin(frame.into());
        self
    }
}

#[cfg(test)]
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
    launch.validate_capabilities().map_err(str::to_string)?;
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
    plan_agent_invocation_with_authority_and_environment(
        executable_identity,
        AgentInvocationRequest {
            invocation,
            prompt,
            cwd,
            resume_session_id,
            launch,
            attachments: Vec::new(),
        },
        inherited_environment(),
    )
}

#[cfg(test)]
pub fn plan_agent_invocation_with_attachments(
    cli_path: &str,
    invocation: AgentCliInvocation,
    prompt: &str,
    cwd: &Path,
    resume_session_id: Option<&str>,
    launch: AgentLaunchOptions,
    attachments: Vec<AgentImageAttachment>,
) -> Result<AgentTaskSpawnPlan, String> {
    let executable_identity = agent_provider::process::executable_identity(cli_path)
        .map_err(|_| agent_cli_binary_unavailable_error(invocation))?;
    plan_agent_invocation_with_authority_and_environment(
        executable_identity,
        AgentInvocationRequest {
            invocation,
            prompt,
            cwd,
            resume_session_id,
            launch,
            attachments,
        },
        inherited_environment(),
    )
}

pub(crate) fn plan_agent_invocation_with_authority(
    executable_identity: agent_provider::process::ExecutableIdentity,
    request: AgentInvocationRequest<'_>,
    effective_path: EffectiveExecutablePath<'_>,
) -> Result<AgentTaskSpawnPlan, String> {
    plan_agent_invocation_with_authority_and_environment(
        executable_identity,
        request,
        replace_effective_path(inherited_environment(), effective_path),
    )
}

pub struct AgentInvocationRequest<'a> {
    pub invocation: AgentCliInvocation,
    pub prompt: &'a str,
    pub cwd: &'a Path,
    pub resume_session_id: Option<&'a str>,
    pub launch: AgentLaunchOptions,
    pub attachments: Vec<AgentImageAttachment>,
}

fn plan_agent_invocation_with_authority_and_environment(
    executable_identity: agent_provider::process::ExecutableIdentity,
    request: AgentInvocationRequest<'_>,
    environment: Vec<(String, String)>,
) -> Result<AgentTaskSpawnPlan, String> {
    let AgentInvocationRequest {
        invocation,
        prompt,
        cwd,
        resume_session_id,
        launch,
        attachments,
    } = request;
    if !launch.matches(invocation) {
        return Err(AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR.to_string());
    }
    if let Some(candidate) = resume_session_id {
        validate_resume_session_id(candidate)?;
    }
    if !executable_identity.canonical_path.is_absolute() {
        return Err("Agent CLI path must be absolute.".to_string());
    }
    if !executable_identity.retained_is_current() {
        return Err(agent_cli_binary_unavailable_error(invocation));
    }
    if prompt.is_empty() {
        return Err("Agent prompt must not be empty.".to_string());
    }
    if prompt.len() > MAX_AGENT_PROMPT_BYTES {
        return Err("Agent prompt exceeds the supported length.".to_string());
    }
    if !cwd.is_absolute() {
        return Err("Agent working directory must be absolute.".to_string());
    }
    let dispatched = launch.prompt(prompt).into_owned();
    let attachment_paths = attachment_image_paths(invocation, &attachments)?;
    let prompt_transport = agent_prompt_transport(invocation, &dispatched, attachments)?;
    let args = agent_invocation_args(
        invocation,
        prompt,
        resume_session_id,
        launch,
        &attachment_paths,
    );
    Ok(AgentTaskSpawnPlan {
        program: executable_identity.canonical_path.clone(),
        executable_identity,
        args,
        cwd: cwd.to_path_buf(),
        #[cfg(unix)]
        cwd_authority: None,
        env: environment,
        prompt: prompt_transport,
        attachment_paths,
    })
}

fn attachment_image_paths(
    invocation: AgentCliInvocation,
    attachments: &[AgentImageAttachment],
) -> Result<Vec<PathBuf>, String> {
    match invocation {
        AgentCliInvocation::ClaudeCode => match attachments
            .iter()
            .all(|attachment| matches!(attachment, AgentImageAttachment::Inline { .. }))
        {
            true => Ok(Vec::new()),
            false => Err(AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR.to_string()),
        },
        AgentCliInvocation::CodexExec => attachments
            .iter()
            .map(|attachment| match attachment {
                AgentImageAttachment::Path(path) => Ok(path.clone()),
                AgentImageAttachment::Inline { .. } => {
                    Err(AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR.to_string())
                }
            })
            .collect(),
    }
}

fn agent_prompt_transport(
    invocation: AgentCliInvocation,
    dispatched_prompt: &str,
    attachments: Vec<AgentImageAttachment>,
) -> Result<AgentPromptTransport, String> {
    if invocation == AgentCliInvocation::CodexExec {
        return Ok(AgentPromptTransport::Argv(dispatched_prompt.to_string()));
    }
    let mut images = Vec::with_capacity(attachments.len());
    let mut total: u64 = 0;
    for attachment in attachments {
        let AgentImageAttachment::Inline { media_type, data } = attachment else {
            return Err(AGENT_IMAGE_TRANSPORT_MISMATCH_ERROR.to_string());
        };
        total = total.saturating_add(data.len() as u64);
        if total > MAX_AGENT_TURN_IMAGE_BYTES {
            return Err(AGENT_TURN_IMAGE_BUDGET_ERROR.to_string());
        }
        images.push((media_type, data));
    }
    Ok(AgentPromptTransport::Stdin(
        claude_user_frame(dispatched_prompt, &images).into(),
    ))
}

#[derive(Serialize)]
struct ClaudeUserFrame<'a> {
    #[serde(rename = "type")]
    frame_type: &'a str,
    message: ClaudeUserMessage<'a>,
}

#[derive(Serialize)]
struct ClaudeUserMessage<'a> {
    role: &'a str,
    content: Vec<ClaudeContentBlock<'a>>,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ClaudeContentBlock<'a> {
    #[serde(rename = "image")]
    Image { source: ClaudeImageSource<'a> },
    #[serde(rename = "text")]
    Text { text: &'a str },
}

#[derive(Serialize)]
struct ClaudeImageSource<'a> {
    #[serde(rename = "type")]
    source_type: &'a str,
    media_type: &'a str,
    data: String,
}

pub fn claude_user_frame(prompt: &str, images: &[(String, Vec<u8>)]) -> Vec<u8> {
    use base64::Engine;

    let mut content: Vec<ClaudeContentBlock<'_>> = images
        .iter()
        .map(|(media_type, data)| ClaudeContentBlock::Image {
            source: ClaudeImageSource {
                source_type: "base64",
                media_type,
                data: base64::engine::general_purpose::STANDARD.encode(data),
            },
        })
        .collect();
    content.push(ClaudeContentBlock::Text { text: prompt });
    let frame = ClaudeUserFrame {
        frame_type: "user",
        message: ClaudeUserMessage {
            role: "user",
            content,
        },
    };
    let mut encoded = serde_json::to_vec(&frame).unwrap_or_default();
    encoded.push(b'\n');
    encoded
}

fn agent_invocation_args(
    invocation: AgentCliInvocation,
    prompt: &str,
    resume_session_id: Option<&str>,
    launch: AgentLaunchOptions,
    attachment_paths: &[PathBuf],
) -> Vec<String> {
    let resumed = resume_session_id.is_some();
    let mut template: Vec<&str> = match invocation {
        AgentCliInvocation::ClaudeCode => vec![
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
        ],
        AgentCliInvocation::CodexExec if resumed => {
            vec!["exec", "resume", "--json", "--skip-git-repo-check"]
        }
        AgentCliInvocation::CodexExec => vec!["exec", "--json", "--skip-git-repo-check"],
    };
    template.extend_from_slice(launch.model_args());
    template.extend_from_slice(launch.mode_args(resumed));
    template.extend_from_slice(launch.effort_args());
    template.extend_from_slice(launch.settings_args());
    let mut args: Vec<String> = template.into_iter().map(str::to_string).collect();
    args.extend(attachment_args(attachment_paths));
    if let Some(session_id) = resume_session_id {
        match invocation {
            AgentCliInvocation::ClaudeCode => {
                args.push("--resume".to_string());
                args.push(session_id.to_string());
            }
            AgentCliInvocation::CodexExec => args.push(session_id.to_string()),
        }
    }
    if invocation == AgentCliInvocation::ClaudeCode {
        return args;
    }
    args.push("--".to_string());
    args.push(launch.prompt(prompt).into_owned());
    args
}

fn attachment_args(attachment_paths: &[PathBuf]) -> Vec<String> {
    attachment_paths
        .iter()
        .flat_map(|path| ["-i".to_string(), path.to_string_lossy().into_owned()])
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

fn replace_effective_path(
    environment: Vec<(String, String)>,
    effective_path: EffectiveExecutablePath<'_>,
) -> Vec<(String, String)> {
    let mut replaced = false;
    let mut result = Vec::with_capacity(environment.len() + 1);
    for (key, value) in environment {
        if key != "PATH" {
            result.push((key, value));
            continue;
        }
        if replaced {
            continue;
        }
        result.push((key, effective_path.as_str().to_string()));
        replaced = true;
    }
    if !replaced {
        result.push(("PATH".to_string(), effective_path.as_str().to_string()));
    }
    result
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
    fn observe_exit(&mut self) -> Result<bool, String>;
    fn reap(&mut self) -> Result<i32, String>;
    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        if !self.observe_exit()? {
            return Ok(None);
        }
        self.reap().map(Some)
    }
    fn process_group_id(&self) -> i32;
    fn force_kill(&mut self) -> Result<(), String>;
}

pub trait AgentProcessSpawner: Send + Sync {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String>;
}

pub struct StdAgentProcessSpawner;

impl AgentProcessSpawner for StdAgentProcessSpawner {
    fn spawn(&self, plan: &AgentTaskSpawnPlan) -> Result<Box<dyn AgentChild>, String> {
        let mut bound = plan
            .executable_identity
            .bound_command()
            .map_err(|_| "Agent CLI executable identity changed before launch.".to_string())?;
        let command = bound.command_mut();
        let stdin = match plan.stdin_frame() {
            Some(_) => Stdio::piped(),
            None => Stdio::null(),
        };
        command
            .args(plan.args())
            .env_clear()
            .envs(plan.env().iter().cloned())
            .stdin(stdin)
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
        if let Some(frame) = plan.stdin_frame() {
            write_prompt_frame_on_a_dedicated_thread(child.stdin.take(), Arc::clone(frame));
        }
        Ok(Box::new(StdAgentChild {
            child,
            process_group_id,
            observed_exit_code: None,
        }))
    }
}

fn write_prompt_frame_on_a_dedicated_thread(
    stdin: Option<std::process::ChildStdin>,
    frame: Arc<[u8]>,
) {
    let Some(mut stdin) = stdin else {
        return;
    };
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + AGENT_STDIN_FRAME_DEADLINE;
        let _ = write_prompt_frame_before(&mut stdin, &frame, deadline);
        drop(stdin);
    });
}

#[cfg(unix)]
fn write_prompt_frame_before(
    stdin: &mut std::process::ChildStdin,
    frame: &[u8],
    deadline: std::time::Instant,
) -> io::Result<()> {
    use std::io::Write;
    use std::os::fd::AsRawFd;

    let descriptor = stdin.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return stdin.write_all(frame);
    }
    let mut written = 0;
    while written < frame.len() {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "agent stdin frame"));
        }
        match stdin.write(&frame[written..]) {
            Ok(0) => return Err(io::Error::from(io::ErrorKind::WriteZero)),
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_until_writable(descriptor, remaining)
            }
            Err(error) => return Err(error),
        }
    }
    stdin.flush()
}

#[cfg(unix)]
fn wait_until_writable(descriptor: std::os::fd::RawFd, remaining: std::time::Duration) {
    let mut poll_descriptor = libc::pollfd {
        fd: descriptor,
        events: libc::POLLOUT,
        revents: 0,
    };
    let milliseconds = i32::try_from(remaining.as_millis())
        .unwrap_or(i32::MAX)
        .max(1);
    unsafe {
        libc::poll(&mut poll_descriptor, 1, milliseconds);
    }
}

#[cfg(not(unix))]
fn write_prompt_frame_before(
    stdin: &mut std::process::ChildStdin,
    frame: &[u8],
    _deadline: std::time::Instant,
) -> io::Result<()> {
    use std::io::Write;

    stdin.write_all(frame)
}

struct StdAgentChild {
    child: Child,
    process_group_id: i32,
    observed_exit_code: Option<i32>,
}

impl AgentChild for StdAgentChild {
    fn stdout_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let stdout = self
            .child
            .stdout
            .take()
            .ok_or_else(|| "Agent stdout pipe is unavailable.".to_string())?;
        configure_agent_output_reader(&stdout)?;
        Ok(Box::new(stdout))
    }

    fn stderr_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let stderr = self
            .child
            .stderr
            .take()
            .ok_or_else(|| "Agent stderr pipe is unavailable.".to_string())?;
        configure_agent_output_reader(&stderr)?;
        Ok(Box::new(stderr))
    }

    #[cfg(unix)]
    fn observe_exit(&mut self) -> Result<bool, String> {
        observe_exit_without_reaping(&self.child)
            .map_err(|error| format!("Unable to observe agent exit: {error}"))
    }

    #[cfg(not(unix))]
    fn observe_exit(&mut self) -> Result<bool, String> {
        if self.observed_exit_code.is_some() {
            return Ok(true);
        }
        let status = self
            .child
            .try_wait()
            .map_err(|error| format!("Unable to observe agent exit: {error}"))?;
        self.observed_exit_code = status.map(exit_code_of);
        Ok(self.observed_exit_code.is_some())
    }

    fn reap(&mut self) -> Result<i32, String> {
        if let Some(exit_code) = self.observed_exit_code.take() {
            return Ok(exit_code);
        }
        let status = reap_child(&mut self.child)
            .map_err(|error| format!("Unable to reap agent: {error}"))?;
        Ok(exit_code_of(status))
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
fn configure_agent_output_reader(reader: &impl std::os::fd::AsRawFd) -> Result<(), String> {
    let descriptor = reader.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return Err(format!(
            "Unable to configure agent output pipe: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn configure_agent_output_reader<T>(_reader: &T) -> Result<(), String> {
    Ok(())
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
#[path = "agent_task_spawner_tests.rs"]
mod tests;
