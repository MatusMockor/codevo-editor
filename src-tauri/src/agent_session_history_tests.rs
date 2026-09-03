use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const CLAUDE_SESSION_ID: &str = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
const CODEX_SESSION_ID: &str = "01a038a1-c2ee-7642-98e4-c94d7a479e0c";

const CLAUDE_INTERACTIVE_ID: &str = "11111111-1111-4111-8111-111111111111";
const CLAUDE_AGENT_NAMED_ID: &str = "22222222-2222-4222-8222-222222222222";
const CLAUDE_SDK_ONLY_ID: &str = "33333333-3333-4333-8333-333333333333";
const CLAUDE_LEGACY_ID: &str = "44444444-4444-4444-8444-444444444444";
const CODEX_EXEC_ID: &str = "55555555-5555-4555-8555-555555555555";
const CODEX_CLI_ID: &str = "66666666-6666-4666-8666-666666666666";
const CODEX_VSCODE_ID: &str = "77777777-7777-4777-8777-777777777777";
const CODEX_SUBAGENT_ID: &str = "88888888-8888-4888-8888-888888888888";
const ABSENT_SESSION_ID: &str = "99999999-9999-4999-8999-999999999999";

const NOW_EPOCH_MS: u64 = 1_788_177_600_000;
const CLAUDE_INTERACTIVE_STARTED_MS: u64 = 1_788_076_800_000;
const CODEX_EXEC_STARTED_MS: u64 = 1_788_080_400_000;

static HOME_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn fixture_text(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("agent_session_history")
        .join(name);
    fs::read_to_string(path).expect("read committed fixture")
}

fn set_modified(path: &Path, epoch_ms: u64) {
    let file = fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open session file for mtime update");
    file.set_modified(UNIX_EPOCH + Duration::from_millis(epoch_ms))
        .expect("set session file mtime");
}

struct HistoryHome {
    base: PathBuf,
    roots: ExternalSessionHistoryRoots,
    repository_root: String,
}

impl HistoryHome {
    fn create(label: &str) -> Self {
        let sequence = HOME_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!(
            "agent-session-history-{label}-{}-{sequence}",
            std::process::id()
        ));
        let repository = base.join("repo");
        fs::create_dir_all(&repository).expect("create fixture repository root");
        let claude_projects_directory = base.join("claude-projects");
        let codex_sessions_directory = base.join("codex-sessions");
        fs::create_dir_all(&claude_projects_directory).expect("create claude projects dir");
        fs::create_dir_all(&codex_sessions_directory).expect("create codex sessions dir");
        let repository_root = fs::canonicalize(&repository)
            .expect("canonicalize fixture repository root")
            .to_string_lossy()
            .into_owned();
        Self {
            base,
            roots: ExternalSessionHistoryRoots {
                claude_projects_directory,
                codex_sessions_directory,
            },
            repository_root,
        }
    }

    fn claude_project_directory(&self) -> PathBuf {
        self.roots
            .claude_projects_directory
            .join(encode_claude_project_directory(&self.repository_root))
    }

    fn write_claude_content(
        &self,
        content: &str,
        session_id: &str,
        modified_epoch_ms: u64,
    ) -> PathBuf {
        self.write_claude_content_for_root(
            content,
            session_id,
            &self.repository_root,
            modified_epoch_ms,
        )
    }

    fn write_claude_content_for_root(
        &self,
        content: &str,
        session_id: &str,
        repository_root: &str,
        modified_epoch_ms: u64,
    ) -> PathBuf {
        let directory = self
            .roots
            .claude_projects_directory
            .join(encode_claude_project_directory(repository_root));
        fs::create_dir_all(&directory).expect("create claude project dir");
        let path = directory.join(format!("{session_id}.jsonl"));
        fs::write(&path, content).expect("write claude session fixture");
        set_modified(&path, modified_epoch_ms);
        path
    }

    fn write_claude_session(
        &self,
        fixture: &str,
        session_id: &str,
        cwd: &str,
        modified_epoch_ms: u64,
    ) -> PathBuf {
        let content = fixture_text(fixture).replace("/repo", cwd);
        self.write_claude_content(&content, session_id, modified_epoch_ms)
    }

    fn codex_day_directory(&self, day_offset: i64) -> PathBuf {
        let today = (NOW_EPOCH_MS / 86_400_000) as i64;
        let (year, month, day) = civil_from_days(today - day_offset);
        self.roots
            .codex_sessions_directory
            .join(format!("{year:04}"))
            .join(format!("{month:02}"))
            .join(format!("{day:02}"))
    }

    fn write_codex_session(
        &self,
        fixture: &str,
        session_id: &str,
        cwd: &str,
        day_offset: i64,
        modified_epoch_ms: u64,
    ) -> PathBuf {
        let directory = self.codex_day_directory(day_offset);
        fs::create_dir_all(&directory).expect("create codex day dir");
        let path = directory.join(format!("rollout-2026-08-30T09-00-00-{session_id}.jsonl"));
        let content = fixture_text(fixture).replace("/repo", cwd);
        fs::write(&path, content).expect("write codex session fixture");
        set_modified(&path, modified_epoch_ms);
        path
    }

    fn list(&self) -> ExternalAgentSessionListing {
        list_external_agent_sessions_at(
            &ListExternalAgentSessionsRequest {
                project_root: self.repository_root.clone(),
                repository_root: self.repository_root.clone(),
            },
            &self.roots,
            NOW_EPOCH_MS,
        )
        .expect("list external sessions")
    }

    fn preview(
        &self,
        provider: AgentCliInvocation,
        session_id: &str,
    ) -> Result<ExternalAgentSessionPreview, String> {
        preview_external_agent_session_at(
            &PreviewExternalAgentSessionRequest {
                provider,
                session_id: session_id.to_string(),
                project_root: self.repository_root.clone(),
                repository_root: self.repository_root.clone(),
            },
            &self.roots,
            NOW_EPOCH_MS,
        )
    }
}

