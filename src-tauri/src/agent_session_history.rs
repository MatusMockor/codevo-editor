use crate::agent_task_spawner::AgentCliInvocation;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_PROVIDER_FILES: usize = 256;
pub const CODEX_SCAN_DAYS: u32 = 30;
pub const MAX_EXTERNAL_SESSION_ENTRIES: usize = 200;
pub const MAX_PREVIEW_EXCHANGES: usize = 40;
pub const PREVIEW_HEAD_EXCHANGES: usize = 8;
pub const HEAD_READ_BYTES: usize = 256 * 1024;
pub const TAIL_READ_BYTES: usize = 64 * 1024;
pub const PREVIEW_TOTAL_BYTES: usize = 64 * 1024;
pub const MAX_EXTERNAL_SESSION_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_EXTERNAL_SESSION_TITLE_BYTES: usize = 256;
pub const MAX_EXTERNAL_SESSION_ROOT_BYTES: usize = 4096;
pub const MAX_SCANNED_DIRECTORY_ENTRIES: usize = 4096;
pub const MAX_SCANNED_WINDOW_LINES: usize = 16 * 1024;

pub const EXTERNAL_SESSION_ID_ERROR: &str =
    "External agent session ids must be canonical hexadecimal UUIDs.";
pub const EXTERNAL_SESSION_ROOT_ERROR: &str =
    "External agent session lookups require an absolute canonical repository root.";
pub const EXTERNAL_SESSION_UNREADABLE_ERROR: &str = "The external agent session could not be read.";

const CLAUDE_SESSION_FILE_SUFFIX: &str = ".jsonl";
const CODEX_ROLLOUT_FILE_PREFIX: &str = "rollout-";
const EPOCH_MS_PER_DAY: u64 = 86_400_000;

