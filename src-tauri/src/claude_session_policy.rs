use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use crate::agent_task_spawner::claude_session_router::WAKE_UP_REPLY_CAP;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub const MAX_LIVE_CLAUDE_SESSIONS: usize = 8;
pub const CLAUDE_SESSION_RESTART_CONFIRMATION_ERROR: &str = "sessionRestartRequiresConfirmation: Restarting ends this Claude session. Background tasks it started may stop.";
pub const CLAUDE_SESSION_BUSY_ERROR: &str =
    "This thread's Claude session is busy. Retry in a moment.";
pub const CLAUDE_SESSION_STOP_TIMEOUT_ERROR: &str =
    "The previous Claude session for this thread could not be stopped in time.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClaudeSessionTuning {
    pub max_live_sessions: usize,
    pub idle_ttl: Duration,
    pub detached_work_ttl: Duration,
    pub interrupt_deadline: Duration,
    pub graceful_stop: Duration,
    pub force_stop: Duration,
    pub clean_exit_grace: Duration,
    pub reader_drain: Duration,
    pub wake_up_reply_cap: Duration,
}

impl Default for ClaudeSessionTuning {
    fn default() -> Self {
        Self {
            max_live_sessions: MAX_LIVE_CLAUDE_SESSIONS,
            idle_ttl: Duration::from_secs(30 * 60),
            detached_work_ttl: Duration::from_secs(12 * 60 * 60),
            interrupt_deadline: Duration::from_secs(10),
            graceful_stop: Duration::from_millis(500),
            force_stop: Duration::from_millis(500),
            clean_exit_grace: Duration::from_secs(2),
            reader_drain: Duration::from_secs(2),
            wake_up_reply_cap: WAKE_UP_REPLY_CAP,
        }
    }
}