impl Drop for HistoryHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn minimal_claude_line(root: &str, session_id: &str, prompt: &str) -> String {
    json!({
        "type": "user",
        "message": {"role": "user", "content": prompt},
        "promptSource": "typed",
        "cwd": root,
        "timestamp": "2026-08-30T08:00:00.000Z",
        "sessionId": session_id
    })
    .to_string()
}

fn claude_attachment_line(root: &str, session_id: &str) -> String {
    json!({
        "type": "attachment",
        "attachment": {"type": "hook_success", "content": ""},
        "cwd": root,
        "timestamp": "2026-08-30T08:00:00.000Z",
        "sessionId": session_id
    })
    .to_string()
}

#[test]
fn requests_reject_unknown_fields_and_use_the_camel_case_wire_shape() {
    let list = serde_json::from_value::<ListExternalAgentSessionsRequest>(json!({
        "projectRoot": "/repo",
        "repositoryRoot": "/repo"
    }))
    .expect("deserialize list request");
    let preview = serde_json::from_value::<PreviewExternalAgentSessionRequest>(json!({
        "provider": "claudeCode",
        "sessionId": CLAUDE_SESSION_ID,
        "projectRoot": "/repo",
        "repositoryRoot": "/repo"
    }))
    .expect("deserialize preview request");

    assert_eq!(list.repository_root, "/repo");
    assert_eq!(list.project_root, "/repo");
    assert_eq!(preview.provider, AgentCliInvocation::ClaudeCode);
    assert_eq!(preview.session_id, CLAUDE_SESSION_ID);

    assert!(
        serde_json::from_value::<ListExternalAgentSessionsRequest>(json!({
            "projectRoot": "/repo",
            "repositoryRoot": "/repo",
            "extra": 1
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<PreviewExternalAgentSessionRequest>(json!({
            "provider": "vscode",
            "sessionId": CODEX_SESSION_ID,
            "projectRoot": "/repo",
            "repositoryRoot": "/repo"
        }))
        .is_err()
    );
}

#[test]
fn responses_serialize_the_typescript_wire_shape() {
    let listing = ExternalAgentSessionListing {
        sessions: vec![ExternalAgentSessionSummary {
            provider: AgentCliInvocation::CodexExec,
            session_id: CODEX_SESSION_ID.to_string(),
            cwd: "/repo".to_string(),
            title: "Terminal session".to_string(),
            first_prompt: "remember mango".to_string(),
            started_at_epoch_ms: 1,
            last_activity_epoch_ms: 2,
            turn_count: 6,
            turn_count_exact: false,
            file_bytes: 4096,
        }],
        skipped: 12,
        truncated: true,
    };
    let preview = ExternalAgentSessionPreview {
        provider: AgentCliInvocation::ClaudeCode,
        session_id: CLAUDE_SESSION_ID.to_string(),
        exchanges: vec![ExternalSessionExchange {
            role: ExternalSessionExchangeRole::Assistant,
            text: "done".to_string(),
        }],
        exchanges_truncated: false,
        total_preview_bytes: 4,
    };

    let encoded_listing = serde_json::to_value(&listing).expect("serialize listing");
    let encoded_preview = serde_json::to_value(&preview).expect("serialize preview");

    assert_eq!(encoded_listing["sessions"][0]["provider"], json!("codex"));
    assert_eq!(
        encoded_listing["sessions"][0]["turnCountExact"],
        json!(false)
    );
    assert_eq!(
        encoded_listing["sessions"][0]["firstPrompt"],
        json!("remember mango")
    );
    assert_eq!(encoded_listing["skipped"], json!(12));
    assert_eq!(encoded_preview["provider"], json!("claudeCode"));
    assert_eq!(encoded_preview["exchanges"][0]["role"], json!("assistant"));
    assert_eq!(encoded_preview["exchangesTruncated"], json!(false));
}

#[test]
fn session_ids_must_be_canonical_uuids() {
    assert_eq!(
        validate_external_session_id(CLAUDE_SESSION_ID),
        Ok(CLAUDE_SESSION_ID)
    );
    assert_eq!(
        validate_external_session_id(CODEX_SESSION_ID),
        Ok(CODEX_SESSION_ID)
    );

    for candidate in [
        "",
        "not-a-uuid",
        "../987b95ad-c9bc-4d08-ae49-9b431efc8f87",
        "987b95ad-c9bc-4d08-ae49-9b431efc8f87/x",
        "987b95ad-c9bc-4d08-ae49-9b431efc8f877",
        "987b95ad-c9bc-4d08-ae49-9b431efc8f87-1",
        "987b95ag-c9bc-4d08-ae49-9b431efc8f87",
    ] {
        assert_eq!(
            validate_external_session_id(candidate),
            Err(EXTERNAL_SESSION_ID_ERROR.to_string()),
            "{candidate} must be refused"
        );
    }
}

#[test]
fn claude_project_directories_replace_every_non_alphanumeric_character() {
    assert_eq!(
        encode_claude_project_directory("/Users/matusmockor/Developer/editor"),
        "-Users-matusmockor-Developer-editor"
    );
    assert_eq!(
        encode_claude_project_directory("/tmp/import-smoke/under_score.dir"),
        "-tmp-import-smoke-under-score-dir"
    );
    assert_eq!(
        encode_claude_project_directory("/repo/.worktrees/agt-x"),
        "-repo--worktrees-agt-x"
    );
}

#[test]
fn iso_utc_timestamps_parse_to_epoch_milliseconds() {
    assert_eq!(
        parse_iso_utc_epoch_ms("2026-08-30T08:00:00.000Z"),
        Some(CLAUDE_INTERACTIVE_STARTED_MS)
    );
    assert_eq!(
        parse_iso_utc_epoch_ms("2026-08-31T12:00:00Z"),
        Some(NOW_EPOCH_MS)
    );
    assert_eq!(parse_iso_utc_epoch_ms("1970-01-01T00:00:00.5Z"), Some(500));
    for candidate in [
        "",
        "2026-08-30 08:00:00Z",
        "2026-13-01T00:00:00.000Z",
        "2026-08-30T08:00:00.000+02:00",
        "2026-08-30T08:00:00",
        "not-a-timestamp",
    ] {
        assert_eq!(parse_iso_utc_epoch_ms(candidate), None, "{candidate}");
    }
}

#[test]
fn listing_lists_interactive_sessions_from_both_providers() {
    let home = HistoryHome::create("list-happy");
    let claude_path = home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_INTERACTIVE_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 20_000,
    );
    home.write_codex_session(
        "codex-exec.jsonl",
        CODEX_EXEC_ID,
        &home.repository_root,
        1,
        NOW_EPOCH_MS - 10_000,
    );

    let listing = home.list();

    assert_eq!(listing.sessions.len(), 2);
    assert_eq!(listing.skipped, 0);
    assert!(!listing.truncated);

    let codex = &listing.sessions[0];
    assert_eq!(codex.provider, AgentCliInvocation::CodexExec);
    assert_eq!(codex.session_id, CODEX_EXEC_ID);
    assert_eq!(codex.cwd, home.repository_root);
    assert_eq!(
        codex.title,
        "Remember the word mango. Reply with exactly: ok"
    );
    assert_eq!(
        codex.first_prompt,
        "Remember the word mango. Reply with exactly: ok"
    );
    assert_eq!(codex.started_at_epoch_ms, CODEX_EXEC_STARTED_MS);
    assert_eq!(codex.last_activity_epoch_ms, NOW_EPOCH_MS - 10_000);
    assert_eq!(codex.turn_count, 2);
    assert!(codex.turn_count_exact);

    let claude = &listing.sessions[1];
    assert_eq!(claude.provider, AgentCliInvocation::ClaudeCode);
    assert_eq!(claude.session_id, CLAUDE_INTERACTIVE_ID);
    assert_eq!(claude.cwd, home.repository_root);
    assert_eq!(claude.title, "Voting module refactor");
    assert_eq!(claude.first_prompt, "Refactor the oversized voting module");
    assert_eq!(claude.started_at_epoch_ms, CLAUDE_INTERACTIVE_STARTED_MS);
    assert_eq!(claude.last_activity_epoch_ms, NOW_EPOCH_MS - 20_000);
    assert_eq!(claude.turn_count, 3);
    assert!(claude.turn_count_exact);
    assert_eq!(
        claude.file_bytes,
        fs::metadata(&claude_path)
            .expect("claude fixture metadata")
            .len()
    );
}

#[test]
fn listing_treats_missing_and_empty_history_directories_as_empty() {
    let home = HistoryHome::create("list-empty");
    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 0);
    assert!(!listing.truncated);

    fs::create_dir_all(home.claude_project_directory()).expect("create empty project dir");
    fs::create_dir_all(home.codex_day_directory(0)).expect("create empty day dir");
    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 0);
    assert!(!listing.truncated);
}

