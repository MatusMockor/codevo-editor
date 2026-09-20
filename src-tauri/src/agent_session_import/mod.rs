//! Bounded, resumable traversal of a frozen provider JSONL snapshot.
use super::*;

const STEP_BYTES: usize = 1024 * 1024;
const LINE_BYTES: usize = 256 * 1024;
const STEP_EXCHANGES: usize = 64;
const STEP_TEXT_BYTES: usize = 128 * 1024;
mod snapshot;
mod stream_record;

const SOURCE_CHANGED: &str =
    "The original session changed while importing; its saved history was kept.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceCursor {
    identity: String,
    source_modified: String,
    snapshot_name: String,
    copied_bytes: u64,
    snapshot_identity: Option<String>,
    snapshot_bytes: u64,
    offset: u64,
    skipping_line: bool,
}

pub(crate) struct SourcePage {
    pub cursor: SourceCursor,
    pub exchanges: Vec<ExternalSessionExchange>,
    pub complete: bool,
    pub truncated: bool,
}

pub(crate) fn read_page(
    provider: ExternalSessionProvider,
    session_id: &str,
    repository_root: &str,
    cutoff: u64,
    cursor: Option<SourceCursor>,
    snapshot_directory: &Path,
) -> Result<SourcePage, String> {
    let roots = ExternalSessionHistoryRoots::from_environment()
        .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
    read_page_at(
        provider,
        session_id,
        repository_root,
        cutoff,
        cursor,
        &roots,
        snapshot_directory,
    )
}

fn read_page_at(
    provider: ExternalSessionProvider,
    session_id: &str,
    repository_root: &str,
    cutoff: u64,
    cursor: Option<SourceCursor>,
    roots: &ExternalSessionHistoryRoots,
    snapshot_directory: &Path,
) -> Result<SourcePage, String> {
    validate_external_session_id(session_id)?;
    let repository_root = validate_repository_root(repository_root)?;
    let mut cursor = snapshot::prepare(
        provider,
        session_id,
        &repository_root,
        cutoff,
        cursor,
        roots,
        snapshot_directory,
    )?;
    if cursor.copied_bytes < cursor.snapshot_bytes {
        return Ok(SourcePage {
            cursor,
            exchanges: Vec::new(),
            complete: false,
            truncated: false,
        });
    }
    let mut file = snapshot::open(&cursor, snapshot_directory)?;
    file.seek(SeekFrom::Start(cursor.offset))
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let remaining = cursor.snapshot_bytes - cursor.offset;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(remaining.min(STEP_BYTES as u64))
        .read_to_end(&mut bytes)
        .map_err(|_| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
    if bytes.len() as u64 != remaining.min(STEP_BYTES as u64) {
        return Err(SOURCE_CHANGED.to_string());
    }
    let at_end = bytes.len() as u64 == remaining;
    let mut exchanges = Vec::new();
    let mut total = 0;
    let mut consumed = 0;
    let mut truncated = false;
    for raw in bytes.split_inclusive(|value| *value == b'\n') {
        let terminated = raw.ends_with(b"\n");
        if cursor.skipping_line {
            consumed += raw.len();
            cursor.skipping_line = !terminated;
            truncated = true;
            continue;
        }
        if raw.len() > LINE_BYTES || (!terminated && !at_end) {
            if !exchanges.is_empty() {
                break;
            }
            let streamed = stream_record::read(
                &mut file,
                cursor.offset + consumed as u64,
                cursor.snapshot_bytes,
                provider,
                session_id,
                &repository_root,
                cutoff,
            )?;
            consumed += streamed.bytes;
            cursor.skipping_line = !streamed.ended;
            truncated |= streamed.truncated;
            if let Some(exchange) = streamed.exchange {
                exchanges.push(exchange);
            }
            break;
        }
        let parsed = parse_exchange(raw, provider, session_id, &repository_root, cutoff)?;
        if let Some((exchange, omitted)) = parsed {
            if exchanges.len() >= STEP_EXCHANGES
                || total + exchange.budget_bytes() > STEP_TEXT_BYTES
            {
                break;
            }
            truncated |= omitted;
            total += exchange.budget_bytes();
            if !exchange.text.is_empty() || !exchange.attachments.is_empty() {
                exchanges.push(exchange);
            }
        } else if serde_json::from_slice::<Value>(raw).is_err() {
            truncated = true;
        }
        consumed += raw.len();
    }
    cursor.offset += consumed as u64;
    Ok(SourcePage {
        complete: cursor.offset == cursor.snapshot_bytes,
        cursor,
        exchanges,
        truncated,
    })
}

fn validate_source(
    file: &mut fs::File,
    provider: ExternalSessionProvider,
    session: &str,
    root: &str,
) -> Result<(), String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let mut head = Vec::new();
    file.take(HEAD_READ_BYTES as u64)
        .read_to_end(&mut head)
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let lines = window_lines(&head, false, true);
    let valid = match provider {
        AgentCliInvocation::ClaudeCode => {
            let facts = scan_claude_head(&lines.lines);
            (facts.cwd.as_deref() == Some(root) && facts.typed_count > 0)
                || stream_record::validate_claude(file, root, session)
        }
        AgentCliInvocation::CodexExec => lines
            .lines
            .first()
            .and_then(|line| serde_json::from_str::<RawCodexLine>(line).ok())
            .is_some_and(|meta| codex_meta_gate(&meta, root, session).is_ok()),
    };
    if valid {
        Ok(())
    } else {
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    }
}

