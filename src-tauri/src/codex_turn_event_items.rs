use super::super::codex_app_server_protocol::{
    CommandExecutionItem, CommandExecutionStatus, FileChangeItem, FileUpdateChange,
    McpToolCallItem, McpToolCallStatus, PatchApplyStatus, PatchChangeKind, ReasoningItem,
    ThreadItem, WebSearchAction, WebSearchItem,
};
use super::redaction::redact_arguments;
use super::{
    bounded_identity, clipped_text, CodexClippedText, CodexItemEvent, CodexItemOutcome,
    CodexItemPhase, CodexTextRole, APPLY_PATCH_TOOL_NAME, MAX_AGENT_TOOL_SUMMARY_BYTES,
    MAX_CODEX_EVENT_TEXT_BYTES, MAX_CODEX_TOOL_ID_BYTES, MAX_CODEX_TOOL_NAME_BYTES,
    SHELL_TOOL_NAME, WEB_SEARCH_TOOL_NAME,
};
use serde_json::Value;

const CHANGED_PATH_SEPARATOR: &str = ", ";
const TEXT_PART_SEPARATOR: &str = "\n";
const OMISSION_ELLIPSIS: &str = "\u{2026}";
const MAX_MCP_CONTENT_PARTS: usize = 16;
const MAX_CHANGE_SUMMARY_ENTRIES: usize = 64;
pub(super) fn project_item(item: &ThreadItem, phase: CodexItemPhase) -> CodexItemOutcome {
    match item {
        ThreadItem::UserMessage { .. } => CodexItemOutcome::Dropped,
        ThreadItem::ContextCompaction { .. } => CodexItemOutcome::Dropped,
        ThreadItem::Ignored { .. } => CodexItemOutcome::Dropped,
        ThreadItem::AgentMessage(message) => {
            message_outcome(CodexTextRole::Assistant, message.text.as_deref(), phase)
        }
        ThreadItem::Reasoning(reasoning) => {
            let text = reasoning_text(reasoning);
            message_outcome(CodexTextRole::Reasoning, Some(text.as_str()), phase)
        }
        ThreadItem::CommandExecution(command) => command_outcome(command, phase),
        ThreadItem::FileChange(change) => file_change_outcome(change, phase),
        ThreadItem::McpToolCall(call) => mcp_tool_call_outcome(call, phase),
        ThreadItem::WebSearch(search) => web_search_outcome(search, phase),
        ThreadItem::SubAgentActivity(_) => CodexItemOutcome::Unknown,
        ThreadItem::Unrecognized { .. } => CodexItemOutcome::Unknown,
    }
}

fn message_outcome(
    role: CodexTextRole,
    text: Option<&str>,
    phase: CodexItemPhase,
) -> CodexItemOutcome {
    if !matches!(phase, CodexItemPhase::Completed) {
        return CodexItemOutcome::Dropped;
    }
    let bounded = clipped_text(text.unwrap_or_default(), MAX_CODEX_EVENT_TEXT_BYTES);
    if bounded.text.is_empty() {
        return CodexItemOutcome::Dropped;
    }
    CodexItemOutcome::Events(vec![CodexItemEvent::Text {
        role,
        text: bounded,
    }])
}

fn reasoning_text(reasoning: &ReasoningItem) -> String {
    match reasoning.summary.is_empty() {
        true => reasoning.content.join(TEXT_PART_SEPARATOR),
        false => reasoning.summary.join(TEXT_PART_SEPARATOR),
    }
}

fn tool_call(tool_id: String, name: &str, input_summary: CodexClippedText) -> CodexItemOutcome {
    CodexItemOutcome::Events(vec![CodexItemEvent::ToolCall {
        tool_id,
        name: clipped_text(name, MAX_CODEX_TOOL_NAME_BYTES),
        input_summary,
    }])
}

fn tool_result(
    tool_id: String,
    output_summary: CodexClippedText,
    is_error: bool,
) -> CodexItemOutcome {
    CodexItemOutcome::Events(vec![CodexItemEvent::ToolResult {
        tool_id,
        output_summary,
        is_error,
    }])
}