#[test]
fn claude_sessions_with_a_foreign_cwd_are_ignored_without_inflating_skipped() {
    let home = HistoryHome::create("claude-foreign");
    home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_INTERACTIVE_ID,
        "/somewhere/else",
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 0);
}

#[test]
fn listing_includes_sessions_from_canonical_nested_repositories() {
    let home = HistoryHome::create("nested-repositories");
    let nested = home.base.join("repo").join("packages").join("api");
    fs::create_dir_all(&nested).expect("create nested repository");
    let nested = fs::canonicalize(nested)
        .expect("canonicalize nested repository")
        .to_string_lossy()
        .into_owned();
    let claude_line = minimal_claude_line(&nested, CLAUDE_INTERACTIVE_ID, "nested claude");
    home.write_claude_content_for_root(
        &format!("{claude_line}\n"),
        CLAUDE_INTERACTIVE_ID,
        &nested,
        NOW_EPOCH_MS - 2_000,
    );
    home.write_codex_session(
        "codex-exec.jsonl",
        CODEX_EXEC_ID,
        &nested,
        1,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();

    assert_eq!(listing.sessions.len(), 2);
    assert!(listing.sessions.iter().all(|session| session.cwd == nested));
    assert_eq!(listing.skipped, 0);
}

#[test]
fn claude_sessions_without_typed_prompts_are_skipped() {
    let home = HistoryHome::create("claude-sdk-only");
    home.write_claude_session(
        "claude-sdk-only.jsonl",
        CLAUDE_SDK_ONLY_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 1);
}

#[test]
fn legacy_plain_string_prompts_qualify_without_prompt_source() {
    let home = HistoryHome::create("claude-legacy");
    home.write_claude_session(
        "claude-legacy-plain.jsonl",
        CLAUDE_LEGACY_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    assert_eq!(listing.skipped, 0);
    let session = &listing.sessions[0];
    assert_eq!(session.title, "Legacy plain prompt about parsers");
    assert_eq!(session.first_prompt, "Legacy plain prompt about parsers");
    assert_eq!(session.turn_count, 1);
    assert!(session.turn_count_exact);
}

#[test]
fn claude_titles_prefer_agent_name_over_ai_title() {
    let home = HistoryHome::create("claude-titles");
    home.write_claude_session(
        "claude-agent-named.jsonl",
        CLAUDE_AGENT_NAMED_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    assert_eq!(listing.sessions[0].title, "Fixture agent thread");
    assert_eq!(
        listing.sessions[0].first_prompt,
        "Investigate the flaky watcher test"
    );
}

#[test]
fn codex_non_interactive_sources_are_skipped_and_foreign_cwds_ignored() {
    let home = HistoryHome::create("codex-sources");
    home.write_codex_session(
        "codex-vscode.jsonl",
        CODEX_VSCODE_ID,
        &home.repository_root,
        2,
        NOW_EPOCH_MS - 1_000,
    );
    home.write_codex_session(
        "codex-subagent.jsonl",
        CODEX_SUBAGENT_ID,
        &home.repository_root,
        3,
        NOW_EPOCH_MS - 2_000,
    );
    home.write_codex_session(
        "codex-exec.jsonl",
        CODEX_EXEC_ID,
        "/foreign/checkout",
        4,
        NOW_EPOCH_MS - 3_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 2);
}

#[test]
fn codex_cli_sessions_inside_the_day_window_are_listed() {
    let home = HistoryHome::create("codex-window");
    assert!(home
        .codex_day_directory(0)
        .ends_with(Path::new("2026").join("08").join("31")));
    home.write_codex_session(
        "codex-cli.jsonl",
        CODEX_CLI_ID,
        &home.repository_root,
        i64::from(CODEX_SCAN_DAYS) - 1,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    assert_eq!(listing.sessions[0].session_id, CODEX_CLI_ID);
    assert_eq!(listing.sessions[0].turn_count, 1);
    assert_eq!(listing.sessions[0].title, "Summarise the meeting notes");
}

#[test]
fn codex_sessions_outside_the_day_window_are_not_scanned() {
    let home = HistoryHome::create("codex-window-out");
    home.write_codex_session(
        "codex-cli.jsonl",
        CODEX_CLI_ID,
        &home.repository_root,
        i64::from(CODEX_SCAN_DAYS),
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 0);
}

#[test]
fn codex_rollout_files_with_mismatched_meta_ids_are_skipped() {
    let home = HistoryHome::create("codex-id-mismatch");
    home.write_codex_session(
        "codex-exec.jsonl",
        ABSENT_SESSION_ID,
        &home.repository_root,
        1,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 1);
}

#[test]
fn codex_files_beyond_the_provider_cap_do_not_claim_to_be_unreadable() {
    let home = HistoryHome::create("codex-foreign-cap");
    let foreign = home.base.join("foreign");
    fs::create_dir_all(&foreign).expect("create foreign repository");
    let foreign = fs::canonicalize(foreign)
        .expect("canonicalize foreign repository")
        .to_string_lossy()
        .into_owned();
    let directory = home.codex_day_directory(1);
    fs::create_dir_all(&directory).expect("create codex day directory");
    for index in 0..(MAX_PROVIDER_FILES + 2) {
        let session_id = format!("{index:08x}-0000-4000-8000-{index:012x}");
        let path = directory.join(format!("rollout-2026-08-30T09-00-00-{session_id}.jsonl"));
        let content = json!({
            "timestamp": "2026-08-30T09:00:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "timestamp": "2026-08-30T09:00:00.000Z",
                "cwd": foreign,
                "source": "exec"
            }
        })
        .to_string();
        fs::write(&path, format!("{content}\n")).expect("write foreign codex session");
        set_modified(&path, NOW_EPOCH_MS - index as u64);
    }

    let listing = home.list();

    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 0);
}

#[test]
fn listing_caps_scanned_files_and_returned_entries_truthfully() {
    let home = HistoryHome::create("list-caps");
    let total = MAX_PROVIDER_FILES + 2;
    for index in 0..total {
        let session_id = format!("{index:08x}-0000-4000-8000-{index:012x}");
        let line = minimal_claude_line(&home.repository_root, &session_id, "hello");
        home.write_claude_content(
            &format!("{line}\n"),
            &session_id,
            NOW_EPOCH_MS - (index as u64) * 1_000,
        );
    }

    let listing = home.list();
    assert_eq!(listing.sessions.len(), MAX_EXTERNAL_SESSION_ENTRIES);
    assert_eq!(listing.skipped, 2);
    assert!(listing.truncated);
}

#[test]
fn oversized_session_files_stay_bounded_and_report_inexact_counts() {
    let home = HistoryHome::create("oversize");
    let root = home.repository_root.clone();
    let mut content = String::new();
    content.push_str(&claude_attachment_line(&root, CLAUDE_INTERACTIVE_ID));
    content.push('\n');
    content.push_str(&minimal_claude_line(
        &root,
        CLAUDE_INTERACTIVE_ID,
        "First prompt inside the head window",
    ));
    content.push('\n');
    let filler = json!({
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": "x".repeat(8 * 1024)}]},
        "cwd": root,
        "timestamp": "2026-08-30T08:00:02.000Z",
        "sessionId": CLAUDE_INTERACTIVE_ID
    })
    .to_string();
    while content.len() <= 10 * 1024 * 1024 + 512 * 1024 {
        content.push_str(&filler);
        content.push('\n');
    }
    content.push_str(&minimal_claude_line(
        &root,
        CLAUDE_INTERACTIVE_ID,
        "Tail prompt beyond the head window",
    ));
    content.push('\n');
    let path = home.write_claude_content(&content, CLAUDE_INTERACTIVE_ID, NOW_EPOCH_MS - 1_000);

    let window = read_history_windows(&path, true).expect("read bounded windows");
    assert_eq!(window.head.len(), HEAD_READ_BYTES);
    assert_eq!(
        window.tail.as_ref().map(|tail| tail.bytes.len()),
        Some(TAIL_READ_BYTES)
    );
    assert_eq!(
        window.tail.as_ref().map(|tail| tail.starts_after_head),
        Some(true)
    );
    assert!(!window.head_complete);
    assert!(window.file_bytes > 10 * 1024 * 1024);

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    let session = &listing.sessions[0];
    assert_eq!(session.turn_count, 1);
    assert!(!session.turn_count_exact);
    assert_eq!(session.file_bytes, window.file_bytes);

    let preview = home
        .preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID)
        .expect("preview oversized session");
    assert!(preview.exchanges_truncated);
    assert!(preview.total_preview_bytes <= PREVIEW_TOTAL_BYTES as u64);
    assert_eq!(
        preview
            .exchanges
            .last()
            .map(|exchange| exchange.text.as_str()),
        Some("Tail prompt beyond the head window")
    );
}

#[test]
fn preview_maps_roles_and_excludes_tool_noise() {
    let home = HistoryHome::create("preview-roles");
    home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_INTERACTIVE_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );
    home.write_codex_session(
        "codex-exec.jsonl",
        CODEX_EXEC_ID,
        &home.repository_root,
        1,
        NOW_EPOCH_MS - 1_000,
    );

    let claude = home
        .preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID)
        .expect("preview claude session");
    let claude_rows: Vec<(ExternalSessionExchangeRole, &str)> = claude
        .exchanges
        .iter()
        .map(|exchange| (exchange.role, exchange.text.as_str()))
        .collect();
    assert_eq!(
        claude_rows,
        vec![
            (
                ExternalSessionExchangeRole::User,
                "Refactor the oversized voting module"
            ),
            (
                ExternalSessionExchangeRole::Assistant,
                "The module splits into three files."
            ),
            (
                ExternalSessionExchangeRole::User,
                "Now add regression tests"
            ),
            (
                ExternalSessionExchangeRole::Assistant,
                "Added regression tests for the split."
            ),
            (ExternalSessionExchangeRole::User, "Ship it"),
        ]
    );
    assert!(!claude.exchanges_truncated);
    let expected_bytes: u64 = claude
        .exchanges
        .iter()
        .map(|exchange| exchange.text.len() as u64)
        .sum();
    assert_eq!(claude.total_preview_bytes, expected_bytes);

    let codex = home
        .preview(AgentCliInvocation::CodexExec, CODEX_EXEC_ID)
        .expect("preview codex session");
    let codex_rows: Vec<(ExternalSessionExchangeRole, &str)> = codex
        .exchanges
        .iter()
        .map(|exchange| (exchange.role, exchange.text.as_str()))
        .collect();
    assert_eq!(
        codex_rows,
        vec![
            (
                ExternalSessionExchangeRole::User,
                "Remember the word mango. Reply with exactly: ok"
            ),
            (ExternalSessionExchangeRole::Assistant, "ok"),
            (
                ExternalSessionExchangeRole::User,
                "What word did I ask you to remember?"
            ),
            (ExternalSessionExchangeRole::Assistant, "mango"),
        ]
    );
    assert!(!codex.exchanges_truncated);
}