fn parse_exchange<R: Read>(
    raw: R,
    provider: ExternalSessionProvider,
    session: &str,
    root: &str,
    cutoff: u64,
) -> Result<Option<(ExternalSessionExchange, bool)>, String> {
    let (timestamp, draft, blocks_omitted) = match provider {
        AgentCliInvocation::ClaudeCode => {
            let Ok(line) = serde_json::from_reader::<_, RawClaudeLine>(raw) else {
                return Ok(None);
            };
            if line
                .session_id
                .as_deref()
                .is_some_and(|id| !id.eq_ignore_ascii_case(session))
            {
                return Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string());
            }
            if let Some(cwd) = &line.cwd {
                scoped_repository_root(root, cwd)
                    .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
            }
            (
                line.timestamp.as_deref().and_then(parse_iso_utc_epoch_ms),
                transcript::history_claude_exchange(&line)
                    .or_else(|| attachment_only_claude(&line)),
                line.message
                    .as_ref()
                    .and_then(|message| message.content.as_ref())
                    .and_then(RawClaudeContent::blocks)
                    .is_some_and(|blocks| {
                        blocks.len() > 64
                            || blocks
                                .iter()
                                .filter(|block| block.block_type.as_deref() == Some("image"))
                                .count()
                                > 8
                    }),
            )
        }
        AgentCliInvocation::CodexExec => {
            let Ok(line) = serde_json::from_reader::<_, RawCodexLine>(raw) else {
                return Ok(None);
            };
            (
                line.timestamp
                    .as_deref()
                    .or_else(|| line.payload.as_ref().and_then(|p| p.timestamp.as_deref()))
                    .and_then(parse_iso_utc_epoch_ms),
                transcript::history_codex_exchange(&line).or_else(|| attachment_only_codex(&line)),
                line.payload
                    .as_ref()
                    .and_then(|payload| payload.content.as_ref())
                    .is_some_and(|blocks| {
                        blocks.len() > 64
                            || blocks
                                .iter()
                                .filter(|block| {
                                    matches!(
                                        block.block_type.as_deref(),
                                        Some("input_image" | "local_image")
                                    )
                                })
                                .count()
                                > 8
                    }),
            )
        }
    };
    let Some(draft) = draft else { return Ok(None) };
    let Some(timestamp) = timestamp else {
        return Ok(Some((
            ExternalSessionExchange {
                role: draft.role,
                text: String::new(),
                attachments: Vec::new(),
            },
            true,
        )));
    };
    if timestamp > cutoff {
        return Ok(None);
    }
    let clipped = clip_utf8(&draft.text, MAX_EXTERNAL_SESSION_TEXT_BYTES);
    let text: String = clipped
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    let omitted = blocks_omitted
        || text.len() != draft.text.len()
        || draft.text.len() >= MAX_EXTERNAL_SESSION_TEXT_BYTES
        || draft.text.matches("[Attached ").count() > 8;
    Ok(Some((
        ExternalSessionExchange {
            role: draft.role,
            text,
            attachments: draft.attachments,
        },
        omitted,
    )))
}

#[cfg(unix)]
fn source_identity(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("{}:{}", metadata.dev(), metadata.ino())
}
#[cfg(not(unix))]
fn source_identity(metadata: &fs::Metadata) -> String {
    format!("{:?}", metadata.created())
}

fn attachment_only_claude(line: &RawClaudeLine) -> Option<SessionExchangeDraft> {
    if line.line_type.as_deref() != Some("user")
        || line.is_meta == Some(true)
        || line.tool_use_result.is_some()
    {
        return None;
    }
    let draft = SessionExchangeDraft::claude_user(line, String::new());
    (!draft.attachments.is_empty()).then_some(draft)
}
fn attachment_only_codex(line: &RawCodexLine) -> Option<SessionExchangeDraft> {
    let payload = line.payload.as_ref()?;
    if line.line_type.as_deref() != Some("response_item")
        || payload.payload_type.as_deref() != Some("message")
        || payload.role.as_deref() != Some("user")
    {
        return None;
    }
    let draft = SessionExchangeDraft::codex_user(payload.content.as_deref()?, String::new());
    (!draft.attachments.is_empty()).then_some(draft)
}

#[cfg(test)]
mod tests;

pub(crate) fn discard_snapshot(cursor: &SourceCursor, directory: &Path) {
    snapshot::discard(cursor, directory);
}