impl ClaudeSessionTuning {
    pub fn end_timeout(&self) -> Duration {
        self.graceful_stop + self.force_stop + self.reader_drain + Duration::from_secs(1)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ClaudeSessionKey {
    pub workspace_id: String,
    pub thread_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutableFingerprint {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_epoch_ms: u64,
    pub device: u64,
    pub inode: u64,
}

#[derive(Clone, Debug)]
pub struct ClaudeSessionFingerprint {
    pub executable: ExecutableFingerprint,
    pub provider_generation: u64,
    pub launch: AgentLaunchOptions,
    pub args_without_resume: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
    pub cwd_identity: Option<(u64, u64)>,
}

impl ClaudeSessionFingerprint {
    pub fn launched(&self) -> AgentLaunchOptions {
        self.launch.launched_with(&self.args_without_resume)
    }
}

impl PartialEq for ClaudeSessionFingerprint {
    fn eq(&self, other: &Self) -> bool {
        let Self {
            executable,
            provider_generation,
            launch: _,
            args_without_resume,
            env,
            cwd,
            cwd_identity,
        } = self;
        self.launched() == other.launched()
            && *executable == other.executable
            && *provider_generation == other.provider_generation
            && *args_without_resume == other.args_without_resume
            && *env == other.env
            && *cwd == other.cwd
            && *cwd_identity == other.cwd_identity
    }
}

impl Eq for ClaudeSessionFingerprint {}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionRestartPolicy {
    #[default]
    RefuseIfBackground,
    StopBackground,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionEndReason {
    Stopped,
    Exited,
    Crashed,
    ProtocolError,
    IdleTimeout,
    Evicted,
    Restarted,
    Released,
    TrustRevoked,
    ThreadEnded,
    ProviderUpdated,
    Shutdown,
    UnownedActivity,
    InterruptTimedOut,
    InputFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionEndedEvent {
    pub workspace_id: String,
    pub thread_id: String,
    pub reason: ClaudeSessionEndReason,
    pub background_tasks_live: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionBackgroundTurnEvent {
    pub workspace_id: String,
    pub thread_id: String,
    pub output: String,
    pub truncated: bool,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionBackgroundTaskType {
    Agent,
    Shell,
    Monitor,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionBackgroundTask {
    pub task_id: String,
    pub task_type: ClaudeSessionBackgroundTaskType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeSessionBackgroundReply {
    None,
    Expected,
    InProgress,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionBackgroundTasksEvent {
    pub workspace_id: String,
    pub thread_id: String,
    pub total: usize,
    pub agents: usize,
    pub tasks: Vec<ClaudeSessionBackgroundTask>,
    pub reply: ClaudeSessionBackgroundReply,
}

impl ClaudeSessionBackgroundTurnEvent {
    pub fn from_output(
        key: &ClaudeSessionKey,
        output: Vec<u8>,
        truncated: bool,
        complete: bool,
    ) -> Self {
        let (output, lossy) = complete_utf8_lines(output);
        Self {
            workspace_id: key.workspace_id.clone(),
            thread_id: key.thread_id.clone(),
            output,
            truncated: truncated || lossy,
            complete,
        }
    }
}

fn complete_utf8_lines(output: Vec<u8>) -> (String, bool) {
    let error = match String::from_utf8(output) {
        Ok(text) => return (text, false),
        Err(error) => error,
    };
    let valid = error.utf8_error().valid_up_to();
    let mut bytes = error.into_bytes();
    bytes.truncate(valid);
    let complete = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |newline| newline + 1);
    bytes.truncate(complete);
    (String::from_utf8(bytes).unwrap_or_default(), true)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaudeSessionRestartReason {
    ProviderChanged,
    LaunchChanged,
    ConversationChanged,
    Unhealthy,
}

impl ClaudeSessionRestartReason {
    pub fn needs_confirmation(self) -> bool {
        matches!(self, Self::LaunchChanged | Self::ConversationChanged)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaudeSessionDisposition {
    Spawn,
    Reuse,
    Busy,
    Restart(ClaudeSessionRestartReason),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionAvailability {
    Idle,
    Attached,
    Ending,
}

pub struct LiveSessionFacts<'a> {
    pub fingerprint: &'a ClaudeSessionFingerprint,
    pub conversation: Option<&'a str>,
    pub availability: SessionAvailability,
}

pub struct RequestedSessionFacts<'a> {
    pub fingerprint: &'a ClaudeSessionFingerprint,
    pub resume_session_id: Option<&'a str>,
}

pub fn decide_session_disposition(
    live: Option<LiveSessionFacts<'_>>,
    requested: RequestedSessionFacts<'_>,
) -> ClaudeSessionDisposition {
    let Some(live) = live else {
        return ClaudeSessionDisposition::Spawn;
    };
    match live.availability {
        SessionAvailability::Attached => return ClaudeSessionDisposition::Busy,
        SessionAvailability::Ending => {
            return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::Unhealthy)
        }
        SessionAvailability::Idle => {}
    }
    if live.fingerprint.executable != requested.fingerprint.executable
        || live.fingerprint.provider_generation != requested.fingerprint.provider_generation
    {
        return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ProviderChanged);
    }
    if live.fingerprint != requested.fingerprint {
        return ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::LaunchChanged);
    }
    match (live.conversation, requested.resume_session_id) {
        (Some(current), Some(wanted)) if current == wanted => ClaudeSessionDisposition::Reuse,
        _ => ClaudeSessionDisposition::Restart(ClaudeSessionRestartReason::ConversationChanged),
    }
}

#[derive(Clone, Debug)]
pub struct EvictionCandidate {
    pub key: ClaudeSessionKey,
    pub generation: u64,
    pub attached: bool,
    pub background: bool,
    pub last_activity: Instant,
}

pub fn choose_eviction(candidates: &[EvictionCandidate]) -> Option<&ClaudeSessionKey> {
    candidates
        .iter()
        .filter(|candidate| !candidate.attached)
        .min_by_key(|candidate| {
            (
                candidate.background,
                candidate.last_activity,
                candidate.generation,
            )
        })
        .map(|candidate| &candidate.key)
}

pub fn idle_retirement_due(
    tuning: &ClaudeSessionTuning,
    availability: SessionAvailability,
    background_tasks: bool,
    idle_since: Instant,
    now: Instant,
) -> bool {
    if availability != SessionAvailability::Idle {
        return false;
    }
    let ttl = match background_tasks {
        true => tuning.detached_work_ttl,
        false => tuning.idle_ttl,
    };
    now.saturating_duration_since(idle_since) >= ttl
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClaudeSessionInspection {
    None,
    Reuse {
        #[serde(rename = "backgroundTasks")]
        background_tasks: bool,
    },
    Restart {
        #[serde(rename = "backgroundTasks")]
        background_tasks: bool,
    },
}

pub fn inspect_session(
    live: Option<(LiveSessionFacts<'_>, bool)>,
    launch: &AgentLaunchOptions,
    resume_session_id: Option<&str>,
    provider_generation: u64,
) -> ClaudeSessionInspection {
    let Some((facts, background_tasks)) = live else {
        return ClaudeSessionInspection::None;
    };
    let reusable = facts.availability == SessionAvailability::Idle
        && facts.fingerprint.launched() == launch.session_identity()
        && facts.fingerprint.provider_generation == provider_generation
        && resume_session_id.is_some()
        && facts.conversation == resume_session_id;
    if reusable {
        return ClaudeSessionInspection::Reuse { background_tasks };
    }
    ClaudeSessionInspection::Restart { background_tasks }
}

pub fn args_without_resume(args: &[String]) -> Vec<String> {
    let mut kept = Vec::with_capacity(args.len());
    let mut skip_value = false;
    for arg in args {
        if skip_value {
            skip_value = false;
            continue;
        }
        if arg == "--resume" {
            skip_value = true;
            continue;
        }
        kept.push(arg.clone());
    }
    kept
}

#[cfg(test)]
#[path = "claude_session_policy_tests.rs"]
mod tests;