#[test]
fn preview_caps_exchanges_keeping_the_beginning_and_the_end() {
    let home = HistoryHome::create("preview-caps");
    let root = home.repository_root.clone();
    let mut content = String::new();
    content.push_str(&claude_attachment_line(&root, CLAUDE_INTERACTIVE_ID));
    content.push('\n');
    for index in 0..50 {
        content.push_str(&minimal_claude_line(
            &root,
            CLAUDE_INTERACTIVE_ID,
            &format!("prompt {index:02}"),
        ));
        content.push('\n');
    }
    home.write_claude_content(&content, CLAUDE_INTERACTIVE_ID, NOW_EPOCH_MS - 1_000);

    let preview = home
        .preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID)
        .expect("preview capped session");
    assert_eq!(preview.exchanges.len(), MAX_PREVIEW_EXCHANGES);
    assert!(preview.exchanges_truncated);
    assert_eq!(preview.exchanges[0].text, "prompt 00");
    assert_eq!(preview.exchanges[7].text, "prompt 07");
    assert_eq!(preview.exchanges[8].text, "prompt 18");
    assert_eq!(preview.exchanges[39].text, "prompt 49");
}

#[test]
fn preview_fails_closed_on_invalid_or_unknown_sessions() {
    let home = HistoryHome::create("preview-closed");
    home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_INTERACTIVE_ID,
        "/somewhere/else",
        NOW_EPOCH_MS - 1_000,
    );
    home.write_codex_session(
        "codex-vscode.jsonl",
        CODEX_VSCODE_ID,
        &home.repository_root,
        1,
        NOW_EPOCH_MS - 1_000,
    );

    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, "../../etc/passwd"),
        Err(EXTERNAL_SESSION_ID_ERROR.to_string())
    );
    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, ABSENT_SESSION_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
    assert_eq!(
        home.preview(AgentCliInvocation::CodexExec, ABSENT_SESSION_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
    assert_eq!(
        home.preview(AgentCliInvocation::CodexExec, CODEX_VSCODE_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
}

#[cfg(unix)]
#[test]
fn symlinked_session_files_are_refused() {
    let home = HistoryHome::create("symlink-escape");
    let outside_directory = home.base.join("outside");
    fs::create_dir_all(&outside_directory).expect("create outside dir");
    let outside_file = outside_directory.join("real.jsonl");
    fs::write(
        &outside_file,
        fixture_text("claude-interactive.jsonl").replace("/repo", &home.repository_root),
    )
    .expect("write outside session file");

    let project_directory = home.claude_project_directory();
    fs::create_dir_all(&project_directory).expect("create project dir");
    std::os::unix::fs::symlink(
        &outside_file,
        project_directory.join(format!("{CLAUDE_INTERACTIVE_ID}.jsonl")),
    )
    .expect("create symlinked session file");

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 1);

    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
}

#[cfg(unix)]
#[test]
fn unreadable_session_files_count_as_skipped() {
    use std::os::unix::fs::PermissionsExt;

    let home = HistoryHome::create("unreadable");
    let path = home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_INTERACTIVE_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("remove read permission");

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(listing.skipped, 1);

    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("restore read permission");
}

#[test]
fn repository_roots_must_be_canonical_absolute_directories() {
    let home = HistoryHome::create("root-validation");
    let file_path = home.base.join("plain-file.txt");
    fs::write(&file_path, "not a directory").expect("write plain file");
    #[cfg(unix)]
    let alias = {
        let alias = home.base.join("alias");
        std::os::unix::fs::symlink(home.base.join("repo"), &alias).expect("create root alias");
        alias
    };

    let mut candidates = vec![
        String::new(),
        "repo".to_string(),
        home.base.join("missing").to_string_lossy().into_owned(),
        file_path.to_string_lossy().into_owned(),
        "/".repeat(MAX_EXTERNAL_SESSION_ROOT_BYTES + 1),
    ];
    #[cfg(unix)]
    candidates.push(alias.to_string_lossy().into_owned());

    for candidate in candidates {
        let result = list_external_agent_sessions_at(
            &ListExternalAgentSessionsRequest {
                project_root: home.repository_root.clone(),
                repository_root: candidate.clone(),
            },
            &home.roots,
            NOW_EPOCH_MS,
        );
        assert_eq!(
            result,
            Err(EXTERNAL_SESSION_ROOT_ERROR.to_string()),
            "{candidate:?} must be refused"
        );
    }
}

fn claude_filler_line(root: &str, session_id: &str, bytes: usize) -> String {
    json!({
        "type": "attachment",
        "attachment": {"type": "hook_success", "content": "f".repeat(bytes)},
        "cwd": root,
        "timestamp": "2026-08-30T08:00:01.000Z",
        "sessionId": session_id
    })
    .to_string()
}

#[test]
fn head_and_tail_windows_never_overlap_for_files_just_past_the_head_budget() {
    let home = HistoryHome::create("window-overlap");
    let root = home.repository_root.clone();
    let mut content = String::new();
    let mut prompts: Vec<String> = Vec::new();
    let mut index = 0usize;
    while content.len() < 300 * 1024 {
        let prompt = format!("overlap prompt {index:04}");
        content.push_str(&minimal_claude_line(&root, CLAUDE_INTERACTIVE_ID, &prompt));
        content.push('\n');
        prompts.push(prompt);
        content.push_str(&claude_filler_line(&root, CLAUDE_INTERACTIVE_ID, 12 * 1024));
        content.push('\n');
        index += 1;
    }
    let path = home.write_claude_content(&content, CLAUDE_INTERACTIVE_ID, NOW_EPOCH_MS - 1_000);

    let window = read_history_windows(&path, true).expect("read bounded windows");
    assert!(window.file_bytes > HEAD_READ_BYTES as u64);
    assert!(window.file_bytes < (HEAD_READ_BYTES + TAIL_READ_BYTES) as u64);
    assert!(!window.head_complete);
    let tail = window.tail.as_ref().expect("tail window");
    assert!(!tail.starts_after_head, "tail must not re-read head bytes");
    assert!(tail.reached_end);
    assert!(window.covers_file);
    assert_eq!(
        window.head.len() as u64 + tail.bytes.len() as u64,
        window.file_bytes
    );

    let preview = home
        .preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID)
        .expect("preview overlapping session");
    let texts: Vec<&str> = preview
        .exchanges
        .iter()
        .map(|exchange| exchange.text.as_str())
        .collect();
    let mut unique = texts.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), texts.len(), "duplicate exchanges: {texts:?}");
    assert!(prompts.len() < MAX_PREVIEW_EXCHANGES);
    assert_eq!(
        texts,
        prompts.iter().map(String::as_str).collect::<Vec<_>>()
    );
    assert!(
        !preview.exchanges_truncated,
        "fully covered windows must not claim truncation"
    );

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    let session = &listing.sessions[0];
    assert!(session.turn_count > 0);
    assert!(
        (session.turn_count as usize) < prompts.len(),
        "the head-only listing scan cannot see every prompt"
    );
    assert!(
        !session.turn_count_exact,
        "a head-only scan of an oversized file is never exact"
    );
}