fn command_outcome(command: &CommandExecutionItem, phase: CodexItemPhase) -> CodexItemOutcome {
    let Some(tool_id) = bounded_identity(command.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    if matches!(phase, CodexItemPhase::Started) {
        return tool_call(
            tool_id,
            SHELL_TOOL_NAME,
            clipped_text(
                command.command.as_deref().unwrap_or_default(),
                MAX_AGENT_TOOL_SUMMARY_BYTES,
            ),
        );
    }
    tool_result(
        tool_id,
        command_output_summary(command),
        command_is_error(command),
    )
}

fn command_output_summary(command: &CommandExecutionItem) -> CodexClippedText {
    let output = command.aggregated_output.as_deref().unwrap_or_default();
    let Some(prefix) = command_status_prefix(command) else {
        return clip_head_tail(output, MAX_AGENT_TOOL_SUMMARY_BYTES);
    };
    let separator = match output.is_empty() {
        true => "",
        false => TEXT_PART_SEPARATOR,
    };
    let header = format!("{prefix}{separator}");
    let body = clip_head_tail(
        output,
        MAX_AGENT_TOOL_SUMMARY_BYTES.saturating_sub(header.len()),
    );
    CodexClippedText {
        text: format!("{header}{}", body.text),
        clipped: body.clipped,
    }
}

fn command_status_prefix(command: &CommandExecutionItem) -> Option<String> {
    if matches!(command.status, CommandExecutionStatus::Declined) {
        return Some("declined".to_string());
    }
    command
        .exit_code
        .filter(|code| *code != 0)
        .map(|code| format!("exit {code}"))
}

fn command_is_error(command: &CommandExecutionItem) -> bool {
    if !matches!(command.status, CommandExecutionStatus::Completed) {
        return true;
    }
    command.exit_code != Some(0)
}

fn file_change_outcome(change: &FileChangeItem, phase: CodexItemPhase) -> CodexItemOutcome {
    let Some(tool_id) = bounded_identity(change.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    if matches!(phase, CodexItemPhase::Started) {
        let paths = change
            .changes
            .iter()
            .take(MAX_CHANGE_SUMMARY_ENTRIES)
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>()
            .join(CHANGED_PATH_SEPARATOR);
        return tool_call(
            tool_id,
            APPLY_PATCH_TOOL_NAME,
            clipped_text(paths.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES),
        );
    }
    let status = patch_status_label(&change.status);
    let entries = change
        .changes
        .iter()
        .take(MAX_CHANGE_SUMMARY_ENTRIES)
        .map(change_summary_line);
    let summary = status
        .into_iter()
        .map(str::to_string)
        .chain(entries)
        .collect::<Vec<_>>()
        .join(TEXT_PART_SEPARATOR);
    tool_result(
        tool_id,
        clipped_text(summary.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES),
        !matches!(change.status, PatchApplyStatus::Completed),
    )
}

fn patch_status_label(status: &PatchApplyStatus) -> Option<&'static str> {
    match status {
        PatchApplyStatus::Completed => None,
        PatchApplyStatus::InProgress => Some("patch did not finish"),
        PatchApplyStatus::Failed => Some("patch failed"),
        PatchApplyStatus::Declined => Some("patch declined"),
        PatchApplyStatus::Unrecognized { .. } => Some("patch status unknown"),
    }
}

fn change_summary_line(change: &FileUpdateChange) -> String {
    let path = change.path.as_str();
    match &change.kind {
        PatchChangeKind::Add => format!("add {path}"),
        PatchChangeKind::Delete => format!("delete {path}"),
        PatchChangeKind::Update {
            move_path: Some(target),
        } => format!("move {path} -> {target}"),
        PatchChangeKind::Update { move_path: None } => format!("update {path}"),
        PatchChangeKind::Unrecognized { .. } => format!("change {path}"),
    }
}

fn mcp_tool_call_outcome(call: &McpToolCallItem, phase: CodexItemPhase) -> CodexItemOutcome {
    let Some(tool_id) = bounded_identity(call.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    let (Some(server), Some(tool)) = (call.server.as_deref(), call.tool.as_deref()) else {
        return CodexItemOutcome::Dropped;
    };
    if matches!(phase, CodexItemPhase::Started) {
        return tool_call(
            tool_id,
            format!("{server}/{tool}").as_str(),
            mcp_arguments_summary(call.arguments.as_ref()),
        );
    }
    let failed = !matches!(call.status, McpToolCallStatus::Completed) || call.error.is_some();
    tool_result(tool_id, mcp_result_summary(call), failed)
}

fn mcp_arguments_summary(arguments: Option<&Value>) -> CodexClippedText {
    let Some(arguments) = arguments.filter(|value| !value.is_null()) else {
        return CodexClippedText::default();
    };
    let redacted = redact_arguments(arguments);
    let encoded = serde_json::to_string(&redacted.value).unwrap_or_default();
    let mut summary = clipped_text(encoded.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES);
    summary.clipped |= redacted.exhausted;
    summary
}

fn mcp_result_summary(call: &McpToolCallItem) -> CodexClippedText {
    if let Some(message) = call
        .error
        .as_ref()
        .and_then(|error| error.message.as_deref())
    {
        return clip_head_tail(message, MAX_AGENT_TOOL_SUMMARY_BYTES);
    }
    if let Some(label) = mcp_status_label(&call.status) {
        return clipped_text(label.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES);
    }
    let Some(result) = call.result.as_ref() else {
        return CodexClippedText::default();
    };
    let parts = result
        .content
        .iter()
        .take(MAX_MCP_CONTENT_PARTS)
        .map(mcp_content_text)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        let structured = result
            .structured_content
            .as_ref()
            .and_then(|value| serde_json::to_string(value).ok())
            .unwrap_or_default();
        return clip_head_tail(structured.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES);
    }
    let mut summary = clip_head_tail(
        parts.join(TEXT_PART_SEPARATOR).as_str(),
        MAX_AGENT_TOOL_SUMMARY_BYTES,
    );
    summary.clipped |= result.content.len() > MAX_MCP_CONTENT_PARTS;
    summary
}

fn mcp_status_label(status: &McpToolCallStatus) -> Option<String> {
    match status {
        McpToolCallStatus::Completed => None,
        McpToolCallStatus::InProgress => Some("MCP call did not finish".to_string()),
        McpToolCallStatus::Failed => Some("MCP call failed".to_string()),
        McpToolCallStatus::Unrecognized { tag } => Some(format!(
            "MCP call status unknown: {}",
            clipped_text(tag, MAX_CODEX_TOOL_NAME_BYTES).text
        )),
    }
}

fn mcp_content_text(part: &Value) -> String {
    let kind = part.get("type").and_then(Value::as_str).unwrap_or_default();
    if kind == "text" {
        return part
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    }
    let label = clipped_text(kind, MAX_CODEX_TOOL_NAME_BYTES).text;
    match label.is_empty() {
        true => "[content]".to_string(),
        false => format!("[{label}]"),
    }
}

fn web_search_outcome(search: &WebSearchItem, phase: CodexItemPhase) -> CodexItemOutcome {
    let Some(tool_id) = bounded_identity(search.id.as_str(), MAX_CODEX_TOOL_ID_BYTES) else {
        return CodexItemOutcome::Unknown;
    };
    if matches!(phase, CodexItemPhase::Started) {
        return tool_call(
            tool_id,
            WEB_SEARCH_TOOL_NAME,
            clipped_text(
                search.query.as_deref().unwrap_or_default(),
                MAX_AGENT_TOOL_SUMMARY_BYTES,
            ),
        );
    }
    let action = web_search_action_summary(search);
    let count = search.result_count.map(|count| match count {
        1 => "1 result".to_string(),
        count => format!("{count} results"),
    });
    let summary = [action, count]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(TEXT_PART_SEPARATOR);
    tool_result(
        tool_id,
        clipped_text(summary.as_str(), MAX_AGENT_TOOL_SUMMARY_BYTES),
        false,
    )
}

fn web_search_action_summary(search: &WebSearchItem) -> Option<String> {
    let fallback = search.query.clone().filter(|query| !query.is_empty());
    let Some(action) = search.action.as_ref() else {
        return fallback;
    };
    match action {
        WebSearchAction::Search { queries, .. } if !queries.is_empty() => {
            Some(queries.join(CHANGED_PATH_SEPARATOR))
        }
        WebSearchAction::Search { query, .. } => query.clone().or(fallback),
        WebSearchAction::OpenPage { url: Some(url) } => Some(format!("opened {url}")),
        WebSearchAction::FindInPage {
            url: Some(url),
            pattern: Some(pattern),
        } => Some(format!("found \"{pattern}\" in {url}")),
        WebSearchAction::FindInPage { url: Some(url), .. } => Some(format!("searched {url}")),
        WebSearchAction::OpenPage { .. }
        | WebSearchAction::FindInPage { .. }
        | WebSearchAction::Other
        | WebSearchAction::Unrecognized { .. } => fallback,
    }
}

pub(super) fn clip_head_tail(text: &str, limit: usize) -> CodexClippedText {
    let replaced_nul = text.contains('\0');
    let sanitized = match replaced_nul {
        true => text.replace('\0', "\u{fffd}"),
        false => text.to_string(),
    };
    if sanitized.len() <= limit {
        return CodexClippedText {
            text: sanitized,
            clipped: replaced_nul,
        };
    }
    let reserved = omission_marker(sanitized.len()).len();
    if reserved >= limit {
        return clipped_text(sanitized.as_str(), limit);
    }
    let available = limit - reserved;
    let head_end = floor_char_boundary(sanitized.as_str(), available / 2);
    let tail_start =
        ceil_char_boundary(sanitized.as_str(), sanitized.len() - (available - head_end));
    let omitted = tail_start - head_end;
    CodexClippedText {
        text: format!(
            "{}{}{}",
            &sanitized[..head_end],
            omission_marker(omitted),
            &sanitized[tail_start..]
        ),
        clipped: true,
    }
}

fn omission_marker(omitted: usize) -> String {
    format!("\n{OMISSION_ELLIPSIS} {omitted} bytes omitted {OMISSION_ELLIPSIS}\n")
}

fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut end = index.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    end
}

fn ceil_char_boundary(text: &str, index: usize) -> usize {
    let mut start = index.min(text.len());
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    start
}