pub type ExternalSessionProvider = AgentCliInvocation;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListExternalAgentSessionsRequest {
    pub repository_root: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewExternalAgentSessionRequest {
    pub provider: ExternalSessionProvider,
    pub session_id: String,
    pub repository_root: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSessionSummary {
    pub provider: ExternalSessionProvider,
    pub session_id: String,
    pub cwd: String,
    pub title: String,
    pub first_prompt: String,
    pub started_at_epoch_ms: u64,
    pub last_activity_epoch_ms: u64,
    pub turn_count: u32,
    pub turn_count_exact: bool,
    pub file_bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSessionListing {
    pub sessions: Vec<ExternalAgentSessionSummary>,
    pub skipped: u32,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalSessionExchangeRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSessionExchange {
    pub role: ExternalSessionExchangeRole,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentSessionPreview {
    pub provider: ExternalSessionProvider,
    pub session_id: String,
    pub exchanges: Vec<ExternalSessionExchange>,
    pub exchanges_truncated: bool,
    pub total_preview_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct ExternalSessionHistoryRoots {
    pub claude_projects_directory: PathBuf,
    pub codex_sessions_directory: PathBuf,
}

impl ExternalSessionHistoryRoots {
    fn from_environment() -> Option<Self> {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        if home.as_os_str().is_empty() || !home.is_absolute() {
            return None;
        }
        Some(Self {
            claude_projects_directory: home.join(".claude").join("projects"),
            codex_sessions_directory: home.join(".codex").join("sessions"),
        })
    }
}

pub fn validate_external_session_id(candidate: &str) -> Result<&str, String> {
    let groups = [8usize, 4, 4, 4, 12];
    let mut segments = candidate.split('-');
    for expected in groups {
        let Some(segment) = segments.next() else {
            return Err(EXTERNAL_SESSION_ID_ERROR.to_string());
        };
        if segment.len() != expected || !segment.chars().all(|value| value.is_ascii_hexdigit()) {
            return Err(EXTERNAL_SESSION_ID_ERROR.to_string());
        }
    }
    if segments.next().is_some() {
        return Err(EXTERNAL_SESSION_ID_ERROR.to_string());
    }

    Ok(candidate)
}

pub fn encode_claude_project_directory(repository_root: &str) -> String {
    repository_root
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                return value;
            }
            '-'
        })
        .collect()
}

pub fn list_external_agent_sessions(
    request: &ListExternalAgentSessionsRequest,
) -> Result<ExternalAgentSessionListing, String> {
    let Some(roots) = ExternalSessionHistoryRoots::from_environment() else {
        validate_repository_root(&request.repository_root)?;
        return Ok(ExternalAgentSessionListing {
            sessions: Vec::new(),
            skipped: 0,
            truncated: false,
        });
    };
    list_external_agent_sessions_at(request, &roots, current_epoch_ms())
}

pub fn preview_external_agent_session(
    request: &PreviewExternalAgentSessionRequest,
) -> Result<ExternalAgentSessionPreview, String> {
    let Some(roots) = ExternalSessionHistoryRoots::from_environment() else {
        validate_external_session_id(&request.session_id)?;
        validate_repository_root(&request.repository_root)?;
        return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
    };
    preview_external_agent_session_at(request, &roots, current_epoch_ms())
}

pub fn list_external_agent_sessions_at(
    request: &ListExternalAgentSessionsRequest,
    roots: &ExternalSessionHistoryRoots,
    now_epoch_ms: u64,
) -> Result<ExternalAgentSessionListing, String> {
    let repository_root = validate_repository_root(&request.repository_root)?;
    let mut sessions: Vec<ExternalAgentSessionSummary> = Vec::new();
    let mut skipped: u32 = 0;
    let claude_scan_limited = collect_claude_sessions(
        &repository_root,
        &roots.claude_projects_directory,
        &mut sessions,
        &mut skipped,
    );
    let codex_scan_limited = collect_codex_sessions(
        &repository_root,
        &roots.codex_sessions_directory,
        now_epoch_ms,
        &mut sessions,
        &mut skipped,
    );
    sessions.sort_by(|left, right| {
        right
            .last_activity_epoch_ms
            .cmp(&left.last_activity_epoch_ms)
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    let truncated =
        claude_scan_limited || codex_scan_limited || sessions.len() > MAX_EXTERNAL_SESSION_ENTRIES;
    sessions.truncate(MAX_EXTERNAL_SESSION_ENTRIES);
    Ok(ExternalAgentSessionListing {
        sessions,
        skipped,
        truncated,
    })
}

pub fn preview_external_agent_session_at(
    request: &PreviewExternalAgentSessionRequest,
    roots: &ExternalSessionHistoryRoots,
    now_epoch_ms: u64,
) -> Result<ExternalAgentSessionPreview, String> {
    validate_external_session_id(&request.session_id)?;
    let repository_root = validate_repository_root(&request.repository_root)?;
    let path = match request.provider {
        AgentCliInvocation::ClaudeCode => roots
            .claude_projects_directory
            .join(encode_claude_project_directory(&repository_root))
            .join(format!(
                "{}{CLAUDE_SESSION_FILE_SUFFIX}",
                request.session_id
            )),
        AgentCliInvocation::CodexExec => find_codex_session_file(
            &roots.codex_sessions_directory,
            &request.session_id,
            now_epoch_ms,
        )
        .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?,
    };
    let window = read_history_windows(&path, true)
        .map_err(|_| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
    let head = window_lines(&window.head, false, !window.head_complete);
    let tail = window
        .tail
        .as_ref()
        .map(|tail| window_lines(&tail.bytes, tail.starts_after_head, false));
    let window_truncated =
        !window.covers_file || head.truncated || tail.as_ref().is_some_and(|tail| tail.truncated);
    let tail_lines: &[&str] = tail
        .as_ref()
        .map(|tail| tail.lines.as_slice())
        .unwrap_or(&[]);

    let mut collector = PreviewCollector::new();
    match request.provider {
        AgentCliInvocation::ClaudeCode => {
            let facts = scan_claude_head(&head.lines);
            if facts.cwd.as_deref() != Some(repository_root.as_str()) {
                return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
            }
            if facts.typed_count == 0 {
                return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
            }
            collect_claude_exchanges(&head.lines, &mut collector);
            collect_claude_exchanges(tail_lines, &mut collector);
        }
        AgentCliInvocation::CodexExec => {
            let gate = head
                .lines
                .first()
                .and_then(|line| serde_json::from_str::<RawCodexLine>(line).ok())
                .map(|meta| codex_meta_gate(&meta, &repository_root, &request.session_id));
            match gate {
                Some(Ok(_)) => {}
                _ => return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string()),
            }
            collect_codex_exchanges(&head.lines[1..], &mut collector);
            collect_codex_exchanges(tail_lines, &mut collector);
        }
    }

    let (selected, truncated_by_count) = collector.finish();
    let (exchanges, total_preview_bytes, truncated_by_bytes) = enforce_preview_budget(selected);
    Ok(ExternalAgentSessionPreview {
        provider: request.provider,
        session_id: request.session_id.clone(),
        exchanges,
        exchanges_truncated: truncated_by_count || truncated_by_bytes || window_truncated,
        total_preview_bytes,
    })
}

fn validate_repository_root(candidate: &str) -> Result<String, String> {
    if candidate.is_empty() || candidate.len() > MAX_EXTERNAL_SESSION_ROOT_BYTES {
        return Err(EXTERNAL_SESSION_ROOT_ERROR.to_string());
    }
    let path = Path::new(candidate);
    if !path.is_absolute() {
        return Err(EXTERNAL_SESSION_ROOT_ERROR.to_string());
    }
    let canonical = fs::canonicalize(path).map_err(|_| EXTERNAL_SESSION_ROOT_ERROR.to_string())?;
    if canonical.as_os_str() != path.as_os_str() {
        return Err(EXTERNAL_SESSION_ROOT_ERROR.to_string());
    }
    let metadata = fs::metadata(&canonical).map_err(|_| EXTERNAL_SESSION_ROOT_ERROR.to_string())?;
    if !metadata.is_dir() {
        return Err(EXTERNAL_SESSION_ROOT_ERROR.to_string());
    }
    Ok(candidate.to_string())
}

enum SessionExclusion {
    Foreign,
    Skipped,
}

fn bump(counter: &mut u32) {
    *counter = counter.saturating_add(1);
}

struct ClaudeSessionCandidate {
    path: PathBuf,
    session_id: String,
    modified_epoch_ms: u64,
}

fn collect_claude_candidates(
    projects_directory: &Path,
    repository_root: &str,
    skipped: &mut u32,
) -> (Vec<ClaudeSessionCandidate>, bool) {
    let mut candidates: Vec<ClaudeSessionCandidate> = Vec::new();
    let encoded_root = encode_claude_project_directory(repository_root);
    let nested_prefix = format!("{encoded_root}-");
    let Ok(project_entries) = fs::read_dir(projects_directory) else {
        return (candidates, false);
    };
    let mut inspected_entries = 0usize;
    let mut scan_limited = false;
    for (project_index, project_entry) in project_entries
        .take(MAX_SCANNED_DIRECTORY_ENTRIES + 1)
        .enumerate()
    {
        if project_index >= MAX_SCANNED_DIRECTORY_ENTRIES {
            scan_limited = true;
            break;
        }
        let Ok(project_entry) = project_entry else {
            bump(skipped);
            continue;
        };
        let name = project_entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name != encoded_root && !name.starts_with(&nested_prefix) {
            continue;
        }
        let Ok(file_type) = project_entry.file_type() else {
            bump(skipped);
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Ok(entries) = fs::read_dir(project_entry.path()) else {
            bump(skipped);
            continue;
        };
        for entry in entries {
            if inspected_entries >= MAX_SCANNED_DIRECTORY_ENTRIES {
                scan_limited = true;
                break;
            }
            inspected_entries += 1;
            collect_claude_candidate(entry, &mut candidates, skipped);
        }
        if scan_limited {
            break;
        }
    }
    (candidates, scan_limited)
}

fn collect_claude_candidate(
    entry: Result<fs::DirEntry, std::io::Error>,
    candidates: &mut Vec<ClaudeSessionCandidate>,
    skipped: &mut u32,
) {
    let Ok(entry) = entry else {
        bump(skipped);
        return;
    };
    let name = entry.file_name();
    let Some(name) = name.to_str() else {
        return;
    };
    let Some(stem) = name.strip_suffix(CLAUDE_SESSION_FILE_SUFFIX) else {
        return;
    };
    if validate_external_session_id(stem).is_err() {
        bump(skipped);
        return;
    }
    candidates.push(ClaudeSessionCandidate {
        path: entry.path(),
        session_id: stem.to_string(),
        modified_epoch_ms: entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(epoch_ms_from_system_time)
            .unwrap_or(0),
    });
}

fn collect_claude_sessions(
    repository_root: &str,
    projects_directory: &Path,
    sessions: &mut Vec<ExternalAgentSessionSummary>,
    skipped: &mut u32,
) -> bool {
    let (mut candidates, scan_limited) =
        collect_claude_candidates(projects_directory, repository_root, skipped);
    candidates.sort_by(|left, right| {
        right
            .modified_epoch_ms
            .cmp(&left.modified_epoch_ms)
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    let dropped = candidates.len().saturating_sub(MAX_PROVIDER_FILES);
    *skipped = skipped.saturating_add(u32::try_from(dropped).unwrap_or(u32::MAX));
    candidates.truncate(MAX_PROVIDER_FILES);
    let mut listed_ids = HashSet::new();
    for candidate in candidates {
        match summarize_claude_session(repository_root, &candidate.path, &candidate.session_id) {
            Ok(summary) if listed_ids.insert(summary.session_id.clone()) => sessions.push(summary),
            Ok(_) => {}
            Err(SessionExclusion::Foreign) => {}
            Err(SessionExclusion::Skipped) => bump(skipped),
        }
    }
    scan_limited || dropped > 0
}

fn summarize_claude_session(
    repository_root: &str,
    path: &Path,
    session_id: &str,
) -> Result<ExternalAgentSessionSummary, SessionExclusion> {
    let window = read_history_windows(path, false).map_err(|_| SessionExclusion::Skipped)?;
    let scanned = window_lines(&window.head, false, !window.head_complete);
    let facts = scan_claude_head(&scanned.lines);
    let cwd = facts
        .cwd
        .as_deref()
        .and_then(|candidate| scoped_repository_root(repository_root, candidate))
        .ok_or(SessionExclusion::Foreign)?;
    if facts.typed_count == 0 {
        return Err(SessionExclusion::Skipped);
    }
    let started_at_epoch_ms = facts
        .started_at_epoch_ms
        .unwrap_or(window.modified_epoch_ms);
    let last_activity_epoch_ms = if window.modified_epoch_ms == 0 {
        started_at_epoch_ms
    } else {
        window.modified_epoch_ms
    };
    let first_prompt = facts
        .first_typed_prompt
        .as_deref()
        .map(|value| sanitize_label(value, MAX_EXTERNAL_SESSION_TITLE_BYTES))
        .unwrap_or_default();
    let title = facts
        .agent_name
        .as_deref()
        .or(facts.ai_title.as_deref())
        .map(|value| sanitize_label(value, MAX_EXTERNAL_SESSION_TITLE_BYTES))
        .unwrap_or_else(|| first_prompt.clone());
    Ok(ExternalAgentSessionSummary {
        provider: AgentCliInvocation::ClaudeCode,
        session_id: session_id.to_string(),
        cwd,
        title,
        first_prompt,
        started_at_epoch_ms,
        last_activity_epoch_ms,
        turn_count: facts.typed_count,
        turn_count_exact: window.head_complete && !scanned.truncated,
        file_bytes: window.file_bytes,
    })
}

fn collect_codex_sessions(
    repository_root: &str,
    sessions_directory: &Path,
    now_epoch_ms: u64,
    sessions: &mut Vec<ExternalAgentSessionSummary>,
    skipped: &mut u32,
) -> bool {
    let mut opened = 0usize;
    for day_directory in codex_day_directories(sessions_directory, now_epoch_ms) {
        let Ok(entries) = fs::read_dir(&day_directory) else {
            continue;
        };
        for entry in entries.take(MAX_SCANNED_DIRECTORY_ENTRIES) {
            let Ok(entry) = entry else {
                bump(skipped);
                continue;
            };
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(session_id) = codex_rollout_session_id(name) else {
                continue;
            };
            if opened >= MAX_PROVIDER_FILES {
                return true;
            }
            opened += 1;
            match summarize_codex_session(repository_root, &entry.path(), &session_id) {
                Ok(summary) => sessions.push(summary),
                Err(SessionExclusion::Foreign) => {}
                Err(SessionExclusion::Skipped) => bump(skipped),
            }
        }
    }
    false
}

fn codex_day_directories(sessions_directory: &Path, now_epoch_ms: u64) -> Vec<PathBuf> {
    let today = (now_epoch_ms / EPOCH_MS_PER_DAY) as i64;
    let mut directories = Vec::with_capacity(CODEX_SCAN_DAYS as usize);
    for offset in 0..i64::from(CODEX_SCAN_DAYS) {
        let (year, month, day) = civil_from_days(today - offset);
        directories.push(
            sessions_directory
                .join(format!("{year:04}"))
                .join(format!("{month:02}"))
                .join(format!("{day:02}")),
        );
    }
    directories
}

fn codex_rollout_session_id(file_name: &str) -> Option<String> {
    let stem = file_name
        .strip_prefix(CODEX_ROLLOUT_FILE_PREFIX)?
        .strip_suffix(CLAUDE_SESSION_FILE_SUFFIX)?;
    if stem.len() < 37 || !stem.is_char_boundary(stem.len() - 36) {
        return None;
    }
    let (prefix, candidate) = stem.split_at(stem.len() - 36);
    if !prefix.ends_with('-') {
        return None;
    }
    validate_external_session_id(candidate)
        .ok()
        .map(str::to_string)
}

fn summarize_codex_session(
    repository_root: &str,
    path: &Path,
    session_id: &str,
) -> Result<ExternalAgentSessionSummary, SessionExclusion> {
    let window = read_history_windows(path, false).map_err(|_| SessionExclusion::Skipped)?;
    let scanned = window_lines(&window.head, false, !window.head_complete);
    let lines = &scanned.lines;
    let Some(first_line) = lines.first() else {
        return Err(SessionExclusion::Skipped);
    };
    let meta =
        serde_json::from_str::<RawCodexLine>(first_line).map_err(|_| SessionExclusion::Skipped)?;
    let scoped = codex_meta_gate(&meta, repository_root, session_id)?;

    let mut first_prompt: Option<String> = None;
    let mut turn_count: u32 = 0;
    for line in &lines[1..] {
        let Ok(parsed) = serde_json::from_str::<RawCodexLine>(line) else {
            continue;
        };
        let Some((role, text)) = codex_exchange(&parsed) else {
            continue;
        };
        if role != ExternalSessionExchangeRole::User {
            continue;
        }
        if first_prompt.is_none() {
            first_prompt = Some(text);
        }
        turn_count = turn_count.saturating_add(1);
    }

    let started_at_epoch_ms = scoped
        .started_at_epoch_ms
        .unwrap_or(window.modified_epoch_ms);
    let last_activity_epoch_ms = if window.modified_epoch_ms == 0 {
        started_at_epoch_ms
    } else {
        window.modified_epoch_ms
    };
    let first_prompt = first_prompt
        .as_deref()
        .map(|value| sanitize_label(value, MAX_EXTERNAL_SESSION_TITLE_BYTES))
        .unwrap_or_default();
    Ok(ExternalAgentSessionSummary {
        provider: AgentCliInvocation::CodexExec,
        session_id: session_id.to_string(),
        cwd: scoped.cwd,
        title: first_prompt.clone(),
        first_prompt,
        started_at_epoch_ms,
        last_activity_epoch_ms,
        turn_count,
        turn_count_exact: window.head_complete && !scanned.truncated,
        file_bytes: window.file_bytes,
    })
}

fn codex_meta_gate(
    line: &RawCodexLine,
    repository_root: &str,
    session_id: &str,
) -> Result<ScopedCodexMeta, SessionExclusion> {
    if line.line_type.as_deref() != Some("session_meta") {
        return Err(SessionExclusion::Skipped);
    }
    let Some(payload) = &line.payload else {
        return Err(SessionExclusion::Skipped);
    };
    let recorded_id = payload
        .id
        .as_deref()
        .or(payload.session_id.as_deref())
        .unwrap_or_default();
    if !recorded_id.eq_ignore_ascii_case(session_id) {
        return Err(SessionExclusion::Skipped);
    }
    let cwd = payload
        .cwd
        .as_deref()
        .and_then(|candidate| scoped_repository_root(repository_root, candidate))
        .ok_or(SessionExclusion::Foreign)?;
    match payload.source.as_ref() {
        Some(Value::String(source)) if source == "exec" || source == "cli" => {}
        _ => return Err(SessionExclusion::Skipped),
    }
    let started = payload
        .timestamp
        .as_deref()
        .or(line.timestamp.as_deref())
        .and_then(parse_iso_utc_epoch_ms);
    Ok(ScopedCodexMeta {
        cwd,
        started_at_epoch_ms: started,
    })
}

struct ScopedCodexMeta {
    cwd: String,
    started_at_epoch_ms: Option<u64>,
}

fn scoped_repository_root(scope_root: &str, candidate: &str) -> Option<String> {
    if candidate.is_empty() || candidate.len() > MAX_EXTERNAL_SESSION_ROOT_BYTES {
        return None;
    }
    let candidate_path = Path::new(candidate);
    if !candidate_path.is_absolute() {
        return None;
    }
    let canonical = fs::canonicalize(candidate_path).ok()?;
    if canonical.as_os_str() != candidate_path.as_os_str() || !canonical.starts_with(scope_root) {
        return None;
    }
    if !fs::metadata(&canonical).ok()?.is_dir() {
        return None;
    }
    Some(candidate.to_string())
}

fn find_codex_session_file(
    sessions_directory: &Path,
    session_id: &str,
    now_epoch_ms: u64,
) -> Option<PathBuf> {
    let suffix = format!("-{session_id}{CLAUDE_SESSION_FILE_SUFFIX}");
    for day_directory in codex_day_directories(sessions_directory, now_epoch_ms) {
        let Ok(entries) = fs::read_dir(&day_directory) else {
            continue;
        };
        for entry in entries.take(MAX_SCANNED_DIRECTORY_ENTRIES) {
            let Ok(entry) = entry else {
                continue;
            };
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with(CODEX_ROLLOUT_FILE_PREFIX) && name.ends_with(&suffix) {
                return Some(entry.path());
            }
        }
    }
    None
}

struct HistoryTailWindow {
    bytes: Vec<u8>,
    starts_after_head: bool,
    reached_end: bool,
}

struct HistoryFileWindow {
    head: Vec<u8>,
    tail: Option<HistoryTailWindow>,
    file_bytes: u64,
    modified_epoch_ms: u64,
    head_complete: bool,
    covers_file: bool,
}

fn read_history_windows(path: &Path, include_tail: bool) -> Result<HistoryFileWindow, ()> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    #[cfg(not(unix))]
    {
        let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
        if metadata.file_type().is_symlink() {
            return Err(());
        }
    }
    let mut file = options.open(path).map_err(|_| ())?;
    let metadata = file.metadata().map_err(|_| ())?;
    if !metadata.is_file() {
        return Err(());
    }
    let file_bytes = metadata.len();
    let modified_epoch_ms = metadata
        .modified()
        .ok()
        .map(epoch_ms_from_system_time)
        .unwrap_or(0);
    let mut head = Vec::new();
    file.by_ref()
        .take(HEAD_READ_BYTES as u64)
        .read_to_end(&mut head)
        .map_err(|_| ())?;
    let head_end = head.len() as u64;
    let head_complete = head_end >= file_bytes;
    let tail = if include_tail && !head_complete {
        let start = head_end.max(file_bytes.saturating_sub(TAIL_READ_BYTES as u64));
        file.seek(SeekFrom::Start(start)).map_err(|_| ())?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(TAIL_READ_BYTES as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        let reached_end = start.saturating_add(bytes.len() as u64) >= file_bytes;
        Some(HistoryTailWindow {
            bytes,
            starts_after_head: start > head_end,
            reached_end,
        })
    } else {
        None
    };
    let covers_file = head_complete
        || tail
            .as_ref()
            .is_some_and(|tail| !tail.starts_after_head && tail.reached_end);
    Ok(HistoryFileWindow {
        head,
        tail,
        file_bytes,
        modified_epoch_ms,
        head_complete,
        covers_file,
    })
}

struct ScannedWindowLines<'a> {
    lines: Vec<&'a str>,
    truncated: bool,
}

fn window_lines(
    bytes: &[u8],
    drop_first_partial: bool,
    drop_last_partial: bool,
) -> ScannedWindowLines<'_> {
    let mut parts: Vec<&[u8]> = bytes.split(|byte| *byte == b'\n').collect();
    if drop_last_partial {
        parts.pop();
    }
    let start = usize::from(drop_first_partial && !parts.is_empty());
    let mut lines: Vec<&str> = Vec::new();
    let mut truncated = false;
    for part in &parts[start..] {
        let Ok(text) = std::str::from_utf8(part) else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if lines.len() >= MAX_SCANNED_WINDOW_LINES {
            truncated = true;
            break;
        }
        lines.push(trimmed);
    }
    ScannedWindowLines { lines, truncated }
}

#[derive(Deserialize)]
struct RawClaudeMessage {
    content: Option<Value>,
}

#[derive(Deserialize)]
struct RawClaudeLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    cwd: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "promptSource")]
    prompt_source: Option<String>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    #[serde(rename = "toolUseResult")]
    tool_use_result: Option<serde::de::IgnoredAny>,
    message: Option<RawClaudeMessage>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<String>,
    #[serde(rename = "agentName")]
    agent_name: Option<String>,
}

#[derive(Deserialize)]
struct RawCodexBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct RawCodexPayload {
    #[serde(rename = "type")]
    payload_type: Option<String>,
    id: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    timestamp: Option<String>,
    source: Option<Value>,
    role: Option<String>,
    content: Option<Vec<RawCodexBlock>>,
}

#[derive(Deserialize)]
struct RawCodexLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    timestamp: Option<String>,
    payload: Option<RawCodexPayload>,
}

#[derive(Default)]
struct ClaudeHeadFacts {
    cwd: Option<String>,
    started_at_epoch_ms: Option<u64>,
    agent_name: Option<String>,
    ai_title: Option<String>,
    first_typed_prompt: Option<String>,
    typed_count: u32,
}

fn scan_claude_head(lines: &[&str]) -> ClaudeHeadFacts {
    let mut facts = ClaudeHeadFacts::default();
    for line in lines {
        let Ok(parsed) = serde_json::from_str::<RawClaudeLine>(line) else {
            continue;
        };
        if facts.cwd.is_none() {
            facts.cwd = parsed.cwd.clone();
        }
        if facts.started_at_epoch_ms.is_none() {
            facts.started_at_epoch_ms =
                parsed.timestamp.as_deref().and_then(parse_iso_utc_epoch_ms);
        }
        match parsed.line_type.as_deref() {
            Some("agent-name") if facts.agent_name.is_none() => {
                facts.agent_name = parsed.agent_name.filter(|value| !value.trim().is_empty());
            }
            Some("ai-title") if facts.ai_title.is_none() => {
                facts.ai_title = parsed.ai_title.filter(|value| !value.trim().is_empty());
            }
            Some("user") => {
                if let Some(prompt) = claude_typed_prompt(&parsed) {
                    if facts.first_typed_prompt.is_none() {
                        facts.first_typed_prompt = Some(prompt);
                    }
                    facts.typed_count = facts.typed_count.saturating_add(1);
                }
            }
            _ => {}
        }
    }
    facts
}

fn claude_typed_prompt(line: &RawClaudeLine) -> Option<String> {
    let (text, plain_string) = claude_user_text(line)?;
    match line.prompt_source.as_deref() {
        Some("typed") => Some(text),
        None if plain_string => Some(text),
        _ => None,
    }
}

fn claude_user_text(line: &RawClaudeLine) -> Option<(String, bool)> {
    if line.is_meta == Some(true) || line.tool_use_result.is_some() {
        return None;
    }
    let content = line.message.as_ref()?.content.as_ref()?;
    let (text, plain_string) = match content {
        Value::String(text) => (text.clone(), true),
        Value::Array(blocks) => (joined_text_blocks(blocks, "text")?, false),
        _ => return None,
    };
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        return None;
    }
    Some((trimmed.to_string(), plain_string))
}

fn claude_assistant_text(line: &RawClaudeLine) -> Option<String> {
    let content = line.message.as_ref()?.content.as_ref()?;
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => joined_text_blocks(blocks, "text")?,
        _ => return None,
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn joined_text_blocks(blocks: &[Value], block_type: &str) -> Option<String> {
    let mut joined = String::new();
    for block in blocks.iter().take(64) {
        if block.get("type").and_then(Value::as_str) != Some(block_type) {
            continue;
        }
        let Some(text) = block.get("text").and_then(Value::as_str) else {
            continue;
        };
        if !joined.is_empty() {
            joined.push('\n');
        }
        joined.push_str(text);
        if joined.len() >= MAX_EXTERNAL_SESSION_TEXT_BYTES {
            break;
        }
    }
    if joined.trim().is_empty() {
        return None;
    }
    Some(joined)
}

fn claude_exchange(line: &RawClaudeLine) -> Option<(ExternalSessionExchangeRole, String)> {
    match line.line_type.as_deref()? {
        "user" => claude_user_text(line).map(|(text, _)| (ExternalSessionExchangeRole::User, text)),
        "assistant" => {
            claude_assistant_text(line).map(|text| (ExternalSessionExchangeRole::Assistant, text))
        }
        _ => None,
    }
}

fn collect_claude_exchanges(lines: &[&str], collector: &mut PreviewCollector) {
    for line in lines {
        let Ok(parsed) = serde_json::from_str::<RawClaudeLine>(line) else {
            continue;
        };
        if let Some((role, text)) = claude_exchange(&parsed) {
            collector.push(role, text);
        }
    }
}

fn codex_exchange(line: &RawCodexLine) -> Option<(ExternalSessionExchangeRole, String)> {
    if line.line_type.as_deref() != Some("response_item") {
        return None;
    }
    let payload = line.payload.as_ref()?;
    if payload.payload_type.as_deref() != Some("message") {
        return None;
    }
    let blocks = payload.content.as_deref()?;
    match payload.role.as_deref()? {
        "user" => {
            let text = joined_codex_blocks(blocks, "input_text", true)?;
            Some((ExternalSessionExchangeRole::User, text))
        }
        "assistant" => {
            let text = joined_codex_blocks(blocks, "output_text", false)?;
            Some((ExternalSessionExchangeRole::Assistant, text))
        }
        _ => None,
    }
}

fn joined_codex_blocks(
    blocks: &[RawCodexBlock],
    block_type: &str,
    reject_injected: bool,
) -> Option<String> {
    let mut joined = String::new();
    for block in blocks.iter().take(64) {
        if block.block_type.as_deref() != Some(block_type) {
            continue;
        }
        let Some(text) = block.text.as_deref() else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if reject_injected && trimmed.starts_with('<') {
            continue;
        }
        if !joined.is_empty() {
            joined.push('\n');
        }
        joined.push_str(trimmed);
        if joined.len() >= MAX_EXTERNAL_SESSION_TEXT_BYTES {
            break;
        }
    }
    if joined.is_empty() {
        return None;
    }
    Some(joined)
}

fn collect_codex_exchanges(lines: &[&str], collector: &mut PreviewCollector) {
    for line in lines {
        let Ok(parsed) = serde_json::from_str::<RawCodexLine>(line) else {
            continue;
        };
        if let Some((role, text)) = codex_exchange(&parsed) {
            collector.push(role, text);
        }
    }
}

const PREVIEW_TAIL_EXCHANGES: usize = MAX_PREVIEW_EXCHANGES - PREVIEW_HEAD_EXCHANGES;

struct PreviewCollector {
    first: Vec<ExternalSessionExchange>,
    last: VecDeque<ExternalSessionExchange>,
    total_seen: usize,
}

impl PreviewCollector {
    fn new() -> Self {
        Self {
            first: Vec::with_capacity(PREVIEW_HEAD_EXCHANGES),
            last: VecDeque::with_capacity(PREVIEW_TAIL_EXCHANGES + 1),
            total_seen: 0,
        }
    }

    fn push(&mut self, role: ExternalSessionExchangeRole, text: String) {
        let exchange = ExternalSessionExchange {
            role,
            text: clip_utf8(&text, MAX_EXTERNAL_SESSION_TEXT_BYTES).to_string(),
        };
        if self.first.len() < PREVIEW_HEAD_EXCHANGES {
            self.first.push(exchange.clone());
        }
        self.last.push_back(exchange);
        if self.last.len() > PREVIEW_TAIL_EXCHANGES {
            self.last.pop_front();
        }
        self.total_seen = self.total_seen.saturating_add(1);
    }

    fn finish(self) -> (Vec<ExternalSessionExchange>, bool) {
        if self.total_seen <= MAX_PREVIEW_EXCHANGES {
            let missing_head = self.total_seen.saturating_sub(self.last.len());
            let mut selected: Vec<ExternalSessionExchange> =
                self.first.into_iter().take(missing_head).collect();
            selected.extend(self.last);
            return (selected, false);
        }
        let mut selected = self.first;
        selected.extend(self.last);
        (selected, true)
    }
}

fn enforce_preview_budget(
    exchanges: Vec<ExternalSessionExchange>,
) -> (Vec<ExternalSessionExchange>, u64, bool) {
    let mut budget = PREVIEW_TOTAL_BYTES;
    let mut keep_from = exchanges.len();
    for (index, exchange) in exchanges.iter().enumerate().rev() {
        if exchange.text.len() > budget {
            break;
        }
        budget -= exchange.text.len();
        keep_from = index;
    }
    let dropped = keep_from > 0;
    let kept: Vec<ExternalSessionExchange> = exchanges.into_iter().skip(keep_from).collect();
    let total: u64 = kept.iter().map(|exchange| exchange.text.len() as u64).sum();
    (kept, total, dropped)
}

fn sanitize_label(value: &str, max_bytes: usize) -> String {
    let mut cleaned = String::with_capacity(value.len().min(max_bytes + 8));
    for character in value.chars() {
        if character.is_control() {
            cleaned.push(' ');
        } else {
            cleaned.push(character);
        }
        if cleaned.len() > max_bytes + 8 {
            break;
        }
    }
    clip_utf8(cleaned.trim(), max_bytes).trim_end().to_string()
}

fn clip_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn current_epoch_ms() -> u64 {
    epoch_ms_from_system_time(SystemTime::now())
}

fn epoch_ms_from_system_time(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn parse_iso_utc_epoch_ms(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: i64 = value.get(5..7)?.parse().ok()?;
    let day: i64 = value.get(8..10)?.parse().ok()?;
    let hour: u64 = value.get(11..13)?.parse().ok()?;
    let minute: u64 = value.get(14..16)?.parse().ok()?;
    let second: u64 = value.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let rest = value.get(19..)?;
    let millis: u64 = if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.strip_suffix('Z')?;
        if digits.is_empty() || digits.len() > 9 || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let mut padded = digits.to_string();
        padded.truncate(3);
        while padded.len() < 3 {
            padded.push('0');
        }
        padded.parse().ok()?
    } else if rest == "Z" {
        0
    } else {
        return None;
    };
    let days = days_from_civil(year, month, day);
    if days < 0 {
        return None;
    }
    Some(
        (days as u64) * EPOCH_MS_PER_DAY
            + hour * 3_600_000
            + minute * 60_000
            + second * 1000
            + millis,
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = if month <= 2 { year - 1 } else { year };
    let era = (if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    }) / 400;
    let year_of_era = adjusted_year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = (if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    }) / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
#[path = "agent_session_history_tests.rs"]
mod tests;