#[test]
fn newest_claude_sessions_survive_the_provider_file_cap() {
    let home = HistoryHome::create("newest-first-cap");
    let total = MAX_PROVIDER_FILES + 8;
    let mut newest: Vec<String> = Vec::new();
    for index in 0..total {
        let session_id = format!("{index:08x}-0000-4000-8000-{index:012x}");
        let line = minimal_claude_line(&home.repository_root, &session_id, "hello");
        home.write_claude_content(
            &format!("{line}\n"),
            &session_id,
            NOW_EPOCH_MS - (index as u64) * 1_000,
        );
        if index < MAX_EXTERNAL_SESSION_ENTRIES {
            newest.push(session_id);
        }
    }

    let listing = home.list();

    assert_eq!(listing.sessions.len(), MAX_EXTERNAL_SESSION_ENTRIES);
    assert_eq!(listing.skipped, 8);
    assert!(listing.truncated);
    let listed: Vec<&str> = listing
        .sessions
        .iter()
        .map(|session| session.session_id.as_str())
        .collect();
    assert_eq!(
        listed,
        newest.iter().map(String::as_str).collect::<Vec<_>>()
    );
}

#[test]
fn scanned_line_caps_make_turn_counts_and_previews_inexact() {
    let home = HistoryHome::create("line-cap");
    let root = home.repository_root.clone();
    let mut content = String::new();
    for index in 0..3 {
        content.push_str(&minimal_claude_line(
            &root,
            CLAUDE_INTERACTIVE_ID,
            &format!("p{index}"),
        ));
        content.push('\n');
    }
    for _ in 0..MAX_SCANNED_WINDOW_LINES {
        content.push_str("0\n");
    }
    let path = home.write_claude_content(&content, CLAUDE_INTERACTIVE_ID, NOW_EPOCH_MS - 1_000);
    let window = read_history_windows(&path, true).expect("read bounded windows");
    assert!(
        window.head_complete,
        "the fixture must stay inside the head window"
    );
    assert!(window.covers_file);
    assert!(window_lines(&window.head, false, false).truncated);

    let listing = home.list();
    assert_eq!(listing.sessions.len(), 1);
    assert_eq!(listing.sessions[0].turn_count, 3);
    assert!(
        !listing.sessions[0].turn_count_exact,
        "a capped line scan cannot report an exact turn count"
    );

    let preview = home
        .preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID)
        .expect("preview capped session");
    assert!(preview.exchanges_truncated);
}

