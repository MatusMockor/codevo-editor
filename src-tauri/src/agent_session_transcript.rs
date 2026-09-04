use super::*;

pub const MAX_HISTORY_EXCHANGES: usize = 256;
pub const HISTORY_TOTAL_BYTES: usize = 128 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub type ExternalAgentSessionHistory = ExternalAgentSessionPreview;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadExternalAgentSessionHistoryRequest {
    pub provider: ExternalSessionProvider,
    pub session_id: String,
    pub project_root: String,
    pub repository_root: String,
    pub before_epoch_ms: u64,
}

pub fn read_external_agent_session_history(
    request: &ReadExternalAgentSessionHistoryRequest,
) -> Result<ExternalAgentSessionHistory, String> {
    validate_request(request)?;
    let roots = ExternalSessionHistoryRoots::from_environment()
        .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
    read_history_at(request, &roots, current_epoch_ms())
}

fn validate_request(request: &ReadExternalAgentSessionHistoryRequest) -> Result<(), String> {
    validate_external_session_id(&request.session_id)?;
    if request.before_epoch_ms > MAX_SAFE_INTEGER {
        return Err("External agent session history requires a safe integer cutoff.".to_string());
    }
    Ok(())
}

fn read_history_at(
    request: &ReadExternalAgentSessionHistoryRequest,
    roots: &ExternalSessionHistoryRoots,
    now_epoch_ms: u64,
) -> Result<ExternalAgentSessionHistory, String> {
    validate_request(request)?;
    let repository_root = validate_repository_root(&request.repository_root)?;
    let path = match request.provider {
        AgentCliInvocation::ClaudeCode => roots
            .claude_projects_directory
            .join(encode_claude_project_directory(&repository_root))
            .join(format!("{}.jsonl", request.session_id)),
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
    let tail = window.tail.as_ref().map(|tail| {
        // The head's last incomplete line was dropped, so a tail starting directly
        // after that head also starts in a partial record.
        window_lines(
            &tail.bytes,
            !window.head.ends_with(b"\n") || tail.starts_after_head,
            false,
        )
    });
    let mut collector = HistoryCollector::new();
    collector.truncated = !window.covers_file
        || !window.head_complete
        || std::str::from_utf8(&window.head).is_err()
        || window
            .tail
            .as_ref()
            .is_some_and(|tail| std::str::from_utf8(&tail.bytes).is_err())
        || head.truncated
        || tail.as_ref().is_some_and(|tail| tail.truncated);
    match request.provider {
        AgentCliInvocation::ClaudeCode => {
            let facts = scan_claude_head(&head.lines);
            if facts.cwd.as_deref() != Some(repository_root.as_str()) || facts.typed_count == 0 {
                return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
            }
        }
        AgentCliInvocation::CodexExec => {
            let meta = head
                .lines
                .first()
                .and_then(|line| serde_json::from_str::<RawCodexLine>(line).ok())
                .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
            codex_meta_gate(&meta, &repository_root, &request.session_id)
                .map_err(|_| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
        }
    }
    let tail_lines = tail
        .as_ref()
        .map(|tail| tail.lines.as_slice())
        .unwrap_or(&[]);
    let mut verified_roots = HashSet::from([repository_root.clone()]);
    for line in head.lines.iter().chain(tail_lines) {
        let (timestamp, exchange) = match request.provider {
            AgentCliInvocation::ClaudeCode => {
                let Ok(parsed) = serde_json::from_str::<RawClaudeLine>(line) else {
                    collector.truncated = true;
                    continue;
                };
                if parsed
                    .session_id
                    .as_deref()
                    .is_some_and(|id| !id.eq_ignore_ascii_case(&request.session_id))
                {
                    return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
                }
                let timestamp = parsed.timestamp.as_deref().and_then(parse_iso_utc_epoch_ms);
                if timestamp.is_some_and(|value| value > request.before_epoch_ms) {
                    continue;
                }
                if let Some(cwd) = &parsed.cwd {
                    if !verified_roots.contains(cwd) {
                        scoped_repository_root(&repository_root, cwd)
                            .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
                        verified_roots.insert(cwd.clone());
                    }
                }
                collector.truncated |= parsed
                    .message
                    .as_ref()
                    .and_then(|message| message.content.as_ref())
                    .and_then(Value::as_array)
                    .is_some_and(|blocks| blocks.len() > 64);
                (timestamp, history_claude_exchange(&parsed))
            }
            AgentCliInvocation::CodexExec => {
                let Ok(parsed) = serde_json::from_str::<RawCodexLine>(line) else {
                    collector.truncated = true;
                    continue;
                };
                let timestamp = parsed
                    .timestamp
                    .as_deref()
                    .or_else(|| {
                        parsed
                            .payload
                            .as_ref()
                            .and_then(|payload| payload.timestamp.as_deref())
                    })
                    .and_then(parse_iso_utc_epoch_ms);
                collector.truncated |= parsed
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.content.as_ref())
                    .is_some_and(|blocks| blocks.len() > 64);
                (timestamp, history_codex_exchange(&parsed))
            }
        };
        let Some((role, text)) = exchange else {
            continue;
        };
        let Some(timestamp) = timestamp else {
            // Unknown dates cannot safely belong to the pre-import snapshot.
            collector.truncated = true;
            continue;
        };
        if timestamp <= request.before_epoch_ms {
            collector.push(role, text);
        }
    }
    Ok(ExternalAgentSessionHistory {
        provider: request.provider,
        session_id: request.session_id.clone(),
        exchanges: collector.exchanges.into_iter().collect(),
        exchanges_truncated: collector.truncated,
        total_preview_bytes: collector.bytes as u64,
    })
}

fn history_claude_exchange(line: &RawClaudeLine) -> Option<(ExternalSessionExchangeRole, String)> {
    if line.line_type.as_deref() != Some("user") {
        return claude_exchange(line);
    }
    if line.is_meta == Some(true) || line.tool_use_result.is_some() {
        return None;
    }
    let content = line.message.as_ref()?.content.as_ref()?;
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => joined_text_blocks(blocks, "text")?,
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty()
        || (line.prompt_source.as_deref() != Some("typed") && is_injected_history_text(text))
    {
        return None;
    }
    Some((ExternalSessionExchangeRole::User, text.to_string()))
}

fn history_codex_exchange(line: &RawCodexLine) -> Option<(ExternalSessionExchangeRole, String)> {
    let payload = line.payload.as_ref()?;
    if payload.role.as_deref() != Some("user") {
        return codex_exchange(line);
    }
    if line.line_type.as_deref() != Some("response_item")
        || payload.payload_type.as_deref() != Some("message")
    {
        return None;
    }
    let text = joined_codex_blocks(payload.content.as_deref()?, "input_text", false)?;
    if is_injected_history_text(&text) {
        return None;
    }
    Some((ExternalSessionExchangeRole::User, text))
}

fn is_injected_history_text(text: &str) -> bool {
    [
        "<environment_context>",
        "<permissions instructions>",
        "<system-reminder>",
        "<local-command-caveat>",
        "<local-command-stdout>",
        "<command-name>",
        "<task-notification>",
        "<user_instructions>",
        "<turn_aborted>",
        "# AGENTS.md instructions",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
}

struct HistoryCollector {
    exchanges: VecDeque<ExternalSessionExchange>,
    bytes: usize,
    truncated: bool,
}

impl HistoryCollector {
    fn new() -> Self {
        Self {
            exchanges: VecDeque::new(),
            bytes: 0,
            truncated: false,
        }
    }

    fn push(&mut self, role: ExternalSessionExchangeRole, text: String) {
        self.truncated |= text.len() >= MAX_EXTERNAL_SESSION_TEXT_BYTES;
        let original = clip_utf8(&text, MAX_EXTERNAL_SESSION_TEXT_BYTES);
        let text: String = original
            .chars()
            .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
            .collect();
        self.truncated |= text.len() != original.len();
        self.bytes += text.len();
        self.exchanges
            .push_back(ExternalSessionExchange { role, text });
        while self.exchanges.len() > MAX_HISTORY_EXCHANGES || self.bytes > HISTORY_TOTAL_BYTES {
            if let Some(removed) = self.exchanges.pop_front() {
                self.bytes -= removed.text.len();
                self.truncated = true;
            }
        }
    }
}

#[cfg(test)]
#[path = "agent_session_transcript_tests.rs"]
mod tests;