#[test]
fn claude_previews_enforce_the_typed_prompt_interactivity_gate() {
    let home = HistoryHome::create("preview-sdk-only");
    home.write_claude_session(
        "claude-sdk-only.jsonl",
        CLAUDE_SDK_ONLY_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();
    assert!(listing.sessions.is_empty());
    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, CLAUDE_SDK_ONLY_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
}

#[cfg(unix)]
#[test]
fn named_pipes_named_like_session_files_never_block_the_scan() {
    use std::ffi::CString;

    let home = HistoryHome::create("fifo");
    let directory = home.claude_project_directory();
    fs::create_dir_all(&directory).expect("create claude project dir");
    let fifo_path = directory.join(format!("{CLAUDE_INTERACTIVE_ID}.jsonl"));
    let encoded = CString::new(fifo_path.as_os_str().as_encoded_bytes()).expect("encode fifo path");
    let created = unsafe { libc::mkfifo(encoded.as_ptr(), 0o600) };
    assert_eq!(created, 0, "mkfifo must succeed in the fixture home");
    home.write_claude_session(
        "claude-interactive.jsonl",
        CLAUDE_AGENT_NAMED_ID,
        &home.repository_root,
        NOW_EPOCH_MS - 1_000,
    );

    let listing = home.list();

    assert_eq!(listing.sessions.len(), 1);
    assert_eq!(listing.sessions[0].session_id, CLAUDE_AGENT_NAMED_ID);
    assert_eq!(listing.skipped, 1);
    assert_eq!(
        home.preview(AgentCliInvocation::ClaudeCode, CLAUDE_INTERACTIVE_ID),
        Err(EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())
    );
}
